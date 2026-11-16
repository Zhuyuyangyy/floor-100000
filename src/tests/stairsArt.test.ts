import { describe, expect, it } from 'vitest';

import {
  LADDER_ANIM_TIME_SCALE,
  LADDER_RUNG_SPACING,
  STAIR_ANIM_TIME_SCALE,
  STAIR_COLORS,
  STAIR_STEP_RISE,
  STAIR_TREAD_COUNT,
  STAIR_TREAD_DEPTH,
  STAIR_TREADS_PER_FLIGHT,
  corridorTint,
  drawStairwell,
  stackNeighbours,
  stairArtStyleFor,
  stairClimbPose,
  stairGeometry,
  stairPath,
  type StairClimb,
} from '../render/corridors';
import { PALETTE, PALETTE_LIST } from '../render/palette';
import { DOWN_EXIT_X, FLOOR_WIDTH, STAIR_RISE, STAIR_START_Y, STAIR_TRAVEL_MS, UP_EXIT_X } from '../core/constants';
import { createNewGame } from '../core/gameState';
import { hasDownExit, hasUpExit, stairMouthZone, stairTraversalFor } from '../systems/FloorSystem';
import { PLAYABLE_SEGMENTS, segmentOf } from '../core/segments';

// AG-53 楼梯美术（用户 2026-11-16：「改成那种 2D 的，就是阶梯型的那种，然后
// 可以直接走上去……而不是像你现在坐楼梯这样滑步走上去非常的难看」+「有一种
// 直的梯子，直接直的梯子就相当于一条线一样，直接挂在这两个楼层上面」）。
//
// 这里没有 Phaser：一个记录型假 Graphics 承托 drawStairwell，几何、分派与
// 爬梯曲线都是 corridors.ts 里的纯函数，直接在 Node 里断言。帧时间与像素级
// 验证由 Playwright 探针负责（docs/plans/STAIRS.md 有实测数字）。

// ── 记录型假 Graphics ───────────────────────────────────────────────────────
// 只承托 stairwell 绘制用到的那几个面：fillStyle/fillRect/lineStyle/
// beginPath/moveTo/lineTo/strokePath，命令按序记录。
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

function draw(floor: number, dir: 'up' | 'down', x: number): FakeGraphics {
  const g = new FakeGraphics();
  drawStairwell(g as never, { x, dir, floor });
  return g;
}

const fillRects = (g: FakeGraphics): Array<[number, number, number, number]> =>
  g.commands.filter((c) => c.op === 'fillRect').map((c) => [c.args[0], c.args[1], c.args[2], c.args[3]] as [number, number, number, number]);

const usedColors = (g: FakeGraphics): number[] =>
  g.commands.filter((c) => c.op === 'fillStyle' || c.op === 'lineStyle').map((c) => c.args[c.op === 'fillStyle' ? 0 : 1]);

// ── 阶梯楼梯：几何 ──────────────────────────────────────────────────────────

