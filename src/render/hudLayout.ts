import { formatClock } from '../systems/SurvivalSystem';
import { DESIGN_WIDTH } from '../core/design';

// Coordinates are design-canvas pixels. Scale.FIT scales this single layout
// across host window sizes; these lanes never move with the world camera.
export const HUD_LAYOUT = {
  topHeight: 64,
  contextBottom: 124,
  statX: 220,
  statPitch: 188,
  statWidth: 148,
  goalY: 68,
  environmentY: 96,
  feedbackY: 556,
  bagY: 624,
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
 * 36 clears the full 33px row with 3px to spare.
 */
export const TOWER_FOOT_TOP = 36;

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
export const DETAIL_ROW_PITCH = 30;
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
