import { describe, expect, it } from 'vitest';
import {
  SECTOR_COUNT,
  SECTOR_SIZE,
  TIERS,
  TOTAL_FLOORS,
  canEnter,
  describeFloor,
  describeSector,
  sectorOf,
  sectorRange,
  tierOf,
} from '../core/tower';

// TowerModel is the compact aggregate view of all 100000 floors. It must never
// need one object per floor, and every answer must be a pure function of the
// floor number (plus the seed where variation is intended).

describe('tier boundaries', () => {
  it('covers floors 1..100000 with no gaps or overlaps', () => {
    expect(TIERS[0].minFloor).toBe(1);
    expect(TIERS[TIERS.length - 1].maxFloor).toBe(TOTAL_FLOORS);
    for (let i = 1; i < TIERS.length; i++) {
      expect(TIERS[i].minFloor).toBe(TIERS[i - 1].maxFloor + 1);
    }
  });

  it('is monotonically richer and more tightly controlled going up', () => {
    for (let i = 1; i < TIERS.length; i++) {
      expect(TIERS[i].resourceLevel).toBeGreaterThanOrEqual(TIERS[i - 1].resourceLevel);
      expect(TIERS[i].security).toBeGreaterThan(TIERS[i - 1].security);
    }
  });

  it('maps the boundary floors to the documented tiers', () => {
    expect(tierOf(1).id).toBe(1);
    expect(tierOf(99).id).toBe(1);
    expect(tierOf(100).id).toBe(2);
    expect(tierOf(999).id).toBe(2);
    expect(tierOf(1000).id).toBe(3);
    expect(tierOf(9999).id).toBe(3);
    expect(tierOf(10000).id).toBe(4);
    expect(tierOf(49999).id).toBe(4);
    expect(tierOf(50000).id).toBe(5);
    expect(tierOf(89999).id).toBe(5);
    expect(tierOf(90000).id).toBe(6);
    expect(tierOf(100000).id).toBe(6);
  });

  it('rejects floors outside the tower', () => {
    expect(() => tierOf(0)).toThrow();
    expect(() => tierOf(100001)).toThrow();
  });
});

describe('sector partitioning', () => {
  it('splits the tower into 100 sectors of 1000 floors', () => {
    expect(SECTOR_COUNT).toBe(100);
    expect(SECTOR_SIZE).toBe(1000);
    expect(SECTOR_COUNT * SECTOR_SIZE).toBe(TOTAL_FLOORS);
  });

  it('puts floor 1 in sector 0 and floor 100000 in sector 99', () => {
    expect(sectorOf(1)).toBe(0);
    expect(sectorOf(1000)).toBe(0);
    expect(sectorOf(1001)).toBe(1);
    expect(sectorOf(100000)).toBe(99);
  });

  it('gives every sector a contiguous, non-overlapping range', () => {
    for (let s = 0; s < SECTOR_COUNT; s++) {
      const { from, to } = sectorRange(s);
      expect(to - from + 1).toBe(SECTOR_SIZE);
      expect(from).toBe(s * SECTOR_SIZE + 1);
      if (s > 0) expect(from).toBe(sectorRange(s - 1).to + 1);
    }
  });

  it('rejects out-of-range sectors', () => {
    expect(() => sectorRange(-1)).toThrow();
    expect(() => sectorRange(100)).toThrow();
  });
});

describe('floor records', () => {
  it('are deterministic for a given seed', () => {
    expect(describeFloor(1234)).toEqual(describeFloor(1234));
  });

  it('can differ between seeds but never in tier or zone type', () => {
    const a = describeFloor(1234);
    const b = describeFloor(1234);
    expect(a.tier).toBe(b.tier);
    expect(a.zoneType).toBe(b.zoneType);
    expect(a.security).toBe(b.security);
  });

  it('carries every field the social model needs, even when unused for now', () => {
    const f = describeFloor(1);
    expect(f).toMatchObject({
      floor: 1,
      tier: 1,
      zoneType: expect.any(String),
      resourceLevel: expect.any(Number),
      dangerLevel: expect.any(Number),
      security: expect.any(Number),
      faction: expect.any(String),
      access: expect.any(Number),
      explored: false,
    });
  });

  it('summarises a sector without enumerating all 1000 floors', () => {
    const s = describeSector(0);
    expect(s.sector).toBe(0);
    expect(s.from).toBe(1);
    expect(s.to).toBe(1000);
    expect(s.tiers.length).toBeGreaterThan(0);
    expect(s.tiers.reduce((n, t) => n + t.count, 0)).toBe(SECTOR_SIZE);
  });

  it('rejects an unknown floor', () => {
    expect(() => describeFloor(0)).toThrow();
  });
});

// The rule that makes the overview a planning tool rather than a teleporter.
describe('entry permission', () => {
  const base = { highestUnlocked: 5, currentFloor: 3 };

  it('allows floors inside the unlocked range', () => {
    expect(canEnter(1, base)).toBe(true);
    expect(canEnter(5, base)).toBe(true);
  });

  it('refuses floors above the unlocked range', () => {
    expect(canEnter(6, base)).toBe(false);
    expect(canEnter(100000, base)).toBe(false);
  });

  it('never refuses the floor the player is already on', () => {
    expect(canEnter(base.currentFloor, { ...base, highestUnlocked: 1 })).toBe(true);
  });

  it('refuses floors below 1', () => {
    expect(canEnter(0, base)).toBe(false);
  });
});
