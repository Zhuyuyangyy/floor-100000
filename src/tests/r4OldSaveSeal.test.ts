import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createNewGame } from '../core/gameState';
import { ENTRY_X, PLAYABLE_FLOORS_V01, UP_EXIT_X, downExitXFor } from '../core/constants';
import {
  activeObstacles,
  clampXAgainstObstacles,
  floorExitXs,
  homewardExitXs,
  obstaclesForFloor,
  rescueSealedPlayerX,
  type FloorObstacle,
} from '../systems/LootSystem';
import { hasDownExit, hasUpExit } from '../systems/FloorSystem';
import { liftDirection } from '../core/segments';
import { deserialize } from '../systems/SaveSystem';
import type { GameState } from '../core/gameTypes';

// R4 回归（QA 第 2 轮 probeA-R3-compat-result.json）：AG-96（R3 修复）让正常
// 楼层按 roll 率生成阻碍物后，修复前创建的旧档重进这些层时，玩家位置可能落在
// 新布局的「无口区间」里——没铲子就到不了任何梯口（seed 4 第 2 层 x=365 夹在
// rubble@272 与 gate@458 之间，可行走区间 [298,432]）。护栏挂在 GameScene
// .drawFloor（新档/继续/dev 入口/每次爬梯落地的同一条路），纯函数在
// LootSystem.rescueSealedPlayerX——这里钉它的契约：
//   ① QA 同款场景被迁到安全位且可达梯口；
//   ② 正常位置（含所有新档落点）零迁移；
//   ③ 旧档加载路径（反序列化 → 护栏）复现同一迁移；
//   ④ 边界：无阻碍 / 站在占位区里 / 只有上行口，各有既定行为。
// AG-96 生成侧的口径测试在 obstacles.test.ts，本文件不碰。

const HALF = 26; // blockHalfWidth

/** 独立复算可达性（不借用实现的表达式，与 obstacles.test.ts 同口径）。 */
function reachable(list: readonly FloorObstacle[], from: number, to: number): boolean {
  return !list.some((o) => o.x - HALF > Math.min(from, to) && o.x + HALF < Math.max(from, to));
}

describe('rescueSealedPlayerX — QA 同款场景（seed 4 第 2 层 x=365）', () => {
  it('被封死的旧档位置被迁到最近的安全位，且无铲子也走得通', () => {
    const s = createNewGame(4);
    s.currentFloor = 2;
    s.player.x = 365;
    const active = activeObstacles(s, 2);
    expect(active.map((o) => o.x)).toEqual([272, 458]); // 复现 QA 实测布局
    // 复现软锁本身：365 到两个口都不可达。
    expect(reachable(active, 365, UP_EXIT_X)).toBe(false);
    expect(reachable(active, 365, 1240)).toBe(false);

    const rescued = rescueSealedPlayerX(active, 365, floorExitXs(2), homewardExitXs(2));
    // 两侧远侧边缘距离并列（都是 119）时取向家一侧：484 → 下梯口 1240。
    expect(rescued).toBe(484);
    // 迁后站得住：贴着阻碍物远侧沿，不被每帧钳位推走。
    expect(clampXAgainstObstacles(active, rescued!, rescued!)).toBe(rescued);
    // 迁后走得通：无铲子也能走到下梯口（下楼回家）。
    expect(reachable(active, rescued!, 1240)).toBe(true);
    // 迁移距离最小化：119px，不大于任一侧边缘方案。
    expect(Math.abs(rescued! - 365)).toBe(119);
  });

  it('旧档玩家压在新阻碍物上（inside-obstacle）不迁移——钳位会推出，QA 已确认', () => {
    const active: FloorObstacle[] = [{ kind: 'rubble', x: 222 }];
    expect(rescueSealedPlayerX(active, 222, [40, 1240], [1240])).toBeNull();
    // 推出后落在近侧沿，两侧区间都通（QA 实测 afterLeft 11 / afterRight 196）。
    expect(clampXAgainstObstacles(active, 222, 222)).toBe(196);
    expect(reachable(active, 196, 40)).toBe(true);
  });
});

