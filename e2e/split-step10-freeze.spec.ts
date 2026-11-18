import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

// RC-03 拆分第 10 步（InteractionController：交互逻辑本体）一次性冻结探针。
// 设计文档最后一步——输入链最杂的一步，冻结覆盖全交互链：
//
// 目的：把交互域的全部成果在「迁入 InteractionController 之前/之后」各跑一遍
// 同 seed 同操作链，逐节点对比：
//   A. 截图像素 diff——三区：特写面板区（760x470 居中）/ 入夜面板区
//      （460x252 居中）/ 夜间安排面板区（500x300 居中）0 差异；世界区与两个
//      2s 动作中节点（挖掘/床铺搜刮的 busy 稳定态）低于同代码两跑基线；
//   B. 行为契约机读——scene.pendingAction（2s 动作起了没有，ag50/
//      survivalJourney 同款直读）、scene.activeObstacleList/floorObstacles
//      （ag66 同款名册直读）、scene.bunkObjs（ag51 同款）、三面板的具名
//      可见文本、hud-hint 底栏链（挖掘中/翻找床垫中……）。
//
// 冻结协议 = split-step8/step9 的 AG-98 冻法逐字复用（快照 → 回滚 day=1/
// 06:00/activeEvent=null → 钉 time.now → 停 timer/tween → update(0,0) 落定 →
// 相机停跟随收敛 → 精灵钉第 0 帧 → events.off('update') → 250ms 读回校验
// → 截图 → 解冻）。2s 动作中的节点：动作已起（delayedCall 在跑），冻结的
// removeAllEvents 摘掉 timer——动作永远不再落地，busy 态因此是稳定态。
//
// 用法（server 先起，端口取 STEP10_PORT，默认 5259）：
//   STEP10_OUT=/path/to/dir STEP10_TAG=baseline \
//     npx playwright test --config=e2e/playwright.step10.config.ts --workers=1
// 输出：$STEP10_OUT/{screenshots/$STEP10_TAG-*.png,evidence.json}。
// 迁前基线：cccef3c 的 baseline worktree 起 5260，同 spec 同 STEP10_TAG。

const OUT = process.env.STEP10_OUT ?? 'D:/ZYY_Inovation/game/tmp/qa-evidence/split-step10/run';
const TAG = process.env.STEP10_TAG ?? 'run';

interface State {
  currentFloor: number;
  day: number;
  gameMinuteOfDay: number;
  player: { x: number; hp: number; gold: number; inventory: { slots: Array<{ itemId: string; quantity: number }> } };
  worldEvents?: { activeEvent: unknown };
}

interface InteractionSnapshot {
  pendingAction: boolean;
  activeObstacleXs: number[];
  floorObstacleXs: number[];
  bunkCount: number;
  hudHint: string;
  hudFeedback: string;
  visibleTexts: string[];
}

interface NodeResult {
  node: string;
  snapshot: InteractionSnapshot;
}

const results: NodeResult[] = [];

async function shot(page: Page, name: string): Promise<void> {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('no canvas');
  await page.screenshot({
    path: `${OUT}/screenshots/${TAG}-${name}.png`,
    clip: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
  });
}

// ── 页面助手（与 e2e/split-step9-freeze.spec.ts 同一套成熟套路） ──────────

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === k);
    },
    key,
    { timeout: 30_000 },
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

async function hudText(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const g = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ name?: string; text?: string }> } } | null } };
    }).__PHASER_GAME__;
    const o = g?.scene.getScene('Game')?.children.list.find((x) => x.name === n);
    return o?.text ?? '';
  }, name);
}

