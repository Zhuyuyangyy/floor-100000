import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, buildUserPrompt, extractJson, parseProposal } from './prompt';
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
    expect(user).toContain('获赠：赠送电池×1');
    expect(user).toContain('dialogue, trade, gift, refuse');
  });

  it('无记忆时明说「尚无共同经历」而不是留空', () => {
    expect(buildUserPrompt(observation())).toContain('尚无共同经历');
  });
});
