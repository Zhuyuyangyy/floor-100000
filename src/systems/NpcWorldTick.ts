// NPC 自主 tick：世界事件驱动的居民自主行为。
//
// 这个模块回答的是 AI-06 那一问：**居民不是只在玩家按 E 时才会行动。**
//
// 三个设计红线（评审会盯）：
// 1. 触发必须是**世界事件**，不是玩家输入。触发源只有两个：停电危机的阶段变化
//    （`blackoutStageOf` 变了）与游戏小时边界（跨过整点）。玩家按 E 走的是
//    另一条路（`scenarios/*` 里的场景函数），与本模块无关。
// 2. 模型只提案，规则裁决，执行器提交。自主行动走的是与交易/维修**同一条**
//    `runCompetitionStep` 链路（提案 → 校验 → 执行 → 反馈），模型碰不到库存、
//    门禁与 flag；模型不可用时如实降级为 `offline-fallback`，绝不冒充模型。
// 3. **不许每帧调用模型。** 节流：两次自主回合之间至少隔一个游戏小时
//    （`NPC_AUTONOMY_MIN_INTERVAL_MINUTES`）；同一 NPC 同一阶段最多一次
//    （`once:` flag），所以最坏情况是每 NPC 每阶段一次模型请求。
//
// 幂等标记落在 flag 上（见 `systems/WorldFlags.ts`）：存档里带着，刷新或换场景
// 之后「这件事已经做过了」这件事不会丢，重复触发不会再执行、不会再扣一次库存。

import { runCompetitionStep, type CompetitionAttemptFeedback, type CompetitionPlan } from '../ai/competitionRuntime';
import type {
  CompetitionActionKind,
  CompetitionActionProposal,
  CompetitionGoalSnapshot,
  CompetitionNpcMemoryEntry,
  CompetitionNpcStateSnapshot,
  CompetitionObservationSnapshot,
  CompetitionStateDelta,
  CompetitionValidationReason,
  CompetitionValidationResult,
  CompetitionWorldStateSnapshot,
} from '../ai/competition-contract';
import { competitionTraceSha256 } from '../ai/competitionTrace';
import { COMPETITION_TRUST_BASE } from '../ai/competitionRules';
import type { GameState, InventoryStack, ItemId } from '../core/gameTypes';
import {
  BLACKOUT_AZHEN_REWARD,
  BLACKOUT_AZHEN_THANKS,
  BLACKOUT_PARTIES,
  BLACKOUT_POWER_GATE_ID,
  BLACKOUT_REPAIR_MATERIALS,
  BLACKOUT_XIAOZHOU_OFFERS,
  blackoutStageOf,
  isBlackoutPowerRestored,
  type BlackoutStage,
} from '../data/blackoutCrisis';
import { getItem, isItemId } from '../data/items';
import { getNpc, type NpcId } from '../data/npcs';
import { createNpcStateFor } from '../data/npcPersonalities';
import { addItem } from './InventorySystem';
import { loadNpcInventory, saveNpcInventory } from './NpcInventory';
import { loadNpcState, recordMemory, saveNpcState } from './NpcMemory';
import {
  createCompetitionNpcMemoryId,
  loadCompetitionNpcMemory,
  saveCompetitionNpcMemory,
} from './CompetitionNpcMemoryStore';
import { flagCount, flagKey, setFlag } from './WorldFlags';

// ── 契约 ────────────────────────────────────────────────────────────────────

/**
 * 谁发起的这次行动。
 *
 * 枚举值由本模块定义（runtime owner = A3 场景集成），但语义必须与任务卡一致：
 * 只有世界自己触发的那条路才写 `world_tick`。玩家按 E 的路径写的是 `player`，
 * 两条路在存档与 Judge Mode 里能区分开。
 */
export const NPC_AUTONOMY_ACTOR = 'world_tick' as const;
export type NpcAutonomyActor = typeof NPC_AUTONOMY_ACTOR;

/** 世界事件的种类。两个来源都不是玩家输入。 */
export type NpcAutonomyTrigger = 'blackout_stage' | 'hour_boundary';

/** 居民可以自主提出的白名单动作。 */
export const NPC_AUTONOMY_ACTION_KINDS = ['protect_supplies', 'request_help', 'repair_prep'] as const;
export type NpcAutonomyActionKind = (typeof NPC_AUTONOMY_ACTION_KINDS)[number];

/**
 * 决策来源。只有「模型真的产出了提案」且「它被提交成功」同时成立才是 `model`。
 * 模型不可用、模型说不动、提案被规则拒绝，全部如实标成 `offline-fallback`。
 */
export type NpcAutonomyDecisionSource = 'model' | 'offline-fallback';

/** 一次自主提案。模型只能提这些，且只能提**意图**，不能自己改库存或门禁。 */
export interface NpcAutonomyProposal {
  readonly kind: NpcAutonomyActionKind;
  readonly npcId: NpcId;
  /** protect_supplies 专用：居民要交出去的货。 */
  readonly itemId?: ItemId;
  readonly quantity?: number;
  /** 模型说给玩家听的话。只展示，不参与裁决。 */
  readonly utterance?: string;
}

/** 送给模型看的输入：只读，不含任何可写句柄。 */
export interface NpcAutonomyModelInput {
  readonly observation: CompetitionObservationSnapshot;
  readonly npcId: NpcId;
  readonly stage: BlackoutStage;
  /** 这位居民自己看到的库存、目标与信任。 */
  readonly self: {
    readonly inventory: readonly InventoryStack[];
    readonly goal: string;
    readonly trust: number;
    readonly memory: readonly string[];
  };
  readonly previousFeedback: CompetitionAttemptFeedback | null;
}

