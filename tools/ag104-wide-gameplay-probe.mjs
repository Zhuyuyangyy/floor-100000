#!/usr/bin/env node
/**
 * AG-104 宽楼玩法几何无头实证探针。
 *
 * AG-101 审计出 4 项活的玩法几何漏网（AG-65 只转了渲染侧）。本探针在真实
 * 浏览器里驱动真实游戏，逐项取机读证据 + 截图：
 *   1. 遭遇点/行商能落右半（?devfloor=100000，2880px：spotMarkers 机读 x）
 *   2. 宽楼梯口折返方向正确（110 层：1920px、下行梯口 648 ∈ 旧判据错折区间
 *      [640, 960)；段 2 是阶梯样式——100000 层的下行连接 anchor 99999 无段落、
 *      回落直梯，不走 stairPath，所以楼梯证据取 110）
 *   3. 流浪者出生点覆盖右半（100000 层合成夜间巡游体事件，场景真实 spawn）
 *   4. NPC goTo 不被钳在 1280（页面内动态 import 产品模块 + 活 state 现算）
 *
 * 用法：dev server 已起后
 *   node tools/ag104-wide-gameplay-probe.mjs [--port 5215] [--seed 1]
 *     [--out /d/ZYY_Inovation/game/tmp/qa-evidence/wide-gameplay]
 * 前置：npx vite --port 5215 --strictPort --force（netstat 预检端口）。
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const PORT = Number(arg('port', 5215));
const HOST = String(arg('host', '[::1]'));
const SEED = String(arg('seed', '1'));
// 注意用盘符绝对路径：path.join 在 win32 上会把 '/d/...' 拼成驱动器相对的
// '\d\...'（本探针第一版就这样把证据写进了 D:\d\ 下）。
const OUT = String(arg('out', 'D:/ZYY_Inovation/game/tmp/qa-evidence/wide-gameplay'));
const BASE = `http://${HOST}:${PORT}`;
mkdirSync(OUT, { recursive: true });

// ── 启动序列（floor-perf-probe.mjs 同款：Menu → Enter → MetaSelect → Game）──

async function startGame(page, query) {
  const sceneIs = (key) =>
    page
      .waitForFunction(
        (k) => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === k),
        key,
        { timeout: 30000 },
      )
      .then(() => undefined);
  await page.goto(`${BASE}/?seed=${SEED}${query}`);
  await sceneIs('Menu');
  await page.keyboard.press('Enter');
  await sceneIs('MetaSelect');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const started = await page
      .waitForFunction(
        () => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'),
        undefined,
        { timeout: 2000 },
      )
      .then(() => true)
      .catch(() => false);
    if (started) break;
  }
  await sceneIs('Game');
  await page.waitForTimeout(1500); // 楼层对象/商人巡逻落定
}

const browser = await chromium.launch({
  channel: 'chrome',
  args: [
    '--disable-frame-rate-limit',
    '--disable-gpu-vsync',
    // 绕过本机代理，直连 [::1] dev server。
    '--no-proxy-server',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => {
  try {
    localStorage.setItem('floor100000.tutorial.skipped', '1');
  } catch {
    /* 隐私模式：仅截图确定性受损 */
  }
});
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

const report = { seed: Number(SEED), checks: {}, readings: {}, screenshots: [], pageErrors };
const pass = (name, ok, detail) => {
  report.checks[name] = { pass: !!ok, detail };
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

await startGame(page, '&devfloor=100000');

// ── 0. 楼层几何基线（100000：9 房 2880px） ─────────────────────────────────
const base = await page.evaluate(() => {
  const s = window.__PHASER_GAME__.scene.getScene('Game');
  const session = window.__PHASER_SESSION__?.getState();
  return {
    floor: session?.currentFloor ?? null,
    floorW: s.floorW ?? null,
    downExit: s.downExit ?? null,
    playerX: s.player?.x ?? null,
  };
});
report.readings.base = base;
pass('楼层几何：100000 层宽 2880、玩家入口 640', base.floorW === 2880 && base.playerX === 640, JSON.stringify(base));

// ── 1. 遭遇点/行商落右半 ───────────────────────────────────────────────────
const spots = await page.evaluate(() => {
  const s = window.__PHASER_GAME__.scene.getScene('Game');
  const out = [];
  for (const [id, m] of s.spotMarkers ?? []) {
    out.push({ id, x: Math.round((m.dot?.x ?? m.x) * 10) / 10, isBoss: !!m.isBoss });
  }
  return out;
});
report.readings.spots = spots;
const rightHalf = spots.filter((sp) => sp.x > 1280);
pass(
  '遭遇点/行商：宽楼有标记落在右半（x>1280）',
  rightHalf.length > 0,
  `右半标记 ${rightHalf.length} 个：${rightHalf.map((sp) => `${sp.id}@${sp.x}`).join(', ')}；全部 ${spots.length} 个`,
);

// ── 3. 流浪者出生点覆盖右半（场景真实 spawn）────────────────────────────────
const wanderer = await page.evaluate(async () => {
  const game = window.__PHASER_GAME__;
  const s = game.scene.getScene('Game');
  const session = window.__PHASER_SESSION__?.getState();
  // 合成一个本层夜间巡游体事件：planNightWanderer 的全部入场条件。
  session.gameMinuteOfDay = 1320; // 22:00，夜间
  session.worldEvents.activeEvent = {
    type: 'wanderer',
    floor: session.currentFloor,
    status: 'active',
    source: 'night',
    message: 'probe',
  };
  await new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => (s.wanderer ? resolve() : performance.now() - t0 > 8000 ? resolve() : requestAnimationFrame(tick));
    tick();
  });
  // 冻住循环再读，防巡逻位移混进读数。
  game.loop.sleep();
  const frozenX = s.wanderer ? Math.round(s.wanderer.x * 10) / 10 : null;
  return { spawned: !!s.wanderer, frozenX };
});
report.readings.wanderer = wanderer;
pass(
  '流浪者：宽楼夜间出生点落在右半（x>1280）',
  wanderer.spawned && wanderer.frozenX > 1280,
  `spawnX=${wanderer.frozenX}（旧行为全部 ≤1232）`,
);

