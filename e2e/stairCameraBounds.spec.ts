import { expect, test, type Page } from '@playwright/test';

test.setTimeout(90_000);

interface CameraSample {
  floor: number;
  progress: number;
  playerTop: number;
  playerBottom: number;
  cameraScrollY: number;
}

interface CameraBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function startGame(page: Page): Promise<void> {
  await page.goto('/?seed=42');
  await page.waitForFunction(() => {
    const game = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (active?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
    return !!game && game.scene.getScenes(true).some((scene) => scene.scene.key === 'Menu');
  }, undefined, { timeout: 30_000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const game = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (active?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
    return !!game && game.scene.getScenes(true).some((scene) => ['MetaSelect', 'Game'].includes(scene.scene.key));
  }, undefined, { timeout: 15_000 });
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.keyboard.press('Enter');
    if (await page.waitForFunction(() => {
      const game = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (active?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
      return !!game && game.scene.getScenes(true).some((scene) => scene.scene.key === 'Game');
    }, undefined, { timeout: 2000 }).then(() => true).catch(() => false)) return;
  }
  throw new Error('Game scene did not start after character selection');
}

async function moveToStair(page: Page, direction: 'up' | 'down'): Promise<void> {
  const key = direction === 'up' ? 'ArrowLeft' : 'ArrowRight';
  await page.keyboard.down(key);
  await page.waitForFunction((dir) => {
    const x = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { x: number } } | null } }).__PHASER_SESSION__?.getState()?.player.x;
    return dir === 'up' ? x !== undefined && x < 44 : x !== undefined && x > 1236;
  }, direction, { timeout: 20_000 });
  await page.keyboard.up(key);
}

async function startClimb(page: Page, floor: number): Promise<void> {
  await page.keyboard.press('E');
  await page.waitForFunction((target) => {
    const w = window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (key: string) => { stairClimb?: unknown } | null } };
      __PHASER_SESSION__?: { getState: () => { currentFloor: number } | null };
    };
    return w.__PHASER_SESSION__?.getState()?.currentFloor === target && !!w.__PHASER_GAME__?.scene.getScene('Game')?.stairClimb;
  }, floor, { timeout: 5000 });
}

async function waitForLanding(page: Page, floor: number): Promise<void> {
  await page.waitForFunction((target) => {
    const w = window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (key: string) => { stairClimb?: unknown } | null } };
      __PHASER_SESSION__?: { getState: () => { currentFloor: number } | null };
    };
    return w.__PHASER_SESSION__?.getState()?.currentFloor === target && !w.__PHASER_GAME__?.scene.getScene('Game')?.stairClimb;
  }, floor, { timeout: 5000 });
}

async function readCameraBounds(page: Page): Promise<CameraBounds> {
  return page.evaluate(() => {
    const game = (window as unknown as {
      __PHASER_GAME__?: {
        scene: {
          getScene: (key: string) => {
            cameras: { main: { getBounds: () => CameraBounds } };
          } | null;
        };
      };
    }).__PHASER_GAME__;
    const rect = game?.scene.getScene('Game')?.cameras.main.getBounds();
    if (!rect) throw new Error('Game camera bounds are unavailable');
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
}

async function sampleDuringClimb(page: Page, elapsedThreshold: number): Promise<CameraSample> {
  const handle = await page.waitForFunction((threshold) => {
    const w = window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (key: string) => {
        stairClimb?: { elapsedMs: number; durationMs: number };
        cameras: { main: { scrollY: number; zoom: number } };
        player?: { y?: number; displayHeight?: number };
      } | null } };
      __PHASER_SESSION__?: { getState: () => { currentFloor: number; player: { x: number } } | null };
    };
    const scene = w.__PHASER_GAME__?.scene.getScene('Game');
    const state = w.__PHASER_SESSION__?.getState();
    const climb = scene?.stairClimb;
    const player = scene?.player;
    if (!scene || !state || !player || typeof player.y !== 'number' || typeof player.displayHeight !== 'number' || !climb || climb.elapsedMs < threshold) return false;
    const camera = scene.cameras.main;
    return {
      floor: state.currentFloor,
      progress: climb.elapsedMs / climb.durationMs,
      playerTop: (player.y - player.displayHeight - camera.scrollY) * camera.zoom,
      playerBottom: (player.y - camera.scrollY) * camera.zoom,
      cameraScrollY: camera.scrollY,
    };
  }, elapsedThreshold, { timeout: 5000 });
  return await handle.jsonValue() as CameraSample;
}

test('keeps the full survivor visible at the first and fifth floor stair endpoints', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await startGame(page);
  const samples: Array<{ label: string; sample: CameraSample }> = [];

  await moveToStair(page, 'up');
  await startClimb(page, 1);
  samples.push({ label: 'floor 1 up', sample: await sampleDuringClimb(page, 800) });
  await waitForLanding(page, 2);
  const normalMidFloorBounds = await readCameraBounds(page);
  await page.screenshot({ path: 'output/stair-camera-floor2-landed.png' });

  for (const floor of [2, 3, 4]) {
    await startClimb(page, floor);
    await waitForLanding(page, floor + 1);
  }
  await moveToStair(page, 'down');
  await startClimb(page, 5);
  samples.push({ label: 'floor 5 down', sample: await sampleDuringClimb(page, 800) });
  await waitForLanding(page, 4);
  const restoredMidFloorBounds = await readCameraBounds(page);
  await page.screenshot({ path: 'output/stair-camera-floor4-landed.png' });

  const unsafe = samples.filter(({ sample }) => sample.playerTop < 136 || sample.playerBottom > 668);
  expect(unsafe, `actor overlaps the fixed HUD or leaves the visible play area: ${JSON.stringify(samples)}`).toEqual([]);
  expect(restoredMidFloorBounds, 'landing after floor 5 descent restores the normal mid-floor camera bounds').toEqual(normalMidFloorBounds);
  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
});
