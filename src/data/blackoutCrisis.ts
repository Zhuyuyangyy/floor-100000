// 停电危机：六个人第一次被同一件事逼到一起。
//
// 为什么单独开一个数据模块，而不是把常量塞进场景：
// 场景里只有状态机与落库，所有「谁要什么、谁能给什么、代价多少」都必须
// 能被策划改数值、被平衡测试单独读，而不必穿过一段状态机代码。
//
// 这一章的地理前提必须写清楚：停电危机**只在 2→3 层维修门打开后**才触发。
// 原因是硬的——保险丝与电线只稳定出现在第 4 层电箱，而阿珍在 5 层食堂。
// 门没开时玩家到不了这两处，任何「修主线要 4 层零件」的设计都会立刻软锁。
// 所以触发条件不是「第几天」，而是「玩家真的能走遍塔楼了」。

import type { GameState, InventoryStack, ItemId } from '../core/gameTypes';
import type { ContractIntent } from '../ai/actionContract';
import type { NpcId } from './npcs';
import { flagCount, flagKey, setFlag } from '../systems/WorldFlags';

/** 危机标识。所有 flag 都挂在它下面，避免和别的剧情线串号。 */
export const BLACKOUT_CRISIS_ID = 'blackout-tower-main';

/**
 * 主线配电箱的「门」标识。
 *
 * 它**不是**通行门——楼层切换只认 data/floorGates.ts 里那一道，这里借
 * competitionRules 的 repair_gate 语义，把「塔楼主线」当成一个可修理的目标，
 * 因为 A1 的动作集里没有 repair_power，自创一个新动作会破坏契约统一。
 * 与 ALIN_REPAIR_GATE_ID 必须不同：那道门是前置条件，已经开了。
 */
export const BLACKOUT_POWER_GATE_ID = 'tower-main-power';

/**
 * 停电危机里会向玩家发起委托的三个人。
 *
 * 只有这三位有「承诺」这回事，所以承诺也只有这三份。顺序不影响任何逻辑，
 * 只是为了让「按人逐个判定」的地方读起来像一句名单。
 */
export type BlackoutPromiseNpcId = 'alin' | 'azhen' | 'xiaozhou';

/**
 * 承诺按人分键。
 *
 * 为什么不能只用一把全局 flag：接单是「我答应**这个人**」，不是「我答应过停电
 * 这件事」。共用一把钥匙有两个后果——阿珍问过一次就把小周的接单顶掉（反之
 * 亦然），两个人互相取消对方的幂等；更要命的是连点同一个人可以重复记账，每
 * 记一遍信任 +11，等于开了一个刷信任的入口。分键之后，谁的承诺落在谁自己的
 * 钥匙上，谁失信也只记在谁头上。
 */
export const BLACKOUT_PROMISE_DAY: Readonly<Record<BlackoutPromiseNpcId, string>> = {
  alin: flagKey.story(`${BLACKOUT_CRISIS_ID}:promise-day:alin`),
  azhen: flagKey.story(`${BLACKOUT_CRISIS_ID}:promise-day:azhen`),
  xiaozhou: flagKey.story(`${BLACKOUT_CRISIS_ID}:promise-day:xiaozhou`),
};

/**
 * 失信也按人分键。
 *
 * 理由同上，而且后果必须分人：只有**阿林**失信才会让他变成 guarded（谨慎态
 * 会抬高维修门槛、压低修好奖励）；阿珍或小周失信是他俩自己的账，不该让阿林
 * 也背上「这人说话不算数」。
 */
export const BLACKOUT_PROMISE_BROKEN: Readonly<Record<BlackoutPromiseNpcId, string>> = {
  alin: flagKey.story(`${BLACKOUT_CRISIS_ID}:promise-broken:alin`),
  azhen: flagKey.story(`${BLACKOUT_CRISIS_ID}:promise-broken:azhen`),
  xiaozhou: flagKey.story(`${BLACKOUT_CRISIS_ID}:promise-broken:xiaozhou`),
};

