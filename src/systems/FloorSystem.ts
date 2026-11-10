import {
  DOWN_EXIT_X,
  ENTRY_X,
  FLOOR_WIDTH,
  INTERACT_DISTANCE,
  PLAYER_ACCELERATION,
  PLAYER_DECELERATION,
  PLAYER_SPEED,
  STAIR_RISE,
  STAIR_START_Y,
  STAIR_TRAVEL_MS,
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

export interface StairTraversal {
  direction: 1 | -1;
  from: number;
  to: number;
  startX: number;
  endX: number;
  startY: number;
  endY: number;
  durationMs: number;
}

export interface StairPosition {
  x: number;
  y: number;
  progress: number;
}

export function hasUpExit(floor: number): boolean {
  return PLAYABLE_FLOORS_V01.includes(floor + 1);
}

export function hasDownExit(floor: number): boolean {
  return PLAYABLE_FLOORS_V01.includes(floor - 1);
}

export function floorName(floor: number): string {
  return getFloorTemplate(floor)?.name ?? '未知区域';
}

/** Build the visible stair path without mutating the game state. */
export function stairTraversalFor(state: GameState, direction: 1 | -1): StairTraversal | null {
  const to = state.currentFloor + direction;
  const allowed = direction === 1 ? hasUpExit(state.currentFloor) : hasDownExit(state.currentFloor);
  if (!allowed) return null;
  return {
    direction,
    from: state.currentFloor,
    to,
    startX: direction === 1 ? UP_EXIT_X : DOWN_EXIT_X,
    endX: direction === 1 ? DOWN_EXIT_X : UP_EXIT_X,
    startY: STAIR_START_Y,
    endY: STAIR_START_Y + (direction === 1 ? -STAIR_RISE : STAIR_RISE),
    durationMs: STAIR_TRAVEL_MS,
  };
}

/** Interpolate the player's world position while they are on the stairs. */
export function stairPosition(traversal: StairTraversal, elapsedMs: number): StairPosition {
  const progress = Math.max(0, Math.min(1, elapsedMs / traversal.durationMs));
  return {
    x: traversal.startX + (traversal.endX - traversal.startX) * progress,
    y: traversal.startY + (traversal.endY - traversal.startY) * progress,
    progress,
  };
}

/** Commit the floor only after the visible traversal reaches its landing. */
export function completeStairTraversal(state: GameState, traversal: StairTraversal): FloorChangeResult {
  const result = tryChangeFloor(state, traversal.direction);
  if (result.ok) state.player.x = traversal.endX;
  return result;
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

// ── how the player's body moves ─────────────────────────────────────────────
// The corridor handed the player its top speed the frame a key went down and
// took it away the frame it came up, so walking read as dragging a sticker
// across the backdrop. These ramp the speed instead of switching it.
//
// They live beside movePlayerX rather than in the scene because the scene holds
// the Phaser objects, and a speed ramp is the one part of locomotion worth
// unit-testing: it is where an unbounded frame turns into a flung player.

// Advances `current` (px/s) one frame toward the direction being held.
// `dir` is -1, 0 or +1. The result is always within ±PLAYER_SPEED, and braking
// never crosses zero — that clamp is what stops a long frame (a backgrounded
// tab coming back) from flinging the player the opposite way.
export function stepHorizontalSpeed(current: number, dir: number, deltaMs: number): number {
  if (deltaMs <= 0) return current;
  const dt = deltaMs / 1000;

  if (dir === 0) {
    const drop = PLAYER_DECELERATION * dt;
    return current > 0 ? Math.max(0, current - drop) : Math.min(0, current + drop);
  }

  // Reversing uses the brake rate, not the accelerator: flipping direction
  // mid-stride should feel like planting a foot, not like ice.
  const braking = current !== 0 && Math.sign(current) !== dir;
  const rate = braking ? PLAYER_DECELERATION : PLAYER_ACCELERATION;
  const next = current + rate * dt * dir;
  return dir > 0 ? Math.min(PLAYER_SPEED, next) : Math.max(-PLAYER_SPEED, next);
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
