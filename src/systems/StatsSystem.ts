import { GAME_CONFIG } from '../core/config';
import type { GameState, RunStatKey, RunStats } from '../core/gameTypes';
import { runScore } from './progress';

// AG-81：本局统计 + 跨局纪录（对标 deep-end 的 Statistics Tracking 与架构文档
// 的 end-of-run stats screen）。
//
// 分工：
//   * 累积——GameScene 在各事件点调 bumpStat/noteFloorReached/noteGoldEarned，
//     计数落在 GameState.stats（随存档走，读档继续接着计数）；
//   * 读取——statsOf() 是把「旧存档没有 stats」这件事一次性解决的地方：
//     缺字段/坏值一律按零读，调用方永远拿到一份完整的 RunStats；
//   * 炫耀——records 是跨局的（localStorage 'floor100000.records'），一局结束
//     时由 mergeRunRecords() 纯函数比较、settleRun() 落盘，破哪几项由它报告，
//     结算画面据此高亮。
//
// 本模块刻意不 import Phaser：它是纯逻辑 + 存储，Node 下单测直接跑（同
// SaveSystem/SurvivalSystem 的约定）。渲染侧的共享组件（统计行表）在
// scenes/EndScene.ts 的 buildStatsTable，两个结算画面复用。

// 展示顺序即表格行序：先「怎么走的」（楼层/夜晚），再「摸了什么」（搜刮/
// 制作/战斗），最后「受了多少苦」（伤害/死亡）。
export const STAT_KEYS: readonly RunStatKey[] = [
  'floorsClimbed',
  'maxFloor',
  'containersLooted',
  'itemsCrafted',
  'monstersKilled',
  'bedsSearched',
  'bedsDismantled',
  'obstaclesCleared',
  'nightsSurvived',
  'goldEarned',
  'damageDealt',
  'damageTaken',
  'deaths',
] as const;

export const STAT_LABELS: Record<RunStatKey, string> = {
  floorsClimbed: '爬梯次数',
  maxFloor: '最高层',
  containersLooted: '开箱数',
  itemsCrafted: '制作数',
  monstersKilled: '击杀数',
  bedsSearched: '搜床数',
  bedsDismantled: '拆床数',
  obstaclesCleared: '清障数',
  nightsSurvived: '熬过夜晚',
  goldEarned: '金币收入',
  damageDealt: '造成伤害',
  damageTaken: '受到伤害',
  deaths: '死亡次数',
};

// ── 累积 ──────────────────────────────────────────────────────────────────

export function createRunStats(): RunStats {
  return {
    floorsClimbed: 0,
    maxFloor: 0,
    containersLooted: 0,
    itemsCrafted: 0,
    monstersKilled: 0,
    bedsSearched: 0,
    bedsDismantled: 0,
    obstaclesCleared: 0,
    nightsSurvived: 0,
    goldEarned: 0,
    damageDealt: 0,
    damageTaken: 0,
    deaths: 0,
  };
}

// 读一遍存档里的 stats，缺的补零、坏的（非有限数/负数/非整数）按零读。
// 纯函数：不改 state——旧存档继续玩时，第一次 bumpStat 才会把块写进存档。
export function statsOf(state: GameState): RunStats {
  const out = createRunStats();
  const raw = state.stats as Partial<Record<RunStatKey, unknown>> | undefined;
  if (!raw || typeof raw !== 'object') return out;
  for (const key of STAT_KEYS) {
    const v = raw[key];
    // 计数器语义是整数（同 SaveSystem.validateStack 的约定）：非整数与
    // 非有限数/负数同罪，一律按零读，不 floor——floor 会把 2.7 静默修正成
    // 2，而这里要的是「认不出的值就不认」。
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) out[key] = v;
  }
  return out;
}

// 写路径的入口：保证 state.stats 存在且干净，返回可写的块。
export function ensureStats(state: GameState): RunStats {
  const clean = statsOf(state);
  state.stats = clean;
  return clean;
}

/** 计数 +1（或 +delta）。所有统计钩子都走这一句。 */
export function bumpStat(state: GameState, key: RunStatKey, delta = 1): void {
  const stats = ensureStats(state);
  stats[key] = Math.max(0, stats[key] + delta);
}

/** 到达新楼层：maxFloor 取历址最大（下楼不会把纪录走低）。 */
export function noteFloorReached(state: GameState): void {
  const stats = ensureStats(state);
  stats.maxFloor = Math.max(stats.maxFloor, state.currentFloor);
}

/** 金币进账：调用方传交易前的余额，差值为正才计（买入/花费不计收入）。 */
export function noteGoldEarned(state: GameState, goldBefore: number): void {
  const gained = state.player.gold - goldBefore;
  if (gained > 0) bumpStat(state, 'goldEarned', gained);
}

// ── 派生读数（结算表与统计面板共用）───────────────────────────────────────

export interface StatRow {
  readonly label: string;
  readonly value: string;
  /** 破了历史纪录的行——渲染层据此高亮并盖「新纪录」章。 */
  readonly record?: boolean;
}

// 本局时长：从第 1 天开局时刻算起的游戏时长。跨午夜的小时用
// (day-1)*1440 + minute - dayStart 合成总分钟数，睡到 00:30 的那种存档
// （minute < dayStart）也不会算出负数。
export function formatRunDuration(state: GameState): string {
  const total = Math.max(
    0,
    (state.day - 1) * 1440 + Math.floor(state.gameMinuteOfDay) - GAME_CONFIG.time.dayStartMinute,
  );
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  if (days > 0) return hours > 0 ? `${days} 天 ${hours} 小时` : `${days} 天`;
  if (hours > 0) return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
  return `${minutes} 分`;
}

