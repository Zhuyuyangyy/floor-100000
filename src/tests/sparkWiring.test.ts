// Spark 接线的集成测试（AG-40）：本地大模型真正接进 NPC 对话的这条路上，
// 「模型可达 → 走通」「超时/网络错 → 降级」「没配模型 → 零请求」
// 「执行器看到真实库存」四件事，全部用假 fetch 钉住——不连真 Spark
// （21-32s 且不稳定，CI 里跑不起）。
//
// 覆盖边界与 src/ai/brains/ollamaBrain.test.ts（transport 单体）、
// src/systems/NpcRuntime.test.ts（降级链单体）互补：这里测的是
// 「场景那样的完整配置」跑 decideNpcAction 的端到端行为。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNewGame } from '../core/gameState';
import { addItem } from '../systems/InventorySystem';
import { getNpc } from '../data/npcs';
import { createNpcState } from '../data/npcPersonalities';
import { saveNpcState } from '../systems/NpcMemory';
import { syncNpcInventory, takeFromStock, withInventory } from '../ai/npcInventory';
import { aiNpcConfig, npcFactFor } from '../ai/config';
import { OllamaBrain } from '../ai/brains/ollamaBrain';
import { OptionTreeBrain } from '../ai/brains/optionTreeBrain';
import { decideNpcAction, type NpcRuntimeConfig } from '../systems/NpcRuntime';

// 阿林自己的第一句问候：Spark 不可达时玩家看到的就是这句（护栏 2 的场景侧落地）。
const ALIN_LINE = getNpc('alin').greetings[0];

// ── 假 fetch ────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

interface FetchSpy {
  (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response>;
  calls: Array<{ url: string; init?: RequestInit }>;
}

/** 按 URL 分派的假 fetch：/api/tags 给 health，/v1/chat/completions 给 decide。 */
function fakeFetch(handlers: {
  tags?: (url: string, init?: RequestInit) => Response | Promise<Response>;
  chat?: (url: string, init?: RequestInit) => Response | Promise<Response>;
}): FetchSpy {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/api/tags')) return handlers.tags ? handlers.tags(url, init) : jsonResponse({ models: [{ name: 'npc-qwen:latest' }] });
    if (url.endsWith('/v1/chat/completions')) {
      if (!handlers.chat) throw new Error(`fakeFetch: 没有 chat handler（${url}）`);
      return handlers.chat(url, init);
    }
    throw new Error(`fakeFetch: 未预期的 URL ${url}`);
  }) as FetchSpy;
  impl.calls = calls;
  return impl;
}

/** 模型的一句合规回复（走 prompt.ts 的输出契约）。 */
function chatReply(utterance: string): Response {
  return jsonResponse({
    choices: [{ message: { content: `{"utterance":${JSON.stringify(utterance)},"action":{"type":"dialogue","text":${JSON.stringify(utterance)}},"confidence":0.9}` } }],
  });
}

// ── 场景接线的镜像 ──────────────────────────────────────────────────────────

/**
 * GameScene.getAiRuntime（src/scenes/GameScene.ts）的逐字镜像：配置没开
 * （aiNpcConfig().enabled === false）就连 brain 都不建、一个请求都不发。
 * 场景 import Phaser，没法在 Node 单测里直接跑；这里复刻它的守卫，
 * 把「未配置 → 零请求」钉成可断言的契约——改坏了 enabled 的语义就会红。
 */
function runtimeForScene(fallbackLine: string, fetchImpl: typeof fetch): NpcRuntimeConfig | null {
  const cfg = aiNpcConfig();
  if (!cfg.enabled) return null;
  return {
    brain: new OllamaBrain({ baseUrl: cfg.baseUrl, model: cfg.model, timeoutMs: cfg.timeoutMs, fetchImpl }),
    fallback: new OptionTreeBrain(fallbackLine),
    timeoutMs: cfg.timeoutMs,
    memoryRecallK: cfg.recallK,
    // 第一阶段场景只接通 dialogue：模型提议交易/赠送会被运行时以
    // 「不在本阶段可用集」拒绝并降级（见 NpcRuntime.decideNpcAction）。
    allowedActions: ['dialogue'],
  };
}

