// NPC 运行时：观察 → 大脑 → 规则执行 → 降级的完整决策环（RFC §5）。
//
// 调用方（场景）只拿最后的 ValidatedAction 去执行，不关心中间走了
// 哪条路；source 字段供测试与日志断言「这次为什么用了降级」。

import { isNight } from '../systems/SurvivalSystem';
import { recall, visibleEvents } from '../systems/NpcMemory';
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
  /**
   * 本阶段实际接通了执行路径的行动（第一阶段场景只传 ['dialogue']）。
   * 模型提议集之外的行动一律拒绝并降级——AI 不能提出尚未接通的游戏行动。
   * 缺省用该人格原型的全集。
   */
  allowedActions?: NpcActionKind[];
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
  allowedActions?: NpcActionKind[],
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
    availableActions: allowedActions ?? (ARCHETYPE_ACTIONS[npcState.archetype] as NpcActionKind[]),
    // 只带该 NPC 有权知道的事件（亲历/公共），全局日记不过滤等于情报泄漏
    recentEvents: visibleEvents(npc.id, state.diary ?? []).slice(-3).map((d) => d.message),
  };
}

// ── 对话会话保鲜（P1-2）────────────────────────────────────────────────────
//
// 异步推理返回时，对话可能已经被玩家关闭再开、或翻过选项。用「会话 ID +
// 修订号」双键判定返回是否仍然针对当前屏幕上的这场对话；过期结果丢弃，
// 绝不覆盖玩家的新操作。

export interface DialogueSession {
  sessionId: number;
  revision: number;
}

export function isDialogueFresh(current: DialogueSession | null | undefined, captured: DialogueSession): boolean {
  return current !== null && current !== undefined && current.sessionId === captured.sessionId && current.revision === captured.revision;
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
  const observation = buildObservation(npc, npcState, state, config.memoryRecallK ?? DEFAULT_RECALL_K, config.allowedActions);

  if (await config.brain.health()) {
    const proposal = await withTimeout(config.brain.decide(observation), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (proposal) {
      // 提出尚未接通执行路径的行动 = 拒绝（与规则执行器的原型白名单互补：
      // 执行器管「这个人格能不能做」，这里管「这个阶段做没做」）
      if (!observation.availableActions.includes(proposal.action.type)) {
        const fallback = await runFallback(config.fallback, observation, state, npc);
        return { ...fallback, rejectionReason: `行动 ${proposal.action.type} 不在本阶段可用集` };
      }
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
