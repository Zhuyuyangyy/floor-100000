import { expect, test } from '@playwright/test';

// Boot smoke: the game opens to the pixel title menu, Enter starts a run into the
// game scene, the player + floor HUD render, and there are no uncaught errors /
// 404s. Phaser renders into the canvas, so we assert on real game state via the
// dev-only window.__PHASER_GAME__ handle, not on DOM text.

async function waitForScene(page: import('@playwright/test').Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === k);
    },
    key,
    { timeout: 20_000 },
  );
}

async function hasVisibleText(page: import('@playwright/test').Page, substr: string): Promise<boolean> {
  return page.evaluate((sub) => {
    const scenes = (window as unknown as { __PHASER_GAME__?: { scene: { scenes: Array<{ children: { list: Array<{ type: string; text?: string; visible: boolean }> } }> } } }).__PHASER_GAME__?.scene.scenes ?? [];
    return scenes.some((sc) => (sc.children.list ?? []).some((o) => o.type === 'Text' && (o.text ?? '').includes(sub) && o.visible));
  }, substr);
}

test('boots to the pixel title and Enter starts into the game scene', async ({ page }) => {
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
  });

  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  expect(await hasVisibleText(page, '第100000层')).toBe(true);
  expect(await hasVisibleText(page, '开始新游戏')).toBe(true);

  await page.keyboard.press('Enter');
  // A new run lands on the character pick first.
  await waitForScene(page, 'MetaSelect');
  // The pick screen reports active before create() binds its keys, so an
  // Enter can land in that window and be lost. Retry until the run starts.
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const started = await page.waitForFunction(
      () => {
        const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
        return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
      },
      undefined,
      { timeout: 2000 },
    ).then(() => true).catch(() => false);
    if (started) break;
  }
  await waitForScene(page, 'Game');

  // The scene reports active before create() finishes, so wait for the player
  // sprite itself rather than sampling the display list once — a one-shot
  // evaluate is a coin flip on the transition timing.
  await page.waitForFunction(
    () => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; texture?: { key: string } }> } } | null } } }).__PHASER_GAME__;
      const list = g?.scene.getScene('Game')?.children.list ?? [];
      return list.some((o) => o.type === 'Sprite' && (o.texture?.key ?? '').startsWith('char-'));
    },
    undefined,
    { timeout: 10_000 },
  );
  const rendered = await page.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; texture?: { key: string }; text?: string }> } } | null } } }).__PHASER_GAME__;
    const list = g?.scene.getScene('Game')?.children.list ?? [];
    return {
      player: list.some((o) => o.type === 'Sprite' && (o.texture?.key ?? '').startsWith('char-')),
      floor: list.some((o) => o.type === 'Text' && /层/.test(o.text ?? '')),
    };
  });
  expect(rendered.player).toBe(true);
  expect(rendered.floor).toBe(true);

  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  expect(failedRequests, `failed requests: ${failedRequests.join(' | ')}`).toEqual([]);
});
