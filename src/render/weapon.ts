// A crowbar, carried visibly.
//
// The game has had a `sword-slash` effect since the melee-feedback pass, but no
// weapon ever existed: the attack clip throws a fist and the slash appeared out
// of empty air above it. An effect with nothing producing it reads as a shader
// artefact, which is exactly how it was reported - "the sword and the effects
// never show up".
//
// So the survivor carries the one weapon this building would actually supply.
// A crowbar is already in the item table and in the loot pool; putting it in the
// survivor's hand costs no new fiction and explains the arc.
//
// It is a separate sprite rather than part of the walk sheet on purpose: the
// sheet is 64x96 and the attack pose already ends at x=57, so a blade drawn
// there has seven pixels of room and reads as a stub. A sprite anchored to the
// hand can be any length and can be swapped without rebaking four characters.
import type Phaser from 'phaser';

import { PALETTE } from './palette.ts';

export const WEAPON_KEY = 'weapon-crowbar';

// Long enough to read as a weapon beside a 64x96 figure, short enough that it
// does not cross the whole corridor when it is swung.
//
// The first version was 36x13 with a 5px shaft and no outline. At 1:1 it was a
// two-pixel grey line against a grey-blue wall - measured, a full six times
// magnification was needed to identify it, which is the same as not drawing it.
// The project's own rule applies: if it matters, it needs a guaranteed edge.
export const WEAPON_W = 46;
export const WEAPON_H = 18;

/** Where the hand grips it, in texture pixels. Every rotation pivots here. */
export const WEAPON_GRIP_X = 4;
export const WEAPON_GRIP_Y = 9;

const ROD = 5; // the shaft's top row

// Cold steel, one step brighter than anything on the wall behind it.
//
// The scene's ramp tops out at `dust` for metal, which is exactly the value the
// wall dressing uses - so a bar painted in it disappears into the stone at 1:1.
// The highlight is the only colour on this sprite that is not from the palette,
// and it is here because the palette has no value above dust that is not also
// warm: lightHot is the lamp orange, and a steel bar glowing orange in a
// corridor reads as heated metal.
const STEEL_HIGH = 0xc6d2da;

/**
 * Bake the crowbar into a texture.
 *
 * Painted into a pixel table and then emitted as one fillRect per pixel through
 * Graphics.generateTexture - the route every other procedural texture in this
 * game takes.
 *
 * The canvas-texture version of this never rendered. The texture existed, held
 * 420 opaque pixels when read back off the canvas, and the Image was in the
 * display list at full alpha above every depth - and it drew nothing, in both
 * the implicit __BASE frame and an explicitly added one. Whatever the cause, a
 * renderer that silently drops a sprite is not worth arguing with when the
 * Graphics path is already proven by the rest of the art.
 *
 * The outline is laid in during the same pass rather than as a separate stroke:
 * the survivor walks in front of a stone wall at one value, and an unoutlined
 * bar of stoneLight differs from it by less than the eye resolves at this size.
 */
export function bakeWeapon(scene: Phaser.Scene): void {
  if (scene.textures.exists(WEAPON_KEY)) return;

  // 0 marks "empty"; every painted pixel carries its colour.
  const px = new Array<number>(WEAPON_W * WEAPON_H).fill(0);
  const put = (x: number, y: number, c: number): void => {
    if (x < 0 || x >= WEAPON_W || y < 0 || y >= WEAPON_H) return;
    px[y * WEAPON_W + x] = c;
  };

  const GRIP_END = 9;
  const SHAFT_END = 34;
  const HOOK_TOP = WEAPON_H - 5;

  // ── the shaft: four values, so the bar has a lit edge, a body and a shadow ──
  for (let x = GRIP_END; x <= SHAFT_END; x++) {
    put(x, ROD, STEEL_HIGH);
    put(x, ROD + 1, PALETTE.dust);
    put(x, ROD + 2, PALETTE.dust);
    put(x, ROD + 3, PALETTE.stoneLight);
    put(x, ROD + 4, PALETTE.stone);
  }
  // Rust, from the warm ramp - the colour the scene otherwise reserves for
  // "lit", which is also what rusted steel looks like under a corridor lamp.
  for (const [x, y] of [[14, ROD + 1], [15, ROD + 1], [16, ROD + 2], [25, ROD + 1], [26, ROD + 1], [33, ROD + 2]]) {
    put(x, y, PALETTE.lightDeep);
  }

  // ── the taped grip: thicker than the shaft, and dark, so the end that goes
  // in the hand is obvious at a glance ──
  //
  // The first pass filled the whole grip with lightDeep, which at 1:1 is an
  // orange brick stuck to the end of a steel bar. A grip is dark rubber with two
  // wraps of tape over it, so the orange is two rings and the mass is shadow.
  for (let x = 0; x < GRIP_END; x++) {
    for (let y = ROD - 3; y <= ROD + 5; y++) put(x, y, PALETTE.shadow);
  }
  for (const x of [1, 2, 5, 6]) {
    for (let y = ROD - 2; y <= ROD + 4; y++) put(x, y, PALETTE.lightDeep);
  }
  for (let x = 0; x < GRIP_END; x++) put(x, ROD - 3, PALETTE.stone);

  // ── the claw: the shaft turns down at the far end and hooks back. That hook
  // is what makes a straight bar read as a crowbar instead of a pipe ──
  for (let x = SHAFT_END + 1; x <= WEAPON_W - 4; x++) {
    put(x, ROD, STEEL_HIGH);
    put(x, ROD + 1, PALETTE.dust);
    put(x, ROD + 2, PALETTE.dust);
    put(x, ROD + 3, PALETTE.stoneLight);
    put(x, ROD + 4, PALETTE.stone);
  }
  for (let y = ROD + 4; y <= HOOK_TOP; y++) {
    for (let x = WEAPON_W - 6; x <= WEAPON_W - 3; x++) put(x, y, PALETTE.dust);
    put(WEAPON_W - 3, y, PALETTE.stoneLight);
  }
  // The toe of the hook, one row wider, so the silhouette ends in a point.
  for (let x = WEAPON_W - 9; x <= WEAPON_W - 4; x++) put(x, HOOK_TOP + 1, PALETTE.dust);
  put(WEAPON_W - 8, HOOK_TOP + 1, STEEL_HIGH);

  // ── one outline pass around the whole silhouette ──
  const solid = px.map((c) => (c !== 0 ? 1 : 0));
  for (let y = 0; y < WEAPON_H; y++) {
    for (let x = 0; x < WEAPON_W; x++) {
      if (solid[y * WEAPON_W + x]) continue;
      const touches =
        (x > 0 && solid[y * WEAPON_W + x - 1]) ||
        (x < WEAPON_W - 1 && solid[y * WEAPON_W + x + 1]) ||
        (y > 0 && solid[(y - 1) * WEAPON_W + x]) ||
        (y < WEAPON_H - 1 && solid[(y + 1) * WEAPON_W + x]);
      if (touches) px[y * WEAPON_W + x] = PALETTE.ink;
    }
  }

  const g = scene.add.graphics();
  for (let y = 0; y < WEAPON_H; y++) {
    for (let x = 0; x < WEAPON_W; x++) {
      const c = px[y * WEAPON_W + x];
      if (c === 0) continue;
      g.fillStyle(c, 1);
      g.fillRect(x, y, 1, 1);
    }
  }
  g.generateTexture(WEAPON_KEY, WEAPON_W, WEAPON_H);
  g.destroy();
}
