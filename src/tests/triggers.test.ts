import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { environmentFor } from '../core/constants';
import { createNewGame } from '../core/gameState';
import type { GameState } from '../core/gameTypes';
import { PLAYABLE_SEGMENTS } from '../core/segments';
import { createNpcState } from '../data/npcPersonalities';
import { NPCS } from '../data/npcs';
import { ensureNightEvent } from '../systems/EventSystem';
import { addItem, isBagFull } from '../systems/InventorySystem';
import { recordMemory, saveNpcState } from '../systems/NpcMemory';
import { ensureDailyGoal, grantDailyGoalReward, isDailyGoalDone } from '../systems/dailyGoals';
import { isNight } from '../systems/SurvivalSystem';
// 导入 triggers 模块本身即完成启动注册；evaluateTriggers 从这里 re-export。
import { evaluateTriggers } from '../systems/triggers';
import { flagKey, hasFlag, registerTrigger, registeredTriggers } from '../systems/WorldFlags';

// 清单规模：4 事件 + 2 状态 + 目标 + 战斗 + 2 饥渴 + 5 阶层 + 7 NPC = 22。
const EXPECTED_TRIGGER_COUNT = 22;

function nightOnHostileFloor(): GameState {
  const s = createNewGame(1);
  s.gameMinuteOfDay = 1320; // 22:00，夜间
  s.currentFloor = 3; // 储物层，hostile
  return s;
}

function fillBag(s: GameState): void {
  // 起始 3 格（净水堆/口粮堆/手电），补 9 件不同物品到 12 格满。
  const more = ['dirty_water', 'bread', 'battery', 'scrap_metal', 'wood', 'cloth', 'tape', 'filter', 'wire'] as const;
  for (const id of more) addItem(s.player.inventory, id, 1);
}

describe('Trigger 注册表', () => {
  it('registerTrigger 幂等：同 id 重复注册不叠加，先注册者赢', () => {
    const before = registeredTriggers().length;
    registerTrigger({ id: 'test-dup', when: () => false, sets: 'test:dup:first' });
    registerTrigger({ id: 'test-dup', when: () => true, sets: 'test:dup:second' });
    const entries = registeredTriggers().filter((t) => t.id === 'test-dup');
    expect(entries).toHaveLength(1);
    expect(entries[0].sets).toBe('test:dup:first');
    expect(registeredTriggers().length).toBe(before + 1);
  });

  it('启动清单完整：22 个触发器，id 唯一，sets 非空', () => {
    // 幂等测试会往注册表里塞一个 test- 前缀的探针，计数时排除。
    const all = registeredTriggers();
    const list = all.filter((t) => !t.id.startsWith('test-'));
    expect(list).toHaveLength(EXPECTED_TRIGGER_COUNT);
    expect(new Set(all.map((t) => t.id)).size).toBe(all.length);
    for (const t of list) expect(t.sets.length).toBeGreaterThan(0);
  });

  it('清单覆盖三类收敛目标与五个阶层/七个 NPC', () => {
    const sets = registeredTriggers().map((t) => t.sets);
    expect(sets).toContain(flagKey.event('active'));
    expect(sets).toContain(flagKey.event('blackout'));
    expect(sets).toContain(flagKey.event('wanderer'));
    expect(sets).toContain(flagKey.event('leak'));
    expect(sets).toContain(flagKey.goal('met'));
    expect(sets).toContain(flagKey.combat('active'));
    for (const seg of PLAYABLE_SEGMENTS) {
      if (seg.id === 1) continue;
      expect(sets).toContain(flagKey.tier(seg.id));
    }
    for (const npc of NPCS) expect(sets).toContain(flagKey.npc(npc.id, 'regular'));
  });
});

describe('evaluateTriggers', () => {
  it('新档默认态一个旗都不置', () => {
    const s = createNewGame(1);
    expect(evaluateTriggers(s)).toEqual([]);
  });

  it('只返回本次新置的旗；已置过的不重复返回', () => {
    const s = nightOnHostileFloor();
    const first = evaluateTriggers(s);
    expect(first).toEqual([flagKey.state('night-exposed')]);
    expect(hasFlag(s, flagKey.state('night-exposed'))).toBe(true);
    // 同 state 再求值：没有任何新旗。
    expect(evaluateTriggers(s)).toEqual([]);
  });

  it('同 seed 同 state 同结果（可复现，禁 Math.random）', () => {
    const build = (): GameState => {
      const s = nightOnHostileFloor();
      s.player.thirst = 0;
      s.worldEvents.activeEvent = { type: 'leak', floor: 3, message: '漏水' };
      let npc = createNpcState('ally');
      for (let i = 0; i < 3; i++) {
        npc = recordMemory(npc, { day: 1, minute: 600, kind: 'trade', actor: 'player', summary: `第${i + 1}次` });
      }
      saveNpcState(s, 'alin', npc);
      return s;
    };
    const a = build();
    const b = build();
    const ra = evaluateTriggers(a);
    const rb = evaluateTriggers(b);
    expect(ra).toEqual(rb);
    expect(ra.length).toBeGreaterThan(1);
    expect(a.flags).toEqual(b.flags);
    // 再求值一遍仍然没有新旗——纯函数属性。
    expect(evaluateTriggers(a)).toEqual([]);
  });
});

