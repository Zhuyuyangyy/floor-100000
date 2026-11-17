#!/usr/bin/env node
/**
 * AG-100-perf2 诊断工具（不提交）：分块+剔除的**成本天花板实验**。
 *
 * 在未改动的基线上，把「可 chunk 的宽度缩放 builder 产出的 Graphics」
 * （按 census 签名选出来：depth 0/1/2/3/4/26 的世界层，排除 1280px 宽的
 * 灯光层 ambient/vignette 与 HUD）整组 visible=false，配对测量能省多少
 * 帧时间。若全藏都省不到 15%，分块剔除（只能藏掉视口外 ~44%）必然达不到
 * 落地门槛——用数据在实现前裁决，避免白干。
 *
 * 协议同 floor-perf-probe.mjs：rAF 原始间隔、60 帧、3 轮、A/B 顺序逐轮
 * 反转、逐轮配对差中位。
 *
 * 用法：node tools/chunk-cost-probe.mjs [--port 5211] [--set all|sharedG]
 */
import { chromium } from '@playwright/test';

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const PORT = Number(arg('port', 5211));
const HOST = String(arg('host', '[::1]'));
const SEED = String(arg('seed', '42'));
const FRAMES = Number(arg('frames', 60));
const ROUNDS = Number(arg('rounds', 3));
const SETS = String(arg('sets', 'all'))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const SET_TABLE = {
  sharedG: `(v, d, o) => o.type !== 'RenderTexture' && d === 0 && v > 1000`,
  all: `(v, d, o) => o.type !== 'RenderTexture' && ((d === 0 && v > 100) || (d === 1 && v > 400) || (d === 2 && v > 50) || (d === 3 && v > 200) || (d === 4 && v > 30 && v < 60) || d === 26)`,
  everygfx: `(v, d, o) => o.type !== 'RenderTexture'`,
  hud103: `(v, d, o) => o.type !== 'RenderTexture' && d === 103`,
  hud101: `(v, d, o) => o.type !== 'RenderTexture' && d === 101`,
  // AG-102（性能轮 3）：四联圆环预烘焙成 RenderTexture 后的单集归因——
  // 按 name 选那一个 RT，量它每帧还剩多少成本（预期 ~0.05ms 的一个 quad，
  // 对比 AG-100 会话 C 量的旧 Graphics 0.68ms）。
  ringsRT: `(v, d, o) => o.type === 'RenderTexture' && o.name === 'hud-stat-rings'`,
};
for (const s of SETS) {
  if (!SET_TABLE[s]) {
    console.error(`unknown set: ${s} (${Object.keys(SET_TABLE).join('|')})`);
    process.exit(1);
  }
}
const BASE = `http://${HOST}:${PORT}`;

function stats(deltas) {
  const sorted = [...deltas].sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  return { n: deltas.length, avg: +mean.toFixed(2), p50: +pick(0.5).toFixed(2), p95: +pick(0.95).toFixed(2), p99: +pick(0.99).toFixed(2), max: +sorted[sorted.length - 1].toFixed(2) };
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--disable-frame-rate-limit', '--disable-gpu-vsync', '--no-proxy-server'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => {
  try {
    localStorage.setItem('floor100000.tutorial.skipped', '1');
  } catch {}
});

const sceneIs = (key) =>
  page.waitForFunction(
    (k) => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === k),
    key,
    { timeout: 30000 },
  ).then(() => undefined);
await page.goto(`${BASE}/?seed=${SEED}&devfloor=100000`);
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
await page.waitForTimeout(1200);

// 报告选中的对象与值数（实验前确认选对了集）
for (const name of SETS) {
  const picked = await page.evaluate((selSrc) => {
    const sel = eval(selSrc);
    const game = window.__PHASER_GAME__;
    const rows = [];
    for (const s of game.scene.getScenes(true)) {
      for (const o of s.children.list) {
        if ((o.type === 'Graphics' && o.commandBuffer) || o.type === 'RenderTexture') {
          if (sel(o.commandBuffer?.length ?? 0, o.depth, o)) rows.push({ depth: o.depth, type: o.type, values: o.commandBuffer?.length ?? 0 });
        }
      }
    }
    return rows;
  }, SET_TABLE[name]);
  const pickedValues = picked.reduce((a, r) => a + r.values, 0);
  console.log(`set=${name}: 选中 ${picked.length} 个对象（${picked.map((r) => r.type).join('/') || '无'}），合计 ${pickedValues} 缓冲区值`);
}

