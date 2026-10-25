import { expect, test } from '@playwright/test';

// Minimal browser smoke for P0-00: the game boots to the pixel title, the
// 开始游戏 button switches to the solid-colour placeholder scene, the canvas
// actually has pixels, and no uncaught errors / 404s occur.
// Phaser renders text/sprites into the canvas, so we assert on real game state
// via the dev-only window.__PHASER_GAME__ handle, not on DOM text.

test('boots to pixel title and switches to placeholder game scene', async ({ page }) => {
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
  });

  await page.goto('/');

  // Wait for Phaser to boot and the Menu scene to become active.
  await page.waitForFunction(
    () => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Menu');
    },
    undefined,
    { timeout: 30_000 },
  );

  // The Menu scene really contains the title text and an interactive button.
  const menuHasUi = await page.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; input?: { enabled: boolean } }> } } | null } } }).__PHASER_GAME__;
    const menu = g?.scene.getScene('Menu');
    const list = menu?.children.list ?? [];
    const hasTitle = list.some((o) => o.type === 'Text' && o.text === '第100000层');
    const hasStart = list.some((o) => o.type === 'Text' && o.text === '开始游戏');
    const hasButton = list.some((o) => o.type === 'Rectangle' && o.input?.enabled === true);
    return { hasTitle, hasStart, hasButton };
  });
  expect(menuHasUi).toEqual({ hasTitle: true, hasStart: true, hasButton: true });

  await page.screenshot({ path: 'e2e/screenshots/01-title.png' });

  // Canvas has real (non-black) pixels.
  const nonBlack = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const g = (window as unknown as { __PHASER_GAME__?: { renderer: { snapshot: (cb: (img: HTMLImageElement) => void) => void } } }).__PHASER_GAME__;
        if (!g) return resolve(-1);
        g.renderer.snapshot((img) => {
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          const ctx = c.getContext('2d');
          if (!ctx) return resolve(-1);
          ctx.drawImage(img, 0, 0);
          const d = ctx.getImageData(0, 0, c.width, c.height).data;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i] > 10 || d[i + 1] > 10 || d[i + 2] > 10) n++;
          }
          resolve(n);
        });
      }),
  );
  expect(nonBlack).toBeGreaterThan(1000);

  // Click the real 开始游戏 button at its on-screen position.
  const btn = await page.evaluate(() => {
    const g = (window as unknown as {
      __PHASER_GAME__?: {
        scene: { getScene: (k: string) => { cameras: { main: { width: number; height: number } }; children: { list: Array<{ type: string; x: number; y: number; input?: { enabled: boolean } }> } } | null };
      };
    }).__PHASER_GAME__;
    const menu = g?.scene.getScene('Menu');
    const button = menu?.children.list.find((o) => o.type === 'Rectangle' && o.input?.enabled === true);
    if (!menu || !button) return null;
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (button.x / menu.cameras.main.width) * rect.width,
      y: rect.top + (button.y / menu.cameras.main.height) * rect.height,
    };
  });
  expect(btn).not.toBeNull();
  await page.mouse.click(btn!.x, btn!.y);

  // Game scene becomes active and shows the placeholder character + hint.
  await page.waitForFunction(
    () => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
    },
    undefined,
    { timeout: 10_000 },
  );

  const gameContents = await page.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; texture?: { key: string } }> } } | null } } }).__PHASER_GAME__;
    const list = g?.scene.getScene('Game')?.children.list ?? [];
    return {
      hasPlayer: list.some((o) => o.type === 'Sprite' && o.texture?.key === 'player'),
      hasFloorHud: list.some((o) => o.type === 'Text' && (o.text ?? '').includes('100000')),
    };
  });
  expect(gameContents).toEqual({ hasPlayer: true, hasFloorHud: true });

  await page.screenshot({ path: 'e2e/screenshots/02-game.png' });

  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  expect(failedRequests, `failed requests: ${failedRequests.join(' | ')}`).toEqual([]);
});
