import { formatClock } from '../systems/SurvivalSystem';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../core/design';

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
 * The bottom band's baseline: every footer text bottom-aligns its own measured
 * height above this, so a 33px hint and a 23px legend share one bottom edge
 * instead of hanging 11px and 1px past the canvas (measured: 731 and 721 on
 * 720).
 */
export const TOWER_FOOT_BASELINE = DESIGN_HEIGHT - 8;

/** The footer hint's font size, so a layout test can predict its width. */
export const TOWER_HINT_FONT = 26;
/** Endpoint tag font size (起点/终点 and the BOSS tags share it). */
export const TOWER_TAG_FONT = 22;
