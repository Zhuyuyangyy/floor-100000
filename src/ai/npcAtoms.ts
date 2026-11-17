// NPC 三原子（TWOM 对齐，docs/plans/TWOM_ALIGNMENT.md §7）。
//
// 反编译符号表（docs/reference/TWOM_MECHANICS.md §4）里 625 个 BT 任务类
// 撑起全部表现的只有三个原子：
//   BTTaskKosovoEntityGoTo / Speak / PlayAnimation
// 外加两类装饰器：
//   Sensor*Decorator      —— AI 不直接问世界状态，经 sensor 抽象层感知
//   Forced*Decorator      —— 玩家指令 > AI 自主（强制打断）
// TWOM 文档原话：「不必上完整行为树。先抽 GoTo / Speak / PlayAnimation
// 三个原子，让 NPC 的巡逻、走向玩家、说话都走这三条。」
//
// 本模块就是这三条：
// - 位置不再是场景里隐式的 setPosition(npcAutonomyAt(...))，而是显式的
//   goTo 原子（数据源仍是 npcSchedule 的同一个纯函数，不重算、不改写）；
// - 说话接 npcEconomy.attitudeLine（信誉分层确定性台词，记忆真的影响
//   嘴里说的话），传感器门控：玩家凑到跟前才说；
// - 动画 clip 与 render/walkcycle.ts 的 anim key 逐字同构（测试钉死），
//   映射关系见 npcClipKey 上方的表。
//
// 铁律（与 npcSchedule 一致）：
// - 纯函数、禁 Math.random：同 (npc, state) → 同原子序列，与帧率无关；
// - 不改 GameScene、不改 schema：forcedTarget 是调用参数，不进 GameState；
// - 升级不是重写：npcAutonomyAt / attitudeLine / npcSchedule 全部只读复用。

import { FLOOR_WIDTH, INTERACT_DISTANCE } from '../core/constants';
import type { GameState, ItemId } from '../core/gameTypes';
import type { NpcDef } from '../data/npcs';
import { npcFloor } from '../data/npcs';
import { attitudeLine, reputationOf } from './npcEconomy';
import { syncNpcInventory, stockOf } from './npcInventory';
import { NPC_MARGIN, NPC_WALK_SPEED, npcAutonomyFor, scarcityOf } from './npcSchedule';
import type { ReputationTier } from './types';
import { planNightWanderer, planWandererVendetta } from '../systems/NpcAutonomy';
import { isNight } from '../systems/SurvivalSystem';

// ── 三原子（契约 §7，schema 定死，不得单方面改）────────────────────────────

export type NpcAtom =
  | { kind: 'goTo'; x: number; speed?: number }
  | { kind: 'speak'; text: string }
  | { kind: 'playAnimation'; clip: string };

// ── Sensor：AI 不直接读世界，经 sense() 拿感知结果 ─────────────────────────
//
// TWOM 的 Sensor*Decorator 是一层抽象：行为树不问「玩家坐标是多少」，
// 只问「玩家在不在感知范围内」。对应到本模块：npcAtomsFor 与场景判定
// 都不该直接读 state.player.x / npc.x，而是先过 sense() 拿一份感知快照。
//
// 既有代码里该改走 sense 的直读点（报告详见 TWOM_ALIGNMENT.md AG-28 节）：
// - GameScene.nearestNpc（GameScene.ts:4175）与 hasInteractableNear
//   （:4901）已经用自主视图的 x（AG-11 修的运行时坐标），差的就是统一
//   经 sense() 出「同层 / 距离 / 是否在交互范围」三个结论；
// - npcSchedule.scarcityOf 的 stock 回调目前由调用方各自接库存
//   （GameScene.npcView 接 syncNpcInventory），sense() 把这条通路收成
//   感知面的一部分，调用方不再需要知道库存从哪来。

export interface NpcPlayerSense {
  /** 玩家所在楼层 */
  floor: number;
  /** 玩家 x（像素） */
  x: number;
  /** 玩家与 NPC 是否同层 */
  sameFloor: boolean;
  /** 同层时的水平距离（像素）；跨层为 Infinity（看不见就不谈距离） */
  distance: number;
  /** 是否在交互距离内（同层且 distance <= INTERACT_DISTANCE） */
  withinInteract: boolean;
}

export interface NpcSense {
  npcId: string;
  /** NPC 所在楼层（data/npcs.ts 的 floor，缺省 2） */
  floor: number;
  /** NPC 当前 x（npcAutonomyFor 的运行时坐标，不是 npc.x 静态锚点） */
  x: number;
  player: NpcPlayerSense;
  time: {
    day: number;
    minuteOfDay: number;
    /** 夜间标志（SurvivalSystem.isNight：20:00 起） */
    night: boolean;
  };
  self: {
    /** 当前日程标签（如「睡觉」） */
    slotLabel: string;
    /** 当前目标（库存稀缺时为「寻找某物」） */
    goal: string;
    /** 是否正在走向锚点（false = 已到达，在闲逛/停留） */
    moving: boolean;
    /** 库存见底的需求物品；null = 无短缺 */
    scarcity: ItemId | null;
    /** 对玩家的信誉分级（无持久状态时 neutral） */
    reputation: ReputationTier;
  };
}

