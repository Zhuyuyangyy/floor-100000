import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { addItem, countItem } from '../systems/InventorySystem';
import {
  BUNK_DISMANTLE_COST,
  BUNK_SEARCH_COST,
  bunkDismantleTool,
  bunkGoneKey,
  bunkSearchKey,
  dismantleBunk,
  isBunkDismantled,
  isBunkSearched,
  searchBunk,
} from '../systems/LootSystem';
import { FLOOR_TEMPLATES } from '../data/floorTemplates';
import { PLAYABLE_FLOORS_V01, STARTING_FLOOR } from '../core/constants';
import { ITEM_IDS, getItem } from '../data/items';
import type { GameState, ItemId } from '../core/gameTypes';

// AG-51：工作台入口 + 床铺搜刮/拆解的数据面钉桩。
//
// 场景侧（点击走位 -> onInteract -> 动画/flash/清场）由 Playwright 实测
// （e2e/ag51-bunk-workbench.spec.ts，端口 5451）；这里钉的是它依赖的
// 全部纯逻辑：
//   1. 概率走 seeded RNG——同 seed 同结果，换 seed 才换手气，禁 Math.random；
//   2. 「每天一次」的次数限制真实存在，且不因为重复调用二次入包；
//   3. 拆解要工具（撬棍/消防斧），刃具三件拆不动；全有或全无，背包满不吞床；
//   4. survivalBalance 硬边界：床铺只出材料，一滴水一份食都不碰——每层
//      恰好一瓶 guaranteed 水 + 一份食物不许被床改写。

const DORM_BED = 'dorm_bed_236'; // 1 层前排第一张室友床（DORM_FRONT_BEDS[0]）
const OWN_BED = 'own_bed';

function give(state: GameState, items: Array<[ItemId, number]>): void {
  for (const [id, n] of items) addItem(state.player.inventory, id, n);
}

/** 把包塞满 12 格（不可叠、互不相同），逼出 overflow 分支。 */
function fillBagWithUnstackables(state: GameState): void {
  give(state, [
    ['clean_water', 99],
    ['ration_pack', 99],
    ['bread', 99],
    ['medkit', 99],
    ['battery', 99],
    ['scrap_metal', 99],
    ['wood', 99],
    ['cloth', 99],
    ['tape', 99],
    ['filter', 99],
    ['wire', 99],
    ['fuse', 99],
  ]);
}

