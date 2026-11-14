import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { TIERS } from '../core/tower';
import type { TierId } from '../core/tower';
import { NOTE_TEXTS_BY_TIER, resolveEncounter } from '../systems/encounters';
import type { Encounter } from '../systems/encounters';

// 每个阶层的代表楼层（1..6 的区间见 core/tower.ts）。
const TIER_SAMPLE_FLOORS: Record<TierId, number> = {
  1: 1,
  2: 150,
  3: 1500,
  4: 12000,
  5: 60000,
  6: 95000,
};

// 固定 seed 集，用于统计同一楼层能取到的纸条集合。
const SEEDS: number[] = Array.from({ length: 200 }, (_, i) => i + 1);

function makeNote(floor: number): Encounter {
  return { kind: 'note', floor, message: 'test' };
}

function noteFor(seed: number, floor: number): string {
  return resolveEncounter(createNewGame(seed), makeNote(floor), 'read').message;
}

describe('纸条文案按阶层分组', () => {
  it('6 个阶层都有配置，且每组恰好 3 条', () => {
    const ids = TIERS.map((t) => t.id);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6]);
    for (const id of ids) {
      const group = NOTE_TEXTS_BY_TIER[id];
      expect(group).toBeDefined();
      expect(group.length).toBe(3);
      // 组内不重复，否则「3 条轮换」会退化成 2 条。
      expect(new Set(group).size).toBe(3);
    }
  });

  it('同 seed + 同楼层取到的纸条稳定（两次调用一致）', () => {
    for (const tier of TIERS) {
      const floor = TIER_SAMPLE_FLOORS[tier.id];
      for (const seed of SEEDS.slice(0, 20)) {
        expect(noteFor(seed, floor)).toBe(noteFor(seed, floor));
      }
    }
  });

  it('每个楼层只会取到本阶层的文案', () => {
    for (const tier of TIERS) {
      const floor = TIER_SAMPLE_FLOORS[tier.id];
      const group = new Set(NOTE_TEXTS_BY_TIER[tier.id]);
      for (const seed of SEEDS) {
        expect(group.has(noteFor(seed, floor))).toBe(true);
      }
    }
  });

  it('阶层 1（楼层 1）与阶层 3（楼层 1500）的文案集合不相交', () => {
    const t1 = new Set(NOTE_TEXTS_BY_TIER[1]);
    const t3 = new Set(NOTE_TEXTS_BY_TIER[3]);
    const overlap = [...t1].filter((text) => t3.has(text));
    expect(overlap).toEqual([]);
  });

  it('非法楼层不抛异常，回退到阶层 1 的文案', () => {
    const group = new Set(NOTE_TEXTS_BY_TIER[1]);
    for (const floor of [0, -5, 100001, 1.5]) {
      const msg = resolveEncounter(createNewGame(7), makeNote(floor), 'read').message;
      expect(group.has(msg)).toBe(true);
    }
  });
});
