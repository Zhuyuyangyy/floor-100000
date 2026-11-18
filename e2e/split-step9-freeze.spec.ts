import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

// RC-03 拆分第 9 步（HudController：HUD 顶带 + 背包面板）一次性冻结探针。
//
// 目的：把 HUD/背包域的全部成果在「迁入 HudController 之前/之后」各跑一遍
// 同 seed 同操作链，逐节点对比：
//   A. 截图像素 diff——四区：世界区 / HUD 带（0..102）/ 圆环区（284..922 ×
//      0..51，AG-102 RenderTexture 预烘焙，冻结标准最高）/ 背包面板区
//      （880x360 居中，AG-60 放大改版）+ 低血红环冻结点（hp=15 时圆环
//      危险红 + 暗角边带）；
//   B. 行为契约机读——全部 hud-* 具名文本（四联数值/标签/楼层/时钟/金币/
//      分数/目标/环境四 chip）、背包开合态（scene.inventoryOpen，e2e 六处
//     直读的契约 getter）、满包预警行（hud-bag-full 可见 + 带计数文案）、
//     选中态与详情三行、F3 计数器与拾取飘字委托链不断（第 4 步 PerfController）；
//   C. AG-102 纪律（仅迁后可见）——scene.hud.ringRedrawCount：数值变化才
//      重烤，同键不重烤。
//
// 冻结协议 = split-step8 的 AG-98 冻法逐字复用（快照 → 回滚 day=1/06:00/
// activeEvent=null → 钉 time.now → 停 timer/tween → update(0,0) 落定 →
// 相机停跟随收敛 → 精灵钉第 0 帧 → events.off('update') → 250ms 读回校验
// → 截图 → 解冻）。
//
// 用法（server 先起，端口取 config 的 baseURL）：
//   STEP9_OUT=/path/to/dir STEP9_TAG=baseline \
//     npx playwright test --config=e2e/playwright.step9.config.ts --workers=1
// 输出：$STEP9_OUT/{screenshots/$STEP9_TAG-*.png,evidence.json}。

const OUT = process.env.STEP9_OUT ?? 'D:/ZYY_Inovation/game/tmp/qa-evidence/split-step9/run';
const TAG = process.env.STEP9_TAG ?? 'run';

interface State {
  currentFloor: number;
  day: number;
  gameMinuteOfDay: number;
  player: {
    x: number;
    hp: number;
    gold: number;
    inventory: { slots: Array<{ itemId: string; quantity: number }>; slotCount: number };
  };
  worldEvents?: { activeEvent: unknown };
}

interface HudSnapshot {
  inventoryOpen: boolean;
  hudTexts: Record<string, string>;
  bagFull: { visible: boolean; text: string };
  ringRedraws: number | null;
  lastStatsKey: string | null;
  bagWarningShown: boolean | null;
  floatTexts: { created: number; active: number } | null;
  fpsVisible: boolean;
}

interface NodeResult {
  node: string;
  snapshot: HudSnapshot;
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

// ── 页面助手（与 e2e/split-step8-freeze.spec.ts 同一套成熟套路） ──────────

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

async function pushItem(page: Page, itemId: string, quantity: number): Promise<void> {
  await page.evaluate(([id, q]) => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    s?.player.inventory.slots.push({ itemId: id as string, quantity: q as number });
  }, [itemId, quantity] as const);
}

async function setHp(page: Page, hp: number): Promise<void> {
  await page.evaluate((v) => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (s) s.player.hp = v;
  }, hp);
}

async function isBagOpen(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { inventoryOpen?: boolean } | null } } }).__PHASER_GAME__?.scene.getScene('Game')?.inventoryOpen === true);
}

/** I 键开关背包（验证-重试式：冻结解冻后偶发按键被吞，blind press 会漂移）。 */
async function setBagOpen(page: Page, want: boolean): Promise<void> {
  for (let i = 0; i < 6; i++) {
    if (await isBagOpen(page) === want) return;
    await page.keyboard.press('I');
    await page.waitForTimeout(250);
  }
  throw new Error(`bag open=${want} did not take effect`);
}

async function waitBagCount(page: Page, count: number): Promise<void> {
  await page.waitForFunction(
    (n) => {
      const list = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean }> } } | null } } }).__PHASER_GAME__?.scene.getScene('Game')?.children.list ?? [];
      return list.some((o) => o.type === 'Text' && o.visible && (o.text ?? '') === `${n}/12`);
    },
    count,
    { timeout: 8000 },
  );
}

