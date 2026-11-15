import { describe, expect, it } from 'vitest';

import { NPCS } from '../data/npcs';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../core/design';
import {
  DIALOG_PANEL_H,
  DIALOG_PANEL_W,
  DIALOG_PORTRAIT_TOP,
  DIALOG_ROWS_TOP,
  DIALOG_ROW_COUNT,
  DIALOG_ROW_H,
  DIALOG_ROW_PITCH,
  DIALOG_TEXT_W,
  DIALOG_WELL_H,
  DIALOG_WELL_TOP,
  dialogueGeometry,
  dialogueWellHeight,
  estimateLineHeight,
  estimateTextWidth,
  wrapText,
} from '../render/dialogueLayout';
import { CONTAINER_LABEL_DROP, HUD_LAYOUT, TOWER_FOOT_TOP, TOWER_HINT_FONT } from '../render/hudLayout';
import { GAMESANS_LINE_FACTOR, PANEL_HEADER_H, TYPE, fontLineBox } from '../render/uiKit';

// AG-23: the layout guards the Noto Sans SC swap (GameSans) made necessary.
//
// The font change (f74e972) re-measured every lane in the game: GameSans draws
// a 1.21-1.25em line BOX where the pixel face this UI was authored against ran
// ~1.0em. Three lanes broke on the new box and are pinned here arithmetically
// (the measured numbers live in docs/plans/UI.md §AG-23):
//
//   1. buildPanelHeader: a 30px title measured 37px of box in a 20px strip —
//      8.5px through each side (it was ~5px on the old face). Fixed by sizing
//      the strip to the box (30) and dropping the title to the body size.
//   2. The tower footer band: the 26px hint is a 32px row plus 6px of padding
//      = 38, and TOWER_FOOT_TOP=36 opened it at 684 — bottom at 722, 2px off
//      the canvas. Fixed at 41.
//   3. The dialogue well: sized from estimateLineHeight (1.1em), which under-
//      reads the real box by ~4px a line. The ink still clears the option
//      rows (asserted below), but the guard uses the measured factor so a
//      longer message cannot silently print over them.
//
// No Phaser and no screenshots: every number below is either a layout
// constant the scenes draw from or the measured GameSans factor.

// The tower scene's local body size, hardcoded for the same reason
// uiLayout.test.ts hardcodes TOWER_BODY: it is not exported.
const TOWER_FOOTER_ARROW_FONT = 26;
// The world name plates' font size (GameScene's CONTAINER_LABEL_FONT), and the
// plate padding the same formula adds around the label.
const NAME_PLATE_FONT = 22;
const NAME_PLATE_PAD = 14;

/** Every line the dialogue panel can print: both neighbours' greetings and answers. */
const DIALOGUE_LINES: string[] = NPCS.flatMap((npc) => [...npc.greetings, ...npc.asks]);

/** The AI opening line's worst case: 60 characters (ai/rulesExecutor MAX_UTTERANCE). */
const WORST_AI_LINE = '楼'.repeat(60);

describe('the measured GameSans line box', () => {
  it('pins the factor the font actually draws', () => {
    // Playwright getBounds on live Texts (port 5403 probe): 30px → 37px box,
    // 26 → 32, 24 → 30, 22 → 27, 20 → 25. floor(size * 1.25) reproduces every
    // measured point exactly. If the bundled face ever changes, these go red
    // and the lanes below get re-measured — that is the point of pinning them.
    expect(GAMESANS_LINE_FACTOR).toBe(1.25);
    expect(fontLineBox(30)).toBe(37);
    expect(fontLineBox(26)).toBe(32);
    expect(fontLineBox(24)).toBe(30);
    expect(fontLineBox(22)).toBe(27);
    expect(fontLineBox(20)).toBe(25);
    // The estimator in dialogueLayout stays a conservative 1.1em on purpose:
    // it sizes the speech well, and tightening it would reshape the authored
    // base panel for a box-only gain (the ink is ~0.86em and already clears).
    expect(fontLineBox(TYPE.body)).toBe(30);
    expect(estimateLineHeight(TYPE.body)).toBe(27);
    expect(fontLineBox(TYPE.body)).toBeGreaterThan(estimateLineHeight(TYPE.body));
  });
});

