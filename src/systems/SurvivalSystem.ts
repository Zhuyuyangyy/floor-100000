import { GAME_CONFIG } from '../core/config';
import { DAY_START_MINUTE, MINUTES_PER_DAY } from '../core/constants';
import type { GameState } from '../core/gameTypes';

// Time & survival rules (docs/01_GDD.md §5-6, config/game-balance.json).
// Pure & deterministic: Phaser only feeds the real-time delta; these functions
// mutate GameState and report discrete events for the scene to react to.

// HP lost per game-hour while dehydrated or starving. Not in game-balance.json,
// so defined here as a tunable starting value.
export const HP_STARVE_LOSS_PER_HOUR = 4;

// Clamp a single frame's delta so a backgrounded tab cannot fast-forward survival
// (docs/02_TECH_SPEC.md §3: no frame-rate-dependent survival).
export const MAX_FRAME_MS = 250;

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

export interface TimeTick {
  gameMinutes: number;
  dayChanged: boolean;
  died: boolean;
  won: boolean;
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
  p.hunger = clamp(p.hunger - cfg.hungerLossPerGameHour * hours, 0, cfg.hungerMax);
  p.thirst = clamp(p.thirst - cfg.thirstLossPerGameHour * hours, 0, cfg.thirstMax);
  p.energy = clamp(p.energy - cfg.energyLossPerGameHour * hours, 0, cfg.energyMax);
  if (p.hunger <= 0 || p.thirst <= 0) {
    p.hp = clamp(p.hp - HP_STARVE_LOSS_PER_HOUR * hours, 0, cfg.hpMax);
  }
}

// Advances the clock by a real-time delta, applies survival decay, and resolves
// loss (HP 0) / victory (reach the victory day at/after 06:00). No-op once ended.
export function advanceTime(state: GameState, deltaMs: number): TimeTick {
  if (state.status !== 'playing') return NONE;

  const clampedMs = clamp(deltaMs, 0, MAX_FRAME_MS);
  const gameMinutes = (clampedMs / 1000) * GAME_CONFIG.time.gameMinutesPerRealSecond;
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

  if (state.player.hp <= 0) {
    state.player.hp = 0;
    state.status = 'lost';
    return { gameMinutes, dayChanged, died: true, won: false };
  }
  const t = GAME_CONFIG.time;
  if (state.day >= t.victoryDay && state.gameMinuteOfDay >= t.victoryMinute) {
    state.status = 'won';
    return { gameMinutes, dayChanged, died: false, won: true };
  }
  return { gameMinutes, dayChanged, died: false, won: false };
}

export type SleepResult = { ok: true; won: boolean; newDay: number } | { ok: false; reason: string };

// Sleep in the dorm to pass the night: only from 20:00, advances to next 06:00,
// restores energy, and wins if it reaches the victory day.
export function sleep(state: GameState): SleepResult {
  if (state.status !== 'playing') return { ok: false, reason: '游戏已结束' };
  if (state.gameMinuteOfDay < GAME_CONFIG.time.nightRiskStartMinute) {
    return { ok: false, reason: '还太早，无法入睡（20:00 后）' };
  }
  state.day += 1;
  state.gameMinuteOfDay = GAME_CONFIG.time.dayStartMinute;
  state.player.energy = GAME_CONFIG.player.energyMax;
  state.worldEvents.activeEvent = null; // fresh roll each day
  const won = state.day >= GAME_CONFIG.time.victoryDay;
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
