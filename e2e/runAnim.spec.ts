import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// AG-55：跑动画实机探针（docs/plans/RUN_ANIM.md 的配套证据）。
//
// 证明三件事：
//   ① run-player 在实机里注册成功（帧率 12.8 = 行走 8 × 1.6，repeat -1，
//      6 帧全取自行走 sheet 的列 0..5）；
//   ② 跑真的比走快：同一角色同一张图，1 秒内 run 的换帧次数 ≈ walk 的 1.6 倍
//      ——帧是同一批像素图，"跑"与"走"在观感上可区分靠的就是这个帧率；
//   ③ 同一时刻停下，跑停在第 5 帧、走停在第 2 帧，两张裁剪截图逐字节不同。
//
// 为什么可以直接调 anims：AG-50 在做双击判定与跑速（交互侧），本 worktree 的
// GameScene 还没有跑状态；update() 里的 walk/idle 挑选会把手动播的 run 抢回
// idle。所以探针先用一次性动作守卫（actionAnimKey/actionAnimUntil，见
// GameScene.ts:6282）把挑选整段冻住，再手动 play——这测的是动画侧，交互侧
// 归 AG-50 的 spec 管。AG-50 的跑状态就位后，这个冻结 trick 不再需要。
//
// 两个踩过的坑（都写在代码里对应位置）：
//   · 站定不动时 idle 挑选会把 anims.timeScale 压到 0.2 并留在精灵上
//     （GameScene.ts:6288），手动播放前必须复位，否则测到的是放慢 5 倍的速率；
//   · play(key, true) 会重启动画，pause 之后不能再 play，否则冻住的帧被冲掉；
//   · Phaser 4.2 的 AnimationFrame.index 是 1 基的，帧位断言一律用
//     textureFrame（0 基 = sheet 列号）。
//
// 端口 5455 / --workers=1 见 e2e/playwright.ag55.config.ts；截图落 output/ag55/
// （gitignored，AG-44 同款约定）。

const OUT_DIR = 'output/ag55';

interface AnimSnapshot {
  key: string;
  frameRate: number;
  repeat: number;
  frameCount: number;
  textureKey: string;
  frameIndex: number;
  textureFrame: string;
}

interface ClipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// 读 GameScene 实例与玩家精灵。private 字段在运行时就是普通属性。
async function gameHandles(page: Page): Promise<{ who: string; textureKey: string }> {
  return page.evaluate(() => {
    const game = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => unknown } } }).__PHASER_GAME__;
    const scene = game!.scene.getScene('Game') as { player: { texture: { key: string } } };
    const textureKey = scene.player.texture.key;
    const who = textureKey.replace(/^char-/, '').replace(/-walk$/, '');
    return { who, textureKey };
  });
}

// 冻住 update() 的 walk/idle 挑选：把一次性动作守卫设成待播的 key，
// GameScene.ts:6282 的分支整段跳过，手动播的 anim 不会被抢回 idle。
async function freezeClipPick(page: Page, key: string): Promise<void> {
  await page.evaluate((k) => {
    const game = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => unknown } } }).__PHASER_GAME__;
    const scene = game!.scene.getScene('Game') as {
      time: { now: number };
      actionAnimKey: string;
      actionAnimUntil: number;
    };
    scene.actionAnimKey = k;
    scene.actionAnimUntil = scene.time.now + 600_000;
  }, key);
}

// 在页面内按 rAF 轮询换帧次数，量真实播放速率（不受 Playwright 往返延迟影响）。
async function measureAdvances(page: Page, key: string, ms: number): Promise<{ advances: number; elapsed: number; fps: number }> {
  return page.evaluate(
    async ({ k, ms }) => {
      const game = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => unknown } } }).__PHASER_GAME__;
      const scene = game!.scene.getScene('Game') as {
        player: {
          play: (k: string, ignoreSkip: boolean) => boolean;
          anims: {
            timeScale: number;
            currentFrame: { index: number };
          };
        };
      };
      const player = scene.player;
      player.play(k, true);
      // 站定不动时 idle 挑选会把 timeScale 压到 0.2 并留在精灵上
      // （GameScene.ts:6288，speedFraction=0 ⇒ max(0.2, 0)），手动播放前必须
      // 复位，否则测到的是放慢 5 倍的速率——第一轮探针就是这么挂的。
      player.anims.timeScale = 1;
      const start = performance.now();
      let advances = 0;
      let last = player.anims.currentFrame.index;
      await new Promise<void>((resolve) => {
        const tick = () => {
          const idx = player.anims.currentFrame.index;
          if (idx !== last) {
            advances += 1;
            last = idx;
          }
          if (performance.now() - start >= ms) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const elapsed = performance.now() - start;
      return { advances, elapsed, fps: (advances / elapsed) * 1000 };
    },
    { k: key, ms },
  );
}

