import { containerTextureKey } from '../render/furniture';
import { describe, expect, it } from 'vitest';
import {
  containerItemKey,
  containerLootSeed,
  FLOOR_TEMPLATES,
  generateFloor,
  getFloorTemplate,
  hasFloorContent,
  groundItemKey,
  LOOT_DATA_VERSION,
} from '../data/floorTemplates';
import { deriveSeed } from '../core/rng';
import { DEV_TEST_FLOORS, FLOOR_WIDTH, PLAYABLE_FLOORS_V01 } from '../core/constants';
import { PLAYABLE_SEGMENTS } from '../core/segments';

// ?devfloor= 直达的楼层曾经靠 DEV_FLOOR_ALIAS 借用第 1 层的模板——那只是开发
// 入口，不是内容（hasFloorContent 因此刻意对它说过假）。终局创作后（AG-16），
// 100000 有了自己的模板，别名失去存在理由并被删除：?devfloor=100000 现在直达
// 统治核心本身，generateFloor 也不再把它解析成玩家宿舍。
describe('the dev-only floor entry', () => {
  it('resolves the dev test floor to its own authored template', () => {
    for (const floor of DEV_TEST_FLOORS) {
      expect(getFloorTemplate(floor), `dev floor ${floor} must render`).toBeDefined();
      expect(hasFloorContent(floor), `dev floor ${floor} must be authored`).toBe(true);
      // 自己的模板：楼层号对得上，也不再是第 1 层宿舍的借用。
      expect(getFloorTemplate(floor)!.floorNumber, `dev floor ${floor}`).toBe(floor);
      expect(getFloorTemplate(floor)!.name, `dev floor ${floor}`).not.toBe('玩家宿舍');
    }
  });

  it('does not alias any playable floor', () => {
    // 别名已删除：每一层可玩楼层的模板都地址在自己身上。
    for (const floor of PLAYABLE_FLOORS_V01) {
      expect(FLOOR_TEMPLATES[floor].floorNumber, `floor ${floor}`).toBe(floor);
    }
  });

  it('authors exactly one template per playable segment floor, and nothing else', () => {
    // Count is not pinned: the assertion is that the authored table and the
    // playable segments name the same floors, so a floor can never be playable
    // without content (or authored without being reachable). The summit used to
    // be the one exception — authored nowhere, reachable only through the dev
    // alias; the finale (AG-16) closed that gap, so all six segments now match.
    const authored = Object.keys(FLOOR_TEMPLATES).map(Number).sort((a, b) => a - b);
    const expected = PLAYABLE_SEGMENTS.flatMap((s) =>
      Array.from({ length: s.to - s.from + 1 }, (_, i) => s.from + i),
    ).sort((a, b) => a - b);
    expect(authored).toEqual(expected);
  });

  it('generates the dev floor under its own number', () => {
    const dev = generateFloor(42, 100000);
    expect(dev.floorNumber).toBe(100000);
    expect(dev.containers.length).toBeGreaterThan(0);
  });
});

