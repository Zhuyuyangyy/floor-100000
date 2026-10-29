import { describe, expect, it } from 'vitest';
import { lowHpPulse, mostUrgentStat, moveSpeedFactor, type SurvivalStats } from '../render/feedback';

// W4 反馈层单测（docs/OVERHAUL_M1.md）。覆盖：
//   1. lowHpPulse 三分区（满血 / 阈值上 / 阈值下）与值域 [0,1]；
//   2. 单调性——重点解释正弦项为什么让"同一 nowMs 直接比大小"不成立，以及
//      本测试改用哪三种可证明的手段（零相位点、包络最大值、整窗均值/峰数）；
//   3. mostUrgentStat 各槽位优先级、平票与全安全 null；
//   4. moveSpeedFactor 的 19/20/21 边界。

const HP_MAX = 100; // 与 config/game-balance.json 的 player.hpMax 一致

// 采样窗口：低严重度时周期最长 1200ms，取 2400ms 保证任何严重度在窗内都跑完
// 至少一个完整正弦周期——包络/均值/峰数比较都以此为前提。
const WINDOW_MS = 2400;
const STEP_MS = 4;

function severityOf(hp: number): number {
  return (0.3 - hp / HP_MAX) / 0.3;
}

// 对一个完整脉冲窗口等间隔采样，返回整条序列（供包络/均值/峰数比较）。
function sampleWindow(hp: number): number[] {
  const out: number[] = [];
  for (let t = 0; t <= WINDOW_MS; t += STEP_MS) out.push(lowHpPulse(hp, HP_MAX, t));
  return out;
}

// 离散序列的严格局部极大值个数 = 窗内脉冲峰数，用来验证"hp 越低脉冲越快"。
function countPeaks(series: number[]): number {
  let peaks = 0;
  for (let i = 1; i < series.length - 1; i++) {
    if (series[i] > series[i - 1] && series[i] > series[i + 1]) peaks++;
  }
  return peaks;
}

const safeStats: SurvivalStats = { hp: 80, hunger: 60, thirst: 60, energy: 50 };

describe('lowHpPulse 三分区', () => {
  it('满血不脉冲', () => {
    for (const t of [0, 100, 600, 1200, 2400]) {
      expect(lowHpPulse(100, HP_MAX, t)).toBe(0);
    }
  });

  it('阈值以上（含阈值线）不脉冲', () => {
    // ratio >= 0.3 一律 0，且与 nowMs 无关——安全区不该有任何闪烁。
    for (const hp of [31, 50, 80, 30]) {
      for (const t of [0, 137, 733, 1200, 2399]) {
        expect(lowHpPulse(hp, HP_MAX, t), `hp=${hp} t=${t}`).toBe(0);
      }
    }
  });

  it('阈值以下开始脉冲，且 nowMs=0 时恰为 0.5×严重度', () => {
    // nowMs=0 时正弦相位 2π×0/T = 0 对任意周期成立，脉动项清零，
    // 强度退化成 0.5×severity——这是唯一能精确预言的时间点。
    expect(lowHpPulse(29, HP_MAX, 0)).toBeCloseTo(0.5 * severityOf(29), 10);
    expect(lowHpPulse(20, HP_MAX, 0)).toBeCloseTo(0.5 * severityOf(20), 10);
    expect(lowHpPulse(10, HP_MAX, 0)).toBeCloseTo(0.5 * severityOf(10), 10);
    expect(lowHpPulse(0, HP_MAX, 0)).toBeCloseTo(0.5, 10);
    expect(lowHpPulse(29, HP_MAX, 0)).toBeGreaterThan(0); // 刚跌破阈值也有微弱红晕
  });

  it('hpMax 非正数或脏数据被夹住，不产生 NaN', () => {
    expect(lowHpPulse(10, 0, 123)).toBe(0); // 上限非正数：按不脉冲处理
    expect(lowHpPulse(-20, HP_MAX, 0)).toBeCloseTo(0.5, 10); // hp<0 视为归零
    expect(lowHpPulse(150, HP_MAX, 999)).toBe(0); // hp>hpMax 视为满血
  });
});