// 播 waitMs 后 pause() 冻住，并当场读快照。注意顺序：pause 之后不能再 play——
// play(key, true) 会重启动画，把冻住的帧冲掉（第一轮探针的第二个坑）。
async function freezeAt(page: Page, key: string, waitMs: number): Promise<AnimSnapshot> {
  return page.evaluate(
    async ({ k, waitMs }) => {
      const game = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => unknown } } }).__PHASER_GAME__;
      const scene = game!.scene.getScene('Game') as {
        player: {
          play: (k: string, ignoreSkip: boolean) => boolean;
          anims: {
            timeScale: number;
            pause: () => unknown;
            currentAnim: { key: string; frameRate: number; repeat: number; frames: Array<{ textureKey: string }> };
            currentFrame: { index: number; textureFrame: string | number };
          };
        };
      };
      const player = scene.player;
      player.play(k, true);
      player.anims.timeScale = 1;
      await new Promise((r) => setTimeout(r, waitMs));
      player.anims.pause();
      const anim = player.anims.currentAnim;
      const frame = player.anims.currentFrame;
      return {
        key: anim.key,
        frameRate: anim.frameRate,
        repeat: anim.repeat,
        frameCount: anim.frames.length,
        textureKey: anim.frames[0].textureKey,
        frameIndex: frame.index,
        textureFrame: String(frame.textureFrame),
      };
    },
    { k: key, waitMs },
  );
}

// 玩家周围的裁剪矩形（CSS 像素，供 page.screenshot clip）。
async function playerClip(page: Page): Promise<ClipRect> {
  return page.evaluate(() => {
    const game = (window as unknown as {
      __PHASER_GAME__?: {
        canvas: HTMLCanvasElement;
        scene: { getScene: (k: string) => unknown };
      };
    }).__PHASER_GAME__;
    const scene = game!.scene.getScene('Game') as {
      player: { getBounds: () => { x: number; y: number; width: number; height: number } };
      cameras: { main: { scrollX: number; scrollY: number; zoom: number } };
    };
    const canvas = game!.canvas;
    const rect = canvas.getBoundingClientRect();
    const cam = scene.cameras.main;
    const b = scene.player.getBounds();
    const zx = rect.width / canvas.width;
    const zy = rect.height / canvas.height;
    const x = rect.left + (b.x - cam.scrollX) * cam.zoom * zx;
    const y = rect.top + (b.y - cam.scrollY) * cam.zoom * zy;
    const width = b.width * cam.zoom * zx;
    const height = b.height * cam.zoom * zy;
    const pad = 24;
    return { x: x - pad, y: y - pad, width: width + pad * 2, height: height + pad * 2 };
  });
}

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === k);
    },
    key,
    { timeout: 20_000 },
  );
}

async function bootToGame(page: Page): Promise<void> {
  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  // The pick screen reports active before create() binds its keys, so an
  // Enter can land in that window and be lost. Retry until the run starts.
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const started = await page
      .waitForFunction(
        () => {
          const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
          return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
        },
        undefined,
        { timeout: 2000 },
      )
      .then(() => true)
      .catch(() => false);
    if (started) break;
  }
  await waitForScene(page, 'Game');
}

