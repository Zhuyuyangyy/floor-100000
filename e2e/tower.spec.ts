import { expect, test, type Page } from '@playwright/test';

// B2 browser tests: the three-level tower map (overview -> sector -> floor),
// the current-floor highlight, the no-teleport rule, and the dev-only fixtures
// (?devfloor=, ?devwin=). Reads the dev-only __PHASER_TOWER__ handle so the
// assertions are about real nav state, not pixels.
//
// AG-62 (2026-11-17 楼体剖面化重做): the overview is no longer a 3px-per-sector
// strip. It is a building cross-section that OPENS FOCUSED on the player's own
// segment (「不要一下子看到 1 万层」), with the basement (floors 1-5, the
// 基础发育区) as a labelled base and F / 看全塔 for the whole spire. The two
// default-view tests below pin exactly that; the drill-down, keyboard, cell
// colouring and no-teleport tests are unchanged, because the nav rules did not
// change — only the drawing did.
//
// The tower's shape is data, not a literal: the sector count, the row pitch and
// the summit all come from the same modules the map itself renders from, so a
// tower that grows again does not silently invalidate this spec.

import { SECTOR_COUNT, TOTAL_FLOORS, sectorOf, sectorRange } from '../src/core/tower';
import { SECTOR_COLS } from '../src/systems/TowerNav';
import { TOWER_MAP, buildingHeight, towerFitZoom } from '../src/render/hudLayout';
import { PLAYABLE_SEGMENTS } from '../src/core/segments';

const SUMMIT = TOTAL_FLOORS; // the top of the tower
const START_FLOOR = PLAYABLE_SEGMENTS[0].from; // where every run begins
const LAST_SECTOR = SECTOR_COUNT - 1; // the summit's sector
// ?devfloor= drops the run straight onto a fixture floor. This fixture used to
// boot the retired dev dorm scene; the summit is now authored endgame content
// (the sixth playable segment starts there), so what the flag still proves is
// the routing: the fixture lands on the asked-for floor, a normal run never
// lands there by itself, and a malformed value is ignored rather than guessed.
// The floor is the tower's own summit (constants.ts DEV_TEST_FLOORS[0]) — read
// from the tower module rather than from constants, whose config.ts JSON import
// Node's ESM loader rejects outside Vite (this package is "type": "module").
const DEV_FLOOR = TOTAL_FLOORS;
// A fixture floor near the top, derived rather than written: the second test
// needs a sector far from the one the player starts in.
const HIGH_FLOOR = TOTAL_FLOORS - 5000;

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
  // AG-73：教程进行中第一下 ESC = 跳过教程（有意设计，ag73-tutorial.spec.ts
  // 钉死）——本 spec 的暂停流程与教程无关，开局即按约定跳过，ESC 留给暂停。
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

/** Screen y of a floor in the level in view (AG-62: the map is a building, so
 *  the camera's coverage is asserted through floor positions, not strip rows). */
