import { RECIPES, getRecipe, isPassUpgrade, materialSourceHint, type UpgradeId } from '../data/recipes';
import { addItem, countItem, removeItem } from './InventorySystem';
import { isNight } from './SurvivalSystem';
import { STARTING_FLOOR } from '../core/constants';
import { getItem } from '../data/items';
import { credentialRungs, ensureGrowth, grantGrowthXp, recipeAccessTier } from '../core/growth';
import type { GameState, ItemId } from '../core/gameTypes';

// Dorm crafting & upgrades (docs/03_TASKS.md#p0-05). Pure rules; Phaser only
// renders the workbench and feeds the craft/purify commands.

export function hasUpgrade(state: GameState, id: UpgradeId): boolean {
  return state.player.homeUpgrades.includes(id);
}

// B5: how many bag slots the storage_rack adds. The effect is a real capacity
// change, not a flag: craft() bumps inventory.slotCount by this much, and every
// existing capacity reader (addItem's own loop, isBagFull, lootContainer's
// overflow check, shop.buy) reads that field, so none of them needed a new
// signature to honour the upgrade. 12 -> 14 is +16.7% carry — enough that a
// return trip from the material floors stops dropping the sixth stack.
export const STORAGE_RACK_SLOTS = 2;

// The recipe's design tier (data/recipes.ts) against the power line's
// recipeAccessTier. This is the registered consumer of growth.ts's tier
// function — it reports the lock, and nothing else.
//
// It deliberately does NOT gate canCraft/craft. Two reasons:
// 1. A gate would soft-lock the pass chain: power starts at level 1, so a
//    power>=2 gate on work_badge would make the first credential uncraftable
//    forever — power XP only comes from crafting credentials (chicken-and-egg).
//    GAME_DESIGN_LOCK.md §5 forbids soft-locks on progression resources.
// 2. passChain.test.ts pins the opposite semantics: with every material in
//    hand, the whole chain must be buildable in order. The gate is not that
//    test's to rewrite.
// The field and this reader exist so the tier data is real and wired the day
// the lead wants to open the gate (with a power XP source that does not depend
// on the gate).
export function recipeTierLocked(state: GameState, id: UpgradeId): boolean {
  const tier = getRecipe(id).tier;
  if (tier === undefined) return false;
  return recipeAccessTier(ensureGrowth(state)) < tier;
}

/**
 * AG-42：配方的档位读数——"这条配方属于第几档、权力线现在到没到"。
 *
 * 修前：recipeTierLocked 只有 economyLoop.test.ts 一个调用方，档位信息不出现在
 * 任何玩家可见的面板上，"凭证链按档位分层"因此是纸面设计。本函数把档位与
 * 权力线现状合成一句可渲染的文本（未达档位时明确说"未达"），供制作面板的
 * 行尾/详情行显示；scene 归 AG-11，这里只发数据。
 *
 * 注意它**不改变门禁语义**：craft/canCraft 依旧不因档位拒绝（冷启动软锁 +
 * passChain"材料齐全必可建"两条既有约束钉死，economyLoop.test.ts 有断言），
 * 档位是给玩家看的进度感，不是准入。
 */
export function recipeTierNote(state: GameState, id: UpgradeId): string | undefined {
  const tier = getRecipe(id).tier;
  if (tier === undefined) return undefined;
  const access = recipeAccessTier(ensureGrowth(state));
  return access >= tier ? `档位 ${tier}` : `档位 ${tier}｜权力线 ${access} 级未达`;
}

export interface RecipeCostView {
  itemId: ItemId;
  displayName: string;
  need: number;
  have: number;
  /** 该材料的"去哪拿"（MATERIAL_SOURCES），没有出处则缺省。 */
  source?: string;
}

export interface RecipePreview {
  id: UpgradeId;
  displayName: string;
  /** 效果预览（recipes.ts 的 effect 字段）：做出来会怎样。 */
  effect: string;
  description: string;
  cost: RecipeCostView[];
  requires?: { id: UpgradeId; displayName: string; met: boolean };
  tier?: number;
  /** 权力线未达到配方档位时为 true（ informational，不拦截建造）。 */
  tierLocked: boolean;
  tierNote?: string;
  built: boolean;
  canCraft: boolean;
  missing: MissingMaterial[];
  hints?: string[];
}

