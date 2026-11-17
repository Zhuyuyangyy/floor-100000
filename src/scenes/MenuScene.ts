import Phaser from 'phaser';
import { FONT_FAMILY, TYPE, UI, buildPanelHeader, drawStatBar, buildPanelWell } from '../render/uiKit';

import { PALETTE, TEXT, hex } from '../render/palette.ts';
import { startNewGame, tryContinue } from '../core/session';
import { devEntry } from '../core/devMode';
import { clearSave, hasSave } from '../systems/SaveSystem';
import { playSfx } from '../render/audio';
// AG-74：BGM 音乐层。菜单是音频的入口——这里惰性建 AudioContext（suspended
// 态诞生不违规），首次点击/按键时 resume 并播主菜单 BGM；离开菜单（SHUTDOWN）
// 静默。游戏内音乐由 GameScene 的 startFloorMusic 接管。
import { startMenuBgm, stopBgm } from '../systems/AudioSystem';
import {
  LANGUAGE_LABELS,
  TEXT_SPEEDS,
  TEXT_SPEED_LABELS,
  VOLUME_STEP,
  getSettings,
  resetSettings,
  updateSettings,
} from '../systems/SettingsSystem';
import { applyPanelDepth, buildPanel, createMarker, PANEL_DEPTH, placeMarker, type PanelObject } from '../render/panels';
import { buildPhotoTitleBackdrop, buildTitleBackdrop, type TitleBackdrop } from '../render/titleBackdrop';
import { TITLE_BG_KEY } from '../render/artpack';
import { hitRect, textClickable } from '../render/pointer';
// AG-75: the About panel's version line comes from the manifest, so a release
// bump can never leave the menu advertising a stale number.
import pkg from '../../package.json';
import { SETTINGS_PANEL } from '../render/hudLayout';
import { ACHIEVEMENTS, type AchievementDef } from '../data/achievements';
import { achievementProgress, loadAchievements, type AchievementSave } from '../systems/AchievementSystem';
import { ACHIEVEMENT_TIER_COLOR } from '../render/achievementSkin';

// Title screen: a keyboard-navigable option list — 开始新游戏 / 继续游戏 (when a
// save exists) / 操作说明 / 关于 (AG-75) / 设置 (AG-72). ↑/↓ to move, Enter to
// choose (docs/03_TASKS.md#p0-08).
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
// AG-72 加 left/right 两个槽：设置覆盖层开着时 ←/→ 调音量/档位，标题屏上
// 空转（与以前一致）。
type InputSlot = 'up' | 'down' | 'left' | 'right' | 'enter' | 'esc';

// ── AG-77：成就查看面板的几何 ─────────────────────────────────────────────
// 十四条一行Rows：档位章 + 名称 + 右侧状态（已解锁/进度），选中行的说明沉在
// 底部详情井。高度按内容钉：标题栏 30 + 14×26 行 + 详情井 64 + 页脚 24，
// 居中后上下各留 ~100px，不出画布（三视口由 Scale.FIT letterbox 消化，
// 设计像素不动）。行距用 ROW_H——与游戏内列表同一行高。
const ACH_PANEL_W = 680;
const ACH_ROW_H = 26;
const ACH_ROWS_TOP = 62;
const ACH_DETAIL_H = 64;

