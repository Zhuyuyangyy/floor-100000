import type Phaser from 'phaser';
import { FLOOR_HEIGHT, FLOOR_WIDTH, ROOM_WIDTH, STAIR_RISE, STAIR_START_Y, tierOfFloor } from '../core/constants';
import { hasFloorContent } from '../data/floorTemplates';

// Per-floor corridor art (docs/05_ART_GUIDE.md §3).
//
// Every floor of the tower is the same building seen at a different rung of the
// class hierarchy, so all of them share one base — tiled wall, tiled floor,
// ceiling shadow, skirting — and differ only in the props that fill it. Floor 1
// is the player's dorm and is drawn by GameScene; floors 2-5 are corridors and
// come through here.
//
// The props are what make the floors readable as places rather than as five
// differently-coloured voids: floor 2 is lived-in worker housing, 3 is a
// neglected store room, 4 is exposed maintenance, 5 is a communal canteen. That
// is the visual half of the design freeze's class gradient — a player should be
// able to tell where they are from the room, not only from the HUD.
//
// All coordinates are room-local: `roomX` is the room's left edge in floor space
// and `floorY` is the walkable floor line. Props stand with their bottoms on
// floorY so they sit at the back of the 48px ground band and never block the
// walkable strip.

export interface CorridorContext {
  scene: Phaser.Scene;
  // Shared detail layer for this floor's line work; the caller owns and pushes it.
  g: Phaser.GameObjects.Graphics;
  floor: number;
  roomX: number;
  floorY: number;
  // 0..ROOM_COUNT-1, used to vary the rooms without a random source.
  room: number;
  // Images / sprites this room creates, pushed onto the floor's object list.
  objects: Phaser.GameObjects.GameObject[];
  /** every flame this room lights, so a blackout can put them out */
  fixtures?: Phaser.GameObjects.Sprite[];
}

// Palette additions, kept local so the shared pixelArt palette stays the single
// source for the tiles and furniture these rooms are built from.
// The corridor props' colours, on the project palette.
//
// These were six hand-picked hexes plus another twenty written inline at the
// draw calls, which made this file the last place in the project where a prop
// could be a value off from the wall it sits against. Every colour below is a
// palette role or a named mix of two, so a crate, a pipe and the wall behind it
// all belong to the same value structure.
import { PALETTE } from './palette.ts';
import { ENV_FILES, ENV_FLOOR_KEY, ENV_WALL_KEY, TILE_DOOR_KEY, TILE_WINDOW_KEY } from './artpack';
import { LIGHT_DEPTH } from './lighting';
import { segmentOf } from '../core/segments';
import { startFxLoop } from './fx';

const PIPE = PALETTE.stoneLight;
const PIPE_DARK = PALETTE.stone;
const HAZARD = PALETTE.light; // the warning stripe reads as warm, not yellow
const CLOTH = PALETTE.dust;
const CLOTH_DARK = PALETTE.stoneLight;
const CONCRETE = PALETTE.stone;
/** the void: the darkest value, used for gaps and shadowed interiors */
const VOID = PALETTE.ink;
/** a prop's shadow side, one step under its base */
const SHADE = PALETTE.shadow;
/** bleached bone/paper */
const BONE = PALETTE.dust;
/** rusted metal, the only warm-metal value in the palette */
const RUST = PALETTE.lightDeep;
const RUST_DARK = 0x54391f; // one step under RUST; kept literal until the palette grows
const RUST_LIGHT = PALETTE.light;
/** glass: the vending machine's front, and the one cool highlight on the floor */
const GLASS = PALETTE.stoneLight;
const GLASS_LIGHT = PALETTE.dust;
/** painted steel fixtures (lockers, cabinet doors) */
const STEEL = PALETTE.stoneLight;
const STEEL_DARK = PALETTE.stone;
/** the teal the project uses for anything safe or purified */
const SAFE = PALETTE.clothHigh;
/** a warm dark for interior gaps behind doors */
const GAP = 0x3a2818; // stays literal: warmer than any palette shadow on purpose

// A deterministic per-room pick, so a room's dressing is stable across visits
// and across a scene restart. No Math.random: world dressing is world state.
function variant(floor: number, room: number, count: number): number {
  const h = (floor * 73 + room * 31 + 17) >>> 0;
  return h % count;
}

// A wall lamp plus its pool of light. Used by most themes, at different spacing.
function lamp(ctx: CorridorContext, x: number, warm = 1): void {
  const { g, floorY } = ctx;
  g.fillStyle(PALETTE.lightHigh, 0.1 * warm);
  g.fillRect(x - 30, floorY - 150, 60, 50);
  g.fillStyle(PALETTE.lightHigh, 0.16 * warm);
  g.fillRect(x - 20, floorY - 136, 40, 36);
  g.fillStyle(RUST, 1);
  g.fillRect(x - 2, floorY - 148, 4, 10);
  g.fillStyle(PALETTE.lightHigh, 1);
  g.fillRect(x - 5, floorY - 138, 10, 4);
}

// Floor 2 — 邻居宿舍. Worker housing: a door every room, number plates, doormats,
// laundry strung across the wall. Lived-in and cramped, which is the point.
function drawWorkerDorms(ctx: CorridorContext): void {
  const { g, roomX, floorY, room } = ctx;
  const doorX = roomX + 52;

  ctx.objects.push(placeDoor(ctx.scene, doorX, floorY, ctx.floor));
  // Number plate above the door. Its offset is the door's height plus a gap, not a
  // fixed 36 — the door used to be 16px and the plate sat well clear of it, but at
  // 56px a fixed 36 puts the plate printed across the door.
  g.fillStyle(VOID, 1);
  g.fillRect(doorX - 8, floorY - 66, 16, 9);
  g.fillStyle(BONE, 1);
  g.fillRect(doorX - 6, floorY - 64, 12, 5);
  g.fillStyle(CONCRETE, 1);
  g.fillRect(doorX - 4, floorY - 63, 3, 1);
  g.fillRect(doorX - 4, floorY - 61, 5, 1);

  // Doormat, worn.
  g.fillStyle(SHADE, 1);
  g.fillRect(doorX - 16, floorY, 32, 4);
  g.fillStyle(PALETTE.shadow, 1);
  g.fillRect(doorX - 14, floorY, 28, 2);

  // Laundry on a line, hanging at a slightly different height each room.
  const lineY = floorY - 118 - variant(ctx.floor, room, 3) * 8;
  g.fillStyle(SHADE, 1);
  g.fillRect(roomX + 150, lineY, 84, 1);
  for (let i = 0; i < 2; i++) {
    const hx = roomX + 168 + i * 30;
    const hang = 16 + variant(ctx.floor, room + i, 3) * 6;
    g.fillStyle(i === 0 ? CLOTH : CLOTH_DARK, 1);
    g.fillRect(hx, lineY + 1, 14, hang);
    g.fillStyle(VOID, 0.35);
    g.fillRect(hx, lineY + 1 + hang - 3, 14, 3);
  }

  // Shoes left outside the door.
  g.fillStyle(VOID, 1);
  g.fillRect(doorX - 12, floorY - 3, 7, 3);
  g.fillRect(doorX - 3, floorY - 3, 7, 3);

  lamp(ctx, roomX + 236, 0.9);
}

