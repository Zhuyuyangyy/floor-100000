import type { GameState } from '../core/gameTypes';

// OVERHAUL Wave C2: the paid shortcut — Centum's signature economy move.
// Its source (docs/RE_COMPETITIVE.md) prices a 2-4 floor skip as
//   2×depth + 90 + timesTaken × random(25,35)
// and the price climbs with every use, so skipping is a real budget decision
// rather than a free fast-travel. Depth is the asset; gold is what converts
// it into time saved.
//
// This module owns the formula and the gate; the scene owns the interaction
// (a prompt at the up stairwell) and applies the jump through the existing
// floor-change path.

// The shortcut appears on these floors only: not on the dorm, not on the top
// floor (the guardian's floor is walked, not skipped past).
export function shortcutAvailable(floor: number, top: number): boolean {
  return floor >= 2 && floor < top;
}

// The price of skipping `floors` floors from `floor`, after `timesTaken`
// previous shortcuts. Deterministic for a seed so the same situation always
// costs the same.
export function shortcutPrice(floor: number, floors: number, timesTaken: number, salt: number): number {
  const base = 2 * floor + 90;
  const inflation = timesTaken * (25 + (salt % 11)); // 25..35, seeded
  return base + inflation + floors * 10;
}

// How many floors a shortcut skips: 2-4, seeded.
export function shortcutSkip(salt: number): number {
  return 2 + (salt % 3);
}

// Whether the player can afford it right now.
export function canAfford(state: GameState, price: number): boolean {
  return state.player.gold >= price;
}

// Spends the gold and reports the new purse. The caller applies the floor
// jump; this only owns the money, so a failed charge never moves the player.
export function charge(state: GameState, price: number): boolean {
  if (!canAfford(state, price)) return false;
  state.player.gold -= price;
  return true;
}

// The times a shortcut has been taken this run. Lives on the state so a save
// keeps the inflation.
export function timesTaken(state: GameState): number {
  return state.shortcuts ?? 0;
}

export function recordShortcut(state: GameState): void {
  state.shortcuts = (state.shortcuts ?? 0) + 1;
}
