import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FLOOR_WIDTH, environmentFor } from '../core/constants';
import { generateFloor, hasFloorContent } from '../data/floorTemplates';
import { containerTextureKey } from '../render/furniture';
import { nextSegment, skippedFloors } from '../core/segments';
import { TIERS, TOTAL_FLOORS, tierOf } from '../core/tower';
import {
  WORLDGEN_DATA_VERSION,
  crossingSummary,
  encounterProfile,
  environmentProfile,
  generateFloorContent,
  summarizeFloor,
  supplyGrade,
  supplyLevel,
  threatGrade,
  threatLevel,
} from '../core/worldgen';

// WorldGen 的验收线：同 seed 同楼层结果一致、不同 seed 有差异、曲线单调、
// 边界楼层全部有定义且不抛。全部断言都跑在纯函数上，不启动 Phaser。

const SEED_A = 20261115;
const SEED_B = 987654321;

// 楼层号的边界样本：每段的首尾、段间空白的首尾、塔顶。任务书点名
// 1/10/11/99/100/100000，其余是同一验收标准的延伸。
const BOUNDARY_FLOORS = [1, 10, 11, 99, 100, 999, 1000, 9999, 10000, 49999, 50000, 89999, 90000, 100000];
const REQUIRED_BOUNDARIES = [1, 10, 11, 99, 100, 100000];

// 全塔扫描（100000 层）统一用「违规收集 + 末尾一次性断言」：逐层 expect 的
// 调用开销本身就会踩穿 vitest 的 5s 默认超时，而断言强度一条不减——任何一层
// 违约都会被抓出来，连同一楼层的编号。
function collect(scan: (report: (message: string) => void) => void): string[] {
  const bad: string[] = [];
  scan((message) => bad.push(message));
  return bad;
}

function expectNoViolations(bad: string[], label: string): void {
  expect(bad.slice(0, 5), `${label}: ${bad.length} violations`).toEqual([]);
  expect(bad).toHaveLength(0);
}

describe('supplyLevel / threatLevel 曲线', () => {
  it('covers every floor 1..100000 without throwing', () => {
    for (const f of BOUNDARY_FLOORS) {
      expect(Number.isFinite(supplyLevel(f))).toBe(true);
      expect(Number.isFinite(threatLevel(f))).toBe(true);
    }
  });

  it('is monotonically non-decreasing across the whole tower', () => {
    const bad = collect((report) => {
      let prevSupply = -Infinity;
      let prevThreat = -Infinity;
      for (let f = 1; f <= TOTAL_FLOORS; f++) {
        const s = supplyLevel(f);
        const t = threatLevel(f);
        if (s < prevSupply) report(`supplyLevel drops at ${f}`);
        if (t < prevThreat) report(`threatLevel drops at ${f}`);
        prevSupply = s;
        prevThreat = t;
      }
    });
    expectNoViolations(bad, 'monotone supply/threat');
  });

  it('anchors its integer grades to the TIERS table at every floor', () => {
    const bad = collect((report) => {
      for (let f = 1; f <= TOTAL_FLOORS; f++) {
        if (supplyGrade(f) !== tierOf(f).resourceLevel) report(`supplyGrade(${f})`);
        if (threatGrade(f) !== tierOf(f).dangerLevel) report(`threatGrade(${f})`);
      }
    });
    expectNoViolations(bad, 'grade anchors');
  });

  it('changes slope exactly at the six tier boundaries', () => {
    // 阶层内线性：阶层 1 每层 +1/99，阶层 4 每层 +1/40000。
    expect(supplyLevel(2) - supplyLevel(1)).toBeCloseTo(1 / 99, 12);
    expect(supplyLevel(10001) - supplyLevel(10000)).toBeCloseTo(1 / 40000, 12);
    // 99/100 断点：曲线连续（99 层逼近阶层 2 的基面但不越过，100 层恰好落在
    // 基面上）。注意 supplyLevel 是 0 基连续值：阶层 2 的基面是 1，整数档 2
    // 由 supplyGrade 给出。
    expect(supplyLevel(99)).toBeLessThan(supplyLevel(100));
    expect(supplyLevel(100)).toBe(1);
    expect(supplyGrade(100)).toBe(2);
    expect(threatLevel(1000)).toBe(3 - 1);
    expect(threatLevel(100000)).toBe(5 - 1);
  });

  it('stays flat across the top boundary, where nothing is richer', () => {
    // 阶层 5 与 6 的 resourceLevel 都是 5：89999/90000 不断档也不跳变。
    expect(supplyLevel(89999)).toBeCloseTo(supplyLevel(90000), 12);
    expect(supplyGrade(89999)).toBe(5);
    expect(supplyGrade(90000)).toBe(5);
  });

  it('rejects floors outside the tower', () => {
    for (const f of [0, -1, 100001, 1.5, Number.NaN]) {
      expect(() => supplyLevel(f)).toThrow();
      expect(() => threatLevel(f)).toThrow();
      expect(() => supplyGrade(f)).toThrow();
      expect(() => threatGrade(f)).toThrow();
    }
  });
});