export class MenuScene extends Phaser.Scene {
  private optionTexts: Phaser.GameObjects.Text[] = [];
  private entries: Array<{ label: string; run: () => void }> = [];
  private selected = 0;
  private cursors!: { up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key };
  private keyEnter!: Phaser.Input.Keyboard.Key;
  private keyEsc!: Phaser.Input.Keyboard.Key;
  private keyLeft!: Phaser.Input.Keyboard.Key;
  private keyRight!: Phaser.Input.Keyboard.Key;
  private helpOpen = false;
  private helpObjects: PanelObject[] = [];
  // AG-72: the settings overlay. Same show/hide pattern as the help panel
  // (one flat object list), driven by the shared SettingsPanelView below.
  private settingsOpen = false;
  private settingsPanel!: SettingsPanelView;
  private marker!: Phaser.GameObjects.Image;
  private messageText!: Phaser.GameObjects.Text;
  private messageTimer?: Phaser.Time.TimerEvent;
  private lastInputFrame: Record<InputSlot, number> = { up: -1, down: -1, left: -1, right: -1, enter: -1, esc: -1 };
  private backdrop?: TitleBackdrop;
  private titleText?: Phaser.GameObjects.Text;
  private subtitleText?: Phaser.GameObjects.Text;
  // AG-75: the hard shadows under the two headline texts. Separate objects at a
  // fixed pixel offset — a Text's own stroke is a soft outline, and a CSS
  // shadow filter would blur and resample the pixel font; this cannot.
  // update() keeps their alpha locked to their headline's flicker.
  private titleShadow?: Phaser.GameObjects.Text;
  private subtitleShadow?: Phaser.GameObjects.Text;
  // AG-75: 关于 panel's state and objects, mirroring the help panel.
  private aboutOpen = false;
  private aboutObjects: PanelObject[] = [];
  // ── AG-77: the achievements cabinet ─────────────────────────────────────
  // A riveted list of the fourteen cross-run achievements, read from the same
  // independent localStorage key GameScene writes to (floor100000.achievements.v1).
  // Re-read on every open: a run may have unlocked more since the last visit.
  private achievementsOpen = false;
  private achievementObjects: PanelObject[] = [];
  private achievementSelected = 0;
  private achievementRows: Array<{
    def: AchievementDef;
    chip: Phaser.GameObjects.Rectangle;
    nameText: Phaser.GameObjects.Text;
    statusText: Phaser.GameObjects.Text;
  }> = [];
  private achievementBand?: Phaser.GameObjects.Rectangle;
  private achievementDetailText?: Phaser.GameObjects.Text;
  private achievementCountText?: Phaser.GameObjects.Text;

  constructor() {
    super('Menu');
  }

  create(): void {
    // Field initialisers do not re-run on scene restart, and the frame counter is
    // monotonic across the session, so a stale slot would never match anyway —
    // reset anyway to keep the per-create state honest.
    this.lastInputFrame = { up: -1, down: -1, left: -1, right: -1, enter: -1, esc: -1 };
    // Survives a scene restart; left true, the help panel would still swallow
    // navigation on the fresh title screen.
    this.helpOpen = false;
    // The settings overlay is rebuilt below, so it starts closed — a restart
    // must not come back with the panel already up (and its old objects dead).
    this.settingsOpen = false;

    // AG-74：主菜单 BGM。幂等——从游戏返回菜单再进 create 只是续播同一首。
    startMenuBgm();
    // Same for the about panel (AG-75).
    this.aboutOpen = false;
    // AG-77：同理——成就面板开着重启会吞掉 ↑/↓。
    this.achievementsOpen = false;

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
      stopBgm(); // AG-74：离开标题画面——楼层音乐由 GameScene.create 接管
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
    // AG-77：成就在标题屏的入口（奖杯柜不该埋在游戏里）。
    this.entries.push({ label: '成就', run: () => this.toggleAchievements() });
    this.entries.push({ label: '操作说明', run: () => this.toggleHelp() });
    // AG-75: 关于 / AG-72: 设置 都挂在 操作说明 之后——前三个入口的键盘/鼠标
    // 序号（以及存量 e2e 的「ArrowDown → 继续游戏 / 操作说明」导航）一个都不动。
    this.entries.push({ label: '关于', run: () => this.toggleAbout() });
    this.entries.push({ label: '设置', run: () => this.toggleSettings() });
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
      this.keyLeft = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
      this.keyRight = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
      this.cursors.up.on('down', () => this.onNav('up', -1), this);
      this.cursors.down.on('down', () => this.onNav('down', 1), this);
      this.keyEnter.on('down', () => this.onConfirm('enter'), this);
      this.keyEsc.on('down', () => this.onConfirm('esc'), this);
      // AG-72: ←/→ only mean anything while the settings overlay is up (volume
      // steps, toggles,档位). On the plain title screen they do nothing, the
      // same as before.
      this.keyLeft.on('down', () => {
        if (this.settingsOpen && this.accept('left')) this.settingsPanel.adjust(-1);
      }, this);
      this.keyRight.on('down', () => {
        if (this.settingsOpen && this.accept('right')) this.settingsPanel.adjust(1);
      }, this);
    }

