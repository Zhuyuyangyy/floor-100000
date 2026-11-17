// NPC 自主行动循环（阶段 C，docs/plans/NPC.md）：居民按游戏时间在自己的
// 日程里移动，有自己的目标，不是站着等玩家。
//
// 设计：
// - 位置是 (npcId, day, minuteOfDay, runSeed) 的纯函数——无状态、可复现，
//   场景每帧用当前游戏时间调用即可，不需要在场景里持有/持久化坐标。
// - 日程锚点来自 data/npcs.ts 的 schedule；在锚点间匀速步行，走惯了
//   在锚点周围做种子化的小范围闲逛（同一天同一时段位置一致）。
// - 需求（needs）见 npcInventory：库存见底时目标变成「寻找某物」，
//   由调用方把稀缺物品传进来（scarcity），保持本模块无库存依赖。

import { FLOOR_WIDTH } from '../core/constants';
import { deriveSeed, makeRng } from '../core/rng';
import { getItem } from '../data/items';
import type { ItemId } from '../core/gameTypes';
import type { NpcDef, NpcId } from '../data/npcs';
import { NPCS } from '../data/npcs';
import type { ScheduleSlot } from './types';

/** 居民步行速度：像素 / 游戏分钟。1 游戏分钟 ≈ 1/3 真实秒（config 3 分钟/秒）。 */
export const NPC_WALK_SPEED = 40;
/** 闲逛幅度：到达锚点后在 ±IDLE_BAND 内活动。 */
export const IDLE_BAND = 28;
/** 居民不越界的安全边距（留出楼梯交互区）。 */
export const NPC_MARGIN = 48;
/** 闲逛换点位的时间桶（游戏分钟）。 */
const IDLE_BUCKET_MINUTES = 15;

/** 全天单格日程的兜底（缺省 schedule 的 NPC 用一个锚点）。 */
function fallbackSchedule(npc: NpcDef): ScheduleSlot[] {
  return [{ from: 0, to: 1440, label: '待机', x: npc.x, goal: '安稳过天' }];
}

export function scheduleFor(npcId: string): ScheduleSlot[] {
  const npc = NPCS.find((n) => n.id === npcId);
  const slots = npc?.schedule ?? (npc ? fallbackSchedule(npc) : null);
  if (slots && slots.length > 0) return slots;
  return [{ from: 0, to: 1440, label: '待机', x: 640, goal: '待机' }];
}

/** 当前所处的日程格（跨午夜的格也正确）。返回格索引与未回绕的分钟。 */
export function slotAt(slots: ScheduleSlot[], minuteOfDay: number): { index: number; minute: number } {
  const m = minuteOfDay >= slots[0].from ? minuteOfDay : minuteOfDay + 1440;
  for (let i = 0; i < slots.length; i++) {
    const to = i === slots.length - 1 && slots[i].to <= slots[i].from ? slots[i].to + 1440 : slots[i].to;
    if (m >= slots[i].from && m < to) return { index: i, minute: m };
  }
  return { index: slots.length - 1, minute: m };
}

/**
 * 某个闲逛桶的确定性偏移量（-1..1，乘 IDLE_BAND 得像素偏移）。
 * 纯函数：同 (runSeed, npcId, day, 时段, 桶) → 同偏移。
 */
function idleOffset(runSeed: number, npcId: string, day: number, slotIndex: number, bucket: number): number {
  const rng = makeRng(deriveSeed(runSeed, npcId, day, slotIndex, bucket, 'idle'));
  return rng.nextFloat() * 2 - 1;
}

/** smoothstep：桶内进度 0..1 → 平滑 0..1（端点一阶导为 0，过渡不突兀）。 */
function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

export interface NpcAutonomyView {
  npcId: string;
  /** 当前 x（像素，已钳制在楼层安全范围内） */
  x: number;
  /** 所处日程标签 */
  slotLabel: string;
  /** 当前目标（纯文本，进 prompt）；库存稀缺时变为「寻找某物」 */
  goal: string;
  /** 是否正在走向锚点（false = 已到达，在闲逛/停留） */
  moving: boolean;
}

