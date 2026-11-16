import { expect, test, type Page } from '@playwright/test';

// M1 导航兜底（AG-02）。四个性质全部通过 dev-only 手柄实测，不靠肉眼：
//
//  1. 攀爬动画全程，角色的 getBounds()（世界坐标）叠加相机 scrollY/zoom 后
//     完整落在视口内 —— 底层 1→2 上行与顶层 50010→50009 下行是两个塔沿用例
//     （段中楼层的 bounds 有余量，只有两个塔沿会裁切）。
//  2. 攀爬未结束或面板开着时，重复按 F 不会重复扣费、不会重复换层。
//  3. 近路面板价 = 落地闪存价 = 实际扣费（同一个 shortcutPlan 出来）。
//  4. 段顶楼梯口拒绝时给出"要乘货运电梯"的明确文案，而不是笼统的"已到顶层"。
//
// 相机数字来自 Phaser 的 getBounds()（世界空间，见 GetBounds.js：不含相机
// 变换），再按 screenY = (worldY - scrollY) * zoom 折算到视口。角色对象直接
// 取 Game 场景运行时的 player 字段（dev 手柄），不靠扫描 display list ——
// 高层有 NPC 同前缀贴图，扫列表会抓错人。

const VIEW_H = 720; // DESIGN_HEIGHT，zoom 1 时即世界像素

interface ClimbSample {
  floor: number;
  worldTop: number;
  worldBottom: number;
  scrollY: number;
  zoom: number;
  screenTop: number;
  screenBottom: number;
}

async function startRun(page: Page, seed = 42): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await page.waitForFunction(() => {
    const g = window.__PHASER_GAME__;
    return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Menu');
  }, undefined, { timeout: 30_000 });
  await page.keyboard.press('Enter');
  // 新跑局先落角色选择；选择屏会在 create() 绑定按键前就报 active。
  await page.waitForFunction(() => {
    const g = window.__PHASER_GAME__;
    return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect' || s.scene.key === 'Game');
  }, undefined, { timeout: 30_000 });
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const started = await page.waitForFunction(() => {
      const g = window.__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
    }, undefined, { timeout: 2000 }).then(() => true).catch(() => false);
    if (started) break;
  }
  await page.waitForFunction(() => {
    const g = window.__PHASER_GAME__;
    return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
  }, undefined, { timeout: 10_000 });
}

async function readState(page: Page): Promise<{ currentFloor: number; gold: number; x: number; shortcuts: number }> {
  return page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session state');
    return {
      currentFloor: s.currentFloor,
      gold: (s.player as unknown as { gold?: number }).gold ?? 0,
      x: s.player.x,
      shortcuts: (s as unknown as { shortcuts?: number }).shortcuts ?? 0,
    };
  });
}

/** The HUD text object by name ('hud-hint' / 'hud-feedback'). */
async function hudText(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game');
    const obj = scene?.children.list.find((o) => (o as unknown as { name?: string }).name === n);
    return (obj as unknown as { text?: string } | undefined)?.text ?? '';
  }, name);
}

/** Hold a direction until the player's x crosses the target, then release. */
async function walkUntil(page: Page, key: 'ArrowLeft' | 'ArrowRight', targetX: number, past: boolean): Promise<void> {
  await page.keyboard.down(key);
  try {
    await page.waitForFunction(
      ({ t, p }) => {
        const s = window.__PHASER_SESSION__?.getState();
        if (!s) return false;
        return p ? s.player.x > t : s.player.x < t;
      },
      { t: targetX, p: past },
      { timeout: 20_000 },
    );
  } finally {
    await page.keyboard.up(key);
  }
}

async function walkToUpExit(page: Page): Promise<void> {
  await walkUntil(page, 'ArrowLeft', 44, false);
}

