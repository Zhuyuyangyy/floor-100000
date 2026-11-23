import { expect, test, type Page } from '@playwright/test';

interface GameState {
  currentFloor: number;
  runSeed: number;
  day: number;
  player: { x: number; inventory: { slots: Array<{ itemId: string; quantity: number }> } };
}
interface Scene {
  encounterOpen: boolean;
  encounter?: { encounter: { kind: string }; resolved: boolean };
  dialogueOpen: boolean;
  dialogue?: { selected: number; level: string; message: string } | null;
  spotMarkers: Map<string, { x: number }>;
  children: { list: Array<{ type: string; text?: string; x: number; y: number; visible: boolean; scrollFactorX?: number; scrollFactorY?: number }> };
}

async function startGame(page: Page): Promise<void> {
  await page.goto('/?seed=42');
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Menu'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect'));
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    if (await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'), undefined, { timeout: 2000 }).then(() => true).catch(() => false)) break;
  }
  await page.waitForFunction(() => !!window.__PHASER_SESSION__?.getState());
}

async function state(page: Page): Promise<GameState> {
  return page.evaluate(() => window.__PHASER_SESSION__!.getState() as unknown as GameState);
}

async function setPlayerX(page: Page, x: number): Promise<void> {
  await page.evaluate((value) => {
    const current = window.__PHASER_SESSION__?.getState() as unknown as GameState | null;
    if (current) current.player.x = value;
  }, x);
}

async function goUpToFloor2(page: Page): Promise<void> {
  await setPlayerX(page, 40);
  for (let attempt = 0; attempt < 5; attempt++) {
    if ((await state(page)).currentFloor === 2) return;
    await page.keyboard.press('e');
    const arrived = await page.waitForFunction(() => {
      const current = window.__PHASER_SESSION__?.getState() as unknown as GameState | null;
      return current?.currentFloor === 2;
    }, undefined, { timeout: 2500 }).then(() => true).catch(() => false);
    if (arrived) return;
  }
  expect((await state(page)).currentFloor).toBe(2);
}

async function clickVisibleText(page: Page, exactText: string): Promise<void> {
  const normalized = await page.evaluate((wanted) => {
    const game = window.__PHASER_GAME__ as unknown as { canvas: HTMLCanvasElement; scene: { getScene: (key: string) => Scene } };
    const scene = game.scene.getScene('Game');
    const matches = scene.children.list.filter((o) => o.type === 'Text' && o.visible && o.text === wanted);
    if (matches.length !== 1) throw new Error(`Expected one visible text ${JSON.stringify(wanted)}, found ${matches.length}`);
    return { x: matches[0].x / game.canvas.width, y: matches[0].y / game.canvas.height };
  }, exactText);
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('Missing Phaser canvas');
  await page.mouse.click(canvas.x + canvas.width * normalized.x, canvas.y + canvas.height * normalized.y);
}

async function visibleTextPoint(page: Page, exactText: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const normalized = await page.evaluate((wanted) => {
    const game = window.__PHASER_GAME__ as unknown as { canvas: HTMLCanvasElement; scene: { getScene: (key: string) => Scene } };
    const scene = game.scene.getScene('Game');
    const matches = scene.children.list.filter((o) => o.type === 'Text' && o.visible && o.text === wanted);
    if (matches.length !== 1) throw new Error(`Expected one visible text ${JSON.stringify(wanted)}, found ${matches.length}`);
    return { x: matches[0].x / game.canvas.width, y: matches[0].y / game.canvas.height };
  }, exactText);
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('Missing Phaser canvas');
  return { x: canvas.x + canvas.width * normalized.x, y: canvas.y + canvas.height * normalized.y, width: canvas.width, height: canvas.height };
}

function totalItems(value: GameState): number {
  return value.player.inventory.slots.reduce((sum, stack) => sum + stack.quantity, 0);
}

