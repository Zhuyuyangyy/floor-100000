// AG-73：新手教程的纯逻辑（无 Phaser、无 DOM——单测在 node 环境跑）。
//
// 分工：本文件回答三个问题——「教程进行到哪一步了」（推进判定）、「这一步
// 该不该在 contextual 槽说话」（出现条件）、「这一步要高亮谁」（几何）。
// 显示与输入在 GameScene（initTutorial / tickTutorial / refreshTutorialChrome
// / tutorialNavHint），本文件不碰场景。
//
// 持久化的取舍（任务书要求报告里说清）：进度不走 GameState。三个理由——
//   1. 「跳过」与「六步全过永不再出现」都是**跨对局**语义，住进对局存档的
//      字段在新开一局时就被重置，反而做不到「永不再出现」；
//   2. state.combat 那种活体内存不碰、GameState 加字段要过 SaveSystem 的
//      白名单校验，为一个 UI 引导升级 schemaVersion 不划算；
//   3. 先例在那：metaProgress（角色解锁/ relic）就是 localStorage
//      'floor100000.meta.v1'，教程与它同族。
// 代价：进度存在本机，换浏览器/清存储会重看；以及中途退出的对局从存档续上
// 时，教程从 localStorage 记的步数接着走（这正是「进度持久化」的本意）。

import { BED_X, CRAFT_X, STARTING_FLOOR, UP_EXIT_X } from '../core/constants';
import { HUD_LAYOUT } from '../render/hudLayout';
import { isNight } from './SurvivalSystem';
import { TUTORIAL_STEPS, type TutorialStepId } from '../data/tutorial';
import type { FloorVisit } from '../core/gameTypes';

/** 六步。TUTORIAL_STEPS.length 即步数，文案顺序即教程顺序。 */
export const TUTORIAL_STEP_COUNT = TUTORIAL_STEPS.length;

/** 第 1 步（移动）的达成距离：从落点算起挪过 200px 就算会走了。 */
export const TUTORIAL_MOVE_TARGET_PX = 200;
/** 第 3 步（圆环）的自动推进等待：高亮 3 秒，无强制等待，到点进下一步。 */
export const TUTORIAL_STATS_HOLD_MS = 3000;
/**
 * 第 2 步（搜刮）提示的出现半径：交互距离（44）之外就开始说，贴近之后
 * 交给世界链的「[E] 打开 储物柜」键帽提示——同一个动作，原生提示更短更准。
 */
export const TUTORIAL_LOOT_RANGE_PX = 200;

/** localStorage 键，与 floor100000.save.v1 / floor100000.meta.v1 同族。 */
export const TUTORIAL_PROGRESS_KEY = 'floor100000.tutorial.progress';
export const TUTORIAL_SKIPPED_KEY = 'floor100000.tutorial.skipped';

/** 只要能 get/set/remove 就行——测试传 Map 假件，场景传 localStorage。 */
export interface TutorialStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TutorialState {
  /** 已完成的步数 0..6。6 = 六步全过，永不再出现。 */
  step: number;
  /** 本机跳过过：无论进度到哪，都不再出教程。 */
  skipped: boolean;
  /** 累计位移 |Δx|（含传送——检测钩子只认「位置变了」，不追问怎么变的）。 */
  moved: number;
  /** 当前这一步开始的时刻（场景时钟 ms）。第 3 步的 3 秒等待以它为起点。 */
  stepSince: number;
}

export function freshTutorial(now: number): TutorialState {
  return { step: 0, skipped: false, moved: 0, stepSince: now };
}

// 读取：坏值当没玩过（隐私模式/磁盘满/手改烂的键都不该崩），跳过键优先于
// 进度键——跳过是终态。
export function loadTutorial(storage: TutorialStorage, now: number): TutorialState {
  const state = freshTutorial(now);
  try {
    if (storage.getItem(TUTORIAL_SKIPPED_KEY) !== null) {
      state.skipped = true;
      state.step = TUTORIAL_STEP_COUNT;
      return state;
    }
    const raw = storage.getItem(TUTORIAL_PROGRESS_KEY);
    if (raw === null) return state;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) state.step = Math.min(n, TUTORIAL_STEP_COUNT);
  } catch {
    // 存储不可用：这一局就当新玩家，教程照常从头带。
  }
  return state;
}

export function saveTutorial(state: TutorialState, storage: TutorialStorage): void {
  try {
    storage.setItem(TUTORIAL_PROGRESS_KEY, String(state.step));
  } catch {
    // best-effort，与 metaProgress 同一立场：存不下不该断送游戏。
  }
}

// 跳过：写跳过键、撤进度键。本机永久生效，刷新/重开/继续都不再弹。
export function skipTutorial(state: TutorialState, storage: TutorialStorage): TutorialState {
  const next: TutorialState = { ...state, skipped: true, step: TUTORIAL_STEP_COUNT };
  try {
    storage.setItem(TUTORIAL_SKIPPED_KEY, '1');
    storage.removeItem(TUTORIAL_PROGRESS_KEY);
  } catch {
    // 至少这一局不再出。
  }
  return next;
}

