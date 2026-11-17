#!/usr/bin/env node
/**
 * AG-98 P3 帧时间测量协议 —— 满陈设场景（?devfloor=100000）与常规楼层（1 层）
 * 的稳态帧时间对比探针。
 *
 * 背景（QA-02）：满陈设场景帧率显著低于常规楼层，根因假设是 draw call /
 * texture bind 多。本工具把「感觉卡」变成数字：同机同 seed，两场景各跑 3 轮
 * 60 帧 rAF 采样，输出 avg / p50 / p95 / p99（毫秒，读帧时间不读 FPS——
 * FPS 是帧时间的倒数，会把尾部分辨率吃掉），并顺带做显示树普查（对象数 /
 * 去重贴图数 / Graphics commandBuffer 条目），直接检验「贴图混用断批」假设。
 *
 * 测量协议（docs/plans/RENDER.md §10.0 + 2026-11-17 调研 P3）：
 *   1. 必须带 --disable-frame-rate-limit --disable-gpu-vsync：不加时 headless
 *      Chromium 的 rAF 被 vsync 钉在 16.7ms，p95/p99 全是 16.7 的假分布；
 *   2. 读 rAF 原始间隔，不读 Phaser 平滑后的 loop.delta（平滑值抹尖刺）；
 *   3. 同机同场景 3 复测取稳值，绝对帧时间受并行负载影响大——跨机器的绝对
 *      值不可比，同机同协议的前后对比才有效；
 *   4. p95 超 16.67ms（60fps 预算）即判失败。
 *
 * 截图（--freeze --shot dir）：把游戏钉到确定性初值（世界时间 06:00、停
 * scene update、停 tween、精灵钉第 0 帧、灯光层 update(0)）后截图，供改动
 * 前/后同 seed 同位置像素级 diff——除动画相位外画面应逐像素一致。
 *
 * 用法：
 *   node tools/floor-perf-probe.mjs [--port 5209] [--seed 42] [--frames 60]
 *     [--rounds 3] [--scenarios floor1,devfloor] [--label baseline]
 *     [--json output/perf/x.json] [--freeze] [--shot output/perf/shots]
 * 前置：dev server 已起（npx vite --port 5209 --strictPort --force）。
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ── 参数 ─────────────────────────────────────────────────────────────────
function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const PORT = Number(arg('port', 5209));
const HOST = String(arg('host', '[::1]'));
const SEED = String(arg('seed', '42'));
const FRAMES = Number(arg('frames', 60));
const ROUNDS = Number(arg('rounds', 3));
const LABEL = String(arg('label', 'run'));
const SCENARIOS = String(arg('scenarios', 'floor1,devfloor'))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const JSON_OUT = typeof arg('json', '') === 'string' ? arg('json', '') : '';
const SHOT_DIR = typeof arg('shot', '') === 'string' ? arg('shot', '') : '';
const FREEZE = arg('freeze', false) === true;
const BASE = `http://${HOST}:${PORT}`;

// 场景表：id -> URL query + 人类可读名。floor1 是常规对照，devfloor 是 QA-02
// 报的最差场景（9-11 个房间的满陈设走廊，见 constants.ROOMS_BY_TIER[6]）。
const SCENE_TABLE = {
  floor1: { query: '', name: '常规楼层（1 层宿舍）' },
  devfloor: { query: '&devfloor=100000', name: '满陈设（?devfloor=100000）' },
};

// ── 统计 ─────────────────────────────────────────────────────────────────
function stats(deltas) {
  const sorted = [...deltas].sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  return {
    n: deltas.length,
    avg: +mean.toFixed(2),
    p50: +pick(0.5).toFixed(2),
    p95: +pick(0.95).toFixed(2),
    p99: +pick(0.99).toFixed(2),
    max: +sorted[sorted.length - 1].toFixed(2),
  };
}

/** 3 轮取稳值：每个统计量取中位（对负载漂移最稳的一轮）。 */
function medianStats(rounds) {
  const keys = ['avg', 'p50', 'p95', 'p99', 'max'];
  const out = {};
  for (const k of keys) {
    const vals = rounds.map((r) => r[k]).sort((a, b) => a - b);
    out[k] = vals.length % 2 ? vals[(vals.length - 1) / 2] : +((vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2).toFixed(2);
  }
  return out;
}

/** 一维中位（配对差用）。 */
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

// ── 启动序列（perf-probe.mjs 同款） ───────────────────────────────────────
async function startGame(page, query) {
  const sceneIs = (key) =>
    page.waitForFunction(
      (k) => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === k),
      key,
      { timeout: 30000 },
    ).then(() => undefined);
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
  // 开局 flash / 楼层对象落定：给足 1.2s，让首帧尖刺（楼层建造）不混进稳态。
  await page.waitForTimeout(1200);
  // 冻结快照（三份，冻结时恢复——每一项都是实测过不钉就跨会话 diff 不过的）：
  //   A. 灯光层尘埃的初始位置：尘埃的 y 每帧累加漂移（lighting.ts 的
  //      `m.rect.y -= speed*dt`），update(0) 不归零；
  //   B. 世界状态：生存属性在冻结前的真实时间里衰减，衰减量随机器负载漂移，
  //      HUD 数字/状态环会跨会话不一致；
  //   C. 商贩三件套：巡逻是 2600ms 循环 tween，冻结时停在真实进度上；
  //      同时记下它此刻的贴图（巡逻中会在行走/待机两张图间切换）。
  await page.evaluate(() => {
    const s = window.__PHASER_GAME__.scene.getScene('Game');
    const session = window.__PHASER_SESSION__?.getState();
    const dust = [];
    for (const o of s.children.list) {
      if (o.type === 'Rectangle' && o.depth === 25 && o.height === 1 && o.width <= 2) {
        dust.push({ o, x: o.x, y: o.y });
      }
    }
    const shop = s.spotMarkers?.get('shop');
    window.__DUST_SNAPSHOT__ = dust;
    window.__STATE_SNAPSHOT__ = session ? JSON.parse(JSON.stringify(session)) : null;
    window.__TRADER_SNAPSHOT__ = shop
      ? { x: shop.dot?.x ?? 0, tagX: shop.label?.x ?? 0, markerX: shop.x, texture: shop.dot?.texture?.key ?? '' }
      : null;
  });
}

