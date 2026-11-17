import type { ItemId } from '../core/gameTypes';
import type { WeaponId } from './weapons';

// AG-武器分支：四件可制作武器的配方 id 与武器 id 的联合。UpgradeId 见下方
// （设施 + 五张凭证）。RecipeId 是两侧的并集——制作面板的 entries 用它遍历。
export type WeaponRecipeId = 'craft_dagger' | 'craft_short_sword' | 'craft_cleaver' | 'craft_fire_axe';
// AG-66：过道工具配方 id。铲子是阻碍物的清理工具，产出进背包（与武器同型）。
// outputItemId 在数据条目里铸成 WeaponId（见 RECIPES 末尾的 craft_shovel）：
// WeaponId 联合属主在 data/weapons.ts（AG-51），本工单不碰，而运行时 id 是
// 'shovel'——getItem/isItemId 经 DIG_TOOL_ITEMS 认得它（items.ts 的 AG-66 段）。
export type ToolRecipeId = 'craft_shovel';
export type RecipeId = UpgradeId | WeaponRecipeId | ToolRecipeId;

// Dorm crafting recipes (docs/01_GDD.md §8). Every material must have a concrete
// source in the world — none of these are dead-end requirements.
export type UpgradeId =
  | 'lamp'
  | 'reinforced_door'
  | 'purifier'
  // 置物架：把 12 格背包撑到 14 格。存在的理由是修两个断点——撬棍原本
  // 没有任何配方消耗它（买了只能 30 金卖回，净亏 30），而"宿舍建设"在
  // 设施侧只有灯/门/净水器三件，储存环节只有一个会爆的 12 格背包。
  // 成本刻意避开 scrap_metal：tier 1 保底 scrap 恰好是 lamp(1)+purifier(2)
  // 三件（survivalBalance.test.ts 钉死的稀缺事实），置物架再吃一块就会把
  // "三件全建"变成"四件抢三块"，那是把 false choice 引进基地建设。
  | 'storage_rack'
  // The pass chain: one-off social credentials, not items. They live in
  // homeUpgrades so a pass is a permanent qualification — there is no ItemId and
  // no icon for them, and nothing can be traded or dropped.
  | 'work_badge'
  | 'pass_sticker'
  | 'permit'
  | 'vip_card'
  | 'core_key';
interface RecipeBase {
  displayName: string;
  description: string;
  cost: Partial<Record<ItemId, number>>;
  /** 前置资格: must already be in homeUpgrades, or this cannot be crafted. */
  requires?: UpgradeId;
  /**
   * 配方档位 1..6，对应六个可玩段（core/segments.ts 的 PLAYABLE_SEGMENTS）：
   * 底层贫民区的设施是 1，往上每张通行凭证 +1。数据层对接
   * growth.ts 的 recipeAccessTier(profile)=clamp(power level,1,6)。
   *
   * 注意：tier 是"设计意图档位"，当前 **不**作为打造门禁强制执行——见
   * CraftingSystem.recipeTierLocked 的注释（权力线冷启动软锁 + 凭证链
   * "材料齐全必可建"的既有语义）。字段先立，门禁等权力线有稳定等级来源后
   * 由负责人统一开启。
   */
  tier?: number;
  /**
   * AG-42：效果预览——"这条配方能做出什么"的一句话。
   *
   * 修前：description 是设定集文案（"仿一块工人宿舍区的胸卡"），制作面板
   * 只渲染 名称+材料，玩家在按 Enter 之前看不到任何"做出来会怎样"的信息，
   * 五张凭证尤其如此——"通行贴"不开电梯读条的话与一块废金属无异。effect
   * 是机制事实（数值/门禁/权力线），由 CraftingSystem.recipePreview 连同
   * 成本、前置、档位一起发给面板；scene 归 AG-11，本字段只立数据。
   */
  effect: string;
}

export interface UpgradeRecipe extends RecipeBase {
  kind: 'upgrade';
  id: UpgradeId;
}

export interface WeaponRecipe extends RecipeBase {
  kind: 'item';
  // AG-66：id 联合含 ToolRecipeId——铲子条目与四件武器同型（kind: item），
  // 复用本接口而不是新开一个（outputItemId 在数据里铸成 WeaponId）。
  id: WeaponRecipeId | ToolRecipeId;
  outputItemId: WeaponId;
  /** 效果预览：武器进背包即可装备，战斗读取见 data/weapons.ts 的 WEAPONS。 */
  effect: string;
}


export type Recipe = UpgradeRecipe | WeaponRecipe;

