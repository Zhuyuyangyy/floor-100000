import { expect, test, type Page } from '@playwright/test';

// AG-73（新手教程）实测探针（端口 5473，--workers=1）。TWOM 式六步：
//   ① 新开局出第一步提示（contextual 槽 + 跳过按钮 + 开局 flash）；
//   ② 真实移动推进第二步，走近储物柜出搜刮提示（呼吸框框住柜子）；
//   ③ 开柜推进圆环步（HUD 圆环高亮 3 秒），到点自动进制作步；
//   ④ 按 C 开制作面板推进爬梯步；
//   ⑤ 爬到 2 层推进床步，入夜收尾（「你已掌握基本生存」）；
//   ⑥ 跳过：按钮 / Esc 两条路，跳过态记 localStorage 且刷新不重现；
//   ⑦ RC-02 XP-3：床步白天收尾——爬下 1 层走到自己床边即完成（入夜路径
//      保留作兜底，见用例 ⑤）。
// 截图落 output/ag73/（gitignore 的本地证据目录），全程 pageerror 零。

const HINT_MOVE = '按 A/D 或 ←/→ 移动，熟悉这座塔';
const HINT_LOOT = '走近柜子，按 E 搜刮';
const HINT_STAIRS = '走到楼层左端的梯口，按 E 上楼';
const HINT_BED = '入夜后回自己的床，按 E 睡觉';

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
    // RC-02 修复：key 必须随参数进浏览器端——pageFunction 里引用闭包变量会
    // 直接 ReferenceError（已实证），而 .catch(() => undefined) 会把它吞成
    // 「秒退」，向右的行走自此全部失效（谓词恒走 x<=t 那条臂）。修前 ag73
    // 六个用例在这条路上自 AG-73 落盘起就没绿过（干净 tip df2925b 复跑
    // 6 失败/2 通过，与本分支无关）。
    ([t, k]) => {
      const x = window.__PHASER_SESSION__?.getState()?.player.x ?? -1;
      return k === 'ArrowRight' ? x >= t : x <= t;
    },
    [target, key] as [number, string],
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

/**
 * 关制作面板：按 C，等到面板真关上；没关上就补按（每枪之间隔着轮询，必有
 * 帧边界）。等真实状态，不假设按键即生效。
 *
 * 为什么不能裸按第二枪 C：Phaser 的键盘事件队列在每个 DOM 键事件上同步排空
 * （KeyboardManager 发 MANAGER_PROCESS → KeyboardPlugin.update 当场排空，
 * 不是等游戏步），而 GameScene 的 per-frame guard（GHI-03 m9）一帧只收一个
 * 同键指令（读 game.loop.frame）。两次 C 落在同一个游戏帧内（60fps = 16.7ms），
 * 第二枪就被 guard 丢弃，且队列的重复事件 bailout 保证它不会在后续帧重放——
 * 面板留在开态，紧跟其后的 E 全被面板吃掉（onInteract 的 craftingOpen 早退），
 * 「爬梯到 2 层」的等待整个超时。实测该序列约 1/4 概率踩中（探针 zz-probe4：
 * 30 次双按丢 7 次；Playwright 的 waitForFunction 首次求值是同步立即的，面板
 * 已开着时两次按下只隔几毫秒，正好落进一帧）。真人不可能 16ms 内按两次 C，
 * 这是测试特有的时序——补丁在 spec 侧：等到 craft 面板真关上再继续。
 */
