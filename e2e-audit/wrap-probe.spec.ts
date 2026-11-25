import { expect, test, type Page } from '@playwright/test';

// 探针脚本：只读地检查两件事，不改游戏状态。
//   1) 所有带 wordWrap 的 Text 在中文（无空格）串上是否真的换行；
//   2) MetaSelect 上角色说明文字的实际包围盒与面板/按钮的关系。
//
// Phaser 默认的 wordWrap 按空格断词。中文没有空格，所以整串是一个「词」，
// 宽度超过 wordWrap.width 也不会折行 —— 除非开 useAdvancedWrap。
// 这个脚本就是把这件事从「怀疑」变成「证据」。

interface ProbeText {
  name: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  wrapWidth: number | null;
  advancedWrap: boolean;
  fontSize: string;
  visible: boolean;
  depth: number;
}

async function dumpTexts(page: Page, sceneKey: string): Promise<ProbeText[]> {
  return page.evaluate((key) => {
    const g = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: unknown[] } } | null } };
    }).__PHASER_GAME__;
    const scene = g?.scene.getScene(key);
    const list = (scene?.children.list ?? []) as Array<Record<string, unknown>>;
    const out: ProbeText[] = [];
    for (const o of list) {
      if (o.type !== 'Text') continue;
      const style = (o.style ?? {}) as { wordWrapWidth?: number; wordWrap?: { width?: number; useAdvancedWrap?: boolean }; fontSize?: string };
      const wrap = style.wordWrap as { width?: number; useAdvancedWrap?: boolean } | undefined;
      out.push({
        name: String(o.name ?? ''),
        text: String(o.text ?? ''),
        x: o.x as number,
        y: o.y as number,
        width: o.width as number,
        height: o.height as number,
        wrapWidth: wrap?.width ?? style.wordWrapWidth ?? null,
        advancedWrap: Boolean(wrap?.useAdvancedWrap),
        fontSize: style.fontSize ?? '',
        visible: Boolean(o.visible),
        depth: (o.depth as number) ?? 0,
      });
    }
    return out;
  }, sceneKey);
}

test('probe: wordWrap on CJK text', async ({ page }) => {
  await page.goto('/?seed=42&debug=1');
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Menu'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect'));
  await page.waitForTimeout(600);

  const texts = await dumpTexts(page, 'MetaSelect');
  const wrapped = texts.filter((t) => t.wrapWidth !== null && t.wrapWidth! > 0 && t.text.length > 0);
  for (const t of wrapped) {
    const overflows = t.width > t.wrapWidth! + 0.5;
    console.log(
      `[wrap] "${t.text}" size=${t.fontSize} width=${t.width.toFixed(1)} wrap=${t.wrapWidth} height=${t.height.toFixed(1)} advanced=${t.advancedWrap} ${overflows ? '>>> OVERFLOWS WRAP BOX' : 'ok'}`,
    );
  }
  expect(wrapped.length).toBeGreaterThan(0);
});

test('probe: game scene CJK wrap', async ({ page }) => {
  await page.goto('/?seed=42&debug=1');
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Menu'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect'));
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Enter');
    const started = await page
      .waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'), undefined, { timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    if (started) break;
  }
  await page.waitForTimeout(1200);
  const texts = await dumpTexts(page, 'Game');
  for (const t of texts.filter((x) => x.wrapWidth !== null && x.wrapWidth! > 0 && x.text.length > 0)) {
    const overflows = t.width > t.wrapWidth! + 0.5;
    console.log(
      `[game-wrap] name=${t.name} "${t.text.slice(0, 40)}" size=${t.fontSize} width=${t.width.toFixed(1)} wrap=${t.wrapWidth} height=${t.height.toFixed(1)} advanced=${t.advancedWrap} ${overflows ? '>>> OVERFLOWS' : 'ok'}`,
    );
  }
});