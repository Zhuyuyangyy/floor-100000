import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

import { rollEncounter } from '../src/systems/encounters';

// RC-03 拆分第 7 步（CombatController）一次性冻结探针（端口 5256）。
//
// 目的：把今天战斗大改的全部成果在「迁入 CombatController 之前/之后」各跑
// 一遍同 seed 同操作链，逐节点对比：
//   A. 截图像素 diff——战斗舞台区 / 脚注区（动作条+日志+回合签）/ HUD 带；
//   B. juice 机读对比——QA-5 probeA 口径的 shakenFrames/maxShakeOffset/
//      frozenFrames/flashFrames（外加 maxTrauma/maxHitstop/maxScale），
//      按节点窗口切（偷袭/受击=medium / 命中=small / 击杀=large）；
//   C. XP-1 数值行为——seed21 4 层弹弓顽童：空手 4 回合 / 匕首 3 回合
//      击杀（QA-5 实证口径，纯引擎同参模拟复核）；
//   D. 撤退链——ESC 触发 flee 演出、回世界、问号点不消耗（可再开）。
//
// 三条链：
//   链 A（seed42 2 层 拾荒者）：冻结截图全套（战斗前/开战/命中/击杀/结算/回世界）；
//   链 B（seed21 4 层 弹弓顽童 ranged）：XP-1 4/3 回合 + 受击 medium 窗；
//   链 C（seed21 4 层 楼道潜行者 ambusher）：开场偷袭 medium 窗 + 撤退链。
//
// 用法（server 先起）：npm run dev -- --port 5256 --force --strictPort
//   STEP7_OUT=/path/to/dir STEP7_TAG=baseline \
//     npx playwright test --config=e2e/playwright.step7.config.ts --workers=1
// 输出：$STEP7_OUT/{screenshots/$STEP7_TAG-*.png,evidence.json}。

const OUT = process.env.STEP7_OUT ?? 'D:/ZYY_Inovation/game/tmp/qa-evidence/split-step7/run';
const TAG = process.env.STEP7_TAG ?? 'run';

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

interface JuiceSummary {
  maxTrauma: number;
  maxHitstop: number;
  maxFlash: number;
  maxFxFlash: number;
  maxScale: number;
  minTimeScale: number;
  maxAbsOffset: number;
  /** QA-5 probeA 口径：相机 offset 非零帧数。 */
  shakenFrames: number;
  /** 顿帧帧数（hitstop 计时器在跑或 tweens 被闸到 0）。 */
  frozenFrames: number;
  /** 闪白帧数（Phaser flashEffect alpha>0 或 juice 闪白计时器在跑）。 */
  flashFrames: number;
  frames: number;
}

function summarize(frames: JuiceFrame[]): JuiceSummary {
  const s: JuiceSummary = {
    maxTrauma: 0, maxHitstop: 0, maxFlash: 0, maxFxFlash: 0, maxScale: 0,
    minTimeScale: 1, maxAbsOffset: 0, shakenFrames: 0, frozenFrames: 0, flashFrames: 0, frames: frames.length,
  };
  for (const f of frames) {
    s.maxTrauma = Math.max(s.maxTrauma, f.trauma);
    s.maxHitstop = Math.max(s.maxHitstop, f.hitstop);
    s.maxFlash = Math.max(s.maxFlash, f.flash);
    s.maxFxFlash = Math.max(s.maxFxFlash, f.fxFlash);
    s.maxScale = Math.max(s.maxScale, f.scale);
    s.minTimeScale = Math.min(s.minTimeScale, f.ts);
    s.maxAbsOffset = Math.max(s.maxAbsOffset, Math.abs(f.offX), Math.abs(f.offY));
    if (f.offX !== 0 || f.offY !== 0) s.shakenFrames += 1;
    if (f.hitstop > 0 || f.ts === 0) s.frozenFrames += 1;
    if (f.fxFlash > 0 || f.flash > 0) s.flashFrames += 1;
  }
  return s;
}

// ── 页内工具 ─────────────────────────────────────────────────────────────

/** 页内逐帧记录器（ag91-juice.spec.ts 同款）：rAF 采样 scene.juice + 相机效果。
 *  返回 tracer 的 t0（performance.now 绝对值）——窗口边界按同一时钟切。 */
