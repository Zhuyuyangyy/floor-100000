import type { ItemId } from '../core/gameTypes';

// Texture key for an item's icon.
//
// This is the identity function, and that is the point: BootScene loads each
// icon from the art pack under its own item id (see render/artpack.ts for which
// file), so every call site can ask for an icon by item id without knowing where
// the art lives. Kept explicit rather than inlined so the invariant has one home
// and one test, and so a future rename cannot desync a display name from its
// texture key. Deliberately free of any Phaser import so it stays unit-testable
// in the node environment.
export function itemIconKey(itemId: ItemId): string {
  return itemId;
}
