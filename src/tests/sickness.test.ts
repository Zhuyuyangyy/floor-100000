import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import {
  AILMENTS,
  ailmentLabel,
  applyCure,
  ailmentsOf,
  cure,
  hasAilment,
  inflict,
  severityOf,
  tickSickness,
} from '../systems/SicknessSystem';
import { spendTime } from '../systems/SurvivalSystem';
import { tickEnvironment } from '../systems/EnvironmentSystem';
import { useConsumable } from '../systems/InventorySystem';
import { addItem } from '../systems/InventorySystem';
import type { GameState } from '../core/gameTypes';

function on(floor: number, x = 640): GameState {
  const s = createNewGame(1);
  s.currentFloor = floor;
  s.player.x = x;
  s.player.bodyTemp = 100;
  s.player.ailments = [];
  return s;
}

describe('the ailment table', () => {
  it('defines four ailments, each with a cure or an honest null', () => {
    expect(Object.keys(AILMENTS)).toEqual(['cold', 'fever', 'wound', 'food_poisoning']);
    for (const def of Object.values(AILMENTS)) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.progressPerHour).toBeGreaterThan(0);
      expect(def.recoverPerHour).toBeGreaterThan(0);
      // a wound only rest clears it, everything else names its item
      expect(def.curedBy === null || ['medkit', 'clean_water', 'sleep'].includes(def.curedBy)).toBe(true);
    }
  });
});

describe('inflict and cure', () => {
  it('adds an ailment and reports it', () => {
    const s = on(4);
    inflict(s, 'wound', 40, 0);
    expect(hasAilment(s, 'wound')).toBe(true);
    expect(severityOf(s, 'wound')).toBe(40);
  });

  it('worsens an existing ailment rather than stacking a second one', () => {
    const s = on(4);
    inflict(s, 'wound', 30, 0);
    inflict(s, 'wound', 60, 10);
    expect(ailmentsOf(s)).toHaveLength(1);
    expect(severityOf(s, 'wound')).toBe(60);
  });

  it('never lowers severity by re-inflicting', () => {
    const s = on(4);
    inflict(s, 'wound', 80, 0);
    inflict(s, 'wound', 20, 10);
    expect(severityOf(s, 'wound')).toBe(80);
  });

  it('cures one ailment and leaves the others', () => {
    const s = on(4);
    inflict(s, 'wound', 50, 0);
    inflict(s, 'cold', 50, 0);
    cure(s, 'wound');
    expect(hasAilment(s, 'wound')).toBe(false);
    expect(hasAilment(s, 'cold')).toBe(true);
  });

  it('clamps severity to 0..100', () => {
    const s = on(4);
    inflict(s, 'wound', 999, 0);
    expect(severityOf(s, 'wound')).toBe(100);
  });

  it('creates the list on demand so an old save loads', () => {
    const s = createNewGame(1);
    delete s.player.ailments;
    expect(ailmentsOf(s)).toEqual([]);
    expect(hasAilment(s, 'cold')).toBe(false);
  });
});

