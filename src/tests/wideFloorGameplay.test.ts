// AG-104：宽楼玩法几何（楼层宽度不一的转换补完，AG-65 只转了渲染侧）。
//
// AG-101 审计出 4 项活的玩法几何漏网——宽楼（tier2+，1600-2880px+）的右半
// 玩法空白。本文件钉住每项修复的宽楼新行为，同时钉住 tier1（1280）存量行为
// 逐点不变（默认参数 = FLOOR_WIDTH，存量调用零改动）：
//   1. encounterSpots：遭遇点/行商按楼层实际宽度投放，宽楼能落右半
//      （live：GameScene.buildEncounterSpots）
//   2. stairPath/stairClimbPose：宽楼中段梯口折返方向朝楼层中间
//      （live：GameScene.drawStair + updateStairClimb）
//   3. wandererNightSpawnX/stepWandererRoam/wandererRoamGone/巡逻树：
//      流浪者出生/巡逻/撤退覆盖全层（出生点 live，其余当前仅测试引用）
//   4. clampX（npcAtoms/npcSchedule）：goTo/日程 x 的钳制上限按楼层宽
//      （npcSchedule live via GameScene.npcView；forcedTarget 当前仅探针/测试）
//
// 铁律与既有楼层几何测试一致：seeded 确定性不变——同 (seed, floor) 同答案；
// hash/rng 入参一个字节没动，变的只是「按楼层宽取值」的下游。

import { describe, expect, it } from 'vitest';

import { createNewGame } from '../core/gameState';
import {
  DOWN_EXIT_X,
  FLOOR_WIDTH,
  PLAYABLE_FLOORS_V01,
  STAIR_START_Y,
  UP_EXIT_X,
  downExitXFor,
  floorWidthFor,
  tierOfFloor,
} from '../core/constants';
import { deriveSeed, makeRng } from '../core/rng';
import { getNpc, NPC_FLOOR } from '../data/npcs';
import type { NpcDef } from '../data/npcs';
import { encounterSpots, nudgeSpotX, placeClearX } from '../systems/encounterSpots';
import { stairTraversalFor } from '../systems/FloorSystem';import {
  freshWandererRoam,
  stepWandererRoam,
  wandererNightSpawnX,
  wandererRoamGone,
} from '../systems/NpcAutonomy';
import { drawStairwell, stairClimbPose, stairPath } from '../render/corridors';
import { WANDERER_PATROL_TREE, evaluateTree, type BehaviourSense } from '../ai/behaviour';
import { npcAtomsFor } from '../ai/npcAtoms';
import { npcAutonomyAt } from '../ai/npcSchedule';
import type { GameState } from '../core/gameTypes';

// ── 布阵助手 ────────────────────────────────────────────────────────────────

/** 100000 层（tier6，9 房 2880px）——QA 常用的宽楼探针层。 */
const WIDE_FLOOR = 100000;
/** 110 层（tier2，6 房 1920px）：下行梯口 648，正好落在旧判据的错折区间
 * [640, width/2) = [640, 960) 里——修复前第一段背向楼层中间走。 */
const TIER2_FLOOR = 110;
/** 102 层（tier2，5 房 1600px）：梯口 496，新旧判据同向——「窄一点的宽楼」
 * 行为不变的对照。 */
const TIER2_NARROW_FLOOR = 102;

const QA_SEEDS = [1, 42, 2026];

function npc(id: Parameters<typeof getNpc>[0]): NpcDef {
  return getNpc(id);
}

function stateOn(seed: number, floor: number, minuteOfDay = 500): GameState {
  const s = createNewGame(seed);
  s.currentFloor = floor;
  s.gameMinuteOfDay = minuteOfDay;
  return s;
}

function traversalFor(floor: number, direction: 1 | -1) {
  const s = stateOn(1, floor);
  const t = stairTraversalFor(s, direction);
  expect(t, `floor ${floor} dir ${direction} 必须有楼梯`).not.toBeNull();
  return t!;
}

