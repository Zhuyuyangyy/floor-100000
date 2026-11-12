import { describe, expect, it } from 'vitest';
import { ITEM_ICON_FILES } from '../render/artpack';

// Pin the reviewed id-to-file pairing independently of ITEM_IDS order and of
// the fact that the current filenames happen to contain their item ids.
// File existence, dimensions, and complete coverage are checked separately in
// itemIcons.test.ts; this guards against a valid file being assigned to the
// wrong item.
const EXPECTED_ITEM_ICON_FILES = {
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
} as const;

describe('item icon mapping stability', () => {
  it('keeps each current item id paired with its reviewed art-pack filename', () => {
    expect(ITEM_ICON_FILES).toEqual(EXPECTED_ITEM_ICON_FILES);
  });
});
