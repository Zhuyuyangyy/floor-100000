import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLAYABLE_FLOORS_V01 } from '../core/constants';
import { segmentOf } from '../core/segments';
import type { ItemId } from '../core/gameTypes';
import {
  FLOOR_TEMPLATES,
  generateFloor,
  withinSegmentLootBoost,
} from '../data/floorTemplates';
import { generateFloorContent, summarizeFloor } from '../core/worldgen';

// AG-43 物资梯度（docs/plans/LOOT.md）：把「爬得高 = 拿得好」钉成测试。
//
// 断言的梯度分四层，从机制到现象：
//   1. 机制：段内分层乘数 withinSegmentLootBoost 在每段内严格单调（段底 1.0 →
//      段顶 1.5），1-5 层与单层段恒为 1；
//   2. 段内：2-5 段的段顶物资期望严格高于段底（手写表本身有噪声，逐层非递减
//      不成立——见 LOOT.md §3 的说明，所以钉的是「顶 > 底」而不是「每步都涨」）；
//   3. 段间：高级件（wire/battery/fuse/filter/medkit）的段均期望从段 2 到段 5
//      非递减；段 1 与段 6 是文档在案的例外（前者是 v0.1 冻结切片，后者是单层
//      终局，肥在「件件齐」不在「件数多」）；
//   4. 边界：survivalBalance 的每层一瓶水一份饭原样活着，9 种材料的最早/最高
//      出现层符合设计，未探索层同 seed 可复现且阶内也开始分层。

// 生存契约件：不走分层乘数，也不参与「高级件」统计。
const SURVIVAL_IDS: readonly ItemId[] = ['clean_water', 'dirty_water', 'ration_pack', 'bread'];
// 高级件：阶层越高权重越高的那五种（遭遇池与材料池共用同一套读数）。
const ADVANCED_IDS: readonly ItemId[] = ['wire', 'battery', 'fuse', 'filter', 'medkit'];
// 任务书点名的 9 种材料。
const NINE_MATERIALS: readonly ItemId[] = [
  'scrap_metal', 'cloth', 'wood', 'tape', 'wire', 'battery', 'fuse', 'filter', 'crowbar',
];

const QA_SEEDS = [1, 42, 2026];

interface FloorExpectation {
  /** 全部非水食掉落的期望件数（保底钉死值 + 概率 × 段内乘数 × 区间均值）。 */
  materials: number;
  /** 高级件期望件数。 */
  advanced: number;
  /** medkit 期望件数（高级件里最「资源向」的一件，单独看）。 */
  medkit: number;
  perItem: Record<string, number>;
}

/** 一层物资期望的解析值：保底条目钉死，概率条目按乘数后期望。 */
function expectationOf(floor: number): FloorExpectation {
  const template = FLOOR_TEMPLATES[floor];
  const perItem: Record<string, number> = {};
  const add = (id: ItemId, n: number): void => {
    perItem[id] = (perItem[id] ?? 0) + n;
  };
  for (const c of template.containers) {
    for (const l of c.loot) {
      if (SURVIVAL_IDS.includes(l.itemId)) continue;
      const boost = withinSegmentLootBoost(floor);
      const n = l.guaranteed ? l.min : ((l.min + l.max) / 2) * Math.min(1, l.probability * boost);
      add(l.itemId, n);
    }
  }
  for (const g of template.ground) add(g.itemId, g.quantity);
  const sum = (ids: readonly ItemId[]): number => ids.reduce((s, id) => s + (perItem[id] ?? 0), 0);
  return { materials: sum(NINE_MATERIALS), advanced: sum(ADVANCED_IDS), medkit: perItem.medkit ?? 0, perItem };
}

const segmentIdOf = (floor: number): number => segmentOf(floor)?.id ?? 0;
const floorsOfSegment = (id: number): number[] => PLAYABLE_FLOORS_V01.filter((f) => segmentIdOf(f) === id);

describe('段内分层乘数（机制层）', () => {
  it('is exactly 1 on the frozen v0.1 slice (floors 1-5)', () => {
    // survivalBalance 的审计把 1-5 层的期望值逐层钉死（F3 废金属恰好 3 件、
    // F4 保底件、八 seed 可建性），那一段是冻结基线，不参与放大。
    for (const f of [1, 2, 3, 4, 5]) {
      expect(withinSegmentLootBoost(f), `floor ${f}`).toBe(1);
    }
  });

  it('rises strictly from a segment bottom to its top', () => {
    for (const [from, to] of [[6, 10], [100, 110], [1000, 1010], [10000, 10010], [50000, 50010]] as const) {
      for (let f = from; f < to; f++) {
        expect(withinSegmentLootBoost(f + 1), `floor ${f} -> ${f + 1}`).toBeGreaterThan(withinSegmentLootBoost(f));
      }
      expect(withinSegmentLootBoost(from), `segment bottom ${from}`).toBe(1);
      expect(withinSegmentLootBoost(to), `segment top ${to}`).toBeCloseTo(1.5, 12);
    }
  });

  it('stays 1 off-segment and on the single-floor finale', () => {
    for (const f of [11, 50, 99, 111, 999, 50011]) {
      expect(withinSegmentLootBoost(f), `unexplored floor ${f}`).toBe(1);
    }
    // 单层段（100000）：span 为 0，乘数必须落在 1 而不是 NaN——NaN 会让
    // chance(NaN) 恒为 false，终局层将什么都不掉。
    expect(withinSegmentLootBoost(100000)).toBe(1);
  });
});