async function installJuiceTracer(page: Page): Promise<number> {
  return page.evaluate(() => {
    const g = window.__PHASER_GAME__ as unknown as {
      scene: { getScene: (k: string) => unknown | null };
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
    const t0 = performance.now();
    w.__ag91Trace = { frames: [], t0, running: true };
    const tick = (): void => {
      const f = read();
      if (f) {
        f.t -= t0;
        w.__ag91Trace!.frames.push(f);
        if (w.__ag91Trace!.frames.length > 7200) w.__ag91Trace!.frames.shift();
      }
      if (w.__ag91Trace!.running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return t0;
  });
}

async function readJuiceTrace(page: Page): Promise<JuiceFrame[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __ag91Trace?: { frames: JuiceFrame[]; running: boolean } };
    if (w.__ag91Trace) w.__ag91Trace.running = false;
    return (w.__ag91Trace?.frames ?? []) as JuiceFrame[];
  });
}

/** 页面时钟读数（与 tracer 的 performance.now() 同一时钟，用于切窗口）。 */
async function now(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

async function combatState(page: Page): Promise<{ inCombat: boolean; turn: number; monsterHp: number; playerHp: number; monsterName: string; behavior: string; guarding: boolean; logTail: string }> {
  return page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState() as unknown as
      | { combat?: { turn: number; monster: { hp: number; name: string; behavior: string }; guarding: boolean; log: string[] }; player: { hp: number } }
      | null
      | undefined;
    return {
      inCombat: !!s?.combat,
      turn: s?.combat?.turn ?? -1,
      monsterHp: s?.combat?.monster.hp ?? -1,
      playerHp: s?.player.hp ?? -1,
      monsterName: s?.combat?.monster.name ?? '',
      behavior: s?.combat?.monster.behavior ?? '',
      guarding: s?.combat?.guarding ?? false,
      logTail: s?.combat?.log.slice(-2).join(' | ') ?? '',
    };
  });
}

/** 场景直下可见飘字（-N / 未命中）。 */
async function probeFloater(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const scene = (window.__PHASER_GAME__ as unknown as {
      scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean }> } } | null };
    }).scene.getScene('Game');
    const t = scene?.children.list.find((c) => c.type === 'Text' && c.visible && (/^-\d+$/.test(c.text ?? '') || c.text === '未命中'));
    return t?.text ?? null;
  });
}

/** 战斗 UI 文本探针：动作条三钮/回合签/日志三行/结果面板的文案边界。 */
async function probeCombatUi(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const scene = (window.__PHASER_GAME__ as unknown as {
      scene: {
        getScene: (k: string) => {
          children: { list: Array<{ type: string; text?: string; visible: boolean; getBounds?: () => { x: number; y: number; width: number; height: number } }> };
        } | null;
      };
    }).scene.getScene('Game');
    const texts = (scene?.children.list ?? []).filter((c) => c.type === 'Text' && c.visible && !!c.text);
    return texts
      .filter((c) => /^(攻击|格挡|撤退|第 \d+ 回合|当前武器|.*伤害|未命中|你成功|你撤出|守门人|战斗胜利|敌人逃走|Enter)/.test(c.text ?? ''))
      .map((c) => {
        const b = c.getBounds?.();
        return { text: c.text, x: b ? Math.round(b.x) : -1, y: b ? Math.round(b.y) : -1, w: b ? Math.round(b.width) : -1, h: b ? Math.round(b.height) : -1 };
      });
  });
}

/** 世界坐标探针：双方位置 + 具名容器可见性（ag70 同款口径）。 */
async function probeStage(page: Page): Promise<unknown> {
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
    const scene = g.scene.getScene('Game');
    if (!scene) throw new Error('no Game scene');
    const cam = scene.cameras.main;
    const monster = scene.children.list.find((c) => c.name === 'combat-monster-view');
    const playerTag = scene.children.list.find((c) => c.name === 'combat-player-tag');
    const hit = scene.children.list.find((c) => c.name === 'combat-monster-hit');
    return {
      floorW: scene.floorW,
      playerX: scene.player.x,
      monsterX: monster?.x ?? -1,
      monsterScreenX: monster ? (monster.x - cam.scrollX) * cam.zoom : -1,
      playerScreenX: (scene.player.x - cam.scrollX) * cam.zoom,
      monsterVisible: !!monster?.visible,
      playerTagVisible: !!playerTag?.visible,
      hitVisible: !!hit?.visible,
    };
  });
}

