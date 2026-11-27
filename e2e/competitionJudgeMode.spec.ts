import { expect, test, type Page } from '@playwright/test';

interface GameStateProbe {
  currentFloor: number;
  runSeed: number;
  player: { x: number; inventory: { slots: Array<{ itemId: string; quantity: number }> } };
}
interface SceneProbe {
  player?: { x: number };
  stairClimb?: unknown;
  children: { list: Array<{ type: string; text?: string; visible: boolean }> };
}
type WindowProbe = Window & {
  __PHASER_GAME__?: { scene: { getScenes: (running?: boolean) => Array<{ scene: { key: string } }>; getScene: (key: string) => SceneProbe | null } };
  __PHASER_SESSION__?: { getState: () => GameStateProbe | null };
};

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction((sceneKey) => {
    const game = (window as WindowProbe).__PHASER_GAME__;
    return !!game?.scene.getScenes(true).some((scene) => scene.scene.key === sceneKey);
  }, key, { timeout: 20_000 });
}

async function startJudgeGame(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?demo=ai-npc&seed=42');
  await waitForScene(page, 'Menu');
  await expect.poll(() => page.evaluate(() => {
    const menu = (window as WindowProbe).__PHASER_GAME__?.scene.getScene('Menu');
    return menu?.children.list.some((object) => object.visible && (object.text ?? '').includes('开始 AI NPC 试玩')) ?? false;
  })).toBe(true);
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.keyboard.press('Enter');
    const started = await page.waitForFunction(() => {
      const game = (window as WindowProbe).__PHASER_GAME__;
      return !!game?.scene.getScenes(true).some((scene) => scene.scene.key === 'Game');
    }, undefined, { timeout: 2000 }).then(() => true).catch(() => false);
    if (started) break;
  }
  await waitForScene(page, 'Game');
  await expect(page.getByTestId('judge-mode-panel')).toBeVisible();
  await expect(page.getByTestId('judge-mode-toggle')).toContainText('等待中');
  await expect(page.getByTestId('judge-mode-toggle')).toContainText('seed 42');
}

async function moveAndWaitForSceneSync(page: Page, x: number): Promise<void> {
  await page.evaluate((position) => {
    const state = (window as WindowProbe).__PHASER_SESSION__?.getState();
    if (state) state.player.x = position;
  }, x);
  await page.waitForFunction((position) => {
    const w = window as WindowProbe;
    const scene = w.__PHASER_GAME__?.scene.getScene('Game') as SceneProbe | null | undefined;
    return w.__PHASER_SESSION__?.getState()?.player.x === position && scene?.player?.x === position && !scene?.stairClimb;
  }, x, { timeout: 5000 });
}

async function visibleGameText(page: Page, text: string): Promise<boolean> {
  return page.evaluate((needle) => {
    const objects = (window as WindowProbe).__PHASER_GAME__?.scene.getScene('Game')?.children.list ?? [];
    return objects.some((object) => object.type === 'Text' && object.visible && (object.text ?? '').includes(needle));
  }, text);
}

async function waitForNextGameFrame(page: Page): Promise<void> {
  const frame = await page.evaluate(() => (window as WindowProbe & { __PHASER_GAME__?: { getFrame?: () => number } }).__PHASER_GAME__?.getFrame?.() ?? -1);
  await page.waitForFunction((previous) => {
    const current = (window as WindowProbe & { __PHASER_GAME__?: { getFrame?: () => number } }).__PHASER_GAME__?.getFrame?.() ?? -1;
    return current > previous;
  }, frame, { timeout: 5000 });
}

async function cursorLabel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const objects = (window as WindowProbe).__PHASER_GAME__?.scene.getScene('Game')?.children.list ?? [];
    const marker = objects.find((object) => object.type === 'Image' && object.visible && (object as { texture?: { key?: string } }).texture?.key === 'ui-marker') as ({ y: number } | undefined);
    if (!marker) return '';
    return objects.find((object) => object.type === 'Text' && object.visible && Math.abs((object as { y: number }).y - marker.y) <= 6)?.text ?? '';
  });
}

async function selectOption(page: Page, target: string): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt++) {
    if (await cursorLabel(page) === target) return;
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
  }
  throw new Error(`could not select ${target}; cursor=${await cursorLabel(page)}`);
}

