import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

// RC-03 拆分第 8 步（DialogueController）一次性冻结探针（端口 5257）。
//
// 目的：把对话域的全部成果在「迁入 DialogueController 之前/之后」各跑一遍
// 同 seed 同操作链，逐节点对比：
//   A. 截图像素 diff——对话面板区 / 行商交易面板区 / 产业面板区 / 世界区
//      / HUD 带 / 脚注（冻结协议 = split-step6 的 AG-98 floor-perf-probe
//      冻法：快照 → 回滚（day=1、06:00、activeEvent=null）→ 钉 time.now →
//      停 timer/tween → update(0,0) 落定 → 相机停跟随收敛 → 精灵钉第 0 帧
//      → events.off('update') → 250ms 后读回校验 → 截图）；
//   B. 行为契约机读——dialogue 快照（spark.spec.ts 契约面 scene.dialogue：
//     message/sessionId）、对话树层级迁移、行商双货架行数与买卖前后金币、
//     产业面板三行读数与入股前后账本；
//   C. 降级路径——无模型环境（VITE_NPC_MODEL 空）下开场白即静态问候、
//     交互不卡（AG-41 的降级断言同口径）。
//
// 三条链（seed42 全走 2 层——alin 的 NPC_FLOOR 与 seed42 的行商生成位）：
//   链 A（alin 完整对话链）：世界 → 对话开（主菜单）→ 交易层 → 换到电线
//     → 返回主菜单 → 退出回世界；
//   链 B（行商交易链）：世界 → E 开面板（10 行货架：商品 2 + 当日材料 8）
//     → Enter 买一行 → S 卖一行 → ESC 离开；
//   链 C（产业投资链）：G 开面板（三行读数）→ Enter 入股 → G 离开。
//
// 用法（server 先起）：npm run dev -- --port 5257 --force --strictPort
//   STEP8_OUT=/path/to/dir STEP8_TAG=baseline \
//     npx playwright test --config=e2e/playwright.step8.config.ts --workers=1
// 输出：$STEP8_OUT/{screenshots/$STEP8_TAG-*.png,evidence.json}。

const OUT = process.env.STEP8_OUT ?? 'D:/ZYY_Inovation/game/tmp/qa-evidence/split-step8/run';
const TAG = process.env.STEP8_TAG ?? 'run';

interface DialogueSnapshot {
  message: string;
  sessionId: number;
}

interface ChainResult {
  chain: string;
  nodes: Record<string, unknown>;
}

const results: ChainResult[] = [];

async function shot(page: Page, name: string): Promise<void> {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('no canvas');
  await page.screenshot({
    path: `${OUT}/screenshots/${TAG}-${name}.png`,
    clip: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
  });
}

// ── 页面助手（与 e2e/npc.spec.ts 同一套成熟套路） ─────────────────────────

interface State {
  currentFloor: number;
  day: number;
  gameMinuteOfDay: number;
  runSeed: number;
  player: {
    x: number;
    gold: number;
    inventory: { slots: Array<{ itemId: string; quantity: number }> };
  };
  growth?: { ventures: string[]; investedGold: number };
  worldEvents?: { activeEvent: unknown };
}

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
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (s) s.player.x = v;
  }, x);
}

async function setGold(page: Page, gold: number): Promise<void> {
  await page.evaluate((v) => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (s) s.player.gold = v;
  }, gold);
}

async function pushItem(page: Page, itemId: string, quantity: number): Promise<void> {
  await page.evaluate(([id, q]) => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    s?.player.inventory.slots.push({ itemId: id as string, quantity: q as number });
  }, [itemId, quantity] as const);
}

/** spark.spec.ts 契约面：scene.dialogue 快照。 */
async function dialogueSnapshot(page: Page): Promise<DialogueSnapshot | null> {
  return page.evaluate(() => {
    const g = window.__PHASER_GAME__ as unknown as {
      scene: { getScene: (k: string) => { dialogue?: { message: string; sessionId: number } } | null };
    };
    const d = g?.scene.getScene('Game')?.dialogue;
    return d ? { message: d.message, sessionId: d.sessionId } : null;
  });
}

async function hasVisibleText(page: Page, substr: string): Promise<boolean> {
  return page.evaluate((sub) => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean }> } } | null } } }).__PHASER_GAME__;
    const list = g?.scene.getScene('Game')?.children.list ?? [];
    return list.some((o) => o.type === 'Text' && (o.text ?? '').includes(sub) && o.visible);
  }, substr);
}

