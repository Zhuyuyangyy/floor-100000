import { expect, test, type Page } from '@playwright/test';

// AG-61（二叉树合成面板）实测探针。端口 5461 专用 config，--workers=1。
//
// 四条主线（总控硬性要求）：
//   1. 开面板见树——C 键打开后面板里是一棵树（材料列 + 设施/武器列 + 凭证链），
//      不是滚动列表；
//   2. 悬停见详情——鼠标悬停节点，详情块给出效果/状态/材料/去哪拿；
//   3. 点击选中可做——材料齐了的节点悬停即显示「可制作」；
//   4. 制作成功扣料——点击（或 Enter）后物品进背包、材料扣除。
// 另加视图变换的冒烟：拖拽平移与滚轮缩放真的移动/缩放了节点。

interface State {
  status: string;
  currentFloor: number;
  gameMinuteOfDay: number;
  player: { x: number; homeUpgrades: string[]; inventory: { slots: Array<{ itemId: string; quantity: number }> } };
}

interface TextBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
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
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const started = await page.waitForFunction(
      () => {
        const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
        return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
      },
      undefined,
      { timeout: 2000 },
    ).then(() => true).catch(() => false);
    if (started) break;
  }
  await waitForScene(page, 'Game');
}

async function readState(page: Page): Promise<State> {
  return page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    return s;
  });
}

async function count(page: Page, itemId: string): Promise<number> {
  const s = await readState(page);
  return s.player.inventory.slots.filter((x) => x.itemId === itemId).reduce((n, x) => n + x.quantity, 0);
}

/** 画布上可见的 Text（Game 场景，设计画布坐标）。 */
async function sceneTexts(page: Page): Promise<TextBox[]> {
  return page.evaluate(() => {
    const g = (window as unknown as {
      __PHASER_GAME__?: {
        scene: {
          getScene: (k: string) => {
            children: { list: Array<{ type: string; text?: string; visible: boolean; x: number; y: number; getBounds?: () => { width: number; height: number }; scaleX?: number }> };
          } | null;
        };
      };
    }).__PHASER_GAME__;
    const out: TextBox[] = [];
    for (const o of g?.scene.getScene('Game')?.children.list ?? []) {
      if (o.type !== 'Text' || !o.visible || !(o.text ?? '').trim()) continue;
      const b = typeof o.getBounds === 'function' ? o.getBounds() : { width: 0, height: 0 };
      out.push({ text: o.text ?? '', x: o.x, y: o.y, width: b.width, height: b.height, scaleX: o.scaleX ?? 1 });
    }
    return out;
  });
}

async function textByContent(page: Page, content: string): Promise<TextBox | undefined> {
  const texts = await sceneTexts(page);
  return texts.find((t) => t.text === content);
}

// design-canvas point → page point（Scale.FIT inside the viewport）。
async function toPage(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('no canvas');
  const scale = canvas.width / 1280;
  return { x: canvas.x + x * scale, y: canvas.y + y * scale };
}

async function openCraftPanel(page: Page): Promise<void> {
  await page.keyboard.press('C');
  await expect
    .poll(async () => (await sceneTexts(page)).some((t) => t.text.includes('工作台 · 制作')), { timeout: 5000 })
    .toBe(true);
  await page.waitForTimeout(200);
}

