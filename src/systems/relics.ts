import type { MetaProgress } from '../core/gameTypes';

// OVERHAUL Wave B3: relics — the passive boons both benchmarks tie to goals
// (Altacima's relics are bound to objectives; Centum's amulets and rings are
// the build-around of a run). Five relics, each unlocked by a depth record,
// each a single multiplier consumed by exactly one existing rule. A relic is
// data plus a number: no new system, no special cases in the loop.
//
// The run's active relics are copied from the meta at run start into
// state.relics (see GameState), so a save carries what was actually earned.

export type RelicId = 'water_heart' | 'iron_stomach' | 'swift_feet' | 'lucky_charm' | 'guardian_totem';

export interface RelicDef {
  id: RelicId;
  name: string;
  blurb: string;
  /** the depth record that unlocks it */
  unlockDepth: number;
}

export const RELICS: readonly RelicDef[] = [
  { id: 'water_heart', name: '水之心', blurb: '喝下的每一口水多补 50% 水分。', unlockDepth: 2 },
  { id: 'iron_stomach', name: '铁胃', blurb: '饥饿衰减降低 30%。', unlockDepth: 3 },
  { id: 'swift_feet', name: '疾行', blurb: '移动速度 +15%，走廊变得更短。', unlockDepth: 3 },
  { id: 'lucky_charm', name: '幸运符', blurb: '遭遇战利品多一件。', unlockDepth: 4 },
  { id: 'guardian_totem', name: '守护图腾', blurb: '守门人造成的伤害降低 30%。', unlockDepth: 5 },
];

// Which relics a depth record has earned. Pure — the caller persists the news.
export function relicsForDepth(depth: number, already: readonly string[]): RelicId[] {
  return RELICS.filter((r) => depth >= r.unlockDepth && !already.includes(r.id)).map((r) => r.id);
}

export function relicById(id: string): RelicDef | undefined {
  return RELICS.find((r) => r.id === id);
}

// ── the multipliers the rules ask for ──────────────────────────────────────
// Each takes the run's active relic list; an empty list is the vanilla game.

export function waterRestoreMult(relics: readonly string[]): number {
  return relics.includes('water_heart') ? 1.5 : 1;
}

export function hungerLossMult(relics: readonly string[]): number {
  return relics.includes('iron_stomach') ? 0.7 : 1;
}

export function moveSpeedMult(relics: readonly string[]): number {
  return relics.includes('swift_feet') ? 1.15 : 1;
}

export function lootBonus(relics: readonly string[]): number {
  return relics.includes('lucky_charm') ? 1 : 0;
}

export function guardianDamageMult(relics: readonly string[]): number {
  return relics.includes('guardian_totem') ? 0.7 : 1;
}

// The select screen's relic list: earned ones bright, locked ones showing the
// depth that opens them.
export function relicDisplay(meta: MetaProgress): Array<{ name: string; blurb: string; unlocked: boolean; need: number }> {
  return RELICS.map((r) => ({
    name: r.name,
    blurb: r.blurb,
    unlocked: meta.relics.includes(r.id),
    need: r.unlockDepth,
  }));
}
