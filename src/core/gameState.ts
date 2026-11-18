import { GAME_CONFIG } from './config';
import { ENTRY_X, PLAYABLE_FLOORS_V01, SCHEMA_VERSION } from './constants';
import { isItemId } from '../data/items';
import { addItem } from '../systems/InventorySystem';
import { createGrowthProfile } from './growth';
import { createRunStats } from '../systems/StatsSystem';
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
      stress: 20,
      inventory: inventoryFromStartingItems(cfg.inventory.slotCount, cfg.inventory.startingItems),
      equipped: null,
      homeUpgrades: [],
      // OVERHAUL Wave C: every run starts broke; money comes from loot, goals
      // and trades.
      gold: 0,
    },
    npcStates: {},
    visitedFloors: {},
    worldEvents: { history: [], activeEvent: null },
    // 结构化日记（DiarySystem.diaryOf/recordDiary）：新档不预建字段，首次
    // 写入时懒创建——与 flags 同款兼容语义，旧存档没有它就是空日记。
    // RC-01 前这里是旧 DiaryEvent[]（diary: []），双轨制统一后移除。
    // OVERHAUL (docs/OVERHAUL_M1.md): the day's objective, the cross-run
    // records, and the resolved encounter spots. Initialised here so a new run
    // has them from the first frame; old saves simply lack them and the systems
    // create them on first use.
    dailyGoal: undefined,
    records: { deepestFloor: p.startingFloor, bestScore: 0 },
    encounters: {},
    // AG-81 统计：出生层（起始层）就是到达过的楼层——maxFloor 从起始层起记，
    // 与上面 records.deepestFloor 同风格的预置。旧存档没有 stats 块，读取侧
    // statsOf 兜底全零 + 读数 runMaxFloor（Math.max currentFloor）兼容。
    stats: { ...createRunStats(), maxFloor: p.startingFloor },
    // OVERHAUL Wave B2/B3: the mode and relics are applied by the character
    // pick (which owns the meta) right after this; vanilla until then.
    mode: 'adventure',
    relics: [],
    // 四条成长线（GAME_DESIGN_LOCK §4）：新档从四条 1 级线起步。旧存档没有
    // 这个字段也不崩——GameState.growth 是可选的，首个读者过 ensureGrowth()
    // 补默认值（core/growth.ts），不需要为此升 schemaVersion。
    growth: createGrowthProfile(),
    status: 'playing',
  };
}
