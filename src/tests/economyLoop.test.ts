import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { getFloorView, lootContainer, lootGround } from '../systems/LootSystem';
import { addItem, countItem, isBagFull, useConsumable } from '../systems/InventorySystem';
import { STORAGE_RACK_SLOTS, canCraft, craft, hasUpgrade, purifyWater, recipeTierLocked } from '../systems/CraftingSystem';
import { buy, sell, sellPrice, shopStock } from '../systems/shop';
import { sleep } from '../systems/SurvivalSystem';
import { trade } from '../systems/TradeSystem';
import { deserialize, serialize, validateGameState } from '../systems/SaveSystem';
import { grantGrowthXp, GROWTH_MAX_LEVEL } from '../core/growth';
import { NPCS } from '../data/npcs';
import { ITEM_IDS, getItem } from '../data/items';
import { RECIPES } from '../data/recipes';
import type { GameState, ItemId } from '../core/gameTypes';

// B5：资源经济闭环测试。四条硬性质：
//   1. 闭环不断裂——获取→消费→制作→交易→基地这条链能整轮走通；
//   2. 守恒——任何一次交易/制作/净化都不凭空产生或消灭物品与金币；
//   3. 价格一致——收购价全世界统一、卖出永不超过买入、熟人折扣只打在
//      买价上且 round-trip 仍然亏损（不制造套利循环）；
//   4. 同 seed 可复现——同样操作序列在任何两次运行里给出逐字段相同的结果。

function give(state: GameState, items: Array<[ItemId, number]>): void {
  for (const [id, n] of items) addItem(state.player.inventory, id, n);
}

// The material floors, looted exactly the way survivalBalance.test.ts does it:
// floors 3 and 4 hold the guaranteed wood/tape/scrap/filter/wire/fuse/cloth.
const MATERIAL_FLOORS = [3, 4];

function lootFloors(state: GameState, floors: number[]): void {
  for (const floor of floors) {
    const view = getFloorView(state, floor);
    for (const c of view.containers) lootContainer(state, floor, c.id);
    for (const g of view.groundItems) lootGround(state, floor, g.key);
  }
}

function lootMaterialFloors(state: GameState): void {
  lootFloors(state, MATERIAL_FLOORS);
}

/** 每件物品的持有数快照（只记非零，便于对账比较），用于守恒对账。 */
function itemLedger(state: GameState): Map<ItemId, number> {
  const out = new Map<ItemId, number>();
  for (const id of ITEM_IDS) {
    const n = countItem(state.player.inventory, id);
    if (n !== 0) out.set(id, n);
  }
  return out;
}

function ledgerDiff(before: Map<ItemId, number>, after: Map<ItemId, number>): Map<ItemId, number> {
  const out = new Map<ItemId, number>();
  for (const id of ITEM_IDS) {
    const d = (after.get(id) ?? 0) - (before.get(id) ?? 0);
    if (d !== 0) out.set(id, d);
  }
  return out;
}

