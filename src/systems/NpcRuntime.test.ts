import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { addItem } from '../systems/InventorySystem';
import { createNpcState } from '../data/npcPersonalities';
import { buildObservation, decideNpcAction, isDialogueFresh } from './NpcRuntime';
import type { NpcFact } from '../ai/rulesExecutor';
import type { NpcActionProposal, NpcBrain } from '../ai/types';

// 运行时的全部价值在降级链：主脑每一环出事，行为都必须收敛到
// 「改造前的选项树」，而不是卡住交互或把脏建议放进游戏。

class FakeBrain implements NpcBrain {
  constructor(
    readonly id: string,
    private readonly behavior: () => Promise<NpcActionProposal | null>,
    private readonly healthy = true,
  ) {}
  async health(): Promise<boolean> {
    return this.healthy;
  }
  async decide(): Promise<NpcActionProposal | null> {
    return this.behavior();
  }
}

const alinFact: NpcFact = {
  id: 'alin',
  archetype: 'ally',
  floor: 2,
  x: 480,
  hp: 30,
  inventory: [{ itemId: 'wire', quantity: 2 }],
};

function state() {
  const s = createNewGame(7);
  s.currentFloor = 2; // 阿林在 2 层，玩家走到同层才能交互
  return s;
}

function config(brain: NpcBrain, fallbackLine = '线路又烧了……你身上有电池吗？') {
  return {
    brain,
    fallback: new FakeBrain('option-tree', async () => ({ action: { type: 'dialogue' as const, text: fallbackLine }, confidence: 1 })),
  };
}

describe('buildObservation', () => {
  it('快照含人格、关系、夜间标记与可用行动', () => {
    const s = state();
    s.gameMinuteOfDay = 1320; // 夜间
    const obs = buildObservation(alinFact, createNpcState('ally'), s);
    expect(obs.npcId).toBe('alin');
    expect(obs.archetype).toBe('ally');
    expect(obs.world.night).toBe(true);
    expect(obs.availableActions).toContain('gift');
    expect(obs.availableActions).not.toContain('attack'); // 合作型没有攻击
  });

  it('白天 night=false', () => {
    const s = state();
    s.gameMinuteOfDay = 720;
    expect(buildObservation(alinFact, createNpcState('ally'), s).world.night).toBe(false);
  });
});

describe('decideNpcAction：降级链', () => {
  it('主脑健康且建议合法 → source=brain', async () => {
    const brain = new FakeBrain('ollama', async () => ({ action: { type: 'dialogue', text: '今晚挺安静' }, confidence: 0.9 }));
    const d = await decideNpcAction(state(), alinFact, createNpcState('ally'), config(brain));
    expect(d.source).toBe('brain');
    expect(d.validated.ok).toBe(true);
    if (d.validated.ok && d.validated.action.type === 'dialogue') expect(d.validated.action.text).toBe('今晚挺安静');
  });

  it('主脑不健康 → source=fallback，台词是选项树原句', async () => {
    const brain = new FakeBrain('ollama', async () => null, false);
    const d = await decideNpcAction(state(), alinFact, createNpcState('ally'), config(brain));
    expect(d.source).toBe('fallback');
    if (d.validated.ok && d.validated.action.type === 'dialogue') {
      expect(d.validated.action.text).toBe('线路又烧了……你身上有电池吗？');
    }
  });

  it('主脑超时 → source=fallback（不卡游戏循环）', async () => {
    const slow = new FakeBrain('ollama', () => new Promise((resolve) => setTimeout(() => resolve({ action: { type: 'refuse' as const }, confidence: 1 }), 50)));
    const d = await decideNpcAction(state(), alinFact, createNpcState('ally'), { ...config(slow), timeoutMs: 10 });
    expect(d.source).toBe('fallback');
  });

  it('主脑建议非法（NPC 没有的货）→ fallback 并记录 rejectionReason', async () => {
    const s = state();
    addItem(s.player.inventory, 'scrap_metal', 1);
    const brain = new FakeBrain('ollama', async () => ({
      action: { type: 'trade' as const, give: { itemId: 'battery' as const, quantity: 1 }, get: { itemId: 'scrap_metal' as const, quantity: 1 } },
      confidence: 0.9,
    }));
    const d = await decideNpcAction(s, alinFact, createNpcState('ally'), config(brain));
    expect(d.source).toBe('fallback');
    expect(d.rejectionReason).toContain('NPC 没有');
  });

  it('主脑无意见（null）→ fallback', async () => {
    const brain = new FakeBrain('ollama', async () => null);
    const d = await decideNpcAction(state(), alinFact, createNpcState('ally'), config(brain));
    expect(d.source).toBe('fallback');
  });

  it('主脑与降级脑都无意见 → rejected，不抛错', async () => {
    const brain = new FakeBrain('ollama', async () => null);
    const cfg = { brain, fallback: new FakeBrain('option-tree', async () => null) };
    const d = await decideNpcAction(state(), alinFact, createNpcState('ally'), cfg);
    expect(d.source).toBe('rejected');
    expect(d.validated.ok).toBe(false);
  });
});

