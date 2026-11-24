import type {
  CompetitionActionProposal,
  CompetitionObservationSnapshot,
  CompetitionStateDelta,
  CompetitionValidationResult,
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
  COMPETITION_TRUST_THRESHOLDS,
  type CompetitionRulesPolicy,
  validateCompetitionProposal,
} from '../ai/competitionRules';
import { hashCompetitionWorldState, serializeCompetitionWorldState } from '../ai/competitionTrace';
import type { CompetitionWorldStateSnapshot } from '../ai/competition-contract';
import type { GameState, InventoryStack } from '../core/gameTypes';
import { NPC_FLOOR, getNpc } from '../data/npcs';
import { createNpcState } from '../data/npcPersonalities';
import { loadNpcState, saveNpcState } from '../systems/NpcMemory';
import { loadCompetitionNpcMemory } from '../systems/CompetitionNpcMemoryStore';
import { flagCount, flagKey, setFlag } from '../systems/WorldFlags';
import { INTERACT_DISTANCE } from '../core/constants';

/** This slice is intentionally a story/status flag, not a TowerNav route gate. */
export const ALIN_REPAIR_GATE_ID = 'alin-repair-gate';
export const ALIN_REPAIR_GATE_FLAG = flagKey.story(ALIN_REPAIR_GATE_ID);
export const ALIN_REPAIR_MAX_ATTEMPTS = 2;

export type AlinRepairScenarioStatus = 'executed' | 'blocked' | 'already_open' | 'exhausted' | 'planning_failed';
export type AlinRepairDecisionSource = 'offline-fallback';

export interface AlinRepairScenarioResult {
  readonly status: AlinRepairScenarioStatus;
  readonly attempts: number;
  readonly decisionSource: AlinRepairDecisionSource;
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

export interface AlinRepairScenarioOptions {
  /** Only explicit external configuration may supply an exact repair recipe. */
  readonly policy?: CompetitionRulesPolicy;
}

function cloneInventory(inventory: readonly InventoryStack[]): InventoryStack[] {
  return inventory.map((stack) => ({ ...stack, ...(stack.meta ? { meta: { ...stack.meta } } : {}) }));
}

function readNpcState(game: GameState) {
  const saved = loadNpcState(game, 'alin');
  if (saved) return saved;
  // Do not replace malformed legacy bytes. They remain readable by the old game;
  // this scenario simply uses the agreed default in its read-only projection.
  return createNpcState('ally');
}

/** Missing relationship data on old saves means the agreed starting trust (35). */
function trustOf(game: GameState): number {
  const value = readNpcState(game).relationship.player;
  return value === undefined ? COMPETITION_TRUST_BASE : value;
}

/** Seed the existing optional NPC state, without adding a required save field. */
function ensureInitialTrust(game: GameState): void {
  if (!game.npcStates) game.npcStates = {};
  const raw = game.npcStates?.alin;
  if (raw !== undefined) return;
  const npcState = createNpcState('ally');
  npcState.relationship.player = COMPETITION_TRUST_BASE;
  saveNpcState(game, 'alin', npcState);
}

function gateStatus(game: GameState): 'open' | 'closed' {
  return flagCount(game, ALIN_REPAIR_GATE_FLAG) > 0 ? 'open' : 'closed';
}

function gameWorldSnapshot(game: GameState): CompetitionWorldStateSnapshot {
  const alin = getNpc('alin');
  const trust = trustOf(game);
  const inventory = cloneInventory(game.player.inventory.slots);
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
      inventory,
    },
    npcs: [{
      npcId: 'alin',
      position: { floor: NPC_FLOOR, x: alin.x },
      // Civilian HP / affinity / tension are not modeled by GameState. Neutral
      // zero values are contract placeholders; they are never mutated here.
      hp: 0,
      hunger: 0,
      trust,
      affinity: 0,
      tension: 0,
      status: game.currentFloor === NPC_FLOOR ? 'available' : 'absent',
      goal: {
        goalId: 'alin-repair-gate',
        kind: 'custom',
        sinceDay: 1,
        status: gateStatus(game) === 'open' ? 'complete' : 'active',
        target: ALIN_REPAIR_GATE_ID,
      },
      memory: loadCompetitionNpcMemory(game, 'alin'),
      lastAction: null,
      // The existing NPC definition has no inventory field. Empty means no
      // scenario inventory has been configured, not an invented stock list.
      inventory: [],
    }],
    groundItems: [],
    gates: [{ gateId: ALIN_REPAIR_GATE_ID, floor: NPC_FLOOR, status: gateStatus(game) }],
  };
}

