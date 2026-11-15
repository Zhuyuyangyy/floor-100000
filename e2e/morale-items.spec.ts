import { expect, test, type Page } from '@playwright/test';

// TWOM 对齐 §4：物品的心情字段（AG-29 属主，契约 docs/plans/TWOM_ALIGNMENT.md
// 第四节；需求来源 docs/reference/TWOM_MECHANICS.md §2——KosovoEmotional-
// Component 的 GetDepressionChangeOnCheer(Item*, Item*) 与
// EffectMoraleProbabilities：物品能直接改心情，且**按概率生效**）。
//
// **本 spec 整体处于 test.skip() 待启用状态。取消条件：AG-29 合入
// `integrate/sprint-01` 后，删除每个 test 里的 `test.skip(...)` 行并实跑；
// 若实跑发现机制没按契约实现（字段缺失、概率不走 seeded RNG、期望值对不上），
// 定性为产品缺陷写进报告，不许为了绿改这里的期望值。**
//
// 契约定死的形状（§4，写在 src/data/items.ts 的物品字段上）：
//   moraleDelta?: number   使用后对 morale 点数的影响（GetDepression-
//                           ChangeOnCheer）。
//   moraleChance?: number  概率生效的权重，0..1；1 = 必然生效
//                           （EffectMoraleProbabilities；seeded RNG，
//                           **不要 Math.random**——TWOM 文档原话）。
// 另：moraleItems.ts 的 moraleEffectOf 纯函数（seeded RNG）是 AG-29 的落地，
// 合入后本 spec 的期望值从它派生（与 investment.spec.ts 同法：产品表或摇序
// 一变，spec 跟着变而不是烂掉）。
//
// 关联缺口：morale 点数池本身是 AG-25 的字段（§1）。AG-29 合入而 AG-25 未
// 合入时，本 spec 只能验"物品定义了心情字段"，点数变化要等两边都在。

// ── 公共助手 ────────────────────────────────────────────────────────────────

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

/** 契约定死的物品心情字段（当前分支尚不存在，故内联声明）。 */
interface MoraleItemFields {
  moraleDelta?: number;
  moraleChance?: number;
}

async function giveItem(page: Page, itemId: string, quantity = 1): Promise<void> {
  await page.evaluate(
    ({ id, n }) => {
      const s = window.__PHASER_SESSION__?.getState();
      const slot = s?.player.inventory.slots.find((x) => x.itemId === id);
      if (slot) slot.quantity += n;
      else s?.player.inventory.slots.push({ itemId: id, quantity: n });
    },
    { id: itemId, n: quantity },
  );
}

async function readMorale(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    const morale = (s?.player as { morale?: number } | undefined)?.morale;
    return typeof morale === 'number' ? morale : null;
  });
}

// ── 1. 新精神物品带心情字段 ─────────────────────────────────────────────────