/** 画布裁剪矩形（Scale.FIT + CENTER_BOTH 在 1280×800 视口里 letterbox）。 */
async function canvasClip(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('no canvas');
  return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
}

async function shot(page: Page, name: string): Promise<void> {
  const clip = await canvasClip(page);
  await page.screenshot({ path: `${OUT}/screenshots/${TAG}-${name}.png`, clip });
}

async function startGame(page: Page, seed: number): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await page.waitForFunction(() => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Menu'), undefined, { timeout: 20_000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect'), undefined, { timeout: 10_000 });
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const started = await page
      .waitForFunction(() => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'), undefined, { timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    if (started) break;
  }
  await page.waitForFunction(() => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'), undefined, { timeout: 20_000 });
}

/** 爬到目标层（上楼口每层都在左端 x=40）。 */
async function climbToFloor(page: Page, target: number): Promise<void> {
  for (let attempt = 0; attempt < target + 2; attempt++) {
    const floor = await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.currentFloor);
    if (floor === target) return;
    await page.evaluate(() => {
      const st = window.__PHASER_SESSION__?.getState();
      if (st) st.player.x = 40;
    });
    await page.keyboard.press('E');
    await page.waitForFunction((t) => window.__PHASER_SESSION__?.getState()?.currentFloor === t, target, { timeout: 10_000 }).catch(() => false);
  }
  expect(await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.currentFloor)).toBe(target);
}

interface SpotInfo { k: string; x: number; combat: boolean }

/** 本层问号点 + 纯引擎预判哪些是战斗点（rollEncounter 同参复算）。 */
async function floorSpots(page: Page, floor: number): Promise<SpotInfo[]> {
  const raw = await page.evaluate(() => {
    const sc = (window.__PHASER_GAME__ as unknown as { scene: { getScene: (k: string) => { spotMarkers?: Map<string, { x: number }> } | null } }).scene.getScene('Game');
    const st = window.__PHASER_SESSION__?.getState() as unknown as { runSeed: number; day: number } | null;
    return {
      runSeed: st?.runSeed ?? 0,
      day: st?.day ?? 1,
      spots: [...(sc?.spotMarkers ?? new Map()).entries()].map(([k, v]) => ({ k, x: Math.round(v.x) })),
    };
  });
  const seedState = { runSeed: raw.runSeed, day: raw.day } as never;
  return raw.spots.map((sp) => {
    const kind = rollEncounter(seedState, floor, sp.k).kind;
    return { k: sp.k, x: sp.x, combat: kind === 'ambush' || kind === 'boss' };
  });
}

/** 传送到指定问号点并站在上面（不按 E）。 */
async function standOnSpot(page: Page, x: number): Promise<void> {
  await page.evaluate((px) => {
    const st = window.__PHASER_SESSION__?.getState();
    if (st) st.player.x = px;
  }, x);
  await page.waitForTimeout(400);
}

/** 给包里塞一把匕首（XP-1 匕首链：session 状态直改，与 addItem 同槽形）。 */
async function giveDagger(page: Page): Promise<void> {
  await page.evaluate(() => {
    const st = window.__PHASER_SESSION__?.getState() as unknown as { player: { inventory: { slots: Array<{ itemId: string; quantity: number }> } } } | null;
    if (st && !st.player.inventory.slots.some((s) => s.itemId === 'dagger')) {
      st.player.inventory.slots.push({ itemId: 'dagger', quantity: 1 });
    }
  });
}

// ── 战斗链 ────────────────────────────────────────────────────────────────

interface ChainResult {
  tag: string;
  seed: number;
  floor: number;
  spot: string;
  monster: string;
  behavior: string;
  /** 击杀所用的攻击回合数（Enter 次数，XP-1 口径）。 */
  roundsToKill: number;
  /** 玩家受击回合号（medium juice 的发生轮）。 */
  hitRounds: number[];
  /** 每轮 Enter 后的 520ms 窗口摘要。 */
  roundWindows: JuiceSummary[];
  /** 每轮窗内的飘字（-N / 未命中）。 */
  floaters: Array<string | null>;
  killWindow: JuiceSummary;
  openWindow: JuiceSummary;
  playerHpAfter: number;
  logTail: string;
  stageProbes: Record<string, unknown>;
  uiProbes: Record<string, unknown>;
  errors: string[];
}