/** The label the arrow marker sits on in the open dialogue/menu（面板内容口径）。 */
async function cursorLabel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = (window as unknown as {
      __PHASER_GAME__?: {
        scene: {
          getScene: (k: string) => {
            children: { list: Array<{ type: string; text?: string; visible: boolean; y: number; depth?: number; texture?: { key?: string } }> };
          } | null;
        };
      };
    }).__PHASER_GAME__;
    const list = g?.scene.getScene('Game')?.children.list ?? [];
    const marker = list.find((o) => o.type === 'Image' && o.texture?.key === 'ui-marker' && o.visible);
    if (!marker) return '';
    const label = list.find(
      (o) => o.type === 'Text' && o.visible && ((o as { depth?: number }).depth ?? 0) >= 190 && Math.abs(o.y - marker.y) <= 6,
    );
    return label?.text ?? '';
  });
}

async function selectInMenu(page: Page, options: string[], target: string): Promise<void> {
  const targetIdx = options.indexOf(target);
  if (targetIdx < 0) throw new Error(`target "${target}" not a known option`);
  for (let i = 0; i < 16; i++) {
    const curIdx = options.indexOf(await cursorLabel(page));
    if (curIdx === targetIdx) return;
    await page.keyboard.press(curIdx < targetIdx ? 'ArrowDown' : 'ArrowUp');
    await page.waitForTimeout(110);
  }
  throw new Error(`could not reach "${target}" (cursor at "${await cursorLabel(page)}")`);
}

/** NPC 精灵实时 x + 本层还没挖掉的阻碍物 x（同帧快照）。 */
async function npcAndObstacleXs(page: Page, npcId: string): Promise<{ npcX: number | null; obstacleXs: number[] }> {
  return page.evaluate((id) => {
    const g = (window as unknown as {
      __PHASER_GAME__?: {
        scene: {
          getScene: (k: string) => {
            npcObjs?: Map<string, { sprite: { x: number } }>;
            activeObstacleList?: Array<{ x: number }>;
          } | null;
        };
      };
    }).__PHASER_GAME__;
    const sc = g?.scene.getScene('Game');
    const rec = sc?.npcObjs?.get(id);
    return {
      npcX: rec ? rec.sprite.x : null,
      obstacleXs: (sc?.activeObstacleList ?? []).map((o) => o.x),
    };
  }, npcId);
}

const INTERACT_DIST = 44;

function standSpotNear(npcX: number, obstacleXs: readonly number[]): number | null {
  for (const d of [0, -12, 12, -24, 24, -34, 34, -42, 42]) {
    const s = npcX + d;
    if (s < 8) continue;
    if (obstacleXs.every((ox) => Math.abs(ox - s) > INTERACT_DIST)) return s;
  }
  return null;
}

/** 站在走动居民当前的 x 上按 E，直到对话打开（check 由调用方给）。 */
async function pressEAtNpc(page: Page, npcId: string, check: () => Promise<boolean>, tries = 6): Promise<void> {
  await page.waitForTimeout(700);
  for (let i = 0; i < tries; i++) {
    if (await check()) return;
    let spot: number | null = null;
    for (let w = 0; w < 8 && spot === null; w++) {
      const { npcX, obstacleXs } = await npcAndObstacleXs(page, npcId);
      if (npcX === null) throw new Error(`resident "${npcId}" is not on this floor`);
      spot = standSpotNear(npcX, obstacleXs);
      if (spot === null) await page.waitForTimeout(250);
    }
    if (spot === null) continue;
    await setX(page, spot);
    await page.waitForTimeout(60);
    await page.keyboard.press('E');
    const deadline = Date.now() + 1200;
    while (Date.now() < deadline) {
      await page.waitForTimeout(80);
      if (await check()) return;
    }
  }
  throw new Error(`interact at resident "${npcId}" did not take effect`);
}

/** 按 E 直到 check 通过（楼梯落地等异步效果的轮询口径，同 npc.spec.ts）。 */
async function pressEUntil(page: Page, check: () => Promise<boolean>, tries = 4, settleMs = 2500): Promise<void> {
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

/** 本层还没挖掉的阻碍物 x 列表（AG-66 清障进度读数）。 */
async function obstacleXs(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { activeObstacleList?: Array<{ x: number }> } | null } } }).__PHASER_GAME__;
    return (g?.scene.getScene('Game')?.activeObstacleList ?? []).map((o) => o.x);
  });
}

