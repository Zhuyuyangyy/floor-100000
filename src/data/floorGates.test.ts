import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { NPC_FLOOR } from './npcs';
import {
  ALIN_REPAIR_GATE_FLAG,
  ALIN_REPAIR_GATE_ID,
  closedFloorGateForTransition,
  isAlinRepairGateOpen,
} from './floorGates';
import { setFlag } from '../systems/WorldFlags';

describe('shared Alin repair floor gate', () => {
  it('blocks only the directed ascent from NPC_FLOOR to the next floor while closed', () => {
    const state = createNewGame(42);

    expect(isAlinRepairGateOpen(state)).toBe(false);
    expect(closedFloorGateForTransition(state, NPC_FLOOR, NPC_FLOOR + 1)).toMatchObject({
      gateId: ALIN_REPAIR_GATE_ID,
      fromFloor: NPC_FLOOR,
      toFloor: NPC_FLOOR + 1,
      flag: ALIN_REPAIR_GATE_FLAG,
    });
  });

  it('allows the gated ascent after its persisted story flag is set', () => {
    const state = createNewGame(7);
    setFlag(state, ALIN_REPAIR_GATE_FLAG);

    expect(isAlinRepairGateOpen(state)).toBe(true);
    expect(closedFloorGateForTransition(state, NPC_FLOOR, NPC_FLOOR + 1)).toBeNull();
  });

  it('keeps legacy saves that have already reached the upper floor open', () => {
    const state = createNewGame(9);
    state.currentFloor = NPC_FLOOR + 1;

    expect(state.flags?.[ALIN_REPAIR_GATE_FLAG]).toBeUndefined();
    expect(isAlinRepairGateOpen(state)).toBe(true);
    expect(closedFloorGateForTransition(state, NPC_FLOOR, NPC_FLOOR + 1)).toBeNull();
  });

  it('keeps legacy saves that have visited the upper floor open', () => {
    const state = createNewGame(11);
    state.visitedFloors[NPC_FLOOR + 1] = {
      openedContainers: [],
      lootedItems: [],
      unlockedDoors: [],
      localEvents: [],
    };

    expect(state.flags?.[ALIN_REPAIR_GATE_FLAG]).toBeUndefined();
    expect(isAlinRepairGateOpen(state)).toBe(true);
    expect(closedFloorGateForTransition(state, NPC_FLOOR, NPC_FLOOR + 1)).toBeNull();
  });

  it('does not let a cross-run deepest-floor record open this run gate', () => {
    const state = createNewGame(12);
    state.currentFloor = NPC_FLOOR;
    state.records!.deepestFloor = NPC_FLOOR + 1;
    delete state.visitedFloors[NPC_FLOOR + 1];

    expect(state.flags?.[ALIN_REPAIR_GATE_FLAG]).toBeUndefined();
    expect(isAlinRepairGateOpen(state)).toBe(false);
    expect(closedFloorGateForTransition(state, NPC_FLOOR, NPC_FLOOR + 1)).toMatchObject({
      gateId: ALIN_REPAIR_GATE_ID,
    });
  });

  it('does not block descent or transitions involving other floors', () => {
    const state = createNewGame(13);

    expect(closedFloorGateForTransition(state, NPC_FLOOR + 1, NPC_FLOOR)).toBeNull();
    expect(closedFloorGateForTransition(state, NPC_FLOOR, NPC_FLOOR - 1)).toBeNull();
    expect(closedFloorGateForTransition(state, NPC_FLOOR - 1, NPC_FLOOR + 1)).toBeNull();
    expect(closedFloorGateForTransition(state, NPC_FLOOR + 1, NPC_FLOOR + 2)).toBeNull();
  });
});
