import { formatClock } from '../systems/SurvivalSystem';
import { DESIGN_WIDTH } from '../core/design';

// Coordinates are design-canvas pixels. Scale.FIT scales this single layout
// across host window sizes; these lanes never move with the world camera.
// Geometry of the 2026-11-14 HUD skin (see render/hudSkin.ts). Three rows on one
// plate: instruments, the day's objective, the environment readout.
//
// AG-54: the instrument row's four segmented bars became four segmented rings
// (the user's "圆环的那种"). Same row, same pitch, same money lane:
// statX/statPitch/statWidth describe the four ring groups, ringCY/ringR/
// ringStroke the gauge itself, and the value lives in the ring's centre as a
// Text. barY/barH/barSegments are gone with the bars they described.
//
// The plate was 132 tall and the wall band starts at y=8 inside a 200px floor:
// at zoom 0.5 with the camera pinned to -64, 60 of the wall's 128 rows sat above
// the plate and 34 more sat behind it — 46.9% of every wall in the game was
// either clipped by the screen edge or painted over. The three rows are
// tightened to 102 here, and GameScene's bottom-floor camera bound moves to the
// plate's own bottom, so the art's first row lands exactly under the HUD.
export const HUD_LAYOUT = {
  topHeight: 50,
  contextBottom: 102,
  statX: 292,
  statPitch: 192,
  // AG-54: 172 -> 120. The bar groups were a 172px bar under the label; a ring
  // group is the 46px ring plus its icon and label, so 120 holds it with the
  // pitch untouched. hudLayout.test.ts pins the block's end against moneyX.
  statWidth: 120,
  // AG-23: goalY stays 52 — the objective row's box (52..77 at 20px GameSans)
  // already clears the environment row (80), and hudLayout.test.ts pins that
  // 28px lane gap. The clock/goal collision is fixed from the clock's side
  // instead (row1Y below).
  goalY: 52,
  environmentY: 80,
  feedbackY: 556,
  bagY: 624,
  // Row 1 anchors: icons sit 2px above their label's cap height.
  //
  // AG-23: 6 → 2. The clock opens at row1Y+28 and the goal at goalY=52: two
  // 20px GameSans rows are 25px of line box each, so at row1Y=6 the clock's
  // box (34..59) printed 7px through the goal's (52..77) — 28% of the smaller
  // box, measured (AG-24's font:209), the 1.0em-era anchors never did. Moving
  // row 1 up 4px puts the clock's box at 30..55: a 3px box overlap (12%, under
  // the 15% collision threshold) with 5px of ink clearance. The goal row could
  // not move instead — hudLayout.test.ts pins the 28px goal→environment lane
  // gap, and the environment row cannot move down without crossing the plate's
  // bottom edge (contextBottom 102, AG-20's compaction).
  row1Y: 2,
  // The ring gauge (AG-54): centred in row 1, a 12-pip segmented circle. R=23
  // with a 5px stroke leaves a 36px well for the value Text, and the ring's
  // 2..48 band clears both the plate's top hairline and the row separator at
  // topHeight. A running-out stat (<=20%) lights its pips in UI.danger
  // instead, exactly where the old bar went red.
  ringCY: 25,
  ringR: 23,
  ringStroke: 5,
  // The label's row, vertically centred on the ring for a 20px caption (a 25px
  // GameSans line box, so 25 - 12).
  statLabelY: 13,
  // Where the money group starts; the stat block has to end before this.
  //
  // AG-23: 1080 → 1056. The money texts open at moneyX+24 and grow rightwards
  // from there (origin 0,0), and the >240px font-shrink guard never saw the
  // 12-digit test fixture: "金币 123456789012" measured 178px wide at 20px
  // GameSans and put hud-gold's right edge at 1282 — 2px off the 1280 canvas,
  // measured at all three viewports (AG-24's hudLayout:39:3). 1056 keeps the
  // stat block (which ends at statX + 3*pitch + width = 1040) 16px clear and
  // pins the group's right edge at 1258, 22px inside the canvas.
  moneyX: 1056,
  // Environment chips: icon x positions, text 24px to their right.
  envChipX: [20, 300, 620, 900],
  hazardX: 1080,
  // AG-63: 饥饿/干渴 debuff 的常驻小标记（身上绿光的名字）。它塞在两条既有
  // lane 之间的一根 25px 线：上是「背包已满」预警（bagY=624，盒高 31，底
  // 655），下是脚注条（DESIGN_HEIGHT - HUD_FOOT_H = 680）。中线 668 让这条
  // caption 线的盒上下都刚好擦着不进——两条 lane 同时出现时盒距 0.5px，
  // 字墨相距 8px；与脚注条自己的提示行（y=700）盒距 7px。x 与 hud-hint
  // 同一条左边缘，读起来像脚注条上面的状态行，而不是又一块新板子。
  debuffMarkX: 8,
  debuffMarkY: 668,
} as const;

export function hudClockLabel(day: number, minute: number): string {
  return `D${day} ${formatClock(minute)}`;
}

