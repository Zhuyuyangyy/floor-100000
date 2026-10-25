import type { ItemId } from '../core/gameTypes';

// Dorm crafting recipes (docs/01_GDD.md §8). Every material must have a concrete
// source in the world — none of these are dead-end requirements.
export type UpgradeId = 'lamp' | 'reinforced_door' | 'purifier';

export interface Recipe {
  id: UpgradeId;
  displayName: string;
  description: string;
  cost: Partial<Record<ItemId, number>>;
}

export const RECIPES: Recipe[] = [
  { id: 'lamp', displayName: '照明灯', description: '宿舍夜间照亮，免用手电维持基础光', cost: { battery: 1, wire: 1, scrap_metal: 1 } },
  { id: 'reinforced_door', displayName: '加固门', description: '降低夜间威胁进入宿舍的概率', cost: { wood: 2, tape: 1 } },
  { id: 'purifier', displayName: '简易净水器', description: '把脏水炼成净水', cost: { scrap_metal: 2, filter: 1, wire: 1 } },
];

export function getRecipe(id: UpgradeId): Recipe {
  const recipe = RECIPES.find((r) => r.id === id);
  if (!recipe) throw new Error(`unknown recipe: ${id}`);
  return recipe;
}
