import { describe, expect, it } from 'vitest';
import {
  containerItemKey,
  containerLootSeed,
  DEV_FLOOR_ALIAS,
  FLOOR_TEMPLATES,
  generateFloor,
  getFloorTemplate,
  groundItemKey,
  LOOT_DATA_VERSION,
} from '../data/floorTemplates';
import { deriveSeed } from '../core/rng';
import { DEV_TEST_FLOORS, PLAYABLE_FLOORS_V01 } from '../core/constants';

// The retired v0.1 dorm scene stays bootable behind ?devfloor= without
// duplicating its layout: it resolves to the floor-1 template under its old
// address. Floor 100000 is still a valid logical floor and the future summit —
// it just has no authored content until B4 generates it.
describe('the dev-only floor alias', () => {
  it('resolves the dev test floor to an authored template', () => {
    for (const floor of DEV_TEST_FLOORS) {
      expect(getFloorTemplate(floor), `dev floor ${floor} must render`).toBeDefined();
      expect(DEV_FLOOR_ALIAS[floor]).toBeDefined();
    }
  });

  it('does not alias any playable floor', () => {
    for (const floor of PLAYABLE_FLOORS_V01) {
      expect(DEV_FLOOR_ALIAS[floor]).toBeUndefined();
    }
  });

  it('authors exactly one template per playable floor, and nothing else', () => {
    // Count is not pinned: the assertion is that the authored table and the
    // playable list name the same floors, so a floor can never be playable
    // without content (or authored without being reachable).
    const authored = Object.keys(FLOOR_TEMPLATES).map(Number).sort((a, b) => a - b);
    expect(authored).toEqual([...PLAYABLE_FLOORS_V01].sort((a, b) => a - b));
  });

  it('generates the dev floor under its own number', () => {
    const dev = generateFloor(42, 100000);
    expect(dev.floorNumber).toBe(100000);
    expect(dev.containers.length).toBeGreaterThan(0);
  });
});

