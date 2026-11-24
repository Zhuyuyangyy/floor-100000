import { describe, expect, it } from 'vitest';
import type { CompetitionActionProposal } from './competition-contract';
import { executeCompetitionProposal, type CompetitionDemoState } from './competitionExecutor';
import {
  COMPETITION_TRUST_BASE,
  COMPETITION_TRUST_THRESHOLDS,
  createCompetitionDemoNpc,
  validateCompetitionProposal,
} from './competitionRules';

function state(overrides: Partial<CompetitionDemoState> = {}): CompetitionDemoState {
  const value: CompetitionDemoState = {
    currentFloor: 8,
    player: { position: { floor: 8, x: 100 }, inventory: [{ itemId: 'wire', quantity: 3 }, { itemId: 'wood', quantity: 3 }] },
    npcs: [{
      npcId: 'alin', position: { floor: 8, x: 120 }, status: 'available', trust: 50,
      inventory: [{ itemId: 'battery', quantity: 2 }, { itemId: 'wire', quantity: 1 }],
    }],
    gates: [{ gateId: 'gate-8-west', floor: 8, status: 'blocked' }],
    appliedOperationIds: new Set(),
  };
  return { ...value, ...overrides };
}
const give: CompetitionActionProposal = {
  kind: 'give', transfer: { from: 'player', to: { kind: 'npc', npcId: 'alin' }, itemId: 'wire', quantity: 1 },
};
const trade: CompetitionActionProposal = {
  kind: 'trade', npcId: 'alin',
  playerGives: { from: 'player', to: { kind: 'npc', npcId: 'alin' }, itemId: 'wood', quantity: 2 },
  playerReceives: { from: { kind: 'npc', npcId: 'alin' }, to: 'player', itemId: 'battery', quantity: 1 },
};
const repair: CompetitionActionProposal = { kind: 'repair_gate', gateId: 'gate-8-west', materials: [{ itemId: 'wood', quantity: 2 }] };
const repairPolicy = { repairMaterials: [{ itemId: 'wood' as const, quantity: 2 }], repairNpcByGate: { 'gate-8-west': 'alin' } };

describe('competitionRules: sealed NPC demo domain validation', () => {
  it('keeps agreed trust baseline and 40/70 gates explicit', () => {
    expect(COMPETITION_TRUST_BASE).toBe(35);
    expect(COMPETITION_TRUST_THRESHOLDS).toEqual({ transaction: 40, repairGate: 70 });
    expect(createCompetitionDemoNpc({ npcId: 'new-demo', position: { floor: 1, x: 0 }, status: 'available', inventory: [] }).trust).toBe(35);
  });
  it('rejects unknown kinds and refuses unsupported whitelisted kinds as non-mutating', () => {
    expect(validateCompetitionProposal(state(), { kind: 'attack' }).reason).toBe('invalid_target');
    const knownButNotImplemented = validateCompetitionProposal(state(), { kind: 'observe' });
    expect(knownButNotImplemented.accepted).toBe(false);
    if (!knownButNotImplemented.accepted) expect(knownButNotImplemented.expectedStateDelta.inventory).toEqual([]);
  });
  it('validates directions, trust threshold, item possession, and exact repair recipe', () => {
    expect(validateCompetitionProposal(state(), give).accepted).toBe(true);
    expect(validateCompetitionProposal(state({ npcs: [{ ...state().npcs[0]!, trust: 39 }] }), give).reason).toBe('low_trust');
    expect(validateCompetitionProposal(state(), {
      kind: 'give', transfer: { from: 'player', to: 'player', itemId: 'wire', quantity: 1 },
    }).accepted).toBe(false);
    expect(validateCompetitionProposal(state(), trade).accepted).toBe(true);
    const lowTrust = state({ npcs: [{ ...state().npcs[0]!, trust: 69 }] });
    expect(validateCompetitionProposal(lowTrust, repair, repairPolicy).reason).toBe('low_trust');
    expect(validateCompetitionProposal(state(), repair).reason).toBe('invalid_target');
    expect(validateCompetitionProposal(state(), repair, repairPolicy).accepted).toBe(false); // trust is below 70
    const trusted = state({ npcs: [{ ...state().npcs[0]!, trust: 70 }] });
    expect(validateCompetitionProposal(trusted, repair, repairPolicy).accepted).toBe(true);
  });
  it('returns contract expected deltas without inventing trust gains or recipe values', () => {
    const checked = validateCompetitionProposal(state(), trade);
    expect(checked.accepted).toBe(true);
    if (checked.accepted) {
      expect(checked.expectedStateDelta.inventory).toEqual([
        { owner: 'player', itemId: 'wood', quantityDelta: -2 },
        { owner: { kind: 'npc', npcId: 'alin' }, itemId: 'wood', quantityDelta: 2 },
        { owner: { kind: 'npc', npcId: 'alin' }, itemId: 'battery', quantityDelta: -1 },
        { owner: 'player', itemId: 'battery', quantityDelta: 1 },
      ]);
      expect(checked.expectedStateDelta.trust).toEqual([]);
    }
    const withConfiguredDelta = validateCompetitionProposal(state(), give, { trustDeltas: { give: 2 } });
    expect(withConfiguredDelta.accepted && withConfiguredDelta.expectedStateDelta.trust).toEqual([{ npcId: 'alin', delta: 2 }]);
  });
  it('supports too_far only when an explicit interaction radius is configured', () => {
    const far = state({ player: { position: { floor: 8, x: 0 }, inventory: [{ itemId: 'wire', quantity: 1 }] } });
    expect(validateCompetitionProposal(far, give, { maxInteractionDistance: 10 }).reason).toBe('too_far');
  });
  it('rejects an exchange that exceeds explicitly configured inventory slots before execution', () => {
    const demo = state();
    const result = executeCompetitionProposal(demo, trade, { operationId: 'trade-full', policy: { inventorySlotLimit: 2 } });
    expect(result.status).toBe('rejected');
    expect(result.status === 'rejected' && result.validation.detailCode).toBe('inventory_capacity_exceeded');
    expect(demo.player.inventory).toEqual([{ itemId: 'wire', quantity: 3 }, { itemId: 'wood', quantity: 3 }]);
    expect(demo.npcs[0]?.inventory).toEqual([{ itemId: 'battery', quantity: 2 }, { itemId: 'wire', quantity: 1 }]);
  });
  it('rejects transfer of metadata-bearing stacks because the contract cannot represent the metadata', () => {
    const demo = state({ player: { ...state().player, inventory: [{ itemId: 'wire', quantity: 1, meta: { serial: 'x' } }] } });
    const checked = validateCompetitionProposal(demo, give);
    expect(checked.accepted).toBe(false);
    if (!checked.accepted) expect(checked.detailCode).toBe('item_metadata_not_supported');
  });
});

