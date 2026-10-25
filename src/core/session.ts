import { createNewGame } from './gameState';
import type { GameState } from './gameTypes';

// Holds the active run for the current play session. GameState is the single
// source of truth (docs/02_TECH_SPEC.md §3); scenes read/mutate it via explicit
// logic functions and only render/sync from it. Persistence arrives in a later
// task; for now this lives in memory across scene restarts.
let current: GameState | null = null;

export function startNewGame(seed: number): GameState {
  current = createNewGame(seed);
  return current;
}

export function hasGame(): boolean {
  return current !== null;
}

export function getGame(): GameState {
  if (!current) {
    throw new Error('no active game; call startNewGame(seed) first');
  }
  return current;
}
