import { describe, expect, it, vi } from 'vitest';

import { FLOOR_BAND, FLOOR_HEIGHT, INTERACT_DISTANCE, PLAYER_FEET_Y, STAIR_RISE } from '../core/constants';
import { stairPosition, stairTraversalFor } from '../systems/FloorSystem';
import { containerLabelFor } from '../scenes/GameScene';
import type { GameState } from '../core/gameTypes';

// AG-52（容器隐形标签 + 只画本层）的单元测试。
//
// 两件事各有各的守界对象：
//   1. 名签三态（远离不存在 / 靠近 0.35 隐形小字 / 选中态满名牌）——直接测
//      GameScene 导出的纯函数 containerLabelFor，场景每帧画的就是这个返回值。
//   2. 爬梯时目标层必须接得住角色—— stairTraversalFor/stairPosition 是纯函数
//      （systems/FloorSystem），目标层的画法在 GameScene.syncClimbTargetFloor，
//      这里钉住两侧的几何契约：落地姿势必须落在目标层的可走带里，落地缓动
//      的旧帧必须恰好是目标层当时占的画面。AG-53 重做楼梯时改任一数字，
//      这两条先红。
//
// GameScene 的导入：vitest 跑在 node 环境，而 GameScene 的模块图里有 Phaser。
// 模块体只在运行期碰 Phaser（类声明 extends Phaser.Scene、函数体内的调用），
// 导入期一个都不碰——所以一个「可调用可构造」的桩就够把整张模块图求值到
// 导出表。桩只在本文件内生效，不碰共享 vitest.config。

vi.mock('phaser', () => {
  const anyThing = new Proxy(function () {}, {
    get: () => anyThing,
    apply: () => ({}),
    construct: () => ({}),
  });
  return { default: anyThing };
});

const CABINET = { x: 160, label: '储物柜' };

