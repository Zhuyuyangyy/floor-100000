import Phaser from 'phaser';

// OVERHAUL Art Pass: the lighting layer — the fix for "everything is the same
// grey-dark".
//
// Measured before (re/art-dorm.png): 40% of pixels under luminance 40, 3% above
// 120, saturation 0.26 with every hue in one grey-blue. No focal point, no
// colour bias — a flat wash, which is what reads as ugly.
//
// The first attempt stacked ADD-blended rectangles and measured +4 luminance:
// Phaser's premultiplied alpha eats additive colour over a dark base, so the
// pools never showed. This version draws the pools as concentric circles with a
// Graphics object, warm at the core and transparent at the rim, redrawn each
// frame so they can breathe. It measures as +14 luminance in the pools, 10x the
// ambient, and the warm hue the palette lacked.
//
// Everything is procedural: no asset is touched, the pool list is data, and a
// floor declares its own lights.
//
// PHASER 4 GOTCHA, learned the hard way here: add.rectangle() ignores the
// fillAlpha positional argument — every rectangle this module creates is fully
// opaque unless setAlpha() is called on it. The first version of this file
// painted an opaque blue sheet over the whole floor, which is exactly the
// "everything is one flat colour" symptom it was written to fix. Any new
// rectangle in this project needs .setAlpha(), never the 6th argument.

export interface LightPool {
  x: number;
  y: number;
  radius: number;
  /** 0..1 */
  strength: number;
  color: number;
}

// Tight radii on purpose: a pixel-art pool that covers the floor is a wash, not
// a light. These sit at the places the player works — the stairwells, the bed,
// the workbench — so the floor has places to be.
const STAIR_LIGHTS: readonly LightPool[] = [
  { x: 40, y: 300, radius: 88, strength: 1, color: 0xf4b66a },
  { x: 1240, y: 300, radius: 88, strength: 1, color: 0xf4b66a },
];

const BED_LIGHT: LightPool = { x: 1120, y: 286, radius: 86, strength: 0.95, color: 0xf4b66a };
const BENCH_LIGHT: LightPool = { x: 480, y: 286, radius: 86, strength: 0.95, color: 0xf4b66a };

// The ambient wash biases the unlit floor cold, so the warm pools have
// something to fight. Drawn as a normal-alpha fill, not additive.
//
// Art pass: this used to be one full-canvas rectangle at alpha 0.42, and the
// measurement showed what that did — it flattened the wall PNG into a single
// (36,53,65), burying the directional light, the peeling paint and the stains
// the asset was drawn with. Now the wash is three bands with a hole in the
// middle: strongest at the very bottom (the floor, where a cold wash reads as
// depth), lighter up the wall, and nothing at all across the top band where the
// wall art carries its own light.
const AMBIENT_COLOR = 0x24405e;
const AMBIENT_FLOOR_ALPHA = 0.4;
const AMBIENT_WALL_ALPHA = 0.16;
/** the fraction of the canvas height where the wall art keeps its own light */
const AMBIENT_CLEAR_TOP = 0.16;

// Stepped vignette bands, not a smooth gradient: a pixel game should not have a
// filter-looking gradient anywhere.
const VIGNETTE_COLOR = 0x0b0f12;
const VIGNETTE_BANDS: readonly number[] = [0.36, 0.24, 0.13, 0.06];
const VIGNETTE_BAND_H = 26;

// A single warm glow at an arbitrary point — the shared language for "there is
// a light here". Scenes use this for window spill, lamps and anything else that
// emits, so every light on screen is the same soft radial falloff instead of
// three different hand-rolled shapes.
export function addGlow(
  scene: Phaser.Scene,
  x: number,
  y: number,
  radius: number,
  alpha = 0.5,
  depth = 4,
): Phaser.GameObjects.Image {
  const size = Math.max(8, Math.round(radius * 2));
  ensureGlowTexture(scene, size);
  return scene.add.image(x, y, glowKey(size)).setBlendMode(Phaser.BlendModes.ADD).setAlpha(alpha).setDepth(depth);
}

export interface LightLayer {
  update(time: number): void;
  destroy(): void;
}

// One soft glow texture, baked once per size.
//
// The previous version drew concentric Graphics circles, and the owner
// screenshotted the result: a solid tan disc about 180px across with the ten
// steps visible as rings. It read as an object lying on the floor, not as
// light, and it was the ugliest thing on screen.
//
// Light has to fall off per pixel. This bakes a real radial gradient into a
// canvas texture and adds it with ADD blending: ADD brightens the wall without
// covering it, which is the whole difference between "a lamp is lit here" and
// "a beige ball is here".
const glowKey = (size: number): string => `glow-${size}`;

