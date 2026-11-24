import { describe, expect, it } from 'vitest';
import type {
  CompetitionActionProposal,
  CompetitionGoalSnapshot,
  CompetitionObservationSnapshot,
  CompetitionStateDelta,
  CompetitionValidationResult,
} from './competition-contract';
import {
  runCompetitionStep,
  type CompetitionAttemptFeedback,
  type CompetitionExecutionOutcome,
  type CompetitionRuntimePorts,
} from './competitionRuntime';

const delta: CompetitionStateDelta = {
  inventory: [], trust: [], relationships: [], memoryAdded: [], flags: [], hp: [], positions: [], gateStatus: [],
  elapsedMinutes: 0,
};
const goal: CompetitionGoalSnapshot = { goalId: 'survive', kind: 'survive', sinceDay: 1, status: 'active' };
const proposal: CompetitionActionProposal = { kind: 'observe' };
const accepted: CompetitionValidationResult = { accepted: true, reason: 'ok', expectedStateDelta: delta };
const rejected: CompetitionValidationResult = { accepted: false, reason: 'too_dangerous', expectedStateDelta: delta };

function observation(id: string, availableActions: CompetitionObservationSnapshot['availableActions'] = ['observe']): CompetitionObservationSnapshot {
  return {
    observationId: id,
    world: {
      seed: 17,
      day: 1,
      gameMinute: 480,
      currentFloor: 1,
      flags: {},
      threats: [],
      player: {
        position: { floor: 1, x: 12 }, hp: 100, hunger: 0, thirst: 0, energy: 100, inventory: [],
      },
      npcs: [],
      groundItems: [],
      gates: [],
    },
    focus: null,
    availableActions,
    recentFacts: [],
  };
}

