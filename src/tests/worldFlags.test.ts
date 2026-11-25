import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import {
  bumpFlag,
  clearFlag,
  flagCount,
  flagKey,
  hasFlag,
  once,
  setFlag,
} from '../systems/WorldFlags';
import type { GameState } from '../core/gameTypes';

// A fresh run, with the flags store removed so the "old save" path is exercised.
function fresh(): GameState {
  const s = createNewGame(42);
  delete s.flags;
  return s;
}

describe('world flags', () => {
  it('starts absent on a save written before the system existed', () => {
    const s = fresh();
    expect(s.flags).toBeUndefined();
    expect(hasFlag(s, 'anything')).toBe(false);
    expect(flagCount(s, 'anything')).toBe(0);
  });

  it('creates the store on first write rather than requiring one', () => {
    const s = fresh();
    setFlag(s, 'story:met-trader');
    expect(s.flags).toBeDefined();
    expect(hasFlag(s, 'story:met-trader')).toBe(true);
  });

  it('sets, reads and clears', () => {
    const s = fresh();
    setFlag(s, 'a');
    expect(hasFlag(s, 'a')).toBe(true);
    expect(flagCount(s, 'a')).toBe(1);
    clearFlag(s, 'a');
    expect(hasFlag(s, 'a')).toBe(false);
    expect(flagCount(s, 'a')).toBe(0);
  });

  it('carries a count without a second structure', () => {
    const s = fresh();
    setFlag(s, 'kills', 3);
    expect(flagCount(s, 'kills')).toBe(3);
    expect(hasFlag(s, 'kills')).toBe(true);
  });

  it('bumps and returns the new total', () => {
    const s = fresh();
    expect(bumpFlag(s, 'hits')).toBe(1);
    expect(bumpFlag(s, 'hits')).toBe(2);
    expect(bumpFlag(s, 'hits', 5)).toBe(7);
    expect(flagCount(s, 'hits')).toBe(7);
  });

  it('once() fires exactly once per name', () => {
    const s = fresh();
    expect(once(s, 'once:goal-paid:1')).toBe(true);
    expect(once(s, 'once:goal-paid:1')).toBe(false);
    expect(once(s, 'once:goal-paid:1')).toBe(false);
    expect(flagCount(s, 'once:goal-paid:1')).toBe(1);
  });

  it('once() is per-name, not global', () => {
    const s = fresh();
    expect(once(s, 'once:a')).toBe(true);
    expect(once(s, 'once:b')).toBe(true);
    expect(once(s, 'once:a')).toBe(false);
  });

  it('namespaces keys so two systems cannot collide', () => {
    const s = fresh();
    // the same id under two prefixes is two different flags
    setFlag(s, flagKey.container('a'));
    expect(hasFlag(s, flagKey.upgrade('a'))).toBe(false);
    expect(hasFlag(s, flagKey.container('a'))).toBe(true);
    expect(flagKey.container('a')).toBe('box:a');
    expect(flagKey.upgrade('a')).toBe('upg:a');
    expect(flagKey.encounter('a')).toBe('enc:a');
    expect(flagKey.story('a')).toBe('story:a');
    expect(flagKey.once('a')).toBe('once:a');
  });

  it('clearing an absent flag is a no-op, not a crash', () => {
    const s = fresh();
    expect(() => clearFlag(s, 'never-set')).not.toThrow();
    expect(s.flags).toBeUndefined();
  });
});
