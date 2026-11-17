#!/usr/bin/env node
/**
 * AG-80 帧时间探针 —— deep-end 式 performance suite 的浏览器半边。
 *
 * 做什么：启动游戏（Menu → MetaSelect → Game），在八个「玩家真的会卡」的
 * 时刻各采样 60 帧的原始 rAF 帧间隔（不是 Phaser 平滑后的 loop.delta——
 * 平滑值会把尖刺抹掉），输出每刻的 p50 / p95 / max / mean 与场景对象数，
 * 并对两个合成压力时刻（飘字风暴 / 特效风暴）打印池化证据。
 *
 * 测量协议沿用 docs/plans/RENDER.md §10.0（AG-22 立的两条，别再踩）：
 *   1. 必须带 --disable-frame-rate-limit --disable-gpu-vsync。不加时
 *      headless Chromium 的 rAF 被 vsync 钉在 16.7ms，中位数失去意义；
 *   2. 绝对帧时间受并行负载影响大，前后对比要「配对差」：同一台机器上旧
 *      代码与新代码交替各跑一轮，比同一时刻的两个分布，别比单轮绝对值。
 *
 * 用法：
 *   node tools/perf-probe.mjs [--port 5480] [--seed 42] [--frames 60]
 *                             [--label after] [--json output/perf/x.json] [--degrade]
 * 前置：先手动起 dev server（npx vite --port 5480 --strictPort）。
 * --degrade 追加降级路径验证：F3 计数器截图 + 强制降级后 playFx no-op 取证 +
 * 恢复后重新生成取证。
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

// ── 参数 ─────────────────────────────────────────────────────────────────
function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const PORT = Number(arg('port', 5480));
const SEED = String(arg('seed', '42'));
const FRAMES = Number(arg('frames', 60));
const LABEL = String(arg('label', 'run'));
const JSON_OUT = typeof arg('json', '') === 'string' ? arg('json', '') : '';
const DEGRADE = arg('degrade', false) === true;
const BASE = `http://localhost:${PORT}`;
const SHOT_DIR = 'output/perf';

// ── 统计 ─────────────────────────────────────────────────────────────────
function stats(deltas) {
  const sorted = [...deltas].sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  return {
    n: deltas.length,
    p50: +pick(0.5).toFixed(2),
    p95: +pick(0.95).toFixed(2),
    max: +sorted[sorted.length - 1].toFixed(2),
    mean: +mean.toFixed(2),
  };
}

// ── 启动序列（e2e/ag73-probe 同款） ───────────────────────────────────────
async function startGame(page) {
  const sceneIs = (key) =>
    page.waitForFunction(
      (k) => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === k),
      key,
      { timeout: 30000 },
    ).then(() => undefined);
  await page.goto(`${BASE}/?seed=${SEED}`);
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
  await page.waitForTimeout(900); // 开局 flash / 楼层对象落定
}

/**
 * 采样：60+1 个 rAF 时间戳的原始间隔。同时数「所有活动场景」的显示对象——
 * 地图时刻 TowerOverview 跑在 Game 之上，两边的对象都该被算进去。
 */
