import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import {
  GROWTH_MAX_LEVEL,
  addGrowthXp,
  carryCapacityBonus,
  createGrowthLine,
  createGrowthProfile,
  credentialRungs,
  ensureGrowth,
  favorRate,
  goldToFavorXp,
  grantGrowthXp,
  lineLevel,
  recipeAccessTier,
  statDrainMultiplier,
  tradePriceMultiplier,
  xpToNext,
} from '../core/growth';
import { deserialize, serialize } from '../systems/SaveSystem';
import type { GameState, GrowthLineId, GrowthProfile } from '../core/gameTypes';

const LINES: GrowthLineId[] = ['survival', 'wealth', 'connections', 'power'];

/** 一条停在指定等级的线，其余保持默认——跨线断言的输入夹具。 */
function profileAt(line: GrowthLineId, level: number): GrowthProfile {
  const p = createGrowthProfile();
  p[line] = { level, xp: 0, totalXp: level * 100 };
  return p;
}

describe('createGrowthProfile', () => {
  it('starts every line at level 1 with no xp and empty detail blocks', () => {
    const p = createGrowthProfile();
    for (const line of LINES) expect(p[line]).toEqual(createGrowthLine());
    expect(p.intel).toBe(0);
    expect(p.controlledSegments).toEqual([]);
    expect(p.investedGold).toBe(0);
    expect(p.ventures).toEqual([]);
  });
});

describe('每条线独立升级', () => {
  it('gives xp to one line only — the other three stay untouched', () => {
    for (const line of LINES) {
      const r = addGrowthXp(createGrowthProfile(), line, 100);
      expect(r.profile[line]).toEqual({ level: 2, xp: 0, totalXp: 100 });
      for (const other of LINES) {
        if (other !== line) expect(r.profile[other]).toEqual(createGrowthLine());
      }
    }
  });

  it('levels up exactly at the threshold, not before', () => {
    const below = addGrowthXp(createGrowthProfile(), 'survival', 99);
    expect(below.level).toBe(1);
    expect(below.levelsGained).toBe(0);
    expect(below.profile.survival.xp).toBe(99);

    const at = addGrowthXp(createGrowthProfile(), 'survival', 100);
    expect(at.level).toBe(2);
    expect(at.levelsGained).toBe(1);
    expect(at.profile.survival.xp).toBe(0);
  });

  it('can climb several levels in one grant, deducting each threshold', () => {
    // 450 = 100 (1→2) + 200 (2→3) + 150 left over
    const r = addGrowthXp(createGrowthProfile(), 'survival', 450);
    expect(r.level).toBe(3);
    expect(r.levelsGained).toBe(2);
    expect(r.profile.survival).toEqual({ level: 3, xp: 150, totalXp: 450 });
  });

  it('accumulates xp and totalXp across grants', () => {
    let p = createGrowthProfile();
    p = addGrowthXp(p, 'wealth', 60).profile;
    p = addGrowthXp(p, 'wealth', 60).profile;
    expect(p.wealth).toEqual({ level: 2, xp: 20, totalXp: 120 });
  });

  it('never mutates the input profile', () => {
    const p = createGrowthProfile();
    const snapshot = JSON.parse(JSON.stringify(p)) as GrowthProfile;
    addGrowthXp(p, 'power', 1000);
    expect(p).toEqual(snapshot);
  });
});

