import { deriveSeed, makeRng } from './rng';
import { isPassUpgrade } from '../data/recipes';
import type { GameState, GrowthLine, GrowthLineId, GrowthProfile } from './gameTypes';

// 四条成长线（docs/GAME_DESIGN_LOCK.md §4）的纯函数层。
//
// 契约（写给所有后续系统的三句话）：
// 1. 想给某条线加经验，只能调 grantGrowthXp(state, line, amount)——它是唯一
//    的写入入口，内部走 ensureGrowth 补默认值，旧存档因此不会崩。
// 2. 想读跨线影响，只能调本文件 export 的那几个函数（携带量/消耗倍率/交易
//    价格/配方档位/财富换人脉）。不允许在场景里手写 level * 系数，否则四条线
//    的平衡会散落在十个文件里。
// 3. 本文件不 import Phaser、不读 DOM、不碰 Math.random——全部确定性，可单测
//    （见 tests/growth.test.ts）。

/** 等级上限。10 级是设计锁定 §6 四条终局路线的「行为深度」刻度，不是数值天花板。 */
export const GROWTH_MAX_LEVEL = 10;

/** 升到下一级所需经验：100 × 当前等级。线性曲线，满级共需 4500 点。 */
export function xpToNext(level: number): number {
  return Math.max(0, Math.floor(level)) * 100;
}

// ── 默认值与存档迁移 ────────────────────────────────────────────────────

export function createGrowthLine(): GrowthLine {
  return { level: 1, xp: 0, totalXp: 0 };
}

