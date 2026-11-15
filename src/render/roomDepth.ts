import type Phaser from 'phaser';

import { addGlow, LIGHT_DEPTH } from './lighting';
import { startFxLoop } from './fx';
import { PALETTE } from './palette.ts';

// OVERHAUL Art Pass 2: room depth.
//
// The owner's verdict on a corridor screenshot was that the whole thing was
// crude, and the pixel audit agreed with three specific faults: the floor was a
// flat band of one colour with no texture at all, the wall had no vertical
// shading so the room read as a backdrop rather than a volume, and there was no
// foreground layer at all — everything sat on one plane.
//
// A 640x360 room does not have the pixels for perspective geometry, but it does
// have enough for the three cues that make a side view read as a place:
//
//   1. a ceiling shadow that darkens the top of the wall, so the wall curves
//      away from the viewer;
//   2. a baseboard shadow where the wall meets the floor, which is the seam that
//      tells you where the vertical plane ends;
//   3. reflections on the floor under each light, which is the single strongest
//      mood cue in the reference and costs one stretched glow each.
//
// Everything here is additive or dark-wash: no asset is touched and the room's
// own art keeps its detail.
//
// DEPTH RULE, learned the hard way: these bands sit at depth 0, the same as the
// room art they tint. The wall and floor images are added first, so equal depth
// plus later insertion puts the shading on top of them - and the props and the
// player are added after that, so they render at full colour ABOVE the shading.
// An earlier version had them at depth 2-3 and every prop and the player sat
// under a 40%-alpha cold wash, which is why the character read as a dark blob.

export interface RoomDepthOpts {
  /** full world width */
  width: number;
  /** the wall/floor seam */
  wallBottom: number;
  /** canvas height */
  height: number;
  /** world x of every warm light on this floor, for the floor reflections */
  lightXs: readonly number[];
  /** the floor's y range end (usually height) */
  bottom?: number;
}

// ── batching the static scenery ───────────────────────────────────────────
// Measured before (AG-09, Playwright census of the Game scene's display tree,
// floors 1/5/100/10000): a floor owned 1420-2093 GameObjects, of which
// 1184-1812 were Rectangles — the wall dressing alone was ~300 of them, and
// with STACK_ABOVE/STACK_BELOW neighbours the same scenery was built three to
// five times per floor. Every floor change destroyed and rebuilt all of it.
//
// RectBatcher draws those rectangles into one Graphics per depth instead.
//
// Fidelity: a Graphics fillRect and a Rectangle both submit one flat quad to
// the same BatchHandlerTriFlat batch (see Phaser's FillRect render node), so
// the composited image is identical — same colour, alpha, size and order. Only
// the object count changes: the dressing becomes 3 Graphics instead of ~300
// objects.
//
// Tint transparency: drawNeighbourFloor dims a neighbour by calling setTint on
// everything that has one. Verified against Phaser 4.2.1 at runtime: Rectangle
// mixes in no Tint component (Shape's mixin list has none), so neighbour
// rectangles have never been dimmed that way — and a Graphics has no setTint
// either, so batching does not change what the dimming touches. The one
// Rectangle-specific branch in that loop (the ceiling tube's lightHot fill
// swap) keeps its object: buildCeilingLights still returns the tube as a
// Rectangle.
//
// Order: within one depth, Phaser sorts by insertion, and a batcher emits one
// Graphics per depth at the position of that depth's first rectangle, so the
// relative order of same-depth rectangles — the only order the renderer sees —
// is exactly what it was. Across depths nothing changes, because depth is the
// primary sort key.

/** One Graphics per depth, collecting this floor's static rectangles. */
class RectBatcher {
  private readonly scene: Phaser.Scene;
  private readonly layers = new Map<number, Phaser.GameObjects.Graphics>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  private layer(depth: number): Phaser.GameObjects.Graphics {
    let g = this.layers.get(depth);
    if (!g) {
      g = this.scene.add.graphics().setDepth(depth);
      this.layers.set(depth, g);
    }
    return g;
  }

  /** Top-left anchored, which is how every rectangle in this file is drawn. */
  add(x: number, y: number, w: number, h: number, color: number, alpha: number, depth: number): void {
    const g = this.layer(depth);
    g.fillStyle(color, alpha);
    g.fillRect(x, y, w, h);
  }

