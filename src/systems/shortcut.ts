import type { GameState } from '../core/gameTypes';
import { segmentOf } from '../core/segments';

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

// The shortcut appears on these floors only: not on the dorm, and not on the
// floor where the segment's stairs end. The second half of that rule is new:
// callers used to pass the whole tower's top, so once 100-110 were authored
// floor 10 was "below the top" and the prompt appeared there — the player paid
// and the jump landed on the 89-floor gap. A shortcut skips floors that exist,
// so it is confined to the segment, exactly like the stairs.
export function shortcutAvailable(floor: number, top: number): boolean {
  const here = segmentOf(floor);
  return floor >= 2 && floor < top && here !== undefined && floor < here.to;
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

export interface ShortcutPlan {
  /** Floors the shortcut will actually skip, clamped to the segment. */
  skip: number;
  /** What it costs — the same number the prompt shows and the charge spends. */
  price: number;
  /** The floor the player lands on. */
  target: number;
}

// ONE plan, ONE price. The prompt, the charge and the jump all read this, so
// the number on screen can never drift from the number taken. The skip is
// clamped to the segment here, once: the prompt used to price the raw roll
// while the jump walked only as far as the stairs allow, so at floor 9 a
// roll of 4 was advertised and charged as a 4-floor skip and then skipped 1.
// Depth is the asset; the price now buys exactly the depth it names.
export function shortcutPlan(state: GameState, floor: number, salt: number): ShortcutPlan {
  const here = segmentOf(floor);
  const room = here ? here.to - floor : 0;
  const skip = Math.max(0, Math.min(shortcutSkip(salt), room));
  return { skip, price: shortcutPrice(floor, skip, timesTaken(state), salt), target: floor + skip };
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
