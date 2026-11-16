import { GAME_CONFIG } from './config';
import { segmentOf } from './segments';
import { FLOOR_TEMPLATES } from '../data/floorTemplates';

// Save protocol constants (docs/02_TECH_SPEC.md §6).
// v2: GHI-03 M1/M2 changed the loot key format and the seed derivation, so a v1
// save's "already looted" markers match nothing — accepting it would silently
// respawn loot and roll fresh container contents. SAVE_KEY deliberately stays
// put: a stable slot means an old save is still found and listed in the menu,
// then refused with a readable reason instead of being silently orphaned.
export const SCHEMA_VERSION = 2;
export const SAVE_KEY = 'floor100000.save.v1';

// Derived from config/game-balance.json rather than hand-copied, so editing the
// JSON cannot leave the code on a stale floor list (GHI-03 m7).
export const STARTING_FLOOR = GAME_CONFIG.player.startingFloor;
// The authored floors, read from the balance config: tier 1 (1-10), the
// worker-dorm tier (100-110), the industrial tier (1000-1010), the
// commercial tier (10000-10010) and the VIP tier (50000-50010). The list is
// NOT contiguous — 11-99, 111-999, 1011-9999 and 10011-49999 are unexplored,
// and only the freight lift crosses a gap (see core/segments.ts).
export const PLAYABLE_FLOORS_V01: readonly number[] = GAME_CONFIG.world.playableFloorsV01;

// Dev-only: the retired v0.1 dorm scene, kept for testing. Reachable only via
// the ?devfloor= query parameter, never as a normal spawn point.
export const DEV_TEST_FLOORS: readonly number[] = [100000];

// A game day runs 06:00 -> next 06:00. 360 = 06:00, 1200 = 20:00.
export const MINUTES_PER_DAY = 1440;
export const DAY_START_MINUTE = 360;
export const NIGHT_RISK_START_MINUTE = 1200;

// Floor geometry for v0.1 (docs/01_GDD.md §4: 4 fixed-width room modules, 16px
// tiles). One floor is wider than the 640px viewport, so the camera scrolls.
//
// The floor band is 64px, up from 48. The wall and floor are single 1280px-wide
// art images rather than 16x16 tiles, and 48px was too short a strip for the
// drawn concrete to read — the wall band is what shrank to pay for it.
export const FLOOR_WIDTH = 1280; // 4 rooms x 320px

// ── 塔楼剖面 ────────────────────────────────────────────────────────────────
// The floor used to be 360 tall because one floor filled the whole 16:9 view.
// It is now 200: the tower shows three to four floors stacked at once, and at
// 360 the view can only ever hold two of them no matter the zoom, because the
// view is 16:9 and one floor is 1280x352 — far wider than it is tall.
//
// 200 is not arbitrary. The view is 640x360, so the zoom that fits one floor's
// width (0.5) shows 720 world px of height, which is 3.6 floors. The wall band
// is 136, which is more than the 96px character with room to spare under the
// ceiling, so nobody's head pokes into the floor above. tools/build-env.mjs
// regenerates the wall and floor art at this height — the old 288px wall cannot
// be cropped to 136 without losing either the conduit run or the skirting.
export const FLOOR_HEIGHT = 200;
export const FLOOR_BAND = 64; // walkable ground band at the bottom
/** how tall the wall band is, derived so the art and the code agree */
export const WALL_HEIGHT = FLOOR_HEIGHT - FLOOR_BAND;

export const ROOM_COUNT = 4;
export const ROOM_WIDTH = FLOOR_WIDTH / ROOM_COUNT;

// ── how long a floor is ────────────────────────────────────────────────────
// Not every floor is the same length. The lower tiers are cramped — four bays,
// you cross them in a few seconds — and the higher ones have room to waste. It
// buys the climb something wallpaper cannot: the floor you arrive on FEELS
// different to walk, and the distance between the stairs is part of the cost of
// going up.
//
// Expressed as rooms, not pixels: every bay stays 320 wide so the corridor
// themes, the container grid and the stair mouths keep their existing maths.
const ROOMS_BY_TIER: Record<number, number> = { 1: 4, 2: 5, 3: 6, 4: 7, 5: 8, 6: 9 };

/** Which tier a floor belongs to, by the tower's own numbering. */
export function tierOfFloor(floor: number): number {
  if (floor >= 100000) return 6;
  if (floor >= 50000) return 5;
  if (floor >= 10000) return 4;
  if (floor >= 1000) return 3;
  if (floor >= 100) return 2;
  return 1;
}

