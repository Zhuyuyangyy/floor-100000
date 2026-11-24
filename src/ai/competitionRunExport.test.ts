import { describe, expect, it } from 'vitest';
import type { CompetitionWorldStateSnapshot } from './competition-contract';
import type { AlinGiftScenarioResult } from '../scenarios/alinGiftDemo';
import type { AlinRepairScenarioResult } from '../scenarios/alinRepairDemo';
import { serializeAlinGiftRun, serializeAlinRepairRun } from './competitionRunExport';

function world(overrides: Partial<CompetitionWorldStateSnapshot> = {}): CompetitionWorldStateSnapshot {
  return {
    seed: 73,
    day: 2,
    gameMinute: 510,
    currentFloor: 6,
    flags: { 'alin-repair-gate-open': 0 },
    threats: [],
    player: {
      position: { floor: 6, x: 120 },
      hp: 80,
      hunger: 5,
      thirst: 8,
      energy: 90,
      inventory: [{ itemId: 'wood', quantity: 3 }],
    },
    npcs: [{
      npcId: 'alin',
      position: { floor: 6, x: 124 },
      hp: 0,
      hunger: 0,
      trust: 35,
      affinity: 0,
      tension: 0,
      status: 'available',
      goal: { goalId: 'alin-repair-gate', kind: 'custom', sinceDay: 1, status: 'active', target: 'gate-6' },
      memory: [{ kind: 'fact', memoryId: 'random-memory-123', day: 2, subject: 'shelter', value: 'safe' }],
      lastAction: null,
      inventory: [],
    }],
    groundItems: [],
    gates: [{ gateId: 'gate-6', floor: 6, status: 'closed' }],
    ...overrides,
  };
}

const emptyDelta = {
  inventory: [],
  trust: [],
  relationships: [],
  memoryAdded: [],
  flags: [],
  hp: [],
  positions: [],
  gateStatus: [],
  elapsedMinutes: 0,
};

function giftResult(): AlinGiftScenarioResult {
  const before = world();
  const after = world({
    player: { ...before.player, inventory: [{ itemId: 'wood', quantity: 2 }] },
    npcs: [{ ...before.npcs[0]!, trust: 36, inventory: [{ itemId: 'wood', quantity: 1 }], memory: [
      ...before.npcs[0]!.memory,
      { kind: 'fact', memoryId: 'another-random-memory', day: 2, subject: 'player_gift', value: 'wood:1' },
    ] }],
  });
  const observation = {
    observationId: 'observation-random-id',
    world: before,
    focus: { kind: 'npc', npcId: 'alin' },
    availableActions: ['observe', 'give'],
    recentFacts: ['阿林在附近。'],
  } as const;
  const proposal = { kind: 'give', transfer: { from: 'player', to: { kind: 'npc', npcId: 'alin' }, itemId: 'wood', quantity: 1 } } as const;
  const delta = {
    ...emptyDelta,
    inventory: [
      { owner: 'player', itemId: 'wood', quantityDelta: -1 },
      { owner: { kind: 'npc', npcId: 'alin' }, itemId: 'wood', quantityDelta: 1 },
    ],
    trust: [{ npcId: 'alin', delta: 1 }],
    relationships: [{ npcId: 'alin', trustDelta: 1 }],
    memoryAdded: [{ npcId: 'alin', entry: { kind: 'fact', memoryId: 'delta-memory-id', day: 2, subject: 'player_gift', value: 'wood:1' } }],
  };
  const validation = { accepted: true, reason: 'ok', expectedStateDelta: delta } as const;
  const execution = { status: 'completed', actualStateDelta: delta } as const;
  return {
    status: 'executed', attempts: 1, observation, proposal, validation, execution,
    feedback: [{ attempt: 1, outcome: 'executed', observation, goal: before.npcs[0]!.goal!, proposal, validation, execution }],
    before, after, beforeHash: 'before-hash-gift', afterHash: 'after-hash-gift', reason: 'completed',
  } as unknown as AlinGiftScenarioResult;
}

function repairResult(): AlinRepairScenarioResult {
  const before = world();
  const observation = {
    observationId: 'repair-observation-id',
    world: before,
    focus: { kind: 'npc', npcId: 'alin' },
    availableActions: ['observe', 'inspect', 'repair_gate'],
    recentFacts: ['维修门：closed'],
  } as const;
  const proposal = { kind: 'repair_gate', gateId: 'gate-6', materials: [] } as const;
  const validation = {
    accepted: false,
    reason: 'missing_item',
    detailCode: 'repair_materials_unconfigured',
    expectedStateDelta: emptyDelta,
  } as const;
  return {
    status: 'blocked', attempts: 1, decisionSource: 'offline-fallback', observation, proposal, validation,
    execution: null,
    feedback: [{ attempt: 1, outcome: 'validation_rejected', observation, goal: before.npcs[0]!.goal!, proposal, validation }],
    before, after: before, beforeHash: 'same-state-hash', afterHash: 'same-state-hash', reason: 'blocked',
  } as unknown as AlinRepairScenarioResult;
}