/** 场景私有字段的只读快照（交互链契约面——迁前迁后同名同义）。 */
async function interactionSnapshot(page: Page): Promise<InteractionSnapshot> {
  return page.evaluate(() => {
    interface Obj { type: string; name?: string; text?: string; visible: boolean }
    const g = (window as unknown as {
      __PHASER_GAME__?: {
        scene: {
          getScene: (k: string) => {
            children: { list: Obj[] };
            pendingAction?: unknown;
            activeObstacleList?: Array<{ x: number }>;
            floorObstacles?: Array<{ x: number }>;
            bunkObjs?: Map<string, unknown>;
          } | null;
        };
      };
    }).__PHASER_GAME__;
    const scene = g?.scene.getScene('Game');
    const list = scene?.children.list ?? [];
    return {
      pendingAction: !!scene?.pendingAction,
      activeObstacleXs: (scene?.activeObstacleList ?? []).map((o) => o.x),
      floorObstacleXs: (scene?.floorObstacles ?? []).map((o) => o.x),
      bunkCount: scene?.bunkObjs?.size ?? -1,
      hudHint: list.find((o) => o.name === 'hud-hint')?.text ?? '',
      hudFeedback: list.find((o) => o.name === 'hud-feedback')?.text ?? '',
      visibleTexts: list.filter((o) => o.type === 'Text' && o.visible && (o.text ?? '').length > 0).map((o) => o.text ?? ''),
    };
  });
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

/** 按 E 直到条件成立（显式目标，不写相对条件）。 */
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

// ── 冻结协议（split-step9 逐字复用） ───────────────────────────────────────

async function freezeAndShoot(page: Page, name: string): Promise<InteractionSnapshot> {
  await page.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => unknown | null } } }).__PHASER_GAME__;
    const s = g?.scene.getScene('Game') as Record<string, never> | null;
    const session = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (!s) return;
    (window as unknown as { __STATE_SNAPSHOT__?: unknown }).__STATE_SNAPSHOT__ = session ? JSON.parse(JSON.stringify(session)) : null;
  });
  await page.evaluate(() => {
    const game = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => Record<string, never>; getScenes: (r?: boolean) => Array<Record<string, never>> } } }).__PHASER_GAME__;
    const s = game?.scene.getScene('Game');
    const session = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (!s) return;
    const snap = (window as unknown as { __STATE_SNAPSHOT__?: Record<string, unknown> | null }).__STATE_SNAPSHOT__;
    const sess = session as unknown as Record<string, unknown> | null;
    if (sess && snap) {
      for (const k of Object.keys(snap)) {
        const v = snap[k];
        const cur = sess[k];
        if (v && typeof v === 'object' && cur && typeof cur === 'object') Object.assign(cur, v);
        else sess[k] = v;
      }
      sess.day = 1;
      sess.gameMinuteOfDay = 360;
      const we = sess.worldEvents as { activeEvent?: unknown } | undefined;
      if (we) we.activeEvent = null;
      const pl = sess.player as { hunger?: number; thirst?: number; energy?: number } | undefined;
      if (pl) {
        pl.hunger = 65;
        pl.thirst = 64;
        pl.energy = 79;
      }
    }
    (s.refreshStats as (() => void) | undefined)?.();
    (s.refreshClock as (() => void) | undefined)?.();
    const time = s.time as { now: number; removeAllEvents: () => void };
    time.now = 1000;
    time.removeAllEvents();
    (s.update as (t: number, d: number) => void)(0, 0);
    (s.writeCameraShakeOffset as ((x: number, y: number) => void) | undefined)?.(0, 0);
    (s.setMonsterBreathing as ((on: boolean) => void) | undefined)?.(false);
    const cam = (s.cameras as { main: { stopFollow: () => void; centerOn: (x: number, y: number) => void } }).main;
    cam.stopFollow();
    cam.centerOn(session?.player?.x ?? 0, (s.player as { y: number } | undefined)?.y ?? 0);
    (s.tweens as { killAll: () => void }).killAll();
    const lightLayer = s.lightLayer as { update?: (t: number) => void } | undefined;
    lightLayer?.update?.(0);
    const pin = (list: Array<{ type: string; anims?: { stop: () => void }; setFrame?: (f: number) => void; list?: unknown[] }>): void => {
      for (const o of list ?? []) {
        if (o.type === 'Sprite' && o.anims) {
          o.anims.stop();
          o.setFrame?.(0);
        }
        if (o.type === 'Container' && o.list) pin(o.list as Array<{ type: string; anims?: { stop: () => void }; setFrame?: (f: number) => void }>);
      }
    };
    for (const sc of game!.scene.getScenes(true)) pin((sc.children as { list: Array<{ type: string; anims?: { stop: () => void }; setFrame?: (f: number) => void }> }).list);
    (s.events as { off: (e: string) => void }).off('update');
  });
  await page.waitForTimeout(250);
  await shot(page, name);
  const snapshot = await interactionSnapshot(page);
  await page.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { events: { on: (e: string, fn: unknown, ctx: unknown) => void }; update: unknown } | null } } }).__PHASER_GAME__;
    const s = g?.scene.getScene('Game');
    if (s) s.events.on('update', s.update, s);
  });
  return snapshot;
}

