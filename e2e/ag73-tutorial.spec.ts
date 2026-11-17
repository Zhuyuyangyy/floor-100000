import { expect, test, type Page } from '@playwright/test';

// AG-73（新手教程）实测探针（端口 5473，--workers=1）。TWOM 式六步：
//   ① 新开局出第一步提示（contextual 槽 + 跳过按钮 + 开局 flash）；
//   ② 真实移动推进第二步，走近储物柜出搜刮提示（呼吸框框住柜子）；
//   ③ 开柜推进圆环步（HUD 圆环高亮 3 秒），到点自动进制作步；
//   ④ 按 C 开制作面板推进爬梯步；
//   ⑤ 爬到 2 层推进床步，入夜收尾（「你已掌握基本生存」）；
//   ⑥ 跳过：按钮 / Esc 两条路，跳过态记 localStorage 且刷新不重现。
// 截图落 output/ag73/（gitignore 的本地证据目录），全程 pageerror 零。

const HINT_MOVE = '按 A/D 或 ←/→ 移动，熟悉这座塔';
const HINT_LOOT = '走近柜子，按 E 搜刮';
const HINT_STAIRS = '走到楼层左端的梯口，按 E 上楼';
const HINT_BED = '入夜后回自己的床，按 E 睡觉';
const DEFAULT_FOOT = 'A/D 或 ←/→ 移动 · E 交互';

interface TutorialView {
  step: number;
  skipped: boolean;
}

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === k),
    key,
    { timeout: 20_000 },
  );
}

async function startGame(page: Page, seed = 42): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const started = await page.waitForFunction(
      () => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'),
      undefined,
      { timeout: 2000 },
    ).then(() => true).catch(() => false);
    if (started) break;
  }
  await waitForScene(page, 'Game');
}

/** 场景里的教程状态（step = 已完成步数，6 = 全过）。 */
const tutorial = (page: Page): Promise<TutorialView> =>
  page.evaluate(() => {
    const s = (window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { tutorial?: TutorialView } | null)?.tutorial;
    return { step: s?.step ?? -1, skipped: s?.skipped ?? false };
  });

const hudText = (page: Page, name: string): Promise<string> =>
  page.evaluate((n) => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as {
      children: { list: Array<{ name?: string; text?: string; visible: boolean }> };
    } | null;
    const o = scene?.children.list.find((c) => c.name === n);
    return o && o.visible ? (o.text ?? '') : '';
  }, name);

const hudVisible = (page: Page, name: string): Promise<boolean> =>
  page.evaluate((n) => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as {
      children: { list: Array<{ name?: string; visible: boolean }> };
    } | null;
    return !!scene?.children.list.find((c) => c.name === n)?.visible;
  }, name);

const gfxVisible = (page: Page, field: 'tutorialWorldGfx' | 'tutorialHudGfx'): Promise<boolean> =>
  page.evaluate((f) => {
    const s = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as Record<string, { visible?: boolean } | undefined> | null;
    return !!s?.[f]?.visible;
  }, field);

/** 按住方向键走到目标 x（真实输入——教程的移动检测只认这个）。 */
async function walkTo(page: Page, key: 'ArrowLeft' | 'ArrowRight', target: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForFunction(
    (t) => {
      const x = window.__PHASER_SESSION__?.getState()?.player.x ?? -1;
      return key === 'ArrowRight' ? x >= t : x <= t;
    },
    target,
    { timeout: 20_000 },
  ).catch(() => undefined);
  await page.keyboard.up(key);
  await page.waitForTimeout(120);
}

const setMinute = (page: Page, minute: number): Promise<void> =>
  page.evaluate((m) => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.gameMinuteOfDay = m;
  }, minute);