// ── 1. encounterSpots：宽楼遭遇点/行商落右半 ────────────────────────────────

describe('AG-104 encounterSpots：宽楼投放范围按楼层宽', () => {
  it('tier1 遭遇点按本层宽度投放，逐点冻结', () => {
    // 2026-11-20 tier1 也变长：3 层 1600、5 层 1920，遭遇点随宽度重算。
    // 钉字面量守住 seeded 推导，任何无意改动都会红在这里。
    expect(encounterSpots(42, 3)).toEqual([
      { id: '3:spot0', x: 980, isBoss: false },
      { id: '3:spot1', x: 603, isBoss: false },
    ]);
    expect(encounterSpots(42, 5)).toEqual([
      { id: '5:spot0', x: 894, isBoss: false },
      { id: '5:boss', x: 110, isBoss: true },
    ]);
    for (const floor of PLAYABLE_FLOORS_V01.filter((f) => tierOfFloor(f) === 1)) {
      const width = floorWidthFor(floor);
      for (const spot of encounterSpots(42, floor)) {
        expect(spot.x, `tier1 floor ${floor} spot ${spot.id}`).toBeLessThan(width);
      }
    }
  });

  it('宽楼（100000，2880px）：同 seed 同楼层确定，且能落到右半', () => {
    const width = floorWidthFor(WIDE_FLOOR);
    expect(width).toBeGreaterThan(FLOOR_WIDTH);
    // 确定性：同 (seed, floor) 永远同一布局（存档/重进不漂移）。
    expect(encounterSpots(1, WIDE_FLOOR)).toEqual(encounterSpots(1, WIDE_FLOOR));
    const spots = encounterSpots(1, WIDE_FLOOR);
    for (const spot of spots) {
      expect(spot.x, `spot ${spot.id}`).toBeGreaterThan(0);
      expect(spot.x, `spot ${spot.id}`).toBeLessThan(width);
    }
    // 右半真的有货：seed 1 的 spot1 落在 2496（旧行为下全部 ≤ 2620-? 不——
    // 旧 span=1280-520=760，全部 ≤ 1020，右半 1280 以外什么都没有）。
    expect(spots.some((s) => s.x > FLOOR_WIDTH), '宽楼必须至少有一个 ? 在右半').toBe(true);
    expect(spots.find((s) => s.id === '100000:spot1')!.x).toBe(2496);
  });

  it('宽楼跨 seed 两半都有：遭遇点不再挤在左 1280', () => {
    let left = 0;
    let right = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const spot of encounterSpots(seed, WIDE_FLOOR)) {
        if (spot.x < FLOOR_WIDTH) left++;
        else right++;
      }
    }
    expect(left, '左半仍有遭遇点（楼是连通的，不是全搬去右半）').toBeGreaterThan(0);
    expect(right, '右半出现遭遇点（修复的全部意义）').toBeGreaterThan(0);
  });

  it('行商（placeClearX，live：GameScene 的 shopX）在宽楼能落右半', () => {
    // 三个 QA seed 的行商全部 > 1280；旧行为下 span=1280-400=880，全部 ≤ 1080。
    for (const seed of QA_SEEDS) {
      const shopX = placeClearX(seed, WIDE_FLOOR, 'trader', [UP_EXIT_X, downExitXFor(WIDE_FLOOR)], 88);
      expect(shopX, `seed ${seed} 行商 x`).toBeGreaterThan(FLOOR_WIDTH);
      expect(shopX).toBeLessThan(floorWidthFor(WIDE_FLOOR));
    }
    expect(placeClearX(1, WIDE_FLOOR, 'trader', [UP_EXIT_X, downExitXFor(WIDE_FLOOR)], 88)).toBe(2343);
  });

  it('nudgeSpotX：宽楼按传入楼层宽搜索，不再被 1280 截回', () => {
    // 2880 宽楼上 2800 处挨着 2810：应向左找到 2752（楼内）。
    expect(nudgeSpotX(2800, [2810], 40, 2880)).toBe(2752);
    // 缺省宽度保持存量行为：1280 楼下 2800 超出搜索边界，原样返回。
    expect(nudgeSpotX(2800, [2810], 40)).toBe(2800);
    // 窄楼默认行为也不变（存量断言）。
    expect(nudgeSpotX(500, [505], 40)).toBeGreaterThan(545);
  });
});

