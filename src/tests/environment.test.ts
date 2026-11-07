import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { FLOOR_ENVIRONMENT, WARMTH_SOURCES, environmentFor } from '../core/constants';
import {
  BODY_TEMP_MAX,
  COLD_THRESHOLD,
  bodyTempOf,
  environmentLabel,
  tickEnvironment,
  warmthAt,
} from '../systems/EnvironmentSystem';
import { spendTime } from '../systems/SurvivalSystem';
import type { GameState } from '../core/gameTypes';

function on(floor: number, x = 640): GameState {
  const s = createNewGame(1);
  s.currentFloor = floor;
  s.player.x = x;
  s.player.bodyTemp = BODY_TEMP_MAX;
  return s;
}

describe('floor environments', () => {
  it('gives every playable floor an entry, and a fallback for anything else', () => {
    for (const f of Object.keys(FLOOR_ENVIRONMENT)) {
      expect(environmentFor(Number(f)).label.length).toBeGreaterThan(0);
    }
    // an out-of-range floor falls back rather than returning undefined
    expect(environmentFor(99).label).toBe(environmentFor(2).label);
  });

  it('gets colder and damper the higher you go, until the canteen', () => {
    const order = [1, 2, 3, 4].map((f) => environmentFor(f).cold);
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1]);
    }
    // the canteen is warmer than maintenance — it is the floor you want to
    // come back to, and it has the brazier
    expect(environmentFor(5).cold).toBeLessThan(environmentFor(4).cold);
    expect(environmentFor(5).humidity).toBeGreaterThan(environmentFor(1).humidity);
  });

  it('marks the dorm safe and everything above it hostile', () => {
    expect(environmentFor(1).hostile).toBe(false);
    for (const f of [2, 3, 4, 5]) expect(environmentFor(f).hostile).toBe(true);
  });
});

describe('warmth sources', () => {
  it('gives heat inside the radius and none outside it', () => {
    const src = WARMTH_SOURCES[5]![0];
    expect(warmthAt(5, src.x)).toBeCloseTo(src.power, 5);
    expect(warmthAt(5, src.x + src.radius)).toBe(0);
    expect(warmthAt(5, src.x + src.radius + 1)).toBe(0);
    // halfway in, half the power
    expect(warmthAt(5, src.x + src.radius / 2)).toBeCloseTo(src.power / 2, 5);
  });

  it('falls off linearly, so stepping out of the light steps out of the heat', () => {
    const src = WARMTH_SOURCES[5]![0];
    const near = warmthAt(5, src.x + src.radius * 0.25);
    const far = warmthAt(5, src.x + src.radius * 0.75);
    expect(near).toBeGreaterThan(far);
    expect(near / far).toBeCloseTo(3, 5);
  });

  it('gives a floor with no sources nothing', () => {
    expect(WARMTH_SOURCES[4]).toBeUndefined();
    expect(warmthAt(4, 640)).toBe(0);
  });
});

