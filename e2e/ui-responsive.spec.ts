import { expect, test, type Page } from '@playwright/test';

const LOGICAL_WIDTH = 1280;
const LOGICAL_HEIGHT = 720;

const VIEWPORTS = [
  { name: 'baseline 1280x720', width: 1280, height: 720 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1024x768', width: 1024, height: 768 },
] as const;

interface SceneText {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  scrollFactorX: number;
  scrollFactorY: number;
}

interface SceneTextSnapshot {
  texts: SceneText[];
  logicalWidth: number;
  logicalHeight: number;
  camera: { x: number; y: number; scrollX: number; scrollY: number; zoom: number };
}

interface PhaserTextChild {
  type: string;
  text?: string;
  visible: boolean;
  alpha?: number;
  depth?: number;
  scrollFactorX?: number;
  scrollFactorY?: number;
  getBounds?: () => { x: number; y: number; width: number; height: number };
}

interface E2EPhaserGame {
  config: { width: number; height: number };
  scene: {
    getScene: (sceneKey: string) => {
      cameras: { main: { x: number; y: number; scrollX: number; scrollY: number; zoom: number } };
      children: { list: PhaserTextChild[] };
    } | null;
  };
}

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

async function waitForText(page: Page, sceneKey: string, fragment: string): Promise<void> {
  await page.waitForFunction(
    ({ key, text }) => {
      const game = (window as unknown as {
        __PHASER_GAME__?: {
          scene: { getScene: (sceneKey: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean; alpha?: number }> } } | null };
        };
      }).__PHASER_GAME__;
      const children = game?.scene.getScene(key)?.children.list ?? [];
      return children.some((child) => child.type === 'Text'
        && child.visible
        && (child.alpha ?? 1) > 0.01
        && (child.text ?? '').includes(text));
    },
    { key: sceneKey, text: fragment },
    { timeout: 15_000 },
  );
}