export function tutorialActive(state: TutorialState): boolean {
  return !state.skipped && state.step < TUTORIAL_STEP_COUNT;
}

export function tutorialStepId(step: number): TutorialStepId | null {
  return TUTORIAL_STEPS[step]?.id ?? null;
}

/** 「开过第一个容器没有」——任意楼层的 openedContainers 非空即算。 */
export function hasOpenedAnyContainer(visitedFloors: Record<number, FloorVisit>): boolean {
  for (const visit of Object.values(visitedFloors)) {
    if (visit.openedContainers.length > 0) return true;
  }
  return false;
}

// ── 推进判定 ────────────────────────────────────────────────────────────────

/** 场景每帧喂给教程的观测值（全部是读取，不改任何状态）。 */
export interface TutorialSignals {
  /** 本帧距上一帧玩家 x 的绝对变化量。 */
  dx: number;
  /** 任意楼层开过第一个容器没有（visitedFloors[*].openedContainers 非空）。 */
  hasOpenedContainer: boolean;
  /** 制作面板此刻开着没有。 */
  craftingOpen: boolean;
  /** 当前楼层。 */
  currentFloor: number;
  /** 当前时刻的游戏分钟。 */
  minuteOfDay: number;
  /** 睡过没有（shelterPlan 已结算）。 */
  slept: boolean;
  /**
   * 站在自己床边没有（起始层 + 交互距离内）。床步的「知道床在哪」——床在
   * 1 层，玩家爬梯上楼后随时可以回去找到它，这一步因此不必悬到入夜。
   */
  nearBed: boolean;
}

function stepSatisfied(step: number, state: TutorialState, s: TutorialSignals, now: number): boolean {
  switch (step) {
    case 0:
      // moved 已含本帧的 dx（tickTutorial 先累计再判定），这里只比累计值。
      return state.moved >= TUTORIAL_MOVE_TARGET_PX;
    case 1:
      return s.hasOpenedContainer;
    case 2:
      return now - state.stepSince >= TUTORIAL_STATS_HOLD_MS;
    case 3:
      return s.craftingOpen;
    case 4:
      return s.currentFloor > STARTING_FLOOR;
    case 5:
      // RC-02 XP-3：完成条件是「睡过 / 入夜 / 站到过自己床边」三选一。
      // 修前只有前两条——最后一步从早晾到入夜，教程结尾悬着一个当晚才
      // 能做的动作（试玩报告 run-seed1.log 07:35:16）。床步的课是「夜里
      // 回床按 E 睡觉」，教会它的标志是玩家找到了床，不必真等到夜里；
      // 入夜路径保留作兜底（爬上楼就不回 1 层的玩家照样收尾）。
      return s.slept || isNight(s.minuteOfDay) || s.nearBed;
    default:
      return false;
  }
}

export interface TutorialTickResult {
  state: TutorialState;
  /** 本帧推进过没有（场景据此落盘）。 */
  advanced: boolean;
  /** 本帧六步全过没有（场景据此放收尾 flash，只放一次）。 */
  completed: boolean;
}

/**
 * 一拍：累计位移 → 顺序推进（一次可能连过数步：续档时人已在 5 层，第 4 步
 * 当场结算）→ 报告推进与完成。纯函数：同一 (state, tick) 进，同一结果出。
 */
export function tickTutorial(prev: TutorialState, tick: { signals: TutorialSignals; now: number }): TutorialTickResult {
  let next: TutorialState = { ...prev, moved: prev.moved + Math.max(0, tick.signals.dx) };
  let advanced = false;
  // 只推进当前步：第 3 步没到 3 秒时，哪怕玩家已经会爬梯也不跳过它。
  while (next.step < TUTORIAL_STEP_COUNT && stepSatisfied(next.step, next, tick.signals, tick.now)) {
    next = { ...next, step: next.step + 1, stepSince: tick.now };
    advanced = true;
  }
  return { state: next, advanced, completed: advanced && next.step === TUTORIAL_STEP_COUNT };
}

// ── contextual 槽的出现条件 ─────────────────────────────────────────────────

/** 场景喂给出现判定/高亮几何的楼层上下文（只读快照）。 */
export interface TutorialWorld {
  playerX: number;
  currentFloor: number;
  /** 本层视图的容器（id + x 就够；已舔光的自然不在视图里）。 */
  containers: Array<{ id: string; x: number }>;
  /** 本层开过的容器 id。 */
  openedIds: string[];
}

/** 本层离玩家最近的一只没开过的容器（range 内；高亮用 Infinity 找「去哪」）。 */
export function nearestUnopenedContainer(world: TutorialWorld, range: number): { x: number } | null {
  let best: { x: number } | null = null;
  let bestDist = range;
  for (const c of world.containers) {
    if (world.openedIds.includes(c.id)) continue;
    const d = Math.abs(c.x - world.playerX);
    if (d <= bestDist) {
      bestDist = d;
      best = { x: c.x };
    }
  }
  return best;
}

