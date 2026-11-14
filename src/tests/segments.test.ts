import { describe, expect, it } from 'vitest';
import { PASS_UPGRADE_IDS } from '../data/recipes';
import { hasFloorContent } from '../data/floorTemplates';
import {
  PLAYABLE_SEGMENTS,
  liftOutcome,
  liftRequirement,
  nextSegment,
  segmentOf,
  skippedFloors,
} from '../core/segments';

// docs/18_TIER_PROGRESSION.md §2: six tiers, six playable segments, and the
// unexplored floors between them exist only as a number the lift skips.
describe('playable segments', () => {
  it('has six segments in tower order', () => {
    expect(PLAYABLE_SEGMENTS.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('is ordered, non-overlapping and leaves the gaps unexplored', () => {
    for (let i = 0; i < PLAYABLE_SEGMENTS.length; i++) {
      const s = PLAYABLE_SEGMENTS[i];
      expect(s.from).toBeLessThanOrEqual(s.to);
      if (i === 0) continue;
      const prev = PLAYABLE_SEGMENTS[i - 1];
      // Strictly above the previous segment's end, with at least one floor
      // skipped: if a segment started at prev.to + 1 the "between" would not
      // exist and the lift would be a second staircase.
      expect(s.from).toBeGreaterThan(prev.to + 1);
    }
  });

  it('names the floors the design document names', () => {
    expect(PLAYABLE_SEGMENTS.map((s) => [s.from, s.to])).toEqual([
      [1, 10],
      [100, 110],
      [1000, 1010],
      [10000, 10010],
      [50000, 50010],
      [100000, 100000],
    ]);
  });

  it('gates every segment except the first with a pass in the chain', () => {
    expect(PLAYABLE_SEGMENTS[0].requiresPass).toBeNull();
    for (const s of PLAYABLE_SEGMENTS.slice(1)) {
      expect(s.requiresPass).not.toBeNull();
      expect(PASS_UPGRADE_IDS).toContain(s.requiresPass);
    }
  });
});

describe('segmentOf', () => {
  it('finds the segment a playable floor belongs to', () => {
    expect(segmentOf(1)?.id).toBe(1);
    expect(segmentOf(10)?.id).toBe(1);
    expect(segmentOf(100)?.id).toBe(2);
    expect(segmentOf(105)?.id).toBe(2);
    expect(segmentOf(1000)?.id).toBe(3);
    expect(segmentOf(10010)?.id).toBe(4);
    expect(segmentOf(50000)?.id).toBe(5);
    expect(segmentOf(100000)?.id).toBe(6);
  });

  it('returns undefined for the unexplored floors between segments', () => {
    expect(segmentOf(0)).toBeUndefined();
    expect(segmentOf(11)).toBeUndefined();
    expect(segmentOf(50)).toBeUndefined();
    expect(segmentOf(999)).toBeUndefined();
    expect(segmentOf(9999)).toBeUndefined();
    expect(segmentOf(100001)).toBeUndefined();
  });
});

describe('nextSegment', () => {
  it('walks the chain from each segment top', () => {
    expect(nextSegment(10)?.from).toBe(100);
    expect(nextSegment(110)?.from).toBe(1000);
    expect(nextSegment(1010)?.from).toBe(10000);
    expect(nextSegment(10010)?.from).toBe(50000);
    expect(nextSegment(50010)?.from).toBe(100000);
  });

  it('has nothing above the summit', () => {
    expect(nextSegment(100000)).toBeUndefined();
  });

  it('still points at the next segment from inside a segment', () => {
    // The stairs are the only route inside a segment, but the answer must not
    // pretend the segment below is the next one.
    expect(nextSegment(5)?.from).toBe(100);
    expect(nextSegment(105)?.from).toBe(1000);
  });
});

describe('skippedFloors', () => {
  it('counts the floors the lift does not stop on', () => {
    // 11..99 is 89 floors.
    expect(skippedFloors(10)).toBe(89);
    expect(skippedFloors(110)).toBe(1000 - 110 - 1);
    expect(skippedFloors(1010)).toBe(10000 - 1010 - 1);
  });

  it('is zero where there is no next segment', () => {
    expect(skippedFloors(100000)).toBe(0);
  });
});

describe('liftRequirement', () => {
  it('names the pass for crossing from a segment top', () => {
    expect(liftRequirement(10)).toBe('work_badge');
    expect(liftRequirement(110)).toBe('pass_sticker');
    expect(liftRequirement(1010)).toBe('permit');
    expect(liftRequirement(10010)).toBe('vip_card');
    expect(liftRequirement(50010)).toBe('core_key');
  });

  it('is null inside a segment, where the stairs are the only route', () => {
    expect(liftRequirement(1)).toBeNull();
    expect(liftRequirement(5)).toBeNull();
    expect(liftRequirement(105)).toBeNull();
  });

  it('is null where there is no lift at all', () => {
    expect(liftRequirement(11)).toBeNull(); // unexplored between segments
    expect(liftRequirement(100000)).toBeNull(); // the summit has nothing above
  });
});

// The four outcomes the scene turns into copy. Kept out of GameScene on purpose:
// the ordering below is the safety rule — a segment that has no floors must be
// refused even when the pass is in hand, because generateFloor throws for a
// floor without a template.
describe('liftOutcome', () => {
  const noPass = { player: { homeUpgrades: [] as string[] } };
  const badge = { player: { homeUpgrades: ['work_badge'] } };
  const everything = { player: { homeUpgrades: [...PASS_UPGRADE_IDS] as string[] } };

  it('reports no lift away from a segment top', () => {
    expect(liftOutcome(badge, 5, () => true)).toBe('no-lift');
    expect(liftOutcome(everything, 100000, () => true)).toBe('no-lift');
  });

  it('asks for the pass the next segment requires', () => {
    expect(liftOutcome(noPass, 10, () => true)).toBe('need-pass');
    // The pass for the segment above is enough; a later one is not a substitute.
    expect(liftOutcome({ player: { homeUpgrades: ['vip_card'] } }, 10, () => true)).toBe('need-pass');
  });

  it('refuses a pass-holder when the target segment has no floors yet', () => {
    // The real world right now: floor 100 is declared but unauthored.
    expect(hasFloorContent(100)).toBe(false);
    expect(liftOutcome(badge, 10, hasFloorContent)).toBe('not-connected');
  });

  it('only rides when the pass is held and the floor can be built', () => {
    expect(liftOutcome(badge, 10, () => true)).toBe('ok');
    expect(liftOutcome(everything, 10010, () => true)).toBe('ok');
  });

  it('matches the authored floors, so floors 1-10 cannot be refused', () => {
    for (let f = 1; f <= 10; f++) expect(hasFloorContent(f)).toBe(true);
    expect(hasFloorContent(11)).toBe(false);
    // 100000 still resolves through DEV_FLOOR_ALIAS to floor 1's table, so the
    // summit reads as "connected" — unreachable today, and the alias is the
    // dev-only route that keeps the old fixtures bootable.
    expect(hasFloorContent(100000)).toBe(true);
  });
});
