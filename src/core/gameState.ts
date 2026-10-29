import { GAME_CONFIG } from './config';
import { ENTRY_X, PLAYABLE_FLOORS_V01, SCHEMA_VERSION } from './constants';
import { isItemId } from '../data/items';
import { addItem } from '../systems/InventorySystem';
import type { GameState, Inventory, ItemId } from './gameTypes';

export function createInventory(slotCount: number): Inventory {
  return { slotCount, slots: [] };
}

// Adds items (stacking via InventorySystem). Throws when the bag is full — used
// for controlled starting items; gameplay looting uses InventorySystem.addItem
// directly so it can report overflow without losing items.
export function addToInventory(
  inv: Inventory,
  itemId: ItemId,
  quantity: number,
  meta?: Record<string, string>,
): void {
  const result = addItem(inv, itemId, quantity, meta);
  if (result.overflow > 0) {
    throw new Error('inventory full');
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
      x: ENTRY_X,
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
    // OVERHAUL (docs/OVERHAUL_M1.md): the day's objective, the cross-run
    // records, and the resolved encounter spots. Initialised here so a new run
    // has them from the first frame; old saves simply lack them and the systems
    // create them on first use.
    dailyGoal: undefined,
    records: { deepestFloor: p.startingFloor, bestScore: 0 },
    encounters: {},
    status: 'playing',
  };
}