/**
 * 模型提案口。
 *
 * 返回 null 的语义要分清：
 * - 模型明确「我不动」→ 规则降级**不许**替它做（与 A4 的交易口同一条纪律）；
 * - 模型挂了/超时/答非所问 → 规则降级接管，产出标成 `offline-fallback`。
 */
export type NpcAutonomyModelPort = (input: NpcAutonomyModelInput) => Promise<NpcAutonomyProposal | null>;

/** 一位居民这一轮的结果。 */
export interface NpcAutonomyOutcome {
  readonly npcId: NpcId;
  readonly actor: NpcAutonomyActor;
  /** 真正落地的动作；这一轮没动就是 null。 */
  readonly action: NpcAutonomyActionKind | null;
  readonly status: 'executed' | 'rejected' | 'declined' | 'skipped';
  readonly decisionSource: NpcAutonomyDecisionSource;
  readonly reason: string;
  /** 提案所依据的世界版本；执行前会复核，不一致就作废。 */
  readonly worldRevision: string;
  /** 执行前后的库存快照（对账用，玩家/NPC 两侧）。 */
  readonly playerInventoryBefore: readonly InventoryStack[];
  readonly playerInventoryAfter: readonly InventoryStack[];
  readonly npcInventoryBefore: readonly InventoryStack[];
  readonly npcInventoryAfter: readonly InventoryStack[];
  /** 实际发生的差量（以落库后的库存为准，不抄提案）。 */
  readonly stateDelta: CompetitionStateDelta | null;
  /** 模型给的台词（如果有）。 */
  readonly utterance: string | null;
}

/** 一轮自主 tick 的整体结果。 */
export interface NpcAutonomyResult {
  readonly actor: NpcAutonomyActor;
  readonly trigger: NpcAutonomyTrigger;
  readonly stage: BlackoutStage;
  readonly status: 'executed' | 'no_action' | 'throttled' | 'no_trigger';
  readonly decisionSource: NpcAutonomyDecisionSource;
  readonly revisionBefore: string;
  readonly revisionAfter: string;
  readonly outcomes: readonly NpcAutonomyOutcome[];
  /** 这一轮一共向模型要了几次决策（= 调用次数上限的直接证据）。 */
  readonly modelCalls: number;
}

/** 触发检测用的游标。场景把它存在内存里，刷新后重新初始化即可。 */
export interface NpcAutonomyCursor {
  readonly stage: BlackoutStage;
  readonly hour: number;
}

export interface NpcAutonomyOptions {
  /** 模型提案口。不传就完全走规则脑（产出标成 offline-fallback）。 */
  readonly proposeWithModel?: NpcAutonomyModelPort;
  /** 上一次的游标。缺省表示「第一次看这个世界」。 */
  readonly cursor?: NpcAutonomyCursor;
  /** 两次自主回合之间的最小间隔（游戏分钟）。 */
  readonly minIntervalMinutes?: number;
  /** 本轮要唤醒的居民。缺省是停电危机里的三位。 */
  readonly residents?: readonly NpcId[];
  /** 单个居民的最大尝试次数（含第一次）。 */
  readonly maxAttempts?: number;
}

export interface NpcAutonomyRun {
  readonly result: NpcAutonomyResult;
  /** 更新后的游标；只有在真的跑了一轮之后才推进。 */
  readonly cursor: NpcAutonomyCursor;
}

// ── flag 命名 ───────────────────────────────────────────────────────────────

/**
 * 自主 tick 的持久标记。
 *
 * - `handled`：同一 NPC 同一阶段最多一次。用 `once:` 前缀，因为它的语义就是
 *   「第一次写入者赢」——这正是 WorldFlags 的 `once()` 提供的原子语义。
 * - 其余是可变计数（flag 本来就能带计数：0 或缺省表示未设置）。
 */
export const NPC_AUTONOMY_FLAG = {
  handled: (npcId: NpcId, stage: BlackoutStage): string => flagKey.once(`autonomy:${npcId}:${stage}`),
  /** 上一轮自主 tick 的绝对游戏分钟（节流用）。 */
  lastRoundMinute: 'autonomy:last-round-minute',
  /** 某位居民某件物资被自主保管的数量（对账用）。 */
  protectedCount: (npcId: NpcId, itemId: ItemId): string => `autonomy:protected:${npcId}:${itemId}`,
} as const;

/** 两次自主回合之间的最小间隔：默认一个游戏小时。 */
export const NPC_AUTONOMY_MIN_INTERVAL_MINUTES = 60;

/** 居民名单：停电危机里三位有委托、库存与目标的人。 */
export const NPC_AUTONOMY_RESIDENTS: readonly NpcId[] = ['alin', 'azhen', 'xiaozhou'];

// ── 契约动作映射 ────────────────────────────────────────────────────────────

/**
 * 自主动作 → A1 统一契约里的动作标签。
 *
 * 为什么不用自造标签：契约（`ai/competition-contract.ts`）是全项目唯一的动作
 * 白名单，模型能说的、validator 认的都是它。自主行为必须落在同一套标签里，
 * 否则就等于在契约之外开了一条旁路——那正是「不许绕过规则」要防的事。
 *
 * - protect_supplies → give：居民把货交给玩家保管（契约里 give 的方向语义是
 *   「谁给谁」，NPC→玩家 由 from/to 显式区分）。
 * - request_help → ask：居民开口求助。
 * - repair_prep → inspect：居民清点维修目标，为动手做准备（**不是**修）。
 */