describe('rescueSealedPlayerX — 新档零行为变化', () => {
  it('正常位置不迁移：ENTRY_X 640 与两个梯口都原地不动', () => {
    const s = createNewGame(4);
    s.currentFloor = 2;
    const active = activeObstacles(s, 2);
    for (const at of [640, 40, 1240, 298, 432, 246, 484]) {
      expect(rescueSealedPlayerX(active, at, floorExitXs(2), homewardExitXs(2)), `x=${at}`).toBeNull();
    }
  });

  it('所有新档落点（ENTRY/爬梯/下梯口/下梯落点）跨 seed 跨层永不触发迁移', () => {
    // 与 obstacles.test.ts 的 R3 口径测试互为镜像：那边钉生成侧保证，这里钉
    // 护栏在这些位置上必须是 no-op——两层合起来才是「新档零行为变化」。
    for (const seed of [1, 4, 42, 2026, 7, 99, 1234, 55555, 987654, 31337]) {
      const s = createNewGame(seed);
      for (const floor of PLAYABLE_FLOORS_V01) {
        if (floor === 1) continue; // 宿舍不过道
        const active = activeObstacles(s, floor);
        const spots = [ENTRY_X, UP_EXIT_X];
        if (hasDownExit(floor)) spots.push(downExitXFor(floor));
        if (hasUpExit(floor)) spots.push(downExitXFor(floor + 1));
        for (const at of spots) {
          expect(
            rescueSealedPlayerX(active, at, floorExitXs(floor), homewardExitXs(floor)),
            `seed ${seed} F${floor} 落点 ${at}`,
          ).toBeNull();
        }
      }
    }
  });

  it('没有阻碍物的楼层永远不迁移', () => {
    for (const at of [40, 365, 640, 1240]) {
      expect(rescueSealedPlayerX([], at, [40, 1240], [1240])).toBeNull();
    }
  });
});

describe('rescueSealedPlayerX — 旧档加载路径', () => {
  it('伪造 QA 同款旧档（seed 4 / 第 2 层 / x=365）走反序列化后按同一规则迁移', () => {
    const oldSave = JSON.stringify({
      schemaVersion: 2,
      runSeed: 4,
      day: 2,
      gameMinuteOfDay: 500,
      currentFloor: 2,
      status: 'playing',
      player: {
        x: 365,
        hp: 100,
        hunger: 80,
        thirst: 80,
        energy: 80,
        equipped: null,
        homeUpgrades: [],
        inventory: { slotCount: 12, slots: [] },
      },
      npcStates: {},
      visitedFloors: {},
      worldEvents: { history: [], activeEvent: null },
    });
    const back = deserialize(oldSave);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const state = back.state;
    // 加载侧原样带进旧位置：修的是进层那一刻，不是反序列化。
    expect(state.player.x).toBe(365);
    const strip = (s: GameState): string => JSON.stringify({ ...s, player: { ...s.player, x: null } });
    const before = strip(state);
    const active = activeObstacles(state, 2);
    const rescued = rescueSealedPlayerX(active, state.player.x, floorExitXs(2), homewardExitXs(2));
    expect(rescued).toBe(484);
    state.player.x = rescued!;
    // 只挪 x：除 player.x 外一个字节都不动。
    expect(strip(state)).toBe(before);
    // 迁后可达下梯口（无铲子）。
    expect(reachable(active, state.player.x, 1240)).toBe(true);
  });
});

