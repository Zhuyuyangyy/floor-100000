// 停电危机：把六个人第一次拽到同一件事上。
//
// 这一层只做「逻辑 + 落库」，不 import Phaser、不碰渲染。渲染层要什么，
// 通过 observeBlackout() 拿结构化快照，别从这里反向伸手。
//
// 三条设计红线（评审会盯）：
// 1. 不能无限刷：所有物品奖励都从某个 NPC 的**有限库存**里扣，所有一次性
//    结算都挂在单调递增的 stage 或 once-flag 上。
// 2. 不能软锁：维修零件有两条来源（4 层电箱 / 小周手上），而 4 层永远可去，
//    所以零件不会「永远拿不到」；万一真的过期，有明确的 resolved_fail 出口，
//    不会把玩家悬在半空。
// 3. 不能重复触发：stage 只增不减，resolved_* 之后所有写操作一律拒绝。

import type {
  CompetitionActionKind,
  CompetitionActionProposal,
  CompetitionNpcMemoryEntry,
  CompetitionObservationSnapshot,
  CompetitionStateDelta,
  CompetitionWorldStateSnapshot,
} from '../ai/competition-contract';
import {
  runCompetitionStep,
  type CompetitionAttemptFeedback,
  type CompetitionPlan,
} from '../ai/competitionRuntime';
import { hashCompetitionWorldState, serializeCompetitionWorldState } from '../ai/competitionTrace';
import {
  executeCompetitionProposal,
  type CompetitionDemoState,
} from '../ai/competitionExecutor';
import type { GameState, InventoryStack, ItemId } from '../core/gameTypes';
import { INTERACT_DISTANCE } from '../core/constants';
import { getItem } from '../data/items';
import { getNpc, type NpcId } from '../data/npcs';
import { createNpcStateFor } from '../data/npcPersonalities';
import {
  BLACKOUT_AZHEN_REWARD,
  BLACKOUT_AZHEN_STOCK,
  BLACKOUT_AZHEN_THANKS,
  BLACKOUT_AZHEN_WATER,
  BLACKOUT_DEADLINE_DAYS,
  BLACKOUT_FLAG,
  BLACKOUT_PARTIES,
  BLACKOUT_POWER_GATE_ID,
  BLACKOUT_PROMISE_DAYS,
  BLACKOUT_REPAIR_MATERIALS,
  BLACKOUT_SPOIL_WITH_WATER,
  BLACKOUT_SPOIL_WITHOUT_WATER,
  BLACKOUT_STAGE_INDEX,
  BLACKOUT_TRUST_FOR_STANCE,
  BLACKOUT_XIAOZHOU_OFFERS,
  BLACKOUT_XIAOZHOU_STOCK,
  advanceBlackoutStage,
  blackoutStageOf,
  isBlackoutResolved,
  type BlackoutAlinStance,
  type BlackoutDetailCode,
  type BlackoutOffer,
  type BlackoutPartyStatus,
  type BlackoutPlayerActionKind,
  type BlackoutStage,
} from '../data/blackoutCrisis';
import { ALIN_REPAIR_GATE_ID, isAlinRepairGateOpen } from '../data/floorGates';
import { countItem, removeItem, addItem } from '../systems/InventorySystem';
import { loadNpcState, recordMemory, saveNpcState } from '../systems/NpcMemory';
import { loadNpcInventory, saveNpcInventory } from '../systems/NpcInventory';
import {
  createCompetitionNpcMemoryId,
  loadCompetitionNpcMemory,
  saveCompetitionNpcMemory,
} from '../systems/CompetitionNpcMemoryStore';
import { COMPETITION_TRUST_BASE } from '../ai/competitionRules';
import {
  emptyCompetitionDelta,
  validateCompetitionProposal,
  type CompetitionRulesPolicy,
} from '../ai/competitionRules';
import { flagCount, setFlag } from '../systems/WorldFlags';

// ── 小工具 ──────────────────────────────────────────────────────────────────

function cloneStacks(items: readonly InventoryStack[]): InventoryStack[] {
  return items.map((stack) => ({ ...stack, ...(stack.meta ? { meta: { ...stack.meta } } : {}) }));
}

function playerHas(game: GameState, itemId: ItemId, quantity: number): boolean {
  return countItem(game.player.inventory, itemId) >= quantity;
}

function npcName(npcId: NpcId): string {
  return getNpc(npcId).name;
}

function npcDistance(game: GameState, npcId: NpcId): number {
  return Math.abs(game.player.x - getNpc(npcId).x);
}

/**
 * 玩家能不能和这位居民说上话。
 *
 * 两个条件缺一不可：同层，且在交互距离内。分开返回原因，UI 才能说清是
 * 「他在楼上」还是「你还没走过去」——只说一句「不行」等于没提示。
 */
function reachability(game: GameState, npcId: NpcId): BlackoutDetailCode {
  const def = getNpc(npcId);
  if (game.currentFloor !== def.floor) return 'wrong_floor';
  if (npcDistance(game, npcId) > INTERACT_DISTANCE) return 'too_far';
  return 'ok';
}

/**
 * 一次动作的原子提交。
 *
 * 快照 → 执行 → 失败整段回滚。所有写操作都走这里，所以不会出现「材料扣了
 * 但供电没恢复」这种中间态。没有 await 跨越临界区，JS 单线程下不会有竞态。
 */
function atomic<T>(game: GameState, run: () => T): { ok: true; value: T } | { ok: false } {
  const inventorySnapshot = cloneStacks(game.player.inventory.slots);
  const npcStatesSnapshot = game.npcStates ? { ...game.npcStates } : undefined;
  const flagsSnapshot = game.flags ? { ...game.flags } : undefined;
  const hadNpcStates = game.npcStates !== undefined;
  const hadFlags = game.flags !== undefined;
  try {
    return { ok: true, value: run() };
  } catch {
    try {
      game.player.inventory.slots.splice(0, game.player.inventory.slots.length, ...inventorySnapshot);
      if (!hadNpcStates) Reflect.deleteProperty(game, 'npcStates');
      else if (npcStatesSnapshot) game.npcStates = npcStatesSnapshot;
      if (!hadFlags) Reflect.deleteProperty(game, 'flags');
      else if (flagsSnapshot) game.flags = flagsSnapshot;
    } catch {
      // 尽力恢复；下面仍然报告失败，不会把异常吞成成功。
    }
    return { ok: false };
  }
}

/**
 * 给玩家发东西；背包满了不静默丢弃。
 *
 * 返回实际收到的数量。调用方必须按实际数量结算扣减，否则背包一满就变成
 * 「NPC 扣了货、玩家没拿到」的净损失。
 */
function grant(game: GameState, itemId: ItemId, quantity: number): number {
  if (quantity <= 0) return 0;
  return addItem(game.player.inventory, itemId, quantity).added;
}

// ── 阿林的合作意愿 ──────────────────────────────────────────────────────────

/**
 * 从**已落库的记忆**推导阿林这次的态度。
 *
 * 关键：读的是存档里的结构化记忆，不是临时变量。所以「昨天给过他水」这件事
 * 会跨天生效，而「昨天答应了他却没做」同样会跨天生效。
 *
 * 优先级：失信 > 受过恩 > 无交情。失信压过恩情是有意的——信任一旦打折，
 * 先前的善意不能直接抵账。
 */
export function alinStanceOf(game: GameState): BlackoutAlinStance {
  if (flagCount(game, BLACKOUT_FLAG.promiseBroken) > 0) return 'guarded';
  const gaveWaterEarlier = loadCompetitionNpcMemory(game, 'alin').some(
    (entry) =>
      entry.kind === 'fact' &&
      entry.subject === 'player_gift' &&
      entry.value.startsWith('clean_water:') &&
      entry.day < game.day,
  );
  return gaveWaterEarlier ? 'cooperative' : 'neutral';
}

function alinTrust(game: GameState): number {
  return loadNpcState(game, 'alin')?.relationship.player ?? COMPETITION_TRUST_BASE;
}

/** 今天是否已经当面核过料（谨慎态的前置条件）。 */
function verifiedToday(game: GameState): boolean {
  return flagCount(game, BLACKOUT_FLAG.verifiedDay) === game.day;
}

// ── 观察 ────────────────────────────────────────────────────────────────────

/** 一位居民在危机里的公开状态。纯数据，UI 直接渲染。 */
export interface BlackoutPartyView {
  readonly npcId: NpcId;
  readonly name: string;
  readonly floor: number;
  readonly status: BlackoutPartyStatus;
  readonly statusLabel: string;
  /** 他开口要什么；玩家不用猜 */
  readonly requests: readonly { readonly itemId: ItemId; readonly itemName: string; readonly quantity: number }[];
  /** 玩家现在够不够 */
  readonly satisfied: boolean;
  readonly note: string;
}

/** 危机整体快照。这是渲染层唯一被允许读的形状。 */
export interface BlackoutObservation {
  readonly stage: BlackoutStage;
  readonly active: boolean;
  readonly resolved: boolean;
  readonly powerRestored: boolean;
  readonly day: number;
  readonly startedDay: number;
  readonly deadlineDay: number;
  readonly daysLeft: number;
  readonly alinStance: BlackoutAlinStance;
  readonly alinTrust: number;
  readonly parties: readonly BlackoutPartyView[];
  /** 阿林还缺哪些零件（聚合后的缺口，不是配方原文） */
  readonly missingMaterials: readonly { readonly itemId: ItemId; readonly itemName: string; readonly quantity: number }[];
  /** 玩家现在真正能做的动作 */
  readonly availableActions: readonly BlackoutActionKind[];
  /** 合作态才有的情报；其他状态为空数组 */
  readonly intel: readonly string[];
  readonly foodSpoiled: number;
}

/** 本场景对外暴露的动作类型，直接沿用数据层从 A1 契约派生出的那一个。 */
export type BlackoutActionKind = BlackoutPlayerActionKind;

// ── 模型提案端口 ────────────────────────────────────────────────────────────

/**
 * 模型提案口拿得到的东西——只读，且不含 GameState 句柄。
 *
 * 只有这四个键，和 `alinRepairDemo.ts` 的 `ModelProposalInput` 逐字对齐。
 * 为什么不多给：多一个 game/state 之类的句柄，就等于把世界交给模型；
 * `alinRepairModelPort.test.ts` 有一条硬断言锁死这个形状，两边必须一致，
 * 否则接 A0 的桥接层时会出现「一个口给 4 个键、另一个给 6 个」的分叉。
 */
export interface BlackoutModelProposalInput {
  readonly observation: CompetitionObservationSnapshot;
  /** 维修配方（模型不能自己改这份清单，只能照单申请）。 */
  readonly materials: readonly InventoryStack[];
  readonly gateId: string;
  /** 上一轮被拒的反馈；模型据此重规划，而不是重复同一个提案。 */
  readonly previousFeedback: CompetitionAttemptFeedback | null;
}

/**
 * 模型提案口。
 *
 * 三个返回值语义必须分清，混了就会骗评委：
 * - 返回 proposal → 交给 validator 独立裁决（模型仍不能决定成败）
 * - 返回 null → 模型明确「我不动世界」，本轮以 observe 收场，状态不变
 * - 抛异常/超时 → 由 fallback 端口接管，玩家仍能玩完
 */
export type BlackoutModelPort = (input: BlackoutModelProposalInput) => Promise<CompetitionActionProposal | null>;

