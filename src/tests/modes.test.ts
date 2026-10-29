import { describe, expect, it } from 'vitest';

import { MODE_LABELS, modeDecayMult, modeGuardianDamageMult, modeLabel, modeScoreMult } from '../systems/modes';

// Wave B2: the three modes are pure multipliers over shipped rules. These pin
// the numbers so a mode can never silently fork the rules.

describe('run modes', () => {
  it('labels all three modes', () => {
    expect(modeLabel('quick')).toBe('快速跑');
    expect(modeLabel('adventure')).toBe('冒险');
    expect(modeLabel('easy')).toBe('简单');
  });

  it('keeps adventure at the shipped baseline', () => {
    expect(modeDecayMult('adventure')).toBe(1);
    expect(modeScoreMult('adventure')).toBe(1);
    expect(modeGuardianDamageMult('adventure')).toBe(1);
  });

  it('tightens quick on decay and pays it back on score', () => {
    expect(modeDecayMult('quick')).toBe(1.5);
    expect(modeScoreMult('quick')).toBe(1.5);
    // Quick does not soften the guardian — the pressure is the point.
    expect(modeGuardianDamageMult('quick')).toBe(1);
  });

  it('softens easy on decay and on the guardian', () => {
    expect(modeDecayMult('easy')).toBe(0.7);
    expect(modeGuardianDamageMult('easy')).toBe(0.7);
    // Easy pays no score premium.
    expect(modeScoreMult('easy')).toBe(1);
  });

  it('orders the modes by decay pressure', () => {
    expect(modeDecayMult('quick')).toBeGreaterThan(modeDecayMult('adventure'));
    expect(modeDecayMult('adventure')).toBeGreaterThan(modeDecayMult('easy'));
  });

  it('has a label for every mode', () => {
    for (const m of ['quick', 'adventure', 'easy'] as const) {
      expect(MODE_LABELS[m]).toBeTruthy();
    }
  });
});
