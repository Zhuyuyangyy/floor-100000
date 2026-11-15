// AG-20（场景接线·第二轮）的测试（派工单 §硬性要求 4）。
//
// 立场与项目既有约定一致：纯函数级断言，不 import Phaser、不起场景——运行期
// 行为（面板文案、flash、depth、出生）由 Playwright e2e 实测，证据见派工报告。
// 本文件钉的是「场景接线所依赖的系统契约」中此前没有钉住的部分，每一节对应
// GameScene 里的一处接点，接点写在节注释里。
//
// 系统函数自身的行为测试在其属主文件（shop/npcBehavior/economyLoop/...），这里
// 只断言接线新用到的语义，不重复整套套件。

import { describe, expect, it } from 'vitest';

import { createNewGame } from '../core/gameState';
import { FLOOR_WIDTH, STARTING_FLOOR } from '../core/constants';
import { addItem, countItem } from '../systems/InventorySystem';
import {
  VENTURES,
  invest,
  materialAsk,
  materialShelf,
  priceJitter,
  sellPrice,
  settleInvestments,
  buy,
  sell,
  type VentureSettlement,
} from '../systems/shop';
import { purifyWater, hasUpgrade } from '../systems/CraftingSystem';
import { bumpFlag, flagCount } from '../systems/WorldFlags';
import { deserialize, serialize } from '../systems/SaveSystem';
import { NPCS, getNpc } from '../data/npcs';
import type { NpcDef, NpcId } from '../data/npcs';
import { availableOffers, claimGift, giftOffer, receiveGift, reputationOf } from '../ai/npcEconomy';
import { freshStateFor, stockOf, syncNpcInventory } from '../ai/npcInventory';
import { loadNpcState, saveNpcState } from '../systems/NpcMemory';
import { createNpcState } from '../data/npcPersonalities';
import { planWandererVendetta, wandererNightSpawnX } from '../systems/NpcAutonomy';
import type { GameState } from '../core/gameTypes';
import type { NpcInventory, NpcPersistedState } from '../ai/types';

function npc(id: NpcId): NpcDef {
  return getNpc(id);
}

/** 把 NPC 持久状态写进 npcStates（与 npcBehavior.test.ts 同款布阵）。 */
function seedNpcState(s: GameState, id: NpcId, patch: Partial<NpcPersistedState> = {}): void {
  saveNpcState(s, id, { ...freshStateFor(npc(id), 1), ...patch });
}

function handInventory(entries: NpcInventory['entries'], lastRestockDay = 1): NpcInventory {
  return { entries, lastRestockDay };
}

const SWEEP_SEEDS = [1, 7, 42, 2026];
const SWEEP_DAYS = Array.from({ length: 40 }, (_, i) => i + 1);
/** 场景侧累计收益账本的标记名（GameScene VENTURE_INCOME_FLAG）。 */
const VENTURE_INCOME_FLAG = 'economy:venture-income-total';
/** 系统层结算水位标记（shop.ts SETTLED_DAY_FLAG，派工单点名不得绕过）。 */
const SETTLED_DAY_FLAG = 'economy:settled-day';