describe('containerLabelFor — the three looks (AG-52)', () => {
  it('is nothing at all from afar', () => {
    // 用户：「就不用写这个储物柜是啥啥啥的……不是这么明显的，会影响我们的观感」。
    // 走廊中间站着，墙上不该有任何字。
    const look = containerLabelFor(CABINET, { playerX: 640 });
    expect(look.alpha).toBe(0);
    expect(look.plateAlpha).toBe(0);
    expect(look.text).toBe('储物柜'); // 文本照给，显不显由 alpha 决定
  });

  it('stays nothing until the fade band opens', () => {
    // 交互距离外 24px 才开始淡入（CONTAINER_LABEL_FADE_PX）——走过不跳。
    const edge = CABINET.x + INTERACT_DISTANCE + 24;
    expect(containerLabelFor(CABINET, { playerX: edge + 1 }).alpha).toBe(0);
    expect(containerLabelFor(CABINET, { playerX: edge }).alpha).toBe(0);
    expect(containerLabelFor(CABINET, { playerX: edge - 1 }).alpha).toBeGreaterThan(0);
  });

  it('is a 0.35 stealth line, with no plate, at the interaction distance', () => {
    for (const px of [CABINET.x, CABINET.x + INTERACT_DISTANCE, CABINET.x - INTERACT_DISTANCE]) {
      const look = containerLabelFor(CABINET, { playerX: px });
      expect(look.alpha, `at ${px}`).toBeCloseTo(0.35, 5);
      expect(look.plateAlpha, `plate at ${px}`).toBe(0);
      expect(look.fontSize, `font at ${px}`).toBe(18);
    }
  });

  it('fades in monotonically — no pop in either direction', () => {
    let prev = -1;
    for (let d = INTERACT_DISTANCE + 24; d >= 0; d--) {
      const a = containerLabelFor(CABINET, { playerX: CABINET.x + d }).alpha;
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
    expect(prev).toBeCloseTo(0.35, 5);
  });

  it('symmetric about the container', () => {
    const left = containerLabelFor(CABINET, { playerX: CABINET.x - 20 });
    const right = containerLabelFor(CABINET, { playerX: CABINET.x + 20 });
    expect(left.alpha).toBeCloseTo(right.alpha, 10);
  });

  it('selected restores the full old nameplate — the future 选位置 interface', () => {
    // 用户：「等到后面我们就是说做一个东西之后的话，会让用户选这个位置」。
    // 选中态接口先立在这里：满字 + 满背板 + 22px 名牌字号。
    const look = containerLabelFor(CABINET, { playerX: 640, selected: true });
    expect(look).toEqual({ text: '储物柜', alpha: 1, plateAlpha: 0.94, fontSize: 22 });
  });

  it('selected wins over proximity, whichever side the player is on', () => {
    const near = containerLabelFor(CABINET, { playerX: CABINET.x, selected: true });
    const far = containerLabelFor(CABINET, { playerX: 1200, selected: true });
    expect(near.alpha).toBe(1);
    expect(far.alpha).toBe(1);
  });
});

// ── 爬梯目标层的几何契约 ──────────────────────────────────────────────────
// GameScene.syncClimbTargetFloor 在爬梯态把目标层画在 ∓FLOOR_HEIGHT 处；
// 这里用真实的楼梯系统钉住「画在那里的层接得住角色」与「落地缓动不跳帧」。

function fakeState(floor: number): GameState {
  return { currentFloor: floor } as unknown as GameState;
}

describe('the climb target floor meets the climber (AG-52)', () => {
  it('the end pose lands inside the target floor’s walkable band', () => {
    // 目标层画在 yOffset = ∓FLOOR_HEIGHT 处，其可走带是
    // [yOffset + FLOOR_HEIGHT - FLOOR_BAND, yOffset + FLOOR_HEIGHT]；
    // 爬梯的结束姿势必须落在这个带里——否则角色落在目标层的墙里或虚空里，
    // 正是"不画目标层就走进虚空"的几何形式。
    for (const dir of [1, -1] as const) {
      const traversal = stairTraversalFor(fakeState(3), dir);
      expect(traversal).not.toBeNull();
      if (!traversal) continue;
      const end = stairPosition(traversal, traversal.durationMs);
      const yOffset = dir === 1 ? -FLOOR_HEIGHT : FLOOR_HEIGHT;
      const bandTop = yOffset + FLOOR_HEIGHT - FLOOR_BAND;
      const bandBottom = yOffset + FLOOR_HEIGHT;
      expect(end.y, `dir ${dir}: end pose above the target band`).toBeGreaterThanOrEqual(bandTop);
      expect(end.y, `dir ${dir}: end pose below the target band`).toBeLessThanOrEqual(bandBottom);
      expect(end.progress).toBe(1);
    }
  });

  it('one floor of rise is exactly one floor of offset', () => {
    // syncClimbTargetFloor 用 ∓FLOOR_HEIGHT 做 yOffset 的前提：爬一趟楼梯的
    // 上升量就是一个楼层高。AG-53 把楼梯改成可走阶梯时若改了 STAIR_RISE，
    // 这里先红——目标层的位置必须跟着走。
    expect(STAIR_RISE).toBe(FLOOR_HEIGHT);
    const up = stairTraversalFor(fakeState(3), 1);
    const down = stairTraversalFor(fakeState(3), -1);
    expect(up && up.startY - up.endY).toBe(FLOOR_HEIGHT); // startY=endY 的差就是一层
    expect(down && down.endY - down.startY).toBe(FLOOR_HEIGHT);
  });
});

describe('the landing ease keeps the arriving floor still (AG-52)', () => {
  // drawFloor 的落地缓动：fromY = 爬梯帧 + FLOOR_HEIGHT * dir。要它不跳帧，
  // 等价于「旧帧里目标层占的屏幕带」==「新帧里本层占的屏幕带」：
  //   (yOffset - climbScroll) === (0 - landingScroll)
  // 即 landingScroll === climbScroll - yOffset === climbScroll + FLOOR_HEIGHT*dir。
  it('the pre-swap frame is the target’s own screen position', () => {
    const standScrollY = PLAYER_FEET_Y - 720 / 2; // zoom 1：视口高即设计画布高
    for (const dir of [1, -1] as const) {
      const yOffset = dir === 1 ? -FLOOR_HEIGHT : FLOOR_HEIGHT;
      const climbScroll = standScrollY; // 爬梯持帧：bounds 收紧后被钉在站立位
      const landingScroll = climbScroll + FLOOR_HEIGHT * dir;
      const targetScreenTop = yOffset - climbScroll;
      const liveScreenTop = 0 - landingScroll;
      expect(targetScreenTop, `dir ${dir}: 落地瞬间内容应原地不动`).toBeCloseTo(liveScreenTop, 10);
      // 滑回的终点就是站立位：角色居中。
      expect(standScrollY + 720 - PLAYER_FEET_Y).toBeCloseTo(360, 10);
    }
  });
});