async function recordNode(page: Page, name: string): Promise<void> {
  const snapshot = await freezeAndShoot(page, name);
  results.push({ node: name, snapshot });
}

// ── 主链：世界 → 特写 → 入夜二选一 → 夜间安排 → 挖掘中 → 床铺搜刮中 ─────────

test('交互链冻结（世界/特写/入夜/夜间安排/挖掘中/床铺搜刮中）', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startGame(page, 42);
  await page.waitForTimeout(800);

  // ① 世界态：楼层世界 + HUD + 底栏（后续各节点的「世界区」基线）。
  await recordNode(page, '00-world');

  // ② L 键 → 墙面档案特写面板（760x470 居中，1:1 墙饰 + 文案列）。
  await page.keyboard.press('L');
  await page.waitForTimeout(300);
  await expect.poll(() => hasVisibleText(page, '墙面档案'), { timeout: 5000 }).toBe(true);
  await recordNode(page, '10-deco');

  // ③ → 翻页 → 第 2 件墙饰（同一面板重建，页码文案变；← 在首页会环游到
  //    末件，故用 →）。
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  await expect.poll(() => hasVisibleText(page, '2 / 8'), { timeout: 5000 }).toBe(true);
  await recordNode(page, '11-deco-page');

  // ④ 上 2 层 + 时钟推到 17:55 → 帧循环跨过 18:00 弹入夜二选一
  //    （460x252 居中；只在外层、只一次/夜——AG-64 既有边沿）。
  await page.keyboard.press('L'); // 合特写
  await page.waitForTimeout(200);
  await setX(page, 40);
  await pressEUntil(page, async () => (await readState(page)).currentFloor === 2);
  await setMinute(page, 1075);
  await expect.poll(() => hasVisibleText(page, '天黑了，楼里不会只有你一个人。'), { timeout: 20_000 }).toBe(true);
  await page.waitForTimeout(200);
  await recordNode(page, '20-night-choice');

  // ⑤ ↓ 选中「在家守夜」（高亮 wash + 左竖线 + 箭头移位）。
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(250);
  await recordNode(page, '21-night-watch');

  // ⑥ ESC 暂拒 → 回 1 层 → 20:00 后对自己的床按 E → 夜间安排面板
  //    （500x300 居中；attemptSleep 的 20:00 门禁 + openShelter）。
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await setX(page, 1240);
  await pressEUntil(page, async () => (await readState(page)).currentFloor === 1);
  await setMinute(page, 1200);
  await setX(page, 1120); // BED_X 自己的床
  // 底栏世界链是 NavBar 的 contextual 数据源（hud-hint 状态对象，不可见）——
  // 提示文案按文本读，不按可见性读（同 ag66/ag51 的 hudText 口径）。
  await expect.poll(() => hudText(page, 'hud-hint'), { timeout: 5000 }).toBe('按 E 安排夜间行动');
  await page.keyboard.press('E');
  await expect.poll(() => hasVisibleText(page, '夜间安排 · 宿舍'), { timeout: 5000 }).toBe(true);
  await page.waitForTimeout(200);
  await recordNode(page, '30-shelter');

  // ⑦ 上 2 层 + 塞铲子 + 对瓦砾按 E → 2s 挖掘动作中（busy 稳定态：
  //    search clip 在播、底栏「挖开瓦砾中……」、阻碍物还在、名册未清）。
  await page.keyboard.press('Escape'); // 合夜间安排
  await page.waitForTimeout(200);
  await setX(page, 40);
  await pressEUntil(page, async () => (await readState(page)).currentFloor === 2);
  await giveItem(page, 'shovel', 1);
  const roster = await interactionSnapshot(page);
  const rubbleX = roster.activeObstacleXs[0];
  expect(rubbleX, '2 层应有未挖阻碍物').toBeGreaterThan(0);
  await setX(page, rubbleX - 32);
  await expect.poll(() => hudText(page, 'hud-hint'), { timeout: 5000 }).toBe('按 E 挖开这堆瓦砾');
  await page.keyboard.press('E');
  await page.waitForTimeout(350);
  await expect.poll(() => hudText(page, 'hud-hint'), { timeout: 5000 }).toBe('挖开瓦砾中……');
  await recordNode(page, '40-dig-mid');

  // ⑧ 收手（E = 取消动作）→ 回 1 层 → 对室友床按 E → 2s 床铺搜刮中
  //    （同一 busy 稳定态，床铺域）。
  await page.keyboard.press('E'); // pendingAction 分支 = 收手
  await page.waitForTimeout(250);
  await setX(page, 1240);
  await pressEUntil(page, async () => (await readState(page)).currentFloor === 1);
  await setX(page, 236); // 前排室友床（dorm_bed_1_236）
  await expect.poll(() => hudText(page, 'hud-hint'), { timeout: 5000 }).toBe('按 E 搜刮床铺');
  await page.keyboard.press('E');
  await page.waitForTimeout(350);
  await expect.poll(() => hudText(page, 'hud-hint'), { timeout: 5000 }).toBe('翻找床垫中……');
  await recordNode(page, '50-bunk-mid');

  // ── 行为断言（两跑都必须过的契约面） ──
  const deco = results.find((r) => r.node === '10-deco')!.snapshot;
  expect(deco.visibleTexts, '特写面板标题').toContain('墙面档案');
  expect(deco.visibleTexts, '页码 1/8').toContain('1 / 8');
  const decoPage = results.find((r) => r.node === '11-deco-page')!.snapshot;
  expect(decoPage.visibleTexts, '翻页后 2/8').toContain('2 / 8');

  const night = results.find((r) => r.node === '20-night-choice')!.snapshot;
  expect(night.visibleTexts, '入夜面板标题').toContain('入夜 · 宿舍外');
  expect(night.visibleTexts, '两个选项卡').toContain('出去找物资');
  expect(night.visibleTexts).toContain('在家守夜');

  const shelter = results.find((r) => r.node === '30-shelter')!.snapshot;
  expect(shelter.visibleTexts, '夜间安排面板标题').toContain('夜间安排 · 宿舍');
  expect(shelter.visibleTexts.some((t) => t.startsWith('压力 ')), '压力行').toBe(true);

  const dig = results.find((r) => r.node === '40-dig-mid')!.snapshot;
  expect(dig.pendingAction, '挖掘动作进行中（scene.pendingAction 契约）').toBe(true);
  expect(dig.hudHint, '底栏 busy 文案').toBe('挖开瓦砾中……');
  expect(dig.activeObstacleXs, '挖之前名册还在').toContain(rubbleX);
  expect(dig.floorObstacleXs, '全集含残骸位').toContain(rubbleX);

  const bunk = results.find((r) => r.node === '50-bunk-mid')!.snapshot;
  expect(bunk.pendingAction, '床铺搜刮动作进行中').toBe(true);
  expect(bunk.hudHint, '底栏 busy 文案').toBe('翻找床垫中……');
  expect(bunk.bunkCount, '室友床铺对象簿记（ag51 契约）').toBeGreaterThan(0);

  // 世界节点无动作、无面板（各忙态节点之间的对照）。
  const world = results.find((r) => r.node === '00-world')!.snapshot;
  expect(world.pendingAction, '世界态无进行中动作').toBe(false);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── 证据落盘 ─────────────────────────────────────────────────────────────

test.afterAll(() => {
  mkdirSync(`${OUT}/screenshots`, { recursive: true });
  writeFileSync(`${OUT}/evidence.json`, JSON.stringify({ tag: TAG, results }, null, 2));
});
