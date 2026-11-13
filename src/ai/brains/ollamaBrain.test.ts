import { describe, expect, it } from 'vitest';
import { OllamaBrain } from './ollamaBrain';
import type { NpcObservation } from '../types';

const obs: NpcObservation = {
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

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

describe('OllamaBrain：transport 层', () => {
  it('health：/api/tags 200 → true，异常 → false', async () => {
    const good = new OllamaBrain({ model: 'm', fetchImpl: (async () => jsonResponse({})) as typeof fetch });
    expect(await good.health()).toBe(true);
    const bad = new OllamaBrain({ model: 'm', fetchImpl: (async () => { throw new Error('down'); }) as typeof fetch });
    expect(await bad.health()).toBe(false);
  });

  it('decide：透传模型 content 并解析成建议', async () => {
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('qwen3:8b');
      expect(body.messages).toHaveLength(2);
      return jsonResponse({ choices: [{ message: { content: '{"action":{"type":"dialogue","text":"早"},"confidence":0.9}' } }] });
    }) as typeof fetch;
    const brain = new OllamaBrain({ model: 'qwen3:8b', fetchImpl });
    const p = await brain.decide(obs);
    expect(p?.action).toEqual({ type: 'dialogue', text: '早' });
  });

  it('decide：HTTP 非 2xx → null', async () => {
    const fetchImpl = (async () => jsonResponse({}, false)) as typeof fetch;
    expect(await new OllamaBrain({ model: 'm', fetchImpl }).decide(obs)).toBeNull();
  });

  it('decide：网络抛错 → null（不把异常带进游戏循环）', async () => {
    const fetchImpl = (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
    expect(await new OllamaBrain({ model: 'm', fetchImpl }).decide(obs)).toBeNull();
  });

  it('decide：模型返回非契约内容 → null', async () => {
    const fetchImpl = (async () => jsonResponse({ choices: [{ message: { content: '你好呀朋友' } }] })) as typeof fetch;
    expect(await new OllamaBrain({ model: 'm', fetchImpl }).decide(obs)).toBeNull();
  });

  it('decide：响应缺 choices → null', async () => {
    const fetchImpl = (async () => jsonResponse({ error: 'model not found' })) as typeof fetch;
    expect(await new OllamaBrain({ model: 'm', fetchImpl }).decide(obs)).toBeNull();
  });
});