describe('allowedActions：本阶段可用集（P1-1）', () => {
  it('模型提议可用集之外的行动 → 拒绝并降级', async () => {
    const s = state();
    const brain = new FakeBrain('ollama', async () => ({
      action: { type: 'gift' as const, itemId: 'wire' as const, quantity: 1 },
      confidence: 0.9,
    }));
    const d = await decideNpcAction(s, alinFact, createNpcState('ally'), {
      ...config(brain),
      allowedActions: ['dialogue'], // 第一阶段场景只接通对话
    });
    expect(d.source).toBe('fallback');
    expect(d.rejectionReason).toContain('不在本阶段可用集');
  });

  it('观察快照的 availableActions 反映传入的可用集', () => {
    const s = state();
    const obs = buildObservation(alinFact, createNpcState('ally'), s, 6, ['dialogue']);
    expect(obs.availableActions).toEqual(['dialogue']);
  });

  it('缺省可用集 = 人格原型全集', () => {
    const obs = buildObservation(alinFact, createNpcState('ally'), state());
    expect(obs.availableActions).toContain('gift');
    expect(obs.availableActions).not.toContain('attack');
  });
});

describe('事件可见性进入观察（P1-3）', () => {
  it('NPC 不在场的日记事件不进 recentEvents', () => {
    const s = state();
    s.diary = [
      { id: 'a', day: 1, minute: 600, floor: 2, kind: 'combat_wounded', actorIds: ['player', 'wanderer'], itemChanges: [], stressDelta: 0, message: '夜袭受伤' },
      { id: 'b', day: 2, minute: 600, floor: 2, kind: 'neighbor_cared', actorIds: ['player', 'alin'], itemChanges: [], stressDelta: 0, message: '和阿林交易' },
      { id: 'c', day: 3, minute: 600, floor: 2, kind: 'shelter_attacked', actorIds: ['player'], itemChanges: [], stressDelta: 0, message: '宿舍被袭' },
    ];
    const obs = buildObservation(alinFact, createNpcState('ally'), s);
    expect(obs.recentEvents).toEqual(["和阿林交易", "宿舍被袭"]); // 夜袭阿林不在场，不知道；其余按时间正序
  });
});

describe('isDialogueFresh：过期结果丢弃（P1-2）', () => {
  it('同一场对话且无操作 → 新鲜', () => {
    expect(isDialogueFresh({ sessionId: 1, revision: 0 }, { sessionId: 1, revision: 0 })).toBe(true);
  });

  it('玩家翻过选项（revision 变化）→ 过期', () => {
    expect(isDialogueFresh({ sessionId: 1, revision: 1 }, { sessionId: 1, revision: 0 })).toBe(false);
  });

  it('对话被关闭重开（sessionId 变化）→ 过期', () => {
    expect(isDialogueFresh({ sessionId: 2, revision: 0 }, { sessionId: 1, revision: 0 })).toBe(false);
  });

  it('对话已关闭（null）→ 过期', () => {
    expect(isDialogueFresh(null, { sessionId: 1, revision: 0 })).toBe(false);
    expect(isDialogueFresh(undefined, { sessionId: 1, revision: 0 })).toBe(false);
  });
});
