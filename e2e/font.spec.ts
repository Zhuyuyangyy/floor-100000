import { expect, test, type Page } from '@playwright/test';

// The webfont round (f74e972): every Text moved from `monospace` to a bundled
// Noto Sans SC subset declared as 'GameSans'. This spec pins the two things
// that round can silently break:
//
//   1. the face actually LOADS — a 404 on the .otf falls back to the system
//      stack with no error anywhere, and every label keeps rendering;
//   2. the panels still FIT with the real font's metrics — a subset face has
//      different advance widths than the fallback it replaced, so a panel that
//      was measured against SimSun/YaHei can now overflow.
//
// The panel geometry checks mirror firstChapter's (same depth filter, same
// 15%-overlap rule); what is new here is the font-loaded proof and the
// fontFamily audit that runs before any geometry is asserted.

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../src/core/design';
import { PANEL_DEPTH } from '../src/render/panels';

// The font file index.html declares. Asserted by substring so a rename of the
// file shows up here instead of silently disabling the check.
const FONT_FILE = 'noto-sans-sc-subset';

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => {
      const g = window.__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === k);
    },
    key,
    { timeout: 20_000 },
  );
}

async function startGame(page: Page, seed = 42): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const started = await page.waitForFunction(
      () => {
        const g = window.__PHASER_GAME__;
        return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
      },
      undefined,
      { timeout: 2000 },
    ).then(() => true).catch(() => false);
    if (started) break;
  }
  await waitForScene(page, 'Game');
}

const setX = (page: Page, x: number): Promise<void> =>
  page.evaluate((v) => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.player.x = v;
  }, x);

async function hasVisibleText(page: Page, substr: string): Promise<boolean> {
  return page.evaluate((sub) => {
    const g = window.__PHASER_GAME__;
    const scenes = g ? g.scene.scenes : [];
    for (const sc of scenes) {
      for (const o of sc.children.list ?? []) {
        if (o.type === 'Text' && (o.text ?? '').includes(sub) && o.visible) return true;
      }
    }
    return false;
  }, substr);
}

// Where 阿林 IS right now. AG-11's autonomy walks her along a schedule (the
// npcs.ts anchor 480 is stale — measured 224), so the dialogue setup re-seats
// the player on her live sprite before every E press.
async function alinSpriteX(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const g = window.__PHASER_GAME__;
    const sc = g?.scene.getScene('Game') as unknown as { npcObjs?: Map<string, { sprite: { x: number } }> } | null;
    const rec = sc?.npcObjs?.get('alin');
    return rec ? Math.round(rec.sprite.x) : null;
  });
}

async function climbOneFloor(page: Page, target: number): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    if ((await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.currentFloor)) === target) return;
    await setX(page, 40); // the up stairwell: the left end of every floor
    await page.keyboard.press('E');
    const landed = await page
      .waitForFunction(
        (floor) => window.__PHASER_SESSION__?.getState()?.currentFloor === floor,
        target,
        { timeout: 4000 },
      )
      .then(() => true)
      .catch(() => false);
    if (landed) return;
  }
  throw new Error(`could not climb to floor ${target}`);
}

interface TextBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Every visible panel text, with the world and the HUD band excluded — the same
// filter firstChapter uses (panel content lives at PANEL_DEPTH.game and up).
async function panelTexts(page: Page, sceneKey = 'Game'): Promise<TextBox[]> {
  return page.evaluate(
    ({ key, minDepth }) => {
      const scene = window.__PHASER_GAME__?.scene.getScene(key);
      const list = (scene?.children.list ?? []) as unknown as Array<{
        type: string;
        name?: string;
        text?: string;
        visible: boolean;
        depth?: number;
        getBounds(): { x: number; y: number; width: number; height: number };
      }>;
      const out: TextBox[] = [];
      for (const o of list) {
        if (o.type !== 'Text' || !o.visible) continue;
        if ((o.name ?? '').startsWith('hud-')) continue;
        if ((o.depth ?? 0) < minDepth) continue;
        const text = o.text ?? '';
        if (!text) continue;
        const b = o.getBounds();
        out.push({ text, x: b.x, y: b.y, width: b.width, height: b.height });
      }
      return out;
    },
    { key: sceneKey, minDepth: sceneKey === 'Game' ? PANEL_DEPTH.game.inventory : 0 },
  );
}

function expectWithinCanvas(texts: TextBox[], label: string): void {
  expect(texts.length, `${label}: no panel text found`).toBeGreaterThan(0);
  for (const t of texts) {
    expect(t.x, `${label}: "${t.text}" starts off-canvas`).toBeGreaterThanOrEqual(0);
    expect(t.y, `${label}: "${t.text}" starts off-canvas`).toBeGreaterThanOrEqual(0);
    expect(t.x + t.width, `${label}: "${t.text}" runs off the right edge`).toBeLessThanOrEqual(DESIGN_WIDTH);
    expect(t.y + t.height, `${label}: "${t.text}" runs off the bottom edge`).toBeLessThanOrEqual(DESIGN_HEIGHT);
  }
}

function expectNoOverlap(texts: TextBox[], label: string): void {
  const collisions: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i];
      const b = texts[j];
      const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (w <= 1 || h <= 1) continue;
      const smaller = Math.min(a.width * a.height, b.width * b.height);
      if (smaller > 0 && (w * h) / smaller > 0.15) collisions.push(`"${a.text}" × "${b.text}"`);
    }
  }
  expect(collisions, `${label}: overlapping text`).toEqual([]);
}

