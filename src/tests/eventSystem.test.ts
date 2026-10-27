import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { ensureNightEvent, rollDayEvent } from '../systems/EventSystem';
import { isNight } from '../systems/SurvivalSystem';

describe('rollDayEvent', () => {
  it('is deterministic for the same worldSeed + day', () => {
    expect(rollDayEvent(42, 1)).toEqual(rollDayEvent(42, 1));
    expect(rollDayEvent(2026, 3)).toEqual(rollDayEvent(2026, 3));
  });

  it('produces more than one event type across days', () => {
    const types = new Set<string>();
    for (let day = 1; day <= 12; day++) types.add(rollDayEvent(42, day).type);
    expect(types.size).toBeGreaterThan(1);
  });

  it('never targets the safe dorm (1) with a wanderer/leak', () => {
    for (let seed = 1; seed <= 60; seed++) {
      for (let day = 1; day <= 6; day++) {
        const e = rollDayEvent(seed, day);
        if (e.type === 'wanderer' || e.type === 'leak') expect(e.floor).not.toBe(1);
      }
    }
  });

  it('always carries a player-facing message', () => {
    for (let day = 1; day <= 7; day++) expect(rollDayEvent(7, day).message.length).toBeGreaterThan(0);
  });
});

describe('ensureNightEvent', () => {
  it('rolls once at night and reuses it (max one per day)', () => {
    const s = createNewGame(1);
    s.gameMinuteOfDay = 1320;
    const first = ensureNightEvent(s);
    expect(first.rolled).toBe(true);
    expect(s.worldEvents.activeEvent).not.toBeNull();
    const second = ensureNightEvent(s);
    expect(second.rolled).toBe(false);
    expect(second.event).toEqual(first.event);
    expect(s.worldEvents.history).toHaveLength(1);
  });

  it('does not roll during the day', () => {
    const s = createNewGame(1);
    s.gameMinuteOfDay = 720;
    expect(ensureNightEvent(s).rolled).toBe(false);
    expect(s.worldEvents.activeEvent).toBeNull();
  });

  it('re-rolls after the event is reset for a new day', () => {
    const s = createNewGame(1);
    s.gameMinuteOfDay = 1320;
    ensureNightEvent(s);
    s.worldEvents.activeEvent = null; // day rollover resets it
    expect(ensureNightEvent(s).rolled).toBe(true);
  });
});

describe('isNight', () => {
  it('is night from 18:00 to 06:00', () => {
    expect(isNight(1320)).toBe(true);
    expect(isNight(60)).toBe(true);
    expect(isNight(720)).toBe(false);
    expect(isNight(360)).toBe(false);
  });
});
