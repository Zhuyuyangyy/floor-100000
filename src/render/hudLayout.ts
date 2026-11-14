import { formatClock } from '../systems/SurvivalSystem';

// Coordinates are design-canvas pixels. Scale.FIT scales this single layout
// across host window sizes; these lanes never move with the world camera.
// Geometry of the 2026-11-14 HUD skin (see render/hudSkin.ts). Three rows on one
// 132px plate: instruments, the day's objective, the environment readout.
export const HUD_LAYOUT = {
  topHeight: 64,
  contextBottom: 132,
  statX: 292,
  statPitch: 192,
  statWidth: 172,
  goalY: 76,
  environmentY: 104,
  feedbackY: 556,
  bagY: 624,
  // Row 1 anchors: icons sit 2px above their label's cap height.
  row1Y: 12,
  barY: 42,
  barH: 10,
  barSegments: 10,
  // Where the money group starts; the stat block has to end before this.
  moneyX: 1080,
  // Environment chips: icon x positions, text 24px to their right.
  envChipX: [20, 300, 620, 900],
  hazardX: 1080,
} as const;

export function hudClockLabel(day: number, minute: number): string {
  return `D${day} ${formatClock(minute)}`;
}
