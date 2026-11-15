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
        id: 'badge_rack',
        label: '牌架',
        x: 260,
        loot: [
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'cloth', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'ration_dispenser',
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
        id: 'bunk_bed',
        label: '空床铺',
        x: 200,
        loot: [
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'cloth', min: 1, max: 2, probability: 0.5 },
        ],
      },
      {
        id: 'worker_locker',
        label: '铁皮柜',
        x: 520,
        loot: [
          { itemId: 'bread', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'tape', min: 1, max: 1, probability: 0.35 },
        ],
      },
      {
        id: 'wash_sink',
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
        id: 'uniform_rack',
        label: '毛巾架',
        x: 600,
        loot: [
          { itemId: 'bread', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'cloth', min: 1, max: 2, probability: 0.5 },
        ],
      },
      {
        id: 'worker_locker',
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
        id: 'meal_counter',
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
        id: 'shift_locker',
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
        id: 'bunk_top',
        label: '上铺',
        x: 220,
        loot: [
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'medkit', min: 1, max: 1, probability: 0.2 },
        ],
      },
      {
        id: 'bunk_bottom',
        label: '下铺',
        x: 540,
        loot: [
          { itemId: 'bread', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'cloth', min: 1, max: 2, probability: 0.45 },
        ],
      },
      {
        id: 'shift_locker',
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
        id: 'shift_locker',
        label: '值班柜',
        x: 700,
        loot: [
          { itemId: 'bread', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'tape', min: 1, max: 1, probability: 0.35 },
        ],
      },
      {
        id: 'key_board',
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
        id: 'meal_counter',
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
        id: 'thermos_rack',
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
        id: 'shift_locker',
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
        id: 'tool_cage',
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
        id: 'worker_locker',
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
        id: 'security_safe',
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
  // ── 阶层 3：工业与交易区（1000-1010）────────────────────────────────────
  // 和工人宿舍区的区别不是「更破」，而是「更严」：军队级安保、编号装备、
  // 管道、黑市。基调是「被管得更严，而且有东西在管道里」——容器因此是
  // 电闸、军械箱、检查台、黑市摊位和货运箱。容器 id 仍复用既有贴图
  // （没有新美术），差异化全在文案与摆放。
  //
  // 生存规矩与前两段一致：每层恰好 1 份 guaranteed 水 + 1 份 guaranteed
  // 食物。survivalBalance.test.ts 的「分层盈余」按每层一瓶水的口径给
  // 第三段记 30 点额度，任何一层多出一瓶水（哪怕是概率掉落的）都会踩穿
  // 那个上限——所以这一段每层只写一条水，且必是 guaranteed。物资比
  // 宿舍区更「工业」：filter/fuse/wire/battery 权重更高，食物以军粮为
  // 主；水在管道层是脏水，到 1009/1010 的军官层才换成净水。
  1000: {
    floorNumber: 1000,
    name: '军管闸口',
    description: '升降机井口的检查站，武装柜锁着，闸机还通着电',
    containers: [
      {
        id: 'fuse_box',
        label: '电闸',
        x: 300,
        loot: [
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'battery', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'crate_metal',
        label: '军械箱',
        x: 640,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'scrap_metal', min: 1, max: 2, probability: 0.5 },
        ],
      },
      {
        id: 'counter',
        label: '检查台',
        x: 980,
        loot: [
          { itemId: 'wire', min: 1, max: 2, probability: 0.45 },
          { itemId: 'tape', min: 1, max: 1, probability: 0.3 },
        ],
      },
      {
        id: 'shelf',
        label: '货架',
        x: 1140,
        loot: [
          { itemId: 'filter', min: 1, max: 1, probability: 0.25 },
          { itemId: 'cloth', min: 1, max: 1, probability: 0.3 },
        ],
      },
    ],
    ground: [],
  },
  1001: {
    floorNumber: 1001,
    name: '装甲走廊',
    description: '墙上钉着装甲板，弹孔按编号补过，像定期保养',
    containers: [
      {
        id: 'security_safe',
        label: '安保柜',
        x: 260,
        loot: [
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'medkit', min: 1, max: 1, probability: 0.3 },
        ],
      },
      {
        id: 'crate_metal',
        label: '装备箱',
        x: 620,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'wire', min: 1, max: 2, probability: 0.5 },
        ],
      },
      {
        id: 'fuse_box',
        label: '配电箱',
        x: 900,
        loot: [
          { itemId: 'fuse', min: 1, max: 1, probability: 0.3 },
          { itemId: 'battery', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'workbench',
        label: '工作台',
        x: 1140,
        loot: [
          { itemId: 'scrap_metal', min: 1, max: 2, probability: 0.5 },
          { itemId: 'tape', min: 1, max: 1, probability: 0.3 },
        ],
      },
    ],
    ground: [],
  },
  1002: {
    floorNumber: 1002,
    name: '管道层',
    description: '管道在墙里轰隆隆地走，裂缝处有人用胶带缠了又缠',
    containers: [
      {
        id: 'water_tank',
        label: '储水罐',
        x: 240,
        loot: [
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'filter', min: 1, max: 1, probability: 0.2 },
        ],
      },
      {
        id: 'crate_wood',
        label: '货箱',
        x: 600,
        loot: [
          { itemId: 'bread', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'wood', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'shelf',
        label: '零件架',
        x: 920,
        loot: [
          { itemId: 'fuse', min: 1, max: 1, probability: 0.3 },
          { itemId: 'wire', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'cabinet',
        label: '铁皮柜',
        x: 1140,
        loot: [
          { itemId: 'battery', min: 1, max: 2, probability: 0.45 },
          { itemId: 'cloth', min: 1, max: 1, probability: 0.3 },
        ],
      },
    ],
    ground: [],
  },
  1003: {
    floorNumber: 1003,
    name: '黑市厅',
    description: '柜台后面挂着帘子，纸币和零件在同一个抽屉里结算',
    containers: [
      {
        id: 'counter',
        label: '摊位',
        x: 220,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'tape', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'water_tank',
        label: '水塔',
        x: 520,
        loot: [
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'filter', min: 1, max: 1, probability: 0.25 },
        ],
      },
      {
        id: 'crate_wood',
        label: '货箱',
        x: 780,
        loot: [
          { itemId: 'battery', min: 1, max: 2, probability: 0.5 },
          { itemId: 'cloth', min: 1, max: 1, probability: 0.35 },
        ],
      },
      {
        id: 'shelf',
        label: '黑市架',
        x: 1020,
        loot: [
          { itemId: 'wire', min: 1, max: 2, probability: 0.45 },
          { itemId: 'medkit', min: 1, max: 1, probability: 0.3 },
        ],
      },
      {
        id: 'security_safe',
        label: '收款柜',
        x: 1160,
        loot: [
          { itemId: 'scrap_metal', min: 1, max: 2, probability: 0.5 },
          { itemId: 'fuse', min: 1, max: 1, probability: 0.3 },
        ],
      },
    ],
    ground: [],
  },
  1004: {
    floorNumber: 1004,
    name: '驻军宿舍',
    description: '驻军的床铺空着，铺位牌按班次编着号',
    containers: [
      {
        id: 'bunk_bed',
        label: '空铺',
        x: 220,
        loot: [
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'cloth', min: 1, max: 2, probability: 0.5 },
        ],
      },
      {
        id: 'worker_locker',
        label: '军械柜',
        x: 540,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'battery', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'crate_metal',
        label: '弹药箱',
        x: 860,
        loot: [
          { itemId: 'scrap_metal', min: 1, max: 2, probability: 0.55 },
          { itemId: 'fuse', min: 1, max: 1, probability: 0.3 },
        ],
      },
      {
        id: 'wash_sink',
        label: '洗漱台',
        x: 1120,
        loot: [
          { itemId: 'filter', min: 1, max: 1, probability: 0.25 },
          { itemId: 'wire', min: 1, max: 1, probability: 0.3 },
        ],
      },
    ],
    ground: [],
  },
  1005: {
    floorNumber: 1005,
    name: '抢修车间',
    description: '抢修台的灯还亮着，工具按尺寸挂在磁性板上',
    containers: [
      {
        id: 'workbench',
        label: '抢修台',
        x: 260,
        loot: [
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'wire', min: 1, max: 2, probability: 0.5 },
        ],
      },
      {
        id: 'tool_cage',
        label: '工具架',
        x: 600,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'scrap_metal', min: 1, max: 2, probability: 0.5 },
        ],
      },
      {
        id: 'fuse_box',
        label: '断电器',
        x: 920,
        loot: [
          { itemId: 'fuse', min: 1, max: 1, probability: 0.35 },
          { itemId: 'battery', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'shelf',
        label: '备件架',
        x: 1140,
        loot: [
          { itemId: 'filter', min: 1, max: 1, probability: 0.3 },
          { itemId: 'tape', min: 1, max: 1, probability: 0.3 },
        ],
      },
    ],
    ground: [],
  },
  1006: {
    floorNumber: 1006,
    name: '化验角',
    description: '实验台的水槽干着，墙上贴着三代以前的检疫通告',
    containers: [
      {
        id: 'cabinet',
        label: '药品柜',
        x: 280,
        loot: [
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'medkit', min: 1, max: 1, probability: 0.35 },
        ],
      },
      {
        id: 'counter',
        label: '实验台',
        x: 640,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'filter', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'shelf',
        label: '器皿架',
        x: 960,
        loot: [
          { itemId: 'fuse', min: 1, max: 1, probability: 0.3 },
          { itemId: 'wire', min: 1, max: 1, probability: 0.35 },
        ],
      },
      {
        id: 'crate_metal',
        label: '样本箱',
        x: 1160,
        loot: [
          { itemId: 'battery', min: 1, max: 2, probability: 0.4 },
          { itemId: 'cloth', min: 1, max: 1, probability: 0.3 },
        ],
      },
    ],
    ground: [],
  },
  1007: {
    floorNumber: 1007,
    name: '货运月台',
    description: '月台的板条箱堆到顶，转运单压在石头下面',
    containers: [
      {
        id: 'crate_metal',
        label: '货运箱',
        x: 240,
        loot: [
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'battery', min: 1, max: 2, probability: 0.45 },
        ],
      },
      {
        id: 'crate_wood',
        label: '板条箱',
        x: 560,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'wood', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'workbench',
        label: '月台桌',
        x: 880,
        loot: [
          { itemId: 'wire', min: 1, max: 2, probability: 0.45 },
          { itemId: 'tape', min: 1, max: 1, probability: 0.3 },
        ],
      },
      {
        id: 'shelf',
        label: '货架',
        x: 1120,
        loot: [
          { itemId: 'filter', min: 1, max: 1, probability: 0.25 },
          { itemId: 'scrap_metal', min: 1, max: 2, probability: 0.45 },
        ],
      },
    ],
    ground: [],
  },
  1008: {
    floorNumber: 1008,
    name: '军情值班室',
    description: '值班电台没有声音，墙上的敌我识别图卷了边',
    containers: [
      {
        id: 'counter',
        label: '值班台',
        x: 260,
        loot: [
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'battery', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'security_safe',
        label: '档案柜',
        x: 620,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'medkit', min: 1, max: 1, probability: 0.3 },
        ],
      },
      {
        id: 'key_board',
        label: '钥匙架',
        x: 920,
        loot: [
          { itemId: 'fuse', min: 1, max: 1, probability: 0.3 },
          { itemId: 'wire', min: 1, max: 1, probability: 0.35 },
        ],
      },
      {
        id: 'cabinet',
        label: '地图柜',
        x: 1140,
        loot: [
          { itemId: 'filter', min: 1, max: 1, probability: 0.25 },
          { itemId: 'cloth', min: 1, max: 1, probability: 0.3 },
        ],
      },
    ],
    ground: [],
  },
  1009: {
    floorNumber: 1009,
    name: '军官层',
    description: '带门套的单间，桌上压着一枚没拆封的肩章',
    containers: [
      {
        id: 'bed',
        label: '军官床',
        x: 260,
        loot: [
          { itemId: 'clean_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'cloth', min: 1, max: 2, probability: 0.5 },
        ],
      },
      {
        id: 'worker_locker',
        label: '私人柜',
        x: 640,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'medkit', min: 1, max: 1, probability: 0.35 },
        ],
      },
      {
        id: 'workbench',
        label: '写字台',
        x: 1000,
        loot: [
          { itemId: 'scrap_metal', min: 1, max: 2, probability: 0.5 },
          { itemId: 'wire', min: 1, max: 2, probability: 0.4 },
        ],
      },
    ],
    ground: [{ itemId: 'battery', quantity: 1, x: 860 }],
  },
  1010: {
    floorNumber: 1010,
    name: '货梯闸',
    description: '货梯闸的灯还亮着，读卡器等着一张不存在的卡',
    containers: [
      {
        id: 'counter',
        label: '闸口台',
        x: 320,
        loot: [
          { itemId: 'clean_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
        ],
      },
      {
        id: 'security_safe',
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
  // ── 阶层 4：中产与商业区（10000-10010）──────────────────────────────────
  // 和工业区的区别不是「更破」或「更严」，而是「更干净、更贵」：这里铺着地毯、
  // 招牌全亮着、闸机还通着电——管这套地方的不是军队，是私人武装和一纸合同。
  // 容器因此是收银台、展架、样品柜、监控台和闸口台，而不是管道层的铁皮柜。
  // 容器 id 仍复用既有贴图（没有新美术），差异化全在文案与摆放。
  //
  // 生存规矩与前三段一致，且最硬：每层恰好 1 份 guaranteed 水 + 1 份
  // guaranteed 食物。survivalBalance.test.ts 的「分层盈余」按每层一瓶水给
  // 这一段记 30 点额度——10000-10010 共 11 层，任何一层多出一瓶水（哪怕是
  // 概率掉落的）都会踩穿上限，所以每层只写一条水，且必是 guaranteed。
  // 物资是四段里最「超高级」的：filter/medkit/fuse 的权重全面高于工业区，
  // 食物以压缩口粮为主（餐饮层 10002 给面包），水在机房与实验室两层是脏水，
  // 其余都是净水——中产区的水管还没断，断的是别的东西。
  //
  // 整段不放 boss：把着往 50000 层货梯的是许可证，不是怪物（阶层 5 才放
  // 守段者，见 docs/18_TIER_PROGRESSION.md §3 与 encounterTableCoverage 的
  // BOSS_FLOORS）。段顶 10010 与 110/1010 同构：闸口台 + 安保柜 + 装备箱。
  10000: {
    floorNumber: 10000,
    name: '门禁大堂',
    description: '闸机还通着电，地毯从门口一直铺到电梯厅，招牌亮得刺眼',
    containers: [
      {
        id: 'badge_rack',
        label: '牌架',
        x: 260,
        loot: [
          { itemId: 'clean_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'cloth', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'counter',
        label: '接待台',
        x: 620,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'battery', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'security_safe',
        label: '安保柜',
        x: 960,
        loot: [
          { itemId: 'medkit', min: 1, max: 1, probability: 0.4 },
          { itemId: 'scrap_metal', min: 1, max: 2, probability: 0.45 },
        ],
      },
      {
        id: 'shelf',
        label: '导视架',
        x: 1140,
        loot: [
          { itemId: 'filter', min: 1, max: 1, probability: 0.3 },
          { itemId: 'wire', min: 1, max: 2, probability: 0.35 },
        ],
      },
    ],
    ground: [],
  },
  10001: {
    floorNumber: 10001,
    name: '商铺街',
    description: '招牌全亮着，收银台排成一排，像还在营业',
    containers: [
      {
        id: 'counter',
        label: '收银台',
        x: 240,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'battery', min: 1, max: 2, probability: 0.45 },
        ],
      },
      {
        id: 'crate_wood',
        label: '货箱',
        x: 560,
        loot: [
          { itemId: 'clean_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'cloth', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'shelf',
        label: '展架',
        x: 880,
        loot: [
          { itemId: 'filter', min: 1, max: 1, probability: 0.3 },
          { itemId: 'fuse', min: 1, max: 1, probability: 0.3 },
        ],
      },
      {
        id: 'security_safe',
        label: '安保柜',
        x: 1140,
        loot: [
          { itemId: 'medkit', min: 1, max: 1, probability: 0.4 },
          { itemId: 'scrap_metal', min: 1, max: 2, probability: 0.4 },
        ],
      },
    ],
    ground: [{ itemId: 'battery', quantity: 1, x: 900 }],
  },
  10002: {
    floorNumber: 10002,
    name: '餐饮层',
    description: '取餐口擦得很亮，保温台里剩最后几份，没人来领',
    containers: [
      {
        id: 'meal_counter',
        label: '餐台',
        x: 300,
        loot: [
          // 商业区的食物以压缩口粮为主，唯独餐饮层给面包——这一层的库存
          // 断之前，是真的有人在卖热食的。
          { itemId: 'bread', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'battery', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'water_tank',
        label: '饮水机',
        x: 620,
        loot: [
          { itemId: 'clean_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'filter', min: 1, max: 1, probability: 0.25 },
        ],
      },
      {
        id: 'shelf',
        label: '货架',
        x: 920,
        loot: [
          { itemId: 'wire', min: 1, max: 2, probability: 0.35 },
          { itemId: 'cloth', min: 1, max: 1, probability: 0.3 },
        ],
      },
      {
        id: 'counter',
        label: '收银台',
        x: 1160,
        loot: [
          { itemId: 'scrap_metal', min: 1, max: 2, probability: 0.4 },
          { itemId: 'tape', min: 1, max: 1, probability: 0.3 },
        ],
      },
    ],
    ground: [],
  },
  10003: {
    floorNumber: 10003,
    name: '写字间',
    description: '工位隔板上贴着排班，地毯厚得吞掉脚步',
    containers: [
      {
        id: 'cabinet',
        label: '文件柜',
        x: 260,
        loot: [
          { itemId: 'clean_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'cloth', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'workbench',
        label: '工位',
        x: 620,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'wire', min: 1, max: 2, probability: 0.45 },
        ],
      },
      {
        id: 'key_board',
        label: '钥匙架',
        x: 920,
        loot: [
          { itemId: 'battery', min: 1, max: 2, probability: 0.45 },
          { itemId: 'fuse', min: 1, max: 1, probability: 0.3 },
        ],
      },
      {
        id: 'security_safe',
        label: '安保柜',
        x: 1140,
        loot: [
          { itemId: 'medkit', min: 1, max: 1, probability: 0.4 },
          { itemId: 'scrap_metal', min: 1, max: 2, probability: 0.45 },
        ],
      },
    ],
    ground: [],
  },
  10004: {
    floorNumber: 10004,
    name: '公寓层',
    description: '带门套的住户，鞋柜上摆着全家福，窗帘拉得整整齐齐',
    containers: [
      {
        id: 'bed',
        label: '公寓床',
        x: 240,
        loot: [
          { itemId: 'clean_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'cloth', min: 1, max: 2, probability: 0.5 },
        ],
      },
      {
        id: 'cabinet',
        label: '衣柜',
        x: 560,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'battery', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'bunk_bed',
        label: '客床',
        x: 880,
        loot: [
          { itemId: 'filter', min: 1, max: 1, probability: 0.3 },
          { itemId: 'medkit', min: 1, max: 1, probability: 0.25 },
        ],
      },
      {
        id: 'wash_sink',
        label: '洗漱台',
        x: 1140,
        loot: [
          { itemId: 'wire', min: 1, max: 2, probability: 0.35 },
          { itemId: 'scrap_metal', min: 1, max: 1, probability: 0.35 },
        ],
      },
    ],
    ground: [],
  },
  10005: {
    floorNumber: 10005,
    name: '物业机房',
    description: '管线井里轰隆作响，墙角渗出一小片水，报修单压在工具下',
    containers: [
      {
        id: 'fuse_box',
        label: '配电箱',
        x: 260,
        loot: [
          // 商业区唯一一段还流着脏水的地方：机房渗水，没人来修。
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'battery', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'tool_cage',
        label: '工具架',
        x: 600,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'fuse', min: 1, max: 1, probability: 0.35 },
        ],
      },
      {
        id: 'crate_metal',
        label: '装备箱',
        x: 920,
        loot: [
          { itemId: 'scrap_metal', min: 1, max: 2, probability: 0.5 },
          { itemId: 'wire', min: 1, max: 2, probability: 0.45 },
        ],
      },
      {
        id: 'workbench',
        label: '抢修台',
        x: 1140,
        loot: [
          { itemId: 'filter', min: 1, max: 1, probability: 0.3 },
          { itemId: 'tape', min: 1, max: 1, probability: 0.3 },
        ],
      },
    ],
    ground: [],
  },
  10006: {
    floorNumber: 10006,
    name: '私人安保室',
    description: '监控墙黑着，装备柜按编号锁着，防弹背心叠成一边',
    containers: [
      {
        id: 'security_safe',
        label: '安保柜',
        x: 260,
        loot: [
          { itemId: 'clean_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'medkit', min: 1, max: 1, probability: 0.45 },
        ],
      },
      {
        id: 'crate_metal',
        label: '装备箱',
        x: 600,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'scrap_metal', min: 1, max: 2, probability: 0.55 },
        ],
      },
      {
        id: 'key_board',
        label: '钥匙架',
        x: 920,
        loot: [
          { itemId: 'fuse', min: 1, max: 1, probability: 0.35 },
          { itemId: 'battery', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'counter',
        label: '监控台',
        x: 1140,
        loot: [
          { itemId: 'wire', min: 1, max: 2, probability: 0.5 },
          { itemId: 'filter', min: 1, max: 1, probability: 0.3 },
        ],
      },
    ],
    ground: [],
  },
  10007: {
    floorNumber: 10007,
    name: '样品间',
    description: '封好的箱子沿墙码齐，面上一张标签都没有，轮子朝外',
    containers: [
      {
        id: 'crate_metal',
        label: '样本箱',
        x: 240,
        loot: [
          { itemId: 'clean_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'medkit', min: 1, max: 1, probability: 0.4 },
        ],
      },
      {
        id: 'cabinet',
        label: '样品柜',
        x: 560,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'filter', min: 1, max: 1, probability: 0.35 },
        ],
      },
      {
        id: 'shelf',
        label: '存放架',
        x: 880,
        loot: [
          { itemId: 'fuse', min: 1, max: 1, probability: 0.3 },
          { itemId: 'battery', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'security_safe',
        label: '安保柜',
        x: 1140,
        loot: [
          { itemId: 'wire', min: 1, max: 2, probability: 0.4 },
          { itemId: 'scrap_metal', min: 1, max: 2, probability: 0.4 },
        ],
      },
    ],
    ground: [],
  },
  10008: {
    floorNumber: 10008,
    name: '实验室',
    description: '值班灯还亮着，笼架的位置已经空了，登记簿停在最后一页',
    containers: [
      {
        id: 'counter',
        label: '实验台',
        x: 260,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'filter', min: 1, max: 2, probability: 0.45 },
        ],
      },
      {
        id: 'cabinet',
        label: '药品柜',
        x: 600,
        loot: [
          // 实验用水：这一层的水没人敢直饮，和底层一样得先净化。
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'medkit', min: 1, max: 1, probability: 0.5 },
        ],
      },
      {
        id: 'crate_metal',
        label: '样本箱',
        x: 920,
        loot: [
          { itemId: 'battery', min: 1, max: 2, probability: 0.45 },
          { itemId: 'fuse', min: 1, max: 1, probability: 0.3 },
        ],
      },
      {
        id: 'shelf',
        label: '器皿架',
        x: 1140,
        loot: [
          { itemId: 'wire', min: 1, max: 2, probability: 0.4 },
          { itemId: 'cloth', min: 1, max: 1, probability: 0.3 },
        ],
      },
    ],
    ground: [{ itemId: 'cloth', quantity: 1, x: 800 }],
  },
  10009: {
    floorNumber: 10009,
    name: '高管层',
    description: '整层只有一户，地毯换成厚的，签字笔还插在笔筒里',
    containers: [
      {
        id: 'bed',
        label: '高管床',
        x: 260,
        loot: [
          { itemId: 'clean_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'cloth', min: 1, max: 2, probability: 0.5 },
        ],
      },
      {
        id: 'workbench',
        label: '写字台',
        x: 640,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'wire', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'security_safe',
        label: '保险柜',
        x: 1000,
        loot: [
          { itemId: 'medkit', min: 1, max: 1, probability: 0.45 },
          { itemId: 'fuse', min: 1, max: 1, probability: 0.3 },
        ],
      },
    ],
    ground: [],
  },
  10010: {
    floorNumber: 10010,
    name: '货梯闸',
    description: '货梯闸的灯还亮着，读卡器等着一张更贵的卡',
    containers: [
      {
        id: 'counter',
        label: '闸口台',
        x: 320,
        loot: [
          { itemId: 'clean_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
        ],
      },
      {
        id: 'security_safe',
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
  // ── 阶层 5：富人特权区（50000-50010）────────────────────────────────────
  // 和中产区的区别不是「更破」或「更严」，而是「更干净、更贵、更知道」：
  // 地毯一直铺到电梯厅，招牌亮得温和，笼架却已经空了——生物兵器在这一段
  // 正式登场，富人不只知道，他们买单（docs/18_TIER_PROGRESSION.md §3：
  // 「他们在楼上养着它，像养一条看门狗」）。容器因此是接待台、保险柜、
  // 样品柜、宴厅餐台和冷藏架，而不是商业区的收银台。容器 id 仍复用既有
  // 贴图（没有新美术），差异化全在文案与摆放。
  //
  // 生存规矩与前四段一致，且最硬：每层恰好 1 份 guaranteed 水 + 1 份
  // guaranteed 食物。survivalBalance.test.ts 的「分层盈余」按每层一瓶水
  // 给这一段记 30 点额度——50000-50010 共 11 层，任何一层多出一瓶水
  // （哪怕是概率掉落的）都会踩穿上限，所以每层只写一条水，且必是
  // guaranteed。物资是五段里最「稀有」的：medkit/filter/fuse/battery 的
  // 权重全面高于中产区（遭遇池见 encounters.ts 的 FLOOR_LOOT_POOLS），
  // 水以净水为主——这一段的管道没断，断的是别的东西；只有喂养层
  // （50005）与实验室（50008）两层是脏水，和 10005/10008 同一个写法。
  //
  // 段顶 50010 放守段者（这一阶层有守门者，见 encounters.ts 的
  // FLOOR_WEIGHT_PROFILE 与 encounterTableCoverage 的 BOSS_FLOORS）：
  // 闸口台 + 安保柜 + 装备箱，和 110/1010/10010 同构，但柜里锁的是生物
  // 兵器的看护补给。设计文档 §3 的六个节点之一：「花钱能买到通行。买不到
  // 下楼的理由。」
  50000: {
    floorNumber: 50000,
    name: '贵宾闸口',
    description: '闸机还通着电，地毯从门口一路铺到电梯厅，招牌亮得温和',
    containers: [
      {
        id: 'badge_rack',
        label: '牌架',
        x: 260,
        loot: [
          { itemId: 'clean_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'cloth', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'counter',
        label: '接待台',
        x: 620,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'battery', min: 1, max: 2, probability: 0.45 },
        ],
      },
      {
        id: 'security_safe',
        label: '保险柜',
        x: 960,
        loot: [
          { itemId: 'medkit', min: 1, max: 1, probability: 0.45 },
          { itemId: 'filter', min: 1, max: 1, probability: 0.35 },
        ],
      },
      {
        id: 'shelf',
        label: '导视架',
        x: 1140,
        loot: [
          { itemId: 'fuse', min: 1, max: 1, probability: 0.35 },
          { itemId: 'wire', min: 1, max: 2, probability: 0.4 },
        ],
      },
    ],
    ground: [],
  },
  50001: {
    floorNumber: 50001,
    name: '红毯走廊',
    description: '地毯厚得吞掉脚步，墙上的画框比人高，门牌号从五千开始',
    containers: [
      {
        id: 'cabinet',
        label: '衣柜',
        x: 240,
        loot: [
          { itemId: 'clean_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'cloth', min: 1, max: 2, probability: 0.5 },
        ],
      },
      {
        id: 'bed',
        label: '客床',
        x: 560,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'medkit', min: 1, max: 1, probability: 0.35 },
        ],
      },
      {
        id: 'wash_sink',
        label: '洗漱台',
        x: 880,
        loot: [
          { itemId: 'filter', min: 1, max: 1, probability: 0.4 },
          { itemId: 'battery', min: 1, max: 2, probability: 0.45 },
        ],
      },
      {
        id: 'shelf',
        label: '摆件架',
        x: 1140,
        loot: [
          { itemId: 'fuse', min: 1, max: 1, probability: 0.35 },
          { itemId: 'wire', min: 1, max: 2, probability: 0.4 },
        ],
      },
    ],
    ground: [],
  },
  50002: {
    floorNumber: 50002,
    name: '宴厅',
    description: '长桌还摆着没撤的餐具，保温台里剩最后几份，没人来领',
    containers: [
      {
        id: 'meal_counter',
        label: '餐台',
        x: 300,
        loot: [
          // 宴厅的食物是面包，不是口粮：这一层断供之前，是真的有人在办
          // 盛宴的（纸条：「盛宴那天，整个塔都安静得不对。」）。
          { itemId: 'bread', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'battery', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'water_tank',
        label: '饮水机',
        x: 620,
        loot: [
          { itemId: 'clean_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'filter', min: 1, max: 1, probability: 0.3 },
        ],
      },
      {
        id: 'shelf',
        label: '酒架',
        x: 920,
        loot: [
          { itemId: 'wire', min: 1, max: 2, probability: 0.4 },
          { itemId: 'cloth', min: 1, max: 1, probability: 0.3 },
        ],
      },
      {
        id: 'crate_wood',
        label: '货箱',
        x: 1140,
        loot: [
          { itemId: 'fuse', min: 1, max: 1, probability: 0.35 },
          { itemId: 'tape', min: 1, max: 1, probability: 0.3 },
        ],
      },
    ],
    ground: [],
  },
  50003: {
    floorNumber: 50003,
    name: '私人公寓',
    description: '带门套的住户，鞋柜上摆着全家福，窗帘拉得整整齐齐',
    containers: [
      {
        id: 'bed',
        label: '公寓床',
        x: 240,
        loot: [
          { itemId: 'clean_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'cloth', min: 1, max: 2, probability: 0.5 },
        ],
      },
      {
        id: 'cabinet',
        label: '衣柜',
        x: 560,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'medkit', min: 1, max: 1, probability: 0.4 },
        ],
      },
      {
        id: 'bunk_bed',
        label: '客床',
        x: 880,
        loot: [
          { itemId: 'filter', min: 1, max: 1, probability: 0.35 },
          { itemId: 'battery', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'wash_sink',
        label: '洗漱台',
        x: 1140,
        loot: [
          { itemId: 'wire', min: 1, max: 2, probability: 0.35 },
          { itemId: 'fuse', min: 1, max: 1, probability: 0.3 },
        ],
      },
    ],
    ground: [],
  },
  50004: {
    floorNumber: 50004,
    name: '恒温机房',
    description: '管线井里轰隆作响，恒温机还转着，墙角渗出一小片水',
    containers: [
      {
        id: 'fuse_box',
        label: '配电箱',
        x: 260,
        loot: [
          { itemId: 'clean_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'battery', min: 1, max: 2, probability: 0.5 },
        ],
      },
      {
        id: 'tool_cage',
        label: '工具架',
        x: 600,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'fuse', min: 1, max: 1, probability: 0.4 },
        ],
      },
      {
        id: 'crate_metal',
        label: '装备箱',
        x: 920,
        loot: [
          { itemId: 'scrap_metal', min: 1, max: 2, probability: 0.5 },
          { itemId: 'wire', min: 1, max: 2, probability: 0.45 },
        ],
      },
      {
        id: 'workbench',
        label: '抢修台',
        x: 1140,
        loot: [
          { itemId: 'filter', min: 1, max: 1, probability: 0.35 },
          { itemId: 'medkit', min: 1, max: 1, probability: 0.35 },
        ],
      },
    ],
    ground: [],
  },
  50005: {
    floorNumber: 50005,
    name: '喂养层',
    description: '玻璃柜沿墙码齐，笼架的位置已经空了，饲料槽还是满的',
    containers: [
      {
        id: 'crate_metal',
        label: '样本箱',
        x: 240,
        loot: [
          // 喂它的水：这一层是脏水，和 10005/10008 同一个写法——富人区
          // 的管道没断，断的是别的东西。
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'medkit', min: 1, max: 1, probability: 0.5 },
        ],
      },
      {
        id: 'cabinet',
        label: '样品柜',
        x: 560,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'filter', min: 1, max: 2, probability: 0.45 },
        ],
      },
      {
        id: 'shelf',
        label: '存放架',
        x: 880,
        loot: [
          { itemId: 'fuse', min: 1, max: 1, probability: 0.4 },
          { itemId: 'battery', min: 1, max: 2, probability: 0.45 },
        ],
      },
      {
        id: 'security_safe',
        label: '安保柜',
        x: 1140,
        loot: [
          { itemId: 'wire', min: 1, max: 2, probability: 0.4 },
          { itemId: 'scrap_metal', min: 1, max: 2, probability: 0.4 },
        ],
      },
    ],
    ground: [],
  },
  50006: {
    floorNumber: 50006,
    name: '贵宾安保室',
    description: '监控墙还亮着，装备柜按编号锁着，防弹背心叠成一边',
    containers: [
      {
        id: 'security_safe',
        label: '安保柜',
        x: 260,
        loot: [
          { itemId: 'clean_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'medkit', min: 1, max: 1, probability: 0.5 },
        ],
      },
      {
        id: 'crate_metal',
        label: '装备箱',
        x: 600,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'scrap_metal', min: 1, max: 2, probability: 0.55 },
        ],
      },
      {
        id: 'key_board',
        label: '钥匙架',
        x: 920,
        loot: [
          { itemId: 'fuse', min: 1, max: 1, probability: 0.4 },
          { itemId: 'battery', min: 1, max: 2, probability: 0.45 },
        ],
      },
      {
        id: 'counter',
        label: '监控台',
        x: 1140,
        loot: [
          { itemId: 'wire', min: 1, max: 2, probability: 0.5 },
          { itemId: 'filter', min: 1, max: 1, probability: 0.35 },
        ],
      },
    ],
    ground: [],
  },
  50007: {
    floorNumber: 50007,
    name: '冷藏库',
    description: '冷气从门缝里往外冒，货架按日期编号，最上面一层空了',
    containers: [
      {
        id: 'shelf',
        label: '冷藏架',
        x: 240,
        loot: [
          { itemId: 'clean_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'medkit', min: 1, max: 1, probability: 0.45 },
        ],
      },
      {
        id: 'cabinet',
        label: '储柜',
        x: 560,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'filter', min: 1, max: 1, probability: 0.4 },
        ],
      },
      {
        id: 'crate_metal',
        label: '货箱',
        x: 920,
        loot: [
          { itemId: 'battery', min: 1, max: 2, probability: 0.5 },
          { itemId: 'fuse', min: 1, max: 1, probability: 0.35 },
        ],
      },
      {
        id: 'ration_dispenser',
        label: '配给箱',
        x: 1140,
        loot: [
          { itemId: 'wire', min: 1, max: 2, probability: 0.4 },
          { itemId: 'cloth', min: 1, max: 1, probability: 0.3 },
        ],
      },
    ],
    ground: [],
  },
  50008: {
    floorNumber: 50008,
    name: '楼上实验室',
    description: '值班灯还亮着，笼架的位置已经空了，登记簿停在最后一页',
    containers: [
      {
        id: 'counter',
        label: '实验台',
        x: 260,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'filter', min: 1, max: 2, probability: 0.5 },
        ],
      },
      {
        id: 'cabinet',
        label: '药品柜',
        x: 600,
        loot: [
          // 实验用水：这一层的水没人敢直饮，和 10008 一样得先净化。
          { itemId: 'dirty_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'medkit', min: 1, max: 1, probability: 0.55 },
        ],
      },
      {
        id: 'crate_metal',
        label: '样本箱',
        x: 920,
        loot: [
          { itemId: 'battery', min: 1, max: 2, probability: 0.5 },
          { itemId: 'fuse', min: 1, max: 1, probability: 0.35 },
        ],
      },
      {
        id: 'shelf',
        label: '器皿架',
        x: 1140,
        loot: [
          { itemId: 'wire', min: 1, max: 2, probability: 0.4 },
          { itemId: 'cloth', min: 1, max: 1, probability: 0.3 },
        ],
      },
    ],
    ground: [{ itemId: 'cloth', quantity: 1, x: 800 }],
  },
  50009: {
    floorNumber: 50009,
    name: '顶层套房',
    description: '整层只有一户，地毯换成厚的，签字笔还插在笔筒里',
    containers: [
      {
        id: 'bed',
        label: '套房床',
        x: 260,
        loot: [
          { itemId: 'clean_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'cloth', min: 1, max: 2, probability: 0.5 },
        ],
      },
      {
        id: 'workbench',
        label: '写字台',
        x: 640,
        loot: [
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'wire', min: 1, max: 2, probability: 0.4 },
        ],
      },
      {
        id: 'security_safe',
        label: '保险柜',
        x: 1000,
        loot: [
          { itemId: 'medkit', min: 1, max: 1, probability: 0.5 },
          { itemId: 'fuse', min: 1, max: 1, probability: 0.35 },
        ],
      },
    ],
    ground: [],
  },
  50010: {
    floorNumber: 50010,
    name: '货梯闸',
    description: '货梯闸的灯还亮着，读卡器等着一张更贵的卡，闸机旁贴着当天的盛宴菜单',
    containers: [
      {
        id: 'counter',
        label: '闸口台',
        x: 320,
        loot: [
          { itemId: 'clean_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
        ],
      },
      {
        id: 'security_safe',
        label: '安保柜',
        x: 640,
        loot: [
          { itemId: 'medkit', min: 1, max: 1, probability: 0.55 },
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
  // ── 阶层 6：统治核心（100000，单层终局）────────────────────────────────────
  // 全塔最后一段，也是唯一一段只有一层（segments.ts 第 6 段 100000-100000）。
  // 玩家到这里不是来打怪的，是来做选择的（quests.ts Q6「同一支笔」的四个
  // 结局）——容器因此只有三件，一件一幕：
  //   终端台 核心终端所在，Q6 的抉择发生地，权限在这里交付；
  //   配电箱 shutdown 要关掉的就是它——塔的电源总闸在这一层；
  //   档案柜 停电表、配给表、处决名单，同一支笔写的三张表（纸条 T6-2）。
  // 容器 id 仍复用既有贴图（counter/fuse_box/security_safe，没有新美术），
  // 差异化全在文案与摆放。
  //
  // 生存规矩与前五段一致，且是最硬的一条：恰好 1 份 guaranteed 净水 + 1 份
  // guaranteed 口粮，都摆在终端台上——统治核心从来不执行配给表，它只签文件
  // （纸条 T6-2），所以核心自己的补给是满的。worldgen 的 survival contract
  // 全塔扫描按每层一瓶水记账，多一瓶水（哪怕是概率掉落的）都会踩穿上限。
  // 物资是六段里最「核心」的：配电箱里的 fuse/wire 正是 core_key 的配方
  // 成本（recipes.ts：保险丝 1 + 电线 2 + 废金属 1）——终局层的箱子里还锁着
  // 造你这把钥匙的材料。遭遇权重见 encounters.ts 的 100000 行：ambush 全塔
  // 最高，但没有 boss——把着终点的是终端，不是怪物。
  100000: {
    floorNumber: 100000,
    name: '统治核心',
    description: '电梯井到底了。终端还通着电，三张表并排摆着：停电表、配给表、处决名单',
    containers: [
      {
        id: 'counter',
        label: '终端台',
        x: 320,
        loot: [
          { itemId: 'clean_water', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'ration_pack', min: 1, max: 1, probability: 1, guaranteed: true },
          { itemId: 'battery', min: 1, max: 2, probability: 0.45 },
        ],
      },
      {
        id: 'fuse_box',
        label: '配电箱',
        x: 640,
        loot: [
          { itemId: 'fuse', min: 1, max: 1, probability: 0.4 },
          { itemId: 'wire', min: 1, max: 2, probability: 0.5 },
        ],
      },
      {
        id: 'security_safe',
        label: '档案柜',
        x: 960,
        loot: [
          { itemId: 'medkit', min: 1, max: 1, probability: 0.5 },
          { itemId: 'filter', min: 1, max: 1, probability: 0.35 },
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

// 开发入口（?devfloor=，见 constants.ts 的 DEV_TEST_FLOORS）保留，但它直达的
// 不再是借用来的第 1 层宿舍：100000 有了自己的终局模板（FLOOR_TEMPLATES 末
// 行），DEV_FLOOR_ALIAS 因此删除。留着 { 100000: 1 } 会让 templateFor 把终局
// 层解析回玩家宿舍，而电梯按 hasFloorContent 说「已接通」——玩家落在宿舍布局
// 上，HUD 写着 100000，正是别名存在期 hasFloorContent 必须绕过它的那个事故。
// 别名只在「终局层借第 1 层充数」的借用期有意义；终局创作后，它是 bug。
export function getFloorTemplate(floorNumber: number): FloorTemplate | undefined {
  return FLOOR_TEMPLATES[floorNumber];
}

// Whether a floor can be built at all. generateFloor throws without a template,
// so anything that moves the player to a floor must ask this first — the freight
// lift in particular: its target is a segment's first floor, and a segment whose
// floors have no templates must read as not-connected even when the pass is in
// hand. Floor 100000 answered false here while it was only a dev alias; the
// authored finale (AG-16) is what turned it true, and with it the last lift.
export function hasFloorContent(floorNumber: number): boolean {
  return FLOOR_TEMPLATES[floorNumber] !== undefined;
}

export function generateFloor(worldSeed: number, floorNumber: number): GeneratedFloor {
  const template = getFloorTemplate(floorNumber);
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
