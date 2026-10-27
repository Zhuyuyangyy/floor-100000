import Phaser from 'phaser';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../core/design';
import { getGame } from '../core/session';
import { ENTRY_X } from '../core/constants';
import {
  OVERVIEW_ROW_H,
  CONTENT_TOP,
  SECTOR_CELL,
  SECTOR_COLS,
  ZOOM_MIN,
  accessOf,
  clampScroll,
  enterFloor,
  enterSector,
  navBack,
  nudgeFloor,
  nudgeSector,
  openTower,
  pickFloorAt,
  pickSectorAt,
  overviewHeight,
  sectorHeight,
  tryEnterSelected,
  viewTop,
  VIEW_H,
  zoomBy,
  type TowerNavState,
} from '../systems/TowerNav';
import { SECTOR_COUNT, SECTOR_SIZE, TIERS, describeFloor, describeSector, sectorOf, sectorRange, type TierId } from '../core/tower';
import { getFloorTemplate } from '../data/floorTemplates';
import { saveToStorage } from '../systems/SaveSystem';
import { playSfx } from '../render/audio';
import { buildPanel, type PanelObject } from '../render/panels';
import type { GameState } from '../core/gameTypes';

// TowerOverviewScene — the three-level map (docs/B2_TOWER_ARCHITECTURE.md):
//   overview (100 sectors) -> sector (1000 floors) -> one floor.
//
// Selecting is never entering: the only way out of this scene into a different
// floor is TowerNav.tryEnterSelected(), which refuses anything above the
// frontier the player has actually reached. Everything else in the tower is
// visible but inert.
//
// The camera carries the zoom and vertical scroll; content lives in world
// coordinates so picking stays exact at every zoom level.

const TYPE_TITLE = 16;
const TYPE_BODY = 13;
const TYPE_AUX = 11;

type MapKey = 'up' | 'down' | 'left' | 'right' | 'enter' | 'esc';

// Overview strip geometry (world units).
const STRIP_X = 110;
const STRIP_W = DESIGN_WIDTH - STRIP_X * 2;
// The sector grid is centred in the viewport so a whole 20x50 sector fits on
// screen instead of hugging the left edge.
const GRID_X = (DESIGN_WIDTH - SECTOR_COLS * SECTOR_CELL) / 2;

// One colour per tier, brightening as the tower climbs: the gradient is the
// whole point of the class society (design freeze §3).
const TIER_COLOR: Record<TierId, number> = {
  1: 0x4a3f36,
  2: 0x44503c,
  3: 0x35505f,
  4: 0x424a6b,
  5: 0x5a4a7d,
  6: 0x7d4f86,
};

// Sector-cell states. Locked is deliberately much darker than unlocked so the
// frontier is readable at a glance — 1000 near-identical cells tell the player
// nothing.
const COLOR_LOCKED = 0x1b2128;
const COLOR_UNLOCKED = 0x2f6b57;
const COLOR_CURRENT = 0xf4b66a;
const COLOR_EXPLORED = 0x63c9a4;
const COLOR_CURSOR = 0xece8d8;
const COLOR_BG = 0x0b0f12;

const LEGEND = [
  { color: COLOR_CURRENT, label: '当前' },
  { color: COLOR_UNLOCKED, label: '已打通' },
  { color: COLOR_EXPLORED, label: '已探索' },
  { color: COLOR_LOCKED, label: '未打通' },
];

const LEVEL_TITLE: Record<TowerNavState['level'], string> = {
  overview: '塔楼总览 · 100 个区段',
  sector: '区段',
  floor: '楼层详情',
};

function tierColor(tier: TierId): number {
  return TIER_COLOR[tier];
}

export class TowerOverviewScene extends Phaser.Scene {
  private nav!: TowerNavState;
  private access!: ReturnType<typeof accessOf>;
  private state!: GameState;

  private gridGfx!: Phaser.GameObjects.Graphics;
  private cursorGfx!: Phaser.GameObjects.Graphics;
  private currentGfx!: Phaser.GameObjects.Graphics;