/**
 * 采样：FRAMES+1 个 rAF 时间戳的原始间隔。同时做显示树普查：
 *  - objects / byType：所有活动场景的全部显示对象（含容器子树，递归）；
 *  - textures：可见 Image/Sprite 的去重 texture key 数（WebGL 里每个不同
 *    贴图 = 一次 texture bind，是「断批」的直接代理量）；
 *  - gfxCommands：全部 Graphics 的 commandBuffer 条目数（RENDER.md §10.1
 *    的量法，把参数也数了进去）；
 *  - floor：当前楼层号与相机视口，确认测的是想测的场景。
 */
async function sample(page) {
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
            let gfxCommands = 0;
            const byType = {};
            const textures = new Set();
            const walk = (list) => {
              for (const o of list ?? []) {
                objects += 1;
                byType[o.type] = (byType[o.type] ?? 0) + 1;
                if (o.type === 'Graphics' && o.commandBuffer) gfxCommands += o.commandBuffer.length;
                if (o.type === 'Image' || o.type === 'Sprite') {
                  const key = o.texture?.key;
                  if (key) textures.add(key);
                }
                if (o.type === 'Container') walk(o.list);
              }
            };
            for (const scene of game.scene.getScenes(true)) walk(scene.children.list);
            const game2 = window.__PHASER_GAME__;
            const session = window.__PHASER_SESSION__?.getState();
            resolve({
              deltas,
              objects,
              byType,
              textures: [...textures].sort(),
              gfxCommands,
              floor: session?.currentFloor ?? null,
              floorW: game2.scene.getScene('Game')?.floorW ?? null,
            });
          } else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    FRAMES,
  );
  return { ...stats(r.deltas), objects: r.objects, byType: r.byType, textures: r.textures, gfxCommands: r.gfxCommands, floor: r.floor, floorW: r.floorW };
}

