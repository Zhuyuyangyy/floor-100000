// Save protocol constants (docs/02_TECH_SPEC.md §6).
export const SCHEMA_VERSION = 1;
export const SAVE_KEY = 'floor100000.save.v1';

// Floors playable in v0.1 (config/game-balance.json world.playableFloorsV01).
export const STARTING_FLOOR = 100000;
export const PLAYABLE_FLOORS_V01: readonly number[] = [100000, 99999, 99998, 99997, 99996];

// A game day runs 06:00 -> next 06:00. 360 = 06:00, 1200 = 20:00.
export const MINUTES_PER_DAY = 1440;
export const DAY_START_MINUTE = 360;
export const NIGHT_RISK_START_MINUTE = 1200;
