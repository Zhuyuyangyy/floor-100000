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
import { FLOOR_WIDTH, floorWidthFor, STARTING_FLOOR } from '../core/constants';
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

/** 确定性出生点：同 (runSeed, day, source, floor) → 同位置。
 *
 * AG-104：出生带按本层实际宽度（floorWidthFor(floor)：宽楼 1600-2880px+）。
 * 原来写死 FLOOR_WIDTH(1280)——宽楼上流浪者永远从左 1280 里出来，右半
 * 走断腿也撞不见它。rng 抽取不变，同 (seed, day, source, floor) 仍是同一个
 * 答案；tier1 各层 width=1280，出生点与修复前逐点一致。 */
export function wandererNightSpawnX(state: GameState, source: string, floor: number): number {
  const rng = makeRng(deriveSeed(state.runSeed, state.day, source, floor, 'wanderer-night'));
  const width = floorWidthFor(floor);
  return Math.round(WANDERER_EDGE_MARGIN + rng.nextFloat() * (width - WANDERER_EDGE_MARGIN * 2));
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

// ── 跨层寻仇（AG-13）─────────────────────────────────────────────────────
//
// AG-06 遗留缺口：「结仇只放大仇恨范围，没有跨层寻仇」——流浪者记了仇，
// 却只会在夜间事件恰好轮到玩家所在层时才出现。这里补上：关系 ≤ -30
// （WANDERER_GRUDGE_RELATIONSHIP）之后，从记仇次日起每个游戏日掷一次
// 骰，命中则当日盯上玩家——不管夜间事件抽没抽到这层，它都来。
//
// 概率模型（全部确定性，禁 Math.random）：
//   P(寻仇) = 0（未结仇 / 结仇当日 / 宿舍层）
//           = WANDERER_VENDETTA_CHANCE（结仇次日起，每日一次判定）
// 每日判定走 deriveSeed(runSeed, day, 'wanderer', 'vendetta')：同 seed
// 同天必得同一结果，跨天重新掷。呈现时机沿用流浪者的夜行习性——
// 白天寻仇者只是「在这层埋伏」，入夜才真正登场（present）。
// 宿舍（STARTING_FLOOR）是安全屋，与 EventSystem 的 EVENT_FLOORS
// 豁免一致：回家就安全。

/** 结仇后每日跨层寻仇的基础概率（可调；0.4 ≈ 平均两天半来一次）。 */
export const WANDERER_VENDETTA_CHANCE = 0.4;

export interface WandererVendettaPlan {
  /** 今日流浪者是否盯上了玩家（跨层寻仇判定；白天也为 true，它在埋伏） */
  hunting: boolean;
  /** 这一帧该不该在场上：寻仇判定命中且是夜间 */
  present: boolean;
  /** 寻仇目标楼层 = 玩家当前楼层（不在场时也是当前楼层，供日志） */
  floor: number;
  /** 确定性出生点（不在场为 0） */
  spawnX: number;
  /** 仇恨范围（结仇放大后的 390；寻仇必然已结仇） */
  aggroRange: number;
  /** 今日掷出的点数 0..1（未掷时为 0；测试/日志用） */
  roll: number;
  /** 不寻仇/不在场的原因（测试/日志用；在场时为空串） */
  reason: string;
}

/**
 * 记仇日：关系已结仇时，取该 NPC 最近一条负面记忆（weight < 0）的日期。
 * 没有负面记忆却已是结仇关系（例如直接写进存档的状态）→ 0，
 * 视为「早于本存档」，从第 1 天起就可寻仇。未结仇 → 0（调用方先看关系）。
 */
export function wandererGrudgeDay(state: GameState): number {
  const npcState = loadNpcState(state, 'wanderer');
  const relationship = npcState?.relationship.player ?? 0;
  if (relationship > WANDERER_GRUDGE_RELATIONSHIP) return 0;
  let day = 0;
  for (const m of npcState?.memory ?? []) {
    if (m.weight < 0 && m.day > day) day = m.day;
  }
  return day;
}

/**
 * 今日（这一帧）流浪者的跨层寻仇计划。纯函数：同 state → 同结果，
 * 不写任何状态。与 planNightWanderer 的关系：两者独立求值，场景在
 * present 时优先采用本计划（寻仇无视夜间事件的抽层结果），否则回落
 * 到夜间事件计划。
 */
export function planWandererVendetta(state: GameState): WandererVendettaPlan {
  const floor = state.currentFloor;
  const aggroRange = wandererAggroRange(state);
  const npcState = loadNpcState(state, 'wanderer');
  const relationship = npcState?.relationship.player ?? 0;
  if (relationship > WANDERER_GRUDGE_RELATIONSHIP) {
    return { hunting: false, present: false, floor, spawnX: 0, aggroRange, roll: 0, reason: '流浪者尚未记仇（关系 > -30）' };
  }
  const grudgeDay = wandererGrudgeDay(state);
  if (state.day <= grudgeDay) {
    return {
      hunting: false,
      present: false,
      floor,
      spawnX: 0,
      aggroRange,
      roll: 0,
      reason: `结仇第 ${grudgeDay} 日不寻仇，给玩家一夜缓冲`,
    };
  }
  if (floor === STARTING_FLOOR) {
    return { hunting: false, present: false, floor, spawnX: 0, aggroRange, roll: 0, reason: '宿舍是安全屋，寻仇者不进门' };
  }
  const rng = makeRng(deriveSeed(state.runSeed, state.day, 'wanderer', 'vendetta'));
  const roll = rng.nextFloat();
  if (roll >= WANDERER_VENDETTA_CHANCE) {
    return {
      hunting: false,
      present: false,
      floor,
      spawnX: 0,
      aggroRange,
      roll,
      reason: `今日未寻仇（掷出 ${roll.toFixed(2)} ≥ ${WANDERER_VENDETTA_CHANCE}）`,
    };
  }
  if (!isNight(state.gameMinuteOfDay)) {
    return {
      hunting: true,
      present: false,
      floor,
      spawnX: 0,
      aggroRange,
      roll,
      reason: '寻仇者已盯上玩家，天亮了它就在本层埋伏',
    };
  }
  return {
    hunting: true,
    present: true,
    floor,
    spawnX: wandererNightSpawnX(state, 'vendetta', floor),
    aggroRange,
    roll,
    reason: '',
  };
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
  /**
   * AG-104：本层实际宽度（floorWidthFor：宽楼 1600-2880px+）。缺省按
   * FLOOR_WIDTH(1280)——存量调用（测试）不变；宽楼场景由调用侧传入，
   * 撤退出口/巡逻路径点/边界钳制才覆盖全层而不是只左 1280。
   */
  floorWidth?: number;
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
  // AG-104：楼层宽从 ctx 取（缺省 1280 保持存量行为），宽楼巡逻/撤退覆盖全层。
  const width = ctx.floorWidth ?? FLOOR_WIDTH;
  let { phase, x, targetX } = roam;
  if (phase === 'withdraw') {
    targetX = x < width / 2 ? 0 : width;
  } else if (Math.abs(ctx.playerX - x) <= ctx.aggroRange) {
    phase = 'approach';
    targetX = ctx.playerX;
  } else {
    phase = 'patrol';
    if (Math.abs(targetX - x) < 4) {
      targetX = WANDERER_EDGE_MARGIN + ctx.rng.nextFloat() * (width - WANDERER_EDGE_MARGIN * 2);
    }
  }
  const step = Math.sign(targetX - x) * WANDERER_ROAM_SPEED * dt;
  // 一步不超过到目标点的剩余距离，避免在路径点间抖动
  const move = Math.abs(targetX - x) <= Math.abs(step) ? targetX - x : step;
  x = Math.min(width, Math.max(0, x + move));
  return { phase, x, targetX };
}

/** 流浪者是否已经走出画面（withdraw 完成判定）。
 *
 * AG-104：边界按本层实际宽度（缺省 FLOOR_WIDTH 保持存量调用不变）——宽楼上
 * 不传楼层宽，右半的撤退者永远走不到「画面外」。 */
export function wandererRoamGone(roam: WandererRoam, floorWidth: number = FLOOR_WIDTH): boolean {
  return roam.phase === 'withdraw' && (roam.x <= 8 || roam.x >= floorWidth - 8);
}