test.describe('AG-61 二叉树合成面板', () => {
  test('开面板见树：材料列 + 设施/武器列 + 凭证链，边与节点都在', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await startGame(page, 42);
    await openCraftPanel(page);
    await page.waitForTimeout(250);

    // 树的骨架：三列代表节点 + 链上节点都在画布上。
    for (const name of ['木材', '废金属', '撬棍', '照明灯', '加固门', '简易净水器', '匕首', '消防斧', '工牌', '通行贴', '核心权限']) {
      expect(await textByContent(page, name), `节点 ${name} 不在树上`).toBeTruthy();
    }
    // 视图提示在位；默认选中第一条（照明灯，与旧列表同）——新开局材料不足，
    // 详情块给出效果/状态/材料/去哪拿四行。
    expect(await textByContent(page, '拖拽平移 · 滚轮缩放')).toBeTruthy();
    const texts = await sceneTexts(page);
    expect(texts.some((t) => t.text.startsWith('效果：')), '默认详情缺效果行').toBe(true);
    expect(texts.some((t) => t.text.includes('状态：材料不足')), '默认详情缺状态行').toBe(true);

    await page.screenshot({ path: 'output/ag61/craft-tree-open.png' });
    await testInfo.attach('tree-open-texts', { body: JSON.stringify(texts, null, 2), contentType: 'application/json' });

    // 旧列表的滚动窗口没有了：所有配方同时可见（不是 10 行的窗口）。
    const recipeNames = ['照明灯', '加固门', '简易净水器', '置物架', '匕首', '短剑', '砍刀', '消防斧', '工牌', '通行贴', '许可证', '贵宾卡', '核心权限'];
    for (const name of recipeNames) {
      expect(await textByContent(page, name), `配方 ${name} 应当同时在树上`).toBeTruthy();
    }
    await page.keyboard.press('C');
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('悬停见详情：效果 / 状态 / 材料 / 去哪拿 四行等价旧列表', async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await startGame(page, 42);
    await openCraftPanel(page);

    // 悬停「照明灯」（新开局材料不足）：详情块给出效果、状态、逐项库存、去哪拿。
    const lamp = await textByContent(page, '照明灯');
    expect(lamp, '照明灯节点不在').toBeTruthy();
    const lampPoint = await toPage(page, lamp!.x + lamp!.width / 2, lamp!.y);
    await page.mouse.move(lampPoint.x, lampPoint.y);
    await page.waitForTimeout(250);

    let texts = await sceneTexts(page);
    expect(texts.some((t) => t.text.startsWith('效果：')), '效果预览行缺失').toBe(true);
    expect(texts.some((t) => t.text.startsWith('状态：材料不足')), '状态行缺失').toBe(true);
    expect(texts.some((t) => t.text.startsWith('材料：')), '材料库存行缺失').toBe(true);
    expect(texts.some((t) => t.text.startsWith('去哪拿：')), '去哪拿行缺失').toBe(true);
    // 材料行逐项列出持有/需求：灯要 电池1/电线1/废金属1，新开局全 0。
    const materials = texts.find((t) => t.text.startsWith('材料：'))?.text ?? '';
    expect(materials).toContain('电池 0/1');
    expect(materials).toContain('电线 0/1');
    expect(materials).toContain('废金属 0/1');
    await page.screenshot({ path: 'output/ag61/craft-hover-lamp.png' });

    // 悬停「通行贴」：缺前置态（凭证链的门禁在树形态里可读）。
    const sticker = await textByContent(page, '通行贴');
    const stickerPoint = await toPage(page, sticker!.x + sticker!.width / 2, sticker!.y);
    await page.mouse.move(stickerPoint.x, stickerPoint.y);
    await page.waitForTimeout(250);
    texts = await sceneTexts(page);
    expect(texts.some((t) => t.text.includes('状态：缺前置')), '缺前置态缺失').toBe(true);
    expect(texts.some((t) => t.text.includes('前置：工牌')), '前置读数缺失').toBe(true);
    expect(texts.some((t) => t.text.includes('档位 3')), '档位读数缺失').toBe(true);

    // 悬停材料「废金属」：出处 + 用处（边的反查）。
    const scrap = await textByContent(page, '废金属');
    const scrapPoint = await toPage(page, scrap!.x + scrap!.width / 2, scrap!.y);
    await page.mouse.move(scrapPoint.x, scrapPoint.y);
    await page.waitForTimeout(250);
    texts = await sceneTexts(page);
    expect(texts.some((t) => t.text.startsWith('出处：')), '材料出处缺失').toBe(true);
    const usage = texts.find((t) => t.text.includes('用来合成：'))?.text ?? '';
    for (const name of ['照明灯', '简易净水器', '匕首', '工牌']) expect(usage, `用处行缺 ${name}`).toContain(name);
    await page.screenshot({ path: 'output/ag61/craft-hover-material.png' });

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('点击选中可做并制作成功：扣料、进背包、状态翻可制作', async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await startGame(page, 42);
    // 给齐匕首的材料（废金属1 + 布料1）。
    await page.evaluate(() => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      s?.player.inventory.slots.push({ itemId: 'scrap_metal', quantity: 1 }, { itemId: 'cloth', quantity: 1 });
    });
    await openCraftPanel(page);

    // 悬停「匕首」：状态行应读「可制作」（点击前就能看到）。
    const dagger = await textByContent(page, '匕首');
    expect(dagger, '匕首节点不在').toBeTruthy();
    const daggerPoint = await toPage(page, dagger!.x + dagger!.width / 2, dagger!.y);
    await page.mouse.move(daggerPoint.x, daggerPoint.y);
    await page.waitForTimeout(250);
    let texts = await sceneTexts(page);
    expect(texts.some((t) => t.text.includes('状态：可制作')), '材料齐了应显示可制作').toBe(true);
    const materials = texts.find((t) => t.text.startsWith('材料：'))?.text ?? '';
    expect(materials).toContain('废金属 1/1');
    expect(materials).toContain('布料 1/1');
    await page.screenshot({ path: 'output/ag61/craft-dagger-ready.png' });

    // 点击节点（pointerup 裁决，非拖拽）→ 制作。
    await page.mouse.click(daggerPoint.x, daggerPoint.y);
    await page.waitForFunction(
      () => {
        const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
        return !!s && s.player.inventory.slots.some((x) => x.itemId === 'dagger' && x.quantity >= 1);
      },
      undefined,
      { timeout: 5000 },
    );
    // 扣料：两样材料清零（匕首是唯一消耗它们的配方）。
    expect(await count(page, 'scrap_metal')).toBe(0);
    expect(await count(page, 'cloth')).toBe(0);
    expect(await count(page, 'dagger')).toBe(1);

    // 制作后详情刷新：状态回到「材料不足」——树与库存实时同步。
    texts = await sceneTexts(page);
    expect(texts.some((t) => t.text.includes('状态：材料不足')), '制作后状态应回落').toBe(true);
    await page.screenshot({ path: 'output/ag61/craft-dagger-done.png' });
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('Enter 制作旧路径仍在：键盘导航到加固门并建造', async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await startGame(page, 42);
    await page.evaluate(() => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      s?.player.inventory.slots.push({ itemId: 'wood', quantity: 2 }, { itemId: 'tape', quantity: 1 });
    });
    await openCraftPanel(page);
    // 导航序与旧列表一致：照明灯 0、加固门 1（bagFullWarning/ag44 的钉子）。
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    const texts = await sceneTexts(page);
    expect(texts.some((t) => t.text.includes('状态：可制作')), '选中加固门应可制作').toBe(true);
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => {
        const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
        return !!s && s.player.homeUpgrades.includes('reinforced_door');
      },
      undefined,
      { timeout: 5000 },
    );
    expect(await count(page, 'wood')).toBe(0);
    expect(await count(page, 'tape')).toBe(0);
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('视图变换：拖拽平移与滚轮缩放移动/缩放节点', async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await startGame(page, 42);
    await openCraftPanel(page);

    const before = await textByContent(page, '核心权限');
    expect(before, '核心权限节点不在').toBeTruthy();

    // 滚轮缩放：在节点上滚三格（每格 +12%），节点文本的 scale 跟着涨。
    const zoomAt = await toPage(page, before!.x + before!.width / 2, before!.y);
    await page.mouse.move(zoomAt.x, zoomAt.y);
    for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -120);
    await page.waitForTimeout(250);
    const zoomed = await textByContent(page, '核心权限');
    expect(zoomed, '缩放后核心权限不见了').toBeTruthy();
    expect(zoomed!.scaleX, '滚轮没有缩放节点').toBeGreaterThan(before!.scaleX + 0.3);

    // 拖拽平移：放大后树比可视区大，从面板空白处（凭证链下方的空隙）按住
    // 拖动，节点整体位移。向右拖——缩放锚点在右侧节点上，缩放后 pan 已贴
    // 左边界，向左拖会被 clamp 吃掉大半（只剩 ~30px），向右有 ~140px 行程。
    const start = await toPage(page, 600, 300);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 200, start.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const dragged = await textByContent(page, '核心权限');
    expect(dragged, '拖拽后核心权限不见了').toBeTruthy();
    expect(Math.abs(dragged!.x - zoomed!.x), '拖拽没有平移节点').toBeGreaterThan(50);
    await page.screenshot({ path: 'output/ag61/craft-tree-pan-zoom.png' });

    // 关掉重开：视图复位（每次打开都是全树）。
    await page.keyboard.press('C');
    await page.waitForTimeout(150);
    await openCraftPanel(page);
    const reset = await textByContent(page, '核心权限');
    expect(Math.abs(reset!.x - before!.x), '重开应复位视图').toBeLessThan(2);
    expect(reset!.scaleX, '重开应复位缩放').toBeCloseTo(1, 1);
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });
});
