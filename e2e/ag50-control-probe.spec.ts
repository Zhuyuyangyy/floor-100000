import { expect, test, type Page } from '@playwright/test';

// AG-50 临时探针（不提交）：单击走 / 双击跑 A-B / 跑动画 / 点击标记 /
// Shift 跑 / 爬梯帧健康度与落地弹跳。数字进最终报告。

const VIEW_H = 720;

// 场景句柄的窄接口（globals.d.ts 的宽松声明在此收窄）。
interface SceneHandle {
  walkTarget: { x: number; interact: boolean; run: boolean } | null;
  stairClimb: unknown;
  speedX: number;
  pendingAction?: unknown;
  player: {
    x: number;
    y: number;
    anims: { currentAnim?: { key: string }; timeScale: number };
    getBounds: () => { y: number; height: number };
  };
  cameras: { main: { scrollX: number; scrollY: number; zoom: number } };
  children: { list: Array<{ depth: number }> };
  floorView: { containers: Array<{ x: number; items: unknown[] }> };
  spotMarkers: Map<string, { x: number }>;
  downExit: number;
}

type Game = { scene: { getScene: (k: string) => unknown } };

async function startRun(page: Page, seed = 42): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await page.waitForFunction(() => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Menu'), undefined, { timeout: 30_000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect' || s.scene.key === 'Game'), undefined, { timeout: 30_000 });
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const ok = await page.waitForFunction(() => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'), undefined, { timeout: 2000 }).then(() => true).catch(() => false);
    if (ok) break;
  }
}

/** 世界坐标 → 页面坐标（相机 zoom 1，画布在 1280x800 视口里垂直居中 40px）。 */
async function worldToPage(page: Page, wx: number, wy: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([x, y]) => {
      const sceneOf = (): SceneHandle => (window.__PHASER_GAME__ as unknown as Game).scene.getScene('Game') as SceneHandle;
      const cam = sceneOf().cameras.main;
      return { x: x - cam.scrollX, y: y - cam.scrollY + 40 };
    },
    [wx, wy],
  );
}

/** 挑一个离所有可交互物 ≥45px 的世界 x（避免到达即 E 弹面板）。 */
async function pickSafeTargetX(page: Page, awayFrom: number, minGap: number): Promise<number> {
  return page.evaluate(
    ([from, gap]) => {
      const sceneOf = (): SceneHandle => (window.__PHASER_GAME__ as unknown as Game).scene.getScene('Game') as SceneHandle;
      const scene = sceneOf();
      const bad: number[] = [40, scene.downExit, 1120, 480];
      for (const c of scene.floorView.containers) if (c.items.length > 0) bad.push(c.x);
      for (const m of scene.spotMarkers.values()) bad.push(m.x);
      for (let x = 120; x <= 1160; x += 10) {
        if (Math.abs(x - from) < gap) continue;
        if (bad.every((b) => Math.abs(b - x) > 45)) return x;
      }
      return -1;
    },
    [awayFrom, minGap] as const,
  );
}

async function readOrder(page: Page): Promise<{ orderX: number; run: boolean }> {
  return page.evaluate(() => {
      const sceneOf = (): SceneHandle => (window.__PHASER_GAME__ as unknown as Game).scene.getScene('Game') as SceneHandle;
    const t = sceneOf().walkTarget;
    return { orderX: t?.x ?? -1, run: t?.run ?? false };
  });
}

/** 等订单完成（walkTarget 清空）且角色到达目标，返回耗时 ms。 */
async function waitArrive(page: Page, targetX: number, timeoutMs: number): Promise<number> {
  const t0 = Date.now();
  await page.waitForFunction(
    (tx) => {
      const sceneOf = (): SceneHandle => (window.__PHASER_GAME__ as unknown as Game).scene.getScene('Game') as SceneHandle;
      const scene = sceneOf();
      const s = window.__PHASER_SESSION__?.getState();
      return !scene.walkTarget && !!s && Math.abs(s.player.x - tx) <= 8;
    },
    targetX,
    { timeout: timeoutMs },
  );
  return Date.now() - t0;
}

const markerCount = (page: Page): Promise<number> =>
  page.evaluate(() => {
      const sceneOf = (): SceneHandle => (window.__PHASER_GAME__ as unknown as Game).scene.getScene('Game') as SceneHandle;
    return sceneOf().children.list.filter((o) => o.depth === 40).length;
  });

