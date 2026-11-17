import { describe, expect, it } from 'vitest';
import { JuiceState, JUICE_BALANCE, readJuiceBalance, type CameraOffset } from '../render/juice';

// AG-91 juice 层契约测试（纯逻辑，不碰 Phaser——与 feedback.ts 同款先例）。
// 覆盖工单规定的四条契约：
//   1. 两次 30ms 内的顿帧后，timeScale 恢复后最终回到 1.0 且按最长那次恢复；
//   2. trauma 在 1/decay 秒内归零；
//   3. 同 seed 同输入 → 同偏移序列（确定性，禁 Math.random 的落实）；
//   4. 震屏强度 0 时偏移恒为 0（无障碍开关）。
// 另钉分级表落地数值（config/game-balance.json 的 juice 块）与 squash 保体积。

const DECAY = JUICE_BALANCE.traumaDecayPerSecond; // 2 次/秒 → 满 trauma 0.5s 归零
const MAX_SHAKE = JUICE_BALANCE.maxShakePx;

/** 以一个固定脚本推进（impact 时刻表 + 帧间隔），返回 offset 采样序列。 */
function runScript(seed: number, strength: number, script: Array<{ at: number; tier?: 'small' | 'medium' | 'large' }>): CameraOffset[] {
  const j = new JuiceState({ seed, strength });
  const out: CameraOffset[] = [];
  let t = 0;
  const step = 10;
  for (let frame = 0; frame * step <= 600; frame++) {
    for (const ev of script) {
      if (ev.at === t && ev.tier) j.impact(ev.tier, 100, 100);
    }
    j.update(step);
    t += step;
    out.push(j.cameraOffset());
  }
  return out;
}

describe('hitstop：重叠只取最长，真实时间恢复', () => {
  it('两次 30ms 内的顿帧后按最长那次恢复，timeScale 最终回到 1.0', () => {
    const j = new JuiceState();
    // 第一击（medium，50ms）与第二击（large，120ms）相隔 30ms——重叠。
    j.impact('medium', 0, 0); // t=0，顿帧 50ms
    j.update(30); // t=30，旧的还剩 20ms
    j.impact('large', 0, 0); // t=30，新的 120ms：取最长 → 120ms
    expect(j.isFrozen()).toBe(true);
    expect(j.timeScale).toBe(0);
    // 旧顿帧若仍在计时，t=50 就该解冻——最长那次不许被提前结束。
    j.update(20); // t=50（旧模型的解冻点）
    expect(j.isFrozen()).toBe(true);
    j.update(50); // t=100
    expect(j.isFrozen()).toBe(true);
    // 从第二击起算满 120ms（t=150）才恢复，且恰好在那一刻。
    j.update(49); // t=149
    expect(j.isFrozen()).toBe(true);
    j.update(1); // t=150 = 30 + 120
    expect(j.isFrozen()).toBe(false);
    expect(j.hitstopRemainingMs).toBe(0);
    expect(j.timeScale).toBe(1);
    // 恢复之后保持 1（不会自己掉头再冻）。
    j.update(16);
    expect(j.timeScale).toBe(1);
  });

  it('同帧两击的顿帧取较长档位，不会相加', () => {
    const j = new JuiceState();
    j.impact('medium', 0, 0);
    j.impact('large', 0, 0); // 同帧：max(50,120)=120，不是 170
    expect(j.hitstopRemainingMs).toBe(120);
    j.update(120);
    expect(j.isFrozen()).toBe(false);
  });

  it('顿帧期间状态照常按真实时间衰减（相机不冻）', () => {
    const j = new JuiceState();
    j.impact('large', 0, 0); // trauma 1.0 + 顿帧 120ms
    j.update(60); // 顿帧中
    expect(j.isFrozen()).toBe(true);
    expect(j.trauma).toBeCloseTo(1 - DECAY * 0.06, 10); // 已按真实时间衰减 60ms
    j.update(60); // t=120：顿帧结束
    expect(j.isFrozen()).toBe(false);
    expect(j.trauma).toBeCloseTo(1 - DECAY * 0.12, 10);
  });
});

