import { expect, test, type Page } from '@playwright/test';

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../src/core/design';
import { NAV_BAR, navSlotX } from '../src/render/hudLayout';

// AG-71（HUD 底部导航条）实测探针（端口 5471，--workers=1）。参考 UI 的常驻
// 底栏：一个 contextual 槽 + 五个固定槽（背包 I / 制作 C / 产业 G / 地图 M /
// 菜单 Esc）。必测项：
//   ① 六槽常驻：标签/位置/不出画布，contextual 默认显示移动脚注；
//   ② contextual 随情境变：储物柜/工作台/床铺三处，「按 E ××」拆成 [E] 键帽
//      + 动作名，而 hud-hint 状态对象保留全串（e2e 契约不变）；
//   ③ 面板开着：对应槽高亮（标签转 highlight），contextual 交棒给面板链提示；
//   ④ 电梯口（段顶 10 层）提示照常、交互照常——导航带不压世界可读区；
//   ⑤ 三视口（900x600 / 1280x800 / 1920x1080）：不出画布、不挡角色。
// 截图落 output/ag71/（gitignore 的本地证据目录），全程 pageerror 清零。

const NAV_TOP = DESIGN_HEIGHT - NAV_BAR.height; // 672
const COLOR_DIM = '#a8a49a'; // TEXT.secondary
const COLOR_HIGHLIGHT = '#a8e0c8'; // TEXT.highlight

const SLOT_KEYS = ['bag', 'craft', 'venture', 'map', 'menu'];
const SLOT_LABELS = ['背包 I', '制作 C', '产业 G', '地图 M', '菜单 Esc'];

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === k),
    key,
    { timeout: 20_000 },
  );
}

async function startGame(page: Page, seed = 42): Promise<void> {
  // AG-73：教程进行中第一下 ESC = 跳过教程（有意设计，ag73-tutorial.spec.ts
  // 钉死）——本 spec 的 HUD 断言与教程无关，开局即按约定跳过（教程期的
  // contextual 文案会盖住世界链，跳过后方可断言电梯口/战斗等真实脚注）。
  await page.addInitScript(() => localStorage.setItem('floor100000.tutorial.skipped', '1'));
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

async function setX(page: Page, x: number): Promise<void> {
  await page.evaluate((v) => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.player.x = v;
  }, x);
  await page.waitForTimeout(150); // 等一帧让场景的世界对象跟上
}