export function createGrowthProfile(): GrowthProfile {
  return {
    survival: createGrowthLine(),
    wealth: createGrowthLine(),
    connections: createGrowthLine(),
    power: createGrowthLine(),
    intel: 0,
    controlledSegments: [],
    investedGold: 0,
    ventures: [],
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// 存档是系统边界：growth 来自 JSON，任何字段都可能是缺的/坏的/越界的。
// normalizeGrowth 把任意输入收敛成合法 GrowthProfile——旧存档整块缺失、
// 手改档缺半边、数值越界，都在这里补默认值，调用方拿到的永远是完整结构。
// 这是「缺字段给默认值，不让老存档崩」的唯一收口点。
function normalizeLine(raw: unknown): GrowthLine {
  if (typeof raw !== 'object' || raw === null) return createGrowthLine();
  const line = raw as Partial<GrowthLine>;
  const level = typeof line.level === 'number' && Number.isFinite(line.level) ? Math.floor(line.level) : 1;
  const xp = typeof line.xp === 'number' && Number.isFinite(line.xp) ? line.xp : 0;
  const totalXp = typeof line.totalXp === 'number' && Number.isFinite(line.totalXp) ? line.totalXp : 0;
  return {
    level: clamp(level, 1, GROWTH_MAX_LEVEL),
    xp: Math.max(0, xp),
    totalXp: Math.max(0, totalXp),
  };
}

function normalizeSegments(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is number => typeof v === 'number' && Number.isInteger(v));
}

function normalizeVentures(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string');
}

export function normalizeGrowth(raw: unknown): GrowthProfile {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<GrowthProfile>;
  return {
    survival: normalizeLine(src.survival),
    wealth: normalizeLine(src.wealth),
    connections: normalizeLine(src.connections),
    power: normalizeLine(src.power),
    intel: typeof src.intel === 'number' && Number.isFinite(src.intel) ? clamp(src.intel, 0, 100) : 0,
    controlledSegments: normalizeSegments(src.controlledSegments),
    investedGold:
      typeof src.investedGold === 'number' && Number.isFinite(src.investedGold) ? Math.max(0, src.investedGold) : 0,
    ventures: normalizeVentures(src.ventures),
  };
}

// 完整且合法才走快路径——ensureGrowth 可能被每帧调用，不该每次都分配新对象，
// 否则 state.growth 的引用每次都变，调用方的 === 比较会失效。注意「完整」
// 包含取值范围：intel 500、investedGold -20 这类越界值必须落回归一化路径，
// 否则调用方拿到的仍是一个非法 profile（快路径检查的存在性，不是合法性）。
function isCompleteGrowth(raw: unknown): raw is GrowthProfile {
  if (typeof raw !== 'object' || raw === null) return false;
  const g = raw as Partial<GrowthProfile>;
  const lineOk = (l: unknown): boolean => {
    if (typeof l !== 'object' || l === null) return false;
    const line = l as Partial<GrowthLine>;
    return (
      typeof line.level === 'number' &&
      Number.isInteger(line.level) &&
      line.level >= 1 &&
      line.level <= GROWTH_MAX_LEVEL &&
      typeof line.xp === 'number' &&
      Number.isFinite(line.xp) &&
      line.xp >= 0 &&
      typeof line.totalXp === 'number' &&
      Number.isFinite(line.totalXp) &&
      line.totalXp >= 0
    );
  };
  const segmentsOk =
    Array.isArray(g.controlledSegments) && g.controlledSegments.every((v) => typeof v === 'number' && Number.isInteger(v));
  const venturesOk = Array.isArray(g.ventures) && g.ventures.every((v) => typeof v === 'string');
  return (
    lineOk(g.survival) &&
    lineOk(g.wealth) &&
    lineOk(g.connections) &&
    lineOk(g.power) &&
    typeof g.intel === 'number' &&
    Number.isFinite(g.intel) &&
    g.intel >= 0 &&
    g.intel <= 100 &&
    segmentsOk &&
    venturesOk &&
    typeof g.investedGold === 'number' &&
    Number.isFinite(g.investedGold) &&
    g.investedGold >= 0
  );
}

/**
 * 读 growth 前的唯一入口：缺失（旧存档）或残缺（手改档）时补默认值并写回，
 * 之后原样返回同一引用。幂等——第二次调用不会再分配。
 *
 * 场景/系统应当在创建时调用一次并存下返回值；不要在热循环里每次都调用
 * （虽然快路径不分配，但也没有必要）。
 */
export function ensureGrowth(state: GameState): GrowthProfile {
  const existing = state.growth;
  if (isCompleteGrowth(existing)) return existing;
  state.growth = normalizeGrowth(existing);
  return state.growth;
}

// ── 加经验与升级（纯函数） ──────────────────────────────────────────────

export interface GrowthXpResult {
  /** 应用本次授予后的新 profile（输入 profile 不被修改）。 */
  profile: GrowthProfile;
  line: GrowthLineId;
  /** 本次一共升了几级。一次大额授予可以连升多级。 */
  levelsGained: number;
  /** 授予后的等级。 */
  level: number;
  /** 授予后是否处于（或早已处于）满级。 */
  maxed: boolean;
}

/**
 * 给一条线加经验，返回新 profile。纯函数：不碰输入、不碰 state。
 *
 * 语义：
 * - 经验只增不减，没有掉级；负值/NaN/Infinity 是调用方 bug 的静默防御
 *   （场景循环里抛异常会杀帧循环，见 GHI-03 m5 的教训），按 0 处理。
 * - 一次授予可连升多级，逐级扣除 xpToNext。
 * - 满级后 xp 恒 0，经验只进 totalXp——满级的 xp 没有「下一级」可指，
 *   留着只会让 UI 显示一条永远走不完的进度条。
 * - 来自存档的 level/xp 先被钳进合法区间：level 99 的手改档自愈为满级，
 *   level 0/负数自愈为 1 且不会靠负的 xpToNext 虚增经验。
 */
export function addGrowthXp(profile: GrowthProfile, line: GrowthLineId, amount: number): GrowthXpResult {
  const before = normalizeLine((profile as Partial<GrowthProfile> | undefined)?.[line]);
  const maxedBefore = before.level >= GROWTH_MAX_LEVEL;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { profile, line, levelsGained: 0, level: before.level, maxed: maxedBefore };
  }
  let level = before.level;
  let xp = before.xp + amount;
  let levelsGained = 0;
  while (level < GROWTH_MAX_LEVEL && xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level += 1;
    levelsGained += 1;
  }
  const maxed = level >= GROWTH_MAX_LEVEL;
  if (maxed) xp = 0;
  const next: GrowthProfile = {
    ...profile,
    [line]: { level, xp, totalXp: before.totalXp + amount },
  };
  return { profile: next, line, levelsGained, level, maxed };
}

/**
 * 存档版写入入口（唯一被允许改 state.growth 的公开函数）：
 * ensureGrowth 补默认值 → addGrowthXp 纯计算 → 写回 state.growth。
 * 场景和系统一律调这个，不要自己拼 profile。
 */
export function grantGrowthXp(state: GameState, line: GrowthLineId, amount: number): GrowthXpResult {
  const current = ensureGrowth(state);
  const result = addGrowthXp(current, line, amount);
  state.growth = result.profile;
  return result;
}

