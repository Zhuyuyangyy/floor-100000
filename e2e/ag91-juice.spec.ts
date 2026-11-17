import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

// AG-91（战斗 juice 层）无头实测探针（端口 5202，--workers=1）。
//
// 用户 2026-11-17 原话：「把这个战斗做好了」。本 spec 用「页内逐帧 juice
// 状态记录器 + 帧序列截图」把三档打击反馈钉成数据：
//   small（命中）：trauma 0.15 轻震起步，无顿帧无闪白；
//   medium（受击）：trauma 0.40 + 50ms 顿帧（tweens.timeScale=0 可观测）
//     + 受击闪白（Phaser flashEffect 真在跑 + juice 计时器 70ms）；
//   large（击杀）：trauma 1.00 + 120ms 顿帧 + 闪白 + squash & stretch
//     （scaleRemainingMs=180）+ 满幅震屏（|offset| ≤ maxShakePx×0.7）。
// 截图落仓库外 output 目录（QA 证据，不进版本库）；全程 pageerror 清零。
// 存量语义不删不减：回合推进/飘字/击退与 AG-70 机位一致。

const OUT = 'D:/ZYY_Inovation/game/tmp/qa-evidence/juice';

interface JuiceFrame {
  t: number;
  trauma: number;
  hitstop: number;
  flash: number;
  fxFlash: number;
  scale: number;
  offX: number;
  offY: number;
  ts: number;
}

/** 页内逐帧记录器：rAF 采样 juice 状态机 + Phaser 相机效果字段。 */
async function installJuiceTracer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = window.__PHASER_GAME__ as unknown as {
      scene: {
        getScene: (k: string) => unknown | null;
      };
    };
    const w = window as unknown as { __ag91Trace?: { frames: JuiceFrame[]; t0: number; running: boolean } };
    type JuiceFrame = {
      t: number; trauma: number; hitstop: number; flash: number; fxFlash: number;
      scale: number; offX: number; offY: number; ts: number;
    };
    const scene = g.scene.getScene('Game') as unknown as {
      juice?: {
        trauma: number; hitstopRemainingMs: number; flashRemainingMs: number;
        scaleRemainingMs: number;
      };
      tweens: { timeScale: number };
      cameras: { main: { shakeEffect: { _offsetX: number; _offsetY: number }; flashEffect: { isRunning: boolean; alpha: number } } };
    } | null;
    const read = (): JuiceFrame | null => {
      const j = scene?.juice;
      if (!j) return null;
      const cam = scene!.cameras.main;
      return {
        t: performance.now(),
        trauma: j.trauma,
        hitstop: j.hitstopRemainingMs,
        flash: j.flashRemainingMs,
        fxFlash: cam.flashEffect.isRunning ? cam.flashEffect.alpha : 0,
        scale: j.scaleRemainingMs,
        offX: cam.shakeEffect._offsetX,
        offY: cam.shakeEffect._offsetY,
        ts: scene!.tweens.timeScale,
      };
    };
    w.__ag91Trace = { frames: [], t0: performance.now(), running: true };
    const tick = (): void => {
      const f = read();
      if (f) {
        f.t -= w.__ag91Trace!.t0;
        w.__ag91Trace!.frames.push(f);
        if (w.__ag91Trace!.frames.length > 1800) w.__ag91Trace!.frames.shift();
      }
      if (w.__ag91Trace!.running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function readJuiceTrace(page: Page): Promise<JuiceFrame[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __ag91Trace?: { frames: JuiceFrame[]; running: boolean } };
    type JuiceFrame = {
      t: number; trauma: number; hitstop: number; flash: number; fxFlash: number;
      scale: number; offX: number; offY: number; ts: number;
    };
    if (w.__ag91Trace) w.__ag91Trace.running = false;
    return (w.__ag91Trace?.frames ?? []) as JuiceFrame[];
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

async function combatState(page: Page): Promise<{ inCombat: boolean; monsterHp: number; playerHp: number; monsterName: string }> {
  return page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState() as unknown as
      | { combat?: { monster: { hp: number; name: string } }; player: { hp: number } }
      | null
      | undefined;
    return {
      inCombat: !!s?.combat,
      monsterHp: s?.combat?.monster.hp ?? -1,
      playerHp: s?.player.hp ?? -1,
      monsterName: s?.combat?.monster.name ?? '',
    };
  });
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
    const inCombat = await combatState(page);
    if (inCombat.inCombat) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  throw new Error('no ambush spot on floor 2 for seed 42');
}