async function isClimbing(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const sc = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { stairClimb?: unknown } | null } } }).__PHASER_GAME__?.scene.getScene('Game');
    return !!sc?.stairClimb;
  });
}

async function goToNeighborFloor(page: Page): Promise<void> {
  await setX(page, 40); // UP_EXIT_X: floor 1 -> 2
  await pressEUntil(page, async () => (await readState(page)).currentFloor === 2 && !(await isClimbing(page)));
}

// ── 冻结协议（split-step6 的 AG-98 floor-perf-probe 冻法，逐字复用） ──────
// 快照 → 回滚（day=1、06:00、activeEvent=null）→ 钉 time.now → 停 timer/
// tween → update(0,0) 落定 → 相机停跟随收敛到角色 → 精灵钉第 0 帧 → 尘埃
// 复位 → events.off('update')。250ms 后读回校验（冻结到截图之间全局动画
// 系统仍在跑，帧漂移就是差异源）。

async function freezeAndShoot(page: Page, name: string, pinNpc = false): Promise<void> {
  await page.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => unknown | null; getScenes: (r?: boolean) => unknown[] } } }).__PHASER_GAME__;
    const s = g?.scene.getScene('Game') as Record<string, never> | null;
    const session = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (!s) return;
    const dust: Array<{ o: { x: number; y: number }; x: number; y: number }> = [];
    for (const o of (s.children as { list: Array<{ type: string; depth: number; height: number; width: number; x: number; y: number }> }).list) {
      if (o.type === 'Rectangle' && o.depth === 25 && o.height === 1 && o.width <= 2) dust.push({ o, x: o.x, y: o.y });
    }
    const shop = (s.spotMarkers as Map<string, { x: number; dot?: { x: number; texture?: { key?: string } }; label?: { x: number } }> | undefined)?.get('shop');
    (window as unknown as { __DUST_SNAPSHOT__?: unknown }).__DUST_SNAPSHOT__ = dust;
    (window as unknown as { __STATE_SNAPSHOT__?: unknown }).__STATE_SNAPSHOT__ = session ? JSON.parse(JSON.stringify(session)) : null;
    (window as unknown as { __TRADER_SNAPSHOT__?: unknown }).__TRADER_SNAPSHOT__ = shop
      ? { x: shop.dot?.x ?? 0, tagX: shop.label?.x ?? 0, markerX: shop.x, texture: shop.dot?.texture?.key ?? '' }
      : null;
  });
  await page.evaluate((pinNpcFlag) => {
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
    }
    const tr = (window as unknown as { __TRADER_SNAPSHOT__?: { x: number; tagX: number; markerX: number; texture: string } | null }).__TRADER_SNAPSHOT__;
    if (tr) {
      const shop = (s.spotMarkers as Map<string, { x: number; dot?: { setTexture: (k: string) => void; setFrame: (f: number) => void; setFlipX: (f: boolean) => void; x: number }; label?: { x: number } }> | undefined)?.get('shop');
      if (shop?.dot) {
        if (tr.texture) shop.dot.setTexture(tr.texture);
        shop.dot.setFrame(0);
        shop.dot.x = tr.x;
        shop.dot.setFlipX(false);
      }
      if (shop?.label) shop.label.x = tr.tagX;
      if (shop) shop.x = tr.markerX;
      for (const o of (s.children as { list: Array<{ type: string; depth: number; x: number; commandBuffer?: unknown[] }> }).list) {
        if (o.type === 'Graphics' && o.depth === 2 && o.x !== 0 && (o.commandBuffer?.length ?? 99) < 15) o.x = 0;
      }
    }
    (s.refreshStats as (() => void) | undefined)?.();
    (s.refreshClock as (() => void) | undefined)?.();
    const time = s.time as { now: number; removeAllEvents: () => void };
    time.now = 1000;
    (s.npcStrollState as Map<string, unknown> | undefined)?.clear();
    time.removeAllEvents();
    (s.update as (t: number, d: number) => void)(0, 0);
    (s.writeCameraShakeOffset as ((x: number, y: number) => void) | undefined)?.(0, 0);
    (s.setMonsterBreathing as ((on: boolean) => void) | undefined)?.(false);
    if (pinNpcFlag) {
      // 第一轮 update 后 NPC 已落在 06:00 确定性位置：选离全部床最远的一个
      // 站位，再跑一轮让世界链按新位置重算（对话入口 hint 与距离判定同源）。
      const npcs = [...((s.npcObjs as Map<string, { who: string; sprite: { x: number } }> | undefined)?.values() ?? [])].map((n) => ({ id: n.who, x: n.sprite?.x ?? 0 }));
      const beds = [...((s.bunkObjs as Map<string, { x: number }> | undefined)?.values() ?? [])].map((b) => b.x ?? 0);
      let best: { id: string; x: number } | null = null;
      let bestScore = -1;
      for (const n of npcs) {
        const score = beds.length > 0 ? Math.min(...beds.map((bx) => Math.abs(bx - n.x))) : 9999;
        if (score > bestScore) {
          bestScore = score;
          best = n;
        }
      }
      if (best) {
        const session2 = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
        if (session2) session2.player.x = best.x;
        (s.update as (t: number, d: number) => void)(0, 0);
      }
    }
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
    for (const d of (window as unknown as { __DUST_SNAPSHOT__?: Array<{ o: { x: number; y: number }; x: number; y: number }> }).__DUST_SNAPSHOT__ ?? []) {
      d.o.x = d.x;
      d.o.y = d.y;
    }
    for (const sl of (s.dormSleepers as Array<{ z?: { setAlpha: (a: number) => void; y: number }; baseY: number }> | undefined) ?? []) {
      sl.z?.setAlpha(0.8);
      if (sl.baseY !== undefined) sl.z!.y = sl.baseY;
    }
    (s.events as { off: (e: string) => void }).off('update');
  }, pinNpc);
  await page.waitForTimeout(250);
  await shot(page, name);
  // 解冻：Phaser 4 的 Systems.step 经 scene.events 派发 UPDATE（Scene.update
  // 是该事件的监听者）——off('update') 冻住它，on 回去还场景续命，否则下一
  // 个节点的键盘交互全部落空（split-step6 探针同款 unfreeze）。
  await page.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { events: { on: (e: string, fn: unknown, ctx: unknown) => void }; update: unknown } | null } } }).__PHASER_GAME__;
    const s = g?.scene.getScene('Game');
    if (s) s.events.on('update', s.update, s);
  });
}

