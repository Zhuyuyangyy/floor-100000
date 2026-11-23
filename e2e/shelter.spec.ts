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

  test('shelter mouse controls stay inside the frame, save the plan, and sleep exactly once', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/?seed=42');
    await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((scene) => scene.scene.key === 'Menu'));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((scene) => scene.scene.key === 'MetaSelect'));
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Enter');
      const started = await page.waitForFunction(
        () => window.__PHASER_GAME__?.scene.getScenes(true).some((scene) => scene.scene.key === 'Game'),
        undefined,
        { timeout: 2000 },
      ).then(() => true).catch(() => false);
      if (started) break;
    }
    await page.waitForFunction(() => window.__PHASER_SESSION__?.getState() && window.__PHASER_GAME__?.scene.getScenes(true).some((scene) => scene.scene.key === 'Game'));
    // As in the existing shelter fixture, only set the night gate and bed
    // position; opening, choosing, returning, and sleeping use real inputs.
    await page.evaluate(() => {
      const state = window.__PHASER_SESSION__?.getState();
      if (!state) throw new Error('no session state');
      state.gameMinuteOfDay = 1200;
      state.player.x = 1120;
    });
    await page.keyboard.press('E');
    await page.waitForFunction(() => {
      const game = window.__PHASER_GAME__;
      const scene = game?.scene.getScene('Game') as unknown as { shelterOpen?: boolean } | null;
      return scene?.shelterOpen === true;
    });

    const panelLayout = async () => page.evaluate(() => {
      type TextObject = {
        type: string;
        text?: string;
        visible: boolean;
        x: number;
        y: number;
        scrollFactorX: number;
        scrollFactorY: number;
        getBounds: () => { x: number; y: number; width: number; height: number };
      };
      const game = window.__PHASER_GAME__ as unknown as {
        canvas: HTMLCanvasElement;
        scene: { getScene: (key: string) => { shelterOpen: boolean; shelterObjects: TextObject[] } };
      };
      const scene = game.scene.getScene('Game');
      const texts = scene.shelterObjects
        .filter((object) => object.type === 'Text' && object.visible)
        .map((object) => {
          const bounds = object.getBounds();
          return { text: object.text ?? '', x: object.x, y: object.y, scrollFactorX: object.scrollFactorX, scrollFactorY: object.scrollFactorY, bounds: { left: bounds.x, right: bounds.x + bounds.width, top: bounds.y, bottom: bounds.y + bounds.height } };
        });
      return { width: game.canvas.width, height: game.canvas.height, open: scene.shelterOpen, texts };
    });
    const clickText = async (label: string) => {
      const point = await page.evaluate((wanted) => {
        const game = window.__PHASER_GAME__ as unknown as { canvas: HTMLCanvasElement; scene: { getScene: (key: string) => { shelterObjects: Array<{ type: string; text?: string; visible: boolean; x: number; y: number }> } } };
        const matches = game.scene.getScene('Game').shelterObjects.filter((object) => object.type === 'Text' && object.visible && object.text === wanted);
        if (matches.length !== 1) throw new Error(`Expected one visible shelter text ${JSON.stringify(wanted)}, found ${matches.length}`);
        return { x: matches[0].x / game.canvas.width, y: matches[0].y / game.canvas.height };
      }, label);
      const canvas = await page.locator('canvas').boundingBox();
      if (!canvas) throw new Error('Missing Phaser canvas');
      await page.mouse.click(canvas.x + canvas.width * point.x, canvas.y + canvas.height * point.y);
    };

    const firstLayout = await panelLayout();
    expect(firstLayout.open).toBe(true);
    const frame = { left: firstLayout.width / 2 - 250, right: firstLayout.width / 2 + 250, top: firstLayout.height / 2 - 150, bottom: firstLayout.height / 2 + 150 };
    expect(firstLayout.texts.length).toBeGreaterThanOrEqual(7);
    for (const text of firstLayout.texts) {
      expect(text.scrollFactorX, `${text.text} horizontal screen lock`).toBe(0);
      expect(text.scrollFactorY, `${text.text} vertical screen lock`).toBe(0);
      expect(text.bounds.left, `${text.text} stays inside the frame`).toBeGreaterThanOrEqual(frame.left);
      expect(text.bounds.right, `${text.text} stays inside the frame`).toBeLessThanOrEqual(frame.right);
      if (text.text === '夜间安排 · 宿舍') {
        expect(text.y, 'panel title anchor stays inside the frame').toBeGreaterThan(frame.top);
      } else {
        expect(text.bounds.top, `${text.text} stays inside the frame`).toBeGreaterThanOrEqual(frame.top);
      }
      expect(text.bounds.bottom, `${text.text} stays inside the frame`).toBeLessThanOrEqual(frame.bottom);
    }
    const summary = firstLayout.texts.find((text) => text.text.includes('压力 '));
    const title = firstLayout.texts.find((text) => text.text === '夜间安排 · 宿舍');
    const rest = firstLayout.texts.find((text) => text.text === '休息');
    const firstRowValue = firstLayout.texts.find((text) => text.text.includes('恢复精力'));
    const footer = firstLayout.texts.find((text) => text.text.includes('点击选项安排'));
    expect(summary).toBeDefined();
    expect(title).toBeDefined();
    expect(rest).toBeDefined();
    expect(firstRowValue).toBeDefined();
    expect(footer).toBeDefined();
    expect(title!.bounds.bottom).toBeLessThan(summary!.bounds.top);
    expect(summary!.bounds.bottom).toBeLessThan(rest!.bounds.top);
    expect(summary!.bounds.bottom).toBeLessThan(firstRowValue!.bounds.top);
    expect(rest!.bounds.bottom).toBeLessThan(footer!.bounds.top);
    expect(footer!.bounds.bottom).toBeLessThan(frame.bottom - 4);

    // An unassigned click is absorbed by the modal shield rather than leaking
    // through to the world or closing the panel.
    const canvas = await page.locator('canvas').boundingBox();
    if (!canvas) throw new Error('Missing Phaser canvas');
    await page.mouse.click(canvas.x + 8, canvas.y + 8);
    await expect.poll(async () => (await panelLayout()).open).toBe(true);
    expect((await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.shelterPlan))).toBeUndefined();

    await clickText('休息');
    await page.waitForFunction(() => window.__PHASER_SESSION__?.getState()?.shelterPlan?.resolved === true);
    const resolvedLayout = await panelLayout();
    const sleep = resolvedLayout.texts.find((text) => text.text === '点击睡觉');
    const back = resolvedLayout.texts.find((text) => text.text === '点击返回');
    const resolvedSummary = resolvedLayout.texts.find((text) => text.text.includes('上次：'));
    expect(sleep).toBeDefined();
    expect(back).toBeDefined();
    expect(resolvedSummary).toBeDefined();
    expect(title!.bounds.bottom).toBeLessThan(resolvedSummary!.bounds.top);
    expect(resolvedSummary!.bounds.bottom).toBeLessThan(rest!.bounds.top);
    expect(sleep!.bounds.bottom).toBeLessThan(frame.bottom - 4);
    expect(back!.bounds.bottom).toBeLessThan(frame.bottom - 4);
    for (const text of resolvedLayout.texts) {
      expect(text.scrollFactorX, `${text.text} horizontal screen lock after plan`).toBe(0);
      expect(text.scrollFactorY, `${text.text} vertical screen lock after plan`).toBe(0);
      expect(text.bounds.left).toBeGreaterThanOrEqual(frame.left);
      expect(text.bounds.right).toBeLessThanOrEqual(frame.right);
      if (text.text === '夜间安排 · 宿舍') expect(text.y).toBeGreaterThan(frame.top);
      else expect(text.bounds.top).toBeGreaterThanOrEqual(frame.top);
      expect(text.bounds.bottom).toBeLessThanOrEqual(frame.bottom);
    }
    const savedPlan = await page.evaluate(() => {
      const raw = localStorage.getItem('floor100000.save.v1');
      return raw ? JSON.parse(raw) as { day: number; shelterPlan?: { action: string; resolved: boolean }; diary?: Array<{ kind: string }> } : null;
    });
    expect(savedPlan?.day).toBe(1);
    expect(savedPlan?.shelterPlan).toEqual({ day: 1, action: 'rest', resolved: true });
    expect(savedPlan?.diary?.filter((event) => event.kind === 'shelter_rested')).toHaveLength(1);

    await clickText('点击返回');
    await expect.poll(async () => (await panelLayout()).open).toBe(false);
    expect((await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.shelterPlan?.resolved))).toBe(true);
    await page.keyboard.press('E');
    await expect.poll(async () => (await panelLayout()).open).toBe(true);
    await clickText('点击睡觉');
    await page.waitForFunction(() => window.__PHASER_SESSION__?.getState()?.day === 2);
    const state = await page.evaluate(() => window.__PHASER_SESSION__?.getState());
    expect(state?.gameMinuteOfDay).toBeGreaterThanOrEqual(360);
    expect(state?.gameMinuteOfDay).toBeLessThan(365);
    expect(state?.player.energy).toBeGreaterThan(99);
    expect(state?.player.energy).toBeLessThanOrEqual(100);
    expect(state?.diary?.filter((event) => event.kind === 'shelter_rested')).toHaveLength(1);
    const savedAfterSleep = await page.evaluate(() => {
      const raw = localStorage.getItem('floor100000.save.v1');
      return raw ? JSON.parse(raw) as { day: number; gameMinuteOfDay: number; player: { energy: number }; shelterPlan?: unknown; diary?: Array<{ kind: string }> } : null;
    });
    expect(savedAfterSleep?.day).toBe(2);
    expect(savedAfterSleep?.gameMinuteOfDay).toBeGreaterThanOrEqual(360);
    expect(savedAfterSleep?.gameMinuteOfDay).toBeLessThan(365);
    expect(savedAfterSleep?.player.energy).toBeGreaterThan(99.9);
    expect(savedAfterSleep?.player.energy).toBeLessThanOrEqual(100);
    expect(savedAfterSleep?.shelterPlan).toBeUndefined();
    expect(savedAfterSleep?.diary?.filter((event) => event.kind === 'shelter_rested')).toHaveLength(1);
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('a deterministic unreinforced shelter can be attacked overnight', async ({ page }) => {
    await page.goto('/?seed=1');
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
    await page.evaluate(() => {
      const state = window.__PHASER_SESSION__?.getState();
      if (!state) throw new Error('no session state');
      state.gameMinuteOfDay = 1200;
      state.player.x = 1120;
    });
    await page.keyboard.press('E');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !!window.__PHASER_SESSION__?.getState()?.shelterPlan?.resolved);
    await page.keyboard.press('E');
    await page.waitForFunction(() => window.__PHASER_SESSION__?.getState()?.day === 2);

    const state = await page.evaluate(() => window.__PHASER_SESSION__?.getState());
    expect(state?.player.hp).toBe(88);
    expect(state?.diary?.some((event) => event.kind === 'shelter_attacked')).toBe(true);
  });
});
