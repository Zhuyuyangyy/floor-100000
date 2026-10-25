import Phaser from 'phaser';
import { generateAllPixelArt } from '../render/pixelArt';

// Bakes all procedural pixel-art textures (no external assets), then shows the
// title menu (开始新游戏 / 继续游戏 / 操作说明).
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    generateAllPixelArt(this);
    this.scene.start('Menu');
  }
}
