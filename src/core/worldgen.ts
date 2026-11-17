// WorldGen — 十万层的「如果被探索，会长什么样」。
//
// 塔有 100000 层，已创作的只有 54 层（1-10 / 100-110 / 1000-1010 /
// 10000-10010 / 50000-50010，见 segments.ts 的 PLAYABLE_SEGMENTS）。剩下的
// 楼层不是不存在，只是没有被手写：GAME_DESIGN_LOCK.md §3 要求「未探索区域用
// 紧凑聚合状态 + 程序化模板 + 可复现种子按需生成」，本文件就是这条要求的实现。
//
// 三条界线先划清楚：
//
//   1. 结构量没有种子。阶层、物资/威胁曲线、环境与遭遇梯度都是楼层号的纯函数
//      （同 tower.ts 的 describeFloor：一个楼层在层级里的位置不会两次访问给出
//      两个答案）。种子只决定「这一层里的箱子怎么摆、掉什么」。
//   2. 已创作楼层委托，不重写。有模板的楼层一律走 floorTemplates.generateFloor
//      （它对没有模板的楼层会 throw），本文件的合成器只接管未探索楼层。
//   3. 纯函数，零框架。本文件不 import Phaser、不读全局状态、不碰存档；任意
//      (worldSeed, floorNumber) 在任意时刻给出同一个答案——可复现性的底线。
import {
  environmentFor,
  floorKeepClearXs,
  floorWidthFor,
  roomCountFor,
  upExitXFor,
  downExitXFor,
  pickSeededXInBand,
  FLOOR_GEO_SEED_TAG,
  FLOOR_GEOMETRY_BALANCE,
} from './constants';
import type { FloorEnvironment } from './constants';
import type { GeneratedContainer, GeneratedFloor, GroundItem, InventoryStack, ItemId } from './gameTypes';
import { generateFloor, getFloorTemplate, groundItemKey, hasFloorContent } from '../data/floorTemplates';
import { deriveSeed, makeRng } from './rng';
import type { Rng } from './rng';
import type { PlayableSegment } from './segments';
import { nextSegment, segmentOf, skippedFloors } from './segments';
import type { Tier } from './tower';
import { TIERS, TOTAL_FLOORS, tierOf } from './tower';

// A generated world is identified by (WORLDGEN_DATA_VERSION, worldSeed), the same
// contract floorTemplates' LOOT_DATA_VERSION makes for the authored half: bump
// this when the tier tables below change, so a tuned table produces a
// deliberately different world instead of silently reshuffling an existing one.
// Deliberately a separate constant: retuning the authored templates must not
// rewrite the unexplored half of the tower, and the other way round.
export const WORLDGEN_DATA_VERSION = 1;

function assertFloor(floor: number): void {
  if (!Number.isInteger(floor) || floor < 1 || floor > TOTAL_FLOORS) {
    throw new Error(`floor ${floor} is outside the tower (1..${TOTAL_FLOORS})`);
  }
}

// ── 梯度曲线：物资与威胁 ─────────────────────────────────────────────────────
// 两条单调曲线，锚定在 tower.ts 的 TIERS 表上（resourceLevel 1..5、
// dangerLevel 0..5），阶层内按楼层号线性增长，到段顶恰好涨到下一阶层的基面，
// 所以整条曲线连续且单调。断点就是六个阶层的边界：
//
//   99/100 · 999/1000 · 9999/10000 · 49999/50000 · 89999/90000
//
// 在这些楼层上斜率发生变化（阶层 4→5 之间 40000 层才涨一级，阶层 1→2 之间
// 99 层就涨一级——曲线故意不均匀，因为阶层的大小本来就不均匀）。
//
// 返回 0 基连续值（0..4）；整数档 = Math.floor(level) + 1，恒等于 TIERS 表里
// 该阶层的 resourceLevel / dangerLevel（测试钉住这一点）。
export function supplyLevel(floor: number): number {
  const tier = tierOf(floor); // 越界楼层在这里抛
  const next = tier.id < TIERS.length ? TIERS[tier.id] : undefined;
  const size = tier.maxFloor - tier.minFloor + 1;
  const share = (floor - tier.minFloor) / size; // [0, 1)
  const from = tier.resourceLevel - 1;
  const to = next ? next.resourceLevel - 1 : from;
  return from + share * (to - from);
}

