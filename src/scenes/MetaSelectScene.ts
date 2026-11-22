import Phaser from 'phaser';


import { CHARACTER_NAMES, CHARACTER_UNLOCKS, canSelect, loadMeta, saveMeta } from '../systems/metaProgress';
import { MODE_BLURBS, MODE_LABELS, MODES } from '../systems/modes';
import { relicDisplay } from '../systems/relics';
import { getGame } from '../core/session';
import { playSfx } from '../render/audio';
import { PALETTE, TEXT, hex } from '../render/palette.ts';
import { buildPanel, createMarker, PANEL_DEPTH, placeMarker } from '../render/panels';
import { buildPanelHeader, FONT_FAMILY, TYPE, UI } from '../render/uiKit';
import { idleAnimKey, walkSheetKey } from '../render/walkcycle';
import { TITLE_BG_KEY } from '../render/artpack';
import { isPortraitViewport, portraitViewportFor } from '../core/design';

// OVERHAUL UI: the character select, rebuilt.
//
// The QA sweep found this was the ugliest screen in the game by a wide margin:
// 91% of it was a single flat colour and it held 431 distinct colours in total,
// against 9056 on the dorm floor and 16937 on the title. It is also the screen
// every run passes through, and the one that has to sell "play again".
//
// So it is no longer a list of names on a dark rectangle. The painted backdrop
// sits behind it (the same render as the title, dimmed), and the selected
// survivor is drawn at native size as a portrait with a warm lamp glow behind
// them - the sprite art is 88px tall, which is a portrait if you give it room.
// The four names are compact rows to the right, and the mode and relic
// information lives in its own column.
type InputSlot = 'up' | 'down' | 'enter' | 'esc';

