import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { addItem, countItem } from '../systems/InventorySystem';
import {
  canCraft,
  craft,
  hasUpgrade,
  nightOverlayAlpha,
  purifyWater,
  DARK_NIGHT_ALPHA,
  LAMP_NIGHT_ALPHA,
} from '../systems/CraftingSystem';
import type { GameState, ItemId } from '../core/gameTypes';

function give(state: GameState, items: Array<[ItemId, number]>): void {
  for (const [id, n] of items) addItem(state.player.inventory, id, n);
}

describe('canCraft', () => {
  it('passes when all materials are present', () => {
    const s = createNewGame(1);
    give(s, [['wood', 2], ['tape', 1]]);
    expect(canCraft(s, 'reinforced_door').ok).toBe(true);
  });

  it('reports each missing material', () => {
    const s = createNewGame(1);
    give(s, [['wood', 1]]);
    const r = canCraft(s, 'reinforced_door');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing).toContainEqual({ itemId: 'wood', need: 2, have: 1 });
      expect(r.missing).toContainEqual({ itemId: 'tape', need: 1, have: 0 });
    }
  });
});

describe('craft', () => {
  it('deducts materials and records the upgrade', () => {
    const s = createNewGame(1);
    give(s, [['battery', 1], ['wire', 1], ['scrap_metal', 1]]);
    expect(craft(s, 'lamp').ok).toBe(true);
    expect(hasUpgrade(s, 'lamp')).toBe(true);
    expect(countItem(s.player.inventory, 'battery')).toBe(0);
    expect(countItem(s.player.inventory, 'wire')).toBe(0);
    expect(countItem(s.player.inventory, 'scrap_metal')).toBe(0);
  });

  it('refuses and does NOT deduct when materials are short', () => {
    const s = createNewGame(1);
    give(s, [['battery', 1], ['wire', 1]]); // missing scrap_metal
    const r = craft(s, 'lamp');
    expect(r.ok).toBe(false);
    expect(hasUpgrade(s, 'lamp')).toBe(false);
    expect(countItem(s.player.inventory, 'battery')).toBe(1);
    expect(countItem(s.player.inventory, 'wire')).toBe(1);
  });

  it('refuses to build the same upgrade twice', () => {
    const s = createNewGame(1);
    give(s, [['wood', 2], ['tape', 1], ['wood', 2], ['tape', 1]]);
    expect(craft(s, 'reinforced_door').ok).toBe(true);
    expect(craft(s, 'reinforced_door').ok).toBe(false);
  });
});

describe('purifyWater', () => {
  // B3-01: batch rather than one bottle at a time. The audit found 小周 trades
  // 1 脏水 for 1 净水 for free and repeatedly, so a single-bottle purifier was
  // strictly redundant. Converting the whole carry is the thing the NPC will not
  // do, which is what makes the upgrade worth its materials.
  it('converts the whole carry of dirty water in one use', () => {
    const s = createNewGame(1);
    s.player.homeUpgrades.push('purifier');
    give(s, [['dirty_water', 3]]);
    const cleanBefore = countItem(s.player.inventory, 'clean_water');
    const r = purifyWater(s);
    expect(r.ok).toBe(true);
    expect(countItem(s.player.inventory, 'dirty_water')).toBe(0);
    expect(countItem(s.player.inventory, 'clean_water')).toBe(cleanBefore + 3);
  });

  it('refuses without the purifier', () => {
    const s = createNewGame(1);
    give(s, [['dirty_water', 1]]);
    expect(purifyWater(s).ok).toBe(false);
    expect(countItem(s.player.inventory, 'dirty_water')).toBe(1);
  });

  it('refuses without dirty water', () => {
    const s = createNewGame(1);
    s.player.homeUpgrades.push('purifier');
    expect(purifyWater(s).ok).toBe(false);
  });
});

describe('nightOverlayAlpha (lamp lighting)', () => {
  it('is 0 during the day', () => {
    const s = createNewGame(1);
    s.gameMinuteOfDay = 720;
    expect(nightOverlayAlpha(s)).toBe(0);
  });

  it('is dark at night without the lamp', () => {
    const s = createNewGame(1);
    s.gameMinuteOfDay = 1320;
    expect(nightOverlayAlpha(s)).toBe(DARK_NIGHT_ALPHA);
  });

  it('is lit at night in the dorm with the lamp', () => {
    const s = createNewGame(1);
    s.player.homeUpgrades.push('lamp');
    s.gameMinuteOfDay = 1320;
    expect(nightOverlayAlpha(s)).toBe(LAMP_NIGHT_ALPHA);
    expect(nightOverlayAlpha(s)).toBeLessThan(DARK_NIGHT_ALPHA);
  });

  it('the lamp does not light other floors', () => {
    const s = createNewGame(1);
    s.player.homeUpgrades.push('lamp');
    s.currentFloor = 3;
    s.gameMinuteOfDay = 1320;
    expect(nightOverlayAlpha(s)).toBe(DARK_NIGHT_ALPHA);
  });
});