function observationFromWorld(
  world: CompetitionWorldStateSnapshot,
  sequence: number,
): CompetitionObservationSnapshot {
  return {
    observationId: `${world.seed}:${world.day}:${world.gameMinute}:${sequence}`,
    world,
    focus: { kind: 'npc', npcId: 'alin' },
    availableActions: world.gates[0]?.status === 'open' ? ['observe', 'inspect'] : ['observe', 'inspect', 'repair_gate'],
    recentFacts: [
      `阿林信任:${world.npcs[0]?.trust ?? COMPETITION_TRUST_BASE}`,
      `维修门:${world.gates[0]?.status ?? 'closed'}`,
      `维修门信任门槛:${COMPETITION_TRUST_THRESHOLDS.repairGate}`,
      `可读取的结构化记忆:${world.npcs[0]?.memory.length ?? 0}`,
    ],
  };
}

function executorState(game: GameState, world: CompetitionWorldStateSnapshot): CompetitionDemoState {
  const npcSnapshot = world.npcs[0]!;
  const npc: CompetitionDemoState['npcs'][number] = {
    npcId: 'alin',
    position: { ...npcSnapshot.position },
    status: npcSnapshot.status,
    trust: npcSnapshot.trust,
    inventory: [],
  };
  // The executor's `npc.trust += delta` is the only path that can persist a
  // configured trust delta into the existing relationship.player field.
  Object.defineProperty(npc, 'trust', {
    enumerable: true,
    get: () => trustOf(game),
    set: (value: number) => {
      const npcState = loadNpcState(game, 'alin');
      if (npcState && Number.isFinite(value)) {
        npcState.relationship.player = value;
        saveNpcState(game, 'alin', npcState);
      }
    },
  });
  const gate: CompetitionDemoState['gates'][number] = {
    gateId: ALIN_REPAIR_GATE_ID,
    floor: NPC_FLOOR,
    status: gateStatus(game),
  };
  // The executor changes this status only after every staged inventory and trust
  // mutation has passed; the setter stores that committed result in old-save-safe flags.
  Object.defineProperty(gate, 'status', {
    enumerable: true,
    get: () => gateStatus(game),
    set: (value: 'open' | 'closed' | 'blocked' | 'broken') => {
      if (value === 'open') setFlag(game, ALIN_REPAIR_GATE_FLAG, 1);
    },
  });
  return {
    currentFloor: world.currentFloor,
    player: {
      position: { ...world.player.position },
      // This is the live GameState array. The executor stages a clone and swaps
      // its contents only after validation succeeds.
      inventory: game.player.inventory.slots,
    },
    npcs: [npc],
    gates: [gate],
    appliedOperationIds: new Set<string>(),
  };
}

function validationState(observation: CompetitionObservationSnapshot) {
  const world = observation.world;
  return {
    currentFloor: world.currentFloor,
    player: world.player,
    npcs: world.npcs,
    gates: world.gates,
  };
}

function reasonText(validation: CompetitionValidationResult | null, status: AlinRepairScenarioStatus, trust = COMPETITION_TRUST_BASE): string {
  if (status === 'already_open') return '维修门记录为已打开；没有提交动作。';
  if (status === 'executed') return '维修门动作已由 executor 提交。';
  if (!validation) return status === 'planning_failed' ? '规划未完成；游戏状态未改变。' : '没有可提交的动作；游戏状态未改变。';
  if (validation.accepted) return '动作已通过校验。';
  switch (validation.detailCode) {
    case 'repair_materials_unconfigured': return '待确认：维修材料配方未配置，安全拒绝。';
    case 'repair_npc_unconfigured': return '待确认：维修责任 NPC 未配置，安全拒绝。';
    case 'gate_not_repairable': return '维修门当前状态不允许修理，安全拒绝。';
    case 'npc_out_of_reach': return '阿林不在可交互距离，安全拒绝。';
    default:
      if (validation.reason === 'low_trust') return `信任不足：当前 ${trust}，门槛为 ${COMPETITION_TRUST_THRESHOLDS.repairGate}；安全拒绝。`;
      if (validation.reason === 'missing_item') return '材料不足，安全拒绝。';
      if (validation.reason === 'too_far') return '不在同一可交互位置，安全拒绝。';
      return `校验拒绝（${validation.detailCode ?? validation.reason}）；游戏状态未改变。`;
  }
}

/**
 * Adapt the existing GameState to the A6 runtime. No Spark endpoint is guessed
 * or called: the structured repair proposal is explicitly offline-fallback.
 * The only inventory/gate/trust commit path is executeCompetitionProposal;
 * its live GameState adapters write to the existing inventory, NPC relationship,
 * and optional story flag fields only when the executor commits.
 */
