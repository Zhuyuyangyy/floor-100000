import { expect, test, type Page } from '@playwright/test';

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
  await page.screenshot({ path: 'e2e/screenshots/20-tower-overview.png' });

  expect(await hasVisibleText(page, '塔楼总览')).toBe(true);
  expect(await hasVisibleText(page, '当前 3 层')).toBe(true);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
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
  await page.screenshot({ path: 'e2e/screenshots/21-tower-sector.png' });

  // sector -> floor detail for the cursor (floor 1)
  await tap(page, 'Enter');
  nav = await readNav(page);
  expect(nav.level).toBe('floor');
  expect(nav.floor).toBe(1);
  expect(await hasVisibleText(page, '第 1 层 · 玩家宿舍')).toBe(true);
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
  await page.keyboard.press('E'); // sleep into day 8

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
  await page.keyboard.press('E');

  await waitForScene(page, 'End');
  expect((await readState(page)).status).toBe('won');
  await page.screenshot({ path: 'e2e/screenshots/06-win.png' });
});

test('?devfloor=100000 starts the retired dev dorm scene and nothing else', async ({ page }) => {
  await page.goto('/?seed=42&devfloor=100000');
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Game');
  expect((await readState(page)).currentFloor).toBe(100000);

  // A normal run never lands there.
  await startGame(page, 42);
  expect((await readState(page)).currentFloor).toBe(1);

  // A malformed devfloor is ignored rather than guessed at.
  await page.goto('/?seed=42&devfloor=1');
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
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