// ── tower overview (TowerOverviewScene) ─────────────────────────────────────
// The map's fixed lanes, exported so uiLayout.test.ts can assert the fit
// arithmetically (estimateTextWidth) instead of by screenshot. Everything the
// scene draws at scrollFactor(0) is positioned from these.
//
// The strip used to run STRIP_X .. DESIGN_WIDTH - STRIP_X, leaving a symmetric
// 110px margin — and the 终点 tag is 169px wide at 22px, so it hung 69px off
// the canvas (measured: right edge 1349 on 1280). The strip gives up the width
// so the endpoint tags and their ticks fit inside the right margin.
export const TOWER_STRIP_X = 110;
/** Right margin reserved for the endpoint tags, the boss tags and their ticks. */
export const TOWER_ENDPOINT_MARGIN = 200;
export const TOWER_STRIP_W = DESIGN_WIDTH - TOWER_STRIP_X - TOWER_ENDPOINT_MARGIN;
/** Where an endpoint/boss tag's left edge sits, right of the strip. */
export const TOWER_TAG_X = TOWER_STRIP_X + TOWER_STRIP_W + 10;
/**
 * The bottom band's top edge, measured UP from the canvas bottom: every footer
 * text (control hint, legend, transient message) opens at
 * DESIGN_HEIGHT - TOWER_FOOT_TOP. This was 22, which put the 26px hint's
 * measured bounds at y 698..731 — 33px tall with 6px of padding, the last 11
 * pixels fell off the 720px canvas on all three levels (Playwright getBounds()).
 * 36 cleared the full 33px row with 3px to spare.
 *
 * 41 now: the Noto Sans SC swap (GameSans) re-measured the same row. A 26px
 * GameSans line box is 32px, not the old face's 27px, so the hint with its 6px
 * of padding is 38px tall and 36 put its bottom at 722 — 2px off the canvas
 * (Playwright getBounds at 900x600 / 1280x800 / 1920x1080, all three viewports,
 * the canvas letterboxes but the design lanes do not move). 41 restores the
 * 3px spare: the band opens at 679, the 38px row ends at 717. The detail
 * level's back arrow opens one row above the band and keeps its 10px
 * clearance (637..669 against 679).
 */
export const TOWER_FOOT_TOP = 41;

/** The footer hint's font size, so a layout test can predict its width. */
export const TOWER_HINT_FONT = 26;
/** Endpoint tag font size (起点/终点 and the BOSS tags share it). */
export const TOWER_TAG_FONT = 22;

// ── tower floor-detail card (TowerOverviewScene, floor level) ───────────────
// The card measured from its own top. Exported for the same reason as the lanes
// above: uiLayout.test.ts asserts the fit arithmetically.
//
// The rows used to sit on a 20px pitch under 26px type (27px measured), so
// every row printed 7px through the next, and the action line at panelH-20
// landed on the fifth row (Playwright getBounds: 36x16px overlap). The content
// row also ran unwrapped — a floor's container list reaches 1113px (measured
// across seeds 42/7/2026, worst floor 50008) against 434px of inner width. The
// card sizes itself around the content's wrapped line count, the same way the
// dialogue panel does.
export const DETAIL_PANEL_W = 460;
/** The base card (one content line); refreshDetail grows it for longer lists. */
export const DETAIL_PANEL_H = 178;
export const DETAIL_ROW_X = 26;
export const DETAIL_ROWS_TOP = 62;
// AG-23: 30 → 32 = fontLineBox(TOWER_BODY). The rows are 26px GameSans type,
// which is a 32px line box; at a 30px pitch every row's box printed 2px
// through the next (6% of the box — under the e2e's 15% collision threshold,
// and the ink never touched, which is why it shipped). 32 makes the boxes
// exactly touch, the same contract the dialogue rows have
// (DIALOG_ROW_PITCH = fontLineBox(TYPE.body)), and keeps the card's derived
// height formula honest: the rows are positioned with origin (0,0) from
// DETAIL_ROWS_TOP, so the pitch IS the row height.
export const DETAIL_ROW_PITCH = 32;
export const DETAIL_ROW_COUNT = 5;
/** The content row's wrap width: panel width minus the row inset and a right inset. */
export const DETAIL_CONTENT_W = DETAIL_PANEL_W - DETAIL_ROW_X - 16;
/** Content row bottom → action line. */
export const DETAIL_CONTENT_ACTION_GAP = 12;
/** Action line bottom → panel bottom edge. */
export const DETAIL_FOOT_PAD = 16;

// ── game floor: container name labels (GameScene.buildContainers) ───────────
// How far the container name drops from the prop's base (FLOOR_HEIGHT - 68).
//
// The old anchor was `propTop - 8`, which measured as a plate at y 53..83: it
// hugged the full-width structural band at 52..78 (so the name read as part of
// the wall, not part of the crate) and its bottom edge dipped ~4px onto the
// prop's own art. 36 puts the plate at y 81..111 — on the prop's face, clear of
// the band — and lands it on exactly the band the stair labels already use
// (FLOOR_HEIGHT - 104 = 96), so every nameplate on the floor shares one line.
export const CONTAINER_LABEL_DROP = 36;
