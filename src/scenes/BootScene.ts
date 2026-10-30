import Phaser from 'phaser';
import { generateAllPixelArt } from '../render/pixelArt';
import { createCharacterAnimations, FRAME_H, FRAME_W, WALK_CHARACTERS, walkSheetKey } from '../render/walkcycle';

// Drop-in painted art, resolved at BUILD time by Vite's glob so a folder that is
// empty costs nothing and a missing file can never 404 in the loader.
//
// This is the hand-off point for real art: a painted character sheet or a
// corridor wall placed in src/assets/ replaces the procedural version with no
// code change, because bakeWalkSheets() already skips a texture key that exists.
// The glob is empty until files are added, which is why the game still boots.
const CUSTOM_CHARACTER_SHEETS = import.meta.glob('../assets/characters/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const CUSTOM_ENV = import.meta.glob('../assets/env/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
import { ART_BANNER_LOSE_KEY, ART_BANNER_WIN_KEY, ART_SLOT_KEY, CHARACTER_FILES, ENV_FILES, ENV_FLOOR_KEY, ENV_WALL_KEY, FURNITURE_FILES, ITEM_ICON_FILES, TITLE_BG_KEY } from '../render/artpack';

// Bakes all procedural pixel-art textures, loads the licensed UI pack
// (GHI-04), then shows the title menu (开始新游戏 / 继续游戏 / 操作说明).
//
// The 15 item icons and the panel frames are NOT procedural: they come from the
// art pack in public/assets/artpack (see tools/build-artpack.mjs, which slices
// and downscales them out of the source sheets). Each icon is loaded under its
// own item id, so itemIconKey() stays the identity function and no call site has
// to know where the art came from.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    // CC0 1.0, Kenney (kenney.nl) — see THIRD_PARTY_NOTICES.md.
    this.load.image('ui-marker', 'assets/ui/marker.png');
    this.load.image(ART_SLOT_KEY, 'assets/ui/slot.png');

    // The panel frame is eight pieces rather than a nine-slice texture — see the
    // note in render/panels.ts for why Phaser 4 makes a NineSlice unusable here.
    for (const accent of ['green', 'yellow'] as const) {
      for (const part of ['tl', 'tr', 'bl', 'br', 'top', 'bottom', 'left', 'right'] as const) {
        this.load.image(`ui-frame-${accent}-${part}`, `assets/ui/frame-${accent}-${part}.png`);
      }
    }

    for (const [id, file] of Object.entries(ITEM_ICON_FILES)) {
      this.load.image(id, `assets/artpack/${file}`);
    }

    for (const [key, file] of Object.entries(FURNITURE_FILES)) {
      this.load.image(key, `assets/artpack/${file}`);
    }

    // The four characters are drawn by tools/build-characters.mjs, not baked here.
    for (const [key, file] of Object.entries(CHARACTER_FILES)) {
      this.load.image(key, `assets/artpack/${file}`);
    }

    // The room's wall and floor: single wide images, not 16x16 tiles.
    for (const [key, file] of Object.entries(ENV_FILES)) {
      this.load.image(key, `assets/env/${file}`);
    }

    // The title screen's painted backdrop. MenuScene falls back to the
    // procedural tower when this texture is missing, so a stripped build still
    // boots — the load failure just logs.
    //
    // The -2x file is the same render pre-resized to 1280x720 — exactly the
    // canvas's 640x360 at the page's 2x display scale, so the title screen shows
    // the painting with no resampling at all. Shipping the 1672x941 original and
    // letting the renderer squeeze it into 640x360 costs visible mush.
    this.load.image(TITLE_BG_KEY, 'assets/title/dorm-corridor-2x.png');

    this.load.image(ART_BANNER_WIN_KEY, 'assets/artpack/banner-win.png');
    this.load.image(ART_BANNER_LOSE_KEY, 'assets/artpack/banner-lose.png');

    // Painted overrides, if any have been dropped in.
    for (const [path, url] of Object.entries(CUSTOM_CHARACTER_SHEETS)) {
      const who = path.split('/').pop()?.replace(/\.png$/, '') ?? '';
      if (!(WALK_CHARACTERS as readonly string[]).includes(who)) continue;
      this.load.spritesheet(walkSheetKey(who as (typeof WALK_CHARACTERS)[number]), url, {
        frameWidth: FRAME_W,
        frameHeight: FRAME_H,
      });
    }
    // The wall and floor are single wide images, so an override is a plain
    // texture swap under the same key the scene already asks for.
    for (const [path, url] of Object.entries(CUSTOM_ENV)) {
      const name = path.split('/').pop()?.replace(/\.png$/, '') ?? '';
      if (name === 'wall') this.load.image(ENV_WALL_KEY, url);
      if (name === 'floor') this.load.image(ENV_FLOOR_KEY, url);
    }
  }

  create(): void {
    generateAllPixelArt(this);
    createCharacterAnimations(this);
    this.scene.start('Menu');
  }
}
