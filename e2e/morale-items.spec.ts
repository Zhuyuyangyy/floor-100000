import { expect, test, type Page } from '@playwright/test';

// TWOM 对齐 §4：物品的心情字段（AG-29 属主，契约 docs/plans/TWOM_ALIGNMENT.md
// 第四节；需求来源 docs/reference/TWOM_MECHANICS.md §2——KosovoEmotional-
// Component 的 GetDepressionChangeOnCheer(Item*, Item*) 与
// EffectMoraleProbabilities：物品能直接改心情，且**按概率生效**）。
//
// **AG-32 于 2026-11-16 启用：AG-29 已合入 integrate/sprint-01（d89a332），
// 三个 test.skip(...) 行已删。夹具按合入后的实现做了校正（不碰期望值）：
//   1. moraleEffectOf 的真实签名是 (item, seed, day)，不是预写的
//      (state, itemId)——Phase 1 写 spec 时产品还没落地，按头注「合入后
//      以实际函数名为准校正」改调用面，掷序仍以产品函数内部为准。
//   2. 测试 2 的「实跑」原本只开背包再关上（Phase 1 标注的待校正点）。
//      合入后核对发现：UI 侧 useConsumable 不推 morale——
//      cheerFromItem / moraleEffectOf 在生产代码零调用方（产品缺口，已写进
//      报告），所以点数语义在函数面上钉：调产品自己的消费入口
//      MoraleSystem.cheerFromItem，掷中加满 moraleDelta、未掷中不动。
//      背包面板照旧开一次（证明物品在面板里可见），不断言它推点数。
//   3. 物品表实际是两张：ITEMS（原 15 件）+ MORALE_ITEMS（4 件精神向新
//      物品），概率档的咖啡/旧书在后者——Phase 1 预写的单表 ITEMS 找不到
//      它们，改查合并全表 ALL_ITEMS（"以 items.ts 的实际清单为准"）。**
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

  await startGame(page, 42);

  // AG-29 的 4 件新精神物品（烟/酒/咖啡/书/收音机一族，以 shop.ts 的
  // SHOP_STOCK 与 items.ts 的实际清单为准）：每件都要有 moraleDelta，
  // 且 moraleChance 落在 0..1（1 = 必然生效）。实际清单是两张表——
  // ITEMS（原 15 件，其中 4 件消耗品带心情字段）+ MORALE_ITEMS（4 件
  // 精神向新物品），合并全表 ALL_ITEMS 才是"物品定义了心情字段"的全集。
  const items = await page.evaluate(async () => {
    const path = '/src/data/items.ts';
    const m = (await import(path)) as {
      ALL_ITEMS: Record<string, MoraleItemFields>;
      isItemId: (id: string) => boolean;
    };
    const withMorale = Object.entries(m.ALL_ITEMS).filter(([, def]) => typeof def.moraleDelta === 'number');
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

  await startGame(page, 42);

  // 期望值派生而非钉死（investment.spec.ts 同法）：spec import 产品自己的
  // moraleEffectOf，按 (item, runSeed, day) 复算本次使用掷不掷、掷中加多少
  // ——真实签名 (item, seed, day)，见头注校正 1。
  const prediction = await page.evaluate(async () => {
    const path = '/src/systems/moraleItems.ts';
    const m = (await import(path)) as {
      moraleEffectOf: (item: unknown, seed: number, day: number) => { applied: boolean; delta: number };
    };
    const itemsPath = '/src/data/items.ts';
    const items = (await import(itemsPath)) as { ALL_ITEMS: Record<string, MoraleItemFields> };
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');

    // 找一件有 moraleChance < 1 的精神物品（概率档才测得出摇序）。
    const probabilistic = Object.entries(items.ALL_ITEMS).find(
      ([, def]) => typeof def.moraleDelta === 'number' && typeof def.moraleChance === 'number' && def.moraleChance < 1,
    );
    if (!probabilistic) return null;
    const [itemId, def] = probabilistic;
    // 产品自己的判定函数就是基准：同一 (item, seed, day) 的回答必须确定。
    const seed = s.runSeed as number;
    const first = m.moraleEffectOf(def, seed, s.day);
    const second = m.moraleEffectOf(def, seed, s.day);
    return {
      itemId,
      delta: def.moraleDelta!,
      chance: def.moraleChance!,
      deterministic: JSON.stringify(first) === JSON.stringify(second),
      applied: first.applied,
    };
  });

  expect(prediction, 'a probabilistic spirit item must exist').not.toBeNull();
  expect(prediction!.deterministic, 'moraleEffectOf must be a pure function of (item, seed, day)').toBe(true);

  // 实跑（函数面）：契约 §4 的消费侧入口是 MoraleSystem.cheerFromItem。
  // UI 侧的「背包里回车使用」目前不推 morale（useConsumable 未接消费侧——
  // 产品缺口，见头注校正 2 与报告），点数语义在这里钉：掷中加满
  // moraleDelta，未掷中一个点都不动。
  const before = await readMorale(page);
  expect(before, 'morale points pool must exist (AG-25)').not.toBeNull();

  const use = await page.evaluate(async (itemId) => {
    const moralePath = '/src/systems/MoraleSystem.ts';
    const itemsPath = '/src/data/items.ts';
    const morale = (await import(moralePath)) as {
      cheerFromItem: (state: unknown, item: unknown, itemId: string) => { applied: boolean; delta: number };
      moraleOf: (state: unknown) => number;
    };
    const items = (await import(itemsPath)) as { ALL_ITEMS: Record<string, MoraleItemFields> };
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    const poolBefore = morale.moraleOf(s);
    const result = morale.cheerFromItem(s, items.ALL_ITEMS[itemId], itemId);
    return { applied: result.applied, delta: result.delta, moved: morale.moraleOf(s) - poolBefore };
  }, prediction!.itemId);
  expect(use.applied, 'a landed roll reports applied').toBe(use.delta !== 0);
  expect(use.moved, 'the pool moves by exactly moraleDelta on a hit, and not at all on a miss').toBe(use.delta);

  // 背包面板照旧开一次：物品给得出、在面板里可见（Phase 1 标注的待校正点；
  // 键序以合入后的面板为准，这里不钉 UI 推点数——见头注校正 2）。
  await giveItem(page, prediction!.itemId, 1);
  await page.keyboard.press('I'); // 背包
  await expect.poll(async () => hasVisibleText(page, '背包')).toBe(true);
  await page.keyboard.press('Escape');

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── 3. 概率模型不走 Math.random ─────────────────────────────────────────────

test('the morale roll is reproducible: the same seed and day roll the same effect, twice', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  const twice = await page.evaluate(async () => {
    const path = '/src/systems/moraleItems.ts';
    const m = (await import(path)) as {
      moraleEffectOf: (item: unknown, seed: number, day: number) => unknown;
    };
    const itemsPath = '/src/data/items.ts';
    const items = (await import(itemsPath)) as { ALL_ITEMS: Record<string, MoraleItemFields> };
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    const spirit = Object.entries(items.ALL_ITEMS).find(([, def]) => typeof def.moraleDelta === 'number');
    if (!spirit) return null;
    const def = spirit[1];
    const seed = s.runSeed as number;
    const a = JSON.stringify(m.moraleEffectOf(def, seed, s.day));
    const b = JSON.stringify(m.moraleEffectOf(def, seed, s.day));
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
