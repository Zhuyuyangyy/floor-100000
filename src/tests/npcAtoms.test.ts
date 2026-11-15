// AG-28：NPC 三原子（TWOM 对齐，docs/plans/TWOM_ALIGNMENT.md §7）。
//
// 覆盖：
// 1. goTo 原子——x 与 npcSchedule 的运行时坐标同一数据源（升级不是重写）
// 2. playAnimation 原子——clip 与 render/walkcycle.ts 的 anim key 逐字一致
// 3. speak 原子——Sensor 门控（玩家在交互距离内才说）+ attitudeLine 台词
// 4. sense()——感知面：同层/距离/交互距离/昼夜/稀缺/信誉
// 5. Forced 打断——玩家指令 > AI 自主，forcedTarget 非空时自主原子全丢
// 6. 确定性——同 seed 同 state 同原子序列，禁 Math.random
// 7. 与 AG-13 既有 70 个 npcBehavior 断言不冲突（本文件只读复用其纯函数）
//
// 铁律：不 import 任何推理脑，全部离线可跑。

import { describe, expect, it } from 'vitest';

import { createNewGame } from '../core/gameState';
import { FLOOR_WIDTH, INTERACT_DISTANCE } from '../core/constants';
import { getNpc, NPCS, isNpcActive, npcsOnFloor, NPC_FLOOR } from '../data/npcs';
import type { NpcDef } from '../data/npcs';
import { createNpcState } from '../data/npcPersonalities';
import { saveNpcState } from '../systems/NpcMemory';
import { planNightWanderer, planWandererVendetta } from '../systems/NpcAutonomy';
import { isNight } from '../systems/SurvivalSystem';
import { walkAnimKey, idleAnimKey } from '../render/walkcycle';
import { npcAutonomyAt, NPC_MARGIN, NPC_WALK_SPEED } from '../ai/npcSchedule';
import { attitudeLine } from '../ai/npcEconomy';
import {
  npcAtomsFor,
  npcCharacterKey,
  npcClipKey,
  sense,
  wandererAtomsFor,
  type NpcAtom,
} from '../ai/npcAtoms';
import type { GameState } from '../core/gameTypes';
import type { NpcInventory, NpcPersistedState } from '../ai/types';

// ── 布阵助手 ────────────────────────────────────────────────────────────────

function npc(id: Parameters<typeof getNpc>[0]): NpcDef {
  return getNpc(id);
}

function handInventory(entries: NpcInventory['entries'], lastRestockDay = 1): NpcInventory {
  return { entries, lastRestockDay };
}

function seedNpcState(s: GameState, id: string, patch: Partial<NpcPersistedState> = {}): void {
  saveNpcState(s, id, { ...createNpcState('neutral'), ...patch });
}

/** 阿林在 2 层、玩家也在 2 层的基准局（默认 createNewGame 就在起始层）。 */
function dormState(seed = 1, minuteOfDay = 500): GameState {
  const s = createNewGame(seed);
  s.currentFloor = NPC_FLOOR;
  s.gameMinuteOfDay = minuteOfDay;
  return s;
}

const NOON_MINUTE = 720;
const NIGHT_MINUTE = 1200;

// ── 1. goTo 原子：位置成为显式原子，数据源不变 ─────────────────────────────

describe('goTo 原子（接 npcSchedule 的运行时坐标）', () => {
  it('goTo 排首位，x 等于 npcAutonomyAt 的同一计算结果（无第二套位置逻辑）', () => {
    const s = dormState(1, 500);
    const atoms = npcAtomsFor(npc('alin'), s);
    const first = atoms[0];
    expect(first.kind).toBe('goTo');
    if (first.kind !== 'goTo') return;
    const view = npcAutonomyAt('alin', { day: s.day, minuteOfDay: s.gameMinuteOfDay, runSeed: s.runSeed, scarcity: null });
    expect(first.x).toBe(view.x);
    expect(first.speed).toBe(NPC_WALK_SPEED);
  });

  it('全天多 seed 采样：goTo 的 x 与 npcAutonomyAt 逐分一致且不越界', () => {
    for (const runSeed of [1, 2, 3]) {
      for (let minute = 0; minute < 1440; minute += 7) {
        const s = dormState(runSeed, minute);
        const atoms = npcAtomsFor(npc('alin'), s);
        const goTo = atoms.find((a): a is Extract<NpcAtom, { kind: 'goTo' }> => a.kind === 'goTo')!;
        const view = npcAutonomyAt('alin', { day: s.day, minuteOfDay: minute, runSeed, scarcity: null });
        expect(goTo.x).toBe(view.x);
        expect(goTo.x).toBeGreaterThanOrEqual(NPC_MARGIN);
        expect(goTo.x).toBeLessThanOrEqual(FLOOR_WIDTH - NPC_MARGIN);
      }
    }
  });

  it('五位发布者同样产出 goTo（楼层不同不影响原子的形状）', () => {
    const s = createNewGame(1);
    s.currentFloor = 10; // 招工员所在层
    s.gameMinuteOfDay = NOON_MINUTE;
    const atoms = npcAtomsFor(npc('recruiter'), s);
    expect(atoms[0].kind).toBe('goTo');
  });
});