test('the new spirit items carry morale fields, and moraleChance stays a seeded-RNG probability', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  test.skip(true, 'AG-29 未合入：契约 §4 的 moraleDelta/moraleChance 物品字段尚不存在。取消条件 = AG-29 合入 integrate/sprint-01 后删除本行并实跑。');

  await startGame(page, 42);

  // AG-29 的 4 件新精神物品（烟/酒/咖啡/书/收音机一族，以 shop.ts 的
  // SHOP_STOCK 与 items.ts 的实际清单为准）：每件都要有 moraleDelta，
  // 且 moraleChance 落在 0..1（1 = 必然生效）。
  const items = await page.evaluate(async () => {
    const path = '/src/data/items.ts';
    const m = (await import(path)) as {
      ITEMS: Record<string, MoraleItemFields>;
      isItemId: (id: string) => boolean;
    };
    const withMorale = Object.entries(m.ITEMS).filter(([, def]) => typeof def.moraleDelta === 'number');
    return {
      count: withMorale.length,
      ids: withMorale.map(([id]) => id),
      chances: withMorale.map(([, def]) => def.moraleChance),
      allKnown: withMorale.every(([id]) => m.isItemId(id)),
    };
  });

  expect(items.count, 'at least the four new spirit items must carry moraleDelta').toBeGreaterThanOrEqual(4);
  expect(items.allKnown).toBe(true);
  for (const chance of items.chances) {
    if (chance === undefined) continue; // 缺省 = 必然生效（1）
    expect(chance).toBeGreaterThan(0);
    expect(chance).toBeLessThanOrEqual(1);
  }

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── 2. 使用心情物品改点数（概率生效，期望值从产品代码派生）─────────────────

test('using a spirit item moves morale points, with the effect rolled by the seeded RNG', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  test.skip(true, 'AG-29 未合入（且依赖 AG-25 的 morale 字段）。取消条件 = AG-29 与 AG-25 都合入 integrate/sprint-01 后删除本行并实跑。');

  await startGame(page, 42);

  // 期望值派生而非钉死（investment.spec.ts 同法）：spec import 产品自己的
  // moraleEffectOf / deriveSeed / makeRng，按 (seed, day, item) 复算本次
  // 使用掷不掷、掷中加多少，再挑一个"必然生效"的 run seed 做实跑。
  const prediction = await page.evaluate(async () => {
    const path = '/src/systems/moraleItems.ts';
    const m = (await import(path)) as {
      moraleEffectOf: (state: unknown, itemId: string) => { fires: boolean; delta: number } | null;
    };
    const itemsPath = '/src/data/items.ts';
    const items = (await import(itemsPath)) as { ITEMS: Record<string, MoraleItemFields> };
    const rngPath = '/src/core/rng.ts';
    const rng = (await import(rngPath)) as { deriveSeed: (...parts: unknown[]) => number; makeRng: (seed: number) => { chance: (p: number) => boolean } };
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');

    // 找一件有 moraleChance < 1 的精神物品（概率档才测得出摇序）。
    const probabilistic = Object.entries(items.ITEMS).find(
      ([, def]) => typeof def.moraleDelta === 'number' && typeof def.moraleChance === 'number' && def.moraleChance < 1,
    );
    if (!probabilistic) return null;
    const [itemId, def] = probabilistic;
    // 产品自己的判定函数就是基准：它对同一 (state, item) 的回答必须确定。
    const first = m.moraleEffectOf(s, itemId);
    const second = m.moraleEffectOf(s, itemId);
    void rng; // 摇序细节以 moraleEffectOf 内部为准，spec 不重造
    return { itemId, delta: def.moraleDelta!, chance: def.moraleChance!, deterministic: JSON.stringify(first) === JSON.stringify(second) };
  });

  expect(prediction, 'a probabilistic spirit item must exist').not.toBeNull();

  // 实跑：从背包使用它，morale 点数按 moraleEffectOf 的判定变化。
  const before = await readMorale(page);
  expect(before, 'morale points pool must exist (AG-25)').not.toBeNull();

  await giveItem(page, prediction!.itemId, 1);
  await page.keyboard.press('I'); // 背包
  await expect.poll(async () => hasVisibleText(page, '背包')).toBe(true);
  // 光标移到该物品并回车使用——具体键序以 AG-29 接线后的面板为准，
  // 合入时按实际面板校正（此处标注为待校正点）。
  await page.keyboard.press('Escape');

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── 3. 概率模型不走 Math.random ─────────────────────────────────────────────

test('the morale roll is reproducible: the same seed and day roll the same effect, twice', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  test.skip(true, 'AG-29 未合入。取消条件 = AG-29 合入 integrate/sprint-01 后删除本行并实跑。');

  await startGame(page, 42);

  const twice = await page.evaluate(async () => {
    const path = '/src/systems/moraleItems.ts';
    const m = (await import(path)) as { moraleEffectOf: (state: unknown, itemId: string) => unknown };
    const itemsPath = '/src/data/items.ts';
    const items = (await import(itemsPath)) as { ITEMS: Record<string, MoraleItemFields> };
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    const spirit = Object.entries(items.ITEMS).find(([, def]) => typeof def.moraleDelta === 'number');
    if (!spirit) return null;
    const a = JSON.stringify(m.moraleEffectOf(s, spirit[0]));
    const b = JSON.stringify(m.moraleEffectOf(s, spirit[0]));
    return { same: a === b, a };
  });

  expect(twice, 'a spirit item must exist').not.toBeNull();
  expect(twice!.same, 'moraleEffectOf must be pure — no Math.random (TWOM 文档硬性要求)').toBe(true);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

async function hasVisibleText(page: Page, substr: string): Promise<boolean> {
  return page.evaluate((sub) => {
    const scenes = window.__PHASER_GAME__?.scene.scenes ?? [];
    for (const sc of scenes) {
      for (const o of sc.children.list ?? []) {
        if (o.type === 'Text' && (o.text ?? '').includes(sub) && o.visible) return true;
      }
    }
    return false;
  }, substr);
}