/**
 * 这一步此刻该不该在 contextual 槽说话。默认都说；两处收紧：
 *   * 搜刮：走近没开过的容器才说（贴近后世界链的键帽提示接棒，见
 *     TUTORIAL_LOOT_RANGE_PX 的注释——出现条件与提示半径是同一个数）；
 *   * 爬梯：只在出发的 1 层说（别的层上这一课没有目标物件）。
 */
export function tutorialHintVisible(state: TutorialState, world: TutorialWorld): boolean {
  if (!tutorialActive(state)) return false;
  switch (state.step) {
    case 1:
      return nearestUnopenedContainer(world, TUTORIAL_LOOT_RANGE_PX) !== null;
    case 4:
      return world.currentFloor === STARTING_FLOOR;
    default:
      return true;
  }
}

/**
 * 世界链此刻是不是在教本步目标物的同一个 E 动作。是就让世界说——它的
 * 「[E] 键帽 + 动作名」比教程文案更短更准（AG-71 的读法）。判据是「本步
 * 目标物就在手边」：
 *   * 搜刮步：手边就有没开过的容器（出现条件已保证，恒真）；
 *   * 制作/爬梯/床步：站在工作台/梯口/自己的床 200px 内（同为 1 层）。
 * 移动步与圆环步没有 E 目标物，永不让步——出生点（640）恰好压着一张室友
 * 床，世界脚注是「按 E 搜刮床铺」，那和「先学会移动」不是同一件事，教程
 * 该盖住它说。
 */
export function tutorialYieldsToWorld(state: TutorialState, world: TutorialWorld): boolean {
  if (!tutorialActive(state)) return false;
  if (world.currentFloor !== STARTING_FLOOR) return false;
  const near = (x: number): boolean => Math.abs(x - world.playerX) <= TUTORIAL_LOOT_RANGE_PX;
  switch (state.step) {
    case 1:
      return nearestUnopenedContainer(world, TUTORIAL_LOOT_RANGE_PX) !== null;
    case 3:
      return near(CRAFT_X);
    case 4:
      return near(UP_EXIT_X);
    case 5:
      return near(BED_X);
    default:
      return false;
  }
}

// ── 高亮几何 ────────────────────────────────────────────────────────────────

export type TutorialHighlight =
  | { space: 'world'; x: number; y: number; w: number; h: number }
  | { space: 'hud'; x: number; y: number; w: number; h: number };

/**
 * 楼层道具的呼吸框尺寸。道具底座在 FLOOR_HEIGHT - 64（容器/工作台/床同一
 * 条线，见 GameScene buildContainers/drawWorkbench/drawBed），竖条 64..148
 * 盖得住柜、工作台与床三种画幅。
 */
const PROP_BOX = { top: 64, height: 84 };
const CONTAINER_BOX_W = 96;
const STAIR_BOX_W = 88;
const BED_BOX_W = 120;

const propBox = (x: number, w: number): TutorialHighlight => ({
  space: 'world',
  x: x - w / 2,
  y: PROP_BOX.top,
  w,
  h: PROP_BOX.height,
});

/** 第 3 步的 HUD 圆环高亮：四枚圆环整行一个框（屏幕坐标）。 */
function ringsBox(): TutorialHighlight {
  const pad = HUD_LAYOUT.ringR + 6;
  const first = HUD_LAYOUT.statX - pad;
  const last = HUD_LAYOUT.statX + 3 * HUD_LAYOUT.statPitch + pad;
  return {
    space: 'hud',
    x: first,
    y: Math.max(2, HUD_LAYOUT.ringCY - pad),
    w: last - first,
    h: 2 * pad,
  };
}

/**
 * 本步要高亮谁。世界目标（柜/工作台/梯口/床）只在自己那一层存在；第 1 步
 * （移动）没有目标物件——开局 flash 与 contextual 文案就是它的引导。
 */
export function tutorialHighlight(state: TutorialState, world: TutorialWorld): TutorialHighlight | null {
  if (!tutorialActive(state)) return null;
  switch (state.step) {
    case 0:
      return null;
    case 1: {
      const target = nearestUnopenedContainer(world, Number.POSITIVE_INFINITY);
      return target ? propBox(target.x, CONTAINER_BOX_W) : null;
    }
    case 2:
      return ringsBox();
    case 3:
      return world.currentFloor === STARTING_FLOOR ? propBox(CRAFT_X, CONTAINER_BOX_W) : null;
    case 4:
      return world.currentFloor === STARTING_FLOOR ? propBox(UP_EXIT_X, STAIR_BOX_W) : null;
    case 5:
      return world.currentFloor === STARTING_FLOOR ? propBox(BED_X, BED_BOX_W) : null;
    default:
      return null;
  }
}
