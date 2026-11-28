import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { FLOOR_TEMPLATES, generateFloor, groundItemKey } from '../data/floorTemplates';
import { describeFloorContents, dismantleBunk, getFloorView, isBunkDismantled, isBunkSearched, lootContainer, lootGround, recordFloorVisit, searchBunk } from '../systems/LootSystem';
import { countItem } from '../systems/InventorySystem';
import { deserialize, serialize } from '../systems/SaveSystem';

function seedWithoutContainerItem(floor: number, containerId: string, itemId: string): number {
  const seed = Array.from({ length: 1024 }, (_, index) => index).find((candidate) => {
    const container = generateFloor(candidate, floor).containers.find((entry) => entry.id === containerId);
    return !container?.items.some((item) => item.itemId === itemId);
  });
  if (seed === undefined) throw new Error(`could not find a seed without ${containerId}:${itemId}`);
  return seed;
}

// The tower map names what a floor holds so a trip can be planned ("go and get the
// filter" rather than "go and look"). It used to read the loot TABLE, which lists
// probability rolls whether or not they paid out for this seed — so floor 1's
// cabinet advertised 布料 on every seed, including the ones where the 60% roll
// failed and the cloth was never there. It also kept listing a container's full
// contents after the player emptied it.
describe('describeFloorContents', () => {
  it('names only the loot that actually rolled for this seed', () => {
    const seed = seedWithoutContainerItem(1, 'cabinet', 'cloth');
    const s = createNewGame(seed);
    const text = describeFloorContents(s, 1);
    expect(text).toContain('储物柜');
    expect(text).toContain('净水');
    expect(text, 'the map must not promise cloth when this seed did not roll it').not.toContain('布料');
  });

  it('lists every guaranteed entry, so planning still works', () => {
    const s = createNewGame(42);
    const text = describeFloorContents(s, 3);
    expect(text).toContain('废金属');
    expect(text).toContain('木材');
    expect(text).toContain('胶带');
    expect(text).toContain('撬棍');
  });

  it('drops a stack the player has already taken', () => {
    const s = createNewGame(42);
    lootContainer(s, 1, 'cabinet');
    const text = describeFloorContents(s, 1);
    expect(text).toContain('储物柜(已取)');
    expect(text, 'the water was taken, so the map must stop offering it').not.toContain('净水');
  });

  it('names ground supplies, and stops once they are picked up', () => {
    const seed = seedWithoutContainerItem(3, 'crate_metal', 'battery');
    const s = createNewGame(seed);
    expect(describeFloorContents(s, 3)).toContain('地面');
    lootGround(s, 3, groundItemKey('battery', 160));
    expect(describeFloorContents(s, 3)).not.toContain('电池');
  });

  it('says so for a floor with no authored content', () => {
    const s = createNewGame(42);
    expect(describeFloorContents(s, 6)).toContain('未生成');
  });
});

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

