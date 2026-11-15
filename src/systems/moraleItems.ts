import type { Item } from '../core/gameTypes';
import { deriveSeed, makeRng } from '../core/rng';

// 物品心情效果（契约第四节 moraleDelta/moraleChance 的消费侧，AG-29 属主）。
//
// TWOM 模型（twom-reverse/docs/TWOM_MECHANICS.md §2）：
//   GetDepressionChangeOnCheer(Item*, Item*) —— "拿 A 对 B 使用"产生心情
//   变化，烟、酒、咖啡、书、收音机的统一入口；
//   EffectMoraleProbabilities —— 效果不是确定的，按概率掷。
// 本文件是这两条的纯函数落地：只读 Item 的 moraleDelta/moraleChance 两个
// 字段，不碰 GameState、不写任何状态——谁消费谁接线。
//
// 建议的接入点（AG-25，SurvivalSystem/InventorySystem 属主 morale）：
//   useConsumable(state, itemId) 返回 ok 之后、grantGrowthXp 附近，调
//     const fx = moraleEffectOf(item, state.runSeed, state.day);
//     if (fx.applied) state.morale += fx.delta;  // 或按 AG-25 的 applyMoraleDelta
//   seed 传入 runSeed、day 传入 state.day；若想让同一物品同一天多次使用
//   各有一次独立判定，把 seed 换成 deriveSeed(runSeed, day, 'cheer', minute)
//   之类的复合值即可——本函数只认 (seed, day, item.id) 三元组。
//
// 禁 Math.random：概率走 core/rng.ts 的 deriveSeed/makeRng（xorshift32），
// 同 (seed, day, item) 必然同结果（可复现、可存档）。

export interface MoraleEffect {
  /** 本次实际生效的心情点数变化；未生效为 0。直接加到 morale 点数池上。 */
  delta: number;
  /** 概率是否掷中。false 时 delta 恒为 0。 */
  applied: boolean;
}

/** 无心情效果物品的恒定返回值（配了 moraleDelta 才算有）。 */
const NO_EFFECT: MoraleEffect = { delta: 0, applied: false };

/**
 * 一件物品使用后的心情效果。语义（对应 TWOM 的 DepressionChangeOnCheer +
 * EffectMoraleProbabilities）：
 *
 * - `moraleDelta` 缺省或为 0 → 无效果（`{ delta: 0, applied: false }`）；
 * - `moraleChance` 缺省视为 1（配了 delta 就会生效，除非显式配概率），
 *   取值夹取到 [0, 1]：0 = 必不生效，1 = 必生效；
 * - 生效判定 = makeRng(deriveSeed(seed, day, 'morale-cheer', item.id))
 *   的 chance(moraleChance)，同 (seed, day, item) 必同结果，跨天真的不同。
 */
export function moraleEffectOf(item: Item, seed: number, day: number): MoraleEffect {
  const delta = item.moraleDelta ?? 0;
  if (delta === 0) return NO_EFFECT;
  const chance = Math.min(1, Math.max(0, item.moraleChance ?? 1));
  if (chance <= 0) return NO_EFFECT;
  const rng = makeRng(deriveSeed(seed, day, 'morale-cheer', item.id));
  if (!rng.chance(chance)) return NO_EFFECT;
  return { delta, applied: true };
}