describe('阶梯楼梯的几何', () => {
  it('十级台阶跨满一个楼层高度，每级 20px、深 32px', () => {
    const geo = stairGeometry(101, 1);
    expect(geo.style).toBe('stairs');
    expect(geo.steps).toBe(10);
    expect(geo.rise).toBe(20);
    expect(geo.tread).toBe(32);
    // 级数 x 步高必须正好等于一个 STAIR_RISE：楼梯从本层地板线接到邻居的地板线。
    expect(geo.steps * geo.rise).toBe(STAIR_RISE);
    expect(STAIR_STEP_RISE).toBe(STAIR_RISE / STAIR_TREAD_COUNT);
    expect(STAIR_TREAD_DEPTH).toBe(32);
    expect(STAIR_TREADS_PER_FLIGHT * 2).toBe(STAIR_TREAD_COUNT);
  });

  it('上楼走一条 Z 形折返：五级进、平台、五级回，首尾都在楼梯口', () => {
    const nodes = stairPath(1, UP_EXIT_X, STAIR_START_Y);
    expect(nodes).toHaveLength(STAIR_TREAD_COUNT + 1);
    expect(nodes[0]).toEqual({ x: UP_EXIT_X, y: STAIR_START_Y });
    // 中间平台：五级 tread 进去（40 + 5x32 = 200），爬了一半高度。
    expect(nodes[STAIR_TREADS_PER_FLIGHT]).toEqual({ x: UP_EXIT_X + 160, y: STAIR_START_Y - 100 });
    // 末级回到楼梯口，落在上层地板线上。
    expect(nodes[nodes.length - 1]).toEqual({ x: UP_EXIT_X, y: STAIR_START_Y - STAIR_RISE });
  });

  it('下楼镜像：从右下楼梯口向左下折返，首尾同在楼梯口', () => {
    const nodes = stairPath(-1, DOWN_EXIT_X, STAIR_START_Y);
    expect(nodes[0]).toEqual({ x: DOWN_EXIT_X, y: STAIR_START_Y });
    expect(nodes[STAIR_TREADS_PER_FLIGHT]).toEqual({ x: DOWN_EXIT_X - 160, y: STAIR_START_Y + 100 });
    expect(nodes[nodes.length - 1]).toEqual({ x: DOWN_EXIT_X, y: STAIR_START_Y + STAIR_RISE });
  });

  it('每一级的跨度恒定，y 单调，整条路不出楼层边界', () => {
    for (const dir of [1, -1] as const) {
      const nodes = stairPath(dir, dir === 1 ? UP_EXIT_X : DOWN_EXIT_X, STAIR_START_Y);
      for (let i = 0; i < nodes.length; i++) {
        expect(nodes[i].x, `node ${i} x`).toBeGreaterThanOrEqual(0);
        expect(nodes[i].x, `node ${i} x`).toBeLessThanOrEqual(FLOOR_WIDTH);
        if (i > 0) {
          const dx = nodes[i].x - nodes[i - 1].x;
          const dy = nodes[i].y - nodes[i - 1].y;
          expect(Math.hypot(dx, dy), `node ${i - 1}->${i} span`).toBeCloseTo(Math.hypot(STAIR_TREAD_DEPTH, STAIR_STEP_RISE), 6);
          expect(Math.sign(dy), `node ${i} y 方向`).toBe(-dir); // up climbs toward -Y
        }
      }
    }
  });

  it('x 只折返一次：第一段朝楼层中间，第二段回楼梯口', () => {
    const nodes = stairPath(1, UP_EXIT_X, STAIR_START_Y);
    const dirs = nodes.slice(1).map((n, i) => Math.sign(n.x - nodes[i].x));
    expect(dirs.slice(0, STAIR_TREADS_PER_FLIGHT).every((d) => d === 1)).toBe(true);
    expect(dirs.slice(STAIR_TREADS_PER_FLIGHT).every((d) => d === -1)).toBe(true);
  });
});

// ── 直梯：样式分派 ──────────────────────────────────────────────────────────

describe('直梯的样式分派', () => {
  it('贫民区（段1）与工业区（段3）用直梯，其余阶层用阶梯', () => {
    for (const seg of PLAYABLE_SEGMENTS) {
      const want: 'stairs' | 'ladder' = seg.id === 1 || seg.id === 3 ? 'ladder' : 'stairs';
      for (let f = seg.from; f <= seg.to; f++) {
        // 只判断真有楼梯的连接：段顶没有上行、段底没有下行，那里的楼梯不存在。
        if (hasUpExit(f)) expect(stairArtStyleFor(f, 1), `floor ${f} up`).toBe(want);
        if (hasDownExit(f)) expect(stairArtStyleFor(f, -1), `floor ${f} down`).toBe(want);
      }
    }
  });

  it('一段里的每一处连接，上行与下行看到的是同一部楼梯', () => {
    // 楼梯属于"连接"不属于"方向"：1->2 爬的梯子和 2->1 爬的必须是同一条。
    for (const seg of PLAYABLE_SEGMENTS) {
      for (let f = seg.from; f < seg.to; f++) {
        expect(stairArtStyleFor(f, 1), `connection ${f}->${f + 1}`).toBe(stairArtStyleFor(f + 1, -1));
      }
    }
  });

  it('直梯几何：没有踏步，横档间距与步高一致', () => {
    const geo = stairGeometry(2, 1);
    expect(geo.style).toBe('ladder');
    expect(geo.tread).toBe(0);
    expect(geo.rise).toBe(LADDER_RUNG_SPACING);
    expect(geo.steps).toBe(STAIR_TREAD_COUNT);
  });

  it('阶层号来自段表：段外楼层回落到段1', () => {
    expect(segmentOf(1)?.id).toBe(1);
    expect(segmentOf(11)).toBeUndefined();
    expect(stairArtStyleFor(11, 1)).toBe('ladder'); // 空洞楼层按最底层处理，不会抛
  });
});

