#!/usr/bin/env node
// R3 一次性复算器（fix-r3 证据，可复跑）：
//   node tools/obstacle-reachability-recheck.mjs
// 走 vite ssrLoadModule 直跑 TS 源码（仓库没有 tsx，不新增依赖）。
//
// 三件事：
//   ① 逐层清单：≥20 seeds × 1-10 层，每层阻碍物数量与位置（证明正常楼层有出现）；
//   ② 可达性检查（与实现无关的拓扑 BFS）：从每个落点出发，无铲子也能到达
//      梯口/回家——段内只走楼梯与免费下行电梯（上行电梯要通行证，按最坏
//      情况不计），证明裁决没有软化锁；
//   ③ 密度回归：全 playable 楼层 × 60 seeds 的总数（对照 QA 第 1 轮的 13
//      个全落 50000 层），以及 e2e 钉住的 seed 42 F2/F3 位置。
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, logLevel: 'error' });
const load = (path) => server.ssrLoadModule(path);
const { createNewGame } = await load('/src/core/gameState.ts');
const { ENTRY_X, PLAYABLE_FLOORS_V01, UP_EXIT_X, downExitXFor, floorWidthFor } = await load(
  '/src/core/constants.ts',
);
const { obstaclesForFloor } = await load('/src/systems/LootSystem.ts');
const { liftDirection, prevSegment, segmentOf } = await load('/src/core/segments.ts');
const { hasDownExit, hasUpExit } = await load('/src/systems/FloorSystem.ts');

const HALF = 26; // blockHalfWidth
const LIFT_X = 1165;

// ── ① 逐层清单：seeds 1..24 × 1-10 层 ──────────────────────────────────────
const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);
console.log('=== ① 每层阻碍物清单（24 seeds × 1-10 层）===');
let earlyTotal = 0;
const earlyByFloor = {};
for (const seed of SEEDS) {
  const s = createNewGame(seed);
  const rows = [];
  for (let floor = 1; floor <= 10; floor++) {
    const list = obstaclesForFloor(s, floor);
    earlyTotal += list.length;
    earlyByFloor[floor] = (earlyByFloor[floor] ?? 0) + list.length;
    rows.push(`F${floor}:${list.length ? list.map((o) => `${o.kind}@${o.x}`).join(',') : '-'}`);
  }
  console.log(`seed ${String(seed).padStart(2)}  ${rows.join('  ')}`);
}
console.log('1-10 层合计阻碍物 =', earlyTotal, ' 按层分布 =', JSON.stringify(earlyByFloor));
const floorsWithAny = Object.entries(earlyByFloor).filter(([, n]) => n > 0).map(([f]) => f);
console.log('有阻碍物的层 =', JSON.stringify(floorsWithAny));

// ── ② 拓扑 BFS：无铲子也不软锁 ─────────────────────────────────────────────
// 状态 = (层, 无障碍区间)。阻碍物把楼层切成若干区间，区间内自由走动；只有
// 含着梯口/电梯口的区间才能换层。边：同段相邻层楼梯（上梯落 40、下梯落
// 1240）+ 段底免费下行电梯（落 prevSegment 顶层的 ENTRY_X=640）。上行电梯
// 要通行证——最坏情况（玩家什么通行证都没有）下不计，能逃才算能逃。
function spansOn(floor, obstacles) {
  const width = floorWidthFor(floor);
  const cuts = obstacles
    .map((o) => [o.x - HALF, o.x + HALF])
    .sort((a, b) => a[0] - b[0]);
  const spans = [];
  let lo = 8;
  for (const [a, b] of cuts) {
    if (a > lo) spans.push([lo, a - 1]);
    lo = Math.max(lo, b + 1);
  }
  if (lo <= width - 8) spans.push([lo, width - 8]);
  return spans;
}
function spanIndexContaining(spans, x) {
  return spans.findIndex(([a, b]) => x >= a && x <= b);
}
const mouthIn = (spans, i, x) => i >= 0 && spans[i][0] <= x && x <= spans[i][1];