/**
 * 等播放头回到移动族（idle/walk/run-{who}）且没有待落地动作——即没有一次性
 * 动作 clip（search/pickup/hurt/attack/die）占着，也没有 pendingAction 在跑。
 * AG-66 起搜刮/挖掘动作的 clip 按 charAnimHoldMs 播满时长（容器/床 2s、挖掘
 * 2s、拆床 520ms），且被移动输入取消后 actionAnimUntil 依旧占位到点才释放
 * （cancelPendingAction 不碰它），这期间 update 的选段逻辑判「clip still
 * playing」不给换动画。RC-01 实测两类采样污染：
 *   A 段点击落点若贴在可交互物 36px 内（hasInteractableNear，实测
 *     INTERACT_DISTANCE=44），到达会自动起一段搜刮，B 段到达后 400ms 就按
 *     Shift、900ms 采样恰好落进 2s hold 窗口，量到 search-player 而非
 *     run-player；
 *   C 段 walk-AB 落点贴在床铺（bunk@744，落点 740）到达即起搜刮，紧接着的
 *     双击跑订单被下一帧「移动输入取消动作」连带吞掉——beginPendingAction
 *     /cancelPendingAction 都清 walkTarget（GameScene 9084/9111，AG-66 有意
 *     设计：动作中移动 = 收手重来，ag66-obstacles.spec 钉死），订单从未生效，
 *     waitArrive 20s 超时。游戏行为正确，是探针没等动作窗口。
 * 修法：进纯移动窗口前先等动作 clip 播完、pendingAction 清空。
 */
async function waitMovementClip(page: Page, timeoutMs = 10_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const sceneOf = (): SceneHandle => (window.__PHASER_GAME__ as unknown as Game).scene.getScene('Game') as SceneHandle;
      const key = sceneOf().player.anims.currentAnim?.key ?? '';
      return (key === 'idle-player' || key === 'walk-player' || key === 'run-player') && !sceneOf().pendingAction;
    },
    undefined,
    { timeout: timeoutMs },
  );
}

