import { GAME_CONFIG } from '../core/config';
import { getItem } from '../data/items';
import type { GameState, Inventory, InventoryStack, ItemId, StatKey } from '../core/gameTypes';

// Inventory rules: 12 slots, stacking, full-bag handling that never loses or
// silently swallows items, and consumable use with clamped stat effects.

export interface AddResult {
  added: number;
  overflow: number;
}

export interface UseResult {
  ok: boolean;
  reason?: string;
  stat?: StatKey;
  amount?: number;
  stats?: { hp: number; hunger: number; thirst: number; energy: number };
}

function sameMeta(a?: Record<string, string>, b?: Record<string, string>): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => a[k] === b[k]);
}

// Adds up to `quantity`, stacking identical ids. Returns how many could NOT be
// added (overflow) so callers never silently lose or swallow items.
export function addItem(
  inv: Inventory,
  itemId: ItemId,
  quantity: number,
  meta?: Record<string, string>,
): AddResult {
  const item = getItem(itemId);
  let remaining = quantity;
  let added = 0;
  if (item.stackable) {
    for (const slot of inv.slots) {
      if (remaining === 0) break;
      if (slot.itemId === itemId && sameMeta(slot.meta, meta) && slot.quantity < item.maxStack) {
        const moved = Math.min(item.maxStack - slot.quantity, remaining);
        slot.quantity += moved;
        remaining -= moved;
        added += moved;
      }
    }
  }
  while (remaining > 0 && inv.slots.length < inv.slotCount) {
    const take = item.stackable ? Math.min(item.maxStack, remaining) : 1;
    const stack: InventoryStack = { itemId, quantity: take };
    if (meta) stack.meta = { ...meta };
    inv.slots.push(stack);
    remaining -= take;
    added += take;
  }
  return { added, overflow: remaining };
}

export function countItem(inv: Inventory, itemId: ItemId): number {
  let n = 0;
  for (const s of inv.slots) if (s.itemId === itemId) n += s.quantity;
  return n;
}

// Removes up to `quantity`, deleting emptied slots. Returns the amount removed.
export function removeItem(inv: Inventory, itemId: ItemId, quantity = 1): number {
  let remaining = quantity;
  for (let i = inv.slots.length - 1; i >= 0 && remaining > 0; i--) {
    const slot = inv.slots[i];
    if (slot.itemId !== itemId) continue;
    const take = Math.min(slot.quantity, remaining);
    slot.quantity -= take;
    remaining -= take;
    if (slot.quantity === 0) inv.slots.splice(i, 1);
  }
  return quantity - remaining;
}

const STAT_MAX: Record<StatKey, number> = {
  hp: GAME_CONFIG.player.hpMax,
  hunger: GAME_CONFIG.player.hungerMax,
  thirst: GAME_CONFIG.player.thirstMax,
  energy: GAME_CONFIG.player.energyMax,
};

// Uses one consumable, applying its clamped effect (never overflows a stat).
export function useConsumable(state: GameState, itemId: ItemId): UseResult {
  const item = getItem(itemId);
  if (item.category !== 'consumable' || !item.effect) {
    return { ok: false, reason: `${item.displayName} 不可使用` };
  }
  if (countItem(state.player.inventory, itemId) < 1) {
    return { ok: false, reason: `没有 ${item.displayName}` };
  }
  const p = state.player;
  const max = STAT_MAX[item.effect.stat];
  const before = p[item.effect.stat];
  p[item.effect.stat] = Math.min(max, before + item.effect.amount);
  removeItem(state.player.inventory, itemId, 1);
  return {
    ok: true,
    stat: item.effect.stat,
    amount: p[item.effect.stat] - before,
    stats: { hp: p.hp, hunger: p.hunger, thirst: p.thirst, energy: p.energy },
  };
}
