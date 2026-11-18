import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../src/core/design';
import { HUD_LAYOUT } from '../src/render/hudLayout';
import type { E2EGameState } from './globals';

// AG-67 e2e：右下角角色状态面板 + 角色自言自语。钉四件事：
//   1. 面板常驻右下，四条读数与真实 state 一致（改 state 验证刷新，摘要
//      一句话随数值推导）；
//   2. 血打到 30% 以下，角色头顶飘出一句符合处境的台词（截图）；
//   3. 节流生效——9s 总闸内连续触发不刷屏，过了间隔才放第二句，且不复读；
//   4. 三视口（900x600 / 1280x800 / 1920x1080）下面板不出画布、不压金币/
//      分数/按钮行/脚条。

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

/** 15% 重叠阈值，与 AG-54 的 HUD 碰撞判定同一条契约。 */
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlapRatio(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 1 || h <= 1) return 0;
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  return smaller > 0 ? (w * h) / smaller : 0;
}

async function expectGoalUp(page: Page): Promise<void> {
  await expect.poll(async () => (await hudTexts(page)).find((o) => o.name === 'hud-goal')?.text).toContain('目标');
}

test('AG-67 the card lives bottom-right and its numbers are the real state', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() === 404 && !response.url().endsWith('/favicon.ico')) errors.push(`404 ${response.url()}`);
  });
  await startGame(page);
  await expectGoalUp(page);

  // ── 常驻：角色名 + 四条读数 + 一句摘要 ─────────────────────────────────
  const texts = await hudTexts(page);
  expect(find(texts, 'hud-status-name')?.text, 'meta 默认选 player → 幸存者').toBe('幸存者');
  const LABELS: Record<string, string> = { hp: '生命', hunger: '饥饿', thirst: '口渴', energy: '精力' };
  for (const key of Object.keys(LABELS)) {
    expect(find(texts, `hud-status-${key}`)?.text, `${key} label`).toBe(LABELS[key]);
    expect(find(texts, `hud-status-value-${key}`)?.text, `${key} value is a number`).toMatch(/^[0-9]+$/);
    expect(find(texts, 'hud-status-summary')?.text, 'summary is one sentence').toBeTruthy();
  }

  // ── 读数与真实 state 一致 ──────────────────────────────────────────────
  const live = await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('missing session');
    return { hp: s.player.hp, hunger: s.player.hunger, thirst: s.player.thirst, energy: s.player.energy };
  });
  for (const key of Object.keys(LABELS) as Array<'hp' | 'hunger' | 'thirst' | 'energy'>) {
    expect(find(texts, `hud-status-value-${key}`)?.text, `${key} matches state`).toBe(String(Math.round(live[key])));
  }

  // ── 改 state，面板刷新（不重开场景） ───────────────────────────────────
  await setState(page, (s) => {
    s.player.hp = 37;
    s.player.hunger = 44;
    s.player.thirst = 88;
    s.player.energy = 61;
  });
  await expect.poll(async () => find(await hudTexts(page), 'hud-status-value-hp')?.text).toBe('37');
  const refreshed = await hudTexts(page);
  expect(find(refreshed, 'hud-status-value-hunger')?.text).toBe('44');
  expect(find(refreshed, 'hud-status-value-thirst')?.text).toBe('88');
  expect(find(refreshed, 'hud-status-value-energy')?.text).toBe('61');
  // 全安全 → 摘要说「状态尚可」
  expect(find(refreshed, 'hud-status-summary')?.text).toBe('状态尚可');

  // 饥饿打到底 → 摘要换成「饥肠辘辘」（顺带触发一句自言自语，下两节测）
  await setState(page, (s) => {
    s.player.hunger = 10;
  });
  await expect.poll(async () => find(await hudTexts(page), 'hud-status-summary')?.text).toBe('饥肠辘辘');
  // 血再压到 30% 以下 → 摘要换成危险档
  await setState(page, (s) => {
    s.player.hp = 20;
  });
  await expect.poll(async () => find(await hudTexts(page), 'hud-status-summary')?.text).toBe('伤痕累累，得处理下了');

  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/01-card-bottom-right.png` });
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

for (const viewport of [
  { width: 900, height: 600 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
]) {
  test(`AG-67 the card holds its lane at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.status() === 404 && !response.url().endsWith('/favicon.ico')) errors.push(`404 ${response.url()}`);
    });
    await page.setViewportSize(viewport);
    await startGame(page);
    await expectGoalUp(page);

    const texts = await hudTexts(page);
    const mine = texts.filter((t) => t.name.startsWith('hud-status-'));
    expect(mine.length, 'name + 4 labels + 4 values + summary').toBe(10);

    // ① 面板自己的每个文本都在设计画布内
    for (const t of mine) {
      expect(t.x, `${t.name} starts on canvas`).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.x + t.width, `${t.name} right bound`).toBeLessThanOrEqual(DESIGN_WIDTH);
      expect(t.y + t.height, `${t.name} bottom bound`).toBeLessThanOrEqual(DESIGN_HEIGHT);
    }

    // ② 不压任何其它 HUD 文本（15% 阈值同 AG-54）
    const others = texts.filter((t) => !t.name.startsWith('hud-status-'));
    const collisions: string[] = [];
    for (const a of mine) {
      for (const b of others) {
        if (overlapRatio(a, b) > 0.15) collisions.push(`"${a.name}" x "${b.name}"`);
      }
    }
    expect(collisions, 'card prints through another HUD lane').toEqual([]);

    // ③ 不压按钮行（framedButton 的文本无名，按文案定位）且整体在它上方
    const buttons = await page.evaluate(() => {
      const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as {
        children: { list: Array<{ type: string; text: string; getBounds(): { x: number; y: number; width: number; height: number } }> };
      };
      // AG-71: the button row became the bottom navigation bar; the 菜单
      // slot now carries its Esc key like every other slot.
      const labels = ['背包 I', '制作 C', '产业 G', '地图 M', '菜单 Esc'];
      return scene.children.list
        .filter((o) => o.type === 'Text' && labels.includes(o.text))
        .map((o) => {
          const b = o.getBounds();
          return { x: b.x, y: b.y, width: b.width, height: b.height };
        });
    });
    expect(buttons.length, 'five HUD buttons found').toBe(5);
    const card = {
      x: HUD_LAYOUT.statusCardX,
      y: HUD_LAYOUT.statusCardY,
      width: HUD_LAYOUT.statusCardW,
      height: HUD_LAYOUT.statusCardH,
    };
    const buttonTop = Math.min(...buttons.map((b) => b.y));
    expect(card.y + card.height, 'card bottom clears the button row').toBeLessThanOrEqual(buttonTop);
    for (const b of buttons) {
      expect(overlapRatio(card, b), 'card x button').toBe(0);
    }

    // ④ 面板钉在右下：右边距与按钮行同一条 16px 线
    expect(card.x + card.width).toBe(DESIGN_WIDTH - 16);

    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/04-lane-${viewport.width}x${viewport.height}.png` });
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });
}