// ── 2. playAnimation 原子：clip 与 walkcycle 逐字同构 ───────────────────────

describe('playAnimation 原子（clip 映射 render/walkcycle.ts）', () => {
  it('移动中 → walk clip，与 walkAnimKey 的输出逐字一致', () => {
    const s = dormState(1, 360); // 06:00 阿林从睡觉点走向巡查点（moving）
    const atoms = npcAtomsFor(npc('alin'), s);
    const clip = atoms.find((a) => a.kind === 'playAnimation')!;
    expect(clip).toEqual({ kind: 'playAnimation', clip: 'walk-npc_alin' });
    expect(npcClipKey(npcCharacterKey(npc('alin')), true)).toBe(walkAnimKey('npc_alin'));
  });

  it('停留闲逛 → idle clip，与 idleAnimKey 的输出逐字一致', () => {
    const s = dormState(1, 500); // 已到达巡查锚点，闲逛中（not moving）
    const atoms = npcAtomsFor(npc('alin'), s);
    const clip = atoms.find((a) => a.kind === 'playAnimation')!;
    expect(clip).toEqual({ kind: 'playAnimation', clip: 'idle-npc_alin' });
    expect(npcClipKey(npcCharacterKey(npc('alin')), false)).toBe(idleAnimKey('npc_alin'));
  });

  it('小周映射到 npc_xiaozhou 的 sheet', () => {
    const s = dormState(1, 500);
    const atoms = npcAtomsFor(npc('xiaozhou'), s);
    const clip = atoms.find((a) => a.kind === 'playAnimation')!;
    if (clip.kind !== 'playAnimation') return;
    expect(clip.clip.startsWith('walk-npc_xiaozhou') || clip.clip.startsWith('idle-npc_xiaozhou')).toBe(true);
  });

  it('clip 命名漂移会让测试红：walkcycle 的 key 生成器就是唯一基准', () => {
    // 钉死映射：本模块的同构命名与 render 层实际输出必须相等。
    for (const who of ['npc_alin', 'npc_xiaozhou', 'wanderer'] as const) {
      expect(npcClipKey(who, true)).toBe(walkAnimKey(who));
      expect(npcClipKey(who, false)).toBe(idleAnimKey(who));
    }
  });
});

// ── 3. speak 原子：Sensor 门控 + attitudeLine ──────────────────────────────

describe('speak 原子（玩家凑近才说，台词走信誉分层）', () => {
  it('玩家同层且在交互距离内 → 有 speak，文本 = attitudeLine(当前信誉)', () => {
    const s = dormState(1, 500);
    const view = npcAutonomyAt('alin', { day: 1, minuteOfDay: 500, runSeed: 1, scarcity: null });
    s.player.x = view.x; // 贴身
    const atoms = npcAtomsFor(npc('alin'), s);
    const speak = atoms.find((a) => a.kind === 'speak')!;
    expect(speak).toEqual({ kind: 'speak', text: attitudeLine(npc('alin'), 'neutral') });
    // 阿林没写 neutral 档台词，兜底句「拿东西换就行。」（AG-13 钉过同一条）
    expect(speak).toEqual({ kind: 'speak', text: '拿东西换就行。' });
  });

  it('玩家同层但超出交互距离 → 不说', () => {
    const s = dormState(1, 500);
    const view = npcAutonomyAt('alin', { day: 1, minuteOfDay: 500, runSeed: 1, scarcity: null });
    s.player.x = view.x + INTERACT_DISTANCE + 10;
    expect(npcAtomsFor(npc('alin'), s).some((a) => a.kind === 'speak')).toBe(false);
  });

  it('玩家在别的层 → 不说（看不见就不交谈）', () => {
    const s = dormState(1, 500);
    s.currentFloor = 3;
    const view = npcAutonomyAt('alin', { day: 1, minuteOfDay: 500, runSeed: 1, scarcity: null });
    s.player.x = view.x;
    expect(npcAtomsFor(npc('alin'), s).some((a) => a.kind === 'speak')).toBe(false);
  });

  it('信誉改变嘴里的话：hostile 时 speak 是同档 deterministic 台词', () => {
    const s = dormState(1, 500);
    seedNpcState(s, 'alin', { relationship: { player: -60 } });
    const view = npcAutonomyAt('alin', { day: 1, minuteOfDay: 500, runSeed: 1, scarcity: null });
    s.player.x = view.x;
    const speak = npcAtomsFor(npc('alin'), s).find((a) => a.kind === 'speak')!;
    expect(speak).toEqual({ kind: 'speak', text: '别碰我的工具箱。' });
  });

  it('小周四档台词都在数据里：trusted 时说出对应句', () => {
    const s = dormState(1, 500);
    seedNpcState(s, 'xiaozhou', { relationship: { player: 40 } });
    const view = npcAutonomyAt('xiaozhou', { day: 1, minuteOfDay: 500, runSeed: 1, scarcity: null });
    s.player.x = view.x;
    const speak = npcAtomsFor(npc('xiaozhou'), s).find((a) => a.kind === 'speak')!;
    expect(speak).toEqual({ kind: 'speak', text: '你的那份我另搁着。别吭声。' });
  });
});

