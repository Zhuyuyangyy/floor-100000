import { expect, test, type Page } from '@playwright/test';

interface State {
  currentFloor: number;
  player: { x: number };
}

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (sceneKey) => {
      const game = (window as unknown as {
        __PHASER_GAME__?: { scene: { getScenes: (runningOnly?: boolean) => Array<{ scene: { key: string } }> } };
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
  // MetaSelect binds its keys during create(); retry Enter if the first press
  // lands in the narrow interval after the scene becomes active.
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.keyboard.press('Enter');
    const started = await page.waitForFunction(
      () => {
        const game = (window as unknown as {
          __PHASER_GAME__?: { scene: { getScenes: (runningOnly?: boolean) => Array<{ scene: { key: string } }> } };
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

async function setPlayerX(page: Page, x: number): Promise<void> {
  await page.evaluate((nextX) => {
    const state = (window as unknown as {
      __PHASER_SESSION__?: { getState: () => State | null };
    }).__PHASER_SESSION__?.getState();
    if (state) state.player.x = nextX;
  }, x);
}

async function hasVisibleGameText(page: Page, text: string): Promise<boolean> {
  return page.evaluate((needle) => {
    const game = (window as unknown as {
      __PHASER_GAME__?: {
        scene: { getScene: (key: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean }> } } | null };
      };
    }).__PHASER_GAME__;
    const objects = game?.scene.getScene('Game')?.children.list ?? [];
    return objects.some((object) => object.type === 'Text' && object.visible && (object.text ?? '').includes(needle));
  }, text);
}

async function pressEUntil(page: Page, predicate: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    if (await predicate()) return;
    await page.keyboard.press('E');
    await page.waitForTimeout(250);
  }
  if (!(await predicate())) throw new Error('E interaction did not take effect');
}

async function selectDialogueOption(page: Page, target: string): Promise<void> {
  const options = ['问候', '询问', '交易', '退出'];
  const targetIndex = options.indexOf(target);
  if (targetIndex < 0) throw new Error(`unknown dialogue option: ${target}`);

  const cursorLabel = (): Promise<string> => page.evaluate(() => {
    const game = (window as unknown as {
      __PHASER_GAME__?: {
        scene: { getScene: (key: string) => {
          children: { list: Array<{ type: string; text?: string; visible: boolean; y: number; depth?: number; texture?: { key?: string } }> };
        } | null };
      };
    }).__PHASER_GAME__;
    const objects = game?.scene.getScene('Game')?.children.list ?? [];
    const marker = objects.find((object) => object.type === 'Image' && object.texture?.key === 'ui-marker' && object.visible);
    if (!marker) return '';
    const label = objects.find((object) => object.type === 'Text'
      && object.visible
      && (object.depth ?? 0) >= 190
      && Math.abs(object.y - marker.y) <= 6);
    return label?.text ?? '';
  });

  for (let attempt = 0; attempt < 16; attempt++) {
    const currentIndex = options.indexOf(await cursorLabel());
    if (currentIndex === targetIndex) return;
    await page.keyboard.press(currentIndex < targetIndex ? 'ArrowDown' : 'ArrowUp');
    await page.waitForTimeout(110);
  }
  throw new Error(`could not select ${target}; cursor is at "${await cursorLabel()}"`);
}

test('NPC dialogue panel renders and remains operable with the keyboard', async ({ page }) => {
  await startGame(page);

  // Use the real stair interaction to reach the neighbour floor. Positioning
  // the player at the known NPC is test setup; opening the panel still uses E.
  for (let attempt = 0; attempt < 8 && (await readState(page)).currentFloor !== 2; attempt++) {
    await setPlayerX(page, 40); // UP_EXIT_X on floor 1
    await page.keyboard.press('E');
    await page.waitForFunction(() => window.__PHASER_SESSION__?.getState()?.currentFloor === 2, undefined, { timeout: 1_500 })
      .then(() => true).catch(() => false);
  }
  expect((await readState(page)).currentFloor).toBe(2);

  await setPlayerX(page, 480); // 阿林's authored position on floor 2
  await pressEUntil(page, () => hasVisibleGameText(page, '阿林（维修工）'));

  await expect.poll(() => hasVisibleGameText(page, '线路又烧了……你身上有电池吗？')).toBe(true);
  for (const option of ['问候', '询问', '交易', '退出']) {
    expect(await hasVisibleGameText(page, option), `missing visible option: ${option}`).toBe(true);
  }

  await selectDialogueOption(page, '询问');
  await page.keyboard.press('Enter');
  await expect.poll(() => hasVisibleGameText(page, '电线和保险丝，去维修层(4)的电箱能稳定找到。')).toBe(true);

  await page.keyboard.press('Escape');
  await expect.poll(() => hasVisibleGameText(page, '阿林（维修工）')).toBe(false);
  await pressEUntil(page, () => hasVisibleGameText(page, '阿林（维修工）'));
  expect(await hasVisibleGameText(page, '阿林（维修工）')).toBe(true);
});
