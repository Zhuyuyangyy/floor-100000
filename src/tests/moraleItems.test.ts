import { describe, expect, it } from 'vitest';
import { PLAYABLE_FLOORS_V01 } from '../core/constants';
import { createNewGame } from '../core/gameState';
import type { GameState, Item, ItemId } from '../core/gameTypes';
import { FLOOR_TEMPLATES } from '../data/floorTemplates';
import { ITEM_ICON_FILES } from '../render/artpack';
import {
  ALL_ITEMS,
  ALL_ITEM_IDS,
  ITEMS,
  ITEM_IDS,
  MORALE_ITEMS,
  MORALE_ITEM_IDS,
  asItemId,
  getItem,
  isItemId,
  type MoraleItemId,
} from '../data/items';
import { countItem, useConsumable } from '../systems/InventorySystem';
import { buy, materialAsk, sell, sellPrice, shopStock } from '../systems/shop';
import { moraleEffectOf } from '../systems/moraleItems';

// AG-29：物品提振心情（TWOM_ALIGNMENT.md 契约第四节）。
// GetDepressionChangeOnCheer + EffectMoraleProbabilities 的落地验证。

function stateWith(gold: number): GameState {
  const s = createNewGame(1);
  s.player.gold = gold;
  return s;
}

/** 合成一件只带心情字段的物品，用于概率边界（真实数据不覆盖 chance=0）。 */
function synth(moraleDelta: number, moraleChance?: number): Item {
  return {
    id: asItemId('cigarette'),
    displayName: '合成物',
    category: 'consumable',
    stackable: true,
    maxStack: 99,
    moraleDelta,
    ...(moraleChance === undefined ? {} : { moraleChance }),
  };
}

describe('morale items are fully specified (contract §4)', () => {
  it('every new item is a usable consumable with both morale fields', () => {
    expect(MORALE_ITEM_IDS.length).toBeGreaterThanOrEqual(3);
    for (const id of MORALE_ITEM_IDS) {
      const item = MORALE_ITEMS[id];
      expect(item.id, id).toBe(asItemId(id));
      expect(item.displayName.length, id).toBeGreaterThan(0);
      expect(item.category, id).toBe('consumable');
      expect(item.stackable, id).toBe(true);
      expect(item.maxStack, id).toBeGreaterThanOrEqual(1);
      // 没有 effect 的 consumable 会被 useConsumable 直接拒绝——配了心情
      // 字段也用不出去，那就是死数据。
      expect(item.effect, id).toBeDefined();
      expect(Number.isInteger(item.moraleDelta), `${id} moraleDelta`).toBe(true);
      expect(item.moraleDelta, id).not.toBe(0);
      expect(item.moraleChance, id).toBeGreaterThan(0);
      expect(item.moraleChance, id).toBeLessThanOrEqual(1);
    }
  });

  it('new display names are unique', () => {
    const names = MORALE_ITEM_IDS.map((id) => MORALE_ITEMS[id].displayName);
    expect(new Set(names).size).toBe(names.length);
  });

  it('no morale item touches hunger or thirst — they cannot replace food or water', () => {
    // survivalBalance 的水食边际与"每层恰好一瓶保底水"都钉死着；精神物只
    // 许动 energy（私酒是负的），否则刷心情就等于刷生存。
    for (const id of MORALE_ITEM_IDS) {
      expect(MORALE_ITEMS[id].effect?.stat, id).toBe('energy');
    }
  });
});