// ── 4. NPC goTo 不被钳在 1280（产品模块 + 活 state）─────────────────────────
const npc = await page.evaluate(async () => {
  const atoms = await import('/src/ai/npcAtoms.ts');
  const npcs = await import('/src/data/npcs.ts');
  const session = window.__PHASER_SESSION__?.getState();
  const alin = npcs.getNpc('alin');
  const forced = atoms.npcAtomsFor(alin, session, { forcedTarget: 2000, floorWidth: 2880 });
  const far = atoms.npcAtomsFor(alin, session, { forcedTarget: 99999, floorWidth: 2880 });
  const legacy = atoms.npcAtomsFor(alin, session, { forcedTarget: 99999 });
  return {
    goTo2000: forced[0].x,
    clampAt2880: far[0].x,
    clampLegacy: legacy[0].x,
  };
});
report.readings.npc = npc;
pass(
  'NPC goTo：指令点 2000 原样可达；越界值按 2880 钳（2832）而非 1280（1232）',
  npc.goTo2000 === 2000 && npc.clampAt2880 === 2832 && npc.clampLegacy === 1232,
  JSON.stringify(npc),
);

// ── 截图（100000 场景） ────────────────────────────────────────────────────
// 注意：game.loop.sleep() 之后画面不再重渲染（canvas 停在最后一帧），相机
// 移动会看不见——所以截图前先 wake、stopFollow 再 centerOn，等至少一帧。
async function shoot(name, centerX) {
  await page.evaluate(() => window.__PHASER_GAME__.loop.wake());
  await page.evaluate((cx) => {
    const s = window.__PHASER_GAME__.scene.getScene('Game');
    s.cameras.main.stopFollow();
    s.cameras.main.centerOn(cx, 360);
  }, centerX);
  await page.waitForTimeout(350); // 至少一帧按新相机渲染
  const shot = await page.evaluate(() => {
    const s = window.__PHASER_GAME__.scene.getScene('Game');
    return { scrollX: Math.round(s.cameras.main.scrollX), wandererX: s.wanderer ? Math.round(s.wanderer.x * 10) / 10 : null };
  });
  const path = join(OUT, name);
  await page.screenshot({ path });
  report.screenshots.push({ path, ...shot });
  console.log(`SHOT ${path} (scrollX=${shot.scrollX}${shot.wandererX !== null ? `, wandererX=${shot.wandererX}` : ''})`);
}

// 01 站立全景：2880 宽楼左半（玩家 640 入口 + 上梯口 40 + 下行直梯口 992）。
await shoot('01-wide-floor-standing.png', 640);
// 02 右半：行商与 spot1 同框（相机被楼层右界钳在 1600，显示 1600..2880）。
await shoot('02-right-half-trader-spot.png', 2400);
// 04 流浪者同框（出生在右半；唤醒后它朝玩家走，取此刻实际 x 居中）。
if (wanderer.spawned) {
  const nowX = await page.evaluate(() => Math.round((window.__PHASER_GAME__.scene.getScene('Game').wanderer?.x ?? 0) * 10) / 10);
  await shoot('04-wanderer-right-half.png', nowX);
}

