// AG-77：成就表——Steam 上架前置层。
//
// 十四条成就全部跨 run 永久累计（与 metaProgress 的解锁同语义），每条预留
// steamApiName：上架时由 AchievementSystem 的存储层读出已解锁 id、按这张表
// 映射成 Steamworks 的 API 名推送即可，现在不接任何 Steam SDK。
//
// 分层（tier）只决定解锁 toast 与查看面板里的颜色：bronze = 日常里程碑，
// silver = 要花点心思，gold = 一局的谈资。深度六连是唯一按段位给金的一族
// （10010 起），因为那是「换了一整个阶层」的位置。

/** 解锁 toast 与查看面板的成就档位色。 */
export type AchievementTier = 'bronze' | 'silver' | 'gold';

export interface AchievementDef {
  /** 稳定 id：存档键、e2e 断言、日志都用它。 */
  id: string;
  name: string;
  /** 查看面板里的一行说明。 */
  description: string;
  tier: AchievementTier;
  /** Steamworks 成就 API 名（上架映射用；当前纯预留，无任何读取方）。 */
  steamApiName: string;
}

/** 四件可制作武器的配方 id（data/recipes.ts 的 WeaponRecipeId）。 */
export const WEAPON_RECIPE_IDS: readonly string[] = [
  'craft_dagger',
  'craft_short_sword',
  'craft_cleaver',
  'craft_fire_axe',
];

/** 全 NPC 对话要对话完的活跃 NPC（npcs.ts active !== false 的实体）。 */
export const TALKABLE_NPC_IDS: readonly string[] = [
  'alin',
  'xiaozhou',
  'recruiter',
  'blackmarket',
  'lab_clerk',
  'banquet_staff',
];

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // ── 深度六连（爬塔）────────────────────────────────────────────────────
  {
    id: 'depth_10',
    name: '初露锋芒',
    description: '爬到第 10 层——第一段楼梯的尽头',
    tier: 'bronze',
    steamApiName: 'ACH_DEPTH_10',
  },
  {
    id: 'depth_110',
    name: '登堂入室',
    description: '爬到第 110 层——工人宿舍区全境',
    tier: 'silver',
    steamApiName: 'ACH_DEPTH_110',
  },
  {
    id: 'depth_1010',
    name: '深区探索者',
    description: '爬到第 1010 层——管道井之上',
    tier: 'silver',
    steamApiName: 'ACH_DEPTH_1010',
  },
  {
    id: 'depth_10010',
    name: '中产之巅',
    description: '爬到第 10010 层——中央空调与地毯的上面',
    tier: 'gold',
    steamApiName: 'ACH_DEPTH_10010',
  },
  {
    id: 'depth_50010',
    name: '富人区来客',
    description: '爬到第 50010 层——一身像样才能走到这',
    tier: 'gold',
    steamApiName: 'ACH_DEPTH_50010',
  },
  {
    id: 'depth_100000',
    name: '塔顶之人',
    description: '爬到第 100000 层——这栋楼的终点',
    tier: 'gold',
    steamApiName: 'ACH_DEPTH_100000',
  },
  // ── 制作 ───────────────────────────────────────────────────────────────
  {
    id: 'first_craft',
    name: '第一件手作',
    description: '在宿舍工作台完成第一次制作',
    tier: 'bronze',
    steamApiName: 'ACH_FIRST_CRAFT',
  },
  {
    id: 'all_weapons',
    name: '铁匠铺',
    description: '四件武器（匕首/短剑/砍刀/消防斧）全部亲手做过',
    tier: 'silver',
    steamApiName: 'ACH_ALL_WEAPONS',
  },
  // ── 生存 ───────────────────────────────────────────────────────────────
  {
    id: 'thirst_streak_3',
    name: '细水长流',
    description: '连续 3 天没让口渴见底',
    tier: 'silver',
    steamApiName: 'ACH_THIRST_STREAK_3',
  },
  {
    id: 'night_watch_5',
    name: '守夜人',
    description: '在家守夜成功 5 次——小偷次次空手',
    tier: 'silver',
    steamApiName: 'ACH_NIGHT_WATCH_5',
  },
  // ── 搜刮与战斗 ─────────────────────────────────────────────────────────
  {
    id: 'bunks_10',
    name: '拆家大王',
    description: '累计拆掉 10 张床',
    tier: 'bronze',
    steamApiName: 'ACH_BUNKS_10',
  },
  {
    id: 'loot_single_3',
    name: '大开箱',
    description: '单次搜刮拿到 3 件以上东西',
    tier: 'bronze',
    steamApiName: 'ACH_LOOT_SINGLE_3',
  },
  {
    id: 'boss_no_damage',
    name: '无伤胜利',
    description: '一滴血不掉地击败守门人',
    tier: 'gold',
    steamApiName: 'ACH_BOSS_NO_DAMAGE',
  },
  // ── 交际 ───────────────────────────────────────────────────────────────
  {
    id: 'talk_all_npcs',
    name: '见面皆缘',
    description: '和楼里每一位会上前搭话的人对话过',
    tier: 'silver',
    steamApiName: 'ACH_TALK_ALL_NPCS',
  },
];

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

export function achievementById(id: string): AchievementDef | undefined {
  return BY_ID.get(id);
}
