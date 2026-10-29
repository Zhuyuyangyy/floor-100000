import Phaser from 'phaser';
import { generateAllPixelArt } from '../render/pixelArt';
import { ART_BANNER_LOSE_KEY, ART_BANNER_WIN_KEY, ART_SLOT_KEY, CHARACTER_FILES, ENV_FILES, FURNITURE_FILES, ITEM_ICON_FILES } from '../render/artpack';

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

    this.load.image(ART_BANNER_WIN_KEY, 'assets/artpack/banner-win.png');
    this.load.image(ART_BANNER_LOSE_KEY, 'assets/artpack/banner-lose.png');
  }

  create(): void {
    generateAllPixelArt(this);
    this.scene.start('Menu');
  }
}
