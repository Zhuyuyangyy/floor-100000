// 一次性探针：验证 Phaser 相机 flashEffect 白闪在无头 Chrome 里真的渲染。
// 用法：node tools/ag91-flash-probe.mjs（需 dev server 已在 5202 起好）
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://[::1]:5202/?seed=42');
await page.waitForFunction(() => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Menu'), undefined, { timeout: 20000 });
await page.keyboard.press('Enter');
await page.waitForFunction(() => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect'), undefined, { timeout: 20000 });
for (let i = 0; i < 5; i++) {
  await page.keyboard.press('Enter');
  const ok = await page.waitForFunction(() => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'), undefined, { timeout: 2000 }).then(() => true).catch(() => false);
  if (ok) break;
}
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const g = window.__PHASER_GAME__;
  const s = g.scene.getScene('Game');
  s.cameras.main.flash(400, 255, 255, 255);
});
const t0 = await page.evaluate(() => performance.now());
await page.screenshot({ path: 'D:/ZYY_Inovation/game/tmp/qa-evidence/juice/probe-flash-a.png' });
const t1 = await page.evaluate(() => performance.now());
await page.waitForTimeout(250);
await page.screenshot({ path: 'D:/ZYY_Inovation/game/tmp/qa-evidence/juice/probe-flash-b.png' });
const t2 = await page.evaluate(() => performance.now());
const fx = await page.evaluate(() => {
  const g = window.__PHASER_GAME__;
  const s = g.scene.getScene('Game');
  return { running: s.cameras.main.flashEffect.isRunning, alpha: s.cameras.main.flashEffect.alpha };
});
console.log('flash probe timing: t0(flash call)=', t0.toFixed(1), 'shotA at', t1.toFixed(1), `(+${(t1 - t0).toFixed(1)}ms)`, 'shotB at', t2.toFixed(1), `(+${(t2 - t0).toFixed(1)}ms)`, 'fx=', JSON.stringify(fx));
await browser.close();
