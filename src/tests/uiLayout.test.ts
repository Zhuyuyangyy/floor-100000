import { describe, expect, it } from 'vitest';

import { NPCS } from '../data/npcs';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../core/design';
import { FLOOR_HEIGHT, PLAYABLE_FLOORS_V01 } from '../core/constants';
import { sectorOf } from '../core/tower';
import { encounterSpots } from '../systems/encounterSpots';
import { ENCOUNTER_TABLE } from '../systems/encounters';
import { CONTENT_TOP, HUD_BOTTOM } from '../systems/TowerNav';
import {
  DIALOG_FOOTER_H,
  DIALOG_PANEL_H,
  DIALOG_PANEL_W,
  DIALOG_ROWS_TOP,
  DIALOG_ROW_COUNT,
  DIALOG_ROW_H,
  DIALOG_ROW_PITCH,
  DIALOG_TEXT_W,
  DIALOG_WELL_H,
  DIALOG_WELL_PAD,
  DIALOG_WELL_ROW_GAP,
  DIALOG_WELL_TOP,
  dialogueGeometry,
  dialogueWellHeight,
  estimateLineHeight,
  estimateTextWidth,
  wrapText,
} from '../render/dialogueLayout';
import {
  CONTAINER_LABEL_DROP,
  DETAIL_CONTENT_ACTION_GAP,
  DETAIL_CONTENT_W,
  DETAIL_FOOT_PAD,
  DETAIL_PANEL_H,
  DETAIL_PANEL_W,
  DETAIL_ROW_COUNT,
  DETAIL_ROW_PITCH,
  DETAIL_ROW_X,
  DETAIL_ROWS_TOP,
  TOWER_FOOT_TOP,
  TOWER_HINT_FONT,
  TOWER_STRIP_W,
  TOWER_STRIP_X,
  TOWER_TAG_FONT,
  TOWER_TAG_X,
} from '../render/hudLayout';
import { TYPE, fontLineBox } from '../render/uiKit';

// AG-08 UI/UX: layout guards for every surface the team's checkup measured.
//
// These are arithmetic assertions on the geometry constants the scenes draw
// from — estimateTextWidth/wrapText predict the line counts, the constants
// come from render/dialogueLayout and render/hudLayout — so a panel that
// overflows, a row that prints through the next, or a tag that leaves the
// canvas turns red here instead of in a screenshot review. No Phaser: the
// constants live in modules that keep the Phaser import type-only.
//
// The canvas is the design resolution (1280x720) and Scale.FIT letterboxes it
// across window sizes without moving a single lane, so "inside the canvas" IS
// the responsive guarantee — nothing here can pass at one window size and
// clip at another.

// The tower scene's local type sizes (TowerOverviewScene's own TYPE_* table —
// not uiKit's TYPE, which the dialogue uses). Hardcoded because they are not
// exported; if that table changes, these literals change with it.
const TOWER_BODY = 26;
// The AI opening line's worst case: ai/rulesExecutor caps an utterance at 60
// characters, and 60 Han glyphs at 24px is 1440px — five lines in the column.
const WORST_AI_LINE = '楼'.repeat(60);
// Measured across seeds 42/7/2026 with a temp probe: the longest
// describeFloorContents output the floor templates can produce (floor 50008).
const WORST_CONTENT = '实验台：压缩口粮·滤芯　药品柜：脏水　样本箱：电池·保险丝　器皿架：布料　地面：布料';

/** Every line the dialogue panel can print: both neighbours' greetings and answers. */
const DIALOGUE_LINES: string[] = NPCS.flatMap((npc) => [...npc.greetings, ...npc.asks]);