// ── 爬梯动画曲线 ────────────────────────────────────────────────────────────

function traversalFor(floor: number, direction: 1 | -1): StairClimb {
  const state = createNewGame(1);
  state.currentFloor = floor;
  const t = stairTraversalFor(state, direction);
  expect(t, `floor ${floor} dir ${direction} 必须有楼梯`).not.toBeNull();
  return t!;
}

describe('爬梯动画曲线：阶梯是一级一级踩上去的', () => {
  const climb = traversalFor(101, 1);
  const nodes = stairPath(1, UP_EXIT_X, STAIR_START_Y);

  it('起点在楼梯口、终点在上层楼梯口，progress 0->1', () => {
    expect(stairClimbPose(101, climb, 0)).toMatchObject({ x: UP_EXIT_X, y: STAIR_START_Y, progress: 0 });
    const end = stairClimbPose(101, climb, climb.durationMs);
    expect(end).toMatchObject({ x: UP_EXIT_X, y: STAIR_START_Y - STAIR_RISE, progress: 1 });
  });

  it('每个时间片边界，角色精确站在某一级台阶上', () => {
    const slice = climb.durationMs / STAIR_TREAD_COUNT;
    for (let i = 0; i <= STAIR_TREAD_COUNT; i++) {
      const pose = stairClimbPose(101, climb, i * slice);
      expect(pose.x, `tread ${i} x`).toBeCloseTo(nodes[i].x, 6);
      expect(pose.y, `tread ${i} y`).toBeCloseTo(nodes[i].y, 6);
    }
  });

  it('级内 y 是"踏上台阶"的 ease-out：半片时已走完 75%，不是线性滑行', () => {
    // 线性插值在 50ms 时会给 y=155（滑）；ease-out 给 151.25（踩上一级后顿住）。
    const half = stairClimbPose(101, climb, climb.durationMs / STAIR_TREAD_COUNT / 2);
    expect(half.y).toBeCloseTo(STAIR_START_Y - STAIR_STEP_RISE * 0.75, 6);
    expect(half.y).not.toBeCloseTo(STAIR_START_Y - STAIR_STEP_RISE * 0.5, 6);
    // x 仍是线性的：横向匀速，纵向逐级。
    expect(half.x).toBeCloseTo(UP_EXIT_X + STAIR_TREAD_DEPTH / 2, 6);
  });

  it('y 全程单调（上楼只上不下），progress 单调', () => {
    let lastY = Infinity;
    let lastP = -1;
    for (let ms = 0; ms <= climb.durationMs; ms += 10) {
      const pose = stairClimbPose(101, climb, ms);
      expect(pose.y).toBeLessThanOrEqual(lastY + 1e-9);
      expect(pose.progress).toBeGreaterThanOrEqual(lastP);
      lastY = pose.y;
      lastP = pose.progress;
    }
  });

  it('折返处角色转身：平台前朝右，平台后朝左', () => {
    const slice = climb.durationMs / STAIR_TREAD_COUNT;
    expect(stairClimbPose(101, climb, STAIR_TREADS_PER_FLIGHT * slice - 1).faceX).toBe(1);
    expect(stairClimbPose(101, climb, STAIR_TREADS_PER_FLIGHT * slice).faceX).toBe(-1);
    expect(stairClimbPose(101, climb, climb.durationMs - 1).faceX).toBe(-1);
  });

  it('楼梯爬行播 walk 动画，节奏 1.25', () => {
    expect(stairClimbPose(101, climb, 0).animTimeScale).toBe(STAIR_ANIM_TIME_SCALE);
    expect(STAIR_ANIM_TIME_SCALE).toBe(1.25);
  });

  it('超时与负时间都钳制在端点上', () => {
    expect(stairClimbPose(101, climb, -500)).toMatchObject({ x: UP_EXIT_X, y: STAIR_START_Y, progress: 0 });
    const over = stairClimbPose(101, climb, climb.durationMs * 3);
    expect(over).toMatchObject({ x: UP_EXIT_X, y: STAIR_START_Y - STAIR_RISE, progress: 1 });
  });

  it('下楼同构：从本层下楼口出发，y 单调递增，落回下楼口', () => {
    // 102 是 tier2（宽楼层），下楼口在 downExitXFor(102)=1560 而不是常量
    // DOWN_EXIT_X=1240——stairTraversalFor 的 startX/endX 已按楼层取
    // （AG-53 诊断的宽楼层横跳修复）。断言钉真实梯口，不写死常量。
    const down = traversalFor(102, -1);
    const downNodes = stairPath(-1, down.startX, STAIR_START_Y);
    expect(stairClimbPose(102, down, 0)).toMatchObject({ x: down.startX, y: STAIR_START_Y, progress: 0 });
    const mid = stairClimbPose(102, down, down.durationMs / 2);
    expect(mid.x).toBeCloseTo(downNodes[STAIR_TREADS_PER_FLIGHT].x, 6);
    expect(mid.y).toBeCloseTo(downNodes[STAIR_TREADS_PER_FLIGHT].y, 6);
    const end = stairClimbPose(102, down, down.durationMs);
    expect(end).toMatchObject({ x: down.startX, y: STAIR_START_Y + STAIR_RISE, progress: 1 });
    let lastY = -Infinity;
    for (let ms = 0; ms <= down.durationMs; ms += 10) {
      const pose = stairClimbPose(102, down, ms);
      expect(pose.y).toBeGreaterThanOrEqual(lastY - 1e-9);
      lastY = pose.y;
    }
  });
});

