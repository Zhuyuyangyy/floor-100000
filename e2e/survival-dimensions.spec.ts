import { expect, test, type Page } from '@playwright/test';

// TWOM 对齐 §1：新增玩家维度（AG-25 属主，契约 docs/plans/TWOM_ALIGNMENT.md
// 第一节；需求来源 docs/reference/TWOM_MECHANICS.md §3——缺的三样最影响
// "活着"的质感：TickTemperature / ProcessSickness / TickHeaters）。
//
// **本 spec 整体处于 test.skip() 待启用状态。取消条件：AG-25 合入
// `integrate/sprint-01` 后，删除每个 test 里的 `test.skip(...)` 行并实跑；
// 若实跑发现机制没按契约实现（字段缺失、语义不符），定性为产品缺陷写进
// 报告，不许为了绿改这里的期望值。**
//
// 契约定死的形状（§1）：
//   bodyHeat: number        体温 0..100。cold 按游戏小时消耗，热源附近恢复。
//                           0 = 失温失败。
//   morale: number          心情点数，TWOM 的 Depression 模型：点数池 + 衰减
//                           + 概率生效，不是 0-100 槽；可为负。
//   moraleBaseline: number  每日复归的基线（DepressionChangeOnDayBegin）。
//   sickness: 'healthy' | 'sick' | 'critical'   hp 归零前多一档"病了但还能动"。
//   sicknessDay: number     染上疾病的那一天，用于"病了 N 天"。
// 存档兼容走 SaveSystem 的"缺字段补默认"，**不升 schemaVersion**。
//
// 实现说明（AG-25 合入后应出现在 docs/plans/TWOM_ALIGNMENT.md 的实现节里，
// 合入时以那一节的字段/函数名为准校正本 spec 的夹具与期望）。
//
// 注意：本分支已有一个 B3 时代的 EnvironmentSystem（bodyTemp 0..100、
// COLD_THRESHOLD=35 / FREEZING_THRESHOLD=10、warmthAt、tickEnvironment），
// 与契约 §1 的 bodyHeat 是**两套东西**（阈值语义、消耗模型都不同）。本 spec
// 只测契约的新字段，不混用旧 bodyTemp。

// ── 公共助手（与其它 spec 同型）─────────────────────────────────────────────

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => {
      const g = window.__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === k);
    },
    key,
    { timeout: 20_000 },
  );
}

async function startGame(page: Page, seed: number): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const started = await page.waitForFunction(
      () => {
        const g = window.__PHASER_GAME__;
        return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
      },
      undefined,
      { timeout: 2000 },
    ).then(() => true).catch(() => false);
    if (started) break;
  }
  await waitForScene(page, 'Game');
}

/** 契约 §1 的五个新字段（当前分支尚不存在，故内联声明）。 */
interface SurvivalDims {
  bodyHeat?: number;
  morale?: number;
  moraleBaseline?: number;
  sickness?: 'healthy' | 'sick' | 'critical';
  sicknessDay?: number;
}

async function readDims(page: Page): Promise<SurvivalDims> {
  return page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    const p = s?.player as SurvivalDims | undefined;
    return {
      bodyHeat: p?.bodyHeat,
      morale: p?.morale,
      moraleBaseline: p?.moraleBaseline,
      sickness: p?.sickness,
      sicknessDay: p?.sicknessDay,
    };
  });
}

async function setClock(page: Page, minuteOfDay: number): Promise<void> {
  await page.evaluate((m) => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.gameMinuteOfDay = m;
  }, minuteOfDay);
}

// ── 体温三档 ────────────────────────────────────────────────────────────────

test('bodyHeat: the cold consumes it by the game hour, heat sources restore it, and zero is failure', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  test.skip(true, 'AG-25 未合入：契约 §1 的 bodyHeat 字段尚不存在。取消条件 = AG-25 合入 integrate/sprint-01 后删除本行并实跑。');

  await startGame(page, 42);

  // 新档默认值在契约范围内（0..100）。
  const fresh = await readDims(page);
  expect(fresh.bodyHeat).toBeGreaterThan(0);
  expect(fresh.bodyHeat).toBeLessThanOrEqual(100);

  // 夜里（18:00 后）在无热源的楼层挨时间——体温按游戏小时往下掉。
  await setClock(page, 1320); // 22:00
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.currentFloor = 3; // 储物层，无热源
  });
  const cold = await page.waitForFunction(
    () => {
      const s = window.__PHASER_SESSION__?.getState();
      const heat = (s?.player as SurvivalDims | undefined)?.bodyHeat;
      return typeof heat === 'number' && heat < 100;
    },
    undefined,
    { timeout: 30_000 },
  ).then(() => readDims(page)).catch(() => null);
  expect(cold, 'night exposure must consume bodyHeat').not.toBeNull();
  expect(cold!.bodyHeat!).toBeLessThan(100);

  // 靠近热源（宿舍床/蜡烛）恢复。热源坐标以产品 constants 的 WARMTH_SOURCES
  // 为准（AG-25 属主），合入后按实际字段名校正这里。
  await setClock(page, 1320);
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.currentFloor = 1;
  });
  const dipped = (await readDims(page)).bodyHeat!;
  await page.waitForFunction(
    (from) => {
      const s = window.__PHASER_SESSION__?.getState();
      const heat = (s?.player as SurvivalDims | undefined)?.bodyHeat;
      return typeof heat === 'number' && heat > (from as number);
    },
    dipped,
    { timeout: 30_000 },
  );

  // 0 = 失温失败：把体温打到 0，必须走向失败终局（与饥渴归零同族）。
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    (s?.player as SurvivalDims | undefined)!.bodyHeat = 0;
  });
  await waitForScene(page, 'End');
  const ended = await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.status);
  expect(ended).toBe('lost');

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── 心情点数池 ──────────────────────────────────────────────────────────────

