// A2 工单自测（docs/OVERNIGHT_PLAN.md Wave A）：怪物名册 + 行为修饰。
// 钉住的都是「设计意图」而不是实现细节：同 seed 可复现、权重真的把
// 高层怪变强、boss 绝不混进随机池、七种行为修饰逐个有数、名册本身
// 自洽（id 唯一 / 层带合规 / 每层至少 2 只可 roll）。
//
// 统计断言全部用固定 seed 序列（seed = 1..N 顺序推进），结果确定，
// 不掷骰子；样本量给足，防止「这次过了下次红」的抖动。

import { describe, expect, it } from 'vitest';

import { deriveSeed, makeRng } from '../core/rng';
import {
  MONSTERS,
  applyBehavior,
  behaviorModifiers,
  rollMonster,
} from '../systems/monsters';
import type { Combatant, MonsterBehavior, MonsterDef } from '../systems/monsters';
import type { Rng } from '../core/rng';

// 楼层带数值梯度（工单规定）：每只怪的 hp/damage 必须落在自己 minFloor
// 对应的带内，名册测试直接拿它当尺子。
const FLOOR_BANDS: Record<number, { hp: [number, number]; dmg: [number, number] }> = {
  2: { hp: [5, 8], dmg: [2, 3] },
  3: { hp: [9, 14], dmg: [3, 4] },
  4: { hp: [15, 22], dmg: [4, 6] },
  5: { hp: [20, 30], dmg: [5, 7] },
};

const BOSS_ID = 900;

function baseCombatant(): Combatant {
  return { hp: 30, maxHp: 30, damage: 10, accuracy: 70, defense: 5, evasion: 3 };
}

// 固定 seed 序列上的平均值：统计钉权重设计，但结果完全确定。
function meanOverSeeds(floor: number, samples: number, pick: (m: MonsterDef) => number): number {
  let sum = 0;
  for (let seed = 1; seed <= samples; seed++) {
    sum += pick(rollMonster(floor, sampleRng(floor, seed)));
  }
  return sum / samples;
}

// 统计取种子必须走 deriveSeed，不能把 1..N 直接当 seed：xorshift32 对
// 连续小 seed 的首次输出近似与 seed 成正比（实测 seed 1..20 的首帧全落
// 在 0.0013 以下），加权 roll 会永远抽中池中第一只——那是 PRNG 对小
// seed 的结构性偏差，不是名册/权重写错了。deriveSeed 做多部件哈希混合，
// 2000 个样本十分桶实测 195–209 均匀；这也正是引擎侧 deriveSeed('monster',
// floor, ...) 的真实用法，测试与生产同构。
function sampleRng(floor: number, sample: number): Rng {
  return makeRng(deriveSeed('monster', floor, sample));
}