/**
 * 冻结到确定性初值后截图（改前/改后像素 diff 用）。协议照 RENDER.md §10.4：
 * 世界时间钉 06:00、停 scene update、停 tween、精灵钉动画第 0 帧、灯光层
 * update(0)。此后画面不再随时间变化，同 seed 两次运行的差异只剩真实渲染差。
 *
 * 每一步都是实测过不钉就 diff 不过的（同 seed 两次运行的逐像素 diff 从
 * 3.9% 降到 <0.05%）：
 *   1. 世界状态回滚到楼层落定快照（生存属性衰减随负载漂移 → HUD 数字/环）；
 *   2. 商贩归出生点并钉回待机贴图（巡逻 tween 冻结时停在真实进度上）；
 *   3. HUD 按回滚后状态重画，再跑一次 delta=0 的确定性 update——NPC 摆位/
 *      时钟/导航都按钉过的时间重算（NPC 散步相位用 this.time.now，真实时钟）；
 *   4. 停 tween、清循环 Clock 事件（traderPatrolTimer 等不受 update 事件管）、
 *      灯光层 update(0)（池光呼吸的确定初值）；
 *   5. 全部精灵钉第 0 帧、宿舍呼吸钉中点、尘埃从快照恢复（y 是累加的）；
 *   6. 停 scene update（事件名 'update'，页面里没有 Phaser 全局）。
 */
async function freezeAndShoot(page, path) {
  await page.evaluate(() => {
    const game = window.__PHASER_GAME__;
    const s = game.scene.getScene('Game');
    const session = window.__PHASER_SESSION__?.getState();
    // 1. 世界状态回滚（嵌套对象逐键 assign，保持引用同一性）
    const snap = window.__STATE_SNAPSHOT__;
    if (session && snap) {
      for (const k of Object.keys(snap)) {
        const v = snap[k];
        const cur = session[k];
        if (v && typeof v === 'object' && cur && typeof cur === 'object') Object.assign(cur, v);
        else session[k] = v;
      }
      session.day = 1;
      session.gameMinuteOfDay = 360; // 06:00，昼夜光照的确定相位
      if (session.worldEvents) session.worldEvents.activeEvent = null;
    }
    // 2. 商贩归位：精灵/名签/标记点回出生点，贴图钉回快照里的待机图，
    //    它的接触阴影（depth 2 的独立 Graphics）被 tween 拖离了 0，钉回 0。
    const tr = window.__TRADER_SNAPSHOT__;
    if (tr) {
      const shop = s.spotMarkers?.get('shop');
      if (shop?.dot) {
        if (tr.texture) shop.dot.setTexture(tr.texture);
        shop.dot.setFrame(0);
        shop.dot.x = tr.x;
        shop.dot.setFlipX(false);
      }
      if (shop?.label) shop.label.x = tr.tagX;
      if (shop) shop.x = tr.markerX;
      for (const o of s.children.list) {
        if (o.type === 'Graphics' && o.depth === 2 && o.x !== 0 && (o.commandBuffer?.length ?? 99) < 15) o.x = 0;
      }
    }
    // 3. HUD 重画 + 一次 delta=0 的确定性 tick
    s.refreshStats?.();
    s.refreshClock?.();
    s.time.now = 1000;
    for (const [, v] of s.npcStrollState ?? []) v.parkedSince = 0;
    s.time.removeAllEvents();
    s.update(0, 0);
    s.tweens.killAll();
    if (s.lightLayer?.update) s.lightLayer.update(0);
    const pin = (list) => {
      for (const o of list ?? []) {
        if (o.type === 'Sprite' && o.anims) {
          o.anims.stop();
          o.setFrame(0);
        }
        if (o.type === 'Container') pin(o.list);
      }
    };
    for (const scene of game.scene.getScenes(true)) pin(scene.children.list);
    // 5. 灯光层尘埃从快照恢复；宿舍呼吸钉在波峰中点。
    for (const d of window.__DUST_SNAPSHOT__ ?? []) {
      d.o.x = d.x;
      d.o.y = d.y;
    }
    for (const sl of s.dormSleepers ?? []) {
      sl.z?.setAlpha(0.8);
      if (sl.baseY !== undefined) sl.z.y = sl.baseY;
    }
    // 6. 停掉 GameScene.update（事件名字符串 'update'，页面里没有 Phaser 全局）。
    s.events.off('update');
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path });
}