test('morale: a points pool with decay, a daily baseline, and probabilistic item effects', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  test.skip(true, 'AG-25 未合入：契约 §1 的 morale/moraleBaseline 字段尚不存在。取消条件 = AG-25 合入 integrate/sprint-01 后删除本行并实跑（概率生效部分等 AG-29 的心情物品合入后覆盖）。');

  await startGame(page, 42);

  const fresh = await readDims(page);
  // 点数池（可为负），不是 0-100 槽：基线字段存在且是有限数。
  expect(typeof fresh.morale).toBe('number');
  expect(Number.isFinite(fresh.morale!)).toBe(true);
  expect(typeof fresh.moraleBaseline).toBe('number');

  // 跨日复归基线：睡一觉到第二天，morale 向 moraleBaseline 回归
  // （DepressionChangeOnDayBegin 的语义；衰减/回归的具体曲线以 AG-25
  // 实现说明为准，这里只钉"向基线回归"这个方向）。
  await setClock(page, 1200); // 20:00，允许睡觉
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.player.x = 1120; // BED_X
    (s?.player as SurvivalDims | undefined)!.morale = -50; // 远低于基线
  });
  await page.keyboard.press('E');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => !!window.__PHASER_SESSION__?.getState()?.shelterPlan?.resolved,
    undefined,
    { timeout: 10_000 },
  );
  await page.keyboard.press('E');
  await page.waitForFunction(
    () => window.__PHASER_SESSION__?.getState()?.day === 2,
    undefined,
    { timeout: 20_000 },
  );

  const next = await readDims(page);
  expect(next.morale!).toBeGreaterThan(-50); // 向基线回归
});

// ── 疾病三档 ────────────────────────────────────────────────────────────────

test('sickness: healthy < sick < critical sits between alive and dead, with the day it started', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  test.skip(true, 'AG-25 未合入：契约 §1 的 sickness/sicknessDay 字段尚不存在。取消条件 = AG-25 合入 integrate/sprint-01 后删除本行并实跑。');

  await startGame(page, 42);

  // 新档健康。
  const fresh = await readDims(page);
  expect(fresh.sickness).toBe('healthy');

  // 染病： ailments 已经存在（SicknessSystem， wound/cold/fever），契约要求
  // 病症把 sickness 推到中间态而不是直接掉 hp。
  await page.evaluate(async () => {
    const path = '/src/systems/SicknessSystem.ts';
    const m = (await import(path)) as { inflict: (s: unknown, id: string) => unknown };
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    m.inflict(s, 'cold');
  });

  const sick = await page.waitForFunction(
    () => {
      const s = window.__PHASER_SESSION__?.getState();
      const dims = s?.player as SurvivalDims | undefined;
      return dims?.sickness === 'sick' || dims?.sickness === 'critical';
    },
    undefined,
    { timeout: 30_000 },
  ).then(() => readDims(page)).catch(() => null);
  expect(sick, 'an ailment must push sickness out of healthy').not.toBeNull();
  expect(['sick', 'critical']).toContain(sick!.sickness);
  // sicknessDay 记录染上那一天（病了 N 天的依据）。
  expect(typeof sick!.sicknessDay).toBe('number');
  expect(sick!.sicknessDay!).toBeGreaterThanOrEqual(1);

  // critical 档：hp 归零前多一档"病了但还能动"——severity 拉满应先看到
  // critical，且此刻状态仍是 playing（不是直接 End）。
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    const ailments = (s?.player as { ailments?: Array<{ id: string; severity: number; sinceMinute: number }> }).ailments;
    if (ailments) for (const a of ailments) a.severity = 100;
  });
  const critical = await page.waitForFunction(
    () => {
      const s = window.__PHASER_SESSION__?.getState();
      const dims = s?.player as SurvivalDims | undefined;
      return dims?.sickness === 'critical';
    },
    undefined,
    { timeout: 30_000 },
  ).then(() => page.evaluate(() => ({
    dims: (window.__PHASER_SESSION__?.getState()?.player as SurvivalDims | undefined),
    status: window.__PHASER_SESSION__?.getState()?.status,
  }))).catch(() => null);
  expect(critical, 'max severity must reach the critical tier').not.toBeNull();
  expect(critical!.dims?.sickness).toBe('critical');
  expect(critical!.status, 'critical is still alive — the run has not ended').toBe('playing');

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
