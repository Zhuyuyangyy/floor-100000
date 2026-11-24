import type {
  CompetitionActionKind,
  CompetitionActionProposal,
  CompetitionGoalSnapshot,
  CompetitionObservationSnapshot,
  CompetitionStateDelta,
  CompetitionValidationResult,
} from './competition-contract';

/** 单次计划只标记下一步动作；运行时不会执行一组动作或访问游戏循环。 */
export interface CompetitionPlan {
  readonly nextAction: CompetitionActionKind;
}

export type CompetitionExecutionOutcome =
  | { readonly status: 'completed'; readonly actualStateDelta: CompetitionStateDelta }
  | { readonly status: 'failed' | 'interrupted'; readonly actualStateDelta?: CompetitionStateDelta | null };

export type CompetitionAttemptFeedback =
  | {
      readonly attempt: number;
      readonly outcome: 'executed';
      readonly observation: CompetitionObservationSnapshot;
      readonly goal: CompetitionGoalSnapshot;
      readonly proposal: CompetitionActionProposal;
      readonly validation: CompetitionValidationResult;
      readonly execution: Extract<CompetitionExecutionOutcome, { status: 'completed' }>;
    }
  | {
      readonly attempt: number;
      readonly outcome: 'validation_rejected' | 'execution_failed' | 'no_proposal' | 'proposal_unavailable' | 'planning_failed';
      readonly observation: CompetitionObservationSnapshot;
      readonly goal?: CompetitionGoalSnapshot;
      readonly proposal?: CompetitionActionProposal;
      readonly validation?: CompetitionValidationResult;
      readonly execution?: CompetitionExecutionOutcome;
    };

/**
 * All effects and policy decisions are ports. In particular, neither the observer
 * nor executor receives a GameState/save handle from this runtime.
 */
export interface CompetitionRuntimePorts {
  observe(): Promise<CompetitionObservationSnapshot>;
  selectGoal(
    observation: CompetitionObservationSnapshot,
    previousFeedback: CompetitionAttemptFeedback | null,
  ): Promise<CompetitionGoalSnapshot>;
  plan(
    observation: CompetitionObservationSnapshot,
    goal: CompetitionGoalSnapshot,
    previousFeedback: CompetitionAttemptFeedback | null,
  ): Promise<CompetitionPlan>;
  propose(
    observation: CompetitionObservationSnapshot,
    goal: CompetitionGoalSnapshot,
    plan: CompetitionPlan,
    previousFeedback: CompetitionAttemptFeedback | null,
  ): Promise<CompetitionActionProposal | null>;
  fallback(
    observation: CompetitionObservationSnapshot,
    goal: CompetitionGoalSnapshot,
    plan: CompetitionPlan,
    reason: 'no_proposal' | 'proposal_unavailable' | 'proposal_error',
  ): Promise<CompetitionActionProposal | null>;
  validate(
    observation: CompetitionObservationSnapshot,
    proposal: CompetitionActionProposal,
  ): Promise<CompetitionValidationResult>;
  /** One invocation may execute exactly one proposal. */
  execute(
    observation: CompetitionObservationSnapshot,
    proposal: CompetitionActionProposal,
    validation: Extract<CompetitionValidationResult, { accepted: true }>,
  ): Promise<CompetitionExecutionOutcome>;
  feedback(result: CompetitionAttemptFeedback): Promise<void>;
}

export interface CompetitionRuntimeResult {
  readonly status: 'executed' | 'exhausted' | 'planning_failed';
  readonly attempts: number;
  readonly goal?: CompetitionGoalSnapshot;
  readonly proposal?: CompetitionActionProposal;
  readonly validation?: CompetitionValidationResult;
  readonly execution?: CompetitionExecutionOutcome;
}

export interface CompetitionRuntimeOptions {
  /** Total fresh observe/plan/validate attempts, including the first one. */
  readonly maxAttempts?: number;
}

/** Keep bounded even if a caller accidentally supplies an untrusted retry count. */
export const MAX_COMPETITION_RUNTIME_ATTEMPTS = 3;
const DEFAULT_ATTEMPTS = 2;

