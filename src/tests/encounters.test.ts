import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import type { GameState } from '../core/gameTypes';
import { addItem, countItem } from '../systems/InventorySystem';
import {
  ENCOUNTER_TABLE,
  markResolved,
  resolveEncounter,
  rollEncounter,
  shouldSkip,
} from '../systems/encounters';
import type { Encounter, EncounterChoice, EncounterKind } from '../systems/encounters';

// 固定 200 个 seed 做统计；seed 固定 => 结果完全确定，无随机抖动。
const SEEDS: number[] = Array.from({ length: 200 }, (_, i) => i + 1);

function makeEncounter(kind: EncounterKind, floor: number): Encounter {
  return { kind, floor, message: 'test' };
}

function totalSlots(s: GameState): number {
  return s.player.inventory.slots.length;
}

describe('rollEncounter（确定性）', () => {
  it('同 seed 同 spotId 结果完全一致', () => {
    const a = createNewGame(42);
    const b = createNewGame(42);
    const r1 = rollEncounter(a, 3, 'spot_a');
    const r2 = rollEncounter(b, 3, 'spot_a');
    expect(r1).toEqual(r2);
  });

  it('不同 spotId 会改变 roll（seed 输入含 spotId）', () => {
    const s = createNewGame(42);
    const kinds = new Set<EncounterKind>();
    for (const spot of ['spot_a', 'spot_b', 'spot_c', 'spot_d']) {
      kinds.add(rollEncounter(s, 3, spot).kind);
    }
    // 固定 seed 下断言确切值不可读，但 4 个 spot 至少出现 2 种不同遭遇，
    // 证明 spotId 确实进入了 seed（对 seed 42、floor 3 成立）。
    expect(kinds.size).toBeGreaterThan(1);
  });
});

describe('ENCOUNTER_TABLE（权重趋势）', () => {
  it('覆盖 1..5 全部楼层，且 5 层必含 boss', () => {
    for (const floor of [1, 2, 3, 4, 5]) {
      expect(ENCOUNTER_TABLE[floor]).toBeDefined();
      expect(ENCOUNTER_TABLE[floor].length).toBeGreaterThan(0);
    }
    const floor5 = ENCOUNTER_TABLE[5];
    const boss = floor5.find((e) => e.kind === 'boss');
    expect(boss).toBeDefined();
    // boss 权重为 5 层最高（守楼关底，见面概率最大）。
    const maxWeight = Math.max(...floor5.map((e) => e.weight));
    expect(boss!.weight).toBe(maxWeight);
  });

  it('200 seed 统计：3 层以上 ambush+cache 合计占比大于 1 层', () => {
    const share = (floor: number): number => {
      let hit = 0;
      for (const seed of SEEDS) {
        const s = createNewGame(seed);
        const kind = rollEncounter(s, floor, 'spot_a').kind;
        if (kind === 'ambush' || kind === 'cache') hit++;
      }
      return hit / SEEDS.length;
    };
    const low = share(1);
    const high = (share(3) + share(4) + share(5)) / 3;
    expect(high).toBeGreaterThan(low);
    // 1 层 ambush 单类占比应很低（loot 主导）。
    let ambush1 = 0;
    for (const seed of SEEDS) {
      const s = createNewGame(seed);
      if (rollEncounter(s, 1, 'spot_a').kind === 'ambush') ambush1++;
    }
    expect(ambush1 / SEEDS.length).toBeLessThan(0.15);
  });

  it('层数越高普通 loot 占比越小（1 层 > 4 层）', () => {
    const lootShare = (floor: number): number => {
      let hit = 0;
      for (const seed of SEEDS) {
        const s = createNewGame(seed);
        if (rollEncounter(s, floor, 'spot_a').kind === 'loot') hit++;
      }
      return hit / SEEDS.length;
    };
    expect(lootShare(1)).toBeGreaterThan(lootShare(4));
  });
});