async function walkToLift(page: Page): Promise<void> {
  // 电梯 x=1165（LIFT_REACH=30，命中窗 1135..1195；下楼口从 1196 起）。
  // 修前是"按住右键直到 x>1150"，依赖松键及时：卡帧时 waitForFunction
  // 的 rAF 轮询与 keyboard.up 之间的延迟能把角色带过窗口，落进下楼口
  // 区（x≥1196），脚注变成"按 E 下楼"——full-suite trace 实测 110 层
  // 一路走到 1240（screencast 末帧角色贴右下楼梯口）。改为提前到 1140
  // 松键（距下楼口 56px 容错），再小步点按修正，每步后读真实 x。
  // 产品断言不变：脚注仍必须点名货运电梯，E 仍必须真实换层。
  await walkUntil(page, 'ArrowRight', 1140, true);
  for (let i = 0; i < 24; i++) {
    const x = (await readState(page)).x;
    if (x >= 1145 && x <= 1190) return;
    const key = x < 1145 ? 'ArrowRight' : 'ArrowLeft';
    await page.keyboard.down(key);
    await page.waitForTimeout(40);
    await page.keyboard.up(key);
    await page.waitForTimeout(30);
  }
  throw new Error(`could not stand in the lift window (x=${(await readState(page)).x})`);
}

async function walkToDownExit(page: Page): Promise<void> {
  // 下楼口 = 本层右端 - 40（downExitXFor），随楼层宽度变：tier1 是 1240，但
  // tier5（50010，8 房间）是 2520——本用例从 50010 出发，硬编码 1200 会停在
  // 电梯与下楼口之间的空地上，脚注既不是电梯也不是下楼（基线即红的根因之一，
  // 与 AG-53 的 stairTraversalFor 下行起点修复同源）。从场景读真实下楼口
  // （GameScene.downExit），reach 44，走到口内 20px。
  const downX = await page.evaluate(() => {
    const g = (window.__PHASER_GAME__ as unknown as { scene: { getScene: (k: string) => { downExit?: number } | null } }).scene.getScene('Game');
    return g?.downExit ?? 1240;
  });
  // 必须先走出电梯 reach（1165+30=1195），否则 E 会去乘电梯；宽楼层电梯远在
  // 左端，走进下楼窗（downX-44 .. downX）即停。
  await walkUntil(page, 'ArrowRight', Math.max(1200, downX - 20), true);
}

/** Press E and wait for exactly one floor of climb, retrying a dropped press. */
async function climbOne(page: Page, from: number): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    // 先看脚注：E 必须落在楼梯上，而不是被问号点/容器/NPC 劫持。
    const hint = await hudText(page, 'hud-hint');
    expect(hint, `climbing from ${from}: the hint must offer the stairs`).toContain('上楼');
    await page.keyboard.press('E');
    const landed = await page
      .waitForFunction((f) => (window.__PHASER_SESSION__?.getState()?.currentFloor ?? -1) === f + 1, from, { timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (landed) return;
  }
  throw new Error(`climb from floor ${from} never committed`);
}

/** Climb from whatever floor the player is on up to `target`. */
async function climbTo(page: Page, target: number): Promise<void> {
  let f = (await readState(page)).currentFloor;
  while (f < target) {
    await climbOne(page, f);
    f += 1;
  }
}

/** Grant the pass and ride the lift out of a segment top, waiting for arrival. */
async function rideLiftUp(page: Page, pass: string, from: number, to: number): Promise<void> {
  await page.evaluate((p) => {
    const s = window.__PHASER_SESSION__?.getState();
    const up = (s?.player as unknown as { homeUpgrades: string[] } | undefined)?.homeUpgrades;
    if (up && !up.includes(p)) up.push(p);
  }, pass);
  await walkToLift(page);
  const hint = await hudText(page, 'hud-hint');
  expect(hint, `lift at ${from}: the hint must offer the freight lift`).toContain('货运电梯');
  await page.keyboard.press('E');
  await page.waitForFunction((t) => (window.__PHASER_SESSION__?.getState()?.currentFloor ?? -1) === t, to, { timeout: 15_000 });
  // 长途旅行防饿死/防游荡者磨血：到站即补满（数值 Pin，不是玩法）。
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) return;
    s.player.hp = 100;
    s.player.hunger = 100;
    s.player.thirst = 100;
    s.player.energy = 100;
  });
}

