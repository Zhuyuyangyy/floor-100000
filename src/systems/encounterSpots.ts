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
export function nudgeSpotX(x: number, taken: readonly number[], clearance: number): number {
  for (let i = 0; i < NUDGE_LIMIT; i++) {
    if (!taken.some((t) => Math.abs(t - x) <= clearance)) return x;
    x += NUDGE_STEP;
  }
  return x;
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
