import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { addItem, countItem } from '../systems/InventorySystem';
import { getFloorView, lootContainer, lootGround } from '../systems/LootSystem';
import {
  canCraft,
  craft,
  hasUpgrade,
  recipePreview,
  recipeTierLocked,
  recipeTierNote,
} from '../systems/CraftingSystem';
import { MATERIAL_SOURCES, RECIPES, getRecipe, materialSourceHint } from '../data/recipes';
import { FLOOR_TEMPLATES } from '../data/floorTemplates';
import { PLAYABLE_FLOORS_V01 } from '../core/constants';
import type { GameState, ItemId } from '../core/gameTypes';

// AG-42：合成闭环（爬高 → 拿好料 → 做好东西）的诊断表断言版与心流修复钉桩。
//
// 诊断结论（数据见 docs/plans/CRAFT.md §1）：
//   - 第一盏灯不是断点：battery/wire/scrap 全部在 3/4 层保底，第 1 天可建；
//   - 真正的断点是**信息层**：上链凭证（通行贴起）的进阶料在 tier 1 内做不齐
//     （0/300 种子能走完凭证链），但缺料提示不说"去哪拿"、面板不显示效果与
//     档位，"100 层以上更常见"这条真实梯度玩家从头到尾看不到；
//   - 配方成本一个都没动（craftingSystem / passChain / survivalBalance /
//     economyLoop 四个别人的测试钉死九条成本），本工单只修信息层。

function give(state: GameState, items: Array<[ItemId, number]>): void {
  for (const [id, n] of items) addItem(state.player.inventory, id, n);
}

function lootFloors(state: GameState, floors: number[]): void {
  for (const floor of floors) {
    const view = getFloorView(state, floor);
    for (const c of view.containers) lootContainer(state, floor, c.id);
    for (const g of view.groundItems) lootGround(state, floor, g.key);
  }
}

/** 搜光 tier 1（1-10 层）。背包临时放大只是把"12 格"这个变量移出诊断视野——
 *  真实局里背包压力另有两处钉死（survivalBalance / economyLoop），这里测的是
 *  "世界总供给够不够走完凭证链"，与背包上限无关。 */