/** 每帧采样：角色世界 bounds + 相机 scrollY/zoom，折算成视口坐标。 */
async function sampleClimb(page: Page, fromFloor: number): Promise<ClimbSample[]> {
  return page.evaluate(async (startFloor: number) => {
    const g = window.__PHASER_GAME__ as unknown as {
      scene: {
        getScene: (k: string) => {
          cameras: { main: { scrollY: number; zoom: number } };
          player?: { getBounds: () => { y: number; height: number } };
        } | null;
      };
    };
    const scene = g?.scene.getScene('Game');
    if (!scene) throw new Error('no Game scene');
    const out: ClimbSample[] = [];
    const started = performance.now();
    while (performance.now() - started < 2600) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      const s = window.__PHASER_SESSION__?.getState();
      const player = scene.player;
      if (!s || !player?.getBounds) continue;
      const b = player.getBounds();
      const cam = scene.cameras.main;
      out.push({
        floor: s.currentFloor,
        worldTop: b.y,
        worldBottom: b.y + b.height,
        scrollY: cam.scrollY,
        zoom: cam.zoom,
        screenTop: (b.y - cam.scrollY) * cam.zoom,
        screenBottom: (b.y + b.height - cam.scrollY) * cam.zoom,
      });
      if (s.currentFloor !== startFloor) break; // 落地即停
    }
    return out;
  }, fromFloor);
}

function reportCamera(label: string, samples: ClimbSample[]): void {
  if (samples.length === 0) {
    console.log(`[camera ${label}] NO SAMPLES`);
    return;
  }
  const worstTop = Math.min(...samples.map((s) => s.screenTop));
  const worstBottom = Math.max(...samples.map((s) => s.screenBottom));
  const minScrollY = Math.min(...samples.map((s) => s.scrollY));
  const maxScrollY = Math.max(...samples.map((s) => s.scrollY));
  console.log(
    `[camera ${label}] samples=${samples.length} zoom=${samples[0].zoom} ` +
      `scrollY=[${minScrollY.toFixed(1)}, ${maxScrollY.toFixed(1)}] ` +
      `worstScreenTop=${worstTop.toFixed(1)} worstScreenBottom=${worstBottom.toFixed(1)} viewport=[0, ${VIEW_H}]`,
  );
}

function assertFullyVisible(label: string, samples: ClimbSample[]): void {
  expect(samples.length, `${label}: 攀爬过程被逐帧采样`).toBeGreaterThan(20);
  const worstTop = Math.min(...samples.map((s) => s.screenTop));
  const worstBottom = Math.max(...samples.map((s) => s.screenBottom));
  expect(worstTop, `${label}: 头顶不出视口顶边`).toBeGreaterThanOrEqual(0);
  expect(worstBottom, `${label}: 脚底不出视口底边`).toBeLessThanOrEqual(VIEW_H);
}

// ── M1-1 攀爬相机裁切 ──────────────────────────────────────────────────────
// 底层 1→2 上行：塔底没有可再上滚的余量。修前 scrollY 全程钉在 -64，角色头顶
// 在落地前越过视口顶边 69.6px。
test('上行攀爬全程角色完整可见（1→2，塔底）', async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await startRun(page);
  expect((await readState(page)).currentFloor).toBe(1);
  await walkToUpExit(page);

  const sampling = sampleClimb(page, 1);
  await page.keyboard.press('E');
  const samples = await sampling;

  const climb = samples.filter((s) => s.floor === 1);
  reportCamera('up 1->2', climb);
  assertFullyVisible('up 1->2', climb);
  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
});

