#!/usr/bin/env node
/**
 * AG-100-perf2 诊断工具（不提交）：普查 Game 场景里每个 Graphics 的
 * commandBuffer 规模，按 (场景, depth, x, 命令数) 排序输出，用来定位
 * 「宽楼层 Graphics 命令重放」的成本分布，决定分块剔除的目标。
 *
 * 用法：node tools/gfx-census.mjs [--port 5211] [--scenarios floor1,devfloor]
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
const SCENARIOS = String(arg('scenarios', 'floor1,devfloor'))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const BASE = `http://${HOST}:${PORT}`;

const SCENE_TABLE = {
  floor1: { query: '', name: 'floor1' },
  devfloor: { query: '&devfloor=100000', name: 'devfloor100000' },
};

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
  await page.waitForTimeout(1200);
}

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

for (const id of SCENARIOS) {
  const scene = SCENE_TABLE[id];
  if (!scene) {
    console.error(`unknown scenario: ${id}`);
    process.exitCode = 1;
    continue;
  }
  await startGame(page, scene.query);
  const census = await page.evaluate(() => {
    const game = window.__PHASER_GAME__;
    // Phaser 4 commandBuffer 是扁平数组：[cmdId, args...] 内联。渲染器按
    // ++cmdIndex 逐条吃参数——缓冲区长度（值个数）即重放成本的代理量。
    const ARITY = { 0: 7, 1: 0, 2: 0, 3: 4, 4: 2, 5: 2, 6: 3, 7: 2, 8: 0, 9: 0, 10: 6, 11: 6, 14: 0, 15: 0, 16: 2, 17: 2, 18: 1, 21: 8, 22: 5 };
    const rows = [];
    const walk = (list, sceneKey) => {
      for (const o of list ?? []) {
        if (o.type === 'Graphics' && o.commandBuffer) {
          const buf = o.commandBuffer;
          let values = buf.length;
          let cmds = 0;
          let fillRects = 0;
          let minX = Infinity;
          let maxX = -Infinity;
          const types = {};
          for (let i = 0; i < buf.length; ) {
            const id = buf[i];
            types[id] = (types[id] ?? 0) + 1;
            cmds++;
            i += 1 + (ARITY[id] ?? 0);
            if (id === 3) {
              const x = buf[i - 4];
              const w = buf[i - 2];
              minX = Math.min(minX, x);
              maxX = Math.max(maxX, x + w);
              fillRects++;
            } else if (id === 10) {
              for (const v of [buf[i - 6], buf[i - 4], buf[i - 2]]) {
                minX = Math.min(minX, v);
                maxX = Math.max(maxX, v);
              }
            }
          }
          rows.push({
            scene: sceneKey,
            depth: o.depth,
            x: Math.round(o.x),
            y: Math.round(o.y),
            values,
            cmds,
            fillRects,
            minX: fillRects ? Math.round(minX) : null,
            maxX: fillRects ? Math.round(maxX) : null,
            types: JSON.stringify(types),
          });
        }
        if (o.type === 'Container') walk(o.list, sceneKey);
      }
    };
    for (const s of game.scene.getScenes(true)) walk(s.children.list, s.scene.key);
    const session = window.__PHASER_SESSION__?.getState();
    return {
      rows,
      floor: session?.currentFloor ?? null,
      floorW: game.scene.getScene('Game')?.floorW ?? null,
      playerX: session?.player?.x ?? null,
      camScrollX: game.scene.getScene('Game')?.cameras?.main?.scrollX ?? null,
    };
  });
  const total = census.rows.reduce((a, r) => a + r.values, 0);
  const gfxCount = census.rows.length;
  const totalCmds = census.rows.reduce((a, r) => a + r.cmds, 0);
  console.log(`\n=== ${scene.name} · floor=${census.floor} floorW=${census.floorW} playerX=${census.playerX} camScrollX=${census.camScrollX} ===`);
  console.log(`Graphics 对象 ${gfxCount} 个，缓冲区值总数 ${total}，实际命令数 ${totalCmds}`);
  census.rows.sort((a, b) => b.values - a.values);
  for (const r of census.rows.slice(0, 45)) {
    console.log(`  [${r.scene}] depth=${r.depth} values=${r.values} cmds=${r.cmds} fillRect=${r.fillRects} xRange=[${r.minX},${r.maxX}] types=${r.types}`);
  }
  // 按 scene 聚合
  const byScene = {};
  for (const r of census.rows) {
    byScene[r.scene] ??= { n: 0, count: 0 };
    byScene[r.scene].n += r.n;
    byScene[r.scene].count += 1;
  }
  console.log('按场景聚合:', JSON.stringify(byScene));
}

await browser.close();