describe('body heat', () => {
  it('is created on demand so a save written before the system loads', () => {
    const s = createNewGame(1);
    delete s.player.bodyTemp;
    expect(bodyTempOf(s)).toBe(BODY_TEMP_MAX);
    expect(s.player.bodyTemp).toBe(BODY_TEMP_MAX);
  });

  it('drains on a cold floor with no heat source', () => {
    const s = on(4, 640);
    tickEnvironment(s, 60); // one game hour
    expect(s.player.bodyTemp!).toBeLessThan(BODY_TEMP_MAX);
    // floor 4 is the coldest: 3.2 * (1 + 0.7 humidity) = 5.44 per hour
    expect(s.player.bodyTemp!).toBeCloseTo(BODY_TEMP_MAX - 5.44, 1);
  });

  it('drains faster on a damp floor than a dry one', () => {
    const dry = on(2, 640); // cold 1.6, humidity 0.2 -> 1.6 * 1.2
    const wet = on(3, 640); // cold 2.4, humidity 0.6 -> 2.4 * 1.6
    tickEnvironment(dry, 60);
    tickEnvironment(wet, 60);
    const dryLoss = BODY_TEMP_MAX - dry.player.bodyTemp!;
    const wetLoss = BODY_TEMP_MAX - wet.player.bodyTemp!;
    // the humidity multiplier is what makes the wet floor bite: without it the
    // ratio would be 2.4/1.6 = 1.5, and with it 3.84/1.92 = exactly 2
    expect(wetLoss / dryLoss).toBeCloseTo(2, 5);
    expect(wetLoss).toBeGreaterThan(dryLoss * 1.5);
  });

  it('recovers inside a warmth source and not outside it', () => {
    const src = WARMTH_SOURCES[5]![0];
    const warm = on(5, src.x);
    const cold = on(5, src.x + src.radius + 40);
    warm.player.bodyTemp = 40;
    cold.player.bodyTemp = 40;
    tickEnvironment(warm, 60);
    tickEnvironment(cold, 60);
    expect(warm.player.bodyTemp!).toBeGreaterThan(40);
    expect(cold.player.bodyTemp!).toBeLessThan(40);
  });

  it('humidity penalises recovery, not only the drain', () => {
    // The brazier is strong enough that floor 5 recovers more in absolute terms
    // than the dorm's candles even with the penalty — so this checks the penalty
    // itself: the recovery is less than the raw power would give.
    const src = WARMTH_SOURCES[5]![0];
    const wet = on(5, src.x);
    wet.player.bodyTemp = 50;
    tickEnvironment(wet, 60);
    const gained = wet.player.bodyTemp! - 50;
    // raw power 14 minus the drain 3.0 would be 11; with the 0.75 damp recovery
    // factor it is 14*0.75 - 3.0 = 7.5
    expect(gained).toBeCloseTo(7.5, 5);
    expect(gained).toBeLessThan(src.power - environmentFor(5).cold * (1 + environmentFor(5).humidity));
  });

  it('costs energy below the cold threshold and HP below freezing', () => {
    const s = on(4, 640);
    s.player.bodyTemp = COLD_THRESHOLD - 5;
    s.player.energy = 100;
    const energyBefore = s.player.energy;
    const hpBefore = s.player.hp;
    tickEnvironment(s, 60);
    expect(s.player.energy!).toBeLessThan(energyBefore);
    // not freezing yet: HP untouched
    expect(s.player.hp).toBe(hpBefore);

    s.player.bodyTemp = 5;
    tickEnvironment(s, 60);
    expect(s.player.hp).toBeLessThan(hpBefore);
  });

  it('clamps to 0 and to the max', () => {
    const s = on(4, 640);
    s.player.bodyTemp = 1;
    tickEnvironment(s, 600);
    expect(s.player.bodyTemp).toBe(0);

    const w = on(5, WARMTH_SOURCES[5]![0].x);
    w.player.bodyTemp = BODY_TEMP_MAX - 1;
    tickEnvironment(w, 600);
    expect(w.player.bodyTemp).toBe(BODY_TEMP_MAX);
  });

  it('reports the transitions the HUD needs', () => {
    const s = on(4, 640);
    s.player.bodyTemp = COLD_THRESHOLD + 2;
    const t = tickEnvironment(s, 60);
    expect(t.becameCold).toBe(true);
    expect(t.warmedUp).toBe(false);
  });

  it('does nothing when the run is over', () => {
    const s = on(4, 640);
    s.status = 'lost';
    const before = s.player.bodyTemp;
    tickEnvironment(s, 60);
    expect(s.player.bodyTemp).toBe(before);
  });
});

describe('body heat rides the shared clock', () => {
  it('spendTime charges it exactly like the frame loop does', () => {
    const s = on(4, 640);
    spendTime(s, 120); // two game hours through an action cost
    expect(s.player.bodyTemp!).toBeLessThan(BODY_TEMP_MAX);
    // 3.2 * 1.7 * 2 hours = 10.88
    expect(s.player.bodyTemp!).toBeCloseTo(BODY_TEMP_MAX - 10.88, 1);
  });

  it('carries the transition on the tick so the scene can react', () => {
    const s = on(4, 640);
    s.player.bodyTemp = COLD_THRESHOLD + 1;
    const tick = spendTime(s, 60);
    expect(tick.environment?.becameCold).toBe(true);
  });
});

describe('the HUD line', () => {
  it('names the floor and what is true about it', () => {
    expect(environmentLabel(1)).toContain('宿舍');
    expect(environmentLabel(1)).toContain('有热源');
    expect(environmentLabel(1)).not.toContain('夜间危险');
    expect(environmentLabel(3)).toContain('潮湿');
    expect(environmentLabel(3)).toContain('夜间危险');
    expect(environmentLabel(3)).not.toContain('有热源');
    expect(environmentLabel(4)).not.toContain('有热源');
  });
});
