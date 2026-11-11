import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../src/core/gameTypes';

async function startGame(page: Page): Promise<void> {
  await page.goto('/?seed=42');
  const sceneIs = (key: string): Promise<void> => page.waitForFunction(
    (k) => !!window.__PHASER_GAME__?.scene.getScenes(true).some((scene) => scene.scene.key === k), key,
  ).then(() => undefined);
  await sceneIs('Menu');
  await page.keyboard.press('Enter');
  await sceneIs('MetaSelect');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const ready = await page.waitForFunction(
      () => window.__PHASER_GAME__?.scene.getScenes(true).some((scene) => scene.scene.key === 'Game'),
      undefined, { timeout: 2000 },
    ).then(() => true).catch(() => false);
    if (ready) break;
  }
  await sceneIs('Game');
}

type HudBound = { name: string; text: string; x: number; y: number; width: number; height: number };

async function bounds(page: Page): Promise<HudBound[]> {
  return page.evaluate(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as {
      children: { list: Array<{ type: string; name: string; text: string; visible: boolean; getBounds(): { x: number; y: number; width: number; height: number } }> };
    };
    return scene.children.list.filter((o) => o.type === 'Text' && o.visible && o.name.startsWith('hud-')).map((o) => {
      const b = o.getBounds();
      return { name: o.name, text: o.text, x: b.x, y: b.y, width: b.width, height: b.height };
    });
  });
}

