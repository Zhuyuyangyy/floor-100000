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
  100000: {
    floorNumber: 100000,
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
  99999: {
    floorNumber: 99999,
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
  99998: {
    floorNumber: 99998,
    name: '废弃储物层',
    description: '搜集木材、金属、胶带、电池',
    containers: [
      {
        id: 'crate_wood',
        label: '木箱',
        x: 480,
        loot: [
          { itemId: 'wood', min: 1, max: 3, probability: 0.8 },
          { itemId: 'tape', min: 1, max: 2, probability: 0.5 },
        ],
      },
      {
        id: 'crate_metal',
        label: '铁箱',
        x: 800,
        loot: [
          { itemId: 'scrap_metal', min: 2, max: 2, probability: 1, guaranteed: true },
          { itemId: 'battery', min: 1, max: 2, probability: 0.6 },
        ],
      },
    ],
    ground: [
      { itemId: 'battery', quantity: 1, x: 160 },
      { itemId: 'cloth', quantity: 1, x: 1120 },
    ],
  },
  99997: {
    floorNumber: 99997,
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
          { itemId: 'wire', min: 1, max: 1, probability: 1, guaranteed: true },
        ],
      },
      {
        id: 'water_tank',
        label: '储水罐',
        x: 240,
        loot: [{ itemId: 'dirty_water', min: 4, max: 4, probability: 1, guaranteed: true }],
      },
    ],
    ground: [],
  },
  99996: {
    floorNumber: 99996,
    name: '废弃食堂',
    description: '食物补给，首版探索终点',
    containers: [
      {
        id: 'counter',
        label: '餐台',
        x: 480,
        loot: [
          { itemId: 'ration_pack', min: 3, max: 3, probability: 1, guaranteed: true },
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
        ],
      },
      {
        id: 'pantry',
        label: '补给架',
        x: 1120,
        loot: [{ itemId: 'bread', min: 4, max: 4, probability: 1, guaranteed: true }],
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
      out.push({ itemId: spec.itemId, quantity: spec.min });
      continue;
    }
    if (rng.chance(spec.probability)) {
      out.push({ itemId: spec.itemId, quantity: rng.nextInt(spec.min, spec.max) });
    }
  }
  return out;
}

export function getFloorTemplate(floorNumber: number): FloorTemplate | undefined {
  return FLOOR_TEMPLATES[floorNumber];
}

export function generateFloor(worldSeed: number, floorNumber: number): GeneratedFloor {
  const template = FLOOR_TEMPLATES[floorNumber];
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
