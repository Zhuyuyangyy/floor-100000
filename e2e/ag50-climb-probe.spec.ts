import { expect, test, type Page } from '@playwright/test';

// AG-50 临时探针（不提交）：逐帧采样爬梯 + 落地后 1.5s 的相机 scrollY。

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

test('AG-50 探针：落地相机轨迹', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startRun(page);
  await page.keyboard.down('ArrowLeft');
  await page.waitForFunction(() => (window.__PHASER_SESSION__?.getState()?.player.x ?? 999) <= 44, undefined, { timeout: 20_000 });
  await page.keyboard.up('ArrowLeft');

  const sampling = page.evaluate(async () => {
    const out: Array<{ t: number; scrollY: number; y: number; floor: number; climbing: boolean; ease: boolean; dir: number }> = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 3200) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as {
        player?: { y: number };
        stairClimb?: { direction: number } | null;
        landingEase?: boolean;
        lastClimbDirection?: number;
        cameras: { main: { scrollY: number } };
      } | null;
      const s = window.__PHASER_SESSION__?.getState();
      const p = scene?.player;
      if (!p || !s) continue;
      out.push({
        t: performance.now() - t0,
        scrollY: scene.cameras.main.scrollY,
        y: p.y,
        floor: s.currentFloor,
        climbing: !!scene.stairClimb,
        ease: scene.landingEase === true,
        dir: scene.lastClimbDirection ?? 0,
      });
    }
    return out;
  });
  const pressing = page.keyboard.press('E');
  await page.waitForTimeout(520); // 爬梯中段
  await page.screenshot({ path: 'test-results/ag50-climb-mid.png' });
  await pressing;
  const frames = await sampling;

  const landIdx = frames.findIndex((f) => f.floor === 2);
  const climb = frames.slice(0, landIdx === -1 ? frames.length : landIdx);
  const after = landIdx === -1 ? [] : frames.slice(landIdx, landIdx + 90);
  console.log(`[ag50] climb frames=${climb.length} landing at frame#${landIdx}`);
  const landFrame = frames.findIndex((f) => !f.climbing && f.floor === 2);
  const trace: string[] = [];
  for (let i = Math.max(0, landFrame - 6); i < Math.min(frames.length, landFrame + 10); i++) {
    const f = frames[i];
    trace.push(
      `${f.floor === 1 ? 'climb' : 'floor2'} t=${f.t.toFixed(0)} scrollY=${f.scrollY.toFixed(1)} y=${f.y.toFixed(1)} climbing=${f.climbing} ease=${f.ease} dir=${f.dir}`,
    );
  }
  console.log(`[ag50 trace]\n${trace.join('\n')}`);
  if (after.length > 1) {
    const min = Math.min(...after.map((f) => f.scrollY));
    const max = Math.max(...after.map((f) => f.scrollY));
    const last = after[after.length - 1].scrollY;
    console.log(`[ag50 after-landing] scrollY min=${min.toFixed(1)} max=${max.toFixed(1)} last=${last.toFixed(1)} range=${(max - min).toFixed(1)}`);
    const dbg = await page.evaluate(
      () => (window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { __dbg?: unknown } | null)?.__dbg ?? null,
    );
    console.log(`[ag50 dbg] ${JSON.stringify(dbg)}`);
  }
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