describe('floor templates', () => {
  it('defines a template for every playable floor', () => {
    for (const f of PLAYABLE_FLOORS_V01) {
      expect(getFloorTemplate(f), `floor ${f} must have a template`).toBeDefined();
    }
    // The key and the template's own floorNumber must agree, or the template is
    // addressable under one number and generates under another.
    for (const [key, t] of Object.entries(FLOOR_TEMPLATES)) {
      expect(t.floorNumber, `FLOOR_TEMPLATES[${key}]`).toBe(Number(key));
    }
  });

  it('the same seed generates the same world', () => {
    expect(generateFloor(42, 3)).toEqual(generateFloor(42, 3));
  });

  it('different seeds can differ on non-critical loot', () => {
    const base = JSON.stringify(generateFloor(1, 3));
    let differs = false;
    for (let seed = 2; seed <= 60; seed++) {
      if (JSON.stringify(generateFloor(seed, 3)) !== base) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });

  it('guaranteed (critical) loot is present for every QA seed', () => {
    for (const seed of [1, 42, 2026]) {
      const floor = generateFloor(seed, 4);
      const fuseBox = floor.containers.find((c) => c.id === 'fuse_box');
      expect(fuseBox?.items.some((i) => i.itemId === 'fuse' && i.quantity >= 1)).toBe(true);
    }
  });

  it('an unknown floor throws', () => {
    expect(() => generateFloor(1, 12345)).toThrow();
  });
});

// The slum's playable segment is floors 1..10 (docs/18_TIER_PROGRESSION.md,
// tier 1). Ten floors is long enough that a floor with no authored content — or
// with no guaranteed drink — would only be noticed by dying on it, so it is
// pinned here rather than left to playtesting.
describe('every playable floor is generated, survivable and reproducible', () => {
  const QA_SEEDS = [1, 42, 2026];

  // Floors 6-10 are the slum's picked-over top and 100-110 are the worker dorm:
  // none of them has a home, NPC or upgrade floor to fall back on, and a floor
  // without a guaranteed bottle makes the climb a seed lottery.
  //
  // Floors 1..5 predate the rule and stay as authored — 1 is home (it holds the
  // guaranteed bottle), 2 is the trading hub, 3 is the material store, 4 the
  // water stop and 5 the canteen — so the per-floor invariant is asserted where
  // it is actually required rather than retro-fitted onto the old balance.
  const SELF_PROVISIONED_FLOORS = PLAYABLE_FLOORS_V01.filter((f) => f >= 6);

  it('generates every playable floor without throwing', () => {
    for (const floor of PLAYABLE_FLOORS_V01) {
      expect(() => generateFloor(42, floor), `floor ${floor}`).not.toThrow();
      expect(generateFloor(42, floor).floorNumber, `floor ${floor}`).toBe(floor);
    }
  });

  it('every self-provisioned floor yields a drink', () => {
    expect(SELF_PROVISIONED_FLOORS.length, 'the climb above the canteen must exist').toBeGreaterThan(0);
    for (const seed of QA_SEEDS) {
      for (const floor of SELF_PROVISIONED_FLOORS) {
        const items = generateFloor(seed, floor).containers.flatMap((c) => c.items);
        const water = items.filter((i) => i.itemId === 'clean_water' || i.itemId === 'dirty_water');
        expect(water.length, `seed ${seed} floor ${floor} hands out no water`).toBeGreaterThan(0);
        expect(water.reduce((n, i) => n + i.quantity, 0), `seed ${seed} floor ${floor}`).toBeGreaterThan(0);
      }
    }
  });

  it('every self-provisioned floor yields a meal', () => {
    expect(SELF_PROVISIONED_FLOORS.length, 'the climb above the canteen must exist').toBeGreaterThan(0);
    for (const seed of QA_SEEDS) {
      for (const floor of SELF_PROVISIONED_FLOORS) {
        const items = generateFloor(seed, floor).containers.flatMap((c) => c.items);
        const food = items.filter((i) => i.itemId === 'ration_pack' || i.itemId === 'bread');
        expect(food.length, `seed ${seed} floor ${floor} hands out no food`).toBeGreaterThan(0);
      }
    }
  });

  it('the same seed and floor reproduce the same floor', () => {
    for (const floor of PLAYABLE_FLOORS_V01) {
      expect(generateFloor(42, floor), `floor ${floor}`).toEqual(generateFloor(42, floor));
    }
  });
});

// 阶层 2（100-110，工人宿舍区）是第二段亲手写的楼层。它和 1-10 层不是同一种
// 地方——有编号、有班次、有配给——但生存规矩一样硬：一层没水就是逼人渴死。
// 这里断言的是模板数据本身（不是某几个 seed 的生成结果），所以一条 guaranteed
// 被误改成概率时测试会直接红，而不是等某个 seed 抽不到。
describe('the worker-dorm tier (100-110)', () => {
  // 只圈阶层 2 自己：1000-1010 是阶层 3，另有一段 describe 钉它。
  const DORM_FLOORS = PLAYABLE_FLOORS_V01.filter((f) => f >= 100 && f < 1000);
  // Was a hard-coded whitelist of the nine shared textures. It drifted the moment
  // the dorm got its own props, so ask the mapper instead: an id with no texture
  // makes the container invisible, and that is the property worth pinning.

  it('is exactly the eleven floors of segment 2', () => {
    expect(DORM_FLOORS).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110]);
  });

  it('has an authored template for every dorm floor', () => {
    for (const floor of DORM_FLOORS) {
      expect(hasFloorContent(floor), `floor ${floor} must be authored`).toBe(true);
      expect(FLOOR_TEMPLATES[floor].floorNumber, `floor ${floor}`).toBe(floor);
    }
  });

  it('guarantees one drink and one meal on every dorm floor', () => {
    for (const floor of DORM_FLOORS) {
      const loot = FLOOR_TEMPLATES[floor].containers.flatMap((c) => c.loot);
      const water = loot.filter(
        (l) => l.guaranteed === true && (l.itemId === 'clean_water' || l.itemId === 'dirty_water'),
      );
      const food = loot.filter(
        (l) => l.guaranteed === true && (l.itemId === 'ration_pack' || l.itemId === 'bread'),
      );
      expect(water.length, `floor ${floor} has no guaranteed drink`).toBeGreaterThan(0);
      expect(food.length, `floor ${floor} has no guaranteed meal`).toBeGreaterThan(0);
    }
  });

  it('uses only existing furniture art, 3-5 containers, and short labels', () => {
    for (const floor of DORM_FLOORS) {
      const template = FLOOR_TEMPLATES[floor];
      expect(template.containers.length, `floor ${floor} container count`).toBeGreaterThanOrEqual(3);
      expect(template.containers.length, `floor ${floor} container count`).toBeLessThanOrEqual(5);
      for (const c of template.containers) {
        expect(containerTextureKey(c.id), `floor ${floor}/${c.id} has no furniture texture`).not.toBeNull();
        // Two- or three-character labels: longer ones overlap the next
        // container's title (the 6-10 floors hit exactly that).
        expect([...c.label].length, `floor ${floor}/${c.id} label "${c.label}"`).toBeLessThanOrEqual(3);
      }
      expect(template.description.length, `floor ${floor} description`).toBeGreaterThan(0);
    }
  });

  it('reproduces the same dorm floor from the same seed', () => {
    for (const floor of DORM_FLOORS) {
      expect(generateFloor(42, floor), `floor ${floor}`).toEqual(generateFloor(42, floor));
      expect(generateFloor(2026, floor).floorNumber, `floor ${floor}`).toBe(floor);
    }
  });
});

