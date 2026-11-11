import { expect, test, type Page } from '@playwright/test';
import { CONTENT_TOP, OVERVIEW_ROW_H, SECTOR_CELL, SECTOR_COLS, SECTOR_ROWS } from '../src/systems/TowerNav';
import { SECTOR_COUNT } from '../src/core/tower';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../src/core/design';

// B2 browser tests: the three-level tower map (overview -> sector -> floor),
// the current-floor highlight, the no-teleport rule, and the dev-only fixtures
// (?devfloor=, ?devwin=). Reads the dev-only __PHASER_TOWER__ handle so the
// assertions are about real nav state, not pixels.

interface State {
  currentFloor: number;
  day: number;
  gameMinuteOfDay: number;
  status: string;
  player: { x: number; hp: number; hunger: number; thirst: number; energy: number; inventory: { slots: unknown[] } };
  visitedFloors: Record<string, unknown>;
}

interface Nav {
  level: 'overview' | 'sector' | 'floor';
  sector: number;
  floor: number | null;
  cursor: number;
  zoom: number;
  scroll: number;
}

interface TowerHandle {
  getNav: () => Nav;
  getAccess: () => { highestUnlocked: number; currentFloor: number };
  getView: () => { left: number; top: number; width: number; height: number; content: number };
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

async function startGame(page: Page, seed = 42): Promise<void> {
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

async function readNav(page: Page): Promise<Nav> {
  return page.evaluate(() => {
    const h = (window as unknown as { __PHASER_TOWER__?: TowerHandle }).__PHASER_TOWER__;
    if (!h) throw new Error('no tower handle');
    return h.getNav();
  }) as Promise<Nav>;
}

async function readAccess(page: Page): Promise<{ highestUnlocked: number; currentFloor: number }> {
  return page.evaluate(() => {
    const h = (window as unknown as { __PHASER_TOWER__?: { getAccess: () => { highestUnlocked: number; currentFloor: number } } }).__PHASER_TOWER__;
    if (!h) throw new Error('no tower handle');
    return h.getAccess();
  }) as Promise<{ highestUnlocked: number; currentFloor: number }>;
}

// What the camera is actually showing, so a test can assert coverage of the
// content instead of eyeballing a screenshot.
async function readView(page: Page): Promise<{ left: number; top: number; width: number; height: number; content: number }> {
  return page.evaluate(() => {
    const h = (window as unknown as { __PHASER_TOWER__?: TowerHandle }).__PHASER_TOWER__;
    if (!h) throw new Error('no tower handle');
    return h.getView();
  }) as Promise<{ left: number; top: number; width: number; height: number; content: number }>;
}

async function clickWorldPoint(page: Page, worldX: number, worldY: number): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('game canvas is not visible');
  const [view, nav] = await Promise.all([readView(page), readNav(page)]);
  const cssX = canvas.x + ((worldX - view.left) * nav.zoom * canvas.width) / DESIGN_WIDTH;
  const cssY = canvas.y + ((worldY - view.top) * nav.zoom * canvas.height) / DESIGN_HEIGHT;
  await page.mouse.click(cssX, cssY);
}

async function readPointerY(page: Page): Promise<number> {
  return page.evaluate(() => {
    const game = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (key: string) => { input: { activePointer: { y: number } } } } };
    }).__PHASER_GAME__;
    if (!game) throw new Error('no game instance');
    return game.scene.getScene('TowerOverview').input.activePointer.y;
  }) as Promise<number>;
}

// The colour each cell of the sector in view is drawn in.
async function readCells(page: Page): Promise<Array<{ floor: number; state: string }>> {
  return page.evaluate(() => {
    const h = (window as unknown as { __PHASER_TOWER__?: { getCells: () => Array<{ floor: number; state: string }> } }).__PHASER_TOWER__;
    if (!h) throw new Error('no tower handle');
    return h.getCells();
  }) as Promise<Array<{ floor: number; state: string }>>;
}

