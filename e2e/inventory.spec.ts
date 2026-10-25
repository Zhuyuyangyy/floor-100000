import { expect, test, type Page } from '@playwright/test';

// P0-03 browser tests: looting a container fills the bag, a saved+reloaded game
// does not re-spawn loot, and consumables change survival stats (clamped).

interface State {
  currentFloor: number;
  player: { x: number; thirst: number; hunger: number; hp: number; inventory: { slots: Array<{ itemId: string; quantity: number }> } };
}

async function readState(page: Page): Promise<State> {
  return page.evaluate(() => {
    const handle = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__;
    const s = handle?.getState();
    if (!s) throw new Error('no session');
    return s;
  });
}

async function waterCount(page: Page): Promise<number> {
  const s = await readState(page);
  return s.player.inventory.slots.find((x) => x.itemId === 'clean_water')?.quantity ?? 0;
}

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === k);
    },
    key,
    { timeout: 15_000 },
  );
}

async function startGame(page: Page, seed: number): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Game');
}

async function walkLeftTo(page: Page, x: number): Promise<void> {
  await page.keyboard.down('ArrowLeft');
  await page.waitForFunction(
    (target) => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      return !!s && s.player.x <= target;
    },
    x,
    { timeout: 20_000 },
  );
  await page.keyboard.up('ArrowLeft');
}

test('looting a container fills the bag and a reload does not re-loot', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  // 100000 cabinet (x=160) holds a guaranteed 净水. Walk to it and open it.
  await walkLeftTo(page, 204);
  const before = await waterCount(page);
  await page.keyboard.press('E');
  await page.waitForFunction(
    (w0) => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      const w = s?.player.inventory.slots.find((x) => x.itemId === 'clean_water')?.quantity ?? 0;
      return w > w0;
    },
    before,
    { timeout: 5000 },
  );
  const afterLoot = await waterCount(page);
  expect(afterLoot).toBeGreaterThan(before);

  // Reload: the run resumes from LocalStorage; the cabinet must stay empty.
  await page.reload();
  await waitForScene(page, 'Game');
  await page.waitForFunction(
    (w) => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      return (s?.player.inventory.slots.find((x) => x.itemId === 'clean_water')?.quantity ?? 0) === w;
    },
    afterLoot,
    { timeout: 10_000 },
  );

  await walkLeftTo(page, 190);
  await page.keyboard.press('E');
  await page.waitForTimeout(250);
  expect(await waterCount(page)).toBe(afterLoot); // no re-loot

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('inventory panel opens and using a consumable raises a clamped stat', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  const before = await readState(page);
  const thirstBefore = before.player.thirst;

  // Open inventory (I). Slot 0 is the starting 净水 x3.
  await page.keyboard.press('I');
  const panelShowsWater = await page.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean }> } } | null } } }).__PHASER_GAME__;
    const list = g?.scene.getScene('Game')?.children.list ?? [];
    return list.some((o) => o.type === 'Text' && (o.text ?? '').includes('净水 ×3') && o.visible);
  });
  expect(panelShowsWater).toBe(true);
  await page.screenshot({ path: 'e2e/screenshots/05-inventory.png' });

  // Use the selected consumable (Enter): restores ~30 thirst, clamped to max.
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    (t0) => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
      return !!s && s.player.thirst >= t0 + 20;
    },
    thirstBefore,
    { timeout: 5000 },
  );
  const after = await readState(page);
  expect(after.player.thirst).toBeGreaterThan(thirstBefore); // restored
  expect(after.player.thirst).toBeLessThanOrEqual(100); // clamped, never overflows
  expect(after.player.inventory.slots.find((x) => x.itemId === 'clean_water')?.quantity ?? 0).toBe(2);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
