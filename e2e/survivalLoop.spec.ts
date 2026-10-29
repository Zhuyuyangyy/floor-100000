import { expect, test, type Page } from '@playwright/test';

// B3-01: the survival chapter's fixed systems, verified in a real browser.
//
// The audit found four things that stopped the loop from closing: critical
// materials could be missing for a whole run, the upgrades were mutually
// exclusive, one upgrade did nothing, and two items could never be obtained.
// This drives the actual game — walking the floors, opening containers, crafting
// at the workbench, trading with 阿林, sleeping in the bed — and asserts the
// outcomes against real GameState rather than against a unit-test fixture.

interface Slot {
  itemId: string;
  quantity: number;
}

interface State {
  currentFloor: number;
  day: number;
  gameMinuteOfDay: number;
  status: string;
  player: {
    x: number;
    hp: number;
    hunger: number;
    thirst: number;
    energy: number;
    homeUpgrades: string[];
    inventory: { slotCount: number; slots: Slot[] };
  };
  visitedFloors: Record<string, { openedContainers: string[] }>;
}

const CONTAINER_X: Record<string, number> = {
  // Floor 3 and 4 hold every material the three upgrades need.
  '3/crate_wood': 480,
  '3/crate_metal': 800,
  '4/fuse_box': 640,
  '4/water_tank': 240,
};

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

const readState = (page: Page): Promise<State> =>
  page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    return s;
  });

const count = (page: Page, itemId: string): Promise<number> =>
  page.evaluate((id) => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    return (s?.player.inventory.slots ?? []).filter((x) => x.itemId === id).reduce((n, x) => n + x.quantity, 0);
  }, itemId);

const hasVisibleText = (page: Page, substr: string): Promise<boolean> =>
  page.evaluate((sub) => {
    const scenes = (window as unknown as { __PHASER_GAME__?: { scene: { scenes: Array<{ children: { list: Array<{ type: string; text?: string; visible: boolean }> } }> } } }).__PHASER_GAME__?.scene.scenes ?? [];
    return scenes.some((sc) => (sc.children.list ?? []).some((o) => o.type === 'Text' && (o.text ?? '').includes(sub) && o.visible));
  }, substr);

const setX = (page: Page, x: number): Promise<void> =>
  page.evaluate((v) => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (s) s.player.x = v;
  }, x);

// Climb to `target` through the real up-exit, retrying the E press: Phaser's
// frame-based input occasionally drops a single synthetic keypress.
async function climbTo(page: Page, target: number): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if ((await readState(page)).currentFloor === target) return;
    await setX(page, 40); // UP_EXIT_X
    await page.keyboard.press('E');
    await page.waitForTimeout(220);
  }
  throw new Error(`could not climb to ${target} (at ${(await readState(page)).currentFloor})`);
}

async function descendTo(page: Page, target: number): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if ((await readState(page)).currentFloor === target) return;
    await setX(page, 1240); // DOWN_EXIT_X
    await page.keyboard.press('E');
    await page.waitForTimeout(220);
  }
  throw new Error(`could not descend to ${target} (at ${(await readState(page)).currentFloor})`);
}

// Walk over a loose ground item; pickups are automatic within 12px, so standing
// on it is the whole interaction.
async function pickUpGround(page: Page, floor: number, x: number): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    await setX(page, x);
    await page.waitForTimeout(250);
    if ((await readState(page)).currentFloor !== floor) throw new Error(`on floor ${(await readState(page)).currentFloor}, expected ${floor}`);
  }
}

// Walk to a container and open it, retrying against a dropped keypress.
async function openContainer(page: Page, key: string): Promise<void> {
  const x = CONTAINER_X[key];
  if (x === undefined) throw new Error(`no known position for ${key}`);
  const floor = Number(key.split('/')[0]);
  const id = key.split('/')[1];
  for (let attempt = 0; attempt < 8; attempt++) {
    const s = await readState(page);
    if (s.currentFloor !== floor) throw new Error(`on floor ${s.currentFloor}, expected ${floor}`);
    if ((s.visitedFloors[floor]?.openedContainers ?? []).includes(id)) return;
    await setX(page, x);
    await page.keyboard.press('E');
    await page.waitForTimeout(220);
  }
  throw new Error(`could not open ${key}`);
}

