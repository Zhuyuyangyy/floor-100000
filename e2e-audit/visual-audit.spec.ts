import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { ALIN_REPAIR_GATE_FLAG } from '../src/data/floorGates';

// A3 视觉取证：每个用例只负责「走到某个界面并截图」。
//
// 这里全部用真实构建产物（vite dev server 加载 src，与生产一致的行为路径），
// 唯一被程序改写的是玩家坐标和 flags —— 与仓库既有 e2e 的做法一致，因为
// 走位不是本次审查的目标，截图才是。
//
// 输出目录 docs/img/audit-2026-11-26/，文件名与审查文档的章节号一一对应。

const OUT = 'docs/img/audit-2026-11-26';

interface State {
  currentFloor: number;
  day: number;
  gameMinuteOfDay: number;
  currentStage?: string;
  player: {
    x: number;
    hp: number;
    hunger: number;
    thirst: number;
    energy: number;
    gold: number;
    inventory: { slots: Array<{ itemId: string; quantity: number }> };
  };
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(280);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === k);
    },
    key,
    { timeout: 25_000 },
  );
}

/**
 * 读当前局状态。
 *
 * 加轮询重试的原因（实测过，不是防御性编程）：全量跑时 `04 floor-2 residents`
 * 偶发在 `climbTo` 的第一行抛 `no session`，单独跑却稳定通过。
 * `__PHASER_SESSION__.getState()` 在 DEV 下返回 `hasGame() ? getGame() : null`，
 * 而 Game 场景 active 与 `startNewGame()` 建立会话之间有极短的空窗——只在
 * 机器被其它 agent 抢占、帧调度被拖慢时才暴露。单次读取把这段空窗当成了
 * 「没有会话」，于是整条用例红。轮询到会话出现即可，不改游戏代码。
 */
async function readState(page: Page): Promise<State> {
  const handle = await page.waitForFunction(
    () => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } })
        .__PHASER_SESSION__?.getState();
      return s ?? false;
    },
    undefined,
    { timeout: 10_000, polling: 100 },
  );
  return (await handle.jsonValue()) as State;
}

/**
 * 连按某个键，直到目标场景 active。
 *
 * 为什么需要（实测过，不是防御性编程）：全量跑 40 条时 `11 critical stats`
 * 偶发红在 `toMetaSelect` 的 `waitForScene(page, 'MetaSelect')` 超时——
 * Menu 场景已经 active，但它的键盘绑定还没挂上（`create()` 里 addKey 在
 * 场景 active 之后才执行）。单次 `press('Enter')` 打在一个还没监听键盘的
 * 场景上，等于什么都没按，然后就一直等。
 *
 * `confirmMeta` 原本就是这么写的（注释里标了「MetaSelect 的键位绑定有竞态」），
 * 这里把同样的写法复用到 Menu → MetaSelect 这一段。
 */
async function pressUntilScene(page: Page, key: string, target: string, tries = 8): Promise<void> {
  for (let i = 0; i < tries; i++) {
    await page.keyboard.press(key);
    const ok = await page
      .waitForFunction(
        (k) => {
          const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
          return !!g && g.scene.getScenes(true).some((s) => s.scene.key === k);
        },
        target,
        { timeout: 1500 },
      )
      .then(() => true)
      .catch(() => false);
    if (ok) return;
    await page.waitForTimeout(200);
  }
  await waitForScene(page, target);
}

/** 从标题页进到 Game 场景，停在 MetaSelect 之前。 */
async function toMetaSelect(page: Page, seed = 42): Promise<void> {
  await page.goto(`/?seed=${seed}&debug=1`);
  await waitForScene(page, 'Menu');
  await page.waitForTimeout(500);
  await pressUntilScene(page, 'Enter', 'MetaSelect');
  await page.waitForTimeout(400);
}

/** 确认角色选择，进入 Game。MetaSelect 的键位绑定有竞态，按仓库既有写法重试。 */
async function confirmMeta(page: Page): Promise<void> {
  for (let i = 0; i < 6; i++) {
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
  await page.waitForTimeout(700);
}

async function startRun(page: Page, seed = 42): Promise<void> {
  await toMetaSelect(page, seed);
  await confirmMeta(page);
}

/** 直接改玩家 x。走位不是审查目标。 */
async function setX(page: Page, x: number): Promise<void> {
  await page.evaluate((v) => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (s) s.player.x = v;
  }, x);
  await page.waitForTimeout(220);
}

async function markGateOpen(page: Page): Promise<void> {
  await page.evaluate((gateFlag) => {
    const state = (window as unknown as { __PHASER_SESSION__?: { getState: () => { flags?: Record<string, number> } | null } })
      .__PHASER_SESSION__?.getState();
    if (!state) throw new Error('missing state');
    state.flags = { ...state.flags, [gateFlag]: 1 };
  }, ALIN_REPAIR_GATE_FLAG);
}

