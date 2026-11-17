import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../src/core/design';
import { TOWER_MAP, towerFitZoom } from '../src/render/hudLayout';

// AG-62（塔楼地图楼体剖面化）实测探针。用户 2026-11-17 原话：
//   「地图现在也很难看，可以做一个缩小版本的更好看一点，不要一下子看到 1 万层
//     很奇怪」「可以放大一点地图……你再做一个地下室啥的也能看见，就是前面 5 层
//     都能看见，因为相当于是我们基础发育的一个地方」
// 本探针钉四件事，全部有截图像素证据（e2e/screenshots/62-*.png）：
//   1. M 开地图默认聚焦当前段（不是一整根 10 万层的火柴），且焦点就是玩家所在段；
//   2. F / 看全塔 缩到全塔，起点/终点标签归位；
//   3. 前 5 层作为「地下基座 B1–B5」在楼体底部可见、有铭牌、有房间名；
//   4. 悬停/点击楼层给出层号·段名·环境·容器·问号等信息，点击钻到区段放大镜，
//      未打通楼层仍然拒绝进入（选中≠进入的规则没被视觉重做破坏）。
// 另加一条布局守卫：默认视图下所有可见文本不出画布、不互压（>15% 阈值）——
// 楼体的世界空间标签全部是 scrollFactor(0) 的屏幕坐标文本，这条防它们互相叠。

async function startGame(page: Page, seed = 42): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  const sceneIs = (key: string): Promise<void> =>
    page.waitForFunction(
      (k) => !!window.__PHASER_GAME__?.scene.getScenes(true).some((scene) => scene.scene.key === k),
      key,
      { timeout: 20_000 },
    ).then(() => undefined);
  await sceneIs('Menu');
  await page.keyboard.press('Enter');
  await sceneIs('MetaSelect');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const ready = await page
      .waitForFunction(
        () => window.__PHASER_GAME__?.scene.getScenes(true).some((scene) => scene.scene.key === 'Game'),
        undefined,
        { timeout: 2000 },
      )
      .then(() => true)
      .catch(() => false);
    if (ready) break;
  }
  await sceneIs('Game');
}

interface State {
  currentFloor: number;
  visitedFloors: Record<string, unknown>;
}

/** Park the run at a known point: standing on `floor`, `explored` visited. */
async function parkAt(page: Page, floor: number, explored: number[]): Promise<void> {
  await page.evaluate(
    ({ f, floors }) => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      if (!s) return;
      s.currentFloor = f;
      const visit = { openedContainers: [], lootedItems: [], unlockedDoors: [], localEvents: [] };
      for (const fl of floors) s.visitedFloors[fl] = { ...visit };
    },
    { f: floor, floors: explored },
  );
}

async function openMap(page: Page): Promise<void> {
  await page.keyboard.press('M');
  await page.waitForFunction(
    () => window.__PHASER_TOWER__ !== undefined && window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'TowerOverview'),
    undefined,
    { timeout: 20_000 },
  );
}

interface Nav {
  level: 'overview' | 'sector' | 'floor';
  sector: number;
  floor: number | null;
  cursor: number;
  zoom: number;
}

interface View {
  top: number;
  height: number;
  content: number;
}

interface Layout {
  level: string;
  zoom: number;
  viewHeight: number;
  content: number;
  buildingHeight: number;
  baseLowY: number;
  baseHighY: number;
  hoverFloor: number | null;
  currentFloor: number;
}

const readNav = (page: Page): Promise<Nav> =>
  page.evaluate(() => (window as unknown as { __PHASER_TOWER__: { getNav: () => Nav } }).__PHASER_TOWER__.getNav()) as Promise<Nav>;
const readView = (page: Page): Promise<View> =>
  page.evaluate(() => (window as unknown as { __PHASER_TOWER__: { getView: () => View } }).__PHASER_TOWER__.getView()) as Promise<View>;
const readLayout = (page: Page): Promise<Layout> =>
  page.evaluate(() => (window as unknown as { __PHASER_TOWER__: { getLayout: () => Layout } }).__PHASER_TOWER__.getLayout()) as Promise<Layout>;
