import { addItem, countItem, removeItem } from './InventorySystem';
import { getItem } from '../data/items';
import type { BarterOffer } from '../data/npcs';
import type { GameState, Inventory, ItemId } from '../core/gameTypes';

// Atomic item-for-item barter (docs/03_TASKS.md#p0-06). Both preconditions are
// checked before any mutation, so a failed trade never leaves a half-exchange.

// Free capacity for an item: room in partial stacks of the same id + empty slots.
export function canFit(inv: Inventory, itemId: ItemId, quantity: number): boolean {
  const item = getItem(itemId);
  let capacity = 0;
  for (const slot of inv.slots) {
    if (item.stackable && slot.itemId === itemId && slot.quantity < item.maxStack) {
      capacity += item.maxStack - slot.quantity;
    }
  }
  const freeSlots = inv.slotCount - inv.slots.length;
  capacity += item.stackable ? freeSlots * item.maxStack : freeSlots;
  return capacity >= quantity;
}

export type TradeResult =
  | { ok: true; give: { itemId: ItemId; quantity: number }; get: { itemId: ItemId; quantity: number } }
  | { ok: false; reason: string };

export function trade(state: GameState, offer: BarterOffer): TradeResult {
  const inv = state.player.inventory;
  if (countItem(inv, offer.get.itemId) < offer.get.quantity) {
    return { ok: false, reason: `你没有足够的${getItem(offer.get.itemId).displayName}` };
  }
  if (!canFit(inv, offer.give.itemId, offer.give.quantity)) {
    return { ok: false, reason: '背包空间不足' };
  }
  removeItem(inv, offer.get.itemId, offer.get.quantity);
  addItem(inv, offer.give.itemId, offer.give.quantity);
  return { ok: true, give: offer.give, get: offer.get };
}
