import { RECIPES, getRecipe, type RecipeId, type UpgradeId } from '../data/recipes';
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

export type CanCraftResult =
  | { ok: true }
  | { ok: false; missing: MissingMaterial[]; reason?: string };

function slotsAfterCost(state: GameState, id: RecipeId): number {
  const slots = state.player.inventory.slots.map((slot) => ({ ...slot }));
  const recipe = getRecipe(id);
  for (const [itemId, need] of Object.entries(recipe.cost) as Array<[ItemId, number]>) {
    let remaining = need;
    for (let i = slots.length - 1; i >= 0 && remaining > 0; i--) {
      const slot = slots[i];
      if (slot.itemId !== itemId) continue;
      const take = Math.min(slot.quantity, remaining);
      slot.quantity -= take;
      remaining -= take;
      if (slot.quantity === 0) slots.splice(i, 1);
    }
  }
  return slots.length;
}

export function canCraft(state: GameState, id: RecipeId): CanCraftResult {
  const recipe = getRecipe(id);
  const missing: MissingMaterial[] = [];
  for (const [itemId, need] of Object.entries(recipe.cost) as Array<[ItemId, number]>) {
    const have = countItem(state.player.inventory, itemId);
    if (have < need) missing.push({ itemId, need, have });
  }
  if (missing.length > 0) return { ok: false, missing };
  if (recipe.kind === 'item' && slotsAfterCost(state, id) >= state.player.inventory.slotCount) {
    return { ok: false, missing: [], reason: '背包空间不足' };
  }
  return { ok: true };
}

export type CraftResult = { ok: true; id: RecipeId } | { ok: false; reason: string };

// Upgrades are recorded once in homeUpgrades; weapon recipes instead create a
// non-stackable inventory item and may be crafted again if materials permit.
export function craft(state: GameState, id: RecipeId): CraftResult {
  const recipe = getRecipe(id);
  if (recipe.kind === 'upgrade' && hasUpgrade(state, recipe.id)) {
    return { ok: false, reason: `${recipe.displayName} 已建造` };
  }
  const check = canCraft(state, id);
  if (!check.ok) {
    if (check.reason) return { ok: false, reason: check.reason };
    const detail = check.missing.map((m) => `${getItem(m.itemId).displayName} ${m.have}/${m.need}`).join('，');
    return { ok: false, reason: `材料不足：${detail}` };
  }
  for (const [itemId, need] of Object.entries(recipe.cost) as Array<[ItemId, number]>) {
    removeItem(state.player.inventory, itemId, need);
  }
  if (recipe.kind === 'upgrade') {
    state.player.homeUpgrades.push(recipe.id);
  } else {
    const output = addItem(state.player.inventory, recipe.outputItemId, 1);
    if (output.overflow > 0) {
      removeItem(state.player.inventory, recipe.outputItemId, output.added);
      for (const [itemId, need] of Object.entries(recipe.cost) as Array<[ItemId, number]>) {
        addItem(state.player.inventory, itemId, need);
      }
      return { ok: false, reason: '背包空间不足' };
    }
  }
  return { ok: true, id };
}

export type PurifyResult = { ok: true; converted: number } | { ok: false; reason: string };

// With the purifier built, convert the whole carry of 脏水 into 净水 in one use.
// Batch rather than one-at-a-time: the audit found a single-bottle conversion
// made the purifier redundant, because 小周 trades 1 脏水 for 1 净水 for free and
// repeatedly. Batch conversion is the thing the NPC does not do, so the upgrade
// earns its materials when the player comes back loaded instead of trickling.
export function purifyWater(state: GameState): PurifyResult {
  if (!hasUpgrade(state, 'purifier')) return { ok: false, reason: '尚未建造净水器' };
  const dirty = countItem(state.player.inventory, 'dirty_water');
  if (dirty < 1) return { ok: false, reason: '没有脏水' };
  removeItem(state.player.inventory, 'dirty_water', dirty);
  addItem(state.player.inventory, 'clean_water', dirty);
  return { ok: true, converted: dirty };
}

// Night lighting: the dorm lamp lights the dorm; a reinforced door seals the gaps
// in it; a blackout darkens other floors (a flashlight helps, and the alpha is
// capped so the screen is never fully black).
export const LAMP_NIGHT_ALPHA = 0.16;
// The audit found reinforced_door was a dead upgrade — nothing read it, so it
// cost materials and did nothing. It now seals the dorm against the dark, which
// is strictly weaker than the lamp so the two are not interchangeable.
export const REINFORCED_DOOR_NIGHT_ALPHA = 0.42;
export const DARK_NIGHT_ALPHA = 0.6;
export const BLACKOUT_LIT_ALPHA = 0.4;
export const BLACKOUT_DARK_ALPHA = 0.82;

export function nightOverlayAlpha(state: GameState): number {
  if (!isNight(state.gameMinuteOfDay)) return 0;
  const onDorm = state.currentFloor === STARTING_FLOOR;
  if (onDorm && hasUpgrade(state, 'lamp')) return LAMP_NIGHT_ALPHA;
  if (onDorm && hasUpgrade(state, 'reinforced_door')) return REINFORCED_DOOR_NIGHT_ALPHA;
  if (onDorm) return DARK_NIGHT_ALPHA; // the dorm is a safe zone
  if (state.worldEvents.activeEvent?.type === 'blackout') {
    return countItem(state.player.inventory, 'flashlight') > 0 ? BLACKOUT_LIT_ALPHA : BLACKOUT_DARK_ALPHA;
  }
  return DARK_NIGHT_ALPHA;
}

export { RECIPES };
