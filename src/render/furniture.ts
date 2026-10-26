// Container id -> furniture texture key. The seven textures baked in
// pixelArt.ts are bed / cabinet / crate / workbench / watertank / fusebox /
// shelf; a container with no counterpart among them returns null and keeps its
// Graphics box rather than being given a lookalike.
export const FURNITURE_KEYS = [
  'furn_bed',
  'furn_cabinet',
  'furn_crate',
  'furn_workbench',
  'furn_watertank',
  'furn_fusebox',
  'furn_shelf',
] as const;

export function containerTextureKey(containerId: string): string | null {
  switch (containerId) {
    case 'cabinet':
      return 'furn_cabinet';
    case 'shelf':
    case 'pantry': // 补给架 is a shelf
      return 'furn_shelf';
    case 'crate_wood':
    case 'crate_metal':
      return 'furn_crate';
    case 'fuse_box':
      return 'furn_fusebox';
    case 'water_tank':
      return 'furn_watertank';
    default:
      // 餐台 (counter) has no matching asset — see furniture.test.ts.
      return null;
  }
}