const CONTRACT_KIND_BY_ACTION: Readonly<Record<NpcAutonomyActionKind, CompetitionActionKind>> = {
  protect_supplies: 'give',
  request_help: 'ask',
  repair_prep: 'inspect',
};

/** 契约标签 → 自主动作。不在表里的标签一律不是自主动作。 */
function actionOfContractKind(kind: CompetitionActionKind): NpcAutonomyActionKind | null {
  for (const [action, contractKind] of Object.entries(CONTRACT_KIND_BY_ACTION) as [NpcAutonomyActionKind, CompetitionActionKind][]) {
    if (contractKind === kind) return action;
  }
  return null;
}

// ── 小工具 ──────────────────────────────────────────────────────────────────

function cloneStacks(stacks: readonly InventoryStack[]): InventoryStack[] {
  return stacks.map((stack) => ({ ...stack, ...(stack.meta ? { meta: { ...stack.meta } } : {}) }));
}

function emptyDelta(): CompetitionStateDelta {
  return {
    inventory: [], trust: [], relationships: [], memoryAdded: [], flags: [], hp: [], positions: [], gateStatus: [], elapsedMinutes: 0,
  };
}

/** 绝对游戏分钟：从第 1 天 00:00 起算，用来跨天做节流比较。 */
export function absoluteGameMinute(state: GameState): number {
  return (state.day - 1) * 1440 + Math.floor(state.gameMinuteOfDay);
}

function hourOf(state: GameState): number {
  return Math.floor(state.gameMinuteOfDay / 60);
}

function playerInventoryOf(state: GameState): InventoryStack[] {
  return cloneStacks(state.player.inventory.slots);
}

/**
 * 这些货正在危机里与玩家做交易，或者就是给玩家的回报。
 *
 * 自主行为**不许**把它们白送出去：小周的保险丝是主线的第二条来源，阿珍的面包
 * 是净水换口粮的代价。自主行动把这两样交出去，等于替玩家把本章的资源分配题
 * 解掉了——那不是「AI 帮玩家」，那是「AI 抄了答案」。
 */
function crisisGoods(): ReadonlySet<ItemId> {
  const ids = new Set<ItemId>();
  // 只挡**居民自己持有、且玩家该付代价才能拿到**的货：报价里的零件、危机
  // 报酬里的口粮。报价的「价格项」是玩家要付的东西，不在居民兜里，不挡。
  for (const offer of BLACKOUT_XIAOZHOU_OFFERS) ids.add(offer.partId);
  ids.add(BLACKOUT_AZHEN_REWARD.itemId);
  ids.add(BLACKOUT_AZHEN_THANKS.itemId);
  for (const material of BLACKOUT_REPAIR_MATERIALS) ids.add(material.itemId);
  return ids;
}

/** 某位居民在这个阶段真正缺的东西（请求帮助的标的由规则给，不由模型给）。 */
function requestOf(npcId: NpcId): { itemId: ItemId; quantity: number } | null {
  const party = BLACKOUT_PARTIES[npcId as keyof typeof BLACKOUT_PARTIES];
  if (!party || party.request.length === 0) return null;
  return { itemId: party.request[0]!.itemId, quantity: party.request[0]!.quantity };
}

// ── 观察 ────────────────────────────────────────────────────────────────────

function npcSnapshot(state: GameState, npcId: NpcId): CompetitionNpcStateSnapshot {
  const def = getNpc(npcId);
  const persisted = loadNpcState(state, npcId);
  const memory: CompetitionNpcMemoryEntry[] = loadCompetitionNpcMemory(state, npcId);
  return {
    npcId,
    position: { floor: def.floor, x: def.x },
    hp: 100,
    hunger: 50,
    trust: persisted?.relationship.player ?? COMPETITION_TRUST_BASE,
    affinity: 0,
    tension: 0,
    status: 'available',
    // 契约里的 goal 是结构化快照（不是自由文本）。居民自己那句自然语言目标
    // 放在 target 里——它就是「他现在想干什么」的可读版本。
    goal: persisted
      ? { goalId: `npc:${npcId}`, kind: 'custom', sinceDay: state.day, status: 'active', target: persisted.goal }
      : null,
    memory,
    lastAction: null,
    inventory: loadNpcInventory(state, npcId),
  };
}

function worldSnapshot(state: GameState, npcId: NpcId): CompetitionWorldStateSnapshot {
  return {
    seed: state.runSeed,
    day: state.day,
    gameMinute: state.gameMinuteOfDay,
    currentFloor: state.currentFloor,
    flags: state.flags ? { ...state.flags } : {},
    threats: [],
    player: {
      position: { floor: state.currentFloor, x: state.player.x },
      hp: state.player.hp,
      hunger: state.player.hunger,
      thirst: state.player.thirst,
      energy: state.player.energy,
      inventory: playerInventoryOf(state),
    },
    npcs: [npcSnapshot(state, npcId)],
    groundItems: [],
    gates: [{
      gateId: BLACKOUT_POWER_GATE_ID,
      floor: getNpc('alin').floor,
      status: isBlackoutPowerRestored(state) ? 'open' : 'closed',
    }],
  };
}

function observationFor(state: GameState, npcId: NpcId, stage: BlackoutStage): CompetitionObservationSnapshot {
  return {
    observationId: `autonomy:${state.runSeed}:${state.day}:${npcId}:${stage}:${Math.floor(state.gameMinuteOfDay)}`,
    world: worldSnapshot(state, npcId),
    focus: { kind: 'npc', npcId },
    availableActions: ['give', 'ask', 'inspect', 'observe'],
    recentFacts: [`停电危机阶段：${stage}`, `游戏时间：第${state.day}天 ${String(hourOf(state)).padStart(2, '0')}:00`],
  };
}

