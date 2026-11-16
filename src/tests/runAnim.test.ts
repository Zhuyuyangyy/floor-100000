import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';

import {
  FRAME_W,
  RUN_FRAME_RATE,
  RUN_SPEED_MULTIPLIER,
  TOTAL_FRAMES,
  WALK_CHARACTERS,
  WALK_FRAMES,
  WALK_FRAME_RATE,
  bakeWalkSheets,
  createCharacterAnimations,
  runAnimKey,
  walkAnimKey,
  walkSheetKey,
} from '../render/walkcycle';

// AG-55：跑动画（派生版）。用户 2026-11-16 反馈「点两下应该是跑」；AG-50 做
// 双击判定与跑速，这里守动画侧的四件事：
//   ① run-{who} 的命名与 walk-/idle- 同构，GameScene 直接 import；
//   ② 帧率 = 行走 × 1.6，严格更快——这是"跑"与"走"在观感上可区分的唯一来源
//      （帧就是行走的帧，见 docs/plans/RUN_ANIM.md 的路 C 决策）；
//   ③ repeat:-1——跑是持续状态，不是 attack/die 那样的一次性动作；
//   ④ sheet 列号钉死：run 复用 walk 的列 0..5，一张新列都不加，TOTAL_FRAMES
//      仍是 20——walkcycle.test.ts 那二十条列号断言因此原样绿。
//
// 场景桩与 bakeProbe.ts 同手法：bakeWalkSheets 需要 textures.exists/
// createCanvas，createCharacterAnimations 需要 anims.exists/create/
// generateFrameNumbers，一个录音桩全覆盖，不引 Phaser 运行时。

interface AnimConfig {
  key: string;
  frameRate: number;
  repeat: number;
  frames: Array<{ textureKey: string; frame: number }>;
}

interface SheetRec {
  key: string;
  width: number;
  height: number;
}

function recordingScene(): {
  scene: Phaser.Scene;
  anims: AnimConfig[];
  sheets: SheetRec[];
} {
  const anims: AnimConfig[] = [];
  const sheets: SheetRec[] = [];
  const textures = {
    exists: (key: string) => sheets.some((s) => s.key === key),
    createCanvas: (key: string, width: number, height: number) => {
      sheets.push({ key, width, height });
      return {
        context: {
          createImageData: () => ({ data: new Uint8ClampedArray(width * height * 4) }),
          putImageData: () => {},
        },
        refresh: () => {},
        add: () => {},
      };
    },
  };
  const scene = {
    textures,
    anims: {
      exists: (key: string) => anims.some((a) => a.key === key),
      create: (config: AnimConfig) => {
        anims.push(config);
      },
      generateFrameNumbers: (key: string, cfg: { start: number; end: number }) =>
        Array.from({ length: cfg.end - cfg.start + 1 }, (_, i) => ({
          textureKey: key,
          frame: cfg.start + i,
        })),
    },
  };
  return { scene: scene as unknown as Phaser.Scene, anims, sheets };
}

const { scene, anims, sheets } = recordingScene();
// 先烘 sheet 再注册动画——createCharacterAnimations 对不存在的 sheet 会整段
// 跳过，顺序反了会一条 anim 都不注册，测试全绿但什么都没测。
bakeWalkSheets(scene);
createCharacterAnimations(scene);

describe('runAnimKey', () => {
  it('命名与 walk-/idle- 同构，且与行走 key 不同', () => {
    for (const who of WALK_CHARACTERS) {
      expect(runAnimKey(who)).toBe(`run-${who}`);
      expect(runAnimKey(who)).not.toBe(walkAnimKey(who));
    }
  });
});

describe('RUN_FRAME_RATE', () => {
  it('是行走帧率的 1.6 倍，严格更快', () => {
    expect(RUN_SPEED_MULTIPLIER).toBe(1.6);
    expect(RUN_FRAME_RATE).toBeCloseTo(WALK_FRAME_RATE * 1.6, 10);
    expect(RUN_FRAME_RATE).toBeGreaterThan(WALK_FRAME_RATE);
  });
});

describe('createCharacterAnimations 注册 run-{who}', () => {
  it('每个角色都注册一条 run，循环播放', () => {
    for (const who of WALK_CHARACTERS) {
      const run = anims.find((a) => a.key === runAnimKey(who));
      expect(run, `no run anim for ${who}`).toBeDefined();
      // 跑是持续状态：重复播放直到停下，不是播完停末帧的一次性动作。
      expect(run!.repeat, `${who} run repeat`).toBe(-1);
      expect(run!.frameRate, `${who} run frameRate`).toBe(RUN_FRAME_RATE);
    }
  });

  it('run 用的就是行走那张图的列 0..WALK_FRAMES-1', () => {
    for (const who of WALK_CHARACTERS) {
      const run = anims.find((a) => a.key === runAnimKey(who))!;
      expect(run.frames.map((f) => f.frame)).toEqual(
        Array.from({ length: WALK_FRAMES }, (_, i) => i),
      );
      expect(run.frames.every((f) => f.textureKey === walkSheetKey(who))).toBe(true);
    }
  });

  it('不新增 sheet 列：TOTAL_FRAMES 与每角色 sheet 宽度原样', () => {
    // 列号钉死（AG-09 的血换约束）：run 复用 walk 列，一张新列都不加。
    expect(TOTAL_FRAMES).toBe(20);
    for (const who of WALK_CHARACTERS) {
      const sheet = sheets.find((s) => s.key === walkSheetKey(who));
      expect(sheet, `no sheet baked for ${who}`).toBeDefined();
      expect(sheet!.width, `${who} sheet width`).toBe(FRAME_W * TOTAL_FRAMES);
    }
  });

  it('重复调用不重复注册（scene 重启时 anims.exists 的守卫）', () => {
    createCharacterAnimations(scene);
    for (const who of WALK_CHARACTERS) {
      expect(anims.filter((a) => a.key === runAnimKey(who))).toHaveLength(1);
    }
  });
});
