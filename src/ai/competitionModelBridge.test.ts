// 竞赛模型桥的验收测试。
//
// 2026-11 A1 修正的两处旧断言（保留在此说明原因，不静默删除）：
// 1. 旧「dialogue 提到修门 → repair_gate」锁的是关键词推断这一缺陷行为本身。
//    现在维修只能来自结构化 intent；`dialogue` 无论说什么都只产出 observe。
//    对应用例改为「提到修门的台词不再触发维修」，见「否定与语境不改变意图」。
// 2. 旧的 gift 断言把方向写成 player→npc，与 NpcAction.gift 的权威语义
//    （见 rulesExecutor.validateGift：NPC 必须持有该物品）相反。现在 gift 表示
//    NPC 送给玩家，断言已改为 from:npc→to:player。

import { describe, expect, it } from 'vitest';
import {
  buildCompetitionPrompts,
  inventoryHas,
  proposeWithBrain,
  proposeWithContract,
  toNpcObservation,
  translateModelAction,
  translateRawContractOutput,
  translateRawModelOutput,
  type TranslationContext,
} from './competitionModelBridge';
import type { CompetitionObservationSnapshot } from './competition-contract';
import type { NpcActionProposal, NpcBrain, NpcObservation } from './types';

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
      inventory: [{ itemId: 'wire' as const, quantity: 2 }],
    }],
    groundItems: [],
    gates: [{ gateId: 'alin_repair_gate', floor: 2, status: 'closed' as const }],
  };
  return {
    observationId: 'obs-1',
    world,
    focus: { kind: 'npc', npcId: 'alin' },
    availableActions: ['observe', 'give', 'trade', 'repair_gate'],
    recentFacts: [],
    ...overrides,
  };
}

function ctx(overrides: Partial<TranslationContext> = {}): TranslationContext {
  return {
    npcId: 'alin',
    playerInventory: [{ itemId: 'wood', quantity: 2 }, { itemId: 'tape', quantity: 1 }],
    npcInventory: [{ itemId: 'wire', quantity: 2 }],
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
  it('把结构化状态摊给模型：信任、双方背包、门禁、可用意图都在', () => {
    const { systemPrompt, userPrompt } = buildCompetitionPrompts(snapshot());
    expect(systemPrompt).toContain('阿林');
    expect(systemPrompt).toContain('refuse');
    expect(userPrompt).toContain('信任=35');
    expect(userPrompt).toContain('wood×2');
    expect(userPrompt).toContain('alin_repair_gate：closed');
    expect(userPrompt).toContain('propose_trade');
    expect(userPrompt).toContain('wood');
  });

  it('无记忆时明确写「尚无共同经历」，不留空行歧义', () => {
    expect(buildCompetitionPrompts(snapshot()).userPrompt).toContain('尚无共同经历');
  });

  it('只在观察允许时才把 repair_gate 放进可用意图', () => {
    // 门禁 id 本身含 "repair_gate" 字样（alin_repair_gate），是必须告知的客观
    // 事实；这里只断言「可选项」与「输出契约」两行，不误伤门禁状态行。
    const intentLine = (prompt: string) => prompt.split('\n').find((line) => line.startsWith('可用意图：')) ?? '';
    const contractLine = (prompt: string) => prompt.split('\n').find((line) => line.startsWith('输出契约：')) ?? '';

    const allowed = buildCompetitionPrompts(snapshot()).userPrompt;
    expect(intentLine(allowed)).toContain('repair_gate');
    expect(contractLine(allowed)).toContain('repair_gate');

    const denied = buildCompetitionPrompts(snapshot({ availableActions: ['observe', 'give'] })).userPrompt;
    expect(intentLine(denied)).not.toContain('repair_gate');
    expect(contractLine(denied)).not.toContain('repair_gate');
  });
});