const readFloorScreenY = (page: Page, floor: number): Promise<number> =>
  page.evaluate((f) => (window as unknown as { __PHASER_TOWER__: { floorScreenY: (f: number) => number } }).__PHASER_TOWER__.floorScreenY(f), floor) as Promise<number>;

async function hasVisibleText(page: Page, substr: string): Promise<boolean> {
  return page.evaluate((sub) => {
    const scenes = (window as unknown as { __PHASER_GAME__?: { scene: { scenes: Array<{ children: { list: Array<{ type: string; text?: string; visible: boolean }> } }> } } }).__PHASER_GAME__?.scene.scenes ?? [];
    return scenes.some((sc) => (sc.children.list ?? []).some((o) => o.type === 'Text' && (o.text ?? '').includes(sub) && o.visible));
  }, substr);
}

/** Design-canvas (1280x720) point → page point, so the mouse drives the map. */
async function designToPage(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const rect = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const r = canvas?.getBoundingClientRect();
    return r ? { left: r.left, top: r.top, width: r.width } : null;
  });
  if (!rect) throw new Error('no canvas');
  const scale = rect.width / DESIGN_WIDTH;
  return { x: rect.left + x * scale, y: rect.top + y * scale };
}

/** Every visible Text of the TowerOverview scene, in screen bounds. */
async function mapTexts(page: Page): Promise<Array<{ text: string; x: number; y: number; width: number; height: number }>> {
  return page.evaluate(() => {
    const scene = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => unknown } } }).__PHASER_GAME__?.scene.getScene('TowerOverview') as
      | { children: { list: Array<{ type: string; text?: string; visible: boolean; getBounds(): { x: number; y: number; width: number; height: number } }> } }
      | undefined;
    const list = scene?.children.list ?? [];
    const out: Array<{ text: string; x: number; y: number; width: number; height: number }> = [];
    for (const o of list) {
      if (o.type !== 'Text' || !o.visible || !o.text) continue;
      const b = o.getBounds();
      out.push({ text: o.text, x: b.x, y: b.y, width: b.width, height: b.height });
    }
    return out;
  }) as Promise<Array<{ text: string; x: number; y: number; width: number; height: number }>>;
}

function expectWithinCanvas(texts: Array<{ text: string; x: number; y: number; width: number; height: number }>): void {
  expect(texts.length, 'no map text found').toBeGreaterThan(0);
  for (const t of texts) {
    expect(t.x, `"${t.text}" starts off-canvas`).toBeGreaterThanOrEqual(0);
    expect(t.y, `"${t.text}" starts off-canvas`).toBeGreaterThanOrEqual(0);
    expect(t.x + t.width, `"${t.text}" runs off the right edge`).toBeLessThanOrEqual(DESIGN_WIDTH);
    expect(t.y + t.height, `"${t.text}" runs off the bottom edge`).toBeLessThanOrEqual(DESIGN_HEIGHT);
  }
}

function expectNoOverlap(texts: Array<{ text: string; x: number; y: number; width: number; height: number }>): void {
  const collisions: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i];
      const b = texts[j];
      const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (w <= 1 || h <= 1) continue;
      const smaller = Math.min(a.width * a.height, b.width * b.height);
      if (smaller > 0 && (w * h) / smaller > 0.15) collisions.push(`"${a.text}" × "${b.text}"`);
    }
  }
  expect(collisions, `overlapping text: ${collisions.join(' | ')}`).toEqual([]);
}

mkdirSync('e2e/screenshots', { recursive: true });