/**
 * 完整战斗链：战斗前世界 → 开战 → 攻击到击杀 → 结算 → 回世界。
 * juice 窗口按轮切（每轮 Enter 后 520ms），开战窗与击杀轮单独切。
 */
async function runCombatChain(page: Page, opts: { tag: string; seed: number; floor: number; spotId: string; dagger: boolean }): Promise<ChainResult> {
  const result: ChainResult = {
    tag: opts.tag, seed: opts.seed, floor: opts.floor, spot: opts.spotId, monster: '', behavior: '', roundsToKill: -1,
    hitRounds: [], roundWindows: [], floaters: [], killWindow: summarize([]), openWindow: summarize([]),
    playerHpAfter: -1, logTail: '', stageProbes: {}, uiProbes: {}, errors: [],
  };
  const roundWin: Array<[number, number]> = [];
  let killWin: [number, number] | null = null;

  await startGame(page, opts.seed);
  await climbToFloor(page, opts.floor);
  if (opts.dagger) await giveDagger(page);
  const t0 = await installJuiceTracer(page);

  // 站在问号点上（不按 E）——「战斗前」世界稳帧。
  const spot = (await floorSpots(page, opts.floor)).find((s) => s.k === opts.spotId);
  expect(spot, `spot ${opts.spotId} exists`).toBeTruthy();
  expect(spot!.combat, `spot ${opts.spotId} is a combat spot`).toBe(true);
  await standOnSpot(page, spot!.x);
  result.stageProbes.before = await probeStage(page);
  await shot(page, '00-world-before');

  // ── 开战 ──
  const tOpen = (await now(page)) - t0;
  await page.keyboard.press('E');
  await page.waitForTimeout(1500); // 滑步 + 偷袭演出 + 行为标签飘字落地
  const opened = await combatState(page);
  expect(opened.inCombat, 'combat opened').toBe(true);
  result.monster = opened.monsterName;
  result.behavior = opened.behavior;
  result.stageProbes.open = await probeStage(page);
  result.uiProbes.open = await probeCombatUi(page);
  await shot(page, '01-combat-open');
  const tOpenEnd = (await now(page)) - t0;

  // ── 攻击到击杀 ──
  let killed = false;
  for (let round = 0; round < 16 && !killed; round++) {
    const before = await combatState(page);
    if (!before.inCombat) break;
    const tEnter = (await now(page)) - t0;
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const floater = await probeFloater(page);
    if (round === 0) {
      result.stageProbes.hit = await probeStage(page);
      result.uiProbes.hit = await probeCombatUi(page);
      await shot(page, '02-hit-frame');
    }
    await page.waitForTimeout(320);
    const tWinEnd = (await now(page)) - t0;
    roundWin.push([tEnter, tWinEnd]);
    result.floaters.push(floater);
    const after = await combatState(page);
    if (after.playerHp < before.playerHp) result.hitRounds.push(round);
    if (after.monsterHp === 0) {
      killed = true;
      result.roundsToKill = round + 1;
      killWin = [tEnter, tWinEnd];
      result.stageProbes.kill = await probeStage(page);
      result.uiProbes.kill = await probeCombatUi(page);
      await shot(page, '03-kill-frame');
      await page.waitForTimeout(700);
      await shot(page, '04-outcome');
      result.playerHpAfter = after.playerHp;
      result.logTail = after.logTail;
      // 回世界
      await page.keyboard.press('Enter');
      await page.waitForTimeout(700);
      const world = await combatState(page);
      expect(world.inCombat, 'combat closed after outcome Enter').toBe(false);
      result.stageProbes.world = await probeStage(page);
      await shot(page, '05-back-to-world');
    }
  }
  expect(killed, 'fight reaches a kill within 16 rounds').toBe(true);

  // 窗口切分在 Node 侧做（trace 读回后按 tracer 时钟切）。
  const frames = await readJuiceTrace(page);
  result.openWindow = summarize(frames.filter((f) => f.t >= tOpen && f.t <= tOpenEnd));
  result.roundWindows = roundWin.map(([a, b]) => summarize(frames.filter((f) => f.t >= a && f.t <= b)));
  if (killWin) result.killWindow = summarize(frames.filter((f) => f.t >= killWin[0] && f.t <= killWin[1]));
  return result;
}

