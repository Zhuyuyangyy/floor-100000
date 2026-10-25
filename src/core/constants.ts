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

// Floor geometry for v0.1 (docs/01_GDD.md §4: 4 fixed-width room modules, 16px
// tiles). One floor is wider than the 640px viewport, so the camera scrolls.
export const FLOOR_WIDTH = 1280; // 4 rooms x 320px
export const FLOOR_HEIGHT = 360;
export const ROOM_COUNT = 4;
export const ROOM_WIDTH = FLOOR_WIDTH / ROOM_COUNT;
export const PLAYER_SPEED = 130; // px / second
export const ENTRY_X = FLOOR_WIDTH / 2;
export const INTERACT_DISTANCE = 44;
export const UP_EXIT_X = 40; // left end -> 上楼 (toward 100000)
export const DOWN_EXIT_X = FLOOR_WIDTH - 40; // right end -> 下楼 (toward 99996)
export const BED_X = 1120; // dorm bed on floor 100000 (sleep to pass the night)
export const CRAFT_X = 480; // dorm workbench on floor 100000 (crafting station)

// Night wanderer threat (docs/01_GDD.md §10): slower than the player so it can be
// outrun, and it only ever chips HP on a cooldown — never an unavoidable kill.
export const WANDERER_SPEED = 70;
export const WANDERER_DAMAGE = 8;
export const WANDERER_HIT_COOLDOWN_MS = 1200;