// 开发机的 .env.local 会被 Vitest 读进 process.env——断言「没有配置」之前
// 先真正清空，测试才在 CI 与本机都成立（与 src/ai/config.test.ts 同套路）。
const AI_ENV_KEYS = ['VITE_NPC_MODEL', 'VITE_OLLAMA_URL', 'VITE_NPC_TIMEOUT_MS'];

afterEach(() => {
  vi.unstubAllEnvs();
});

function withNoAiEnv<T>(run: () => T): T {
  const saved = AI_ENV_KEYS.map((k) => [k, process.env[k]] as const);
  for (const k of AI_ENV_KEYS) delete process.env[k];
  try {
    return run();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function gameOnNpcFloor() {
  const s = createNewGame(7);
  s.currentFloor = 2; // 阿林在 2 层
  return s;
}

// ── 模型可达：走通并返回模型台词 ────────────────────────────────────────────

describe('sparkWiring：模型可达时 decideNpcAction 走通', () => {
  it('health 与 decide 都通 → source=brain，utterance 是模型那句话', async () => {
    vi.stubEnv('VITE_NPC_MODEL', 'npc-qwen:latest');
    vi.stubEnv('VITE_OLLAMA_URL', 'http://127.0.0.1:11434');
    const fetchImpl = fakeFetch({ chat: async () => chatReply('线路我看了眼，还行。') });

    const runtime = runtimeForScene(ALIN_LINE, fetchImpl);
    expect(runtime).not.toBeNull();

    const decision = await decideNpcAction(gameOnNpcFloor(), npcFactFor(gameOnNpcFloor(), getNpc('alin')), createNpcState('ally'), runtime!);
    expect(decision.source).toBe('brain');
    expect(decision.validated.ok).toBe(true);
    if (decision.validated.ok) {
      expect(decision.validated.utterance).toBe('线路我看了眼，还行。');
      if (decision.validated.action.type === 'dialogue') {
        expect(decision.validated.action.text).toBe('线路我看了眼，还行。');
      }
    }
    // 请求真的走了 .env.local 配的地址与模型（护栏 4：地址/模型名不入库）
    const chat = fetchImpl.calls.find((c) => c.url.endsWith('/v1/chat/completions'));
    expect(chat?.url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(JSON.parse(String(chat?.init?.body)).model).toBe('npc-qwen:latest');
    expect(fetchImpl.calls.some((c) => c.url.endsWith('/api/tags'))).toBe(true); // 先探活再推理
  });

  it('模型提议交易（不在第一阶段可用集）→ 拒绝并降级到原句', async () => {
    vi.stubEnv('VITE_NPC_MODEL', 'npc-qwen:latest');
    vi.stubEnv('VITE_OLLAMA_URL', 'http://127.0.0.1:11434');
    const s = gameOnNpcFloor();
    addItem(s.player.inventory, 'scrap_metal', 1);
    const fetchImpl = fakeFetch({
      chat: async () =>
        jsonResponse({
          choices: [
            {
              message: {
                content: '{"action":{"type":"trade","give":{"itemId":"wire","quantity":1},"get":{"itemId":"scrap_metal","quantity":1}},"confidence":0.9}',
              },
            },
          ],
        }),
    });
    const runtime = runtimeForScene(ALIN_LINE, fetchImpl)!;
    const decision = await decideNpcAction(s, npcFactFor(s, getNpc('alin')), createNpcState('ally'), runtime);
    expect(decision.source).toBe('fallback');
    expect(decision.rejectionReason).toContain('不在本阶段可用集');
    if (decision.validated.ok && decision.validated.action.type === 'dialogue') {
      expect(decision.validated.action.text).toBe(ALIN_LINE); // 玩家看到改造前那一句
    }
  });
});

// ── 降级：超时/网络错 → 原句，且不抛 ───────────────────────────────────────

describe('sparkWiring：Spark 不可达时降级', () => {
  it('decide 挂起超过运行时超时 → 降级脑原句，不卡游戏循环', async () => {
    const s = gameOnNpcFloor();
    // 假 fetch 模拟真实 fetch 的超时行为：abort 即拒绝（OllamaBrain 用
    // AbortSignal.timeout 管自己的超时，运行时再用 withTimeout 管总超时）。
    const fetchImpl = fakeFetch({
      chat: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });
    const runtime: NpcRuntimeConfig = {
      brain: new OllamaBrain({ model: 'npc-qwen:latest', fetchImpl, timeoutMs: 300 }),
      fallback: new OptionTreeBrain(ALIN_LINE),
      timeoutMs: 40, // 45s 生产超时的等比例缩小版
    };
    const started = Date.now();
    const decision = await decideNpcAction(s, npcFactFor(s, getNpc('alin')), createNpcState('ally'), runtime);
    expect(decision.source).toBe('fallback');
    expect(decision.validated.ok).toBe(true);
    if (decision.validated.ok && decision.validated.action.type === 'dialogue') {
      expect(decision.validated.action.text).toBe(ALIN_LINE);
    }
    expect(Date.now() - started).toBeLessThan(5000); // 超时不阻塞交互
  });

  it('网络错（fetch 抛错）→ health 失败 → 降级脑原句，且不抛', async () => {
    const s = gameOnNpcFloor();
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    const runtime: NpcRuntimeConfig = {
      brain: new OllamaBrain({ model: 'npc-qwen:latest', fetchImpl, timeoutMs: 5000 }),
      fallback: new OptionTreeBrain(ALIN_LINE),
      timeoutMs: 5000,
    };
    const decision = await decideNpcAction(s, npcFactFor(s, getNpc('alin')), createNpcState('ally'), runtime);
    expect(decision.source).toBe('fallback');
    if (decision.validated.ok && decision.validated.action.type === 'dialogue') {
      expect(decision.validated.action.text).toBe(ALIN_LINE);
    }
  });

  it('Ollama 回 500 → health false → 降级脑原句', async () => {
    const s = gameOnNpcFloor();
    const fetchImpl = fakeFetch({ tags: async () => jsonResponse({}, false) });
    const runtime: NpcRuntimeConfig = {
      brain: new OllamaBrain({ model: 'npc-qwen:latest', fetchImpl, timeoutMs: 5000 }),
      fallback: new OptionTreeBrain(ALIN_LINE),
      timeoutMs: 5000,
    };
    const decision = await decideNpcAction(s, npcFactFor(s, getNpc('alin')), createNpcState('ally'), runtime);
    expect(decision.source).toBe('fallback');
    if (decision.validated.ok && decision.validated.action.type === 'dialogue') {
      expect(decision.validated.action.text).toBe(ALIN_LINE);
    }
  });
});

// ── 未配置模型：零请求 ─────────────────────────────────────────────────────

describe('sparkWiring：VITE_NPC_MODEL 未配时零成本', () => {
  it('没配模型 → enabled=false，场景守卫不建 brain、fetch 零调用', () => {
    const fetchImpl = fakeFetch({});
    const { cfg, runtime } = withNoAiEnv(() => ({
      cfg: aiNpcConfig(),
      runtime: runtimeForScene(ALIN_LINE, fetchImpl),
    }));
    expect(cfg.enabled).toBe(false);
    expect(runtime).toBeNull();
    expect(fetchImpl.calls).toHaveLength(0); // 不起请求、不建 brain
  });

  it('VITE_NPC_MODEL 配成空串同样关闭（显式 opt-in 的另一半）', () => {
    vi.stubEnv('VITE_NPC_MODEL', '');
    const fetchImpl = fakeFetch({});
    expect(aiNpcConfig().enabled).toBe(false);
    expect(runtimeForScene(ALIN_LINE, fetchImpl)).toBeNull();
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('配上模型才开启，且 brain 用配置里的地址/模型/超时', () => {
    vi.stubEnv('VITE_NPC_MODEL', 'npc-qwen:latest');
    vi.stubEnv('VITE_OLLAMA_URL', 'http://127.0.0.1:11435');
    vi.stubEnv('VITE_NPC_TIMEOUT_MS', '45000');
    const cfg = aiNpcConfig();
    expect(cfg.enabled).toBe(true);
    const runtime = runtimeForScene(ALIN_LINE, fakeFetch({}))!;
    expect(runtime.timeoutMs).toBe(45_000);
    expect(runtime.allowedActions).toEqual(['dialogue']); // 第一阶段只通对话
  });
});

// ── npcFactFor：执行器看到的是真实库存（AG-11 接的） ───────────────────────

describe('sparkWiring：npcFactFor 喂给执行器的是真实库存', () => {
  it('库存被抽干后，模型提议的对应交易被执行器拒绝并降级', async () => {
    const s = gameOnNpcFloor();
    const alin = getNpc('alin');
    // syncNpcInventory 同日恒等时不写回 npcStates，所以直接拿它的返回值
    // （freshStateFor 补的默认库存 wire×2、fuse×2）来改，再存回去。
    const synced = syncNpcInventory(s, alin);
    saveNpcState(s, 'alin', withInventory(synced.npcState, takeFromStock(synced.inventory, 'wire', 99))); // wire 抽干

    addItem(s.player.inventory, 'scrap_metal', 1);
    const fetchImpl = fakeFetch({
      chat: async () =>
        jsonResponse({
          choices: [
            {
              message: {
                content: '{"action":{"type":"trade","give":{"itemId":"wire","quantity":1},"get":{"itemId":"scrap_metal","quantity":1}},"confidence":0.9}',
              },
            },
          ],
        }),
    });
    // 不传 allowedActions → 用 ally 原型全集（含 trade），让库存校验真正上场。
    const runtime: NpcRuntimeConfig = {
      brain: new OllamaBrain({ model: 'npc-qwen:latest', fetchImpl, timeoutMs: 5000 }),
      fallback: new OptionTreeBrain(ALIN_LINE),
      timeoutMs: 5000,
    };
    const decision = await decideNpcAction(s, npcFactFor(s, alin), createNpcState('ally'), runtime);
    expect(decision.source).toBe('fallback');
    expect(decision.rejectionReason).toContain('NPC 没有');
  });

  it('库存足够时同一笔交易放行（对照：上面的拒绝确实来自库存）', async () => {
    const s = gameOnNpcFloor();
    const alin = getNpc('alin');
    syncNpcInventory(s, alin); // wire×2 够换
    addItem(s.player.inventory, 'scrap_metal', 1);
    const fetchImpl = fakeFetch({
      chat: async () =>
        jsonResponse({
          choices: [
            {
              message: {
                content: '{"action":{"type":"trade","give":{"itemId":"wire","quantity":1},"get":{"itemId":"scrap_metal","quantity":1}},"confidence":0.9}',
              },
            },
          ],
        }),
    });
    const runtime: NpcRuntimeConfig = {
      brain: new OllamaBrain({ model: 'npc-qwen:latest', fetchImpl, timeoutMs: 5000 }),
      fallback: new OptionTreeBrain(ALIN_LINE),
      timeoutMs: 5000,
    };
    const fact = npcFactFor(s, alin);
    expect(fact.inventory.find((e) => e.itemId === 'wire')?.quantity).toBe(2); // 真实库存，不是静态报价表
    const decision = await decideNpcAction(s, fact, createNpcState('ally'), runtime);
    expect(decision.source).toBe('brain');
    expect(decision.validated.ok).toBe(true);
    if (decision.validated.ok) expect(decision.validated.action.type).toBe('trade');
  });
});