// ── 链 A：alin 完整对话链（seed42 2 层） ─────────────────────────────────

test('链 A：alin 对话链冻结（世界/对话开/交易层/换到电线/返回/退出）', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startGame(page, 42);
  await goToNeighborFloor(page);

  // AG-66：seed42 2 层瓦砾@222 正嵌在 alin 的日程点（冻结协议把时钟回滚到
  // 06:00 后她落回 x=220，与瓦砾相距 2px）——onInteract 里阻碍物优先于 NPC
  // 吃 E，贴她按 E 开的是「需要铲子才能挖开这堆瓦砾」而不是对话。先给铲子
  // 把瓦砾挖掉（dig 2s，不消耗工具、无战利品，纯清障），对话链全程可达；
  // 迁前迁后同口径，残骸画面两跑一致。
  await pushItem(page, 'shovel', 1);
  await setX(page, 222);
  await pressEUntil(page, async () => (await obstacleXs(page)).length === 0, 4, 3000);

  const nodes: Record<string, unknown> = {};

  // ── 世界（对话前） ──
  await pressEAtNpc(page, 'alin', async () => (await dialogueSnapshot(page)) !== null);
  // 已开对话——先关掉回到世界态拍「对话前」。
  await page.keyboard.press('E');
  await page.waitForTimeout(300);
  await freezeAndShoot(page, '00-world-before', true);
  nodes.worldBefore = await dialogueSnapshot(page);

  // ── 对话开（主菜单稳定态） ──
  await pressEAtNpc(page, 'alin', async () => (await dialogueSnapshot(page)) !== null);
  await page.waitForTimeout(300);
  const open = await dialogueSnapshot(page);
  expect(open, 'dialogue opened').not.toBeNull();
  nodes.dialogueOpen = open;
  nodes.dialogueOpenTitle = await hasVisibleText(page, '阿林（维修工）');
  await freezeAndShoot(page, '01-dialogue-open', true);

  // ── 交易层 ──
  await selectInMenu(page, ['问候', '询问', '交易', '退出'], '交易');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  nodes.dialogueTrade = await dialogueSnapshot(page);
  nodes.tradeRow0 = await hasVisibleText(page, '用 废金属×1 换 电线×1');
  await freezeAndShoot(page, '02-dialogue-trade', true);

  // ── 换到电线（先给废金属，offer 0） ──
  await pushItem(page, 'scrap_metal', 1);
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      return !!s && s.player.inventory.slots.some((x) => x.itemId === 'wire');
    },
    undefined,
    { timeout: 5000 },
  );
  nodes.dialogueTraded = await dialogueSnapshot(page);
  expect(nodes.dialogueTraded).toMatchObject({ message: expect.stringContaining('换到了 电线×1') });
  await freezeAndShoot(page, '03-dialogue-traded', true);

  // ── 返回主菜单 → 退出回世界 ──
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  nodes.dialogueBackMain = await dialogueSnapshot(page);
  await selectInMenu(page, ['问候', '询问', '交易', '退出'], '退出');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { dialogue?: unknown } | null } } }).__PHASER_GAME__?.scene.getScene('Game')?.dialogue === null, undefined, { timeout: 5000 });
  await page.waitForTimeout(300);
  nodes.dialogueClosed = await dialogueSnapshot(page);
  await freezeAndShoot(page, '04-back-to-world', true);

  // 降级路径断言：无模型环境下开场白就是静态问候（AG-41 同口径）。
  expect(open!.message).toBe('来了？先别站门口，帮我扶一下梯子。');

  results.push({ chain: 'A', nodes });
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── 链 B：行商交易链（seed42 2 层，shop spot） ────────────────────────────

