import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { ENTRY_X, PLAYABLE_FLOORS_V01, UP_EXIT_X, downExitXFor, floorWidthFor } from '../core/constants';
import { obstaclesForFloor } from '../systems/LootSystem';
import { liftDirection, prevSegment } from '../core/segments';
import { hasDownExit, hasUpExit } from '../systems/FloorSystem';
import balance from '../../config/game-balance.json' with { type: 'json' };

// AG-126（RC-04 覆盖缺口 1）：tier2+（100+ 层）阻碍物可达性护栏。
//
// 背景：RC-01 E2E 复判报告 §6 缺口 1 指出 obstacles.test.ts 的可达性护栏只覆盖
// 2-9 层（tier1），full2 实证 seed42 F102 gate@170 封死落点 40→downX 496 的直走
// （「上得去下不来」）。本文件把 tier2+ 的口径钉死：
//
//   设计口径 = 「不软锁」而非「全通」：
//   ① 每个落点至少够到一个出口（entry/上梯落点/下梯落点/上层下行落点）；
//   ② 全局拓扑 BFS：无铲子时从任何可达落点都能回到 1 层宿舍（家）。
//   「40→本层下梯口」直走被封是设计内行为（可原路返回或做铲子挖开），
//   不构成软锁——实测 40 seed × 45 tier2+ 层：6800 落点检查 0 软锁、
//   8200 到达检查 BFS 0 失败、896 层直走被封（探针 tmp/qa-evidence/ag126-tier2/）。
//
// 口径与 obstacles.test.ts 的 tier1 护栏同源（reachable = 区间内无占位截断），
// 但落点集合按 tier2+ 的宽楼/电梯拓扑扩展（liftDirection/prevSegment）。

const HALF = 26; // blockHalfWidth（与 LootSystem 同源）
const LIFT_X = (balance as unknown as { obstacles: { liftX: number } }).obstacles.liftX;
const TIER2_FLOORS = PLAYABLE_FLOORS_V01.filter((f) => f >= 100);
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1); // 1..40

/** 直走可达：from→to 开区间内没有任何占位完整截断（同 tier1 护栏口径）。 */
function reachable(obstacles: Array<{ x: number }>, from: number, to: number): boolean {
  return !obstacles.some((o) => o.x - HALF > Math.min(from, to) && o.x + HALF < Math.max(from, to));
}

/** 本层全部出口 x（上梯口/下梯口/下行电梯）。 */
function exitsOf(floor: number): number[] {
  const exits: number[] = [];
  if (hasUpExit(floor)) exits.push(UP_EXIT_X);
  if (hasDownExit(floor)) exits.push(downExitXFor(floor));
  if (liftDirection(floor) === 'down') exits.push(LIFT_X);
  return exits;
}

/** 落点检查清单：每个落点 must=null 表示「够到任一出口即可」。 */
function landingChecks(floor: number): Array<{ at: number; must: number[] | null; why: string }> {
  const checks: Array<{ at: number; must: number[] | null; why: string }> = [
    { at: ENTRY_X, must: null, why: 'entry' },
    { at: UP_EXIT_X, must: hasUpExit(floor) ? [UP_EXIT_X] : null, why: 'climbLanding40' },
  ];
  if (hasDownExit(floor)) checks.push({ at: downExitXFor(floor), must: [downExitXFor(floor)], why: 'standDown' });
  if (hasUpExit(floor)) {
    checks.push({
      at: downExitXFor(floor + 1),
      must: hasDownExit(floor) ? [downExitXFor(floor)] : liftDirection(floor) === 'down' ? [LIFT_X] : [],
      why: 'descendLanding',
    });
  }
  return checks;
}

describe('tier2+ 落点不软锁（AG-126 护栏）', () => {
  it('seed42 F102 定点：gate@170 封直走但落点全可达（设计口径取证）', () => {
    const s = createNewGame(42);
    const obs = obstaclesForFloor(s, 102);
    expect(obs).toEqual([{ kind: 'gate', x: 170 }]);
    // 「上得去下不来」实证：40→496 直走被封……
    expect(reachable(obs, UP_EXIT_X, downExitXFor(102))).toBe(false);
    // ……但每个落点都够得到出口（不软锁）。
    for (const c of landingChecks(102)) {
      const targets = c.must ?? exitsOf(102);
      expect(targets.some((to) => reachable(obs, c.at, to)), `F102 ${c.why}`).toBe(true);
    }
  });

  it('40 seed × 全部 tier2+ 层：每个落点至少够到一个出口（0 软锁）', () => {
    const softlocks: string[] = [];
    let checksRun = 0;
    for (const seed of SEEDS) {
      const s = createNewGame(seed);
      for (const floor of TIER2_FLOORS) {
        const obs = obstaclesForFloor(s, floor);
        const exits = exitsOf(floor);
        for (const c of landingChecks(floor)) {
          checksRun++;
          const targets = c.must ?? exits;
          if (!targets.some((to) => reachable(obs, c.at, to))) {
            softlocks.push(`seed${seed} F${floor} ${c.why} at=${c.at} obs=${JSON.stringify(obs)}`);
          }
        }
      }
    }
    expect(checksRun).toBeGreaterThan(6000); // 矩阵规模 sanity（实测 6800）
    expect(softlocks, softlocks.slice(0, 5).join('\n')).toEqual([]);
  });

  it('tier2+ 阻碍物存在性与形状（有护栏的前提：不是空集退化解）', () => {
    let totalObs = 0;
    let floorsWithObs = 0;
    const kinds = new Set<string>();
    for (const seed of SEEDS) {
      const s = createNewGame(seed);
      for (const floor of TIER2_FLOORS) {
        const obs = obstaclesForFloor(s, floor);
        totalObs += obs.length;
        if (obs.length) floorsWithObs++;
        for (const o of obs) {
          kinds.add(o.kind);
          expect(o.x).toBeGreaterThan(UP_EXIT_X + 90); // keepClear
          expect(o.x).toBeLessThan(downExitXFor(floor) - 90);
        }
      }
    }
    // 实测：1110 个阻碍物 / 1006 of 1800 层有阻碍物 / 两种 kind 都出现。
    expect(totalObs).toBeGreaterThan(800);
    expect(floorsWithObs).toBeGreaterThan(800);
    expect([...kinds].sort()).toEqual(['gate', 'rubble']);
  });
});

