import { describe, expect, it } from 'vitest';
import {
  buildCompetitionPrompts,
  inventoryHas,
  proposeWithBrain,
  toNpcObservation,
  translateModelAction,
  translateRawModelOutput,
  type TranslationContext,
} from './competitionModelBridge';
import type { CompetitionObservationSnapshot } from './competition-contract';
import type { NpcBrain, NpcActionProposal, NpcObservation } from './types';

function snapshot(overrides: Partial<CompetitionObservationSnapshot> = {}): CompetitionObservationSnapshot {
  const world = {
    seed: 42,
    day: 1,
    gameMinute: 560,
    currentFloor: 2,
    flags: {},
    threats: [],
    player: {
      position: { floor: 2, x: 640 },
      hp: 40,
      hunger: 30,
      thirst: 30,
      energy: 50,
      inventory: [{ itemId: 'wood' as const, quantity: 2 }, { itemId: 'tape' as const, quantity: 1 }],
    },
    npcs: [{
      npcId: 'alin',
      position: { floor: 2, x: 660 },
      hp: 30,
      hunger: 20,
      trust: 35,
      affinity: 10,
      tension: 5,
      status: 'available' as const,
      goal: { goalId: 'alin-repair-gate', kind: 'custom' as const, sinceDay: 1, status: 'active' as const },
      memory: [],
      lastAction: null,
      inventory: [],
    }],
    groundItems: [],
    gates: [{ gateId: 'alin_repair_gate', floor: 2, status: 'closed' as const }],
  };
  return {
    observationId: 'obs-1',
    world,
    focus: { kind: 'npc', npcId: 'alin' },
    availableActions: ['observe', 'give', 'repair_gate'],
    recentFacts: [],
    ...overrides,
  };
}

function ctx(overrides: Partial<TranslationContext> = {}): TranslationContext {
  return {
    npcId: 'alin',
    playerInventory: [{ itemId: 'wood', quantity: 2 }, { itemId: 'tape', quantity: 1 }],
    gateId: 'alin_repair_gate',
    repairMaterials: [{ itemId: 'wood', quantity: 2 }, { itemId: 'tape', quantity: 1 }],
    ...overrides,
  };
}

function brain(proposal: NpcActionProposal | null): NpcBrain {
  return {
    id: 'test',
    health: async () => true,
    decide: async (_o: NpcObservation) => proposal,
  };
}

describe('竞赛模型桥：prompt 构造', () => {
  it('把结构化状态摊给模型：信任、双方背包、门禁、可用动作都在', () => {
    const { systemPrompt, userPrompt } = buildCompetitionPrompts(snapshot());
    expect(systemPrompt).toContain('阿林');
    expect(userPrompt).toContain('信任=35');
    expect(userPrompt).toContain('wood×2');
    expect(userPrompt).toContain('alin_repair_gate：closed');
    expect(userPrompt).toContain('observe, give, repair_gate');
    expect(userPrompt).toContain('wood');
  });

  it('无记忆时明确写「尚无共同经历」，不留空行歧义', () => {
    expect(buildCompetitionPrompts(snapshot()).userPrompt).toContain('尚无共同经历');
  });
});

