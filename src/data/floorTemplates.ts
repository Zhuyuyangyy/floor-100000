import { deriveSeed, makeRng } from '../core/rng';
import type { GeneratedContainer, GeneratedFloor, GroundItem, InventoryStack, ItemId } from '../core/gameTypes';

// Fixed v0.1 floor layouts (docs/01_GDD.md §7). Loot is data-driven: guaranteed
// entries (critical progression items) always appear; the rest roll by seed, so
// the same worldSeed reproduces the same world while different seeds can differ.
interface LootSpec {
  itemId: ItemId;
  min: number;
  max: number;
  probability: number;
  guaranteed?: boolean;
}

interface ContainerSpec {
  id: string;
  label: string;
  x: number;
  loot: LootSpec[];
}

interface GroundSpec {
  itemId: ItemId;
  quantity: number;
  x: number;
}

export interface FloorTemplate {
  floorNumber: number;
  name: string;
  description: string;
  containers: ContainerSpec[];
  ground: GroundSpec[];
}

// A world is identified by (LOOT_DATA_VERSION, runSeed), not runSeed alone:
// bump this whenever the loot tables change so a tuned table produces a
// deliberately different world instead of silently reshuffling an existing one
// (GHI-03 M2). Old saves keep their runSeed and simply roll fresh contents.
export const LOOT_DATA_VERSION = 1;

// Stable identity for one loot entry. Keys must name the item, never its slot
// in the template array: index-based keys made a saved run's "already looted"
// marker slide onto a different item as soon as the table was edited, respawning
// the old one and stranding the new one (GHI-03 M1).
export const groundItemKey = (itemId: string, x: number): string => `g:${itemId}:${x}`;
export const containerItemKey = (containerId: string, itemId: string): string => `c:${containerId}:${itemId}`;

// The seed behind one container's loot rolls, version-folded per M2.
export function containerLootSeed(worldSeed: number, floorNumber: number, containerId: string): number {
  return deriveSeed(LOOT_DATA_VERSION, worldSeed, floorNumber, containerId);
}