function lootAllTier1(state: GameState): void {
  state.player.inventory.slotCount = 999;
  lootFloors(state, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
}

const CHAIN = ['work_badge', 'pass_sticker', 'permit', 'vip_card', 'core_key'] as const;

describe('诊断表：每条配方在 tier 1 材料下可否合成', () => {
  it('the guaranteed basket (F3+F4) builds exactly the three facilities, on every seed', () => {
    // survivalBalance 钉死的同一事实，从合成闭环角度复钉：3/4 层保底配额
    // （scrap 3 / wood 2 / tape 1 / battery 1 / wire 2 / filter 1 / fuse 1 /
    // cloth 1 / crowbar 1）恰好只够灯+门+净水器，第四件开始就是取舍。
    for (const seed of [1, 42, 2026, 7, 99, 1234, 55555, 987654]) {
      const s = createNewGame(seed);
      lootFloors(s, [3, 4]);
      const built: string[] = [];
      for (const r of RECIPES) if (craft(s, r.id).ok) built.push(r.id);
      expect(built, `seed ${seed}`).toEqual(['lamp', 'reinforced_door', 'purifier']);
    }
  });

  it('before anything is built, the basket leaves rack and badge craftable — the choice is the design', () => {
    // 诊断表的第一行：保底配额同时喂得下灯/门/净水器/置物架/工牌（总量刚好），
    // 但建起来就互相吃光（上一条测试钉死"只能建三件"）——先建什么真是一个选择。
    const s = createNewGame(1);
    lootFloors(s, [3, 4]);
    for (const id of ['lamp', 'reinforced_door', 'purifier', 'storage_rack', 'work_badge'] as const) {
      expect(canCraft(s, id).ok, `${id} should be craftable from the untouched basket`).toBe(true);
    }
    // 而凭证链从第二级起连"缺料"都报不出来——前置资格先拦（passChain 语义）。
    for (const id of ['pass_sticker', 'permit', 'vip_card', 'core_key'] as const) {
      const check = canCraft(s, id);
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.reason).toContain(getRecipe(getRecipe(id).requires!).displayName);
    }
  });

  it('after the three facilities, rack and badge are refused naming the consumed material', () => {
    const s = createNewGame(1);
    lootFloors(s, [3, 4]);
    for (const id of ['lamp', 'reinforced_door', 'purifier'] as const) expect(craft(s, id).ok).toBe(true);
    // 置物架与门共享木材：木头归了门
    const rack = craft(s, 'storage_rack');
    expect(rack.ok).toBe(false);
    if (!rack.ok) expect(rack.reason).toContain('木材');
    // 工牌与灯+净水器共享废金属：scrap 恰好三块，一个不剩
    const badge = craft(s, 'work_badge');
    expect(badge.ok).toBe(false);
    if (!badge.ok) expect(badge.reason).toContain('废金属');
  });

  it('every chain material is obtainable somewhere in tier 1 — the break is quantity, not existence', () => {
    // 诊断表第二行：五张凭证的每一种料在 1-10 层都有出处（保底或概率），
    // 所以断裂从不是"某种材料 1F 拿不到"，而是保底配额被竞争吃光后，
    // 进阶需求量超过 tier 1 的总供给（下一条测试的 0/300）。
    const tier1 = new Set<ItemId>();
    for (const floor of PLAYABLE_FLOORS_V01.filter((f) => f < 100)) {
      const t = FLOOR_TEMPLATES[floor];
      for (const c of t.containers) for (const l of c.loot) tier1.add(l.itemId as ItemId);
      for (const g of t.ground) tier1.add(g.itemId);
    }
    for (const r of RECIPES) {
      for (const id of Object.keys(r.cost) as ItemId[]) {
        expect(tier1.has(id), `${r.id} 的 ${id} 在 1-10 层没有出处`).toBe(true);
      }
    }
  });

  it('the credential chain is NOT completable from tier 1 alone — climbing is the real source', () => {
    // 诊断表的量化钉桩（300 种子全清 1-10 层、背包移出视野）：
    //   设施三件 300/300；工牌 195/300；通行贴 11/300；许可证以上 0/300。
    // "爬高才能做好东西"因此是供给事实：上链凭证必须去 100+ 拿更稳的进阶料。
    let badge = 0;
    let sticker = 0;
    let permitOrAbove = 0;
    const SEEDS = 40;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = createNewGame(seed);
      lootAllTier1(s);
      const built: string[] = [];
      for (const r of RECIPES) if (craft(s, r.id).ok) built.push(r.id);
      if (built.includes('work_badge')) badge++;
      if (built.includes('pass_sticker')) sticker++;
      if (built.some((id) => ['permit', 'vip_card', 'core_key'].includes(id))) permitOrAbove++;
      // 硬断言：任何种子都不可能只在 tier 1 内走完凭证链
      expect(built, `seed ${seed} 在 tier 1 内走完了凭证链`).not.toContain('core_key');
    }
    expect(permitOrAbove).toBe(0);
    expect(badge).toBeGreaterThan(0); // 工牌通常是够的——第一级门不是墙
    expect(sticker).toBeLessThan(badge); // 但从第二级起，tier 1 的供给开始不够
  });
});

describe('缺料提示：缺什么，去哪拿', () => {
  it('the refusal names the material, the have/need, and where to get it', () => {
    const s = createNewGame(1);
    give(s, [['battery', 1]]); // lamp 还差 wire 与 scrap
    const r = craft(s, 'lamp');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // 只列缺的：电池已经够了，不出现在缺料信息里
      expect(r.reason).not.toContain('电池');
      expect(r.reason).toContain('电线');
      expect(r.reason).toContain('0/1');
      expect(r.reason).toContain('废金属');
      // 去哪拿：出处提示带着楼层号（数据源是 MATERIAL_SOURCES）
      expect(r.reason).toContain('4层电箱'); // wire 保底
      expect(r.reason).toContain('3层铁箱'); // scrap 保底
      expect(r.reason).toContain('100层以上'); // 高层梯度：真实路径而非文案
    }
    expect(hasUpgrade(s, 'lamp')).toBe(false);
    expect(countItem(s.player.inventory, 'battery')).toBe(1); // 原子：不扣
  });

  it('canCraft carries the same hints without touching the missing array shape', () => {
    // missing 的形状不变（craftingSystem.test.ts 的 toContainEqual 钉死），
    // "去哪拿"走新增的可选 hints 字段。
    const s = createNewGame(1);
    const r = canCraft(s, 'lamp');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing).toContainEqual({ itemId: 'battery', need: 1, have: 0 });
      expect(r.hints).toBeDefined();
      expect(r.hints!.length).toBe(3);
      expect(r.hints!.join('\n')).toContain('电池');
      expect(r.hints!.join('\n')).toContain('3层');
    }
  });

  it('a missing prerequisite is still reported as the gate, never as a materials hint', () => {
    const s = createNewGame(1);
    const r = craft(s, 'pass_sticker');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('工牌');
      expect(r.reason).not.toContain('材料不足');
      expect(r.reason).not.toContain('层');
    }
  });

  it('every recipe material has a source hint, and every hint names a floor', () => {
    for (const r of RECIPES) {
      for (const id of Object.keys(r.cost) as ItemId[]) {
        expect(MATERIAL_SOURCES[id], `${r.id} 的 ${id} 没有出处`).toBeDefined();
        const hint = materialSourceHint(id);
        expect(hint, `${id} 的出处提示为空`).toBeTruthy();
        expect(hint!).toMatch(/\d+层|商人/);
      }
    }
  });
});