describe('竞赛模型桥：旧 action.type 翻译（降级形态）', () => {
  it('dialogue → observe，utterance 保留', () => {
    const out = translateModelAction(
      { action: { type: 'dialogue', text: '你来啦' }, utterance: '你来了', confidence: 0.8 },
      ctx(),
    );
    expect(out?.proposal).toEqual({ kind: 'observe', target: { kind: 'npc', npcId: 'alin' } });
    expect(out?.utterance).toBe('你来了');
    expect(out?.source).toBe('model');
  });

  // 旧的「提到修门 → repair_gate」用例在此被改写：那锁的是缺陷行为本身。
  it('台词提到修门也不再产生 repair_gate（AI-02 硬验收）', () => {
    const out = translateModelAction(
      { action: { type: 'dialogue', text: '我去修那道门' }, utterance: '我这就去修通道', confidence: 0.9 },
      ctx(),
    );
    expect(out?.proposal.kind).toBe('observe');
  });

  it('否定句（材料不足不能修门）不产生 repair_gate', () => {
    const out = translateModelAction(
      { action: { type: 'dialogue', text: '材料不足，我不能修门' }, utterance: '修不了', confidence: 0.9 },
      ctx(),
    );
    expect(out?.proposal.kind).not.toBe('repair_gate');
    expect(out?.proposal.kind).toBe('observe');
  });

  it('gift 是 NPC 送玩家（方向修正），且 NPC 必须持有', () => {
    const out = translateModelAction(
      { action: { type: 'gift', itemId: 'wire', quantity: 1 }, utterance: '这根电线你拿着', confidence: 0.8 },
      ctx(),
    );
    expect(out?.proposal).toEqual({
      kind: 'give',
      transfer: { from: { kind: 'npc', npcId: 'alin' }, to: 'player', itemId: 'wire', quantity: 1 },
    });
  });

  it('gift 指定 NPC 没有的物品 → null（不能让 NPC 凭空取物）', () => {
    expect(translateModelAction({ action: { type: 'gift', itemId: 'medkit', quantity: 1 }, confidence: 0.8 }, ctx())).toBeNull();
    expect(translateModelAction({ action: { type: 'gift', itemId: 'wire', quantity: 5 }, confidence: 0.8 }, ctx())).toBeNull();
  });

  it('不知道 NPC 背包时 gift → null，不假设方向也不反压成玩家送出', () => {
    expect(
      translateModelAction({ action: { type: 'gift', itemId: 'wire', quantity: 1 }, confidence: 0.8 }, ctx({ npcInventory: undefined })),
    ).toBeNull();
  });

  it('trade 保留双向：give=NPC 付出，get=玩家付出', () => {
    const out = translateModelAction(
      {
        action: { type: 'trade', give: { itemId: 'wire', quantity: 2 }, get: { itemId: 'wood', quantity: 1 } },
        utterance: '两卷线换一块木头',
        confidence: 0.8,
      },
      ctx(),
    );
    expect(out?.proposal).toEqual({
      kind: 'trade',
      npcId: 'alin',
      playerGives: { from: 'player', to: { kind: 'npc', npcId: 'alin' }, itemId: 'wood', quantity: 1 },
      playerReceives: { from: { kind: 'npc', npcId: 'alin' }, to: 'player', itemId: 'wire', quantity: 2 },
    });
  });

  it('trade 里 NPC 没有的货 → null（不压成玩家单向送出）', () => {
    expect(
      translateModelAction(
        { action: { type: 'trade', give: { itemId: 'fuse', quantity: 1 }, get: { itemId: 'wood', quantity: 1 } }, confidence: 0.8 },
        ctx(),
      ),
    ).toBeNull();
  });

  it('attack / flee 当前不可由 NPC 单方提交 → null', () => {
    expect(translateModelAction({ action: { type: 'attack' }, confidence: 0.5 }, ctx())).toBeNull();
    expect(translateModelAction({ action: { type: 'flee' }, confidence: 0.5 }, ctx())).toBeNull();
  });

  it('旧契约里的 type=repair_gate 在解析阶段就被挡掉', () => {
    const out = translateRawModelOutput('{"action":{"type":"repair_gate","gateId":"alin_repair_gate"},"confidence":1}', ctx());
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

describe('竞赛模型桥：结构化契约路径（首选）', () => {
  it('intent=repair_gate 且配方已知 → repair_gate', () => {
    const out = translateRawContractOutput('{"intent":"repair_gate","utterance":"材料齐了"}', ctx());
    expect(out?.proposal.kind).toBe('repair_gate');
    expect(out?.source).toBe('model');
  });

  it('intent=refuse 即使台词提到门也不修 → observe', () => {
    const out = translateRawContractOutput('{"intent":"refuse","utterance":"我不能修门，材料不够"}', ctx());
    expect(out?.proposal.kind).toBe('observe');
  });

  it('契约路径的 trade 双向完整', () => {
    const out = translateRawContractOutput(
      '{"intent":"propose_trade","wants":{"itemId":"wood","quantity":1},"offers":{"itemId":"wire","quantity":2}}',
      ctx(),
    );
    expect(out?.proposal.kind).toBe('trade');
  });

  it('proposeWithContract：吐原始正文的模型也能拿到结构化契约', async () => {
    const out = await proposeWithContract(
      async () => '{"intent":"accept_gift","itemId":"tape","quantity":1,"utterance":"那我收下"}',
      snapshot(),
    );
    expect(out?.proposal).toEqual({
      kind: 'give',
      transfer: { from: 'player', to: { kind: 'npc', npcId: 'alin' }, itemId: 'tape', quantity: 1 },
    });
  });

  it('proposeWithContract：空正文 / 抛错 / 坏 JSON 一律 null', async () => {
    await expect(proposeWithContract(async () => null, snapshot())).resolves.toBeNull();
    await expect(proposeWithContract(async () => '   ', snapshot())).resolves.toBeNull();
    await expect(proposeWithContract(async () => '不是 JSON', snapshot())).resolves.toBeNull();
    await expect(proposeWithContract(async () => { throw new Error('boom'); }, snapshot())).resolves.toBeNull();
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

  it('旧路径无法产出维修（维修只走契约 intent）', async () => {
    const out = await proposeWithBrain(
      brain({ action: { type: 'dialogue', text: '我来修门' }, utterance: '材料给我', confidence: 0.9 }),
      snapshot(),
      { repairMaterials: [{ itemId: 'wood', quantity: 2 }, { itemId: 'tape', quantity: 1 }] },
    );
    expect(out?.proposal.kind).toBe('observe');
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

describe('竞赛模型桥：快照 → NpcObservation（人格 / 记忆 / 可用行动）', () => {
  it('amenity：阿林与老陈的人格不同（不再六人同一个 ally）', () => {
    const alin = toNpcObservation(snapshot());
    const laochen = toNpcObservation(
      snapshot({
        focus: { kind: 'npc', npcId: 'laochen' },
        world: {
          ...snapshot().world,
          npcs: [{ ...snapshot().world.npcs[0]!, npcId: 'laochen', trust: 20 }],
        },
      }),
    );
    expect(alin.archetype).toBe('ally');
    expect(laochen.archetype).toBe('neutral');
    expect(alin.traits.altruism).toBeGreaterThan(laochen.traits.altruism);
    expect(laochen.traits.caution).toBeGreaterThan(alin.traits.caution);
    expect(alin.goal).not.toBe(laochen.goal);
  });

  it('阿珍（高利他）与小周（高务实）走的是两份不同的个体档', () => {
    function obsFor(npcId: string): NpcObservation {
      return toNpcObservation(
        snapshot({
          focus: { kind: 'npc', npcId },
          world: {
            ...snapshot().world,
            npcs: [{ ...snapshot().world.npcs[0]!, npcId, trust: 35 }],
          },
        }),
      );
    }
    const azhen = obsFor('azhen');
    const xiaozhou = obsFor('xiaozhou');
    expect(azhen.archetype).toBe('ally');
    expect(xiaozhou.archetype).toBe('neutral');
    expect(azhen.traits.altruism).toBeGreaterThan(xiaozhou.traits.altruism);
    expect(xiaozhou.traits.pragmatism).toBeGreaterThan(azhen.traits.pragmatism);
  });

  it('未知 NPC id 退回中性原型兜底，不复制阿林', () => {
    const obs = toNpcObservation(
      snapshot({
        focus: { kind: 'npc', npcId: 'stranger' },
        world: { ...snapshot().world, npcs: [{ ...snapshot().world.npcs[0]!, npcId: 'stranger' }] },
      }),
    );
    expect(obs.archetype).toBe('neutral');
  });

  it('结构化记忆被真实带进 observation，不丢 promise/favor 语义', () => {
    const obs = toNpcObservation(
      snapshot({
        world: {
          ...snapshot().world,
          npcs: [{
            ...snapshot().world.npcs[0]!,
            memory: [
              { kind: 'promise', memoryId: 'm1', day: 1, promise: '帮你找胶带', status: 'open' },
              { kind: 'favor', memoryId: 'm2', day: 1, from: 'player', description: '给过一瓶水', status: 'resolved' },
              { kind: 'fact', memoryId: 'm3', day: 1, subject: 'gate', value: 'broken' },
            ],
          }],
        },
      }),
    );
    expect(obs.memory).toHaveLength(3);
    const promise = obs.memory.find((m) => m.id === 'm1');
    expect(promise?.kind).toBe('promise');
    expect(promise?.summary).toContain('帮你找胶带');
    // 守约/未决权重不同，不能一律 0。
    expect(obs.memory.find((m) => m.id === 'm2')?.weight).toBeGreaterThan(0);
  });

  it('可用行动按原型推导，缺省不再写死 dialogue', () => {
    const alin = toNpcObservation(snapshot());
    expect(alin.availableActions).toContain('gift');
    expect(alin.availableActions).not.toContain('attack');
    // 调用方显式收窄时以调用方为准。
    expect(toNpcObservation(snapshot(), { availableActions: ['dialogue'] }).availableActions).toEqual(['dialogue']);
  });

  it('relationship 保留，mood 由信任推导而不是恒为 0', () => {
    const obs = toNpcObservation(snapshot());
    expect(obs.relationship).toEqual({ player: 35 });
    expect(obs.mood).toBeLessThan(0);
  });

  it('夜间标记用全局 isNight，与 NpcRuntime 同一定义', () => {
    const night = toNpcObservation(snapshot({ world: { ...snapshot().world, gameMinute: 1320 } }));
    expect(night.world.night).toBe(true);
    expect(toNpcObservation(snapshot()).world.night).toBe(false);
  });
});

describe('竞赛模型桥：库存判定', () => {
  it('按物品与数量判定持有（多格堆叠也合计）', () => {
    const inv = [{ itemId: 'wood' as const, quantity: 2 }];
    expect(inventoryHas(inv, 'wood', 2)).toBe(true);
    expect(inventoryHas(inv, 'wood', 3)).toBe(false);
    expect(inventoryHas(inv, 'tape')).toBe(false);
    expect(inventoryHas([{ itemId: 'wood' as const, quantity: 1 }, { itemId: 'wood' as const, quantity: 2 }], 'wood', 3)).toBe(true);
  });
});