/**
 * 交易侧模型提案口拿得到的东西。
 *
 * 为什么另开一个类型而不是复用 `BlackoutModelProposalInput`：维修跟交易要的
 * 东西根本不同——维修要「配方 + 闸门」，交易要「价目表 + 对手」。硬塞进同一个
 * 形状会逼模型在一堆无关字段里找信息，也让两侧的 4 键硬断言互相污染。
 *
 * 但**原则完全一致**：仍然只有 4 个键，仍然不给 GameState 句柄。
 */
export interface BlackoutTradeModelInput {
  readonly observation: CompetitionObservationSnapshot;
  /** 这位居民当前愿意谈的价目；模型只能在其中挑，不能自己定价。 */
  readonly offers: readonly BlackoutOffer[];
  readonly npcId: string;
  readonly previousFeedback: CompetitionAttemptFeedback | null;
}

/** 交易侧模型端口。返回 null 表示「他不做这笔」，与「模型挂了」分开处理。 */
export type BlackoutTradeModelPort = (input: BlackoutTradeModelInput) => Promise<CompetitionActionProposal | null>;

/** 决策来源。只在「模型提案 + 提交成功」同时成立时才敢写 'model'。 */
export type BlackoutDecisionSource = 'model' | 'offline-fallback';

function startDayOf(game: GameState): number {
  const stored = flagCount(game, BLACKOUT_FLAG.startedDay);
  return stored > 0 ? stored : game.day;
}

/**
 * 阿林的状态：他卡在哪一步，一句话说清。
 *
 * 「已修复」的判定不读信任、不读库存，只读供电——否则玩家修好之后，
 * 只要把零件用掉，状态就会回退成「缺料」，那是假信息。
 */
function alinView(game: GameState, stage: BlackoutStage, stance: BlackoutAlinStance): BlackoutPartyView {
  const requests = BLACKOUT_PARTIES.alin.request.map((req) => ({
    itemId: req.itemId,
    itemName: getItem(req.itemId).displayName,
    quantity: req.quantity,
  }));
  const satisfied = BLACKOUT_PARTIES.alin.request.every((req) => playerHas(game, req.itemId, req.quantity));
  if (stage === 'resolved_repair') {
    return { npcId: 'alin', name: npcName('alin'), floor: getNpc('alin').floor, status: 'done', statusLabel: '已完成', requests, satisfied, note: '主线接回去了，整栋楼的灯都亮着。' };
  }
  if (stage === 'resolved_fail') {
    return { npcId: 'alin', name: npcName('alin'), floor: getNpc('alin').floor, status: 'refuse', statusLabel: '拒绝合作', requests, satisfied, note: '他不再提修线的事，只是把手电收进了口袋。' };
  }
  if (stage === 'initial') {
    return { npcId: 'alin', name: npcName('alin'), floor: getNpc('alin').floor, status: 'waiting', statusLabel: '在等消息', requests, satisfied, note: '他蹲在配电箱边上，还没开口。' };
  }
  if (stage === 'investigating') {
    // 还没接单：他不是「缺料」，他只是还没跟你提。这两件事对玩家是不同信号，
    // 混成一个「缺料」会让玩家以为自己已经答应过什么。
    return { npcId: 'alin', name: npcName('alin'), floor: getNpc('alin').floor, status: 'waiting', statusLabel: '在等消息', requests, satisfied, note: '他掀开配电箱看了一眼，又合上了。' };
  }
  if (stage === 'materials_needed') {
    return {
      npcId: 'alin', name: npcName('alin'), floor: getNpc('alin').floor,
      status: satisfied ? 'ready' : 'missing_materials',
      statusLabel: satisfied ? '可以动手' : '缺料',
      requests, satisfied,
      note: satisfied
        ? (stance === 'guarded' ? '他伸手要先把零件摊开看清楚。' : '零件齐了，他说可以试。')
        : `缺${requests.filter((req) => !playerHas(game, req.itemId, req.quantity)).map((req) => req.itemName).join('、') || '零件'}。`,
    };
  }
  return {
    npcId: 'alin', name: npcName('alin'), floor: getNpc('alin').floor,
    status: 'missing_materials', statusLabel: '缺料', requests, satisfied,
    note: '他说主线接不回去，先去看看配电箱和楼下还有没有存货。',
  };
}

function xiaozhouView(game: GameState, stage: BlackoutStage, stance: BlackoutAlinStance): BlackoutPartyView {
  const stock = loadNpcInventory(game, 'xiaozhou');
  const requests = BLACKOUT_XIAOZHOU_OFFERS.map((offer) => ({
    itemId: offer.price.itemId,
    itemName: getItem(offer.price.itemId).displayName,
    quantity: offer.price.quantity,
  }));
  const hasStock = stock.length > 0;
  const known = stance === 'cooperative' || stage === 'materials_needed' || stage === 'investigating';
  const satisfied = requests.every((req) => playerHas(game, req.itemId, req.quantity));
  if (stage === 'resolved_fail' || !hasStock) {
    return { npcId: 'xiaozhou', name: npcName('xiaozhou'), floor: getNpc('xiaozhou').floor, status: stage === 'resolved_fail' ? 'refuse' : 'done', statusLabel: stage === 'resolved_fail' ? '拒绝合作' : '已完成', requests, satisfied, note: hasStock ? '他改口说这些零件留着自己用。' : '他把最后一个零件收起来了。' };
  }
  if (stage === 'resolved_repair') {
    return { npcId: 'xiaozhou', name: npcName('xiaozhou'), floor: getNpc('xiaozhou').floor, status: 'trading', statusLabel: '可交易', requests, satisfied, note: '灯亮了，他说下次停电还得靠这些。' };
  }
  return {
    npcId: 'xiaozhou', name: npcName('xiaozhou'), floor: getNpc('xiaozhou').floor,
    status: 'trading', statusLabel: '可交易', requests, satisfied,
    note: known ? '他手上有保险丝和电线，明码标价。' : '他背对着你清点箱子。',
  };
}

function azhenView(game: GameState, stage: BlackoutStage): BlackoutPartyView {
  const requests = [{
    itemId: BLACKOUT_AZHEN_WATER.itemId,
    itemName: getItem(BLACKOUT_AZHEN_WATER.itemId).displayName,
    quantity: BLACKOUT_AZHEN_WATER.quantity,
  }];
  const satisfied = playerHas(game, BLACKOUT_AZHEN_WATER.itemId, BLACKOUT_AZHEN_WATER.quantity);
  const watered = flagCount(game, BLACKOUT_FLAG.azhenWater) > 0;
  if (stage === 'resolved_fail') {
    return { npcId: 'azhen', name: npcName('azhen'), floor: getNpc('azhen').floor, status: 'refuse', statusLabel: '拒绝合作', requests, satisfied, note: '灶冷了太久，她没再抬头。' };
  }
  if (watered) {
    return { npcId: 'azhen', name: npcName('azhen'), floor: getNpc('azhen').floor, status: 'done', statusLabel: '已完成', requests, satisfied: true, note: '她用那点水把存货挪进了凉处，说能多撑两天。' };
  }
  if (stage === 'resolved_repair') {
    return { npcId: 'azhen', name: npcName('azhen'), floor: getNpc('azhen').floor, status: 'done', statusLabel: '已完成', requests, satisfied, note: '灯亮了，她把灶重新点着。' };
  }
  return {
    npcId: 'azhen', name: npcName('azhen'), floor: getNpc('azhen').floor,
    status: satisfied ? 'ready' : 'waiting', statusLabel: satisfied ? '可以动手' : '在等消息', requests, satisfied,
    note: '停电以后灶就凉了，她说存货撑不住几天。',
  };
}

/** 主入口：任何 UI / 测试都从这一个函数读世界，不要自己拼。 */
export function observeBlackout(game: GameState): BlackoutObservation {
  const stage = blackoutStageOf(game);
  const stance = alinStanceOf(game);
  const startedDay = startDayOf(game);
  const deadlineDay = startedDay + BLACKOUT_DEADLINE_DAYS;
  const missing = BLACKOUT_REPAIR_MATERIALS
    .filter((material) => !playerHas(game, material.itemId, material.quantity))
    .map((material) => ({
      itemId: material.itemId,
      itemName: getItem(material.itemId).displayName,
      quantity: material.quantity - countItem(game.player.inventory, material.itemId),
    }));
  const parties = [
    alinView(game, stage, stance),
    xiaozhouView(game, stage, stance),
    azhenView(game, stage),
  ];
  const resolved = stage === 'resolved_repair' || stage === 'resolved_fail';
  const availableActions: BlackoutActionKind[] = resolved
    ? ['observe']
    : ['observe', 'request_help', 'propose_trade', 'repair_gate', 'wait'];
  // 合作态的额外情报：他主动把楼下那位的底价告诉玩家。
  // 这不是台词差异，而是**玩家不需要试错就知道价格**——省掉的是真实的动作次数。
  const intel = stance === 'cooperative' && stage !== 'resolved_fail'
    ? [
        `小周手上有${BLACKOUT_XIAOZHOU_STOCK.map((stack) => `${getItem(stack.itemId).displayName}×${stack.quantity}`).join('、')}。`,
        ...BLACKOUT_XIAOZHOU_OFFERS.map(
          (offer) => `${getItem(offer.partId).displayName}要${getItem(offer.price.itemId).displayName}×${offer.price.quantity}。`,
        ),
      ]
    : [];
  return {
    stage,
    active: stage === 'investigating' || stage === 'materials_needed',
    resolved,
    powerRestored: flagCount(game, BLACKOUT_FLAG.power) > 0,
    day: game.day,
    startedDay,
    deadlineDay,
    daysLeft: Math.max(0, deadlineDay - game.day),
    alinStance: stance,
    alinTrust: alinTrust(game),
    parties,
    missingMaterials: missing,
    availableActions,
    intel,
    foodSpoiled: flagCount(game, BLACKOUT_FLAG.foodSpoiled),
  };
}

// ── 记忆写入 ────────────────────────────────────────────────────────────────

/**
 * 追加一条结构化记忆。
 *
 * 顺序不可调换：saveNpcState 会整体覆盖 npcStates[npcId] 这个 JSON blob，
 * 把同一 blob 里的 competitionInventory / competitionMemory 一并抹掉。
 * 所以先写通用状态，再用两个适配器把库存和**全部**记忆补回去。
 * 反过来写会让库存被清空——本仓库实测踩过（见 socialNpcDemo 注释）。
 */
function appendMemory(
  game: GameState,
  npcId: NpcId,
  input: { kind: string; summary: string },
  entry: CompetitionNpcMemoryEntry,
): void {
  const priorMemories = loadCompetitionNpcMemory(game, npcId);
  const inventory = loadNpcInventory(game, npcId);
  const baseline = loadNpcState(game, npcId) ?? createNpcStateFor(npcId);
  const next = recordMemory(baseline, {
    day: game.day,
    minute: Math.floor(game.gameMinuteOfDay),
    kind: input.kind,
    actor: 'player',
    summary: input.summary,
  });
  saveNpcState(game, npcId, next);
  if (!saveNpcInventory(game, npcId, inventory)) throw new Error('npc_inventory_rewrite_failed');
  for (const prior of priorMemories) {
    if (!saveCompetitionNpcMemory(game, npcId, prior)) throw new Error('memory_rewrite_failed');
  }
  if (!saveCompetitionNpcMemory(game, npcId, entry)) throw new Error('memory_write_failed');
}

