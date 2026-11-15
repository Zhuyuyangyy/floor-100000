import { expect, test, type Page } from '@playwright/test';

// AG-14's investment ledger, end to end: a venture in the books pays (or
// loses, or collapses) when the day rolls over through the REAL sleep path —
// bed → shelter panel → 睡觉 → day 2 → settleInvestments inside SurvivalSystem
// .sleep().
//
// Scope note (honest): the 投入 (buy-in) step has no UI yet — invest() in
// src/systems/shop.ts has no scene consumer on this branch (AG-20's wiring
// round is still in flight). The ledger is therefore seeded through the dev
// handle exactly as the future panel would write it (ventures + investedGold),
// and this spec covers the 按日结算 half through the product's own day-roll
// path. Nothing about the settlement itself is faked: the money moves because
// sleep() ran.
//
// Expectations are DERIVED, not pinned: the spec imports the product's own
// venture table and PRNG and replays settleInvestments' roll order
// (collapseChance, then lossChance) for the (seed, day, venture) the run will
// use, then picks seeds that land in each outcome class. If the table or the
// roll order changes, this spec follows it instead of rotting.

import { VENTURES, productionDecay, type VentureDef } from '../src/systems/shop';
import { deriveSeed, makeRng } from '../src/core/rng';

// The venture under test: the cheapest, so the ledger seeding is the smallest
// state mutation that reaches the settlement code.
const VENTURE: VentureDef = VENTURES[0];

interface DayPrediction {
  collapse: boolean;
  loss: boolean;
  income: number;
}

// Mirrors settleInvestments' rolls for one venture on one day — same seed
// derivation, same order, same income formula.
function predictDay(seed: number, day: number, def: VentureDef): DayPrediction {
  const rng = makeRng(deriveSeed(seed, day, 'venture', def.id));
  if (rng.chance(def.collapseChance)) return { collapse: true, loss: false, income: 0 };
  if (rng.chance(def.lossChance)) return { collapse: false, loss: true, income: 0 };
  const income = Math.max(1, Math.round(def.cost * def.baseRate * productionDecay(day)));
  return { collapse: false, loss: false, income };
}

/** A run seed whose first settled day lands in the wanted outcome class. */
function findSeed(want: 'income' | 'loss' | 'collapse'): number {
  for (let seed = 1; seed <= 20_000; seed++) {
    const p = predictDay(seed, 1, VENTURE);
    if (want === 'collapse' && p.collapse) return seed;
    if (want === 'loss' && p.loss) return seed;
    if (want === 'income' && !p.collapse && !p.loss) return seed;
  }
  throw new Error(`no seed in 1..20000 gives a ${want} day for ${VENTURE.id}`);
}

interface Snapshot {
  day: number;
  gold: number;
  wealthXp: number;
  ventures: string[];
  investedGold: number;
  settledDay: number;
}

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

const setX = (page: Page, x: number): Promise<void> =>
  page.evaluate((v) => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.player.x = v;
  }, x);

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState() as unknown as {
      day: number;
      player: { gold: number };
      growth?: { ventures: string[]; investedGold: number; wealth: { xp: number } };
      flags?: Record<string, number>;
    } | null;
    if (!s) throw new Error('no session');
    return {
      day: s.day,
      gold: s.player.gold,
      wealthXp: s.growth?.wealth.xp ?? -1,
      ventures: s.growth ? [...s.growth.ventures] : [],
      investedGold: s.growth?.investedGold ?? -1,
      settledDay: s.flags?.['economy:settled-day'] ?? 0,
    };
  });
}

async function hasVisibleText(page: Page, substr: string): Promise<boolean> {
  return page.evaluate((sub) => {
    const g = window.__PHASER_GAME__;
    const scenes = g ? g.scene.scenes : [];
    for (const sc of scenes) {
      for (const o of sc.children.list ?? []) {
        if (o.type === 'Text' && (o.text ?? '').includes(sub) && o.visible) return true;
      }
    }
    return false;
  }, substr);
}