describe('竞赛模型桥：提案翻译', () => {
  it('dialogue 且未提维修 → observe，utterance 保留', () => {
    const out = translateModelAction(
      { action: { type: 'dialogue', text: '你来啦' }, utterance: '你来了', confidence: 0.8 },
      ctx(),
    );
    expect(out?.proposal).toEqual({ kind: 'observe', target: { kind: 'npc', npcId: 'alin' } });
    expect(out?.utterance).toBe('你来了');
  });

  it('dialogue 提到修门 → repair_gate 申请，材料来自规则层而非模型', () => {
    const out = translateModelAction(
      { action: { type: 'dialogue', text: '我去修那道门' }, utterance: '我这就去修通道', confidence: 0.9 },
      ctx(),
    );
    expect(out?.proposal.kind).toBe('repair_gate');
    // 材料必须是规则层给的精确配方，模型无法自造。
    const materials = (out?.proposal as { materials: readonly { itemId: string; quantity: number }[] }).materials;
    expect(materials.map((m) => [m.itemId, m.quantity])).toEqual([['wood', 2], ['tape', 1]]);
  });

  it('模型提修门但配方未配置 → 退回 observe，绝不凭空修门', () => {
    const out = translateModelAction(
      { action: { type: 'dialogue', text: '我去修门' }, confidence: 0.9 },
      ctx({ repairMaterials: undefined }),
    );
    expect(out?.proposal.kind).toBe('observe');
  });

  it('模型点名玩家持有的物品（gift）→ give，方向固定为 player→npc', () => {
    const out = translateModelAction(
      { action: { type: 'gift', itemId: 'tape', quantity: 1 }, utterance: '给我胶带吧', confidence: 0.8 },
      ctx(),
    );
    expect(out?.proposal).toEqual({
      kind: 'give',
      transfer: { from: 'player', to: { kind: 'npc', npcId: 'alin' }, itemId: 'tape', quantity: 1 },
    });
  });

  it('模型点名玩家没有的物品 → null（不能让 NPC 凭空取物）', () => {
    const out = translateModelAction(
      { action: { type: 'gift', itemId: 'medkit', quantity: 1 }, confidence: 0.8 },
      ctx(),
    );
    expect(out).toBeNull();
  });

  it('模型要的数量超过玩家持有 → null', () => {
    const out = translateModelAction(
      { action: { type: 'gift', itemId: 'wood', quantity: 5 }, confidence: 0.8 },
      ctx(),
    );
    expect(out).toBeNull();
  });

  it('attack / flee 当前不可由 NPC 单方提交 → null', () => {
    expect(translateModelAction({ action: { type: 'attack' }, confidence: 0.5 }, ctx())).toBeNull();
    expect(translateModelAction({ action: { type: 'flee' }, confidence: 0.5 }, ctx())).toBeNull();
  });

  it('模型永远拼不出 repair_gate 这个 type——解析阶段就被挡掉', () => {
    const out = translateRawModelOutput(
      '{"action":{"type":"repair_gate","gateId":"alin_repair_gate"},"confidence":1}',
      ctx(),
    );
    expect(out).toBeNull();
  });

  it('utterance 超长被截断到 60 字', () => {
    const out = translateModelAction(
      { action: { type: 'dialogue', text: '' }, utterance: '啊'.repeat(200), confidence: 0.5 },
      ctx(),
    );
    expect(out?.utterance?.length).toBe(60);
  });

  it('非契约正文 → null（不猜、不补）', () => {
    expect(translateRawModelOutput('通道我修好了，放心', ctx())).toBeNull();
    expect(translateRawModelOutput('', ctx())).toBeNull();
  });
});

describe('竞赛模型桥：与 NpcBrain 联合', () => {
  it('模型给出 dialogue 时，proposeWithBrain 产出可提交提案', async () => {
    const out = await proposeWithBrain(
      brain({ action: { type: 'dialogue', text: '先看看门' }, utterance: '我看看', confidence: 0.7 }),
      snapshot(),
    );
    expect(out?.proposal.kind).toBe('observe');
  });

  it('模型给出维修意图且配方已知 → repair_gate', async () => {
    const out = await proposeWithBrain(
      brain({ action: { type: 'dialogue', text: '我来修门' }, utterance: '材料给我', confidence: 0.9 }),
      snapshot(),
      { repairMaterials: [{ itemId: 'wood', quantity: 2 }, { itemId: 'tape', quantity: 1 }] },
    );
    expect(out?.proposal.kind).toBe('repair_gate');
  });

  it('模型无意见（null）时返回 null，交给规则降级', async () => {
    expect(await proposeWithBrain(brain(null), snapshot())).toBeNull();
  });

  it('brain 抛错时不冒泡，返回 null', async () => {
    const throwing: NpcBrain = {
      id: 'boom',
      health: async () => true,
      decide: async () => { throw new Error('network down'); },
    };
    await expect(proposeWithBrain(throwing, snapshot())).resolves.toBeNull();
  });
});

describe('竞赛模型桥：快照 → NpcObservation', () => {
  it('只暴露模型能提议的 dialogue，不把 repair_gate 递进去', () => {
    const obs = toNpcObservation(snapshot());
    expect(obs.availableActions).toEqual(['dialogue']);
    expect(obs.relationship).toEqual({ player: 35 });
    expect(obs.world.floor).toBe(2);
  });
});

describe('竞赛模型桥：库存判定', () => {
  it('按物品与数量判定持有', () => {
    const inv = [{ itemId: 'wood' as const, quantity: 2 }];
    expect(inventoryHas(inv, 'wood', 2)).toBe(true);
    expect(inventoryHas(inv, 'wood', 3)).toBe(false);
    expect(inventoryHas(inv, 'tape')).toBe(false);
  });
});