// ── 接点 1：交易面板的材料货架（GameScene openShop / buildShopPanel） ────────
//
// 面板每次打开都重读 materialShelf(runSeed, day)：当日牌价，昨天看过的价今天
// 不作数。每行印着「买 X · 卖 Y」两个方向——要价恒高于收购价，无套利因此是
// 看得见的。下面钉住面板读数与收费三方一致：牌价 === 实收（connections 1 级
// 无折扣），且卖方向永远更便宜。
describe('材料货架接线：当日牌价、两个方向、重读语义', () => {
  it('货架八件齐全，牌价逐件等于 materialAsk，且恒高于收购价', () => {
    for (const seed of SWEEP_SEEDS) {
      for (const day of SWEEP_DAYS) {
        const shelf = materialShelf(seed, day);
        expect(shelf.length).toBe(8);
        for (const e of shelf) {
          expect(e.price).toBe(materialAsk(e.itemId, seed, day));
          // 结构性无套利：要价 > 收购价，且不低于收购价 + 1。
          expect(e.price).toBeGreaterThan(sellPrice(e.itemId, 2));
          expect(e.price).toBeGreaterThanOrEqual(sellPrice(e.itemId, 2) + 1);
        }
        // 价高的排前面（面板的排序即系统的排序）。
        for (let i = 1; i < shelf.length; i++) {
          expect(shelf[i - 1].price).toBeGreaterThanOrEqual(shelf[i].price);
        }
      }
    }
  });

  it('同日同 seed 两次读取同价（可复现），跨天必然变价（所以必须重读）', () => {
    for (const seed of SWEEP_SEEDS) {
      // 同一天两次：逐项相等——面板反复打开不会自己漂。
      expect(materialShelf(seed, 5)).toEqual(materialShelf(seed, 5));
      // 跨天真不同：扫 40 天至少出现两种行情——缓存牌价的面板会显示昨天的价。
      const fusePrices = new Set(SWEEP_DAYS.map((d) => materialAsk('fuse', seed, d)));
      expect(fusePrices.size).toBeGreaterThan(1);
      // 行情本身在 0.85..1.15 的带内。
      for (const day of SWEEP_DAYS) {
        expect(priceJitter(seed, day)).toBeGreaterThanOrEqual(0.85);
        expect(priceJitter(seed, day)).toBeLessThanOrEqual(1.15);
      }
    }
  });

  it('面板上印的买价就是实收的价（新开局 connections 1 级无折扣）', () => {
    const s = createNewGame(7);
    s.day = 4;
    s.player.gold = 500;
    for (const e of materialShelf(s.runSeed, s.day)) {
      const shown = e.price;
      const before = s.player.gold;
      expect(buy(s, e.itemId, 4).ok).toBe(true);
      expect(s.player.gold).toBe(before - shown);
    }
  });

  it('买与卖两个方向永不相交——材料往返必亏（面板的两个价格是诚实的）', () => {
    for (const seed of SWEEP_SEEDS) {
      for (const day of [1, 5, 17, 33]) {
        const s = createNewGame(seed);
        s.day = day;
        s.player.gold = 500;
        const start = s.player.gold;
        for (const e of materialShelf(s.runSeed, s.day)) {
          buy(s, e.itemId, 4);
          sell(s, e.itemId, 4);
        }
        expect(s.player.gold, `seed ${seed} day ${day}`).toBeLessThan(start);
      }
    }
  });
});

