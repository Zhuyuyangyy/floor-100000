import { expect, test, type Page } from '@playwright/test';

// AG-52（容器隐形标签 + 只画本层）实测探针。端口 5452 专用 config，--workers=1。
//
//   AG52_PHASE=before  改动前基线测量（标签常显 / 邻居层在画 / 爬梯相机）
//   AG52_PHASE=after   改动后功能断言（靠近才现 0.35 隐形字 / 站立只画本层 /
//                      爬梯画目标层且角色完整可见）
//
// 2026-11-20 家区剖面（用户裁决「前 5 层是自己家，下面要能看见」）：
// 2-5 层站立态常驻画楼下那层（neighbourLayers=1、bounds 含剖面一层），
// 1 层（地基）与 6 层起维持 AG-52 单层契约。断言按新口径分家区/非家区。
// 功能断言默认生效（不再要求显式 AG52_PHASE=after——旧默认 'run' 会让
// expect 块整体静默跳过，等于没有门禁）；before 模式仍只测量不断言。
//
// 截图落 output/ag52/<phase>/（gitignore 的本地证据目录），测量 JSON 以
// testInfo.attach 附在报告里。

const PHASE = process.env.AG52_PHASE ?? 'after';
const EXPECT_AFTER = PHASE !== 'before';
const STACK_DEPTH = -10; // render/lighting.ts：邻居层容器的深度
const VIEW_H = 720; // DESIGN_HEIGHT，zoom 1 时即世界像素

interface SceneProbe {
  floor: number;
  scrollX: number;
  scrollY: number;
  zoom: number;
  boundTop: number;
  boundBottom: number;
  boundHeight: number;
  displayListLength: number;
  neighbourLayers: number;
  label: { alpha: number; plateAlpha: number; visible: boolean; text: string } | null;
  playerScreenTop: number;
  playerScreenBottom: number;
}

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => {
      const g = window.__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === k);
    },
    key,
    { timeout: 30_000 },
  );
}

async function startGame(page: Page, seed = 42): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const g = window.__PHASER_GAME__;
    return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect' || s.scene.key === 'Game');
  }, undefined, { timeout: 30_000 });
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const started = await page
      .waitForFunction(() => {
        const g = window.__PHASER_GAME__;
        return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
      }, undefined, { timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    if (started) break;
  }
  await waitForScene(page, 'Game');
}

/** 读 Game 场景运行时的相机 / 邻居层 / 容器名签 / 角色屏幕位置。 */
async function probeScene(page: Page): Promise<SceneProbe> {
  return page.evaluate((stackDepth: number) => {
    const g = window.__PHASER_GAME__ as unknown as {
      scene: {
        getScene: (k: string) => {
          cameras?: { main?: { scrollX: number; scrollY: number; zoom: number; _bounds?: { y: number; height: number } } };
          children: { list: Array<{ type: string; depth?: number; text?: string; visible: boolean }> };
          player?: { getBounds: () => { y: number; height: number } };
          containerObjs?: Map<string, { label: { alpha: number; visible: boolean; text: string }; plate: { alpha: number } }>;
        } | null;
      };
    };
    const s = window.__PHASER_SESSION__?.getState();
    const scene = g?.scene.getScene('Game');
    if (!scene || !s) throw new Error('no Game scene/state');
    const cam = scene.cameras?.main;
    const list = scene.children.list ?? [];
    const player = scene.player;
    const b = player?.getBounds?.();
    const cab = scene.containerObjs?.get('cabinet');
    return {
      floor: s.currentFloor,
      scrollX: cam?.scrollX ?? NaN,
      scrollY: cam?.scrollY ?? NaN,
      zoom: cam?.zoom ?? NaN,
      boundTop: cam?._bounds?.y ?? NaN,
      boundBottom: cam?._bounds ? cam._bounds.y + cam._bounds.height : NaN,
      boundHeight: cam?._bounds?.height ?? NaN,
      displayListLength: list.length,
      neighbourLayers: list.filter((o) => (o.depth ?? 0) === stackDepth).length,
      label: cab ? { alpha: cab.label.alpha, plateAlpha: cab.plate.alpha, visible: cab.label.visible, text: cab.label.text } : null,
      playerScreenTop: b ? (b.y - (cam?.scrollY ?? 0)) * (cam?.zoom ?? 1) : NaN,
      playerScreenBottom: b ? (b.y + b.height - (cam?.scrollY ?? 0)) * (cam?.zoom ?? 1) : NaN,
    };
  }, STACK_DEPTH);
}

