import type { ItemId } from '../core/gameTypes';
import type { WeaponId } from './weapons';

// Dorm crafting recipes (docs/01_GDD.md §8). Every material must have a concrete
// source in the world — none of these are dead-end requirements.
export type UpgradeId = 'lamp' | 'reinforced_door' | 'purifier';
export type WeaponRecipeId = 'craft_dagger' | 'craft_short_sword' | 'craft_cleaver' | 'craft_fire_axe';
export type RecipeId = UpgradeId | WeaponRecipeId;

interface RecipeBase {
  displayName: string;
  description: string;
  cost: Partial<Record<ItemId, number>>;
}

export interface UpgradeRecipe extends RecipeBase {
  kind: 'upgrade';
  id: UpgradeId;
}

export interface WeaponRecipe extends RecipeBase {
  kind: 'item';
  id: WeaponRecipeId;
  outputItemId: WeaponId;
}

export type Recipe = UpgradeRecipe | WeaponRecipe;

export const RECIPES: Recipe[] = [
  { kind: 'upgrade', id: 'lamp', displayName: '照明灯', description: '宿舍夜间照亮，免用手电维持基础光', cost: { battery: 1, wire: 1, scrap_metal: 1 } },
  // The description now matches what it does. It used to claim it lowered the
  // night threat's chance of entering the dorm, which was never true — the
  // wanderer never spawns on the dorm floor at all — and nothing read the
  // upgrade, so it cost materials and did nothing.
  { kind: 'upgrade', id: 'reinforced_door', displayName: '加固门', description: '封住宿舍漏风口，夜间不再全黑', cost: { wood: 2, tape: 1 } },
  { kind: 'upgrade', id: 'purifier', displayName: '简易净水器', description: '把脏水一次全炼成净水', cost: { scrap_metal: 2, filter: 1, wire: 1 } },
  // Weapon recipes are repeatable item crafts, not home upgrades or equipment.
  { kind: 'item', id: 'craft_dagger', outputItemId: 'dagger', displayName: '匕首', description: '用废金属和布料制作一把短匕首', cost: { scrap_metal: 1, cloth: 1 } },
  { kind: 'item', id: 'craft_short_sword', outputItemId: 'short_sword', displayName: '短剑', description: '用金属、木材和胶带制作短剑', cost: { scrap_metal: 1, wood: 1, tape: 1 } },
  { kind: 'item', id: 'craft_cleaver', outputItemId: 'cleaver', displayName: '砍刀', description: '用废金属、木柄和胶带制作砍刀', cost: { scrap_metal: 2, wood: 1, tape: 1 } },
  { kind: 'item', id: 'craft_fire_axe', outputItemId: 'fire_axe', displayName: '消防斧', description: '用废金属、木柄和布料改制消防斧', cost: { scrap_metal: 2, wood: 2, cloth: 1 } },
];

export function getRecipe(id: RecipeId): Recipe {
  const recipe = RECIPES.find((r) => r.id === id);
  if (!recipe) throw new Error(`unknown recipe: ${id}`);
  return recipe;
}