// Floor 3 — 废弃储物层. A store room nobody has emptied: shelving, stacked
// crates, one knocked over. Cooler and dimmer than the housing above.
function drawStorage(ctx: CorridorContext): void {
  const { g, roomX, floorY, room } = ctx;
  const shelfX = roomX + 58;
  ctx.objects.push(ctx.scene.add.image(shelfX, floorY, 'furn_shelf').setOrigin(0.5, 1));

  // Crate stack beside it, height varying per room. The crates are 80px tall now
  // (the art pack's props are scaled to a common standing height), so the stack
  // pitch has to come from the texture rather than the old 16px tile — stacking
  // at 16px would leave the crates floating apart with gaps between them.
  // One bay in four has crates at all, and never more than two high.
  //
  // They used to be in every bay, twice as tall: with the shelf and the floor's
  // own crate container, a store room ended up as eight or nine crates in a row,
  // and the outside view of the floor below read as a warehouse. A dormitory
  // stores things in corners, not in rows.
  const stack = variant(ctx.floor, room, 7) === 0 ? 2 : 0;
  const crateH = ctx.scene.textures.get('furn_crate_wood').getSourceImage().height;
  for (let i = 0; i < stack; i++) {
    ctx.objects.push(ctx.scene.add.image(roomX + 100, floorY - i * crateH, 'furn_crate_wood').setOrigin(0.5, 1));
  }

  // One crate on its side, as if someone left in a hurry.
  if (variant(ctx.floor, room + 5, 3) === 0) {
    const cx = roomX + 176;
    g.fillStyle(VOID, 0.5);
    g.fillRect(cx - 10, floorY - 4, 22, 4);
    g.fillStyle(RUST, 1);
    g.fillRect(cx - 10, floorY - 12, 22, 12);
    g.fillStyle(RUST_DARK, 1);
    g.fillRect(cx - 10, floorY - 12, 22, 2);
    g.fillRect(cx - 10, floorY - 4, 22, 2);
    g.fillStyle(RUST_LIGHT, 1);
    g.fillRect(cx - 4, floorY - 9, 10, 2);
  }

  // A door out of the bay, at the room boundary. Storage rooms had none, which
  // meant the tier's door art only ever appeared on floors 1 and 2.
  ctx.objects.push(placeDoor(ctx.scene, roomX + 290, floorY, ctx.floor));

  // Cobweb in the room's top corner.
  const wx = roomX + (room % 2 === 0 ? 8 : ROOM_WIDTH - 8);
  g.lineStyle(1, PALETTE.dust, 0.35);
  for (let i = 0; i < 3; i++) {
    g.lineBetween(wx, 10, wx + (room % 2 === 0 ? 26 - i * 7 : -26 + i * 7), 10 + i * 9);
    g.lineBetween(wx, 10, wx + (room % 2 === 0 ? 12 + i * 6 : -12 - i * 6), 10 + 22 - i * 5);
  }

  // Dust on the floor band.
  g.fillStyle(PALETTE.stone, 0.5);
  for (let i = 0; i < 5; i++) {
    g.fillRect(roomX + 24 + i * 47, floorY + 18 + variant(ctx.floor, room + i, 4) * 6, 2, 1);
  }

  lamp(ctx, roomX + 250, 0.55);
}

// Floor 4 — 维修层. Everything structural is on the outside: pipework, conduit,
// fuseboxes, a water tank. The one floor that shows how the tower is held up.
function drawMaintenance(ctx: CorridorContext): void {
  const { g, roomX, floorY } = ctx;

  // Two horizontal pipe runs with joint collars.
  for (const [y, r] of [
    [96, 4],
    [116, 3],
  ] as Array<[number, number]>) {
    g.fillStyle(PIPE, 1);
    g.fillRect(roomX, y, ROOM_WIDTH, r);
    g.fillStyle(PIPE_DARK, 1);
    g.fillRect(roomX, y + r - 1, ROOM_WIDTH, 1);
    for (let x = 12; x < ROOM_WIDTH; x += 32) {
      g.fillStyle(PIPE_DARK, 1);
      g.fillRect(roomX + x, y - 1, 4, r + 2);
    }
  }

  // A vertical drop with a valve wheel.
  const dropX = roomX + 246;
  g.fillStyle(PIPE, 1);
  g.fillRect(dropX, 96, 5, floorY - 96);
  g.fillStyle(PIPE_DARK, 1);
  g.fillRect(dropX + 4, 96, 1, floorY - 96);
  g.fillStyle(STEEL, 1);
  g.fillCircle(dropX + 2, 150, 6);
  g.fillStyle(CONCRETE, 1);
  g.fillCircle(dropX + 2, 150, 2);

  // Wall machinery, drawn rather than textured.
  //
  // This used to place furn_fusebox — the same art-pack texture the lootable
  // container uses — so floor 4 showed four identical fuseboxes and only the one at
  // x=640 could be opened (D7). A player had no way to tell which, and the map's
  // "go and get the filter" only helps if the thing you walk to is the thing that
  // opens. Drawn panels read as building machinery instead: flat, riveted, no
  // hazard decal, and a different silhouette from the real prop.
  for (const px of [roomX + 96, roomX + 236]) {
    g.fillStyle(VOID, 1);
    g.fillRect(px, 176, 34, 40); // cabinet
    g.fillStyle(PALETTE.shadow, 1);
    g.fillRect(px + 2, 178, 30, 36); // face
    g.fillStyle(CONCRETE, 1);
    for (let r = 0; r < 3; r++) g.fillRect(px + 4 + r * 11, 182, 2, 2); // rivets
    g.fillStyle(VOID, 1);
    g.fillRect(px + 5, 192, 24, 12); // vent louvre
    g.fillStyle(PALETTE.shadow, 1);
    for (let v = 0; v < 4; v++) g.fillRect(px + 6 + v * 6, 194, 4, 8);
  }
  // Conduit run along the skirting.
  g.fillStyle(SHADE, 1);
  g.fillRect(roomX, floorY - 10, ROOM_WIDTH, 3);
  g.fillStyle(PALETTE.shadow, 1);
  for (let x = 6; x < ROOM_WIDTH; x += 12) g.fillRect(roomX + x, floorY - 9, 6, 1);

  // Water tank on the floor, with a hazard stripe in front of it.
  ctx.objects.push(ctx.scene.add.image(roomX + 300, floorY, 'furn_watertank').setOrigin(0.5, 1));
  g.fillStyle(VOID, 0.5);
  g.fillRect(roomX + 282, floorY - 3, 38, 3);
  for (let i = 0; i < 6; i++) {
    g.fillStyle(i % 2 === 0 ? HAZARD : VOID, 1);
    g.fillRect(roomX + 280 + i * 6, floorY, 6, 3);
  }

  // Stencil marking on the wall, so the room is not only machinery.
  g.fillStyle(SAFE, 0.5);
  g.fillRect(roomX + 40, 150, 3, 14);
  g.fillRect(roomX + 47, 150, 3, 14);
  g.fillRect(roomX + 40, 157, 10, 3);

  // The plant room's door, between the two cabinet banks.
  ctx.objects.push(placeDoor(ctx.scene, roomX + 166, floorY, ctx.floor));

  lamp(ctx, roomX + 200, 0.8);
}

