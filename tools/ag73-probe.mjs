// 一次性探针：看跳过按钮四件在场景里的真实状态（visible / interactive / depth / scrollFactor / 坐标）。
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:5473/?seed=42');
await page.waitForFunction(() => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Menu'), undefined, { timeout: 20000 });
await page.keyboard.press('Enter');
await page.waitForFunction(() => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect'), undefined, { timeout: 20000 });
for (let i = 0; i < 5; i++) {
  await page.keyboard.press('Enter');
  const started = await page.waitForFunction(() => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'), undefined, { timeout: 2000 }).then(() => true).catch(() => false);
  if (started) break;
}
await page.waitForFunction(() => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'), undefined, { timeout: 20000 });
await page.waitForTimeout(800);

const info = await page.evaluate(() => {
  const scene = window.__PHASER_GAME__?.scene.getScene('Game');
  if (!scene) return null;
  const parts = scene.children.list.filter((o) => o.type === 'Rectangle' || o.type === 'Text');
  const skip = parts.filter((o) => {
    const b = o.getBounds();
    return b.x >= 1100 && b.x <= 1300 && b.y >= 90 && b.y <= 160;
  });
  return {
    scroll: { x: scene.cameras.main.scrollX, y: scene.cameras.main.scrollY, zoom: scene.cameras.main.zoom },
    skip: skip.map((o) => ({
      type: o.type,
      name: o.name ?? '',
      visible: o.visible,
      depth: o.depth,
      scrollFactorX: o.scrollFactorX,
      alpha: o.alpha,
      input: o.input ? { enabled: o.input.enabled, hitArea: String(o.input.hitArea) } : null,
      bounds: o.getBounds(),
    })),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
