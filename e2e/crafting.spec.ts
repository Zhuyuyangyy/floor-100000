import { expect, test, type Page } from '@playwright/test';

// P0-05 browser tests: crafting deducts materials and persists, the dorm lamp
// lights the night, and the purifier converts dirty water. State is read (and,
// for setup, mutated) via the dev-only window.__PHASER_SESSION__ handle.

interface State {
  status: string;
  currentFloor: number;
  gameMinuteOfDay: number;
  player: { x: number; homeUpgrades: string[]; inventory: { slots: Array<{ itemId: string; quantity: number }> } };
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
  });
}

async function count(page: Page, itemId: string): Promise<number> {
  const s = await readState(page);
  return s.player.inventory.slots.filter((x) => x.itemId === itemId).reduce((n, x) => n + x.quantity, 0);
}

async function nightAlpha(page: Page): Promise<number> {
  return page.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ name: string; alpha: number }> } } | null } } }).__PHASER_GAME__;
    const overlay = g?.scene.getScene('Game')?.children.list.find((o) => o.name === 'night-overlay');
    return overlay ? overlay.alpha : -1;
  });
}

// Press ArrowDown until the arrow marker lands on the option starting with
// `prefix` (self-correcting against a dropped synthetic keypress).
async function navTo(page: import('@playwright/test').Page, prefix: string): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const onTarget = await page.evaluate((p) => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ name?: string; type: string; text?: string; visible: boolean; y: number; texture?: { key?: string } }> } } | null } } }).__PHASER_GAME__;
      const list = g?.scene.getScene('Game')?.children.list ?? [];
      const marker = list.find((o) => o.type === 'Image' && o.texture?.key === 'ui-marker' && o.visible);
      if (!marker) return false;
      const label = list.find((o) => o.type === 'Text' && o.visible && Math.abs(o.y - marker.y) <= 4);
      return (label?.text ?? '').startsWith(p);
    }, prefix);
    if (onTarget) return;
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(120);
  }
  throw new Error(`could not nav to ${prefix}`);
}

test('crafting deducts materials and the upgrade persists across reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  // Give the exact materials for 加固门 (wood x2, tape x1).
  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    s?.player.inventory.slots.push({ itemId: 'wood', quantity: 2 }, { itemId: 'tape', quantity: 1 });
  });

  // Open the workbench (C), select 加固门, craft (Enter).
  await page.keyboard.press('C');
  await page.waitForTimeout(200); // let the panel open
  await navTo(page, '加固门');
  const shownBeforeCraft = await page.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (key: string) => { children: { list: Array<{ visible: boolean; text?: string }> } } | null } } }).__PHASER_GAME__;
    return (g?.scene.getScene('Game')?.children.list ?? []).filter((o) => o.visible && typeof o.text === 'string').map((o) => o.text ?? '');
  });
  expect(shownBeforeCraft.some((text) => text.includes('材料数量：当前持有 / 配方需求'))).toBe(true);
  expect(shownBeforeCraft).toContain('木材 2/2');
  expect(shownBeforeCraft).toContain('胶带 1/1');
  expect(shownBeforeCraft).toContain('电池 0/1');
  expect(shownBeforeCraft).toContain('净化操作 · 建成简易净水器后解锁');
  await page.screenshot({ path: 'art-src/community-ui/previews/crafting-workbench-ready.png' });
  await page.keyboard.press('Enter');

  await page.waitForFunction(
    () => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      return !!s && s.player.homeUpgrades.includes('reinforced_door');
    },
    undefined,
    { timeout: 5000 },
  );
  expect(await count(page, 'wood')).toBe(0);
  expect(await count(page, 'tape')).toBe(0);
  const shownAfterCraft = await page.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (key: string) => { children: { list: Array<{ visible: boolean; text?: string }> } } | null } } }).__PHASER_GAME__;
    return (g?.scene.getScene('Game')?.children.list ?? []).filter((o) => o.visible && typeof o.text === 'string').map((o) => o.text ?? '');
  });
  expect(shownAfterCraft).toContain('已建');
  expect(shownAfterCraft).toContain('木材 0/2');
  expect(shownAfterCraft).toContain('胶带 0/1');

  // Reload: the title menu appears; choose 继续游戏 to resume the saved run.
  await page.reload();
  await waitForScene(page, 'Menu');
  await page.keyboard.press('ArrowDown'); // -> 继续游戏
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  // A continue resumes the run directly - the character pick is for new runs.
  await waitForScene(page, 'Game');
  const s = await readState(page);
  expect(s.player.homeUpgrades).toContain('reinforced_door');
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('insufficient materials are refused with no deduction', async ({ page }) => {
  await startGame(page, 42);
  // No materials given: 照明灯 (index 0) is 材料不足.
  await page.keyboard.press('C');
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'art-src/community-ui/previews/crafting-workbench-no-materials.png' });
  await page.keyboard.press('Enter'); // try to craft the lamp
  await page.waitForTimeout(250);
  const s = await readState(page);
  expect(s.player.homeUpgrades).not.toContain('lamp');
  // starting items untouched
  expect(await count(page, 'clean_water')).toBeGreaterThanOrEqual(3);
});