// 阶层 3（1000-1010，工业与交易区）是第三段亲手写的楼层：军队级安保、货梯、
// 管道、黑市。生存规矩和前两段一样硬，而且更严——每层恰好一瓶水、一份军粮，
// 都是 guaranteed。survivalBalance 的「分层盈余」按每层一瓶水给这一段记 30 点
// 额度，所以这里钉的是「恰好一份水」而不是「至少一份」：多一瓶就踩穿上限。
// 容器 id 仍只能落在有贴图的家具上（没有新美术），问 containerTextureKey。
describe('the industrial tier (1000-1010)', () => {
  // 只圈阶层 3 自己：10000-10010 是阶层 4，另有一段 describe 钉它。
  const INDUSTRIAL_FLOORS = PLAYABLE_FLOORS_V01.filter((f) => f >= 1000 && f < 10000);

  it('is exactly the eleven floors of segment 3', () => {
    expect(INDUSTRIAL_FLOORS).toEqual([1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010]);
  });

  it('has an authored template for every industrial floor', () => {
    for (const floor of INDUSTRIAL_FLOORS) {
      expect(hasFloorContent(floor), `floor ${floor} must be authored`).toBe(true);
      expect(FLOOR_TEMPLATES[floor].floorNumber, `floor ${floor}`).toBe(floor);
    }
  });

  it('guarantees exactly one drink and one meal on every industrial floor', () => {
    for (const floor of INDUSTRIAL_FLOORS) {
      const loot = FLOOR_TEMPLATES[floor].containers.flatMap((c) => c.loot);
      const water = loot.filter(
        (l) => l.guaranteed === true && (l.itemId === 'clean_water' || l.itemId === 'dirty_water'),
      );
      const food = loot.filter(
        (l) => l.guaranteed === true && (l.itemId === 'ration_pack' || l.itemId === 'bread'),
      );
      expect(water.length, `floor ${floor} must guarantee exactly one drink`).toBe(1);
      expect(food.length, `floor ${floor} has no guaranteed meal`).toBeGreaterThanOrEqual(1);
    }
  });

  it('uses only existing furniture art, 3-5 containers, and short labels', () => {
    for (const floor of INDUSTRIAL_FLOORS) {
      const template = FLOOR_TEMPLATES[floor];
      expect(template.containers.length, `floor ${floor} container count`).toBeGreaterThanOrEqual(3);
      expect(template.containers.length, `floor ${floor} container count`).toBeLessThanOrEqual(5);
      for (const c of template.containers) {
        expect(containerTextureKey(c.id), `floor ${floor}/${c.id} has no furniture texture`).not.toBeNull();
        expect([...c.label].length, `floor ${floor}/${c.id} label "${c.label}"`).toBeLessThanOrEqual(3);
      }
      expect(template.description.length, `floor ${floor} description`).toBeGreaterThan(0);
    }
  });

  it('reproduces the same industrial floor from the same seed', () => {
    for (const floor of INDUSTRIAL_FLOORS) {
      expect(generateFloor(42, floor), `floor ${floor}`).toEqual(generateFloor(42, floor));
      expect(generateFloor(2026, floor).floorNumber, `floor ${floor}`).toBe(floor);
    }
  });
});

