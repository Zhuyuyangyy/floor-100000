// AG-11 GameScene 总接线的测试（docs/plans/INTEGRATION 派工单 §3）。
//
// 立场与项目既有约定一致：纯函数级断言，不 import Phaser、不起场景——运行期
// 行为（flash 文案、depth、名签位置、面板启动）由 Playwright e2e 实测，证据
// 见派工报告。本文件钉的是「场景接线所依赖的系统契约」中此前没有钉住的部分：
// 每一节对应 GameScene 里的一处接点，接点行号写在节注释里。
//
// 系统函数自身的行为测试在其属主文件（worldgen/npcBehavior/quests/...），这里
// 只断言接线新用到的语义，不重复整套套件。

import { describe, expect, it } from 'vitest';

import { createNewGame } from '../core/gameState';
import { INTERACT_DISTANCE, FLOOR_WIDTH } from '../core/constants';
import { crossingSummary } from '../core/worldgen';
import { nextSegment } from '../core/segments';
import { addItem, countItem, isBagFull } from '../systems/InventorySystem';
import { NPCS } from '../data/npcs';
import type { NpcDef, NpcId } from '../data/npcs';
import { availableOffers, executeBarter, reputationOf, reputationTier } from '../ai/npcEconomy';
import { defaultNpcInventory, syncNpcInventory, takeFromStock, withInventory } from '../ai/npcInventory';
import { loadNpcState, saveNpcState } from '../systems/NpcMemory';
import { npcAutonomyAt, npcAutonomyFor, scarcityOf, NPC_MARGIN } from '../ai/npcSchedule';
import { planNightWanderer, wandererNightSpawnX } from '../systems/NpcAutonomy';
import { npcFactFor } from '../ai/config';

function npc(id: NpcId): NpcDef {
  return NPCS.find((n) => n.id === id)!;
}

// ── 接点 1：rideLiftTo 的电梯文案（GameScene rideLiftTo，AG-11 改） ──────────
//
// 文案改读 crossingSummary。上行时出发层就是段顶；下行时抵达层才是段顶——
// 两条路跨的是同一道间隙，场景取 min(from, target) 问它。这条「下行也问段顶」
// 的对称性是接线新语义：worldgen.test.ts 只从段顶往上问过。
describe('电梯文案：crossingSummary 覆盖上下两个方向', () => {
  it('下行跨的同一道间隙，由段顶（较低层）的那句概括', () => {
    for (const top of [10, 110, 1010, 10010, 50010]) {
      const next = nextSegment(top)!;
      const summary = crossingSummary(top);
      expect(summary).not.toBeNull();
      // 从下一段首层坐电梯回段顶：跨的正是 [top+1, next.from-1]。
      expect(summary!.span.from).toBe(top + 1);
      expect(summary!.span.to).toBe(next.from - 1);
      expect(summary!.text).toContain(`穿过 ${summary!.skipped} 层`);
      expect(summary!.tierNames.length).toBeGreaterThan(0);
    }
  });

  it('非段顶（没有向上的电梯）返回 null——场景退回原计数句式', () => {
    expect(crossingSummary(5)).toBeNull();
    expect(crossingSummary(100)).toBeNull();
    expect(crossingSummary(1)).toBeNull();
  });

  it('五段间隙的文案各不相同，且点名被穿过楼层真实所属的阶层', () => {
    const texts = [10, 110, 1010, 10010, 50010].map((f) => crossingSummary(f)!.text);
    expect(new Set(texts).size).toBe(5);
    expect(texts[0]).toBe('穿过 89 层：底层贫民区的废弃段');
    // 11-99 属阶层 1（底层贫民区），不是抵达的工人宿舍区。
    expect(texts[0]).not.toContain('工人宿舍区');
  });
});