// ── 世界版本（revision）校验 ────────────────────────────────────────────────

/**
 * 计算「这一轮决策所依据的世界版本」。
 *
 * 为什么要有这个：模型请求是异步的，玩家在这几十毫秒里完全可能拿走了材料、
 * 换了楼层、推进了危机阶段。等提案回来时世界已经不是提案所描述的那个世界，
 * 照着旧提案执行就是「把另一个世界的动作落到这个世界」。
 *
 * 覆盖的字段刻意只取**会改变这次决策合法性**的那些：阶段、天、分钟、玩家背包、
 * 居民的库存与信任。哈希用竞赛链路的同一套 SHA-256（`competitionTraceSha256`），
 * 不引入第二套摘要算法。
 */
async function worldRevision(state: GameState, npcId: NpcId): Promise<string> {
  const persisted = loadNpcState(state, npcId);
  const payload = {
    stage: blackoutStageOf(state),
    day: state.day,
    gameMinute: Math.floor(state.gameMinuteOfDay),
    floor: state.currentFloor,
    playerInventory: playerInventoryOf(state),
    npcInventory: loadNpcInventory(state, npcId),
    trust: persisted?.relationship.player ?? COMPETITION_TRUST_BASE,
    memoryCount: loadCompetitionNpcMemory(state, npcId).length,
  };
  return competitionTraceSha256(JSON.stringify(payload));
}

// ── 落库 ────────────────────────────────────────────────────────────────────

/**
 * 把这次自主行为写进居民自己的持久状态。
 *
 * 顺序不可调换：`saveNpcState` 会整体覆盖 `npcStates[npcId]` 这个 JSON blob，
 * 把同一 blob 里的 competitionInventory / competitionMemory 一并抹掉。所以先写
 * 通用状态，再用两个适配器把库存和**全部**记忆补回去——这与
 * `scenarios/blackoutCrisis.ts` 的 appendMemory 是同一条纪律（那边实测踩过）。
 */
function commitAutonomy(
  state: GameState,
  npcId: NpcId,
  goal: string,
  summary: string,
  entry: CompetitionNpcMemoryEntry,
): void {
  const priorMemories = loadCompetitionNpcMemory(state, npcId);
  const inventory = loadNpcInventory(state, npcId);
  const baseline = loadNpcState(state, npcId) ?? createNpcStateFor(npcId);
  const next = recordMemory(
    { ...baseline, goal },
    {
      day: state.day,
      minute: Math.floor(state.gameMinuteOfDay),
      kind: 'observed',
      // actor 记成 world_tick：这条记忆是**世界**自己触发的，不是玩家按 E 换来的。
      actor: NPC_AUTONOMY_ACTOR,
      summary,
    },
  );
  saveNpcState(state, npcId, next);
  if (!saveNpcInventory(state, npcId, inventory)) throw new Error('npc_inventory_rewrite_failed');
  for (const prior of priorMemories) {
    if (!saveCompetitionNpcMemory(state, npcId, prior)) throw new Error('memory_rewrite_failed');
  }
  if (!saveCompetitionNpcMemory(state, npcId, entry)) throw new Error('memory_write_failed');
}

function nextMemoryId(state: GameState, npcId: NpcId): string {
  const existing = loadCompetitionNpcMemory(state, npcId);
  let sequence = existing.length;
  let id = createCompetitionNpcMemoryId(state.runSeed, npcId, state.day, sequence);
  while (existing.some((entry) => entry.memoryId === id)) {
    sequence += 1;
    id = createCompetitionNpcMemoryId(state.runSeed, npcId, state.day, sequence);
  }
  return id;
}

function factEntry(state: GameState, npcId: NpcId, subject: string, value: string): CompetitionNpcMemoryEntry {
  return { kind: 'fact', memoryId: nextMemoryId(state, npcId), day: state.day, subject, value };
}

// ── 提案 ────────────────────────────────────────────────────────────────────

/** 自主提案 → 契约提案。模型只能提意图与「交哪件货」，数量与标的由规则复核。 */
function toContractProposal(proposal: NpcAutonomyProposal): CompetitionActionProposal | null {
  switch (proposal.kind) {
    case 'protect_supplies': {
      if (!proposal.itemId || !isItemId(proposal.itemId)) return null;
      const quantity = proposal.quantity ?? 1;
      if (!Number.isSafeInteger(quantity) || quantity < 1) return null;
      return {
        kind: 'give',
        transfer: {
          from: { kind: 'npc', npcId: proposal.npcId },
          to: 'player',
          itemId: proposal.itemId,
          quantity,
        },
      };
    }
    case 'request_help':
      return { kind: 'ask', npcId: proposal.npcId, question: proposal.utterance ?? '需要帮助' };
    case 'repair_prep':
      return { kind: 'inspect', target: { kind: 'gate', id: BLACKOUT_POWER_GATE_ID } };
    default:
      return null;
  }
}

/**
 * 规则脑（降级路径）给这位居民挑一个动作。
 *
 * 挑选顺序就是「停电时一个居民真正会做的事」的顺序：先看看自己有没有东西要
 * 保住（protect_supplies），维修工先清点材料（repair_prep），最后才开口求人
 * （request_help）。上一轮被拒时换一个动作，不原样重试。
 */
