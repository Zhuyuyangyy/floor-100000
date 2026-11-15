import { describe, expect, it } from 'vitest';
import { PASS_UPGRADE_IDS } from '../data/recipes';
import { hasFloorContent } from '../data/floorTemplates';
import {
  PLAYABLE_SEGMENTS,
  liftDirection,
  liftOutcome,
  liftRequirement,
  nextSegment,
  prevSegment,
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

  it('rides the last lift once the summit is authored', () => {
    // 1000-1010、10000-10010 和 50000-50010 创作后，110/1010/10010 的电梯
    // 都通了；终局创作（AG-16）后 50010 也通了——持 core_key 从富人区直抵
    // 统治核心，这是全塔最后一段货梯。
    expect(hasFloorContent(1000)).toBe(true);
    expect(hasFloorContent(10000)).toBe(true);
    expect(hasFloorContent(50000)).toBe(true);
    expect(hasFloorContent(100000)).toBe(true);
    const sticker = { player: { homeUpgrades: ['pass_sticker'] as string[] } };
    const permit = { player: { homeUpgrades: ['permit'] as string[] } };
    const vip = { player: { homeUpgrades: ['vip_card'] as string[] } };
    const everything = { player: { homeUpgrades: [...PASS_UPGRADE_IDS] as string[] } };
    expect(liftOutcome(sticker, 110, hasFloorContent)).toBe('ok');
    expect(liftOutcome(permit, 1010, hasFloorContent)).toBe('ok');
    expect(liftOutcome(vip, 10010, hasFloorContent)).toBe('ok');
    expect(liftOutcome(everything, 50010, hasFloorContent)).toBe('ok');
    // 终点存在不等于门开着：没有 core_key 照样被拦在 50010。
    expect(liftOutcome(vip, 50010, hasFloorContent)).toBe('need-pass');
    // 停运拒绝没有随终局创作消失——目标层没有内容时，凭证在手也走不了。
    expect(liftOutcome(everything, 50010, () => false)).toBe('not-connected');
  });

  it('only rides when the pass is held and the floor can be built', () => {
    expect(liftOutcome(badge, 10, () => true)).toBe('ok');
    expect(liftOutcome(everything, 10010, () => true)).toBe('ok');
    expect(liftOutcome(everything, 50010, () => true)).toBe('ok');
    // The real world: 100 is authored and the badge is in hand, so the first
    // lift ride of the game actually completes.
    expect(liftOutcome(badge, 10, hasFloorContent)).toBe('ok');
  });

  it('matches the authored floors: all six authored segments and neither gap', () => {
    for (let f = 1; f <= 10; f++) expect(hasFloorContent(f)).toBe(true);
    for (let f = 100; f <= 110; f++) expect(hasFloorContent(f)).toBe(true);
    for (let f = 1000; f <= 1010; f++) expect(hasFloorContent(f)).toBe(true);
    for (let f = 10000; f <= 10010; f++) expect(hasFloorContent(f)).toBe(true);
    for (let f = 50000; f <= 50010; f++) expect(hasFloorContent(f)).toBe(true);
    expect(hasFloorContent(11)).toBe(false);
    expect(hasFloorContent(50)).toBe(false);
    expect(hasFloorContent(99)).toBe(false);
    expect(hasFloorContent(111)).toBe(false);
    expect(hasFloorContent(999)).toBe(false);
    expect(hasFloorContent(1011)).toBe(false);
    expect(hasFloorContent(9999)).toBe(false);
    expect(hasFloorContent(10011)).toBe(false);
    expect(hasFloorContent(49999)).toBe(false);
    expect(hasFloorContent(50011)).toBe(false);
    expect(hasFloorContent(99999)).toBe(false);
    // 100000 曾经只是 dev 别名指向的第 1 层表格，hasFloorContent 必须对它说假
    // ——电梯在移动任何人之前问这句话，一个 true 会把玩家放到宿舍布局上而
    // HUD 写着 100000。终局创作（AG-16）后别名删除、真模板就位，这里说真：
    // 全塔六段都有内容，最后一段货梯从 50010 接通。
    expect(hasFloorContent(100000)).toBe(true);
  });
});

describe('lift direction', () => {
  it('is up on a segment top, down on a segment bottom, and null in between', () => {
    expect(liftDirection(10)).toBe('up');
    expect(liftDirection(100)).toBe('down');
    expect(liftDirection(5)).toBeNull();
    expect(liftDirection(105)).toBeNull();
    // The dorm has nothing below it, so its bottom floor has no down lift.
    expect(liftDirection(1)).toBeNull();
  });

  it('offers a way back down from every segment except the first', () => {
    // The bed and the workbench live on floor 1. A one-way lift would strand the
    // player on 100 with no way to sleep or craft the next pass.
    expect(prevSegment(100)?.to).toBe(10);
    expect(prevSegment(1000)?.to).toBe(110);
    expect(prevSegment(10000)?.to).toBe(1010);
    expect(liftDirection(1000)).toBe('down'); // bottom of segment 3
    expect(liftDirection(1010)).toBe('up');
    expect(liftDirection(10000)).toBe('down'); // bottom of segment 4
    expect(liftDirection(10010)).toBe('up');
    expect(prevSegment(1)).toBeUndefined();
  });
});
