import Phaser from 'phaser';

import { addGlow } from './lighting';
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
}

export function buildCeilingLights(scene: Phaser.Scene, opts: CeilingLightOpts): Phaser.GameObjects.GameObject[] {
  const { width, seed, top } = opts;
  const out: Phaser.GameObjects.GameObject[] = [];
  const spacing = 224;
  for (let i = 0; x_ok(i); i++) {
    const x = 112 + i * spacing;
    if (x > width - 60) break;
    const w = h(seed + i * 4.1) > 0.5 ? 46 : 34;
    // The housing: a dark bar with a bright tube inside it. The tube is the
    // brightest thing in the frame on purpose - it is the light source.
    out.push(scene.add.rectangle(x - w / 2, top, w, 5, PALETTE.shadow).setOrigin(0, 0).setDepth(3));
    out.push(scene.add.rectangle(x - w / 2 + 2, top + 1, w - 4, 3, PALETTE.lightHot).setOrigin(0, 0).setDepth(3));
    // Its spill: a wide flat glow under the tube. Flattened so it reads as light
    // falling from a strip rather than a point.
    const glow = addGlow(scene, x, top + 12, 56, 0.42, 4);
    glow.setScale(1.5, 0.8);
    out.push(glow);
    // Two thin hangers up to the ceiling.
    out.push(scene.add.rectangle(x - w / 2 + 6, top - 8, 1, 8, PALETTE.ink).setOrigin(0, 0).setDepth(3));
    out.push(scene.add.rectangle(x + w / 2 - 7, top - 8, 1, 8, PALETTE.ink).setOrigin(0, 0).setDepth(3));
  }
  return out;
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
  const out: Phaser.GameObjects.GameObject[] = [];
  const w = Math.max(8, width);
  // Three nested ellipses: the middle is the darkest and the outer two fade, so
  // the edge is soft without a gradient texture per object.
  const layers: ReadonlyArray<readonly [number, number]> = [
    [1, alpha * 0.4],
    [0.72, alpha * 0.7],
    [0.45, alpha],
  ];
  for (const [scale, a] of layers) {
    out.push(
      scene.add
        .rectangle(x, feetY - 1, w * scale, Math.max(2, w * 0.13 * scale), PALETTE.ink)
        .setOrigin(0.5, 0.5)
        .setAlpha(a)
        .setDepth(depth),
    );
  }
  return out;
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
  const out: Phaser.GameObjects.GameObject[] = [];
  const D = 1; // background plane: above the art, below the props
  // The band a wall-mounted thing can occupy.
  const top = 26;
  const bottom = wallBottom - 26;
  const clear = (x: number): boolean => keepClear.every((k) => Math.abs(k - x) > 60);

  // Vertical service pipes running the full height, with brackets.
  for (let x = 70; x < width; x += 150 + Math.round(hh(seed + x) * 60)) {
    if (!clear(x)) continue;
    const w = hh(seed + x * 2.1) > 0.6 ? 4 : 3;
    out.push(scene.add.rectangle(x, top - 10, w, bottom - top + 14, PALETTE.ink).setOrigin(0, 0).setAlpha(0.85).setDepth(D));
    out.push(scene.add.rectangle(x, top - 10, 1, bottom - top + 14, PALETTE.dust).setOrigin(0, 0).setAlpha(0.75).setDepth(D));
    for (let y = top + 6; y < bottom; y += 44) {
      out.push(scene.add.rectangle(x - 2, y, w + 4, 2, PALETTE.dust).setOrigin(0, 0).setAlpha(0.8).setDepth(D));
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
    out.push(scene.add.rectangle(0, y, width, 5, PALETTE.ink).setOrigin(0, 0).setAlpha(0.8).setDepth(D));
    out.push(scene.add.rectangle(0, y, width, 1, PALETTE.dust).setOrigin(0, 0).setAlpha(0.55).setDepth(D + 1));
    // Clamps every few metres, so the run has rhythm instead of being a stripe.
    for (let x = 20; x < width; x += 84) {
      out.push(scene.add.rectangle(x, y - 2, 4, 9, PALETTE.stoneLight).setOrigin(0, 0).setAlpha(0.9).setDepth(D + 1));
      out.push(scene.add.rectangle(x, y - 2, 1, 9, PALETTE.ink).setOrigin(0, 0).setAlpha(0.5).setDepth(D + 2));
    }
  }

  // Vent grilles and junction boxes at varied heights.
  // 14 of these across 1280px left the middle of the wall measurably empty - an
  // edge-density grid put whole cells at 2-4% - so there are twice as many now,
  // spread by a seeded hash that fills the gaps instead of clustering.
  for (let i = 0; i < 30; i++) {
    const x = 40 + Math.round(hh(seed + i * 17.3) * (width - 80));
    if (!clear(x)) continue;
    const y = top + 20 + Math.round(hh(seed + i * 5.9) * (bottom - top - 60));
    if (hh(seed + i * 7.7) > 0.5) {
      // vent: a dark recess with slats
      out.push(scene.add.rectangle(x, y, 26, 14, PALETTE.ink).setOrigin(0, 0).setAlpha(0.95).setDepth(D));
      for (let s = 0; s < 4; s++) {
        out.push(scene.add.rectangle(x + 3, y + 2 + s * 3, 20, 1, PALETTE.stoneLight).setOrigin(0, 0).setAlpha(0.9).setDepth(D + 1));
      }
    } else {
      // junction box with a conduit down to the skirting
      out.push(scene.add.rectangle(x, y, 16, 12, PALETTE.stoneLight).setOrigin(0, 0).setAlpha(0.95).setDepth(D));
      out.push(scene.add.rectangle(x + 2, y + 2, 12, 1, PALETTE.dust).setOrigin(0, 0).setAlpha(0.9).setDepth(D + 1));
      out.push(scene.add.rectangle(x + 7, y + 12, 2, bottom - (y + 12), PALETTE.ink).setOrigin(0, 0).setAlpha(0.85).setDepth(D));
    }
  }

  // Faded signage: pale rectangles with a couple of dark strokes. They read as
  // notices at a glance and cost nothing.
  for (let i = 0; i < 12; i++) {
    const x = 90 + Math.round(hh(seed + i * 23.1) * (width - 180));
    if (!clear(x)) continue;
    const y = 48 + Math.round(hh(seed + i * 3.7) * 70);
    out.push(scene.add.rectangle(x, y, 22, 14, PALETTE.dust).setOrigin(0, 0).setAlpha(0.72).setDepth(D));
    out.push(scene.add.rectangle(x + 3, y + 4, 16, 1, PALETTE.shadow).setOrigin(0, 0).setAlpha(0.5).setDepth(D + 1));
    out.push(scene.add.rectangle(x + 3, y + 8, 11, 1, PALETTE.shadow).setOrigin(0, 0).setAlpha(0.5).setDepth(D + 1));
  }

  return out;
}

export function buildFloorClutter(scene: Phaser.Scene, opts: DressingOpts): Phaser.GameObjects.GameObject[] {
  const { width, wallBottom, seed, keepClear } = opts;
  const out: Phaser.GameObjects.GameObject[] = [];
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
      out.push(scene.add.rectangle(x, wallBottom - 9, w, 9, PALETTE.ink).setOrigin(0, 0).setAlpha(1).setDepth(D));
      out.push(scene.add.rectangle(x + 1, wallBottom - 9, w - 2, 2, PALETTE.dust).setOrigin(0, 0).setAlpha(0.8).setDepth(D + 1));
    } else if (kind < 0.64) {
      // scattered paper / a flattened box
      out.push(scene.add.rectangle(x, wallBottom - 2, 14 + Math.round(hh(seed + i * 2.2) * 8), 2, PALETTE.dust).setOrigin(0, 0).setAlpha(0.5).setDepth(D));
    } else if (kind < 0.85) {
      // a fallen plank leaning on the wall
      out.push(
        scene.add.rectangle(x, wallBottom - 22, 3, 22, PALETTE.dust).setOrigin(0, 0).setAlpha(0.85).setDepth(D).setAngle(8),
      );
    } else {
      // a small pile of rubble
      out.push(scene.add.rectangle(x, wallBottom - 6, 10, 6, PALETTE.ink).setOrigin(0, 0).setAlpha(1).setDepth(D));
      out.push(scene.add.rectangle(x + 8, wallBottom - 4, 6, 4, PALETTE.stoneLight).setOrigin(0, 0).setAlpha(0.95).setDepth(D));
    }
  }
  return out;
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
  const out: Phaser.GameObjects.GameObject[] = [];
  // Six bands from the top of the wall down: strongest at the top (furthest),
  // gone by the floor line. Depth 2, above the surface detail, below the props.
  const bands = 6;
  for (let i = 0; i < bands; i++) {
    const t0 = i / bands;
    const t1 = (i + 1) / bands;
    // The top band is the farthest, so alpha falls as we come down.
    const a = strength * (1 - t0) * (1 - t0);
    out.push(
      scene.add
        .rectangle(0, 8 + (wallBottom - 8) * t0, width, (wallBottom - 8) * (t1 - t0) + 1, hazeColor)
        .setOrigin(0, 0)
        .setAlpha(a * 0.42)
        .setDepth(2),
    );
  }
  return out;
}