describe('名册完整性', () => {
  it('id 唯一', () => {
    const ids = MONSTERS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('名字非空，minFloor 全部落在 2..5', () => {
    for (const m of MONSTERS) {
      expect(m.name.length, `id ${m.id} name`).toBeGreaterThan(0);
      expect(m.minFloor, `id ${m.id} minFloor`).toBeGreaterThanOrEqual(2);
      expect(m.minFloor, `id ${m.id} minFloor`).toBeLessThanOrEqual(5);
    }
  });

  it('规模在 13–15 只之间（含 boss）', () => {
    expect(MONSTERS.length).toBeGreaterThanOrEqual(13);
    expect(MONSTERS.length).toBeLessThanOrEqual(15);
  });

  it('七种行为全部在名册中出现', () => {
    const behaviors = new Set(MONSTERS.map((m) => m.behavior));
    const expected: MonsterBehavior[] = ['normal', 'fast', 'slow', 'ranged', 'ambusher', 'coward', 'brute'];
    for (const b of expected) {
      expect(behaviors.has(b), `behavior ${b}`).toBe(true);
    }
  });

  it('每只怪（除 boss）的 hp/damage 落在本层工单带内', () => {
    for (const m of MONSTERS) {
      if (m.id === BOSS_ID) continue;
      const band = FLOOR_BANDS[m.minFloor];
      expect(m.hp, `id ${m.id} hp`).toBeGreaterThanOrEqual(band.hp[0]);
      expect(m.hp, `id ${m.id} hp`).toBeLessThanOrEqual(band.hp[1]);
      expect(m.damage, `id ${m.id} dmg`).toBeGreaterThanOrEqual(band.dmg[0]);
      expect(m.damage, `id ${m.id} dmg`).toBeLessThanOrEqual(band.dmg[1]);
    }
  });

  it('boss 是 900 守门人：5 层、hp45/dmg8、weight 0 不进随机池', () => {
    const boss = MONSTERS.find((m) => m.id === BOSS_ID);
    expect(boss).toBeDefined();
    expect(boss!.name).toBe('守门人');
    expect(boss!.minFloor).toBe(5);
    expect(boss!.hp).toBe(45);
    expect(boss!.damage).toBe(8);
    expect(boss!.weight).toBe(0);
  });
});

describe('rollMonster', () => {
  it('同 seed 同层抽同一只怪（确定性）', () => {
    const a = rollMonster(3, makeRng(1234));
    const b = rollMonster(3, makeRng(1234));
    expect(a).toBe(b); // 名册条目按引用返回，同一对象
    // 引擎侧的真实形态（deriveSeed 混合种子）同样必须可复现。
    const c = rollMonster(3, sampleRng(3, 7));
    const d = rollMonster(3, sampleRng(3, 7));
    expect(c).toBe(d);
  });

  it('返回值永远是名册成员', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const m = rollMonster((seed % 4) + 2, sampleRng((seed % 4) + 2, seed));
      expect(MONSTERS.includes(m)).toBe(true);
    }
  });

  it('100 个 seed × 2–5 层全部落在 minFloor<=floor 且 weight>0', () => {
    for (let seed = 1; seed <= 100; seed++) {
      for (const floor of [2, 3, 4, 5]) {
        const m = rollMonster(floor, sampleRng(floor, seed));
        expect(m.minFloor, `seed ${seed} floor ${floor}`).toBeLessThanOrEqual(floor);
        expect(m.weight, `seed ${seed} floor ${floor}`).toBeGreaterThan(0);
      }
    }
  });

  it('守门人不进随机池：1000 次 roll 不出 id 900', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      for (const floor of [2, 3, 4, 5]) {
        expect(rollMonster(floor, sampleRng(floor, seed)).id).not.toBe(BOSS_ID);
      }
    }
  });

  it('2–5 层每层至少 2 只候选（枚举 + 实测）', () => {
    for (const floor of [2, 3, 4, 5]) {
      const pool = MONSTERS.filter((m) => m.minFloor <= floor && m.weight > 0);
      expect(pool.length, `floor ${floor} candidates`).toBeGreaterThanOrEqual(2);
      // 枚举之外再实测：300 个固定 seed 里至少见到 2 种不同怪。
      const seen = new Set<number>();
      for (let seed = 1; seed <= 300; seed++) {
        seen.add(rollMonster(floor, sampleRng(floor, seed)).id);
      }
      expect(seen.size, `floor ${floor} observed`).toBeGreaterThanOrEqual(2);
    }
  });

  it('无候选层（宿舍层 floor 1）回退到最低层候选', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const m = rollMonster(1, sampleRng(1, seed));
      expect(m.minFloor).toBe(2);
      expect(m.weight).toBeGreaterThan(0);
    }
  });

  it('权重趋势：第 5 层平均 hp/damage 高于第 2 层', () => {
    const SAMPLES = 500;
    const hp2 = meanOverSeeds(2, SAMPLES, (m) => m.hp);
    const hp5 = meanOverSeeds(5, SAMPLES, (m) => m.hp);
    const dmg2 = meanOverSeeds(2, SAMPLES, (m) => m.damage);
    const dmg5 = meanOverSeeds(5, SAMPLES, (m) => m.damage);
    // 2 层池均值 hp 6.0 / dmg 2.25；5 层加权均值 hp ≈13.1 / dmg ≈3.7。
    // 留 2 hp / 0.5 dmg 的余量，防的是一次无意的权重挪动把梯度抹平。
    expect(hp5, `hp2=${hp2} hp5=${hp5}`).toBeGreaterThan(hp2 + 2);
    expect(dmg5, `dmg2=${dmg2} dmg5=${dmg5}`).toBeGreaterThan(dmg2 + 0.5);
  });

  it('权重被尊重：第 2 层最高权重怪的观测频率接近其占比', () => {
    // 2 层池总重 37，拾荒者 weight 10 ≈ 0.27。固定 seed 下这是确定值，
    // 带宽放到 [0.18, 0.36]：抓「加权写错成等概率/顺序取模」这类事故。
    const SAMPLES = 2000;
    let hits = 0;
    for (let seed = 1; seed <= SAMPLES; seed++) {
      if (rollMonster(2, sampleRng(2, seed)).id === 101) hits++;
    }
    const rate = hits / SAMPLES;
    expect(rate, `rate=${rate}`).toBeGreaterThan(0.18);
    expect(rate, `rate=${rate}`).toBeLessThan(0.36);
  });
});