describe('lowHpPulse 值域', () => {
  it('全量扫描（hp×nowMs）输出恒在 [0,1]', () => {
    // 正弦负半周会把"基础项+正弦项"压到负数，末端 clamp01 是契约的一部分：
    // alpha 越界多数渲染器会静默夹掉，但这里要显式保证。
    for (let hp = 0; hp <= HP_MAX; hp += 1) {
      for (let t = 0; t <= WINDOW_MS; t += 8) {
        const v = lowHpPulse(hp, HP_MAX, t);
        expect(v, `hp=${hp} t=${t}`).toBeGreaterThanOrEqual(0);
        expect(v, `hp=${hp} t=${t}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('lowHpPulse 单调性（正弦项的处理方式）', () => {
  // 为什么不能简单地"同一 nowMs 下 hp 越低强度越高"：
  //   差值 = 0.5×Δseverity + 0.5×(sin φ₁ − sin φ₂)，且周期随严重度变化，
  //   两个 hp 的正弦相位是错开的，第二项可达 ±1，足以掀翻第一项。
  //   因此分三种可证明的手段验证"越低越强"：
  //   (a) nowMs=0：相位恒 0，强度恰为 0.5×severity，可精确比较；
  //   (b) 整窗最大包络：一个完整周期内必取到 sin=1，包络 = 0.5×severity+0.5，严格单调；
  //   (c) 整窗均值≈0.5×severity（正弦均值被多周期采样摊薄）且峰数随严重度增多（越快）。

  it('(a) 同一 nowMs=0 下 hp 越低强度严格越高', () => {
    // 安全区（ratio>=0.3）整段恒为 0，跨区只能断言"不降"；危险区在 nowMs=0
    // 处强度恰为 0.5×severity，随 hp 下降严格上升。
    const safe = [100, 80, 50, 31, 30].map((hp) => lowHpPulse(hp, HP_MAX, 0));
    for (const v of safe) expect(v).toBe(0);
    const urgent = [29, 25, 20, 10, 5, 0].map((hp) => lowHpPulse(hp, HP_MAX, 0));
    for (let i = 1; i < urgent.length; i++) {
      expect(urgent[i], `hp 下降`).toBeGreaterThan(urgent[i - 1]);
    }
    expect(urgent[urgent.length - 1]).toBeGreaterThan(Math.max(...safe)); // 0.5 > 0
  });

  it('(b) 整窗最大包络随 hp 降低严格上升', () => {
    const hps = [29, 20, 10, 0];
    const maxes = hps.map((hp) => Math.max(...sampleWindow(hp)));
    for (let i = 1; i < maxes.length; i++) {
      expect(maxes[i], `hp=${hps[i - 1]} -> ${hps[i]}`).toBeGreaterThan(maxes[i - 1] + 0.05);
    }
    // 包络上界 = 0.5×severity+0.5：最轻微时贴近 0.52，归零时达到满强度 1。
    expect(maxes[0]).toBeLessThan(0.55);
    expect(maxes[maxes.length - 1]).toBeCloseTo(1, 2);
  });

  it('(c) 整窗均值随 hp 降低严格上升', () => {
    const hps = [29, 20, 10, 0];
    const means = hps.map((hp) => {
      const s = sampleWindow(hp);
      return s.reduce((a, b) => a + b, 0) / s.length;
    });
    for (let i = 1; i < means.length; i++) {
      expect(means[i], `hp=${hps[i - 1]} -> ${hps[i]}`).toBeGreaterThan(means[i - 1]);
    }
    // severity=1（hp=0）时信号 0.5+0.5·sin 恒非负、永不被夹，均值恰为 0.5；
    // 低严重度时负半周被 clamp01 贴地，均值被抬高而高于 0.5×severity，
    // 所以这里不断言均值等于 0.5×severity，只断言单调——
    // "hp 越低一整窗平均越红"不受夹取影响，这才是 HUD 要的手感。
    expect(means[means.length - 1]).toBeCloseTo(0.5, 2);
    for (const m of means) expect(m).toBeLessThan(0.75);
  });

  it('(c) hp 越低脉冲越快：窗内峰数严格更多', () => {
    // 周期 1200ms→400ms 线性收缩：hp=29 时 ≈2 个峰，hp=0 时 6 个峰。
    const peaksLow = countPeaks(sampleWindow(29));
    const peaksZero = countPeaks(sampleWindow(0));
    expect(peaksZero).toBeGreaterThan(peaksLow);
    expect(peaksZero).toBeGreaterThanOrEqual(5);
    expect(peaksLow).toBeLessThanOrEqual(3);
  });
});

describe('mostUrgentStat', () => {
  it('全部安全返回 null（阈值线本身算安全，严格小于才报警）', () => {
    expect(mostUrgentStat(safeStats)).toBeNull();
    // hp=30 → 0.3、hunger/thirst/energy=25 → 0.25，都恰好压在阈值线上。
    expect(mostUrgentStat({ hp: 30, hunger: 25, thirst: 25, energy: 25 })).toBeNull();
  });

  it('单槽位低于各自阈值时逐个报出', () => {
    expect(mostUrgentStat({ ...safeStats, hp: 20 })).toBe('hp'); // 0.2 < 0.3
    expect(mostUrgentStat({ ...safeStats, hunger: 20 })).toBe('hunger'); // 0.2 < 0.25
    expect(mostUrgentStat({ ...safeStats, thirst: 20 })).toBe('thirst');
    expect(mostUrgentStat({ ...safeStats, energy: 20 })).toBe('energy'); // 0.2 < 0.25
  });

  it('多槽位告急时报归一化后最低的那个', () => {
    // HP 刚破线（0.25）但口渴更深（0.1）：口渴才是当前最危急的。
    expect(mostUrgentStat({ hp: 25, hunger: 60, thirst: 10, energy: 50 })).toBe('thirst');
    // 口渴（0.2）比刚破线的 HP（0.29）更深。
    expect(mostUrgentStat({ hp: 29, hunger: 60, thirst: 20, energy: 50 })).toBe('thirst');
    // HP 与饥饿同时破线时，归一化更低的 HP 胜出。
    expect(mostUrgentStat({ hp: 25, hunger: 30, thirst: 60, energy: 50 })).toBe('hp');
  });

  it('归一化精确平票时按固定优先序 hp>hunger>thirst>energy', () => {
    // 四条同值同步衰减是可能的；没有固定顺序 HUD 高亮会每帧乱跳。
    expect(mostUrgentStat({ hp: 10, hunger: 10, thirst: 10, energy: 10 })).toBe('hp');
    expect(mostUrgentStat({ hp: 80, hunger: 10, thirst: 10, energy: 10 })).toBe('hunger');
    expect(mostUrgentStat({ hp: 80, hunger: 80, thirst: 10, energy: 10 })).toBe('thirst');
  });

  it('负值槽位照样参与比较（视为最危急）', () => {
    expect(mostUrgentStat({ ...safeStats, hp: -5 })).toBe('hp');
  });
});

describe('moveSpeedFactor', () => {
  it('精力阈值边界：19 减速、20 与 21 全速', () => {
    // 严格小于：刚好 20 点还能全速走，这是精力预算的明确边界。
    expect(moveSpeedFactor({ ...safeStats, energy: 19 })).toBe(0.75);
    expect(moveSpeedFactor({ ...safeStats, energy: 20 })).toBe(1);
    expect(moveSpeedFactor({ ...safeStats, energy: 21 })).toBe(1);
  });

  it('精力极端值：归零减速、满血精力全速', () => {
    expect(moveSpeedFactor({ ...safeStats, energy: 0 })).toBe(0.75);
    expect(moveSpeedFactor({ ...safeStats, energy: 100 })).toBe(1);
  });

  it('只读 energy：其余槽位多危急都不影响移速', () => {
    expect(moveSpeedFactor({ hp: 1, hunger: 0, thirst: 0, energy: 50 })).toBe(1);
    expect(moveSpeedFactor({ hp: 100, hunger: 100, thirst: 100, energy: 19 })).toBe(0.75);
  });
});