describe('the loop closes end to end (B5 break: the chain used to stop at the workbench)', () => {
  it('loot → craft → purify → sell → buy → consume → sleep, every link answering', () => {
    const s = createNewGame(1);
    // 先 4 后 3：维修层的 6 瓶脏水必须进包（净化环节的原料）。按 [3,4] 顺序
    // 搜会把 12 格背包占满，储水罐的脏水 overflow 掉——那正是"背包是真实
    // 约束"的又一例，但本测试要验的是闭环，所以给脏水让路。
    lootFloors(s, [4, 3]);

    // 制作：三件设施全可建——木材归门（置物架与门共享木材，本轮先建门）。
    expect(craft(s, 'lamp').ok).toBe(true);
    expect(craft(s, 'reinforced_door').ok).toBe(true);
    expect(craft(s, 'purifier').ok).toBe(true);

    // 净化：维修层 6 瓶脏水一次炼成净水（批量是 NPC 小周不做的）。
    const dirtyBefore = countItem(s.player.inventory, 'dirty_water');
    const cleanBefore = countItem(s.player.inventory, 'clean_water');
    expect(dirtyBefore).toBeGreaterThan(0);
    const purified = purifyWater(s);
    expect(purified.ok).toBe(true);
    if (purified.ok) expect(purified.converted).toBe(dirtyBefore);
    expect(countItem(s.player.inventory, 'clean_water')).toBe(cleanBefore + dirtyBefore);

    // 交易：材料第一次有了收购价，卖 fuse/电池换到来金币。
    // gold 从 0 起（createNewGame），10 金是前几趟搜刮的结余——本轮只验证
    // 各环节咬合，不假设玩家第一天就买得起水。
    s.player.gold = 10;
    expect(sell(s, 'fuse', 4).ok).toBe(true);
    expect(sell(s, 'battery', 4).ok).toBe(true);
    expect(s.player.gold).toBeGreaterThanOrEqual(15);

    // 买入：用变现的钱买一瓶净水（4 层商人的货）。
    const goldBeforeBuy = s.player.gold;
    const bought = buy(s, 'clean_water', 4);
    expect(bought.ok).toBe(true);
    const shelf = shopStock(4).find((e) => e.itemId === 'clean_water')!.price;
    expect(s.player.gold).toBe(goldBeforeBuy - shelf); // connections 1 级无折扣，按标价

    // 消费：喝一瓶，thirst 上涨，survival 线第一次拿到经验。
    const thirstBefore = s.player.thirst;
    const survivalBefore = s.growth?.survival.totalXp ?? 0;
    const drunk = useConsumable(s, 'clean_water');
    expect(drunk.ok).toBe(true);
    expect(s.player.thirst).toBeGreaterThan(thirstBefore);
    expect(s.growth?.survival.totalXp ?? 0).toBe(survivalBefore + 5);

    // 安睡：跨天 + survival +10。
    s.gameMinuteOfDay = 1200;
    const dayBefore = s.day;
    expect(sleep(s).ok).toBe(true);
    expect(s.day).toBe(dayBefore + 1);
    expect(s.growth?.survival.totalXp ?? 0).toBe(survivalBefore + 15);

    // 基地：设施在册、每条升级都有配方三件套（成本/前置/效果见各自测试）。
    for (const id of ['lamp', 'reinforced_door', 'purifier'] as const) {
      expect(hasUpgrade(s, id)).toBe(true);
      expect(RECIPES.find((r) => r.id === id)?.cost).toBeDefined();
    }

    // 成长线：买卖都喂了 wealth 线。
    expect(s.growth?.wealth.totalXp ?? 0).toBe(2 * 5 + 10); // 两次出售 +5，一次购买 +10
  });

  it('every material has a sink — nothing is buy-only anymore', () => {
    // 静态审计（修前：8 件材料的唯一出口是配方，建完之后压箱底；撬棍连配方
    // 都没有）。现在每件物品至少满足其一：被配方消耗 / 有 >1 的收购价 /
    //  consumable 有效果 / tool 有读取方。
    const sinkOf = new Map<ItemId, string>();
    for (const r of RECIPES) {
      for (const id of Object.keys(r.cost) as ItemId[]) {
        sinkOf.set(id, `配方 ${r.id}`);
      }
    }
    const orphan: string[] = [];
    for (const id of ITEM_IDS) {
      const item = getItem(id);
      if (sinkOf.has(id)) continue; // 有配方消耗
      if (item.category === 'consumable') {
        if (!item.effect && id !== 'dirty_water') orphan.push(`${id}（无效果的 consumable）`);
        continue; // 脏水：purifier/小周 1:1 是它的设计内出口
      }
      if (sellPrice(id, 2) > 1) continue; // 商人收购
      // 剩下的工具必须有效果读取方，否则就是死物品
      if (id === 'flashlight') continue; // nightOverlayAlpha 读它（blackout 照明）
      orphan.push(`${id}（无配方、无收购价、无效果）`);
    }
    expect(orphan).toEqual([]);
    // 撬棍现在有配方 sink 了（置物架），不再靠"商店能卖"活着。
    expect(sinkOf.get('crowbar')).toBe('配方 storage_rack');
  });
});

