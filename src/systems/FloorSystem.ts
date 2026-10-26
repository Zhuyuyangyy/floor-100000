import {
  DOWN_EXIT_X,
  ENTRY_X,
  FLOOR_WIDTH,
  INTERACT_DISTANCE,
  UP_EXIT_X,
  PLAYABLE_FLOORS_V01,
} from '../core/constants';
import { getFloorTemplate } from '../data/floorTemplates';
import type { GameState } from '../core/gameTypes';

// Pure floor/movement rules (docs/02_TECH_SPEC.md §3: core rules are testable,
// Phaser only renders). Floors are the contiguous v0.1 range 99996..100000;
// "up" (+1) climbs toward 100000, "down" (-1) descends toward 99996.

export type FloorChangeResult =
  | { ok: true; from: number; to: number }
  | { ok: false; reason: 'top' | 'bottom' };

export function hasUpExit(floor: number): boolean {
  return PLAYABLE_FLOORS_V01.includes(floor + 1);
}

export function hasDownExit(floor: number): boolean {
  return PLAYABLE_FLOORS_V01.includes(floor - 1);
}

export function floorName(floor: number): string {
  return getFloorTemplate(floor)?.name ?? '未知区域';
}

// Applies a floor change to state on success (moving the player to the entry
// point). Returns a typed failure instead of throwing for out-of-range moves.
// `direction` is ±1, so the target is always adjacent — the range check below is
// the only way this can fail.
export function tryChangeFloor(state: GameState, direction: 1 | -1): FloorChangeResult {
  const from = state.currentFloor;
  const to = from + direction;
  if (!PLAYABLE_FLOORS_V01.includes(to)) {
    return { ok: false, reason: direction === 1 ? 'top' : 'bottom' };
  }
  state.currentFloor = to;
  state.player.x = ENTRY_X;
  return { ok: true, from, to };
}

// Clamped horizontal movement within the corridor. Pure so it can be unit-tested.
export function movePlayerX(state: GameState, deltaX: number): void {
  const min = 8;
  const max = FLOOR_WIDTH - 8;
  state.player.x = Math.max(min, Math.min(max, state.player.x + deltaX));
}

export type InteractionZone = 'up' | 'down' | null;

// Which exit (if any) the player is currently standing next to.
export function currentInteractionZone(state: GameState): InteractionZone {
  if (hasUpExit(state.currentFloor) && Math.abs(state.player.x - UP_EXIT_X) <= INTERACT_DISTANCE) {
    return 'up';
  }
  if (hasDownExit(state.currentFloor) && Math.abs(state.player.x - DOWN_EXIT_X) <= INTERACT_DISTANCE) {
    return 'down';
  }
  return null;
}
