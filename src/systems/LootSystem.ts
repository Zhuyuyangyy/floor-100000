import { containerItemKey, generateFloor, getFloorTemplate } from '../data/floorTemplates';
import { addItem, countItem, removeItem } from './InventorySystem';
import { getItem } from '../data/items';
import { deriveSeed, makeRng } from '../core/rng';
import { GAME_CONFIG } from '../core/config';
import type { GameState, GeneratedFloor, InventoryStack, ItemId } from '../core/gameTypes';

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
  return {
    ...base,
    containers: base.containers.map((c) => ({ ...c, items: containerLooted(c.id, c.items, looted) })),
    groundItems: base.groundItems.filter((g) => !looted?.has(g.key) && !leakHere),
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

// ── the bunk rows ─────────────────────────────────────────────────────────
//
// A dormitory floor is ranks of bunks, and every bunk is something to bend over:
// a mattress to search, a frame to break up for wood. That makes a bed a second
// kind of lootable, next to containers — except a bed is not a container. It is
// not in generateFloor's layout, it has no `c:` key, and it does not belong in
// visitedFloors.openedContainers (that list is what "已取" on the map reads).
//
// So beds get their own key namespace inside lootedItems:
//
//   bunksearch:<floor>:<bunkId>:<day>   searched today — resets tomorrow
//   bunkgone:<floor>:<bunkId>           dismantled — permanent, never comes back
//
// All rolls go through the seeded RNG, so the same (runSeed, floor, bunk, day)
// always pays out the same. Nothing here uses Math.random: a reload must not
// reroll a bed, or "search it tomorrow" becomes "reload until it pays".

const BUNKS = GAME_CONFIG.bunks;

/** Game-minutes to search one bed (config/game-balance.json bunks.searchCostMinutes). */
export const BUNK_SEARCH_COST = BUNKS.searchCostMinutes;
/** Game-minutes to break one bed up. */
export const BUNK_DISMANTLE_COST = BUNKS.dismantleCostMinutes;

/** Has this bed been searched today? The key carries the day — tomorrow it is a fresh bed. */
export const bunkSearchKey = (floor: number, bunkId: string, day: number): string =>
  `bunksearch:${floor}:${bunkId}:${day}`;
/** Has this bed been dismantled? No day in the key — it never comes back. */
export const bunkGoneKey = (floor: number, bunkId: string): string => `bunkgone:${floor}:${bunkId}`;

export function isBunkSearched(state: GameState, floor: number, bunkId: string): boolean {
  return state.visitedFloors[floor]?.lootedItems.includes(bunkSearchKey(floor, bunkId, state.day)) ?? false;
}

export function isBunkDismantled(state: GameState, floor: number, bunkId: string): boolean {
  return state.visitedFloors[floor]?.lootedItems.includes(bunkGoneKey(floor, bunkId)) ?? false;
}

/**
 * The first tool in the bag that can break a bunk frame, or null.
 *
 * Deliberately narrow (config/game-balance.json bunks.dismantleTools). A frame
 * that is pegged and screwed together comes apart with a crowbar. Letting every
 * blade in the game open it would collapse the distinction between "a weapon"
 * and "a tool", which is the whole reason tools exist in this kit. Tools are
 * equipment, not consumables: the crowbar is still there afterwards.
 *
 * The upstream line also accepts a fire axe; this branch has no such item, and
 * listing an id that `items.ts` does not define would make the check silently
 * dead. One real tool is honest; two where one does not exist is not.
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
  /** Already searched today — no fresh roll, no time charged. */
  already: boolean;
}

/**
 * Search one bunk: roll the under-mattress table, move what fits into the bag,
 * mark it searched for today.
 *
 * A bag that fills up mid-roll keeps what already went in and does not force the
 * rest (same rule as lootContainer: dropping something is worse than not fitting
 * it). `full` is reported and the caller says so.
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
  // Only a search that actually reached a verdict counts. If the bag was too
  // full to take a single thing, the roll is not spent — clear a slot and come
  // back the same day.
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
 * Break one bunk up: wood and cloth, and the bed is gone from then on.
 *
 * Two deliberate differences from searching:
 *   1. It needs a tool — refuses with a reason naming what is missing.
 *   2. All or nothing. A one-shot action must not be half-swallowed by a full
 *      bag: if any stack does not fit, every stack is rolled back and the bed is
 *      NOT marked, so the player clears a slot and comes back to a bed that is
 *      still standing.
 */
export function dismantleBunk(state: GameState, floor: number, bunkId: string): BunkDismantleResult {
  if (isBunkDismantled(state, floor, bunkId)) return { ok: false, reason: '这床已经拆掉了', took: [], full: false };
  if (!bunkDismantleTool(state.player.inventory)) {
    return { ok: false, reason: '赤手拆不了床架，需要撬棍', took: [], full: false };
  }
  const visit = recordFloorVisit(state, floor);
  const rng = makeRng(deriveSeed('bunk-gone', state.runSeed, floor, bunkId));
  const took: InventoryStack[] = [];
  for (const spec of BUNKS.dismantleYield) {
    const quantity = rng.nextInt(spec.min, spec.max);
    const result = addItem(state.player.inventory, spec.itemId as ItemId, quantity);
    if (result.overflow > 0) {
      // None of it: roll back this stack and everything already taken, leave the
      // bed standing so it can be tried again.
      removeItem(state.player.inventory, spec.itemId as ItemId, result.added);
      for (const s of took) removeItem(state.player.inventory, s.itemId, s.quantity);
      return { ok: false, reason: '背包已满：拆下的材料放不下，先腾包', took: [], full: true };
    }
    took.push({ itemId: spec.itemId as ItemId, quantity });
  }
  visit.lootedItems.push(bunkGoneKey(floor, bunkId));
  return { ok: true, took, full: false };
}
