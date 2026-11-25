import { expect, test, type Page } from '@playwright/test';

// HUD 遮挡探针：把「世界层标签是否被顶部 HUD 带压住」变成数字。
//
// 背景：`HUD_LAYOUT.contextBottom = 124`（设计画布像素），HUD 的两条上下文带
// 从 y=64 铺到 y=124，不透明（alpha 0.94）。世界层的家具标签 / 容器标签是
// 世界坐标，摄像机跟随玩家后会上下移动，所以它们会周期性滑进这条带子里。
// 本探针在多个玩家位置上扫一遍，记录每个标签进入 HUD 带的次数和最小间距。

interface LabelInfo {
  text: string;
  /** 屏幕像素（canvas 坐标）里的包围盒上沿 */
  screenTop: number;
  /** 屏幕像素里的包围盒下沿 */
  screenBottom: number;
  scrollFactor: number;
}

async function labelsInBand(page: Page): Promise<{ hudBottom: number; labels: LabelInfo[] }> {
  return page.evaluate(() => {
    const g = (window as unknown as {
      __PHASER_GAME__?: {
        scene: {
          getScene: (k: string) => {
            children: { list: Array<Record<string, unknown>> };
            cameras: { main: { scrollY: number; zoom: number; y: number } };
          } | null;
        };
      };
    }).__PHASER_GAME__;
    const scene = g?.scene.getScene('Game');
    const list = (scene?.children.list ?? []) as Array<Record<string, unknown>>;
    const cam = scene!.cameras.main;
    const out: LabelInfo[] = [];
    for (const o of list) {
      if (o.type !== 'Text') continue;
      const sf = (o.scrollFactorY as number) ?? 1;
      if (sf === 0) continue; // HUD text, not world text
      if (!(o.visible as boolean)) continue;
      const bounds = (o.getBounds as () => { top: number; bottom: number }).call(o);
      // world -> screen for a scrollFactor-1 object with zoom 1
      const screenTop = (bounds.top - cam.scrollY) * cam.zoom + cam.y;
      const screenBottom = (bounds.bottom - cam.scrollY) * cam.zoom + cam.y;
      out.push({ text: String(o.text ?? '').slice(0, 24), screenTop, screenBottom, scrollFactor: sf });
    }
    // 124 = HUD_LAYOUT.contextBottom, the bottom of the opaque context band.
    return { hudBottom: 124, labels: out };
  });
}

async function boot(page: Page): Promise<void> {
  await page.goto('/?seed=42&debug=1');
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Menu'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect'));
  await page.waitForTimeout(400);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Enter');
    const started = await page
      .waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'), undefined, { timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    if (started) break;
  }
  await page.waitForTimeout(1000);
}

test('probe: world labels hidden behind the HUD context band', async ({ page }) => {
  await boot(page);
  const report: string[] = [];
  let occludedTotal = 0;

  for (const x of [200, 340, 480, 640, 800, 960, 1100]) {
    await page.evaluate((px) => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { x: number } } | null } })
        .__PHASER_SESSION__?.getState();
      if (s) s.player.x = px;
    }, x);
    await page.waitForTimeout(420);
    const { hudBottom, labels } = await labelsInBand(page);
    const hidden = labels.filter((l) => l.screenTop < hudBottom && l.screenBottom > 40);
    occludedTotal += hidden.length;
    report.push(`x=${x}: ${hidden.length} label(s) inside HUD band (hudBottom=${hudBottom})` +
      (hidden.length ? ' -> ' + hidden.map((h) => `"${h.text}"[${h.screenTop.toFixed(0)}..${h.screenBottom.toFixed(0)}]`).join(' ') : ''));
  }
  for (const line of report) console.log('[hud-band] ' + line);
  console.log('[hud-band] total occluded label instances across sweep:', occludedTotal);
  expect(report.length).toBeGreaterThan(0);
});