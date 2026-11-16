import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { GAME_CONFIG } from '../core/config';
import { PLAYER_ACCELERATION, PLAYER_DECELERATION, PLAYER_SPEED } from '../core/constants';
import { stepHorizontalSpeed } from '../systems/FloorSystem';

// AG-50（鼠标/触屏操控）单测镜像。浏览器层的实测由 e2e 探针负责（单点走
// 到达、双击跑更快到达、跑动画在播、爬梯不卡），本文件钉死三件在 Node 下
// 可证的事情：
//   ① 平衡数值（config/game-balance.json 的 movement 块）；
//   ② 双击判定与跑速/回落算术（与 GameScene 同款的纯函数镜像）；
//   ③ GameScene 的接线（源码断言，场景模块 import Phaser 在 Node 下会炸，
//      按 sceneWiring.test.ts 的既有做法镜像 + 读源）。
//
// 「场景的表改了，这里的数字跟着改」——镜像漂移就是红线。

const SCENE_SRC = readFileSync(join(process.cwd(), 'src/scenes/GameScene.ts'), 'utf8');

interface MovementBalance {
  doubleClickWindowMs: number;
  doubleClickMaxDistancePx: number;
  runSpeedMultiplier: number;
  runAnimTimeScale: number;
}

// 与 GameScene.ts 顶部的 readMovementBalance 同款读取（含默认值回退）。
const MOVEMENT: MovementBalance = (() => {
  const raw = (GAME_CONFIG as unknown as { movement?: Partial<MovementBalance> }).movement ?? {};
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    doubleClickWindowMs: num(raw.doubleClickWindowMs, 300),
    doubleClickMaxDistancePx: num(raw.doubleClickMaxDistancePx, 40),
    runSpeedMultiplier: num(raw.runSpeedMultiplier, 2),
    runAnimTimeScale: num(raw.runAnimTimeScale, 1.6),
  };
})();

// ── ① 平衡数值 ────────────────────────────────────────────────────────────
describe('movement balance block (AG-50)', () => {
  it('ships the authored click-to-run values', () => {
    expect(MOVEMENT.doubleClickWindowMs).toBe(300);
    expect(MOVEMENT.doubleClickMaxDistancePx).toBe(40);
    expect(MOVEMENT.runSpeedMultiplier).toBe(2);
    expect(MOVEMENT.runAnimTimeScale).toBe(1.6);
  });

  it('keeps the run strictly faster than the walk', () => {
    expect(MOVEMENT.runSpeedMultiplier).toBeGreaterThan(1);
    // 跑速 = 步速 × 倍率，不得超过 3 倍：再快角色会穿过来不及交互的容器。
    expect(MOVEMENT.runSpeedMultiplier).toBeLessThanOrEqual(3);
  });

  it('reads every run parameter out of the config, never a literal in the scene', () => {
    // GameScene 里出现裸 260 / 裸 1.6 之类的手搓数值即为漂移。
    expect(SCENE_SRC).not.toMatch(/\*\s*2\s*;?\s*\/\/[^\n]*跑/);
    expect(SCENE_SRC).toContain('MOVEMENT_BALANCE.runSpeedMultiplier');
    expect(SCENE_SRC).toContain('MOVEMENT_BALANCE.runAnimTimeScale');
    expect(SCENE_SRC).toContain('MOVEMENT_BALANCE.doubleClickWindowMs');
    expect(SCENE_SRC).toContain('MOVEMENT_BALANCE.doubleClickMaxDistancePx');
  });
});

// ── ② 双击判定 ────────────────────────────────────────────────────────────
// GameScene.onPointerDown 的判定镜像：第一下永远是走单，同一落点附近在窗口内
// 的第二下才是跑单；Shift 按住时单击即跑单。
interface LastClick {
  x: number;
  at: number;
}

function decideRun(last: LastClick | undefined, x: number, now: number, shift: boolean): boolean {
  if (shift) return true;
  if (!last) return false;
  return (
    now - last.at <= MOVEMENT.doubleClickWindowMs &&
    Math.abs(x - last.x) <= MOVEMENT.doubleClickMaxDistancePx
  );
}