describe('behaviorModifiers 七种行为', () => {
  it('normal 全中性', () => {
    expect(behaviorModifiers('normal')).toEqual({
      damageMult: 1,
      accuracyBonus: 0,
      defenseBonus: 0,
      evasionBonus: 0,
      guardPierce: 0,
      firstStrikeMult: 1,
      fleeAtHpFrac: 0,
    });
  });

  it('fast：命中 +3、闪避 +2', () => {
    const mods = behaviorModifiers('fast');
    expect(mods.accuracyBonus).toBe(3);
    expect(mods.evasionBonus).toBe(2);
    expect(mods.damageMult).toBe(1);
    expect(mods.fleeAtHpFrac).toBe(0);
  });

  it('slow：命中 -2、防御 +2', () => {
    const mods = behaviorModifiers('slow');
    expect(mods.accuracyBonus).toBe(-2);
    expect(mods.defenseBonus).toBe(2);
    expect(mods.damageMult).toBe(1);
  });

  it('ranged：格挡穿透 0.5（无视一半格挡）', () => {
    const mods = behaviorModifiers('ranged');
    expect(mods.guardPierce).toBe(0.5);
    expect(mods.damageMult).toBe(1);
  });

  it('ambusher：首轮伤害 ×1.5', () => {
    const mods = behaviorModifiers('ambusher');
    expect(mods.firstStrikeMult).toBe(1.5);
    expect(mods.damageMult).toBe(1);
  });

  it('coward：血量降到 40% 以下战退', () => {
    const mods = behaviorModifiers('coward');
    expect(mods.fleeAtHpFrac).toBe(0.4);
  });

  it('brute：伤害 ×1.4、命中 -2', () => {
    const mods = behaviorModifiers('brute');
    expect(mods.damageMult).toBe(1.4);
    expect(mods.accuracyBonus).toBe(-2);
  });

  it('每次调用返回独立对象（改写不污染查表）', () => {
    const a = behaviorModifiers('fast');
    a.accuracyBonus = 999;
    expect(behaviorModifiers('fast').accuracyBonus).toBe(3);
  });
});

describe('applyBehavior', () => {
  it('brute：damage 乘 1.4 后取整，命中 -2，其余原样', () => {
    const base = baseCombatant();
    const out = applyBehavior(behaviorModifiers('brute'), base);
    expect(out).toEqual({ hp: 30, maxHp: 30, damage: 14, accuracy: 68, defense: 5, evasion: 3 });
  });

  it('fast：命中/闪避加成直接加，damage 不变', () => {
    const out = applyBehavior(behaviorModifiers('fast'), baseCombatant());
    expect(out.accuracy).toBe(73);
    expect(out.evasion).toBe(5);
    expect(out.damage).toBe(10);
  });

  it('中性修饰符是恒等变换，且返回新对象（纯函数）', () => {
    const base = baseCombatant();
    const out = applyBehavior(behaviorModifiers('normal'), base);
    expect(out).toEqual(base);
    expect(out).not.toBe(base);
  });

  it('小数伤害四舍五入且不为负', () => {
    // 3 × 1.4 = 4.2 → 4；5 × 1.4 = 7.0 → 7。
    expect(applyBehavior(behaviorModifiers('brute'), { ...baseCombatant(), damage: 3 }).damage).toBe(4);
    expect(applyBehavior(behaviorModifiers('brute'), { ...baseCombatant(), damage: 5 }).damage).toBe(7);
    expect(applyBehavior(behaviorModifiers('brute'), { ...baseCombatant(), damage: -10 }).damage).toBe(0);
  });

  it('不改写入参', () => {
    const base = baseCombatant();
    const snapshot = { ...base };
    applyBehavior(behaviorModifiers('brute'), base);
    expect(base).toEqual(snapshot);
  });
});
