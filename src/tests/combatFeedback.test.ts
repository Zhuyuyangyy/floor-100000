import { describe, expect, it } from 'vitest';
import type { CombatRound } from '../systems/combat';
import { combatFeedbackSignals } from '../render/combatFeedback';

function round(overrides: Partial<CombatRound> = {}): CombatRound {
  return {
    playerDamage: 0,
    monsterDamage: 0,
    fled: false,
    monsterDead: false,
    playerDead: false,
    messages: [],
    ...overrides,
  };
}

describe('combat feedback signals are visual-only', () => {
  it('keeps the attack swing on a miss but shows no contact spark', () => {
    expect(combatFeedbackSignals(round(), 'attack')).toEqual({
      swing: true,
      hitSpark: false,
      playerHurt: false,
      parry: false,
    });
  });

  it('shows a generic hit spark only after a non-lethal confirmed hit', () => {
    expect(combatFeedbackSignals(round({ playerDamage: 3 }), 'attack').hitSpark).toBe(true);
    expect(combatFeedbackSignals(round({ playerDamage: 3, monsterDead: true }), 'attack').hitSpark).toBe(false);
  });

  it('flashes the player only on reported incoming damage and retains guard parry feedback', () => {
    expect(combatFeedbackSignals(round({ monsterDamage: 1 }), 'attack').playerHurt).toBe(true);
    expect(combatFeedbackSignals(round({ monsterDamage: 1 }), 'guard').parry).toBe(true);
    expect(combatFeedbackSignals(round({ monsterDamage: 1, fled: true }), 'flee').playerHurt).toBe(false);
  });

  it('does not mutate the resolved round', () => {
    const result = round({ playerDamage: 3, monsterDamage: 1 });
    const before = JSON.stringify(result);
    combatFeedbackSignals(result, 'attack');
    expect(JSON.stringify(result)).toBe(before);
  });
});
