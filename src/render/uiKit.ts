import Phaser from 'phaser';

import { PALETTE, ROLE, STAT_COLOR, TEXT, hex } from './palette.ts';

// OVERHAUL UI: the design system the in-game interface was missing.
//
// The audit that prompted this: the inventory panel measured 46% of the screen
// as ONE flat colour, crafting 51%, and the combat panel carried only 2.6%
// bright pixels. Meanwhile the benchmark game this project is measured against
// (Centum, reverse-engineered in re/centum) draws its entire HUD from a 24x4
// status strip and 16x16 icons, with almost no text at all — 11 fillRect and 7
// fillText calls in 226 KB of source. The lesson is not "use more art"; it is
// that a readable interface is made of small, dense, high-contrast elements on
// a strict grid, not big flat panels with tiny floating labels.
//
// So everything below is grid-first: a 4px module, a named type scale, and
// three primitives (stat bar, header strip, row). Panels and the HUD are both
// built from them, which is what makes the interface read as one system.

// The object union every UI helper returns: the same set a panel's object list
// holds, so a helper's output can be pushed straight into one.
export type UiObject =
  | Phaser.GameObjects.Text
  | Phaser.GameObjects.Rectangle
  | Phaser.GameObjects.Image
  | Phaser.GameObjects.Graphics;

// ── the grid ────────────────────────────────────────────────────────────────
/** everything snaps to this */
export const UI_UNIT = 4;
/** tall enough to hold a 9px label and a 4px bar */
export const HUD_BAR_H = 30;
export const HUD_FOOT_H = 20;

// ── the type scale ──────────────────────────────────────────────────────────
// Only three sizes. The old UI mixed 11/12/13/16/18/22/40 with no rule, which
// is most of why it read as a prototype.
//
// SIZES ARE A LEGIBILITY FLOOR, NOT A TASTE CHOICE. The canvas is 640x360 and
// the page displays it at 2x, so an 8px glyph is drawn into 8 device pixels and
// then doubled — for Latin monospace that reads as chunky pixel art, but a
// Chinese glyph carved in 8px is an illegible smudge. That is the "界面不清晰"
// complaint, and it was a real defect: the caption size is now 10, the body 12
// and titles 15, which is the smallest this script stays readable at.
export const TYPE = {
  /** panel and HUD titles */
  title: 15,
  /** body rows, values */
  body: 12,
  /** captions, hints, the smallest legal text */
  caption: 10,
} as const;

// ── the colour roles ────────────────────────────────────────────────────────
// Roles, not raw hex at the call site: a stat bar, a warning and a value all
// need to be changed together, and they were not.
// Colour roles, on the project palette (render/palette.ts).
//
// This module used to carry its own hex table, which is how a UI ends up looking
// like a different game from the world behind it: the panel surface was one
// blue-black and the room's shadow was another, so the two never quite matched.
// Every colour below is a palette role now, and the accent is the same warm ramp
// the lamps use - which is why an amber selection and an amber lamp feel related.
export const UI = {
  /** panel and bar fill — translucent so the world reads through */
  surface: ROLE.surface,
  surfaceAlpha: 0.88,
  /** one step lighter, for headers and inset wells */
  surfaceRaised: ROLE.surfaceRaised,
  /** the hairline between rows and around wells */
  line: ROLE.line,
  /** body text */
  text: ROLE.text,
  /** de-emphasised text: hints, units, locked rows */
  textDim: ROLE.textDim,
  /** the warm accent: titles, selection, gold */
  accent: ROLE.accent,
  /** the teal accent: safe things, positive deltas */
  good: ROLE.good,
  /** the red accent: damage, blockers, danger */
  danger: ROLE.danger,
  /** bar troughs */
  trough: PALETTE.ink,
} as const;

// The four survival stats each own a colour, so a glance at the bar tells you
// which stat is failing without reading the label.
export const STAT_COLORS: Record<string, number> = {
  hp: STAT_COLOR.hp,
  hunger: STAT_COLOR.hunger,
  thirst: STAT_COLOR.thirst,
  energy: STAT_COLOR.energy,
};

// ── primitives ──────────────────────────────────────────────────────────────

/** A 1px hairline. Cheaper and crisper than a Rectangle per divider. */
export function drawLine(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  color: number = UI.line,
  alpha = 0.85,
): void {
  g.fillStyle(color, alpha);
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), 1);
}

/**
 * A segmented stat bar — the Centum status strip, scaled up.
 *
 * Segments rather than a continuous fill because a continuous bar at 54px tells
 * you "roughly 60%" and a segmented one tells you "7 of 12", which is the
 * number the player actually budgets with.
 */
