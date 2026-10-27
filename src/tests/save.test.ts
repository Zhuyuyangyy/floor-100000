import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { SCHEMA_VERSION } from '../core/constants';
import { GAME_CONFIG } from '../core/config';
import { deserialize, saveFailureCount, saveToStorage, serialize, validateGameState } from '../systems/SaveSystem';
import { getFloorView } from '../systems/LootSystem';
import { tryContinue } from '../core/session';
import type { GameState } from '../core/gameTypes';

// A structurally complete but hand-built save (nothing derived from
// createNewGame). Proves the validator checks the whole GameState shape rather
// than only the handful of fields it happened to look at (GHI-03 C1).
function completeSave(): Record<string, unknown> {
  return {
    schemaVersion: SCHEMA_VERSION,
    runSeed: 42,
    day: 1,
    gameMinuteOfDay: 360,
    currentFloor: 1,
    status: 'playing',
    player: {
      x: 640,
      hp: 100,
      hunger: 80,
      thirst: 80,
      energy: 80,
      equipped: null,
      homeUpgrades: [],
      inventory: { slotCount: 12, slots: [] },
    },
    npcStates: {},
    visitedFloors: {},
    worldEvents: { history: [], activeEvent: null },
  };
}

function without(obj: Record<string, unknown>, path: string): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
  const parts = path.split('.');
  let cur: Record<string, unknown> = clone;
  for (const p of parts.slice(0, -1)) cur = cur[p] as Record<string, unknown>;
  delete cur[parts[parts.length - 1]];
  return clone;
}

describe('save round-trip', () => {
  it('serialize -> deserialize preserves state exactly', () => {
    const state = createNewGame(2026);
    const result = deserialize(serialize(state));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state).toEqual(state);
  });
});

