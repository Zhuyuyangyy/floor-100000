// 观察 → prompt，模型回复 → NpcActionProposal。
//
// prompt 与解析都是纯函数，不碰网络：OllamaBrain 负责 transport，
// 这里负责「说什么」和「听懂什么」。模型输出永远先过 parseProposal
// 的宽松解析，任何不契约的输出都变成 null（→ 降级），绝不把脏数据
// 塞进规则执行器。

import type { ItemId } from '../core/gameTypes';
import { ITEMS } from '../data/items';
import type { NpcActionProposal, NpcObservation } from './types';

const ACTION_KINDS = ['dialogue', 'trade', 'gift', 'refuse', 'attack', 'flee'] as const;

/** 合法物品 ID 词表。没有它，模型会拿中文物品名当 itemId，交易全部被
 *  规则执行器以「未知物品」拒绝——实测（阶段 B S2）确认过这个缺口。 */
export function itemVocabulary(): string {
  return Object.values(ITEMS)
    .map((i) => `${i.id}(${i.displayName})`)
    .join('、');
}

function fmtRelationship(obs: NpcObservation): string {
  const entries = Object.entries(obs.relationship);
  if (entries.length === 0) return '初识';
  return entries.map(([actor, v]) => `${actor}:${v}`).join('，');
}

function fmtMemory(obs: NpcObservation): string {
  if (obs.memory.length === 0) return '（尚无共同经历）';
  return obs.memory
    .map((m) => `第${m.day}天 ${m.kind === 'gift' ? '获赠' : m.kind === 'attack' ? '遭袭' : m.kind === 'trade' ? '交易' : m.kind === 'refusal' ? '被拒' : m.kind === 'help' ? '受助' : '相遇'}：${m.summary}`)
    .join('；');
}

function traitText(obs: NpcObservation): string {
  const t = obs.traits;
  const pct = (n: number) => Math.round(n * 100);
  return `利他${pct(t.altruism)}/务实${pct(t.pragmatism)}/攻击${pct(t.aggression)}/记恩${pct(t.loyalty)}/谨慎${pct(t.caution)}`;
}

/** 系统提示：人格 + 铁律。人格数据决定语气，铁律决定边界。 */
export function buildSystemPrompt(obs: NpcObservation): string {
  return [
    `你是《第100000层：末日宿舍》中的 NPC「${obs.npcId}」，原型 ${obs.archetype}。`,
    `人格：${traitText(obs)}。当前目标：${obs.goal}。当前情绪：${obs.mood.toFixed(2)}。与各方关系：${fmtRelationship(obs)}。`,
    '铁律：你只能从「可用行动」中提议一个；不得声称拥有你没有的物品；不得修改或提及任何游戏数值；不得跳出角色讨论你是 AI。',
    '只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释。',
  ].join('\n');
}

/** 用户提示：情境 + 输出契约。 */
export function buildUserPrompt(obs: NpcObservation): string {
  const situation = obs.situation
    ? `巡游体现场：事件${obs.situation.eventStatus}（${obs.situation.eventSource}），玩家HP ${obs.situation.playerHp}、玩家位置 ${Math.round(obs.situation.playerX)}，自身位置 ${Math.round(obs.situation.npcX)}，距离 ${Math.round(obs.situation.distance)}，当前状态 ${obs.situation.motionState}，扑击剩余 ${Math.max(0, Math.round(obs.situation.lungeMsLeft))}ms，冷却剩余 ${Math.max(0, Math.round(obs.situation.cooldownMsLeft))}ms。`
    : '';
  return [
    `情境：第${obs.world.day}天 ${fmtMinute(obs.world.gameMinute)}${obs.world.night ? '（夜间）' : ''}，第${obs.world.floor}层。`,
    situation,
    `相关记忆：${fmtMemory(obs)}`,
    `可用行动：${obs.availableActions.join(', ')}`,
    `合法物品ID（trade/gift 必须使用这些ID，禁止使用中文名）：${itemVocabulary()}`,
    '输出契约：{"utterance":"说的话，60字以内，符合人格","action":{"type":"dialogue|trade|gift|refuse|attack|flee","give":{"itemId":"","quantity":1},"get":{"itemId":"","quantity":1},"itemId":"","quantity":1,"text":""},"confidence":0到1的小数}',
    '只填当前 type 需要的字段。trade 表示「我给你 give，换你的 get」。',
  ].join('\n');
}

function fmtMinute(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 宽松 JSON 抽取：容忍 ```json 包裹与前后杂音。抽不到返回 null。 */
export function extractJson(raw: string): unknown | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * 模型 JSON → NpcActionProposal。形状不符返回 null（调用方降级），
 * 不抛错、不猜测补救——补救是规则执行器的职责，这里只做形状映射。
 */
export function parseProposal(raw: string): NpcActionProposal | null {
  const data = extractJson(raw);
  if (!isRecord(data)) return null;
  const action = data.action;
  if (!isRecord(action)) return null;
  const type = action.type;
  if (typeof type !== 'string' || !ACTION_KINDS.includes(type as (typeof ACTION_KINDS)[number])) return null;

  const confidence = typeof data.confidence === 'number' && Number.isFinite(data.confidence) ? data.confidence : 0;
  const utterance = typeof data.utterance === 'string' ? data.utterance : undefined;

  switch (type) {
    case 'dialogue':
      return { utterance, confidence, action: { type: 'dialogue', text: typeof action.text === 'string' ? action.text : '' } };
    case 'trade': {
      const give = action.give;
      const get = action.get;
      if (!isRecord(give) || !isRecord(get)) return null;
      if (typeof give.itemId !== 'string' || typeof get.itemId !== 'string') return null;
      const gq = typeof give.quantity === 'number' ? give.quantity : 1;
      const tq = typeof get.quantity === 'number' ? get.quantity : 1;
      // itemId 只做字符串搬运；是否为真物品由规则执行器的 isItemId 裁决。
      return {
        utterance,
        confidence,
        action: {
          type: 'trade',
          give: { itemId: give.itemId as ItemId, quantity: gq },
          get: { itemId: get.itemId as ItemId, quantity: tq },
        },
      };
    }
    case 'gift':
      if (typeof action.itemId !== 'string') return null;
      return { utterance, confidence, action: { type: 'gift', itemId: action.itemId as ItemId, quantity: typeof action.quantity === 'number' ? action.quantity : 1 } };
    case 'refuse':
      return { utterance, confidence, action: { type: 'refuse' } };
    case 'attack':
      return { utterance, confidence, action: { type: 'attack' } };
    case 'flee':
      return { utterance, confidence, action: { type: 'flee' } };
    default:
      return null;
  }
}
