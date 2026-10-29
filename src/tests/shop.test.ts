import { describe, expect, it } from 'vitest';

import { buy, sell, sellPrice, shopStock, traderX } from '../systems/shop';
import { createNewGame } from '../core/gameState';
import { addItem } from '../systems/InventorySystem';

// Wave C1: the trader's rules. Atomicity is the property that matters — a
// failed trade must leave the bag and the purse exactly as they were, the same
// rule the NPC trader already follows.

describe('shop stock', () => {
  it('stocks every floor from 2 up and falls back below that', () => {
    for (const f of [2, 3, 4, 5]) {
      expect(shopStock(f).length).toBeGreaterThan(0);
    }
    expect(shopStock(1)).toEqual(shopStock(2));
  });

  it('improves the stock with depth', () => {
    // The crowbar only appears from floor 4 up — the ladder mirrors the loot.
    expect(shopStock(2).some((e) => e.itemId === 'crowbar')).toBe(false);
    expect(shopStock(4).some((e) => e.itemId === 'crowbar')).toBe(true);
  });

  it('places the trader deterministically per seed and floor', () => {
    expect(traderX(42, 3)).toBe(traderX(42, 3));
    expect(traderX(42, 3)).not.toBe(traderX(42, 4));
  });
});

describe('trading', () => {
  function rich(floor: number, gold = 100) {
    const s = createNewGame(42);
    s.currentFloor = floor;
    s.player.gold = gold;
    return s;
  }

  it('buys with gold and moves the item', () => {
    const s = rich(2, 100);
    const before = s.player.gold;
    const r = buy(s, 'bread', 2);
    expect(r.ok).toBe(true);
    expect(s.player.gold).toBe(before - 12);
    expect(s.player.inventory.slots.some((x) => x.itemId === 'bread')).toBe(true);
  });

  it('refuses a buy without gold and changes nothing', () => {
    const s = rich(2, 5);
    const slots = s.player.inventory.slots.length;
    const r = buy(s, 'bread', 2);
    expect(r.ok).toBe(false);
    expect(s.player.gold).toBe(5);
    expect(s.player.inventory.slots.length).toBe(slots);
  });

  it('refuses a buy the bag cannot hold and changes nothing', () => {
    const s = rich(2, 100);
    // Fill the bag: the 3 starting stacks plus 9 more distinct ones = 12 slots.
    for (const id of ['battery', 'scrap_metal', 'wood', 'cloth', 'tape', 'filter', 'wire', 'fuse', 'dirty_water'] as const) {
      addItem(s.player.inventory, id, 1);
    }
    expect(s.player.inventory.slots.length).toBe(12);
    const gold = s.player.gold;
    const r = buy(s, 'bread', 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('背包已满');
    expect(s.player.gold).toBe(gold);
  });

  it('refuses an item the trader does not stock', () => {
    const s = rich(2, 100);
    expect(buy(s, 'crowbar', 2).ok).toBe(false);
    expect(s.player.gold).toBe(100);
  });

  it('sells for half the shelf price, at least 1', () => {
    const s = rich(2);
    addItem(s.player.inventory, 'bread', 1);
    const r = sell(s, 'bread', 2);
    expect(r.ok).toBe(true);
    expect(s.player.gold).toBe(106); // 100 start + floor(12/2)
    expect(s.player.inventory.slots.some((x) => x.itemId === 'bread')).toBe(false);
  });

  it('pays at least one gold for an unstocked item', () => {
    expect(sellPrice('flashlight', 2)).toBe(1);
  });

  it('refuses a sell without the item and changes nothing', () => {
    const s = rich(2, 10);
    const r = sell(s, 'medkit', 2);
    expect(r.ok).toBe(false);
    expect(s.player.gold).toBe(10);
  });

  it('round-trips at a loss, the way trading works', () => {
    const s = rich(3, 100);
    buy(s, 'medkit', 3);
    expect(s.player.gold).toBe(60);
    sell(s, 'medkit', 3);
    expect(s.player.gold).toBe(80); // paid 40, got 20 back
  });
});
