// 结构化动作契约的验收测试。
//
// 本文件的核心不是「能解析出什么」，而是「解析不出什么」：模型说「我不能修门」
// 时，契约层必须产出 refuse/observe，绝不能产出 repair_gate。这是 AI-01/AI-02
// 的硬验收点——旧实现因为 /修|门/ 正则把否定句翻成了维修申请。

import { describe, expect, it } from 'vitest';
import {
  CONTRACT_INTENTS,
  MAX_CONTRACT_QUANTITY,
  contractToProposal,
  isContractIntent,
  isContractProposal,
  isProposalFresh,
  parseContract,
  stampObservation,
  translateContractRaw,
  type ContractProposal,
  type ContractTranslationContext,
} from './actionContract';
import type { CompetitionObservationSnapshot } from './competition-contract';
import { translateRawModelOutput } from './competitionModelBridge';

function ctx(overrides: Partial<ContractTranslationContext> = {}): ContractTranslationContext {
  return {
    npcId: 'alin',
    playerInventory: [{ itemId: 'wood', quantity: 2 }, { itemId: 'tape', quantity: 1 }],
    npcInventory: [{ itemId: 'wire', quantity: 3 }, { itemId: 'battery', quantity: 1 }],
    gateId: 'alin_repair_gate',
    repairMaterials: [{ itemId: 'wood', quantity: 2 }, { itemId: 'tape', quantity: 1 }],
    ...overrides,
  };
}

describe('契约解析：形状校验', () => {
  it('最小合法契约：intent=observe，confidence 缺省 0.5', () => {
    expect(parseContract('{"intent":"observe"}')).toEqual({ intent: 'observe', confidence: 0.5 });
  });

  it('容忍 markdown 代码块与前后杂音', () => {
    const raw = '好，我这样回答：\n```json\n{"intent":"refuse","utterance":"我不去。"}\n```\n以上。';
    expect(parseContract(raw)).toMatchObject({ intent: 'refuse', utterance: '我不去。' });
  });

  it('非 JSON / 空正文 / 数组 → null，不抛异常', () => {
    expect(parseContract('我修好了')).toBeNull();
    expect(parseContract('')).toBeNull();
    expect(parseContract('[{"intent":"observe"}]')).toBeNull();
    expect(parseContract('{"intent":"observe"')).toBeNull();
  });

  it('未知 intent 一律 null——契约是封闭集合', () => {
    expect(parseContract('{"intent":"open_gate"}')).toBeNull();
    expect(parseContract('{"intent":"take_item"}')).toBeNull();
    expect(parseContract('{"intent":"attack"}')).toBeNull();
    expect(CONTRACT_INTENTS).not.toContain('attack');
  });

  it('confidence 越界（>1 / <0 / 非数字）→ null', () => {
    expect(parseContract('{"intent":"observe","confidence":1.4}')).toBeNull();
    expect(parseContract('{"intent":"observe","confidence":-0.1}')).toBeNull();
    expect(parseContract('{"intent":"observe","confidence":"高"}')).toBeNull();
  });

  it('utterance 超长截断到 60 字', () => {
    const parsed = parseContract(`{"intent":"observe","utterance":"${'啊'.repeat(200)}"}`);
    expect(parsed?.utterance?.length).toBe(60);
  });

  it('request_help 的 itemId 必须在白名单里', () => {
    expect(parseContract('{"intent":"request_help","itemId":"tape","quantity":1}')).toMatchObject({ itemId: 'tape' });
    expect(parseContract('{"intent":"request_help","itemId":"胶带","quantity":1}')).toBeNull();
    expect(parseContract('{"intent":"request_help","itemId":"diamond","quantity":1}')).toBeNull();
  });

  it('quantity 必须是 1..MAX 的正整数', () => {
    for (const bad of ['0', '-1', '1.5', '"1"', String(MAX_CONTRACT_QUANTITY + 1)]) {
      expect(parseContract(`{"intent":"request_help","itemId":"tape","quantity":${bad}}`)).toBeNull();
    }
    expect(parseContract(`{"intent":"request_help","itemId":"tape","quantity":${MAX_CONTRACT_QUANTITY}}`)).not.toBeNull();
  });

  it('不可堆叠物品的数量上界是 maxStack=1', () => {
    expect(parseContract('{"intent":"request_help","itemId":"crowbar","quantity":1}')).not.toBeNull();
    expect(parseContract('{"intent":"request_help","itemId":"crowbar","quantity":2}')).toBeNull();
  });

  it('propose_trade 缺少 wants 或 offers → null（不允许单向索要）', () => {
    expect(parseContract('{"intent":"propose_trade","wants":{"itemId":"wood","quantity":1}}')).toBeNull();
    expect(parseContract('{"intent":"propose_trade","offers":{"itemId":"wire","quantity":1}}')).toBeNull();
    expect(
      parseContract('{"intent":"propose_trade","wants":{"itemId":"wood","quantity":1},"offers":{"itemId":"wire","quantity":1}}'),
    ).toMatchObject({ intent: 'propose_trade' });
  });
});

