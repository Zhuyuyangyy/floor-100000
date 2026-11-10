import { expect, test, type Page } from '@playwright/test';

// B3-03: actions cost game time, so a day is a budget. Before this, one full
// sweep of five floors cost 4.5 game hours and the player idled through the
// other 9.75. These tests assert the clock actually moves when you act.

interface State {
  day: number;
  gameMinuteOfDay: number;
  currentFloor: number;
  player: { x: number; thirst: number; hunger: number; inventory: { slots: Array<{ itemId: string; quantity: number }> } };
}

async function readState(page: Page): Promise<State> {
  return page.evaluate(() => {
    const handle = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__;
    const s = handle?.getState();
    if (!s) throw new Error('no session');
    return s;
  });
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

async function walkLeftTo(page: Page, x: number): Promise<void> {
  await page.keyboard.down('ArrowLeft');
  await page.waitForFunction(
    (target) => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { x: number } } | null } }).__PHASER_SESSION__?.getState();
      return !!s && s.player.x <= target;
    },
    x,
    { timeout: 15_000 },
  );
  await page.keyboard.up('ArrowLeft');
}

// Floor 1's cabinet (x=160) holds a guaranteed 净水.
async function searchFloorOneCabinet(page: Page): Promise<void> {
  await walkLeftTo(page, 160);
  await page.keyboard.press('E');
  await page.waitForTimeout(250);
}

// 上楼 is the LEFT end of every floor (UP_EXIT_X); floor 1 has no down exit at
// all, so the only way out of the dorm is leftward.
const UP_EXIT_X = 40;

async function climbOneFloor(page: Page, expectedFloor: number): Promise<void> {
  await walkLeftTo(page, UP_EXIT_X);
  for (let i = 0; i < 10; i++) {
    if ((await readState(page)).currentFloor === expectedFloor) return;
    await page.keyboard.press('E');
    await page.waitForTimeout(250);
  }
  if ((await readState(page)).currentFloor === expectedFloor) return;
  throw new Error(`never reached floor ${expectedFloor} (at ${(await readState(page)).currentFloor})`);
}

test('searching a container costs game time', async ({ page }) => {
  await startGame(page, 42);
  const before = await readState(page);

  await searchFloorOneCabinet(page);
  const after = await readState(page);

  // The frame loop advances a little while walking; the action cost must dominate.
  const elapsed = after.gameMinuteOfDay - before.gameMinuteOfDay;
  expect(elapsed, `clock moved only ${elapsed} min`).toBeGreaterThanOrEqual(20);
  // A single search must not silently bill the player a whole hour.
  expect(elapsed).toBeLessThan(45);
});

test('the action cost is visible to the player', async ({ page }) => {
  await startGame(page, 42);
  await walkLeftTo(page, 160);
  await page.keyboard.press('E');
  await page.waitForTimeout(200);
  const shown = await page.evaluate(() => {
    const g = (window as unknown as {
      __PHASER_GAME__?: { scene: { scenes: Array<{ children: { list: Array<{ type: string; text?: string; visible: boolean }> } }> } };
    }).__PHASER_GAME__;
    for (const sc of g?.scene.scenes ?? []) {
      for (const o of sc.children.list ?? []) {
        if (o.type === 'Text' && o.visible && (o.text ?? '').includes('分钟')) return o.text ?? '';
      }
    }
    return '';
  });
  expect(shown, 'the flash should name the time cost').toContain('分钟');
});

test('a climb from floor 1 to floor 5 costs a real slice of the day', async ({ page }) => {
  test.setTimeout(300_000);
  await startGame(page, 42);
  const before = await readState(page);

  // One container on the way out, then climb by walking to each stairwell.
  // An earlier version of this test wrote player.x = 1240 and pressed E, which
  // changed no floor at all: floor 1 has no down exit (hasDownExit(1) is false),
  // so it measured a walk plus one search plus a wait and reported it as a
  // descent. Climb for real — the walk is most of the cost, and that is the
  // honest number.
  await searchFloorOneCabinet(page);
  for (let floor = 2; floor <= 5; floor++) await climbOneFloor(page, floor);

  const after = await readState(page);
  expect(after.currentFloor).toBe(5);
  const cost = after.gameMinuteOfDay - before.gameMinuteOfDay;
  console.log(`[climb] floor 1 -> 5 with one search: ${Math.round(cost)} game minutes`);
  // Walking 4 stairwells plus one search must already be a meaningful slice of
  // the 14 waking hours, and must not silently bill a whole day.
  expect(cost).toBeGreaterThan(40);
  expect(cost).toBeLessThan(240);
});
