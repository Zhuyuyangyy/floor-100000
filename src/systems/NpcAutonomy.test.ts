import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiNpcConfig } from '../ai/config';
import { createNewGame } from '../core/gameState';
import { createNpcState } from '../data/npcPersonalities';
import { createWandererDecisionConfig, decideWandererIntent, type WandererSituation } from './NpcAutonomy';

const situation: WandererSituation = {
  eventType: 'wanderer',
  eventSource: 'night',
  eventStatus: 'active',
  playerHp: 20,
  playerX: 640,
  npcX: 700,
  distance: 60,
  motionState: 'stalking',
  lungeMsLeft: 0,
  cooldownMsLeft: 0,
};

function nightState() {
  const state = createNewGame(7);
  state.currentFloor = 2;
  state.gameMinuteOfDay = 1260;
  return state;
}

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('巡游体自治 AI 配置', () => {
  it('没有模型配置时使用离线脑，决策期间不请求本机 HTTP', async () => {
    vi.stubEnv('VITE_NPC_MODEL', '');
    vi.stubEnv('VITE_NPC_ENABLED', '');
    const requests: string[] = [];
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL) => {
      requests.push(String(input));
      throw new Error('offline mode must not make HTTP requests');
    }) as typeof fetch);

    const config = aiNpcConfig();
    expect(config.mode).toBe('offline');
    const decisionConfig = createWandererDecisionConfig(config);
    expect(decisionConfig.brain.id).toBe('wanderer-fallback');

    const decision = await decideWandererIntent(
      nightState(),
      createNpcState('hostile'),
      situation,
      decisionConfig,
    );

    expect(decision.intent).toBe('attack');
    expect(requests).toEqual([]);
  });

  it('显式配置模型时仍探测并调用本机 Ollama', async () => {
    vi.stubEnv('VITE_NPC_MODEL', 'qwen3:8b');
    vi.stubEnv('VITE_NPC_ENABLED', '');
    const requests: string[] = [];
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/api/tags')) return jsonResponse({});
      return jsonResponse({
        choices: [{ message: { content: '{"action":{"type":"attack"},"confidence":0.9}' } }],
      });
    }) as typeof fetch);

    const config = aiNpcConfig();
    expect(config.mode).toBe('ollama');
    const decisionConfig = createWandererDecisionConfig(config);
    expect(decisionConfig.brain.id).toBe('ollama');

    const decision = await decideWandererIntent(
      nightState(),
      createNpcState('hostile'),
      situation,
      decisionConfig,
    );

    expect(decision.intent).toBe('attack');
    expect(requests).toEqual([
      `${config.baseUrl}/api/tags`,
      `${config.baseUrl}/v1/chat/completions`,
    ]);
  });
});
