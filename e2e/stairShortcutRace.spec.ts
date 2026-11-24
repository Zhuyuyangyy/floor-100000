import { expect, test, type Page } from '@playwright/test';
import { markAlinGateOpenForUnrelatedTraversal } from './alinGateFixture';

interface RaceState {
  currentFloor: number;
  gameMinuteOfDay: number;
  shortcuts?: number;
  player: { x: number; gold: number };
}

interface Snapshot {
  currentFloor: number;
  gold: number;
  shortcuts: number;
  gameMinuteOfDay: number;
  climbing: boolean;
}

async function startGame(page: Page): Promise<void> {
  await page.goto('/?seed=42');
  await page.waitForFunction(() => !!window.__PHASER_GAME__?.scene.getScenes(true).some((scene) => scene.scene.key === 'Menu'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !!window.__PHASER_GAME__?.scene.getScenes(true).some((scene) => scene.scene.key === 'MetaSelect'));
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.keyboard.press('Enter');
    if (await page.waitForFunction(
      () => !!window.__PHASER_GAME__?.scene.getScenes(true).some((scene) => scene.scene.key === 'Game'),
      undefined,
      { timeout: 2000 },
    ).then(() => true).catch(() => false)) return;
  }
  throw new Error('Game scene did not start after character selection');
}

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const state = window.__PHASER_SESSION__?.getState() as unknown as RaceState | null;
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as {
      stairClimb?: { elapsedMs: number };
    } | null;
    if (!state) throw new Error('missing game state');
    return {
      currentFloor: state.currentFloor,
      gold: state.player.gold,
      shortcuts: state.shortcuts ?? 0,
      gameMinuteOfDay: state.gameMinuteOfDay,
      climbing: !!scene?.stairClimb,
    };
  });
}

async function placeAtUpStairs(page: Page, gold?: number): Promise<void> {
  await page.evaluate((amount) => {
    const state = window.__PHASER_SESSION__?.getState() as unknown as RaceState | null;
    if (!state) throw new Error('missing game state');
    state.player.x = 40;
    if (amount !== undefined) state.player.gold = amount;
  }, gold);
}

async function climbOneFloor(page: Page, floor: number): Promise<void> {
  await placeAtUpStairs(page);
  await page.keyboard.press('E');
  await page.waitForFunction((expectedFloor) => {
    const state = window.__PHASER_SESSION__?.getState();
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { stairClimb?: unknown } | null;
    return state?.currentFloor === expectedFloor && !scene?.stairClimb;
  }, floor, { timeout: 5000 });
}

test('F during the second-floor stair climb cannot charge or race the landing', async ({ page }) => {
  await startGame(page);
  await markAlinGateOpenForUnrelatedTraversal(page);
  await climbOneFloor(page, 2);

  // Seed enough test funds to make the race consequential. The shortcut itself
  // remains a real browser-key action; no scene method is invoked by the test.
  await placeAtUpStairs(page, 500);
  await page.keyboard.press('E');
  await page.waitForFunction(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as {
      stairClimb?: { elapsedMs: number };
    } | null;
    return !!scene?.stairClimb && scene.stairClimb.elapsedMs >= 180 && scene.stairClimb.elapsedMs < 900;
  }, undefined, { timeout: 3000 });

  const whileClimbing = await snapshot(page);
  expect(whileClimbing).toMatchObject({ currentFloor: 2, gold: 500, shortcuts: 0, climbing: true });
  await page.keyboard.press('F');

  // A valid shortcut at the old stair-mouth coordinates used to charge here
  // while the independent stair traversal was still in flight.
  const afterShortcutKey = await snapshot(page);
  expect(afterShortcutKey).toMatchObject({ currentFloor: 2, gold: 500, shortcuts: 0, climbing: true });
  const feedback = await page.evaluate(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as {
      feedbackText?: { text?: string };
    } | null;
    return scene?.feedbackText?.text ?? '';
  });
  expect(feedback).toContain('楼梯攀爬中，落地后再用近路');
  await page.waitForTimeout(120);
  const stillClimbing = await snapshot(page);
  expect(stillClimbing.climbing).toBe(true);
  expect(stillClimbing.gameMinuteOfDay).toBe(whileClimbing.gameMinuteOfDay);

  await page.waitForFunction(() => {
    const state = window.__PHASER_SESSION__?.getState();
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { stairClimb?: unknown } | null;
    return state?.currentFloor === 3 && !scene?.stairClimb;
  }, undefined, { timeout: 5000 });
  expect(await snapshot(page)).toMatchObject({ currentFloor: 3, gold: 500, shortcuts: 0, climbing: false });
});