async function hasVisibleText(page: Page, substr: string): Promise<boolean> {
  return page.evaluate((sub) => {
    const scenes = (window as unknown as { __PHASER_GAME__?: { scene: { scenes: Array<{ children: { list: Array<{ type: string; text?: string; visible: boolean }> } }> } } }).__PHASER_GAME__?.scene.scenes ?? [];
    return scenes.some((sc) => (sc.children.list ?? []).some((o) => o.type === 'Text' && (o.text ?? '').includes(sub) && o.visible));
  }, substr);
}

// Park the run at a known point: explored 1..3, standing on 3, stats pinned so
// no decay can land inside the assertion window.
async function parkAt(page: Page, floor: number, explored: number[]): Promise<void> {
  await page.evaluate(
    ({ f, floors }) => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      if (!s) return;
      s.currentFloor = f;
      s.player.x = 640;
      s.player.hp = 100;
      s.player.hunger = 100;
      s.player.thirst = 100;
      s.player.energy = 100;
      const visit = { openedContainers: [], lootedItems: [], unlockedDoors: [], localEvents: [] };
      for (const floor of floors) s.visitedFloors[floor] = { ...visit };
    },
    { f: floor, floors: explored },
  );
}

// A short gap between presses: Phaser's frame-based input occasionally drops a
// single synthetic keypress, which would silently leave the cursor short of its
// target (the same reason npc.spec.ts separates its presses).
async function tap(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
  await page.waitForTimeout(60);
}

// Press `key` until the nav cursor reaches `want`, self-correcting against a
// dropped press so the test asserts the rule rather than the input luck.
async function tapUntil(page: Page, key: string, want: number): Promise<void> {
  for (let i = 0; i < 120; i++) {
    if ((await readNav(page)).cursor === want) return;
    await tap(page, key);
  }
  throw new Error(`cursor never reached ${want} (at ${(await readNav(page)).cursor})`);
}