describe('floor templates', () => {
  it('defines a template for every playable floor', () => {
    for (const f of PLAYABLE_FLOORS_V01) {
      expect(getFloorTemplate(f), `floor ${f} must have a template`).toBeDefined();
    }
    // The key and the template's own floorNumber must agree, or the template is
    // addressable under one number and generates under another.
    for (const [key, t] of Object.entries(FLOOR_TEMPLATES)) {
      expect(t.floorNumber, `FLOOR_TEMPLATES[${key}]`).toBe(Number(key));
    }
  });

  it('the same seed generates the same world', () => {
    expect(generateFloor(42, 3)).toEqual(generateFloor(42, 3));
  });

  it('different seeds can differ on non-critical loot', () => {
    const base = JSON.stringify(generateFloor(1, 3));
    let differs = false;
    for (let seed = 2; seed <= 60; seed++) {
      if (JSON.stringify(generateFloor(seed, 3)) !== base) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });

  it('guaranteed (critical) loot is present for every QA seed', () => {
    for (const seed of [1, 42, 2026]) {
      const floor = generateFloor(seed, 4);
      const fuseBox = floor.containers.find((c) => c.id === 'fuse_box');
      expect(fuseBox?.items.some((i) => i.itemId === 'fuse' && i.quantity >= 1)).toBe(true);
    }
  });

  it('an unknown floor throws', () => {
    expect(() => generateFloor(1, 12345)).toThrow();
  });
});

// The slum's playable segment is floors 1..10 (docs/18_TIER_PROGRESSION.md,
// tier 1). Ten floors is long enough that a floor with no authored content — or
// with no guaranteed drink — would only be noticed by dying on it, so it is
// pinned here rather than left to playtesting.
describe('every playable floor is generated, survivable and reproducible', () => {
  const QA_SEEDS = [1, 42, 2026];

  // Floors 6..10 are the expansion. They must each provision the player: they
  // are the only stretch with no home, NPC or upgrade floor to fall back on, and
  // a floor without a guaranteed bottle makes the climb a seed lottery.
  //
  // Floors 1..5 predate the rule and stay as authored — 1 is home (it holds the
  // guaranteed bottle), 2 is the trading hub, 3 is the material store, 4 the
  // water stop and 5 the canteen — so the per-floor invariant is asserted where
  // it is actually required rather than retro-fitted onto the old balance.
  const SELF_PROVISIONED_FLOORS = PLAYABLE_FLOORS_V01.filter((f) => f >= 6);

  it('generates every playable floor without throwing', () => {
    for (const floor of PLAYABLE_FLOORS_V01) {
      expect(() => generateFloor(42, floor), `floor ${floor}`).not.toThrow();
      expect(generateFloor(42, floor).floorNumber, `floor ${floor}`).toBe(floor);
    }
  });

  it('every self-provisioned floor yields a drink', () => {
    expect(SELF_PROVISIONED_FLOORS.length, 'the climb above the canteen must exist').toBeGreaterThan(0);
    for (const seed of QA_SEEDS) {
      for (const floor of SELF_PROVISIONED_FLOORS) {
        const items = generateFloor(seed, floor).containers.flatMap((c) => c.items);
        const water = items.filter((i) => i.itemId === 'clean_water' || i.itemId === 'dirty_water');
        expect(water.length, `seed ${seed} floor ${floor} hands out no water`).toBeGreaterThan(0);
        expect(water.reduce((n, i) => n + i.quantity, 0), `seed ${seed} floor ${floor}`).toBeGreaterThan(0);
      }
    }
  });

  it('every self-provisioned floor yields a meal', () => {
    expect(SELF_PROVISIONED_FLOORS.length, 'the climb above the canteen must exist').toBeGreaterThan(0);
    for (const seed of QA_SEEDS) {
      for (const floor of SELF_PROVISIONED_FLOORS) {
        const items = generateFloor(seed, floor).containers.flatMap((c) => c.items);
        const food = items.filter((i) => i.itemId === 'ration_pack' || i.itemId === 'bread');
        expect(food.length, `seed ${seed} floor ${floor} hands out no food`).toBeGreaterThan(0);
      }
    }
  });

  it('the same seed and floor reproduce the same floor', () => {
    for (const floor of PLAYABLE_FLOORS_V01) {
      expect(generateFloor(42, floor), `floor ${floor}`).toEqual(generateFloor(42, floor));
    }
  });
});

// GHI-03 M1: keys must identify the item, not its slot in the template array.
// Index-based keys meant inserting one ground supply made a saved run's
// "already looted" marker point at the new item, so the old one respawned and
// the new one could never be picked up.
describe('loot keys identify the item, not its position (GHI-03 M1)', () => {
  it('ground keys come from the item and where it lies', () => {
    expect(groundItemKey('bread', 160)).toBe('g:bread:160');
    expect(groundItemKey('bread', 160)).not.toBe(groundItemKey('bread', 200));
    expect(groundItemKey('bread', 160)).not.toBe(groundItemKey('medkit', 160));
  });

  it('container keys come from the container and the item', () => {
    expect(containerItemKey('crate_wood', 'wood')).toBe('c:crate_wood:wood');
    expect(containerItemKey('crate_wood', 'wood')).not.toBe(containerItemKey('crate_metal', 'wood'));
    expect(containerItemKey('crate_wood', 'wood')).not.toBe(containerItemKey('crate_wood', 'tape'));
  });

  it('a ground item keeps its key when another is inserted before it', () => {
    expect(generateFloor(42, 5).groundItems.map((g) => g.key)).toEqual(['g:bread:160']);

    const original = FLOOR_TEMPLATES[5].ground;
    FLOOR_TEMPLATES[5].ground = [{ itemId: 'medkit', quantity: 1, x: 200 }, ...original];
    try {
      expect(generateFloor(42, 5).groundItems.map((g) => g.key)).toEqual(['g:medkit:200', 'g:bread:160']);
    } finally {
      FLOOR_TEMPLATES[5].ground = original;
    }
  });

  // The itemId-based container key assumes one entry per item per container.
  it('no floor lists the same ground supply twice', () => {
    for (const t of Object.values(FLOOR_TEMPLATES)) {
      const keys = t.ground.map((g) => groundItemKey(g.itemId, g.x));
      expect(new Set(keys).size, `floor ${t.floorNumber}`).toBe(keys.length);
    }
  });

  it('no container lists the same item twice', () => {
    for (const t of Object.values(FLOOR_TEMPLATES)) {
      for (const c of t.containers) {
        const ids = c.loot.map((l) => l.itemId);
        expect(new Set(ids).size, `floor ${t.floorNumber}/${c.id}`).toBe(ids.length);
      }
    }
  });
});

// GHI-03 m2: a guaranteed entry silently ignored its `max`, so
// {min:1, max:3, guaranteed:true} handed out 1 with no warning. Rolling the
// range would consume RNG and reshuffle every later roll in the container, so
// the range is rejected instead.
describe('guaranteed loot entries (GHI-03 m2)', () => {
  it('every shipped guaranteed entry is a single value', () => {
    for (const t of Object.values(FLOOR_TEMPLATES)) {
      for (const c of t.containers) {
        for (const l of c.loot) {
          if (l.guaranteed) expect(l.min, `floor ${t.floorNumber}/${c.id}/${l.itemId}`).toBe(l.max);
        }
      }
    }
  });

  it('rejects a guaranteed entry whose range is not a single value', () => {
    const original = FLOOR_TEMPLATES[1].containers;
    FLOOR_TEMPLATES[1].containers = original.map((c) => ({
      ...c,
      loot: c.loot.map((l) => (l.guaranteed ? { ...l, min: 1, max: 3 } : l)),
    }));
    try {
      expect(() => generateFloor(42, 1)).toThrow(/min === max/);
    } finally {
      FLOOR_TEMPLATES[1].containers = original;
    }
  });
});

// GHI-03 M2: the world identity is (LOOT_DATA_VERSION, runSeed), not runSeed
// alone — otherwise tuning a table silently reshuffles an existing world.
describe('the loot data version folds into every derived seed (GHI-03 M2)', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(LOOT_DATA_VERSION)).toBe(true);
    expect(LOOT_DATA_VERSION).toBeGreaterThan(0);
  });

  it('participates in the container seed derivation', () => {
    const seeded = containerLootSeed(42, 3, 'crate_metal');
    expect(seeded).toBe(deriveSeed(LOOT_DATA_VERSION, 42, 3, 'crate_metal'));
    expect(seeded).not.toBe(deriveSeed(42, 3, 'crate_metal'));
  });

  it('is stable for the same inputs', () => {
    expect(containerLootSeed(42, 3, 'crate_metal')).toBe(containerLootSeed(42, 3, 'crate_metal'));
    expect(containerLootSeed(42, 3, 'crate_metal')).not.toBe(containerLootSeed(42, 3, 'crate_wood'));
  });
});
