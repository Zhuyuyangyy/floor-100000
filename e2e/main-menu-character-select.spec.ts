import { expect, test, type Page } from '@playwright/test';

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (sceneKey) => {
      const game = (window as unknown as {
        __PHASER_GAME__?: { scene: { getScenes: (active?: boolean) => Array<{ scene: { key: string } }> } };
      }).__PHASER_GAME__;
      return !!game && game.scene.getScenes(true).some((entry) => entry.scene.key === sceneKey);
    },
    key,
    { timeout: 20_000 },
  );
}

async function hasVisibleText(page: Page, sceneKey: string, fragment: string): Promise<boolean> {
  return page.evaluate(({ key, text }) => {
    const game = (window as unknown as {
      __PHASER_GAME__?: {
        scene: {
          getScene: (sceneKey: string) => {
            children: { list: Array<{ type: string; text?: string; visible: boolean }> };
          } | null;
        };
      };
    }).__PHASER_GAME__;
    const objects = game?.scene.getScene(key)?.children.list ?? [];
    return objects.some((object) => object.type === 'Text' && object.visible && (object.text ?? '').includes(text));
  }, { key: sceneKey, text: fragment });
}

test('title menu, help and character selection lead into a playable run', async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  await page.waitForTimeout(700);
  expect(await hasVisibleText(page, 'Menu', '第100000层')).toBe(true);
  expect(await hasVisibleText(page, 'Menu', '开始新游戏')).toBe(true);
  expect(await hasVisibleText(page, 'Menu', '继续游戏')).toBe(false);
  await page.screenshot({ path: 'art-src/community-ui/previews/main-menu-title.png' });

  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(180);
  expect(await hasVisibleText(page, 'Menu', 'A/D 或 ←/→ 移动')).toBe(true);
  await page.screenshot({ path: 'art-src/community-ui/previews/main-menu-help.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);

  await page.reload();
  await waitForScene(page, 'Menu');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  await page.waitForTimeout(350);
  expect(await hasVisibleText(page, 'MetaSelect', '幸存者')).toBe(true);
  expect(await hasVisibleText(page, 'MetaSelect', '阿林')).toBe(true);
  expect(await hasVisibleText(page, 'MetaSelect', '小周')).toBe(true);
  expect(await hasVisibleText(page, 'MetaSelect', '流浪者')).toBe(true);
  expect(await hasVisibleText(page, 'MetaSelect', '最深第 2 层解锁')).toBe(true);
  expect(await hasVisibleText(page, 'MetaSelect', '模式 冒险')).toBe(true);
  expect(await hasVisibleText(page, 'MetaSelect', '◇ 铁胃 · 第 3 层')).toBe(true);
  expect(await hasVisibleText(page, 'MetaSelect', '◇ 疾行 · 第 3 层')).toBe(true);
  await page.screenshot({ path: 'art-src/community-ui/previews/character-select-player.png' });

  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(160);
  expect(await hasVisibleText(page, 'MetaSelect', '阿林')).toBe(true);
  await page.screenshot({ path: 'art-src/community-ui/previews/character-select-locked.png' });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  expect(await hasVisibleText(page, 'MetaSelect', '还未相遇')).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const game = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScenes: (active?: boolean) => Array<{ scene: { key: string } }> } };
    }).__PHASER_GAME__;
    return game?.scene.getScenes(true).some((entry) => entry.scene.key === 'MetaSelect') ?? false;
  })).toBe(true);

  await page.keyboard.press('Escape');
  await waitForScene(page, 'Menu');
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  await page.waitForTimeout(300);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(120);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(120);
  expect(await hasVisibleText(page, 'MetaSelect', '模式 简单')).toBe(true);
  expect(await hasVisibleText(page, 'MetaSelect', '饥渴衰减 ×0.7')).toBe(true);
  await page.screenshot({ path: 'art-src/community-ui/previews/character-select-mode-easy.png' });
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(120);
  expect(await hasVisibleText(page, 'MetaSelect', '模式 冒险')).toBe(true);

  await page.keyboard.press('Enter');
  await waitForScene(page, 'Game');
  await page.waitForFunction(() => {
    const game = (window as unknown as {
      __PHASER_GAME__?: {
        scene: { getScene: (key: string) => { children: { list: Array<{ type: string; texture?: { key?: string }; text?: string }> } } | null };
      };
    }).__PHASER_GAME__;
    const list = game?.scene.getScene('Game')?.children.list ?? [];
    return list.some((object) => object.type === 'Sprite' && (object.texture?.key ?? '').startsWith('char-'));
  }, undefined, { timeout: 10_000 });
  const selectedCharacter = await page.evaluate(() => {
    const raw = localStorage.getItem('floor100000.meta.v1');
    return raw ? (JSON.parse(raw) as { selectedCharacter?: string }).selectedCharacter : null;
  });
  expect(selectedCharacter).toBe('player');
  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
});
