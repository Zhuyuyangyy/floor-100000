import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { getFloorView, lootContainer, lootGround } from '../systems/LootSystem';
import { countItem } from '../systems/InventorySystem';
import { deserialize, serialize } from '../systems/SaveSystem';

describe('getFloorView', () => {
  it('removes looted container items so they cannot be re-looted', () => {
    const s = createNewGame(42);
    const before = getFloorView(s, 99997).containers.find((c) => c.id === 'fuse_box')?.items.length ?? 0;
    expect(before).toBeGreaterThan(0);
    lootContainer(s, 99997, 'fuse_box');
    const after = getFloorView(s, 99997).containers.find((c) => c.id === 'fuse_box')?.items.length ?? 0;
    expect(after).toBe(0);
  });
});

describe('lootContainer', () => {
  it('moves items into the bag and marks the container opened', () => {
    const s = createNewGame(42);
    const fuseBefore = countItem(s.player.inventory, 'fuse');
    lootContainer(s, 99997, 'fuse_box');
    expect(countItem(s.player.inventory, 'fuse')).toBe(fuseBefore + 1);
    expect(s.visitedFloors[99997].openedContainers).toContain('fuse_box');
  });

  it('leaves items in the container when the bag is full (no loss/swallow)', () => {
    const s = createNewGame(42);
    s.player.inventory.slotCount = 0; // force full
    const r = lootContainer(s, 99997, 'fuse_box');
    expect(r.full).toBe(true);
    expect(r.took).toHaveLength(0);
    expect(countItem(s.player.inventory, 'fuse')).toBe(0);
    expect(getFloorView(s, 99997).containers.find((c) => c.id === 'fuse_box')?.items.length ?? 0).toBeGreaterThan(0);
  });
});

describe('lootGround', () => {
  it('picks up a ground item exactly once', () => {
    const s = createNewGame(42);
    expect(lootGround(s, 99998, 'g:0').took?.itemId).toBe('battery');
    expect(countItem(s.player.inventory, 'battery')).toBe(1);
    expect(lootGround(s, 99998, 'g:0').took).toBeNull();
    expect(countItem(s.player.inventory, 'battery')).toBe(1);
  });

  // GHI-03 M5: getFloorView() hides a floor's ground supplies while a leak is
  // active there, but lootGround() read the raw layout and still handed them
  // over — the HUD said 受潮 while the item went into the bag anyway.
  it('refuses a ground item spoiled by a leak on this floor', () => {
    const s = createNewGame(42);
    s.worldEvents.activeEvent = { type: 'leak', floor: 99998, message: '漏水' };
    expect(lootGround(s, 99998, 'g:0').took).toBeNull();
    expect(countItem(s.player.inventory, 'battery')).toBe(0);
  });

  it('hands the item over once the leak has cleared', () => {
    const s = createNewGame(42);
    s.worldEvents.activeEvent = { type: 'leak', floor: 99998, message: '漏水' };
    s.worldEvents.activeEvent = null;
    expect(lootGround(s, 99998, 'g:0').took).toEqual({ itemId: 'battery', quantity: 1 });
  });

  it('is unaffected by a leak on a different floor', () => {
    const s = createNewGame(42);
    s.worldEvents.activeEvent = { type: 'leak', floor: 99997, message: '漏水' };
    expect(lootGround(s, 99998, 'g:0').took).toEqual({ itemId: 'battery', quantity: 1 });
  });
});

describe('save round-trip prevents re-loot', () => {
  it('serialize -> deserialize keeps looted state and blocks re-loot', () => {
    const s = createNewGame(2026);
    lootContainer(s, 99997, 'fuse_box');
    const reloaded = deserialize(serialize(s));
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(getFloorView(reloaded.state, 99997).containers.find((c) => c.id === 'fuse_box')?.items.length ?? 0).toBe(0);
    expect(lootContainer(reloaded.state, 99997, 'fuse_box').took).toHaveLength(0);
  });
});
