// Morale: the fourth dimension, and the first that is a pool rather than a bar.
//
// Hunger, thirst, energy and body heat are 0..100 slots that only ever drain.
// This War of Mine's emotional model is different (docs/reference/TWOM_MECHANICS.md
// §2): the main stat is Depression — a *points pool* that fades toward a baseline,
// moves by items, by witnessed death, and by how a scavenging run went home — and
// several of those moves are probabilistic rolls, not certainties. Anger is a
// separate pool (AngryPoints) and is deliberately NOT in this file yet: see
// docs/plans/TWOM_ALIGNMENT.md's AG-25 notes for why it is a follow-up.
//
// Five mechanisms, one per row of the TWOM table:
//
//   基线+每日变化   DefaultDepression / DepressionChangeOnDayBegin
//   物品提振        DepressionChangeOnCheer（消费 moraleDelta/moraleChance，
//                  AG-29 填物品数据，本文件定消费逻辑）
//   概率生效        EffectMoraleProbabilities（seeded RNG，禁 Math.random）
//   创伤概率        KosovoMoraleTraumaProbability（目睹死亡/被袭击时掷）
//   高/低士气归来   BackFromScavenge_CameBackHigher/LowerMorale
//
// Everything here is a pure function of GameState: no Phaser, no DOM, no
// Math.random (docs/02_TECH_SPEC.md §3). The same (runSeed, day, minute, salt)
// always rolls the same way, so a run is reproducible and the rolls are testable.

import { SURVIVAL_BALANCE } from '../core/constants';
import { deriveSeed, makeRng } from '../core/rng';
import type { GameState } from '../core/gameTypes';

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

export interface MoraleTick {
  morale: number;
  baseline: number;
  /** the tick crossed above the good-morale line (a cheer landed) */
  cheered: boolean;
  /** the tick fell to/below the bad-morale line */
  becameLow: boolean;
}

// ── 访问器：缺字段补默认（ensureGrowth 模式）───────────────────────────────
// createNewGame 在 core/gameState.ts（不属 AG-25），老存档更没有这两个字段，
// 所以每个读者先过这里：缺失/残缺/越界都在读取时自愈并写回，之后原样返回。

/** The current pool. Can be negative; clamped to the configured bounds. */
export function moraleOf(state: GameState): number {
  const cfg = SURVIVAL_BALANCE.morale;
  const p = state.player;
  if (typeof p.morale !== 'number' || !Number.isFinite(p.morale)) p.morale = cfg.defaultMorale;
  p.morale = clamp(p.morale, cfg.moraleMin, cfg.moraleMax);
  return p.morale;
}

/** The baseline the pool fades toward; the day-begin change pushes it around. */
export function moraleBaselineOf(state: GameState): number {
  const cfg = SURVIVAL_BALANCE.morale;
  const p = state.player;
  if (typeof p.moraleBaseline !== 'number' || !Number.isFinite(p.moraleBaseline)) {
    p.moraleBaseline = cfg.defaultMorale;
  }
  p.moraleBaseline = clamp(p.moraleBaseline, cfg.moraleMin, cfg.moraleMax);
  return p.moraleBaseline;
}

// ── 机制一：基线 + 每日变化 ────────────────────────────────────────────────

/**
 * Day begin: the baseline drifts by DepressionChangeOnDayBegin. The war drags
 * the default mood down a point a day, so "nothing happened" is itself a slow
 * decline — the pool then fades toward the new baseline in tickMorale. Called
 * from every midnight crossing (SurvivalSystem's rollover loop and sleep both
 * cross days, so both go through here).
 */
export function beginDayMorale(state: GameState): void {
  const cfg = SURVIVAL_BALANCE.morale;
  state.player.moraleBaseline = clamp(moraleBaselineOf(state) + cfg.dayBeginChange, cfg.moraleMin, cfg.moraleMax);
}

/**
 * The fade: the pool moves toward the baseline by at most decayPerGameHour
 * points per game hour. A cheer above the baseline spends itself; a wound below
 * it heals — but only as far as the baseline, which is what makes the daily
 * drift matter.
 */
export function tickMorale(state: GameState, gameMinutes: number): MoraleTick {
  const cfg = SURVIVAL_BALANCE.morale;
  const before = moraleOf(state);
  const baseline = moraleBaselineOf(state);
  if (state.status !== 'playing' || gameMinutes <= 0) {
    return { morale: before, baseline, cheered: false, becameLow: false };
  }
  const step = cfg.decayPerGameHour * (gameMinutes / 60);
  let after = before;
  if (before > baseline) after = Math.max(baseline, before - step);
  else if (before < baseline) after = Math.min(baseline, before + step);
  state.player.morale = after;
  return {
    morale: after,
    baseline,
    cheered: before <= cfg.goodMorale && after > cfg.goodMorale,
    becameLow: before > cfg.badMorale && after <= cfg.badMorale,
  };
}

