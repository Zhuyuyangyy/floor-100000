import { COMPETITION_ACTION_KINDS } from './competition-contract';
import type {
  CompetitionActor,
  CompetitionStateDelta,
  CompetitionValidationReason,
  CompetitionValidationResult,
  CompetitionPositionSnapshot,
} from './competition-contract';
import type { InventoryStack, ItemId } from '../core/gameTypes';
import { getItem, isItemId } from '../data/items';

/** The agreed NPC-demo starting relationship value; it is not a live-game rule. */
export const COMPETITION_TRUST_BASE = 35;
/** Transaction and repair gates from the competition demo plan. */
export const COMPETITION_TRUST_THRESHOLDS = Object.freeze({ transaction: 40, repairGate: 70 });

export type CompetitionMutationKind = 'give' | 'trade' | 'repair_gate';
export interface CompetitionDemoInventoryOwner {
  readonly inventory: readonly InventoryStack[];
}
export interface CompetitionDemoNpc extends CompetitionDemoInventoryOwner {
  readonly npcId: string;
  readonly trust: number;
  readonly status: 'available' | 'busy' | 'hostile' | 'absent';
  readonly position: CompetitionPositionSnapshot;
}
/** Create a demo NPC with the agreed baseline; callers may supply a saved demo value. */
export function createCompetitionDemoNpc(
  npc: Omit<CompetitionDemoNpc, 'trust'> & { readonly trust?: number },
): CompetitionDemoNpc {
  return { ...npc, trust: npc.trust ?? COMPETITION_TRUST_BASE };
}
export interface CompetitionDemoValidationState {
  readonly player: CompetitionDemoInventoryOwner & { readonly position: CompetitionPositionSnapshot };
  readonly npcs: readonly CompetitionDemoNpc[];
  readonly gates: readonly {
    readonly gateId: string;
    readonly floor: number;
    readonly status: 'open' | 'closed' | 'blocked' | 'broken';
  }[];
  readonly currentFloor: number;
}
/**
 * Values absent from the agreed plan remain deliberately unconfigured. In
 * particular, no repair recipe, interaction radius, or relationship gain is
 * invented here. A configured repair recipe is an exact required material set.
 */
export interface CompetitionRulesPolicy {
  readonly repairMaterials?: readonly InventoryStack[];
  /** Minimum player stock reserved for progression while the related gate is closed. */
  readonly reservedPlayerMaterials?: readonly InventoryStack[];
  /** Required to bind a gate repair trust check to a specific NPC. */
  readonly repairNpcByGate?: Readonly<Record<string, string>>;
  readonly maxInteractionDistance?: number;
  /** Optional because the read-only contract snapshot has no slot-count field. */
  readonly inventorySlotLimit?: number;
  readonly trustDeltas?: Partial<Readonly<Record<CompetitionMutationKind, number>>>;
  /**
   * 各动作的信任门槛；缺省回落 `COMPETITION_TRUST_THRESHOLDS`。
   *
   * 为什么门槛需要可配：`repairGate: 70` 是竞赛 demo 的单一数值，但首章的
   * 停电危机要按玩家与这位居民的交情分档（合作 / 中立 / 谨慎三档门槛不同），
   * 那不是一个 demo 常量能表达的。之前因为没有这个口子，场景层只能自己写一套
   * 裁决逻辑，规则就分裂成了两份。
   *
   * 门槛是「这位居民愿不愿意跟你一起干」的事，本来就该由场景给，不是全局常量。
   * 不传时行为与之前完全一致，所以现有调用方无需改动。
   */
  readonly trustThresholds?: Partial<Readonly<Record<CompetitionMutationKind, number>>>;
}

/** 解析单条规则的门槛：policy 优先，否则用 demo 缺省值。
 *
 * `COMPETITION_TRUST_THRESHOLDS` 的键（transaction / repairGate）与
 * `CompetitionMutationKind`（give / trade / repair_gate）不是同一套命名，
 * 所以这里显式映射，而不是拿 kind 直接索引常量——直接索引会拿到 undefined，
 * 表现为「门槛消失、谁都能交易」，而且 TypeScript 不报错。
 */
