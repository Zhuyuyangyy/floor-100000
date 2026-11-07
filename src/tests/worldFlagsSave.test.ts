import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { validateGameState } from '../systems/SaveSystem';
import { bumpFlag, flagKey, setFlag } from '../systems/WorldFlags';

// The flag store is optional, so the save validator has to accept both shapes:
// a save written before the system (absent) and one after (numbers). Rejecting
// the absent case would make every existing save unloadable.
describe('save validation accepts the flag store', () => {
  it('a save with no flags at all is valid', () => {
    const s = createNewGame(1);
    delete s.flags;
    expect(validateGameState(s)).toEqual([]);
  });

  it('a save with flags is valid', () => {
    const s = createNewGame(1);
    setFlag(s, flagKey.once('goal-paid:1'));
    bumpFlag(s, 'hits', 2);
    expect(validateGameState(s)).toEqual([]);
  });

  it('a non-number flag value is rejected', () => {
    const s = createNewGame(1);
    s.flags = { 'once:a': 'yes' as unknown as number };
    const errors = validateGameState(s);
    expect(errors.some((e) => e.includes('flags.once:a'))).toBe(true);
  });

  it('a non-object flag store is rejected', () => {
    const s = createNewGame(1);
    s.flags = 7 as unknown as Record<string, number>;
    expect(validateGameState(s).some((e) => e === 'flags 无效')).toBe(true);
  });
});
