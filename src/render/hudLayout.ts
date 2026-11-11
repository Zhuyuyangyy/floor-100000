import { formatClock } from '../systems/SurvivalSystem';

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