describe('世界事件触发器（收敛 worldEvents.activeEvent 读点）', () => {
  it('停电置 ev:blackout，不误置其它类型旗', () => {
    const s = createNewGame(1);
    s.worldEvents.activeEvent = { type: 'blackout', message: '走廊停电了' };
    expect(evaluateTriggers(s)).toContain(flagKey.event('blackout'));
    expect(hasFlag(s, flagKey.event('active'))).toBe(true);
    expect(hasFlag(s, flagKey.event('wanderer'))).toBe(false);
    expect(hasFlag(s, flagKey.event('leak'))).toBe(false);
  });

  it('流浪者与漏水各自置位', () => {
    const w = createNewGame(1);
    w.worldEvents.activeEvent = { type: 'wanderer', floor: 3, message: '巡游体出没' };
    expect(evaluateTriggers(w)).toContain(flagKey.event('wanderer'));
    const l = createNewGame(1);
    l.worldEvents.activeEvent = { type: 'leak', floor: 4, message: '漏水' };
    expect(evaluateTriggers(l)).toContain(flagKey.event('leak'));
  });

  it('无事件时四个事件旗都不置', () => {
    const s = createNewGame(1);
    evaluateTriggers(s);
    expect(hasFlag(s, flagKey.event('active'))).toBe(false);
    expect(hasFlag(s, flagKey.event('blackout'))).toBe(false);
    expect(hasFlag(s, flagKey.event('wanderer'))).toBe(false);
    expect(hasFlag(s, flagKey.event('leak'))).toBe(false);
  });
});

describe('st:night-exposed（夜间滞留敌意楼层）', () => {
  it('夜间 + hostile 楼层置旗', () => {
    // 前提自校验：3 层确实是夜间可 hostile 的楼层，宿舍不是。
    expect(isNight(1320)).toBe(true);
    expect(environmentFor(3).hostile).toBe(true);
    expect(environmentFor(1).hostile).toBe(false);
    const s = nightOnHostileFloor();
    expect(evaluateTriggers(s)).toContain(flagKey.state('night-exposed'));
  });

  it('夜间但在宿舍不置', () => {
    const s = createNewGame(1);
    s.gameMinuteOfDay = 1320;
    s.currentFloor = 1;
    evaluateTriggers(s);
    expect(hasFlag(s, flagKey.state('night-exposed'))).toBe(false);
  });

  it('白天在 hostile 楼层不置', () => {
    const s = createNewGame(1);
    s.gameMinuteOfDay = 720;
    s.currentFloor = 3;
    evaluateTriggers(s);
    expect(hasFlag(s, flagKey.state('night-exposed'))).toBe(false);
  });
});

describe('st:bag-overflowing（背包满）', () => {
  it('12/12 置旗', () => {
    const s = createNewGame(1);
    fillBag(s);
    expect(isBagFull(s.player.inventory)).toBe(true);
    expect(evaluateTriggers(s)).toContain(flagKey.state('bag-overflowing'));
  });

  it('未满不置', () => {
    const s = createNewGame(1);
    evaluateTriggers(s);
    expect(hasFlag(s, flagKey.state('bag-overflowing'))).toBe(false);
  });
});

describe('goal:met（每日目标达标）', () => {
  it('达标置旗（起始自带 3 瓶净水，target 2 直接达成）', () => {
    const s = createNewGame(1);
    s.dailyGoal = { day: s.day, kind: 'water', target: 2, done: false };
    expect(isDailyGoalDone(s)).toBe(true);
    expect(evaluateTriggers(s)).toContain(flagKey.goal('met'));
  });

  it('未达标不置', () => {
    const s = createNewGame(1);
    s.dailyGoal = { day: s.day, kind: 'floor', target: 100, done: false };
    evaluateTriggers(s);
    expect(hasFlag(s, flagKey.goal('met'))).toBe(false);
  });
});

