// NPC 运行时：观察 → 大脑 → 规则执行 → 降级的完整决策环（RFC §5）。
//
// 调用方（场景）只拿最后的 ValidatedAction 去执行，不关心中间走了
// 哪条路；source 字段供测试与日志断言「这次为什么用了降级」。

import { isNight } from '../systems/SurvivalSystem';
import { recall } from '../systems/NpcMemory';
import { ARCHETYPE_ACTIONS } from '../data/npcPersonalities';
import { validateProposal, type NpcFact, type ValidatedAction } from '../ai/rulesExecutor';
import type { NpcActionKind, NpcBrain, NpcObservation, NpcPersistedState } from '../ai/types';
import type { GameState } from '../core/gameTypes';

export interface NpcRuntimeConfig {
  /** 主脑（OllamaBrain）。不可用时自动降级。 */
  brain: NpcBrain;
  /** 降级脑（OptionTreeBrain）。主脑无意见时顶上。 */
  fallback: NpcBrain;
  /** 主脑超时。超时按「无意见」处理，不卡游戏循环。 */
  timeoutMs?: number;
  /** 进 prompt 的记忆条数。 */
  memoryRecallK?: number;
}

export type DecisionSource = 'brain' | 'fallback' | 'rejected';

export interface NpcDecision {
  validated: ValidatedAction;
  source: DecisionSource;
  /** 主脑被拒的原因（若有），供日志/测试。 */
  rejectionReason?: string;
}

const DEFAULT_TIMEOUT_MS = 45_000; // Spark 实测 npc-qwen 21-32s（见 config.ts 注释）
const DEFAULT_RECALL_K = 6;

/** 组装出站观察快照。纯函数，可在测试里直接断言内容。 */
export function buildObservation(
  npc: NpcFact,
  npcState: NpcPersistedState,
  state: GameState,
  recallK: number = DEFAULT_RECALL_K,
): NpcObservation {
  return {
    npcId: npc.id,
    archetype: npcState.archetype,
    traits: npcState.traits,
    memory: recall(npcState.memory, recallK),
    relationship: { ...npcState.relationship },
    goal: npcState.goal,
    mood: npcState.mood,
    world: {
      day: state.day,
      floor: state.currentFloor,
      gameMinute: state.gameMinuteOfDay,
      night: isNight(state.gameMinuteOfDay),
    },
    self: { floor: npc.floor, x: npc.x, hp: npc.hp },
    availableActions: ARCHETYPE_ACTIONS[npcState.archetype] as NpcActionKind[],
    recentEvents: state.diary ? state.diary.slice(-3).map((d) => d.message) : [],
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * 一次完整决策。任何一步失败都往下降一级：
 * 主脑超时/无意见/建议被拒 → 选项树 → 选项树也被拒 → rejected。
 */
export async function decideNpcAction(
  state: GameState,
  npc: NpcFact,
  npcState: NpcPersistedState,
  config: NpcRuntimeConfig,
): Promise<NpcDecision> {
  const observation = buildObservation(npc, npcState, state, config.memoryRecallK ?? DEFAULT_RECALL_K);

  if (await config.brain.health()) {
    const proposal = await withTimeout(config.brain.decide(observation), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (proposal) {
      const validated = validateProposal(state, npc, proposal);
      if (validated.ok) return { validated, source: 'brain' };
      // 主脑越界：记下原因，走降级
      const fallback = await runFallback(config.fallback, observation, state, npc);
      return { ...fallback, rejectionReason: validated.reason };
    }
  }
  return runFallback(config.fallback, observation, state, npc);
}

async function runFallback(
  fallback: NpcBrain,
  observation: NpcObservation,
  state: GameState,
  npc: NpcFact,
): Promise<NpcDecision> {
  const proposal = await fallback.decide(observation);
  if (proposal) {
    const validated = validateProposal(state, npc, proposal);
    if (validated.ok) return { validated, source: 'fallback' };
    return { validated, source: 'rejected' };
  }
  return { validated: { ok: false, reason: '降级脑无意见' }, source: 'rejected' };
}