describe('competitionExecutor: no rejected side effects, atomic exchanges, idempotency', () => {
  it('never mutates on validation rejection, including an unconfigured repair recipe', () => {
    const demo = state();
    const before = JSON.stringify({ player: demo.player, npcs: demo.npcs, gates: demo.gates, ids: [...demo.appliedOperationIds] });
    const result = executeCompetitionProposal(demo, repair, { operationId: 'op-repair-unconfigured' });
    expect(result.status).toBe('rejected');
    expect(JSON.stringify({ player: demo.player, npcs: demo.npcs, gates: demo.gates, ids: [...demo.appliedOperationIds] })).toBe(before);
  });
  it('commits a bilateral trade together and reports the expected delta as actual', () => {
    const demo = state();
    const result = executeCompetitionProposal(demo, trade, { operationId: 'trade-1' });
    expect(result.status).toBe('executed');
    expect(demo.player.inventory).toEqual([{ itemId: 'wire', quantity: 3 }, { itemId: 'wood', quantity: 1 }, { itemId: 'battery', quantity: 1 }]);
    expect(demo.npcs[0]?.inventory).toEqual([{ itemId: 'battery', quantity: 1 }, { itemId: 'wire', quantity: 1 }, { itemId: 'wood', quantity: 2 }]);
    if (result.status === 'executed') expect(result.actualStateDelta).toEqual(result.validation.expectedStateDelta);
  });
  it('does not consume an operation id on rejection, then executes configured gate repair once', () => {
    const demo = state({ npcs: [{ ...state().npcs[0]!, trust: 70 }] });
    const missing = executeCompetitionProposal(demo, repair, { operationId: 'repair-1' });
    expect(missing.status).toBe('rejected');
    expect(demo.appliedOperationIds.has('repair-1')).toBe(false);
    const policy = { ...repairPolicy, trustDeltas: { repair_gate: 1 } };
    const repaired = executeCompetitionProposal(demo, repair, { operationId: 'repair-1', policy });
    expect(repaired.status).toBe('executed');
    expect(demo.gates[0]?.status).toBe('open');
    expect(demo.player.inventory).toEqual([{ itemId: 'wire', quantity: 3 }, { itemId: 'wood', quantity: 1 }]);
    expect(demo.npcs[0]?.trust).toBe(71);
  });
  it('executes a repeated operation id at most once', () => {
    const demo = state();
    expect(executeCompetitionProposal(demo, give, { operationId: 'gift-1' }).status).toBe('executed');
    const afterFirst = JSON.stringify({ player: demo.player.inventory, npc: demo.npcs[0]?.inventory, trust: demo.npcs[0]?.trust });
    const repeat = executeCompetitionProposal(demo, give, { operationId: 'gift-1' });
    expect(repeat.status).toBe('duplicate');
    expect(repeat.actualStateDelta).toBeNull();
    expect(JSON.stringify({ player: demo.player.inventory, npc: demo.npcs[0]?.inventory, trust: demo.npcs[0]?.trust })).toBe(afterFirst);
  });
});
