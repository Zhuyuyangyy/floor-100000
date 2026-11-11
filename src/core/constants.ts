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

// ── 塔楼剖面 ────────────────────────────────────────────────────────────────
// The floor used to be 360 tall because one floor filled the whole 16:9 view.
// It is now 200: the tower shows three to four floors stacked at once, and at
// 360 the view can only ever hold two of them no matter the zoom, because the
// view is 16:9 and one floor is 1280x352 — far wider than it is tall.
//
// 200 is not arbitrary. The view is 640x360, so the zoom that fits one floor's
// width (0.5) shows 720 world px of height, which is 3.6 floors. The wall band
// is 136, which is more than the 96px character with room to spare under the
// ceiling, so nobody's head pokes into the floor above. tools/build-env.mjs
// regenerates the wall and floor art at this height — the old 288px wall cannot
// be cropped to 136 without losing either the conduit run or the skirting.
export const FLOOR_HEIGHT = 200;
export const FLOOR_BAND = 64; // walkable ground band at the bottom
/** how tall the wall band is, derived so the art and the code agree */
export const WALL_HEIGHT = FLOOR_HEIGHT - FLOOR_BAND;

export const ROOM_COUNT = 4;
export const ROOM_WIDTH = FLOOR_WIDTH / ROOM_COUNT;
export const PLAYER_SPEED = 130; // px / second
// Where the player's feet sit. The props are bottom-aligned further back in the
// band so the player reads as standing in front of them; this is that offset.
export const PLAYER_FEET_Y = FLOOR_HEIGHT - 40;
// One shared stair geometry contract. The player feet, visible treads and
// neighbouring-floor landing all use these values so the character never
// appears to float above or sink below the drawn flight.
export const STAIR_START_Y = PLAYER_FEET_Y;
export const STAIR_RISE = FLOOR_HEIGHT;

// The camera zoom. It is 1, and it must stay 1.
//
// The cross-section's view is 1280x720 world px — one floor's width by 3.6
// floors' height — which is exactly the design canvas at zoom 1, so no scaling
// happens anywhere and the pixel art is exact. It used to be 0.5, back when the
// canvas was 640x360, and a camera zoom resamples the world through the
// renderer's filter: the figure came out as 291 colours from a 15-colour sheet,
// #d9b48f arriving as #cdaa88, and 40% of it inside the wall's camouflage band.
// Raising the design resolution instead of zooming is what removed the resample.
export const FLOOR_VIEW_ZOOM = 1;
// How many floors are drawn around the player: two above, two below, plus the
// player's own. The view is 3.6 floors tall, so one above and one below leaves a
// 120px band of empty black at whichever edge the player is not centred on —
// five floors of content covers the view with margin at any player position.
export const STACK_ABOVE = 2;
export const STACK_BELOW = 2;

// ── 楼层环境 ────────────────────────────────────────────────────────────────
// The tower's five floors used to differ by a wall tint and a prop set, which
// made them five colour schemes rather than five places. The environment model
// gives each floor a temperature, a humidity, a danger rating and a set of
// warmth sources, and body heat is a real stat that responds to them.
//
// This War of Mine's scene loop runs TickTemperature and TickHeaters alongside
// ProcessSleep and ProcessSickness (docs/reference/TWOM_MECHANICS.md §3); ours
// decayed three bars and had no temperature at all. The brazier on floor 5
// already had a 90-frame animation — it was a light, never a heater.
//
//   cold      how fast body heat drains per game hour on this floor
//   humidity  0..1; raises the cold drain and slows the warmth recovery
//   danger    0..1; how likely a floor is to host the night event
//   warmth    the heat sources the floor is drawn with
export interface FloorEnvironment {
  /** the floor's own name, for the HUD line */
  label: string;
  /** body-heat drain per game hour */
  cold: number;
  humidity: number;
  danger: number;
  /** whether this floor can host a wanderer at night */
  hostile: boolean;
}

export const FLOOR_ENVIRONMENT: Record<number, FloorEnvironment> = {
  1: { label: '宿舍', cold: 0.6, humidity: 0.1, danger: 0.0, hostile: false },
  2: { label: '邻居宿舍', cold: 1.6, humidity: 0.2, danger: 0.3, hostile: true },
  3: { label: '储物层', cold: 2.4, humidity: 0.6, danger: 0.5, hostile: true },
  4: { label: '维修层', cold: 3.2, humidity: 0.7, danger: 0.8, hostile: true },
  5: { label: '食堂', cold: 2.0, humidity: 0.5, danger: 0.6, hostile: true },
};

export function environmentFor(floor: number): FloorEnvironment {
  return FLOOR_ENVIRONMENT[floor] ?? FLOOR_ENVIRONMENT[2];
}

// A warmth source: where it stands and how far its heat reaches. The brazier on
// floor 5 is the strongest, the dorm's candles the weakest — which is why the
// canteen reads as the floor you want to come back to.
export interface WarmthSource {
  x: number;
  /** world px; body heat recovers inside this radius */
  radius: number;
  /** body-heat points per game hour recovered at the centre */
  power: number;
}

export const WARMTH_SOURCES: Record<number, WarmthSource[]> = {
  // the dorm: three wall candles, weak but present, so home is survivable
  1: [
    { x: 236, radius: 70, power: 4 },
    { x: 640, radius: 70, power: 4 },
    { x: 1044, radius: 70, power: 4 },
  ],
  // the canteen: one brazier per room, the strongest heat in the tower
  5: [
    { x: 1188, radius: 150, power: 14 },
  ],
};

// The corridor used to hand the player its top speed on the frame a key went
// down and take it away the frame it came up, so walking read as dragging a
// sticker across the backdrop. These ramp the speed instead. Braking is quicker
// than starting on purpose: a heavy stop is the half of the feel players notice.
export const PLAYER_ACCELERATION = 900; // px/s^2, from rest toward top speed
export const PLAYER_DECELERATION = 1500; // px/s^2, braking or reversing
/** real-time duration of one visible stair traversal */
export const STAIR_TRAVEL_MS = 1000;

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
