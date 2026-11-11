import { expect, test, type Page } from '@playwright/test';

type ItemStack = { itemId: string; quantity: number };
type GameStateView = {
  currentFloor: number;
  player: { x: number; gold: number; inventory: { slots: ItemStack[] } };
};
type SceneView = {
  scene: { getScenes: (active?: boolean) => Array<{ scene: { key: string } }> };
};
type GameSceneView = {
  spotMarkers?: Map<string, { x: number }>;
  encounterOpen?: boolean;
  shopEntries?: Array<{ itemId: string; price: number }>;
  shopSelected?: number;
  children: { list: Array<{ type: string; text?: string; visible: boolean }> };
};

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (sceneKey) => {
      const game = (window as unknown as { __PHASER_GAME__?: SceneView }).__PHASER_GAME__;
      return !!game?.scene.getScenes(true).some((scene) => scene.scene.key === sceneKey);
    },
    key,
    { timeout: 20_000 },
  );
}

async function startGame(page: Page, seed: number): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  // MetaSelect can become active before its keyboard handler is bound.
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.keyboard.press('Enter');
    const started = await page.waitForFunction(
      () => window.__PHASER_GAME__?.scene.getScenes(true).some((scene) => scene.scene.key === 'Game'),
      undefined,
      { timeout: 2_000 },
    ).then(() => true).catch(() => false);
    if (started) break;
  }
  await waitForScene(page, 'Game');
}

async function readState(page: Page): Promise<GameStateView> {
  return page.evaluate(() => {
    const state = (window as unknown as {
      __PHASER_SESSION__?: { getState: () => GameStateView | null };
    }).__PHASER_SESSION__?.getState();
    if (!state) throw new Error('missing active game state');
    return state;
  });
}

async function visibleGameText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const game = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (key: string) => GameSceneView | null } };
    }).__PHASER_GAME__;
    return (game?.scene.getScene('Game')?.children.list ?? [])
      .filter((object) => object.type === 'Text' && object.visible && object.text)
      .map((object) => object.text ?? '');
  });
}

async function textBounds(page: Page, needle: string): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate((search) => {
    type TextView = { type: string; text?: string; visible: boolean; getBounds?: () => { x: number; y: number; width: number; height: number } };
    const game = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (key: string) => { children: { list: TextView[] } } | null } };
    }).__PHASER_GAME__;
    const object = game?.scene.getScene('Game')?.children.list.find((entry) => entry.type === 'Text' && entry.visible && entry.text?.includes(search));
    if (!object?.getBounds) throw new Error(`missing visible text bounds: ${search}`);
    return object.getBounds();
  }, needle);
}

async function walkWithin(page: Page, targetX: number, radius: number): Promise<void> {
  const state = await readState(page);
  const direction = targetX < state.player.x ? 'ArrowLeft' : 'ArrowRight';
  await page.keyboard.down(direction);
  try {
    await page.waitForFunction(
      ({ target, reach }) => {
        const state = (window as unknown as {
          __PHASER_SESSION__?: { getState: () => GameStateView | null };
        }).__PHASER_SESSION__?.getState();
        return !!state && Math.abs(state.player.x - target) <= reach;
      },
      { target: targetX, reach: radius },
      { timeout: 20_000 },
    );
  } finally {
    await page.keyboard.up(direction);
  }
  // Let the movement ramp brake before interacting; the player remains in range.
  await page.waitForTimeout(120);
}

async function pressInteractUntilFloor(page: Page, floor: number): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    if ((await readState(page)).currentFloor === floor) return;
    await page.keyboard.press('E');
    const arrived = await page.waitForFunction(
      (expectedFloor) => {
        const state = (window as unknown as {
          __PHASER_SESSION__?: { getState: () => GameStateView | null };
        }).__PHASER_SESSION__?.getState();
        return state?.currentFloor === expectedFloor;
      },
      floor,
      { timeout: 1_800 },
    ).then(() => true).catch(() => false);
    if (arrived) return;
  }
  throw new Error(`could not reach floor ${floor} through the stair interaction`);
}

async function shopIsOpen(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const game = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (key: string) => GameSceneView | null } };
    }).__PHASER_GAME__;
    const scene = game?.scene.getScene('Game') as (GameSceneView & {
      encounterOpen?: boolean;
      shopEntries?: Array<unknown>;
    }) | null;
    return !!scene?.encounterOpen && !!scene.shopEntries?.length;
  });
}

async function openShop(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    if (await shopIsOpen(page)) return;
    await page.keyboard.press('E');
    await page.waitForTimeout(180);
  }
  expect(await shopIsOpen(page), 'E should open the nearby trader shop').toBe(true);
}