describe('tier 门禁：档位可见，但不拦建造', () => {
  it('tier 2+ recipes read as locked at power level 1, facilities do not', () => {
    const s = createNewGame(1);
    for (const id of ['lamp', 'reinforced_door', 'purifier', 'storage_rack'] as const) {
      expect(recipeTierLocked(s, id), `${id} 不该被档位锁`).toBe(false);
    }
    for (const id of CHAIN) {
      expect(recipeTierLocked(s, id), `${id} 应被档位锁（tier ${getRecipe(id).tier} > 权力线 1）`).toBe(true);
    }
  });

  it('the tier note says which rung the power line has not reached', () => {
    const s = createNewGame(1);
    expect(recipeTierNote(s, 'lamp')).toBe('档位 1');
    expect(recipeTierNote(s, 'work_badge')).toBe('档位 2｜权力线 1 级未达');
    expect(recipeTierNote(s, 'core_key')).toBe('档位 6｜权力线 1 级未达');
  });

  it('the whole chain lifts the power line to tier 6, and every note opens', () => {
    // 凭证链是权力线的唯一生产者：五级全走完 = 1500 XP = 6 级（xpToNext 累计），
    // 档位读数随之全部解锁——"爬梯子"的结果而不是准入门槛。
    const s = createNewGame(1);
    give(s, [['scrap_metal', 3], ['cloth', 4], ['tape', 2], ['wire', 4], ['battery', 4], ['filter', 1], ['fuse', 1]]);
    for (const id of CHAIN) expect(craft(s, id).ok).toBe(true);
    expect(s.growth?.power.level).toBe(6);
    for (const id of CHAIN) {
      expect(recipeTierLocked(s, id), `${id} 在全链后仍被锁`).toBe(false);
      expect(recipeTierNote(s, id)).toBe(`档位 ${getRecipe(id).tier}`);
    }
  });

  it('the tier is informational: a locked recipe still crafts when the materials are there', () => {
    // economyLoop 钉死的同一语义，从闭环角度复钉：档位锁 + 材料齐 = 照建，
    // 权力线冷启动不会把第一张凭证变成永远造不出。
    const s = createNewGame(1);
    give(s, [['scrap_metal', 1], ['cloth', 1], ['tape', 1]]);
    expect(recipeTierLocked(s, 'work_badge')).toBe(true);
    const preview = recipePreview(s, 'work_badge');
    expect(preview.tierLocked).toBe(true);
    expect(preview.canCraft).toBe(true);
    expect(craft(s, 'work_badge').ok).toBe(true);
  });
});