// ── 跨线影响（纯函数） ─────────────────────────────────────────────────
//
// GAME_DESIGN_LOCK §4：四条线必须互相影响。以下每条都是「一条线的等级 →
// 另一条线可玩性」的显式换算，消费方在 docs/plans/GROWTH_INTERFACES.md 登记。

/** 读某条线的等级，容忍残缺 profile（热路径上不再 ensureGrowth 也能安全读）。 */
export function lineLevel(profile: GrowthProfile, line: GrowthLineId): number {
  const raw = (profile as Partial<GrowthProfile> | undefined)?.[line]?.level;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1;
  return clamp(Math.floor(raw), 1, GROWTH_MAX_LEVEL);
}

/** 背包额外格数：生存能力每升 1 级多带 1 格（1 级 +0，满级 +9）。 */
export function carryCapacityBonus(profile: GrowthProfile): number {
  return Math.max(0, lineLevel(profile, 'survival') - 1);
}

const DRAIN_MIN = 0.6;
/** 生存消耗倍率：抗寒耐饿 = 饥渴/体温消耗变慢，最低打 6 折，永不低于 0.6。 */
export function statDrainMultiplier(profile: GrowthProfile): number {
  return clamp(1 - 0.04 * (lineLevel(profile, 'survival') - 1), DRAIN_MIN, 1);
}

const PRICE_MIN = 0.7;
/** 交易价格倍率：人脉每级便宜 3%，最低 7 折——熟人价，不是白送。 */
export function tradePriceMultiplier(profile: GrowthProfile): number {
  return clamp(1 - 0.03 * (lineLevel(profile, 'connections') - 1), PRICE_MIN, 1);
}

/** 配方档位上限 = 6（六个可玩段）。权力 7–10 级在同一档内深化终局配方，不新增段位。 */
const RECIPE_TIER_COUNT = 6;
/** 权力解锁的配方档位：1 级只看底层配方，6 级开放全部六段。 */
export function recipeAccessTier(profile: GrowthProfile): number {
  return clamp(lineLevel(profile, 'power'), 1, RECIPE_TIER_COUNT);
}

const FAVOR_RATE_MIN = 0.8;
const FAVOR_RATE_MAX = 1.2;
/**
 * 当日「疏通关系」汇率，0.8..1.2，由 (runSeed, day) 决定。
 * 禁 Math.random（02_TECH_SPEC §3）：同 seed 同一天必然同汇率，可复现；
 * 跨天波动让「今天送礼还是明天送礼」成为一个真实的小决策。
 */
export function favorRate(seed: number, day: number): number {
  const rng = makeRng(deriveSeed(seed, day, 'growth-favor'));
  return FAVOR_RATE_MIN + rng.nextFloat() * (FAVOR_RATE_MAX - FAVOR_RATE_MIN);
}

const FAVOR_WEALTH_STEP = 0.1;
/**
 * 金币 → 人脉经验的换算（财富换人脉，GAME_DESIGN_LOCK §4）。
 *
 * 消费方（AG-05/AG-06 的送礼、打点流程）负责扣 gold，再拿这里的返回值调
 * grantGrowthXp(state, 'connections', xp)——本函数只算账，不动存档。
 * 财富线每级让换算效率 +10%：批量打点有批发价，富人结交朋友更便宜。
 */
export function goldToFavorXp(gold: number, profile: GrowthProfile, seed: number, day: number): number {
  if (!Number.isFinite(gold) || gold <= 0) return 0;
  const bulk = 1 + FAVOR_WEALTH_STEP * (lineLevel(profile, 'wealth') - 1);
  return Math.floor(gold * favorRate(seed, day) * bulk);
}

/**
 * 凭证链进度：homeUpgrades 里的通行凭证档数（0..5）。
 *
 * 权力线不另存一份凭证列表——凭证的事实来源是 homeUpgrades（passChain.test.ts
 * 钉着），再存一份必然漂移。这个函数是权力线读取凭证进度的唯一桥梁：
 *  whoever awards power XP for a new credential counts rungs here.
 */
export function credentialRungs(homeUpgrades: readonly string[]): number {
  if (!Array.isArray(homeUpgrades)) return 0;
  return homeUpgrades.filter((id) => typeof id === 'string' && isPassUpgrade(id)).length;
}
