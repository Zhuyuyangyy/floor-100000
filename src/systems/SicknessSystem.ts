// Ailments: the state between "fine" and "dead".
//
// The run used to have no middle ground. Hunger, thirst, cold and wounds each
// drained a bar and then took HP, so the only thing a player ever learned was
// that a number was falling — and the only outcome was a number reaching zero.
// Nothing was ever *wrong* in a way that changed how you played.
//
// This War of Mine's scene loop runs ProcessSickness next to ProcessSleep, and
// its diary distinguishes DwellerSickness from DwellerSicknessNoEffect
// (docs/reference/TWOM_MECHANICS.md §1). An ailment there is a condition the
// survivor carries: it slows them, it colours the day, and it can be treated.
//
// Four ailments, each with a source the player can reason about:
//
//   cold           stood too long below freezing body heat
//   fever          humidity plus a wound, or drinking dirty water
//   wound          the wanderer's hits; only a medkit or sleep clears it
//   food_poisoning ate or drank something unclean
//
// An ailment is not a faster HP drain. It is a modifier: it makes the other bars
// cost more, it slows recovery, and only at full severity does it take HP. That
// is what makes it feel like being ill rather than like being stabbed slowly.

import { GAME_CONFIG } from '../core/config';
import { environmentFor } from '../core/constants';
import type { Ailment, AilmentId, GameState } from '../core/gameTypes';
import { absoluteMinute } from './SurvivalSystem';
import { FREEZING_THRESHOLD } from './EnvironmentSystem';

/** severity at which the ailment starts costing HP on its own */
export const SEVERITY_CRITICAL = 100;
/** severity at which it starts visibly hurting the other bars */
const SEVERITY_BITING = 25;
/** how long at freezing body heat before it becomes a cold */
const FREEZE_TO_COLD_MINUTES = 90;

// When the player first dropped to freezing, in absolute minutes. Module-level
// rather than on the state because it is a measurement of the current stretch of
// cold, not a fact about the run: reloading mid-shiver should not inherit a
// half-counted clock, and the honest place for something that must not survive a
// reload is a module-level value.
let freezeSince: number | undefined;

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

export interface AilmentDef {
  id: AilmentId;
  label: string;
  /** how much worse it gets per game hour while the cause persists */
  progressPerHour: number;
  /** how much better it gets per game hour from resting, with no cause */
  recoverPerHour: number;
  /** what it does to the other bars while it bites, 0..1 */
  drainMult: number;
  /** HP per game hour once severity is critical */
  hpPerHour: number;
  /** the cure, or null when only rest clears it */
  curedBy: 'medkit' | 'clean_water' | 'sleep' | null;
}

export const AILMENTS: Record<AilmentId, AilmentDef> = {
  cold: {
    id: 'cold',
    label: '冻伤',
    progressPerHour: 6,
    recoverPerHour: 5,
    drainMult: 0.25,
    hpPerHour: 1.5,
    curedBy: 'sleep',
  },
  fever: {
    id: 'fever',
    label: '发烧',
    progressPerHour: 4,
    recoverPerHour: 3,
    drainMult: 0.4,
    hpPerHour: 2.5,
    curedBy: 'clean_water',
  },
  wound: {
    id: 'wound',
    label: '受伤',
    progressPerHour: 2,
    recoverPerHour: 2.5,
    drainMult: 0.3,
    hpPerHour: 2,
    curedBy: 'medkit',
  },
  food_poisoning: {
    id: 'food_poisoning',
    label: '食物中毒',
    progressPerHour: 8,
    recoverPerHour: 4,
    drainMult: 0.5,
    hpPerHour: 2,
    curedBy: 'clean_water',
  },
};

/** The player's ailments, created on demand so old saves load without them. */
export function ailmentsOf(state: GameState): Ailment[] {
  if (!state.player.ailments) state.player.ailments = [];
  return state.player.ailments;
}

export function hasAilment(state: GameState, id: AilmentId): boolean {
  return (state.player.ailments ?? []).some((a) => a.id === id);
}

export function severityOf(state: GameState, id: AilmentId): number {
  return (state.player.ailments ?? []).find((a) => a.id === id)?.severity ?? 0;
}

/** Adds an ailment or worsens the one already there. */
export function inflict(state: GameState, id: AilmentId, severity: number, absoluteMinute: number): void {
  const list = ailmentsOf(state);
  const existing = list.find((a) => a.id === id);
  if (existing) {
    existing.severity = clamp(Math.max(existing.severity, severity), 0, SEVERITY_CRITICAL);
    return;
  }
  list.push({ id, severity: clamp(severity, 0, SEVERITY_CRITICAL), sinceMinute: absoluteMinute });
}

/** Removes an ailment entirely. */
export function cure(state: GameState, id: AilmentId): void {
  const list = state.player.ailments;
  if (!list) return;
  const i = list.findIndex((a) => a.id === id);
  if (i >= 0) list.splice(i, 1);
}

