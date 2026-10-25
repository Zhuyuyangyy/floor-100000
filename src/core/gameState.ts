import { GAME_CONFIG } from './config';
import { PLAYABLE_FLOORS_V01, SCHEMA_VERSION } from './constants';
import { getItem, isItemId } from '../data/items';
import type { GameState, Inventory, InventoryStack, ItemId } from './gameTypes';

export function createInventory(slotCount: number): Inventory {
  return { slotCount, slots: [] };
}

function sameMeta(a?: Record<string, string>, b?: Record<string, string>): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a[k] === b[k]);
}

// Adds items, stacking identical ids (respecting maxStack and meta). Throws when
// the 12-slot inventory is full — callers surface this as a "背包已满" hint.
export function addToInventory(
  inv: Inventory,
  itemId: ItemId,
  quantity: number,
  meta?: Record<string, string>,
): void {
  const item = getItem(itemId);
  let remaining = quantity;
  if (item.stackable) {
    for (const slot of inv.slots) {
      if (remaining === 0) return;
      if (slot.itemId === itemId && sameMeta(slot.meta, meta) && slot.quantity < item.maxStack) {
        const moved = Math.min(item.maxStack - slot.quantity, remaining);
        slot.quantity += moved;
        remaining -= moved;
      }
    }
  }
  while (remaining > 0) {
    if (inv.slots.length >= inv.slotCount) {
      throw new Error('inventory full');
    }
    const take = item.stackable ? Math.min(item.maxStack, remaining) : 1;
    const stack: InventoryStack = { itemId, quantity: take };
    if (meta) stack.meta = { ...meta };
    inv.slots.push(stack);
    remaining -= take;
  }
}

export function inventoryFromStartingItems(
  slotCount: number,
  startingItems: Array<{ itemId: string; quantity: number; batteryState?: string }>,
): Inventory {
  const inv = createInventory(slotCount);
  for (const spec of startingItems) {
    if (!isItemId(spec.itemId)) {
      throw new Error(`unknown starting itemId: ${spec.itemId}`);
    }
    const meta = spec.batteryState ? { batteryState: spec.batteryState } : undefined;
    addToInventory(inv, spec.itemId, spec.quantity, meta);
  }
  return inv;
}

// Fresh run: floor 100000, day 1 at 06:00, starting stats + items exactly from
// config/game-balance.json. A new seed yields a new runSeed.
export function createNewGame(seed: number): GameState {
  const cfg = GAME_CONFIG;
  const p = cfg.player;
  if (!PLAYABLE_FLOORS_V01.includes(p.startingFloor)) {
    throw new Error(`starting floor ${p.startingFloor} is not playable in v0.1`);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    runSeed: seed >>> 0,
    day: 1,
    gameMinuteOfDay: cfg.time.dayStartMinute,
    currentFloor: p.startingFloor,
    player: {
      hp: p.hpStart,
      hunger: p.hungerStart,
      thirst: p.thirstStart,
      energy: p.energyStart,
      inventory: inventoryFromStartingItems(cfg.inventory.slotCount, cfg.inventory.startingItems),
      equipped: null,
      homeUpgrades: [],
    },
    npcStates: {},
    visitedFloors: {},
    worldEvents: { history: [], activeEvent: null },
    status: 'playing',
  };
}
