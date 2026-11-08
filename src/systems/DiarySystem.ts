import type { DiaryEvent, GameState } from '../core/gameTypes';

export const DIARY_LIMIT = 64;
const DEFAULT_STRESS = 20;

function clampStress(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** Return the next stress value without changing any other state. */
export function stressAfterEvent(state: GameState, delta: number): number {
  const current = typeof state.player.stress === 'number' && Number.isFinite(state.player.stress)
    ? state.player.stress
    : DEFAULT_STRESS;
  return clampStress(current + delta);
}

/** Build an event with a stable id from the current run state and event sequence. */
export function makeDiaryEvent(
  state: GameState,
  input: Omit<DiaryEvent, 'id' | 'day' | 'minute'>,
): DiaryEvent {
  const sequence = state.diary?.length ?? 0;
  return {
    ...input,
    id: `day-${state.day}-minute-${state.gameMinuteOfDay}-${input.kind}-${sequence}`,
    day: state.day,
    minute: state.gameMinuteOfDay,
  };
}

/** Append a fact and apply its stress delta, keeping the most recent 64 facts. */
export function appendDiaryEvent(state: GameState, event: DiaryEvent): void {
  const diary = state.diary ?? (state.diary = []);
  diary.push(event);
  if (diary.length > DIARY_LIMIT) diary.splice(0, diary.length - DIARY_LIMIT);
  state.player.stress = stressAfterEvent(state, event.stressDelta);
}

export function recentDiary(state: GameState, limit = 5): DiaryEvent[] {
  const diary = state.diary ?? [];
  if (limit <= 0) return [];
  return diary.slice(-limit);
}
