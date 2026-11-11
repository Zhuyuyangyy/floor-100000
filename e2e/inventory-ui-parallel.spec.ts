import { expect, test, type Page } from '@playwright/test';

interface InventoryState {
  player: {
    thirst: number;
    inventory: { slotCount: number; slots: Array<{ itemId: string; quantity: number }> };
  };
}

interface PhaserChild {
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  visible?: boolean;
  text?: string;
  texture?: { key?: string };
}

async function readState(page: Page): Promise<InventoryState> {
  return page.evaluate(() => {
    const session = (window as unknown as {
      __PHASER_SESSION__?: { getState: () => InventoryState | null };
    }).__PHASER_SESSION__;
    const state = session?.getState();
    if (!state) throw new Error('no session');
    return state;
  });
}

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (sceneKey) => {
      const game = (window as unknown as {
        __PHASER_GAME__?: { scene: { getScenes: (running?: boolean) => Array<{ scene: { key: string } }> } };
      }).__PHASER_GAME__;
      return !!game && game.scene.getScenes(true).some((entry) => entry.scene.key === sceneKey);
    },
    key,
    { timeout: 15_000 },
  );
}

async function startGame(page: Page, seed: number): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  // The selection scene becomes active just before its keyboard handlers bind.
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.keyboard.press('Enter');
    const started = await page.waitForFunction(
      () => {
        const game = (window as unknown as {
          __PHASER_GAME__?: { scene: { getScenes: (running?: boolean) => Array<{ scene: { key: string } }> } };
        }).__PHASER_GAME__;
        return !!game && game.scene.getScenes(true).some((entry) => entry.scene.key === 'Game');
      },
      undefined,
      { timeout: 2_000 },
    ).then(() => true).catch(() => false);
    if (started) break;
  }
  await waitForScene(page, 'Game');
}

async function visibleTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const game = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (key: string) => { children: { list: PhaserChild[] } } | null } };
    }).__PHASER_GAME__;
    const children = game?.scene.getScene('Game')?.children.list ?? [];
    return children.filter((child) => child.type === 'Text' && child.visible).map((child) => child.text ?? '');
  });
}

async function inventoryIsVisible(page: Page): Promise<boolean> {
  return (await visibleTexts(page)).some((text) => text === '背包');
}

test('inventory UI keeps a 4x3 item grid, matching icons, navigation, use and close keys', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await startGame(page, 42);
  await page.keyboard.press('I');
  await page.waitForFunction(() => {
    const game = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (key: string) => { children: { list: PhaserChild[] } } | null } };
    }).__PHASER_GAME__;
    const children = game?.scene.getScene('Game')?.children.list ?? [];
    return children.some((child) => child.type === 'Text' && child.visible && child.text === '背包');
  });

  const gridAndIconData = await page.evaluate(() => {
    const game = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (key: string) => { children: { list: PhaserChild[] } } | null } };
    }).__PHASER_GAME__;
    const children = game?.scene.getScene('Game')?.children.list ?? [];
    const state = (window as unknown as {
      __PHASER_SESSION__?: { getState: () => InventoryState | null };
    }).__PHASER_SESSION__?.getState();
    if (!state) throw new Error('no session');

    const cells = children
      .filter((child) => child.type === 'Rectangle'
        && child.visible === true
        && child.width === 56
        && child.height === 56
        && typeof child.x === 'number'
        && typeof child.y === 'number')
      .map((child) => ({ x: child.x!, y: child.y! }))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const columns = [...new Set(cells.map((cell) => cell.x))].sort((a, b) => a - b);
    const rows = [...new Set(cells.map((cell) => cell.y))].sort((a, b) => a - b);
    const populatedIcons: Array<{ slot: number; itemId: string; textureKey: string | undefined }> = [];

    for (let slot = 0; slot < cells.length; slot++) {
      const cell = cells[slot];
      const item = state.player.inventory.slots[slot];
      if (item) {
        const icon = children.find((child) => child.type === 'Image'
          && child.visible === true
          && Math.abs((child.x ?? Number.NaN) - (cell.x + 28)) < 0.01
          && Math.abs((child.y ?? Number.NaN) - (cell.y + 18)) < 0.01);
        populatedIcons.push({ slot, itemId: item.itemId, textureKey: icon?.texture?.key });
      }
    }
    return {
      slotCount: state.player.inventory.slotCount,
      itemCount: state.player.inventory.slots.length,
      cells,
      columns,
      rows,
      populatedIcons,
    };
  });

  expect(gridAndIconData.slotCount).toBe(12);
  expect(gridAndIconData.cells, 'all twelve visible slot backgrounds must exist').toHaveLength(12);
  expect(gridAndIconData.columns).toHaveLength(4);
  expect(gridAndIconData.rows).toHaveLength(3);
  for (let i = 1; i < gridAndIconData.columns.length; i++) {
    expect(gridAndIconData.columns[i] - gridAndIconData.columns[i - 1]).toBe(64);
  }
  for (let i = 1; i < gridAndIconData.rows.length; i++) {
    expect(gridAndIconData.rows[i] - gridAndIconData.rows[i - 1]).toBe(64);
  }
  expect(gridAndIconData.itemCount).toBeGreaterThan(0);
  for (const icon of gridAndIconData.populatedIcons) {
    expect(icon.textureKey, `slot ${icon.slot} icon must use its real itemId texture`).toBe(icon.itemId);
  }

  let texts = await visibleTexts(page);
  expect(texts).toContain('净水');
  expect(texts.some((text) => text.includes('持有 3'))).toBe(true);
  expect(texts).toContain('水分 +30');

  await page.keyboard.press('ArrowDown');
  await expect.poll(() => visibleTexts(page)).toContain('压缩口粮');
  texts = await visibleTexts(page);
  expect(texts.some((text) => text.includes('持有 2'))).toBe(true);
  expect(texts).toContain('饱食 +30');

  await page.keyboard.press('ArrowUp');
  await expect.poll(() => visibleTexts(page)).toContain('净水');
  const beforeUse = await readState(page);
  const waterBefore = beforeUse.player.inventory.slots.find((slot) => slot.itemId === 'clean_water')?.quantity ?? 0;
  const thirstBefore = beforeUse.player.thirst;

  await page.keyboard.press('Enter');
  await page.waitForFunction(
    ({ previousThirst, previousWater }) => {
      const state = (window as unknown as {
        __PHASER_SESSION__?: { getState: () => InventoryState | null };
      }).__PHASER_SESSION__?.getState();
      const water = state?.player.inventory.slots.find((slot) => slot.itemId === 'clean_water')?.quantity ?? 0;
      return !!state && state.player.thirst >= previousThirst + 20 && water === previousWater - 1;
    },
    { previousThirst: thirstBefore, previousWater: waterBefore },
    { timeout: 5_000 },
  );
  expect(await inventoryIsVisible(page), 'using an item should leave the bag open').toBe(true);

  // Both existing close routes should close only the inventory panel.
  await page.keyboard.press('I');
  await expect.poll(() => inventoryIsVisible(page)).toBe(false);
  await page.keyboard.press('I');
  await expect.poll(() => inventoryIsVisible(page)).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => inventoryIsVisible(page)).toBe(false);
  expect((await visibleTexts(page)).some((text) => text.includes('已暂停'))).toBe(false);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
