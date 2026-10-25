import { describe, expect, it } from 'vitest';
import { createInventory, createNewGame } from '../core/gameState';
import { addItem, countItem, removeItem, useConsumable } from '../systems/InventorySystem';

describe('addItem stacking & full-bag', () => {
  it('stacks identical ids into one slot', () => {
    const inv = createInventory(12);
    addItem(inv, 'wood', 5);
    addItem(inv, 'wood', 3);
    expect(countItem(inv, 'wood')).toBe(8);
    expect(inv.slots).toHaveLength(1);
  });

  it('reports overflow without losing or swallowing items', () => {
    const inv = createInventory(2);
    addItem(inv, 'flashlight', 1);
    addItem(inv, 'crowbar', 1);
    const r = addItem(inv, 'wood', 4);
    expect(r).toEqual({ added: 0, overflow: 4 });
    expect(inv.slots).toHaveLength(2); // nothing swallowed, nothing lost
    expect(countItem(inv, 'wood')).toBe(0);
  });

  it('fills a partial stack to maxStack then spills to a new slot', () => {
    const inv = createInventory(5);
    addItem(inv, 'wood', 98);
    addItem(inv, 'wood', 5); // 1 fits to 99, remaining 4 -> new slot
    expect(countItem(inv, 'wood')).toBe(103);
    expect(inv.slots).toHaveLength(2);
  });
});

describe('removeItem', () => {
  it('removes quantity and deletes emptied slots', () => {
    const inv = createInventory(5);
    addItem(inv, 'ration_pack', 2);
    expect(removeItem(inv, 'ration_pack', 1)).toBe(1);
    expect(inv.slots[0].quantity).toBe(1);
    removeItem(inv, 'ration_pack', 1);
    expect(inv.slots).toHaveLength(0);
  });
});

describe('useConsumable', () => {
  it('restores thirst from clean_water, clamps to max, consumes one', () => {
    const s = createNewGame(1);
    s.player.thirst = 85;
    const r = useConsumable(s, 'clean_water');
    expect(r.ok).toBe(true);
    expect(s.player.thirst).toBe(100);
    expect(r.amount).toBe(15);
    expect(countItem(s.player.inventory, 'clean_water')).toBe(2);
  });

  it('restores hunger from ration_pack', () => {
    const s = createNewGame(1);
    s.player.hunger = 60;
    const r = useConsumable(s, 'ration_pack');
    expect(s.player.hunger).toBe(90);
    expect(r.stat).toBe('hunger');
  });

  it('restores hp from medkit', () => {
    const s = createNewGame(1);
    addItem(s.player.inventory, 'medkit', 1);
    s.player.hp = 50;
    const r = useConsumable(s, 'medkit');
    expect(s.player.hp).toBe(90);
    expect(r.stat).toBe('hp');
  });

  it('never overflows a stat (boundary)', () => {
    const s = createNewGame(1);
    s.player.thirst = 100;
    const r = useConsumable(s, 'clean_water');
    expect(s.player.thirst).toBe(100);
    expect(r.amount).toBe(0);
  });

  it('rejects non-consumables (failure path)', () => {
    const s = createNewGame(1);
    addItem(s.player.inventory, 'wood', 1);
    expect(useConsumable(s, 'wood').ok).toBe(false);
  });

  it('rejects when the item is not carried', () => {
    const s = createNewGame(1);
    const r = useConsumable(s, 'medkit');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('没有');
  });
});