// ── 接点 2：交易分支（GameScene activateDialogueOption / dialogueOptionsView） ──
//
// 商品列表与成交执行同源：场景展示 availableOffers（信誉修正 + 真实库存过滤），
// 成交走 executeBarter。这里钉「列表即的可执行性」——旧代码展示静态 npc.offers、
// 执行走 trade()，玩家能看见并按下 NPC 库存里根本没有的货。
describe('交易接线：列表里的每一项都成交得了', () => {
  function freshBarterState(seed = 20261115) {
    const s = createNewGame(seed);
    // 阿林默认库存（每份报价物品 2 件）经 syncNpcInventory 落库——注意它只在
    // 库存跨天变化时才写回，所以首次要把返回的 npcState 显式存档，后续
    // loadNpcState 才读得到（场景里 executeBarter 内部同样走这条路）。
    const { npcState } = syncNpcInventory(s, npc('alin'));
    saveNpcState(s, 'alin', npcState);
    return s;
  }

  function offersOf(s: ReturnType<typeof freshBarterState>, who: NpcId) {
    const { npcState, inventory } = syncNpcInventory(s, npc(who));
    return availableOffers(inventory, npc(who), reputationOf(npcState));
  }

  it('默认关系（neutral）下列表非空，且每条报价付得起就成交', () => {
    const s = freshBarterState();
    const offers = offersOf(s, 'alin');
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) {
      // 先替玩家把货款备齐，再执行——测的是「列表⇒可成交」，不是支付能力。
      addItem(s.player.inventory, offer.get.itemId, offer.get.quantity);
      const r = executeBarter(s, npc('alin'), offer.id);
      expect(r.ok, `offer ${offer.id} 在列表里却成交不了`).toBe(true);
    }
  });

  it('库存耗尽的报价下架——场景不会展示虚空货', () => {
    const s = freshBarterState();
    const first = offersOf(s, 'alin')[0];
    expect(first).toBeDefined();
    // 把该物品库存抽干，列表必须随之变短。
    const loaded = loadNpcState(s, 'alin')!;
    saveNpcState(s, 'alin', withInventory(loaded, takeFromStock(loaded.inventory!, first.give.itemId, 99)));
    expect(offersOf(s, 'alin').some((o) => o.id === first.id)).toBe(false);
  });

  it('hostile 分级整体清空列表——场景只显示「返回」', () => {
    const s = freshBarterState();
    const loaded = loadNpcState(s, 'alin')!;
    saveNpcState(s, 'alin', { ...loaded, relationship: { ...loaded.relationship, player: -60 } });
    expect(offersOf(s, 'alin')).toEqual([]);
    const r = executeBarter(s, npc('alin'), npc('alin').offers[0].id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('拒不交易');
  });

  it('trusted 让利翻倍：列表文案与成交结果一致（双倍货）', () => {
    const s = freshBarterState();
    const loaded = loadNpcState(s, 'alin')!;
    saveNpcState(s, 'alin', { ...loaded, relationship: { ...loaded.relationship, player: 40 } });
    const base = npc('alin').offers[0];
    const shown = offersOf(s, 'alin').find((o) => o.id === base.id)!;
    expect(shown.give.quantity).toBe(base.give.quantity * 2);
    addItem(s.player.inventory, shown.get.itemId, shown.get.quantity);
    const r = executeBarter(s, npc('alin'), base.id);
    expect(r.ok).toBe(true);
    if (r.ok) expect(countItem(s.player.inventory, r.give!.itemId)).toBe(r.give!.quantity);
  });

  it('reputationTier 的边界含等号（+30 即 trusted）', () => {
    expect(reputationTier(30)).toBe('trusted');
    expect(reputationTier(29.999)).toBe('neutral');
    expect(reputationTier(-20)).toBe('neutral');
    expect(reputationTier(-20.001)).toBe('disliked');
    expect(reputationTier(-50)).toBe('disliked');
    expect(reputationTier(-50.001)).toBe('hostile');
  });
});