// Floor 5 — 废弃食堂. The communal floor: a long counter, benches, a row of
// hanging lamps. Wider and emptier than the housing, because it was built for
// crowds that are gone.
function drawCanteen(ctx: CorridorContext): void {
  const { g, roomX, floorY, room } = ctx;

  // Hanging lamps in a row, the one warm thing on this floor.
  for (let i = 0; i < 3; i++) {
    const lx = roomX + 60 + i * 96;
    g.fillStyle(SHADE, 1);
    g.fillRect(lx, 8, 1, 46);
    g.fillStyle(PALETTE.lightHigh, 0.09);
    g.fillRect(lx - 26, 54, 52, 44);
    g.fillStyle(PALETTE.lightHigh, 0.15);
    g.fillRect(lx - 16, 62, 32, 36);
    g.fillStyle(RUST, 1);
    g.fillRect(lx - 6, 54, 12, 5);
    g.fillStyle(PALETTE.lightHigh, 1);
    g.fillRect(lx - 5, 59, 10, 3);
  }

  // AND FIRE ON THE FLOOR. The canteen is the only warm floor in the tower and
  // its light was three hanging lamps plus a static glow - a room described as
  // warm with nothing burning in it. A brazier per room: the flame is a 90-frame
  // loop, so the light moves, and the floor reads as somewhere people cooked.
  const brazierX = roomX + ROOM_WIDTH - 92;
  const brazier = startFxLoop(ctx.scene, 'brazier', brazierX, floorY, LIGHT_DEPTH);
  if (brazier) {
    ctx.objects.push(brazier);
    if (ctx.fixtures) ctx.fixtures.push(brazier);
  }
  // the bowl and legs, drawn behind the flame
  g.fillStyle(RUST_DARK, 1);
  g.fillRect(brazierX - 14, floorY - 12, 28, 4);
  g.fillRect(brazierX - 10, floorY - 8, 3, 8);
  g.fillRect(brazierX + 7, floorY - 8, 3, 8);
  // its pool on the floor
  g.fillStyle(PALETTE.lightDeep, 0.22);
  g.fillEllipse(brazierX, floorY + 2, 76, 12);

  // AND THE HEAT IS VISIBLE. Body heat recovers inside the brazier's radius
  // (core/constants.ts WARMTH_SOURCES), but a radius the player cannot see is a
  // rule they learn by standing still and watching a number. Three banded rings
  // at the radius edge, in the same language as the light pools: stepped alpha,
  // no gradient, so it reads as a pixel-art decal rather than a filter.
  const heatR = 150;
  for (let i = 0; i < 3; i++) {
    const r = heatR - i * 12;
    g.lineStyle(2, PALETTE.lightDeep, 0.3 - i * 0.08);
    g.strokeEllipse(brazierX, floorY + 2, r * 2, r * 0.42);
  }

  // Counter, with a bank of service shelves racked on the wall behind it.
  const cx = roomX + 40;
  // Shelf bank: two boards with what is left on them. Drawn rather than tiled
  // with furn_shelf because a 16px prop would read as clutter on the counter
  // instead of as wall furniture.
  const shelfTop = floorY - 74;
  g.fillStyle(VOID, 0.45);
  g.fillRect(cx - 4, shelfTop - 4, 158, 48);
  for (let board = 0; board < 2; board++) {
    const by = shelfTop + board * 22;
    g.fillStyle(RUST_DARK, 1);
    g.fillRect(cx, by + 14, 150, 3);
    g.fillStyle(RUST, 1);
    g.fillRect(cx, by + 14, 150, 1);
    for (let i = 0; i < 6; i++) {
      if (variant(ctx.floor, room + board * 6 + i, 4) === 0) continue; // gaps where stock ran out
      const ix = cx + 8 + i * 24;
      const ih = 8 + variant(ctx.floor, room + i, 3) * 4;
      g.fillStyle(i % 3 === 0 ? GLASS : i % 3 === 1 ? RUST_LIGHT : PALETTE.stoneLight, 1);
      g.fillRect(ix, by + 14 - ih, 12, ih);
      g.fillStyle(VOID, 0.3);
      g.fillRect(ix, by + 14 - ih, 12, 1);
    }
  }

  g.fillStyle(CONCRETE, 1);
  g.fillRect(cx, floorY - 30, 150, 30);
  g.fillStyle(STEEL_DARK, 1);
  g.fillRect(cx, floorY - 30, 150, 3);
  g.fillStyle(PALETTE.shadow, 1);
  g.fillRect(cx, floorY - 12, 150, 2);
  g.fillStyle(VOID, 0.5);
  g.fillRect(cx - 3, floorY - 3, 156, 3);
  // Serving well cut into the counter top.
  g.fillStyle(VOID, 0.55);
  g.fillRect(cx + 96, floorY - 26, 44, 8);

  // Trays and a jug left on the counter.
  g.fillStyle(PALETTE.dust, 1);
  g.fillRect(cx + 18, floorY - 36, 18, 6);
  g.fillStyle(STEEL_DARK, 1);
  g.fillRect(cx + 18, floorY - 32, 18, 2);
  g.fillStyle(GLASS, 1);
  g.fillRect(cx + 52, floorY - 40, 8, 10);
  g.fillStyle(GLASS_LIGHT, 1);
  g.fillRect(cx + 54, floorY - 38, 3, 3);

  // Benches on the floor side.
  for (let i = 0; i < 2; i++) {
    const bx = roomX + 214 + i * 52;
    g.fillStyle(RUST_DARK, 1);
    g.fillRect(bx, floorY - 12, 40, 4);
    g.fillStyle(GAP, 1);
    g.fillRect(bx + 3, floorY - 8, 3, 8);
    g.fillRect(bx + 34, floorY - 8, 3, 8);
  }

  // A menu board, mostly blank.
  g.fillStyle(VOID, 1);
  g.fillRect(roomX + 250, 150, 54, 40);
  g.fillStyle(PALETTE.shadow, 1);
  g.fillRect(roomX + 254, 154, 46, 32);
  g.fillStyle(PALETTE.dust, 0.7);
  g.fillRect(roomX + 258, 160, 30, 2);
  g.fillRect(roomX + 258, 166, 22, 2);
  g.fillRect(roomX + 258, 172, 26, 2);

  // The canteen's own door, on the service side of the room.
  ctx.objects.push(placeDoor(ctx.scene, roomX + 300, floorY, ctx.floor));

  lamp(ctx, roomX + 160, 0.7);
}

