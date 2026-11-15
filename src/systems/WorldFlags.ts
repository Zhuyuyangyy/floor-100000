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
  /** a world event has been seen this run: `ev:blackout` (see triggers.ts) */
  event: 'ev',
  /** a run-state milestone: `st:night-exposed` (see triggers.ts) */
  state: 'st',
  /** the day's objective has been satisfied: `goal:met` (see triggers.ts) */
  goal: 'goal',
  /** a combat milestone: `combat:active` (see triggers.ts) */
  combat: 'combat',
  /** a stat has hit its critical floor: `stat:thirst-critical` (see triggers.ts) */
  stat: 'stat',
  /** a tier's entry floor has been reached: `tier:2:arrived` (see triggers.ts) */
  tier: 'tier',
  /** an NPC relationship milestone: `npc:alin:regular` (see triggers.ts) */
  npc: 'npc',
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
  event: (type: string): string => `${FLAG_PREFIX.event}:${type}`,
  state: (what: string): string => `${FLAG_PREFIX.state}:${what}`,
  goal: (what: string): string => `${FLAG_PREFIX.goal}:${what}`,
  combat: (what: string): string => `${FLAG_PREFIX.combat}:${what}`,
  stat: (what: string): string => `${FLAG_PREFIX.stat}:${what}`,
  tier: (segmentId: number): string => `${FLAG_PREFIX.tier}:${segmentId}:arrived`,
  npc: (npcId: string, what: string): string => `${FLAG_PREFIX.npc}:${npcId}:${what}`,
};

// ── Trigger（接口契约 docs/plans/TWOM_ALIGNMENT.md §6）─────────────────────
//
// A flag answers "has this happened"; a trigger is the rule that sets one from
// a live condition. This War of Mine lists TRIGGER and FLAG as peer entity
// kinds (docs/reference/TWOM_MECHANICS.md §4) — the flag is the fact, the
// trigger is what produces it, and quests/dialogue/encounters then query the
// flag instead of each keeping its own boolean field.
//
// Two rules the design holds on purpose:
//   1. `when` must be deterministic — no Math.random. The same state must
//      always answer the same way, or a replayed run drifts from its save.
//   2. Evaluation only ever ADDS flags. A trigger records that a condition
//      has held at least once ("was caught out at night on a hostile floor"),
//      it is not a live query — for "is it true right now" read the state
//      directly. Latched milestones and live checks are different questions.
//
// The registry and the evaluation live here so the contract's surface stays
// in one file; the trigger LIST is systems/triggers.ts, which registers
// itself on import.

/** 触发器：条件满足时置旗。任务/对话/遭遇都按这个查询，不再各管各的布尔字段。 */
export interface Trigger {
  id: string;
  when: (s: GameState) => boolean;
  sets: string;
}

const TRIGGERS = new Map<string, Trigger>();

/**
 * Registers a trigger. Idempotent: re-registering the same id is a no-op and
 * the first registration wins, so a startup list and a test can both call it
 * without stacking duplicate entries.
 */
export function registerTrigger(t: Trigger): void {
  if (TRIGGERS.has(t.id)) return;
  TRIGGERS.set(t.id, t);
}

/** The registered triggers, in registration order. */
export function registeredTriggers(): readonly Trigger[] {
  return [...TRIGGERS.values()];
}

/**
 * Evaluates every registered trigger and returns the flags THIS call set —
 * an already-set flag is never reported twice. The return is therefore a
 * change feed ("what just became true"), which is what a diary entry or a
 * one-off flash consumes; the flags themselves persist for later queries.
 *
 * Same state in, same flags out: the registry is insertion-ordered and every
 * `when` is pure, so the call is reproducible.
 */
export function evaluateTriggers(s: GameState): string[] {
  const fired: string[] = [];
  for (const t of TRIGGERS.values()) {
    if (hasFlag(s, t.sets)) continue;
    if (!t.when(s)) continue;
    setFlag(s, t.sets);
    fired.push(t.sets);
  }
  return fired;
}