/** 走楼梯到指定层：设 x=40（上行口），按 E，等落地。 */
async function climbTo(page: Page, target: number): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    if ((await readState(page)).currentFloor === target) return;
    await setX(page, 40);
    await page.waitForFunction(
      () => {
        const w = window as unknown as {
          __PHASER_GAME__?: { scene: { getScene: (k: string) => { player?: { x: number }; stairClimb?: unknown } | null } };
          __PHASER_SESSION__?: { getState: () => State | null };
        };
        return w.__PHASER_SESSION__?.getState()?.player.x === 40 && w.__PHASER_GAME__?.scene.getScene('Game')?.player?.x === 40 && !w.__PHASER_GAME__?.scene.getScene('Game')?.stairClimb;
      },
      undefined,
      { timeout: 6000 },
    );
    await page.keyboard.press('E');
    const landed = await page
      .waitForFunction(
        (floor) => {
          const w = window as unknown as {
            __PHASER_GAME__?: { scene: { getScene: (k: string) => { stairClimb?: unknown } | null } };
            __PHASER_SESSION__?: { getState: () => State | null };
          };
          return w.__PHASER_SESSION__?.getState()?.currentFloor === floor && !w.__PHASER_GAME__?.scene.getScene('Game')?.stairClimb;
        },
        target,
        { timeout: 6000 },
      )
      .then(() => true)
      .catch(() => false);
    if (landed) return;
  }
  throw new Error(`climb to ${target} failed (at ${(await readState(page)).currentFloor})`);
}

test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
});

// ── 01 标题页 ─────────────────────────────────────────────────────────────
test('01 title', async ({ page }) => {
  await page.goto('/?seed=42&debug=1');
  await waitForScene(page, 'Menu');
  await page.waitForTimeout(900);
  await shot(page, '01-title');
});

// ── 02 角色选择（新跑局必经） ────────────────────────────────────────────
test('02 meta-select', async ({ page }) => {
  // 注意：MetaSelect 上按 Enter 会直接开局，所以截图必须在按键之前。
  await toMetaSelect(page);
  await shot(page, '02-meta-select');
});

// ── 03 开局第一屏（第 1 层） ─────────────────────────────────────────────
test('03 floor-1 first screen', async ({ page }) => {
  await startRun(page);
  await page.waitForTimeout(900);
  await shot(page, '03-floor-1-boot');
});

// ── 04 第 2 层（四位居民同屏） ───────────────────────────────────────────
test('04 floor-2 residents', async ({ page }) => {
  await startRun(page);
  await markGateOpen(page);
  await climbTo(page, 2);
  await setX(page, 640);
  await shot(page, '04-floor-2-residents-mid');
  await setX(page, 480);
  await shot(page, '04b-floor-2-alin');
});

// ── 05 背包 ──────────────────────────────────────────────────────────────
test('05 inventory', async ({ page }) => {
  await startRun(page);
  // 往背包塞几件，让「拥挤」问题暴露出来
  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { inventory: { slots: Array<{ itemId: string; quantity: number }> } } } | null } })
      .__PHASER_SESSION__?.getState() as { player: { inventory: { slots: Array<{ itemId: string; quantity: number }> } } } | null;
    if (!s) return;
    const slots = s.player.inventory.slots;
    for (const id of ['scrap_metal', 'wire', 'cloth', 'battery', 'tape', 'wood', 'filter', 'dirty_water']) {
      slots.push({ itemId: id, quantity: 1 });
    }
  });
  await page.waitForTimeout(300);
  await page.keyboard.press('I');
  await page.waitForTimeout(600);
  await shot(page, '05-inventory');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(320);
  await shot(page, '05b-inventory-cursor');
});

// ── 06 对话（阿林） ──────────────────────────────────────────────────────
test('06 dialogue alin', async ({ page }) => {
  await startRun(page);
  await markGateOpen(page);
  await climbTo(page, 2);
  await setX(page, 480);
  await page.keyboard.press('E');
  await page.waitForTimeout(900);
  await shot(page, '06-dialogue-alin');
});

