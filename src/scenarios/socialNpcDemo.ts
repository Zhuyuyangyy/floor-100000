// 多 NPC 竞赛场景：把闭环从「单 NPC 阿林」扩到「阿林 + 小周」。
//
// 关键设计：两个 NPC 各有独立的信任、库存、记忆与关系。
// 给小周送东西绝不能顺手抬高阿林的信任——这是最容易写错、也最容易被评审
// 一眼看穿的地方，所以本模块把所有写入都收口到 focus 这一个 npcId 上。
//
// 分层铁律不变：
//   模型只提议 → competitionRules 裁决 → executor 执行 → 适配器落 GameState。

import type {
  CompetitionActionProposal,
  CompetitionObservationSnapshot,
  CompetitionNpcMemoryEntry,
  CompetitionNpcStateSnapshot,
  CompetitionValidationResult,
  CompetitionWorldStateSnapshot,
} from '../ai/competition-contract';
import {
  runCompetitionStep,
  type CompetitionAttemptFeedback,
  type CompetitionExecutionOutcome,
  type CompetitionPlan,
} from '../ai/competitionRuntime';
import { executeCompetitionProposal, type CompetitionDemoState } from '../ai/competitionExecutor';
import {
  COMPETITION_TRUST_BASE,
  type CompetitionRulesPolicy,
  validateCompetitionProposal,
} from '../ai/competitionRules';
import { hashCompetitionWorldState, serializeCompetitionWorldState } from '../ai/competitionTrace';
import type { GameState, InventoryStack, ItemId } from '../core/gameTypes';
import { NPCS, getNpc, type NpcId } from '../data/npcs';
import { createNpcState } from '../data/npcPersonalities';
import { getItem } from '../data/items';
import { loadNpcState, recordMemory, saveNpcState } from '../systems/NpcMemory';
import {
  createCompetitionNpcMemoryId,
  loadCompetitionNpcMemory,
  saveCompetitionNpcMemory,
} from '../systems/CompetitionNpcMemoryStore';
import { loadNpcInventory, saveNpcInventory } from '../systems/NpcInventory';
import { INTERACT_DISTANCE } from '../core/constants';

/**
 * 全部常驻居民；顺序稳定（等同 data/npcs.ts 的楼层顺序），便于快照与 trace 对齐。
 *
 * 原来固定为 ['alin','xiaozhou']：楼里只有两个人时这没毛病，但住户扩到六人以后，
 * 新居民走赠礼会在这里找不到自己的记录——快照里 `npcs` 没有他，executor 的
 * 「谁被改了」也就落空，表现是赠礼静默失败。所以改成从名单派生。
 */
export const SOCIAL_NPC_IDS: readonly NpcId[] = NPCS.map((npc) => npc.id);

export type SocialScenarioStatus = 'executed' | 'blocked' | 'planning_failed' | 'exhausted';

export interface SocialScenarioResult {
  readonly status: SocialScenarioStatus;
  readonly attempts: number;
  /** 本次动作的目标 NPC。 */
  readonly focusNpcId: NpcId;
  readonly observation: CompetitionObservationSnapshot;
  readonly proposal: CompetitionActionProposal | null;
  readonly validation: CompetitionValidationResult | null;
  readonly execution: CompetitionExecutionOutcome | null;
  readonly feedback: readonly CompetitionAttemptFeedback[];
  readonly before: CompetitionWorldStateSnapshot;
  readonly after: CompetitionWorldStateSnapshot;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly reason: string;
}

export interface SocialGiftOptions {
  /** 赠礼提高的信任值；默认沿用既有礼物记忆规则算出的增量。 */
  readonly trustDelta?: number;
}

function cloneInventory(inventory: readonly InventoryStack[]): InventoryStack[] {
  return inventory.map((stack) => ({ ...stack, ...(stack.meta ? { meta: { ...stack.meta } } : {}) }));
}

function archetypeOf(npcId: NpcId) {
  return npcId === 'alin' ? ('ally' as const) : ('neutral' as const);
}

function trustOf(game: GameState, npcId: NpcId): number {
  return loadNpcState(game, npcId)?.relationship.player ?? COMPETITION_TRUST_BASE;
}

function npcSnapshot(game: GameState, npcId: NpcId): CompetitionNpcStateSnapshot {
  const def = getNpc(npcId);
  return {
    npcId,
    // 每个人用自己的楼层：楼上住户不住第 2 层，写死会让距离校验永远 too_far。
    position: { floor: def.floor, x: def.x },
    // 民用 NPC 的 HP/饥饿不在 GameState 建模；这里的 0 是契约占位符，
    // 本模块从不写回，避免伪造数值。
    hp: 0,
    hunger: 0,
    trust: trustOf(game, npcId),
    affinity: 0,
    tension: 0,
    status: game.currentFloor === def.floor ? 'available' : 'absent',
    goal: { goalId: `${npcId}-social`, kind: 'custom', sinceDay: 1, status: 'active' },
    memory: loadCompetitionNpcMemory(game, npcId),
    lastAction: null,
    inventory: loadNpcInventory(game, npcId),
  };
}

