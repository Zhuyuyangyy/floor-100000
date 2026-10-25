import Phaser from 'phaser';
import { startNewGame } from '../core/session';

// Pixel-art title screen. Minimal by design (P0-00): title + 开始游戏 button.
export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    const { width, height } = this.cameras.main;

    this.add.rectangle(width / 2, height / 2, width, height, 0x18242c);

    this.add
      .text(width / 2, 92, '第100000层', {
        fontFamily: 'monospace',
        fontSize: '40px',
        color: '#f4b66a',
        stroke: '#0b0f12',
        strokeThickness: 6,
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 138, '末 日 宿 舍', {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#ece8d8',
      })
      .setOrigin(0.5);

    const button = this.add
      .rectangle(width / 2, 236, 200, 48, 0x354650)
      .setStrokeStyle(2, 0x77c6a4)
      .setInteractive({ useHandCursor: true });

    this.add
      .text(width / 2, 236, '开始游戏', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ece8d8',
      })
      .setOrigin(0.5);

    button.on('pointerover', () => button.setFillStyle(0x465865));
    button.on('pointerout', () => button.setFillStyle(0x354650));
    button.on('pointerup', () => this.startGame());

    this.add
      .text(width / 2, 300, '按 回车 或 点击「开始游戏」', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#77c6a4',
      })
      .setOrigin(0.5);

    const keyboard = this.input.keyboard;
    keyboard?.once('keydown-ENTER', () => this.startGame());
    keyboard?.once('keydown-SPACE', () => this.startGame());
  }

  // New run: seed from ?seed=<n> for QA reproduction, else a time-based seed.
  private startGame(): void {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('seed');
    const parsed = raw !== null ? Number.parseInt(raw, 10) : Number.NaN;
    const seed = Number.isFinite(parsed) ? parsed >>> 0 : Date.now() >>> 0;
    startNewGame(seed);
    this.scene.start('Game');
  }
}