describe('契约解析：拒绝语义是一等公民（AI-01 硬验收）', () => {
  // 这组用例锁的是「否定句不得变成维修」。任何一条失败都意味着旧的那个
  // /修|门/ 正则以某种形式回来了。
  const refusals = [
    '{"intent":"refuse","utterance":"现在材料不足，我不能修门。"}',
    '{"intent":"refuse","utterance":"我不修门。"}',
    '{"intent":"refuse","utterance":"门我修不了，别指望我。"}',
    '{"intent":"refuse","reason":"材料不足不能修门","utterance":"修不了"}',
    '{"intent":"observe","utterance":"材料不足不能修门，我只能先看看。"}',
    '{"intent":"wait","utterance":"等材料齐了再说修门的事。"}',
  ];

  for (const raw of refusals) {
    it(`否定句不产生 repair_gate：${raw.slice(0, 48)}`, () => {
      const contract = parseContract(raw);
      expect(contract).not.toBeNull();
      expect(contract!.intent).not.toBe('repair_gate');

      const out = contractToProposal(contract!, ctx());
      expect(out).not.toBeNull();
      expect(out!.proposal.kind).not.toBe('repair_gate');
      expect(out!.proposal.kind).toBe('observe');
    });
  }

  it('同样的否定句走旧降级路径也不产生 repair_gate（AI-02）', () => {
    const legacy = '{"utterance":"材料不足，我不能修门。","action":{"type":"dialogue","text":"我不能修门"},"confidence":0.9}';
    const out = translateRawModelOutput(legacy, ctx());
    expect(out).not.toBeNull();
    expect(out!.proposal.kind).toBe('observe');
  });

  it('正面维修必须由模型显式声明 intent，而不是台词暗示', () => {
    const explicit = parseContract('{"intent":"repair_gate","utterance":"材料齐了，开始吧。"}');
    expect(contractToProposal(explicit!, ctx())!.proposal.kind).toBe('repair_gate');
    // 台词说了要修、但 intent 是 observe → 仍然是 observe。
    const implied = parseContract('{"intent":"observe","utterance":"我去修门。"}');
    expect(contractToProposal(implied!, ctx())!.proposal.kind).toBe('observe');
  });
});

describe('契约翻译：方向与资源边界', () => {
  it('accept_gift 永远是 player→npc，且玩家必须持有', () => {
    const out = translateContractRaw('{"intent":"accept_gift","itemId":"tape","quantity":1}', ctx());
    expect(out!.proposal).toEqual({
      kind: 'give',
      transfer: { from: 'player', to: { kind: 'npc', npcId: 'alin' }, itemId: 'tape', quantity: 1 },
    });
  });

  it('accept_gift 玩家没有该物品 → null（NPC 不能凭空取物）', () => {
    expect(translateContractRaw('{"intent":"accept_gift","itemId":"medkit","quantity":1}', ctx())).toBeNull();
    expect(translateContractRaw('{"intent":"accept_gift","itemId":"wood","quantity":5}', ctx())).toBeNull();
  });

  it('propose_trade 双向完整：wants→playerGives，offers→playerReceives', () => {
    const out = translateContractRaw(
      '{"intent":"propose_trade","wants":{"itemId":"wood","quantity":2},"offers":{"itemId":"wire","quantity":3}}',
      ctx(),
    );
    expect(out!.proposal).toEqual({
      kind: 'trade',
      npcId: 'alin',
      playerGives: { from: 'player', to: { kind: 'npc', npcId: 'alin' }, itemId: 'wood', quantity: 2 },
      playerReceives: { from: { kind: 'npc', npcId: 'alin' }, to: 'player', itemId: 'wire', quantity: 3 },
    });
  });

  it('propose_trade 任一边不成立就整条 null，不压成单向', () => {
    // 玩家没有 5 个 wood
    expect(
      translateContractRaw('{"intent":"propose_trade","wants":{"itemId":"wood","quantity":5},"offers":{"itemId":"wire","quantity":1}}', ctx()),
    ).toBeNull();
    // NPC 没有 fuse
    expect(
      translateContractRaw('{"intent":"propose_trade","wants":{"itemId":"wood","quantity":1},"offers":{"itemId":"fuse","quantity":1}}', ctx()),
    ).toBeNull();
    // 不知道 NPC 背包 → 不能假设他有
    expect(
      translateContractRaw('{"intent":"propose_trade","wants":{"itemId":"wood","quantity":1},"offers":{"itemId":"wire","quantity":1}}', ctx({ npcInventory: undefined })),
    ).toBeNull();
  });

  it('repair_gate 的材料只来自规则层，模型无法指定别的东西', () => {
    const out = translateContractRaw('{"intent":"repair_gate","target":"alin_repair_gate"}', ctx());
    expect(out!.proposal).toEqual({
      kind: 'repair_gate',
      gateId: 'alin_repair_gate',
      materials: [{ itemId: 'wood', quantity: 2 }, { itemId: 'tape', quantity: 1 }],
    });
  });

  it('repair_gate 缺配方或缺门禁 → null', () => {
    expect(translateContractRaw('{"intent":"repair_gate"}', ctx({ repairMaterials: undefined }))).toBeNull();
    expect(translateContractRaw('{"intent":"repair_gate"}', ctx({ gateId: undefined }))).toBeNull();
  });

  it('repair_gate 指向别的门 → null（不能挑一扇修）', () => {
    expect(translateContractRaw('{"intent":"repair_gate","target":"other_gate"}', ctx())).toBeNull();
  });

  it('request_help 是 ask，不是 give', () => {
    const out = translateContractRaw('{"intent":"request_help","itemId":"tape","quantity":1,"utterance":"还缺一卷胶带"}', ctx());
    expect(out!.proposal.kind).toBe('ask');
    expect(out!.proposal.kind).not.toBe('give');
  });

  it('refuse / wait / observe 一律不改变世界', () => {
    for (const raw of ['{"intent":"refuse"}', '{"intent":"wait"}', '{"intent":"observe"}']) {
      expect(translateContractRaw(raw, ctx())!.proposal.kind).toBe('observe');
    }
  });
});