export async function runAlinRepairScenario(
  game: GameState,
  options: AlinRepairScenarioOptions = {},
): Promise<AlinRepairScenarioResult> {
  ensureInitialTrust(game);
  const policy: CompetitionRulesPolicy = {
    // The NPC identity and interaction distance are existing scenario facts.
    // Repair materials and trust deltas remain absent until explicitly supplied.
    maxInteractionDistance: INTERACT_DISTANCE,
    repairNpcByGate: { [ALIN_REPAIR_GATE_ID]: 'alin' },
    ...options.policy,
  };
  const feedback: CompetitionAttemptFeedback[] = [];
  let observationSequence = 0;
  const firstWorld = gameWorldSnapshot(game);
  const firstObservation = observationFromWorld(firstWorld, observationSequence++);
  const before = firstWorld;
  let finalObservation = firstObservation;

  if (firstWorld.gates[0]?.status === 'open') {
    const hash = await hashCompetitionWorldState(firstWorld);
    return {
      status: 'already_open', attempts: 0, decisionSource: 'offline-fallback', observation: firstObservation,
      proposal: null, validation: null, execution: null, feedback,
      before, after: firstWorld, beforeHash: hash, afterHash: hash,
      reason: reasonText(null, 'already_open'),
    };
  }

  const liveExecutorState = executorState(game, firstWorld);
  const operationId = `alin-repair:${game.runSeed}:${game.day}:${game.gameMinuteOfDay}`;
  const runtime = await runCompetitionStep({
    observe: async () => {
      const world = gameWorldSnapshot(game);
      const fresh = observationFromWorld(world, observationSequence++);
      finalObservation = fresh;
      return fresh;
    },
    selectGoal: async (observation) => ({
      goalId: 'alin-repair-gate', kind: 'custom', sinceDay: 1, status: 'active', target: observation.world.gates[0]?.gateId,
    }),
    plan: async (_observation, _goal, previousFeedback): Promise<CompetitionPlan> => {
      // After a validator refusal, wait for an external state/configuration
      // change rather than repeat the same unsupported repair proposal.
      return { nextAction: previousFeedback ? 'observe' : 'repair_gate' };
    },
    propose: async (observation, _goal, plan, previousFeedback): Promise<CompetitionActionProposal | null> => {
      if (previousFeedback || plan.nextAction !== 'repair_gate' || !observation.availableActions.includes('repair_gate')) return null;
      return {
        kind: 'repair_gate',
        gateId: ALIN_REPAIR_GATE_ID,
        // Empty is a proposal placeholder, not a recipe assertion. The validator
        // rejects because policy.repairMaterials is deliberately unconfigured.
        materials: policy.repairMaterials ? cloneInventory(policy.repairMaterials) : [],
      };
    },
    fallback: async (_observation, _goal, plan, previousFeedback) => {
      if (previousFeedback || plan.nextAction !== 'repair_gate') return null;
      return {
        kind: 'repair_gate', gateId: ALIN_REPAIR_GATE_ID,
        materials: policy.repairMaterials ? cloneInventory(policy.repairMaterials) : [],
      };
    },
    validate: async (observation, proposal) => validateCompetitionProposal(validationState(observation), proposal, policy),
    execute: async (observation, proposal, _validation) => {
      // Reject stale proposals before executor invocation. A fresh runtime retry
      // will observe and re-plan instead of applying to a changed world.
      const current = gameWorldSnapshot(game);
      if (serializeCompetitionWorldState(current) !== serializeCompetitionWorldState(observation.world)) {
        return { status: 'interrupted', actualStateDelta: null };
      }
      const committed = executeCompetitionProposal(liveExecutorState, proposal, { operationId, policy });
      if (committed.status !== 'executed') return { status: 'failed', actualStateDelta: null };
      return { status: 'completed', actualStateDelta: committed.actualStateDelta };
    },
    feedback: async (result) => { feedback.push(result); },
  }, { maxAttempts: ALIN_REPAIR_MAX_ATTEMPTS });

  const after = gameWorldSnapshot(game);
  const [beforeHash, afterHash] = await Promise.all([
    hashCompetitionWorldState(before),
    hashCompetitionWorldState(after),
  ]);
  const lastRejected = [...feedback].reverse().find((item) => item.outcome === 'validation_rejected');
  const validation = runtime.validation ?? lastRejected?.validation ?? null;
  const status: AlinRepairScenarioStatus = runtime.status === 'executed'
    ? 'executed'
    : runtime.status === 'planning_failed'
      ? 'planning_failed'
      : validation && !validation.accepted ? 'blocked' : 'exhausted';
  return {
    status,
    attempts: runtime.attempts,
    decisionSource: 'offline-fallback',
    observation: finalObservation,
    proposal: runtime.proposal ?? lastRejected?.proposal ?? null,
    validation,
    execution: runtime.execution ?? null,
    feedback,
    before,
    after,
    beforeHash,
    afterHash,
    reason: reasonText(validation, status, after.npcs[0]?.trust ?? COMPETITION_TRUST_BASE),
  };
}

/** Export an immutable copy of a successful commit for UI and test assertions. */
export function actualDeltaOf(result: AlinRepairScenarioResult): CompetitionStateDelta | null {
  return result.execution?.status === 'completed' ? result.execution.actualStateDelta : null;
}
