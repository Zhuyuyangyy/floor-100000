import { expect, test, type Page } from '@playwright/test';

// P0-09: a real browser first-day loop — loot a container, watch survival stats
// decay as time passes, then sleep in the dorm to reach day 2.

interface State {
  day: number;
  gameMinuteOfDay: number;
  currentFloor: number;
  player: { x: number; hp: number; thirst: number; inventory: { slots: Array<{ itemId: string; quantity: number }> } };
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

const readState = (page: Page): Promise<State> =>
  page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    return s;
  });

const setX = (page: Page, x: number): Promise<void> =>
  page.evaluate((v) => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (s) s.player.x = v;
  }, x);

const setScalar = (page: Page, patch: { day?: number; gameMinuteOfDay?: number }): Promise<void> =>
  page.evaluate((p) => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (s) Object.assign(s, p);
  }, patch);

// Press E once, then poll before pressing again. A blind fixed retry can fire
// on the frame a stair climb commits and start a second one.
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

test('plays a real first-day loop: loot, decay, then sleep to day 2', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await page.screenshot({ path: 'e2e/screenshots/16-day1-start.png' });

  // Loot the dorm cabinet (x=160) — it holds a guaranteed 净水.
  const waterBefore = (await readState(page)).player.inventory.slots.find((x) => x.itemId === 'clean_water')?.quantity ?? 0;
  await setX(page, 160);
  await pressEUntil(page, async () => {
    const s = await readState(page);
    return (s.player.inventory.slots.find((x) => x.itemId === 'clean_water')?.quantity ?? 0) > waterBefore;
  });

  // Time passes → thirst decays.
  await setScalar(page, { gameMinuteOfDay: 700 });
  await page.waitForFunction(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    return !!s && s.player.thirst < 80;
  }, undefined, { timeout: 5000 });

  // Night falls; return to the dorm bed (x=1120) and sleep → day 2.
  await setScalar(page, { gameMinuteOfDay: 1200 });
  await setX(page, 1120);
  await pressEUntil(page, async () => (await readState(page)).day === 2);

  const after = await readState(page);
  expect(after.day).toBe(2);
  expect(after.gameMinuteOfDay).toBeGreaterThanOrEqual(360); // next morning
  await page.screenshot({ path: 'e2e/screenshots/17-day2.png' });
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
