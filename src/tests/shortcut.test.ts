import { describe, expect, it } from 'vitest';

import {
  canAfford,
  charge,
  recordShortcut,
  shortcutAvailable,
  shortcutPlan,
  shortcutPrice,
  shortcutSkip,
  timesTaken,
} from '../systems/shortcut';
import { createNewGame } from '../core/gameState';

// Wave C2: the shortcut's economics, pinned against Centum's formula. The two
// properties that matter: the price climbs with use, and a failed charge never
// moves anything.

describe('shortcut availability', () => {
  it('exists from floor 2 up to but not including the top', () => {
    expect(shortcutAvailable(1, 5)).toBe(false); // the dorm is walked
    expect(shortcutAvailable(2, 5)).toBe(true);
    expect(shortcutAvailable(4, 5)).toBe(true);
    expect(shortcutAvailable(5, 5)).toBe(false); // the guardian's floor
  });
});

describe('shortcut pricing', () => {
  it('starts at 2×depth + 90 plus the skip distance', () => {
    // floor 2, skip 2, first use, salt 0
    expect(shortcutPrice(2, 2, 0, 0)).toBe(2 * 2 + 90 + 0 + 20);
  });

  it('inflates with every previous use', () => {
    const first = shortcutPrice(3, 2, 0, 7);
    const second = shortcutPrice(3, 2, 1, 7);
    const third = shortcutPrice(3, 2, 2, 7);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
    // The inflation per use is the seeded 25..35.
    expect(second - first).toBe(25 + (7 % 11));
    expect(third - second).toBe(25 + (7 % 11));
  });

  it('is deterministic for the same salt', () => {
    expect(shortcutPrice(4, 3, 2, 42)).toBe(shortcutPrice(4, 3, 2, 42));
  });

  it('skips two to four floors, deterministically', () => {
    for (let salt = 0; salt < 30; salt++) {
      const skip = shortcutSkip(salt);
      expect(skip).toBeGreaterThanOrEqual(2);
      expect(skip).toBeLessThanOrEqual(4);
      expect(skip).toBe(shortcutSkip(salt));
    }
  });

  it('gets more expensive with depth', () => {
    expect(shortcutPrice(4, 2, 0, 0)).toBeGreaterThan(shortcutPrice(2, 2, 0, 0));
  });
});

describe('charging', () => {
  it('refuses without the gold and changes nothing', () => {
    const s = createNewGame(1);
    s.player.gold = 10;
    expect(canAfford(s, 94)).toBe(false);
    expect(charge(s, 94)).toBe(false);
    expect(s.player.gold).toBe(10);
  });

  it('spends exactly the price', () => {
    const s = createNewGame(1);
    s.player.gold = 100;
    expect(charge(s, 94)).toBe(true);
    expect(s.player.gold).toBe(6);
  });

  it('counts the uses so the next one costs more', () => {
    const s = createNewGame(1);
    expect(timesTaken(s)).toBe(0);
    recordShortcut(s);
    recordShortcut(s);
    expect(timesTaken(s)).toBe(2);
    expect(shortcutPrice(3, 2, timesTaken(s), 7)).toBeGreaterThan(shortcutPrice(3, 2, 0, 7));
  });
});

// M1-3: ONE plan, ONE price. The prompt at the stairwell, the charge and the
// jump all read shortcutPlan, so the number on screen can never drift from
// the number taken. The regression this pins: the prompt used to price the
// raw seeded roll while the jump walked only as far as the segment allows,
// so at floor 9 a roll of 4 was advertised (and charged) as a 4-floor skip
// and then skipped 1 — the player paid 30 gold for three floors of nothing.
describe('shortcutPlan is the single source of price', () => {
  it('mid-segment the plan is the raw roll, unchanged', () => {
    const s = createNewGame(1);
    // Floors 2..6 have at least four floors of room inside segment 1 (top is
    // 10), so the seeded roll is never clamped and the plan is the raw roll.
    for (let floor = 2; floor <= 6; floor++) {
      for (let salt = 0; salt < 30; salt++) {
        const plan = shortcutPlan(s, floor, salt);
        expect(plan.skip).toBe(shortcutSkip(salt));
        expect(plan.target).toBe(floor + plan.skip);
        expect(plan.price).toBe(shortcutPrice(floor, plan.skip, timesTaken(s), salt));
      }
    }
  });

  it('clamps the skip to the segment, so the price buys real floors', () => {
    const s = createNewGame(1);
    // Floor 9 has exactly one floor of room inside segment 1 (top is 10).
    for (let salt = 0; salt < 30; salt++) {
      const plan = shortcutPlan(s, 9, salt);
      expect(plan.skip).toBe(1);
      expect(plan.target).toBe(10);
      expect(plan.price).toBe(shortcutPrice(9, 1, timesTaken(s), salt));
      // The old prompt priced the unclamped roll whenever it beat the room.
      if (shortcutSkip(salt) > 1) {
        expect(plan.price).toBeLessThan(shortcutPrice(9, shortcutSkip(salt), timesTaken(s), salt));
      }
    }
  });

  it('clamps at every segment top-1, not just the first tier', () => {
    const s = createNewGame(1);
    for (const floor of [9, 109, 1009, 10009, 50009]) {
      const plan = shortcutPlan(s, floor, 2); // salt 2 rolls a skip of 4
      expect(plan.skip).toBe(1);
      expect(plan.target).toBe(floor + 1);
    }
  });

  it('charges exactly the planned price and lands on the planned floor', () => {
    const s = createNewGame(1);
    s.currentFloor = 4;
    s.player.gold = 500;
    const plan = shortcutPlan(s, s.currentFloor, 11);
    expect(charge(s, plan.price)).toBe(true);
    expect(s.player.gold).toBe(500 - plan.price);
    // The scene's jump loop is bounded by the plan's target, never the raw
    // roll: the same plan that priced the jump decides where it ends.
    expect(plan.target).toBeGreaterThan(s.currentFloor);
    expect(plan.target - s.currentFloor).toBe(plan.skip);
  });

  it('the inflation counts previous uses inside the plan', () => {
    const s = createNewGame(1);
    s.currentFloor = 4;
    const first = shortcutPlan(s, 4, 5).price;
    recordShortcut(s);
    const second = shortcutPlan(s, 4, 5).price;
    expect(second).toBeGreaterThan(first);
    expect(second - first).toBe(25 + (5 % 11));
  });
});