// 结算表/统计面板的全部行：13 项计数 + 存活天数 + 游戏时长 + 本局得分。
// 纯函数——表格长什么样在 Node 里就能钉死（stats.test.ts）。
export function runStatRows(state: GameState): StatRow[] {
  const stats = statsOf(state);
  const rows: StatRow[] = STAT_KEYS.map((key) => ({ label: STAT_LABELS[key], value: `${stats[key]}` }));
  rows.push({ label: '存活天数', value: `${state.day} 天` });
  rows.push({ label: '游戏时长', value: formatRunDuration(state) });
  // 得分是 OVERHAUL 的 run 计分（progress.ts）：深度主导的那套公式，放在
  // 统计表末尾——它是「这一趟值多少」的总评，不是一项行为计数。
  rows.push({ label: '本局得分', value: `${runScore(state)}` });
  return rows;
}

// ── 跨局纪录 ──────────────────────────────────────────────────────────────

export const RECORDS_KEY = 'floor100000.records';

export interface RunRecords {
  maxFloor: number;
  maxDays: number;
  maxKills: number;
  maxGold: number;
}

export const RECORD_KEYS = ['maxFloor', 'maxDays', 'maxKills', 'maxGold'] as const;

export const RECORD_LABELS: Record<keyof RunRecords, string> = {
  maxFloor: '最高层',
  maxDays: '最长存活',
  maxKills: '最多击杀',
  maxGold: '最多金币',
};

export function createRunRecords(): RunRecords {
  return { maxFloor: 0, maxDays: 0, maxKills: 0, maxGold: 0 };
}

// 读纪录。没有键、键坏了、字段缺了，都按全零读——纪录是炫耀用的，不该有
// 任何一条路径因为它把结算画面弄炸。
export function loadRunRecords(storage: Storage = localStorage): RunRecords {
  const out = createRunRecords();
  let raw: string | null = null;
  try {
    raw = storage.getItem(RECORDS_KEY);
  } catch {
    return out;
  }
  if (raw === null) return out;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object') return out;
    const rec = data as Partial<Record<keyof RunRecords, unknown>>;
    for (const key of RECORD_KEYS) {
      const v = rec[key];
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0) out[key] = v;
    }
  } catch {
    return out;
  }
  return out;
}

// 写纪录。best-effort：localStorage 被拒（配额/隐私模式）时返回 false 而不
// 抛——结算画面还在屏幕上，一次写入失败不该把玩家困住（同 saveToStorage 的
// 约定，GHI-03 m5）。
export function saveRunRecords(records: RunRecords, storage: Storage = localStorage): boolean {
  try {
    storage.setItem(RECORDS_KEY, JSON.stringify(records));
    return true;
  } catch {
    return false;
  }
}

// 本局成绩与历史纪录的比较：纯函数，返回新纪录块与「破了哪几项」。
// 严格大于才算破——打平旧纪录是「追平」，不是新纪录。
// maxFloor 取 stats.maxFloor 与当前楼层的较大者：旧存档继续玩时计数从零起，
// 但玩家此刻站着的楼层无疑是到达过的。
export function mergeRunRecords(
  records: RunRecords,
  state: GameState,
): { records: RunRecords; beaten: Array<keyof RunRecords> } {
  const stats = statsOf(state);
  const run = {
    maxFloor: Math.max(stats.maxFloor, state.currentFloor),
    maxDays: state.day,
    maxKills: stats.monstersKilled,
    maxGold: stats.goldEarned,
  };
  const next = createRunRecords();
  const beaten: Array<keyof RunRecords> = [];
  for (const key of RECORD_KEYS) {
    next[key] = Math.max(records[key], run[key]);
    if (run[key] > records[key]) beaten.push(key);
  }
  return { records: next, beaten };
}

// 一局结算：读旧纪录 → 合并 → 落盘 → 报告破了哪几项。End/EndgameScene 的
// 结算画面各调一次（一局只会走到其中一个画面）。
export function settleRun(
  state: GameState,
  storage: Storage = localStorage,
): { records: RunRecords; beaten: Array<keyof RunRecords> } {
  const merged = mergeRunRecords(loadRunRecords(storage), state);
  saveRunRecords(merged.records, storage);
  return merged;
}

// 纪录对比行：本局值 vs 历史纪录，破了的行带 record 标志（高亮 + 「新纪录」
// 章由渲染层落实，判断不落在渲染里）。
export function recordRows(
  state: GameState,
  settled: { records: RunRecords; beaten: Array<keyof RunRecords> },
): StatRow[] {
  const stats = statsOf(state);
  const run: Record<keyof RunRecords, number> = {
    maxFloor: Math.max(stats.maxFloor, state.currentFloor),
    maxDays: state.day,
    maxKills: stats.monstersKilled,
    maxGold: stats.goldEarned,
  };
  return RECORD_KEYS.map((key) => ({
    label: RECORD_LABELS[key],
    // 窄列友好格式：破纪录的行还要在标签后别一枚「新纪录」章，数值必须短。
    value: `${run[key]}（纪录 ${settled.records[key]}）`,
    record: settled.beaten.includes(key),
  }));
}