    this.optionTexts = [];
    // buildHelp() only pushes, and field initialisers do not re-run on scene
    // restart — without this the help panel accumulates destroyed objects.
    this.helpObjects = [];
    // Same reset for the about panel (AG-75).
    this.aboutObjects = [];
    // AG-77：成就面板同上（buildAchievements 只 push）。
    this.achievementObjects = [];
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
          if (this.helpOpen || this.aboutOpen || this.settingsOpen || this.achievementsOpen) return;
          this.selected = i;
          this.refreshOptions();
          this.hideMessage();
        },
        onClick: () => {
          if (this.settingsOpen) return; // the overlay owns the pointer
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
    this.buildHelp(width, height);
    this.buildAbout(width, height);
    this.buildSettings(width, height);
    // AG-77：成就面板与帮助面板同宗——只建一次，开时重挂内容。
    this.buildAchievements(width, height);
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
    // 裁决记录（merge ag-77）：HEAD 侧为 AG-72/75 的 settings/about 导航守卫
    // （更新的演化），ag-77 侧成就面板分支并入——与 settings 同款「面板开着
    // 走自己的光标，不动标题菜单」语义，helpOpen 守卫由总守卫一并覆盖。
    // AG-72: while the settings overlay is up, ↑/↓ walk its rows instead of the
    // title list behind it — the same guard helpOpen already uses.
    if (this.settingsOpen) {
      if (this.accept(slot)) this.settingsPanel.move(delta);
      return;
    }
    // AG-77：面板开着时 ↑/↓ 在成就里移光标，不动标题菜单。
    if (this.achievementsOpen) {
      this.moveAchievement(delta);
      return;
    }
    // AG-75: the about panel swallows navigation the same way the help panel
    // does — Enter and Esc both close it, arrows do not move the cursor
    // behind it. AG-77: achievementsOpen joins the same swallow.
    if (this.helpOpen || this.aboutOpen || this.settingsOpen || this.achievementsOpen || !this.accept(slot)) return;
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
    // AG-77：Enter 与 Esc 都关成就面板（与操作说明同一套键位）。
    if (this.achievementsOpen) {
      this.toggleAchievements();
      return;
    }
    if (this.settingsOpen) {
      // Enter activates the highlighted row; Esc is 返回 (the panel's own last
      // row does the same thing for the mouse).
      if (slot === 'esc') this.toggleSettings();
      else this.settingsPanel.activateSelected();
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

  // ── AG-72: the settings overlay ─────────────────────────────────────────
  // Built once per create() like the help panel (field initialisers do not
  // re-run on scene restart, so the object list is rebuilt here and starts
  // hidden). The controller itself is stateless between opens — it re-reads
  // SettingsSystem on every refresh, so a change made from the pause menu's
  // SettingsScene shows up here too.
  private buildSettings(width: number, height: number): void {
    this.settingsPanel = new SettingsPanelView(this, PANEL_DEPTH.menu.help, () => this.toggleSettings());
    this.settingsPanel.build(width, height);
  }

  private toggleSettings(): void {
    this.settingsOpen = !this.settingsOpen;
    this.settingsPanel.setVisible(this.settingsOpen);
    if (this.settingsOpen) this.settingsPanel.refresh();
  }

  // ── AG-77: the achievements cabinet ─────────────────────────────────────
  /** Enter/Esc/点击：开合。每次开都重读存档——这一跑可能又亮了几条。 */
  private toggleAchievements(): void {
    this.achievementsOpen = !this.achievementsOpen;
    if (this.achievementsOpen) {
      this.achievementSelected = 0;
      this.refreshAchievements();
    }
    for (const o of this.achievementObjects) o.setVisible(this.achievementsOpen);
    if (!this.achievementsOpen) this.hideMessage();
  }

  /** ↑/↓：在十四条里移光标（循环不循环？不循环——到底就停，与菜单一致）。 */
  private moveAchievement(delta: number): void {
    this.achievementSelected = Phaser.Math.Clamp(this.achievementSelected + delta, 0, ACHIEVEMENTS.length - 1);
    this.refreshAchievements();
  }

  /**
   * 重挂面板内容：从独立键读档，逐行刷名称/状态/详情。开合不重建对象
   * （与 help 同一理由：场景重启复用实例，字段初始化器不重跑）。
   */
  private refreshAchievements(): void {
    const save: AchievementSave = loadAchievements();
    let unlockedCount = 0;
    this.achievementRows.forEach((row) => {
      const unlocked = save.unlocked.includes(row.def.id);
      if (unlocked) unlockedCount += 1;
      const color = unlocked ? hex(PALETTE.lightHigh) : hex(TEXT.secondary);
      row.nameText.setColor(color);
      row.statusText.setText(unlocked ? '已解锁' : achievementProgress(save, row.def.id));
      row.statusText.setColor(unlocked ? hex(PALETTE.lightHigh) : hex(TEXT.dim));
      row.chip.setFillStyle(ACHIEVEMENT_TIER_COLOR[row.def.tier], unlocked ? 1 : 0.45);
    });
    if (this.achievementCountText) this.achievementCountText.setText(`已解锁 ${unlockedCount}/${ACHIEVEMENTS.length}`);
    const selected = this.achievementRows[this.achievementSelected];
    if (this.achievementDetailText) this.achievementDetailText.setText(selected?.def.description ?? '');
    if (this.achievementBand && selected) {
      this.achievementBand.setPosition(0, ACH_ROWS_TOP + this.achievementSelected * ACH_ROW_H);
      this.achievementBand.setVisible(true);
    }
  }

  /** 面板只建一次（create 里调），内容每次开面板时由 refreshAchievements 重挂。 */
  private buildAchievements(width: number, height: number): void {
    const panelH = ACH_ROWS_TOP + ACHIEVEMENTS.length * ACH_ROW_H + 12 + ACH_DETAIL_H + 30;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - ACH_PANEL_W / 2;
    const top = cy - panelH / 2;

    this.achievementObjects.push(...buildPanel(this, cx, cy, ACH_PANEL_W, panelH, 'yellow', PANEL_DEPTH.menu.help));
    const title = this.add.text(cx, top + 26, '成就', { fontFamily: FONT_FAMILY, fontSize: '30px', color: hex(PALETTE.lightHigh) }).setOrigin(0.5);
    this.achievementCountText = this.add
      .text(left + ACH_PANEL_W - 20, top + 26, '', { fontFamily: FONT_FAMILY, fontSize: '20px', color: hex(TEXT.dim) })
      .setOrigin(1, 0.5)
      .setName('achievement-count');
    this.achievementObjects.push(title, this.achievementCountText);

    // 选中行的整幅淡洗 + 左筋（与 uiKit buildListRow 的选中语言同款）。
    this.achievementBand = this.add
      .rectangle(left, top + ACH_ROWS_TOP, ACH_PANEL_W - 32, ACH_ROW_H, PALETTE.lightHigh)
      .setOrigin(0, 0)
      .setAlpha(0.13)
      .setVisible(false);
    this.achievementObjects.push(this.achievementBand);

    this.achievementRows = [];
    ACHIEVEMENTS.forEach((def, i) => {
      const y = top + ACH_ROWS_TOP + i * ACH_ROW_H;
      const cy2 = y + ACH_ROW_H / 2;
      const chip = this.add.rectangle(left + 20, cy2, 10, 10, ACHIEVEMENT_TIER_COLOR[def.tier]).setOrigin(0.5);
      const nameText = this.add
        .text(left + 40, cy2, def.name, { fontFamily: FONT_FAMILY, fontSize: '20px', color: hex(TEXT.secondary) })
        .setOrigin(0, 0.5)
        .setName('achievement-row-name');
      const statusText = this.add
        .text(left + ACH_PANEL_W - 20, cy2, '', { fontFamily: FONT_FAMILY, fontSize: '20px', color: hex(TEXT.dim) })
        .setOrigin(1, 0.5)
        .setName('achievement-row-status');
      // 行点击 = 把光标移到这行（与 ↑/↓ 同一效果）；不做「点击即关」——
      // 十四条挤在一起，误触一列就关面板太容易丢上下文。
      const hit = hitRect(this, left + 8, y, ACH_PANEL_W - 16, ACH_ROW_H, PANEL_DEPTH.menu.help + 6, {
        onClick: () => {
          if (!this.achievementsOpen) return;
          this.achievementSelected = i;
          this.refreshAchievements();
        },
      });
      this.achievementRows.push({ def, chip, nameText, statusText });
      this.achievementObjects.push(chip, nameText, statusText, hit);
    });

    // 详情井：选中行的一句话说明（说明写满两行也装得下——20px 两行 50px < 64）。
    const detailTop = top + ACH_ROWS_TOP + ACHIEVEMENTS.length * ACH_ROW_H + 12;
    this.achievementObjects.push(
      ...buildPanelWell(this, left + 16, detailTop, ACH_PANEL_W - 32, ACH_DETAIL_H, PANEL_DEPTH.menu.help),
    );
    this.achievementDetailText = this.add
      .text(left + 28, detailTop + 12, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '20px',
        color: hex(TEXT.primary),
        wordWrap: { width: ACH_PANEL_W - 56 },
      })
      .setName('achievement-detail');
    this.achievementObjects.push(this.achievementDetailText);

    const footer = this.add
      .text(cx, top + panelH - 16, '↑/↓ 选择 · Enter / Esc 关闭', { fontFamily: FONT_FAMILY, fontSize: '20px', color: hex(PALETTE.clothHigh) })
      .setOrigin(0.5);
    this.achievementObjects.push(footer);

    applyPanelDepth(this.achievementObjects, PANEL_DEPTH.menu.help);
    for (const o of this.achievementObjects) o.setVisible(false);
  }
}

