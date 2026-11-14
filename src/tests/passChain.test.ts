import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { addItem, countItem } from '../systems/InventorySystem';
import { canCraft, craft, hasUpgrade } from '../systems/CraftingSystem';
import { getRecipe } from '../data/recipes';
import type { GameState, ItemId } from '../core/gameTypes';

// 跨阶层通行凭证: 工牌 → 通行贴 → 许可证 → 贵宾卡 → 核心权限. Each rung is a
// one-off qualification in homeUpgrades, gated on the rung below it — not an item,
// so nothing here should ever land in the bag.

const CHAIN = ['work_badge', 'pass_sticker', 'permit', 'vip_card', 'core_key'] as const;

function give(state: GameState, items: Array<[ItemId, number]>): void {
  for (const [id, n] of items) addItem(state.player.inventory, id, n);
}

/** Enough of every material the whole chain needs, so only the gate can refuse. */
function giveChainMaterials(state: GameState): void {
  give(state, [
    ['scrap_metal', 3],
    ['cloth', 4],
    ['tape', 2],
    ['wire', 4],
    ['battery', 4],
    ['filter', 1],
    ['fuse', 1],
  ]);
}

describe('通行凭证的前置资格', () => {
  it('refuses a gated recipe from a fresh state, naming the missing 工牌', () => {
    const s = createNewGame(1);
    const r = canCraft(s, 'pass_sticker');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBeDefined();
      expect(r.reason).toContain('工牌');
      // Not a materials complaint: the gate is checked first, so nothing is
      // reported as missing even with an empty bag.
      expect(r.missing).toEqual([]);
    }
  });

  it('still refuses with every material in hand — the gate is not the cost', () => {
    const s = createNewGame(1);
    giveChainMaterials(s);
    expect(canCraft(s, 'pass_sticker').ok).toBe(false);
    const r = craft(s, 'pass_sticker');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('工牌');
    expect(hasUpgrade(s, 'pass_sticker')).toBe(false);
  });

  it('does not deduct materials when the gate refuses the craft', () => {
    const s = createNewGame(1);
    giveChainMaterials(s);
    const wireBefore = countItem(s.player.inventory, 'wire');
    const batteryBefore = countItem(s.player.inventory, 'battery');
    expect(craft(s, 'pass_sticker').ok).toBe(false);
    expect(countItem(s.player.inventory, 'wire')).toBe(wireBefore);
    expect(countItem(s.player.inventory, 'battery')).toBe(batteryBefore);
  });

  it('opens once the 工牌 is built', () => {
    const s = createNewGame(1);
    giveChainMaterials(s);
    expect(craft(s, 'work_badge').ok).toBe(true);
    expect(canCraft(s, 'pass_sticker').ok).toBe(true);
    expect(craft(s, 'pass_sticker').ok).toBe(true);
    expect(hasUpgrade(s, 'pass_sticker')).toBe(true);
  });

  it('walks the whole chain in order', () => {
    const s = createNewGame(1);
    giveChainMaterials(s);
    for (const id of CHAIN) {
      const r = craft(s, id);
      expect(r.ok, `${id} should be craftable once the rung below it exists`).toBe(true);
      expect(hasUpgrade(s, id)).toBe(true);
    }
    // and every rung is in the same list the save file round-trips
    for (const id of CHAIN) expect(s.player.homeUpgrades).toContain(id);
  });

  it('deducts exactly the recipe cost at each rung', () => {
    const s = createNewGame(1);
    giveChainMaterials(s);
    const materials: ItemId[] = ['scrap_metal', 'cloth', 'tape', 'wire', 'battery', 'filter', 'fuse'];
    const before = new Map(materials.map((id) => [id, countItem(s.player.inventory, id)]));
    for (const id of CHAIN) {
      expect(craft(s, id).ok).toBe(true);
      const cost = getRecipe(id).cost;
      for (const [itemId, need] of Object.entries(cost) as Array<[ItemId, number]>) {
        before.set(itemId, (before.get(itemId) ?? 0) - need);
      }
    }
    for (const id of materials) expect(countItem(s.player.inventory, id), `${id} 的扣除量不对`).toBe(before.get(id));
  });

  it('keeps the vouchers out of the bag — only homeUpgrades records them', () => {
    const s = createNewGame(1);
    giveChainMaterials(s);
    const slotsBefore = s.player.inventory.slots.length;
    for (const id of CHAIN) craft(s, id);
    // each craft removes materials, so the bag only shrinks or empties slots; it
    // must never gain a "凭证" stack
    expect(s.player.inventory.slots.length).toBeLessThanOrEqual(slotsBefore);
    for (const stack of s.player.inventory.slots) {
      expect(stack.itemId).not.toBe('work_badge');
      expect(stack.itemId).not.toBe('core_key');
    }
  });

  it('does not let a later rung be built before its own prerequisite', () => {
    const s = createNewGame(1);
    giveChainMaterials(s);
    const r = canCraft(s, 'core_key');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('贵宾卡');
    expect(hasUpgrade(s, 'core_key')).toBe(false);
  });

  it('leaves the old dorm upgrades ungated', () => {
    for (const id of ['lamp', 'reinforced_door', 'purifier'] as const) {
      expect(getRecipe(id).requires).toBeUndefined();
    }
  });
});