test('AG-50 探针：点击走 / 双击跑 / 跑动画 / 标记 / Shift / 爬梯', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startRun(page);
  const startX = (await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.player.x ?? -1)) as number;
  console.log(`[ag50] start x=${startX}`);

  // ── A. 单击走 ────────────────────────────────────────────────────────
  const walkX = await pickSafeTargetX(page, startX, 200);
  expect(walkX, '找到安全走点').toBeGreaterThan(0);
  const p1 = await worldToPage(page, walkX, 150);
  await page.mouse.click(p1.x, p1.y);
  const walkOrder = await readOrder(page);
  console.log(`[ag50 walk] order x=${walkOrder.orderX} run=${walkOrder.run}`);
  expect(walkOrder.run).toBe(false);
  console.log(`[ag50 walk] click markers at depth 40: ${await markerCount(page)}`);
  expect(await markerCount(page), '单击后落点标记出现').toBeGreaterThan(0);
  const walkMs = await waitArrive(page, walkOrder.orderX, 15_000);
  console.log(`[ag50 walk] ${Math.abs(walkX - startX)}px in ${walkMs}ms = ${((Math.abs(walkX - startX) / walkMs) * 1000).toFixed(0)}px/s`);
  await page.waitForTimeout(400);
  expect(await markerCount(page), '标记 400ms 后自动销毁').toBe(0);

  // ── B. Shift 键盘跑 ─────────────────────────────────────────────────
  // RC-01 分诊：先等播放头回到移动族再进纯移动窗口——A 段落点若贴着可交互物
  // （床铺/阻碍物/容器，hasInteractableNear 36px 内），到达会自动起一段搜刮
  // （AG-66 beginPendingAction），search clip 的 2s hold 会盖住紧接着的 Shift
  // 跑采样（取消动作不释放占位）。旧探针在这里量到过 search-player。
  await waitMovementClip(page);
  await page.keyboard.down('Shift');
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(900);
  const shiftSample = await page.evaluate(() => {
      const sceneOf = (): SceneHandle => (window.__PHASER_GAME__ as unknown as Game).scene.getScene('Game') as SceneHandle;
    const s = sceneOf();
    return { speedX: s.speedX, timeScale: s.player.anims.timeScale, anim: s.player.anims.currentAnim?.key };
  });
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('Shift');
  console.log(`[ag50 shift-run] speedX=${shiftSample.speedX.toFixed(0)} timeScale=${shiftSample.timeScale} anim=${shiftSample.anim}`);
  expect(shiftSample.speedX, 'Shift+→ 达到跑速').toBeGreaterThan(200);
  // AG-55 起跑速由 run-player 动画自身的注册帧率（walk×1.6，runAnim.spec 钉死）
  // 承担，player.anims.timeScale 保持 1——旧探针量的 timeScale>1.2 是已被替换
  // 的机制（RC-01 分诊：探针缺陷）。改断言真实播放的 clip。
  expect(shiftSample.anim, 'Shift 跑播的是 run-player（1.6 倍帧率注册）').toBe('run-player');

  // ── C. 双击跑 A-B（同距离、反方向，计时口径一致） ───────────────────
  const runFrom = (await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.player.x ?? 0)) as number;
  const walkTargetX = await pickSafeTargetX(page, runFrom, 300);
  const pw = await worldToPage(page, walkTargetX, 150);
  await page.mouse.click(pw.x, pw.y);
  const walkOrder2 = await readOrder(page);
  const walkMs2 = await waitArrive(page, walkOrder2.orderX, 20_000);
  const dist2 = Math.abs(walkTargetX - runFrom);
  console.log(`[ag50 walk-AB] ${dist2}px in ${walkMs2}ms = ${((dist2 / walkMs2) * 1000).toFixed(0)}px/s`);

  const runFrom2 = (await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.player.x ?? 0)) as number;
  const runTargetX = await pickSafeTargetX(page, runFrom2, 300);
  const dist3 = Math.abs(runTargetX - runFrom2);
  const pr = await worldToPage(page, runTargetX, 150);
  // RC-01：walk-AB 落点贴在床铺（bunk@744）时到达即起 2s 搜刮，紧随的点击
  // 订单会被「动作中移动 = 收手」连同订单一起吞掉（GameScene 9084/9111）。
  // 先等动作窗口过去再下跑单。
  await waitMovementClip(page);
  await page.mouse.dblclick(pr.x, pr.y);
  const runOrder = await readOrder(page);
  expect(runOrder.run, '第二击判为跑单').toBe(true);
  const runMs = await waitArrive(page, runOrder.orderX, 20_000);
  const walkRate = (dist2 / walkMs2) * 1000;
  const runRate = (dist3 / Math.max(1, runMs)) * 1000;
  console.log(`[ag50 run-AB] ${dist3}px in ${runMs}ms = ${runRate.toFixed(0)}px/s`);
  console.log(`[ag50 A/B] walk=${walkRate.toFixed(0)}px/s run=${runRate.toFixed(0)}px/s ratio=${(runRate / walkRate).toFixed(2)}`);
  expect(runRate, '跑速约为步速 2 倍').toBeGreaterThan(walkRate * 1.6);

  // ── C2. 第三次跑：采样速度与动画 ─────────────────────────────────────
  // RC-01：先等动作窗口过去再起采样器——采样循环只跑 1000ms，若等待发生在
  // 起采样之后，采到的全是动作 hold 期间的 idle（同 B 段分诊）。
  await waitMovementClip(page);
  const runFrom3 = (await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.player.x ?? 0)) as number;
  const runTarget3 = await pickSafeTargetX(page, runFrom3, 300);
  const p3 = await worldToPage(page, runTarget3, 150);
  const sampling3 = page.evaluate(async () => {
      const sceneOf = (): SceneHandle => (window.__PHASER_GAME__ as unknown as Game).scene.getScene('Game') as SceneHandle;
    const out: Array<{ speedX: number; timeScale: number; anim: string }> = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 1000) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const s = sceneOf();
      out.push({ speedX: s.speedX, timeScale: s.player.anims.timeScale, anim: s.player.anims.currentAnim?.key ?? '' });
    }
    return out;
  });
  await page.mouse.dblclick(p3.x, p3.y);
  const runSamples = await sampling3;
  const peak = runSamples.reduce((a, b) => (Math.abs(a.speedX) > Math.abs(b.speedX) ? a : b));
  console.log(`[ag50 run-anim] peak |speedX|=${Math.abs(peak.speedX).toFixed(0)} timeScale=${peak.timeScale} anim=${peak.anim}`);
  expect(Math.abs(peak.speedX), '双击跑达到跑速').toBeGreaterThan(200);
  // AG-55 已注册 run-{who}（与 walk 同帧、帧率 x1.6），跑单现在播的就是它；
  // timeScale 机制已被注册帧率替换，不再单独断言（同 B 段）。
  expect(peak.anim).toBe('run-player');
  await waitArrive(page, runTarget3, 20_000);

  // ── D. 爬梯：帧健康度 + 可见性 + 落地弹跳 ───────────────────────────
  await page.keyboard.down('ArrowLeft');
  await page.waitForFunction(() => (window.__PHASER_SESSION__?.getState()?.player.x ?? 999) <= 44, undefined, { timeout: 20_000 });
  await page.keyboard.up('ArrowLeft');
  const hint = await page.evaluate(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { children: { list: Array<{ name?: string }> } } | null;
    const o = scene?.children.list.find((c) => c.name === 'hud-hint') as { text?: string } | undefined;
    return o?.text ?? '';
  });
  console.log(`[ag50 stair] hint="${hint}"`);

  const sampling = page.evaluate(async () => {
      const sceneOf = (): SceneHandle => (window.__PHASER_GAME__ as unknown as Game).scene.getScene('Game') as SceneHandle;
    const out: Array<{ t: number; scrollY: number; top: number; bottom: number; floor: number; playerScreenY: number }> = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 3200) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const s = sceneOf();
      const st = window.__PHASER_SESSION__?.getState();
      const b = s.player.getBounds();
      out.push({
        t: performance.now() - t0,
        scrollY: s.cameras.main.scrollY,
        top: (b.y - s.cameras.main.scrollY) * s.cameras.main.zoom,
        bottom: (b.y + b.height - s.cameras.main.scrollY) * s.cameras.main.zoom,
        floor: st?.currentFloor ?? -1,
        playerScreenY: (s.player.y - s.cameras.main.scrollY) * s.cameras.main.zoom,
      });
    }
    return out;
  });
  await page.keyboard.press('E');
  const frames = await sampling;
  const landIdx = frames.findIndex((f) => f.floor === 2);
  const climb = frames.slice(0, landIdx === -1 ? frames.length : landIdx);
  const after = landIdx === -1 ? [] : frames.slice(landIdx, landIdx + 90);
  const dts: number[] = [];
  for (let i = 1; i < climb.length; i++) dts.push(climb[i].t - climb[i - 1].t);
  dts.sort((a, b) => a - b);
  const dtMed = dts[Math.floor(dts.length / 2)] ?? 0;
  const dtMax = dts[dts.length - 1] ?? 0;
  const worstTop = Math.min(...climb.map((f) => f.top));
  const worstBottom = Math.max(...climb.map((f) => f.bottom));
  console.log(`[ag50 stair] climb frames=${climb.length} dt median=${dtMed.toFixed(1)} max=${dtMax.toFixed(1)}`);
  console.log(`[ag50 stair] visibility top=${worstTop.toFixed(1)} bottom=${worstBottom.toFixed(1)} viewport=[0,${VIEW_H}]`);
  expect(dtMax, '爬梯无掉帧尖峰').toBeLessThan(dtMed * 2.5);
  expect(worstTop, '头顶不出视口').toBeGreaterThanOrEqual(0);
  expect(worstBottom, '脚底不出视口').toBeLessThanOrEqual(VIEW_H);
  // 落地连续性：内容在落地瞬间原地不动（AG-52 的设计意图）——爬梯末帧与
  // 落地首帧的角色 screenY 应几乎一致。修前 Phaser setBounds 的当场钳位把
  // 旧帧钳掉，内容先跳近两百 px 再被 220ms 缓动晃回来，就是用户那一下「卡」。
  const lastClimbFrame = climb[climb.length - 1];
  const firstLandFrame = after[0];
  if (lastClimbFrame && firstLandFrame) {
    const jump = Math.abs(firstLandFrame.playerScreenY - lastClimbFrame.playerScreenY);
    console.log(
      `[ag50 stair] landing continuity: playerScreenY ${lastClimbFrame.playerScreenY.toFixed(1)} -> ${firstLandFrame.playerScreenY.toFixed(1)} (jump=${jump.toFixed(1)}px)`,
    );
    expect(jump, '落地瞬间内容不跳帧').toBeLessThan(25);
  }
  if (after.length > 1) {
    const min = Math.min(...after.map((f) => f.scrollY));
    const max = Math.max(...after.map((f) => f.scrollY));
    const last = after[after.length - 1].scrollY;
    console.log(`[ag50 stair] after-landing scrollY min=${min.toFixed(1)} max=${max.toFixed(1)} last=${last.toFixed(1)} range=${(max - min).toFixed(1)}`);
    // after[] 是落地到 **2 层** 的帧（landIdx = floor===2）。家区剖面（AG-52，
    // 2-5 层常驻画楼下层）把 2 层站立静止位设为
    //   PLAYER_FEET_Y - viewH*0.45 = 160 - 324 = -164；
    // 爬梯末帧旧帧 ≈ -181。相机从 -181 单调收敛到 -164，不越过、不荡回。
    // 旧断言钉 -200（家区剖面之前「脚线居中」的值），已不适用。
    expect(min, '落地后相机不越过旧帧（无弹跳）').toBeGreaterThanOrEqual(-181 - 5);
    expect(max, '落地后相机不越过 2 层家区静止位 -164（无预跳反弹）').toBeLessThanOrEqual(-164 + 5);
    expect(Math.abs(last - -164), '落地后停在 2 层家区 follow 静止位').toBeLessThan(10);
  }
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