// The one tint per floor, laid over the shared wall so the floors read as
// different parts of one building without giving up the tiling. Kept light: the
// wall tile is already a dark value, and a heavy tint sinks the props into it
// until the room stops being readable — the class difference has to come from
// what is in the room, not from how little of it you can see.
export const CORRIDOR_TINT: Record<number, { color: number; alpha: number }> = {
  2: { color: PALETTE.stone, alpha: 0.16 }, // worker housing: cold, faintly warmed by the doors
  3: { color: PALETTE.shadow, alpha: 0.26 }, // store room: the dimmest of the four
  4: { color: PALETTE.stone, alpha: 0.16 }, // maintenance: cold steel
  5: { color: PALETTE.lightDeep, alpha: 0.14 }, // canteen: the warmest, because it was the social floor
};

const THEMES: Record<number, (ctx: CorridorContext) => void> = {
  2: drawWorkerDorms,
  3: drawStorage,
  4: drawMaintenance,
  5: drawCanteen,
};

// Rooms above floor 5 used to be empty: drawCorridorRoom dispatched on the floor
// number, and only 2/3/4/5 were keys. That left 51 of the 55 playable floors as
// a wall, a floor band and nothing else — the art was there, the room was not.
//
// Floors 2-5 keep their hand-authored theme exactly as before. Everything else
// takes a theme from its tier, alternating by parity so two neighbouring floors
// never furnish the same way.
const TIER_THEMES: Record<number, readonly number[]> = {
  // Tier 1 is a dormitory, not a warehouse: half its floors are bunk rooms with
  // a door, a doormat and laundry, and only the other half are storage bays.
  // Before this it alternated storage/maintenance, which is why every slum floor
  // read as stacks of crates.
  1: [2, 3],
  2: [2, 3], // worker housing, then its store rooms
  3: [3, 4], // industrial: storage and plant
  4: [4, 5], // commercial: plant and canteens
  5: [5, 4], // privileged: canteens and plant
  6: [4, 5], // core: plant
};

function themeFor(floor: number): number | null {
  if (THEMES[floor]) return floor;
  const tier = segmentOf(floor)?.id ?? 1;
  const list = TIER_THEMES[tier] ?? TIER_THEMES[1];
  return list[Math.abs(Math.trunc(floor)) % list.length];
}

// ── how many people sleep on this floor ────────────────────────────────────
// The tower held a hundred thousand people. The bottom is where they still are:
// every bay has bodies on the floor, and the number falls as you climb until the
// top floors have nobody at all. This is the cheapest honest way to say it —
// four shapes in blanket colours, drawn behind the furniture so they never fight
// the props for space.
// Crowded on purpose: the bottom of a 100000-storey dormitory is not a corridor
// with a few sleepers in it, it is a corridor somebody had to step over people
// to walk down.
const CROWD_BY_TIER: Record<number, number> = { 1: 12, 2: 10, 3: 6, 4: 3, 5: 1, 6: 0 };

// Decorative bunks (bunk-sleeper), one per this many bays. They are furniture,
// not containers: the searchable beds are placed by the loot system.
const BUNK_BY_TIER: Record<number, number> = { 1: 2, 2: 2, 3: 1, 4: 0, 5: 0, 6: 0 };

export function crowdFor(floor: number): number {
  return CROWD_BY_TIER[tierOfFloor(floor)] ?? 0;
}

/**
 * The people who never left. Drawn on their own graphics layer at the wall base,
 * behind everything the theme puts in the room.
 */
export function drawCrowd(
  scene: Phaser.Scene,
  objects: Phaser.GameObjects.GameObject[],
  opts: { roomX: number; floorY: number; floor: number; room: number },
): void {
  const { roomX, floorY, floor, room } = opts;
  const count = crowdFor(floor);
  const bunks = BUNK_BY_TIER[tierOfFloor(floor)] ?? 0;
  if (count === 0 && bunks === 0) return;
  // Bunks first, so the people lying in front of them draw over their frames.
  for (let b = 0; b < bunks; b++) {
    const bx = roomX + 168 + b * 96;
    if (scene.textures.exists('env-bunk-sleeper')) {
      objects.push(scene.add.image(bx, floorY, 'env-bunk-sleeper').setOrigin(0.5, 1));
    }
  }
  for (let i = 0; i < count; i++) {
    const slot = (room * 11 + i * 3) % 10;
    const x = roomX + 34 + slot * 28 + (i % 2) * 6;
    const variant = (room + i) % 2;
    const lying = (room + i) % 3 !== 0;
    const key = lying ? (variant ? 'env-sleep-b' : 'env-sleep-a') : (variant ? 'env-sit-b' : 'env-sit-a');
    if (!scene.textures.exists(key)) continue;
    // Feet on the floor line: both sheets are drawn with the figure sitting on
    // the bottom edge of the canvas, so origin-bottom is the whole alignment.
    const img = scene.add.image(x, floorY, key).setOrigin(0.5, 1);
    if (lying) img.setAlpha(0.96);
    objects.push(img);
  }
}

