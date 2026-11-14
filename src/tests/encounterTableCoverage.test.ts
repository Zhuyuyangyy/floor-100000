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

  // Three authored segment closers carry a guard: floor 5 ends the slum chapter
  // (the gatekeeper), floor 110 ends the dorm tier (the segment keeper) and
  // 50010 ends the VIP tier (the thing they keep upstairs). The floors in
  // between, including every segment top that has no authored content above
  // it, must not roll a boss — the industrial tier's top (1010) and the
  // commercial tier's top (10010) are gated by the freight lift's pass, not by
  // a guardian; the summit (100000) has no authored content yet at all.
  const BOSS_FLOORS = new Set([5, 110, 50010]);

  it('keeps the boss on the three authored segment closers only', () => {
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
    const commercial = PLAYABLE_FLOORS_V01.filter((f) => f >= 10000 && f < 50000);
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

  it('makes the VIP tier the most dangerous stretch so far, and its top the keeper', () => {
    // 生物兵器正式登场：富人特权区（50000-50010）的 ambush 高于中产区的天花板
    // （10010 层的 92）——五段里最高的一档，因为这一层游荡的不是保安，是养在
    // 楼上的东西。trader 略降（11→8，富人区不卖东西给穷人）但不为 0：纸条说
    // 「花钱能买到通行」，交易和近路都还在，只是更贵。loot 是五段里最低的
    // （4→2），cache 维持高位支撑上行。段顶 50010 放守段者：boss 108 是当层
    // 最高权重，压过 ambush 104，照 5 层和 110 的写法。权重逐层钉死，而不是
    // 只比大小：DEEPEST_FLOOR 现在就是 50010，哪一行权重表漏填都会被最深楼层
    // 的配置静默顶掉——只比大小的断言抓不到那种「整行变成邻居」的事故。
    const weight = (floor: number, kind: 'ambush' | 'trader' | 'loot' | 'cache'): number =>
      ENCOUNTER_TABLE[floor].find((e) => e.kind === kind)?.weight ?? 0;
    const commercial = PLAYABLE_FLOORS_V01.filter((f) => f >= 10000 && f < 50000);
    const vip = PLAYABLE_FLOORS_V01.filter((f) => f >= 50000);
    expect(vip).toEqual([
      50000, 50001, 50002, 50003, 50004, 50005, 50006, 50007, 50008, 50009, 50010,
    ]);
    const worstCommercialAmbush = Math.max(...commercial.map((f) => weight(f, 'ambush')));
    const bestCommercialTrader = Math.max(...commercial.map((f) => weight(f, 'trader')));
    for (const floor of vip) {
      expect(weight(floor, 'ambush'), `floor ${floor} ambush`).toBeGreaterThan(worstCommercialAmbush);
      // 略降但不为 0：富人区不卖东西给穷人，可通行终究是能买到的。
      expect(weight(floor, 'trader'), `floor ${floor} trader`).toBeGreaterThan(0);
      expect(weight(floor, 'trader'), `floor ${floor} trader`).toBeLessThan(bestCommercialTrader);
    }
    // ambush 逐层上行、loot 逐层降权、cache 维持高位：每一行都是自己的。
    expect(vip.map((f) => weight(f, 'ambush'))).toEqual([94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104]);
    expect(vip.map((f) => weight(f, 'loot'))).toEqual([4, 4, 3, 3, 3, 3, 2, 2, 2, 2, 2]);
    expect(vip.map((f) => weight(f, 'trader'))).toEqual([11, 11, 10, 10, 10, 9, 9, 9, 8, 8, 8]);
    expect(vip.map((f) => weight(f, 'cache'))).toEqual([18, 18, 19, 19, 19, 20, 20, 20, 21, 21, 22]);
    // 段顶 50010：boss 是当层最高权重（守楼关底，见面概率最大）。
    const top = ENCOUNTER_TABLE[50010];
    const boss = top.find((e) => e.kind === 'boss');
    expect(boss, 'floor 50010 should have a boss').toBeDefined();
    expect(boss!.weight).toBe(Math.max(...top.map((e) => e.weight)));
  });
});
