import { expect, test, type Page } from '@playwright/test';

// P0-02 interaction test: real keyboard movement, a real E floor switch, and a
// no-duplicate-sprite check across scene restarts. Reads GameState through the
// dev-only window.__PHASER_SESSION__ handle.

async function readState(page: Page): Promise<{ currentFloor: number; x: number }> {
  return page.evaluate(() => {
    const handle = (
      window as unknown as { __PHASER_SESSION__?: { getState: () => { currentFloor: number; player: { x: number } } | null } }
    ).__PHASER_SESSION__;
    const s = handle?.getState();
    if (!s) throw new Error('no session state');
    return { currentFloor: s.currentFloor, x: s.player.x };
  });
}

test('player walks, switches floor via E, and never duplicates', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/?seed=42');

  // Wait for the title menu, then start the run with Enter.
  await page.waitForFunction(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
    return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Menu');
  }, undefined, { timeout: 30_000 });

  await page.keyboard.press('Enter');

  // A new run lands on the character pick first; the pick screen reports
  // active before create() binds its keys, so settle before confirming.
  await page.waitForFunction(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
    return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect' || s.scene.key === 'Game');
  }, undefined, { timeout: 30_000 });
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

  await page.waitForFunction(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
    return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
  }, undefined, { timeout: 10_000 });

  const start = await readState(page);
  expect(start.currentFloor).toBe(1);

  // Walk right.
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(400);
  await page.keyboard.up('ArrowRight');
  const afterRight = (await readState(page)).x;
  expect(afterRight).toBeGreaterThan(start.x);

  // Walk left (A key).
  await page.keyboard.down('A');
  await page.waitForTimeout(400);
  await page.keyboard.up('A');
  const afterLeft = (await readState(page)).x;
  expect(afterLeft).toBeLessThan(afterRight);

  // Walk to the up-exit (left end) and switch floor with E.
  await page.keyboard.down('ArrowLeft');
  await page.waitForFunction(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { x: number } } | null } }).__PHASER_SESSION__?.getState();
    return !!s && s.player.x < 44;
  }, undefined, { timeout: 20_000 });
  await page.keyboard.up('ArrowLeft');

  await page.keyboard.press('E');
  await page.waitForFunction(() => {
    const s = window.__PHASER_SESSION__?.getState();
    const g = window.__PHASER_GAME__ as unknown as { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; y?: number; texture?: { key: string } }> } } | null } };
    const player = g.scene.getScene('Game')?.children.list.find((o) => o.type === 'Sprite' && (o.texture?.key ?? '').startsWith('char-'));
    return !!s && s.currentFloor === 1 && typeof player?.y === 'number' && player.y < 160;
  }, undefined, { timeout: 1000 });
  expect((await readState(page)).currentFloor).toBe(1); // commits only on landing
  await page.waitForFunction(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { currentFloor: number } | null } }).__PHASER_SESSION__?.getState();
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; texture?: { key: string } }> } } | null } } }).__PHASER_GAME__;
    const list = g?.scene.getScene('Game')?.children.list ?? [];
    const hasPlayer = list.some((o) => o.type === 'Sprite' && (o.texture?.key ?? '').startsWith('char-'));
    return !!s && s.currentFloor === 2 && hasPlayer;
  }, undefined, { timeout: 10_000 });

  const afterSwitch = await readState(page);
  expect(afterSwitch.currentFloor).toBe(2);
  expect(afterSwitch.x).toBe(1240); // landed at floor 2's down stair

  const playerCount = await page.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; texture?: { key: string } }> } } | null } } }).__PHASER_GAME__;
    const list = g?.scene.getScene('Game')?.children.list ?? [];
    return list.filter((o) => o.type === 'Sprite' && o.texture?.key === 'char-player-walk').length;
  });
  expect(playerCount).toBe(1); // no duplicate cloning across scene restart

  await page.screenshot({ path: 'e2e/screenshots/04-floor-2.png' });

  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
});
