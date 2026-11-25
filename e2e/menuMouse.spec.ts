import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * 等到菜单条目真的可点，再开始用鼠标。
 *
 * waitForScene('Menu') 只证明场景**激活**了——它在 create() 跑完之前就为真。
 * 而 MenuScene 把每个条目的 alpha 从 0 补间到 1（350ms + i*140ms 的延迟），
 * Phaser 的 inputCandidate 要求 willRender() 为真才接受命中，alpha=0 的条目
 * 直接不被考虑。于是在淡入窗口内移鼠标/点下去都是空操作：
 *
 *   实测 alpha=0 时 hitTest 命中 0 个对象，悬停后 selected 仍是 0；
 *   alpha=1 时同一坐标命中 1 个对象，悬停后 selected 变成 1。
 *
 * 这不是游戏缺陷（玩家看不见的东西不该可点），是探针问早了一步：用例断言
 * 「鼠标能操作菜单」，前提是菜单已经呈现给玩家。等 alpha 到位再问。
 */
async function waitForMenuReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const game = (window as unknown as {
        __PHASER_GAME__?: { scene: { getScene: (key: string) => { children: { list: Array<{ type: string; text?: string; alpha: number; visible: boolean }> } } | null } };
      }).__PHASER_GAME__;
      const list = game?.scene.getScene('Menu')?.children.list ?? [];
      const entries = list.filter((o) => o.type === 'Text' && o.visible && (o.text === '开始新游戏' || o.text === '开始 AI NPC 试玩' || o.text === '继续游戏' || o.text === '操作说明'));
      return entries.length > 0 && entries.every((o) => o.alpha >= 1);
    },
    undefined,
    { timeout: 20_000 },
  );
}

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (wanted) => {
      const game = (window as unknown as {
        __PHASER_GAME__?: { scene: { getScenes: (activeOnly?: boolean) => Array<{ scene: { key: string } }> } };
      }).__PHASER_GAME__;
      return !!game && game.scene.getScenes(true).some((scene) => scene.scene.key === wanted);
    },
    key,
    { timeout: 20_000 },
  );
}

async function hasVisibleText(page: Page, text: string): Promise<boolean> {
  return page.evaluate((wanted) => {
    const scenes = (window as unknown as {
      __PHASER_GAME__?: { scene: { scenes: Array<{ children: { list: Array<{ type: string; text?: string; visible: boolean }> } }> } };
    }).__PHASER_GAME__?.scene.scenes ?? [];
    return scenes.some((scene) => scene.children.list.some((object) =>
      object.type === 'Text' && object.visible && (object.text ?? '').includes(wanted)));
  }, text);
}

async function selectedMenuOption(page: Page): Promise<string> {
  return page.evaluate(() => {
    const game = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (key: string) => { children: { list: Array<{ type: string; text?: string; y: number; visible: boolean; texture?: { key?: string } }> } } | null } };
    }).__PHASER_GAME__;
    const list = game?.scene.getScene('Menu')?.children.list ?? [];
    const marker = list.find((object) => object.type === 'Image' && object.texture?.key === 'ui-marker' && object.visible);
    if (!marker) return '(none)';
    return list
      .filter((object) => object.type === 'Text' && object.visible && object.text)
      .sort((a, b) => Math.abs(a.y - marker.y) - Math.abs(b.y - marker.y))[0]?.text ?? '(none)';
  });
}

async function moveMouseToMenuText(page: Page, label: string): Promise<void> {
  const point = await page.evaluate((wanted) => {
    const game = (window as unknown as {
      __PHASER_GAME__?: {
        canvas: { width: number; height: number };
        scene: { getScene: (key: string) => { children: { list: Array<{ type: string; text?: string; x: number; y: number; visible: boolean }> } } | null };
      };
    }).__PHASER_GAME__;
    const entry = game?.scene.getScene('Menu')?.children.list.find((object) =>
      object.type === 'Text' && object.visible && object.text === wanted);
    if (!game || !entry) throw new Error(`Menu entry not found: ${wanted}`);
    return { x: entry.x / game.canvas.width, y: entry.y / game.canvas.height };
  }, label);
  const canvas = await page.locator('canvas').first().boundingBox();
  if (!canvas) throw new Error('Phaser canvas is not visible');
  await page.mouse.move(canvas.x + point.x * canvas.width, canvas.y + point.y * canvas.height);
}