test('the dorm lamp lights the night and persists', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (s) s.gameMinuteOfDay = 1320; // 22:00, night
  });
  await page.waitForFunction(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ name: string; alpha: number }> } } | null } } }).__PHASER_GAME__;
    const o = g?.scene.getScene('Game')?.children.list.find((x) => x.name === 'night-overlay');
    return !!o && o.alpha > 0.5; // dark without the lamp
  }, undefined, { timeout: 5000 });
  const dark = await nightAlpha(page);

  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    s?.player.homeUpgrades.push('lamp');
  });
  await page.waitForFunction(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ name: string; alpha: number }> } } | null } } }).__PHASER_GAME__;
    const o = g?.scene.getScene('Game')?.children.list.find((x) => x.name === 'night-overlay');
    return !!o && o.alpha < 0.3; // lit with the lamp
  }, undefined, { timeout: 5000 });
  const lit = await nightAlpha(page);
  expect(lit).toBeLessThan(dark);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the purifier converts dirty water to clean water', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (s) {
      s.player.homeUpgrades.push('purifier');
      s.player.inventory.slots.push({ itemId: 'dirty_water', quantity: 2 });
    }
  });
  const cleanBefore = await count(page, 'clean_water');

  // Open workbench; the purify action is the 4th entry (after 3 recipes).
  // Separate the presses: a synthetic keypress can be dropped, and landing on a
  // recipe instead of purify would make this test assert the wrong thing.
  await page.keyboard.press('C');
  await page.waitForTimeout(150);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(120);
  }
  await page.keyboard.press('Enter');
  // The flash lives for 1.6s, so read it before the state assertions — several
  // round trips later it is gone.
  await page.waitForTimeout(200);

  // B3-05.2: the flash used to say 「净化了 1 瓶净水」 whatever the real count was,
  // because the string was hardcoded while purifyWater() converted the whole carry
  // and returned `converted`. A player who purified six bottles was told they got
  // one, and would plan the day's water around the wrong number.
  //
  // NOTE: this asserts the message, not that the player can see it. The craft panel
  // is open here and the flash does not render on top of it — see the occlusion
  // finding in docs/B3-05_BUGFIX.md §5. Reading `text` off the object is not proof
  // of visibility, which is the same trap `bagFullWarning.spec.ts` falls into.
  const shown = await page.evaluate(() => {
    const g = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ name?: string; type: string; text?: string; visible: boolean; y: number }> } } | null } };
    }).__PHASER_GAME__;
    // OVERHAUL UI: the HUD is a bar, so the flash sits at HUD_BAR_H + 26. The
    // row is derived from the constant rather than written as a literal: it used
    // to be 56, which was right for a 30px bar and silently wrong the moment the
    // design canvas went to 1280x720 and the bar doubled.
    for (const o of g?.scene.getScene('Game')?.children.list ?? []) {
      if (o.name === 'hud-feedback' && o.visible) return o.text ?? '';
    }
    return '';
  });
  expect(shown, 'the flash must name how many bottles were purified').toContain('2 瓶');
  expect(shown).not.toContain('1 瓶');
  // Evidence of the conversion itself (purifier built, 脏水 exhausted), not of the
  // flash — which the open panel covers.
  await page.screenshot({ path: 'e2e/screenshots/b3-05-2-purify-flash.png' });

  await page.waitForFunction(
    (before) => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      const clean = s?.player.inventory.slots.filter((x) => x.itemId === 'clean_water').reduce((n, x) => n + x.quantity, 0) ?? 0;
      return clean > before;
    },
    cleanBefore,
    { timeout: 5000 },
  );
  expect(await count(page, 'dirty_water')).toBe(0);
  // B3-01: the purifier converts the whole carry, not one bottle, so both dirty
  // waters are gone and two clean ones arrived.
  expect(await count(page, 'clean_water')).toBe(cleanBefore + 2);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