// 阶层 4（10000-10010，中产与商业区）是第四段亲手写的楼层：地毯、招牌、
// 私人武装和实验室。生存规矩和前三段一样硬——每层恰好一瓶水、一份口粮，
// 都是 guaranteed；survivalBalance 的「分层盈余」按每层一瓶水给这一段记 30
// 点额度，所以这里同样钉「恰好一份水」：多一瓶（哪怕是概率掉落的）就踩穿
// 上限。物资是四段里最超高级的：filter/medkit/fuse 的权重全面高于工业区，
// 水只在机房（10005）与实验室（10008）两层是脏水，其余是净水。容器 id 仍
// 只能落在有贴图的家具上（没有新美术），问 containerTextureKey。
describe('the commercial tier (10000-10010)', () => {
  // 只圈阶层 4 自己：50000-50010 是阶层 5，另有一段 describe 钉它。
  const COMMERCIAL_FLOORS = PLAYABLE_FLOORS_V01.filter((f) => f >= 10000 && f < 50000);

  it('is exactly the eleven floors of segment 4', () => {
    expect(COMMERCIAL_FLOORS).toEqual([
      10000, 10001, 10002, 10003, 10004, 10005, 10006, 10007, 10008, 10009, 10010,
    ]);
  });

  it('has an authored template for every commercial floor', () => {
    for (const floor of COMMERCIAL_FLOORS) {
      expect(hasFloorContent(floor), `floor ${floor} must be authored`).toBe(true);
      expect(FLOOR_TEMPLATES[floor].floorNumber, `floor ${floor}`).toBe(floor);
    }
  });

  it('guarantees exactly one drink and one meal on every commercial floor', () => {
    for (const floor of COMMERCIAL_FLOORS) {
      const loot = FLOOR_TEMPLATES[floor].containers.flatMap((c) => c.loot);
      const water = loot.filter(
        (l) => l.guaranteed === true && (l.itemId === 'clean_water' || l.itemId === 'dirty_water'),
      );
      const food = loot.filter(
        (l) => l.guaranteed === true && (l.itemId === 'ration_pack' || l.itemId === 'bread'),
      );
      expect(water.length, `floor ${floor} must guarantee exactly one drink`).toBe(1);
      expect(food.length, `floor ${floor} has no guaranteed meal`).toBeGreaterThanOrEqual(1);
      // 一条就够：概率性的第二瓶水会让「分层盈余」的上限被悄悄踩穿。
      const anyWater = loot.filter((l) => l.itemId === 'clean_water' || l.itemId === 'dirty_water');
      expect(anyWater.length, `floor ${floor} hands out more than one drink`).toBe(1);
    }
  });

  it('uses only existing furniture art, 3-5 containers, and short labels', () => {
    for (const floor of COMMERCIAL_FLOORS) {
      const template = FLOOR_TEMPLATES[floor];
      expect(template.containers.length, `floor ${floor} container count`).toBeGreaterThanOrEqual(3);
      expect(template.containers.length, `floor ${floor} container count`).toBeLessThanOrEqual(5);
      for (const c of template.containers) {
        expect(containerTextureKey(c.id), `floor ${floor}/${c.id} has no furniture texture`).not.toBeNull();
        expect([...c.label].length, `floor ${floor}/${c.id} label "${c.label}"`).toBeLessThanOrEqual(3);
      }
      expect(template.description.length, `floor ${floor} description`).toBeGreaterThan(0);
    }
  });

  it('reproduces the same commercial floor from the same seed', () => {
    for (const floor of COMMERCIAL_FLOORS) {
      expect(generateFloor(42, floor), `floor ${floor}`).toEqual(generateFloor(42, floor));
      expect(generateFloor(2026, floor).floorNumber, `floor ${floor}`).toBe(floor);
    }
  });
});