function rulesProposal(
  state: GameState,
  npcId: NpcId,
  stage: BlackoutStage,
  rejected: ReadonlySet<NpcAutonomyActionKind>,
): NpcAutonomyProposal | null {
  const candidates: NpcAutonomyActionKind[] = ['protect_supplies', 'repair_prep', 'request_help'];
  for (const kind of candidates) {
    if (rejected.has(kind)) continue;
    if (kind === 'protect_supplies') {
      const goods = protectableGoods(state, npcId);
      const first = goods[0];
      if (!first) continue;
      return { kind, npcId, itemId: first.itemId, quantity: first.quantity };
    }
    if (kind === 'repair_prep') {
      if (npcId !== 'alin') continue;
      if (stage !== 'investigating' && stage !== 'materials_needed') continue;
      return { kind, npcId };
    }
    if (kind === 'request_help') {
      if (!requestOf(npcId)) continue;
      return { kind, npcId };
    }
  }
  return null;
}

/**
 * 这位居民手上有哪些货**可以**自主保管。
 *
 * 两条硬约束：
 * - 危机里正在流通的货（见 crisisGoods）不许动：那些是玩家该付代价换来的。
 * - 只保管自己真正有的，且最多一半、至少留一件——留一件是为了「全封存」这种
 *   状态不会把居民变成空巢（阿珍的面包要留着换口粮）。
 */
function protectableGoods(state: GameState, npcId: NpcId): { itemId: ItemId; quantity: number }[] {
  const blocked = crisisGoods();
  const out: { itemId: ItemId; quantity: number }[] = [];
  for (const stack of loadNpcInventory(state, npcId)) {
    if (blocked.has(stack.itemId)) continue;
    if (stack.quantity < 2) continue;
    const quantity = Math.floor(stack.quantity / 2);
    if (quantity < 1) continue;
    out.push({ itemId: stack.itemId, quantity });
  }
  return out;
}

// ── 校验 ────────────────────────────────────────────────────────────────────

function reject(reason: Exclude<CompetitionValidationReason, 'ok'>, detailCode: string): CompetitionValidationResult {
  return { accepted: false, reason, expectedStateDelta: emptyDelta(), detailCode };
}

/**
 * 自主动作的规则裁决。
 *
 * 这一层是自主行为的**唯一**闸门：模型给的只是提案，能不能做由这里说了算。
 * 三条边界：
 * - 动作必须在白名单里，且必须是契约里的标签；
 * - 数量与标的必须来自**规则侧的事实**（居民真有的货、危机里他真正缺的物），
 *   模型报的数量只作为上限，最终以事实为准；
 * - 危机流通的货不许被自主送出去（见 crisisGoods 的理由）。
 */
function validateAutonomyProposal(
  state: GameState,
  npcId: NpcId,
  stage: BlackoutStage,
  proposal: CompetitionActionProposal,
): CompetitionValidationResult {
  const action = actionOfContractKind(proposal.kind);
  if (!action) return reject('invalid_target', `autonomy:${proposal.kind}`);
  if (proposal.kind === 'ask' && proposal.npcId !== npcId) return reject('invalid_target', 'autonomy:wrong_npc');
  if (proposal.kind === 'give') {
    const transfer = proposal.transfer;
    if (transfer.from === 'player' || transfer.to !== 'player') return reject('invalid_target', 'autonomy:wrong_direction');
    if (transfer.from.kind !== 'npc' || transfer.from.npcId !== npcId) return reject('invalid_target', 'autonomy:wrong_npc');
  }

  if (action === 'protect_supplies') {
    if (proposal.kind !== 'give') return reject('invalid_target', 'autonomy:malformed');
    const { itemId, quantity } = proposal.transfer;
    if (!isItemId(itemId)) return reject('invalid_target', 'autonomy:unknown_item');
    if (!Number.isSafeInteger(quantity) || quantity < 1) return reject('invalid_target', 'autonomy:bad_quantity');
    if (crisisGoods().has(itemId)) return reject('invalid_target', 'autonomy:crisis_goods');
    const held = loadNpcInventory(state, npcId)
      .filter((stack) => stack.itemId === itemId)
      .reduce((total, stack) => total + stack.quantity, 0);
    if (held < quantity) return reject('missing_item', 'autonomy:npc_lacks_item');
    const already = flagCount(state, NPC_AUTONOMY_FLAG.protectedCount(npcId, itemId));
    if (already + quantity > Math.floor(held / 2)) return reject('invalid_target', 'autonomy:over_protected');
    return { accepted: true, reason: 'ok', expectedStateDelta: emptyDelta() };
  }

  if (action === 'request_help') {
    const want = requestOf(npcId);
    if (!want) return reject('invalid_target', 'autonomy:nothing_to_ask');
    if (stage === 'initial') return reject('invalid_target', 'autonomy:crisis_not_started');
    return { accepted: true, reason: 'ok', expectedStateDelta: emptyDelta() };
  }

  // repair_prep：只有维修工能做，且只在危机进行中。
  if (npcId !== 'alin') return reject('invalid_target', 'autonomy:not_repairman');
  if (stage !== 'investigating' && stage !== 'materials_needed') return reject('invalid_target', 'autonomy:wrong_stage');
  if (proposal.kind !== 'inspect') return reject('invalid_target', 'autonomy:malformed');
  return { accepted: true, reason: 'ok', expectedStateDelta: emptyDelta() };
}

// ── 执行 ────────────────────────────────────────────────────────────────────

interface ExecutionSnapshot {
  readonly playerSlots: InventoryStack[];
  readonly npcInventory: InventoryStack[];
  readonly npcState: string | undefined;
  readonly flags: Record<string, number> | undefined;
  readonly hadNpcState: boolean;
  readonly hadFlags: boolean;
}

