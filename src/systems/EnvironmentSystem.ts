// Body heat: the fourth survival bar, and the first that a floor owns.
//
// Hunger, thirst and energy drain at a rate the config sets and nothing on the
// floor changes. That is why the five floors felt like five colour schemes: none
// of them could touch how the run was going. Body heat is the stat that makes a
// floor a place — floor 4 pulls it out of you three times faster than home does,
// and the canteen's brazier puts it back.
//
// This War of Mine's scene loop runs TickTemperature and TickHeaters next to
// ProcessSleep and ProcessSickness (docs/reference/TWOM_MECHANICS.md §3). This
// is the smaller version: one stat, a per-floor drain, and warmth sources that
// already exist as flames in the scene.
//
// Everything here is a pure function of GameState. The scene supplies the
// player's x and the floor; nothing reads Phaser.

import { GAME_CONFIG } from '../core/config';
import { WARMTH_SOURCES, environmentFor } from '../core/constants';
import type { GameState } from '../core/gameTypes';

export const BODY_TEMP_MAX = 100;
/** below this the survivor is cold: energy drains faster and the HUD warns */
export const COLD_THRESHOLD = 35;
/** at zero the cold starts doing what starvation does */
export const FREEZING_THRESHOLD = 10;

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

/** The player's body heat, created on demand so old saves load without it. */
export function bodyTempOf(state: GameState): number {
  const p = state.player;
  if (typeof p.bodyTemp !== 'number' || !Number.isFinite(p.bodyTemp)) {
    p.bodyTemp = BODY_TEMP_MAX;
  }
  return p.bodyTemp;
}

/** How much warmth the floor's sources give at this x, in points per game hour. */
export function warmthAt(floor: number, x: number): number {
  const sources = WARMTH_SOURCES[floor];
  if (!sources) return 0;
  let total = 0;
  for (const s of sources) {
    const d = Math.abs(x - s.x);
    if (d > s.radius) continue;
    // linear falloff to the edge of the radius, so stepping out of the light
    // steps out of the heat
    total += s.power * (1 - d / s.radius);
  }
  return total;
}

export interface EnvironmentTick {
  /** body heat after the tick */
  bodyTemp: number;
  /** the tick pushed the survivor into the cold band */
  becameCold: boolean;
  /** the tick pushed the survivor to freezing */
  becameFreezing: boolean;
  /** the tick warmed them back out of the cold band */
  warmedUp: boolean;
}

const NONE: EnvironmentTick = { bodyTemp: BODY_TEMP_MAX, becameCold: false, becameFreezing: false, warmedUp: false };

/**
 * Advances body heat by `gameMinutes`.
 *
 * The drain is the floor's cold rate, made worse by humidity — a damp floor
 * takes more out of you than a dry one at the same temperature — and offset by
 * whatever warmth source the player is standing in. Below COLD_THRESHOLD energy
 * drains faster; below FREEZING_THRESHOLD the cold costs HP the way starvation
 * does.
 */
export function tickEnvironment(state: GameState, gameMinutes: number): EnvironmentTick {
  if (state.status !== 'playing' || gameMinutes <= 0) return NONE;

  const hours = gameMinutes / 60;
  const env = environmentFor(state.currentFloor);
  const before = bodyTempOf(state);

  // Humidity makes the cold bite harder: a wet floor at the same temperature
  // takes more out of you. 0.6 humidity on floor 3 is +60% drain.
  const drain = env.cold * (1 + env.humidity);
  const gain = warmthAt(state.currentFloor, state.player.x);
  // Recovery is slower in the damp for the same reason the drain is faster.
  const net = (gain * (1 - env.humidity * 0.5) - drain) * hours;

  const after = clamp(before + net, 0, BODY_TEMP_MAX);
  state.player.bodyTemp = after;

  const tick: EnvironmentTick = {
    bodyTemp: after,
    becameCold: before >= COLD_THRESHOLD && after < COLD_THRESHOLD,
    becameFreezing: before >= FREEZING_THRESHOLD && after < FREEZING_THRESHOLD,
    warmedUp: before < COLD_THRESHOLD && after >= COLD_THRESHOLD,
  };

  // Cold costs energy first, then HP — the same escalation starvation uses, so
  // the two read as the same kind of threat rather than as two unrelated bars.
  if (after < COLD_THRESHOLD) {
    const coldHours = hours * (1 - after / COLD_THRESHOLD);
    state.player.energy = clamp(
      state.player.energy - GAME_CONFIG.player.energyLossPerGameHour * 0.5 * coldHours,
      0,
      GAME_CONFIG.player.energyMax,
    );
  }
  if (after < FREEZING_THRESHOLD) {
    state.player.hp = clamp(state.player.hp - 2 * hours, 0, GAME_CONFIG.player.hpMax);
  }

  return tick;
}

/** The HUD line for the floor the player is standing on. */
export function environmentLabel(floor: number): string {
  const env = environmentFor(floor);
  const warm = (WARMTH_SOURCES[floor]?.length ?? 0) > 0;
  const parts = [env.label];
  if (env.humidity >= 0.5) parts.push('潮湿');
  if (warm) parts.push('有热源');
  if (env.hostile) parts.push('夜间危险');
  return parts.join(' · ');
}
