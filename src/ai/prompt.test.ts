import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, buildUserPrompt, extractJson, itemVocabulary, parseProposal } from './prompt';
import type { NpcObservation } from '../ai/types';
import { createNpcState } from '../data/npcPersonalities';
import { recall } from '../systems/NpcMemory';
import { recordMemory } from '../systems/NpcMemory';

function observation(overrides: Partial<NpcObservation> = {}): NpcObservation {
  return {
    npcId: 'alin',
    archetype: 'ally',
    traits: { altruism: 0.8, pragmatism: 0.3, aggression: 0.05, loyalty: 0.7, caution: 0.4 },
    memory: [],
    relationship: { player: 30 },
    goal: '守住这层楼的线路',
    mood: 0.2,
    world: { day: 2, floor: 2, gameMinute: 1335, night: true },
    self: { floor: 2, x: 480, hp: 30 },
    availableActions: ['dialogue', 'trade', 'gift', 'refuse'],
    recentEvents: [],
    ...overrides,
  };
}

describe('parseProposal：模型输出解析', () => {
  it('解析合法 dialogue JSON', () => {
    const raw = '{"utterance":"线路又烧了","action":{"type":"dialogue","text":"你身上有电池吗"},"confidence":0.8}';
    const p = parseProposal(raw);
    expect(p).not.toBeNull();
    expect(p?.action).toEqual({ type: 'dialogue', text: '你身上有电池吗' });
    expect(p?.confidence).toBe(0.8);
  });

  it('容忍 ```json 代码块包裹', () => {
    const raw = '```json\n{"action":{"type":"refuse"},"confidence":1}\n```';
    expect(parseProposal(raw)?.action).toEqual({ type: 'refuse' });
  });

  it('容忍前后杂音', () => {
    const raw = '好的，我的回复是：{"action":{"type":"flee"},"confidence":0.5} 希望有帮助';
    expect(parseProposal(raw)?.action).toEqual({ type: 'flee' });
  });

  it(' trade 的 give/get 数量缺省为 1', () => {
    const raw = '{"action":{"type":"trade","give":{"itemId":"wire"},"get":{"itemId":"scrap_metal"}},"confidence":0.9}';
    const p = parseProposal(raw);
    expect(p?.action).toEqual({ type: 'trade', give: { itemId: 'wire', quantity: 1 }, get: { itemId: 'scrap_metal', quantity: 1 } });
  });

  it('坏 JSON / 无 JSON / 未知类型 / 缺 action 全部返回 null', () => {
    expect(parseProposal('不是JSON')).toBeNull();
    expect(parseProposal('{oops')).toBeNull();
    expect(parseProposal('{"action":{"type":"mind_control"},"confidence":1}')).toBeNull();
    expect(parseProposal('{"confidence":1}')).toBeNull();
    expect(parseProposal('{"action":"dialogue"}')).toBeNull();
  });

  it('confidence 不是数字时归零（执行器会因低置信度拒绝）', () => {
    const raw = '{"action":{"type":"refuse"},"confidence":"很高"}';
    expect(parseProposal(raw)?.confidence).toBe(0);
  });

  it('extractJson 从文本里抠出对象', () => {
    expect(extractJson('前缀 {"a":1} 后缀')).toEqual({ a: 1 });
    expect(extractJson('没有对象')).toBeNull();
  });
});

