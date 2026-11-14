import { describe, expect, it } from 'vitest';

import { NPCS } from '../data/npcs';
import {
  DIALOG_PADDING,
  DIALOG_PANEL_H,
  DIALOG_PANEL_W,
  DIALOG_PORTRAIT_SIZE,
  DIALOG_ROW_H,
  DIALOG_ROW_PITCH,
  DIALOG_ROWS_TOP,
  DIALOG_TEXT_GAP,
  DIALOG_TEXT_LEFT,
  DIALOG_TEXT_RIGHT_PAD,
  DIALOG_TEXT_W,
  DIALOG_WELL_H,
  DIALOG_WELL_LEFT,
  DIALOG_WELL_PAD,
  DIALOG_WELL_TOP,
  DIALOG_WELL_W,
  estimateLineHeight,
  estimateTextWidth,
  wrapText,
} from '../render/dialogueLayout';
import { TYPE } from '../render/uiKit';

// The dialogue panel's 96x96 bust shipped without a long line ever being looked
// at, and the longest authored line (电线和保险丝，去维修层(4)的电箱能稳定找到。,
// 516px at 24px) was drawn straight across the face and 80px past the frame: the
// message was centred at a fixed offset and its wordWrap width was never applied,
// because Phaser's basic wrapper only breaks on spaces and Chinese has none.
//
// These checks are arithmetic, not screenshots. Every number comes from
// render/dialogueLayout — the same constants buildDialoguePanel draws from — and
// every line comes from the dialogue data, so a longer line or a narrowed column
// turns this red before anyone has to spot it in a screenshot.

const FONT = TYPE.body;

/** Every line the panel can print: both neighbours' greetings and answers. */
const DIALOGUE_LINES: string[] = NPCS.flatMap((npc) => [...npc.greetings, ...npc.asks]);

/** The widest of them, by the panel's own metric. */
const LONGEST = DIALOGUE_LINES.reduce((widest, line) =>
  estimateTextWidth(line, FONT) > estimateTextWidth(widest, FONT) ? line : widest,
);

describe('dialogue panel layout', () => {
  it('estimates one em for a Han glyph and 0.6em for Latin', () => {
    expect(estimateTextWidth('中', FONT)).toBe(FONT);
    expect(estimateTextWidth('A', FONT)).toBeCloseTo(FONT * 0.6, 5);
    expect(estimateTextWidth('中文A', FONT)).toBeCloseTo(FONT * 2.6, 5);
  });

  it('keeps the text column clear of the portrait and inside the right padding', () => {
    // Left edge: past the face by the full gap, which is what "text must not
    // press on the portrait" means in pixels.
    expect(DIALOG_TEXT_LEFT).toBeGreaterThanOrEqual(DIALOG_PADDING + DIALOG_PORTRAIT_SIZE + DIALOG_TEXT_GAP);
    // Right edge: the panel's own inner padding is never crossed.
    expect(DIALOG_TEXT_LEFT + DIALOG_TEXT_W).toBeLessThanOrEqual(DIALOG_PANEL_W - DIALOG_TEXT_RIGHT_PAD);
    // The well wraps that column and stops short of the frame too.
    expect(DIALOG_WELL_LEFT).toBeGreaterThanOrEqual(DIALOG_PADDING + DIALOG_PORTRAIT_SIZE + DIALOG_TEXT_GAP);
    expect(DIALOG_WELL_LEFT + DIALOG_WELL_W).toBeLessThanOrEqual(DIALOG_PANEL_W - DIALOG_TEXT_RIGHT_PAD);
    expect(DIALOG_TEXT_W).toBe(DIALOG_WELL_W - DIALOG_WELL_PAD * 2);
  });

  it('wraps the longest authored line inside the column without losing a character', () => {
    for (const line of DIALOGUE_LINES) {
      const wrapped = wrapText(line, DIALOG_TEXT_W, FONT);
      expect(wrapped.join('')).toBe(line);
      for (const piece of wrapped) {
        expect(estimateTextWidth(piece, FONT)).toBeLessThanOrEqual(DIALOG_TEXT_W);
      }
    }
  });

  it('holds the longest line in the speech well, and holds two lines at all', () => {
    const lineHeight = estimateLineHeight(FONT);
    const usableHeight = DIALOG_WELL_H - DIALOG_WELL_PAD * 2;

    // Design floor: the well is built for two wrapped body lines. A one-line
    // well is what cut the second line off before the bust landed.
    expect(usableHeight).toBeGreaterThanOrEqual(lineHeight * 2);

    // Actual requirement: the widest authored line fits after wrapping.
    const needed = wrapText(LONGEST, DIALOG_TEXT_W, FONT).length * lineHeight;
    expect(needed).toBeLessThanOrEqual(usableHeight);
  });

  it('stacks the well, the option rows and the footer without overlapping', () => {
    // The speech well ends above the first option row...
    expect(DIALOG_WELL_TOP + DIALOG_WELL_H).toBeLessThanOrEqual(DIALOG_ROWS_TOP);
    // ...four rows fit above the footer...
    const rowsBottom = DIALOG_ROWS_TOP + DIALOG_ROW_PITCH * 3 + DIALOG_ROW_H;
    expect(rowsBottom).toBeLessThanOrEqual(DIALOG_PANEL_H - 40);
    // ...and the portrait, which is taller than the well, still clears the rows.
    expect(DIALOG_WELL_TOP + DIALOG_PORTRAIT_SIZE).toBeLessThanOrEqual(DIALOG_ROWS_TOP);
  });
});