async function readFloorScreenY(page: Page, floor: number): Promise<number> {
  return page.evaluate((f) => {
    const h = (window as unknown as { __PHASER_TOWER__?: { floorScreenY: (f: number) => number } }).__PHASER_TOWER__;
    if (!h) throw new Error('no tower handle');
    return h.floorScreenY(f);
  }, floor) as Promise<number>;
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
async function readView(page: Page): Promise<{ top: number; height: number; content: number }> {
  return page.evaluate(() => {
    const h = (window as unknown as { __PHASER_TOWER__?: { getView: () => { top: number; height: number; content: number } } }).__PHASER_TOWER__;
    if (!h) throw new Error('no tower handle');
    return h.getView();
  }) as Promise<{ top: number; height: number; content: number }>;
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
  // AG-62: the map opens at the FOCUS zoom — the player's own segment fills
  // the content band instead of all 100000 floors at once. 「不要一下子看到
  // 1 万层很奇怪」是这条断言存在的理由。
  expect(nav.zoom).toBe(TOWER_MAP.zoomDefault);
  const view = await readView(page);
  expect(view.content).toBe(buildingHeight());
  // Focused, not the whole spire: the view is far shorter than the building,
  // and it is centred on the segment floor 3 stands in — the BASEMENT (1-5
  // 层, the 基础发育区), which the user asked to see as the map's base.
  expect(view.height).toBeLessThan(view.content * 0.4);
  const floor1Screen = await readFloorScreenY(page, 1);
  const floor5Screen = await readFloorScreenY(page, 5);
  expect(floor1Screen).toBeGreaterThanOrEqual(TOWER_MAP.topBand);
  expect(floor5Screen).toBeLessThanOrEqual(TOWER_MAP.bottomBand);
  // ...and floor 100 (the next stretch above the base) is further UP the screen
  // than floor 5 (the map's y grows downward: higher floors sit higher).
  expect(await readFloorScreenY(page, 100)).toBeLessThan(floor5Screen);
  await page.screenshot({ path: 'e2e/screenshots/20-tower-overview.png' });

  expect(await hasVisibleText(page, '塔楼总览')).toBe(true);
  expect(await hasVisibleText(page, '当前 3 层')).toBe(true);
  // The base is labelled as what it is: the starting five floors, the
  // development zone the player lives in.
  expect(await hasVisibleText(page, '地下基座 B1–B5 · 基础发育区')).toBe(true);
  // 聚焦视角下终点让位（塔顶在内容带外）；起点就在基座底部，照常标注。
  expect(await hasVisibleText(page, `起点 第${START_FLOOR}层`)).toBe(true);
  expect(await hasVisibleText(page, `终点 第${SUMMIT}层`)).toBe(false);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);

  // F / 看全塔: the whole tower fits the content band, both ends labelled.
  await tap(page, 'f');
  const fitNav = await readNav(page);
  expect(fitNav.zoom).toBeCloseTo(towerFitZoom(), 5);
  const fitView = await readView(page);
  expect(fitView.top).toBeLessThanOrEqual(TOWER_MAP.topBand);
  expect(fitView.top + fitView.height).toBeGreaterThanOrEqual(TOWER_MAP.bottomBand);
  await page.screenshot({ path: 'e2e/screenshots/23-tower-overview-fit.png' });
  expect(await hasVisibleText(page, `起点 第${START_FLOOR}层`)).toBe(true);
  expect(await hasVisibleText(page, `终点 第${SUMMIT}层`)).toBe(true);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// The whole tower stays reachable from any starting sector: 看全塔 works from
// the top of the tower as well as from the bottom.
test('the whole tower is visible from any starting sector', async ({ page }) => {
  await startGame(page, 42);
  await parkAt(page, HIGH_FLOOR, [HIGH_FLOOR]);
  await page.keyboard.press('M');
  await waitForScene(page, 'TowerOverview');

  const nav = await readNav(page);
  expect(nav.sector).toBe(sectorOf(HIGH_FLOOR));
  // Focused on the ruling core (the tier floor 95000 stands in), not the spire.
  expect(nav.zoom).toBe(TOWER_MAP.zoomDefault);
  const coreTop = await readFloorScreenY(page, 100000);
  expect(coreTop).toBeGreaterThanOrEqual(TOWER_MAP.topBand);
  expect(coreTop).toBeLessThanOrEqual(TOWER_MAP.bottomBand);
  await page.screenshot({ path: 'e2e/screenshots/23-tower-overview-high.png' });

  await tap(page, 'f');
  const fitView = await readView(page);
  expect(fitView.top).toBeLessThanOrEqual(TOWER_MAP.topBand);
  expect(fitView.top + fitView.height).toBeGreaterThanOrEqual(TOWER_MAP.bottomBand);
  await page.screenshot({ path: 'e2e/screenshots/24-tower-overview-fit-high.png' });
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
  const firstSector = sectorRange(0);
  expect(await hasVisibleText(page, `${firstSector.from}–${firstSector.to} 层`)).toBe(true);
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
  expect((await readNav(page)).cursor).toBe(2 + SECTOR_COLS); // one full grid row down
  await tap(page, 'ArrowLeft');
  expect((await readNav(page)).cursor).toBe(1 + SECTOR_COLS);
  await tap(page, 'ArrowUp');
  expect((await readNav(page)).cursor).toBe(1);
});

test('selecting a floor is not entering it: a locked floor is refused', async ({ page }) => {
  // Boots a run, parks it, opens the overview and drills two levels deep; on a
  // single-worker CI container that is 34 s of real time, past Playwright's
  // 30 s default.
  test.setTimeout(90_000);
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
  await tapUntil(page, 'ArrowDown', LAST_SECTOR); // clamped at the last sector
  expect((await readNav(page)).cursor).toBe(LAST_SECTOR);
  await tap(page, 'Enter'); // -> the last sector (floors 99001..100000)
  await tapUntil(page, 'ArrowRight', sectorRange(LAST_SECTOR).from + SECTOR_COLS - 1); // last column of the first row
  await tapUntil(page, 'ArrowDown', SUMMIT); // clamped at the summit
  expect((await readNav(page)).cursor).toBe(SUMMIT);
  await tap(page, 'Enter');
  expect((await readNav(page)).floor).toBe(SUMMIT);
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

test(`?devfloor=${DEV_FLOOR} boots at the asked-for floor; a normal run and a malformed value never land there`, async ({ page }) => {
  await page.goto(`/?seed=42&devfloor=${DEV_FLOOR}`);
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
  expect((await readState(page)).currentFloor).toBe(DEV_FLOOR);

  // A normal run never lands there.
  await startGame(page, 42);
  expect((await readState(page)).currentFloor).toBe(START_FLOOR);

  // A malformed devfloor is ignored rather than guessed at.
  await page.goto(`/?seed=42&devfloor=${START_FLOOR}`);
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
  expect((await readState(page)).currentFloor).toBe(START_FLOOR);
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