  private hudText!: Phaser.GameObjects.Text;
  private stateText!: Phaser.GameObjects.Text;
  private infoText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private legendGfx!: Phaser.GameObjects.Graphics;
  private legendText!: Phaser.GameObjects.Text;
  private tierText!: Phaser.GameObjects.Text;
  private sectorLabels: Phaser.GameObjects.Text[] = [];
  private messageText!: Phaser.GameObjects.Text;

  private detailObjects: PanelObject[] = [];
  private detailTitle!: Phaser.GameObjects.Text;
  private detailRows: Phaser.GameObjects.Text[] = [];
  private detailAction!: Phaser.GameObjects.Text;

  private dragging = false;
  private dragMoved = false;
  private dragStart = { x: 0, y: 0 };
  // Sector under the pointer on the overview, or null. 3px rows are too small to
  // aim at reliably, so the readout names the target before the click commits.
  private hoverSector: number | null = null;

  // Per-frame input guard (GHI-03 m9): Phaser can deliver one keydown several
  // times inside a single frame, and a scene restart must not inherit the
  // previous visit's frame numbers.
  private lastInputFrame: Record<MapKey, number> = { up: -1, down: -1, left: -1, right: -1, enter: -1, esc: -1 };

  private keys!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    enter: Phaser.Input.Keyboard.Key;
    esc: Phaser.Input.Keyboard.Key;
  };

  constructor() {
    super('TowerOverview');
  }

  create(): void {
    this.lastInputFrame = { up: -1, down: -1, left: -1, right: -1, enter: -1, esc: -1 };
    this.state = getGame();
    this.access = accessOf(this.state);
    this.nav = openTower(this.access);

    this.cameras.main.setBackgroundColor(COLOR_BG);
    this.cameras.main.setScroll(0, 0);
    this.cameras.main.setZoom(this.nav.zoom);

    this.gridGfx = this.add.graphics();
    this.currentGfx = this.add.graphics();
    this.cursorGfx = this.add.graphics();

    this.buildHud();
    this.buildSectorLabels();
    this.buildDetailPanel();
    this.bindInput();
    this.redraw();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unbindInput();
      this.input.removeListener(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
      this.input.removeListener(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
      this.input.removeListener(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    });

    // Dev-only handle so Playwright can assert on the real nav level, cursor,
    // frontier, camera coverage and cell colouring instead of guessing from
    // pixels — the map's whole language is colour, so it has to be testable.
    if (import.meta.env.DEV) {
      (window as unknown as { __PHASER_TOWER__?: unknown }).__PHASER_TOWER__ = {
        getNav: () => this.nav,
        getAccess: () => this.access,
        getView: () => ({
          top: viewTop(this.nav.scroll, this.nav.zoom),
          height: VIEW_H / this.nav.zoom,
          content: this.nav.level === 'overview' ? overviewHeight() : sectorHeight(),
        }),
        getCells: () => this.cellStates(),
      };
    }
  }

  // ── rendering ───────────────────────────────────────────────────────────

  // The HUD lives in two fixed bands: 0..CONTENT_TOP above the content and
  // DESIGN_HEIGHT-24..DESIGN_HEIGHT below it. Everything here is
  // scrollFactor(0), so the world zoom never scales or moves it.
  private buildHud(): void {
    this.hudText = this.add
      .text(12, 8, '', { fontFamily: 'monospace', fontSize: `${TYPE_TITLE}px`, color: '#f4b66a', backgroundColor: '#0b0f12cc', padding: { x: 6, y: 3 } })
      .setScrollFactor(0)
      .setDepth(100);
    this.stateText = this.add
      .text(12, 26, '', { fontFamily: 'monospace', fontSize: `${TYPE_AUX}px`, color: '#a8e0c8', backgroundColor: '#0b0f12cc', padding: { x: 6, y: 2 } })
      .setScrollFactor(0)
      .setDepth(100);
    this.infoText = this.add
      .text(DESIGN_WIDTH - 12, 12, '', { fontFamily: 'monospace', fontSize: `${TYPE_AUX}px`, color: '#a8e0c8', backgroundColor: '#0b0f12cc', padding: { x: 6, y: 4 }, align: 'right' })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(100);
    this.hintText = this.add
      .text(12, DESIGN_HEIGHT - 22, '', { fontFamily: 'monospace', fontSize: `${TYPE_BODY}px`, color: '#a8e0c8', backgroundColor: '#0b0f12cc', padding: { x: 6, y: 3 } })
      .setScrollFactor(0)
      .setDepth(100);
    // Colour legend for the sector grid. The map's whole language is colour, so
    // the four states have to be spelled out rather than guessed at.
    this.legendGfx = this.add.graphics().setScrollFactor(0).setDepth(102);
    this.legendText = this.add
      .text(DESIGN_WIDTH - 12, DESIGN_HEIGHT - 22, '', { fontFamily: 'monospace', fontSize: `${TYPE_AUX}px`, color: '#a8e0c8' })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(102);
    this.messageText = this.add
      .text(DESIGN_WIDTH / 2, DESIGN_HEIGHT - 22, '', { fontFamily: 'monospace', fontSize: `${TYPE_BODY}px`, color: '#e0705a', backgroundColor: '#0b0f12cc', padding: { x: 8, y: 4 } })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(101)
      .setVisible(false);
    // Top-centre readout: the sector composition in the sector view, and what the
    // pointer is over on the overview. The content is inset by CONTENT_TOP, so
    // this band is free at every level — unlike the bottom one, which the control
    // hint and the legend already share.
    this.tierText = this.add
      .text(DESIGN_WIDTH / 2, 12, '', { fontFamily: 'monospace', fontSize: `${TYPE_AUX}px`, color: '#a8e0c8', backgroundColor: '#0b0f12cc', padding: { x: 6, y: 3 } })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(100)
      .setVisible(false);
  }

  // Sector-number anchors down the left of the strip. Created once and only
  // repositioned afterwards: drawOverview() runs on every input, and calling
  // add.text() there would leak a fresh set of objects per keypress.
  private buildSectorLabels(): void {
    for (let s = 0; s < SECTOR_COUNT; s += 10) {
      this.sectorLabels.push(
        this.add
          .text(0, 0, String(s * SECTOR_SIZE + 1), { fontFamily: 'monospace', fontSize: `${TYPE_AUX}px`, color: '#a8e0c8', backgroundColor: '#0b0f12cc', padding: { x: 2, y: 1 } })
          .setOrigin(1, 0)
          .setDepth(5),
      );
    }
  }

  private buildDetailPanel(): void {
    const w = 420;
    const h = 150;
    const cx = DESIGN_WIDTH / 2;
    const cy = DESIGN_HEIGHT / 2;
    const left = cx - w / 2;
    const top = cy - h / 2;

    this.detailObjects.push(...buildPanel(this, cx, cy, w, h, 'yellow'));
    this.detailTitle = this.add
      .text(cx, top + 22, '', { fontFamily: 'monospace', fontSize: `${TYPE_TITLE}px`, color: '#f4b66a' })
      .setOrigin(0.5);
    this.detailRows = [];
    for (let i = 0; i < 4; i++) {
      this.detailRows.push(this.add.text(left + 26, top + 54 + i * 20, '', { fontFamily: 'monospace', fontSize: `${TYPE_BODY}px`, color: '#ece8d8' }));
    }
    this.detailAction = this.add
      .text(cx, top + h - 20, '', { fontFamily: 'monospace', fontSize: `${TYPE_BODY}px`, color: '#77c6a4' })
      .setOrigin(0.5);
    this.detailObjects.push(this.detailTitle, ...this.detailRows, this.detailAction);
    for (const o of this.detailObjects) o.setScrollFactor(0).setDepth(200).setVisible(false);
  }

  private redraw(): void {
    const cam = this.cameras.main;
    cam.setZoom(this.nav.zoom);
    cam.scrollY = clampScroll(this.nav, this.nav.scroll);
    // The hover readout only means anything on the overview.
    if (this.nav.level !== 'overview') this.hoverSector = null;

    this.gridGfx.clear();
    this.currentGfx.clear();
    this.cursorGfx.clear();

    if (this.nav.level === 'overview') this.drawOverview();
    else this.drawSectorGrid(); // the floor level keeps the grid behind the panel

    // Set unconditionally, not from inside drawOverview(): the sector labels are
    // the overview's anchors, and only hiding them from here keeps them from
    // lingering over the sector grid after a drill-down.
    for (const label of this.sectorLabels) label.setVisible(this.nav.level === 'overview');

    this.refreshHud();
    this.refreshDetail();
  }

  private drawOverview(): void {
    const g = this.gridGfx;
    const currentSector = sectorOf(this.state.currentFloor);
    for (let s = 0; s < SECTOR_COUNT; s++) {
      const y = CONTENT_TOP + s * OVERVIEW_ROW_H;
      const summary = describeSector(s);
      const visited = this.isSectorVisited(s);
      g.fillStyle(tierColor(summary.tiers[0].tier), 1);
      // 2px of fill with a 1px gap keeps 100 rows countable as a striped tower
      // instead of one solid block where adjacent sectors share a tier.
      g.fillRect(STRIP_X, y, STRIP_W, OVERVIEW_ROW_H - 1);
      if (visited) {
        // A full-height explored stripe along the left edge of the strip: at 3px
        // per sector anything narrower is invisible.
        g.fillStyle(COLOR_EXPLORED, 1);
        g.fillRect(STRIP_X, y, 8, OVERVIEW_ROW_H - 1);
      }
    }

    // Current sector: the one thing that must always be visible and legible.
    const cy = CONTENT_TOP + currentSector * OVERVIEW_ROW_H;
    this.currentGfx.fillStyle(COLOR_CURRENT, 1);
    this.currentGfx.fillRect(STRIP_X, cy, STRIP_W, OVERVIEW_ROW_H);
    this.currentGfx.lineStyle(1, 0x0b0f12, 1);
    this.currentGfx.strokeRect(STRIP_X - 0.5, cy - 0.5, STRIP_W + 1, OVERVIEW_ROW_H + 1);

    // Keyboard cursor.
    const ky = CONTENT_TOP + this.nav.cursor * OVERVIEW_ROW_H;
    this.cursorGfx.lineStyle(1, COLOR_CURSOR, 1);
    this.cursorGfx.strokeRect(STRIP_X - 3, ky - 1, STRIP_W + 6, OVERVIEW_ROW_H + 2);

    this.drawTierBands();
    this.drawSectorLabels();
  }

  private drawTierBands(): void {
    const g = this.gridGfx;
    // A boundary line at each tier's first sector, so the colour gradient reads
    // as a class hierarchy rather than decoration.
    for (const tier of TIERS) {
      const y = CONTENT_TOP + Math.floor((tier.minFloor - 1) / SECTOR_SIZE) * OVERVIEW_ROW_H;
      g.lineStyle(1, 0x9aa6b4, 0.9);
      g.lineBetween(STRIP_X - 12, y, STRIP_X + STRIP_W + 12, y);
    }
  }

  // At 3px per row no row can carry its own label, so every tenth sector is
  // numbered instead. Those anchors are what a player reads the tower by, and
  // they are what makes "all 100 sectors are on screen" verifiable by eye.
  // Positions only — redraw() owns the visibility, because this is not called at
  // the other two levels.
  private drawSectorLabels(): void {
    this.sectorLabels.forEach((label, i) => {
      label.setPosition(STRIP_X - 14, CONTENT_TOP + i * 10 * OVERVIEW_ROW_H);
    });
  }

  private drawSectorGrid(): void {
    const g = this.gridGfx;
    const { from, to } = sectorRange(this.nav.sector);
    const highest = this.access.highestUnlocked;
    // The grid is centred horizontally and inset below the top HUD band, so the
    // fixed HUD never sits on top of the cells.
    const originX = GRID_X;
    const originY = CONTENT_TOP;
    for (let floor = from; floor <= to; floor++) {
      const offset = floor - from;
      const col = offset % SECTOR_COLS;
      const row = Math.floor(offset / SECTOR_COLS);
      const x = originX + col * SECTOR_CELL;
      const y = originY + row * SECTOR_CELL;
      if (floor <= highest) {
        g.fillStyle(this.state.visitedFloors[floor] ? COLOR_EXPLORED : COLOR_UNLOCKED, 1);
      } else {
        g.fillStyle(COLOR_LOCKED, 1);
      }
      g.fillRect(x, y, SECTOR_CELL - 1, SECTOR_CELL - 1);
    }

    // Current floor marker: filled, so it reads at a glance rather than only as
    // an outline lost among 1000 cells.
    const offsetCur = this.state.currentFloor - from;
    if (offsetCur >= 0 && this.state.currentFloor <= to) {
      const cx = originX + (offsetCur % SECTOR_COLS) * SECTOR_CELL;
      const cy2 = originY + Math.floor(offsetCur / SECTOR_COLS) * SECTOR_CELL;
      this.currentGfx.fillStyle(COLOR_CURRENT, 1);
      this.currentGfx.fillRect(cx, cy2, SECTOR_CELL - 1, SECTOR_CELL - 1);
      this.currentGfx.lineStyle(1, 0x0b0f12, 1);
      this.currentGfx.strokeRect(cx - 0.5, cy2 - 0.5, SECTOR_CELL, SECTOR_CELL);
    }

    // Keyboard cursor.
    const offsetCur2 = this.nav.cursor - from;
    const kx = originX + (offsetCur2 % SECTOR_COLS) * SECTOR_CELL;
    const ky = originY + Math.floor(offsetCur2 / SECTOR_COLS) * SECTOR_CELL;
    this.cursorGfx.lineStyle(2, COLOR_CURSOR, 1);
    this.cursorGfx.strokeRect(kx - 2, ky - 2, SECTOR_CELL + 3, SECTOR_CELL + 3);
  }

  private isSectorVisited(sector: number): boolean {
    const { from, to } = sectorRange(sector);
    for (let f = from; f <= to; f++) {
      if (this.state.visitedFloors[f]) return true;
    }
    return false;
  }

  // The colour each cell of the sector in view is drawn in. Exposed for tests so
  // the map's colour language is asserted rather than eyeballed.
  private cellStates(): Array<{ floor: number; state: 'current' | 'explored' | 'unlocked' | 'locked' }> {
    const { from, to } = sectorRange(this.nav.sector);
    const out: Array<{ floor: number; state: 'current' | 'explored' | 'unlocked' | 'locked' }> = [];
    for (let floor = from; floor <= to; floor++) {
      const state =
        floor === this.state.currentFloor
          ? 'current'
          : floor <= this.access.highestUnlocked
            ? this.state.visitedFloors[floor]
              ? 'explored'
              : 'unlocked'
            : 'locked';
      out.push({ floor, state });
    }
    return out;
  }

  private refreshHud(): void {
    const level = this.nav.level;
    let title = LEVEL_TITLE[level];
    if (level === 'sector') {
      const { from, to } = sectorRange(this.nav.sector);
      title = `${LEVEL_TITLE.sector} ${this.nav.sector} · ${from}–${to} 层`;
    } else if (level === 'floor') {
      title = `${LEVEL_TITLE.floor} ${this.nav.floor}`;
    }
    this.hudText.setText(title);

    const zoomLabel = this.nav.zoom === ZOOM_MIN ? '1x' : `${this.nav.zoom.toFixed(1)}x`;
    this.stateText.setText(`当前 ${this.state.currentFloor} 层 · 已打通至 ${this.access.highestUnlocked} 层`);
    this.infoText.setText(`缩放 ${zoomLabel}`);

    // Bottom-centre readout. In the sector view it is the sector's composition;
    // on the overview it is whatever the pointer is over, which is what makes a
    // 3px row pickable — you see the sector named before you commit to it.
    if (level === 'sector' || level === 'floor') {
      this.tierText.setVisible(true);
      const summary = describeSector(this.nav.sector);
      this.tierText.setText(summary.tiers.map((t) => `${t.name}×${t.count}`).join(' · '));
    } else if (this.hoverSector !== null) {
      this.tierText.setVisible(true);
      const summary = describeSector(this.hoverSector);
      const { from, to } = sectorRange(this.hoverSector);
      this.tierText.setText(`区段 ${this.hoverSector} · ${from}–${to} 层 · ${summary.tiers.map((t) => t.name).join('/')}`);
    } else {
      this.tierText.setVisible(false);
    }

    const hint =
      level === 'overview'
        ? '↑/↓ 选择 · Enter 进入 · 滚轮缩放 · 拖动平移 · ESC 返回游戏'
        : level === 'sector'
          ? '方向键选择 · Enter 查看 · 滚轮缩放 · 拖动 · ESC 返回'
          : 'Enter 进入该楼层 · ESC 返回区段';
    this.hintText.setText(hint);
    this.refreshLegend();
  }

  private refreshLegend(): void {
    // Only the sector grid and the floor detail carry the colour language.
    const show = this.nav.level === 'sector' || this.nav.level === 'floor';
    this.legendGfx.setVisible(show);
    this.legendText.setVisible(show);
    if (!show) return;

    const swatch = 7;
    const gap = 4;
    // Lay the four entries out right-to-left from the bottom-right corner, so
    // the legend never collides with the bottom-left control hint.
    let x = DESIGN_WIDTH - 12;
    const y = DESIGN_HEIGHT - 22;
    for (let i = LEGEND.length - 1; i >= 0; i--) {
      const { color, label } = LEGEND[i];
      const textW = label.length * TYPE_AUX * 0.5;
      const blockW = swatch + gap + textW;
      x -= blockW;
      this.legendGfx.fillStyle(color, 1);
      this.legendGfx.fillRect(x, y + 3, swatch, swatch);
      x -= gap;
    }
    this.legendText.setText(LEGEND.map((l) => l.label).join('  '));
  }

  private refreshDetail(): void {
    const floor = this.nav.floor;
    const show = this.nav.level === 'floor' && floor !== null;
    for (const o of this.detailObjects) o.setVisible(show);
    if (!show || floor === null) return;

    const record = describeFloor(floor);
    const template = getFloorTemplate(floor);
    const explored = this.state.visitedFloors[floor] !== undefined;
    // A zero level has no dots to draw, so say so rather than leaving the label
    // dangling with nothing after it.
    const dots = (n: number): string => '●'.repeat(n) || '无';
    this.detailTitle.setText(`第 ${floor} 层 · ${template?.name ?? record.tierName}`);
    this.detailRows[0].setText(`阶层：${record.tierName}（T${record.tier}）`);
    this.detailRows[1].setText(`资源 ${dots(record.resourceLevel)}　危险 ${dots(record.dangerLevel)}　管控 ${dots(record.security)}`);
    this.detailRows[2].setText(`状态：${explored ? '已探索' : '未探索'}${floor === this.state.currentFloor ? ' · 当前所在' : ''}`);
    const enterable = tryEnterSelected(this.nav, this.access);
    this.detailRows[3].setText(enterable.ok ? '通行：已打通' : '通行：未打通');
    this.detailAction.setText(enterable.ok ? '按 Enter 进入' : '需先通过实际通路抵达').setColor(enterable.ok ? '#77c6a4' : '#e0705a');
  }

  // ── input ───────────────────────────────────────────────────────────────

  // Keys are handled through 'down' event listeners, not by polling JustDown:
  // Phaser drains the keyboard queue synchronously on the DOM event, so a press
  // that completes (down+up) between two frames clears _justDown before the next
  // scene update can read it and the press is lost entirely.
  //
  // The listener in turn has to be debounced per frame: Phaser can deliver one
  // DOM keydown several times inside a single frame when several keys land in
  // the same queue drain (measured in MenuScene: one ArrowDown arrived three
  // times in frame 28), which would move the cursor three cells per press. A
  // frame counter accepts each key at most once per frame while still letting a
  // genuinely fast second press through on the next frame (GHI-03 m9).
  private accept(slot: MapKey): boolean {
    const frame = this.game.getFrame();
    if (this.lastInputFrame[slot] === frame) return false;
    this.lastInputFrame[slot] = frame;
    return true;
  }

  private bindInput(): void {
    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.keys = {
        up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
        down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
        left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
        right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
        enter: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER),
        esc: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC),
      };
      this.keys.up.on('down', () => this.onArrow('up', 0, -1), this);
      this.keys.down.on('down', () => this.onArrow('down', 0, 1), this);
      this.keys.left.on('down', () => this.onArrow('left', -1, 0), this);
      this.keys.right.on('down', () => this.onArrow('right', 1, 0), this);
      this.keys.enter.on('down', this.onConfirm, this);
      this.keys.esc.on('down', this.onBack, this);
    }
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this);
  }

  private unbindInput(): void {
    // removeAllListeners per key rather than off(): the arrow handlers above are
    // closures, and Phaser does not re-run field initialisers on a scene restart
    // — addKey() hands back the same Key object, so a restart would otherwise
    // stack a second set of listeners on it.
    if (this.keys) {
      this.keys.up?.removeAllListeners();
      this.keys.down?.removeAllListeners();
      this.keys.left?.removeAllListeners();
      this.keys.right?.removeAllListeners();
      this.keys.enter?.removeAllListeners();
      this.keys.esc?.removeAllListeners();
    }
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.off(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this);
  }

  private onArrow(slot: MapKey, dx: number, dy: number): void {
    if (!this.accept(slot)) return;
    if (this.nav.level === 'overview') {
      this.nav = nudgeSector(this.nav, dy);
    } else if (this.nav.level === 'sector') {
      this.nav = nudgeFloor(this.nav, dx, dy);
    }
    this.redraw();
  }

  private onConfirm(): void {
    if (!this.accept('enter')) return;
    playSfx('click');
    if (this.nav.level === 'overview') {
      this.nav = enterSector(this.nav.cursor);
    } else if (this.nav.level === 'sector') {
      this.nav = enterFloor(this.nav, this.nav.cursor);
    } else {
      this.tryEnter();
    }
    this.redraw();
  }

  private onBack(): void {
    if (this.nav.level === 'overview') {
      this.scene.start('Game'); // close the map
      return;
    }
    this.nav = navBack(this.nav);
    this.redraw();
  }

  // The one and only way out of the map into another floor.
  private tryEnter(): void {
    const result = tryEnterSelected(this.nav, this.access);
    if (!result.ok) {
      this.showMessage(result.reason);
      return;
    }
    this.state.currentFloor = result.floor;
    this.state.player.x = ENTRY_X;
    saveToStorage(this.state);
    this.scene.start('Game');
  }

  private showMessage(text: string): void {
    this.messageText.setText(text).setVisible(true);
    this.time.delayedCall(2200, () => this.messageText.setVisible(false));
  }

  // World-space position of the pointer, mirroring Phaser's camera transform
  // exactly (centre on scrollY + VIEW_H/2, VIEW_H/zoom visible).
  private pointerWorld(): { x: number; y: number } {
    const cam = this.cameras.main;
    const z = cam.zoom;
    const viewW = cam.width / z;
    const viewH = cam.height / z;
    const left = cam.scrollX + cam.width / 2 - viewW / 2;
    const top = cam.scrollY + cam.height / 2 - viewH / 2;
    return { x: this.input.activePointer.x / z + left, y: this.input.activePointer.y / z + top };
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    this.dragging = true;
    this.dragMoved = false;
    this.dragStart = { x: pointer.x, y: pointer.y };
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.dragging) {
      const dx = pointer.x - this.dragStart.x;
      const dy = pointer.y - this.dragStart.y;
      if (!this.dragMoved && Math.abs(dx) + Math.abs(dy) < 5) return;
      this.dragMoved = true;
      this.nav = { ...this.nav, scroll: clampScroll(this.nav, this.nav.scroll - dy / this.nav.zoom) };
      this.redraw();
      return;
    }
    if (this.nav.level !== 'overview') return;
    const world = this.pointerWorld();
    const sector = pickSectorAt(this.nav, world.y);
    if (sector === this.hoverSector) return;
    this.hoverSector = sector;
    this.refreshHud();
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const wasDragging = this.dragMoved;
    this.dragging = false;
    this.dragMoved = false;
    if (wasDragging) return;
    if (pointer.x < 0 || pointer.y < 0 || pointer.x > DESIGN_WIDTH || pointer.y > DESIGN_HEIGHT) return;

    const world = this.pointerWorld();
    if (this.nav.level === 'overview') {
      const sector = pickSectorAt(this.nav, world.y);
      if (sector === null) return;
      this.nav = enterSector(sector);
    } else if (this.nav.level === 'sector') {
      const floor = pickFloorAt(this.nav, world.x - GRID_X, world.y - CONTENT_TOP);
      if (floor === null) return;
      this.nav = enterFloor(this.nav, floor);
    }
    this.redraw();
  }

  private onWheel(
    _pointer: Phaser.Input.Pointer,
    _over: Phaser.GameObjects.GameObject[],
    _dx: number,
    dy: number,
  ): void {
    this.nav = zoomBy(this.nav, dy < 0 ? 1 : -1);
    this.redraw();
  }
}
