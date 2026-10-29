import { expect, test, type Page } from '@playwright/test';

// Visual baseline for the five playable floors (docs/05_ART_GUIDE.md §3).
//
// The floors are meant to be readable as *places*, not as five differently
// coloured voids: floor 1 is the player's dorm, 2 lived-in worker housing, 3 a
// neglected store room, 4 exposed maintenance, 5 a communal canteen. These
// screenshots are the artifact that claim is checked against — they are
// regenerated on every run, so a regression in the room dressing shows up as a
// diff rather than as "it looked fine last week".

interface State {
  currentFloor: number;
  player: { x: number };
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

async function readState(page: Page): Promise<State> {
  return page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    return s;
  }) as Promise<State>;
}

// Climb to `target` through the real up-exit, retrying the E press: Phaser's
// frame-based input occasionally drops a single synthetic keypress.
async function climbTo(page: Page, target: number): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    if ((await readState(page)).currentFloor === target) return;
    await page.evaluate(() => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      if (s) s.player.x = 40; // UP_EXIT_X
    });
    await page.keyboard.press('E');
    await page.waitForTimeout(220);
  }
  throw new Error(`could not climb to floor ${target} (at ${(await readState(page)).currentFloor})`);
}

const FLOOR_LABELS: Record<number, string> = {
  1: '30-floor-1-dorm',
  2: '31-floor-2-worker-dorms',
  3: '32-floor-3-storage',
  4: '33-floor-4-maintenance',
  5: '34-floor-5-canteen',
};

test('every playable floor has a distinct, readable room', async ({ page }) => {
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

  for (const floor of [1, 2, 3, 4, 5]) {
    if (floor > 1) await climbTo(page, floor);
    expect((await readState(page)).currentFloor).toBe(floor);
    // Let the floor finish drawing before the shutter.
    await page.waitForTimeout(250);
    await page.screenshot({ path: `e2e/screenshots/${FLOOR_LABELS[floor]}.png` });
  }

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
