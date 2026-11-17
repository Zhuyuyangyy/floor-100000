import { containerItemKey, generateFloor, getFloorTemplate } from '../data/floorTemplates';
import { addItem, countItem, removeItem } from './InventorySystem';
import { getItem } from '../data/items';
import { deriveSeed, makeRng } from '../core/rng';
import type { GameState, GeneratedFloor, InventoryStack, ItemId } from '../core/gameTypes';
import { ENTRY_X, FLOOR_WIDTH, STARTING_FLOOR, UP_EXIT_X, downExitXFor, floorWidthFor } from '../core/constants';
import { liftDirection } from '../core/segments';
import { hasDownExit, hasUpExit } from './FloorSystem';
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

// ── AG-66：过道阻碍物（瓦砾堆 / 锈闸门）────────────────────────────────
//
// 用户原话：「这个过道应该有阻碍物，就是用铲子等工具才能挖完才能进去」。
// 每层过道上 seeded 放 0-2 个阻碍物，占位处玩家的横向移动被钳断，想过去
// 必须背包里有铲子（或撬棍）花 digMs 毫秒挖掉。阻碍物不是容器：generateFloor
// 不认识它们，因此与 AG-51 的床同模式——位置走 seeded RNG（同 (runSeed, 层)
// 同结果），「挖过了」记 visitedFloors[floor].lootedItems 的 obstacle:<层>:<x>
// 键（容器键空间是 containerItemKey 的 c: 前缀，床是 bunksearch:/bunkgone:，
// 这条前缀永不撞键），回层不复活。
//
// 三条硬规则（全部在本文件的纯函数里，obstacles.test.ts 逐条钉死）：
//   1. 避让——梯口（上下楼口）、电梯、楼层入口、容器、地面物各留 keepClear；
//   2. 可通——从楼层入口 ENTRY_X 出发至少还有一个出口可达，否则从后往前删，
//      阻碍物永远不可能把玩家软锁在层里（GAME_DESIGN_LOCK §5 禁软锁）；
//   3. 有解——清理工具是铲子或撬棍（撬棍 3 层铁箱 guaranteed，早期楼层也
//      摸得到），不是只有一把要合成的铲子。

export type ObstacleKind = 'rubble' | 'gate';

/** 过道上的一个阻碍物。x 是世界像素（楼层视图同口径，已按层宽缩放）。 */
export interface FloorObstacle {
  kind: ObstacleKind;
  x: number;
}

interface ObstacleBalance {
  maxPerFloor: number;
  firstChance: number;
  secondChance: number;
  kindWeights: Record<ObstacleKind, number>;
  blockHalfWidth: number;
  keepClear: number;
  digMs: number;
  digCostMinutes: number;
  tools: string[];
  liftX: number;
}

// config/game-balance.json 的 obstacles 段（AG-66 自己这条线的键）。与 BUNKS
// 同款：绕过 core/config.ts 的 GameBalanceConfig 直读 JSON（接口属主在 core，
// 本工单不碰），缺键会在第一次调用时以 undefined 炸出来。
const OBSTACLES = (balance as unknown as { obstacles: ObstacleBalance }).obstacles;

/** 挖开/撬开一个阻碍物的动作时长（毫秒）。 */
export const OBSTACLE_DIG_MS = OBSTACLES.digMs;
/** 清理一个阻碍物的游戏分钟数。 */
export const OBSTACLE_DIG_COST_MINUTES = OBSTACLES.digCostMinutes;
/** 阻碍物的占位半宽（左右各这么宽都被拦住）。 */
export const OBSTACLE_BLOCK_HALF_WIDTH = OBSTACLES.blockHalfWidth;

/** 「挖过了」的存档键。与容器/床的键共用 lootedItems 数组，前缀不同永不撞。 */
export const obstacleKey = (floor: number, x: number): string => `obstacle:${floor}:${x}`;

export function isObstacleCleared(state: GameState, floor: number, x: number): boolean {
  return state.visitedFloors[floor]?.lootedItems.includes(obstacleKey(floor, x)) ?? false;
}

/** 记一个阻碍物为已挖开（幂等）。调用方负责随后的视觉残骸与存档。 */
export function clearObstacle(state: GameState, floor: number, x: number): void {
  const visit = recordFloorVisit(state, floor);
  const key = obstacleKey(floor, x);
  if (!visit.lootedItems.includes(key)) visit.lootedItems.push(key);
}

/**
 * 这一层的阻碍物全集（含已挖开的）。seeded：同 (runSeed, floor) 永远同结果，
 * 所以「挖过的回层不复活」只需记键，位置本身重进楼层自动复现。
 *
 * 1 层是宿舍（家）不过道，直接空；梯口/电梯/入口/容器/地面物的 keepClear
 * 之后再做一次可达性裁决（见下），保证不软锁。
 */
