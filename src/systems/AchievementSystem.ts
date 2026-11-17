import {
  ACHIEVEMENTS,
  TALKABLE_NPC_IDS,
  WEAPON_RECIPE_IDS,
  achievementById,
  type AchievementDef,
} from '../data/achievements';

// AG-77：成就系统的纯函数核心。
//
// 契约（与 metaProgress.ts 同一族）：
//   * 全部函数纯——输入 save + 事件，输出新 save；不读时钟、不碰 DOM、
//     不 import Phaser。场景层（GameScene）只负责在事件发生处调用
//     evaluateAchievements、把返回的 save 写回 localStorage、把新解锁的
//     条目排进 toast 队列。
//   * 事件驱动、不轮询——没有任何 update() 扫描。每条成就的条件由
//     GameState 里已经发生的事实（楼层/制作/搜刮/战斗/拆床/守夜/跨天）
//     在事发那一处推一个事件进来。
//   * 跨 run 永久——存储键独立于存档键（'floor100000.achievements.v1'），
//     删档/重开不清空，语义对齐 Steam 成就。
//   * 容错优先——读档修复而不是拒档（localStorage 被写坏/私密模式不许
//     吃掉玩家的奖杯柜），写档 best-effort（配额满不许崩帧）。

const STORAGE_KEY = 'floor100000.achievements.v1';

/** 跨 run 累计的成就计数。字段只增不减（除 thirstStreak 断签归零）。 */
export interface AchievementStats {
  /** 到达过的最深楼层（跨 run 最大）。 */
  deepestFloor: number;
  /** 任意配方制作成功次数。 */
  crafts: number;
  /** 已制作的武器配方 id（四件）。 */
  weaponsCrafted: string[];
  /** 累计拆床数。 */
  bunksDismantled: number;
  /** 守夜成功次数（小偷被守在屋里逼退）。 */
  nightWatches: number;
  /** 对话过的 NPC id。 */
  npcsTalked: string[];
  /** 单次搜刮的最大件数（一次容器/床铺搜刮拿到几件）。 */
  bestSingleLoot: number;
  /** 是否零伤害击败过守门人。 */
  bossNoDamage: boolean;
  /** 当前连续不缺水天数（当天口渴见底则归零）。 */
  thirstStreak: number;
}

/** 成就存档：已解锁 id + 累计计数。 */
export interface AchievementSave {
  unlocked: string[];
  stats: AchievementStats;
}

export function freshAchievements(): AchievementSave {
  return {
    unlocked: [],
    stats: {
      deepestFloor: 0,
      crafts: 0,
      weaponsCrafted: [],
      bunksDismantled: 0,
      nightWatches: 0,
      npcsTalked: [],
      bestSingleLoot: 0,
      bossNoDamage: false,
      thirstStreak: 0,
    },
  };
}

// ── 事件 ───────────────────────────────────────────────────────────────────
// 每个事件对应 GameScene 里一处一行钩子（见钩子清单注释末尾）。事件只带
// 「发生了什么」的最小事实，累计与判定全在核心里——钩子处不做任何成就逻辑。
export type AchievementEvent =
  | { type: 'floor_reached'; floor: number }
  | { type: 'item_crafted'; recipeId: string }
  | { type: 'bunk_dismantled' }
  | { type: 'night_watch_prevented' }
  | { type: 'npc_talked'; npcId: string }
  | { type: 'loot_taken'; count: number }
  | { type: 'boss_won'; damageTaken: number }
  | { type: 'day_end'; dehydrated: boolean };