/** 偷袭+撤退链：开战（ambusher 有开场偷袭 medium 窗）→ ESC 撤退（可失败，重试）→ 回世界 → 同点可再开。 */
async function runFleeChain(page: Page, opts: { seed: number; floor: number; spotId: string }): Promise<{
  spot: string; monster: string; behavior: string; resolved: boolean; reopened: boolean;
  fleeAttempts: number; openWindow: JuiceSummary; stageProbes: Record<string, unknown>;
}> {
  await startGame(page, opts.seed);
  await climbToFloor(page, opts.floor);
  const t0 = await installJuiceTracer(page);

  const spot = (await floorSpots(page, opts.floor)).find((s) => s.k === opts.spotId);
  expect(spot, `spot ${opts.spotId} exists`).toBeTruthy();
  await standOnSpot(page, spot!.x);
  await shot(page, '00-world-before');

  const tOpen = (await now(page)) - t0;
  await page.keyboard.press('E');
  await page.waitForTimeout(1500); // 滑步 + 偷袭演出落地
  const opened = await combatState(page);
  expect(opened.inCombat, 'combat opened').toBe(true);
  const tOpenEnd = (await now(page)) - t0;
  const stageProbes: Record<string, unknown> = { open: await probeStage(page) };
  await shot(page, '01-combat-open');

  // ESC = 撤退轮（可能失败：失败即普通回合，怪物反击）。重试到真撤出。
  let fleeAttempts = 0;
  let resolved = false;
  for (let attempt = 0; attempt < 8 && !resolved; attempt++) {
    fleeAttempts += 1;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await shot(page, `07-flee-show-${attempt}`);
    await page.waitForTimeout(500);
    resolved = !(await combatState(page)).inCombat;
  }
  await shot(page, '08-flee-after');
  // 同一点再按 E：未消耗的点能再开一场。
  await standOnSpot(page, spot!.x);
  await page.keyboard.press('E');
  await page.waitForTimeout(600);
  const reopened = (await combatState(page)).inCombat;
  await shot(page, '09-flee-reopened');
  if (reopened) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
  }
  const frames = await readJuiceTrace(page);
  return {
    spot: opts.spotId, monster: opened.monsterName, behavior: opened.behavior, resolved, reopened,
    fleeAttempts, openWindow: summarize(frames.filter((f) => f.t >= tOpen && f.t <= tOpenEnd)), stageProbes,
  };
}

// ── 主探针 ────────────────────────────────────────────────────────────────