describe('trauma² 震屏：1/decay 秒归零', () => {
  it('满 trauma 在 1/decay 秒内归零，且之前不提前归零', () => {
    const j = new JuiceState({ strength: 1 });
    j.addTrauma(1);
    expect(j.trauma).toBe(1);
    for (let t = 10; t < 1000 / DECAY; t += 10) {
      j.update(10);
      expect(j.trauma, `t=${t}ms 时仍应 > 0`).toBeGreaterThan(0);
    }
    j.update(10); // 恰好在 1/decay 秒
    expect(j.trauma).toBe(0);
    // 归零后 offset 恒 0（不是趋近 0）。
    expect(j.cameraOffset()).toEqual({ x: 0, y: 0 });
  });

  it('偏移幅度 = maxShakePx × strength × trauma²（有界）', () => {
    const j = new JuiceState({ seed: 7, strength: 0.5 });
    j.addTrauma(1);
    const bound = MAX_SHAKE * 0.5;
    let first = -1;
    for (let i = 0; i < 40; i++) {
      j.update(10); // 总 400ms < 500ms 衰减窗，trauma 全程为正
      const off = j.cameraOffset();
      expect(Math.abs(off.x)).toBeLessThanOrEqual(bound);
      expect(Math.abs(off.y)).toBeLessThanOrEqual(bound);
      if (i === 9) first = Math.abs(off.x) + Math.abs(off.y);
    }
    // trauma² 单调衰减 ⇒ 同档幅度上界也单调收缩（起手重、收尾轻）。
    // 末点 trauma=0.2，幅度上界只有起手的 1/25。
    const tail = Math.abs(j.cameraOffset().x) + Math.abs(j.cameraOffset().y);
    expect(first).toBeGreaterThan(0);
    expect(tail).toBeLessThanOrEqual(first / 5);
  });

  it('trauma 叠加按 1 钳住（连击不会过冲）', () => {
    const j = new JuiceState();
    j.impact('large', 0, 0); // 1.0
    j.impact('large', 0, 0); // +1.0 → 钳住
    j.impact('small', 0, 0);
    expect(j.trauma).toBe(1);
  });
});

describe('确定性：同 seed 同输入 → 同偏移序列', () => {
  it('两个同 seed 实例的逐帧 offset 完全一致', () => {
    const script = [
      { at: 100, tier: 'medium' as const },
      { at: 300, tier: 'large' as const },
      { at: 320, tier: 'small' as const },
    ];
    const a = runScript(42, 0.7, script);
    const b = runScript(42, 0.7, script);
    expect(a.length).toBe(b.length);
    expect(a).toEqual(b);
    // 序列非全零（否则「一致」是空话）。
    expect(a.some((o) => o.x !== 0 || o.y !== 0)).toBe(true);
  });

  it('不同 seed 的偏移序列不同（噪声表确实随种子变）', () => {
    const script = [{ at: 100, tier: 'large' as const }];
    const a = runScript(1, 1, script);
    const b = runScript(2, 1, script);
    expect(a).not.toEqual(b);
  });
});

describe('无障碍：震屏强度 0 时偏移恒为 0', () => {
  it('强度 0（AG-72 总闸关闭）时任何打击都不产生相机位移', () => {
    const j = new JuiceState({ strength: 0 });
    j.impact('large', 0, 0); // 满 trauma
    expect(j.trauma).toBe(1); // trauma 照常累计（顿帧/闪白不受开关影响）
    for (let i = 0; i < 60; i++) {
      j.update(16);
      expect(j.cameraOffset()).toEqual({ x: 0, y: 0 });
    }
    // 但顿帧仍然生效——开关只杀位移刺激，不杀节奏反馈。
    j.update(0);
    j.requestHitstop(50);
    expect(j.isFrozen()).toBe(true);
  });

  it('强度旋钮随设置变化即时生效（0 → 0.7）', () => {
    const j = new JuiceState({ strength: 0 });
    j.impact('large', 0, 0);
    j.update(16);
    expect(j.cameraOffset()).toEqual({ x: 0, y: 0 });
    j.shakeStrength = 0.7;
    const off = j.cameraOffset();
    expect(off.x !== 0 || off.y !== 0).toBe(true);
  });
});