// ── 07 交易 ──────────────────────────────────────────────────────────────
test('07 trade', async ({ page }) => {
  await startRun(page);
  await markGateOpen(page);
  await climbTo(page, 2);
  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { inventory: { slots: Array<{ itemId: string; quantity: number }> } } } | null } })
      .__PHASER_SESSION__?.getState() as { player: { inventory: { slots: Array<{ itemId: string; quantity: number }> } } } | null;
    s?.player.inventory.slots.push({ itemId: 'scrap_metal', quantity: 3 });
  });
  await setX(page, 480);
  await page.keyboard.press('E');
  await page.waitForTimeout(700);
  // 下到「交易」再确认
  for (let i = 0; i < 3; i++) {
    const label = await page.evaluate(() => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean; y: number; texture?: { key?: string } }> } } | null } } }).__PHASER_GAME__;
      const list = g?.scene.getScene('Game')?.children.list ?? [];
      const marker = list.find((o) => o.type === 'Image' && o.texture?.key === 'ui-marker' && o.visible);
      if (!marker) return '';
      const hit = list.find((o) => o.type === 'Text' && o.visible && Math.abs(o.y - marker.y) <= 6 && (o as unknown as { depth: number }).depth >= 190);
      return hit?.text ?? '';
    });
    if (label.includes('交易')) break;
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(180);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  await shot(page, '07-trade-menu');
});

// ── 08 HUD 全貌（第 3 层：昼夜 + 目标 + 楼层变化都在） ──────────────────
test('08 hud overview', async ({ page }) => {
  await startRun(page);
  await markGateOpen(page);
  await climbTo(page, 3);
  await setX(page, 640);
  await shot(page, '08-hud-floor-3');
});

// ── 09 手机竖屏 ──────────────────────────────────────────────────────────
test('09 portrait phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?seed=42&debug=1');
  await waitForScene(page, 'Menu');
  await page.waitForTimeout(900);
  await shot(page, '09-portrait-title');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  await shot(page, '09b-portrait-game');
  // HUD 与背包在竖屏的表现
  await page.keyboard.press('I');
  await page.waitForTimeout(700);
  await shot(page, '09c-portrait-inventory');
});

// ── 10 夜间（A3-04 昼夜清晰度取证） ────────────────────────────────────
test('10 night', async ({ page }) => {
  await startRun(page);
  await markGateOpen(page);
  await climbTo(page, 2);
  await setX(page, 640);
  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { gameMinuteOfDay: number } | null } })
      .__PHASER_SESSION__?.getState();
    if (s) s.gameMinuteOfDay = 1230; // 20:30
  });
  await page.waitForTimeout(1200);
  await shot(page, '10-night-floor-2');
});

// ── 11 危重状态（低血 + 饥渴） ─────────────────────────────────────────
test('11 critical stats', async ({ page }) => {
  await startRun(page);
  await page.evaluate(() => {
    const s = (window as unknown as {
      __PHASER_SESSION__?: { getState: () => { player: { hp: number; hunger: number; thirst: number; energy: number } } | null };
    }).__PHASER_SESSION__?.getState();
    if (!s) return;
    s.player.hp = 14;
    s.player.hunger = 8;
    s.player.thirst = 5;
    s.player.energy = 22;
  });
  await page.waitForTimeout(900);
  await shot(page, '11-critical-hud');
});

// ── 12 赠礼列表（二级界面） ────────────────────────────────────────────
test('12 gift list', async ({ page }) => {
  await startRun(page);
  await markGateOpen(page);
  await climbTo(page, 2);
  await page.evaluate(() => {
    const s = (window as unknown as {
      __PHASER_SESSION__?: { getState: () => { player: { inventory: { slots: Array<{ itemId: string; quantity: number }> } } } | null };
    }).__PHASER_SESSION__?.getState();
    s?.player.inventory.slots.push({ itemId: 'tape', quantity: 2 });
    s?.player.inventory.slots.push({ itemId: 'cloth', quantity: 3 });
  });
  await setX(page, 480);
  await page.keyboard.press('E');
  await page.waitForTimeout(700);
  await page.keyboard.press('Enter'); // 选项 0 = 赠礼
  await page.waitForTimeout(700);
  await shot(page, '12-gift-list');
});

// ── 13 背包塞满 12/12 ─────────────────────────────────────────────────
test('13 inventory full', async ({ page }) => {
  await startRun(page);
  await page.evaluate(() => {
    const s = (window as unknown as {
      __PHASER_SESSION__?: { getState: () => { player: { inventory: { slots: Array<{ itemId: string; quantity: number }> } } } | null };
    }).__PHASER_SESSION__?.getState();
    if (!s) return;
    const slots = s.player.inventory.slots;
    const ids = ['scrap_metal', 'wire', 'cloth', 'battery', 'tape', 'wood', 'filter', 'dirty_water', 'bread', 'fuse', 'medkit', 'crowbar'];
    while (slots.length < 12) slots.push({ itemId: ids[slots.length % ids.length], quantity: 1 });
  });
  await page.waitForTimeout(400);
  await page.keyboard.press('I');
  await page.waitForTimeout(700);
  await shot(page, '13-inventory-full');
});