describe('conservation: nothing is created or destroyed (B5)', () => {
  it('buy moves exactly one item and the exact gold, no more', () => {
    const s = createNewGame(1);
    s.player.gold = 100;
    const itemsBefore = itemLedger(s);
    const goldBefore = s.player.gold;
    const price = shopStock(4).find((e) => e.itemId === 'medkit')!.price;
    expect(buy(s, 'medkit', 4).ok).toBe(true);
    expect(s.player.gold).toBe(goldBefore - price);
    const diff = ledgerDiff(itemsBefore, itemLedger(s));
    expect(diff).toEqual(new Map([['medkit', 1]]));
  });

  it('sell moves exactly one item and the exact gold, no more', () => {
    const s = createNewGame(1);
    give(s, [['fuse', 2]]);
    const itemsBefore = itemLedger(s);
    const goldBefore = s.player.gold;
    expect(sell(s, 'fuse', 4).ok).toBe(true);
    expect(s.player.gold).toBe(goldBefore + sellPrice('fuse', 4));
    expect(ledgerDiff(itemsBefore, itemLedger(s))).toEqual(new Map([['fuse', -1]]));
  });

  it('a refused trade changes nothing at all — not gold, not items, not XP', () => {
    const s = createNewGame(1); // gold 0
    give(s, [['fuse', 1]]);
    const itemsBefore = itemLedger(s);
    const wealthBefore = s.growth?.wealth.totalXp ?? 0;
    expect(buy(s, 'clean_water', 4).ok).toBe(false); // 买不起
    expect(sell(s, 'crowbar', 4).ok).toBe(false); // 没有
    expect(s.player.gold).toBe(0);
    expect(itemLedger(s)).toEqual(itemsBefore);
    expect(s.growth?.wealth.totalXp ?? 0).toBe(wealthBefore);
  });

  it('purify converts 1:1 and conserves the total water count', () => {
    const s = createNewGame(1);
    give(s, [['scrap_metal', 2], ['filter', 1], ['wire', 1]]);
    expect(craft(s, 'purifier').ok).toBe(true);
    give(s, [['dirty_water', 5]]);
    const totalBefore = countItem(s.player.inventory, 'clean_water') + countItem(s.player.inventory, 'dirty_water');
    expect(purifyWater(s).ok).toBe(true);
    expect(countItem(s.player.inventory, 'dirty_water')).toBe(0);
    expect(countItem(s.player.inventory, 'clean_water') + countItem(s.player.inventory, 'dirty_water')).toBe(totalBefore);
  });

  it('craft deducts exactly the recipe cost and produces no item stacks', () => {
    const s = createNewGame(1);
    give(s, [['battery', 1], ['wire', 1], ['scrap_metal', 1]]);
    const before = itemLedger(s);
    expect(craft(s, 'lamp').ok).toBe(true);
    expect(ledgerDiff(before, itemLedger(s))).toEqual(new Map([['battery', -1], ['wire', -1], ['scrap_metal', -1]]));
    expect(hasUpgrade(s, 'lamp')).toBe(true);
  });

  it('barter converts, it does not print', () => {
    const s = createNewGame(1);
    give(s, [['scrap_metal', 1]]);
    const before = itemLedger(s);
    const r = trade(s, NPCS[0].offers[0]); // 阿林：1 废金属 → 1 电线
    expect(r.ok).toBe(true);
    expect(ledgerDiff(before, itemLedger(s))).toEqual(new Map([['scrap_metal', -1], ['wire', 1]]));
  });

  it('the whole run reconciles: summed ledger equals the final state', () => {
    // 整局总账：从开局状态开始，把每一步的预期进出写成账本，终态必须分毫不差。
    const s = createNewGame(7);
    lootMaterialFloors(s);
    give(s, [['scrap_metal', 1], ['filter', 1], ['wire', 1]]); // 补一组净水器材料
    s.player.gold = 30; // 此前几趟的结余——本局的金币起点
    const opening = itemLedger(s);
    let gold = 30;

    expect(craft(s, 'lamp').ok).toBe(true);
    expect(craft(s, 'purifier').ok).toBe(true);
    purifyWater(s);
    expect(sell(s, 'fuse', 4).ok).toBe(true); gold += 5;
    expect(sell(s, 'filter', 4).ok).toBe(true); gold += 4;
    expect(buy(s, 'ration_pack', 5).ok).toBe(true);
    gold -= shopStock(5).find((e) => e.itemId === 'ration_pack')!.price;
    expect(useConsumable(s, 'ration_pack').ok).toBe(true);

    // 对账：账本 = 开局 - 配方成本 - 卖出 + 买入 + 净化转换 + 喝掉
    const expected = new Map<ItemId, number>(opening);
    const sub = (id: ItemId, n: number): void => { expected.set(id, (expected.get(id) ?? 0) - n); };
    const add = (id: ItemId, n: number): void => { expected.set(id, (expected.get(id) ?? 0) + n); };
    for (const r of [RECIPES.find((x) => x.id === 'lamp')!, RECIPES.find((x) => x.id === 'purifier')!]) {
      for (const [id, n] of Object.entries(r.cost) as Array<[ItemId, number]>) sub(id, n);
    }
    const dirty = opening.get('dirty_water') ?? 0;
    sub('dirty_water', dirty);
    add('clean_water', dirty);
    sub('fuse', 1);
    sub('filter', 1);
    add('ration_pack', 1);
    sub('ration_pack', 1); // 喝掉
    for (const [id, n] of expected) if (n === 0) expected.delete(id);

    expect(itemLedger(s)).toEqual(expected);
    expect(s.player.gold).toBe(gold);
  });
});