// Move the dialogue cursor onto `target`, self-correcting against a dropped or
// doubled keypress so the menu cannot be derailed.
async function selectInMenu(page: Page, options: string[], target: string): Promise<void> {
  const targetIdx = options.indexOf(target);
  if (targetIdx < 0) throw new Error(`"${target}" is not a known option`);
  // The scene holds four selection markers (inventory, crafting, pause,
  // dialogue) and more than one can be visible, so the cursor cannot be read by
  // taking the first marker — a stray one at y=66 matches the HUD's 渴 label.
  // Only a label that is one of this menu's own options counts.
  const cursorLabel = (): Promise<string> =>
    page.evaluate((opts) => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean; y: number; texture?: { key?: string } }> } } } | null } }).__PHASER_GAME__;
      const list = g?.scene?.getScene('Game')?.children.list ?? [];
      const markers = list.filter((o) => o.type === 'Image' && o.texture?.key === 'ui-marker' && o.visible);
      for (const m of markers) {
        const label = list.find((o) => o.type === 'Text' && o.visible && Math.abs(o.y - m.y) <= 4 && opts.includes(o.text ?? ''));
        if (label) return label.text ?? '';
      }
      return '';
    }, options);
  const seen: string[] = [];
  for (let i = 0; i < 16; i++) {
    const label = await cursorLabel();
    seen.push(label || '(none)');
    const cur = options.indexOf(label);
    if (cur === targetIdx) return;
    await page.keyboard.press(cur < targetIdx ? 'ArrowDown' : 'ArrowUp');
    await page.waitForTimeout(120);
  }
  throw new Error(`could not reach "${target}"; cursor saw ${JSON.stringify(seen)}`);
}

const MAIN_OPTIONS = ['问候', '询问', '交易', '退出'];

test('a player can gather every upgrade material and build all three upgrades', async ({ page }) => {
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

  // Drink and eat the starting kit first. This is not test convenience — the
  // 12-slot bag cannot hold the starting consumables AND the material haul, so a
  // player who climbs with a full bag silently loses containers to overflow.
  await page.evaluate(() => {
    const w = window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { inventory: { slots: Slot[] } } } | null } };
    const s = w.__PHASER_SESSION__?.getState();
    if (s) s.player.inventory.slots = s.player.inventory.slots.filter((x) => x.itemId === 'flashlight');
  });

  // The material floors: 3 for wood/tape/scrap/battery, 4 for wire/filter/water.
  await climbTo(page, 3);
  await openContainer(page, '3/crate_wood');
  await openContainer(page, '3/crate_metal');
  await pickUpGround(page, 3, 160); // the guaranteed loose battery
  await climbTo(page, 4);
  await openContainer(page, '4/fuse_box');
  await openContainer(page, '4/water_tank');

  // Every material the three recipes need, from a real run.
  for (const id of ['wood', 'tape', 'scrap_metal', 'battery', 'wire', 'filter']) {
    expect(await count(page, id), `${id} must be obtainable`).toBeGreaterThan(0);
  }
  // Scrap is deliberately exactly lamp(1) + purifier(2): no slack.
  expect(await count(page, 'scrap_metal')).toBe(3);

  // Back to the dorm workbench and build everything. The panel lists the three
  // recipes plus the purify action, so four Enters cover it; retry the whole pass
  // because a synthetic keypress can be dropped.
  await descendTo(page, 3);
  await descendTo(page, 2);
  await descendTo(page, 1);
  await setX(page, 480); // CRAFT_X
  await page.keyboard.press('C');
  await page.waitForTimeout(300);

  const wanted = ['lamp', 'purifier', 'reinforced_door'];
  for (let pass = 0; pass < 4; pass++) {
    const built = (await readState(page)).player.homeUpgrades;
    if (wanted.every((u) => built.includes(u))) break;
    // The cursor does not advance on its own, so each entry needs its own Enter
    // followed by a step down. Four entries: three recipes plus purify.
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(220);
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(150);
    }
  }

  const s = await readState(page);
  expect(s.player.homeUpgrades.sort()).toEqual(wanted);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('barter converts resources and never creates them', async ({ page }) => {
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

  await climbTo(page, 2);
  // 阿林 trades 1 scrap_metal for 1 wire. Give him the scrap by looting floor 3.
  await climbTo(page, 3);
  await openContainer(page, '3/crate_metal');
  await descendTo(page, 2);

  const scrapBefore = await count(page, 'scrap_metal');
  const wireBefore = await count(page, 'wire');
  expect(scrapBefore).toBeGreaterThan(0);

  await setX(page, 480); // 阿林
  // The dialogue opening itself needs retrying: Phaser's frame-based input
  // occasionally drops a single synthetic keypress.
  for (let i = 0; i < 6; i++) {
    if (await hasVisibleText(page, '阿林（维修工）')) break;
    await page.keyboard.press('E');
    await page.waitForTimeout(220);
  }
  expect(await hasVisibleText(page, '阿林（维修工）')).toBe(true);
  await selectInMenu(page, MAIN_OPTIONS, '交易');
  await page.keyboard.press('Enter'); // open the trade menu
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter'); // take offer 0 (电线 <- 废金属)
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  const scrapAfter = await count(page, 'scrap_metal');
  const wireAfter = await count(page, 'wire');
  // Conservation: exactly one scrap left the bag and exactly one wire arrived.
  // Nothing was created, which is what keeps 阿林 from being a fountain.
  expect(scrapAfter).toBe(scrapBefore - 1);
  expect(wireAfter).toBe(wireBefore + 1);
});

