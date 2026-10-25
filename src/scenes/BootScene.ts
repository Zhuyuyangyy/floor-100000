import Phaser from 'phaser';
import { tryContinue } from '../core/session';

// Generates procedural placeholder textures (no external assets), then resumes a
// saved run if one exists, otherwise goes to the title menu.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.generatePlaceholderTextures();
    const state = tryContinue();
    if (!state) {
      this.scene.start('Menu');
    } else {
      this.scene.start(state.status === 'playing' ? 'Game' : 'End');
    }
  }

  private generatePlaceholderTextures(): void {
    // 16x24 placeholder character drawn with a handful of pixels.
    const g = this.add.graphics();
    g.fillStyle(0x77c6a4, 1); // body
    g.fillRect(2, 9, 12, 15);
    g.fillStyle(0xece8d8, 1); // head
    g.fillRect(5, 2, 6, 6);
    g.fillStyle(0x18242c, 1); // eyes
    g.fillRect(6, 4, 1, 1);
    g.fillRect(9, 4, 1, 1);
    g.generateTexture('player', 16, 24);
    g.destroy();
  }
}
