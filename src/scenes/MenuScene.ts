import Phaser from 'phaser';
import { startNewGame, tryContinue } from '../core/session';
import { devEntry } from '../core/devMode';
import { clearSave, hasSave } from '../systems/SaveSystem';
import { playSfx } from '../render/audio';
import { applyPanelDepth, buildPanel, createMarker, PANEL_DEPTH, placeMarker, type PanelObject } from '../render/panels';
import { buildTitleBackdrop, type TitleBackdrop } from '../render/titleBackdrop';

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
    this.add.rectangle(width / 2, height / 2, width, height, 0x121c24);

    // The animated backdrop first, so everything else sits above it. Destroyed
    // on shutdown: a scene restart re-runs create(), and the old tower's window
    // rects would otherwise linger on top of the new ones.
    this.backdrop?.destroy();
    this.backdrop = buildTitleBackdrop(this, 7);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.backdrop?.destroy();
      this.backdrop = undefined;
    });

    this.titleText = this.add
      .text(width / 2, 92, '第100000层', { fontFamily: 'monospace', fontSize: '40px', color: '#f4b66a', stroke: '#0b0f12', strokeThickness: 6 })
      .setOrigin(0.5);
    this.subtitleText = this.add.text(width / 2, 138, '末 日 宿 舍', { fontFamily: 'monospace', fontSize: '22px', color: '#ece8d8' }).setOrigin(0.5);

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
    // buildHelp() only pushes, and field initialisers do not re-run on scene
    // restart — without this the help panel accumulates destroyed objects.
    this.helpObjects = [];
    this.entries.forEach((entry, i) => {
      const t = this.add.text(width / 2, 210 + i * 30, entry.label, { fontFamily: 'monospace', fontSize: '18px', color: '#ece8d8' }).setOrigin(0.5);
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
    // The marker breathes once visible so the selection reads as alive. Scale
    // only: refreshOptions() repositions this marker by x/y every time the
    // selection moves, so a positional tween would fight it (and the e2e probe
    // finds the highlighted entry by the marker's position).
    this.marker.setAlpha(0);
    this.tweens.add({ targets: this.marker, alpha: 1, duration: 240, delay: 350 + this.entries.length * 140 });
    this.tweens.add({ targets: this.marker, scaleX: 1.15, scaleY: 1.15, duration: 900, delay: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.refreshOptions();
    this.messageText = this.add
      .text(width / 2, height - 30, '', { fontFamily: 'monospace', fontSize: '13px', color: '#e0705a', align: 'center' })
      .setOrigin(0.5)
      .setVisible(false);
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
    const panelW = 460;
    const panelH = 240;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;

    this.helpObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'green', PANEL_DEPTH.menu.help));
    const title = this.add.text(cx, top + 20, '操作说明', { fontFamily: 'monospace', fontSize: '16px', color: '#f4b66a' }).setOrigin(0.5);
    const lines = ['A/D 或 ←/→ 移动', 'E 交互（开箱 / 对话 / 上下楼 / 睡觉）', 'I 背包 · C 制作 · M 塔楼地图 · ESC 暂停', '目标：从第 1 层爬到第 100000 层的统治核心'];
    const texts = lines.map((line, i) => this.add.text(left + 24, top + 58 + i * 26, line, { fontFamily: 'monospace', fontSize: '13px', color: '#ece8d8' }));
    const footer = this.add.text(cx, top + panelH - 18, '按 Enter / ESC 关闭', { fontFamily: 'monospace', fontSize: '11px', color: '#77c6a4' }).setOrigin(0.5);
    this.helpObjects.push(title, ...texts, footer);
    applyPanelDepth(this.helpObjects, PANEL_DEPTH.menu.help);
    for (const o of this.helpObjects) o.setVisible(false);
  }

  private toggleHelp(): void {
    this.helpOpen = !this.helpOpen;
    for (const o of this.helpObjects) o.setVisible(this.helpOpen);
  }
}
