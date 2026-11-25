// 维修意图解析：这个文件是「模型说不能修，系统却把门修了」这条缺陷的第一道闸。
//
// 前任实现用 `/修|门|通道|通道门|repair|gate/i` 判断模型是否想维修。模型说
// 「现在材料不足，我不能修门」也会命中，于是拒绝被翻译成维修提案，门开了。
// validator 拦不住，因为它看到的只是一个格式合法的 repair_gate。
//
// 所以下面每一组否定样本都是回归用例：它们曾经（或在等价实现里）会失败。

import { describe, expect, it } from 'vitest';
import { buildRepairPrompt, parseRepairIntent } from './repairIntent';

describe('解析：合法意图', () => {
  it('接受裸 JSON', () => {
    const decision = parseRepairIntent('{"intent":"repair_gate","utterance":"动手吧。"}');
    expect(decision).toMatchObject({ intent: 'repair_gate', utterance: '动手吧。' });
  });

  it('接受 markdown 代码块包裹（模型最常见的输出形态）', () => {
    const raw = '```json\n{"intent":"observe","utterance":"我先看看线路。"}\n```';
    expect(parseRepairIntent(raw)?.intent).toBe('observe');
  });

  it('接受前后有解释文字的情况', () => {
    const raw = '好的，我的决定是：{"intent":"refuse","utterance":"我不动这门。"} 就这样。';
    expect(parseRepairIntent(raw)?.intent).toBe('refuse');
  });

  it('request_help 必须携带合法物品与正整数数量', () => {
    const raw = '{"intent":"request_help","itemId":"tape","quantity":2,"utterance":"还缺两卷胶带。"}';
    const decision = parseRepairIntent(raw);
    expect(decision).toMatchObject({ intent: 'request_help', itemId: 'tape', quantity: 2 });
  });

  it('request_help 缺 quantity 时作废，而不是替模型默认 1', () => {
    // 「缺省当 1」等于替模型编了一个它没说的数字：玩家按 1 个去凑，
    // 模型下次改口要 2 个，责任无处归属。宁可整条降级也不补。
    const raw = '{"intent":"request_help","itemId":"tape"}';
    expect(parseRepairIntent(raw)).toBeNull();
  });

  it('过长的台词被截断到执行器的上限（60），而不是 80', () => {
    const long = '啊'.repeat(200);
    const decision = parseRepairIntent(JSON.stringify({ intent: 'observe', utterance: long }));
    expect(decision?.utterance?.length).toBe(60);
  });
});

describe('解析：拒绝语义绝不被误读为维修', () => {
  // 这组是核心回归——每一条都是「模型说了不」的自然语言表达。
  const refusals = [
    '{"intent":"refuse","utterance":"现在材料不足，我不能修门。"}',
    '{"intent":"refuse","utterance":"这扇门我修不了。"}',
    '{"intent":"observe","utterance":"通道门先放着，我不动。"}',
    '{"intent":"request_help","itemId":"tape","quantity":1,"utterance":"门要修，但还缺一卷胶带，能帮我找找吗？"}',
  ];

  for (const raw of refusals) {
    it(`不产出 repair_gate：${raw.slice(0, 46)}…`, () => {
      const decision = parseRepairIntent(raw);
      expect(decision).not.toBeNull();
      expect(decision!.intent).not.toBe('repair_gate');
    });
  }

  it('request_help 不会因为句子里有「修」「门」就被当成维修', () => {
    const raw = '{"intent":"request_help","itemId":"tape","quantity":1,"utterance":"我修门缺胶带。"}';
    const decision = parseRepairIntent(raw);
    expect(decision?.intent).toBe('request_help');
  });
});

describe('解析：脏输出一律返回 null 而不是猜', () => {
  const invalid = [
    '',
    '   ',
    '我不知道该怎么回答。',
    '{"utterance":"没有 intent 字段"}',
    '{"intent":"execute_arbitrary_code"}',
    '{"intent":"repair_gate"', // JSON 不完整
    '{"intent":123}',
    'null',
    '[]',
  ];

  for (const raw of invalid) {
    it(`返回 null：${JSON.stringify(raw).slice(0, 40)}`, () => {
      expect(parseRepairIntent(raw)).toBeNull();
    });
  }

  it('request_help 但物品不在白名单 → null（不知道该找什么就不算有效请求）', () => {
    expect(parseRepairIntent('{"intent":"request_help","itemId":"unicorn_horn","quantity":1}')).toBeNull();
  });

  it('request_help 的数量非法时整条作废', () => {
    expect(parseRepairIntent('{"intent":"request_help","itemId":"tape","quantity":0}')).toBeNull();
    expect(parseRepairIntent('{"intent":"request_help","itemId":"tape","quantity":-5}')).toBeNull();
    expect(parseRepairIntent('{"intent":"request_help","itemId":"tape","quantity":9999}')).toBeNull();
    expect(parseRepairIntent('{"intent":"request_help","itemId":"tape","quantity":1.5}')).toBeNull();
  });
});

describe('提示构造：把事实摆给模型，而不是让它自己算', () => {
  const base = {
    npcName: '阿林',
    trust: 70,
    trustThreshold: 70,
    materials: [{ itemId: 'wood' as const, quantity: 2 }, { itemId: 'tape' as const, quantity: 1 }],
    playerHas: [{ itemId: 'wood' as const, quantity: 2 }, { itemId: 'tape' as const, quantity: 1 }],
  };

  it('材料齐备时明确写「齐备」', () => {
    expect(buildRepairPrompt(base)).toContain('材料是否齐备：齐备');
  });

  it('材料不足时点名缺什么、缺多少', () => {
    const prompt = buildRepairPrompt({ ...base, playerHas: [{ itemId: 'wood' as const, quantity: 2 }] });
    expect(prompt).toContain('材料是否齐备：缺 tape×1');
  });

  it('把信任与门槛都写出来，模型才知道该不该动手', () => {
    const prompt = buildRepairPrompt(base);
    expect(prompt).toContain('信任是 70');
    expect(prompt).toContain('门槛是 70');
  });

  it('上一轮被拒的理由进入提示，模型才有机会改主意', () => {
    const prompt = buildRepairPrompt({ ...base, previousRejectedReason: '材料不足' });
    expect(prompt).toContain('上一轮你的提案被拒绝了');
    expect(prompt).toContain('材料不足');
  });

  it('要求输出 intent 而不是 action.type（两套契约不能混）', () => {
    const prompt = buildRepairPrompt(base);
    expect(prompt).toContain('"intent"');
    expect(prompt).not.toContain('"action"');
  });
});