// ── 2. stairPath / stairClimbPose：宽楼梯口折返方向 ─────────────────────────

describe('AG-104 stairPath：宽楼梯口折返朝楼层中间', () => {
  it('缺省宽度保持存量行为（tier1 上行左折返、下行右折返的字面量）', () => {
    const up = stairPath(1, UP_EXIT_X, STAIR_START_Y);
    expect(up[0].x).toBe(UP_EXIT_X);
    expect(up[1].x).toBe(UP_EXIT_X + 32); // 第一段朝楼中（右）
    expect(up[5].x).toBe(UP_EXIT_X + 160);
    const down = stairPath(-1, DOWN_EXIT_X, STAIR_START_Y);
    expect(down[0].x).toBe(DOWN_EXIT_X);
    expect(down[1].x).toBe(DOWN_EXIT_X - 32); // 第一段朝楼中（左）
    expect(down[5].x).toBe(DOWN_EXIT_X - 160);
  });

  it('宽楼中段梯口（110：x=648 < 960）第一段朝右折返，不再背向楼中', () => {
    const width = floorWidthFor(TIER2_FLOOR);
    const mouthX = downExitXFor(TIER2_FLOOR);
    expect(mouthX).toBeGreaterThanOrEqual(FLOOR_WIDTH / 2); // 落在旧判据的错折区间
    expect(mouthX).toBeLessThan(width / 2);
    const nodes = stairPath(-1, mouthX, STAIR_START_Y, width);
    expect(nodes[0].x).toBe(mouthX);
    expect(nodes[1].x, '第一段应朝楼层中间（右）').toBe(mouthX + 32);
    expect(nodes[5].x, '落点应越过楼中').toBe(mouthX + 160);
    // 第二段回梯口，首尾同在梯口（折返一次，契约不变）。
    expect(nodes[nodes.length - 1].x).toBe(mouthX);
  });

  it('100000 层（x=992 < 1440）同样朝右：画与爬同源', () => {
    const width = floorWidthFor(WIDE_FLOOR);
    const mouthX = downExitXFor(WIDE_FLOOR);
    expect(mouthX).toBeLessThan(width / 2);
    const nodes = stairPath(-1, mouthX, STAIR_START_Y, width);
    expect(nodes[1].x).toBe(mouthX + 32);
    expect(nodes[5].x).toBe(mouthX + 160);
    // 整条路不出楼层边界。
    for (const n of nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(width);
    }
  });

  it('窄一点的宽楼（102：x=496）新旧判据同向，行为不变', () => {
    const width = floorWidthFor(TIER2_NARROW_FLOOR);
    const mouthX = downExitXFor(TIER2_NARROW_FLOOR);
    expect(mouthX).toBeLessThan(FLOOR_WIDTH / 2);
    const nodes = stairPath(-1, mouthX, STAIR_START_Y, width);
    expect(nodes[1].x).toBe(mouthX + 32);
    expect(nodes[5].x).toBe(mouthX + 160);
  });

  it('stairClimbPose（live 爬梯曲线）按本层宽折返：110 层落点在楼中右侧', () => {
    const down = traversalFor(TIER2_FLOOR, -1);
    const mouthX = down.startX;
    expect(mouthX).toBe(downExitXFor(TIER2_FLOOR));
    // 半程 = 折返平台：x 应落在 mouthX+160（朝楼中折返后的平台）。
    const mid = stairClimbPose(TIER2_FLOOR, down, down.durationMs / 2);
    expect(mid.x).toBeCloseTo(mouthX + 160, 6);
    expect(mid.y).toBeCloseTo(STAIR_START_Y + 100, 6);
    // 首尾在梯口；y 单调（下楼只下不上）。
    expect(stairClimbPose(TIER2_FLOOR, down, 0).x).toBe(mouthX);
    const end = stairClimbPose(TIER2_FLOOR, down, down.durationMs);
    expect(end.x).toBe(mouthX);
    let lastY = -Infinity;
    for (let ms = 0; ms <= down.durationMs; ms += 10) {
      const pose = stairClimbPose(TIER2_FLOOR, down, ms);
      expect(pose.y).toBeGreaterThanOrEqual(lastY - 1e-9);
      lastY = pose.y;
    }
  });

  it('画出来的楼梯（drawStairwell）与爬梯曲线同一折返方向', () => {
    // 记录型假 Graphics（与 stairsArt.test.ts 同手法）：第一块踏面的左沿应在
    // 梯口右侧 16px（朝楼中折返），旧行为下在左侧。
    const floor = TIER2_FLOOR;
    const mouthX = downExitXFor(floor);
    const g = new FakeGraphics();
    drawStairwell(g as never, { x: mouthX, dir: 'down', floor });
    const treads = g.commands.filter((c) => c.op === 'fillRect' && c.args[2] === 32);
    expect(treads.length).toBeGreaterThan(0);
    expect(treads[0].args[0], '第一块踏面在梯口右侧（朝楼中）').toBe(mouthX + 16);
    // 爬梯曲线骑在画出来的踏面上（同源 stairPath）。
    const down = traversalFor(floor, -1);
    expect(stairClimbPose(floor, down, down.durationMs / 2).x).toBeCloseTo(mouthX + 160, 6);
  });
});