export function roomCountFor(floor: number): number {
  return ROOMS_BY_TIER[tierOfFloor(floor)] ?? ROOM_COUNT;
}

/** Physical length of a floor, in pixels. */
export function floorWidthFor(floor: number): number {
  return roomCountFor(floor) * ROOM_WIDTH;
}

/** The down stairwell sits at the right end, whatever the floor's length. */
export function downExitXFor(floor: number): number {
  return floorWidthFor(floor) - 40;
}
export const PLAYER_SPEED = 130; // px / second
// Where the player's feet sit. The props are bottom-aligned further back in the
// band so the player reads as standing in front of them; this is that offset.
export const PLAYER_FEET_Y = FLOOR_HEIGHT - 40;
// One shared stair geometry contract. The player feet, visible treads and
// neighbouring-floor landing all use these values so the character never
// appears to float above or sink below the drawn flight.
export const STAIR_START_Y = PLAYER_FEET_Y;
export const STAIR_RISE = FLOOR_HEIGHT;

// The camera zoom. It is 1, and it must stay 1.
//
// The cross-section's view is 1280x720 world px — one floor's width by 3.6
// floors' height — which is exactly the design canvas at zoom 1, so no scaling
// happens anywhere and the pixel art is exact. It used to be 0.5, back when the
// canvas was 640x360, and a camera zoom resamples the world through the
// renderer's filter: the figure came out as 291 colours from a 15-colour sheet,
// #d9b48f arriving as #cdaa88, and 40% of it inside the wall's camouflage band.
// Raising the design resolution instead of zooming is what removed the resample.
export const FLOOR_VIEW_ZOOM = 1;
// How many floors are drawn around the player: two above, two below, plus the
// player's own. The view is 3.6 floors tall, so one above and one below leaves a
// 120px band of empty black at whichever edge the player is not centred on —
// five floors of content covers the view with margin at any player position.
export const STACK_ABOVE = 2;
export const STACK_BELOW = 2;

// ── 楼层环境 ────────────────────────────────────────────────────────────────
// The tower's five floors used to differ by a wall tint and a prop set, which
// made them five colour schemes rather than five places. The environment model
// gives each floor a temperature, a humidity, a danger rating and a set of
// warmth sources, and body heat is a real stat that responds to them.
//
// This War of Mine's scene loop runs TickTemperature and TickHeaters alongside
// ProcessSleep and ProcessSickness (docs/reference/TWOM_MECHANICS.md §3); ours
// decayed three bars and had no temperature at all. The brazier on floor 5
// already had a 90-frame animation — it was a light, never a heater.
//
//   cold      how fast body heat drains per game hour on this floor
//   humidity  0..1; raises the cold drain and slows the warmth recovery
//   danger    0..1; how likely a floor is to host the night event
//   warmth   0..1（契约第二节）：这一层自身热源能补回的体温比例。**可选且
//            条目不预设值**——逐层数据由 AG-30 经 FloorTemplate.environment
//            微调填入（契约第三节），environmentFor 合并时 template 优先。
//            在 AG-30 落地前，读数走 warmthOf()：它先问 environmentFor 的
//            微调值，再回落 game-balance.json 的 floorWarmth 默认梯。
//            与 WARMTH_SOURCES 的分工：warmth 是楼层级「可取暖程度」，
//            WARMTH_SOURCES 是几何级热源位置与强度；睡眠回温按 warmth 缩放
//            （SurvivalSystem.sleep）。
export interface FloorEnvironment {
  /** the floor's own name, for the HUD line */
  label: string;
  /** body-heat drain per game hour */
  cold: number;
  humidity: number;
  danger: number;
  /** whether this floor can host a wanderer at night */
  hostile: boolean;
  /** 0..1; how much body heat this floor's own heat sources can recover */
  warmth?: number;
}

export const FLOOR_ENVIRONMENT: Record<number, FloorEnvironment> = {
  // warmth 不写在这些条目里：worldgen.test.ts 把 environmentProfile（曲线读数）
  // 与 environmentFor 逐值深比，曲线没有 warmth 轴；契约第二节也把 warmth 定为
  // 可选、由 AG-30 逐层填。默认梯在 game-balance.json 的 floorWarmth，读数入口
  // 是 warmthOf()。
  1: { label: '宿舍', cold: 0.6, humidity: 0.1, danger: 0.0, hostile: false },
  2: { label: '邻居宿舍', cold: 1.6, humidity: 0.2, danger: 0.3, hostile: true },
  3: { label: '储物层', cold: 2.4, humidity: 0.6, danger: 0.5, hostile: true },
  4: { label: '维修层', cold: 3.2, humidity: 0.7, danger: 0.8, hostile: true },
  5: { label: '食堂', cold: 2.0, humidity: 0.5, danger: 0.6, hostile: true },
};

