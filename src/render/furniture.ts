// Container id -> furniture texture key.
//
// The textures come from the art pack (see FURNITURE_FILES in render/artpack.ts);
// the procedural drawers that used to bake them are gone. Every container in the
// world now has matching art, so there is no Graphics-box fallback left to draw —
// a container with no key would be invisible, which is why the mapping test
// asserts the full table rather than allowing gaps.
export const FURNITURE_KEYS = [
  'furn_bed',
  'furn_cabinet',
  'furn_crate_wood',
  'furn_crate_metal',
  'furn_workbench',
  'furn_watertank',
  'furn_fusebox',
  'furn_shelf',
  'furn_counter',
] as const;

export type FurnitureKey = (typeof FURNITURE_KEYS)[number];

export function containerTextureKey(containerId: string): FurnitureKey | null {
  switch (containerId) {
    case 'cabinet':
      return 'furn_cabinet';
    case 'shelf':
    case 'pantry': // 补给架 is a shelf
      return 'furn_shelf';
    // The two crates used to share one texture. They do not any more: a wooden
    // crate and a military crate look nothing alike, and telling them apart is
    // half of what makes floor 3 read as a place.
    case 'crate_wood':
      return 'furn_crate_wood';
    case 'crate_metal':
      return 'furn_crate_metal';
    case 'fuse_box':
      return 'furn_fusebox';
    case 'water_tank':
      return 'furn_watertank';
    case 'counter':
      return 'furn_counter';
    default:
      return null;
  }
}
