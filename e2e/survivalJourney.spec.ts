import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { E2EGameState } from './globals';

// The balance file is the single source of truth for starting values, and this
// spec asserts against them at boot. Read it here rather than copying numbers:
// B3-16 moved the starts to 65 and a pinned 79.5 failed for the wrong reason.
const BALANCE = JSON.parse(readFileSync(join(process.cwd(), 'config/game-balance.json'), 'utf8')) as {
  player: { hungerStart: number; thirstStart: number; energyStart: number };
};

// B3-02: the whole journey, walked for real.
//
// The acceptance rule is that a passing test does not prove the journey exists —
// so this one never teleports, never writes currentFloor, never injects items.
// Every floor change is a walk to a stairwell plus a real E, every container is
// opened by standing next to it, and every pickup happens because the player
// walked over the item. That makes it slow (several km of corridor at 130px/s),
// which is the honest cost of proving the loop closes.
//
// Route:
//   1  cabinet@160           -> up
//   2                         -> up            (shelf skipped: 50% empty, 1.5km detour)
//   3  crate_metal@800, crate_wood@480 -> up   (loose battery picked up en route)
//   4  fuse_box@640 (arrival), water_tank@240 -> up
//   5  counter@480, pantry@1120 -> down
//   4                         -> down
//   3                         -> down          (loose cloth picked up en route)
//   2                         -> down
//   1  cabinet re-check (no duplicate) -> bed@1120 -> sleep
// then reload and 继续游戏 to prove the save round-trips.

const UP_EXIT_X = 40;
const DOWN_EXIT_X = 1240;