describe('段内期望：段顶比段底肥（现象层）', () => {
  it('tops out richer than it starts on segments 2-5', () => {
    // 比的是总材料件数与 medkit 期望：段顶闸口层用「更少的容器、更肥的 roll」
    // 换总量（50000 四个容器对 50010 三个容器），所以高级五件的原始期望在段 5
    // 会被容器数噪声压住——质量轴由下一个 describe 的段间平均来钉。
    for (const id of [2, 3, 4, 5]) {
      const floors = floorsOfSegment(id);
      const bottom = expectationOf(floors[0]);
      const top = expectationOf(floors[floors.length - 1]);
      expect(top.materials, `segment ${id} top ${floors[floors.length - 1]}`).toBeGreaterThan(bottom.materials);
      expect(top.medkit, `segment ${id} medkit`).toBeGreaterThan(bottom.medkit);
    }
  });

  it('climbs the whole authored tower without the per-step noise mattering', () => {
    // 逐层非递减不成立也不该成立：手写表的容器数与条目是逐层的手调风味
    // （102 层三个容器、104 层四个），乘数只放大既有条目。所以这里钉的是
    // 「每段自身顶 > 底」加上「段间高级件段均非递减」，见下一个 describe。
    const slopes = [6, 100, 1000, 10000, 50000].map((f) => withinSegmentLootBoost(f));
    for (const s of slopes) expect(s).toBe(1);
  });
});

describe('段间期望：高级件随阶层非递减（梯度主轴）', () => {
  it('does not decrease from segment 2 through segment 5', () => {
    const averages = [2, 3, 4, 5].map((id) => {
      const floors = floorsOfSegment(id);
      return floors.reduce((s, f) => s + expectationOf(f).advanced, 0) / floors.length;
    });
    for (let i = 1; i < averages.length; i++) {
      expect(averages[i], `segment ${i + 2} average`).toBeGreaterThanOrEqual(averages[i - 1]);
    }
    // 段 1 的读数被 F3/F4 的保底件抬着，仍不许低于段 2——宿舍区的保证是
    // 「有序」，不是「更穷」。
    const seg1 = floorsOfSegment(1).reduce((s, f) => s + expectationOf(f).advanced, 0) / 10;
    expect(averages[0]).toBeGreaterThanOrEqual(seg1);
  });

  it('medkit yield climbs with the tiers', () => {
    const medkits = [1, 2, 3, 4, 5].map((id) => {
      const floors = floorsOfSegment(id);
      return floors.reduce((s, f) => s + expectationOf(f).medkit, 0) / floors.length;
    });
    for (let i = 1; i < medkits.length; i++) {
      expect(medkits[i], `segment ${i + 1} medkit`).toBeGreaterThanOrEqual(medkits[i - 1]);
    }
  });

  it('the finale is the documented exception: one floor, but every advanced part in it', () => {
    // 段 6 是单层终局（3 个容器），件数天然低于段 5 的十一层平均——它的肥法
    // 是「件件齐」：wire/battery/fuse/filter/medkit 五件高级件全在模板里，
    // 外加全塔第二个撬棍来源。
    const summit = expectationOf(100000);
    for (const id of ADVANCED_IDS) {
      expect(summit.perItem[id], `summit ${id}`).toBeGreaterThan(0);
    }
    expect(summit.perItem.crowbar).toBeGreaterThan(0);
  });
});