/** 直接把角色摆到某 x（场景每帧从 state.player.x 同步精灵，与 firstChapter 同法）。 */
async function setX(page: Page, x: number): Promise<void> {
  await page.evaluate((v) => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.player.x = v;
  }, x);
  // 等两帧，让 UPDATE 监听器（名签渐隐/爬梯同步）按新位置跑过。
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

interface ClimbSample {
  floor: number;
  scrollY: number;
  neighbourLayers: number;
  worldTop: number;
  worldBottom: number;
  screenTop: number;
  screenBottom: number;
}

async function sampleClimb(page: Page, fromFloor = 1): Promise<ClimbSample[]> {
  return page.evaluate(async (startFloor) => {
    const g = window.__PHASER_GAME__ as unknown as {
      scene: {
        getScene: (k: string) => {
          cameras?: { main?: { scrollY: number; zoom: number } };
          children: { list: Array<{ depth?: number }> };
          player?: { getBounds: () => { y: number; height: number } };
        } | null;
      };
    };
    const scene = g?.scene.getScene('Game');
    if (!scene) throw new Error('no Game scene');
    const out: ClimbSample[] = [];
    const started = performance.now();
    while (performance.now() - started < 2600) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      const s = window.__PHASER_SESSION__?.getState();
      const player = scene.player;
      if (!s || !player?.getBounds) continue;
      const b = player.getBounds();
      const cam = scene.cameras?.main;
      const zoom = cam?.zoom ?? 1;
      out.push({
        floor: s.currentFloor,
        scrollY: cam?.scrollY ?? NaN,
        neighbourLayers: (scene.children.list ?? []).filter((o) => (o.depth ?? 0) === -10).length,
        worldTop: b.y,
        worldBottom: b.y + b.height,
        screenTop: (b.y - (cam?.scrollY ?? 0)) * zoom,
        screenBottom: (b.y + b.height - (cam?.scrollY ?? 0)) * zoom,
      });
      if (s.currentFloor !== startFloor) break; // 落地即停
    }
    return out;
  }, fromFloor);
}