test('Judge Mode displays the real Alin gift trace and exports auditable JSON evidence', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startJudgeGame(page);
  await page.getByTestId('judge-mode-toggle').click();
  await expect(page.getByTestId('judge-trace')).toContainText('"npc": null');
  await expect(page.getByTestId('judge-trace')).toContainText('"target": null');

  await moveAndWaitForSceneSync(page, 40);
  await page.keyboard.press('E');
  await page.waitForFunction(() => {
    const w = window as WindowProbe;
    const scene = w.__PHASER_GAME__?.scene.getScene('Game') as SceneProbe | null | undefined;
    return w.__PHASER_SESSION__?.getState()?.currentFloor === 2 && !scene?.stairClimb;
  }, undefined, { timeout: 7000 });
  await moveAndWaitForSceneSync(page, 480);
  await page.keyboard.press('E');
  await expect.poll(() => visibleGameText(page, '阿林（维修工）')).toBe(true);
  await selectOption(page, '赠礼');
  await page.keyboard.press('Enter');
  await expect.poll(() => visibleGameText(page, '赠送 净水×1（持有3）')).toBe(true);
  await waitForNextGameFrame(page);
  await page.keyboard.press('Enter');

  await expect.poll(() => page.getByTestId('judge-trace').textContent()).toContain('"status": "executed"');
  await expect(page.getByTestId('judge-trace')).toContainText('"kind": "give"');
  await expect(page.getByTestId('judge-trace')).toContainText('"committed": true');
  await expect(page.getByTestId('judge-trace')).toContainText('player_gift');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('judge-export').click(),
  ]);
  const stream = await download.createReadStream();
  if (!stream) throw new Error('JSON download did not expose a readable stream');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, any>;
  expect(exported).toMatchObject({ format: 'floor-100000-competition-run', scenario: 'alin-gift', seed: 42, mode: 'offline-fallback' });
  // The exporter exposes verifiable evidence as allow-listed snapshots, state hashes,
  // actual state delta and event feedback (rather than serializing GameState).
  expect(exported.hashes).toMatchObject({ stateBefore: expect.any(String), stateAfter: expect.any(String) });
  expect(exported.observation.world.currentFloor).toBe(2);
  expect(exported.actualStateDelta.inventory).toHaveLength(2);
  expect(exported.evidence).toMatchObject({
    stateBefore: { currentFloor: 2 },
    stateAfter: { currentFloor: 2 },
    hashes: { stateBefore: expect.any(String), stateAfter: expect.any(String) },
    actualStateDelta: { inventory: expect.any(Array) },
  });
  expect(exported.feedback[0]).toMatchObject({ attempt: 1, status: 'executed', proposal: { kind: 'give' } });
  expect(JSON.stringify(exported)).toContain('player_gift');
  expect(errors).toEqual([]);
});

// 第二 NPC 的关键证据：给小周赠礼必须只改小周。评审最容易被糊弄的地方就是
// 「看起来两个 NPC 都活着，其实只有阿林一条数据被反复写」。所以这里断言
// 导出物里两人的库存分别是什么，而不只是「状态变了」。
test('Xiaozhou gift changes only Xiaozhou and exports a social-gift trace', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startJudgeGame(page);
  await page.getByTestId('judge-mode-toggle').click();

  await moveAndWaitForSceneSync(page, 40);
  await page.keyboard.press('E');
  await page.waitForFunction(() => {
    const w = window as WindowProbe;
    const scene = w.__PHASER_GAME__?.scene.getScene('Game') as SceneProbe | null | undefined;
    return w.__PHASER_SESSION__?.getState()?.currentFloor === 2 && !scene?.stairClimb;
  }, undefined, { timeout: 7000 });

  // 小周在 x=800。给他一件背包里确定有的东西。
  await moveAndWaitForSceneSync(page, 800);
  await page.keyboard.press('E');
  await expect.poll(() => visibleGameText(page, '小周（邻居）')).toBe(true);
  await selectOption(page, '赠礼');
  await page.keyboard.press('Enter');
  await expect.poll(() => visibleGameText(page, '赠送 ')).toBe(true);
  await waitForNextGameFrame(page);
  await page.keyboard.press('Enter');

  await expect.poll(() => page.getByTestId('judge-trace').textContent(), { timeout: 10_000 })
    .toContain('"status": "executed"');
  await expect(page.getByTestId('judge-trace')).toContainText('"committed": true');
  // 面板必须报真实焦点，不能把两个人的记录都标成阿林。
  await expect(page.getByTestId('judge-trace')).toContainText('小周');
  await expect(page.getByTestId('judge-trace')).toContainText('player_gift');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('judge-export').click(),
  ]);
  const stream = await download.createReadStream();
  if (!stream) throw new Error('JSON download did not expose a readable stream');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, any>;

  expect(exported).toMatchObject({ format: 'floor-100000-competition-run', scenario: 'social-gift', seed: 42 });
  // 快照里两人同时在场；小周多了净水，阿林必须一件都没有。
  //
  // 这里断「包含」而不是「恰好 1 件」：赠礼菜单执行后仍停在同一层，多按一次
  // Enter 会再赠一件（既有行为，与本次改动无关）。真正要证明的是隔离——
  // 给小周送礼，阿林那条记录根本不该被创建。
  const npcsAfter = exported.world.stateAfter.npcs as Array<{ npcId: string; inventory: Array<{ itemId: string }> }>;
  const zhouInventory = npcsAfter.find((npc) => npc.npcId === 'xiaozhou')?.inventory ?? [];
  expect(zhouInventory.length).toBeGreaterThanOrEqual(1);
  expect(zhouInventory.some((stack) => stack.itemId === 'clean_water')).toBe(true);
  expect(npcsAfter.find((npc) => npc.npcId === 'alin')?.inventory).toEqual([]);
  expect(JSON.stringify(exported)).toContain('player_gift');
  expect(errors).toEqual([]);
});