  /** Centre-anchored, for the few rectangles drawn around a centre point. */
  addCentred(x: number, y: number, w: number, h: number, color: number, alpha: number, depth: number): void {
    this.add(x - w / 2, y - h / 2, w, h, color, alpha, depth);
  }

  /**
   * A rectangle rotated around its top-left corner — the one shape a flat
   * fillRect cannot express (the fallen plank in buildFloorClutter). Drawn
   * with the Graphics' own transform stack so it stays inside the batch
   * instead of costing an object of its own.
   */
  addRotatedAtOrigin(x: number, y: number, w: number, h: number, angleDeg: number, color: number, alpha: number, depth: number): void {
    const g = this.layer(depth);
    g.save();
    g.translateCanvas(x, y);
    g.rotateCanvas((angleDeg * Math.PI) / 180);
    g.fillStyle(color, alpha);
    g.fillRect(0, 0, w, h);
    g.restore();
  }

  /** The batched Graphics, in the order their first rectangle appeared. */
  out(): Phaser.GameObjects.GameObject[] {
    return [...this.layers.values()];
  }
}

/** Stepped vertical gradient: an opaque-ish band at the top fading to nothing. */
function verticalFadeInto(
  batch: RectBatcher,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  fromAlpha: number,
  depth: number,
): void {
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    batch.add(x, y + h * t, w, h / steps + 1, color, fromAlpha * (1 - t) * (1 - t), depth);
  }
}

export function buildRoomDepth(scene: Phaser.Scene, opts: RoomDepthOpts): Phaser.GameObjects.GameObject[] {
  const { width, wallBottom, height } = opts;
  const bottom = opts.bottom ?? height;
  const batch = new RectBatcher(scene);

  // 1. Ceiling: the top of the wall falls into shadow. Without this the wall is
  //    one flat value from floor to ceiling and the room has no ceiling.
  verticalFadeInto(batch, 0, 8, width, Math.round(wallBottom * 0.42), 0x05080b, 0.62, 0);

  // 2. Baseboard: a hard dark seam plus a short soft shadow under it, so the
  //    wall meets the floor instead of dissolving into it.
  batch.add(0, wallBottom - 3, width, 3, 0x05080b, 0.75, 0);
  verticalFadeInto(batch, 0, wallBottom, width, 10, 0x05080b, 0.5, 0);

  // 3. Floor: a shallow gradient running away from the wall — lighter at the
  //    seam (light falls there), darker toward the viewer. This is what stops
  //    the floor reading as a painted band.
  const floorH = bottom - wallBottom;
  for (let i = 0; i < 5; i++) {
    const t = i / 5;
    batch.add(0, wallBottom + floorH * t, width, floorH / 5 + 1, 0x03060a, 0.06 + t * 0.3, 0);
  }

  const out = batch.out();

  // 4. Reflections: each warm light throws a soft streak down the floor toward
  //    the viewer. One stretched glow each — cheap, and it is the cue that
  //    reads "wet concrete" in the reference photo.
  for (const lx of opts.lightXs) {
    // LIGHT_DEPTH, not 4. These two were the only glows still under the night
    // overlay (depth 23), so the darker the night got the dimmer the ceiling
    // fixtures and the floor reflections became - backwards, and invisible until
    // the overlay started rendering at all.
    const streak = addGlow(scene, lx, wallBottom + floorH * 0.55, 40, 0.16, LIGHT_DEPTH);
    streak.setScale(0.55, 1.5);
    out.push(streak);
  }

  return out;
}

// ── foreground ─────────────────────────────────────────────────────────────
// The layer the room never had, and the single cheapest way to make a side view
// read as a place with depth: dark shapes in FRONT of the player.
//
// Every 2D side-scroller that looks like a game does this - a beam across the top
// of the frame, debris along the bottom edge, something at the left or right
// margin. It gives the camera a position inside the room instead of looking at a
// painted wall, and it costs nothing but a few dark rectangles.
//
// Kept to the frame's edges on purpose: foreground that covers the middle eats
// the player's ability to see what they are walking into.
const FG = 0x02040a;

export interface ForegroundOpts {
  width: number;
  height: number;
  /** the wall/floor seam */
  wallBottom: number;
  /** deterministic per floor so the debris does not reshuffle on reload */
  seed: number;
}