describe('bunk search rolls on seeded RNG (AG-51)', () => {
  it('same (seed, floor, bunk, day) always yields the same take', () => {
    const a = createNewGame(42);
    const b = createNewGame(42);
    const ra = searchBunk(a, STARTING_FLOOR, DORM_BED);
    const rb = searchBunk(b, STARTING_FLOOR, DORM_BED);
    expect(ra.took).toEqual(rb.took);
    expect(ra.already).toBe(false);
  });

  it('a different day is a different roll, still deterministic', () => {
    const day1 = createNewGame(42);
    const day1Again = createNewGame(42);
    const r1 = searchBunk(day1, STARTING_FLOOR, DORM_BED);
    const r1Again = searchBunk(day1Again, STARTING_FLOOR, DORM_BED);
    expect(r1.took).toEqual(r1Again.took);

    const day2 = createNewGame(42);
    day2.day = 2;
    const r2 = searchBunk(day2, STARTING_FLOOR, DORM_BED);
    const day2Again = createNewGame(42);
    day2Again.day = 2;
    expect(r2.took).toEqual(searchBunk(day2Again, STARTING_FLOOR, DORM_BED).took);
    // 换天是换手气，不保证东西变多——但两条结果都必须是合法材料堆。
    for (const s of [...r1.took, ...r2.took]) {
      expect(getItem(s.itemId).category).toBe('material');
      expect(s.quantity).toBeGreaterThan(0);
    }
  });

  it('every roll over many seeds is materials only — no water, no food', () => {
    // survivalBalance 的硬边界：床垫底下翻出来的东西不许改写生存曲线。
    const food = new Set<ItemId>(['clean_water', 'dirty_water', 'ration_pack', 'bread', 'medkit']);
    for (const seed of [1, 42, 2026, 7, 99, 1234, 55555, 987654]) {
      const s = createNewGame(seed);
      const r = searchBunk(s, STARTING_FLOOR, DORM_BED);
      for (const stack of r.took) {
        expect(food.has(stack.itemId), `seed ${seed} 翻出了 ${stack.itemId}`).toBe(false);
      }
    }
  });

  it('the daily limit is real: a second press the same day takes nothing new', () => {
    const s = createNewGame(42);
    searchBunk(s, STARTING_FLOOR, DORM_BED);
    const before = s.player.inventory.slots.map((x) => ({ ...x }));
    const second = searchBunk(s, STARTING_FLOOR, DORM_BED);
    expect(second.already).toBe(true);
    expect(second.took).toEqual([]);
    expect(s.player.inventory.slots).toEqual(before);
    // 翻过标记写进 visitedFloors——存档重进不会重置成"没翻过"。
    expect(isBunkSearched(s, STARTING_FLOOR, DORM_BED)).toBe(true);
    expect(s.visitedFloors[STARTING_FLOOR]?.lootedItems).toContain(bunkSearchKey(STARTING_FLOOR, DORM_BED, s.day));
  });

  it('tomorrow is a fresh bed: the key carries the day', () => {
    const s = createNewGame(42);
    searchBunk(s, STARTING_FLOOR, DORM_BED);
    s.day = 2;
    expect(isBunkSearched(s, STARTING_FLOOR, DORM_BED)).toBe(false);
    const again = searchBunk(s, STARTING_FLOOR, DORM_BED);
    expect(again.already).toBe(false);
  });

  it('a full bag refuses the roll and leaves the bed unsearched — nothing is lost', () => {
    const s = createNewGame(42);
    fillBagWithUnstackables(s);
    const r = searchBunk(s, STARTING_FLOOR, DORM_BED);
    // 12 格全占且每格 99：任何新材料都进不来。
    expect(r.full).toBe(true);
    expect(r.took).toEqual([]);
    // 床不算翻过：腾出包当天还能再来，今天的 roll 不被背包吞掉。
    expect(r.already).toBe(false);
    expect(isBunkSearched(s, STARTING_FLOOR, DORM_BED)).toBe(false);
    // 腾出格子再搜，应当有所收获——同一 seed 的 roll 是确定的。
    s.player.inventory.slots.splice(9, 3);
    const retry = searchBunk(s, STARTING_FLOOR, DORM_BED);
    expect(retry.already).toBe(false);
    expect(retry.took.length).toBeGreaterThan(0);
    expect(isBunkSearched(s, STARTING_FLOOR, DORM_BED)).toBe(true);
  });

  it('the player own bed rolls through the same function — its own key space', () => {
    const s = createNewGame(42);
    const r = searchBunk(s, STARTING_FLOOR, OWN_BED);
    expect(r.already).toBe(false);
    expect(isBunkSearched(s, STARTING_FLOOR, OWN_BED)).toBe(true);
    // 自己的床与室友床互不干扰：两张床两个键。
    expect(isBunkSearched(s, STARTING_FLOOR, DORM_BED)).toBe(false);
    const second = searchBunk(s, STARTING_FLOOR, OWN_BED);
    expect(second.already).toBe(true);
  });

  it('bunk keys never collide with container loot keys', () => {
    const s = createNewGame(42);
    searchBunk(s, STARTING_FLOOR, DORM_BED);
    const keys = s.visitedFloors[STARTING_FLOOR]?.lootedItems ?? [];
    // 容器键形如 `c:<containerId>:<itemId>`；床键自带前缀，两个空间不相交。
    expect(keys.some((k) => k.startsWith('bunksearch:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('c:'))).toBe(false);
  });
});

describe('bunk dismantling needs a tool (AG-51)', () => {
  it('bare hands cannot pull a bed frame apart', () => {
    const s = createNewGame(42);
    searchBunk(s, STARTING_FLOOR, DORM_BED); // 翻过才轮得到拆
    const r = dismantleBunk(s, STARTING_FLOOR, DORM_BED);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('撬棍或消防斧');
    expect(isBunkDismantled(s, STARTING_FLOOR, DORM_BED)).toBe(false);
    expect(countItem(s.player.inventory, 'wood')).toBe(0);
  });

  it('the crowbar and the fire axe work; the three blades do not', () => {
    // 撬棍（撬）与消防斧（砍）拆得动榫死的木床架；匕首/短剑/砍刀是搏命与
    // 厨具，拆家具是专业不对口——给刃具开口子等于"任何武器都是万能工具"。
    for (const tool of ['crowbar', 'fire_axe'] as ItemId[]) {
      const s = createNewGame(42);
      searchBunk(s, STARTING_FLOOR, DORM_BED);
      give(s, [[tool, 1]]);
      expect(bunkDismantleTool(s.player.inventory)).toBe(tool);
      const r = dismantleBunk(s, STARTING_FLOOR, DORM_BED);
      expect(r.ok, `${tool} 应该拆得动`).toBe(true);
      expect(isBunkDismantled(s, STARTING_FLOOR, DORM_BED)).toBe(true);
      expect(countItem(s.player.inventory, 'wood')).toBeGreaterThanOrEqual(2);
      expect(countItem(s.player.inventory, 'cloth')).toBeGreaterThanOrEqual(1);
      // 工具不消耗：撬完棍还在。
      expect(countItem(s.player.inventory, tool)).toBe(1);
    }
    for (const blade of ['dagger', 'short_sword', 'cleaver'] as ItemId[]) {
      const s = createNewGame(42);
      searchBunk(s, STARTING_FLOOR, DORM_BED);
      give(s, [[blade, 1]]);
      expect(bunkDismantleTool(s.player.inventory)).toBeNull();
      const r = dismantleBunk(s, STARTING_FLOOR, DORM_BED);
      expect(r.ok, `${blade} 不该拆得动`).toBe(false);
      expect(isBunkDismantled(s, STARTING_FLOOR, DORM_BED)).toBe(false);
    }
  });

  it('yields wood and cloth within the pinned bands, deterministically', () => {
    const a = createNewGame(42);
    searchBunk(a, STARTING_FLOOR, DORM_BED);
    give(a, [['crowbar', 1]]);
    const ra = dismantleBunk(a, STARTING_FLOOR, DORM_BED);
    const b = createNewGame(42);
    searchBunk(b, STARTING_FLOOR, DORM_BED);
    give(b, [['crowbar', 1]]);
    const rb = dismantleBunk(b, STARTING_FLOOR, DORM_BED);
    expect(ra.took).toEqual(rb.took);
    const wood = ra.took.find((t) => t.itemId === 'wood');
    const cloth = ra.took.find((t) => t.itemId === 'cloth');
    expect(wood).toBeDefined();
    expect(cloth).toBeDefined();
    expect(wood!.quantity).toBeGreaterThanOrEqual(2);
    expect(wood!.quantity).toBeLessThanOrEqual(4);
    expect(cloth!.quantity).toBeGreaterThanOrEqual(1);
    expect(cloth!.quantity).toBeLessThanOrEqual(3);
    // 拆过就没了：第二拆连工具带床一起拒绝。
    const second = dismantleBunk(a, STARTING_FLOOR, DORM_BED);
    expect(second.ok).toBe(false);
    expect(second.reason).toContain('已经拆掉');
  });

  it('a full bag refuses the whole dismantle — the bed stays, nothing is lost', () => {
    // 一次性动作不能因为背包满被吞：全 undo、不标记，床留着。
    const s = createNewGame(42);
    searchBunk(s, STARTING_FLOOR, DORM_BED);
    give(s, [['crowbar', 1]]);
    fillBagWithUnstackables(s);
    const r = dismantleBunk(s, STARTING_FLOOR, DORM_BED);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('背包已满');
    expect(isBunkDismantled(s, STARTING_FLOOR, DORM_BED)).toBe(false);
    // 腾出两格再来，应当成功。
    s.player.inventory.slots.splice(10, 2);
    const retry = dismantleBunk(s, STARTING_FLOOR, DORM_BED);
    expect(retry.ok).toBe(true);
  });

  it('the gone key is permanent — it carries no day', () => {
    const s = createNewGame(42);
    searchBunk(s, STARTING_FLOOR, DORM_BED);
    give(s, [['crowbar', 1]]);
    dismantleBunk(s, STARTING_FLOOR, DORM_BED);
    s.day = 5;
    expect(isBunkDismantled(s, STARTING_FLOOR, DORM_BED)).toBe(true);
    expect(s.visitedFloors[STARTING_FLOOR]?.lootedItems).toContain(bunkGoneKey(STARTING_FLOOR, DORM_BED));
  });

  it('dismantling does not require having searched first (pure-function level)', () => {
    // 场景层的次数门是"翻过才递拆解"；纯函数只认工具。这条钉住分层，
    // 免得将来有人把 UX 决策偷偷挪进数据层。
    const s = createNewGame(42);
    give(s, [['fire_axe', 1]]);
    const r = dismantleBunk(s, STARTING_FLOOR, DORM_BED);
    expect(r.ok).toBe(true);
  });
});

describe('the survival hard boundary holds (AG-51)', () => {
  it('no floor carries a second guaranteed drink; 6+ floors keep exactly one water and one meal', () => {
    // AG-51 没碰 floorTemplates 的一个字节——这条钉的是「床铺系统不许往
    // 楼层模板里掺水食」。真实 invariant（逐层探明）：任何层都不许多一瓶
    // guaranteed 水（survivalBalance 的 surplusCeiling 就抓这个）；6 层以上
    // 每层恰好一水一食（5 层是首章终点多一份饭，1-4 层水从起点道具/铁箱来）。
    const DRINKS = new Set<ItemId>(['clean_water', 'dirty_water']);
    const MEALS = new Set<ItemId>(['ration_pack', 'bread']);
    for (const floor of PLAYABLE_FLOORS_V01) {
      const t = FLOOR_TEMPLATES[floor];
      let drinks = 0;
      let meals = 0;
      for (const c of t.containers) {
        for (const l of c.loot) {
          if (!l.guaranteed) continue;
          if (DRINKS.has(l.itemId as ItemId)) drinks += 1;
          if (MEALS.has(l.itemId as ItemId)) meals += 1;
        }
      }
      expect(drinks, `F${floor} guaranteed 水至多一瓶`).toBeLessThanOrEqual(1);
      if (floor >= 6) {
        expect(drinks, `F${floor} guaranteed 水`).toBe(1);
        expect(meals, `F${floor} guaranteed 食物`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('floor 1 keeps its single cabinet — the workbench was never a container', () => {
    // 1 层模板只有储物柜（guaranteed 净水）。工作台是场景纯家具
    // （CRAFT_X 的 furn_workbench），楼层视图里没有它的一行——「点工作台
    // 开制作面板」因此不可能抢走任何 guaranteed 物资。
    const ids = FLOOR_TEMPLATES[STARTING_FLOOR].containers.map((c) => c.id);
    expect(ids).toEqual(['cabinet']);
    expect(FLOOR_TEMPLATES[STARTING_FLOOR].containers[0].loot[0]).toMatchObject({
      itemId: 'clean_water',
      guaranteed: true,
      min: 1,
      max: 1,
    });
  });

  it('bunk search and dismantle never put a consumable in the bag', () => {
    const consumables = new Set<ItemId>(
      ITEM_IDS.filter((id) => getItem(id).category === 'consumable'),
    );
    for (const seed of [1, 42, 2026]) {
      const s = createNewGame(seed);
      const before = new Map(s.player.inventory.slots.map((x) => [x.itemId, x.quantity]));
      searchBunk(s, STARTING_FLOOR, DORM_BED);
      give(s, [['crowbar', 1]]);
      dismantleBunk(s, STARTING_FLOOR, DORM_BED);
      for (const slot of s.player.inventory.slots) {
        const delta = slot.quantity - (before.get(slot.itemId) ?? 0);
        if (delta > 0 && slot.itemId !== 'crowbar') {
          expect(consumables.has(slot.itemId), `seed ${seed} 多了 ${slot.itemId}`).toBe(false);
        }
      }
    }
  });
});

describe('bunk cost constants come from the balance file (AG-51)', () => {
  it('search is cheaper than dismantle, and both cost time', () => {
    expect(BUNK_SEARCH_COST).toBeGreaterThan(0);
    expect(BUNK_DISMANTLE_COST).toBeGreaterThan(BUNK_SEARCH_COST);
  });
});