test('M opens the tower overview centred on the sector the player is in', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await parkAt(page, 3, [1, 2, 3]);

  await page.keyboard.press('M');
  await waitForScene(page, 'TowerOverview');

  const nav = await readNav(page);
  expect(nav.level).toBe('overview');
  expect(nav.sector).toBe(0); // floor 3 lives in sector 0
  expect(nav.cursor).toBe(0);
  expect(nav.floor).toBeNull();
  expect(nav.zoom).toBe(1);
  // The whole tower is on screen at the default zoom: no drag needed to see the
  // bottom, which is the point of the overview.
  const view = await readView(page);
  expect(view.top).toBeLessThanOrEqual(0);
  expect(view.top + view.height).toBeGreaterThanOrEqual(view.content);
  expect(view.content).toBeLessThanOrEqual(DESIGN_HEIGHT); // 100 rows inside the design viewport
  await page.screenshot({ path: 'e2e/screenshots/20-tower-overview.png' });

  expect(await hasVisibleText(page, '塔楼总览')).toBe(true);
  expect(await hasVisibleText(page, '当前 3 层')).toBe(true);
  // All three reference points are on screen: the start, where the player is,
  // and the summit they are climbing toward. The summit is explicitly marked
  // because it is not part of the every-tenth sector label set.
  expect(await hasVisibleText(page, '起点 第1层')).toBe(true);
  expect(await hasVisibleText(page, '终点 第100000层')).toBe(true);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// The overview must still fit the whole tower when the player is near the top of
// it, not just when they start in sector 0.
test('the whole tower is visible from any starting sector', async ({ page }) => {
  await startGame(page, 42);
  await parkAt(page, 95000, [95000]);
  await page.keyboard.press('M');
  await waitForScene(page, 'TowerOverview');

  const nav = await readNav(page);
  expect(nav.sector).toBe(94);
  const view = await readView(page);
  expect(view.top).toBeLessThanOrEqual(0);
  expect(view.top + view.height).toBeGreaterThanOrEqual(view.content);
  await page.screenshot({ path: 'e2e/screenshots/23-tower-overview-high.png' });
});

test('the overview drills down to a sector and a floor, and ESC walks back up', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await parkAt(page, 3, [1, 2, 3]);
  await page.keyboard.press('M');
  await waitForScene(page, 'TowerOverview');

  // overview -> sector 0 (floors 1..1000)
  await tap(page, 'Enter');
  let nav = await readNav(page);
  expect(nav.level).toBe('sector');
  expect(nav.sector).toBe(0);
  expect(nav.cursor).toBe(1);
  expect(await hasVisibleText(page, '1–1000 层')).toBe(true);
  // The frontier the cells are coloured from: 1..3 unlocked, so cell 3 is the
  // current floor and 1..2 read as explored.
  expect((await readAccess(page)).highestUnlocked).toBe(3);
  expect(Object.keys((await readState(page)).visitedFloors).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  const cells = await readCells(page);
  expect(cells.slice(0, 4)).toEqual([
    { floor: 1, state: 'explored' },
    { floor: 2, state: 'explored' },
    { floor: 3, state: 'current' },
    { floor: 4, state: 'locked' },
  ]);
  await page.screenshot({ path: 'e2e/screenshots/21-tower-sector.png' });

  // sector -> floor detail for the cursor (floor 1)
  await tap(page, 'Enter');
  nav = await readNav(page);
  expect(nav.level).toBe('floor');
  expect(nav.floor).toBe(1);
  expect(await hasVisibleText(page, '第 1 层 · 玩家宿舍')).toBe(true);
  // B3-01: the detail panel now says what is actually on the floor, so a trip is
  // a plan rather than a guess.
  //
  // B3-08: it must say what is ACTUALLY there. This used to assert
  // 「储物柜：净水·布料」, which locked in a bug — the panel read the loot table, so
  // it advertised the cabinet's 60% cloth roll on every seed including seed 42,
  // where the roll fails and the cloth is never in the world. The panel now reads
  // the resolved view, so only 净水 is promised.
  expect(await hasVisibleText(page, '储物柜：净水')).toBe(true);
  expect(await hasVisibleText(page, '布料')).toBe(false);
  await page.screenshot({ path: 'e2e/screenshots/22-tower-floor.png' });

  // ESC walks back up one level at a time, keeping the sector in view.
  await tap(page, 'Escape');
  nav = await readNav(page);
  expect(nav.level).toBe('sector');
  expect(nav.sector).toBe(0);
  await tap(page, 'Escape');
  nav = await readNav(page);
  expect(nav.level).toBe('overview');

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the keyboard cursor moves across the sector grid', async ({ page }) => {
  await startGame(page, 42);
  await parkAt(page, 3, [1, 2, 3]);
  await page.keyboard.press('M');
  await waitForScene(page, 'TowerOverview');

  await tap(page, 'Enter'); // -> sector 0
  expect((await readNav(page)).cursor).toBe(1);

  await tap(page, 'ArrowRight');
  expect((await readNav(page)).cursor).toBe(2);
  await tap(page, 'ArrowDown');
  expect((await readNav(page)).cursor).toBe(22); // one full row of 20
  await tap(page, 'ArrowLeft');
  expect((await readNav(page)).cursor).toBe(21);
  await tap(page, 'ArrowUp');
  expect((await readNav(page)).cursor).toBe(1);
});

test('fixed HUD clicks do not select map content when zoomed and scrolled', async ({ page }) => {
  await startGame(page, 42);
  await parkAt(page, 3, [1, 2, 3]);
  await page.keyboard.press('M');
  await waitForScene(page, 'TowerOverview');

  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('game canvas is not visible');
  const centerX = canvas.x + canvas.width / 2;
  const centerY = canvas.y + canvas.height / 2;
  await page.mouse.move(centerX, centerY);
  for (const zoom of [1.5, 2, 2.5, 3]) {
    await page.mouse.wheel(0, -120);
    await page.waitForFunction((target) => {
      const h = (window as unknown as { __PHASER_TOWER__?: TowerHandle }).__PHASER_TOWER__;
      return h?.getNav().zoom === target;
    }, zoom);
  }

  const zoomed = await readNav(page);
  expect(zoomed.level).toBe('overview');
  expect(zoomed.zoom).toBe(3);
  expect(zoomed.scroll).not.toBe(0);

  const topHudY = canvas.y + (20 * canvas.height) / DESIGN_HEIGHT;
  await page.mouse.click(centerX, topHudY);
  let afterClick = await readNav(page);
  expect(afterClick.level).toBe('overview');
  expect(afterClick.sector).toBe(zoomed.sector);

  const bottomHudY = canvas.y + ((DESIGN_HEIGHT - 10) * canvas.height) / DESIGN_HEIGHT;
  await page.mouse.click(centerX, bottomHudY);
  afterClick = await readNav(page);
  expect(afterClick.level).toBe('overview');
  expect(afterClick.sector).toBe(zoomed.sector);
});

test('wheel zoom and drag pan preserve map state; pointer selection works at 1x', async ({ page }) => {
  await startGame(page, 42);
  await parkAt(page, 3, [1, 2, 3]);
  await page.keyboard.press('M');
  await waitForScene(page, 'TowerOverview');

  const beforeAccess = await readAccess(page);
  const beforeCells = await readCells(page);
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('game canvas is not visible');

  const centerX = canvas.x + canvas.width / 2;
  const centerY = canvas.y + canvas.height / 2;
  await page.mouse.move(centerX, centerY);
  for (const zoom of [1.5, 2, 2.5, 3]) {
    await page.mouse.wheel(0, -120);
    await page.waitForFunction((target) => {
      const h = (window as unknown as { __PHASER_TOWER__?: TowerHandle }).__PHASER_TOWER__;
      return h?.getNav().zoom === target;
    }, zoom);
  }

  const zoomed = await readNav(page);
  expect(zoomed.level).toBe('overview');
  expect(zoomed.zoom).toBe(3);
  const scrollBeforeDrag = zoomed.scroll;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX, centerY + 100, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(
    (before) => {
      const h = (window as unknown as { __PHASER_TOWER__?: TowerHandle }).__PHASER_TOWER__;
      return !!h && h.getNav().scroll !== before;
    },
    scrollBeforeDrag,
  );

  const panned = await readNav(page);
  expect(panned.zoom).toBe(3);
  expect(panned.scroll).not.toBe(scrollBeforeDrag);

  // Restore the baseline camera scale before the pointer-selection assertion;
  // this test protects the existing 1x picking path without changing zoom rules.
  await page.mouse.move(centerX, centerY);
  for (const zoom of [2.5, 2, 1.5, 1]) {
    await page.mouse.wheel(0, 120);
    await page.waitForFunction((target) => {
      const h = (window as unknown as { __PHASER_TOWER__?: TowerHandle }).__PHASER_TOWER__;
      return h?.getNav().zoom === target;
    }, zoom);
  }
  await page.waitForFunction(() => {
    const h = (window as unknown as { __PHASER_TOWER__?: TowerHandle }).__PHASER_TOWER__;
    return h?.getNav().scroll === 0;
  });
  const sectorZeroY = CONTENT_TOP + (SECTOR_COUNT - 1) * OVERVIEW_ROW_H + OVERVIEW_ROW_H / 2;
  await clickWorldPoint(page, DESIGN_WIDTH / 2, sectorZeroY);
  await page.waitForFunction(() => {
    const h = (window as unknown as { __PHASER_TOWER__?: TowerHandle }).__PHASER_TOWER__;
    return h?.getNav().level === 'sector';
  });
  const selected = await readNav(page);
  expect(selected.level).toBe('sector');
  expect(selected.sector).toBe(0);
  expect(await readAccess(page)).toEqual(beforeAccess);
  expect(await readCells(page)).toEqual(beforeCells);
  await tap(page, 'ArrowRight');
  expect((await readNav(page)).cursor).toBe(2);
});

test('selecting a floor is not entering it: a locked floor is refused', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await parkAt(page, 1, [1]); // frontier = 1, so floor 2 is locked
  await tap(page, 'M');
  await waitForScene(page, 'TowerOverview');

  await tap(page, 'Enter'); // -> sector 0
  await tap(page, 'ArrowRight'); // cursor onto floor 2
  await tap(page, 'Enter'); // -> floor detail
  const nav = await readNav(page);
  expect(nav.floor).toBe(2);
  expect(await hasVisibleText(page, '通行：未打通')).toBe(true);
  expect(await hasVisibleText(page, 'Enter 尝试进入 · 未打通需先实际抵达 · ESC 返回区段')).toBe(true);

  await tap(page, 'Enter'); // try to enter
  await page.waitForTimeout(200);

  // Refused: still on the map, still on floor 1, and the reason is on screen.
  expect(await hasVisibleText(page, '该楼层尚未打通，需先通过实际通路抵达')).toBe(true);
  expect((await readState(page)).currentFloor).toBe(1);
  await waitForScene(page, 'TowerOverview');

  // The summit is unreachable from the slum, however far you scroll. Coming back
  // up to the overview keeps the cursor on the sector you were just in.
  await tap(page, 'Escape'); // -> sector
  await tap(page, 'Escape'); // -> overview
  expect((await readNav(page)).cursor).toBe(0); // sector 0 is where we were
  await tapUntil(page, 'ArrowDown', 99); // clamped at the last sector
  expect((await readNav(page)).cursor).toBe(99);
  await tap(page, 'Enter'); // -> sector 99 (floors 99001..100000)
  await tapUntil(page, 'ArrowRight', 99020); // last column of the first row
  await tapUntil(page, 'ArrowDown', 100000); // clamped at the summit
  expect((await readNav(page)).cursor).toBe(100000);
  await tap(page, 'Enter');
  expect((await readNav(page)).floor).toBe(100000);
  await tap(page, 'Enter');
  await page.waitForTimeout(200);
  expect((await readState(page)).currentFloor).toBe(1); // never teleported to the summit
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('an unlocked floor can be entered from the map and the run survives the trip', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await parkAt(page, 3, [1, 2, 3]);
  const before = await readState(page);

  await tap(page, 'M');
  await waitForScene(page, 'TowerOverview');

  // Just opening and closing the map must not touch the run. The stats can only
  // have decayed by the real time that elapsed (the map stops the clock), never
  // been reset — so compare against a tolerance rather than exact equality.
  await tap(page, 'Escape');
  await waitForScene(page, 'Game');
  const afterRoundTrip = await readState(page);
  expect(afterRoundTrip.currentFloor).toBe(before.currentFloor);
  expect(afterRoundTrip.day).toBe(before.day);
  expect(afterRoundTrip.player.hp).toBe(before.player.hp);
  expect(afterRoundTrip.player.hunger).toBeLessThanOrEqual(before.player.hunger);
  expect(afterRoundTrip.player.hunger).toBeGreaterThan(before.player.hunger - 2);
  expect(afterRoundTrip.player.thirst).toBeLessThanOrEqual(before.player.thirst);
  expect(afterRoundTrip.player.thirst).toBeGreaterThan(before.player.thirst - 2);
  expect(afterRoundTrip.player.inventory.slots.length).toBe(before.player.inventory.slots.length);
  expect(Object.keys(afterRoundTrip.visitedFloors).sort()).toEqual(Object.keys(before.visitedFloors).sort());

  // Now actually enter an unlocked floor (2) from the map.
  await tap(page, 'M');
  await waitForScene(page, 'TowerOverview');
  await tap(page, 'Enter'); // -> sector 0
  await tap(page, 'ArrowRight'); // cursor floor 2
  await tap(page, 'Enter'); // -> floor detail
  expect((await readNav(page)).floor).toBe(2);
  expect(await hasVisibleText(page, '通行：已打通')).toBe(true);
  await tap(page, 'Enter'); // enter
  await waitForScene(page, 'Game');

  const afterEnter = await readState(page);
  expect(afterEnter.currentFloor).toBe(2);
  expect(afterEnter.player.x).toBe(640); // entry point, like any floor change
  expect(afterEnter.day).toBe(before.day);
  expect(afterEnter.player.hp).toBe(before.player.hp);
  expect(afterEnter.player.inventory.slots.length).toBe(before.player.inventory.slots.length);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the retired day-8 auto-win is off in a normal run and on under ?devwin=1', async ({ page }) => {
  await startGame(page, 42);
  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (s) {
      s.day = 7;
      s.gameMinuteOfDay = 1200;
    }
  });
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    return !!s && s.player.x > 1090;
  }, undefined, { timeout: 20_000 });
  await page.keyboard.up('ArrowRight');
  await page.keyboard.press('E'); // open the shelter panel
  await page.keyboard.press('Enter'); // arrange the default rest action
  await page.waitForFunction(
    () => !!window.__PHASER_SESSION__?.getState()?.shelterPlan?.resolved,
    undefined,
    { timeout: 5000 },
  );
  await page.keyboard.press('E'); // settle the night into day 8

  await page.waitForFunction(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    return !!s && s.day === 8;
  }, undefined, { timeout: 10_000 });

  // No auto-win: the run simply carries on into day 8.
  const after = await readState(page);
  expect(after.day).toBe(8);
  expect(after.status).toBe('playing');
});

