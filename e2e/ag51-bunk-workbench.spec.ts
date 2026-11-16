import { expect, test, type Page } from '@playwright/test';

// AG-51 实测探针（端口 5451，--workers=1）：用户 2026-11-16 晚反馈的第二、三条。
//
//   反馈 2「我点击这个工作台它也没有反应」  -> 点工作台（1 层 CRAFT_X）开制作面板；
//   反馈 3「点击床人物翻箱倒柜，以后有工具把床砍了做资源」-> 点床搜刮（播 search
//   动画、翻出小东西、每天一次）；拿撬棍再点 -> 拆出木材+布料，床消失。
//
// 同时钉两件不许破的事：睡眠（夜里 E 照旧开「夜间安排」）与 guaranteed 水食
// （1 层储物柜的净水不受任何新入口影响——搜柜照旧，模板没动）。
//
// 截图落 output/ag51/（gitignore 的本地证据目录），全程 pageerror 清零。

const CRAFT_X = 480; // 1 层工作台（furn_workbench，场景纯家具）
const BED_X = 1120; // 1 层自己的床
const DORM_BED = 236; // 1 层前排第一张室友床（dorm_bed_236）

interface State {
  day: number;
  gameMinuteOfDay: number;
  currentFloor: number;
  player: { x: number; inventory: { slots: Array<{ itemId: string; quantity: number }> } };
  visitedFloors: Record<string, { openedContainers: string[]; lootedItems: string[] }>;
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
  }) as Promise<State>;
}

async function setX(page: Page, x: number): Promise<void> {
  await page.evaluate((v) => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { x: number } } | null } }).__PHASER_SESSION__?.getState();
    if (s) s.player.x = v;
  }, x);
  // 等一帧让场景的世界对象跟上（syncPlayerWorldObjects 在 update 里跑）。
  await page.waitForTimeout(120);
}

/** HUD 上具名 Text 的当前文本（hud-hint / hud-feedback）。 */
async function hudText(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const g = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; name?: string; text?: string }> } } | null } };
    }).__PHASER_GAME__;
    const o = g?.scene.getScene('Game')?.children.list.find((x) => x.name === n);
    return o?.text ?? '';
  }, name);
}

/** 设计画布坐标（1280x720）-> 页面坐标。 */
async function toPage(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('no canvas');
  const scale = canvas.width / 1280;
  return { x: canvas.x + x * scale, y: canvas.y + y * scale };
}

/** 世界坐标 -> 页面坐标（相机 zoom 恒 1，scrollX 是相机左上角的世界 x）。 */
async function worldToPage(page: Page, worldX: number, worldY: number): Promise<{ x: number; y: number }> {
  const scrollX = await page.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { cameras?: { main?: { scrollX: number } } } | null } } }).__PHASER_GAME__;
    return g?.scene.getScene('Game')?.cameras?.main?.scrollX ?? 0;
  });
  return toPage(page, worldX - scrollX, worldY);
}

/** 点世界里的一个 x（床/工作台的地面位置）。 */
async function clickWorld(page: Page, worldX: number, worldY = 640): Promise<void> {
  const p = await worldToPage(page, worldX, worldY);
  await page.mouse.click(p.x, p.y);
}

/** 记录场景播过的一次性动作 clip（playActionAnim 的调用）。 */
async function recordActionAnims(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => unknown } } }).__PHASER_GAME__;
    const scene = g?.scene.getScene('Game') as unknown as {
      playActionAnim: (key: string, ms: number) => void;
    } | undefined;
    if (!scene) throw new Error('no Game scene');
    const bag: string[] = [];
    (window as unknown as { __AG51_ANIMS__: string[] }).__AG51_ANIMS__ = bag;
    const original = scene.playActionAnim.bind(scene);
    scene.playActionAnim = (key: string, ms: number): void => {
      bag.push(key);
      original(key, ms);
    };
  });
}

async function actionAnims(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __AG51_ANIMS__?: string[] }).__AG51_ANIMS__ ?? []);
}

/** 往包里塞一件东西（走产品自己的 InventorySystem，不走后门）。 */
async function giveItem(page: Page, itemId: string): Promise<void> {
  await page.evaluate(async (id) => {
    // 变量中转：import() 的字面量路径 tsc 会去解析（绝对路径解析不了），
    // 赋给变量后它是运行时动态导入——dev server 上就是这一个模块。
    const modPath = '/src/systems/InventorySystem.ts';
    const mod = (await import(modPath)) as { addItem: (inv: unknown, itemId: string, n: number) => unknown };
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { inventory: unknown } } | null } }).__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    mod.addItem(s.player.inventory, id, 1);
  }, itemId);
}

