import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { addItem, countItem } from '../systems/InventorySystem';
import { canCraft, craft, hasUpgrade, recipePreview } from '../systems/CraftingSystem';
import {
  DIVEST_REFUND_RATE,
  VENTURES,
  divest,
  invest,
  materialAsk,
  sell,
  sellPrice,
  settleInvestments,
} from '../systems/shop';
import { deserialize, serialize, validateGameState } from '../systems/SaveSystem';
import type { GameState, ItemId } from '../core/gameTypes';

// AG-45：经济平衡的三个缺口（AG-14 §10.2 撤资 / §10.3 风险参数、AG-42 §5.2
// canCraft 语义）的钉桩文件。数字口径与 economyLoop.test.ts 的 venture 扫程
// 一致（state.day 2..30、结算刚结束的那一天），两处因此对得上。
//
// 蒙特卡洛口径：
//   runSeed = 1..MC_SEEDS，每个 seed 一局；第 1 天入股，随后把 state.day 推到
//   2..MC_DAYS，每次结算"刚结束的那一天"（第 1..29 天），共 29 个结算日。
//   收益/爆仓/留存全部来自真实引擎（settleInvestments 内部
//   makeRng(deriveSeed(runSeed, 当日, 'venture', 产业id))），本文件不做任何
//   独立重算——禁 Math.random（见"the sweep never touches Math.random"的
//   抛错探针），同 seed 同结果，下面的每一个钉桩因此可复现。
const MC_SEEDS = 2000;
const MC_DAYS = 30; // 入股日 + 29 个结算日

const VENTURE_IDS = VENTURES.map((v) => v.id);
const costOf = (id: string): number => VENTURES.find((v) => v.id === id)!.cost;

interface VentureOutcome {
  /** 窗口内累计收入（金）。 */
  income: number;
  /** 窗口内爆仓的门数（0 = 一门没倒；单门模拟时即是否爆仓）。 */
  collapsedCount: number;
  /** 收官时本金留存：未爆仓 = cost，爆仓 = 0。 */
  retained: number;
  /** 30 日净盈亏 = income + retained - cost。 */
  net: number;
}

interface VentureSim {
  outcomes: VentureOutcome[];
  /** 逐结算日收入（含亏损日与爆仓日的 0），用于日收益分布。 */
  dailyIncomes: number[];
}

/** 真实引擎蒙特卡洛：同时持有 defIds 里的每一门，走完 30 日窗口。 */
function simulate(defIds: readonly string[]): VentureSim {
  const outcomes: VentureOutcome[] = [];
  const dailyIncomes: number[] = [];
  const cost = defIds.reduce((sum, id) => sum + costOf(id), 0);
  for (let seed = 1; seed <= MC_SEEDS; seed++) {
    const s = createNewGame(seed);
    s.player.gold = 100000; // 只求买得起；金币存量不进统计
    for (const id of defIds) invest(s, id);
    const alive = new Set(defIds);
    let income = 0;
    let collapsedCount = 0;
    for (let day = 2; day <= MC_DAYS; day++) {
      s.day = day;
      const r = settleInvestments(s);
      income += r.totalIncome;
      dailyIncomes.push(r.totalIncome);
      for (const id of r.collapsed) {
        alive.delete(id);
        collapsedCount++;
      }
      if (alive.size === 0) break; // 全灭，窗口提前收官
    }
    const retained = defIds.reduce((sum, id) => sum + (alive.has(id) ? costOf(id) : 0), 0);
    outcomes.push({ income, collapsedCount, retained, net: income + retained - cost });
  }
  return { outcomes, dailyIncomes };
}