/** Draws one room of a corridor floor into the shared detail layer. */
export function drawCorridorRoom(ctx: CorridorContext): void {
  const theme = themeFor(ctx.floor);
  if (theme === null) return;
  THEMES[theme]?.(ctx);
}

// Per-segment wash, applied where a floor has no tint of its own. The tower
// shares one wall tile, so without this every tier is the same room with
// different furniture.
//
// Honest limit, measured: on the current wall the wash moves the sampled wall
// average from RGB(27,43,53) to (32,46,61) — about 7 levels on the blue channel.
// That is a hint, not a difference. A tier that actually reads as a different
// building needs its own wall art; this is only a stopgap so the dorm is not
// byte-identical to the slum.
export const SEGMENT_TINT: Record<number, { color: number; alpha: number }> = {
  2: { color: PALETTE.lightHigh, alpha: 0.18 }, // worker dorms: warm, kept lit
  3: { color: PALETTE.clothHigh, alpha: 0.16 }, // industry: cold, chemical
};

// Tier 4 (中产与商业区, floors 10000-10010) and tier 5 (富人特权区, 50000-50010)
// wall keys. The prompts are written (floor-100000-ai-ci/10-中产与商业区 and
// 11-富人特权区); the PNGs are AG-07's to deliver, so the branch is written
// now and answers with the new key only once the art is actually mapped.
//
// Why the indirection instead of returning the key directly: a texture key
// BootScene never loaded renders as Phaser's green __MISSING placeholder — the
// failure textureKeys.test.ts was written to catch. Borrowing the slum wall is
// strictly better than a green box, and it is what the tiers above 1010 have
// always done.
//
// AG-07 handoff, one line each in artpack.ts's ENV_FILES (plain strings, NOT
// imports from here — artpack is imported BY this file, so importing back would
// be a module cycle):
//
//   'env-wall-commercial': 'wall-commercial.png',
//   'env-wall-vip':        'wall-vip.png',
//
// BootScene loads every ENV_FILES entry, so once the mapping exists the file is
// loaded and this branch starts returning the new key with no further change.
// furniture.test.ts already asserts every ENV_FILES entry has a real file on
// disk, so a mapped-but-missing PNG fails the suite instead of shipping green.
export const ENV_WALL_COMMERCIAL_KEY = 'env-wall-commercial';
export const ENV_WALL_VIP_KEY = 'env-wall-vip';

// ── doors and windows ──────────────────────────────────────────────────────
// The pack ships one door per tier plus broken/cracked variants. The old
// tile-door was 44x104 with 91px of opaque art, so the new 64x96 doors are
// drawn 91px tall: same footprint, same floor line, no relayout of the door
// numbers and doormats that sit above them.
const DOOR_HEIGHT = 91;
const WINDOW_HEIGHT = 54;

export function doorKeyFor(floor: number): string {
  const tier = segmentOf(floor)?.id ?? 1;
  let key: string;
  if (tier === 1) {
    // Floor 1 is the room whose door the player can reinforce at the bench, so
    // it is the one door in the tower that is visibly reinforced.
    key = floor === 1 ? 'env-door-slum-reinforced' : 'env-door-slum';
  } else if (tier === 2) {
    // One dorm door in five has been kicked in — the same 1-in-5 the loot
    // tables use for a raided room.
    key = floor % 5 === 0 ? 'env-door-dorm-broken' : 'env-door-dorm';
  } else if (tier === 6) {
    key = 'env-door-commercial';
  } else {
    key = 'env-door-commercial';
  }
  return ENV_FILES[key] ? key : TILE_DOOR_KEY;
}

export function windowKeyFor(floor: number): string {
  const tier = segmentOf(floor)?.id ?? 1;
  let key: string;
  if (tier === 1) key = 'env-window-slum';
  else if (tier === 2 || tier === 3) key = 'env-window-dorm';
  else key = 'env-window-commercial';
  return ENV_FILES[key] ? key : TILE_WINDOW_KEY;
}

/** Place a door standing on `floorY`. Sizes to the old door's opaque height. */
export function placeDoor(
  scene: Phaser.Scene,
  x: number,
  floorY: number,
  floor: number,
): Phaser.GameObjects.Image {
  const key = doorKeyFor(floor);
  const img = scene.add.image(x, floorY, key).setOrigin(0.5, 1);
  const src = scene.textures.get(key).getSourceImage() as { width: number; height: number };
  const scale = DOOR_HEIGHT / src.height;
  img.setDisplaySize(Math.round(src.width * scale), DOOR_HEIGHT);
  return img;
}

/** Place a window centred on `y`. Sizes to the old window's opaque height. */
export function placeWindow(
  scene: Phaser.Scene,
  x: number,
  y: number,
  floor: number,
): Phaser.GameObjects.Image {
  const key = windowKeyFor(floor);
  const img = scene.add.image(x, y, key).setOrigin(0.5);
  const src = scene.textures.get(key).getSourceImage() as { width: number; height: number };
  const scale = WINDOW_HEIGHT / src.height;
  img.setDisplaySize(Math.round(src.width * scale), WINDOW_HEIGHT);
  return img;
}

/**
 * Which wall a floor stands in front of. Tiers 2 and 3 have their own art; the
 * slum keeps the original, and anything above 1010 falls back to it until its
 * art exists — a tier that borrows the wrong wall is worse than one that borrows
 * the oldest.
 */
// ── per-floor art selection ────────────────────────────────────────────────
// Six tiers, three variants each (see artpack.WALL_VARIANT_FILES). The variant
// index is `floor % 3`, so 1..10 walks slum a/b/c/a/b/c..., 100..110 walks
// dorm a/b/c..., and two neighbouring floors never share a wall. That is the
// cheapest way to make every floor look different: 18 files, not 55.
const TIER_SLUG: Record<number, string> = {
  1: 'slum',
  2: 'dorm',
  3: 'industry',
  4: 'commercial',
  5: 'vip',
  6: 'core',
};
const WALL_VARIANTS = ['a', 'b', 'c'] as const;

