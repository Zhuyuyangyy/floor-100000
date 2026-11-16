import { expect, test, type Page } from '@playwright/test';

// AG-50 临时调试（不提交）：双击跑订单逐帧 trace。

async function startRun(page: Page, seed = 42): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await page.waitForFunction(() => {
    const g = (window as unknown as { __PHASER_GAME__: { scene: { getScenes: (a: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
    return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Menu');
  }, undefined, { timeout: 30_000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const g = (window as unknown as { __PHASER_GAME__: { scene: { getScenes: (a: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
    return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect' || s.scene.key === 'Game');
  }, undefined, { timeout: 30_000 });
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const ok = await page.waitForFunction(() => {
      const g = (window as unknown as { __PHASER_GAME__: { scene: { getScenes: (a: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
    }, undefined, { timeout: 2000 }).then(() => true).catch(() => false);
    if (ok) break;
  }
}

test('AG-50 debug: 双击跑 trace', async ({ page }) => {
  test.setTimeout(120_000);
  await startRun(page);
  // 先走一段拉开距离
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(() => ((window as never as { __PHASER_SESSION__: { getState: () => { player: { x: number } } } }).__PHASER_SESSION__?.getState().player.x ?? 0) > 800, undefined, { timeout: 15_000 });
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(300);

  const p = await page.evaluate(() => {
    const cam = (window as never as { __PHASER_GAME__: { scene: { getScene: (k: string) => { cameras: { main: { scrollX: number; scrollY: number } } } } } }).__PHASER_GAME__.scene.getScene('Game').cameras.main;
    return { x: 200 - cam.scrollX, y: 150 - cam.scrollY + 40 };
  });
  console.log(`[dbg] clicking page (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`);
  await page.mouse.dblclick(p.x, p.y);

  const trace = await page.evaluate(async () => {
    type S = {
      walkTarget: { x: number; run: boolean } | null;
      lastClick?: { x: number; at: number };
      speedX: number;
      keyShift?: { isDown: boolean };
      cursors?: { left: { isDown: boolean }; right: { isDown: boolean } };
      wasd?: { left: { isDown: boolean }; right: { isDown: boolean } };
      player: { x: number };
      time: { now: number };
    };
    const out: string[] = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 1000) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const s = (window as never as { __PHASER_GAME__: { scene: { getScene: (k: string) => S } } }).__PHASER_GAME__.scene.getScene('Game');
      const st = (window as never as { __PHASER_SESSION__: { getState: () => { player: { x: number } } } }).__PHASER_SESSION__.getState();
      out.push(
        `t=${(performance.now() - t0).toFixed(0)} wt=${s.walkTarget ? `${s.walkTarget.x.toFixed(0)}${s.walkTarget.run ? 'R' : 'W'}` : 'null'} ` +
          `speedX=${s.speedX.toFixed(0)} px=${st.player.x.toFixed(0)} shift=${s.keyShift?.isDown} ` +
          `cur=${s.cursors?.right.isDown}/${s.cursors?.left.isDown} wasd=${s.wasd?.right.isDown}/${s.wasd?.left.isDown}`,
      );
    }
    return out;
  });
  console.log(`[dbg trace]\n${trace.slice(0, 40).join('\n')}`);
  expect(trace.length).toBeGreaterThan(10);
});