describe('price consistency (B5 break: materials had no price at all)', () => {
  it('materials have one global price — the same on floor 2 and floor 50000', () => {
    for (const id of ['fuse', 'filter', 'battery', 'wire', 'scrap_metal', 'cloth', 'wood', 'tape'] as ItemId[]) {
      expect(sellPrice(id, 2)).toBe(sellPrice(id, 50000));
      expect(sellPrice(id, 2)).toBeGreaterThan(1); // 不再跌 1 金地板价
    }
  });

  it('sell never reaches the shelf price, on every band', () => {
    for (const band of [2, 3, 4, 5]) {
      for (const e of shopStock(band)) {
        expect(sellPrice(e.itemId, band)).toBeLessThan(e.price);
      }
    }
  });

  it('round-trips at a loss, at every connections level — the discount never arbitrages', () => {
    // 熟人折扣只打在买价上（shop.shelfPrice），卖价保持半价，所以 connections
    // 满级也只是"买得便宜"，低买高卖依旧亏钱。
    // 从 1 级爬到目标等级所需的累计经验：sum(100*i, i=1..level-1)。
    const xpToReach = (level: number): number => (100 * (level - 1) * level) / 2;
    for (const level of [1, 5, GROWTH_MAX_LEVEL]) {
      const s = createNewGame(1);
      s.player.gold = 200;
      grantGrowthXp(s, 'connections', xpToReach(level));
      expect(s.growth?.connections.level).toBe(level);
      buy(s, 'bread', 2);
      const paid = 200 - s.player.gold;
      sell(s, 'bread', 2);
      const got = s.player.gold - (200 - paid);
      expect(paid).toBeGreaterThan(got); // 永远亏
      expect(paid).toBeGreaterThanOrEqual(1); // 买价永不低于 1 金
      // 等级越高折扣越深（12 → 12 → 9），但从不免费
      if (level === 1) expect(paid).toBe(12);
      // 10 级倍率 1-0.03×9=0.73（PRICE_MIN 0.7 要到 11 级才夹到，不存在）：
      // 12 × 0.73 = 8.76 → 9，仍高于卖价 6——折扣再深也不套利。
      if (level === GROWTH_MAX_LEVEL) expect(paid).toBe(9);
    }
  });

  it('the connections discount only lowers the buy side', () => {
    const s = createNewGame(1);
    grantGrowthXp(s, 'connections', 5000); // 满级：0.7 折
    s.player.gold = 200;
    give(s, [['bread', 1]]);
    const plain = createNewGame(1);
    plain.player.gold = 200;
    buy(s, 'bread', 2); // 12 × 0.73 = 8.76 → 9（10 级倍率 0.73，见 round-trip 测试）
    buy(plain, 'bread', 2); // 12
    expect(200 - s.player.gold).toBe(9);
    expect(200 - plain.player.gold).toBe(12);
    // 卖价不受人脉影响：两边都卖 6
    const goldBeforeSell = s.player.gold;
    expect(sell(s, 'bread', 2).ok).toBe(true);
    expect(s.player.gold - goldBeforeSell).toBe(6);
  });

  it('tier-1 guaranteed materials sell for ~32 gold — scavenging finally monetises', () => {
    // 收购价表的复算锚：tier 1 保底材料全卖 ≈ 2 瓶水 + 1 份口粮，永远低于
    // "拿 scrap+filter+wire 换净水器"的价值——卖料买食不会成为更优解。
    const s = createNewGame(1);
    give(s, [['fuse', 1], ['filter', 1], ['battery', 1], ['wire', 2], ['scrap_metal', 3], ['cloth', 1], ['wood', 2], ['tape', 1]]);
    s.player.gold = 0;
    for (const id of ['fuse', 'filter', 'battery', 'wire', 'scrap_metal', 'cloth', 'wood', 'tape'] as ItemId[]) {
      const have = countItem(s.player.inventory, id);
      for (let i = 0; i < have; i++) expect(sell(s, id, 4).ok).toBe(true);
    }
    expect(s.player.gold).toBe(5 + 4 + 3 + 3 * 2 + 2 * 3 + 2 + 2 * 2 + 2); // 32
  });
});