/**
 * 危机的全部持久标记。
 *
 * 只用 flag 存「事实」，不用新字段：GameState 是全局契约，加字段要动 A0 的
 * 存档迁移，而这里没有一条信息是 flag 装不下的。
 */
export const BLACKOUT_FLAG = {
  /** 1 调查中 / 2 缺料 / 3 已修复 / 4 已失败；只增不减 */
  stage: flagKey.story(`${BLACKOUT_CRISIS_ID}:stage`),
  /** 第几天开始停电，用来算死线；缺失按当天算 */
  startedDay: flagKey.story(`${BLACKOUT_CRISIS_ID}:started-day`),
  /** 主线恢复供电；渲染层可据此点亮第 4 层，本模块不碰渲染 */
  power: flagKey.story(`${BLACKOUT_CRISIS_ID}:power`),
  /** 腐败掉的面包数量；0 表示没坏 */
  foodSpoiled: flagKey.story(`${BLACKOUT_CRISIS_ID}:food-spoiled`),
  /** 阿珍的灶已经拿到净水 */
  azhenWater: flagKey.story(`${BLACKOUT_CRISIS_ID}:azhen-water`),
  /** 阿林在谨慎状态下要求「先核料」；值是该动作发生的天数 */
  verifiedDay: flagKey.story(`${BLACKOUT_CRISIS_ID}:verified-day`),
  /**
   * 玩家接单的承诺发生在哪一天；缺失表示没接。
   *
   * ── 迁移口径（这一版把「全局单键」改成「按人分键」） ────────────────────
   * - 这把钥匙现在指向**阿林**的分人键 `promise-day:alin`；阿珍、小周各有自己
   *   的（见 promiseDayAzhen / promiseDayXiaozhou）。
   * - 旧存档里那把单键 `promise-day` 只有一个含义：阿林的承诺日。它被保留成
   *   `promiseDayLegacy` 并**只读**——读侧在新的阿林键缺失时回退查它，所以
   *   老存档既不丢进度，也不会把阿林已有的承诺误判成「没承诺」；写侧只写新键。
   */
  promiseDay: BLACKOUT_PROMISE_DAY.alin,
  /** 阿珍的承诺日 */
  promiseDayAzhen: BLACKOUT_PROMISE_DAY.azhen,
  /** 小周的承诺日 */
  promiseDayXiaozhou: BLACKOUT_PROMISE_DAY.xiaozhou,
  /** 旧存档的单键：语义 = 阿林的承诺日；只读兼容，不再写 */
  promiseDayLegacy: flagKey.story(`${BLACKOUT_CRISIS_ID}:promise-day`),
  /**
   * 承诺已过期未履约（1）；由 sync 写入，之后不再重复写。
   *
   * 同样是阿林的分人键（只有他失信会变 guarded）；旧存档的单键见
   * `promiseBrokenLegacy`，读侧回退、写侧只写新键。
   */
  promiseBroken: BLACKOUT_PROMISE_BROKEN.alin,
  /** 阿珍失信 */
  promiseBrokenAzhen: BLACKOUT_PROMISE_BROKEN.azhen,
  /** 小周失信 */
  promiseBrokenXiaozhou: BLACKOUT_PROMISE_BROKEN.xiaozhou,
  /** 旧存档的单键：语义 = 阿林失信；只读兼容，不再写 */
  promiseBrokenLegacy: flagKey.story(`${BLACKOUT_CRISIS_ID}:promise-broken`),
  /** 危机库存只铺一次，防止重复 sync 把货架刷回来 */
  stocked: flagKey.story(`${BLACKOUT_CRISIS_ID}:stocked`),
} as const;

/** 状态机的五个状态。字符串比数字好读，映射在下面两张表里。 */
export type BlackoutStage =
  | 'initial'
  | 'investigating'
  | 'materials_needed'
  | 'resolved_repair'
  | 'resolved_fail';

