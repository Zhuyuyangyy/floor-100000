// NPC 真实库存（阶段 C，docs/plans/NPC.md）：库存有数量、会耗尽、会补充，
// 并存进 GameState.npcStates[npcId] 的 JSON 里随存档持久化。
//
// 设计铁律（与 RFC §5 一致）：
// - 纯函数、无 Phaser、无网络：所有变更返回新对象，调用方写回 npcStates。
// - 不修改 SaveSystem：inventory 只是 NpcPersistedState 的一个可选字段，
//   SaveSystem 只把 npcStates 当不透明 JSON 字符串校验，天然兼容。
// - 老存档没有该字段 → 按静态报价表推导的默认库存补建，绝不崩。
// - 确定性：补货/消耗都是 lastRestockDay 与 day 的纯函数，同输入同结果，
//   不依赖任何推理时序。

import type { GameState, ItemId } from '../core/gameTypes';
import type { NpcDef } from '../data/npcs';
import { getItem } from '../data/items';
import { ARCHETYPES } from '../data/npcPersonalities';
import type { NpcInventory, NpcPersistedState, NpcStockEntry } from './types';
import { loadNpcState, saveNpcState } from '../systems/NpcMemory';

/** 开店库存：每份报价物品备 2 件。备 2 件是为了 trusted 的「双倍货」
 *  从第 1 天就兑得现（否则关系最好的玩家反而最先遇到「下架」）。 */
const OPENING_STOCK = 2;

/** 由静态报价表推导默认库存：每个报价的 give 物品各两份，可补货。 */
export function defaultNpcInventory(npc: NpcDef, day: number): NpcInventory {
  const totals = new Map<ItemId, number>();
  for (const offer of npc.offers) {
    totals.set(offer.give.itemId, (totals.get(offer.give.itemId) ?? 0) + offer.give.quantity * OPENING_STOCK);
  }
  return {
    entries: [...totals.entries()].map(([itemId, quantity]) => ({
      itemId,
      quantity,
      max: quantity * 3,
      restockPerDay: 1,
    })),
    lastRestockDay: day,
  };
}

/** 赠品入库的默认上限：玩家送的东西 NPC 不会量产，补货量为 0。 */
const GIFT_MAX = 9;

/** 当前持有量。没有该物品返回 0。 */
export function stockOf(inventory: NpcInventory, itemId: ItemId): number {
  return inventory.entries.find((e) => e.itemId === itemId)?.quantity ?? 0;
}

/** 取出（交易出货）。数量不足时按实际可取数量取，绝不超取。 */
export function takeFromStock(inventory: NpcInventory, itemId: ItemId, quantity: number): NpcInventory {
  const want = Math.max(0, Math.floor(quantity));
  return {
    ...inventory,
    entries: inventory.entries.map((e) =>
      e.itemId === itemId ? { ...e, quantity: Math.max(0, e.quantity - want) } : e,
    ),
  };
}

/** 存入（玩家赠品、拾获）。新物品按赠品规则入账：有上限、不补货。 */
export function giveToStock(inventory: NpcInventory, itemId: ItemId, quantity: number): NpcInventory {
  const add = Math.max(0, Math.floor(quantity));
  if (add === 0) return inventory;
  const existing = inventory.entries.find((e) => e.itemId === itemId);
  if (!existing) {
    const entry: NpcStockEntry = { itemId, quantity: Math.min(add, GIFT_MAX), max: GIFT_MAX, restockPerDay: 0 };
    return { ...inventory, entries: [...inventory.entries, entry] };
  }
  return {
    ...inventory,
    entries: inventory.entries.map((e) =>
      e.itemId === itemId ? { ...e, quantity: Math.min(e.max, e.quantity + add) } : e,
    ),
  };
}

/** 该 NPC 对某物品的每日消耗量（来自 data/npcs.ts 的 needs）。 */
export function consumePerDay(npc: NpcDef, itemId: ItemId): number {
  return npc.needs?.find((n) => n.itemId === itemId)?.perDay ?? 0;
}

/**
 * 按天结算：先扣需求消耗，再按 restockPerDay 补货（封顶 max）。
 * 同日重复调用是恒等操作（lastRestockDay 不变即原样返回）；
 * 离开多天则补足这些天的量——离开越久库存越满，符合「店老板每天进货」。
 */
export function advanceNpcInventory(inventory: NpcInventory, npc: NpcDef, day: number): NpcInventory {
  const days = Math.floor(day) - inventory.lastRestockDay;
  if (days <= 0) return inventory;
  const entries = inventory.entries.map((e) => {
    const consumed = Math.max(0, e.quantity - consumePerDay(npc, e.itemId) * days);
    const restocked = Math.min(e.max, consumed + e.restockPerDay * days);
    return { ...e, quantity: restocked };
  });
  return { entries, lastRestockDay: Math.floor(day) };
}

/** NPC 的库存：持久状态里带了就用（含玩家赠品），没有则按报价表补默认值。 */
export function inventoryOf(npcState: NpcPersistedState, npc: NpcDef, day: number): NpcInventory {
  return npcState.inventory ?? defaultNpcInventory(npc, day);
}

/** 把库存写回持久状态（纯函数，返回新状态）。 */
export function withInventory(npcState: NpcPersistedState, inventory: NpcInventory): NpcPersistedState {
  return { ...npcState, inventory };
}

/**
 * 惰性按天结算：读取 NPC 状态时若发现库存落后于当前游戏日，
 * 就地补消耗+补货并写回 npcStates。这样场景无需在换天钩子里接线，
 * 老存档也会在第一次读取时自动补齐（缺字段给默认值，不崩）。
 */
export function syncNpcInventory(
  state: GameState,
  npc: NpcDef,
): { npcState: NpcPersistedState; inventory: NpcInventory; changed: boolean } {
  const loaded = loadNpcState(state, npc.id) ?? freshStateFor(npc, state.day);
  const current = inventoryOf(loaded, npc, state.day);
  const advanced = advanceNpcInventory(current, npc, state.day);
  if (advanced === current) return { npcState: loaded, inventory: current, changed: false };
  const npcState = withInventory(loaded, advanced);
  saveNpcState(state, npc.id, npcState);
  return { npcState, inventory: advanced, changed: true };
}

/** 首次遇到：新建持久状态并挂上默认库存。traits 取该人格原型的配置
 *  （阿林是 ally：记恩放大系数高——之前硬编码一套中性 traits 会让
 *  关系变化量与原型设计脱节）。 */
export function freshStateFor(npc: NpcDef, day: number): NpcPersistedState {
  const archetype = archetypeOf(npc);
  return {
    archetype,
    traits: { ...ARCHETYPES[archetype].traits },
    goal: npc.schedule?.[0]?.goal ?? '安稳过天',
    relationship: {},
    memory: [],
    mood: 0,
    inventory: defaultNpcInventory(npc, day),
  };
}

// 与 ai/config.ts 的 archetypeForNpcId 同规则；此处不 import 配置模块，
// 避免库存模块牵连推理配置（保持纯逻辑依赖）。
function archetypeOf(npc: NpcDef): NpcPersistedState['archetype'] {
  if (npc.id === 'alin') return 'ally';
  if (npc.id === 'xiaozhou') return 'neutral';
  return 'neutral';
}

/** 库存条目的可读摘要（日志/测试用）。 */
export function describeInventory(inventory: NpcInventory): string {
  if (inventory.entries.length === 0) return '（空）';
  return inventory.entries.map((e) => `${getItem(e.itemId).displayName}×${e.quantity}`).join('，');
}