export function drawStatBar(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  color: number,
  segments = 12,
): void {
  const f = Math.max(0, Math.min(1, frac));
  g.fillStyle(UI.trough, 1);
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  const gap = 1;
  const segW = (w - (segments - 1) * gap) / segments;
  const lit = Math.round(f * segments);
  for (let i = 0; i < segments; i++) {
    if (i >= lit) break;
    // A bar running out goes red regardless of its own colour: the warning has
    // to be visible without knowing which stat is which.
    const c = f <= 0.2 ? UI.danger : color;
    g.fillStyle(c, 1);
    g.fillRect(Math.round(x + i * (segW + gap)), Math.round(y), Math.max(1, Math.round(segW)), Math.round(h));
  }
  // A 1px rim so the trough reads as a well rather than empty space.
  g.lineStyle(1, UI.line, 0.6);
  g.strokeRect(Math.round(x) - 0.5, Math.round(y) - 0.5, Math.round(w) + 1, Math.round(h) + 1);
}

/**
 * A panel's header strip: a raised band with the title on it and a hairline
 * under it. Every panel gets one, which is what gives the interface a
 * consistent top edge instead of nine differently-shaped boxes.
 */
export function buildPanelHeader(
  scene: Phaser.Scene,
  left: number,
  top: number,
  w: number,
  title: string,
  accent: number,
  depth: number,
  titleX?: number,
): UiObject[] {
  const out: UiObject[] = [];
  const h = 20;
  // The strip itself.
  out.push(scene.add.rectangle(left, top, w, h, UI.surfaceRaised).setOrigin(0, 0).setAlpha(0.96).setDepth(depth));
  // A 2px accent edge on the left, so the header has a leading mark.
  out.push(scene.add.rectangle(left, top, 2, h, accent).setOrigin(0, 0).setDepth(depth + 1));
  // The title.
  out.push(
    scene.add
      .text(titleX ?? left + 10, top + h / 2, title, { fontFamily: 'monospace', fontSize: `${TYPE.title}px`, color: hex(TEXT.primary) })
      .setOrigin(0, 0.5)
      .setDepth(depth + 1),
  );
  // The hairline that separates the header from the body.
  const g = scene.add.graphics().setDepth(depth + 1);
  drawLine(g, left + 2, top + h - 1, w - 2, accent, 0.7);
  out.push(g);
  return out;
}

/** A panel's inner well: a slightly darker inset where the list lives. */
export function buildPanelWell(
  scene: Phaser.Scene,
  left: number,
  top: number,
  w: number,
  h: number,
  depth: number,
): UiObject[] {
  const out: UiObject[] = [];
  out.push(scene.add.rectangle(left, top, w, h, 0x080c0f).setOrigin(0, 0).setAlpha(0.55).setDepth(depth));
  const g = scene.add.graphics().setDepth(depth + 1);
  g.lineStyle(1, UI.line, 0.5);
  g.strokeRect(Math.round(left) + 0.5, Math.round(top) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
  out.push(g);
  return out;
}

/**
 * The row height for every list in the game. 24px holds a 16px icon, a 10px
 * label and a 10px value with 4px of air — and 24 rows fit a 240px panel, which
 * is why the panels can be a third of the screen instead of half.
 */
export const ROW_H = 26;

/**
 * One list row: icon slot, label, and a right-aligned value. Returns the
 * objects and the y-centre, so callers place the selection marker on it.
 */
export function buildListRow(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  depth: number,
  opts: {
    iconKey?: string;
    label: string;
    value?: string;
    selected?: boolean;
    dim?: boolean;
  },
): UiObject[] {
  const out: UiObject[] = [];
  const cy = y + ROW_H / 2;

  // The selection band: a full-width wash plus the accent rule on the left.
  if (opts.selected) {
    out.push(scene.add.rectangle(x, y, w, ROW_H, UI.accent).setOrigin(0, 0).setAlpha(0.13).setDepth(depth));
    out.push(scene.add.rectangle(x, y, 2, ROW_H, UI.accent).setOrigin(0, 0).setDepth(depth + 1));
  }

  let textX = x + 8;
  if (opts.iconKey) {
    out.push(scene.add.image(x + 14, cy, opts.iconKey).setOrigin(0.5).setDepth(depth + 1));
    textX = x + 26;
  }
  const labelColor = opts.dim ? '#6b6862' : opts.selected ? hex(PALETTE.lightHigh) : hex(TEXT.primary);
  out.push(
    scene.add
      .text(textX, cy, opts.label, { fontFamily: 'monospace', fontSize: `${TYPE.body}px`, color: labelColor })
      .setOrigin(0, 0.5)
      .setDepth(depth + 1),
  );
  if (opts.value !== undefined) {
    out.push(
      scene.add
        .text(x + w - 8, cy, opts.value, { fontFamily: 'monospace', fontSize: `${TYPE.body}px`, color: opts.dim ? '#6b6862' : hex(TEXT.highlight) })
        .setOrigin(1, 0.5)
        .setDepth(depth + 1),
    );
  }
  return out;
}