export function threatLevel(floor: number): number {
  const tier = tierOf(floor);
  const next = tier.id < TIERS.length ? TIERS[tier.id] : undefined;
  const size = tier.maxFloor - tier.minFloor + 1;
  const share = (floor - tier.minFloor) / size;
  const from = tier.dangerLevel - 1;
  const to = next ? next.dangerLevel - 1 : from;
  return from + share * (to - from);
}

/** 整数物资档 1..5（1 = 最匮乏），恒等于所属阶层的 resourceLevel。 */
export function supplyGrade(floor: number): number {
  return Math.floor(supplyLevel(floor)) + 1;
}

/** 整数威胁档 0..5（0 = 安全），恒等于所属阶层的 dangerLevel。 */
export function threatGrade(floor: number): number {
  return Math.floor(threatLevel(floor)) + 1;
}

const THREAT_LABELS: readonly string[] = ['无威胁', '低', '中', '高', '极高', '致命'];

// ── 环境梯度 ─────────────────────────────────────────────────────────────────
// constants.ts 的 SEGMENT_ENVIRONMENT 只写到 50000（第五段段首），而且它的
// environmentFor 对表外楼层回落到「下方最近的已创作楼层」——运行时够用，但不是
// 一条曲线。这里的锚点与 SEGMENT_ENVIRONMENT 逐值一致（1/100/1000/10000/
// 50000），90000 一档是 worldgen 对阶层 6 的外推（constants.ts 没有定义它的
// 环境）：统治核心暖气停得最早、最干燥、危险度封顶 1.0。
//
// environmentFor 若要复用它：把表外分支改成调用 environmentProfile，已创作的
// 1-5 层保留精确层覆盖（宿舍是安全的，这一条不能被曲线抹掉）。
const ENVIRONMENT_ANCHORS: readonly { floor: number; env: Omit<FloorEnvironment, 'label'> }[] = [
  { floor: 1, env: { cold: 1.2, humidity: 0.35, danger: 0.45, hostile: true } },
  { floor: 100, env: { cold: 1.4, humidity: 0.3, danger: 0.5, hostile: true } },
  { floor: 1000, env: { cold: 2.6, humidity: 0.5, danger: 0.85, hostile: true } },
  { floor: 10000, env: { cold: 2.8, humidity: 0.45, danger: 0.95, hostile: true } },
  { floor: 50000, env: { cold: 3.0, humidity: 0.4, danger: 0.98, hostile: true } },
  { floor: 90000, env: { cold: 3.4, humidity: 0.35, danger: 1.0, hostile: true } },
];

/**
 * 环境参数的曲线版：段首锚点之间按楼层号线性插值，danger 全塔单调非递减
 * （0.45 → 1.0）。humidity 故意不单调——工业区比宿舍区潮（管道井），中产区
 * 起又变干（中央空调与地毯），这是 constants.ts 已经写定的读数，不是疏漏。
 *
 * label 取 tower.ts 的阶层名：楼层属于哪个阶层是结构量，不随插值变。
 */
export function environmentProfile(floor: number): FloorEnvironment {
  assertFloor(floor);
  // 默认 lo = hi = 最后一个锚点：高于最高锚点的楼层（90000 以上）饱和在塔顶
  // 读数上，而不是回退到首锚——那会让 danger 溢出 1.0。
  let lo = ENVIRONMENT_ANCHORS[ENVIRONMENT_ANCHORS.length - 1];
  let hi = lo;
  for (let i = 0; i < ENVIRONMENT_ANCHORS.length - 1; i++) {
    if (floor >= ENVIRONMENT_ANCHORS[i].floor && floor <= ENVIRONMENT_ANCHORS[i + 1].floor) {
      lo = ENVIRONMENT_ANCHORS[i];
      hi = ENVIRONMENT_ANCHORS[i + 1];
      break;
    }
  }
  const span = hi.floor - lo.floor;
  const t = span === 0 ? 0 : (floor - lo.floor) / span;
  const mix = (a: number, b: number): number => Math.round((a + (b - a) * t) * 1000) / 1000;
  return {
    label: tierOf(floor).name,
    cold: mix(lo.env.cold, hi.env.cold),
    humidity: mix(lo.env.humidity, hi.env.humidity),
    danger: mix(lo.env.danger, hi.env.danger),
    hostile: hi.env.hostile,
  };
}

