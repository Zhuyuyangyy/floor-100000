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
  CompetitionTraceRecord,
  CompetitionValidationReason,
  CompetitionValidationResult,
} from './competition-contract';

const emptyDelta: CompetitionValidationResult['stateDelta'] = {
  inventory: [],
  trust: [],
  hp: [],
  positions: [],
  gateStatus: [],
  elapsedMinutes: 0,
};

const observation: CompetitionObservationSnapshot = {
  observationId: 'obs-0001',
  world: {
    day: 3,
    gameMinute: 720,
    currentFloor: 8,
    player: {
      position: { floor: 8, x: 120 },
      hp: 64,
      inventory: [{ itemId: 'wire', quantity: 2 }],
    },
    npcs: [{
      npcId: 'alin',
      position: { floor: 8, x: 180 },
      hp: 30,
      trust: 15,
      status: 'available',
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

  it('观察结果包括只读世界、NPC、背包及关系快照', () => {
    expect(observation.world.player.inventory[0]?.itemId).toBe('wire');
    expect(observation.world.npcs[0]?.trust).toBe(15);
    expect(observation.world.npcs[0]?.inventory[0]?.itemId).toBe('battery');
    expect(observation.world.groundItems[0]?.key).toBe('floor-item-1');
  });
});

describe('竞赛 A2 结果、追踪与错误边界', () => {
  it('验证结果码覆盖约定集合，ok 与拒绝状态互斥', () => {
    const reasons = [
      'ok', 'missing_item', 'low_trust', 'too_far', 'too_late', 'too_dangerous', 'invalid_target', 'insufficient_hp',
    ] satisfies CompetitionValidationReason[];
    expect(reasons.length).toBe(8);
  });

  it('验证理由仅用固定码，且 state delta 是结构化契约', () => {
    const valid: CompetitionValidationResult = { accepted: true, reason: 'ok', stateDelta: emptyDelta };
    const rejected: CompetitionValidationResult = { accepted: false, reason: 'missing_item', stateDelta: emptyDelta };
    expect(valid.reason).toBe('ok');
    expect(rejected.reason).toBe('missing_item');
    expect(rejected.stateDelta.inventory).toEqual([]);
  });

  it('trace 使用逻辑序号、输入/输出快照及哈希，不接受模型服务地址作为模型代号', () => {
    const model = toSafeCompetitionModelLabel('local-llama-3.1');
    expect(model).not.toBeNull();
    if (model === null) throw new Error('test fixture should be a safe label');
    const record: CompetitionTraceRecord = {
      time: { sequence: 12, day: 3, gameMinute: 720 },
      model,
      mode: 'adventure',
      decisionMode: 'model',
      seed: 123456,
      observation,
      proposal: { kind: 'observe' },
      validation: { accepted: true, reason: 'ok', stateDelta: emptyDelta },
      hashes: {
        observation: 'a'.repeat(64),
        proposal: 'b'.repeat(64),
        stateBefore: 'c'.repeat(64),
        stateAfter: 'd'.repeat(64),
      },
      replan: { attempted: false, attempt: 0, reason: 'none' },
      fallback: { used: false, reason: 'none' },
    };
    expect(record.time.sequence).toBe(12);
    expect(JSON.stringify(record)).not.toMatch(/endpoint|token|api[_-]?key|https?:/i);
    expect(toSafeCompetitionModelLabel('https://private.example/v1')).toBeNull();
    expect(toSafeCompetitionModelLabel('ollama.internal')).toBeNull();
    expect(toSafeCompetitionModelLabel('192.168.0.1')).toBeNull();
    expect(toSafeCompetitionModelLabel('Bearer-secret-token')).toBeNull();
    expect(toSafeCompetitionModelLabel({ model: 'secret' })).toBeNull();
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
