import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../src/core/design';
import type { E2EGameState } from './globals';

// AG-67 e2e：角色自言自语。钉三件事：
//   1. 常驻状态卡已拆除（2026-11-19 用户裁决）——HUD 里不得再出现任何
//      hud-status-* 卡件（名称/四值/摘要），独白气泡除外；
//   2. 血打到 30% 以下，角色头顶飘出一句符合处境的台词（截图）；
//   3. 节流生效——9s 总闸内连续触发不刷屏，过了间隔才放第二句，且不复读。
// （原「卡读数」「三视口卡泳道」两组 test 随卡退役删除。）

const OUT = 'output/ag67';

/** 玩家套 hp_low 的三句（meta 默认选 player；改台词表时同步这里）。 */
const PLAYER_HP_LOW_LINES = ['得赶紧处理下伤口……', '血一直在渗，撑不了多久', '这伤再拖要坏事'];

async function startGame(page: Page): Promise<void> {
  await page.goto('/?seed=42');
  const sceneIs = (key: string): Promise<void> =>
    page.waitForFunction((k) => !!window.__PHASER_GAME__?.scene.getScenes(true).some((scene) => scene.scene.key === k), key).then(() => undefined);
  await sceneIs('Menu');
  await page.keyboard.press('Enter');
  await sceneIs('MetaSelect');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const ready = await page
      .waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((scene) => scene.scene.key === 'Game'), undefined, { timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    if (ready) break;
  }
  await sceneIs('Game');
}

interface HudBound {
  name: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function hudTexts(page: Page): Promise<HudBound[]> {
  return page.evaluate(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as {
      children: { list: Array<{ type: string; name: string; text: string; visible: boolean; getBounds(): { x: number; y: number; width: number; height: number } }> };
    };
    return scene.children.list
      .filter((o) => o.type === 'Text' && o.visible && o.name.startsWith('hud-'))
      .map((o) => {
        const b = o.getBounds();
        return { name: o.name, text: o.text, x: b.x, y: b.y, width: b.width, height: b.height };
      });
  });
}

const find = (texts: HudBound[], name: string): HudBound | undefined => texts.find((t) => t.name === name);

/**
 * 直接改活动 state（evaluate 里拿到的就是存活对象），等 tick 拾取。
 * 注意 new Function 的用法：mutate.toString() 是一个箭头函数「表达式」，
 * 必须 return 出来再调用——当语句体用的话它只是个没人碰的表达式，state
 * 一个字都不会变（第一轮实测就这么静默地挂过）。
 */
async function setState(page: Page, mutate: (s: E2EGameState) => void): Promise<void> {
  await page.evaluate((src) => {
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('missing session');
    (new Function('return ' + src)())(s);
  }, mutate.toString());
}

/** 这一幕已经飘过几句（控制器字段，e2e 数「说没说话」，不数像素）。
 * RC-03 拆分第 2 步：monologueSpoken 随 ticker 迁入 MonologueController，
 * 场景字段改为控制器上的 spokenCount getter（ag67-status.spec.ts 同步）。 */
async function spokenCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { monologue?: { spokenCount?: number } } | null;
    return scene?.monologue?.spokenCount ?? -1;
  });
}

async function bubbleText(page: Page): Promise<string | null> {
  const texts = await hudTexts(page);
  return find(texts, 'hud-status-bubble')?.text ?? null;
}

async function expectGoalUp(page: Page): Promise<void> {
  await expect.poll(async () => (await hudTexts(page)).find((o) => o.name === 'hud-goal')?.text).toContain('目标');
}

