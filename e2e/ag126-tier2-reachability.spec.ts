import { expect, test, type Page } from '@playwright/test';

// AG-126（RC-04 覆盖缺口 1）：tier2+（100+ 层）阻碍物可达性 e2e。
//
// Node 侧护栏（src/tests/obstacles-tier2.test.ts）已钉死设计口径：
//   「不软锁」而非「全通」——40 seed × 45 tier2+ 层，6800 落点检查 0 软锁、
//   8200 到达检查全局 BFS 0 失败。本 spec 在真机帧循环里取证同一口径的
//   代表切面（seed42 F102，gate@170，宽 1600，downX=496）：
//   ① 无铲子：40 落点向右直走被 gate 钳在 144（「上得去下不来」实证）；
//   ② 不软锁：返回 40 上行口 E 上行到 F103（权威 currentFloor 为证）——
//      下口被钳但上口可用，玩家没被困死。注意 F102 的 x=40 是上行口
//      （currentInteractionZone→'up'→changeFloor(1)），不是下行口；
//      完整「无铲子回家」路径（上行到段顶→右侧下行→段底电梯）已由
//      Node 护栏全局 BFS 覆盖（8200 到达 0 失败），e2e 不重走 27 层；
//   ③ 有铲子：E 撬开闸门 → 直走 496 下梯口 → E 下行回 F101。
//
// 直达 102 层用存档注入（仓库既有手法：serialize=JSON.stringify(state)，
// SAVE_KEY='floor100000.save.v1'，Menu「继续游戏」走 tryContinue→Game）：
// 先正常开一局拿合法 GameState，改 currentFloor/player.x 后写回 localStorage，
// reload 走继续游戏——不真爬 102 层，也不伪造存档形状。
//
// 时间鲁棒性（CI 慢环境纪律）：全部轮询真实条件，不押固定 sleep 时长；
// 断言押权威状态（currentFloor/player.x/visitedFloors）而非动画像素。

const SAVE_KEY = 'floor100000.save.v1';
const GATE_X = 170; // seed42 F102 闸门（Node 护栏定点取证同值）
const BLOCK_EDGE = GATE_X - 26; // 占位左沿（blockHalfWidth=26）
const DOWN_X = 496; // F102 下梯口（downExitXFor(102)，宽 1600）
const UP_X = 40; // 上梯口

interface State {
  currentFloor: number;
  player: { x: number; inventory: { slots: Array<{ itemId: string; quantity: number }> } };
  visitedFloors: Record<string, { lootedItems: string[] }>;
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

async function readState(page: Page): Promise<State> {
  return page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    return JSON.parse(JSON.stringify(s)) as State;
  });
}

async function setX(page: Page, x: number): Promise<void> {
  await page.evaluate((v) => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { x: number } } | null } }).__PHASER_SESSION__?.getState();
    if (s) s.player.x = v;
  }, x);
  await page.waitForTimeout(150); // 等一帧让场景世界对象跟上
}

async function hudText(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const g = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ name?: string; text?: string }> } } | null } };
    }).__PHASER_GAME__;
    const o = g?.scene.getScene('Game')?.children.list.find((x) => x.name === n);
    return o?.text ?? '';
  }, name);
}

/** 正常开一局（seed42），跳过教程。 */
async function startGame(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('floor100000.tutorial.skipped', '1'));
  await page.goto('/?seed=42');
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

/** 存档注入直达 F102：拿合法存档改楼层/坐标写回，reload 走「继续游戏」。 */
async function parkAt102(page: Page): Promise<void> {
  await page.evaluate((key) => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => Record<string, unknown> | null } }).__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    s.currentFloor = 102;
    (s.player as { x: number }).x = 40;
    // 补满生存状态防测试途中饿死/病倒干扰走位
    const p = s.player as Record<string, number>;
    p.hp = 100;
    p.hunger = 100;
    p.thirst = 100;
    p.energy = 100;
    localStorage.setItem(key, JSON.stringify(s));
  }, SAVE_KEY);
  await page.reload();
  await waitForScene(page, 'Menu');
  // 「继续游戏」是第二项（hasSave 时插入）：↓ 选中 → Enter
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Game');
  await page.waitForFunction(
    () => (window as unknown as { __PHASER_SESSION__?: { getState: () => { currentFloor: number } | null } }).__PHASER_SESSION__?.getState()?.currentFloor === 102,
    undefined,
    { timeout: 15_000 },
  );
}

/** 往包里塞铲子（走产品自己的 InventorySystem，同 ag66 手法）。 */
async function giveShovel(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const modPath = '/src/systems/InventorySystem.ts';
    const mod = (await import(modPath)) as { addItem: (inv: unknown, itemId: string, n: number) => unknown };
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { inventory: unknown } } | null } }).__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    mod.addItem(s.player.inventory, 'shovel', 1);
  });
}

