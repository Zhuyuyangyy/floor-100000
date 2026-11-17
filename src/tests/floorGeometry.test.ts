import { describe, expect, it } from 'vitest';

import {
  DOWN_EXIT_X,
  FLOOR_GEOMETRY_BALANCE,
  FLOOR_WIDTH,
  PLAYABLE_FLOORS_V01,
  ROOM_WIDTH,
  UP_EXIT_X,
  downExitXFor,
  floorKeepClearXs,
  floorWidthFor,
  roomCountFor,
  tierOfFloor,
  upExitXFor,
} from '../core/constants';
import { floorGeometryFor, floorHoleFor, floorMidLadderFor } from '../core/worldgen';
import { stairTraversalFor } from '../systems/FloorSystem';
import { createNewGame } from '../core/gameState';
import type { GameState } from '../core/gameTypes';

// AG-65 楼层几何（2026-11-17 用户原话）：
//   「其实每一层宽度长度都不一样，不能一样，有的长知道不」
//   「梯子的位置也不是说一定是起点和终点」
//   「每一层都不要做的那么平滑，可以在中间加个梯子啥的，或者楼上面有个洞
//    可以看到上面一层的情况，不过这个是比较少的」
//
// 三条契约各有守界对象：
//   1. tier1（1-10 层）整体保持现值——floorSystem/stairsArt/uiLayout 与首章
//      e2e 钉着 1240 / UP_EXIT_X / 4 房 1280，基础发育区不许动。
//   2. tier2+ 的层长与下行口是楼层号的纯函数（seeded，不用全局随机源）：
//      同层每次进同一个答案（爬上去再爬回来梯子还在原地），且下行口避开
//      容器/地面物资/床铺/上梯口/电梯——玩家按 E 爬的是梯不是箱子。
//   3. 洞与中梯「比较少」（各 15%），位置同样 seeded 同层同答案。

const TIER2_PLUS = PLAYABLE_FLOORS_V01.filter((f) => tierOfFloor(f) >= FLOOR_GEOMETRY_BALANCE.stairRandomFromTier);

