import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { getFloorView, lootContainer, lootGround } from '../systems/LootSystem';
import { addItem, countItem, isBagFull, useConsumable } from '../systems/InventorySystem';
import { STORAGE_RACK_SLOTS, canCraft, craft, hasUpgrade, purifyWater, recipeTierLocked } from '../systems/CraftingSystem';
import {
  VENTURES,
  VENTURE_DAY_XP,
  buy,
  invest,
  materialAsk,
  materialShelf,
  priceJitter,
  productionDecay,
  sell,
  sellPrice,
  settleInvestments,
  shopStock,
} from '../systems/shop';
import { sleep, spendTime } from '../systems/SurvivalSystem';
import { trade } from '../systems/TradeSystem';
import { deserialize, serialize, validateGameState } from '../systems/SaveSystem';
import { grantGrowthXp, GROWTH_MAX_LEVEL } from '../core/growth';
import { NPCS } from '../data/npcs';
import { ITEM_IDS, getItem } from '../data/items';
import { WEAPON_IDS } from '../data/weapons';
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
      // AG-武器分支：四件武器的出口是战斗——data/weapons.ts 的 WEAPONS 定义
      // 攻速/伤害/动作，GameScene 的装备与攻击读它们。它们不是配方消耗品
      // （是配方产出），也不进商店收购，但每件都有真实读取方，与手电同性质。
      if (WEAPON_IDS.includes(id as (typeof WEAPON_IDS)[number])) continue;
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
    // 商品架标价与材料收购价不读 day/seed（材料价全局固定，商品价按 band），
    // 同一天内反复买卖同价——这是"同 seed 交易可复现"的最低要求。
    // （AG-14 起商人"出售"材料的要价按 (seed, day) 波动，见下一节"当日
    // 市场"；收购侧与商品侧的确定性一个字没动。）
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

// ── AG-14：经济的时间维度（priceJitter / productionDecay）与 buy 侧 ──────
//
// AG-05 留下三个"功能就绪、没有调用方"的钩子：priceJitter /
// productionDecay 无场景调用、商人不卖材料（buy 侧）、investedGold/ventures
// 无生产者。本节把三件事接上，并钉死接上之后不许破坏的边界：
//   1. 当日价格确定性——同 seed 同日两次同价，跨天真不同；
//   2. 买卖无套利——任何 seed、任何一天、任何 connections 等级，商人出售
//      材料的要价严格高于收购价（结构下限 bid+1，折扣也夹在下限上）；
//   3. 投资有风险——倒塌亏本金、亏损日没收入，且都按 (runSeed, day) 确定；
//   4. survivalBalance 的世界供给一个字没动（商人只是新增一条现金通道）。

// 当日扫程：覆盖跨日波动与长期衰减两个尺度。
const SWEEP_DAYS = Array.from({ length: 40 }, (_, i) => i + 1);
const SWEEP_SEEDS = [1, 42, 2026];
const ALL_MATERIALS = ['fuse', 'filter', 'battery', 'wire', 'scrap_metal', 'cloth', 'wood', 'tape'] as ItemId[];

