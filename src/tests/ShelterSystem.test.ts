import { describe, expect, it } from 'vitest';
import { addToInventory, createNewGame } from '../core/gameState';
import { inflict } from '../systems/SicknessSystem';
import { availableShelterActions, finishNight, resolveShelterAction } from '../systems/ShelterSystem';

describe('ShelterSystem', () => {
  it('offers the four shelter actions on the starting floor', () => {
    const state = createNewGame(42);
    expect(availableShelterActions(state)).toEqual(['rest', 'treat', 'repair', 'care']);
  });

  it('rest succeeds once and rejects a second action', () => {
    const state = createNewGame(42);
    const first = resolveShelterAction(state, 'rest');
    expect(first.ok).toBe(true);
    expect(state.shelterPlan).toEqual({ day: 1, action: 'rest', resolved: true });
    expect(state.player.stress).toBe(14);

    const second = resolveShelterAction(state, 'care');
    expect(second.ok).toBe(false);
    expect(second.reason).toContain('已经安排');
  });

  it('treatment fails without a medkit and does not remove anything', () => {
    const state = createNewGame(42);
    inflict(state, 'wound', 50, 360);
    const result = resolveShelterAction(state, 'treat');
    expect(result.ok).toBe(false);
    expect(state.player.inventory.slots).toHaveLength(3);
    expect(state.player.ailments?.map((a) => a.id)).toEqual(['wound']);
    expect(state.shelterPlan).toBeUndefined();
  });

  it('treatment consumes one medkit and clears a wound atomically', () => {
    const state = createNewGame(42);
    addToInventory(state.player.inventory, 'medkit', 1);
    inflict(state, 'wound', 50, 360);
    const result = resolveShelterAction(state, 'treat');
    expect(result.ok).toBe(true);
    expect(state.player.ailments).toEqual([]);
    expect(state.player.inventory.slots.some((slot) => slot.itemId === 'medkit')).toBe(false);
  });

  it('care consumes food and repair uses the existing reinforced-door recipe', () => {
    const state = createNewGame(42);
    addToInventory(state.player.inventory, 'ration_pack', 1);
    expect(resolveShelterAction(state, 'care').ok).toBe(true);

    const repairState = createNewGame(42);
    addToInventory(repairState.player.inventory, 'wood', 2);
    addToInventory(repairState.player.inventory, 'tape', 1);
    expect(resolveShelterAction(repairState, 'repair').ok).toBe(true);
    expect(repairState.player.homeUpgrades).toContain('reinforced_door');
  });

  it('requires a resolved shelter action before sleep and advances to next day', () => {
    const state = createNewGame(42);
    state.gameMinuteOfDay = 1200;
    expect(finishNight(state).ok).toBe(false);
    resolveShelterAction(state, 'rest');
    const result = finishNight(state);
    expect(result.ok).toBe(true);
    expect(state.day).toBe(2);
    expect(state.gameMinuteOfDay).toBe(360);
    expect(state.shelterPlan).toBeUndefined();
    expect(state.diary?.some((event) => event.kind === 'shelter_rested')).toBe(true);
  });

  it('rest clears sleep-cured ailments during the night settlement', () => {
    const state = createNewGame(42);
    state.gameMinuteOfDay = 1200;
    inflict(state, 'cold', 40, 360);
    resolveShelterAction(state, 'rest');
    const result = finishNight(state);
    expect(result.healedAilments).toEqual(['cold']);
    expect(state.player.ailments).toEqual([]);
  });
});
