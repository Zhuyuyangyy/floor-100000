import { expect, test, type Page } from '@playwright/test';

// P0-08 browser tests: keyboard-navigable title menu + help, a pause menu (ESC)
// that resumes, and an inventory item tooltip.

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
  await page.keyboard.press('Enter'); // 开始新游戏
  // A new run lands on the character pick first; the pick screen reports
  // active before create() binds its keys, so settle before confirming.
  await waitForScene(page, 'MetaSelect');
  await page.waitForTimeout(350);
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Game');
}

async function hasVisibleText(page: Page, substr: string): Promise<boolean> {
  return page.evaluate((sub) => {
    const scenes = (window as unknown as { __PHASER_GAME__?: { scene: { scenes: Array<{ children: { list: Array<{ type: string; text?: string; visible: boolean }> } }> } } }).__PHASER_GAME__?.scene.scenes ?? [];
    return scenes.some((sc) => (sc.children.list ?? []).some((o) => o.type === 'Text' && (o.text ?? '').includes(sub) && o.visible));
  }, substr);
}

// The option the arrow marker sits on.
async function selectedOption(page: Page): Promise<string> {
  return page.evaluate(() => {
    const scenes = (window as unknown as { __PHASER_GAME__?: { scene: { scenes: Array<{ children: { list: Array<{ type: string; text?: string; visible: boolean; y: number; texture?: { key?: string } }> } }> } } }).__PHASER_GAME__?.scene.scenes ?? [];
    let my = Number.NaN;
    const texts: Array<{ y: number; text: string }> = [];
    for (const sc of scenes) {
      for (const o of sc.children.list ?? []) {
        if (o.type === 'Image' && o.texture?.key === 'ui-marker' && o.visible) my = o.y;
        if (o.type === 'Text' && o.visible && o.text) texts.push({ y: o.y, text: o.text });
      }
    }
    let best = '(none)';
    let bestD = Infinity;
    for (const t of texts) {
      const d = Math.abs(t.y - my);
      if (d < bestD) {
        bestD = d;
        best = t.text;
      }
    }
    return bestD <= 4 ? best : '(none)';
  });
}

// Whether the licensed arrow sprite is on screen as the selection marker.
async function hasMarkerSprite(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const scenes = (window as unknown as { __PHASER_GAME__?: { scene: { scenes: Array<{ children: { list: Array<{ type: string; texture?: { key?: string }; visible: boolean }> } }> } } }).__PHASER_GAME__?.scene.scenes ?? [];
    return scenes.some((sc) => (sc.children.list ?? []).some((o) => o.type === 'Image' && o.texture?.key === 'ui-marker' && o.visible));
  });
}

// Texture keys of every panel frame piece currently on screen. The frame is eight
// plain Images rather than a NineSlice (see the note in render/panels.ts), so the
// corner pieces are what to look for — they only exist if a frame was built.
async function panelFrames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const scenes = (window as unknown as { __PHASER_GAME__?: { scene: { scenes: Array<{ children: { list: Array<{ type: string; texture?: { key?: string } }> } }> } } }).__PHASER_GAME__?.scene.scenes ?? [];
    const keys: string[] = [];
    for (const sc of scenes) {
      for (const o of sc.children.list ?? []) {
        if (o.type === 'Image' && o.texture?.key?.startsWith('ui-frame-')) keys.push(o.texture.key);
      }
    }
    return keys;
  });
}

test('the title menu is keyboard-navigable and has a help panel', async ({ page }) => {
  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  expect(await hasVisibleText(page, '开始新游戏')).toBe(true);
  expect(await hasVisibleText(page, '操作说明')).toBe(true);
  expect(await hasVisibleText(page, '继续游戏')).toBe(false); // no save yet
  await page.screenshot({ path: 'e2e/screenshots/12-title.png' });

  await page.keyboard.press('ArrowDown'); // -> 操作说明
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  expect(await hasVisibleText(page, 'A/D 或 ←/→ 移动')).toBe(true);
  await page.screenshot({ path: 'e2e/screenshots/13-help.png' });
});

test('ESC opens the pause menu and 继续 resumes the game', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  expect(await hasVisibleText(page, '已暂停')).toBe(true);
  expect(await hasVisibleText(page, '重新开始')).toBe(true);
  await page.screenshot({ path: 'e2e/screenshots/14-pause.png' });

  await page.keyboard.press('Enter'); // 继续游戏
  await page.waitForTimeout(150);
  expect(await hasVisibleText(page, '已暂停')).toBe(false); // closed

  // Responsive again: the player can move.
  const before = await page.evaluate(() => (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { x: number } } } }).__PHASER_SESSION__?.getState().player.x ?? -1);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(300);
  await page.keyboard.up('ArrowRight');
  const after = await page.evaluate(() => (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { x: number } } } }).__PHASER_SESSION__?.getState().player.x ?? -1);
  expect(after).not.toBe(before);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// Regression: MenuScene's per-create caches are class fields, and Phaser does
