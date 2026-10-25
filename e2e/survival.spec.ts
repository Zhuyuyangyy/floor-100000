import { expect, test, type Page } from '@playwright/test';

// P0-04 browser tests: real-time decay while standing still, sleeping to pass
// the night, and the death / victory end screens. State is read (and, for test
// setup, mutated) via the dev-only window.__PHASER_SESSION__ handle.

interface State {
  status: string;
  day: number;
  gameMinuteOfDay: number;
  player: { x: number; hp: number; thirst: number; hunger: number; energy: number; inventory: { slots: unknown[] } };
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

async function walkRightTo(page: Page, x: number): Promise<void> {
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(
    (target) => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      return !!s && s.player.x >= target;
    },
    x,
    { timeout: 20_000 },
  );
  await page.keyboard.up('ArrowRight');
}

test('standing still advances the clock and decays survival stats', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  const before = await readState(page);
  expect(before.day).toBe(1);

  await page.waitForFunction(
    () => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      return !!s && s.gameMinuteOfDay > 380 && s.player.thirst < 80;
    },
    undefined,
    { timeout: 20_000 },
  );
  const after = await readState(page);
  expect(after.gameMinuteOfDay).toBeGreaterThan(before.gameMinuteOfDay);
  expect(after.player.thirst).toBeLessThan(before.player.thirst);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('sleeping in the dorm advances to the next day', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (s) {
      s.day = 1;
      s.gameMinuteOfDay = 1200; // 20:00, sleep allowed
    }
  });
  await walkRightTo(page, 1090); // to the bed at x=1120
  await page.keyboard.press('E');

  await page.waitForFunction(
    () => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      return !!s && s.day === 2;
    },
    undefined,
    { timeout: 5000 },
  );
  const s = await readState(page);
  expect(s.day).toBe(2);
  expect(s.gameMinuteOfDay).toBeGreaterThanOrEqual(360); // next morning (06:00), then ticking
  expect(s.status).toBe('playing');
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('dehydration causes death and shows the lose screen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (s) {
      s.player.hp = 1;
      s.player.thirst = 0;
    }
  });
  await waitForScene(page, 'End');
  const s = await readState(page);
  expect(s.status).toBe('lost');
  await page.screenshot({ path: 'e2e/screenshots/07-lose.png' });
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('surviving to day 8 wins', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (s) {
      s.day = 7;
      s.gameMinuteOfDay = 1200;
    }
  });
  await walkRightTo(page, 1090);
  await page.keyboard.press('E');
  await waitForScene(page, 'End');
  const s = await readState(page);
  expect(s.status).toBe('won');
  expect(s.day).toBe(8);
  await page.screenshot({ path: 'e2e/screenshots/06-win.png' });
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