// ── 4. sense()：AI 经感知层看世界，不直读坐标 ──────────────────────────────

describe('sense() 感知面', () => {
  it('同层/距离/交互距离三态：贴身 true、稍远 false、跨层 Infinity', () => {
    const s = dormState(1, 500);
    const view = npcAutonomyAt('alin', { day: 1, minuteOfDay: 500, runSeed: 1, scarcity: null });

    s.player.x = view.x;
    let seen = sense(npc('alin'), s);
    expect(seen.player.sameFloor).toBe(true);
    expect(seen.player.distance).toBe(0);
    expect(seen.player.withinInteract).toBe(true);

    s.player.x = view.x + INTERACT_DISTANCE + 1;
    seen = sense(npc('alin'), s);
    expect(seen.player.withinInteract).toBe(false);
    expect(seen.player.distance).toBe(INTERACT_DISTANCE + 1);

    s.currentFloor = 5;
    seen = sense(npc('alin'), s);
    expect(seen.player.sameFloor).toBe(false);
    expect(seen.player.distance).toBe(Infinity);
    expect(seen.player.withinInteract).toBe(false);
  });

  it('感知报告 NPC 自己的楼层与运行时 x（不是 npc.x 静态锚点）', () => {
    const s = dormState(1, 500);
    const seen = sense(npc('alin'), s);
    expect(seen.floor).toBe(NPC_FLOOR);
    expect(seen.npcId).toBe('alin');
    const view = npcAutonomyAt('alin', { day: 1, minuteOfDay: 500, runSeed: 1, scarcity: null });
    expect(seen.x).toBe(view.x);
    expect(seen.x).not.toBe(npc('alin').x); // 500 分钟在巡查点 220 附近闲逛，静态 x 是 480
  });

  it('昼夜标志与 SurvivalSystem.isNight 一致', () => {
    const noon = sense(npc('alin'), dormState(1, NOON_MINUTE));
    const night = sense(npc('alin'), dormState(1, NIGHT_MINUTE));
    expect(noon.time.night).toBe(false);
    expect(night.time.night).toBe(true);
    expect(night.time.night).toBe(isNight(NIGHT_MINUTE));
    expect(noon.time.day).toBe(1);
    expect(noon.time.minuteOfDay).toBe(NOON_MINUTE);
  });

  it('日程字段与 npcAutonomyAt 同源：slotLabel / goal / moving', () => {
    const s = dormState(1, 500);
    const seen = sense(npc('alin'), s);
    const view = npcAutonomyAt('alin', { day: 1, minuteOfDay: 500, runSeed: 1, scarcity: null });
    expect(seen.self.slotLabel).toBe(view.slotLabel);
    expect(seen.self.goal).toBe(view.goal);
    expect(seen.self.moving).toBe(view.moving);
    expect(seen.self.slotLabel).toBe('巡查线路');
  });

  it('库存见底 → scarcity 报告需求物品，目标随之变成「寻找某物」', () => {
    const s = dormState(1, 500);
    seedNpcState(s, 'xiaozhou', { inventory: handInventory([{ itemId: 'bread', quantity: 0, max: 3, restockPerDay: 0 }], 1) });
    const seen = sense(npc('xiaozhou'), s);
    expect(seen.self.scarcity).toBe('bread');
    expect(seen.self.goal).toContain('寻找');
    // 库存充足时无短缺
    const fine = sense(npc('xiaozhou'), dormState(1, 500));
    expect(fine.self.scarcity).toBeNull();
  });

  it('信誉分级：无状态默认 neutral，写关系后跟随', () => {
    const fresh = sense(npc('alin'), dormState(1, 500));
    expect(fresh.self.reputation).toBe('neutral');
    const s = dormState(1, 500);
    seedNpcState(s, 'alin', { relationship: { player: 40 } });
    expect(sense(npc('alin'), s).self.reputation).toBe('trusted');
  });

  it('sense 是纯函数：同 state 两次调用结果逐字节一致', () => {
    const s = dormState(1, 500);
    expect(sense(npc('alin'), s)).toEqual(sense(npc('alin'), s));
  });
});