describe('environmentProfile', () => {
  it('agrees with environmentFor at every authored segment start', () => {
    // 锚点与 constants.ts 的 SEGMENT_ENVIRONMENT 逐值一致；段首正是运行时表
    // 有定义的地方。第 1 层除外——它是 FLOOR_ENVIRONMENT 的精确层覆盖。
    for (const f of [100, 1000, 10000, 50000]) {
      expect(environmentProfile(f)).toEqual(environmentFor(f));
    }
  });

  it('records floor 1 as the documented exception: the dorm is safe', () => {
    // environmentFor(1) 命中精确层（宿舍：不冷、不危险、不 hostile）；
    // 曲线给的是阶层基线（贫民区）。运行时保留精确层，曲线不外溢。
    //
    // AG-30 给第 1 层加了 warmth 0.35（床是热源，TWOM 对齐 §2），AG-25 的
    // template 叠加生效后 environmentFor(1) 多带回这一个字段。断言的意图
    // （宿舍是安全例外）不变，只是把新字段一并钉住——少钉一个字段，
    // 下次谁改 warmth 就没测试拦了。
    expect(environmentFor(1)).toEqual({ label: '宿舍', cold: 0.6, humidity: 0.1, danger: 0, hostile: false, warmth: 0.35 });
    expect(environmentProfile(1).danger).toBe(0.45);
    expect(environmentProfile(1).hostile).toBe(true);
  });

  it('keeps danger non-decreasing from the slum to the summit', () => {
    const bad = collect((report) => {
      let prev = -Infinity;
      for (let f = 1; f <= TOTAL_FLOORS; f++) {
        const d = environmentProfile(f).danger;
        if (d < prev) report(`danger drops at ${f}`);
        prev = d;
      }
    });
    expectNoViolations(bad, 'monotone environment danger');
  });

  it('defines every floor, in range, with the summit capped at danger 1', () => {
    for (const f of BOUNDARY_FLOORS) {
      const env = environmentProfile(f);
      expect(env.cold).toBeGreaterThan(0);
      expect(env.humidity).toBeGreaterThan(0);
      expect(env.humidity).toBeLessThanOrEqual(1);
      expect(env.danger).toBeGreaterThan(0);
      expect(env.danger).toBeLessThanOrEqual(1);
      expect(env.hostile).toBe(true);
      expect(env.label).toBe(tierOf(f).name);
    }
    expect(environmentProfile(100000).danger).toBe(1);
  });

  it('rejects floors outside the tower', () => {
    expect(() => environmentProfile(0)).toThrow();
    expect(() => environmentProfile(100001)).toThrow();
  });
});