/** 最近秩百分位（确定性，无插值）：n=2000 时 P10/P50/P90 取第 200/1000/1800 个。 */
function percentile(sorted: readonly number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const asc = (xs: readonly number[]): number[] => [...xs].sort((a, b) => a - b);

interface VentureProfile {
  id: string;
  nets: number[];
  incomes: number[];
  daily: number[];
  collapsedCount: number;
  collapseProb: number;
  dailyMean: number;
  dailyP10: number;
  dailyP50: number;
  dailyP90: number;
  incomeMean: number;
  incomeP10: number;
  incomeP50: number;
  incomeP90: number;
  retainedMean: number;
  netMean: number;
  netP10: number;
  netP50: number;
  netP90: number;
}

function buildProfile(id: string): VentureProfile {
  const sim = simulate([id]);
  const nets = asc(sim.outcomes.map((o) => o.net));
  const incomes = asc(sim.outcomes.map((o) => o.income));
  const daily = asc(sim.dailyIncomes);
  const collapsedCount = sim.outcomes.filter((o) => o.collapsedCount > 0).length;
  return {
    id,
    nets,
    incomes,
    daily,
    collapsedCount,
    collapseProb: collapsedCount / MC_SEEDS,
    dailyMean: mean(daily),
    dailyP10: percentile(daily, 10),
    dailyP50: percentile(daily, 50),
    dailyP90: percentile(daily, 90),
    incomeMean: mean(incomes),
    incomeP10: percentile(incomes, 10),
    incomeP50: percentile(incomes, 50),
    incomeP90: percentile(incomes, 90),
    retainedMean: mean(sim.outcomes.map((o) => o.retained)),
    netMean: mean(nets),
    netP10: percentile(nets, 10),
    netP50: percentile(nets, 50),
    netP90: percentile(nets, 90),
  };
}

const profileCache = new Map<string, VentureProfile>();
function profile(id: string): VentureProfile {
  const hit = profileCache.get(id);
  if (hit) return hit;
  const built = buildProfile(id);
  profileCache.set(id, built);
  return built;
}

describe('蒙特卡洛：三门产业 30 日画像（seeded RNG，禁 Math.random）', () => {
  // 2000 seed 扫程的钉桩（docs/plans/ECON_BALANCE.md §2 同表）。任何风险参数
  // 被改动，这些数字必然漂移——这是平衡回归测试的意义。
  const PINNED = {
    water_stall: {
      collapsedCount: 494, // 爆仓概率 24.7%
      dailyMean: 1.2828, dailyP10: 1, dailyP50: 1, dailyP90: 2,
      incomeMean: 32.452, incomeP10: 18, incomeP50: 36, incomeP90: 39,
      retainedMean: 30.12, // 本金期望留存 75.3%
      netMean: 22.572, netP10: -22, netP50: 36, netP90: 39,
    },
    scrap_caravan: {
      collapsedCount: 1158, // 爆仓概率 57.9%
      dailyMean: 4.9235, dailyP10: 0, dailyP50: 5, dailyP90: 8,
      incomeMean: 96.415, incomeP10: 23, incomeP50: 115, incomeP90: 146,
      retainedMean: 33.68, // 本金期望留存 42.1%
      netMean: 50.095, netP10: -57, netP50: 36, netP90: 145,
    },
    ration_route: {
      collapsedCount: 1676, // 爆仓概率 83.8%
      dailyMean: 10.9741, dailyP10: 0, dailyP50: 13, dailyP90: 19,
      incomeMean: 155.8755, incomeP10: 19, incomeP50: 148, incomeP90: 302,
      retainedMean: 19.44, // 本金期望留存 16.2%
      netMean: 55.3155, netP10: -101, netP50: 28, netP90: 295,
    },
  } as const;

  it('pins each venture: 期望日收益 / 收益分布 / 爆仓概率 / 本金期望留存', () => {
    for (const def of VENTURES) {
      const p = profile(def.id);
      const e = PINNED[def.id as keyof typeof PINNED];
      const where = def.id;
      // 爆仓概率（窗口内本金全损的出局比例）
      expect(p.collapsedCount, `${where} 爆仓局数`).toBe(e.collapsedCount);
      expect(p.collapseProb, `${where} 爆仓概率`).toBeCloseTo(e.collapsedCount / MC_SEEDS, 6);
      // 日收益：期望与 P10/P50/P90
      expect(p.dailyMean, `${where} 期望日收益`).toBeCloseTo(e.dailyMean, 3);
      expect(p.dailyP10, `${where} 日收益 P10`).toBe(e.dailyP10);
      expect(p.dailyP50, `${where} 日收益 P50`).toBe(e.dailyP50);
      expect(p.dailyP90, `${where} 日收益 P90`).toBe(e.dailyP90);
      // 30 日总收入分布
      expect(p.incomeMean, `${where} 期望总收入`).toBeCloseTo(e.incomeMean, 3);
      expect(p.incomeP10, `${where} 总收入 P10`).toBe(e.incomeP10);
      expect(p.incomeP50, `${where} 总收入 P50`).toBe(e.incomeP50);
      expect(p.incomeP90, `${where} 总收入 P90`).toBe(e.incomeP90);
      // 本金期望留存 = (1 - 爆仓概率) × 成本（爆仓全损，未爆分文不缺）
      expect(p.retainedMean, `${where} 本金期望留存`).toBeCloseTo(e.retainedMean, 2);
      expect(p.retainedMean, `${where} 留存恒等式`).toBeCloseTo((1 - p.collapseProb) * def.cost, 6);
      // 30 日净盈亏分布
      expect(p.netMean, `${where} 期望净盈亏`).toBeCloseTo(e.netMean, 3);
      expect(p.netP10, `${where} 净盈亏 P10`).toBe(e.netP10);
      expect(p.netP50, `${where} 净盈亏 P50`).toBe(e.netP50);
      expect(p.netP90, `${where} 净盈亏 P90`).toBe(e.netP90);
    }
  });

  it('the same sweep twice gives identical arrays (same seed, same result)', () => {
    const a = simulate(['ration_route']);
    const b = simulate(['ration_route']);
    expect(b.outcomes).toEqual(a.outcomes);
    expect(b.dailyIncomes).toEqual(a.dailyIncomes);
  });

  it('the sweep never touches Math.random — everything runs on deriveSeed/makeRng', () => {
    // 探针：扫程期间任何一次 Math.random 调用都直接抛错。真实引擎只走
    // core/rng.ts 的 seeded 路径（settleInvestments 内部 deriveSeed）。
    const original = Math.random;
    Math.random = (): number => {
      throw new Error('蒙特卡洛禁 Math.random：一切随机必须走 deriveSeed/makeRng');
    };
    try {
      const sim = simulate(['scrap_caravan']);
      expect(sim.outcomes.length).toBe(MC_SEEDS);
      expect(sim.outcomes.some((o) => o.income > 0)).toBe(true); // 真的跑出了收益
      expect(sim.outcomes.some((o) => o.collapsedCount > 0)).toBe(true); // 也真的跑出了爆仓
    } finally {
      Math.random = original;
    }
  });
});

describe('无支配：收益与风险同向的梯子（AG-14 §10.3 的平衡结论）', () => {
  it('every tier up pays more in expectation and in the right tail — and dies more often', () => {
    const [water, scrap, ration] = VENTURE_IDS.map((id) => profile(id));
    // 收益梯子单调向上（均值与右尾）……
    expect(water.netMean).toBeLessThan(scrap.netMean);
    expect(scrap.netMean).toBeLessThan(ration.netMean);
    expect(water.netP90).toBeLessThan(scrap.netP90);
    expect(scrap.netP90).toBeLessThan(ration.netP90);
    // ……风险梯子同步单调向上（爆仓率与左尾）：不存在"更高收益 + 更低风险"的门
    expect(water.collapseProb).toBeLessThan(scrap.collapseProb);
    expect(scrap.collapseProb).toBeLessThan(ration.collapseProb);
    expect(water.netP10).toBeGreaterThan(scrap.netP10);
    expect(scrap.netP10).toBeGreaterThan(ration.netP10);
  });

  it('no pair dominates each other — first-order stochastic dominance fails both ways', () => {
    // 一阶随机支配：A 支配 B ⟺ 对所有 x 都有 F_A(x) ≤ F_B(x) 且至少一处严格。
    //  empirical CDF 网格扫描：任何一门都是"左尾更厚"与"右尾更瘦"并存，
    // 梯子是真实的风险取舍，没有全面更优的设计失败。
    const byId = new Map(VENTURE_IDS.map((id) => [id, profile(id).nets]));
    const grid: number[] = [];
    for (let x = -140; x <= 420; x += 10) grid.push(x);
    const cdf = (sorted: readonly number[], x: number): number => {
      let lo = 0;
      let hi = sorted.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] <= x) lo = mid + 1;
        else hi = mid;
      }
      return lo / sorted.length;
    };
    for (const a of VENTURE_IDS) {
      for (const b of VENTURE_IDS) {
        if (a === b) continue;
        const A = byId.get(a)!;
        const B = byId.get(b)!;
        const all = grid.every((x) => cdf(A, x) <= cdf(B, x));
        const strict = grid.some((x) => cdf(A, x) < cdf(B, x));
        expect(all && strict, `${a} 一阶随机支配 ${b}——某一门全面更优，设计失败`).toBe(false);
      }
    }
  });

  it('a diversified portfolio lifts the median and slashes total ruin', () => {
    const sim = simulate(VENTURE_IDS);
    const nets = asc(sim.outcomes.map((o) => o.net));
    const singles = VENTURE_IDS.map((id) => profile(id));
    const allRuined = sim.outcomes.filter((o) => o.collapsedCount === VENTURE_IDS.length).length / MC_SEEDS;
    const noneRuined = sim.outcomes.filter((o) => o.collapsedCount === 0).length / MC_SEEDS;
    // 期望线性叠加（三门 RNG 流按 (seed, day, id) 互相独立）
    expect(mean(nets)).toBeCloseTo(127.9825, 3);
    expect(mean(nets)).toBeCloseTo(
      singles.reduce((sum, p) => sum + p.netMean, 0),
      6,
    );
    // 全灭/全存概率 ≈ 各自爆仓概率之积/补之积（独立性）
    const ruinProduct = singles.reduce((m, p) => m * p.collapseProb, 1);
    const safeProduct = singles.reduce((m, p) => m * (1 - p.collapseProb), 1);
    expect(allRuined).toBeCloseTo(ruinProduct, 1);
    expect(noneRuined).toBeCloseTo(safeProduct, 1);
    // 组合的中位净收益高于任何单门（分散化把中位数抬起来），全灭远低于最高单门
    expect(percentile(nets, 50)).toBe(111);
    expect(percentile(nets, 50)).toBeGreaterThan(Math.max(...singles.map((p) => p.netP50)));
    expect(allRuined).toBeLessThan(profile('ration_route').collapseProb);
    expect(percentile(nets, 10)).toBe(-77);
    expect(percentile(nets, 90)).toBe(344);
  });
});