describe('dialogue panel adaptive geometry', () => {
  it('keeps the authored base geometry for a short message', () => {
    // A one-line greeting still opens at the authored 460x300 with the rows
    // where they always were — the adaptation only grows the panel.
    const geo = dialogueGeometry('想换点什么？', TYPE.body);
    expect(geo.wellH).toBe(DIALOG_WELL_H);
    expect(geo.rowsTop).toBe(DIALOG_ROWS_TOP);
    expect(geo.panelH).toBe(DIALOG_PANEL_H);
  });

  it('holds every authored line inside its well, rows clear of the well, footer inside the panel', () => {
    for (const line of DIALOGUE_LINES) {
      const geo = dialogueGeometry(line, TYPE.body);
      const lines = wrapText(line, DIALOG_TEXT_W, TYPE.body).length;
      const lineH = estimateLineHeight(TYPE.body);
      // The well holds the wrapped lines...
      expect(geo.wellH, line).toBeGreaterThanOrEqual(lines * lineH + DIALOG_WELL_PAD * 2);
      // ...the rows start below the well with the reserved gap...
      expect(geo.rowsTop, line).toBeGreaterThanOrEqual(DIALOG_WELL_TOP + geo.wellH + DIALOG_WELL_ROW_GAP);
      // ...and four rows plus the footer's band fit the panel.
      const rowsBottom = geo.rowsTop + DIALOG_ROW_PITCH * (DIALOG_ROW_COUNT - 1) + DIALOG_ROW_H;
      expect(rowsBottom + DIALOG_FOOTER_H, line).toBeLessThanOrEqual(geo.panelH);
    }
  });

  it('keeps the message text inside the well for every line, worst AI line included', () => {
    // The regression this file exists for: the well used to be a fixed 72px
    // (two lines), and the message is vertically centred in it — a five-line
    // AI opening was centred at the two-line well's middle and spilled ~40px
    // over the first option row. Now the well is sized from the line count.
    for (const line of [...DIALOGUE_LINES, WORST_AI_LINE]) {
      const geo = dialogueGeometry(line, TYPE.body);
      const lines = wrapText(line, DIALOG_TEXT_W, TYPE.body).length;
      const textH = lines * estimateLineHeight(TYPE.body);
      const centre = DIALOG_WELL_TOP + geo.wellH / 2;
      expect(centre - textH / 2, line).toBeGreaterThanOrEqual(DIALOG_WELL_TOP);
      expect(centre + textH / 2, line).toBeLessThanOrEqual(DIALOG_WELL_TOP + geo.wellH);
    }
  });

  it('grows the panel for the 60-character AI line, and still fits the canvas', () => {
    const lines = wrapText(WORST_AI_LINE, DIALOG_TEXT_W, TYPE.body);
    expect(lines.length).toBe(5); // 60 Han glyphs at 24px in the 308px column
    const geo = dialogueGeometry(WORST_AI_LINE, TYPE.body);
    expect(geo.wellH).toBeGreaterThan(DIALOG_WELL_H);
    expect(geo.rowsTop).toBeGreaterThan(DIALOG_ROWS_TOP);
    expect(geo.panelH).toBeGreaterThan(DIALOG_PANEL_H);
    // The HUD bands (124 top, 40 foot) stay clear of the grown panel.
    expect(geo.panelH).toBeLessThanOrEqual(DESIGN_HEIGHT - 124 - 40);
    // ...and the panel's own frame is not crossed by the rows or the footer.
    const rowsBottom = geo.rowsTop + DIALOG_ROW_PITCH * (DIALOG_ROW_COUNT - 1) + DIALOG_ROW_H;
    expect(rowsBottom + DIALOG_FOOTER_H).toBeLessThanOrEqual(geo.panelH);
  });

  it('never sizes a well below the two-line floor', () => {
    expect(dialogueWellHeight('', TYPE.body)).toBe(DIALOG_WELL_H);
    expect(dialogueWellHeight('嗯', TYPE.body)).toBe(DIALOG_WELL_H);
    expect(dialogueWellHeight(WORST_AI_LINE, TYPE.body)).toBeGreaterThan(DIALOG_WELL_H);
  });
});

describe('tower overview lanes', () => {
  it('keeps the endpoint tags inside the canvas', () => {
    // The summit tag is the widest: 169px at 22px, measured on the old build
    // where the strip ran to a symmetric 110px margin and the tag's right edge
    // sat at 1349 — 69px past the 1280 canvas.
    expect(TOWER_TAG_X + estimateTextWidth('终点 第100000层', TOWER_TAG_FONT)).toBeLessThanOrEqual(DESIGN_WIDTH);
    expect(TOWER_TAG_X + estimateTextWidth('起点 第1层', TOWER_TAG_FONT)).toBeLessThanOrEqual(DESIGN_WIDTH);
  });

  it('leaves the tags a margin between the strip and the canvas edge', () => {
    expect(TOWER_TAG_X).toBeGreaterThan(TOWER_STRIP_X + TOWER_STRIP_W);
    // offset + the widest tag + a right inset, all inside the canvas
    expect(TOWER_STRIP_X + TOWER_STRIP_W + 10 + 169).toBeLessThanOrEqual(DESIGN_WIDTH);
  });

  it('keeps the footer band inside the canvas', () => {
    // The hint is TOWER_HINT_FONT type with 6px of padding. The band used to
    // open 22px above the bottom, so the last 11px of every level's hint fell
    // off the canvas.
    //
    // AG-23: the row height is GameSans's, not estimateLineHeight's. The old
    // pixel face drew a ~1.0em box and this guard passed on a 1.1em estimate;
    // Noto Sans SC draws a 32px box at 26px (39 with padding), and 36 put the
    // hint's bottom at 722 — 2px off the canvas, measured at all three
    // viewports. fontLineBox() is the measured factor; the band must clear the
    // real row, not the estimate.
    const rowH = fontLineBox(TOWER_HINT_FONT) + 6;
    expect(TOWER_FOOT_TOP).toBeGreaterThanOrEqual(rowH);
    expect(DESIGN_HEIGHT - TOWER_FOOT_TOP + rowH).toBeLessThanOrEqual(DESIGN_HEIGHT);
  });

  it('measures a Han legend label at one em — the old 0.5 factor put the swatches 150px off', () => {
    // refreshLegend lays its swatches out with estimateTextWidth; the replaced
    // expression (label.length * TYPE_AUX * 0.5) halved every Han glyph, so
    // "当前" was laid out 22px wide and drawn 44px.
    for (const label of ['当前', '已打通', '已探索', '未打通', '守段者层']) {
      expect(estimateTextWidth(label, TOWER_TAG_FONT), label).toBe(label.length * TOWER_TAG_FONT);
    }
  });
});

