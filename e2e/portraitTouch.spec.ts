import { expect, test, type Page } from '@playwright/test';

test.use({ hasTouch: true });

const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 720;

type State = {
  currentFloor: number;
  player: { x: number };
  visitedFloors: Record<number, { openedContainers: string[] }>;
};

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction((sceneKey) =>
    !!window.__PHASER_GAME__?.scene.getScenes(true).some((scene) => scene.scene.key === sceneKey), key);
}

async function activeState(page: Page): Promise<State> {
  return page.evaluate(() => {
    const state = window.__PHASER_SESSION__?.getState();
    if (!state) throw new Error('missing game state');
    return state as State;
  });
}

async function screenPoint(page: Page, sceneKey: string, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(({ key, gameX, gameY, designWidth, designHeight }) => {
    const canvas = document.querySelector('canvas');
    const scene = window.__PHASER_GAME__?.scene.getScene(key) as unknown as {
      cameras: { main: { x: number; y: number } };
    } | undefined;
    if (!canvas || !scene) throw new Error(`missing canvas or scene ${key}`);
    const bounds = canvas.getBoundingClientRect();
    return {
      x: bounds.left + (scene.cameras.main.x + gameX) * bounds.width / designWidth,
      y: bounds.top + (scene.cameras.main.y + gameY) * bounds.height / designHeight,
    };
  }, { key: sceneKey, gameX: x, gameY: y, designWidth: DESIGN_WIDTH, designHeight: DESIGN_HEIGHT });
}

async function startMobileRun(page: Page): Promise<void> {
  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  await page.waitForTimeout(250);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('floor100000.save.v1'))).toBeNull();
  const menu = await screenPoint(page, 'Menu', 640, 286);
  await tapAt(page, menu.x, menu.y);
  await waitForScene(page, 'MetaSelect');
  await page.waitForTimeout(250);
  const meta = await screenPoint(page, 'MetaSelect', 640, 540);
  await tapAt(page, meta.x, meta.y);
  await waitForScene(page, 'Game');
}

async function tapAt(page: Page, x: number, y: number): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
  });
  await page.waitForTimeout(100);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

test('portrait touch: start a fresh run, walk to a real container, interact, and stop on release', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await startMobileRun(page);
  await expect.poll(() => page.evaluate(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { portraitMode: boolean; touchControls: unknown[] };
    return { portrait: scene.portraitMode, controls: scene.touchControls.length };
  })).toEqual({ portrait: true, controls: 10 });
  const documentSize = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  }));
  expect(documentSize.width).toBeLessThanOrEqual(documentSize.viewportWidth);
  expect(documentSize.height).toBeLessThanOrEqual(documentSize.viewportHeight);
  const hudLines = await page.evaluate(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as {
      children: { list: Array<{ type: string; name: string; getBounds(): { x: number; y: number; width: number; height: number } }> };
    };
    return scene.children.list.filter((object) => object.type === 'Text' && ['hud-goal', 'hud-environment'].includes(object.name)).map((object) => {
      const bounds = object.getBounds();
      return { name: object.name, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    });
  });
  expect(hudLines).toHaveLength(2);
  expect(hudLines.every((line) => line.x >= 0 && line.x + line.width <= 324 && line.y + line.height <= 166)).toBe(true);
  await page.screenshot({ path: 'output/playwright/hud/360x800-day.png' });

  // Every new Playwright page has a fresh browser context; no user save or profile is reused.
  const start = await activeState(page);
  expect(start.currentFloor).toBe(1);
  expect(start.player.x).toBe(640);

  // Hold the on-screen left control until the real floor-1 cabinet is in reach.
  const left = await screenPoint(page, 'Game', 28, DESIGN_HEIGHT - 25);
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: left.x, y: left.y, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
  });
  await page.waitForTimeout(600);
  const leftHeld = await page.evaluate(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { touchDirectionPointers: Map<number, string> } | undefined;
    return { x: window.__PHASER_SESSION__?.getState()?.player.x, directions: scene ? [...scene.touchDirectionPointers] : [] };
  });
  expect(leftHeld.x).toBeLessThan(start.player.x);
  expect(leftHeld.directions.map(([, direction]) => direction)).toContain('left');
  await page.waitForFunction(() => (window.__PHASER_SESSION__?.getState()?.player.x ?? 9999) <= 180, undefined, { timeout: 12_000 });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
  await page.waitForFunction(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { touchDirectionPointers: Map<number, string> } | undefined;
    return !!scene && scene.touchDirectionPointers.size === 0;
  });

  // Release also lets the existing acceleration ramp settle before the E action.
  await page.waitForTimeout(700);
  const cabinetApproach = await activeState(page);
  expect(cabinetApproach.player.x).toBeLessThanOrEqual(180);
  const interact = await screenPoint(page, 'Game', 324 - 38, DESIGN_HEIGHT - 25);
  await tapAt(page, interact.x, interact.y);
  await expect.poll(async () => (await activeState(page)).visitedFloors[1]?.openedContainers ?? []).toContain('cabinet');

  // Inventory stays reachable by touch while open, and its compact grid/detail panel remains within the portrait camera.
  const inventory = await screenPoint(page, 'Game', 128, DESIGN_HEIGHT - 25);
  await tapAt(page, inventory.x, inventory.y);
  await page.waitForFunction(() => (window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { inventoryOpen: boolean }).inventoryOpen);
  const inventoryBounds = await page.evaluate(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as {
      invObjects: Array<{ visible: boolean; getBounds?: () => { x: number; y: number; width: number; height: number } }>;
      touchControls: Array<{ visible: boolean }>;
    };
    return {
      objects: scene.invObjects.filter((object) => object.visible && typeof object.getBounds === 'function').map((object) => {
        const bounds = object.getBounds!();
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      }),
      controlsVisible: scene.touchControls.every((object) => object.visible),
    };
  });
  expect(inventoryBounds.objects.length).toBeGreaterThan(0);
  expect(inventoryBounds.objects.every((bounds) => bounds.x >= 0 && bounds.x + bounds.width <= 324 && bounds.y >= 0 && bounds.y + bounds.height <= DESIGN_HEIGHT)).toBe(true);
  expect(inventoryBounds.controlsVisible).toBe(true);
  await tapAt(page, inventory.x, inventory.y);
  await page.waitForFunction(() => !(window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { inventoryOpen: boolean }).inventoryOpen);

  // Now test a second hold on the right control, and that release actually stops motion.
  const beforeRight = (await activeState(page)).player.x;
  const rightPoint = await screenPoint(page, 'Game', 78, DESIGN_HEIGHT - 25);
  const rightClient = await page.context().newCDPSession(page);
  await rightClient.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: rightPoint.x, y: rightPoint.y, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
  });
  await page.waitForFunction((startX) => (window.__PHASER_SESSION__?.getState()?.player.x ?? startX) > startX + 18, beforeRight, { timeout: 8_000 });
  await rightClient.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await rightClient.detach();
  await page.waitForFunction(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { touchDirectionPointers: Map<number, string> } | undefined;
    return !!scene && scene.touchDirectionPointers.size === 0;
  });
  await page.waitForTimeout(800);
  const released = (await activeState(page)).player.x;
  await page.waitForTimeout(300);
  const settled = (await activeState(page)).player.x;
  expect(Math.abs(settled - released)).toBeLessThan(1.5);

  // Browser/OS interruption can cancel a pointer without delivering the normal up event.
  const beforeCancel = settled;
  const cancelPoint = await screenPoint(page, 'Game', 78, DESIGN_HEIGHT - 25);
  const cancelClient = await page.context().newCDPSession(page);
  await cancelClient.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: cancelPoint.x, y: cancelPoint.y, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
  });
  await page.waitForFunction((startX) => (window.__PHASER_SESSION__?.getState()?.player.x ?? startX) > startX + 18, beforeCancel, { timeout: 8_000 });
  await cancelClient.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await cancelClient.detach();
  await page.waitForFunction(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { touchDirectionPointers: Map<number, string> } | undefined;
    return !!scene && scene.touchDirectionPointers.size === 0;
  });
  const afterCancel = (await activeState(page)).player.x;
  await page.waitForTimeout(300);
  expect(Math.abs((await activeState(page)).player.x - afterCancel)).toBeLessThan(1.5);
  expect(errors).toEqual([]);
});

