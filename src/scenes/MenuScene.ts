import Phaser from 'phaser';
import { startNewGame, tryContinue } from '../core/session';
import { clearSave, hasSave } from '../systems/SaveSystem';
import { playSfx } from '../render/audio';

// Title screen: a keyboard-navigable option list — 开始新游戏 / 继续游戏 (when a
// save exists) / 操作说明. ↑/↓ to move, Enter to choose (docs/03_TASKS.md#p0-08).
export class MenuScene extends Phaser.Scene {
  private optionTexts: Phaser.GameObjects.Text[] = [];
  private entries: Array<{ label: string; run: () => void }> = [];
  private selected = 0;
  private cursors!: { up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key };
  private keyEnter!: Phaser.Input.Keyboard.Key;
  private keyEsc!: Phaser.Input.Keyboard.Key;
  private helpOpen = false;
  private helpObjects: Array<Phaser.GameObjects.Text | Phaser.GameObjects.Graphics> = [];

  constructor() {
    super('Menu');
  }

  create(): void {
    const { width, height } = this.cameras.main;
    this.add.rectangle(width / 2, height / 2, width, height, 0x18242c);

    this.add
      .text(width / 2, 92, '第100000层', { fontFamily: 'monospace', fontSize: '40px', color: '#f4b66a', stroke: '#0b0f12', strokeThickness: 6 })
      .setOrigin(0.5);
    this.add.text(width / 2, 138, '末 日 宿 舍', { fontFamily: 'monospace', fontSize: '22px', color: '#ece8d8' }).setOrigin(0.5);

    this.entries = [{ label: '开始新游戏', run: () => this.startNew() }];
    if (hasSave()) this.entries.push({ label: '继续游戏', run: () => this.continueRun() });
    this.entries.push({ label: '操作说明', run: () => this.toggleHelp() });
    this.selected = 0;

    this.entries.forEach((entry, i) => {
      const t = this.add.text(width / 2, 210 + i * 30, entry.label, { fontFamily: 'monospace', fontSize: '18px', color: '#ece8d8' }).setOrigin(0.5);
      this.optionTexts.push(t);
    });
    this.refreshOptions();
    this.buildHelp(width, height);

    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.cursors = keyboard.addKeys({ up: 'UP', down: 'DOWN' }) as typeof this.cursors;
      this.keyEnter = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
      this.keyEsc = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
      this.cursors.up.on('down', () => this.move(-1), this);
      this.cursors.down.on('down', () => this.move(1), this);
      this.keyEnter.on('down', () => this.activate(), this);
      this.keyEsc.on('down', () => {
        if (this.helpOpen) this.toggleHelp();
      }, this);
    }
  }

  private refreshOptions(): void {
    this.optionTexts.forEach((t, i) => t.setText(`${i === this.selected ? '▶ ' : '  '}${this.entries[i].label}`));
  }

  private move(delta: number): void {
    if (this.helpOpen) return;
    this.selected = Phaser.Math.Clamp(this.selected + delta, 0, this.entries.length - 1);
    this.refreshOptions();
  }

  private activate(): void {
    if (this.helpOpen) {
      this.toggleHelp();
      return;
    }
    playSfx('click');
    this.entries[this.selected]?.run();
  }

  private seed(): number {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('seed');
    const parsed = raw !== null ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isFinite(parsed) ? parsed >>> 0 : Date.now() >>> 0;
  }

  private startNew(): void {
    clearSave();
    startNewGame(this.seed());
    this.scene.start('Game');
  }

  private continueRun(): void {
    const state = tryContinue();
    if (!state) return;
    this.scene.start(state.status === 'playing' ? 'Game' : 'End');
  }

  private buildHelp(width: number, height: number): void {
    const panelW = 460;
    const panelH = 240;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;

    const bg = this.add.graphics();
    bg.fillStyle(0x0b0f12, 0.97);
    bg.fillRoundedRect(left, top, panelW, panelH, 8);
    bg.lineStyle(2, 0x77c6a4, 1);
    bg.strokeRoundedRect(left, top, panelW, panelH, 8);
    const title = this.add.text(cx, top + 20, '操作说明', { fontFamily: 'monospace', fontSize: '16px', color: '#f4b66a' }).setOrigin(0.5);
    const lines = ['A/D 或 ←/→ 移动', 'E 交互（开箱 / 对话 / 上下楼 / 睡觉）', 'I 背包 · C 制作 · ESC 暂停', '目标：熬过 7 天，第 8 天 06:00 仍活着'];
    const texts = lines.map((line, i) => this.add.text(left + 24, top + 58 + i * 26, line, { fontFamily: 'monospace', fontSize: '13px', color: '#ece8d8' }));
    const footer = this.add.text(cx, top + panelH - 18, '按 Enter / ESC 关闭', { fontFamily: 'monospace', fontSize: '11px', color: '#77c6a4' }).setOrigin(0.5);
    this.helpObjects = [bg, title, ...texts, footer];
    for (const o of this.helpObjects) o.setScrollFactor(0).setDepth(300).setVisible(false);
  }

  private toggleHelp(): void {
    this.helpOpen = !this.helpOpen;
    for (const o of this.helpObjects) o.setVisible(this.helpOpen);
  }
}