// ── 接点 2：产业投资面板（GameScene onToggleVentures / buildVenturePanel） ────
//
// 面板三门（成本/日收益率/亏损率/倒闭率）、Enter 入股、读数三项（已投入/
// 昨日收益/累计）。结算由时钟在水位标记内完成，场景只观察推进前后的账本；
// 打开面板时补一次 settleInvestments 是幂等空转。下面钉住这套读数的来源。
describe('产业投资接线：账本、读数与幂等结算', () => {
  const costOf = (id: string): number => VENTURES.find((v) => v.id === id)!.cost;

  it('三门产业的风险梯度与派工单一致（不是稳赚）', () => {
    expect(VENTURES.map((v) => v.id)).toEqual(['water_stall', 'scrap_caravan', 'ration_route']);
    expect(VENTURES.map((v) => v.cost)).toEqual([40, 80, 120]);
    expect(VENTURES.map((v) => v.baseRate)).toEqual([0.05, 0.1, 0.16]);
    expect(VENTURES.map((v) => v.lossChance)).toEqual([0.06, 0.12, 0.2]);
    expect(VENTURES.map((v) => v.collapseChance)).toEqual([0.01, 0.03, 0.06]);
    // 成本/日产率/亏损率/倒闭率同向递增——厚利必然厚风险。
    for (let i = 1; i < VENTURES.length; i++) {
      expect(VENTURES[i].cost).toBeGreaterThan(VENTURES[i - 1].cost);
      expect(VENTURES[i].baseRate).toBeGreaterThan(VENTURES[i - 1].baseRate);
      expect(VENTURES[i].lossChance).toBeGreaterThan(VENTURES[i - 1].lossChance);
      expect(VENTURES[i].collapseChance).toBeGreaterThan(VENTURES[i - 1].collapseChance);
    }
  });

  it('入股是原子的：金币 → 账本，被拒时分毫不动', () => {
    const s = createNewGame(1);
    s.player.gold = 100;
    expect(invest(s, 'water_stall').ok).toBe(true);
    expect(s.player.gold).toBe(60);
    expect(s.growth?.investedGold).toBe(40);
    expect(s.growth?.ventures).toEqual(['water_stall']);
    // 重复入股被拒且不动账本。
    const r = invest(s, 'water_stall');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('已经入过');
    expect(s.player.gold).toBe(60);
    // 金币不够被拒且不动账本。
    const poor = createNewGame(1);
    poor.player.gold = 10;
    expect(invest(poor, 'ration_route').ok).toBe(false);
    expect(poor.player.gold).toBe(10);
    expect(poor.growth?.investedGold ?? 0).toBe(0);
  });

  it('账本不变量：investedGold ≡ 在册产业成本合计', () => {
    const s = createNewGame(42);
    s.player.gold = 999;
    for (const v of VENTURES) expect(invest(s, v.id).ok).toBe(true);
    const ledgerCost = VENTURES.reduce((sum, v) => sum + costOf(v.id), 0);
    expect(s.growth?.investedGold).toBe(ledgerCost);
  });

  it('场景的观察与系统报告逐项对齐（金币差=当日收益，消失的=倒塌）', () => {
    const s = createNewGame(1);
    s.player.gold = 500;
    expect(invest(s, 'water_stall').ok).toBe(true);
    let report: VentureSettlement | null = null;
    for (let day = 2; day <= 60 && !report; day++) {
      const before = { gold: s.player.gold, ventures: [...(s.growth?.ventures ?? [])] };
      s.day = day; // 结算「刚结束的那天」= day-1
      const r = settleInvestments(s);
      if (r.paid.length > 0 || r.collapsed.length > 0) {
        report = r;
        // 场景 diffVentureLedger 做的两件事，与系统报告严格一致。
        expect(s.player.gold - before.gold).toBe(r.totalIncome);
        expect(before.ventures.filter((id) => !(s.growth?.ventures ?? []).includes(id))).toEqual(r.collapsed);
        expect(r.totalIncome).toBe(r.paid.reduce((sum, p) => sum + p.income, 0));
      }
    }
    expect(report, '60 天内必然有收钱或倒塌的一天').not.toBeNull();
  });

  it('水位标记把关：同一天重复结算第二次起是空账（面板反复打开不重复付钱）', () => {
    const s = createNewGame(1);
    s.player.gold = 500;
    expect(invest(s, 'scrap_caravan').ok).toBe(true);
    s.day = 3;
    const first = settleInvestments(s);
    expect(first.day).toBe(2);
    expect(flagCount(s, SETTLED_DAY_FLAG)).toBe(2); // 水位写到刚结束的那天
    const goldAfterFirst = s.player.gold;
    const second = settleInvestments(s);
    expect(second.totalIncome).toBe(0);
    expect(second.paid).toEqual([]);
    expect(second.collapsed).toEqual([]);
    expect(s.player.gold).toBe(goldAfterFirst); // 一个子儿都不多付
  });

  it('没有在册产业时结算只写水位（no-op），不产生任何金币', () => {
    const s = createNewGame(1);
    s.day = 4;
    const r = settleInvestments(s);
    expect(r.totalIncome).toBe(0);
    expect(r.paid).toEqual([]);
    expect(r.collapsed).toEqual([]);
    expect(r.day).toBe(3); // 报的是刚结束的那天，只是没账可结
    expect(flagCount(s, SETTLED_DAY_FLAG)).toBe(3);
    expect(s.player.gold).toBe(0);
  });

  it('累计账本存 flags、跨存档不丢（面板「累计」读数的来源）', () => {
    const s = createNewGame(1);
    s.player.gold = 500;
    expect(invest(s, 'water_stall').ok).toBe(true);
    s.day = 3;
    settleInvestments(s);
    const first = settleInvestments(s); // 已结过：空账
    expect(first.totalIncome).toBe(0);
    // 场景把观察到的收益累加进 flags（bumpFlag 语义：只增不减）。
    bumpFlag(s, VENTURE_INCOME_FLAG, 7);
    bumpFlag(s, VENTURE_INCOME_FLAG, 5);
    expect(flagCount(s, VENTURE_INCOME_FLAG)).toBe(12);
    const back = deserialize(serialize(s));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(flagCount(back.state, VENTURE_INCOME_FLAG)).toBe(12);
    expect(back.state.growth?.investedGold).toBe(40);
  });

  it('风险是真实的：扫描中既有收钱日也有倒塌日，倒塌亏本金出局', () => {
    let paidDays = 0;
    let collapsedDays = 0;
    let lossDays = 0;
    for (const seed of SWEEP_SEEDS) {
      const s = createNewGame(seed);
      s.player.gold = 999;
      for (const v of VENTURES) expect(invest(s, v.id).ok).toBe(true);
      for (let day = 2; day <= 30; day++) {
        s.day = day;
        const r = settleInvestments(s);
        if (r.paid.length > 0) paidDays++;
        if (r.lossDays.length > 0) lossDays++;
        if (r.collapsed.length > 0) {
          collapsedDays++;
          // 倒塌：本金从账本扣除，产业出局。
          for (const id of r.collapsed) {
            expect(s.growth?.ventures).not.toContain(id);
          }
          expect(s.growth!.investedGold).toBe(
            VENTURES.reduce((sum, v) => sum + (s.growth!.ventures.includes(v.id) ? v.cost : 0), 0),
          );
        }
      }
    }
    expect(paidDays, '收益真实发生').toBeGreaterThan(0);
    expect(lossDays, '亏损日真实发生').toBeGreaterThan(0);
    expect(collapsedDays, '倒闭真实发生——投资不是稳赚').toBeGreaterThan(0);
  });
});