// ── 判定表 ─────────────────────────────────────────────────────────────────
// 每条成就一个纯谓词。刻意不用 enum 化的「进度对象」：十四条的形状差太远
// （楼层阈值/集合齐套/布尔事实），一张 Record<string, 谓词> 是漂移面最小的
// 写法——加成就只改 data/achievements.ts 的条目加这里的一行。
const RULES: Record<string, (s: AchievementStats) => boolean> = {
  depth_10: (s) => s.deepestFloor >= 10,
  depth_110: (s) => s.deepestFloor >= 110,
  depth_1010: (s) => s.deepestFloor >= 1010,
  depth_10010: (s) => s.deepestFloor >= 10010,
  depth_50010: (s) => s.deepestFloor >= 50010,
  depth_100000: (s) => s.deepestFloor >= 100000,
  first_craft: (s) => s.crafts >= 1,
  all_weapons: (s) => WEAPON_RECIPE_IDS.every((id) => s.weaponsCrafted.includes(id)),
  thirst_streak_3: (s) => s.thirstStreak >= 3,
  night_watch_5: (s) => s.nightWatches >= 5,
  bunks_10: (s) => s.bunksDismantled >= 10,
  talk_all_npcs: (s) => TALKABLE_NPC_IDS.every((id) => s.npcsTalked.includes(id)),
  boss_no_damage: (s) => s.bossNoDamage,
  loot_single_3: (s) => s.bestSingleLoot >= 3,
};

/** 把事件并入计数。纯函数：返回新 stats，输入不动。 */
export function applyEvent(stats: AchievementStats, event: AchievementEvent): AchievementStats {
  switch (event.type) {
    case 'floor_reached':
      return { ...stats, deepestFloor: Math.max(stats.deepestFloor, Math.floor(event.floor)) };
    case 'item_crafted': {
      const weaponsCrafted = WEAPON_RECIPE_IDS.includes(event.recipeId) && !stats.weaponsCrafted.includes(event.recipeId)
        ? [...stats.weaponsCrafted, event.recipeId]
        : stats.weaponsCrafted;
      return { ...stats, crafts: stats.crafts + 1, weaponsCrafted };
    }
    case 'bunk_dismantled':
      return { ...stats, bunksDismantled: stats.bunksDismantled + 1 };
    case 'night_watch_prevented':
      return { ...stats, nightWatches: stats.nightWatches + 1 };
    case 'npc_talked':
      return stats.npcsTalked.includes(event.npcId)
        ? stats
        : { ...stats, npcsTalked: [...stats.npcsTalked, event.npcId] };
    case 'loot_taken':
      return { ...stats, bestSingleLoot: Math.max(stats.bestSingleLoot, Math.floor(event.count)) };
    case 'boss_won':
      // 只认「这一局赢了且没掉血」这一个事实；掉过血的胜局不改写已得的真。
      return event.damageTaken <= 0 ? { ...stats, bossNoDamage: true } : stats;
    case 'day_end':
      return { ...stats, thirstStreak: event.dehydrated ? 0 : stats.thirstStreak + 1 };
  }
}

/**
 * 事件驱动求值：并入事件 → 重判全部未解锁成就 → 返回新 save 与本轮新解锁。
 *
 * 重判「全部」而不是「与事件相关的那几条」：乘电梯从 1 层直上 110 层时，
 * depth_10 与 depth_110 都该亮（Steam 的既定语义——路过即得），这也让
 * 多成就排队 toast 有真实来源。已解锁的永不重发（幂等）。
 */
export function evaluateAchievements(
  save: AchievementSave,
  event: AchievementEvent,
): { save: AchievementSave; unlocked: AchievementDef[] } {
  const stats = applyEvent(save.stats, event);
  const unlocked: AchievementDef[] = [];
  for (const def of ACHIEVEMENTS) {
    if (save.unlocked.includes(def.id)) continue;
    if (RULES[def.id]?.(stats)) unlocked.push(def);
  }
  if (unlocked.length === 0) return { save: { ...save, stats }, unlocked };
  return {
    save: { unlocked: [...save.unlocked, ...unlocked.map((d) => d.id)], stats },
    unlocked,
  };
}

/** 某条成就是否已解锁。 */
export function isUnlocked(save: AchievementSave, id: string): boolean {
  return save.unlocked.includes(id);
}

// ── 持久化 ─────────────────────────────────────────────────────────────────
// 独立键：与存档键（SAVE_KEY）互不相干——重置游戏只清存档，奖杯柜留下。
// 读写全部 best-effort，理由同 metaProgress：写坏/禁用 localStorage 的
// 浏览器不该因此崩帧或吞掉整场游戏。

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * 读档并修复：坏字段按缺省补，而不是拒档——玩家的奖杯柜不因为一格脏数据
 * 整体作废。unlocked 里认不出的 id 直接丢弃（下线成就不该占着列表）。
 */
