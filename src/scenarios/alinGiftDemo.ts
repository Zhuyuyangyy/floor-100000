import type {
  CompetitionActionProposal,
  CompetitionObservationSnapshot,
  CompetitionStateDelta,
  CompetitionValidationResult,
  CompetitionWorldStateSnapshot,
} from '../ai/competition-contract';
import {
  runCompetitionStep,
  type CompetitionAttemptFeedback as RuntimeFeedback,
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
import { createNpcState } from '../data/npcPersonalities';
import { NPC_FLOOR, getNpc } from '../data/npcs';
import { getItem } from '../data/items';
import { INTERACT_DISTANCE } from '../core/constants';
import { loadNpcState, recordMemory, saveNpcState } from '../systems/NpcMemory';
import {
  createCompetitionNpcMemoryId,
  loadCompetitionNpcMemory,
  saveCompetitionNpcMemory,
} from '../systems/CompetitionNpcMemoryStore';
import { loadNpcInventory, saveNpcInventory } from '../systems/NpcInventory';
import { ALIN_REPAIR_GATE_ID, ALIN_REPAIR_MATERIALS, isAlinRepairGateOpen } from '../data/floorGates';

export type AlinGiftScenarioStatus = 'executed' | 'blocked' | 'exhausted' | 'planning_failed';

export interface AlinGiftScenarioResult {
  readonly status: AlinGiftScenarioStatus;
  readonly attempts: number;
  readonly observation: CompetitionObservationSnapshot;
  readonly proposal: CompetitionActionProposal | null;
  readonly validation: CompetitionValidationResult | null;
  readonly execution: CompetitionExecutionOutcome | null;
  readonly feedback: readonly RuntimeFeedback[];
  readonly before: CompetitionWorldStateSnapshot;
  readonly after: CompetitionWorldStateSnapshot;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly reason: string;
}

function cloneInventory(inventory: readonly InventoryStack[]): InventoryStack[] {
  return inventory.map((stack) => ({ ...stack, ...(stack.meta ? { meta: { ...stack.meta } } : {}) }));
}

function ensureAlinState(game: GameState) {
  const raw = game.npcStates?.alin;
  if (raw !== undefined) return loadNpcState(game, 'alin');
  const initial = createNpcState('ally');
  initial.relationship.player = COMPETITION_TRUST_BASE;
  // Do not materialize a default NPC record before the validator accepts a gift.
  return initial;
}

function trustOf(game: GameState): number {
  return loadNpcState(game, 'alin')?.relationship.player ?? COMPETITION_TRUST_BASE;
}

function gateStatus(game: GameState): 'open' | 'closed' {
  return isAlinRepairGateOpen(game) ? 'open' : 'closed';
}

function worldSnapshot(game: GameState): CompetitionWorldStateSnapshot {
  const alin = getNpc('alin');
  const trust = trustOf(game);
  const gate = gateStatus(game);
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
    npcs: [{
      npcId: 'alin',
      position: { floor: NPC_FLOOR, x: alin.x },
      hp: 0,
      hunger: 0,
      trust,
      affinity: 0,
      tension: 0,
      status: game.currentFloor === NPC_FLOOR ? 'available' : 'absent',
      goal: {
        goalId: ALIN_REPAIR_GATE_ID,
        kind: 'custom',
        sinceDay: 1,
        status: gate === 'open' ? 'complete' : 'active',
        target: ALIN_REPAIR_GATE_ID,
      },
      memory: loadCompetitionNpcMemory(game, 'alin'),
      lastAction: null,
      inventory: loadNpcInventory(game, 'alin'),
    }],
    groundItems: [],
    gates: [{ gateId: ALIN_REPAIR_GATE_ID, floor: NPC_FLOOR, status: gate }],
  };
}

function observationFromWorld(world: CompetitionWorldStateSnapshot, sequence: number): CompetitionObservationSnapshot {
  return {
    observationId: `${world.seed}:${world.day}:${world.gameMinute}:${sequence}`,
    world,
    focus: { kind: 'npc', npcId: 'alin' },
    availableActions: world.currentFloor === NPC_FLOOR ? ['observe', 'give'] : ['observe'],
    recentFacts: [
      `阿林信任:${world.npcs[0]?.trust ?? COMPETITION_TRUST_BASE}`,
      `玩家库存物品种类:${world.player.inventory.length}`,
      `阿林库存物品种类:${world.npcs[0]?.inventory.length ?? 0}`,
      `已记录结构化记忆:${world.npcs[0]?.memory.length ?? 0}`,
    ],
  };
}

