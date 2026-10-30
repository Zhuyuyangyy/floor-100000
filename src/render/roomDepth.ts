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
