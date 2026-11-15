// 信誉 → 交易与态度的确定性映射（阶段 C，docs/plans/NPC.md）。
//
// 铁律：数值判定全部走本文件的纯函数——同一个 relationship 值，
// 无论调用多少次、有没有模型、模型多久返回，结果逐字节一致。
// 模型推理只负责「台词生成」（NpcRuntime → OllamaBrain），
// 价格、可选商品、赠品规则一律在这里算，不依赖任何推理时序。
//
// 信誉分级（对 player 的关系值）：
//   >= +30  trusted   老主顾：NPC 让利，给出双倍货
//   >= -20  neutral   公平交易：按 data/npcs.ts 的基准报价
//   >= -50  disliked  心生芥蒂：玩家付双倍
//   <  -50  hostile   拒不交易：报价全下架

import type { GameState, ItemId } from '../core/gameTypes';
import { getItem } from '../data/items';
import type { BarterOffer, NpcDef } from '../data/npcs';
import { trade, canFit } from '../systems/TradeSystem';
import { addItem, countItem, removeItem } from '../systems/InventorySystem';
import { recordMemory, saveNpcState } from '../systems/NpcMemory';
import type { NpcInventory, NpcPersistedState, NpcStockEntry, ReputationTier } from './types';
import {
  advanceNpcInventory,
  defaultNpcInventory,
  giveToStock,
  inventoryOf,
  stockOf,
  syncNpcInventory,
  takeFromStock,
  withInventory,
} from './npcInventory';

export const REPUTATION_THRESHOLDS = { trusted: 30, disliked: -20, hostile: -50 } as const;

/** relationship 值 → 信誉分级。纯函数，边界含等号（+30 即 trusted）。 */
export function reputationTier(relationship: number): ReputationTier {
  if (relationship >= REPUTATION_THRESHOLDS.trusted) return 'trusted';
  if (relationship >= REPUTATION_THRESHOLDS.disliked) return 'neutral';
  if (relationship >= REPUTATION_THRESHOLDS.hostile) return 'disliked';
  return 'hostile';
}

/** NPC 对玩家的信誉分级（关系缺省为 0 = neutral）。 */
export function reputationOf(npcState: NpcPersistedState, actor = 'player'): ReputationTier {
  return reputationTier(npcState.relationship[actor] ?? 0);
}

/**
 * 信誉对基准报价的修正（确定性）：
 * - trusted：NPC 让利，give 翻倍（老主顾优惠）
 * - disliked：NPC 加价，get 翻倍
 * - neutral / hostile：原样（hostile 在 availableOffers 里整体下架）
 */
export function adjustOffer(offer: BarterOffer, tier: ReputationTier): BarterOffer {
  if (tier === 'trusted') {
    return { ...offer, give: { ...offer.give, quantity: offer.give.quantity * 2 } };
  }
  if (tier === 'disliked') {
    return { ...offer, get: { ...offer.get, quantity: offer.get.quantity * 2 } };
  }
  return offer;
}

/**
 * 当前可买的报价：先按信誉修正，再按真实库存过滤（NPC 没货就下架），
 * hostile 分级整体为空。确定性：同 (inventory, npc, tier) → 同结果。
 */
export function availableOffers(inventory: NpcInventory, npc: NpcDef, tier: ReputationTier): BarterOffer[] {
  if (tier === 'hostile') return [];
  return npc.offers
    .map((offer) => adjustOffer(offer, tier))
    .filter((offer) => stockOf(inventory, offer.give.itemId) >= offer.give.quantity);
}

/** 按 id 找当前可买的报价（修正+库存过滤后）。 */
export function findAvailableOffer(
  inventory: NpcInventory,
  npc: NpcDef,
  tier: ReputationTier,
  offerId: string,
): BarterOffer | null {
  return availableOffers(inventory, npc, tier).find((o) => o.id === offerId) ?? null;
}

const FALLBACK_LINES: Record<ReputationTier, string> = {
  trusted: '冲咱们的交情，好说。',
  neutral: '拿东西换就行。',
  disliked: '现在看见你就想加价。',
  hostile: '没什么好谈的。',
};

/** 信誉分层的确定性台词：优先用 data/npcs.ts 为该居民撰写的句子。 */
export function attitudeLine(npc: NpcDef, tier: ReputationTier): string {
  return npc.attitudeLines?.[tier] ?? FALLBACK_LINES[tier];
}

/**
 * 回赠：trusted 分级且库存允许时，NPC 白送 1 件（优先自家补货物，
 * 玩家送的赠品也可能被拿出来还情）。自己 daily 要用的（needs）捂着不送——
 *  三条候选路径全都排除 needs，否则「留着口粮不送人」的注释就是假话。
 * 确定性：同输入同结果。
 */
export function giftOffer(npc: NpcDef, inventory: NpcInventory, tier: ReputationTier): { itemId: ItemId; quantity: number } | null {
  if (tier !== 'trusted') return null;
  const needed = new Set((npc.needs ?? []).map((n) => n.itemId));
  const spareOf = (e: NpcStockEntry) => !needed.has(e.itemId) && e.quantity > 0;
  // 优先补货类条目且不是自用物资，余量 > 1（给自己留一份）；
  // 其次看玩家赠品（restockPerDay === 0）；
  // 最后兜底任何余量 > 1 的非自用条目。
  const stocked = inventory.entries.find((e) => e.restockPerDay > 0 && spareOf(e) && e.quantity > 1);
  const gifted = inventory.entries.find((e) => e.restockPerDay === 0 && spareOf(e));
  const spare = inventory.entries.find((e) => spareOf(e) && e.quantity > 1);
  const pick = stocked ?? gifted ?? spare;
  if (!pick) return null;
  return { itemId: pick.itemId, quantity: 1 };
}

