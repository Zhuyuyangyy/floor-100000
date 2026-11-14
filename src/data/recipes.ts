import type { ItemId } from '../core/gameTypes';

// Dorm crafting recipes (docs/01_GDD.md §8). Every material must have a concrete
// source in the world — none of these are dead-end requirements.
export type UpgradeId =
  | 'lamp'
  | 'reinforced_door'
  | 'purifier'
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
}

export const RECIPES: Recipe[] = [
  { id: 'lamp', displayName: '照明灯', description: '宿舍夜间照亮，免用手电维持基础光', cost: { battery: 1, wire: 1, scrap_metal: 1 } },
  // The description now matches what it does. It used to claim it lowered the
  // night threat's chance of entering the dorm, which was never true — the
  // wanderer never spawns on the dorm floor at all — and nothing read the
  // upgrade, so it cost materials and did nothing.
  { id: 'reinforced_door', displayName: '加固门', description: '封住宿舍漏风口，夜间不再全黑', cost: { wood: 2, tape: 1 } },
  { id: 'purifier', displayName: '简易净水器', description: '把脏水一次全炼成净水', cost: { scrap_metal: 2, filter: 1, wire: 1 } },

  // 跨阶层通行凭证. Each rung is useless on its own and only opens the gate the
  // next one needs, so the chain is walked in order: work_badge → pass_sticker →
  // permit → vip_card → core_key. `requires` is enforced by canCraft/craft, not
  // only displayed — a gated recipe cannot be built out of order even with the
  // materials in hand.
  { id: 'work_badge', displayName: '工牌', description: '仿一块工人宿舍区的胸卡，能过第一道岗', cost: { scrap_metal: 1, cloth: 1, tape: 1 } },
  { id: 'pass_sticker', displayName: '通行贴', description: '贴在门禁读头上的通行贴，靠短接门禁线路生效', cost: { wire: 2, tape: 1, battery: 1 }, requires: 'work_badge' },
  { id: 'permit', displayName: '许可证', description: '中产区的通行许可，靠电池和滤芯打点换来', cost: { battery: 2, filter: 1, cloth: 1 }, requires: 'pass_sticker' },
  { id: 'vip_card', displayName: '贵宾卡', description: '富人区只认体面。一身像样的衣服和一份礼物', cost: { scrap_metal: 1, cloth: 2, battery: 1 }, requires: 'permit' },
  { id: 'core_key', displayName: '核心权限', description: '接进塔务系统的临时权限，代价是配电房最后一只保险丝', cost: { fuse: 1, wire: 2, scrap_metal: 1 }, requires: 'vip_card' },
];

export function getRecipe(id: UpgradeId): Recipe {
  const recipe = RECIPES.find((r) => r.id === id);
  if (!recipe) throw new Error(`unknown recipe: ${id}`);
  return recipe;
}