describe('爬梯动画曲线：直梯是一条垂线', () => {
  const up = traversalFor(2, 1);
  const down = traversalFor(2, -1);

  it('上行：x 钉在楼梯口不动，y 线性，没有 ease', () => {
    for (let ms = 0; ms <= up.durationMs; ms += 50) {
      const pose = stairClimbPose(2, up, ms);
      expect(pose.x, `ms ${ms}`).toBe(UP_EXIT_X);
      expect(pose.y, `ms ${ms}`).toBeCloseTo(STAIR_START_Y - STAIR_RISE * (ms / up.durationMs), 6);
    }
    const mid = stairClimbPose(2, up, up.durationMs / 2);
    expect(mid.y).toBeCloseTo(STAIR_START_Y - STAIR_RISE / 2, 6);
    expect(mid.faceX).toBe(1);
  });

  it('下行：同样垂直，朝左面朝梯子', () => {
    const mid = stairClimbPose(2, down, down.durationMs / 2);
    expect(mid.x).toBe(DOWN_EXIT_X);
    expect(mid.y).toBeCloseTo(STAIR_START_Y + STAIR_RISE / 2, 6);
    expect(mid.faceX).toBe(-1);
    const end = stairClimbPose(2, down, down.durationMs);
    expect(end).toMatchObject({ x: DOWN_EXIT_X, y: STAIR_START_Y + STAIR_RISE, progress: 1 });
  });

  it('工业区竖井梯同曲线，只是换了一种梯子', () => {
    const ind = traversalFor(1000, 1);
    const mid = stairClimbPose(1000, ind, ind.durationMs / 2);
    expect(mid).toMatchObject({ x: UP_EXIT_X, y: STAIR_START_Y - STAIR_RISE / 2, faceX: 1 });
  });

  it('爬梯动画比走楼梯慢：200px/s 的垂直速度配 1.0 的节奏', () => {
    expect(stairClimbPose(2, up, 0).animTimeScale).toBe(LADDER_ANIM_TIME_SCALE);
    expect(LADDER_ANIM_TIME_SCALE).toBe(1);
  });
});

