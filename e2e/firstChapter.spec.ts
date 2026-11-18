import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// First-chapter key path, driven for real: boot a run, pick a character, land on
// floor 1, climb the whole first segment through the stairs, and use the freight
// lift at the top. Then the four panels a player lives in — bag, workbench,
// dialogue, tower overview — checked for overflow and overlap, and the day/night
// switch with its overlay.
//
// Every tower-shape number here is derived from the game's own data
// (src/core/segments.ts, src/data/floorTemplates.ts, config/game-balance.json)
// rather than written as a literal: the tower grew from five floors to six
// segments, and a spec that pins "floor 5" rots the moment it does again.

import { PLAYABLE_SEGMENTS, nextSegment, skippedFloors } from '../src/core/segments';
import { getRecipe } from '../src/data/recipes';
import { hasFloorContent } from '../src/data/floorTemplates';
import { PANEL_DEPTH } from '../src/render/panels';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../src/core/design';

// The clock the day/night spec drives, from the balance file rather than from a
// copied number.
const BALANCE = JSON.parse(readFileSync(join(process.cwd(), 'config/game-balance.json'), 'utf8')) as {
  time: { dayStartMinute: number; nightRiskStartMinute: number };
};

const FIRST_SEGMENT = PLAYABLE_SEGMENTS[0];
const SECOND_SEGMENT = nextSegment(FIRST_SEGMENT.to);
const SEGMENT_TOP = FIRST_SEGMENT.to; // 10 — the lift floor
const LIFT_PASS = SECOND_SEGMENT?.requiresPass ?? null;
const LIFT_PASS_NAME = LIFT_PASS ? getRecipe(LIFT_PASS).displayName : '通行凭证';
const LIFT_TARGET = SECOND_SEGMENT?.from ?? SEGMENT_TOP;
const LIFT_SKIPPED = skippedFloors(SEGMENT_TOP);
// Whether the lift can actually deliver a rider: the next segment's first floor
// must be authored. Derived, so this spec follows the tower instead of pinning
// today's answer — when the segments above are connected the ride is asserted,
// and while one is not, the 停运 refusal is.
const LIFT_CONNECTED = SECOND_SEGMENT ? hasFloorContent(SECOND_SEGMENT.from) : false;

// Geometry, from FloorSystem / GameScene (the shared literals the other specs
// use, kept here with their source so a move shows up as a failure here too).
const UP_EXIT_X = 40; // the up stairwell: the left end of every floor
const LIFT_X = 1165; // GameScene.ts: beside the down stairwell on a segment's top floor
// No NEIGHBOUR_X: 阿林 walks her schedule (AG-11), so the dialogue step reads her
// live sprite instead of the 480 anchor npcs.ts spawns her from.

const DAY_MINUTE = BALANCE.time.dayStartMinute;
const NIGHT_MINUTE = BALANCE.time.nightRiskStartMinute;
// How far past the day start a fresh run may be by the time the first assertion
// lands: booting the title, the character pick and floor 1 costs real game time
// (3 game-minutes per real second, measured ~12 minutes). A run that starts
// anywhere else is the failure.
const BOOT_MINUTE_BUDGET = 60;
// hudClockLabel's format (src/render/hudLayout.ts:17, over formatClock in
// SurvivalSystem.ts:48): "D{day} HH:MM" from the state's own minute, which
// advanceTime keeps inside the day. Mirrored rather than imported on purpose:
// hudLayout's module chain carries core/config.ts's bare JSON import, which
// Node's ESM loader — this package is "type": "module" — rejects outside Vite.
// src/tests/hudLayout.test.ts pins the format itself.
const expectClockLabel = (day: number, minute: number): string => {
  const hh = String(Math.floor(minute / 60)).padStart(2, '0');
  const mm = String(Math.floor(minute % 60)).padStart(2, '0');
  return `D${day} ${hh}:${mm}`;
};

