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
// Explicit rather than derived: the game asks for these keys by literal
// ('player', 'wanderer') or by expression (npc_alin / npc_xiaozhou), and a
// missing entry has to be a compile error rather than a green placeholder box.
//
// The four residents after the wanderer are different: they have no painted
// sheet. Their walk cycles are baked from the palettes in walkcycle.ts, which is
// what CharacterColors.bulk exists for — see LAOCHEN_COLORS. Keeping them in this
// list still matters, because it is the single place that makes "a character the
// game can draw" a finite, checked set.
export const CHARACTER_KEYS = [
  'player',
  'npc_alin',
  'npc_xiaozhou',
  'wanderer',
  'npc_laochen',
  'npc_azhen',
  'npc_daliu',
  'npc_xiaoman',
] as const;

export type CharacterKey = (typeof CHARACTER_KEYS)[number];

// Only the painted four have a file. BootScene loads exactly what is listed
// here, and bakeWalkSheets() fills in the rest — a null means "bake it", not
// "missing". Typing this as Partial is deliberate: a new resident that forgets
// to declare a sheet must not be a load of `assets/artpack/undefined.png`.
export const CHARACTER_FILES: Partial<Record<CharacterKey, string>> = {
  player: 'char-player.png',
  npc_alin: 'char-alin.png',
  npc_xiaozhou: 'char-xiaozhou.png',
  wanderer: 'char-wanderer.png',
};

// Texture keys for the rest of the pack, so a rename has one home.
export const ART_SLOT_KEY = 'ui-slot';
export const ART_BANNER_WIN_KEY = 'art-banner-win';
export const ART_BANNER_LOSE_KEY = 'art-banner-lose';
// 第 1 章结算卡的绘制背景（400x250，owner 提供，调色板内 9 色）。
// 只有 chapter 分支用它；胜负卡沿用原来的程序化面板，不改既有观感。
export const CHAPTER1_CLEAR_BG_KEY = 'chapter1-clear-bg';
// 夜幕的冷色叠加纹理（512x512 无缝平铺，alpha 5-31）。可选合成层：
// 现有夜幕是纯 alpha 0.6 黑罩，审查里记过「有压暗、没色温」。
export const NIGHT_OVERLAY_KEY = 'night-overlay';

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
export const ENV_FLOOR_KEY = 'env-floor';
export const TILE_DOOR_KEY = 'tile_door';
export const TILE_WINDOW_KEY = 'tile_window';

// The title screen's painted background — the owner's dorm-corridor render.
// It is the first thing anyone sees, so it is the one place in this project
// where a painted image outranks the procedural art: a title screen sells a
// mood, and a 1672x941 render does that better than any column of rectangles
// this codebase could generate. Gameplay stays pixel art.
export const TITLE_BG_KEY = 'title-dorm';

export const ENV_FILES: Record<string, string> = {
  [ENV_WALL_KEY]: 'wall.png',
  [ENV_FLOOR_KEY]: 'floor.png',
  [TILE_DOOR_KEY]: 'tile-door.png',
  [TILE_WINDOW_KEY]: 'tile-window.png',
};

// ── per-floor backdrops ────────────────────────────────────────────────────
//
// The five floors used to share ONE wall.png and ONE floor.png, told apart only
// by a colour wash in FLOOR_AMBIENCE. Measured on the shipped art that meant
// wall.png was 0.0% warm and floor.png 0.0% warm - every floor was the same
// grey-blue corridor with a different tint, which is exactly what it looked
// like. Five finished 2880x200 backdrops had been sitting in the art library
// the whole time, never loaded.
//
// These are 1280x200 windows cut out of those strips by
// tools/build-floor-backdrops.mjs. They are NOT stretched: 2880 source is nine
// 320px blocks and the world is four, so the script picks a contiguous four-
// block window per floor and keeps the native pixel scale. A door stays a door.
//
// The key is per floor rather than one shared key, and the Record is keyed by
// the playable floor union, so adding a floor without a backdrop is a compile
// error instead of a silently recycled corridor.
export const FLOOR_BACKDROP_PREFIX = 'floor-backdrop';

/** Playable floors. Mirrors PLAYABLE_FLOORS_V01 in src/core/constants.ts. */
type PlayableFloor = 1 | 2 | 3 | 4 | 5;

export const FLOOR_BACKDROP_FILES: Record<PlayableFloor, string> = {
  1: 'backdrop-floor1.png',
  2: 'backdrop-floor2.png',
  3: 'backdrop-floor3.png',
  4: 'backdrop-floor4.png',
  5: 'backdrop-floor5.png',
};

export function floorBackdropKey(floor: number): string {
  return `${FLOOR_BACKDROP_PREFIX}-${floor}`;
}

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