test.describe('AG-52 容器名签 + 只画本层', () => {
  test('站立 1F：名签隐形、邻居层不画、相机收到本层', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await startGame(page, 42);
    expect((await probeScene(page)).floor).toBe(1);

    // ── 场景中部（远离 1F 唯一容器 cabinet@160）：名签必须不可见
    await setX(page, 640);
    const far = await probeScene(page);
    await page.screenshot({ path: `output/ag52/${PHASE}/stand-far-cabinet.png` });
    await testInfo.attach('stand-far', { body: JSON.stringify(far, null, 2), contentType: 'application/json' });
    console.log(`[ag52 stand-far] ${JSON.stringify(far)}`);
    if (EXPECT_AFTER) {
      expect(far.label?.alpha ?? 1, '远处不该看见储物柜三个字').toBeLessThanOrEqual(0.001);
      expect(far.label?.plateAlpha ?? 1, '远处不该看见名签背板').toBeLessThanOrEqual(0.001);
      expect(far.neighbourLayers, '站立态不画邻居层').toBe(0);
      expect(far.boundHeight, '相机 bounds 收到一层之内').toBeLessThanOrEqual(220);
    }

    // ── 贴近储物柜（cabinet@160，交互距离 44 内）：隐形小字浮现
    await setX(page, 160);
    const near = await probeScene(page);
    await page.screenshot({ path: `output/ag52/${PHASE}/stand-near-cabinet.png` });
    await testInfo.attach('stand-near', { body: JSON.stringify(near, null, 2), contentType: 'application/json' });
    console.log(`[ag52 stand-near] ${JSON.stringify(near)}`);
    if (EXPECT_AFTER) {
      expect(near.label?.alpha ?? 0, '靠近时浮现隐形文字').toBeGreaterThan(0.2);
      expect(near.label?.alpha ?? 0, '靠近时也只是隐形字，不是常显名牌').toBeLessThan(0.5);
      expect(near.label?.plateAlpha ?? 0, '隐形态不给背板').toBeLessThanOrEqual(0.001);
      expect(near.neighbourLayers, '贴近容器也不画邻居层').toBe(0);
    }

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('爬梯 1→2：目标层可见、角色完整可见、落地后仍只画本层', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await startGame(page, 42);
    await setX(page, 40); // 上楼口
    const before = await probeScene(page);

    const sampling = sampleClimb(page);
    await page.keyboard.press('E');
    const samples = await sampling;

    const climbing = samples.filter((s) => s.floor === 1);
    const worstTop = Math.min(...climbing.map((s) => s.screenTop));
    const worstBottom = Math.max(...climbing.map((s) => s.screenBottom));
    const climbNeighbours = Math.max(...climbing.map((s) => s.neighbourLayers));
    console.log(
      `[ag52 climb 1->2] samples=${climbing.length} ` +
        `neighbourLayers(max)=${climbNeighbours} worstScreenTop=${worstTop.toFixed(1)} worstScreenBottom=${worstBottom.toFixed(1)} viewport=[0, ${VIEW_H}]`,
    );
    await testInfo.attach('climb-samples', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });

    // 爬梯中段截一张图：角色夹在两层之间时，目标层必须在画面里
    const mid = climbing[Math.floor(climbing.length / 2)];
    if (mid) {
      console.log(`[ag52 climb-mid] ${JSON.stringify(mid)}`);
    }

    if (EXPECT_AFTER) {
      expect(climbing.length, '攀爬过程被逐帧采样').toBeGreaterThan(20);
      expect(climbNeighbours, '爬梯态必须画目标层，否则角色往虚空里走').toBeGreaterThanOrEqual(1);
      expect(worstTop, '头顶不出视口顶边').toBeGreaterThanOrEqual(0);
      expect(worstBottom, '脚底不出视口底边').toBeLessThanOrEqual(VIEW_H);
    }

    // 落地 2F：家区剖面——楼下 1F（玩家宿舍）常驻在画，bounds 含剖面一层。
    await expect
      .poll(async () => (await probeScene(page)).floor, { timeout: 10_000 })
      .toBe(2);
    // 落地缓动 220ms 期间 bounds 是临时放宽的（旧帧→站立位），等它收回站立位。
    await page.waitForTimeout(500);
    const landed = await probeScene(page);
    await page.screenshot({ path: `output/ag52/${PHASE}/landed-floor2.png` });
    await testInfo.attach('landed', { body: JSON.stringify({ before, landed }, null, 2), contentType: 'application/json' });
    console.log(`[ag52 landed-2F] ${JSON.stringify(landed)}`);
    if (EXPECT_AFTER) {
      expect(landed.neighbourLayers, '家区 2F 站立态常驻画楼下 1F（自己家）').toBe(1);
      expect(landed.boundHeight, '家区 bounds 含剖面：视口高一层').toBeGreaterThanOrEqual(VIEW_H - 1);
      // 脚线在视口 45% 处（HOME_SECTION_FEET_FRAC 0.45 × 720 = 324）。
      expect(landed.playerScreenBottom).toBeCloseTo(VIEW_H * 0.45, 0);
    }

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('下行爬梯 2→1：目标层在脚下、落地收回本层', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await startGame(page, 42);
    // 先上到 2 层（与上一例同一条路），再走下楼口。
    await setX(page, 40);
    await page.keyboard.press('E');
    await expect
      .poll(async () => (await probeScene(page)).floor, { timeout: 10_000 })
      .toBe(2);
    await setX(page, 1240); // 2 层下楼口（floorWidthFor(2)-40）

    const sampling = sampleClimb(page, 2);
    await page.keyboard.press('E');
    const samples = await sampling;

    const climbing = samples.filter((s) => s.floor === 2);
    const worstTop = Math.min(...climbing.map((s) => s.screenTop));
    const worstBottom = Math.max(...climbing.map((s) => s.screenBottom));
    const climbNeighbours = Math.max(...climbing.map((s) => s.neighbourLayers));
    console.log(
      `[ag52 climb 2->1] samples=${climbing.length} ` +
        `neighbourLayers(max)=${climbNeighbours} worstScreenTop=${worstTop.toFixed(1)} worstScreenBottom=${worstBottom.toFixed(1)} viewport=[0, ${VIEW_H}]`,
    );
    await testInfo.attach('climb-down-samples', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });

    if (EXPECT_AFTER) {
      expect(climbing.length, '下行攀爬被逐帧采样').toBeGreaterThan(20);
      expect(climbNeighbours, '下行同样要画目标层').toBeGreaterThanOrEqual(1);
      expect(worstTop, '头顶不出视口顶边').toBeGreaterThanOrEqual(0);
      expect(worstBottom, '脚底不出视口底边').toBeLessThanOrEqual(VIEW_H);
    }

    await expect
      .poll(async () => (await probeScene(page)).floor, { timeout: 10_000 })
      .toBe(1);
    await page.waitForTimeout(500); // 等落地缓动收回一层
    const landed = await probeScene(page);
    console.log(`[ag52 landed-1F] ${JSON.stringify(landed)}`);
    if (EXPECT_AFTER) {
      expect(landed.neighbourLayers, '落回 1F 也只画本层').toBe(0);
      expect(landed.boundHeight, 'bounds 仍是一层').toBeLessThanOrEqual(220);
      // 相机回到站立位：角色居中（脚在 PLAYER_FEET_Y=160 → 屏幕 360）。
      expect(landed.playerScreenBottom).toBeCloseTo(360, 0);
    }

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });
});
