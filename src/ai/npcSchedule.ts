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

function clampX(x: number): number {
  return Math.min(FLOOR_WIDTH - NPC_MARGIN, Math.max(NPC_MARGIN, x));
}

/**
 * 某游戏时刻该 NPC 的自主状态。纯函数：同 (npcId, day, minuteOfDay,
 * runSeed, scarcity) → 同结果，与场景帧率、调用次数无关。
 */
export function npcAutonomyAt(
  npcId: string,
  ctx: { day: number; minuteOfDay: number; runSeed: number; scarcity?: ItemId | null },
): NpcAutonomyView {
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
    const bucket = Math.floor(elapsed / IDLE_BUCKET_MINUTES);
    const rng = makeRng(deriveSeed(ctx.runSeed, npcId, ctx.day, index, bucket, 'idle'));
    x = slot.x + (rng.nextFloat() * 2 - 1) * IDLE_BAND;
  }

  const goal = ctx.scarcity ? `寻找${getItem(ctx.scarcity).displayName}` : slot.goal;
  return { npcId, x: clampX(x), slotLabel: slot.label, goal, moving };
}

/** 某 NPC 当前稀缺的需求物品（库存见底 → 目标变成寻找它）。 */
export function scarcityOf(npc: NpcDef, stock: (itemId: ItemId) => number): ItemId | null {
  for (const need of npc.needs ?? []) {
    if (stock(need.itemId) <= 0) return need.itemId;
  }
  return null;
}

/** 便捷入口：给定 npc 定义与查库存函数，拿自主状态。 */
export function npcAutonomyFor(
  npc: NpcDef,
  ctx: { day: number; minuteOfDay: number; runSeed: number; stock: (itemId: ItemId) => number },
): NpcAutonomyView {
  return npcAutonomyAt(npc.id, { ...ctx, scarcity: scarcityOf(npc, ctx.stock) });
}

export type { NpcId };