function validationState(observation: CompetitionObservationSnapshot) {
  return {
    currentFloor: observation.world.currentFloor,
    player: observation.world.player,
    npcs: observation.world.npcs,
    gates: observation.world.gates,
  };
}

function executorState(world: CompetitionWorldStateSnapshot): CompetitionDemoState {
  const npc = world.npcs[0]!;
  return {
    currentFloor: world.currentFloor,
    // Detached copies keep the executor's staged mutations away from GameState
    // until the adapter has persisted every NPC-side effect successfully.
    player: { position: { ...world.player.position }, inventory: cloneInventory(world.player.inventory) },
    npcs: [{
      npcId: npc.npcId,
      position: { ...npc.position },
      status: npc.status,
      trust: npc.trust,
      inventory: cloneInventory(npc.inventory),
    }],
    gates: world.gates.map((gate) => ({ ...gate })),
    appliedOperationIds: new Set<string>(),
  };
}

function memoryId(game: GameState): string {
  const existing = loadCompetitionNpcMemory(game, 'alin');
  let sequence = existing.length;
  let id = createCompetitionNpcMemoryId(game.runSeed, 'alin', game.day, sequence);
  while (existing.some((entry) => entry.memoryId === id)) {
    sequence += 1;
    id = createCompetitionNpcMemoryId(game.runSeed, 'alin', game.day, sequence);
  }
  return id;
}

function commitGift(
  game: GameState,
  staged: CompetitionDemoState,
  baselineNpcState: NonNullable<ReturnType<typeof loadNpcState>>,
  trustBefore: number,
  day: number,
  minute: number,
  memoryEntry: ReturnType<typeof makeGiftMemoryEntry>,
): boolean {
  const stagedNpc = staged.npcs[0];
  if (!stagedNpc) return false;
  const hadNpcStates = game.npcStates !== undefined;
  const originalNpcBlob = game.npcStates?.alin;
  const originalPlayerInventory = cloneInventory(game.player.inventory.slots);
  const stagedGame: GameState = { ...game, npcStates: { ...(game.npcStates ?? {}) } };
  const priorCompetitionMemories = loadCompetitionNpcMemory(stagedGame, 'alin');

  try {
    const persisted = loadNpcState(stagedGame, 'alin') ?? baselineNpcState;
    const source = {
      ...persisted,
      relationship: { ...persisted.relationship, player: trustBefore },
    };
    const next = recordMemory(source, {
      day,
      minute,
      kind: 'gift',
      actor: 'player',
      summary: `玩家赠送${getItem(memoryEntry.value.split(':')[0] as ItemId).displayName}×${memoryEntry.value.split(':')[1]}`,
    });
    // The executor's validated delta is authoritative; recordMemory computes the
    // matching existing relationship rule and appends the generic NPC memory.
    next.relationship.player = stagedNpc.trust;
    // saveNpcState serializes exactly the supplied object. If that object lacks
    // optional extension keys, they are overwritten; write generic state first,
    // then restore inventory and all prior/new competition memories via adapters.
    saveNpcState(stagedGame, 'alin', next);
    if (!saveNpcInventory(stagedGame, 'alin', stagedNpc.inventory)) throw new Error('invalid_npc_inventory');
    for (const priorEntry of priorCompetitionMemories) {
      if (!saveCompetitionNpcMemory(stagedGame, 'alin', priorEntry)) throw new Error('invalid_existing_competition_memory');
    }
    if (!saveCompetitionNpcMemory(stagedGame, 'alin', memoryEntry)) throw new Error('invalid_competition_memory');
    if (!loadNpcState(stagedGame, 'alin')) throw new Error('invalid_npc_state');
    if (JSON.stringify(loadNpcInventory(stagedGame, 'alin')) !== JSON.stringify(stagedNpc.inventory)) {
      throw new Error('npc_inventory_not_persisted');
    }
    const savedCompetitionMemories = loadCompetitionNpcMemory(stagedGame, 'alin');
    if (!priorCompetitionMemories.every((entry) => savedCompetitionMemories.some((saved) => saved.memoryId === entry.memoryId)) ||
        !savedCompetitionMemories.some((entry) => entry.memoryId === memoryEntry.memoryId)) {
      throw new Error('competition_memory_not_persisted');
    }

    const nextNpcBlob = stagedGame.npcStates.alin;
    if (typeof nextNpcBlob !== 'string') throw new Error('npc_state_not_serialized');
    // No awaits occur between these two writes. If either write fails, restore the
    // exact original NPC bytes and player inventory rather than reporting success.
    game.npcStates ??= {};
    game.npcStates.alin = nextNpcBlob;
    game.player.inventory.slots.splice(0, game.player.inventory.slots.length, ...cloneInventory(staged.player.inventory));
    return true;
  } catch {
    try {
      if (!hadNpcStates) Reflect.deleteProperty(game, 'npcStates');
      else if (originalNpcBlob === undefined) delete game.npcStates.alin;
      else game.npcStates.alin = originalNpcBlob;
    } catch {
      // Best-effort restoration for hostile/non-standard GameState objects.
    }
    try {
      game.player.inventory.slots.splice(0, game.player.inventory.slots.length, ...originalPlayerInventory);
    } catch {
      // The transaction still reports failure; do not mask the original error.
    }
    return false;
  }
}