describe('the 15 v0.1 items carry morale only where it can be consumed', () => {
  it('exactly the four effect-bearing consumables are configured', () => {
    const configured = ITEM_IDS.filter((id) => ITEMS[id].moraleDelta !== undefined).sort();
    expect(configured).toEqual(['bread', 'clean_water', 'medkit', 'ration_pack']);
  });

  it('morale values sit on the documented scale (staples 2..3, medkit 4, chance 1)', () => {
    expect(ITEMS.clean_water.moraleDelta).toBe(2);
    expect(ITEMS.bread.moraleDelta).toBe(2);
    expect(ITEMS.ration_pack.moraleDelta).toBe(3);
    expect(ITEMS.medkit.moraleDelta).toBe(4);
    for (const id of ['clean_water', 'bread', 'ration_pack', 'medkit'] as ItemId[]) {
      expect(ITEMS[id].moraleChance, id).toBe(1);
    }
  });

  it('nothing unusable carries a morale field (dead-data guard)', () => {
    // useConsumable 对 category !== 'consumable' 或无 effect 的物品直接拒绝；
    // 给它们配 moraleDelta 就是没人读的数据。
    for (const id of ITEM_IDS) {
      const usable = ITEMS[id].category === 'consumable' && ITEMS[id].effect !== undefined;
      expect(ITEMS[id].moraleDelta !== undefined, `${id} usable=${usable}`).toBe(usable);
    }
  });
});

describe('moraleEffectOf (the pure consumer AG-25 calls)', () => {
  it('is a no-op for items without a morale delta', () => {
    expect(moraleEffectOf(getItem('wood'), 42, 3)).toEqual({ delta: 0, applied: false });
    expect(moraleEffectOf(synth(0, 1), 42, 3)).toEqual({ delta: 0, applied: false });
  });

  it('same (item, seed, day) always gives the same result', () => {
    for (const id of MORALE_ITEM_IDS) {
      const item = getItem(id);
      const a = moraleEffectOf(item, 2026, 7);
      const b = moraleEffectOf(item, 2026, 7);
      expect(a, id).toEqual(b);
    }
  });

  it('chance=1 always applies, chance=0 never does — on every seed', () => {
    for (let seed = 1; seed <= 400; seed++) {
      expect(moraleEffectOf(synth(6, 1), seed, 5).applied, `seed ${seed}`).toBe(true);
      expect(moraleEffectOf(synth(6, 0), seed, 5).applied, `seed ${seed}`).toBe(false);
    }
  });

  it('clamps an out-of-range chance instead of trusting it', () => {
    for (let seed = 1; seed <= 50; seed++) {
      expect(moraleEffectOf(synth(6, 1.5), seed, 5).applied, `seed ${seed}`).toBe(true);
      expect(moraleEffectOf(synth(6, -0.5), seed, 5).applied, `seed ${seed}`).toBe(false);
    }
  });

  it('an unset chance means certain (delta present, probability not configured)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      expect(moraleEffectOf(synth(6), seed, 5).applied, `seed ${seed}`).toBe(true);
    }
  });

  it('returns the configured delta when applied and zero when not', () => {
    const hit = moraleEffectOf(getItem(asItemId('cigarette')), 42, 3);
    expect(hit).toEqual({ delta: 6, applied: true });
    const miss = findMiss(getItem(asItemId('coffee')), 0.8);
    expect(miss).toEqual({ delta: 0, applied: false });
  });

  it('different days roll independently — coffee both cheers and fails to', () => {
    // EffectMoraleProbabilities 的时间维度：同 seed 下跨天真有不同的判定。
    let applied = 0;
    let missed = 0;
    for (let day = 1; day <= 120; day++) {
      if (moraleEffectOf(getItem(asItemId('coffee')), 42, day).applied) applied++;
      else missed++;
    }
    expect(applied).toBeGreaterThan(0);
    expect(missed).toBeGreaterThan(0);
  });

  it('hit rates track the configured probability across a seed sweep', () => {
    // 确定性扫 seed（非随机抽样），边界放宽松，只证"概率是真的在掷"。
    const rate = (id: MoraleItemId, n: number): number => {
      let hits = 0;
      for (let seed = 1; seed <= n; seed++) {
        if (moraleEffectOf(getItem(id), seed, 1).applied) hits++;
      }
      return hits / n;
    };
    expect(rate('cigarette', 2000)).toBe(1); // chance 1
    expect(rate('moonshine', 2000)).toBe(1); // chance 1
    expect(rate('coffee', 2000)).toBeGreaterThan(0.75);
    expect(rate('coffee', 2000)).toBeLessThan(0.85);
    expect(rate('old_book', 2000)).toBeGreaterThan(0.8);
    expect(rate('old_book', 2000)).toBeLessThan(0.9);
  });
});