async function clickMenuText(page: Page, label: string): Promise<void> {
  await moveMouseToMenuText(page, label);
  const point = await page.evaluate((wanted) => {
    const game = (window as unknown as {
      __PHASER_GAME__?: {
        canvas: { width: number; height: number };
        scene: { getScene: (key: string) => { children: { list: Array<{ type: string; text?: string; x: number; y: number; visible: boolean }> } } | null };
      };
    }).__PHASER_GAME__;
    const entry = game?.scene.getScene('Menu')?.children.list.find((object) =>
      object.type === 'Text' && object.visible && object.text === wanted);
    if (!game || !entry) throw new Error(`Menu entry not found: ${wanted}`);
    return { x: entry.x / game.canvas.width, y: entry.y / game.canvas.height };
  }, label);
  const canvas = await page.locator('canvas').first().boundingBox();
  if (!canvas) throw new Error('Phaser canvas is not visible');
  await page.mouse.click(canvas.x + point.x * canvas.width, canvas.y + point.y * canvas.height);
}

async function sceneTextScreenPoint(page: Page, sceneKey: string, label: string): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(({ wantedScene, wantedText }) => {
    const game = (window as unknown as {
      __PHASER_GAME__?: {
        canvas: { width: number; height: number };
        scene: { getScene: (key: string) => { children: { list: Array<{ type: string; text?: string; x: number; y: number; visible: boolean }> } } | null };
      };
    }).__PHASER_GAME__;
    const matches = game?.scene.getScene(wantedScene)?.children.list.filter((entry) =>
      entry.type === 'Text' && entry.visible && entry.text === wantedText) ?? [];
    const object = matches[matches.length - 1];
    if (!game || !object) throw new Error(`${wantedScene} text not found: ${wantedText}`);
    return { x: object.x / game.canvas.width, y: object.y / game.canvas.height };
  }, { wantedScene: sceneKey, wantedText: label });
  const canvas = await page.locator('canvas').first().boundingBox();
  if (!canvas) throw new Error('Phaser canvas is not visible');
  return { x: canvas.x + point.x * canvas.width, y: canvas.y + point.y * canvas.height };
}

async function clickTextInScene(page: Page, sceneKey: string, label: string): Promise<void> {
  const point = await sceneTextScreenPoint(page, sceneKey, label);
  await page.mouse.click(point.x, point.y);
}

const VALID_SAVE = JSON.stringify({
  schemaVersion: 2,
  runSeed: 42,
  day: 1,
  gameMinuteOfDay: 360,
  currentFloor: 1,
  status: 'playing',
  player: {
    x: 640,
    hp: 100,
    hunger: 80,
    thirst: 80,
    energy: 80,
    equipped: null,
    homeUpgrades: [],
    inventory: { slotCount: 12, slots: [] },
  },
  npcStates: {},
  visitedFloors: {},
  worldEvents: { history: [], activeEvent: null },
});