interface HudBox {
  text: string;
  visible: boolean;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 场景里具名 HUD 对象的文本/可见性/颜色/边界（设计画布坐标）。 */
async function hudObject(page: Page, name: string): Promise<HudBox | null> {
  return page.evaluate((n) => {
    const g = window.__PHASER_GAME__;
    const scene = g?.scene.getScene('Game') as unknown as {
      children: { list: Array<{ type: string; name?: string; text?: string; visible: boolean; style?: { color?: string }; getBounds(): { x: number; y: number; width: number; height: number } }> };
    } | null;
    const o = scene?.children.list.find((c) => c.name === n);
    if (!o) return null;
    const b = o.getBounds();
    return { text: o.text ?? '', visible: o.visible, color: o.style?.color ?? '', x: b.x, y: b.y, width: b.width, height: b.height };
  }, name);
}

async function hudText(page: Page, name: string): Promise<string> {
  const o = await hudObject(page, name);
  return o?.text ?? '';
}

const slotColor = (page: Page, key: string): Promise<string> =>
  hudObject(page, `hud-nav-${key}`).then((o) => o?.color ?? '');

/** 角色在屏幕上的上下缘（设计画布坐标；站立位居中在 360 附近）。 */
async function playerScreen(page: Page): Promise<{ top: number; bottom: number }> {
  return page.evaluate(() => {
    const g = window.__PHASER_GAME__ as unknown as {
      scene: { getScene: (k: string) => { player: { getBounds(): { y: number; height: number } }; cameras: { main: { scrollY: number; zoom: number } } } | null };
    };
    const scene = g.scene.getScene('Game');
    if (!scene) throw new Error('no Game scene');
    const p = scene.player.getBounds();
    const cam = scene.cameras.main;
    return { top: (p.y - cam.scrollY) * cam.zoom, bottom: (p.y + p.height - cam.scrollY) * cam.zoom };
  });
}

test('the nav bar is always there: six slots on one riveted plate', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await setX(page, 1240); // 楼层右端：1 层的床/柜/工作台都够不到，世界链默认脚注

  // 五个固定槽：文案精确、可见、各在各的槽里、按参考图顺序排。
  for (let i = 0; i < SLOT_LABELS.length; i++) {
    const o = await hudObject(page, `hud-nav-${SLOT_KEYS[i]}`);
    expect(o, `slot ${i} missing`).not.toBeNull();
    expect(o!.text).toBe(SLOT_LABELS[i]);
    expect(o!.visible).toBe(true);
    expect(o!.color).toBe(COLOR_DIM);
    expect(o!.x, `slot ${i} starts inside its slot`).toBeGreaterThanOrEqual(navSlotX(i));
    expect(o!.x + o!.width, `slot ${i} ends inside its slot`).toBeLessThanOrEqual(navSlotX(i) + NAV_BAR.slotW);
  }
  // contextual 槽：默认（无情境）显示移动脚注，不画键帽。
  const context = await hudObject(page, 'hud-nav-context');
  expect(context).not.toBeNull();
  expect(context!.visible).toBe(true);
  expect(context!.text).toBe('A/D 或 ←/→ 移动 · E 交互');
  const keycap = await hudObject(page, 'hud-nav-key');
  expect(keycap!.visible, 'no keycap without a single-key hint').toBe(false);
  // 六个文本整块落在导航带里、不出画布。
  const navBoxes: HudBox[] = [context!, keycap!];
  for (const key of SLOT_KEYS) navBoxes.push((await hudObject(page, `hud-nav-${key}`))!);
  for (const o of navBoxes) {
    expect(o.x).toBeGreaterThanOrEqual(0);
    expect(o.y).toBeGreaterThanOrEqual(NAV_TOP);
    expect(o.x + o.width).toBeLessThanOrEqual(DESIGN_WIDTH);
    expect(o.y + o.height).toBeLessThanOrEqual(DESIGN_HEIGHT);
  }
  // hud-hint 退居状态对象：对象还在（e2e 按 name 断言它）、不可见、文本是全串。
  const hint = await hudObject(page, 'hud-hint');
  expect(hint).not.toBeNull();
  expect(hint!.visible).toBe(false);
  expect(hint!.text).toBe('A/D 或 ←/→ 移动 · E 交互');

  await page.screenshot({ path: 'output/ag71/01-nav-bar-default.png' });
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the contextual slot follows the world hint: keycap + action name', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  // 1 层宿舍三件可交互：储物柜 x=160 / 工作台 x=480 / 自己的床 x=1120。
  const cases: Array<{ x: number; hint: string; action: string }> = [
    { x: 160, hint: '按 E 打开 储物柜', action: '打开 储物柜' },
    { x: 480, hint: '按 E 制作', action: '制作' },
    { x: 1120, hint: '按 E 翻翻自己的床', action: '翻翻自己的床' },
  ];
  for (const c of cases) {
    await setX(page, c.x);
    // hud-hint 状态对象保留全串（存量 e2e 的断言契约）。
    await expect.poll(async () => hudText(page, 'hud-hint'), { timeout: 5000 }).toBe(c.hint);
    // 导航条 contextual 槽：同一个情境，拆成 [E] 键帽 + 动作名。
    await expect.poll(async () => hudText(page, 'hud-nav-context'), { timeout: 5000 }).toBe(c.action);
    const keycap = await hudObject(page, 'hud-nav-key');
    expect(keycap!.visible, `keycap at x=${c.x}`).toBe(true);
    expect(keycap!.text).toBe('E');
    // 键帽在文本左边，不压文本。
    const context = await hudObject(page, 'hud-nav-context');
    expect(context!.x).toBeGreaterThanOrEqual(16 + NAV_BAR.keycapW);
    await page.screenshot({ path: `output/ag71/02-context-${c.x}.png` });
  }
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('an open panel lights its slot and takes the contextual slot', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await setX(page, 1240);
  await expect.poll(async () => hudText(page, 'hud-nav-context')).toBe('A/D 或 ←/→ 移动 · E 交互');

  // 背包 I：槽亮、contextual 交棒给背包的面板链提示；再按一次恢复。
  await page.keyboard.press('I');
  await page.waitForFunction(() => (window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { inventoryOpen: boolean }).inventoryOpen);
  await expect.poll(() => slotColor(page, 'bag')).toBe(COLOR_HIGHLIGHT);
  await expect.poll(() => slotColor(page, 'craft')).toBe(COLOR_DIM);
  expect(await hudText(page, 'hud-nav-context')).toBe('↑/↓ 选择 · Enter 使用 · I 关闭');
  await page.screenshot({ path: 'output/ag71/03-slot-inventory.png' });
  await page.keyboard.press('I');
  await page.waitForFunction(() => !(window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { inventoryOpen: boolean }).inventoryOpen);
  await expect.poll(() => slotColor(page, 'bag')).toBe(COLOR_DIM);

  // 制作 C：1 层任意位置可开；contextual 是最长的面板提示（500px，槽宽就是按它定的）。
  await page.keyboard.press('C');
  await page.waitForFunction(() => (window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { craftingOpen: boolean }).craftingOpen);
  await expect.poll(() => slotColor(page, 'craft')).toBe(COLOR_HIGHLIGHT);
  expect(await hudText(page, 'hud-nav-context')).toBe('↑/↓ 选择 · Enter 制作 · 拖拽平移 · 滚轮缩放 · C 关闭');
  await page.screenshot({ path: 'output/ag71/04-slot-crafting.png' });
  await page.keyboard.press('C');
  await page.waitForFunction(() => !(window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { craftingOpen: boolean }).craftingOpen);

  // 菜单 Esc：暂停面板开着，菜单槽亮。
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { pauseOpen: boolean }).pauseOpen);
  await expect.poll(() => slotColor(page, 'menu')).toBe(COLOR_HIGHLIGHT);
  expect(await hudText(page, 'hud-nav-context')).toBe('↑/↓ 选择 · Enter 确认 · ESC 继续');
  await page.screenshot({ path: 'output/ag71/05-slot-pause.png' });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !(window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { pauseOpen: boolean }).pauseOpen);
  await expect.poll(() => slotColor(page, 'menu')).toBe(COLOR_DIM);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the lift mouth keeps advertising with the nav bar up', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  // 段顶（10 层）电梯窗旁：世界可读区最靠下的可交互点。导航带在它下方
  // 48px 起，提示与交互都必须照旧。
  for (let floor = 2; floor <= 10; floor++) {
    let landed = false;
    for (let attempt = 0; attempt < 6 && !landed; attempt++) {
      await setX(page, 40); // the up stairwell: the left end of every floor
      await page.keyboard.press('E');
      landed = await page
        .waitForFunction((f) => window.__PHASER_SESSION__?.getState()?.currentFloor === f, floor, { timeout: 6000 })
        .then(() => true)
        .catch(() => false);
    }
    if (!landed) throw new Error(`could not climb to floor ${floor}`);
  }
  await setX(page, 1165); // LIFT_X：电梯窗
  await expect.poll(async () => hudText(page, 'hud-hint'), { timeout: 5000 }).toBe('按 E 乘货运电梯');
  await expect.poll(async () => hudText(page, 'hud-nav-context'), { timeout: 5000 }).toBe('乘货运电梯');
  // 交互本身也照旧：没有通行证，E 换来的是拒绝提示而不是静默——证明导航带
  // 没有吃掉这一带的输入。
  await page.keyboard.press('E');
  await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 5000 }).toContain('需要');
  expect((await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.currentFloor ?? -1))).toBe(10);
  await page.screenshot({ path: 'output/ag71/07-lift-mouth.png' });
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a scene restart rebuilds the nav bar exactly once', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const navCount = (): Promise<number> => page.evaluate(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as {
      children: { list: Array<{ name?: string }> };
    } | null;
    return (scene?.children.list ?? []).filter((o) => (o.name ?? '').startsWith('hud-nav-')).length;
  });

  await startGame(page, 42);
  await expect.poll(navCount).toBe(7); // 五个槽标签 + contextual + 键帽

  // 暂停 → 重新开始：GameScene.create/buildHud 整段重跑（reset 段销毁旧导航条）。
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('ArrowDown'); // -> 塔楼地图
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowDown'); // -> 重新开始
  await page.waitForTimeout(150);
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
  await page.waitForTimeout(600);
  // 重建后还是七件，没有双份；contextual 照常出词。
  await expect.poll(navCount).toBe(7);
  await expect.poll(async () => hudText(page, 'hud-nav-context')).not.toBe('');
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('combat keeps the nav bar up and hands the contextual slot the fight hint', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  // 爬去 2 层（遭遇点所在层），逐个问号点试到开出伏击。
  for (let attempt = 0; attempt < 3; attempt++) {
    const floor = await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.currentFloor);
    if (floor === 2) break;
    await page.evaluate(() => {
      const st = window.__PHASER_SESSION__?.getState();
      if (st) st.player.x = 40;
    });
    await page.keyboard.press('E');
    await page.waitForFunction(() => window.__PHASER_SESSION__?.getState()?.currentFloor === 2, undefined, { timeout: 10_000 }).catch(() => false);
  }
  const spots = await page.evaluate(() => {
    const game = window.__PHASER_GAME__;
    const sc = game?.scene.getScene('Game') as unknown as { spotMarkers?: Map<string, { x: number }> } | null;
    return [...(sc?.spotMarkers ?? new Map<string, { x: number }>()).entries()].map(([k, v]) => ({ k, x: Math.round(v.x) }));
  });
  let opened = false;
  for (const sp of spots) {
    if (sp.k === 'shop') continue;
    await page.evaluate((x) => {
      const st = window.__PHASER_SESSION__?.getState();
      if (st) st.player.x = x;
    }, sp.x);
    await page.waitForTimeout(250);
    await page.keyboard.press('E');
    await page.waitForTimeout(500);
    opened = await page.evaluate(() => !!(window.__PHASER_SESSION__?.getState() as unknown as { combat?: unknown })?.combat);
    if (opened) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  expect(opened, 'no ambush spot on floor 2 for seed 42').toBe(true);

  // 导航条不消失：六个槽照常，contextual 槽交棒给战斗提示。当前战斗脚注
  // 带武器前缀（combatFootHint：当前武器：××（伤害 n）· Enter 出招 · …），
  // contextual 槽被 fitHudLine 按槽宽截断——断截断后的前缀；全串断不可见
  // 的 hud-hint 状态对象（与 ag63-combat-hud 同款新文案）。
  await expect.poll(async () => hudText(page, 'hud-nav-context'), { timeout: 5000 }).toMatch(/^当前武器：.+· Enter 出招/);
  await expect.poll(async () => hudText(page, 'hud-hint'), { timeout: 5000 }).toMatch(/^当前武器：.+· Enter 出招 · ↑\/↓ 选择 · ESC 撤退$/);
  for (const key of SLOT_KEYS) {
    const o = await hudObject(page, `hud-nav-${key}`);
    expect(o!.visible, `slot ${key} stays up in combat`).toBe(true);
  }
  await page.screenshot({ path: 'output/ag71/10-combat-context.png' });
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

for (const viewport of [{ width: 900, height: 600 }, { width: 1280, height: 800 }, { width: 1920, height: 1080 }]) {
  test(`the nav bar fits and never covers the player at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize(viewport);
    await startGame(page, 42);
    await setX(page, 1240);
    await expect.poll(async () => hudText(page, 'hud-nav-context')).toBe('A/D 或 ←/→ 移动 · E 交互');

    // ① 全部具名 HUD 文本都在设计画布内（letterbox 由 Scale.FIT 消化）。
    const boxes = await page.evaluate(() => {
      const g = window.__PHASER_GAME__;
      const scene = g?.scene.getScene('Game') as unknown as {
        children: { list: Array<{ type: string; name?: string; text?: string; visible: boolean; getBounds(): { x: number; y: number; width: number; height: number } }> };
      } | null;
      const out: Array<{ name: string; x: number; y: number; width: number; height: number }> = [];
      for (const o of scene?.children.list ?? []) {
        if (o.type !== 'Text' || !o.visible || !(o.name ?? '').startsWith('hud-') || !o.text) continue;
        const b = o.getBounds();
        out.push({ name: o.name ?? '', x: b.x, y: b.y, width: b.width, height: b.height });
      }
      return out;
    });
    expect(boxes.length).toBeGreaterThan(10);
    for (const b of boxes) {
      expect(b.x, `${b.name} starts on canvas`).toBeGreaterThanOrEqual(0);
      expect(b.y, `${b.name} starts on canvas`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, `${b.name} runs off the right edge`).toBeLessThanOrEqual(DESIGN_WIDTH);
      expect(b.y + b.height, `${b.name} runs off the bottom edge`).toBeLessThanOrEqual(DESIGN_HEIGHT);
    }
    // 导航带六个文本之间不互压（同 font.spec 的 15% 阈值）。
    const navBoxes = boxes.filter((b) => b.name.startsWith('hud-nav-'));
    expect(navBoxes.length).toBe(6);
    for (let i = 0; i < navBoxes.length; i++) {
      for (let j = i + 1; j < navBoxes.length; j++) {
        const a = navBoxes[i];
        const b = navBoxes[j];
        const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (w <= 1 || h <= 1) continue;
        const smaller = Math.min(a.width * a.height, b.width * b.height);
        expect((w * h) / smaller, `${a.name} x ${b.name} overlap`).toBeLessThanOrEqual(0.15);
      }
    }
    // ② 不挡角色：站立位角色整身在导航带上方。
    const player = await playerScreen(page);
    expect(player.bottom, 'the player clears the nav bar').toBeLessThan(NAV_TOP);
    await page.screenshot({ path: `output/ag71/06-viewport-${viewport.width}x${viewport.height}.png` });
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });
}