// ── 遭遇权重梯度 ─────────────────────────────────────────────────────────────
// encounters.ts 的 FLOOR_WEIGHT_PROFILE 是一张 54 行的手写表，段外楼层回落到
// 最深楼层。这里给出同一条设计读数的曲线版：锚点取该表五个段首的值
// （1/100/1000/10000/50000），100000 一档外推（段顶的读数继续上行）。
//
// 单调性只承诺两条轴：ambush 全塔单调非递减（4 → 110），loot 全塔单调不增
// （60 → 2）——这正是该表注释里「层数越高，ambush+cache 合计占比越大、普通
// loot 占比越小」的总体趋势。trader/cache/note 不承诺单调：商人权重在阶层 4
// 达到峰值（商铺街），这是设计明确的阶层性格，不是噪声。
//
// boss 是另一套逻辑：只在三个守段者楼层（5 / 110 / 50010，见
// encounterTableCoverage 的 BOSS_FLOORS）非零，权重取该表原值。已创作楼层
// 的手写表仍然是运行时权威（它在 boss 楼层会把 ambush 压低让守段者成为最
// 常见的遭遇）；本曲线是「无 boss 基线 + 守段者叠加」，供遭遇表重构时复用。
export interface EncounterProfile {
  loot: number;
  ambush: number;
  trader: number;
  note: number;
  cache: number;
  boss: number;
}

const ENCOUNTER_ANCHORS: readonly { floor: number; weights: Omit<EncounterProfile, 'boss'> }[] = [
  { floor: 1, weights: { loot: 60, ambush: 4, trader: 12, note: 14, cache: 10 } },
  { floor: 100, weights: { loot: 20, ambush: 46, trader: 6, note: 4, cache: 24 } },
  { floor: 1000, weights: { loot: 12, ambush: 66, trader: 12, note: 3, cache: 17 } },
  { floor: 10000, weights: { loot: 7, ambush: 82, trader: 15, note: 2, cache: 16 } },
  { floor: 50000, weights: { loot: 4, ambush: 94, trader: 11, note: 2, cache: 18 } },
  { floor: 100000, weights: { loot: 2, ambush: 110, trader: 6, note: 1, cache: 22 } },
];

const GATEKEEPER_BOSS_WEIGHTS: Readonly<Record<number, number>> = { 5: 24, 110: 32, 50010: 108 };

export function encounterProfile(floor: number): EncounterProfile {
  assertFloor(floor);
  // 同 environmentProfile：高于最高锚点的楼层饱和在塔顶读数上。
  let lo = ENCOUNTER_ANCHORS[ENCOUNTER_ANCHORS.length - 1];
  let hi = lo;
  for (let i = 0; i < ENCOUNTER_ANCHORS.length - 1; i++) {
    if (floor >= ENCOUNTER_ANCHORS[i].floor && floor <= ENCOUNTER_ANCHORS[i + 1].floor) {
      lo = ENCOUNTER_ANCHORS[i];
      hi = ENCOUNTER_ANCHORS[i + 1];
      break;
    }
  }
  const span = hi.floor - lo.floor;
  const t = span === 0 ? 0 : (floor - lo.floor) / span;
  // 权重按整数滚（encounters.ts 的 rollWeighted 用整数扣减），四舍五入不破坏
  // 单调性：a <= b 必有 round(a) <= round(b)。
  const mix = (a: number, b: number): number => Math.round(a + (b - a) * t);
  return {
    loot: mix(lo.weights.loot, hi.weights.loot),
    ambush: mix(lo.weights.ambush, hi.weights.ambush),
    trader: mix(lo.weights.trader, hi.weights.trader),
    note: mix(lo.weights.note, hi.weights.note),
    cache: mix(lo.weights.cache, hi.weights.cache),
    boss: GATEKEEPER_BOSS_WEIGHTS[floor] ?? 0,
  };
}

// ── 区段摘要：未探索楼层的紧凑状态 ───────────────────────────────────────────
// 「一段楼层有多少容器、什么物资梯度、什么威胁等级」的确定性答案。已创作楼层
// 的摘要直接读模板（容器数、容器 id、物资池都是既成事实），未探索楼层由种子
// 在阶层池里抽——所以摘要同时服务两种 UI：总览里 authored 与未探索楼层长着
// 同一张脸。
export interface FloorSummary {
  floor: number;
  /** 所属阶层（tower.ts 的结构量，无种子变化） */
  tier: Tier;
  /** 所在可玩段；未探索楼层为 null */
  segment: PlayableSegment | null;
  /** 是否有手写模板（决定电梯是否接通，见 segments.ts 的 liftOutcome） */
  authored: boolean;
  /** 物资曲线值 0..4 */
  supplyLevel: number;
  /** 威胁曲线值 0..4 */
  threatLevel: number;
  /** 整数物资档 1..5 */
  supplyGrade: number;
  /** 整数威胁档 0..5 */
  threatGrade: number;
  /** 威胁档的中文标签 */
  threatLabel: string;
  /** environmentFor 的运行时答案（未探索层回落到下方最近的已创作层） */
  environment: FloorEnvironment;
  /** 容器数量：模板楼层读模板，未探索楼层 2..5 由种子抽 */
  containerCount: number;
  /** 容器 id（全部有贴图，见 render/furniture.ts） */
  containerIds: string[];
  /** 该层的物资池：模板楼层读模板，未探索楼层取阶层材料池 */
  lootPool: ItemId[];
}

