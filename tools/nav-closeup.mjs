// 一次性：把导航条区域放大截图（背包开着，看高亮）。用法：node tools/nav-closeup.mjs
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:5471/?seed=42');
await page.waitForFunction(() => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Menu'), null, { timeout: 30000 });
await page.keyboard.press('Enter');
await page.waitForFunction(() => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect'), null, { timeout: 20000 });
for (let i = 0; i < 5; i++) {
  await page.keyboard.press('Enter');
  const started = await page.waitForFunction(() => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'), null, { timeout: 2000 }).then(() => true).catch(() => false);
  if (started) break;
}
await page.waitForFunction(() => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'), null, { timeout: 30000 });
await page.evaluate(() => { const s = window.__PHASER_SESSION__?.getState(); if (s) s.player.x = 1240; });
await page.waitForTimeout(300);
await page.keyboard.press('I');
await page.waitForTimeout(600);
const box = await page.locator('canvas').boundingBox();
const scale = box.width / 1280;
const clip = { x: box.x, y: box.y + 660 * scale, width: box.width, height: 60 * scale };
await page.screenshot({ path: 'output/ag71/08-nav-closeup-inventory.png', clip });
await page.keyboard.press('I');
await page.waitForTimeout(400);
await page.screenshot({ path: 'output/ag71/09-nav-closeup-default.png', clip });
await browser.close();
console.log('done');