test('?devwin=1 still runs the retired day-8 victory fixture', async ({ page }) => {
  await page.goto('/?seed=42&devwin=1');
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
        const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
        return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
      },
      undefined,
      { timeout: 2000 },
    ).then(() => true).catch(() => false);
    if (started) break;
  }
  await waitForScene(page, 'Game');

  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (s) {
      s.day = 7;
      s.gameMinuteOfDay = 1200;
    }
  });
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    return !!s && s.player.x > 1090;
  }, undefined, { timeout: 20_000 });
  await page.keyboard.up('ArrowRight');
  await page.keyboard.press('E'); // open the shelter panel
  await page.keyboard.press('Enter'); // arrange the default rest action
  await page.waitForFunction(
    () => !!window.__PHASER_SESSION__?.getState()?.shelterPlan?.resolved,
    undefined,
    { timeout: 5000 },
  );
  await page.keyboard.press('E'); // settle the night and trigger the fixture

  await waitForScene(page, 'End');
  expect((await readState(page)).status).toBe('won');
  await page.screenshot({ path: 'e2e/screenshots/06-win.png' });
});

test('?devfloor=100000 starts the retired dev dorm scene and nothing else', async ({ page }) => {
  await page.goto('/?seed=42&devfloor=100000');
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
        const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
        return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
      },
      undefined,
      { timeout: 2000 },
    ).then(() => true).catch(() => false);
    if (started) break;
  }
  await waitForScene(page, 'Game');
  expect((await readState(page)).currentFloor).toBe(100000);

  // A normal run never lands there.
  await startGame(page, 42);
  expect((await readState(page)).currentFloor).toBe(1);

  // A malformed devfloor is ignored rather than guessed at.
  await page.goto('/?seed=42&devfloor=1');
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
        const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
        return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
      },
      undefined,
      { timeout: 2000 },
    ).then(() => true).catch(() => false);
    if (started) break;
  }
  await waitForScene(page, 'Game');
  expect((await readState(page)).currentFloor).toBe(1);
});