// 阶层容器池：id 必须落在 containerTextureKey 认得的家具上（没有新美术），
// 未探索楼层因此复用手写段用过的同一批道具，差异化靠 label 文案与摆放。
const CONTAINER_POOLS: Record<number, readonly string[]> = {
  1: ['cabinet', 'shelf', 'crate_wood', 'crate_metal', 'water_tank', 'fuse_box', 'counter', 'bed', 'workbench'],
  2: [
    'cabinet', 'shelf', 'crate_wood', 'crate_metal', 'water_tank', 'fuse_box', 'counter', 'bed', 'workbench',
    'badge_rack', 'bunk_bed', 'meal_counter', 'shift_locker', 'worker_locker', 'ration_dispenser',
    'wash_sink', 'uniform_rack', 'tool_cage', 'thermos_rack', 'key_board', 'security_safe',
  ],
  3: ['cabinet', 'shelf', 'crate_wood', 'crate_metal', 'water_tank', 'fuse_box', 'counter', 'workbench', 'security_safe', 'tool_cage', 'key_board'],
  4: ['cabinet', 'shelf', 'crate_metal', 'counter', 'workbench', 'bed', 'wash_sink', 'security_safe', 'key_board'],
  5: ['cabinet', 'shelf', 'crate_metal', 'counter', 'workbench', 'bed', 'wash_sink', 'security_safe', 'bunk_bed'],
  6: ['cabinet', 'shelf', 'crate_metal', 'counter', 'workbench', 'fuse_box', 'bed', 'security_safe', 'key_board'],
};

// label 控制在 2-3 字：一层最多 5 个容器，名字一长就直接压到隔壁容器的标题上
// （floorTemplates.ts 顶部记着第 6 层首版的叠字事故）。
const CONTAINER_LABELS: Record<string, readonly string[]> = {
  cabinet: ['柜子', '储物柜', '铁皮柜'],
  shelf: ['货架', '木架', '层架'],
  crate_wood: ['木箱', '板条箱', '货箱'],
  crate_metal: ['铁箱', '装备箱', '货运箱'],
  fuse_box: ['电箱', '配电箱', '断电器'],
  water_tank: ['水罐', '储水罐', '水箱'],
  counter: ['柜台', '餐台', '登记台'],
  workbench: ['工作台', '操作台', '抢修台'],
  bed: ['床铺', '空床', '铺位'],
  badge_rack: ['牌架', '工牌架', '编号架'],
  bunk_bed: ['双层床', '上下铺', '空铺'],
  meal_counter: ['餐台', '配给台', '打饭台'],
  shift_locker: ['班次柜', '更衣柜', '值班柜'],
  worker_locker: ['铁皮柜', '私物柜', '储物柜'],
  ration_dispenser: ['配给箱', '口粮箱', '发放机'],
  wash_sink: ['洗漱台', '水槽', '洗手台'],
  uniform_rack: ['毛巾架', '衣物架', '更衣架'],
  tool_cage: ['工具架', '工具箱', '零件架'],
  thermos_rack: ['汤桶', '保温架', '热水架'],
  key_board: ['钥匙架', '牌架', '挂板'],
  security_safe: ['保险柜', '安保柜', '档案柜'],
};

// 阶层材料池：与 encounters.ts 的 FLOOR_LOOT_POOLS 同读数，按阶层取段级池。
// 刻意不含水与食物——那两样由每层保底发放（见 synthesizeUnexploredFloor），
// 混进概率池会让「一层两瓶水」踩穿 survivalBalance 的每层水量上限。
const MATERIAL_POOLS: Record<number, readonly ItemId[]> = {
  1: ['cloth', 'tape', 'scrap_metal', 'wood', 'battery', 'wire', 'crowbar'],
  2: ['cloth', 'tape', 'battery', 'scrap_metal', 'wire', 'filter'],
  3: ['battery', 'wire', 'fuse', 'filter', 'scrap_metal'],
  4: ['filter', 'medkit', 'fuse', 'battery', 'wire', 'scrap_metal'],
  5: ['medkit', 'filter', 'fuse', 'battery', 'wire'],
  6: ['medkit', 'filter', 'fuse', 'battery', 'wire', 'crowbar'],
};