/**
 * 感知快照。纯函数：同 (npc, state) → 同结果。
 *
 * 库存读取走 syncNpcInventory 的既有惰性结算通路（与 GameScene.npcView
 * 一致）：同日重复调用是恒等操作，不破坏可复现性；跨天首次读取会补
 * 消耗+补货，这是 AG-13 既有的「读取即结算」设计，不是本模块新增的副作用。
 *
 * AG-104：opts.floorWidth 透传给 npcAutonomyFor（缺省 FLOOR_WIDTH 不变），
 * 宽楼上 sense.x 的钳制上限才跟着本层宽度走。
 */
export function sense(npc: NpcDef, state: GameState, opts: { floorWidth?: number } = {}): NpcSense {
  const { npcState, inventory } = syncNpcInventory(state, npc);
  const view = npcAutonomyFor(npc, {
    day: state.day,
    minuteOfDay: state.gameMinuteOfDay,
    runSeed: state.runSeed,
    stock: (itemId) => stockOf(inventory, itemId),
    floorWidth: opts.floorWidth,
  });
  const sameFloor = state.currentFloor === npcFloor(npc);
  const distance = sameFloor ? Math.abs(view.x - state.player.x) : Infinity;
  return {
    npcId: npc.id,
    floor: npcFloor(npc),
    x: view.x,
    player: {
      floor: state.currentFloor,
      x: state.player.x,
      sameFloor,
      distance,
      withinInteract: sameFloor && distance <= INTERACT_DISTANCE,
    },
    time: {
      day: state.day,
      minuteOfDay: state.gameMinuteOfDay,
      night: isNight(state.gameMinuteOfDay),
    },
    self: {
      slotLabel: view.slotLabel,
      goal: view.goal,
      moving: view.moving,
      scarcity: scarcityOf(npc, (itemId) => stockOf(inventory, itemId)),
      reputation: reputationOf(npcState),
    },
  };
}

// ── playAnimation 的 clip 映射 ─────────────────────────────────────────────
//
// 现有 char-*-sheet.png 每张 20 帧，walkcycle.ts 的段位：
//   walk(6) + idle(2) + attack(3) + hurt(2) + search(2) + die(3) + pickup(2)
// anim key 由 walkcycle.ts 的 walkAnimKey/idleAnimKey/… 生成，格式为
// `<动作>-<who>`。本模块不 import render 层（ai 是纯逻辑层，不依赖呈现），
// 用同构命名给出 clip，并由 npcAtoms.test.ts 逐字钉住与 walkcycle 的
// 实际输出一致——映射漂移会让测试红，而不是让场景里播错动画。
//
// 原子只产出 walk / idle 两个 clip（日程移动 ↔ 停留闲逛）；一次性动作
// （attack/hurt/search/die/pickup）归战斗与搜刮接线，不属日程自主范畴：
//   walk-{who}    行走（日程锚点间移动 / 执行 forcedTarget）
//   idle-{who}    待机（已到达锚点，闲逛或停留）
//   attack-{who}  攻击   ┐
//   hurt-{who}    受击   ├ 一次性动作，由场景侧既有接线播放，
//   search-{who}  搜刮   │ 本模块不产生（TWOM 里它们也不是
//   die-{who}     倒地   │ 巡逻/说话级别的原子）
//   pickup-{who}  拾取   ┘

/** NPC 的 CharacterKey（与 GameScene.drawNpcs 的 who 同规则）。 */
export function npcCharacterKey(npc: NpcDef): string {
  if (npc.id === 'alin') return 'npc_alin';
  if (npc.id === 'xiaozhou') return 'npc_xiaozhou';
  return `npc_${npc.id}`;
}

/** 移动/停留 → walk-/idle- clip。命名与 walkcycle.ts 的 anim key 同构。 */
export function npcClipKey(who: string, moving: boolean): string {
  return `${moving ? 'walk' : 'idle'}-${who}`;
}