describe('升级不越界', () => {
  it('caps at GROWTH_MAX_LEVEL and pins xp to 0 when maxed', () => {
    const r = addGrowthXp(createGrowthProfile(), 'power', 1_000_000_000);
    expect(r.level).toBe(GROWTH_MAX_LEVEL);
    expect(r.levelsGained).toBe(GROWTH_MAX_LEVEL - 1);
    expect(r.maxed).toBe(true);
    expect(r.profile.power.xp).toBe(0);
    expect(r.profile.power.totalXp).toBe(1_000_000_000);
  });

  it('keeps absorbing xp into totalXp after max level, without further levels', () => {
    const maxed = addGrowthXp(createGrowthProfile(), 'power', 1_000_000_000).profile;
    const r = addGrowthXp(maxed, 'power', 500);
    expect(r.levelsGained).toBe(0);
    expect(r.level).toBe(GROWTH_MAX_LEVEL);
    expect(r.profile.power.level).toBe(GROWTH_MAX_LEVEL);
    expect(r.profile.power.xp).toBe(0);
    expect(r.profile.power.totalXp).toBe(1_000_000_500);
  });

  it('ignores non-positive and non-finite amounts instead of throwing', () => {
    const base = createGrowthProfile();
    for (const bad of [-100, 0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const r = addGrowthXp(base, 'wealth', bad);
      expect(r.levelsGained).toBe(0);
      expect(r.profile).toBe(base);
    }
  });

  it('self-heals an out-of-range level from a hand-edited save', () => {
    const tooHigh: GrowthProfile = { ...createGrowthProfile(), power: { level: 99, xp: 0, totalXp: 0 } };
    const r = addGrowthXp(tooHigh, 'power', 10);
    expect(r.level).toBe(GROWTH_MAX_LEVEL);
    expect(r.maxed).toBe(true);

    const tooLow: GrowthProfile = { ...createGrowthProfile(), survival: { level: 0, xp: 0, totalXp: 0 } };
    const r2 = addGrowthXp(tooLow, 'survival', 1);
    expect(r2.level).toBe(1);
    expect(r2.profile.survival.xp).toBe(1);
  });

  it('xpToNext is the linear 100×level curve', () => {
    expect(xpToNext(1)).toBe(100);
    expect(xpToNext(2)).toBe(200);
    expect(xpToNext(9)).toBe(900);
  });
});

describe('跨线影响生效', () => {
  it('survival raises carry capacity, one slot per level', () => {
    expect(carryCapacityBonus(profileAt('survival', 1))).toBe(0);
    expect(carryCapacityBonus(profileAt('survival', 5))).toBe(4);
    expect(carryCapacityBonus(profileAt('survival', GROWTH_MAX_LEVEL))).toBe(9);
    // 只有生存线算携带量：满级人脉不带货
    expect(carryCapacityBonus(profileAt('connections', GROWTH_MAX_LEVEL))).toBe(0);
  });

  it('survival slows stat drains, floored at 0.6', () => {
    expect(statDrainMultiplier(profileAt('survival', 1))).toBe(1);
    const maxed = statDrainMultiplier(profileAt('survival', GROWTH_MAX_LEVEL));
    expect(maxed).toBeGreaterThanOrEqual(0.6);
    expect(maxed).toBeLessThan(1);
    expect(maxed).toBeCloseTo(0.64, 10);
    // 跨线是显式的：人脉等级不影响生存消耗
    expect(statDrainMultiplier(profileAt('connections', GROWTH_MAX_LEVEL))).toBe(1);
  });

  it('connections lower trade prices, floored at 0.7', () => {
    expect(tradePriceMultiplier(profileAt('connections', 1))).toBe(1);
    const maxed = tradePriceMultiplier(profileAt('connections', GROWTH_MAX_LEVEL));
    expect(maxed).toBeGreaterThanOrEqual(0.7);
    expect(maxed).toBeLessThan(1);
    expect(maxed).toBeCloseTo(0.73, 10);
  });

  it('power gates recipe tiers to the six playable segments', () => {
    expect(recipeAccessTier(profileAt('power', 1))).toBe(1);
    expect(recipeAccessTier(profileAt('power', 6))).toBe(6);
    // 7–10 级在同一档内深化终局配方，不新增段位
    expect(recipeAccessTier(profileAt('power', GROWTH_MAX_LEVEL))).toBe(6);
    expect(recipeAccessTier(profileAt('wealth', GROWTH_MAX_LEVEL))).toBe(1);
  });

  it('wealth converts gold into connections xp, better in bulk', () => {
    const poor = profileAt('wealth', 1);
    const rich = profileAt('wealth', 5);
    expect(goldToFavorXp(0, poor, 42, 3)).toBe(0);
    expect(goldToFavorXp(-50, poor, 42, 3)).toBe(0);
    expect(goldToFavorXp(500, poor, 42, 3)).toBeGreaterThan(0);
    expect(goldToFavorXp(500, rich, 42, 3)).toBeGreaterThan(goldToFavorXp(500, poor, 42, 3));
  });

  it('lineLevel tolerates a partial profile without throwing', () => {
    expect(lineLevel({} as GrowthProfile, 'survival')).toBe(1);
    expect(lineLevel(profileAt('power', 7), 'power')).toBe(7);
  });
});

describe('同 seed 同输入结果可复现', () => {
  it('addGrowthXp is a pure function of its inputs', () => {
    const a = addGrowthXp(createGrowthProfile(), 'connections', 370);
    const b = addGrowthXp(createGrowthProfile(), 'connections', 370);
    expect(a).toEqual(b);
  });

  it('favorRate is seeded by (runSeed, day) and stays inside 0.8..1.2', () => {
    for (let day = 1; day <= 40; day++) {
      const rate = favorRate(42, day);
      expect(rate).toBeGreaterThanOrEqual(0.8);
      expect(rate).toBeLessThanOrEqual(1.2);
      expect(favorRate(42, day)).toBe(rate);
    }
    // 同 seed 跨天必须真的有波动，否则「今天送礼还是明天送礼」不是决策
    const rates = new Set(Array.from({ length: 30 }, (_, i) => favorRate(7, i + 1)));
    expect(rates.size).toBeGreaterThan(1);
  });

  it('goldToFavorXp repeats exactly for the same seed, day, gold and profile', () => {
    const p = profileAt('wealth', 3);
    expect(goldToFavorXp(1234, p, 99, 5)).toBe(goldToFavorXp(1234, p, 99, 5));
  });
});

describe('credentialRungs 读取凭证链进度', () => {
  it('counts only the pass chain, never dorm facilities', () => {
    expect(credentialRungs([])).toBe(0);
    expect(credentialRungs(['lamp', 'reinforced_door', 'purifier'])).toBe(0);
    expect(credentialRungs(['work_badge', 'pass_sticker'])).toBe(2);
    expect(credentialRungs(['work_badge', 'pass_sticker', 'permit', 'vip_card', 'core_key'])).toBe(5);
    expect(credentialRungs(undefined as unknown as string[])).toBe(0);
  });
});

describe('旧存档兼容', () => {
  it('a new game carries a fresh growth profile', () => {
    expect(createNewGame(42).growth).toEqual(createGrowthProfile());
  });

  it('round-trips the growth profile through the save', () => {
    const s = createNewGame(2026);
    const r = grantGrowthXp(s, 'survival', 100);
    expect(r.level).toBe(2);
    const back = deserialize(serialize(s));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.state.growth).toEqual(s.growth);
  });

  it('loads a save written before growth existed and fills defaults', () => {
    const raw = JSON.parse(serialize(createNewGame(42))) as Record<string, unknown>;
    delete raw.growth;
    const result = deserialize(JSON.stringify(raw));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.growth).toBeUndefined();
    const g = ensureGrowth(result.state);
    expect(g).toEqual(createGrowthProfile());
    expect(result.state.growth).toBe(g);
    // 幂等：第二次调用返回同一引用，不重置已有进度
    expect(ensureGrowth(result.state)).toBe(g);
  });

  it('repairs a hand-edited save with a partial or out-of-range growth block', () => {
    const s = createNewGame(1);
    s.growth = {
      survival: { level: 3, xp: 10, totalXp: 310 },
      wealth: { level: 2, xp: 0, totalXp: 100 },
      connections: { level: 1, xp: 0, totalXp: 0 },
      power: { level: 1, xp: 0, totalXp: 0 },
      intel: 500,
      controlledSegments: [1, 100],
      investedGold: -20,
      ventures: ['caravan'],
    } as GameState['growth'];
    const g = ensureGrowth(s);
    expect(g.survival).toEqual({ level: 3, xp: 10, totalXp: 310 });
    expect(g.wealth).toEqual({ level: 2, xp: 0, totalXp: 100 });
    expect(g.intel).toBe(100);
    expect(g.controlledSegments).toEqual([1, 100]);
    expect(g.investedGold).toBe(0);
    expect(g.ventures).toEqual(['caravan']);
  });

  it('grantGrowthXp works on a state whose growth is still missing', () => {
    const s = createNewGame(7);
    delete (s as { growth?: GameState['growth'] }).growth;
    const r = grantGrowthXp(s, 'connections', 250);
    expect(r.level).toBe(2);
    expect(r.levelsGained).toBe(1);
    expect(s.growth?.connections).toEqual({ level: 2, xp: 150, totalXp: 250 });
  });
});
