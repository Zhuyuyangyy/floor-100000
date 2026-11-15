import { describe, expect, it } from 'vitest';
import { FLOOR_TEMPLATES, generateFloor } from '../data/floorTemplates';
import {
  PLAYABLE_FLOORS_V01,
  WARMTH_SOURCES,
  environmentFor,
} from '../core/constants';
import type { FloorEnvironment } from '../core/constants';
import { PLAYABLE_SEGMENTS, segmentOf } from '../core/segments';
import { containerTextureKey } from '../render/furniture';

// TWOM 对齐 §2 定死的解析顺序：FLOOR_ENVIRONMENT（逐层）→ SEGMENT_ENVIRONMENT
// （段首）→ 阶梯向下回落，再叠加 FLOOR_TEMPLATES[floor]?.environment（template
// 字段优先）。AG-25 落地前 environmentFor 还不读模板，所以本测试在本地复刻这条
// 合并——它与 AG-25 将要写的实现逐字同构，且对「已合并」的底表幂等（同样的字段
// 再覆盖一遍还是同样的值），AG-25 上线后本文件不用改。
function resolvedEnvironment(floor: number): FloorEnvironment {
  const base = environmentFor(floor);
  const tpl = FLOOR_TEMPLATES[floor]?.environment;
  return tpl ? { ...base, ...tpl } : base;
}

// 每段一个「无微调代表层」：读段基线用它，免得读到本文件自己填的微调值。段 6
// 只有 100000 一层，它的微调只碰 humidity——cold 基线照读不误。
const SEGMENT_PROBES: Record<number, number> = {
  1: 7,
  2: 105,
  3: 1005,
  4: 10003,
  5: 50003,
  6: 100000,
};

function probeFor(floor: number): number {
  return SEGMENT_PROBES[segmentOf(floor)!.id];
}

describe('every playable floor has an environment, before and after the merge', () => {
  it('answers all 55 floors without throwing', () => {
    expect(PLAYABLE_FLOORS_V01.length).toBe(55);
    for (const f of PLAYABLE_FLOORS_V01) {
      const env = environmentFor(f);
      expect(env.label.length, `floor ${f} label`).toBeGreaterThan(0);
      for (const k of ['cold', 'humidity', 'danger'] as const) {
        expect(Number.isFinite(env[k]), `floor ${f}.${k}`).toBe(true);
      }
      expect(typeof env.hostile, `floor ${f}.hostile`).toBe('boolean');
    }
  });

  it('resolves all 55 floors through the contract merge as well', () => {
    for (const f of PLAYABLE_FLOORS_V01) {
      const env = resolvedEnvironment(f);
      expect(env.label.length, `floor ${f} label`).toBeGreaterThan(0);
      // 微调不许把任何字段改成非有限值或负数
      expect(Number.isFinite(env.cold) && env.cold >= 0, `floor ${f}.cold`).toBe(true);
      expect(Number.isFinite(env.humidity) && env.humidity >= 0 && env.humidity <= 1, `floor ${f}.humidity`).toBe(true);
      expect(Number.isFinite(env.danger) && env.danger >= 0 && env.danger <= 1, `floor ${f}.danger`).toBe(true);
    }
  });

  it('only writes fields the contract knows', () => {
    const KNOWN = new Set(['label', 'cold', 'humidity', 'danger', 'hostile', 'warmth']);
    for (const f of PLAYABLE_FLOORS_V01) {
      for (const k of Object.keys(FLOOR_TEMPLATES[f]!.environment ?? {})) {
        expect(KNOWN.has(k), `floor ${f} writes unknown field "${k}"`).toBe(true);
      }
    }
  });
});