// ── 5. Forced 打断：玩家指令 > AI 自主 ─────────────────────────────────────

describe('Forced 打断（TWOM 的 Forced*Decorator）', () => {
  it('forcedTarget 非空 → 只回强制执行原子，自主原子（含 speak）全丢', () => {
    const s = dormState(1, 500);
    const view = npcAutonomyAt('alin', { day: 1, minuteOfDay: 500, runSeed: 1, scarcity: null });
    s.player.x = view.x; // 玩家就在面前——平时会触发 speak
    const atoms = npcAtomsFor(npc('alin'), s, { forcedTarget: 900 });
    expect(atoms).toEqual([
      { kind: 'goTo', x: 900, speed: NPC_WALK_SPEED },
      { kind: 'playAnimation', clip: 'walk-npc_alin' },
    ]);
  });

  it('forcedTarget 越界按楼层安全范围钳制', () => {
    const s = dormState(1, 500);
    expect(npcAtomsFor(npc('alin'), s, { forcedTarget: -500 })[0]).toEqual({
      kind: 'goTo',
      x: NPC_MARGIN,
      speed: NPC_WALK_SPEED,
    });
    expect(npcAtomsFor(npc('alin'), s, { forcedTarget: 99999 })[0]).toEqual({
      kind: 'goTo',
      x: FLOOR_WIDTH - NPC_MARGIN,
      speed: NPC_WALK_SPEED,
    });
  });

  it('forcedTarget 为空 → 自主原子照常（goTo 到日程位置）', () => {
    const s = dormState(1, 500);
    const view = npcAutonomyAt('alin', { day: 1, minuteOfDay: 500, runSeed: 1, scarcity: null });
    for (const forced of [null, undefined]) {
      const atoms = npcAtomsFor(npc('alin'), s, { forcedTarget: forced });
      expect(atoms[0]).toEqual({ kind: 'goTo', x: view.x, speed: NPC_WALK_SPEED });
      expect(atoms.some((a) => a.kind === 'speak')).toBe(false); // 玩家不在跟前
    }
  });
});

// ── 6. 确定性：同 seed 同 state 同原子序列 ─────────────────────────────────

describe('确定性（禁 Math.random）', () => {
  it('同 state 两次调用 → 原子序列逐字节一致', () => {
    const s = dormState(7, 500);
    const view = npcAutonomyAt('alin', { day: 1, minuteOfDay: 500, runSeed: 7, scarcity: null });
    s.player.x = view.x; // 带上 speak，整条序列都参与比对
    expect(npcAtomsFor(npc('alin'), s)).toEqual(npcAtomsFor(npc('alin'), s));
  });

  it('两个完全相同的存档（同 seed）→ 同原子序列', () => {
    const build = (): GameState => dormState(31, 1100);
    expect(npcAtomsFor(npc('alin'), build())).toEqual(npcAtomsFor(npc('alin'), build()));
  });

  it('换 seed 闲逛轨迹不同：全天扫描 goTo 的 x 序列不同', () => {
    const scan = (runSeed: number): number[] => {
      const out: number[] = [];
      for (let minute = 362; minute <= 539; minute++) {
        const atoms = npcAtomsFor(npc('alin'), dormState(runSeed, minute));
        const goTo = atoms.find((a): a is Extract<NpcAtom, { kind: 'goTo' }> => a.kind === 'goTo')!;
        out.push(goTo.x);
      }
      return out;
    };
    expect(scan(7)).toEqual(scan(7)); // 同 seed 复扫一致
    expect(scan(7)).not.toEqual(scan(8)); // 种子真的在混合
  });
});

// ── 7. 与 AG-13 既有行为不冲突 ─────────────────────────────────────────────