describe('the daily market: the trader’s ask moves with the day (AG-14: priceJitter)', () => {
  it('one deterministic draw per (seed, day) — same inputs, same market', () => {
    for (const seed of SWEEP_SEEDS) {
      for (const day of SWEEP_DAYS) {
        expect(priceJitter(seed, day)).toBe(priceJitter(seed, day));
        const j = priceJitter(seed, day);
        expect(j).toBeGreaterThanOrEqual(0.85);
        expect(j).toBeLessThanOrEqual(1.15);
      }
    }
    // 跨天真不同：同 seed 扫 40 天必然出现不止一种行情
    const oneSeed = new Set(SWEEP_DAYS.map((d) => priceJitter(1, d)));
    expect(oneSeed.size).toBeGreaterThan(1);
    // 不同 seed 同一天是不同行情（市场不是全局同一个数）
    expect(priceJitter(1, 5)).not.toBe(priceJitter(42, 5));
  });

  it('the shop charges exactly the day’s ask, twice the same day', () => {
    const s = createNewGame(7);
    s.day = 4;
    s.player.gold = 500;
    const ask = materialAsk('fuse', s.runSeed, s.day);
    const before = s.player.gold;
    expect(buy(s, 'fuse', 4).ok).toBe(true);
    expect(s.player.gold).toBe(before - ask); // connections 1 级无折扣，按牌价
    const mid = s.player.gold;
    expect(buy(s, 'fuse', 4).ok).toBe(true);
    expect(s.player.gold).toBe(mid - materialAsk('fuse', s.runSeed, s.day));
    expect(countItem(s.player.inventory, 'fuse')).toBe(2);
  });

  it('the ask always beats the bid — no day and no seed can arbitrage the trader', () => {
    for (const seed of SWEEP_SEEDS) {
      for (const day of SWEEP_DAYS) {
        for (const id of ALL_MATERIALS) {
          const ask = materialAsk(id, seed, day);
          const where = `${id} seed ${seed} day ${day}`;
          expect(ask, where).toBeGreaterThan(sellPrice(id, 2));
          // 结构性下限：要价永不低于收购价 + 1（商人转手不亏，套利无从下嘴）
          expect(ask, where).toBeGreaterThanOrEqual(sellPrice(id, 2) + 1);
        }
      }
    }
  });

  it('buying from the trader always costs more than paying 阿林 in goods', () => {
    // 对称锚：AG-05 钉死"收购价永远低于找阿林换实物"；出售侧反过来——要价
    // 永远高于对应易物的金币成本，拿货去兑永远是更优路径，商人只是没有
    // 易物货可兑时的现金通道。
    for (const seed of SWEEP_SEEDS) {
      for (const day of SWEEP_DAYS) {
        expect(materialAsk('wire', seed, day)).toBeGreaterThan(sellPrice('scrap_metal', 2));
        expect(materialAsk('fuse', seed, day)).toBeGreaterThan(sellPrice('battery', 2));
      }
    }
  });

  it('material round-trips lose money on every day of the sweep', () => {
    for (const seed of SWEEP_SEEDS) {
      for (const day of SWEEP_DAYS) {
        const s = createNewGame(seed);
        s.day = day;
        s.player.gold = 500;
        const start = s.player.gold;
        for (const id of ALL_MATERIALS) {
          buy(s, id, 4);
          sell(s, id, 4);
        }
        expect(s.player.gold, `seed ${seed} day ${day}`).toBeLessThan(start);
      }
    }
  });

  it('the connections discount cannot arbitrage the material shelf either', () => {
    // 熟人折扣只打买价（与商品侧同规则），且材料要价夹在 bid+1 的结构下限
    // 上——满级人脉买料卖料依旧亏。
    const xpToReach = (level: number): number => (100 * (level - 1) * level) / 2;
    for (const seed of SWEEP_SEEDS) {
      for (const day of SWEEP_DAYS) {
        const s = createNewGame(seed);
        s.day = day;
        grantGrowthXp(s, 'connections', xpToReach(GROWTH_MAX_LEVEL));
        s.player.gold = 500;
        const start = s.player.gold;
        buy(s, 'scrap_metal', 4);
        sell(s, 'scrap_metal', 4);
        expect(s.player.gold, `seed ${seed} day ${day}`).toBeLessThan(start);
      }
    }
  });

  it('buying the guaranteed basket always costs more than selling it back', () => {
    // 变现总额约束的对称面：AG-05 钉死"保底材料全卖 32 金"，本节钉死"全买
    // 永远更贵"——买料做配方不会成为比搜刮更优的解。
    const basket: Array<[ItemId, number]> = [
      ['fuse', 1], ['filter', 1], ['battery', 1], ['wire', 2],
      ['scrap_metal', 3], ['cloth', 1], ['wood', 2], ['tape', 1],
    ];
    for (const seed of SWEEP_SEEDS) {
      for (const day of SWEEP_DAYS) {
        const s = createNewGame(seed);
        s.day = day;
        s.player.gold = 500;
        const start = s.player.gold;
        for (const [id, n] of basket) for (let i = 0; i < n; i++) expect(buy(s, id, 4).ok, `${id} seed ${seed} day ${day}`).toBe(true);
        expect(start - s.player.gold).toBeGreaterThan(32); // 全卖只回 32
        for (const [id, n] of basket) for (let i = 0; i < n; i++) expect(sell(s, id, 4).ok).toBe(true);
        expect(s.player.gold).toBeLessThan(start); // 一进一出必亏
      }
    }
  });

  it('the material shelf lists all eight materials at the day’s price, dearest first', () => {
    const shelf = materialShelf(2026, 3);
    expect(shelf.map((e) => e.itemId).sort()).toEqual([...ALL_MATERIALS].sort());
    for (const e of shelf) {
      expect(e.price).toBe(materialAsk(e.itemId, 2026, 3));
      expect(e.price).toBeGreaterThan(sellPrice(e.itemId, 2));
    }
    for (let i = 1; i < shelf.length; i++) expect(shelf[i - 1].price).toBeGreaterThanOrEqual(shelf[i].price);
    // 三锚在要价侧同向：保险丝（保底 1 个 + core_key 硬门槛）永远贵过电池
    for (const day of SWEEP_DAYS) {
      expect(materialAsk('fuse', 2026, day)).toBeGreaterThan(materialAsk('battery', 2026, day));
    }
  });

  it('a buy the trader cannot supply changes nothing — materials included', () => {
    const s = createNewGame(1);
    s.player.gold = 500;
    expect(buy(s, 'crowbar', 2).ok).toBe(false); // 2 层货架没有撬棍，撬棍也不是材料
    expect(s.player.gold).toBe(500);
    expect(s.player.inventory.slots.length).toBe(3);
    const s2 = createNewGame(1);
    s2.player.gold = 500;
    expect(buy(s2, 'flashlight', 2).ok).toBe(false); // 哪层都不卖、也不是材料
    expect(s2.player.gold).toBe(500);
    expect(s2.player.inventory.slots.length).toBe(3);
    // 手电确实不在材料货架上：商人不卖它
    expect(materialShelf(1, 1).some((e) => e.itemId === 'flashlight')).toBe(false);
  });
});