async function closeCraftingPanel(page: Page): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const open = await page.evaluate(
      () => (window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { craftingOpen: boolean } | null)?.craftingOpen === true,
    );
    if (!open) return;
    await page.keyboard.press('C');
    const closed = await page
      .waitForFunction(
        () => (window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { craftingOpen: boolean } | null)?.craftingOpen === false,
        undefined,
        { timeout: 1000 },
      )
      .then(() => true)
      .catch(() => false);
    if (closed) return;
  }
  throw new Error('制作面板连按 6 次 C 仍未关上');
}

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
  // loot 步的出现条件（200px 内有没有没开过的容器）不满足时教程闭嘴，
  // contextual 归世界链。修前钉 DEFAULT_FOOT——那是 AG-51 宿舍床铺进世界
  // 链之前的过期值：1 层两排室友床铺满走廊，900 处世界说的是「搜刮床铺」。
  expect(await hudText(page, 'hud-nav-context')).toBe('搜刮床铺');
  // 呼吸框已经盯上储物柜（世界坐标，160）。
  expect(await gfxVisible(page, 'tutorialWorldGfx')).toBe(true);
  // 走到床铺区的缺口（上梯口 44px 与柜子 44px 之间）出搜刮提示：1 层两排
  // 室友床（DORM_FRONT/BACK_BEDS，AG-51）占满走廊中段，床铺 44px 内世界
  // 的「按 E 搜刮床铺」会按 tutorialYieldsToWorld 接棒——修前走 300 正是
  // 床铺区，断言因此永远看不到 HINT_LOOT。
  await walkTo(page, 'ArrowLeft', 100);
  await expect.poll(async () => hudText(page, 'hud-nav-context'), { timeout: 5000 }).toBe(HINT_LOOT);
  await page.screenshot({ path: 'output/ag73/02-step2-loot-approach.png' });
  // 贴到交互距离内：世界链自己的键帽提示接棒（教程不覆写交互提示）。从 100
  // 往右回到柜子（170）——柜子在 160，44px 内世界说「按 E 打开 储物柜」。
  await walkTo(page, 'ArrowRight', 170);
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
  await closeCraftingPanel(page); // 关面板（等到真关上——同帧双按会被 guard 吞）
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
  // 圆环步持有 3 秒：等它自动进制作步再按 C。修前这里立刻按 C，面板在圆环
  // 保持期内开合，craftingOpen 的采样窗口整个错过——存量 race（本用例与
  // 「finding the bed」同款），walkTo 修好后才会走到这一步。
  await expect.poll(async () => tutorial(page), { timeout: 8000 }).toEqual({ step: 3, skipped: false });
  await page.keyboard.press('C');
  await page.waitForFunction(
    () => (window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { craftingOpen: boolean } | null)?.craftingOpen === true,
    undefined,
    { timeout: 5000 },
  );
  await closeCraftingPanel(page); // 关面板（等到真关上——同帧双按会被 guard 吞）
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
  // 先钉真实状态：入夜当帧教程就收尾（step 5→6，runTutorialTick 在 update()
  // 最前面跑，面板/爬梯都拦不住）。flash 是游戏内 1700ms 之后补的那一枪
  // （排到夜事件消息之后，见 runTutorialTick 的 nightRollover 分支）——它是
  // delayedCall 的游戏时间，低帧率下 Phaser 把 delta 钳到平滑均值（帧间隔超过
  // 200ms 即 <5fps 时每帧最多推进 ~17ms），游戏时钟被拉长、flash 随之迟到，
  // 5s 实轮窗口在负载下不够（合入 worktree 实跑就等到过空串）。先等状态，
  // flash 窗口放到 15s：3 倍拉伸下 1700ms 游戏时间 ≈ 5.1s，仍有余量。
  await expect.poll(async () => tutorial(page), { timeout: 10_000 }).toEqual({ step: 6, skipped: false });
  await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 15_000 }).toContain('你已掌握基本生存');
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
  // contextual 归世界链：续上局站在 2 层上梯口，世界说的是上楼（tier1 还挂着
  // 抄近路报价）。修前钉 DEFAULT_FOOT 同样是宿舍床铺进链前的过期值；「按 E」
  // 前缀被导航条渲染成 E 键帽，槽里只剩动作名，所以断言不含前缀。
  expect(await hudText(page, 'hud-nav-context')).toContain('上楼');
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
  // 教程闭嘴后 contextual 归世界链：出生点（640）压着一张室友床，世界说的是
  // 「搜刮床铺」。修前钉 DEFAULT_FOOT——同为宿舍床铺进链前的过期值。
  await expect.poll(async () => hudText(page, 'hud-nav-context'), { timeout: 5000 }).toBe('搜刮床铺');
  expect(await hudVisible(page, 'hud-tutorial-skip')).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('floor100000.tutorial.skipped'))).toBe('1');
  expect(await page.evaluate(() => localStorage.getItem('floor100000.tutorial.progress'))).toBeNull();
  await page.screenshot({ path: 'output/ag73/07-skipped.png' });

  // 刷新重开：不重现。
  await startGame(page, 42);
  await page.waitForTimeout(400);
  await expect.poll(async () => hudText(page, 'hud-nav-context'), { timeout: 5000 }).toBe('搜刮床铺');
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

// RC-02 XP-3：床步不再从早上悬到入夜。修前完成条件只有「睡过/入夜」，
// 教程结尾晾着一个当晚才能做的动作（RC-02 报告 run-seed1.log 07:35:16）；
// 现在白天走到自己床边即「知道床在哪」当场收尾，入夜路径保留兜底
// （用例 'nightfall finishes all six steps' 钉着它）。
test('finding the bed on floor 1 finishes the tutorial before nightfall', async ({ page }) => {
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
  // 圆环步持有 3 秒：等它自动进制作步再按 C（同 test 4 的稳健序列）。
  await expect.poll(async () => tutorial(page), { timeout: 8000 }).toEqual({ step: 3, skipped: false });
  await page.keyboard.press('C');
  await page.waitForFunction(
    () => (window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { craftingOpen: boolean } | null)?.craftingOpen === true,
    undefined,
    { timeout: 5000 },
  );
  await expect.poll(async () => tutorial(page), { timeout: 5000 }).toEqual({ step: 4, skipped: false });
  await closeCraftingPanel(page); // 关面板（等到真关上——同帧双按会被 guard 吞）
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

  // 把时钟摁在上午：证明收尾不靠入夜（入夜 = 18:00，这里离它还有半天）。
  await setMinute(page, 10 * 60);
  // 爬回 1 层：把玩家摆到 2 层下行梯口（1240，tier1 钉右端）按 E——与上面
  // 爬梯同款 evaluate 摆位，顺带避开 2 层可能刷新的阻碍物（seed 42 的 2 层
  // 就有瓦砾，真实行走会被挡住，10s 内下不来）。
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.player.x = 1240;
  });
  await page.waitForTimeout(150);
  await page.keyboard.press('E');
  await page.waitForFunction(
    () => window.__PHASER_SESSION__?.getState()?.currentFloor === 1,
    undefined,
    { timeout: 10_000 },
  );
  // 下梯落点在 1 层右端（downExitXFor(2)=1240），床在 1120——往左走。
  const landX = await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.player?.x ?? 0);
  await walkTo(page, landX > 1120 ? 'ArrowLeft' : 'ArrowRight', 1120);
  // 走到床边：教程当场收尾，flash 是六步全过的那一句。
  await expect.poll(async () => tutorial(page), { timeout: 8000 }).toEqual({ step: 6, skipped: false });
  await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 5000 }).toContain('你已掌握基本生存');
  expect(await hudVisible(page, 'hud-tutorial-skip')).toBe(false);
  // 此刻仍是白天：这一步不是「等到晚上自动完成」的。
  expect(await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.gameMinuteOfDay ?? -1)).toBeLessThan(18 * 60);
  expect(await page.evaluate(() => localStorage.getItem('floor100000.tutorial.progress'))).toBe('6');
  await page.screenshot({ path: 'output/ag73/08-bed-found-daytime.png' });
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
