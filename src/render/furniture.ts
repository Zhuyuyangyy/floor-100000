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
  // 工人宿舍区（100-110）。这批是独立道具，不和上面九张通用家具抢语义。
  'furn_badge_rack',
  'furn_bunk_bed',
  'furn_meal_counter',
  'furn_shift_locker',
  'furn_security_safe',
  'furn_worker_locker',
  'furn_ration_dispenser',
  'furn_shift_board',
  'furn_boot_rack',
  'furn_wash_sink',
  'furn_uniform_rack',
  'furn_tool_cage',
  'furn_thermos_rack',
  'furn_key_board',
] as const;

export type FurnitureKey = (typeof FURNITURE_KEYS)[number];

export function containerTextureKey(containerId: string): FurnitureKey | null {
  // Bunks are generated per floor (`bunk_1`, `bunk_2`, …), so the id is a
  // prefix rather than a fixed name: a 100000-storey dormitory has beds in it.
  if (containerId.startsWith('bunk')) return 'furn_bunk_bed';
  switch (containerId) {
    // `bed` is both a room fixture (the one you sleep in) and, from the 100-110
    // segment, a lootable container — a dorm bunk with someone's kit stuffed under
    // it. Same texture either way; the difference is which system owns it.
    case 'bed':
      return 'furn_bed';
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
    // 工人宿舍区（100-110）：一个容器 id 一个专属贴图，同层两个容器不再长得一样。
    // bunk_top / bunk_bottom 共用一张双层床：一间宿舍里上下铺本来就是同一件东西。
    case 'badge_rack':
      return 'furn_badge_rack';
    case 'bunk_bed':
    case 'bunk_top':
    case 'bunk_bottom':
      return 'furn_bunk_bed';
    case 'meal_counter':
      return 'furn_meal_counter';
    case 'shift_locker':
      return 'furn_shift_locker';
    case 'security_safe':
      return 'furn_security_safe';
    case 'worker_locker':
      return 'furn_worker_locker';
    case 'ration_dispenser':
      return 'furn_ration_dispenser';
    case 'shift_board':
      return 'furn_shift_board';
    case 'boot_rack':
      return 'furn_boot_rack';
    case 'wash_sink':
      return 'furn_wash_sink';
    case 'uniform_rack':
      return 'furn_uniform_rack';
    case 'tool_cage':
      return 'furn_tool_cage';
    case 'thermos_rack':
      return 'furn_thermos_rack';
    case 'key_board':
      return 'furn_key_board';
    // The worker dorm (100-110) stores things in beds and at workbenches, not
    // only in cabinets. Both textures already exist for the starting room's
    // furniture, so they are lootable containers here rather than unopenable
    // props: an unmapped id would make the container invisible. `bed` is both a
    // fixture (the one you sleep in) and a bunk with someone's kit stuffed under
    // it — same texture, different system.
    case 'workbench':
      return 'furn_workbench';
    default:
      return null;
  }
}