test('the pause menu reaches the tower map', async ({ page }) => {
  await startGame(page, 42);
  await parkAt(page, 3, [1, 2, 3]);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  expect(await hasVisibleText(page, '塔楼地图')).toBe(true);

  // Separate the presses: two keys in one frame make the pause menu advance
  // twice, landing on 重新开始 instead of 塔楼地图.
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await waitForScene(page, 'TowerOverview');
  expect((await readNav(page)).level).toBe('overview');
});

test('the 1.5x overview click selects the sector under the pointer on a FIT-scaled canvas', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await startGame(page, 42);
  await parkAt(page, 3, [1, 2, 3]);
  await page.keyboard.press('M');
  await waitForScene(page, 'TowerOverview');

  const access = await readAccess(page);
  const cells = await readCells(page);
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('game canvas is not visible');
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.mouse.wheel(0, -120);
  await page.waitForFunction(() => {
    const h = (window as unknown as { __PHASER_TOWER__?: TowerHandle }).__PHASER_TOWER__;
    return h?.getNav().zoom === 1.5;
  });

  const overviewSectorZeroY = CONTENT_TOP + (SECTOR_COUNT - 1) * OVERVIEW_ROW_H + OVERVIEW_ROW_H / 2;
  await clickWorldPoint(page, DESIGN_WIDTH / 2, overviewSectorZeroY);
  await page.waitForFunction(() => {
    const h = (window as unknown as { __PHASER_TOWER__?: TowerHandle }).__PHASER_TOWER__;
    return h?.getNav().level === 'sector';
  });
  expect((await readNav(page)).sector).toBe(0);
  expect(await readAccess(page)).toEqual(access);
  expect(await readCells(page)).toEqual(cells);
});