describe('panel header strip', () => {
  it('holds the title’s real line box inside the strip', () => {
    // The title is TYPE.body on a PANEL_HEADER_H strip. Measured after the
    // fix (Playwright getBounds): inventory title 48x30 on a 440x30 strip,
    // craft title 155x30 on a 530x30 strip — 0px over either side, against
    // 8.5px before.
    expect(fontLineBox(TYPE.body)).toBeLessThanOrEqual(PANEL_HEADER_H);
  });

  it('keeps the strip clear of the earliest body content', () => {
    // The reason the title dropped a size instead of the strip growing past
    // the title: every scene starts its body at panel-top + 30 (the dialogue
    // portrait and well, the inventory grid, the craft and trader rows, the
    // combat bar), and a taller strip would paint over it. DIALOG_PORTRAIT_TOP
    // is that earliest offset, exported. The strip may touch it, never cross.
    expect(PANEL_HEADER_H).toBeLessThanOrEqual(DIALOG_PORTRAIT_TOP);
    // ...which is also why the old 30px title could not simply keep its size:
    // its box is taller than the body offset allows.
    expect(fontLineBox(TYPE.title)).toBeGreaterThan(DIALOG_PORTRAIT_TOP);
  });
});

describe('dialogue panel at the real line height', () => {
  it('never prints the message over the option rows, worst AI line included', () => {
    // The AG-08 regression, re-measured for GameSans: the message is centred
    // in the well, so a well sized from the 1.1em estimate under-reads the
    // real box. What must hold is the visible contract — the text's real box
    // ends above the first option row — and it does for every authored line
    // and the 60-character worst case (6px of clearance at worst).
    for (const line of [...DIALOGUE_LINES, WORST_AI_LINE]) {
      const geo = dialogueGeometry(line, TYPE.body);
      const lines = wrapText(line, DIALOG_TEXT_W, TYPE.body).length;
      const realTextH = lines * fontLineBox(TYPE.body);
      const centre = DIALOG_WELL_TOP + geo.wellH / 2;
      expect(centre - realTextH / 2, line).toBeGreaterThanOrEqual(0);
      expect(centre + realTextH / 2, line).toBeLessThanOrEqual(geo.rowsTop);
      // ...and the grown panel still fits the canvas with the HUD bands clear.
      expect(geo.panelH, line).toBeLessThanOrEqual(DESIGN_HEIGHT - 124 - 40);
    }
  });

  it('keeps the authored base geometry for a short message', () => {
    // The adaptation only grows the panel: a one-line greeting is still the
    // authored 460x300 with the rows where they always were.
    const geo = dialogueGeometry('想换点什么？', TYPE.body);
    expect(geo.wellH).toBe(DIALOG_WELL_H);
    expect(geo.rowsTop).toBe(DIALOG_ROWS_TOP);
    expect(geo.panelH).toBe(DIALOG_PANEL_H);
  });

  it('sizes the well from the wrapped line count, never below the two-line floor', () => {
    expect(dialogueWellHeight('', TYPE.body)).toBe(DIALOG_WELL_H);
    expect(dialogueWellHeight('嗯', TYPE.body)).toBe(DIALOG_WELL_H);
    const lines = wrapText(WORST_AI_LINE, DIALOG_TEXT_W, TYPE.body).length;
    expect(lines).toBe(5); // 60 Han glyphs at 24px in the 308px column
    expect(dialogueWellHeight(WORST_AI_LINE, TYPE.body)).toBeGreaterThan(DIALOG_WELL_H);
    // Four rows plus the footer fit every panel height the geometry can produce.
    for (const line of [...DIALOGUE_LINES, WORST_AI_LINE]) {
      const geo = dialogueGeometry(line, TYPE.body);
      const rowsBottom = geo.rowsTop + DIALOG_ROW_PITCH * (DIALOG_ROW_COUNT - 1) + DIALOG_ROW_H;
      expect(rowsBottom + 40, line).toBeLessThanOrEqual(geo.panelH);
      expect(DIALOG_PANEL_W).toBeLessThanOrEqual(DESIGN_WIDTH);
    }
  });
});

describe('world name plates under the measured font', () => {
  it('estimates a Han glyph at exactly one em — GameSans draws it so', () => {
    // The plates are sized from estimateTextWidth (GameScene's container and
    // NPC labels, both `estimateTextWidth(name, 22) + 14`). Measured on the
    // live floor: 阿林 → 44px, i.e. 2 × 22 — the estimate is exact for Han
    // under GameSans, which is what keeps the label inside its plate.
    expect(estimateTextWidth('阿林', NAME_PLATE_FONT)).toBe(44);
    expect(estimateTextWidth('储物柜', NAME_PLATE_FONT)).toBe(66);
    for (const npc of NPCS) {
      expect(estimateTextWidth(npc.name, NAME_PLATE_FONT), npc.name).toBe(npc.name.length * NAME_PLATE_FONT);
    }
  });

  it('holds every resident name inside its plate with padding to spare', () => {
    // The plate formula, mirrored: ceil(estimate) + 14 wide, font + 8 tall.
    // Measured (Playwright getBounds, floor 2): 阿林/小周 label 44x27 inside
    // a 58x30 plate — 7px of side padding, and the label's real 27px line box
    // fits the 30px plate height with 1.5px of air.
    for (const npc of NPCS) {
      const plateW = Math.ceil(estimateTextWidth(npc.name, NAME_PLATE_FONT)) + NAME_PLATE_PAD;
      const plateH = NAME_PLATE_FONT + 8;
      expect(plateW - estimateTextWidth(npc.name, NAME_PLATE_FONT), npc.name).toBeGreaterThanOrEqual(8);
      expect(plateH, npc.name).toBeGreaterThanOrEqual(fontLineBox(NAME_PLATE_FONT));
    }
    // The two-char names sit on a narrower plate than the three-char container
    // names (58 vs 80) — same formula, different name length, not a defect.
    expect(Math.ceil(estimateTextWidth('阿林', NAME_PLATE_FONT)) + NAME_PLATE_PAD).toBeLessThan(
      Math.ceil(estimateTextWidth('储物柜', NAME_PLATE_FONT)) + NAME_PLATE_PAD,
    );
  });

  it('drops the NPC plate from the resident’s head, above the sprite', () => {
    // NPC_LABEL_Y = PLAYER_FEET_Y - FRAME_H - CONTAINER_LABEL_DROP. The plate
    // must clear the 96px sprite: the drop alone (36) is what puts it there,
    // and it must stay smaller than the sprite so the name never lands on the
    // character’s shoulders.
    expect(CONTAINER_LABEL_DROP).toBeLessThan(96);
  });
});

