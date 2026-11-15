// 触发器清单（接口契约 docs/plans/TWOM_ALIGNMENT.md §6；需求来源
// docs/reference/TWOM_MECHANICS.md §4「TRIGGER 和 FLAG 立刻可抄」）。
//
// 这个文件解散三团散落的布尔判断——每团曾经在每个读点各自 re-derive：
//
//   worldEvents.activeEvent  「有没有事件」「是不是停电」由 GameScene
//                            （停电熄灯 :3691、漏水特效 :3718、一事件占位
//                            守卫 :5855、流浪者意图 :6241/:6274）、LootSystem
//                            :31、CraftingSystem :139、NpcAutonomy :236 各自
//                            读同一个字段。→ ev:active / ev:<type>
//   dailyGoal                 「今天目标达标了吗」由 GameScene 的 HUD
//                            （:3383）和结算路径（:6019）各算一次，progress.ts
//                            却又读存量 done 字段。→ goal:met
//   combat                    「战斗是否在进行」是 state.combat 的存在性，
//                            GameScene 有四个读点（:1761/:1912/:1990/:4736）。
//                            → combat:active
//
// 加上三个从现有生存逻辑里长出来的真判断：夜间滞留敌意楼层、背包满过、
// 饥渴归零；以及两个按数据表自动展开的家族（阶层抵达、NPC 熟客）。
//
// 语义（重要）：旗是「本 run 曾经如此」的一次性事实，不是「此刻如此」的
// 实时查询——evaluateTriggers 只置不清。每帧都要用的判断（熄灯、流浪者
// 在场、HUD 的 ✓）继续直读 state；旗服务的是「第一次发生时该有一次性
// 反应」（日记、flash、任务/对话条件）的那类查询。
//
// 导入本模块即完成启动注册（import 的副作用）；求值走 WorldFlags 的
// evaluateTriggers（此处 re-export，场景只 import 这一个模块即可）。
// 全部 when 为纯判定，禁 Math.random——同 state 必然同结果。

import { environmentFor } from '../core/constants';
import type { GameState } from '../core/gameTypes';
import { PLAYABLE_SEGMENTS } from '../core/segments';
import { NPCS } from '../data/npcs';
import { isBagFull } from './InventorySystem';
import { isDailyGoalDone } from './dailyGoals';
import { loadNpcState } from './NpcMemory';
import { isNight } from './SurvivalSystem';
import { evaluateTriggers, flagKey, registerTrigger } from './WorldFlags';

export { evaluateTriggers };

// ── 世界事件：收敛 worldEvents.activeEvent 的散落读点 ──────────────────────
// 存在性与类型判断原来有 8+ 个读点（见文件头）。现在一次求值全部置位，
// 新逻辑（日记、一次性反应）查旗即可。事件跨天会被清掉
// （SurvivalSystem 的 fresh roll），旗不会——那正是「第一次停电」
// 这类一次性反应需要的形状。

/** 本 run 经历过任一世界事件（存在性判断的收敛点）。 */
registerTrigger({
  id: 'ev-active',
  when: (s) => s.worldEvents.activeEvent !== null,
  sets: flagKey.event('active'),
});

registerTrigger({
  id: 'ev-blackout',
  when: (s) => s.worldEvents.activeEvent?.type === 'blackout',
  sets: flagKey.event('blackout'),
});

registerTrigger({
  id: 'ev-wanderer',
  when: (s) => s.worldEvents.activeEvent?.type === 'wanderer',
  sets: flagKey.event('wanderer'),
});

registerTrigger({
  id: 'ev-leak',
  when: (s) => s.worldEvents.activeEvent?.type === 'leak',
  sets: flagKey.event('leak'),
});

// ── 夜间暴露：夜间且身在 hostile 楼层 ─────────────────────────────────────
// 解散的判断：「玩家此刻危不危险」曾经由夜事件 roll 的目标楼层表
// （EventSystem 的 EVENT_FLOORS = 除宿舍外全部可玩层）、dwell 压力的
// isDwellExempt、NpcAutonomy 的撤退步进各算各的。三处的共同底稿就是
// 这里：夜间（isNight）× 楼层敌意（environmentFor(floor).hostile）。
// 旗记录「第一次在夜间被留在敌意楼层」——TWOM 的 LateFromScavenge 式
// 日记条目要的正是这个边沿。

registerTrigger({
  id: 'st-night-exposed',
  when: (s) => isNight(s.gameMinuteOfDay) && environmentFor(s.currentFloor).hostile,
  sets: flagKey.state('night-exposed'),
});

