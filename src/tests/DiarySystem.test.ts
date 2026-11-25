import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { appendDiaryEvent, makeDiaryEvent, recentDiary, stressAfterEvent } from '../systems/DiarySystem';
import type { DiaryEvent } from '../core/gameTypes';

function makeTestEvent(state: ReturnType<typeof createNewGame>, index: number): DiaryEvent {
  return makeDiaryEvent(state, {
    floor: state.currentFloor,
    kind: 'shelter_rested',
    actorIds: [],
    itemChanges: [],
    stressDelta: 0,
    message: `event-${index}`,
  });
}

describe('DiarySystem', () => {
  it('keeps diary order and caps it at 64 events', () => {
    const state = createNewGame(42);
    for (let i = 0; i < 70; i++) appendDiaryEvent(state, makeTestEvent(state, i));

    expect(state.diary).toHaveLength(64);
    expect(state.diary?.[0].message).toBe('event-6');
    expect(recentDiary(state, 3).map((event) => event.message)).toEqual(['event-67', 'event-68', 'event-69']);
  });

  it('clamps stress to 0..100 and applies event deltas', () => {
    const state = createNewGame(42);
    state.player.stress = 99;
    expect(stressAfterEvent(state, 10)).toBe(100);
    expect(stressAfterEvent(state, -200)).toBe(0);

    state.player.stress = 20;
    appendDiaryEvent(state, { ...makeTestEvent(state, 1), stressDelta: 10 });
    expect(state.player.stress).toBe(30);
  });

  it('creates a deterministic event identity from the state and sequence', () => {
    const state = createNewGame(42);
    const event = makeDiaryEvent(state, {
      floor: 1,
      kind: 'returned_from_scavenge',
      actorIds: ['player'],
      itemChanges: [{ itemId: 'clean_water', quantity: 1 }],
      stressDelta: -2,
      message: '你带着水回来了。',
    });

    expect(event.id).toBe('day-1-minute-360-returned_from_scavenge-0');
    expect(event.day).toBe(1);
    expect(event.minute).toBe(360);
  });
});
