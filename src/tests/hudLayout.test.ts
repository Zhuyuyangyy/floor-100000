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
    // The stat block ends before the money group begins, not before an
    // arbitrary 1000px: the 2026-11-14 skin widened the stats to 172px.
    expect(HUD_LAYOUT.statX + 3 * HUD_LAYOUT.statPitch + HUD_LAYOUT.statWidth).toBeLessThan(HUD_LAYOUT.moneyX);
  });

  it('常驻操作提示条落在顶带板下沿与反馈行之间的天花板带', () => {
    const c = HUD_LAYOUT.controlHintY;
    // 紧接顶带板（contextBottom=102）下方，不压顶带自己。
    expect(c).toBeGreaterThan(HUD_LAYOUT.contextBottom);
    expect(c - HUD_LAYOUT.contextBottom).toBeLessThanOrEqual(12);
    // 与 FPS 同行（fpsY=108，右端、默认隐藏）但提示靠左——垂直同带无妨，
    // 关键是与反馈行（556）隔开整段世界画面，不挡角色（脚线屏幕 y≈360）。
    expect(c).toBeLessThan(HUD_LAYOUT.feedbackY - 200);
  });
});
