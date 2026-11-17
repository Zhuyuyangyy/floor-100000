import type Phaser from 'phaser';

// The HUD skin, drawn from the 2026-11-14 concept sheet
// (F:/new/末日宿舍_HUD_UI分件包.zip, shipped as reference in
// 素材库/收集素材库/首章待用美术设定集/04-界面/HUD概念图/).
//
// Why procedural instead of the PNGs: that pack is a concept render, and its own
// README says so — every module is an opaque RGB crop with the numbers baked in
// (生命 100, 饥饿 65 …) and the full bar is 1656px wide against this game's
// 1280px design canvas. Dropping them in would freeze the numbers at their
// concept values, hide the world behind opaque plates, and resample 1656 -> 1280
// through a nearest-neighbour filter. So the sheet is the spec, not the asset:
// same three rows, same dark riveted plate, same hazard stripe, same segmented
// gauges — drawn here so the values are real.
//
// AG-54（用户 2026-11-16 晚反馈「之前不是有那种圆环的那种」：概念图全库搜过
// 一遍——HUD概念图目录、F:/new 分件包、git 全部分支历史里都没有圆环 HUD，
// 旧的四联分段条是唯一存在过的样式。按现有语言重画：10 段横条变成 12 段
// 圆环（drawStatRing），板/铆钉/斜纹/三行结构全部不动，读数一个不丢。
//
// Every glyph is on an 8x8 grid at 2px units, so a 16px icon is 8 integer cells
// and stays crisp at pixelArt:true.

export type HudIconName =
  | 'tower'
  | 'calendar'
  | 'cross'
  | 'hunger'
  | 'thirst'
  | 'energy'
  | 'coins'
  | 'star'
  | 'clipboard'
  | 'thermo'
  | 'wind'
  | 'drop'
  | 'moon';

/** Draw `name` inside an s x s box whose top-left is (x, y). `bg` is only used
 *  by the moon, which is a circle with a bite taken out of it. */