// 阶层 5（50000-50010，富人特权区）是第五段亲手写的楼层，也是倒数第二段：
// 地毯、招牌、保险柜，和已经空了的笼架——生物兵器正式登场，富人不只知道，
// 他们买单。生存规矩和前四段一样硬：每层恰好一瓶水、一份食物，都是
// guaranteed；survivalBalance 的「分层盈余」按每层一瓶水给这一段记 30 点
// 额度，所以这里钉「恰好一份水」：多一瓶（哪怕是概率掉落的）就踩穿上限。
// 物资是五段里最稀有的：medkit/filter/fuse/battery 的权重全面高于中产区，
// 水以净水为主，只有喂养层（50005）与楼上实验室（50008）是脏水。容器 id
// 仍只能落在有贴图的家具上（没有新美术），问 containerTextureKey。
describe('the VIP tier (50000-50010)', () => {
  // 只圈阶层 5 自己：100000 是统治核心，另有终局 describe 钉它。
  const VIP_FLOORS = PLAYABLE_FLOORS_V01.filter((f) => f >= 50000);

  it('is exactly the eleven floors of segment 5', () => {
    expect(VIP_FLOORS).toEqual([
      50000, 50001, 50002, 50003, 50004, 50005, 50006, 50007, 50008, 50009, 50010,
    ]);
  });

  it('has an authored template for every VIP floor', () => {
    for (const floor of VIP_FLOORS) {
      expect(hasFloorContent(floor), `floor ${floor} must be authored`).toBe(true);
      expect(FLOOR_TEMPLATES[floor].floorNumber, `floor ${floor}`).toBe(floor);
    }
  });

  it('guarantees exactly one drink and one meal on every VIP floor', () => {
    for (const floor of VIP_FLOORS) {
      const loot = FLOOR_TEMPLATES[floor].containers.flatMap((c) => c.loot);
      const water = loot.filter(
        (l) => l.guaranteed === true && (l.itemId === 'clean_water' || l.itemId === 'dirty_water'),
      );
      const food = loot.filter(
        (l) => l.guaranteed === true && (l.itemId === 'ration_pack' || l.itemId === 'bread'),
      );
      expect(water.length, `floor ${floor} must guarantee exactly one drink`).toBe(1);
      expect(food.length, `floor ${floor} has no guaranteed meal`).toBeGreaterThanOrEqual(1);
      // 一条就够：概率性的第二瓶水会让「分层盈余」的上限被悄悄踩穿。
      const anyWater = loot.filter((l) => l.itemId === 'clean_water' || l.itemId === 'dirty_water');
      expect(anyWater.length, `floor ${floor} hands out more than one drink`).toBe(1);
    }
  });

  it('uses only existing furniture art, 3-5 containers, and short labels', () => {
    for (const floor of VIP_FLOORS) {
      const template = FLOOR_TEMPLATES[floor];
      expect(template.containers.length, `floor ${floor} container count`).toBeGreaterThanOrEqual(3);
      expect(template.containers.length, `floor ${floor} container count`).toBeLessThanOrEqual(5);
      for (const c of template.containers) {
        expect(containerTextureKey(c.id), `floor ${floor}/${c.id} has no furniture texture`).not.toBeNull();
        expect([...c.label].length, `floor ${floor}/${c.id} label "${c.label}"`).toBeLessThanOrEqual(3);
      }
      expect(template.description.length, `floor ${floor} description`).toBeGreaterThan(0);
    }
  });

  it('reproduces the same VIP floor from the same seed', () => {
    for (const floor of VIP_FLOORS) {
      expect(generateFloor(42, floor), `floor ${floor}`).toEqual(generateFloor(42, floor));
      expect(generateFloor(2026, floor).floorNumber, `floor ${floor}`).toBe(floor);
    }
  });
});