console.log('\n=== ② 可达性检查（无铲子：每个落点都能到梯口/回家）===');
let allOk = true;
const checked = { arrivals: 0, unreachable: [] };
for (const seed of SEEDS) {
  const s = createNewGame(seed);
  const spanCache = new Map();
  const spansOf = (floor) => {
    if (!spanCache.has(floor)) spanCache.set(floor, spansOn(floor, obstaclesForFloor(s, floor)));
    return spanCache.get(floor);
  };
  // 全塔落点（玩家真实会站上的 x）：
  //   - 爬梯落点 (N,40)：从 N-1 爬上来（hasUpExit(N-1)）；
  //   - 下梯落点 (N, downExitXFor(N+1))：从 N+1 爬下（hasUpExit(N)）——
  //     梯井同一条 x，落点是出发层梯口正下方，不是本层下梯口；
  //   - 电梯落点 (T,640)：段顶乘上层段底的免费下行电梯下来；
  //   - 防御性落点：(N,640)（tryChangeFloor/乘梯落点）、站在自己下梯口
  //     (N,downX(N))、段底 (B,640)（要通行证的上行电梯落点，最坏情况到不了，
  //     但实现口径防它，一并查）。
  const arrivals = [];
  for (const floor of PLAYABLE_FLOORS_V01) {
    if (floor === 1) continue;
    if (hasUpExit(floor - 1)) arrivals.push([floor, UP_EXIT_X, `climb${floor - 1}->${floor}`]);
    if (hasUpExit(floor)) {
      arrivals.push([floor, downExitXFor(floor + 1), `descend${floor + 1}->${floor}`]);
    }
    if (hasDownExit(floor)) arrivals.push([floor, downExitXFor(floor), `stand${floor}`]);
    arrivals.push([floor, ENTRY_X, `entry${floor}`]);
  }
  // 免费下行电梯落点：段底 → 上一段顶层 ENTRY_X。
  for (const bottom of [100, 1000, 10000, 50000, 100000]) {
    const targetTop = prevSegment(bottom)?.to;
    if (targetTop) arrivals.push([targetTop, ENTRY_X, `lift${bottom}->${targetTop}`]);
  }
  // BFS：从落点出发能否到达 1 层（家）。只走楼梯 + 免费下行电梯；上行电梯
  // 要通行证，最坏情况（什么证都没有）下不计——能逃才算能逃。
  const key = (f, i) => `${f}#${i}`;
  const edges = (f, i) => {
    const out = [];
    const spans = spansOf(f);
    if (hasUpExit(f) && mouthIn(spans, i, UP_EXIT_X)) {
      const j = spanIndexContaining(spansOf(f + 1), UP_EXIT_X);
      if (j >= 0) out.push([f + 1, j]);
    }
    if (hasDownExit(f) && mouthIn(spans, i, downExitXFor(f))) {
      const target = f - 1;
      // 下梯落点是出发层梯口正下方（stairTraversalFor endX = downExitXFor(出发层)）。
      const j = spanIndexContaining(spansOf(target), downExitXFor(f));
      if (j >= 0) out.push([target, j]);
      else if (target === 1) out.push([1, -1]); // 1 层无障碍，到家
    }
    if (liftDirection(f) === 'down') {
      const target = prevSegment(f)?.to;
      if (target && mouthIn(spans, i, LIFT_X)) {
        const j = spanIndexContaining(spansOf(target), ENTRY_X);
        if (j >= 0) out.push([target, j]);
      }
    }
    return out;
  };
  for (const [floor, x, how] of arrivals) {
    checked.arrivals++;
    const start = spanIndexContaining(spansOf(floor), x);
    if (start < 0) {
      allOk = false;
      checked.unreachable.push(`seed ${seed} ${how}: 落点 x=${x} 落在阻碍占位里（keepClear 破产）`);
      continue;
    }
    // BFS
    const seen = new Set([key(floor, start)]);
    const queue = [[floor, start]];
    let home = floor === 1;
    while (queue.length && !home) {
      const [f, i] = queue.shift();
      if (f === 1) {
        home = true;
        break;
      }
      for (const [nf, ni] of edges(f, i)) {
        const k = key(nf, ni);
        if (!seen.has(k)) {
          seen.add(k);
          queue.push([nf, ni]);
        }
      }
    }
    if (!home) {
      allOk = false;
      checked.unreachable.push(`seed ${seed} ${how}: F${floor} x=${x} 无铲子到不了家`);
    }
  }
}
console.log(`检查落点 ${checked.arrivals} 个（24 seeds × 全塔落点）`);
console.log(allOk ? '结果：全部可达（无铲子也能到梯口/回家）✓' : `结果：有不可达落点 ✗ -> ${JSON.stringify(checked.unreachable.slice(0, 10), null, 1)}`);

// ── ③ 密度回归 + e2e 钉住的位置 ────────────────────────────────────────────
console.log('\n=== ③ 密度回归（60 seeds × 全 playable 楼层）===');
let total = 0;
const byFloor = {};
const samples = [];
for (let seed = 1; seed <= 60; seed++) {
  const s = createNewGame(seed);
  for (const floor of PLAYABLE_FLOORS_V01) {
    const list = obstaclesForFloor(s, floor);
    total += list.length;
    byFloor[floor] = (byFloor[floor] ?? 0) + list.length;
    if (list.length > 0 && samples.length < 30) {
      samples.push(`s${seed}F${floor}:${list.map((o) => `${o.kind}@${o.x}`).join(',')}`);
    }
  }
}
console.log('total =', total, '（QA 第 1 轮修复前：13，全部在 50000 层）');
console.log('byFloor =', JSON.stringify(byFloor));
console.log('samples =', samples.join(' | '));

const s42 = createNewGame(42);
console.log('\ne2e 钉住（seed 42）：F2 =', JSON.stringify(obstaclesForFloor(s42, 2)), ' F3 =', JSON.stringify(obstaclesForFloor(s42, 3)));

console.log('\nSUMMARY', JSON.stringify({ earlyTotal, earlyByFloor, densityTotal: total, arrivalsChecked: checked.arrivals, allOk }));

await server.close();