const SEGMENTS: ReadonlyArray<{ name: string; floors: readonly number[] }> = [
  { name: '贫民区 1-10', floors: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  { name: '工人宿舍 100-110', floors: [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110] },
  { name: '工业区 1000-1010', floors: [1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010] },
  { name: '中产区 10000-10010', floors: [10000, 10001, 10002, 10003, 10004, 10005, 10006, 10007, 10008, 10009, 10010] },
  { name: '富人区 50000-50010', floors: [50000, 50001, 50002, 50003, 50004, 50005, 50006, 50007, 50008, 50009, 50010] },
];

describe('tier1（1-10 层）保持现值', () => {
  it('每一层都是 4 房 1280，下行口仍在右端', () => {
    for (const floor of SEGMENTS[0].floors) {
      expect(roomCountFor(floor), `floor ${floor} rooms`).toBe(4);
      expect(floorWidthFor(floor), `floor ${floor} width`).toBe(FLOOR_WIDTH);
      expect(downExitXFor(floor), `floor ${floor} downX`).toBe(DOWN_EXIT_X);
      expect(upExitXFor(floor), `floor ${floor} upX`).toBe(UP_EXIT_X);
    }
  });

  it('爬梯起止点也还是常量（存量 e2e 按 40/1240 走位）', () => {
    const state = createNewGame(1);
    state.currentFloor = 3;
    const up = stairTraversalFor(state, 1);
    expect(up).toMatchObject({ startX: UP_EXIT_X, endX: UP_EXIT_X });
    const down = stairTraversalFor(state, -1);
    expect(down).toMatchObject({ startX: DOWN_EXIT_X, endX: DOWN_EXIT_X });
  });
});

describe('tier2+ 楼层长度不一', () => {
  it('同阶层内至少两种不同层长，全塔四种以上', () => {
    for (const seg of SEGMENTS.slice(1)) {
      const widths = new Set(seg.floors.map((f) => floorWidthFor(f)));
      expect(widths.size, `${seg.name}: distinct widths`).toBeGreaterThanOrEqual(2);
    }
    const all = new Set(TIER2_PLUS.map((f) => floorWidthFor(f)));
    expect(all.size, 'tier2+ 全塔层长种类').toBeGreaterThanOrEqual(4);
  });

  it('层长 = 房间数 × ROOM_WIDTH，房间数在 [base, base+spread] 内', () => {
    for (const floor of TIER2_PLUS) {
      // base 与 constants.ts 的 ROOMS_BY_TIER 同表（那里不导出，这里镜像；
      // 表本身由下面的数值快照逐层钉死）。
      const BASE_BY_TIER: Record<number, number> = { 1: 4, 2: 5, 3: 6, 4: 7, 5: 8, 6: 9 };
      const tier = tierOfFloor(floor);
      const rooms = roomCountFor(floor);
      const spread = FLOOR_GEOMETRY_BALANCE.roomSpreadByTier[tier] ?? 0;
      expect(rooms, `floor ${floor} rooms`).toBeGreaterThanOrEqual(BASE_BY_TIER[tier]);
      expect(rooms, `floor ${floor} rooms`).toBeLessThanOrEqual(BASE_BY_TIER[tier] + spread);
      expect(floorWidthFor(floor), `floor ${floor} width`).toBe(rooms * ROOM_WIDTH);
    }
  });

  it('段内多数楼层的下行口互不相同（随机化真的在起作用）', () => {
    for (const seg of SEGMENTS.slice(1)) {
      const xs = seg.floors.map((f) => downExitXFor(f));
      const distinct = new Set(xs).size;
      expect(distinct / xs.length, `${seg.name}: distinct down exits`).toBeGreaterThanOrEqual(0.5);
    }
  });
});

describe('tier2+ 梯子位置不固定', () => {
  it('下行口落在楼层中段（30%..75%），离两端至少一个边距', () => {
    const { stairEdgeMarginPx, stairBandLowPct, stairBandHighPct } = FLOOR_GEOMETRY_BALANCE;
    for (const floor of TIER2_PLUS) {
      const width = floorWidthFor(floor);
      const x = downExitXFor(floor);
      const lo = Math.max(stairEdgeMarginPx, Math.round(width * stairBandLowPct));
      const hi = Math.min(width - stairEdgeMarginPx, Math.round(width * stairBandHighPct));
      expect(x, `floor ${floor} downX below band`).toBeGreaterThanOrEqual(lo);
      expect(x, `floor ${floor} downX above band`).toBeLessThanOrEqual(hi);
    }
  });

  it('下行口避开容器/地面物资/床铺/上梯口/电梯（最小间距达标，没有退回兜底）', () => {
    const keepClear = FLOOR_GEOMETRY_BALANCE.stairKeepClearPx;
    for (const floor of TIER2_PLUS) {
      const x = downExitXFor(floor);
      for (const taken of floorKeepClearXs(floor)) {
        expect(Math.abs(taken - x), `floor ${floor} downX vs taken ${taken}`).toBeGreaterThanOrEqual(keepClear);
      }
    }
  });

  it('爬梯起止点取楼层实际口位（画在哪就从哪按 E）', () => {
    for (const floor of [102, 101, 105, 1000, 10005, 50010, 100000]) {
      const state = createNewGame(1);
      state.currentFloor = floor;
      const down = stairTraversalFor(state, -1);
      if (down) {
        expect(down.startX, `floor ${floor} down startX`).toBe(floorGeometryFor(floor).downX);
        expect(down.endX, `floor ${floor} down endX`).toBe(floorGeometryFor(floor).downX);
      }
      const up = stairTraversalFor(state, 1);
      if (up) {
        expect(up.startX, `floor ${floor} up startX`).toBe(UP_EXIT_X);
        expect(up.endX, `floor ${floor} up endX`).toBe(UP_EXIT_X);
      }
    }
  });
});

describe('楼板洞与中梯（少见）', () => {
  const withHoles = PLAYABLE_FLOORS_V01.filter((f) => floorHoleFor(f) !== null);
  const withLadders = PLAYABLE_FLOORS_V01.filter((f) => floorMidLadderFor(f) !== null);

  it('全塔各只有约一成半的楼层有（用户：这个是比较少的）', () => {
    expect(withHoles.length).toBeGreaterThanOrEqual(3);
    expect(withHoles.length).toBeLessThanOrEqual(PLAYABLE_FLOORS_V01.length * 0.3);
    expect(withLadders.length).toBeGreaterThanOrEqual(3);
    expect(withLadders.length).toBeLessThanOrEqual(PLAYABLE_FLOORS_V01.length * 0.3);
  });

  it('位置都在楼层中段（25%..75%），不在两端', () => {
    for (const floor of [...withHoles, ...withLadders]) {
      const width = floorWidthFor(floor);
      const x = floorGeometryFor(floor).holeX ?? floorGeometryFor(floor).midLadderX;
      expect(x).not.toBeNull();
      if (x === null) continue;
      expect(x, `floor ${floor} feature x`).toBeGreaterThanOrEqual(Math.round(width * 0.25));
      expect(x, `floor ${floor} feature x`).toBeLessThanOrEqual(Math.round(width * 0.75));
    }
  });

  it('洞避开两个交通梯口', () => {
    const clear = FLOOR_GEOMETRY_BALANCE.holeStairClearPx;
    for (const floor of withHoles) {
      const geo = floorGeometryFor(floor);
      expect(Math.abs(geo.upX - (geo.holeX ?? 0))).toBeGreaterThanOrEqual(clear);
      expect(Math.abs(geo.downX - (geo.holeX ?? 0))).toBeGreaterThanOrEqual(clear);
    }
  });

  it('中梯避开容器/梯口/电梯，也不和洞叠在一起', () => {
    const clear = FLOOR_GEOMETRY_BALANCE.midLadderKeepClearPx;
    for (const floor of withLadders) {
      const geo = floorGeometryFor(floor);
      const x = geo.midLadderX ?? 0;
      for (const taken of [...floorKeepClearXs(floor), geo.downX]) {
        expect(Math.abs(taken - x), `floor ${floor} ladder vs taken ${taken}`).toBeGreaterThanOrEqual(clear);
      }
      if (geo.holeX !== null) expect(Math.abs(geo.holeX - x)).toBeGreaterThanOrEqual(clear);
    }
  });
});

describe('seeded 同层同答案（爬上去再爬回来，梯子还在原地）', () => {
  it('同一个楼层号两次读出同一个几何', () => {
    for (const floor of PLAYABLE_FLOORS_V01) {
      expect(floorGeometryFor(floor)).toEqual(floorGeometryFor(floor));
      expect(downExitXFor(floor)).toBe(downExitXFor(floor));
      expect(floorWidthFor(floor)).toBe(floorWidthFor(floor));
    }
  });

  it('floorGeometryFor 的字段与低层读数同源', () => {
    for (const floor of PLAYABLE_FLOORS_V01) {
      const geo = floorGeometryFor(floor);
      expect(geo.width).toBe(floorWidthFor(floor));
      expect(geo.rooms).toBe(roomCountFor(floor));
      expect(geo.upX).toBe(upExitXFor(floor));
      expect(geo.downX).toBe(downExitXFor(floor));
    }
  });

  it('上行口恒为 UP_EXIT_X（存量测试把 40 钉成每层的上楼梯口）', () => {
    for (const floor of PLAYABLE_FLOORS_V01) {
      expect(upExitXFor(floor)).toBe(UP_EXIT_X);
    }
  });
});

// 当前推导的完整快照。调 config/game-balance.json 的 floorGeometry 段或种子
// 标签时刻意更新本表——它是「一次调试改动不会悄悄搬动全塔梯子」的钉子，
// 与 worldgen.test.ts 钉 ENVIRONMENT_ANCHORS 读数同一种守界。
describe('几何数值表（当前推导快照）', () => {
  const TABLE: ReadonlyArray<[number, number, number, number, number | null, number | null]> = [
    // floor, rooms, width, downX, holeX, midLadderX
    [1, 4, 1280, 1240, null, null],
    [2, 4, 1280, 1240, null, null],
    [3, 4, 1280, 1240, null, null],
    [4, 4, 1280, 1240, null, null],
    [5, 4, 1280, 1240, null, null],
    [6, 4, 1280, 1240, null, null],
    [7, 4, 1280, 1240, null, null],
    [8, 4, 1280, 1240, null, null],
    [9, 4, 1280, 1240, 464, null],
    [10, 4, 1280, 1240, 744, null],
    [100, 6, 1920, 1296, null, 672],
    [101, 7, 2240, 1648, null, 784],
    [102, 5, 1600, 496, null, null],
    [103, 5, 1600, 544, 840, null],
    [104, 7, 2240, 1360, null, null],
    [105, 7, 2240, 1328, null, null],
    [106, 5, 1600, 608, null, 1000],
    [107, 7, 2240, 984, null, 1592],
    [108, 7, 2240, 680, null, null],
    [109, 6, 1920, 616, 1008, null],
    [110, 6, 1920, 648, null, null],
    [1000, 7, 2240, 984, null, null],
    [1001, 7, 2240, 824, 1040, null],
    [1002, 6, 1920, 776, 1296, null],
    [1003, 6, 1920, 1064, null, null],
    [1004, 7, 2240, 1400, null, null],
    [1005, 7, 2240, 1280, null, null],
    [1006, 7, 2240, 976, null, null],
    [1007, 7, 2240, 824, null, null],
    [1008, 7, 2240, 1312, null, null],
    [1009, 6, 1920, 776, null, null],
    [1010, 6, 1920, 768, null, null],
    [10000, 7, 2240, 904, null, 1448],
    [10001, 8, 2560, 1304, null, 1664],
    [10002, 9, 2880, 1528, null, null],
    [10003, 8, 2560, 976, null, null],
    [10004, 9, 2880, 1008, null, null],
    [10005, 7, 2240, 712, null, null],
    [10006, 9, 2880, 1960, null, null],
    [10007, 9, 2880, 2088, null, null],
    [10008, 7, 2240, 824, null, null],
    [10009, 7, 2240, 936, null, null],
    [10010, 9, 2880, 1768, 2072, 1648],
    [50000, 10, 3200, 1848, null, null],
    [50001, 8, 2560, 1280, null, null],
    [50002, 8, 2560, 960, null, null],
    [50003, 9, 2880, 952, 1688, null],
    [50004, 8, 2560, 920, null, null],
    [50005, 10, 3200, 2048, null, 1496],
    [50006, 10, 3200, 2136, null, null],
    [50007, 9, 2880, 1568, null, null],
    [50008, 8, 2560, 952, null, null],
    [50009, 10, 3200, 1952, null, null],
    [50010, 10, 3200, 2040, null, null],
    [100000, 9, 2880, 992, null, null],
  ];

  it('逐层吻合', () => {
    expect(TABLE.length).toBe(PLAYABLE_FLOORS_V01.length);
    for (const [floor, rooms, width, downX, holeX, midLadderX] of TABLE) {
      const geo = floorGeometryFor(floor);
      expect({ floor, rooms: geo.rooms, width: geo.width, downX: geo.downX, holeX: geo.holeX, midLadderX: geo.midLadderX })
        .toEqual({ floor, rooms, width, downX, holeX, midLadderX });
    }
  });

  it('表内 tier2+ 的下行口没有全表撞车（段内多数不同已单独断言）', () => {
    const xs = TABLE.filter(([floor]) => tierOfFloor(floor) >= 2).map(([, , , downX]) => downX);
    expect(new Set(xs).size).toBeGreaterThan(xs.length * 0.5);
  });
});

// 场景侧集成：爬梯态目标层画在出发口正下方（drawNeighbourFloor 的 landingX），
// 落地姿势必须仍落在目标层可走带——AG-52 的几何契约在口位随机后依然成立。
describe('爬梯行程与楼层实际口位一致', () => {
  it('下行：起止同 x（竖井跨两层一条 x），落点在目标层可走带', () => {
    for (const floor of [102, 105, 1002, 10005, 50009]) {
      const state: GameState = createNewGame(1);
      state.currentFloor = floor;
      const down = stairTraversalFor(state, -1);
      expect(down, `floor ${floor} has a down stair`).not.toBeNull();
      if (!down) continue;
      expect(down.startX).toBe(floorGeometryFor(floor).downX);
      expect(down.endX).toBe(down.startX);
      // 目标层画在 +FLOOR_HEIGHT，可走带 = [yOffset+136, yOffset+200]
      expect(down.endY).toBeGreaterThanOrEqual(200 + 136);
      expect(down.endY).toBeLessThanOrEqual(200 + 200);
    }
  });
});