/** 完整世界快照：两个 NPC 同时在场，各自独立。 */
export function socialWorldSnapshot(game: GameState): CompetitionWorldStateSnapshot {
  return {
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
      inventory: cloneInventory(game.player.inventory.slots),
    },
    npcs: SOCIAL_NPC_IDS.map((id) => npcSnapshot(game, id)),
    groundItems: [],
    gates: [],
  };
}

function observationFor(
  world: CompetitionWorldStateSnapshot,
  npcId: NpcId,
  sequence: number,
): CompetitionObservationSnapshot {
  const npc = world.npcs.find((item) => item.npcId === npcId);
  const name = getNpc(npcId).name;
  return {
    observationId: `${world.seed}:${world.day}:${world.gameMinute}:${npcId}:${sequence}`,
    world,
    focus: { kind: 'npc', npcId },
    availableActions: world.currentFloor === getNpc(npcId).floor ? ['observe', 'give'] : ['observe'],
    recentFacts: [
      `${name}信任:${npc?.trust ?? COMPETITION_TRUST_BASE}`,
      `${name}库存种类:${npc?.inventory.length ?? 0}`,
      `${name}记忆条数:${npc?.memory.length ?? 0}`,
      `玩家库存种类:${world.player.inventory.length}`,
      `同层居民:${world.npcs.filter((item) => item.status === 'available').length}`,
    ],
  };
}

function validationState(world: CompetitionWorldStateSnapshot) {
  return { currentFloor: world.currentFloor, player: world.player, npcs: world.npcs, gates: world.gates };
}

/**
 * 只挑出 focus NPC 交给 executor。
 *
 * executor 的规则会按 npcId 找目标；把另一个 NPC 也塞进去虽然无害，但会让
 * 「谁被改了」变得难以断言。这里显式只给一个，隔离由结构保证。
 */
function executorState(world: CompetitionWorldStateSnapshot, npcId: NpcId): CompetitionDemoState {
  const npc = world.npcs.find((item) => item.npcId === npcId);
  return {
    currentFloor: world.currentFloor,
    player: { position: { ...world.player.position }, inventory: cloneInventory(world.player.inventory) },
    npcs: npc
      ? [{
          npcId: npc.npcId,
          position: { ...npc.position },
          status: npc.status,
          trust: npc.trust,
          inventory: cloneInventory(npc.inventory),
        }]
      : [],
    gates: world.gates.map((gate) => ({ ...gate })),
    appliedOperationIds: new Set<string>(),
  };
}

function memoryEntryFor(game: GameState, npcId: NpcId, itemId: ItemId, quantity: number): CompetitionNpcMemoryEntry {
  const existing = loadCompetitionNpcMemory(game, npcId);
  let sequence = existing.length;
  let memoryId = createCompetitionNpcMemoryId(game.runSeed, npcId, game.day, sequence);
  while (existing.some((entry) => entry.memoryId === memoryId)) {
    sequence += 1;
    memoryId = createCompetitionNpcMemoryId(game.runSeed, npcId, game.day, sequence);
  }
  return { kind: 'fact', memoryId, day: game.day, subject: 'player_gift', value: `${itemId}:${quantity}` };
}

/**
 * 把已验证的结果落进 GameState，且只写 focus NPC。
 *
 * 两个 NPC 的记录各自序列化在 `npcStates[npcId]` 里，写入用 staged 副本 +
 * 成功后再整体替换，失败就完全回滚——绝不留下「库存扣了但信任没加」的中间态。
 *
 * 写入顺序不可调换：`npcStates[npcId]` 是**一个** JSON blob，`saveNpcState`
 * 会整体覆盖它，把同 blob 里的 `competitionInventory` / `competitionMemory`
 * 一起抹掉。所以必须先写通用状态，再用两个适配器把库存与全部记忆补回去；
 * 反过来写会让库存被覆盖成空（R2 实测踩到过）。
 */
