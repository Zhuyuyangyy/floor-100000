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
import { ALIN_REPAIR_GATE_FLAG, ALIN_REPAIR_GATE_ID, ALIN_REPAIR_MATERIALS, isAlinRepairGateOpen } from '../data/floorGates';
import { createNpcState } from '../data/npcPersonalities';
import { loadNpcState, saveNpcState } from '../systems/NpcMemory';
import { loadCompetitionNpcMemory } from '../systems/CompetitionNpcMemoryStore';
import { setFlag } from '../systems/WorldFlags';
import { INTERACT_DISTANCE } from '../core/constants';

/** Re-export the shared gate identity for the gift scenario and existing callers. */
export { ALIN_REPAIR_GATE_ID, ALIN_REPAIR_GATE_FLAG } from '../data/floorGates';
export const ALIN_REPAIR_MAX_ATTEMPTS = 2;

export type AlinRepairScenarioStatus = 'executed' | 'blocked' | 'already_open' | 'exhausted' | 'planning_failed';
/**
 * 这一次是谁决定的行为。
 *
 * 以前这里只有一个取值 `'offline-fallback'`——也就是说，无论玩家看到什么，
 * 决定「修还是不修」的都是一段确定性代码，模型从未参与。加 `'model'` 不是
 * 为了多一个枚举值，是为了让「这次真的是模型决定的」成为可断言、可展示的事实：
 * Judge Mode 显示的是这个字段，验收脚本断言的也是它。
 */
export type AlinRepairDecisionSource = 'offline-fallback' | 'model';

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
  /** Optional scenario overrides; the user-approved exact recipe is the default. */
  readonly policy?: CompetitionRulesPolicy;
  /**
   * 模型提案口：把「修不修」交还给模型，而不是由本文件的 `propose` 端口直接返回
   * 一个写死的 `repair_gate`。
   *
   * 为什么做成注入而不是在这里直接 import 模型客户端：
   * 1. 这个文件被 Spark 真机测试、线上代理、离线单测三处共用，任何一处硬绑网络
   *    都会让另外两处无法离线跑。
   * 2. 拒绝语义必须能被表达。旧实现在 `propose` 里无条件返回 repair_gate，
   *    于是「模型说不能修」这件事**在结构上无法发生**——不管模型说什么，门都会
   *    被修。让模型返回 `null`（不改世界）是这次改造的核心。
   *
   * 返回值约定：
   * - 返回一个 proposal → 交给 validator 独立裁决（模型仍不能自己决定成败）
   * - 返回 `null` → 模型不想动世界，本轮以 observe 收场，状态不变
   * - 抛异常 / 超时 → 由 runCompetitionStep 的 fallback 端口接管，玩家仍能玩
   */
  readonly proposeWithModel?: (input: ModelProposalInput) => Promise<CompetitionActionProposal | null>;
}

/** 模型提案口的类型别名，供场景层在字段/方法签名里直接引用。 */
export type AlinRepairModelPort = NonNullable<AlinRepairScenarioOptions['proposeWithModel']>;