/** 找第一个让咖啡掷空的日子，供"未生效返回 0"用。 */
function findMiss(item: Item, chance: number): { delta: number; applied: boolean } {
  for (let day = 1; day <= 120; day++) {
    const r = moraleEffectOf(item, 42, day);
    if (!r.applied) return r;
  }
  throw new Error(`chance ${chance} never missed in 120 days`);
}

describe('the trader really sells every morale item (acquisition path)', () => {
  it('each item is stocked from some band on', () => {
    for (const id of MORALE_ITEM_IDS) {
      const bands = [2, 3, 4, 5].filter((b) => shopStock(b).some((e) => e.itemId === asItemId(id)));
      expect(bands.length, `${id} is not stocked`).toBeGreaterThan(0);
    }
  });

  it('buying works, charges the shelf price, and lands in the bag', () => {
    for (const id of MORALE_ITEM_IDS) {
      const band = [2, 3, 4, 5].find((b) => shopStock(b).some((e) => e.itemId === asItemId(id)))!;
      const price = shopStock(band).find((e) => e.itemId === asItemId(id))!.price;
      const s = stateWith(500);
      const r = buy(s, asItemId(id), band);
      expect(r.ok, `${id} buy failed: ${r.ok ? '' : r.reason}`).toBe(true);
      expect(s.player.gold).toBe(500 - price);
      expect(countItem(s.player.inventory, asItemId(id))).toBe(1);
    }
  });

  it('a buy without gold changes nothing (atomic)', () => {
    const s = stateWith(0);
    const r = buy(s, asItemId('cigarette'), 3);
    expect(r.ok).toBe(false);
    expect(s.player.gold).toBe(0);
    expect(countItem(s.player.inventory, asItemId('cigarette'))).toBe(0);
  });

  it('the trader buys them back below the shelf price', () => {
    // 收购价走 sellPrice 的既有逻辑（band 标价折半），不新开表——
    // economyLoop 的"卖价永远到不了标价"因此原样成立。
    for (const id of MORALE_ITEM_IDS) {
      const band = [2, 3, 4, 5].find((b) => shopStock(b).some((e) => e.itemId === asItemId(id)))!;
      const price = shopStock(band).find((e) => e.itemId === asItemId(id))!.price;
      const bid = sellPrice(asItemId(id), band);
      expect(bid, id).toBeGreaterThanOrEqual(1);
      expect(bid, id).toBeLessThan(price);
      const s = stateWith(0);
      s.player.inventory.slots.push({ itemId: asItemId(id), quantity: 1 });
      const r = sell(s, asItemId(id), band);
      expect(r.ok, `${id} sell failed`).toBe(true);
      expect(s.player.gold).toBe(bid);
      expect(countItem(s.player.inventory, asItemId(id))).toBe(0);
    }
  });

  it('morale items never appear on the jittered material shelf', () => {
    // 材料货架是硬通货的当日牌价面；精神物只上商品架，避免同一物品两个价格。
    for (const id of MORALE_ITEM_IDS) {
      expect(materialAsk(asItemId(id), 42, 3), id).toBe(0);
    }
  });

  it('every band stays within the trader panel row budget (<= 5 stock rows)', () => {
    // 行商面板按"股票 30px/行 + 材料 26px/行 ×8"排版，5 行库存正好落在
    // 面板高度内；第 6 行会把材料货架挤出面板。见 shop.ts 的注释。
    for (const band of [2, 3, 4, 5]) {
      expect(shopStock(band).length, `band ${band}`).toBeLessThanOrEqual(5);
    }
  });
});

