import Phaser from 'phaser';

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
export const HUD_BAR_H = 26;
export const HUD_FOOT_H = 16;

// ── the type scale ──────────────────────────────────────────────────────────
// Only three sizes. The old UI mixed 11/12/13/16/18/22/40 with no rule, which
// is most of why it read as a prototype.
export const TYPE = {
  /** panel and HUD titles */
  title: 13,
  /** body rows, values */
  body: 10,
  /** captions, hints, the smallest legal text */
  caption: 8,
} as const;

// ── the colour roles ────────────────────────────────────────────────────────
// Roles, not raw hex at the call site: a stat bar, a warning and a value all
// need to be changed together, and they were not.
export const UI = {
  /** panel and bar fill — translucent so the world reads through */
  surface: 0x0b0f12,
  surfaceAlpha: 0.88,
  /** one step lighter, for headers and inset wells */
  surfaceRaised: 0x18242c,
  /** the hairline between rows and around wells */
  line: 0x2c3f4e,
  /** body text */
  text: 0xece8d8,
  /** de-emphasised text: hints, units, locked rows */
  textDim: 0x8a867c,
  /** the warm accent: titles, selection, gold */
  accent: 0xf4b66a,
  /** the teal accent: safe things, positive deltas */
  good: 0x77c6a4,
  /** the red accent: damage, blockers, danger */
  danger: 0xe56d63,
  /** bar troughs */
  trough: 0x1a2228,
} as const;

// The four survival stats each own a colour, so a glance at the bar tells you
// which stat is failing without reading the label.
export const STAT_COLORS: Record<string, number> = {
  hp: 0xd8665f,
  hunger: 0xd8a35f,
  thirst: 0x5fa8d8,
  energy: 0x8fd86a,
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
      .text(titleX ?? left + 10, top + h / 2, title, { fontFamily: 'monospace', fontSize: `${TYPE.title}px`, color: '#ece8d8' })
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
export const ROW_H = 24;

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
  const labelColor = opts.dim ? '#6b6862' : opts.selected ? '#f4b66a' : '#ece8d8';
  out.push(
    scene.add
      .text(textX, cy, opts.label, { fontFamily: 'monospace', fontSize: `${TYPE.body}px`, color: labelColor })
      .setOrigin(0, 0.5)
      .setDepth(depth + 1),
  );
  if (opts.value !== undefined) {
    out.push(
      scene.add
        .text(x + w - 8, cy, opts.value, { fontFamily: 'monospace', fontSize: `${TYPE.body}px`, color: opts.dim ? '#6b6862' : '#a8e0c8' })
        .setOrigin(1, 0.5)
        .setDepth(depth + 1),
    );
  }
  return out;
}