test('AG-67 the standing status card is gone (2026-11-19 user ruling)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() === 404 && !response.url().endsWith('/favicon.ico')) errors.push(`404 ${response.url()}`);
  });
  await startGame(page);
  await expectGoalUp(page);

  // 卡件（名称/四 label/四值/摘要）一个都不许再上屏；独白气泡另测。
  const texts = await hudTexts(page);
  const cardTexts = texts.filter((t) => t.name.startsWith('hud-status-') && t.name !== 'hud-status-bubble');
  expect(cardTexts.map((t) => t.name), '右下状态卡已退役').toEqual([]);

  // 改 state 跑几个 tick，确认 tick 路径也不再偷偷建卡。
  await setState(page, (s) => {
    s.player.hp = 37;
    s.player.hunger = 44;
    s.player.thirst = 88;
    s.player.energy = 61;
  });
  await page.waitForTimeout(800); // 三个以上 tick
  const after = await hudTexts(page);
  expect(after.filter((t) => t.name.startsWith('hud-status-') && t.name !== 'hud-status-bubble')).toEqual([]);

  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/01-card-removed.png` });
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('AG-67 hp under 30% makes the survivor say so out loud', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startGame(page);
  await expectGoalUp(page);
  expect(await spokenCount(page), '开局没有任何处境跨线，一个字都不说').toBe(0);

  await setState(page, (s) => {
    s.player.hp = 20;
  });
  // 头顶飘字出现，且内容是玩家套 hp_low 的一句
  await expect.poll(async () => bubbleText(page), { timeout: 6000 }).toBeTruthy();
  const line = await bubbleText(page);
  expect(PLAYER_HP_LOW_LINES, `bubble line: ${line}`).toContain(line);
  await expect.poll(async () => spokenCount(page)).toBe(1);

  // 飘字在画布内（头顶位置，跟着相机居中）
  const bubble = find(await hudTexts(page), 'hud-status-bubble');
  expect(bubble).toBeTruthy();
  if (bubble) {
    expect(bubble.x).toBeGreaterThanOrEqual(0);
    expect(bubble.y).toBeGreaterThanOrEqual(0);
    expect(bubble.x + bubble.width).toBeLessThanOrEqual(DESIGN_WIDTH);
    expect(bubble.y + bubble.height).toBeLessThanOrEqual(DESIGN_HEIGHT);
  }
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/02-hp-low-bubble.png` });

  // 2.6s 后自动消失（配置 bubbleMs）
  await expect.poll(async () => bubbleText(page), { timeout: 6000 }).toBeNull();
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('AG-67 the gate keeps a second line 9s away, then lets a fresh one through', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startGame(page);
  await expectGoalUp(page);

  // 第一句：血 100 → 20 跨过 30% 线
  await setState(page, (s) => {
    s.player.hp = 20;
  });
  await expect.poll(async () => spokenCount(page), { timeout: 6000 }).toBe(1);
  const firstLine = await bubbleText(page);
  expect(firstLine).toBeTruthy();
  const firstAt = Date.now();

  // 总闸内再跨一次线（恢复 → 再跌）：照样闭嘴，不刷屏
  await setState(page, (s) => {
    s.player.hp = 80;
  });
  await page.waitForTimeout(600); // 让 tick 记住「已恢复」，否则不算跨线
  await setState(page, (s) => {
    s.player.hp = 19;
  });
  await page.waitForTimeout(2500); // 十个 tick，足够它想开口
  expect(await spokenCount(page), '9s 总闸内不许说第二句').toBe(1);

  // 等总闸过去（第一句之后 ≥ 9s），再跨一次线
  const waitFor = Math.max(0, 9500 - (Date.now() - firstAt));
  await page.waitForTimeout(waitFor);
  await setState(page, (s) => {
    s.player.hp = 80;
  });
  await page.waitForTimeout(600);
  await setState(page, (s) => {
    s.player.hp = 18;
  });
  await expect.poll(async () => spokenCount(page), { timeout: 15000 }).toBe(2);

  // 第二句不是同一句（同句 45s 冷却 + 不重复上一句）
  const secondLine = await bubbleText(page);
  expect(secondLine, `first: ${firstLine} / second: ${secondLine}`).not.toBe(firstLine);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/03-throttle-second-line.png` });
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// 原「三视口卡泳道」test 组随卡退役删除（2026-11-19）：卡不存在，泳道契约
// 无从谈起。气泡自身的画布内断言保留在上面的 hp-low test 里。
