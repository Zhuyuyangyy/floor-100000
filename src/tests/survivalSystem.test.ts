import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { absoluteMinute, advanceTime, AUTOSAVE_EVERY_GAME_MINUTES, deathCause, formatClock, sleep } from '../systems/SurvivalSystem';
import { GAME_CONFIG } from '../core/config';

// Drive the clock in small real-time steps (like the render loop).
function tick(state: ReturnType<typeof createNewGame>, ms: number, step = 16) {
  let last: ReturnType<typeof advanceTime> | undefined;
  for (let t = 0; t < ms; t += step) last = advanceTime(state, step);
  return last;
}

// GHI-03 M3: the autosave cadence is measured in a monotonic minute index, so a
// midnight rollover must not look like "no time passed" and skip a save.
describe('absoluteMinute (autosave cadence)', () => {
  it('advances with the clock inside a day', () => {
    const s = createNewGame(1);
    s.gameMinuteOfDay = 100;
    const a = absoluteMinute(s);
    s.gameMinuteOfDay = 260;
    expect(absoluteMinute(s)).toBeGreaterThan(a);
  });

  it('floors fractional minutes so one index covers a whole minute', () => {
    const s = createNewGame(1);
    s.gameMinuteOfDay = 100.9;
    expect(absoluteMinute(s)).toBe(absoluteMinute({ ...s, gameMinuteOfDay: 100.1 }));
  });

  it('does not go backwards across a day rollover', () => {
    const s = createNewGame(1);
    s.day = 1;
    s.gameMinuteOfDay = 1439.9;
    const before = absoluteMinute(s);
    s.day = 2;
    s.gameMinuteOfDay = 0;
    expect(absoluteMinute(s)).toBeGreaterThan(before);
  });

  it('uses a cadence coarse enough not to write every frame', () => {
    // The clock runs at gameMinutesPerRealSecond, so one game minute can pass in
    // a fraction of a second; saving per whole minute would mean several writes
    // per second.
    expect(AUTOSAVE_EVERY_GAME_MINUTES).toBeGreaterThan(1);
  });
});

describe('formatClock', () => {
  it('formats minute-of-day as HH:MM', () => {
    expect(formatClock(360)).toBe('06:00');
    expect(formatClock(1200)).toBe('20:00');
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(1439)).toBe('23:59');
  });
});

describe('advanceTime decay (standing still)', () => {
  it('decays thirst, hunger and energy as game time passes', () => {
    const s = createNewGame(1);
    const { thirst, hunger, energy } = s.player;
    tick(s, 10_000); // 30 game-minutes
    expect(s.player.thirst).toBeLessThan(thirst);
    expect(s.player.hunger).toBeLessThan(hunger);
    expect(s.player.energy).toBeLessThan(energy);
  });

  it('decays by the configured per-game-hour rates', () => {
    const s = createNewGame(1);
    tick(s, 20_000); // 60 game-minutes = 1 game-hour
    expect(s.player.thirst).toBeCloseTo(80 - GAME_CONFIG.player.thirstLossPerGameHour, 1);
    expect(s.player.hunger).toBeCloseTo(80 - GAME_CONFIG.player.hungerLossPerGameHour, 1);
    expect(s.player.energy).toBeCloseTo(80 - GAME_CONFIG.player.energyLossPerGameHour, 1);
  });

  it('clamps a huge delta (backgrounded tab) to one frame budget', () => {
    const s = createNewGame(1);
    const before = s.gameMinuteOfDay;
    advanceTime(s, 10_000_000);
    expect(s.gameMinuteOfDay - before).toBeCloseTo(0.75, 5); // 250ms * 3 game-min/s
  });
});

describe('advanceTime day rollover', () => {
  it('increments the day after midnight', () => {
    const s = createNewGame(1);
    s.gameMinuteOfDay = 1439.9;
    const t = advanceTime(s, 250); // clamped to 250ms -> +0.75 game-min -> wraps
    expect(t.dayChanged).toBe(true);
    expect(s.day).toBe(2);
    expect(s.gameMinuteOfDay).toBeCloseTo(0.65, 5);
  });
});

describe('victory', () => {
  it('wins on reaching day 8 at/after 06:00 with HP > 0', () => {
    const s = createNewGame(1);
    s.day = 7;
    s.gameMinuteOfDay = 1200;
    tick(s, 80_000); // into day 8, still before 06:00
    expect(s.day).toBe(8);
    expect(s.status).toBe('playing');
    tick(s, 130_000); // past 06:00
    expect(s.status).toBe('won');
  });
});

describe('sleep', () => {
  it('is refused before 20:00', () => {
    const s = createNewGame(1);
    expect(sleep(s).ok).toBe(false);
  });

  it('advances to the next day 06:00 and restores energy', () => {
    const s = createNewGame(1);
    s.day = 2;
    s.gameMinuteOfDay = 1200;
    s.player.energy = 30;
    const r = sleep(s);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.won).toBe(false);
      expect(r.newDay).toBe(3);
    }
    expect(s.gameMinuteOfDay).toBe(GAME_CONFIG.time.dayStartMinute);
    expect(s.player.energy).toBe(GAME_CONFIG.player.energyMax);
  });

  it('wins when sleeping on the day-7 night', () => {
    const s = createNewGame(1);
    s.day = 7;
    s.gameMinuteOfDay = 1200;
    const r = sleep(s);
    expect(r.ok && r.won).toBe(true);
    expect(s.status).toBe('won');
    expect(s.day).toBe(8);
  });
});

describe('death', () => {
  it('dehydration drives HP to 0 -> lost, cause 严重脱水', () => {
    const s = createNewGame(1);
    s.player.hp = 4;
    s.player.thirst = 0;
    tick(s, 60_000);
    expect(s.status).toBe('lost');
    expect(s.player.hp).toBe(0);
    expect(deathCause(s)).toBe('严重脱水');
  });

  it('starvation cause 饥饿 when only hunger is 0', () => {
    const s = createNewGame(1);
    s.player.hp = 4;
    s.player.hunger = 0;
    s.player.thirst = 100;
    tick(s, 60_000);
    expect(s.status).toBe('lost');
    expect(deathCause(s)).toBe('饥饿');
  });

  it('is a no-op once the run has ended', () => {
    const s = createNewGame(1);
    s.status = 'lost';
    const t = advanceTime(s, 16);
    expect(t.died).toBe(false);
    expect(t.gameMinutes).toBe(0);
  });
});
