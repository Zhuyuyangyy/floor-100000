// 真实 Spark 联调（需要活的 Ollama 端口；默认不打进常规 test 集）。
//
// 运行：SPARK_LIVE=1 npx vitest run src/ai/brains/ollamaBrain.spark.test.ts
// 目标不是断言模型质量，而是证明「传输层不再返回空正文」这条根因修复。
import { describe, expect, it } from 'vitest';
import { OllamaBrain } from './ollamaBrain';
import { parseProposal } from '../prompt';
import type { NpcObservation } from '../types';

const LIVE = process.env.SPARK_LIVE === '1';
const URL = process.env.SPARK_URL ?? 'http://127.0.0.1:11434';
const MODEL = process.env.SPARK_MODEL ?? 'npc-qwen:latest';

const obs: NpcObservation = {
  npcId: 'alin',
  archetype: 'ally',
  traits: { altruism: 0.6, pragmatism: 0.7, aggression: 0.1, loyalty: 0.8, caution: 0.5 },
  memory: [],
  relationship: { player: 35 },
  goal: '修好上层通道',
  mood: 0.1,
  world: { day: 1, floor: 2, gameMinute: 560, night: false },
  self: { floor: 2, x: 640, hp: 10 },
  availableActions: ['dialogue'],
  recentEvents: [],
};

describe.skipIf(!LIVE)('Spark 真机联调', () => {
  it('健康检查：Spark 端口可用', async () => {
    const brain = new OllamaBrain({ model: MODEL, baseUrl: URL, timeoutMs: 5000 });
    expect(await brain.health()).toBe(true);
  });

  it('决策：返回非空且合契约的提案（空正文即失败）', async () => {
    const brain = new OllamaBrain({
      model: MODEL,
      baseUrl: URL,
      timeoutMs: 90_000,
      maxOutputTokens: 192,
      disableThinking: true,
    });
    const started = Date.now();
    const proposal = await brain.decide(obs);
    const elapsed = Date.now() - started;
    // 这条断言就是 R1 的失败点：过去拿到的是 null。
    expect(proposal, `模型在 ${elapsed}ms 内没有给出可解析提案`).not.toBeNull();
    expect(proposal?.action.type).toBe('dialogue');
    expect((proposal?.action as { text?: string }).text?.length ?? 0).toBeGreaterThan(0);
    console.log(`[spark-live] ${MODEL} ${elapsed}ms →`, JSON.stringify(proposal));
  }, 120_000);

  it('对照：同一 prompt 走 /v1 且开 thinking 会丢正文', async () => {
    // 这不是要修的行为，是把根因钉成可复现证据：预算被 reasoning 吃光时
    // HTTP 200 但 content 为空串，旧代码据此返回 null。
    const res = await fetch(`${URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        max_tokens: 64,
        messages: [
          { role: 'system', content: 'Reply with JSON only.' },
          { role: 'user', content: 'Give me a JSON object with one key.' },
        ],
      }),
    });
    expect(res.ok).toBe(true);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning?: string }; finish_reason?: string }>;
    };
    const choice = data.choices?.[0];
    console.log('[repro] finish_reason =', choice?.finish_reason, 'content =', JSON.stringify(choice?.message?.content));
    // 记录观测：finish_reason=length 且 content 为空，正是“成功但空”的成因。
    if (choice?.finish_reason === 'length') {
      expect(choice.message?.content ?? '').toBe('');
      expect(parseProposal(choice.message?.content ?? '')).toBeNull();
    }
  }, 120_000);
});