/** 场景私有字段的只读快照（bunkObjs / craftingOpen）。 */
async function sceneFlags(page: Page): Promise<{ bunkCount: number; craftingOpen: boolean; inventoryOpen: boolean }> {
  return page.evaluate(() => {
    const g = (window as unknown as {
      __PHASER_GAME__?: {
        scene: {
          getScene: (k: string) => {
            bunkObjs?: Map<string, unknown>;
            craftingOpen?: boolean;
            inventoryOpen?: boolean;
          } | null;
        };
      };
    }).__PHASER_GAME__;
    const scene = g?.scene.getScene('Game');
    return {
      bunkCount: scene?.bunkObjs?.size ?? -1,
      craftingOpen: scene?.craftingOpen ?? false,
      inventoryOpen: scene?.inventoryOpen ?? false,
    };
  });
}

test('AG-51: clicking the workbench opens the crafting panel', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await recordActionAnims(page);

  // ── 1. 键 E 路径：站在工作台旁按 E ────────────────────────────────────
  await setX(page, CRAFT_X);
  await expect.poll(async () => hudText(page, 'hud-hint'), { timeout: 5000 }).toBe('按 E 制作');
  await page.keyboard.press('E');
  await expect.poll(async () => hasVisibleText(page, '工作台 · 制作'), { timeout: 5000 }).toBe(true);
  await expect.poll(async () => hasVisibleText(page, '照明灯'), { timeout: 5000 }).toBe(true);
  await page.screenshot({ path: 'output/ag51/01-workbench-E.png' });

  // ── 2. 鼠标路径：关掉面板，走开，再「点」工作台 ───────────────────────
  //    用户原话是「我点击这个工作台它也没有反应」——这一拍才是反馈本体。
  await page.keyboard.press('C'); // 关面板
  await expect.poll(async () => (await sceneFlags(page)).craftingOpen, { timeout: 5000 }).toBe(false);
  await setX(page, 40); // 走开到楼层左端
  await clickWorld(page, CRAFT_X, 640); // 点工作台
  await expect.poll(async () => hasVisibleText(page, '工作台 · 制作'), { timeout: 10_000 }).toBe(true);
  await page.screenshot({ path: 'output/ag51/02-workbench-click.png' });

  // ── 3. 面板外点击 = ESC，关得掉 ───────────────────────────────────────
  const outside = await toPage(page, 40, 700);
  await page.mouse.click(outside.x, outside.y);
  await expect.poll(async () => (await sceneFlags(page)).craftingOpen, { timeout: 5000 }).toBe(false);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('AG-51: clicking a bunk searches it, then a crowbar dismantles it', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await recordActionAnims(page);

  // 14 张可交互床（自己的床 + 8 前排 + 5 后排室友床）都注册进了场景。
  expect((await sceneFlags(page)).bunkCount).toBe(14);

  // ── 1. 点室友床 -> 走位 -> 搜刮态（search 动画 + 翻出东西） ───────────
  await setX(page, 40);
  await clickWorld(page, DORM_BED, 640);
  await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 15_000 }).toMatch(/翻到 .+|床垫下面只有灰/);
  // search clip：walkcycle 的 search-{who}，用户要的「翻箱倒柜的状态」。
  await expect.poll(async () => (await actionAnims(page)).some((k) => k.startsWith('search-')), { timeout: 2000 }).toBe(true);
  const searchFlash = await hudText(page, 'hud-feedback');
  await page.screenshot({ path: 'output/ag51/03-bunk-search.png' });

  // 床垫下表是材料（布料/废金属/木材/胶带）——水食是 survivalBalance 的
  // 硬边界，床边翻出来的东西不许碰。
  expect(searchFlash, '床铺搜刮只出材料').not.toMatch(/净水|脏水|口粮|面包|医疗包/);
  // 翻过写进 visitedFloors（存档持久，重进楼层不算没翻）。
  const searched = await readState(page);
  expect(searched.visitedFloors['1']?.lootedItems.some((k) => k.startsWith('bunksearch:1:dorm_bed_236'))).toBe(true);

  // ── 2. 再点同一张床 -> 今天翻过了，不二次出货 ────────────────────────
  await setX(page, 40);
  await clickWorld(page, DORM_BED, 640);
  await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 15_000 }).toBe('这张床今天已经翻过了，明天再来');
  await page.screenshot({ path: 'output/ag51/04-bunk-exhausted.png' });

  // ── 3. 拿撬棍，再点 -> 拆解：木材+布料，床消失 ───────────────────────
  await giveItem(page, 'crowbar');
  const woodBefore = await countInBag(page, 'wood');
  const clothBefore = await countInBag(page, 'cloth');
  await setX(page, 40);
  await clickWorld(page, DORM_BED, 640);
  await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 15_000 }).toMatch(/拆了床，得到 木材×\d+、布料×\d+/);
  await page.screenshot({ path: 'output/ag51/05-bunk-dismantled.png' });

  const after = await readState(page);
  expect(countInBagSync(after, 'wood') - woodBefore).toBeGreaterThanOrEqual(2);
  expect(countInBagSync(after, 'cloth') - clothBefore).toBeGreaterThanOrEqual(1);
  expect(after.visitedFloors['1']?.lootedItems.some((k) => k === 'bunkgone:1:dorm_bed_236')).toBe(true);
  // 床从场景里注销：14 -> 13。
  await expect.poll(async () => (await sceneFlags(page)).bunkCount, { timeout: 5000 }).toBe(13);
  // 再点原址：236 拆掉后，站上去 E 命中的是 32px 外的后排邻居床
  // （dorm_bed_268，真实几何：两排床只隔半排）——拆掉的那张再也摸不到，
  // 而邻居是另一张床、照旧能翻。这条同时钉住「同一张床不能拆两次」。
  await setX(page, 40);
  await clickWorld(page, DORM_BED, 640);
  await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 15_000 }).toMatch(/翻到 .+|床垫下面只有灰|今天已经翻过/);
  const afterClick = await readState(page);
  expect(afterClick.visitedFloors['1']?.lootedItems.some((k) => k.startsWith('bunksearch:1:dorm_bed_268'))).toBe(true);
  // 全场 flash 里再没出现过第二次「拆了床」——一张床只拆得一次。
  expect(await hudText(page, 'hud-feedback')).not.toMatch(/拆了床/);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('AG-51: the own bed still sleeps — the search does not eat the night', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await recordActionAnims(page);

  // ── 1. 白天点自己的床 -> 翻床垫（新行为） ─────────────────────────────
  await setX(page, BED_X);
  await expect.poll(async () => hudText(page, 'hud-hint'), { timeout: 5000 }).toBe('按 E 翻翻自己的床');
  await setX(page, 40);
  await clickWorld(page, BED_X, 640);
  await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 15_000 }).toMatch(/翻到 .+|床垫下面只有灰/);
  await page.screenshot({ path: 'output/ag51/06-own-bed-search.png' });

  // ── 2. 夜里 E 自己的床 -> 照旧是「夜间安排」（睡眠没被破坏） ──────────
  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { gameMinuteOfDay: number } | null } }).__PHASER_SESSION__?.getState();
    if (s) s.gameMinuteOfDay = 1200; // 20:00
  });
  await setX(page, BED_X);
  await expect.poll(async () => hudText(page, 'hud-hint'), { timeout: 5000 }).toBe('按 E 安排夜间行动');
  await page.keyboard.press('E');
  await expect.poll(async () => hasVisibleText(page, '夜间安排 · 宿舍'), { timeout: 5000 }).toBe(true);
  await page.screenshot({ path: 'output/ag51/07-own-bed-sleep.png' });
  await page.keyboard.press('Escape');

  // ── 3. 1 层储物柜照旧搜刮：guaranteed 净水没被任何新入口碰过 ─────────
  await setX(page, 160); // cabinet
  await page.keyboard.press('E');
  await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 5000 }).toMatch(/获得 净水×1|是空的/);
  await page.screenshot({ path: 'output/ag51/08-cabinet-still-loots.png' });

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

async function hasVisibleText(page: Page, substr: string): Promise<boolean> {
  return page.evaluate((sub) => {
    const g = (window as unknown as {
      __PHASER_GAME__?: { scene: { scenes: Array<{ children: { list: Array<{ type: string; text?: string; visible: boolean }> } }> } };
    }).__PHASER_GAME__;
    for (const sc of g?.scene.scenes ?? []) {
      for (const o of sc.children.list ?? []) {
        if (o.type === 'Text' && (o.text ?? '').includes(sub) && o.visible) return true;
      }
    }
    return false;
  }, substr);
}

async function countInBag(page: Page, itemId: string): Promise<number> {
  const s = await readState(page);
  return countInBagSync(s, itemId);
}

function countInBagSync(s: State, itemId: string): number {
  return s.player.inventory.slots.filter((x) => x.itemId === itemId).reduce((n, x) => n + x.quantity, 0);
}