// ── 全局拓扑 BFS：无铲子从任何落点都能回家 ─────────────────────────────
// 口径同 tools/obstacle-reachability-recheck.mjs：把每层按占位切成可行走
// span，落点/梯口/电梯口落在哪个 span 就是图的节点，跨层边由口位对接。

function spansOn(floor: number, obstacles: Array<{ x: number }>): Array<[number, number]> {
  const width = floorWidthFor(floor);
  const cuts = obstacles.map((o) => [o.x - HALF, o.x + HALF] as [number, number]).sort((a, b) => a[0] - b[0]);
  const spans: Array<[number, number]> = [];
  let lo = 8;
  for (const [a, b] of cuts) {
    if (a > lo) spans.push([lo, a - 1]);
    lo = Math.max(lo, b + 1);
  }
  if (lo <= width - 8) spans.push([lo, width - 8]);
  return spans;
}

const spanContaining = (spans: Array<[number, number]>, x: number): number =>
  spans.findIndex(([a, b]) => x >= a && x <= b);
const mouthIn = (spans: Array<[number, number]>, i: number, x: number): boolean =>
  i >= 0 && spans[i][0] <= x && x <= spans[i][1];

describe('tier2+ 全局 BFS 无铲子到家（AG-126 护栏）', () => {
  it('40 seed × 全部可达落点：BFS 都能回到 1 层（0 失败）', () => {
    const failures: string[] = [];
    let arrivals = 0;
    for (const seed of SEEDS) {
      const s = createNewGame(seed);
      const cache = new Map<number, Array<[number, number]>>();
      const spansOf = (f: number): Array<[number, number]> => {
        if (!cache.has(f)) cache.set(f, spansOn(f, obstaclesForFloor(s, f)));
        return cache.get(f)!;
      };
      // 全部「玩家可能站上去」的落点：上行落点/下行落点/本层下梯口/entry/段顶电梯落点。
      const list: Array<[number, number]> = [];
      for (const floor of PLAYABLE_FLOORS_V01) {
        if (floor === 1) continue;
        if (hasUpExit(floor - 1)) list.push([floor, UP_EXIT_X]);
        if (hasUpExit(floor)) list.push([floor, downExitXFor(floor + 1)]);
        if (hasDownExit(floor)) list.push([floor, downExitXFor(floor)]);
        list.push([floor, ENTRY_X]);
      }
      for (const bottom of [100, 1000, 10000, 50000, 100000]) {
        const t = prevSegment(bottom)?.to;
        if (t) list.push([t, ENTRY_X]);
      }
      const key = (f: number, i: number): string => `${f}#${i}`;
      const edges = (f: number, i: number): Array<[number, number]> => {
        const out: Array<[number, number]> = [];
        const spans = spansOf(f);
        if (hasUpExit(f) && mouthIn(spans, i, UP_EXIT_X)) {
          const j = spanContaining(spansOf(f + 1), UP_EXIT_X);
          if (j >= 0) out.push([f + 1, j]);
        }
        if (hasDownExit(f) && mouthIn(spans, i, downExitXFor(f))) {
          const t = f - 1;
          const j = spanContaining(spansOf(t), downExitXFor(f));
          if (j >= 0) out.push([t, j]);
          else if (t === 1) out.push([1, -1]); // 宿舍无阻碍物，直接到家
        }
        if (liftDirection(f) === 'down') {
          const t = prevSegment(f)?.to;
          if (t && mouthIn(spans, i, LIFT_X)) {
            const j = spanContaining(spansOf(t), ENTRY_X);
            if (j >= 0) out.push([t, j]);
          }
        }
        return out;
      };
      for (const [floor, x] of list) {
        arrivals++;
        const start = spanContaining(spansOf(floor), x);
        if (start < 0) {
          failures.push(`seed${seed} F${floor} x=${x} 落在占位里`);
          continue;
        }
        const seen = new Set([key(floor, start)]);
        const q: Array<[number, number]> = [[floor, start]];
        let home = false;
        while (q.length && !home) {
          const [f, i] = q.shift()!;
          if (f === 1) {
            home = true;
            break;
          }
          for (const [nf, ni] of edges(f, i)) {
            const k = key(nf, ni);
            if (!seen.has(k)) {
              seen.add(k);
              q.push([nf, ni]);
            }
          }
        }
        if (!home) failures.push(`seed${seed} F${floor} x=${x} 到不了家`);
      }
    }
    expect(arrivals).toBeGreaterThan(8000); // 矩阵规模 sanity（实测 8200）
    expect(failures, failures.slice(0, 5).join('\n')).toEqual([]);
  });
});