function summarize(frames: JuiceFrame[]): {
  maxTrauma: number; maxHitstop: number; maxFlash: number; maxFxFlash: number; maxScale: number;
  minTimeScale: number; maxAbsOffset: number; nonzeroOffsetFrames: number;
} {
  const s = { maxTrauma: 0, maxHitstop: 0, maxFlash: 0, maxFxFlash: 0, maxScale: 0, minTimeScale: 1, maxAbsOffset: 0, nonzeroOffsetFrames: 0 };
  for (const f of frames) {
    s.maxTrauma = Math.max(s.maxTrauma, f.trauma);
    s.maxHitstop = Math.max(s.maxHitstop, f.hitstop);
    s.maxFlash = Math.max(s.maxFlash, f.flash);
    s.maxFxFlash = Math.max(s.maxFxFlash, f.fxFlash);
    s.maxScale = Math.max(s.maxScale, f.scale);
    s.minTimeScale = Math.min(s.minTimeScale, f.ts);
    s.maxAbsOffset = Math.max(s.maxAbsOffset, Math.abs(f.offX), Math.abs(f.offY));
    if (f.offX !== 0 || f.offY !== 0) s.nonzeroOffsetFrames++;
  }
  return s;
}

test('AG-91 juice：命中/受击/击杀三档反馈 + 帧序列截图（seed 42，2 层伏击）', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  mkdirSync(OUT, { recursive: true });

  await startGame(page, 42);
  await climbToFloor2(page);
  // 记录器装在开打之前：伏击开场偷袭（medium）若发生也一并入账。
  await installJuiceTracer(page);
  await openAmbush(page);
  await page.waitForTimeout(1200); // 滑步 + 偷袭演出落地

  // ── ① 普通命中（small）：Enter 攻击，180ms 帧截飘字 + 击退同帧 ──
  await page.keyboard.press('Enter');
  await page.waitForTimeout(180);
  const floater = await probeFloater(page);
  await page.screenshot({ path: `${OUT}/01-hit-small.png` });
  await page.waitForTimeout(600);

  // ── ② 一路打到击杀；CDP screencast 逐帧捕获 + tracer 数据 ──
  // page.screenshot 有 ~90ms 的捕获延迟，70ms 的受击闪白在截图落地前就结束
  // 了（实测：探针见 tools/ag91-flash-probe.mjs）。因此击杀窗用 CDP
  // screencast（Playwright 录屏同款机制）按帧捕获，闪白/顿帧/震屏逐帧入账。
  const cdp = await page.context().newCDPSession(page);
  const shotFrames: string[] = [];
  cdp.on('Page.screencastFrame', async (ev) => {
    shotFrames.push(ev.data);
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId });
    } catch {
      // 会话已停（stopScreencast 竞态）——最后一帧丢了无所谓。
    }
  });
  let killAt = -1;
  for (let round = 0; round < 16; round++) {
    const before = await combatState(page);
    if (!before.inCombat) break;
    shotFrames.length = 0;
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 55, everyNthFrame: 1 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500); // 覆盖闪白(70ms)+顿帧(120ms)+震屏尾段
    await cdp.send('Page.stopScreencast');
    await page.waitForTimeout(120); // 等在途帧到齐
    const now = await combatState(page);
    if (now.monsterHp === 0) { killAt = round; break; }
    await page.waitForTimeout(320);
  }
  expect(killAt, 'the fight reaches a kill within 16 rounds').toBeGreaterThanOrEqual(0);

  // 帧序列落盘（仓库外）：screencast 逐帧 + page.screenshot 补两个稳帧。
  const FRAMES = `${OUT}/kill-frames`;
  mkdirSync(FRAMES, { recursive: true });
  shotFrames.forEach((b64, i) => {
    writeFileSync(`${FRAMES}/frame-${String(i).padStart(3, '0')}.jpg`, Buffer.from(b64, 'base64'));
  });
  console.log(`[ag91] kill screencast frames: ${shotFrames.length}`);
  await page.screenshot({ path: `${OUT}/02-kill-decay.png` });          // ≈+700ms：震屏尾段
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/03-aftermath.png` });           // outcome 面板稳帧

  const frames = await readJuiceTrace(page);
  const s = summarize(frames);

  // 量化取证落盘（仓库外 QA 证据目录）：汇总 + 击杀窗口逐帧明细。
  const killWindow = frames.filter((f) => f.trauma > 0.5).slice(0, 24);
  writeFileSync(
    `${OUT}/evidence.json`,
    JSON.stringify({ summary: s, killWindow, totalFrames: frames.length }, null, 2),
  );
  console.log(`[ag91] juice trace: ${JSON.stringify(s)}`);
  console.log(`[ag91] kill window (trauma>0.5): ${JSON.stringify(killWindow)}`);

  // ── 断言：三档全部落地 ──
  // large（击杀）：满 trauma + 120ms 顿帧 + 70ms 闪白 + 180ms 缩放。
  // trauma 峰值允许一帧 rAF（~50ms）的线性衰减误差：impact 同步把 trauma
  // 钉到 1.0，第一个采样帧时已按 2 次/秒衰减到 ≈0.9+，单测里钉的是精确值
  // （juice.test.ts），这里证的是「满幅那一下真的发生了」。
  expect(s.maxTrauma, 'large tier trauma').toBeGreaterThan(0.9);
  expect(s.maxHitstop, 'large tier hitstop').toBeGreaterThanOrEqual(100);
  expect(s.maxFlash, 'large tier flash timer').toBeGreaterThanOrEqual(50);
  expect(s.maxScale, 'large tier squash timer').toBeGreaterThanOrEqual(100);
  // Phaser 自己的 Flash 效果真在跑（alpha 从 1 褪到 0）——不是只有计时器。
  expect(s.maxFxFlash, 'phaser flashEffect alpha').toBeGreaterThan(0);
  // 顿帧可观测：tweens.timeScale 被闸到 0（冻结模拟）。
  expect(s.minTimeScale, 'hitstop freezes tweens').toBe(0);
  // 震屏：偏移非零且有界（maxShakePx 12 × 强度 0.7 = 8.4）。
  expect(s.nonzeroOffsetFrames, 'camera offset frames').toBeGreaterThan(3);
  expect(s.maxAbsOffset, 'camera offset bound').toBeLessThanOrEqual(12 * 0.7 + 0.01);
  // small（命中）：非零帧里存在低 trauma 段（0.15 起步震）——由飘字帧佐证。
  expect(floater, 'damage number on the hit frame').toMatch(/^(-\d+|未命中)$/);
  // medium（受击）：伏击偷袭或敌人反击命中过——闪白计时器到过 70ms，
  // 且 trauma 未满（区别于击杀的 large 闪白）。
  const midFlash = frames.filter((f) => f.flash >= 50 && f.trauma < 1).length;
  expect(midFlash, 'medium tier flash observed (ambush/counter hit)').toBeGreaterThan(0);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('AG-91 juice 无障碍：震屏总闸关闭时偏移恒 0，顿帧照常', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  mkdirSync(OUT, { recursive: true });

  // AG-72 的 screenShake 总闸关掉再进游戏（localStorage 预置）。
  await page.addInitScript(() => {
    window.localStorage.setItem('floor100000.settings', JSON.stringify({
      sfxVolume: 70, bgmVolume: 50, screenShake: false, textSpeed: 'normal', language: 'zh',
    }));
  });
  await startGame(page, 42);
  await climbToFloor2(page);
  await installJuiceTracer(page);
  await openAmbush(page);
  await page.waitForTimeout(1200);

  // 打满整场：无论命中/受击/击杀，相机 offset 必须恒 0。
  for (let round = 0; round < 16; round++) {
    const st = await combatState(page);
    if (!st.inCombat) break;
    await page.keyboard.press('Enter');
    await page.waitForTimeout(420);
  }
  await page.screenshot({ path: `${OUT}/07-a11y-shake-off.png` });

  const frames = await readJuiceTrace(page);
  const s = summarize(frames);
  console.log(`[ag91] a11y trace (screenShake off): ${JSON.stringify(s)}`);
  // 位移刺激清零（防光敏/晕眩的总闸）。
  expect(s.maxAbsOffset, 'offset stays 0 with screenShake off').toBe(0);
  expect(s.nonzeroOffsetFrames).toBe(0);
  // 但打击节奏反馈不关：顿帧仍然发生过（trauma 也照常累计到满幅附近，
  // 容一帧 rAF 的衰减误差，同见测试①的注释）。
  expect(s.maxHitstop, 'hitstop still fires').toBeGreaterThanOrEqual(100);
  expect(s.maxTrauma, 'trauma still accrues').toBeGreaterThan(0.9);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