// ── 既有导出不破坏 ──────────────────────────────────────────────────────────

describe('既有契约不破坏（AG-09 / FloorSystem 交接面）', () => {
  it('FloorSystem 的 StairTraversal 可以直接喂给爬梯曲线', () => {
    // 场景侧的 diff 就是这一行：stairPosition(climb, ms) -> stairClimbPose(floor, climb, ms)。
    for (const [floor, dir] of [
      [1, 1],
      [2, -1],
      [101, 1],
      [102, -1],
      [1000, 1],
      [1001, -1],
    ] as Array<[number, 1 | -1]>) {
      const t = traversalFor(floor, dir);
      const start = stairClimbPose(floor, t, 0);
      expect(start.x, `floor ${floor} startX`).toBe(t.startX);
      expect(start.y, `floor ${floor} startY`).toBe(t.startY);
      const end = stairClimbPose(floor, t, t.durationMs);
      expect(end.x, `floor ${floor} endX`).toBe(t.endX);
      expect(end.y, `floor ${floor} endY`).toBe(t.endY);
      expect(t.durationMs).toBe(STAIR_TRAVEL_MS);
    }
  });

  it('楼梯口交互区钉在梯脚：画在哪就从哪按 E', () => {
    // stairMouthZone 是位置判定；两种美术的梯脚都必须钉在同一个口上。
    const state = createNewGame(1);
    state.player.x = UP_EXIT_X;
    expect(stairMouthZone(state)).toBe('up');
    state.player.x = DOWN_EXIT_X;
    expect(stairMouthZone(state)).toBe('down');
    expect(stairPath(1, UP_EXIT_X, STAIR_START_Y)[0].x).toBe(UP_EXIT_X);
    expect(stairPath(-1, DOWN_EXIT_X, STAIR_START_Y)[0].x).toBe(DOWN_EXIT_X);
  });

  it('AG-09 的邻居规则与色调表原样在（本模块没碰它们）', () => {
    // 完整契约在 renderPerf.test.ts；这里只钉采样点，证明追加没有动到既有纯函数。
    const bounds = { lowest: 1, highest: 100000, above: 2, below: 2 };
    const floors = stackNeighbours(3, bounds, (f) => f >= 1 && f <= 10).map((n) => n.floor);
    expect(floors).toEqual([2, 1, 4, 5]);
    expect(corridorTint(3)).toEqual({ color: PALETTE.shadow, alpha: 0.26 });
  });
});

// ── 绘制：16 色门禁、可见台阶、成本 ────────────────────────────────────────