// ── 主流程 ───────────────────────────────────────────────────────────────
const browser = await chromium.launch({
  channel: 'chrome',
  args: [
    // RENDER.md §10.0 第 1 条：不加这两个旗，rAF 被 vsync 钉在 16.7ms。
    '--disable-frame-rate-limit',
    '--disable-gpu-vsync',
    // 绕过本机代理，直连 [::1] dev server。
    '--no-proxy-server',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
// 教程层默认关闭（localStorage 的 TUTORIAL_SKIPPED_KEY）。两个理由：
//   1. 冻结截图的确定性——教程提示/高亮随真实教程进度推进，是跨会话像素 diff
//      的最大噪声源（实测占差异的 95%+）；
//   2. 帧时间测量的稳定性——教程高亮是每帧重画的 Graphics，其存在与否会让
//      场景组成随加载耗时漂移。
// 教程层只有几个对象，对帧时间的影响远低于测量噪声，不影响力级结论。
await page.addInitScript(() => {
  try {
    localStorage.setItem('floor100000.tutorial.skipped', '1');
  } catch {
    // localStorage 不可用（隐私模式）：教程会开着，仅截图确定性受损。
  }
});

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

const report = { label: LABEL, seed: SEED, frames: FRAMES, rounds: ROUNDS, scenarios: {} };
const pad = (s, n) => String(s).padEnd(n);

// 未知场景先校验，避免半跑才报错。
for (const id of SCENARIOS) {
  if (!SCENE_TABLE[id]) {
    console.error(`unknown scenario: ${id} (known: ${Object.keys(SCENE_TABLE).join(', ')})`);
    process.exitCode = 1;
  }
}
const valid = SCENARIOS.filter((id) => SCENE_TABLE[id]);

// 主流程。两个场景时走**交错协议**（RENDER.md §10.0 第 2 条：A/B 交错不是
// 先后）——每轮依次测两个场景且顺序逐轮反转，配对差消掉会话内的负载漂移；
// 纯顺序测会让先测的场景系统性地赶上/错开负载 burst（实测：顺序测时
// devfloor 的第 2 轮撞上一次负载尖峰，p95 中位差被放大到 +37%，交错后
// 回到个位数）。单场景时就是普通的 N 轮复测。
const byScenario = {};
for (let r = 0; r < ROUNDS; r++) {
  const order = valid.length === 2 && r % 2 === 1 ? [...valid].reverse() : valid;
  for (const id of order) {
    const scene = SCENE_TABLE[id];
    await startGame(page, scene.query);
    await page.waitForTimeout(400);
    const row = await sample(page);
    (byScenario[id] ??= []).push({ ...row, round: r });
    // 最后一轮顺手冻结截图，省一轮启动。
    if (SHOT_DIR && r === ROUNDS - 1) {
      mkdirSync(SHOT_DIR, { recursive: true });
      await freezeAndShoot(page, join(SHOT_DIR, `${id}-${LABEL}.png`));
    }
  }
}

for (const id of valid) {
  const scene = SCENE_TABLE[id];
  const rounds = byScenario[id];
  const last = rounds[rounds.length - 1];
  const med = medianStats(rounds);
  report.scenarios[id] = { name: scene.name, floor: last.floor, floorW: last.floorW, objects: last.objects, byType: last.byType, textures: last.textures, gfxCommands: last.gfxCommands, rounds, median: med };

  console.log(`\n=== ${scene.name} · ${LABEL} · seed ${SEED} · ${FRAMES} frames × ${rounds.length} 轮 ===`);
  console.log(`floor=${last.floor} floorW=${last.floorW} objects=${last.objects} gfxCommands=${last.gfxCommands} distinctTextures=${last.textures.length}`);
  console.log(`textures: ${last.textures.join(', ')}`);
  console.log(pad('round', 8) + pad('avg', 9) + pad('p50', 9) + pad('p95', 9) + pad('p99', 9) + pad('max', 9));
  rounds.forEach((row) => {
    console.log(pad(`#${row.round + 1}`, 8) + pad(row.avg, 9) + pad(row.p50, 9) + pad(row.p95, 9) + pad(row.p99, 9) + pad(row.max, 9));
  });
  console.log(pad('median', 8) + pad(med.avg, 9) + pad(med.p50, 9) + pad(med.p95, 9) + pad(med.p99, 9) + pad(med.max, 9));
  console.log(`预算判定：p95 ${med.p95}ms ${med.p95 <= 16.67 ? '≤' : '>'} 16.67ms（60fps）→ ${med.p95 <= 16.67 ? 'PASS' : 'FAIL'}`);
}

await browser.close();

// 场景间对比（同协议同机才是有效信号）。两场景时除各轮中位数外，再报逐轮
// 配对差的中位（round i 的 B − A），后者对会话内漂移免疫。
const ids = Object.keys(report.scenarios);
if (ids.length === 2) {
  const [aId, bId] = ids;
  const a = report.scenarios[aId].median;
  const b = report.scenarios[bId].median;
  const paired = (key) => {
    const diffs = report.scenarios[aId].rounds
      .map((ra) => {
        const rb = report.scenarios[bId].rounds.find((x) => x.round === ra.round);
        return rb ? rb[key] - ra[key] : null;
      })
      .filter((x) => x !== null);
    return diffs.length ? +median(diffs).toFixed(2) : null;
  };
  const pairedAvg = paired('avg');
  const pairedP95 = paired('p95');
  const deltaP95 = +(((b.p95 - a.p95) / a.p95) * 100).toFixed(1);
  const deltaAvg = +(((b.avg - a.avg) / a.avg) * 100).toFixed(1);
  console.log(`\n=== 同机对比：${aId} → ${bId} ===`);
  console.log(`avg ${a.avg} → ${b.avg} ms（${deltaAvg >= 0 ? '+' : ''}${deltaAvg}%）`);
  console.log(`p95 ${a.p95} → ${b.p95} ms（${deltaP95 >= 0 ? '+' : ''}${deltaP95}%）`);
  if (pairedAvg !== null) {
    console.log(`逐轮配对差中位：avg ${pairedAvg >= 0 ? '+' : ''}${pairedAvg}ms，p95 ${pairedP95 >= 0 ? '+' : ''}${pairedP95}ms（对会话内漂移免疫，优先看这个）`);
  }
  report.compare = { from: aId, to: bId, deltaAvgPct: deltaAvg, deltaP95Pct: deltaP95, pairedAvgMs: pairedAvg, pairedP95Ms: pairedP95 };
}

if (pageErrors.length) {
  console.log('\nPAGE ERRORS:', pageErrors.join(' | '));
  process.exitCode = 1;
}

if (JSON_OUT) {
  mkdirSync(JSON_OUT.replace(/[/\\][^/\\]*$/, ''), { recursive: true });
  writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  console.log(`\njson → ${JSON_OUT}`);
}