function nextMemoryId(game: GameState, npcId: NpcId): string {
  const existing = loadCompetitionNpcMemory(game, npcId);
  let sequence = existing.length;
  let id = createCompetitionNpcMemoryId(game.runSeed, npcId, game.day, sequence);
  while (existing.some((entry) => entry.memoryId === id)) {
    sequence += 1;
    id = createCompetitionNpcMemoryId(game.runSeed, npcId, game.day, sequence);
  }
  return id;
}

function promiseEntry(game: GameState, npcId: NpcId, text: string, status: 'open' | 'kept' | 'broken'): CompetitionNpcMemoryEntry {
  return { kind: 'promise', memoryId: nextMemoryId(game, npcId), day: game.day, promise: text, status };
}

function factEntry(game: GameState, npcId: NpcId, subject: string, value: string): CompetitionNpcMemoryEntry {
  return { kind: 'fact', memoryId: nextMemoryId(game, npcId), day: game.day, subject, value };
}

// ── 开始 / 推进 / 过期 ──────────────────────────────────────────────────────

export interface BlackoutTransition {
  readonly ok: boolean;
  readonly stage: BlackoutStage;
  readonly detail: BlackoutDetailCode;
  readonly message: string;
}

/**
 * 要不要开始这次危机。
 *
 * 触发条件不是「第几天」，而是「玩家真的能走遍塔楼」——维修门开了，
 * 4 层电箱与 5 层食堂才够得着。门没开就触发，等于要求玩家去拿一份
 * 物理上取不到的零件，那是设计层面的软锁。
 */
export function syncBlackoutCrisis(game: GameState): BlackoutTransition {
  const stage = blackoutStageOf(game);
  if (stage === 'initial') {
    if (!isAlinRepairGateOpen(game)) {
      return { ok: false, stage, detail: 'crisis_not_started', message: '维修门还关着，先把 2 楼的门修好。' };
    }
    const committed = atomic(game, () => {
      advanceBlackoutStage(game, 'investigating');
      // 停电从「今天」算起；死线按天推进，不用真实时间。
      setFlag(game, BLACKOUT_FLAG.startedDay, game.day);
      // 库存只铺一次。重复 sync 不能把货架刷回来，否则就是无限刷取的入口。
      if (flagCount(game, BLACKOUT_FLAG.stocked) === 0) {
        for (const [npcId, stock] of [['xiaozhou', BLACKOUT_XIAOZHOU_STOCK], ['azhen', BLACKOUT_AZHEN_STOCK]] as const) {
          const existing = loadNpcInventory(game, npcId);
          if (!saveNpcInventory(game, npcId, [...existing, ...cloneStacks(stock)])) throw new Error('stock_seed_failed');
        }
        setFlag(game, BLACKOUT_FLAG.stocked, 1);
      }
      appendMemory(game, 'alin', { kind: 'observed', summary: '塔楼主线烧了，整层停电' }, factEntry(game, 'alin', 'blackout_started', `${game.day}`));
      return true;
    });
    if (!committed.ok) return { ok: false, stage: 'initial', detail: 'nothing_to_do', message: '停电事件启动失败，状态未改变。' };
    return { ok: true, stage: 'investigating', detail: 'ok', message: '塔楼跳闸了，走廊一片黑。' };
  }

  if (isBlackoutResolved(game)) {
    return { ok: false, stage, detail: 'crisis_resolved', message: '这次停电已经有结果了。' };
  }

  // 承诺过期：接单当天 + 1 天内没交货，就记一笔失信。
  const promiseDay = flagCount(game, BLACKOUT_FLAG.promiseDay);
  if (promiseDay > 0 && flagCount(game, BLACKOUT_FLAG.power) === 0 &&
      game.day > promiseDay + BLACKOUT_PROMISE_DAYS && flagCount(game, BLACKOUT_FLAG.promiseBroken) === 0) {
    atomic(game, () => {
      setFlag(game, BLACKOUT_FLAG.promiseBroken, 1);
      appendMemory(game, 'alin', { kind: 'refusal', summary: '玩家答应帮忙修线，却一直没有交货' }, promiseEntry(game, 'alin', '玩家答应补齐保险丝和电线', 'broken'));
    });
  }

  // 死线：过了就是明确的失败出口，不是无限等待。
  if (game.day >= startDayOf(game) + BLACKOUT_DEADLINE_DAYS) {
    const spoiled = flagCount(game, BLACKOUT_FLAG.azhenWater) > 0 ? BLACKOUT_SPOIL_WITH_WATER : BLACKOUT_SPOIL_WITHOUT_WATER;
    const failed = atomic(game, () => {
      // 坏掉的是阿珍的存货，不是凭空消失的数值：先从她的库存里扣，扣不完才是真实损失。
      const stock = loadNpcInventory(game, 'azhen');
      let remaining = spoiled;
      const next = stock.map((stack) => {
        if (stack.itemId !== 'bread' || remaining === 0) return stack;
        const taken = Math.min(stack.quantity, remaining);
        remaining -= taken;
        return { ...stack, quantity: stack.quantity - taken };
      }).filter((stack) => stack.quantity > 0);
      if (!saveNpcInventory(game, 'azhen', next)) throw new Error('spoil_write_failed');
      setFlag(game, BLACKOUT_FLAG.foodSpoiled, spoiled - remaining);
      advanceBlackoutStage(game, 'resolved_fail');
      appendMemory(game, 'alin', { kind: 'refusal', summary: '停电太久，主线没修，阿林不再提这件事' }, factEntry(game, 'alin', 'blackout_failed', `${game.day}`));
      appendMemory(game, 'azhen', { kind: 'refusal', summary: '停电太久，食堂的存货坏了' }, factEntry(game, 'azhen', 'food_spoiled', `${spoiled - remaining}`));
      return true;
    });
    if (!failed.ok) return { ok: false, stage, detail: 'nothing_to_do', message: '停电结算失败，状态未改变。' };
    return { ok: true, stage: 'resolved_fail', detail: 'ok', message: '停了太久，食堂的存货坏了。' };
  }

  return { ok: false, stage, detail: 'ok', message: '危机仍在继续。' };
}

// ── 动作结果 ────────────────────────────────────────────────────────────────

export interface BlackoutActionResult {
  readonly ok: boolean;
  readonly action: BlackoutActionKind;
  readonly detail: BlackoutDetailCode;
  readonly message: string;
  readonly observation: BlackoutObservation;
}

function result(game: GameState, action: BlackoutActionKind, ok: boolean, detail: BlackoutDetailCode, message: string): BlackoutActionResult {
  return { ok, action, detail, message, observation: observeBlackout(game) };
}

/** 动作前的统一守卫：危机没开始 / 已经失败，一律不写。 */
function guardStage(game: GameState): BlackoutDetailCode {
  const stage = blackoutStageOf(game);
  if (stage === 'initial') return 'crisis_not_started';
  // 修好之后世界并没有冻结：还能给小周换货、给阿珍送水、收谢礼。
  // 真正被关掉的是「再次维修」和「再推进危机」——那两条各自有独立判定。
  if (stage === 'resolved_fail') return 'crisis_resolved';
  return 'ok';
}

/**
 * 只在危机仍在进行时允许写。
 *
 * 与 guardStage 的区别是这一条会把 resolved_repair 也挡掉：它用于「推进
 * 剧情」的动作（接单、清点、维修），而不是「事后还能做的事」。
 */
function guardActive(game: GameState): BlackoutDetailCode {
  const stage = blackoutStageOf(game);
  if (stage === 'initial') return 'crisis_not_started';
  if (stage === 'resolved_repair' || stage === 'resolved_fail') return 'crisis_resolved';
  return 'ok';
}

/**
 * request_help：玩家正式接下某个人的委托。
 *
 * 为什么「接单」本身要落库：因为后面的判断依赖它——接下阿林却拖着不办，
 * 第二天他就会要求先核料（guarded）。没有这条记录，失信就无从谈起。
 */
export function requestBlackoutHelp(game: GameState, npcId: 'alin' | 'xiaozhou' | 'azhen'): BlackoutActionResult {
  const guard = guardActive(game);
  if (guard !== 'ok') return result(game, 'request_help', false, guard, '现在没有人会接这个话头。');
  const reach = reachability(game, npcId);
  if (reach !== 'ok') {
    return result(game, 'request_help', false, reach, reach === 'wrong_floor' ? `${npcName(npcId)}不在这一层。` : `走近一点再和${npcName(npcId)}说话。`);
  }
  if (npcId === 'alin') {
    // 已经答应过一次就不重复记：重复接单不该刷出第二条承诺。
    if (flagCount(game, BLACKOUT_FLAG.promiseDay) > 0) {
      return result(game, 'request_help', false, 'already_requested', '你已经答应过他了。');
    }
    const committed = atomic(game, () => {
      setFlag(game, BLACKOUT_FLAG.promiseDay, game.day);
      advanceBlackoutStage(game, 'materials_needed');
      appendMemory(
        game, 'alin',
        { kind: 'help', summary: '玩家答应补齐保险丝和电线' },
        promiseEntry(game, 'alin', '玩家答应补齐保险丝和电线', 'open'),
      );
      return true;
    });
    if (!committed.ok) return result(game, 'request_help', false, 'nothing_to_do', '承诺没有记下来，状态未改变。');
    return result(game, 'request_help', true, 'ok', '他列了清单：保险丝一个、电线一段。');
  }
  const party = BLACKOUT_PARTIES[npcId];
  const wants = party.request.map((req) => `${getItem(req.itemId).displayName}×${req.quantity}`).join('、');
  const committed = atomic(game, () => {
    appendMemory(game, npcId, { kind: 'help', summary: `玩家问起${party.need}` }, promiseEntry(game, npcId, `玩家答应给${wants}`, 'open'));
    return true;
  });
  if (!committed.ok) return result(game, 'request_help', false, 'nothing_to_do', '没有记下这次交谈。');
  return result(game, 'request_help', true, 'ok', `${npcName(npcId)}说：${party.need}。他要${wants}。`);
}

/**
 * propose_trade：和小周换零件。
 *
 * 他是这栋楼里唯一会囤货的人，所以也是零件的**第二条来源**——玩家在 4 层
 * 把电线用去装灯以后，主线不至于因此永久卡死。库存有限，买完即止。
 */
export function tradeWithXiaozhou(game: GameState, offerId: string): BlackoutActionResult {
  const guard = guardStage(game);
  if (guard !== 'ok') return result(game, 'propose_trade', false, guard, '他不再谈价了。');
  const offer = BLACKOUT_XIAOZHOU_OFFERS.find((item) => item.id === offerId);
  if (!offer) return result(game, 'propose_trade', false, 'unknown_offer', '没有这个价。');
  const reach = reachability(game, 'xiaozhou');
  if (reach !== 'ok') return result(game, 'propose_trade', false, reach, reach === 'wrong_floor' ? '小周在楼下那层。' : '走近小周再谈。');
  const stock = loadNpcInventory(game, 'xiaozhou');
  if (countItemArray(stock, offer.partId) < offer.quantity) {
    return result(game, 'propose_trade', false, 'out_of_stock', `他的${getItem(offer.partId).displayName}已经卖完了。`);
  }
  if (!playerHas(game, offer.price.itemId, offer.price.quantity)) {
    return result(game, 'propose_trade', false, 'missing_item', `你手上没有${getItem(offer.price.itemId).displayName}×${offer.price.quantity}。`);
  }
  const committed = atomic(game, () => {
    const paid = removeItem(game.player.inventory, offer.price.itemId, offer.price.quantity);
    if (paid !== offer.price.quantity) throw new Error('price_not_removed');
    const nextStock = removeFromArray(stock, offer.partId, offer.quantity);
    if (!saveNpcInventory(game, 'xiaozhou', nextStock)) throw new Error('stock_write_failed');
    const received = grant(game, offer.partId, offer.quantity);
    if (received !== offer.quantity) throw new Error('inventory_full');
    appendMemory(
      game, 'xiaozhou',
      { kind: 'trade', summary: `玩家用${getItem(offer.price.itemId).displayName}换了${getItem(offer.partId).displayName}` },
      factEntry(game, 'xiaozhou', 'trade', `${offer.partId}:${offer.quantity}`),
    );
    return true;
  });
  if (!committed.ok) return result(game, 'propose_trade', false, 'inventory_full', '背包放不下，交易取消。');
  return result(game, 'propose_trade', true, 'ok', `换到${getItem(offer.partId).displayName}×${offer.quantity}。`);
}

