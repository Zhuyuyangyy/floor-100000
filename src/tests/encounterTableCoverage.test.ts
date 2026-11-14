import { describe, expect, it } from 'vitest';
import { ENCOUNTER_TABLE } from '../systems/encounters';
import { PLAYABLE_FLOORS_V01 } from '../core/constants';

// Regression for the floor expansion: ENCOUNTER_TABLE is built at module
// init, so a missing weight profile does not fail a test — it fails the whole
// game before the menu draws ("Cannot read properties of undefined (reading
// 'loot')", because 'loot' is the first kind the filter probes). That happened
// when the list grew to 10, again when tier 2 (100-110) was authored, and once
// more when tier 3 (1000-1010) was.
describe('every playable floor can roll an encounter', () => {
  it('has a non-empty weighted table for all playable floors', () => {
    for (const floor of PLAYABLE_FLOORS_V01) {
      const row = ENCOUNTER_TABLE[floor];
      expect(row, `floor ${floor} has no encounter row`).toBeDefined();
      expect(row.length, `floor ${floor} has an empty encounter row`).toBeGreaterThan(0);
      for (const entry of row) expect(entry.weight).toBeGreaterThan(0);
    }
  });

  // Two authored segment closers carry a guard: floor 5 ends the slum chapter
  // (the gatekeeper), floor 110 ends the dorm tier (the segment keeper). The
  // floors in between, including every segment top that has no authored
  // content above it, must not roll a boss — the industrial tier's top (1010)
  // is gated by the freight lift's pass, not by a guardian, and so is the
  // commercial tier's top (10010): the boss belongs to tier 5's segment.
  const BOSS_FLOORS = new Set([5, 110]);

  it('keeps the boss on the two authored segment closers only', () => {
    for (const floor of PLAYABLE_FLOORS_V01) {
      const hasBoss = ENCOUNTER_TABLE[floor].some((e) => e.kind === 'boss');
      if (BOSS_FLOORS.has(floor)) expect(hasBoss, `floor ${floor} should have a boss`).toBe(true);
      else expect(hasBoss, `floor ${floor} should not have a boss`).toBe(false);
    }
  });

  it('gives every tier above the slum a heavier ambush than any slum floor', () => {
    const ambush = (floor: number): number =>
      ENCOUNTER_TABLE[floor].find((e) => e.kind === 'ambush')?.weight ?? 0;
    const worstSlum = Math.max(...PLAYABLE_FLOORS_V01.filter((f) => f < 100).map(ambush));
    for (const floor of PLAYABLE_FLOORS_V01.filter((f) => f >= 100 && f !== 110)) {
      expect(ambush(floor), `floor ${floor} ambush`).toBeGreaterThan(worstSlum);
    }
  });

  it('makes the industrial tier the most dangerous stretch so far', () => {
    // 军队级安保：工业与交易区（1000-1010）的 ambush 高于工人宿舍区的天花板
    // （109 层的 65），交易区的 trader 权重也高于宿舍区。这一段没有守段者。
    const weight = (floor: number, kind: 'ambush' | 'trader'): number =>
      ENCOUNTER_TABLE[floor].find((e) => e.kind === kind)?.weight ?? 0;
    const dorm = PLAYABLE_FLOORS_V01.filter((f) => f >= 100 && f < 1000);
    const industrial = PLAYABLE_FLOORS_V01.filter((f) => f >= 1000 && f < 10000);
    expect(industrial).toEqual([1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010]);
    const worstDormAmbush = Math.max(...dorm.map((f) => weight(f, 'ambush')));
    const bestDormTrader = Math.max(...dorm.map((f) => weight(f, 'trader')));
    for (const floor of industrial) {
      expect(weight(floor, 'ambush'), `floor ${floor} ambush`).toBeGreaterThan(worstDormAmbush);
      expect(weight(floor, 'trader'), `floor ${floor} trader`).toBeGreaterThan(bestDormTrader);
    }
  });

  it('makes the commercial tier the most dangerous stretch so far, and the best traded', () => {
    // 私人武装 + 实验体雏形：中产与商业区（10000-10010）的 ambush 高于工业区
    // 的天花板（1010 层的 80），trader 权重是四段里最高的（商铺街——工业区
    // 最高才 12）。这一段同样没有守段者：10010 把着的是许可证，不是怪物。
    // 权重逐层钉死，而不是只比大小：DEEPEST_FLOOR 现在就是 10010，哪一行
    // 权重表漏填都会被最深楼层的配置静默顶掉——只比大小的断言抓不到那种
    // 「整行变成邻居」的事故。
    const weight = (floor: number, kind: 'ambush' | 'trader' | 'loot'): number =>
      ENCOUNTER_TABLE[floor].find((e) => e.kind === kind)?.weight ?? 0;
    const industrial = PLAYABLE_FLOORS_V01.filter((f) => f >= 1000 && f < 10000);
    const commercial = PLAYABLE_FLOORS_V01.filter((f) => f >= 10000);
    expect(commercial).toEqual([
      10000, 10001, 10002, 10003, 10004, 10005, 10006, 10007, 10008, 10009, 10010,
    ]);
    const worstIndustrialAmbush = Math.max(...industrial.map((f) => weight(f, 'ambush')));
    const bestIndustrialTrader = Math.max(...industrial.map((f) => weight(f, 'trader')));
    for (const floor of commercial) {
      expect(weight(floor, 'ambush'), `floor ${floor} ambush`).toBeGreaterThan(worstIndustrialAmbush);
      expect(weight(floor, 'trader'), `floor ${floor} trader`).toBeGreaterThan(bestIndustrialTrader);
    }
    // ambush 逐层上行、loot 逐层降权：这也是「每一行都是自己的」的形状。
    expect(commercial.map((f) => weight(f, 'ambush'))).toEqual([82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92]);
    expect(commercial.map((f) => weight(f, 'loot'))).toEqual([7, 7, 6, 6, 6, 5, 5, 5, 4, 4, 4]);
  });
});
