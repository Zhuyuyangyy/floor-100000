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
//
// W2 (docs/OVERHAUL_M1.md): the table also rolls 'scout' from row 3 on — a
// shadow glances at you, spawns nothing, but arms the NEXT roll's prowler
// chance (+0.1, capped 0.85). It is the telegraph for "那东西盯上我的时候我
// 知道": a warning beat between atmosphere and teeth, so a prowler that
// arrives after a scout feels earned instead of random.

// One row per roll count (index 0 = the first roll). Probabilities sum to 1:
// atmosphere + prowler + scout + nothing = 1 — 'nothing' is the implicit
// remainder (1 − the three listed columns) and is deliberately not stored.
// The prowler column climbs and never falls — the longer you stay, the more
// likely the next roll is teeth.
//
// W2: rows 0–2 keep their original B3-15 weights (scout = 0). Row 3 takes
// 0.15 out of atmosphere (0.25 → 0.10) and gives it to scout; prowler (0.60)
// and the nothing remainder (0.15) are unchanged, so every row still sums to
// 1 exactly. Check: 0.10 + 0.60 + 0.15 + 0.15 = 1.
const TABLE: ReadonlyArray<{ atmosphere: number; prowler: number; scout: number }> = [
  { atmosphere: 0.75, prowler: 0.0, scout: 0 },
  { atmosphere: 0.5, prowler: 0.25, scout: 0 },
  { atmosphere: 0.35, prowler: 0.45, scout: 0 },
  { atmosphere: 0.10, prowler: 0.6, scout: 0.15 },
];
const LAST_ROW = TABLE.length - 1;

// W2: a scout hit adds this much to the NEXT roll's prowler chance, capped at
// SCOUT_PROWLER_CAP. The cap keeps a late-floor chain of scouts from turning
// every remaining roll into a guaranteed wanderer — pressure should climb,
// not become certain.
const SCOUT_PROWLER_BONUS = 0.1;
const SCOUT_PROWLER_CAP = 0.85;

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

// W2: flavour lines for the scout rolls. Like atmosphere they carry no direct
// mechanics, but unlike atmosphere they leave a mark: the next roll on this
// floor gets a prowler bonus, so the line must read as "you were seen".
const SCOUT_LINES: readonly string[] = [
  '远处有个影子看了你一眼，又消失了。',
  '楼道尽头似乎有东西在打量你，你一回头它就不见了。',
  '黑暗里有什么东西安静地注视着你，然后退开了。',
];

export type DwellOutcome =
  | { kind: 'nothing' }
  | { kind: 'atmosphere'; message: string }
  | { kind: 'scout'; message: string }
  | { kind: 'prowler'; message: string };

// W2: "the previous roll on this dwell was a scout". DwellState itself lives
// in src/core/gameTypes.ts and is owned by the Lead — this work order may not
// touch core — so the flag rides along in a local extension instead. Optional
// and undefined-by-default: saves written before W2 simply have no mark, which
// reads as "not scouted", exactly like a missing `dwell` block does.
export interface DwellStateExt extends DwellState {
  scoutedLast?: boolean;
}

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
    // W2: a floor change resets the pressure, so the scout mark goes too —
    // whatever glanced at you stays on the floor you left.
    const ext = dwell as DwellStateExt;
    if (ext.scoutedLast) ext.scoutedLast = false;
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
  // W2: the scout mark lives on the dwell object itself (DwellStateExt). A
  // module-level Map<floor, boolean> was the other option, but a field on the
  // state travels with the save, resets with tickDwell's floor change, and
  // cannot leak between tests or runs — the Map could do none of that.
  const ext = dwell as DwellStateExt;
  const scoutedLast = ext.scoutedLast === true;
  // The mark is consumed by this roll whether or not it pays out: one scout
  // buys exactly one boosted roll. Letting it persist until a prowler actually
  // spawned would make every later roll on the floor carry the bonus, and the
  // "leaving resets everything" escape would stop meaning anything.
  if (scoutedLast) ext.scoutedLast = false;
  const prowlerChance = scoutedLast
    ? Math.min(SCOUT_PROWLER_CAP, row.prowler + SCOUT_PROWLER_BONUS)
    : row.prowler;

  const rng = makeRng(deriveSeed(state.runSeed, state.day, floor, dwell.rolls, 'dwell'));
  const roll = rng.nextFloat();
  if (roll < prowlerChance) {
    return { kind: 'prowler', message: `你在 ${floor} 层待得太久了，有东西被动静引了过来。` };
  }
  if (roll < prowlerChance + row.scout) {
    // W2: mark the floor — the next roll's prowler chance gets the bonus.
    ext.scoutedLast = true;
    const line = SCOUT_LINES[Math.floor(rng.nextFloat() * SCOUT_LINES.length)];
    return { kind: 'scout', message: line };
  }
  if (roll < prowlerChance + row.scout + row.atmosphere) {
    const line = ATMOSPHERE[Math.floor(rng.nextFloat() * ATMOSPHERE.length)];
    return { kind: 'atmosphere', message: line };
  }
  return { kind: 'nothing' };
}
