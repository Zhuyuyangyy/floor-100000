// B6：NPC 记忆/人格/关系/库存/行为决策的行为测试（docs/plans/NPC.md）。
//
// 覆盖任务书的五类断言：
// 1. 库存耗尽与补充（真实库存 + 跨天结算 + 存档持久化 + 老存档兼容）
// 2. 信誉影响价格（确定性：同一关系值 → 同一报价，不依赖模型推理）
// 3. 夜间流浪者出现（planNightWanderer 读 EventSystem 产物，纯函数）
// 4. 自主移动不越界（日程锚点间移动 + 种子化闲逛，全天采样钳制在楼层内）
// 5. 同 seed 可复现（位置/出生点/游荡全部是 (seed, day, minute) 的纯函数）
//
// 铁律：本文件不 import 任何推理脑（OllamaBrain 等），全部离线可跑。

import { describe, expect, it } from 'vitest';

import { createNewGame } from '../core/gameState';
import { FLOOR_WIDTH } from '../core/constants';
import { deriveSeed, makeRng } from '../core/rng';
import { addItem, countItem } from '../systems/InventorySystem';
import { getItem } from '../data/items';
import { getNpc, NPCS } from '../data/npcs';
import type { NpcDef, NpcId } from '../data/npcs';
import { createNpcState } from '../data/npcPersonalities';
import { deserialize, serialize } from '../systems/SaveSystem';
import { loadNpcState, recordMemory, saveNpcState } from '../systems/NpcMemory';
import {
  advanceNpcInventory,
  defaultNpcInventory,
  freshStateFor,
  giveToStock,
  stockOf,
  syncNpcInventory,
  takeFromStock,
} from '../ai/npcInventory';
import {
  adjustOffer,
  attitudeLine,
  availableOffers,
  executeBarter,
  giftOffer,
  receiveGift,
  claimGift,
  reputationOf,
  reputationTier,
  REPUTATION_THRESHOLDS,
} from '../ai/npcEconomy';
import { npcFactFor } from '../ai/config';
import {
  npcAutonomyAt,
  npcAutonomyFor,
  scheduleFor,
  slotAt,
  scarcityOf,
  NPC_MARGIN,
} from '../ai/npcSchedule';
import {
  freshWandererRoam,
  planNightWanderer,
  stepWandererRoam,
  wandererAggroRange,
  wandererNightSpawnX,
  wandererRoamGone,
  WANDERER_GRUDGE_MULTIPLIER,
  WANDERER_GRUDGE_RELATIONSHIP,
} from '../systems/NpcAutonomy';
import type { GameState } from '../core/gameTypes';
import type { NpcInventory, NpcPersistedState } from '../ai/types';

// ── 布阵助手 ────────────────────────────────────────────────────────────────

function npc(id: NpcId): NpcDef {
  return getNpc(id);
}

/** 把 NPC 持久状态写进 npcStates（模拟存档里已存在的状态）。 */
function seedNpcState(s: GameState, id: NpcId, patch: Partial<NpcPersistedState> = {}): void {
  saveNpcState(s, id, { ...freshStateFor(npc(id), 1), ...patch });
}

/** 手工库存（测试纯函数用，不经过报价表推导）。 */
function handInventory(entries: NpcInventory['entries'], lastRestockDay = 1): NpcInventory {
  return { entries, lastRestockDay };
}

const NIGHT_MINUTE = 1200; // 20:00，夜间
const NOON_MINUTE = 720; // 12:00，白天

function withWandererEvent(s: GameState, patch: Partial<Extract<GameState['worldEvents']['activeEvent'], object>> = {}): void {
  s.worldEvents.activeEvent = {
    type: 'wanderer',
    floor: 3,
    message: '巡游体在这一层游荡',
    source: 'night',
    ...patch,
  };
}

// ── 1. NPC 真实库存：耗尽、补充、持久化 ─────────────────────────────────────