describe('resolveEncounter：loot / cache', () => {
  it('loot take 给 1-2 件物资且真实入包', () => {
    const s = createNewGame(1);
    const before = totalSlots(s);
    const r = resolveEncounter(s, makeEncounter('loot', 3), 'take');
    expect(r.consumed).toBe(true);
    expect(r.hpChange).toBe(0);
    expect(r.items.length).toBeGreaterThanOrEqual(1);
    expect(r.items.length).toBeLessThanOrEqual(2);
    expect(totalSlots(s)).toBe(before + r.items.length);
    // 入包的 id 与流水一致。
    for (const g of r.items) {
      expect(countItem(s.player.inventory, g.itemId)).toBeGreaterThanOrEqual(g.quantity);
    }
  });

  it('loot 池按楼层收敛：1 层只出 bread/cloth/scrap_metal/tape，5 层只出高阶件', () => {
    const pool1 = new Set(['bread', 'cloth', 'scrap_metal', 'tape']);
    const pool5 = new Set(['filter', 'fuse', 'battery', 'wire', 'scrap_metal']);
    for (const seed of SEEDS) {
      const s1 = createNewGame(seed);
      const r1 = resolveEncounter(s1, makeEncounter('loot', 1), 'take');
      for (const g of r1.items) expect(pool1.has(g.itemId)).toBe(true);

      const s5 = createNewGame(seed);
      const r5 = resolveEncounter(s5, makeEncounter('loot', 5), 'take');
      for (const g of r5.items) expect(pool5.has(g.itemId)).toBe(true);
    }
  });

  it('cache take 5 层必含 clean_water×2 且比 loot 肥（含医疗包）', () => {
    const s = createNewGame(1); // 初始自带 clean_water×3
    const before = countItem(s.player.inventory, 'clean_water');
    const r = resolveEncounter(s, makeEncounter('cache', 5), 'take');
    expect(r.consumed).toBe(true);
    expect(r.items).toContainEqual({ itemId: 'clean_water', quantity: 2 });
    expect(r.items).toContainEqual({ itemId: 'medkit', quantity: 1 });
    expect(countItem(s.player.inventory, 'clean_water')).toBe(before + 2);
    expect(countItem(s.player.inventory, 'medkit')).toBe(1);
  });

  it('cache take 1-2 层给净水或医疗包二选一', () => {
    for (const seed of SEEDS) {
      const s = createNewGame(seed);
      const r = resolveEncounter(s, makeEncounter('cache', 1), 'take');
      expect(r.items.length).toBe(1);
      expect(['clean_water', 'medkit']).toContain(r.items[0].itemId);
      expect(countItem(s.player.inventory, r.items[0].itemId)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('resolveEncounter：ambush', () => {
  it('fight 有撬棍：轻伤并缴获 1-2 件战利品', () => {
    const s = createNewGame(7);
    addItem(s.player.inventory, 'crowbar', 1);
    const before = totalSlots(s);
    const r = resolveEncounter(s, makeEncounter('ambush', 3), 'fight');
    expect(r.consumed).toBe(true);
    expect(r.hpChange).toBeGreaterThanOrEqual(-15);
    expect(r.hpChange).toBeLessThanOrEqual(-8);
    expect(r.items.length).toBeGreaterThanOrEqual(1);
    expect(totalSlots(s)).toBe(before + r.items.length);
  });

  it('fight 无撬棍：重伤且无战利品', () => {
    const s = createNewGame(7);
    const before = totalSlots(s);
    const r = resolveEncounter(s, makeEncounter('ambush', 3), 'fight');
    expect(r.consumed).toBe(true);
    expect(r.hpChange).toBeGreaterThanOrEqual(-35);
    expect(r.hpChange).toBeLessThanOrEqual(-20);
    expect(r.items).toEqual([]);
    expect(totalSlots(s)).toBe(before);
  });

  it('flee：零伤无物安全撤离', () => {
    const s = createNewGame(7);
    const r = resolveEncounter(s, makeEncounter('ambush', 3), 'flee');
    expect(r.hpChange).toBe(0);
    expect(r.items).toEqual([]);
    expect(r.consumed).toBe(true);
    expect(r.message.length).toBeGreaterThan(0);
  });
});

describe('resolveEncounter：trader', () => {
  it('trade 脏水不足：半笔不发生（slots 不变、consumed=false）', () => {
    const s = createNewGame(1);
    addItem(s.player.inventory, 'dirty_water', 1); // 只有 1 瓶，不够 2 瓶
    const before = totalSlots(s);
    const dirtyBefore = countItem(s.player.inventory, 'dirty_water');
    const cleanBefore = countItem(s.player.inventory, 'clean_water');
    const r = resolveEncounter(s, makeEncounter('trader', 2), 'trade');
    expect(r.consumed).toBe(false);
    expect(r.items).toEqual([]);
    expect(totalSlots(s)).toBe(before);
    expect(countItem(s.player.inventory, 'dirty_water')).toBe(dirtyBefore);
    expect(countItem(s.player.inventory, 'clean_water')).toBe(cleanBefore);
  });

  it('trade 原子交换成功：-2 脏水 +1 净水', () => {
    const s = createNewGame(1);
    addItem(s.player.inventory, 'dirty_water', 2);
    const dirtyBefore = countItem(s.player.inventory, 'dirty_water');
    const cleanBefore = countItem(s.player.inventory, 'clean_water');
    const r = resolveEncounter(s, makeEncounter('trader', 2), 'trade');
    expect(r.consumed).toBe(true);
    expect(r.items).toContainEqual({ itemId: 'clean_water', quantity: 1 });
    expect(countItem(s.player.inventory, 'dirty_water')).toBe(dirtyBefore - 2);
    expect(countItem(s.player.inventory, 'clean_water')).toBe(cleanBefore + 1);
  });

  it('leave：直接走开，无变动', () => {
    const s = createNewGame(1);
    const r = resolveEncounter(s, makeEncounter('trader', 2), 'leave');
    expect(r.consumed).toBe(true);
    expect(r.hpChange).toBe(0);
    expect(r.items).toEqual([]);
  });
});

describe('resolveEncounter：note / boss', () => {
  it('note read：不掉血不给物，有文案', () => {
    const s = createNewGame(1);
    const before = totalSlots(s);
    const r = resolveEncounter(s, makeEncounter('note', 1), 'read');
    expect(r.hpChange).toBe(0);
    expect(r.items).toEqual([]);
    expect(r.consumed).toBe(true);
    expect(r.message.length).toBeGreaterThan(4);
    expect(totalSlots(s)).toBe(before);
  });

  it('note read 文案在 4 条池内轮换（200 seed 全覆盖）', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const s = createNewGame(seed);
      seen.add(resolveEncounter(s, makeEncounter('note', 1), 'read').message);
    }
    // 固定 seed 下 200 次至少出现 2 种不同纸条，证明是 seeded 轮换而非定值。
    expect(seen.size).toBeGreaterThan(1);
  });

  it('boss fight 无撬棍无医疗包：大败（-45..-60）且无物品', () => {
    const s = createNewGame(1);
    const before = totalSlots(s);
    const r = resolveEncounter(s, makeEncounter('boss', 5), 'fight');
    expect(r.consumed).toBe(true);
    expect(r.hpChange).toBeGreaterThanOrEqual(-60);
    expect(r.hpChange).toBeLessThanOrEqual(-45);
    expect(r.items).toEqual([]);
    expect(totalSlots(s)).toBe(before);
  });

  it('boss fight 有撬棍：胜（-25..-40）且得医疗包+2 件肥物资', () => {
    const s = createNewGame(1);
    addItem(s.player.inventory, 'crowbar', 1);
    const before = totalSlots(s);
    const r = resolveEncounter(s, makeEncounter('boss', 5), 'fight');
    expect(r.consumed).toBe(true);
    expect(r.hpChange).toBeGreaterThanOrEqual(-40);
    expect(r.hpChange).toBeLessThanOrEqual(-25);
    expect(r.items).toContainEqual({ itemId: 'medkit', quantity: 1 });
    expect(r.items.length).toBe(3); // medkit + 2 件战利品
    expect(countItem(s.player.inventory, 'medkit')).toBe(1);
    expect(totalSlots(s)).toBe(before + 3);
  });

  it('boss fight 仅有医疗包也可胜', () => {
    const s = createNewGame(1);
    addItem(s.player.inventory, 'medkit', 1);
    const r = resolveEncounter(s, makeEncounter('boss', 5), 'fight');
    expect(r.hpChange).toBeGreaterThanOrEqual(-40);
    expect(r.hpChange).toBeLessThanOrEqual(-25);
    expect(r.items).toContainEqual({ itemId: 'medkit', quantity: 1 });
  });

  it('boss flee：被挠一下（-10）无物品', () => {
    const s = createNewGame(1);
    const r = resolveEncounter(s, makeEncounter('boss', 5), 'flee');
    expect(r.hpChange).toBe(-10);
    expect(r.items).toEqual([]);
    expect(r.consumed).toBe(true);
  });
});

describe('shouldSkip / markResolved 与非法选择', () => {
  it('markResolved 后 shouldSkip 返回 true（含懒初始化）', () => {
    const s = createNewGame(1);
    expect(shouldSkip(s, 'spot_a')).toBe(false);
    markResolved(s, 'spot_a', 'loot:take');
    expect(shouldSkip(s, 'spot_a')).toBe(true);
    expect(s.encounters!['spot_a']).toBe('loot:take');
    expect(shouldSkip(s, 'spot_b')).toBe(false);
  });

  it('encounters 缺字段（旧存档）时 markResolved 懒初始化', () => {
    const s = createNewGame(1);
    s.encounters = undefined;
    expect(shouldSkip(s, 'spot_a')).toBe(false);
    markResolved(s, 'spot_a', 'boss:flee');
    expect(s.encounters).toBeDefined();
    expect(shouldSkip(s, 'spot_a')).toBe(true);
  });

  it('非法 choice 返回 consumed=false 且不产生任何变动', () => {
    const s = createNewGame(1);
    const before = totalSlots(s);
    const cases: Array<[EncounterKind, EncounterChoice]> = [
      ['trader', 'take'],
      ['loot', 'fight'],
      ['note', 'take'],
      ['boss', 'trade'],
      ['cache', 'read'],
      ['ambush', 'read'],
    ];
    for (const [kind, choice] of cases) {
      const r = resolveEncounter(s, makeEncounter(kind, 3), choice);
      expect(r.consumed).toBe(false);
      expect(r.hpChange).toBe(0);
      expect(r.items).toEqual([]);
      expect(totalSlots(s)).toBe(before);
    }
  });
});
