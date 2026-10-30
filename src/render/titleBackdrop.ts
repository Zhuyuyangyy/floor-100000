import Phaser from 'phaser';

import { makeRng, deriveSeed } from '../core/rng';

// OVERHAUL: the animated title backdrop.
//
// The first screen used to be a flat colour with text on it, and the owner's
// verdict on seeing it was "this alone makes me not want to play". A title
// screen is the game's first sentence; a static one says nothing. This makes
// it say the game's own premise: a ten-thousand-floor tower, lit windows
// failing one by one, ash drifting up past them.
//
// Everything is procedural — the tower is drawn into a texture at boot, the
// windows are individual rects on flicker schedules, the ash is time-driven
// motion over seeded starting positions. No Math.random (the project's rule),
// no asset files (the art guide's rule).

// Project palette, so the backdrop belongs to the same world as the game.
//
// Art pass: TOWER_BODY was 0x10181e against a 0x121c24 background — a 4-point
// luminance gap, which is why the audit measured 86% of the title as one
// colour: the tower was there, it just was not visible. The body is now three
// steps off the background, with an edge lip and a lit crown, so the silhouette
// reads from the first frame.
const TOWER_BODY = 0x2c3f4e;
const TOWER_EDGE = 0x47657a;
const TOWER_CROWN = 0x6d8ea6;
const WINDOW_WARM = 0xf4b66a;
const WINDOW_COLD = 0x6aa8e5;
const WINDOW_RED = 0xe56d63;
const ASH_COLORS = [0x8a867c, 0x6a6560, 0xa8a49a];
// The sky behind the tower: a cold gradient's top stop, a moon, and haze.
const SKY_TOP = 0x080f18;
const SKY_HORIZON = 0x14202c;
const MOON_COLOR = 0xd8d2c0;

const BAND_H = 13;
const WINDOW_W = 4;
const WINDOW_H = 5;

export interface TitleBackdrop {
  update(time: number, delta: number): void;
  destroy(): void;
}

interface WindowLight {
  rect: Phaser.GameObjects.Rectangle;
  /** seconds-scale phase so the flickers never sync up */
  phase: number;
  /** flicker speed; slow windows breathe, fast ones buzz */
  rate: number;
  /** some windows die for seconds at a time — the tower is failing */
  blackoutEvery: number;
  blackoutFor: number;
}

interface Ash {
  rect: Phaser.GameObjects.Rectangle;
  speed: number;
  sway: number;
  phase: number;
}

