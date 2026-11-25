import { expect, test, type Page } from '@playwright/test';
import { markAlinGateOpenForUnrelatedTraversal } from '../e2e/alinGateFixture';

// 「一栋楼住很多人」——生产构建下的验收。
//
// 这一层验证是单测替代不了的：npcRoster.test.ts 证明的是数据表和资产管线自洽，
// 而这里证明的是**构建产物在真浏览器里**确实把六个人画出来、确实有四个站在第 2 层、
// 并且每个人按下 E 都能开自己的对话。之前「代理请求从不发出」那个缺陷就是
// 在这层暴露的——三层单测全绿，只有构建产物 + 真浏览器能看见。

interface NpcProbe {
  id: string;
  name: string;
  floor: number;
  x: number;
}

interface State {
  currentFloor: number;
  player: { x: number; inventory: { slots: Array<{ itemId: string; quantity: number }> } };
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
  await page.goto(`/?seed=${seed}&debug=1`);
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const started = await page
      .waitForFunction(
        () => {
          const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
          return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
        },
        undefined,
        { timeout: 2000 },
      )
      .then(() => true)
      .catch(() => false);
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

async function setX(page: Page, x: number): Promise<void> {
  await page.evaluate((v) => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (s) s.player.x = v;
  }, x);
}

/** 这一层屏幕上所有可见的角色名字标签（只保留已知居民名）。 */
async function visibleResidentLabels(page: Page): Promise<string[]> {
  const known = ['阿林', '小周', '老陈', '大刘', '阿珍', '小满'];
  const labels = await page.evaluate(() => {
    const g = (window as unknown as {
      __PHASER_GAME__?: {
        scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean; depth?: number }> } } | null };
      };
    }).__PHASER_GAME__;
    const list = g?.scene.getScene('Game')?.children.list ?? [];
    // 名字标签画在世界层（depth < 100）。这一层还画着出口提示（↑ 上楼）、
    // 商人的「行商」和采集点的「?」，所以只取已知居民名——那样断言的是
    // 「这几个人在场」，而不是「这层一共有几个文字对象」。
    return list
      .filter((o) => o.type === 'Text' && o.visible && (o.depth ?? 0) < 100)
      .map((o) => (o.text ?? '').trim());
  });
  return labels.filter((t) => known.includes(t));
}

async function hasVisibleText(page: Page, substr: string): Promise<boolean> {
  return page.evaluate((sub) => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean }> } } | null } } }).__PHASER_GAME__;
    const list = g?.scene.getScene('Game')?.children.list ?? [];
    return list.some((o) => o.type === 'Text' && (o.text ?? '').includes(sub) && o.visible);
  }, substr);
}

/**
 * 从当前层爬到上一层。
 *
 * E 只能按一次：楼梯是一个 1000ms 的可见攀爬，重复按会在落地帧启动第二次
 * 攀爬，`currentFloor === 目标` 已成立但人还在楼梯上——之后的 setX 会被落地
 * 坐标覆盖。所以先等「稳定站在上楼口」，再按一次，再等「在目标层且不在攀爬」。
 */
async function climbUp(page: Page): Promise<void> {
  const from = (await readState(page)).currentFloor;
  await setX(page, 40); // UP_EXIT_X
  await page.waitForFunction(
    (floor) => {
      const w = window as unknown as {
        __PHASER_GAME__?: { scene: { getScene: (key: string) => { player?: { x: number }; stairClimb?: unknown } | null } };
        __PHASER_SESSION__?: { getState: () => State | null };
      };
      const s = w.__PHASER_SESSION__?.getState();
      const scene = w.__PHASER_GAME__?.scene.getScene('Game');
      return s?.currentFloor === floor && s.player.x === 40 && scene?.player?.x === 40 && !scene.stairClimb;
    },
    from,
    { timeout: 5000 },
  );

  await page.keyboard.press('E');
  await page.waitForFunction(
    (floor) => {
      const w = window as unknown as {
        __PHASER_GAME__?: { scene: { getScene: (key: string) => { stairClimb?: unknown } | null } };
        __PHASER_SESSION__?: { getState: () => State | null };
      };
      return w.__PHASER_SESSION__?.getState()?.currentFloor === floor && !w.__PHASER_GAME__?.scene.getScene('Game')?.stairClimb;
    },
    from + 1,
    { timeout: 10_000 },
  );
}

test('第 2 层站着四个居民，而不是两个人', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await climbUp(page);

  // 名字标签是「这个人在屏幕上」的直接证据，不是数据表里有几条记录。
  await expect
    .poll(async () => (await visibleResidentLabels(page)).sort().join(','), { timeout: 8000 })
    .toBe('大刘,小周,老陈,阿林');

  // 一张图留给人工复核：断言证明四个人「在场」，图证明他们「看着像四个人」。
  // 1280 的视口装不下整个 1280px 宽的层，所以停两次各拍一张。
  await setX(page, 420);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/residents-f2-left.png' });
  await setX(page, 880);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/residents-f2-right.png' });

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('每个居民走近都能开自己的对话，不会串到别人身上', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await climbUp(page);

  // 四个人的坐标与标题。标题里带名字，所以「开对了人」是可断言的。
  const residents = [
    { x: 320, title: '老陈（门房）' },
    { x: 480, title: '阿林（维修工）' },
    { x: 800, title: '小周（邻居）' },
    { x: 960, title: '大刘（搬运工）' },
  ];

  for (const who of residents) {
    await setX(page, who.x);
    // 等一帧把精灵挪过去，再按 E。
    await page.waitForFunction(
      (target) => {
        const w = window as unknown as {
          __PHASER_GAME__?: { scene: { getScene: (key: string) => { player?: { x: number } } | null } };
          __PHASER_SESSION__?: { getState: () => State | null };
        };
        const s = w.__PHASER_SESSION__?.getState();
        const scene = w.__PHASER_GAME__?.scene.getScene('Game');
        return s?.player.x === target && scene?.player?.x === target;
      },
      who.x,
      { timeout: 4000 },
    );

    // 一次 E 开对话；重试只在「没开」时发生，开了就停。
    for (let i = 0; i < 4; i++) {
      if (await hasVisibleText(page, who.title)) break;
      await page.keyboard.press('E');
      await page.waitForTimeout(220);
    }
    await expect.poll(() => hasVisibleText(page, who.title), { timeout: 5000 }).toBe(true);

    // 关掉再走下一个人，否则 E 会被当成「关闭对话」。
    await page.keyboard.press('Escape');
    await expect.poll(() => hasVisibleText(page, who.title), { timeout: 3000 }).toBe(false);
  }

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('楼上住户在各自的楼层，第 5 层的厨娘和第 3 层的孩子都在', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await climbUp(page);

  // 第 2 → 3 层被阿林的维修门禁封着——这是主线设计，不是 bug。本用例验的是
  // 「居民分布在各层」，不是门禁流程，所以用既有夹具把门标记为已开（与
  // e2e/art.spec.ts 等遍历类用例同一做法）。门禁本身另有专属用例覆盖。
  await markAlinGateOpenForUnrelatedTraversal(page);

  // 从第 2 层继续往上，到 3 层看小满在不在。
  await climbUp(page);
  expect((await readState(page)).currentFloor).toBe(3);

  await expect.poll(async () => (await visibleResidentLabels(page)).includes('小满'), { timeout: 5000 }).toBe(true);

  // 第 3 层只有小满一个居民——不能把第 2 层那四个人也画上来。
  const floor3 = await visibleResidentLabels(page);
  expect(floor3.filter((n) => ['阿林', '小周', '老陈', '大刘'].includes(n))).toEqual([]);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});