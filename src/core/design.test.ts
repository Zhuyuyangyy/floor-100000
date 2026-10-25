import { describe, expect, it } from 'vitest';
import { DESIGN_HEIGHT, DESIGN_WIDTH, computeIntegerScale } from './design';

describe('design resolution', () => {
  it('is a 16:9 640x360 pixel target', () => {
    expect(DESIGN_WIDTH).toBe(640);
    expect(DESIGN_HEIGHT).toBe(360);
    expect(DESIGN_WIDTH / DESIGN_HEIGHT).toBeCloseTo(16 / 9, 5);
  });
});

describe('computeIntegerScale', () => {
  it('picks the largest integer scale that fits (success path)', () => {
    expect(computeIntegerScale(1920, 1080)).toEqual({ scale: 3, width: 1920, height: 1080 });
    expect(computeIntegerScale(1280, 800)).toEqual({ scale: 2, width: 1280, height: 720 });
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
