import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../src/core/gameTypes';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../src/core/design';
import { HUD_LAYOUT } from '../src/render/hudLayout';

// AG-54：HUD 圆环实测探针。概念图没找到（全库搜过），圆环是按现有铆钉板语言
// 重画的 12 段仪表，本探针钉三件事：
//   1. 重组不丢信息——四组环的 8 个文本（label+value）都在，且都在板内、
//      不互压（15% 阈值）、不出画布；目标行仍压在环境行上方；
//   2. 数值住在环井里——value 的 bounds 不宽于 (ringR-ringStroke)*2，且水平
//      居中于各自的环；
//   3. 低血变色——hp/hunger 打到 20% 以下，环的点亮段换危险红（截图 + 像素
//      抽查由跑后脚本 tools 外的分析完成，见 output/ag54/ 的裁剪图）。

async function startGame(page: Page): Promise<void> {
  await page.goto('/?seed=42');
  const sceneIs = (key: string): Promise<void> => page.waitForFunction(
    (k) => !!window.__PHASER_GAME__?.scene.getScenes(true).some((scene) => scene.scene.key === k), key,
  ).then(() => undefined);
  await sceneIs('Menu');
  await page.keyboard.press('Enter');
  await sceneIs('MetaSelect');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const ready = await page.waitForFunction(
      () => window.__PHASER_GAME__?.scene.getScenes(true).some((scene) => scene.scene.key === 'Game'),
      undefined, { timeout: 2000 },
    ).then(() => true).catch(() => false);
    if (ready) break;
  }
  await sceneIs('Game');
}

interface HudBound { name: string; text: string; x: number; y: number; width: number; height: number }

async function bounds(page: Page): Promise<HudBound[]> {
  return page.evaluate(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as {
      children: { list: Array<{ type: string; name: string; text: string; visible: boolean; getBounds(): { x: number; y: number; width: number; height: number } }> };
    };
    return scene.children.list.filter((o) => o.type === 'Text' && o.visible && o.name.startsWith('hud-')).map((o) => {
      const b = o.getBounds();
      return { name: o.name, text: o.text, x: b.x, y: b.y, width: b.width, height: b.height };
    });
  });
}

/** The ring strip in SCREEN pixels, for the clipped colour screenshots. */
async function ringClip(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const rect = canvas?.getBoundingClientRect();
    if (!rect) throw new Error('no canvas');
    const scale = rect.width / 1280;
    const left = 284;
    const right = 922;
    // rect.y is the canvas's top on the PAGE (the letterbox bar when the
    // viewport is not 16:9), so the clip's y is rect.y itself — the design
    // strip starts at the canvas's top edge, y=0.
    return { x: rect.x + left * scale, y: rect.y, width: (right - left) * scale, height: 50 * scale };
  });
}

const STAT_KEYS = ['hp', 'hunger', 'thirst', 'energy'] as const;

