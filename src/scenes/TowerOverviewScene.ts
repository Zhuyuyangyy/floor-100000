import Phaser from 'phaser';
import { FONT_FAMILY } from '../render/uiKit';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../core/design';
import { getGame } from '../core/session';
import { ENTRY_X } from '../core/constants';
import {
  OVERVIEW_ROW_H,
  CONTENT_TOP,
  SECTOR_CELL,
  SECTOR_COLS,
  SECTOR_ROWS,
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
import { PLAYABLE_FLOORS_V01 } from '../core/constants';
import { getFloorTemplate, hasFloorContent } from '../data/floorTemplates';
import { getItem } from '../data/items';
import { summarizeFloor } from '../core/worldgen';
import { describeFloorContents } from '../systems/LootSystem';
import { encounterSpots } from '../systems/encounterSpots';
import { saveToStorage } from '../systems/SaveSystem';
import { playSfx } from '../render/audio';
import { applyPanelDepth, buildPanel, PANEL_DEPTH, PANEL_FILL_BANDS, PANEL_FRAME_PIECES, PANEL_SLICE, type PanelObject } from '../render/panels';
import { hitRect, textClickable } from '../render/pointer';
import { PALETTE, ROLE, TEXT, hex } from '../render/palette.ts';
import { TOWER_FOOT_TOP, TOWER_STRIP_W, TOWER_STRIP_X, TOWER_TAG_X, DETAIL_CONTENT_ACTION_GAP, DETAIL_CONTENT_W, DETAIL_FOOT_PAD, DETAIL_PANEL_H, DETAIL_PANEL_W, DETAIL_ROWS_TOP, DETAIL_ROW_COUNT, DETAIL_ROW_PITCH, DETAIL_ROW_X } from '../render/hudLayout';
import { estimateLineHeight, estimateTextWidth } from '../render/dialogueLayout';
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

const TYPE_TITLE = 32;
const TYPE_BODY = 26;
const TYPE_AUX = 22;

// The bottom band's objects sit at TOWER_FOOT_TOP (render/hudLayout), 36px above
// the canvas bottom. That used to be DESIGN_HEIGHT - 22, which put the control
// hint's measured bounds at y 698..731 — the 26px type plus 6px of padding is
// 33px tall, so the last 11 pixels of every level's hint line fell off the
// 720px canvas (Playwright getBounds(), all three levels). The legend and the
// transient message share the band, so they move together.

type MapKey = 'up' | 'down' | 'left' | 'right' | 'enter' | 'esc';

// Overview strip geometry (world units): TOWER_STRIP_X / TOWER_STRIP_W from
// render/hudLayout, where uiLayout.test.ts can assert the fit arithmetically.
// NOT the full DESIGN_WIDTH - TOWER_STRIP_X*2 (1060) any more. The 起点/终点 tags sit
// in the right margin at TOWER_TAG_X, and the widest of them ("终点 第100000层",
// 169px at TYPE_AUX — measured, not estimated) used to end at 1349: 69px past
// the 1280 canvas, so the summit tag was clipped by the viewport on the one
// screen whose whole job is showing the summit. TOWER_ENDPOINT_MARGIN (200)
// leaves the tag's offset, its width and a right inset inside the canvas.
// The sector grid is centred in the viewport so a whole 20x50 sector fits on
// screen instead of hugging the left edge.
const GRID_X = (DESIGN_WIDTH - SECTOR_COLS * SECTOR_CELL) / 2;

// One colour per tier, brightening as the tower climbs: the gradient is the
// whole point of the class society (design freeze §3).
const TIER_COLOR: Record<TierId, number> = {
  // One step per sector, climbing from stone through teal and into the light
  // family: the map's own colour journey mirrors the run's.
  1: PALETTE.stone,
  2: PALETTE.stoneLight,
  3: PALETTE.cloth,
  4: PALETTE.clothLight,
  5: PALETTE.lightDeep,
  6: PALETTE.light,
};

// Sector-cell states. Locked is deliberately much darker than unlocked so the
// frontier is readable at a glance — 1000 near-identical cells tell the player
// nothing.
// The map's colours, on the project palette.
//
// This screen had its own six hexes plus a per-sector table of six more, which
// made it the last place where the UI could be a value off from the game it
// describes. The roles are unchanged; only their sources are.
const COLOR_LOCKED = PALETTE.shadow;
const COLOR_UNLOCKED = PALETTE.cloth;
const COLOR_CURRENT = PALETTE.lightHigh;
const COLOR_EXPLORED = PALETTE.clothHigh;
const COLOR_CURSOR = 0xece8d8; // the text cream; the palette's ink-friendly neutral
const COLOR_BG = PALETTE.ink;

/** Blend two 24-bit colours; local so this module keeps no Phaser runtime use. */
function mixColour(a: number, b: number, t: number): number {
  const lerp = (ca: number, cb: number): number => Math.round(ca + (cb - ca) * t);
  return (
    (lerp((a >> 16) & 0xff, (b >> 16) & 0xff) << 16) |
    (lerp((a >> 8) & 0xff, (b >> 8) & 0xff) << 8) |
    lerp(a & 0xff, b & 0xff)
  );
}
// The two ends of the climb. Both are deliberately unlike COLOR_CURRENT: the
// player has to be able to tell "where I am" from "where I started" and "where
// I am going" at a glance.
const COLOR_START = PALETTE.clothHigh;
const COLOR_SUMMIT = PALETTE.dust;
// The boss spine. Same red as the low-HP vignette and the combat numbers, so a
// floor that can roll a guardian reads as danger before the player knows the
// word for it. Deliberately unlike every tier colour: at 3px a row the mark has
// to be recognisable by hue alone.
const COLOR_BOSS = ROLE.danger;

const LEGEND = [
  { color: COLOR_CURRENT, label: '当前' },
  { color: COLOR_UNLOCKED, label: '已打通' },
  { color: COLOR_EXPLORED, label: '已探索' },
  { color: COLOR_LOCKED, label: '未打通' },
];

// The floors that can roll a boss, read through encounterSpots' own API.
//
// The overview used to carry no boss marker at all: a player reading the map
// had no way to tell that floor 5, 110 or 50010 has a guardian, which is the
// one thing the map should warn about before the player walks in.
//
// Deliberately NOT a second filter over ENCOUNTER_TABLE: that is the exact
// expression systems/encounterSpots already makes for its own marker
// (BOSS_SPOT_FLOORS there), and a copy in the scene is how the map drifts from
// the game the moment a segment is authored. Asking encounterSpots() per floor
// delegates to the single source of truth, so a floor whose table gains a boss
// entry gets its spine here automatically, and one that loses one loses it.
// The seed is irrelevant to isBoss (it depends only on the floor), so a fixed
// value reads the table; 0 is the obvious one. Computed once at module level —
// it reads static data and drawOverview runs on every input.
//
// uiLayout.test.ts asserts this set equals [5, 110, 50010], so the derivation
// is pinned against the table rather than against this expression.
const BOSS_FLOOR_NUMBERS: readonly number[] = PLAYABLE_FLOORS_V01.filter((floor) =>
  encounterSpots(0, floor).some((spot) => spot.isBoss),
);

const LEVEL_TITLE: Record<TowerNavState['level'], string> = {
  overview: '塔楼总览 · 100 个区段',
  sector: '区段',
  floor: '楼层详情',
};

function tierColor(tier: TierId): number {
  return TIER_COLOR[tier];
}

/**
 * What an UNEXPLORED floor would look like if it were explored — worldgen's
 * deterministic answer for (runSeed, floor).
 *
 * The detail card used to show LootSystem's "内容：未生成" placeholder for
 * these floors, which told the player nothing: 99946 of the tower's 100000
 * floors have no authored template, and the map's whole job is letting a trip
 * be planned rather than guessed. summarizeFloor answers with the tier's
 * supply grade, the threat label, the seeded container count and the tier's
 * material pool — the same numbers generateFloorContent rolls the moment the
 * player actually walks in, so the card's promise and the floor's reality
 * cannot drift apart.
 *
 * The 「未探索·预估：」 prefix (and the caller's warn colour) is what keeps the
 * two data sources distinguishable: authored floors read 「内容：…」 — the
 * resolved world, taken stacks removed — while these read as the prediction
 * they are. The 所属阶层 stays on row 0 for both paths: it is a structural
 * quantity of tower.ts, identical in both sources by construction.
 */
function describeUnexploredFloor(state: GameState, floor: number): string {
  const summary = summarizeFloor(state.runSeed, floor);
  const loot = summary.lootPool.map((id) => getItem(id).displayName);
  return `未探索·预估：${summary.tier.name} · 容器 ${summary.containerCount} 个 · 物资 ${summary.supplyGrade} 档 · 威胁「${summary.threatLabel}」 · 或可找到 ${loot.join('·')}`;
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
  private hintText!: Phaser.GameObjects.Text;
  private legendGfx!: Phaser.GameObjects.Graphics;
  private legendText!: Phaser.GameObjects.Text;
  private tierText!: Phaser.GameObjects.Text;
  private sectorLabels: Phaser.GameObjects.Text[] = [];
  private endpointLabels: Phaser.GameObjects.Text[] = [];
  private messageText!: Phaser.GameObjects.Text;

  private detailObjects: PanelObject[] = [];
  /** buildPanel's return for the detail card: [fill x PANEL_FILL_BANDS, frame x PANEL_FRAME_PIECES]. */
  private detailPanelParts: PanelObject[] = [];
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
    // OVERHAUL UI: the map's backdrop used to be one flat ink fill, which the QA
    // sweep measured at 52% of the frame in a single colour - the flattest screen
    // in the game. A vertical gradient from the tower's base tone up to the
    // summit tone gives the empty space a direction: you are looking up.
    const { width, height } = this.cameras.main;
    const sky = this.add.graphics().setDepth(-10);
    const steps = 10;
    for (let i = 0; i < steps; i++) {
      const k = i / (steps - 1);
      // Bottom (base of the tower) is warmer and darker; top is cold distance.
      const color = mixColour(PALETTE.lightDeep, PALETTE.stone, k * 0.55);
      sky.fillStyle(color, 1);
      sky.fillRect(0, (height / steps) * i, width, height / steps + 1);
    }
    sky.setAlpha(0.5);
    this.cameras.main.setScroll(0, 0);
    this.cameras.main.setZoom(this.nav.zoom);

    this.gridGfx = this.add.graphics();
    this.currentGfx = this.add.graphics();
    this.cursorGfx = this.add.graphics();

    this.buildHud();
    this.buildOverviewAnnotations();
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
      .text(12, 8, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE_TITLE}px`, color: hex(PALETTE.lightHigh), backgroundColor: '#0b0f12cc', padding: { x: 6, y: 3 } })
      .setScrollFactor(0)
      .setDepth(100);
    this.stateText = this.add
      // Top-centre, under the tier readout — NOT the old (12, 26).
      //
      // At x=12 the state line sat at y 26..53 while the 32px title above it
      // occupied 8..47: both left-aligned, the two printed 21px through each
      // other (Playwright getBounds). Moving it down to 48 fixes that but puts
      // its chip over the first sector-number label (37..96 × 63..88), and the
      // top-right is already crowded (the zoom chip overlaps the 终点 tag by
      // 88x12px). The top-centre slot is the one free band: the tier readout
      // above it ends at 41, so 50..77 clears it, the title, the sector labels
      // and both endpoint tags.
      //
      // AG-12: the zoom readout is no longer its own top-right chip. The right
      // margin belongs to the tower's own annotations — the 起点/终点 tags are
      // world-space, and at any zoom above 1x they scroll through the whole
      // margin (at 2x the summit tag reaches screen y 26..78), so ANY fixed
      // chip placed there eventually prints through them. The reading moved
      // into this chip instead: "当前 X 层 · 已打通至 Y 层 · 缩放 Zx" — one
      // state line, one lane, zero overlap with the strip, the title, the
      // sector labels (x ≤ 96) and both endpoint tags (x ≥ 1090) at every
      // zoom and scroll. Measured before/after in docs/plans/UI.md.
      .text(DESIGN_WIDTH / 2, 50, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE_AUX}px`, color: hex(TEXT.highlight), backgroundColor: '#0b0f12cc', padding: { x: 6, y: 2 } })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(100);
    this.hintText = this.add
      .text(12, DESIGN_HEIGHT - TOWER_FOOT_TOP, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE_BODY}px`, color: hex(TEXT.highlight), backgroundColor: '#0b0f12cc', padding: { x: 6, y: 3 } })
      .setScrollFactor(0)
      .setDepth(100);
    // Colour legend for the sector grid. The map's whole language is colour, so
    // the four states have to be spelled out rather than guessed at.
    this.legendGfx = this.add.graphics().setScrollFactor(0).setDepth(102);
    this.legendText = this.add
      .text(DESIGN_WIDTH - 12, DESIGN_HEIGHT - TOWER_FOOT_TOP, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE_AUX}px`, color: hex(TEXT.highlight) })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(102);
    this.messageText = this.add
      .text(DESIGN_WIDTH / 2, DESIGN_HEIGHT - TOWER_FOOT_TOP, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE_BODY}px`, color: hex(TEXT.warn), backgroundColor: '#0b0f12cc', padding: { x: 8, y: 4 } })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(101)
      .setVisible(false);
    // Top-centre readout: the sector composition in the sector view, and what the
    // pointer is over on the overview. The content is inset by CONTENT_TOP, so
    // this band is free at every level — unlike the bottom one, which the control
    // hint and the legend already share.
    this.tierText = this.add
      .text(DESIGN_WIDTH / 2, 12, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE_AUX}px`, color: hex(TEXT.highlight), backgroundColor: '#0b0f12cc', padding: { x: 6, y: 3 } })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(100)
      .setVisible(false);
  }

  // Sector-number anchors down the left of the strip, and the 起点/终点 tags in
  // the right margin. Created once and only repositioned afterwards:
  // drawOverview() runs on every input, and calling add.text() there would leak a
  // fresh set of objects per keypress.
  private buildOverviewAnnotations(): void {
    for (let s = 0; s < SECTOR_COUNT; s += 10) {
      this.sectorLabels.push(
        this.add
          .text(0, 0, String(s * SECTOR_SIZE + 1), { fontFamily: FONT_FAMILY, fontSize: `${TYPE_AUX}px`, color: hex(TEXT.highlight), backgroundColor: '#0b0f12cc', padding: { x: 2, y: 1 } })
          .setOrigin(1, 0)
          .setDepth(5),
      );
    }
    this.endpointLabels = [
      this.add
        .text(0, 0, '起点 第1层', { fontFamily: FONT_FAMILY, fontSize: `${TYPE_AUX}px`, color: hex(PALETTE.clothHigh), backgroundColor: '#0b0f12cc', padding: { x: 2, y: 1 } })
        .setOrigin(0, 0)
        .setDepth(5),
      this.add
        .text(0, 0, '终点 第100000层', { fontFamily: FONT_FAMILY, fontSize: `${TYPE_AUX}px`, color: '#d8a8e8', backgroundColor: '#0b0f12cc', padding: { x: 2, y: 1 } })
        .setOrigin(0, 0)
        .setDepth(5),
    ];
  }

  private buildDetailPanel(): void {
    const w = DETAIL_PANEL_W;
    const h = DETAIL_PANEL_H;
    const cx = DESIGN_WIDTH / 2;
    const cy = DESIGN_HEIGHT / 2;
    const left = cx - w / 2;
    const top = cy - h / 2;

    // The skin is captured, not just pushed: refreshDetail re-places it when the
    // floor's content list wraps past one line (the panel grows around it).
    this.detailPanelParts = buildPanel(this, cx, cy, w, h, 'yellow', PANEL_DEPTH.tower.detail);
    this.detailObjects.push(...this.detailPanelParts);
    this.detailTitle = this.add
      .text(cx, top + 22, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE_TITLE}px`, color: hex(PALETTE.lightHigh) })
      .setOrigin(0.5);
    this.detailRows = [];
    for (let i = 0; i < DETAIL_ROW_COUNT; i++) {
      // The content row (the last one) wraps: a floor with five containers and
      // ground loot lists up to 1113px of text (measured across seeds 42/7/2026,
      // worst floor 50008), and a single unwrapped line at that width runs
      // ~680px past the panel frame. useAdvancedWrap is load-bearing — Chinese
      // has no spaces, so the basic wrapper never breaks the line at all.
      const isContent = i === DETAIL_ROW_COUNT - 1;
      this.detailRows.push(
        this.add
          .text(left + DETAIL_ROW_X, top + DETAIL_ROWS_TOP + i * DETAIL_ROW_PITCH, '', {
            fontFamily: FONT_FAMILY,
            fontSize: `${TYPE_BODY}px`,
            color: hex(TEXT.primary),
            ...(isContent ? { wordWrap: { width: DETAIL_CONTENT_W, useAdvancedWrap: true } } : {}),
          })
          .setOrigin(0, 0),
      );
    }
    this.detailAction = this.add
      .text(cx, top + h - 20, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE_BODY}px`, color: hex(PALETTE.clothHigh) })
      .setOrigin(0.5);
    // Mouse: the action line is the button — clicking it does what Enter does.
    // Failure still routes through tryEnter(), which explains why.
    //
    // A hit rectangle, not setInteractive() on the text: this Text is created
    // empty and filled later by refreshDetail(), and Phaser sizes a Text's hit
    // area from its canvas at setInteractive() time — an empty Text gets a
    // zero-area hit area that setText never re-measures. Measured: the row looked
    // clickable and swallowed every press. The rect is in WORLD space because the
    // detail card is drawn in world space and moves with the camera.
    const actionHit = hitRect(this, cx - 110, top + h - 34, 220, 26, PANEL_DEPTH.tower.detail + 8, {
      onOver: () => this.detailAction.setColor(hex(PALETTE.lightHot)),
      onClick: () => this.tryEnter(),
    });
    actionHit.on('pointerout', () => this.detailAction.setColor(hex(PALETTE.clothHigh)));
    // Hidden and shown with the card, so it cannot be clicked behind it.
    this.detailObjects.push(actionHit);
    // And a back arrow, pinned to the screen (scrollFactor 0) rather than to the
    // world: at this level the camera scrolls, and a world-space arrow drifted
    // 300px up the tower.
    //
    // One hint-row ABOVE the footer, not on it: the footer owns the band from
    // DESIGN_HEIGHT - TOWER_FOOT_TOP (684..717), and the arrow used to open at
    // 685 — 91x27px of overlap, measured on all three tower levels, which made
    // the bottom-left corner read as one smudge.
    const back = this.add
      .text(14, DESIGN_HEIGHT - TOWER_FOOT_TOP - 26, '← 返回', { fontFamily: FONT_FAMILY, fontSize: `${TYPE_BODY}px`, color: hex(PALETTE.clothHigh) })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(PANEL_DEPTH.tower.detail + 6);
    textClickable(back, hex(PALETTE.clothHigh), hex(PALETTE.lightHot), { onClick: () => this.onBack() });
    this.detailObjects.push(this.detailTitle, ...this.detailRows, this.detailAction);
    applyPanelDepth(this.detailObjects, PANEL_DEPTH.tower.detail);
    for (const o of this.detailObjects) o.setVisible(false);
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

    // Set unconditionally, not from inside drawOverview(): the sector labels and
    // the endpoint tags are the overview's anchors, and only hiding them from here
    // keeps them from lingering over the sector grid after a drill-down.
    const onOverview = this.nav.level === 'overview';
    for (const label of this.sectorLabels) label.setVisible(onOverview);
    for (const label of this.endpointLabels) label.setVisible(onOverview);

    this.refreshHud();
    this.refreshDetail();
  }

  // The tower is drawn the way it stands: sector 0 (floor 1, the slum) at the
  // BOTTOM of the strip and sector 99 (floor 100000, the summit) at the TOP.
  // Everything here measures its row from the bottom, so `rowY(sector)` is the
  // single place the flip lives.
  private rowY(sector: number): number {
    return CONTENT_TOP + (SECTOR_COUNT - 1 - sector) * OVERVIEW_ROW_H;
  }

  private drawOverview(): void {
    const g = this.gridGfx;
    const currentSector = sectorOf(this.state.currentFloor);
    for (let s = 0; s < SECTOR_COUNT; s++) {
      const y = this.rowY(s);
      const summary = describeSector(s);
      const visited = this.isSectorVisited(s);
      g.fillStyle(tierColor(summary.tiers[0].tier), 1);
      // 2px of fill with a 1px gap keeps 100 rows countable as a striped tower
      // instead of one solid block where adjacent sectors share a tier.
      g.fillRect(TOWER_STRIP_X, y, TOWER_STRIP_W, OVERVIEW_ROW_H - 1);
      // A lit top edge on every row: at 3px a row there is no room for shading,
      // but one lighter pixel on top turns a flat stripe into a ledge, and it is
      // what stops the overview reading as a bar chart.
      g.fillStyle(PALETTE.dust, 0.3);
      g.fillRect(TOWER_STRIP_X, y, TOWER_STRIP_W, 1);
      if (visited) {
        // A full-height explored stripe along the left edge of the strip: at 3px
        // per sector anything narrower is invisible.
        g.fillStyle(COLOR_EXPLORED, 1);
        g.fillRect(TOWER_STRIP_X, y, 8, OVERVIEW_ROW_H - 1);
      }
    }

    // Current sector: the one thing that must always be visible and legible.
    const cy = this.rowY(currentSector);
    this.currentGfx.fillStyle(COLOR_CURRENT, 1);
    this.currentGfx.fillRect(TOWER_STRIP_X, cy, TOWER_STRIP_W, OVERVIEW_ROW_H);
    this.currentGfx.lineStyle(1, PALETTE.ink, 1);
    this.currentGfx.strokeRect(TOWER_STRIP_X - 0.5, cy - 0.5, TOWER_STRIP_W + 1, OVERVIEW_ROW_H + 1);

    // Keyboard cursor.
    const ky = this.rowY(this.nav.cursor);
    this.cursorGfx.lineStyle(1, COLOR_CURSOR, 1);
    this.cursorGfx.strokeRect(TOWER_STRIP_X - 3, ky - 1, TOWER_STRIP_W + 6, OVERVIEW_ROW_H + 2);

    // The two ends of the climb. The summit in particular has to be marked: it
    // is the goal the whole tower is arranged around, and at 3px a row the last
    // sector is otherwise indistinguishable from the nine below it — it is not
    // even in the every-tenth label set. Drawn after the current-sector marker so
    // they stay visible when the player is standing on one of them.
    const startY = this.rowY(0); // the slum, at the base
    const endY = this.rowY(SECTOR_COUNT - 1); // the summit, at the top
    this.currentGfx.fillStyle(COLOR_START, 1);
    this.currentGfx.fillRect(TOWER_STRIP_X + TOWER_STRIP_W - 12, startY, 12, OVERVIEW_ROW_H);
    this.currentGfx.fillStyle(COLOR_SUMMIT, 1);
    this.currentGfx.fillRect(TOWER_STRIP_X + TOWER_STRIP_W - 12, endY, 12, OVERVIEW_ROW_H);
    // Ticks reaching into the right margin, where the labels sit.
    this.currentGfx.fillStyle(COLOR_START, 1);
    this.currentGfx.fillRect(TOWER_STRIP_X + TOWER_STRIP_W, startY + 1, 6, 1);
    this.currentGfx.fillStyle(COLOR_SUMMIT, 1);
    this.currentGfx.fillRect(TOWER_STRIP_X + TOWER_STRIP_W, endY + 1, 6, 1);

    this.drawTierBands();
    this.drawSectorLabels();
    this.drawBossSpine();
    this.drawEndpoints();
  }

  // The boss spine: one red flag down the left edge of every sector whose
  // floors can roll a guardian. At 3px a row there is no room for a second
  // colour band inside the strip (the tier colour IS the row), so the mark
  // lives in the left margin the explored stripe already uses — 8px wide,
  // full row height, drawn after the explored stripe so it wins where both
  // apply. Floor 5 and floor 110 share sector 0, which is correct: one sector
  // with two guardians is still one marked sector.
  private drawBossSpine(): void {
    for (const floor of BOSS_FLOOR_NUMBERS) {
      const y = this.rowY(sectorOf(floor));
      this.currentGfx.fillStyle(COLOR_BOSS, 1);
      this.currentGfx.fillRect(TOWER_STRIP_X, y, 8, OVERVIEW_ROW_H - 1);
      // A 1px tick above the row: at 3px the row's own top edge is the lit
      // dust line, and without this the spine reads as a darker stripe rather
      // than a mark standing proud of the row.
      this.currentGfx.fillStyle(PALETTE.dust, 1);
      this.currentGfx.fillRect(TOWER_STRIP_X, y - 1, 8, 1);
    }
  }

  // 起点 / 终点 tags in the right margin. At 3px a row neither end can carry its
  // own text, and the summit is the one thing a player must be able to find
  // without counting rows.
  private drawEndpoints(): void {
    this.endpointLabels[0].setPosition(TOWER_TAG_X, this.rowY(0) - 1);
    this.endpointLabels[1].setPosition(TOWER_TAG_X, this.rowY(SECTOR_COUNT - 1) - 5);
  }

  private drawTierBands(): void {
    const g = this.gridGfx;
    // A boundary line at each tier's first sector, so the colour gradient reads
    // as a class hierarchy rather than decoration.
    for (const tier of TIERS) {
      const y = this.rowY(Math.floor((tier.minFloor - 1) / SECTOR_SIZE));
      g.lineStyle(1, PALETTE.dust, 0.9);
      g.lineBetween(TOWER_STRIP_X - 12, y, TOWER_STRIP_X + TOWER_STRIP_W + 12, y);
    }
  }

  // At 3px per row no row can carry its own label, so every tenth sector is
  // numbered instead. Those anchors are what a player reads the tower by, and
  // they are what makes "all 100 sectors are on screen" verifiable by eye.
  // Positions only — redraw() owns the visibility, because this is not called at
  // the other two levels.
  private drawSectorLabels(): void {
    this.sectorLabels.forEach((label, i) => {
      // Label i names sector i*10, which now sits at rowY(i*10) — low on the
      // strip for low sectors, high for high ones.
      label.setPosition(TOWER_STRIP_X - 14, this.rowY(i * 10));
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
    // Rows stack from the bottom of the sector, and within a row floors read left
    // to right — the same way up the tower reads. `cellY` is the single place the
    // flip lives, matching pickFloorAt().
    const cellY = (floor: number): number => {
      const rowFromBottom = Math.floor((floor - from) / SECTOR_COLS);
      return originY + (SECTOR_ROWS - 1 - rowFromBottom) * SECTOR_CELL;
    };
    for (let floor = from; floor <= to; floor++) {
      const col = (floor - from) % SECTOR_COLS;
      const x = originX + col * SECTOR_CELL;
      const y = cellY(floor);
      if (floor <= highest) {
        g.fillStyle(this.state.visitedFloors[floor] ? COLOR_EXPLORED : COLOR_UNLOCKED, 1);
      } else {
        g.fillStyle(COLOR_LOCKED, 1);
      }
      g.fillRect(x, y, SECTOR_CELL - 1, SECTOR_CELL - 1);
      // A bevel per cell, and a brightness ramp with height.
      //
      // The grid used to be 1000 flat fills, which measured as 52% one colour
      // and 131 distinct colours in the whole frame - the flattest screen in the
      // game. A 1px light edge on top and a dark one underneath turns each cell
      // into a block you can see the shape of, and brightening toward the top of
      // the sector reinforces that the tower climbs.
      if (floor <= highest) {
        const climb = (floor - from) / Math.max(1, to - from);
        g.fillStyle(PALETTE.dust, 0.12 + climb * 0.22);
        g.fillRect(x, y, SECTOR_CELL - 1, 1);
        g.fillStyle(PALETTE.ink, 0.35);
        g.fillRect(x, y + SECTOR_CELL - 2, SECTOR_CELL - 1, 1);
        g.fillStyle(PALETTE.ink, 0.22);
        g.fillRect(x + SECTOR_CELL - 2, y, 1, SECTOR_CELL - 1);
      } else {
        g.fillStyle(PALETTE.ink, 0.5);
        g.fillRect(x, y, SECTOR_CELL - 1, 1);
        g.fillRect(x, y, 1, SECTOR_CELL - 1);
      }
    }

    // Current floor marker: filled, so it reads at a glance rather than only as
    // an outline lost among 1000 cells.
    if (this.state.currentFloor >= from && this.state.currentFloor <= to) {
      const col = (this.state.currentFloor - from) % SECTOR_COLS;
      const cx = originX + col * SECTOR_CELL;
      const cy2 = cellY(this.state.currentFloor);
      this.currentGfx.fillStyle(COLOR_CURRENT, 1);
      this.currentGfx.fillRect(cx, cy2, SECTOR_CELL - 1, SECTOR_CELL - 1);
      this.currentGfx.lineStyle(1, PALETTE.ink, 1);
      this.currentGfx.strokeRect(cx - 0.5, cy2 - 0.5, SECTOR_CELL, SECTOR_CELL);
    }

    // Keyboard cursor.
    const cursorCol = (this.nav.cursor - from) % SECTOR_COLS;
    const kx = originX + cursorCol * SECTOR_CELL;
    const ky = cellY(this.nav.cursor);
    this.cursorGfx.lineStyle(2, COLOR_CURSOR, 1);
    this.cursorGfx.strokeRect(kx - 2, ky - 2, SECTOR_CELL + 3, SECTOR_CELL + 3);

    // Boss cells: a red rim, the same hue as the overview's spine, so the
    // guardian's floor is findable inside the sector and not only on the
    // overview's row. Drawn last so it reads over the cell's own bevel.
    for (const floor of BOSS_FLOOR_NUMBERS) {
      if (floor < from || floor > to) continue;
      const col = (floor - from) % SECTOR_COLS;
      const bx = originX + col * SECTOR_CELL;
      const by = cellY(floor);
      this.currentGfx.lineStyle(2, COLOR_BOSS, 1);
      this.currentGfx.strokeRect(bx - 1.5, by - 1.5, SECTOR_CELL + 2, SECTOR_CELL + 2);
    }
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
    // One state chip carries the floor, the frontier and the zoom (AG-12): the
    // zoom reading used to be its own top-right chip, which the world-space
    // 终点 tag scrolled through at every zoom above 1x. See buildHud.
    this.stateText.setText(`当前 ${this.state.currentFloor} 层 · 已打通至 ${this.access.highestUnlocked} 层 · 缩放 ${zoomLabel}`);

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
    // Only the sector grid, the floor detail and the overview's boss spine
    // carry a colour language worth spelling out.
    const level = this.nav.level;
    const show = level === 'overview' || level === 'sector' || level === 'floor';
    this.legendGfx.setVisible(show);
    this.legendText.setVisible(show);
    if (!show) return;

    // Cleared every pass: the graphics object accumulates fillRects, so without
    // this the four sector swatches stayed behind when the overview's single
    // boss swatch replaced them (and came back on the next drill-down).
    this.legendGfx.clear();
    const swatch = 7;
    const gap = 4;
    // Lay the entries out right-to-left from the bottom-right corner, so the
    // legend never collides with the bottom-left control hint.
    const y = DESIGN_HEIGHT - TOWER_FOOT_TOP;

    // The legend spells out every non-tier colour on screen. The overview's
    // only one is the boss spine — its other marks (当前/起点/终点) carry their
    // own tags. The sector and floor views add the four cell states, plus the
    // boss rim when the sector in view actually holds a guardian.
    const entries: Array<{ color: number; label: string }> =
      level === 'overview' ? [{ color: COLOR_BOSS, label: '守段者层' }] : [...LEGEND];
    if (level !== 'overview') {
      const { from, to } = sectorRange(this.nav.sector);
      if (BOSS_FLOOR_NUMBERS.some((floor) => floor >= from && floor <= to)) {
        entries.push({ color: COLOR_BOSS, label: '守段者层' });
      }
    }

    // The swatches have to land on their own labels inside the joined string,
    // so the layout mirrors that string: label widths and the '  ' separator
    // measured with the project's estimator (one em per Han glyph — exact for
    // these labels). The old `label.length * TYPE_AUX * 0.5` halved every Han
    // glyph, which put the swatches ~150px right of their labels: measured,
    // "当前" was estimated 22px wide and drawn 44px.
    const sepW = estimateTextWidth('  ', TYPE_AUX);
    const widths = entries.map((l) => estimateTextWidth(l.label, TYPE_AUX));
    const labelRight: number[] = [];
    let right = DESIGN_WIDTH - 12;
    for (let i = entries.length - 1; i >= 0; i--) {
      labelRight[i] = right;
      right -= widths[i] + (i > 0 ? sepW : 0);
    }
    entries.forEach((entry, i) => {
      const swatchX = labelRight[i] - widths[i] - gap - swatch;
      this.legendGfx.fillStyle(entry.color, 1);
      this.legendGfx.fillRect(swatchX, y + 3, swatch, swatch);
    });
    this.legendText.setText(entries.map((l) => l.label).join('  '));
  }

  private refreshDetail(): void {
    const floor = this.nav.floor;
    const show = this.nav.level === 'floor' && floor !== null;
    for (const o of this.detailObjects) o.setVisible(show);
    if (!show || floor === null) return;

    const record = describeFloor(floor);
    // Authored or not — that is the switch between the card's two data
    // sources, and it is hasFloorContent, NOT visitedFloors: an authored floor
    // the player has not walked into yet still has real, seeded contents (the
    // loot view resolves them), while a floor with no template has nothing
    // resolved at all until worldgen rolls it. (Floor 100000 borrows floor 1's
    // template through the dev alias for entry purposes only; it is not
    // authored, so it takes the estimate path like every other unexplored
    // floor — see floorTemplates' hasFloorContent.)
    const authored = hasFloorContent(floor);
    const template = authored ? getFloorTemplate(floor) : undefined;
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
    // What is on the floor, from one of two sources:
    //
    //  - authored floors keep LootSystem.describeFloorContents: it reads the
    //    RESOLVED world (seed rolls applied, taken stacks removed), which is
    //    the only honest answer for a floor whose contents already exist. This
    //    scene used to read the loot table instead, so it advertised 布料 in
    //    floor 1's cabinet on every seed and kept listing contents already
    //    emptied.
    //  - unexplored floors (99946 of the tower) used to fall through to
    //    LootSystem's "内容：未生成" placeholder, which told the player
    //    nothing — and the map's whole job is planning a trip. They now read
    //    worldgen.summarizeFloor: "this is what the floor would look like if
    //    you explored it", the same numbers generateFloorContent rolls on
    //    arrival. The two sources are distinguishable on the card by their
    //    prefix (内容： vs 未探索·预估：) and by the estimate row's warn
    //    colour, so a prediction never reads as a resolved fact.
    let contents: string;
    if (authored) {
      contents = describeFloorContents(this.state, floor);
      this.detailRows[4].setColor(hex(TEXT.primary));
    } else {
      contents = describeUnexploredFloor(this.state, floor);
      this.detailRows[4].setColor(hex(TEXT.warn));
    }
    this.detailRows[4].setText(contents);
    this.detailAction.setText(enterable.ok ? '按 Enter 进入' : '需先通过实际通路抵达').setColor(enterable.ok ? hex(PALETTE.clothHigh) : hex(TEXT.warn));

    // ── adaptive card ────────────────────────────────────────────────────────
    // The content row wraps to as many lines as the floor needs, and the card
    // grows around it: the action line follows the content's bottom, the skin
    // wraps both, and the whole card keeps its centre on screen. Re-place only —
    // the objects were built once in buildDetailPanel at the base geometry.
    //
    // The height is the Text's OWN measured height, not wrapText's line count.
    // The estimator is a few percent under the rasteriser, and on the worldgen
    // estimate (a 7-item tier-1 pool wraps to five real lines where wrapText
    // predicts four) that one line printed the action row 6px through the
    // content's last line — the same defect class AG-08 fixed for the authored
    // worst case, arriving through the new data source. Text.height is updated
    // synchronously by setText, so the wrap it actually performed is the number
    // used here; wrapText stays in the tests as the arithmetic guard.
    const lineH = estimateLineHeight(TYPE_BODY);
    const contentTop = DETAIL_ROWS_TOP + DETAIL_ROW_PITCH * (DETAIL_ROW_COUNT - 1);
    const contentH = this.detailRows[4].height;
    const actionTop = contentTop + contentH + DETAIL_CONTENT_ACTION_GAP;
    const panelH = Math.max(DETAIL_PANEL_H, actionTop + lineH + DETAIL_FOOT_PAD);

    const cx = DESIGN_WIDTH / 2;
    const left = cx - DETAIL_PANEL_W / 2;
    const top = DESIGN_HEIGHT / 2 - panelH / 2;
    const right = left + DETAIL_PANEL_W;
    const bottom = top + panelH;

    const bandH = panelH / PANEL_FILL_BANDS;
    this.detailPanelParts.slice(0, PANEL_FILL_BANDS).forEach((part, i) => {
      (part as Phaser.GameObjects.Rectangle).setPosition(cx, top + bandH * (i + 0.5)).setDisplaySize(DETAIL_PANEL_W, bandH + 1);
    });
    const [pTL, pTR, pBL, pBR, pT, pB, pL, pR] = this.detailPanelParts.slice(PANEL_FILL_BANDS, PANEL_FILL_BANDS + PANEL_FRAME_PIECES) as Phaser.GameObjects.Image[];
    pTL.setPosition(left, top);
    pTR.setPosition(right - PANEL_SLICE, top);
    pBL.setPosition(left, bottom - PANEL_SLICE);
    pBR.setPosition(right - PANEL_SLICE, bottom - PANEL_SLICE);
    pT.setPosition(left + PANEL_SLICE, top).setDisplaySize(DETAIL_PANEL_W - PANEL_SLICE * 2, PANEL_SLICE);
    pB.setPosition(left + PANEL_SLICE, bottom - PANEL_SLICE).setDisplaySize(DETAIL_PANEL_W - PANEL_SLICE * 2, PANEL_SLICE);
    pL.setPosition(left, top + PANEL_SLICE).setDisplaySize(PANEL_SLICE, panelH - PANEL_SLICE * 2);
    pR.setPosition(right - PANEL_SLICE, top + PANEL_SLICE).setDisplaySize(PANEL_SLICE, panelH - PANEL_SLICE * 2);

    this.detailTitle.setPosition(cx, top + 22);
    this.detailRows.forEach((row, i) => row.setPosition(left + DETAIL_ROW_X, top + DETAIL_ROWS_TOP + i * DETAIL_ROW_PITCH));
    this.detailAction.setPosition(cx, top + actionTop + lineH / 2);
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
