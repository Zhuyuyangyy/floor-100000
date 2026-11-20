import { expect, test, type Page } from '@playwright/test';

// AG-66 实测探针（端口 5466，--workers=1）：用户 2026-11-17 原话——
//   「搜集的时候有一个搜集的动作，然后过 2s 才能找到东西啥的」
//   「这个过道应该有阻碍物，就是用铲子等工具才能挖完才能进去」
//
// 五个必测项：
//   ① 点容器 → search 动画 → 2s 后才出 loot（精确计时 + 动作中截图）；
//   ② 走到阻碍物被拦（x 钳位 + 截图）；
//   ③ 没铲子 E 提示要工具；
//   ④ 回宿舍做把铲子（session 给材料）→ 挖开 → 过道通（截图）；
//   ⑤ 挖过的再回层不复活。
// 取消语义附在①里：动作中移动 = 收手，不出货、不标记、可重来。
//
// 楼层数据（seed 42；2026-11-20 tier1 变长后的实测值）：
// F2（1600 宽）瓦砾堆 x=170、货架 x=1400（面包×2+砍刀×1）；
// F3（1600 宽）瓦砾堆 x=360、木箱 x=600（木材×2+胶带×1）、铁箱 x=1000。
// 制作面板只能在 1 层宿舍开（onToggleCrafting 的既有设计），所以④回 1 层做。
// 截图落 output/ag66/（gitignore 的本地证据目录），全程 pageerror 清零。

const SHELF_X = 1400; // F2 邻居货架（原 1120，随层宽 ×1.25）
const CRATE_X = 600; // F3 木箱（原 480）
const RUBBLE_X = 170; // F2 瓦砾堆（原 222）
const BLOCK_EDGE = RUBBLE_X - 26; // 占位左沿（blockHalfWidth=26）

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
  await page.waitForTimeout(120); // 等一帧让场景的世界对象跟上
}

async function playerX(page: Page): Promise<number> {
  return (await readState(page)).player.x;
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

/** 记录场景播过的一次性动作 clip（playActionAnim 的调用）。 */
async function recordActionAnims(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => unknown } } }).__PHASER_GAME__;
    const scene = g?.scene.getScene('Game') as unknown as { playActionAnim: (key: string, ms: number) => void } | undefined;
    if (!scene) throw new Error('no Game scene');
    const bag: string[] = [];
    (window as unknown as { __AG66_ANIMS__: string[] }).__AG66_ANIMS__ = bag;
    const original = scene.playActionAnim.bind(scene);
    scene.playActionAnim = (key: string, ms: number): void => {
      bag.push(key);
      original(key, ms);
    };
  });
}

async function actionAnims(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __AG66_ANIMS__?: string[] }).__AG66_ANIMS__ ?? []);
}

/** 往包里塞东西（走产品自己的 InventorySystem，不走后门）。 */
async function giveItem(page: Page, itemId: string, quantity: number): Promise<void> {
  await page.evaluate(async ({ id, n }: { id: string; n: number }) => {
    const modPath = '/src/systems/InventorySystem.ts';
    const mod = (await import(modPath)) as { addItem: (inv: unknown, itemId: string, n: number) => unknown };
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { inventory: unknown } } | null } }).__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    mod.addItem(s.player.inventory, id, n);
  }, { id: itemId, n: quantity });
}

/** 场景私有字段的只读快照（阻碍物名册）。 */
async function obstacleRoster(page: Page): Promise<{ all: number[]; active: number[] }> {
  return page.evaluate(() => {
    const g = (window as unknown as {
      __PHASER_GAME__?: {
        scene: {
          getScene: (k: string) => { floorObstacles?: Array<{ x: number }>; activeObstacleList?: Array<{ x: number }> } | null;
        };
      };
    }).__PHASER_GAME__;
    const scene = g?.scene.getScene('Game');
    return {
      all: (scene?.floorObstacles ?? []).map((o) => o.x),
      active: (scene?.activeObstacleList ?? []).map((o) => o.x),
    };
  });
}