/**
 * AG-42：制作面板一行的完整数据——名称、效果预览、逐项成本（持有/需求/
 * 出处）、前置、档位、可制作性。修前面板只有 名称+材料 两列，玩家在按
 * Enter 前看不到"做出来会怎样"（effect）、"这条属于更高档位"（tierNote）、
 * "差的料去哪拿"（cost.source/hints）。GameScene 的 buildCraftPanel 归
 * AG-11；本函数把三样新信息打包成它可以直接渲染的形状。
 */
export function recipePreview(state: GameState, id: UpgradeId): RecipePreview {
  const recipe = getRecipe(id);
  const check = canCraft(state, id);
  const cost: RecipeCostView[] = (Object.entries(recipe.cost) as Array<[ItemId, number]>).map(([itemId, need]) => ({
    itemId,
    displayName: getItem(itemId).displayName,
    need,
    have: countItem(state.player.inventory, itemId),
    source: materialSourceHint(itemId),
  }));
  const requires = recipe.requires
    ? { id: recipe.requires, displayName: getRecipe(recipe.requires).displayName, met: hasUpgrade(state, recipe.requires) }
    : undefined;
  return {
    id,
    displayName: recipe.displayName,
    effect: recipe.effect,
    description: recipe.description,
    cost,
    requires,
    tier: recipe.tier,
    tierLocked: recipeTierLocked(state, id),
    tierNote: recipeTierNote(state, id),
    built: hasUpgrade(state, id),
    canCraft: check.ok,
    missing: check.ok ? [] : check.missing,
    hints: check.ok ? undefined : check.hints,
  };
}

export interface MissingMaterial {
  itemId: ItemId;
  need: number;
  have: number;
}

export type CanCraftResult =
  | { ok: true }
  | { ok: false; missing: MissingMaterial[]; reason?: string; hints?: string[] };

export function canCraft(state: GameState, id: UpgradeId): CanCraftResult {
  // 前置资格 is checked before materials: a gated recipe the player cannot walk up
  // to yet must say so, rather than report 材料不足 and send them gathering.
  const recipe = getRecipe(id);
  if (recipe.requires && !hasUpgrade(state, recipe.requires)) {
    return { ok: false, missing: [], reason: `需要先获得${getRecipe(recipe.requires).displayName}` };
  }
  const missing: MissingMaterial[] = [];
  for (const [itemId, need] of Object.entries(recipe.cost) as Array<[ItemId, number]>) {
    const have = countItem(state.player.inventory, itemId);
    if (have < need) missing.push({ itemId, need, have });
  }
  if (missing.length === 0) return { ok: true };
  // AG-42：缺料提示从"缺什么"补上"去哪拿"。上链凭证（通行贴起）的进阶料在
  // tier 1 内做不齐（craftLoop.test.ts 的种子扫描钉死 0/N），"去哪拿"因此
  // 不是文案而是真实路径指引；提示文本唯一来源是 recipes.ts 的
  // MATERIAL_SOURCES（数据与 floorTemplates/encounters 逐条对齐）。
  const hints = missing
    .map((m) => {
      const hint = materialSourceHint(m.itemId);
      return hint ? `${getItem(m.itemId).displayName}：${hint}` : undefined;
    })
    .filter((h): h is string => h !== undefined);
  return { ok: false, missing, hints: hints.length > 0 ? hints : undefined };
}

export type CraftResult = { ok: true; id: UpgradeId } | { ok: false; reason: string };