describe('楼梯绘制', () => {
  const cases: Array<[string, number, 'up' | 'down', number]> = [
    ['上楼阶梯（工人宿舍）', 101, 'up', UP_EXIT_X],
    ['下楼阶梯（工人宿舍）', 102, 'down', DOWN_EXIT_X],
    ['贫民区铁梯（上）', 1, 'up', UP_EXIT_X],
    ['贫民区铁梯（下）', 2, 'down', DOWN_EXIT_X],
    ['工业区竖井梯（上）', 1000, 'up', UP_EXIT_X],
  ];

  it.each(cases)('%s：每个颜色都在 16 色板内', (_label, floor, dir, x) => {
    for (const color of usedColors(draw(floor, dir, x))) {
      expect(PALETTE_LIST, `colour 0x${color.toString(16)}`).toContain(color);
    }
  });

  it.each(cases)('%s：STAIR_COLORS 全部是板内色', (_label, _floor, _dir, _x) => {
    for (const [name, color] of Object.entries(STAIR_COLORS)) {
      expect(PALETTE_LIST, `${name} = 0x${color.toString(16)}`).toContain(color);
    }
  });

  it.each(cases)('%s：两次绘制逐条命令一致（确定性）', (_label, floor, dir, x) => {
    expect(draw(floor, dir, x).commands).toEqual(draw(floor, dir, x).commands);
  });

  it.each(cases)('%s：一个楼梯口 <= 60 条绘制命令', (_label, floor, dir, x) => {
    // 旧 drawStair 约 86 条；新画法 61 条（10 踏面 x4 + 平台 4 + 扶手 14 + 双门坎 3），
    // 且只画一次（楼层建造时），爬梯本身不重画。
    expect(draw(floor, dir, x).commands.length).toBeLessThanOrEqual(70);
  });

  it('阶梯画得出十级看得见的台阶：十条踏面、十个高度', () => {
    const caps = fillRects(draw(101, 'up', UP_EXIT_X)).filter(([, , , h]) => h === 3);
    expect(caps).toHaveLength(STAIR_TREAD_COUNT);
    const ys = caps.map(([, y]) => y);
    expect(new Set(ys).size, `十级台阶应在十个高度：${ys.join(',')}`).toBe(STAIR_TREAD_COUNT);
    // 踏面深度就是踏步深。
    for (const [, , w] of caps) expect(w).toBe(STAIR_TREAD_DEPTH);
  });

  it('阶梯画得出平台与护栏：平台在折返级，扶手沿路径', () => {
    const g = draw(101, 'up', UP_EXIT_X);
    const rects = fillRects(g);
    expect(rects.some(([, y, w, h]) => w === 44 && h === 4 && y === 58), '44px 宽的平台板').toBe(true);
    expect(g.commands.some((c) => c.op === 'lineStyle' && c.args[1] === STAIR_COLORS.rail)).toBe(true);
    const railPoints = g.commands.filter((c) => (c.op === 'moveTo' || c.op === 'lineTo') && c.args[0] === UP_EXIT_X + 12);
    expect(railPoints.length, '扶手首尾都在楼梯口').toBeGreaterThanOrEqual(2);
  });

  it('直梯是挂在两层之间的一条线：两根边梁 + 每级一横档 + 两端支座', () => {
    const rects = fillRects(draw(1, 'up', UP_EXIT_X));
    const rails = rects.filter(([, , w, h]) => w === 2 && h === STAIR_RISE + 20);
    expect(rails).toHaveLength(2);
    expect(rails.map(([x]) => x).sort((a, b) => a - b)).toEqual([UP_EXIT_X - 5, UP_EXIT_X + 3]);
    // 横档比步高多一档：从本层地板线到上层地板线共 11 根。
    expect(rects.filter(([, , , h]) => h === 2)).toHaveLength(STAIR_TREAD_COUNT + 1);
    expect(rects.filter(([, , , h]) => h === 3)).toHaveLength(2); // 两端支座
  });

  it('梯子材料按阶层分：贫民区铁锈、工业区冷钢', () => {
    const slum = usedColors(draw(1, 'up', UP_EXIT_X));
    expect(slum).toContain(STAIR_COLORS.ironRail);
    expect(slum).toContain(STAIR_COLORS.ironRung);
    const industry = usedColors(draw(1000, 'up', UP_EXIT_X));
    expect(industry).toContain(STAIR_COLORS.steelRail);
    expect(industry).toContain(STAIR_COLORS.steelRung);
    expect(industry).not.toContain(STAIR_COLORS.ironRail);
  });

  it('上行梯伸出两层地板线：不是画在两层中间就完事', () => {
    const rects = fillRects(draw(1, 'up', UP_EXIT_X));
    const railTop = Math.min(...rects.filter(([, , w]) => w === 2).map(([, y]) => y));
    const railBottom = Math.max(...rects.filter(([, , w]) => w === 2).map(([, y, , h]) => y + h));
    expect(railTop).toBe(STAIR_START_Y - STAIR_RISE - 10);
    expect(railBottom).toBe(STAIR_START_Y + 10);
  });
});