export interface BarterOutcome {
  ok: boolean;
  reason?: string;
  give?: { itemId: ItemId; quantity: number };
  get?: { itemId: ItemId; quantity: number };
  /** 交易后的库存（调用方无需再同步） */
  inventory?: NpcInventory;
  /** 交易后该 NPC 对玩家的关系值 */
  relationship?: number;
  /** 本次生效的信誉分级（测试/日志用） */
  tier?: ReputationTier;
}

/**
 * 执行一次 NPC 交易（原子）：校验信誉与库存 → 过 TradeSystem 守恒交易
 * → 扣 NPC 库存 → 记一条 trade 记忆并写回 npcStates。
 *
 * 失败时不改任何状态（TradeSystem 本身原子；记忆只在成功后写）。
 */
export function executeBarter(state: GameState, npc: NpcDef, offerId: string): BarterOutcome {
  const { npcState, inventory } = syncNpcInventory(state, npc);
  const tier = reputationOf(npcState);
  const offer = findAvailableOffer(inventory, npc, tier, offerId);
  if (!offer) {
    return {
      ok: false,
      reason: tier === 'hostile' ? `${npc.name}拒不交易：${attitudeLine(npc, tier)}` : `${npc.name}现在没有这件货（库存不足或已下架）`,
      tier,
    };
  }
  const result = trade(state, offer);
  if (!result.ok) return { ok: false, reason: result.reason, tier };
  const nextInventory = takeFromStock(inventory, offer.give.itemId, offer.give.quantity);
  const remembered = recordMemory(npcState, {
    day: state.day,
    minute: state.gameMinuteOfDay,
    kind: 'trade',
    actor: 'player',
    summary: `换到${getItem(offer.give.itemId).displayName}×${offer.give.quantity}`,
  });
  saveNpcState(state, npc.id, withInventory(remembered, nextInventory));
  return {
    ok: true,
    give: offer.give,
    get: offer.get,
    inventory: nextInventory,
    relationship: remembered.relationship.player,
    tier,
  };
}

/**
 * 收下玩家的赠品并入库（阶段 D 路线图闭环：赠品 → NPC 真的持有 →
 * 日后可被交易/回赠）。同时记一条 gift 记忆（关系上升）。
 *
 * AG-13 背包闭环：赠品从玩家背包**真实扣除**（先校验后扣除，失败时
 * NPC 库存/关系/记忆一律不动）。背包里没有就说没有——不再允许
 * 「无中生有的礼物」把关系刷上去。只调用 InventorySystem，不改它。
 */
export function receiveGift(state: GameState, npc: NpcDef, itemId: ItemId, quantity = 1): BarterOutcome {
  const { npcState, inventory } = syncNpcInventory(state, npc);
  const want = Math.max(0, Math.floor(quantity));
  if (want < 1) {
    return { ok: false, reason: '赠品数量无效', tier: reputationOf(npcState) };
  }
  if (countItem(state.player.inventory, itemId) < want) {
    return {
      ok: false,
      reason: `你没有足够的${getItem(itemId).displayName}，赠礼作罢`,
      tier: reputationOf(npcState),
    };
  }
  removeItem(state.player.inventory, itemId, want);
  const nextInventory = giveToStock(inventory, itemId, want);
  const remembered = recordMemory(npcState, {
    day: state.day,
    minute: state.gameMinuteOfDay,
    kind: 'gift',
    actor: 'player',
    summary: `获赠${getItem(itemId).displayName}×${want}`,
  });
  saveNpcState(state, npc.id, withInventory(remembered, nextInventory));
  return {
    ok: true,
    give: { itemId, quantity: want },
    inventory: nextInventory,
    relationship: remembered.relationship.player,
    tier: reputationOf(remembered),
  };
}

/**
 * 取出回赠礼物（从库存扣除并返回物品）；没有可送的返回 null。
 *
 * AG-13 背包闭环：回赠物品**真的进玩家背包**。装不下就整体失败
 * （背包满的明确回执）——NPC 库存和玩家背包都不动，物品绝不凭空蒸发。
 * 只调用 InventorySystem（addItem），不改它。
 */
export function claimGift(
  state: GameState,
  npc: NpcDef,
): { ok: true; itemId: ItemId; quantity: number; inventory: NpcInventory } | { ok: false; reason: string } {
  const { npcState, inventory } = syncNpcInventory(state, npc);
  const gift = giftOffer(npc, inventory, reputationOf(npcState));
  if (!gift) return { ok: false, reason: 'NPC 没有可以回赠的东西' };
  if (!canFit(state.player.inventory, gift.itemId, gift.quantity)) {
    return { ok: false, reason: `背包空间不足，装不下${getItem(gift.itemId).displayName}` };
  }
  const nextInventory = takeFromStock(inventory, gift.itemId, gift.quantity);
  const added = addItem(state.player.inventory, gift.itemId, gift.quantity);
  saveNpcState(state, npc.id, withInventory(npcState, nextInventory));
  return { ok: true, itemId: gift.itemId, quantity: added.added, inventory: nextInventory };
}

// 供测试与场景复用的读取入口：拿到「已按天结算」的库存，无需关心补货细节。
export { advanceNpcInventory, defaultNpcInventory, inventoryOf, stockOf, syncNpcInventory };
