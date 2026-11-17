import { expect, test, type Page } from '@playwright/test';

// AG-60（背包面板放大改版）的浏览器层实测。用户 2026-11-17：「感觉 i 还是
// 比较简陋吧，首先这个背包界面可以稍微做大一点」。
//
// 改版前（本 spec 跑在基线 cec6513 上量的，git stash 后复测）：
//   面板 440x236 居中 (420,242)，40px 格 12 格（4x3），图标 2x，计数 /12 恒为
//   网格尺寸。改版后：880x360 居中 (200,180)，76px 格 14 格（5x3，末行 4），
//   图标 3x，计数读真实容量 slotCount（置物架做成后 /14），末两格未解锁
//   （压暗+斜纹+不响应鼠标）。几何数值在 config/game-balance.json 的 bag 块，
//   布局语言在 render/hudLayout.ts 的 BAG_LAYOUT。
//
// 三视口契约与 HUD 先例同款：设计画布固定 1280x720，窗口 900x600 / 1920x1080
// 由 Scale.FIT letterbox 消化，面板永远居中、不出板——本 spec 在三个视口量
// getBounds 钉死它。

const OLD_PANEL = { w: 440, h: 236 } as const;
const NEW_PANEL = { w: 880, h: 360 } as const;

interface PanelProbe {
  panel: { x: number; y: number; w: number; h: number } | null;
  cells: Array<{ x: number; y: number; w: number; h: number }>;
  icons: Array<{ key: string; scale: number; visible: boolean }>;
  marker: boolean;
  texts: string[];
}

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === k);
    },
    key,
    { timeout: 20_000 },
  );
}

async function startGame(page: Page, seed: number): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  await page.waitForTimeout(350);
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Game');
}

/** 面板外框（ui-frame-item-* 八件的并集）+ 格子矩形 + 物品图标 + 可见文本。 */
async function probeBag(page: Page): Promise<PanelProbe> {
  return page.evaluate(() => {
    type Obj = {
      type: string;
      visible: boolean;
      texture?: { key?: string };
      text?: string;
      x: number;
      y: number;
      width?: number;
      height?: number;
      scaleX?: number;
      fillColor?: number;
      getBounds?: () => { x: number; y: number; width: number; height: number };
    };
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<Obj> } } } } }).__PHASER_GAME__;
    const list: Obj[] = (g?.scene.getScene('Game')?.children.list ?? []) as unknown as Obj[];
    const frames = list.filter((o) => o.type === 'Image' && o.visible && (o.texture?.key ?? '').startsWith('ui-frame-item-'));
    let panel: PanelProbe['panel'] = null;
    if (frames.length > 0) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const f of frames) {
        const b = f.getBounds!();
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.width);
        maxY = Math.max(maxY, b.y + b.height);
      }
      panel = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    // 背包格子：76x76 且 fillColor 非 0 的 Rectangle。每格还配一个同尺寸的
    // 透明命中矩形（hitRect，fill 0x000000），按填充色排除——它是鼠标不是格子。
    const cells = list
      .filter((o) => o.type === 'Rectangle' && o.visible && o.width === 76 && o.height === 76 && (o.fillColor ?? 0) !== 0)
      .map((o) => ({ x: o.x, y: o.y, w: o.width!, h: o.height! }));
    // 物品图标：纹理键是物品 id 的 Image（排除 ui-*/HUD 图标）。
    const icons = list
      .filter((o) => o.type === 'Image' && /^[a-z][a-z_]+$/.test(o.texture?.key ?? '') && !(o.texture?.key ?? '').startsWith('ui-'))
      .map((o) => ({ key: o.texture!.key!, scale: o.scaleX ?? 1, visible: o.visible }));
    const marker = list.some((o) => o.type === 'Image' && o.visible && o.texture?.key === 'ui-marker');
    const texts = list.filter((o) => o.type === 'Text' && o.visible && o.text).map((o) => o.text ?? '');
    return { panel, cells, icons, marker, texts };
  });
}