/** 落进 flag 的序号。resolved_* 之后的任何动作都必须被拒绝。 */
export const BLACKOUT_STAGE_INDEX: Readonly<Record<BlackoutStage, number>> = {
  initial: 0,
  investigating: 1,
  materials_needed: 2,
  resolved_repair: 3,
  resolved_fail: 4,
};

/** 只增不减：任何退步都被忽略，这就是「事件只能推进一次」的底层保证。 */
export function advanceBlackoutStage(state: GameState, next: BlackoutStage): boolean {
  const current = BLACKOUT_STAGE_INDEX[blackoutStageOf(state)];
  const target = BLACKOUT_STAGE_INDEX[next];
  if (target <= current) return false;
  setFlag(state, BLACKOUT_FLAG.stage, target);
  return true;
}

/** 从 flag 反推状态；旧存档没有 flag 就是 initial。 */
export function blackoutStageOf(state: GameState): BlackoutStage {
  const index = flagCount(state, BLACKOUT_FLAG.stage);
  if (index >= BLACKOUT_STAGE_INDEX.resolved_fail) return 'resolved_fail';
  if (index >= BLACKOUT_STAGE_INDEX.resolved_repair) return 'resolved_repair';
  if (index === BLACKOUT_STAGE_INDEX.materials_needed) return 'materials_needed';
  if (index === BLACKOUT_STAGE_INDEX.investigating) return 'investigating';
  return 'initial';
}

/** 供电是否已恢复。给渲染/光照用的只读查询，别在别处直接读 flag。 */
export function isBlackoutPowerRestored(state: GameState): boolean {
  return flagCount(state, BLACKOUT_FLAG.power) > 0;
}

export function isBlackoutResolved(state: GameState): boolean {
  const stage = blackoutStageOf(state);
  return stage === 'resolved_repair' || stage === 'resolved_fail';
}

// ── 三方利益 ────────────────────────────────────────────────────────────────

/** 一条可转让的数量要求。itemId 必须是 data/items.ts 里真实存在的物品。 */
export interface BlackoutRequest {
  readonly itemId: ItemId;
  readonly quantity: number;
}

/**
 * 一位居民在这次危机里的处境。
 *
 * `request` 是这位居民**会向玩家发起**的委托（request_help 语义）：
 * 带 itemId + quantity，所以玩家不需要猜「他还缺什么」。
 */
export interface BlackoutPartyDef {
  readonly npcId: NpcId;
  /** 他自己的需求，用于提示与记忆摘要 */
  readonly need: string;
  /** 他开口要的东西；小周要的是「交易的对价」，所以也是 request */
  readonly request: readonly BlackoutRequest[];
  /** 事情成了他给什么（纯描述；真正的结算在场景里） */
  readonly payoff: string;
}

export const BLACKOUT_PARTIES: Readonly<Record<'alin' | 'xiaozhou' | 'azhen', BlackoutPartyDef>> = {
  // 阿林：想修主线，但手上没有保险丝和电线。他是唯一能动手的人，
  // 所以他提出的委托必然是「把零件拿来给我」，而不是「你替我修」。
  alin: {
    npcId: 'alin',
    need: '缺保险丝和电线，主线接不回去',
    request: [
      { itemId: 'fuse', quantity: 1 },
      { itemId: 'wire', quantity: 1 },
    ],
    payoff: '恢复整栋楼的供电',
  },
  // 小周：不谈感情，只谈差价。停电对他是行情，他囤的正是大家缺的。
  xiaozhou: {
    npcId: 'xiaozhou',
    need: '趁停电把囤的零件换成口粮和净水',
    request: [{ itemId: 'ration_pack', quantity: 1 }],
    payoff: '卖给你保险丝或电线',
  },
  // 阿珍：停电等于灶冷、存货坏。她要的不是零件，是水——有水准能多撑两天。
  azhen: {
    npcId: 'azhen',
    need: '断电了，灶上的存货撑不住，先要净水',
    request: [{ itemId: 'clean_water', quantity: 2 }],
    payoff: '保住食堂的存货，分你口粮',
  },
};

