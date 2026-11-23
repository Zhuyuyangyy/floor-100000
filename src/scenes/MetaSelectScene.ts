import Phaser from 'phaser';


import { CHARACTER_NAMES, CHARACTER_UNLOCKS, canSelect, loadMeta, saveMeta } from '../systems/metaProgress';
import { MODE_BLURBS, MODE_LABELS, MODES } from '../systems/modes';
import { relicDisplay } from '../systems/relics';
import { getGame } from '../core/session';
import { playSfx } from '../render/audio';
import { PALETTE, TEXT, hex } from '../render/palette.ts';
import { buildPanel, createMarker, PANEL_DEPTH, placeMarker } from '../render/panels';
import { buildPanelHeader, FONT_FAMILY, TYPE, UI } from '../render/uiKit';
import {
  META_BLURB_FONT,
  META_BLURB_TOP,
  META_BLURB_W,
  META_BTN_H,
  META_BTN_TOP,
  META_BTN_W,
  META_COL_X,
  META_FLAVOUR_FONT,
  META_FLAVOUR_TOP,
  META_FLAVOUR_W,
  META_FLAVOUR_X,
  META_MSG_FONT,
  META_MSG_TOP,
  META_NOTE_DY,
  META_NOTE_FONT,
  META_PANEL_H,
  META_PANEL_W,
  META_PORTRAIT_CY,
  META_PORTRAIT_X,
  META_RELIC_FONT,
  META_RELIC_ROWS,
  META_ROSTER_ROWS,
  META_ROSTER_TOP,
  META_ROSTER_W,
  META_ROSTER_X,
  META_ROW_H,
  META_TITLE_DY,
  META_TITLE_FONT,
  META_WELL_H,
  META_WELL_TOP,
  META_WELL_X,
  metaRelicY,
  metaRowY,
} from '../render/metaSelectLayout';
import { TITLE_BG_KEY, portraitKey } from '../render/artpack';
import { framedButton, hitRect, textClickable } from '../render/pointer';

// OVERHAUL UI: the character select, rebuilt.
//
// The QA sweep found this was the ugliest screen in the game by a wide margin:
// 91% of it was a single flat colour and it held 431 distinct colours in total,
// against 9056 on the dorm floor and 16937 on the title. It is also the screen
// every run passes through, and the one that has to sell "play again".
//
// So it is no longer a list of names on a dark rectangle. The painted backdrop
// sits behind it (the same render as the title, dimmed), and the selected
// survivor is shown as a 96x96 painted bust with a warm lamp glow behind it.
//
// The bust replaced the animated walk sheet that used to stand here. The walk
// sheet is a 64x96 side view: at this size it read as a doll standing on a
// shelf, and the face - the only thing that makes "choose who you are" land -
// was three pixels wide. The bust is front-facing and already isolated, so it
// costs the same 96px and buys an actual face.
// The four names are compact rows to the right, and the mode and relic
// information lives in its own column.
type InputSlot = 'up' | 'down' | 'enter' | 'esc';

const ROSTER = ['player', 'npc_alin', 'npc_xiaozhou', 'npc_zhouhe', 'wanderer'] as const;

// The caption's wrap width and opening line now live in render/metaSelectLayout.ts
// with every other lane on this screen — see that file's header for the four
// overlaps the 2026-11-23 sweep measured here.

