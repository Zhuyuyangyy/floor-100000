import { describe, expect, it } from 'vitest';
import {
  hashCompetitionTrace,
  hashCompetitionWorldState,
  projectCompetitionTraceSafe,
  serializeCompetitionTrace,
  serializeCompetitionWorldState,
} from './competitionTrace';
import { toSafeCompetitionModelLabel } from './competition-contract';
import type {
  CompetitionStateDelta,
  CompetitionTraceRecord,
  CompetitionWorldStateSnapshot,
} from './competition-contract';

const emptyDelta: CompetitionStateDelta = {
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

function makeWorld(seed: number, memoryId = 'memory-a'): CompetitionWorldStateSnapshot {
  return {
    seed,
    day: 4,
    gameMinute: 735,
    currentFloor: 6,
    flags: { 'gate-6-seen': 1 },
    threats: [],
    player: {
      position: { floor: 6, x: 100 },
      hp: 80,
      hunger: 10,
      thirst: 20,
      energy: 75,
      inventory: [{ itemId: 'wire', quantity: 2 }],
    },
    npcs: [{
      npcId: 'alin',
      position: { floor: 6, x: 120 },
      hp: 40,
      hunger: 15,
      trust: 3,
      affinity: 5,
      tension: 0,
      status: 'available',
      goal: null,
      memory: [{ kind: 'fact', memoryId, day: 4, subject: 'shelter', value: 'safe' }],
      lastAction: { kind: 'observe', day: 4, gameMinute: 730, result: 'completed' },
      inventory: [],
    }],
    groundItems: [],
    gates: [],
  };
}

function makeTrace(world = makeWorld(1234), runId = 'run-1'): CompetitionTraceRecord {
  const model = toSafeCompetitionModelLabel('rules-v1');
  if (model === null) throw new Error('fixture model label should be safe');
  return {
    runId,
    goal: { goalId: 'survive', kind: 'survive', sinceDay: 4, status: 'active' },
    time: { sequence: 12, day: 4, gameMinute: 735 },
    model,
    executionMode: 'offline-fallback',
    gameMode: 'adventure',
    decisionMode: 'rules',
    seed: world.seed,
    observation: {
      observationId: 'observation-random-id',
      world,
      focus: { kind: 'npc', npcId: 'alin' },
      availableActions: ['observe', 'ask'],
      recentFacts: ['阿林在附近。'],
    },
    proposal: { kind: 'observe', target: { kind: 'npc', npcId: 'alin' } },
    validation: { accepted: true, reason: 'ok', expectedStateDelta: emptyDelta },
    execution: { status: 'not-executed', actualStateDelta: null },
    hashes: {
      observation: 'a'.repeat(64),
      proposal: 'b'.repeat(64),
      stateBefore: 'c'.repeat(64),
      stateAfter: 'c'.repeat(64),
    },
    replan: { attempted: false, attempt: 0, reason: 'none' },
    fallback: { used: true, reason: 'model_unavailable' },
  };
}

describe('competition deterministic trace', () => {
  it('相同 seed 的状态哈希稳定，不同 seed 改变哈希', async () => {
    const first = await hashCompetitionWorldState(makeWorld(1234));
    const same = await hashCompetitionWorldState(makeWorld(1234));
    const different = await hashCompetitionWorldState(makeWorld(5678));
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(same).toBe(first);
    expect(different).not.toBe(first);
  });

  it('规范化字段顺序，但保留 sequence/day/gameMinute 逻辑时间', () => {
    const first = serializeCompetitionTrace({
      seed: 123,
      time: { sequence: 9, day: 2, gameMinute: 480 },
    });
    const reordered = serializeCompetitionTrace({
      time: { gameMinute: 480, day: 2, sequence: 9 },
      seed: 123,
    });
    expect(reordered).toBe(first);
    expect(first).toContain('"sequence":9');
    expect(first).toContain('"day":2');
    expect(first).toContain('"gameMinute":480');
  });

  it('随机 memoryId、runId 和 observationId 不影响状态/trace 哈希', async () => {
    const worldA = makeWorld(42, 'random-memory-aaa');
    const worldB = makeWorld(42, 'random-memory-bbb');
    expect(serializeCompetitionWorldState(worldA)).toBe(serializeCompetitionWorldState(worldB));
    expect(await hashCompetitionWorldState(worldA)).toBe(await hashCompetitionWorldState(worldB));

    const traceA = makeTrace(worldA, 'run-one');
    const traceB = makeTrace(worldB, 'run-two');
    expect(await hashCompetitionTrace(traceA)).toBe(await hashCompetitionTrace(traceB));
    const projection = JSON.stringify(projectCompetitionTraceSafe(traceA));
    expect(projection).not.toContain('run-one');
    expect(projection).not.toContain('random-memory-aaa');
    expect(projection).not.toContain('observation-random-id');
  });

  it('安全投影删除敏感扩展字段并清理文本中的 URL、endpoint、token 和模型错误', () => {
    const unsafe = {
      ...makeTrace(),
      endpoint: 'https://private.example/v1',
      apiUrl: 'https://private.example/v1?token=ultra-secret',
      token: 'ultra-secret',
      modelError: 'provider error: https://private.example; token=ultra-secret',
      observation: {
        ...makeTrace().observation,
        recentFacts: [
          '请求地址 https://private.example/v1?api_key=ultra-secret',
          'model error: raw provider diagnostic ultra-secret',
        ],
      },
      proposal: { kind: 'ask', npcId: 'alin', question: 'Bearer ultra-secret https://private.example/v1' },
      wallClockTime: '2026-11-24T12:34:56Z',
      rawException: 'private endpoint https://private.example',
    } as unknown as CompetitionTraceRecord;

    const projection = JSON.stringify(projectCompetitionTraceSafe(unsafe));
    expect(projection).not.toContain('private.example');
    expect(projection).not.toContain('ultra-secret');
    expect(projection).not.toContain('provider diagnostic');
    expect(projection).not.toContain('endpoint');
    expect(projection).not.toContain('wallClockTime');
    expect(projection).not.toContain('rawException');
    expect(projection).toContain('[redacted-url]');
    expect(projection).toContain('[redacted]');
  });
});