test('a fresh run opens on tutorial step 1: contextual hint + skip button', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  // contextual 槽：教程第一步的短提示（接管默认脚注）。
  await expect.poll(async () => hudText(page, 'hud-nav-context'), { timeout: 5000 }).toBe(HINT_MOVE);
  // 开局 flash 也换成教程第一句（带着原来的目标）。
  await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 3000 }).toContain('100000 层');
  // 跳过按钮在右上角，看得见、点得着。
  expect(await hudText(page, 'hud-tutorial-skip')).toBe('跳过教程');
  expect(await hudVisible(page, 'hud-tutorial-skip')).toBe(true);
  // 移动步没有目标物件：不画世界呼吸框。
  expect(await gfxVisible(page, 'tutorialWorldGfx')).toBe(false);
  expect((await tutorial(page)).step).toBe(0);
  await page.screenshot({ path: 'output/ag73/01-step1-move.png' });
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('moving advances to the loot step, and the cabinet gets a breathing box', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  // 真实移动 200px 以上：推进第二步。
  await walkTo(page, 'ArrowRight', 900);
  expect((await tutorial(page)).step).toBe(1);
  // 空地上 contextual 让回默认脚注（世界无话可说时才轮到教程说话——
  // 但出现条件要求走近没开过的容器，所以此时是默认脚注）。
  expect(await hudText(page, 'hud-nav-context')).toBe(DEFAULT_FOOT);
  // 呼吸框已经盯上储物柜（世界坐标，160）。
  expect(await gfxVisible(page, 'tutorialWorldGfx')).toBe(true);
  // 走近柜子：教程的搜刮提示出现。
  await walkTo(page, 'ArrowLeft', 300);
  await expect.poll(async () => hudText(page, 'hud-nav-context'), { timeout: 5000 }).toBe(HINT_LOOT);
  await page.screenshot({ path: 'output/ag73/02-step2-loot-approach.png' });
  // 贴到交互距离内：世界链自己的键帽提示接棒（教程不覆写交互提示）。
  await walkTo(page, 'ArrowLeft', 170);
  await expect.poll(async () => hudText(page, 'hud-nav-context'), { timeout: 5000 }).toBe('打开 储物柜');
  await page.screenshot({ path: 'output/ag73/02b-step2-world-hint.png' });
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('opening the cabinet advances to the rings step, then to crafting on its own', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await walkTo(page, 'ArrowRight', 900);
  await walkTo(page, 'ArrowLeft', 165);
  await page.keyboard.press('E');
  // 2 秒搜刮动作后开柜落地：推进圆环步。
  await page.waitForFunction(
    () => (window.__PHASER_SESSION__?.getState()?.visitedFloors?.[1]?.openedContainers?.length ?? 0) > 0,
    undefined,
    { timeout: 10_000 },
  );
  await expect.poll(async () => tutorial(page), { timeout: 5000 }).toEqual({ step: 2, skipped: false });
  // HUD 圆环高亮（屏幕坐标框）这 3 秒在线。
  expect(await gfxVisible(page, 'tutorialHudGfx')).toBe(true);
  await page.screenshot({ path: 'output/ag73/03-step3-stats-rings.png' });
  // 无强制等待：3 秒后自动进下一步。
  await expect.poll(async () => tutorial(page), { timeout: 8000 }).toEqual({ step: 3, skipped: false });
  expect(await gfxVisible(page, 'tutorialHudGfx')).toBe(false);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the crafting panel advances to the stairs step, the climb to the bed step', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await walkTo(page, 'ArrowRight', 900);
  await walkTo(page, 'ArrowLeft', 165);
  await page.keyboard.press('E');
  await page.waitForFunction(
    () => (window.__PHASER_SESSION__?.getState()?.visitedFloors?.[1]?.openedContainers?.length ?? 0) > 0,
    undefined,
    { timeout: 10_000 },
  );
  await expect.poll(async () => tutorial(page), { timeout: 8000 }).toEqual({ step: 3, skipped: false });

  // 第 4 步：按 C 开制作面板。面板开着时 contextual 归面板链（面板自己的
  // 提示就是那一刻最该说的话），教程文本不抢。
  await page.keyboard.press('C');
  await page.waitForFunction(
    () => (window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { craftingOpen: boolean } | null)?.craftingOpen === true,
    undefined,
    { timeout: 5000 },
  );
  await expect.poll(async () => tutorial(page), { timeout: 5000 }).toEqual({ step: 4, skipped: false });
  await page.keyboard.press('C'); // 关面板
  await expect.poll(async () => hudText(page, 'hud-nav-context'), { timeout: 5000 }).toBe(HINT_STAIRS);
  await page.screenshot({ path: 'output/ag73/04-step5-stairs.png' });

  // 第 5 步：走上梯口按 E，到 2 层即推进。
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.player.x = 40;
  });
  await page.waitForTimeout(150);
  await page.keyboard.press('E');
  await page.waitForFunction(
    () => window.__PHASER_SESSION__?.getState()?.currentFloor === 2,
    undefined,
    { timeout: 10_000 },
  );
  await expect.poll(async () => tutorial(page), { timeout: 5000 }).toEqual({ step: 5, skipped: false });
  // 床在 1 层：2 层空地上 contextual 出教程的床步提示。
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.player.x = 600;
  });
  await page.waitForTimeout(200);
  await expect.poll(async () => hudText(page, 'hud-nav-context'), { timeout: 5000 }).toBe(HINT_BED);
  await page.screenshot({ path: 'output/ag73/05-step6-bed.png' });
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('nightfall finishes all six steps and the tutorial never comes back', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await walkTo(page, 'ArrowRight', 900);
  await walkTo(page, 'ArrowLeft', 165);
  await page.keyboard.press('E');
  await page.waitForFunction(
    () => (window.__PHASER_SESSION__?.getState()?.visitedFloors?.[1]?.openedContainers?.length ?? 0) > 0,
    undefined,
    { timeout: 10_000 },
  );
  await page.keyboard.press('C');
  await page.waitForTimeout(300);
  await page.keyboard.press('C');
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.player.x = 40;
  });
  await page.waitForTimeout(150);
  await page.keyboard.press('E');
  await page.waitForFunction(
    () => window.__PHASER_SESSION__?.getState()?.currentFloor === 2,
    undefined,
    { timeout: 10_000 },
  );
  await expect.poll(async () => tutorial(page), { timeout: 5000 }).toEqual({ step: 5, skipped: false });

  // 入夜：收尾 flash + 教程永久完成。
  await setMinute(page, 20 * 60);
  await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 5000 }).toContain('你已掌握基本生存');
  await expect.poll(async () => tutorial(page), { timeout: 5000 }).toEqual({ step: 6, skipped: false });
  expect(await hudVisible(page, 'hud-tutorial-skip')).toBe(false);
  await page.screenshot({ path: 'output/ag73/06-done.png' });

  // 刷新、继续这一局：教程不再出现（localStorage 进度 = 6）。
  await page.reload();
  await waitForScene(page, 'Menu');
  await page.keyboard.press('ArrowDown'); // -> 继续游戏
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Game');
  await page.waitForTimeout(400);
  expect(await hudVisible(page, 'hud-tutorial-skip')).toBe(false);
  await expect.poll(async () => hudText(page, 'hud-nav-context'), { timeout: 5000 }).toBe(DEFAULT_FOOT);
  expect(await page.evaluate(() => localStorage.getItem('floor100000.tutorial.progress'))).toBe('6');
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the skip button skips for good: flag persists, refresh does not bring it back', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await expect.poll(async () => hudText(page, 'hud-nav-context'), { timeout: 5000 }).toBe(HINT_MOVE);

  // 点右上角「跳过教程」：按钮中心在设计坐标 (1210, 127)，canvas 按 FIT 缩放。
  const canvas = page.locator('canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + 1210 * (box.width / 1280), box.y + 127 * (box.height / 720));
  await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 5000 }).toContain('教程已跳过');
  await expect.poll(async () => hudText(page, 'hud-nav-context'), { timeout: 5000 }).toBe(DEFAULT_FOOT);
  expect(await hudVisible(page, 'hud-tutorial-skip')).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('floor100000.tutorial.skipped'))).toBe('1');
  expect(await page.evaluate(() => localStorage.getItem('floor100000.tutorial.progress'))).toBeNull();
  await page.screenshot({ path: 'output/ag73/07-skipped.png' });

  // 刷新重开：不重现。
  await startGame(page, 42);
  await page.waitForTimeout(400);
  await expect.poll(async () => hudText(page, 'hud-nav-context'), { timeout: 5000 }).toBe(DEFAULT_FOOT);
  expect(await hudVisible(page, 'hud-tutorial-skip')).toBe(false);
  expect((await tutorial(page)).skipped).toBe(true);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('Esc skips the tutorial instead of opening the pause menu', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await expect.poll(async () => hudText(page, 'hud-nav-context'), { timeout: 5000 }).toBe(HINT_MOVE);
  await page.keyboard.press('Escape');
  await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 5000 }).toContain('教程已跳过');
  // Esc 的第一含义是跳教程，不弹暂停（无面板占着 Esc 时）。
  expect(await page.evaluate(() => (window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { pauseOpen: boolean }).pauseOpen)).toBe(false);
  expect((await tutorial(page)).skipped).toBe(true);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
