import { describe, expect, it } from 'vitest';
import type { MemoryEntry, NpcObservation } from '../types';
import { LocalPersonaBrain } from './localPersonaBrain';

function observation(overrides: Partial<NpcObservation> = {}): NpcObservation {
  return {
    npcId: 'alin',
    archetype: 'ally',
    traits: { altruism: 0.8, pragmatism: 0.3, aggression: 0.05, loyalty: 0.7, caution: 0.4 },
    memory: [],
    relationship: {},
    goal: '守住这层楼的线路，换到维修材料',
    mood: 0,
    world: { day: 1, floor: 2, gameMinute: 360, night: false },
    self: { floor: 2, x: 480, hp: 30 },
    availableActions: ['dialogue'],
    recentEvents: [],
    ...overrides,
  };
}

function dialogueText(proposal: Awaited<ReturnType<LocalPersonaBrain['decide']>>): string {
  if (!proposal || proposal.action.type !== 'dialogue') throw new Error('expected dialogue proposal');
  return proposal.action.text;
}

describe('LocalPersonaBrain', () => {
  it('is always available offline and proposes only a bounded dialogue action', async () => {
    const brain = new LocalPersonaBrain();
    expect(await brain.health()).toBe(true);
    const proposal = await brain.decide(observation());
    expect(proposal).toMatchObject({ confidence: 1, action: { type: 'dialogue' } });
    expect(dialogueText(proposal)).toContain('我是阿林');
  });

  it('changes the line when night falls, without random output', async () => {
    const brain = new LocalPersonaBrain();
    const dayLine = dialogueText(await brain.decide(observation()));
    const nightLine = dialogueText(await brain.decide(observation({
      world: { day: 1, floor: 2, gameMinute: 1260, night: true },
    })));
    expect(nightLine).toContain('夜里');
    expect(nightLine).not.toBe(dayLine);
    expect(dialogueText(await brain.decide(observation({
      world: { day: 1, floor: 2, gameMinute: 1260, night: true },
    })))).toBe(nightLine);
  });

  it('uses recorded relationship history rather than inventing a specific transaction', async () => {
    const memory: MemoryEntry = {
      id: 'mem-1', day: 1, minute: 600, kind: 'trade', actor: 'player',
      summary: '玩家完成了一笔交易', weight: 0.15,
    };
    const text = dialogueText(await new LocalPersonaBrain().decide(observation({
      memory: [memory],
      relationship: { player: 12 },
    })));
    expect(text).toContain('上次那笔交易我记着');
    expect(text).not.toContain('电池');
  });

  it('gives the neutral NPC a different pragmatic voice', async () => {
    const text = dialogueText(await new LocalPersonaBrain().decide(observation({
      npcId: 'xiaozhou',
      archetype: 'neutral',
      traits: { altruism: 0.4, pragmatism: 0.8, aggression: 0.2, loyalty: 0.3, caution: 0.6 },
      goal: '换到口粮和净水，安稳过天',
    })));
    expect(text).toContain('我是小周');
    expect(text).toContain('条件先讲好');
  });
});
