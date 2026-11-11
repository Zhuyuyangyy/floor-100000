import { expect, test, type Page } from '@playwright/test';

type ViewportCase = {
  name: string;
  width: number;
  height: number;
};

type TextBox = {
  text: string;
  x: number;
  y: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

const VIEWPORTS: ViewportCase[] = [
  { name: 'compact-1024x600', width: 1024, height: 600 },
  { name: '720p-1280x720', width: 1280, height: 720 },
  { name: 'laptop-1366x768', width: 1366, height: 768 },
];

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction((sceneKey) => {
    const game = window.__PHASER_GAME__;
    return !!game && game.scene.getScenes(true).some((scene) => scene.scene.key === sceneKey);
  }, key);
}

async function startGame(page: Page): Promise<void> {
  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const started = await page.waitForFunction(() => {
      const game = window.__PHASER_GAME__;
      return !!game && game.scene.getScenes(true).some((scene) => scene.scene.key === 'Game');
    }, undefined, { timeout: 2000 }).then(() => true).catch(() => false);
    if (started) break;
  }
  await waitForScene(page, 'Game');
}

async function visibleTextBoxes(page: Page, matcher: string): Promise<TextBox[]> {
  return page.evaluate((needle) => {
    type TextObject = {
      type: string;
      text?: string;
      visible: boolean;
      getBounds?: () => { x: number; y: number; right: number; bottom: number; width: number; height: number };
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    };
    const game = window.__PHASER_GAME__ as unknown as {
      scene: { getScene: (key: string) => { children: { list: TextObject[] } } | null };
    } | undefined;
    const list = game?.scene.getScene('Game')?.children.list ?? [];
    return list
      .filter((object) => object.type === 'Text' && object.visible && typeof object.text === 'string' && object.text.includes(needle))
      .map((object) => {
        const bounds = object.getBounds?.();
        const x = bounds?.x ?? object.x ?? 0;
        const y = bounds?.y ?? object.y ?? 0;
        const width = bounds?.width ?? object.width ?? 0;
        const height = bounds?.height ?? object.height ?? 0;
        return {
          text: object.text ?? '',
          x,
          y,
          right: bounds?.right ?? x + width,
          bottom: bounds?.bottom ?? y + height,
          width,
          height,
        };
      });
  }, matcher);
}

async function takePanelScreenshots(page: Page, name: string): Promise<void> {
  await page.keyboard.press('C');
  await expect.poll(async () => (await visibleTextBoxes(page, '工作台 · 制作与升级')).length).toBeGreaterThan(0);
  await page.screenshot({ path: `art-src/community-ui/previews/panel-craft-${name}.png` });

  await page.keyboard.press('C');
  await page.evaluate(() => {
    const state = window.__PHASER_SESSION__?.getState();
    if (!state) throw new Error('no active session');
    state.gameMinuteOfDay = 1200;
    state.player.x = 1120;
    state.diary = [{
      kind: 'shelter_rested',
      message: '墙面漏风需要检查。夜间巡查听见走廊里有金属碰撞声，邻居说楼上的储物柜似乎被人翻动过，明天应当先确认照明和供水情况。',
    }];
  });
  await page.keyboard.press('E');
  await expect.poll(async () => (await visibleTextBoxes(page, '夜间安排 · 宿舍')).length).toBeGreaterThan(0);
  await page.screenshot({ path: `art-src/community-ui/previews/panel-shelter-${name}.png` });
}

test.describe('制作与宿舍面板的常见分辨率适配', () => {
  test.describe.configure({ mode: 'serial' });

  for (const viewport of VIEWPORTS) {
    test(`${viewport.name}：面板完整显示并通过实际浏览器截图`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await startGame(page);
      await takePanelScreenshots(page, viewport.name);

      const craftTitle = await visibleTextBoxes(page, '工作台 · 制作与升级');
      const shelterTitle = await visibleTextBoxes(page, '夜间安排 · 宿舍');
      expect(craftTitle).toHaveLength(0); // The final E interaction has replaced the workbench panel.
      expect(shelterTitle).toHaveLength(1);
      const shelterSummary = await visibleTextBoxes(page, '上次：');
      expect(shelterSummary).toHaveLength(1);
      const shelterFooter = await visibleTextBoxes(page, '↑/↓ 选择 · Enter 安排 · ESC 返回');
      expect(shelterFooter).toHaveLength(1);

      // A deliberately long-but-plausible diary line is test-only in-memory data.
      // The summary must stay above the first action row (y=262 in the design canvas).
      expect(shelterSummary[0]!.bottom, 'long diary text must not run into the first action card').toBeLessThanOrEqual(262);
      expect(shelterSummary[0]!.right, 'long diary text must remain within the info well').toBeLessThanOrEqual(1056);
      expect(shelterSummary[0]!.text.endsWith('…'), 'a shortened diary preview must show an ellipsis').toBe(true);
      expect(shelterFooter[0]!.y, 'footer text must remain below the last action card').toBeGreaterThanOrEqual(530);
      expect(shelterFooter[0]!.bottom, 'footer must remain within the panel bottom').toBeLessThanOrEqual(580);
    });
  }
});