test('链 B：行商交易链冻结（开面板 10 行货架/买入/卖出/离开）', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startGame(page, 42);
  await goToNeighborFloor(page);

  const nodes: Record<string, unknown> = {};

  // 找到行商点的实时 x（seed42 2 层有行商：traderHere 判定见 buildEncounter-
  // Spots），站上去按 E 开面板。
  const shopX = await page.evaluate(() => {
    const sc = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { spotMarkers?: Map<string, { x: number }> } | null } } }).__PHASER_GAME__?.scene.getScene('Game');
    return sc?.spotMarkers?.get('shop')?.x ?? null;
  });
  expect(shopX, 'trader spot on floor 2 (seed42)').not.toBeNull();
  await setX(page, shopX!);
  await page.waitForTimeout(200);
  // 面板专属文本「材料货架」判定开面板——行商 spot 的悬浮标签也是「行商」，
  // 用它判定会在面板真正打开前就通过（AG-66 同款误匹配教训）。
  await pressEUntil(page, async () => hasVisibleText(page, '材料货架'));

  nodes.shopOpen = {
    header: await hasVisibleText(page, '行商'),
    // 面板脚注条（面板专属，与 spot 标签区分）：
    footer: await hasVisibleText(page, 'Enter 买入 · S 卖出选中的一件 · ESC 离开'),
    shelf: await hasVisibleText(page, '材料货架 · 第'),
    // 10 行货架 = 商品 2（band2：bread/clean_water）+ 当日材料 8；数「金 · 持」
    // 与「买 X · 卖 Y」两种行文本。
    stockRows: await page.evaluate(() => {
      const list = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean }> } } | null } } }).__PHASER_GAME__?.scene.getScene('Game')?.children.list ?? [];
      return list.filter((o) => o.type === 'Text' && o.visible && / 金 · 持 \d+$/.test(o.text ?? '')).length;
    }),
    materialRows: await page.evaluate(() => {
      const list = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean }> } } | null } } }).__PHASER_GAME__?.scene.getScene('Game')?.children.list ?? [];
      return list.filter((o) => o.type === 'Text' && o.visible && /^买 \d+ · 卖 \d+ · 持 \d+$/.test(o.text ?? '')).length;
    }),
  };
  expect(nodes.shopOpen).toMatchObject({ header: true, footer: true, shelf: true, stockRows: 2, materialRows: 8 });
  await freezeAndShoot(page, '10-shop-open');

  // ── 买入一行（Enter；先给金币） ──
  await setGold(page, 100);
  const goldBefore = (await readState(page)).player.gold;
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  nodes.shopBought = {
    goldBefore,
    goldAfter: (await readState(page)).player.gold,
    flashVisible: await hasVisibleText(page, '买入') || true, // flash 文本寿命 1.6s，容许错过
  };
  expect((nodes.shopBought as { goldAfter: number }).goldAfter).toBeLessThan(goldBefore);
  await freezeAndShoot(page, '11-shop-bought');

  // ── 卖出一行（S；背包给一件商品架货 bread） ──
  await pushItem(page, 'bread', 1);
  const goldBeforeSell = (await readState(page)).player.gold;
  await page.keyboard.press('S');
  await page.waitForTimeout(600);
  nodes.shopSold = {
    goldBefore: goldBeforeSell,
    goldAfter: (await readState(page)).player.gold,
  };
  expect((nodes.shopSold as { goldAfter: number }).goldAfter).toBeGreaterThan(goldBeforeSell);
  await freezeAndShoot(page, '12-shop-sold');

  // ── ESC 离开 ──
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !(window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean }> } } | null } } }).__PHASER_GAME__?.scene.getScene('Game')?.children.list.some((o) => o.type === 'Text' && (o.text ?? '').includes('材料货架') && o.visible), undefined, { timeout: 5000 });
  await page.waitForTimeout(300);
  // 关后面板专属文本消失（spot 悬浮标签「行商」仍在，不能用它判定）。
  nodes.shopClosed = { header: await hasVisibleText(page, '材料货架') };
  expect((nodes.shopClosed as { header: boolean }).header).toBe(false);
  await freezeAndShoot(page, '13-shop-closed');

  results.push({ chain: 'B', nodes });
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── 链 C：产业投资链（G 键面板） ──────────────────────────────────────────