// One entry per segment start, so a whole tier can have an environment without
// enumerating its floors. The 1-5 entries above stay per-floor: the shanty floors
// differ from each other, and the ladder below them is the fallback.
const SEGMENT_ENVIRONMENT: Record<number, FloorEnvironment> = {
  1: { label: '底层贫民区', cold: 1.2, humidity: 0.35, danger: 0.45, hostile: true },
  100: { label: '工人宿舍区', cold: 1.4, humidity: 0.3, danger: 0.5, hostile: true },
  1000: { label: '工业与交易区', cold: 2.6, humidity: 0.5, danger: 0.85, hostile: true },
  // 中产与商业区（10000-10010）。比工业区高一层，暖气也停得更早（cold 2.8
  // > 2.6），但这里有地毯和坏掉的中央空调，不是管道井——所以比工业区干燥
  // （humidity 0.45 < 0.5）。私人武装加实验体雏形让危险度成为已创作四段里
  // 最高的一档（danger 0.95 > 0.85）：这一层没有保安队，只有合同。
  10000: { label: '中产与商业区', cold: 2.8, humidity: 0.45, danger: 0.95, hostile: true },
  // 富人特权区（50000-50010）。塔里最高的可玩段，暖气停得最早（cold 3.0
  // > 2.8），地毯和中央空调让这一层比中产区更干燥（humidity 0.4 < 0.45）——
  // 渗水的管道在下面，不在贵宾走廊里。danger 0.98 是五段最高：生物兵器
  // 在这一段正式登场，富人不只知道，他们买单——夜间在走廊里游荡的不是
  // 保安，是养在楼上的东西（docs/18_TIER_PROGRESSION.md §3）。
  50000: { label: '富人特权区', cold: 3.0, humidity: 0.4, danger: 0.98, hostile: true },
  // 统治核心（100000，单层终局）。全塔最高的一段，暖气停得最早（cold 3.4
  // > 3.0），也是最干燥的一段（humidity 0.35 < 0.4）——渗水的管道和中央
  // 空调都在下面，核心里只有服务器室的循环风。danger 1.0 封顶：整套安保
  // 体系把着这里（encounters.ts 的 100000 行，ambush 权重全塔最高），而等
  // 着玩家的不是怪物，是终端与四个选择（quests.ts Q6）。数值与 worldgen.ts
  // 的 ENVIRONMENT_ANCHORS 末档（90000 外推）逐字一致，两条读数在塔顶会师。
  100000: { label: '统治核心', cold: 3.4, humidity: 0.35, danger: 1, hostile: true },
};

// 契约第二节定死的解析顺序：FLOOR_ENVIRONMENT[floor]（叠 template 微调）→
// SEGMENT_ENVIRONMENT[段起点] → 阶梯向下回落 → 宿舍兜底。
// 微调叠在「完整解析结果」之上，而不是只与 FLOOR_ENVIRONMENT[floor] 合并：
// 6-10 层这种「有 template 微调但没有逐层条目」的楼层，若只与逐层条目合并会
// 只剩微调字段、连 label 都丢掉。
//
// AG-30 的 FloorTemplate.environment（契约第三节）已带真实数据落地（14 层
// 微调，含 1F 的 warmth 0.35），这里直接读字段，不再需要结构转换。
function resolveEnvironment(floor: number): FloorEnvironment {
  if (FLOOR_ENVIRONMENT[floor]) return FLOOR_ENVIRONMENT[floor];
  const seg = segmentOf(floor);
  if (seg && SEGMENT_ENVIRONMENT[seg.from]) return SEGMENT_ENVIRONMENT[seg.from];
  for (const key of Object.keys(FLOOR_ENVIRONMENT).map(Number).sort((a, b) => b - a)) {
    if (key <= floor) return FLOOR_ENVIRONMENT[key];
  }
  return FLOOR_ENVIRONMENT[1];
}