/** A cheap deterministic hash -> 0..1, no dependency on the game's RNG. */
function h01(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

export function buildForeground(scene: Phaser.Scene, opts: ForegroundOpts): Phaser.GameObjects.GameObject[] {
  const { width, height, wallBottom, seed } = opts;
  const batch = new RectBatcher(scene);
  // Depth 30: above the player (10), the light pools (20 is below this) and the
  // vignette's lower bands. Foreground has to be in front of everything or it is
  // not foreground.
  const FG_DEPTH = 26;

  // 1. The ceiling overhang: a beam across the top, with a few hangers. It crops
  //    the top of the wall and makes the room feel enclosed.
  batch.add(0, 0, width, 14, FG, 0.92, FG_DEPTH);
  for (let x = 40; x < width; x += 118) {
    const h = 8 + Math.round(h01(seed + x) * 10);
    batch.add(x, 0, 3, 14 + h, FG, 0.92, FG_DEPTH);
  }

  // 2. Floor debris along the bottom edge: low, irregular, and never taller than
  //    the player's knees, so it frames the walk without hiding it.
  let x = 0;
  let i = 0;
  while (x < width) {
    const w = 18 + Math.round(h01(seed + i * 7.3) * 46);
    const h = 4 + Math.round(h01(seed + i * 3.1) * 12);
    batch.add(x, height - h, w, h, FG, 0.9, FG_DEPTH);
    // A slightly taller lump every few pieces, so the edge is not a sawtooth.
    if (h01(seed + i * 11.7) > 0.72) {
      const tallW = 10 + Math.round(h01(seed + i) * 16);
      const tallH = 10 + Math.round(h01(seed + i * 5.5) * 16);
      batch.add(x + 4, height - tallH, tallW, tallH, FG, 0.9, FG_DEPTH);
    }
    x += w + 6 + Math.round(h01(seed + i * 2.2) * 26);
    i++;
  }

  // 3. Side margins: a narrow dark edge at the left and right of the frame. In a
  //    scrolling camera these read as the near walls of the room you are in.
  batch.add(0, 0, 10, wallBottom, FG, 0.55, FG_DEPTH);
  batch.add(width - 10, 0, 10, wallBottom, FG, 0.55, FG_DEPTH);

  return batch.out();
}

// ── surface detail ─────────────────────────────────────────────────────────
// The wall and floor are single wide PNGs, and the measurement said what that
// costs: the wall's own luminance varies by a standard deviation of 4 across its
// whole area, and the floor was one flat band. A room whose two largest surfaces
// are flat has nothing for the eye to rest on, however good the lighting is.
//
// This lays procedurally generated detail on top of the art instead of replacing
// it: water streaks down the wall, darker panel seams, stains along the base,
// tile lines and puddle highlights on the floor. All of it is seeded, so a floor
// looks the same every time it is entered.

/** Deterministic 0..1 from an integer-ish seed. */
function h(n: number): number {
  const x = Math.sin(n * 91.7 + 7.3) * 43758.5453;
  return x - Math.floor(x);
}

export interface SurfaceDetailOpts {
  width: number;
  /** wall/floor seam */
  wallBottom: number;
  /** canvas height */
  height: number;
  seed: number;
}

export function buildSurfaceDetail(scene: Phaser.Scene, opts: SurfaceDetailOpts): Phaser.GameObjects.GameObject[] {
  const { width, wallBottom, height, seed } = opts;
  const batch = new RectBatcher(scene);
  // Depth 1: above the base art and the depth wash, below the props and the
  // player, so the detail reads as part of the wall rather than as paint on top.
  const D = 1;

  // Water streaks: thin vertical runs from the top of the wall down, varying
  // length and alpha. The strongest single cue that a building is abandoned.
  for (let i = 0; i < 26; i++) {
    const x = Math.round(h(seed + i * 3.7) * width);
    const len = 24 + Math.round(h(seed + i * 9.1) * (wallBottom * 0.62));
    const w = h(seed + i * 5.3) > 0.7 ? 2 : 1;
    const alpha = 0.05 + h(seed + i * 1.9) * 0.1;
    batch.add(x, 8, w, len, 0x03060a, alpha, D);
  }

  // Panel seams: the wall is poured concrete in bays, and a few vertical lines
  // break the surface into readable sections.
  for (let x = 96; x < width; x += 192) {
    const jitter = Math.round(h(seed + x) * 6) - 3;
    batch.add(x + jitter, 8, 1, wallBottom - 10, 0x03060a, 0.3, D);
  }

  // Base stains: a darker, irregular band where damp collects along the skirting.
  let bx = 0;
  let k = 0;
  while (bx < width) {
    const w = 30 + Math.round(h(seed + k * 4.4) * 90);
    const hh = 6 + Math.round(h(seed + k * 8.2) * 22);
    batch.add(bx, wallBottom - hh, w, hh, 0x02050a, 0.18 + h(seed + k * 2.6) * 0.2, D);
    bx += w + 20 + Math.round(h(seed + k * 6.1) * 60);
    k++;
  }

  // Floor: tile lines running away from the wall, plus puddle highlights.
  const floorH = height - wallBottom;
  for (let x = 0; x < width; x += 64) {
    batch.add(x, wallBottom, 1, floorH, 0x02050a, 0.22, D);
  }
  for (let y = wallBottom + 10; y < height; y += 14) {
    batch.add(0, y, width, 1, 0x02050a, 0.12, D);
  }
  // Puddles: wide, very low-alpha ellipses that catch the light. Drawn as
  // flattened glows so they brighten rather than darken - a puddle reflects.
  for (let i = 0; i < 7; i++) {
    const x = 60 + Math.round(h(seed + i * 12.9) * (width - 120));
    const y = wallBottom + 12 + Math.round(h(seed + i * 7.7) * (floorH - 24));
    batch.addCentred(x, y, 40 + Math.round(h(seed + i * 3.3) * 60), 5, 0x22384a, 0.3, D + 1);
  }

  return batch.out();
}

// ── ceiling fixtures ──────────────────────────────────────────────────────
// Fluorescent strips hanging from the ceiling, the way the reference render has
// them. Two jobs at once: they give the frame a bright band at the top (which is
// what makes the vertical luminance profile read as a room instead of a wash),
// and they explain where the light in the room comes from. A corridor lit by
// nothing but wall lamps looks like a diorama.
export interface CeilingLightOpts {
  width: number;
  seed: number;
  /** y of the ceiling line */
  top: number;
  /** filled with every flame this builds, so a blackout can put them out */
  fixtures?: Phaser.GameObjects.Sprite[];
}

export function buildCeilingLights(scene: Phaser.Scene, opts: CeilingLightOpts): Phaser.GameObjects.GameObject[] {
  const { width, seed, top } = opts;
  const out: Phaser.GameObjects.GameObject[] = [];
  // Housing and hangers batch together; the tube stays its own Rectangle
  // because drawNeighbourFloor dims a neighbour's lightHot tubes by swapping
  // their fill (an instanceof Rectangle check), and a Graphics cannot answer
  // it. Two rectangles per strip is a fair price for keeping that branch.
  const batch = new RectBatcher(scene);
  const spacing = 224;
  for (let i = 0; x_ok(i); i++) {
    const x = 112 + i * spacing;
    if (x > width - 60) break;
    const w = h(seed + i * 4.1) > 0.5 ? 46 : 34;
    // The housing: a dark bar with a bright tube inside it. The tube is the
    // brightest thing in the frame on purpose - it is the light source.
    batch.add(x - w / 2, top, w, 5, PALETTE.shadow, 1, 3);
    out.push(scene.add.rectangle(x - w / 2 + 2, top + 1, w - 4, 3, PALETTE.lightHot).setOrigin(0, 0).setDepth(3));
    // Its spill: a wide flat glow under the tube. Flattened so it reads as light
    // falling from a strip rather than a point.
    //
    // The tube itself now flickers. A fluorescent strip does not hold a steady
    // value - it hums and varies - and a static bright rectangle is the one thing
    // that made these read as painted decals rather than as working lights. The
    // pixelfx torch is a 60-frame loop of a licking flame on a bracket, which at
    // this size reads exactly as a failing tube, and it is placed so its flame
    // sits inside the housing.
    const tube = startFxLoop(scene, 'torch', x, top - 4, LIGHT_DEPTH);
    if (tube) {
      out.push(tube);
      // handed back so the caller can put it out during a blackout
      if (opts.fixtures) opts.fixtures.push(tube);
    }
    const glow = addGlow(scene, x, top + 12, 56, 0.42, LIGHT_DEPTH);
    glow.setScale(1.5, 0.8);
    out.push(glow);
    // Two thin hangers up to the ceiling.
    batch.add(x - w / 2 + 6, top - 8, 1, 8, PALETTE.ink, 1, 3);
    batch.add(x + w / 2 - 7, top - 8, 1, 8, PALETTE.ink, 1, 3);
  }
  return [...batch.out(), ...out];
}

/** Kept as a named predicate so the loop reads as intent, not arithmetic. */
function x_ok(_i: number): boolean {
  return true;
}

// ── contact shadows ───────────────────────────────────────────────────────
// Every object in a side view needs a shadow where it meets the floor, and none
// of them had one. That single omission is why props read as stickers applied to
// a backdrop and why the player looks like they are hovering: without a contact
// shadow nothing is anchored to the ground plane.
//
// Drawn as a flattened dark ellipse at the feet, wider than the object is tall,
// with the alpha falling off toward its tips so it reads as shadow rather than
// as a painted oval.
export function addContactShadow(
  scene: Phaser.Scene,
  x: number,
  feetY: number,
  width: number,
  depth = 2,
  alpha = 0.5,
): Phaser.GameObjects.GameObject[] {
  const batch = new RectBatcher(scene);
  const w = Math.max(8, width);
  // Three nested ellipses: the middle is the darkest and the outer two fade, so
  // the edge is soft without a gradient texture per object.
  const layers: ReadonlyArray<readonly [number, number]> = [
    [1, alpha * 0.4],
    [0.72, alpha * 0.7],
    [0.45, alpha],
  ];
  for (const [scale, a] of layers) {
    batch.addCentred(x, feetY - 1, w * scale, Math.max(2, w * 0.13 * scale), PALETTE.ink, a, depth);
  }
  return batch.out();
}

// ── wall dressing and floor clutter ───────────────────────────────────────
// The reference render is dense: pipes, conduits, vents, junction boxes, signage,
// and debris along the floor. This project's floors had two or three props on a
// 1280px wall, which is why a room that measures well still looks EMPTY - the
// audit only scores colour and contrast, and an empty frame can score perfectly
// while having nothing in it.
//
// Two layers, deliberately at different contrast levels so they separate:
//   - WALL DRESSING sits on the background plane and is deliberately LOW
//     contrast (alpha 0.5-0.75, palette stone values only). It should read as
//     the building, not as things to interact with.
//   - FLOOR CLUTTER sits on the floor line at higher contrast, because it is
//     nearer and because the eye needs something to land on at the bottom.
// Anything the player can actually interact with is drawn by the scene, not
// here - this is scenery only.

function hh(n: number): number {
  const x = Math.sin(n * 53.9 + 3.1) * 24634.6345;
  return x - Math.floor(x);
}

export interface DressingOpts {
  width: number;
  wallBottom: number;
  seed: number;
  /** skip dressing in these x ranges (exits, so nothing hides a stairwell) */
  keepClear: readonly number[];
}

export function buildWallDressing(scene: Phaser.Scene, opts: DressingOpts): Phaser.GameObjects.GameObject[] {
  const { width, wallBottom, seed, keepClear } = opts;
  const batch = new RectBatcher(scene);
  const D = 1; // background plane: above the art, below the props
  // The band a wall-mounted thing can occupy.
  const top = 26;
  const bottom = wallBottom - 26;
  const clear = (x: number): boolean => keepClear.every((k) => Math.abs(k - x) > 60);

  // Vertical service pipes running the full height, with brackets.
  for (let x = 70; x < width; x += 150 + Math.round(hh(seed + x) * 60)) {
    if (!clear(x)) continue;
    const w = hh(seed + x * 2.1) > 0.6 ? 4 : 3;
    batch.add(x, top - 10, w, bottom - top + 14, PALETTE.ink, 0.85, D);
    batch.add(x, top - 10, 1, bottom - top + 14, PALETTE.dust, 0.75, D);
    for (let y = top + 6; y < bottom; y += 44) {
      batch.add(x - 2, y, w + 4, 2, PALETTE.dust, 0.8, D);
    }
  }

  // Horizontal conduit runs across the whole floor.
  //
  // A grid analysis of the finished screen found the flattest region was the
  // MIDDLE of the wall - 32-34% of those cells in one colour - which is exactly
  // where the player walks and what the eye rests on. The vertical pipes were
  // spread by a seeded step, so whole stretches had nothing on them. A
  // horizontal run cannot leave a gap: it crosses every column, and it reads as
  // building services rather than as decoration.
  const runs = [0.22, 0.42, 0.62];
  for (let ri = 0; ri < runs.length; ri++) {
    const y = Math.round(8 + (wallBottom - 8) * runs[ri]);
    batch.add(0, y, width, 5, PALETTE.ink, 0.8, D);
    batch.add(0, y, width, 1, PALETTE.dust, 0.55, D + 1);
    // Clamps every few metres, so the run has rhythm instead of being a stripe.
    for (let x = 20; x < width; x += 84) {
      batch.add(x, y - 2, 4, 9, PALETTE.stoneLight, 0.9, D + 1);
      batch.add(x, y - 2, 1, 9, PALETTE.ink, 0.5, D + 2);
    }
  }

  // The 12 real fixtures, instead of rects that only suggested them.
  //
  // Until 2026-11-15 this loop drew vents as four 1px lines and junction boxes as
  // a 16x12 rectangle with a stripe: readable as "building services" but never as
  // objects. The pack's sprite sheet gives actual silhouettes — a valve wheel, a
  // fusebox with its door ajar, a fire extinguisher — and at 26px wide they were
  // still legible when tested at 4x.
  //
  // Count dropped from 30 to 12 when the rects became art. The old 30 were the
  // price of drawing walls out of 2px lines: 14 left whole grid cells empty, so
  // it took double. Real silhouettes carry much more weight per object — at 30
  // the wall read as stickers rather than as a building, which is the same
  // "busier, not richer" failure the 2026-11-14 audit predicted for dressing
  // drawn in the same visual vocabulary as its wall. They are also dimmed to 0.8
  // so they sit in the wall instead of on it.
  const FIXTURES = [
    'vent', 'junction', 'notice', 'valve', 'bracket', 'hooks',
    'extinguisher', 'fusebox', 'gauge', 'cable', 'hazard', 'plate',
  ] as const;
  const out = batch.out();
  for (let i = 0; i < 12; i++) {
    const x = 40 + Math.round(hh(seed + i * 17.3) * (width - 80));
    if (!clear(x)) continue;
    const pick = FIXTURES[Math.floor(hh(seed + i * 11.7) * FIXTURES.length) % FIXTURES.length];
    const key = `env-fixture-${pick}`;
    if (!scene.textures.exists(key)) continue;
    const src = scene.textures.get(key).getSourceImage() as { width: number; height: number };
    // Keep the whole fixture inside the wall band: a 48px extinguisher dropped at
    // y=bottom would hang off the skirting.
    const y = top + 16 + Math.round(hh(seed + i * 5.9) * Math.max(1, bottom - top - src.height - 24));
    if (y + src.height > bottom - 4) continue;
    out.push(scene.add.image(x, y, key).setOrigin(0, 0).setDepth(D + 1).setAlpha(0.8));
  }

  return out;
}

export function buildFloorClutter(scene: Phaser.Scene, opts: DressingOpts): Phaser.GameObjects.GameObject[] {
  const { width, wallBottom, seed, keepClear } = opts;
  const batch = new RectBatcher(scene);
  // Midground: ON the floor, in front of the wall, behind the player.
  const D = 3;
  const clear = (x: number): boolean => keepClear.every((k) => Math.abs(k - x) > 56);

  for (let i = 0; i < 22; i++) {
    const x = 30 + Math.round(hh(seed + i * 11.3) * (width - 60));
    if (!clear(x)) continue;
    const kind = hh(seed + i * 4.9);
    if (kind < 0.34) {
      // a slumped sack / refuse bag
      const w = 12 + Math.round(hh(seed + i) * 10);
      batch.add(x, wallBottom - 9, w, 9, PALETTE.ink, 1, D);
      batch.add(x + 1, wallBottom - 9, w - 2, 2, PALETTE.dust, 0.8, D + 1);
    } else if (kind < 0.64) {
      // scattered paper / a flattened box
      batch.add(x, wallBottom - 2, 14 + Math.round(hh(seed + i * 2.2) * 8), 2, PALETTE.dust, 0.5, D);
    } else if (kind < 0.85) {
      // a fallen plank leaning on the wall — the one rotated shape, drawn
      // through the Graphics' transform stack so it stays in the batch
      batch.addRotatedAtOrigin(x, wallBottom - 22, 3, 22, 8, PALETTE.dust, 0.85, D);
    } else {
      // a small pile of rubble
      batch.add(x, wallBottom - 6, 10, 6, PALETTE.ink, 1, D);
      batch.add(x + 8, wallBottom - 4, 6, 4, PALETTE.stoneLight, 0.95, D);
    }
  }
  return batch.out();
}

// ── aerial perspective ────────────────────────────────────────────────────
// The last depth cue, and the cheapest: things further away are LOWER contrast
// and slightly bluer, because air is between you and them. In a side view the
// "distance" axis is toward the top of the wall, so the wall gets progressively
// hazier with height while the floor - nearest the camera - stays crisp.
//
// This is not a vignette. A vignette darkens the edges of the frame; this
// reduces contrast with height, which is what tells the eye that the wall
// recedes. The haze is the floor's ambient colour at low alpha, so it also ties
// each floor's atmosphere into its own depth.
export interface HazeOpts {
  width: number;
  /** where the wall meets the floor */
  wallBottom: number;
  /** the floor's ambient colour, so the haze belongs to this floor */
  hazeColor: number;
  /** 0..1, how strong the far haze is */
  strength?: number;
}

export function buildAerialHaze(scene: Phaser.Scene, opts: HazeOpts): Phaser.GameObjects.GameObject[] {
  const { width, wallBottom, hazeColor } = opts;
  const strength = opts.strength ?? 0.3;
  const batch = new RectBatcher(scene);
  // Six bands from the top of the wall down: strongest at the top (furthest),
  // gone by the floor line. Depth 2, above the surface detail, below the props.
  const bands = 6;
  for (let i = 0; i < bands; i++) {
    const t0 = i / bands;
    const t1 = (i + 1) / bands;
    // The top band is the farthest, so alpha falls as we come down.
    const a = strength * (1 - t0) * (1 - t0);
    batch.add(0, 8 + (wallBottom - 8) * t0, width, (wallBottom - 8) * (t1 - t0) + 1, hazeColor, a * 0.42, 2);
  }
  return batch.out();
}

// ── the leak ──────────────────────────────────────────────────────────────
// The world events had no visual signature: blackout darkens the frame (through
// the night overlay) and the wanderer is an NPC, but a leak only changed which
// loot was damp. Measured across the three states, the frame was
// indistinguishable. A floor that is flooding should look like it.
export interface LeakOpts {
  width: number;
  floorY: number;
  seed: number;
}

export function buildLeakEffect(scene: Phaser.Scene, opts: LeakOpts): Phaser.GameObjects.GameObject[] {
  const { width, floorY, seed } = opts;
  const out: Phaser.GameObjects.GameObject[] = [];
  // Standing water: flattened ellipses on the floor, lit at the top edge so they
  // read as wet rather than as holes.
  for (let i = 0; i < 7; i++) {
    const x = 60 + hh(seed + i * 7.7) * (width - 120);
    const w = 34 + hh(seed + i * 3.1) * 70;
    const h = 5 + hh(seed + i * 5.3) * 4;
    const g = scene.add.graphics().setDepth(3);
    g.fillStyle(PALETTE.clothDeep, 0.55);
    g.fillEllipse(x, floorY + 2, w, h);
    g.fillStyle(PALETTE.clothHigh, 0.22);
    g.fillEllipse(x, floorY, w * 0.82, h * 0.45);
    out.push(g);
  }
  // Ceiling drips: a short vertical line from above, on a slow cycle so the
  // floor looks like it is still coming down.
  for (let i = 0; i < 5; i++) {
    const x = 90 + hh(seed + i * 11.9) * (width - 180);
    const drip = scene.add.rectangle(x, 120, 1, 7, PALETTE.clothHigh).setAlpha(0.5).setDepth(3);
    scene.tweens.add({
      targets: drip,
      y: floorY - 4,
      alpha: { from: 0.55, to: 0 },
      duration: 900 + hh(seed + i) * 700,
      repeat: -1,
      delay: i * 420,
      ease: 'Quad.In',
    });
    out.push(drip);
  }
  return out;
}