// ── 2. 宽楼梯口折返方向（切到 110 层：1920px、下行梯口 648、阶梯样式）───────
// （此时 loop 已被 shoot() 唤醒，restart 的入队步骤才会跑。）
await page.evaluate(() => {
  const game = window.__PHASER_GAME__;
  const s = game.scene.getScene('Game');
  const session = window.__PHASER_SESSION__?.getState();
  session.worldEvents.activeEvent = null;
  session.currentFloor = 110;
  session.player.x = 640;
  s.scene.restart();
});
await page.waitForFunction(() => window.__PHASER_GAME__.scene.getScene('Game')?.floorW === 1920, undefined, { timeout: 20000 });
await page.waitForTimeout(1500);

const stair = await page.evaluate(async () => {
  const game = window.__PHASER_GAME__;
  const s = game.scene.getScene('Game');
  const session = window.__PHASER_SESSION__?.getState();
  // Phaser 4 Graphics.commandBuffer 是扁平数组：操作码 + 定长参数。
  // 操作码（phaser/src/gameobjects/graphics/Commands.js）：
  //   3=FILL_RECT(x,y,w,h) 6=LINE_STYLE(w,c,a) 7=FILL_STYLE(c,a) 4/5=LINE/MOVE_TO(x,y)
  const OP_ARGS = { 0: 4, 1: 0, 2: 0, 3: 4, 4: 2, 5: 2, 6: 3, 7: 2, 8: 0, 9: 0, 10: 6, 11: 6, 14: 0, 15: 0, 16: 2, 17: 2, 18: 1, 21: 5, 22: 6 };
  const parse = (buf) => {
    const cmds = [];
    for (let i = 0; i < buf.length; ) {
      const op = buf[i];
      const n = OP_ARGS[op];
      if (n === undefined) break;
      cmds.push({ op, args: buf.slice(i + 1, i + 1 + n) });
      i += 1 + n;
    }
    return cmds;
  };
  const mouth = s.downExit ?? 0;
  const sillX = Math.round(mouth - 24);
  let stairG = null;
  for (const o of s.children.list) {
    if (o.type !== 'Graphics' || !o.commandBuffer) continue;
    const cmds = parse(o.commandBuffer);
    const hasSill = cmds.some((c) => c.op === 3 && c.args[2] === 48 && c.args[3] === 4 && Math.abs(c.args[0] - sillX) <= 1);
    if (hasSill) {
      stairG = { cmds };
      break;
    }
  }
  const treads = stairG ? stairG.cmds.filter((c) => c.op === 3 && c.args[2] === 32).map((c) => Math.round(c.args[0])) : [];
  // 产品函数直读：真实 traversal + 爬梯曲线（与场景 updateStairClimb 同调用）。
  const corridors = await import('/src/render/corridors.ts');
  const floorSystem = await import('/src/systems/FloorSystem.ts');
  const t = floorSystem.stairTraversalFor(session, -1);
  const nodes = corridors.stairPath(-1, t.startX, t.startY, s.floorW);
  const mid = corridors.stairClimbPose(session.currentFloor, t, t.durationMs / 2);
  return {
    mouth,
    floorW: s.floorW,
    treadCount: treads.length,
    treadLefts: treads,
    traversalStartX: t?.startX ?? null,
    firstTreadX: nodes[1].x,
    landingX: nodes[5].x,
    poseMidX: mid.x,
  };
});
report.readings.stair = stair;
pass(
  '楼梯折返：110 层梯口 648（<楼中 960）第一段朝右，踏面不越梯口左沿、落点在楼中右侧',
  stair.treadCount === 20 &&
    stair.treadLefts.every((t) => t >= stair.mouth - 16) &&
    stair.firstTreadX === 680 &&
    stair.landingX === 808 &&
    stair.poseMidX === 808,
  `梯口 ${stair.mouth} 楼宽 ${stair.floorW}，踏面左沿 [${Math.min(...stair.treadLefts)}, ${Math.max(...stair.treadLefts)}]（末块回到梯口左沿 ${stair.mouth - 16}；旧行为整条会在 ${stair.mouth - 176}..${stair.mouth - 48}）；stairPath 落点 ${stair.landingX}，爬梯曲线半程 x=${stair.poseMidX}`,
);

// 03 梯口特写：Z 形折返第一段朝楼中（右）。
await shoot('03-stairwell-fold.png', stair.mouth);

report.pageErrors = pageErrors;
writeFileSync(join(OUT, 'ag104-wide-gameplay.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`JSON ${join(OUT, 'ag104-wide-gameplay.json')}`);

const failed = Object.entries(report.checks).filter(([, v]) => !v.pass);
await browser.close();
if (failed.length > 0 || pageErrors.length > 0) {
  console.error(`FAILED: ${failed.map(([k]) => k).join(', ')}${pageErrors.length ? `; pageErrors: ${pageErrors.join(' | ')}` : ''}`);
  process.exit(1);
}
console.log('ALL CHECKS PASS');