function commitGift(
  game: GameState,
  npcId: NpcId,
  executorStaged: CompetitionDemoState,
  trustBefore: number,
  trustAfter: number,
  itemId: ItemId,
  quantity: number,
  entry: CompetitionNpcMemoryEntry,
): boolean {
  const stagedNpc = executorStaged.npcs[0];
  // focus 之外的 NPC 不许出现在这里，否则「谁被改了」就无法断言。
  if (!stagedNpc || stagedNpc.npcId !== npcId) return false;

  const hadNpcStates = game.npcStates !== undefined;
  const originalBlob = game.npcStates?.[npcId];
  const originalPlayerInventory = cloneInventory(game.player.inventory.slots);
  const priorMemories = loadCompetitionNpcMemory(game, npcId);
  const staged: GameState = { ...game, npcStates: { ...(game.npcStates ?? {}) } };

  try {
    const baseline = loadNpcState(staged, npcId) ?? createNpcState(archetypeOf(npcId));
    const withMemory = recordMemory(
      { ...baseline, relationship: { ...baseline.relationship, player: trustBefore } },
      {
        day: game.day,
        minute: Math.floor(game.gameMinuteOfDay),
        kind: 'gift',
        actor: 'player',
        summary: `玩家赠送${getItem(itemId).displayName}×${quantity}`,
      },
    );
    // 信任以 executor 的裁决结果为准，不用 recordMemory 的默认曲线。
    withMemory.relationship.player = trustAfter;
    saveNpcState(staged, npcId, withMemory);
    // 库存来自 executor 算出的结果，绝不从被覆盖后的 blob 回读。
    if (!saveNpcInventory(staged, npcId, stagedNpc.inventory)) throw new Error('invalid_npc_inventory');
    for (const prior of priorMemories) {
      if (!saveCompetitionNpcMemory(staged, npcId, prior)) throw new Error('memory_rewrite_failed');
    }
    if (!saveCompetitionNpcMemory(staged, npcId, entry)) throw new Error('memory_write_failed');

    // 落盘前自查：三条扩展字段都必须在，否则宁可失败也不写半截状态。
    if (!loadNpcState(staged, npcId)) throw new Error('invalid_npc_state');
    if (JSON.stringify(loadNpcInventory(staged, npcId)) !== JSON.stringify(stagedNpc.inventory)) {
      throw new Error('npc_inventory_not_persisted');
    }
    const savedMemories = loadCompetitionNpcMemory(staged, npcId);
    const lostPrior = priorMemories.some(
      (prior) => !savedMemories.some((saved) => saved.memoryId === prior.memoryId),
    );
    if (lostPrior || !savedMemories.some((saved) => saved.memoryId === entry.memoryId)) {
      throw new Error('competition_memory_not_persisted');
    }

    const nextBlob = staged.npcStates[npcId];
    if (typeof nextBlob !== 'string') throw new Error('npc_state_not_serialized');

    // 以下三次写入之间没有 await：要么都生效，要么都回滚。
    game.npcStates ??= {};
    game.npcStates[npcId] = nextBlob;
    game.player.inventory.slots.splice(
      0,
      game.player.inventory.slots.length,
      ...cloneInventory(executorStaged.player.inventory),
    );
    return true;
  } catch {
    try {
      if (!hadNpcStates) Reflect.deleteProperty(game, 'npcStates');
      else if (originalBlob === undefined) delete game.npcStates![npcId];
      else game.npcStates![npcId] = originalBlob;
    } catch {
      // 尽力恢复；事务仍会报告失败，不掩盖原始错误。
    }
    try {
      game.player.inventory.slots.splice(0, game.player.inventory.slots.length, ...originalPlayerInventory);
    } catch {
      // 同上。
    }
    return false;
  }
}

function reasonText(validation: CompetitionValidationResult | null, status: SocialScenarioStatus, npcName: string, trust: number): string {
  if (status === 'planning_failed') return '规划未完成；游戏状态未改变。';
  if (status === 'executed') return `已把物品交给${npcName}；库存与信任已更新。`;
  if (!validation) return '没有提交动作；游戏状态未改变。';
  if (validation.reason === 'missing_item') return '背包中没有足够物品；未执行。';
  if (validation.reason === 'too_far') return `${npcName}不在可交互距离；未执行。`;
  if (validation.reason === 'low_trust') return `${npcName}当前信任 ${trust} 不足；未执行。`;
  const detail = validation.accepted ? undefined : validation.detailCode;
  return `校验拒绝（${detail ?? validation.reason}）；未执行。`;
}

/**
 * 向指定 NPC 完成一次经规则校验的赠礼。
 *
 * 与单 NPC 版的关键差异：focus 可切换，且绝不触碰另一个 NPC 的任何持久字段。
 */
