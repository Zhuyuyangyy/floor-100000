import { describe, expect, it } from 'vitest';

import {
  CHARACTER_UNLOCKS,
  CHARACTER_NAMES,
  MODES,
  applyDepth,
  canSelect,
  freshMeta,
  loadMeta,
  saveMeta,
  unlockFromDepth,
} from '../systems/metaProgress';

// A tiny in-memory Storage so the tests never touch the real localStorage.
function memStorage(seed?: string): Storage {
  const map = new Map<string, string>();
  if (seed !== undefined) map.set('floor100000.meta.v1', seed);
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

describe('meta progress', () => {
  it('starts with only the player unlocked', () => {
    const m = freshMeta();
    expect(m.unlockedCharacters).toEqual(['player']);
    expect(m.selectedCharacter).toBe('player');
    expect(m.bestDepth).toBe(0);
    expect(m.mode).toBe('adventure');
    expect(m.relics).toEqual([]);
  });

  it('falls back to a fresh meta on a corrupt file', () => {
    expect(loadMeta(memStorage('not json at all'))).toEqual(freshMeta());
    expect(loadMeta(memStorage('[]'))).toEqual(freshMeta());
  });

  it('repairs a half-written meta instead of rejecting it', () => {
    const storage = memStorage(JSON.stringify({ selectedCharacter: 'npc_alin', bestDepth: 3 }));
    const m = loadMeta(storage);
    // npc_alin was never unlocked, so the selection falls back to the player.
    expect(m.selectedCharacter).toBe('player');
    expect(m.unlockedCharacters).toEqual(['player']);
    expect(m.bestDepth).toBe(3);
  });

  it('keeps a valid selection and a valid mode', () => {
    const storage = memStorage(
      JSON.stringify({ unlockedCharacters: ['player', 'npc_alin'], selectedCharacter: 'npc_alin', mode: 'quick', relics: ['x'] }),
    );
    const m = loadMeta(storage);
    expect(m.selectedCharacter).toBe('npc_alin');
    expect(m.mode).toBe('quick');
    expect(m.relics).toEqual(['x']);
  });

  it('rejects an unknown mode', () => {
    const storage = memStorage(JSON.stringify({ mode: 'nightmare' }));
    expect(loadMeta(storage).mode).toBe('adventure');
  });

  it('unlocks nobody at depth 1', () => {
    expect(applyDepth(freshMeta(), 1)).toEqual([]);
  });

  it('unlocks the neighbour at depth 2 and the kid at 3', () => {
    expect(applyDepth(freshMeta(), 2)).toEqual(['npc_alin']);
    expect(applyDepth(freshMeta(), 3)).toEqual(['npc_alin', 'npc_xiaozhou']);
    expect(applyDepth(freshMeta(), 5)).toEqual(['npc_alin', 'npc_xiaozhou', 'wanderer']);
  });

  it('never re-announces an unlock', () => {
    const m = unlockFromDepth(freshMeta(), 3);
    expect(applyDepth(m, 3)).toEqual([]);
  });

  it('unlockFromDepth is pure and monotonic in bestDepth', () => {
    const a = freshMeta();
    const b = unlockFromDepth(a, 4);
    expect(a.bestDepth).toBe(0); // input untouched
    expect(b.bestDepth).toBe(4);
    expect(b.unlockedCharacters).toContain('npc_alin');
    const c = unlockFromDepth(b, 2); // a shallower run must not lower the record
    expect(c.bestDepth).toBe(4);
  });

  it('gates selection on the unlock', () => {
    const m = freshMeta();
    expect(canSelect(m, 'player')).toBe(true);
    expect(canSelect(m, 'wanderer')).toBe(false);
    expect(canSelect(unlockFromDepth(m, 5), 'wanderer')).toBe(true);
  });

  it('round-trips through the storage', () => {
    const storage = memStorage();
    const m = unlockFromDepth(freshMeta(), 3);
    saveMeta(m, storage);
    expect(loadMeta(storage)).toEqual(m);
  });

  it('survives a storage that refuses to write', () => {
    const hostile = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    } as unknown as Storage;
    expect(() => saveMeta(freshMeta(), hostile)).not.toThrow();
    expect(loadMeta(hostile)).toEqual(freshMeta());
  });

  it('covers all four characters with names and unlock depths', () => {
    expect(Object.keys(CHARACTER_UNLOCKS).sort()).toEqual(['npc_alin', 'npc_xiaozhou', 'player', 'wanderer']);
    expect(Object.keys(CHARACTER_NAMES).sort()).toEqual(Object.keys(CHARACTER_UNLOCKS).sort());
    expect(CHARACTER_UNLOCKS.player).toBe(0);
    expect(MODES).toEqual(['quick', 'adventure', 'easy']);
  });
});
