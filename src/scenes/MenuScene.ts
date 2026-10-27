import Phaser from 'phaser';
import { startNewGame, tryContinue } from '../core/session';
import { devEntry } from '../core/devMode';
import { clearSave, hasSave } from '../systems/SaveSystem';
import { playSfx } from '../render/audio';
import { buildPanel, createMarker, placeMarker, type PanelObject } from '../render/panels';

// Title screen: a keyboard-navigable option list — 开始新游戏 / 继续游戏 (when a
// save exists) / 操作说明. ↑/↓ to move, Enter to choose (docs/03_TASKS.md#p0-08).
type InputSlot = 'up' | 'down' | 'enter' | 'esc';

export class MenuScene extends Phaser.Scene {
  private optionTexts: Phaser.GameObjects.Text[] = [];
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
    this.add.rectangle(width / 2, height / 2, width, height, 0x18242c);

    this.add
      .text(width / 2, 92, '第100000层', { fontFamily: 'monospace', fontSize: '40px', color: '#f4b66a', stroke: '#0b0f12', strokeThickness: 6 })
      .setOrigin(0.5);
    this.add.text(width / 2, 138, '末 日 宿 舍', { fontFamily: 'monospace', fontSize: '22px', color: '#ece8d8' }).setOrigin(0.5);

    this.entries = [{ label: '开始新游戏', run: () => this.startNew() }];
    if (hasSave()) this.entries.push({ label: '继续游戏', run: () => this.continueRun() });
    this.entries.push({ label: '操作说明', run: () => this.toggleHelp() });
    this.selected = 0;

    // Phaser does not re-run field initialisers on scene restart, so clear the
    // per-create caches — otherwise they accumulate destroyed objects and
    // refreshOptions() indexes past the end of `entries` (pre-existing bug:
    // 暂停 -> 返回标题 crashed the title screen).
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
    // buildHelp() only pushes, and field initialisers do not re-run on scene
    // restart — without this the help panel accumulates destroyed objects.
    this.helpObjects = [];
    this.entries.forEach((entry, i) => {
      const t = this.add.text(width / 2, 210 + i * 30, entry.label, { fontFamily: 'monospace', fontSize: '18px', color: '#ece8d8' }).setOrigin(0.5);
      this.optionTexts.push(t);
    });
    this.marker = createMarker(this);
    this.refreshOptions();
    this.messageText = this.add
      .text(width / 2, height - 30, '', { fontFamily: 'monospace', fontSize: '13px', color: '#e0705a', align: 'center' })
      .setOrigin(0.5)
      .setVisible(false);
    this.buildHelp(width, height);
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
    this.optionTexts.forEach((t, i) => t.setText(this.entries[i].label));
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
    this.scene.start('Game');
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
    const panelW = 460;
    const panelH = 240;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;

    this.helpObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'green'));
    const title = this.add.text(cx, top + 20, '操作说明', { fontFamily: 'monospace', fontSize: '16px', color: '#f4b66a' }).setOrigin(0.5);
    const lines = ['A/D 或 ←/→ 移动', 'E 交互（开箱 / 对话 / 上下楼 / 睡觉）', 'I 背包 · C 制作 · M 塔楼地图 · ESC 暂停', '目标：从第 1 层爬到第 100000 层的统治核心'];
    const texts = lines.map((line, i) => this.add.text(left + 24, top + 58 + i * 26, line, { fontFamily: 'monospace', fontSize: '13px', color: '#ece8d8' }));
    const footer = this.add.text(cx, top + panelH - 18, '按 Enter / ESC 关闭', { fontFamily: 'monospace', fontSize: '11px', color: '#77c6a4' }).setOrigin(0.5);
    this.helpObjects.push(title, ...texts, footer);
    for (const o of this.helpObjects) o.setScrollFactor(0).setDepth(300).setVisible(false);
  }

  private toggleHelp(): void {
    this.helpOpen = !this.helpOpen;
    for (const o of this.helpObjects) o.setVisible(this.helpOpen);
  }
}