// ── Forced：玩家指令 > AI 自主 ─────────────────────────────────────────────
//
// TWOM 的 Forced*Decorator（BTTaskKosovoDwellerIsForcedGoToDestination-
// PresentDecorator / IsForcedTargetPresentDecorator）是强制打断装饰器：
// 玩家一旦下令，自主计划整棵子树作废。本模块的对应物是 forcedTarget——
// 一个调用参数，不是 GameState 字段（不动 schema）：
//   forcedTarget 非空 → 只回强制执行相关原子，自主原子（含 speak）全丢；
//   forcedTarget 为空 → 自主原子照常。
//
// 「统一」的含义：场景里凡是要回答「这个 NPC 现在在哪、听谁的」，
// 都走 npcAtomsFor / sense 这条纯函数链，不再有第二套读数。AG-11/AG-24
// 修过的「点击走路交互判定用运行时坐标而非 npc.spec 静态锚点」
// （GameScene.ts:4896-4901 的注释记录了实证：阿林站在 241 而数据说 480）
// 是同一原则的既有落地——runtime 坐标 > 静态数据；forcedTarget 把这条
// 原则从「位置」延伸到「指令」：玩家指令 > AI 自主 > 静态日程。

export interface NpcAtomsOptions {
  /** 玩家指令目标 x（像素）。null/undefined = 无指令。越界值按楼层安全范围钳制。 */
  forcedTarget?: number | null;
  /**
   * AG-104：本层实际宽度（floorWidthFor：宽楼 1600-2880px+），缺省
   * FLOOR_WIDTH(1280)。goTo/forcedTarget 的钳制上限原来是写死的 1280-48——
   * 宽楼上玩家点右半下令，NPC 也被截在 1232。由调用侧传本层宽度。
   */
  floorWidth?: number;
}

function clampX(x: number, width: number): number {
  return Math.min(width - NPC_MARGIN, Math.max(NPC_MARGIN, x));
}

/**
 * 这一段时间该 NPC 干什么（三原子序列）。纯函数：同 (npc, state, opts)
 * → 同序列，禁 Math.random。
 *
 * 原子顺序固定：goTo → playAnimation → speak（消费方按序应用即可）。
 * - goTo：x 来自 npcSchedule 的运行时坐标（显式「去某地」，不再是场景里
 *   隐式的位置计算）；speed 是日程步行节奏（像素/游戏分钟），信息性字段。
 * - playAnimation：walk-/idle- clip，与移动状态联动。
 * - speak：仅当玩家在交互距离内（Sensor 门控），文本取
 *   npcEconomy.attitudeLine——信誉分层确定性台词，关系/记忆真的改变
 *   NPC 嘴里的话。每帧都会发射，场景侧按「进入范围」去重（见实现说明）。
 */
export function npcAtomsFor(npc: NpcDef, state: GameState, opts: NpcAtomsOptions = {}): NpcAtom[] {
  // AG-104：楼层宽从调用侧拿（缺省 FLOOR_WIDTH 保持存量行为），sense 与
  // forcedTarget 的钳制同用一个宽度。
  const width = opts.floorWidth ?? FLOOR_WIDTH;
  const s = sense(npc, state, { floorWidth: width });

  // Forced 打断：玩家指令期间只有「去指令点」+ 行走 clip，不闲聊。
  const forced = opts.forcedTarget;
  if (typeof forced === 'number' && Number.isFinite(forced)) {
    return [
      { kind: 'goTo', x: clampX(forced, width), speed: NPC_WALK_SPEED },
      { kind: 'playAnimation', clip: npcClipKey(npcCharacterKey(npc), true) },
    ];
  }

  const atoms: NpcAtom[] = [
    { kind: 'goTo', x: s.x, speed: NPC_WALK_SPEED },
    { kind: 'playAnimation', clip: npcClipKey(npcCharacterKey(npc), s.self.moving) },
  ];
  if (s.player.withinInteract) {
    atoms.push({ kind: 'speak', text: attitudeLine(npc, s.self.reputation) });
  }
  return atoms;
}

// ── 流浪者（第二个「实体」：证明三原子不是 NPC 专属）──────────────────────
//
// TWOM 的规律：行为树是可挂在任意实体上的组件。流浪者不是 NPCS 表里的
// 居民（没有 NpcDef），但它的「登场」同样可以表述成原子：goTo 到确定性
// 出生点 + 走 clip。帧级游荡/扑击（stepWandererRoam / wandererAI 状态机）
// 不在此列——那需要 dt 与帧间状态，属于场景状态机，不是每帧可重算的
// 纯计划。优先权与场景现状一致：寻仇计划 present 时无视夜间事件抽层
// （systems/NpcAutonomy.ts 的计划优先级注释）。

/** 流浪者这一帧的登场原子；不在场时返回空序列。 */
export function wandererAtomsFor(state: GameState): NpcAtom[] {
  const vendetta = planWandererVendetta(state);
  const plan = vendetta.present ? vendetta : planNightWanderer(state);
  if (!plan.present) return [];
  // speed 不填：流浪者的 70 是像素/真实秒（WANDERER_ROAM_SPEED），
  // 与居民的像素/游戏分钟不同族，混在一个字段里只会误导消费方。
  return [
    { kind: 'goTo', x: plan.spawnX },
    { kind: 'playAnimation', clip: npcClipKey('wanderer', true) },
  ];
}