describe('NPC 真实库存（npcInventory）', () => {
  it('默认库存由静态报价表推导：每个 give 物品备两份，可补货', () => {
    const inv = defaultNpcInventory(npc('alin'), 1);
    expect(inv.lastRestockDay).toBe(1);
    const wire = inv.entries.find((e) => e.itemId === 'wire');
    const fuse = inv.entries.find((e) => e.itemId === 'fuse');
    expect(wire).toEqual({ itemId: 'wire', quantity: 2, max: 6, restockPerDay: 1 });
    expect(fuse).toEqual({ itemId: 'fuse', quantity: 2, max: 6, restockPerDay: 1 });
  });

  it('takeFromStock 绝不超取：取 5 件只剩 2 件的货 → 0', () => {
    const inv = defaultNpcInventory(npc('alin'), 1);
    const after = takeFromStock(inv, 'wire', 5);
    expect(stockOf(after, 'wire')).toBe(0);
    expect(stockOf(inv, 'wire')).toBe(2); // 纯函数：原对象不动
  });

  it('giveToStock：新物品按赠品规则入账（上限 9、不补货），既有条目封顶 max', () => {
    const inv = defaultNpcInventory(npc('alin'), 1);
    const gifted = giveToStock(inv, 'wood', 12); // 玩家送 12 块木头
    const wood = gifted.entries.find((e) => e.itemId === 'wood');
    expect(wood).toEqual({ itemId: 'wood', quantity: 9, max: 9, restockPerDay: 0 });
    const wired = giveToStock(gifted, 'wire', 9); // 补货物种封顶 max=6
    expect(stockOf(wired, 'wire')).toBe(6);
    expect(giveToStock(inv, 'wood', 0)).toBe(inv); // 0 件是恒等操作
  });

  it('advanceNpcInventory：同日重复结算是恒等操作', () => {
    const inv = defaultNpcInventory(npc('xiaozhou'), 1);
    expect(advanceNpcInventory(inv, npc('xiaozhou'), 1)).toBe(inv);
    expect(advanceNpcInventory(inv, npc('xiaozhou'), 1)).toBe(inv);
  });

  it('advanceNpcInventory：跨天补货封顶 max，离开越久库存越满', () => {
    const inv = handInventory([{ itemId: 'wire', quantity: 0, max: 3, restockPerDay: 1 }], 1);
    const day5 = advanceNpcInventory(inv, npc('alin'), 5); // 离开 4 天
    expect(stockOf(day5, 'wire')).toBe(3); // min(3, 0 + 1×4)
    expect(day5.lastRestockDay).toBe(5);
    expect(inv.entries[0].quantity).toBe(0); // 纯函数
  });

  it('advanceNpcInventory：needs 需求先于补货扣除——小周每天吃掉自家 1 个面包', () => {
    // 不补货的赠品面包：5 个，小周每天吃 1 个，3 天后剩 2 个。
    const inv = handInventory([{ itemId: 'bread', quantity: 5, max: 9, restockPerDay: 0 }], 1);
    const day4 = advanceNpcInventory(inv, npc('xiaozhou'), 4);
    expect(stockOf(day4, 'bread')).toBe(2);
  });

  it('syncNpcInventory：老存档没有 inventory 字段 → 补默认库存，不崩', () => {
    const s = createNewGame(3);
    // 阶段 B 的老存档：只有人格/关系/记忆，没有库存。
    s.npcStates['alin'] = JSON.stringify({ ...createNpcState('ally'), relationship: { player: 10 } });
    expect(loadNpcState(s, 'alin')).not.toBeNull();
    const { inventory, npcState } = syncNpcInventory(s, npc('alin'));
    expect(stockOf(inventory, 'wire')).toBe(2);
    expect(npcState.relationship.player).toBe(10); // 既有关系不被冲掉
  });

  it('syncNpcInventory：坏 JSON / 畸形状态 → 判坏并按「首次遇到」重建，不抛错', () => {
    const s = createNewGame(4);
    s.npcStates['xiaozhou'] = '{"archetype":"ally","traits":{"altruism":9'; // 坏 JSON
    s.npcStates['wanderer'] = JSON.stringify({ archetype: 'ally', traits: { altruism: 9 } }); // 畸形
    expect(loadNpcState(s, 'xiaozhou')).toBeNull();
    expect(loadNpcState(s, 'wanderer')).toBeNull();
    const { inventory } = syncNpcInventory(s, npc('xiaozhou'));
    expect(stockOf(inventory, 'bread')).toBe(2);
    expect(stockOf(inventory, 'clean_water')).toBe(2);
  });

  it('库存随存档持久化：交易耗尽 → serialize/deserialize round-trip 后读回一致', () => {
    const s = createNewGame(11);
    seedNpcState(s, 'alin', { relationship: { player: 5 } });
    addItem(s.player.inventory, 'scrap_metal', 1);
    const r = executeBarter(s, npc('alin'), 'alin_wire');
    expect(r.ok).toBe(true);
    expect(stockOf(r.inventory!, 'wire')).toBe(1); // 开店 2 件，卖掉 1 件

    const back = deserialize(serialize(s)); // 完整过一遍 SaveSystem
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const loaded = loadNpcState(back.state, 'alin');
    expect(loaded).not.toBeNull();
    expect(stockOf(loaded!.inventory!, 'wire')).toBe(1); // 耗尽状态存住了
    expect(loaded!.relationship.player).toBeGreaterThan(5); // trade 记忆也存住了
    // 读回来的存档继续交易：按天结算后 wire 会补回来
    back.state.day = 2;
    const { inventory } = syncNpcInventory(back.state, npc('alin'));
    expect(stockOf(inventory, 'wire')).toBe(2); // 1 + 1 补货
  });

  it('npcFactFor：执行器看到的是真实库存而不是静态报价表', () => {
    const s = createNewGame(12);
    seedNpcState(s, 'alin');
    expect(npcFactFor(s, npc('alin')).inventory).toEqual(
      expect.arrayContaining([{ itemId: 'wire', quantity: 2 }, { itemId: 'fuse', quantity: 2 }]),
    );
    addItem(s.player.inventory, 'scrap_metal', 1);
    executeBarter(s, npc('alin'), 'alin_wire');
    expect(npcFactFor(s, npc('alin')).inventory.find((st) => st.itemId === 'wire')?.quantity).toBe(1);
  });
});

