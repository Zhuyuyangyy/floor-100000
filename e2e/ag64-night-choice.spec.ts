import { expect, test, type Page } from '@playwright/test';

// AG-64 实测探针（端口 5464，--workers=1）：用户 2026-11-17 原话——
// 「晚上的话应该会提示我们是出去找物资还是在家里守夜，防止别的 npc 抢我们的东西」。
//
//   1. 身在外层时入夜 → 弹二选一面板（出去找物资 / 在家守夜），↑/↓ 高亮、ESC 拒弹；
//   2. 选「在家守夜」→ 回宿舍走既有的床 → 夜间安排 → 睡到天亮，一夜无小偷；
//   3. 选「出去找物资」→ 时间推进 → NPC 造访预警 flash → 得手 → 赶回宿舍看到
//      「夜里好像有人来过……」证据 flash，且 guaranteed 净水没被碰。
//
// seed 2 是离线算好的：一层储物柜有布料（0.6 roll 中）、第 1 夜造访判定会来
// （0.55 roll 中）、当日夜事件是 50000 层漏水（不在 2 层，不打扰本探针）、
// 2 层 dwell 前两滚都是 atmosphere（不出牙）。seeded 同 seed 同结果由单测
// src/tests/nightChoice.test.ts 钉，这里只走真实交互路径。
//
// 截图落 output/ag64/（gitignore 的本地证据目录），全程 pageerror 清零。

const UP_EXIT_X = 40; // 1 层上梯口
const DOWN_EXIT_X_F2 = 1240; // 2 层下梯口
const BED_X = 1120; // 1 层自己的床
const NIGHTFALL = 1075; // 17:55——等帧循环把时钟推过 18:00（1080）

interface State {
  day: number;
  gameMinuteOfDay: number;
  currentFloor: number;
  player: { x: number; energy: number; hp: number };
  visitedFloors: Record<string, { openedContainers: string[]; lootedItems: string[]; localEvents: string[] }>;
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
  await page.waitForTimeout(120); // 等一帧让场景的世界对象跟上
}

async function setMinute(page: Page, minute: number): Promise<void> {
  await page.evaluate((m) => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { gameMinuteOfDay: number } | null } }).__PHASER_SESSION__?.getState();
    if (s) s.gameMinuteOfDay = m;
  }, minute);
}

async function pressEUntil(page: Page, check: () => Promise<boolean>, tries = 6, settleMs = 3000): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await check()) return;
    await page.keyboard.press('E');
    const deadline = Date.now() + settleMs;
    while (Date.now() < deadline) {
      await page.waitForTimeout(80);
      if (await check()) return;
    }
  }
  throw new Error('interact (E) did not take effect');
}

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

async function hudText(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const g = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; name?: string; text?: string }> } } | null } };
    }).__PHASER_GAME__;
    const o = g?.scene.getScene('Game')?.children.list.find((x) => x.name === n);
    return o?.text ?? '';
  }, name);
}

/** 上楼到 2 层（离开宿舍）。 */
async function goUpToFloor2(page: Page): Promise<void> {
  await setX(page, UP_EXIT_X);
  const before = (await readState(page)).currentFloor;
  await pressEUntil(page, async () => (await readState(page)).currentFloor > before);
}

/** 从 2 层回宿舍。 */
async function goHome(page: Page): Promise<void> {
  await setX(page, DOWN_EXIT_X_F2);
  const before = (await readState(page)).currentFloor;
  await pressEUntil(page, async () => (await readState(page)).currentFloor < before);
}

/** 走到床边按 E，等到「夜间安排 · 宿舍」面板。 */
async function openShelterAtBed(page: Page): Promise<void> {
  await setX(page, BED_X);
  await pressEUntil(page, async () => hasVisibleText(page, '夜间安排 · 宿舍'));
}

/** 等帧循环把时钟推过 18:00 后弹出的二选一面板。 */
async function waitForNightPrompt(page: Page): Promise<void> {
  await expect.poll(async () => hasVisibleText(page, '入夜 · 宿舍外'), { timeout: 20_000 }).toBe(true);
  await expect.poll(async () => hasVisibleText(page, '出去找物资'), { timeout: 5000 }).toBe(true);
  await expect.poll(async () => hasVisibleText(page, '在家守夜'), { timeout: 5000 }).toBe(true);
}