// 阶内分层（AG-43，docs/plans/LOOT.md）：MATERIAL_POOLS 按阶层取池，答的是阶
// 「间」的梯度——11 层和 99 层抽的是同一个池子，阶内是平的。本函数把阶「内」的
// 梯度补上：楼层越过所属阶层的中点后，池子并入上一阶层的池子（贫民区上半段开始
// 出滤芯，宿舍区上半段开始出保险丝，工业区上半段开始出医疗包，富人区深处重新
// 出撬棍），与 supplyLevel「阶层内线性增长、到段顶恰好涨到下一阶层基面」是同
// 一条读数的阶梯近似。 tier 4 的上一阶层池是它的子集（富人区不拆实验设备，池
// 里没有新件），所以中产区上半段保持不变——这是数据事实，不是疏漏。
// 只改池子内容、不加 RNG 抽取： WORLDGEN_DATA_VERSION 被 worldgen.test.ts 钉在
// 1，本分支不改他人的测试，故不 bump（LOOT.md §5 记录在案）。
function materialPoolFor(floor: number): readonly ItemId[] {
  const tier = tierOf(floor);
  const base = MATERIAL_POOLS[tier.id];
  const next = tier.id < TIERS.length ? TIERS[tier.id] : undefined;
  if (!next) return base;
  const size = tier.maxFloor - tier.minFloor + 1;
  const share = (floor - tier.minFloor) / size;
  if (share < 0.5) return base;
  const merged: ItemId[] = [...base];
  for (const id of MATERIAL_POOLS[next.id]) {
    if (!merged.includes(id)) merged.push(id);
  }
  return merged;
}

// 保底物资的品类随阶层切换，读的是手写段已经立好的规矩：阶层 4 起水管没断
// （10000-10010 只有机房与实验室两层还流脏水），阶层 3 起口粮替代面包。
const CLEAN_WATER_FROM_TIER = 4;
const RATION_FROM_TIER = 3;

// 未探索楼层的名字池：每阶层五条， seeded 选取。名字只描述房间性质，不描述
// 具体楼层号——楼层号由 UI 显示，名字是「这一层是什么地方」。
const FLOOR_NAME_POOLS: Record<number, readonly string[]> = {
  1: ['废弃走廊', '封死的房间', '漏水的储藏间', '黑暗的楼梯间', '被搜过的角落'],
  2: ['无人宿舍', '空荡的走廊', '停班的配给处', '锁着的更衣室', '积灰的值班室'],
  3: ['封锁的车间', '停转的管道层', '军械库死角', '漆黑的货运通道', '断电的检查站'],
  4: ['空置的写字间', '停业的商铺', '积灰的公寓', '黑掉的监控室', '锁闭的样品间'],
  5: ['空荡的宴厅', '停摆的机房', '封闭的冷藏库', '无人的贵宾室', '停用的实验室'],
  6: ['核心走廊', '封存的指挥间', '停转的服务器室', '尘封的权限室', '寂静的中枢'],
};

// 容器数量与摆放位置。2..5 对所有阶层一致：容器多少不是阶层差，阶层差在
// 物资池的品质（encounters.ts 的遭遇池已经表达了同一件事）。
const CONTAINER_MIN = 2;
const CONTAINER_MAX = 5;
// 五个等距摆放点，撒在 1280px 楼面（FLOOR_WIDTH）上，落在手写模板用过的
// 160..1160 区间内。洗牌后取前 count 个，互不重叠。
const CONTAINER_POSITIONS: readonly number[] = [200, 440, 680, 920, 1160];
// 每容器两次材料 roll、35% 一层一件地面物资。概率都 < 1，所以种子差异必然
// 在内容里显形——「不同 seed 有差异」不是许愿，是算术。
const MATERIAL_ROLLS = 2;
const MATERIAL_CHANCE = 0.5;
const GROUND_CHANCE = 0.35;

function pickDistinct<T>(rng: Rng, pool: readonly T[], count: number): T[] {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i);
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy.slice(0, count);
}

interface UnexploredPlan {
  count: number;
  ids: string[];
  xs: number[];
  labels: string[];
}