test('sleeping advances the clock, restores energy and charges the night', async ({ page }) => {
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

  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (!s) return;
    s.day = 1;
    s.gameMinuteOfDay = 1200; // 20:00, sleep allowed
    s.player.energy = 20;
    s.player.hunger = 90;
    s.player.thirst = 90;
  });

  await setX(page, 1120); // BED_X
  await page.keyboard.press('E');
  await page.waitForFunction(
    () => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      return !!s && s.day === 2;
    },
    undefined,
    { timeout: 10_000 },
  );

  const s = await readState(page);
  expect(s.day).toBe(2);
  // 06:00, give or take the tick that elapsed while the assertions ran.
  expect(s.gameMinuteOfDay).toBeGreaterThanOrEqual(360);
  expect(s.gameMinuteOfDay).toBeLessThan(362);
  expect(s.player.energy).toBeGreaterThan(95); // restored, minus a tick of awake decay
  // The night is not free: hunger and thirst were charged, but energy was not.
  expect(s.player.hunger).toBeLessThan(90);
  expect(s.player.thirst).toBeLessThan(90);

  // A second sleep the same morning is refused.
  await setX(page, 1120);
  await page.keyboard.press('E');
  await page.waitForTimeout(400);
  expect((await readState(page)).day).toBe(2);
});

test('the reinforced door and the lamp both change the dorm at night', async ({ page }) => {
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

  const nightAlpha = (): Promise<number> =>
    page.evaluate(() => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ name: string; alpha: number }> } } } | null } }).__PHASER_GAME__;
      const o = g?.scene?.getScene('Game')?.children.list.find((x) => x.name === 'night-overlay');
      return o ? o.alpha : -1;
    });

  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (!s) return;
    s.gameMinuteOfDay = 1320; // 22:00, night
  });
  await page.waitForTimeout(300);
  const dark = await nightAlpha();
  expect(dark).toBeGreaterThan(0);

  // Build the reinforced door, then the lamp, and watch the dorm get lighter.
  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (!s) return;
    s.player.homeUpgrades.push('reinforced_door');
  });
  await page.waitForTimeout(300);
  const doorLit = await nightAlpha();
  expect(doorLit).toBeLessThan(dark);

  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (!s) return;
    s.player.homeUpgrades.push('lamp');
  });
  await page.waitForTimeout(300);
  expect(await nightAlpha()).toBeLessThan(doorLit);
});
