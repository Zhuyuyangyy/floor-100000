import { describe, expect, it } from 'vitest';
import { PLAYABLE_SEGMENTS } from '../core/segments';
import { hasFloorContent } from '../data/floorTemplates';
import { assertGameBalanceConfig, GAME_CONFIG } from '../core/config';
import { PLAYABLE_FLOORS_V01 } from '../core/constants';

describe('game-balance config', () => {
  it('loads with schemaVersion 1', () => {
    expect(GAME_CONFIG.schemaVersion).toBe(1);
  });

  it('declares exactly the authored segments, with no holes inside a segment', () => {
    const floors = GAME_CONFIG.world.playableFloorsV01;
    // The config used to be a single contiguous run and this test asserted 1..N.
    // The tower is segmented now (1-10, then 100-110), so the honest assertion is
    // that config and core/segments agree: every floor of every segment, in order,
    // nothing between them. A hole inside a segment is a bug; a gap between
    // segments is the point.
    // Only the segments that actually have floors: the tower declares six, and
    // config lists the authored ones. Comparing against all six would fail on the
    // four segments nobody has built yet.
    const authored = PLAYABLE_SEGMENTS.filter((seg) => hasFloorContent(seg.from));
    const expected = authored.flatMap((seg) =>
      Array.from({ length: seg.to - seg.from + 1 }, (_, i) => seg.from + i),
    );
    expect(floors).toEqual(expected);
    expect(new Set(floors).size).toBe(floors.length);
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
    expect(GAME_CONFIG.player.startingFloor).toBe(1);
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
      assertGameBalanceConfig(mutated((c) => { at(c, 'world').playableFloorsV01 = [1, 'nope']; })),
    ).toThrow(/playableFloorsV01/);
  });

  it('rejects a malformed starting-items list', () => {
    expect(() => assertGameBalanceConfig(mutated((c) => { at(c, 'inventory').startingItems = 'none'; }))).toThrow(/startingItems/);
  });
});
