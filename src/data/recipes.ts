import type { ItemId } from '../core/gameTypes';

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

export interface Recipe {
  id: UpgradeId;
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
}

export const RECIPES: Recipe[] = [
  { id: 'lamp', displayName: '照明灯', description: '宿舍夜间照亮，免用手电维持基础光', cost: { battery: 1, wire: 1, scrap_metal: 1 }, tier: 1 },
  // The description now matches what it does. It used to claim it lowered the
  // night threat's chance of entering the dorm, which was never true — the
  // wanderer never spawns on the dorm floor at all — and nothing read the
  // upgrade, so it cost materials and did nothing.
  { id: 'reinforced_door', displayName: '加固门', description: '封住宿舍漏风口，夜间不再全黑', cost: { wood: 2, tape: 1 }, tier: 1 },
  { id: 'purifier', displayName: '简易净水器', description: '把脏水一次全炼成净水', cost: { scrap_metal: 2, filter: 1, wire: 1 }, tier: 1 },
  // 置物架：+2 格持久背包容量（见 UpgradeId 上方注释）。效果不是占位 flag——
  // craft() 成功即把 inventory.slotCount 从 12 抬到 14，addItem/isBagFull/
  // lootContainer/shop.buy 全部既有调用方无需改签名就吃到容量。
  { id: 'storage_rack', displayName: '置物架', description: '木板绷布搭的置物架，背包多带 2 格', cost: { wood: 2, cloth: 1, crowbar: 1 }, tier: 1 },

  // 跨阶层通行凭证. Each rung is useless on its own and only opens the gate the
  // next one needs, so the chain is walked in order: work_badge → pass_sticker →
  // permit → vip_card → core_key. `requires` is enforced by canCraft/craft, not
  // only displayed — a gated recipe cannot be built out of order even with the
  // materials in hand.
  { id: 'work_badge', displayName: '工牌', description: '仿一块工人宿舍区的胸卡，能过第一道岗', cost: { scrap_metal: 1, cloth: 1, tape: 1 }, tier: 2 },
  { id: 'pass_sticker', displayName: '通行贴', description: '贴在门禁读头上的通行贴，靠短接门禁线路生效', cost: { wire: 2, tape: 1, battery: 1 }, requires: 'work_badge', tier: 3 },
  { id: 'permit', displayName: '许可证', description: '中产区的通行许可，靠电池和滤芯打点换来', cost: { battery: 2, filter: 1, cloth: 1 }, requires: 'pass_sticker', tier: 4 },
  { id: 'vip_card', displayName: '贵宾卡', description: '富人区只认体面。一身像样的衣服和一份礼物', cost: { scrap_metal: 1, cloth: 2, battery: 1 }, requires: 'permit', tier: 5 },
  { id: 'core_key', displayName: '核心权限', description: '接进塔务系统的临时权限，代价是配电房最后一只保险丝', cost: { fuse: 1, wire: 2, scrap_metal: 1 }, requires: 'vip_card', tier: 6 },
];

// The pass chain is stored in homeUpgrades, but a credential is not a facility:
// anything that lists or counts what the player has BUILT must exclude these, or
// a run can satisfy the "build an upgrade" daily goal by forging a badge.
export const PASS_UPGRADE_IDS: readonly UpgradeId[] = ['work_badge', 'pass_sticker', 'permit', 'vip_card', 'core_key'];

export function isPassUpgrade(id: string): boolean {
  return (PASS_UPGRADE_IDS as readonly string[]).includes(id);
}

export function getRecipe(id: UpgradeId): Recipe {
  const recipe = RECIPES.find((r) => r.id === id);
  if (!recipe) throw new Error(`unknown recipe: ${id}`);
  return recipe;
}
