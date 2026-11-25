import { describe, expect, it } from 'vitest';
import { HUD_LAYOUT, hudClockLabel } from '../render/hudLayout';

describe('HUD presentation boundaries', () => {
  it('keeps minute display on the existing floor rule at minute boundaries', () => {
    expect(hudClockLabel(1, 360.99)).toBe('D1 06:00');
    expect(hudClockLabel(1, 361)).toBe('D1 06:01');
    expect(hudClockLabel(12, 1439.99)).toBe('D12 23:59');
  });

  it('reserves separate lanes for persistent context and transient messages', () => {
    expect(HUD_LAYOUT.environmentY - HUD_LAYOUT.goalY).toBeGreaterThanOrEqual(28);
    expect(HUD_LAYOUT.contextBottom).toBeLessThan(HUD_LAYOUT.feedbackY);
    expect(HUD_LAYOUT.feedbackY + 64).toBeLessThanOrEqual(HUD_LAYOUT.bagY);
    expect(HUD_LAYOUT.bagY + 52).toBeLessThan(680);
    expect(HUD_LAYOUT.statX + 3 * HUD_LAYOUT.statPitch + HUD_LAYOUT.statWidth).toBeLessThan(1000);
  });
});
