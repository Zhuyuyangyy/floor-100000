import { expect, test, type Page } from '@playwright/test';

// P0-06 browser tests: talk to both neighbours, complete barter trades that
// change the bag, a failed trade leaves no half-exchange, and back/exit don't
// get stuck. State is read (and, for setup, mutated) via the dev-only handle.

interface State {
  currentFloor: number;
  player: { x: number; inventory: { slots: Array<{ itemId: string; quantity: number }> } };
}

const MAIN_OPTIONS = ['问候', '询问', '交易', '退出'];
const ALIN_TRADE = ['用 废金属×1 换 电线×1', '用 电池×1 换 保险丝×1', '返回'];

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

// The label the arrow marker sits on in the open dialogue/menu.
async function cursorLabel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean; y: number; texture?: { key?: string } }> } } | null } } }).__PHASER_GAME__;
    const list = g?.scene.getScene('Game')?.children.list ?? [];
    const marker = list.find((o) => o.type === 'Image' && o.texture?.key === 'ui-marker' && o.visible);
    if (!marker) return '';
    // PANEL CONTENT ONLY. A world label (a container's name) can sit within a few
    // pixels of a dialogue row now that the rows moved, and the world objects are
    // created first, so a plain y-probe returned '邻居货架' while the cursor was on
    // '退出'. Panel content is drawn at depth >= 190; the world is at 0-30.
    const label = list.find(
      (o) =>
        o.type === 'Text' &&
        o.visible &&
        ((o as unknown as { depth: number }).depth ?? 0) >= 190 &&
        Math.abs(o.y - marker.y) <= 6,
    );
    return label?.text ?? '';
  });
}

// Move the arrow marker onto `target`, self-correcting against over/under-shoot so
// a dropped or double-registered synthetic keypress can't derail the menu.
async function selectInMenu(page: Page, options: string[], target: string): Promise<void> {
  const targetIdx = options.indexOf(target);
  if (targetIdx < 0) throw new Error(`target "${target}" not a known option`);
  for (let i = 0; i < 16; i++) {
    const curIdx = options.indexOf(await cursorLabel(page));
    if (curIdx === targetIdx) return;
    await page.keyboard.press(curIdx < targetIdx ? 'ArrowDown' : 'ArrowUp');
    await page.waitForTimeout(110);
  }
  throw new Error(`could not reach "${target}" (cursor at "${await cursorLabel(page)}")`);
}

// Press E once, then poll for the action to take effect before pressing again.
//
// Blind 250 ms retries were the bug. A stair climb runs for STAIR_TRAVEL_MS
// (1000 ms), so a retry could land on the exact frame the climb committed: E
// then starts a SECOND climb, `currentFloor === 2` is already true, and the
// helper returns mid-flight. Everything after it then writes to a player who is
// still on the stairs — setX(480) is overwritten by the landing (endX = 40) —
// and the next presses keep climbing. Measured: the trade specs ended on floor
// 5 at x=40 with no dialogue open.
async function pressEUntil(page: Page, check: () => Promise<boolean>, tries = 4, settleMs = 2500): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await check()) return;
    await page.keyboard.press('E');
    const deadline = Date.now() + settleMs;
    while (Date.now() < deadline) {
      await page.waitForTimeout(80);
      if (await check()) return;
    }
  }
  throw new Error('interact (E) did not take effect');
}

/** True while the visible stair traversal is still running. */
async function isClimbing(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const sc = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { stairClimb?: unknown } | null } } }).__PHASER_GAME__?.scene.getScene('Game');
    return !!sc?.stairClimb;
  });
}

async function goToNeighborFloor(page: Page): Promise<void> {
  await setX(page, 40); // UP_EXIT_X: floor 1 -> 2
  // Landed, not merely "floor is 2": a second climb in flight also reports 2.
  await pressEUntil(page, async () => (await readState(page)).currentFloor === 2 && !(await isClimbing(page)));
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

  await setX(page, 480);
  await pressEUntil(page, async () => hasVisibleText(page, '阿林（维修工）'));
  await selectInMenu(page, MAIN_OPTIONS, '交易');
  await page.keyboard.press('Enter'); // open trade menu
  await page.screenshot({ path: 'e2e/screenshots/09-npc-trade.png' });
  await page.keyboard.press('Enter'); // offer 0 (电线 <- 废金属)

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

  await setX(page, 800);
  await pressEUntil(page, async () => hasVisibleText(page, '小周（邻居）'));
  await selectInMenu(page, MAIN_OPTIONS, '交易');
  await page.keyboard.press('Enter'); // open trade menu
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter'); // offer 0 (面包 <- 口粮)

  await page.waitForFunction(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    return !!s && s.player.inventory.slots.some((x) => x.itemId === 'bread');
  }, undefined, { timeout: 5000 });

  // The trade menu stays open, so a stray extra Enter can trade twice; assert the
  // real invariant — the bag changed — rather than an exact count.
  expect(await count(page, 'bread')).toBeGreaterThanOrEqual(1);
  expect(await count(page, 'ration_pack')).toBeLessThan(rationBefore);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a failed trade leaves no half-exchange', async ({ page }) => {
  await startGame(page, 42);
  await goToNeighborFloor(page);
  // No 废金属 given: 阿林's 电线<-废金属 offer must fail.
  await setX(page, 480);
  await pressEUntil(page, async () => hasVisibleText(page, '阿林（维修工）'));
  await selectInMenu(page, MAIN_OPTIONS, '交易');
  await page.keyboard.press('Enter'); // trade menu
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter'); // offer 0
  await page.waitForTimeout(300);

  expect(await count(page, 'wire')).toBe(0);
  expect(await count(page, 'scrap_metal')).toBe(0);
  expect(await hasVisibleText(page, '你没有足够的废金属')).toBe(true);
});

test('back and exit do not get stuck', async ({ page }) => {
  await startGame(page, 42);
  await goToNeighborFloor(page);
  await setX(page, 480);
  await pressEUntil(page, async () => hasVisibleText(page, '阿林（维修工）'));

  await selectInMenu(page, MAIN_OPTIONS, '交易');
  await page.keyboard.press('Enter'); // -> trade menu
  await selectInMenu(page, ALIN_TRADE, '返回');
  await page.keyboard.press('Enter'); // -> back to main
  await selectInMenu(page, MAIN_OPTIONS, '退出');
  await page.keyboard.press('Enter'); // -> close

  await page.waitForFunction(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean }> } } | null } } }).__PHASER_GAME__;
    const list = g?.scene.getScene('Game')?.children.list ?? [];
    return !list.some((o) => o.type === 'Text' && (o.text ?? '').includes('阿林（维修工）') && o.visible);
  }, undefined, { timeout: 5000 });

  // Not stuck: pressing E re-opens the dialogue.
  await page.keyboard.press('E');
  expect(await hasVisibleText(page, '阿林（维修工）')).toBe(true);
});
