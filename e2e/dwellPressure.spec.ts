import { expect, test, type Page } from '@playwright/test';

// B3-15: lingering on a floor must eventually cost something. The dorm is
// exempt by design (home is always the escape), so the test climbs to floor 2
// through the real up-exit and then waits out the first roll — 60 game-minutes
// at 3 game-minutes per real second is about 20 real seconds, so this spec
// spends half a minute proving the timer runs in the actual game loop rather
// than only in unit tests.

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

test('lingering on a floor rolls dwell pressure', async ({ page }) => {
  // The roll needs 60 game-minutes of dwell. At full speed that is ~20 real
  // seconds, but the frame delta is clamped (MAX_FRAME_MS), so a slow, GPU-less
  // runner stretches the same 60 minutes well past that. The wait below already
  // allows 90s; the test itself was still on the default 30s, so the two
  // contradicted each other and the spec failed on CI while passing locally.
  test.setTimeout(180_000);

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?seed=42');
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

  // Climb to floor 2 through the real exit. Wait for the landing: the stair
  // traversal takes 1000 ms, and a blind 220 ms retry can start a second climb
  // on the exact commit frame (measured: the run ended on floor 5 at x=40).
  for (let attempt = 0; attempt < 6; attempt++) {
    const floor = await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.currentFloor);
    if (floor === 2) break;
    await page.evaluate(() => {
      const s = window.__PHASER_SESSION__?.getState();
      if (s) s.player.x = 40; // UP_EXIT_X
    });
    await page.keyboard.press('E');
    await page
      .waitForFunction(() => window.__PHASER_SESSION__?.getState()?.currentFloor === 2, undefined, { timeout: 3000 })
      .catch(() => undefined);
  }
  expect(await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.currentFloor)).toBe(2);

  // The dwell tracker must exist and be counting on this floor...
  const before = await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.worldEvents.dwell);
  expect(before?.floor).toBe(2);

  // ...and the first roll must fire on its own, from the frame loop alone.
  await page.waitForFunction(
    () => (window.__PHASER_SESSION__?.getState()?.worldEvents.dwell?.rolls ?? 0) > 0,
    undefined,
    { timeout: 90_000 },
  );

  // Whatever the roll was, the day's event slot rules still hold: at most one
  // active event, and a dwell-rolled wanderer belongs to this floor.
  const after = await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    return { dwell: s?.worldEvents.dwell, event: s?.worldEvents.activeEvent as { type?: string; floor?: number; source?: string } | null };
  });
  expect(after.dwell!.rolls).toBeGreaterThan(0);
  if (after.event) {
    if (after.event.source === 'dwell') expect(after.event.floor).toBe(2);
  }

  await page.screenshot({ path: 'e2e/screenshots/35-dwell-pressure.png' });
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