interface E2EState {
  currentFloor: number;
  day: number;
  gameMinuteOfDay: number;
  status: string;
  player: { x: number; hp: number; homeUpgrades: string[] };
  visitedFloors: Record<string, unknown>;
}

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
  // AG-73：教程进行中第一下 ESC = 跳过教程（有意设计，ag73-tutorial.spec.ts
  // 钉死）——本 spec 与教程无关，开局即按约定跳过（教程期的 contextual
  // 文案会盖住世界链，跳过后方可断言电梯口等真实脚注）。
  await page.addInitScript(() => localStorage.setItem('floor100000.tutorial.skipped', '1'));
  await page.goto(`/?seed=${seed}`);
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  // A new run lands on the character pick first.
  await waitForScene(page, 'MetaSelect');
  // The pick screen reports active before create() binds its keys, so an
  // Enter can land in that window and be lost. Retry until the run starts.
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

const readState = (page: Page): Promise<E2EState> =>
  page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    return s as unknown as E2EState;
  });

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

// The named HUD line's text, read off the live scene.
async function hudText(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const scene = (window.__PHASER_GAME__ as unknown as {
      scene: { getScene: (k: string) => { children: { list: Array<{ type: string; name?: string; text?: string; visible: boolean }> } } | null };
    }).scene.getScene('Game');
    const object = scene?.children.list.find((o) => o.name === n && o.type === 'Text');
    return object && object.visible ? (object.text ?? '') : '';
  }, name);
}

async function nightAlpha(page: Page): Promise<number> {
  return page.evaluate(() => {
    const scene = (window.__PHASER_GAME__ as unknown as {
      scene: { getScene: (k: string) => { children: { list: Array<{ name?: string; alpha?: number }> } } | null };
    }).scene.getScene('Game');
    const overlay = scene?.children.list.find((o) => o.name === 'night-overlay');
    return overlay ? (overlay.alpha ?? -1) : -1;
  });
}

// The HUD clock and the state's minute, read in one synchronous evaluate so the
// ticking clock cannot slip a minute between the two reads. The label is then
// rebuilt from the snapshot with expectClockLabel, the mirror documented above.
async function clockSnapshot(page: Page): Promise<{ day: number; minute: number; text: string } | null> {
  return page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    const scene = (window.__PHASER_GAME__ as unknown as {
      scene: { getScene: (k: string) => { children: { list: Array<{ type: string; name?: string; text?: string; visible: boolean }> } } | null };
    }).scene.getScene('Game');
    const clock = scene?.children.list.find((o) => o.name === 'hud-clock' && o.type === 'Text');
    if (!s || !clock || !clock.visible) return null;
    return { day: s.day, minute: s.gameMinuteOfDay, text: clock.text ?? '' };
  });
}

// The flash lives 1.6s, so poll for it rather than reading once.
async function waitForFlash(page: Page, substr: string, timeout = 3000): Promise<void> {
  await page.waitForFunction(
    (sub) => {
      const scene = (window.__PHASER_GAME__ as unknown as {
        scene: { getScene: (k: string) => { children: { list: Array<{ name?: string; text?: string; visible: boolean }> } } | null };
      }).scene.getScene('Game');
      const flash = scene?.children.list.find((o) => o.name === 'hud-feedback');
      return !!flash && flash.visible && (flash.text ?? '').includes(sub);
    },
    substr,
    { timeout },
  );
}

// Walk to the up stairwell and take it, waiting for the landing: the traversal
// is a visible 1000 ms animation, and a blind retry can start a second climb on
// the commit frame (measured elsewhere: a route that asked for 2 ended on 5).
async function climbOneFloor(page: Page, target: number): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    if ((await readState(page)).currentFloor === target) return;
    await setX(page, UP_EXIT_X);
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
  if ((await readState(page)).currentFloor === target) return;
  throw new Error(`could not climb to floor ${target} (at ${(await readState(page)).currentFloor})`);
}

async function climbToSegmentTop(page: Page): Promise<void> {
  for (let floor = FIRST_SEGMENT.from + 1; floor <= SEGMENT_TOP; floor++) {
    await climbOneFloor(page, floor);
  }
  expect((await readState(page)).currentFloor).toBe(SEGMENT_TOP);
}

interface TextBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Every visible, non-empty text the open panel draws. In the Game scene the
// HUD band is excluded by name (its depth, HUD_FEEDBACK_DEPTH 300, sits ABOVE
// the panels on purpose) and the world by depth: panel content is drawn at
// PANEL_DEPTH.game and up, world labels at 0-30. The tower overview is all UI —
// its HUD band sits at 100-102 and the map annotations at 5, with no world
// layer to exclude — so there every text counts.
const PANEL_MIN_DEPTH: Record<string, number> = {
  Game: PANEL_DEPTH.game.inventory,
  TowerOverview: 0,
};

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
    { key: sceneKey, minDepth: PANEL_MIN_DEPTH[sceneKey] ?? 0 },
  );
}

