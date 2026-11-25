import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import {
  absoluteMinute,
  advanceTime,
  ACTION_COSTS,
  AUTOSAVE_EVERY_GAME_MINUTES,
  deathCause,
  formatClock,
  isLegacyVictory,
  sleep,
  spendTime,
} from '../systems/SurvivalSystem';
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
    // Read the starts from the balance file rather than copying 80: a tuning
    // pass that moves a start must not turn this red for the wrong reason.
    const p = GAME_CONFIG.player;
    expect(s.player.thirst).toBeCloseTo(p.thirstStart - p.thirstLossPerGameHour, 1);
    expect(s.player.hunger).toBeCloseTo(p.hungerStart - p.hungerLossPerGameHour, 1);
    expect(s.player.energy).toBeCloseTo(p.energyStart - p.energyLossPerGameHour, 1);
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

// The v0.1 prototype ended the run on day 8. The frozen design replaces that
// with reaching the summit (B8), so in a normal run day 8 is just another day —
// the threshold survives only as the ?devwin=1 fixture.
describe('legacy day-8 victory (dev fixture only)', () => {
  it('does not win in a normal run when day 8 passes 06:00', () => {
    const s = createNewGame(1);
    s.day = 7;
    s.gameMinuteOfDay = 1200;
    tick(s, 80_000); // into day 8, still before 06:00
    expect(s.day).toBe(8);
    expect(s.status).toBe('playing');
    tick(s, 130_000); // past 06:00
    expect(s.status).toBe('playing'); // no auto-win any more
  });

  it('still recognises the retired threshold when the fixture is on', () => {
    const s = createNewGame(1);
    s.day = 7;
    s.gameMinuteOfDay = 1200;
    expect(isLegacyVictory(s)).toBe(false);
    s.day = 8;
    s.gameMinuteOfDay = 359;
    expect(isLegacyVictory(s)).toBe(false);
    s.gameMinuteOfDay = 360; // 06:00
    expect(isLegacyVictory(s)).toBe(true);
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

  it('does not win when sleeping on the day-7 night', () => {
    const s = createNewGame(1);
    s.day = 7;
    s.gameMinuteOfDay = 1200;
    const r = sleep(s);
    expect(r.ok && r.won).toBe(false);
    expect(s.status).toBe('playing');
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

// B3-03: actions cost game time, so a day is a budget rather than a countdown.
// spendTime must share advanceTime's rollover and decay rules exactly — a
// discrete jump that skipped them would let a player farm the clock.
describe('spendTime (action cost)', () => {
  it('advances the clock by exactly the given minutes', () => {
    const s = createNewGame(1);
    const before = s.gameMinuteOfDay;
    const t = spendTime(s, 20);
    expect(t.gameMinutes).toBe(20);
    expect(s.gameMinuteOfDay).toBe(before + 20);
    expect(s.day).toBe(1);
  });

  it('charges survival decay for the minutes it advances', () => {
    const s = createNewGame(1);
    const before = { hunger: s.player.hunger, thirst: s.player.thirst };
    spendTime(s, 60); // one full game hour
    expect(s.player.hunger).toBeCloseTo(before.hunger - GAME_CONFIG.player.hungerLossPerGameHour, 5);
    expect(s.player.thirst).toBeCloseTo(before.thirst - GAME_CONFIG.player.thirstLossPerGameHour, 5);
  });

  it('rolls the day over when the jump crosses midnight', () => {
    const s = createNewGame(1);
    s.gameMinuteOfDay = 23 * 60 + 30;
    const t = spendTime(s, 60); // -> 00:30 next day
    expect(t.dayChanged).toBe(true);
    expect(s.day).toBe(2);
    expect(s.gameMinuteOfDay).toBe(30);
    expect(s.worldEvents.activeEvent).toBeNull(); // fresh roll for the new day
  });

  it('is a no-op once the run has ended', () => {
    const s = createNewGame(1);
    s.status = 'lost';
    const before = s.gameMinuteOfDay;
    expect(spendTime(s, 20).gameMinutes).toBe(0);
    expect(s.gameMinuteOfDay).toBe(before);
  });

  it('is a no-op for zero or negative minutes', () => {
    const s = createNewGame(1);
    const before = s.gameMinuteOfDay;
    expect(spendTime(s, 0).gameMinutes).toBe(0);
    expect(spendTime(s, -5).gameMinutes).toBe(0);
    expect(s.gameMinuteOfDay).toBe(before);
  });

  it('can end the run when the jump drains HP to zero', () => {
    const s = createNewGame(1);
    s.player.hp = 1;
    s.player.thirst = 0; // starving/dehydrated -> HP drains per game hour
    const t = spendTime(s, 60);
    expect(t.died).toBe(true);
    expect(s.status).toBe('lost');
    expect(s.player.hp).toBe(0);
  });

  it('reports the same day rollover as an equivalent run of frames', () => {
    // Each frame is clamped to MAX_FRAME_MS, so 200 frames of 250ms advance
    // 200 * 0.75 = 150 game minutes — the same jump must land on the same day.
    const frames = 200;
    const minutes = frames * (250 / 1000) * GAME_CONFIG.time.gameMinutesPerRealSecond;
    const a = createNewGame(7);
    a.gameMinuteOfDay = 1300;
    const b = createNewGame(7);
    b.gameMinuteOfDay = 1300;
    const jumped = spendTime(a, minutes);
    let walked: ReturnType<typeof advanceTime> | undefined;
    let anyFrameRolled = false;
    for (let i = 0; i < frames; i++) {
      walked = advanceTime(b, 250);
      if (walked.dayChanged) anyFrameRolled = true;
    }
    expect(jumped.dayChanged).toBe(anyFrameRolled);
    expect(a.day).toBe(b.day);
    expect(Math.round(a.gameMinuteOfDay)).toBe(Math.round(b.gameMinuteOfDay));
    // Tolerance, not rounded equality: the two paths accumulate float dust in
    // different orders, and a start value that lands the total on a .5 boundary
    // would otherwise flip this red over a rounding direction, not a bug.
    expect(Math.abs(a.player.thirst - b.player.thirst)).toBeLessThan(0.5);
  });
});

describe('action costs (B3-03)', () => {
  it('charges every costly action a positive amount of game time', () => {
    expect(ACTION_COSTS.searchContainer).toBeGreaterThan(0);
    expect(ACTION_COSTS.pickupGround).toBeGreaterThan(0);
    expect(ACTION_COSTS.craft).toBeGreaterThan(0);
    expect(ACTION_COSTS.trade).toBeGreaterThan(0);
  });

  it('prices a search above a pickup and a craft above a search', () => {
    // A container takes real effort; a loose item is a bend-down.
    expect(ACTION_COSTS.pickupGround).toBeLessThan(ACTION_COSTS.searchContainer);
    // Building something takes longer than rummaging through a box.
    expect(ACTION_COSTS.searchContainer).toBeLessThan(ACTION_COSTS.craft);
  });

  it('matches the balance config, so pacing is tunable without code edits', () => {
    expect(ACTION_COSTS).toEqual(GAME_CONFIG.actionCosts);
  });
});
