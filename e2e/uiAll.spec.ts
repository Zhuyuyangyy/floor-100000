import { expect, test, type Page } from '@playwright/test';

// TEMPORARY probe: screenshot every UI surface with the current build, so the
// whole interface can be reviewed in one pass instead of surface by surface.
// Most existing screenshots predate the furniture rescale and the character art.

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === k);
    },
    key,
    { timeout: 30_000 },
  );
}

const shot = (page: Page, name: string): Promise<Buffer> => page.screenshot({ path: `e2e/screenshots/ui-all-${name}.png` });

test('every UI surface, screenshotted', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  await shot(page, '01-title');

  // help panel
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  await shot(page, '02-help');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  // Reload so the menu's selection is back on 开始新游戏 — closing the help panel
  // leaves the cursor on 操作说明, and one more Enter would reopen it.
  await page.reload();
  await waitForScene(page, 'Menu');
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
  await page.waitForTimeout(600);
  await shot(page, '03-hud');

  // inventory
  await page.keyboard.press('I');
  await page.waitForTimeout(400);
  await shot(page, '04-inventory');
  await page.keyboard.press('I');
  await page.waitForTimeout(300);

  // craft
  await page.keyboard.press('C');
  await page.waitForTimeout(400);
  await shot(page, '05-craft');
  await page.keyboard.press('C');
  await page.waitForTimeout(300);

  // pause + tower map
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await shot(page, '06-pause');
  await page.keyboard.press('ArrowDown'); // -> 塔楼地图
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  await shot(page, '07-tower-overview');
  await page.keyboard.press('Enter'); // drill into the sector
  await page.waitForTimeout(700);
  await shot(page, '08-tower-sector');
  await page.keyboard.press('Enter'); // drill into the floor
  await page.waitForTimeout(700);
  await shot(page, '09-tower-floor');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // death screen — the only ending a normal run can reach
  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { hp: number; thirst: number } } | null } }).__PHASER_SESSION__?.getState();
    if (s) {
      s.player.hp = 1;
      s.player.thirst = 0;
    }
  });
  await page.waitForFunction(
    () => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'End');
    },
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(500);
  await shot(page, '10-end-lose');

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// The win branch is unreachable in a normal run; only the retired day-8 fixture
// sets status='won', so this is the only way to see that screen.
test('the win screen, through the fixture', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?seed=42&devwin=1');
  await waitForScene(page, 'Menu');
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
  // The fixture wins at day 8 06:00. Sitting one game minute short of it means the
  // frame loop trips the threshold immediately, instead of burning 200 real seconds
  // walking the clock there.
  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { day: number; gameMinuteOfDay: number } | null } }).__PHASER_SESSION__?.getState();
    if (s) {
      s.day = 8;
      s.gameMinuteOfDay = 359;
    }
  });
  await waitForScene(page, 'End');
  await page.waitForTimeout(600);
  await shot(page, '11-end-win');

  const texts = await page.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean }> } } | null } } }).__PHASER_GAME__;
    return (g?.scene.getScene('End')?.children.list ?? [])
      .filter((o) => o.type === 'Text' && o.visible && (o.text ?? '').length > 0)
      .map((o) => o.text as string);
  });
  console.log('WIN SCREEN:\n  ' + texts.join('\n  '));
});
