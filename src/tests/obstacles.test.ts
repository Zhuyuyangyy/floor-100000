import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { ENTRY_X, PLAYABLE_FLOORS_V01, UP_EXIT_X, downExitXFor, floorWidthFor } from '../core/constants';
import { asItemId } from '../data/items';
import {
  OBSTACLE_DIG_COST_MINUTES,
  OBSTACLE_DIG_MS,
  SEARCH_MS,
  activeObstacles,
  clampXAgainstObstacles,
  clearObstacle,
  getFloorView,
  isObstacleCleared,
  lootGround,
  nearestObstacle,
  obstacleKey,
  obstacleTool,
  obstaclesForFloor,
  recordFloorVisit,
  type FloorObstacle,
} from '../systems/LootSystem';
import { addItem, countItem } from '../systems/InventorySystem';
import { deserialize, serialize, validateGameState } from '../systems/SaveSystem';
import { liftDirection } from '../core/segments';
import { hasDownExit, hasUpExit } from '../systems/FloorSystem';
import balance from '../../config/game-balance.json' with { type: 'json' };

// AG-66（搜刮交互工程师）的单测：2 秒搜刮动作的数值入口 + 过道阻碍物的三条
// 硬规则（避让 / 可通 / 有解）+ 存档持久性。场景层（GameScene）的接线由
// e2e/ag66-obstacles.spec.ts 实测，这里只钉纯函数契约。

const HALF = 26; // blockHalfWidth
const KEEP = 90; // keepClear
const LIFT_X = (balance as unknown as { obstacles: { liftX: number } }).obstacles.liftX;

/** 配置段直读，测试与实现同源（改配置两边一起动，不会各说各话）。 */
const CFG = (balance as unknown as {
  obstacles: { maxPerFloor: number; digMs: number; digCostMinutes: number };
}).obstacles;
const SEARCH_CFG = (balance as unknown as { search: { ms: number } }).search;

describe('search action timing (AG-66)', () => {
  it('exports the configured 2s search and dig timings', () => {
    expect(SEARCH_MS).toBe(SEARCH_CFG.ms);
    expect(SEARCH_MS).toBe(2000);
    expect(OBSTACLE_DIG_MS).toBe(CFG.digMs);
    expect(OBSTACLE_DIG_MS).toBe(2000);
    expect(OBSTACLE_DIG_COST_MINUTES).toBe(CFG.digCostMinutes);
  });
});