function clampX(x: number, width: number): number {
  return Math.min(width - NPC_MARGIN, Math.max(NPC_MARGIN, x));
}

/**
 * 某游戏时刻该 NPC 的自主状态。纯函数：同 (npcId, day, minuteOfDay,
 * runSeed, scarcity) → 同结果，与场景帧率、调用次数无关。
 *
 * AG-104：ctx.floorWidth 是本层实际宽度（floorWidthFor：宽楼 1600-2880px+），
 * 缺省 FLOOR_WIDTH(1280) 保持存量调用不变。钳制上限原来是写死的 1280-48——
 * 宽楼上 NPC 的 goTo/日程 x 永远到不了右半；现在由调用侧（GameScene.npcView）
 * 传本层宽度。锚点全部 ≤1200（data/npcs.ts），tier1 各层 width=1280，既有
 * 布局与修复前逐点一致。
 */
export function npcAutonomyAt(
  npcId: string,
  ctx: { day: number; minuteOfDay: number; runSeed: number; scarcity?: ItemId | null; floorWidth?: number },
): NpcAutonomyView {
  const width = ctx.floorWidth ?? FLOOR_WIDTH;
  const slots = scheduleFor(npcId);
  const { index, minute } = slotAt(slots, ctx.minuteOfDay);
  const slot = slots[index];
  const prev = slots[(index - 1 + slots.length) % slots.length];
  const elapsed = minute - slot.from;
  const distance = Math.abs(slot.x - prev.x);
  const walked = distance === 0 ? 1 : Math.min(1, (elapsed * NPC_WALK_SPEED) / distance);
  const moving = walked < 1;

  let x: number;
  if (moving) {
    x = prev.x + (slot.x - prev.x) * walked;
  } else {
    // 已到达锚点：按 (seed, npc, day, 时段, 时间桶) 做确定性闲逛。
    // AG-13 插值：在相邻两个桶的偏移之间按 smoothstep 连续过渡，
    // 消除 15 分钟桶切换时的位置跳变。偏移量始终落在 [-1, 1]
    // （两端点都是，smoothstep 权重在 [0,1]），所以闲逛半径不变，
    // 同时任意时刻的位置仍是 (npcId, day, minute, runSeed) 的纯函数。
    const bucket = Math.floor(elapsed / IDLE_BUCKET_MINUTES);
    const t = (elapsed - bucket * IDLE_BUCKET_MINUTES) / IDLE_BUCKET_MINUTES;
    const from = idleOffset(ctx.runSeed, npcId, ctx.day, index, bucket);
    const to = idleOffset(ctx.runSeed, npcId, ctx.day, index, bucket + 1);
    x = slot.x + (from + (to - from) * smoothstep(t)) * IDLE_BAND;
  }

  const goal = ctx.scarcity ? `寻找${getItem(ctx.scarcity).displayName}` : slot.goal;
  return { npcId, x: clampX(x, width), slotLabel: slot.label, goal, moving };
}

/** 某 NPC 当前稀缺的需求物品（库存见底 → 目标变成寻找它）。 */
export function scarcityOf(npc: NpcDef, stock: (itemId: ItemId) => number): ItemId | null {
  for (const need of npc.needs ?? []) {
    if (stock(need.itemId) <= 0) return need.itemId;
  }
  return null;
}

/** 便捷入口：给定 npc 定义与查库存函数，拿自主状态。
 *
 * AG-104：ctx.floorWidth 透传给 npcAutonomyAt（缺省 FLOOR_WIDTH 不变）。 */
export function npcAutonomyFor(
  npc: NpcDef,
  ctx: { day: number; minuteOfDay: number; runSeed: number; stock: (itemId: ItemId) => number; floorWidth?: number },
): NpcAutonomyView {
  return npcAutonomyAt(npc.id, { ...ctx, scarcity: scarcityOf(npc, ctx.stock) });
}

export type { NpcId };
