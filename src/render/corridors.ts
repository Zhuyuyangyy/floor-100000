import Phaser from 'phaser';
import { ROOM_WIDTH } from '../core/constants';

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
import { LIGHT_DEPTH } from './lighting';
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

  ctx.objects.push(ctx.scene.add.image(doorX, floorY, 'tile_door').setOrigin(0.5, 1));
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
  const stack = 2 + variant(ctx.floor, room, 2);
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

/** Draws one room of a corridor floor into the shared detail layer. */
export function drawCorridorRoom(ctx: CorridorContext): void {
  THEMES[ctx.floor]?.(ctx);
}

/** The wall tint for a floor, or null when the floor draws its own base. */
export function corridorTint(floor: number): { color: number; alpha: number } | null {
  return CORRIDOR_TINT[floor] ?? null;
}