export function loadAchievements(storage: Storage = localStorage): AchievementSave {
  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return freshAchievements();
  }
  if (raw === null) return freshAchievements();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return freshAchievements();
  }
  if (!isRecord(data)) return freshAchievements();
  const stats = isRecord(data.stats) ? data.stats : {};
  return {
    unlocked: strList(data.unlocked).filter((id) => achievementById(id) !== undefined),
    stats: {
      deepestFloor: num(stats.deepestFloor, 0),
      crafts: num(stats.crafts, 0),
      weaponsCrafted: strList(stats.weaponsCrafted).filter((id) => WEAPON_RECIPE_IDS.includes(id)),
      bunksDismantled: num(stats.bunksDismantled, 0),
      nightWatches: num(stats.nightWatches, 0),
      npcsTalked: strList(stats.npcsTalked),
      bestSingleLoot: num(stats.bestSingleLoot, 0),
      bossNoDamage: stats.bossNoDamage === true,
      thirstStreak: num(stats.thirstStreak, 0),
    },
  };
}

/** 写档 best-effort：配额满/私密模式时静默保留内存进度，不崩调用方。 */
export function saveAchievements(save: AchievementSave, storage: Storage = localStorage): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

/** 清空成就（仅测试/调试用；产品路径没有调用方——Steam 永久性语义）。 */
export function clearAchievements(storage: Storage = localStorage): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // 静默：删不掉也不该崩。
  }
}

/** 存储键导出，供 e2e 直读断言（与 meta 的 META_KEY 同用法）。 */
export const ACHIEVEMENTS_STORAGE_KEY = STORAGE_KEY;

/** 某条成就的人类可读进度（查看面板用；已解锁返回 '已解锁'）。 */
export function achievementProgress(save: AchievementSave, id: string): string {
  const s = save.stats;
  switch (id) {
    case 'depth_10':
    case 'depth_110':
    case 'depth_1010':
    case 'depth_10010':
    case 'depth_50010':
    case 'depth_100000':
      return `最深第 ${s.deepestFloor} 层`;
    case 'first_craft':
      return `已制作 ${s.crafts} 次`;
    case 'all_weapons':
      return `武器 ${s.weaponsCrafted.length}/${WEAPON_RECIPE_IDS.length}`;
    case 'thirst_streak_3':
      return `连续 ${s.thirstStreak} 天`;
    case 'night_watch_5':
      return `守夜 ${s.nightWatches}/5`;
    case 'bunks_10':
      return `拆床 ${s.bunksDismantled}/10`;
    case 'talk_all_npcs':
      return `对话 ${s.npcsTalked.length}/${TALKABLE_NPC_IDS.length}`;
    case 'boss_no_damage':
      return s.bossNoDamage ? '已达成' : '未达成';
    case 'loot_single_3':
      return `最多一次 ${s.bestSingleLoot} 件`;
    default:
      return '';
  }
}

// ── GameScene 钩子清单（每处一行，行内注明位置）───────────────────────────
//   楼层切换：updateStairClimb 落地后 / rideLiftTo 落地后
//     → { type: 'floor_reached', floor: state.currentFloor }
//   制作：activateCraftEntry 的 recipe 分支成功后
//     → { type: 'item_crafted', recipeId: entry.id }
//   搜刮：finishContainerSearch / finishBunkSearch 出货段
//     → { type: 'loot_taken', count: 本次拿到的总件数 }
//   战斗胜利：finishCombat 的 win 分支（仅 boss）
//     → { type: 'boss_won', damageTaken: 本场战斗累计受伤 }
//   拆床：runBunkDismantle 成功后
//     → { type: 'bunk_dismantled' }
//   守夜：tickNightWatch 的 prevented 分支
//     → { type: 'night_watch_prevented' }
//   NPC 对话：openDialogue
//     → { type: 'npc_talked', npcId: npc.id }
//   跨天：update 里对比 state.day（睡觉跨天不走 tick.dayChanged，故用对账兜底；
//     dehydrated 取 thirstHitZero——见顶当天是否见底）
//     → { type: 'day_end', dehydrated: this.thirstHitZero }