function tierSlugFor(floor: number): string {
  return TIER_SLUG[segmentOf(floor)?.id ?? 1] ?? 'slum';
}

/**
 * Which wall a floor stands in front of. Falls back to the original slum wall
 * when the tier's art is not mapped — a texture key BootScene never loaded
 * renders as Phaser's green __MISSING box, which is worse than borrowing.
 */
export function wallKeyFor(floor: number): string {
  const slug = tierSlugFor(floor);
  const variant = WALL_VARIANTS[Math.abs(Math.trunc(floor)) % WALL_VARIANTS.length];
  const key = `env-wall-${slug}-${variant}`;
  return ENV_FILES[key] ? key : ENV_WALL_KEY;
}

/** The floor band for a tier. Same fallback rule as the wall. */
export function floorKeyFor(floor: number): string {
  const key = `env-floor-${tierSlugFor(floor)}`;
  return ENV_FILES[key] ? key : ENV_FLOOR_KEY;
}

/** The wall tint for a floor, or null when the floor draws its own base. */
export function corridorTint(floor: number): { color: number; alpha: number } | null {
  return CORRIDOR_TINT[floor] ?? SEGMENT_TINT[segmentOf(floor)?.id ?? 0] ?? null;
}

// ── the cross-section's neighbour selection ────────────────────────────────
// GameScene.drawFloor 挑邻居楼层的规则，抽成纯函数：相机纵截面里画谁，是渲染
// 语义的一部分（站在 100 层时下方画 101/102、上方 99/98 是无内容空洞不画），
// 值得单独钉住。GameScene.ts:618-632 的循环与这里逐条对应；本模块不 import
// scene，所以这条规则可以在 Node 里直接测。
export interface StackNeighbour {
  floor: number;
  /** 1 = 紧邻的一层，2 = 隔一层 */
  distance: number;
  /** true = 画在玩家上方（更低的楼层号） */
  isAbove: boolean;
}

/**
 * 纵截面要画的邻居楼层：上下各最多 `above`/`below` 层，跳过无模板楼层
 * （段与段之间的空洞），不越过可玩边界。
 */
export function stackNeighbours(
  floor: number,
  bounds: { lowest: number; highest: number; above: number; below: number },
  hasContent: (floor: number) => boolean,
): StackNeighbour[] {
  const out: StackNeighbour[] = [];
  for (let d = 1; d <= bounds.above; d++) {
    const f = floor - d;
    if (f >= bounds.lowest && hasContent(f)) out.push({ floor: f, distance: d, isAbove: true });
  }
  for (let d = 1; d <= bounds.below; d++) {
    const f = floor + d;
    if (f <= bounds.highest && hasContent(f)) out.push({ floor: f, distance: d, isAbove: false });
  }
  return out;
}

// ── the stairwells: 2D flights and ladders ─────────────────────────────────
// The cross-section's stairwells, redrawn as art you can read the climb on.
//
// The user's note (2026-11-16): the old stair was a line the survivor SLID
// along — "像你现在坐楼梯这样滑步走上去非常的难看". Two shapes replace it:
//
//   stairs  the default: a 2D switchback flight of ten visible treads — five
//          up, a landing, five back — with a climb curve that steps from
//          tread to tread, so the character WALKS up instead of sliding.
//   ladder  a straight ladder — two rails and rungs — hung between the two
//          floors like a line, climbed vertically. The slum's iron ladder
//          (tier 1) and the industry's shaft ladder (tier 3) use it; every
//          other tier climbs stairs.
//
// Everything here is pure geometry plus Graphics commands: no scene state, no
// randomness, so the shapes, the dispatch and the climb curve are all
// unit-testable in Node (src/tests/stairsArt.test.ts) and the drawing can be
// driven from a browser probe without wiring the scene first.
//
// The geometry contract the scene relies on: both ends of every flight sit at
// the stairwell mouth (startX), because that is where the interaction zone
// (FloorSystem.stairMouthZone) and the traversal's landing (endX) already
// are. A flight that wandered off the mouth would desync the art from the
// rules — the failure the old sine-bend path courted by swinging ±96px.

export type StairArtStyle = 'stairs' | 'ladder';

/**
 * Tiers whose connections are climbed on a ladder, not walked up stairs.
 * Tier 1 is the slum (its iron ladder is the cheapest way between floors)
 * and tier 3 is industry (the shaft ladder between plant rooms). Everything
 * else — worker dorms, commercial, the privileged floors — has proper
 * stairs, because someone paid for them.
 */
const LADDER_TIERS: ReadonlySet<number> = new Set([1, 3]);

/**
 * Which art a connection gets. The stair belongs to the CONNECTION, not to
 * the direction you happen to walk: climbing 1->2 and descending 2->1 must
 * draw and animate the same ladder, so the anchor is the pair's lower floor
 * and the direction only decides which of the two it is.
 */
export function stairArtStyleFor(floor: number, direction: 1 | -1): StairArtStyle {
  const anchor = direction === 1 ? floor : floor - 1;
  const tier = segmentOf(anchor)?.id ?? 1;
  return LADDER_TIERS.has(tier) ? 'ladder' : 'stairs';
}

/** Ten treads span one STAIR_RISE: five per flight, two flights. */
export const STAIR_TREAD_COUNT = 10;
export const STAIR_TREADS_PER_FLIGHT = 5;
/** 20px — a fifth of a flight's rise, and one clear step at the tower zoom. */
export const STAIR_STEP_RISE = STAIR_RISE / STAIR_TREAD_COUNT;
/**
 * 32px deep — a tread the 64px-wide survivor sheet stands on without
 * hanging off either end, and the run that lets five treads turn the flight
 * around inside the room (5 x 32 = 160px in, 160px back).
 */
export const STAIR_TREAD_DEPTH = 32;
/** The ladder's rung pitch: same 20px, so a rung sits at every step height. */
export const LADDER_RUNG_SPACING = STAIR_STEP_RISE;

/**
 * Anim pace while climbing. The scene already plays the walk cycle during a
 * traversal; these only scale it. Stairs keep the brisk 1.25 the traversal
 * had; a ladder is slower on purpose — 200px of vertical per second against
 * a 130px/s walk would read as frantic scrabbling.
 */
export const STAIR_ANIM_TIME_SCALE = 1.25;
export const LADDER_ANIM_TIME_SCALE = 1;

