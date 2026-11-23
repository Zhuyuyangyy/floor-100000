import { expect, test, type Page } from '@playwright/test';

interface State {
  player: { x: number; thirst: number; inventory: { slots: Array<{ itemId: string; quantity: number }> } };
}

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === k);
    },
    key,
    { timeout: 15_000 },
  );
}

async function startGame(page: Page): Promise<void> {
  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const started = await page.waitForFunction(
      () => {
        const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
        return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
      },
      undefined,
      { timeout: 2_000 },
    ).then(() => true).catch(() => false);
    if (started) break;
  }
  await waitForScene(page, 'Game');
}

async function leftOfCabinet(page: Page): Promise<void> {
  await page.keyboard.down('ArrowLeft');
  await page.waitForFunction(
    () => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      return !!s && s.player.x <= 204;
    },
    undefined,
    { timeout: 20_000 },
  );
  await page.keyboard.up('ArrowLeft');
}

async function visibleInventoryObjects(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const g = window.__PHASER_GAME__ as unknown as {
      scene: { getScene: (key: string) => { children: { list: Array<{ type: string; visible: boolean; texture?: { key?: string } }> } } | null };
    };
    const objects = g.scene.getScene('Game')?.children.list ?? [];
    return objects
      .filter((o) => o.visible && (['clean_water', 'ration_pack', 'flashlight', 'ui-marker'].includes(o.texture?.key ?? '')))
      .map((o) => o.texture?.key ?? '');
  });
}

test('searching a floor-one locker after closing the used inventory keeps its icons and marker hidden', async ({ page }) => {
  await startGame(page);
  const initial = await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    return s?.player.thirst ?? 0;
  });

  await page.keyboard.press('I');
  await expect.poll(() => visibleInventoryObjects(page)).toEqual(expect.arrayContaining(['clean_water', 'ration_pack', 'flashlight', 'ui-marker']));
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    (thirst) => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      return !!s && s.player.thirst > thirst;
    },
    initial,
    { timeout: 5_000 },
  );
  await page.keyboard.press('I');
  expect(await visibleInventoryObjects(page)).toEqual([]);

  await leftOfCabinet(page);
  await page.keyboard.press('E');
  await expect.poll(() => visibleInventoryObjects(page)).toEqual([]);
});