test('the bag panel opens, is bigger than the 440x236 baseline, and closes', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await page.waitForTimeout(500);

  // 关着的时候什么都没有。
  const closed = await probeBag(page);
  expect(closed.panel).toBeNull();

  await page.keyboard.press('I');
  await page.waitForTimeout(500);
  const open = await probeBag(page);
  expect(open.panel).not.toBeNull();
  const p = open.panel!;
  // 放大前后 getBounds 对比：新尺寸就是配置里的 880x360（设计宽 69%），
  // 面积是旧 440x236 的 2.87 倍——「稍微做大一点」的 measurable 部分。
  expect(p.w).toBe(NEW_PANEL.w);
  expect(p.h).toBe(NEW_PANEL.h);
  expect(p.w * p.h).toBeGreaterThan(OLD_PANEL.w * OLD_PANEL.h * 2.5);
  // 居中：1280x720 设计画布上左右对称。
  expect(p.x).toBe((1280 - p.w) / 2);
  expect(p.y).toBe((720 - p.h) / 2);
  await page.screenshot({ path: 'e2e/screenshots/ag60-bag-open.png' });

  // I 关上：整组对象（含格子/图标/边框）一起隐藏，不留孤儿吃点击。
  await page.keyboard.press('I');
  await page.waitForTimeout(300);
  const reclosed = await probeBag(page);
  expect(reclosed.panel).toBeNull();
  expect(reclosed.cells).toEqual([]);

  // 再开：面板原样回来（刷新路径没被关断）。
  await page.keyboard.press('I');
  await page.waitForTimeout(400);
  const reopened = await probeBag(page);
  expect(reopened.panel).not.toBeNull();
  expect(reopened.panel!.w).toBe(NEW_PANEL.w);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the grid is 14 cells of 76px in 5 columns, icons at 3x, last row ragged', async ({ page }) => {
  test.setTimeout(120_000);
  await startGame(page, 42);
  await page.keyboard.press('I');
  await page.waitForTimeout(500);
  const { cells, icons } = await probeBag(page);

  expect(cells.length).toBe(14);
  for (const c of cells) {
    expect(c.w).toBe(76);
    expect(c.h).toBe(76);
  }
  // 5 列：前 10 格占 5 个不同 x，末行 4 格（14 = 5+5+4）。
  const colXs = [...new Set(cells.map((c) => c.x))].sort((a, b) => a - b);
  expect(colXs.length).toBe(5);
  const rowYs = [...new Set(cells.map((c) => c.y))].sort((a, b) => a - b);
  expect(rowYs.length).toBe(3);
  const lastRow = cells.filter((c) => c.y === rowYs[2]);
  expect(lastRow.length).toBe(4);
  // 行距 = 格距 = 76 + 8。
  expect(rowYs[1] - rowYs[0]).toBe(84);
  expect(colXs[1] - colXs[0]).toBe(84);

  // 起始三件套各是一个 3x 图标；数量徽标在格内。
  const water = icons.find((i) => i.key === 'clean_water');
  expect(water).toBeDefined();
  expect(water!.scale).toBe(3);
  expect(water!.visible).toBe(true);
  expect(icons.filter((i) => i.key === 'ration_pack').length).toBe(1);
  expect(icons.filter((i) => i.key === 'flashlight').length).toBe(1);
});