describe('a morale item can actually be consumed', () => {
  it('useConsumable applies the stat effect and consumes one', () => {
    const s = stateWith(0);
    s.player.inventory.slots.push({ itemId: asItemId('cigarette'), quantity: 2 });
    s.player.energy = 50;
    const r = useConsumable(s, asItemId('cigarette'));
    expect(r.ok).toBe(true);
    expect(s.player.energy).toBe(55); // effect energy +5
    expect(countItem(s.player.inventory, asItemId('cigarette'))).toBe(1);
  });

  it('moonshine cheers at a mechanical cost: energy -12', () => {
    const s = stateWith(0);
    s.player.inventory.slots.push({ itemId: asItemId('moonshine'), quantity: 1 });
    s.player.energy = 50;
    const r = useConsumable(s, asItemId('moonshine'));
    expect(r.ok).toBe(true);
    expect(s.player.energy).toBe(38);
  });

  it('coffee is the strongest stimulant of the set', () => {
    const s = stateWith(0);
    s.player.inventory.slots.push({ itemId: asItemId('coffee'), quantity: 1 });
    s.player.energy = 50;
    expect(useConsumable(s, asItemId('coffee')).ok).toBe(true);
    expect(s.player.energy).toBe(70); // effect energy +20
  });
});

describe('survivalBalance and the item gates are untouched', () => {
  it('the 15 v0.1 ids are exactly what they were', () => {
    expect(ITEM_IDS).toHaveLength(15);
    expect(new Set(ITEM_IDS).size).toBe(15);
    // 精神向新物品单独成表，不进 ITEM_IDS——items.test.ts /
    // survivalBalance / economyLoop 都按这 15 件裁决"有来源、无死物品"。
    for (const id of MORALE_ITEM_IDS) expect(ITEM_IDS).not.toContain(asItemId(id));
  });

  it('the merged table covers everything exactly once', () => {
    expect(ALL_ITEM_IDS).toHaveLength(ITEM_IDS.length + MORALE_ITEM_IDS.length);
    expect(new Set(ALL_ITEM_IDS).size).toBe(ALL_ITEM_IDS.length);
    for (const id of ALL_ITEM_IDS) expect(getItem(id).id).toBe(id);
    expect(Object.keys(ALL_ITEMS)).toHaveLength(19);
  });

  it('the artpack icon table still matches ITEM_IDS exactly (no new ids leaked in)', () => {
    expect(Object.keys(ITEM_ICON_FILES).sort()).toEqual([...ITEM_IDS].sort());
  });

  it('isItemId opens the save gate to the new items and nothing else', () => {
    for (const id of MORALE_ITEM_IDS) expect(isItemId(id), id).toBe(true);
    for (const id of ITEM_IDS) expect(isItemId(id), id).toBe(true);
    expect(isItemId('unobtainium')).toBe(false);
    expect(isItemId('')).toBe(false);
  });

  it('every upper-segment floor still guarantees exactly one bottle of water', () => {
    // survivalBalance 的水边际计算依赖它（"每层恰好一瓶"）。本工单不碰
    // floorTemplates，这里是把不变量钉在测试里：脏水按 1:1 折算计一瓶。
    for (const floor of PLAYABLE_FLOORS_V01) {
      if (floor < 100) continue; // tier 1 的水来自起始库存 + 净水器折算
      const t = FLOOR_TEMPLATES[floor];
      let bottles = 0;
      for (const c of t.containers) {
        for (const l of c.loot) {
          if (l.guaranteed !== true) continue;
          if (l.itemId === 'clean_water' || l.itemId === 'dirty_water') bottles += l.min;
        }
      }
      expect(bottles, `F${floor} guaranteed water`).toBe(1);
    }
  });

  it('no morale item was smuggled into any floor loot or ground pile', () => {
    const morale = new Set<string>(MORALE_ITEM_IDS);
    for (const floor of PLAYABLE_FLOORS_V01) {
      const t = FLOOR_TEMPLATES[floor];
      for (const c of t.containers) for (const l of c.loot) expect(morale.has(l.itemId)).toBe(false);
      for (const g of t.ground) expect(morale.has(g.itemId)).toBe(false);
    }
  });
});