describe('survivalBalance 硬边界未被破坏', () => {
  it('the guaranteed basket is still exactly scrap 3 / wood 2 / tape 1 / fuse 1 / filter 1 / wire 2', () => {
    const s = createNewGame(1);
    lootFloors(s, [3, 4]);
    expect(countItem(s.player.inventory, 'scrap_metal')).toBe(3);
    expect(countItem(s.player.inventory, 'wood')).toBe(2);
    expect(countItem(s.player.inventory, 'tape')).toBe(1);
    expect(countItem(s.player.inventory, 'fuse')).toBe(1);
    expect(countItem(s.player.inventory, 'filter')).toBe(1);
    expect(countItem(s.player.inventory, 'wire')).toBe(2);
  });

  it('no recipe needs a material that only ever appears in a probability roll', () => {
    // survivalBalance audit D1 的复钉：配方材料的确定性路径没被本工单动摇
    // （本工单只加提示字段与预览函数，成本与世界数据零改动）。
    const guaranteed = new Set<ItemId>();
    for (const floor of PLAYABLE_FLOORS_V01) {
      const t = FLOOR_TEMPLATES[floor];
      for (const c of t.containers) for (const l of c.loot) if (l.guaranteed) guaranteed.add(l.itemId as ItemId);
      for (const g of t.ground) guaranteed.add(g.itemId);
    }
    for (const r of RECIPES) {
      for (const id of Object.keys(r.cost) as ItemId[]) {
        expect(guaranteed.has(id), `${r.id} 的 ${id} 只有概率来源`).toBe(true);
      }
    }
  });
});

describe('同 seed 同材料同结果', () => {
  it('two identical runs loot, craft and refuse identically', () => {
    const run = (): { slots: unknown; upgrades: unknown; refusal: string } => {
      const s = createNewGame(2026);
      lootFloors(s, [3, 4]);
      craft(s, 'lamp');
      const refusal = craft(s, 'work_badge');
      return {
        slots: JSON.parse(JSON.stringify(s.player.inventory.slots)),
        upgrades: [...s.player.homeUpgrades],
        refusal: refusal.ok ? 'ok' : refusal.reason,
      };
    };
    expect(run()).toEqual(run());
  });

  it('recipePreview is pure data — same state, same preview', () => {
    const s = createNewGame(7);
    lootFloors(s, [3, 4]);
    expect(recipePreview(s, 'lamp')).toEqual(recipePreview(s, 'lamp'));
  });
});

describe('效果预览：按 Enter 之前就知道做出来会怎样', () => {
  it('every recipe carries an effect line, and credentials say which segment they open', () => {
    for (const r of RECIPES) {
      expect(r.effect.length, `${r.id} 没有效果预览`).toBeGreaterThan(0);
      expect(r.description.length).toBeGreaterThan(0);
    }
    // 凭证的效果必须写明开的段——"通行贴"与一块废金属的区别就在这一句
    expect(getRecipe('work_badge').effect).toContain('100-110');
    expect(getRecipe('pass_sticker').effect).toContain('1000-1010');
    expect(getRecipe('permit').effect).toContain('10000-10010');
    expect(getRecipe('vip_card').effect).toContain('50000-50010');
    expect(getRecipe('core_key').effect).toContain('100000');
    expect(getRecipe('storage_rack').effect).toContain('14');
  });

  it('the preview reports have/need per material and the source hint', () => {
    const s = createNewGame(1);
    give(s, [['battery', 2], ['wire', 1]]);
    const p = recipePreview(s, 'lamp');
    expect(p.displayName).toBe('照明灯');
    expect(p.canCraft).toBe(false); // 缺 scrap
    expect(p.cost).toEqual([
      { itemId: 'battery', displayName: '电池', need: 1, have: 2, source: materialSourceHint('battery') },
      { itemId: 'wire', displayName: '电线', need: 1, have: 1, source: materialSourceHint('wire') },
      { itemId: 'scrap_metal', displayName: '废金属', need: 1, have: 0, source: materialSourceHint('scrap_metal') },
    ]);
    expect(p.missing).toEqual([{ itemId: 'scrap_metal', need: 1, have: 0 }]);
    expect(p.hints!.join()).toContain('废金属');
    expect(p.tierNote).toBe('档位 1');
    expect(p.built).toBe(false);
  });

  it('the preview tracks the prerequisite and the built flag', () => {
    const s = createNewGame(1);
    give(s, [['scrap_metal', 3], ['cloth', 4], ['tape', 2], ['wire', 4], ['battery', 4], ['filter', 1], ['fuse', 1]]);
    const locked = recipePreview(s, 'pass_sticker');
    expect(locked.requires).toEqual({ id: 'work_badge', displayName: '工牌', met: false });
    expect(locked.canCraft).toBe(false);
    expect(craft(s, 'work_badge').ok).toBe(true);
    const open = recipePreview(s, 'pass_sticker');
    expect(open.requires!.met).toBe(true);
    expect(open.canCraft).toBe(true);
    expect(craft(s, 'pass_sticker').ok).toBe(true);
    expect(recipePreview(s, 'pass_sticker').built).toBe(true);
  });
});
