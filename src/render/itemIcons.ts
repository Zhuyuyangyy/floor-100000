import type { ItemId } from '../core/gameTypes';

// Texture key for an item's icon. pixelArt.ts bakes each icon under the item's
// own id, so this is the identity function — kept explicit so the invariant has
// one home and one test, and so a future rename cannot desync a display name
// from its texture key. Deliberately free of any Phaser import so it stays
// unit-testable in the node environment.
export function itemIconKey(itemId: ItemId): string {
  return itemId;
}