/** 按住方向键走到目标 x（轮询权威坐标，90s 上限——CI 慢帧余量）。 */
async function walkToward(page: Page, dir: 'ArrowLeft' | 'ArrowRight', targetX: number, timeoutMs = 90_000): Promise<void> {
  await page.keyboard.down(dir);
  try {
    await page.waitForFunction(
      ({ t, d }) => {
        const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { x: number } } | null } }).__PHASER_SESSION__?.getState();
        if (!s) return false;
        return d === 'ArrowLeft' ? s.player.x <= t : s.player.x >= t;
      },
      { t: targetX, d: dir },
      { timeout: timeoutMs },
    );
  } finally {
    await page.keyboard.up(dir);
  }
}

/** 在梯口按 E 等换层完成（权威 currentFloor 到目标值）。 */
async function takeStairs(page: Page, toFloor: number): Promise<void> {
  await page.keyboard.press('E');
  await page.waitForFunction(
    (f) => (window as unknown as { __PHASER_SESSION__?: { getState: () => { currentFloor: number } | null } }).__PHASER_SESSION__?.getState()?.currentFloor === f,
    toFloor,
    { timeout: 30_000 },
  );
}

test.describe('AG-126 tier2+ 可达性（seed42 F102 gate@170）', () => {
  // 走位+爬梯+存档注入 reload 累计远超默认 30s；同 survivalJourney 惯例
  // 给足余量（CI 慢帧下走位 90s 上限 × 两段 + 换层 30s × 2）。
  test.setTimeout(240_000);

  test('① 无铲子直走被钳 + ② 原路返回不软锁', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await startGame(page);
    await parkAt102(page);
    expect((await readState(page)).currentFloor).toBe(102);
    await page.screenshot({ path: 'output/ag126/01-landed-f102.png' });

    // ① 向右直走：gate@170 把玩家钳在占位左沿 144，到不了 496 下梯口。
    await page.keyboard.down('ArrowRight');
    await page.waitForFunction(
      (edge) => {
        const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { x: number } } | null } }).__PHASER_SESSION__?.getState();
        return !!s && s.player.x >= edge - 2;
      },
      BLOCK_EDGE,
      { timeout: 30_000 },
    );
    // 再给 2s 持续按键：若没被钳会继续向右；被钳则停在 144 附近。
    await page.waitForTimeout(2000);
    await page.keyboard.up('ArrowRight');
    const blockedX = (await readState(page)).player.x;
    expect(blockedX, `应被 gate 钳在 ${BLOCK_EDGE} 附近`).toBeLessThan(GATE_X);
    expect(blockedX).toBeGreaterThanOrEqual(BLOCK_EDGE - 4);
    await page.screenshot({ path: 'output/ag126/02-blocked-by-gate.png' });

    // 缺工具提示（站在闸门边）：权威文案同源 InteractionController.obstacleHint。
    await expect.poll(async () => hudText(page, 'hud-hint'), { timeout: 8000 }).toContain('需要铲子或撬棍');

    // ② 不软锁：返回 40 上行口，E 上行到 F103（下口被钳但上口可用）。
    // 完整回家路径由 Node 护栏 BFS 覆盖，这里取证「没被困死」的最小切面。
    await walkToward(page, 'ArrowLeft', UP_X + 2);
    await setX(page, UP_X);
    await takeStairs(page, 103);
    expect((await readState(page)).currentFloor).toBe(103);
    await page.screenshot({ path: 'output/ag126/03-up-to-f103.png' });
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('③ 有铲子撬开闸门 → 直走下梯口 → 下行', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await startGame(page);
    await parkAt102(page);
    await giveShovel(page);
    expect((await readState(page)).player.inventory.slots.some((s) => s.itemId === 'shovel')).toBe(true);

    // 贴到闸门左侧，提示变「按 E 撬开这道闸门」。
    await setX(page, GATE_X - 32);
    await expect.poll(async () => hudText(page, 'hud-hint'), { timeout: 8000 }).toBe('按 E 撬开这道闸门');
    await page.screenshot({ path: 'output/ag126/04-armed-at-gate.png' });

    // E → 挖掘动作 → 轮询「过道通了」（不押固定时长，CI 慢帧余量 30s）。
    await page.keyboard.press('E');
    await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 30_000 }).toMatch(/过道通了/);
    // 权威持久化：挖过的阻碍物进 visitedFloors.lootedItems（回层不复活的前提）。
    expect((await readState(page)).visitedFloors['102'].lootedItems).toContain(`obstacle:102:${GATE_X}`);
    await page.screenshot({ path: 'output/ag126/05-gate-dug.png' });

    // 过道通：直走穿过原闸门位到下梯口 496。
    await walkToward(page, 'ArrowRight', DOWN_X);
    const x = (await readState(page)).player.x;
    expect(x, '挖开后应能直走到下梯口').toBeGreaterThanOrEqual(DOWN_X);
    await setX(page, DOWN_X);
    await takeStairs(page, 101);
    expect((await readState(page)).currentFloor).toBe(101);
    await page.screenshot({ path: 'output/ag126/06-descended.png' });
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });
});