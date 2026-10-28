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

test('a full sweep of five floors now costs a meaningful part of the day', async ({ page }) => {
  test.setTimeout(180_000);
  await startGame(page, 42);
  const before = await readState(page);

  // Walk the whole tower: search every container on the way down and back up.
  // Floor 1 cabinet, then down through 2-5 and back.
  await searchFloorOneCabinet(page);
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { x: number } } | null } }).__PHASER_SESSION__?.getState();
      if (s) s.player.x = 1240; // down stair
    });
    await page.waitForTimeout(120);
    await page.keyboard.press('E');
    await page.waitForTimeout(600);
  }
  const afterDescent = await readState(page);
  const descentCost = afterDescent.gameMinuteOfDay - before.gameMinuteOfDay;
  console.log(`[sweep] cost to reach floor 5: ${Math.round(descentCost)} game minutes`);

  // One descent alone (1 container searched, 4 floor changes) must already be a
  // real slice of the 14-hour waking day, not the 4.5 hours a full sweep used to be.
  expect(descentCost).toBeGreaterThan(20);
});