export function buildTitleBackdrop(scene: Phaser.Scene, seed = 1): TitleBackdrop {
  const { width, height } = scene.cameras.main;
  const rng = makeRng(deriveSeed(seed, 'title-backdrop'));
  const group: Phaser.GameObjects.GameObject[] = [];

  // The tower's footprint is needed by the sky (the moon sits beside it), so it
  // is measured first and drawn second.
  const towerW = 190;
  const towerX = width - towerW - 36;

  // ── the sky ───────────────────────────────────────────────────────────────
  // Before the tower: a stepped gradient (pixel art should not have a smooth
  // gradient), a moon, and a haze band at the horizon. This is what gives the
  // tower something to be silhouetted against.
  const skySteps = 8;
  for (let i = 0; i < skySteps; i++) {
    const t = i / skySteps;
    const c = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(SKY_TOP),
      Phaser.Display.Color.ValueToColor(SKY_HORIZON),
      100,
      Math.round(t * 100),
    );
    const col = Phaser.Display.Color.GetColor(c.r, c.g, c.b);
    scene.add.rectangle(0, (height * t) / 1, width, height / skySteps + 1, col, 1).setOrigin(0, 0).setDepth(1);
  }
  // A moon, low and to the left of the tower, with a halo ring.
  const moonX = towerX - 120;
  const moonY = 96;
  for (let r = 26; r >= 14; r -= 4) {
    scene.add.circle(moonX, moonY, r, MOON_COLOR, r === 14 ? 0.9 : 0.06).setDepth(2);
  }
  // Horizon haze: two soft bands where the tower meets the ground. setAlpha()
  // rather than the constructor's fillAlpha argument, because Phaser 4's
  // Rectangle ignores that argument and these were painting as opaque sheets
  // over the tower's lower floors.
  scene.add.rectangle(width / 2, height - 70, width, 26, SKY_HORIZON).setAlpha(0.35).setDepth(3);
  scene.add.rectangle(width / 2, height - 34, width, 22, 0x0b0f12).setAlpha(0.5).setDepth(3);

  // ── the tower ────────────────────────────────────────────────────────────
  // A column of floor bands on the right, narrow enough that the menu text on
  // the left keeps its clean air. Bands get slightly narrower toward the top so
  // the silhouette reads as a tapering tower, not a rectangle.
  const bands = Math.ceil(height / BAND_H) + 2;
  const towerH = bands * BAND_H;

  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  for (let i = 0; i < bands; i++) {
    const t = i / bands;
    const inset = Math.round(t * 14);
    const x = towerX + inset;
    const w = towerW - inset * 2;
    g.fillStyle(TOWER_BODY, 1);
    g.fillRect(x, i * BAND_H, w, BAND_H);
    // A one-pixel lip on each band's bottom edge gives the stacked-floor read.
    g.fillStyle(TOWER_EDGE, 1);
    g.fillRect(x, i * BAND_H + BAND_H - 1, w, 1);
    // A lit crown on the top three bands, so the tower has a head.
    if (i < 3) {
      g.fillStyle(TOWER_CROWN, 1);
      g.fillRect(x, i * BAND_H, w, 1);
    }
  }
  // Vertical seam lines every few bands: the tower is poured concrete, not a
  // smooth column, and the seams are what sell the material at this size.
  g.fillStyle(TOWER_EDGE, 0.5);
  for (let i = 0; i < bands; i += 5) {
    g.fillRect(towerX + 14, i * BAND_H, 1, BAND_H * 5);
    g.fillRect(towerX + towerW - 15, i * BAND_H, 1, BAND_H * 5);
  }
  g.generateTexture('title-tower', towerW + 16, towerH);
  g.destroy();
  const tower = scene.add.image(towerX - 8, -BAND_H, 'title-tower').setOrigin(0, 0).setDepth(4);
  group.push(tower);

  // Window lights: a deterministic subset of (band, slot) pairs, each on its
  // own flicker schedule. Most breathe slowly; a few buzz; a few die for
  // seconds — the post-apocalyptic reading is in the blackouts.
  const lights: WindowLight[] = [];
  const slots = Math.floor((towerW - 24) / (WINDOW_W + 6));
  for (let band = 1; band < bands - 1; band++) {
    for (let slot = 0; slot < slots; slot++) {
      if (!rng.chance(0.34)) continue;
      const t = band / bands;
      const inset = Math.round(t * 10);
      const x = towerX + inset + 10 + slot * (WINDOW_W + 6);
      const y = band * BAND_H + Math.floor((BAND_H - WINDOW_H) / 2);
      const roll = rng.nextFloat();
      const color = roll < 0.62 ? WINDOW_WARM : roll < 0.9 ? WINDOW_COLD : WINDOW_RED;
      const rect = scene.add.rectangle(x, y, WINDOW_W, WINDOW_H, color, 0.9).setOrigin(0, 0).setDepth(5);
      lights.push({
        rect,
        phase: rng.nextInt(0, 6000),
        rate: roll < 0.12 ? 5 + rng.nextInt(0, 4) : 0.6 + rng.nextFloat(),
        blackoutEvery: rng.chance(0.18) ? 3 + rng.nextInt(0, 6) : 0,
        blackoutFor: rng.chance(0.5) ? 0.8 : 2.4,
      });
      group.push(rect);
    }
  }

  // ── ash ──────────────────────────────────────────────────────────────────
  // Drifts up and wraps; the sway is a sine per particle so the field never
  // repeats exactly. 90 particles, not 34: the audit called the field "not
  // dense enough to read as atmosphere", and at 1-2px each the extra cost is
  // nothing while the screen stops looking empty.
  const ash: Ash[] = [];
  const ASH_COUNT = 90;
  for (let i = 0; i < ASH_COUNT; i++) {
    const size = rng.chance(0.3) ? 2 : 1;
    const rect = scene.add
      .rectangle(rng.nextInt(0, width), rng.nextInt(0, height), size, size, ASH_COLORS[rng.nextInt(0, ASH_COLORS.length)], 0.25 + rng.nextFloat() * 0.4)
      .setOrigin(0, 0)
      .setDepth(6);
    ash.push({ rect, speed: 8 + rng.nextFloat() * 16, sway: 6 + rng.nextFloat() * 14, phase: rng.nextInt(0, 6000) });
    group.push(rect);
  }

  const towerTop = -BAND_H;
  const towerSpan = towerH + BAND_H * 2;

  return {
    update(time, delta) {
      const dt = delta / 1000;
      // Tower drift: a slow vertical breathe, ±10px over ~24s. The tower is
      // taller than the screen, so the drift reads as height, not movement.
      const drift = Math.sin((time / 24000) * Math.PI * 2) * 10;
      tower.y = towerTop + drift;

      for (const w of lights) {
        const t = (time + w.phase) / 1000;
        let alpha = 0.55 + 0.45 * Math.sin(t * w.rate * Math.PI * 2);
        if (w.blackoutEvery > 0) {
          // A periodic death: the window goes dark for blackoutFor seconds
          // every blackoutEvery seconds.
          const cycle = t % w.blackoutEvery;
          if (cycle < w.blackoutFor) alpha = 0.04;
        }
        w.rect.setAlpha(Math.max(0.03, Math.min(1, alpha)));
      }

      for (const a of ash) {
        let y = a.rect.y - a.speed * dt;
        if (y < -4) y = height + 2;
        a.rect.y = y;
        a.rect.x += Math.sin((time + a.phase) / 900) * a.sway * dt;
      }
      // Keep the ash inside the frame horizontally (sway can push it out).
      for (const a of ash) {
        if (a.rect.x < -4) a.rect.x = width + 2;
        else if (a.rect.x > width + 4) a.rect.x = -2;
      }
      void towerSpan;
    },
    destroy() {
      for (const o of group) o.destroy();
    },
  };
}
