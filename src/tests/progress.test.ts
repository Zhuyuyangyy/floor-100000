import { describe, expect, it } from 'vitest';

import { depthRecord, recordDepth, runScore } from '../systems/progress';
import { addItem } from '../systems/InventorySystem';
import { createNewGame } from '../core/gameState';
import { GAME_CONFIG } from '../core/config';

// OVERHAUL W3：深度纪录与 run 计分。起始包 = 净水×3 + 口粮×2 + 手电×1，
// 按 progress.ts 的保守估价 = 3×1 + 2×1 + 1×1 = 6 宝藏分；深度系数 2。
// 因此 1 层空包基线分 = 2×1 + 6 = 8。

describe('depthRecord / recordDepth', () => {
  it('records 缺失时 depthRecord 退回当前楼层（旧存档路径）', () => {
    const s = createNewGame(42);
    delete s.records; // createNewGame 现已预置 records；delete 模拟暴改前旧存档
    expect(depthRecord(s)).toBe(1);
  });

  it('depthRecord 读 records.deepestFloor', () => {
    const s = createNewGame(42);
    s.records = { deepestFloor: 3, bestScore: 0 };
    s.currentFloor = 1;
    expect(depthRecord(s)).toBe(3);
  });

  it('recordDepth 取大且单调：浅层不抹掉纪录', () => {
    const s = createNewGame(42);
    delete s.records; // 走懒初始化分支（旧存档）
    recordDepth(s);
    expect(s.records!.deepestFloor).toBe(1);
    s.currentFloor = 3;
    recordDepth(s);
    expect(depthRecord(s)).toBe(3);
    s.currentFloor = 2;
    recordDepth(s);
    expect(depthRecord(s)).toBe(3); // 下楼不掉纪录
    s.currentFloor = 5;
    recordDepth(s);
    expect(depthRecord(s)).toBe(5);
  });
});

describe('runScore', () => {
  it('深度主导：depth+1（+2 分）比多一件普通物品（+1 分）加分更多', () => {
    const base = createNewGame(42); // 1 层：2×1 + 6 = 8
    const deep = createNewGame(42);
    deep.currentFloor = 2; // 2×2 + 6 = 10
    const looty = createNewGame(42);
    addItem(looty.player.inventory, 'bread', 1); // 2×1 + 7 = 9

    expect(runScore(base)).toBe(8);
    expect(runScore(deep)).toBe(10);
    expect(runScore(looty)).toBe(9);
    // 具体数字钉死「向上攀升」优先于捡垃圾。
    expect(runScore(deep) - runScore(base)).toBeGreaterThan(runScore(looty) - runScore(base));
  });

  it('目标分：结算后 +dailyGoalRewardScore，未结算 0', () => {
    const s = createNewGame(42);
    expect(runScore(s)).toBe(8);
    s.dailyGoal = { day: s.day, kind: 'upgrade', target: 1, done: false };
    expect(runScore(s)).toBe(8); // done=false：不给目标分
    s.dailyGoal.done = true; // grantDailyGoalReward 置位后的状态
    expect(runScore(s)).toBe(8 + GAME_CONFIG.overhaul.dailyGoalRewardScore);
  });

  it('runScore 用当前深度，不吃跨 run 的 records', () => {
    const s = createNewGame(42);
    s.records = { deepestFloor: 5, bestScore: 999 };
    s.currentFloor = 1;
    // 2×1 + 6 = 8：历史纪录与历史 bestScore 都不进本 run 的分数。
    expect(runScore(s)).toBe(8);
  });
});
