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

// Texture key -> file for the four characters. These used to be baked by
// pixelArt.ts as one shared `drawHumanoid` shape in four colours, so the player,
// both neighbours and the night threat were the same figure with different paint.
// tools/build-characters.mjs draws them instead, on one 32x48 canvas with a
// shared foot baseline and one shared palette.
//
// Explicit rather than derived: the game asks for these four keys by literal
// ('player', 'wanderer') or by expression (npc_alin / npc_xiaozhou), and a
// missing entry has to be a compile error rather than a green placeholder box.
export const CHARACTER_KEYS = ['player', 'npc_alin', 'npc_xiaozhou', 'wanderer', 'npc_zhouhe'] as const;

export type CharacterKey = (typeof CHARACTER_KEYS)[number];

export const CHARACTER_FILES: Record<CharacterKey, string> = {
  player: 'char-player.png',
  npc_alin: 'char-alin.png',
  npc_xiaozhou: 'char-xiaozhou.png',
  wanderer: 'char-wanderer.png',
  npc_zhouhe: 'char-zhouhe.png',
};

// 96x96 dialogue busts, one per character, delivered 2026-11-14 as
// dorm_survival_art_pack. They are a separate file set from CHARACTER_FILES on
// purpose: the walk sheets are 64x96 side views, the busts are front-facing
// head-and-shoulders, and the two never substitute for one another.
//
// The pack arrived on a #FF00FF key colour (RGB, no alpha); the shipped files are
// the keyed RGBA versions — 17 unique colours in, 16 out, byte-identical palette,
// no quantisation. Somebody did quantise them onto PALETTE for one commit; that
// collapsed #101820 and #18242c into the same shadow value and turned the
// wanderer's cool #4b3436 hood into skin brown, so the originals are what ships.
export const PORTRAIT_FILES: Record<CharacterKey, string> = {
  player: 'portrait-player.png',
  npc_alin: 'portrait-alin.png',
  npc_xiaozhou: 'portrait-xiaozhou.png',
  wanderer: 'portrait-wanderer.png',
  npc_zhouhe: 'portrait-zhouhe.png',
};

/** `npc_alin` -> `portrait-alin`, so both the roster ids and NpcIds work. */
export function portraitKey(character: CharacterKey): string {
  return `portrait-${character.replace(/^npc_/, '')}`;
}

// Texture keys for the rest of the pack, so a rename has one home.
export const ART_SLOT_KEY = 'ui-slot';
export const ART_BANNER_WIN_KEY = 'art-banner-win';
export const ART_BANNER_LOSE_KEY = 'art-banner-lose';

// The room itself. These replace the 16x16 procedural tile_wall / tile_floor,
// which repeated a flat brick 80 times across a wall and read as graph paper next
// to the art pack's props. One 1280px-wide image per band instead, so the wall has
// directional light, peeling paint, stains and pipes drawn into it.
//
// The door and window live here too. They used to be baked at 24x56 and 32x40,
// which was right when the player was a 48px silhouette and wrong the moment the
// characters became 64x96 — a door shorter than the person walking through it. The
// owner's renders are rebuilt at 44x104 and 56x76 instead.
export const ENV_WALL_KEY = 'env-wall';
export const ENV_WALL_DORM_KEY = 'env-wall-dorm';
export const ENV_WALL_INDUSTRY_KEY = 'env-wall-industry';
export const ENV_FLOOR_KEY = 'env-floor';
export const TILE_DOOR_KEY = 'tile_door';
export const TILE_WINDOW_KEY = 'tile_window';

// The title screen's painted background — the owner's dorm-corridor render.
// It is the first thing anyone sees, so it is the one place in this project
// where a painted image outranks the procedural art: a title screen sells a
// mood, and a 1672x941 render does that better than any column of rectangles
// this codebase could generate. Gameplay stays pixel art.
export const TITLE_BG_KEY = 'title-dorm';

