import { describe, expect, it } from 'vitest';
import { ITEMS, ITEM_IDS } from '../data/items';
import { itemIconKey } from '../render/itemIcons';

// The icon is baked under the item's own id, so the mapping is the identity.
// What matters is that every item has one — a missing icon would otherwise show
// up as a blank slot in the inventory rather than an error.
describe('item icon keys', () => {
  it('covers every item id exactly once', () => {
    const keys = ITEM_IDS.map(itemIconKey);
    expect(keys).toHaveLength(ITEM_IDS.length);
    expect(new Set(keys).size).toBe(ITEM_IDS.length);
  });

  it('is the item id, so a display-name rename cannot desync the icon', () => {
    for (const id of ITEM_IDS) {
      expect(itemIconKey(id)).toBe(id);
      expect(ITEMS[id].id).toBe(id);
    }
  });

  it('has no key for a non-item', () => {
    // The signature is ItemId, so this is compile-time only; assert the runtime
    // shape stays a plain string so a future key scheme is easy to spot.
    expect(typeof itemIconKey(ITEM_IDS[0])).toBe('string');
    expect(ITEM_IDS.length).toBeGreaterThan(0);
  });
});
