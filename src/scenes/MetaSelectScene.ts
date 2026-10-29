import Phaser from 'phaser';

import { CHARACTER_NAMES, CHARACTER_UNLOCKS, canSelect, loadMeta, saveMeta } from '../systems/metaProgress';
import { MODE_BLURBS, MODE_LABELS, MODES } from '../systems/modes';
import { relicDisplay } from '../systems/relics';
import { getGame } from '../core/session';
import { playSfx } from '../render/audio';
import { createMarker, placeMarker } from '../render/panels';

// OVERHAUL Wave B: the character-select screen — the replay engine both
// benchmarks run on. It sits between the title and the run: pick the survivor
// you have earned. Locked characters show the depth that unlocks them, so the
// list itself is the progression chart.
//
// Keyboard-only, like every other screen in this game.

type InputSlot = 'up' | 'down' | 'enter' | 'esc';

// The order the four appear in; the player is always first.
const ROSTER = ['player', 'npc_alin', 'npc_xiaozhou', 'wanderer'] as const;

// One line of flavour per survivor, so the choice says who you are playing.
const FLAVOUR: Record<string, string> = {
  player: '从底层醒来的那个人。没有特长，只有背包。',
  npc_alin: '宿舍区的老邻居。交易时总能多聊出点门道。',
  npc_xiaozhou: '跑得快的孩子。撤退总是更容易一些。',
  wanderer: '在黑暗里游荡的东西。现在它为你引路。',
};

export class MetaSelectScene extends Phaser.Scene {
  private optionTexts: Phaser.GameObjects.Text[] = [];
  private lockTexts: Phaser.GameObjects.Text[] = [];
  private selected = 0;
  private marker!: Phaser.GameObjects.Image;
  private messageText!: Phaser.GameObjects.Text;
  private cursors!: { up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key };
  private keyEnter!: Phaser.Input.Keyboard.Key;
  private keyEsc!: Phaser.Input.Keyboard.Key;
  private keyLeft!: Phaser.Input.Keyboard.Key;
  private keyRight!: Phaser.Input.Keyboard.Key;
  private modeText!: Phaser.GameObjects.Text;
  private modeBlurbText!: Phaser.GameObjects.Text;
  private relicTexts: Phaser.GameObjects.Text[] = [];
  private lastInputFrame: Record<InputSlot, number> = { up: -1, down: -1, enter: -1, esc: -1 };

  constructor() {
    super('MetaSelect');
  }