// ── AG-72: the settings panel, shared by two hosts ─────────────────────────
//
// 上架 Steam 的硬缺口：游戏此前没有任何设置入口。面板七行——SFX 音量 /
// BGM 音量 / 震屏 / 文本速度 / 语言 + 恢复默认 + 返回——延用铆钉板语言
// （buildPanel + buildPanelHeader + drawStatBar 分段滑条），几何钉在
// render/hudLayout.ts 的 SETTINGS_PANEL。
//
// 两个宿主共用这一个控制器：
//   * MenuScene —— 标题屏的覆盖层面板（与「操作说明」同款的显隐模式）；
//   * SettingsScene —— 暂停菜单「设置」入口的独立场景（GameScene 停场
//     交接，返回 Game 时模块级 GameState 不丢——塔楼地图同款契约）。
//
// 所有读写走 systems/SettingsSystem（localStorage `floor100000.settings`，
// 坏 JSON/坏字段回退默认）：每次调整即时生效 + 即时持久化。音量行调整后
// 会以新音量播一声 click——滑到 0 就是静默，反馈即所见。
type SettingsRowKind = 'volume' | 'toggle' | 'cycle' | 'action';

interface SettingsRowDef {
  kind: SettingsRowKind;
  label: string;

}

const SETTINGS_ROWS: SettingsRowDef[] = [
  { kind: 'volume', label: 'SFX 音量' },
  { kind: 'volume', label: 'BGM 音量' },
  { kind: 'toggle', label: '震屏' },
  { kind: 'cycle', label: '文本速度' },
  { kind: 'cycle', label: '语言' },
  { kind: 'action', label: '恢复默认' },
  { kind: 'action', label: '返回' },
];