/** HUD/背包域的机读契约面：全部具名 hud-* 文本 + 开合态 + 预警行 + 探针读数。 */
async function hudSnapshot(page: Page): Promise<HudSnapshot> {
  return page.evaluate(() => {
    interface Obj { type: string; name?: string; text?: string; visible: boolean }
    const g = (window as unknown as {
      __PHASER_GAME__?: {
        scene: {
          getScene: (k: string) => {
            children: { list: Obj[] };
            inventoryOpen?: boolean;
            hud?: { ringRedrawCount?: number; lastStatsKey?: string; bagWarningShown?: boolean };
            perf?: { floatTextCounts?: { created: number; active: number } };
          } | null;
        };
      };
    }).__PHASER_GAME__;
    const scene = g?.scene.getScene('Game');
    const list = scene?.children.list ?? [];
    const hudTexts: Record<string, string> = {};
    for (const o of list) {
      if (o.type === 'Text' && o.visible && typeof o.name === 'string' && o.name.startsWith('hud-')) {
        hudTexts[o.name] = o.text ?? '';
      }
    }
    const bag = list.find((o) => o.type === 'Text' && o.name === 'hud-bag-full');
    return {
      inventoryOpen: scene?.inventoryOpen === true,
      hudTexts,
      bagFull: { visible: bag?.visible === true, text: bag?.text ?? '' },
      // AG-102 纪律（仅迁后可见；基线场景无 hud 面，读数为 null）。
      ringRedraws: scene?.hud?.ringRedrawCount ?? null,
      lastStatsKey: scene?.hud?.lastStatsKey ?? null,
      bagWarningShown: scene?.hud?.bagWarningShown ?? null,
      floatTexts: scene?.perf?.floatTextCounts ?? null,
      fpsVisible: list.some((o) => o.type === 'Text' && o.name === 'hud-fps' && o.visible),
    };
  });
}

// ── 冻结协议（split-step8 逐字复用） ───────────────────────────────────────