// ── 2. 信誉确定性影响交易与态度 ─────────────────────────────────────────────

describe('信誉 → 交易与态度（确定性，不依赖模型推理）', () => {
  it('reputationTier 边界含等号：+30 trusted / -20 neutral / -50 disliked 之下 hostile', () => {
    expect(reputationTier(REPUTATION_THRESHOLDS.trusted)).toBe('trusted');
    expect(reputationTier(29.99)).toBe('neutral');
    expect(reputationTier(REPUTATION_THRESHOLDS.disliked)).toBe('neutral');
    expect(reputationTier(-20.01)).toBe('disliked');
    expect(reputationTier(REPUTATION_THRESHOLDS.hostile)).toBe('disliked');
    expect(reputationTier(-50.01)).toBe('hostile');
    expect(reputationOf({ ...createNpcState('ally') })).toBe('neutral'); // 缺省 0
  });

  it('adjustOffer：trusted 让利 give 翻倍，disliked 加价 get 翻倍，neutral 原样', () => {
    const offer = npc('alin').offers[0]; // 电线 ← 废金属
    expect(adjustOffer(offer, 'trusted').give.quantity).toBe(2);
    expect(adjustOffer(offer, 'trusted').get.quantity).toBe(1);
    expect(adjustOffer(offer, 'disliked').get.quantity).toBe(2);
    expect(adjustOffer(offer, 'disliked').give.quantity).toBe(1);
    expect(adjustOffer(offer, 'neutral')).toBe(offer); // 同一引用，零拷贝
    expect(adjustOffer(offer, 'hostile')).toBe(offer);
  });

  it('availableOffers：库存不足就下架——wire 只剩 1 份时，trusted 的双倍电线买不到', () => {
    const inv = defaultNpcInventory(npc('alin'), 1); // wire 2、fuse 2
    const full = availableOffers(inv, npc('alin'), 'trusted').map((o) => o.id);
    expect(full).toEqual(['alin_wire', 'alin_fuse']); // 双倍货从第 1 天就兑得现
    const depleted = takeFromStock(inv, 'wire', 1); // wire 只剩 1 份
    const trusted = availableOffers(depleted, npc('alin'), 'trusted').map((o) => o.id);
    expect(trusted).toEqual(['alin_fuse']); // wire 要 2 份，库存 1 → 下架
    const neutral = availableOffers(depleted, npc('alin'), 'neutral').map((o) => o.id);
    expect(neutral).toEqual(['alin_wire', 'alin_fuse']); // neutral 只要 1 份，照常
    expect(availableOffers(inv, npc('alin'), 'hostile')).toEqual([]);
  });

  it('attitudeLine：同一 NPC 四种信誉四句台词，neutral 走兜底句', () => {
    expect(attitudeLine(npc('alin'), 'trusted')).toBe('老主顾，维修件我给你留着。');
    expect(attitudeLine(npc('alin'), 'disliked')).toBe('你上次那事我没忘——得加价。');
    expect(attitudeLine(npc('alin'), 'hostile')).toBe('别靠近我。线路不伺候你。');
    expect(attitudeLine(npc('alin'), 'neutral')).toBe('拿东西换就行。'); // data 里没写 neutral，用兜底
  });

  it('executeBarter（neutral）：1 废金属换 1 电线，库存 2→1 并记一条 trade 记忆', () => {
    const s = createNewGame(21);
    seedNpcState(s, 'alin');
    addItem(s.player.inventory, 'scrap_metal', 1);
    const r = executeBarter(s, npc('alin'), 'alin_wire');
    expect(r.ok).toBe(true);
    expect(r.give).toEqual({ itemId: 'wire', quantity: 1 });
    expect(r.tier).toBe('neutral');
    expect(countItem(s.player.inventory, 'wire')).toBe(1);
    expect(countItem(s.player.inventory, 'scrap_metal')).toBe(0);
    expect(stockOf(r.inventory!, 'wire')).toBe(1);
    const loaded = loadNpcState(s, 'alin')!;
    expect(loaded.memory.some((m) => m.kind === 'trade')).toBe(true);
    expect(loaded.relationship.player).toBeCloseTo(3.6, 5); // 0.15×20×(0.5+ally loyalty 0.7)
  });

  it('executeBarter：库存耗尽后再买同一件 → 失败且不改状态', () => {
    const s = createNewGame(22);
    seedNpcState(s, 'alin');
    addItem(s.player.inventory, 'scrap_metal', 3);
    expect(executeBarter(s, npc('alin'), 'alin_wire').ok).toBe(true); // wire 2→1
    expect(executeBarter(s, npc('alin'), 'alin_wire').ok).toBe(true); // wire 1→0
    const before = countItem(s.player.inventory, 'scrap_metal');
    const r = executeBarter(s, npc('alin'), 'alin_wire');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('没有这件货');
    expect(countItem(s.player.inventory, 'scrap_metal')).toBe(before); // 不少扣
    expect(availableOffers(syncNpcInventory(s, npc('alin')).inventory, npc('alin'), 'neutral').map((o) => o.id))
      .toEqual(['alin_fuse']); // 只剩保险丝
  });

  it('executeBarter（trusted）：补货到 3 份后，1 废金属换 2 电线（老主顾让利）', () => {
    const s = createNewGame(23);
    seedNpcState(s, 'alin', { relationship: { player: 40 } }); // 第 1 天存档，库存 wire 2
    s.day = 2; // 过了一天：wire 补到 3
    addItem(s.player.inventory, 'scrap_metal', 1);
    const r = executeBarter(s, npc('alin'), 'alin_wire');
    expect(r.ok).toBe(true);
    expect(r.tier).toBe('trusted');
    expect(r.give).toEqual({ itemId: 'wire', quantity: 2 });
    expect(countItem(s.player.inventory, 'wire')).toBe(2);
    expect(countItem(s.player.inventory, 'scrap_metal')).toBe(0); // 还是只收 1 份
    expect(stockOf(r.inventory!, 'wire')).toBe(1); // 3 - 2
  });

  it('executeBarter（disliked）：心生芥蒂，2 废金属才换 1 电线', () => {
    const s = createNewGame(24);
    seedNpcState(s, 'alin', { relationship: { player: -30 } });
    addItem(s.player.inventory, 'scrap_metal', 1);
    const poor = executeBarter(s, npc('alin'), 'alin_wire');
    expect(poor.ok).toBe(false); // 只带 1 份不够付双倍价
    addItem(s.player.inventory, 'scrap_metal', 1);
    const r = executeBarter(s, npc('alin'), 'alin_wire');
    expect(r.ok).toBe(true);
    expect(r.tier).toBe('disliked');
    expect(countItem(s.player.inventory, 'scrap_metal')).toBe(0);
    expect(countItem(s.player.inventory, 'wire')).toBe(1);
  });

  it('executeBarter（hostile）：拒不交易，报价全下架', () => {
    const s = createNewGame(25);
    seedNpcState(s, 'alin', { relationship: { player: -60 } });
    addItem(s.player.inventory, 'scrap_metal', 5);
    const r = executeBarter(s, npc('alin'), 'alin_wire');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('拒不交易');
    expect(countItem(s.player.inventory, 'scrap_metal')).toBe(5); // 分文未取
    expect(countItem(s.player.inventory, 'wire')).toBe(0);
  });

  it('executeBarter 确定性：两个完全相同的存档执行同一笔交易，结果逐字节一致', () => {
    const build = (): GameState => {
      const s = createNewGame(26);
      seedNpcState(s, 'alin', { relationship: { player: 40 } });
      s.day = 2;
      addItem(s.player.inventory, 'scrap_metal', 1);
      return s;
    };
    const a = executeBarter(build(), npc('alin'), 'alin_wire');
    const b = executeBarter(build(), npc('alin'), 'alin_wire');
    expect(a).toEqual(b);
  });

  it('receiveGift：玩家赠品真的进入 NPC 库存（赠品规则：上限 9、不补货）并提升关系', () => {
    const s = createNewGame(27);
    seedNpcState(s, 'alin');
    const r = receiveGift(s, npc('alin'), 'wood', 3);
    expect(r.ok).toBe(true);
    expect(stockOf(r.inventory!, 'wood')).toBe(3);
    const entry = r.inventory!.entries.find((e) => e.itemId === 'wood')!;
    expect(entry).toEqual({ itemId: 'wood', quantity: 3, max: 9, restockPerDay: 0 });
    expect(r.relationship).toBeCloseTo(14.4, 5); // 0.6×20×(0.5+0.7)
    expect(loadNpcState(s, 'alin')!.memory.some((m) => m.kind === 'gift')).toBe(true);
  });

  it('claimGift：trusted 且有余量时 NPC 回赠 1 件并扣库存；自用物资（needs）捂着不送', () => {
    const s = createNewGame(28);
    // 库存只有保险丝×1（阿林每天自己要消耗 1 个）→ 没有可回赠的
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
    expect(giftOffer(npc('alin'), syncNpcInventory(s, npc('alin')).inventory, 'trusted')).toBeNull();
    expect(claimGift(s, npc('alin')).ok).toBe(false);

    // 第 3 天：fuse 被 needs 吃掉又补回 2 份，wire 补到 2 份 → 回赠 1 件 wire
    s.day = 3;
    const before = syncNpcInventory(s, npc('alin')).inventory;
    const r = claimGift(s, npc('alin'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itemId).toBe('wire');
    expect(r.quantity).toBe(1);
    expect(stockOf(r.inventory, 'wire')).toBe(stockOf(before, 'wire') - 1);
    expect(stockOf(loadNpcState(s, 'alin')!.inventory!, 'wire')).toBe(stockOf(before, 'wire') - 1);
  });

  it('giftOffer：余量再多的自用物资（needs）也不回赠', () => {
    const inv = handInventory([{ itemId: 'fuse', quantity: 5, max: 9, restockPerDay: 1 }], 1);
    expect(giftOffer(npc('alin'), inv, 'trusted')).toBeNull(); // fuse 是阿林自己每天要用的
    // 换成非自用的 wire 就能送
    const withSpare = handInventory(
      [
        { itemId: 'fuse', quantity: 5, max: 9, restockPerDay: 1 },
        { itemId: 'wire', quantity: 2, max: 6, restockPerDay: 1 },
      ],
      1,
    );
    expect(giftOffer(npc('alin'), withSpare, 'trusted')).toEqual({ itemId: 'wire', quantity: 1 });
  });

  it('giftOffer：非 trusted 分级一律没有回赠', () => {
    const inv = defaultNpcInventory(npc('alin'), 2);
    expect(giftOffer(npc('alin'), inv, 'neutral')).toBeNull();
    expect(giftOffer(npc('alin'), inv, 'disliked')).toBeNull();
    expect(giftOffer(npc('alin'), inv, 'hostile')).toBeNull();
  });
});

// ── 3. 流浪者接入夜间事件 ───────────────────────────────────────────────────

describe('夜间流浪者导演器（planNightWanderer）', () => {
  function nightState(seed = 31): GameState {
    const s = createNewGame(seed);
    s.currentFloor = 3;
    s.gameMinuteOfDay = NIGHT_MINUTE;
    withWandererEvent(s);
    return s;
  }

  it('没有巡游体事件 → 不在场', () => {
    const s = nightState();
    s.worldEvents.activeEvent = null;
    const plan = planNightWanderer(s);
    expect(plan.present).toBe(false);
    expect(plan.reason).toContain('没有巡游体事件');
  });

  it('非巡游体事件（停电/漏水）→ 不在场', () => {
    const s = nightState();
    s.worldEvents.activeEvent = { type: 'blackout', floor: 3, message: '灯灭了' };
    expect(planNightWanderer(s).present).toBe(false);
  });

  it('事件已解决 → 不在场', () => {
    const s = nightState();
    s.worldEvents.activeEvent!.status = 'resolved';
    const plan = planNightWanderer(s);
    expect(plan.present).toBe(false);
    expect(plan.reason).toContain('已解决');
  });

  it('巡游体不在当前层 → 不在场（它只在自己那层活动）', () => {
    const s = nightState();
    s.currentFloor = 4;
    const plan = planNightWanderer(s);
    expect(plan.present).toBe(false);
    expect(plan.floor).toBe(3); // 报告的是事件楼层
    expect(plan.reason).toContain('不在本层');
  });

  it('夜间 + 巡游体事件 + 同层 → 在场，带确定性出生点与仇恨范围', () => {
    const s = nightState();
    const plan = planNightWanderer(s);
    expect(plan.present).toBe(true);
    expect(plan.floor).toBe(3);
    expect(plan.spawnX).toBeGreaterThanOrEqual(48);
    expect(plan.spawnX).toBeLessThanOrEqual(FLOOR_WIDTH - 48);
    expect(plan.aggroRange).toBe(260); // ARCHETYPES.hostile.aggroRange
  });

  it('天亮了 night 事件不出现；dwell 事件白天也出现（压力来自停留而不是时钟）', () => {
    const s = nightState();
    s.gameMinuteOfDay = NOON_MINUTE;
    const day = planNightWanderer(s);
    expect(day.present).toBe(false);
    expect(day.reason).toContain('天亮');
    s.worldEvents.activeEvent!.source = 'dwell';
    expect(planNightWanderer(s).present).toBe(true);
  });

  it('出生点同 (runSeed, day, source, floor) 可复现；不同 seed 产生不同出生点', () => {
    const s = nightState(31);
    expect(wandererNightSpawnX(s, 'night', 3)).toBe(wandererNightSpawnX(s, 'night', 3));
    const spots = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) {
      spots.add(wandererNightSpawnX(nightState(seed), 'night', 3));
    }
    expect(spots.size).toBeGreaterThan(1); // 种子真的在生效
  });

  it('结仇放大仇恨范围：关系 <= -30 时 aggroRange ×1.5（记忆真的影响行为）', () => {
    const s = nightState();
    expect(wandererAggroRange(s)).toBe(260);
    saveNpcState(s, 'wanderer', { ...createNpcState('hostile'), relationship: { player: WANDERER_GRUDGE_RELATIONSHIP } });
    expect(wandererAggroRange(s)).toBe(Math.round(260 * WANDERER_GRUDGE_MULTIPLIER)); // 390
    expect(planNightWanderer(s).aggroRange).toBe(390);
    saveNpcState(s, 'wanderer', { ...createNpcState('hostile'), relationship: { player: -29.99 } });
    expect(wandererAggroRange(s)).toBe(260); // 差一点点就不记仇
  });

  it('stepWandererRoam：玩家进入仇恨范围 → approach 盯住玩家', () => {
    const roam = freshWandererRoam(640);
    const next = stepWandererRoam(roam, { playerX: 700, aggroRange: 260, dtMs: 16, rng: makeRng(1) });
    expect(next.phase).toBe('approach');
    expect(next.targetX).toBe(700);
    expect(next.x).toBeGreaterThan(640); // 朝玩家移动了一小步
    expect(next.x).toBeLessThan(700);
  });

  it('stepWandererRoam：patrol 到达路径点后换新点（同 rng 种子可复现）', () => {
    const setup = () => ({ roam: freshWandererRoam(640), rng: makeRng(deriveSeed(9, 'wanderer', 'patrol')) });
    const ctx = { playerX: 10, aggroRange: 100, dtMs: 16 }; // 玩家远，保持 patrol
    const a = stepWandererRoam(setup().roam, { ...ctx, rng: setup().rng });
    const b = stepWandererRoam(setup().roam, { ...ctx, rng: setup().rng });
    expect(a).toEqual(b); // 同种子同结果
    expect(a.phase).toBe('patrol');
    expect(a.targetX).not.toBe(640); // 换了路径点
    expect(a.targetX).toBeGreaterThanOrEqual(48);
    expect(a.targetX).toBeLessThanOrEqual(FLOOR_WIDTH - 48);
  });

  it('stepWandererRoam：withdraw 头也不回走向最近出口；走出画面判定 gone', () => {
    let roam = freshWandererRoam(200);
    roam = stepWandererRoam({ ...roam, phase: 'withdraw' }, { playerX: 1000, aggroRange: 260, dtMs: 16, rng: makeRng(1) });
    expect(roam.targetX).toBe(0); // 起点在左半屏 → 往左出口走
    for (let i = 0; i < 200 && !wandererRoamGone(roam); i++) {
      roam = stepWandererRoam(roam, { playerX: 1000, aggroRange: 260, dtMs: 16, rng: makeRng(1) });
    }
    expect(wandererRoamGone(roam)).toBe(true);
  });

  it('stepWandererRoam：长时间随机游荡 x 始终不越界', () => {
    let roam = freshWandererRoam(640);
    const rng = makeRng(deriveSeed(5, 'wanderer', 'roam-bounds'));
    for (let i = 0; i < 500; i++) {
      roam = stepWandererRoam(roam, { playerX: (i * 37) % FLOOR_WIDTH, aggroRange: 120, dtMs: 16, rng });
      expect(roam.x).toBeGreaterThanOrEqual(0);
      expect(roam.x).toBeLessThanOrEqual(FLOOR_WIDTH);
    }
  });
});