export function obstaclesForFloor(state: GameState, floor: number): FloorObstacle[] {
  if (floor === STARTING_FLOOR) return [];
  const half = OBSTACLES.blockHalfWidth;
  const keep = OBSTACLES.keepClear;
  const minX = UP_EXIT_X + keep;
  const maxX = downExitXFor(floor) - keep;
  if (maxX - minX < half * 4) return []; // 走廊放不下两个身位，不摆
  // 避让清单只放**稳定**的 x：梯口/电梯/入口是常量，容器列表随楼层模板恒定
  // （generateFloor 从不删容器，getFloorView 只改它的 items）。地面物刻意不进
  // 清单——lootedItems 会把它们从视图里抹掉，清单随搜刮漂移就意味着阻碍物
  // 的位置跨访问会变，「挖过的回层不复活」（obstacle 键）直接失效。地面物被
  // 挡住只是延迟可拾取：挖掉阻碍物后走回去照旧 autoPickup，不是断点。
  const view = getFloorView(state, floor);
  const keepClearXs: number[] = [
    UP_EXIT_X,
    downExitXFor(floor),
    OBSTACLES.liftX,
    ENTRY_X,
    ...view.containers.map((c) => c.x),
  ];
  const rng = makeRng(deriveSeed('obstacles', state.runSeed, floor));
  const out: FloorObstacle[] = [];
  const chances = [OBSTACLES.firstChance, OBSTACLES.secondChance];
  const count = Math.min(OBSTACLES.maxPerFloor, chances.length);
  for (let i = 0; i < count; i++) {
    if (!rng.chance(chances[i])) break; // 第一个没摇上就没有第二个
    let placed = false;
    for (let attempt = 0; attempt < 8 && !placed; attempt++) {
      const x = minX + rng.nextInt(0, Math.floor(maxX - minX));
      const kind: ObstacleKind = rng.nextFloat() < OBSTACLES.kindWeights.rubble ? 'rubble' : 'gate';
      if (keepClearXs.some((kx) => Math.abs(kx - x) < keep + half)) continue;
      if (out.some((o) => Math.abs(o.x - x) < half * 4)) continue; // 两个不叠
      out.push({ kind, x });
      placed = true;
    }
  }
  // 可达性裁决：从 ENTRY_X（电梯/首入/落地都是这个点）出发，至少还有一个
  // 出口不被阻碍区间截断。两个阻碍物把入口夹在中间时就该删——从后往前删，
  // 删到一个可达即止（保留多样性，又永不软锁）。
  const exits: number[] = [];
  if (hasUpExit(floor)) exits.push(UP_EXIT_X);
  if (hasDownExit(floor)) exits.push(downExitXFor(floor));
  if (liftDirection(floor) !== null) exits.push(OBSTACLES.liftX);
  const reachable = (to: number): boolean =>
    !out.some((o) => o.x - half > Math.min(ENTRY_X, to) && o.x + half < Math.max(ENTRY_X, to));
  while (out.length > 0 && !exits.some(reachable)) out.pop();
  return out;
}

/** 这一层还没挖掉的阻碍物（场景每帧钳位与 E 交互读的是这个）。 */
export function activeObstacles(state: GameState, floor: number): FloorObstacle[] {
  return obstaclesForFloor(state, floor).filter((o) => !isObstacleCleared(state, floor, o.x));
}

/** 交互距离内最近的一个未挖阻碍物（与 nearestContainer 同型的距离判官）。 */
export function nearestObstacle(active: readonly FloorObstacle[], playerX: number, maxDist: number): FloorObstacle | null {
  let best: FloorObstacle | null = null;
  let bestDist = maxDist;
  for (const o of active) {
    const d = Math.abs(o.x - playerX);
    if (d <= bestDist) {
      bestDist = d;
      best = o;
    }
  }
  return best;
}

/**
 * 把一帧移动的结果钳在阻碍物之外。纯函数：玩家永远进不去阻碍区间，贴着
 * 进来那一侧的边停（上一帧就在区间里——落地/传送——则取近的一侧出）。
 */
export function clampXAgainstObstacles(
  active: readonly FloorObstacle[],
  prevX: number,
  nextX: number,
  halfWidth: number = OBSTACLES.blockHalfWidth,
): number {
  let x = nextX;
  for (const o of active) {
    const lo = o.x - halfWidth;
    const hi = o.x + halfWidth;
    if (x > lo && x < hi) {
      x = prevX <= lo ? lo : prevX >= hi ? hi : x - lo <= hi - x ? lo : hi;
    }
  }
  return x;
}

/**
 * 背包里第一件能清阻碍物的工具，没有返回 null。
 *
 * 为什么是铲子和撬棍两件：铲子是本工单新增的专职工具（只能做出来），
 * 撬棍是 v0.1 就在册的破拆工具（3 层铁箱 guaranteed）——只认铲子的话，
 * 早期楼层可能整层摸不到也做不出，阻碍物就成了死墙。两件都能清两种阻碍
 * （铲子挖瓦砾、撬棍撬闸门，反过来也将就），工具不消耗。与拆床白名单
 * （撬棍+消防斧，bunkDismantleTool）同族：刃具不兼职工具。
 */
export function obstacleTool(inventory: GameState['player']['inventory']): ItemId | null {
  for (const id of OBSTACLES.tools) {
    if (countItem(inventory, id as ItemId) > 0) return id as ItemId;
  }
  return null;
}

/**
 * AG-66：搜刮动作时长（毫秒）——点容器/床铺后先播 search 动画等这么久才出货。
 * 数值进 config/game-balance.json 的 search.ms（GameScene 不硬编码）。
 */
interface SearchBalance {
  ms: number;
}
const SEARCH_BALANCE = (balance as unknown as { search: SearchBalance }).search;
export const SEARCH_MS = SEARCH_BALANCE.ms;
