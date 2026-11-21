import type { CombatAction, CombatRound } from '../systems/combat';

export interface CombatFeedbackSignals {
  /** Attacks always animate, including misses. */
  swing: boolean;
  /** A contact spark is shown only for a confirmed, non-lethal player hit. */
  hitSpark: boolean;
  /** The player receives a visual response only when the round reports damage. */
  playerHurt: boolean;
  parry: boolean;
}

/**
 * Derive presentation cues from an already-resolved round. This is deliberately
 * read-only: it cannot roll, alter combat values, or affect who wins the turn.
 */
export function combatFeedbackSignals(round: CombatRound, action: CombatAction): CombatFeedbackSignals {
  const playerHurt = round.monsterDamage > 0 && !round.fled;
  return {
    swing: action === 'attack',
    hitSpark: action === 'attack' && round.playerDamage > 0 && !round.monsterDead,
    playerHurt,
    parry: action === 'guard' && playerHurt,
  };
}
