import Phaser from 'phaser';

import { PALETTE, TEXT, hex } from '../render/palette.ts';
import { startNewGame, tryContinue } from '../core/session';
import { devEntry } from '../core/devMode';
import { clearSave, hasSave } from '../systems/SaveSystem';
import { playSfx } from '../render/audio';
import { applyPanelDepth, buildPanel, createMarker, PANEL_DEPTH, placeMarker, type PanelObject } from '../render/panels';
import { buildPanelHeader, TYPE, UI } from '../render/uiKit';
import { buildPhotoTitleBackdrop, buildTitleBackdrop, type TitleBackdrop } from '../render/titleBackdrop';
import { TITLE_BG_KEY } from '../render/artpack';

// Title screen: a keyboard-navigable option list — 开始新游戏 / 继续游戏 (when a
// save exists) / 操作说明. ↑/↓ to move, Enter to choose (docs/03_TASKS.md#p0-08).
//
// OVERHAUL: the screen used to be a flat colour with text on it, and the
// owner's one-glance verdict was "this alone makes me not want to play". A
// title screen is the game's first sentence; a static one says nothing. The
// animated backdrop (tower, failing windows, drifting ash), the entrance
// tweens and the title's slow flicker exist so the first frame already says
// what this game is about.
type InputSlot = 'up' | 'down' | 'enter' | 'esc';

export class MenuScene extends Phaser.Scene {
  private optionTexts: Phaser.GameObjects.Text[] = [];
  private optionRows: Phaser.GameObjects.Rectangle[] = [];
  private optionAccents: Phaser.GameObjects.Rectangle[] = [];
  private entries: Array<{ label: string; run: () => void }> = [];
  private selected = 0;
  private cursors!: { up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key };
  private keyEnter!: Phaser.Input.Keyboard.Key;
  private keyEsc!: Phaser.Input.Keyboard.Key;
  private helpOpen = false;
  private helpObjects: PanelObject[] = [];
  private marker!: Phaser.GameObjects.Image;
  private messageText!: Phaser.GameObjects.Text;
  private messageTimer?: Phaser.Time.TimerEvent;
  private lastInputFrame: Record<InputSlot, number> = { up: -1, down: -1, enter: -1, esc: -1 };
  private backdrop?: TitleBackdrop;
  private titleText?: Phaser.GameObjects.Text;
  private subtitleText?: Phaser.GameObjects.Text;
  private menuHint?: Phaser.GameObjects.Text;

  constructor() {
    super('Menu');
  }