export const RECIPES: Recipe[] = [
  { kind: 'upgrade', id: 'lamp', displayName: '照明灯', description: '宿舍夜间照亮，免用手电维持基础光', cost: { battery: 1, wire: 1, scrap_metal: 1 }, tier: 1, effect: '宿舍夜照 alpha 0.16，夜里不再全黑' },  // The description now matches what it does. It used to claim it lowered the
  // night threat's chance of entering the dorm, which was never true — the
  // wanderer never spawns on the dorm floor at all — and nothing read the
  // upgrade, so it cost materials and did nothing.
  { kind: 'upgrade', id: 'reinforced_door', displayName: '加固门', description: '封住宿舍漏风口，夜间不再全黑', cost: { wood: 2, tape: 1 }, tier: 1, effect: '封住漏风口，宿舍夜照 alpha 0.42（弱于灯，不互替）' },
  { kind: 'upgrade', id: 'purifier', displayName: '简易净水器', description: '把脏水一次全炼成净水', cost: { scrap_metal: 2, filter: 1, wire: 1 }, tier: 1, effect: '一次把整袋脏水炼成净水（小周只肯 1:1 换）' },
  // 置物架：+2 格持久背包容量（见 UpgradeId 上方注释）。效果不是占位 flag——
  // craft() 成功即把 inventory.slotCount 从 12 抬到 14，addItem/isBagFull/
  // lootContainer/shop.buy 全部既有调用方无需改签名就吃到容量。
  { kind: 'upgrade', id: 'storage_rack', displayName: '置物架', description: '木板绷布搭的置物架，背包多带 2 格', cost: { wood: 2, cloth: 1, crowbar: 1 }, tier: 1, effect: '背包 12 → 14 格，持久生效随存档' },

  // 跨阶层通行凭证. Each rung is useless on its own and only opens the gate the
  // next one needs, so the chain is walked in order: work_badge → pass_sticker →
  // permit → vip_card → core_key. `requires` is enforced by canCraft/craft, not
  // only displayed — a gated recipe cannot be built out of order even with the
  // materials in hand.
  { kind: 'upgrade', id: 'work_badge', displayName: '工牌', description: '仿一块工人宿舍区的胸卡，能过第一道岗', cost: { scrap_metal: 1, cloth: 1, tape: 1 }, tier: 2, effect: '开 100-110 段电梯；权力线 +100' },
  { kind: 'upgrade', id: 'pass_sticker', displayName: '通行贴', description: '贴在门禁读头上的通行贴，靠短接门禁线路生效', cost: { wire: 2, tape: 1, battery: 1 }, requires: 'work_badge', tier: 3, effect: '开 1000-1010 段电梯；权力线 +200' },
  { kind: 'upgrade', id: 'permit', displayName: '许可证', description: '中产区的通行许可，靠电池和滤芯打点换来', cost: { battery: 2, filter: 1, cloth: 1 }, requires: 'pass_sticker', tier: 4, effect: '开 10000-10010 段电梯；权力线 +300' },
  { kind: 'upgrade', id: 'vip_card', displayName: '贵宾卡', description: '富人区只认体面。一身像样的衣服和一份礼物', cost: { scrap_metal: 1, cloth: 2, battery: 1 }, requires: 'permit', tier: 5, effect: '开 50000-50010 段电梯；权力线 +400' },
  { kind: 'upgrade', id: 'core_key', displayName: '核心权限', description: '接进塔务系统的临时权限，代价是配电房最后一只保险丝', cost: { fuse: 1, wire: 2, scrap_metal: 1 }, requires: 'vip_card', tier: 6, effect: '开 100000 段电梯；权力线 +500' },

  // 四件可制作武器（AG-武器分支）。与 upgrade 分开：没有 tier、没有 requires、
  // 没有"已建造"闸门——武器是做出实物、可重复做，产出进背包（outputItemId）。
  // 撬棍不在其列：它是 v0.1 就在册的工具，也是置物架配方的成本。
  { kind: 'item', id: 'craft_dagger', outputItemId: 'dagger', displayName: '匕首', description: '用废金属和布料制作一把短匕首', cost: { scrap_metal: 1, cloth: 1 } , effect: '背包里多一把匕首，战斗可装备（轻武器，攻速快）' },
  { kind: 'item', id: 'craft_short_sword', outputItemId: 'short_sword', displayName: '短剑', description: '用金属、木材和胶带制作短剑', cost: { scrap_metal: 1, wood: 1, tape: 1 } , effect: '背包里多一把短剑，战斗可装备（攻守均衡）' },
  { kind: 'item', id: 'craft_cleaver', outputItemId: 'cleaver', displayName: '砍刀', description: '用废金属、木柄和胶带制作砍刀', cost: { scrap_metal: 2, wood: 1, tape: 1 } , effect: '背包里多一把砍刀，战斗可装备（重武器，单发高伤）' },
  { kind: 'item', id: 'craft_fire_axe', outputItemId: 'fire_axe', displayName: '消防斧', description: '用废金属、木柄和布料改制消防斧', cost: { scrap_metal: 2, wood: 2, cloth: 1 } , effect: '背包里多一把消防斧，战斗可装备（最重，一下一个）' },

  // AG-66：铲子——过道阻碍物（瓦砾堆/锈闸门）的清理工具。排在 weapons 之后
  // 是硬约束：craftLoop「保底配额恰好只够三件设施」与 economyLoop 的同名诊断
  // 表按 RECIPES 顺序逐个试做，铲子（废金属×3+木材×2）若排在前面会挤进 built。
  // 成本两件都是 tier 1 保底料（3 层铁箱/3 层木箱），出处提示自动可得。
  { kind: 'item', id: 'craft_shovel', outputItemId: 'shovel' as unknown as WeaponId, displayName: '铲子', description: '用废金属和木柄捆一把铲子，挖开过道上的瓦砾', cost: { scrap_metal: 3, wood: 2 }, effect: '背包里多一把铲子，挖开过道上的瓦砾堆与锈闸门（撬棍也行）' },
];