export function environmentFor(floor: number): FloorEnvironment {
  // Exact floor first, then the segment it stands in, then the ladder down — an
  // unlisted floor must never be answered with a neighbour's numbers, which is
  // what made floor 1000 a 1.6-degree 食堂.
  const base = resolveEnvironment(floor);
  const tweak = FLOOR_TEMPLATES[floor]?.environment;
  if (!tweak) return base;
  const merged: FloorEnvironment = { ...base };
  for (const [key, value] of Object.entries(tweak)) {
    // 只覆盖微调里显式写了的字段；undefined 不当成「写成 undefined」。
    if (value !== undefined) (merged as unknown as Record<string, unknown>)[key] = value;
  }
  return merged;
}

// A warmth source: where it stands and how far its heat reaches. The brazier on
// floor 5 is the strongest, the dorm's candles the weakest — which is why the
// canteen reads as the floor you want to come back to.
export interface WarmthSource {
  x: number;
  /** world px; body heat recovers inside this radius */
  radius: number;
  /** body-heat points per game hour recovered at the centre */
  power: number;
}

// ── AG-25：生存维度调参数（TWOM 对齐契约，数值在 config/game-balance.json）──
// 热源距离/恢复速率、心情五机制、疾病染病条件全部走 JSON，不硬编码。
// core/config.ts 的 GameBalanceConfig 类型视图不属 AG-25（本轮可改文件里没有
// 它），所以这里拿同一份 GAME_CONFIG 做结构转换 + 载时校验：与 config.ts 的
// assertGameBalanceConfig 是同一种「坏配置在加载时大声失败并点名字段」的契约，
// 且不制造第二个数值源。JSON 里纯增键，config 的 schemaVersion 不动。
export interface MoraleBalance {
  /** TWOM DefaultDepression：新点数池的起点 */
  defaultMorale: number;
  /** 点数池下限（可为负，但有底） */
  moraleMin: number;
  /** 点数池上限 */
  moraleMax: number;
  /** TWOM DepressionChangeOnDayBegin：每日基线漂移（战争把基线往下拉） */
  dayBeginChange: number;
  /** 点数池每小时向基线回归的最大幅度（TWOM DepressionLoss 的衰减） */
  decayPerGameHour: number;
  /** 士气分档阈值（HUD/日记用，TWOM GoodMorale） */
  goodMorale: number;
  badMorale: number;
  /** TWOM KosovoMoraleTraumaProbability：目睹死亡/被袭击时的创伤掷阈 */
  traumaProbability: number;
  /** 创伤命中时扣的点数 */
  traumaDelta: number;
  /** TWOM BackFromScavenge_CameBackHigherMorale / LowerMorale */
  backHigherMorale: number;
  backLowerMorale: number;
  /** 搜刮带回几件以上算「满载而归」 */
  backFullLoad: number;
}

export interface SicknessBalance {
  /** 饥饿/口渴归零多少游戏小时后染病 */
  starveGameHours: number;
  /** 潮湿+危险高的楼层夜间持续多少游戏分钟后染病 */
  exposureGameMinutes: number;
  /** 「潮湿」判定线（与 SicknessSystem 的 damp 判定同源） */
  exposureHumidity: number;
  /** 「危险高」判定线 */
  exposureDanger: number;
  /** 染病时的初始 severity（低于 SEVERITY_BITING，不会一染上就咬人） */
  exposureSeverity: number;
  /** 睡眠每小时回温点数，再乘楼层 warmth */
  sleepBodyHeatPerHour: number;
  /** bodyHeat 归零后每小时掉的 HP——契约的「0 = 失温失败」 */
  hypothermiaHpPerGameHour: number;
}

export interface SurvivalBalance {
  warmthSources: Record<number, WarmthSource[]>;
  /** 楼层可取暖程度默认梯（0..1）；AG-30 的 template 微调优先 */
  floorWarmth: Record<number, number>;
  morale: MoraleBalance;
  sickness: SicknessBalance;
}

function finiteNumber(source: Record<string, unknown>, block: string, key: string): number {
  const v = source[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`config/game-balance.json 无效：${block}.${key} 不是有效数字`);
  }
  return v;
}

function readNumberBlock<T extends object>(
  raw: unknown,
  block: string,
  keys: ReadonlyArray<keyof T & string>,
): T {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = finiteNumber(src, block, key);
  return out as T;
}

