import { expect, test, type Page } from '@playwright/test';

interface Stack { itemId: string; quantity: number }
interface State {
  player: { hunger: number; homeUpgrades: string[]; inventory: { slots: Stack[] } };
}
interface Rectangle { x: number; y: number; width: number; height: number }
interface Scene {
  inventoryOpen: boolean;
  craftingOpen: boolean;
  invSelected: number;
  craftSelected: number;
  invCells: Rectangle[];
  craftRows: Array<{ band: Rectangle }>;
  invDetailName: { text: string };
  feedbackText: { text: string };
  children: { list: Array<{ type: string; text?: string; x: number; y: number; visible: boolean }> };
}

async function startGame(page: Page): Promise<void> {
  await page.goto('/?seed=42');
  await page.waitForFunction(() => {
    const g = window.__PHASER_GAME__;
    return g?.scene.getScenes(true).some((s) => s.scene.key === 'Menu');
  });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect'));
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    if (await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'), undefined, { timeout: 2000 }).then(() => true).catch(() => false)) break;
  }
  await page.waitForFunction(() => !!window.__PHASER_SESSION__?.getState());
}

async function sceneState(page: Page): Promise<{ inv: boolean; craft: boolean; invSelected: number; craftSelected: number; detail: string; feedback: string }> {
  return page.evaluate(() => {
    const scene = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as Scene;
    return { inv: scene.inventoryOpen, craft: scene.craftingOpen, invSelected: scene.invSelected, craftSelected: scene.craftSelected, detail: scene.invDetailName.text, feedback: scene.feedbackText.text };
  });
}

async function gameState(page: Page): Promise<State> {
  return page.evaluate(() => window.__PHASER_SESSION__!.getState() as unknown as State);
}

async function clickGameObject(page: Page, target: { kind: 'cell' | 'row'; index: number } | { kind: 'text'; label: string }): Promise<void> {
  const point = await page.evaluate((wanted) => {
    const game = window.__PHASER_GAME__! as typeof window.__PHASER_GAME__ & { canvas: HTMLCanvasElement };
    const scene = game.scene.getScene('Game') as unknown as Scene;
    let x: number;
    let y: number;
    if (wanted.kind === 'text') {
      const matches = scene.children.list.filter((o) => o.type === 'Text' && o.visible && o.text === wanted.label);
      if (matches.length !== 1) throw new Error(`Expected one visible ${wanted.label} button, got ${matches.length}`);
      ({ x, y } = matches[0]);
    } else {
      const rect = wanted.kind === 'cell' ? scene.invCells[wanted.index] : scene.craftRows[wanted.index].band;
      x = rect.x + rect.width / 2;
      y = rect.y + rect.height / 2;
    }
    return { x: x / game.canvas.width, y: y / game.canvas.height };
  }, target);
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('Missing canvas');
  await page.mouse.click(canvas.x + canvas.width * point.x, canvas.y + canvas.height * point.y);
}

function count(state: State, itemId: string): number {
  return state.player.inventory.slots.filter((s) => s.itemId === itemId).reduce((n, s) => n + s.quantity, 0);
}

test('mouse selects an inventory item without consuming it; explicit use and close work', async ({ page }) => {
  await startGame(page);
  await page.keyboard.press('i');
  await expect.poll(async () => (await sceneState(page)).inv).toBe(true);
  const before = await gameState(page);
  expect(count(before, 'ration_pack')).toBeGreaterThan(0);

  await clickGameObject(page, { kind: 'cell', index: 1 });
  await expect.poll(async () => (await sceneState(page)).invSelected).toBe(1);
  expect((await sceneState(page)).detail).toBe('压缩口粮');
  expect(count(await gameState(page), 'ration_pack')).toBe(count(before, 'ration_pack'));
  await clickGameObject(page, { kind: 'cell', index: 11 }); // empty cells do not replace the selection
  expect((await sceneState(page)).invSelected).toBe(1);

  await clickGameObject(page, { kind: 'text', label: '使用' });
  await expect.poll(async () => count(await gameState(page), 'ration_pack')).toBe(count(before, 'ration_pack') - 1);
  expect((await gameState(page)).player.hunger).toBeGreaterThan(before.player.hunger);
  await clickGameObject(page, { kind: 'text', label: '关闭' });
  await expect.poll(async () => (await sceneState(page)).inv).toBe(false);
});

test('mouse selects a recipe without crafting; explicit action deducts materials and closes', async ({ page }) => {
  await startGame(page);
  await page.evaluate(() => {
    const state = window.__PHASER_SESSION__!.getState() as unknown as State;
    state.player.inventory.slots.push({ itemId: 'wood', quantity: 2 }, { itemId: 'tape', quantity: 1 });
  });
  await page.keyboard.press('c');
  await expect.poll(async () => (await sceneState(page)).craft).toBe(true);
  await clickGameObject(page, { kind: 'row', index: 1 });
  await expect.poll(async () => (await sceneState(page)).craftSelected).toBe(1);
  let state = await gameState(page);
  expect(state.player.homeUpgrades).not.toContain('reinforced_door');
  expect(count(state, 'wood')).toBe(2);

  await clickGameObject(page, { kind: 'text', label: '制作 / 净化' });
  await expect.poll(async () => (await gameState(page)).player.homeUpgrades.includes('reinforced_door')).toBe(true);
  state = await gameState(page);
  expect(count(state, 'wood')).toBe(0);
  expect(count(state, 'tape')).toBe(0);
  await clickGameObject(page, { kind: 'text', label: '关闭' });
  await expect.poll(async () => (await sceneState(page)).craft).toBe(false);
});

test('mouse crafting with insufficient materials shows a refusal', async ({ page }) => {
  await startGame(page);
  await page.keyboard.press('c');
  await expect.poll(async () => (await sceneState(page)).craft).toBe(true);
  await clickGameObject(page, { kind: 'row', index: 1 });
  await clickGameObject(page, { kind: 'text', label: '制作 / 净化' });
  await expect.poll(async () => (await sceneState(page)).feedback).toContain('材料不足');
  expect((await gameState(page)).player.homeUpgrades).not.toContain('reinforced_door');
});