// ── 概率基础设施（机制三：EffectMoraleProbabilities）───────────────────────

// One deterministic roll per (run, day, minute, salt). The minute is floored so
// the same event inside the same game minute rolls once, and two different
// salts (cheer/trauma) in that minute never collide.
function moraleRoll(state: GameState, salt: string, probability: number): boolean {
  const rng = makeRng(deriveSeed(state.runSeed, state.day, Math.floor(state.gameMinuteOfDay), salt));
  return rng.chance(clamp(probability, 0, 1));
}

function applyMorale(state: GameState, delta: number): void {
  const cfg = SURVIVAL_BALANCE.morale;
  state.player.morale = clamp(moraleOf(state) + delta, cfg.moraleMin, cfg.moraleMax);
}

// ── 机制二：物品提振（DepressionChangeOnCheer）────────────────────────────

// The item shape this consumes, structurally: src/data/items.ts gains
// moraleDelta/moraleChance under AG-29 (TWOM_ALIGNMENT.md §4). Read through a
// structural type so this compiles before that data lands, and an item without
// the fields is simply not a cheer item.
export interface CheerItem {
  moraleDelta?: number;
  moraleChance?: number;
}

export interface CheerResult {
  /** the roll hit and the points moved */
  applied: boolean;
  /** the points actually applied (0 when the roll missed) */
  delta: number;
}

/**
 * Consuming a cheer item (coffee, a cigarette, a book, the radio): the delta is
 * rolled against moraleChance — 1 = certain, 0.5 = half the time. Returns what
 * happened so the caller can flash it. The item itself is spent by the caller
 * (InventorySystem.useConsumable owns consumption); this only moves the pool.
 */
export function cheerFromItem(state: GameState, item: CheerItem, itemId: string): CheerResult {
  const delta = item.moraleDelta;
  if (typeof delta !== 'number' || !Number.isFinite(delta) || delta === 0) {
    return { applied: false, delta: 0 };
  }
  const chance =
    typeof item.moraleChance === 'number' && Number.isFinite(item.moraleChance) ? item.moraleChance : 1;
  if (!moraleRoll(state, `morale-cheer:${itemId}`, chance)) return { applied: false, delta: 0 };
  applyMorale(state, delta);
  return { applied: true, delta };
}

// ── 机制四：创伤概率（KosovoMoraleTraumaProbability）───────────────────────

export interface TraumaResult {
  /** the roll hit: this event scarred the survivor */
  traumatised: boolean;
  /** the points actually applied (0 when the roll missed) */
  delta: number;
}

/**
 * Witnessed death / being attacked: a probability roll, not a certainty. The
 * same raid can leave one survivor steadier than another, which is the whole
 * point of the roll — and why it must be seeded, not Math.random.
 */
export function witnessTrauma(state: GameState): TraumaResult {
  const cfg = SURVIVAL_BALANCE.morale;
  if (!moraleRoll(state, 'morale-trauma', cfg.traumaProbability)) {
    return { traumatised: false, delta: 0 };
  }
  applyMorale(state, cfg.traumaDelta);
  return { traumatised: true, delta: cfg.traumaDelta };
}

// ── 机制五：高/低士气归来（BackFromScavenge_*）────────────────────────────

/**
 * Coming home from a run: a full bag lifts the pool, an empty one drops it, and
 * an ordinary haul changes nothing — the two TWOM directions, with the middle
 * left alone on purpose so the swing stays legible.
 */
export function backFromScavenge(state: GameState, lootCount: number): number {
  const cfg = SURVIVAL_BALANCE.morale;
  const delta =
    lootCount >= cfg.backFullLoad ? cfg.backHigherMorale : lootCount <= 0 ? cfg.backLowerMorale : 0;
  if (delta !== 0) applyMorale(state, delta);
  return delta;
}

// ── HUD/日记读数 ──────────────────────────────────────────────────────────

export type MoraleBand = 'high' | 'steady' | 'low';

export function moraleBandOf(state: GameState): MoraleBand {
  const cfg = SURVIVAL_BALANCE.morale;
  const m = moraleOf(state);
  if (m >= cfg.goodMorale) return 'high';
  if (m <= cfg.badMorale) return 'low';
  return 'steady';
}

export function moraleLabel(state: GameState): string {
  switch (moraleBandOf(state)) {
    case 'high':
      return '士气高涨';
    case 'low':
      return '情绪低落';
    default:
      return '情绪平稳';
  }
}
