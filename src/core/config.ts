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

export const GAME_CONFIG = balance as unknown as GameBalanceConfig;