/** 阿林这次维修真正要的东西。两条都只稳定出现在第 4 层电箱。 */
export const BLACKOUT_REPAIR_MATERIALS: readonly InventoryStack[] = Object.freeze([
  Object.freeze({ itemId: 'fuse' as const, quantity: 1 }),
  Object.freeze({ itemId: 'wire' as const, quantity: 1 }),
]);

/**
 * 小周的停电报价。
 *
 * 这就是「替代路径」：玩家万一在 4 层把零件用掉了（电线同时是台灯和净水器
 * 的配方材料），还能用口粮/净水从他手里买回来，主线不会因此永久卡死。
 * 价格刻意不同——保险丝对口粮，电线对净水——让「拿什么换」成为一次选择。
 */
export interface BlackoutOffer {
  readonly id: string;
  readonly partId: ItemId;
  readonly quantity: number;
  readonly price: BlackoutRequest;
}

export const BLACKOUT_XIAOZHOU_OFFERS: readonly BlackoutOffer[] = Object.freeze([
  Object.freeze({
    id: 'zhou-fuse',
    partId: 'fuse' as const,
    quantity: 1,
    price: Object.freeze({ itemId: 'ration_pack' as const, quantity: 1 }),
  }),
  Object.freeze({
    id: 'zhou-wire',
    partId: 'wire' as const,
    quantity: 1,
    price: Object.freeze({ itemId: 'clean_water' as const, quantity: 2 }),
  }),
]);

/** 开危机时铺进小周口袋的货；每样 1 件，买完就没了，天然防刷。 */
export const BLACKOUT_XIAOZHOU_STOCK: readonly InventoryStack[] = Object.freeze([
  Object.freeze({ itemId: 'fuse' as const, quantity: 1 }),
  Object.freeze({ itemId: 'wire' as const, quantity: 1 }),
]);

/** 阿珍灶上的存货；失败时正是它坏掉，玩家看得见损失。 */
export const BLACKOUT_AZHEN_STOCK: readonly InventoryStack[] = Object.freeze([
  Object.freeze({ itemId: 'bread' as const, quantity: 4 }),
]);

/** 阿珍要的净水（与 BLACKOUT_PARTIES.azhen.request 必须一致，测试会校验）。 */
export const BLACKOUT_AZHEN_WATER: BlackoutRequest = Object.freeze({
  itemId: 'clean_water' as const,
  quantity: 2,
});

/** 给了水，她分你两份口粮，并从自己的存货里扣。 */
export const BLACKOUT_AZHEN_REWARD: BlackoutRequest = Object.freeze({
  itemId: 'bread' as const,
  quantity: 2,
});

/** 修好之后她额外塞给你的一份谢礼（只有给过水才有）。 */
export const BLACKOUT_AZHEN_THANKS: BlackoutRequest = Object.freeze({
  itemId: 'bread' as const,
  quantity: 1,
});

/**
 * 死线：停电持续到第 N 天就再也救不回来。
 *
 * 3 天是量出来的，不是拍的：玩家要跑 2 层（阿林）、4 层（电箱）、5 层（阿珍）、
 * 必要时 3 层找货，还要睡觉，一天走不完。少于 3 天，失败结局就变成
 * 「玩家还没来得及搞懂规则就已经输了」——那不是紧张，是折磨。
 */
export const BLACKOUT_DEADLINE_DAYS = 3;

/**
 * 承诺的有效期。
 *
 * 0 表示只算当天：停电这种事等不起，第二天还没交货就是失信。
 * 这个值必须小于 DEADLINE_DAYS，否则「失信」这一分支永远和「过期失败」
 * 撞在同一天，guarded 态度就永远不会真正出现（本仓库第一版就是错的）。
 */