export interface SicknessTick {
  /** ailments that crossed into biting this tick */
  worsened: AilmentId[];
  /** ailments that cleared this tick */
  recovered: AilmentId[];
  /** ailments that reached critical this tick */
  critical: AilmentId[];
}

const NONE: SicknessTick = { worsened: [], recovered: [], critical: [] };

/**
 * Advances every ailment by `gameMinutes`.
 *
 * Each ailment progresses while its cause persists and recovers otherwise. The
 * cause is evaluated here rather than tracked by the systems that create it, so
 * a cold caught on floor 4 heals on floor 1 without anything having to remember
 * where it came from.
 */
export function tickSickness(state: GameState, gameMinutes: number): SicknessTick {
  if (state.status !== 'playing' || gameMinutes <= 0) return NONE;

  const hours = gameMinutes / 60;
  const env = environmentFor(state.currentFloor);
  const temp = state.player.bodyTemp ?? 100;
  const tick: SicknessTick = { worsened: [], recovered: [], critical: [] };
  const cfg = GAME_CONFIG.player;

  // What is true of the player right now, which is what each ailment reacts to.
  const freezing = temp <= FREEZING_THRESHOLD;
  const damp = env.humidity >= 0.5;
  const starving = state.player.hunger <= 0 || state.player.thirst <= 0;

  // CONTRACTING. This runs before the no-ailments early return, because the
  // whole point is that a healthy player can catch something — returning first
  // would mean the only person who ever gets ill is the one already ill.
  //
  // Long enough at freezing body heat and the shiver becomes a cold. The HP loss
  // EnvironmentSystem already charges is the emergency; this is the condition
  // that outlasts it.
  if (freezing) {
    if (freezeSince === undefined) freezeSince = absoluteMinute(state);
    else if (absoluteMinute(state) - freezeSince >= FREEZE_TO_COLD_MINUTES) {
      inflict(state, 'cold', 30, absoluteMinute(state));
      freezeSince = undefined;
    }
  } else {
    freezeSince = undefined;
  }

  const list = state.player.ailments;
  if (!list || list.length === 0) return tick;

  // The combined drain the ailments impose on the other bars this tick.
  let drainMult = 0;

  for (const a of list) {
    const def = AILMENTS[a.id];
    const before = a.severity;

    // The cause, per ailment.
    let cause = false;
    if (a.id === 'cold') cause = freezing;
    else if (a.id === 'fever') cause = damp || starving;
    else if (a.id === 'food_poisoning') cause = starving;
    // a wound has no ongoing cause: it heals or it does not

    const rate = cause ? def.progressPerHour : def.recoverPerHour;
    a.severity = clamp(a.severity + rate * hours * (cause ? 1 : -1), 0, SEVERITY_CRITICAL);

    if (before < SEVERITY_BITING && a.severity >= SEVERITY_BITING) tick.worsened.push(a.id);
    if (before < SEVERITY_CRITICAL && a.severity >= SEVERITY_CRITICAL) tick.critical.push(a.id);

    if (a.severity >= SEVERITY_BITING) {
      drainMult = Math.max(drainMult, def.drainMult * (a.severity / SEVERITY_CRITICAL));
    }
    if (a.severity >= SEVERITY_CRITICAL) {
      state.player.hp = clamp(state.player.hp - def.hpPerHour * hours, 0, cfg.hpMax);
    }
  }

  // An ailment makes everything else cost more — that is the whole point of it
  // being a condition rather than a second HP bar.
  if (drainMult > 0) {
    const extra = gameMinutes / 60;
    state.player.hunger = clamp(state.player.hunger - cfg.hungerLossPerGameHour * drainMult * extra, 0, cfg.hungerMax);
    state.player.thirst = clamp(state.player.thirst - cfg.thirstLossPerGameHour * drainMult * extra, 0, cfg.thirstMax);
    state.player.energy = clamp(state.player.energy - cfg.energyLossPerGameHour * drainMult * extra, 0, cfg.energyMax);
  }

  // Drop what healed.
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].severity <= 0) {
      tick.recovered.push(list[i].id);
      list.splice(i, 1);
    }
  }

  return tick;
}

/** Applies a cure item to the ailment it treats. Returns what it cleared. */
export function applyCure(state: GameState, curedBy: 'medkit' | 'clean_water'): AilmentId[] {
  const list = state.player.ailments;
  if (!list) return [];
  const cleared: AilmentId[] = [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (AILMENTS[list[i].id].curedBy === curedBy) {
      cleared.push(list[i].id);
      list.splice(i, 1);
    }
  }
  return cleared;
}

/** The HUD line: what is wrong, worst first. */
export function ailmentLabel(state: GameState): string {
  const list = state.player.ailments ?? [];
  if (list.length === 0) return '';
  const worst = [...list].sort((a, b) => b.severity - a.severity)[0];
  return AILMENTS[worst.id].label;
}