// 顶层 50010→50009 下行：塔顶的站立 bounds 只留一条 FLOOR_BAND，修前 scrollY
// 钉在 -456，角色双脚在落地前越过视口底边 96px。到 50010 是一整趟货运电梯
// 之旅（塔已六段，本测试走前五段：各爬十层 + 四次换乘），全部用真实输入完成。
test('下行攀爬全程角色完整可见（50010→50009，塔顶）', async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await startRun(page);
  await walkToUpExit(page);
  await climbTo(page, 10); // 底层 1→10
  await rideLiftUp(page, 'work_badge', 10, 100);
  await walkToUpExit(page);
  await climbTo(page, 110); // 工人宿舍 100→110
  await rideLiftUp(page, 'pass_sticker', 110, 1000);
  await walkToUpExit(page);
  await climbTo(page, 1010); // 工业区 1000→1010
  await rideLiftUp(page, 'permit', 1010, 10000);
  await walkToUpExit(page);
  await climbTo(page, 10010); // 中产区 10000→10010
  await rideLiftUp(page, 'vip_card', 10010, 50000);
  await walkToUpExit(page);
  await climbTo(page, 50010); // 富人区 50000→50010
  expect((await readState(page)).currentFloor).toBe(50010);

  await walkToDownExit(page);
  const hint = await hudText(page, 'hud-hint');
  expect(hint, '塔顶下楼口脚注必须是下楼').toContain('下楼');

  const sampling = sampleClimb(page, 50010);
  await page.keyboard.press('E');
  const samples = await sampling;

  const climb = samples.filter((s) => s.floor === 50010);
  reportCamera('down 50010->50009', climb);
  assertFullyVisible('down 50010->50009', climb);
  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
});

// ── M1-2 E/F 输入竞态 ──────────────────────────────────────────────────────
// 旧的攀爬还没结束就按 F：修前会照常扣费并抄近路换层，落地层数 > 1。
test('攀爬中按 F 不扣费也不换层', async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await startRun(page);
  await walkToUpExit(page);
  await page.keyboard.press('E');
  await page.waitForFunction(() => (window.__PHASER_SESSION__?.getState()?.currentFloor ?? -1) === 2, undefined, { timeout: 15_000 });
  // 落地点就是上楼口（x=40），且兜里有钱，抄近路一切就绪 —— 只差一个 F。
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) (s.player as unknown as { gold: number }).gold = 500;
  });
  const before = await readState(page);
  expect(before).toMatchObject({ currentFloor: 2, gold: 500 });

  await page.keyboard.press('E'); // 开始 2→3 攀爬
  await page.waitForTimeout(300); // 攀爬进行到 30%
  await page.keyboard.press('F'); // 竞态窗口内重复提交
  await page.waitForTimeout(1300); // 等攀爬自然结束

  const after = await readState(page);
  console.log(`[race F-in-climb] before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  expect(after.currentFloor, '仍然只上了一层').toBe(3);
  expect(after.gold, '没有扣费').toBe(before.gold);
  expect(after.shortcuts, '没有记录抄近路').toBe(before.shortcuts);
  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
});

// 面板开着时按 F：修前会在面板背后扣费换层。
test('背包面板开着按 F 不扣费也不换层', async ({ page }) => {
  test.setTimeout(90_000);
  await startRun(page);
  await walkToUpExit(page);
  await page.keyboard.press('E');
  await page.waitForFunction(() => (window.__PHASER_SESSION__?.getState()?.currentFloor ?? -1) === 2, undefined, { timeout: 15_000 });
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) (s.player as unknown as { gold: number }).gold = 500;
  });
  const before = await readState(page);

  await page.keyboard.press('I'); // 打开背包
  await page.waitForTimeout(150);
  await page.keyboard.press('F'); // 面板背后的 F
  await page.waitForTimeout(500);

  const after = await readState(page);
  console.log(`[race F-in-panel] before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  expect(after.currentFloor, '没有换层').toBe(2);
  expect(after.gold, '没有扣费').toBe(before.gold);
  expect(after.shortcuts, '没有记录抄近路').toBe(before.shortcuts);
  await page.keyboard.press('I'); // 收起背包
});

