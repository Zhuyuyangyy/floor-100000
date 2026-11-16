import { containerItemKey, generateFloor, getFloorTemplate } from '../data/floorTemplates';
import { addItem, countItem, removeItem } from './InventorySystem';
import { getItem } from '../data/items';
import { deriveSeed, makeRng } from '../core/rng';
import type { GameState, GeneratedFloor, InventoryStack, ItemId } from '../core/gameTypes';
import { FLOOR_WIDTH, floorWidthFor } from '../core/constants';
import balance from '../../config/game-balance.json' with { type: 'json' };

// Turns looting into GameState so a saved + reloaded game never re-spawns loot
// (docs/03_TASKS.md#p0-03). visitedFloors[floor].lootedItems stores stable keys;
// getFloorView removes them from the deterministic base layout.

// Standing on a floor is what makes it explored. The tower's colouring reads
// visitedFloors, and this used to run on the loot paths only, so a floor the
// player simply walked through left no record and the map could not tell
// "passed by" from "never been" (B3-02 §4.3, GAME_DESIGN_LOCK.md §2.6).
export function recordFloorVisit(state: GameState, floor: number) {
  let visit = state.visitedFloors[floor];
  if (!visit) {
    visit = { openedContainers: [], lootedItems: [], unlockedDoors: [], localEvents: [] };
    state.visitedFloors[floor] = visit;
  }
  return visit;
}

// Which loot entries of a container the player has already taken.
const containerLooted = (containerId: string, items: InventoryStack[], looted: Set<string> | null): InventoryStack[] =>
  looted ? items.filter((s) => !looted.has(containerItemKey(containerId, s.itemId))) : items;

// The floor as the player currently sees it: base layout minus looted items, and
// with loose ground supplies spoiled by a leak on this floor.
export function getFloorView(state: GameState, floor: number): GeneratedFloor {
  const base = generateFloor(state.runSeed, floor);
  const event = state.worldEvents.activeEvent;
  const leakHere = event?.type === 'leak' && event.floor === floor;
  const visit = state.visitedFloors[floor];
  const looted = visit ? new Set(visit.lootedItems) : null;
  // Templates author their x on the base 1280 grid; a longer floor spreads them
  // across its own width so the last bay is not empty. Scaled here, once, so
  // every consumer (drawing, interaction, labels) sees the same number.
  const k = floorWidthFor(floor) / FLOOR_WIDTH;
  const sx = (x: number): number => (k === 1 ? x : Math.round(x * k));
  return {
    ...base,
    containers: base.containers.map((c) => ({ ...c, x: sx(c.x), items: containerLooted(c.id, c.items, looted) })),
    groundItems: base.groundItems
      .filter((g) => !looted?.has(g.key) && !leakHere)
      .map((g) => ({ ...g, x: sx(g.x) })),
  };
}

export interface LootResult {
  took: InventoryStack[];
  full: boolean;
}

// Opens a container, moving whole stacks into the bag. If a stack doesn't fully
// fit, it (and the rest) are left untouched and `full` is reported — nothing is
// lost or silently swallowed.
export function lootContainer(state: GameState, floor: number, containerId: string): LootResult {
  const base = generateFloor(state.runSeed, floor);
  const baseContainer = base.containers.find((c) => c.id === containerId);
  const visit = recordFloorVisit(state, floor);
  const looted = new Set(visit.lootedItems);
  const took: InventoryStack[] = [];
  let full = false;

  if (baseContainer) {
    for (const stack of baseContainer.items) {
      if (full) break;
      const key = containerItemKey(containerId, stack.itemId);
      if (looted.has(key)) continue;
      const result = addItem(state.player.inventory, stack.itemId, stack.quantity, stack.meta);
      if (result.overflow === 0) {
        looted.add(key);
        took.push({ ...stack });
      } else {
        removeItem(state.player.inventory, stack.itemId, result.added); // undo partial add
        full = true;
      }
    }
  }

  visit.lootedItems = [...looted];
  if (!visit.openedContainers.includes(containerId)) visit.openedContainers.push(containerId);
  return { took, full };
}

