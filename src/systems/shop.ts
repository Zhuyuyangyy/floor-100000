import { GAME_CONFIG } from '../core/config';
import type { GameState, ItemId } from '../core/gameTypes';
import { addItem, countItem, removeItem } from './InventorySystem';
import { ensureGrowth, grantGrowthXp, tradePriceMultiplier } from '../core/growth';
import { deriveSeed, makeRng } from '../core/rng';
import { flagCount, setFlag } from './WorldFlags';

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

// ── 当日市场：priceJitter（AG-14，价格的时间维度）───────────────────────
//
// AG-05 遗留：priceJitter / productionDecay 两个钩子导出后没有任何调用方，
// 经济因此是静止的——价格不随时间动。本节把价格的时间维度接上：商人出售
// 材料的要价按 (runSeed, day) 确定性波动。同 seed 同一天两次查询必然同价
// （可复现、可存档），跨天则真的不同——"今天囤料还是明天囤料"成为一个
// 真实的小决策，与 growth.ts 的 favorRate(seed, day) 同一个设计范式。
//
// 为什么波动的只有"商人出售材料"这一侧：
// 1. 收购价（MATERIAL_SELL_PRICES）是全经济的锚："保底材料全卖 32 金"与
//    "收购价永低于找阿林换实物（battery(3)<fuse(5)、scrap(2)<wire(3)）"
//    两条硬断言钉在具体数字上，任何乘性抖动都会让 32 这个总数与等价序漂移，
//    所以硬通货的价全世界固定（AG-05 的原注释也是这个意思）。
// 2. 商品架（SHOP_STOCK）的标价由 GameScene 直接读 shopStock().price 渲染，
//    若 buy() 改收抖动的价，面板显示与实际收费就会分家（场景归 AG-11）。
// 3. 商人出售材料原本不存在（AG-05 遗留第 5 条），是本次新增的面，没有
//    既有断言钉它——波动放在新面上，硬边界零风险。
//
// 无套利是结构性的，不靠运气：要价 = max(收购价 + 1, round(基础要价 × 当日
// 行情))，买侧的熟人折扣也夹在同一个下限上（见 materialPrice）——任何
// seed、任何一天、任何 connections 等级，买价都严格高于卖价，"买价和卖价
// 用不同抖动"的套利在数学上不可能出现。
const PRICE_JITTER_MIN = 0.85;
const PRICE_JITTER_MAX = 1.15;

/** 当日行情倍率，0.85..1.15，由 (runSeed, day) 决定。禁 Math.random。 */
export function priceJitter(seed: number, day: number): number {
  const rng = makeRng(deriveSeed(seed, day, 'shop-price-jitter'));
  return PRICE_JITTER_MIN + rng.nextFloat() * (PRICE_JITTER_MAX - PRICE_JITTER_MIN);
}

// 商人出售材料的基础要价（未计当日行情与熟人折扣）。定价依据（三锚）：
// 1. NPC 易物等价序：要价保持 battery(5) < fuse(8)、scrap(4) < wire(5) 的
//    序，与收购侧同向；且要价严格高于对应易物的金币成本——一根电线的要价
//    （≥4）永远高于你付给阿林的那块废金属的收购价（2），一枚保险丝的要价
//    （≥7）永远高于那颗电池的收购价（3）：拿货去兑永远比直接买便宜，阿林
//    因此仍是更优路径，商人只是"没有易物货可兑时的现金通道"。
// 2. tier 1 保底供应 vs 全链配方需求：filter/fuse 各只有 1 个保底源却是
//    purifier/core_key 的硬门槛，要价最贵；wood 保底 2 恰好等于唯一需求
//    （门要 2），最便宜——与收购侧同一把尺。
// 3. 变现总额约束（对称）：tier 1 保底材料按本表全买 ≈ 58 金，永远高于
//    全卖的 32 金——买料做配方不会成为比搜刮更优的解，卖料买食也不会
//    （economyLoop.test.ts 两个方向都钉）。
const MATERIAL_ASK_PRICES: Partial<Record<ItemId, number>> = {
  fuse: 8,
  filter: 7,
  battery: 5,
  wire: 5,
  scrap_metal: 4,
  cloth: 4,
  wood: 4,
  tape: 4,
};

/** 商人转手的最低加价：要价永不低于收购价 + 1（无套利的结构性下限）。 */
const MATERIAL_ASK_MIN_SPREAD = 1;

/** 商人当天卖一件材料的牌价（不含熟人折扣，供面板与测试读）。 */
export function materialAsk(itemId: ItemId, seed: number, day: number): number {
  const base = MATERIAL_ASK_PRICES[itemId];
  if (base === undefined) return 0; // 商人不卖这件
  const bid = MATERIAL_SELL_PRICES[itemId] ?? 1;
  return Math.max(bid + MATERIAL_ASK_MIN_SPREAD, Math.round(base * priceJitter(seed, day)));
}