function makeGiftMemoryEntry(game: GameState, itemId: ItemId, quantity: number) {
  return {
    kind: 'fact' as const,
    memoryId: memoryId(game),
    day: game.day,
    subject: 'player_gift',
    value: `${itemId}:${quantity}`,
  };
}

function reasonText(validation: CompetitionValidationResult | null, status: AlinGiftScenarioStatus, itemId: ItemId, quantity: number, trust: number): string {
  if (status === 'executed') return `已将${getItem(itemId).displayName}×${quantity}交给阿林；信任按既有礼物记忆规则更新。`;
  if (!validation) return status === 'planning_failed' ? '规划未完成；游戏状态未改变。' : '没有提交赠礼；游戏状态未改变。';
  if (validation.accepted) return '动作已通过校验。';
  if (validation.reason === 'missing_item') return '背包中没有足够物品；未执行赠礼。';
  if (validation.reason === 'too_far') return '阿林不在可交互距离；未执行赠礼。';
  if (validation.reason === 'low_trust') return `当前信任 ${trust}，NPC 不愿交出物品；未执行赠礼。`;
  if (validation.detailCode === 'reserved_player_materials') return '木材×2和胶带×1已为维修门预留；请先修门，或赠送其他物品。';
  return `校验拒绝（${validation.detailCode ?? validation.reason}）；未执行赠礼。`;
}

/**
 * Run one player-selected, rule-validated gift through the competition runtime.
 * The transfer is committed to the real GameState only after validation; NPC
 * inventory, relationship, and both memory layers are then persisted together.
 */