// ── 背包溢出 ───────────────────────────────────────────────────────────────
// 解散的判断：「背包满了吗」原来在每个会往里放东西的地方各自问——
// GameScene 的常驻预警（refreshBagFullWarning）、搜刮溢出（LootSystem）、
// 战斗掉落（GameScene 战斗面板的「背包已满」）、商人拒售（shop.ts）。
// 共同底稿是 isBagFull（InventorySystem）。旗记录「背包满过一次」，
// 给 HUD 提示与搜刮建议做一次性播报用。
// （团队示例里的「且在地上有物资」那半句没有落地：地面物资在场景的
// floorView 里，不在 GameState，触发器无法纯求值。）

registerTrigger({
  id: 'st-bag-overflowing',
  when: (s) => isBagFull(s.player.inventory),
  sets: flagKey.state('bag-overflowing'),
});

// ── 每日目标达标 ───────────────────────────────────────────────────────────
// 解散的判断：「今天目标达标了吗」原来由 GameScene HUD（:3383）与结算
// 路径（:6019）各自调 isDailyGoalDone，progress.ts 却又读存量 done。
// 旗是达标的里程碑查询；「奖励只发一次」早已走
// once:goal-paid:<day>（dailyGoals.grantDailyGoalReward），两个语义
// 至此彻底分开：goal:met 答「达标了吗」，goal-paid 答「结算了吗」。

registerTrigger({
  id: 'goal-met',
  when: (s) => isDailyGoalDone(s),
  sets: flagKey.goal('met'),
});

// ── 战斗进行态 ─────────────────────────────────────────────────────────────
// 解散的判断：「战斗是否在进行」是 state.combat 的存在性，GameScene 有
// 四个读点（面板 :1761、回合结算 :1912、战果 :1990、商店守卫 :4736）。
// 旗记录「本 run 打过一场」——成就/日记/「第一次战斗」类的一次性反应
// 查它；每帧的在场判定继续直读 state.combat（那是实时状态）。

registerTrigger({
  id: 'combat-active',
  when: (s) => s.combat !== undefined,
  sets: flagKey.combat('active'),
});

// ── 饥渴临界 ───────────────────────────────────────────────────────────────
// 解散的判断：「渴/饿到临界了吗」原来在 SurvivalSystem 出现三次——
// applyDecay 的掉血闸门（hunger<=0 || thirst<=0）、applyRestDecay 同一
// 道闸门、deathCause 的死因归类。旗记录「曾经因脱水/饥饿掉过血」，
// 让死因统计与日记不必再各写一遍 `thirst <= 0`。

registerTrigger({
  id: 'stat-thirst-critical',
  when: (s) => s.player.thirst <= 0,
  sets: flagKey.stat('thirst-critical'),
});

registerTrigger({
  id: 'stat-hunger-critical',
  when: (s) => s.player.hunger <= 0,
  sets: flagKey.stat('hunger-critical'),
});

// ── 阶层抵达（按 PLAYABLE_SEGMENTS 自动展开）─────────────────────────────
// 解散的判断：「到过第 N 层没有」原来由 records.deepestFloor / meta
// bestDepth 的数值比较在各读者各自回答——shop.ts 的货带按 floor band
// 切、GameScene 的电梯/穿越文案按 segmentOf 问、progress 的深度记录按
// currentFloor 记。段 id 取自 segments.ts，将来加新段自动获得旗，
// 不需要改这里。第 1 段跳过：出生即在，没有「第一次抵达」。

for (const seg of PLAYABLE_SEGMENTS) {
  if (seg.id === 1) continue;
  registerTrigger({
    id: `tier-${seg.id}-arrived`,
    when: (s) => s.currentFloor >= seg.from,
    sets: flagKey.tier(seg.id),
  });
}

// ── NPC 熟客（按 data/npcs.ts 自动展开）────────────────────────────────────
// 解散的判断：「这是不是老主顾」原来只有关系值一个 proxy——
// npcEconomy 的 reputationOf 从 relationship 推信誉档，台词/价格都挂在
// 那个数值上，而「换过几次手」这个更直接的事实散落在记忆数组里没人问。
// 旗把「与同一 NPC 交易满 3 次」变成一等查询（dialogue/quest 条件）。
// 纯读档：trade 记忆由 npcEconomy.executeBarter 成功后写入，无新字段。

/** 与某 NPC 成功换过几次手（trade 记忆计数；坏档按 0 计）。 */
function tradesWithPlayer(s: GameState, npcId: string): number {
  const npc = loadNpcState(s, npcId);
  if (!npc) return 0;
  return npc.memory.filter((m) => m.kind === 'trade' && m.actor === 'player').length;
}

/** 交易满这么多次就算熟客。 */
const REGULAR_TRADE_COUNT = 3;

for (const npc of NPCS) {
  registerTrigger({
    id: `npc-${npc.id}-regular`,
    when: (s) => tradesWithPlayer(s, npc.id) >= REGULAR_TRADE_COUNT,
    sets: flagKey.npc(npc.id, 'regular'),
  });
}
