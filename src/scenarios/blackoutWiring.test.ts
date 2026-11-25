// 停电危机的接线测试。
//
// 这里有两层，缺一层就会假绿：
//
// 第一层「路由与分发」：断言 dispatchBlackoutAlin / dispatchBlackoutTrade 这些
// 纯函数传什么进去、返回什么、调哪个处理器。它证明零件是对的。
//
// 第二层「装配」（本文件末尾那组 SOURCE 断言）：断言 GameScene 这个**真正的
// 调用方**确实调了它们、确实挂在主循环上。这一层是被补回来的——曾经只有第一
// 层，结果把整个接线删掉、甚至把调用换成必然崩溃的 `undefined as any`，
// 1150 条测试依然全绿。纯函数写得再对，不等于有人调用它。
//
// 为什么用源码结构断言而不是起 Phaser：GameScene 依赖 window，node 环境里
// 连 import 都会抛（见 vitest.config.ts 的注释）。源码断言快、稳、不 flake，
// 且正好盯住「有没有人调用」这件事——那正是之前漏掉的那一环。

import { readFileSync } from 'node:fs';
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

// ── 装配层：GameScene 真的调用了它们吗 ──────────────────────────────────────
//
// 这一组的由来：上一版只有路由纯函数的用例，结果把 GameScene 里那三处接线
// 整个删掉，1150 条测试依然全绿。原因是那些用例从未断言「谁调用了这些函数」。
// 下面这些断言直接读源码，把「装配存在」这件事钉死。
//
// 两个刻意的写法细节：
// 1. 匹配 `dispatchBlackoutAlin(` 带左括号。import 语句写作
//    `import { dispatchBlackoutAlin, ... }`，名字后面跟的是逗号或右花括号，
//    永远不会带左括号，所以带括号的匹配只会命中真实调用点。
// 2. 不用简单的 `toContain('syncBlackoutOnTick')`：那样一个只剩函数定义、
//    从没被调用的死代码也能通过。必须匹配「调用形态」并且带上上下文顺序。

// ⚠️ 本文件从这行往下的三组用例读的是**磁盘上的源码文本**，不是运行时行为。
//
// 所以它们有一条与代码无关的失败方式：**别人正在编辑这个文件**。vitest worker
// 的 readFileSync 可能读到写入中途的半截文本，于是断言随机变红（曾经出现过
// 全量跑 12 条失败、单跑 25/25 全绿）。看到这类红，先等对方保存完再单跑一次
// 确认——**不要因此去改代码或放宽断言**。排查口诀：只有源码结构断言组红、
// 而纯函数路由用例全绿，那就是并发编辑，不是回归。
const SCENE_SRC = readFileSync(new URL('../scenes/GameScene.ts', import.meta.url), 'utf8');

