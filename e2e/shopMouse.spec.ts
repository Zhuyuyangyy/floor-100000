import { expect, test, type Page } from '@playwright/test';

interface State {
  player: { x: number; gold: number; inventory: { slots: Array<{ itemId: string; quantity: number }> } };
}
interface Rect { left: number; right: number; top: number; bottom: number }
interface Scene {
  spotMarkers: Map<string, { x: number }>;
  shopSelected: number;
  encounterOpen: boolean;
  hintText: { text: string };
  feedbackText: { text: string };
  children: { list: Array<{ type: string; name: string; text?: string; x: number; y: number; visible: boolean; getBounds: () => Rect }> };
}

async function startAtTrader(page: Page): Promise<void> {
  await page.goto('/?seed=42');
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Menu'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect'));
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'));
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__PHASER_SESSION__!.getState()!.player.x = 40; });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__PHASER_SESSION__?.getState()?.currentFloor === 2, undefined, { timeout: 10_000 });
  await page.evaluate(() => {
    const scene = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as Scene;
    const shop = scene.spotMarkers.get('shop');
    if (!shop) throw new Error('No trader on floor 2');
    window.__PHASER_SESSION__!.getState()!.player.x = shop.x;
  });
}

async function state(page: Page): Promise<State> {
  return page.evaluate(() => window.__PHASER_SESSION__!.getState() as unknown as State);
}

async function sceneState(page: Page): Promise<{ selected: number; open: boolean; hint: string; feedback: string }> {
  return page.evaluate(() => {
    const scene = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as Scene;
    return { selected: scene.shopSelected, open: scene.encounterOpen, hint: scene.hintText.text, feedback: scene.feedbackText.text };
  });
}

async function clickText(page: Page, label: string): Promise<void> {
  const point = await page.evaluate((wanted) => {
    const game = window.__PHASER_GAME__! as typeof window.__PHASER_GAME__ & { canvas: HTMLCanvasElement };
    const scene = game.scene.getScene('Game') as unknown as Scene;
    const matches = scene.children.list.filter((o) => o.type === 'Text' && o.visible && o.text === wanted);
    if (matches.length !== 1) throw new Error(`Expected one visible ${wanted}, got ${matches.length}`);
    // Shop labels are left-aligned, action buttons are centred. Both points lie inside their hit areas.
    return { x: (matches[0].x + (wanted === '净水' ? 15 : 0)) / game.canvas.width, y: matches[0].y / game.canvas.height };
  }, label);
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('Missing canvas');
  await page.mouse.click(canvas.x + point.x * canvas.width, canvas.y + point.y * canvas.height);
}

function count(s: State, id: string): number {
  return s.player.inventory.slots.filter((slot) => slot.itemId === id).reduce((n, slot) => n + slot.quantity, 0);
}

test('trader hints, readable prices and explicit mouse buy/sell actions', async ({ page }) => {
  await startAtTrader(page);
  await expect.poll(async () => (await sceneState(page)).hint).toContain('行商');
  await page.keyboard.press('e');
  await expect.poll(async () => (await sceneState(page)).open).toBe(true);
  await expect.poll(async () => (await sceneState(page)).hint).toContain('买入');

  const bounds = await page.evaluate(() => {
    const scene = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as Scene;
    const texts = scene.children.list.filter((o) => o.type === 'Text' && o.visible);
    const status = texts.find((o) => o.name === 'shop-status');
    const help = texts.find((o) => o.name === 'shop-help');
    if (!status || !help) throw new Error('No shop status or help');
    const snapshot = (object: typeof status) => {
      const rect = object.getBounds();
      return { top: rect.top, bottom: rect.bottom, right: rect.right };
    };
    const game = window.__PHASER_GAME__! as typeof window.__PHASER_GAME__ & { canvas: HTMLCanvasElement };
    return { status: snapshot(status), help: snapshot(help), panelRight: game.canvas.width / 2 + 220, prices: texts.filter((o) => o.text?.includes('金 · 持')).map(snapshot) };
  });
  expect(bounds.prices.length).toBe(2);
  for (const price of bounds.prices) {
    expect(bounds.status.top).toBeGreaterThanOrEqual(price.bottom);
  }
  expect(bounds.help.right).toBeLessThanOrEqual(bounds.panelRight - 8);

  const before = await state(page);
  await clickText(page, '净水');
  await expect.poll(async () => (await sceneState(page)).selected).toBe(1);
  expect(count(await state(page), 'clean_water')).toBe(count(before, 'clean_water'));
  await clickText(page, '买入');
  await expect.poll(async () => (await sceneState(page)).feedback).toContain('金币不够');
  expect(count(await state(page), 'clean_water')).toBe(count(before, 'clean_water'));

  await clickText(page, '卖出');
  await expect.poll(async () => count(await state(page), 'clean_water')).toBe(count(before, 'clean_water') - 1);
  expect((await state(page)).player.gold).toBe(before.player.gold + 7);
  await page.evaluate(() => { (window.__PHASER_SESSION__!.getState() as unknown as State).player.gold = 30; });
  await clickText(page, '买入');
  await expect.poll(async () => count(await state(page), 'clean_water')).toBe(count(before, 'clean_water'));
  expect((await state(page)).player.gold).toBe(15);
  await clickText(page, '关闭');
  await expect.poll(async () => (await sceneState(page)).open).toBe(false);
  await expect.poll(async () => (await sceneState(page)).hint).toContain('行商');
});

test('successful mouse trades survive an immediate reload while the shop is open', async ({ page }) => {
  test.setTimeout(90_000);
  await startAtTrader(page);
  await page.evaluate(() => { (window.__PHASER_SESSION__!.getState() as unknown as State).player.gold = 30; });
  await page.keyboard.press('e');
  await expect.poll(async () => (await sceneState(page)).open).toBe(true);
  const initial = await state(page);
  await clickText(page, '净水');
  await clickText(page, '卖出');
  await expect.poll(async () => (await state(page)).player.gold).toBe(37);
  const soldWater = count(initial, 'clean_water') - 1;
  expect(count(await state(page), 'clean_water')).toBe(soldWater);

  const reloadAndContinue = async () => {
    await page.reload();
    await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Menu'));
    await page.waitForTimeout(250);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'));
  };
  await reloadAndContinue();
  expect((await state(page)).player.gold).toBe(37);
  expect(count(await state(page), 'clean_water')).toBe(soldWater);

  await page.waitForTimeout(300);
  await page.keyboard.press('e');
  await expect.poll(async () => (await sceneState(page)).open).toBe(true);
  await clickText(page, '买入'); // default selection is bread, costing 12
  await expect.poll(async () => (await state(page)).player.gold).toBe(25);
  expect(count(await state(page), 'bread')).toBe(count(initial, 'bread') + 1);
  await reloadAndContinue();
  expect((await state(page)).player.gold).toBe(25);
  expect(count(await state(page), 'bread')).toBe(count(initial, 'bread') + 1);
  expect(count(await state(page), 'clean_water')).toBe(soldWater);
});
