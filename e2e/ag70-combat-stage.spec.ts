import { expect, test, type Page } from '@playwright/test';

import { COMBAT_BAR, combatBarX } from '../src/render/hudLayout';
import { DESIGN_HEIGHT } from '../src/core/design';

// AG-70（战斗舞台：去文本框化）实测探针（端口 5470，--workers=1）。
//
// 用户 2026-11-17 原话：「我不是说那个就是打击别人的时候展示战斗然后我们
// 打击吗，不要做那种文本框，我们点击攻击看不见人的操作了」。本 spec 用四张
// 全程截图 + 世界坐标探针钉住「看得见人打人」：
//   ① 双方上场站位：玩家层左 25% 面右、敌人层右 75% 面左，头顶名签血条，
//      底部动作条（y≤660），回合日志降级左下角；
//   ② 点攻击瞬间：挥击 clip + 敌人闪白 + 击退 + 掉血飘字同一帧；
//   ③ 敌人反击：前冲 + 玩家受伤动画 + 震屏 + 掉血飘字；
//   ④ 动作条可点击：鼠标点「攻击」按钮回合推进。
// 存量语义不删不减：战斗中导航条 contextual 仍显示战斗提示（AG-71 契约），
// Enter/↑↓/Esc 键盘语义原样。截图落 output/ag70/，全程 pageerror 清零。

interface StageProbe {
  floorW: number;
  playerX: number;
  monsterX: number;
  monsterScreenX: number;
  playerScreenX: number;
  monsterVisible: boolean;
  playerTagVisible: boolean;
  turn: number;
  monsterName: string;
  monsterHp: number;
  playerHp: number;
}

/** 战斗舞台探针：双方世界坐标、屏幕坐标、具名容器可见性、战斗状态。 */
async function probeStage(page: Page): Promise<StageProbe> {
  return page.evaluate(() => {
    const g = window.__PHASER_GAME__ as unknown as {
      scene: {
        getScene: (k: string) => {
          floorW: number;
          player: { x: number };
          cameras: { main: { scrollX: number; zoom: number } };
          children: { list: Array<{ name?: string; visible: boolean; x: number }> };
        } | null;
      };
    };
    const s = window.__PHASER_SESSION__?.getState() as unknown as
      | { combat?: { turn: number; monster: { name: string; hp: number } }; player: { hp: number } }
      | null
      | undefined;
    const scene = g.scene.getScene('Game');
    if (!scene) throw new Error('no Game scene');
    const cam = scene.cameras.main;
    const monster = scene.children.list.find((c) => c.name === 'combat-monster-view');
    const playerTag = scene.children.list.find((c) => c.name === 'combat-player-tag');
    return {
      floorW: scene.floorW,
      playerX: scene.player.x,
      monsterX: monster?.x ?? -1,
      monsterScreenX: monster ? (monster.x - cam.scrollX) * cam.zoom : -1,
      playerScreenX: (scene.player.x - cam.scrollX) * cam.zoom,
      monsterVisible: !!monster?.visible,
      playerTagVisible: !!playerTag?.visible,
      turn: s?.combat?.turn ?? -1,
      monsterName: s?.combat?.monster.name ?? '',
      monsterHp: s?.combat?.monster.hp ?? -1,
      playerHp: s?.player.hp ?? -1,
    };
  });
}

/** 场景直下（不在容器里）的飘字文本：-N 或 未命中。 */
async function probeFloater(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const g = window.__PHASER_GAME__ as unknown as {
      scene: {
        getScene: (k: string) => {
          children: { list: Array<{ type: string; text?: string; visible: boolean }> };
        } | null;
      };
    };
    const scene = g.scene.getScene('Game');
    const t = scene?.children.list.find((c) => c.type === 'Text' && c.visible && (/^-\d+$/.test(c.text ?? '') || c.text === '未命中'));
    return t?.text ?? null;
  });
}

/** 敌人剪影视图的当前 x（-1 = 不在场）。 */
async function monsterViewX(page: Page): Promise<number> {
  return page.evaluate(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as {
      children: { list: Array<{ name?: string; x: number }> };
    } | null;
    const v = scene?.children.list.find((c) => c.name === 'combat-monster-view') as { x: number } | undefined;
    return v?.x ?? -1;
  });
}

