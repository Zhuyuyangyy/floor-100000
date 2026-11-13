import { expect, test, type Page } from '@playwright/test';

// P0-07 browser tests: the night event is seed-reproducible, a blackout darkens
// the screen but never fully blacks it (and a flashlight helps), and the wanderer
// threat is avoidable (leaving the floor escapes it with no damage taken).

interface State {
  status: string;
  day: number;
  gameMinuteOfDay: number;
  currentFloor: number;
  player: { x: number; hp: number; inventory: { slots: Array<{ itemId: string; quantity: number }> } };
  worldEvents: { activeEvent: { type: string; floor?: number; message?: string } | null };
}

const GET_STATE = `(window).__PHASER_SESSION__?.getState() ?? null`;
const NIGHT_ALPHA = `(() => { const g = (window).__PHASER_GAME__; const o = g?.scene?.getScene('Game')?.children.list.find((x) => x.name === 'night-overlay'); return o ? o.alpha : -1; })()`;

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
  return page.evaluate(`(() => { const s = ${GET_STATE}; if (!s) throw new Error('no session'); return s; })()`) as Promise<State>;
}

async function nightAlpha(page: Page): Promise<number> {
  return page.evaluate(NIGHT_ALPHA) as Promise<number>;
}

async function hasWanderer(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; texture?: { key: string } }> } } | null } } }).__PHASER_GAME__;
    const list = g?.scene.getScene('Game')?.children.list ?? [];
    return list.some((o) => o.type === 'Sprite' && (o.texture?.key ?? '').startsWith('char-wanderer'));
  });
}

async function setX(page: Page, x: number): Promise<void> {
  await page.evaluate((v) => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (s) s.player.x = v;
  }, x);
}

// Press E once, then poll before pressing again. A blind fixed retry can fire
// on the frame a stair climb commits, start a second climb, and move the run an
// extra floor (the climb itself takes STAIR_TRAVEL_MS = 1000 ms).
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

// Floors run upward: 1 -> 2 -> 3. The up-exit is the left end of the floor.
async function goUp(page: Page): Promise<void> {
  await setX(page, 40); // UP_EXIT_X
  const before = (await readState(page)).currentFloor;
  await pressEUntil(page, async () => (await readState(page)).currentFloor > before);
}

test('the night event is reproducible for a given seed', async ({ page }) => {
  async function eventType(seed: number): Promise<string> {
    await startGame(page, seed);
    await page.evaluate(() => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      if (s) s.gameMinuteOfDay = 1320;
    });
    await page.waitForFunction(() => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      return !!s && s.worldEvents.activeEvent !== null;
    }, undefined, { timeout: 5000 });
    return (await readState(page)).worldEvents.activeEvent!.type;
  }
  expect(await eventType(42)).toBe(await eventType(42));
});

test('a blackout darkens the screen but never fully blacks it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await goUp(page); // leave the safe dorm
  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (!s) return;
    s.gameMinuteOfDay = 1320;
    s.worldEvents.activeEvent = { type: 'blackout', message: 'test' };
    s.player.inventory.slots = s.player.inventory.slots.filter((x) => x.itemId !== 'flashlight');
  });

  await page.waitForFunction(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ name: string; alpha: number }> } } | null } } }).__PHASER_GAME__;
    const o = g?.scene.getScene('Game')?.children.list.find((x) => x.name === 'night-overlay');
    return !!o && o.alpha > 0.5;
  }, undefined, { timeout: 5000 });
  const dark = await nightAlpha(page);
  expect(dark).toBeGreaterThan(0.5);
  expect(dark).toBeLessThan(1); // never a permanent full-black screen
  await page.screenshot({ path: 'e2e/screenshots/10-blackout.png' });

  // A flashlight makes it navigable again.
  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    s?.player.inventory.slots.push({ itemId: 'flashlight', quantity: 1 });
  });
  await page.waitForFunction(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ name: string; alpha: number }> } } | null } } }).__PHASER_GAME__;
    const o = g?.scene.getScene('Game')?.children.list.find((x) => x.name === 'night-overlay');
    return !!o && o.alpha < 0.5;
  }, undefined, { timeout: 5000 });
  expect(await nightAlpha(page)).toBeLessThan(dark);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the wanderer is avoidable — leaving the floor escapes it undamaged', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await goUp(page); // 2
  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (!s) return;
    s.gameMinuteOfDay = 1320;
    s.worldEvents.activeEvent = { type: 'wanderer', floor: 2, message: 'test' };
  });

  await page.waitForFunction(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; texture?: { key: string } }> } } | null } } }).__PHASER_GAME__;
    const list = g?.scene.getScene('Game')?.children.list ?? [];
    return list.some((o) => o.type === 'Sprite' && (o.texture?.key ?? '').startsWith('char-wanderer'));
  }, undefined, { timeout: 5000 });
  expect(await hasWanderer(page)).toBe(true);
  await page.screenshot({ path: 'e2e/screenshots/11-wanderer.png' });

  const hpBefore = (await readState(page)).player.hp;
  // Escape through the DOWN stairwell, not the up one. The wanderer spawns at the
  // end of the floor opposite the player, and the player is at ENTRY_X when it
  // spawns — so it appears at x=48, which IS the up exit. Walking up teleports the
  // player into its path (setX below) and it lands a hit before the stair registers,
  // which is correct game behaviour and a broken test. Going down walks away from it.
  await setX(page, 1240); // DOWN_EXIT_X
  const floorBefore = (await readState(page)).currentFloor;
  await pressEUntil(page, async () => (await readState(page)).currentFloor < floorBefore);
  expect(await hasWanderer(page)).toBe(false); // gone with the floor
  const after = await readState(page);
  expect(after.player.hp).toBe(hpBefore); // never hit while escaping
  expect(after.status).toBe('playing');
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
