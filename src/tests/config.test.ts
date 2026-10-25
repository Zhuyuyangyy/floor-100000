import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../core/config';

describe('game-balance config', () => {
  it('loads with schemaVersion 1', () => {
    expect(GAME_CONFIG.schemaVersion).toBe(1);
  });

  it('declares the 5 playable v0.1 floors including 100000', () => {
    expect(GAME_CONFIG.world.playableFloorsV01).toEqual([100000, 99999, 99998, 99997, 99996]);
    expect(GAME_CONFIG.world.playableFloorsV01).toContain(100000);
  });

  it('starting items match the GDD baseline exactly', () => {
    expect(GAME_CONFIG.inventory.slotCount).toBe(12);
    expect(GAME_CONFIG.inventory.startingItems).toEqual([
      { itemId: 'clean_water', displayName: '净水', quantity: 3 },
      { itemId: 'ration_pack', displayName: '压缩口粮', quantity: 2 },
      { itemId: 'flashlight', displayName: '低电量手电', quantity: 1, batteryState: 'low' },
    ]);
  });

  it('starting player stats match config', () => {
    expect(GAME_CONFIG.player.hpStart).toBe(100);
    expect(GAME_CONFIG.player.startingFloor).toBe(100000);
  });
});
