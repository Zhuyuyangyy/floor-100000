import { expect, test, type Page } from '@playwright/test';

// AG-50 临时探针（不提交）：单击走 / 双击跑 A-B / 跑动画 / 点击标记 /
// Shift 跑 / 爬梯帧健康度与落地弹跳。数字进最终报告。

const VIEW_H = 720;

// 场景句柄的窄接口（globals.d.ts 的宽松声明在此收窄）。
interface SceneHandle {
  walkTarget: { x: number; interact: boolean; run: boolean } | null;
  stairClimb: unknown;
  speedX: number;
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
  expect(shiftSample.timeScale, '跑动画倍率生效').toBeGreaterThan(1.2);

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
  expect(peak.timeScale, '跑动画 timeScale≈1.6').toBeGreaterThan(1.2);
  // AG-55 已注册 run-{who}（与 walk 同帧、帧率 x1.6），跑单现在播的就是它。
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
    // 修后：相机从旧帧（≈-181）单调收敛到静止位 -200，不越过、不荡回。
    expect(min, '落地后相机不越过静止位（无弹跳）').toBeGreaterThanOrEqual(-200 - 5);
    expect(max, '落地首帧即旧帧，无 200px 预跳').toBeLessThanOrEqual(-175);
    expect(Math.abs(last - -200), '落地后停在 follow 静止位').toBeLessThan(10);
  }
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