// ── 3. 流浪者：出生/巡逻/撤退覆盖全层 ───────────────────────────────────────

describe('AG-104 流浪者：宽楼覆盖全层', () => {
  it('wandererNightSpawnX：tier1 逐点冻结（3 层变长后重算）', () => {
    // 3 层 1600 宽后夜游者出生点随层宽重算；钉字面量守住 seeded 推导。
    expect(wandererNightSpawnX(createNewGame(42), 'night', 3)).toBe(599);
    expect(wandererNightSpawnX(createNewGame(1), 'night', 3)).toBe(139);
    expect(wandererNightSpawnX(createNewGame(2026), 'night', 3)).toBe(1188);
  });

  it('wandererNightSpawnX：宽楼能出生在右半，且不出界', () => {
    const width = floorWidthFor(WIDE_FLOOR);
    const lo = 48;
    const hi = width - 48;
    // 确定性：同 (runSeed, day, source, floor) 同位置。
    const s = createNewGame(1);
    expect(wandererNightSpawnX(s, 'night', WIDE_FLOOR)).toBe(wandererNightSpawnX(s, 'night', WIDE_FLOOR));
    // QA seeds 1/42 直接钉在右半（旧行为下全部 ≤ 1232，右半永远空）。
    expect(wandererNightSpawnX(createNewGame(1), 'night', WIDE_FLOOR)).toBe(1511);
    expect(wandererNightSpawnX(createNewGame(42), 'night', WIDE_FLOOR)).toBe(2342);
    // 跨 seed 两半都出生，且全部在楼层安全带内。
    let left = 0;
    let right = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const x = wandererNightSpawnX(createNewGame(seed), 'night', WIDE_FLOOR);
      expect(x).toBeGreaterThanOrEqual(lo);
      expect(x).toBeLessThanOrEqual(hi);
      if (x < width / 2) left++;
      else right++;
    }
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
  });

  it('stepWandererRoam（当前仅测试引用）：宽楼撤退走全层出口、巡逻点覆盖右半', () => {
    const width = 2880;
    // withdraw：起点 1500（旧行为会判「左半」走向 0）→ 应走向右端出口 2880。
    let roam = freshWandererRoam(1500);
    roam = stepWandererRoam({ ...roam, phase: 'withdraw' }, { playerX: 100, aggroRange: 260, dtMs: 16, rng: makeRng(1), floorWidth: width });
    expect(roam.targetX).toBe(width);
    for (let i = 0; i < 500 && !wandererRoamGone(roam, width); i++) {
      roam = stepWandererRoam(roam, { playerX: 100, aggroRange: 260, dtMs: 100, rng: makeRng(1), floorWidth: width });
    }
    expect(wandererRoamGone(roam, width)).toBe(true);
    // 缺省宽度保持存量：起点 200 → 走左端 0，x≤8 判 gone。
    let legacy = freshWandererRoam(200);
    legacy = stepWandererRoam({ ...legacy, phase: 'withdraw' }, { playerX: 1000, aggroRange: 260, dtMs: 16, rng: makeRng(1) });
    expect(legacy.targetX).toBe(0);
    expect(wandererRoamGone(legacy)).toBe(false);
    // patrol：宽楼路径点能落到右半（旧行为全部 ≤ 1232），且不越界。
    // rng 走 deriveSeed（与存量测试同手法）：makeRng(小整数) 的首浮点接近 0，
    // 扫不出分布；deriveSeed 才真的在混合。
    let sawRight = false;
    for (let k = 1; k <= 20; k++) {
      const rng = makeRng(deriveSeed(k, 'wanderer', 'patrol-wide'));
      const next = stepWandererRoam(freshWandererRoam(1500), { playerX: 10, aggroRange: 100, dtMs: 16, rng, floorWidth: width });
      expect(next.targetX).toBeGreaterThanOrEqual(48);
      expect(next.targetX).toBeLessThanOrEqual(width - 48);
      if (next.targetX > FLOOR_WIDTH) sawRight = true;
    }
    expect(sawRight, '宽楼巡逻路径点必须能落到右半').toBe(true);
  });

  it('流浪者巡逻树（当前仅测试引用）：P1 撤退出口按 sense.floorWidth 选近端', () => {
    const ctx = (sense: Partial<BehaviourSense>) => ({
      hasFlag: (key: string) => key === 'wanderer.withdrawing',
      sense: {
        night: true,
        selfX: 0,
        playerX: null,
        playerDistance: null,
        aggroRange: 260,
        patrolX: 0,
        ...sense,
      },
    });
    // 宽楼：selfX=1400 在 2880 的左半（1440 为中）→ 撤向左端 0。
    expect(
      evaluateTree(WANDERER_PATROL_TREE, ctx({ selfX: 1400, floorWidth: 2880 })),
    ).toEqual([
      { kind: 'goTo', x: 0 },
      { kind: 'playAnimation', clip: 'withdraw' },
    ]);
    // 宽楼：selfX=1500 在右半 → 撤向右端 2880（旧行为只会给 1280）。
    expect(
      evaluateTree(WANDERER_PATROL_TREE, ctx({ selfX: 1500, floorWidth: 2880 })),
    ).toEqual([
      { kind: 'goTo', x: 2880 },
      { kind: 'playAnimation', clip: 'withdraw' },
    ]);
    // 缺省 floorWidth：存量行为不变（ behaviour.test.ts 的同款断言 ）。
    expect(
      evaluateTree(WANDERER_PATROL_TREE, ctx({ selfX: FLOOR_WIDTH - 100 })),
    ).toEqual([
      { kind: 'goTo', x: FLOOR_WIDTH },
      { kind: 'playAnimation', clip: 'withdraw' },
    ]);
  });
});