describe('boss floors follow the encounter table', () => {
  it('derives the boss floors through encounterSpots and they match the table', () => {
    // The overview marks the sectors whose floors can roll a guardian. The set
    // is read through encounterSpots' own API — the module that owns the marker
    // — so a table edit moves the map automatically. The second expression is
    // the table itself: the two must agree, or the map has drifted from the
    // game. {5, 110, 50010} today.
    const derived = PLAYABLE_FLOORS_V01.filter((floor) => encounterSpots(0, floor).some((spot) => spot.isBoss));
    const fromTable = PLAYABLE_FLOORS_V01.filter((floor) => ENCOUNTER_TABLE[floor].some((e) => e.kind === 'boss'));
    expect(derived).toEqual([5, 110, 50010]);
    expect(derived).toEqual(fromTable);
  });

  it('puts every boss floor in a sector the overview can mark', () => {
    // Floors 5 and 110 share sector 0 (one row, one spine); 50010 closes the
    // VIP tier in sector 50.
    expect(sectorOf(5)).toBe(0);
    expect(sectorOf(110)).toBe(0);
    expect(sectorOf(50010)).toBe(50);
  });
});

describe('tower detail card', () => {
  it('gives every row more room than its type needs', () => {
    // The rows used to sit on a 20px pitch under 26px type (27px measured), so
    // each row printed 7px through the next.
    expect(DETAIL_ROW_PITCH).toBeGreaterThan(estimateLineHeight(TOWER_BODY));
  });

  it('wraps the content row inside the card', () => {
    expect(DETAIL_ROW_X + DETAIL_CONTENT_W).toBeLessThanOrEqual(DETAIL_PANEL_W - 8);
    // The worst content list must actually need the wrap.
    expect(estimateTextWidth(WORST_CONTENT, TOWER_BODY)).toBeGreaterThan(DETAIL_CONTENT_W);
  });

  it('sizes the card around the worst content list without leaving the content band', () => {
    const lineH = estimateLineHeight(TOWER_BODY);
    const lines = wrapText(WORST_CONTENT, DETAIL_CONTENT_W, TOWER_BODY).length;
    expect(lines).toBeGreaterThan(1);
    const contentTop = DETAIL_ROWS_TOP + DETAIL_ROW_PITCH * (DETAIL_ROW_COUNT - 1);
    const actionTop = contentTop + lines * lineH + DETAIL_CONTENT_ACTION_GAP;
    const panelH = Math.max(DETAIL_PANEL_H, actionTop + lineH + DETAIL_FOOT_PAD);
    // The action line clears the content block — it used to land on the fifth
    // row (36x16px overlap measured).
    expect(actionTop).toBeGreaterThanOrEqual(contentTop + lines * lineH);
    // ...and the grown card stays inside the scrollable content band.
    expect(panelH).toBeLessThanOrEqual(DESIGN_HEIGHT - CONTENT_TOP - HUD_BOTTOM);
  });
});

describe('container name labels', () => {
  it('drops the name onto the prop face, clear of the structural band', () => {
    // The plate's centre, from the prop's base (FLOOR_HEIGHT - 68). The old
    // anchor (prop top - 8) put it at y 53..83, hugging the structural band at
    // 52..78 with its bottom edge 4px onto the prop.
    const plateH = 22 + 8; // CONTAINER_LABEL_FONT + 8
    const labelY = FLOOR_HEIGHT - 68 - CONTAINER_LABEL_DROP;
    expect(labelY - plateH / 2).toBeGreaterThan(78);
    expect(labelY + plateH / 2).toBeLessThan(FLOOR_HEIGHT - 68);
    // ...and it shares the stair labels' band (FLOOR_HEIGHT - 104).
    expect(labelY).toBe(FLOOR_HEIGHT - 104);
  });
});

describe('the fit guarantee is the canvas', () => {
  it('pins the design resolution the lanes are measured against', () => {
    // Scale.FIT letterboxes this canvas across window sizes without moving a
    // lane, so every bound asserted above holds at every viewport.
    expect(DESIGN_WIDTH).toBe(1280);
    expect(DESIGN_HEIGHT).toBe(720);
    expect(DIALOG_PANEL_W).toBeLessThanOrEqual(DESIGN_WIDTH);
    expect(DETAIL_PANEL_W).toBeLessThanOrEqual(DESIGN_WIDTH);
  });
});
