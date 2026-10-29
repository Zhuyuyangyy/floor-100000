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

  async function openContainer(page: Page, floor: number, id: string, x: number): Promise<void> {
    const opened = async (): Promise<boolean> =>
      ((await readState(page)).visitedFloors[floor]?.openedContainers ?? []).includes(id);
    await walkTo(page, x);
    for (let i = 0; i < 8; i++) {
      if (await opened()) return;
      await page.keyboard.press('E');
      await page.waitForTimeout(220);
    }
    throw new Error(`could not open ${floor}/${id}`);
  }

  async function takeStairs(page: Page, dir: 'up' | 'down', expectedFloor: number): Promise<void> {
    await walkTo(page, dir === 'up' ? UP_EXIT_X : DOWN_EXIT_X);
    for (let i = 0; i < 8; i++) {
      if ((await readState(page)).currentFloor === expectedFloor) return;
      await page.keyboard.press('E');
      await page.waitForTimeout(220);
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

    // One slot left. The count is seed-independent: 3 starting + scrap, crowbar,
    // wood, tape, battery, fuse, filter, wire = 11, because a crate battery and
    // the ground battery share a slot.
    const beforeTank = await readState(page);
    expect(beforeTank.player.inventory.slots.length).toBe(11);
    expect(await hasVisibleText(page, BAG_FULL)).toBe(false);

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

    // And it is not a one-shot latch: filling the free slot again brings it back.
    // The loose cloth on floor 3 (x=1120) was never walked over — the route took
    // the up exit at x=40 — and it survived the descent because the bag was full
    // when the player passed it. A guaranteed stack, so the refill is
    // deterministic rather than a probability roll like floor 2's shelf.
    await takeStairs(page, 'up', 2);
    await takeStairs(page, 'up', 3);
    await walkTo(page, 1120); // picked up on contact
    const refilled = await readState(page);
    expect(await count(page, 'cloth')).toBeGreaterThanOrEqual(1);
    expect(refilled.player.inventory.slots.length).toBe(refilled.player.inventory.slotCount);
    await waitForFlag(page, BAG_FULL, true);

    await page.screenshot({ path: 'e2e/screenshots/48-bag-full-warning.png' });
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });
});
