import { describe, expect, it } from 'vitest';
import { deriveSeed, makeRng } from '../core/rng';

describe('makeRng (xorshift32)', () => {
  it('is deterministic for the same seed', () => {
    const a = makeRng(12345);
    const b = makeRng(12345);
    const seqA = Array.from({ length: 8 }, () => a.next());
    const seqB = Array.from({ length: 8 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('differs for different seeds', () => {
    expect(makeRng(1).next()).not.toBe(makeRng(2).next());
  });

  it('produces uint32 ints and floats in [0,1)', () => {
    const r = makeRng(42);
    for (let i = 0; i < 200; i++) {
      const n = r.next();
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(0xffffffff);
      const f = r.nextFloat();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it('never gets stuck at zero (fixed-point guard)', () => {
    expect(makeRng(0).next()).not.toBe(0);
  });
});

describe('deriveSeed', () => {
  it('is deterministic and order-sensitive', () => {
    expect(deriveSeed(1, 2, 3)).toBe(deriveSeed(1, 2, 3));
    expect(deriveSeed(1, 2, 3)).not.toBe(deriveSeed(3, 2, 1));
  });

  it('handles string keys distinctly', () => {
    expect(deriveSeed(42, 3, 'crate_wood')).toBe(deriveSeed(42, 3, 'crate_wood'));
    expect(deriveSeed(42, 3, 'crate_wood')).not.toBe(deriveSeed(42, 3, 'crate_metal'));
  });
});