// 一个未探索楼层的摆放计划：容器数、容器 id、x 坐标、label。摘要与内容生成
// 共用这一个函数，所以「摘要说的几个箱子」与「真生成出来的几个箱子」永远
// 是同一批。
function planUnexploredFloor(worldSeed: number, floor: number): UnexploredPlan {
  const tier = tierOf(floor);
  const rng = makeRng(deriveSeed(WORLDGEN_DATA_VERSION, 'worldgen:plan', worldSeed, floor));
  const count = rng.nextInt(CONTAINER_MIN, CONTAINER_MAX);
  const ids = pickDistinct(rng, CONTAINER_POOLS[tier.id], count);
  const xs = pickDistinct(rng, CONTAINER_POSITIONS, count);
  const labels = ids.map((id) => CONTAINER_LABELS[id][rng.nextInt(0, CONTAINER_LABELS[id].length - 1)]);
  return { count, ids, xs, labels };
}

function unexploredFloorName(worldSeed: number, floor: number, tier: Tier): string {
  const rng = makeRng(deriveSeed(WORLDGEN_DATA_VERSION, 'worldgen:name', worldSeed, floor));
  const pool = FLOOR_NAME_POOLS[tier.id];
  return pool[rng.nextInt(0, pool.length - 1)];
}

export function summarizeFloor(worldSeed: number, floor: number): FloorSummary {
  const tier = tierOf(floor); // 越界楼层在这里抛
  const segment = segmentOf(floor) ?? null;
  const authored = hasFloorContent(floor);
  const template = authored ? getFloorTemplate(floor) : undefined;

  let containerCount: number;
  let containerIds: string[];
  let lootPool: ItemId[];
  if (template) {
    containerCount = template.containers.length;
    containerIds = template.containers.map((c) => c.id);
    const pool: ItemId[] = [];
    const push = (id: ItemId): void => {
      if (!pool.includes(id)) pool.push(id);
    };
    for (const c of template.containers) for (const l of c.loot) push(l.itemId);
    for (const g of template.ground) push(g.itemId);
    lootPool = pool;
  } else {
    const plan = planUnexploredFloor(worldSeed, floor);
    containerCount = plan.count;
    containerIds = [...plan.ids];
    lootPool = [...materialPoolFor(floor)];
  }

  const grade = threatGrade(floor);
  return {
    floor,
    tier,
    segment,
    authored,
    supplyLevel: supplyLevel(floor),
    threatLevel: threatLevel(floor),
    supplyGrade: supplyGrade(floor),
    threatGrade: grade,
    threatLabel: THREAT_LABELS[grade],
    environment: environmentFor(floor),
    containerCount,
    containerIds,
    lootPool,
  };
}

// ── 确定性楼层生成 ───────────────────────────────────────────────────────────
// 任意楼层号都能问出「这一层如果被探索，长什么样」。有模板的楼层委托给
// floorTemplates.generateFloor（已创作内容永远是权威，本文件不重写它）；没有
// 模板的楼层——包括 11-99、111-999 这些段间空白，也包括终于不再借用第 1 层
// 宿舍的 100000——由合成器按阶层池生成。
//
// 这就是「不要真去 generateFloor 那些没有模板的楼层」的答案：调用方改用本
// 函数，模板分支与合成分支对它是同一条入口。
export function generateFloorContent(worldSeed: number, floorNumber: number): GeneratedFloor {
  assertFloor(floorNumber);
  if (hasFloorContent(floorNumber)) return generateFloor(worldSeed, floorNumber);
  return synthesizeUnexploredFloor(worldSeed, floorNumber);
}