// ── 4. clampX：goTo/日程的钳制上限按楼层宽 ─────────────────────────────────

describe('AG-104 clampX：NPC 不再被钳在 1280', () => {
  it('npcAtomsFor forcedTarget：宽楼指令点到右半不被截', () => {
    const s = stateOn(1, NPC_FLOOR);
    const alin = npc('alin');
    // 点 2000（右半）：旧行为 clamp 到 1232，现在原样可达。
    const goTo2000 = npcAtomsFor(alin, s, { forcedTarget: 2000, floorWidth: 2880 })[0];
    expect(goTo2000).toEqual({ kind: 'goTo', x: 2000, speed: 40 });
    // 越界值按本层宽钳制：99999 → 2880-48 = 2832（旧行为 1232）。
    const goToFar = npcAtomsFor(alin, s, { forcedTarget: 99999, floorWidth: 2880 })[0];
    expect(goToFar).toMatchObject({ kind: 'goTo', x: 2880 - 48 });
    // 缺省宽度：存量行为不变（ npcAtoms.test.ts 钉 99999 → 1232 ）。
    const legacy = npcAtomsFor(alin, s, { forcedTarget: 99999 })[0];
    expect(legacy).toMatchObject({ kind: 'goTo', x: FLOOR_WIDTH - 48 });
  });

  it('npcAutonomyAt：传楼层宽不改动存量布局（锚点全在左半，钳制本就是空转）', () => {
    // 五个发布者全天逐 7 分钟采样：传 1600 与缺省结果逐点一致——楼层宽透传
    // 只放开上限，不重排任何既有位置。
    for (const id of ['alin', 'xiaozhou', 'recruiter', 'blackmarket', 'lab_clerk']) {
      const def = getNpc(id as Parameters<typeof getNpc>[0]);
      if (!def) continue;
      for (let minute = 0; minute < 1440; minute += 7) {
        const base = { day: 1, minuteOfDay: minute, runSeed: 7, scarcity: null };
        const wide = npcAutonomyAt(def.id, { ...base, floorWidth: 1600 });
        const narrow = npcAutonomyAt(def.id, base);
        expect(wide.x, `${def.id} @${minute}`).toBe(narrow.x);
      }
    }
  });

  it('npcAutonomyAt：楼层宽透传后上限跟着本层走', () => {
    // 直接钉钳制函数语义：宽 2880 时 x 上限 2832（经由 forcedTarget 已覆盖），
    // 这里补 npcSchedule 侧的入参契约——ctx.floorWidth 缺省 = FLOOR_WIDTH。
    const base = { day: 1, minuteOfDay: 500, runSeed: 1, scarcity: null };
    expect(npcAutonomyAt('alin', base).x).toBe(npcAutonomyAt('alin', { ...base, floorWidth: FLOOR_WIDTH }).x);
    expect(npcAutonomyAt('alin', { ...base, floorWidth: 2880 }).x).toBeGreaterThanOrEqual(48);
    expect(npcAutonomyAt('alin', { ...base, floorWidth: 2880 }).x).toBeLessThanOrEqual(2880 - 48);
  });
});