test('the GameSans face really loads and every live label asks for it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  // The face is loaded, not merely declared: a 404 on the .otf would leave
  // check() false while the game kept rendering on the system fallback.
  const loaded = await page.evaluate(() => document.fonts.check("16px 'GameSans'"));
  expect(loaded, 'GameSans is not loaded — the @font-face file failed or the gate in main.ts let the game start early').toBe(true);

  // The font file was actually fetched (not served from a stale cache entry
  // that no longer matches the declaration).
  const fontFetches = await page.evaluate(
    (needle) => performance.getEntriesByType('resource').filter((e) => e.name.includes(needle)).length,
    FONT_FILE,
  );
  expect(fontFetches, `no network fetch of ${FONT_FILE}`).toBeGreaterThan(0);

  // Every visible Text in the running game asks for the GameSans stack — a
  // label still hardcoding `monospace` (or any other face) fails here.
  const fontFamilies = await page.evaluate(() => {
    const scenes = (window.__PHASER_GAME__?.scene.scenes ?? []) as unknown as Array<{
      children: { list: Array<{ type: string; visible: boolean; style?: { fontFamily?: string } }> };
    }>;
    const out: string[] = [];
    for (const sc of scenes) {
      for (const o of sc.children.list ?? []) {
        if (o.type !== 'Text' || !o.visible) continue;
        out.push(o.style?.fontFamily ?? '');
      }
    }
    return out;
  });
  expect(fontFamilies.length, 'no visible Text objects found').toBeGreaterThan(0);
  const offStack = fontFamilies.filter((f) => !f.includes('GameSans'));
  expect(offStack, `visible labels not on the GameSans stack: ${offStack.join(' | ')}`).toEqual([]);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the key panels stay inside the canvas under the real font', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  // ── the HUD band: the numbers and the clock, the most metric-sensitive
  // labels in the game. Excluded from panelTexts by name, so checked here.
  const hud = await page.evaluate(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game');
    const list = (scene?.children.list ?? []) as unknown as Array<{
      type: string;
      name?: string;
      text?: string;
      visible: boolean;
      getBounds(): { x: number; y: number; width: number; height: number };
    }>;
    const out: TextBox[] = [];
    for (const o of list) {
      if (o.type !== 'Text' || !o.visible) continue;
      if (!(o.name ?? '').startsWith('hud-')) continue;
      const text = o.text ?? '';
      if (!text) continue;
      const b = o.getBounds();
      out.push({ text, x: b.x, y: b.y, width: b.width, height: b.height });
    }
    return out;
  });
  expect(hud.length, 'HUD: no text found').toBeGreaterThan(0);
  expectWithinCanvas(hud, 'HUD');
  expectNoOverlap(hud, 'HUD');

  // ── the bag ─────────────────────────────────────────────────────────────
  await page.keyboard.press('I');
  await expect.poll(async () => hasVisibleText(page, '背包')).toBe(true);
  const bag = await panelTexts(page);
  expectWithinCanvas(bag, 'inventory');
  expectNoOverlap(bag, 'inventory');
  await page.keyboard.press('I');
  await page.waitForFunction(
    () => !(window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { inventoryOpen: boolean }).inventoryOpen,
  );

  // ── the workbench (the dorm floor only) ─────────────────────────────────
  await page.keyboard.press('C');
  await expect.poll(async () => hasVisibleText(page, '工作台 · 制作')).toBe(true);
  const craft = await panelTexts(page);
  expectWithinCanvas(craft, 'craft');
  expectNoOverlap(craft, 'craft');
  await page.keyboard.press('C');
  await page.waitForFunction(
    () => !(window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { craftingOpen: boolean }).craftingOpen,
  );

  // ── the dialogue (one floor up, at the neighbour) ───────────────────────
  await climbOneFloor(page, 2);
  for (let i = 0; i < 6; i++) {
    if (await hasVisibleText(page, '阿林（维修工）')) break;
    const alinX = await alinSpriteX(page);
    if (alinX !== null) await setX(page, alinX);
    await page.keyboard.press('E');
    await page.waitForTimeout(220);
  }
  expect(await hasVisibleText(page, '阿林（维修工）')).toBe(true);
  const dialogue = await panelTexts(page);
  expectWithinCanvas(dialogue, 'dialogue');
  expectNoOverlap(dialogue, 'dialogue');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => {
    const g = window.__PHASER_GAME__;
    const list = g?.scene.getScene('Game')?.children.list ?? [];
    return !list.some((o) => o.type === 'Text' && (o.text ?? '').includes('阿林（维修工）') && o.visible);
  });

  // ── the tower overview ──────────────────────────────────────────────────
  await page.keyboard.press('M');
  await waitForScene(page, 'TowerOverview');
  await expect.poll(async () => hasVisibleText(page, '塔楼总览')).toBe(true);
  const overview = await panelTexts(page, 'TowerOverview');
  expectWithinCanvas(overview, 'tower overview');
  expectNoOverlap(overview, 'tower overview');
  await page.keyboard.press('Escape');
  await waitForScene(page, 'Game');

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
