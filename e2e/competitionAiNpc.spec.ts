import { expect, test, type Page } from '@playwright/test';

interface GameInventoryStack { itemId: string; quantity: number; meta?: Record<string, string> }
interface State {
  currentFloor: number;
  day: number;
  runSeed: number;
  gameMinuteOfDay: number;
  player: { x: number; inventory: { slots: GameInventoryStack[] } };
  npcStates: Record<string, string>;
  flags?: Record<string, number>;
}
interface PhaserSceneProbe {
  dialogueOpen?: boolean;
  dialogue?: { selected: number; message: string; messageSource: string } | null;
  lastAlinRepairResult?: {
    status: string;
    decisionSource: string;
    attempts: number;
    validation: { accepted: boolean; reason?: string; detailCode?: string } | null;
    beforeHash: string;
    afterHash: string;
    before: { player: { inventory: GameInventoryStack[] }; npcs: Array<{ trust: number; memory: unknown[]; inventory: unknown[] }>; gates: Array<{ status: string }> };
    after: { player: { inventory: GameInventoryStack[] }; npcs: Array<{ trust: number; memory: unknown[]; inventory: unknown[] }>; gates: Array<{ status: string }> };
  };
  player?: { x: number };
  stairClimb?: unknown;
}

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction((k) => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
    return !!g && g.scene.getScenes(true).some((s) => s.scene.key === k);
  }, key, { timeout: 20_000 });
}

async function startGame(page: Page, seed: number): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const started = await page.waitForFunction(() => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
    }, undefined, { timeout: 2000 }).then(() => true).catch(() => false);
    if (started) break;
  }
  await waitForScene(page, 'Game');
}

async function getState(page: Page): Promise<State> {
  return page.evaluate(() => {
    const state = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (!state) throw new Error('missing game state');
    return state;
  });
}

async function setPlayerX(page: Page, x: number): Promise<void> {
  await page.evaluate((value) => {
    (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState()?.player &&
      ((window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__!.getState()!.player.x = value);
  }, x);
}

async function goToAlinFloor(page: Page): Promise<void> {
  await setPlayerX(page, 40);
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (key: string) => PhaserSceneProbe | null } };
      __PHASER_SESSION__?: { getState: () => State | null };
    };
    return w.__PHASER_SESSION__?.getState()?.currentFloor === 1 &&
      w.__PHASER_SESSION__?.getState()?.player.x === 40 &&
      w.__PHASER_GAME__?.scene.getScene('Game')?.player?.x === 40 &&
      !w.__PHASER_GAME__?.scene.getScene('Game')?.stairClimb;
  }, undefined, { timeout: 5000 });
  await page.keyboard.press('E');
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (key: string) => PhaserSceneProbe | null } };
      __PHASER_SESSION__?: { getState: () => State | null };
    };
    return w.__PHASER_SESSION__?.getState()?.currentFloor === 2 && !w.__PHASER_GAME__?.scene.getScene('Game')?.stairClimb;
  }, undefined, { timeout: 5000 });
}

async function hasVisibleText(page: Page, text: string): Promise<boolean> {
  return page.evaluate((needle) => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean }> } } | null } } }).__PHASER_GAME__;
    return (g?.scene.getScene('Game')?.children.list ?? []).some((o) => o.type === 'Text' && o.visible && (o.text ?? '').includes(needle));
  }, text);
}

async function cursorLabel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean; y: number; texture?: { key?: string }; depth?: number }> } } | null } } }).__PHASER_GAME__;
    const list = g?.scene.getScene('Game')?.children.list ?? [];
    const marker = list.find((o) => o.type === 'Image' && o.texture?.key === 'ui-marker' && o.visible);
    if (!marker) return '';
    return list.find((o) => o.type === 'Text' && o.visible && (o.depth ?? 0) >= 190 && Math.abs(o.y - marker.y) <= 6)?.text ?? '';
  });
}

async function selectOption(page: Page, target: string): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const label = await cursorLabel(page);
    if (label === target) return;
    await page.keyboard.press(label === '交易' || label === '退出' ? 'ArrowUp' : 'ArrowDown');
    await page.waitForTimeout(100);
  }
  throw new Error(`could not select ${target}; current=${await cursorLabel(page)}`);
}

async function readSceneResult(page: Page): Promise<PhaserSceneProbe['lastAlinRepairResult']> {
  return page.evaluate(() => (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => PhaserSceneProbe | null } } }).__PHASER_GAME__?.scene.getScene('Game')?.lastAlinRepairResult);
}

test('阿林维修门交互使用 offline-fallback，经校验安全拒绝低信任提案并可核验真实状态', async ({ page }) => {
  const errors: string[] = [];
  await page.setViewportSize({ width: 390, height: 844 });
  page.on('pageerror', (error) => errors.push(error.message));
  await startGame(page, 64211);
  await goToAlinFloor(page);
  await page.evaluate(() => {
    const state = (window as unknown as { __PHASER_SESSION__?: { getState: () => State | null } }).__PHASER_SESSION__?.getState();
    if (state) state.player.inventory.slots.push({ itemId: 'wood', quantity: 2 });
  });
  await setPlayerX(page, 480);
  await page.keyboard.press('E');
  await expect.poll(() => hasVisibleText(page, '阿林（维修工）')).toBe(true);
  await selectOption(page, '维修门计划');
  await page.keyboard.press('Enter');

  await expect.poll(async () => (await readSceneResult(page))?.status).toBe('blocked');
  await expect.poll(async () => hasVisibleText(page, '信任35/70｜拒绝')).toBe(true);

  const state = await getState(page);
  const rawNpc = JSON.parse(state.npcStates.alin!) as { relationship: Record<string, number>; memory: unknown[] };
  const result = await readSceneResult(page);
  expect(result?.decisionSource).toBe('offline-fallback');
  expect(result?.attempts).toBe(2);
  expect(result?.validation).toMatchObject({ accepted: false, reason: 'low_trust' });
  expect(result?.beforeHash).toBe(result?.afterHash);
  expect(result?.before.gates[0]?.status).toBe('closed');
  expect(result?.after.gates[0]?.status).toBe('closed');
  expect(result?.before.player.inventory).toEqual(result?.after.player.inventory);
  expect(state.player.inventory.slots.find((stack) => stack.itemId === 'wood')?.quantity).toBe(2);
  expect(rawNpc.relationship.player).toBe(35);
  expect(rawNpc.memory).toEqual([]);
  expect(state.flags?.['story:alin-repair-gate']).toBeUndefined();
  expect(errors).toEqual([]);
});
