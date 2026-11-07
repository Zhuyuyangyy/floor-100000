// World flags: one place to answer "has this happened yet".
//
// Before this existed, "did X happen" lived in six different shapes - the
// encounter outcomes in `encounters`, the per-floor lists under `visitedFloors`,
// the upgrades in `player.homeUpgrades`, the day's objective in `dailyGoal`, the
// event history in `worldEvents.history`. Anything that needed to know about more
// than one of them had to import all of their systems, and a new one-off
// ("paid the reward", "met the trader", "saw the leak") had nowhere neutral to
// go.
//
// The clearest symptom was `dailyGoal.done`, which the comment in dailyGoals.ts
// admits carries two meanings at once - "the objective is complete" and "the
// reward has been paid out" - because the records contract had no room for a
// second field. That is what a flag is for.
//
// This War of Mine solves the same problem with a first-class FLAG entity kind
// (docs/reference/TWOM_MECHANICS.md §4): a flag is a named thing that is either
// set or not, and every system reads it the same way.
//
// The store is a flat Record<string, number> rather than Record<string, boolean>
// so a flag can carry a count without a second structure: 0 or absent means
// unset, and `once()` is then just "the first writer wins".

import type { GameState } from '../core/gameTypes';

// The key namespace. Prefixes rather than one flat soup, so a flag's owner is
// readable at the call site and two systems cannot collide by accident.
export const FLAG_PREFIX = {
  /** a one-off has fired: `once:goal-paid:3` */
  once: 'once',
  /** an encounter spot has been resolved: `enc:<spotId>` */
  encounter: 'enc',
  /** an upgrade has been built: `upg:lamp` */
  upgrade: 'upg',
  /** a container has been opened: `box:<containerId>` */
  container: 'box',
  /** a story beat has been seen: `story:<beatId>` */
  story: 'story',
} as const;

/** The flag store, created on demand so old saves load without it. */
function store(state: GameState): Record<string, number> {
  if (!state.flags) state.flags = {};
  return state.flags;
}

/** How many times this flag has been set. 0 means unset. */
export function flagCount(state: GameState, name: string): number {
  return state.flags?.[name] ?? 0;
}

export function hasFlag(state: GameState, name: string): boolean {
  return flagCount(state, name) > 0;
}

/** Sets the flag to an explicit count. */
export function setFlag(state: GameState, name: string, count = 1): void {
  store(state)[name] = count;
}

export function clearFlag(state: GameState, name: string): void {
  if (state.flags) delete state.flags[name];
}

/** Adds to the flag's count and returns the new total. */
export function bumpFlag(state: GameState, name: string, by = 1): number {
  const next = flagCount(state, name) + by;
  store(state)[name] = next;
  return next;
}

/**
 * The fire-exactly-once primitive: returns true the first time and false every
 * time after, for the same name. This is what `dailyGoal.done` was being used
 * for, and what any "pay the reward once" guard needs.
 */
export function once(state: GameState, name: string): boolean {
  if (hasFlag(state, name)) return false;
  setFlag(state, name);
  return true;
}

/** Convenience for the namespaced keys, so call sites read as sentences. */
export const flagKey = {
  once: (what: string): string => `${FLAG_PREFIX.once}:${what}`,
  encounter: (spotId: string): string => `${FLAG_PREFIX.encounter}:${spotId}`,
  upgrade: (id: string): string => `${FLAG_PREFIX.upgrade}:${id}`,
  container: (id: string): string => `${FLAG_PREFIX.container}:${id}`,
  story: (id: string): string => `${FLAG_PREFIX.story}:${id}`,
};
