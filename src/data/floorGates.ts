import type { GameState } from '../core/gameTypes';
import type { InventoryStack } from '../core/gameTypes';
import { NPC_FLOOR } from './npcs';
import { flagCount, flagKey } from '../systems/WorldFlags';

/** The repair gate controls the existing upward connection out of Alin's floor. */
export const ALIN_REPAIR_GATE_ID = 'alin-repair-gate';
export const ALIN_REPAIR_GATE_FLAG = flagKey.story(ALIN_REPAIR_GATE_ID);
/** User-approved recipe for the progression gate leaving 阿林's floor. */
export const ALIN_REPAIR_MATERIALS: readonly InventoryStack[] = Object.freeze([
  Object.freeze({ itemId: 'wood' as const, quantity: 2 }),
  Object.freeze({ itemId: 'tape' as const, quantity: 1 }),
]);
export const ALIN_REPAIR_GATE = Object.freeze({
  gateId: ALIN_REPAIR_GATE_ID,
  fromFloor: NPC_FLOOR,
  toFloor: NPC_FLOOR + 1,
  flag: ALIN_REPAIR_GATE_FLAG,
});

/**
 * Preserve only this run's progression when loading legacy saves. The persistent
 * highest-floor record is cross-run bragging progress, not access for this run.
 */
export function isAlinRepairGateOpen(state: GameState): boolean {
  return flagCount(state, ALIN_REPAIR_GATE_FLAG) > 0 ||
    state.currentFloor >= ALIN_REPAIR_GATE.toFloor ||
    state.visitedFloors[ALIN_REPAIR_GATE.toFloor] !== undefined;
}

/** Return the gate that blocks a directed floor transition, if any. */
export function closedFloorGateForTransition(
  state: GameState,
  fromFloor: number,
  toFloor: number,
): typeof ALIN_REPAIR_GATE | null {
  if (
    fromFloor === ALIN_REPAIR_GATE.fromFloor &&
    toFloor === ALIN_REPAIR_GATE.toFloor &&
    !isAlinRepairGateOpen(state)
  ) return ALIN_REPAIR_GATE;
  return null;
}