test('RC-03 第 7 步冻结探针：seed42 完整战斗链 + XP-1 4/3 + 偷袭/撤退', async ({ page }) => {
  test.setTimeout(900_000);
  mkdirSync(`${OUT}/screenshots`, { recursive: true });
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  // ── 链 A：seed42 2 层 拾荒者（冻结截图全套） ──
  const chainA = await runCombatChain(page, { tag: 'A-seed42-f2', seed: 42, floor: 2, spotId: '2:spot1', dagger: false });
  console.log(`[step7] A seed42 f2 ${chainA.monster}/${chainA.behavior}: rounds=${chainA.roundsToKill} hitRounds=${JSON.stringify(chainA.hitRounds)} playerHp=${chainA.playerHpAfter}`);
  console.log(`[step7] A openWindow: ${JSON.stringify(chainA.openWindow)}`);
  chainA.roundWindows.forEach((w, i) => console.log(`[step7] A round${i + 1}: ${JSON.stringify(w)} floater=${chainA.floaters[i]}`));
  console.log(`[step7] A killWindow: ${JSON.stringify(chainA.killWindow)}`);

  // ── 链 B：seed21 4 层 弹弓顽童（XP-1 空手 4 回合） ──
  const chainB = await runCombatChain(page, { tag: 'B-seed21-f4-empty', seed: 21, floor: 4, spotId: '4:spot0', dagger: false });
  console.log(`[step7] B seed21 f4 empty: ${chainB.monster}/${chainB.behavior} rounds=${chainB.roundsToKill} hitRounds=${JSON.stringify(chainB.hitRounds)} playerHp=${chainB.playerHpAfter}`);
  console.log(`[step7] B killWindow: ${JSON.stringify(chainB.killWindow)}`);
  chainB.roundWindows.forEach((w, i) => console.log(`[step7] B round${i + 1}: ${JSON.stringify(w)} floater=${chainB.floaters[i]}`));

  // ── 链 B2：同一点同 seed，匕首（XP-1 3 回合） ──
  const chainB2 = await runCombatChain(page, { tag: 'B2-seed21-f4-dagger', seed: 21, floor: 4, spotId: '4:spot0', dagger: true });
  console.log(`[step7] B2 seed21 f4 dagger: ${chainB2.monster}/${chainB2.behavior} rounds=${chainB2.roundsToKill} hitRounds=${JSON.stringify(chainB2.hitRounds)} playerHp=${chainB2.playerHpAfter}`);

  // ── 链 C：seed21 4 层 楼道潜行者 ambusher（开场偷袭 medium + 撤退链） ──
  const chainC = await runFleeChain(page, { seed: 21, floor: 4, spotId: '4:spot1' });
  console.log(`[step7] C seed21 f4 flee: ${chainC.monster}/${chainC.behavior} attempts=${chainC.fleeAttempts} resolved=${chainC.resolved} reopened=${chainC.reopened}`);
  console.log(`[step7] C openWindow: ${JSON.stringify(chainC.openWindow)}`);

  const evidence = { tag: TAG, chainA, chainB, chainB2, chainC };
  writeFileSync(`${OUT}/evidence.json`, JSON.stringify(evidence, null, 2));

  // ── 行为断言（QA-5 口径：冻结的是这些数字本身） ──
  // XP-1：seed21 4 层弹弓顽童——空手 4 回合 / 匕首 3 回合击杀。
  expect(chainB.monster, 'slingshot kid on floor 4').toBe('弹弓顽童');
  expect(chainB.behavior).toBe('ranged');
  expect(chainB.roundsToKill, 'XP-1 empty-hand rounds (QA-5: 4)').toBe(4);
  expect(chainB2.roundsToKill, 'XP-1 dagger rounds (QA-5: 3)').toBe(3);
  // 链 A/B 同 seed 同点同怪（确定性）。
  expect(chainA.monster).toBe('拾荒者');
  expect(chainB.monster).toBe(chainB2.monster);
  // juice large（击杀）：满 trauma + 120ms 顿帧 + 闪白 + 缩放 + 震屏有界。
  expect(chainA.killWindow.maxTrauma, 'large trauma').toBeGreaterThan(0.9);
  expect(chainA.killWindow.maxHitstop, 'large hitstop').toBeGreaterThanOrEqual(100);
  expect(chainA.killWindow.flashFrames, 'large flash frames').toBeGreaterThan(0);
  expect(chainA.killWindow.maxScale, 'large squash').toBeGreaterThanOrEqual(100);
  expect(chainA.killWindow.minTimeScale, 'hitstop freezes tweens').toBe(0);
  expect(chainA.killWindow.shakenFrames, 'camera shake frames').toBeGreaterThan(3);
  expect(chainA.killWindow.maxAbsOffset, 'shake bound').toBeLessThanOrEqual(12 * 0.7 + 0.01);
  // juice medium（受击/偷袭）：trauma 0.4 档 + 顿帧 + 闪白。顿帧 50ms 但
  // rAF 采样粒度 ~16ms + evaluate 往返，窗口内最大采样值 ~33ms——阈值取 30。
  const anyMedium = [...chainB.roundWindows, ...chainB2.roundWindows].some((w) => w.maxTrauma > 0.3 && w.maxHitstop >= 30 && w.flashFrames > 0);
  const openMedium = chainC.openWindow.maxTrauma > 0.3 && chainC.openWindow.maxHitstop >= 30;
  expect(anyMedium, 'medium tier observed on a counter hit').toBe(true);
  expect(openMedium, 'medium tier observed on the ambusher strike').toBe(true);
  // juice small（命中）：轻震起步且无顿帧无闪白。
  const anySmall = [...chainA.roundWindows, ...chainB.roundWindows].some((w) => w.maxTrauma > 0.1 && w.maxTrauma < 0.5 && w.maxHitstop === 0);
  expect(anySmall, 'small tier observed on a landing hit').toBe(true);
  // 撤退链：战斗关闭且问号点未消耗（可再开）。
  expect(chainC.resolved, 'flee closes combat').toBe(true);
  expect(chainC.reopened, 'flee leaves the spot unresolved').toBe(true);
  // 全程 pageerror 清零。
  expect(pageErrors, 'page errors').toEqual([]);
});