describe('divest：AG-14 §10.2 遗留的流动出口', () => {
  const investedOf = (state: GameState): number => state.growth?.investedGold ?? 0;
  const venturesOf = (state: GameState): string[] => state.growth?.ventures ?? [];
  const ledgerCost = (state: GameState): number =>
    VENTURES.reduce((sum, v) => sum + (venturesOf(state).includes(v.id) ? v.cost : 0), 0);

  it('refunds 70% of the principal, atomically, and clears the ledger', () => {
    expect(DIVEST_REFUND_RATE).toBe(0.7);
    for (const def of VENTURES) {
      const s = createNewGame(1);
      s.player.gold = 1000;
      expect(invest(s, def.id).ok).toBe(true);
      const afterInvest = s.player.gold;
      const r = divest(s, def.id);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.refund).toBe(Math.floor(def.cost * DIVEST_REFUND_RATE)); // 28 / 56 / 84
        expect(r.gold).toBe(afterInvest + r.refund);
        expect(r.message).toContain(def.displayName);
      }
      expect(s.player.gold).toBe(1000 - def.cost + Math.floor(def.cost * DIVEST_REFUND_RATE));
      expect(investedOf(s)).toBe(0);
      expect(venturesOf(s)).toEqual([]);
      expect(investedOf(s)).toBe(ledgerCost(s)); // 账本不变量
    }
  });

  it('is idempotent — a second call refunds nothing and changes nothing', () => {
    const s = createNewGame(1);
    s.player.gold = 1000;
    invest(s, 'water_stall');
    expect(divest(s, 'water_stall').ok).toBe(true);
    const after = {
      gold: s.player.gold,
      invested: investedOf(s),
      ventures: venturesOf(s),
      xp: s.growth?.wealth.totalXp ?? 0,
    };
    const again = divest(s, 'water_stall');
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe('没有入股这门生意');
    expect(s.player.gold).toBe(after.gold);
    expect(investedOf(s)).toBe(after.invested);
    expect(venturesOf(s)).toEqual(after.ventures);
    expect(s.growth?.wealth.totalXp ?? 0).toBe(after.xp);
  });

  it('refuses unknown ids and never-held ventures without moving a coin', () => {
    const s = createNewGame(1);
    s.player.gold = 500;
    invest(s, 'scrap_caravan');
    const snap = {
      gold: s.player.gold,
      invested: investedOf(s),
      ventures: venturesOf(s),
      xp: s.growth?.wealth.totalXp ?? 0,
    };
    expect(divest(s, 'nope').ok).toBe(false); // 未知 id（与 invest 同口径）
    expect(divest(s, 'water_stall').ok).toBe(false); // 没入股过
    expect(s.player.gold).toBe(snap.gold);
    expect(investedOf(s)).toBe(snap.invested);
    expect(venturesOf(s)).toEqual(snap.ventures);
    expect(s.growth?.wealth.totalXp ?? 0).toBe(snap.xp);
  });

  it('teaches nothing — divest grants no wealth XP (the contract only pays for investing)', () => {
    const s = createNewGame(1);
    s.player.gold = 1000;
    invest(s, 'water_stall');
    expect(s.growth?.wealth.totalXp).toBe(50); // 契约 §5：完成一笔产业投资 +50
    divest(s, 'water_stall');
    expect(s.growth?.wealth.totalXp).toBe(50); // 撤资不喂经验
  });

  it('the 30% burn is the anti-farm cost: invest→divest→invest pays +50 per invest only', () => {
    const s = createNewGame(1);
    s.player.gold = 1000;
    expect(invest(s, 'water_stall').ok).toBe(true); // -40
    expect(divest(s, 'water_stall').ok).toBe(true); // +28
    expect(invest(s, 'water_stall').ok).toBe(true); // -40（撤过的门可以再进）
    expect(s.player.gold).toBe(1000 - 40 + 28 - 40); // 每圈固定烧 12
    expect(s.growth?.wealth.totalXp).toBe(100); // +50 ×2，divest 不给
    expect(venturesOf(s)).toEqual(['water_stall']);
    expect(investedOf(s)).toBe(costOf('water_stall'));
  });

  it('survives a save round-trip and keeps settling only what is still on the books', () => {
    // 找一棵"睡醒就收钱"的 seed（economyLoop 同款找法），让 round-trip 后的
    // 结算真的有钱进账，而不是空转。
    let paidSeed = 0;
    for (let candidate = 1; candidate <= 60; candidate++) {
      const probe = createNewGame(candidate);
      probe.player.gold = 1000;
      invest(probe, 'water_stall');
      probe.day = 2; // 结算刚结束的第 1 天（decay(1)=1）
      if (settleInvestments(probe).paid.length === 1) {
        paidSeed = candidate;
        break;
      }
    }
    expect(paidSeed).toBeGreaterThan(0);
    const s = createNewGame(paidSeed);
    s.player.gold = 300;
    expect(invest(s, 'water_stall').ok).toBe(true);
    expect(invest(s, 'scrap_caravan').ok).toBe(true);
    expect(divest(s, 'scrap_caravan').ok).toBe(true);
    const goldBefore = s.player.gold;
    const back = deserialize(serialize(s));
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(validateGameState(back.state)).toEqual([]);
      expect(back.state.growth?.ventures).toEqual(['water_stall']);
      expect(back.state.growth?.investedGold).toBe(costOf('water_stall'));
      expect(back.state.player.gold).toBe(goldBefore);
      // 读回来的档继续按日结算：只付在册的那一门，撤走的商路分文不再进账
      back.state.day = 2;
      const r = settleInvestments(back.state);
      expect(r.day).toBe(1);
      expect(r.paid.length).toBe(1);
      expect(r.paid[0].id).toBe('water_stall');
      expect(r.paid[0].income).toBe(Math.max(1, Math.round(40 * 0.05 * 1))); // 第 1 天无衰减：2
      expect(back.state.growth?.investedGold).toBe(ledgerCost(back.state));
    }
  });

  it('refuses after a collapse — a ruined venture is off the books for good', () => {
    // 找一门真的倒了的（seed, day）：与 economyLoop 的找法一致。
    let hit: { seed: number; day: number } | null = null;
    for (let seed = 1; seed <= 200 && !hit; seed++) {
      for (let day = 2; day <= 40 && !hit; day++) {
        const probe = createNewGame(seed);
        probe.player.gold = 1000;
        probe.day = day;
        invest(probe, 'ration_route');
        if (settleInvestments(probe).collapsed.length > 0) hit = { seed, day };
      }
    }
    expect(hit).not.toBeNull();
    const s = createNewGame(hit!.seed);
    s.player.gold = 1000;
    invest(s, 'ration_route');
    s.day = hit!.day;
    expect(settleInvestments(s).collapsed).toEqual(['ration_route']);
    const afterCollapse = s.player.gold;
    const r = divest(s, 'ration_route');
    expect(r.ok).toBe(false); // 出局的产业无可撤
    expect(s.player.gold).toBe(afterCollapse);
    expect(investedOf(s)).toBe(0);
    expect(venturesOf(s)).toEqual([]);
  });

  it('divesting is never the better play — the refund loses to holding, on every tier', () => {
    // 与蒙特卡洛对联：立即撤资（0.7×成本）在任何一门都被"持有 30 日"的期望
    // 总值严格优于——撤资因此是应急出口，不是占优策略（否则风险参数作废）。
    for (const def of VENTURES) {
      const p = profile(def.id);
      const refund = Math.floor(def.cost * DIVEST_REFUND_RATE);
      expect(refund, `${def.id} 撤资应亏`).toBeLessThan(def.cost); // 折价必亏
      expect(refund, `${def.id} 撤资不应优于持有`).toBeLessThan(def.cost + p.netMean);
    }
  });
});

