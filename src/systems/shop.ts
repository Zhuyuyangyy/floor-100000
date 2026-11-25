import { GAME_CONFIG } from '../core/config';
import type { GameState, ItemId } from '../core/gameTypes';
import { addItem, countItem, removeItem } from './InventorySystem';

// OVERHAUL Wave C1: the shop — the economy both benchmarks run on (Centum's
// shop floor every ten, Altacima's merchants behind the question marks). One
// trader stands past the mid-point of every floor from 2 up; E opens the trade
// panel, gold buys, gold sells, and the prices are the config's, not magic
// numbers in the code.
//
// The trader is a deterministic spot (like the encounter spots) so the same
// floor always has one, and the trade itself is atomic: a failed buy changes
// nothing, the way the trader encounter's exchange already works.

export interface ShopEntry {
  itemId: ItemId;
  /** gold to buy one */
  price: number;
}

// What the trader stocks, by floor band. The ladder mirrors the loot's depth
// windows: the higher the floor, the better the stock.
const SHOP_STOCK: Record<number, readonly ShopEntry[]> = {
  2: [
    { itemId: 'bread', price: 12 },
    { itemId: 'clean_water', price: 15 },
  ],
  3: [
    { itemId: 'bread', price: 12 },
    { itemId: 'clean_water', price: 15 },
    { itemId: 'medkit', price: 40 },
  ],
  4: [
    { itemId: 'clean_water', price: 15 },
    { itemId: 'medkit', price: 40 },
    { itemId: 'crowbar', price: 60 },
  ],
  5: [
    { itemId: 'medkit', price: 40 },
    { itemId: 'crowbar', price: 60 },
    { itemId: 'ration_pack', price: 18 },
  ],
};

// The trader stands past the floor's midpoint, clear of the stairwells — the
// same nudge the encounter spots use, so a trader can never block a stair.
const TRADER_CLEARANCE = 90;

export function traderX(seed: number, floor: number): number {
  // Deterministic per (seed, floor); the caller nudges it clear of interactables.
  const h = (seed * 2654435761 + floor * 97 + 0x5f3a) >>> 0;
  return 320 + (h % 560);
}

export function shopStock(floor: number): readonly ShopEntry[] {
  return SHOP_STOCK[floor] ?? SHOP_STOCK[2];
}

// What the trader pays for the player's things. Sell prices are the buy price
// of the closest band, floored at 1 — a trader never pays zero, but never
// retail either.
export function sellPrice(itemId: ItemId, floor: number): number {
  for (const band of [floor, 5, 4, 3, 2]) {
    for (const e of SHOP_STOCK[band] ?? []) {
      if (e.itemId === itemId) return Math.max(1, Math.floor(e.price / 2));
    }
  }
  return 1;
}

export type TradeResult =
  | { ok: true; gold: number; message: string }
  | { ok: false; reason: string };

// Buys one of the item. Atomic: no gold, no item, no change.
export function buy(state: GameState, itemId: ItemId, floor: number): TradeResult {
  const entry = shopStock(floor).find((e) => e.itemId === itemId);
  if (!entry) return { ok: false, reason: '商人没有这件货' };
  if (state.player.gold < entry.price) return { ok: false, reason: `金币不够（需要 ${entry.price}）` };
  const r = addItem(state.player.inventory, itemId, 1);
  if (r.overflow > 0) return { ok: false, reason: '背包已满，放不下' };
  state.player.gold -= entry.price;
  return { ok: true, gold: state.player.gold, message: `买下 1 件（-${entry.price} 金）` };
}

// Sells one of the item. Atomic the same way.
export function sell(state: GameState, itemId: ItemId, floor: number): TradeResult {
  if (countItem(state.player.inventory, itemId) < 1) return { ok: false, reason: `没有这件货` };
  const price = sellPrice(itemId, floor);
  removeItem(state.player.inventory, itemId, 1);
  state.player.gold += price;
  return { ok: true, gold: state.player.gold, message: `卖出 1 件（+${price} 金）` };
}

// The HUD's gold line.
export function goldOf(state: GameState): number {
  return state.player.gold;
}

// Config hook so the shop's existence is tunable from the balance file.
export const SHOP_ENABLED = GAME_CONFIG.overhaul.dailyGoalRewardScore >= 0;

export { TRADER_CLEARANCE };