async function shopLocation(page: Page): Promise<number> {
  return page.evaluate(() => {
    const game = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (key: string) => GameSceneView | null } };
    }).__PHASER_GAME__;
    const scene = game?.scene.getScene('Game') as (GameSceneView & {
      spotMarkers?: Map<string, { x: number }>;
    }) | null;
    const x = scene?.spotMarkers?.get('shop')?.x;
    if (typeof x !== 'number') throw new Error('the floor has no visible shop marker');
    return x;
  });
}

async function shopSelection(page: Page): Promise<number> {
  return page.evaluate(() => {
    const game = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (key: string) => GameSceneView | null } };
    }).__PHASER_GAME__;
    const scene = game?.scene.getScene('Game') as (GameSceneView & { shopSelected?: number }) | null;
    return scene?.shopSelected ?? -1;
  });
}

function countItem(state: GameStateView, itemId: string): number {
  return state.player.inventory.slots
    .filter((stack) => stack.itemId === itemId)
    .reduce((total, stack) => total + stack.quantity, 0);
}

test('live trader shop: real approach, visible stock and blocked purchase', async ({ page }, testInfo) => {
  await startGame(page, 42);

  // Reach floor 2 by walking to the visible stairwell and using the game's E interaction.
  await walkWithin(page, 40, 24);
  await pressInteractUntilFloor(page, 2);

  // Read the live trader marker only to navigate toward it; all movement and opening
  // are performed through real keyboard input, with no test-only state mutation.
  const traderX = await shopLocation(page);
  await walkWithin(page, traderX, 24);
  await openShop(page);

  const actual = await readState(page);
  expect(actual.currentFloor).toBe(2);
  const gold = actual.player.gold;
  const breadCount = countItem(actual, 'bread');
  const waterCount = countItem(actual, 'clean_water');
  const texts = await visibleGameText(page);
  const rendered = texts.join('\n');

  expect(texts).toContain('行商');
  expect(rendered).toContain(`${gold} 金`);
  expect(rendered).toContain('面包');
  expect(rendered).toContain('净水');
  expect(rendered).toContain('12 金');
  expect(rendered).toContain('15 金');
  expect(texts.some((text) => new RegExp(`持(?:有)?\\s*${breadCount}(?:\\D|$)`).test(text))).toBe(true);
  expect(texts.some((text) => new RegExp(`持(?:有)?\\s*${waterCount}(?:\\D|$)`).test(text))).toBe(true);
  expect(rendered).toContain('金币不足');
  expect(rendered).toContain('S卖出');
  expect(rendered).toContain('Esc离开');

  const [breadQuote, waterQuote, affordabilityHint] = await Promise.all([
    textBounds(page, '12 金'),
    textBounds(page, '15 金'),
    textBounds(page, '金币不足'),
  ]);
  expect(affordabilityHint.y, 'affordability hint must clear the selected row').toBeGreaterThanOrEqual(breadQuote.y + breadQuote.height);
  expect(affordabilityHint.y + affordabilityHint.height, 'affordability hint must clear the next stock row').toBeLessThanOrEqual(waterQuote.y);

  // Exercise the shop's arrow-key browsing and return to the first (面包) row.
  expect(await shopSelection(page)).toBe(0);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => shopSelection(page)).toBe(1);
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => shopSelection(page)).toBe(0);

  // Capture the live, unmodified shop state in this test run's isolated output directory.
  await page.screenshot({ path: testInfo.outputPath('trade-live-shop.png') });

  const before = await readState(page);
  expect(before.player.gold).toBeLessThan(12);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await visibleGameText(page)).join('\n')).toContain('金币不够');
  const after = await readState(page);
  expect(after.player.gold).toBe(before.player.gold);
  expect(countItem(after, 'bread')).toBe(countItem(before, 'bread'));

  // Sell one carried clean-water bottle through the game's normal S shortcut.
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => shopSelection(page)).toBe(1);
  const beforeSale = await readState(page);
  expect(countItem(beforeSale, 'clean_water')).toBeGreaterThan(0);
  await page.keyboard.press('S');
  await expect.poll(async () => (await readState(page)).player.gold).toBe(beforeSale.player.gold + 7);
  const afterSale = await readState(page);
  expect(countItem(afterSale, 'clean_water')).toBe(countItem(beforeSale, 'clean_water') - 1);
  await expect.poll(async () => (await visibleGameText(page)).join('\n')).toContain('卖出成功：净水×1');
});
