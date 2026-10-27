import { expect, test, type Page } from '@playwright/test';

// P0-04 browser tests: real-time decay while standing still, sleeping to pass
// the night, and the death / victory end screens. State is read (and, for test
// setup, mutated) via the dev-only window.__PHASER_SESSION__ handle.

interface State {
  status: string;
  day: number;
  gameMinuteOfDay: number;
  currentFloor: number;
  player: { x: number; hp: number; thirst: number; hunger: number; energy: number; inventory: { slots: unknown[] } };
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

async function startGame(page: Page, seed: number): Promise<void> {
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
  });
}

async function countItem(page: Page, itemId: string): Promise<number> {
  return page.evaluate((id) => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { inventory: { slots: Array<{ itemId: string; quantity: number }> } } } | null } }).__PHASER_SESSION__?.getState();
    return (s?.player.inventory.slots ?? []).filter((x) => x.itemId === id).reduce((n, x) => n + x.quantity, 0);
  }, itemId);
}

async function readSave(page: Page): Promise<State | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('floor100000.save.v1');
    return raw ? (JSON.parse(raw) as State) : null;
  });
}

async function walkRightTo(page: Page, x: number): Promise<void> {
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(
    (target) => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      return !!s && s.player.x >= target;
    },
    x,
    { timeout: 20_000 },
  );
  await page.keyboard.up('ArrowRight');
}

// Must stay in sync with AUTOSAVE_EVERY_GAME_MINUTES in
// src/systems/SurvivalSystem.ts.
const AUTOSAVE_EVERY_GAME_MINUTES = 5;

// GHI-03 M3: the clock and decay only ever advance inside GameScene.update(),
// which never saved — standing still and closing the tab rolled the run back to
// the last discrete action, and that could be farmed to erase decay.
test('standing still persists the clock and decay into the save', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  // No input at all: only the frame loop advances time, and no discrete action
  // (loot / craft / trade / sleep / floor change) fires a save.
  await page.waitForFunction(
    () => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      return !!s && s.gameMinuteOfDay > 390 && s.player.thirst < 80;
    },
    undefined,
    { timeout: 20_000 },
  );

  const live = await readState(page);
  const saved = await readSave(page);
  expect(saved, 'a save must exist without any discrete action').not.toBeNull();
  if (!saved) return;

  // The snapshot must track the live run instead of lagging a whole action behind.
  expect(saved.day).toBe(live.day);
  expect(live.gameMinuteOfDay - saved.gameMinuteOfDay).toBeLessThanOrEqual(AUTOSAVE_EVERY_GAME_MINUTES + 1);
  // Decay actually reached the save (a fresh run starts at thirst 80).
  expect(saved.player.thirst).toBeLessThan(80);
  expect(saved.player.thirst).toBeGreaterThanOrEqual(live.player.thirst);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('standing still advances the clock and decays survival stats', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  const before = await readState(page);
  expect(before.day).toBe(1);

  await page.waitForFunction(
    () => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      return !!s && s.gameMinuteOfDay > 380 && s.player.thirst < 80;
    },
    undefined,
    { timeout: 20_000 },
  );
  const after = await readState(page);
  expect(after.gameMinuteOfDay).toBeGreaterThan(before.gameMinuteOfDay);
  expect(after.player.thirst).toBeLessThan(before.player.thirst);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// GHI-03 M5: floorView was only rebuilt on entering a floor / opening a
// container / a successful pickup, so a leak starting (or clearing) while the
// player stood there left stale ground rectangles and stale pickability until
// they left and came back.
test('a leak spoils the floor\'s ground supplies and they recover when it clears', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  // Ascend to 3, the only floor with loose ground supplies (battery at
  // x=160). Teleporting to the stairs is enough — the zone check reads
  // state.player.x directly.
  // The E press is retried: Phaser's frame-based input occasionally drops a
  // single synthetic keypress, which would otherwise time this test out at
  // random (the same reason npc.spec.ts and events.spec.ts use pressEUntil).
  for (const target of [2, 3]) {
    for (let attempt = 0; attempt < 5; attempt++) {
      if ((await readState(page)).currentFloor === target) break;
      await page.evaluate(() => {
        const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { x: number } } | null } }).__PHASER_SESSION__?.getState();
        if (s) s.player.x = 40; // UP_EXIT_X
      });
      await page.keyboard.press('E');
      await page.waitForTimeout(250);
    }
    expect((await readState(page)).currentFloor).toBe(target);
  }

  const setEvent = (type: 'leak' | null): Promise<void> =>
    page.evaluate((t) => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { currentFloor: number; worldEvents: { activeEvent: unknown } } | null } }).__PHASER_SESSION__?.getState();
      if (s) s.worldEvents.activeEvent = t === null ? null : { type: t, floor: s.currentFloor, message: '漏水' };
    }, type);

  // Spoiled: stand on the battery while a leak is active here.
  await setEvent('leak');
  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { x: number } } | null } }).__PHASER_SESSION__?.getState();
    if (s) s.player.x = 160;
  });
  await page.waitForTimeout(400);
  expect(await countItem(page, 'battery'), 'spoiled supply must not be pickable').toBe(0);

  // Recovered: the supplies come back without leaving the floor.
  await setEvent(null);
  await page.waitForTimeout(400);
  expect(await countItem(page, 'battery'), 'supply must return once the leak clears').toBe(1);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('sleeping in the dorm advances to the next day', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (s) {
      s.day = 1;
      s.gameMinuteOfDay = 1200; // 20:00, sleep allowed
    }
  });
  await walkRightTo(page, 1090); // to the bed at x=1120
  await page.keyboard.press('E');

  await page.waitForFunction(
    () => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      return !!s && s.day === 2;
    },
    undefined,
    { timeout: 5000 },
  );
  const s = await readState(page);
  expect(s.day).toBe(2);
  expect(s.gameMinuteOfDay).toBeGreaterThanOrEqual(360); // next morning (06:00), then ticking
  expect(s.status).toBe('playing');
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('dehydration causes death and shows the lose screen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (s) {
      s.player.hp = 1;
      s.player.thirst = 0;
    }
  });
  await waitForScene(page, 'End');
  const s = await readState(page);
  expect(s.status).toBe('lost');
  await page.screenshot({ path: 'e2e/screenshots/07-lose.png' });
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// The v0.1 prototype auto-won on day 8. The frozen design ends at the summit
// (B8), so in a normal run day 8 is just another day — the retired threshold
// only still fires under the ?devwin=1 fixture, which e2e/tower.spec.ts covers.
test('day 8 no longer auto-wins; the run carries on', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (s) {
      s.day = 7;
      s.gameMinuteOfDay = 1200;
    }
  });
  await walkRightTo(page, 1090);
  await page.keyboard.press('E'); // sleep into day 8

  await page.waitForFunction(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    return !!s && s.day === 8;
  }, undefined, { timeout: 5000 });
  const s = await readState(page);
  expect(s.day).toBe(8);
  expect(s.status).toBe('playing'); // no auto-win, no EndScene
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