describe('combat:active（战斗进行态）', () => {
  it('state.combat 存在即置旗', () => {
    const s = createNewGame(1);
    s.combat = {
      kind: 'ambush',
      floor: 2,
      spotId: 'spot-1',
      monster: { id: 1, name: '测试怪', hp: 10, maxHp: 10, damage: 5, accuracy: 0.8, defense: 0, evasion: 0, behavior: 'aggressive' },
      guarding: false,
      turn: 1,
      log: [],
    };
    expect(evaluateTriggers(s)).toContain(flagKey.combat('active'));
  });

  it('无战斗不置', () => {
    const s = createNewGame(1);
    evaluateTriggers(s);
    expect(hasFlag(s, flagKey.combat('active'))).toBe(false);
  });
});

describe('饥渴临界', () => {
  it('口渴归零置 stat:thirst-critical，不牵连饥饿旗', () => {
    const s = createNewGame(1);
    s.player.thirst = 0;
    expect(evaluateTriggers(s)).toContain(flagKey.stat('thirst-critical'));
    expect(hasFlag(s, flagKey.stat('hunger-critical'))).toBe(false);
  });

  it('饥饿归零置 stat:hunger-critical', () => {
    const s = createNewGame(1);
    s.player.hunger = 0;
    expect(evaluateTriggers(s)).toContain(flagKey.stat('hunger-critical'));
  });

  it('未归零都不置', () => {
    const s = createNewGame(1);
    s.player.thirst = 1;
    s.player.hunger = 1;
    evaluateTriggers(s);
    expect(hasFlag(s, flagKey.stat('thirst-critical'))).toBe(false);
    expect(hasFlag(s, flagKey.stat('hunger-critical'))).toBe(false);
  });
});

describe('阶层抵达（tier:<id>:arrived）', () => {
  it('第一次到第 100 层置 tier:2:arrived，更高段不置', () => {
    const s = createNewGame(1);
    s.currentFloor = 100;
    expect(evaluateTriggers(s)).toContain(flagKey.tier(2));
    expect(hasFlag(s, flagKey.tier(3))).toBe(false);
  });

  it('段内楼层同样算抵达（105 层置 tier:2）', () => {
    const s = createNewGame(1);
    s.currentFloor = 105;
    expect(evaluateTriggers(s)).toContain(flagKey.tier(2));
  });

  it('塔顶 100000 置 tier:6:arrived', () => {
    const s = createNewGame(1);
    s.currentFloor = 100000;
    expect(evaluateTriggers(s)).toContain(flagKey.tier(6));
  });

  it('起始段内（1-10 层）不置任何阶层旗', () => {
    const s = createNewGame(1);
    s.currentFloor = 5;
    evaluateTriggers(s);
    for (const seg of PLAYABLE_SEGMENTS) {
      if (seg.id === 1) continue;
      expect(hasFlag(s, flagKey.tier(seg.id))).toBe(false);
    }
  });
});

describe('NPC 熟客（npc:<id>:regular）', () => {
  const trade = (day: number, minute: number) => ({ day, minute, kind: 'trade', actor: 'player', summary: '换到废铁×1' });

  it('与同一 NPC 交易满 3 次置旗', () => {
    const s = createNewGame(1);
    let npc = createNpcState('ally');
    for (let i = 0; i < 3; i++) npc = recordMemory(npc, trade(1, 600 + i));
    saveNpcState(s, 'alin', npc);
    expect(evaluateTriggers(s)).toContain(flagKey.npc('alin', 'regular'));
  });

  it('只交易 2 次不置', () => {
    const s = createNewGame(1);
    let npc = createNpcState('ally');
    npc = recordMemory(npc, trade(1, 600));
    npc = recordMemory(npc, trade(1, 620));
    saveNpcState(s, 'alin', npc);
    evaluateTriggers(s);
    expect(hasFlag(s, flagKey.npc('alin', 'regular'))).toBe(false);
  });

  it('礼物记忆不计入交易次数', () => {
    const s = createNewGame(1);
    let npc = createNpcState('ally');
    for (let i = 0; i < 3; i++) {
      npc = recordMemory(npc, { day: 1, minute: 600 + i, kind: 'gift', actor: 'player', summary: '获赠木头×1' });
    }
    saveNpcState(s, 'alin', npc);
    evaluateTriggers(s);
    expect(hasFlag(s, flagKey.npc('alin', 'regular'))).toBe(false);
  });

  it('坏 JSON / 无记忆不置旗，且不波及别的 NPC', () => {
    const s = createNewGame(1);
    s.npcStates['alin'] = '{oops';
    evaluateTriggers(s);
    expect(hasFlag(s, flagKey.npc('alin', 'regular'))).toBe(false);
    expect(hasFlag(s, flagKey.npc('xiaozhou', 'regular'))).toBe(false);
  });
});