describe('契约来源标记与类型守卫', () => {
  it('模型提案标记 source=model', () => {
    expect(translateContractRaw('{"intent":"observe"}', ctx())!.source).toBe('model');
  });

  it('isContractIntent 只认白名单', () => {
    expect(isContractIntent('repair_gate')).toBe(true);
    expect(isContractIntent('open_gate')).toBe(false);
    expect(isContractIntent(42)).toBe(false);
  });

  it('isContractProposal 复检完整形状', () => {
    const ok: ContractProposal = { intent: 'request_help', itemId: 'tape', quantity: 1, confidence: 0.5 };
    expect(isContractProposal(ok)).toBe(true);
    expect(isContractProposal({ intent: 'request_help', itemId: 'tape', quantity: 0, confidence: 0.5 })).toBe(false);
    expect(isContractProposal({ intent: 'propose_trade', wants: { itemId: 'wood', quantity: 1 }, confidence: 0.5 })).toBe(false);
  });

  it('utterance 透传到提案上，但不参与裁决', () => {
    const out = translateContractRaw('{"intent":"observe","utterance":"我看看"}', ctx());
    expect(out!.utterance).toBe('我看看');
    expect(out!.proposal.kind).toBe('observe');
  });
});

describe('保鲜检查：过期提案不得改状态（AI-08）', () => {
  function snapshot(id: string, minute: number): CompetitionObservationSnapshot {
    return {
      observationId: id,
      world: {
        seed: 42,
        day: 1,
        gameMinute: minute,
        currentFloor: 2,
        flags: {},
        threats: [],
        player: {
          position: { floor: 2, x: 600 },
          hp: 40,
          hunger: 20,
          thirst: 20,
          energy: 50,
          inventory: [],
        },
        npcs: [],
        groundItems: [],
        gates: [],
      },
      focus: null,
      availableActions: [],
      recentFacts: [],
    };
  }

  it('同一次观察 → 新鲜', () => {
    expect(isProposalFresh(stampObservation(snapshot('a', 560)), stampObservation(snapshot('a', 560)))).toBe(true);
  });

  it('观察 id 变化 → 过期', () => {
    expect(isProposalFresh(stampObservation(snapshot('a', 560)), stampObservation(snapshot('b', 560)))).toBe(false);
  });

  it('逻辑时间推进 → 过期（1 分钟也算）', () => {
    expect(isProposalFresh(stampObservation(snapshot('a', 560)), stampObservation(snapshot('a', 561)))).toBe(false);
  });

  it('跨天 → 过期', () => {
    const before = stampObservation(snapshot('a', 560));
    const after = { ...before, day: before.day + 1 };
    expect(isProposalFresh(before, after)).toBe(false);
  });
});