describe('same seed, same result (determinism)', () => {
  it('two runs with identical inputs end in identical states', () => {
    const run = (): GameState => {
      const s = createNewGame(2026);
      lootMaterialFloors(s);
      s.player.gold = 20;
      craft(s, 'lamp');
      sell(s, 'fuse', 4);
      sell(s, 'filter', 4);
      buy(s, 'clean_water', 4);
      useConsumable(s, 'clean_water');
      s.gameMinuteOfDay = 1200;
      sleep(s);
      return s;
    };
    const a = run();
    const b = run();
    expect(a.player.gold).toBe(b.player.gold);
    expect(a.player.inventory.slots).toEqual(b.player.inventory.slots);
    expect(a.growth).toEqual(b.growth);
    expect(a.player.homeUpgrades).toEqual(b.player.homeUpgrades);
  });

  it('the favour-free shop has no hidden randomness across days', () => {
    // shop 不读 day/seed 定价（材料价全局固定，商品价按 band），同一天内
    // 反复买卖同价——这是"同 seed 交易可复现"的最低要求。
    const s = createNewGame(9);
    s.player.gold = 500;
    const p1 = ((): number => { buy(s, 'bread', 2); return 500 - s.player.gold; })();
    const p2 = ((): number => { sell(s, 'bread', 2); buy(s, 'bread', 2); return s.player.gold; })();
    expect(p1).toBe(12);
    expect(p2).toBe(500 - 12 + 6 - 12); // 卖 6 买 12
    expect(s.player.gold).toBe(482);
  });
});

describe('the base grows: storage rack and its honest effect (B5 break: crowbar had no sink)', () => {
  it('crafting the rack adds exactly two persistent bag slots', () => {
    const s = createNewGame(1);
    expect(s.player.inventory.slotCount).toBe(12);
    give(s, [['wood', 2], ['cloth', 1], ['crowbar', 1]]);
    expect(craft(s, 'storage_rack').ok).toBe(true);
    expect(s.player.inventory.slotCount).toBe(12 + STORAGE_RACK_SLOTS);
  });

  it('the bigger bag really holds more, and still reports full correctly', () => {
    const s = createNewGame(1);
    give(s, [['wood', 2], ['cloth', 1], ['crowbar', 1]]);
    craft(s, 'storage_rack');
    // 开局 3 格（净水/口粮/手电）。craft 扣掉了 wood/cloth/crowbar，剩 3 格；
    // 再塞 11 件各占一格的东西到 14：9 种新材料 + 重新拿的木材 + 撬棍
    // （crowbar 已被置物架吃掉，包里没有，不可堆叠，独占一格）。
    for (const id of ['battery', 'scrap_metal', 'tape', 'filter', 'wire', 'fuse', 'dirty_water', 'bread', 'medkit'] as ItemId[]) {
      addItem(s.player.inventory, id, 1);
    }
    addItem(s.player.inventory, 'wood', 1);
    addItem(s.player.inventory, 'crowbar', 1);
    expect(s.player.inventory.slots.length).toBe(14);
    expect(isBagFull(s.player.inventory)).toBe(true);
    // 第 15 件放不下（手电不可堆叠且包里已有一支，只能占新格）
    expect(addItem(s.player.inventory, 'flashlight', 1).overflow).toBe(1);
  });

  it('the rack survives a save round-trip and still validates', () => {
    const s = createNewGame(1);
    give(s, [['wood', 2], ['cloth', 1], ['crowbar', 1]]);
    craft(s, 'storage_rack');
    const back = deserialize(serialize(s));
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.state.player.inventory.slotCount).toBe(14);
      expect(validateGameState(back.state)).toEqual([]);
    }
  });

  it('shares its timber with the door, so the choice between them is real', () => {
    // 稀缺性保持：置物架刻意不吃 scrap（tier 1 保底 scrap 恰好 lamp+purifier
    // 三件，survivalBalance 钉死），但它与门共享 wood——先建门就没有木头搭架。
    const a = createNewGame(1);
    give(a, [['wood', 2], ['tape', 1], ['cloth', 1], ['crowbar', 1]]);
    expect(craft(a, 'reinforced_door').ok).toBe(true);
    expect(craft(a, 'storage_rack').ok).toBe(false); // 木头归了门
    expect(a.player.inventory.slotCount).toBe(12);

    const b = createNewGame(1);
    give(b, [['wood', 2], ['tape', 1], ['cloth', 1], ['crowbar', 1]]);
    expect(craft(b, 'storage_rack').ok).toBe(true);
    expect(craft(b, 'reinforced_door').ok).toBe(false); // 木头归了架子
    expect(b.player.inventory.slotCount).toBe(14);
  });
});

