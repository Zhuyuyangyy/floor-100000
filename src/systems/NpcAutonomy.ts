// P8：敌对 NPC 的自主意图循环。
//
// 这个模块只负责「观察 → brain 提议 → 规则裁决 → 降级」和请求生命周期。
// 具体移动、扑击、伤害与事件结算仍由 GameScene + wandererAI.ts 执行。

import { buildObservation } from './NpcRuntime';
import { ARCHETYPES, createNpcState } from '../data/npcPersonalities';
import { validateProposal, type NpcEventFact, type NpcFact } from '../ai/rulesExecutor';
import type { NpcActionProposal, NpcBrain, NpcObservation, NpcPersistedState } from '../ai/types';
import type { GameState } from '../core/gameTypes';

export type WandererIntent = 'attack' | 'flee';

export interface WandererSituation {
  eventType: 'wanderer';
  eventSource: 'night' | 'dwell';
  eventStatus: 'active' | 'attack' | 'flee' | 'resolved';
  playerHp: number;
  playerX: number;
  npcX: number;
  distance: number;
  motionState: 'stalking' | 'lunge' | 'cooldown' | 'fleeing';
  lungeMsLeft: number;
  cooldownMsLeft: number;
  recentEncounter?: string;
}

export interface WandererDecisionConfig {
  brain: NpcBrain;
  fallback: NpcBrain;
  timeoutMs?: number;
  memoryRecallK?: number;
}

export interface WandererDecision {
  intent: WandererIntent | null;
  source: 'brain' | 'fallback' | 'rejected';
  observation: NpcObservation;
  rejectionReason?: string;
}

const DEFAULT_TIMEOUT_MS = 45_000;

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

export function wandererState(archetypeState?: NpcPersistedState): NpcPersistedState {
  return archetypeState ?? createNpcState('hostile');
}

export function buildWandererObservation(
  state: GameState,
  npcState: NpcPersistedState,
  situation: WandererSituation,
): { observation: NpcObservation; fact: NpcFact } {
  const event: NpcEventFact = {
    type: 'wanderer',
    floor: state.currentFloor,
    source: situation.eventSource,
    status: situation.eventStatus,
    distance: situation.distance,
    playerX: situation.playerX,
    npcX: situation.npcX,
  };
  const fact: NpcFact = {
    id: 'wanderer',
    archetype: 'hostile',
    floor: state.currentFloor,
    x: situation.npcX,
    hp: 1,
    inventory: [],
    event,
  };
  const observation = {
    ...buildObservation(fact, npcState, state, 6, ['attack', 'flee']),
    situation,
  } satisfies NpcObservation;
  return { observation, fact };
}

/** Deterministic fallback: preserve the pre-P8 chase behavior. */
export class WandererFallbackBrain implements NpcBrain {
  readonly id = 'wanderer-fallback';

  async health(): Promise<boolean> {
    return true;
  }

  async decide(_observation: NpcObservation): Promise<NpcActionProposal | null> {
    return { action: { type: 'attack' }, confidence: 1 };
  }
}

export async function decideWandererIntent(
  state: GameState,
  npcState: NpcPersistedState,
  situation: WandererSituation,
  config: WandererDecisionConfig,
): Promise<WandererDecision> {
  const { observation, fact } = buildWandererObservation(state, npcState, situation);
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fallback = async (reason?: string): Promise<WandererDecision> => {
    const proposal = await config.fallback.decide(observation);
    if (!proposal || !observation.availableActions.includes(proposal.action.type as 'attack' | 'flee')) {
      return { intent: null, source: 'rejected', observation, rejectionReason: reason ?? '降级脑无意见' };
    }
    const validated = validateProposal(state, fact, proposal);
    if (!validated.ok || (validated.action.type !== 'attack' && validated.action.type !== 'flee')) {
      return { intent: null, source: 'rejected', observation, rejectionReason: validated.ok ? '降级行动类型无效' : validated.reason };
    }
    return { intent: validated.action.type, source: 'fallback', observation, rejectionReason: reason };
  };

  const healthy = await withTimeout(config.brain.health(), Math.min(timeoutMs, 2_000));
  if (healthy) {
    const proposal = await withTimeout(config.brain.decide(observation), timeoutMs);
    if (proposal) {
      if (!observation.availableActions.includes(proposal.action.type as 'attack' | 'flee')) {
        return fallback(`行动 ${proposal.action.type} 不在 P8 可用集`);
      }
      const validated = validateProposal(state, fact, proposal);
      if (validated.ok && (validated.action.type === 'attack' || validated.action.type === 'flee')) {
        return { intent: validated.action.type, source: 'brain', observation };
      }
      return fallback(validated.ok ? '行动类型无效' : validated.reason);
    }
  }
  return fallback('主脑不可用或超时');
}

/** Request token + single-flight guard. The scene owns the actual promise. */
export class WandererAutonomyController {
  private generation = 0;
  private inFlight = false;

  begin(): number | null {
    if (this.inFlight) return null;
    this.inFlight = true;
    this.generation += 1;
    return this.generation;
  }

  cancel(): void {
    this.generation += 1;
    this.inFlight = false;
  }

  isCurrent(token: number): boolean {
    return token === this.generation;
  }

  finish(token: number): void {
    if (token === this.generation) this.inFlight = false;
  }
}

export const WANDERER_ARCHETYPE = ARCHETYPES.hostile;
