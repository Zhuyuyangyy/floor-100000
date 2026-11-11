import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { addItem } from '../systems/InventorySystem';
import { createNpcState } from '../data/npcPersonalities';
import { buildObservation, decideNpcAction } from './NpcRuntime';
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
