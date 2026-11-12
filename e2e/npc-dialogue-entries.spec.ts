import { expect, test, type Page } from '@playwright/test';

interface State {
  currentFloor: number;
  player: { x: number };
}

const MAIN_OPTIONS = ['问候', '询问', '交易', '退出'];
const ALIN_TRADE_OPTIONS = ['用 废金属×1 换 电线×1', '用 电池×1 换 保险丝×1', '返回'];

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (sceneKey) => {
      const game = (window as unknown as {
        __PHASER_GAME__?: { scene: { getScenes: (running?: boolean) => Array<{ scene: { key: string } }> } };
      }).__PHASER_GAME__;
      return !!game && game.scene.getScenes(true).some((scene) => scene.scene.key === sceneKey);
    },
    key,
    { timeout: 20_000 },
  );
}

async function startGame(page: Page): Promise<void> {
  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');

  for (let attempt = 0; attempt < 5; attempt++) {
    await page.keyboard.press('Enter');
    const started = await page.waitForFunction(
      () => {
        const game = (window as unknown as {
          __PHASER_GAME__?: { scene: { getScenes: (running?: boolean) => Array<{ scene: { key: string } }> } };
        }).__PHASER_GAME__;
        return !!game && game.scene.getScenes(true).some((scene) => scene.scene.key === 'Game');
      },
      undefined,
      { timeout: 2_000 },
    ).then(() => true).catch(() => false);
    if (started) break;
  }
  await waitForScene(page, 'Game');
}

async function readState(page: Page): Promise<State> {
  return page.evaluate(() => {
    const state = (window as unknown as {
      __PHASER_SESSION__?: { getState: () => State | null };
    }).__PHASER_SESSION__?.getState();
    if (!state) throw new Error('no game session');
    return state;
  });
}

async function hasVisibleText(page: Page, text: string): Promise<boolean> {
  return page.evaluate((needle) => {
    const game = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (key: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean }> } } | null } };
    }).__PHASER_GAME__;
    const objects = game?.scene.getScene('Game')?.children.list ?? [];
    return objects.some((object) => object.type === 'Text' && object.visible && (object.text ?? '').includes(needle));
  }, text);
}

async function visibleDialogueTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const game = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (key: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean; depth?: number }> } } | null } };
    }).__PHASER_GAME__;
    const objects = game?.scene.getScene('Game')?.children.list ?? [];
    return objects
      .filter((object) => object.type === 'Text' && object.visible && (object.depth ?? 0) >= 190)
      .map((object) => object.text ?? '');
  });
}

async function cursorLabel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const game = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (key: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean; y: number; depth?: number; texture?: { key?: string } }> } } | null } };
    }).__PHASER_GAME__;
    const objects = game?.scene.getScene('Game')?.children.list ?? [];
    const marker = objects.find((object) => object.type === 'Image' && object.texture?.key === 'ui-marker' && object.visible);
    if (!marker) return '';
    return objects.find(
      (object) => object.type === 'Text' && object.visible && (object.depth ?? 0) >= 190 && Math.abs(object.y - marker.y) <= 6,
    )?.text ?? '';
  });
}

async function selectOption(page: Page, options: string[], target: string): Promise<void> {
  const targetIndex = options.indexOf(target);
  if (targetIndex < 0) throw new Error(`unknown dialogue option: ${target}`);
  for (let attempt = 0; attempt < 16; attempt++) {
    const currentIndex = options.indexOf(await cursorLabel(page));
    if (currentIndex === targetIndex) return;
    await page.keyboard.press(currentIndex < targetIndex ? 'ArrowDown' : 'ArrowUp');
    await page.waitForTimeout(110);
  }
  throw new Error(`could not select ${target}; cursor is on ${await cursorLabel(page)}`);
}

async function pressEUntil(page: Page, check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await check()) return;
    await page.keyboard.press('E');
    await page.waitForTimeout(300);
  }
  if (!(await check())) {
    throw new Error(`E interaction did not take effect on floor ${(await readState(page)).currentFloor} at x ${(await readState(page)).player.x}; visible text: ${(await visibleDialogueTexts(page)).join(' | ')}`);
  }
}

async function goToAlin(page: Page): Promise<void> {
  if ((await readState(page)).currentFloor !== 2) {
    await page.evaluate(() => {
      const state = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      if (state) state.player.x = 40;
    });
    await page.keyboard.press('E');
    await page.waitForFunction(
      () => (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState()?.currentFloor === 2,
      undefined,
      { timeout: 20_000 },
    );
  }
  await expect.poll(async () => (await readState(page)).currentFloor).toBe(2);
  await page.evaluate(() => {
    const state = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (state) state.player.x = 480;
  });
  await pressEUntil(page, () => hasVisibleText(page, '阿林（维修工）'));
}

test('阿林对话保留问候、询问、交易及返回/关闭入口', async ({ page }) => {
  await startGame(page);
  await goToAlin(page);

  const mainTexts = await visibleDialogueTexts(page);
  expect(mainTexts).toEqual(expect.arrayContaining(['阿林（维修工）', ...MAIN_OPTIONS]));
  expect(await cursorLabel(page)).toBe('问候');

  // Selecting and confirming each conversational option updates the speech text.
  await page.keyboard.press('Enter');
  await expect.poll(() => hasVisibleText(page, '线路又烧了……你身上有电池吗？')).toBe(true);
  await selectOption(page, MAIN_OPTIONS, '询问');
  await page.keyboard.press('Enter');
  // Greeting and ask share a line-rotation counter, so the ask uses line two.
  await expect.poll(() => hasVisibleText(page, '我拿电线换废金属、保险丝换电池，公平吧？')).toBe(true);

  // The trade entry opens the offer list, and ESC returns to the main dialogue.
  await selectOption(page, MAIN_OPTIONS, '交易');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await visibleDialogueTexts(page)).some((text) => ALIN_TRADE_OPTIONS.includes(text))).toBe(true);
  expect(await visibleDialogueTexts(page)).toEqual(expect.arrayContaining(ALIN_TRADE_OPTIONS));
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await visibleDialogueTexts(page)).includes('问候')).toBe(true);
  expect(await visibleDialogueTexts(page)).toEqual(expect.arrayContaining(MAIN_OPTIONS));

  // E closes an open dialogue; pressing it again at the NPC reopens it.
  await page.keyboard.press('E');
  await expect.poll(() => hasVisibleText(page, '阿林（维修工）')).toBe(false);
  await pressEUntil(page, () => hasVisibleText(page, '阿林（维修工）'));
  expect(await visibleDialogueTexts(page)).toEqual(expect.arrayContaining(MAIN_OPTIONS));
});
