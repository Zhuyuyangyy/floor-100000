import { describe, expect, it } from 'vitest';
import { DESIGN_HEIGHT, DESIGN_WIDTH, computeIntegerScale } from './design';

describe('design resolution', () => {
  it('is a 16:9 1280x720 pixel target', () => {
    expect(DESIGN_WIDTH).toBe(1280);
    expect(DESIGN_HEIGHT).toBe(720);
    expect(DESIGN_WIDTH / DESIGN_HEIGHT).toBeCloseTo(16 / 9, 5);
  });

  it('is the size that fits the cross-section at zoom 1', () => {
    // One floor is 1280 wide, so at zoom 1 the view is exactly one floor wide,
    // and 720 / 200 is 3.6 floors tall. That is the whole reason the resolution
    // is this and not 640x360: at 640x360 the same view needs a camera zoom of
    // 0.5, and a camera zoom resamples the world through the renderer's filter.
    const FLOOR_WIDTH = 1280;
    const FLOOR_HEIGHT = 200;
    expect(DESIGN_WIDTH).toBe(FLOOR_WIDTH);
    expect(DESIGN_HEIGHT / FLOOR_HEIGHT).toBeGreaterThan(3);
    expect(DESIGN_HEIGHT / FLOOR_HEIGHT).toBeLessThan(4);
  });
});

describe('computeIntegerScale', () => {
  it('picks the largest integer scale that fits (success path)', () => {
    expect(computeIntegerScale(3840, 2160)).toEqual({ scale: 3, width: 3840, height: 2160 });
    expect(computeIntegerScale(2560, 1440)).toEqual({ scale: 2, width: 2560, height: 1440 });
  });

  it('clamps to at least 1 and never exceeds maxScale (boundary)', () => {
    expect(computeIntegerScale(320, 180).scale).toBe(1);
    expect(computeIntegerScale(100000, 100000).scale).toBe(8);
    expect(computeIntegerScale(100000, 100000, 4).scale).toBe(4);
  });

  it('rejects non-positive viewports (failure path)', () => {
    expect(() => computeIntegerScale(0, 1080)).toThrow();
    expect(() => computeIntegerScale(800, -1)).toThrow();
  });
});