function synthesizeUnexploredFloor(worldSeed: number, floor: number): GeneratedFloor {
  const tier = tierOf(floor);
  const plan = planUnexploredFloor(worldSeed, floor);
  const rng = makeRng(deriveSeed(WORLDGEN_DATA_VERSION, 'worldgen:loot', worldSeed, floor));

  const water: ItemId = tier.id >= CLEAN_WATER_FROM_TIER ? 'clean_water' : 'dirty_water';
  const food: ItemId = tier.id >= RATION_FROM_TIER ? 'ration_pack' : 'bread';
  const pool = materialPoolFor(floor);

  const containers: GeneratedContainer[] = plan.ids.map((id, i) => {
    const items: InventoryStack[] = [];
    // 生存规矩，与手写段逐字相同：整层恰好一份 guaranteed 水、一份 guaranteed
    // 食物。没水的楼层是逼玩家渴死，不是难度（floorTemplates.ts 6-10 层注释
    // 立下的规矩）；而概率化的水会踩穿 survivalBalance 的每层水量上限，所以
    // 保底两份都是钉死的，材料池里干脆没有水与食物。
    if (i === 0) items.push({ itemId: water, quantity: 1 });
    if (i === 1) items.push({ itemId: food, quantity: 1 });
    const seen = new Set<ItemId>();
    for (let roll = 0; roll < MATERIAL_ROLLS; roll++) {
      // 前两个容器有保底的水与口粮；第三个起的容器至少保证一件材料——两次
      // roll 都落空会开出什么都没有的空容器，那是死互动，不是难度。
      const force = i >= CONTAINER_MIN && roll === 0;
      if (!force && !rng.chance(MATERIAL_CHANCE)) continue;
      const itemId = pool[rng.nextInt(0, pool.length - 1)];
      if (seen.has(itemId)) continue; // 同一容器不堆两件一样的物资
      seen.add(itemId);
      items.push({ itemId, quantity: rng.nextInt(1, 2) });
    }
    return { id, label: plan.labels[i], x: plan.xs[i], items };
  });

  const groundItems: GroundItem[] = [];
  if (rng.chance(GROUND_CHANCE)) {
    const itemId = pool[rng.nextInt(0, pool.length - 1)];
    // 地面物资只放楼面两端，避开 200..1160 的容器带。
    const x = rng.chance(0.5) ? 160 : 1120;
    groundItems.push({ key: groundItemKey(itemId, x), itemId, quantity: 1, x });
  }

  return {
    floorNumber: floor,
    name: unexploredFloorName(worldSeed, floor, tier),
    containers,
    groundItems,
  };
}

// ── AG-65：楼层几何（长度/梯口/洞/中梯的 seeded 派生）────────────────────────
// 用户 2026-11-17 原话：「其实每一层宽度长度都不一样，不能一样，有的长知道不」
// 「梯子的位置也不是说一定是起点和终点」「每一层都不要做的那么平滑，可以在中间
// 加个梯子啥的，或者楼上面有个洞可以看到上面一层的情况，不过这个是比较少的」。
//
// 一个楼层的全部几何量都是楼层号的纯函数（全部走 core/rng.ts 的 seeded RNG，不用全局随机源，见
// core/rng.ts）：同一层每次进都是同一个答案——玩家爬上去再爬回来，梯子、洞、
// 中梯都在原地，因此不需要进存档，也没有旧存档兼容问题。低层读数（房间数/层宽/
// 上下梯口）在 constants.ts（floorWidthFor/roomCountFor/downExitXFor），本文件只
// 做聚合与洞/中梯的抽取，供 GameScene 绘制与 e2e 实测读取。
export interface FloorGeometry {
  floor: number;
  /** 楼层物理长度（px）。tier1 一档 1280；tier2+ 同阶层内每层不同 */
  width: number;
  /** 房间数（层长的房间口径，drawCorridor 的房间循环按它走） */
  rooms: number;
  /** 上行梯口 x。恒为 UP_EXIT_X(40)——floorSystem.test.ts 把 40 钉成每层的
   *  上楼梯口，属主测试不许动；随机化由下行口与中梯承担 */
  upX: number;
  /** 下行梯口 x。tier1 在右端（现值）；tier2+ 在本层中段 seeded 随机，避开
   *  容器/地面物资/床铺/上梯口/电梯（玩家按 E 爬的是梯不是箱子） */
  downX: number;
  /** 楼板洞 x（天花板上的透光方框，站立态只透光、爬梯态透出目标层地板）。
   *  null = 本层没有洞（少见：15%） */
  holeX: number | null;
  /** 中梯 x（层内装饰短梯，不是上下交通梯，不可交互）。null = 本层没有（15%） */
  midLadderX: number | null;
}

/** 洞与中梯的取值带：楼层中段（25%..75%），刻意不在两端。 */
const FEATURE_BAND_LOW_PCT = 0.25;
const FEATURE_BAND_HIGH_PCT = 0.75;

/**
 * 本层是否开楼板洞、开在哪。seeded：同层同答案。避开两个交通梯口
 * （洞正压在梯口上会同时挡住爬梯落点）。
 */