/** Write the ledger the way the (not yet wired) investment panel would. */
async function seedLedger(page: Page, def: VentureDef | null): Promise<void> {
  await page.evaluate((venture) => {
    const s = window.__PHASER_SESSION__?.getState() as unknown as {
      growth?: { ventures: string[]; investedGold: number };
    } | null;
    if (!s) throw new Error('no session');
    if (!s.growth) throw new Error('no growth profile on the state');
    s.growth.ventures = venture ? [venture.id] : [];
    s.growth.investedGold = venture ? venture.cost : 0;
  }, def);
}

// Bed → shelter panel → commit the default action → sleep. The 20:00 gate is
// set as a fixture (the same phase-gate fixture shelter.spec.ts uses); every
// step after it is the real keyboard path, and the settlement runs inside the
// product's own sleep().
async function sleepThroughNight(page: Page): Promise<void> {
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.gameMinuteOfDay = 1200;
  });
  await setX(page, 1120); // BED_X, the dorm bed on floor 1
  await page.keyboard.press('E');
  await expect.poll(async () => hasVisibleText(page, '夜间安排 · 宿舍')).toBe(true);
  await page.keyboard.press('Enter'); // commit the default shelter action
  await expect.poll(async () => hasVisibleText(page, 'Enter 睡觉 · ESC 返回')).toBe(true);
  await page.keyboard.press('E'); // the hint says Enter; E is what the handler takes
  await page.waitForFunction(() => window.__PHASER_SESSION__?.getState()?.day === 2, undefined, { timeout: 20_000 });
}

test('an income day pays the decayed production into gold', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const seed = findSeed('income');
  const want = predictDay(seed, 1, VENTURE);
  expect(want.income).toBeGreaterThan(0);

  await startGame(page, seed);
  await seedLedger(page, VENTURE);
  const before = await snapshot(page);
  expect(before.day).toBe(1);
  expect(before.settledDay).toBe(0); // nothing settled during boot

  await sleepThroughNight(page);

  const after = await snapshot(page);
  expect(after.day).toBe(2);
  // The settled-day watermark moved, and the payout matches the derived
  // number exactly — not "some gold arrived".
  expect(after.settledDay).toBe(1);
  expect(after.gold - before.gold).toBe(want.income);
  // The venture survives an income day, principal untouched.
  expect(after.ventures).toContain(VENTURE.id);
  expect(after.investedGold).toBe(before.investedGold);
  // Only a paying day teaches wealth: +VENTURE_DAY_XP per paying venture.
  expect(after.wealthXp - before.wealthXp).toBe(5);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a loss day pays nothing but keeps the venture', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const seed = findSeed('loss');
  const want = predictDay(seed, 1, VENTURE);
  expect(want.loss).toBe(true);

  await startGame(page, seed);
  await seedLedger(page, VENTURE);
  const before = await snapshot(page);

  await sleepThroughNight(page);

  const after = await snapshot(page);
  expect(after.day).toBe(2);
  expect(after.settledDay).toBe(1);
  expect(after.gold).toBe(before.gold); // no income
  expect(after.ventures).toContain(VENTURE.id); // still in the books
  expect(after.investedGold).toBe(before.investedGold); // principal intact
  expect(after.wealthXp).toBe(before.wealthXp); // a loss teaches nothing
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a collapse day loses the principal and delists the venture', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const seed = findSeed('collapse');
  const want = predictDay(seed, 1, VENTURE);
  expect(want.collapse).toBe(true);

  await startGame(page, seed);
  await seedLedger(page, VENTURE);
  const before = await snapshot(page);

  await sleepThroughNight(page);

  const after = await snapshot(page);
  expect(after.day).toBe(2);
  expect(after.settledDay).toBe(1);
  expect(after.gold).toBe(before.gold); // no income on a collapse day
  expect(after.ventures).not.toContain(VENTURE.id); // out of the books
  expect(after.investedGold).toBe(before.investedGold - VENTURE.cost); // principal gone
  expect(after.wealthXp).toBe(before.wealthXp);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a night with no ventures settles nothing but still marks the day', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await seedLedger(page, null);
  const before = await snapshot(page);

  await sleepThroughNight(page);

  const after = await snapshot(page);
  expect(after.day).toBe(2);
  expect(after.gold).toBe(before.gold);
  expect(after.ventures).toEqual([]);
  // The no-op still writes the watermark: a second call the same day would
  // double-pay without it.
  expect(after.settledDay).toBe(1);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
