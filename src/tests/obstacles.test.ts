import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { ENTRY_X, PLAYABLE_FLOORS_V01, UP_EXIT_X, downExitXFor, floorWidthFor } from '../core/constants';
import { asItemId } from '../data/items';
import { ACTOR_DEPTH, LIGHT_DEPTH } from '../render/lighting';
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

  it('never traps the player: every landing spot has a way out (R3 口径)', () => {
    // 独立复算可达性（不借用实现的表达式）。R3 修复（2026-11-18）后的口径：
    //   - 落点 = 玩家真实会站上的 x：ENTRY_X（电梯/首入/乘梯落地）、爬梯落点
    //     40、站在自己下梯口、以及**下梯落点 downExitXFor(floor+1)**（从上层
    //     爬下时落在出发层梯口正下方——AG-65 起梯口按楼层 seeded，落点不再
    //     贴本层口位）；
    //   - self-pair 算可达：落点贴在梯口上就是出口（keepClear 保证占位区
    //     不贴口），排除 self 正是旧口径把 1-10 层清空的直接成因；
    //   - 只有**免费下行电梯**算出口——段顶上行电梯要下一段通行证，「够得
    //     着电梯但没证」仍是软锁；
    //   - 下梯落点必须够到本层下梯口（段底没有下梯：必须够到免费下行电梯）
    //     ——从那里往上爬只会绕段顶一圈落回同一点，只有向下才回得了家；
    //   - ENTRY_X 任一口子可达即可（往上绕或往下绕都回得了家）。
    // 这条与 tools/obstacle-reachability-recheck.mjs 的拓扑 BFS 互补：这里
    // 钉每层局部不变量，那边用真实楼梯/电梯图逐 seed 证明「无铲子也到得了家」。
    for (const seed of [1, 42, 2026, 7, 99, 1234, 55555, 987654, 31337]) {
      const s = createNewGame(seed);
      for (const floor of PLAYABLE_FLOORS_V01) {
        if (floor === 1) continue;
        const obstacles = obstaclesForFloor(s, floor);
        const exits: number[] = [];
        if (hasUpExit(floor)) exits.push(UP_EXIT_X);
        if (hasDownExit(floor)) exits.push(downExitXFor(floor));
        if (liftDirection(floor) === 'down') exits.push(LIFT_X);
        const checks: Array<{ at: number; must: number[] | null; why: string }> = [
          { at: ENTRY_X, must: null, why: '电梯/首入落点' },
          { at: UP_EXIT_X, must: hasUpExit(floor) ? [UP_EXIT_X] : null, why: '爬梯落点' },
        ];
        if (hasDownExit(floor)) {
          checks.push({ at: downExitXFor(floor), must: [downExitXFor(floor)], why: '站在下梯口' });
        }
        if (hasUpExit(floor)) {
          checks.push({
            at: downExitXFor(floor + 1),
            must: hasDownExit(floor)
              ? [downExitXFor(floor)]
              : liftDirection(floor) === 'down'
                ? [LIFT_X]
                : [],
            why: '下梯落点',
          });
        }
        const reachable = (from: number, to: number): boolean =>
          !obstacles.some((o) => o.x - HALF > Math.min(from, to) && o.x + HALF < Math.max(from, to));
        for (const { at, must, why } of checks) {
          expect(
            (must ?? exits).some((to) => reachable(at, to)),
            `seed ${seed} F${floor} ${why} ${at} 有出口被堵`,
          ).toBe(true);
        }
      }
    }
  });

  it('hosts obstacles on the normal early floors across seeds (R3 回归)', () => {
    // R3（QA 第 1 轮）根因回归：旧口径「每个落点到每个其它出口都可达」把
    // 1-10 层退化成空集——摆放带整体嵌在上/下梯口的开区间里，任何阻碍物都
    // 截断那一对。修复后普通层在 30 个 seed 里应有阻碍物；1 层是宿舍按设计
    // 为空。2026-11-20 tier1 也放宽层长/口位后，个别层（如 7 层下行口中段
    // 392，摆放带 [130,302] 被容器/落点挤满）合法地放不下障碍——R3 守的是
    // 「不全空」，不是「每层必有一个」，故改钉「多数层有 + 总数可观」。
    const perFloor: Record<number, number> = {};
    for (let seed = 1; seed <= 30; seed++) {
      const s = createNewGame(seed);
      for (let floor = 2; floor <= 9; floor++) {
        perFloor[floor] = (perFloor[floor] ?? 0) + obstaclesForFloor(s, floor).length;
      }
      expect(obstaclesForFloor(s, 1), `seed ${seed} 宿舍不过道`).toEqual([]);
    }
    const hosted = Object.values(perFloor).filter((n) => n > 0).length;
    expect(hosted, `2-9 层多数应有阻碍物（实测 ${hosted}/8）`).toBeGreaterThanOrEqual(6);
    expect(Object.values(perFloor).reduce((a, b) => a + b, 0), '早期层总阻碍物数').toBeGreaterThan(100);
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
    // 阈值历史：集成轮把可达性口径加强为「每个落点到每个其它出口」后，跨
    // seed 密度从 >20 降到实测 13（全落 50000 层），阈值随口径调到 10——
    // 那正是 R3 的病象（正常楼层数学上不可达）。R3 修复（2026-11-18，口径
    // 回到「每个落点至少一个出口可达」）后密度回到 ~2000，这里只钉「两种
    // 类型都出现、密度确实存在」，不钉具体总数。
    expect(total).toBeGreaterThanOrEqual(10);
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

describe('阻碍物 depth 接线（QA-3 收官视觉洞防回归）', () => {
  // AG-96 上线即有：阻碍物 graphics 建在默认 depth 0，2 层前排室友床铺在
  // depth 4，瓦砾整堆被床压住——玩家看见床，不知道墙边有东西要挖。修法是把
  // 阻碍物画到演员层（ACTOR_DEPTH）。这里用源码断言钉住接线与层序关系：
  // 压过床铺，但不越过灯光/前景剪影/HUD，角色与高亮的相对关系不变。
  it('阻碍物 graphics 上演员层：压过床铺，不越过灯光与前景', () => {
    // RC-03 拆分第 10 步：阻碍物的名册与绘制本体随交互段迁入
    // InteractionController（buildObstacles/drawObstacle），depth 接线的源码
    // 断言跟着搬家——契约不断言来源（同 restartSafe 第 3/7 步先例）。
    const src = readFileSync(join(process.cwd(), 'src/scenes/controllers/InteractionController.ts'), 'utf8');
    const build = src.slice(src.indexOf('buildObstacles(): void {'), src.indexOf('private drawObstacle('));
    expect(build, 'buildObstacles 必须给阻碍物 graphics 显式 setDepth').toContain('this.host.add.graphics().setDepth(ACTOR_DEPTH)');
    // 前排室友床铺的 depth 仍从 GameScene 源码自读（drawDormBeds 前排分支留
    // 场景——世界渲染不随交互迁出），改床高测试自动跟随。
    const sceneSrc = readFileSync(join(process.cwd(), 'src/scenes/GameScene.ts'), 'utf8');
    const bedDepth = Number(/env-bunk-sleeper'\)\.setOrigin\(0\.5, 1\)\.setDepth\((\d+)\)/.exec(sceneSrc)?.[1]);
    expect(Number.isFinite(bedDepth), 'drawDormBeds 前排床铺的 setDepth 可解析').toBe(true);
    expect(ACTOR_DEPTH, '阻碍物必须压过床铺（家具层）').toBeGreaterThan(bedDepth);
    expect(ACTOR_DEPTH, '但不能越过灯光层').toBeLessThan(LIGHT_DEPTH);
  });
});
