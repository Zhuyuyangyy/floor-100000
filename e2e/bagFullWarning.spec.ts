import { expect, test, type Page } from '@playwright/test';

// B3-02 §4.2: a full bag used to be a 1.6-second flash.
//
// That is the wrong shape for this particular piece of news. The bag stays full
// until the player spends something, so telling them once and going quiet means
// they walk onto the next floor with no reminder and lose that floor's loot to
// what reads as a bug. The HUD now holds the warning until a slot frees up.
//
// This drives it the honest way: walk the real route and loot until the bag is
// genuinely full. No inventory surgery, no slotCount edit. Floors 3 and 4 hand
// out exactly enough distinct stacks to fill the twelve slots the player starts
// with three of — and the count is the same whether or not crate_metal's 60%
// battery roll pays out, because a crate battery and the loose ground battery
// are the same item and land in one slot.

const UP_EXIT_X = 40;
const DOWN_EXIT_X = 1240;
const CRAFT_X = 480; // dorm workbench on floor 1
// The standing warning, deliberately not the substring the 1.6s flash uses
// ('背包已满，剩余留在容器') — otherwise a stale flash would satisfy this.
const BAG_FULL = '否则搜刮会留在原处';

test.describe('B3-02.1 bag-full feedback', () => {
  test.setTimeout(240_000); // the walk is the point, same as the journey spec

  const readState = (page: Page) =>
    page.evaluate(() => {
      const s = window.__PHASER_SESSION__?.getState();
      if (!s) throw new Error('no session');
      return s;
    });

  const count = (page: Page, itemId: string): Promise<number> =>
    page.evaluate((id) => {
      const s = window.__PHASER_SESSION__?.getState();
      return (s?.player.inventory.slots ?? []).filter((x) => x.itemId === id).reduce((n, x) => n + x.quantity, 0);
    }, itemId);

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

  async function waitForScene(page: Page, key: string): Promise<void> {
    await page.waitForFunction(
      (k) => {
        const g = window.__PHASER_GAME__;
        return !!g && g.scene.getScenes(true).some((s) => s.scene.key === k);
      },
      key,
      { timeout: 30_000 },
    );
  }

  async function waitForFlag(page: Page, substr: string, want: boolean, timeout = 15_000): Promise<void> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if ((await hasVisibleText(page, substr)) === want) return;
      await page.waitForTimeout(120);
    }
    throw new Error(`"${substr}" visible=${String(!want)} never became ${String(want)}`);
  }

  async function walkTo(page: Page, targetX: number): Promise<void> {
    const from = (await readState(page)).player.x;
    const dir = targetX < from ? 'ArrowLeft' : 'ArrowRight';
    await page.keyboard.down(dir);
    try {
      await page.waitForFunction(
        ({ t, d }) => {
          const s = window.__PHASER_SESSION__?.getState();
          if (!s) return false;
          return d === 'ArrowLeft' ? s.player.x <= t : s.player.x >= t;
        },
        { t: targetX, d: dir },
        { timeout: 40_000 },
      );
    } finally {
      await page.keyboard.up(dir);
    }
  }

  // The player keeps sliding for a moment after the key is released - movement
  // is a speed ramp, not a switch - and an interaction fired mid-slide can miss
  // the radius. Wait until x stops changing rather than assuming it already has.
  async function settle(page: Page, timeout = 1500): Promise<void> {
    let last = (await readState(page)).player.x;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      await page.waitForTimeout(80);
      const now = (await readState(page)).player.x;
      if (Math.abs(now - last) < 0.5) return;
      last = now;
    }
  }

  // Polls a real game-state predicate in short steps. Used after every keypress
  // so a slow runner costs exactly as long as it needs, not a guessed constant.
  async function pollUntil(page: Page, check: () => Promise<boolean>, timeout: number): Promise<boolean> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await check()) return true;
      await page.waitForTimeout(60);
    }
    return check();
  }

  async function openContainer(page: Page, floor: number, id: string, x: number): Promise<void> {
    const opened = async (): Promise<boolean> =>
      ((await readState(page)).visitedFloors[floor]?.openedContainers ?? []).includes(id);
    await walkTo(page, x);
    await settle(page);
    // This used to press E, wait a fixed 220ms, and repeat eight times. That was
    // enough locally and not on the CI runner, where the spec died with
    // "could not open 3/crate_metal" - all eight presses had landed before the
    // key was being handled. Wait for the state to change instead.
    for (let i = 0; i < 10; i++) {
      if (await opened()) return;
      await page.keyboard.press('E');
      if (await pollUntil(page, opened, 1500)) return;
      await walkTo(page, x); // slid past the radius: step back and try again
    }
    throw new Error(`could not open ${floor}/${id}`);
  }

  async function takeStairs(page: Page, dir: 'up' | 'down', expectedFloor: number): Promise<void> {
    const exitX = dir === 'up' ? UP_EXIT_X : DOWN_EXIT_X;
    const onFloor = async (): Promise<boolean> => (await readState(page)).currentFloor === expectedFloor;
    await walkTo(page, exitX);
    await settle(page);
    for (let i = 0; i < 10; i++) {
      if (await onFloor()) return;
      await page.keyboard.press('E');
      if (await pollUntil(page, onFloor, 1500)) return;
      await walkTo(page, exitX);
    }
    throw new Error(`could not go ${dir} to floor ${expectedFloor}`);
  }

  test('a full bag keeps saying so until a slot frees up', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/?seed=42');
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

    // The starting kit is three of twelve slots: nothing to warn about.
    await page.waitForTimeout(400);
    expect(await hasVisibleText(page, BAG_FULL)).toBe(false);

    await takeStairs(page, 'up', 2);
    await takeStairs(page, 'up', 3);
    await openContainer(page, 3, 'crate_metal', 800);
    await openContainer(page, 3, 'crate_wood', 480);
    await takeStairs(page, 'up', 4); // the loose battery at x=160 is picked up en route
    await openContainer(page, 4, 'fuse_box', 640);

    // The continuous stair route can also walk over a loose ground stack while
    // leaving floor 3, so the bag may already be full before the water tank.
    const beforeTank = await readState(page);
    expect(beforeTank.player.inventory.slots.length).toBeGreaterThanOrEqual(11);
    expect(beforeTank.player.inventory.slots.length).toBeLessThanOrEqual(beforeTank.player.inventory.slotCount);
    if (beforeTank.player.inventory.slots.length < beforeTank.player.inventory.slotCount) {
      expect(await hasVisibleText(page, BAG_FULL)).toBe(false);
    }

    await openContainer(page, 4, 'water_tank', 240);
    const full = await readState(page);
    expect(full.player.inventory.slots.length).toBe(full.player.inventory.slotCount);

    // The warning appears on its own — the player did nothing wrong.
    await waitForFlag(page, BAG_FULL, true);

    // And it is still there long after the old 1.6-second flash would have gone.
    await page.waitForTimeout(3000);
    expect(await hasVisibleText(page, BAG_FULL)).toBe(true);

    // It also survives opening the inventory, which is exactly when the player
    // is hunting for something to spend.
    await page.keyboard.press('I');
    await page.waitForTimeout(400);
    expect(await hasVisibleText(page, BAG_FULL)).toBe(true);

    // B3-05.1: drinking used to be the way out. Three presses emptied the stack,
    // freed the slot and cleared the warning — which also meant a player could
    // burn a day of water just to make room. At full thirst the bottle now stays
    // in the bag, so that route is closed on purpose. How many of the three go
    // down depends on how much thirst the walk cost, so this asserts only the
    // invariant: the stack cannot be drained by mashing the key, so no slot frees
    // and the warning stays up.
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Enter'); // slot 0 is 净水 x3
      await page.waitForTimeout(260);
    }
    const drank = await readState(page);
    expect(await count(page, 'clean_water')).toBeGreaterThanOrEqual(1);
    expect(drank.player.inventory.slots.length).toBe(full.player.inventory.slots.length);
    expect(await hasVisibleText(page, BAG_FULL)).toBe(true);
    await page.keyboard.press('I');

    // The route the game actually offers is the workbench: crafting spends whole
    // stacks, which is what frees slots. The lamp's battery, wire and scrap are
    // all in the bag, so walk home and build it.
    await takeStairs(page, 'down', 3);
    await takeStairs(page, 'down', 2);
    await takeStairs(page, 'down', 1);
    await walkTo(page, CRAFT_X);
    await page.keyboard.press('C');
    await page.waitForTimeout(320);
    await page.keyboard.press('Enter'); // 照明灯 is entry 0
    await page.waitForTimeout(400);
    await page.keyboard.press('C');
    await page.waitForTimeout(200);

    const spent = await readState(page);
    expect(spent.player.homeUpgrades).toContain('lamp');
    expect(spent.player.inventory.slots.length).toBeLessThan(full.player.inventory.slots.length);
    await waitForFlag(page, BAG_FULL, false);

    // And it is not a one-shot latch: the physical stair route may already have
    // picked up floor 3's cloth while returning to the down stair. Use the
    // guaranteed bread stack on floor 5 to refill the freed slot deterministically.
    await takeStairs(page, 'up', 2);
    await takeStairs(page, 'up', 3);
    await takeStairs(page, 'up', 4);
    await takeStairs(page, 'up', 5);
    await openContainer(page, 5, 'pantry', 1120);
    const refilled = await readState(page);
    expect(await count(page, 'bread')).toBeGreaterThanOrEqual(1);
    expect(refilled.player.inventory.slots.length).toBe(refilled.player.inventory.slotCount);
    await waitForFlag(page, BAG_FULL, true);

    await page.screenshot({ path: 'e2e/screenshots/48-bag-full-warning.png' });
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });
});
