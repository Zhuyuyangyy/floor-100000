import { makeRng, deriveSeed } from '../core/rng';
import { isNight } from './SurvivalSystem';
import { PLAYABLE_FLOORS_V01, STARTING_FLOOR } from '../core/constants';
import type { ActiveEvent, GameState } from '../core/gameTypes';

export type ActiveEventStatus = NonNullable<ActiveEvent['status']>;

// ── deprecated：worldEvents.activeEvent 的散落读点 ─────────────────────────
// AG-26（docs/plans/TWOM_ALIGNMENT.md §6）：事件的存在性/类型判断已收敛为
// flag——triggers.ts 的 ev:active / ev:blackout / ev:wanderer / ev:leak，
// 启动时注册、求值一次置位。存量字段与存量行为**保持不变**（旧存档、既有
// 测试、既有读者全部照旧）；新逻辑（日记、一次性反应、任务/对话条件）请查
// flag，不要再新增 re-read 这个字段的地方。旗是一次性事实（「本 run 经历
// 过」），每帧的实时判定（熄灯、漏水特效、流浪者在场）继续直读字段。

/** Legacy saves omit status; the only safe interpretation is an active event. */
export function eventStatus(event: ActiveEvent | null | undefined): ActiveEventStatus | null {
  return event ? (event.status ?? 'active') : null;
}

export function setEventStatus(event: ActiveEvent, status: ActiveEventStatus): void {
  event.status = status;
}

// Seed-determined night events (docs/01_GDD.md §10, docs/03_TASKS.md#p0-07).
// The safe dorm (the starting floor) is never a wanderer/leak target, so returning home is
// always a valid escape and no event is an unavoidable-death or permanent-black.

// Floors a wanderer/leak can hit — everything except the dorm.
const EVENT_FLOORS = PLAYABLE_FLOORS_V01.filter((f) => f !== STARTING_FLOOR);

// Deterministic: the same worldSeed + day always yields the same event.
export function rollDayEvent(worldSeed: number, day: number): ActiveEvent {
  const rng = makeRng(deriveSeed(worldSeed, day, 'night-event'));
  const roll = rng.nextFloat();
  if (roll < 0.34) {
    return { type: 'blackout', status: 'active', message: '走廊停电了，摸黑很危险，靠手电或回宿舍。' };
  }
  if (roll < 0.67) {
    const floor = EVENT_FLOORS[Math.floor(rng.nextFloat() * EVENT_FLOORS.length)];
    return { type: 'wanderer', floor, status: 'active', message: `巡游体在 ${floor} 层出没，回宿舍或换层躲避。` };
  }
  const floor = EVENT_FLOORS[Math.floor(rng.nextFloat() * EVENT_FLOORS.length)];
  return { type: 'leak', floor, status: 'active', message: `${floor} 层漏水，部分物资受潮。` };
}

// Roll (at most once per day) the night's event if it is night and none is active.
// Returns the active event, or the newly-rolled one (caller can flash its message).
//
// deprecated 路径提示：函数体内对 state.worldEvents.activeEvent 的读/写是
// 存量机制，保留原样；等价的旗查询是 ev:active / ev:<type>（triggers.ts），
// 「有没有事件」的新读者请走 flag，不要再各读各的。
export function ensureNightEvent(state: GameState): { event: ActiveEvent | null; rolled: boolean } {
  if (!isNight(state.gameMinuteOfDay)) {
    return { event: state.worldEvents.activeEvent, rolled: false };
  }
  // 存量读点：等价旗 ev:active（hasFlag(s, flagKey.event('active'))）——
  // 但注意旗不随跨天清理，实时守卫必须继续直读字段。
  if (state.worldEvents.activeEvent) {
    return { event: state.worldEvents.activeEvent, rolled: false };
  }
  const event = rollDayEvent(state.runSeed, state.day);
  state.worldEvents.activeEvent = event;
  state.worldEvents.history.push(`day${state.day}:${event.type}`);
  return { event, rolled: true };
}
