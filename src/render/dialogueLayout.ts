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
// The BASE well height: two body lines plus the well's own padding. Two is what
// the longest authored line needs at DIALOG_TEXT_W (see dialogueLayout.test.ts);
// the well is sized for that, not for one line, because a one-line-tall well cut
// the second line off. dialogueWellHeight() grows past this for longer messages
// — the AI opening line is capped at 60 characters (ai/rulesExecutor
// MAX_UTTERANCE), which wraps to five lines at this width, and a fixed two-line
// well let that text run straight over the option rows.
export const DIALOG_WELL_H = 72;

/** Option rows, measured from the panel top: 4 rows of 26 on a 30px pitch. */
export const DIALOG_ROWS_TOP = 132;
export const DIALOG_ROW_PITCH = 30;
export const DIALOG_ROW_H = 26;
/** How many option rows the panel draws. */
export const DIALOG_ROW_COUNT = 4;

/** Well bottom edge → first option row. Absorbs a one-line wrap estimate error. */
export const DIALOG_WELL_ROW_GAP = 8;
/** Last row → panel bottom edge: the footer line's reserved band. */
export const DIALOG_FOOTER_H = 40;

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

/**
 * How tall the speech well must be to hold `message` after wrapping.
 *
 * The well used to be a fixed DIALOG_WELL_H sized for two lines, which the
 * authored greetings fit — but the AI opening line is capped at 60 characters
 * (ai/rulesExecutor MAX_UTTERANCE) and 60 Han glyphs at 24px is 1440px, five
 * lines in the 308px column. The text is vertically centred in the well, so a
 * five-line message in a two-line well spilled ~40px past the well's bottom
 * edge and printed straight over the first option row. Sizing the well from the
 * wrapped line count is what keeps the speech inside its own box.
 */
export function dialogueWellHeight(message: string, fontSize: number): number {
  const lines = wrapText(message, DIALOG_TEXT_W, fontSize).length;
  return Math.max(DIALOG_WELL_H, lines * estimateLineHeight(fontSize) + DIALOG_WELL_PAD * 2);
}

export interface DialogueGeometry {
  /** Speech well height for this message. */
  wellH: number;
  /** Option-row top, pushed down when the well grew. */
  rowsTop: number;
  /** Panel height, grown when the rows were pushed. */
  panelH: number;
}

/**
 * The dialogue panel's vertical geometry for one message.
 *
 * Everything derives from the well, and every step is a max() against the base
 * layout so a short message keeps the panel's authored shape: a one-line
 * greeting still opens at 460x300 with the rows at DIALOG_ROWS_TOP, and only a
 * message that actually needs the room grows the well, then the rows below it,
 * then the panel around both. Worst case (60 Han characters at 24px) is five
 * lines: well 151, rows 189, panel 345 — still 275px clear of the HUD foot bar
 * on the 720px canvas.
 */
export function dialogueGeometry(message: string, fontSize: number): DialogueGeometry {
  const wellH = dialogueWellHeight(message, fontSize);
  const rowsTop = Math.max(DIALOG_ROWS_TOP, DIALOG_WELL_TOP + wellH + DIALOG_WELL_ROW_GAP);
  const rowsBottom = rowsTop + DIALOG_ROW_PITCH * (DIALOG_ROW_COUNT - 1) + DIALOG_ROW_H;
  const panelH = Math.max(DIALOG_PANEL_H, rowsBottom + DIALOG_FOOTER_H);
  return { wellH, rowsTop, panelH };
}

function isWideChar(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x2e80 && c <= 0x9fff) || // CJK radicals, kana, unified ideographs
    (c >= 0x3000 && c <= 0x303f) || // CJK punctuation
    (c >= 0xff00 && c <= 0xffef) // fullwidth forms
  );
}