/**
 * 为什么从 Node 侧步进采样而不是页面内 rAF 记录器：
 * RC-01 分诊：探针缺陷——原实现是页面内 rAF 采样器，它的回调与页面渲染同
 * 一条命：本 spec 自己的 page.screenshot / page.evaluate 往返能把 rAF 饿死
 * 百来 ms，恰够漏掉 ③ 的整个 130ms 前冲窗口（run10 实测：怪物命中、日志
 * 「击中你」、玩家掉血，但采样一帧没落到前冲上，误走「落空」分支报「扑空」
 * 缺失）。Node 侧评估往返不走页面 rAF，260-330ms 的动作链窗口必被 25ms
 * 步进的采样覆盖。两个 test 各自内联步进循环（②/③ 中途还要插同帧取证）。
 */

/** 战斗日志末尾两行（回合结算的权威记录——分支判据，不靠动画采样）。 */
async function combatLogTail(page: Page): Promise<string> {
  return page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState() as unknown as { combat?: { log: string[] } } | null;
    return s?.combat?.log.slice(-2).join(' | ') ?? '';
  });
}

/** 动作条三按钮的文案边界（scrollFactor 0 → getBounds 即设计画布坐标）。 */
async function probeActionBar(page: Page): Promise<Array<{ label: string; x: number; y: number; width: number; height: number }>> {
  return page.evaluate(() => {
    const g = window.__PHASER_GAME__ as unknown as {
      scene: {
        getScene: (k: string) => {
          children: { list: Array<{ type: string; text?: string; visible: boolean; getBounds(): { x: number; y: number; width: number; height: number } }> };
        } | null;
      };
    };
    const scene = g.scene.getScene('Game');
    const out: Array<{ label: string; x: number; y: number; width: number; height: number }> = [];
    for (const o of scene?.children.list ?? []) {
      if (o.type !== 'Text' || !o.visible) continue;
      if (o.text !== '攻击' && o.text !== '格挡' && o.text !== '撤退') continue;
      const b = o.getBounds();
      out.push({ label: o.text!, x: b.x, y: b.y, width: b.width, height: b.height });
    }
    return out;
  });
}

async function hudText(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const g = window.__PHASER_GAME__ as unknown as {
      scene: {
        getScene: (k: string) => {
          children: { list: Array<{ name?: string; text?: string }> };
        } | null;
      };
    };
    const scene = g.scene.getScene('Game');
    return scene?.children.list.find((c) => c.name === n)?.text ?? '';
  }, name);
}

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === k),
    key,
    { timeout: 20_000 },
  );
}

async function startGame(page: Page, seed = 42): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const started = await page
      .waitForFunction(() => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'), undefined, { timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    if (started) break;
  }
  await waitForScene(page, 'Game');
}

/** 爬到 2 层（遭遇点所在层）。 */
async function climbToFloor2(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const floor = await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.currentFloor);
    if (floor === 2) return;
    await page.evaluate(() => {
      const st = window.__PHASER_SESSION__?.getState();
      if (st) st.player.x = 40;
    });
    await page.keyboard.press('E');
    await page.waitForFunction(() => window.__PHASER_SESSION__?.getState()?.currentFloor === 2, undefined, { timeout: 10_000 }).catch(() => false);
  }
  expect(await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.currentFloor)).toBe(2);
}

