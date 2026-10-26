import { describe, expect, it } from 'vitest';
import { assertGameBalanceConfig, GAME_CONFIG } from '../core/config';
import { PLAYABLE_FLOORS_V01 } from '../core/constants';

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

// GHI-03 m7: the playable floor list used to be hand-copied into constants.ts,
// so editing the JSON left the code on the old five floors.
describe('the playable floor list is derived, not hand-copied (GHI-03 m7)', () => {
  it('matches the balance config exactly', () => {
    expect(PLAYABLE_FLOORS_V01).toEqual(GAME_CONFIG.world.playableFloorsV01);
  });
});

// GHI-03 m8: GAME_CONFIG was an unchecked `as unknown as` cast, so a typo in the
// balance file surfaced as `undefined` deep inside createNewGame() instead of a
// clear startup error.
describe('config validation (GHI-03 m8)', () => {
  const shipped = (): Record<string, unknown> => JSON.parse(JSON.stringify(GAME_CONFIG)) as Record<string, unknown>;
  const mutated = (change: (c: Record<string, unknown>) => void): Record<string, unknown> => {
    const clone = shipped();
    change(clone);
    return clone;
  };
  const at = (c: Record<string, unknown>, path: string): Record<string, unknown> => {
    let cur = c;
    for (const part of path.split('.')) cur = cur[part] as Record<string, unknown>;
    return cur;
  };

  it('accepts the shipped balance file', () => {
    expect(() => assertGameBalanceConfig(shipped())).not.toThrow();
  });

  it('rejects a non-object', () => {
    expect(() => assertGameBalanceConfig(null)).toThrow();
    expect(() => assertGameBalanceConfig(42)).toThrow();
  });

  it('rejects an unsupported schemaVersion', () => {
    expect(() => assertGameBalanceConfig(mutated((c) => { c.schemaVersion = 99; }))).toThrow(/schemaVersion/);
  });

  it('rejects a missing balance number', () => {
    expect(() => assertGameBalanceConfig(mutated((c) => { delete at(c, 'player').hpStart; }))).toThrow(/hpStart/);
  });

  it('rejects a balance number of the wrong type', () => {
    expect(() =>
      assertGameBalanceConfig(mutated((c) => { at(c, 'player').thirstLossPerGameHour = 'lots'; })),
    ).toThrow(/thirstLossPerGameHour/);
  });

  it('rejects an empty or malformed playable floor list', () => {
    expect(() => assertGameBalanceConfig(mutated((c) => { at(c, 'world').playableFloorsV01 = []; }))).toThrow(/playableFloorsV01/);
    expect(() =>
      assertGameBalanceConfig(mutated((c) => { at(c, 'world').playableFloorsV01 = [100000, 'nope']; })),
    ).toThrow(/playableFloorsV01/);
  });

  it('rejects a malformed starting-items list', () => {
    expect(() => assertGameBalanceConfig(mutated((c) => { at(c, 'inventory').startingItems = 'none'; }))).toThrow(/startingItems/);
  });
});
