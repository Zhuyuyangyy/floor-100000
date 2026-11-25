import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { validateGameState } from '../systems/SaveSystem';
import { BODY_TEMP_MAX, bodyTempOf } from '../systems/EnvironmentSystem';
import { bumpFlag, flagKey, setFlag } from '../systems/WorldFlags';
import { inflict } from '../systems/SicknessSystem';

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

describe('save validation accepts body heat', () => {
  it('a save with no bodyTemp at all is valid', () => {
    const s = createNewGame(1);
    delete s.player.bodyTemp;
    expect(validateGameState(s)).toEqual([]);
    // and the system re-creates it rather than treating it as missing data
    expect(bodyTempOf(s)).toBe(BODY_TEMP_MAX);
  });

  it('a save with bodyTemp is valid', () => {
    const s = createNewGame(1);
    s.player.bodyTemp = 62;
    expect(validateGameState(s)).toEqual([]);
  });

  it('an out-of-range bodyTemp is rejected', () => {
    const s = createNewGame(1);
    s.player.bodyTemp = BODY_TEMP_MAX + 1;
    expect(validateGameState(s).some((e) => e.includes('bodyTemp'))).toBe(true);
    s.player.bodyTemp = -1;
    expect(validateGameState(s).some((e) => e.includes('bodyTemp'))).toBe(true);
  });
});

describe('save validation accepts ailments', () => {
  it('a save with no ailments at all is valid', () => {
    const s = createNewGame(1);
    delete s.player.ailments;
    expect(validateGameState(s)).toEqual([]);
  });

  it('a save with ailments is valid', () => {
    const s = createNewGame(1);
    inflict(s, 'wound', 40, 0);
    expect(validateGameState(s)).toEqual([]);
  });

  it('an unknown ailment id is rejected', () => {
    const s = createNewGame(1);
    s.player.ailments = [{ id: 'plague' as unknown as 'wound', severity: 10, sinceMinute: 0 }];
    expect(validateGameState(s).some((e) => e.includes('未知病症'))).toBe(true);
  });

  it('an out-of-range severity is rejected', () => {
    const s = createNewGame(1);
    s.player.ailments = [{ id: 'wound', severity: 101, sinceMinute: 0 }];
    expect(validateGameState(s).some((e) => e.includes('severity'))).toBe(true);
  });
});