describe('lootGround', () => {  it('picks up a ground item exactly once', () => {
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

// B3-02 §4.3: "explored" used to mean "looted something here", because
// ensureVisit only ran on the loot paths. The tower's colouring reads
// visitedFloors, so a floor the player simply walked through was drawn as
// never-visited — which contradicts GAME_DESIGN_LOCK.md §2.6 ("floor identity
// and explored state must persist"). Entering a floor is now what records it.
describe('recordFloorVisit', () => {
  it('records a floor the player only walked into', () => {
    const s = createNewGame(42);
    expect(s.visitedFloors[2]).toBeUndefined();
    recordFloorVisit(s, 2);
    expect(s.visitedFloors[2]).toBeDefined();
    expect(s.visitedFloors[2].openedContainers).toEqual([]);
    expect(s.visitedFloors[2].lootedItems).toEqual([]);
  });

  it('is idempotent and never discards an existing loot record', () => {
    const s = createNewGame(42);
    lootContainer(s, 4, 'fuse_box');
    const before = s.visitedFloors[4];
    recordFloorVisit(s, 4);
    recordFloorVisit(s, 4);
    expect(s.visitedFloors[4]).toBe(before); // same object, not a fresh empty one
    expect(s.visitedFloors[4].openedContainers).toEqual(['fuse_box']);
    expect(s.visitedFloors[4].lootedItems.length).toBeGreaterThan(0);
  });

  it('keeps a walk-through floor distinct from a looted one', () => {
    const s = createNewGame(42);
    recordFloorVisit(s, 2); // passed through
    lootContainer(s, 4, 'fuse_box'); // took something
    expect(s.visitedFloors[2].lootedItems).toEqual([]);
    expect(s.visitedFloors[4].lootedItems.length).toBeGreaterThan(0);
  });

  it('survives a save round-trip, so explored floors stay explored', () => {
    const s = createNewGame(42);
    recordFloorVisit(s, 2);
    const reloaded = deserialize(serialize(s));
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.state.visitedFloors[2]).toBeDefined();
    expect(reloaded.state.visitedFloors[2].openedContainers).toEqual([]);
  });

  it('does not re-spawn loot on a floor that was only walked through', () => {
    const s = createNewGame(42);
    const before = getFloorView(s, 4).containers.find((c) => c.id === 'fuse_box')?.items.length ?? 0;
    recordFloorVisit(s, 4);
    expect(getFloorView(s, 4).containers.find((c) => c.id === 'fuse_box')?.items.length ?? 0).toBe(before);
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

// ── the dorm bunks ─────────────────────────────────────────────────────────
// Floor 1 is packed with roommates' beds. These are the rules that make the
// rows a progression rather than a wall of identical prompts: a bed can be
// searched once a day, and once searched it can be broken up for timber — but
// only with a tool, and only if the bag can take the whole yield.
describe('bunk search', () => {
  const bunk = (floor: number, x: number): string => `dorm_bed_${floor}_${x}`;

  it('rolls the same loot for the same run, floor, bed and day', () => {
    const a = createNewGame(777);
    const b = createNewGame(777);
    const first = searchBunk(a, 1, bunk(1, 236));
    const second = searchBunk(b, 1, bunk(1, 236));
    expect(second.took).toEqual(first.took);
  });

  it('gives different beds different loot, so 13 beds are not 13 copies', () => {
    const s = createNewGame(777);
    const rolls = [236, 332, 428, 588, 684, 780, 876, 972].map((x) => searchBunk(s, 1, bunk(1, x)).took.map((t) => t.itemId).join(','));
    expect(new Set(rolls).size).toBeGreaterThan(1);
  });

  it('refuses the same bed twice in one day and charges nothing the second time', () => {
    const s = createNewGame(42);
    const id = bunk(1, 332);
    expect(searchBunk(s, 1, id).already).toBe(false);
    const before = countItem(s.player.inventory, 'cloth');
    const again = searchBunk(s, 1, id);
    expect(again.already).toBe(true);
    expect(again.took).toHaveLength(0);
    expect(countItem(s.player.inventory, 'cloth')).toBe(before);
  });

  it('is a fresh bed tomorrow: the key carries the day', () => {
    const s = createNewGame(42);
    const id = bunk(1, 428);
    searchBunk(s, 1, id);
    expect(isBunkSearched(s, 1, id)).toBe(true);
    s.day += 1;
    expect(isBunkSearched(s, 1, id)).toBe(false);
    expect(searchBunk(s, 1, id).already).toBe(false);
  });

  it('does not spend the roll when the bag cannot take a single thing', () => {
    const s = createNewGame(42);
    // seed 42 bed 332 rolls cloth + wood; every slot is held by scrap metal, so
    // none of it can merge its way in and none of it fits as a new stack.
    s.player.inventory.slots = Array.from({ length: s.player.inventory.slotCount }, () => ({
      itemId: 'scrap_metal' as const,
      quantity: 99,
    }));
    const id = bunk(1, 332);
    const result = searchBunk(s, 1, id);
    expect(result.full).toBe(true);
    expect(result.took).toHaveLength(0);
    // Nothing was marked, so clearing a slot still leaves a bed worth searching.
    expect(isBunkSearched(s, 1, id)).toBe(false);
  });
});

describe('bunk dismantle', () => {
  const bunk = (floor: number, x: number): string => `dorm_bed_${floor}_${x}`;

  it('needs a crowbar and names what is missing when there is none', () => {
    const s = createNewGame(42);
    s.player.inventory.slots = [];
    const result = dismantleBunk(s, 1, bunk(1, 236));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('撬棍');
    expect(isBunkDismantled(s, 1, bunk(1, 236))).toBe(false);
  });

  it('takes wood and cloth and the bed never comes back', () => {
    const s = createNewGame(42);
    s.player.inventory.slots = [{ itemId: 'crowbar', quantity: 1 }];
    const id = bunk(1, 236);
    const result = dismantleBunk(s, 1, id);
    expect(result.ok).toBe(true);
    expect(result.took.map((t) => t.itemId).sort()).toEqual(['cloth', 'wood']);
    expect(isBunkDismantled(s, 1, id)).toBe(true);
    // Tomorrow does not bring it back — no day in the key, by design.
    s.day += 1;
    expect(isBunkDismantled(s, 1, id)).toBe(true);
    expect(dismantleBunk(s, 1, id).ok).toBe(false);
  });

  it('keeps the crowbar: a tool is equipment, not a consumable', () => {
    const s = createNewGame(42);
    s.player.inventory.slots = [{ itemId: 'crowbar', quantity: 1 }];
    dismantleBunk(s, 1, bunk(1, 332));
    expect(countItem(s.player.inventory, 'crowbar')).toBe(1);
  });

  it('is all-or-nothing: a full bag leaves the bed standing and refunds the roll', () => {
    const s = createNewGame(42);
    // Slot 0 keeps the crowbar, or the refusal would be "no tool" rather than
    // "no room" and the test would pass for the wrong reason.
    s.player.inventory.slots = Array.from({ length: s.player.inventory.slotCount }, (_, i) =>
      i === 0 ? { itemId: 'crowbar' as const, quantity: 1 } : { itemId: 'scrap_metal' as const, quantity: 99 },
    );
    const id = bunk(1, 428);
    const result = dismantleBunk(s, 1, id);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('背包已满');
    expect(result.full).toBe(true);
    expect(result.took).toHaveLength(0);
    expect(isBunkDismantled(s, 1, id)).toBe(false);
    // And the rollback left nothing behind in the bag.
    expect(countItem(s.player.inventory, 'wood')).toBe(0);
    expect(countItem(s.player.inventory, 'cloth')).toBe(0);
  });

  it('survives a save round-trip, so a broken bed stays broken', () => {
    const s = createNewGame(42);
    s.player.inventory.slots = [{ itemId: 'crowbar', quantity: 1 }];
    dismantleBunk(s, 1, bunk(1, 588));
    const reloaded = deserialize(serialize(s));
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(isBunkDismantled(reloaded.state, 1, bunk(1, 588))).toBe(true);
  });
});