/** 逐个问号点试到开出伏击。 */
async function openAmbush(page: Page): Promise<void> {
  const spots: Array<{ k: string; x: number }> = await page.evaluate(() => {
    const game = window.__PHASER_GAME__;
    const sc = game?.scene.getScene('Game') as unknown as { spotMarkers?: Map<string, { x: number }> } | null;
    return [...(sc?.spotMarkers ?? new Map()).entries()].map(([k, v]) => ({ k, x: Math.round(v.x) }));
  });
  for (const sp of spots) {
    if (sp.k === 'shop') continue;
    await page.evaluate((x) => {
      const st = window.__PHASER_SESSION__?.getState();
      if (st) st.player.x = x;
    }, sp.x);
    await page.waitForTimeout(250);
    await page.keyboard.press('E');
    await page.waitForTimeout(500);
    const inCombat = await page.evaluate(() => !!(window.__PHASER_SESSION__?.getState() as unknown as { combat?: unknown })?.combat);
    if (inCombat) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  throw new Error('no ambush spot on floor 2 for seed 42');
}

test('① 双方上场：站位、剪影、头顶血条、动作条、日志', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await climbToFloor2(page);
  await openAmbush(page);
  // 等滑步（≤700ms）与 ambusher 偷袭演出（130ms 飘字）落地。
  await page.waitForTimeout(1200);

  const stage = await probeStage(page);
  // 站位：玩家层左 25%、敌人层右 75%（按当前层宽算，不硬编码 1280）。
  expect(stage.playerX).toBeGreaterThan(stage.floorW * 0.2);
  expect(stage.playerX).toBeLessThan(stage.floorW * 0.3);
  expect(stage.monsterX).toBeGreaterThan(stage.floorW * 0.7);
  // 上界含等号：行商避让链把怪物钳在 [spot-60, spot+64]，spot=0.75×层宽，
  // 上限恰为 0.8×层宽（GameScene 2846-2850 的有意设计）——严格小于会在
  // seed 42 的 2 层（shop 924）恰好落在钳上限时红（RC-01 分诊：探针缺陷）。
  expect(stage.monsterX).toBeLessThanOrEqual(stage.floorW * 0.8);
  // 双方都在屏幕上（相机 zoom 1、bounds 一层宽）。
  expect(stage.playerScreenX).toBeGreaterThan(0);
  expect(stage.playerScreenX).toBeLessThan(stage.floorW);
  expect(stage.monsterScreenX).toBeGreaterThan(stage.playerScreenX);
  expect(stage.monsterScreenX).toBeLessThan(stage.floorW);
  // 剪影与玩家名签都可见。
  expect(stage.monsterVisible).toBe(true);
  expect(stage.playerTagVisible).toBe(true);

  // 动作条：三个按钮都在 y≤660 硬线内、画布内、三个都可见。
  const bar = await probeActionBar(page);
  // 按 x 排序钉住左中右顺序：攻击 / 格挡 / 撤退。
  const ordered = [...bar].sort((a, b) => a.x - b.x);
  expect(ordered.map((b) => b.label)).toEqual(['攻击', '格挡', '撤退']);
  for (const b of ordered) {
    expect(b.y, `${b.label} top`).toBeGreaterThanOrEqual(COMBAT_BAR.y - 30);
    expect(b.y + b.height, `${b.label} bottom ≤ 660`).toBeLessThanOrEqual(660);
    expect(b.x).toBeGreaterThanOrEqual(combatBarX());
    expect(b.x + b.width).toBeLessThanOrEqual(combatBarX() + 3 * COMBAT_BAR.btnW + 2 * COMBAT_BAR.gap);
  }

  // 导航条常驻：contextual 槽交棒战斗提示（AG-71 存量语义）。
  // RC-01 分诊：探针缺陷——旧断言钉的是 AG-70 之前导航槽的短文案
  // 「↑/↓ 选择 · Enter 出招 · ESC 撤退」。当前战斗脚注带武器前缀
  // （combatFootHint，GameScene.ts:513「当前武器：X（伤害 N）· Enter 出招 ·
  // ↑/↓ 选择 · ESC 撤退」），导航槽按槽宽 fitHudLine 截断（尾带 …，ESC 段
  // 被截掉）——全串在 hud-hint，ag63-1 第 1 节同源断言三条都在。改钉当前
  // 契约：槽内以武器行开头、含主操作 Enter 出招。
  await expect.poll(() => hudText(page, 'hud-nav-context'), { timeout: 5000 }).toMatch(/^当前武器：.+· Enter 出招/);

  await page.screenshot({ path: 'output/ag70/01-stage.png' });
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('② 点攻击：挥击 + 闪白 + 击退 + 掉血飘字同帧', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await climbToFloor2(page);
  await openAmbush(page);
  await page.waitForTimeout(1200);

  const before = await probeStage(page);
  await page.keyboard.press('Enter');
  // 挥击 clip 320ms；命中链路 90ms 出飘字+火花、击退 90ms 出 170ms 回。
  // 180ms 这一帧：clip 在挥、敌人在退、飘字在飘——「同帧」取证点。
  // RC-01：采样改 Node 侧步进（25ms），第 7 步（≈180ms）插同帧取证；
  // 页面内 rAF 采样器会被本 test 自己的截图/评估往返饿死（见 sampleMonsterX）。
  const xs: number[] = [before.monsterX];
  let floater: string | null = '';
  for (let i = 1; i <= 24; i++) {
    await page.waitForTimeout(25);
    xs.push(await monsterViewX(page));
    if (i === 7) {
      floater = await probeFloater(page);
      await page.screenshot({ path: 'output/ag70/02-attack.png' });
    }
  }
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  await page.waitForTimeout(300);

  const after = await probeStage(page);
  // 回合推进（引擎语义没动）。
  expect(after.turn).toBe(before.turn + 1);
  // 命中：敌人被击退（x 曾大于 spot）且最终归位；未命中：敌人闪避（x 曾小于
  // spot）。两者都看得见——飘字（-N 或 未命中）在 180ms 帧上必然在场。
  expect(floater, 'hit floater on the attack frame').toMatch(/^(-\d+|未命中)$/);
  const knocked = max > before.monsterX + 4;
  const dodged = min < before.monsterX - 4;
  expect(knocked || dodged, `monster moved during the hit chain (spot ${before.monsterX}, min ${min}, max ${max})`).toBe(true);
  // 归位：动作链结束后敌人回到 spotX（±2px tween 容差）。
  expect(Math.abs(after.monsterX - before.monsterX)).toBeLessThanOrEqual(2);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('③ 敌人反击：前冲 + 受伤 + 震屏 + 掉血飘字', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await climbToFloor2(page);
  await openAmbush(page);
  await page.waitForTimeout(1200);

  const before = await probeStage(page);
  // 选格挡再出招：本回合不出手，怪物正常结算一击——反击链的专用机位。
  await page.keyboard.press('ArrowDown'); // 格挡
  await page.waitForTimeout(120);
  const spotX = await monsterViewX(page);
  await page.keyboard.press('Enter');
  // 前冲 130ms 到位、140ms 飘字、震屏 160ms。RC-01：采样改 Node 侧 25ms
  // 步进（页面内 rAF 采样器曾被截图/评估往返饿死，漏掉整个前冲窗口，把命中
  // 误判成「落空」——探针缺陷，见 sampleMonsterX 注释）；第 5 步（≈130ms）
  // 截图落在前冲到位的半程。
  const xs: number[] = [spotX];
  let floater: string | null = '';
  for (let i = 1; i <= 24; i++) {
    await page.waitForTimeout(25);
    xs.push(await monsterViewX(page));
    if (i === 5) floater = await probeFloater(page);
  }
  const min = Math.min(...xs);
  await page.screenshot({ path: 'output/ag70/03-counter.png' });
  await page.waitForTimeout(400);

  const after = await probeStage(page);
  expect(after.turn).toBe(before.turn + 1);
  // 反击命中：敌人前冲（x 曾小于 spot）+ 玩家掉血 + 飘字在场；
  // 反击落空：日志「扑空了」，无伤——两种都是合法演出，探针分别取证。
  // RC-01：分支改押游戏权威状态（日志），采样只作前冲的佐证——判定不再
  // 依赖「动画采样恰好采到」这种运气。
  // RC-01 §5：贴脸站位（spot 1024）前冲窗口内位移实测 5.4-6.3px，原 8px
  // 阈值把真实短前冲判成「没前冲」——但权威状态（日志「击中你」+玩家掉血+
  // 掉血飘字）确认反击确实发生，是位移幅度的边界情形而非漏采（Node 侧 25ms
  // 步进已覆盖整个 130ms 窗口）。阈值放宽到 4px（与 ② 的 knocked/dodged
  // ±4px 容差同笔）：仍能证否「完全没动」，又不误杀贴脸短前冲——ag70③ 由此
  // 进 5/5 稳定，随 spec 升 CI 阻断门禁。
  const lunged = min < spotX - 4;
  const log = await combatLogTail(page);
  if (log.includes('击中你')) {
    expect(lunged, `命中的反击要前冲（spot ${spotX}, min ${min}）`).toBe(true);
    expect(floater, 'counter floater').toMatch(/^-\d+$/);
    expect(after.playerHp).toBeLessThan(before.playerHp);
  } else {
    expect(log).toContain('扑空');
    expect(after.playerHp).toBe(before.playerHp);
  }
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('④ 动作条可点击：鼠标点「攻击」按钮出手', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await climbToFloor2(page);
  await openAmbush(page);
  await page.waitForTimeout(1200);

  const before = await probeStage(page);
  const bar = await probeActionBar(page);
  const attack = bar.find((b) => b.label === '攻击');
  expect(attack, 'attack button on the bar').toBeTruthy();
  // 按钮边界是设计画布坐标；用 canvas 的 DOM 矩形换算成页面坐标点击
  // （Scale.FIT 的 letterbox 由 getBoundingClientRect 如实反映，不猜偏移）。
  const rect = await page.evaluate(() => {
    const c = (window.__PHASER_GAME__ as unknown as { canvas?: HTMLCanvasElement } | null)?.canvas;
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  expect(rect, 'game canvas on the page').not.toBeNull();
  const clickX = rect!.left + (attack!.x + attack!.width / 2) * (rect!.width / 1280);
  const clickY = rect!.top + (attack!.y + attack!.height / 2) * (rect!.height / 720);
  await page.mouse.click(clickX, clickY);
  await page.waitForTimeout(500);

  const after = await probeStage(page);
  // 鼠标点击与 Enter 同终点：回合推进、战斗继续。
  expect(after.turn).toBe(before.turn + 1);
  await page.screenshot({ path: 'output/ag70/04-actionbar-click.png' });
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('⑤ 战斗中圆环 HUD 与导航条常驻可读，战斗可干净结束', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await climbToFloor2(page);
  await openAmbush(page);
  await page.waitForTimeout(1000);

  // 圆环 HUD（AG-54）与导航条（AG-71）在战斗中都在。
  for (const name of ['hud-floor', 'hud-clock', 'hud-value-hp', 'hud-gold', 'hud-nav-bag', 'hud-nav-menu']) {
    const visible = await page.evaluate((n) => {
      const g = window.__PHASER_GAME__ as unknown as {
        scene: { getScene: (k: string) => { children: { list: Array<{ name?: string; visible: boolean }> } } | null };
      };
      const scene = g.scene.getScene('Game');
      return !!scene?.children.list.find((c) => c.name === n)?.visible;
    }, name);
    expect(visible, `${name} stays up in combat`).toBe(true);
  }

  // 一路打到战斗结束（Enter 循环），outcome 面板一个 Enter 关闭——存量语义。
  let rounds = 0;
  while (rounds < 14) {
    const inCombat = await page.evaluate(() => !!(window.__PHASER_SESSION__?.getState() as unknown as { combat?: unknown })?.combat);
    if (!inCombat) break;
    await page.keyboard.press('Enter');
    await page.waitForTimeout(420);
    rounds++;
  }
  await page.keyboard.press('Enter'); // outcome 面板
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => !!(window.__PHASER_SESSION__?.getState() as unknown as { combat?: unknown })?.combat);
  expect(after, 'the fight closes cleanly').toBe(false);
  expect((await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.status))).toBe('playing');
  // 舞台已拆：敌人剪影容器不在场景里。
  const stageGone = await page.evaluate(() => {
    const g = window.__PHASER_GAME__ as unknown as {
      scene: { getScene: (k: string) => { children: { list: Array<{ name?: string }> } } | null };
    };
    const scene = g.scene.getScene('Game');
    return !scene?.children.list.some((c) => c.name === 'combat-monster-view' || c.name === 'combat-monster-hit');
  });
  expect(stageGone).toBe(true);
  expect(DESIGN_HEIGHT).toBe(720);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