test.describe('B3-02 full survival journey', () => {
  test.setTimeout(600_000); // the walk and the wait for nightfall are the point

  const readState = (page: Page): Promise<E2EGameState> =>
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

  // Hold a direction until the player reaches targetX. No jumping: the sprite
  // covers the ground at PLAYER_SPEED.
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

  // Walk to a container and open it with a real E, retrying only against a
  // dropped keypress (Phaser's frame-based input), never against a wrong position.
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

  // Drink one bottle through the real inventory panel.
  //
  // This is not test convenience — it is what the journey forces. Looting floors
  // 3, 4 and 5 yields twelve distinct item types, and the bag holds twelve slots,
  // so the route runs one stack from an overflow the whole way.
  //
  // B3-05.1 split the old single gulp into three calls. A capped stat used to
  // consume the bottle anyway, so three presses at the start emptied the stack in
  // one go; now the second and third are refused, and the ration can only be
  // finished by spreading it across the walk — which is also what a player does.
  // Draining the stack is what frees the slot the floor-3 cloth needs on the way
  // home, so the calls sit at the start, after floor 3 and on floor 5.
  async function drinkOneBottle(page: Page): Promise<void> {
    if (await count(page, 'clean_water') < 1) return;
    await page.keyboard.press('I');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter'); // 净水 is slot 0 for as long as any remain
    await page.waitForTimeout(240);
    await page.keyboard.press('I'); // close
    await page.waitForTimeout(200);
  }

  // Walk to a stairwell and take it. The floor change is the game's own logic.
  async function takeStairs(page: Page, dir: 'up' | 'down', expectedFloor: number): Promise<void> {
    await walkTo(page, dir === 'up' ? UP_EXIT_X : DOWN_EXIT_X);
    for (let i = 0; i < 8; i++) {
      if ((await readState(page)).currentFloor === expectedFloor) return;
      await page.keyboard.press('E');
      await page.waitForTimeout(220);
    }
    throw new Error(`could not go ${dir} to floor ${expectedFloor} (at ${(await readState(page)).currentFloor})`);
  }

  test('wakes on floor 1, explores 2-5, returns home and sleeps', async ({ page }) => {
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

    // ── 1. wake on floor 1 ──────────────────────────────────────────────
    const start = await readState(page);
    expect(start.currentFloor).toBe(1);
    expect(start.day).toBe(1);
    expect(start.player.hp).toBe(100);
    // A frame or two of decay has already run, so these are near-exact, not
    // exact. The expected starts come from the balance file (BALANCE, above),
    // not from a copied number — B3-16 moved them to 65 and a pinned 79.5
    // failed for the wrong reason.
    expect(start.player.hunger).toBeGreaterThan(BALANCE.player.hungerStart - 0.5);
    expect(start.player.thirst).toBeGreaterThan(BALANCE.player.thirstStart - 0.5);
    expect(start.player.energy).toBeGreaterThan(BALANCE.player.energyStart - 0.5);
    expect(start.gameMinuteOfDay).toBeGreaterThanOrEqual(360);
    expect(start.gameMinuteOfDay).toBeLessThan(365); // 06:00, seconds in
    // Starting kit, straight from config.
    expect(await count(page, 'clean_water')).toBe(3);
    expect(await count(page, 'ration_pack')).toBe(2);
    expect(await count(page, 'flashlight')).toBe(1);
    expect(start.player.inventory.slots.length).toBe(3);
    // Standing on floor 1 is what records it (B3-02.1): the visited set starts
    // with exactly the floor the player is standing on — not empty, and not the
    // whole tower.
    expect(Object.keys(start.visitedFloors)).toEqual(['1']);
    await page.screenshot({ path: 'e2e/screenshots/40-journey-1-wake.png' });

    // Top up before the walk, so the bag has room for what the tower holds.
    // One bottle is +30 from wherever the start left the player (B3-16 moved
    // the starts to 65, so it no longer caps — the claim under test is that the
    // bottle landed, not that it overflowed).
    await drinkOneBottle(page);
    expect((await readState(page)).player.thirst).toBeGreaterThan(BALANCE.player.thirstStart + 25);

    // ── 2. climb ────────────────────────────────────────────────────────
    await takeStairs(page, 'up', 2);
    await page.screenshot({ path: 'e2e/screenshots/41-journey-2-floor2.png' });

    await takeStairs(page, 'up', 3);
    await openContainer(page, 3, 'crate_metal', 800);
    expect(await count(page, 'scrap_metal')).toBe(3); // guaranteed, no slack
    expect(await count(page, 'crowbar')).toBe(1);
    await openContainer(page, 3, 'crate_wood', 480);
    expect(await count(page, 'wood')).toBe(2);
    expect(await count(page, 'tape')).toBe(1);
    // Second bottle: thirst has decayed over the walk, so this one lands for real.
    await drinkOneBottle(page);
    // The loose battery at x=160 is picked up by walking over it, on the way out.
    await takeStairs(page, 'up', 4);
    expect(await count(page, 'battery')).toBeGreaterThanOrEqual(1);
    await page.screenshot({ path: 'e2e/screenshots/42-journey-3-floor3.png' });

    // Floor 4: the player arrives exactly at the fusebox (x=640 = ENTRY_X).
    await openContainer(page, 4, 'fuse_box', 640);
    expect(await count(page, 'wire')).toBe(2);
    expect(await count(page, 'filter')).toBe(1);
    expect(await count(page, 'fuse')).toBe(1);
    await takeStairs(page, 'up', 5);
    await page.screenshot({ path: 'e2e/screenshots/43-journey-4-floor4.png' });

    // Floor 5 is the top of the range: no up exit, only back down.
    await openContainer(page, 5, 'counter', 480);
    // 2 starting + 3 from the counter. A floor rather than an exact count: the
    // OVERHAUL daily-goal reward hands out a ration when the day's objective
    // closes, and this route closes it on the way up.
    expect(await count(page, 'ration_pack')).toBeGreaterThanOrEqual(5);
    expect(await count(page, 'dirty_water')).toBeGreaterThanOrEqual(2);
    const top = await readState(page);
    expect(top.currentFloor).toBe(5);
    expect(top.visitedFloors[5].openedContainers).toEqual(['counter']);
    // Third and last bottle, which empties the stack and frees its slot — the slot
    // the floor-3 cloth needs on the way home.
    await drinkOneBottle(page);
    expect(await count(page, 'clean_water')).toBe(0);
    await page.screenshot({ path: 'e2e/screenshots/44-journey-5-floor5.png' });

    // ── 3. come home ────────────────────────────────────────────────────
    const beforeReturn = await readState(page);
    await takeStairs(page, 'down', 4);
    await takeStairs(page, 'down', 3);
    // The loose cloth at x=1120 is picked up walking back to the stairwell.
    await takeStairs(page, 'down', 2);
    await takeStairs(page, 'down', 1);

    const home = await readState(page);
    expect(home.currentFloor).toBe(1);
    expect(home.player.x).toBe(640); // ENTRY_X, like any floor change
    // Nothing was lost on the way: the bag, the survival stats, the clock.
    expect(home.player.hp).toBe(beforeReturn.player.hp);
    expect(home.player.hunger).toBeLessThanOrEqual(beforeReturn.player.hunger);
    expect(home.player.thirst).toBeLessThanOrEqual(beforeReturn.player.thirst);
    expect(home.day).toBe(beforeReturn.day);
    // Every floor the player set foot on is recorded. Entering a floor is what
    // marks it explored (B3-02.1 §4.3), so floor 2 counts even though the route
    // only walks through it — the map no longer draws it as never-visited.
    for (const f of [2, 3, 4, 5]) {
      expect(home.visitedFloors[f], `floor ${f} exploration`).toBeDefined();
    }
    expect(await count(page, 'scrap_metal')).toBe(3);
    expect(await count(page, 'wood')).toBe(2);
    expect(await count(page, 'cloth')).toBeGreaterThanOrEqual(1);

    // The bag held everything the route picked up — no silent overflow.
    expect(home.player.inventory.slots.length).toBeLessThanOrEqual(home.player.inventory.slotCount);

    // ── 3b. turn the haul into upgrades at the workbench ─────────────────
    // This is the step that makes the trip mean something: the scrap, wire,
    // filter, wood and tape came off floors 3 and 4, and they only become an
    // upgrade here, at home. It also empties six stacks, which is what makes
    // room for the cabinet below — a full bag makes lootContainer leave the
    // stack untouched and report `full`, so nothing is gained and nothing lost.
    expect(home.player.homeUpgrades).toEqual([]);
    await walkTo(page, 480); // CRAFT_X
    await page.keyboard.press('C');
    await page.waitForTimeout(300);
    // The panel lists 照明灯 / 加固门 / 简易净水器 / 净水. The cursor does not
    // advance on its own, so each entry needs its own Enter plus a step down.
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(260);
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(160);
    }
    await page.keyboard.press('C'); // close
    await page.waitForTimeout(250);

    const crafted = await readState(page);
    expect(crafted.player.homeUpgrades.sort()).toEqual(['lamp', 'purifier', 'reinforced_door']);
    // The materials are gone — spent, not duplicated.
    expect(await count(page, 'scrap_metal')).toBe(0);
    expect(await count(page, 'wood')).toBe(0);
    expect(await count(page, 'wire')).toBe(0);
    expect(await count(page, 'filter')).toBe(0);
    expect(await count(page, 'battery')).toBe(0);
    expect(await count(page, 'tape')).toBe(0);
    await page.screenshot({ path: 'e2e/screenshots/45b-journey-crafted.png' });

    // Re-opening an emptied container must not hand out a second helping.
    const waterBefore = await count(page, 'clean_water');
    await openContainer(page, 1, 'cabinet', 160);
    expect(await count(page, 'clean_water')).toBe(waterBefore + 1); // first helping
    const waterAfterFirst = await count(page, 'clean_water');
    await openContainer(page, 1, 'cabinet', 160);
    expect(await count(page, 'clean_water')).toBe(waterAfterFirst); // and no second
    const cabVisits = (await readState(page)).visitedFloors[1].openedContainers.filter((c) => c === 'cabinet');
    expect(cabVisits).toEqual(['cabinet']);
    await page.screenshot({ path: 'e2e/screenshots/45-journey-6-home.png' });

    // ── 4. sleep ────────────────────────────────────────────────────────
    const beforeSleep = await readState(page);
    // The whole out-and-back plus crafting costs roughly four and a half game
    // hours, so it is mid-morning when the player gets home and sleep is still
    // hours away. Waiting it out is the only honest option — setting the clock
    // would be exactly the state-faking this test exists to rule out — and it is
    // a real property of the game's pacing, not an artefact of the test.
    expect(beforeSleep.gameMinuteOfDay).toBeGreaterThanOrEqual(360);
    expect(beforeSleep.gameMinuteOfDay).toBeLessThan(1200);

    const nightDeadline = Date.now() + 300_000;
    while ((await readState(page)).gameMinuteOfDay < 1200) {
      if (Date.now() > nightDeadline) throw new Error('nightfall never arrived');
      await page.waitForTimeout(1000);
    }

    await walkTo(page, 1120); // BED_X
    for (let i = 0; i < 8; i++) {
      if ((await readState(page)).day === 2) break;
      await page.keyboard.press('E');
      await page.waitForTimeout(250);
    }

    const slept = await readState(page);
    expect(slept.day).toBe(2);
    expect(slept.gameMinuteOfDay).toBeGreaterThanOrEqual(360); // next 06:00
    expect(slept.gameMinuteOfDay).toBeLessThan(362);
    expect(slept.player.energy).toBeGreaterThan(95); // restored
    // The night was charged, not free.
    expect(slept.player.hunger).toBeLessThan(beforeSleep.player.hunger);
    expect(slept.player.thirst).toBeLessThan(beforeSleep.player.thirst);
    expect(slept.status).toBe('playing');

    // D9 regression: a normal run must never claim the save failed.
    expect(await hasVisibleText(page, '存档失败')).toBe(false);
    const saved = await page.evaluate(() => localStorage.getItem('floor100000.save.v1'));
    expect(saved).not.toBeNull();
    await page.screenshot({ path: 'e2e/screenshots/46-journey-7-slept.png' });

    // ── 5. the save round-trips ─────────────────────────────────────────
    await page.reload();
    await waitForScene(page, 'Menu');
    expect(await hasVisibleText(page, '继续游戏')).toBe(true);
    await page.keyboard.press('ArrowDown'); // -> 继续游戏
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    // A continue resumes the run directly — the character pick is for new runs
    // only, so this goes straight to the Game scene.
    await waitForScene(page, 'Game');

    const resumed = await readState(page);
    expect(resumed.day).toBe(2);
    expect(resumed.currentFloor).toBe(1);
    // The upgrades survived the reload — they were built from floors 3 and 4's
    // materials, so losing them here would lose the point of the trip.
    expect(resumed.player.homeUpgrades.sort()).toEqual(['lamp', 'purifier', 'reinforced_door']);
    expect(await count(page, 'scrap_metal')).toBe(0); // spent, not restored
    expect(await count(page, 'wood')).toBe(0);
    // 2 starting + 3 from the counter, plus the daily-goal reward's ration if
    // the day's objective closed on the way up (it does on this route) — so a
    // floor, not an exact count, and it must survive the reload either way.
    expect(await count(page, 'ration_pack')).toBeGreaterThanOrEqual(5);
    expect(await count(page, 'clean_water')).toBeGreaterThanOrEqual(1); // from the cabinet
    // The exploration record survived too — all five floors the player set foot on.
    expect(Object.keys(resumed.visitedFloors).length).toBeGreaterThanOrEqual(5);
    await page.screenshot({ path: 'e2e/screenshots/47-journey-8-resumed.png' });

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });
});