// What the tower map tells the player is on a floor, so a trip can be planned
// rather than guessed.
//
// Reads the RESOLVED view, never the loot table. The table lists probability rolls
// whether or not they paid out for this seed, so the map used to advertise 布料 in
// floor 1's cabinet on every seed — including the ones where the 60% roll failed
// and the cloth was never there. Reading the view also drops stacks the player has
// already taken, which is the other half of planning a return trip.
export function describeFloorContents(state: GameState, floor: number): string {
  if (!getFloorTemplate(floor)) return '内容：未生成（B4 程序化楼层）';
  const view = getFloorView(state, floor);
  const parts: string[] = [];
  for (const c of view.containers) {
    const looted = state.visitedFloors[floor]?.openedContainers.includes(c.id) ?? false;
    const unique = [...new Set(c.items.map((i) => getItem(i.itemId).displayName))];
    parts.push(`${c.label}${looted ? '(已取)' : ''}：${unique.join('·') || '空'}`);
  }
  if (view.groundItems.length > 0) {
    parts.push(`地面：${[...new Set(view.groundItems.map((g) => getItem(g.itemId).displayName))].join('·')}`);
  }
  return parts.length > 0 ? parts.join('　') : '内容：空';
}

// Picks up a single ground item on contact. Returns full=true (item stays) if
// the bag cannot hold it.
export function lootGround(
  state: GameState,
  floor: number,
  key: string,
): { took: InventoryStack | null; full: boolean } {
  // Read through the same view the scene renders from, so a leak spoiling this
  // floor's loose supplies hides them here too — reading the raw layout let a
  // "受潮" item go straight into the bag (GHI-03 M5).
  const ground = getFloorView(state, floor).groundItems.find((g) => g.key === key);
  if (!ground) return { took: null, full: false };
  const visit = recordFloorVisit(state, floor);
  if (visit.lootedItems.includes(key)) return { took: null, full: false };
  const result = addItem(state.player.inventory, ground.itemId, ground.quantity, ground.meta);
  if (result.overflow > 0) {
    removeItem(state.player.inventory, ground.itemId, result.added);
    return { took: null, full: true };
  }
  visit.lootedItems.push(key);
  return { took: { itemId: ground.itemId, quantity: ground.quantity }, full: false };
}

// ── AG-51：床铺搜刮 / 拆解 ───────────────────────────────────────────────
// 1 层宿舍的床（自己的床 + 室友的床）不是容器：generateFloor 不认识它们，
// 楼层视图里没有它们的一行。搜刮状态因此不住 openedContainers/lootedItems 的
// 容器键空间（containerItemKey 的 `c:` 前缀），而是两个自带前缀的键，住在
// visitedFloors[floor].lootedItems 里——与容器的「已取」标记共用同一个数组，
// 但前缀不同永不撞键，存档/读档白拿持久性。
//
// 为什么按天：用户要的「翻过就翻不出来，或每天一次」取后者——每天一次让床
// 变成可回访的小补给点，又不是无限提款机。拆解是按床一次性的，键里不带天。
//
// 概率全部走 seeded RNG（docs/02_TECH_SPEC.md §3：禁 Math.random）：
// 同 (runSeed, floor, bunkId, day) 同结果，重进楼层不重 roll、换 seed 才换手气。

interface BunkLootSpec {
  itemId: string;
  min: number;
  max: number;
  probability?: number;
}

interface BunkBalance {
  searchCostMinutes: number;
  dismantleCostMinutes: number;
  searchLoot: BunkLootSpec[];
  dismantleTools: string[];
  dismantleYield: BunkLootSpec[];
}

// config/game-balance.json 的 bunks 段（AG-51 自己这条线的键）。绕过
// core/config.ts 的 GameBalanceConfig 直读 JSON：接口属主在 core，本工单
// 不碰；JSON 导入的推断类型自带全部键，as 一下即可，缺键会在第一次调用时
// 以 undefined 炸出来，比静默走默认值诚实。
const BUNKS = (balance as unknown as { bunks: BunkBalance }).bunks;

/** 翻一张床的游戏分钟数（game-balance.json 的 bunks.searchCostMinutes）。 */
export const BUNK_SEARCH_COST = BUNKS.searchCostMinutes;
/** 拆一张床的游戏分钟数。 */
export const BUNK_DISMANTLE_COST = BUNKS.dismantleCostMinutes;

/** 今天这张床翻过了没有。键带天——明天是一张新床。 */
export const bunkSearchKey = (floor: number, bunkId: string, day: number): string => `bunksearch:${floor}:${bunkId}:${day}`;
/** 这张床拆掉了没有（一次性，键不带天）。 */
export const bunkGoneKey = (floor: number, bunkId: string): string => `bunkgone:${floor}:${bunkId}`;

export function isBunkSearched(state: GameState, floor: number, bunkId: string): boolean {
  return state.visitedFloors[floor]?.lootedItems.includes(bunkSearchKey(floor, bunkId, state.day)) ?? false;
}

export function isBunkDismantled(state: GameState, floor: number, bunkId: string): boolean {
  return state.visitedFloors[floor]?.lootedItems.includes(bunkGoneKey(floor, bunkId)) ?? false;
}