export async function runAlinGiftScenario(game: GameState, itemId: ItemId, quantity = 1): Promise<AlinGiftScenarioResult> {
  const npcState = ensureAlinState(game);
  const firstWorld = worldSnapshot(game);
  const firstObservation = observationFromWorld(firstWorld, 0);
  const before = firstWorld;
  const feedback: RuntimeFeedback[] = [];

  if (!npcState) {
    const validation: CompetitionValidationResult = {
      accepted: false,
      reason: 'invalid_target',
      detailCode: 'invalid_npc_state',
      expectedStateDelta: {
        inventory: [], trust: [], relationships: [], memoryAdded: [], flags: [], hp: [], positions: [], gateStatus: [], elapsedMinutes: 0,
      },
    };
    const hash = await hashCompetitionWorldState(firstWorld);
    return {
      status: 'blocked', attempts: 0, observation: firstObservation, proposal: null, validation,
      execution: null, feedback, before, after: firstWorld, beforeHash: hash, afterHash: hash,
      reason: '阿林存档状态无效；赠礼未执行。',
    };
  }

  const trustBefore = npcState.relationship.player ?? COMPETITION_TRUST_BASE;
  // GameScene advances gameMinuteOfDay fractionally between frames, while the
  // persisted NPC memory schema intentionally accepts whole in-game minutes.
  const giftMinute = Math.floor(game.gameMinuteOfDay);
  const relationshipSource = {
    ...npcState,
    relationship: { ...npcState.relationship, player: trustBefore },
  };
  const preview = recordMemory(relationshipSource, {
    day: game.day,
    minute: giftMinute,
    kind: 'gift',
    actor: 'player',
    summary: `玩家赠送${getItem(itemId).displayName}×${quantity}`,
  });
  const trustDelta = preview.relationship.player - trustBefore;
  const policy: CompetitionRulesPolicy = {
    maxInteractionDistance: INTERACT_DISTANCE,
    trustDeltas: { give: trustDelta },
    ...(isAlinRepairGateOpen(game) ? {} : { reservedPlayerMaterials: ALIN_REPAIR_MATERIALS }),
  };
  const entry = makeGiftMemoryEntry(game, itemId, quantity);
  const transfer = {
    from: 'player' as const,
    to: { kind: 'npc' as const, npcId: 'alin' },
    itemId,
    quantity,
  };
  const proposal: CompetitionActionProposal = { kind: 'give', transfer };
  const staged = executorState(firstWorld);
  let observationSequence = 1;
  let finalObservation = firstObservation;

  const runtime = await runCompetitionStep({
    observe: async () => {
      const fresh = observationFromWorld(worldSnapshot(game), observationSequence++);
      finalObservation = fresh;
      return fresh;
    },
    selectGoal: async (observation) => ({
      goalId: ALIN_REPAIR_GATE_ID,
      kind: 'custom',
      sinceDay: 1,
      status: observation.world.gates[0]?.status === 'open' ? 'complete' : 'active',
      target: ALIN_REPAIR_GATE_ID,
    }),
    plan: async (_observation, _goal, previousFeedback): Promise<CompetitionPlan> => ({
      nextAction: previousFeedback ? 'observe' : 'give',
    }),
    propose: async (observation, _goal, plan, previousFeedback) =>
      !previousFeedback && plan.nextAction === 'give' && observation.availableActions.includes('give') ? proposal : null,
    fallback: async (_observation, _goal, plan, previousFeedback) =>
      !previousFeedback && plan.nextAction === 'give' ? proposal : null,
    validate: async (observation, candidate) => validateCompetitionProposal(validationState(observation), candidate, policy),
    execute: async (observation, candidate) => {
      const current = worldSnapshot(game);
      if (serializeCompetitionWorldState(current) !== serializeCompetitionWorldState(observation.world)) {
        return { status: 'interrupted', actualStateDelta: null };
      }
      const committed = executeCompetitionProposal(staged, candidate, {
        operationId: `alin-gift:${game.runSeed}:${game.day}:${game.gameMinuteOfDay}:${itemId}:${quantity}`,
        policy,
      });
      if (committed.status !== 'executed') return { status: 'failed', actualStateDelta: null };
      if (!commitGift(game, staged, npcState, trustBefore, game.day, giftMinute, entry)) {
        return { status: 'failed', actualStateDelta: null };
      }
      return {
        status: 'completed',
        actualStateDelta: {
          ...committed.actualStateDelta,
          memoryAdded: [...committed.actualStateDelta.memoryAdded, { npcId: 'alin', entry }],
        },
      };
    },
    feedback: async (result) => { feedback.push(result); },
  }, { maxAttempts: 2 });

  const after = worldSnapshot(game);
  const [beforeHash, afterHash] = await Promise.all([
    hashCompetitionWorldState(before),
    hashCompetitionWorldState(after),
  ]);
  const lastRejected = [...feedback].reverse().find((item) => item.outcome === 'validation_rejected');
  const validation = runtime.validation ?? lastRejected?.validation ?? null;
  const status: AlinGiftScenarioStatus = runtime.status === 'executed'
    ? 'executed'
    : runtime.status === 'planning_failed'
      ? 'planning_failed'
      : validation && !validation.accepted ? 'blocked' : 'exhausted';
  return {
    status,
    attempts: runtime.attempts,
    observation: finalObservation,
    proposal: runtime.proposal ?? lastRejected?.proposal ?? null,
    validation,
    execution: runtime.execution ?? null,
    feedback,
    before,
    after,
    beforeHash,
    afterHash,
    reason: reasonText(validation, status, itemId, quantity, after.npcs[0]?.trust ?? COMPETITION_TRUST_BASE),
  };
}

export function actualGiftDeltaOf(result: AlinGiftScenarioResult): CompetitionStateDelta | null {
  return result.execution?.status === 'completed' ? result.execution.actualStateDelta : null;
}
