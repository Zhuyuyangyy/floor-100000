import { describe, expect, it } from 'vitest';

import {
  canAfford,
  charge,
  recordShortcut,
  shortcutAvailable,
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