const SETTINGS_HINT = '↑/↓ 选择 · ←/→ 调整 · Enter 确认 · ESC 返回';

class SettingsPanelView {
  private readonly scene: Phaser.Scene;
  private readonly depth: number;
  private readonly onBack: () => void;
  private objects: PanelObject[] = [];
  private labels: Phaser.GameObjects.Text[] = [];
  /** Sparse by row index: the two action rows have no value column. */
  private values: Array<Phaser.GameObjects.Text | undefined> = [];
  /** Sparse by row index: only adjustable rows carry arrows (语言 is single-option). */
  private arrows: Array<{ left: Phaser.GameObjects.Text; right: Phaser.GameObjects.Text } | undefined> = [];
  private barGfx?: Phaser.GameObjects.Graphics;
  private hintText?: Phaser.GameObjects.Text;
  private marker?: Phaser.GameObjects.Image;
  private messageTimer?: Phaser.Time.TimerEvent;
  private selected = 0;

  constructor(scene: Phaser.Scene, depth: number, onBack: () => void) {
    this.scene = scene;
    this.depth = depth;
    this.onBack = onBack;
  }

  build(width: number, height: number): void {
    this.messageTimer?.remove();
    this.messageTimer = undefined;
    const cx = width / 2;
    const cy = height / 2;
    const panelW = SETTINGS_PANEL.w;
    const panelH = SETTINGS_PANEL.h;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;

    this.objects.push(...buildPanel(this.scene, cx, cy, panelW, panelH, 'green', this.depth));
    this.objects.push(...buildPanelHeader(this.scene, left, top, panelW, '设置', UI.good, this.depth + 5));

    // One Graphics for both volume bars; refresh() clears and redraws it.
    this.barGfx = this.scene.add.graphics().setScrollFactor(0);
    this.objects.push(this.barGfx);

    this.hintText = this.scene.add
      .text(cx, top + SETTINGS_PANEL.footY, SETTINGS_HINT, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(PALETTE.clothHigh) })
      .setOrigin(0.5)
      .setScrollFactor(0);
    this.objects.push(this.hintText);

