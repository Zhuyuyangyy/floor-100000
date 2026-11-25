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

/** 原生 /api/chat 形状：content 与 thinking 分开。 */
function nativeChat(content: string, extra: Record<string, unknown> = {}) {
  return jsonResponse({ message: { content, thinking: '' }, done_reason: 'stop', eval_count: 50, ...extra });
}

describe('OllamaBrain：transport 层', () => {
  it('health：/api/tags 200 → true，异常 → false', async () => {
    const good = new OllamaBrain({ model: 'm', fetchImpl: (async () => jsonResponse({})) as typeof fetch });
    expect(await good.health()).toBe(true);
    const bad = new OllamaBrain({ model: 'm', fetchImpl: (async () => { throw new Error('down'); }) as typeof fetch });
    expect(await bad.health()).toBe(false);
  });

  // 回归：代理模式下 health 曾打 /api/tags（Ollama 原生端点，同域代理上没有），
  // 404 → 运行时认为「没有主脑」→ decide 一次都不调用 → UI 永远降级。
  it('health：代理模式探测 /healthz，不打 Ollama 的 /api/tags', async () => {
    const seen: string[] = [];
    const brain = new OllamaBrain({
      model: 'ignored',
      baseUrl: '',
      proxyMode: true,
      sessionId: 's_x',
      fetchImpl: (async (url: string) => {
        seen.push(String(url));
        return jsonResponse({ ok: true });
      }) as unknown as typeof fetch,
    });
    expect(await brain.health()).toBe(true);
    expect(seen).toEqual(['/healthz']);
    expect(seen.some((u) => u.includes('/api/tags'))).toBe(false);
  });

  it('decide：走原生 /api/chat，关掉 thinking 并强制 JSON', async () => {
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(url).toContain('/api/chat');
      expect(body.model).toBe('qwen3:8b');
      expect(body.messages).toHaveLength(2);
      // 这两项是空回复的根因修复，必须钉住。
      expect(body.think).toBe(false);
      expect(body.format).toBe('json');
      return nativeChat('{"action":{"type":"dialogue","text":"早"},"confidence":0.9}');
    }) as typeof fetch;
    const brain = new OllamaBrain({ model: 'qwen3:8b', fetchImpl });
    const p = await brain.decide(obs);
    expect(p?.action).toEqual({ type: 'dialogue', text: '早' });
  });

  it('decide：正文为空但 thinking 有内容 → null（不能把思维链当提案）', async () => {
    const fetchImpl = (async () => jsonResponse({
      message: { content: '', thinking: '{"action":{"type":"dialogue","text":"这是思维链里的假 JSON"}}' },
      done_reason: 'length',
    })) as typeof fetch;
    expect(await new OllamaBrain({ model: 'm', fetchImpl }).decide(obs)).toBeNull();
  });

  it('decide：content 为空且未配置预算 → null，不重试', async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls += 1; return jsonResponse({ message: { content: '' } }); }) as typeof fetch;
    expect(await new OllamaBrain({ model: 'm', fetchImpl }).decide(obs)).toBeNull();
    expect(calls).toBe(1);
  });

  it('decide：预算耗尽被截断 → 放宽 num_predict 重试一次并成功', async () => {
    const budgets: number[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      budgets.push(body.options?.num_predict);
      return budgets.length === 1
        ? jsonResponse({ message: { content: '' }, done_reason: 'length', eval_count: 160 })
        : nativeChat('{"action":{"type":"dialogue","text":"重试成功"},"confidence":0.8}');
    }) as typeof fetch;
    const brain = new OllamaBrain({ model: 'm', fetchImpl, maxOutputTokens: 160 });
    const p = await brain.decide(obs);
    expect(p?.action).toEqual({ type: 'dialogue', text: '重试成功' });
    expect(budgets).toEqual([160, 512]);
  });

  it('decide：兼容 OpenAI 形状（/v1 代理）正文', async () => {
    const fetchImpl = (async () => jsonResponse({
      choices: [{ message: { content: '{"action":{"type":"dialogue","text":"旧形状"},"confidence":0.5}', reasoning: 'ignored' } }],
    })) as typeof fetch;
    const p = await new OllamaBrain({ model: 'm', fetchImpl }).decide(obs);
    expect(p?.action).toEqual({ type: 'dialogue', text: '旧形状' });
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
    const fetchImpl = (async () => nativeChat('你好呀朋友')) as typeof fetch;
    expect(await new OllamaBrain({ model: 'm', fetchImpl }).decide(obs)).toBeNull();
  });

  it('decide：响应缺 message → null', async () => {
    const fetchImpl = (async () => jsonResponse({ error: 'model not found' })) as typeof fetch;
    expect(await new OllamaBrain({ model: 'm', fetchImpl }).decide(obs)).toBeNull();
  });
});
describe('OllamaBrain：代理模式（公开部署）', () => {
  /** 代理模式：请求同域 /api/npc/decide，体里只有会话标识与观察对象。 */
  function proxyFetch(handler: (body: any, url: string, init?: RequestInit) => Response) {
    const seen: Array<{ url: string; body: any; init?: RequestInit }> = [];
    const impl = (async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      seen.push({ url, body, init });
      return handler(body, url, init);
    }) as typeof fetch;
    return { impl, seen };
  }

  it('不发送 model / max_tokens / 任何凭据', async () => {
    const { impl, seen } = proxyFetch(() =>
      jsonResponse({ ok: true, text: '{"action":{"type":"dialogue","text":"早"},"confidence":0.9}', decisionSource: 'model' }));

    const brain = new OllamaBrain({
      model: 'should-not-be-sent',
      baseUrl: '',
      proxyMode: true,
      sessionId: 'sess-1',
      maxOutputTokens: 999,
      fetchImpl: impl,
    });
    const proposal = await brain.decide(obs);

    expect(proposal).toMatchObject({ action: { type: 'dialogue', text: '早' } });
    expect(brain.decisionSource).toBe('model');

    const call = seen[0];
    expect(call.url).toBe('/api/npc/decide');
    // 铁律：代理模式下这些字段一个都不能出现。
    expect(call.body).not.toHaveProperty('model');
    expect(call.body).not.toHaveProperty('max_tokens');
    expect(call.body).not.toHaveProperty('messages');
    expect(call.body).not.toHaveProperty('apiKey');
    expect(JSON.stringify(call.body)).not.toContain('should-not-be-sent');
    // 只应有会话标识与观察对象。
    expect(Object.keys(call.body).sort()).toEqual(['clientId', 'observation']);
    expect(call.body.clientId).toBe('sess-1');
  });

  it('请求头不带 Authorization', async () => {
    const { impl, seen } = proxyFetch(() =>
      jsonResponse({ ok: true, text: '{"action":{"type":"dialogue","text":"嗯"},"confidence":0.9}', decisionSource: 'model' }));
    const brain = new OllamaBrain({ model: 'm', baseUrl: '', proxyMode: true, fetchImpl: impl });
    await brain.decide(obs);
    const headers = (seen[0].init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers.authorization).toBeUndefined();
  });

  it('服务端说降级时不冒充模型输出', async () => {
    const { impl } = proxyFetch(() =>
      jsonResponse({ ok: false, reason: 'breaker_open', decisionSource: 'rules-fallback' }));
    const brain = new OllamaBrain({ model: 'm', baseUrl: '', proxyMode: true, fetchImpl: impl });
    expect(await brain.decide(obs)).toBeNull();
    expect(brain.decisionSource).toBe('rules-fallback');
  });

  it('非 2xx、坏 JSON、超时都降级而不抛错', async () => {
    const cases = [
      (async () => ({ ok: false, status: 503, json: async () => ({}) }) as Response) as typeof fetch,
      (async () => jsonResponse({ ok: true, text: 'not json', decisionSource: 'model' })) as typeof fetch,
      (async () => { throw new Error('timeout'); }) as typeof fetch,
    ];
    for (const fetchImpl of cases) {
      const brain = new OllamaBrain({ model: 'm', baseUrl: '', proxyMode: true, fetchImpl });
      expect(await brain.decide(obs)).toBeNull();
      expect(brain.decisionSource).toBe('rules-fallback');
    }
  });

  it('服务端回 decisionSource 为 model 但正文为空 → 仍降级', async () => {
    const { impl } = proxyFetch(() => jsonResponse({ ok: true, text: '   ', decisionSource: 'model' }));
    const brain = new OllamaBrain({ model: 'm', baseUrl: '', proxyMode: true, fetchImpl: impl });
    expect(await brain.decide(obs)).toBeNull();
    expect(brain.decisionSource).toBe('rules-fallback');
  });
});