  create(): void {
    this.lastInputFrame = { up: -1, down: -1, enter: -1, esc: -1 };
    const { width, height } = this.cameras.main;
    this.add.rectangle(width / 2, height / 2, width, height, 0x121c24);

    this.add
      .text(width / 2, 40, '出发之前', { fontFamily: 'monospace', fontSize: '26px', color: '#f4b66a', stroke: '#0b0f12', strokeThickness: 5 })
      .setOrigin(0.5);

    const meta = loadMeta();
    const startY = 76;
    this.optionTexts = [];
    this.lockTexts = [];
    ROSTER.forEach((id, i) => {
      const unlocked = canSelect(meta, id);
      const need = CHARACTER_UNLOCKS[id];
      const label = CHARACTER_NAMES[id] ?? id;
      const t = this.add
        .text(40, startY + i * 42, label, { fontFamily: 'monospace', fontSize: '17px', color: unlocked ? '#ece8d8' : '#4a4640' })
        .setOrigin(0, 0.5);
      const lock = this.add
        .text(40, startY + i * 42 + 16, unlocked ? FLAVOUR[id] : `尚未相遇 —— 最深第 ${need} 层解锁`, {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: unlocked ? '#8a867c' : '#3a3630',
        })
        .setOrigin(0, 0.5);
      this.optionTexts.push(t);
      this.lockTexts.push(lock);
    });
    this.marker = createMarker(this);
    this.refreshOptions();

    // Mode row: ←/→ cycles the three modes the benchmarks ship.
    this.modeText = this.add
      .text(width - 40, startY + 6, `模式：${MODE_LABELS[meta.mode]}`, { fontFamily: 'monospace', fontSize: '15px', color: '#f4b66a' })
      .setOrigin(1, 0.5);
    this.modeBlurbText = this.add
      .text(width - 40, startY + 26, MODE_BLURBS[meta.mode], { fontFamily: 'monospace', fontSize: '10px', color: '#8a867c', wordWrap: { width: 220 } })
      .setOrigin(1, 0);

    // Relic list: the passive boons this run will carry.
    const relics = relicDisplay(meta);
    this.add
      .text(width - 40, startY + 62, '遗物', { fontFamily: 'monospace', fontSize: '12px', color: '#a8a49a' })
      .setOrigin(1, 0.5);
    this.relicTexts = [];
    relics.forEach((r, i) => {
      const t = this.add
        .text(width - 40, startY + 78 + i * 15, r.unlocked ? `${r.name}：${r.blurb}` : `??? —— 最深第 ${r.need} 层解锁`, {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: r.unlocked ? '#a8e0c8' : '#3a3630',
          wordWrap: { width: 230 },
        })
        .setOrigin(1, 0);
      this.relicTexts.push(t);
    });

    this.messageText = this.add
      .text(width / 2, height - 30, '', { fontFamily: 'monospace', fontSize: '13px', color: '#e0705a', align: 'center' })
      .setOrigin(0.5)
      .setVisible(false);

    this.add
      .text(width / 2, height - 52, '↑/↓ 选择 · ←/→ 模式 · Enter 出发 · ESC 返回标题', { fontFamily: 'monospace', fontSize: '11px', color: '#77c6a4' })
      .setOrigin(0.5);

    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.cursors = keyboard.addKeys({ up: 'UP', down: 'DOWN' }) as typeof this.cursors;
      this.keyEnter = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
      this.keyEsc = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
      this.keyLeft = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
      this.keyRight = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
      this.cursors.up.on('down', () => this.onNav('up', -1), this);
      this.cursors.down.on('down', () => this.onNav('down', 1), this);
      this.keyLeft.on('down', () => this.cycleMode(-1), this);
      this.keyRight.on('down', () => this.cycleMode(1), this);
      this.keyEnter.on('down', () => this.onConfirm('enter'), this);
      this.keyEsc.on('down', () => this.onConfirm('esc'), this);
    }
  }

  // Cycles the mode and persists it, so the next run remembers the choice.
  private cycleMode(delta: number): void {
    const meta = loadMeta();
    const idx = MODES.indexOf(meta.mode);
    const next = MODES[(idx + delta + MODES.length) % MODES.length];
    meta.mode = next;
    saveMeta(meta);
    this.modeText.setText(`模式：${MODE_LABELS[next]}`);
    this.modeBlurbText.setText(MODE_BLURBS[next]);
    playSfx('click');
  }

  // Phaser can deliver one keydown several times inside a single frame; the
  // same per-frame debounce the title screen uses (GHI-03 m9).
  private accept(slot: InputSlot): boolean {
    const frame = this.game.getFrame();
    if (this.lastInputFrame[slot] === frame) return false;
    this.lastInputFrame[slot] = frame;
    return true;
  }

  private onNav(slot: 'up' | 'down', delta: number): void {
    if (!this.accept(slot)) return;
    this.selected = Phaser.Math.Clamp(this.selected + delta, 0, ROSTER.length - 1);
    this.refreshOptions();
    playSfx('click');
  }

  private onConfirm(slot: 'enter' | 'esc'): void {
    if (!this.accept(slot)) return;
    if (slot === 'esc') {
      this.scene.start('Menu');
      return;
    }
    const id = ROSTER[this.selected];
    const meta = loadMeta();
    if (!canSelect(meta, id)) {
      // A locked character is a signpost, not a tease: say what unlocks it.
      this.showMessage(`「${CHARACTER_NAMES[id]}」还未相遇 —— 最深到达第 ${CHARACTER_UNLOCKS[id]} 层后解锁`);
      return;
    }
    meta.selectedCharacter = id;
    saveMeta(meta);
    // The run inherits the mode and the relics earned so far — the pick screen
    // is where the meta meets the run.
    const state = getGame();
    if (state) {
      state.mode = meta.mode;
      state.relics = [...meta.relics];
    }
    playSfx('goal');
    this.scene.start('Game');
  }

  private refreshOptions(): void {
    const meta = loadMeta();
    this.optionTexts.forEach((t, i) => {
      const unlocked = canSelect(meta, ROSTER[i]);
      t.setColor(unlocked ? (i === this.selected ? '#f4b66a' : '#ece8d8') : '#4a4640');
    });
    const selected = this.optionTexts[this.selected];
    this.marker.setVisible(selected !== undefined);
    if (selected) placeMarker(this.marker, selected);
  }

  private showMessage(text: string): void {
    this.messageText.setText(text).setVisible(true);
    this.time.delayedCall(2600, () => this.messageText.setVisible(false));
  }
}