// 阶层 6（100000，统治核心）是全塔最后一段，也是唯一一段只有一层：玩家到这里
// 不是来打怪的，是来做选择的（quests.ts Q6 的四个结局）。三件容器就是终局的
// 三幕——终端台（抉择发生地）、配电箱（shutdown 要关掉的东西）、档案柜
// （停电表、配给表、处决名单，同一支笔写的三张表）。生存规矩和前五段完全
// 相同：恰好 1 份 guaranteed 净水 + 1 份 guaranteed 口粮——worldgen 的
// survival contract 按每层一瓶水给全塔记账，多一瓶就踩穿上限。容器 id 仍只能
// 落在有贴图的家具上（没有新美术），问 containerTextureKey；容器数比前五段
// 更少（2-3 件）——终局层少而重，一件事一个容器。
describe('the ruling core (100000)', () => {
  const FINALE_FLOORS = [100000];

  it('is exactly the single floor of segment 6', () => {
    expect(FINALE_FLOORS).toEqual([100000]);
  });

  it('has an authored template for the summit', () => {
    for (const floor of FINALE_FLOORS) {
      expect(hasFloorContent(floor), `floor ${floor} must be authored`).toBe(true);
      expect(FLOOR_TEMPLATES[floor].floorNumber, `floor ${floor}`).toBe(floor);
      expect(FLOOR_TEMPLATES[floor].name, `floor ${floor}`).toBe('统治核心');
    }
  });

  it('guarantees exactly one drink and one meal on the summit', () => {
    for (const floor of FINALE_FLOORS) {
      const loot = FLOOR_TEMPLATES[floor].containers.flatMap((c) => c.loot);
      const water = loot.filter(
        (l) => l.guaranteed === true && (l.itemId === 'clean_water' || l.itemId === 'dirty_water'),
      );
      const food = loot.filter(
        (l) => l.guaranteed === true && (l.itemId === 'ration_pack' || l.itemId === 'bread'),
      );
      expect(water.length, `floor ${floor} must guarantee exactly one drink`).toBe(1);
      expect(food.length, `floor ${floor} has no guaranteed meal`).toBeGreaterThanOrEqual(1);
      // 一条就够：概率性的第二瓶水会让「分层盈余」的上限被悄悄踩穿。
      const anyWater = loot.filter((l) => l.itemId === 'clean_water' || l.itemId === 'dirty_water');
      expect(anyWater.length, `floor ${floor} hands out more than one drink`).toBe(1);
    }
  });

  it('uses only existing furniture art, 2-3 containers, and short labels', () => {
    for (const floor of FINALE_FLOORS) {
      const template = FLOOR_TEMPLATES[floor];
      // 终局层容器少而重：三件，一件一幕。
      expect(template.containers.length, `floor ${floor} container count`).toBeGreaterThanOrEqual(2);
      expect(template.containers.length, `floor ${floor} container count`).toBeLessThanOrEqual(3);
      const ids = new Set<string>();
      const xs = new Set<number>();
      for (const c of template.containers) {
        expect(containerTextureKey(c.id), `floor ${floor}/${c.id} has no furniture texture`).not.toBeNull();
        expect([...c.label].length, `floor ${floor}/${c.id} label "${c.label}"`).toBeLessThanOrEqual(3);
        expect(c.x, `floor ${floor}/${c.id} x`).toBeGreaterThan(0);
        expect(c.x, `floor ${floor}/${c.id} x`).toBeLessThan(FLOOR_WIDTH);
        ids.add(c.id);
        xs.add(c.x);
      }
      expect(ids.size, `floor ${floor} duplicate container id`).toBe(template.containers.length);
      expect(xs.size, `floor ${floor} overlapping containers`).toBe(template.containers.length);
      expect(template.description.length, `floor ${floor} description`).toBeGreaterThan(0);
    }
  });

  it('reproduces the same summit from the same seed', () => {
    for (const floor of FINALE_FLOORS) {
      expect(generateFloor(42, floor), `floor ${floor}`).toEqual(generateFloor(42, floor));
      expect(generateFloor(2026, floor).floorNumber, `floor ${floor}`).toBe(floor);
    }
  });

  it('hands out water and food on every QA seed', () => {
    for (const seed of [1, 42, 2026]) {
      const items = generateFloor(seed, 100000).containers.flatMap((c) => c.items);
      const water = items.filter((i) => i.itemId === 'clean_water' || i.itemId === 'dirty_water');
      const food = items.filter((i) => i.itemId === 'ration_pack' || i.itemId === 'bread');
      expect(water.length, `seed ${seed} summit hands out no water`).toBeGreaterThan(0);
      expect(food.length, `seed ${seed} summit hands out no food`).toBeGreaterThan(0);
    }
  });
});

