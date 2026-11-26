// Chapter milestones.
//
// The formal victory condition is "reach floor 100000" and it is frozen in
// docs/GAME_DESIGN_LOCK.md - nothing here may change it, and nothing here
// sets `status = 'won'`. What lives here is the **stage** milestone that a
// playable slice can actually deliver: the run is 1..5 floors, so without a
// chapter ending a normal playthrough never reaches a payoff screen at all.
//
// Chapter 1 ends when the Alin repair gate is open (the line is repaired)
// AND the player stands on floor 3. That is the first thing a player can
// actually do, and it is the moment the demo video ends on.
//
// The judgement lives here rather than in `FloorSystem.tryChangeFloor`
// because that is a pure transition function and has no business knowing
// what a chapter is. The scene layer owns the card; this module owns the
// question "has the chapter been reached".

import type { GameState } from '../core/gameTypes';
import { CHAPTER1_CLEAR_FLOOR } from '../core/constants';
import { isAlinRepairGateOpen } from '../data/floorGates';
import { FLAG_CHAPTER1_CLEARED, once } from './WorldFlags';

/**
 * Has chapter 1 been reached? The gate must be open (the line is repaired)
 * and the player must be on floor 3.
 *
 * Read-only on purpose: it must not have side effects, because the scene
 * calls it to decide whether to *show* the card, and the card is shown at
 * most once.
 */
export function chapter1Reached(state: GameState): boolean {
  return state.currentFloor === CHAPTER1_CLEAR_FLOOR && isAlinRepairGateOpen(state);
}

/**
 * Marks the chapter-1 milestone.
 *
 * Returns true the first time and false every time after - the one-shot
 * semantics the card needs (the flag is `once:`-namespaced, so coming back
 * down and up does not pop the card a second time).
 *
 * It does not touch `state.status`: this is a milestone, not a win.
 */
export function clearChapter1(state: GameState): boolean {
  if (!chapter1Reached(state)) return false;
  return once(state, FLAG_CHAPTER1_CLEARED);
}