export function drawHudIcon(
  g: Phaser.GameObjects.Graphics,
  name: HudIconName,
  x: number,
  y: number,
  s: number,
  color: number,
  bg = 0x0b0f12,
): void {
  const u = s / 8; // 2px at the HUD's 16px
  const X = (cx: number): number => Math.round(x + cx * u);
  const Y = (cy: number): number => Math.round(y + cy * u);
  const W = (cw: number): number => Math.max(1, Math.round(cw * u));
  const cell = (cx: number, cy: number, cw: number, ch: number): void => {
    g.fillStyle(color, 1);
    g.fillRect(X(cx), Y(cy), W(cw), W(ch));
  };
  // Plain {x, y} points, not Phaser.Math.Vector2: fillPoints only reads the
  // two coordinates, and a type-only Phaser import keeps this module loadable
  // in the Node unit tests (vitest has no window, and phaser.esm.js touches it
  // at module scope). The cast satisfies the Vector2[] signature.
  const poly = (points: Array<[number, number]>): void => {
    g.fillStyle(color, 1);
    const vectors = points.map(([px, py]) => ({ x: X(px), y: Y(py) }));
    g.fillPoints(vectors as Phaser.Math.Vector2[], true, true);
  };

  switch (name) {
    case 'tower':
      // A stepped silhouette: wide at the base, narrower storeys on top.
      cell(3, 0, 2, 1);
      cell(2, 1, 4, 2);
      cell(1, 3, 6, 5);
      g.fillStyle(bg, 0.9);
      g.fillRect(X(2), Y(4), W(1), W(1));
      g.fillRect(X(5), Y(4), W(1), W(1));
      g.fillRect(X(3), Y(6), W(2), W(1));
      break;
    case 'calendar':
      cell(0, 1, 8, 7);
      g.fillStyle(bg, 0.9);
      g.fillRect(X(1), Y(3), W(6), W(4));
      cell(1, 0, 1, 2);
      cell(6, 0, 1, 2);
      break;
    case 'cross':
      cell(3, 0, 2, 8);
      cell(0, 3, 8, 2);
      break;
    case 'hunger':
      // Fork: three tines over a handle.
      cell(1, 0, 1, 4);
      cell(3, 0, 2, 4);
      cell(6, 0, 1, 4);
      cell(3, 4, 2, 4);
      break;
    case 'thirst':
      // Droplet: a point over a round bottom.
      poly([
        [4, 0],
        [7, 4],
        [6, 7],
        [2, 7],
        [1, 4],
      ]);
      break;
    case 'energy':
      poly([
        [5, 0],
        [1, 5],
        [4, 5],
        [3, 8],
        [7, 3],
        [4, 3],
      ]);
      break;
    case 'coins':
      g.fillStyle(color, 1);
      g.fillCircle(X(3), Y(5), Math.max(1, u * 2));
      g.fillCircle(X(5), Y(3), Math.max(1, u * 2));
      break;
    case 'star':
      poly([
        [4, 0],
        [5, 3],
        [8, 3],
        [6, 5],
        [7, 8],
        [4, 6],
        [1, 8],
        [2, 5],
        [0, 3],
        [3, 3],
      ]);
      break;
    case 'clipboard':
      cell(1, 0, 6, 8);
      g.fillStyle(bg, 0.9);
      g.fillRect(X(2), Y(2), W(4), W(5));
      cell(3, 0, 2, 1);
      cell(2, 3, 4, 1);
      cell(2, 5, 4, 1);
      break;
    case 'thermo':
      g.fillStyle(color, 1);
      g.fillCircle(X(4), Y(6), Math.max(1, u * 2));
      cell(3, 0, 2, 5);
      break;
    case 'wind':
      cell(0, 1, 6, 1);
      cell(5, 0, 1, 1);
      cell(1, 3, 6, 1);
      cell(6, 3, 1, 1);
      cell(2, 5, 5, 1);
      break;
    case 'drop':
      poly([
        [4, 1],
        [7, 5],
        [4, 8],
        [1, 5],
      ]);
      break;
    case 'moon':
      g.fillStyle(color, 1);
      g.fillCircle(X(4), Y(4), Math.max(1, u * 3));
      g.fillStyle(bg, 1);
      g.fillCircle(X(6), Y(3), Math.max(1, u * 2.4));
      break;
  }
}

/** The concept's plate: one dark slab, rivets at the corners, a hazard stripe
 *  under the right end, and hairline dividers between the module groups. */
export function drawHudPlate(
  g: Phaser.GameObjects.Graphics,
  width: number,
  height: number,
  plate: number,
  line: number,
  rivet: number,
  accent: number,
): void {
  // The plate is BANDS, not one fill. A single flat rect over 132px measured as
  // 26% of the whole play area in one colour - the art audit's dominant-colour
  // gate failed on it, and it also read as a sticker rather than as metal. Six
  // bands of rising alpha give the slab a vertical falloff, so the composited
  // colour changes with height the way a real panel does.
  const BANDS = 6;
  for (let i = 0; i < BANDS; i++) {
    const t = i / (BANDS - 1);
    g.fillStyle(plate, 0.14 + 0.12 * t);
    const y = Math.round((height / BANDS) * i);
    g.fillRect(0, y, width, Math.ceil(height / BANDS) + 1);
  }
  // Top and bottom hairlines.
  g.fillStyle(line, 0.9);
  g.fillRect(0, 0, width, 1);
  g.fillRect(0, height - 1, width, 1);
  // Rivets: four corners plus the two dividers, the way the concept's plates
  // are bolted to the wall.
  const rivets: Array<[number, number]> = [
    [8, 8],
    [width - 9, 8],
    [8, height - 9],
    [width - 9, height - 9],
  ];
  g.fillStyle(rivet, 0.85);
  for (const [rx, ry] of rivets) g.fillRect(rx, ry, 2, 2);
  // A warm accent down the left edge, so the HUD reads as one object.
  g.fillStyle(accent, 1);
  g.fillRect(0, 0, 3, height);
}