describe('the growth lines are fed by the economy (B5 break: three lines had no producer)', () => {
  it('trading feeds wealth: +10 a purchase, +5 a sale', () => {
    const s = createNewGame(1);
    s.player.gold = 100;
    give(s, [['fuse', 1]]);
    buy(s, 'bread', 2);
    expect(s.growth?.wealth.totalXp).toBe(10);
    sell(s, 'fuse', 4);
    expect(s.growth?.wealth.totalXp).toBe(15);
    sell(s, 'bread', 2);
    expect(s.growth?.wealth.totalXp).toBe(20);
  });

  it('a full bar refuses the item AND teaches nothing (no XP farming)', () => {
    const s = createNewGame(1);
    s.player.thirst = 100;
    const before = s.growth?.survival.totalXp ?? 0;
    expect(useConsumable(s, 'clean_water').ok).toBe(false);
    expect(s.growth?.survival.totalXp ?? 0).toBe(before);
  });

  it('drinking and eating feed survival: +5 each, and levels come from living', () => {
    const s = createNewGame(1);
    give(s, [['ration_pack', 20]]); // 起始只有 2 份口粮，不够二十顿饭
    useConsumable(s, 'clean_water'); // +5
    useConsumable(s, 'ration_pack'); // +5
    expect(s.growth?.survival.level).toBe(1);
    expect(s.growth?.survival.totalXp).toBe(10);
    // 十八顿之后升到 2 级（xpToNext(1)=100）
    for (let i = 0; i < 18; i++) {
      s.player.hunger = 10;
      useConsumable(s, 'ration_pack');
    }
    expect(s.growth?.survival.level).toBe(2);
  });

  it('a medkit that closes a wound pays +15, the survival line’s medical rung', () => {
    const s = createNewGame(1);
    give(s, [['medkit', 1]]);
    s.player.hp = 50;
    s.player.ailments = [{ id: 'wound', severity: 40, sinceMinute: 0 }];
    const r = useConsumable(s, 'medkit');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cured).toContain('wound');
    expect(s.growth?.survival.totalXp).toBe(15);
  });

  it('a night in the dorm pays +10 survival', () => {
    const s = createNewGame(1);
    s.gameMinuteOfDay = 1200;
    sleep(s);
    expect(s.growth?.survival.totalXp).toBe(10);
  });

  it('forging credentials feeds power: +100 per rung climbed', () => {
    const s = createNewGame(1);
    give(s, [['scrap_metal', 3], ['cloth', 4], ['tape', 2], ['wire', 4], ['battery', 4], ['filter', 1], ['fuse', 1]]);
    expect(craft(s, 'work_badge').ok).toBe(true);
    expect(s.growth?.power.totalXp).toBe(100); // 档位差 1
    expect(craft(s, 'pass_sticker').ok).toBe(true);
    expect(s.growth?.power.totalXp).toBe(300); // 档位差 2 → +200
    expect(craft(s, 'permit').ok).toBe(true);
    expect(s.growth?.power.totalXp).toBe(600); // 档位差 3 → +300
    // 打造设施（非凭证）不喂权力线
    const before = s.growth?.power.totalXp ?? 0;
    give(s, [['wood', 2], ['tape', 1]]);
    craft(s, 'reinforced_door');
    expect(s.growth?.power.totalXp ?? 0).toBe(before);
  });

  it('recipeTierLocked reads the power line but never gates a craft (no soft-lock)', () => {
    // tier 字段的登记消费方是 recipeAccessTier；门禁不开的原因写在
    // CraftingSystem.recipeTierLocked 的注释里（冷启动软锁 + 凭证链
    // "材料齐全必可建"的既有语义）。
    const s = createNewGame(1);
    give(s, [['scrap_metal', 1], ['cloth', 1], ['tape', 1]]);
    expect(recipeTierLocked(s, 'work_badge')).toBe(true); // power 1 级 < tier 2
    expect(recipeTierLocked(s, 'lamp')).toBe(false); // tier 1 可达
    // 但材料齐全就能建——权力线从此有生产者（凭证 +100/档），等级是爬梯子的
    // 结果，不是准入门槛。
    expect(canCraft(s, 'work_badge').ok).toBe(true);
    expect(craft(s, 'work_badge').ok).toBe(true);
  });
});
