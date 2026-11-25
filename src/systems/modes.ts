import type { MetaProgress } from '../core/gameTypes';

// OVERHAUL Wave B2: the three run modes Altacima ships (quick run / adventure
// with autosave / easy). A mode is a set of multipliers over the survival and
// scoring rules, picked before every run on the character-select screen and
// persisted in the meta.
//
// Pure multipliers, no behaviour: every consumer (decay, score, the guardian)
// asks this module for its number, so a mode can never fork the rules.

export type RunMode = MetaProgress['mode'];

export const MODES: readonly RunMode[] = ['quick', 'adventure', 'easy'];

export const MODE_LABELS: Record<RunMode, string> = {
  quick: '快速跑',
  adventure: '冒险',
  easy: '简单',
};

export const MODE_BLURBS: Record<RunMode, string> = {
  quick: '饥渴衰减 ×1.5，得分 ×1.5——用更紧的预算换更高的分。',
  adventure: '标准规则。自动存档，死了就重来。',
  easy: '饥渴衰减 ×0.7，守门人伤害 ×0.7——先看清这座楼。',
};

// How much faster the survival stats drain. 1 is the shipped baseline.
export function modeDecayMult(mode: RunMode): number {
  switch (mode) {
    case 'quick':
      return 1.5;
    case 'easy':
      return 0.7;
    default:
      return 1;
  }
}

// Score multiplier applied on top of the depth-dominant formula.
export function modeScoreMult(mode: RunMode): number {
  return mode === 'quick' ? 1.5 : 1;
}

// The guardian hits softer on easy — the boss should still be a boss, just not
// a wall for a first run.
export function modeGuardianDamageMult(mode: RunMode): number {
  return mode === 'easy' ? 0.7 : 1;
}

// The label the HUD and the select screen show.
export function modeLabel(mode: RunMode): string {
  return MODE_LABELS[mode] ?? MODE_LABELS.adventure;
}