const ROSTER = ['player', 'npc_alin', 'npc_xiaozhou', 'wanderer'] as const;

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
  private portrait?: Phaser.GameObjects.Sprite;
  private portraitGlow?: Phaser.GameObjects.Graphics;
  private flavourText!: Phaser.GameObjects.Text;
  private lastInputFrame: Record<InputSlot, number> = { up: -1, down: -1, enter: -1, esc: -1 };

  constructor() {
    super('MetaSelect');
  }

  create(): void {
    this.lastInputFrame = { up: -1, down: -1, enter: -1, esc: -1 };
    const { width, height } = this.cameras.main;
    const mobile = isPortraitViewport(window.innerWidth, window.innerHeight);
    const visibleWidth = mobile ? portraitViewportFor(window.innerWidth, window.innerHeight).width : width;

    // ── the backdrop ────────────────────────────────────────────────────────
    // The same painted render as the title, dimmed hard: the pick screen should
    // feel like standing in the same building, not like a separate menu.
    if (this.textures.exists(TITLE_BG_KEY)) {
      const bg = this.add.image(width / 2, height / 2, TITLE_BG_KEY).setDisplaySize(width, height).setDepth(-30);
      this.textures.get(TITLE_BG_KEY).setFilter(Phaser.Textures.FilterMode.LINEAR);
      void bg;
    } else {
      this.add.rectangle(width / 2, height / 2, width, height, UI.surface).setDepth(-30);
    }
    this.add.rectangle(width / 2, height / 2, width, height, UI.surface).setAlpha(0.62).setDepth(-29);

    const cx = width / 2;
    const panelW = mobile ? Math.max(240, visibleWidth - 24) : 470;
    const panelH = mobile ? 450 : 300;
    const left = cx - panelW / 2;
    const top = height / 2 - panelH / 2;
    const depth = PANEL_DEPTH.menu.help;

    this.add.text(cx, top - 18, '出发之前', { fontFamily: FONT_FAMILY, fontSize: '36px', color: hex(PALETTE.lightHigh), stroke: hex(PALETTE.ink), strokeThickness: 4 }).setOrigin(0.5).setDepth(depth + 1);

    for (const o of buildPanel(this, cx, height / 2, panelW, panelH, 'green', depth)) o.setDepth(o.depth);
    for (const o of buildPanelHeader(this, left, top, panelW, '幸存者', UI.good, depth + 5)) this.add.existing(o as Phaser.GameObjects.GameObject);

    // ── the portrait ────────────────────────────────────────────────────────
    // Left third. The sprite is 88px of figure at native size, which is the
    // whole reason to give it room instead of a 16px thumbnail.
    const portraitX = mobile ? left + 48 : left + 62;
    const portraitFeet = mobile ? top + 188 : top + panelH - 70;
    this.portraitGlow = this.add.graphics().setDepth(depth + 5);
    this.portrait = this.add
      .sprite(portraitX, portraitFeet, walkSheetKey('player'))
      .setOrigin(0.5, 1)
      .setDepth(depth + 7);
    this.portrait.play(idleAnimKey('player'));

    this.flavourText = this.add
      .text(portraitX, portraitFeet + 10, '', { fontFamily: FONT_FAMILY, fontSize: mobile ? '12px' : '18px', color: hex(TEXT.secondary), align: 'center', wordWrap: { width: mobile ? 82 : 132 } })
      .setOrigin(0.5, 0)
      .setDepth(depth + 7);

    // ── the roster ──────────────────────────────────────────────────────────
    const meta = loadMeta();
    const listX = left + (mobile ? 96 : 128);
    const listW = mobile ? panelW - 108 : 200;
    this.optionTexts = [];
    this.lockTexts = [];
    ROSTER.forEach((id, i) => {
      const unlocked = canSelect(meta, id);
      const need = CHARACTER_UNLOCKS[id];
      // 52px pitch, name on the first 24px and its unlock note on the next
      // 20px. At the old 40px pitch with the note at +22, a pixel face (which
      // fills its whole em, unlike SimSun) put the note straight through the
      // name and the whole roster read as one smudge.
      const y = top + (mobile ? 30 : 34) + i * (mobile ? 48 : 52);
      const name = this.add
        .text(listX + 8, y, CHARACTER_NAMES[id] ?? id, {
          fontFamily: FONT_FAMILY,
          fontSize: `${mobile ? 20 : TYPE.body}px`,
          color: unlocked ? hex(TEXT.primary) : hex(TEXT.disabled),
        })
        .setDepth(depth + 7);
      const lock = this.add
        .text(listX + 8, y + 28, unlocked ? '可出战' : `最深第 ${need} 层解锁`, {
          fontFamily: FONT_FAMILY,
          fontSize: `${mobile ? 13 : TYPE.caption}px`,
          color: unlocked ? hex(PALETTE.clothHigh) : hex(TEXT.disabled),
        })
        .setDepth(depth + 7);
      this.optionTexts.push(name);
      this.lockTexts.push(lock);
      const rowTarget = this.add
        .zone(listX + listW / 2, y + 22, listW, mobile ? 44 : 48)
        .setDepth(depth + 7)
        .setInteractive({ useHandCursor: true });
      // Selection is click-only: passing over a row while moving to the start button must not change it.
      rowTarget.on('pointerup', () => {
        this.selectCharacter(i);
        playSfx('click');
      }, this);
    });
    this.invWell(listX - 6, top + 28, listW, mobile ? 202 : 220, depth + 5);
    this.optionTexts.forEach((t) => t.setDepth(depth + 8));
    this.lockTexts.forEach((t) => t.setDepth(depth + 8));

    this.marker = createMarker(this);
    this.marker.setDepth(depth + 9);

    // ── the mode / relic column ─────────────────────────────────────────────
    const colX = mobile ? left + 16 : left + 338;
    const modeY = mobile ? top + 244 : top + 34;
    this.modeText = this.add
      .text(mobile ? cx : colX, modeY, `模式 ${MODE_LABELS[meta.mode]}`, { fontFamily: FONT_FAMILY, fontSize: `${mobile ? 18 : TYPE.body}px`, color: hex(PALETTE.lightHigh), align: mobile ? 'center' : 'left' })
      .setOrigin(mobile ? 0.5 : 0, 0)
      .setDepth(depth + 7);
    this.modeBlurbText = this.add
      .text(mobile ? cx : colX, mobile ? top + 270 : top + 66, MODE_BLURBS[meta.mode], { fontFamily: FONT_FAMILY, fontSize: mobile ? '13px' : '18px', color: hex(TEXT.dim), align: mobile ? 'center' : 'left', wordWrap: { width: mobile ? panelW - 32 : 150 } })
      .setOrigin(mobile ? 0.5 : 0, 0)
      .setDepth(depth + 7);
    const relics = relicDisplay(meta);
    if (mobile) {
      const unlockedRelics = relics.filter((r) => r.unlocked).map((r) => r.name);
      this.add.text(cx, top + 350, `已获遗物：${unlockedRelics.join('、') || '无'}`, {
        fontFamily: FONT_FAMILY, fontSize: '13px', color: hex(PALETTE.clothHigh), align: 'center', wordWrap: { width: panelW - 24 },
      }).setOrigin(0.5, 0).setDepth(depth + 7);
      for (const [x, delta, label] of [[left + 42, -1, '‹'], [left + panelW - 42, 1, '›']] as const) {
        this.add.rectangle(x, modeY + 10, 32, 28, UI.surfaceRaised).setStrokeStyle(1, UI.line).setDepth(depth + 8)
          .setInteractive({ useHandCursor: true }).on('pointerup', () => this.cycleMode(delta));
        this.add.text(x, modeY + 10, label, { fontFamily: FONT_FAMILY, fontSize: '20px', color: hex(PALETTE.lightHigh) }).setOrigin(0.5).setDepth(depth + 9);
      }
    } else relics.forEach((r, i) => {
      // Down to +140 and onto a 28px pitch: the blurb above it wraps to two or
      // three lines at this width, and the relic column started at +108 where
      // the third line now lands.
      this.add
        .text(colX, top + 140 + i * 28, r.unlocked ? `◆ ${r.name}` : `◇ 第 ${r.need} 层`, {
          fontFamily: FONT_FAMILY,
          fontSize: '18px',
          color: r.unlocked ? hex(PALETTE.clothHigh) : hex(TEXT.disabledDeep),
        })
        .setDepth(depth + 7);
    });

    this.messageText = this.add
      .text(cx, mobile ? top + panelH - 82 : top + panelH - 12, '', { fontFamily: FONT_FAMILY, fontSize: `${mobile ? 13 : TYPE.caption}px`, color: hex(TEXT.warn) })
      .setOrigin(0.5)
      .setDepth(depth + 9)
      .setVisible(false);

    // The key legend sits on the foot bar, like the game's own.
    this.add
      .rectangle(0, height - 22, width, 22, UI.surface)
      .setOrigin(0, 0)
      .setAlpha(0.9)
      .setDepth(depth + 2);
    this.add
      .text(mobile ? cx : 8, height - 11, mobile ? '点角色选择 · 点下方开始' : '鼠标点击选择 / 开始生存 · ↑/↓ 选择 · ←/→ 模式 · ESC 返回标题', { fontFamily: FONT_FAMILY, fontSize: mobile ? '13px' : '18px', color: hex(PALETTE.clothHigh) })
      .setOrigin(mobile ? 0.5 : 0, 0.5)
      .setDepth(depth + 3);

    const startX = mobile ? cx : listX + listW / 2;
    const startY = top + panelH - (mobile ? 45 : 38);
    const startButton = this.add
      .rectangle(startX, startY, 160, 36, UI.good)
      .setAlpha(0.9)
      .setDepth(depth + 7)
      .setInteractive({ useHandCursor: true });
    startButton.on('pointerover', () => startButton.setAlpha(1), this);
    startButton.on('pointerout', () => startButton.setAlpha(0.9), this);
    startButton.on('pointerup', () => this.onConfirm('enter'), this);
    this.add
      .text(startX, startY, '开始生存', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: hex(PALETTE.lightHigh) })
      .setOrigin(0.5)
      .setDepth(depth + 8);

    this.refreshOptions();

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

  /** A dark inset behind the roster so the names sit on a surface. */
  private invWell(x: number, y: number, w: number, h: number, depth: number): void {
    this.add.rectangle(x, y, w, h, 0x080c0f).setOrigin(0, 0).setAlpha(0.55).setDepth(depth);
    const g = this.add.graphics().setDepth(depth + 1);
    g.lineStyle(1, UI.line, 0.5);
    g.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, w - 1, h - 1);
  }

  private cycleMode(delta: number): void {
    const meta = loadMeta();
    const idx = MODES.indexOf(meta.mode);
    const next = MODES[(idx + delta + MODES.length) % MODES.length];
    meta.mode = next;
    saveMeta(meta);
    this.modeText.setText(`模式 ${MODE_LABELS[next]}`);
    this.modeBlurbText.setText(MODE_BLURBS[next]);
    playSfx('click');
  }

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

  private selectCharacter(index: number): void {
    this.selected = Phaser.Math.Clamp(index, 0, ROSTER.length - 1);
    this.refreshOptions();
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
      this.showMessage(`「${CHARACTER_NAMES[id]}」还未相遇 —— 最深第 ${CHARACTER_UNLOCKS[id]} 层解锁`);
      return;
    }
    meta.selectedCharacter = id;
    saveMeta(meta);
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
      const isSelected = i === this.selected;
      t.setColor(unlocked ? (isSelected ? hex(PALETTE.lightHigh) : hex(TEXT.primary)) : hex(TEXT.disabled));
      // The selected row gets a band, same language as every other list.
      if (isSelected) {
        t.setDepth(PANEL_DEPTH.menu.help + 8);
      }
    });
    const selected = this.optionTexts[this.selected];
    this.marker.setVisible(selected !== undefined);
    if (selected) placeMarker(this.marker, selected);

    // The portrait follows the selection: this is what makes the screen read as
    // "choose who you are" rather than "pick a label".
    const who = ROSTER[this.selected];
    const unlocked = canSelect(meta, who);
    if (this.portrait) {
      this.portrait.setTexture(walkSheetKey(who));
      this.portrait.play(idleAnimKey(who), true);
      // A locked survivor is a silhouette: visible enough to be a promise,
      // dark enough to be out of reach.
      this.portrait.setAlpha(unlocked ? 1 : 0.32);
      this.portrait.setTint(unlocked ? 0xffffff : 0x3a4048);
      this.portraitGlow?.clear();
      if (this.portraitGlow && unlocked) {
        // A warm pool behind the portrait, using the same warm ramp as the lamps.
        for (let s = 5; s >= 1; s--) {
          this.portraitGlow.fillStyle(UI.accent, 0.05 * s);
          this.portraitGlow.fillEllipse(this.portrait.x, this.portrait.y - 34, 40 + s * 12, 66 + s * 16);
        }
      }
    }
    this.flavourText.setText(unlocked ? FLAVOUR[who] : '尚未相遇');
  }

  private showMessage(text: string): void {
    this.messageText.setText(text).setVisible(true);
    this.time.delayedCall(2600, () => this.messageText.setVisible(false));
  }
}