// ── 记录型假 Graphics（stairsArt.test.ts 同手法）────────────────────────────

interface DrawCmd {
  op: 'fillStyle' | 'fillRect' | 'lineStyle' | 'beginPath' | 'moveTo' | 'lineTo' | 'strokePath';
  args: number[];
}

class FakeGraphics {
  commands: DrawCmd[] = [];
  fillStyle(color: number, alpha: number): this {
    this.commands.push({ op: 'fillStyle', args: [color, alpha] });
    return this;
  }
  fillRect(x: number, y: number, w: number, h: number): this {
    this.commands.push({ op: 'fillRect', args: [x, y, w, h] });
    return this;
  }
  lineStyle(width: number, color: number, alpha: number): this {
    this.commands.push({ op: 'lineStyle', args: [width, color, alpha] });
    return this;
  }
  beginPath(): this {
    this.commands.push({ op: 'beginPath', args: [] });
    return this;
  }
  moveTo(x: number, y: number): this {
    this.commands.push({ op: 'moveTo', args: [x, y] });
    return this;
  }
  lineTo(x: number, y: number): this {
    this.commands.push({ op: 'lineTo', args: [x, y] });
    return this;
  }
  strokePath(): this {
    this.commands.push({ op: 'strokePath', args: [] });
    return this;
  }
}