/**
 * propose_trade（阿珍）：把净水给她。
 *
 * 她一次只收两瓶——水在这里是稀缺品，能同时喂饱阿珍和小周的水只有三瓶，
 * 这就是本章真正的资源分配题。所以只结算一次，付过了就换口粮。
 */
export function giveWaterToAzhen(game: GameState): BlackoutActionResult {
  const guard = guardStage(game);
  if (guard !== 'ok') return result(game, 'propose_trade', false, guard, '她没再接话。');
  if (flagCount(game, BLACKOUT_FLAG.azhenWater) > 0) {
    return result(game, 'propose_trade', false, 'already_requested', '她已经拿到水了。');
  }
  const reach = reachability(game, 'azhen');
  if (reach !== 'ok') return result(game, 'propose_trade', false, reach, reach === 'wrong_floor' ? '阿珍在五楼食堂。' : '走近阿珍再说。');
  if (!playerHas(game, BLACKOUT_AZHEN_WATER.itemId, BLACKOUT_AZHEN_WATER.quantity)) {
    return result(game, 'propose_trade', false, 'missing_item', `你手上没有${getItem(BLACKOUT_AZHEN_WATER.itemId).displayName}×${BLACKOUT_AZHEN_WATER.quantity}。`);
  }
  const committed = atomic(game, () => {
    const paid = removeItem(game.player.inventory, BLACKOUT_AZHEN_WATER.itemId, BLACKOUT_AZHEN_WATER.quantity);
    if (paid !== BLACKOUT_AZHEN_WATER.quantity) throw new Error('water_not_removed');
    // 她的回礼只能从她自己的存货里出，不能凭空生成。
    const stock = loadNpcInventory(game, 'azhen');
    const available = Math.min(BLACKOUT_AZHEN_REWARD.quantity, countItemArray(stock, BLACKOUT_AZHEN_REWARD.itemId));
    const nextStock = removeFromArray(stock, BLACKOUT_AZHEN_REWARD.itemId, available);
    if (!saveNpcInventory(game, 'azhen', nextStock)) throw new Error('stock_write_failed');
    const received = grant(game, BLACKOUT_AZHEN_REWARD.itemId, available);
    if (received !== available) throw new Error('inventory_full');
    setFlag(game, BLACKOUT_FLAG.azhenWater, 1);
    appendMemory(
      game, 'azhen',
      { kind: 'gift', summary: `玩家给了${getItem(BLACKOUT_AZHEN_WATER.itemId).displayName}，保住了存货` },
      factEntry(game, 'azhen', 'player_water', `${BLACKOUT_AZHEN_WATER.quantity}`),
    );
    return received;
  });
  if (!committed.ok) return result(game, 'propose_trade', false, 'inventory_full', '背包放不下口粮，水先没给出去。');
  if (committed.value === 0) return result(game, 'propose_trade', true, 'ok', '她把水收了，说灶上已经没东西能给你了。');
  return result(game, 'propose_trade', true, 'ok', `她收下水，塞给你${getItem(BLACKOUT_AZHEN_REWARD.itemId).displayName}×${committed.value}。`);
}

/**
 * accept_gift：收下阿珍事后塞的那份谢礼。
 *
 * 独立成一步，而不是修好就自动进背包——「别人递过来的东西，你要接」这件事
 * 本身就是关系的一部分。同样只能拿一次，货源仍是她的库存。
 */
export function acceptAzhenThanks(game: GameState): BlackoutActionResult {
  const stage = blackoutStageOf(game);
  if (stage !== 'resolved_repair') return result(game, 'accept_gift', false, 'stage_invalid', '现在没有要给你的东西。');
  if (flagCount(game, BLACKOUT_FLAG.azhenWater) === 0) return result(game, 'accept_gift', false, 'stage_invalid', '你和她的交情还不到这一步。');
  if (flagCount(game, 'once:blackout:azhen-thanks') > 0) return result(game, 'accept_gift', false, 'already_requested', '这份谢礼已经收过了。');
  const reach = reachability(game, 'azhen');
  if (reach !== 'ok') return result(game, 'accept_gift', false, reach, reach === 'wrong_floor' ? '阿珍在五楼食堂。' : '走近阿珍再说。');
  const committed = atomic(game, () => {
    const stock = loadNpcInventory(game, 'azhen');
    const available = Math.min(BLACKOUT_AZHEN_THANKS.quantity, countItemArray(stock, BLACKOUT_AZHEN_THANKS.itemId));
    if (available <= 0) throw new Error('out_of_stock');
    const nextStock = removeFromArray(stock, BLACKOUT_AZHEN_THANKS.itemId, available);
    if (!saveNpcInventory(game, 'azhen', nextStock)) throw new Error('stock_write_failed');
    const received = grant(game, BLACKOUT_AZHEN_THANKS.itemId, available);
    if (received !== available) throw new Error('inventory_full');
    setFlag(game, 'once:blackout:azhen-thanks', 1);
    return received;
  });
  if (!committed.ok) return result(game, 'accept_gift', false, 'out_of_stock', '她手上已经没东西可给了。');
  return result(game, 'accept_gift', true, 'ok', `她多塞了一份${getItem(BLACKOUT_AZHEN_THANKS.itemId).displayName}。`);
}

/**
 * 谨慎态的前置：当面核料。
 *
 * 只在 guarded 下有意义——他不再听口头保证，要亲眼看见零件。所以这不是
 * 一句台词，而是一个**额外的必需步骤**：缺了它，repair_gate 会被拒绝。
 */
export function verifyBlackoutMaterials(game: GameState): BlackoutActionResult {
  const guard = guardActive(game);
  if (guard !== 'ok') return result(game, 'observe', false, guard, '现在没必要清点。');
  if (alinStanceOf(game) !== 'guarded') return result(game, 'observe', true, 'ok', '他没多问，直接看了一遍你手上的东西。');
  const reach = reachability(game, 'alin');
  if (reach !== 'ok') return result(game, 'observe', false, reach, reach === 'wrong_floor' ? '阿林在二楼。' : '走近阿林再清点。');
  const missing = BLACKOUT_REPAIR_MATERIALS.filter((material) => !playerHas(game, material.itemId, material.quantity));
  if (missing.length > 0) {
    return result(game, 'observe', false, 'missing_item', `他翻了翻，说还缺${missing.map((material) => getItem(material.itemId).displayName).join('、')}。`);
  }
  const committed = atomic(game, () => {
    setFlag(game, BLACKOUT_FLAG.verifiedDay, game.day);
    appendMemory(game, 'alin', { kind: 'observed', summary: '玩家当面把零件摊开给他看' }, factEntry(game, 'alin', 'materials_verified', `${game.day}`));
    return true;
  });
  if (!committed.ok) return result(game, 'observe', false, 'nothing_to_do', '清点没有记下来。');
  return result(game, 'observe', true, 'ok', '他把两样零件挨个看了一遍，点头。');
}

// ── 维修（失败 → 重规划 → 成功）──────────────────────────────────────────────

export type BlackoutRepairStatus = 'executed' | 'blocked' | 'exhausted' | 'planning_failed' | 'already_resolved';

export interface BlackoutRepairStep {
  readonly attempt: number;
  readonly kind: CompetitionActionKind;
  readonly outcome: 'executed' | 'validation_rejected' | 'no_proposal' | 'proposal_unavailable' | 'execution_failed' | 'planning_failed';
  readonly detailCode?: BlackoutDetailCode;
}

export interface BlackoutRepairResult {
  readonly status: BlackoutRepairStatus;
  readonly attempts: number;
  readonly detail: BlackoutDetailCode;
  readonly message: string;
  /** 每一步实际发生了什么，供 UI 与测试逐段断言 */
  readonly steps: readonly BlackoutRepairStep[];
  readonly observation: CompetitionObservationSnapshot;
  readonly before: CompetitionWorldStateSnapshot;
  readonly after: CompetitionWorldStateSnapshot;
  readonly beforeHash: string;
  readonly afterHash: string;
  /**
   * 被拒之后的下一步建议。这是「反馈修正」的机器可读出口：
   * 玩家/UI 不需要解析文案，直接照这个动作做。
   */
  readonly nextStep: { readonly action: 'request_help' | 'observe'; readonly npcId: NpcId; readonly missing: readonly ItemId[] } | null;
  /**
   * 这次决策到底是谁做的。
   *
   * 只有「模型真的产出了提案」且「它被提交成功」两个条件同时成立才是 'model'。
   * 模型空手而归、提案被 validator 拦下、或者模型挂了走规则兜底，都必须如实
   * 标成 'offline-fallback'——Judge Mode 靠这个字段判断 AI 是否真的参与。
   */
  readonly decisionSource: BlackoutDecisionSource;
  /** 模型给出的台词（如果有）。不参与裁决，只用于 UI 展示。 */
  readonly utterance: string | null;
}

export interface BlackoutRepairOptions {
  readonly maxAttempts?: number;
  /**
   * 模型提案口。
   *
   * 做成注入而不是在这里直接 import 模型客户端，理由与 alinRepairDemo 相同：
   * 这个文件被真机测试、线上代理、离线单测三处共用，任何一处硬绑网络都会让
   * 另外两处无法离线跑。
   */
  readonly proposeWithModel?: BlackoutModelPort;
}

/**
 * 把 GameState 包成 executor 认得的 `CompetitionDemoState`。
 *
 * 照抄 `alinRepairDemo.ts:185` 的做法：不是拍快照，而是用 getter/setter 把
 * executor 的写入**直接接回 GameState**。这样 executor 里那套「staged 副本 →
 * 全部校验通过 → 一次性提交」的护栏才真正生效，而不是变成一次无关紧要的
 * 演练（快照版会在 executor 改完之后再被我们自己的写入覆盖掉）。
 *
 * 三个 setter 的分工：
 * - trust：写回 npcStates[alin] 的 relationship.player。
 * - gate.status：只有 'open' 才有意义（写 power flag）；把它设回 closed 的
 *   语义在首章里不存在，所以静默忽略而不是抛错——executor 不会这么做，
 *   真做了也不该让玩家看到崩溃。
 * - inventory：executor 用 splice 原地改，所以给它**实引用**即可，
 *   `player.inventory.slots` 本身就是活数组。
 */