describe('encounterProfile', () => {
  it('matches the authored FLOOR_WEIGHT_PROFILE at the five segment starts', () => {
    // 数值逐字取自 encounters.ts 的表（1/100/1000/10000/50000 五行）。
    expect(encounterProfile(1)).toEqual({ loot: 60, ambush: 4, trader: 12, note: 14, cache: 10, boss: 0 });
    expect(encounterProfile(100)).toEqual({ loot: 20, ambush: 46, trader: 6, note: 4, cache: 24, boss: 0 });
    expect(encounterProfile(1000)).toEqual({ loot: 12, ambush: 66, trader: 12, note: 3, cache: 17, boss: 0 });
    expect(encounterProfile(10000)).toEqual({ loot: 7, ambush: 82, trader: 15, note: 2, cache: 16, boss: 0 });
    expect(encounterProfile(50000)).toEqual({ loot: 4, ambush: 94, trader: 11, note: 2, cache: 18, boss: 0 });
  });

  it('keeps ambush non-decreasing and loot non-increasing tower-wide', () => {
    const bad = collect((report) => {
      let prevAmbush = -Infinity;
      let prevLoot = Infinity;
      for (let f = 1; f <= TOTAL_FLOORS; f++) {
        const p = encounterProfile(f);
        if (p.ambush < prevAmbush) report(`ambush drops at ${f}`);
        if (p.loot > prevLoot) report(`loot rises at ${f}`);
        prevAmbush = p.ambush;
        prevLoot = p.loot;
      }
    });
    expectNoViolations(bad, 'monotone encounter weights');
  });

  it('puts the boss on the three gatekeeper floors only, at the authored weights', () => {
    const bad = collect((report) => {
      const bossFloors: number[] = [];
      for (let f = 1; f <= TOTAL_FLOORS; f++) {
        const boss = encounterProfile(f).boss;
        if (boss > 0) bossFloors.push(f);
        if (!Number.isInteger(boss) || boss < 0) report(`bad boss weight at ${f}`);
      }
      if (bossFloors.join(',') !== '5,110,50010') report(`boss floors: ${bossFloors.join(',')}`);
      const expected: Record<number, number> = { 5: 24, 110: 32, 50010: 108 };
      for (const [floor, weight] of Object.entries(expected)) {
        if (encounterProfile(Number(floor)).boss !== weight) report(`boss weight at ${floor}`);
      }
    });
    expectNoViolations(bad, 'gatekeeper bosses');
  });

  it('produces non-negative integer weights everywhere', () => {
    for (const f of BOUNDARY_FLOORS) {
      const p = encounterProfile(f);
      for (const key of ['loot', 'ambush', 'trader', 'note', 'cache', 'boss'] as const) {
        expect(Number.isInteger(p[key])).toBe(true);
        expect(p[key]).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('summarizeFloor 区段摘要', () => {
  it('defines every required boundary floor without throwing', () => {
    for (const f of REQUIRED_BOUNDARIES) {
      const s = summarizeFloor(SEED_A, f);
      expect(s.floor).toBe(f);
      expect(s.tier).toBe(tierOf(f));
      expect(s.containerCount).toBeGreaterThanOrEqual(1);
      expect(s.containerIds).toHaveLength(s.containerCount);
      expect(s.lootPool.length).toBeGreaterThan(0);
    }
  });

  it('marks the authored floors and reads their template as fact', () => {
    expect(summarizeFloor(SEED_A, 1).authored).toBe(true);
    expect(summarizeFloor(SEED_A, 10).authored).toBe(true);
    expect(summarizeFloor(SEED_A, 100).authored).toBe(true);
    // 终局创作（AG-16）后 100000 不再是 dev 别名：它是段 6 的唯一楼层，也是
    // 已创作楼层——摘要读它自己的模板（统治核心），不再是第 1 层宿舍。
    expect(summarizeFloor(SEED_A, 100000).authored).toBe(true);
    // 摘要里的容器数/id 就是模板里的容器数/id。
    const s5 = summarizeFloor(SEED_A, 5);
    expect(s5.containerIds).toEqual(['counter', 'pantry']);
    expect(s5.lootPool).toContain('bread');
    expect(s5.lootPool).toContain('dirty_water');
  });

  it('marks the unexplored floors and derives their compact state', () => {
    // 全部在段间空白里；100000 不在其列——它是段 6 的唯一楼层，已在段内且
    // 已创作（上面的 authored 断言钉着这一点）。
    for (const f of [11, 50, 99, 111, 999, 1011, 9999, 10011, 49999, 50011, 99999]) {
      const s = summarizeFloor(SEED_A, f);
      expect(s.authored).toBe(false);
      expect(s.segment).toBeNull();
      expect(s.containerCount).toBeGreaterThanOrEqual(2);
      expect(s.containerCount).toBeLessThanOrEqual(5);
      expect(new Set(s.containerIds).size).toBe(s.containerIds.length);
      // 物资池是材料，不含水与食物——那两样由保底发放。
      for (const id of s.lootPool) {
        expect(['clean_water', 'dirty_water', 'ration_pack', 'bread']).not.toContain(id);
      }
    }
    const summit = summarizeFloor(SEED_A, 100000);
    expect(summit.authored).toBe(true);
    expect(summit.segment?.id).toBe(6);
  });

  it('carries the curve fields unchanged from the gradient functions', () => {
    for (const f of [1, 11, 99, 100, 1000, 50000, 100000]) {
      const s = summarizeFloor(SEED_A, f);
      expect(s.supplyLevel).toBe(supplyLevel(f));
      expect(s.threatLevel).toBe(threatLevel(f));
      expect(s.supplyGrade).toBe(supplyGrade(f));
      expect(s.threatGrade).toBe(threatGrade(f));
      expect(s.environment).toEqual(environmentFor(f));
      expect(s.threatLabel.length).toBeGreaterThan(0);
    }
  });

  it('gives the same answer for the same seed and floor, byte for byte', () => {
    for (const f of [1, 10, 11, 99, 100, 1000, 100000, 54321]) {
      expect(JSON.stringify(summarizeFloor(SEED_A, f))).toBe(JSON.stringify(summarizeFloor(SEED_A, f)));
    }
  });

  it('differs between seeds on the seeded fields only', () => {
    // 曲线、阶层、环境、authored 是结构量：换种子不动它们。
    const a = summarizeFloor(SEED_A, 42);
    const b = summarizeFloor(SEED_B, 42);
    expect(b.tier).toBe(a.tier);
    expect(b.supplyLevel).toBe(a.supplyLevel);
    expect(b.threatLevel).toBe(a.threatLevel);
    expect(b.environment).toEqual(a.environment);
    expect(b.authored).toBe(a.authored);
    expect(b.lootPool).toEqual(a.lootPool);
    // 抽出来的部分（容器数与 id）必须真的能差。
    let differs = false;
    for (let f = 11; f <= 110 && !differs; f++) {
      differs = JSON.stringify(summarizeFloor(SEED_A, f)) !== JSON.stringify(summarizeFloor(SEED_B, f));
    }
    expect(differs).toBe(true);
  });

  it('summarises all 100000 floors without throwing', () => {
    const bad = collect((report) => {
      for (let f = 1; f <= TOTAL_FLOORS; f++) {
        const s = summarizeFloor(SEED_A, f);
        if (s.containerCount < 1) report(`floor ${f}: no containers`);
        if (s.containerIds.length !== s.containerCount) report(`floor ${f}: id/count mismatch`);
        if (s.floor !== f) report(`floor ${f}: echoed wrong number`);
      }
    });
    expectNoViolations(bad, 'tower-wide summary');
  });

  it('rejects floors outside the tower', () => {
    expect(() => summarizeFloor(SEED_A, 0)).toThrow();
    expect(() => summarizeFloor(SEED_A, 100001)).toThrow();
  });
});

describe('generateFloorContent 确定性生成', () => {
  it('defines every required boundary floor without throwing', () => {
    for (const f of REQUIRED_BOUNDARIES) {
      const floor = generateFloorContent(SEED_A, f);
      expect(floor.floorNumber).toBe(f);
      expect(floor.name.length).toBeGreaterThan(0);
      expect(floor.containers.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('delegates authored floors to the template generator untouched', () => {
    for (const f of [1, 5, 10, 100, 110, 1000, 1010, 10000, 10010, 50000, 50010]) {
      expect(hasFloorContent(f)).toBe(true);
      expect(generateFloorContent(SEED_A, f)).toEqual(generateFloor(SEED_A, f));
    }
  });

  it('generates the authored summit through its own template', () => {
    // 终局创作（AG-16）前，generateFloor(100000) 靠 DEV_FLOOR_ALIAS 返回玩家
    // 宿舍，本函数的合成分支绕过别名自己造一层；别名已删、真模板就位，两条
    // 路在终局会师——委托给模板，返回统治核心自己的名字与容器。
    expect(hasFloorContent(100000)).toBe(true);
    const summit = generateFloorContent(SEED_A, 100000);
    expect(summit).toEqual(generateFloor(SEED_A, 100000));
    expect(summit.name).toBe('统治核心');
    expect(summit.name).not.toBe('玩家宿舍');
    expect(summit.containers.length).toBeGreaterThanOrEqual(2);
  });

  it('is byte-identical for the same seed and floor', () => {
    for (const f of [11, 50, 99, 111, 999, 1011, 9999, 10011, 49999, 50011, 99999, 100000]) {
      expect(JSON.stringify(generateFloorContent(SEED_A, f))).toBe(
        JSON.stringify(generateFloorContent(SEED_A, f)),
      );
    }
  });

  it('differs between seeds', () => {
    let differs = false;
    for (let f = 11; f <= 110 && !differs; f++) {
      differs = JSON.stringify(generateFloorContent(SEED_A, f)) !== JSON.stringify(generateFloorContent(SEED_B, f));
    }
    expect(differs).toBe(true);
  });

  it('upholds the survival contract on all 100000 floors', () => {
    // 「每层恰好一瓶 guaranteed 水」是 6-10 层立下、后面每一段沿用的规矩
    // （floorTemplates.ts 各段注释；survivalBalance 的每层水量上限按它写）。
    // 1-5 层是 v0.1 初始切片，有自己的读数，逐层钉死：第 1 层宿舍一瓶，
    // 2/3 层根本没有水（食物来自初始背包与食堂），第 4 层一整罐六瓶。
    // 合成层 additionally 恰好一份口粮——概率化的水会踩穿水量上限。
    const v01Water: Record<number, number> = { 1: 1, 2: 0, 3: 0, 4: 6, 5: 2 };
    let containersChecked = 0;
    const bad = collect((report) => {
      for (let f = 1; f <= TOTAL_FLOORS; f++) {
        const floor = generateFloorContent(SEED_A, f);
        const items = floor.containers.flatMap((c) => c.items);
        const count = (ids: string[]): number =>
          items.filter((i) => ids.includes(i.itemId)).reduce((n, i) => n + i.quantity, 0);
        const water = count(['clean_water', 'dirty_water']);
        const food = count(['ration_pack', 'bread']);
        const wantWater = f <= 5 ? v01Water[f] : 1;
        if (water !== wantWater) report(`floor ${f} water: ${water} (want ${wantWater})`);
        if (f === 5 && food < 1) report(`floor ${f} food: ${food}`);
        if (f > 5 && food < 1) report(`floor ${f} food: ${food}`);
        if (hasFloorContent(f)) continue;

        if (food !== 1) report(`floor ${f} food: ${food} (want exactly 1)`);
        if (floor.containers.length < 2) report(`floor ${f}: ${floor.containers.length} containers`);
        containersChecked += floor.containers.length;
        // 每个容器都有东西可开，label 不超 3 字，id 有贴图且同层不重复，x 不重叠。
        const ids = new Set<string>();
        const xs = new Set<number>();
        for (const c of floor.containers) {
          if (c.items.length < 1) report(`floor ${f}/${c.id}: empty`);
          if (c.label.length < 1 || c.label.length > 3) report(`floor ${f}/${c.id}: label '${c.label}'`);
          if (!containerTextureKey(c.id)) report(`floor ${f}/${c.id}: no texture`);
          if (!(c.x > 0 && c.x < FLOOR_WIDTH)) report(`floor ${f}/${c.id}: x ${c.x}`);
          if (new Set(c.items.map((i) => i.itemId)).size !== c.items.length) {
            report(`floor ${f}/${c.id}: duplicate item`);
          }
          ids.add(c.id);
          xs.add(c.x);
        }
        if (ids.size !== floor.containers.length) report(`floor ${f}: duplicate container id`);
        if (xs.size !== floor.containers.length) report(`floor ${f}: overlapping containers`);
        for (const g of floor.groundItems) {
          if (g.key !== `g:${g.itemId}:${g.x}`) report(`floor ${f}: ground key ${g.key}`);
          if (!(g.x > 0 && g.x < FLOOR_WIDTH)) report(`floor ${f}: ground x ${g.x}`);
        }
      }
    });
    expectNoViolations(bad, 'survival contract');
    // 扫描确实覆盖了合成层，不是空转。
    expect(containersChecked).toBeGreaterThan(100000);
  });

  it('rejects floors outside the tower', () => {
    expect(() => generateFloorContent(SEED_A, 0)).toThrow();
    expect(() => generateFloorContent(SEED_A, 100001)).toThrow();
    expect(() => generateFloorContent(SEED_A, 1.5)).toThrow();
  });
});

describe('crossingSummary 电梯的一句话', () => {
  it('summarises each gap with the tier the crossed floors actually stand in', () => {
    expect(crossingSummary(10)).toEqual({
      from: 10,
      target: 100,
      skipped: 89,
      span: { from: 11, to: 99 },
      tierNames: ['底层贫民区'],
      text: '穿过 89 层：底层贫民区的废弃段',
    });
    expect(crossingSummary(110)).toEqual({
      from: 110,
      target: 1000,
      skipped: 889,
      span: { from: 111, to: 999 },
      tierNames: ['工人宿舍区'],
      text: '穿过 889 层：工人宿舍区的无人段',
    });
    expect(crossingSummary(1010)?.text).toBe('穿过 8989 层：工业与交易区的封锁段');
    expect(crossingSummary(10010)?.text).toBe('穿过 39989 层：中产与商业区的门禁段');
  });

  it('names both tiers when the lift crosses two of them', () => {
    const s = crossingSummary(50010);
    expect(s).not.toBeNull();
    expect(s?.skipped).toBe(49989);
    expect(s?.span).toEqual({ from: 50011, to: 99999 });
    expect(s?.tierNames).toEqual(['富人特权区', '统治核心']);
    // 措辞取跨越区间里最低阶层的：从富人区的封存空间里穿出来。
    expect(s?.text).toBe('穿过 49989 层：富人特权区与统治核心的封存段');
  });

  it('agrees with segments.ts on the count and the destination', () => {
    for (const from of [10, 110, 1010, 10010, 50010]) {
      const s = crossingSummary(from);
      expect(s?.skipped).toBe(skippedFloors(from));
      expect(s?.target).toBe(nextSegment(from)?.from);
      if (s) expect(s.span.to - s.span.from + 1).toBe(skippedFloors(from));
    }
  });

  it('has nothing to say where there is no up lift', () => {
    expect(crossingSummary(5)).toBeNull(); // 段中：楼梯是唯一通路
    expect(crossingSummary(50)).toBeNull(); // 未探索区没有电梯
    expect(crossingSummary(100000)).toBeNull(); // 塔顶
    expect(crossingSummary(1)).toBeNull(); // 段底只有向下的电梯
  });
});

describe('确定性与纯度的底线', () => {
  it('imports no framework and no runtime state', () => {
    const source = readFileSync(new URL('../core/worldgen.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"]phaser/);
    expect(source).not.toMatch(/from ['"]\.\.\/(scenes|systems|render)\//);
    expect(source).not.toMatch(/gameState|Math\.random|new Date/);
  });

  it('pins the data version so a retuned table rolls a new world', () => {
    expect(WORLDGEN_DATA_VERSION).toBe(1);
  });

  it('reproduces a whole stretch of the tower from the seed alone', () => {
    // 同 seed 两次独立生成整段楼层，逐字节相等——可复现性的直接证据。
    for (let f = 10011; f <= 10060; f++) {
      expect(JSON.stringify(generateFloorContent(SEED_A, f))).toBe(
        JSON.stringify(generateFloorContent(SEED_A, f)),
      );
    }
  });

  it('keeps the tier table as the single source of the curves', () => {
    for (const f of [1, 99, 100, 1000, 9999, 10000, 49999, 50000, 89999, 90000, 100000]) {
      expect(tierOf(f).id).toBe(TIERS.find((t) => f >= t.minFloor && f <= t.maxFloor)?.id);
    }
  });
});