test('the header reads the real capacity and the locked tail stays locked', async ({ page }) => {
  test.setTimeout(120_000);
  await startGame(page, 42);
  await page.keyboard.press('I');
  await page.waitForTimeout(500);
  const { texts, cells } = await probeBag(page);

  // 标题栏计数读 slotCount（12），不是网格尺寸的旧语义。
  expect(texts.some((t) => t === '3/12')).toBe(true);
  // 详情面板三行（e2e 既有语义一个不丢）。
  expect(texts.some((t) => t.includes('净水'))).toBe(true);
  expect(texts.some((t) => t.includes('持有 3'))).toBe(true);
  expect(texts.some((t) => t.includes('消耗品'))).toBe(true);
  expect(texts.some((t) => t.includes('水分 +30'))).toBe(true);
  expect(texts.some((t) => t.includes('空格子'))).toBe(false); // 选中的格有东西

  // 未解锁的两格（索引 12/13）在鼠标面前不存在：点它们不动选择，
  // 详情仍是当前选中格的净水。
  const canvas = await page.evaluate(() => {
    const r = document.querySelector('canvas')?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y } : { x: 0, y: 0 };
  });
  const clickCell = async (c: { x: number; y: number; w: number; h: number }): Promise<void> => {
    // 格子坐标是设计画布坐标；鼠标要的是页面坐标，画布 letterbox 居中在窗口里。
    await page.mouse.click(canvas.x + c.x + c.w / 2, canvas.y + c.y + c.h / 2);
  };
  const locked = cells[12];
  await clickCell(locked);
  await page.waitForTimeout(250);
  const afterLockedClick = await probeBag(page);
  expect(afterLockedClick.texts.some((t) => t.includes('净水'))).toBe(true);
  expect(afterLockedClick.texts.some((t) => t.includes('锁着的格子'))).toBe(false);
  await page.screenshot({ path: 'e2e/screenshots/ag60-bag-locked.png' });

  // 空格子（索引 3）点得动：详情切成空格子文案——解锁格照旧全功能。
  const empty = cells[3];
  await clickCell(empty);
  await page.waitForTimeout(250);
  const afterEmptyClick = await probeBag(page);
  expect(afterEmptyClick.texts.some((t) => t.includes('空格子'))).toBe(true);
});

test('keyboard selection and Enter-to-use still work on the bigger grid', async ({ page }) => {
  test.setTimeout(120_000);
  await startGame(page, 42);
  await page.keyboard.press('I');
  await page.waitForTimeout(500);

  // ↓ 从净水移到压缩口粮（槽位 1）。
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  let t = await probeBag(page);
  expect(t.texts.some((x) => x.includes('压缩口粮'))).toBe(true);
  expect(t.texts.some((x) => x.includes('饱食 +30'))).toBe(true);
  expect(t.marker).toBe(true); // 选区箭头仍在

  // Enter 用掉一口粮：饱食 +30 的闪回由 hudFeedback 系列 spec 管，这里只断言
  // 使用链路通（数量 2 → 1，详情刷新）。
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  t = await probeBag(page);
  expect(t.texts.some((x) => x.includes('持有 1'))).toBe(true);
});

test('the panel stays inside the canvas at 900x600 and 1920x1080', async ({ page }) => {
  test.setTimeout(180_000);
  for (const vp of [
    { width: 900, height: 600 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(vp);
    await startGame(page, 42);
    await page.keyboard.press('I');
    await page.waitForTimeout(500);
    // 画布在窗口里 letterbox 居中：按画布坐标量，面板必须整个在 1280x720 内。
    const box = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      const r = c?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
    });
    expect(box, `canvas at ${vp.width}x${vp.height}`).not.toBeNull();
    const { panel } = await probeBag(page);
    expect(panel, `bag open at ${vp.width}x${vp.height}`).not.toBeNull();
    // 设计画布坐标：880x360 居中 → 左右各 200px、上下各 180px 的净空。
    expect(panel!.w).toBe(NEW_PANEL.w);
    expect(panel!.h).toBe(NEW_PANEL.h);
    expect(panel!.x).toBeGreaterThanOrEqual(0);
    expect(panel!.y).toBeGreaterThanOrEqual(0);
    expect(panel!.x + panel!.w).toBeLessThanOrEqual(1280);
    expect(panel!.y + panel!.h).toBeLessThanOrEqual(720);
    if (vp.width === 1920) {
      await page.screenshot({ path: 'e2e/screenshots/ag60-bag-1920.png' });
    } else {
      await page.screenshot({ path: 'e2e/screenshots/ag60-bag-900.png' });
    }
  }
});