describe('template micro-tweaks really cover the ladder', () => {
  it('floor 9 is damper than its segment — the leak is overhead', () => {
    const segment = resolvedEnvironment(probeFor(9));
    const nine = resolvedEnvironment(9);
    expect(nine.humidity).toBeGreaterThan(segment.humidity);
    // 踩过 HUD 的「潮湿」线（EnvironmentSystem.environmentLabel 的 0.5）
    expect(nine.humidity).toBeGreaterThanOrEqual(0.5);
  });

  it('floor 50007 is colder than its segment — the cold store leaks cold air', () => {
    const segment = resolvedEnvironment(probeFor(50007));
    const store = resolvedEnvironment(50007);
    expect(store.cold).toBeGreaterThan(segment.cold);
    // 冷到和统治核心同一个读数，但不越过它
    expect(store.cold).toBe(resolvedEnvironment(100000).cold);
  });

  it('floor 10005 runs machines — warmer and wetter than its segment, both with reasons', () => {
    const segment = resolvedEnvironment(probeFor(10005));
    const room = resolvedEnvironment(10005);
    expect(room.humidity).toBeGreaterThan(segment.humidity); // 墙角渗水
    expect(room.cold).toBeLessThan(segment.cold); // 管线井的机器余热
    // 回落幅度有底：不冷过下一段（工业区）的基线
    expect(room.cold).toBe(resolvedEnvironment(probeFor(1005)).cold);
  });
});

describe('the six segments stay coherent', () => {
  const probes = [7, 105, 1005, 10003, 50003, 100000];

  it('gets colder a segment at a time, bottom to top', () => {
    const colds = probes.map((f) => resolvedEnvironment(f).cold);
    for (let i = 1; i < colds.length; i++) {
      expect(colds[i], `segment ${i + 1} must be colder than segment ${i}`).toBeGreaterThan(colds[i - 1]);
    }
  });

  it('lets no floor cross its neighbour segments baselines', () => {
    // 段内偏差可以有（10005 的机器余温、50007 的冷藏库、10 层的屋顶），但不许
    // 冷过下一段的段底或暖过上一段——否则「段间单调」就被微调撕穿了。
    for (const f of PLAYABLE_FLOORS_V01) {
      if (f <= 5) continue; // 1-5 层是 FLOOR_ENVIRONMENT 的层性格，不参与段阶梯
      const seg = segmentOf(f)!;
      const idx = PLAYABLE_SEGMENTS.findIndex((s) => s.id === seg.id);
      const below = idx > 0 ? resolvedEnvironment(SEGMENT_PROBES[PLAYABLE_SEGMENTS[idx - 1]!.id]!).cold : -Infinity;
      const above =
        idx < PLAYABLE_SEGMENTS.length - 1
          ? resolvedEnvironment(SEGMENT_PROBES[PLAYABLE_SEGMENTS[idx + 1]!.id]!).cold
          : Infinity;
      const cold = resolvedEnvironment(f).cold;
      expect(cold, `floor ${f} must not be warmer than the segment below`).toBeGreaterThanOrEqual(below);
      expect(cold, `floor ${f} must not be colder than the segment above`).toBeLessThanOrEqual(above);
    }
  });

  it('keeps floors 1-5 to warmth only — their personality belongs to FLOOR_ENVIRONMENT', () => {
    for (const f of [1, 2, 3, 4, 5]) {
      const keys = Object.keys(FLOOR_TEMPLATES[f]!.environment ?? {});
      expect(keys, `floor ${f} overrides ${keys.join('/')}`).toEqual(keys.filter((k) => k === 'warmth'));
      // 层性格没被模板动过：合并前后五个字段逐一相等
      const base = environmentFor(f);
      const merged = resolvedEnvironment(f);
      expect(merged.cold).toBe(base.cold);
      expect(merged.humidity).toBe(base.humidity);
      expect(merged.danger).toBe(base.danger);
      expect(merged.hostile).toBe(base.hostile);
      expect(merged.label).toBe(base.label);
    }
  });

  it('only the documented damp floors break 0.5 humidity, each above its segment', () => {
    // 「漏水中」不是全局调大湿度，是这一层出了什么事——集合必须封闭。3/4 层是
    // FLOOR_ENVIRONMENT 自带的潮（储物层与维修层），其余八层是本文件的微调。
    const DAMP = [3, 4, 9, 102, 1002, 10005, 10008, 50005, 50008];
    const wet = PLAYABLE_FLOORS_V01.filter((f) => resolvedEnvironment(f).humidity > 0.5);
    expect(wet).toEqual(DAMP);
    for (const f of DAMP) {
      const segment = resolvedEnvironment(probeFor(f));
      expect(resolvedEnvironment(f).humidity, `floor ${f} vs its segment`).toBeGreaterThan(segment.humidity);
    }
  });
});