function readWarmthSources(raw: unknown): Record<number, WarmthSource[]> {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const out: Record<number, WarmthSource[]> = {};
  for (const [key, value] of Object.entries(src)) {
    if (!/^\d+$/.test(key)) continue; // _comment 之类的非楼层键
    if (!Array.isArray(value)) {
      throw new Error(`config/game-balance.json 无效：warmthSources.${key} 不是数组`);
    }
    out[Number(key)] = value.map((entry, index) => {
      const e = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
      return {
        x: finiteNumber(e, `warmthSources.${key}[${index}]`, 'x'),
        radius: finiteNumber(e, `warmthSources.${key}[${index}]`, 'radius'),
        power: finiteNumber(e, `warmthSources.${key}[${index}]`, 'power'),
      };
    });
  }
  return out;
}

function readFloorWarmth(raw: unknown): Record<number, number> {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const out: Record<number, number> = {};
  for (const key of Object.keys(src)) {
    if (!/^\d+$/.test(key)) continue; // _comment 之类的非楼层键
    out[Number(key)] = finiteNumber(src, 'floorWarmth', key);
  }
  return out;
}

const MORALE_KEYS: ReadonlyArray<keyof MoraleBalance & string> = [
  'defaultMorale',
  'moraleMin',
  'moraleMax',
  'dayBeginChange',
  'decayPerGameHour',
  'goodMorale',
  'badMorale',
  'traumaProbability',
  'traumaDelta',
  'backHigherMorale',
  'backLowerMorale',
  'backFullLoad',
];

const SICKNESS_KEYS: ReadonlyArray<keyof SicknessBalance & string> = [
  'starveGameHours',
  'exposureGameMinutes',
  'exposureHumidity',
  'exposureDanger',
  'exposureSeverity',
  'sleepBodyHeatPerHour',
  'hypothermiaHpPerGameHour',
];

const rawBalance = GAME_CONFIG as unknown as Record<string, unknown>;

export const SURVIVAL_BALANCE: SurvivalBalance = {
  warmthSources: readWarmthSources(rawBalance.warmthSources),
  floorWarmth: readFloorWarmth(rawBalance.floorWarmth),
  morale: readNumberBlock<MoraleBalance>(rawBalance.morale, 'morale', MORALE_KEYS),
  sickness: readNumberBlock<SicknessBalance>(rawBalance.sickness, 'sickness', SICKNESS_KEYS),
};

// The heat table itself: per-floor warmth sources read from the balance JSON
// (AG-25). Same export name and shape the environment system and its tests
// already import — only the numbers' home moved.
export const WARMTH_SOURCES: Record<number, WarmthSource[]> = SURVIVAL_BALANCE.warmthSources;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * 楼层「可取暖程度」读数（契约第二节 warmth 的唯一入口）。解析顺序：
 * AG-30 的 FloorTemplate.environment.warmth 逐层微调（经 environmentFor 合并）
 * → game-balance.json 的 floorWarmth 默认梯 → 0（楼上各段没有热源）。
 * 睡眠回温按它缩放（SurvivalSystem.sleep）。
 */
export function warmthOf(floor: number): number {
  const declared = environmentFor(floor).warmth;
  if (declared !== undefined) return clamp01(declared);
  return clamp01(SURVIVAL_BALANCE.floorWarmth[floor] ?? 0);
}

// The corridor used to hand the player its top speed on the frame a key went
// down and take it away the frame it came up, so walking read as dragging a
// sticker across the backdrop. These ramp the speed instead. Braking is quicker
// than starting on purpose: a heavy stop is the half of the feel players notice.
export const PLAYER_ACCELERATION = 900; // px/s^2, from rest toward top speed
export const PLAYER_DECELERATION = 1500; // px/s^2, braking or reversing
/** real-time duration of one visible stair traversal */
export const STAIR_TRAVEL_MS = 1000;

export const ENTRY_X = FLOOR_WIDTH / 2;
export const INTERACT_DISTANCE = 44;
export const UP_EXIT_X = 40; // left end -> 上楼 (toward higher floors)
export const DOWN_EXIT_X = FLOOR_WIDTH - 40; // right end -> 下楼 (toward lower floors)
export const BED_X = 1120; // dorm bed on the starting floor (sleep to pass the night)
export const CRAFT_X = 480; // dorm workbench on the starting floor (crafting station)

// Night wanderer threat (docs/01_GDD.md §10): slower than the player so it can be
// outrun, and it only ever chips HP on a cooldown — never an unavoidable kill.
export const WANDERER_SPEED = 70;
export const WANDERER_DAMAGE = 8;
export const WANDERER_HIT_COOLDOWN_MS = 1200;