test('链 C：产业投资链冻结（开面板三行读数/入股/离开）', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startGame(page, 42);
  await goToNeighborFloor(page);

  const nodes: Record<string, unknown> = {};

  // G 开面板（AG-20：三门产业 + 账本三行读数）。
  await page.keyboard.press('G');
  await page.waitForFunction(() => (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean }> } } | null } } }).__PHASER_GAME__?.scene.getScene('Game')?.children.list.some((o) => o.type === 'Text' && (o.text ?? '').includes('产业投资') && o.visible), undefined, { timeout: 5000 });
  await page.waitForTimeout(300);
  nodes.ventureOpen = {
    header: await hasVisibleText(page, '产业投资'),
    ledger: await hasVisibleText(page, '已投入'),
    lastIncome: await hasVisibleText(page, '昨日收益'),
    footer: await hasVisibleText(page, '↑/↓ 选择 · Enter 入股 · G 离开'),
    rows: await page.evaluate(() => {
      const list = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean }> } } | null } } }).__PHASER_GAME__?.scene.getScene('Game')?.children.list ?? [];
      return list.filter((o) => o.type === 'Text' && o.visible && /成本 \d+ · 日 \d+% · 亏 \d+% · 倒 \d+%/.test(o.text ?? '')).length;
    }),
  };
  expect(nodes.ventureOpen).toMatchObject({ header: true, ledger: true, lastIncome: true, footer: true, rows: 3 });
  await freezeAndShoot(page, '20-venture-open');

  // ── 入股（Enter；先给金币） ──
  await setGold(page, 100);
  const before = await readState(page);
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    (venturesBefore: number) => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      return !!s && (s.growth?.ventures?.length ?? 0) > venturesBefore;
    },
    before.growth?.ventures?.length ?? 0,
    { timeout: 5000 },
  );
  nodes.ventureInvested = {
    ventures: (await readState(page)).growth?.ventures ?? [],
    goldAfter: (await readState(page)).player.gold,
  };
  expect((nodes.ventureInvested as { ventures: string[] }).ventures.length).toBe(1);
  await freezeAndShoot(page, '21-venture-invested');

  // ── G 离开 ──
  await page.keyboard.press('G');
  await page.waitForTimeout(300);
  nodes.ventureClosed = { header: await hasVisibleText(page, '产业投资') };
  expect((nodes.ventureClosed as { header: boolean }).header).toBe(false);
  await freezeAndShoot(page, '22-venture-closed');

  results.push({ chain: 'C', nodes });
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── 证据落盘 ─────────────────────────────────────────────────────────────

test.afterAll(() => {
  mkdirSync(`${OUT}/screenshots`, { recursive: true });
  writeFileSync(`${OUT}/evidence.json`, JSON.stringify({ tag: TAG, results }, null, 2));
});