export async function runSocialGiftScenario(
  game: GameState,
  npcId: NpcId,
  itemId: ItemId,
  quantity = 1,
  options: SocialGiftOptions = {},
): Promise<SocialScenarioResult> {
  const npcName = getNpc(npcId).name;
  if (game.currentFloor !== getNpc(npcId).floor) {
    const before = socialWorldSnapshot(game);
    const observation = observationFor(before, npcId, 0);
    const hash = await hashCompetitionWorldState(before);
    return {
      status: 'blocked', attempts: 0, focusNpcId: npcId, observation,
      proposal: null, validation: null, execution: null, feedback: [],
      before, after: before, beforeHash: hash, afterHash: hash,
      reason: `${npcName}不在当前楼层；未执行。`,
    };
  }

  const trustBefore = trustOf(game, npcId);
  const trustDelta = options.trustDelta ?? 13;
  const trustAfter = trustBefore + trustDelta;
  const policy: CompetitionRulesPolicy = {
    maxInteractionDistance: INTERACT_DISTANCE,
    trustDeltas: { give: trustDelta },
  };
  const before = socialWorldSnapshot(game);
  const entry = memoryEntryFor(game, npcId, itemId, quantity);
  const proposal: CompetitionActionProposal = {
    kind: 'give',
    transfer: { from: 'player', to: { kind: 'npc', npcId }, itemId, quantity },
  };
  const feedback: CompetitionAttemptFeedback[] = [];
  let sequence = 1;
  let finalObservation = observationFor(before, npcId, 0);

  const runtime = await runCompetitionStep({
    observe: async () => {
      const fresh = observationFor(socialWorldSnapshot(game), npcId, sequence++);
      finalObservation = fresh;
      return fresh;
    },
    selectGoal: async () => ({
      goalId: `${npcId}-social`, kind: 'custom', sinceDay: 1, status: 'active',
    }),
    plan: async (_observation, _goal, previousFeedback): Promise<CompetitionPlan> => ({
      nextAction: previousFeedback ? 'observe' : 'give',
    }),
    propose: async (current, _goal, plan, previousFeedback) =>
      !previousFeedback && plan.nextAction === 'give' && current.availableActions.includes('give')
        ? proposal
        : null,
    // 第 4 个参数是 reason 而不是上一轮反馈；`!previousFeedback` 恒为 false，
    // 导致这条 fallback 从未执行。与 alinRepairDemo / alinGiftDemo 一并修正。
    fallback: async (_current, _goal, plan) =>
      plan.nextAction === 'give' ? proposal : null,
    validate: async (current, candidate) => validateCompetitionProposal(validationState(current.world), candidate, policy),
    execute: async (current, candidate) => {
      // 过期提案不得落到已变化的世界。
      if (serializeCompetitionWorldState(socialWorldSnapshot(game)) !== serializeCompetitionWorldState(current.world)) {
        return { status: 'interrupted', actualStateDelta: null };
      }
      const demo = executorState(current.world, npcId);
      const committed = executeCompetitionProposal(demo, candidate, {
        operationId: `social-gift:${game.runSeed}:${game.day}:${game.gameMinuteOfDay}:${npcId}:${itemId}:${quantity}`,
        policy,
      });
      if (committed.status !== 'executed') return { status: 'failed', actualStateDelta: null };
      // executor 只在 detached 副本上算出新库存与新玩家背包；真正的写回
      // 全部交给 commitGift，失败时它能一并回滚，不会留下扣了物品的中间态。
      if (!commitGift(game, npcId, demo, trustBefore, trustAfter, itemId, quantity, entry)) {
        return { status: 'failed', actualStateDelta: null };
      }
      return {
        status: 'completed',
        actualStateDelta: {
          ...committed.actualStateDelta,
          memoryAdded: [...committed.actualStateDelta.memoryAdded, { npcId, entry }],
        },
      };
    },
    feedback: async (result) => { feedback.push(result); },
  }, { maxAttempts: 2 });

  const after = socialWorldSnapshot(game);
  const [beforeHash, afterHash] = await Promise.all([
    hashCompetitionWorldState(before),
    hashCompetitionWorldState(after),
  ]);
  const lastRejected = [...feedback].reverse().find((item) => item.outcome === 'validation_rejected');
  const validation = runtime.validation ?? lastRejected?.validation ?? null;
  const status: SocialScenarioStatus = runtime.status === 'executed'
    ? 'executed'
    : runtime.status === 'planning_failed'
      ? 'planning_failed'
      : validation && !validation.accepted ? 'blocked' : 'exhausted';
  return {
    status,
    attempts: runtime.attempts,
    focusNpcId: npcId,
    observation: finalObservation,
    proposal: runtime.proposal ?? lastRejected?.proposal ?? null,
    validation,
    execution: runtime.execution ?? null,
    feedback,
    before,
    after,
    beforeHash,
    afterHash,
    reason: reasonText(validation, status, npcName, trustBefore),
  };
}