function executorState(game: GameState, world: CompetitionWorldStateSnapshot): CompetitionDemoState {
  const npcSnapshot = world.npcs[0]!;
  const npc: CompetitionDemoState['npcs'][number] = {
    npcId: 'alin',
    position: { ...npcSnapshot.position },
    status: npcSnapshot.status,
    trust: npcSnapshot.trust,
    inventory: loadNpcInventory(game, 'alin'),
  };
  Object.defineProperty(npc, 'trust', {
    enumerable: true,
    get: () => alinTrust(game),
    set: (value: number) => {
      if (!Number.isFinite(value)) return;
      const state = loadNpcState(game, 'alin') ?? createNpcStateFor('alin');
      state.relationship.player = value;
      saveNpcState(game, 'alin', state);
    },
  });
  const gate: CompetitionDemoState['gates'][number] = {
    gateId: BLACKOUT_POWER_GATE_ID,
    floor: getNpc('alin').floor,
    status: flagCount(game, BLACKOUT_FLAG.power) > 0 ? 'open' : 'closed',
  };
  Object.defineProperty(gate, 'status', {
    enumerable: true,
    get: () => (flagCount(game, BLACKOUT_FLAG.power) > 0 ? 'open' : 'closed'),
    set: (value: 'open' | 'closed' | 'blocked' | 'broken') => {
      if (value === 'open') setFlag(game, BLACKOUT_FLAG.power, 1);
    },
  });
  return {
    currentFloor: world.currentFloor,
    player: {
      position: { ...world.player.position },
      // 活引用：executor 自己会 clone→校验→splice 回写，这里不替它挡。
      inventory: game.player.inventory.slots,
    },
    npcs: [npc],
    gates: [gate],
    appliedOperationIds: new Set<string>(),
  };
}

/**
 * executor 提交成功之后的场景侧收尾。
 *
 * 为什么这些不能进 executor：executor 只认「通用世界差量」（库存/信任/闸门），
 * 而阶段推进、承诺记忆、信任分档这些是**本章特有**的剧情语义，塞进通用执行器
 * 会污染其他调用方。所以分工是：
 *   executor 负责「世界的物理变化」（扣料 + 开闸 + 改信任值）
 *   本函数负责「这变化在剧情里意味着什么」（stage、记忆、kept 状态）
 *
 * 幂等由调用方保证（同一 operationId 第二次会被 executor 判 duplicate），
 * 这里不重复判。
 */
function finishRepairStory(game: GameState, trustAfterExecutor: number): void {
  advanceBlackoutStage(game, 'resolved_repair');
  appendMemory(
    game, 'alin',
    { kind: 'help', summary: '玩家补齐零件，主线接回去了' },
    promiseEntry(game, 'alin', '玩家答应补齐保险丝和电线', 'kept'),
  );
  // 信任增量按态度分档：这是本章独有的关系语义，不适合塞进通用 executor
  // （那里 trustDeltas 是单一常数）。executor 把「物理世界」改完，这里补上
  // 「这次合作对关系意味着什么」。
  const stance = alinStanceOf(game);
  const trustGain = stance === 'cooperative' ? 8 : stance === 'guarded' ? 2 : 4;
  // appendMemory 会整体重写 npcStates[alin] 这个 JSON blob，把 executor 刚写进去
  // 的 relationship.player 覆盖回旧值。所以基准值取 executor 的最终值。
  const state = loadNpcState(game, 'alin') ?? createNpcStateFor('alin');
  state.relationship.player = Math.max(-100, Math.min(100, trustAfterExecutor + trustGain));
  saveNpcState(game, 'alin', state);
  // 同一个 blob 里还有 competitionInventory / competitionMemory，也必须补回去，
  // 否则会被 saveNpcState 覆平成空——本仓库实测踩过这个坑。
  if (!saveNpcInventory(game, 'alin', loadNpcInventory(game, 'alin'))) {
    throw new Error('alin_inventory_rewrite_failed');
  }
}

function npcTrust(game: GameState, npcId: NpcId): number {
  return loadNpcState(game, npcId)?.relationship.player ?? COMPETITION_TRUST_BASE;
}

/**
 * 只读快照：给 competitionRuntime 的观察端口用。
 *
 * 为什么三个居民共用同一个构造函数、只换 `npcId`：
 * 首章是一个**协作事件**，不是三段独立剧情。阿林修、小周找料、阿珍协调
 * 分工不同，但服务端只有 `dialogue` / `repair` 两种 task，所以这里刻意让
 * 三人的观察形状一致，靠 `focus.npcId` 与 `world.npcs[0].goal` 区分角色。
 * 这样桥接层只需要一个 task 请求体，不用为三个 NPC 各造一套枚举。
 *
 * `sequence` 参与 observationId，保证同一分钟内多次观察也彼此可区分——
 * 运行时用 id 判断「这一轮看到的是不是上一轮那个世界」。
 */
function npcObservation(
  game: GameState,
  npcId: NpcId,
  sequence: number,
  kind: 'repair' | 'trade',
): CompetitionObservationSnapshot {
  const observation = observeBlackout(game);
  const def = getNpc(npcId);
  const trust = npcTrust(game, npcId);
  const world: CompetitionWorldStateSnapshot = {
    seed: game.runSeed,
    day: game.day,
    gameMinute: game.gameMinuteOfDay,
    currentFloor: game.currentFloor,
    flags: { ...(game.flags ?? {}) },
    threats: [],
    player: {
      position: { floor: game.currentFloor, x: game.player.x },
      hp: game.player.hp,
      hunger: game.player.hunger,
      thirst: game.player.thirst,
      energy: game.player.energy,
      inventory: cloneStacks(game.player.inventory.slots),
    },
    npcs: [{
      npcId,
      position: { floor: def.floor, x: def.x },
      // 民用 NPC 的 HP/饥饿不在 GameState 建模，0 是契约占位符，本模块从不写回。
      hp: 0,
      hunger: 0,
      trust,
      affinity: 0,
      tension: 0,
      status: game.currentFloor === def.floor ? 'available' : 'absent',
      goal: {
        // 同一场危机：三人的 goalId 都指向塔楼主线，角色差异靠 npcId 表达。
        goalId: BLACKOUT_POWER_GATE_ID,
        kind: 'custom',
        sinceDay: game.day,
        status: observation.stage === 'resolved_repair' ? 'complete' : 'active',
        target: BLACKOUT_POWER_GATE_ID,
      },
      memory: loadCompetitionNpcMemory(game, npcId),
      lastAction: null,
      inventory: loadNpcInventory(game, npcId),
    }],
    groundItems: [],
    gates: [{
      gateId: BLACKOUT_POWER_GATE_ID,
      floor: def.floor,
      status: flagCount(game, BLACKOUT_FLAG.power) > 0 ? 'open' : 'closed',
    }],
  };
  const party = observation.parties.find((item) => item.npcId === npcId);
  return {
    observationId: `${world.seed}:${world.day}:${world.gameMinute}:${kind}:${npcId}:${sequence}`,
    world,
    focus: { kind: 'npc', npcId },
    availableActions: kind === 'repair' ? ['observe', 'repair_gate'] : ['observe', 'trade'],
    recentFacts: [
      `阶段:${observation.stage}`,
      `${npcId}信任:${trust}`,
      `${npcId}状态:${party?.status ?? 'unknown'}`,
      `缺料:${observation.missingMaterials.map((item) => item.itemName).join(',') || '无'}`,
    ],
  };
}

/** 阿林的维修观察快照（保持原有调用点不散落序列号语义）。 */
function repairObservation(game: GameState, sequence: number): CompetitionObservationSnapshot {
  const snapshot = npcObservation(game, 'alin', sequence, 'repair');
  // 维修侧额外公开态度与核料状态：这两条直接决定门槛，模型需要看得见。
  return {
    ...snapshot,
    recentFacts: [
      ...snapshot.recentFacts,
      `阿林态度:${observeBlackout(game).alinStance}`,
      `今日已核料:${verifiedToday(game) ? '是' : '否'}`,
    ],
  };
}

/**
 * 本章的维修策略。
 *
 * 信任门槛、材料配方、距离上限这些**数值裁决**只有这一份，validate 与
 * execute 共用它。以前场景自己写了一套 `validateRepair()`，等于在
 * `competitionRules` 旁边又立了一把尺子：预检说行、executor 说不行，
 * 两边一旦漂移就会出现「显示能修、点了没反应」。现在数值全交给
 * `validateCompetitionProposal`，场景只在 policy 里给出本章的取值。
 */
function repairPolicy(game: GameState): CompetitionRulesPolicy {
  return {
    // 闸门挂在阿林这一扇（塔楼主线），材料是本章的配方。
    repairMaterials: BLACKOUT_REPAIR_MATERIALS,
    repairNpcByGate: { [BLACKOUT_POWER_GATE_ID]: 'alin' },
    maxInteractionDistance: INTERACT_DISTANCE,
    // 门槛按阿林此刻的合作意愿给：合作 40 / 中立 55 / 谨慎 65。
    // executor 缺省是 demo 的 70，那是「陌生人对竞赛 demo」的数值，
    // 不适合本章已经有人情往来的关系。裁决权在本章，执行权在 executor。
    trustThresholds: { repair_gate: BLACKOUT_TRUST_FOR_STANCE[alinStanceOf(game)] },
    // executor 只负责「世界的物理变化」，信任分档由 finishRepairStory 按合作/
    // 中立/谨慎分别补，这里不额外加，避免两处各加一次。
    trustDeltas: { repair_gate: 0 },
  };
}

/**
 * executor 看不见的那几条剧情前置。
 *
 * 这里刻意**只**保留规则层表达不了的东西：阶段（危机有没有开始/了结）和
 * 「谨慎的人要先当面看见零件」。信任、材料、距离、闸门状态一概不在这里
 * 重复判断——那些由 `validateCompetitionProposal` 统一裁决，否则又变成
 * 「两套规则」。
 */
function repairPrecondition(game: GameState): BlackoutDetailCode {
  const stage = blackoutStageOf(game);
  if (stage === 'initial') return 'crisis_not_started';
  if (stage === 'resolved_repair' || stage === 'resolved_fail') return 'crisis_resolved';
  // 楼层/距离单独先判一次：executor 把「在楼上」和「站得远」合并成 too_far，
  // 但玩家需要知道到底是哪一种。
  const reach = reachability(game, 'alin');
  if (reach !== 'ok') return reach;
  return 'ok';
}

/** 谨慎态「先核料」：同一天有效，隔天要重新看。纯剧情规则，规则层没有这个概念。 */
function needsVerifyFirst(game: GameState): boolean {
  return alinStanceOf(game) === 'guarded' && !verifiedToday(game);
}

/** 把规则层的拒绝理由翻译成本章的对外 detail 码。 */
function detailFromRejection(reason: string, detailCode: string | undefined): BlackoutDetailCode {
  if (reason === 'low_trust') return 'low_trust';
  if (reason === 'missing_item') return 'missing_item';
  if (reason === 'too_far') return 'too_far';
  if (detailCode === 'gate_not_repairable') return 'crisis_resolved';
  if (detailCode === 'npc_unavailable') return 'npc_unavailable';
  return 'nothing_to_do';
}

/**
 * repair_gate：让阿林动手，走一遍完整的 observe → plan → propose → validate →
 * execute → feedback 循环。
 *
 * 「失败 → 重规划」是这里最要紧的一段：第一次提案被「材料不足」拒掉之后，
 * **不允许原样重试**。第二次改走 observe（重新看清世界），并把
 * `nextStep = request_help(缺什么)` 交还给调用方。这样玩家看到的不是
 * 「又失败了」，而是「他告诉你他缺什么」——反馈真的改变了下一步。
 */