describe('分级表落地数值（config/game-balance.json 的 juice 块）', () => {
  it('三档区间全部落在调研 P1 分级表规定范围内', () => {
    const t = JUICE_BALANCE.tiers;
    // small：trauma 0.10-0.20 / 无顿帧 / 粒子 0-4 / 不闪不缩放
    expect(t.small.trauma).toBeGreaterThanOrEqual(0.1);
    expect(t.small.trauma).toBeLessThanOrEqual(0.2);
    expect(t.small.hitstopMs).toBe(0);
    expect(t.small.particles).toBeGreaterThanOrEqual(0);
    expect(t.small.particles).toBeLessThanOrEqual(4);
    expect(t.small.flash).toBe(false);
    // medium：trauma 0.30-0.50 / 顿帧 40-60ms / 粒子 6-12 / 闪白
    expect(t.medium.trauma).toBeGreaterThanOrEqual(0.3);
    expect(t.medium.trauma).toBeLessThanOrEqual(0.5);
    expect(t.medium.hitstopMs).toBeGreaterThanOrEqual(40);
    expect(t.medium.hitstopMs).toBeLessThanOrEqual(60);
    expect(t.medium.particles).toBeGreaterThanOrEqual(6);
    expect(t.medium.particles).toBeLessThanOrEqual(12);
    expect(t.medium.flash).toBe(true);
    // large：trauma 0.70-1.00 / 顿帧 100-150ms / 粒子 20-40 / 闪白+缩放+伤害数字
    expect(t.large.trauma).toBeGreaterThanOrEqual(0.7);
    expect(t.large.trauma).toBeLessThanOrEqual(1);
    expect(t.large.hitstopMs).toBeGreaterThanOrEqual(100);
    expect(t.large.hitstopMs).toBeLessThanOrEqual(150);
    expect(t.large.particles).toBeGreaterThanOrEqual(20);
    expect(t.large.particles).toBeLessThanOrEqual(40);
    expect(t.large.flash).toBe(true);
    expect(t.large.scale).toBe(true);
    expect(t.large.damageNumber).toBe(true);
  });

  it('impact() 按档位返回视觉清单并同步状态', () => {
    const j = new JuiceState();
    const small = j.impact('small', 12, 34);
    expect(small).toMatchObject({ tier: 'small', x: 12, y: 34, flash: false, scale: false, damageNumber: false, hitstopMs: 0 });
    expect(j.isFrozen()).toBe(false);
    const medium = j.impact('medium', 0, 0);
    expect(medium.flash).toBe(true);
    expect(j.flashRemainingMs).toBe(JUICE_BALANCE.flashMs);
    expect(j.isFrozen()).toBe(true);
    const large = j.impact('large', 0, 0);
    expect(large.scale).toBe(true);
    expect(large.damageNumber).toBe(true);
    expect(j.scaleRemainingMs).toBe(JUICE_BALANCE.scaleMs);
    // 闪白时长落在 50-80ms 规定区间。
    expect(JUICE_BALANCE.flashMs).toBeGreaterThanOrEqual(50);
    expect(JUICE_BALANCE.flashMs).toBeLessThanOrEqual(80);
    // 强度旋钮默认 60-80%（无障碍防晕眩）。
    expect(JUICE_BALANCE.shakeStrength).toBeGreaterThanOrEqual(0.6);
    expect(JUICE_BALANCE.shakeStrength).toBeLessThanOrEqual(0.8);
  });

  it('readJuiceBalance 对坏配置回退默认（旧配置文件照样能跑）', () => {
    // 直接构造一个空 balance 段等价于缺字段：不炸，回落默认值。
    expect(readJuiceBalance().tiers.large.trauma).toBe(1);
    expect(readJuiceBalance().shakeStrength).toBeGreaterThan(0);
  });
});

describe('squash & stretch：保体积 + 回弹', () => {
  it('压缩-回弹-归 1，且全程 sx = 1/sy', () => {
    const j = new JuiceState();
    expect(j.scalePulse()).toEqual({ sx: 1, sy: 1 }); // 无打击不缩放
    j.impact('large', 0, 0); // scale=true
    let minSy = 1;
    let maxSy = 1;
    const ms = JUICE_BALANCE.scaleMs;
    for (let t = 5; t <= ms; t += 5) {
      j.update(5);
      const p = j.scalePulse();
      expect(p.sx * p.sy).toBeCloseTo(1, 10); // 保体积
      minSy = Math.min(minSy, p.sy);
      maxSy = Math.max(maxSy, p.sy);
    }
    expect(minSy).toBeLessThan(1); // 压缩段
    expect(maxSy).toBeGreaterThan(1); // easeOutBack 式回弹过冲（拉伸段）
    // 末点精确归 1（阻尼项 (1-t)² 保证），不残留缩放。
    expect(j.scalePulse()).toEqual({ sx: 1, sy: 1 });
  });
});
