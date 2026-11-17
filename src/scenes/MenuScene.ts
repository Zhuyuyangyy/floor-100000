import Phaser from 'phaser';
import { FONT_FAMILY, buildPanelWell } from '../render/uiKit';

import { PALETTE, TEXT, hex } from '../render/palette.ts';
import { startNewGame, tryContinue } from '../core/session';
import { devEntry } from '../core/devMode';
import { clearSave, hasSave } from '../systems/SaveSystem';
import { playSfx } from '../render/audio';
import { applyPanelDepth, buildPanel, createMarker, PANEL_DEPTH, placeMarker, type PanelObject } from '../render/panels';
import { buildPhotoTitleBackdrop, buildTitleBackdrop, type TitleBackdrop } from '../render/titleBackdrop';
import { TITLE_BG_KEY } from '../render/artpack';
import { hitRect, textClickable } from '../render/pointer';
import { ACHIEVEMENTS, type AchievementDef } from '../data/achievements';
import { achievementProgress, loadAchievements, type AchievementSave } from '../systems/AchievementSystem';
import { ACHIEVEMENT_TIER_COLOR } from '../render/achievementSkin';

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
  private helpOpen = false;
  private helpObjects: PanelObject[] = [];
  private marker!: Phaser.GameObjects.Image;
  private messageText!: Phaser.GameObjects.Text;
  private messageTimer?: Phaser.Time.TimerEvent;
  private lastInputFrame: Record<InputSlot, number> = { up: -1, down: -1, enter: -1, esc: -1 };
  private backdrop?: TitleBackdrop;
  private titleText?: Phaser.GameObjects.Text;
  private subtitleText?: Phaser.GameObjects.Text;
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
    this.lastInputFrame = { up: -1, down: -1, enter: -1, esc: -1 };
    // Survives a scene restart; left true, the help panel would still swallow
    // navigation on the fresh title screen.
    this.helpOpen = false;
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

    this.titleText = this.add
      .text(width / 2, TITLE_Y, '第100000层', { fontFamily: FONT_FAMILY, fontSize: '80px', color: hex(PALETTE.lightHigh), stroke: hex(PALETTE.ink), strokeThickness: 6 })
      .setOrigin(0.5);
    // Every piece of title text carries its own dark stroke: the painted
    // backdrop behind it is bright in places, and a stroke keeps the text
    // legible without a scrim heavy enough to bury the painting.
    this.subtitleText = this.add
      .text(width / 2, SUBTITLE_Y, '末 日 宿 舍', { fontFamily: FONT_FAMILY, fontSize: '44px', color: hex(TEXT.primary), stroke: hex(PALETTE.ink), strokeThickness: 4 })
      .setOrigin(0.5);

    this.entries = [{ label: '开始新游戏', run: () => this.startNew() }];
    if (hasSave()) this.entries.push({ label: '继续游戏', run: () => this.continueRun() });
    // AG-77：成就在标题屏的入口（奖杯柜不该埋在游戏里）。
    this.entries.push({ label: '成就', run: () => this.toggleAchievements() });
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
          if (this.helpOpen || this.achievementsOpen) return;
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
    this.buildHelp(width, height);
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
    // AG-77：面板开着时 ↑/↓ 在十四条成就里移光标，不动标题菜单。
    if (this.achievementsOpen) {
      this.moveAchievement(delta);
      return;
    }
    this.move(delta);
  }

  private onConfirm(slot: 'enter' | 'esc'): void {
    if (!this.accept(slot)) return;
    if (this.helpOpen) {
      this.toggleHelp(); // Enter and Esc both close the help panel
      return;
    }
    // AG-77：Enter 与 Esc 都关成就面板（与操作说明同一套键位）。
    if (this.achievementsOpen) {
      this.toggleAchievements();
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