  create(): void {
    // Field initialisers do not re-run on scene restart, and the frame counter is
    // monotonic across the session, so a stale slot would never match anyway —
    // reset anyway to keep the per-create state honest.
    this.lastInputFrame = { up: -1, down: -1, enter: -1, esc: -1 };
    // Survives a scene restart; left true, the help panel would still swallow
    // navigation on the fresh title screen.
    this.helpOpen = false;

    const { width, height } = this.cameras.main;
    // Art pass: this rect used to sit at the default depth 0, which is ABOVE
    // every negative-depth backdrop object — the sky, the moon and the tower
    // were all drawn behind an opaque full-screen rectangle, and the title
    // measured as 92% one colour. It goes to the very back now.
    this.add.rectangle(width / 2, height / 2, width, height, 0x121c24).setDepth(-100);

    // The animated backdrop first, so everything else sits above it. Destroyed
    // on shutdown: a scene restart re-runs create(), and the old tower's window
    // rects would otherwise linger on top of the new ones.
    //
    // The painted dorm-corridor render is the default title background — it
    // says "abandoned building at night" in one frame, which is the whole job.
    // The procedural tower stays as the fallback for a build without the asset.
    this.backdrop?.destroy();
    this.backdrop = this.textures.exists(TITLE_BG_KEY)
      ? buildPhotoTitleBackdrop(this, TITLE_BG_KEY, 7)
      : buildTitleBackdrop(this, 7);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.backdrop?.destroy();
      this.backdrop = undefined;
    });

    this.titleText = this.add
      .text(width / 2, 88, '第100000层', { fontFamily: 'monospace', fontSize: '48px', color: hex(PALETTE.lightHigh), stroke: hex(PALETTE.ink), strokeThickness: 6 })
      .setOrigin(0.5);
    // Every piece of title text carries its own dark stroke: the painted
    // backdrop behind it is bright in places, and a stroke keeps the text
    // legible without a scrim heavy enough to bury the painting.
    this.subtitleText = this.add
      .text(width / 2, 150, '末 日 宿 舍', { fontFamily: 'monospace', fontSize: '28px', color: hex(TEXT.primary), stroke: hex(PALETTE.ink), strokeThickness: 4 })
      .setOrigin(0.5);

    this.entries = [{ label: '开始新游戏', run: () => this.startNew() }];
    if (hasSave()) this.entries.push({ label: '继续游戏', run: () => this.continueRun() });
    this.entries.push({ label: '操作说明', run: () => this.toggleHelp() });
    this.selected = 0;

    // Bind input first: waitForScene() reports the scene active as soon as its
    // settings flip, which is before create() finishes. Callers (Playwright
    // startGame, and real players mashing keys during the transition) can
    // otherwise press a key into a scene whose listeners do not exist yet.
    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.cursors = keyboard.addKeys({ up: 'UP', down: 'DOWN' }) as typeof this.cursors;
      this.keyEnter = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
      this.keyEsc = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
      this.cursors.up.on('down', () => this.onNav('up', -1), this);
      this.cursors.down.on('down', () => this.onNav('down', 1), this);
      this.keyEnter.on('down', () => this.onConfirm('enter'), this);
      this.keyEsc.on('down', () => this.onConfirm('esc'), this);
    }

    this.optionTexts = [];
    this.optionRows = [];
    this.optionAccents = [];
    // buildHelp() only pushes, and field initialisers do not re-run on scene
    // restart — without this the help panel accumulates destroyed objects.
    this.helpObjects = [];
    const menuW = 360;
    const menuH = 154;
    const menuX = width / 2;
    const menuY = height / 2 + 66;
    const menuTop = menuY - menuH / 2;
    const menuDepth = PANEL_DEPTH.menu.help;
    buildPanel(this, menuX, menuY, menuW, menuH, 'yellow', menuDepth);
    buildPanelHeader(this, menuX - menuW / 2, menuTop, menuW, '主菜单', UI.accent, menuDepth + 1);
    const rowPitch = 40;
    const firstRowY = menuTop + 20 + (menuH - 20 - this.entries.length * rowPitch) / 2 + rowPitch / 2;
    this.entries.forEach((entry, i) => {
      const rowY = firstRowY + i * rowPitch;
      this.optionRows.push(
        this.add.rectangle(menuX, rowY, menuW - 52, 36, PALETTE.stoneLight).setAlpha(0).setDepth(menuDepth + 3),
      );
      this.optionAccents.push(
        this.add.rectangle(menuX - (menuW - 52) / 2, rowY, 3, 36, UI.accent).setAlpha(0).setDepth(menuDepth + 4),
      );
      const t = this.add
        .text(menuX, rowY, entry.label, { fontFamily: 'monospace', fontSize: `${TYPE.body + 4}px`, color: hex(TEXT.primary), stroke: hex(PALETTE.ink), strokeThickness: 3 })
        .setOrigin(0.5)
        .setDepth(menuDepth + 5);
      this.optionTexts.push(t);
      // Entrance: a fade-in only. An earlier version also settled each entry
      // down 8px, which broke the e2e selection probe — it finds the
      // highlighted entry by comparing the marker's y to the entries' y, and a
      // mid-tween entry reads as "no selection". The backdrop and the title's
      // flicker carry the liveliness; the list just appears.
      t.setAlpha(0);
      this.tweens.add({ targets: t, alpha: 1, duration: 300, delay: 350 + i * 140, ease: 'Cubic.out' });
    });
    this.marker = createMarker(this);
    this.marker.setDepth(menuDepth + 6);
    // The marker breathes once visible so the selection reads as alive. Scale
    // only: refreshOptions() repositions this marker by x/y every time the
    // selection moves, so a positional tween would fight it (and the e2e probe
    // finds the highlighted entry by the marker's position).
    this.marker.setAlpha(0);
    this.tweens.add({ targets: this.marker, alpha: 1, duration: 240, delay: 350 + this.entries.length * 140 });
    this.tweens.add({ targets: this.marker, scaleX: 1.15, scaleY: 1.15, duration: 900, delay: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.refreshOptions();
    this.messageText = this.add
      .text(width / 2, height - 50, '', { fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: hex(TEXT.warn), align: 'center', stroke: hex(PALETTE.ink), strokeThickness: 2 })
      .setOrigin(0.5)
      .setDepth(menuDepth + 8)
      .setVisible(false);
    this.add.rectangle(width / 2, height - 14, width, 28, UI.surface).setAlpha(0.9).setDepth(menuDepth + 1);
    this.menuHint = this.add
      .text(width / 2, height - 14, '↑/↓ 选择 · Enter 确认', { fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: hex(TEXT.secondary) })
      .setOrigin(0.5)
      .setDepth(menuDepth + 2);
    this.buildHelp(width, height);
  }

  // The per-frame life of the title screen: the backdrop's tower drift, window
  // flicker and ash, plus the title's slow power-flicker and the subtitle's
  // breathing. Cheap, and it is the difference between a screenshot and a
  // screen.
  override update(time: number): void {
    this.backdrop?.update(time, this.game.loop.delta);
    if (this.titleText) {
      // A failing light: mostly steady, with an occasional deeper dip. Two
      // incommensurate sines so the pattern never visibly loops.
      const flicker = 0.9 + 0.1 * Math.sin(time * 0.004) * Math.sin(time * 0.0013 + 1.7);
      this.titleText.setAlpha(Math.max(0.55, Math.min(1, flicker)));
    }
    if (this.subtitleText) {
      this.subtitleText.setAlpha(0.78 + 0.22 * Math.sin(time * 0.0016));
    }
  }

  // Phaser can deliver one keydown several times inside a single frame when
  // several keys land in the same queue drain (measured: one ArrowDown arrived
  // three times in frame 28). The event path then advanced the selection once per
  // delivery, skipping a menu entry and leaving 继续游戏 unreachable. Accept each
  // key at most once per frame (GHI-03 m9).
  private accept(slot: InputSlot): boolean {
    const frame = this.game.getFrame();
    if (this.lastInputFrame[slot] === frame) return false;
    this.lastInputFrame[slot] = frame;
    return true;
  }

  private onNav(slot: 'up' | 'down', delta: number): void {
    if (this.helpOpen || !this.accept(slot)) return;
    this.move(delta);
  }

  private onConfirm(slot: 'enter' | 'esc'): void {
    if (!this.accept(slot)) return;
    if (this.helpOpen) {
      this.toggleHelp(); // Enter and Esc both close the help panel
      return;
    }
    if (slot === 'enter') this.activate();
  }

  private refreshOptions(): void {
    this.optionTexts.forEach((t, i) => {
      const isSelected = i === this.selected;
      t.setText(this.entries[i].label).setColor(isSelected ? hex(PALETTE.lightHot) : hex(TEXT.primary));
      this.optionRows[i]?.setAlpha(isSelected ? 0.24 : 0.025);
      this.optionAccents[i]?.setAlpha(isSelected ? 1 : 0);
    });
    const selected = this.optionTexts[this.selected];
    this.marker.setVisible(selected !== undefined);
    if (selected) placeMarker(this.marker, selected);
  }

  private move(delta: number): void {
    this.selected = Phaser.Math.Clamp(this.selected + delta, 0, this.entries.length - 1);
    this.refreshOptions();
    this.hideMessage();
  }

  private activate(): void {
    this.hideMessage();
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
    const state = startNewGame(this.seed());
    // Dev-only: the retired v0.1 dorm scene (floor 100000) stays in the world as
    // the future summit, but it is never a spawn point. Only an explicit
    // ?devfloor= flag starts a run there, and only because it is in
    // DEV_TEST_FLOORS — a normal run always begins on floor 1.
    const devFloor = devEntry().floor;
    if (devFloor !== null) state.currentFloor = devFloor;
    // OVERHAUL Wave B: every run starts with the character pick — the replay
    // engine's front door.
    this.scene.start('MetaSelect');
  }

  private continueRun(): void {
    const result = tryContinue();
    if (!result.ok) {
      // docs/02_TECH_SPEC.md §6: a bad save must say so and keep the new-game
      // entry, never white-screen or silently swallow the keypress.
      this.showMessage(result.error);
      return;
    }
    this.scene.start(result.state.status === 'playing' ? 'Game' : 'End');
  }

  private showMessage(text: string): void {
    this.messageTimer?.remove();
    this.messageText.setText(text).setVisible(true);
    this.messageTimer = this.time.delayedCall(3200, () => this.messageText.setVisible(false));
  }

  private hideMessage(): void {
    this.messageTimer?.remove();
    this.messageTimer = undefined;
    this.messageText.setVisible(false);
  }

  private buildHelp(width: number, height: number): void {
    const panelW = 500;
    const panelH = 260;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;

    const helpDepth = PANEL_DEPTH.menu.help + 70;
    this.helpObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'green', helpDepth));
    this.helpObjects.push(...buildPanelHeader(this, left, top, panelW, '操作说明', UI.good, helpDepth + 1));
    const lines = ['A/D 或 ←/→ 移动', 'E 交互（开箱 / 对话 / 上下楼 / 睡觉）', 'I 背包 · C 制作 · M 塔楼地图 · ESC 暂停', '生命值归零即失败；状态栏显示当前/上限', '目标：从第 1 层爬到第 100000 层的统治核心'];
    const texts = lines.map((line, i) => this.add.text(left + 28, top + 50 + i * 30, line, { fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: hex(TEXT.primary), wordWrap: { width: panelW - 56, useAdvancedWrap: true } }));
    const footer = this.add.text(cx, top + panelH - 48, '按 Enter / ESC 关闭', { fontFamily: 'monospace', fontSize: `${TYPE.caption}px`, color: hex(PALETTE.clothHigh) }).setOrigin(0.5);
    this.helpObjects.push(...texts, footer);
    applyPanelDepth(this.helpObjects, helpDepth + 30);
    for (const o of this.helpObjects) o.setVisible(false);
  }

  private toggleHelp(): void {
    this.helpOpen = !this.helpOpen;
    for (const o of this.helpObjects) o.setVisible(this.helpOpen);
    this.menuHint?.setVisible(!this.helpOpen);
  }
}
