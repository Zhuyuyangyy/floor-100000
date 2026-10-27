import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { FLOOR_TEMPLATES, groundItemKey } from '../data/floorTemplates';
import { getFloorView, lootContainer, lootGround } from '../systems/LootSystem';
import { countItem } from '../systems/InventorySystem';
import { deserialize, serialize } from '../systems/SaveSystem';

describe('getFloorView', () => {
  it('removes looted container items so they cannot be re-looted', () => {
    const s = createNewGame(42);
    const before = getFloorView(s, 4).containers.find((c) => c.id === 'fuse_box')?.items.length ?? 0;
    expect(before).toBeGreaterThan(0);
    lootContainer(s, 4, 'fuse_box');
    const after = getFloorView(s, 4).containers.find((c) => c.id === 'fuse_box')?.items.length ?? 0;
    expect(after).toBe(0);
  });
});

describe('lootContainer', () => {
  it('moves items into the bag and marks the container opened', () => {
    const s = createNewGame(42);
    const fuseBefore = countItem(s.player.inventory, 'fuse');
    lootContainer(s, 4, 'fuse_box');
    expect(countItem(s.player.inventory, 'fuse')).toBe(fuseBefore + 1);
    expect(s.visitedFloors[4].openedContainers).toContain('fuse_box');
  });

  it('leaves items in the container when the bag is full (no loss/swallow)', () => {
    const s = createNewGame(42);
    s.player.inventory.slotCount = 0; // force full
    const r = lootContainer(s, 4, 'fuse_box');
    expect(r.full).toBe(true);
    expect(r.took).toHaveLength(0);
    expect(countItem(s.player.inventory, 'fuse')).toBe(0);
    expect(getFloorView(s, 4).containers.find((c) => c.id === 'fuse_box')?.items.length ?? 0).toBeGreaterThan(0);
  });
});

describe('lootGround', () => {
  it('picks up a ground item exactly once', () => {
    const s = createNewGame(42);
    expect(lootGround(s, 3, groundItemKey('battery', 160)).took?.itemId).toBe('battery');
    expect(countItem(s.player.inventory, 'battery')).toBe(1);
    expect(lootGround(s, 3, groundItemKey('battery', 160)).took).toBeNull();
    expect(countItem(s.player.inventory, 'battery')).toBe(1);
  });

  // GHI-03 M5: getFloorView() hides a floor's ground supplies while a leak is
  // active there, but lootGround() read the raw layout and still handed them
  // over — the HUD said 受潮 while the item went into the bag anyway.
  it('refuses a ground item spoiled by a leak on this floor', () => {
    const s = createNewGame(42);
    s.worldEvents.activeEvent = { type: 'leak', floor: 3, message: '漏水' };
    expect(lootGround(s, 3, groundItemKey('battery', 160)).took).toBeNull();
    expect(countItem(s.player.inventory, 'battery')).toBe(0);
  });

  it('hands the item over once the leak has cleared', () => {
    const s = createNewGame(42);
    s.worldEvents.activeEvent = { type: 'leak', floor: 3, message: '漏水' };
    s.worldEvents.activeEvent = null;
    expect(lootGround(s, 3, groundItemKey('battery', 160)).took).toEqual({ itemId: 'battery', quantity: 1 });
  });

  it('is unaffected by a leak on a different floor', () => {
    const s = createNewGame(42);
    s.worldEvents.activeEvent = { type: 'leak', floor: 4, message: '漏水' };
    expect(lootGround(s, 3, groundItemKey('battery', 160)).took).toEqual({ itemId: 'battery', quantity: 1 });
  });
});

// GHI-03 M1: with identity keys, editing a loot table cannot make a looted item
// respawn or a freshly added one permanently unlootable.
describe('loot keys survive a table edit (GHI-03 M1)', () => {
  it('a looted container item stays looted when a new entry is inserted ahead of it', () => {
    const s = createNewGame(42);
    s.visitedFloors[3] = {
      openedContainers: [],
      lootedItems: ['c:crate_metal:scrap_metal'],
      unlockedDoors: [],
      localEvents: [],
    };
    const crate = (): string[] | undefined =>
      getFloorView(s, 3).containers.find((c) => c.id === 'crate_metal')?.items.map((i) => i.itemId);
    expect(crate()).not.toContain('scrap_metal');

    const original = FLOOR_TEMPLATES[3].containers;
    FLOOR_TEMPLATES[3].containers = original.map((c) =>
      c.id === 'crate_metal'
        ? { ...c, loot: [{ itemId: 'wood', min: 1, max: 1, probability: 1, guaranteed: true }, ...c.loot] }
        : c,
    );
    try {
      expect(crate()).not.toContain('scrap_metal'); // still taken
      expect(crate()).toContain('wood'); // and the new entry is lootable
    } finally {
      FLOOR_TEMPLATES[3].containers = original;
    }
  });

  it('a looted ground item stays looted when another is inserted before it', () => {
    const s = createNewGame(42);
    s.visitedFloors[5] = {
      openedContainers: [],
      lootedItems: [groundItemKey('bread', 160)],
      unlockedDoors: [],
      localEvents: [],
    };
    expect(getFloorView(s, 5).groundItems.map((g) => g.key)).toEqual([]);

    const original = FLOOR_TEMPLATES[5].ground;
    FLOOR_TEMPLATES[5].ground = [{ itemId: 'medkit', quantity: 1, x: 200 }, ...original];
    try {
      expect(getFloorView(s, 5).groundItems.map((g) => g.key)).toEqual([groundItemKey('medkit', 200)]);
    } finally {
      FLOOR_TEMPLATES[5].ground = original;
    }
  });

  it('lootContainer records item-identity keys', () => {
    const s = createNewGame(42);
    lootContainer(s, 3, 'crate_metal');
    const keys = s.visitedFloors[3].lootedItems;
    expect(keys).toContain('c:crate_metal:scrap_metal');
    expect(keys.every((k) => k.startsWith('c:crate_metal:'))).toBe(true);
  });

  it('lootGround records item-identity keys', () => {
    const s = createNewGame(42);
    expect(lootGround(s, 3, groundItemKey('battery', 160)).took?.itemId).toBe('battery');
    expect(s.visitedFloors[3].lootedItems).toEqual([groundItemKey('battery', 160)]);
  });
});

describe('save round-trip prevents re-loot', () => {
  it('serialize -> deserialize keeps looted state and blocks re-loot', () => {
    const s = createNewGame(2026);
    lootContainer(s, 4, 'fuse_box');
    const reloaded = deserialize(serialize(s));
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(getFloorView(reloaded.state, 4).containers.find((c) => c.id === 'fuse_box')?.items.length ?? 0).toBe(0);
    expect(lootContainer(reloaded.state, 4, 'fuse_box').took).toHaveLength(0);
  });
});