// 18 wall bands + 6 floor bands from the 2026-11-15 pack: six tiers x three
// variants.
//
// One texture per floor would be 55 files and nobody would ever see the
// difference (a player spends minutes in a tier, not hours). Instead the variant
// is picked by `floor % 3`, so two neighbouring floors never share a wall — that
// is what "every floor looks different" actually needs.
//
// Tiers: slum 1-10, dorm 100-110, industry 1000-1010, commercial 10000-10010,
// vip 50000-50010, core 100000. Variants: a normal, b worn, c accident.
//
// Written inline rather than as a spread table on purpose: tools/assets-manifest
// .mjs parses this block literal-by-literal, and a `...TABLE` line is invisible
// to it — the gate would then report 24 files as unreferenced.
export const ENV_FILES: Record<string, string> = {
  [ENV_WALL_KEY]: 'wall.png',
  [ENV_WALL_DORM_KEY]: 'wall-dorm.png',
  [ENV_WALL_INDUSTRY_KEY]: 'wall-industry.png',
  [ENV_FLOOR_KEY]: 'floor.png',
  [TILE_DOOR_KEY]: 'tile-door.png',
  [TILE_WINDOW_KEY]: 'tile-window.png',

  'env-wall-slum-a': 'walls/wall-slum-a.png',
  'env-wall-slum-b': 'walls/wall-slum-b.png',
  'env-wall-slum-c': 'walls/wall-slum-c.png',
  'env-wall-dorm-a': 'walls/wall-dorm-a.png',
  'env-wall-dorm-b': 'walls/wall-dorm-b.png',
  'env-wall-dorm-c': 'walls/wall-dorm-c.png',
  'env-wall-industry-a': 'walls/wall-industry-a.png',
  'env-wall-industry-b': 'walls/wall-industry-b.png',
  'env-wall-industry-c': 'walls/wall-industry-c.png',
  'env-wall-commercial-a': 'walls/wall-commercial-a.png',
  'env-wall-commercial-b': 'walls/wall-commercial-b.png',
  'env-wall-commercial-c': 'walls/wall-commercial-c.png',
  'env-wall-vip-a': 'walls/wall-vip-a.png',
  'env-wall-vip-b': 'walls/wall-vip-b.png',
  'env-wall-vip-c': 'walls/wall-vip-c.png',
  'env-wall-core-a': 'walls/wall-core-a.png',
  'env-wall-core-b': 'walls/wall-core-b.png',
  'env-wall-core-c': 'walls/wall-core-c.png',

  // 12 wall fixtures, cut from the 2026-11-15 sprite sheet and downscaled to a
  // 26px width (nearest). They replace the procedural rectangles in
  // roomDepth.buildWallDressing — the wall was the last place still drawn from
  // 2px rects while everything else used art.
  'env-fixture-vent': 'fixtures/vent.png',
  'env-fixture-junction': 'fixtures/junction.png',
  'env-fixture-notice': 'fixtures/notice.png',
  'env-fixture-valve': 'fixtures/valve.png',
  'env-fixture-bracket': 'fixtures/bracket.png',
  'env-fixture-hooks': 'fixtures/hooks.png',
  'env-fixture-extinguisher': 'fixtures/extinguisher.png',
  'env-fixture-fusebox': 'fixtures/fusebox.png',
  'env-fixture-gauge': 'fixtures/gauge.png',
  'env-fixture-cable': 'fixtures/cable.png',
  'env-fixture-hazard': 'fixtures/hazard.png',
  'env-fixture-plate': 'fixtures/plate.png',

  // Six wall stains, 64x64 with alpha, laid over the wall at low opacity. They
  // are the only art in the project that is meant to be seen through: a water
  // streak or a scorch mark reads as history, not as an object.
  'env-stain-water': 'stains/stain-water.png',
  'env-stain-scorch': 'stains/stain-scorch.png',
  'env-stain-crack': 'stains/stain-crack.png',
  'env-stain-hole': 'stains/stain-hole.png',
  'env-stain-scratch': 'stains/stain-scratch.png',
  'env-stain-hand': 'stains/stain-hand.png',

  // One floor band per tier; a missing tier degrades to the slum floor rather
  // than a green box (see corridors.floorKeyFor).
  'env-floor-slum': 'floors/floor-slum.png',
  'env-floor-dorm': 'floors/floor-dorm.png',
  'env-floor-industry': 'floors/floor-industry.png',
  'env-floor-commercial': 'floors/floor-commercial.png',
  'env-floor-vip': 'floors/floor-vip.png',
  'env-floor-core': 'floors/floor-core.png',
};

// The eight wall fixtures, shipped at their native 255-335px and shown at that
// size in the close-up archive (see data/wallDeco.ts for why they are not wall
// dressing). Separate folder from artpack/ because these are the only textures
// in the game that are drawn larger than 1:1 on screen.
export const DECO_FILES: Record<string, string> = {
  'deco-1': 'deco-1.png',
  'deco-2': 'deco-2.png',
  'deco-3': 'deco-3.png',
  'deco-4': 'deco-4.png',
  'deco-5': 'deco-5.png',
  'deco-6': 'deco-6.png',
  'deco-7': 'deco-7.png',
  'deco-8': 'deco-8.png',
};

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
  // 工人宿舍区（100-110）的道具，2026-11-14 由项目所有者提供整表切出。
  furn_badge_rack: 'furn-badge_rack.png',
  furn_bunk_bed: 'furn-bunk_bed.png',
  furn_meal_counter: 'furn-meal_counter.png',
  furn_shift_locker: 'furn-shift_locker.png',
  furn_security_safe: 'furn-security_safe.png',
  furn_worker_locker: 'furn-worker_locker.png',
  furn_ration_dispenser: 'furn-ration_dispenser.png',
  furn_shift_board: 'furn-shift_board.png',
  furn_boot_rack: 'furn-boot_rack.png',
  furn_wash_sink: 'furn-wash_sink.png',
  furn_uniform_rack: 'furn-uniform_rack.png',
  furn_tool_cage: 'furn-tool_cage.png',
  furn_thermos_rack: 'furn-thermos_rack.png',
  furn_key_board: 'furn-key_board.png',
};
