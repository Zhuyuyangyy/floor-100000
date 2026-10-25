import { deriveSeed, makeRng } from '../core/rng';
import type { GeneratedContainer, GeneratedFloor, InventoryStack, ItemId } from '../core/gameTypes';

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
  loot: LootSpec[];
}

export interface FloorTemplate {
  floorNumber: number;
  name: string;
  description: string;
  containers: ContainerSpec[];
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
        loot: [
          { itemId: 'clean_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'cloth', min: 1, max: 2, probability: 0.6 },
        ],
      },
    ],
  },
  99999: {
    floorNumber: 99999,
    name: '邻居宿舍',
    description: '2 名可交易 NPC',
    containers: [
      {
        id: 'shelf',
        label: '邻居货架',
        loot: [{ itemId: 'bread', min: 1, max: 2, probability: 0.5 }],
      },
    ],
  },
  99998: {
    floorNumber: 99998,
    name: '废弃储物层',
    description: '搜集木材、金属、胶带、电池',
    containers: [
      {
        id: 'crate_wood',
        label: '木箱',
        loot: [
          { itemId: 'wood', min: 1, max: 3, probability: 0.8 },
          { itemId: 'tape', min: 1, max: 2, probability: 0.5 },
        ],
      },
      {
        id: 'crate_metal',
        label: '铁箱',
        loot: [
          { itemId: 'scrap_metal', min: 1, max: 3, probability: 0.8 },
          { itemId: 'battery', min: 1, max: 2, probability: 0.6 },
        ],
      },
    ],
  },
  99997: {
    floorNumber: 99997,
    name: '维修层',
    description: '漆黑区域，稳定可找到的保险丝',
    containers: [
      {
        id: 'fuse_box',
        label: '电箱',
        loot: [
          { itemId: 'fuse', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'wire', min: 1, max: 2, probability: 0.7 },
        ],
      },
    ],
  },
  99996: {
    floorNumber: 99996,
    name: '废弃食堂',
    description: '食物补给，首版探索终点',
    containers: [
      {
        id: 'counter',
        label: '餐台',
        loot: [
          { itemId: 'ration_pack', min: 1, max: 2, probability: 0.7 },
          { itemId: 'dirty_water', min: 1, max: 2, probability: 0.6 },
        ],
      },
      {
        id: 'pantry',
        label: '补给架',
        loot: [{ itemId: 'bread', min: 1, max: 3, probability: 0.6 }],
      },
    ],
  },
};

function resolveLoot(
  specs: LootSpec[],
  worldSeed: number,
  floorNumber: number,
  containerId: string,
): InventoryStack[] {
  const rng = makeRng(deriveSeed(worldSeed, floorNumber, containerId));
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
    items: resolveLoot(c.loot, worldSeed, floorNumber, c.id),
  }));
  return { floorNumber, name: template.name, containers };
}