export async function runBlackoutRepair(
  game: GameState,
  options: BlackoutRepairOptions = {},
): Promise<BlackoutRepairResult> {
  const before = repairObservation(game, 0).world;
  const steps: BlackoutRepairStep[] = [];
  let sequence = 1;
  let finalObservation = repairObservation(game, 0);
  let lastDetail: BlackoutDetailCode = 'ok';
  let utterance: string | null = null;

  const initialStage = blackoutStageOf(game);
  if (initialStage === 'resolved_repair') {
    const hash = await hashCompetitionWorldState(before);
    return {
      status: 'already_resolved', attempts: 0, detail: 'crisis_resolved',
      message: '主线已经接回去了。', steps, observation: finalObservation,
      before, after: before, beforeHash: hash, afterHash: hash, nextStep: null,
      decisionSource: 'offline-fallback', utterance: null,
    };
  }

  const modelPort = options.proposeWithModel;
  // 模型真的产出了提案 + 它真的被提交成功，才敢标 'model'。
  let modelProposed = false;
  // 「模型说不」与「模型挂了」必须分开记，否则拒绝语义形同虚设。
  let modelDeclinedToAct = false;
  // executor 的幂等账本。当前每次调用新建（A0 正在统一修复跨调用幂等），
  // 先按约定格式给 operationId，等 executor 改完一起迁移。
  const operationId = `blackout:${game.runSeed}:${game.day}:${game.gameMinuteOfDay}`;
  const liveExecutorState = executorState(game, before);

  const runtime = await runCompetitionStep({
    observe: async () => {
      finalObservation = repairObservation(game, sequence++);
      return finalObservation;
    },
    selectGoal: async () => ({
      goalId: BLACKOUT_POWER_GATE_ID,
      kind: 'custom',
      sinceDay: game.day,
      status: 'active',
      target: BLACKOUT_POWER_GATE_ID,
    }),
    plan: async (_observation, _goal, previousFeedback): Promise<CompetitionPlan> => {
      // 上一次被拒 → 不再原样再提一次维修，改成先重新观察。
      // 这就是「反馈修正」在代码里的样子：计划函数的输入里有上一轮的失败。
      if (previousFeedback) return { nextAction: 'observe' };
      return { nextAction: 'repair_gate' };
    },
    propose: async (observation, _goal, plan, previousFeedback): Promise<CompetitionActionProposal | null> => {
      if (modelPort) {
        // 模型模式不沿用离线那条「被拒就放弃」的规则：那条规则让「失败后重规划」
        // 在结构上不可能发生，而这正是评分点要看的。把重规划交给模型自己。
        if (!observation.availableActions.includes('repair_gate')) return null;
        const proposal = await modelPort({
          observation,
          materials: cloneStacks(BLACKOUT_REPAIR_MATERIALS),
          gateId: BLACKOUT_POWER_GATE_ID,
          previousFeedback,
        });
        // 走到这里说明模型正常应答。回 null 就是「我不动」，不是「我挂了」。
        if (!proposal) {
          modelDeclinedToAct = true;
          return null;
        }
        if (proposal.kind === 'repair_gate') modelProposed = true;
        return proposal;
      }
      if (plan.nextAction !== 'repair_gate' || previousFeedback) return null;
      if (!observation.availableActions.includes('repair_gate')) return null;
      return {
        kind: 'repair_gate',
        gateId: BLACKOUT_POWER_GATE_ID,
        // 提案里带的是配方原文；能不能用仍由规则层与 repairPolicy 独立裁决。
        materials: cloneStacks(BLACKOUT_REPAIR_MATERIALS),
      };
    },
    fallback: async (_observation, _goal, plan, reason) => {
      // 第四个参数是 reason（'no_proposal' | 'proposal_unavailable' |
      // 'proposal_error'），**不是**上一轮反馈。旧代码把它当 previousFeedback
      // 用，字符串恒真，导致 fallback 永远不执行——这条护栏曾经是死的。
      void reason;
      // 模型明确说了「我不动」——fallback 不许替它动，否则拒绝语义白说。
      if (modelDeclinedToAct) return null;
      // 模型挂了/超时：规则兜底，玩家仍能玩完，但 decisionSource 会如实标注。
      if (plan.nextAction !== 'repair_gate') return null;
      return {
        kind: 'repair_gate',
        gateId: BLACKOUT_POWER_GATE_ID,
        materials: cloneStacks(BLACKOUT_REPAIR_MATERIALS),
      };
    },
    validate: async (_observation, proposal) => {
      const precondition = repairPrecondition(game);
      if (precondition !== 'ok') {
        lastDetail = precondition;
        return {
          accepted: false,
          reason: precondition === 'wrong_floor' || precondition === 'too_far' ? 'too_far' : 'invalid_target',
          detailCode: `blackout:${precondition}`,
          expectedStateDelta: emptyCompetitionDelta(),
        };
      }
      // 信任 / 材料 / 距离 / 闸门状态全部由规则层裁决——与 execute 里的提交
      // 用的是同一个函数、同一份 policy，所以两边不可能给出不同答案。
      const checked = validateCompetitionProposal(liveExecutorState, proposal, repairPolicy(game));
      // 报错优先级要与旧行为一致：先告诉他「我不信你」，再说「你还没核料」，
      // 最后才是「你缺零件」。规则层本身也是信任先于材料，这里只是把
      // 剧情前置插在中间那一段。
      if (!checked.accepted && checked.reason === 'low_trust') {
        lastDetail = 'low_trust';
        return {
          accepted: false,
          reason: 'low_trust',
          detailCode: 'blackout:low_trust',
          expectedStateDelta: checked.expectedStateDelta,
        };
      }
      // 谨慎态要先核料：这是剧情前置，规则层不认识「核料」这件事。
      if (needsVerifyFirst(game)) {
        lastDetail = 'materials_unverified';
        return {
          accepted: false,
          reason: 'invalid_target',
          detailCode: 'blackout:materials_unverified',
          expectedStateDelta: emptyCompetitionDelta(),
        };
      }
      if (checked.accepted) {
        lastDetail = 'ok';
        return checked;
      }
      lastDetail = detailFromRejection(checked.reason, checked.detailCode);
      return {
        accepted: false,
        reason: checked.reason,
        detailCode: `blackout:${lastDetail}`,
        expectedStateDelta: checked.expectedStateDelta,
      };
    },
    execute: async (observation, proposal) => {
      // 观察与执行之间世界变了（玩家走开、材料被别处用掉）就不提交，
      // 让下一轮重新观察，而不是拿旧提案去改一个已经不同的世界。
      const current = repairObservation(game, sequence).world;
      if (serializeCompetitionWorldState(current) !== serializeCompetitionWorldState(observation.world)) {
        return { status: 'interrupted', actualStateDelta: null };
      }
      const recheck = repairPrecondition(game);
      if (recheck !== 'ok') {
        lastDetail = recheck;
        return { status: 'interrupted', actualStateDelta: null };
      }
      if (needsVerifyFirst(game)) {
        lastDetail = 'materials_unverified';
        return { status: 'interrupted', actualStateDelta: null };
      }
      // 唯一提交入口是 executeCompetitionProposal：它负责幂等键、staged 库存、
      // 先扣后加、闸门整体校验。绕开它等于在护栏旁边开一条没有护栏的路。
      const committed = executeCompetitionProposal(liveExecutorState, proposal, {
        operationId,
        policy: repairPolicy(game),
      });
      if (committed.status === 'duplicate') {
        // 同一 operationId 已经提交过：不能重复扣料，如实报告而不是假装成功。
        return { status: 'interrupted', actualStateDelta: null };
      }
      if (committed.status !== 'executed') {
        // executor 内部复跑了 competitionRules 的全套校验。它的拒绝理由比我们
        // 更保守（例如写死的 70 门槛），必须如实回传，不能伪装成成功。
        const detail = committed.validation.detailCode;
        if (detail === 'gate_not_repairable') lastDetail = 'crisis_resolved';
        else if (detail === 'npc_out_of_reach') lastDetail = 'too_far';
        else if (committed.validation.reason === 'missing_item') lastDetail = 'missing_item';
        else if (committed.validation.reason === 'low_trust') lastDetail = 'low_trust';
        return { status: 'failed', actualStateDelta: null };
      }
      // 物理变化已由 executor 提交；现在补剧情语义（stage / 承诺记忆 / kept）。
      const trustAfter = alinTrust(game);
      const story = atomic(game, () => { finishRepairStory(game, trustAfter); return true; });
      if (!story.ok) return { status: 'failed', actualStateDelta: null };
      return { status: 'completed', actualStateDelta: committed.actualStateDelta };
    },
    feedback: async (feedback: CompetitionAttemptFeedback) => {
      steps.push({
        attempt: feedback.attempt,
        kind: feedback.proposal?.kind ?? (feedback.outcome === 'validation_rejected' ? 'repair_gate' : 'observe'),
        outcome: feedback.outcome,
        ...(feedback.validation && !feedback.validation.accepted
          ? { detailCode: (feedback.validation.detailCode?.replace('blackout:', '') ?? feedback.validation.reason) as BlackoutDetailCode }
          : {}),
      });
    },
  }, { maxAttempts: options.maxAttempts ?? 2 });

  const after = repairObservation(game, sequence).world;
  const [beforeHash, afterHash] = await Promise.all([
    hashCompetitionWorldState(before),
    hashCompetitionWorldState(after),
  ]);

  const observation = observeBlackout(game);
  const nextStep = runtime.status === 'executed'
    ? null
    : {
        action: 'request_help' as const,
        npcId: 'alin' as const,
        missing: BLACKOUT_REPAIR_MATERIALS
          .filter((material) => !playerHas(game, material.itemId, material.quantity))
          .map((material) => material.itemId),
      };
  // runtime 在两轮都失败时会报 exhausted，但对玩家来说这就是「被规则拒绝」。
  // 只要有一轮是 validation_rejected，对外就必须是 blocked，而不是含糊的
  // 「用尽了」——后者会让 UI 显示成系统错误，而不是「你缺东西」。
  const rejected = steps.some((step) => step.outcome === 'validation_rejected');
  const status: BlackoutRepairStatus = runtime.status === 'executed'
    ? 'executed'
    : runtime.status === 'planning_failed'
      ? 'planning_failed'
      : rejected
        ? 'blocked'
        : 'exhausted';

  return {
    status,
    attempts: runtime.attempts,
    detail: lastDetail,
    message: repairMessage(status, lastDetail, observation),
    steps,
    observation: finalObservation,
    before,
    after,
    beforeHash,
    afterHash,
    nextStep,
    decisionSource: modelProposed && status === 'executed' ? 'model' : 'offline-fallback',
    utterance,
  };
}

function repairMessage(status: BlackoutRepairStatus, detail: BlackoutDetailCode, observation: BlackoutObservation): string {
  if (status === 'executed') return `主线接回去了，整栋楼恢复供电。${npcName('alin')}信任 +${observation.alinStance === 'cooperative' ? 8 : observation.alinStance === 'guarded' ? 2 : 4}。`;
  switch (detail) {
    case 'crisis_not_started': return '现在还没停电。';
    case 'crisis_resolved': return '这次停电已经有结果了。';
    case 'wrong_floor': return `阿林在${getNpc('alin').floor}楼。`;
    case 'too_far': return '走近阿林再说。';
    case 'missing_item': {
      const missing = observation.missingMaterials.map((item) => item.itemName).join('、');
      return `零件不齐，他没动。还缺${missing || '零件'}。`;
    }
    case 'low_trust': return `他还不信你（${observation.alinTrust}/${BLACKOUT_TRUST_FOR_STANCE[observation.alinStance]}）。`;
    case 'materials_unverified': return '他上次等了你一场空，这次要先当面看见零件。';
    default: return '这次没提交任何改动。';
  }
}

