import { RECIPES, getRecipe, type UpgradeId } from '../data/recipes';
import { addItem, countItem, removeItem } from './InventorySystem';
import { isNight } from './SurvivalSystem';
import { STARTING_FLOOR } from '../core/constants';
import { getItem } from '../data/items';
import type { GameState, ItemId } from '../core/gameTypes';

// Dorm crafting & upgrades (docs/03_TASKS.md#p0-05). Pure rules; Phaser only
// renders the workbench and feeds the craft/purify commands.

export function hasUpgrade(state: GameState, id: UpgradeId): boolean {
  return state.player.homeUpgrades.includes(id);
}

export interface MissingMaterial {
  itemId: ItemId;
  need: number;
  have: number;
}

export type CanCraftResult = { ok: true } | { ok: false; missing: MissingMaterial[] };

export function canCraft(state: GameState, id: UpgradeId): CanCraftResult {
  const missing: MissingMaterial[] = [];
  for (const [itemId, need] of Object.entries(getRecipe(id).cost) as Array<[ItemId, number]>) {
    const have = countItem(state.player.inventory, itemId);
    if (have < need) missing.push({ itemId, need, have });
  }
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

export type CraftResult = { ok: true; id: UpgradeId } | { ok: false; reason: string };

// Crafts an upgrade: refuses (no deduction) if already built or materials are
// short; otherwise deducts all materials atomically and records the upgrade.
export function craft(state: GameState, id: UpgradeId): CraftResult {
  const recipe = getRecipe(id);
  if (hasUpgrade(state, id)) return { ok: false, reason: `${recipe.displayName} 已建造` };
  const check = canCraft(state, id);
  if (!check.ok) {
    const detail = check.missing.map((m) => `${getItem(m.itemId).displayName} ${m.have}/${m.need}`).join('，');
    return { ok: false, reason: `材料不足：${detail}` };
  }
  for (const [itemId, need] of Object.entries(recipe.cost) as Array<[ItemId, number]>) {
    removeItem(state.player.inventory, itemId, need);
  }
  state.player.homeUpgrades.push(id);
  return { ok: true, id };
}

export type PurifyResult = { ok: true } | { ok: false; reason: string };

// With the purifier built, convert one 脏水 into 净水.
export function purifyWater(state: GameState): PurifyResult {
  if (!hasUpgrade(state, 'purifier')) return { ok: false, reason: '尚未建造净水器' };
  if (countItem(state.player.inventory, 'dirty_water') < 1) return { ok: false, reason: '没有脏水' };
  removeItem(state.player.inventory, 'dirty_water', 1);
  addItem(state.player.inventory, 'clean_water', 1);
  return { ok: true };
}

// Night lighting: the dorm lamp lights the dorm; a blackout darkens other floors
// (a flashlight helps, and the alpha is capped so the screen is never fully black).
export const LAMP_NIGHT_ALPHA = 0.16;
export const DARK_NIGHT_ALPHA = 0.6;
export const BLACKOUT_LIT_ALPHA = 0.4;
export const BLACKOUT_DARK_ALPHA = 0.82;

export function nightOverlayAlpha(state: GameState): number {
  if (!isNight(state.gameMinuteOfDay)) return 0;
  const onDorm = state.currentFloor === STARTING_FLOOR;
  if (onDorm && hasUpgrade(state, 'lamp')) return LAMP_NIGHT_ALPHA;
  if (onDorm) return DARK_NIGHT_ALPHA; // the dorm is a safe zone
  if (state.worldEvents.activeEvent?.type === 'blackout') {
    return countItem(state.player.inventory, 'flashlight') > 0 ? BLACKOUT_LIT_ALPHA : BLACKOUT_DARK_ALPHA;
  }
  return DARK_NIGHT_ALPHA;
}

export { RECIPES };