async function sample() {
  const r = await page.evaluate(
    (frames) =>
      new Promise((resolve) => {
        const stamps = [];
        const tick = () => {
          stamps.push(performance.now());
          if (stamps.length >= frames + 1) {
            const deltas = [];
            for (let i = 1; i < stamps.length; i++) deltas.push(stamps[i] - stamps[i - 1]);
            resolve(deltas);
          } else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    FRAMES,
  );
  return stats(r);
}

/** 只显示 selSrc 选中的集，其余 Graphics 全藏——用于单集归因。 */
async function showOnly(selSrc) {
  await page.evaluate((src) => {
    const sel = eval(src);
    const game = window.__PHASER_GAME__;
    for (const s of game.scene.getScenes(true)) {
      for (const o of s.children.list) {
        if ((o.type === 'Graphics' && o.commandBuffer) || o.type === 'RenderTexture') o.visible = sel(o.commandBuffer?.length ?? 0, o.depth, o);
      }
    }
  }, selSrc);
}

/** 藏掉 selSrc 选中的集，其余全显——与真实分块剔除同语义（决策用这个）。 */
async function hideSet(selSrc) {
  await page.evaluate((src) => {
    const sel = eval(src);
    const game = window.__PHASER_GAME__;
    for (const s of game.scene.getScenes(true)) {
      for (const o of s.children.list) {
        if ((o.type === 'Graphics' && o.commandBuffer) || o.type === 'RenderTexture') o.visible = !sel(o.commandBuffer?.length ?? 0, o.depth, o);
      }
    }
  }, selSrc);
}

async function restoreAll() {
  await page.evaluate(() => {
    const game = window.__PHASER_GAME__;
    for (const s of game.scene.getScenes(true)) {
      for (const o of s.children.list) {
        if (o.type === 'Graphics' || o.type === 'RenderTexture') o.visible = true;
      }
    }
  });
}

// 单会话多集交错：每轮先测 base（全显），再按轮转顺序测各处理集。
// mode=hide：藏掉该集、其余全显——与真实分块剔除同语义（决策口径）；
// mode=show：只显该集——用于成分归因（注意 SwiftShader 并行光栅化下
// hide 与 show 不守恒，两者不可混用比较）。
const MODE = String(arg('mode', 'hide'));
const treat = MODE === 'show' ? showOnly : hideSet;
const base = [];
const bySet = {};
for (const name of SETS) bySet[name] = [];
for (let r = 0; r < ROUNDS; r++) {
  await restoreAll();
  base.push({ ...(await sample()), round: r });
  const order = [...SETS].slice(r % SETS.length).concat([...SETS].slice(0, r % SETS.length));
  for (const name of order) {
    await treat(SET_TABLE[name]);
    bySet[name].push({ ...(await sample()), round: r });
  }
}
await restoreAll();

const pad = (s, n) => String(s).padEnd(n);
const med = (rows, k) => +median(rows.map((r) => r[k])).toFixed(2);
console.log(`\n=== devfloor100000 · sets=${SETS.join('+')} · mode=${MODE} · ${FRAMES} 帧 × ${ROUNDS} 轮（单会话交错）===`);
console.log(pad('', 10) + pad('avg', 9) + pad('p50', 9) + pad('p95', 9) + pad('p99', 9));
const bm = { avg: med(base, 'avg'), p50: med(base, 'p50'), p95: med(base, 'p95'), p99: med(base, 'p99') };
console.log(pad('base中位', 10) + pad(bm.avg, 9) + pad(bm.p50, 9) + pad(bm.p95, 9) + pad(bm.p99, 9));
for (const name of SETS) {
  const rows = bySet[name];
  const m = { avg: med(rows, 'avg'), p50: med(rows, 'p50'), p95: med(rows, 'p95'), p99: med(rows, 'p99') };
  console.log(pad(`${name}中位`, 10) + pad(m.avg, 9) + pad(m.p50, 9) + pad(m.p95, 9) + pad(m.p99, 9));
  for (const k of ['avg', 'p50', 'p95', 'p99']) {
    const d = m[k] - bm[k];
    const p = +median(base.map((b, i) => rows[i][k] - b[k])).toFixed(2);
    console.log(`  ${name} ${k}: ${bm[k]} → ${m[k]} ms（${d >= 0 ? '+' : ''}${d}ms，${((d / bm[k]) * 100).toFixed(1)}%）同轮配对差中位 ${p >= 0 ? '+' : ''}${p}ms（${((p / bm[k]) * 100).toFixed(1)}%）`);
  }
}
await browser.close();
