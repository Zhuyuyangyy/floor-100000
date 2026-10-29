import { describe, expect, it } from 'vitest';

import {
  armNextRoll,
  dwellRollDue,
  ensureDwell,
  freshDwell,
  isDwellExempt,
  rollDwellEvent,
  tickDwell,
} from '../systems/dwellPressure';
import { GAME_CONFIG } from '../core/config';
import { createNewGame } from '../core/gameState';
import type { DwellState, GameState } from '../core/gameTypes';

// B3-15: the dwell-pressure rules. The system exists to make lingering cost
// something (M1_PLAYTEST's 8-hour idle window, B3-06's zero-reward night), so
// the invariants that matter are: the clock accumulates, moving resets it, the
// same seed replays the same rolls, and the prowler share climbs with each
// roll instead of being flat.

const INTERVAL = GAME_CONFIG.dwellPressure.rollIntervalGameMinutes;

function stateWith(seed = 42): GameState {
  return createNewGame(seed);
}

describe('dwell tracking', () => {
  it('accumulates minutes on the floor it was created for', () => {
    const d = freshDwell(3);
    tickDwell(d, 3, 30);
    expect(d.minutes).toBe(30);
    tickDwell(d, 3, 15);
    expect(d.minutes).toBe(45);
  });

  it('resets when the player changes floor — moving on is the escape', () => {
    const d = freshDwell(3);
    tickDwell(d, 3, 500);
    armNextRoll(d);
    const moved = tickDwell(d, 4, 10);
    expect(moved.minutes).toBe(10);
    expect(moved.rolls).toBe(0);
    expect(moved.floor).toBe(4);
  });

  it('becomes due exactly at the configured interval', () => {
    const d = freshDwell(3);
    tickDwell(d, 3, INTERVAL - 1);
    expect(dwellRollDue(d)).toBe(false);
    tickDwell(d, 3, 1);
    expect(dwellRollDue(d)).toBe(true);
  });

  it('arms the next roll one interval after the roll that just fired', () => {
    const d = freshDwell(3);
    tickDwell(d, 3, INTERVAL);
    armNextRoll(d);
    expect(d.rolls).toBe(1);
    expect(d.nextRollAt).toBe(INTERVAL + INTERVAL);
    // Still due right after arming? No — the interval is measured from the roll.
    tickDwell(d, 3, 1);
    expect(dwellRollDue(d)).toBe(false);
  });

  it('re-creates a missing tracker for saves written before B3-15', () => {
    const s = stateWith();
    delete s.worldEvents.dwell;
    const d = ensureDwell(s);
    expect(d.floor).toBe(s.currentFloor);
    expect(d.minutes).toBe(0);
    expect(s.worldEvents.dwell).toBe(d);
  });

  it('never applies pressure on the dorm floor', () => {
    expect(isDwellExempt(1)).toBe(true);
    expect(isDwellExempt(2)).toBe(false);
  });
});

describe('dwell rolls', () => {
  it('replays identically for the same seed, day, floor and roll index', () => {
    const s = stateWith(7);
    const d: DwellState = { floor: 3, minutes: 60, nextRollAt: 60, rolls: 2 };
    const a = rollDwellEvent(s, d, 3);
    const b = rollDwellEvent(s, d, 3);
    expect(a).toEqual(b);
  });

  it('gives every outcome a non-empty message', () => {
    const s = stateWith(11);
    for (let rolls = 0; rolls < 6; rolls++) {
      const d: DwellState = { floor: 2, minutes: 60, nextRollAt: 60, rolls };
      const o = rollDwellEvent(s, d, 2);
      if (o.kind !== 'nothing') expect(o.message.length).toBeGreaterThan(0);
    }
  });

  it('escalates: the prowler share never falls as rolls accumulate', () => {
    // Statistical over many seeds — one seed proves nothing about a table.
    const SAMPLES = 300;
    const rates: number[] = [];
    for (let rolls = 0; rolls < 4; rolls++) {
      let prowlers = 0;
      for (let seed = 1; seed <= SAMPLES; seed++) {
        const s = stateWith(seed);
        const d: DwellState = { floor: 2, minutes: 60, nextRollAt: 60, rolls };
        if (rollDwellEvent(s, d, 2).kind === 'prowler') prowlers++;
      }
      rates.push(prowlers / SAMPLES);
    }
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i], `rates: ${rates.map((r) => r.toFixed(2)).join(', ')}`).toBeGreaterThanOrEqual(rates[i - 1] - 0.03);
    }
    // The first roll must be gentle and the last row must bite.
    expect(rates[0]).toBeLessThan(0.1);
    expect(rates[3]).toBeGreaterThan(0.45);
  });

  it('stays within the table rows even after many rolls', () => {
    // Row index clamps at the last row — a player who never leaves does not
    // roll past the designed ceiling, but the ceiling keeps applying.
    const s = stateWith(3);
    const d: DwellState = { floor: 4, minutes: 9999, nextRollAt: 9999, rolls: 50 };
    const o = rollDwellEvent(s, d, 4);
    expect(['nothing', 'atmosphere', 'prowler']).toContain(o.kind);
  });
});
