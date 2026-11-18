// `with { type: 'json' }` is required, not decorative: a bare JSON import throws
// ERR_IMPORT_ATTRIBUTE_MISSING under Node's ESM loader (Node >= 20.10), which
// broke every Playwright spec that transitively imports this module. Vite and
// Vitest transform imports through their own pipeline and accepted the bare
// form, so the failure only surfaced outside the bundler. The attribute is the
// standard (ECMA-262 import attributes; the older `assert` form is deprecated)
// and is understood by Vite 5+/Vitest/tsc alike.
import balance from '../../config/game-balance.json' with { type: 'json' };

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
  // B3-03: game-minutes each action costs, so a day is a budget rather than a
  // countdown. Tuned here so pacing changes need no code edits.
  actionCosts: {
    searchContainer: number;
    pickupGround: number;
    craft: number;
    trade: number;
  };
  // B3-15: game-minutes of dwelling on one floor between dwell-pressure rolls.
  // At 3 game-minutes per real second this is one roll every 20 real seconds —
  // fast enough that the M1 playtest's 8-hour idle window (≈8 rolls) actually
  // fills with pressure, slow enough that a normal loot-and-leave floor visit
  // sees one or two.
  dwellPressure: {
    rollIntervalGameMinutes: number;
  };
  // OVERHAUL (docs/OVERHAUL_M1.md): every tunable the four work orders read.
  // They live here so the whole暴改 can be paced without touching code.
  overhaul: {
    sleepAnytime: boolean;
    nightLootBonusCount: number;
    lungeSpeedMultiplier: number;
    lungeRange: number;
    lungeStillnessMs: number;
    lowHpPulseThreshold: number;
    dailyGoalRewardScore: number;
    lowEnergySpeedFactor: number;
    lowEnergyThreshold: number;
  };
  // XP-1（2026-11-18）：玩家裸装战斗数值。原先写死在 systems/combat.ts 的
  // 常量里，调前段平衡要改代码；搬到 balance 文件后只挪数值不改公式。
  // 出处：RC-02 试玩 XP-1「前段战斗刮痧」（HP10 弹弓顽童空手 8 回合），
  // 根因是 d20 命中公式下 acc5×dmg2 的期望 DPS 只有 1.14，详见
  // game-balance.json combat 段注释与提交说明。
  combat: {
    /** 赤手基础伤害 */
    baseDamage: number;
    /** 包里有撬棍时的伤害加成（撬棍总伤 = baseDamage + 本值） */
    crowbarDamageBonus: number;
    /** 命中加值（d20：roll 0..20 + accuracy > 10 + defense + evasion） */
    accuracy: number;
    /** 防御（伤害公式按 floor(defense/2) 减伤） */
    defense: number;
    /** 闪避（同时抬怪物命中阈值与逃跑成功率） */
    evasion: number;
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
  ['combat.baseDamage', (c) => c.combat.baseDamage],
  ['combat.crowbarDamageBonus', (c) => c.combat.crowbarDamageBonus],
  ['combat.accuracy', (c) => c.combat.accuracy],
  ['combat.defense', (c) => c.combat.defense],
  ['combat.evasion', (c) => c.combat.evasion],
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
  ['dwellPressure.rollIntervalGameMinutes', (c) => c.dwellPressure.rollIntervalGameMinutes],
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