export const BLACKOUT_PROMISE_DAYS = 0;

/** 失败时坏掉的面包数；给过水只坏 1 份，没给水坏 3 份。 */
export const BLACKOUT_SPOIL_WITHOUT_WATER = 3;
export const BLACKOUT_SPOIL_WITH_WATER = 1;

// ── 阿林的合作意愿 ──────────────────────────────────────────────────────────

/**
 * 阿林对玩家的态度，由**已经写进存档的记忆**推导，而不是临时心情。
 *
 * cooperative：前一天玩家给过他净水 → 他主动交底（说出小周囤了什么、什么价），
 *              并且愿意先赊账动手，信任门槛降到 40。
 * guarded：他记得玩家接过单却没交货 → 不再听口头保证，必须先当面核料，
 *          信任门槛抬到 65。
 * neutral：没有共同经历，按常规 55 走。
 *
 * 这三个分支是**决策差异**（能不能修、要不要先核料），不是台词差异。
 */
export type BlackoutAlinStance = 'cooperative' | 'guarded' | 'neutral';

/** 各态度下维修所需的信任。数值放数据层，方便单独调。 */
export const BLACKOUT_TRUST_FOR_STANCE: Readonly<Record<BlackoutAlinStance, number>> = {
  cooperative: 40,
  guarded: 65,
  neutral: 55,
};

// ── 可见状态 ────────────────────────────────────────────────────────────────

/**
 * 居民在危机里的可见状态。玩家应当一眼看出「现在卡在谁身上」，
 * 而不是反复点对话试错。
 */
export type BlackoutPartyStatus =
  | 'waiting'
  | 'missing_materials'
  | 'ready'
  | 'trading'
  | 'done'
  | 'refuse';

export const BLACKOUT_STATUS_LABEL: Readonly<Record<BlackoutPartyStatus, string>> = {
  waiting: '在等消息',
  missing_materials: '缺料',
  ready: '可以动手',
  trading: '可交易',
  done: '已完成',
  refuse: '拒绝合作',
};

// ── 动作集 ──────────────────────────────────────────────────────────────────

/**
 * 本场景支持的玩家动作。
 *
 * 直接**派生**自 A1 的统一契约（ai/actionContract.ts 的 CONTRACT_INTENTS），
 * 而不是再抄一份同义枚举：抄一份的下场是两边慢慢分叉，接线时才发现
 * 「我这叫 request_help，你那叫 ask」。这里只做「取子集」，不重新定义。
 *
 * 取舍说明：
 * - `refuse` 不在这里：A1 的 refuse 是 NPC 拒绝对话的意图，而本章里 NPC 的
 *   拒绝由 BlackoutPartyStatus='refuse' 表达，玩家侧没有「拒绝」按钮——
 *   不接单就是不点 request_help。
 * - 其余六个全部保留，与契约逐字同名。
 */
export const BLACKOUT_SUPPORTED_ACTIONS = [
  'observe',
  'request_help',
  'accept_gift',
  'propose_trade',
  'repair_gate',
  'wait',
] as const satisfies readonly ContractIntent[];

export type BlackoutPlayerActionKind = (typeof BLACKOUT_SUPPORTED_ACTIONS)[number];

/** 拒绝原因码。固定枚举，别把异常文本透给 UI。 */
export type BlackoutDetailCode =
  | 'ok'
  | 'crisis_resolved'
  | 'crisis_not_started'
  | 'stage_invalid'
  | 'wrong_floor'
  | 'too_far'
  | 'missing_item'
  | 'npc_unavailable'
  | 'out_of_stock'
  | 'unknown_offer'
  | 'materials_unverified'
  | 'materials_delivered'
  | 'low_trust'
  | 'already_requested'
  | 'nothing_to_do'
  | 'inventory_full';