test('floor-2 loot can be taken with the mouse and the correctly aligned result closes by mouse', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startGame(page);
  await goUpToFloor2(page);

  // Choose an actual deterministic floor-2 loot spot for this run, rather than
  // fabricating an encounter state; then open it through the normal E interaction.
  const lootSpot = await page.evaluate(async () => {
    const load = new Function('url', 'return import(url)') as (url: string) => Promise<{ rollEncounter: (state: GameState, floor: number, spotId: string) => { kind: string } }>;
    const { rollEncounter } = await load('/src/systems/encounters.ts');
    const scene = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as Scene;
    const current = window.__PHASER_SESSION__!.getState() as unknown as GameState;
    return [...scene.spotMarkers.entries()]
      .filter(([id]) => id.includes(':spot'))
      .map(([id, marker]) => ({ id, x: marker.x, kind: rollEncounter(current, 2, id).kind }))
      .find((spot) => spot.kind === 'loot') ?? null;
  });
  expect(lootSpot, 'seed 42 floor 2 should contain a deterministic loot spot').not.toBeNull();
  await setPlayerX(page, lootSpot!.x);
  await page.keyboard.press('e');
  await expect.poll(async () => page.evaluate(() => (window.__PHASER_GAME__!.scene.getScene('Game') as unknown as Scene).encounterOpen)).toBe(true);
  await expect.poll(async () => page.evaluate(() => (window.__PHASER_GAME__!.scene.getScene('Game') as unknown as Scene).encounter?.encounter.kind)).toBe('loot');

  const before = totalItems(await state(page));
  await clickVisibleText(page, '拿走');
  await expect.poll(async () => page.evaluate(() => (window.__PHASER_GAME__!.scene.getScene('Game') as unknown as Scene).encounter?.resolved)).toBe(true);
  expect(totalItems(await state(page))).toBeGreaterThan(before);

  const resultLayout = await page.evaluate(() => {
    const game = window.__PHASER_GAME__ as unknown as { canvas: HTMLCanvasElement; scene: { getScene: (key: string) => Scene & { encounterObjects: Array<{ type: string; text?: string; y: number; depth: number; scrollFactorX: number; scrollFactorY: number }> } } };
    const scene = game.scene.getScene('Game');
    const texts = scene.encounterObjects.filter((o) => o.type === 'Text' && (o as { visible?: boolean }).visible !== false) as Array<{ text?: string; y: number; depth: number; scrollFactorX: number; scrollFactorY: number }>;
    return { height: game.canvas.height, texts: texts.map(({ text, y, depth, scrollFactorX, scrollFactorY }) => ({ text, y, depth, scrollFactorX, scrollFactorY })) };
  });
  const top = resultLayout.height / 2 - 85;
  const bottom = resultLayout.height / 2 + 85;
  const resultTexts = resultLayout.texts.filter((text) => text.text && text.text.trim().length > 0);
  expect(resultTexts.length).toBeGreaterThanOrEqual(3);
  for (const text of resultTexts) {
    expect(text.scrollFactorX, `${text.text} horizontal screen lock`).toBe(0);
    expect(text.scrollFactorY, `${text.text} vertical screen lock`).toBe(0);
    expect(text.y, `${text.text} should remain inside the outcome frame`).toBeGreaterThanOrEqual(top);
    expect(text.y, `${text.text} should remain inside the outcome frame`).toBeLessThanOrEqual(bottom);
  }

  await clickVisibleText(page, '点击继续 · Enter / ESC');
  await expect.poll(async () => page.evaluate(() => (window.__PHASER_GAME__!.scene.getScene('Game') as unknown as Scene).encounterOpen)).toBe(false);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('Xiaozhou dialogue options respond to mouse clicks, preserve keyboard navigation, and have a mouse return', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startGame(page);
  await goUpToFloor2(page);
  await setPlayerX(page, 800);
  await page.keyboard.press('e');
  await expect.poll(async () => page.evaluate(() => (window.__PHASER_GAME__!.scene.getScene('Game') as unknown as Scene).dialogueOpen)).toBe(true);

  await clickVisibleText(page, '询问');
  await expect.poll(async () => page.evaluate(() => {
    const dialogue = (window.__PHASER_GAME__!.scene.getScene('Game') as unknown as Scene).dialogue;
    return dialogue?.selected === 1 && dialogue.level === 'main' && dialogue.message.includes('食堂(5)');
  })).toBe(true);

  const trade = await visibleTextPoint(page, '交易');
  await page.mouse.move(trade.x, trade.y);
  await expect.poll(async () => page.evaluate(() => (window.__PHASER_GAME__!.scene.getScene('Game') as unknown as Scene).dialogue?.selected)).toBe(2);
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => page.evaluate(() => (window.__PHASER_GAME__!.scene.getScene('Game') as unknown as Scene).dialogue?.selected)).toBe(1);
  const messageBeforeKeyboardActivation = await page.evaluate(() => (window.__PHASER_GAME__!.scene.getScene('Game') as unknown as Scene).dialogue!.message);
  await page.keyboard.press('Enter'); // still runs the original keyboard activation path
  await expect.poll(async () => page.evaluate(() => {
    const dialogue = (window.__PHASER_GAME__!.scene.getScene('Game') as unknown as Scene).dialogue;
    return dialogue?.selected === 1 && dialogue.message !== undefined;
  })).toBe(true);
  expect(await page.evaluate(() => (window.__PHASER_GAME__!.scene.getScene('Game') as unknown as Scene).dialogue!.message)).not.toBe(messageBeforeKeyboardActivation);

  await clickVisibleText(page, '点击选项执行 · ↑/↓选择 · Enter确定 · 点此/ESC返回');
  await expect.poll(async () => page.evaluate(() => (window.__PHASER_GAME__!.scene.getScene('Game') as unknown as Scene).dialogueOpen)).toBe(false);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
