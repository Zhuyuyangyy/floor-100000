import { expect, test, type Page } from '@playwright/test';
import type { E2EGameState } from './globals';

// A real player can reach the current fifth-floor cap, but there is no up stair
// there. Pressing E at the left edge used to disappear silently while the HUD
// still promised the long-term goal of reaching floor 100000.
async function startGame(page: Page): Promise<void> {
  await page.goto('/?seed=42');
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((scene) => scene.scene.key === 'Menu'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((scene) => scene.scene.key === 'MetaSelect'));
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.keyboard.press('Enter');
    if (await page.waitForFunction(
      () => window.__PHASER_GAME__?.scene.getScenes(true).some((scene) => scene.scene.key === 'Game'),
      undefined,
      { timeout: 2000 },
    ).then(() => true).catch(() => false)) return;
  }
  throw new Error('Game scene did not start after character selection');
}

async function readState(page: Page): Promise<E2EGameState> {
  return page.evaluate(() => {
    const state = window.__PHASER_SESSION__?.getState();
    if (!state) throw new Error('missing game state');
    return state;
  });
}

async function walkToUpStairs(page: Page): Promise<void> {
  const from = (await readState(page)).player.x;
  if (from <= 40) return;
  await page.keyboard.down('ArrowLeft');
  try {
    await page.waitForFunction(
      () => (window.__PHASER_SESSION__?.getState()?.player.x ?? Number.POSITIVE_INFINITY) <= 40,
      undefined,
      { timeout: 30_000 },
    );
  } finally {
    await page.keyboard.up('ArrowLeft');
  }
  // Let the movement ramp settle before the single E press, as a player would
  // when lining up with the visible stair mouth.
  await page.waitForTimeout(250);
}

async function climbTo(page: Page, floor: number): Promise<void> {
  await walkToUpStairs(page);
  await page.keyboard.press('E');
  await page.waitForFunction((expectedFloor) => {
    const state = window.__PHASER_SESSION__?.getState();
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { stairClimb?: unknown } | null;
    return state?.currentFloor === expectedFloor && !scene?.stairClimb;
  }, floor, { timeout: 6000 });
}

test('E at the fifth-floor upper boundary explains that no higher route is open', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await startGame(page);

  // Successful path: reach the top of the currently playable range with real
  // movement and E presses, without devfloor or direct state changes.
  for (const floor of [2, 3, 4, 5]) await climbTo(page, floor);
  expect((await readState(page)).currentFloor).toBe(5);

  // Clear the landing flash so the assertion can only be satisfied by feedback
  // from the boundary press itself.
  await page.waitForFunction(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { feedbackText?: { text?: string } } | null;
    return !scene?.feedbackText?.text;
  }, undefined, { timeout: 5000 });
  await page.keyboard.press('E');
  const feedback = await page.evaluate(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as {
      feedbackText?: { text?: string; visible?: boolean };
    } | null;
    return { text: scene?.feedbackText?.text ?? '', visible: scene?.feedbackText?.visible ?? false };
  });

  expect(feedback.text).toContain('当前开放范围止于第 5 层');
  expect(feedback.visible).toBe(true);
  expect((await readState(page)).currentFloor).toBe(5);
  await page.screenshot({ path: testInfo.outputPath('top-floor-boundary.png') });
});
