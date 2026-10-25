import Phaser from 'phaser';

// Generates procedural placeholder textures (no external assets), then shows the
// title menu (which offers 开始新游戏 / 继续游戏 / 操作说明).
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.generatePlaceholderTextures();
    this.scene.start('Menu');
  }

  private generatePlaceholderTextures(): void {
    this.drawFigure('player', 0x77c6a4);
    this.drawFigure('npc_alin', 0x5a8ab5);
    this.drawFigure('npc_xiaozhou', 0xb5855a);
    this.drawFigure('wanderer', 0x3a1e24);
  }

  private drawFigure(key: string, body: number): void {
    const g = this.add.graphics();
    g.fillStyle(body, 1);
    g.fillRect(2, 9, 12, 15);
    g.fillStyle(0xece8d8, 1);
    g.fillRect(5, 2, 6, 6);
    g.fillStyle(0x18242c, 1);
    g.fillRect(6, 4, 1, 1);
    g.fillRect(9, 4, 1, 1);
    g.generateTexture(key, 16, 24);
    g.destroy();
  }
}
