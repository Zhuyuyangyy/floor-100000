import { makeRng, deriveSeed } from '../core/rng';
import { isNight } from './SurvivalSystem';
import { PLAYABLE_FLOORS_V01, STARTING_FLOOR } from '../core/constants';
import type { ActiveEvent, GameState } from '../core/gameTypes';

// Seed-determined night events (docs/01_GDD.md §10, docs/03_TASKS.md#p0-07).
// The safe dorm (the starting floor) is never a wanderer/leak target, so returning home is
// always a valid escape and no event is an unavoidable-death or permanent-black.

// Floors a wanderer/leak can hit — everything except the dorm.
const EVENT_FLOORS = PLAYABLE_FLOORS_V01.filter((f) => f !== STARTING_FLOOR);

// Deterministic: the same worldSeed + day always yields the same event.
export function rollDayEvent(worldSeed: number, day: number): ActiveEvent {
  const rng = makeRng(deriveSeed(worldSeed, day, 'night-event'));
  const roll = rng.nextFloat();
  if (roll < 0.34) {
    return { type: 'blackout', message: '走廊停电了，摸黑很危险，靠手电或回宿舍。' };
  }
  if (roll < 0.67) {
    const floor = EVENT_FLOORS[Math.floor(rng.nextFloat() * EVENT_FLOORS.length)];
    return { type: 'wanderer', floor, message: `巡游体在 ${floor} 层出没，回宿舍或换层躲避。` };
  }
  const floor = EVENT_FLOORS[Math.floor(rng.nextFloat() * EVENT_FLOORS.length)];
  return { type: 'leak', floor, message: `${floor} 层漏水，部分物资受潮。` };
}

// Roll (at most once per day) the night's event if it is night and none is active.
// Returns the active event, or the newly-rolled one (caller can flash its message).
export function ensureNightEvent(state: GameState): { event: ActiveEvent | null; rolled: boolean } {
  if (!isNight(state.gameMinuteOfDay)) {
    return { event: state.worldEvents.activeEvent, rolled: false };
  }
  if (state.worldEvents.activeEvent) {
    return { event: state.worldEvents.activeEvent, rolled: false };
  }
  const event = rollDayEvent(state.runSeed, state.day);
  state.worldEvents.activeEvent = event;
  state.worldEvents.history.push(`day${state.day}:${event.type}`);
  return { event, rolled: true };
}
