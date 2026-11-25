import { describe, expect, it } from 'vitest';
import { createInventory, createNewGame } from '../core/gameState';
import { addItem, countItem, isBagFull, removeItem, useConsumable } from '../systems/InventorySystem';

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

// B3-02 §4.2: looting a container into a full bag leaves the stack in place and
// reports `full`, which is correct — but the player was told once, for 1.6
// seconds. The HUD now keeps the state on screen until a slot frees up, so the
// predicate has to be a real rule rather than a scene-local guess.
describe('isBagFull', () => {
  it('is false while a slot is free', () => {
    const inv = createInventory(3);
    addItem(inv, 'wood', 1);
    addItem(inv, 'tape', 1);
    expect(isBagFull(inv)).toBe(false);
  });

  it('is true exactly when every slot is occupied', () => {
    const inv = createInventory(2);
    addItem(inv, 'wood', 1);
    expect(isBagFull(inv)).toBe(false);
    addItem(inv, 'tape', 1);
    expect(isBagFull(inv)).toBe(true);
  });

  it('does not care how full a stack is, only how many slots it uses', () => {
    const inv = createInventory(1);
    addItem(inv, 'wood', 99); // maxStack, still one slot
    expect(isBagFull(inv)).toBe(true);
  });

  it('turns false again once a stack is consumed or spent', () => {
    const s = createNewGame(1);
    const inv = s.player.inventory;
    inv.slots = []; // drop the starting kit so the count is ours to control
    inv.slotCount = 1;
    addItem(inv, 'clean_water', 1);
    expect(isBagFull(inv)).toBe(true);
    useConsumable(s, 'clean_water');
    expect(isBagFull(inv)).toBe(false);
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

// B3-05.1: a capped stat used to still consume the item. The M1 playtest drank
// three bottles at 80 thirst and gained 20 points — the first bottle was clamped
// from +30 to +10, the next two did nothing — burning 70 thirst points, about 1.2
// days of survival in a chapter whose whole water margin is 0.7 days. The item
// now stays in the bag when it would achieve nothing.
describe('useConsumable refuses a wasted item (B3-05.1)', () => {
  it('does not consume the item when the stat is already at max', () => {
    const s = createNewGame(1);
    s.player.thirst = 100;
    const before = countItem(s.player.inventory, 'clean_water');
    const r = useConsumable(s, 'clean_water');
    expect(r.ok).toBe(false);
    expect(r.amount).toBeUndefined();
    expect(countItem(s.player.inventory, 'clean_water')).toBe(before);
    expect(s.player.thirst).toBe(100);
  });

  it('names the stat, so the refusal reads as a reason rather than a dead key', () => {
    const s = createNewGame(1);
    addItem(s.player.inventory, 'medkit', 1);
    s.player.hp = 100;
    const r = useConsumable(s, 'medkit');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('生命');
    expect(r.reason).toContain('医疗包');
  });

  it('still consumes below max, even when the effect is only partly clamped', () => {
    // 85 + 30 lands on 100, so 15 of the 30 is wasted. That is a real (if small)
    // loss the player chose; only a wholly wasted item is refused.
    const s = createNewGame(1);
    s.player.thirst = 85;
    const r = useConsumable(s, 'clean_water');
    expect(r.ok).toBe(true);
    expect(r.amount).toBe(15);
    expect(countItem(s.player.inventory, 'clean_water')).toBe(2);
  });

  it('applies to every stat an item can restore, not just thirst', () => {
    const s = createNewGame(1);
    s.player.hunger = 100;
    s.player.energy = 100;
    addItem(s.player.inventory, 'ration_pack', 1);
    const rations = countItem(s.player.inventory, 'ration_pack');
    expect(useConsumable(s, 'ration_pack').ok).toBe(false);
    expect(countItem(s.player.inventory, 'ration_pack')).toBe(rations);
    expect(s.player.hunger).toBe(100);
  });

  it('leaves the other stats alone when it refuses', () => {
    const s = createNewGame(1);
    s.player.thirst = 100;
    s.player.hunger = 40;
    const before = { hunger: s.player.hunger, energy: s.player.energy, hp: s.player.hp };
    useConsumable(s, 'clean_water');
    expect(s.player.hunger).toBe(before.hunger);
    expect(s.player.energy).toBe(before.energy);
    expect(s.player.hp).toBe(before.hp);
  });
});
