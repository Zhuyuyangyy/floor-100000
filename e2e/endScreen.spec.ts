import { expect, test, type Page } from '@playwright/test';

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (sceneKey) => {
      const game = (window as unknown as {
        __PHASER_GAME__?: { scene: { getScenes: (running?: boolean) => Array<{ scene: { key: string } }> } };
      }).__PHASER_GAME__;
      return !!game && game.scene.getScenes(true).some((entry) => entry.scene.key === sceneKey);
    },
    key,
    { timeout: 30_000 },
  );
}

async function startRun(page: Page, url: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(url);
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');

  // MetaSelect can become active just before it binds its keyboard input.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.keyboard.press('Enter');
    const started = await page.waitForFunction(
      () => {
        const game = (window as unknown as {
          __PHASER_GAME__?: { scene: { getScenes: (running?: boolean) => Array<{ scene: { key: string } }> } };
        }).__PHASER_GAME__;
        return !!game && game.scene.getScenes(true).some((entry) => entry.scene.key === 'Game');
      },
      undefined,
      { timeout: 2_000 },
    ).then(() => true).catch(() => false);
    if (started) break;
  }
  await waitForScene(page, 'Game');
}

async function endSceneTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const game = (window as unknown as {
      __PHASER_GAME__?: {
        scene: {
          getScene: (key: string) => {
            children: { list: Array<{ type: string; text?: string; visible?: boolean }> };
          } | null;
        };
      };
    }).__PHASER_GAME__;
    return (game?.scene.getScene('End')?.children.list ?? [])
      .filter((object) => object.type === 'Text' && object.visible !== false && typeof object.text === 'string')
      .map((object) => object.text as string);
  });
}

test('normal loss reaches the real end scene and Enter starts a fresh run', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startRun(page, '/?seed=42');

  // Set the live run one step from death; GameScene and SurvivalSystem perform
  // the actual loss transition into End. This does not mock or directly start End.
  await page.evaluate(() => {
    const session = (window as unknown as {
      __PHASER_SESSION__?: { getState: () => { status: string; player: { hp: number; thirst: number } } | null };
    }).__PHASER_SESSION__;
    const state = session?.getState();
    if (!state) throw new Error('live game state unavailable');
    state.player.hp = 1;
    state.player.thirst = 0;
  });
  await waitForScene(page, 'End');
  await page.waitForTimeout(250);

  const texts = await endSceneTexts(page);
  expect(texts).toContain('你没能活下来');
  expect(texts).toContain('严重脱水');
  expect(texts).toContain('存活天数');
  expect(texts).toContain('最深纪录');
  expect(texts).toContain('本局得分');
  expect(texts).toContain('按回车开始新一局 · 当前存档将被清除');

  await page.screenshot({ path: 'art-src/community-ui/previews/end-screen-loss.png' });

  await page.keyboard.press('Enter');
  await waitForScene(page, 'Game');
  const restartedStatus = await page.evaluate(() => {
    const session = (window as unknown as {
      __PHASER_SESSION__?: { getState: () => { status: string } | null };
    }).__PHASER_SESSION__;
    return session?.getState()?.status;
  });
  expect(restartedStatus).toBe('playing');
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('legacy win fixture reaches the real settlement path and is clearly labeled', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startRun(page, '/?seed=42&devwin=1');

  // Use the existing ?devwin=1 fixture and put its clock just before the legacy
  // threshold; the normal frame/update path must set status='won' and start End.
  await page.evaluate(() => {
    const session = (window as unknown as {
      __PHASER_SESSION__?: { getState: () => { status: string; day: number; gameMinuteOfDay: number } | null };
    }).__PHASER_SESSION__;
    const state = session?.getState();
    if (!state) throw new Error('live game state unavailable');
    state.day = 8;
    state.gameMinuteOfDay = 359;
  });
  await waitForScene(page, 'End');
  await page.waitForTimeout(250);

  const status = await page.evaluate(() => {
    const session = (window as unknown as {
      __PHASER_SESSION__?: { getState: () => { status: string } | null };
    }).__PHASER_SESSION__;
    return session?.getState()?.status;
  });
  expect(status).toBe('won');

  const texts = await endSceneTexts(page);
  expect(texts).toContain('胜利 · 开发夹具');
  expect(texts).toContain('旧版第 8 天阈值 · 开发夹具（?devwin=1）');
  expect(texts).toContain('正式胜利条件：抵达第 100000 层。');
  expect(texts).toContain('当前正常流程尚无可达胜利；此画面仅由开发夹具触发。');

  await page.screenshot({ path: 'art-src/community-ui/previews/end-screen-win-dev-fixture.png' });
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