// not re-run field initialisers on scene restart. 返回标题 re-runs create(), so
// optionTexts must be reset there — otherwise it keeps the previous run's
// objects and refreshOptions() indexes past the end of `entries`, crashing the
// title screen.
test('returning to the title from the pause menu leaves a working title screen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowDown'); // -> 塔楼地图
  await page.waitForTimeout(120);
  await page.keyboard.press('ArrowDown'); // -> 重新开始
  await page.waitForTimeout(120);
  await page.keyboard.press('ArrowDown'); // -> 返回标题
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400); // any crash lands on the next game step

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  await waitForScene(page, 'Menu');

  expect(await hasVisibleText(page, '开始新游戏')).toBe(true);

  // Still keyboard-navigable, which only holds if create() ran to completion.
  await page.keyboard.press('ArrowDown'); // -> 操作说明
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  expect(await hasVisibleText(page, 'A/D 或 ←/→ 移动')).toBe(true);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// GHI-03 M4: a corrupt save must say so. Previously 继续游戏 was listed for any
// save key and pressing it silently did nothing (spec §6: 坏档要提示用户).
test('a corrupt save is reported instead of silently doing nothing', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('floor100000.save.v1', '{ not json');
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  // Two keys delivered inside one frame are unreliable: Phaser re-processes the
  // burst and a single ArrowDown advances the selection twice (reproduced 0/6
  // back-to-back vs 6/6 with a frame between them). Separate the presses.
  await page.waitForTimeout(250);
  expect(await hasVisibleText(page, '继续游戏')).toBe(true); // still listed

  await page.keyboard.press('ArrowDown'); // -> 继续游戏
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  expect(await hasVisibleText(page, '存档损坏')).toBe(true);
  // Still a usable title screen: the new-game entry survives, no white screen.
  await waitForScene(page, 'Menu');
  expect(await hasVisibleText(page, '开始新游戏')).toBe(true);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// GHI-03 M1/M2: a save written before the loot-key migration would pass
// validation and then silently mismatch (looted items respawn), so
// SCHEMA_VERSION was bumped. It must now be refused with a readable reason,
// keeping the new-game entry — not a white screen and not a silent no-op.
test('a save from before the loot-key migration is refused with a reason', async ({ page }) => {
  await page.addInitScript(() => {
    // What 63ee148 and earlier wrote: schemaVersion 1 plus index-style loot keys.
    localStorage.setItem(
      'floor100000.save.v1',
      JSON.stringify({
        schemaVersion: 1,
        runSeed: 42,
        day: 2,
        gameMinuteOfDay: 500,
        currentFloor: 3,
        status: 'playing',
        player: {
          x: 640,
          hp: 90,
          hunger: 70,
          thirst: 65,
          energy: 80,
          equipped: null,
          homeUpgrades: [],
          inventory: { slotCount: 12, slots: [{ itemId: 'battery', quantity: 1 }] },
        },
        npcStates: {},
        visitedFloors: {
          3: { openedContainers: ['crate_wood'], lootedItems: ['g:0', 'c:crate_wood:0'], unlockedDoors: [], localEvents: [] },
        },
        worldEvents: { history: [], activeEvent: null },
      }),
    );
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  expect(await hasVisibleText(page, '继续游戏')).toBe(true); // still listed

  await page.keyboard.press('ArrowDown'); // -> 继续游戏
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  expect(await hasVisibleText(page, '存档损坏')).toBe(true);
  // Still a usable title screen: the new-game entry survives, no white screen.
  await waitForScene(page, 'Menu');
  expect(await hasVisibleText(page, '开始新游戏')).toBe(true);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// GHI-03 m9: Phaser delivered one ArrowDown three times inside a single frame
// whenever another key landed in the same queue drain (measured: frame 28, three
// deliveries of the same event). The menu advanced once per delivery, so the
// selection skipped 继续游戏 and Enter opened the help panel instead of loading
// the save. Menu input is now accepted at most once per key per frame.
const LEGACY_SAVE = JSON.stringify({
  schemaVersion: 2,
  runSeed: 42,
  day: 1,
  gameMinuteOfDay: 360,
  currentFloor: 1,
  status: 'playing',
  player: {
    x: 640,
    hp: 100,
    hunger: 80,
    thirst: 80,
    energy: 80,
    equipped: null,
    homeUpgrades: [],
    inventory: { slotCount: 12, slots: [] },
  },
  npcStates: {},
  visitedFloors: {},
  worldEvents: { history: [], activeEvent: null },
});

test('a keypress is not doubled by another key in the same frame', async ({ page }) => {
  // Three entries need a save; with two, the skip is hidden by the clamp.
  await page.addInitScript((save) => localStorage.setItem('floor100000.save.v1', save), LEGACY_SAVE);
  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  await page.waitForTimeout(250);

  // One ArrowDown immediately followed by Enter — the shape that reproduced it.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  // The selection must still be 继续游戏, so Enter loads the save.
  await waitForScene(page, 'Game');
});

// Guard against over-debouncing: a keypress in a later frame must still register.
test('a lone ArrowDown advances the menu by exactly one entry', async ({ page }) => {
  await page.addInitScript((save) => localStorage.setItem('floor100000.save.v1', save), LEGACY_SAVE);
  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  await page.waitForTimeout(250);

  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(250);
  expect(await selectedOption(page)).toBe('继续游戏');

  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(250);
  expect(await selectedOption(page)).toBe('操作说明');
});

// GHI-04 trial: panels are framed with the licensed nine-slice texture rather
// than a Graphics stroke.
test('the inventory panel is framed with the licensed pixel texture', async ({ page }) => {
  await startGame(page, 42);
  await page.keyboard.press('I');
  await page.waitForTimeout(250);
  expect((await panelFrames(page)).length).toBeGreaterThan(0);
});

test('the pause panel is framed with the licensed pixel texture', async ({ page }) => {
  await startGame(page, 42);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  expect((await panelFrames(page)).length).toBeGreaterThan(0);
});

// GHI-04 follow-up: the panel builders only ever push into their class-field
// arrays, and Phaser does not re-run field initialisers on scene restart — so
// 重新开始 left those arrays holding the previous run's destroyed objects and
// refreshInventory()/togglePause() wrote to the dead ones instead of the visible
// ones. Both panels came up empty, with no error.
test('重新开始 leaves the panels working', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await page.keyboard.press('I');
  await page.waitForTimeout(300);
  // OVERHAUL UI: the bag is an icon grid with a detail pane now, so the bag
  // having rendered shows up as the detail pane naming the selected stack
  // (the old assertion read the removed "净水 ×3" row text).
  expect(await hasVisibleText(page, '净水')).toBe(true);
  expect(await hasVisibleText(page, '持有 3')).toBe(true);
  await page.keyboard.press('Escape'); // close inventory
  await page.waitForTimeout(200);

  // Pause -> 重新开始 (restarts the Game scene).
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('ArrowDown'); // -> 塔楼地图
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowDown'); // -> 重新开始
  await page.waitForTimeout(150);
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
  await page.waitForTimeout(600);

  await page.keyboard.press('I');
  await page.waitForTimeout(300);
  expect(await hasVisibleText(page, '净水'), 'inventory must survive a restart').toBe(true);
  await page.keyboard.press('Escape'); // close inventory
  await page.waitForTimeout(200);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect(await hasVisibleText(page, '已暂停'), 'pause menu must survive a restart').toBe(true);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// GHI-04 follow-up: the text "▶ " prefix is replaced by the licensed arrow
// sprite in all five lists (menu, inventory, crafting, pause, dialogue).
test('the menu marker is the licensed arrow sprite, not a text prefix', async ({ page }) => {
  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  await page.waitForTimeout(250);

  expect(await hasMarkerSprite(page)).toBe(true);
  expect(await hasVisibleText(page, '▶'), 'the ▶ text prefix should be gone').toBe(false);
});

test('the inventory marker is the licensed arrow sprite, not a text prefix', async ({ page }) => {
  await startGame(page, 42);
  await page.keyboard.press('I');
  await page.waitForTimeout(300);

  expect(await hasMarkerSprite(page)).toBe(true);
  expect(await hasVisibleText(page, '▶'), 'the ▶ text prefix should be gone').toBe(false);
});

test('the inventory shows an item tooltip', async ({ page }) => {
  await startGame(page, 42);
  await page.keyboard.press('I');
  await page.waitForTimeout(200);
  // The old single-line tooltip became name / meta / effect across the detail
  // pane. Same claim — the panel tells you what the selected item is and does.
  expect(await hasVisibleText(page, '净水')).toBe(true);
  expect(await hasVisibleText(page, '消耗品')).toBe(true);
  expect(await hasVisibleText(page, '水分 +30')).toBe(true);
  await page.keyboard.press('ArrowDown'); // -> 压缩口粮
  await page.waitForTimeout(120);
  expect(await hasVisibleText(page, '压缩口粮')).toBe(true);
  expect(await hasVisibleText(page, '饱食 +30')).toBe(true);
  await page.screenshot({ path: 'e2e/screenshots/15-inventory-tooltip.png' });
});