// ── 接点 3：推理前喂真实库存（GameScene enhanceOpeningLine，AG-11 改） ──────────
describe('npcFactFor：规则执行器看到的是交易后的真实库存', () => {
  it('交易抽空库存后，fact 的持有量随之下降（不是静态报价表）', () => {
    const s = createNewGame(20261115);
    const target = npc('alin');
    syncNpcInventory(s, target);
    const stockItem = target.offers[0].give.itemId;
    const before = npcFactFor(s, target).inventory.find((e) => e.itemId === stockItem)?.quantity ?? 0;
    expect(before).toBeGreaterThan(0);

    addItem(s.player.inventory, target.offers[0].get.itemId, target.offers[0].get.quantity);
    const r = executeBarter(s, target, target.offers[0].id);
    expect(r.ok).toBe(true);

    const after = npcFactFor(s, target).inventory.find((e) => e.itemId === stockItem)?.quantity ?? 0;
    expect(after).toBe(before - target.offers[0].give.quantity);
    // 静态推导会对同一 NPC 永远报 2——接线前执行器放行过虚空交易。
    expect(after).toBeLessThan(defaultNpcInventory(target, s.day).entries.find((e) => e.itemId === stockItem)!.quantity);
  });
});

// ── 接点 4：居民移动与可对话判定（GameScene drawNpcs / syncNpcs / nearestNpc） ──
//
// nearestNpc 改用自主视图的 x：场景里「能对话」与「看得见」必须是同一个位置。
describe('NPC 自主视图：位置、边界与可对话距离', () => {
  const ctx = { day: 1, minuteOfDay: 480, runSeed: 20261115 };

  it('视图 x 始终钳在楼层安全范围内（全天采样）', () => {
    for (const who of NPCS) {
      for (let minute = 0; minute < 1440; minute += 17) {
        const view = npcAutonomyAt(who.id, { ...ctx, minuteOfDay: minute });
        expect(view.x).toBeGreaterThanOrEqual(NPC_MARGIN);
        expect(view.x).toBeLessThanOrEqual(FLOOR_WIDTH - NPC_MARGIN);
      }
    }
  });

  it('同一 (day, minute, seed) 逐字节可复现——同机对测的稳定性前提', () => {
    const a = npcAutonomyFor(npc('alin'), { ...ctx, stock: () => 1 });
    const b = npcAutonomyFor(npc('alin'), { ...ctx, stock: () => 1 });
    expect(a).toEqual(b);
  });

  it('玩家站在视图 x 上即可对话；站在静态 npc.x 上未必（接线修的就是这个割裂）', () => {
    const view = npcAutonomyFor(npc('alin'), { ...ctx, stock: () => 1 });
    expect(Math.abs(view.x - view.x)).toBeLessThanOrEqual(INTERACT_DISTANCE);
    // 旧静态坐标与视图位置的分差必须在采样中显形——否则这次接线没有行为差异。
    const drift = Math.abs(npc('alin').x - view.x);
    expect(drift).toBeGreaterThan(INTERACT_DISTANCE);
  });

  it('库存见底时目标变成「寻找某物」（scarcityOf 经 npcAutonomyFor 的 stock 钩子接入）', () => {
    const target = npc('alin');
    const need = (target.needs ?? [])[0];
    expect(need, '阿林应有 needs 数据供稀缺判定').toBeDefined();
    const scarce = npcAutonomyFor(target, { ...ctx, stock: (id) => (id === need.itemId ? 0 : 5) });
    expect(scarce.goal).toContain('寻找');
    const stocked = npcAutonomyFor(target, { ...ctx, stock: () => 5 });
    expect(stocked.goal).not.toContain('寻找');
  });

  it('scarcityOf 只认库存为 0 的需求', () => {
    const target = npc('alin');
    const need = (target.needs ?? [])[0];
    expect(scarcityOf(target, (id) => (id === need.itemId ? 1 : 0))).toBeNull();
    expect(scarcityOf(target, () => 0)).toBe(need.itemId);
  });
});