function defaultThresholdOf(kind: CompetitionMutationKind): number {
  return kind === 'repair_gate'
    ? COMPETITION_TRUST_THRESHOLDS.repairGate
    : COMPETITION_TRUST_THRESHOLDS.transaction;
}

function thresholdFor(policy: CompetitionRulesPolicy, kind: CompetitionMutationKind): number {
  const configured = policy.trustThresholds?.[kind];
  return typeof configured === 'number' && Number.isFinite(configured)
    ? configured
    : defaultThresholdOf(kind);
}

const EMPTY_DELTA: CompetitionStateDelta = Object.freeze({
  inventory: [], trust: [], relationships: [], memoryAdded: [], flags: [], hp: [], positions: [], gateStatus: [], elapsedMinutes: 0,
});
const MUTATION_KINDS: ReadonlySet<string> = new Set(['give', 'trade', 'repair_gate']);

export function emptyCompetitionDelta(): CompetitionStateDelta {
  return EMPTY_DELTA;
}
function reject(reason: Exclude<CompetitionValidationReason, 'ok'>, detailCode?: string): CompetitionValidationResult {
  return { accepted: false, reason, expectedStateDelta: EMPTY_DELTA, ...(detailCode ? { detailCode } : {}) };
}
function inventoryDeltas(entries: readonly { owner: CompetitionActor; itemId: ItemId; quantityDelta: number }[]): CompetitionStateDelta['inventory'] {
  const sums = new Map<string, { owner: CompetitionActor; itemId: ItemId; quantityDelta: number }>();
  for (const entry of entries) {
    const key = `${typeof entry.owner === 'string' ? entry.owner : `npc:${entry.owner.npcId}`}\u0000${entry.itemId}`;
    const prior = sums.get(key);
    if (prior) prior.quantityDelta += entry.quantityDelta;
    else sums.set(key, { ...entry });
  }
  return [...sums.values()].filter((entry) => entry.quantityDelta !== 0);
}
function hasItems(inventory: readonly InventoryStack[], itemId: ItemId, quantity: number): boolean {
  return inventory.reduce((total, stack) => total + (stack.itemId === itemId ? stack.quantity : 0), 0) >= quantity;
}
function hasOpaqueItemMetadata(inventory: readonly InventoryStack[], itemId: ItemId): boolean {
  return inventory.some((stack) => stack.itemId === itemId && stack.meta !== undefined);
}
function validInventory(inventory: readonly InventoryStack[]): boolean {
  return Array.isArray(inventory) && inventory.every((stack) =>
    !!stack && isItemId(stack.itemId) && Number.isSafeInteger(stack.quantity) && stack.quantity > 0 && stack.quantity <= getItem(stack.itemId).maxStack,
  );
}
function validTransfer(transfer: unknown): transfer is { from: unknown; to: unknown; itemId: ItemId; quantity: number } {
  if (!transfer || typeof transfer !== 'object') return false;
  const value = transfer as Record<string, unknown>;
  return isItemId(value.itemId as string) && Number.isSafeInteger(value.quantity) && (value.quantity as number) > 0 &&
    (value.quantity as number) <= getItem(value.itemId as ItemId).maxStack;
}
function actorNpcId(actor: unknown): string | null {
  if (!actor || typeof actor !== 'object') return null;
  const item = actor as Record<string, unknown>;
  return item.kind === 'npc' && typeof item.npcId === 'string' ? item.npcId : null;
}
function actorLabel(actor: 'player' | { readonly kind: 'npc'; readonly npcId: string }): string {
  return actor === 'player' ? 'player' : `npc:${actor.npcId}`;
}
function npcById(state: CompetitionDemoValidationState, npcId: string): CompetitionDemoNpc | undefined {
  return state.npcs.find((npc) => npc.npcId === npcId);
}
function proximityReason(
  player: CompetitionDemoValidationState['player'], npc: CompetitionDemoNpc, state: CompetitionDemoValidationState, policy: CompetitionRulesPolicy,
): Exclude<CompetitionValidationReason, 'ok'> | null {
  if (npc.position.floor !== state.currentFloor || player.position.floor !== state.currentFloor) return 'too_far';
  const range = policy.maxInteractionDistance;
  if (range !== undefined) {
    if (!Number.isFinite(range) || range < 0) return 'invalid_target';
    if (Math.hypot(player.position.x - npc.position.x) > range) return 'too_far';
  }
  return null;
}
function configuredDelta(policy: CompetitionRulesPolicy, kind: CompetitionMutationKind): number | null {
  const value = policy.trustDeltas?.[kind];
  return value === undefined ? 0 : Number.isFinite(value) ? value : null;
}
function validMaterialsEqual(provided: readonly InventoryStack[], required: readonly InventoryStack[]): boolean {
  if (!validInventory(provided) || !validInventory(required)) return false;
  const aggregate = (items: readonly InventoryStack[]) => {
    const totals = new Map<string, number>();
    for (const item of items) totals.set(item.itemId, (totals.get(item.itemId) ?? 0) + item.quantity);
    return totals;
  };
  const a = aggregate(provided), b = aggregate(required);
  return a.size === b.size && [...a].every(([id, quantity]) => b.get(id) === quantity);
}
function capacityAllows(state: CompetitionDemoValidationState, delta: CompetitionStateDelta, policy: CompetitionRulesPolicy): boolean {
  const limit = policy.inventorySlotLimit;
  if (limit === undefined) return true;
  if (!Number.isSafeInteger(limit) || limit < 0) return false;
  const inventories = new Map<string, InventoryStack[]>();
  inventories.set('player', state.player.inventory.map((stack) => ({ ...stack })));
  for (const npc of state.npcs) inventories.set(`npc:${npc.npcId}`, npc.inventory.map((stack) => ({ ...stack })));
  const changes = delta.inventory;
  const apply = (owner: string, itemId: ItemId, amount: number): boolean => {
    const inventory = inventories.get(owner);
    if (!inventory) return false;
    if (amount < 0) {
      let remaining = -amount;
      for (let i = inventory.length - 1; i >= 0 && remaining > 0; i--) {
        if (inventory[i]!.itemId !== itemId) continue;
        const moved = Math.min(inventory[i]!.quantity, remaining);
        inventory[i]!.quantity -= moved;
        remaining -= moved;
        if (inventory[i]!.quantity === 0) inventory.splice(i, 1);
      }
      return remaining === 0;
    }
    let remaining = amount;
    const item = getItem(itemId);
    if (item.stackable) for (const stack of inventory) {
      if (stack.itemId !== itemId || stack.meta !== undefined) continue;
      const moved = Math.min(item.maxStack - stack.quantity, remaining);
      stack.quantity += moved;
      remaining -= moved;
      if (remaining === 0) break;
    }
    while (remaining > 0) {
      const moved = item.stackable ? Math.min(item.maxStack, remaining) : 1;
      inventory.push({ itemId, quantity: moved });
      remaining -= moved;
    }
    return true;
  };
  const ownerKey = (owner: CompetitionActor) => owner === 'player' ? 'player' : `npc:${owner.npcId}`;
  for (const entry of changes) if (entry.quantityDelta < 0 && !apply(ownerKey(entry.owner), entry.itemId, entry.quantityDelta)) return false;
  for (const entry of changes) if (entry.quantityDelta > 0 && !apply(ownerKey(entry.owner), entry.itemId, entry.quantityDelta)) return false;
  return [...inventories.values()].every((inventory) => inventory.length <= limit);
}
function accepted(state: CompetitionDemoValidationState, policy: CompetitionRulesPolicy, delta: CompetitionStateDelta): CompetitionValidationResult {
  if (!capacityAllows(state, delta, policy)) return reject('invalid_target', 'inventory_capacity_exceeded');
  return { accepted: true, reason: 'ok', expectedStateDelta: delta };
}