describe('九种材料的最早/最高出现层（梯度表）', () => {
  const firstFloor = (id: ItemId): number | undefined =>
    PLAYABLE_FLOORS_V01.find((f) => {
      const t = FLOOR_TEMPLATES[f];
      return (
        t.containers.some((c) => c.loot.some((l) => l.itemId === id)) ||
        t.ground.some((g) => g.itemId === id)
      );
    });
  const lastFloor = (id: ItemId): number | undefined =>
    [...PLAYABLE_FLOORS_V01].reverse().find((f) => {
      const t = FLOOR_TEMPLATES[f];
      return (
        t.containers.some((c) => c.loot.some((l) => l.itemId === id)) ||
        t.ground.some((g) => g.itemId === id)
      );
    });

  it('basic materials are in hand by floor 3, advanced parts by floor 4', () => {
    // 设计的梯度：废金属/布料/木材/胶带/电池/撬棍是 1-3 层的基础件（配方
    // lamp/purifier/reinforced_door/storage_rack 的确定性来源），电线/保险丝/
    // 滤芯 4 层保底——爬四层就「什么都会掉」，但爬十层、一百层才「掉得多」。
    const early: Record<string, number> = {
      scrap_metal: 3, cloth: 3, wood: 3, tape: 3, battery: 3, crowbar: 3,
      wire: 4, fuse: 4, filter: 4,
    };
    for (const [id, ceiling] of Object.entries(early)) {
      expect(firstFloor(id as ItemId), `${id} first floor`).toBeLessThanOrEqual(ceiling);
    }
  });

  it('every one of the nine has a guaranteed source (survivalBalance D1 同读数)', () => {
    // 概率-only 的材料会让整局跑不到它——9 种材料必须各有一条保底来源。
    for (const id of NINE_MATERIALS) {
      const guaranteed = PLAYABLE_FLOORS_V01.some((f) => {
        const t = FLOOR_TEMPLATES[f];
        return (
          t.containers.some((c) => c.loot.some((l) => l.itemId === id && l.guaranteed === true)) ||
          t.ground.some((g) => g.itemId === id)
        );
      });
      expect(guaranteed, `${id} has no guaranteed source`).toBe(true);
    }
  });

  it('the advanced five reach the summit; wood stops where tier-1 recipes stop', () => {
    // wire/battery/fuse/filter/medkit 的最高出现层都是 100000；撬棍在全塔只有
    // 两处（3 层保底 + 终局 0.4 单点），不是刷点。
    for (const id of ['wire', 'battery', 'fuse', 'filter', 'medkit', 'crowbar'] as const) {
      expect(lastFloor(id), `${id} last floor`).toBe(100000);
    }
    // 木材只服务 1 阶配方（加固门/置物架），最高出现在工业区中段——阶层性格，
    // 不是缺口。
    expect(lastFloor('wood')).toBe(1007);
    expect(firstFloor('wood')).toBe(3);
  });

  it('the summit advertises the crowbar its encounter pool promises', () => {
    // encounters.ts 的 FLOOR_LOOT_POOLS[100000] 写着「阶层 6 是唯一带回撬棍的
    // 一档」，模板的配电箱必须真的锁着一根。
    const fuseBox = FLOOR_TEMPLATES[100000].containers.find((c) => c.id === 'fuse_box');
    expect(fuseBox?.loot.some((l) => l.itemId === 'crowbar')).toBe(true);
  });
});

describe('未探索楼层：确定性与阶内分层', () => {
  const SAMPLES = [11, 30, 55, 99, 111, 500, 999, 1011, 5000, 9999, 10011, 30000, 49999, 50011, 70000, 89999, 99999];

  it('reproduces byte for byte from the seed alone', () => {
    for (const f of SAMPLES) {
      expect(JSON.stringify(generateFloorContent(20261115, f))).toBe(
        JSON.stringify(generateFloorContent(20261115, f)),
      );
    }
  });

  it('differs between seeds', () => {
    let differs = false;
    for (let f = 11; f <= 110 && !differs; f++) {
      differs =
        JSON.stringify(generateFloorContent(20261115, f)) !== JSON.stringify(generateFloorContent(987654321, f));
    }
    expect(differs).toBe(true);
  });

  it('graduates the material pool past each tier midpoint', () => {
    // 阶内分层（materialPoolFor）：下半段用本阶池，上半段并入上一阶池。
    const poolOf = (f: number): ItemId[] => summarizeFloor(42, f).lootPool;
    expect(poolOf(11)).not.toContain('filter'); // 贫民区下半段：没有滤芯
    expect(poolOf(99)).toContain('filter'); // 贫民区上半段：滤芯进场
    expect(poolOf(111)).not.toContain('fuse');
    expect(poolOf(999)).toContain('fuse');
    expect(poolOf(1011)).not.toContain('medkit');
    expect(poolOf(9999)).toContain('medkit');
    expect(poolOf(50011)).not.toContain('crowbar');
    expect(poolOf(89999)).toContain('crowbar'); // 富人区深处：撬棍回来
    // 阶层 4 的上一阶池是它的子集（富人区不拆实验设备），中产区上半段不变。
    expect(poolOf(49999)).toEqual(poolOf(10011));
    // 阶层 6 没有上一阶，塔顶饱和。
    expect(poolOf(99999)).toEqual(poolOf(90000));
    // 池子里永远只有材料：水与食由保底发放，不进概率池。
    for (const f of SAMPLES) {
      for (const id of poolOf(f)) {
        expect(SURVIVAL_IDS).not.toContain(id);
      }
    }
  });
});