function snapshotFor(state: GameState, npcId: NpcId): ExecutionSnapshot {
  return {
    playerSlots: playerInventoryOf(state),
    npcInventory: cloneStacks(loadNpcInventory(state, npcId)),
    npcState: state.npcStates?.[npcId],
    flags: state.flags ? { ...state.flags } : undefined,
    hadNpcState: state.npcStates !== undefined,
    hadFlags: state.flags !== undefined,
  };
}

/** 失败时整段回滚：自主行动不能留下「扣了一半库存」的中间态。 */
function rollback(state: GameState, npcId: NpcId, snapshot: ExecutionSnapshot): void {
  state.player.inventory.slots.splice(0, state.player.inventory.slots.length, ...snapshot.playerSlots);
  if (!snapshot.hadNpcState) {
    Reflect.deleteProperty(state, 'npcStates');
  } else if (snapshot.npcState !== undefined) {
    if (state.npcStates) state.npcStates[npcId] = snapshot.npcState;
  }
  if (!snapshot.hadFlags) {
    Reflect.deleteProperty(state, 'flags');
  } else if (snapshot.flags) {
    state.flags = { ...snapshot.flags };
  }
}

interface AppliedAction {
  readonly action: NpcAutonomyActionKind;
  readonly goal: string;
  readonly summary: string;
  readonly entry: CompetitionNpcMemoryEntry;
  readonly inventoryDelta: { itemId: ItemId; quantity: number }[];
}

/** 落库前的准备：算好这次要写什么，不改状态。 */
function planApplication(
  state: GameState,
  npcId: NpcId,
  stage: BlackoutStage,
  action: NpcAutonomyActionKind,
  proposal: CompetitionActionProposal,
): AppliedAction | null {
  if (action === 'protect_supplies') {
    if (proposal.kind !== 'give') return null;
    const { itemId, quantity } = proposal.transfer;
    const itemName = getItem(itemId).displayName;
    return {
      action,
      goal: `把${itemName}交给玩家保管`,
      summary: `停电后自主把${itemName}×${quantity}交给玩家保管`,
      entry: factEntry(state, npcId, 'autonomy_protect_supplies', `${itemId}:${quantity}`),
      inventoryDelta: [{ itemId, quantity }],
    };
  }
  if (action === 'request_help') {
    const want = requestOf(npcId);
    if (!want) return null;
    const itemName = getItem(want.itemId).displayName;
    return {
      action,
      goal: `向玩家求助：${itemName}×${want.quantity}`,
      summary: `停电后自主向玩家求助：${itemName}×${want.quantity}`,
      entry: factEntry(state, npcId, 'autonomy_request_help', `${want.itemId}:${want.quantity}:${stage}`),
      inventoryDelta: [],
    };
  }
  const materials = BLACKOUT_REPAIR_MATERIALS.map((stack) => `${getItem(stack.itemId).displayName}×${stack.quantity}`).join('、');
  return {
    action: 'repair_prep',
    goal: '清点维修材料，准备接回主线',
    summary: `停电后自主清点维修材料（${materials}）`,
    entry: factEntry(state, npcId, 'autonomy_repair_prep', `${BLACKOUT_POWER_GATE_ID}:${stage}`),
    inventoryDelta: [],
  };
}

// ── 单个居民的一轮 ──────────────────────────────────────────────────────────

