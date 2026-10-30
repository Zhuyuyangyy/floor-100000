import { GAME_CONFIG } from './config';

// Save protocol constants (docs/02_TECH_SPEC.md §6).
// v2: GHI-03 M1/M2 changed the loot key format and the seed derivation, so a v1
// save's "already looted" markers match nothing — accepting it would silently
// respawn loot and roll fresh container contents. SAVE_KEY deliberately stays
// put: a stable slot means an old save is still found and listed in the menu,
// then refused with a readable reason instead of being silently orphaned.
export const SCHEMA_VERSION = 2;
export const SAVE_KEY = 'floor100000.save.v1';

// Derived from config/game-balance.json rather than hand-copied, so editing the
// JSON cannot leave the code on a stale floor list (GHI-03 m7).
export const STARTING_FLOOR = GAME_CONFIG.player.startingFloor;
// The slum range the player starts in (floors 1..5). Floor 100000 is the
// summit and the long-term goal, never the spawn point.
export const PLAYABLE_FLOORS_V01: readonly number[] = GAME_CONFIG.world.playableFloorsV01;

// Dev-only: the retired v0.1 dorm scene, kept for testing. Reachable only via
// the ?devfloor= query parameter, never as a normal spawn point.
export const DEV_TEST_FLOORS: readonly number[] = [100000];

// A game day runs 06:00 -> next 06:00. 360 = 06:00, 1200 = 20:00.
export const MINUTES_PER_DAY = 1440;
export const DAY_START_MINUTE = 360;
export const NIGHT_RISK_START_MINUTE = 1200;

// Floor geometry for v0.1 (docs/01_GDD.md §4: 4 fixed-width room modules, 16px
// tiles). One floor is wider than the 640px viewport, so the camera scrolls.
//
// The floor band is 64px, up from 48. The wall and floor are single 1280px-wide
// art images rather than 16x16 tiles, and 48px was too short a strip for the
// drawn concrete to read — the wall band is what shrank to pay for it.
export const FLOOR_WIDTH = 1280; // 4 rooms x 320px
export const FLOOR_HEIGHT = 360;
export const FLOOR_BAND = 64; // walkable ground band at the bottom
export const ROOM_COUNT = 4;
export const ROOM_WIDTH = FLOOR_WIDTH / ROOM_COUNT;
export const PLAYER_SPEED = 130; // px / second
// Where the player's feet sit. The props are bottom-aligned further back in the
// band so the player reads as standing in front of them; this is that offset.
export const PLAYER_FEET_Y = FLOOR_HEIGHT - 40;

// The corridor used to hand the player its top speed on the frame a key went
// down and take it away the frame it came up, so walking read as dragging a
// sticker across the backdrop. These ramp the speed instead. Braking is quicker
// than starting on purpose: a heavy stop is the half of the feel players notice.
export const PLAYER_ACCELERATION = 900; // px/s^2, from rest toward top speed
export const PLAYER_DECELERATION = 1500; // px/s^2, braking or reversing

export const ENTRY_X = FLOOR_WIDTH / 2;
export const INTERACT_DISTANCE = 44;
export const UP_EXIT_X = 40; // left end -> 上楼 (toward higher floors)
export const DOWN_EXIT_X = FLOOR_WIDTH - 40; // right end -> 下楼 (toward lower floors)
export const BED_X = 1120; // dorm bed on the starting floor (sleep to pass the night)
export const CRAFT_X = 480; // dorm workbench on the starting floor (crafting station)

// Night wanderer threat (docs/01_GDD.md §10): slower than the player so it can be
// outrun, and it only ever chips HP on a cooldown — never an unavoidable kill.
export const WANDERER_SPEED = 70;
export const WANDERER_DAMAGE = 8;
export const WANDERER_HIT_COOLDOWN_MS = 1200;
