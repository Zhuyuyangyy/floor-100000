import { GAME_CONFIG } from '../core/config';
import type { GameState, ItemId } from '../core/gameTypes';
import { addItem, countItem, removeItem } from './InventorySystem';
import { ensureGrowth, grantGrowthXp, tradePriceMultiplier } from '../core/growth';

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

// B5 断点修复（一）：材料收购价。
//
// 修前：sellPrice 对商店不上架的物品一律跌到 1 金地板价。15 件物品里 8 件是
// 材料（battery/scrap_metal/wood/cloth/tape/filter/wire/fuse），于是"拾荒
// 换钱"从未存在过——tier 1 保底材料全部变卖只值 8×1=8 金，还不够半份口粮
// （ration_pack 买价 18 金）。配方是材料的一次性 sink，建完之后整包材料压
// 在 12 格背包里没有任何出口。
//
// 定价依据（三锚，全部可复算）：
// 1. NPC 易物等价：阿林 scrap↔wire、battery↔fuse 都是 1:1（data/npcs.ts），
//    说明设计心智里这两对等价；收购价保持 battery(3) < fuse(5)、
//    scrap(2) < wire(3) 的序，且都严格低于"找阿林换实物"的期望价值——
//    商人收购是保底，不是最优路径。
// 2. tier 1 保底供应 vs 全链配方需求：filter/fuse 各只有 1 个保底源
//    （F4 电箱）却是 purifier/core_key 的硬门槛，最贵；wood 保底 2 恰好
//    等于唯一需求（门要 2），不竞争，最便宜。
// 3. 变现总额约束：tier 1 保底材料按本表全卖约 32 金 ≈ 2 瓶水 + 1 份口粮，
//    永远低于"拿 scrap+filter+wire 做净水器换无限脏水转化"的价值——卖料
//    买食不会成为比做配方更优的解。
//
// 材料价全世界统一（不随楼层 band 变）：硬通货不该在 3 楼一个价、100 楼
// 另一个价，这也是"价格无来源"的另一半。
const MATERIAL_SELL_PRICES: Partial<Record<ItemId, number>> = {
  fuse: 5,
  filter: 4,
  battery: 3,
  wire: 3,
  scrap_metal: 2,
  cloth: 2,
  wood: 2,
  tape: 2,
};

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
  // Same ladder as the stock table's comment claims: the higher the floor, the
  // better the stock. The old fallback handed every unlisted floor the cheapest
  // band, so the industrial tier traded at floor-2 prices.
  for (const key of Object.keys(SHOP_STOCK).map(Number).sort((a, b) => b - a)) {
    if (key <= floor) return SHOP_STOCK[key];
  }
  return SHOP_STOCK[2];
}

// What the trader pays for the player's things. Sell prices are the buy price
// of the closest band, floored at 1 — a trader never pays zero, but never
// retail either. Materials are priced from MATERIAL_SELL_PRICES first: a
// global hard-currency rate, not a band price, and no longer the 1-gold floor
// that made scavenging worthless (B5 break #1).
export function sellPrice(itemId: ItemId, floor: number): number {
  const material = MATERIAL_SELL_PRICES[itemId];
  if (material !== undefined) return material;
  for (const band of [floor, 5, 4, 3, 2]) {
    for (const e of SHOP_STOCK[band] ?? []) {
      if (e.itemId === itemId) return Math.max(1, Math.floor(e.price / 2));
    }
  }
  return 1;
}

// The shelf price after the 人脉 (connections) line's trade discount:
// 1 - 0.03 x (level - 1), floored at 0.7 (core/growth.ts tradePriceMultiplier).
// Read through growth.ts's own function — the multiplier's formula lives there
// and nowhere else, so this is the one place the shop applies it (B5 break #4:
// the shop was the registered consumer and never consumed).
//
// Buy side only: a familiar buys cheaper. The sell side deliberately keeps the
// half-price spread so a round-trip still loses money at every connections
// level — a discount on both sides would turn "熟人价" into an arbitrage loop
// (shop.test.ts pins the round-trip loss; it must hold with the discount too).
function shelfPrice(state: GameState, base: number): number {
  const mult = tradePriceMultiplier(ensureGrowth(state));
  return Math.max(1, Math.round(base * mult));
}

export type TradeResult =
  | { ok: true; gold: number; message: string }
  | { ok: false; reason: string };

// Buys one of the item. Atomic: no gold, no item, no change.
export function buy(state: GameState, itemId: ItemId, floor: number): TradeResult {
  const entry = shopStock(floor).find((e) => e.itemId === itemId);
  if (!entry) return { ok: false, reason: '商人没有这件货' };
  const price = shelfPrice(state, entry.price);
  if (state.player.gold < price) return { ok: false, reason: `金币不够（需要 ${price}）` };
  const r = addItem(state.player.inventory, itemId, 1);
  if (r.overflow > 0) return { ok: false, reason: '背包已满，放不下' };
  state.player.gold -= price;
  // B5: a completed purchase is the wealth line's "交易达成 +10"
  // (docs/plans/GROWTH_INTERFACES.md §5). Granted after the atomic commit so a
  // refused trade teaches nothing.
  grantGrowthXp(state, 'wealth', 10);
  return { ok: true, gold: state.player.gold, message: `买下 1 件（-${price} 金）` };
}

// Sells one of the item. Atomic the same way.
export function sell(state: GameState, itemId: ItemId, floor: number): TradeResult {
  if (countItem(state.player.inventory, itemId) < 1) return { ok: false, reason: `没有这件货` };
  const price = sellPrice(itemId, floor);
  removeItem(state.player.inventory, itemId, 1);
  state.player.gold += price;
  // B5: "搜刮出售 +5" — the sell half of the wealth line, now a real behaviour
  // rather than a table row nobody fed (materials finally have a buyer).
  grantGrowthXp(state, 'wealth', 5);
  return { ok: true, gold: state.player.gold, message: `卖出 1 件（+${price} 金）` };
}

// The HUD's gold line.
export function goldOf(state: GameState): number {
  return state.player.gold;
}

// Config hook so the shop's existence is tunable from the balance file.
export const SHOP_ENABLED = GAME_CONFIG.overhaul.dailyGoalRewardScore >= 0;

export { TRADER_CLEARANCE };