async function runResidentRound(
  state: GameState,
  npcId: NpcId,
  stage: BlackoutStage,
  options: NpcAutonomyOptions,
): Promise<{ outcome: NpcAutonomyOutcome; modelCalls: number }> {
  const revisionBefore = await worldRevision(state, npcId);
  const playerBefore = playerInventoryOf(state);
  const npcBefore = cloneStacks(loadNpcInventory(state, npcId));

  let modelDeclined = false;
  let modelCalls = 0;
  /** 模型说给玩家听的话。只展示，不参与裁决。 */
  let modelUtterance: string | null = null;
  /** 这一轮被验证通过的提案是谁提的：模型提的被拒后，规则提案接手——此时来源必须改口。 */
  let proposalSource: 'model' | 'rules' = 'rules';
  let accepted: { action: NpcAutonomyActionKind; proposal: CompetitionActionProposal } | null = null;
  let applied: AppliedAction | null = null;
  let rejectionReason = '';
  const rejectedActions = new Set<NpcAutonomyActionKind>();

  const runtime = await runCompetitionStep({
    observe: async () => observationFor(state, npcId, stage),
    selectGoal: async (): Promise<CompetitionGoalSnapshot> => ({
      goalId: `autonomy:${npcId}`,
      kind: 'custom',
      sinceDay: state.day,
      status: 'active',
      target: BLACKOUT_POWER_GATE_ID,
    }),
    plan: async (): Promise<CompetitionPlan> => ({
      nextAction: CONTRACT_KIND_BY_ACTION[accepted?.action ?? 'request_help'],
    }),
    propose: async (observation, _goal, _plan, previousFeedback) => {
      if (!options.proposeWithModel) return null;
      // 一轮只问一次模型。模型调用是这套系统里最贵的一步，节流的第一道闸在
      // 触发层（每游戏小时一次），这里再兜一道：同一个居民在同一轮里不重复问。
      // 第二次尝试交给规则脑（见 fallback），不变成「再问一遍模型」。
      if (modelCalls >= 1) return null;
      modelCalls += 1;
      const persisted = loadNpcState(state, npcId);
      const proposal = await options.proposeWithModel({
        observation,
        npcId,
        stage,
        self: {
          inventory: loadNpcInventory(state, npcId),
          goal: persisted?.goal ?? createNpcStateFor(npcId).goal,
          trust: persisted?.relationship.player ?? COMPETITION_TRUST_BASE,
          memory: loadCompetitionNpcMemory(state, npcId).map((entry) =>
            entry.kind === 'fact' ? `${entry.subject}=${entry.value}` : `${entry.kind}:${entry.status ?? ''}`,
          ),
        },
        previousFeedback,
      });
      // 模型说「我不动」与「模型挂了」是两回事：前者不许由规则代劳。
      if (!proposal) {
        modelDeclined = true;
        return null;
      }
      const contract = toContractProposal(proposal);
      if (!contract) return null;
      proposalSource = 'model';
      modelUtterance = proposal.utterance ?? null;
      return contract;
    },
    fallback: async () => {
      // 模型明确说不动 → 规则不许替它做。模型没被调用或调用失败 → 规则接管。
      if (modelDeclined) return null;
      const rules = rulesProposal(state, npcId, stage, rejectedActions);
      if (!rules) return null;
      const contract = toContractProposal(rules);
      if (!contract) return null;
      proposalSource = 'rules';
      return contract;
    },
    validate: async (_observation, proposal) => {
      const checked = validateAutonomyProposal(state, npcId, stage, proposal);
      if (!checked.accepted) {
        rejectionReason = checked.detailCode ?? checked.reason;
        const action = actionOfContractKind(proposal.kind);
        if (action) rejectedActions.add(action);
        return checked;
      }
      const action = actionOfContractKind(proposal.kind);
      if (!action) return reject('invalid_target', `autonomy:${proposal.kind}`);
      accepted = { action, proposal };
      return checked;
    },
    execute: async (_observation, proposal) => {
      if (!accepted) return { status: 'failed', actualStateDelta: null };
      // 世界版本复核：提案回来之前世界变了就作废，不拿旧提案改新世界。
      const revisionNow = await worldRevision(state, npcId);
      if (revisionNow !== revisionBefore) {
        rejectionReason = 'autonomy:stale_world_revision';
        return { status: 'interrupted', actualStateDelta: null };
      }
      const plan = planApplication(state, npcId, stage, accepted.action, proposal);
      if (!plan) return { status: 'failed', actualStateDelta: null };
      const snapshot = snapshotFor(state, npcId);
      try {
        if (accepted.action === 'protect_supplies' && proposal.kind === 'give') {
          const { itemId, quantity } = proposal.transfer;
          const stock = loadNpcInventory(state, npcId);
          const nextStock = stock
            .map((stack) => (stack.itemId === itemId ? { ...stack, quantity: stack.quantity - quantity } : stack))
            .filter((stack) => stack.quantity > 0);
          if (!saveNpcInventory(state, npcId, nextStock)) throw new Error('npc_inventory_write_failed');
          const added = addItem(state.player.inventory, itemId, quantity).added;
          if (added !== quantity) throw new Error('inventory_full');
          setFlag(state, NPC_AUTONOMY_FLAG.protectedCount(npcId, itemId), flagCount(state, NPC_AUTONOMY_FLAG.protectedCount(npcId, itemId)) + quantity);
        }
        commitAutonomy(state, npcId, plan.goal, plan.summary, plan.entry);
        setFlag(state, NPC_AUTONOMY_FLAG.handled(npcId, stage), 1);
        applied = plan;
        return {
          status: 'completed',
          actualStateDelta: {
            ...emptyDelta(),
            inventory: plan.inventoryDelta.map((delta) => ({
              owner: { kind: 'npc' as const, npcId },
              itemId: delta.itemId,
              quantityDelta: -delta.quantity,
            })),
            memoryAdded: [{ npcId, entry: plan.entry }],
            flags: [{ flag: NPC_AUTONOMY_FLAG.handled(npcId, stage), from: null, to: 1 }],
          },
        };
      } catch {
        rollback(state, npcId, snapshot);
        return { status: 'failed', actualStateDelta: null };
      }
    },
    feedback: async () => { /* 反馈只用于本轮重规划，不落库 */ },
  }, { maxAttempts: options.maxAttempts ?? 2 });

  // 只有「模型提的提案」且「它真的被提交成功」才是 model。模型提的被规则拒绝、
  // 规则接手执行的，一律 offline-fallback——不把规则的行为记到模型头上。
  //
  // 读这两个值要经一次函数调用：TypeScript 的控制流分析不跟踪闭包里的赋值，
  // 闭包外会把 `applied` 收窄成初值 null，于是「提交成功」那条分支被推成
  // never。函数返回声明类型，运行时拿到的仍是闭包里真正写进去的值。
  const committed = (): AppliedAction | null => applied;
  const committedSource = (): 'model' | 'rules' => proposalSource;
  const playerAfter = playerInventoryOf(state);
  const npcAfter = cloneStacks(loadNpcInventory(state, npcId));

  const appliedAction = committed();
  const source: NpcAutonomyDecisionSource = appliedAction && committedSource() === 'model' ? 'model' : 'offline-fallback';

  if (runtime.status === 'executed' && appliedAction) {
    return {
      outcome: {
        npcId,
        actor: NPC_AUTONOMY_ACTOR,
        action: appliedAction.action,
        status: 'executed',
        decisionSource: source,
        reason: `${appliedAction.summary}（${stage}）`,
        worldRevision: revisionBefore,
        playerInventoryBefore: playerBefore,
        playerInventoryAfter: playerAfter,
        npcInventoryBefore: npcBefore,
        npcInventoryAfter: npcAfter,
        stateDelta: runtime.execution?.actualStateDelta ?? null,
        utterance: modelUtterance,
      },
      modelCalls,
    };
  }
  const status: NpcAutonomyOutcome['status'] = modelDeclined ? 'declined' : rejectionReason ? 'rejected' : 'skipped';
  return {
    outcome: {
      npcId,
      actor: NPC_AUTONOMY_ACTOR,
      action: null,
      status,
      decisionSource: source,
      reason: rejectionReason || (modelDeclined ? '模型明确不动，规则不代劳' : '本轮没有可执行的自主动作'),
      worldRevision: revisionBefore,
      playerInventoryBefore: playerBefore,
      playerInventoryAfter: playerAfter,
      npcInventoryBefore: npcBefore,
      npcInventoryAfter: npcAfter,
      stateDelta: null,
      utterance: null,
    },
    modelCalls,
  };
}