/** The measured shape of one connection. Pure data, for tests and probes. */
export interface StairGeometry {
  style: StairArtStyle;
  /** visible treads (stairs) or rungs (ladder) on the whole connection */
  steps: number;
  /** vertical rise of one tread, and the ladder's rung pitch */
  rise: number;
  /** tread depth (stairs); 0 for a ladder, which has no treads */
  tread: number;
}

export function stairGeometry(floor: number, direction: 1 | -1): StairGeometry {
  const style = stairArtStyleFor(floor, direction);
  return {
    style,
    steps: STAIR_TREAD_COUNT,
    rise: STAIR_STEP_RISE,
    tread: style === 'stairs' ? STAIR_TREAD_DEPTH : 0,
  };
}

export interface StairPathNode {
  x: number;
  y: number;
}

/**
 * The polyline the character walks: mouth -> five treads in -> the landing
 * -> five treads back -> the neighbour's mouth, one node per tread.
 *
 * The first flight heads toward the floor's middle so the switchback stays
 * inside the room (up leaves the left stairwell, down the right one), and
 * the second flight returns to `startX` — the mouth — which is what keeps
 * the climb on the drawn steps from first tread to last.
 */
export function stairPath(direction: 1 | -1, startX: number, startY: number): StairPathNode[] {
  const inward = startX < FLOOR_WIDTH / 2 ? 1 : -1;
  const stepX = STAIR_TREAD_DEPTH * inward;
  const stepY = -STAIR_STEP_RISE * direction; // up climbs toward -Y: the floor above sits at -FLOOR_HEIGHT
  const nodes: StairPathNode[] = [{ x: startX, y: startY }];
  for (let i = 1; i <= STAIR_TREADS_PER_FLIGHT; i++) {
    nodes.push({ x: startX + stepX * i, y: startY + stepY * i });
  }
  for (let i = 1; i <= STAIR_TREADS_PER_FLIGHT; i++) {
    nodes.push({ x: startX + stepX * (STAIR_TREADS_PER_FLIGHT - i), y: startY + stepY * (STAIR_TREADS_PER_FLIGHT + i) });
  }
  return nodes;
}

/**
 * What the climb curve needs from a traversal. Structurally satisfied by
 * FloorSystem's StairTraversal, so the scene can hand one over unchanged.
 */
export interface StairClimb {
  direction: 1 | -1;
  startX: number;
  endX: number;
  startY: number;
  endY: number;
  durationMs: number;
}

export interface StairClimbPose {
  x: number;
  y: number;
  progress: number;
  /** which way the survivor faces mid-climb (the switchback turns) */
  faceX: 1 | -1;
  /** anim timeScale for this style's climb */
  animTimeScale: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Per-tread ease: the foot plant. The rise is front-loaded so the survivor
 * arrives ON each tread and settles there for the back of the slice — ten
 * visible footfalls instead of one smooth slide. Linear-per-step would be
 * constant-speed sliding (what the user rejected); ease-in-out per step
 * would stall at both ends and read as hesitation.
 */
const easeOntoTread = (t: number): number => 1 - (1 - t) * (1 - t);

/**
 * Where the survivor is at `elapsedMs` into the climb.
 *
 * Stairs: the pose rides the stairPath polyline — x linear across each
 * tread, y eased onto each tread — so it stands on every visible step and
 * turns at the landing. Ladder: x pinned at the mouth, y linear, the
 * straight vertical climb the user asked for ("相当于一条线一样").
 *
 * Endpoints are exact: pose(0) is the mouth, pose(durationMs) is the
 * neighbour's mouth, and past the end the pose holds there.
 */
export function stairClimbPose(floor: number, climb: StairClimb, elapsedMs: number): StairClimbPose {
  const style = stairArtStyleFor(floor, climb.direction);
  const progress = clamp01(elapsedMs / climb.durationMs);
  if (style === 'ladder') {
    return {
      x: climb.startX,
      y: climb.startY + (climb.endY - climb.startY) * progress,
      progress,
      faceX: climb.direction === 1 ? 1 : -1,
      animTimeScale: LADDER_ANIM_TIME_SCALE,
    };
  }
  const nodes = stairPath(climb.direction, climb.startX, climb.startY);
  const sliceMs = climb.durationMs / (nodes.length - 1);
  const i = Math.min(nodes.length - 2, Math.max(0, Math.floor(elapsedMs / sliceMs)));
  const t = clamp01((elapsedMs - i * sliceMs) / sliceMs);
  const a = nodes[i];
  const b = nodes[i + 1];
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * easeOntoTread(t),
    progress,
    faceX: b.x >= a.x ? 1 : -1,
    animTimeScale: STAIR_ANIM_TIME_SCALE,
  };
}

/**
 * Every colour the stairwells are drawn in — each one a palette role, so the
 * 16-colour gate holds by construction (asserted in stairsArt.test.ts).
 */
export const STAIR_COLORS = {
  /** the walking surface of a tread */
  tread: PALETTE.dust,
  /** the alternate tread, so consecutive steps stay countable */
  treadAlt: PALETTE.stoneLight,
  /** the solid mass under the treads */
  mass: PALETTE.stone,
  /** the dark line under the landing's lip */
  edge: PALETTE.shadow,
  /** the handrail, faded so it never fights the treads */
  rail: PALETTE.dust,
  /** the sill set into each floor at the mouth */
  sill: PALETTE.stone,
  /** the slum's iron ladder: rusted rails, warm rungs */
  ironRail: PALETTE.lightDeep,
  ironRung: PALETTE.light,
  /** the industry's shaft ladder: cold steel rails, pale rungs */
  steelRail: PALETTE.stoneLight,
  steelRung: PALETTE.dust,
  /** where the rails enter the floors */
  bracket: PALETTE.stone,
} as const;

/**
 * One stairwell, drawn from this floor's band to the neighbour's.
 *
 * Drop-in for the scene's drawStair: it takes the Graphics the caller
 * created (pushed at ACTOR_DEPTH - 1) and draws either shape from the same
 * dispatch the climb curve uses, so the character can never leave the art.
 */
