// Geometry of the dialogue panel's portrait column and speech well.
//
// WHY THIS FILE EXISTS. These numbers used to live inline in GameScene's
// buildDialoguePanel, and the message was drawn as a centred, 316px-wide Text at
// a 282px offset from the panel's left edge. With a 96px portrait that put the
// text's left edge 84px INSIDE the face and its right edge 80px outside the
// panel: the portrait and the longest line ("电线和保险丝，去维修层(4)的电箱能稳定找到。",
// measured 516px at 24px) occupied the same pixels. Nothing failed — the text was
// simply painted over the art.
//
// The real cause was that wordWrap without `useAdvancedWrap` only breaks on
// spaces, and Chinese has none, so the 316px wrap width was never applied and the
// line ran on. Both the geometry and the wrap contract live here now, and
// dialogueLayout.test.ts checks them against the actual dialogue strings so the
// numbers cannot drift apart again.

/** Panel footprint. Same 460 width as the inventory, so modals read as one set. */
export const DIALOG_PANEL_W = 460;
export const DIALOG_PANEL_H = 300;

/** Panel edge → first content column (portrait). */
export const DIALOG_PADDING = 12;

/** The bust is drawn at its native size; scaling pixel art blurs it. */
export const DIALOG_PORTRAIT_SIZE = 96;
/** Portrait top, measured from the panel top. Clears the 20px header strip. */
export const DIALOG_PORTRAIT_TOP = 30;

/** Portrait right edge → speech well: the face must never touch the text. */
export const DIALOG_TEXT_GAP = 12;
/** Speech well right edge → panel right edge. */
export const DIALOG_TEXT_RIGHT_PAD = 16;
/** Speech well border → the text inside it. */
export const DIALOG_WELL_PAD = 8;

/** Speech well, measured from the panel top. */
export const DIALOG_WELL_TOP = 30;
// Two body lines plus the well's own padding. Two is what the longest authored
// line needs at DIALOG_TEXT_W (see dialogueLayout.test.ts); the well is sized for
// that, not for one line, because a one-line-tall well cut the second line off.
export const DIALOG_WELL_H = 72;

/** Option rows, measured from the panel top: 4 rows of 26 on a 30px pitch. */
export const DIALOG_ROWS_TOP = 132;
export const DIALOG_ROW_PITCH = 30;
export const DIALOG_ROW_H = 26;

// ── derived column ───────────────────────────────────────────────────────────
/** Well left edge, from the panel left: padding + face + gap. */
export const DIALOG_WELL_LEFT = DIALOG_PADDING + DIALOG_PORTRAIT_SIZE + DIALOG_TEXT_GAP;
/** Usable well width. */
export const DIALOG_WELL_W =
  DIALOG_PANEL_W - DIALOG_PADDING - DIALOG_PORTRAIT_SIZE - DIALOG_TEXT_GAP - DIALOG_TEXT_RIGHT_PAD;
/** Text left edge, from the panel left. */
export const DIALOG_TEXT_LEFT = DIALOG_WELL_LEFT + DIALOG_WELL_PAD;
/** Width the message may occupy — the number handed to setWordWrapWidth. */
export const DIALOG_TEXT_W = DIALOG_WELL_W - DIALOG_WELL_PAD * 2;

/**
 * Rough advance width of a string at a given font size.
 *
 * A Han/fullwidth glyph is one em; Latin, digits and the arithmetic signs this
 * UI uses run about 0.6em in the pixel faces. Good to a few percent against
 * Phaser's own measurement (252px measured vs 245 estimated for
 * "用 废金属×1 换 电线×1" at 24px), which is all a layout guard needs — the point
 * is to catch a panel that is 80px too narrow, not to reproduce the rasteriser.
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) width += isWideChar(ch) ? fontSize : fontSize * 0.6;
  return width;
}

/** One line's height at a font size, with the same few percent of air Phaser adds. */
export function estimateLineHeight(fontSize: number): number {
  return Math.ceil(fontSize * 1.1);
}

/** Greedy wrap on our own metric, so a layout check can predict line count. */
export function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    const next = line + ch;
    if (line !== '' && estimateTextWidth(next, fontSize) > maxWidth) {
      lines.push(line);
      line = ch;
    } else {
      line = next;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

function isWideChar(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x2e80 && c <= 0x9fff) || // CJK radicals, kana, unified ideographs
    (c >= 0x3000 && c <= 0x303f) || // CJK punctuation
    (c >= 0xff00 && c <= 0xffef) // fullwidth forms
  );
}