export function floorHoleFor(floor: number): number | null {
  const width = floorWidthFor(floor);
  const rng = makeRng(deriveSeed(FLOOR_GEO_SEED_TAG, 'hole', floor));
  if (!rng.chance(FLOOR_GEOMETRY_BALANCE.holeChance)) return null;
  return pickSeededXInBand(
    deriveSeed(FLOOR_GEO_SEED_TAG, 'holeX', floor),
    Math.round(width * FEATURE_BAND_LOW_PCT),
    Math.round(width * FEATURE_BAND_HIGH_PCT),
    [upExitXFor(floor), downExitXFor(floor)],
    FLOOR_GEOMETRY_BALANCE.holeStairClearPx,
  );
}

/**
 * 本层是否有中梯（层内装饰短梯）、在哪。seeded：同层同答案。避开容器/梯口/
 * 电梯，也避开本层的洞（两个装饰元素不叠在一起）。
 */
export function floorMidLadderFor(floor: number): number | null {
  const width = floorWidthFor(floor);
  const rng = makeRng(deriveSeed(FLOOR_GEO_SEED_TAG, 'midLadder', floor));
  if (!rng.chance(FLOOR_GEOMETRY_BALANCE.midLadderChance)) return null;
  const hole = floorHoleFor(floor);
  const clears = [downExitXFor(floor), ...floorKeepClearXs(floor), ...(hole !== null ? [hole] : [])];
  return pickSeededXInBand(
    deriveSeed(FLOOR_GEO_SEED_TAG, 'midLadderX', floor),
    Math.round(width * FEATURE_BAND_LOW_PCT),
    Math.round(width * FEATURE_BAND_HIGH_PCT),
    clears,
    FLOOR_GEOMETRY_BALANCE.midLadderKeepClearPx,
  );
}

/** 一个楼层的全部几何量（层宽/房间数/上下梯口/洞/中梯）。纯函数，同层同答案。 */
export function floorGeometryFor(floor: number): FloorGeometry {
  assertFloor(floor);
  return {
    floor,
    width: floorWidthFor(floor),
    rooms: roomCountFor(floor),
    upX: upExitXFor(floor),
    downX: downExitXFor(floor),
    holeX: floorHoleFor(floor),
    midLadderX: floorMidLadderFor(floor),
  };
}

// ── 电梯的一句话 ─────────────────────────────────────────────────────────────
// segments.ts 的 skippedFloors 已经数得出那 N 层，本函数把它概括成 UI 能直接
// 显示的一句话：「穿过 89 层：底层贫民区的废弃段」。阶层名取被穿过楼层真实
// 所属的阶层（11-99 属阶层 1，不是抵达的工人宿舍区），一句话的措辞取跨越
// 区间里最低那个阶层的措辞——你从哪一段封存的空间里穿出来，那句话就是哪一
// 段的语气。
export interface CrossingSummary {
  /** 出发层（段顶，向上的货梯所在层） */
  from: number;
  /** 到达层（下一段首层） */
  target: number;
  /** 被穿过的未探索楼层数，与 segments.skippedFloors 一致 */
  skipped: number;
  /** 被穿过的楼层区间 [from+1, target-1] */
  span: { from: number; to: number };
  /** 跨越的阶层名，从低到高（跨两段阶层时有两个） */
  tierNames: string[];
  /** 一句话概括 */
  text: string;
}

const CROSSING_PHRASES: Record<number, string> = {
  1: '废弃段', // 贫民区被搜过的顶层
  2: '无人段', // 宿舍区停班的九百里
  3: '封锁段', // 工业区军管下的断层
  4: '门禁段', // 商业区许可证管着的四万层
  5: '封存段', // 富人区养着东西的楼上
  6: '禁区段', // 统治核心本身
};

/** 段顶电梯的一句话概括；没有向上的电梯（非段顶、塔顶）时返回 null。 */
export function crossingSummary(from: number): CrossingSummary | null {
  const here = segmentOf(from);
  if (!here || here.to !== from) return null;
  const next = nextSegment(from);
  if (!next) return null;
  const skipped = skippedFloors(from);
  if (skipped <= 0) return null;
  const spanFrom = from + 1;
  const spanTo = next.from - 1;
  const tiers = TIERS.filter((t) => t.minFloor <= spanTo && t.maxFloor >= spanFrom);
  if (tiers.length === 0) return null;
  const tierNames = tiers.map((t) => t.name);
  const text = `穿过 ${skipped} 层：${tierNames.join('与')}的${CROSSING_PHRASES[tiers[0].id]}`;
  return { from, target: next.from, skipped, span: { from: spanFrom, to: spanTo }, tierNames, text };
}
