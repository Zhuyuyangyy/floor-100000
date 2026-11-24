import { describe, expect, it } from 'vitest';
import {
  COMPETITION_ACTION_KINDS,
  isCompetitionActionKind,
  toCompetitionSafeError,
  toSafeCompetitionModelLabel,
} from './competition-contract';
import type {
  CompetitionActionProposal,
  CompetitionGiftTransfer,
  CompetitionObservationSnapshot,
  CompetitionStateDelta,
  CompetitionTraceRecord,
  CompetitionValidationReason,
  CompetitionValidationResult,
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

const observation: CompetitionObservationSnapshot = {
  observationId: 'obs-0001',
  world: {
    seed: 123456,
    day: 3,
    gameMinute: 720,
    currentFloor: 8,
    flags: { 'gate-8-west-seen': 1 },
    threats: [{
      threatId: 'leak-8',
      kind: 'environment',
      position: { floor: 8, x: 220 },
      severity: 'moderate',
      status: 'active',
    }],
    player: {
      position: { floor: 8, x: 120 },
      hp: 64,
      hunger: 25,
      thirst: 40,
      energy: 70,
      inventory: [{ itemId: 'wire', quantity: 2 }],
    },
    npcs: [{
      npcId: 'alin',
      position: { floor: 8, x: 180 },
      hp: 30,
      hunger: 30,
      trust: 15,
      affinity: 20,
      tension: 5,
      status: 'available',
      goal: { goalId: 'reach-shelter', kind: 'return', sinceDay: 2, status: 'active' },
      memory: [
        { kind: 'promise', memoryId: 'promise-1', day: 2, promise: '交付电池', status: 'open' },
      ],
      lastAction: { kind: 'pickup', day: 3, gameMinute: 710, result: 'completed' },
      inventory: [{ itemId: 'battery', quantity: 1 }],
    }],
    groundItems: [{ key: 'floor-item-1', itemId: 'wood', quantity: 2, position: { floor: 8, x: 125 } }],
    gates: [{ gateId: 'gate-8-west', floor: 8, status: 'blocked' }],
  },
  focus: { kind: 'npc', npcId: 'alin' },
  availableActions: [...COMPETITION_ACTION_KINDS],
  recentFacts: ['阿林正在附近。'],
};

describe('竞赛 A2 动作契约', () => {
  it('只暴露要求的 11 个动作标签，并能安全识别不可信值', () => {
    expect(COMPETITION_ACTION_KINDS).toEqual([
      'observe', 'ask', 'give', 'trade', 'inspect', 'pickup', 'move', 'return', 'retreat', 'sleep', 'repair_gate',
    ]);
    for (const kind of COMPETITION_ACTION_KINDS) expect(isCompetitionActionKind(kind)).toBe(true);
    expect(isCompetitionActionKind('attack')).toBe(false);
    expect(isCompetitionActionKind({ kind: 'trade' })).toBe(false);
    expect(isCompetitionActionKind(null)).toBe(false);
  });

  it('动作提议仍然是建议数据，并覆盖白名单所有形状', () => {
    const proposals = [
      { kind: 'observe' },
      { kind: 'ask', npcId: 'alin', question: '附近安全吗？' },
      { kind: 'give', transfer: { from: 'player', to: { kind: 'npc', npcId: 'alin' }, itemId: 'wire', quantity: 1 } },
      {
        kind: 'trade',
        npcId: 'alin',
        playerGives: { from: 'player', to: { kind: 'npc', npcId: 'alin' }, itemId: 'wire', quantity: 1 },
        playerReceives: { from: { kind: 'npc', npcId: 'alin' }, to: 'player', itemId: 'battery', quantity: 1 },
      },
      { kind: 'inspect', target: { kind: 'gate', id: 'gate-8-west' } },
      { kind: 'pickup', groundItemKey: 'floor-item-1', itemId: 'wood', quantity: 1 },
      { kind: 'move', destination: { floor: 8, x: 140 } },
      { kind: 'return', destination: { floor: 8, x: 0 } },
      { kind: 'retreat', destination: { floor: 7, x: 300 } },
      { kind: 'sleep', durationMinutes: 60 },
      { kind: 'repair_gate', gateId: 'gate-8-west', materials: [{ itemId: 'wood', quantity: 2 }] },
    ] satisfies CompetitionActionProposal[];
    expect(proposals.map(({ kind }) => kind)).toEqual(COMPETITION_ACTION_KINDS);
  });

  it('赠与与交易显式标注双方方向，拒绝把两端颠倒', () => {
    const giveToNpc: CompetitionGiftTransfer = {
      from: 'player', to: { kind: 'npc', npcId: 'alin' }, itemId: 'wire', quantity: 1,
    };
    const giveToPlayer: CompetitionGiftTransfer = {
      from: { kind: 'npc', npcId: 'alin' }, to: 'player', itemId: 'battery', quantity: 1,
    };
    expect(giveToNpc.from).toBe('player');
    expect(giveToPlayer.to).toBe('player');

    // @ts-expect-error 玩家不能作为 from 后再把物品给自己；赠与目标必须明确为 NPC
    const ambiguousDirection: CompetitionGiftTransfer = { from: 'player', to: 'player', itemId: 'wire', quantity: 1 };
    expect(ambiguousDirection.to).toBe('player');
  });

  it('观察结果包括 seed、flags、threats、生存状态和 NPC 的结构化跨日状态', () => {
    expect(observation.world.seed).toBe(123456);
    expect(observation.world.flags['gate-8-west-seen']).toBe(1);
    expect(observation.world.threats[0]?.threatId).toBe('leak-8');
    expect(observation.world.player.hunger).toBe(25);
    expect(observation.world.player.thirst).toBe(40);
    expect(observation.world.player.energy).toBe(70);
    expect(observation.world.player.inventory[0]?.itemId).toBe('wire');
    expect(observation.world.npcs[0]?.trust).toBe(15);
    expect(observation.world.npcs[0]?.affinity).toBe(20);
    expect(observation.world.npcs[0]?.tension).toBe(5);
    expect(observation.world.npcs[0]?.goal?.kind).toBe('return');
    expect(observation.world.npcs[0]?.memory[0]?.kind).toBe('promise');
    expect(observation.world.npcs[0]?.lastAction?.kind).toBe('pickup');
    expect(observation.world.npcs[0]?.inventory[0]?.itemId).toBe('battery');
    expect(observation.world.groundItems[0]?.key).toBe('floor-item-1');
    // recentFacts 是观察摘要字符串，绝不充当结构化的持久 memory。
    expect(typeof observation.recentFacts[0]).toBe('string');
    expect(typeof observation.world.npcs[0]?.memory[0]).toBe('object');
  });
});

describe('竞赛 A2 结果、追踪与错误边界', () => {
  it('验证结果码覆盖约定集合，ok 与拒绝状态互斥', () => {
    const reasons = [
      'ok', 'missing_item', 'low_trust', 'too_far', 'too_late', 'too_dangerous', 'invalid_target', 'insufficient_hp',
    ] satisfies CompetitionValidationReason[];
    expect(reasons.length).toBe(8);
  });

  it('校验差量明确是预期结果，且拒绝时预期差量为空', () => {
    const valid: CompetitionValidationResult = { accepted: true, reason: 'ok', expectedStateDelta: emptyDelta };
    const rejected: CompetitionValidationResult = {
      accepted: false, reason: 'missing_item', expectedStateDelta: emptyDelta,
    };
    expect(valid.reason).toBe('ok');
    expect(rejected.reason).toBe('missing_item');
    expect(rejected.expectedStateDelta.inventory).toEqual([]);
  });

  it('state delta 可记录 memory 新增、flags 变化和关系变化', () => {
    const actualDelta: CompetitionStateDelta = {
      ...emptyDelta,
      relationships: [{ npcId: 'alin', affinityDelta: 2, tensionDelta: -1 }],
      memoryAdded: [{
        npcId: 'alin',
        entry: { kind: 'favor', memoryId: 'favor-2', day: 3, from: 'player', description: '交付电池', status: 'open' },
      }],
      flags: [{ flag: 'battery-delivered', from: null, to: 1 }],
    };
    expect(actualDelta.memoryAdded[0]?.entry.kind).toBe('favor');
    expect(actualDelta.flags[0]?.from).toBeNull();
    expect(actualDelta.relationships[0]?.affinityDelta).toBe(2);
  });

  it('trace 区分执行模式、游戏模式、预期差量与实际结果，并带运行 ID/目标和边界哈希', () => {
    const model = toSafeCompetitionModelLabel('local-llama-3.1');
    expect(model).not.toBeNull();
    if (model === null) throw new Error('test fixture should be a safe label');
    const actualDelta: CompetitionStateDelta = {
      ...emptyDelta,
      flags: [{ flag: 'battery-delivered', from: null, to: 1 }],
    };
    const record: CompetitionTraceRecord = {
      runId: 'run-0007',
      goal: { goalId: 'reach-floor-9', kind: 'reach_floor', sinceDay: 3, status: 'active', target: '9' },
      time: { sequence: 12, day: 3, gameMinute: 720 },
      model,
      executionMode: 'spark-live',
      gameMode: 'adventure',
      decisionMode: 'model',
      seed: 123456,
      observation,
      proposal: { kind: 'observe' },
      validation: { accepted: true, reason: 'ok', expectedStateDelta: emptyDelta },
      execution: { status: 'executed', actualStateDelta: actualDelta },
      hashes: {
        observation: 'a'.repeat(64),
        proposal: 'b'.repeat(64),
        stateBefore: 'c'.repeat(64),
        stateAfter: 'd'.repeat(64),
      },
      replan: { attempted: false, attempt: 0, reason: 'none' },
      fallback: { used: false, reason: 'none' },
    };
    expect(record.runId).toBe('run-0007');
    expect(record.time.sequence).toBe(12);
    expect(record.executionMode).toBe('spark-live');
    expect(record.gameMode).toBe('adventure');
    expect(record.validation.expectedStateDelta).not.toBe(record.execution.actualStateDelta);
    if (record.execution.status !== 'executed') throw new Error('test fixture should be executed');
    expect(record.execution.actualStateDelta.flags[0]?.flag).toBe('battery-delivered');
    expect(record.hashes.stateBefore).not.toBe(record.hashes.stateAfter);
    expect(JSON.stringify(record)).not.toMatch(/endpoint|token|api[_-]?key|https?:/i);
    expect(toSafeCompetitionModelLabel('https://private.example/v1')).toBeNull();
    expect(toSafeCompetitionModelLabel('ollama.internal')).toBeNull();
    expect(toSafeCompetitionModelLabel('192.168.0.1')).toBeNull();
    expect(toSafeCompetitionModelLabel('Bearer-secret-token')).toBeNull();
    expect(toSafeCompetitionModelLabel({ model: 'secret' })).toBeNull();
  });

  it('未执行 trace 显式没有实际差量，offline-fallback 与游戏难度分开', () => {
    const model = toSafeCompetitionModelLabel('local-rules');
    if (model === null) throw new Error('test fixture should be a safe label');
    const record: CompetitionTraceRecord = {
      runId: 'run-0008',
      goal: { goalId: 'survive', kind: 'survive', sinceDay: 1, status: 'active' },
      time: { sequence: 13, day: 3, gameMinute: 721 },
      model,
      executionMode: 'offline-fallback',
      gameMode: 'easy',
      decisionMode: 'fallback',
      seed: 123456,
      observation,
      proposal: { kind: 'observe' },
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
    expect(record.execution.actualStateDelta).toBeNull();
    expect(record.executionMode).toBe('offline-fallback');
    expect(record.hashes.stateBefore).toBe(record.hashes.stateAfter);
  });

  it('安全错误映射不回显任意异常消息或栈', () => {
    const secret = 'https://host.invalid/?token=do-not-log';
    expect(toCompetitionSafeError('timeout')).toEqual({ code: 'timeout', message: '决策请求超时' });
    const safe = toCompetitionSafeError(new Error(secret));
    expect(safe).toEqual({ code: 'internal', message: '决策失败' });
    expect(JSON.stringify(safe)).not.toContain(secret);
    expect(toCompetitionSafeError('unrecognized')).toEqual({ code: 'internal', message: '决策失败' });
  });
});