describe('obstaclesForFloor — 每层 seeded 0-2 个', () => {
  it('the dorm (floor 1) never gets one — home is not a corridor', () => {
    const s = createNewGame(42);
    expect(obstaclesForFloor(s, 1)).toEqual([]);
  });

  it('is deterministic per (runSeed, floor) and bounded by maxPerFloor', () => {
    for (const seed of [1, 42, 2026, 7, 99, 1234, 55555]) {
      const s = createNewGame(seed);
      for (const floor of [2, 3, 10, 100, 1000, 10000, 50000, 100000]) {
        const a = obstaclesForFloor(s, floor);
        const b = obstaclesForFloor(s, floor);
        expect(a, `seed ${seed} floor ${floor}`).toEqual(b);
        expect(a.length).toBeLessThanOrEqual(CFG.maxPerFloor);
        for (const o of a) {
          expect(o.kind === 'rubble' || o.kind === 'gate').toBe(true);
          expect(Number.isInteger(o.x)).toBe(true);
          expect(o.x).toBeGreaterThan(UP_EXIT_X + KEEP);
          expect(o.x).toBeLessThan(downExitXFor(floor) - KEEP);
        }
      }
    }
  });

  it('does not drift when the floor is looted (回层不复活的前提)', () => {
    // 地面物被捡掉会从 getFloorView 消失——避让清单只含稳定项（容器/口位），
    // 所以阻碍物位置不随搜刮漂移。
    const s = createNewGame(42);
    const before = obstaclesForFloor(s, 3);
    const ground = getFloorView(s, 3).groundItems;
    for (const g of ground) lootGround(s, 3, g.key);
    expect(obstaclesForFloor(s, 3)).toEqual(before);
  });

  it('keeps clear of both stair mouths, the lift, the entry and every container', () => {
    for (const seed of [1, 42, 2026, 7, 99, 1234, 55555, 987654]) {
      const s = createNewGame(seed);
      for (const floor of PLAYABLE_FLOORS_V01) {
        if (floor === 1) continue;
        const view = getFloorView(s, floor);
        const guarded = [UP_EXIT_X, downExitXFor(floor), LIFT_X, ENTRY_X, ...view.containers.map((c) => c.x)];
        for (const o of obstaclesForFloor(s, floor)) {
          for (const kx of guarded) {
            expect(Math.abs(kx - o.x), `seed ${seed} F${floor} x${o.x} vs ${kx}`).toBeGreaterThanOrEqual(KEEP + HALF);
          }
          // 容器不只避让 x，还要留够 E 的交互距离（INTERACT_DISTANCE=44）
          for (const c of view.containers) {
            expect(Math.abs(c.x - o.x)).toBeGreaterThan(44);
          }
        }
      }
    }
  });

  it('never traps the player: from ENTRY_X at least one exit stays reachable', () => {
    // 独立复算可达性（不借用实现的表达式）：出口与 ENTRY_X 之间的开区间里
    // 不能含任何阻碍区间的任一部分。全楼层 × 多 seed 扫描——这条是防软锁的
    // 硬规则（GAME_DESIGN_LOCK §5）。
    for (const seed of [1, 42, 2026, 7, 99, 1234, 55555, 987654, 31337]) {
      const s = createNewGame(seed);
      for (const floor of PLAYABLE_FLOORS_V01) {
        if (floor === 1) continue;
        const exits: number[] = [];
        if (hasUpExit(floor)) exits.push(UP_EXIT_X);
        if (hasDownExit(floor)) exits.push(downExitXFor(floor));
        if (liftDirection(floor) !== null) exits.push(LIFT_X);
        const obstacles = obstaclesForFloor(s, floor);
        const reachable = (to: number): boolean => {
          const lo = Math.min(ENTRY_X, to);
          const hi = Math.max(ENTRY_X, to);
          return !obstacles.some((o) => o.x - HALF > lo && o.x + HALF < hi);
        };
        expect(exits.some(reachable), `seed ${seed} F${floor} 全出口被堵`).toBe(true);
      }
    }
  });

  it('spawns both kinds across seeds, and only inside the corridor', () => {
    const kinds = new Set<string>();
    let total = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const s = createNewGame(seed);
      for (const floor of PLAYABLE_FLOORS_V01) {
        for (const o of obstaclesForFloor(s, floor)) {
          kinds.add(o.kind);
          total++;
          expect(o.x).toBeGreaterThanOrEqual(UP_EXIT_X + KEEP);
          expect(o.x).toBeLessThanOrEqual(downExitXFor(floor) - KEEP);
          expect(o.x).toBeLessThan(floorWidthFor(floor));
        }
      }
    }
    expect(kinds.has('rubble')).toBe(true);
    expect(kinds.has('gate')).toBe(true);
    expect(total).toBeGreaterThan(20); // 密度确实存在，不是永远为空
  });

  it('two obstacles on one floor never overlap', () => {
    for (let seed = 1; seed <= 80; seed++) {
      const s = createNewGame(seed);
      for (const floor of PLAYABLE_FLOORS_V01) {
        const list = obstaclesForFloor(s, floor);
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            expect(Math.abs(list[i].x - list[j].x)).toBeGreaterThanOrEqual(HALF * 4);
          }
        }
      }
    }
  });
});

describe('cleared obstacles persist (存档记忆)', () => {
  it('clearObstacle records a namespaced key and activeObstacles drops it', () => {
    const s = createNewGame(42);
    const floor = 3;
    const before = obstaclesForFloor(s, floor);
    if (before.length === 0) return; // 这个 seed 这层没有，换下面那条钉
    const target = before[0];
    expect(isObstacleCleared(s, floor, target.x)).toBe(false);
    clearObstacle(s, floor, target.x);
    expect(isObstacleCleared(s, floor, target.x)).toBe(true);
    expect(obstacleKey(floor, target.x)).toBe(`obstacle:${floor}:${target.x}`);
    expect(activeObstacles(s, floor).some((o) => o.x === target.x)).toBe(false);
    expect(activeObstacles(s, floor).length).toBe(before.length - 1);
    // 全集照旧返回（残骸还在那儿），只是不再是 active
    expect(obstaclesForFloor(s, floor)).toEqual(before);
  });

  it('clearObstacle is idempotent — one key, never a duplicate', () => {
    const s = createNewGame(42);
    const list = obstaclesForFloor(s, 3);
    if (list.length === 0) return;
    clearObstacle(s, 3, list[0].x);
    clearObstacle(s, 3, list[0].x);
    const keys = s.visitedFloors[3].lootedItems.filter((k) => k.startsWith('obstacle:'));
    expect(keys).toEqual([`obstacle:3:${list[0].x}`]);
  });

  it('a dug obstacle survives a save round-trip (回层不复活)', () => {
    const s = createNewGame(2026);
    const list = obstaclesForFloor(s, 5);
    if (list.length === 0) return;
    clearObstacle(s, 5, list[0].x);
    const back = deserialize(serialize(s));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(validateGameState(back.state)).toEqual([]); // obstacle 键过存档校验
    expect(isObstacleCleared(back.state, 5, list[0].x)).toBe(true);
    expect(activeObstacles(back.state, 5).some((o) => o.x === list[0].x)).toBe(false);
  });

  it('the obstacle key space never collides with container or bunk keys', () => {
    const s = createNewGame(42);
    const visit = recordFloorVisit(s, 3);
    visit.openedContainers.push('cabinet');
    visit.lootedItems.push('c:cabinet:clean_water', 'bunksearch:3:dorm_bed_1_236:1', 'bunkgone:3:dorm_bed_1_236');
    clearObstacle(s, 3, 700);
    expect(visit.lootedItems.filter((k) => k.startsWith('obstacle:'))).toEqual(['obstacle:3:700']);
    expect(visit.lootedItems).toHaveLength(4); // 三把旧键 + 一把新键，互不覆盖
  });
});