export const FLOOR_TEMPLATES: Record<number, FloorTemplate> = {
  1: {
    floorNumber: 1,
    name: '玩家宿舍',
    description: '初始床铺、储物、制作、睡眠的安全屋',
    containers: [
      {
        id: 'cabinet',
        label: '储物柜',
        x: 160,
        loot: [
          { itemId: 'clean_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'cloth', min: 1, max: 2, probability: 0.6 },
        ],
      },
    ],
    ground: [],
  },
  2: {
    floorNumber: 2,
    name: '邻居宿舍',
    description: '2 名可交易 NPC',
    containers: [
      {
        id: 'shelf',
        label: '邻居货架',
        x: 1120,
        loot: [{ itemId: 'bread', min: 1, max: 2, probability: 0.5 }],
      },
    ],
    ground: [],
  },
  3: {
    floorNumber: 3,
    name: '废弃储物层',
    description: '搜集木材、金属、胶带、电池',
    containers: [
      {
        id: 'crate_wood',
        label: '木箱',
        x: 480,
        loot: [
          // Guaranteed: 加固门 needs wood x2 and tape x1, and this crate is the
          // only source of either. When both were probability rolls the upgrade
          // was unbuildable on roughly 73% of seeds, which breaks the frozen
          // design's "no soft-lock" rule (GAME_DESIGN_LOCK.md §5).
          { itemId: 'wood', min: 2, max: 2, probability: 1, guaranteed: true },
          { itemId: 'tape', min: 1, max: 1, probability: 1, guaranteed: true },
        ],
      },
      {
        id: 'crate_metal',
        label: '铁箱',
        x: 800,
        loot: [
          // Exactly lamp(1) + purifier(2), with no slack. Scarcity is meant to
          // be a real constraint here, but it must not be a false choice: the
          // purifier decides whether the player has water at all, so capping
          // scrap below the two costs made them mutually exclusive rather than
          // competing. Spending scrap on 阿林's wire offer still costs an
          // upgrade — see survivalBalance.test.ts.
          { itemId: 'scrap_metal', min: 3, max: 3, probability: 1, guaranteed: true },
          { itemId: 'battery', min: 1, max: 2, probability: 0.6 },
          // A pry bar in the metal store. No recipe needs it, so guaranteeing it
          // costs no balance — it exists so the item is tradeable rather than
          // being a defined-but-unobtainable entry in the item table.
          { itemId: 'crowbar', min: 1, max: 1, probability: 1, guaranteed: true },
        ],
      },
    ],
    ground: [
      { itemId: 'battery', quantity: 1, x: 160 },
      { itemId: 'cloth', quantity: 1, x: 1120 },
    ],
  },
  4: {
    floorNumber: 4,
    name: '维修层',
    description: '漆黑区域，稳定可找到的保险丝、滤芯与储水',
    containers: [
      {
        id: 'fuse_box',
        label: '电箱',
        x: 640,
        loot: [
          { itemId: 'fuse', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'filter', min: 1, max: 1, probability: 1, guaranteed: true },
          // Two, so lamp and purifier can both be wired without spending the
          // world's entire scrap supply on 阿林's conversion.
          { itemId: 'wire', min: 2, max: 2, probability: 1, guaranteed: true },
        ],
      },
      {
        id: 'water_tank',
        label: '储水罐',
        x: 240,
        loot: [
          // Six, up from four: sleeping now charges the night's metabolism, so
          // the water budget has to cover 24 hours a day rather than only the
          // waking ones. See REST_METABOLISM in SurvivalSystem.
          { itemId: 'dirty_water', min: 6, max: 6, probability: 1, guaranteed: true },
        ],
      },
    ],
    ground: [],
  },
  5: {
    floorNumber: 5,
    name: '废弃食堂',
    description: '食物补给，首版探索终点',
    containers: [
      {
        id: 'counter',
        label: '餐台',
        x: 480,
        loot: [
          { itemId: 'ration_pack', min: 3, max: 3, probability: 1, guaranteed: true },
          { itemId: 'dirty_water', min: 2, max: 2, probability: 1, guaranteed: true },
        ],
      },
      {
        id: 'pantry',
        label: '补给架',
        x: 1120,
        loot: [
          { itemId: 'bread', min: 4, max: 4, probability: 1, guaranteed: true },
          // A canteen first-aid box. Probabilistic on purpose: the medkit is a
          // bonus, not a progression gate, so it is allowed to be a lucky find.
          { itemId: 'medkit', min: 1, max: 1, probability: 0.5 },
        ],
      },
    ],
    ground: [{ itemId: 'bread', quantity: 1, x: 160 }],
  },
};

function resolveLoot(
  specs: LootSpec[],
  worldSeed: number,
  floorNumber: number,
  containerId: string,
): InventoryStack[] {
  const rng = makeRng(containerLootSeed(worldSeed, floorNumber, containerId));
  const out: InventoryStack[] = [];
  for (const spec of specs) {
    if (spec.guaranteed) {
      // A guaranteed entry pins its quantity. Rolling the range would consume RNG
      // and reshuffle every later roll in this container, so a range is rejected
      // rather than silently ignored (GHI-03 m2).
      if (spec.min !== spec.max) {
        throw new Error(`guaranteed loot ${spec.itemId} must have min === max (got ${spec.min}..${spec.max})`);
      }
      out.push({ itemId: spec.itemId, quantity: spec.min });
      continue;
    }
    if (rng.chance(spec.probability)) {
      out.push({ itemId: spec.itemId, quantity: rng.nextInt(spec.min, spec.max) });
    }
  }
  return out;
}

// Dev-only: the retired v0.1 dorm scene, reachable through ?devfloor= so the
// legacy fixtures can still boot it. Its layout now lives at floor 1 (the real
// starting floor), so the alias reuses that table instead of duplicating it.
// Floor 100000 stays a valid logical floor and the future summit — it simply
// has no authored content until B4 generates it.
export const DEV_FLOOR_ALIAS: Record<number, number> = { 100000: 1 };

function templateFor(floorNumber: number): FloorTemplate | undefined {
  return FLOOR_TEMPLATES[DEV_FLOOR_ALIAS[floorNumber] ?? floorNumber];
}

export function getFloorTemplate(floorNumber: number): FloorTemplate | undefined {
  return templateFor(floorNumber);
}

export function generateFloor(worldSeed: number, floorNumber: number): GeneratedFloor {
  const template = templateFor(floorNumber);
  if (!template) {
    throw new Error(`no floor template for floor ${floorNumber}`);
  }
  const containers: GeneratedContainer[] = template.containers.map((c) => ({
    id: c.id,
    label: c.label,
    x: c.x,
    items: resolveLoot(c.loot, worldSeed, floorNumber, c.id),
  }));
  const groundItems: GroundItem[] = template.ground.map((g) => ({
    key: groundItemKey(g.itemId, g.x),
    itemId: g.itemId,
    quantity: g.quantity,
    x: g.x,
  }));
  return { floorNumber, name: template.name, containers, groundItems };
}