// ── 4. NPC 自主行动循环 ─────────────────────────────────────────────────────

describe('NPC 自主行动循环（日程移动 + 种子化闲逛）', () => {
  it('scheduleFor：阿林全天 6 格日程；未知 NPC 有兜底单格', () => {
    expect(scheduleFor('alin')).toHaveLength(6);
    expect(scheduleFor('xiaozhou')).toHaveLength(6);
    const fallback = scheduleFor('nobody');
    expect(fallback).toHaveLength(1);
    expect(fallback[0].from).toBe(0);
    expect(fallback[0].to).toBe(1440);
  });

  it('slotAt：跨午夜的「睡觉」格在 00:00 与 05:59 都正确命中', () => {
    const slots = scheduleFor('alin'); // 最后一段 1230→360 跨午夜
    expect(slotAt(slots, 0).index).toBe(5);
    expect(slotAt(slots, 359).index).toBe(5);
    expect(slotAt(slots, 360).index).toBe(0); // 06:00 开始巡查
    expect(slotAt(slots, 540).index).toBe(1);
    expect(slotAt(slots, 1439).index).toBe(5);
  });

  it('npcAutonomyAt：06:00 从睡觉点出发走向巡查点，随后抵达闲逛', () => {
    const ctx = { day: 1, minuteOfDay: 0, runSeed: 1 };
    const at360 = npcAutonomyAt('alin', { ...ctx, minuteOfDay: 360 });
    expect(at360.slotLabel).toBe('巡查线路');
    expect(at360.moving).toBe(true);
    expect(at360.x).toBe(300); // 上一格（睡觉）的锚点
    const at361 = npcAutonomyAt('alin', { ...ctx, minuteOfDay: 361 });
    expect(at361.moving).toBe(true);
    expect(at361.x).toBe(260); // 走了一半（80px / 40px每分钟）
    const at400 = npcAutonomyAt('alin', { ...ctx, minuteOfDay: 400 });
    expect(at400.moving).toBe(false); // 2 分钟就走到了
    expect(at400.x).toBeGreaterThanOrEqual(220 - 28);
    expect(at400.x).toBeLessThanOrEqual(220 + 28);
  });

  it('npcAutonomyAt：不同游戏时间处于不同位置（不是站着等玩家）', () => {
    const ctx = { day: 1, minuteOfDay: 0, runSeed: 1 };
    const morning = npcAutonomyAt('alin', { ...ctx, minuteOfDay: 500 }); // 巡查线路
    const evening = npcAutonomyAt('alin', { ...ctx, minuteOfDay: 1100 }); // 和人闲聊
    const night = npcAutonomyAt('alin', { ...ctx, minuteOfDay: 100 }); // 睡觉
    expect(morning.slotLabel).toBe('巡查线路');
    expect(evening.slotLabel).toBe('和人闲聊');
    expect(night.slotLabel).toBe('睡觉');
    // 三个时段的闲逛区间互不重叠（220±28 / 980±28 / 300±28）
    expect(Math.abs(morning.x - evening.x)).toBeGreaterThan(400);
    expect(Math.abs(morning.x - night.x)).toBeGreaterThan(28);
  });

  it('npcAutonomyAt：全天采样（多 seed）x 始终钳制在楼层安全范围内', () => {
    for (const id of ['alin', 'xiaozhou']) {
      for (const runSeed of [1, 2, 3]) {
        for (let minute = 0; minute < 1440; minute += 7) {
          const view = npcAutonomyAt(id, { day: 4, minuteOfDay: minute, runSeed });
          expect(view.x).toBeGreaterThanOrEqual(NPC_MARGIN);
          expect(view.x).toBeLessThanOrEqual(FLOOR_WIDTH - NPC_MARGIN);
          expect(Number.isFinite(view.x)).toBe(true);
        }
      }
    }
  });

  it('npcAutonomyAt：同 (npcId, day, minute, runSeed) 完全可复现；换种子位置变', () => {
    const args = { day: 2, minuteOfDay: 500, runSeed: 7 };
    expect(npcAutonomyAt('alin', args)).toEqual(npcAutonomyAt('alin', args));
    const a: number[] = [];
    const b: number[] = [];
    for (let minute = 0; minute < 1440; minute += 7) {
      a.push(npcAutonomyAt('alin', { day: 2, minuteOfDay: minute, runSeed: 7 }).x);
      b.push(npcAutonomyAt('alin', { day: 2, minuteOfDay: minute, runSeed: 8 }).x);
    }
    expect(a).not.toEqual(b); // 种子参与闲逛，不同 seed 轨迹不同
  });

  it('npcAutonomyAt：库存见底时目标变成「寻找某物」', () => {
    const zhou = npc('xiaozhou');
    expect(scarcityOf(zhou, () => 0)).toBe('bread'); // 第一个见底的需求
    expect(scarcityOf(zhou, () => 5)).toBeNull();
    const hungry = npcAutonomyFor(zhou, { day: 1, minuteOfDay: 500, runSeed: 1, stock: () => 0 });
    expect(hungry.goal).toBe(`寻找${getItem('bread').displayName}`);
    const fine = npcAutonomyFor(zhou, { day: 1, minuteOfDay: 500, runSeed: 1, stock: () => 5 });
    expect(fine.goal).toBe('看看天色，估算今天去哪层 scavenge'); // 500 分钟落在「张望天气」格
  });
});

