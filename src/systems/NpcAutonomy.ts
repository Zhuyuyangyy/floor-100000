// P8：敌对 NPC 的自主意图循环。
//
// 这个模块只负责「观察 → brain 提议 → 规则裁决 → 降级」和请求生命周期。
// 具体移动、扑击、伤害与事件结算仍由 GameScene + wandererAI.ts 执行。
//
// 阶段 C 新增（docs/plans/NPC.md）：夜间流浪者导演器——回答「今夜流浪者
// 该不该出现、在哪层、从哪出来、仇恨范围多大」，以及纯函数的游荡/逼近/
// 撤退步进。只读 EventSystem 的产物（state.worldEvents.activeEvent +
// eventStatus），不改 EventSystem 本身；扑击状态机仍归 wandererAI.ts。

import { buildObservation } from './NpcRuntime';
import { ARCHETYPES, createNpcState } from '../data/npcPersonalities';
import { validateProposal, type NpcEventFact, type NpcFact } from '../ai/rulesExecutor';
import { eventStatus } from './EventSystem';
import { isNight } from './SurvivalSystem';
import { loadNpcState } from './NpcMemory';
import { FLOOR_WIDTH } from '../core/constants';
import { deriveSeed, makeRng, type Rng } from '../core/rng';
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

// ── 夜间流浪者导演器（阶段 C）────────────────────────────────────────────
//
// EventSystem.rollDayEvent 决定「今夜有没有巡游体、在哪层」；本导演器
// 决定「这一帧它该不该在场上、从哪出来、盯多宽、往哪逛」。全部纯函数，
// 场景每帧调用 planNightWanderer 拿呈现计划即可。

/** 结仇后仇恨范围放大倍率（记忆真的影响行为，且是确定性的）。 */
export const WANDERER_GRUDGE_MULTIPLIER = 1.5;
/** 关系 <= 该值时流浪者记仇，仇恨范围放大。 */
export const WANDERER_GRUDGE_RELATIONSHIP = -30;
/** 游荡速度：像素 / 真实秒（与 wandererAI 的帧级语义一致）。 */
export const WANDERER_ROAM_SPEED = 70;
/** 游荡出生/路径点离屏幕边缘的安全距离。 */
const WANDERER_EDGE_MARGIN = 48;

export interface NightWandererPlan {
  /** 这一帧流浪者是否应该在场上 */
  present: boolean;
  /** 它出没的楼层（不在场时为事件楼层或当前楼层） */
  floor: number;
  /** 确定性出生点（不在场时为 0） */
  spawnX: number;
  /** 仇恨范围（像素）；结仇时放大 */
  aggroRange: number;
  /** 不在场的原因（测试/日志用；在场时为空串） */
  reason: string;
}

function absentPlan(floor: number, reason: string): NightWandererPlan {
  return { present: false, floor, spawnX: 0, aggroRange: 0, reason };
}

/** 确定性出生点：同 (runSeed, day, source, floor) → 同位置。 */
export function wandererNightSpawnX(state: GameState, source: string, floor: number): number {
  const rng = makeRng(deriveSeed(state.runSeed, state.day, source, floor, 'wanderer-night'));
  return Math.round(WANDERER_EDGE_MARGIN + rng.nextFloat() * (FLOOR_WIDTH - WANDERER_EDGE_MARGIN * 2));
}

/** 仇恨范围：原型基准 × 记仇放大（关系差 → 更远就盯上玩家）。 */
export function wandererAggroRange(state: GameState): number {
  const base = ARCHETYPES.hostile.aggroRange ?? 260;
  const npcState = loadNpcState(state, 'wanderer');
  const relationship = npcState?.relationship.player ?? 0;
  return relationship <= WANDERER_GRUDGE_RELATIONSHIP ? Math.round(base * WANDERER_GRUDGE_MULTIPLIER) : base;
}

/**
 * 今夜（这一帧）流浪者的呈现计划。判定全部读 GameState 与 EventSystem
 * 的既有产物，不写任何状态：
 * - 没有巡游体事件 / 事件已解决 → 不在场
 * - 事件楼层不是当前层 → 不在场（它只在自己那层活动）
 * - 非夜间且非停留压力事件 → 不在场（天亮了）
 */
export function planNightWanderer(state: GameState): NightWandererPlan {
  const event = state.worldEvents.activeEvent;
  if (!event || event.type !== 'wanderer') return absentPlan(state.currentFloor, '当前没有巡游体事件');
  const floor = event.floor ?? state.currentFloor;
  if (eventStatus(event) === 'resolved') return absentPlan(floor, '巡游体事件已解决');
  if (state.currentFloor !== floor) return absentPlan(floor, '巡游体不在本层');
  if (!isNight(state.gameMinuteOfDay) && event.source !== 'dwell') return absentPlan(floor, '天亮了，巡游体不会出现');
  const spawnX = wandererNightSpawnX(state, event.source ?? 'night', floor);
  return { present: true, floor, spawnX, aggroRange: wandererAggroRange(state), reason: '' };
}

// ── 游荡行为（阶段 C）────────────────────────────────────────────────────

export type WandererRoamPhase = 'patrol' | 'approach' | 'withdraw';

export interface WandererRoam {
  phase: WandererRoamPhase;
  /** 当前 x */
  x: number;
  /** 当前路径点（patrol 的闲逛点 / approach 的玩家位置 / withdraw 的出口） */
  targetX: number;
}

/** 新建游荡状态。x 通常是 plan.spawnX。 */
export function freshWandererRoam(x: number): WandererRoam {
  return { phase: 'patrol', x, targetX: x };
}

export interface WandererRoamContext {
  playerX: number;
  aggroRange: number;
  /** 帧时长（真实毫秒）。负值/0 按 0 处理。 */
  dtMs: number;
  /** 路径点随机源：由调用方用 deriveSeed 构造，保证同 seed 可复现 */
  rng: Rng;
}

/**
 * 推进一步游荡行为（纯函数，返回新状态）：
 * - withdraw：头也不回走向最近出口（天亮/事件结束时调用方置位）
 * - 玩家进入仇恨范围：approach，盯住玩家
 * - 否则 patrol：到达路径点后用 rng 换一个新路径点
 * x 始终钳制在楼层内，不会越界。
 */
export function stepWandererRoam(roam: WandererRoam, ctx: WandererRoamContext): WandererRoam {
  const dt = Math.max(0, ctx.dtMs) / 1000;
  let { phase, x, targetX } = roam;
  if (phase === 'withdraw') {
    targetX = x < FLOOR_WIDTH / 2 ? 0 : FLOOR_WIDTH;
  } else if (Math.abs(ctx.playerX - x) <= ctx.aggroRange) {
    phase = 'approach';
    targetX = ctx.playerX;
  } else {
    phase = 'patrol';
    if (Math.abs(targetX - x) < 4) {
      targetX = WANDERER_EDGE_MARGIN + ctx.rng.nextFloat() * (FLOOR_WIDTH - WANDERER_EDGE_MARGIN * 2);
    }
  }
  const step = Math.sign(targetX - x) * WANDERER_ROAM_SPEED * dt;
  // 一步不超过到目标点的剩余距离，避免在路径点间抖动
  const move = Math.abs(targetX - x) <= Math.abs(step) ? targetX - x : step;
  x = Math.min(FLOOR_WIDTH, Math.max(0, x + move));
  return { phase, x, targetX };
}

/** 流浪者是否已经走出画面（withdraw 完成判定）。 */
export function wandererRoamGone(roam: WandererRoam): boolean {
  return roam.phase === 'withdraw' && (roam.x <= 8 || roam.x >= FLOOR_WIDTH - 8);
}