function ensureGlowTexture(scene: Phaser.Scene, size: number): void {
  const key = glowKey(size);
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, size, size);
  if (!tex) return;
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // Warm at the core, gone by the rim. The stops ARE the falloff curve.
  g.addColorStop(0, 'rgba(255,230,186,0.95)');
  g.addColorStop(0.22, 'rgba(255,206,144,0.52)');
  g.addColorStop(0.5, 'rgba(247,180,108,0.2)');
  g.addColorStop(0.78, 'rgba(232,152,82,0.05)');
  g.addColorStop(1, 'rgba(220,140,70,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.refresh();
}

export function buildLightLayer(
  scene: Phaser.Scene,
  opts: { width: number; height: number; isDorm: boolean; hasUpExit: boolean; hasDownExit: boolean },
): LightLayer {
  const { width, height, isDorm } = opts;
  const owned: Phaser.GameObjects.GameObject[] = [];

  const pools: LightPool[] = [];
  if (opts.hasUpExit) pools.push(STAIR_LIGHTS[0]);
  if (opts.hasDownExit) pools.push(STAIR_LIGHTS[1]);
  if (isDorm) pools.push(BED_LIGHT, BENCH_LIGHT);

  // Depth rule: the ambient wash is at depth 0 — the same as the room art, added
  // after it — so it tints the WALL and the floor but leaves the props and the
  // player at full colour. At depth 6 it also washed over the player, who then
  // read as a dark blob; a cold tint belongs to the room, not to the character.
  //
  // The glows are at depth 4 (ABOVE the props and the player) on purpose: an
  // additive glow over the character is what makes standing in a lamp pool look
  // like standing in a lamp pool. The vignette stays at 8, above everything.
  const poolImages: Array<{ img: Phaser.GameObjects.Image; base: number; phase: number }> = [];
  for (const pool of pools) {
    const size = Math.round(pool.radius * 2);
    ensureGlowTexture(scene, size);
    // `strength` is the peak alpha now, not a multiplicative factor: at 1.0 an
    // ADD glow washes the wall to white, so the pools sit around 0.5.
    const base = pool.strength * 0.5;
    const img = scene.add.image(pool.x, pool.y, glowKey(size)).setBlendMode(Phaser.BlendModes.ADD).setAlpha(base).setDepth(4);
    poolImages.push({ img, base, phase: pool.x * 0.7 % 10 });
    owned.push(img);
  }

  // Banded ambient, not one rectangle: the top band keeps the wall PNG's own
  // light, the wall band takes a light cold wash, the floor band a strong one.
  const clearY = height * AMBIENT_CLEAR_TOP;
  const floorTop = height * 0.62;
  owned.push(
    scene.add.rectangle(width / 2, (clearY + floorTop) / 2, width, floorTop - clearY, AMBIENT_COLOR).setAlpha(AMBIENT_WALL_ALPHA).setDepth(0),
  );
  owned.push(
    scene.add.rectangle(width / 2, (floorTop + height) / 2, width, height - floorTop, AMBIENT_COLOR).setAlpha(AMBIENT_FLOOR_ALPHA).setDepth(0),
  );

  for (let i = 0; i < VIGNETTE_BANDS.length; i++) {
    const a = VIGNETTE_BANDS[i];
    const inset = i * VIGNETTE_BAND_H;
    const mk = (x: number, y: number, w: number, h: number): void => {
      owned.push(scene.add.rectangle(x, y, w, h, VIGNETTE_COLOR).setAlpha(a).setDepth(8));
    };
    mk(width / 2, inset + VIGNETTE_BAND_H / 2, width, VIGNETTE_BAND_H);
    mk(width / 2, height - inset - VIGNETTE_BAND_H / 2, width, VIGNETTE_BAND_H);
    mk(inset + VIGNETTE_BAND_H / 2, height / 2, VIGNETTE_BAND_H, height);
    mk(width - inset - VIGNETTE_BAND_H / 2, height / 2, VIGNETTE_BAND_H, height);
  }

  // Each pool breathes on its own offset, so the light is alive — a lit room in
  // an abandoned tower is never perfectly steady.

  const redraw = (time: number): void => {
    for (const p of poolImages) {
      // A slow breath: a lit room in an abandoned tower is never perfectly
      // steady, and a still glow reads as a decal.
      const t = 0.5 + 0.5 * Math.sin((time / 2600) * Math.PI * 2 + p.phase);
      p.img.setAlpha(p.base * (0.82 + 0.36 * t));
    }
  };
  redraw(0);

  return {
    update(time) {
      redraw(time);
    },
    destroy() {
      for (const o of owned) o.destroy();
    },
  };
}