// 每行手工断好，且每行都装得进左列的带（META_FLAVOUR_W）。
//
// 断行放在数据里而不是交给 wordWrap：Phaser 的基础断行器按空格断，中文串没有
// 空格，一个 132px 的框会把整句渲染成 700px 一行横穿名单。useAdvancedWrap 能断
// 中文，但它按字数硬切、不认标点 —— 2026-11-23 实测 148px 框下「从底层醒来的那个
// 人。」被切成「从底层醒来的那个 / 人。」，单字成行。
//
// 所以这里把每个分句再按语义断到 ≤ 8 字（8 × 18px = 144 ≤ 148），一行一个意群，
// 自动断行永不触发。文案含义逐字保留，只挪断点。
const FLAVOUR: Record<string, string> = {
  player: '从底层醒来的\n那个人。\n没有特长，\n只有背包。',
  npc_alin: '宿舍区的\n老邻居。\n交易时总能多\n聊出点门道。',
  npc_xiaozhou: '跑得快的孩子。\n撤退总是\n更容易一些。',
  wanderer: '在黑暗里\n游荡的东西。\n现在它\n为你引路。',
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
  private portrait?: Phaser.GameObjects.Image;
  private portraitGlow?: Phaser.GameObjects.Graphics;
  private flavourText!: Phaser.GameObjects.Text;
  private lastInputFrame: Record<InputSlot, number> = { up: -1, down: -1, enter: -1, esc: -1 };

  constructor() {
    super('MetaSelect');
  }

  create(): void {
    this.lastInputFrame = { up: -1, down: -1, enter: -1, esc: -1 };
    const { width, height } = this.cameras.main;

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
    const panelW = META_PANEL_W;
    const panelH = META_PANEL_H;
    const left = cx - panelW / 2;
    const top = height / 2 - panelH / 2;
    const depth = PANEL_DEPTH.menu.help;

    this.add.text(cx, top + META_TITLE_DY, '出发之前', { fontFamily: FONT_FAMILY, fontSize: `${META_TITLE_FONT}px`, color: hex(PALETTE.lightHigh), stroke: hex(PALETTE.ink), strokeThickness: 4 }).setOrigin(0.5).setDepth(depth + 1);

    for (const o of buildPanel(this, cx, height / 2, panelW, panelH, 'green', depth)) o.setDepth(o.depth);
    for (const o of buildPanelHeader(this, left, top, panelW, '幸存者', UI.good, depth + 5)) this.add.existing(o as Phaser.GameObjects.GameObject);

    // ── the portrait ────────────────────────────────────────────────────────
    // Left column: 128px wide, so a 96px bust centred at left+62 sits 14px off
    // the panel edge with 18px of air before the roster. Centred rather than
    // bottom-anchored: a head-and-shoulders crop anchored to the floor reads as
    // a head on a shelf, which is what the old full-body sprite looked like.
    const portraitX = left + META_PORTRAIT_X;
    const portraitCy = top + META_PORTRAIT_CY;
    this.portraitGlow = this.add.graphics().setDepth(depth + 5);
    this.portrait = this.add
      .image(portraitX, portraitCy, portraitKey('player'))
      .setDepth(depth + 7);

    // Caption under the portrait, not across the panel's bottom strip.
    //
    // It used to be centred at cx on the bottom strip, where the mode/relic
    // column also lives: measured, the 360px caption ran to x=820 and printed
    // straight through the relic rows (overlap with "◇ 第 5 层": 77x16px). The
    // portrait column is the one place with room — the caption wraps under the
    // bust at the column's own width. useAdvancedWrap is load-bearing: these
    // strings have no spaces, so Phaser's basic wrapper never breaks them and
    // each would render as one 700px line.
    this.flavourText = this.add
      .text(left + META_FLAVOUR_X, top + META_FLAVOUR_TOP, '', {
        fontFamily: FONT_FAMILY,
        fontSize: `${META_FLAVOUR_FONT}px`,
        color: hex(TEXT.secondary),
        align: 'center',
        wordWrap: { width: META_FLAVOUR_W, useAdvancedWrap: true },
      })
      .setOrigin(0.5, 0)
      .setDepth(depth + 7);

    // ── the roster ──────────────────────────────────────────────────────────
    const meta = loadMeta();
    // 版面按 5 行名单 / 5 行遗物算出来的。加了角色或遗物而没重算泳道，就会像
    // 2026-11-23 那样静默溢出到装饰条上 —— 这里让它响。
    if (ROSTER.length !== META_ROSTER_ROWS) {
      throw new Error(`MetaSelect: ROSTER ${ROSTER.length} 行与 META_ROSTER_ROWS ${META_ROSTER_ROWS} 不符，请重算 metaSelectLayout 泳道`);
    }
    const listX = left + META_ROSTER_X;
    const listW = META_ROSTER_W;
    this.optionTexts = [];
    this.lockTexts = [];
    ROSTER.forEach((id, i) => {
      const unlocked = canSelect(meta, id);
      const need = CHARACTER_UNLOCKS[id];
      // 行距与注释偏移都从字体真实线盒推出来（metaSelectLayout）：名字 24px 是
      // 30px 线盒、注释 20px 是 25px，一行 55px，行距 58。旧值 pitch 52 / note
      // +28 是按 ~1.0em 的像素字体量的，两行本身就交叠 2px，第 5 行还整条掉到
      // 井外、印在面板底部装饰条上（2026-11-23 巡检实测）。
      const y = top + metaRowY(i);
      const name = this.add
        .text(listX + 8, y, CHARACTER_NAMES[id] ?? id, {
          fontFamily: FONT_FAMILY,
          fontSize: `${TYPE.body}px`,
          color: unlocked ? hex(TEXT.primary) : hex(TEXT.disabled),
        })
        .setDepth(depth + 7);
      const lock = this.add
        .text(listX + 8, y + META_NOTE_DY, unlocked ? '可出战' : `最深第 ${need} 层解锁`, {
          fontFamily: FONT_FAMILY,
          fontSize: `${META_NOTE_FONT}px`,
          color: unlocked ? hex(PALETTE.clothHigh) : hex(TEXT.disabled),
        })
        .setDepth(depth + 7);
      this.optionTexts.push(name);
      this.lockTexts.push(lock);
      // Mouse: hover moves the cursor, click commits the choice of *character*
      // only. Starting the run is the 出发 button's job — an earlier version also
      // started on a second click of the selected row, and because row 0 is
      // selected by default a single stray click on 幸存者 launched the game.
      // 命中框跟着真实行高走（旧值 48 < 行高 55，行尾 7px 点不到）。
      hitRect(this, listX - 6, y - 2, listW, META_ROW_H + 4, depth + 9, {
        onOver: () => {
          if (this.selected === i) return;
          this.selected = i;
          this.refreshOptions();
        },
        onClick: () => {
          this.selected = i;
          this.refreshOptions();
          playSfx('click');
        },
      });
    });
    // 井高按行数算，末行下方留内边距 —— 旧的写死 220 装不下 5 行 55px。
    this.invWell(left + META_WELL_X, top + META_WELL_TOP, listW, META_WELL_H, depth + 5);
    this.optionTexts.forEach((t) => t.setDepth(depth + 8));
    this.lockTexts.forEach((t) => t.setDepth(depth + 8));

    this.marker = createMarker(this);
    this.marker.setDepth(depth + 9);

    // ── the mode / relic column ─────────────────────────────────────────────
    const colX = left + META_COL_X;
    this.modeText = this.add
      .text(colX, top + META_ROSTER_TOP, `模式 ${MODE_LABELS[meta.mode]}`, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: hex(PALETTE.lightHigh) })
      .setDepth(depth + 7);
    // useAdvancedWrap 是承重的：这些串没有空格，Phaser 的基础断行器一个字都
    // 断不开中文。旧实现只给了 width:150，实测整句渲染成 x=743..1031 的一行，
    // 而面板右界 875 —— 冲出面板 156px 印在背景上（2026-11-23 巡检）。
    this.modeBlurbText = this.add
      .text(colX, top + META_BLURB_TOP, MODE_BLURBS[meta.mode], {
        fontFamily: FONT_FAMILY,
        fontSize: `${META_BLURB_FONT}px`,
        color: hex(TEXT.dim),
        wordWrap: { width: META_BLURB_W, useAdvancedWrap: true },
      })
      .setDepth(depth + 7);
    const relics = relicDisplay(meta);
    if (relics.length !== META_RELIC_ROWS) {
      throw new Error(`MetaSelect: 遗物 ${relics.length} 行与 META_RELIC_ROWS ${META_RELIC_ROWS} 不符，请重算 metaSelectLayout 泳道`);
    }
    relics.forEach((r, i) => {
      // 首行让开简介的**最坏**高度（easy 模式 4 行 = 88px，实测），不是按当前
      // 模式的行数摆 —— 否则 ←/→ 切模式时整列会上下跳。
      this.add
        .text(colX, top + metaRelicY(i), r.unlocked ? `◆ ${r.name}` : `◇ 第 ${r.need} 层`, {
          fontFamily: FONT_FAMILY,
          fontSize: `${META_RELIC_FONT}px`,
          color: r.unlocked ? hex(PALETTE.clothHigh) : hex(TEXT.disabledDeep),
        })
        .setDepth(depth + 7);
    });

    // ── mouse targets ───────────────────────────────────────────────────────
    // Mode: clicking the label cycles it, matching → on the keyboard. A pair of
    // arrows either side would have been more obvious but the relic column starts
    // at colX and there is no room above it.
    const modeHit = hitRect(this, colX - 6, top + META_ROSTER_TOP - 6, META_BTN_W + 6, 36, depth + 8, {
      onOver: () => this.modeText.setColor(hex(PALETTE.lightHot)),
      onClick: () => this.cycleMode(1),
    });
    modeHit.on('pointerout', () => this.modeText.setColor(hex(PALETTE.lightHigh)));

    // 出发 / 返回标题: the two things Enter and ESC did.
    framedButton(this, colX, top + META_BTN_TOP, META_BTN_W, META_BTN_H, '出发', depth + 9, () => this.onConfirm('enter'), {
      fill: UI.accent,
      line: PALETTE.clothHigh,
      text: hex(PALETTE.ink),
      hover: PALETTE.lightHigh,
    });
    textClickable(
      this.add
        .text(width - 16, height - 11, '返回标题', { fontFamily: FONT_FAMILY, fontSize: '18px', color: hex(PALETTE.clothHigh) })
        .setOrigin(1, 0.5)
        .setDepth(depth + 4),
      hex(PALETTE.clothHigh),
      hex(PALETTE.lightHigh),
      { onClick: () => this.onConfirm('esc') },
    );

    // 提示行独占一条泳道（出发按钮下方），不再挂在「面板底 -12」上 —— 那个位置
    // 正落在底部装饰条里。origin(0.5, 0) 让它从泳道顶开始长，高度可预测。
    this.messageText = this.add
      .text(cx, top + META_MSG_TOP, '', { fontFamily: FONT_FAMILY, fontSize: `${META_MSG_FONT}px`, color: hex(TEXT.warn) })
      .setOrigin(0.5, 0)
      .setDepth(depth + 9)
      .setVisible(false);

    // The key legend sits on the foot bar, like the game's own.
    this.add
      .rectangle(0, height - 22, width, 22, UI.surface)
      .setOrigin(0, 0)
      .setAlpha(0.9)
      .setDepth(depth + 2);
    this.add
      .text(8, height - 11, '↑/↓ 选择 · ←/→ 模式 · Enter 出发 · ESC 返回标题', { fontFamily: FONT_FAMILY, fontSize: '18px', color: hex(PALETTE.clothHigh) })
      .setOrigin(0, 0.5)
      .setDepth(depth + 3);

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
      this.portrait.setTexture(portraitKey(who));
      // A locked survivor is a silhouette: visible enough to be a promise,
      // dark enough to be out of reach.
      //
      // 0.32 alpha + a 0x3a4048 multiply was tuned against the old walk sheet,
      // which was a pale 12-colour figure. The wanderer bust is 6 colours of dark
      // brown and black, so that pair made it vanish into the panel — measured on
      // the locked-wanderer screenshot: the hood read as an empty slot. 0.62 keeps
      // the shape legible and a grey wash (not a dark one) still says "unlit".
      this.portrait.setAlpha(unlocked ? 1 : 0.62);
      this.portrait.setTint(unlocked ? 0xffffff : 0x8a95a0);
      this.portraitGlow?.clear();
      if (this.portraitGlow && unlocked) {
        // A warm pool behind the portrait, using the same warm ramp as the lamps.
        // Sized for the bust, not the old full-body figure: an ellipse 66px tall
        // behind a 96px head left the light pooling at the chin.
        for (let s = 5; s >= 1; s--) {
          this.portraitGlow.fillStyle(UI.accent, 0.05 * s);
          this.portraitGlow.fillEllipse(this.portrait.x, this.portrait.y + 4, 52 + s * 10, 52 + s * 10);
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