    // A full-panel swallow rect: the title entries behind the overlay are still
    // interactive, and a click in the gap between rows must not leak through to
    // them (the help panel's dismiss rect plays the same role). Created BEFORE
    // the rows so the rows' own hit targets stay on top of it — Phaser picks the
    // topmost interactive object under the pointer.
    this.objects.push(hitRect(this.scene, left, top, panelW, panelH, this.depth + 1, { onClick: () => undefined }));

    this.labels = [];
    this.values = [];
    this.arrows = [];
    SETTINGS_ROWS.forEach((row, i) => {
      const rowTop = top + SETTINGS_PANEL.rowsTop + i * SETTINGS_PANEL.rowPitch;
      const rowCY = rowTop + SETTINGS_PANEL.rowH / 2;
      const label = this.scene.add
        .text(left + SETTINGS_PANEL.labelX, rowCY, row.label, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: hex(TEXT.primary) })
        .setOrigin(0, 0.5)
        .setScrollFactor(0);
      this.labels.push(label);
      this.objects.push(label);

      if (row.kind !== 'action') {
        // 语言是唯一选项：值压暗且不给箭头，「框架已就位、暂无 English」。
        const dim = row.label === '语言';
        const value = this.scene.add
          .text(left + SETTINGS_PANEL.valueX, rowCY, this.valueOf(i), { fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: dim ? hex(TEXT.dim) : hex(TEXT.highlight) })
          .setOrigin(0, 0.5)
          .setScrollFactor(0);
        this.values[i] = value;
        this.objects.push(value);
      }

      if (row.kind !== 'action' && row.label !== '语言') {
        const arrowL = this.scene.add
          .text(left + SETTINGS_PANEL.arrowLX, rowCY, '◀', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(PALETTE.clothHigh) })
          .setOrigin(0.5)
          .setScrollFactor(0);
        const arrowR = this.scene.add
          .text(left + SETTINGS_PANEL.arrowRX, rowCY, '▶', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(PALETTE.clothHigh) })
          .setOrigin(0.5)
          .setScrollFactor(0);
        this.arrows[i] = { left: arrowL, right: arrowR };
        this.objects.push(arrowL, arrowR);
        // Arrow targets sit ABOVE the row target (created after it), so a click
        // on ◀/▶ adjusts instead of activating the row.
        this.objects.push(
          hitRect(this.scene, left + SETTINGS_PANEL.arrowLX - 14, rowTop, 28, SETTINGS_PANEL.rowH, this.depth + 3, {
            onOver: () => this.select(i),
            onClick: () => {
              this.select(i);
              this.adjust(-1);
            },
          }),
        );
        this.objects.push(
          hitRect(this.scene, left + SETTINGS_PANEL.arrowRX - 14, rowTop, 28, SETTINGS_PANEL.rowH, this.depth + 3, {
            onOver: () => this.select(i),
            onClick: () => {
              this.select(i);
              this.adjust(1);
            },
          }),
        );
      }

      // The row itself: hover moves the cursor, click does what Enter does.
      this.objects.push(
        hitRect(this.scene, left + 16, rowTop, panelW - 32, SETTINGS_PANEL.rowH, this.depth + 2, {
          onOver: () => this.select(i),
          onClick: () => {
            this.select(i);
            this.activateSelected();
          },
        }),
      );
    });

    this.marker = createMarker(this.scene);
    this.objects.push(this.marker);

    applyPanelDepth(this.objects, this.depth);
    for (const o of this.objects) o.setVisible(false);
  }

  setVisible(visible: boolean): void {
    for (const o of this.objects) o.setVisible(visible);
  }

  /** ↑/↓: walk the rows. Clamped, like every other list in the game. */
  move(delta: number): void {
    const next = Phaser.Math.Clamp(this.selected + delta, 0, SETTINGS_ROWS.length - 1);
    if (next === this.selected) return;
    this.selected = next;
    this.refresh();
  }

  /**
   * ←/→ (and the ◀/▶ targets): adjust the highlighted row.
   *   volume — ±5， clamp 0..100，改完以新音量播一声 click 试听；
   *   toggle — 震屏开/关；
   *   cycle  — 文本速度按档位序循环；语言唯一选项，no-op；
   *   action — no-op（恢复默认/返回归 Enter 管）。
   * 每次调整都经 updateSettings 即时持久化。
   */
  adjust(delta: number): void {
    const settings = getSettings();
    let changed = false;
    if (this.selected === 0 || this.selected === 1) {
      const current = this.selected === 0 ? settings.sfxVolume : settings.bgmVolume;
      const next = Phaser.Math.Clamp(current + delta * VOLUME_STEP, 0, 100);
      if (next === current) return;
      updateSettings(this.selected === 0 ? { sfxVolume: next } : { bgmVolume: next });
      changed = true;
    } else if (this.selected === 2) {
      updateSettings({ screenShake: !settings.screenShake });
      changed = true;
    } else if (this.selected === 3) {
      const index = TEXT_SPEEDS.indexOf(settings.textSpeed);
      const next = TEXT_SPEEDS[(index + delta + TEXT_SPEEDS.length) % TEXT_SPEEDS.length];
      updateSettings({ textSpeed: next });
      changed = true;
    }
    if (!changed) return;
    // 音量行：以新音量试听一声。滑到 0 时 playSfx 自己静默——所见即所听。
    playSfx('click');
    this.refresh();
  }

  /** Enter (and a row click): toggle/cycle a value row, preview a volume row,
   *  or run 恢复默认 / 返回. */
  activateSelected(): void {
    if (this.selected <= 3) {
      if (this.selected <= 1) playSfx('click'); // 音量行：试听
      else this.adjust(1); // 开关 / 档位：切到下一档
      return;
    }
    if (this.selected === 4) return; // 语言：唯一选项
    if (this.selected === 5) {
      resetSettings();
      playSfx('click');
      this.refresh();
      this.showMessage('已恢复默认设置');
      return;
    }
    this.close(); // 返回
  }

  /** Esc / 返回 row: hand control back to the host. */
  close(): void {
    this.onBack();
  }

  private select(i: number): void {
    if (this.selected === i) return;
    this.selected = i;
    this.refresh();
  }

  /** Transient confirmation on the hint line (恢复默认). */
  private showMessage(text: string): void {
    this.messageTimer?.remove();
    if (!this.hintText) return;
    this.hintText.setText(text).setColor(hex(TEXT.warn));
    this.messageTimer = this.scene.time.delayedCall(1800, () => {
      this.hintText?.setText(SETTINGS_HINT).setColor(hex(PALETTE.clothHigh));
    });
  }

  private valueOf(row: number): string {
    const settings = getSettings();
    switch (row) {
      case 0:
        return String(settings.sfxVolume);
      case 1:
        return String(settings.bgmVolume);
      case 2:
        return settings.screenShake ? '开' : '关';
      case 3:
        return TEXT_SPEED_LABELS[settings.textSpeed];
      case 4:
        return LANGUAGE_LABELS[settings.language];
      default:
        return '';
    }
  }

  /** Re-read every value from SettingsSystem and repaint. Cheap: two bars. */
  refresh(): void {
    const settings = getSettings();
    this.labels.forEach((t, i) => t.setColor(i === this.selected ? hex(PALETTE.lightHigh) : hex(TEXT.primary)));
    this.values.forEach((t, i) => {
      if (t) t.setText(this.valueOf(i));
    });
    this.arrows.forEach((pair, i) => {
      if (!pair) return;
      const color = i === this.selected ? hex(PALETTE.lightHigh) : hex(PALETTE.clothHigh);
      pair.left.setColor(color);
      pair.right.setColor(color);
    });
    if (this.barGfx) {
      this.barGfx.clear();
      for (const i of [0, 1]) {
        const rowTop = this.rowsTopOf(i);
        const frac = (i === 0 ? settings.sfxVolume : settings.bgmVolume) / 100;
        drawStatBar(
          this.barGfx,
          this.barLeftOf(),
          rowTop + (SETTINGS_PANEL.rowH - SETTINGS_PANEL.barH) / 2,
          SETTINGS_PANEL.barW,
          SETTINGS_PANEL.barH,
          frac,
          UI.accent,
          10,
        );
      }
    }
    const label = this.labels[this.selected];
    this.marker?.setVisible(label !== undefined);
    if (label && this.marker) placeMarker(this.marker, label);
  }

  // Panel-relative anchors, kept as methods so build() does not have to stash
  // left/top on the instance (the controller outlives a rebuild otherwise).
  private panelLeft(): number {
    return this.scene.cameras.main.width / 2 - SETTINGS_PANEL.w / 2;
  }

  private panelTop(): number {
    return this.scene.cameras.main.height / 2 - SETTINGS_PANEL.h / 2;
  }

  private barLeftOf(): number {
    return this.panelLeft() + SETTINGS_PANEL.barX;
  }

  private rowsTopOf(row: number): number {
    return this.panelTop() + SETTINGS_PANEL.rowsTop + row * SETTINGS_PANEL.rowPitch;
  }

}

