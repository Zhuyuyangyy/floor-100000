import Phaser from 'phaser';

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
// bars — drawn here so the values are real.
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
  const poly = (points: Array<[number, number]>): void => {
    g.fillStyle(color, 1);
    g.fillPoints(points.map(([px, py]) => new Phaser.Math.Vector2(X(px), Y(py))), true, true);
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
  g.fillStyle(plate, 0.97);
  g.fillRect(0, 0, width, height);
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
