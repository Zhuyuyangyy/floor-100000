import Phaser from 'phaser';
import { FONT_FAMILY } from '../render/uiKit';

import { PALETTE, TEXT, hex } from '../render/palette.ts';
import { startNewGame, tryContinue } from '../core/session';
import { devEntry } from '../core/devMode';
import { clearSave, hasSave } from '../systems/SaveSystem';
import { playSfx } from '../render/audio';
import { applyPanelDepth, buildPanel, createMarker, PANEL_DEPTH, placeMarker, type PanelObject } from '../render/panels';
import { buildPhotoTitleBackdrop, buildTitleBackdrop, type TitleBackdrop } from '../render/titleBackdrop';
import { TITLE_BG_KEY } from '../render/artpack';
import { hitRect, textClickable } from '../render/pointer';
// AG-75: the About panel's version line comes from the manifest, so a release
// bump can never leave the menu advertising a stale number.
import pkg from '../../package.json';

// Title screen: a keyboard-navigable option list — 开始新游戏 / 继续游戏 (when a
// save exists) / 操作说明 / 关于. ↑/↓ to move, Enter to choose (docs/03_TASKS.md#p0-08).
//
// OVERHAUL: the screen used to be a flat colour with text on it, and the
// owner's one-glance verdict was "this alone makes me not want to play". A
// title screen is the game's first sentence; a static one says nothing. The
// animated backdrop (tower, failing windows, drifting ash), the entrance
// tweens and the title's slow flicker exist so the first frame already says
// what this game is about.
//
// AG-75 (pre-Steam polish): three additions, all in AG-75-marked sections —
//   • a hard offset shadow under the title and subtitle (pixel-art drop shadow,
//     layered Text at a fixed offset — no CSS filter, which would resample the
//     pixel face away);
//   • a standing version tag in the corner (Steam-store etiquette: a player can
//     always tell a support person what build they are on);
//   • an 关于 panel — version, engine, credits — the store-page basic.
// The entry order puts 关于 last so the existing e2e index probes
// (ArrowDown → 操作说明) keep their meaning.
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
  // AG-75: the hard shadows under the two headline texts. Separate objects at a
  // fixed pixel offset — a Text's own stroke is a soft outline, and a CSS
  // shadow filter would blur and resample the pixel font; this cannot.
  // update() keeps their alpha locked to their headline's flicker.
  private titleShadow?: Phaser.GameObjects.Text;
  private subtitleShadow?: Phaser.GameObjects.Text;
  // AG-75: the 关于 panel's state and objects, mirroring the help panel.
  private aboutOpen = false;
  private aboutObjects: PanelObject[] = [];

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
    // Same for the about panel (AG-75).
    this.aboutOpen = false;

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

    // The type scale was authored at 80/44/36, but the fontSize strings used to
    // read `'80pxpx'` — invalid CSS, so Phaser silently rendered everything at
    // its default 16px and the original 30px row pitch looked generous. With the
    // sizes restored, the old coordinates stack the subtitle on top of the
    // headline and the two menu entries on each other. These four numbers are
    // the layout: each block clears the previous block's half-height plus air.
    const TITLE_Y = 116;
    const SUBTITLE_Y = 190;
    const MENU_TOP = 286;
    const MENU_STEP = 56;

    // AG-75: the title's hard shadow. A separate Text at a fixed +3px offset in
    // the palette's ink — the pixel-art way to do a drop shadow. A CSS filter
    // would blur and resample the 80px face; this cannot. Depth -1 keeps it
    // behind the headline (depth 0) and above the backdrop.
    this.titleShadow = this.add
      .text(width / 2 + 3, TITLE_Y + 3, '第100000层', { fontFamily: FONT_FAMILY, fontSize: '80px', color: hex(PALETTE.ink) })
      .setOrigin(0.5)
      .setDepth(-1)
      .setAlpha(0.55);
    this.titleText = this.add
      .text(width / 2, TITLE_Y, '第100000层', { fontFamily: FONT_FAMILY, fontSize: '80px', color: hex(PALETTE.lightHigh), stroke: hex(PALETTE.ink), strokeThickness: 6 })
      .setOrigin(0.5);
    // Every piece of title text carries its own dark stroke: the painted
    // backdrop behind it is bright in places, and a stroke keeps the text
    // legible without a scrim heavy enough to bury the painting.
    this.subtitleShadow = this.add
      .text(width / 2 + 2, SUBTITLE_Y + 2, '末 日 宿 舍', { fontFamily: FONT_FAMILY, fontSize: '44px', color: hex(PALETTE.ink) })
      .setOrigin(0.5)
      .setDepth(-1)
      .setAlpha(0.5);
    this.subtitleText = this.add
      .text(width / 2, SUBTITLE_Y, '末 日 宿 舍', { fontFamily: FONT_FAMILY, fontSize: '44px', color: hex(TEXT.primary), stroke: hex(PALETTE.ink), strokeThickness: 4 })
      .setOrigin(0.5);

    this.entries = [{ label: '开始新游戏', run: () => this.startNew() }];
    if (hasSave()) this.entries.push({ label: '继续游戏', run: () => this.continueRun() });
    this.entries.push({ label: '操作说明', run: () => this.toggleHelp() });
    // AG-75: 关于 goes last — after 操作说明 — so every existing e2e index
    // probe (ArrowDown → 操作说明) keeps its meaning.
    this.entries.push({ label: '关于', run: () => this.toggleAbout() });
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
    // Same reset for the about panel (AG-75).
    this.aboutObjects = [];
    this.entries.forEach((entry, i) => {
      const t = this.add
        .text(width / 2, MENU_TOP + i * MENU_STEP, entry.label, { fontFamily: FONT_FAMILY, fontSize: '36px', color: hex(TEXT.primary), stroke: hex(PALETTE.ink), strokeThickness: 3 })
        .setOrigin(0.5);
      this.optionTexts.push(t);
      // Mouse: hover moves the cursor, click does what Enter does. The e2e probe
      // reads the marker's y, so hover has to go through refreshOptions() rather
      // than styling the text alone.
      textClickable(t, hex(TEXT.primary), hex(PALETTE.lightHigh), {
        onOver: () => {
          if (this.helpOpen || this.aboutOpen) return;
          this.selected = i;
          this.refreshOptions();
          this.hideMessage();
        },
        onClick: () => {
          this.selected = i;
          this.refreshOptions();
          this.activate();
        },
      });
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
      .text(width / 2, height - 30, '', { fontFamily: FONT_FAMILY, fontSize: '26px', color: hex(TEXT.warn), align: 'center' })
      .setOrigin(0.5)
      .setVisible(false);
    // AG-75: the standing version tag, bottom-right. A shipped game's menu
    // tells you what build you are on — it is the first thing a Steam support
    // thread asks for. Small and dim: present, never competing with the menu.
    this.add
      .text(width - 16, height - 22, `v${pkg.version}`, { fontFamily: FONT_FAMILY, fontSize: '20px', color: hex(TEXT.dim) })
      .setOrigin(1, 0.5);
    this.buildHelp(width, height);
    this.buildAbout(width, height);
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
      // AG-75: the shadow shares the headline's flicker — a shadow that stayed
      // steady while its light dipped would read as a second, darker title.
      this.titleShadow?.setAlpha(Math.max(0.3, Math.min(0.55, flicker * 0.55)));
    }
    if (this.subtitleText) {
      this.subtitleText.setAlpha(0.78 + 0.22 * Math.sin(time * 0.0016));
      this.subtitleShadow?.setAlpha((0.78 + 0.22 * Math.sin(time * 0.0016)) * 0.6);
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
    // AG-75: the about panel swallows navigation the same way the help panel
    // does — Enter and Esc both close it, arrows do not move the cursor
    // behind it.
    if (this.helpOpen || this.aboutOpen || !this.accept(slot)) return;
    this.move(delta);
  }

  private onConfirm(slot: 'enter' | 'esc'): void {
    if (!this.accept(slot)) return;
    if (this.helpOpen) {
      this.toggleHelp(); // Enter and Esc both close the help panel
      return;
    }
    if (this.aboutOpen) {
      this.toggleAbout(); // ...and the about panel (AG-75)
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
    // A 10px pixel face at 22px is a full-width Han glyph, so the old 460px
    // panel with 26px text and a 26px row pitch had long lines running straight
    // through the frame and the rows touching. Wider panel, one size down, and a
    // row pitch that leaves air under the descenders.
    const panelW = 580;
    const panelH = 260;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;

    this.helpObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'green', PANEL_DEPTH.menu.help));
    const title = this.add.text(cx, top + 26, '操作说明', { fontFamily: FONT_FAMILY, fontSize: '30px', color: hex(PALETTE.lightHigh) }).setOrigin(0.5);
    const lines = [
      'A/D 或 ←/→ 移动 · E 交互',
      'E 交互：开箱 / 对话 / 楼梯 / 睡觉',
      'I 背包 · C 制作 · M 地图 · ESC 暂停',
      '鼠标：点选项 · 点地面走动 · 点物品交互',
      '目标：爬到第 100000 层',
    ];
    const texts = lines.map((line, i) => this.add.text(left + 24, top + 72 + i * 38, line, { fontFamily: FONT_FAMILY, fontSize: '22px', color: hex(TEXT.primary) }));
    const footer = this.add.text(cx, top + panelH - 30, '按 Enter / ESC 关闭', { fontFamily: FONT_FAMILY, fontSize: '20px', color: hex(PALETTE.clothHigh) }).setOrigin(0.5);
    // Click anywhere on the panel to dismiss it, the same as Enter / ESC.
    const dismiss = hitRect(this, left, top, panelW, panelH, PANEL_DEPTH.menu.help + 6, {
      onClick: () => {
        if (this.helpOpen) this.toggleHelp();
      },
    });
    this.helpObjects.push(title, ...texts, footer, dismiss);
    applyPanelDepth(this.helpObjects, PANEL_DEPTH.menu.help);
    // The dismiss rect must stay above the panel art it covers.
    dismiss.setDepth(PANEL_DEPTH.menu.help + 6);
    for (const o of this.helpObjects) o.setVisible(false);
  }

  private toggleHelp(): void {
    this.helpOpen = !this.helpOpen;
    for (const o of this.helpObjects) o.setVisible(this.helpOpen);
  }

  // ── AG-75: the about panel ───────────────────────────────────────────────
  // The store-page basic: what this game is, what build this is, what engine
  // runs it, whose art is in it. Built exactly like the help panel — same
  // frame, same dismiss paths (Enter / Esc / click), same hidden-by-default
  // pool — so the two can never drift apart in behaviour.
  private buildAbout(width: number, height: number): void {
    const panelW = 560;
    const panelH = 300;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;

    this.aboutObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'green', PANEL_DEPTH.menu.help));
    const title = this.add.text(cx, top + 28, '关于', { fontFamily: FONT_FAMILY, fontSize: '30px', color: hex(PALETTE.lightHigh) }).setOrigin(0.5);
    const lines: Array<[string, string]> = [
      ['第100000层：末日宿舍', hex(TEXT.primary)],
      [`版本 v${pkg.version} · 引擎 Phaser ${Phaser.VERSION}`, hex(TEXT.secondary)],
      ['', hex(TEXT.primary)],
      ['像素 UI / 音效素材：Kenney（CC0 1.0）', hex(TEXT.secondary)],
      ['字体：Noto Sans SC 子集（SIL OFL）', hex(TEXT.secondary)],
      ['程序化贴图：本项目工具链生成', hex(TEXT.secondary)],
      ['', hex(TEXT.primary)],
      ['完整许可信息见 THIRD_PARTY_NOTICES.md', hex(TEXT.dim)],
    ];
    const texts = lines.map(([line, color], i) =>
      this.add.text(left + 28, top + 78 + i * 26, line, { fontFamily: FONT_FAMILY, fontSize: '20px', color }),
    );
    const footer = this.add
      .text(cx, top + panelH - 26, '按 Enter / ESC 关闭', { fontFamily: FONT_FAMILY, fontSize: '18px', color: hex(PALETTE.clothHigh) })
      .setOrigin(0.5);
    const dismiss = hitRect(this, left, top, panelW, panelH, PANEL_DEPTH.menu.help + 6, {
      onClick: () => {
        if (this.aboutOpen) this.toggleAbout();
      },
    });
    this.aboutObjects.push(title, ...texts, footer, dismiss);
    applyPanelDepth(this.aboutObjects, PANEL_DEPTH.menu.help);
    dismiss.setDepth(PANEL_DEPTH.menu.help + 6);
    for (const o of this.aboutObjects) o.setVisible(false);
  }

  private toggleAbout(): void {
    this.aboutOpen = !this.aboutOpen;
    for (const o of this.aboutObjects) o.setVisible(this.aboutOpen);
  }
}
