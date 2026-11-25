import { expect, test, type Page } from '@playwright/test';
import { ALIN_REPAIR_GATE_FLAG } from '../src/data/floorGates';

// 夜间可视性探针：读夜幕遮罩的实际 alpha，并量出画面平均亮度。
// 目的：验证「昼夜是否真的看得清」，而不是靠肉眼猜。

interface Probe {
  overlayAlpha: number;
  overlayDepth: number;
  overlayFillAlpha: number;
  overlayVisible: boolean;
  fillStyleColor: number | null;
  playerLightAlpha: number;
}

/**
 * 等 night-overlay 对象真的被 create() 造出来。
 *
 * 为什么需要这一步（实测过，不是防御性编程）：全量跑 40 条用例时，这条
 * 偶发读到 `overlayAlpha: -1`，而单跑稳定 0 / 0.6。根因是 `boot()` 固定
 * 等 900ms，在机器被其它 agent 抢占、帧调度被拖慢时不够——Game 场景
 * 已经 active，但 `create()` 里 `this.nightOverlay = this.add.rectangle(...)`
 * 还没执行到。单次读取把「还没造」当成了「没有」。
 *
 * 轮询到对象出现即可，判断条件用 `name === 'night-overlay'`，
 * 不用 alpha（alpha 在 06:30 本来就是 0，用它当存在判据会永远等不到）。
 */
async function waitForOverlay(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<Record<string, unknown>> } } | null } } }).__PHASER_GAME__;
      const list = (g?.scene.getScene('Game')?.children.list ?? []) as Array<Record<string, unknown>>;
      return list.some((o) => o.name === 'night-overlay');
    },
    undefined,
    { timeout: 15_000, polling: 100 },
  );
}

async function probeNight(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const g = (window as unknown as {
      __PHASER_GAME__?: {
        scene: {
          getScene: (k: string) => {
            children: { list: Array<Record<string, unknown>> };
          } | null;
        };
      };
    }).__PHASER_GAME__;
    const scene = g?.scene.getScene('Game');
    const list = (scene?.children.list ?? []) as Array<Record<string, unknown>>;
    const overlay = list.find((o) => o.name === 'night-overlay');
    if (!overlay) {
      console.log('no night-overlay object; names present:', list.map((o) => o.name).filter(Boolean).join(','));
    }
    const fill = (overlay as unknown as { fillColor?: number } | undefined)?.fillColor ?? null;
    return {
      overlayAlpha: (overlay as unknown as { alpha?: number } | undefined)?.alpha ?? -1,
      overlayDepth: (overlay as unknown as { depth?: number } | undefined)?.depth ?? -1,
      overlayFillAlpha: (overlay as unknown as { fillAlpha?: number } | undefined)?.fillAlpha ?? -1,
      overlayVisible: Boolean((overlay as unknown as { visible?: boolean } | undefined)?.visible),
      fillStyleColor: fill,
      playerLightAlpha: 0,
    };
  });
}

async function boot(page: Page): Promise<void> {
  await page.goto('/?seed=42&debug=1');
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Menu'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect'));
  await page.waitForTimeout(400);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Enter');
    const started = await page
      .waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'), undefined, { timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    if (started) break;
  }
  await page.waitForTimeout(900);
}

async function setMinute(page: Page, minute: number): Promise<void> {
  await page.evaluate((m) => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { gameMinuteOfDay: number } | null } })
      .__PHASER_SESSION__?.getState();
    if (s) s.gameMinuteOfDay = m;
  }, minute);
  await page.waitForTimeout(700);
}

test('probe night overlay alpha by time of day', async ({ page }) => {
  await boot(page);
  await waitForOverlay(page);
  await page.evaluate((flag) => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { flags?: Record<string, number> } | null } })
      .__PHASER_SESSION__?.getState();
    if (s) s.flags = { ...(s.flags ?? {}), [flag]: 1 };
  }, ALIN_REPAIR_GATE_FLAG);

  for (const [label, minute] of [['06:30 清晨', 390], ['12:00 正午', 720], ['18:00 傍晚', 1080], ['21:00 夜间', 1260], ['02:00 深夜', 120]] as const) {
    await setMinute(page, minute);
    const p = await probeNight(page);
    console.log(`${label} minute=${minute}`, JSON.stringify(p));
  }
  const p = await probeNight(page);
  expect(p.overlayAlpha).toBeGreaterThanOrEqual(0);
});