/** Pure validator for the isolated competition demo; it never mutates state. */
export function validateCompetitionProposal(
  state: CompetitionDemoValidationState,
  proposal: unknown,
  policy: CompetitionRulesPolicy = {},
): CompetitionValidationResult {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return reject('invalid_target', 'malformed_proposal');
  const value = proposal as Record<string, unknown>;
  if (typeof value.kind !== 'string' || !(COMPETITION_ACTION_KINDS as readonly string[]).includes(value.kind)) {
    return reject('invalid_target', 'action_not_whitelisted');
  }
  if (!MUTATION_KINDS.has(value.kind)) return reject('invalid_target', 'action_not_supported_by_demo_executor');
  if (!validInventory(state.player.inventory)) return reject('invalid_target', 'invalid_player_inventory');

  if (value.kind === 'give') {
    const transfer = value.transfer;
    if (!validTransfer(transfer)) return reject('invalid_target', 'invalid_transfer');
    const from = (transfer as { from: unknown }).from, to = (transfer as { to: unknown }).to;
    const npcId = actorNpcId(from) ?? actorNpcId(to);
    if (npcId === null || !((from === 'player' && actorNpcId(to) === npcId) || (to === 'player' && actorNpcId(from) === npcId))) {
      return reject('invalid_target', 'invalid_transfer_direction');
    }
    const npc = npcById(state, npcId);
    if (!npc || npc.status !== 'available' || !validInventory(npc.inventory)) return reject('invalid_target', 'npc_unavailable');
    const near = proximityReason(state.player, npc, state, policy);
    if (near) return reject(near, 'npc_out_of_reach');
    if (!Number.isFinite(npc.trust)) return reject('invalid_target', 'invalid_npc_trust');
    const playerToNpc = from === 'player';
    // Trust gates what an NPC is willing to hand over, not whether it can accept
    // a player's voluntary gift. The demo starts at trust 35 and explicitly
    // requires the player to be able to give before reaching the 40 threshold.
    if (!playerToNpc && npc.trust < thresholdFor(policy, 'give')) return reject('low_trust');
    const delta = configuredDelta(policy, 'give');
    if (delta === null || !Number.isFinite(npc.trust + delta)) return reject('invalid_target', 'invalid_trust_policy');
    const itemId = transfer.itemId as ItemId, quantity = transfer.quantity as number;
    const owner = playerToNpc ? 'player' : { kind: 'npc' as const, npcId };
    const receiver = playerToNpc ? { kind: 'npc' as const, npcId } : 'player';
    const source = playerToNpc ? state.player.inventory : npc.inventory;
    if (!hasItems(source, itemId, quantity)) return reject('missing_item');
    if (hasOpaqueItemMetadata(source, itemId)) return reject('invalid_target', 'item_metadata_not_supported');
    if (playerToNpc && policy.reservedPlayerMaterials !== undefined) {
      if (!validInventory(policy.reservedPlayerMaterials)) return reject('invalid_target', 'invalid_reserved_player_materials');
      const requiredById = new Map<ItemId, number>();
      for (const required of policy.reservedPlayerMaterials) {
        requiredById.set(required.itemId, (requiredById.get(required.itemId) ?? 0) + required.quantity);
      }
      for (const [reservedId, required] of requiredById) {
        const held = state.player.inventory.reduce((total, stack) => total + (stack.itemId === reservedId ? stack.quantity : 0), 0);
        const protectedQuantity = Math.min(held, required);
        const remaining = held - (itemId === reservedId ? quantity : 0);
        if (remaining < protectedQuantity) return reject('invalid_target', 'reserved_player_materials');
      }
    }
    return accepted(state, policy, { ...EMPTY_DELTA,
      inventory: inventoryDeltas([{ owner, itemId, quantityDelta: -quantity }, { owner: receiver, itemId, quantityDelta: quantity }]),
      trust: delta === 0 ? [] : [{ npcId, delta }],
      relationships: delta === 0 ? [] : [{ npcId, trustDelta: delta }],
    });
  }

  const npcId = value.kind === 'trade' && typeof value.npcId === 'string' ? value.npcId : undefined;
  const candidateNpcId = value.kind === 'repair_gate'
    ? (typeof value.gateId === 'string' ? policy.repairNpcByGate?.[value.gateId] : undefined)
    : npcId;
  if (value.kind === 'trade' && typeof npcId !== 'string') return reject('invalid_target', 'invalid_npc_id');
  if (value.kind === 'repair_gate' && typeof value.gateId !== 'string') return reject('invalid_target', 'invalid_gate_id');
  const npc = candidateNpcId ? npcById(state, candidateNpcId) : undefined;
  if (!npc || npc.status !== 'available' || !validInventory(npc.inventory)) return reject('invalid_target', 'npc_unavailable');
  const near = proximityReason(state.player, npc, state, policy);
  if (near) return reject(near, 'npc_out_of_reach');
  if (!Number.isFinite(npc.trust)) return reject('invalid_target', 'invalid_npc_trust');

  if (value.kind === 'trade') {
    if (npc.trust < thresholdFor(policy, 'trade')) return reject('low_trust');
    const give = value.playerGives, receive = value.playerReceives;
    if (!validTransfer(give) || !validTransfer(receive)) return reject('invalid_target', 'invalid_trade_transfer');
    if ((give as { from: unknown }).from !== 'player' || actorNpcId((give as { to: unknown }).to) !== npc.npcId ||
        actorNpcId((receive as { from: unknown }).from) !== npc.npcId || (receive as { to: unknown }).to !== 'player') {
      return reject('invalid_target', 'invalid_trade_direction');
    }
    const sentId = (give as { itemId: ItemId }).itemId, sentQty = (give as { quantity: number }).quantity;
    const receivedId = (receive as { itemId: ItemId }).itemId, receivedQty = (receive as { quantity: number }).quantity;
    if (!hasItems(state.player.inventory, sentId, sentQty) || !hasItems(npc.inventory, receivedId, receivedQty)) return reject('missing_item');
    if (hasOpaqueItemMetadata(state.player.inventory, sentId) || hasOpaqueItemMetadata(npc.inventory, receivedId)) {
      return reject('invalid_target', 'item_metadata_not_supported');
    }
    const delta = configuredDelta(policy, 'trade');
    if (delta === null || !Number.isFinite(npc.trust + delta)) return reject('invalid_target', 'invalid_trust_policy');
    return accepted(state, policy, { ...EMPTY_DELTA,
      inventory: inventoryDeltas([
        { owner: 'player', itemId: sentId, quantityDelta: -sentQty },
        { owner: { kind: 'npc', npcId: npc.npcId }, itemId: sentId, quantityDelta: sentQty },
        { owner: { kind: 'npc', npcId: npc.npcId }, itemId: receivedId, quantityDelta: -receivedQty },
        { owner: 'player', itemId: receivedId, quantityDelta: receivedQty },
      ]),
      trust: delta === 0 ? [] : [{ npcId: npc.npcId, delta }],
      relationships: delta === 0 ? [] : [{ npcId: npc.npcId, trustDelta: delta }],
    });
  }

  const gate = state.gates.find((item) => item.gateId === value.gateId);
  if (!gate || gate.floor !== state.currentFloor || (gate.status !== 'closed' && gate.status !== 'blocked')) return reject('invalid_target', 'gate_not_repairable');
  if (!policy.repairNpcByGate?.[gate.gateId]) return reject('invalid_target', 'repair_npc_unconfigured');
  if (npc.trust < thresholdFor(policy, 'repair_gate')) return reject('low_trust');
  if (!policy.repairMaterials) return reject('invalid_target', 'repair_materials_unconfigured');
  if (!validMaterialsEqual(value.materials as InventoryStack[], policy.repairMaterials)) return reject('invalid_target', 'repair_materials_mismatch');
  for (const material of policy.repairMaterials) {
    if (!hasItems(state.player.inventory, material.itemId, material.quantity)) return reject('missing_item');
    if (hasOpaqueItemMetadata(state.player.inventory, material.itemId)) return reject('invalid_target', 'item_metadata_not_supported');
  }
  const delta = configuredDelta(policy, 'repair_gate');
  if (delta === null || !Number.isFinite(npc.trust + delta)) return reject('invalid_target', 'invalid_trust_policy');
  return accepted(state, policy, { ...EMPTY_DELTA,
    inventory: inventoryDeltas(policy.repairMaterials.map((material) => ({ owner: 'player' as const, itemId: material.itemId, quantityDelta: -material.quantity }))),
    trust: delta === 0 ? [] : [{ npcId: npc.npcId, delta }],
    relationships: delta === 0 ? [] : [{ npcId: npc.npcId, trustDelta: delta }],
    gateStatus: [{ gateId: gate.gateId, from: gate.status, to: 'open' }],
  });
}

/** Stable identifier helper for executor-side direction checks and diagnostics. */
export function competitionActorKey(actor: CompetitionActor): string {
  return actorLabel(actor);
}