/** 当日材料货架（面板用）：按牌价从高到低，价随 (seed, day) 波动。 */
export function materialShelf(seed: number, day: number): ShopEntry[] {
  return (Object.keys(MATERIAL_ASK_PRICES) as ItemId[])
    .map((itemId) => ({ itemId, price: materialAsk(itemId, seed, day) }))
    .sort((a, b) => b.price - a.price);
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

// The material shelf price the player actually pays: the day's jittered ask
// after the same 人脉 discount the stock side uses, floored at bid + 1 so even
// a maxed-out familiar can never buy a material below the trader's own bid —
// the no-arbitrage floor survives the discount. Returns undefined for items
// the trader does not sell as materials.
function materialPrice(state: GameState, itemId: ItemId): number | undefined {
  const base = MATERIAL_ASK_PRICES[itemId];
  if (base === undefined) return undefined;
  const mult = tradePriceMultiplier(ensureGrowth(state));
  const jittered = Math.round(base * priceJitter(state.runSeed, state.day) * mult);
  return Math.max((MATERIAL_SELL_PRICES[itemId] ?? 1) + MATERIAL_ASK_MIN_SPREAD, jittered);
}

export type TradeResult =
  | { ok: true; gold: number; message: string }
  | { ok: false; reason: string };

// Buys one of the item. Atomic: no gold, no item, no change.
export function buy(state: GameState, itemId: ItemId, floor: number): TradeResult {
  const entry = shopStock(floor).find((e) => e.itemId === itemId);
  // AG-14: the trader sells materials too (buy side, AG-05 leftover #5).
  // Local stock wins over the global material shelf, so an item the trader
  // stocks on this band never silently switches to the material price.
  // Materials are the worldwide fallback — one price everywhere, the same
  // rule their bid side already follows.
  const price = entry ? shelfPrice(state, entry.price) : materialPrice(state, itemId);
  if (price === undefined) return { ok: false, reason: '商人没有这件货' };
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

// ── 投资与产业（AG-14：investedGold/ventures 的生产者）──────────────────
//
// AG-05 遗留第 2 条：growth.investedGold / growth.ventures 两个字段没有
// 生产者（终局路线 B「独立商人与产业领袖」的账本，GROWTH_INTERFACES §9）。
// 本节把它们接上：玩家把金币沉进行业，按游戏日结算收益，喂 growth.ts 的
// wealth 线（只调 grantGrowthXp 纯函数，不碰 core）。
//
// 账本形状（不能给 GameState 加字段——core/gameTypes.ts 不是本工单地盘）：
//   investedGold = 全部在册产业的成本合计（沉下去的资本）；
//   ventures     = 在册产业 id（一种一门，重复入股被拒）。
// 倒塌/亏损只改这两个字段 + player.gold，存档因此天然携带整个投资账本，
// serialize→deserialize 零特殊处理。
//
// 风险怎么触发（不是稳赚）：
// 每个游戏日跨入时（advanceGameMinutes 的日滚循环 / sleep，见
// SurvivalSystem），对每门在册产业用
//   makeRng(deriveSeed(runSeed, 当日, 'venture', 产业id))
// 依次摇两个 chance：先 collapseChance（产业倒闭，本金全损、出局），
// 再 lossChance（当日亏损，没收入但本金还在）。同 seed 同一天同一门产业
// 必然同结果（禁 Math.random，可复现）；跨天真的不同。
//
// 产量的时间维度（productionDecay）：
// 塔里的存量逐日枯竭——捡一天少一天，产业产量随结算日指数衰减，
// decay(day) = 0.97^(day-1)。所以"早入场"本身就是收益，长线不再复利。
export interface VentureDef {
  id: string;
  displayName: string;
  description: string;
  /** 入股成本（金）。 */
  cost: number;
  /** 日产率：当日毛产出 = cost × baseRate × productionDecay(当日)。 */
  baseRate: number;
  /** 当日亏损概率：当天没收入，本金还在。 */
  lossChance: number;
  /** 倒闭概率：本金全损，产业出局。 */
  collapseChance: number;
}

export const VENTURES: readonly VentureDef[] = [
  {
    id: 'water_stall',
    displayName: '宿舍水站',
    description: '在宿舍区支个水摊，路人拿脏水来换净水，你抽成。客源稳定，本小利薄。',
    cost: 40,
    baseRate: 0.05,
    lossChance: 0.06,
    collapseChance: 0.01,
  },
  {
    id: 'scrap_caravan',
    displayName: '废铁商路',
    description: '按期去维修层收废铁，转手给上头吃差价。塔里的废铁捡一天少一天。',
    cost: 80,
    baseRate: 0.1,
    lossChance: 0.12,
    collapseChance: 0.03,
  },
  {
    id: 'ration_route',
    displayName: '口粮暗线',
    description: '从食堂倒出口粮的暗线，利润最厚；被查扣一次，整条线全没。',
    cost: 120,
    baseRate: 0.16,
    lossChance: 0.2,
    collapseChance: 0.06,
  },
];

/** 产量衰减基数：每过一天，全塔可采储量乘以 0.97。 */
export const PRODUCTION_DECAY_BASE = 0.97;
/** 当日产量系数：第 1 天 1.0，逐日指数衰减（存量枯竭）。 */
export function productionDecay(day: number): number {
  return Math.pow(PRODUCTION_DECAY_BASE, Math.max(0, Math.floor(day) - 1));
}

/** 完成一笔产业投资的 wealth 经验（GROWTH_INTERFACES §5 契约表）。 */
export const VENTURE_INVEST_XP = 50;
/** 每个有收入的投资日的 wealth 经验（本次新增的生产者，契约表未列）。 */
export const VENTURE_DAY_XP = 5;

// 结算水位标记：已经结算到哪一天。放在 state.flags（WorldFlags 的平地，
// flagCount/setFlag 只读不改那个文件）而不是新字段——core/gameTypes.ts
// 不可改；水位标记同时保证任何调用方（包括未来一个"查看收益"的面板按钮）
// 在同一天内重复调用不会重复结算刷钱。
const SETTLED_DAY_FLAG = 'economy:settled-day';

export interface VentureSettlement {
  /** 结算的是哪一天（刚结束的那天）。 */
  day: number;
  paid: Array<{ id: string; income: number }>;
  /** 当日亏损的产业（没收入，本金还在）。 */
  lossDays: string[];
  /** 当日倒闭的产业（本金全损，出局）。 */
  collapsed: string[];
  totalIncome: number;
}

// 产业按日结算：结算"刚结束的那一天"（state.day - 1）。由 SurvivalSystem
// 的跨日路径调用（advanceGameMinutes 的日滚循环与 sleep），无投资时是
// no-op（只写水位标记）。幂等：同一天重复调用第二次起直接返回空账。
export function settleInvestments(state: GameState): VentureSettlement {
  const empty = (): VentureSettlement => ({ day: 0, paid: [], lossDays: [], collapsed: [], totalIncome: 0 });
  if (state.status !== 'playing') return empty();
  const day = state.day - 1; // 刚结束的那天
  if (day < 1) return empty();
  if (flagCount(state, SETTLED_DAY_FLAG) >= day) return empty(); // 这天结过了
  const growth = ensureGrowth(state);
  const report: VentureSettlement = { day, paid: [], lossDays: [], collapsed: [], totalIncome: 0 };
  // 遍历副本：倒塌会从在册列表除名，边遍历边改必须拿副本。
  for (const id of [...growth.ventures]) {
    const def = VENTURES.find((v) => v.id === id);
    if (!def) continue; // 不认识的 id 不清账（存档宽容），但也不产收入
    const rng = makeRng(deriveSeed(state.runSeed, day, 'venture', id));
    if (rng.chance(def.collapseChance)) {
      const idx = growth.ventures.indexOf(id);
      if (idx >= 0) growth.ventures.splice(idx, 1);
      growth.investedGold = Math.max(0, growth.investedGold - def.cost);
      report.collapsed.push(id);
      continue;
    }
    if (rng.chance(def.lossChance)) {
      report.lossDays.push(id);
      continue;
    }
    const income = Math.max(1, Math.round(def.cost * def.baseRate * productionDecay(day)));
    state.player.gold += income;
    report.paid.push({ id, income });
    report.totalIncome += income;
  }
  // 只在真有收入时喂 wealth：亏损与倒闭教不了东西（与 AG-05"被拒绝的
  // 交易不给 XP"同一哲学）。grantGrowthXp 会换走 state.growth 的对象引用，
  // 但上面的数组/字段变更在 spread 里原样保留，所以放在循环外一次发完。
  if (report.paid.length > 0) {
    grantGrowthXp(state, 'wealth', VENTURE_DAY_XP * report.paid.length);
  }
  setFlag(state, SETTLED_DAY_FLAG, day);
  return report;
}

export type InvestResult =
  | { ok: true; gold: number; message: string }
  | { ok: false; reason: string };

// 入股一门产业：金 → investedGold + ventures，wealth +50。原子——被拒时
// 金币、账本、经验一律不动。
export function invest(state: GameState, ventureId: string): InvestResult {
  const def = VENTURES.find((v) => v.id === ventureId);
  if (!def) return { ok: false, reason: '没有这门生意' };
  const growth = ensureGrowth(state);
  if (growth.ventures.includes(ventureId)) return { ok: false, reason: '已经入过这门股了' };
  if (state.player.gold < def.cost) return { ok: false, reason: `金币不够（需要 ${def.cost}）` };
  state.player.gold -= def.cost;
  growth.investedGold += def.cost;
  growth.ventures.push(ventureId);
  // 契约 §5：完成一笔产业投资 +50（wealth）。
  grantGrowthXp(state, 'wealth', VENTURE_INVEST_XP);
  return { ok: true, gold: state.player.gold, message: `入股 ${def.displayName}（-${def.cost} 金）` };
}

// Config hook so the shop's existence is tunable from the balance file.
export const SHOP_ENABLED = GAME_CONFIG.overhaul.dailyGoalRewardScore >= 0;

export { TRADER_CLEARANCE };