describe('ventures: capital sinks into the tower and pays by the day (AG-14: investedGold/ventures)', () => {
  const investedOf = (state: GameState): number => state.growth?.investedGold ?? 0;
  const venturesOf = (state: GameState): string[] => state.growth?.ventures ?? [];
  const costOf = (id: string): number => VENTURES.find((v) => v.id === id)!.cost;
  const ledgerCost = (state: GameState): number =>
    VENTURES.reduce((sum, v) => sum + (venturesOf(state).includes(v.id) ? v.cost : 0), 0);

  it('investing moves gold into the ledger and pays +50 wealth', () => {
    const s = createNewGame(1);
    s.player.gold = 200;
    expect(invest(s, 'water_stall').ok).toBe(true);
    expect(s.player.gold).toBe(200 - costOf('water_stall'));
    expect(investedOf(s)).toBe(costOf('water_stall'));
    expect(venturesOf(s)).toEqual(['water_stall']);
    expect(s.growth?.wealth.totalXp).toBe(50); // 契约 §5：完成一笔产业投资 +50
    expect(investedOf(s)).toBe(ledgerCost(s)); // 账本不变量：沉没资本 = 在册成本合计
  });

  it('refuses an unknown venture, a duplicate, and a purse too light — atomically', () => {
    const s = createNewGame(1);
    s.player.gold = 50;
    expect(invest(s, 'nope').ok).toBe(false);
    expect(invest(s, 'water_stall').ok).toBe(true);
    const snapshot = {
      gold: s.player.gold,
      invested: investedOf(s),
      ventures: venturesOf(s),
      xp: s.growth?.wealth.totalXp ?? 0,
    };
    expect(invest(s, 'water_stall').ok).toBe(false); // 一种一门
    expect(invest(s, 'scrap_caravan').ok).toBe(false); // 80 > 50
    expect(s.player.gold).toBe(snapshot.gold);
    expect(investedOf(s)).toBe(snapshot.invested);
    expect(venturesOf(s)).toEqual(snapshot.ventures);
    expect(s.growth?.wealth.totalXp ?? 0).toBe(snapshot.xp);
  });

  it('settlement is deterministic per (seed, day) and pays the formula exactly', () => {
    // 找一个"当日全付"的 (seed, day)，结算报告必须逐金对上公式。
    let found: { seed: number; day: number } | null = null;
    for (let seed = 1; seed <= 60 && !found; seed++) {
      for (let day = 2; day <= 12 && !found; day++) {
        const probe = createNewGame(seed);
        probe.player.gold = 200;
        probe.day = day;
        invest(probe, 'water_stall');
        const r = settleInvestments(probe);
        if (r.paid.length === 1 && r.lossDays.length === 0 && r.collapsed.length === 0) found = { seed, day };
      }
    }
    expect(found).not.toBeNull();
    const run = (): GameState => {
      const s = createNewGame(found!.seed);
      s.player.gold = 200;
      s.day = found!.day;
      invest(s, 'water_stall');
      settleInvestments(s);
      return s;
    };
    const a = run();
    const b = run();
    expect(a.player.gold).toBe(b.player.gold);
    expect(a.growth).toEqual(b.growth);
    const settledDay = found!.day - 1; // 结算的是刚结束的那天
    const def = VENTURES.find((v) => v.id === 'water_stall')!;
    const expectedIncome = Math.max(1, Math.round(def.cost * def.baseRate * productionDecay(settledDay)));
    expect(a.player.gold).toBe(200 - def.cost + expectedIncome);
    expect(a.growth?.wealth.totalXp).toBe(50 + VENTURE_DAY_XP);
  });

  it('settlement is idempotent within a day — a second call pays nothing', () => {
    const s = createNewGame(1);
    s.player.gold = 200;
    s.day = 3;
    invest(s, 'water_stall');
    const first = settleInvestments(s);
    expect(first.day).toBe(2);
    const goldAfterFirst = s.player.gold;
    const second = settleInvestments(s);
    expect(second).toEqual({ day: 0, paid: [], lossDays: [], collapsed: [], totalIncome: 0 });
    expect(s.player.gold).toBe(goldAfterFirst);
  });

  it('production decays with the day — the tower keeps less every morning', () => {
    expect(productionDecay(1)).toBe(1);
    for (let day = 1; day < 40; day++) {
      expect(productionDecay(day + 1)).toBeLessThan(productionDecay(day));
    }
    expect(productionDecay(30)).toBeLessThan(0.5); // 一个月后产量不足一半
  });

  it('risk actually fires: over a long sweep, ventures pay, lose days, and collapse', () => {
    let paid = 0;
    let losses = 0;
    let collapses = 0;
    for (let seed = 1; seed <= 30; seed++) {
      for (const def of VENTURES) {
        const s = createNewGame(seed);
        s.player.gold = 1000;
        expect(invest(s, def.id).ok).toBe(true);
        for (let day = 2; day <= 30; day++) {
          s.day = day;
          const r = settleInvestments(s);
          if (r.paid.length > 0) paid++;
          if (r.lossDays.length > 0) losses++;
          if (r.collapsed.length > 0) collapses++;
          expect(investedOf(s)).toBe(ledgerCost(s)); // 账本不变量每个结算日都成立
          if (r.collapsed.length > 0) break; // 出局
        }
      }
    }
    expect(paid).toBeGreaterThan(0);
    expect(losses).toBeGreaterThan(0);
    expect(collapses).toBeGreaterThan(0); // 不是稳赚：三门生意都真的会倒
  });

  it('a collapse takes the principal and the venture off the books, and teaches nothing', () => {
    let hit: { seed: number; day: number } | null = null;
    for (let seed = 1; seed <= 200 && !hit; seed++) {
      for (let day = 2; day <= 40 && !hit; day++) {
        const probe = createNewGame(seed);
        probe.player.gold = 1000;
        probe.day = day;
        invest(probe, 'ration_route'); // 倒塌率最高的一门
        if (settleInvestments(probe).collapsed.length > 0) hit = { seed, day };
      }
    }
    expect(hit).not.toBeNull();
    const s = createNewGame(hit!.seed);
    s.player.gold = 1000;
    invest(s, 'ration_route');
    const afterInvest = s.player.gold;
    s.day = hit!.day;
    const r = settleInvestments(s);
    expect(r.collapsed).toEqual(['ration_route']);
    expect(r.paid).toEqual([]);
    expect(r.totalIncome).toBe(0);
    expect(s.player.gold).toBe(afterInvest); // 倒塌当天没有收入
    expect(venturesOf(s)).toEqual([]);
    expect(investedOf(s)).toBe(0);
    expect(s.growth?.wealth.totalXp).toBe(50); // 失败不喂经验
  });

  it('a loss day pays nothing but keeps the principal on the books', () => {
    let hit: { seed: number; day: number } | null = null;
    for (let seed = 1; seed <= 200 && !hit; seed++) {
      for (let day = 2; day <= 40 && !hit; day++) {
        const probe = createNewGame(seed);
        probe.player.gold = 1000;
        probe.day = day;
        invest(probe, 'water_stall');
        const r = settleInvestments(probe);
        if (r.lossDays.length === 1 && r.collapsed.length === 0) hit = { seed, day };
      }
    }
    expect(hit).not.toBeNull();
    const s = createNewGame(hit!.seed);
    s.player.gold = 1000;
    invest(s, 'water_stall');
    const afterInvest = s.player.gold;
    s.day = hit!.day;
    const r = settleInvestments(s);
    expect(r.lossDays).toEqual(['water_stall']);
    expect(r.paid).toEqual([]);
    expect(s.player.gold).toBe(afterInvest); // 没收入
    expect(venturesOf(s)).toEqual(['water_stall']); // 但本金还在
    expect(investedOf(s)).toBe(costOf('water_stall'));
  });

  it('a night of sleep settles the day that ended — income lands on waking', () => {
    // 跨日路径之一：睡觉。找一棵"睡醒就收钱"的 seed。
    let seed = 0;
    for (let candidate = 1; candidate <= 60; candidate++) {
      const probe = createNewGame(candidate);
      probe.player.gold = 1000;
      invest(probe, 'water_stall');
      probe.gameMinuteOfDay = 1200;
      sleep(probe);
      if (probe.player.gold > 1000 - costOf('water_stall')) {
        seed = candidate;
        break;
      }
    }
    expect(seed).toBeGreaterThan(0);
    const s = createNewGame(seed);
    s.player.gold = 1000;
    invest(s, 'water_stall');
    s.gameMinuteOfDay = 1200;
    expect(sleep(s).ok).toBe(true);
    expect(s.day).toBe(2);
    const def = VENTURES.find((v) => v.id === 'water_stall')!;
    const income = Math.max(1, Math.round(def.cost * def.baseRate * productionDecay(1)));
    expect(s.player.gold).toBe(1000 - def.cost + income);
    expect(s.growth?.wealth.totalXp).toBe(50 + VENTURE_DAY_XP);
  });

  it('staying up past midnight settles too — the clock engine drives the day', () => {
    // 跨日路径之二：时钟推进（动作耗时/帧循环都汇到 advanceGameMinutes）。
    const s = createNewGame(1);
    s.player.gold = 1000;
    invest(s, 'water_stall');
    s.gameMinuteOfDay = 1439; // 23:59
    spendTime(s, 30); // 跨过午夜
    expect(s.day).toBe(2);
    // 结算结果与直接调 settleInvestments 逐字段一致（同一条引擎路径）
    const mirror = createNewGame(1);
    mirror.player.gold = 1000;
    mirror.day = 2;
    invest(mirror, 'water_stall');
    const direct = settleInvestments(mirror);
    expect(s.player.gold).toBe(1000 - 40 + direct.totalIncome);
    expect(s.growth?.wealth.totalXp).toBe(50 + (direct.paid.length > 0 ? VENTURE_DAY_XP : 0));
  });

  it('the venture ledger survives a save round-trip and still validates', () => {
    const s = createNewGame(3);
    s.player.gold = 300;
    expect(invest(s, 'water_stall').ok).toBe(true);
    expect(invest(s, 'scrap_caravan').ok).toBe(true);
    expect(investedOf(s)).toBe(costOf('water_stall') + costOf('scrap_caravan'));
    const back = deserialize(serialize(s));
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.state.growth?.investedGold).toBe(costOf('water_stall') + costOf('scrap_caravan'));
      expect(back.state.growth?.ventures).toEqual(['water_stall', 'scrap_caravan']);
      expect(validateGameState(back.state)).toEqual([]);
      // 读回来的档继续按日结算，不受round-trip 影响
      back.state.day = 5;
      const r = settleInvestments(back.state);
      expect(r.day).toBe(4);
      expect(r.paid.every((p) => p.income >= 1)).toBe(true);
    }
  });

  it('the economy deepening does not touch world supply — the guaranteed basket is still exactly there', () => {
    // survivalBalance 的所有权事实（每层保底供给）一个没动：商人卖料只是
    // 给"有金币没时间"的玩家加一条现金通道，世界该给的材料照给。
    const s = createNewGame(1);
    lootMaterialFloors(s);
    expect(countItem(s.player.inventory, 'scrap_metal')).toBe(3); // survivalBalance 钉死
    expect(countItem(s.player.inventory, 'wood')).toBe(2);
    expect(countItem(s.player.inventory, 'tape')).toBe(1);
    expect(countItem(s.player.inventory, 'fuse')).toBe(1);
    expect(countItem(s.player.inventory, 'filter')).toBe(1);
    expect(countItem(s.player.inventory, 'wire')).toBe(2);
    // 三件设施照旧可建（搜刮 → 建设的路径没有被金币通道替代）
    const built: string[] = [];
    for (const r of RECIPES) if (craft(s, r.id).ok) built.push(r.id);
    expect(built).toEqual(['lamp', 'reinforced_door', 'purifier']);
  });
});
