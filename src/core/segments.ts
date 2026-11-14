import type { UpgradeId } from '../data/recipes';

// The tower's playable segments (docs/18_TIER_PROGRESSION.md §2).
//
// A hundred thousand floors cannot all be authored, so the tower is six tiers
// with one short playable stretch each. Inside a segment the stairs are the only
// way up; between segments there are no floors at all, only the freight lift and
// the number of floors it skips. Everything here is data plus pure functions —
// Phaser never enters this file, so the segment arithmetic is unit-testable.
export interface PlayableSegment {
  id: 1 | 2 | 3 | 4 | 5 | 6;
  name: string;
  from: number;
  to: number;
  /**
   * The credential needed to ENTER this segment. The first segment is free; every
   * later one is gated by the pass the previous segment lets you craft.
   */
  requiresPass: UpgradeId | null;
}

export const PLAYABLE_SEGMENTS: readonly PlayableSegment[] = [
  { id: 1, name: '底层贫民区', from: 1, to: 10, requiresPass: null },
  { id: 2, name: '工人宿舍区', from: 100, to: 110, requiresPass: 'work_badge' },
  { id: 3, name: '工业与交易区', from: 1000, to: 1010, requiresPass: 'pass_sticker' },
  { id: 4, name: '中产与商业区', from: 10000, to: 10010, requiresPass: 'permit' },
  { id: 5, name: '富人特权区', from: 50000, to: 50010, requiresPass: 'vip_card' },
  { id: 6, name: '统治核心', from: 100000, to: 100000, requiresPass: 'core_key' },
];

/** The segment a floor is playable in, or undefined for the unexplored between. */
export function segmentOf(floor: number): PlayableSegment | undefined {
  return PLAYABLE_SEGMENTS.find((s) => floor >= s.from && floor <= s.to);
}

/**
 * The first segment that starts above `from`.
 *
 * Deliberately not "the segment containing from + 1": from a floor in the middle
 * of a segment the next reachable segment is still the next one up, and from the
 * unexplored floors between segments it is the next one that actually exists.
 */
export function nextSegment(from: number): PlayableSegment | undefined {
  return PLAYABLE_SEGMENTS.find((s) => s.from > from);
}

/** The segment immediately below `from`, or undefined at the bottom of the tower. */
export function prevSegment(from: number): PlayableSegment | undefined {
  return [...PLAYABLE_SEGMENTS].reverse().find((s) => s.to < from);
}

export type LiftDirection = 'up' | 'down';

/**
 * Which way the freight lift at `floor` goes, or null where there is no lift.
 *
 * The up lift stands on a segment's top floor; the down lift stands on its bottom
 * floor. Both are needed: the bed and the workbench are on floor 1, so a player
 * who rode up to 100 with no down lift could not sleep and could not craft the
 * next pass — the lift would be a one-way door in a game about climbing.
 */
export function liftDirection(floor: number): LiftDirection | null {
  const here = segmentOf(floor);
  if (!here) return null;
  if (here.to === floor && nextSegment(floor) !== undefined) return 'up';
  if (here.from === floor && prevSegment(floor) !== undefined) return 'down';
  return null;
}

/**
 * The pass needed to ride the lift out of `from`, or null if there is no lift.
 *
 * A lift exists only at the top floor of a segment: inside the segment the stairs
 * are the only route, and the top segment has nothing above it. The pass is the
 * one the NEXT segment requires.
 */
export function liftRequirement(from: number): UpgradeId | null {
  const here = segmentOf(from);
  if (!here || here.to !== from) return null;
  return nextSegment(from)?.requiresPass ?? null;
}

/** How many unexplored floors the lift skips: 10 -> 89, because 11..99 is empty. */
export function skippedFloors(from: number): number {
  const next = nextSegment(from);
  if (!next) return 0;
  return Math.max(0, next.from - from - 1);
}

export type LiftOutcome = 'no-lift' | 'need-pass' | 'not-connected' | 'ok';

// Only the field liftOutcome reads, kept structural so a GameState (and a test
// fixture) both fit without segments.ts depending on the whole save shape.
export interface LiftTraveller {
  player: { homeUpgrades: readonly string[] };
}

/**
 * Which of the four things happens when the player presses E at the lift.
 *
 * The scene turns each outcome into its own line of copy; the decision itself
 * lives here so it can be tested without booting Phaser. The important property
 * is the ordering: a segment with no authored floors must be refused even when
 * the player holds the right pass — calling the floor generator for a floor that
 * has no template throws, and the lift is not allowed to crash the scene.
 */
export function liftOutcome(
  traveller: LiftTraveller,
  floor: number,
  hasContent: (floor: number) => boolean,
): LiftOutcome {
  const need = liftRequirement(floor);
  if (!need) return 'no-lift';
  if (!traveller.player.homeUpgrades.includes(need)) return 'need-pass';
  const target = nextSegment(floor);
  if (!target || !hasContent(target.from)) return 'not-connected';
  return 'ok';
}
