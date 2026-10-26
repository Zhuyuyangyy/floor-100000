import balance from '../../config/game-balance.json';

// Typed view over the design-balance JSON (docs/config/game-balance.json),
// which is the single source of truth for starting values.
export interface StartingItemSpec {
  itemId: string;
  displayName: string;
  quantity: number;
  batteryState?: string;
}

export interface GameBalanceConfig {
  schemaVersion: number;
  time: {
    gameMinutesPerRealSecond: number;
    dayStartMinute: number;
    nightRiskStartMinute: number;
    victoryDay: number;
    victoryMinute: number;
    maxMajorEventsPerDay: number;
  };
  player: {
    startingFloor: number;
    hpMax: number;
    hpStart: number;
    hungerMax: number;
    hungerStart: number;
    hungerLossPerGameHour: number;
    thirstMax: number;
    thirstStart: number;
    thirstLossPerGameHour: number;
    energyMax: number;
    energyStart: number;
    energyLossPerGameHour: number;
  };
  inventory: { slotCount: number; startingItems: StartingItemSpec[] };
  world: {
    startingFloor: number;
    playableFloorsV01: number[];
    targetTotalFloors: number;
    preloadAllFloors: boolean;
    fixedQaSeeds: number[];
  };
}

// The balance file's own format version. Bump it (and the tests that pin it)
// when a field is renamed or removed, so a stale file is rejected rather than
// half-read.
const CONFIG_SCHEMA_VERSION = 1;

// Every number the game reads straight out of the balance file. A missing or
// mistyped field would otherwise surface as `undefined` deep inside
// createNewGame() / SurvivalSystem, so fail loudly at load instead (GHI-03 m8).
const REQUIRED_NUMBERS: Array<[string, (c: GameBalanceConfig) => number]> = [
  ['time.gameMinutesPerRealSecond', (c) => c.time.gameMinutesPerRealSecond],
  ['time.dayStartMinute', (c) => c.time.dayStartMinute],
  ['time.nightRiskStartMinute', (c) => c.time.nightRiskStartMinute],
  ['time.victoryDay', (c) => c.time.victoryDay],
  ['time.victoryMinute', (c) => c.time.victoryMinute],
  ['time.maxMajorEventsPerDay', (c) => c.time.maxMajorEventsPerDay],
  ['player.startingFloor', (c) => c.player.startingFloor],
  ['player.hpMax', (c) => c.player.hpMax],
  ['player.hpStart', (c) => c.player.hpStart],
  ['player.hungerMax', (c) => c.player.hungerMax],
  ['player.hungerStart', (c) => c.player.hungerStart],
  ['player.hungerLossPerGameHour', (c) => c.player.hungerLossPerGameHour],
  ['player.thirstMax', (c) => c.player.thirstMax],
  ['player.thirstStart', (c) => c.player.thirstStart],
  ['player.thirstLossPerGameHour', (c) => c.player.thirstLossPerGameHour],
  ['player.energyMax', (c) => c.player.energyMax],
  ['player.energyStart', (c) => c.player.energyStart],
  ['player.energyLossPerGameHour', (c) => c.player.energyLossPerGameHour],
  ['inventory.slotCount', (c) => c.inventory.slotCount],
  ['world.startingFloor', (c) => c.world.startingFloor],
  ['world.targetTotalFloors', (c) => c.world.targetTotalFloors],
];

// Validates the raw JSON rather than trusting an `as` cast: a typo in the balance
// file becomes a startup error naming the field, not `undefined` poisoning a run.
// Throws on the first problem set, listing everything it found.
export function assertGameBalanceConfig(raw: unknown): GameBalanceConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('config/game-balance.json 不是有效对象');
  }
  const cfg = raw as Record<string, unknown>;
  const problems: string[] = [];

  if (cfg.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    problems.push(`schemaVersion=${String(cfg.schemaVersion)}（需要 ${CONFIG_SCHEMA_VERSION}）`);
  }
  for (const [path, read] of REQUIRED_NUMBERS) {
    let value: unknown;
    try {
      value = read(cfg as unknown as GameBalanceConfig);
    } catch {
      value = undefined; // a whole block (player, world, …) is missing
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) problems.push(`${path} 不是有效数字`);
  }

  const world = cfg.world as Record<string, unknown> | undefined;
  const floors = world?.playableFloorsV01;
  if (!Array.isArray(floors) || floors.length === 0 || !floors.every((f) => typeof f === 'number' && Number.isInteger(f))) {
    problems.push('world.playableFloorsV01 必须是非空整数数组');
  }
  if (!Array.isArray((cfg.inventory as Record<string, unknown> | undefined)?.startingItems)) {
    problems.push('inventory.startingItems 必须是数组');
  }

  if (problems.length > 0) {
    throw new Error(`config/game-balance.json 无效：${problems.join('；')}`);
  }
  return cfg as unknown as GameBalanceConfig;
}

// Validated once at load: a bad balance file fails here, with the field named,
// instead of surfacing as `undefined` mid-run.
export const GAME_CONFIG = assertGameBalanceConfig(balance);
