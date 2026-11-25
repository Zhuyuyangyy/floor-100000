// Deterministic, seedable PRNG (xorshift32). All world generation and event
// rolls must go through this — never Math.random (docs/02_TECH_SPEC.md §3).

export interface Rng {
  next(): number;
  nextFloat(): number;
  nextInt(minInclusive: number, maxInclusive: number): number;
  chance(probability: number): boolean;
}

// FNV-1a style 32-bit string hash, used to fold string keys into a seed.
export function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h = (h ^ value.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Combine ordered parts into a single deterministic 32-bit seed.
export function deriveSeed(...parts: Array<string | number>): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const n = typeof part === 'number' ? part >>> 0 : hashString(part);
    h = (h ^ n) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // xorshift32 has an all-zero fixed point; fold in a non-zero constant.
  return (h >>> 0) || 0x9e3779b9;
}

export function makeRng(seed: number): Rng {
  let s = (seed >>> 0) || 0x9e3779b9;
  const next = (): number => {
    s = (s ^ (s << 13)) >>> 0;
    s = (s ^ (s >>> 17)) >>> 0;
    s = (s ^ (s << 5)) >>> 0;
    return s;
  };
  const nextFloat = (): number => next() / 0x1_0000_0000;
  return {
    next,
    nextFloat,
    nextInt: (min, max) => min + Math.floor(nextFloat() * (max - min + 1)),
    chance: (probability) => nextFloat() < probability,
  };
}