// ── 接点 3：赠品交互（GameScene activateDialogueOption 的 gift 分支） ────────
//
// 对话只有四行：报价 ×N + 赠礼 + 返回必须放得下，所以先钉「每个 NPC 的报价
// 都不超过两条」。回赠行由 giftOffer 判得有才摆（与交易层只展示成交得了的
// 报价同纪律）；失败 reason 原样上屏，不静默。
describe('赠品接线：行数放得下、回赠有判、失败有回执', () => {
  it('每个 NPC 的报价 ≤ 2 条——交易层加一行「赠礼」仍放得进四行', () => {
    for (const def of NPCS) {
      const s = createNewGame(2026);
      const { npcState, inventory } = syncNpcInventory(s, def);
      const offers = availableOffers(inventory, def, reputationOf(npcState));
      expect(offers.length, `${def.id} 报价超量，赠礼行会掉出面板`).toBeLessThanOrEqual(2);
      // 场景的 dialogueGiftRowIndex：摆得下时是 offers.length，总行数 ≤ 4。
      expect(offers.length + 2).toBeLessThanOrEqual(4);
    }
  });

  it('回赠行只在真送得出时才摆（giftOffer 是那一道判官）', () => {
    const s = createNewGame(54);
    seedNpcState(s, 'alin', {
      relationship: { player: 40 },
      inventory: handInventory(
        [
          { itemId: 'fuse', quantity: 1, max: 3, restockPerDay: 1 },
          { itemId: 'wire', quantity: 0, max: 3, restockPerDay: 1 },
        ],
        1,
      ),
    });
    s.day = 3;
    const { npcState, inventory } = syncNpcInventory(s, npc('alin'));
    const gift = giftOffer(npc('alin'), inventory, reputationOf(npcState));
    expect(gift).not.toBeNull();
    expect(gift!.itemId).toBe('wire');
    // 非 trusted 不摆回赠行。
    const cold = createNewGame(54);
    seedNpcState(cold, 'alin', { relationship: { player: 0 } });
    const coldView = syncNpcInventory(cold, npc('alin'));
    expect(giftOffer(npc('alin'), coldView.inventory, reputationOf(coldView.npcState))).toBeNull();
  });

  it('领取失败的回执可直接上屏：「背包空间不足」点名到物品', () => {
    const s = createNewGame(55);
    seedNpcState(s, 'alin', {
      relationship: { player: 40 },
      inventory: handInventory(
        [
          { itemId: 'fuse', quantity: 1, max: 3, restockPerDay: 1 },
          { itemId: 'wire', quantity: 0, max: 3, restockPerDay: 1 },
        ],
        1,
      ),
    });
    s.day = 3;
    // 12 件互不相同的东西塞满 12 格（刻意不含 wire——回赠的那件）。
    for (const id of [
      'clean_water', 'dirty_water', 'ration_pack', 'bread', 'battery', 'scrap_metal',
      'wood', 'cloth', 'tape', 'filter', 'medkit', 'crowbar',
    ] as const) {
      addItem(s.player.inventory, id, 1);
    }
    const before = syncNpcInventory(s, npc('alin')).inventory;
    const r = claimGift(s, npc('alin'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('背包空间不足');
    expect(r.reason).toContain('电线'); // 点名到装不下的是什么
    // 整体失败：NPC 与玩家两边都不动（场景显示 reason 的同时没有任何暗扣）。
    expect(stockOf(loadNpcState(s, 'alin')!.inventory!, 'wire')).toBe(stockOf(before, 'wire'));
    expect(countItem(s.player.inventory, 'wire')).toBe(0);
  });

  it('领取成功：回赠进背包，NPC 库存照扣', () => {
    const s = createNewGame(54);
    seedNpcState(s, 'alin', {
      relationship: { player: 40 },
      inventory: handInventory(
        [
          { itemId: 'fuse', quantity: 1, max: 3, restockPerDay: 1 },
          { itemId: 'wire', quantity: 0, max: 3, restockPerDay: 1 },
        ],
        1,
      ),
    });
    s.day = 3;
    const before = syncNpcInventory(s, npc('alin')).inventory;
    const r = claimGift(s, npc('alin'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(countItem(s.player.inventory, 'wire')).toBe(1);
    expect(stockOf(r.inventory, 'wire')).toBe(stockOf(before, 'wire') - 1);
  });

  it('送出整叠只记一笔 gift 记忆（一次 Enter 一份礼，不给刷关系留缝）', () => {
    const s = createNewGame(51);
    seedNpcState(s, 'alin');
    addItem(s.player.inventory, 'wood', 5);
    const r = receiveGift(s, npc('alin'), 'wood', 5); // 场景送整叠
    expect(r.ok).toBe(true);
    expect(countItem(s.player.inventory, 'wood')).toBe(0);
    const loaded = loadNpcState(s, 'alin')!;
    expect(loaded.memory.filter((m) => m.kind === 'gift').length).toBe(1);
    expect(loaded.relationship.player).toBeGreaterThan(0);
  });

  it('送失败的回执可直接上屏：背包里没有就说没有', () => {
    const s = createNewGame(52);
    seedNpcState(s, 'alin', { relationship: { player: 5 } });
    addItem(s.player.inventory, 'wood', 1);
    const r = receiveGift(s, npc('alin'), 'wood', 3);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('没有足够的');
    // 整体失败：关系、记忆、库存、背包一律不动。
    const loaded = loadNpcState(s, 'alin')!;
    expect(loaded.relationship.player).toBe(5);
    expect(loaded.memory.some((m) => m.kind === 'gift')).toBe(false);
    expect(countItem(s.player.inventory, 'wood')).toBe(1);
  });
});

// ── 接点 4：跨层寻仇（GameScene updateWanderer） ────────────────────────────
//
// 与 planNightWanderer 独立求值，present 时寻仇优先：没有事件也照来（结仇的
// 流浪者摸到玩家当前楼层），白天只埋伏不上场，入夜以确定性出生点登场。
describe('跨层寻仇接线：无事件也登场、白天埋伏、寻仇优先可观察', () => {
  /** 记仇状态：关系 ≤ -30，第 1 天有一条攻击记忆（次日起可寻仇）。 */
  function grudged(seed: number, day: number, floor: number, minuteOfDay: number): GameState {
    const s = createNewGame(seed);
    s.day = day;
    s.currentFloor = floor;
    s.gameMinuteOfDay = minuteOfDay;
    saveNpcState(s, 'wanderer', {
      ...createNpcState('hostile'),
      relationship: { player: -40 },
      memory: [{ id: 'atk_1', day: 1, minute: 700, kind: 'attack', actor: 'player', summary: '袭击了流浪者', weight: -0.9 }],
    });
    return s;
  }

  it('没有夜间事件、结仇、入夜、掷中——照样登场（场景新的在场路径）', () => {
    // 找一个掷中的 (seed, day)：确定性，扫几天必有命中。
    let hit: GameState | null = null;
    for (const seed of SWEEP_SEEDS) {
      for (let day = 2; day <= 8 && !hit; day++) {
        const s = grudged(seed, day, 7, 1320);
        expect(s.worldEvents.activeEvent).toBeNull(); // fixture 不该带事件
        if (planWandererVendetta(s).present) hit = s;
      }
    }
    expect(hit, '四 seed 的扫描里必有寻仇日').not.toBeNull();
    const plan = planWandererVendetta(hit!);
    expect(plan.present).toBe(true);
    expect(plan.floor).toBe(7); // 目标楼层 = 玩家当前楼层
    expect(plan.spawnX).toBe(wandererNightSpawnX(hit!, 'vendetta', 7));
    expect(plan.spawnX).toBeGreaterThanOrEqual(48);
    expect(plan.spawnX).toBeLessThanOrEqual(FLOOR_WIDTH - 48);
    expect(plan.aggroRange).toBeGreaterThan(260); // 结仇放大
  });

  it('寻仇与夜间事件的出生点是两套推导——「优先寻仇」因此可观察', () => {
    let differ = 0;
    for (const seed of SWEEP_SEEDS) {
      for (const day of [2, 5, 9]) {
        const s = grudged(seed, day, 3, 1320);
        const v = wandererNightSpawnX(s, 'vendetta', 3);
        const n = wandererNightSpawnX(s, 'night', 3);
        if (v !== n) differ++;
      }
    }
    expect(differ, '两种来源的出生点必须真的不同，否则优先寻仇是空操作').toBeGreaterThan(0);
  });

  it('白天只埋伏不上场（present 要入夜）；宿舍是安全屋', () => {
    for (const seed of SWEEP_SEEDS) {
      for (let day = 2; day <= 12; day++) {
        const noon = grudged(seed, day, 7, 720);
        const plan = planWandererVendetta(noon);
        if (plan.hunting) expect(plan.present).toBe(false);
        const home = grudged(seed, day, STARTING_FLOOR, 1320);
        expect(planWandererVendetta(home).present).toBe(false);
      }
    }
  });

  it('没结仇就一切照旧——寻仇永不登场（基线行为不破坏）', () => {
    for (const seed of SWEEP_SEEDS) {
      const s = createNewGame(seed);
      s.day = 5;
      s.currentFloor = 7;
      s.gameMinuteOfDay = 1320;
      expect(planWandererVendetta(s).present).toBe(false);
      expect(planWandererVendetta(s).hunting).toBe(false);
    }
  });
});

// ── 接点 5：净水器读数（GameScene refreshCraft 的净化行） ────────────────────
//
// AG-11 已把「可净化 ×N」接进制作面板（N = 袋里脏水数）；本节钉住读数的取值
// 来源与 purifyWater 的批量语义——净化行报的数就是 Enter 之后真的会出来的数。
describe('净水器读数：×N 就是袋里的脏水数，且一次炼光', () => {
  it('读数来源 = countItem(背包, dirty_water)；0 时行显示「缺脏水」', () => {
    const s = createNewGame(2026);
    expect(countItem(s.player.inventory, 'dirty_water')).toBe(0);
    addItem(s.player.inventory, 'dirty_water', 4);
    expect(countItem(s.player.inventory, 'dirty_water')).toBe(4);
    addItem(s.player.inventory, 'dirty_water', 2);
    expect(countItem(s.player.inventory, 'dirty_water')).toBe(6); // 跨格累加
  });

  it('批量语义：purifyWater 一次炼光整袋，converted === 读数 N', () => {
    const s = createNewGame(2026);
    // 面板的净化行只在造了净水器后才出现（craftEntries 的门）。
    s.player.homeUpgrades.push('purifier');
    expect(hasUpgrade(s, 'purifier')).toBe(true);
    addItem(s.player.inventory, 'dirty_water', 3);
    const cleanBefore = countItem(s.player.inventory, 'clean_water');
    const r = purifyWater(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.converted).toBe(3);
    expect(countItem(s.player.inventory, 'dirty_water')).toBe(0);
    expect(countItem(s.player.inventory, 'clean_water')).toBe(cleanBefore + 3);
  });
});
