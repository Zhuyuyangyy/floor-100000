import { describe, expect, it, vi } from 'vitest';
import { createNewGame } from '../core/gameState';
import { createNpcState } from '../data/npcPersonalities';
import {
  eventVisibility,
  isValidNpcState,
  loadNpcState,
  nextMemoryId,
  recall,
  recordMemory,
  relationshipDelta,
  saveNpcState,
  trimMemory,
  visibleEvents,
} from './NpcMemory';
import type { MemoryEntry, NpcPersistedState } from '../ai/types';

function fresh(archetype: 'ally' | 'neutral' | 'hostile' = 'ally'): NpcPersistedState {
  return createNpcState(archetype);
}

function mem(id: string, weight: number): MemoryEntry {
  return { id, day: 1, minute: 600, kind: 'observed', actor: 'player', summary: id, weight };
}

describe('recordMemory：关系与情绪', () => {

  it('恩惠记正关系，攻击记负关系', () => {
    const s1 = recordMemory(fresh(), { day: 1, minute: 600, kind: 'gift', actor: 'player', summary: '送了电池' });
    expect(s1.relationship.player).toBeGreaterThan(0);
    const s2 = recordMemory(fresh(), { day: 1, minute: 600, kind: 'attack', actor: 'player', summary: '夜袭' });
    expect(s2.relationship.player).toBeLessThan(0);
  });

  it('关系值被钳制在 -100..100，不会被刷爆', () => {
    let s = fresh();
    for (let i = 0; i < 50; i++) {
      s = recordMemory(s, { day: 1, minute: 600, kind: 'gift', actor: 'player', summary: '送礼' });
    }
    expect(s.relationship.player).toBeLessThanOrEqual(100);
  });

  it('loyalty 越高关系变化越大', () => {
    const loyal = recordMemory(fresh('ally'), { day: 1, minute: 600, kind: 'gift', actor: 'player', summary: 'x' });
    const cold = recordMemory(fresh('neutral'), { day: 1, minute: 600, kind: 'gift', actor: 'player', summary: 'x' });
    expect(loyal.relationship.player).toBeGreaterThan(cold.relationship.player);
  });

  it('敌对 archetype 记仇翻倍', () => {
    const base = fresh('neutral');
    const hostile = fresh('hostile');
    const d1 = relationshipDelta(base, -0.5);
    const d2 = relationshipDelta(hostile, -0.5);
    expect(d2).toBeLessThan(d1); // 更负
  });

  it('情绪向最新记忆回归但保留残留', () => {
    let s = recordMemory(fresh(), { day: 1, minute: 600, kind: 'gift', actor: 'player', summary: 'x' });
    expect(s.mood).toBeGreaterThan(0);
    s = recordMemory(s, { day: 2, minute: 600, kind: 'observed', actor: 'player', summary: 'y' });
    expect(s.mood).toBeGreaterThan(0); // 没归零
    expect(s.mood).toBeLessThan(1);
  });
});

describe('trimMemory：有界淘汰', () => {
  it('超出上限时淘汰权重最低、同权重淘汰最旧', () => {
    const entries: MemoryEntry[] = [
      mem('a', 0.9),
      mem('b', 0.1),
      mem('c', 0.1),
      mem('d', -0.5),
    ];
    const kept = trimMemory(entries, 3);
    expect(kept.map((e) => e.id)).toEqual(['a', 'c', 'd']); // b 与 c 同权重，b 更旧被淘汰
  });

  it('未超上限时原样返回', () => {
    const entries = [mem('a', 0.5)];
    expect(trimMemory(entries, 5)).toBe(entries);
  });
});

describe('recall：检索预算', () => {
  it('按重要度取 top-k，再按时间正序排', () => {
    const memory: MemoryEntry[] = [
      { id: '1', day: 3, minute: 600, kind: 'observed', actor: 'player', summary: '旧事', weight: 0.1 },
      { id: '2', day: 1, minute: 600, kind: 'attack', actor: 'player', summary: '仇', weight: -0.9 },
      { id: '3', day: 2, minute: 600, kind: 'gift', actor: 'player', summary: '恩', weight: 0.6 },
    ];
    const top = recall(memory, 2);
    expect(top.map((e) => e.id)).toEqual(['2', '3']); // |0.9| > |0.6| > |0.1|
  });

  it('k=0 返回空，k 越界不抛错', () => {
    expect(recall([mem('a', 0.5)], 0)).toEqual([]);
    expect(recall([mem('a', 0.5)], 99)).toHaveLength(1);
  });
});

