import { makeRng, deriveSeed } from '../core/rng';
import { GAME_CONFIG } from '../core/config';
import { STARTING_FLOOR } from '../core/constants';
import type { DwellState, GameState } from '../core/gameTypes';

// B3-15: dwell pressure. Staying on one floor too long makes something come
// looking.
//
// The idea is lifted from CENTUM's spawn timer (docs/RE_COMPETITIVE.md): its
// risk does not come from nightfall, it comes from standing still — every
// floor runs a turn counter, and when it expires the game rolls how many
// creatures wander in, scaled by how deep you are. Our own measurements said
// the same thing about us from the other direction: M1_PLAYTEST.md found an
// 8-hour idle window in a day, and B3-06_NIGHT_DANGER.md found the night
// threat only ever kills someone who stands still, with zero night rewards to
// justify going out. Both problems are "lingering costs nothing".
//
// So: every rollIntervalGameMinutes on one floor, roll the table below. Early
// rolls are atmosphere (the tower creaks and you get nervous); later rolls
// send the wanderer onto the floor you are standing on, day or night. Leaving
// the floor resets everything, which is the point — the pressure exists to
// make "loot and move on" the default, not to kill anyone. The dorm
// (STARTING_FLOOR) is exempt: going home must always be a valid escape.

// One row per roll count (index 0 = the first roll). Probabilities sum to 1.
// The prowler column climbs and never falls — the longer you stay, the more
// likely the next roll is teeth.
const TABLE: ReadonlyArray<{ atmosphere: number; prowler: number }> = [
  { atmosphere: 0.75, prowler: 0.0 },
  { atmosphere: 0.5, prowler: 0.25 },
  { atmosphere: 0.35, prowler: 0.45 },
  { atmosphere: 0.25, prowler: 0.6 },
];
const LAST_ROW = TABLE.length - 1;

const INTERVAL = GAME_CONFIG.dwellPressure.rollIntervalGameMinutes;

// Flavour lines for the atmospheric rolls. They carry no mechanics; they exist
// so an early roll still means something on screen.
const ATMOSPHERE: readonly string[] = [
  '楼板某处轻轻响了一声，又安静下来。',
  '远处像有人在走动，仔细听又什么都没有。',
  '风从楼梯井灌上来，灯影晃了一圈。',
  '这一层静得能听见自己的心跳。',
  '隔壁房间传来东西倒地的声响。',
];

export type DwellOutcome =
  | { kind: 'nothing' }
  | { kind: 'atmosphere'; message: string }
  | { kind: 'prowler'; message: string };

export function freshDwell(floor: number): DwellState {
  return { floor, minutes: 0, nextRollAt: INTERVAL, rolls: 0 };
}

// Creates the dwell tracker if a pre-B3-15 save lacks one.
export function ensureDwell(state: GameState): DwellState {
  const we = state.worldEvents;
  if (!we.dwell) we.dwell = freshDwell(state.currentFloor);
  return we.dwell;
}

// Accumulates dwell time. A floor change resets the counter entirely — moving
// on is the escape, so it must actually work. Mutates in place (callers hold a
// reference through state.worldEvents.dwell) and counts the minutes just ticked
// against the new floor: the player spent them arriving on it.
export function tickDwell(dwell: DwellState, floor: number, minutes: number): DwellState {
  if (dwell.floor !== floor) {
    dwell.floor = floor;
    dwell.minutes = Math.max(0, minutes);
    dwell.nextRollAt = INTERVAL;
    dwell.rolls = 0;
    return dwell;
  }
  dwell.minutes += Math.max(0, minutes);
  return dwell;
}

// True when the tracker has earned another roll. Callers own the side effects;
// this only reads.
export function dwellRollDue(dwell: DwellState): boolean {
  return dwell.minutes >= dwell.nextRollAt;
}

// Arms the next roll. Called by whoever resolves a roll so the interval is
// measured from the roll, not from arrival.
export function armNextRoll(dwell: DwellState): void {
  dwell.rolls += 1;
  dwell.nextRollAt = dwell.minutes + INTERVAL;
}

// The dorm is always safe: returning home is the designed escape from every
// event, and a pressure system that follows you to bed would break that.
export function isDwellExempt(floor: number): boolean {
  return floor === STARTING_FLOOR;
}

// Rolls what the lingering has earned. Deterministic for a given
// (runSeed, day, floor, roll index), so the same seed replays the same run —
// the project's no-Math.random rule.
export function rollDwellEvent(state: GameState, dwell: DwellState, floor: number): DwellOutcome {
  const row = TABLE[Math.min(dwell.rolls, LAST_ROW)];
  const rng = makeRng(deriveSeed(state.runSeed, state.day, floor, dwell.rolls, 'dwell'));
  const roll = rng.nextFloat();
  if (roll < row.prowler) {
    return { kind: 'prowler', message: `你在 ${floor} 层待得太久了，有东西被动静引了过来。` };
  }
  if (roll < row.prowler + row.atmosphere) {
    const line = ATMOSPHERE[Math.floor(rng.nextFloat() * ATMOSPHERE.length)];
    return { kind: 'atmosphere', message: line };
  }
  return { kind: 'nothing' };
}
