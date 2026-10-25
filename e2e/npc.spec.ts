import { expect, test, type Page } from '@playwright/test';

// P0-06 browser tests: talk to both neighbours, complete barter trades that
// change the bag, a failed trade leaves no half-exchange, and back/exit don't
// get stuck. State is read (and, for setup, mutated) via the dev-only handle.

interface State {
  currentFloor: number;
  player: { x: number; inventory: { slots: Array<{ itemId: string; quantity: number }> } };
}

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
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Game');
}

async function readState(page: Page): Promise<State> {
  return page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    return s;
  });
}

async function count(page: Page, itemId: string): Promise<number> {
  const s = await readState(page);
  return s.player.inventory.slots.filter((x) => x.itemId === itemId).reduce((n, x) => n + x.quantity, 0);
}

async function setX(page: Page, x: number): Promise<void> {
  await page.evaluate((v) => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (s) s.player.x = v;
  }, x);
}

async function hasVisibleText(page: Page, substr: string): Promise<boolean> {
  return page.evaluate((sub) => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean }> } } | null } } }).__PHASER_GAME__;
    const list = g?.scene.getScene('Game')?.children.list ?? [];
    return list.some((o) => o.type === 'Text' && (o.text ?? '').includes(sub) && o.visible);
  }, substr);
}

// Press a key with a small settle delay (back-to-back synthetic presses can
// otherwise outrun the frame-based input and skip a menu step).
async function tap(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
  await page.waitForTimeout(60);
}

// Reach the neighbour floor by stepping onto the down-exit and pressing E.
async function goToNeighborFloor(page: Page): Promise<void> {
  await setX(page, 1200); // near the down-exit (x=1240)
  await page.keyboard.press('E');
  await page.waitForFunction(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    return !!s && s.currentFloor === 99999;
  }, undefined, { timeout: 5000 });
}

test('trade with 阿林 changes the bag (电线 for 废金属)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await goToNeighborFloor(page);
  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    s?.player.inventory.slots.push({ itemId: 'scrap_metal', quantity: 1 });
  });

  await setX(page, 480); // next to 阿林
  await page.keyboard.press('E');
  await page.waitForFunction(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean }> } } | null } } }).__PHASER_GAME__;
    const list = g?.scene.getScene('Game')?.children.list ?? [];
    return list.some((o) => o.type === 'Text' && (o.text ?? '').includes('阿林（维修工）') && o.visible);
  }, undefined, { timeout: 5000 });

  await tap(page, 'ArrowDown');
  await tap(page, 'ArrowDown'); // -> 交易
  await tap(page, 'Enter'); // -> trade menu
  await page.screenshot({ path: 'e2e/screenshots/09-npc-trade.png' });
  await tap(page, 'Enter'); // -> offer 0 (电线 <- 废金属)

  await page.waitForFunction(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    return !!s && s.player.inventory.slots.some((x) => x.itemId === 'wire');
  }, undefined, { timeout: 5000 });

  expect(await count(page, 'wire')).toBe(1);
  expect(await count(page, 'scrap_metal')).toBe(0);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('trade with 小周 changes the bag (面包 for 口粮)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await goToNeighborFloor(page);
  const rationBefore = await count(page, 'ration_pack');
  expect(rationBefore).toBeGreaterThanOrEqual(1);

  await setX(page, 800); // next to 小周
  await page.keyboard.press('E');
  await page.waitForFunction(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean }> } } | null } } }).__PHASER_GAME__;
    const list = g?.scene.getScene('Game')?.children.list ?? [];
    return list.some((o) => o.type === 'Text' && (o.text ?? '').includes('小周（邻居）') && o.visible);
  }, undefined, { timeout: 5000 });

  await tap(page, 'ArrowDown');
  await tap(page, 'ArrowDown');
  await tap(page, 'Enter'); // -> 交易
  await tap(page, 'Enter'); // -> offer 0 (面包 <- 口粮)

  await page.waitForFunction(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    return !!s && s.player.inventory.slots.some((x) => x.itemId === 'bread');
  }, undefined, { timeout: 5000 });

  expect(await count(page, 'bread')).toBe(1);
  expect(await count(page, 'ration_pack')).toBe(rationBefore - 1);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a failed trade leaves no half-exchange', async ({ page }) => {
  await startGame(page, 42);
  await goToNeighborFloor(page);
  // No 废金属 given: 阿林's 电线<-废金属 offer must fail.
  await setX(page, 480);
  await page.keyboard.press('E');
  await tap(page, 'ArrowDown');
  await tap(page, 'ArrowDown');
  await tap(page, 'Enter'); // 交易
  await tap(page, 'Enter'); // offer 0
  await page.waitForTimeout(250);

  expect(await count(page, 'wire')).toBe(0);
  expect(await count(page, 'scrap_metal')).toBe(0);
  expect(await hasVisibleText(page, '你没有足够的废金属')).toBe(true);
});

test('back and exit do not get stuck', async ({ page }) => {
  await startGame(page, 42);
  await goToNeighborFloor(page);
  await setX(page, 480);
  await page.keyboard.press('E');
  expect(await hasVisibleText(page, '阿林（维修工）')).toBe(true);

  await tap(page, 'ArrowDown');
  await tap(page, 'ArrowDown');
  await tap(page, 'Enter'); // -> 交易
  await tap(page, 'ArrowDown');
  await tap(page, 'ArrowDown');
  await tap(page, 'Enter'); // -> 返回 (back to main)
  await tap(page, 'ArrowDown');
  await tap(page, 'ArrowDown');
  await tap(page, 'ArrowDown');
  await tap(page, 'Enter'); // -> 退出 (close)

  await page.waitForFunction(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean }> } } | null } } }).__PHASER_GAME__;
    const list = g?.scene.getScene('Game')?.children.list ?? [];
    return !list.some((o) => o.type === 'Text' && (o.text ?? '').includes('阿林（维修工）') && o.visible);
  }, undefined, { timeout: 5000 });

  // Not stuck: pressing E re-opens the dialogue.
  await page.keyboard.press('E');
  expect(await hasVisibleText(page, '阿林（维修工）')).toBe(true);
});