function boundedAttempts(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_ATTEMPTS;
  return Math.max(1, Math.min(MAX_COMPETITION_RUNTIME_ATTEMPTS, Math.floor(value as number)));
}

/**
 * Run at most one successful game action. Any rejection or failed execution is
 * fed back, then the next attempt starts with a fresh observation and performs
 * goal selection, planning, proposal and validation again.
 */
export async function runCompetitionStep(
  ports: CompetitionRuntimePorts,
  options: CompetitionRuntimeOptions = {},
): Promise<CompetitionRuntimeResult> {
  const maxAttempts = boundedAttempts(options.maxAttempts);
  let previousFeedback: CompetitionAttemptFeedback | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let observation: CompetitionObservationSnapshot;
    try {
      observation = await ports.observe();
    } catch {
      return { status: 'planning_failed', attempts: attempt };
    }

    let goal: CompetitionGoalSnapshot;
    let plan: CompetitionPlan;
    try {
      goal = await ports.selectGoal(observation, previousFeedback);
      plan = await ports.plan(observation, goal, previousFeedback);
    } catch {
      const result: CompetitionAttemptFeedback = { attempt, outcome: 'planning_failed', observation };
      await ports.feedback(result);
      return { status: 'planning_failed', attempts: attempt };
    }

    let proposal: CompetitionActionProposal | null = null;
    let fallbackReason: 'no_proposal' | 'proposal_unavailable' | 'proposal_error' | null = null;
    try {
      proposal = await ports.propose(observation, goal, plan, previousFeedback);
      if (proposal === null) fallbackReason = 'no_proposal';
      else if (!observation.availableActions.includes(proposal.kind)) fallbackReason = 'proposal_unavailable';
    } catch {
      fallbackReason = 'proposal_error';
    }

    if (fallbackReason !== null) {
      try {
        proposal = await ports.fallback(observation, goal, plan, fallbackReason);
      } catch {
        proposal = null;
      }
      // The fallback is untrusted too: never validate or execute an action which
      // is absent from this particular observation's available-action menu.
      if (proposal !== null && !observation.availableActions.includes(proposal.kind)) proposal = null;
    }

    if (proposal === null) {
      const result: CompetitionAttemptFeedback = {
        attempt,
        outcome: fallbackReason === 'proposal_unavailable' ? 'proposal_unavailable' : 'no_proposal',
        observation,
        goal,
      };
      await ports.feedback(result);
      previousFeedback = result;
      continue;
    }

    let validation: CompetitionValidationResult;
    try {
      validation = await ports.validate(observation, proposal);
    } catch {
      validation = {
        accepted: false,
        reason: 'invalid_target',
        expectedStateDelta: emptyDelta(),
      };
    }
    if (!validation.accepted) {
      const result: CompetitionAttemptFeedback = {
        attempt, outcome: 'validation_rejected', observation, goal, proposal, validation,
      };
      await ports.feedback(result);
      previousFeedback = result;
      continue;
    }

    let execution: CompetitionExecutionOutcome;
    try {
      execution = await ports.execute(observation, proposal, validation);
    } catch {
      execution = { status: 'failed', actualStateDelta: null };
    }
    if (execution.status === 'completed') {
      const result: CompetitionAttemptFeedback = {
        attempt, outcome: 'executed', observation, goal, proposal, validation, execution,
      };
      await ports.feedback(result);
      return { status: 'executed', attempts: attempt, goal, proposal, validation, execution };
    }

    const result: CompetitionAttemptFeedback = {
      attempt, outcome: 'execution_failed', observation, goal, proposal, validation, execution,
    };
    await ports.feedback(result);
    previousFeedback = result;
  }

  return { status: 'exhausted', attempts: maxAttempts };
}

function emptyDelta(): CompetitionStateDelta {
  return {
    inventory: [], trust: [], relationships: [], memoryAdded: [], flags: [], hp: [], positions: [], gateStatus: [],
    elapsedMinutes: 0,
  };
}