test('1.5x drag uses incremental viewport deltas and clicks the intended floor', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await startGame(page, 42);
  await parkAt(page, 3, [1, 2, 3]);
  await page.keyboard.press('M');
  await waitForScene(page, 'TowerOverview');
  await tap(page, 'Enter'); // overview -> sector 0

  const access = await readAccess(page);
  const cells = await readCells(page);
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('game canvas is not visible');
  const centerX = canvas.x + canvas.width / 2;
  const centerY = canvas.y + canvas.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.wheel(0, -120);
  await page.waitForFunction(() => {
    const h = (window as unknown as { __PHASER_TOWER__?: TowerHandle }).__PHASER_TOWER__;
    return h?.getNav().zoom === 1.5;
  });
  const beforeDrag = await readNav(page);
  const pointerYBeforeDrag = await readPointerY(page);
  const cssDelta = (30 * canvas.height) / DESIGN_HEIGHT;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX, centerY - cssDelta, { steps: 3 });
  await page.mouse.up();
  await page.waitForFunction(
    (scroll) => {
      const h = (window as unknown as { __PHASER_TOWER__?: TowerHandle }).__PHASER_TOWER__;
      return !!h && h.getNav().scroll !== scroll;
    },
    beforeDrag.scroll,
  );
  const afterDrag = await readNav(page);
  const pointerYAfterDrag = await readPointerY(page);
  const scrollDelta = afterDrag.scroll - beforeDrag.scroll;
  expect(scrollDelta).toBeCloseTo((pointerYBeforeDrag - pointerYAfterDrag) / beforeDrag.zoom, 2);
  expect(scrollDelta).toBeGreaterThan(18);
  expect(scrollDelta).toBeLessThan(22);

  // Floor 500 is a known cell in sector 0: column 19, row 24 from the bottom.
  const gridX = (DESIGN_WIDTH - SECTOR_COLS * SECTOR_CELL) / 2;
  const floor500X = gridX + 19 * SECTOR_CELL + SECTOR_CELL / 2;
  const rowFromBottom = Math.floor((500 - 1) / SECTOR_COLS);
  const floor500Y = CONTENT_TOP + (SECTOR_ROWS - 1 - rowFromBottom) * SECTOR_CELL + SECTOR_CELL / 2;
  await clickWorldPoint(page, floor500X, floor500Y);
  await page.waitForFunction(() => {
    const h = (window as unknown as { __PHASER_TOWER__?: TowerHandle }).__PHASER_TOWER__;
    return h?.getNav().level === 'floor';
  });
  expect(await readNav(page)).toMatchObject({ level: 'floor', sector: 0, floor: 500 });
  expect(await readAccess(page)).toEqual(access);
  expect(await readCells(page)).toEqual(cells);
});