async function freezeAndShoot(page: Page, name: string): Promise<HudSnapshot> {
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
      // 四联数值钉住：生存衰减随真实帧推进，两跑之间会漂 1 点（实测 hunger
      // 65→64——圆环区/HUD 带「0 差异」的判据要求数值逐字一致）。hp 不 pin：
      // 低血节点由 setHp(15) 经快照带回来（早节点是起始 100），钉它会把低血
      // 红环节点一起钉掉。
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
    // 相机钉住：startFollow 的 0.15 lerp 在冻结时刻处于实时相位，roundPixels
    // 的取整翻转会把整个画面移 1px（两跑全画面 diff 的元凶）。停跟随 +
    // centerOn 到角色 = 跟随收敛后的同一位置（bounds 钳制同口径）。
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
  // 契约读数在解冻之前抓——与截图严格同帧。解冻后实时计时器会动（教程跳过
  // 按钮的显隐竞态实测撞过：像素同时刻一致、读数晚 100ms 就翻面）。
  const snapshot = await hudSnapshot(page);
  // 解冻：Phaser 4 的 Systems.step 经 scene.events 派发 UPDATE——off('update')
  // 冻住它，on 回去还场景续命，否则下一节点的键盘交互全部落空。
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

// ── 主链：世界 → 背包开 → 选中 → 物品刷新 → 低血红环 → 满包预警 → 关包回世界 ──

test('HUD/背包链冻结（世界/开格/选中/物品/低血红环/满预警/关包）', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startGame(page, 42);
  await page.waitForTimeout(800);

  // ① 世界态：HUD 顶带（四联圆环 + 数值/目标/环境行）+ 底栏 + 角色卡。
  await recordNode(page, '00-world');

  // ② I 开背包（AG-60 放大面板：880x360 / 76px 格 / 14 格）。
  await setBagOpen(page, true);
  await page.waitForTimeout(300);
  await recordNode(page, '10-bag-open');

  // ③ ↓↓ 选中第 3 格（起始 3 件：净水/口粮/手电）——详情三行随选中切。
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(120);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  await recordNode(page, '11-bag-selected');

  // ④ 推 2 个栈（面包×2 + 废金属×1）→ 关开一次触发 refreshInventory
  //    （推物品本身不刷面板——与世界链同口径：刷新由动作触发，不每帧；
  //    起始 3 格 + 2 栈 = 5/12）。
  await pushItem(page, 'bread', 2);
  await pushItem(page, 'scrap_metal', 1);
  await setBagOpen(page, false);
  await setBagOpen(page, true);
  await waitBagCount(page, 5);
  await page.waitForTimeout(200);
  await recordNode(page, '12-bag-items');

  // ⑤ I 关包（收尾态：HUD 带照常）。低血/满预警两个帧循环驱动的节点必须
  //    在关包态做——开着面板时 update 的世界链段整段早退（既有行为：
  //    refreshStats/refreshBagFullWarning 都在早退之后），圆环数值不刷。
  await setBagOpen(page, false);
  await page.waitForTimeout(300);
  await recordNode(page, '13-bag-closed');

  // ⑥ 低血红环冻结点：hp=15（≤20%）→ 圆环危险红 + 暗角边带（帧循环刷）。
  await setHp(page, 15);
  await page.waitForFunction(
    () => {
      const list = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; name?: string; text?: string; visible: boolean }> } } | null } } }).__PHASER_GAME__?.scene.getScene('Game')?.children.list ?? [];
      return list.some((o) => o.type === 'Text' && o.name === 'hud-value-hp' && o.visible && o.text === '15');
    },
    undefined,
    { timeout: 8000 },
  );
  await page.waitForTimeout(200);
  await recordNode(page, '20-lowhp');

  // ⑦ 塞满 12 格 → hud-bag-full 预警行（带计数 12/12；帧循环刷，关包态也亮——
  //    B3-02 常驻设计）。
  const state = await readState(page);
  for (let i = state.player.inventory.slots.length; i < state.player.inventory.slotCount; i++) {
    await pushItem(page, 'bread', 1);
  }
  await page.waitForFunction(
    () => {
      const list = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; name?: string; text?: string; visible: boolean }> } } | null } } }).__PHASER_GAME__?.scene.getScene('Game')?.children.list ?? [];
      return list.some((o) => o.type === 'Text' && o.name === 'hud-bag-full' && o.visible);
    },
    undefined,
    { timeout: 8000 },
  );
  await page.waitForTimeout(200);
  await recordNode(page, '30-bag-full');

  // ⑧ 低血 + 满包 + 开背包三态叠加（AG-102 圆环危险红穿过半透明面板 +
  //    暗角边带 + 预警行 + AG-60 面板同屏）——冻结标准最高的合成节点。
  await setBagOpen(page, true);
  await page.waitForTimeout(300);
  await recordNode(page, '41-lowhp-bag');

  // ── 行为断言（两跑都必须过的契约面） ──
  const open = results.find((r) => r.node === '10-bag-open')!.snapshot;
  expect(open.inventoryOpen, '背包开着').toBe(true);
  expect(open.hudTexts['hud-floor'], '楼层徽章').toMatch(/^第\d+层$/);
  for (const key of ['hp', 'hunger', 'thirst', 'energy']) {
    expect(open.hudTexts[`hud-stat-${key}`], `hud-stat-${key} 标签`).toBeTruthy();
    expect(open.hudTexts[`hud-value-${key}`], `hud-value-${key} 数值`).toMatch(/^[0-9]+$/);
  }
  expect(open.hudTexts['hud-goal'], '目标行').toContain('目标');
  expect(open.hudTexts['hud-environment'], '体温 chip').toMatch(/^体温值/);

  const lowhp = results.find((r) => r.node === '20-lowhp')!.snapshot;
  expect(lowhp.hudTexts['hud-value-hp'], '低血圆环数值').toBe('15');

  const full = results.find((r) => r.node === '30-bag-full')!.snapshot;
  expect(full.bagFull.visible, '满包预警可见（关包态也亮——B3-02 常驻）').toBe(true);
  expect(full.bagFull.text, '预警带计数').toContain('背包已满（12/12）');
  const lowhpBag = results.find((r) => r.node === '41-lowhp-bag')!.snapshot;
  expect(lowhpBag.inventoryOpen, '合成节点：背包开着').toBe(true);
  expect(lowhpBag.bagFull.visible, '开面板后预警行仍在（B3-02 常驻，不随面板显隐）').toBe(true);

  const closed = results.find((r) => r.node === '13-bag-closed')!.snapshot;
  expect(closed.inventoryOpen, '关包').toBe(false);
  expect(closed.bagFull.visible, '未满时预警行不亮').toBe(false);

  // AG-102 纪律（仅迁后可断言；基线无 hud 面时跳过）。
  const withRings = results.filter((r) => r.snapshot.ringRedraws !== null);
  if (withRings.length > 0) {
    // 数值只在 ⑤ 变过一次（hp 100→15；④ 的推物品不动四数值）——圆环重烤
    // 次数应等于「变化次数」，远小于帧数（绝不每帧）。
    const last = withRings[withRings.length - 1].snapshot;
    expect(last.ringRedraws, '圆环只在数值变化时重烤').toBeGreaterThan(0);
    expect(last.ringRedraws!, '重烤次数远小于冻结期间的帧量级').toBeLessThan(10);
  }

  // 委托链不断（第 4 步 PerfController）：F3 计数器可开、飘字池可产字。
  await page.keyboard.press('F3');
  await page.waitForTimeout(200);
  const perf = await hudSnapshot(page);
  expect(perf.fpsVisible, 'F3 计数器（PerfController 链）').toBe(true);
  await page.evaluate(() => {
    const sc = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { spawnFloatText?: (x: number, y: number, t: string, c: string) => void } | null } } }).__PHASER_GAME__?.scene.getScene('Game');
    sc?.spawnFloatText?.(640, 360, '冻结探针', '#ffffff');
  });
  await page.waitForTimeout(120);
  const floats = await hudSnapshot(page);
  expect((floats.floatTexts?.active ?? 0) > 0 || (floats.floatTexts?.created ?? 0) > 0, '拾取飘字委托链（scene→perf 池）').toBe(true);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── 证据落盘 ─────────────────────────────────────────────────────────────

test.afterAll(() => {
  mkdirSync(`${OUT}/screenshots`, { recursive: true });
  writeFileSync(`${OUT}/evidence.json`, JSON.stringify({ tag: TAG, results }, null, 2));
});