/** 按住某个方向键走 ms 毫秒。 */
async function holdWalk(page: Page, key: 'a' | 'd', ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

/** 走到上梯口按 E，等到达 target 层（显式目标：F2 的 2 > 1 会误判，不能写相对条件）。 */
async function climbUp(page: Page, target: number): Promise<void> {
  await setX(page, 40);
  await page.keyboard.press('E');
  await page.waitForFunction(
    (t) => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { currentFloor: number } | null } }).__PHASER_SESSION__?.getState();
      return s?.currentFloor === t;
    },
    target,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(300); // 落地缓动 + drawFloor
}

/** 走到当前层的下梯口按 E，等到达 target 层（口位随层变，读场景权威值）。 */
async function climbDown(page: Page, target: number): Promise<void> {
  const downX = await page.evaluate(() => {
    const s = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (k: string) => { downExit?: number } | null } };
    }).__PHASER_GAME__?.scene.getScene('Game');
    return s?.downExit ?? 664;
  });
  await setX(page, downX);
  await page.keyboard.press('E');
  await page.waitForFunction(
    (t) => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { currentFloor: number } | null } }).__PHASER_SESSION__?.getState();
      return s?.currentFloor === t;
    },
    target,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(300);
}

test('AG-66: 点容器先弯腰，2s 后才出货；动作中移动 = 收手重来', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await recordActionAnims(page);

  // ── 0. 上 2 层（瓦砾堆 222 那一层）────────────────────────────────────
  await climbUp(page, 2);
  expect((await readState(page)).currentFloor).toBe(2);

  // ── 1. 点货架 → search 动画 → 精确计时 2s 后才出 loot ─────────────────
  await setX(page, SHELF_X);
  await expect.poll(async () => hudText(page, 'hud-hint'), { timeout: 5000 }).toBe('按 E 打开 邻居货架');

  const t0 = Date.now();
  await page.keyboard.press('E');
  // 动作立刻起：底栏说在翻，search clip 在播，但货还没到手。
  await page.waitForTimeout(350);
  expect(await hudText(page, 'hud-hint')).toBe('翻找邻居货架中……');
  expect((await actionAnims(page)).some((k) => k.startsWith('search-'))).toBe(true);
  expect(await hudText(page, 'hud-feedback')).not.toMatch(/获得/);
  expect((await readState(page)).visitedFloors['2']?.openedContainers.includes('shelf') ?? false).toBe(false);
  await page.screenshot({ path: 'output/ag66/01-search-mid.png' });

  // 轮询到出货，量真实间隔。
  let t1 = 0;
  for (let i = 0; i < 80; i++) {
    const fb = await hudText(page, 'hud-feedback');
    if (/获得/.test(fb)) {
      t1 = Date.now();
      break;
    }
    await page.waitForTimeout(60);
  }
  expect(t1, '2s 内必须出货').toBeGreaterThan(t0);
  const elapsed = t1 - t0;
  expect(elapsed, `出货间隔 ${elapsed}ms 应≈2000ms`).toBeGreaterThan(1900);
  expect(elapsed, `出货间隔 ${elapsed}ms 不应远超 2s`).toBeLessThan(3600);
  await page.screenshot({ path: 'output/ag66/02-search-result.png' });
  expect(await hudText(page, 'hud-feedback')).toMatch(/获得 面包×2、砍刀×1/);
  expect((await readState(page)).visitedFloors['2'].openedContainers).toContain('shelf');

  // ── 2. 取消语义：上 3 层开木箱，动作中按 D = 收手 ─────────────────────
  await climbUp(page, 3);
  expect((await readState(page)).currentFloor).toBe(3);
  await setX(page, CRATE_X);
  await expect.poll(async () => hudText(page, 'hud-hint'), { timeout: 5000 }).toBe('按 E 打开 木箱');
  await page.keyboard.press('E');
  await page.waitForTimeout(400); // 动作中
  expect(await hudText(page, 'hud-hint')).toBe('翻找木箱中……');
  await holdWalk(page, 'd', 200); // 移动输入 = 取消
  expect(await hudText(page, 'hud-feedback')).toBe('你直起身来，没翻完');
  // 取消不出货、不标记：等到 2s 时限过完，也没有「获得」，容器不算开过。
  await page.waitForTimeout(2400);
  expect(await hudText(page, 'hud-feedback')).not.toMatch(/获得|木材/);
  expect((await readState(page)).visitedFloors['3']?.openedContainers.includes('crate_wood') ?? false).toBe(false);
  await page.screenshot({ path: 'output/ag66/03-search-cancelled.png' });

  // 取消过的箱子照旧能重搜（今天的 roll 没被吞）。
  await setX(page, CRATE_X);
  await page.keyboard.press('E');
  await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 8000 }).toMatch(/获得 木材×2、胶带×1/);
  expect((await readState(page)).visitedFloors['3'].openedContainers).toContain('crate_wood');

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('AG-66: 阻碍物拦过往道，没工具说缺什么，做了铲子挖开才通', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await climbUp(page, 2);
  expect((await readState(page)).currentFloor).toBe(2);
  const roster = await obstacleRoster(page);
  expect(roster.all, 'F2 应有一个瓦砾堆').toEqual([RUBBLE_X]);
  expect(roster.active).toEqual([RUBBLE_X]);

  // ── 1. ② 走到阻碍物被拦：从远处按住 D 走，钳在占位左沿 ─────────────────
  // 瓦砾从 222 移到 170，起点必须退到占位左沿 144 之外（60）。
  await setX(page, 60);
  await holdWalk(page, 'd', 700); // 无阻碍能走 ~91px 到 151，实际被钳在 144
  const blocked = await playerX(page);
  expect(blocked, `被钳在 ${blocked}，应贴占位左沿 ${BLOCK_EDGE}`).toBeLessThanOrEqual(BLOCK_EDGE);
  expect(blocked).toBeGreaterThan(60);
  await page.screenshot({ path: 'output/ag66/04-blocked.png' });

  // ── 2. ③ 没铲子：提示与 E 的反馈都说要工具 ────────────────────────────
  await setX(page, RUBBLE_X - 32);
  await expect.poll(async () => hudText(page, 'hud-hint'), { timeout: 5000 }).toBe('需要铲子才能挖开这堆瓦砾（撬棍也行）');
  await page.keyboard.press('E');
  await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 5000 }).toBe('需要铲子才能挖开这堆瓦砾（撬棍也行）');
  await page.screenshot({ path: 'output/ag66/05-need-tool.png' });
  // 提示归提示，路还是堵着。
  await setX(page, 60);
  await holdWalk(page, 'd', 700);
  expect(await playerX(page)).toBeLessThanOrEqual(BLOCK_EDGE);

  // ── 3. ④ 回宿舍做铲子（制作面板只能在 1 层开——onToggleCrafting 既有设计）──
  await climbDown(page, 1);
  expect((await readState(page)).currentFloor).toBe(1);
  await giveItem(page, 'scrap_metal', 3);
  await giveItem(page, 'wood', 2);
  await page.keyboard.press('C');
  await page.waitForTimeout(250);
  for (let i = 0; i < 20; i++) {
    const onShovel = await page.evaluate(() => {
        const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ name?: string; type: string; text?: string; visible: boolean; y: number; texture?: { key?: string } }> } } | null } } }).__PHASER_GAME__;
      const list = g?.scene.getScene('Game')?.children.list ?? [];
      const marker = list.find((o) => o.type === 'Image' && o.texture?.key === 'ui-marker' && o.visible);
      if (!marker) return false;
      const label = list.find((o) => o.type === 'Text' && o.visible && Math.abs(o.y - marker.y) <= 4);
      return (label?.text ?? '').startsWith('铲子');
    });
    if (onShovel) break;
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(120);
  }
  await page.screenshot({ path: 'output/ag66/06-craft-shovel.png' });
  await page.keyboard.press('Enter');
  await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 8000 }).toMatch(/制作了 铲子/);
  await page.keyboard.press('C'); // 关面板
  await page.waitForTimeout(200);
  expect((await readState(page)).player.inventory.slots.some((s) => s.itemId === 'shovel')).toBe(true);

  // ── 4. 再上 2 层：有铲子，E → 2s 挖掘 → 过道通 ───────────────────────
  await climbUp(page, 2);
  await setX(page, RUBBLE_X - 32);
  await expect.poll(async () => hudText(page, 'hud-hint'), { timeout: 5000 }).toBe('按 E 挖开这堆瓦砾');
  const d0 = Date.now();
  await page.keyboard.press('E');
  await page.waitForTimeout(350);
  expect(await hudText(page, 'hud-hint')).toBe('挖开瓦砾中……');
  let d1 = 0;
  for (let i = 0; i < 80; i++) {
    const fb = await hudText(page, 'hud-feedback');
    if (/过道通了/.test(fb)) {
      d1 = Date.now();
      break;
    }
    await page.waitForTimeout(60);
  }
  expect(d1, 'dig 必须有 2s 动作').toBeGreaterThan(d0);
  expect(d1 - d0, `挖掘间隔 ${d1 - d0}ms`).toBeGreaterThan(1900);
  expect(d1 - d0).toBeLessThan(3600);
  await page.screenshot({ path: 'output/ag66/07-dug.png' });
  expect((await readState(page)).visitedFloors['2'].lootedItems).toContain(`obstacle:2:${RUBBLE_X}`);
  // 名册：全集还在（残骸），active 已空。
  const afterDig = await obstacleRoster(page);
  expect(afterDig.all).toEqual([RUBBLE_X]);
  expect(afterDig.active).toEqual([]);

  // 过道通：从远处起步直接走过去（要跨过占位右沿 196）。
  await setX(page, 60);
  await holdWalk(page, 'd', 1400); // 无阻碍 ~182px → 242 > 196
  const passed = await playerX(page);
  expect(passed, `应走过占位区，实际停在 ${passed}`).toBeGreaterThan(RUBBLE_X + 26);
  await page.screenshot({ path: 'output/ag66/08-passage-open.png' });

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('AG-66: 挖过的阻碍物回层不复活', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await climbUp(page, 2);
  await giveItem(page, 'shovel', 1);
  await setX(page, RUBBLE_X - 32);
  await expect.poll(async () => hudText(page, 'hud-hint'), { timeout: 5000 }).toBe('按 E 挖开这堆瓦砾');
  await page.keyboard.press('E');
  await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 8000 }).toMatch(/过道通了/);

  // 上 3 层再下回来：重画楼层，挖过的应保持挖过。
  await climbUp(page, 3);
  expect((await readState(page)).currentFloor).toBe(3);
  await climbDown(page, 2);
  expect((await readState(page)).currentFloor).toBe(2);

  const back = await obstacleRoster(page);
  expect(back.all, '残骸还在楼层全集里').toEqual([RUBBLE_X]);
  expect(back.active, '但不再拦路').toEqual([]);
  expect((await readState(page)).visitedFloors['2'].lootedItems).toContain(`obstacle:2:${RUBBLE_X}`);

  // 直接走过原阻碍位，不被拦。
  await setX(page, 60);
  await holdWalk(page, 'd', 1400);
  expect(await playerX(page)).toBeGreaterThan(RUBBLE_X + 26);
  await page.screenshot({ path: 'output/ag66/09-no-respawn.png' });

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
