import { GAME_CONFIG } from '../core/config';
import { getItem } from '../data/items';
import type { AilmentId, GameState, Inventory, InventoryStack, ItemId, StatKey } from '../core/gameTypes';
import { waterRestoreMult } from './relics';
import { applyCure } from './SicknessSystem';

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
  /** ailments the item cleared, if any */
  cured?: AilmentId[];
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

// True when no slot is free. Loot deliberately stays where it is in this state
// (see lootContainer), so the player needs to be able to see the state rather
// than be told about it once for 1.6 seconds (B3-02 §4.2).
export function isBagFull(inv: Inventory): boolean {
  return inv.slots.length >= inv.slotCount;
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

export const STAT_MAX: Record<StatKey, number> = {
  hp: GAME_CONFIG.player.hpMax,
  hunger: GAME_CONFIG.player.hungerMax,
  thirst: GAME_CONFIG.player.thirstMax,
  energy: GAME_CONFIG.player.energyMax,
};

// Display names for the four stats, next to their maxima because both are stat
// metadata and the refusal reason below has to name which stat is full.
export const STAT_LABEL: Record<StatKey, string> = { hp: '生命', hunger: '饱食', thirst: '水分', energy: '精力' };

// Uses one consumable, applying its clamped effect (never overflows a stat).
//
// Refuses outright when the target stat is already at max. Before this the item
// was consumed anyway, so the M1 playtest's "top up before the walk" burned three
// bottles for +20 thirst — 70 points, about 1.2 days of survival in a chapter
// whose entire water margin is 0.7 days (B3-05.1). A partial clamp is still
// allowed: 85 + 30 -> 100 wastes 10 points, but the player asked for it and the
// flash reports the real gain, so only a wholly wasted item is refused.
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
  if (before >= max) {
    return { ok: false, reason: `${item.displayName}现在不需要（${STAT_LABEL[item.effect.stat]}已满）` };
  }
  // OVERHAUL Wave B3: the water-heart relic makes every drink 50% stronger.
  // The multiplier only touches the gain, never the clamp — a full bar still
  // refuses the item, so the relic cannot be used to burn water for nothing.
  const restoreMult = item.effect.stat === 'thirst' ? waterRestoreMult(state.relics ?? []) : 1;
  p[item.effect.stat] = Math.min(max, before + item.effect.amount * restoreMult);
  removeItem(state.player.inventory, itemId, 1);
  // A medkit is not just +40 HP: it is the thing that closes a wound. Without
  // this the ailment the wanderer's hits open would only ever heal by resting,
  // and the one item whose whole purpose is medical would not do the one thing
  // a player reaches for it for.
  const cured = itemId === 'medkit' ? applyCure(state, 'medkit') : [];
  return {
    ok: true,
    stat: item.effect.stat,
    amount: p[item.effect.stat] - before,
    stats: { hp: p.hp, hunger: p.hunger, thirst: p.thirst, energy: p.energy },
    cured,
  };
}
