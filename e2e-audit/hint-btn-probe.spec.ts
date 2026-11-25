import { expect, test, type Page } from '@playwright/test';

// 只读探针：竖屏下把底部提示强行显示出来，量它和触屏按钮行的真实关系。
// 审计报告里「按钮盖住底部提示」这句必须有数字，否则就是推断。

test('probe: 竖屏 hud-hint 显示时与触屏按钮的几何关系', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?seed=42&debug=1');
  await page.waitForFunction(() =>
    window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Menu'),
  );
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect'),
  );
  await page.waitForTimeout(400);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const ok = await page.evaluate(() =>
      Boolean(window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game')),
    );
    if (ok) break;
  }
  await page.waitForFunction(() =>
    window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'),
  );
  await page.waitForTimeout(1200);

  const info = await page.evaluate(() => {
    const g = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as {
      portraitMode: boolean;
      portraitWidth: number;
      hudContextBottom: number;
      setInteractionHint: (m: string) => void;
      hintText: { getBounds: () => { x: number; y: number; width: number; height: number }; text: string };
      touchControls: Array<{ getBounds: () => { x: number; y: number; width: number; height: number } }>;
    };
    const before = g.hintText.getBounds();
    g.setInteractionHint('按 E 对话');
    const after = g.hintText.getBounds();
    return {
      portraitMode: g.portraitMode,
      portraitWidth: g.portraitWidth,
      hudContextBottom: g.hudContextBottom,
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      hintBefore: { x: Math.round(before.x), y: Math.round(before.y), w: Math.round(before.width), h: Math.round(before.height) },
      hintAfter: { x: Math.round(after.x), y: Math.round(after.y), w: Math.round(after.width), h: Math.round(after.height), text: g.hintText.text },
      buttons: g.touchControls.map((b) => {
        const bb = b.getBounds();
        return { x: Math.round(bb.x), y: Math.round(bb.y), w: Math.round(bb.width), h: Math.round(bb.height) };
      }),
    };
  });

  console.log(`viewport=${info.innerW}x${info.innerH} portraitMode=${info.portraitMode} portraitWidth=${info.portraitWidth} hudContextBottom=${info.hudContextBottom}`);
  console.log(`hint 隐藏时 bbox: ${JSON.stringify(info.hintBefore)}`);
  console.log(`hint 显示后 bbox: ${JSON.stringify(info.hintAfter)}`);
  const btnTop = Math.min(...info.buttons.map((b) => b.y));
  const btnBottom = Math.max(...info.buttons.map((b) => b.y + b.h));
  const btnLeft = Math.min(...info.buttons.map((b) => b.x));
  const btnRight = Math.max(...info.buttons.map((b) => b.x + b.w));
  console.log(`按钮行整体: x[${btnLeft}..${btnRight}] y[${btnTop}..${btnBottom}]`);
  const h = info.hintAfter;
  const ox = Math.max(0, Math.min(h.x + h.w, btnRight) - Math.max(h.x, btnLeft));
  const oy = Math.max(0, h.y + h.h - btnTop);
  console.log(`→ 提示 × 按钮：水平交叠 ${ox}px，垂直交叠 ${oy}px`);
  console.log(`→ 提示下沿 ${h.y + h.h}，按钮上沿 ${btnTop}，间距 ${btnTop - (h.y + h.h)}px`);
  expect(info.portraitMode).toBe(true);
});