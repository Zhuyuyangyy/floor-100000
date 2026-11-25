// 竞赛闭环的模型决策端口：把 CompetitionObservationSnapshot 送进真实模型，
// 再把模型的动作翻译成 CompetitionActionProposal。
//
// 分层铁律不变：模型只「提议」，competitionRules 裁决，executor 执行。
// 本模块只做两件事——把结构化观察压成 prompt，把模型输出翻译成契约动作。
// 翻译失败一律返回 null，让运行时走 rules 降级，绝不伪造动作。

import type {
  CompetitionActionProposal,
  CompetitionObservationSnapshot,
  CompetitionNpcStateSnapshot,
} from './competition-contract';
import { itemVocabulary, parseProposal } from './prompt';
import type { NpcActionProposal, NpcBrain, NpcObservation } from './types';
import type { ItemId } from '../core/gameTypes';

/** 竞赛快照 → 进入模型的最小事实集。不复用 NpcObservation，避免字段语义打架。 */
export interface ModelDecisionRequest {
  readonly systemPrompt: string;
  readonly userPrompt: string;
}

const MAX_UTTERANCE = 60;

function fmtMinute(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = Math.floor(minute % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function focusNpc(observation: CompetitionObservationSnapshot): CompetitionNpcStateSnapshot | null {
  const focus = observation.focus;
  if (!focus || typeof focus === 'string') return null;
  return observation.world.npcs.find((npc) => npc.npcId === focus.npcId) ?? null;
}

function inventoryText(items: readonly { itemId: string; quantity: number }[]): string {
  if (items.length === 0) return '空';
  return items.map((stack) => `${stack.itemId}×${stack.quantity}`).join('、');
}

function memoryText(npc: CompetitionNpcStateSnapshot | null): string {
  if (!npc || npc.memory.length === 0) return '（尚无共同经历）';
  return npc.memory
    .map((entry) => {
      if (entry.kind === 'fact') return `第${entry.day}天 ${entry.subject}=${entry.value}`;
      if (entry.kind === 'promise') return `第${entry.day}天 承诺(${entry.status})：${entry.promise}`;
      return `第${entry.day}天 ${entry.kind}(${entry.status})：${entry.description}`;
    })
    .join('；');
}

/**
 * 构造竞赛决策 prompt。
 *
 * 与旧 NpcObservation prompt 的关键差异：这里必须把「结构化状态」摊开给模型看
 * （库存、信任、门禁、可用动作），否则模型只能猜，行为无法与状态关联。
 */
/** NPC id → 中文显示名；未知 id 原样返回，不编造人名。 */
const NPC_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  alin: '阿林',
  xiaozhou: '小周',
  laochen: '老陈',
  daliu: '大刘',
  azhen: '阿珍',
  xiaoman: '小满',
  wanderer: '流浪者',
};

function displayName(npcId: string): string {
  return NPC_DISPLAY_NAMES[npcId] ?? npcId;
}

export function buildCompetitionPrompts(observation: CompetitionObservationSnapshot): ModelDecisionRequest {
  const world = observation.world;
  const npc = focusNpc(observation);
  const gate = world.gates[0];
  const npcId = npc?.npcId ?? 'alin';
  const systemPrompt = [
    `你是《第100000层：末日宿舍》中的 NPC「${displayName(npcId)}」（${npcId}）。`,
    '铁律：只能从「可用行动」里选一个；不得声称拥有背包里没有的物品；不得提及任何数值；不得跳出角色。',
    '只输出一个 JSON 对象，不要 markdown 代码块，不要解释。',
  ].join('\n');

  const userPrompt = [
    `情境：第${world.day}天 ${fmtMinute(world.gameMinute)}，第${world.currentFloor}层，种子 ${world.seed}。`,
    npc
      ? `我的状态：信任=${npc.trust}，好感=${npc.affinity}，压力=${npc.tension}，HP=${npc.hp}，饥饿=${npc.hunger}。`
      : '我的状态：未知。',
    `我的背包：${inventoryText(npc?.inventory ?? [])}`,
    `玩家背包：${inventoryText(world.player.inventory)}`,
    `玩家状态：HP=${world.player.hp}，饥饿=${world.player.hunger}，口渴=${world.player.thirst}，体力=${world.player.energy}。`,
    `相关记忆：${memoryText(npc)}`,
    gate ? `门禁 ${gate.gateId}：${gate.status}。` : '',
    `可用行动：${observation.availableActions.join(', ')}`,
    `合法物品ID（必须用这些ID，禁止中文名）：${itemVocabulary()}`,
    '输出契约：{"utterance":"说的话，60字以内","action":{"type":"dialogue|trade|gift|refuse","give":{"itemId":"","quantity":1},"get":{"itemId":"","quantity":1},"itemId":"","quantity":1,"text":""},"confidence":0到1}',
    '只填当前 type 需要的字段。gift 表示「我送给玩家」；trade 表示「玩家给我 give，我给他 get」。',
  ]
    .filter((line) => line.length > 0)
    .join('\n');

  return { systemPrompt, userPrompt };
}

function clampUtterance(text: string | undefined): string | undefined {
  if (typeof text !== 'string') return undefined;
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length <= MAX_UTTERANCE ? trimmed : trimmed.slice(0, MAX_UTTERANCE);
}

/** 模型提议的可执行动作集——只有这些能真正改世界。 */
export interface TranslationContext {
  readonly npcId: string;
  /** 玩家当前背包，用于把「接受赠礼」翻译成合法的 player→npc 转移。 */
  readonly playerInventory: readonly { itemId: ItemId; quantity: number }[];
  /** 当前门禁 id；模型只能申请修它，不能凭空指定。 */
  readonly gateId?: string;
  /** 维修配方；由规则层提供，模型不得自造材料。 */
  readonly repairMaterials?: readonly { itemId: ItemId; quantity: number }[];
}

/**
 * 模型提案 → 可执行竞赛动作。
 *
 * 三种落地路径（其余一律 null，交给规则降级）：
 * - dialogue / refuse → observe：NPC 不改变世界，但 utterance 进 trace。
 * - 模型点名某物品（gift/trade 里的 itemId）且玩家确实持有
 *   → give：视为「NPC 接受玩家递来的这件物品」，方向由本层固定为 player→npc。
 * - 模型明确表达维修意愿（text 提到门/修）且配方与门禁都已配置
 *   → repair_gate：模型只发起申请，材料与信任仍由 validator 独立裁决。
 *
 * 安全边界：模型永远不能自己拼出「NPC→玩家」的转移方向，也不能自定材料清单。
 */
export function translateModelAction(
  proposal: NpcActionProposal | null,
  ctx: TranslationContext,
): { proposal: CompetitionActionProposal; utterance?: string } | null {
  if (!proposal) return null;
  const utterance = clampUtterance(proposal.utterance);
  const action = proposal.action;

  if (action.type === 'dialogue' || action.type === 'refuse') {
    const wantsRepair = action.type === 'dialogue'
      && ctx.gateId !== undefined
      && ctx.repairMaterials !== undefined
      && /修|门|通道|通道门|repair|gate/i.test(`${action.text} ${utterance ?? ''}`);
    if (wantsRepair) {
      return {
        proposal: { kind: 'repair_gate', gateId: ctx.gateId!, materials: ctx.repairMaterials!.map((m) => ({ ...m })) },
        ...(utterance ? { utterance } : {}),
      };
    }
    return { proposal: { kind: 'observe', target: { kind: 'npc', npcId: ctx.npcId } }, ...(utterance ? { utterance } : {}) };
  }

  // gift/trade 里模型点名的物品：只有玩家真持有才翻译成「接受赠礼」。
  if (action.type === 'gift') {
    if (!inventoryHas(ctx.playerInventory, action.itemId, action.quantity)) return null;
    return {
      proposal: {
        kind: 'give',
        transfer: { from: 'player', to: { kind: 'npc', npcId: ctx.npcId }, itemId: action.itemId, quantity: action.quantity },
      },
      ...(utterance ? { utterance } : {}),
    };
  }

  if (action.type === 'trade') {
    // trade 里模型「想要的」是玩家手上的东西；「给的」不在玩家背包里。
    const { get: wants } = action;
    if (!inventoryHas(ctx.playerInventory, wants.itemId, wants.quantity)) return null;
    return {
      proposal: {
        kind: 'give',
        transfer: { from: 'player', to: { kind: 'npc', npcId: ctx.npcId }, itemId: wants.itemId, quantity: wants.quantity },
      },
      ...(utterance ? { utterance } : {}),
    };
  }

  return null;
}

/**
 * 从模型原始正文直接翻译（供不经过 NpcBrain 的调用方使用）。
 * 任何形状不符都返回 null。
 */
export function translateRawModelOutput(
  raw: string,
  ctx: TranslationContext,
): { proposal: CompetitionActionProposal; utterance?: string } | null {
  return translateModelAction(parseProposal(raw), ctx);
}

/** 把竞赛快照压成 NpcBrain 能吃的 NpcObservation，供复用现有 brain 实现。 */
export function toNpcObservation(observation: CompetitionObservationSnapshot): NpcObservation {
  const world = observation.world;
  const npc = focusNpc(observation);
  return {
    npcId: npc?.npcId ?? 'alin',
    archetype: 'ally',
    traits: { altruism: 0.6, pragmatism: 0.7, aggression: 0.1, loyalty: 0.8, caution: 0.5 },
    memory: [],
    relationship: npc ? { player: npc.trust } : {},
    goal: npc?.goal?.goalId ?? 'survive',
    mood: 0,
    world: { day: world.day, floor: world.currentFloor, gameMinute: world.gameMinute, night: world.gameMinute >= 1200 },
    self: { floor: npc?.position.floor ?? world.currentFloor, x: npc?.position.x ?? 0, hp: npc?.hp ?? 0 },
    // NpcBrain 只认 dialogue/trade/gift/refuse/attack/flee；这里把竞赛动作
    // 收窄成模型能提议的那一档，规则裁决仍由竞赛层负责。
    availableActions: ['dialogue'],
    recentEvents: observation.recentFacts.slice(),
  };
}

/**
 * 用真实 NpcBrain 生成一次竞赛提案。
 *
 * 失败路径全部返回 null：模型不可达、正文为空、翻译不了——都交给
 * competitionRuntime 的 fallback 端口走规则人格脑，不伪造动作。
 */
export async function proposeWithBrain(
  brain: NpcBrain,
  observation: CompetitionObservationSnapshot,
  extras: { gateId?: string; repairMaterials?: readonly { itemId: ItemId; quantity: number }[] } = {},
): Promise<{ proposal: CompetitionActionProposal; utterance?: string } | null> {
  const npc = focusNpc(observation);
  const npcId = npc?.npcId ?? 'alin';
  try {
    const raw = await brain.decide(toNpcObservation(observation));
    return translateModelAction(raw, {
      npcId,
      playerInventory: observation.world.player.inventory,
      gateId: extras.gateId ?? observation.world.gates[0]?.gateId,
      repairMaterials: extras.repairMaterials,
    });
  } catch {
    // 模型侧任何异常都在这里收口：调用方只看到 null，进而走规则降级。
    return null;
  }
}

/** 供测试与 trace 使用：该物品是否出现在某个背包里。 */
export function inventoryHas(
  inventory: readonly { itemId: ItemId; quantity: number }[],
  itemId: ItemId,
  quantity = 1,
): boolean {
  return inventory.some((stack) => stack.itemId === itemId && stack.quantity >= quantity);
}