// ── 小工具（库存数组）──────────────────────────────────────────────────────

function countItemArray(items: readonly InventoryStack[], itemId: ItemId): number {
  return items.reduce((total, stack) => total + (stack.itemId === itemId ? stack.quantity : 0), 0);
}

function removeFromArray(items: readonly InventoryStack[], itemId: ItemId, quantity: number): InventoryStack[] {
  let remaining = quantity;
  const next: InventoryStack[] = [];
  for (const stack of items) {
    if (stack.itemId !== itemId || remaining === 0) {
      next.push({ ...stack });
      continue;
    }
    const taken = Math.min(stack.quantity, remaining);
    remaining -= taken;
    if (stack.quantity - taken > 0) next.push({ ...stack, quantity: stack.quantity - taken });
  }
  return next;
}

/** 给测试与 UI 用的只读常量，避免外部硬编码同一个 id。 */
export const BLACKOUT_GATE = Object.freeze({
  gateId: BLACKOUT_POWER_GATE_ID,
  /** 与 ALIN_REPAIR_GATE_ID 必须不同：那道门是本章的前置条件。 */
  prerequisiteGateId: ALIN_REPAIR_GATE_ID,
  stageIndex: BLACKOUT_STAGE_INDEX,
  deadlineDays: BLACKOUT_DEADLINE_DAYS,
  alinGateIdIsPrerequisite: true,
});

// ── 小周 / 阿珍的模型端口 ───────────────────────────────────────────────────

/**
 * 用真实的前后库存差构造差量，而不是把「提案里想写的东西」当结果回传。
 *
 * 为什么必须这样：交易/赠礼的**实际到账数量由 NPC 存货封顶**（阿珍没有面包
 * 时只能给 0 份），提案里写的是上限不是事实。如果直接把 expectedStateDelta
 * 当成 actualStateDelta，轨迹里就会记下一笔没真正发生的物品转移——那是在
 * 审计数据上造假。
 */
function diffInventory(
  before: readonly { readonly owner: 'player' | NpcId; readonly stacks: readonly InventoryStack[] }[],
  after: readonly { readonly owner: 'player' | NpcId; readonly stacks: readonly InventoryStack[] }[],
): CompetitionStateDelta['inventory'] {
  const key = (owner: 'player' | NpcId, itemId: ItemId) => `${owner}\u0000${itemId}`;
  const totals = (rows: readonly { readonly owner: 'player' | NpcId; readonly stacks: readonly InventoryStack[] }[]) => {
    const map = new Map<string, { owner: 'player' | NpcId; itemId: ItemId; quantity: number }>();
    for (const row of rows) {
      for (const stack of row.stacks) {
        const id = key(row.owner, stack.itemId);
        const prior = map.get(id);
        if (prior) prior.quantity += stack.quantity;
        else map.set(id, { owner: row.owner, itemId: stack.itemId, quantity: stack.quantity });
      }
    }
    return map;
  };
  const beforeTotals = totals(before);
  const afterTotals = totals(after);
  const out: { owner: 'player' | { readonly kind: 'npc'; readonly npcId: string }; itemId: ItemId; quantityDelta: number }[] = [];
  for (const id of new Set([...beforeTotals.keys(), ...afterTotals.keys()])) {
    const prior = beforeTotals.get(id)?.quantity ?? 0;
    const next = afterTotals.get(id)?.quantity ?? 0;
    if (prior === next) continue;
    const entry = afterTotals.get(id) ?? beforeTotals.get(id)!;
    out.push({
      owner: entry.owner === 'player' ? 'player' : { kind: 'npc', npcId: entry.owner },
      itemId: entry.itemId,
      quantityDelta: next - prior,
    });
  }
  return out;
}

/** 抓一份「玩家 + 指定居民」的库存快照，供差量对账。 */
function inventorySnapshotOf(game: GameState, npcId: NpcId): { owner: 'player' | NpcId; stacks: readonly InventoryStack[] }[] {
  return [
    { owner: 'player', stacks: cloneStacks(game.player.inventory.slots) },
    { owner: npcId, stacks: loadNpcInventory(game, npcId) },
  ];
}

/**
 * 交易侧的一次模型驱动步骤：让模型在**既有价目表里选一笔**。
 *
 * 为什么交易不直接进 executor：executor 的 trade 分支要求「双边摆在同一份
 * 提案里」，而本场景小周的成交价与库存分布在场景数据里（还会影响他的记忆与
 * 后续供货），硬迁进通用执行器会把场景语义漏进通用层。所以这里的做法是：
 *   - 模型负责「选哪一笔」（决策，这正是 AI 原生能力要展示的）
 *   - 结算仍走已验证的 `tradeWithXiaozhou`（规则，防刷、防错账）
 * 这与阿林那边「模型提案 + validator 独立裁决」是同一条边界，只是裁决与
 * 结算的实现落点不同。
 *
 * 返回 null 的语义与维修口一致：模型说了「不做」，fallback 不许替它做。
 */
export interface BlackoutTradeRunResult {
  readonly status: 'executed' | 'blocked' | 'exhausted';
  readonly decisionSource: BlackoutDecisionSource;
  /** 模型选中（或被规则兜底选中）的那笔报价 id；没成交则为 null。 */
  readonly offerId: string | null;
  readonly action: BlackoutActionResult | null;
  readonly attempts: number;
  readonly steps: readonly BlackoutRepairStep[];
}

/**
 * 让小周按模型决策成交一笔。
 *
 * 模型只能在 `BLACKOUT_XIAOZHOU_OFFERS` 里挑 id；挑到不存在的 id 或他自己
 * 库存不足的报价，都交给 `tradeWithXiaozhou` 如实拒绝——模型不能因为「想卖」
 * 就凭空变出库存。这条约束和维修侧「模型改不动配方」是同一个原则。
 */
export async function runXiaozhouTrade(
  game: GameState,
  options: { readonly proposeWithModel?: BlackoutTradeModelPort; readonly maxAttempts?: number } = {},
): Promise<BlackoutTradeRunResult> {
  const steps: BlackoutRepairStep[] = [];
  let sequence = 1;
  let finalObservation = npcObservation(game, 'xiaozhou', 0, 'trade');
  let chosen: string | null = null;
  let executed: BlackoutActionResult | null = null;
  const modelPort = options.proposeWithModel;
  let modelProposed = false;
  let modelDeclinedToAct = false;

  const runtime = await runCompetitionStep({
    observe: async () => {
      finalObservation = npcObservation(game, 'xiaozhou', sequence++, 'trade');
      return finalObservation;
    },
    selectGoal: async () => ({
      goalId: BLACKOUT_POWER_GATE_ID,
      kind: 'custom',
      sinceDay: game.day,
      status: 'active',
      target: BLACKOUT_POWER_GATE_ID,
    }),
    plan: async (_observation, _goal, previousFeedback): Promise<CompetitionPlan> => {
      // 上一次被拒（没钱/没货）→ 不再原样重试，改成重新看清行情。
      if (previousFeedback) return { nextAction: 'observe' };
      return { nextAction: 'trade' };
    },
    propose: async (observation, _goal, plan, previousFeedback): Promise<CompetitionActionProposal | null> => {
      if (modelPort) {
        if (!observation.availableActions.includes('trade')) return null;
        const proposal = await modelPort({
          observation,
          offers: BLACKOUT_XIAOZHOU_OFFERS,
          npcId: 'xiaozhou',
          previousFeedback,
        });
        if (!proposal) {
          modelDeclinedToAct = true;
          return null;
        }
        if (proposal.kind === 'trade') modelProposed = true;
        return proposal;
      }
      if (plan.nextAction !== 'trade' || previousFeedback) return null;
      // 规则脑：按报价顺序挑第一笔玩家付得起、他也还有货的。
      const affordable = BLACKOUT_XIAOZHOU_OFFERS.find((offer) =>
        playerHas(game, offer.price.itemId, offer.price.quantity) &&
        countItemArray(loadNpcInventory(game, 'xiaozhou'), offer.partId) >= offer.quantity);
      if (!affordable) return null;
      return {
        kind: 'trade',
        npcId: 'xiaozhou',
        playerGives: { from: 'player', to: { kind: 'npc', npcId: 'xiaozhou' }, itemId: affordable.price.itemId, quantity: affordable.price.quantity },
        playerReceives: { from: { kind: 'npc', npcId: 'xiaozhou' }, to: 'player', itemId: affordable.partId, quantity: affordable.quantity },
      };
    },
    fallback: async (_observation, _goal, plan, reason) => {
      // 第 4 参是 reason，不是上一轮反馈——判别只靠显式标志。
      void reason;
      if (modelDeclinedToAct) return null;
      if (plan.nextAction !== 'trade') return null;
      const affordable = BLACKOUT_XIAOZHOU_OFFERS.find((offer) =>
        playerHas(game, offer.price.itemId, offer.price.quantity) &&
        countItemArray(loadNpcInventory(game, 'xiaozhou'), offer.partId) >= offer.quantity);
      if (!affordable) return null;
      return {
        kind: 'trade',
        npcId: 'xiaozhou',
        playerGives: { from: 'player', to: { kind: 'npc', npcId: 'xiaozhou' }, itemId: affordable.price.itemId, quantity: affordable.price.quantity },
        playerReceives: { from: { kind: 'npc', npcId: 'xiaozhou' }, to: 'player', itemId: affordable.partId, quantity: affordable.quantity },
      };
    },
    validate: async (_observation, proposal) => {
      if (proposal.kind !== 'trade' || proposal.npcId !== 'xiaozhou') {
        return {
          accepted: false, reason: 'invalid_target', detailCode: 'blackout:unknown_offer',
          expectedStateDelta: {
            inventory: [], trust: [], relationships: [], memoryAdded: [], flags: [], hp: [], positions: [], gateStatus: [], elapsedMinutes: 0,
          },
        };
      }
      // 模型给的是「物品组合」，场景要以**报价 id** 结算；对不上任何一条报价就拒绝。
      const offer = BLACKOUT_XIAOZHOU_OFFERS.find((item) =>
        item.partId === proposal.playerReceives.itemId &&
        item.price.itemId === proposal.playerGives.itemId);
      if (!offer) {
        return {
          accepted: false, reason: 'invalid_target', detailCode: 'blackout:unknown_offer',
          expectedStateDelta: {
            inventory: [], trust: [], relationships: [], memoryAdded: [], flags: [], hp: [], positions: [], gateStatus: [], elapsedMinutes: 0,
          },
        };
      }
      chosen = offer.id;
      return {
        accepted: true,
        reason: 'ok',
        expectedStateDelta: {
          inventory: [
            { owner: 'player' as const, itemId: offer.price.itemId, quantityDelta: -offer.price.quantity },
            { owner: { kind: 'npc' as const, npcId: 'xiaozhou' }, itemId: offer.price.itemId, quantityDelta: offer.price.quantity },
            { owner: { kind: 'npc' as const, npcId: 'xiaozhou' }, itemId: offer.partId, quantityDelta: -offer.quantity },
            { owner: 'player' as const, itemId: offer.partId, quantityDelta: offer.quantity },
          ],
          trust: [], relationships: [], memoryAdded: [], flags: [], hp: [], positions: [], gateStatus: [], elapsedMinutes: 0,
        },
      };
    },
    execute: async () => {
      // 结算走已验证的场景函数：它自己会复查距离、库存、背包容量并原子落库。
      const before = inventorySnapshotOf(game, 'xiaozhou');
      const action = tradeWithXiaozhou(game, chosen ?? '');
      executed = action;
      if (!action.ok) return { status: 'failed', actualStateDelta: null };
      return {
        status: 'completed',
        // 对账而不是抄提案：实际扣了多少、到手多少，以落库后的库存为准。
        actualStateDelta: {
          inventory: diffInventory(before, inventorySnapshotOf(game, 'xiaozhou')),
          trust: [], relationships: [], memoryAdded: [], flags: [], hp: [], positions: [], gateStatus: [], elapsedMinutes: 0,
        },
      };
    },
    feedback: async (feedback: CompetitionAttemptFeedback) => {
      steps.push({
        attempt: feedback.attempt,
        kind: 'trade',
        outcome: feedback.outcome,
        ...(feedback.validation && !feedback.validation.accepted
          ? { detailCode: (feedback.validation.detailCode?.replace('blackout:', '') ?? feedback.validation.reason) as BlackoutDetailCode }
          : {}),
      });
    },
  }, { maxAttempts: options.maxAttempts ?? 2 });

  const status = runtime.status === 'executed'
    ? 'executed'
    : steps.some((step) => step.outcome === 'validation_rejected') ? 'blocked' : 'exhausted';

  return {
    status,
    decisionSource: modelProposed && status === 'executed' ? 'model' : 'offline-fallback',
    offerId: chosen,
    action: executed,
    attempts: runtime.attempts,
    steps,
  };
}

