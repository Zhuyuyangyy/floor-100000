import { createNewGame } from './gameState';
import { loadFromStorage } from '../systems/SaveSystem';
import type { GameState } from './gameTypes';

// Holds the active run for the current play session. GameState is the single
// source of truth (docs/02_TECH_SPEC.md §3); scenes read/mutate it via explicit
// logic functions and only render/sync from it.
let current: GameState | null = null;

export function startNewGame(seed: number): GameState {
  current = createNewGame(seed);
  return current;
}

export function loadState(state: GameState): GameState {
  current = state;
  return current;
}

// Loads a saved run if one exists and is valid; otherwise returns null.
export function tryContinue(): GameState | null {
  const result = loadFromStorage();
  if (result.ok) {
    current = result.state;
    return current;
  }
  return null;
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
