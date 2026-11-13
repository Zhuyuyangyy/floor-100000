// 规则执行器：AI 行动建议的合法性裁决（RFC §4 护栏 1）。
//
// AI 产出的一切建议在这里过检，通过才允许进入游戏执行路径；不通过则
// 调用方降级到选项树。执行器不 import 任何推理/网络代码，只依赖现有
// 纯逻辑系统（背包、交易、时钟），保证可在 Node 下单测。

import type { GameState, ItemId, InventoryStack } from '../core/gameTypes';
import { countItem } from '../systems/InventorySystem';
import { canFit } from '../systems/TradeSystem';
import { isItemId, getItem } from '../data/items';
import { isNight } from '../systems/SurvivalSystem';
import { ARCHETYPE_ACTIONS } from '../data/npcPersonalities';
import type { NpcAction, NpcActionProposal, NpcArchetype } from './types';

export type ValidatedAction =
  | { ok: true; action: NpcAction; utterance?: string }
  | { ok: false; reason: string };

/** NPC 在执行器眼中的最小事实集，由调用方从 data/npcs.ts 等处填充。 */
export interface NpcFact {
  id: string;
  archetype: NpcArchetype;
  floor: number;
  x: number;
  hp: number;
  /** NPC 当前持有物。第一阶段由静态报价表推导（见 npcInventory.ts）。 */
  inventory: InventoryStack[];
}

/** 低于该置信度的建议一律不信，降级选项树。 */
export const MIN_CONFIDENCE = 0.5;
/** 置信度是概率：大于 1 同样是模型没守契约。 */
export const MAX_CONFIDENCE = 1;
/** AI 台词长度上限，超出截断而非拒绝（台词短了不致命）。 */
export const MAX_UTTERANCE = 60;

function isPlainQuantity(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1;
}

/** 去掉控制字符并按长度截断。空串返回 undefined（当作没说）。 */
export function sanitizeUtterance(raw: string | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (cleaned.length === 0) return undefined;
  return cleaned.length > MAX_UTTERANCE ? cleaned.slice(0, MAX_UTTERANCE) : cleaned;
}

function npcHas(inv: InventoryStack[], itemId: ItemId, quantity: number): boolean {
  return countItem({ slotCount: inv.length, slots: inv }, itemId) >= quantity;
}

// 敌对行动的门控：只有敌对原型可以发起，且必须落在游戏既有的危险规则里
// （夜间，或玩家在该层逗留过久触发停留压力）——AI 不能自造攻击窗口。
function attackWindowOpen(state: GameState, npc: NpcFact): { open: boolean; reason: string } {
  if (npc.archetype !== 'hostile') return { open: false, reason: '非敌对原型不得提议攻击' };
  if (npc.floor !== state.currentFloor) return { open: false, reason: '目标不在同一层' };
  const night = isNight(state.gameMinuteOfDay);
  const dwell = state.worldEvents.dwell;
  const dwellPressure = dwell !== undefined && dwell.floor === npc.floor && dwell.rolls > 0;
  if (!night && !dwellPressure) return { open: false, reason: '当前不在敌对行为窗口（夜间或停留压力）' };
  return { open: true, reason: '' };
}

function validateTrade(state: GameState, npc: NpcFact, action: Extract<NpcAction, { type: 'trade' }>): string | null {
  const { give, get } = action;
  if (!isItemId(give.itemId) || !isItemId(get.itemId)) return '交易包含未知物品';
  if (!isPlainQuantity(give.quantity) || !isPlainQuantity(get.quantity)) return '交易数量无效';
  if (give.quantity > getItem(give.itemId).maxStack) return '交易数量超过堆叠上限';
  if (!npcHas(npc.inventory, give.itemId, give.quantity)) return `NPC 没有足够的${getItem(give.itemId).displayName}`;
  if (countItem(state.player.inventory, get.itemId) < get.quantity) {
    return `玩家没有足够的${getItem(get.itemId).displayName}`;
  }
  if (!canFit(state.player.inventory, give.itemId, give.quantity)) return '玩家背包空间不足';
  return null;
}

function validateGift(state: GameState, npc: NpcFact, action: Extract<NpcAction, { type: 'gift' }>): string | null {
  if (!isItemId(action.itemId)) return '给予未知物品';
  if (!isPlainQuantity(action.quantity)) return '给予数量无效';
  if (action.quantity > getItem(action.itemId).maxStack) return '给予数量超过堆叠上限';
  if (!npcHas(npc.inventory, action.itemId, action.quantity)) return `NPC 没有足够的${getItem(action.itemId).displayName}`;
  if (!canFit(state.player.inventory, action.itemId, action.quantity)) return '玩家背包空间不足';
  return null;
}

/**
 * 裁决一条 AI 建议。 ok=true 时 action 已可交给现有执行路径
 * （trade() 等）落地；ok=false 时 reason 供日志/测试断言，调用方降级。
 */
export function validateProposal(
  state: GameState,
  npc: NpcFact,
  proposal: NpcActionProposal,
): ValidatedAction {
  const utterance = sanitizeUtterance(proposal.utterance);
  // NaN 也是 number，只比大小会漏过去；先挡非有限值。
  // 上界同样重要：confidence 是概率，>1 说明模型没守契约。
  if (!Number.isFinite(proposal.confidence) || proposal.confidence < MIN_CONFIDENCE || proposal.confidence > MAX_CONFIDENCE) {
    return { ok: false, reason: `置信度越界（${String(proposal.confidence)}，应在 ${MIN_CONFIDENCE}–${MAX_CONFIDENCE}）` };
  }
  const action = proposal.action;
  if (!action || typeof action !== 'object' || typeof (action as { type?: unknown }).type !== 'string') {
    return { ok: false, reason: '建议缺少合法 action.type' };
  }
  // 人格白名单：模型不能提出该原型根本没有的行动（如合作型提议攻击）。
  // 与运行时的 availableActions 检查构成双重防线。
  if (!ARCHETYPE_ACTIONS[npc.archetype].includes(action.type as NpcAction['type'])) {
    return { ok: false, reason: `原型 ${npc.archetype} 不允许 ${String((action as { type: unknown }).type)}` };
  }
  switch (action.type) {
    case 'dialogue': {
      // 台词走 action.text（对话本身的内容）；sanitize 后为空则占位，
      // 保证交互永远有可显示的一行。
      const text = sanitizeUtterance(action.text) ?? '……';
      return { ok: true, action: { type: 'dialogue', text }, utterance };
    }
    case 'refuse':
      return { ok: true, action: { type: 'refuse' }, utterance };
    case 'flee':
      return { ok: true, action: { type: 'flee' }, utterance };
    case 'trade': {
      const reason = validateTrade(state, npc, action);
      return reason ? { ok: false, reason } : { ok: true, action, utterance };
    }
    case 'gift': {
      const reason = validateGift(state, npc, action);
      return reason ? { ok: false, reason } : { ok: true, action, utterance };
    }
    case 'attack': {
      const window = attackWindowOpen(state, npc);
      return window.open ? { ok: true, action, utterance } : { ok: false, reason: window.reason };
    }
    default:
      return { ok: false, reason: `未知行动类型 ${String((action as { type: unknown }).type)}` };
  }
}
