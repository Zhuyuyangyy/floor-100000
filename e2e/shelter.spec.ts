import { expect, test } from '@playwright/test';

test.describe('first-floor shelter loop', () => {
  test('opens the shelter panel, commits rest, and wakes on the next day', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/?seed=42');
    await page.waitForFunction(() => {
      const g = window.__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((scene) => scene.scene.key === 'Menu');
    });
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => {
      const g = window.__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((scene) => scene.scene.key === 'MetaSelect');
    });
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Enter');
      const started = await page.waitForFunction(
        () => {
          const g = window.__PHASER_GAME__;
          return !!g && g.scene.getScenes(true).some((scene) => scene.scene.key === 'Game');
        },
        undefined,
        { timeout: 2000 },
      ).then(() => true).catch(() => false);
      if (started) break;
    }
    await page.waitForFunction(() => {
      const g = window.__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((scene) => scene.scene.key === 'Game');
    });

    // This is a browser fixture for the phase gate only. The full journey spec
    // reaches nightfall by waiting in real time; this focused test keeps the UI
    // regression fast while still using the real keyboard and bed interaction.
    await page.evaluate(() => {
      const state = window.__PHASER_SESSION__?.getState();
      if (!state) throw new Error('no session state');
      state.gameMinuteOfDay = 1200;
      state.player.x = 640;
    });
    await page.keyboard.down('ArrowRight');
    await page.waitForFunction(() => {
      const state = window.__PHASER_SESSION__?.getState();
      return !!state && state.player.x >= 1110;
    });
    await page.keyboard.up('ArrowRight');
    await page.keyboard.press('E');

    const hasVisibleText = async (text: string): Promise<boolean> => page.evaluate((needle) => {
      const game = window.__PHASER_GAME__;
      return !!game?.scene.scenes.some((scene) => scene.children.list.some((object) => object.type === 'Text' && object.visible && object.text?.includes(needle)));
    }, text);
    await expect.poll(() => hasVisibleText('夜间安排 · 宿舍')).toBe(true);
    await page.screenshot({ path: 'e2e/screenshots/shelter-panel.png' });

    await page.keyboard.press('Enter');
    await expect.poll(() => hasVisibleText('Enter 睡觉 · ESC 返回')).toBe(true);
    await page.waitForTimeout(200);
    await page.keyboard.press('E');
    await page.waitForFunction(() => window.__PHASER_SESSION__?.getState()?.day === 2);

    const state = await page.evaluate(() => window.__PHASER_SESSION__?.getState());
    expect(state?.gameMinuteOfDay).toBeGreaterThanOrEqual(360);
    expect(state?.player.stress).toBeLessThan(20);
    expect(state?.diary?.some((event) => event.kind === 'shelter_rested')).toBe(true);
    await page.screenshot({ path: 'e2e/screenshots/shelter-next-day.png' });

    await page.reload();
    await page.waitForFunction(() => {
      const g = window.__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((scene) => scene.scene.key === 'Menu');
    });
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => {
      const g = window.__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((scene) => scene.scene.key === 'Game');
    });
    const resumed = await page.evaluate(() => window.__PHASER_SESSION__?.getState());
    expect(resumed?.day).toBe(2);
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });
});
