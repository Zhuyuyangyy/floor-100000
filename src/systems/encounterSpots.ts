import { DOWN_EXIT_X, FLOOR_WIDTH, PLAYABLE_FLOORS_V01, STARTING_FLOOR, UP_EXIT_X } from '../core/constants';
import { hashString } from '../core/rng';

// OVERHAUL: where the "?" encounter spots sit on each floor (W1's rollEncounter
// decides what is behind them; this decides where they are). Deterministic per
// (seed, floor) so a floor always lays out the same way across a save/reload,
// and the dorm is exempt — home is the safe floor by design.

export interface EncounterSpot {
  id: string;
  x: number;
  isBoss: boolean;
}

// The top playable floor carries the first boss, parked past the up-exit so the
// player cannot leave without meeting it. That is ALTACIMA's every-10-floors
// boss, compressed to the M1 chapter's shape: floor 5 is the run's ending.
const TOP_FLOOR = Math.max(...PLAYABLE_FLOORS_V01);

// Spots must never land where E already reaches for something else — a marker
// inside a stairwell's, container's or NPC's interact radius hijacks the key
// and the player cannot open what they walked to. The exits are excluded here
// because they are the same on every floor; the per-floor clutter (containers,
// NPCs) is nudged around by the caller with nudgeSpotX().
const EXIT_MARGIN = 130;
// Two question marks closer than this read as one, and a player walking between
// them can trigger both in a step.
const SPOT_CLEARANCE = 130;
const NUDGE_STEP = 24;
const NUDGE_LIMIT = 8;

// Places one spot clear of everything in `taken`, resampling the hash rather
// than drifting, so the result stays deterministic for the seed.
function placeSpot(seed: number, floor: number, index: number, taken: readonly number[], clearance: number): number {
  const margin = 260;
  const span = Math.max(1, FLOOR_WIDTH - margin * 2);
  for (let attempt = 0; attempt < NUDGE_LIMIT; attempt++) {
    const h = hashString(`encounter-spot:${seed}:${floor}:${index}:${attempt}`);
    const x = margin + (h % span);
    if (!taken.some((t) => Math.abs(t - x) <= clearance)) return x;
  }
  return FLOOR_WIDTH / 2; // deterministic fallback; the caller still nudges
}

// Pushes a spot marker clear of everything already interactable on the floor.
// Deterministic: the same floor always nudges the same way, so a save/reload
// never moves a question mark the player has already walked to.
//
// It searches BOTH directions and returns the clearest position it found if
// nothing is fully clear. The one-directional version only ever stepped +24 and
// gave up after eight tries, so a marker that started next to an NPC could be
// pushed straight onto the NPC on its other side and still be returned as
// "nudged" - measured on floor 2: the trader landed 6px from an NPC.
export function nudgeSpotX(x: number, taken: readonly number[], clearance: number): number {
  const gapAt = (v: number): number => (taken.length === 0 ? Infinity : Math.min(...taken.map((t) => Math.abs(t - v))));
  if (gapAt(x) > clearance) return x;
  let bestX = x;
  let bestGap = gapAt(x);
  for (let i = 1; i <= NUDGE_LIMIT; i++) {
    for (const candidate of [x + NUDGE_STEP * i, x - NUDGE_STEP * i]) {
      if (candidate < 40 || candidate > FLOOR_WIDTH - 40) continue;
      const gap = gapAt(candidate);
      if (gap > clearance) return candidate;
      if (gap > bestGap) {
        bestGap = gap;
        bestX = candidate;
      }
    }
  }
  return bestX;
}

// Places a single thing (a trader, a stall) at a deterministic position clear of
// everything in `taken`. Resamples the hash instead of nudging, so the result is
// spread across the floor rather than clustered wherever the seed landed - and
// it falls back to the clearest sampled position, never to a colliding one.
export function placeClearX(
  seed: number,
  floor: number,
  salt: string,
  taken: readonly number[],
  clearance: number,
): number {
  const margin = 200;
  const span = Math.max(1, FLOOR_WIDTH - margin * 2);
  const gapAt = (v: number): number => (taken.length === 0 ? Infinity : Math.min(...taken.map((t) => Math.abs(t - v))));
  let bestX = margin;
  let bestGap = -1;
  for (let attempt = 0; attempt < 32; attempt++) {
    const h = hashString(`clear-x:${seed}:${floor}:${salt}:${attempt}`);
    const x = margin + (h % span);
    const gap = gapAt(x);
    if (gap > clearance) return x;
    if (gap > bestGap) {
      bestGap = gap;
      bestX = x;
    }
  }
  return bestX;
}

export function encounterSpots(seed: number, floor: number): EncounterSpot[] {
  if (floor === STARTING_FLOOR) return []; // the dorm has no question marks
  const spots: EncounterSpot[] = [];
  // The exits first, so every placed spot avoids them; on the top floor the
  // boss's fixed position joins the list so the rumours stay clear of it too.
  const taken: number[] = [UP_EXIT_X, DOWN_EXIT_X];
  if (floor === TOP_FLOOR) taken.push(UP_EXIT_X + 70);

  const count = floor >= TOP_FLOOR ? 1 : 2;
  for (let i = 0; i < count; i++) {
    const x = placeSpot(seed, floor, i, taken, SPOT_CLEARANCE);
    taken.push(x);
    spots.push({ id: `${floor}:spot${i}`, x, isBoss: false });
  }
  if (floor === TOP_FLOOR) {
    spots.push({ id: `${floor}:boss`, x: UP_EXIT_X + 70, isBoss: true });
  }
  return spots;
}

// The boss's spot id, so the up-exit can ask whether it has been beaten.
export function bossSpotId(floor: number): string {
  return `${floor}:boss`;
}

// Re-exported so tests can assert the exit margin without importing constants
// twice; the value is the module's own contract.
export { EXIT_MARGIN };