for (const viewport of [{ width: 1280, height: 720 }, { width: 1280, height: 800 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
  test(`HUD stays readable at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => { if (response.status() === 404 && !response.url().endsWith('/favicon.ico')) errors.push(`404 ${response.url()}`); });
    await page.setViewportSize(viewport);
    await startGame(page);
    await expect.poll(async () => (await bounds(page)).find((o) => o.name === 'hud-goal')?.text).toContain('目标');
    const playerScreen = async (): Promise<{ top: number; bottom: number }> => page.evaluate(() => {
      const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as {
        player: { getBounds(): { y: number; height: number } };
        cameras: { main: { scrollY: number; zoom: number } };
      };
      const player = scene.player.getBounds();
      const camera = scene.cameras.main;
      return { top: (player.y - camera.scrollY) * camera.zoom, bottom: (player.y + player.height - camera.scrollY) * camera.zoom };
    });
    expect((await playerScreen()).top, 'idle character clears HUD').toBeGreaterThanOrEqual(124);
    await page.keyboard.down('ArrowRight');
    await page.waitForFunction(() => (window.__PHASER_SESSION__?.getState()?.player.x ?? 0) > 670);
    await page.keyboard.up('ArrowRight');
    const walking = await playerScreen();
    expect(walking.top, 'walking character clears HUD').toBeGreaterThanOrEqual(124);
    expect(walking.bottom).toBeLessThan(556);
    mkdirSync('output/playwright/hud', { recursive: true });
    await page.screenshot({ path: `output/playwright/hud/${viewport.width}x${viewport.height}-day.png` });

    // Visual fixture only: verify long feedback, illness, full inventory and
    // numeric values together. This does not claim to be a survival journey.
    await page.evaluate(() => {
      const state = window.__PHASER_SESSION__?.getState() as unknown as GameState | null;
      if (!state) throw new Error('missing session');
      state.player.gold = 123456789012;
      state.player.hp = 17;
      state.player.stress = 99;
      state.player.ailments = [{ id: 'cold', severity: 60, sinceMinute: 360 }, { id: 'wound', severity: 50, sinceMinute: 360 }];
      state.player.inventory.slotCount = state.player.inventory.slots.length;
      const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { flash(message: string): void };
      scene.flash('材料不足：废金属 0/2、电线 0/1、滤芯 0/1。请返回维修层收集材料，再回宿舍工作台制作净水器。');
    });
    await expect.poll(async () => (await bounds(page)).some((o) => o.name === 'hud-bag-full')).toBe(true);
    await expect.poll(async () => (await bounds(page)).find((o) => o.name === 'hud-value-hp')?.text).toBe('17');
    const actual = await bounds(page);
    for (const entry of actual) {
      expect(entry.x, `${entry.name} starts on canvas`).toBeGreaterThanOrEqual(0);
      expect(entry.y).toBeGreaterThanOrEqual(0);
      expect(entry.x + entry.width, `${entry.name} right bound: ${entry.text}`).toBeLessThanOrEqual(1280);
      expect(entry.y + entry.height, `${entry.name} bottom bound: ${entry.text}`).toBeLessThanOrEqual(720);
    }
    const named = (name: string): HudBound => {
      const object = actual.find((o) => o.name === name);
      if (!object) throw new Error(`missing ${name}`);
      return object;
    };
    expect(named('hud-goal').y + named('hud-goal').height).toBeLessThanOrEqual(named('hud-environment').y);
    expect(named('hud-feedback').y + named('hud-feedback').height).toBeLessThanOrEqual(named('hud-bag-full').y);
    expect(named('hud-bag-full').y + named('hud-bag-full').height).toBeLessThanOrEqual(680);
    expect(named('hud-gold').text).toBe('金币 123456789012');
    const canvas = await page.locator('canvas').boundingBox();
    expect(canvas).not.toBeNull();
    if (canvas) {
      expect(canvas.x).toBeGreaterThanOrEqual(0);
      expect(canvas.y).toBeGreaterThanOrEqual(0);
      expect(canvas.x + canvas.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(canvas.y + canvas.height).toBeLessThanOrEqual(viewport.height + 1);
    }
    await testInfo.attach('HUD and canvas bounds', { body: JSON.stringify({ viewport, canvas, hud: actual }, null, 2), contentType: 'application/json' });
    await page.screenshot({ path: `output/playwright/hud/${viewport.width}x${viewport.height}-critical.png` });
    await page.evaluate(() => {
      const state = window.__PHASER_SESSION__?.getState();
      if (state) state.gameMinuteOfDay = 1320;
    });
    await expect.poll(async () => (await bounds(page)).find((o) => o.name === 'hud-clock')?.text).toContain('22:00');
    await page.screenshot({ path: `output/playwright/hud/${viewport.width}x${viewport.height}-night.png` });
    expect(errors).toEqual([]);
  });
}

test('HUD updates money without waiting for rounded stats and restores context after the map', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startGame(page);
  // Give rounded stats a wide margin before testing money alone. The HUD has
  // already rendered these values before gold changes on a later frame.
  await page.evaluate(() => {
    const state = window.__PHASER_SESSION__?.getState();
    if (!state) throw new Error('missing state');
    state.player.hunger = 80;
    state.player.thirst = 80;
    state.player.energy = 80;
  });
  await expect.poll(async () => (await bounds(page)).find((o) => o.name === 'hud-value-energy')?.text).toBe('80');
  const before = await page.evaluate(() => {
    const state = window.__PHASER_SESSION__?.getState() as unknown as GameState | null;
    if (!state) throw new Error('missing state');
    state.player.gold = 23;
    return [state.player.hp, state.player.hunger, state.player.thirst, state.player.energy].map(Math.round);
  });
  await expect.poll(async () => (await bounds(page)).find((o) => o.name === 'hud-gold')?.text).toBe('金币 23');
  const after = await page.evaluate(() => {
    const state = window.__PHASER_SESSION__?.getState();
    if (!state) throw new Error('missing state');
    return [state.player.hp, state.player.hunger, state.player.thirst, state.player.energy].map(Math.round);
  });
  expect(after).toEqual(before);
  // A modal freezes the world, but transactions still call refreshStats.
  // Exercise the presentation callback without changing any trade rule.
  await page.keyboard.press('I', { delay: 80 });
  await page.evaluate(() => {
    const state = window.__PHASER_SESSION__?.getState() as unknown as GameState | null;
    if (!state) throw new Error('missing state');
    state.player.gold = 29;
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { refreshStats(): void };
    scene.refreshStats();
  });
  await expect.poll(async () => (await bounds(page)).find((o) => o.name === 'hud-gold')?.text).toBe('金币 29');
  await page.keyboard.press('I', { delay: 80 });
  await page.waitForFunction(() => !(window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { inventoryOpen: boolean }).inventoryOpen);
  await page.keyboard.press('M', { delay: 80 });
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'TowerOverview'));
  await page.keyboard.press('Escape', { delay: 80 });
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'));
  await expect.poll(async () => (await bounds(page)).find((o) => o.name === 'hud-goal')?.text).toContain('目标');
  const restored = await bounds(page);
  expect(restored.filter((o) => o.name === 'hud-goal')).toHaveLength(1);
  expect(restored.find((o) => o.name === 'hud-environment')?.text).toContain('体温值');
  expect(errors).toEqual([]);
});
