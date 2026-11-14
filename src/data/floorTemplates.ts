import { deriveSeed, makeRng } from '../core/rng';
import type { GeneratedContainer, GeneratedFloor, GroundItem, InventoryStack, ItemId } from '../core/gameTypes';

// 楼层容器 id 复用既有家具贴图（cabinet/shelf/crate_wood/crate_metal/fuse_box/
// water_tank/counter/bed/workbench）。containerTextureKey 对未知 id 返回 null，
// 容器会变成不可见 —— 新楼层没有新家具美术，差异化靠 label 文案，不靠新贴图。
// label 控制在 2-3 字：一层最多 5 个容器，名字一长就直接压到隔壁容器的标题上
// （第 6 层首版「焊死的门柜」「塌了一半的架子」互相叠字，截图可见）。
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
  // Floors 6..10 stay inside tier 1 (docs/18_TIER_PROGRESSION.md: the slum's
  // playable segment is 1-10). They are the picked-over top of the slum: fewer
  // containers than the floors below, quantities down to a single roll, and the
  // only thing still reliably stocked is one bottle of water and one meal per
  // floor — a floor that hands out no drink would make climbing a death
  // sentence rather than a choice.
  6: {
    floorNumber: 6,
    name: '封门走廊',
    description: '六层往上的门被木板封死，门缝里塞着旧报纸',
    containers: [
      {
        id: 'cabinet',
        label: '焊死柜',
        x: 320,
        loot: [
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'cloth', min: 1, max: 2, probability: 0.35 },
        ],
      },
      {
        id: 'crate_wood',
        label: '报纸堆',
        x: 720,
        loot: [
          { itemId: 'bread', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'tape', min: 1, max: 1, probability: 0.4 },
        ],
      },
      {
        id: 'shelf',
        label: '塌架',
        x: 1040,
        loot: [
          { itemId: 'scrap_metal', min: 1, max: 2, probability: 0.5 },
          { itemId: 'battery', min: 1, max: 1, probability: 0.3 },
        ],
      },
      {
        id: 'crate_metal',
        label: '锈铁桶',
        x: 480,
        loot: [
          { itemId: 'wood', min: 1, max: 1, probability: 0.4 },
          { itemId: 'cloth', min: 1, max: 1, probability: 0.35 },
        ],
      },
    ],
    ground: [{ itemId: 'bread', quantity: 1, x: 900 }],
  },
  7: {
    floorNumber: 7,
    name: '被搜过的储藏间',
    description: '柜门全敞着，地上只剩翻乱的空盒和断掉的绳头',
    containers: [
      {
        id: 'cabinet',
        label: '空柜',
        x: 260,
        loot: [
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'wire', min: 1, max: 1, probability: 0.3 },
        ],
      },
      {
        id: 'crate_wood',
        label: '抽屉',
        x: 640,
        loot: [
          { itemId: 'bread', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'fuse', min: 1, max: 1, probability: 0.25 },
        ],
      },
      {
        id: 'shelf',
        label: '塌陷的货架',
        x: 1020,
        loot: [
          { itemId: 'scrap_metal', min: 1, max: 2, probability: 0.45 },
          { itemId: 'cloth', min: 1, max: 1, probability: 0.3 },
        ],
      },
    ],
    ground: [{ itemId: 'battery', quantity: 1, x: 800 }],
  },
  8: {
    floorNumber: 8,
    name: '停电的走廊',
    description: '应急灯全灭，墙上只剩被扯断的线槽',
    containers: [
      {
        id: 'fuse_box',
        label: '断电箱',
        x: 380,
        loot: [
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'wire', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'crate_wood',
        label: '压扁的木箱',
        x: 760,
        loot: [
          { itemId: 'bread', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'wood', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'cabinet',
        label: '钉死橱',
        x: 1120,
        loot: [
          { itemId: 'cloth', min: 1, max: 1, probability: 0.3 },
          { itemId: 'tape', min: 1, max: 1, probability: 0.3 },
        ],
      },
    ],
    ground: [],
  },
  9: {
    floorNumber: 9,
    name: '漏水的中层',
    description: '天花板不停往下滴水，墙皮泡得发软，没人愿意在这层久留',
    containers: [
      {
        id: 'water_tank',
        label: '漏水罐',
        x: 240,
        loot: [
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'filter', min: 1, max: 1, probability: 0.2 },
        ],
      },
      {
        id: 'shelf',
        label: '泡烂架',
        x: 620,
        loot: [
          { itemId: 'bread', min: 1, max: 1, probability: 1, guaranteed: true },
          // A lucky find, not a progression gate — same rule as the canteen box.
          { itemId: 'medkit', min: 1, max: 1, probability: 0.25 },
        ],
      },
      {
        id: 'crate_wood',
        label: '发霉的木匣',
        x: 1000,
        loot: [
          { itemId: 'cloth', min: 1, max: 2, probability: 0.4 },
          { itemId: 'scrap_metal', min: 1, max: 1, probability: 0.35 },
        ],
      },
    ],
    ground: [],
  },
  10: {
    floorNumber: 10,
    name: '十层尽头',
    description: '楼梯到这里断开，墙上刻着前人留下的十道横线',
    containers: [
      {
        id: 'cabinet',
        label: '末柜',
        x: 300,
        loot: [
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'battery', min: 1, max: 1, probability: 0.3 },
        ],
      },
      {
        id: 'crate_wood',
        label: '旧背包',
        x: 700,
        loot: [
          { itemId: 'bread', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'tape', min: 1, max: 1, probability: 0.3 },
        ],
      },
      {
        id: 'shelf',
        label: '封墙龛',
        x: 1080,
        loot: [
          { itemId: 'scrap_metal', min: 1, max: 2, probability: 0.4 },
          { itemId: 'fuse', min: 1, max: 1, probability: 0.25 },
        ],
      },
    ],
    ground: [],
  },
  // ── 阶层 2：工人宿舍区（100-110）──────────────────────────────────────────
  // 和 1-10 层的区别不是「更破」，而是「更有序」：这里有编号、有班次、有配给、
  // 有值班的人。容器因此是储物柜、配给箱、工牌架、床铺和值班台，而不是废墟里
  // 翻出来的木箱。家具 id 仍复用既有九种（没有新美术），差异化全在文案与摆放。
  //
  // 每层仍遵守 6-10 层立下的规矩：至少 1 份水 + 1 份食物，且都是 guaranteed —
  // 一层没水就是逼玩家渴死，不是难度。整段每层只给 1 瓶水（不多给），
  // survivalBalance.test.ts 的每层水量上限就是按这个写的。
  100: {
    floorNumber: 100,
    name: '工牌闸口',
    description: '铁闸半开，门侧的工牌架按班次编着号，缺了一格',
    containers: [
      {
        id: 'cabinet',
        label: '牌架',
        x: 260,
        loot: [
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'cloth', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'crate_wood',
        label: '配给箱',
        x: 620,
        loot: [
          { itemId: 'bread', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'ration_pack', min: 1, max: 1, probability: 0.35 },
        ],
      },
      {
        id: 'counter',
        label: '登记台',
        x: 980,
        loot: [
          { itemId: 'scrap_metal', min: 1, max: 2, probability: 0.5 },
          { itemId: 'battery', min: 1, max: 1, probability: 0.3 },
        ],
      },
    ],
    ground: [],
  },
  101: {
    floorNumber: 101,
    name: '宿舍走廊',
    description: '两排床铺贴墙排到尽头，床头挂着磨旧的名牌',
    containers: [
      {
        id: 'bed',
        label: '空床铺',
        x: 200,
        loot: [
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'cloth', min: 1, max: 2, probability: 0.5 },
        ],
      },
      {
        id: 'cabinet',
        label: '铁皮柜',
        x: 520,
        loot: [
          { itemId: 'bread', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'tape', min: 1, max: 1, probability: 0.35 },
        ],
      },
      {
        id: 'shelf',
        label: '洗漱架',
        x: 850,
        loot: [
          { itemId: 'filter', min: 1, max: 1, probability: 0.25 },
          { itemId: 'battery', min: 1, max: 1, probability: 0.3 },
        ],
      },
      {
        id: 'crate_wood',
        label: '行李箱',
        x: 1100,
        loot: [{ itemId: 'scrap_metal', min: 1, max: 2, probability: 0.45 }],
      },
    ],
    ground: [],
  },
  102: {
    floorNumber: 102,
    name: '盥洗间',
    description: '长排水槽还在滴水，镜子上蒙着一层白碱',
    containers: [
      {
        id: 'water_tank',
        label: '蓄水箱',
        x: 240,
        loot: [
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'filter', min: 1, max: 1, probability: 0.2 },
        ],
      },
      {
        id: 'shelf',
        label: '毛巾架',
        x: 600,
        loot: [
          { itemId: 'bread', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'cloth', min: 1, max: 2, probability: 0.5 },
        ],
      },
      {
        id: 'cabinet',
        label: '清扫柜',
        x: 980,
        loot: [
          { itemId: 'tape', min: 1, max: 1, probability: 0.35 },
          { itemId: 'wire', min: 1, max: 1, probability: 0.3 },
        ],
      },
    ],
    ground: [],
  },
  103: {
    floorNumber: 103,
    name: '配给处',
    description: '窗口后面的货架按号段分隔，登记本只剩封皮',
    containers: [
      {
        id: 'counter',
        label: '配给台',
        x: 320,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
        ],
      },
      {
        id: 'crate_wood',
        label: '口粮箱',
        x: 700,
        loot: [
          { itemId: 'bread', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'battery', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'cabinet',
        label: '账本柜',
        x: 1060,
        loot: [
          { itemId: 'cloth', min: 1, max: 1, probability: 0.4 },
          { itemId: 'tape', min: 1, max: 1, probability: 0.3 },
        ],
      },
    ],
    ground: [],
  },
  104: {
    floorNumber: 104,
    name: '夜班宿舍',
    description: '白班的人还在睡，帘子后面偶尔传来翻身声',
    containers: [
      {
        id: 'bed',
        label: '上铺',
        x: 220,
        loot: [
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'medkit', min: 1, max: 1, probability: 0.2 },
        ],
      },
      {
        id: 'bed',
        label: '下铺',
        x: 540,
        loot: [
          { itemId: 'bread', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'cloth', min: 1, max: 2, probability: 0.45 },
        ],
      },
      {
        id: 'cabinet',
        label: '班次柜',
        x: 860,
        loot: [
          { itemId: 'wire', min: 1, max: 1, probability: 0.3 },
          { itemId: 'fuse', min: 1, max: 1, probability: 0.25 },
        ],
      },
      {
        id: 'crate_wood',
        label: '私物箱',
        x: 1120,
        loot: [{ itemId: 'scrap_metal', min: 1, max: 2, probability: 0.4 }],
      },
    ],
    ground: [{ itemId: 'battery', quantity: 1, x: 720 }],
  },
  105: {
    floorNumber: 105,
    name: '值班室',
    description: '墙上的考勤板还留着上一班的红叉，电台没有声音',
    containers: [
      {
        id: 'workbench',
        label: '值班台',
        x: 340,
        loot: [
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'scrap_metal', min: 1, max: 2, probability: 0.5 },
        ],
      },
      {
        id: 'cabinet',
        label: '值班柜',
        x: 700,
        loot: [
          { itemId: 'bread', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'tape', min: 1, max: 1, probability: 0.35 },
        ],
      },
      {
        id: 'shelf',
        label: '钥匙架',
        x: 1040,
        loot: [
          { itemId: 'battery', min: 1, max: 2, probability: 0.45 },
          { itemId: 'wire', min: 1, max: 1, probability: 0.3 },
        ],
      },
    ],
    ground: [],
  },
  106: {
    floorNumber: 106,
    name: '公共食堂',
    description: '打饭窗口关着，长桌上还摆着没收走的餐盘',
    containers: [
      {
        id: 'counter',
        label: '打饭台',
        x: 300,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
        ],
      },
      {
        id: 'crate_wood',
        label: '菜筐',
        x: 660,
        loot: [
          { itemId: 'bread', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'cloth', min: 1, max: 1, probability: 0.3 },
        ],
      },
      {
        id: 'shelf',
        label: '调料架',
        x: 980,
        loot: [
          { itemId: 'battery', min: 1, max: 1, probability: 0.3 },
          { itemId: 'tape', min: 1, max: 1, probability: 0.3 },
        ],
      },
      {
        id: 'water_tank',
        label: '汤桶',
        x: 1160,
        loot: [{ itemId: 'filter', min: 1, max: 1, probability: 0.2 }],
      },
    ],
    ground: [],
  },
  107: {
    floorNumber: 107,
    name: '医务室',
    description: '药柜锁着，床单叠得整整齐齐，像随时会有人回来',
    containers: [
      {
        id: 'cabinet',
        label: '药柜',
        x: 280,
        loot: [
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'medkit', min: 1, max: 1, probability: 0.35 },
        ],
      },
      {
        id: 'bed',
        label: '病床',
        x: 640,
        loot: [
          { itemId: 'bread', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'cloth', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'shelf',
        label: '器皿架',
        x: 990,
        loot: [
          { itemId: 'filter', min: 1, max: 1, probability: 0.3 },
          { itemId: 'wire', min: 1, max: 1, probability: 0.3 },
        ],
      },
    ],
    ground: [],
  },
  108: {
    floorNumber: 108,
    name: '工具间',
    description: '工具按尺寸挂在墙上，每件下面都写着借用人',
    containers: [
      {
        id: 'workbench',
        label: '工作台',
        x: 320,
        loot: [
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'wire', min: 1, max: 2, probability: 0.5 },
        ],
      },
      {
        id: 'crate_metal',
        label: '工具箱',
        x: 700,
        loot: [
          { itemId: 'bread', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'scrap_metal', min: 1, max: 2, probability: 0.5 },
        ],
      },
      {
        id: 'shelf',
        label: '零件架',
        x: 1060,
        loot: [
          { itemId: 'fuse', min: 1, max: 1, probability: 0.3 },
          { itemId: 'battery', min: 1, max: 1, probability: 0.4 },
        ],
      },
    ],
    ground: [],
  },
  109: {
    floorNumber: 109,
    name: '工头宿舍',
    description: '带门的单间，桌上压着一张写满名字的排班表',
    containers: [
      {
        id: 'bed',
        label: '工头床',
        x: 260,
        loot: [
          { itemId: 'clean_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'cloth', min: 1, max: 2, probability: 0.5 },
        ],
      },
      {
        id: 'cabinet',
        label: '私人柜',
        x: 640,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'medkit', min: 1, max: 1, probability: 0.25 },
        ],
      },
      {
        id: 'workbench',
        label: '写字台',
        x: 1000,
        loot: [
          { itemId: 'scrap_metal', min: 1, max: 2, probability: 0.5 },
          { itemId: 'wire', min: 1, max: 1, probability: 0.35 },
        ],
      },
    ],
    ground: [{ itemId: 'bread', quantity: 1, x: 860 }],
  },
  110: {
    floorNumber: 110,
    name: '守段者岗亭',
    description: '岗亭的灯还亮着，铁皮柜上的一排编号正好到十一',
    containers: [
      {
        id: 'counter',
        label: '岗亭台',
        x: 320,
        loot: [
          { itemId: 'clean_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
        ],
      },
      {
        id: 'cabinet',
        label: '安保柜',
        x: 640,
        loot: [
          { itemId: 'medkit', min: 1, max: 1, probability: 0.5 },
          { itemId: 'tape', min: 1, max: 1, probability: 0.4 },
        ],
      },
      {
        id: 'crate_metal',
        label: '装备箱',
        x: 960,
        loot: [
          { itemId: 'scrap_metal', min: 1, max: 2, probability: 0.6 },
          { itemId: 'wire', min: 1, max: 2, probability: 0.5 },
        ],
      },
    ],
    ground: [],
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

// Whether a floor can be built at all. generateFloor throws without a template,
// so anything that moves the player to a floor must ask this first — the freight
// lift in particular: its target is a segment's first floor, and none of the
// segments above 10 are authored yet.
export function hasFloorContent(floorNumber: number): boolean {
  // Deliberately bypasses DEV_FLOOR_ALIAS. Floor 100000 borrowing floor 1's
  // template is a developer entry point, not authored content: if the alias were
  // honoured here, the freight lift would judge 统治核心 "connected" and drop the
  // player onto floor 1's layout while the HUD says 100000. generateFloor keeps
  // the alias so the dev entry still works.
  return FLOOR_TEMPLATES[floorNumber] !== undefined;
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