// ── M1-3 近路价格：面板价 = 落地闪存价 = 实际扣费 ───────────────────────────
// 修前面板价按未钳制的原始 roll 计价、扣费按另一个公式，段顶附近会分叉。
// 现在三处同源（shortcutPlan）：上楼口脚注价、落地闪存价、钱包差额必须相等。
test('近路面板价、闪存价与实际扣费是同一个数', async ({ page }) => {
  test.setTimeout(90_000);
  await startRun(page);
  await walkToUpExit(page);
  await page.keyboard.press('E');
  await page.waitForFunction(() => (window.__PHASER_SESSION__?.getState()?.currentFloor ?? -1) === 2, undefined, { timeout: 15_000 });
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) (s.player as unknown as { gold: number }).gold = 500;
  });
  const before = await readState(page);
  expect(before).toMatchObject({ currentFloor: 2, gold: 500 });

  // 落地点即上楼口：脚注带着实时价格。
  await page.waitForFunction(
    () =>
      ((window.__PHASER_GAME__?.scene.getScene('Game')?.children.list.find((o) => (o as unknown as { name?: string }).name === 'hud-hint') as unknown as { text?: string } | undefined)?.text ?? '').includes('抄近路'),
    undefined,
    { timeout: 5000 },
  );
  const hint = await hudText(page, 'hud-hint');
  const hintPrice = Number(/抄近路（(\d+) 金）/.exec(hint)?.[1]);
  expect(Number.isFinite(hintPrice) && hintPrice > 0, `hint carries a price: ${hint}`).toBe(true);

  await page.keyboard.press('F');
  await page.waitForFunction(
    () =>
      ((window.__PHASER_GAME__?.scene.getScene('Game')?.children.list.find((o) => (o as unknown as { name?: string }).name === 'hud-feedback') as unknown as { text?: string } | undefined)?.text ?? '').includes('抄近路跳到'),
    undefined,
    { timeout: 5000 },
  );
  const flash = await hudText(page, 'hud-feedback');
  const landed = Number(/跳到了第 (\d+) 层/.exec(flash)?.[1]);
  const flashPrice = Number(/（-(\d+) 金）/.exec(flash)?.[1]);
  const after = await readState(page);

  console.log(
    `[shortcut price] hint=${hintPrice} flash=${flashPrice} goldDelta=${before.gold - after.gold} ` +
      `floor ${before.currentFloor}->${after.currentFloor} (${flash.trim()})`,
  );
  expect(flashPrice, '闪存价与面板价同源').toBe(hintPrice);
  expect(before.gold - after.gold, '实际扣费就是面板价').toBe(hintPrice);
  expect(after.currentFloor, '落在了闪存说的楼层').toBe(landed);
  expect(landed - before.currentFloor, '跳过的层数在 2-4 之间').toBeGreaterThanOrEqual(2);
  expect(landed - before.currentFloor, '跳过的层数在 2-4 之间').toBeLessThanOrEqual(4);
  expect(after.shortcuts, '记录了一次抄近路').toBe(before.shortcuts + 1);
});

// ── M1-4 楼梯不跨段：段顶拒绝文案 ──────────────────────────────────────────
// 1→10 全程攀爬（每次落地都停在上楼口，所以是一串 E），到第 10 层按 E 必须
// 得到"要乘货运电梯"的明确拒绝，而不是笼统的"已到顶层"或毫无反应。
test('第 10 层上楼口拒绝时说明要用货运电梯', async ({ page }) => {
  test.setTimeout(180_000);
  await startRun(page);
  await walkToUpExit(page);
  await climbTo(page, 10);
  expect((await readState(page)).currentFloor).toBe(10);

  await page.keyboard.press('E');
  const refusal = await page
    .waitForFunction(
      () => {
        const g = window.__PHASER_GAME__;
        const scene = g?.scene.getScene('Game');
        const feedback = scene?.children.list.find((o) => (o as unknown as { name?: string }).name === 'hud-feedback');
        const text = (feedback as unknown as { text?: string } | undefined)?.text ?? '';
        return text.includes('没有向上的楼梯') && text.includes('货运电梯');
      },
      undefined,
      { timeout: 4000 },
    )
    .then(() => true)
    .catch(() => false);
  console.log(`[refusal 10->100] liftCopyShown=${refusal}`);
  expect(refusal, '拒绝文案说清要乘货运电梯').toBe(true);
  expect((await readState(page)).currentFloor, '拒绝归拒绝，楼层没动').toBe(10);
});
