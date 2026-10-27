import { describe, expect, it } from 'vitest';
import { addToInventory, createInventory, createNewGame } from '../core/gameState';
import { SCHEMA_VERSION } from '../core/constants';
import { GAME_CONFIG } from '../core/config';

describe('createNewGame', () => {
  it('starts at floor 1, day 1, 06:00, playing, with the given seed', () => {
    const s = createNewGame(42);
    expect(s.currentFloor).toBe(1);
    expect(s.day).toBe(1);
    expect(s.gameMinuteOfDay).toBe(GAME_CONFIG.time.dayStartMinute);
    expect(s.status).toBe('playing');
    expect(s.schemaVersion).toBe(SCHEMA_VERSION);
    expect(s.runSeed).toBe(42);
  });

  it('initial items exactly match config (3 water, 2 ration, 1 flashlight low)', () => {
    const s = createNewGame(1);
    expect(s.player.inventory.slots).toEqual([
      { itemId: 'clean_water', quantity: 3 },
      { itemId: 'ration_pack', quantity: 2 },
      { itemId: 'flashlight', quantity: 1, meta: { batteryState: 'low' } },
    ]);
  });

  it('initial survival stats exactly match config', () => {
    const s = createNewGame(7);
    const p = GAME_CONFIG.player;
    expect(s.player.hp).toBe(p.hpStart);
    expect(s.player.hunger).toBe(p.hungerStart);
    expect(s.player.thirst).toBe(p.thirstStart);
    expect(s.player.energy).toBe(p.energyStart);
  });
});

describe('addToInventory stacking', () => {
  it('stacks identical ids and throws when the 2-slot bag is full', () => {
    const inv = createInventory(2);
    addToInventory(inv, 'wood', 5);
    addToInventory(inv, 'wood', 3);
    expect(inv.slots).toEqual([{ itemId: 'wood', quantity: 8 }]);
    addToInventory(inv, 'scrap_metal', 1);
    expect(inv.slots).toHaveLength(2);
    expect(() => addToInventory(inv, 'tape', 1)).toThrow();
  });

  it('keeps non-stackable tools in separate slots', () => {
    const inv = createInventory(4);
    addToInventory(inv, 'flashlight', 1);
    addToInventory(inv, 'crowbar', 1);
    expect(inv.slots).toEqual([
      { itemId: 'flashlight', quantity: 1 },
      { itemId: 'crowbar', quantity: 1 },
    ]);
  });
});