describe('double-click run decision (AG-50)', () => {
  const first = { x: 400, at: 1000 };

  it('makes the first click a walk, never a guess', () => {
    expect(decideRun(undefined, 400, 1000, false)).toBe(false);
    expect(decideRun(undefined, 640, 5000, false)).toBe(false);
  });

  it('runs on a second click at the same spot inside the window', () => {
    expect(decideRun(first, 402, 1200, false)).toBe(true);
    expect(decideRun(first, 400, 1300, false)).toBe(true);
  });

  it('takes the window and distance edges inclusively', () => {
    expect(decideRun(first, 400, 1300, false)).toBe(true); // 正好 300ms
    expect(decideRun(first, 440, 1200, false)).toBe(true); // 正好 40px
    expect(decideRun(first, 400, 1301, false)).toBe(false); // 超窗 1ms
    expect(decideRun(first, 441, 1200, false)).toBe(false); // 超距 1px
  });

  it('falls back to a walk when the second click is elsewhere or late', () => {
    expect(decideRun(first, 700, 1200, false)).toBe(false); // 另一个点
    expect(decideRun(first, 402, 4000, false)).toBe(false); // 超时
  });

  it('treats a shift-held single click as a run order', () => {
    expect(decideRun(undefined, 640, 1000, true)).toBe(true);
    expect(decideRun(first, 700, 4000, true)).toBe(true);
  });
});

// ── ② 跑速算术 ────────────────────────────────────────────────────────────
// GameScene.update() 移动段的同款镜像：倍率作用在斜坡的目标速度上（当前速度
// 先折算回步速空间），松跑时超出步速的部分按刹车率衰减，不瞬按回。
function stepSceneSpeed(speedX: number, dir: number, deltaMs: number, runScale: number): number {
  const rampSpeed = speedX / runScale;
  let stepped: number;
  if (runScale === 1 && dir !== 0 && Math.abs(rampSpeed) > PLAYER_SPEED) {
    const decay = PLAYER_DECELERATION * (deltaMs / 1000);
    stepped = Math.sign(rampSpeed) * Math.max(PLAYER_SPEED, Math.abs(rampSpeed) - decay);
  } else {
    stepped = stepHorizontalSpeed(rampSpeed, dir, deltaMs);
  }
  return stepped * runScale;
}

/** 以固定帧步进模拟一段时间，返回末速度。 */
function simulate(seconds: number, runScale: number, dir = 1, from = 0, dtMs = 16.7): number {
  let v = from;
  const frames = Math.round((seconds * 1000) / dtMs);
  for (let i = 0; i < frames; i++) v = stepSceneSpeed(v, dir, dtMs, runScale);
  return v;
}

describe('run speed arithmetic (AG-50)', () => {
  it('keeps the walk top speed exactly where it was', () => {
    expect(simulate(2, 1)).toBeCloseTo(PLAYER_SPEED, 5);
  });

  it('reaches the run top speed (步速 × 倍率) with a ramp, not a jump', () => {
    const run = simulate(2, MOVEMENT.runSpeedMultiplier);
    expect(run).toBeCloseTo(PLAYER_SPEED * MOVEMENT.runSpeedMultiplier, 5);
    // 起步第一帧只走 ramp 的量（斜坡速率 × 倍率），不是 130→260 瞬跳。
    const dt = 16.7 / 1000;
    const firstFrame = stepSceneSpeed(PLAYER_SPEED, 1, 16.7, MOVEMENT.runSpeedMultiplier);
    expect(firstFrame - PLAYER_SPEED).toBeLessThanOrEqual(PLAYER_ACCELERATION * MOVEMENT.runSpeedMultiplier * dt + 1e-9);
    expect(firstFrame).toBeLessThan(PLAYER_SPEED * MOVEMENT.runSpeedMultiplier);
  });

  it('brakes back to walk speed on release instead of snapping', () => {
    const running = PLAYER_SPEED * MOVEMENT.runSpeedMultiplier;
    const released = stepSceneSpeed(running, 1, 16.7, 1);
    // 一帧最多掉 PLAYER_DECELERATION × dt，绝不在一帧内按回步速。
    expect(released).toBeGreaterThan(PLAYER_SPEED);
    expect(released).toBeLessThanOrEqual(running - PLAYER_DECELERATION * (16.7 / 1000) + 1e-9);
    // 衰减期间不碰斜坡：第二帧继续线性衰减，而不是被钳回 130。
    const secondFrame = stepSceneSpeed(released, 1, 16.7, 1);
    expect(secondFrame).toBeCloseTo(released - PLAYER_DECELERATION * (16.7 / 1000), 5);
    // 十分之一秒内刹回步速。
    expect(simulate(0.1, 1, 1, running)).toBeLessThanOrEqual(PLAYER_SPEED + 1e-9);
  });

  it('carries a reversal through the brake, not the accelerator', () => {
    const running = PLAYER_SPEED * MOVEMENT.runSpeedMultiplier;
    const flipped = stepSceneSpeed(running, -1, 16.7, MOVEMENT.runSpeedMultiplier);
    expect(flipped).toBeGreaterThan(-PLAYER_SPEED * MOVEMENT.runSpeedMultiplier);
    expect(flipped).toBeLessThan(running);
  });
});