describe('canCraft 语义统一：已建造即不可建（AG-42 §5.2）', () => {
  function give(state: GameState, items: Array<[ItemId, number]>): void {
    for (const [id, n] of items) addItem(state.player.inventory, id, n);
  }

  it('refuses an already-built recipe even with every material back in the bag', () => {
    // 修前：材料又凑齐时 canCraft 报 ok，craft() 却以"已建造"拒绝（语义分叉，
    // UI 靠"已建"列掩着）。现在两边一致：不能。
    const s = createNewGame(1);
    give(s, [['wood', 2], ['tape', 1]]);
    expect(craft(s, 'reinforced_door').ok).toBe(true);
    give(s, [['wood', 2], ['tape', 1]]);
    const r = canCraft(s, 'reinforced_door');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('已建造');
      expect(r.missing).toEqual([]); // 不是材料问题
    }
  });

  it('craft() still refuses identically and deducts nothing', () => {
    const s = createNewGame(1);
    give(s, [['wood', 2], ['tape', 1]]);
    expect(craft(s, 'reinforced_door').ok).toBe(true);
    give(s, [['wood', 2], ['tape', 1]]);
    const r = craft(s, 'reinforced_door');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('已建造');
    expect(countItem(s.player.inventory, 'wood')).toBe(2); // 原子：不扣
    expect(countItem(s.player.inventory, 'tape')).toBe(1);
  });

  it('the built check comes first — it outranks the gate and the materials', () => {
    // 与 craft() 的检查顺序一致：先已建造，再前置，再材料。凭证链上建成的
    // 通行贴，拒绝理由必须是"已建造"。
    const s = createNewGame(1);
    give(s, [['scrap_metal', 3], ['cloth', 4], ['tape', 2], ['wire', 4], ['battery', 4], ['filter', 1], ['fuse', 1]]);
    expect(craft(s, 'work_badge').ok).toBe(true);
    expect(craft(s, 'pass_sticker').ok).toBe(true);
    const r = canCraft(s, 'pass_sticker');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('已建造');
    expect(hasUpgrade(s, 'pass_sticker')).toBe(true);
  });

  it('keeps every pre-existing refusal semantics untouched', () => {
    // 未建造 + 材料齐 = ok；缺料 = missing 逐项（形状不变，toContainEqual 钉死）；
    // 缺前置 = 报门不报料。AG-42 的 hints 通道原样在。
    const s = createNewGame(1);
    give(s, [['wood', 2], ['tape', 1]]);
    expect(canCraft(s, 'reinforced_door').ok).toBe(true);
    const short = canCraft(s, 'lamp');
    expect(short.ok).toBe(false);
    if (!short.ok) {
      expect(short.missing).toContainEqual({ itemId: 'battery', need: 1, have: 0 });
      expect(short.missing).toContainEqual({ itemId: 'wire', need: 1, have: 0 });
      expect(short.missing).toContainEqual({ itemId: 'scrap_metal', need: 1, have: 0 });
      expect(short.hints).toBeDefined();
    }
    const gated = canCraft(s, 'pass_sticker');
    expect(gated.ok).toBe(false);
    if (!gated.ok) {
      expect(gated.reason).toContain('工牌');
      expect(gated.missing).toEqual([]);
    }
  });

  it('recipePreview stays coherent: a built recipe is built, not craftable, nothing missing', () => {
    const s = createNewGame(1);
    give(s, [['wood', 2], ['tape', 1]]);
    expect(craft(s, 'reinforced_door').ok).toBe(true);
    const p = recipePreview(s, 'reinforced_door');
    expect(p.built).toBe(true);
    expect(p.canCraft).toBe(false);
    expect(p.missing).toEqual([]);
    expect(p.hints).toBeUndefined();
    // 未建造的配方：AG-42  preview 形状一个字段没动
    const q = recipePreview(s, 'lamp');
    expect(q.built).toBe(false);
    expect(q.canCraft).toBe(false); // lamp 缺料
    expect(q.missing).toEqual([
      { itemId: 'battery', need: 1, have: 0 },
      { itemId: 'wire', need: 1, have: 0 },
      { itemId: 'scrap_metal', need: 1, have: 0 },
    ]);
  });
});