describe('装配层：GameScene 真的接上了停电危机（源码结构断言）', () => {
  it('阿林对话分支真的调用 dispatchBlackoutAlin（不是只 import）', () => {
    // 带左括号 → 只可能是调用点，不会是 import 列表里那一项。
    expect(SCENE_SRC).toContain('dispatchBlackoutAlin(');
    // 调用之后必须真的把两个处理器传进去：只写个空对象等于没接线。
    // 注意不能用 `[^)]*` 跨过参数列表：`getGame()` 自带右括号，会让匹配在
    // 那里断掉。改成「调用名之后 300 字符内出现这个键」，既能容忍任意实参，
    // 又能保证键确实属于这次调用。
    expect(SCENE_SRC).toMatch(/dispatchBlackoutAlin\([\s\S]{0,300}?blackout:/);
    expect(SCENE_SRC).toMatch(/dispatchBlackoutAlin\([\s\S]{0,300}?legacy:/);
  });

  it('小周/阿珍的交易分支真的调用 dispatchBlackoutTrade', () => {
    expect(SCENE_SRC).toContain('dispatchBlackoutTrade(');
    expect(SCENE_SRC).toMatch(/dispatchBlackoutTrade\([\s\S]{0,300}?blackout:/);
  });

  it('危机期确实走的是 runBlackoutRepairPlan / runBlackoutTrade，而不是只有名字', () => {
    // 这两个私有方法既要有定义，也要被当作处理器传进去。
    expect(SCENE_SRC).toContain('private async runBlackoutRepairPlan(');
    expect(SCENE_SRC).toContain('this.runBlackoutRepairPlan(');
    expect(SCENE_SRC).toContain('private async runBlackoutTrade(');
    expect(SCENE_SRC).toContain('this.runBlackoutTrade(');
  });

  it('syncBlackoutOnTick 挂在 onUpdate 主路径上：在 advanceTime 之后、updateDwellPressure 之前', () => {
    // 三件事必须按这个顺序出现在同一段代码里：
    //   时间推进 → 危机同步 → dwell pressure
    // 只用 toContain 检查名字存在是不够的——把调用挪到主循环外面（比如塞进
    // 某个只在特定分支才跑的私有方法）同样会让名字存在，但玩家永远碰不到。
    expect(SCENE_SRC).toMatch(
      /advanceTime\(state,\s*delta\)[\s\S]{0,900}this\.syncBlackoutOnTick\(state\)[\s\S]{0,600}updateDwellPressure\(/,
    );
  });

  it('syncBlackoutOnTick 内部真的调用了 syncBlackoutCrisis（否则缓存函数是个空壳）', () => {
    expect(SCENE_SRC).toMatch(/private syncBlackoutOnTick\([^)]*\)[\s\S]{0,900}syncBlackoutCrisis\(/);
    // 缓存键必须带上 stage 与 day：只记 stage 会让跨天过期判定永远不触发。
    expect(SCENE_SRC).toMatch(/blackoutStageOf\([\s\S]{0,200}state\.day/);
  });

  it('三个处理器都不是空实现：模型端口真的被构造出来传给场景函数', () => {
    // 「接线」包括把模型端口接进去。只调 runBlackoutRepair(game) 而不传
    // proposeWithModel，等于退回纯规则，AI 原生能力那栏又空一天。
    //
    // 注意这里必须断言**值是构造函数的结果**，不能只断言键存在：把
    // `proposeWithModel: this.buildBlackoutRepairPort(npc)` 改成
    // `proposeWithModel: undefined` 时，键还在、语法还合法、tsc 还过，
    // 但模型就再也不会被调用——这正是「AI 原生」这一栏最容易被悄悄掏空的方式。
    expect(SCENE_SRC).toMatch(/runBlackoutRepair\([\s\S]{0,300}?proposeWithModel:\s*this\.buildBlackoutRepairPort\(/);
    // 交易侧传的是一个局部变量 `port`，光断言 `proposeWithModel: port` 不够——
    // 把 `const port = this.buildBlackoutTradePort(npc)` 改成 `const port = undefined`
    // 时那句话一个字都没变，模型却再也不会被调用。所以要连赋值一起断言。
    expect(SCENE_SRC).toMatch(/const port = this\.buildBlackoutTradePort\(npc\)/);
    expect(SCENE_SRC).toMatch(/runXiaozhouTrade\([\s\S]{0,300}?proposeWithModel:\s*port/);
    expect(SCENE_SRC).toMatch(/runAzhenExchange\([\s\S]{0,300}?proposeWithModel:\s*port/);
    // 三个端口构造函数本身也必须真的存在且返回端口，不能是 `return undefined`。
    expect(SCENE_SRC).toContain('private buildBlackoutRepairPort(');
    expect(SCENE_SRC).toContain('private buildBlackoutTradePort(');
    // 端口的两个入口（decideTask / proposeWithBrain）必须真的被调用。
    expect(SCENE_SRC).toMatch(/buildBlackoutRepairPort\([\s\S]{0,2000}?brain\.decideTask!/);
    expect(SCENE_SRC).toMatch(/buildBlackoutTradePort\([\s\S]{0,2000}?proposeWithBrain\(/);
  });
});

// ── 装配层的第二刀：实参也要对 ──────────────────────────────────────────────
//
// 上面那组只证明「调用存在」。把实参换成 `undefined as any` 它照样通过——
// 因为源码里仍然有 `dispatchBlackoutAlin(` 这个字符串，两个键也都在。
// 但运行时第一件事就是读 `game.flags`，`undefined.flags` 必崩。
//
// 这一组盯的是「喂进去的东西是不是真的世界状态」。它同样防不住所有写错，
// 但能防住最省事的那种破坏：把参数随手换成一个能过类型检查的假值。

describe('装配层：分发拿到的是真实 GameState', () => {
  it('dispatchBlackoutAlin / dispatchBlackoutTrade 的首参都是 getGame()', () => {
    const calls = [...SCENE_SRC.matchAll(/dispatchBlackout(?:Alin|Trade)\(([^,]+),/g)];
    // 两处调用（阿林分支 + 交易分支）；少一处说明有一条线被拆了。
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const call of calls) {
      const firstArg = call[1].trim();
      // 明确禁止偷懒写法：类型断言能骗过 tsc，但运行时必崩。
      expect(firstArg).not.toMatch(/\bundefined\b|\bnull\b|as any/);
      expect(firstArg).toBe('getGame()');
    }
  });

  it('runBlackoutRepairPlan / runBlackoutTrade 传的是当前对话会话，不是空对象', () => {
    // 会话快照决定「结果回来时对话还在不在」。传空对象会让 isDialogueFresh
    // 永远判为过期，玩家看不到任何回复——症状是「点了没反应」，很难查。
    expect(SCENE_SRC).toMatch(/const session = \{ sessionId: d\.sessionId, revision: d\.revision \}/);
    expect(SCENE_SRC).toContain('this.runBlackoutRepairPlan(npc, session)');
    expect(SCENE_SRC).toContain('this.runBlackoutTrade(npc, session)');
  });
});

// ── 场景层的第三刀：唯一提交入口不能旁路 ────────────────────────────────────
//
// 这一组读的是 `blackoutCrisis.ts` 而不是 GameScene。理由：接线对了，但场景
// 内部偷偷自己改库存、自己写 flags，玩家仍然能「修好」，只是绕过了幂等键、
// staged 库存与「先扣后加」——重复点一次就能刷零件，而这些症状在 happy path
// 测试里完全看不出来（因为它确实成功修好了）。

const SCENARIO_SRC = readFileSync(new URL('./blackoutCrisis.ts', import.meta.url), 'utf8');

describe('场景层：维修提交只走 executeCompetitionProposal', () => {
  it('execute 端口调用的是 executeCompetitionProposal，而不是自己改库存', () => {
    expect(SCENARIO_SRC).toMatch(/executeCompetitionProposal\(liveExecutorState,\s*proposal/);
    // 写死一份 policy 副本就等于第二套数值来源：门槛一变，预检和提交就分叉。
    // 现在两处都必须引用同一个 repairPolicy(game)。
    expect(SCENARIO_SRC).toMatch(/validateCompetitionProposal\(liveExecutorState,\s*proposal,\s*repairPolicy\(game\)\)/);
    expect(SCENARIO_SRC).toMatch(/policy:\s*repairPolicy\(game\)/);
  });

  it('场景不再私藏第二套裁决：validateRepair 这个名字不该再有函数定义', () => {
    // A0 明确要求「不要留着当第二套规则」。允许注释里提到它（解释历史），
    // 但不允许还有 function 定义——定义一旦回来，两份规则就会各自演化。
    expect(SCENARIO_SRC).not.toMatch(/function validateRepair/);
  });

  it('三位居民的入口都在场景里真的被调用，而不是只导出', () => {
    expect(SCENARIO_SRC).toContain('export async function runBlackoutRepair(');
    expect(SCENARIO_SRC).toContain('export async function runXiaozhouTrade(');
    expect(SCENARIO_SRC).toContain('export async function runAzhenExchange(');
  });
});