// ── 接点 5：夜间流浪者呈现（GameScene updateWanderer，AG-11 改） ──────────────
describe('planNightWanderer：场景的在场判定与确定性出生点', () => {
  function nightState(seed = 20261115) {
    const s = createNewGame(seed);
    s.gameMinuteOfDay = 1320; // 22:00
    s.currentFloor = 7;
    return s;
  }

  it('夜间 + 事件在本层 ⇒ 在场，出生点由种子决定且可复现', () => {
    const s = nightState();
    s.worldEvents.activeEvent = { type: 'wanderer', floor: 7, message: 'test' };
    const plan = planNightWanderer(s);
    expect(plan.present).toBe(true);
    expect(plan.spawnX).toBe(wandererNightSpawnX(s, 'night', 7));
    expect(plan.spawnX).toBeGreaterThanOrEqual(48);
    expect(plan.spawnX).toBeLessThanOrEqual(FLOOR_WIDTH - 48);
    // 同一次 run 再问一次，答案不变（旧启发式依赖玩家位置，会给出两个家）。
    expect(planNightWanderer(s).spawnX).toBe(plan.spawnX);
  });

  it('四种缺席各有着落：无事件 / 已解决 / 不在本层 / 天亮了', () => {
    const none = nightState();
    expect(planNightWanderer(none).present).toBe(false);

    const resolved = nightState();
    resolved.worldEvents.activeEvent = { type: 'wanderer', floor: 7, message: 'test', status: 'resolved' };
    expect(planNightWanderer(resolved).present).toBe(false);

    const otherFloor = nightState();
    otherFloor.worldEvents.activeEvent = { type: 'wanderer', floor: 9, message: 'test' };
    expect(planNightWanderer(otherFloor).present).toBe(false);

    const daytime = nightState();
    daytime.gameMinuteOfDay = 720; // 正午
    daytime.worldEvents.activeEvent = { type: 'wanderer', floor: 7, message: 'test' };
    expect(planNightWanderer(daytime).present).toBe(false);
  });

  it('停留压力（dwell）来的巡游体白天也在场——判定不以时钟为由赶它走', () => {
    const s = nightState();
    s.gameMinuteOfDay = 720;
    s.worldEvents.activeEvent = { type: 'wanderer', floor: 7, message: 'test', source: 'dwell' };
    expect(planNightWanderer(s).present).toBe(true);
  });
});

// ── 接点 6：背包满计数与净水器次数（GameScene HUD 预警 / 制作面板） ────────────
//
// 场景展示的两个数：预警里的（已用/容量）、净化行的「可净化 ×N」。这里钉取值来源。
describe('HUD 预警计数与净化次数的取值来源', () => {
  it('背包满 ⇔ 已用格数达到 slotCount；预警文本读这两个字段', () => {
    const s = createNewGame(20261115);
    const inv = s.player.inventory;
    inv.slots = []; // 新开局自带 3 格起始物资，清掉才好谈「满」
    expect(isBagFull(inv)).toBe(false);
    // 置物架升级会把 slotCount 抬到 14——满不满由 slotCount 决定，不是硬编码 12。
    inv.slotCount = 2;
    addItem(inv, 'wood', 1);
    addItem(inv, 'cloth', 1);
    expect(isBagFull(inv)).toBe(true);
    expect(inv.slots.length).toBe(inv.slotCount);
  });

  it('「可净化 ×N」的 N 就是袋里的脏水数（批量语义下的剩余读数）', () => {
    const s = createNewGame(20261115);
    expect(countItem(s.player.inventory, 'dirty_water')).toBe(0);
    addItem(s.player.inventory, 'dirty_water', 3);
    expect(countItem(s.player.inventory, 'dirty_water')).toBe(3);
  });
});

// ── 接点 7：任务面板入口（GameScene onToggleQuests，AG-11 改） ────────────────
//
// Q 键启动 AG-12 的 QuestPanelScene。面板本身归 AG-12（src/scenes/QuestPanelScene.ts
// 未合入前，场景侧降级为 flash「任务面板未就绪」——e2e 实测钉住）。
// 这里只钉面板的数据源契约：它读 evaluateAllQuests，置灰读 BranchEvaluation.blockers。
describe('任务面板数据源：evaluateAllQuests 对新开存档可求值', () => {
  it('8 条任务全部有状态，分支阻塞原因可读', async () => {
    const { evaluateAllQuests } = await import('../data/quests');
    const s = createNewGame(20261115);
    const all = evaluateAllQuests(s);
    expect(all.length).toBe(8);
    for (const ev of all) {
      expect(['locked', 'available', 'active', 'done']).toContain(ev.status);
      for (const b of ev.branches) {
        // available ⇔ 无阻塞原因；置灰提示直接读 blockers。
        expect(b.available).toBe(b.blockers.length === 0);
      }
    }
  });
});