// ── 触发与节流 ──────────────────────────────────────────────────────────────

/**
 * 这一帧有没有发生世界事件？
 *
 * 游标记着「上一次看到的世界长什么样」。阶段变了或跨过整点，就是一次世界
 * 事件。第一次调用（没有游标）只用来初始化，不触发任何行为。
 */
export function detectNpcAutonomyTrigger(state: GameState, cursor: NpcAutonomyCursor | undefined): NpcAutonomyTrigger | null {
  if (!cursor) return null;
  const stage = blackoutStageOf(state);
  if (cursor.stage !== stage) return 'blackout_stage';
  if (cursor.hour !== hourOf(state)) return 'hour_boundary';
  return null;
}

/** 距离上一轮自主 tick 够久了吗？不够就这一轮不跑（也就不会调用模型）。 */
export function npcAutonomyThrottled(
  state: GameState,
  minIntervalMinutes = NPC_AUTONOMY_MIN_INTERVAL_MINUTES,
): boolean {
  const last = flagCount(state, NPC_AUTONOMY_FLAG.lastRoundMinute);
  if (last <= 0) return false;
  return absoluteGameMinute(state) - last < minIntervalMinutes;
}

/** 初始化游标。场景在第一次看世界时调用它。 */
export function initNpcAutonomyCursor(state: GameState): NpcAutonomyCursor {
  return { stage: blackoutStageOf(state), hour: hourOf(state) };
}

// ── 主入口 ──────────────────────────────────────────────────────────────────

/**
 * 跑一轮自主 tick。
 *
 * 返回的 `cursor` 只在真的跑了一轮之后才推进：被节流时游标不动，触发事件
 * 留在那里，等节流窗口过去再兑现——而不是被吃掉。
 */
export async function runNpcAutonomyTick(
  state: GameState,
  options: NpcAutonomyOptions = {},
): Promise<NpcAutonomyRun> {
  const cursor = options.cursor ?? initNpcAutonomyCursor(state);
  const trigger = detectNpcAutonomyTrigger(state, options.cursor);

  if (!trigger) {
    return {
      result: {
        actor: NPC_AUTONOMY_ACTOR,
        trigger: 'hour_boundary',
        stage: blackoutStageOf(state),
        status: 'no_trigger',
        decisionSource: 'offline-fallback',
        revisionBefore: '',
        revisionAfter: '',
        outcomes: [],
        modelCalls: 0,
      },
      cursor,
    };
  }

  if (npcAutonomyThrottled(state, options.minIntervalMinutes)) {
    return {
      result: {
        actor: NPC_AUTONOMY_ACTOR,
        trigger,
        stage: blackoutStageOf(state),
        status: 'throttled',
        decisionSource: 'offline-fallback',
        revisionBefore: '',
        revisionAfter: '',
        outcomes: [],
        modelCalls: 0,
      },
      cursor,
    };
  }

  const stage = blackoutStageOf(state);
  const residents = options.residents ?? NPC_AUTONOMY_RESIDENTS;
  const outcomes: NpcAutonomyOutcome[] = [];
  let modelCalls = 0;

  for (const npcId of residents) {
    // 同一 NPC 同一阶段最多一次：已处理过就直接跳过，不重复扣库存。
    if (flagCount(state, NPC_AUTONOMY_FLAG.handled(npcId, stage)) > 0) continue;
    // 危机还没开始时居民没有可自主决定的事。
    if (stage === 'initial') continue;
    const round = await runResidentRound(state, npcId, stage, options);
    outcomes.push(round.outcome);
    modelCalls += round.modelCalls;
  }

  setFlag(state, NPC_AUTONOMY_FLAG.lastRoundMinute, absoluteGameMinute(state));
  const focusNpc = residents[0] ?? NPC_AUTONOMY_RESIDENTS[0]!;
  const revisionBefore = outcomes[0]?.worldRevision ?? await worldRevision(state, focusNpc);
  const revisionAfter = await worldRevision(state, focusNpc);
  const decisionSource: NpcAutonomyDecisionSource = outcomes.some((outcome) => outcome.decisionSource === 'model')
    ? 'model'
    : 'offline-fallback';

  return {
    result: {
      actor: NPC_AUTONOMY_ACTOR,
      trigger,
      stage,
      status: outcomes.some((outcome) => outcome.status === 'executed') ? 'executed' : 'no_action',
      decisionSource,
      revisionBefore,
      revisionAfter,
      outcomes,
      modelCalls,
    },
    cursor: { stage, hour: hourOf(state) },
  };
}

/** 这位居民在这个阶段是否已经自主行动过。场景与测试都要看它。 */
export function hasAutonomyActed(state: GameState, npcId: NpcId, stage: BlackoutStage): boolean {
  return flagCount(state, NPC_AUTONOMY_FLAG.handled(npcId, stage)) > 0;
}

/** 这位居民被自主保管的某件物资数量（对账用）。 */
export function protectedQuantityOf(state: GameState, npcId: NpcId, itemId: ItemId): number {
  return flagCount(state, NPC_AUTONOMY_FLAG.protectedCount(npcId, itemId));
}