// GHI-03 M1: keys must identify the item, not its slot in the template array.
// Index-based keys meant inserting one ground supply made a saved run's
// "already looted" marker point at the new item, so the old one respawned and
// the new one could never be picked up.
describe('loot keys identify the item, not its position (GHI-03 M1)', () => {
  it('ground keys come from the item and where it lies', () => {
    expect(groundItemKey('bread', 160)).toBe('g:bread:160');
    expect(groundItemKey('bread', 160)).not.toBe(groundItemKey('bread', 200));
    expect(groundItemKey('bread', 160)).not.toBe(groundItemKey('medkit', 160));
  });

  it('container keys come from the container and the item', () => {
    expect(containerItemKey('crate_wood', 'wood')).toBe('c:crate_wood:wood');
    expect(containerItemKey('crate_wood', 'wood')).not.toBe(containerItemKey('crate_metal', 'wood'));
    expect(containerItemKey('crate_wood', 'wood')).not.toBe(containerItemKey('crate_wood', 'tape'));
  });

  it('a ground item keeps its key when another is inserted before it', () => {
    expect(generateFloor(42, 5).groundItems.map((g) => g.key)).toEqual(['g:bread:160']);

    const original = FLOOR_TEMPLATES[5].ground;
    FLOOR_TEMPLATES[5].ground = [{ itemId: 'medkit', quantity: 1, x: 200 }, ...original];
    try {
      expect(generateFloor(42, 5).groundItems.map((g) => g.key)).toEqual(['g:medkit:200', 'g:bread:160']);
    } finally {
      FLOOR_TEMPLATES[5].ground = original;
    }
  });

  // The itemId-based container key assumes one entry per item per container.
  it('no floor lists the same ground supply twice', () => {
    for (const t of Object.values(FLOOR_TEMPLATES)) {
      const keys = t.ground.map((g) => groundItemKey(g.itemId, g.x));
      expect(new Set(keys).size, `floor ${t.floorNumber}`).toBe(keys.length);
    }
  });

  it('no container lists the same item twice', () => {
    for (const t of Object.values(FLOOR_TEMPLATES)) {
      for (const c of t.containers) {
        const ids = c.loot.map((l) => l.itemId);
        expect(new Set(ids).size, `floor ${t.floorNumber}/${c.id}`).toBe(ids.length);
      }
    }
  });
});

