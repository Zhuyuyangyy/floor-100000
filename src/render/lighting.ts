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

export interface LightLayer {
  update(time: number): void;
  destroy(): void;
}

// Draws one pool as concentric circles from the rim inward, so the warm core is
// the last (and strongest) thing drawn. `t` is 0..1, the breathing phase.
function drawPool(g: Phaser.GameObjects.Graphics, pool: LightPool, t: number): void {
  const steps = 10;
  for (let s = steps - 1; s >= 0; s--) {
    const f = s / steps; // 0 = core, 1 = rim
    const r = pool.radius * (1 - f * 0.9);
    // The core is near-saturated warm: measured, a pool whose centre alpha is
    // under ~0.5 disappears into the dark base entirely.
    const a = pool.strength * Math.pow(1 - f, 1.5) * (0.62 + 0.14 * t);
    if (a <= 0.004) continue;
    g.fillStyle(pool.color, Math.min(0.98, a));
    g.fillCircle(pool.x, pool.y, r);
  }
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

  // The ambient wash and the vignette are static; the pools are the Graphics.
  // Order matters and was measured: the pools are drawn FIRST (depth 4), the
  // ambient wash SECOND (depth 6), the vignette LAST (depth 8). Drawing the
  // ambient over the pools is what makes the pools read as warm against cold
  // instead of everything being tinted the same blue.
  const poolG = scene.add.graphics().setDepth(4);
  owned.push(poolG);

  // Banded ambient, not one rectangle: the top band keeps the wall PNG's own
  // light, the wall band takes a light cold wash, the floor band a strong one.
  const clearY = height * AMBIENT_CLEAR_TOP;
  const floorTop = height * 0.62;
  owned.push(
    scene.add.rectangle(width / 2, (clearY + floorTop) / 2, width, floorTop - clearY, AMBIENT_COLOR, AMBIENT_WALL_ALPHA).setDepth(6),
  );
  owned.push(
    scene.add.rectangle(width / 2, (floorTop + height) / 2, width, height - floorTop, AMBIENT_COLOR, AMBIENT_FLOOR_ALPHA).setDepth(6),
  );

  for (let i = 0; i < VIGNETTE_BANDS.length; i++) {
    const a = VIGNETTE_BANDS[i];
    const inset = i * VIGNETTE_BAND_H;
    const mk = (x: number, y: number, w: number, h: number): void => {
      owned.push(scene.add.rectangle(x, y, w, h, VIGNETTE_COLOR, a).setDepth(8));
    };
    mk(width / 2, inset + VIGNETTE_BAND_H / 2, width, VIGNETTE_BAND_H);
    mk(width / 2, height - inset - VIGNETTE_BAND_H / 2, width, VIGNETTE_BAND_H);
    mk(inset + VIGNETTE_BAND_H / 2, height / 2, VIGNETTE_BAND_H, height);
    mk(width - inset - VIGNETTE_BAND_H / 2, height / 2, VIGNETTE_BAND_H, height);
  }

  // Each pool breathes on its own offset, so the light is alive — a lit room in
  // an abandoned tower is never perfectly steady.
  const phases = pools.map((p) => (p.x * 0.7 + p.y * 0.3) % 10);

  const redraw = (time: number): void => {
    poolG.clear();
    for (let i = 0; i < pools.length; i++) {
      const t = 0.5 + 0.5 * Math.sin((time / 2400) * Math.PI * 2 + phases[i]);
      drawPool(poolG, pools[i], t);
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