// ── 5. 记忆影响关系（信誉的数据来源） ───────────────────────────────────────

describe('记忆 → 关系 → 信誉的因果链', () => {
  it('连续获赠把关系推到 trusted，交易台词随之变（确定性）', () => {
    const s = createNewGame(41);
    seedNpcState(s, 'alin');
    let state = loadNpcState(s, 'alin')!;
    for (let i = 0; i < 3; i++) {
      state = recordMemory(state, { day: 1, minute: 600, kind: 'gift', actor: 'player', summary: '获赠木头×1' });
    }
    saveNpcState(s, 'alin', state);
    expect(state.relationship.player).toBeCloseTo(43.2, 5); // 3 × 14.4
    expect(reputationOf(loadNpcState(s, 'alin')!)).toBe('trusted');
    expect(attitudeLine(npc('alin'), reputationOf(loadNpcState(s, 'alin')!))).toBe('老主顾，维修件我给你留着。');
  });

  it('攻击记忆把关系打进 hostile，且敌对 archetype 双倍记仇', () => {
    const hostile = recordMemory(createNpcState('hostile'), {
      day: 1, minute: 600, kind: 'attack', actor: 'player', summary: '袭击了流浪者',
    });
    const ally = recordMemory(createNpcState('ally'), {
      day: 1, minute: 600, kind: 'attack', actor: 'player', summary: '袭击了阿林',
    });
    // -0.9×20×(0.5+loyalty)：hostile loyalty 0.2 → -12.6，再双倍 → -25.2
    expect(hostile.relationship.player).toBeCloseTo(-25.2, 5);
    expect(ally.relationship.player).toBeCloseTo(-21.6, 5); // ally loyalty 0.7 → -0.9×20×1.2
  });

  it('两个居民的报价表都接得住真实库存（数据完整性）', () => {
    for (const def of NPCS) {
      const inv = defaultNpcInventory(def, 1);
      for (const offer of def.offers) {
        expect(inv.entries.some((e) => e.itemId === offer.give.itemId)).toBe(true);
      }
      // 日程覆盖全天且首尾相接
      const slots = def.schedule!;
      expect(slots[slots.length - 1].to).toBe(slots[0].from);
    }
  });
});
