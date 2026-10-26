import { expect, test, type Page } from '@playwright/test';

// P0-08 browser tests: keyboard-navigable title menu + help, a pause menu (ESC)
// that resumes, and an inventory item tooltip.

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

async function startGame(page: Page, seed: number): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter'); // 开始新游戏
  await waitForScene(page, 'Game');
}

async function hasVisibleText(page: Page, substr: string): Promise<boolean> {
  return page.evaluate((sub) => {
    const scenes = (window as unknown as { __PHASER_GAME__?: { scene: { scenes: Array<{ children: { list: Array<{ type: string; text?: string; visible: boolean }> } }> } } }).__PHASER_GAME__?.scene.scenes ?? [];
    return scenes.some((sc) => (sc.children.list ?? []).some((o) => o.type === 'Text' && (o.text ?? '').includes(sub) && o.visible));
  }, substr);
}

test('the title menu is keyboard-navigable and has a help panel', async ({ page }) => {
  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  expect(await hasVisibleText(page, '开始新游戏')).toBe(true);
  expect(await hasVisibleText(page, '操作说明')).toBe(true);
  expect(await hasVisibleText(page, '继续游戏')).toBe(false); // no save yet
  await page.screenshot({ path: 'e2e/screenshots/12-title.png' });

  await page.keyboard.press('ArrowDown'); // -> 操作说明
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  expect(await hasVisibleText(page, 'A/D 或 ←/→ 移动')).toBe(true);
  await page.screenshot({ path: 'e2e/screenshots/13-help.png' });
});

test('ESC opens the pause menu and 继续 resumes the game', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  expect(await hasVisibleText(page, '已暂停')).toBe(true);
  expect(await hasVisibleText(page, '重新开始')).toBe(true);
  await page.screenshot({ path: 'e2e/screenshots/14-pause.png' });

  await page.keyboard.press('Enter'); // 继续游戏
  await page.waitForTimeout(150);
  expect(await hasVisibleText(page, '已暂停')).toBe(false); // closed

  // Responsive again: the player can move.
  const before = await page.evaluate(() => (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { x: number } } } }).__PHASER_SESSION__?.getState().player.x ?? -1);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(300);
  await page.keyboard.up('ArrowRight');
  const after = await page.evaluate(() => (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { x: number } } } }).__PHASER_SESSION__?.getState().player.x ?? -1);
  expect(after).not.toBe(before);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// Regression: MenuScene's per-create caches are class fields, and Phaser does
// not re-run field initialisers on scene restart. 返回标题 re-runs create(), so
// optionTexts must be reset there — otherwise it keeps the previous run's
// objects and refreshOptions() indexes past the end of `entries`, crashing the
// title screen.
test('returning to the title from the pause menu leaves a working title screen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowDown'); // -> 重新开始
  await page.keyboard.press('ArrowDown'); // -> 返回标题
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400); // any crash lands on the next game step

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  await waitForScene(page, 'Menu');

  expect(await hasVisibleText(page, '开始新游戏')).toBe(true);

  // Still keyboard-navigable, which only holds if create() ran to completion.
  await page.keyboard.press('ArrowDown'); // -> 操作说明
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  expect(await hasVisibleText(page, 'A/D 或 ←/→ 移动')).toBe(true);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// GHI-03 M4: a corrupt save must say so. Previously 继续游戏 was listed for any
// save key and pressing it silently did nothing (spec §6: 坏档要提示用户).
test('a corrupt save is reported instead of silently doing nothing', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('floor100000.save.v1', '{ not json');
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  // Two keys delivered inside one frame are unreliable: Phaser re-processes the
  // burst and a single ArrowDown advances the selection twice (reproduced 0/6
  // back-to-back vs 6/6 with a frame between them). Separate the presses.
  await page.waitForTimeout(250);
  expect(await hasVisibleText(page, '继续游戏')).toBe(true); // still listed

  await page.keyboard.press('ArrowDown'); // -> 继续游戏
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  expect(await hasVisibleText(page, '存档损坏')).toBe(true);
  // Still a usable title screen: the new-game entry survives, no white screen.
  await waitForScene(page, 'Menu');
  expect(await hasVisibleText(page, '开始新游戏')).toBe(true);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// GHI-03 M1/M2: a save written before the loot-key migration would pass
// validation and then silently mismatch (looted items respawn), so
// SCHEMA_VERSION was bumped. It must now be refused with a readable reason,
// keeping the new-game entry — not a white screen and not a silent no-op.
test('a save from before the loot-key migration is refused with a reason', async ({ page }) => {
  await page.addInitScript(() => {
    // What 63ee148 and earlier wrote: schemaVersion 1 plus index-style loot keys.
    localStorage.setItem(
      'floor100000.save.v1',
      JSON.stringify({
        schemaVersion: 1,
        runSeed: 42,
        day: 2,
        gameMinuteOfDay: 500,
        currentFloor: 99998,
        status: 'playing',
        player: {
          x: 640,
          hp: 90,
          hunger: 70,
          thirst: 65,
          energy: 80,
          equipped: null,
          homeUpgrades: [],
          inventory: { slotCount: 12, slots: [{ itemId: 'battery', quantity: 1 }] },
        },
        npcStates: {},
        visitedFloors: {
          99998: { openedContainers: ['crate_wood'], lootedItems: ['g:0', 'c:crate_wood:0'], unlockedDoors: [], localEvents: [] },
        },
        worldEvents: { history: [], activeEvent: null },
      }),
    );
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  expect(await hasVisibleText(page, '继续游戏')).toBe(true); // still listed

  await page.keyboard.press('ArrowDown'); // -> 继续游戏
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  expect(await hasVisibleText(page, '存档损坏')).toBe(true);
  // Still a usable title screen: the new-game entry survives, no white screen.
  await waitForScene(page, 'Menu');
  expect(await hasVisibleText(page, '开始新游戏')).toBe(true);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the inventory shows an item tooltip', async ({ page }) => {
  await startGame(page, 42);
  await page.keyboard.press('I');
  await page.waitForTimeout(200);
  expect(await hasVisibleText(page, '净水 · 消耗品 · 水分 +30')).toBe(true);
  await page.keyboard.press('ArrowDown'); // -> 压缩口粮
  await page.waitForTimeout(120);
  expect(await hasVisibleText(page, '压缩口粮 · 消耗品 · 饱食 +30')).toBe(true);
  await page.screenshot({ path: 'e2e/screenshots/15-inventory-tooltip.png' });
});