describe('tickSickness', () => {
  it('does nothing with no ailments', () => {
    const s = on(4);
    const t = tickSickness(s, 60);
    expect(t.worsened).toEqual([]);
    expect(t.recovered).toEqual([]);
    expect(t.critical).toEqual([]);
  });

  it('heals a wound by resting, with no cause to keep it open', () => {
    const s = on(1);
    inflict(s, 'wound', 40, 0);
    tickSickness(s, 60); // 2.5/hour recovered
    expect(severityOf(s, 'wound')).toBeCloseTo(37.5, 5);
  });

  it('reports the crossing into biting and into critical', () => {
    // A wound has no ongoing cause, so it heals — the worsening crossings need an
    // ailment whose cause is still true. Fever on a damp floor while starving is.
    const s = on(3, 640); // humidity 0.6
    s.player.hunger = 0;
    inflict(s, 'fever', 23, 0);
    const t = tickSickness(s, 60); // 23 + 4 = 27, crosses 25
    expect(t.worsened).toContain('fever');
    expect(severityOf(s, 'fever')).toBeGreaterThan(25);
  });

  it('clears a fully healed ailment and reports it', () => {
    const s = on(1);
    inflict(s, 'wound', 2, 0);
    const t = tickSickness(s, 60); // recovers 2.5 -> below 0
    expect(hasAilment(s, 'wound')).toBe(false);
    expect(t.recovered).toContain('wound');
  });

  it('an ailment makes the other bars cost more', () => {
    const healthy = on(1);
    const ill = on(3, 640); // damp, so the poisoning's cause holds and it does not heal off mid-tick
    // starving via thirst, not hunger: hunger is the bar being measured, and a
    // bar already at zero cannot show a loss
    ill.player.thirst = 0;
    inflict(ill, 'food_poisoning', 100, 0);
    const before = ill.player.hunger;
    tickSickness(ill, 60);
    const illLoss = before - ill.player.hunger;
    const healthyBefore = healthy.player.hunger;
    tickSickness(healthy, 60);
    const healthyLoss = healthyBefore - healthy.player.hunger;
    // tickSickness only charges the ailment's own drain, not the base decay
    expect(illLoss).toBeGreaterThan(healthyLoss);
    // 0.5 multiplier at full severity on the base rate of 2/hour
    expect(illLoss).toBeCloseTo(2 * 0.5, 5);
  });

  it('costs HP only at critical severity', () => {
    // below critical: no HP cost of its own
    const s = on(1);
    inflict(s, 'wound', 99, 0);
    const hp = s.player.hp;
    tickSickness(s, 60);
    expect(s.player.hp).toBe(hp);

    // at critical, with the cause holding so it does not heal off in the same tick
    const s2 = on(3, 640);
    s2.player.hunger = 0;
    inflict(s2, 'fever', 100, 0);
    tickSickness(s2, 60);
    expect(s2.player.hp).toBeLessThan(100);
  });

  it('does nothing once the run is over', () => {
    const s = on(4);
    s.status = 'lost';
    inflict(s, 'wound', 50, 0);
    const before = severityOf(s, 'wound');
    tickSickness(s, 60);
    expect(severityOf(s, 'wound')).toBe(before);
  });
});

describe('contracting a cold from the freeze', () => {
  it('long enough at freezing body heat gives you a cold', () => {
    const s = on(4, 640);
    s.player.bodyTemp = 5; // below FREEZING_THRESHOLD
    // 90 game minutes at freezing is the threshold; drive it in chunks so the
    // clock advances the way the frame loop would
    for (let i = 0; i < 6; i++) spendTime(s, 20);
    expect(hasAilment(s, 'cold')).toBe(true);
  });

  it('warming back up before the threshold resets the clock', () => {
    const s = on(4, 640);
    s.player.bodyTemp = 5;
    spendTime(s, 60); // one hour frozen, not yet 90 minutes
    expect(hasAilment(s, 'cold')).toBe(false);
    // warm up, then go back — the clock starts over rather than continuing
    s.player.bodyTemp = 60;
    tickEnvironment(s, 1);
    s.player.bodyTemp = 5;
    spendTime(s, 60);
    expect(hasAilment(s, 'cold')).toBe(false);
  });
});

describe('the medkit closes a wound', () => {
  it('cures the ailment the item is for', () => {
    const s = on(1);
    inflict(s, 'wound', 70, 0);
    s.player.hp = 50;
    addItem(s.player.inventory, 'medkit', 1);
    const r = useConsumable(s, 'medkit');
    expect(r.ok).toBe(true);
    expect(r.cured).toContain('wound');
    expect(hasAilment(s, 'wound')).toBe(false);
    expect(s.player.hp).toBeGreaterThan(50);
  });

  it('a medkit with no wound still heals, it just clears nothing', () => {
    const s = on(1);
    s.player.hp = 50;
    addItem(s.player.inventory, 'medkit', 1);
    const r = useConsumable(s, 'medkit');
    expect(r.ok).toBe(true);
    expect(r.cured).toEqual([]);
    expect(s.player.hp).toBe(90);
  });

  it('applyCure only clears what the item treats', () => {
    const s = on(1);
    inflict(s, 'wound', 50, 0);
    inflict(s, 'cold', 50, 0);
    const cleared = applyCure(s, 'medkit');
    expect(cleared).toEqual(['wound']);
    expect(hasAilment(s, 'cold')).toBe(true);
  });
});

describe('the HUD line', () => {
  it('is empty when healthy and names the worst ailment otherwise', () => {
    const s = on(1);
    expect(ailmentLabel(s)).toBe('');
    inflict(s, 'wound', 30, 0);
    inflict(s, 'cold', 70, 0);
    expect(ailmentLabel(s)).toBe('冻伤');
  });
});