// ── AG-72: SettingsScene — the pause menu's 设置 entry ─────────────────────
//
// GameScene's pause menu hands the scene off here the same way it hands off to
// TowerOverview: GameScene stops, the survival clock stops with it, and coming
// back re-runs create() against the same module-level GameState — nothing about
// the run is reset (see GameScene.openTowerOverview's note). Returning lands
// straight back in the game, unpaused.
//
// The scene class lives here, next to the title screen's copy of the same
// panel, because both hosts share SettingsPanelView — GameScene registers it
// lazily on first use (scene.add + scene.start) rather than paying for a core
// gameConfig entry that only one menu branch needs.
export class SettingsScene extends Phaser.Scene {
  private panel!: SettingsPanelView;
  private cursors!: { up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key };
  private keyEnter!: Phaser.Input.Keyboard.Key;
  private keyEsc!: Phaser.Input.Keyboard.Key;
  private keyLeft!: Phaser.Input.Keyboard.Key;
  private keyRight!: Phaser.Input.Keyboard.Key;
  private lastInputFrame: Record<InputSlot, number> = { up: -1, down: -1, left: -1, right: -1, enter: -1, esc: -1 };

  constructor() {
    super('Settings');
  }

  create(): void {
    this.lastInputFrame = { up: -1, down: -1, left: -1, right: -1, enter: -1, esc: -1 };
    const { width, height } = this.cameras.main;

    // A dark scrim over the frozen game world: the panel is the only thing in
    // focus, the same reading as every other modal in the game.
    this.add.rectangle(width / 2, height / 2, width, height, UI.surface).setDepth(-30);
    this.add.rectangle(width / 2, height / 2, width, height, PALETTE.ink).setAlpha(0.55).setDepth(-29);

    this.panel = new SettingsPanelView(this, PANEL_DEPTH.menu.help, () => this.scene.start('Game'));
    this.panel.build(width, height);
    this.panel.setVisible(true);
    this.panel.refresh();

    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.cursors = keyboard.addKeys({ up: 'UP', down: 'DOWN' }) as typeof this.cursors;
      this.keyEnter = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
      this.keyEsc = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
      this.keyLeft = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
      this.keyRight = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
      this.cursors.up.on('down', () => this.onNav('up', -1), this);
      this.cursors.down.on('down', () => this.onNav('down', 1), this);
      this.keyEnter.on('down', () => this.onConfirm('enter'), this);
      this.keyEsc.on('down', () => this.onConfirm('esc'), this);
      this.keyLeft.on('down', () => {
        if (this.accept('left')) this.panel.adjust(-1);
      }, this);
      this.keyRight.on('down', () => {
        if (this.accept('right')) this.panel.adjust(1);
      }, this);
    }
  }

  // Phaser can deliver one keydown several times inside a single frame; accept
  // each key at most once per frame (GHI-03 m9, the MenuScene pattern).
  private accept(slot: InputSlot): boolean {
    const frame = this.game.getFrame();
    if (this.lastInputFrame[slot] === frame) return false;
    this.lastInputFrame[slot] = frame;
    return true;
  }

  private onNav(slot: 'up' | 'down', delta: number): void {
    if (!this.accept(slot)) return;
    this.panel.move(delta);
  }

  private onConfirm(slot: 'enter' | 'esc'): void {
    if (!this.accept(slot)) return;
    if (slot === 'esc') {
      this.panel.close();
      return;
    }
    this.panel.activateSelected();

  }
}