async function sample(page, label) {
  const r = await page.evaluate(
    (frames) =>
      new Promise((resolve) => {
        const game = window.__PHASER_GAME__;
        const stamps = [];
        const tick = () => {
          stamps.push(performance.now());
          if (stamps.length >= frames + 1) {
            const deltas = [];
            for (let i = 1; i < stamps.length; i++) deltas.push(stamps[i] - stamps[i - 1]);
            let objects = 0;
            const byType = {};
            for (const scene of game.scene.getScenes(true)) {
              for (const o of scene.children.list ?? []) {
                objects += 1;
                byType[o.type] = (byType[o.type] ?? 0) + 1;
              }
            }
            resolve({ deltas, objects, byType });
          } else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    FRAMES,
  );
  return { label, ...stats(r.deltas), objects: r.objects, byType: r.byType };
}

/** 关掉可能开着的面板/地图，回到「站着」的干净态。 */
async function settle(page) {
  const open = await page.evaluate(() => {
    const s = window.__PHASER_GAME__?.scene.getScene('Game');
    return {
      bag: !!s?.inventoryOpen,
      craft: !!s?.craftingOpen,
      pause: !!s?.pauseOpen,
      tower: window.__PHASER_GAME__?.scene.getScenes(true).some((x) => x.scene.key === 'TowerOverview'),
    };
  });
  if (open.bag) await page.keyboard.press('I');
  if (open.craft) await page.keyboard.press('C');
  if (open.pause) await page.keyboard.press('Escape');
  if (open.tower) await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}

/** 按住方向键走到世界 x，超时就算了（不抛——探针要继续跑完其它时刻）。 */
async function walkToX(page, x) {
  await page.keyboard.down(x > 0 ? 'ArrowRight' : 'ArrowLeft');
  await page
    .waitForFunction(
      (target) => {
        const s = window.__PHASER_SESSION__?.getState();
        return !!s && (target > 0 ? s.player.x > target : s.player.x < -target);
      },
      Math.abs(x),
      { timeout: 10000 },
    )
    .catch(() => {});
  await page.keyboard.up(x > 0 ? 'ArrowRight' : 'ArrowLeft');
  await page.waitForTimeout(200);
}

// ── 主流程 ───────────────────────────────────────────────────────────────
const browser = await chromium.launch({
  channel: 'chrome',
  // RENDER.md §10.0 第 1 条：不加这两个旗，rAF 被 vsync 钉在 16.7ms。
  args: ['--disable-frame-rate-limit', '--disable-gpu-vsync'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

await startGame(page);
const rows = [];
const proofs = {};

// 1. 站立
rows.push(await sample(page, 'idle'));

// 2. 走路
await page.keyboard.down('ArrowRight');
await page.waitForTimeout(1200);
rows.push(await sample(page, 'walk'));
await page.keyboard.up('ArrowRight');
await page.waitForTimeout(300);

// 3. 背包面板
await page.keyboard.press('I');
await page.waitForTimeout(400);
rows.push(await sample(page, 'bag'));
await page.keyboard.press('I');
await page.waitForTimeout(300);

// 4. 制作面板
await page.keyboard.press('C');
await page.waitForTimeout(400);
rows.push(await sample(page, 'craft'));
await page.keyboard.press('C');
await page.waitForTimeout(300);

// 5. 地图（TowerOverview 叠在 Game 上）
await page.keyboard.press('M');
await page.waitForTimeout(600);
rows.push(await sample(page, 'map'));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await settle(page);

// 6. 搜刮：1 层储物柜（教程坐标 160）。搜刮动作 2s，出货帧单独取一轮。
await walkToX(page, 140);
await page.keyboard.press('E');
rows.push(await sample(page, 'loot-search'));
await page.waitForTimeout(2400); // 等 2s 动作收尾 + 出货演出
rows.push(await sample(page, 'loot-drop'));

// 7. 爬梯：上梯口 x≈40，1000ms 攀爬动画是最重的既有帧之一。
await walkToX(page, -60);
await page.keyboard.press('E');
rows.push(await sample(page, 'climb'));
await page.waitForTimeout(1600);

// 8. 合成压力一：飘字风暴 —— AG-70 战斗热路径（每次命中一发 combatFloatText）。
//    一帧 30 发，池化断言 createdCount ≤ 12。
proofs.floatStorm = await page.evaluate(() => {
  const scene = window.__PHASER_GAME__.scene.getScene('Game');
  for (let i = 0; i < 30; i++) scene.combatFloatText(640 + (i % 7) * 14, 320, `-${i}`, '#e8907c');
  return { spawned: 30, created: scene.floatText.createdCount, active: scene.floatText.activeCount };
});
rows.push(await sample(page, 'float-storm'));

// 9. 合成压力二：特效风暴 —— 每次攻击都走 playSwingFx（游戏自己的 playFx
//    路径，不 import 模块——dev server 下页面直引 /src/render/fx.ts 会拿到
//    与 bundle 不同的第二个模块实例，池/降级状态各一套，取证会假）。
//    一帧 20 发，池化断言：屏上可见的 sword-slash ≤ 4（每特效池上限）。
proofs.fxStorm = await page.evaluate(() => {
  const scene = window.__PHASER_GAME__.scene.getScene('Game');
  const visible = () =>
    scene.children.list.filter((o) => o.type === 'Sprite' && (o.texture?.key ?? '') === 'sword-slash' && o.visible).length;
  for (let i = 0; i < 20; i++) scene.playSwingFx(false);
  return { spawned: 20, visible: visible() };
});
rows.push(await sample(page, 'fx-storm'));

// 10. 降级路径（--degrade）：F3 计数器 + 强制降级 + no-op 取证 + 恢复取证。
//    强制方式：直接翻场景的 applyPerfDegrade（真实触发是帧时间持续 >25ms，
//    探针机器上是 2-3ms/帧，等不到——这里只验开关与显示，不验触发本身；
//    触发阈值由 src/tests/perf.test.ts 的帧预算守卫单测钉住）。
if (DEGRADE) {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.keyboard.press('F3');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOT_DIR}/fps-counter-${LABEL}.png` });
  proofs.degraded = await page.evaluate(() => {
    const scene = window.__PHASER_GAME__.scene.getScene('Game');
    const countSlash = () =>
      scene.children.list.filter((o) => o.type === 'Sprite' && (o.texture?.key ?? '') === 'sword-slash' && o.visible).length;
    scene.playSwingFx(false);
    const spawned = countSlash();
    scene.applyPerfDegrade(true);
    scene.playSwingFx(false);
    const during = countSlash();
    return {
      text: scene.perfHudText.text,
      color: scene.perfHudText.style.color,
      degraded: scene.perfDegraded,
      spawnedBeforeDegrade: spawned,
      spawnedWhileDegraded: during - spawned,
    };
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOT_DIR}/fps-degraded-${LABEL}.png` });
  proofs.recovered = await page.evaluate(() => {
    const scene = window.__PHASER_GAME__.scene.getScene('Game');
    const countSlash = () =>
      scene.children.list.filter((o) => o.type === 'Sprite' && (o.texture?.key ?? '') === 'sword-slash' && o.visible).length;
    scene.applyPerfDegrade(false);
    const before = countSlash();
    scene.playSwingFx(false);
    return { degraded: scene.perfDegraded, spawnedAfterRecover: countSlash() - before };
  });
}

await browser.close();

// ── 输出 ─────────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n);
console.log(`\n=== AG-80 perf probe · ${LABEL} · seed ${SEED} · ${FRAMES} frames/moment ===`);
console.log(pad('moment', 14) + pad('p50', 9) + pad('p95', 9) + pad('max', 9) + pad('mean', 9) + 'objects');
for (const r of rows) {
  console.log(
    pad(r.label, 14) +
      pad(r.p50, 9) +
      pad(r.p95, 9) +
      pad(r.max, 9) +
      pad(r.mean, 9) +
      r.objects,
  );
}
console.log('\npool proofs:', JSON.stringify(proofs, null, 2));
if (pageErrors.length) {
  console.log('\nPAGE ERRORS:', pageErrors.join(' | '));
  process.exitCode = 1;
}

if (JSON_OUT) {
  mkdirSync(JSON_OUT.replace(/[/\\][^/\\]*$/, ''), { recursive: true });
  writeFileSync(
    JSON_OUT,
    JSON.stringify({ label: LABEL, seed: SEED, frames: FRAMES, rows, proofs, pageErrors }, null, 2),
  );
  console.log(`\njson → ${JSON_OUT}`);
}