async function advanceFrames(page: Page, count = 2): Promise<void> {
  await page.evaluate(async (frames) => {
    for (let i = 0; i < frames; i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }, count);
}

/**
 * Read actual Phaser Text.getBounds() values, then project them through the
 * active scene camera into the fixed logical canvas. CSS viewport scaling from
 * Phaser.Scale.FIT is intentionally not involved in these coordinates.
 */
async function readSceneTexts(page: Page, sceneKey: string): Promise<SceneTextSnapshot> {
  return page.evaluate(({ key }) => {
    const game = (window as unknown as { __PHASER_GAME__?: E2EPhaserGame }).__PHASER_GAME__;
    const scene = game?.scene.getScene(key);
    if (!game || !scene) throw new Error(`Missing Phaser scene: ${key}`);
    const camera = scene.cameras.main;
    const texts = (scene.children.list ?? [])
      .filter((child) => child.type === 'Text'
        && child.visible
        && (child.alpha ?? 1) > 0.01
        && (child.text ?? '').trim().length > 0
        && typeof child.getBounds === 'function')
      .map((child) => {
        const bounds = child.getBounds!();
        return {
          text: child.text ?? '',
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          depth: child.depth ?? 0,
          scrollFactorX: child.scrollFactorX ?? 1,
          scrollFactorY: child.scrollFactorY ?? 1,
        };
      });
    return {
      texts,
      logicalWidth: game.config.width,
      logicalHeight: game.config.height,
      camera: {
        x: camera.x,
        y: camera.y,
        scrollX: camera.scrollX,
        scrollY: camera.scrollY,
        zoom: camera.zoom,
      },
    };
  }, { key: sceneKey });
}

function toCanvasBounds(text: SceneText, camera: SceneTextSnapshot['camera']) {
  return {
    x: camera.x + (text.x - camera.scrollX * text.scrollFactorX) * camera.zoom,
    y: camera.y + (text.y - camera.scrollY * text.scrollFactorY) * camera.zoom,
    width: text.width * camera.zoom,
    height: text.height * camera.zoom,
  };
}

function assertVisibleTextWithinLogicalCanvas(sceneKey: string, snapshot: SceneTextSnapshot): void {
  expect(snapshot.logicalWidth, `${sceneKey} Phaser logical width`).toBe(LOGICAL_WIDTH);
  expect(snapshot.logicalHeight, `${sceneKey} Phaser logical height`).toBe(LOGICAL_HEIGHT);

  const tolerance = 0.75;
  const outOfBounds = snapshot.texts.flatMap((text) => {
    const bounds = toCanvasBounds(text, snapshot.camera);
    const intersectsCanvas = bounds.x < LOGICAL_WIDTH
      && bounds.y < LOGICAL_HEIGHT
      && bounds.x + bounds.width > 0
      && bounds.y + bounds.height > 0;
    // Text completely outside the camera view is not currently rendered (for
    // example, labels attached to neighboring floors in GameScene). Any text
    // rendered even partially must fit; hidden/zero-alpha text was filtered out.
    if (!intersectsCanvas) return [];
    const outside = bounds.x < -tolerance
      || bounds.y < -tolerance
      || bounds.x + bounds.width > LOGICAL_WIDTH + tolerance
      || bounds.y + bounds.height > LOGICAL_HEIGHT + tolerance;
    return outside ? [{ text: text.text, bounds }] : [];
  });
  expect(outOfBounds, `${sceneKey} visible Text bounds outside 1280x720: ${JSON.stringify(outOfBounds)}`).toEqual([]);
}

function assertNoOverlapAmong(sceneKey: string, snapshot: SceneTextSnapshot, fragments: string[]): void {
  const selected = snapshot.texts.filter((entry) => fragments.some((fragment) => entry.text.includes(fragment)));
  const overlaps: Array<{ first: string; second: string; intersection: { width: number; height: number } }> = [];
  for (let i = 0; i < selected.length; i++) {
    const a = toCanvasBounds(selected[i], snapshot.camera);
    for (let j = i + 1; j < selected.length; j++) {
      const b = toCanvasBounds(selected[j], snapshot.camera);
      const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      // Phaser text metrics can have subpixel rounding. Ignore mere edge contact,
      // but fail on a real shared text area. Decorative panels and marker images
      // are never included in this curated text-only set.
      if (width > 1 && height > 1) {
        overlaps.push({ first: selected[i].text, second: selected[j].text, intersection: { width, height } });
      }
    }
  }
  const candidateBounds = selected.map((entry) => ({
    text: entry.text,
    ...toCanvasBounds(entry, snapshot.camera),
  }));
  expect(overlaps, `${sceneKey} key UI text overlaps: ${JSON.stringify({ candidateBounds, overlaps })}`).toEqual([]);
}

async function expectSceneLayout(
  page: Page,
  sceneKey: string,
  required: string[],
  overlapCandidates: string[],
): Promise<void> {
  for (const fragment of required) await waitForText(page, sceneKey, fragment);
  const snapshot = await readSceneTexts(page, sceneKey);
  assertVisibleTextWithinLogicalCanvas(sceneKey, snapshot);
  assertNoOverlapAmong(sceneKey, snapshot, overlapCandidates);
}

async function sceneIsActive(page: Page, key: string): Promise<boolean> {
  return page.evaluate((sceneKey) => {
    const game = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScenes: (active?: boolean) => Array<{ scene: { key: string } }> } };
    }).__PHASER_GAME__;
    return game?.scene.getScenes(true).some((entry) => entry.scene.key === sceneKey) ?? false;
  }, key);
}

async function readStableRunState(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const state = (window as unknown as {
      __PHASER_SESSION__?: { getState: () => {
        currentFloor: number;
        status: string;
        player: {
          x: number;
          inventory: { slotCount: number; slots: Array<{ itemId: string; quantity: number }> };
        };
      } | null };
    }).__PHASER_SESSION__?.getState();
    if (!state) throw new Error('Expected active game session');
    // Exclude real-time survival decay and animation-only data. Opening a panel
    // must not change player position, floor, inventory, or run status.
    return {
      currentFloor: state.currentFloor,
      status: state.status,
      player: {
        x: state.player.x,
        inventory: state.player.inventory,
      },
    };
  });
}

