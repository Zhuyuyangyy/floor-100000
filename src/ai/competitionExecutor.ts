import type { CompetitionActionProposal, CompetitionStateDelta, CompetitionValidationResult } from './competition-contract';
import type { InventoryStack } from '../core/gameTypes';
import { getItem } from '../data/items';
import {
  validateCompetitionProposal,
  type CompetitionDemoNpc,
  type CompetitionDemoValidationState,
  type CompetitionRulesPolicy,
} from './competitionRules';

export interface CompetitionMutableDemoNpc extends Omit<CompetitionDemoNpc, 'inventory' | 'trust'> {
  inventory: InventoryStack[];
  trust: number;
}
export interface CompetitionDemoState extends Omit<CompetitionDemoValidationState, 'player' | 'npcs' | 'gates'> {
  player: { position: CompetitionDemoValidationState['player']['position']; inventory: InventoryStack[] };
  npcs: CompetitionMutableDemoNpc[];
  gates: Array<{
    gateId: string;
    floor: number;
    status: 'open' | 'closed' | 'blocked' | 'broken';
  }>;
  /** Executor-owned deduplication ledger; not part of GameState/save data. */
  readonly appliedOperationIds: Set<string>;
}
export type CompetitionExecutionResult =
  | { readonly status: 'executed'; readonly validation: Extract<CompetitionValidationResult, { accepted: true }>; readonly actualStateDelta: CompetitionStateDelta }
  | { readonly status: 'rejected'; readonly validation: Extract<CompetitionValidationResult, { accepted: false }>; readonly actualStateDelta: null }
  | { readonly status: 'duplicate'; readonly validation: Extract<CompetitionValidationResult, { accepted: true }>; readonly actualStateDelta: null };

function cloneInventory(inventory: readonly InventoryStack[]): InventoryStack[] {
  return inventory.map((stack) => ({ ...stack, ...(stack.meta ? { meta: { ...stack.meta } } : {}) }));
}
function applyInventoryDelta(inventory: InventoryStack[], itemId: InventoryStack['itemId'], quantityDelta: number): boolean {
  if (quantityDelta < 0) {
    let remaining = -quantityDelta;
    for (let index = inventory.length - 1; index >= 0 && remaining > 0; index--) {
      const stack = inventory[index];
      if (stack.itemId !== itemId) continue;
      const moved = Math.min(stack.quantity, remaining);
      stack.quantity -= moved;
      remaining -= moved;
      if (stack.quantity === 0) inventory.splice(index, 1);
    }
    return remaining === 0;
  }
  let remaining = quantityDelta;
  const item = getItem(itemId);
  if (item.stackable) {
    for (const stack of inventory) {
      if (stack.itemId !== itemId || stack.meta !== undefined) continue;
      if (remaining === 0) break;
      const moved = Math.min(item.maxStack - stack.quantity, remaining);
      stack.quantity += moved;
      remaining -= moved;
    }
  }
  while (remaining > 0) {
    const moved = item.stackable ? Math.min(item.maxStack, remaining) : 1;
    inventory.push({ itemId, quantity: moved });
    remaining -= moved;
  }
  return true;
}
function rejected(detailCode: string): Extract<CompetitionValidationResult, { accepted: false }> {
  return {
    accepted: false,
    reason: 'invalid_target',
    expectedStateDelta: { inventory: [], trust: [], relationships: [], memoryAdded: [], flags: [], hp: [], positions: [], gateStatus: [], elapsedMinutes: 0 },
    detailCode,
  };
}
function actorNpcId(actor: { readonly kind: 'npc'; readonly npcId: string } | 'player'): string | null {
  return actor === 'player' ? null : actor.npcId;
}
/**
 * The sole state-committing entry point for the isolated NPC competition demo.
 * Rejected validation never writes, and all transfer changes are staged against
 * cloned inventories before either party is updated.
 */
export function executeCompetitionProposal(
  state: CompetitionDemoState,
  proposal: CompetitionActionProposal | unknown,
  options: { readonly operationId: string; readonly policy?: CompetitionRulesPolicy },
): CompetitionExecutionResult {
  if (typeof options?.operationId !== 'string' || options.operationId.trim() === '') {
    return { status: 'rejected', validation: rejected('invalid_operation_id'), actualStateDelta: null };
  }
  const policy = options.policy ?? {};
  if (state.appliedOperationIds.has(options.operationId)) {
    return {
      status: 'duplicate',
      validation: {
        accepted: true,
        reason: 'ok',
        expectedStateDelta: { inventory: [], trust: [], relationships: [], memoryAdded: [], flags: [], hp: [], positions: [], gateStatus: [], elapsedMinutes: 0 },
      },
      actualStateDelta: null,
    };
  }

  const validation = validateCompetitionProposal(state, proposal, policy);
  if (!validation.accepted) return { status: 'rejected', validation, actualStateDelta: null };
  const expected = validation.expectedStateDelta;
  const playerInventory = cloneInventory(state.player.inventory);
  const stagedNpcInventories = new Map<string, InventoryStack[]>();
  for (const npc of state.npcs) stagedNpcInventories.set(npc.npcId, cloneInventory(npc.inventory));
  const inventoryFor = (owner: CompetitionStateDelta['inventory'][number]['owner']): InventoryStack[] | undefined =>
    owner === 'player' ? playerInventory : stagedNpcInventories.get(actorNpcId(owner) ?? '');

  // Apply debits before credits so a same-operation exchange can free slots
  // before receiving items. No live object has been touched at this point.
  const entries = [...expected.inventory].sort((a, b) => a.quantityDelta - b.quantityDelta);
  for (const entry of entries) {
    if (entry.quantityDelta >= 0) continue;
    const target = inventoryFor(entry.owner);
    if (!target || !applyInventoryDelta(target, entry.itemId, entry.quantityDelta)) {
      return { status: 'rejected', validation: rejected('stale_or_inconsistent_inventory'), actualStateDelta: null };
    }
  }
  for (const entry of entries) {
    if (entry.quantityDelta <= 0) continue;
    const target = inventoryFor(entry.owner);
    if (!target || !applyInventoryDelta(target, entry.itemId, entry.quantityDelta)) {
      return { status: 'rejected', validation: rejected('stale_or_inconsistent_inventory'), actualStateDelta: null };
    }
  }
  if (policy.inventorySlotLimit !== undefined &&
      (playerInventory.length > policy.inventorySlotLimit || [...stagedNpcInventories.values()].some((inventory) => inventory.length > policy.inventorySlotLimit!))) {
    return { status: 'rejected', validation: rejected('inventory_capacity_unconfigured_or_exceeded'), actualStateDelta: null };
  }

  // Commit only after every side and every gate/trust target has passed staging.
  state.player.inventory.splice(0, state.player.inventory.length, ...playerInventory);
  const changedNpcIds = new Set(expected.inventory.flatMap((entry) => entry.owner === 'player' ? [] : [entry.owner.npcId]));
  for (const npc of state.npcs) {
    if (!changedNpcIds.has(npc.npcId)) continue;
    const staged = stagedNpcInventories.get(npc.npcId);
    if (staged) npc.inventory.splice(0, npc.inventory.length, ...staged);
  }
  for (const change of expected.trust) {
    const npc = state.npcs.find((item) => item.npcId === change.npcId);
    if (npc) npc.trust += change.delta;
  }
  for (const change of expected.gateStatus) {
    const gate = state.gates.find((item) => item.gateId === change.gateId);
    if (gate) gate.status = change.to;
  }
  state.appliedOperationIds.add(options.operationId);
  return { status: 'executed', validation, actualStateDelta: expected };
}