describe('与 AG-13 npcBehavior 断言不冲突（升级不是重写）', () => {
  it('AG-13 的锚点行为原样：06:00 从睡觉点 x=300 出发，moving', () => {
    // 与 npcBehavior.test.ts「npcAutonomyAt：06:00 从睡觉点出发」同值。
    const s = dormState(1, 360);
    const atoms = npcAtomsFor(npc('alin'), s);
    expect(atoms[0]).toEqual({ kind: 'goTo', x: 300, speed: NPC_WALK_SPEED });
    expect(atoms[1]).toEqual({ kind: 'playAnimation', clip: 'walk-npc_alin' });
  });

  it('全部已激活 NPC 全天采样：goTo x 恒等于 npcAutonomyAt，序列形状稳定', () => {
    for (const def of NPCS) {
      if (!isNpcActive(def)) continue;
      for (const runSeed of [1, 2]) {
        for (let minute = 0; minute < 1440; minute += 37) {
          const s = createNewGame(runSeed);
          s.currentFloor = def.floor ?? NPC_FLOOR;
          s.gameMinuteOfDay = minute;
          const atoms = npcAtomsFor(def, s);
          const goTo = atoms.find((a): a is Extract<NpcAtom, { kind: 'goTo' }> => a.kind === 'goTo')!;
          const view = npcAutonomyAt(def.id, { day: 1, minuteOfDay: minute, runSeed, scarcity: null });
          expect(goTo.x, `${def.id}@${minute}`).toBe(view.x);
          // 每条序列都是 goTo + playAnimation（±speak），顺序固定
          expect(atoms[0].kind).toBe('goTo');
          expect(atoms[1].kind).toBe('playAnimation');
        }
      }
    }
  });

  it('按层查询与 npcsOnFloor 一致：2 层两位老邻居产出原子不抛错', () => {
    const s = dormState(1, 500);
    expect(npcsOnFloor(NPC_FLOOR).map((n) => n.id)).toEqual(['alin', 'xiaozhou']);
    for (const def of npcsOnFloor(NPC_FLOOR)) {
      expect(() => npcAtomsFor(def, s)).not.toThrow();
    }
  });
});

// ── 8. 流浪者：三原子不是 NPC 专属 ─────────────────────────────────────────

describe('wandererAtomsFor（第二个实体上的三原子）', () => {
  function nightWandererState(seed = 31): GameState {
    const s = createNewGame(seed);
    s.currentFloor = 3;
    s.gameMinuteOfDay = NIGHT_MINUTE;
    s.worldEvents.activeEvent = { type: 'wanderer', floor: 3, message: '巡游体在这一层游荡', source: 'night' };
    return s;
  }

  it('无事件未结仇 → 空序列', () => {
    expect(wandererAtomsFor(createNewGame(31))).toEqual([]);
  });

  it('夜间事件同层 → goTo 到确定性出生点 + walk clip', () => {
    const s = nightWandererState(31);
    const plan = planNightWanderer(s);
    expect(plan.present).toBe(true);
    expect(wandererAtomsFor(s)).toEqual([
      { kind: 'goTo', x: plan.spawnX },
      { kind: 'playAnimation', clip: 'walk-wanderer' },
    ]);
  });

  it('寻仇优先于夜间事件：没有事件也照样登场（跨层寻仇不靠抽层）', () => {
    const build = (day: number): GameState => {
      const s = createNewGame(31);
      s.day = day;
      s.currentFloor = 3;
      s.gameMinuteOfDay = NIGHT_MINUTE;
      saveNpcState(s, 'wanderer', {
        ...createNpcState('hostile'),
        relationship: { player: -60 },
        memory: [{ id: 'atk_1', day: 5, minute: 600, kind: 'attack', actor: 'player', summary: '袭击了流浪者', weight: -0.9 }],
      });
      return s;
    };
    // 扫出一个寻仇登场日（seed 31 固定，逐日判定确定性可复现）
    let huntDay = 0;
    for (let day = 6; day <= 35 && huntDay === 0; day++) {
      if (planWandererVendetta(build(day)).present) huntDay = day;
    }
    expect(huntDay, 'seed 31 在 6..35 天里竟无寻仇登场日').toBeGreaterThan(0);
    const s = build(huntDay);
    expect(s.worldEvents.activeEvent).toBeNull();
    const vendetta = planWandererVendetta(s);
    expect(vendetta.present).toBe(true);
    expect(wandererAtomsFor(s)).toEqual([
      { kind: 'goTo', x: vendetta.spawnX },
      { kind: 'playAnimation', clip: 'walk-wanderer' },
    ]);
  });
});