// The pass chain is stored in homeUpgrades, but a credential is not a facility:
// anything that lists or counts what the player has BUILT must exclude these, or
// a run can satisfy the "build an upgrade" daily goal by forging a badge.
export const PASS_UPGRADE_IDS: readonly UpgradeId[] = ['work_badge', 'pass_sticker', 'permit', 'vip_card', 'core_key'];

export function isPassUpgrade(id: string): boolean {
  return (PASS_UPGRADE_IDS as readonly string[]).includes(id);
}

export function getRecipe(id: RecipeId): Recipe {
  const recipe = RECIPES.find((r) => r.id === id);
  if (!recipe) throw new Error(`unknown recipe: ${id}`);
  return recipe;
}

// ── 材料出处表（AG-42）────────────────────────────────────────────────────
//
// 修前的断点：craft() 的缺料提示只说"材料不足：胶带 0/1"——玩家知道缺什么，
// 不知道去哪拿。而上链凭证（通行贴起）的进阶材料在 tier 1 内**做不齐**
// （craftLoop.test.ts 的种子扫描钉死：0/N 能在 1-10 层内走完凭证链），
// "100 层以上更常见"这条梯度因此是真实路径而非文案——但没有任何一处
// 把它显示给玩家。
//
// 三列全部可在 floorTemplates.ts（1-10 层保底/概率）与 encounters.ts 的
// FLOOR_LOOT_POOLS（100+ 遭遇池）里逐条复核，本表不改世界数据，只把
// 已有事实转成"去哪拿"的一句话。crowbar 是工具不是材料，但置物架消耗它，
// 一并给出处。
export interface MaterialSource {
  /** 保底来源（层·容器），没有保底则缺省。 */
  guaranteed?: string;
  /** 概率来源（层），没有则缺省。 */
  random?: string;
  /** 高层梯度（段），没有则缺省。 */
  higher?: string;
}

export const MATERIAL_SOURCES: Partial<Record<ItemId, MaterialSource>> = {
  scrap_metal: { guaranteed: '3层铁箱×3', random: '6/7/9/10层概率', higher: '100层以上各层概率' },
  wood: { guaranteed: '3层木箱×2', random: '6/8层概率' },
  tape: { guaranteed: '3层木箱×1', random: '6/8/10层概率', higher: '100层以上各层概率' },
  battery: { guaranteed: '3层地面×1', random: '3层铁箱/6/7/10层概率', higher: '100层以上各层概率' },
  wire: { guaranteed: '4层电箱×2', random: '7/8层概率', higher: '100层以上各层概率' },
  filter: { guaranteed: '4层电箱×1', random: '9层概率', higher: '102层以上各层概率' },
  fuse: { guaranteed: '4层电箱×1', random: '7/10层概率', higher: '104层以上各层概率' },
  cloth: { guaranteed: '3层地面×1', random: '1层柜子/6-9层概率', higher: '100层以上各层概率' },
  crowbar: { guaranteed: '3层铁箱×1', higher: '4层商人 60 金' },
};

/** 一条材料的"去哪拿"提示；没有出处的材料返回 undefined（调用方自行省略）。 */
export function materialSourceHint(itemId: ItemId): string | undefined {
  const s = MATERIAL_SOURCES[itemId];
  if (!s) return undefined;
  return [s.guaranteed, s.random, s.higher].filter(Boolean).join(' · ');
}