for (const viewport of [{ width: 900, height: 600 }, { width: 1280, height: 800 }, { width: 1920, height: 1080 }]) {
  test(`AG-54 rings hold the HUD contract at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => { if (response.status() === 404 && !response.url().endsWith('/favicon.ico')) errors.push(`404 ${response.url()}`); });
    await page.setViewportSize(viewport);
    await startGame(page);
    await expect.poll(async () => (await bounds(page)).find((o) => o.name === 'hud-goal')?.text).toContain('目标');

    // ── 1. nothing lost: all eight ring texts exist with live values ───────
    const day = await bounds(page);
    for (const key of STAT_KEYS) {
      const label = day.find((o) => o.name === `hud-stat-${key}`);
      const value = day.find((o) => o.name === `hud-value-${key}`);
      expect(label?.text, `hud-stat-${key} label`).toBe(['生命', '饥饿', '口渴', '精力'][STAT_KEYS.indexOf(key)]);
      expect(value?.text, `hud-value-${key} value`).toMatch(/^[0-9]+$/);
    }
    // The rest of the plate is untouched: floor, clock, money, goal, environment.
    for (const name of ['hud-floor', 'hud-clock', 'hud-gold', 'hud-score', 'hud-goal', 'hud-environment', 'hud-region', 'hud-humid', 'hud-night']) {
      expect(day.find((o) => o.name === name), `${name} still on the plate`).toBeTruthy();
    }

    // ── 2. every HUD text inside the canvas, none overlapping ─────────────
    for (const entry of day) {
      expect(entry.x, `${entry.name} starts on canvas`).toBeGreaterThanOrEqual(0);
      expect(entry.y).toBeGreaterThanOrEqual(0);
      expect(entry.x + entry.width, `${entry.name} right bound: ${entry.text}`).toBeLessThanOrEqual(DESIGN_WIDTH);
      expect(entry.y + entry.height, `${entry.name} bottom bound: ${entry.text}`).toBeLessThanOrEqual(DESIGN_HEIGHT);
    }
    const collisions: string[] = [];
    for (let i = 0; i < day.length; i++) {
      for (let j = i + 1; j < day.length; j++) {
        const a = day[i];
        const b = day[j];
        const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (w <= 1 || h <= 1) continue;
        const smaller = Math.min(a.width * a.height, b.width * b.height);
        if (smaller > 0 && (w * h) / smaller > 0.15) collisions.push(`"${a.name}" x "${b.name}"`);
      }
    }
    expect(collisions, 'HUD texts overlapping').toEqual([]);

    // ── 3. the goal row still clears the environment row ──────────────────
    const goal = day.find((o) => o.name === 'hud-goal');
    const environment = day.find((o) => o.name === 'hud-environment');
    expect(goal && environment).toBeTruthy();
    if (goal && environment) {
      expect(goal.y + goal.height).toBeLessThanOrEqual(environment.y);
    }

    // ── 4. each value lives inside its ring's well, centred on the ring ───
    const well = (HUD_LAYOUT.ringR - HUD_LAYOUT.ringStroke) * 2;
    STAT_KEYS.forEach((key, i) => {
      const value = day.find((o) => o.name === `hud-value-${key}`);
      expect(value, `hud-value-${key}`).toBeTruthy();
      if (!value) return;
      const ringCentreX = HUD_LAYOUT.statX + i * HUD_LAYOUT.statPitch + HUD_LAYOUT.ringR;
      expect(value.width, `hud-value-${key} fits the well`).toBeLessThanOrEqual(well);
      expect(Math.abs(value.x + value.width / 2 - ringCentreX), `hud-value-${key} centred`).toBeLessThanOrEqual(2);
      expect(Math.abs(value.y + value.height / 2 - HUD_LAYOUT.ringCY), `hud-value-${key} on the ring line`).toBeLessThanOrEqual(2);
    });

    mkdirSync('output/ag54', { recursive: true });
    const clip = await ringClip(page);
    await page.screenshot({ path: `output/ag54/${viewport.width}x${viewport.height}-rings-day.png`, clip });
    await page.screenshot({ path: `output/ag54/${viewport.width}x${viewport.height}-day.png` });

    // ── 5. low HP / low morale: the running-out rings go danger red ───────
    await page.evaluate(() => {
      const state = window.__PHASER_SESSION__?.getState() as unknown as GameState | null;
      if (!state) throw new Error('missing session');
      state.player.hp = 17;
      state.player.hunger = 15;
      state.player.thirst = 80;
      state.player.energy = 90;
      state.player.morale = -40; // badMorale is -10; -40 leaves headroom against the pool's fade
      state.player.stress = 99;
    });
    await expect.poll(async () => (await bounds(page)).find((o) => o.name === 'hud-value-hp')?.text).toBe('17');
    await expect.poll(async () => (await bounds(page)).find((o) => o.name === 'hud-value-hunger')?.text).toBe('15');
    // Low morale still rides the region chip, warn-coloured — unchanged behaviour.
    await expect.poll(async () => (await bounds(page)).find((o) => o.name === 'hud-region')?.text).toContain('情绪低落');
    const critical = await bounds(page);
    for (const entry of critical) {
      expect(entry.x + entry.width, `${entry.name} right bound: ${entry.text}`).toBeLessThanOrEqual(DESIGN_WIDTH);
      expect(entry.y + entry.height, `${entry.name} bottom bound: ${entry.text}`).toBeLessThanOrEqual(DESIGN_HEIGHT);
    }
    await page.screenshot({ path: `output/ag54/${viewport.width}x${viewport.height}-rings-critical.png`, clip });
    await page.screenshot({ path: `output/ag54/${viewport.width}x${viewport.height}-critical.png` });

    await testInfo.attach('ring bounds', { body: JSON.stringify({ viewport, day, critical }, null, 2), contentType: 'application/json' });
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });
}