describe('AG-05 硬边界未破（本工单不动它们，只站岗）', () => {
  it('the guaranteed basket still sells for exactly 32 gold', () => {
    const s = createNewGame(1);
    const basket: Array<[ItemId, number]> = [
      ['fuse', 1], ['filter', 1], ['battery', 1], ['wire', 2],
      ['scrap_metal', 3], ['cloth', 1], ['wood', 2], ['tape', 1],
    ];
    for (const [id, n] of basket) for (let i = 0; i < n; i++) addItem(s.player.inventory, id, 1);
    s.player.gold = 0;
    for (const [id, n] of basket) {
      for (let i = 0; i < n; i++) expect(sell(s, id, 4).ok).toBe(true);
    }
    expect(s.player.gold).toBe(32); // AG-05 钉死：保底材料全卖 32 金
  });

  it('the trader’s ask still beats the bid — no arbitrage survives the changes', () => {
    for (const seed of [1, 42, 2026]) {
      for (const day of [1, 7, 30]) {
        expect(materialAsk('fuse', seed, day)).toBeGreaterThan(sellPrice('fuse', 2));
        expect(materialAsk('battery', seed, day)).toBeGreaterThan(sellPrice('battery', 2));
        expect(materialAsk('wire', seed, day)).toBeGreaterThan(sellPrice('scrap_metal', 2));
      }
    }
  });
});