function ports(overrides: Partial<CompetitionRuntimePorts> = {}): CompetitionRuntimePorts {
  let observationCount = 0;
  return {
    observe: async () => observation(`obs-${++observationCount}`),
    selectGoal: async () => goal,
    plan: async () => ({ nextAction: 'observe' }),
    propose: async () => proposal,
    fallback: async () => null,
    validate: async () => accepted,
    execute: async () => ({ status: 'completed', actualStateDelta: delta }),
    feedback: async () => undefined,
    ...overrides,
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

describe('runCompetitionStep', () => {
  it('完成 observe→goal/plan→proposal→validate→execute→feedback，且一轮只执行一个动作', async () => {
    const calls: string[] = [];
    const events: CompetitionAttemptFeedback[] = [];
    let executeCount = 0;
    const runtime = ports({
      observe: async () => { calls.push('observe'); return observation('success'); },
      selectGoal: async () => { calls.push('goal'); return goal; },
      plan: async () => { calls.push('plan'); return { nextAction: 'observe' }; },
      propose: async () => { calls.push('propose'); return proposal; },
      validate: async () => { calls.push('validate'); return accepted; },
      execute: async () => {
        calls.push('execute');
        executeCount += 1;
        return { status: 'completed', actualStateDelta: delta };
      },
      feedback: async (result) => { calls.push('feedback'); events.push(result); },
    });

    const result = await runCompetitionStep(runtime);
    expect(result.status).toBe('executed');
    expect(result.attempts).toBe(1);
    expect(calls).toEqual(['observe', 'goal', 'plan', 'propose', 'validate', 'execute', 'feedback']);
    expect(executeCount).toBe(1);
    expect(events[0]?.outcome).toBe('executed');
  });

  it('校验拒绝后先反馈，再重新观察、重新规划并重新校验', async () => {
    const seen: string[] = [];
    const validationObservations: string[] = [];
    const feedbacks: CompetitionAttemptFeedback[] = [];
    let nextObservation = 0;
    const runtime = ports({
      observe: async () => observation(`reject-${++nextObservation}`),
      plan: async (snapshot) => { seen.push(`plan:${snapshot.observationId}`); return { nextAction: 'observe' }; },
      validate: async (snapshot) => {
        validationObservations.push(snapshot.observationId);
        return snapshot.observationId === 'reject-1' ? rejected : accepted;
      },
      execute: async (snapshot) => {
        seen.push(`execute:${snapshot.observationId}`);
        return { status: 'completed', actualStateDelta: delta };
      },
      feedback: async (result) => { feedbacks.push(result); },
    });

    const result = await runCompetitionStep(runtime, { maxAttempts: 2 });
    expect(result.status).toBe('executed');
    expect(result.attempts).toBe(2);
    expect(validationObservations).toEqual(['reject-1', 'reject-2']);
    expect(seen).toEqual(['plan:reject-1', 'plan:reject-2', 'execute:reject-2']);
    expect(feedbacks.map(({ outcome }) => outcome)).toEqual(['validation_rejected', 'executed']);
  });

  it('执行失败后重新观察和重新验证，并将失败反馈交给下一轮规划', async () => {
    const validatedOn: string[] = [];
    const plannedWithFeedback: Array<CompetitionAttemptFeedback['outcome'] | null> = [];
    const feedbacks: CompetitionAttemptFeedback[] = [];
    let sequence = 0;
    let executeCount = 0;
    const runtime = ports({
      observe: async () => observation(`exec-${++sequence}`),
      plan: async (_snapshot, _goal, previous) => {
        plannedWithFeedback.push(previous?.outcome ?? null);
        return { nextAction: 'observe' };
      },
      validate: async (snapshot) => { validatedOn.push(snapshot.observationId); return accepted; },
      execute: async (): Promise<CompetitionExecutionOutcome> => {
        executeCount += 1;
        return executeCount === 1
          ? { status: 'failed', actualStateDelta: null }
          : { status: 'completed', actualStateDelta: delta };
      },
      feedback: async (result) => { feedbacks.push(result); },
    });

    const result = await runCompetitionStep(runtime, { maxAttempts: 2 });
    expect(result.status).toBe('executed');
    expect(result.attempts).toBe(2);
    expect(validatedOn).toEqual(['exec-1', 'exec-2']);
    expect(plannedWithFeedback).toEqual([null, 'execution_failed']);
    expect(feedbacks.map(({ outcome }) => outcome)).toEqual(['execution_failed', 'executed']);
    expect(executeCount).toBe(2);
  });

  it('执行期间道路封锁后用失败反馈重规划为撤退，并在新观察下校验和执行', async () => {
    let eventInjected = false;
    let observationCount = 0;
    let executeCount = 0;
    const observed: CompetitionObservationSnapshot[] = [];
    const plannedActions: string[] = [];
    const validatedActions: string[] = [];
    const feedbacks: CompetitionAttemptFeedback[] = [];
    const runtime = ports({
      observe: async () => {
        const base = observation(`blocked-route-${++observationCount}`, ['repair_gate', 'retreat', 'observe']);
        const snapshot = {
          ...base,
          world: {
            ...base.world,
            gates: [{ gateId: 'alin-repair-gate', floor: 1, status: eventInjected ? 'blocked' as const : 'closed' as const }],
          },
          recentFacts: eventInjected ? ['event:road_blocked'] : [],
        };
        observed.push(snapshot);
        return snapshot;
      },
      plan: async (snapshot, _goal, previous) => {
        const nextAction = previous?.outcome === 'execution_failed' && snapshot.recentFacts.includes('event:road_blocked')
          ? 'retreat' as const
          : 'repair_gate' as const;
        plannedActions.push(nextAction);
        return { nextAction };
      },
      propose: async (_snapshot, _goal, plan) => plan.nextAction === 'repair_gate'
        ? { kind: 'repair_gate', gateId: 'alin-repair-gate', materials: [] }
        : { kind: 'retreat', destination: { floor: 1, x: 12 } },
      validate: async (_snapshot, candidate) => {
        validatedActions.push(candidate.kind);
        return accepted;
      },
      execute: async (_snapshot, candidate) => {
        executeCount += 1;
        if (executeCount === 1) {
          eventInjected = true;
          return { status: 'failed', actualStateDelta: null };
        }
        return candidate.kind === 'retreat' && eventInjected
          ? { status: 'completed', actualStateDelta: delta }
          : { status: 'failed', actualStateDelta: null };
      },
      feedback: async (result) => { feedbacks.push(result); },
    });

    const result = await runCompetitionStep(runtime, { maxAttempts: 2 });

    expect(result).toMatchObject({ status: 'executed', attempts: 2, proposal: { kind: 'retreat' } });
    expect(observed).toHaveLength(2);
    expect(observed[1]?.recentFacts).toContain('event:road_blocked');
    expect(observed[1]?.world.gates[0]?.status).toBe('blocked');
    expect(plannedActions).toEqual(['repair_gate', 'retreat']);
    expect(validatedActions).toEqual(['repair_gate', 'retreat']);
    expect(executeCount).toBe(2);
    expect(feedbacks.map(({ outcome }) => outcome)).toEqual(['execution_failed', 'executed']);
  });

  it('将重试次数封顶，且不修改只读观察/存档形状或接触状态写入端口', async () => {
    const legacySaveLike = deepFreeze({ version: 1, gameState: { hp: 77, flags: { old: 1 } } });
    const before = JSON.stringify(legacySaveLike);
    const snapshot = deepFreeze(observation('readonly'));
    const executeInputs: unknown[] = [];
    const runtime = ports({
      observe: async () => snapshot,
      validate: async () => rejected,
      execute: async (seen) => {
        executeInputs.push(seen);
        return { status: 'completed', actualStateDelta: delta };
      },
    });
    const result = await runCompetitionStep(runtime, { maxAttempts: 99 });

    expect(result).toEqual({ status: 'exhausted', attempts: 3 });
    expect(executeInputs).toEqual([]);
    expect(JSON.stringify(legacySaveLike)).toBe(before);
    expect(JSON.stringify(snapshot)).toContain('readonly');
    expect(Object.keys(runtime).sort()).toEqual([
      'execute', 'fallback', 'feedback', 'observe', 'plan', 'propose', 'selectGoal', 'validate',
    ]);
  });

  it('fallback 提案必须属于本次 availableActions，否则不校验也不执行', async () => {
    let validationCount = 0;
    let executionCount = 0;
    let fallbackCount = 0;
    const feedbacks: CompetitionAttemptFeedback[] = [];
    const runtime = ports({
      observe: async () => observation('fallback-gate', ['observe']),
      propose: async () => null,
      fallback: async () => {
        fallbackCount += 1;
        return { kind: 'ask', npcId: 'alin', question: '安全么？' };
      },
      validate: async () => { validationCount += 1; return accepted; },
      execute: async () => {
        executionCount += 1;
        return { status: 'completed', actualStateDelta: delta };
      },
      feedback: async (result) => { feedbacks.push(result); },
    });

    const result = await runCompetitionStep(runtime, { maxAttempts: 1 });
    expect(result).toEqual({ status: 'exhausted', attempts: 1 });
    expect(fallbackCount).toBe(1);
    expect(validationCount).toBe(0);
    expect(executionCount).toBe(0);
    expect(feedbacks[0]?.outcome).toBe('no_proposal');
  });
});
