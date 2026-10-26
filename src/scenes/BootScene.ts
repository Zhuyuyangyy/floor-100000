import Phaser from 'phaser';
import { generateAllPixelArt } from '../render/pixelArt';

// Bakes all procedural pixel-art textures, loads the licensed UI pack
// (GHI-04), then shows the title menu (开始新游戏 / 继续游戏 / 操作说明).
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    // CC0 1.0, Kenney (kenney.nl) — see THIRD_PARTY_NOTICES.md.
    this.load.image('ui-panel-green', 'assets/ui/panel-green.png');
    this.load.image('ui-panel-yellow', 'assets/ui/panel-yellow.png');
  }

  create(): void {
    generateAllPixelArt(this);
    this.scene.start('Menu');
  }
}