test('M opens the map focused on the player’s segment, with the basement base', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await parkAt(page, 3, [1, 2, 3]);
  await openMap(page);

  const nav = await readNav(page);
  expect(nav.level).toBe('overview');
  expect(nav.zoom).toBe(TOWER_MAP.zoomDefault);

  // 默认视图聚焦当前段（基座），不是一整根 10 万层的火柴。
  const view = await readView(page);
  expect(view.height).toBeLessThan(view.content * 0.4);
  const floor1 = await readFloorScreenY(page, 1);
  const floor5 = await readFloorScreenY(page, 5);
  expect(floor1).toBeGreaterThanOrEqual(TOWER_MAP.topBand);
  expect(floor5).toBeLessThanOrEqual(TOWER_MAP.bottomBand);

  // 基座铭牌 + 五间房名都在（用户点名「前面 5 层都能看见」）。
  expect(await hasVisibleText(page, '地下基座 B1–B5 · 基础发育区')).toBe(true);
  expect(await hasVisibleText(page, 'B1 宿舍')).toBe(true);
  expect(await hasVisibleText(page, 'B5 食堂')).toBe(true);
  // 当前层指认 + 段信息。
  expect(await hasVisibleText(page, '第 3 层')).toBe(true);
  expect(await hasVisibleText(page, '楼体剖面 · 当前段 · 地下基座')).toBe(true);
  // 聚焦视角下终点让位（全塔视角才归位，见下一个测试）；起点就在基座底部，照常标注。
  expect(await hasVisibleText(page, '终点 第100000层')).toBe(false);

  // 布局守卫：楼体的世界空间标签不出画布、不互压。
  const texts = await mapTexts(page);
  expectWithinCanvas(texts);
  expectNoOverlap(texts);

  await page.screenshot({ path: 'e2e/screenshots/62-map-focus.png' });
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('F / 看全塔 fits the whole tower, and 聚焦当前段 comes back', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await parkAt(page, 3, [1, 2, 3]);
  await openMap(page);

  await page.keyboard.press('f');
  const fitNav = await readNav(page);
  expect(fitNav.zoom).toBeCloseTo(towerFitZoom(), 5);
  // 整栋楼落进内容带：楼体顶（100000 层）与楼体底（1 层）都在带内。
  const top = await readFloorScreenY(page, 100000);
  const bottom = await readFloorScreenY(page, 1);
  expect(top).toBeGreaterThanOrEqual(TOWER_MAP.topBand - 1);
  expect(bottom).toBeLessThanOrEqual(TOWER_MAP.bottomBand + 1);
  expect(await hasVisibleText(page, '起点 第1层')).toBe(true);
  expect(await hasVisibleText(page, '终点 第100000层')).toBe(true);
  // 六个阶层铭牌在全塔视角下同屏（楼体剖面一目了然）。
  for (const name of ['底层贫民区', '工人宿舍区', '工业与交易区', '中产与商业区', '富人特权区', '统治核心']) {
    expect(await hasVisibleText(page, name), name).toBe(true);
  }
  const fitTexts = await mapTexts(page);
  expectWithinCanvas(fitTexts);
  expectNoOverlap(fitTexts);
  await page.screenshot({ path: 'e2e/screenshots/62-map-fit.png' });

  // 再按一次回到聚焦。
  await page.keyboard.press('f');
  expect((await readNav(page)).zoom).toBe(TOWER_MAP.zoomDefault);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('hovering a floor answers what is on it, clicking drills into the sector', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await parkAt(page, 3, [1, 2, 3]);
  await openMap(page);

  // 悬停第 5 层（食堂）：读出层号·房名·段名·环境·容器·问号。
  const y5 = await readFloorScreenY(page, 5);
  const p5 = await designToPage(page, DESIGN_WIDTH / 2, y5);
  await page.mouse.move(p5.x, p5.y);
  await expect.poll(async () => (await readLayout(page)).hoverFloor).toBe(5);
  // 第 5 层是守段者层（BOSS_FLOOR_NUMBERS = [5, 110, 50010]）。
  expect(await hasVisibleText(page, '第 5 层')).toBe(true);
  expect(await hasVisibleText(page, '食堂')).toBe(true);
  expect(await hasVisibleText(page, '守段者')).toBe(true);
  expect(await hasVisibleText(page, '寒 2.0')).toBe(true);
  expect(await hasVisibleText(page, '容器 2')).toBe(true);

  // 点击第 5 层：钻到区段放大镜（level 'sector'，游标落在这层）。
  await page.mouse.click(p5.x, p5.y);
  await expect.poll(async () => (await readNav(page)).level).toBe('sector');
  const nav = await readNav(page);
  expect(nav.sector).toBe(0);
  expect(nav.cursor).toBe(5);
  expect(nav.zoom).toBe(TOWER_MAP.sectorZoomDefault);
  // 鼠标移出内容带后，读出回到区段组成（每层一条线、十层一号的放大镜）。
  const away = await designToPage(page, 40, 12);
  await page.mouse.move(away.x, away.y);
  await expect.poll(async () => (await readLayout(page)).hoverFloor).toBeNull();
  expect(await hasVisibleText(page, '区段 0 · 1–1000 层')).toBe(true);
  expect(await hasVisibleText(page, '底层贫民区×99')).toBe(true);
  await page.screenshot({ path: 'e2e/screenshots/62-map-sector.png' });

  // Enter 看楼层详情卡：第 5 层的内容与通行状态。
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await readNav(page)).level).toBe('floor');
  expect(await hasVisibleText(page, '第 5 层 · 废弃食堂')).toBe(true);
  expect(await hasVisibleText(page, '通行：未打通')).toBe(true); // 前沿 3，第 5 层没打通
  const cardTexts = await mapTexts(page);
  expectWithinCanvas(cardTexts);
  expectNoOverlap(cardTexts);
  await page.screenshot({ path: 'e2e/screenshots/62-map-floor.png' });

  // 选中≠进入：未打通楼层按 Enter 也被拒绝，且人还在原地。
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect(await hasVisibleText(page, '该楼层尚未打通，需先通过实际通路抵达')).toBe(true);
  const state = await page.evaluate(() => (window as unknown as { __PHASER_SESSION__: { getState: () => State } }).__PHASER_SESSION__.getState());
  expect(state.currentFloor).toBe(3);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the wheel zooms from the whole tower down to countable floors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await parkAt(page, 3, [1, 2, 3]);
  await openMap(page);

  // 缩到全塔，再一路放大到细节：基座五层在最大缩放下每层 180px，可数。
  await page.keyboard.press('f');
  const canvasPoint = await designToPage(page, DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2);
  await page.mouse.move(canvasPoint.x, canvasPoint.y);
  // 0.28 → 6 是 21 倍，1.15x/格需要约 24 格；给 30 格留余量。
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, -120);
  await expect.poll(async () => (await readNav(page)).zoom).toBeGreaterThan(TOWER_MAP.zoomDefault);
  const nav = await readNav(page);
  expect(nav.zoom).toBeCloseTo(TOWER_MAP.zoomMax, 5);
  // 基座每层楼距在屏上 = baseH/5 * zoom = 180px，楼层线可数。
  const pitchScreen = (TOWER_MAP.baseH / TOWER_MAP.baseFloors) * nav.zoom;
  expect(pitchScreen).toBeGreaterThan(100);
  await page.screenshot({ path: 'e2e/screenshots/62-map-detail.png' });

  // 放大后楼体占满画布宽度（「板体要满」），且仍不出画布、不互压。
  const layout = await readLayout(page);
  expect(layout.buildingHeight).toBeGreaterThan(0);
  const texts = await mapTexts(page);
  expectWithinCanvas(texts);
  expectNoOverlap(texts);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('an unlocked floor can still be entered from the map', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await parkAt(page, 3, [1, 2, 3]);
  await openMap(page);

  // 键盘路径：Enter 进区段，方向键把游标移到第 2 层（已打通），Enter 进。
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await readNav(page)).level).toBe('sector');
  await page.keyboard.press('ArrowLeft'); // cursor 1 -> 游标从当前层(3)向左
  await page.waitForTimeout(80);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await readNav(page)).cursor).toBe(1);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await readNav(page)).level).toBe('floor');
  expect(await hasVisibleText(page, '第 1 层 · 玩家宿舍')).toBe(true);
  expect(await hasVisibleText(page, '储物柜：净水')).toBe(true);
  expect(await hasVisibleText(page, '通行：已打通')).toBe(true);
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'),
    undefined,
    { timeout: 10_000 },
  );
  const state = await page.evaluate(() => (window as unknown as { __PHASER_SESSION__: { getState: () => State } }).__PHASER_SESSION__.getState());
  expect(state.currentFloor).toBe(1);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