/**
 * 让阿珍按模型决策决定「收不收水、换不换口粮」。
 *
 * 与维修/交易共享同一条红线：模型的回答只是「提议」，真实的库存扣除与回礼
 * 数量仍由 `giveWaterToAzhen` 按她自己的存货核算——模型不能承诺她没有的东西。
 */
export async function runAzhenExchange(
  game: GameState,
  options: { readonly proposeWithModel?: BlackoutTradeModelPort; readonly maxAttempts?: number } = {},
): Promise<BlackoutTradeRunResult> {
  const steps: BlackoutRepairStep[] = [];
  let sequence = 1;
  let finalObservation = npcObservation(game, 'azhen', 0, 'trade');
  let executed: BlackoutActionResult | null = null;
  const modelPort = options.proposeWithModel;
  let modelProposed = false;
  let modelDeclinedToAct = false;

  const proposalFor = (): CompetitionActionProposal => ({
    kind: 'trade',
    npcId: 'azhen',
    playerGives: { from: 'player', to: { kind: 'npc', npcId: 'azhen' }, itemId: BLACKOUT_AZHEN_WATER.itemId, quantity: BLACKOUT_AZHEN_WATER.quantity },
    playerReceives: { from: { kind: 'npc', npcId: 'azhen' }, to: 'player', itemId: BLACKOUT_AZHEN_REWARD.itemId, quantity: BLACKOUT_AZHEN_REWARD.quantity },
  });

  const runtime = await runCompetitionStep({
    observe: async () => {
      finalObservation = npcObservation(game, 'azhen', sequence++, 'trade');
      return finalObservation;
    },
    selectGoal: async () => ({
      goalId: BLACKOUT_POWER_GATE_ID,
      kind: 'custom',
      sinceDay: game.day,
      status: 'active',
      target: BLACKOUT_POWER_GATE_ID,
    }),
    plan: async (_observation, _goal, previousFeedback): Promise<CompetitionPlan> => {
      if (previousFeedback) return { nextAction: 'observe' };
      return { nextAction: 'trade' };
    },
    propose: async (observation, _goal, plan, previousFeedback): Promise<CompetitionActionProposal | null> => {
      if (modelPort) {
        if (!observation.availableActions.includes('trade')) return null;
        const proposal = await modelPort({
          observation,
          offers: [{
            id: 'azhen-water',
            partId: BLACKOUT_AZHEN_WATER.itemId,
            quantity: BLACKOUT_AZHEN_WATER.quantity,
            price: BLACKOUT_AZHEN_REWARD,
          }],
          npcId: 'azhen',
          previousFeedback,
        });
        if (!proposal) {
          modelDeclinedToAct = true;
          return null;
        }
        if (proposal.kind === 'trade') modelProposed = true;
        return proposal;
      }
      if (plan.nextAction !== 'trade' || previousFeedback) return null;
      return proposalFor();
    },
    fallback: async (_observation, _goal, plan, reason) => {
      void reason;
      if (modelDeclinedToAct) return null;
      if (plan.nextAction !== 'trade') return null;
      return proposalFor();
    },
    validate: async (_observation, proposal) => {
      if (proposal.kind !== 'trade' || proposal.npcId !== 'azhen') {
        return {
          accepted: false, reason: 'invalid_target', detailCode: 'blackout:unknown_offer',
          expectedStateDelta: {
            inventory: [], trust: [], relationships: [], memoryAdded: [], flags: [], hp: [], positions: [], gateStatus: [], elapsedMinutes: 0,
          },
        };
      }
      return {
        accepted: true,
        reason: 'ok',
        expectedStateDelta: {
          inventory: [
            { owner: 'player' as const, itemId: BLACKOUT_AZHEN_WATER.itemId, quantityDelta: -BLACKOUT_AZHEN_WATER.quantity },
            { owner: { kind: 'npc' as const, npcId: 'azhen' }, itemId: BLACKOUT_AZHEN_WATER.itemId, quantityDelta: BLACKOUT_AZHEN_WATER.quantity },
          ],
          trust: [], relationships: [], memoryAdded: [], flags: [], hp: [], positions: [], gateStatus: [], elapsedMinutes: 0,
        },
      };
    },
    execute: async () => {
      // 回礼数量必须按她的真实存货算，所以由场景函数裁决，不由提案里的数字决定。
      const before = inventorySnapshotOf(game, 'azhen');
      const action = giveWaterToAzhen(game);
      executed = action;
      if (!action.ok) return { status: 'failed', actualStateDelta: null };
      return {
        status: 'completed',
        actualStateDelta: {
          inventory: diffInventory(before, inventorySnapshotOf(game, 'azhen')),
          trust: [], relationships: [], memoryAdded: [], flags: [], hp: [], positions: [], gateStatus: [], elapsedMinutes: 0,
        },
      };
    },
    feedback: async (feedback: CompetitionAttemptFeedback) => {
      steps.push({
        attempt: feedback.attempt,
        kind: 'trade',
        outcome: feedback.outcome,
        ...(feedback.validation && !feedback.validation.accepted
          ? { detailCode: (feedback.validation.detailCode?.replace('blackout:', '') ?? feedback.validation.reason) as BlackoutDetailCode }
          : {}),
      });
    },
  }, { maxAttempts: options.maxAttempts ?? 2 });

  const status = runtime.status === 'executed'
    ? 'executed'
    : steps.some((step) => step.outcome === 'validation_rejected') ? 'blocked' : 'exhausted';

  return {
    status,
    decisionSource: modelProposed && status === 'executed' ? 'model' : 'offline-fallback',
    offerId: executed ? 'azhen-water' : null,
    action: executed,
    attempts: runtime.attempts,
    steps,
  };
}

/** 本模块没有被 GameScene 直接依赖，这里显式导出给 A0 接线的入口清单。 */
// ── 接线路由（给 GameScene 用，纯函数便于测试）──────────────────────────────

/**
 * 危机是不是「正在进行中」。
 *
 * 只有夹在中间的阶段算进行中：`initial` 是还没开始（玩家该看到原来的通用
 * 对话），两个 `resolved_*` 是已经了结（再看就是事后复盘）。
 *
 * 单独抽成纯函数而不是写在 GameScene 里，是因为场景类依赖 Phaser 与 window，
 * 在 node 测试环境里根本 import 不了——路由判定要是留在类里，就只能靠 E2E
 * 断言，而 E2E 跑不到「危机期」这种需要先推进剧情的状态。抽出来之后，三条
 * 分支（危机期走维修/危机期走交易/非危机期走原路径）都能在单测里逐个钉住。
 */
export function isBlackoutActive(game: GameState): boolean {
  const stage = blackoutStageOf(game);
  return stage !== 'initial' && stage !== 'resolved_repair' && stage !== 'resolved_fail';
}

/** 玩家和阿林说话时该走哪个场景。 */
export type BlackoutAlinRoute = 'blackout' | 'legacy-repair';

/**
 * 阿林选项 1 的路由。
 *
 * 危机进行中 → 首章主线（`runBlackoutRepair`）；否则 → 原来的维修门演示
 * （`runAlinRepairPlan`）。两条路都以 `executeCompetitionProposal` 为唯一
 * 提交入口，差别只在外层叙事：一个讲「接回塔楼主线」，一个讲「开这扇门」。
 */
export function blackoutAlinRoute(game: GameState): BlackoutAlinRoute {
  return isBlackoutActive(game) ? 'blackout' : 'legacy-repair';
}

/** 玩家和小周/阿珍谈交易时该走哪个场景。 */
export type BlackoutTradeRoute = 'blackout' | 'legacy-trade';

/**
 * 小周/阿珍交易的路由。
 *
 * 危机进行中 → 走「模型选价 → 规则结算」（`runXiaozhouTrade` /
 * `runAzhenExchange`）；否则 → 原来的通用交易。只有危机期间这两个人才有
 * 「在停电这件事上表态」的语义，非危机期硬塞只会让普通买卖多绕一层。
 */
export function blackoutTradeRoute(game: GameState, npcId: NpcId): BlackoutTradeRoute {
  if (!isBlackoutActive(game)) return 'legacy-trade';
  return npcId === 'xiaozhou' || npcId === 'azhen' ? 'blackout' : 'legacy-trade';
}

/** 阿林对话选项 1 的标签。位置固定为索引 1（E2E 依赖），只换文字。 */
export function blackoutAlinOptionLabel(game: GameState): string {
  return isBlackoutActive(game) ? '接回主线' : '维修门计划';
}

/**
 * 按路由结果分发到具体处理器。
 *
 * 为什么要多这一层：只测 `blackoutAlinRoute` 的返回值，证明不了 GameScene
 * 真的照着走了——一个「路由返回 blackout、代码却仍调 runAlinRepairPlan」的
 * 实现能让那些用例全绿。把分发本身做成接受回调的纯函数，测试就能传两个
 * spy 进去，直接断言**哪一个被调用**。GameScene 那边只剩三行接线。
 */
export function dispatchBlackoutAlin(
  game: GameState,
  handlers: { readonly blackout: () => void; readonly legacy: () => void },
): BlackoutAlinRoute {
  const route = blackoutAlinRoute(game);
  if (route === 'blackout') handlers.blackout();
  else handlers.legacy();
  return route;
}

/** 按路由结果分发交易处理器；同样是为了让「调了哪个」可被直接断言。 */
export function dispatchBlackoutTrade(
  game: GameState,
  npcId: NpcId,
  handlers: { readonly blackout: () => void; readonly legacy: () => void },
): BlackoutTradeRoute {
  const route = blackoutTradeRoute(game, npcId);
  if (route === 'blackout') handlers.blackout();
  else handlers.legacy();
  return route;
}

export { isBlackoutResolved, BLACKOUT_DEADLINE_DAYS };