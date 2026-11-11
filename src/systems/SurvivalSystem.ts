import { GAME_CONFIG } from '../core/config';
import { DAY_START_MINUTE, MINUTES_PER_DAY } from '../core/constants';
import { devEntry } from '../core/devMode';
import type { GameState } from '../core/gameTypes';
import { modeDecayMult } from './modes';
import { hungerLossMult } from './relics';
import { tickEnvironment, type EnvironmentTick } from './EnvironmentSystem';
import { tickSickness, type SicknessTick } from './SicknessSystem';

// Time & survival rules (docs/01_GDD.md §5-6, config/game-balance.json).
// Pure & deterministic: Phaser only feeds the real-time delta; these functions
// mutate GameState and report discrete events for the scene to react to.

// HP lost per game-hour while dehydrated or starving. Not in game-balance.json,
// so defined here as a tunable starting value.
export const HP_STARVE_LOSS_PER_HOUR = 4;

// Clamp a single frame's delta so a backgrounded tab cannot fast-forward survival
// (docs/02_TECH_SPEC.md §3: no frame-rate-dependent survival).
export const MAX_FRAME_MS = 250;

// Autosave cadence in game minutes. The clock advances gameMinutesPerRealSecond
// game-minutes per real second, so saving on every whole minute would mean
// several writes per second; this bounds how much time and decay a closed tab
// can roll back while staying cheap (GHI-03 M3).
export const AUTOSAVE_EVERY_GAME_MINUTES = 5;