test('run-player 注册成功，且播放速率是行走的 1.6 倍', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await bootToGame(page);
  const { who, textureKey } = await gameHandles(page);
  const runKey = `run-${who}`;
  const walkKey = `walk-${who}`;
  expect(who).toBe('player');
  expect(textureKey).toBe('char-player-walk');

  // ① 注册：key、帧率、循环、帧数、贴图，全部与 walkcycle.ts 的声明一致。
  const reg = await page.evaluate((k) => {
    const game = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (s: string) => { anims: { get: (k: string) => unknown } } } } }).__PHASER_GAME__;
    const anim = game!.scene.getScene('Game').anims.get(k) as {
      key: string;
      frameRate: number;
      repeat: number;
      frames: Array<{ textureKey: string }>;
    };
    return { key: anim.key, frameRate: anim.frameRate, repeat: anim.repeat, frameCount: anim.frames.length, textureKey: anim.frames[0].textureKey };
  }, runKey);
  expect(reg.key).toBe(runKey);
  expect(reg.frameRate).toBeCloseTo(8 * 1.6, 6); // WALK_FRAME_RATE × RUN_SPEED_MULTIPLIER
  expect(reg.repeat).toBe(-1); // 持续状态，循环播放
  expect(reg.frameCount).toBe(6); // = WALK_FRAMES，复用行走的列
  expect(reg.textureKey).toBe('char-player-walk');

  // ② 速率：900ms 窗口内量换帧次数，run ≈ walk × 1.6。取 1.35~1.85 的宽容带，
  // 只排除"一样快"和"数量级差异"，不假装逐帧精确。
  await freezeClipPick(page, runKey);
  const run = await measureAdvances(page, runKey, 900);
  await freezeClipPick(page, walkKey);
  const walk = await measureAdvances(page, walkKey, 900);

  expect(run.advances, `run advances in ${run.elapsed.toFixed(0)}ms`).toBeGreaterThan(6);
  expect(walk.advances, `walk advances in ${walk.elapsed.toFixed(0)}ms`).toBeGreaterThan(4);
  const ratio = run.fps / walk.fps;
  expect(ratio, `run ${run.fps.toFixed(2)}fps vs walk ${walk.fps.toFixed(2)}fps`).toBeGreaterThan(1.35);
  expect(ratio, `run ${run.fps.toFixed(2)}fps vs walk ${walk.fps.toFixed(2)}fps`).toBeLessThan(1.85);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('同一时刻跑与走可区分：帧位不同，裁剪截图逐字节不同', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await bootToGame(page);
  const { who } = await gameHandles(page);
  const runKey = `run-${who}`;
  const walkKey = `walk-${who}`;
  mkdirSync(OUT_DIR, { recursive: true });

  // 400ms：run 12.8fps ⇒ 第 5 帧；300ms：walk 8fps ⇒ 第 2 帧。两段窗口各自
  // 留了 ±50ms 的抖动余量，区间仍然不相交——"可区分"不靠运气。
  await freezeClipPick(page, runKey);
  const runSnap = await freezeAt(page, runKey, 400);
  const runClip = await playerClip(page);
  const runShot = await page.screenshot({ path: `${OUT_DIR}/run-frame.png`, clip: runClip });

  await freezeClipPick(page, walkKey);
  const walkSnap = await freezeAt(page, walkKey, 300);
  const walkClip = await playerClip(page);
  const walkShot = await page.screenshot({ path: `${OUT_DIR}/walk-frame.png`, clip: walkClip });

  expect(runSnap.key).toBe(runKey);
  expect(walkSnap.key).toBe(walkKey);
  // 同一批像素图，区别只在播放速率——落到同一时刻就是帧位差。断言用
  // textureFrame（0 基 = sheet 列号）；AnimationFrame.index 在 Phaser 4.2 是
  // 1 基的，跟列号比会差一。
  expect(['4', '5'], `run frame at capture: ${runSnap.textureFrame}`).toContain(runSnap.textureFrame);
  expect(['1', '2'], `walk frame at capture: ${walkSnap.textureFrame}`).toContain(walkSnap.textureFrame);
  expect(runSnap.textureFrame, '同一时刻跑停的帧必须比走更远').not.toBe(walkSnap.textureFrame);
  expect(runShot.equals(walkShot), 'run 与 walk 的裁剪截图应当逐字节不同').toBe(false);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
