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

    // Spending one consumable frees a slot, and the warning clears itself. The
    // panel is still open, so this is the player using what they are looking at.
    // Spending frees the slot — but only once a stack empties, so drinking one of
    // three bottles is not enough. This is the player spending what they are
    // looking at until the bag has room again.
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Enter'); // slot 0 is 净水 x3
      await page.waitForTimeout(260);
    }
    const spent = await readState(page);
    expect(await count(page, 'clean_water')).toBe(0);
    expect(spent.player.inventory.slots.length).toBe(full.player.inventory.slots.length - 1);
    await page.keyboard.press('I');
    await waitForFlag(page, BAG_FULL, false);

    // And it is not a one-shot latch: filling the slot again brings it back.
    // Floor 1's cabinet hands out a guaranteed bottle of water and the bottle
    // just drank left its slot empty, so this is a deterministic refill — and it
    // also fires the 1.6s "剩余留在容器" flash, which must not satisfy the marker
    // above on its own.
    await takeStairs(page, 'down', 3);
    await takeStairs(page, 'down', 2);
    await takeStairs(page, 'down', 1);
    await openContainer(page, 1, 'cabinet', 160);
    const refilled = await readState(page);
    expect(refilled.player.inventory.slots.length).toBe(refilled.player.inventory.slotCount);
    await waitForFlag(page, BAG_FULL, true);

    await page.screenshot({ path: 'e2e/screenshots/48-bag-full-warning.png' });
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });
});