test('AG-64: nightfall away from home prompts 出去找物资 vs 在家守夜', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 2);
  await goUpToFloor2(page); // 身在外层
  await setMinute(page, NIGHTFALL); // 17:55，等时钟自然跨过 18:00
  await waitForNightPrompt(page);

  // 面板语言：一句情境 + 两张选项卡（图标/标题/后果）+ 底栏按键提示。
  await expect.poll(async () => hasVisibleText(page, '天黑了，楼里不会只有你一个人。'), { timeout: 5000 }).toBe(true);
  await expect.poll(async () => hasVisibleText(page, '夜里搜刮各层 · 宿舍可能遭 NPC 光顾'), { timeout: 5000 }).toBe(true);
  await expect.poll(async () => hasVisibleText(page, '回宿舍睡觉回血 · 今夜没人偷得走你的东西'), { timeout: 5000 }).toBe(true);
  await expect.poll(async () => hudText(page, 'hud-hint'), { timeout: 5000 }).toBe('↑/↓ 选择 · Enter 确认 · ESC 今晚再想想');
  await page.screenshot({ path: 'output/ag64/01-night-choice-scavenge.png' });

  // ↓ 切到「在家守夜」：选中高亮换行（面板重建，箭头跟着走）。
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => !(await hasVisibleText(page, '你决定回宿舍守夜')), { timeout: 3000 }).toBe(true);
  await page.screenshot({ path: 'output/ag64/02-night-choice-watch.png' });

  // ESC = 今夜再想想：拒过之后今夜不再问，也不武装偷取。
  await page.keyboard.press('Escape');
  await expect.poll(async () => hasVisibleText(page, '入夜 · 宿舍外'), { timeout: 5000 }).toBe(false);
  await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 5000 }).toContain('今夜的事，明天再说');
  const dismissed = await readState(page);
  expect(dismissed.visitedFloors[1]?.localEvents ?? []).toContain('night-choice:1:dismissed');
  // 拒弹不武装：时间再推进也不会有小偷标记。
  await setMinute(page, 1080 + 45 + 40 + 30);
  await page.waitForTimeout(400);
  const stillQuiet = await readState(page);
  expect((stillQuiet.visitedFloors[1]?.localEvents ?? []).filter((e) => e.startsWith('night-visit') || e.startsWith('night-theft'))).toEqual([]);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('AG-64: 在家守夜 sleeps through the night undisturbed', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 2);
  await goUpToFloor2(page);
  await setMinute(page, NIGHTFALL);
  await waitForNightPrompt(page);

  // ↓ + Enter = 在家守夜。
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 5000 }).toContain('你决定回宿舍守夜');

  // 守夜 = 回宿舍走既有的床流程：夜间安排 → 休息 → 睡觉，睡到第 2 天 06:00。
  // （入睡要 20:00 后——nightRiskStartMinute；18:05 躺下会被「还太早」挡回，
  //  这正是睡眠主干自己的规矩，把时钟拨到 20:00 再睡。）
  await goHome(page);
  await setMinute(page, 1200);
  await openShelterAtBed(page);
  await page.keyboard.press('Enter'); // 安排「休息」
  await expect.poll(async () => hasVisibleText(page, 'Enter 睡觉 · ESC 返回'), { timeout: 5000 }).toBe(true);
  await page.screenshot({ path: 'output/ag64/03-watch-shelter.png' });
  await page.keyboard.press('E');
  await page.waitForFunction(() => (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState()?.day === 2, undefined, { timeout: 15_000 });

  const slept = await readState(page);
  expect(slept.day).toBe(2);
  expect(slept.gameMinuteOfDay).toBeGreaterThanOrEqual(360); // 06:00
  expect(slept.player.energy).toBeGreaterThan(95); // 睡满
  const events = slept.visitedFloors[1]?.localEvents ?? [];
  expect(events).toContain('night-choice:1:watch');
  // 守夜 = 小偷整晚不来：没有任何偷取侧标记。
  expect(events.filter((e) => e.startsWith('night-visit') || e.startsWith('night-theft'))).toEqual([]);
  await page.screenshot({ path: 'output/ag64/04-watch-slept.png' });

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('AG-64: 出去找物资 — the thief comes while you are out, and the evidence waits at home', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 2);
  await goUpToFloor2(page);
  await setMinute(page, NIGHTFALL);
  await waitForNightPrompt(page);

  // Enter（默认选中「出去找物资」）= 推门走进夜色，武装一夜的偷取模拟。
  await page.keyboard.press('Enter');
  await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 5000 }).toContain('你推门走进夜色');
  const chose = await readState(page);
  expect(chose.visitedFloors[1]?.localEvents ?? []).toContain('night-choice:1:scavenge');

  // 入夜 45 游戏分钟（≈15 真实秒）：NPC 造访判定——seed 2 会来，楼道脚步声预警。
  await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 40_000 }).toContain('楼道里似乎有脚步声');
  await page.screenshot({ path: 'output/ag64/05-thief-coming.png' });

  // 再造访后 40 游戏分钟（≈13 真实秒）得手：玩家还在 2 层，布料被偷走。
  await page.waitForFunction(
    () => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      return (s?.visitedFloors[1]?.localEvents ?? []).some((e) => e.startsWith('night-theft:'));
    },
    undefined,
    { timeout: 60_000 },
  );
  const stolen = await readState(page);
  const looted = stolen.visitedFloors[1]?.lootedItems ?? [];
  expect(looted, '被偷的是概率 roll 出来的布料').toContain('c:cabinet:cloth');
  expect(looted, 'guaranteed 净水永不被偷（survivalBalance 契约）').not.toContain('c:cabinet:clean_water');

  // 赶回宿舍：证据 flash「夜里好像有人来过……」，且只出示一次。
  await goHome(page);
  await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 15_000 }).toContain('夜里好像有人来过');
  await page.screenshot({ path: 'output/ag64/06-theft-evidence.png' });

  // 楼层视图里储物柜少了布料、净水还在（现场证据，不只是文案）。
  const view = await page.evaluate(async () => {
    // 变量中转：import() 的字面量路径 tsc 会去解析（解析不了），赋给变量后它是
    // 运行时动态导入——dev server 上就是这一个模块（ag51 同款做法）。
    const modPath = '/src/systems/LootSystem.ts';
    const mod = (await import(modPath)) as { getFloorView: (s: unknown, f: number) => { containers: Array<{ id: string; items: Array<{ itemId: string }> }> } };
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => unknown } }).__PHASER_SESSION__?.getState();
    return mod.getFloorView(s, 1).containers.find((c) => c.id === 'cabinet')?.items.map((i) => i.itemId) ?? [];
  });
  expect(view).toEqual(['clean_water']);

  // 证据只看一次：上楼再回宿舍（drawFloor 只在换层时跑），不再重复念。
  await goUpToFloor2(page);
  await goHome(page);
  await page.waitForTimeout(600);
  expect(await hudText(page, 'hud-feedback')).not.toContain('夜里好像有人来过');

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
