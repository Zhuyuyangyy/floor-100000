import { describe, expect, it, vi } from 'vitest';
import { parseSparkProposal, SparkBrain } from './sparkBrain';
import type { NpcObservation, NpcBrain } from '../types';

const observation: NpcObservation = {
  npcId: 'alin',
  archetype: 'ally',
  traits: { altruism: 0.8, pragmatism: 0.3, aggression: 0.05, loyalty: 0.7, caution: 0.4 },
  memory: [],
  relationship: {},
  goal: 'g',
  mood: 0,
  world: { day: 1, floor: 2, gameMinute: 600, night: false },
  self: { floor: 2, x: 0, hp: 10 },
  availableActions: ['dialogue'],
  recentEvents: [],
};

const response = (action: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({
  action,
  confidence: 0.9,
  ...extra,
});

function fallbackBrain(proposal: Awaited<ReturnType<NpcBrain['decide']>> = {
  action: { type: 'dialogue', text: '离线规则回复' },
  confidence: 1,
}): NpcBrain {
  return { id: 'test-fallback', health: async () => true, decide: async () => proposal };
}

describe('SparkBrain', () => {
  it('类型化解析合法提案并将注入端口成功响应标记 spark-live', async () => {
    const infer = vi.fn(async (request: { systemPrompt: string; userPrompt: string }) => {
      expect(request.systemPrompt).toContain('alin');
      expect(request.userPrompt).toContain('可用行动');
      return response({ type: 'dialogue', text: '早上好' }, { utterance: '早' });
    });
    const brain = new SparkBrain({ port: { infer }, fallbackBrain: fallbackBrain() });
    const result = await brain.decideWithSource(observation);
    expect(result).toEqual({
      source: 'spark-live',
      proposal: { action: { type: 'dialogue', text: '早上好' }, confidence: 0.9, utterance: '早' },
    });
    expect(infer).toHaveBeenCalledTimes(1);
  });

  it('拒绝不可信或类型错误内容：坏 JSON、额外字段、未开放 action、控制字符与越界置信度', () => {
    expect(parseSparkProposal('{broken', ['dialogue'])).toBeNull();
    expect(parseSparkProposal(response({ type: 'dialogue', text: 'hi' }, { debug: 'unexpected' }), ['dialogue'])).toBeNull();
    expect(parseSparkProposal(response({ type: 'attack' }), ['dialogue'])).toBeNull();
    expect(parseSparkProposal(response({ type: 'dialogue', text: 'hello\nworld' }), ['dialogue'])).toBeNull();
    expect(parseSparkProposal(JSON.stringify({ action: { type: 'dialogue', text: 'ok' }, confidence: 1.01 }), ['dialogue'])).toBeNull();
    expect(parseSparkProposal({ action: { type: 'dialogue', text: 'ok' }, confidence: 1 }, ['dialogue'])).toBeNull();
  });

  it('坏 JSON 走 offline-fallback，决不把本地规则结果标作模型推理', async () => {
    const fallback = fallbackBrain();
    const brain = new SparkBrain({ port: { infer: async () => 'not JSON' }, fallbackBrain: fallback });
    expect(await brain.decideWithSource(observation)).toEqual({
      source: 'offline-fallback',
      proposal: { action: { type: 'dialogue', text: '离线规则回复' }, confidence: 1 },
    });
  });

  it('端口拒绝或抛错时安全降级；fallback 自身出错则返回 null 和 offline-fallback', async () => {
    const rejected = new SparkBrain({
      port: { infer: async () => { throw new Error('network failed'); } },
      fallbackBrain: fallbackBrain(),
    });
    expect((await rejected.decideWithSource(observation)).source).toBe('offline-fallback');
    const brokenFallback: NpcBrain = { id: 'broken', health: async () => true, decide: async () => { throw new Error('fallback failed'); } };
    const bothBroken = new SparkBrain({ port: { infer: async () => null }, fallbackBrain: brokenFallback });
    expect(await bothBroken.decideWithSource(observation)).toEqual({ source: 'offline-fallback', proposal: null });
  });

  it('超时会 abort 注入端口、及时回传离线 fallback', async () => {
    let capturedSignal: AbortSignal | undefined;
    const brain = new SparkBrain({
      timeoutMs: 5,
      port: { infer: async (_request, { signal }) => {
        capturedSignal = signal;
        return new Promise<never>(() => {});
      } },
      fallbackBrain: fallbackBrain(),
    });
    const result = await brain.decideWithSource(observation);
    expect(result.source).toBe('offline-fallback');
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('默认 fallback 明确使用离线人格 brain', async () => {
    const brain = new SparkBrain({ port: { infer: async () => '{bad' } });
    const result = await brain.decideWithSource(observation);
    expect(result.source).toBe('offline-fallback');
    expect(result.proposal?.action.type).toBe('dialogue');
  });

  it('health 只转发注入端口探测，缺少 live 探测时不假造地址', async () => {
    const good = new SparkBrain({ port: { infer: async () => null, health: async () => true } });
    const down = new SparkBrain({ port: { infer: async () => null, health: async () => { throw new Error('down'); } } });
    const noProbe = new SparkBrain({ port: { infer: async () => null } });
    expect(await good.health()).toBe(true);
    expect(await down.health()).toBe(false);
    expect(await noProbe.health()).toBe(true);
  });
});