describe('prompt 构造', () => {
  it('系统提示含人格、目标、铁律', () => {
    const sys = buildSystemPrompt(observation());
    expect(sys).toContain('alin');
    expect(sys).toContain('ally');
    expect(sys).toContain('利他80');
    expect(sys).toContain('守住这层楼的线路');
    expect(sys).toContain('只输出一个 JSON 对象');
  });

  it('用户提示含情境、记忆与可用行动', () => {
    let npc = createNpcState('ally');
    npc = recordMemory(npc, { day: 1, minute: 600, kind: 'gift', actor: 'player', summary: '赠送电池×1' });
    const obs = observation({ memory: recall(npc.memory, 6) });
    const user = buildUserPrompt(obs);
    expect(user).toContain('第2天');
    expect(user).toContain('夜间');
    expect(user).toContain('获赠［较重·恩情］：赠送电池×1');
    expect(user).toContain('dialogue, trade, gift, refuse');
  });

  // 记忆必须带分量。这条断言的作用不是「测一个新功能」，是钉住两条链路的
  // 语义一致：同一条记忆，走服务端代理（server/npc-proxy.mjs 的 buildMessages）
  // 和走 Spark 直连（这里的 fmtMemory）渲染出的强度词必须一样。
  //
  // 实测过的不一致：服务端会渲成「第3天 attack［严重负面］」，直连链路渲成
  // 「第3天 相遇」——weight 被整个丢掉，负向记忆和中性记忆长得一模一样。
  // 那正是「记忆能存、但影响不到决策」的断点，而且只在一条链路上有。
  it('记忆带强度词：正负分量在提示词里可区分', () => {
    const mem = (weight: number) => ([{
      id: 'm1', day: 3, minute: 600, kind: 'promise', actor: 'player',
      summary: '答应修门', weight,
    }]);
    // 五档边界与 server/npc-proxy.mjs 的 weightWord 必须逐档一致。
    // 两处各有一份实现（.mjs 无法 import .ts），只能靠断言对齐。
    //
    // 注意档位不是对称的：负向用 `>` 不是 `>=`，所以 -0.35 归「偏负面」、
    // -0.75 归「严重负面」，两个端点都往更重的一档落。写边界用例时不能
    // 想当然按 |w| 对称来推——这条我第一次就写错了，是靠跑测试才发现的。
    const cases: Array<[number, string]> = [
      [0.8, '极重·恩情'], [0.75, '极重·恩情'], [0.749, '较重·恩情'],
      [0.35, '较重·恩情'], [0.349, '一般'],
      [0, '一般'], [-0.349, '一般'],
      [-0.35, '偏负面·记恨'], [-0.749, '偏负面·记恨'],
      [-0.75, '严重负面·记恨'], [-0.9, '严重负面·记恨'],
    ];
    for (const [w, word] of cases) {
      const user = buildUserPrompt(observation({ memory: mem(w) }));
      expect(user, `weight=${w} 应渲染为「${word}」`).toContain(`［${word}］`);
    }
    // 正负必须长得不一样——这是「记忆影响决策」的前提。
    const pos = buildUserPrompt(observation({ memory: mem(0.8) }));
    const neg = buildUserPrompt(observation({ memory: mem(-0.9) }));
    expect(pos).not.toBe(neg);
    expect(neg).not.toContain('极重');
    // 2026-11-26 补的一条：正负两侧都要带**性质**词。
    // 旧映射只有负向说「负面」，正向只说「重」——模型因此只学得到「负面 → 戒备」
    // 一个方向（线上实测：负向记忆 5/5 全 refuse，正向记忆动不了）。
    // 性质词按产品真正产出的记忆种类选：守约/获赠是恩情，毁约/被拒是记恨。
    expect(pos).toContain('恩情');
    expect(neg).toContain('记恨');
    expect(pos).not.toContain('记恨');
    expect(neg).not.toContain('恩情');
  });

  // 回归防线：weight 一旦被丢掉，上面那条会因为找不到［…］而红。
  // 但还有一种退化方式——括号在、里面是空的或固定值。所以单独钉一次「正文也在」。
  it('记忆正文与强度词同时出现，不是只留其一', () => {
    const user = buildUserPrompt(observation({
      memory: [{ id: 'm1', day: 4, minute: 600, kind: 'attack', actor: 'player', summary: '被玩家打伤', weight: -0.9 }],
    }));
    expect(user).toContain('被玩家打伤');
    expect(user).toContain('严重负面');
    expect(user).toContain('遭袭');
  });

  it('无记忆时明说「尚无共同经历」而不是留空', () => {
    expect(buildUserPrompt(observation())).toContain('尚无共同经历');
  });

  it('用户提示带合法物品 ID 词表（实测 S2 交易被拒后的修复）', () => {
    const user = buildUserPrompt(observation());
    expect(user).toContain('合法物品ID');
    expect(user).toContain('wire(电线)');
    expect(user).toContain('battery(电池)');
  });

  it('itemVocabulary 覆盖全部 16 种物品且带中文名', () => {
    const vocab = itemVocabulary();
    expect(vocab).toContain('clean_water(净水)');
    expect(vocab).toContain('ration_pack(压缩口粮)');
    expect(vocab.split('、').length).toBe(15);
  });
});