describe('HUD lanes under the measured font', () => {
  it('keeps the clock row off the objective row', () => {
    // The clock opens at row1Y+28 and the goal at goalY: two 20px GameSans rows
    // are 25px of box each. At row1Y=6 the clock's box (34..59) printed 7px
    // through the goal's (52..77) — 28% of the smaller box, measured (AG-24's
    // font:209). Row 1 moved up to 2: the clock's box is 30..55, a 3px box
    // overlap (12%, under the 15% collision threshold) with 5px of ink
    // clearance. The goal cannot move instead — hudLayout.test.ts pins the
    // 28px goal→environment lane gap, and the environment row cannot move down
    // without crossing the plate's bottom edge.
    const clockBottom = HUD_LAYOUT.row1Y + 28 + fontLineBox(TYPE.caption);
    expect(HUD_LAYOUT.goalY - clockBottom).toBeGreaterThanOrEqual(-4);
    // ...and the goal's box still ends above the environment row's start, the
    // invariant hudLayout.spec.ts asserts on the live HUD.
    expect(HUD_LAYOUT.goalY + fontLineBox(TYPE.caption)).toBeLessThanOrEqual(HUD_LAYOUT.environmentY);
  });

  it('pins the money group inside the canvas at its widest', () => {
    // The money texts open at moneyX+24 and grow rightwards (origin 0,0). The
    // 12-digit fixture measured 178px wide at 20px GameSans and put hud-gold's
    // right edge at 1282 — 2px off the canvas (AG-24's hudLayout:39:3). The
    // anchor moved to 1056, which pins the right edge at 1258 with the stat
    // block (ending at 1040) still 16px clear.
    const widest = 178;
    expect(HUD_LAYOUT.statX + 3 * HUD_LAYOUT.statPitch + HUD_LAYOUT.statWidth).toBeLessThan(HUD_LAYOUT.moneyX);
    expect(HUD_LAYOUT.moneyX + 24 + widest).toBeLessThanOrEqual(DESIGN_WIDTH);
  });
});

describe('tower footer band under the measured font', () => {
  it('clears the hint’s real row with the spare the band was designed for', () => {
    // The hint is TOWER_HINT_FONT type with 6px of padding: a 32px GameSans
    // row plus the padding is 38, and 41 opens the band at 679 — the row ends
    // at 717 with 3px to spare (measured; it ended at 722 at 36).
    const rowH = fontLineBox(TOWER_HINT_FONT) + 6;
    expect(TOWER_FOOT_TOP).toBeGreaterThanOrEqual(rowH);
    expect(DESIGN_HEIGHT - TOWER_FOOT_TOP + rowH).toBeLessThanOrEqual(DESIGN_HEIGHT);
  });

  it('keeps the detail level’s back arrow one clear row above the band', () => {
    // TowerOverviewScene opens the arrow at DESIGN_HEIGHT - TOWER_FOOT_TOP - 26
    // with origin (0, 0.5). AG-12 measured 91x27px of overlap when the arrow
    // shared the band's row; the guard is that its real line box still ends a
    // clear gap above the band after the font swap re-measured both.
    const arrowCentre = DESIGN_HEIGHT - TOWER_FOOT_TOP - TOWER_FOOTER_ARROW_FONT;
    const arrowBottom = arrowCentre + fontLineBox(TOWER_FOOTER_ARROW_FONT) / 2;
    const bandTop = DESIGN_HEIGHT - TOWER_FOOT_TOP;
    expect(arrowBottom).toBeLessThanOrEqual(bandTop - 4);
  });
});