test('desktop regression: existing keyboard movement and landscape layout remain active', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Game');
  const portraitMode = await page.evaluate(() => (window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { portraitMode: boolean }).portraitMode);
  expect(portraitMode).toBe(false);
  const before = (await activeState(page)).player.x;
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction((x) => (window.__PHASER_SESSION__?.getState()?.player.x ?? x) > x + 20, before);
  await page.keyboard.up('ArrowRight');
  expect((await activeState(page)).player.x).toBeGreaterThan(before + 20);
  expect(errors).toEqual([]);
});

test('narrow portrait: 320px HUD values and touch controls stay inside the visible camera slice', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Game');

  const bounds = await page.evaluate(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as {
      portraitWidth: number;
      children: { list: Array<{ type: string; name: string; getBounds(): { x: number; y: number; width: number; height: number } }> };
      touchControls: Array<{ getBounds(): { x: number; y: number; width: number; height: number } }>;
    };
    const hud = scene.children.list
      .filter((object) => object.type === 'Text' && (object.name.startsWith('hud-value-') || ['hud-goal', 'hud-environment'].includes(object.name)))
      .map((object) => ({ name: object.name, ...object.getBounds() }));
    const controls = scene.touchControls.map((object) => object.getBounds());
    return { viewportWidth: scene.portraitWidth, hud, controls };
  });

  expect(bounds.viewportWidth).toBe(288);
  expect(bounds.hud.length).toBe(6);
  expect(bounds.hud.every((item) => item.x >= 0 && item.x + item.width <= bounds.viewportWidth)).toBe(true);
  expect(bounds.controls.length).toBe(10);
  expect(bounds.controls.every((item) => item.x >= 0 && item.x + item.width <= bounds.viewportWidth)).toBe(true);
});

test('orientation changes take effect after reload, preserving the supported launch-time layout', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Game');
  const portraitLayout = await page.evaluate(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { portraitMode: boolean; touchControls: unknown[] };
    return { portrait: scene.portraitMode, controls: scene.touchControls.length };
  });
  expect(portraitLayout).toEqual({ portrait: true, controls: 10 });

  // Phaser chooses FIT/ENVELOP at boot; after rotation, reload to reinitialize both the scaler and scene layout.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Game');
  const landscapeLayout = await page.evaluate(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { portraitMode: boolean; touchControls: unknown[] };
    return { portrait: scene.portraitMode, controls: scene.touchControls.length };
  });
  expect(landscapeLayout).toEqual({ portrait: false, controls: 0 });
});
