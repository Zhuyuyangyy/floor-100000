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

// ── the painted title backdrop ───────────────────────────────────────────────
// The owner's dorm-corridor render as the first thing anyone sees. A title
// screen sells a mood, and a painted 1672x941 image does that better than any
// column of rectangles this codebase could generate — so the photo path is the
// default and the procedural tower below is the fallback for a build without
// the asset.
//
// The scrim is not decoration: the render is busy and the menu text sits over
// its centre-left, so a stepped dark band goes behind the text. Stepped, not a
// gradient — same rule as the rest of the project's pixel work.
export function buildPhotoTitleBackdrop(scene: Phaser.Scene, textureKey: string, seed = 1): TitleBackdrop {
  const { width, height } = scene.cameras.main;
  const group: Phaser.GameObjects.GameObject[] = [];

  // The image covers the canvas exactly: the asset is 16:9 and so is the game.
  //
  // LINEAR filtering, explicitly: the game runs with pixelArt:true, which sets
  // NEAREST on every texture. A 1672x941 painting downscaled to 640x360 with
  // nearest sampling comes out as colour noise — the whole point of a painted
  // backdrop is that it is smooth, so this one texture opts out.
  const bg = scene.add.image(width / 2, height / 2, textureKey).setDepth(-30);
  bg.setDisplaySize(width, height);
  const src = scene.textures.get(textureKey);
  src.setFilter(Phaser.Textures.FilterMode.LINEAR);
  group.push(bg);

  // The scrim's job is text legibility, nothing else. The render is already
  // dark (measured: average luminance 26, 79% of it under 40) and the cream
  // text sits at 232 — so a heavy full-canvas wash just throws the painting
  // away. One panel behind the text column, plus the faintest overall lift.
  const SCRIM = 0x05080c;
  // Text legibility is carried by the text's own stroke (cream on a 2px dark
  // edge), not by burying the painting — measured, the panel at 0.5 halved the
  // far window and the wet floor, which are the two things that make the image
  // read as a building at night. 0.32 is enough for the stroke to sit on.
  group.push(
    scene.add.rectangle(width / 2, height * 0.5, width * 0.66, height * 0.74, SCRIM).setAlpha(0.32).setDepth(-29),
  );
  group.push(scene.add.rectangle(width / 2, height / 2, width, height, SCRIM).setAlpha(0.06).setDepth(-29));

  // A gentle vignette on the sides so the eye lands centre.
  for (const [x, w, originX] of [
    [0, 0.12, 0],
    [1, 0.12, 1],
  ] as const) {
    group.push(
      scene.add
        .rectangle(width * x, height / 2, width * w, height, SCRIM)
        .setAlpha(0.22)
        .setOrigin(originX, 0.5)
        .setDepth(-29),
    );
  }

  // Ash over the top: the one moving element, so the screen is not a still.
  const ash: Ash[] = [];
  const rng = makeRng(deriveSeed(seed, 'title-photo-ash'));
  for (let i = 0; i < 70; i++) {
    const size = rng.chance(0.28) ? 2 : 1;
    const rect = scene.add
      .rectangle(rng.nextInt(0, width), rng.nextInt(0, height), size, size, ASH_COLORS[rng.nextInt(0, ASH_COLORS.length)])
      .setAlpha(0.2 + rng.nextFloat() * 0.35)
      .setOrigin(0, 0)
      .setDepth(-28);
    ash.push({ rect, speed: 7 + rng.nextFloat() * 14, sway: 5 + rng.nextFloat() * 12, phase: rng.nextInt(0, 6000) });
    group.push(rect);
  }

  return {
    update(time, delta) {
      const dt = Math.min(delta, 50) / 1000;
      for (const a of ash) {
        a.rect.y -= a.speed * dt;
        if (a.rect.y < -4) a.rect.y = height + 4;
        a.rect.x += Math.sin(time / 900 + a.phase) * a.sway * dt;
      }
    },
    destroy() {
      for (const o of group) o.destroy();
    },
  };
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
  //
  // BUG FIXED: the bands were being drawn at SCREEN coordinates (towerX + inset)
  // into a texture only towerW+16 wide, so almost every rect fell outside the
  // canvas and generateTexture produced an empty column — only the window rects
  // survived, which is why the title read as confetti in the dark. The bake now
  // draws in texture-local coordinates, and the texture is placed by the scene.
  const bands = Math.ceil(height / BAND_H) + 2;
  const towerH = bands * BAND_H;
  const TEX_W = towerW;
  /** how far each band is inset from the texture's left edge */
  const bandInset = (band: number): number => Math.round((band / bands) * 14);

  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  for (let i = 0; i < bands; i++) {
    const inset = bandInset(i);
    const x = inset;
    const w = TEX_W - inset * 2;
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
    // Vertical seams: the tower is poured concrete, not a smooth column, and the
    // seams are what sell the material at this size.
    if (i % 5 === 0) {
      g.fillStyle(TOWER_EDGE, 1);
      g.fillRect(x + 4, i * BAND_H, 1, BAND_H * 5);
      g.fillRect(x + w - 5, i * BAND_H, 1, BAND_H * 5);
    }
  }
  g.generateTexture('title-tower', TEX_W, towerH);
  g.destroy();
  const tower = scene.add.image(towerX, -BAND_H, 'title-tower').setOrigin(0, 0).setDepth(4);
  group.push(tower);

  // Window lights: a deterministic subset of (band, slot) pairs, each on its
  // own flicker schedule. Most breathe slowly; a few buzz; a few die for
  // seconds — the post-apocalyptic reading is in the blackouts.
  //
  // Positioned from the SAME bandInset() the bake uses, so a window can never
  // float outside the silhouette, and clamped to the band's profile width.
  const WINDOW_GAP = 7;
  const lights: WindowLight[] = [];
  for (let band = 1; band < bands - 1; band++) {
    const inset = bandInset(band);
    const usable = TEX_W - inset * 2 - 16;
    const slots = Math.max(1, Math.floor(usable / WINDOW_GAP));
    for (let slot = 0; slot < slots; slot++) {
      if (!rng.chance(0.3)) continue;
      const x = towerX + inset + 8 + slot * WINDOW_GAP;
      const y = -BAND_H + band * BAND_H + Math.floor((BAND_H - WINDOW_H) / 2);
      const roll = rng.nextFloat();
      const color = roll < 0.62 ? WINDOW_WARM : roll < 0.9 ? WINDOW_COLD : WINDOW_RED;
      // setAlpha, not the constructor's fillAlpha: Phaser 4 ignores that
      // argument and these were painting as solid bright squares.
      const rect = scene.add.rectangle(x, y, WINDOW_W, WINDOW_H, color).setAlpha(0.75).setOrigin(0, 0).setDepth(5);
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