/** Diagonal hazard stripes, the concept's signature under the environment row. */
export function drawHazardStripe(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, color: number): void {
  g.fillStyle(color, 0.5);
  for (let i = -h; i < w; i += 8) {
    g.fillRect(x + i, y, 4, h);
  }
}

/** How many pips a stat ring is cut into. Twelve divides the circle into 30
 *  degree slots, so a pip is readable as "a twelfth" the way the old bar's pips
 *  read as "a tenth". */
export const RING_SEGMENTS = 12;

/** Radians of dark between two pips, so the ring reads as pips and not as one
 *  continuous stroke with tick marks. */
const RING_GAP = 0.07;

/**
 * A stat as a ring: a dark track with `frac` of it lit in pips, clockwise from
 * the top. This is the 2026-11-14 skin's segmented bar turned 90 degrees into
 * a circle — the AG-54 answer to "圆环的那种" — and it keeps the bar's whole
 * contract: the pips are discrete (a player budgets with "7 of 12", not with a
 * smooth 58%), a running-out stat goes danger red at 20% whatever its own
 * colour is, and the trough is the palette ink.
 *
 * The number itself is NOT drawn here: it lives in the ring's centre as a Text
 * (see GameScene.buildHud), so the value stays live.
 */
export function drawStatRing(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
  frac: number,
  color: number,
  options: { segments?: number; stroke?: number } = {},
): void {
  const f = Math.max(0, Math.min(1, frac));
  const segments = options.segments ?? RING_SEGMENTS;
  const stroke = options.stroke ?? 5;
  // The track: one full circle of trough ink, drawn under the lit pips so the
  // gaps between pips and the unlit remainder read as the same slot.
  g.lineStyle(stroke, 0x05080b, 1);
  g.strokeCircle(cx, cy, r);
  const slot = (Math.PI * 2) / segments;
  const lit = Math.round(f * segments);
  for (let i = 0; i < lit; i++) {
    // Pip i sweeps from the top (-PI/2) clockwise, trimmed by the gap on both
    // ends so neighbours never touch.
    const a0 = -Math.PI / 2 + i * slot + RING_GAP / 2;
    const a1 = -Math.PI / 2 + (i + 1) * slot - RING_GAP / 2;
    g.lineStyle(stroke, color, 1);
    g.beginPath();
    g.arc(cx, cy, r, a0, a1);
    g.strokePath();
  }
}

/** The ring group's texture box, in SCREEN coordinates — the RenderTexture's
 *  position and size. Derived from HUD_LAYOUT's ring geometry, so a layout
 *  move cannot leave the texture behind. */
export interface StatRingsBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The ring geometry keys of HUD_LAYOUT the bake needs (structural, so the
 *  layout tests and this module cannot drift apart). */
export interface StatRingGeometry {
  statX: number;
  statPitch: number;
  ringCY: number;
  ringR: number;
  ringStroke: number;
}

export function statRingsBox(hud: StatRingGeometry): StatRingsBox {
  // The stroke is centred on the ring path, so the painted edge is r + stroke/2.
  const outer = hud.ringR + hud.ringStroke / 2;
  const firstCX = hud.statX + hud.ringR;
  const lastCX = hud.statX + 3 * hud.statPitch + hud.ringR;
  // The group's painted top edge sits ABOVE the canvas (ringCY 25 - outer
  // 25.5 = -0.5) and the screen clips it at y=0. The texture must start at
  // y=0 too, or the Image would show a row the baseline never had.
  const y = Math.max(0, Math.floor(hud.ringCY - outer));
  const x = Math.floor(firstCX - outer);
  return { x, y, width: Math.ceil(lastCX + outer) - x, height: Math.ceil(hud.ringCY + outer) - y };
}