// Monotonic minute index across days, so a midnight rollover cannot look like
// "no time passed" and skip an autosave.
export function absoluteMinute(state: GameState): number {
  return state.day * MINUTES_PER_DAY + Math.floor(state.gameMinuteOfDay);
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

export interface TimeTick {
  gameMinutes: number;
  dayChanged: boolean;
  died: boolean;
  won: boolean;
  /** body heat's transition this tick, if any */
  environment?: EnvironmentTick;
  /** what the ailments did this tick, if anything */
  sickness?: SicknessTick;
}

const NONE: TimeTick = { gameMinutes: 0, dayChanged: false, died: false, won: false };
export function formatClock(minuteOfDay: number): string {
  const m = ((Math.floor(minuteOfDay) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(Math.floor(m % 60)).padStart(2, '0');
  return `${hh}:${mm}`;
}

function applyDecay(state: GameState, gameMinutes: number): void {
  const hours = gameMinutes / 60;
  const p = state.player;
  const cfg = GAME_CONFIG.player;
  // OVERHAUL Wave B2/B3: the mode scales the drain (quick tighter, easy
  // softer) and the iron-stomach relic cuts hunger specifically. Both are
  // multipliers on the shipped rate, so the baseline config stays the truth.
  const modeMult = modeDecayMult(state.mode ?? 'adventure');
  const relicHunger = hungerLossMult(state.relics ?? []);
  p.hunger = clamp(p.hunger - cfg.hungerLossPerGameHour * hours * modeMult * relicHunger, 0, cfg.hungerMax);
  p.thirst = clamp(p.thirst - cfg.thirstLossPerGameHour * hours * modeMult, 0, cfg.thirstMax);
  p.energy = clamp(p.energy - cfg.energyLossPerGameHour * hours, 0, cfg.energyMax);
  if (p.hunger <= 0 || p.thirst <= 0) {
    p.hp = clamp(p.hp - HP_STARVE_LOSS_PER_HOUR * hours, 0, cfg.hpMax);
  }
}

// The retired v0.1 win threshold: reach day 8 at/after 06:00 still alive. The
// frozen design replaces it with reaching the summit (B8), so production never
// auto-wins on the calendar — only the ?devwin=1 fixture still honours this.
export function isLegacyVictory(state: GameState): boolean {
  const t = GAME_CONFIG.time;
  return state.day >= t.victoryDay && state.gameMinuteOfDay >= t.victoryMinute;
}

// The shared clock engine. Both the frame loop and discrete action costs go
// through here so a 20-minute search rolls the day over and charges decay under
// exactly the same rules as 20 minutes of walking (B3-03).
function advanceGameMinutes(state: GameState, gameMinutes: number): TimeTick {
  if (state.status !== 'playing') return NONE;
  if (gameMinutes <= 0) return NONE;

  let minute = state.gameMinuteOfDay + gameMinutes;
  let dayChanged = false;
  while (minute >= MINUTES_PER_DAY) {
    minute -= MINUTES_PER_DAY;
    state.day += 1;
    dayChanged = true;
  }
  state.gameMinuteOfDay = minute;
  if (dayChanged) state.worldEvents.activeEvent = null; // fresh roll each day

  applyDecay(state, gameMinutes);
  // Body heat rides the same clock as the other three bars, so standing on floor
  // 4 for twenty minutes costs the same whether those minutes were walked or
  // spent searching a container (B3-03).
  const env = tickEnvironment(state, gameMinutes);
  // Ailments ride it too, and they read the body heat the same tick just set.
  const sick = tickSickness(state, gameMinutes);

  if (state.player.hp <= 0) {
    state.player.hp = 0;
    state.status = 'lost';
    return { gameMinutes, dayChanged, died: true, won: false, environment: env, sickness: sick };
  }
  if (devEntry().legacyWin && isLegacyVictory(state)) {
    state.status = 'won';
    return { gameMinutes, dayChanged, died: false, won: true, environment: env, sickness: sick };
  }
  return { gameMinutes, dayChanged, died: false, won: false, environment: env, sickness: sick };
}

// Advances the clock by a real-time delta, applies survival decay, and resolves
// loss (HP 0). No-op once ended.
export function advanceTime(state: GameState, deltaMs: number): TimeTick {
  const clampedMs = clamp(deltaMs, 0, MAX_FRAME_MS);
  return advanceGameMinutes(state, (clampedMs / 1000) * GAME_CONFIG.time.gameMinutesPerRealSecond);
}

// B3-03: charges a discrete action its game-time cost. A day is a budget, not a
// countdown — without this, one full sweep of five floors costs 4.5 game hours
// and the player idles through the other 9.75.
export function spendTime(state: GameState, gameMinutes: number): TimeTick {
  return advanceGameMinutes(state, gameMinutes);
}

// Game-minutes each action costs, from config/game-balance.json so pacing can be
// tuned without touching code.
export const ACTION_COSTS = GAME_CONFIG.actionCosts;

// The minutes a given sleep actually skips: from now (or from the 20:00 gate,
// whichever is later) to 06:00 the next day. Sleeping at 02:00 skips a shorter
// night than sleeping at 20:00 — the extra awake hours were already charged at
// the waking rate by advanceTime, so staying out still costs more in total.
export function sleepNightMinutes(minuteOfDay: number): number {
  const from = Math.max(minuteOfDay, GAME_CONFIG.time.nightRiskStartMinute);
  return MINUTES_PER_DAY - from + GAME_CONFIG.time.dayStartMinute;
}

// Resting metabolises at half the waking rate. Sleeping is therefore not a free
// time skip — the audit found the rule was implicit and untested, with sleep
// applying no hunger or thirst at all. Charging the night at a named rate makes
// "go home before dark" a real decision: resting is cheaper than staying awake
// and it keeps the wanderer off you, but it is not zero.
export const REST_METABOLISM = 0.5;

// The night's bill. Energy is deliberately NOT charged: recovering it is the
// whole point of going to bed, and billing it here would undo the restore on the
// line above.
function applyRestDecay(state: GameState, hours: number): void {
  const p = state.player;
  const cfg = GAME_CONFIG.player;
  const rest = REST_METABOLISM;
  p.hunger = clamp(p.hunger - cfg.hungerLossPerGameHour * rest * hours, 0, cfg.hungerMax);
  p.thirst = clamp(p.thirst - cfg.thirstLossPerGameHour * rest * hours, 0, cfg.thirstMax);
  if (p.hunger <= 0 || p.thirst <= 0) {
    p.hp = clamp(p.hp - HP_STARVE_LOSS_PER_HOUR * rest * hours, 0, cfg.hpMax);
  }
}

export type SleepResult = { ok: true; won: boolean; newDay: number } | { ok: false; reason: string };

// Sleep in the dorm to pass the night: only from 20:00, advances to next 06:00,
// restores energy, and charges the skipped night's hunger and thirst at the
// resting rate. The retired day-8 auto-win only applies under ?devwin=1.
export function sleep(state: GameState): SleepResult {
  if (state.status !== 'playing') return { ok: false, reason: '游戏已结束' };
  if (state.gameMinuteOfDay < GAME_CONFIG.time.nightRiskStartMinute) {
    return { ok: false, reason: '还太早，无法入睡（20:00 后）' };
  }
  const nightHours = sleepNightMinutes(state.gameMinuteOfDay) / 60;
  state.day += 1;
  state.gameMinuteOfDay = GAME_CONFIG.time.dayStartMinute;
  state.player.energy = GAME_CONFIG.player.energyMax;
  // Charged after the clock moves, so a player who wakes up starving sees it
  // immediately rather than a minute later.
  applyRestDecay(state, nightHours);
  state.worldEvents.activeEvent = null; // fresh roll each day
  const won = devEntry().legacyWin && isLegacyVictory(state);
  if (won) state.status = 'won';
  return { ok: true, won, newDay: state.day };
}

export function deathCause(state: GameState): string {
  if (state.player.thirst <= 0) return '严重脱水';
  if (state.player.hunger <= 0) return '饥饿';
  return '伤势过重';
}

// Night is 18:00 -> 06:00 (day runs 06:00-18:00).
export const NIGHT_START_MINUTE = 1080;
export function isNight(minuteOfDay: number): boolean {
  return minuteOfDay >= NIGHT_START_MINUTE || minuteOfDay < DAY_START_MINUTE;
}
