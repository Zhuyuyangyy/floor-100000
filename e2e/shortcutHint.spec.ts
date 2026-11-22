import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../src/core/gameTypes';

async function startGame(page: Page): Promise<void> {
  await page.goto('/?seed=42');
  await page.waitForFunction(() => !!window.__PHASER_GAME__?.scene.getScenes(true).some((scene) => scene.scene.key === 'Menu'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !!window.__PHASER_GAME__?.scene.getScenes(true).some((scene) => scene.scene.key === 'MetaSelect'));
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.keyboard.press('Enter');
    if (await page.waitForFunction(() => !!window.__PHASER_GAME__?.scene.getScenes(true).some((scene) => scene.scene.key === 'Game'), undefined, { timeout: 2000 }).then(() => true).catch(() => false)) return;
  }
  throw new Error('Game scene did not start after character selection');
}

async function reachFloorFourStairs(page: Page): Promise<void> {
  await page.keyboard.down('ArrowLeft');
  try {
    await page.waitForFunction(() => (window.__PHASER_SESSION__?.getState()?.player.x ?? Infinity) <= 44, undefined, { timeout: 20_000 });
  } finally {
    await page.keyboard.up('ArrowLeft');
  }
  for (const floor of [2, 3, 4]) {
    await page.keyboard.press('E');
    await page.waitForFunction((expected) => {
      const state = window.__PHASER_SESSION__?.getState();
      const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { stairClimb?: unknown } | null;
      return state?.currentFloor === expected && !scene?.stairClimb;
    }, floor, { timeout: 7000 });
  }
}

test('floor-four shortcut hint matches the real charge on failure and success', async ({ page }) => {
  await startGame(page);
  await reachFloorFourStairs(page);
  const before = await page.evaluate(() => {
    const state = window.__PHASER_SESSION__?.getState() as unknown as GameState | null;
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as {
      children: { list: Array<{ name: string; text?: string }> };
    } | null;
    const hint = scene?.children.list.find((object) => object.name === 'hud-hint')?.text ?? '';
    return { floor: state?.currentFloor, gold: state?.player.gold, hint };
  });
  expect(before.floor).toBe(4);
  expect(before.gold).toBe(0);
  expect(before.hint).toContain('F 抄近路');
  const quoted = Number(before.hint.match(/F 抄近路（(\d+) 金）/)?.[1]);
  expect(Number.isFinite(quoted)).toBe(true);
  mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/shortcut-floor-four-hint.png' });

  // No test-only inventory or floor mutation: the broke-player failure is a real F press.
  await page.keyboard.press('f');
  const rejection = await page.evaluate(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { feedbackText?: { text?: string } } | null;
    return scene?.feedbackText?.text ?? '';
  });
  expect(rejection).toContain(`抄近路要 ${quoted} 金`);
  expect(await page.evaluate(() => {
    const state = window.__PHASER_SESSION__?.getState() as unknown as GameState | null;
    return { floor: state?.currentFloor, gold: state?.player.gold, shortcuts: state?.shortcuts ?? 0 };
  })).toEqual({ floor: 4, gold: 0, shortcuts: 0 });

  // A fixture supplies funds only to exercise the successful transaction; it does not skip or claim a full gameplay journey.
  await page.evaluate((gold) => {
    const state = window.__PHASER_SESSION__?.getState() as unknown as GameState | null;
    if (!state) throw new Error('missing game state');
    state.player.gold = gold;
  }, quoted);
  await page.keyboard.press('f');
  await page.waitForFunction(() => window.__PHASER_SESSION__?.getState()?.currentFloor === 5, undefined, { timeout: 5000 });
  const success = await page.evaluate(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { feedbackText?: { text?: string } } | null;
    return scene?.feedbackText?.text ?? '';
  });
  expect(success).toContain(`-${quoted} 金`);
  expect(await page.evaluate(() => {
    const state = window.__PHASER_SESSION__?.getState() as unknown as GameState | null;
    return { floor: state?.currentFloor, gold: state?.player.gold, shortcuts: state?.shortcuts ?? 0 };
  })).toEqual({ floor: 5, gold: 0, shortcuts: 1 });
});
