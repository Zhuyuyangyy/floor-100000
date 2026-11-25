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

export type ContinueResult = { ok: true; state: GameState } | { ok: false; error: string };

// Loads a saved run if one exists and is valid. Reports *why* it could not be
// used so the caller can tell the player instead of doing nothing silently
// (GHI-03 M4: docs/02_TECH_SPEC.md §6 requires a visible 存档损坏 message).
export function tryContinue(storage: Storage = localStorage): ContinueResult {
  const result = loadFromStorage(storage);
  if (!result.ok) return { ok: false, error: result.error };
  current = result.state;
  return { ok: true, state: current };
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
