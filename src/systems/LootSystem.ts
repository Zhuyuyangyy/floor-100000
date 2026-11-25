import { containerItemKey, generateFloor, getFloorTemplate } from '../data/floorTemplates';
import { addItem, removeItem } from './InventorySystem';
import { getItem } from '../data/items';
import type { GameState, GeneratedFloor, InventoryStack } from '../core/gameTypes';

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
