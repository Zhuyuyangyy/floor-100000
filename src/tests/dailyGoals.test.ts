import { describe, expect, it } from 'vitest';

import { ensureDailyGoal, grantDailyGoalReward, isDailyGoalDone } from '../systems/dailyGoals';
import type { DailyGoalKind } from '../systems/dailyGoals';
import { addItem, countItem, removeItem } from '../systems/InventorySystem';
import { createNewGame } from '../core/gameState';
import { hasFlag, flagKey } from '../systems/WorldFlags';
import type { FloorVisit } from '../core/gameTypes';

// OVERHAUL W3：每日目标。钉死四类不变量——seeded 确定性、跨天重 roll 且当天
// 幂等、四类各有达成/未达成路径、奖励只发一次。

function visit(opened: string[]): FloorVisit {
  return { openedContainers: opened, lootedItems: [], unlockedDoors: [], localEvents: [] };
}

describe('ensureDailyGoal', () => {
  it('seeded 确定性：同 seed 同一天 roll 出同一个目标', () => {
    const a = createNewGame(42);
    const b = createNewGame(42);
    ensureDailyGoal(a);
    ensureDailyGoal(b);
    expect(a.dailyGoal).toEqual(b.dailyGoal);
    expect(a.dailyGoal).toBeDefined();
  });

  it('当天幂等：重复调用不重新 roll（玩家不该追一个移动靶）', () => {
    const s = createNewGame(42);
    ensureDailyGoal(s);
    const first = s.dailyGoal;
    ensureDailyGoal(s);
    expect(s.dailyGoal).toBe(first); // 同一引用：没有替换对象
  });

  it('跨天换目标：day 变化后重 roll，且新目标属于新的一天', () => {
    const s = createNewGame(42);
    ensureDailyGoal(s);
    const day1 = s.dailyGoal;
    s.day = 2;
    ensureDailyGoal(s);
    expect(s.dailyGoal!.day).toBe(2);
    expect(s.dailyGoal).not.toBe(day1);
    // 重 roll 不是冻结的：固定 seed 序列里至少有一天两天的目标不同。
    let changed = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const a = createNewGame(seed);
      ensureDailyGoal(a);
      const b = createNewGame(seed);
      b.day = 2;
      ensureDailyGoal(b);
      if (a.dailyGoal!.kind !== b.dailyGoal!.kind || a.dailyGoal!.target !== b.dailyGoal!.target) changed++;
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('旧存档兼容：dailyGoal 缺失时补一个当天的', () => {
    const s = createNewGame(5);
    delete s.dailyGoal;
    ensureDailyGoal(s);
    expect(s.dailyGoal).toBeDefined();
    expect(s.dailyGoal!.day).toBe(s.day);
    expect(s.dailyGoal!.done).toBe(false);
  });

  it('目标参数落在设计区间（固定 seed 序列，确定性）', () => {
    const kinds = new Set<DailyGoalKind>();
    for (let seed = 1; seed <= 80; seed++) {
      const s = createNewGame(seed);
      ensureDailyGoal(s);
      const g = s.dailyGoal!;
      kinds.add(g.kind);
      switch (g.kind) {
        case 'water':
          expect(g.target).toBeGreaterThanOrEqual(2);
          expect(g.target).toBeLessThanOrEqual(3);
          break;
        case 'containers':
          expect(g.target).toBeGreaterThanOrEqual(3);
          expect(g.target).toBeLessThanOrEqual(4);
          break;
        case 'upgrade':
          expect(g.target).toBe(1);
          break;
        case 'floor':
          expect(g.target).toBeGreaterThanOrEqual(2);
          expect(g.target).toBeLessThanOrEqual(4); // 不超过可玩上限 5
          break;
      }
    }
    // 四类都出现过——权重表不是死的。
    expect(kinds.size).toBe(4);
  });
});

describe('isDailyGoalDone', () => {
  it('water：净水数达标 / 不达标（边界 target-1 不算）', () => {
    const s = createNewGame(1);
    removeItem(s.player.inventory, 'clean_water', 3); // 先清零，避免起始 3 瓶干扰
    s.dailyGoal = { day: s.day, kind: 'water', target: 2, done: false };
    expect(isDailyGoalDone(s)).toBe(false);
    addItem(s.player.inventory, 'clean_water', 1);
    expect(isDailyGoalDone(s)).toBe(false); // 1 < 2
    addItem(s.player.inventory, 'clean_water', 1);
    expect(isDailyGoalDone(s)).toBe(true); // 2 >= 2
  });

  it('containers：当天各层 openedContainers 总数达标 / 不达标', () => {
    const s = createNewGame(1);
    s.dailyGoal = { day: s.day, kind: 'containers', target: 3, done: false };
    expect(isDailyGoalDone(s)).toBe(false); // 没搜过任何容器
    s.visitedFloors = { 1: visit(['c1', 'c2']), 2: visit(['c3']) };
    expect(isDailyGoalDone(s)).toBe(true); // 2 + 1 = 3 >= 3
    s.visitedFloors = { 1: visit(['c1', 'c2']) };
    expect(isDailyGoalDone(s)).toBe(false); // 2 < 3
  });

  it('upgrade：homeUpgrades 长度达标 / 不达标', () => {
    const s = createNewGame(1);
    s.dailyGoal = { day: s.day, kind: 'upgrade', target: 1, done: false };
    expect(isDailyGoalDone(s)).toBe(false);
    s.player.homeUpgrades.push('rain_collector');
    expect(isDailyGoalDone(s)).toBe(true);
  });

  it('floor：currentFloor 达标 / 不达标', () => {
    const s = createNewGame(1);
    s.dailyGoal = { day: s.day, kind: 'floor', target: 2, done: false };
    expect(isDailyGoalDone(s)).toBe(false); // 起始 1 层
    s.currentFloor = 2;
    expect(isDailyGoalDone(s)).toBe(true);
  });
});

describe('grantDailyGoalReward', () => {
  it('未完成不发：done 保持 false、bestScore 不动', () => {
    const s = createNewGame(7);
    removeItem(s.player.inventory, 'clean_water', 3);
    s.dailyGoal = { day: s.day, kind: 'water', target: 2, done: false };
    expect(grantDailyGoalReward(s)).toBe(false);
    expect(s.dailyGoal!.done).toBe(false);
    expect(s.records!.bestScore).toBe(0); // createNewGame 预置的空 records 不被写分
  });

  it('完成发一次：bestScore +80、口粮 +1，二次调用返回 false', () => {
    const s = createNewGame(7);
    s.dailyGoal = { day: s.day, kind: 'upgrade', target: 1, done: false };
    s.player.homeUpgrades.push('rain_collector');
    const rationsBefore = countItem(s.player.inventory, 'ration_pack'); // 起始 2
    expect(grantDailyGoalReward(s)).toBe(true);
    expect(s.records!.bestScore).toBe(80);
    expect(s.records!.deepestFloor).toBe(s.currentFloor); // createNewGame 预置的起始楼层
    expect(countItem(s.player.inventory, 'ration_pack')).toBe(rationsBefore + 1);
    expect(s.dailyGoal!.done).toBe(true);
    // 只发一次：二次调用不再加分、不再给粮。
    expect(grantDailyGoalReward(s)).toBe(false);
    expect(s.records!.bestScore).toBe(80);
    expect(countItem(s.player.inventory, 'ration_pack')).toBe(rationsBefore + 1);
  });

  it('已结算不再发，即使此刻仍然达标', () => {
    const s = createNewGame(7);
    s.dailyGoal = { day: s.day, kind: 'upgrade', target: 1, done: true };
    s.player.homeUpgrades.push('rain_collector');
    expect(isDailyGoalDone(s)).toBe(true); // 纯判定与结算状态无关
    expect(grantDailyGoalReward(s)).toBe(false);
    expect(s.records!.bestScore).toBe(0);
  });

  it('done=true 但 flag 缺失（旧存档）不重复发', () => {
    // flag 之前的存档只用 done=true 表达「已结算」。换标记后若不做迁移，
    // 这份存档会在下一次 tick 再领一次。done=true 而 flag 不存在即视为已结。
    const s = createNewGame(7);
    s.dailyGoal = { day: s.day, kind: 'upgrade', target: 1, done: true };
    s.player.homeUpgrades.push('rain_collector');
    expect(s.flags).toBeUndefined();
    expect(grantDailyGoalReward(s)).toBe(false);
    expect(s.records!.bestScore).toBe(0);
    // 并且迁移写下了 flag，之后与正常路径一致
    expect(hasFlag(s, flagKey.once(`goal-paid:${s.day}`))).toBe(true);
  });

  it('done 与「已结算」是两个语义：done=false 也可能已结算', () => {
    // 这是拆分的目的。过去 done 一个字段扛两个意思，无法表达「达标了、也发了，
    // 但 done 还没置位」这种中间态；现在 flag 管发没发，done 只做展示。
    const s = createNewGame(7);
    s.dailyGoal = { day: s.day, kind: 'upgrade', target: 1, done: false };
    s.player.homeUpgrades.push('rain_collector');
    expect(grantDailyGoalReward(s)).toBe(true);
    expect(s.dailyGoal!.done).toBe(true);
    // 手动把 done 拨回 false：已结算的事实不受影响，不会二次发放
    s.dailyGoal!.done = false;
    expect(isDailyGoalDone(s)).toBe(true);
    expect(grantDailyGoalReward(s)).toBe(false);
    expect(s.records!.bestScore).toBe(80);
  });

  it('旧存档路径：records 缺失时懒初始化（deepestFloor 兜底为当前楼层）', () => {
    const s = createNewGame(7);
    delete s.records; // 模拟暴改前存档：createNewGame 现在会预置，旧盘没有
    s.dailyGoal = { day: s.day, kind: 'upgrade', target: 1, done: false };
    s.player.homeUpgrades.push('rain_collector');
    expect(grantDailyGoalReward(s)).toBe(true);
    expect(s.records).toEqual({ deepestFloor: s.currentFloor, bestScore: 80 });
  });

  it('奖励发在既有 records 上是累加，不覆盖历史分', () => {
    const s = createNewGame(7);
    s.records = { deepestFloor: 3, bestScore: 240 };
    s.dailyGoal = { day: s.day, kind: 'upgrade', target: 1, done: false };
    s.player.homeUpgrades.push('rain_collector');
    expect(grantDailyGoalReward(s)).toBe(true);
    expect(s.records!.bestScore).toBe(320); // 240 + 80
    expect(s.records!.deepestFloor).toBe(3); // 不被奖励逻辑改写
  });
});
