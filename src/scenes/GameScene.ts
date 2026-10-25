import Phaser from 'phaser';

// Placeholder gameplay scene (P0-00): solid-colour room + a standing
// placeholder character. Movement, floors and interaction arrive in P0-02+.
export class GameScene extends Phaser.Scene {
  constructor() {
    super('Game');
  }

  create(): void {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor(0x22303a);

    // floor line
    this.add.rectangle(width / 2, height - 48, width, 2, 0x354650);

    // placeholder character (texture generated in BootScene)
    this.add.sprite(96, height - 48, 'player').setOrigin(0.5, 1);

    this.add.text(12, 12, 'P0-00 占位场景 — 按 ESC 返回标题', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#ece8d8',
    });

    this.input.keyboard?.once('keydown-ESC', () => this.scene.start('Menu'));
  }
}