describe('survivalBalance 硬边界未破', () => {
  // v0.1 切片（1-5 层）的逐层水读数，测试钉死的既成事实。
  const V01_WATER: Record<number, number> = { 1: 1, 2: 0, 3: 0, 4: 6, 5: 2 };

  it('every floor above the legacy five hands out exactly one drink, one meal', () => {
    for (const seed of QA_SEEDS) {
      for (const floor of PLAYABLE_FLOORS_V01) {
        const items = generateFloor(seed, floor).containers.flatMap((c) => c.items);
        const water = items.filter((i) => i.itemId === 'clean_water' || i.itemId === 'dirty_water');
        const food = items.filter((i) => i.itemId === 'ration_pack' || i.itemId === 'bread');
        const wantWater = floor <= 5 ? V01_WATER[floor] : 1;
        // v0.1 切片的读数是「瓶数」：第 4 层是一罐六瓶（一条记录），2/3 层没有。
        const wantEntries = floor <= 5 ? (V01_WATER[floor] > 0 ? 1 : 0) : 1;
        expect(water.length, `seed ${seed} floor ${floor} water entries`).toBe(wantEntries);
        expect(water.reduce((n, i) => n + i.quantity, 0), `seed ${seed} floor ${floor} water`).toBe(wantWater);
        if (floor >= 5) {
          expect(food.length, `seed ${seed} floor ${floor} food`).toBeGreaterThanOrEqual(1);
        }
        if (floor > 5) {
          expect(food.reduce((n, i) => n + i.quantity, 0), `seed ${seed} floor ${floor} food qty`).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it('the table itself never lists a second drink, guaranteed or not', () => {
    // 概率性的第二瓶水同样踩穿「分层盈余」上限——查表，不等某个 seed 抽到。
    for (const floor of PLAYABLE_FLOORS_V01) {
      if (floor <= 5) continue;
      const entries = FLOOR_TEMPLATES[floor].containers.flatMap((c) => c.loot);
      const water = entries.filter((l) => l.itemId === 'clean_water' || l.itemId === 'dirty_water');
      expect(water.length, `floor ${floor} water entries`).toBe(1);
      expect(water[0].guaranteed, `floor ${floor} water must be guaranteed`).toBe(true);
    }
  });

  it('the boost never touches a guaranteed entry, so pinned quantities hold', () => {
    // 乘数只套概率条目：保底件的 min === max 与数值都不受段内位置影响。
    for (const floor of PLAYABLE_FLOORS_V01) {
      for (const c of FLOOR_TEMPLATES[floor].containers) {
        for (const l of c.loot) {
          if (!l.guaranteed) continue;
          expect(l.min, `F${floor}/${c.id} ${l.itemId}`).toBe(l.max);
        }
      }
    }
    // 3+4 层的废金属恰好 3 件（lamp 1 + purifier 2），八 seed 不变。
    for (const seed of [1, 42, 2026, 7, 99, 1234, 55555, 987654]) {
      const scrap = generateFloor(seed, 3)
        .containers.flatMap((c) => c.items)
        .filter((i) => i.itemId === 'scrap_metal')
        .reduce((n, i) => n + i.quantity, 0);
      expect(scrap, `seed ${seed} scrap on F3`).toBe(3);
    }
  });
});

describe('生成鲁棒性', () => {
  const FLOORS = [1, 3, 6, 10, 11, 50, 99, 100, 105, 110, 111, 500, 999, 1000, 1005, 1010, 10000, 50005, 50010, 100000];
  const SEEDS = [1, 42, 2026, 7, 99, 1234, 55555, 987654, 31337, 20261115];

  it('generates 20 floors x 10 seeds without throwing, deterministically', () => {
    expect(FLOORS).toHaveLength(20);
    expect(SEEDS).toHaveLength(10);
    for (const floor of FLOORS) {
      for (const seed of SEEDS) {
        const once = generateFloorContent(seed, floor);
        expect(once.floorNumber).toBe(floor);
        expect(once.name.length).toBeGreaterThan(0);
        expect(JSON.stringify(once)).toBe(JSON.stringify(generateFloorContent(seed, floor)));
        // 宿舍层（1-2 层）按设计就近乎空的：1 层一瓶水加一次布料抽签，2 层一次
        // 面包抽签——「每层必有材料」不是这条梯子的性质，不钉。
        expect(once.containers.length, `seed ${seed} floor ${floor}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the generator free of Math.random and framework imports', () => {
    const source = readFileSync(new URL('../data/floorTemplates.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/Math\.random/);
    expect(source).not.toMatch(/from ['"]phaser/);
  });
});