describe('warmth only where a fire is drawn', () => {
  it('fills warmth exactly on the floors with WARMTH_SOURCES', () => {
    const withWarmth = PLAYABLE_FLOORS_V01.filter(
      (f) => FLOOR_TEMPLATES[f]!.environment?.warmth !== undefined,
    );
    const withFire = Object.keys(WARMTH_SOURCES)
      .map(Number)
      .filter((f) => (WARMTH_SOURCES[f]?.length ?? 0) > 0);
    // 画得出火焰的层（1 的三根蜡烛、5 的火盆）才有 warmth；楼上各层只有电灯
    expect(withWarmth).toEqual(withFire);
    expect(withWarmth).toEqual([1, 5]);
  });

  it('keeps every value a fraction in (0, 1]', () => {
    for (const f of PLAYABLE_FLOORS_V01) {
      const w = FLOOR_TEMPLATES[f]!.environment?.warmth;
      if (w === undefined) continue;
      expect(w, `floor ${f}`).toBeGreaterThan(0);
      expect(w, `floor ${f}`).toBeLessThanOrEqual(1);
    }
  });

  it('ranks the brazier above the dorm candles, the way WARMTH_SOURCES powers do', () => {
    const dorm = FLOOR_TEMPLATES[1]!.environment!.warmth!;
    const canteen = FLOOR_TEMPLATES[5]!.environment!.warmth!;
    expect(canteen).toBeGreaterThan(dorm);
  });
});

describe('the survival contract is untouched', () => {
  const SEEDS = [1, 42, 2026];

  it('still generates every floor, environment field and all', () => {
    for (const f of PLAYABLE_FLOORS_V01) {
      for (const seed of SEEDS) {
        const floor = generateFloor(seed, f);
        expect(floor.floorNumber).toBe(f);
        expect(floor.containers.length, `floor ${f} containers`).toBeGreaterThan(0);
        // environment 是模板里的渲染外字段，不许漏进生成结果
        expect('environment' in floor).toBe(false);
      }
    }
  });

  it('still hands out exactly one guaranteed drink above the legacy five', () => {
    // survivalBalance.test.ts 的「分层盈余」按每层一瓶水记账——段 2 起任何一层
    // 多一瓶水（哪怕是概率掉落）都会踩穿上限。这里钉住 guaranteed 水。
    for (const f of PLAYABLE_FLOORS_V01) {
      if (f <= 5) continue;
      const waters = FLOOR_TEMPLATES[f]!.containers
        .flatMap((c) => c.loot)
        .filter((l) => l.guaranteed && (l.itemId === 'clean_water' || l.itemId === 'dirty_water'));
      expect(waters.length, `floor ${f} guaranteed water`).toBe(1);
    }
  });

  it('still pins every guaranteed quantity', () => {
    for (const f of PLAYABLE_FLOORS_V01) {
      for (const c of FLOOR_TEMPLATES[f]!.containers) {
        for (const l of c.loot) {
          if (l.guaranteed) expect(l.min, `F${f}/${c.id} ${l.itemId}`).toBe(l.max);
        }
      }
    }
  });

  it('keeps every container on a texture that exists', () => {
    // 没加容器，但要确认没有把现有容器挤出贴图集合（未知 id 会变隐形容器）
    for (const f of PLAYABLE_FLOORS_V01) {
      for (const c of FLOOR_TEMPLATES[f]!.containers) {
        expect(containerTextureKey(c.id), `F${f}/${c.id}`).not.toBeNull();
      }
    }
  });

  it('touches exactly the sixteen documented floors', () => {
    const tweaked = PLAYABLE_FLOORS_V01.filter((f) => FLOOR_TEMPLATES[f]!.environment !== undefined);
    expect(tweaked).toEqual([
      1, 5, 9, 10, 102, 110, 1002, 1010, 10005, 10008, 10010, 50005, 50007, 50008, 50010, 100000,
    ]);
  });
});