/**
 * 背包里第一件能拆床的工具，没有返回 null。
 *
 * 为什么是撬棍和消防斧：拆床架要么撬（crowbar，v0.1 就在册、3 层铁箱
 * guaranteed），要么砍（fire_axe，武器分支的重器）。匕首/短剑是搏命用的
 * 刺刀，砍刀是厨具——三件刃具都拆不动榫死的木床架，给它们开这个口子
 * 等于「任何武器都是万能工具」，工具的角色就糊了。工具不消耗：它们是
 * 装备不是耗材，撬完棍还在。
 */
export function bunkDismantleTool(inventory: GameState['player']['inventory']): ItemId | null {
  for (const id of BUNKS.dismantleTools) {
    if (countItem(inventory, id as ItemId) > 0) return id as ItemId;
  }
  return null;
}

export interface BunkSearchResult {
  took: InventoryStack[];
  full: boolean;
  /** 今天已经翻过了——没有新掷、没有扣时间 */
  already: boolean;
}

/**
 * 翻一张床：按 seeded RNG 滚床垫下表，能进包的在 `took` 里回报，标记今天翻过。
 * 背包在半路满掉时，已入包的留下、剩下的不硬塞（与 lootContainer 同语义：
 * 丢东西比装不下更糟），full 回报后调用方自己说「放不下」。
 */
export function searchBunk(state: GameState, floor: number, bunkId: string): BunkSearchResult {
  const visit = recordFloorVisit(state, floor);
  const key = bunkSearchKey(floor, bunkId, state.day);
  if (visit.lootedItems.includes(key)) return { took: [], full: false, already: true };
  const rng = makeRng(deriveSeed('bunk-search', state.runSeed, floor, bunkId, state.day));
  const took: InventoryStack[] = [];
  let full = false;
  for (const spec of BUNKS.searchLoot) {
    if (full) break;
    if (!rng.chance(spec.probability ?? 1)) continue;
    const quantity = rng.nextInt(spec.min, spec.max);
    const result = addItem(state.player.inventory, spec.itemId as ItemId, quantity);
    if (result.overflow === 0) {
      took.push({ itemId: spec.itemId as ItemId, quantity });
    } else {
      removeItem(state.player.inventory, spec.itemId as ItemId, result.added); // undo partial add
      full = true;
    }
  }
  // 翻出过东西（或床本来就只有灰）才算翻过：一样没进包是「没翻成」，
  // 不标记——今天的 roll 不被一个满背包吞掉，腾出包当天还能再来。
  if (full && took.length === 0) return { took, full, already: false };
  visit.lootedItems.push(key);
  return { took, full, already: false };
}

export interface BunkDismantleResult {
  ok: boolean;
  reason?: string;
  took: InventoryStack[];
  full: boolean;
}

/**
 * 拆一张床：木材 + 布料，床就此消失（调用方画残骸/清对象）。
 * 与搜刮的两个刻骨差别：
 *   1. 要工具——bunkDismantleTool 为 null 时拒绝，理由说清缺什么；
 *   2. 全有或全无——一次性动作不能因为背包满就被吞掉：任何一件放不下，
 *      全部 undo、不标记拆过，床留着，玩家腾出包再来。
 */
export function dismantleBunk(state: GameState, floor: number, bunkId: string): BunkDismantleResult {
  if (isBunkDismantled(state, floor, bunkId)) return { ok: false, reason: '这床已经拆掉了', took: [], full: false };
  if (!bunkDismantleTool(state.player.inventory)) {
    return { ok: false, reason: '赤手拆不了床架，需要撬棍或消防斧', took: [], full: false };
  }
  const visit = recordFloorVisit(state, floor);
  const rng = makeRng(deriveSeed('bunk-gone', state.runSeed, floor, bunkId));
  const took: InventoryStack[] = [];
  for (const spec of BUNKS.dismantleYield) {
    const quantity = rng.nextInt(spec.min, spec.max);
    const result = addItem(state.player.inventory, spec.itemId as ItemId, quantity);
    if (result.overflow > 0) {
      // 全无：连本件带已入包的全部退回，床不标记，下次还能拆。
      removeItem(state.player.inventory, spec.itemId as ItemId, result.added);
      for (const s of took) removeItem(state.player.inventory, s.itemId, s.quantity);
      return { ok: false, reason: '背包已满：拆下的材料放不下，先腾包', took: [], full: true };
    }
    took.push({ itemId: spec.itemId as ItemId, quantity });
  }
  visit.lootedItems.push(bunkGoneKey(floor, bunkId));
  return { ok: true, took, full: false };
}