// Nothing may hang off the canvas: the design resolution is the whole world.
function expectWithinCanvas(texts: TextBox[], label: string): void {
  expect(texts.length, `${label}: no panel text found`).toBeGreaterThan(0);
  for (const t of texts) {
    expect(t.x, `${label}: "${t.text}" starts off-canvas`).toBeGreaterThanOrEqual(0);
    expect(t.y, `${label}: "${t.text}" starts off-canvas`).toBeGreaterThanOrEqual(0);
    expect(t.x + t.width, `${label}: "${t.text}" runs off the right edge`).toBeLessThanOrEqual(DESIGN_WIDTH);
    expect(t.y + t.height, `${label}: "${t.text}" runs off the bottom edge`).toBeLessThanOrEqual(DESIGN_HEIGHT);
  }
}

// No two lines may sit on top of each other. The tolerance absorbs anti-aliased
// edges and a pixel of kerning; a row printed over another row — the failure
// this catches — is a large intersection by comparison.
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

test('a new run starts on the first floor with a working HUD', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  const state = await readState(page);
  expect(state.currentFloor).toBe(FIRST_SEGMENT.from);
  expect(state.day).toBe(1);
  // The run opens at the day start, give or take the boot cost.
  expect(state.gameMinuteOfDay - DAY_MINUTE).toBeLessThanOrEqual(BOOT_MINUTE_BUDGET);

  // The HUD reports the run, not a placeholder: the goal line, the environment
  // line, the clock, and a numeric HP readout. The clock is checked against the
  // state it is drawn from rather than against a pinned minute, because the
  // game's own time keeps moving while the assertions run.
  await expect.poll(async () => hudText(page, 'hud-goal')).toContain('目标');
  await expect.poll(async () => hudText(page, 'hud-environment')).toContain('体温值');
  await expect.poll(async () => {
    const snap = await clockSnapshot(page);
    return snap ? snap.text === expectClockLabel(snap.day, snap.minute) : false;
  }).toBe(true);
  await expect.poll(async () => hudText(page, 'hud-value-hp')).toMatch(/^\d+$/);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the stairs climb the whole first segment, and the lift waits at the top', async ({ page }) => {
  test.setTimeout(180_000); // nine climbs, each a real 1000 ms traversal plus the walk
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await climbToSegmentTop(page);

  // Every floor of the segment was set foot on.
  const visited = await readState(page);
  for (let floor = FIRST_SEGMENT.from; floor <= SEGMENT_TOP; floor++) {
    expect(visited.visitedFloors[floor], `floor ${floor} exploration`).toBeDefined();
  }

  // The lift sign stands on the top floor, pointing up: this is where the
  // stairs end and the freight lift takes over.
  expect(await hasVisibleText(page, '↑ 货运电梯')).toBe(true);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the freight lift refuses a rider without the segment pass', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await climbToSegmentTop(page);

  await setX(page, LIFT_X);
  // The hint advertises the lift before the press, the way every other
  // interaction does. AG-71: the hint moved into the nav bar's contextual
  // slot, where the key lives in an [E] keycap and the text is the action
  // name alone ("[E] 乘货运电梯") — the full string stays on the invisible
  // hud-hint state object that the hudText() helpers read.
  await expect.poll(async () => hasVisibleText(page, '乘货运电梯')).toBe(true);

  await page.keyboard.press('E');
  await waitForFlash(page, `需要${LIFT_PASS_NAME}`);
  // Refused, not crashed: still on the top floor of the segment.
  expect((await readState(page)).currentFloor).toBe(SEGMENT_TOP);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the freight lift with the pass follows the segment wiring', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await climbToSegmentTop(page);
  await page.evaluate((pass) => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s && pass && !s.player.homeUpgrades.includes(pass)) s.player.homeUpgrades.push(pass);
  }, LIFT_PASS);

  await setX(page, LIFT_X);
  await page.keyboard.press('E');

  if (LIFT_CONNECTED) {
    // The next segment is authored: the ride delivers the player to its first
    // floor, skipping the unexplored stretch in between.
    await page.waitForFunction(
      (target) => window.__PHASER_SESSION__?.getState()?.currentFloor === target,
      LIFT_TARGET,
      { timeout: 10_000 },
    );
    await waitForFlash(page, `到达第 ${LIFT_TARGET} 层`);
    expect((await readState(page)).currentFloor).toBe(LIFT_TARGET);
  } else {
    // Not authored yet: the lift says so instead of dropping the player into a
    // floor the generator cannot build.
    await waitForFlash(page, '停运');
    expect((await readState(page)).currentFloor).toBe(SEGMENT_TOP);
  }
  expect(LIFT_SKIPPED).toBeGreaterThan(0); // the skip is the point of the lift
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the bag, workbench, dialogue and tower panels stay inside the canvas and off each other', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  // ── bag ────────────────────────────────────────────────────────────────
  await page.keyboard.press('I');
  await expect.poll(async () => hasVisibleText(page, '背包')).toBe(true);
  await expect.poll(async () => hasVisibleText(page, '净水')).toBe(true);
  const bag = await panelTexts(page);
  expectWithinCanvas(bag, 'inventory');
  expectNoOverlap(bag, 'inventory');
  await page.keyboard.press('I');
  await page.waitForFunction(
    () => !(window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { inventoryOpen: boolean }).inventoryOpen,
  );

  // ── workbench (the dorm floor only) ────────────────────────────────────
  await page.keyboard.press('C');
  await expect.poll(async () => hasVisibleText(page, '工作台 · 制作')).toBe(true);
  await expect.poll(async () => hasVisibleText(page, '照明灯')).toBe(true);
  const craft = await panelTexts(page);
  expectWithinCanvas(craft, 'craft');
  expectNoOverlap(craft, 'craft');
  await page.keyboard.press('C');
  await page.waitForFunction(
    () => !(window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { craftingOpen: boolean }).craftingOpen,
  );

  // ── dialogue (one floor up, at the neighbour) ──────────────────────────
  await climbOneFloor(page, FIRST_SEGMENT.from + 1);
  for (let i = 0; i < 6; i++) {
    if (await hasVisibleText(page, '阿林（维修工）')) break;
    // 阿林 walks (AG-11 autonomy): the constant above is her spawn anchor in
    // npcs.ts, not where she is now (measured 224 vs 480). Re-seat the player on
    // her live sprite before each try, or E opens nothing.
    const alinX = await page.evaluate(() => {
      const g = window.__PHASER_GAME__;
      const sc = g?.scene.getScene('Game') as unknown as { npcObjs?: Map<string, { sprite: { x: number } }> } | null;
      const rec = sc?.npcObjs?.get('alin');
      return rec ? Math.round(rec.sprite.x) : null;
    });
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

  // ── tower overview ─────────────────────────────────────────────────────
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

test('day and night switch the overlay and the clock', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  // The run opens at the day start; hold it there so the assertion is about the
  // switch, not about however far the clock ticked during boot.
  await page.evaluate((minute) => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.gameMinuteOfDay = minute;
  }, DAY_MINUTE);
  // The clock follows the state it was just set to — read together, one frame.
  await expect.poll(async () => {
    const snap = await clockSnapshot(page);
    return snap ? snap.text === expectClockLabel(snap.day, snap.minute) : false;
  }).toBe(true);
  await expect.poll(async () => nightAlpha(page)).toBe(0);

  // Night: the overlay darkens the floor and the clock follows.
  await page.evaluate((minute) => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.gameMinuteOfDay = minute;
  }, NIGHT_MINUTE);
  await expect.poll(async () => {
    const snap = await clockSnapshot(page);
    return snap ? snap.text === expectClockLabel(snap.day, snap.minute) : false;
  }).toBe(true);
  await expect.poll(async () => nightAlpha(page)).toBeGreaterThan(0.5);

  // And back: the overlay clears with the dawn, not latching.
  await page.evaluate((minute) => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.gameMinuteOfDay = minute;
  }, DAY_MINUTE);
  await expect.poll(async () => nightAlpha(page)).toBe(0);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
