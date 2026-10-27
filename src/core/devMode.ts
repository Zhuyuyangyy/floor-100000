import { DEV_TEST_FLOORS } from './constants';

// Dev-only test fixtures, kept out of a normal run by an explicit query flag.
//
// docs/GAME_DESIGN_LOCK.md freezes floor 1 as the spawn point and floor 100000
// as the summit. The v0.1 prototype happened to run on floor 100000, so that
// scene is kept around for regression testing behind ?devfloor= — but it is
// never a legitimate spawn point, and nothing in production reads these flags
// except the two fixtures they gate.

export interface DevEntry {
  // A retired dev-only starting floor, or null for a normal run.
  floor: number | null;
  // The retired day-8 auto-victory fixture.
  legacyWin: boolean;
}

export function parseDevEntry(search: string): DevEntry {
  const params = new URLSearchParams(search);
  const rawFloor = params.get('devfloor');
  const floor = rawFloor !== null && DEV_TEST_FLOORS.includes(Number(rawFloor)) ? Number(rawFloor) : null;
  // Number('') is 0 and Number('abc') is NaN, neither of which is in the list,
  // so a malformed value can never resolve to a dev floor.
  return { floor, legacyWin: params.get('devwin') === '1' };
}

let cached: DevEntry | null = null;

// Memoised because scenes read it during create() and a re-parse per call would
// be wasteful; the query string cannot change without a page load.
export function devEntry(): DevEntry {
  if (!cached) {
    cached = typeof window === 'undefined' ? { floor: null, legacyWin: false } : parseDevEntry(window.location.search);
  }
  return cached;
}