/**
 * The four stat rings as one baked texture (AG-102, perf round 3).
 *
 * Why: Phaser 4's GraphicsWebGLRenderer has no dirty cache — every frame it
 * re-walks the commandBuffer and re-triangulates every ARC, and the four rings
 * are 42 arc paths (588 of the depth-103 HUD set's 1222 buffer values),
 * measured at 0.68ms/frame, the single largest Graphics cost in the game
 * (docs/2026-11-18-PERF-ROUND2-CHUNK-CULL.md §4). The pips only change when a
 * stat's rounded value changes — refreshStats' key guard, ~1/s while hunger
 * and thirst decay — so the whole group is baked into one texture on change
 * and shown as a single object: one textured quad per frame instead of 42
 * re-triangulated arcs.
 *
 * Route: a RenderTexture, NOT Graphics.generateTexture. generateTexture
 * rasterises through the Canvas 2D renderer, and its arc strokes do not match
 * the WebGL triangulation pixel for pixel — the frozen-screenshot diff came
 * back at 0.128% with maxDelta 123 (the whole ring outline), 18x the 0.007%
 * noise floor, so it failed the pixel-exact constraint. A RenderTexture draws
 * the same Graphics through the same WebGL renderer into an FBO: same
 * triangles, same non-MSAA rasterisation, NEAREST sampling at an integer
 * position — the diff drops back to the 8-bit premultiply rounding of the
 * texture round trip.
 *
 * The static/dynamic split was rejected: the dynamic pips ARE the expensive
 * part, so a baked track plus a live pip Graphics would keep ~all of the
 * per-frame cost.
 */

/** Draw the four rings into `g` in TEXTURE-LOCAL coordinates (the box origin
 *  subtracted). Same calls the live Graphics made: the dark track, then one
 *  pip per lit twelfth, danger red at <=20% — the value's own Text is not
 *  drawn here (it stays live in the ring's well). */
export function drawStatRingGroup(
  g: Phaser.GameObjects.Graphics,
  hud: StatRingGeometry,
  box: StatRingsBox,
  values: readonly number[],
  colors: readonly number[],
  danger: number,
): void {
  values.forEach((v, i) => {
    const frac = v / 100;
    drawStatRing(
      g,
      hud.statX + i * hud.statPitch + hud.ringR - box.x,
      hud.ringCY - box.y,
      hud.ringR,
      frac,
      frac <= 0.2 ? danger : colors[i],
      { stroke: hud.ringStroke },
    );
  });
}

/** One ring-group baker: the display object plus its off-screen draw source. */
export interface StatRingsBaker {
  /** The display object — one Render Texture where the live Graphics was. */
  readonly rt: Phaser.GameObjects.RenderTexture;
  /** Re-bake. Call on stat change only (never per frame): queues clear+draw,
   *  which the RT executes on its next render, triangulating the arcs once
   *  per change instead of once per frame. */
  redraw(values: readonly number[], colors: readonly number[], danger: number): void;
  destroy(): void;
}

/** Create the baker: the RT placed exactly where the old Graphics sat, plus
 *  the off-screen Graphics every re-bake draws through. */
export function createStatRingsBaker(scene: Phaser.Scene, hud: StatRingGeometry): StatRingsBaker {
  const box = statRingsBox(hud);
  // Off-screen (never on the display list), reused for every re-bake — the
  // canonical draw-then-bake pattern (render/pixelArt.ts), minus the destroy,
  // because this one bakes repeatedly.
  const gfx = scene.make.graphics({ x: 0, y: 0 }, false);
  const rt = scene.add
    .renderTexture(box.x, box.y, box.width, box.height)
    .setOrigin(0, 0)
    .setName('hud-stat-rings')
    .setScrollFactor(0)
    .setDepth(103)
    // 'all' runs the queued clear+draw when the RT renders, then draws the
    // texture to the frame. The default 'render' mode never runs the buffer
    // and the rings would stay invisible.
    .setRenderMode('all');
  return {
    rt,
    redraw(values, colors, danger) {
      gfx.clear();
      drawStatRingGroup(gfx, hud, box, values, colors, danger);
      rt.clear();
      rt.draw(gfx);
    },
    destroy() {
      gfx.destroy();
      rt.destroy();
    },
  };
}
