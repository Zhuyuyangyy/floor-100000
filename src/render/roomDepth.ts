import Phaser from 'phaser';

import { addGlow } from './lighting';

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

/** Stepped vertical gradient: an opaque-ish band at the top fading to nothing. */
function verticalFade(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  fromAlpha: number,
  depth: number,
): Phaser.GameObjects.GameObject[] {
  const out: Phaser.GameObjects.GameObject[] = [];
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const band = scene.add
      .rectangle(x, y + h * t, w, h / steps + 1, color)
      .setOrigin(0, 0)
      .setAlpha(fromAlpha * (1 - t) * (1 - t))
      .setDepth(depth);
    out.push(band);
  }
  return out;
}

export function buildRoomDepth(scene: Phaser.Scene, opts: RoomDepthOpts): Phaser.GameObjects.GameObject[] {
  const { width, wallBottom, height } = opts;
  const bottom = opts.bottom ?? height;
  const out: Phaser.GameObjects.GameObject[] = [];

  // 1. Ceiling: the top of the wall falls into shadow. Without this the wall is
  //    one flat value from floor to ceiling and the room has no ceiling.
  out.push(...verticalFade(scene, 0, 8, width, Math.round(wallBottom * 0.42), 0x05080b, 0.62, 0));

  // 2. Baseboard: a hard dark seam plus a short soft shadow under it, so the
  //    wall meets the floor instead of dissolving into it.
  out.push(scene.add.rectangle(0, wallBottom - 3, width, 3, 0x05080b).setOrigin(0, 0).setAlpha(0.75).setDepth(0));
  out.push(...verticalFade(scene, 0, wallBottom, width, 10, 0x05080b, 0.5, 0));

  // 3. Floor: a shallow gradient running away from the wall — lighter at the
  //    seam (light falls there), darker toward the viewer. This is what stops
  //    the floor reading as a painted band.
  const floorH = bottom - wallBottom;
  for (let i = 0; i < 5; i++) {
    const t = i / 5;
    out.push(
      scene.add
        .rectangle(0, wallBottom + floorH * t, width, floorH / 5 + 1, 0x03060a)
        .setOrigin(0, 0)
        .setAlpha(0.06 + t * 0.3)
        .setDepth(0),
    );
  }

  // 4. Reflections: each warm light throws a soft streak down the floor toward
  //    the viewer. One stretched glow each — cheap, and it is the cue that
  //    reads "wet concrete" in the reference photo.
  for (const lx of opts.lightXs) {
    const streak = addGlow(scene, lx, wallBottom + floorH * 0.55, 40, 0.16, 4);
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
  const out: Phaser.GameObjects.GameObject[] = [];
  // Depth 30: above the player (10), the light pools (20 is below this) and the
  // vignette's lower bands. Foreground has to be in front of everything or it is
  // not foreground.
  const FG_DEPTH = 26;

  // 1. The ceiling overhang: a beam across the top, with a few hangers. It crops
  //    the top of the wall and makes the room feel enclosed.
  out.push(scene.add.rectangle(0, 0, width, 14, FG).setOrigin(0, 0).setAlpha(0.92).setDepth(FG_DEPTH));
  for (let x = 40; x < width; x += 118) {
    const h = 8 + Math.round(h01(seed + x) * 10);
    out.push(scene.add.rectangle(x, 0, 3, 14 + h, FG).setOrigin(0, 0).setAlpha(0.92).setDepth(FG_DEPTH));
  }

  // 2. Floor debris along the bottom edge: low, irregular, and never taller than
  //    the player's knees, so it frames the walk without hiding it.
  let x = 0;
  let i = 0;
  while (x < width) {
    const w = 18 + Math.round(h01(seed + i * 7.3) * 46);
    const h = 4 + Math.round(h01(seed + i * 3.1) * 12);
    out.push(
      scene.add.rectangle(x, height - h, w, h, FG).setOrigin(0, 0).setAlpha(0.9).setDepth(FG_DEPTH),
    );
    // A slightly taller lump every few pieces, so the edge is not a sawtooth.
    if (h01(seed + i * 11.7) > 0.72) {
      const tallW = 10 + Math.round(h01(seed + i) * 16);
      const tallH = 10 + Math.round(h01(seed + i * 5.5) * 16);
      out.push(scene.add.rectangle(x + 4, height - tallH, tallW, tallH, FG).setOrigin(0, 0).setAlpha(0.9).setDepth(FG_DEPTH));
    }
    x += w + 6 + Math.round(h01(seed + i * 2.2) * 26);
    i++;
  }

  // 3. Side margins: a narrow dark edge at the left and right of the frame. In a
  //    scrolling camera these read as the near walls of the room you are in.
  out.push(scene.add.rectangle(0, 0, 10, wallBottom, FG).setOrigin(0, 0).setAlpha(0.55).setDepth(FG_DEPTH));
  out.push(scene.add.rectangle(width - 10, 0, 10, wallBottom, FG).setOrigin(0, 0).setAlpha(0.55).setDepth(FG_DEPTH));

  return out;
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
  const out: Phaser.GameObjects.GameObject[] = [];
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
    out.push(
      scene.add
        .rectangle(x, 8, w, len, 0x03060a)
        .setOrigin(0, 0)
        .setAlpha(alpha)
        .setDepth(D),
    );
  }

  // Panel seams: the wall is poured concrete in bays, and a few vertical lines
  // break the surface into readable sections.
  for (let x = 96; x < width; x += 192) {
    const jitter = Math.round(h(seed + x) * 6) - 3;
    out.push(
      scene.add.rectangle(x + jitter, 8, 1, wallBottom - 10, 0x03060a).setOrigin(0, 0).setAlpha(0.3).setDepth(D),
    );
  }

  // Base stains: a darker, irregular band where damp collects along the skirting.
  let bx = 0;
  let k = 0;
  while (bx < width) {
    const w = 30 + Math.round(h(seed + k * 4.4) * 90);
    const hh = 6 + Math.round(h(seed + k * 8.2) * 22);
    out.push(
      scene.add
        .rectangle(bx, wallBottom - hh, w, hh, 0x02050a)
        .setOrigin(0, 0)
        .setAlpha(0.18 + h(seed + k * 2.6) * 0.2)
        .setDepth(D),
    );
    bx += w + 20 + Math.round(h(seed + k * 6.1) * 60);
    k++;
  }

  // Floor: tile lines running away from the wall, plus puddle highlights.
  const floorH = height - wallBottom;
  for (let x = 0; x < width; x += 64) {
    out.push(
      scene.add.rectangle(x, wallBottom, 1, floorH, 0x02050a).setOrigin(0, 0).setAlpha(0.22).setDepth(D),
    );
  }
  for (let y = wallBottom + 10; y < height; y += 14) {
    out.push(scene.add.rectangle(0, y, width, 1, 0x02050a).setOrigin(0, 0).setAlpha(0.12).setDepth(D));
  }
  // Puddles: wide, very low-alpha ellipses that catch the light. Drawn as
  // flattened glows so they brighten rather than darken - a puddle reflects.
  for (let i = 0; i < 7; i++) {
    const x = 60 + Math.round(h(seed + i * 12.9) * (width - 120));
    const y = wallBottom + 12 + Math.round(h(seed + i * 7.7) * (floorH - 24));
    const p = scene.add.rectangle(x, y, 40 + Math.round(h(seed + i * 3.3) * 60), 5, 0x22384a);
    p.setOrigin(0.5).setAlpha(0.3).setDepth(D + 1);
    out.push(p);
  }

  return out;
}