/** 模型提案口拿得到的东西——只读，且不含 GameState 句柄。 */
export interface ModelProposalInput {
  readonly observation: CompetitionObservationSnapshot;
  /** 维修配方（模型不能自己改这份清单，只能照单申请）。 */
  readonly materials: readonly InventoryStack[];
  readonly gateId: string;
  /** 上一轮被拒的反馈；模型据此重规划，而不是重复同一个提案。 */
  readonly previousFeedback: CompetitionAttemptFeedback | null;
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

function gateStatus(game: GameState): 'open' | 'closed' {
  return isAlinRepairGateOpen(game) ? 'open' : 'closed';
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
    case 'repair_materials_unconfigured': return '维修材料配方未配置，安全拒绝。';
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
  const policy: CompetitionRulesPolicy = {
    // The NPC identity, interaction distance and repair recipe are shared facts.
    repairMaterials: cloneInventory(ALIN_REPAIR_MATERIALS),
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
  const modelPort = options.proposeWithModel;
  // 模型真正参与过（至少成功产出过一次提案）+ 它产出的东西真的被提交了，
  // 才允许把 decisionSource 标成 'model'。只发过请求没拿到提案的不算。
  let modelProposed = false;
  // 「模型明确表示不动」与「模型挂了」必须分开记。
  //
  // 这两件事在代码里都表现为「propose 没给出 proposal」，但语义完全相反：
  // 前者是模型做了决定（不该修），后者是降级（规则兜底）。如果混为一谈，
  // 要么模型的拒绝被 fallback 覆盖（模型白说了），要么降级被当成模型决策
  // （Judge Mode 骗人）。所以用一个显式标志把「模型说过不」钉住。
  let modelDeclinedToAct = false;
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
      // 注意：模型模式下**不能**沿用 offline 的 `previousFeedback → 直接放弃` 规则。
      // 那条规则的意思是「被拒了就别再试」，它让「失败后重规划」在结构上不可能发生
      // ——而这正是官方评分点要看的反馈修正。模型模式下把重规划交给模型自己：
      // 它可以从 repair_gate 转向 request_help，那是另一件事，不是重复同一个提案。
      if (modelPort) {
        if (!observation.availableActions.includes('repair_gate')) return null;
        const proposal = await modelPort({
          observation,
          materials: policy.repairMaterials ? cloneInventory(policy.repairMaterials) : [],
          gateId: ALIN_REPAIR_GATE_ID,
          previousFeedback,
        });
        // 走到这里说明模型正常应答了。它回 null 就是「我不动」，不是「我挂了」。
        if (!proposal) {
          modelDeclinedToAct = true;
          return null;
        }
        if (proposal.kind === 'repair_gate') modelProposed = true;
        return proposal;
      }
      if (previousFeedback || plan.nextAction !== 'repair_gate' || !observation.availableActions.includes('repair_gate')) return null;
      return {
        kind: 'repair_gate',
        gateId: ALIN_REPAIR_GATE_ID,
        // The proposal carries the approved default recipe. The validator still
        // independently verifies the exact material identities and quantities.
        materials: policy.repairMaterials ? cloneInventory(policy.repairMaterials) : [],
      };
    },
    fallback: async (_observation, _goal, plan, reason) => {
      // 模型模式下 fallback 仍然保留：模型超时/不可达时玩家必须还能玩完这件事。
      // 但它的产出会被 decisionSource 明确标成 offline-fallback，不冒充模型。
      //
      // 这里第四个参数是 reason（'no_proposal' | 'proposal_unavailable' |
      // 'proposal_error'），不是上一轮的反馈。旧代码把它命名成 previousFeedback
      // 并拿来做 `if (previousFeedback || ...)` 的守卫——一个非空字符串永远为真，
      // 于是这个 fallback **从来没有执行过一行**，「模型超时自动降级」这条护栏
      // 一直是死的。离线路径测不出来，因为离线时 propose 总成功，走不到这里。
      //
      // 现在按 plan 判断：plan 说该修就修，说观望就不动。reason 只用于判断
      // 是否需要额外说明，不影响是否兜底。
      void reason;
      // 模型明确说了「我不动」——这时 fallback 不许替它动。
      // 否则模型的拒绝语义形同虚设：它说了不能修，系统照样把门修了，
      // 而玩家看到的是「阿林拒绝了你」＋「门开了」。
      if (modelDeclinedToAct) return null;
      if (plan.nextAction !== 'repair_gate') return null;
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
    // 只有「模型产出了 repair_gate 提案」且「它真的被提交成功」两个条件同时成立，
    // 才敢说这次是模型决定的。模型空手而归、或者提案被 validator 拦下的，
    // 都不算模型改变了世界——那种情况下把 source 标成 model 就是在骗评委。
    decisionSource: modelProposed && status === 'executed' ? 'model' : 'offline-fallback',
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