describe('clampXAgainstObstacles — 移动被拦在占位区之外', () => {
  const wall: FloorObstacle[] = [{ kind: 'rubble', x: 600 }];

  it('stops the player at the near edge from the left', () => {
    expect(clampXAgainstObstacles(wall, 560, 590)).toBe(600 - HALF);
    expect(clampXAgainstObstacles(wall, 560, 601)).toBe(600 - HALF);
  });

  it('stops the player at the far edge from the right', () => {
    expect(clampXAgainstObstacles(wall, 640, 610)).toBe(600 + HALF);
    expect(clampXAgainstObstacles(wall, 640, 599)).toBe(600 + HALF);
  });

  it('a landing inside the block leaves by the nearer side', () => {
    expect(clampXAgainstObstacles(wall, 590, 590)).toBe(600 - HALF); // 偏左：从左边出
    expect(clampXAgainstObstacles(wall, 612, 612)).toBe(600 + HALF); // 偏右：从右边出
    expect(clampXAgainstObstacles(wall, 600, 600)).toBe(600 - HALF); // 正中间：取左（相等时 lo）
  });

  it('lets anything outside the block through untouched', () => {
    expect(clampXAgainstObstacles(wall, 100, 200)).toBe(200);
    expect(clampXAgainstObstacles(wall, 900, 800)).toBe(800);
    expect(clampXAgainstObstacles(wall, 100, 100)).toBe(100);
    expect(clampXAgainstObstacles([], 100, 590)).toBe(590); // 没有阻碍物的楼层
  });

  it('holds against two obstacles in sequence', () => {
    const two: FloorObstacle[] = [{ kind: 'rubble', x: 400 }, { kind: 'gate', x: 900 }];
    expect(clampXAgainstObstacles(two, 360, 380)).toBe(400 - HALF);
    expect(clampXAgainstObstacles(two, 940, 920)).toBe(900 + HALF);
    expect(clampXAgainstObstacles(two, 500, 600)).toBe(600); // 两者之间自由通行
  });
});

describe('nearestObstacle — E 的距离判官', () => {
  const list: FloorObstacle[] = [{ kind: 'rubble', x: 500 }, { kind: 'gate', x: 900 }];

  it('picks the closest within reach', () => {
    expect(nearestObstacle(list, 480, 44)?.x).toBe(500);
    expect(nearestObstacle(list, 920, 44)?.x).toBe(900);
  });

  it('reports nothing out of reach', () => {
    expect(nearestObstacle(list, 200, 44)).toBeNull();
    expect(nearestObstacle([], 500, 44)).toBeNull();
  });
});

describe('obstacleTool — 有解：铲子或撬棍', () => {
  it('names the shovel when the player has one', () => {
    const s = createNewGame(42);
    addItem(s.player.inventory, asItemId('shovel'), 1);
    expect(obstacleTool(s.player.inventory)).toBe('shovel');
  });

  it('falls back to the crowbar (3 层铁箱 guaranteed，早期楼层也摸得到)', () => {
    const s = createNewGame(42);
    addItem(s.player.inventory, 'crowbar', 1);
    expect(obstacleTool(s.player.inventory)).toBe('crowbar');
  });

  it('is null with bare hands — E 会说需要什么', () => {
    const s = createNewGame(42);
    expect(obstacleTool(s.player.inventory)).toBeNull();
    expect(countItem(s.player.inventory, asItemId('shovel'))).toBe(0);
  });

  it('the shovel is craft-only: no floor template or loot pool may carry it', () => {
    // survivalBalance 的「每层恰好一瓶 guaranteed 水 + 一份食物」钉死在前，
    // 战利品里加一件工具会改写掉落曲线——铲子只能做出来。
    const s = createNewGame(42);
    for (const floor of PLAYABLE_FLOORS_V01) {
      const view = getFloorView(s, floor);
      for (const c of view.containers) {
        for (const stack of c.items) expect(stack.itemId).not.toBe('shovel');
      }
      for (const g of view.groundItems) expect(g.itemId).not.toBe('shovel');
    }
  });
});