describe('bad saves fail gracefully (never throw)', () => {
  it('rejects invalid JSON', () => {
    const r = deserialize('{ not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('损坏');
  });

  it('rejects a wrong schemaVersion', () => {
    const state = { ...createNewGame(1), schemaVersion: 999 };
    expect(deserialize(serialize(state)).ok).toBe(false);
  });

  it('rejects out-of-range hp', () => {
    const state = createNewGame(1);
    state.player.hp = 150;
    expect(validateGameState(state).length).toBeGreaterThan(0);
    expect(deserialize(serialize(state)).ok).toBe(false);
  });

  it('rejects an unknown item in the inventory', () => {
    const state = createNewGame(1);
    (state.player.inventory.slots as unknown[]).push({ itemId: 'unobtainium', quantity: 1 });
    expect(deserialize(serialize(state)).ok).toBe(false);
  });

  it('rejects a missing player object', () => {
    const state = createNewGame(1) as unknown as Record<string, unknown>;
    delete state.player;
    expect(validateGameState(state).some((e) => e.includes('player'))).toBe(true);
  });
});

// GHI-03 C1: fields the game actually reads were never validated, so a save
// could pass validation and then crash getFloorView() -> white screen.
describe('save validation covers the whole GameState shape (GHI-03 C1)', () => {
  it('accepts a structurally complete save', () => {
    expect(validateGameState(completeSave())).toEqual([]);
    expect(deserialize(serialize(completeSave() as unknown as GameState)).ok).toBe(true);
  });

  it('accepts a real new game', () => {
    expect(validateGameState(createNewGame(42))).toEqual([]);
  });

  it('rejects a save missing visitedFloors', () => {
    expect(validateGameState(without(completeSave(), 'visitedFloors')).length).toBeGreaterThan(0);
  });

  it('rejects a save with visitedFloors: null', () => {
    const s = completeSave();
    s.visitedFloors = null;
    expect(validateGameState(s).length).toBeGreaterThan(0);
  });

  it('rejects a save missing worldEvents', () => {
    expect(validateGameState(without(completeSave(), 'worldEvents')).length).toBeGreaterThan(0);
  });

  it('rejects a save with a malformed activeEvent', () => {
    const s = completeSave();
    (s.worldEvents as Record<string, unknown>).activeEvent = { type: 'meteor', message: 5 };
    expect(validateGameState(s).length).toBeGreaterThan(0);
  });

  it('rejects a save missing player.x', () => {
    expect(validateGameState(without(completeSave(), 'player.x')).length).toBeGreaterThan(0);
  });

  it('rejects a save with a non-finite player.x', () => {
    const s = completeSave();
    (s.player as Record<string, unknown>).x = null;
    expect(validateGameState(s).length).toBeGreaterThan(0);
  });

  it('rejects a save missing npcStates', () => {
    expect(validateGameState(without(completeSave(), 'npcStates')).length).toBeGreaterThan(0);
  });

  it('rejects a save missing player.homeUpgrades', () => {
    expect(validateGameState(without(completeSave(), 'player.homeUpgrades')).length).toBeGreaterThan(0);
  });

  it('rejects a save with an unknown equipped item', () => {
    const s = completeSave();
    (s.player as Record<string, unknown>).equipped = 'unobtainium';
    expect(validateGameState(s).length).toBeGreaterThan(0);
  });
});

// GHI-03 C2: currentFloor was only checked for being an integer.
describe('save validation pins currentFloor to the playable range (GHI-03 C2)', () => {
  it('rejects a floor far outside the range', () => {
    const s = completeSave();
    s.currentFloor = 5000;
    expect(validateGameState(s).length).toBeGreaterThan(0);
  });

  it('rejects a floor just below the playable range', () => {
    const s = completeSave();
    s.currentFloor = 99995;
    expect(validateGameState(s).length).toBeGreaterThan(0);
  });

  it('accepts every playable floor', () => {
    for (const f of [1, 2, 3, 4, 5]) {
      const s = completeSave();
      s.currentFloor = f;
      expect(validateGameState(s), `floor ${f}`).toEqual([]);
    }
  });
});

// GHI-03 blind spot: nothing guaranteed that an accepted save is consumable.
describe('an accepted save is consumable by the floor system', () => {
  it('getFloorView never throws on an accepted save', () => {
    const s = completeSave() as unknown as GameState;
    expect(validateGameState(s)).toEqual([]);
    expect(() => getFloorView(s, s.currentFloor)).not.toThrow();
  });

  it('getFloorView never throws on an accepted save for every playable floor', () => {
    for (const f of [1, 2, 3, 4, 5]) {
      const s = completeSave() as unknown as GameState;
      s.currentFloor = f;
      expect(validateGameState(s), `floor ${f}`).toEqual([]);
      expect(() => getFloorView(s, f), `floor ${f}`).not.toThrow();
    }
  });
});

// GHI-03 M4: a corrupt save must report why, so the menu can tell the user
// instead of silently doing nothing.
// GHI-03 M1/M2 changed both the loot key format and the seed derivation, so a
// save written before 63ee148 would pass validation and then silently mismatch:
// its index-style looted keys match nothing, looted items respawn and containers
// roll fresh contents. SCHEMA_VERSION was bumped so those saves are refused with
// a readable reason instead.
describe('saves from before the loot-key migration (GHI-03 M1/M2)', () => {
  function legacySave(): Record<string, unknown> {
    return {
      ...completeSave(),
      schemaVersion: 1,
      day: 2,
      currentFloor: 3,
      visitedFloors: {
        3: {
          openedContainers: ['crate_wood'],
          lootedItems: ['g:0', 'c:crate_wood:0'],
          unlockedDoors: [],
          localEvents: [],
        },
      },
    };
  }

  it('rejects a pre-migration save', () => {
    expect(validateGameState(legacySave()).some((e) => e.includes('不支持的存档版本'))).toBe(true);
    const r = deserialize(serialize(legacySave() as unknown as GameState));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('存档损坏');
  });

  it('names the version it needs so the message is actionable', () => {
    const r = deserialize(serialize(legacySave() as unknown as GameState));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(`需要 ${SCHEMA_VERSION}`);
  });

  it('accepts a save at the current version', () => {
    expect(validateGameState(completeSave())).toEqual([]);
    expect(deserialize(serialize(completeSave() as unknown as GameState)).ok).toBe(true);
  });
});

// GHI-03 m3: the stat range was a hardcoded 0..100 while the real ceilings come
// from config/game-balance.json, so tuning hpMax would have made the validator
// reject legitimately-saved runs.
describe('stat bounds follow the balance config (GHI-03 m3)', () => {
  it('accepts each stat at its configured maximum and rejects one above it', () => {
    const s = completeSave();
    const p = s.player as Record<string, unknown>;
    const maxima: Array<[string, number]> = [
      ['hp', GAME_CONFIG.player.hpMax],
      ['hunger', GAME_CONFIG.player.hungerMax],
      ['thirst', GAME_CONFIG.player.thirstMax],
      ['energy', GAME_CONFIG.player.energyMax],
    ];
    for (const [key, max] of maxima) {
      p[key] = max;
      expect(validateGameState(s), `${key} at max`).toEqual([]);
      p[key] = max + 1;
      expect(validateGameState(s).some((e) => e.includes(`player.${key}`)), `${key} above max`).toBe(true);
      p[key] = max;
    }
  });
});

// GHI-03 m5: the autosave added for M3 runs from update(), so a throwing
// setItem (quota, private mode) would break the frame loop instead of just
// failing to persist.
describe('saveToStorage never throws (GHI-03 m5)', () => {
  function fakeStorage(fail: boolean): Storage {
    let stored: string | null = null;
    return {
      length: stored === null ? 0 : 1,
      clear: () => {
        stored = null;
      },
      getItem: () => stored,
      key: () => null,
      removeItem: () => {
        stored = null;
      },
      setItem: (_k: string, v: string) => {
        if (fail) throw new Error('QuotaExceededError');
        stored = v;
      },
    };
  }

  it('reports failure instead of throwing when the write is rejected', () => {
    expect(saveToStorage(createNewGame(1), fakeStorage(true))).toBe(false);
  });

  it('reports success when the write lands', () => {
    expect(saveToStorage(createNewGame(1), fakeStorage(false))).toBe(true);
  });
});

// B3-01 D9: every call site ignored the boolean, so a rejected write was silent
// and the player lost the run without being told. The count is what makes the
// failure visible — the scene polls it and warns when it grows.
describe('a rejected write is counted, not just returned (B3-01 D9)', () => {
  function fakeStorage(fail: boolean): Storage {
    let stored: string | null = null;
    return {
      length: stored === null ? 0 : 1,
      clear: () => {
        stored = null;
      },
      getItem: () => stored,
      key: () => null,
      removeItem: () => {
        stored = null;
      },
      setItem: (_k: string, v: string) => {
        if (fail) throw new Error('QuotaExceededError');
        stored = v;
      },
    };
  }

  it('counts each rejected write and none of the accepted ones', () => {
    const before = saveFailureCount();
    expect(saveToStorage(createNewGame(1), fakeStorage(false))).toBe(true);
    expect(saveFailureCount()).toBe(before);

    expect(saveToStorage(createNewGame(1), fakeStorage(true))).toBe(false);
    expect(saveFailureCount()).toBe(before + 1);

    expect(saveToStorage(createNewGame(1), fakeStorage(true))).toBe(false);
    expect(saveFailureCount()).toBe(before + 2);
  });

  it('starts at zero for a fresh page, so a clean run never warns', () => {
    // The count is per page load: it exists to notice a *new* failure, not to
    // nag about one the player has already been told about.
    expect(saveFailureCount()).toBeGreaterThanOrEqual(0);
    const before = saveFailureCount();
    saveToStorage(createNewGame(1), fakeStorage(false));
    expect(saveFailureCount()).toBe(before);
  });
});

describe('tryContinue reports why a save is unusable (GHI-03 M4)', () => {
  function fakeStorage(raw: string | null): Storage {
    return {
      length: raw === null ? 0 : 1,
      clear: () => {},
      getItem: () => raw,
      key: () => null,
      removeItem: () => {},
      setItem: () => {},
    };
  }

  it('returns the reason for a corrupt save rather than null', () => {
    const r = tryContinue(fakeStorage('{ not json'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('损坏');
  });

  it('returns the reason when there is no save at all', () => {
    const r = tryContinue(fakeStorage(null));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeTruthy();
  });

  it('loads a valid save and hands back the state', () => {
    const r = tryContinue(fakeStorage(serialize(createNewGame(7))));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.runSeed).toBe(7);
  });
});