describe('rescueSealedPlayerX — 边界与不变量', () => {
  const sealed: FloorObstacle[] = [
    { kind: 'rubble', x: 272 },
    { kind: 'gate', x: 458 },
  ];

  it('只有一个阻碍物时封不死任何人（两侧各有一个口）', () => {
    const one: FloorObstacle[] = [{ kind: 'rubble', x: 600 }];
    for (const at of [100, 300, 500, 700, 900, 1200]) {
      expect(rescueSealedPlayerX(one, at, [40, 1240], [1240]), `x=${at}`).toBeNull();
    }
  });

  it('并列且都不向家时取左（确定性）', () => {
    // 只有上行口 40 算出口：右侧 484 到 40 被堵，唯一安全候选是左侧 246。
    expect(rescueSealedPlayerX(sealed, 365, [40], [])).toBe(246);
    expect(reachable(sealed, 246, 40)).toBe(true);
  });

  it('相邻区间也不通时退到口子自身（口位恒安全）', () => {
    // 三口布局：中段封死，左段只通 40、右段只通 1240——两侧远侧沿都是安全
    // 候选；再构造一个连远侧沿都不通的（右段出口在更右的阻碍物外）。
    const three: FloorObstacle[] = [
      { kind: 'rubble', x: 300 },
      { kind: 'gate', x: 700 },
      { kind: 'rubble', x: 1100 },
    ];
    // x=500 在 [326,674]：左边 274→40 通，右边 726→1240 被 1100 挡。
    expect(rescueSealedPlayerX(three, 500, [40, 1240], [1240])).toBe(274);
    expect(reachable(three, 274, 40)).toBe(true);
  });

  it('不变量：迁移目标恒不在占位区里、恒有可达口子；距离恒最小候选', () => {
    // 网格扫描：合成布局 × 全楼层 x，独立复算两个不变量。
    const layouts: FloorObstacle[][] = [
      [],
      [{ kind: 'rubble', x: 222 }],
      sealed,
      [
        { kind: 'rubble', x: 300 },
        { kind: 'gate', x: 700 },
        { kind: 'rubble', x: 1100 },
      ],
    ];
    const exits = [40, 1240];
    const homeward = [1240];
    for (const list of layouts) {
      for (let x = 0; x <= 1280; x += 7) {
        const rescued = rescueSealedPlayerX(list, x, exits, homeward);
        if (rescued === null) continue;
        const inside = list.some((o) => o.x - HALF < rescued && rescued < o.x + HALF);
        expect(inside, `x=${x} → ${rescued} 落在占位区里`).toBe(false);
        expect(reachable(list, rescued, 40) || reachable(list, rescued, 1240), `x=${x} → ${rescued} 两口都够不着`).toBe(true);
        // 距离最小：不存在更近的安全候选。
        for (const c of [rescued - 1, rescued + 1, 40, 1240]) {
          if (c < 0 || c > 1280) continue;
          const cSafe =
            !list.some((o) => o.x - HALF < c && c < o.x + HALF) &&
            (reachable(list, c, 40) || reachable(list, c, 1240));
          if (!cSafe) continue;
          expect(Math.abs(c - x), `x=${x}：${c} 比 ${rescued} 更近却未被选`).toBeGreaterThanOrEqual(Math.abs(rescued - x));
        }
      }
    }
  });
});

describe('R4 护栏接线', () => {
  it('GameScene.drawFloor 在 buildObstacles 之后调用护栏（源码断言）', () => {
    const src = readFileSync(join(process.cwd(), 'src/scenes/GameScene.ts'), 'utf8');
    // RC-03 拆分第 10 步：阻碍物名册刷新迁入 InteractionController，drawFloor
    // 的调用点从 this.buildObstacles() 变成 this.interaction.buildObstacles()
    // ——「先刷名册再裁决」的契约不变，断言跟着换锚（同第 3/7 步先例）。
    const buildIdx = src.indexOf('this.interaction.buildObstacles();');
    const guardIdx = src.indexOf('rescueSealedPlayerX(');
    expect(buildIdx, 'drawFloor 仍在 buildObstacles 刷名册').toBeGreaterThan(-1);
    expect(guardIdx, '护栏调用存在').toBeGreaterThan(-1);
    // 必须先刷本层阻碍物名册（activeObstacleList）再裁决，否则读的是上一层的。
    expect(guardIdx).toBeGreaterThan(buildIdx);
  });

  it('生成侧口径未动：floorExitXs 与 obstaclesForFloor 共用同一出口集', () => {
    const LIFT_X = 1165; // obstacles.liftX
    for (const floor of [2, 5, 10, 100, 1000, 50000, 100000]) {
      const exits = floorExitXs(floor);
      const expected: number[] = [];
      if (hasUpExit(floor)) expected.push(UP_EXIT_X);
      if (hasDownExit(floor)) expected.push(downExitXFor(floor));
      if (liftDirection(floor) === 'down') expected.push(LIFT_X); // 只有免费下行电梯算出口
      expect(exits).toEqual(expected);
      // 家园口是出口集的子集（不含上梯口）。
      for (const h of homewardExitXs(floor)) expect(exits).toContain(h);
      expect(homewardExitXs(floor)).not.toContain(UP_EXIT_X);
    }
  });

  it('AG-96 布局本身未被改动（seed 4 第 2 层仍是 272/458）', () => {
    // 护栏只在进层时挪玩家，不碰生成侧——这条钉的就是「没动」。
    const s = createNewGame(4);
    expect(obstaclesForFloor(s, 2).map((o) => `${o.kind}@${o.x}`)).toEqual(['rubble@272', 'gate@458']);
  });
});
