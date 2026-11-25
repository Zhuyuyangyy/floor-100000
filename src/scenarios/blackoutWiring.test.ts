// 停电危机的接线路由测试。
//
// 为什么这里测的是「路由」而不是「GameScene」：`GameScene` 依赖 Phaser 与
// window，在 vitest 的 node 环境里连 import 都会抛 `window is not defined`
// （仓库既有约束，见 vitest.config.ts 的注释）。所以接线判定被抽成了三个纯
// 函数放在场景模块里，GameScene 只负责按返回值分发。
//
// 这样做的价值：这些用例断言的是「危机期到底调哪个函数」，而不是「没报错」。
// 一个把 case 1 永远指向 legacy 的实现会让下面每一条都红。

import { describe, expect, it, vi } from 'vitest';
import { createNewGame } from '../core/gameState';
import type { GameState } from '../core/gameTypes';
import { getNpc, NPC_FLOOR } from '../data/npcs';
import { ALIN_REPAIR_GATE_FLAG } from '../data/floorGates';
import { setFlag } from '../systems/WorldFlags';
import {
  blackoutAlinOptionLabel,
  blackoutAlinRoute,
  blackoutTradeRoute,
  dispatchBlackoutAlin,
  dispatchBlackoutTrade,
  isBlackoutActive,
  syncBlackoutCrisis,
} from './blackoutCrisis';

/** 门已开、站在阿林旁边的一天——危机还没开始。 */
function beforeCrisis(seed = 7001): GameState {
  const game = createNewGame(seed);
  game.currentFloor = NPC_FLOOR;
  game.player.x = getNpc('alin').x;
  setFlag(game, ALIN_REPAIR_GATE_FLAG, 1);
  return game;
}

/** 危机已经推进到 investigating 的一天。 */
function duringCrisis(seed = 7002): GameState {
  const game = beforeCrisis(seed);
  const transition = syncBlackoutCrisis(game);
  expect(transition.stage).toBe('investigating');
  return game;
}

describe('阿林的对话路由：危机期走主线，非危机期走原维修门', () => {
  it('危机未开始时走 legacy-repair（玩家遇到的还是原来的维修门计划）', () => {
    const game = beforeCrisis();
    expect(isBlackoutActive(game)).toBe(false);
    expect(blackoutAlinRoute(game)).toBe('legacy-repair');
    // 标签也必须还是原来那个，否则玩家看到「接回主线」却被送进修门流程。
    expect(blackoutAlinOptionLabel(game)).toBe('维修门计划');
  });

  it('危机进行中改走 blackout（runBlackoutRepair 而不是 runAlinRepairPlan）', () => {
    const game = duringCrisis();
    expect(isBlackoutActive(game)).toBe(true);
    expect(blackoutAlinRoute(game)).toBe('blackout');
    expect(blackoutAlinOptionLabel(game)).toBe('接回主线');
  });

  it('危机了结后回到 legacy 分支：事了结之后不该再弹主线', () => {
    const game = duringCrisis(7003);
    // 直接把阶段推到失败出口，模拟「停电拖过死线」。
    game.day = 99;
    syncBlackoutCrisis(game);
    expect(isBlackoutActive(game)).toBe(false);
    expect(blackoutAlinRoute(game)).toBe('legacy-repair');
    expect(blackoutAlinOptionLabel(game)).toBe('维修门计划');
  });

  it('维修门还关着时不会被误判成危机期（这是危机的前置条件）', () => {
    const game = createNewGame(7004);
    game.currentFloor = NPC_FLOOR;
    game.player.x = getNpc('alin').x;
    // 没有 ALIN_REPAIR_GATE_FLAG：门没开，危机不该启动。
    expect(syncBlackoutCrisis(game).ok).toBe(false);
    expect(isBlackoutActive(game)).toBe(false);
    expect(blackoutAlinRoute(game)).toBe('legacy-repair');
  });
});

describe('小周/阿珍的交易路由：只有危机期才接管', () => {
  it('危机期小周走 blackout（runXiaozhouTrade）', () => {
    const game = duringCrisis(7101);
    expect(blackoutTradeRoute(game, 'xiaozhou')).toBe('blackout');
  });

  it('危机期阿珍走 blackout（runAzhenExchange）', () => {
    const game = duringCrisis(7102);
    expect(blackoutTradeRoute(game, 'azhen')).toBe('blackout');
  });

  it('危机期阿林不接管交易：他这条线是维修，不是买卖', () => {
    const game = duringCrisis(7103);
    expect(blackoutTradeRoute(game, 'alin')).toBe('legacy-trade');
  });

  it('非危机期两位都回退到通用交易，普通买卖不绕远路', () => {
    const game = beforeCrisis(7104);
    expect(blackoutTradeRoute(game, 'xiaozhou')).toBe('legacy-trade');
    expect(blackoutTradeRoute(game, 'azhen')).toBe('legacy-trade');
  });

  it('危机了结后交易也回退，不会永远挂在危机路径上', () => {
    const game = duringCrisis(7105);
    game.day = 99;
    syncBlackoutCrisis(game);
    expect(blackoutTradeRoute(game, 'xiaozhou')).toBe('legacy-trade');
    expect(blackoutTradeRoute(game, 'azhen')).toBe('legacy-trade');
  });
});
// ── 分发断言：直接看「哪一个处理器被调用」──────────────────────────────────

describe('分发层：断言真正被调用的是哪一个处理器', () => {
  it('危机期点阿林，调用的是 blackout 处理器，legacy 一次都没碰', () => {
    const game = duringCrisis(7201);
    const blackout = vi.fn();
    const legacy = vi.fn();

    const route = dispatchBlackoutAlin(game, { blackout, legacy });

    expect(route).toBe('blackout');
    expect(blackout).toHaveBeenCalledTimes(1);
    expect(legacy).not.toHaveBeenCalled();
  });

  it('非危机期点阿林，调用的是 legacy 处理器（runAlinRepairPlan），blackout 一次都没碰', () => {
    const game = beforeCrisis(7202);
    const blackout = vi.fn();
    const legacy = vi.fn();

    const route = dispatchBlackoutAlin(game, { blackout, legacy });

    expect(route).toBe('legacy-repair');
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(blackout).not.toHaveBeenCalled();
  });

  it('危机期小周交易走 blackout（runXiaozhouTrade），不走通用 trade', () => {
    const game = duringCrisis(7203);
    const blackout = vi.fn();
    const legacy = vi.fn();

    expect(dispatchBlackoutTrade(game, 'xiaozhou', { blackout, legacy })).toBe('blackout');
    expect(blackout).toHaveBeenCalledTimes(1);
    expect(legacy).not.toHaveBeenCalled();
  });

  it('非危机期小周交易走 legacy，不接管普通买卖', () => {
    const game = beforeCrisis(7204);
    const blackout = vi.fn();
    const legacy = vi.fn();

    expect(dispatchBlackoutTrade(game, 'xiaozhou', { blackout, legacy })).toBe('legacy-trade');
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(blackout).not.toHaveBeenCalled();
  });

  it('危机期阿林即便点交易也走 legacy：他的危机线只负责修主线', () => {
    const game = duringCrisis(7205);
    const blackout = vi.fn();
    const legacy = vi.fn();

    expect(dispatchBlackoutTrade(game, 'alin', { blackout, legacy })).toBe('legacy-trade');
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(blackout).not.toHaveBeenCalled();
  });
});