describe('存档桥接：npcStates', () => {

  it('存取往返一致', () => {
    const state = createNewGame(7);
    let npc = fresh();
    npc = recordMemory(npc, { day: 1, minute: 600, kind: 'gift', actor: 'player', summary: '送了电池' });
    saveNpcState(state, 'alin', npc);
    const loaded = loadNpcState(state, 'alin');
    expect(loaded).not.toBeNull();
    expect(loaded?.memory).toHaveLength(1);
    expect(loaded?.relationship.player).toBeGreaterThan(0);
  });

  it('坏 JSON 返回 null 而不是抛错（坏档不白屏）', () => {
    const state = createNewGame(7);
    state.npcStates['alin'] = '{oops';
    expect(loadNpcState(state, 'alin')).toBeNull();
  });

  it('缺条目按首次遇到处理', () => {
    const state = createNewGame(7);
    expect(loadNpcState(state, 'wanderer')).toBeNull();
  });

  it('id 全局唯一（UUID，刷新页面不重号）', () => {
    expect(nextMemoryId()).not.toBe(nextMemoryId());
  });

  it('id 跨「重启」不碰撞：重置模块后仍不与旧 id 重复', async () => {
    const before = nextMemoryId();
    vi.resetModules();
    const fresh = await import('./NpcMemory');
    expect(fresh.nextMemoryId()).not.toBe(before);
  });
});

describe('事件可见性：NPC 独立知识体系（P1-3）', () => {
  const ev = (kind: string, actorIds: string[]) => ({ id: 'e', day: 1, minute: 600, floor: 2, kind: kind as 'returned_from_scavenge', actorIds, itemChanges: [], stressDelta: 0, message: 'x' });

  it('NPC 在场 = 亲历', () => {
    expect(eventVisibility('alin', ev('trade', ['player', 'alin']))).toBe('witnessed');
  });

  it('公共事件（宿舍被袭）不到场也知道', () => {
    expect(eventVisibility('xiaozhou', ev('shelter_attacked', ['player']))).toBe('public');
  });

  it('不在场的普通事件 = 未知（不能进 prompt）', () => {
    expect(eventVisibility('xiaozhou', ev('combat_wounded', ['player', 'wanderer']))).toBe('unknown');
  });

  it('visibleEvents 只放行亲历与公共，保持时间顺序', () => {
    const events = [
      { id: 'a', day: 1, minute: 600, floor: 2, kind: 'combat_wounded' as const, actorIds: ['player', 'wanderer'], itemChanges: [], stressDelta: 0, message: '夜袭' },
      { id: 'b', day: 2, minute: 600, floor: 2, kind: 'shelter_attacked' as const, actorIds: ['player'], itemChanges: [], stressDelta: 0, message: '宿舍被袭' },
      { id: 'c', day: 3, minute: 600, floor: 2, kind: 'neighbor_cared' as const, actorIds: ['player', 'alin'], itemChanges: [], stressDelta: 0, message: '交易' },
    ];
    const seen = visibleEvents('alin', events);
    expect(seen.map((e) => e.id)).toEqual(['b', 'c']); // a 阿林不在场，不知道
  });
});

describe('isValidNpcState：坏状态判坏而不是喂给推理层（P2）', () => {
  const good = createNpcState('ally');

  it('合法状态通过', () => {
    expect(isValidNpcState(good)).toBe(true);
  });

  it('未知 archetype 拒绝', () => {
    expect(isValidNpcState({ ...good, archetype: 'chaotic' })).toBe(false);
  });

  it('人格分量越界拒绝', () => {
    expect(isValidNpcState({ ...good, traits: { ...good.traits, altruism: 1.5 } })).toBe(false);
    expect(isValidNpcState({ ...good, traits: { ...good.traits, caution: Number.NaN } })).toBe(false);
  });

  it('关系值越界拒绝', () => {
    expect(isValidNpcState({ ...good, relationship: { player: 101 } })).toBe(false);
  });

  it('情绪越界拒绝', () => {
    expect(isValidNpcState({ ...good, mood: -1.2 })).toBe(false);
  });

  it('畸形记忆条目拒绝', () => {
    expect(isValidNpcState({ ...good, memory: [{ id: '', day: 1, minute: 0, kind: 'gift', actor: 'player', summary: 'x', weight: 0.5 }] })).toBe(false);
    expect(isValidNpcState({ ...good, memory: [{ id: 'm', day: 1, minute: 99999, kind: 'gift', actor: 'player', summary: 'x', weight: 0.5 }] })).toBe(false);
  });

  it('loadNpcState 对 Schema 坏的状态返回 null（按首次遇到重建）', () => {
    const state = createNewGame(7);
    state.npcStates['alin'] = JSON.stringify({ ...good, traits: { ...good.traits, altruism: 9 } });
    expect(loadNpcState(state, 'alin')).toBeNull();
  });
});