// ── ③ GameScene 接线 ──────────────────────────────────────────────────────
describe('GameScene control wiring (AG-50)', () => {
  it('carries the run flag on the click-to-walk order', () => {
    expect(SCENE_SRC).toContain('private walkTarget: { x: number; interact: boolean; run: boolean } | null = null;');
    expect(SCENE_SRC).toContain('this.walkTarget = { x, interact: this.hasInteractableNear(x), run };');
  });

  it('decides the run order from the last click inside onPointerDown', () => {
    expect(SCENE_SRC).toContain('private lastClick?: { x: number; at: number };');
    expect(SCENE_SRC).toMatch(/const run =\s*\n\s*this\.keyShift\?\.isDown === true \|\|/);
    expect(SCENE_SRC).toContain('now - last.at <= MOVEMENT_BALANCE.doubleClickWindowMs');
    expect(SCENE_SRC).toContain('Math.abs(x - last.x) <= MOVEMENT_BALANCE.doubleClickMaxDistancePx');
  });

  it('registers Shift for the keyboard run path', () => {
    expect(SCENE_SRC).toContain('this.keyShift = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);');
    expect(SCENE_SRC).toContain('const shiftRun = this.keyShift?.isDown === true;');
  });

  it('marks the landing spot so walk and run orders read differently', () => {
    expect(SCENE_SRC).toContain('this.spawnClickMarker(world.x, world.y, run);');
    expect(SCENE_SRC).toContain('private spawnClickMarker(x: number, y: number, run: boolean): void {');
  });

  it('plays the run animation through the timeScale fallback or AG-55 run key', () => {
    expect(SCENE_SRC).toContain("const RUN_ANIM_KEY = 'run-player';");
    expect(SCENE_SRC).toContain('runActive && this.anims.exists(RUN_ANIM_KEY)');
    expect(SCENE_SRC).toContain('this.player.anims.timeScale = runActive ? MOVEMENT_BALANCE.runAnimTimeScale');
  });

  it('resets the click order on a new run (scene.stop, not scene.restart)', () => {
    expect(SCENE_SRC).toMatch(/this\.walkTarget = null;\s*\n\s*this\.lastClick = undefined;/);
  });
});

// ── ③ 爬梯交互侧（卡顿根因：落地相机弹跳 / 攀爬相机钉死） ─────────────────
describe('stair climb camera (AG-50)', () => {
  it('follows the climber with bounds widened over the follow travel', () => {
    // 修前 stopFollow + 站立 bounds：塔沿楼层 scrollY 被 clampY 钉在一点，
    // 头顶出视口（1→2 实测 -34px）。
    expect(SCENE_SRC).toContain('const nearScroll = climb.startY - camH / 2;');
    expect(SCENE_SRC).toContain('const farScroll = climb.endY - camH / 2;');
    expect(SCENE_SRC).toMatch(/const top = Math\.min\(standing\.top, lo\);/);
    expect(SCENE_SRC).toMatch(/const bottom = Math\.max\(standing\.bottom, hi \+ camH\);/);
    expect(SCENE_SRC).toContain('cam.startFollow(this.player, true, 0.15, 0.15);');
  });

  it('eases the landing camera to the follow rest point, not the floor-band centre', () => {
    // 修前 centreY = PLAYER_FEET_Y - FLOOR_HEIGHT/2，与 follow 固定点相差
    // 100px：缓动过去再漂回来，就是爬梯末尾那一下「卡」。
    expect(SCENE_SRC).toContain(
      'const centreY = Math.max(topBound + 180, Math.min(bottomBound - 180, PLAYER_FEET_Y));',
    );
    expect(SCENE_SRC).not.toContain('PLAYER_FEET_Y - FLOOR_HEIGHT * 0.5');
  });
});