describe('Alin competition run JSON exporter', () => {
  it('exports gift snapshots, actual execution delta, feedback, hashes, and visible NPC memory', () => {
    const output = JSON.parse(serializeAlinGiftRun(giftResult()));

    expect(output).toMatchObject({
      format: 'floor-100000-competition-run',
      version: 1,
      scenario: 'alin-gift',
      seed: 73,
      mode: 'offline-fallback',
      decisionMode: 'rules',
      status: 'executed',
      attempts: 1,
      hashes: { stateBefore: 'before-hash-gift', stateAfter: 'after-hash-gift' },
    });
    expect(output.world.stateBefore.player.inventory).toEqual([{ itemId: 'wood', quantity: 3 }]);
    expect(output.world.stateAfter.player.inventory).toEqual([{ itemId: 'wood', quantity: 2 }]);
    expect(output.actualStateDelta.inventory).toHaveLength(2);
    expect(output.actualStateDelta.trust).toEqual([{ npcId: 'alin', delta: 1 }]);
    expect(output.feedback[0]).toMatchObject({ attempt: 1, status: 'executed', proposal: { kind: 'give' } });
    expect(output.replanFeedback).toEqual(output.feedback);
    expect(output.npcMemory.stateAfter[0].memory.at(-1)).toMatchObject({ subject: 'player_gift', value: 'wood:1' });
    expect(JSON.stringify(output)).not.toContain('random-memory-123');
    expect(JSON.stringify(output)).not.toContain('observation-random-id');
  });

  it('exports repair validation rejection and event feedback without inventing an execution', () => {
    const output = JSON.parse(serializeAlinRepairRun(repairResult()));

    expect(output).toMatchObject({ scenario: 'alin-repair', mode: 'offline-fallback', status: 'blocked' });
    expect(output.proposal).toEqual({ kind: 'repair_gate', gateId: 'gate-6', materials: [] });
    expect(output.validation).toMatchObject({ accepted: false, detailCode: 'repair_materials_unconfigured' });
    expect(output.execution).toBeNull();
    expect(output.actualStateDelta).toBeNull();
    expect(output.feedback).toHaveLength(1);
    expect(output.feedback[0]).toMatchObject({ attempt: 1, status: 'validation_rejected', validation: { accepted: false } });
    expect(output.world.stateBefore.gates).toEqual(output.world.stateAfter.gates);
    expect(output.hashes.stateBefore).toBe(output.hashes.stateAfter);
  });

  it('is byte-for-byte deterministic for the same scenario result', () => {
    const result = giftResult();
    expect(serializeAlinGiftRun(result)).toBe(serializeAlinGiftRun(result));
    expect(serializeAlinRepairRun(repairResult())).toBe(serializeAlinRepairRun(repairResult()));
  });

  it('redacts URLs and secrets and omits random IDs, wall-clock data, and unknown keys', () => {
    const unsafe = giftResult() as unknown as Record<string, any>;
    unsafe.observation = {
      ...unsafe.observation,
      observationId: 'random-observation-secret-id',
      recentFacts: ['private https://private.example/path access_token=ultra-secret'],
      endpoint: 'https://private.example/v1',
      wallClockTime: '2026-11-24T12:34:56Z',
      runId: 'random-run-id',
    };
    unsafe.before = {
      ...unsafe.before,
      npcs: [{
        ...unsafe.before.npcs[0],
        memory: [{ kind: 'fact', memoryId: 'random-memory-id', day: 2, subject: 'note', value: 'Bearer ultra-secret https://private.example/hidden' }],
        token: 'ultra-secret',
      }],
      apiUrl: 'https://private.example/v1?token=ultra-secret',
      wallClockTime: '2026-11-24T12:34:56Z',
    };
    unsafe.rawException = 'password=hunter2';

    const serialized = serializeAlinGiftRun(unsafe as unknown as AlinGiftScenarioResult);
    const output = JSON.parse(serialized);
    expect(serialized).not.toContain('private.example');
    expect(serialized).not.toContain('ultra-secret');
    expect(serialized).not.toContain('random-observation-secret-id');
    expect(serialized).not.toContain('random-memory-id');
    expect(serialized).not.toContain('random-run-id');
    expect(serialized).not.toContain('2026-11-24T12:34:56Z');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).toContain('[redacted-url]');
    expect(serialized).toContain('[redacted-secret]');
    expect(output.observation.endpoint).toBeUndefined();
    expect(output.observation.wallClockTime).toBeUndefined();
    expect(output.rawException).toBeUndefined();
  });
});
