import type { FurnitureKey } from './furniture';
import type { ItemId } from '../core/gameTypes';

// Which file in public/assets/artpack holds each item's icon.
//
// Explicit rather than derived from ITEM_IDS' key order: the icons come from a
// sheet whose reading order happens to match today, and reordering ITEMS would
// silently swap every icon with no test failing. A Record<ItemId, string> makes
// a missing icon a compile error instead.
//
// Produced by tools/build-artpack.mjs from 05_物品图标.png.
export const ITEM_ICON_FILES: Record<ItemId, string> = {
  clean_water: 'item-clean_water.png',
  dirty_water: 'item-dirty_water.png',
  ration_pack: 'item-ration_pack.png',
  bread: 'item-bread.png',
  medkit: 'item-medkit.png',
  battery: 'item-battery.png',
  scrap_metal: 'item-scrap_metal.png',
  wood: 'item-wood.png',
  cloth: 'item-cloth.png',
  tape: 'item-tape.png',
  filter: 'item-filter.png',
  wire: 'item-wire.png',
  fuse: 'item-fuse.png',
  crowbar: 'item-crowbar.png',
  flashlight: 'item-flashlight.png',
};

// Texture keys for the rest of the pack, so a rename has one home.
export const ART_SLOT_KEY = 'ui-slot';
export const ART_BANNER_WIN_KEY = 'art-banner-win';
export const ART_BANNER_LOSE_KEY = 'art-banner-lose';

// Which file holds each furniture texture. The seven procedural drawers in
// pixelArt.ts used to own these; they are gone now, so this is the only list.
//
// Every prop is scaled to a common standing height by tools/build-artpack.mjs
// rather than used at its native 100-220px — a 228px wardrobe would run off the
// top of a wall whose usable band is ~150px, and a scene where one prop is twice
// the height of the next reads as pasted stickers.
export const FURNITURE_FILES: Record<FurnitureKey, string> = {
  furn_bed: 'furn-bed.png',
  furn_cabinet: 'furn-cabinet.png',
  furn_crate_wood: 'furn-crate_wood.png',
  furn_crate_metal: 'furn-crate_metal.png',
  furn_workbench: 'furn-workbench.png',
  furn_watertank: 'furn-watertank.png',
  furn_fusebox: 'furn-fusebox.png',
  furn_shelf: 'furn-shelf.png',
  furn_counter: 'furn-counter.png',
};
