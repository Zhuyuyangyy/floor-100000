import { describe, expect, it } from 'vitest';
import { ITEM_IDS, getItem, isItemId } from '../data/items';

describe('item table', () => {
  it('defines exactly the 15 v0.1 items with unique ids', () => {
    expect(ITEM_IDS).toHaveLength(15);
    expect(new Set(ITEM_IDS).size).toBe(15);
  });

  it('every item has a display name and sane stack config', () => {
    for (const id of ITEM_IDS) {
      const item = getItem(id);
      expect(item.id).toBe(id);
      expect(item.displayName.length).toBeGreaterThan(0);
      expect(item.maxStack).toBeGreaterThanOrEqual(1);
      if (!item.stackable) expect(item.maxStack).toBe(1);
    }
  });

  it('isItemId guards unknown ids', () => {
    expect(isItemId('clean_water')).toBe(true);
    expect(isItemId('unobtainium')).toBe(false);
  });
});