// GHI-03 m2: a guaranteed entry silently ignored its `max`, so
// {min:1, max:3, guaranteed:true} handed out 1 with no warning. Rolling the
// range would consume RNG and reshuffle every later roll in the container, so
// the range is rejected instead.
describe('guaranteed loot entries (GHI-03 m2)', () => {
  it('every shipped guaranteed entry is a single value', () => {
    for (const t of Object.values(FLOOR_TEMPLATES)) {
      for (const c of t.containers) {
        for (const l of c.loot) {
          if (l.guaranteed) expect(l.min, `floor ${t.floorNumber}/${c.id}/${l.itemId}`).toBe(l.max);
        }
      }
    }
  });

  it('rejects a guaranteed entry whose range is not a single value', () => {
    const original = FLOOR_TEMPLATES[1].containers;
    FLOOR_TEMPLATES[1].containers = original.map((c) => ({
      ...c,
      loot: c.loot.map((l) => (l.guaranteed ? { ...l, min: 1, max: 3 } : l)),
    }));
    try {
      expect(() => generateFloor(42, 1)).toThrow(/min === max/);
    } finally {
      FLOOR_TEMPLATES[1].containers = original;
    }
  });
});

// GHI-03 M2: the world identity is (LOOT_DATA_VERSION, runSeed), not runSeed
// alone — otherwise tuning a table silently reshuffles an existing world.
describe('the loot data version folds into every derived seed (GHI-03 M2)', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(LOOT_DATA_VERSION)).toBe(true);
    expect(LOOT_DATA_VERSION).toBeGreaterThan(0);
  });

  it('participates in the container seed derivation', () => {
    const seeded = containerLootSeed(42, 3, 'crate_metal');
    expect(seeded).toBe(deriveSeed(LOOT_DATA_VERSION, 42, 3, 'crate_metal'));
    expect(seeded).not.toBe(deriveSeed(42, 3, 'crate_metal'));
  });

  it('is stable for the same inputs', () => {
    expect(containerLootSeed(42, 3, 'crate_metal')).toBe(containerLootSeed(42, 3, 'crate_metal'));
    expect(containerLootSeed(42, 3, 'crate_metal')).not.toBe(containerLootSeed(42, 3, 'crate_wood'));
  });
});

describe('hasFloorContent', () => {
  it('is true for every authored floor and false for the unauthored ones', () => {
    for (const floor of PLAYABLE_FLOORS_V01) expect(hasFloorContent(floor), `floor ${floor}`).toBe(true);
    for (const floor of [11, 50, 99, 50011]) expect(hasFloorContent(floor), `floor ${floor}`).toBe(false);
  });

  it('treats the authored summit 100000 as content, not an alias', () => {
    // 100000 曾经靠 DEV_FLOOR_ALIAS 借用第 1 层模板，hasFloorContent 刻意对它
    // 说过假——电梯会因此把玩家放到宿舍布局上，而 HUD 写着 100000。终局创作后
    // 别名已删除，这一层是真内容：电梯从 50010 接通（见 segments.test.ts 的
    // liftOutcome），generateFloor 返回统治核心自己的布局。
    expect(hasFloorContent(100000)).toBe(true);
    expect(generateFloor(42, 100000).name).toBe('统治核心');
  });
});