for (const viewport of VIEWPORTS) {
  test(`responsive UI stays within the 1280x720 logical canvas (${viewport.name})`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/?seed=42');
    await waitForScene(page, 'Menu');
    await waitForText(page, 'Menu', '开始新游戏');
    await waitForText(page, 'Menu', '操作说明');
    await advanceFrames(page);
    await expectSceneLayout(
      page,
      'Menu',
      ['第100000层', '末 日 宿 舍', '主菜单', '开始新游戏', '操作说明', '↑/↓ 选择 · Enter 确认'],
      ['第100000层', '末 日 宿 舍', '主菜单', '开始新游戏', '操作说明', '↑/↓ 选择 · Enter 确认'],
    );

    // Navigate to help with real keyboard input, verify its content/layout,
    // then close it with Escape. No game session exists until starting a run.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await waitForText(page, 'Menu', 'A/D 或 ←/→ 移动');
    await expectSceneLayout(
      page,
      'Menu',
      [
        'A/D 或 ←/→ 移动',
        'E 交互（开箱 / 对话 / 上下楼 / 睡觉）',
        'I 背包 · C 制作 · M 塔楼地图 · ESC 暂停',
        '目标：从第 1 层爬到第 100000 层的统治核心',
        '按 Enter / ESC 关闭',
      ],
      [
        'A/D 或 ←/→ 移动',
        'E 交互（开箱 / 对话 / 上下楼 / 睡觉）',
        'I 背包 · C 制作 · M 塔楼地图 · ESC 暂停',
        '目标：从第 1 层爬到第 100000 层的统治核心',
        '按 Enter / ESC 关闭',
      ],
    );
    await page.keyboard.press('Escape');
    await expect.poll(() => sceneIsActive(page, 'Menu')).toBe(true);
    await page.waitForFunction(() => {
      const game = (window as unknown as {
        __PHASER_GAME__?: { scene: { getScene: (key: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean }> } } | null } };
      }).__PHASER_GAME__;
      const children = game?.scene.getScene('Menu')?.children.list ?? [];
      return !children.some((child) => child.type === 'Text' && child.visible && child.text === '按 Enter / ESC 关闭');
    });
    expect(await sceneIsActive(page, 'MetaSelect')).toBe(false);

    // Help leaves selection on its row; move back to the new-run row, then
    // confirm through the normal menu path into character selection.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await waitForScene(page, 'MetaSelect');
    await waitForText(page, 'MetaSelect', '幸存者');
    await expectSceneLayout(
      page,
      'MetaSelect',
      ['出发之前', '幸存者', '阿林', '小周', '流浪者', '模式 冒险', '遗物记录', '↑/↓ 角色 · ←/→ 模式 · Enter 出发 · ESC 返回标题'],
      ['出发之前', '幸存者', '阿林', '小周', '流浪者', '模式 冒险', '遗物记录', '↑/↓ 角色 · ←/→ 模式 · Enter 出发 · ESC 返回标题'],
    );
    const adventureBlurbHeight = await page.evaluate(() => {
      const game = (window as unknown as {
        __PHASER_GAME__?: {
          scene: {
            getScene: (key: string) => {
              children: { list: Array<{ type: string; text?: string; getBounds?: () => { height: number } }> };
            } | null;
          };
        };
      }).__PHASER_GAME__;
      const children = game?.scene.getScene('MetaSelect')?.children.list ?? [];
      const blurb = children.find((child) => child.type === 'Text' && child.text === '标准规则。自动存档，死了就重来。');
      if (!blurb?.getBounds) throw new Error('Missing adventure mode description');
      return blurb.getBounds().height;
    });
    expect(adventureBlurbHeight, 'adventure mode copy must not strand its final punctuation on a second line').toBeLessThanOrEqual(24);

    // Confirm the default unlocked survivor without changing mode or navigating
    // to a locked option; this is the normal character-select keyboard action.
    await advanceFrames(page);
    await page.keyboard.press('Enter');
    await waitForScene(page, 'Game');
    await waitForText(page, 'Game', 'A/D 移动');
    await page.waitForFunction(() => {
      const game = (window as unknown as {
        __PHASER_GAME__?: { scene: { getScene: (key: string) => { children: { list: Array<{ type: string; texture?: { key?: string } }> } } | null } };
      }).__PHASER_GAME__;
      const children = game?.scene.getScene('Game')?.children.list ?? [];
      return children.some((child) => child.type === 'Sprite' && (child.texture?.key ?? '').startsWith('char-'));
    }, undefined, { timeout: 10_000 });
    await expectSceneLayout(page, 'Game', ['层', 'A/D 移动'], ['A/D 移动']);

    const stateBeforeBag = await readStableRunState(page);
    await page.keyboard.press('I');
    await waitForText(page, 'Game', '背包');
    await waitForText(page, 'Game', '净水');
    await expectSceneLayout(page, 'Game', ['背包', '净水', 'I 关闭'], ['背包', '净水', '持有', '水分 +30', 'I 关闭']);
    expect(await sceneIsActive(page, 'Game'), 'opening the bag must not leave gameplay').toBe(true);
    expect(await readStableRunState(page), 'opening/reading the bag must not mutate run state').toEqual(stateBeforeBag);

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  });
}