export function drawStairwell(
  g: Phaser.GameObjects.Graphics,
  opts: { x: number; dir: 'up' | 'down'; floor: number },
): void {
  const { x, dir, floor } = opts;
  if (stairArtStyleFor(floor, dir === 'up' ? 1 : -1) === 'ladder') {
    // 竖井落差：楼层带只有 STAIR_RISE(90) 高，而两层楼板相差一个
    // FLOOR_HEIGHT(200)——悬空的直梯轨在梯口下方 10px 断掉，角色爬出去时
    // 下半身留在楼层墙里（AG-53 实测：50009→50010 爬出去时下半身消失）。
    // 未创作层（邻居）也标 ladder 但没有楼层带可画，竖井只管已经创作的目标层。
    const neighbour = floor + (dir === 'up' ? 1 : -1);
    const drop = hasFloorContent(neighbour) ? STAIR_SHAFT_DROP : 0;
    drawLadder(g, x, dir, floor, drop);
  }
  else drawStairFlight(g, x, dir);
}

/**
 * The 2D switchback: ten solid tread blocks in a Z, a landing at the turn,
 * a handrail on the room side, sills at both mouths.
 *
 * Each tread is a block hanging from its cap down to the next tread's cap,
 * so the flight reads as a staircase mass rather than floating slabs — the
 * shape the user asked for ("2D 的，就是阶梯型的那种").
 */
function drawStairFlight(g: Phaser.GameObjects.Graphics, x: number, dir: 'up' | 'down'): void {
  const direction = dir === 'up' ? 1 : -1;
  const nodes = stairPath(direction, x, STAIR_START_Y);
  const c = STAIR_COLORS;
  const depth = Math.round(STAIR_STEP_RISE) + 2; // reach the next tread's cap, hairline-free
  for (let i = 1; i < nodes.length; i++) {
    // from 1: node 0 is the mouth on this floor's line — it gets a sill below,
    // not a tread of its own.
    const n = nodes[i];
    const left = Math.round(n.x - STAIR_TREAD_DEPTH / 2);
    const top = Math.round(n.y);
    g.fillStyle(c.mass, 1);
    g.fillRect(left, top, STAIR_TREAD_DEPTH, depth);
    g.fillStyle(i % 2 === 0 ? c.tread : c.treadAlt, 0.95);
    g.fillRect(left, top, STAIR_TREAD_DEPTH, 3);
  }
  // The landing: the middle tread, read wider so the turn is visible.
  const turn = nodes[STAIR_TREADS_PER_FLIGHT];
  g.fillStyle(c.tread, 1);
  g.fillRect(Math.round(turn.x - 22), Math.round(turn.y - 2), 44, 4);
  g.fillStyle(c.edge, 0.95);
  g.fillRect(Math.round(turn.x - 22), Math.round(turn.y + 2), 44, 2);
  // A handrail on the room side of the flight, ending at both mouths.
  const railX = dir === 'up' ? 12 : -12;
  g.lineStyle(2, c.rail, 0.7);
  g.beginPath();
  g.moveTo(nodes[0].x + railX, nodes[0].y - 8);
  for (let i = 1; i < nodes.length; i++) g.lineTo(nodes[i].x + railX, nodes[i].y - 8);
  g.strokePath();
  // Sills at both mouths, so the flight reads as set into the floors.
  g.fillStyle(c.sill, 1);
  g.fillRect(Math.round(x - 24), Math.round(nodes[0].y - 3), 48, 4);
  g.fillRect(Math.round(x - 24), Math.round(nodes[nodes.length - 1].y - 3), 48, 4);
}

/**
 * The straight ladder: two rails hung past both floor lines — "直接挂在
 * 这两个楼层上面" — with a rung at every step height and brackets where the
 * rails enter the floors. Iron in the slum, steel in industry; both are
 * palette values, and the rung pitch matches the stairs' rise so a ladder
 * connection climbs at the same pace a flight would.
 */
/**
 * How far the ladder rails reach past the stair mouth so a rider who climbs
 * out is never standing inside the floor's wall: the gap between two floor
 * bands is FLOOR_HEIGHT - STAIR_RISE, and the shaft has to bridge all of it.
 */
const STAIR_SHAFT_DROP = FLOOR_HEIGHT - STAIR_RISE;

/**
 * The two rails continued past the mouths to the neighbouring floor's line,
 * with a rung every step. The shaft is what makes a vertical ladder read as
 * hanging between two floors ("一条线挂在这两个楼层上面") instead of floating
 * in mid-air — without it the rails stop 10px past the mouth and the climber's
 * lower half stays inside the wall on the way out.
 */
function drawLadderShaft(g: Phaser.GameObjects.Graphics, x: number, direction: number, top: number, bottom: number): void {
  const c = STAIR_COLORS;
  const far = direction === 1 ? bottom + STAIR_SHAFT_DROP : top - STAIR_SHAFT_DROP;
  const railTop = Math.min(top, far);
  const railBottom = Math.max(bottom, far);
  g.fillStyle(c.ironRail, 1);
  g.fillRect(Math.round(x - 11), Math.round(railTop), 3, Math.round(railBottom - railTop));
  g.fillRect(Math.round(x + 8), Math.round(railTop), 3, Math.round(railBottom - railTop));
  g.fillStyle(c.ironRung, 1);
  for (let y = railTop + 8; y < railBottom - 4; y += 14) {
    g.fillRect(Math.round(x - 11), Math.round(y), 22, 3);
  }
}

function drawLadder(g: Phaser.GameObjects.Graphics, x: number, dir: 'up' | 'down', floor: number, shaftDrop = 0): void {
  const direction = dir === 'up' ? 1 : -1;
  const y0 = STAIR_START_Y;
  const y1 = y0 - direction * STAIR_RISE;
  const top = Math.min(y0, y1) - 10;
  const bottom = Math.max(y0, y1) + 10;
  if (shaftDrop > 0) drawLadderShaft(g, x, direction, top, bottom);
  const tier = segmentOf(floor)?.id ?? 1;
  const c = STAIR_COLORS;
  const rail = tier === 3 ? c.steelRail : c.ironRail;
  const rung = tier === 3 ? c.steelRung : c.ironRung;
  g.fillStyle(rail, 1);
  g.fillRect(x - 5, top, 2, bottom - top);
  g.fillRect(x + 3, top, 2, bottom - top);
  g.fillStyle(rung, 1);
  for (let i = 0; i <= STAIR_TREAD_COUNT; i++) {
    const y = Math.round(y0 - direction * i * LADDER_RUNG_SPACING);
    g.fillRect(x - 5, y, 10, 2);
  }
  g.fillStyle(c.bracket, 1);
  g.fillRect(x - 8, top - 2, 16, 3);
  g.fillRect(x - 8, bottom - 1, 16, 3);
}