// Crafts an upgrade: refuses (no deduction) if already built or materials are
// short; otherwise deducts all materials atomically and records the upgrade.
export function craft(state: GameState, id: UpgradeId): CraftResult {
  const recipe = getRecipe(id);
  if (hasUpgrade(state, id)) return { ok: false, reason: `${recipe.displayName} 已建造` };
  const check = canCraft(state, id);
  if (!check.ok) {
    // A missing prerequisite must never be reported as (or bypassed by) a
    // material problem, so it short-circuits before the material detail.
    if (check.reason) return { ok: false, reason: check.reason };
    const detail = check.missing
      .map((m) => {
        const hint = materialSourceHint(m.itemId);
        return `${getItem(m.itemId).displayName} ${m.have}/${m.need}${hint ? `（${hint}）` : ''}`;
      })
      .join('，');
    return { ok: false, reason: `材料不足：${detail}` };
  }
  for (const [itemId, need] of Object.entries(recipe.cost) as Array<[ItemId, number]>) {
    removeItem(state.player.inventory, itemId, need);
  }
  state.player.homeUpgrades.push(id);
  // B5: the power line's producer is the credential chain — "拿到新凭证
  // +100×档位" (docs/plans/GROWTH_INTERFACES.md §5). Paid on the rung delta
  // (credentialRungs reads homeUpgrades, so it never double-counts), and only
  // for credentials: forging a badge is a political act, bolting a shelf to
  // the wall is not.
  if (isPassUpgrade(id)) {
    const rungs = credentialRungs(state.player.homeUpgrades);
    grantGrowthXp(state, 'power', 100 * rungs);
  }
  // B5: the storage_rack's effect lands here — a persistent capacity bump, so
  // the save file itself carries the bigger bag and every reader of
  // inventory.slotCount honours it without a signature change.
  if (id === 'storage_rack') {
    state.player.inventory.slotCount += STORAGE_RACK_SLOTS;
  }
  return { ok: true, id };
}

export type PurifyResult = { ok: true; converted: number } | { ok: false; reason: string };

// With the purifier built, convert the whole carry of 脏水 into 净水 in one use.
// Batch rather than one-at-a-time: the audit found a single-bottle conversion
// made the purifier redundant, because 小周 trades 1 脏水 for 1 净水 for free and
// repeatedly. Batch conversion is the thing the NPC does not do, so the upgrade
// earns its materials when the player comes back loaded instead of trickling.
export function purifyWater(state: GameState): PurifyResult {
  if (!hasUpgrade(state, 'purifier')) return { ok: false, reason: '尚未建造净水器' };
  const dirty = countItem(state.player.inventory, 'dirty_water');
  if (dirty < 1) return { ok: false, reason: '没有脏水' };
  removeItem(state.player.inventory, 'dirty_water', dirty);
  addItem(state.player.inventory, 'clean_water', dirty);
  return { ok: true, converted: dirty };
}

// Night lighting: the dorm lamp lights the dorm; a reinforced door seals the gaps
// in it; a blackout darkens other floors (a flashlight helps, and the alpha is
// capped so the screen is never fully black).
export const LAMP_NIGHT_ALPHA = 0.16;
// The audit found reinforced_door was a dead upgrade — nothing read it, so it
// cost materials and did nothing. It now seals the dorm against the dark, which
// is strictly weaker than the lamp so the two are not interchangeable.
export const REINFORCED_DOOR_NIGHT_ALPHA = 0.42;
export const DARK_NIGHT_ALPHA = 0.6;
export const BLACKOUT_LIT_ALPHA = 0.4;
export const BLACKOUT_DARK_ALPHA = 0.82;

export function nightOverlayAlpha(state: GameState): number {
  if (!isNight(state.gameMinuteOfDay)) return 0;
  const onDorm = state.currentFloor === STARTING_FLOOR;
  if (onDorm && hasUpgrade(state, 'lamp')) return LAMP_NIGHT_ALPHA;
  if (onDorm && hasUpgrade(state, 'reinforced_door')) return REINFORCED_DOOR_NIGHT_ALPHA;
  if (onDorm) return DARK_NIGHT_ALPHA; // the dorm is a safe zone
  if (state.worldEvents.activeEvent?.type === 'blackout') {
    return countItem(state.player.inventory, 'flashlight') > 0 ? BLACKOUT_LIT_ALPHA : BLACKOUT_DARK_ALPHA;
  }
  return DARK_NIGHT_ALPHA;
}

export { RECIPES };
