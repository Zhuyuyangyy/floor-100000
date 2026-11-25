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
  // 白名单里有、但 demo 执行器不支持的 kind，必须落在固定的 detailCode 上。
  //
  // 这条分支原先只有产生点、没有任何断言：`action_not_supported_by_demo_executor`
  // 全仓 grep 只能搜到 competitionRules.ts 里那一行。写了但没人证伪的分支，
  // 下次有人「顺手」把它合并成 action_not_whitelisted、或者给 MUTATION_KINDS
  // 加上 ask，都不会有任何测试变红。
  //
  // ask 是最容易踩的那个：契约层会把 request_help 译成它（actionContract.ts），
  // 而正常路径上 runtime 已经在 validate 之前就按 availableActions 丢弃了它，
  // 所以这条兜底永远不会在生产里被触发 —— 正因如此它才需要一条直接的测试。
  it('夹具外的合法 kind（ask/inspect/pickup）落在 action_not_supported_by_demo_executor', () => {
    for (const kind of ['ask', 'inspect', 'pickup'] as const) {
      const checked = validateCompetitionProposal(state(), { kind });
      expect(checked.accepted).toBe(false);
      if (!checked.accepted) {
        expect(checked.detailCode).toBe('action_not_supported_by_demo_executor');
        // 拒绝必须是零副作用：连 expectedStateDelta 都必须是空的。
        expect(checked.expectedStateDelta.inventory).toEqual([]);
        expect(checked.expectedStateDelta.gateStatus).toEqual([]);
      }
      // 也不能被误记成「不认识这个 kind」——那是 action_not_whitelisted 的语义。
      const executed = executeCompetitionProposal(state(), { kind }, { operationId: `unsupported-${kind}` });
      expect(executed.status).toBe('rejected');
      if (executed.status === 'rejected') {
        expect(executed.validation.detailCode).toBe('action_not_supported_by_demo_executor');
      }
    }
  });
  it('validates directions, trust threshold, item possession, and exact repair recipe', () => {
    expect(validateCompetitionProposal(state(), give).accepted).toBe(true);
    const trust39 = state({ npcs: [{ ...state().npcs[0]!, trust: 39 }] });
    expect(validateCompetitionProposal(trust39, give).accepted).toBe(true); // trust does not prevent accepting a voluntary player gift
    const npcGift: CompetitionActionProposal = {
      kind: 'give', transfer: { from: { kind: 'npc', npcId: 'alin' }, to: 'player', itemId: 'battery', quantity: 1 },
    };
    expect(validateCompetitionProposal(trust39, npcGift).reason).toBe('low_trust');
    expect(validateCompetitionProposal(state({ npcs: [{ ...state().npcs[0]!, trust: 40 }] }), npcGift).accepted).toBe(true);
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
  it('reserves the minimum repair stock from voluntary gifts until the gate opens', () => {
    const giveWood: CompetitionActionProposal = {
      kind: 'give', transfer: { from: 'player', to: { kind: 'npc', npcId: 'alin' }, itemId: 'wood', quantity: 2 },
    };
    const policy = { reservedPlayerMaterials: [{ itemId: 'wood' as const, quantity: 2 }, { itemId: 'tape' as const, quantity: 1 }] };
    const rejected = validateCompetitionProposal(state(), giveWood, policy);
    expect(rejected).toMatchObject({ accepted: false, reason: 'invalid_target', detailCode: 'reserved_player_materials' });

    const oneWood = state({ player: { ...state().player, inventory: [{ itemId: 'wood', quantity: 1 }] } });
    const oneGift = { ...giveWood, transfer: { ...giveWood.transfer, quantity: 1 } };
    expect(validateCompetitionProposal(oneWood, oneGift, policy)).toMatchObject({
      accepted: false, detailCode: 'reserved_player_materials',
    });

    const surplusGift = { ...oneGift, transfer: { ...oneGift.transfer, quantity: 1 } };
    const surplus = state({ player: { ...state().player, inventory: [{ itemId: 'wood', quantity: 3 }] } });
    expect(validateCompetitionProposal(surplus, surplusGift, policy).accepted).toBe(true);
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

// 信任门槛必须可按场景配置。
//
// 首章的停电危机要按交情分档（合作 / 中立 / 谨慎三档门槛不同），而原先
// `COMPETITION_TRUST_THRESHOLDS.repairGate = 70` 是模块级常量，两处硬编码。
// 场景层拿不到口子就只能自己写一套裁决逻辑，规则分裂成两份。
//
// 这里锁住三件事：
//   1. 不传 trustThresholds 时行为与改动前完全一致（向后兼容）
//   2. 传了之后门槛真的按传入值生效（不是被忽略）
//   3. give 的门槛与 trade 共用 transaction 缺省值，不因 kind 改名而取到 undefined
describe('competitionRules: 信任门槛可按 policy 配置', () => {
  it('不传 trustThresholds 时沿用 40/70，行为与改动前一致', () => {
    // 修门：trust 69 不够，70 够。
    const at69 = state({ npcs: [{ ...state().npcs[0]!, trust: 69 }] });
    expect(validateCompetitionProposal(at69, repair, repairPolicy).accepted).toBe(false);
    const at70 = state({ npcs: [{ ...state().npcs[0]!, trust: 70 }] });
    expect(validateCompetitionProposal(at70, repair, repairPolicy).accepted).toBe(true);
    // 交易：trust 39 不够，40 够。
    const t39 = state({ npcs: [{ ...state().npcs[0]!, trust: 39 }] });
    expect(validateCompetitionProposal(t39, trade).accepted).toBe(false);
    const t40 = state({ npcs: [{ ...state().npcs[0]!, trust: 40 }] });
    expect(validateCompetitionProposal(t40, trade).accepted).toBe(true);
  });

  it('传入更低门槛后，原本被拒的场景能通过', () => {
    const at50 = state({ npcs: [{ ...state().npcs[0]!, trust: 50 }] });
    // 50 低于缺省 70，先确认基线是拒的。
    expect(validateCompetitionProposal(at50, repair, repairPolicy).accepted).toBe(false);
    // 合作态门槛 40：同一份状态应该通过。
    const cooperative = { ...repairPolicy, trustThresholds: { repair_gate: 40 } };
    expect(validateCompetitionProposal(at50, repair, cooperative).accepted).toBe(true);
  });

  it('传入更高门槛后，原本能过的场景被拒', () => {
    const at70 = state({ npcs: [{ ...state().npcs[0]!, trust: 70 }] });
    expect(validateCompetitionProposal(at70, repair, repairPolicy).accepted).toBe(true);
    const guarded = { ...repairPolicy, trustThresholds: { repair_gate: 75 } };
    const checked = validateCompetitionProposal(at70, repair, guarded);
    expect(checked.accepted).toBe(false);
    if (!checked.accepted) expect(checked.reason).toBe('low_trust');
  });

  it('give 与 trade 都能单独覆盖，且未被覆盖的那个仍用 40', () => {
    const at38 = state({ npcs: [{ ...state().npcs[0]!, trust: 38 }] });
    // 只把 trade 降到 35：trade 该过，NPC 主动 give 仍按 40 拒。
    const onlyTrade = { trustThresholds: { trade: 35 } };
    expect(validateCompetitionProposal(at38, trade, onlyTrade).accepted).toBe(true);
    const npcGift: CompetitionActionProposal = {
      kind: 'give', transfer: { from: { kind: 'npc', npcId: 'alin' }, to: 'player', itemId: 'battery', quantity: 1 },
    };
    expect(validateCompetitionProposal(at38, npcGift, onlyTrade).reason).toBe('low_trust');
  });

  it('门槛配成非有限数时不被吞掉，回落到缺省值', () => {
    const at50 = state({ npcs: [{ ...state().npcs[0]!, trust: 50 }] });
    // NaN 不能变成 0（那等于谁都能修），必须回落 70 → 仍然拒。
    const broken = { ...repairPolicy, trustThresholds: { repair_gate: Number.NaN } };
    const checked = validateCompetitionProposal(at50, repair, broken);
    expect(checked.accepted).toBe(false);
    if (!checked.accepted) expect(checked.reason).toBe('low_trust');
  });
});