describe('存量字段 deprecated 后行为不变', () => {  it('ensureNightEvent 仍按既有规则 roll 与复用', () => {
    const s = createNewGame(1);
    s.gameMinuteOfDay = 1320;
    const first = ensureNightEvent(s);
    expect(first.rolled).toBe(true);
    expect(s.worldEvents.activeEvent).not.toBeNull();
    const second = ensureNightEvent(s);
    expect(second.rolled).toBe(false);
    expect(second.event).toEqual(first.event);
    expect(s.worldEvents.history).toHaveLength(1);
  });

  it('grantDailyGoalReward 仍只发一次且照旧写 goal.done', () => {
    const s = createNewGame(1);
    s.dailyGoal = { day: s.day, kind: 'water', target: 2, done: false };
    expect(grantDailyGoalReward(s)).toBe(true);
    expect(s.dailyGoal!.done).toBe(true);
    expect(s.records!.bestScore).toBeGreaterThan(0);
    expect(grantDailyGoalReward(s)).toBe(false);
  });

  it('ensureDailyGoal 仍按 (runSeed, day) 懒生成', () => {
    const s = createNewGame(1);
    expect(s.dailyGoal).toBeUndefined();
    ensureDailyGoal(s);
    expect(s.dailyGoal).toBeDefined();
    expect(s.dailyGoal!.day).toBe(s.day);
  });

  it('evaluateTriggers 只写 flags，不碰任何存量字段', () => {
    const s = nightOnHostileFloor();
    ensureNightEvent(s);
    ensureDailyGoal(s);
    const snapshot = JSON.stringify({
      worldEvents: s.worldEvents,
      dailyGoal: s.dailyGoal,
      combat: s.combat,
      player: { thirst: s.player.thirst, hunger: s.player.hunger, inventory: s.player.inventory },
      currentFloor: s.currentFloor,
    });
    expect(evaluateTriggers(s).length).toBeGreaterThan(0);
    expect(
      JSON.stringify({
        worldEvents: s.worldEvents,
        dailyGoal: s.dailyGoal,
        combat: s.combat,
        player: { thirst: s.player.thirst, hunger: s.player.hunger, inventory: s.player.inventory },
        currentFloor: s.currentFloor,
      }),
    ).toBe(snapshot);
  });
});

// RC-01 决策（外部审查 P1「统一触发器系统没接进主循环」）：选 (a) 接入——
// GameScene.update 每帧求值，旗自此是活的查询与存档事实。行为等价由两条
// 保证：① evaluateTriggers 只置不清、只写 flags（上面的字节级钉子），接入
// 因此不改变任何既有行为；② 自言自语（GameScene.tickMonologue 的 hp_low
// 等）是边沿事件（可重复、带冷却、出气泡），latch 旗装不下「又掉一次」，
// 且阈值/语义与 stat:hunger-critical（归零）等注册项互不重叠——两类问题
// 各自留任，不是同一判断的两套实现。源码断言钉住接线存在且位置正确。
describe('RC-01 接线：GameScene.update 每帧求值', () => {
  it('update 在面板早退之前调用 evaluateTriggers（源码断言）', () => {
    const src = readFileSync(join(process.cwd(), 'src/scenes/GameScene.ts'), 'utf8');
    const updateIdx = src.indexOf('override update(');
    expect(updateIdx, 'GameScene.update 存在').toBeGreaterThan(-1);
    const callIdx = src.indexOf('evaluateTriggers(getGame())', updateIdx);
    expect(callIdx, 'update 里调用了 evaluateTriggers（AG-26 留给总控的接线）').toBeGreaterThan(-1);
    // 必须早于面板早退行：战斗开打、背包塞满、目标达标都可能发生在面板里，
    // 事实要照常 latch（与 updateAchievementToasts 同款理由）。
    const earlyReturnIdx = src.indexOf('if (this.inventoryOpen || this.craftingOpen', updateIdx);
    expect(earlyReturnIdx, '面板早退行存在').toBeGreaterThan(-1);
    expect(callIdx).toBeLessThan(earlyReturnIdx);
  });

  it('接线不改变既有行为：新档默认态一个旗都不置', () => {
    // 与上面「新档默认态」同一期望——接入只是让求值每帧跑，首帧之前无旗。
    const s = createNewGame(1);
    expect(evaluateTriggers(s)).toEqual([]);
    expect(s.flags).toBeUndefined();
  });
});