test('title menu mouse hover and clicks work with no save', async ({ page }) => {
  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  await waitForMenuReady(page);
  await expect.poll(() => hasVisibleText(page, '开始新游戏')).toBe(true);
  expect(await hasVisibleText(page, '操作说明')).toBe(true);
  expect(await hasVisibleText(page, '继续游戏')).toBe(false);

  await moveMouseToMenuText(page, '操作说明');
  await expect.poll(() => selectedMenuOption(page)).toBe('操作说明');
  mkdirSync('output/playwright/ui', { recursive: true });
  await page.screenshot({ path: 'output/playwright/ui/title-focus.png' });
  await clickMenuText(page, '操作说明');
  await expect.poll(() => hasVisibleText(page, 'A/D 或 ←/→ 移动')).toBe(true);
  expect(await hasVisibleText(page, '点击关闭 · Enter / ESC')).toBe(true);
  await clickMenuText(page, '点击关闭 · Enter / ESC');
  await expect.poll(() => hasVisibleText(page, 'A/D 或 ←/→ 移动')).toBe(false);
  await expect.poll(() => selectedMenuOption(page)).toBe('操作说明');

  await clickMenuText(page, '操作说明');
  await page.keyboard.press('Enter');
  await expect.poll(() => hasVisibleText(page, 'A/D 或 ←/→ 移动')).toBe(false);

  await clickMenuText(page, '操作说明');
  await page.keyboard.press('Escape');
  await expect.poll(() => hasVisibleText(page, 'A/D 或 ←/→ 移动')).toBe(false);

  await moveMouseToMenuText(page, '开始新游戏');
  await expect.poll(() => selectedMenuOption(page)).toBe('开始新游戏');
  await clickMenuText(page, '开始新游戏');
  await waitForScene(page, 'MetaSelect');
  expect(await page.evaluate(() => localStorage.getItem('floor100000.save.v1'))).toBeNull();
});

test('title menu mouse click continues an existing save', async ({ page }) => {
  await page.addInitScript((save) => localStorage.setItem('floor100000.save.v1', save), VALID_SAVE);
  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  await waitForMenuReady(page);
  expect(await hasVisibleText(page, '开始新游戏')).toBe(true);
  expect(await hasVisibleText(page, '继续游戏')).toBe(true);
  expect(await hasVisibleText(page, '操作说明')).toBe(true);

  await moveMouseToMenuText(page, '继续游戏');
  await expect.poll(() => selectedMenuOption(page)).toBe('继续游戏');
  await clickMenuText(page, '继续游戏');
  await waitForScene(page, 'Game');
});

test('a first-time player can finish character selection with the mouse', async ({ page }) => {
  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  await waitForMenuReady(page);
  await clickMenuText(page, '开始新游戏');
  await waitForScene(page, 'MetaSelect');
  await page.waitForTimeout(250);
  mkdirSync('output/playwright/ui', { recursive: true });
  await page.screenshot({ path: 'output/playwright/ui/character-focus.png' });

  await clickTextInScene(page, 'MetaSelect', '阿林');
  await clickTextInScene(page, 'MetaSelect', '开始生存');
  await expect.poll(() => hasVisibleText(page, '「阿林」还未相遇')).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__PHASER_GAME__?.scene.getScenes(true).some((scene) => scene.scene.key === 'MetaSelect'))).toBe(true);

  await clickTextInScene(page, 'MetaSelect', '幸存者');
  await clickTextInScene(page, 'MetaSelect', '开始生存');
  await waitForScene(page, 'Game');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('floor100000.meta.v1') ?? '{}').selectedCharacter)).toBe('player');
});

test('moving from the selected survivor to start does not select locked rows on the way', async ({ page }) => {
  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  await waitForMenuReady(page);
  await clickMenuText(page, '开始新游戏');
  await waitForScene(page, 'MetaSelect');

  const survivor = await sceneTextScreenPoint(page, 'MetaSelect', '幸存者');
  await page.mouse.click(survivor.x, survivor.y);
  const start = await sceneTextScreenPoint(page, 'MetaSelect', '开始生存');
  await page.mouse.move(start.x, start.y, { steps: 20 });
  await page.screenshot({ path: 'output/b3-ui-01-mouse-selection.png' });
  await page.mouse.click(start.x, start.y);

  await expect.poll(() => page.evaluate(() => window.__PHASER_GAME__?.scene.getScenes(true).some((scene) => scene.scene.key === 'Game'))).toBe(true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('floor100000.meta.v1') ?? '{}').selectedCharacter)).toBe('player');
});
