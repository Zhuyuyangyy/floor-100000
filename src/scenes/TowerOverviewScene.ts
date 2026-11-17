import Phaser from 'phaser';

import { FONT_FAMILY } from '../render/uiKit';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../core/design';
import { getGame } from '../core/session';
import { ENTRY_X, PLAYABLE_FLOORS_V01, environmentFor, warmthOf } from '../core/constants';
import {
  accessOf,
  enterFloor,
  enterSector,
  navBack,
  nudgeFloor,
  nudgeSector,
  openTower,
  tryEnterSelected,
  type TowerNavState,
} from '../systems/TowerNav';
import {
  TIERS,
  TOTAL_FLOORS,
  describeFloor,
  describeSector,
  sectorOf,
  sectorRange,
  tierOf,
  type TierId,
} from '../core/tower';
import { PLAYABLE_SEGMENTS, liftDirection } from '../core/segments';
import { getFloorTemplate, hasFloorContent } from '../data/floorTemplates';
import { getItem } from '../data/items';
import { npcsOnFloor } from '../data/npcs';
import { summarizeFloor } from '../core/worldgen';
import { describeFloorContents } from '../systems/LootSystem';
import { encounterSpots } from '../systems/encounterSpots';
import { saveToStorage } from '../systems/SaveSystem';
import { playSfx } from '../render/audio';
import {
  applyPanelDepth,
  buildPanel,
  PANEL_DEPTH,
  PANEL_FILL_BANDS,
  PANEL_FRAME_PIECES,
  PANEL_SLICE,
  type PanelObject,
} from '../render/panels';
import { hitRect, textClickable } from '../render/pointer';
import { PALETTE, ROLE, TEXT, hex } from '../render/palette.ts';
import { estimateLineHeight, estimateTextWidth } from '../render/dialogueLayout';
import {
  baseHighY,
  baseLowY,
  buildingFloorY,
  buildingHeight,
  buildingX0,
  buildingX1,
  DETAIL_CONTENT_ACTION_GAP,
  DETAIL_CONTENT_W,
  DETAIL_FOOT_PAD,
  DETAIL_PANEL_H,
  DETAIL_PANEL_W,
  DETAIL_ROWS_TOP,
  DETAIL_ROW_COUNT,
  DETAIL_ROW_PITCH,
  DETAIL_ROW_X,
  floorAtBuildingY,
  floorAtRibbonY,
  sectorRibbonHeight,
  sectorRibbonY,
  tierBlockHighY,
  tierBlockLowY,
  TOWER_FOOT_TOP,
  TOWER_MAP,
  TOWER_TAG_FONT,
  TOWER_TAG_X,
  towerFitZoom,
  viewCenterBounds,
} from '../render/hudLayout';
import type { GameState } from '../core/gameTypes';

// TowerOverviewScene — the tower map as a BUILDING CROSS-SECTION (AG-62,
// 2026-11-17 用户反馈：「地图现在也很难看，可以做一个缩小版本的更好看一点，
// 不要一下子看到 1 万层很奇怪」「可以放大一点地图……你再做一个地下室啥的也能
// 看见，就是前面 5 层都能看见，因为相当于是我们基础发育的一个地方」).
//
// The old map was one 3px-per-sector strip: 100 rows in 300px, so pressing M
// showed all 100000 floors at once as a bar chart, and the sector level was a
// 20x50 grid of flat squares. Both are gone. What is here now:
//
//   overview — 楼体剖面. The basement (floors 1-5, the 基础发育区) is a thick
//     labelled base with a foundation; each of the six tiers is one section of
//     the building with a structural seam (platform/machine room) between
//     sections; floors are hairlines inside a section wherever the pitch is
//     visible. The camera opens FOCUSED on the segment the player stands in
//     (TOWER_MAP.zoomDefault) — not on the whole spire — and zooms out to the
//     whole tower on the wheel or F.
//   sector — the same building, one level down: the sector's 1000 floors as a
//     readable ribbon (TOWER_MAP.sectorPitch per floor) in the section's own
//     colours, because a 40000-floor tier can never show its floors at building
//     scale. The magnifier, not a second visual language.
//   floor — the ribbon plus the detail card.
//
// Selecting is never entering: the only way out of this scene into a different
// floor is TowerNav.tryEnterSelected(), which refuses anything above the
// frontier the player has actually reached. Everything else in the tower is
// visible but inert.
//
// Every label is screen-space (scrollFactor 0) and positioned from the world
// each redraw; only the building and the marks live in world space, so the
// camera zoom never rescales type. The scroll clamp (viewCenterBounds) keeps
// the building inside the fixed HUD bands — the map has no gray dead zones of
// its own, and its world labels never reach the title/state chips.

const TYPE_TITLE = 32;
const TYPE_BODY = 26;
const TYPE_AUX = 22;
const TYPE_CAPTION = 20;
const TYPE_DECADE = 18;

// One colour per tier, brightening as the tower climbs: the gradient is the
// whole point of the class society (design freeze §3).
const TIER_COLOR: Record<TierId, number> = {
  // One step per tier, climbing from stone through teal and into the light
  // family: the map's own colour journey mirrors the run's.
  1: PALETTE.stone,
  2: PALETTE.stoneLight,
  3: PALETTE.cloth,
  4: PALETTE.clothLight,
  5: PALETTE.lightDeep,
  6: PALETTE.light,
};

// The 地下基座 is the only warm mass on the map: the palette keeps warm pixels
// scarce so that anything warm reads as "lit", and the starting five floors are
// exactly that — the dorm's candles, floor 5's brazier. It is also what makes
// the base read as underground rather than as a seventh tier.
const COLOR_BASE = PALETTE.skinDeep;
const COLOR_BASE_LINE = PALETTE.skinLight;
const COLOR_FOUNDATION = PALETTE.stone;

const COLOR_LOCKED = PALETTE.shadow;
const COLOR_UNLOCKED = PALETTE.cloth;
const COLOR_EXPLORED = PALETTE.clothHigh;
const COLOR_CURRENT = PALETTE.lightHigh;
const COLOR_CURSOR = 0xece8d8; // the text cream; the palette's ink-friendly neutral
const COLOR_BG = PALETTE.ink;
const COLOR_START = PALETTE.clothHigh;
const COLOR_SUMMIT = 0xd8a8e8;
// The boss flag. Same red as the low-HP vignette and the combat numbers, so a
// floor that can roll a guardian reads as danger before the player knows the
// word for it.
const COLOR_BOSS = ROLE.danger;

/** Blend two 24-bit colours; local so this module keeps no Phaser runtime use. */
function mixColour(a: number, b: number, t: number): number {
  const lerp = (ca: number, cb: number): number => Math.round(ca + (cb - ca) * t);
  return (
    (lerp((a >> 16) & 0xff, (b >> 16) & 0xff) << 16) |
    (lerp((a >> 8) & 0xff, (b >> 8) & 0xff) << 8) |
    lerp(a & 0xff, b & 0xff)
  );
}

function tierColor(tier: TierId): number {
  return TIER_COLOR[tier];
}

// The floors that can roll a boss, read through encounterSpots' own API.
//
// Deliberately NOT a second filter over ENCOUNTER_TABLE: that is the exact
// expression systems/encounterSpots already makes for its own marker
// (BOSS_SPOT_FLOORS there), and a copy in the scene is how the map drifts from
// the game the moment a segment is authored. Asking encounterSpots() per floor
// delegates to the single source of truth, so a floor whose table gains a boss
// entry gets its flag here automatically, and one that loses one loses it.
// The seed is irrelevant to isBoss (it depends only on the floor), so a fixed
// value reads the table; 0 is the obvious one. Computed once at module level —
// it reads static data and the mark passes run on every input.
//
// uiLayout.test.ts asserts this set equals [5, 110, 50010], so the derivation
// is pinned against the table rather than against this expression.
const BOSS_FLOOR_NUMBERS: readonly number[] = PLAYABLE_FLOORS_V01.filter((floor) =>
  encounterSpots(0, floor).some((spot) => spot.isBoss),
);

// Where the freight lift stands, read through segments' own API (the lift's
// direction is a pure function of the floor there). One entry per segment end
// that actually has a lift; the summit's down-lift is included.
const LIFT_MARKS: ReadonlyArray<{ floor: number; dir: 'up' | 'down' }> = PLAYABLE_SEGMENTS.flatMap((seg) => {
  const marks: Array<{ floor: number; dir: 'up' | 'down' }> = [];
  const atFrom = liftDirection(seg.from);
  const atTo = liftDirection(seg.to);
  if (atFrom) marks.push({ floor: seg.from, dir: atFrom });
  if (atTo) marks.push({ floor: seg.to, dir: atTo });
  return marks;
});

// The basement's five floors are authored with their own environment labels
// (宿舍/邻居宿舍/储物层/维修层/食堂) — the map prints them on the base, which is
// what makes 「前面 5 层都能看见」 land as rooms rather than as five lines.
const BASE_FLOOR_LABELS: readonly string[] = [1, 2, 3, 4, 5].map((f) => environmentFor(f).label);

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
 * they are.
 *
 * questPanel.test.ts mirrors this string verbatim; if the wording changes,
 * that mirror changes with it.
 */
function describeUnexploredFloor(state: GameState, floor: number): string {
  const summary = summarizeFloor(state.runSeed, floor);
  const loot = summary.lootPool.map((id) => getItem(id).displayName);
  return `未探索·预估：${summary.tier.name} · 容器 ${summary.containerCount} 个 · 物资 ${summary.supplyGrade} 档 · 威胁「${summary.threatLabel}」 · 或可找到 ${loot.join('·')}`;
}

// The hover/selected floor readout: one line carrying everything the brief
// asks a floor to answer with — number, segment, environment (cold/humidity/
// warmth/night), and whether there is anything on it (containers, question
// spots, NPCs). All of it read-only: environmentFor/warmthOf are pure,
// summarizeFloor is worldgen's deterministic preview, encounterSpots reads the
// static table, npcsOnFloor reads data — nothing here rolls state.
function fitInfoLine(core: string[], alerts: string[], maxWidth: number, fontSize: number): string {
  const parts = [...core];
  while (parts.length > 1) {
    const line = [...parts, ...alerts].join(' · ');
    if (estimateTextWidth(line, fontSize) <= maxWidth) return line;
    parts.pop(); // 从中部丢事实：NPC → 房名 → ？ → 暖 → 潮 → 寒 → 容器；层号、段名与告警永远保留
  }
  return [...parts, ...alerts].join(' · ');
}

type MapKey = 'up' | 'down' | 'left' | 'right' | 'enter' | 'esc' | 'fit' | 'close';

export class TowerOverviewScene extends Phaser.Scene {
  private nav!: TowerNavState;
  private access!: ReturnType<typeof accessOf>;
  private state!: GameState;

  private skyGfx!: Phaser.GameObjects.Graphics;
  private bodyGfx!: Phaser.GameObjects.Graphics;
  private markGfx!: Phaser.GameObjects.Graphics;

  private hudText!: Phaser.GameObjects.Text;
  private stateText!: Phaser.GameObjects.Text;
  private readoutText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private legendGfx!: Phaser.GameObjects.Graphics;
  private legendText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private fitText!: Phaser.GameObjects.Text;
  private fitHit!: Phaser.GameObjects.Rectangle;

  // Screen-space labels, positioned from the world every redraw (see the file
  // header). Created once; only repositioned afterwards, because redraw() runs
  // on every input and add.text() there would leak a fresh set per keypress.
  private tierPlates: Phaser.GameObjects.Text[] = [];
  private baseFloorLabels: Phaser.GameObjects.Text[] = [];
  private endpointLabels: Phaser.GameObjects.Text[] = [];
  private decadeLabels: Phaser.GameObjects.Text[] = [];
  private currentChip!: Phaser.GameObjects.Text;

  private detailObjects: PanelObject[] = [];
  /** buildPanel's return for the detail card: [fill x PANEL_FILL_BANDS, frame x PANEL_FRAME_PIECES]. */
  private detailPanelParts: PanelObject[] = [];
  private detailTitle!: Phaser.GameObjects.Text;
  private detailRows: Phaser.GameObjects.Text[] = [];
  private detailAction!: Phaser.GameObjects.Text;
  private detailActionHit!: Phaser.GameObjects.Rectangle;

  private dragging = false;
  private dragMoved = false;
  private dragStart = { x: 0, y: 0 };
  // Floor under the pointer on the building/ribbon, or null. Seams and the
  // foundation have no floor, so they pick nothing.
  private hoverFloor: number | null = null;

  // Per-frame input guard (GHI-03 m9): Phaser can deliver one keydown several
  // times inside a single frame, and a scene restart must not inherit the
  // previous visit's frame numbers.
  private lastInputFrame: Record<MapKey, number> = {
    up: -1,
    down: -1,
    left: -1,
    right: -1,
    enter: -1,
    esc: -1,
    fit: -1,
    close: -1,
  };

  private keys!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    enter: Phaser.Input.Keyboard.Key;
    esc: Phaser.Input.Keyboard.Key;
    fit: Phaser.Input.Keyboard.Key;
    close: Phaser.Input.Keyboard.Key;
  };

  constructor() {
    super('TowerOverview');
  }

  create(): void {
    // The scene INSTANCE is reused across restarts (scene.start does not build a
    // new one), so every builder below has to be idempotent. Leftovers are not
    // merely a leak: a Text that survived a restart carries a frame whose
    // texture data the shutdown already dropped, and setText on one throws
    // (measured: Frame.updateUVs reading null.drawImage) — which used to kill
    // redraw() mid-pass and leave the HUD showing the previous level.
    this.teardownOwned();
    this.lastInputFrame = { up: -1, down: -1, left: -1, right: -1, enter: -1, esc: -1, fit: -1, close: -1 };
    this.state = getGame();
    this.access = accessOf(this.state);
    this.nav = this.focusOverview(openTower(this.access));

    this.cameras.main.setBackgroundColor(COLOR_BG);
    // OVERHAUL UI: the map's backdrop used to be one flat ink fill, which the QA
    // sweep measured at 52% of the frame in a single colour - the flattest screen
    // in the game. A vertical gradient from the tower's base tone up to the
    // summit tone gives the empty space a direction: you are looking up.
    // Scroll-locked: the sky is a SCREEN-space backdrop. The old scene left it
    // in world space, which only worked because its zoom never went below 1 —
    // at this map's whole-tower zoom (0.28) a world-space sky would be a 200px
    // sliver in the corner.
    this.skyGfx = this.add.graphics().setScrollFactor(0).setDepth(-10);
    const steps = 10;
    for (let i = 0; i < steps; i++) {
      const k = i / (steps - 1);
      // Bottom (base of the tower) is warmer and darker; top is cold distance.
      const color = mixColour(PALETTE.lightDeep, PALETTE.stone, k * 0.55);
      this.skyGfx.fillStyle(color, 1);
      this.skyGfx.fillRect(0, (DESIGN_HEIGHT / steps) * i, DESIGN_WIDTH, DESIGN_HEIGHT / steps + 1);
    }
    this.skyGfx.setAlpha(0.5);

    this.bodyGfx = this.add.graphics();
    this.markGfx = this.add.graphics().setDepth(2);

    this.buildHud();
    this.buildWorldLabels();
    this.buildDetailPanel();
    this.bindInput();
    this.redraw();

    this.events.off(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

    // Dev-only handle so Playwright can assert on the real nav level, cursor,
    // frontier, camera coverage and cell colouring instead of guessing from
    // pixels — the map's whole language is colour, so it has to be testable.
    if (import.meta.env.DEV) {
      (window as unknown as { __PHASER_TOWER__?: unknown }).__PHASER_TOWER__ = {
        getNav: () => this.nav,
        getAccess: () => this.access,
        getView: () => ({
          // The world y at screen 0 (the viewport's top), under Phaser's
          // centre convention: viewTop = scroll + half - half/zoom.
          top: this.cameras.main.scrollY + DESIGN_HEIGHT / 2 - DESIGN_HEIGHT / 2 / this.nav.zoom,
          height: this.viewHeight(),
          content: this.contentHeight(),
        }),
        getCells: () => this.cellStates(),
        getLayout: () => ({
          level: this.nav.level,
          zoom: this.nav.zoom,
          scroll: this.cameras.main.scrollY,
          viewHeight: this.viewHeight(),
          content: this.contentHeight(),
          buildingHeight: buildingHeight(),
          baseLowY: baseLowY(),
          baseHighY: baseHighY(),
          buildingScreenX0: this.screenXOf(buildingX0()),
          buildingScreenX1: this.screenXOf(buildingX1()),
          hoverFloor: this.hoverFloor,
          currentFloor: this.state.currentFloor,
        }),
        floorScreenY: (floor: number) =>
          this.screenY(
            this.nav.level === 'overview'
              ? buildingFloorY(floor)
              : sectorRibbonY(sectorRange(this.nav.sector).from, floor),
          ),
      };
    }
  }

  /** Destroy the previous visit's objects and reset every owned list. */
  private teardownOwned(): void {
    const singles = [
      this.skyGfx,
      this.bodyGfx,
      this.markGfx,
      this.legendGfx,
      this.hudText,
      this.stateText,
      this.readoutText,
      this.hintText,
      this.legendText,
      this.messageText,
      this.fitText,
      this.fitHit,
      this.currentChip,
    ];
    for (const o of singles) o?.destroy();
    for (const l of [...this.tierPlates, ...this.baseFloorLabels, ...this.endpointLabels, ...this.decadeLabels]) l?.destroy();
    for (const o of this.detailObjects) o?.destroy();
    this.tierPlates = [];
    this.baseFloorLabels = [];
    this.endpointLabels = [];
    this.decadeLabels = [];
    this.detailObjects = [];
    this.detailPanelParts = [];
  }

  private onShutdown(): void {
    this.unbindInput();
    this.input.removeListener(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.removeListener(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.removeListener(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
  }

  // ── camera model ───────────────────────────────────────────────────────
  // Phaser's camera centres its view on the world point
  // (scrollX + canvasWidth/2, scrollY + canvasHeight/2) — NOT on the viewport's
  // top-left corner. Measured the hard way: with scrollX = -1624 at zoom 0.28
  // the camera's midPoint was (-984, 48.7) = scroll + (640, 360), and the
  // building rendered 460px right of where the top-left convention predicted.
  // Every conversion below goes through that centre.
  //
  // The building is centred on world x = 640, so scrollX is permanently 0 and
  // only scrollY ever moves. Zoom is the camera's own: a world unit is 1/zoom
  // screen pixels around the centre.

  private viewHeight(): number {
    return DESIGN_HEIGHT / this.nav.zoom;
  }

  private contentHeight(): number {
    return this.nav.level === 'overview' ? buildingHeight() : sectorRibbonHeight();
  }

  private screenY(worldY: number): number {
    return this.screenYFor(this.nav, worldY);
  }

  /** 屏 y = (世界 y - 镜头中心) * zoom + 画布半高。 */
  private screenYFor(nav: TowerNavState, worldY: number): number {
    return (worldY - nav.scroll - DESIGN_HEIGHT / 2) * nav.zoom + DESIGN_HEIGHT / 2;
  }

  private screenXOf(worldX: number): number {
    return (worldX - this.cameras.main.scrollX - DESIGN_WIDTH / 2) * this.nav.zoom + DESIGN_WIDTH / 2;
  }

  private worldYAt(screenY: number): number {
    return (screenY - DESIGN_HEIGHT / 2) / this.nav.zoom + this.cameras.main.scrollY + DESIGN_HEIGHT / 2;
  }

  private zoomRange(): { min: number; max: number } {
    return this.nav.level === 'overview'
      ? { min: towerFitZoom(), max: TOWER_MAP.zoomMax }
      : { min: TOWER_MAP.sectorZoomMin, max: TOWER_MAP.sectorZoomMax };
  }

  private contentHeightFor(nav: TowerNavState): number {
    return nav.level === 'overview' ? buildingHeight() : sectorRibbonHeight();
  }

  /** Clamp a camera CENTRE (world y) so the content always covers the band. */
  private clampCenterFor(nav: TowerNavState, center: number): number {
    const { min, max } = viewCenterBounds(this.contentHeightFor(nav), nav.zoom);
    return Math.max(min, Math.min(max, center));
  }

  /** Scroll that centres the camera on `worldY`, clamped to the content band. */
  private centerScrollFor(nav: TowerNavState, worldY: number): number {
    return this.clampCenterFor(nav, worldY) - DESIGN_HEIGHT / 2;
  }

  /** Scroll that puts `viewTop` (the world y at screen 0) at the viewport top. */
  private clampScrollFor(nav: TowerNavState, viewTop: number): number {
    const center = viewTop + DESIGN_HEIGHT / 2 / nav.zoom;
    return this.clampCenterFor(nav, center) - DESIGN_HEIGHT / 2;
  }

  /** World y at the centre of the segment `floor` stands in (basement or tier). */
  private segmentCenterY(floor: number): number {
    if (floor >= 1 && floor <= TOWER_MAP.baseFloors) {
      return (baseLowY() + baseHighY()) / 2;
    }
    const tier = tierOf(floor);
    return (tierBlockLowY(tier.id) + tierBlockHighY(tier.id)) / 2;
  }

  /**
   * The overview's opening state: default focus zoom, centred on the segment
   * the player stands in. This is the whole answer to 「不要一下子看到 1 万层」
   * — the view is ~626 world units of a 2066-unit building, so the map opens
   * on the player's own neighbourhood, and the wheel/F still reaches the
   * whole spire.
   */
  private focusOverview(nav: TowerNavState): TowerNavState {
    const zoom = TOWER_MAP.zoomDefault;
    const base = { ...nav, zoom };
    return { ...base, scroll: this.centerScrollFor(base, this.segmentCenterY(this.state.currentFloor)) };
  }

  /** The sector level's opening state: default ribbon zoom, centred on the
   *  current floor when it is in this sector (otherwise the sector's start). */
  private focusSectorFloor(nav: TowerNavState): number {
    const { from, to } = sectorRange(nav.sector);
    if (this.state.currentFloor >= from && this.state.currentFloor <= to) return this.state.currentFloor;
    return from;
  }

  private enterSectorView(nav: TowerNavState, focus?: number): TowerNavState {
    const zoom = TOWER_MAP.sectorZoomDefault;
    const base = { ...nav, zoom };
    const { from } = sectorRange(base.sector);
    const floor = focus ?? this.focusSectorFloor(base);
    return { ...base, scroll: this.centerScrollFor(base, sectorRibbonY(from, floor)) };
  }

  private enterFloorView(nav: TowerNavState): TowerNavState {
    const floor = nav.floor ?? nav.cursor;
    const { from } = sectorRange(nav.sector);
    return { ...nav, scroll: this.centerScrollFor(nav, sectorRibbonY(from, floor)) };
  }

  // ── rendering ───────────────────────────────────────────────────────────

  // The HUD lives in two fixed bands: 0..TOWER_MAP.topBand above the content
  // and TOWER_FOOT_TOP..DESIGN_HEIGHT below it. Everything here is
  // scrollFactor(0), so the world zoom never scales or moves it.
  private buildHud(): void {
    this.hudText = this.add
      .text(12, 8, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE_TITLE}px`, color: hex(PALETTE.lightHigh), backgroundColor: '#0b0f12cc', padding: { x: 6, y: 3 } })
      .setScrollFactor(0)
      .setDepth(100);
    this.stateText = this.add
      // Top-centre, under the floor readout — the one free lane that clears the
      // title, the readout chip and the right-margin tags at every zoom.
      .text(DESIGN_WIDTH / 2, 50, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE_AUX}px`, color: hex(TEXT.highlight), backgroundColor: '#0b0f12cc', padding: { x: 6, y: 2 } })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(100);
    this.readoutText = this.add
      // The floor readout: what the pointer is over (or, with no pointer, the
      // segment the player stands in). This is where a floor's number, segment,
      // environment and contents are answered — see floorInfoLine.
      .text(DESIGN_WIDTH / 2, 12, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE_CAPTION}px`, color: hex(TEXT.highlight), backgroundColor: '#0b0f12cc', padding: { x: 6, y: 3 } })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(100);
    this.hintText = this.add
      .text(12, DESIGN_HEIGHT - TOWER_FOOT_TOP, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE_BODY}px`, color: hex(TEXT.highlight), backgroundColor: '#0b0f12cc', padding: { x: 6, y: 3 } })
      .setScrollFactor(0)
      .setDepth(100);
    // Colour legend for the building. The map's whole language is colour, so
    // the states have to be spelled out rather than guessed at.
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
    // 看全塔 / 聚焦当前段 — the whole-tower view is one press away, which is
    // what makes the focused default feel like a choice rather than a limit.
    this.fitText = this.add
      .text(DESIGN_WIDTH - 12, 8, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE_AUX}px`, color: hex(PALETTE.clothHigh), backgroundColor: '#0b0f12cc', padding: { x: 6, y: 3 } })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(100);
    this.fitHit = hitRect(this, DESIGN_WIDTH - 132, 8, 124, 34, 101, { onClick: () => this.toggleFit() });
    this.fitHit.setScrollFactor(0).setVisible(false);
  }

  // Tier name plates (base + six tiers), the basement's five room labels, the
  // 起点/终点 tags, the sector ribbon's decade numbers and the current-floor
  // chip. All screen-space, all created once; redraw() only repositions.
  private buildWorldLabels(): void {
    const plate = (text: string, color: number): Phaser.GameObjects.Text =>
      this.add
        .text(0, 0, text, { fontFamily: FONT_FAMILY, fontSize: `${TYPE_CAPTION}px`, color: hex(color), backgroundColor: '#0b0f12cc', padding: { x: 4, y: 2 } })
        .setOrigin(1, 0)
        .setScrollFactor(0)
        .setDepth(5);
    this.tierPlates = [
      plate('地下基座 B1–B5 · 基础发育区', COLOR_BASE_LINE),
      ...TIERS.map((t) => plate(`T${t.id} ${t.name} · ${t.minFloor}–${t.maxFloor}`, tierColor(t.id))),
    ];
    this.baseFloorLabels = [1, 2, 3, 4, 5].map((f) =>
      this.add
        .text(0, 0, `B${f} ${BASE_FLOOR_LABELS[f - 1]}`, { fontFamily: FONT_FAMILY, fontSize: `${TYPE_CAPTION}px`, color: hex(TEXT.primary), backgroundColor: '#0b0f12cc', padding: { x: 4, y: 2 } })
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(5),
    );
    this.endpointLabels = [
      this.add
        .text(0, 0, '起点 第1层', { fontFamily: FONT_FAMILY, fontSize: `${TOWER_TAG_FONT}px`, color: hex(COLOR_START), backgroundColor: '#0b0f12cc', padding: { x: 4, y: 2 } })
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(5),
      this.add
        .text(0, 0, `终点 第${TOTAL_FLOORS}层`, { fontFamily: FONT_FAMILY, fontSize: `${TOWER_TAG_FONT}px`, color: hex(COLOR_SUMMIT), backgroundColor: '#0b0f12cc', padding: { x: 4, y: 2 } })
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(5),
    ];
    // The ribbon's decade numbers (every 10th floor of the sector in view).
    for (let i = 0; i < 100; i++) {
      this.decadeLabels.push(
        this.add
          .text(0, 0, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE_DECADE}px`, color: hex(TEXT.secondary), backgroundColor: '#0b0f12cc', padding: { x: 3, y: 1 } })
          .setOrigin(0, 0.5)
          .setScrollFactor(0)
          .setDepth(5),
      );
    }
    // The you-are-here pin: a bright chip on the current floor's line.
    this.currentChip = this.add
      .text(0, 0, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE_AUX}px`, color: hex(PALETTE.ink), backgroundColor: hex(COLOR_CURRENT), padding: { x: 6, y: 2 } })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(6);
  }

  private buildDetailPanel(): void {
    const w = DETAIL_PANEL_W;
    const h = DETAIL_PANEL_H;
    const cx = DESIGN_WIDTH / 2;
    const cy = DESIGN_HEIGHT / 2;
    const left = cx - w / 2;
    const top = cy - h / 2;

    // The skin is captured, not just pushed: refreshDetail re-places it when
    // the floor's content list wraps past one line (the panel grows around it).
    this.detailPanelParts = buildPanel(this, cx, cy, w, h, 'tower', PANEL_DEPTH.tower.detail);
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
    // zero-area hit area that setText never re-measures. The rect is in SCREEN
    // space (scrollFactor 0, applied below with the card's own pass): the card
    // is screen-locked now, so at any zoom the button sits exactly where the
    // card is drawn. refreshDetail re-places it as the card grows.
    this.detailActionHit = hitRect(this, cx - 110, top + h - 34, 220, 26, PANEL_DEPTH.tower.detail + 8, {
      onOver: () => this.detailAction.setColor(hex(PALETTE.lightHot)),
      onClick: () => this.tryEnter(),
    });
    this.detailActionHit.on('pointerout', () => this.detailAction.setColor(hex(PALETTE.clothHigh)));
    // Hidden and shown with the card, so it cannot be clicked behind it.
    this.detailObjects.push(this.detailActionHit);
    // And a back arrow, pinned to the screen (scrollFactor 0) rather than to the
    // world: at this level the camera scrolls, and a world-space arrow drifted
    // 300px up the tower.
    //
    // One hint-row ABOVE the footer, not on it: the footer owns the band from
    // DESIGN_HEIGHT - TOWER_FOOT_TOP (679..717), and the arrow opens one row
    // above it with a clear gap.
    const back = this.add
      .text(14, DESIGN_HEIGHT - TOWER_FOOT_TOP - 26, '← 返回', { fontFamily: FONT_FAMILY, fontSize: `${TYPE_BODY}px`, color: hex(PALETTE.clothHigh) })
      .setOrigin(0, 0.5);
    textClickable(back, hex(PALETTE.clothHigh), hex(PALETTE.lightHot), { onClick: () => this.onBack() });
    // The arrow rides with the card: without it in the visibility list it
    // floated over the overview forever (measured: a stray ← 返回 at y 637 on
    // the building view).
    this.detailObjects.push(this.detailTitle, ...this.detailRows, this.detailAction, back);
    applyPanelDepth(this.detailObjects, PANEL_DEPTH.tower.detail);
    for (const o of this.detailObjects) o.setVisible(false);
  }

  private redraw(): void {
    const cam = this.cameras.main;
    cam.setZoom(this.nav.zoom);
    // The building is centred on world x = 640 and Phaser centres the camera on
    // scrollX + canvasWidth/2, so scrollX is permanently 0 — the building stays
    // horizontally centred at every zoom, and only scrollY moves.
    cam.scrollX = 0;
    cam.scrollY = this.nav.scroll;
    if (this.nav.level === 'floor') this.hoverFloor = null;

    this.bodyGfx.clear();
    this.markGfx.clear();

    if (this.nav.level === 'overview') {
      this.drawBuilding();
      this.drawBuildingMarks();
    } else {
      this.drawRibbon();
      this.drawRibbonMarks();
    }

    this.updateWorldLabels();
    this.refreshHud();
    this.refreshDetail();
  }

  // ── the building (overview level) ───────────────────────────────────────

  private drawBuilding(): void {
    const g = this.bodyGfx;
    const z = this.nav.zoom;
    const x0 = buildingX0();
    const w = TOWER_MAP.buildingW;
    const top = this.cameras.main.scrollY;
    const bottom = top + this.viewHeight();
    const hair = Math.max(0.4, 1 / z); // ~1 screen px, in world units

    // ── 地基：比楼体宽一截的托脚（y 向下，地基贴在整栋楼的最下端） ──
    const foot = 50;
    g.fillStyle(COLOR_FOUNDATION, 1);
    g.fillRect(x0 - foot, buildingHeight() - TOWER_MAP.foundationH, w + foot * 2, TOWER_MAP.foundationH);
    g.fillStyle(PALETTE.ink, 0.4);
    for (let x = x0 - foot + 10; x < x0 + w + foot; x += 18) {
      g.fillRect(x, buildingHeight() - TOWER_MAP.foundationH + 5, 9, TOWER_MAP.foundationH - 9);
    }
    g.fillStyle(PALETTE.dust, 0.5);
    g.fillRect(x0 - foot, buildingHeight() - Math.max(1, 1.5 / z), w + foot * 2, Math.max(1, 1.5 / z)); // 地平线

    // ── 地下基座 B1–B5：楼体底部独立加厚的一段 ──
    const baseLow = baseLowY();
    const baseHigh = baseHighY();
    g.fillStyle(COLOR_BASE, 1);
    g.fillRect(x0, baseLow, w, baseHigh - baseLow);
    // 土层纹理（横向 strata，低透明度）
    g.fillStyle(PALETTE.ink, 0.16);
    for (let y = baseLow + 8; y < baseHigh; y += 12) {
      g.fillRect(x0, y, w, 5);
    }
    // 每层一块楼板 + 探索状态；30 单位/层是 T1 楼距的 10 倍，「厚」就是基座
    // 在视觉上独立于上面六个阶层段的方式。1 层在最下（y 最大）。
    const basePitch = TOWER_MAP.baseH / TOWER_MAP.baseFloors;
    for (let f = 1; f <= TOWER_MAP.baseFloors; f++) {
      const y = buildingFloorY(f);
      const state = this.floorState(f);
      if (state === 'locked') {
        g.fillStyle(PALETTE.ink, 0.3);
        g.fillRect(x0, y - basePitch / 2, w, basePitch);
      } else if (state === 'explored') {
        g.fillStyle(COLOR_EXPLORED, 0.22);
        g.fillRect(x0, y - basePitch / 2, w, basePitch);
      }
      g.fillStyle(state === 'current' ? COLOR_CURRENT : COLOR_BASE_LINE, state === 'locked' ? 0.5 : 0.95);
      g.fillRect(x0, y - 0.75, w, 1.5);
    }
    // 基座侧框（比阶层段厚一档）
    g.fillStyle(PALETTE.ink, 0.55);
    g.fillRect(x0 - 3, baseLow, 3, baseHigh - baseLow);
    g.fillRect(x0 + w, baseLow, 3, baseHigh - baseLow);

    // ── 六个阶层段：每段一等高楼体，段间是结构层 ──
    const frontier = Math.max(1, Math.min(TOTAL_FLOORS, this.access.highestUnlocked));
    for (const tier of TIERS) {
      const lowY = tierBlockLowY(tier.id);
      const highY = tierBlockHighY(tier.id);
      if (highY < top - 40 || lowY > bottom + 40) continue; // 视口裁剪
      const count = tier.maxFloor - tier.minFloor + 1;
      const p = TOWER_MAP.tierH / count;

      g.fillStyle(tierColor(tier.id), 1);
      g.fillRect(x0, lowY, w, TOWER_MAP.tierH);

      // 前沿之下（楼体里更低）提亮为已探索、前沿之上压暗为未打通——以本段内
      // 的前沿位置为界，所以站在段底的玩家看到自己脚下全亮、头顶全暗。
      const fClamped = Math.min(tier.maxFloor, Math.max(tier.minFloor, frontier));
      const fY = buildingFloorY(fClamped);
      if (highY > fY) {
        g.fillStyle(COLOR_EXPLORED, 0.16);
        g.fillRect(x0, fY, w, highY - fY);
      }
      if (lowY < fY) {
        g.fillStyle(PALETTE.shadow, 0.45);
        g.fillRect(x0, lowY, w, fY - lowY);
      }

      // 段内楼层线：只在屏距可读时画（大阶层段读作实心体，密度本身就是信息）
      if (p * z >= 1.6) {
        const fTop = tier.maxFloor - Math.max(0, Math.floor((top - lowY) / p));
        const fBottom = tier.minFloor + Math.max(0, Math.ceil((bottom - highY) / p));
        const first = Math.max(tier.minFloor, Math.min(tier.maxFloor, fBottom));
        const last = Math.min(tier.maxFloor, Math.max(tier.minFloor, fTop));
        for (let f = first; f <= last; f++) {
          const y = buildingFloorY(f);
          g.fillStyle(PALETTE.dust, 0.22);
          g.fillRect(x0 + 4, y, w - 8, hair);
        }
      }

      // 段框 + 底沿楼板
      g.fillStyle(PALETTE.ink, 0.6);
      g.fillRect(x0 - 2, lowY, 2, TOWER_MAP.tierH);
      g.fillRect(x0 + w, lowY, 2, TOWER_MAP.tierH);
      g.fillStyle(PALETTE.dust, 0.5);
      g.fillRect(x0 - 2, highY, w + 4, Math.max(1, 1.2 / z));
    }

    // ── 段间结构层：平台/机房，向楼体外挑一截 ──
    // y 向下：缝贴在下一段的上沿（tierBlockHighY），即上一段顶与下一段底之间。
    const seamYs = ([1, 2, 3, 4, 5, 6] as TierId[]).map((t) => tierBlockHighY(t));
    for (const y of seamYs) {
      if (y + TOWER_MAP.seamH < top || y > bottom) continue;
      g.fillStyle(PALETTE.ink, 0.94);
      g.fillRect(x0 - 6, y, w + 12, TOWER_MAP.seamH);
      // 机房窗
      g.fillStyle(PALETTE.stone, 0.85);
      for (let i = 0; i < 3; i++) {
        g.fillRect(x0 + 70 + (i * (w - 140)) / 2, y + 4, 46, TOWER_MAP.seamH - 8);
      }
      // 铆钉行（hudSkin 的铆钉板语言）
      g.fillStyle(PALETTE.dust, 0.45);
      for (let x = x0 - 4; x <= x0 + w + 4; x += 22) {
        g.fillRect(x, y + 2.5, 2, 2);
        g.fillRect(x, y + TOWER_MAP.seamH - 4.5, 2, 2);
      }
    }

    // ── 楼体外侧导轨铆钉 ──
    g.fillStyle(PALETTE.dust, 0.4);
    for (let y = Math.floor(top / 24) * 24; y < bottom; y += 24) {
      g.fillRect(x0 - 6, y, 2, 2);
      g.fillRect(x0 + w + 4, y, 2, 2);
    }
  }

  private drawBuildingMarks(): void {
    const g = this.markGfx;
    const z = this.nav.zoom;
    const x0 = buildingX0();
    const w = TOWER_MAP.buildingW;
    const top = this.cameras.main.scrollY;
    const bottom = top + this.viewHeight();
    const hair = Math.max(0.5, 1 / z);

    // 已创作段（PLAYABLE_SEGMENTS）：左导轨上的亮线，标出「真的有内容的层」
    for (const seg of PLAYABLE_SEGMENTS) {
      const yFrom = buildingFloorY(seg.from);
      const yTo = buildingFloorY(seg.to);
      g.fillStyle(COLOR_EXPLORED, 0.8);
      g.fillRect(x0 + 2, yFrom, 3, Math.max(hair, yTo - yFrom));
    }
    // 货梯：段首/段末的三角（读 segments 自己的 liftDirection）
    for (const m of LIFT_MARKS) {
      const y = buildingFloorY(m.floor);
      if (y < top || y > bottom) continue;
      const cx = x0 + 10;
      g.fillStyle(COLOR_EXPLORED, 1);
      g.fillPoints(
        (m.dir === 'up'
          ? [
              { x: cx - 4, y: y + 3 },
              { x: cx + 4, y: y + 3 },
              { x: cx, y: y - 3 },
            ]
          : [
              { x: cx - 4, y: y - 3 },
              { x: cx + 4, y: y - 3 },
              { x: cx, y: y + 3 },
            ]) as Phaser.Math.Vector2[],
        true,
        true,
      );
    }

    // 守段者层：右导轨上的红旗（5/110/50010，encounterSpots 的表）
    for (const f of BOSS_FLOOR_NUMBERS) {
      const y = buildingFloorY(f);
      if (y < top || y > bottom) continue;
      g.fillStyle(COLOR_BOSS, 1);
      g.fillRect(x0 + w - 7, y - 3, 1.5, 7); // 旗杆
      g.fillPoints(
        [
          { x: x0 + w - 5.5, y: y - 3 },
          { x: x0 + w + 2, y: y - 1 },
          { x: x0 + w - 5.5, y: y + 1 },
        ] as Phaser.Math.Vector2[],
        true,
        true,
      );
    }

    // 前沿线（已打通至）：横贯楼体的虚线
    const fy = buildingFloorY(Math.max(1, Math.min(TOTAL_FLOORS, this.access.highestUnlocked)));
    if (fy >= top && fy <= bottom) {
      g.fillStyle(PALETTE.dust, 0.85);
      for (let x = x0; x < x0 + w; x += 10) g.fillRect(x, fy, 6, hair);
    }

    // 当前层：横贯楼体的亮带 + 上下暗描边
    const cy = buildingFloorY(this.state.currentFloor);
    const bandH = Math.max(2.5, 2.5 / z);
    g.fillStyle(PALETTE.ink, 0.8);
    g.fillRect(x0, cy - bandH / 2 - hair, w, hair);
    g.fillRect(x0, cy + bandH / 2, w, hair);
    g.fillStyle(COLOR_CURRENT, 1);
    g.fillRect(x0, cy - bandH / 2, w, bandH);

    // 悬停层：一道奶油色细线
    if (this.hoverFloor !== null) {
      const hy = buildingFloorY(this.hoverFloor);
      g.fillStyle(COLOR_CURSOR, 0.9);
      g.fillRect(x0 + 2, hy - hair / 2, w - 4, Math.max(hair, 1));
    }

    // 键盘游标：当前 sector 的楼层区间括号
    const { from, to } = sectorRange(this.nav.cursor);
    const cTop = buildingFloorY(to);
    const cBot = buildingFloorY(from);
    if (cBot <= bottom && cTop >= top) {
      g.lineStyle(Math.max(1 / z, 1), COLOR_CURSOR, 0.9);
      g.strokeRect(x0 - 9, cTop, w + 18, cBot - cTop);
    }

    // 起点/终点标签的引线（标签本身在 updateWorldLabels 里定位）
    const startY = this.screenY(buildingFloorY(1));
    const endY = this.screenY(buildingFloorY(TOTAL_FLOORS));
    const railRight = this.screenXOf(buildingX1());
    const tickW = TOWER_TAG_X - railRight - 4;
    if (tickW > 0) {
      if (startY >= TOWER_MAP.topBand && startY <= TOWER_MAP.bottomBand) {
        g.fillStyle(COLOR_START, 0.8);
        g.fillRect(railRight + 2, startY, tickW, 1);
      }
      if (endY >= TOWER_MAP.topBand && endY <= TOWER_MAP.bottomBand) {
        g.fillStyle(COLOR_SUMMIT, 0.8);
        g.fillRect(railRight + 2, endY, tickW, 1);
      }
    }

    // 当前层滚出内容带时的边缘箭头（屏内则由 currentChip 指认）
    const cyScreen = this.screenY(cy);
    if (cyScreen < TOWER_MAP.topBand) this.drawEdgeArrow(g, 'up');
    else if (cyScreen > TOWER_MAP.bottomBand) this.drawEdgeArrow(g, 'down');
  }

  private drawEdgeArrow(g: Phaser.GameObjects.Graphics, dir: 'up' | 'down'): void {
    const cx = DESIGN_WIDTH / 2;
    g.fillStyle(COLOR_CURRENT, 0.95);
    const pts =
      dir === 'up'
        ? [
            { x: cx - 8, y: TOWER_MAP.topBand - 2 },
            { x: cx + 8, y: TOWER_MAP.topBand - 2 },
            { x: cx, y: TOWER_MAP.topBand - 14 },
          ]
        : [
            { x: cx - 8, y: TOWER_MAP.bottomBand + 2 },
            { x: cx + 8, y: TOWER_MAP.bottomBand + 2 },
            { x: cx, y: TOWER_MAP.bottomBand + 14 },
          ];
    g.fillPoints(pts as Phaser.Math.Vector2[], true, true);
  }

  // ── the sector ribbon (sector + floor levels) ───────────────────────────

  private drawRibbon(): void {
    const g = this.bodyGfx;
    const z = this.nav.zoom;
    const x0 = buildingX0();
    const w = TOWER_MAP.buildingW;
    const { from, to } = sectorRange(this.nav.sector);
    const top = this.cameras.main.scrollY;
    const bottom = top + this.viewHeight();
    const pitch = TOWER_MAP.sectorPitch;

    // 底板：按阶层着色（一个区段最多跨两个阶层，颜色爬升就是阶层爬升）
    for (const tier of TIERS) {
      const lo = Math.max(tier.minFloor, from);
      const hi = Math.min(tier.maxFloor, to);
      if (lo > hi) continue;
      // 段底楼层（lo）在屏上更下（y 更大），段顶楼层（hi）更上。
      const yTop = Math.max(top, sectorRibbonY(from, hi));
      const yBot = Math.min(bottom, sectorRibbonY(from, lo) + pitch);
      if (yBot <= yTop) continue;
      g.fillStyle(tierColor(tier.id), 0.5);
      g.fillRect(x0, yTop, w, yBot - yTop);
    }

    // 楼层线：每层一条，颜色即状态。y 向下：段顶（to）在 y=0，段底（from）在
    // Ribbon 底部，所以视口里最小的楼层号对应最大的 y。
    const first = Math.max(from, Math.min(to, to - Math.floor(bottom / pitch)));
    const last = Math.min(to, Math.max(from, to - Math.floor(top / pitch)));
    for (let f = first; f <= last; f++) {
      const y = sectorRibbonY(from, f);
      const state = this.floorState(f);
      const th = state === 'current' ? Math.max(2.5, 2.5 / z) : Math.max(0.6, 1 / z);
      const color =
        state === 'current'
          ? COLOR_CURRENT
          : state === 'explored'
            ? COLOR_EXPLORED
            : state === 'unlocked'
              ? COLOR_UNLOCKED
              : COLOR_LOCKED;
      g.fillStyle(color, state === 'locked' ? 0.55 : 0.95);
      g.fillRect(x0, y - th / 2, w, th);
    }

    // 左右导轨 + 每 10 层一对铆钉
    const railTop = Math.max(0, top);
    const railBot = Math.min(sectorRibbonHeight(), bottom);
    if (railBot > railTop) {
      g.fillStyle(PALETTE.ink, 0.6);
      g.fillRect(x0 - 2, railTop, 2, railBot - railTop);
      g.fillRect(x0 + w, railTop, 2, railBot - railTop);
      g.fillStyle(PALETTE.dust, 0.35);
      const r1 = Math.min(to, Math.ceil(last / 10) * 10);
      for (let f = r1; f >= first; f -= 10) {
        const y = sectorRibbonY(from, f);
        if (y < top || y > bottom) continue;
        g.fillRect(x0 - 6, y, 2, 2);
        g.fillRect(x0 + w + 4, y, 2, 2);
      }
    }

    // 顶/底延续提示：区段还有楼层在视口外
    if (top > 0) this.drawEdgeArrow(g, 'up');
    if (bottom < sectorRibbonHeight()) this.drawEdgeArrow(g, 'down');
  }

  private drawRibbonMarks(): void {
    const g = this.markGfx;
    const z = this.nav.zoom;
    const x0 = buildingX0();
    const w = TOWER_MAP.buildingW;
    const { from, to } = sectorRange(this.nav.sector);
    const top = this.cameras.main.scrollY;
    const bottom = top + this.viewHeight();
    const hair = Math.max(0.5, 1 / z);

    // 已创作段亮线 + 货梯三角
    for (const seg of PLAYABLE_SEGMENTS) {
      const lo = Math.max(seg.from, from);
      const hi = Math.min(seg.to, to);
      if (lo > hi) continue;
      g.fillStyle(COLOR_EXPLORED, 0.8);
      g.fillRect(x0 + 2, sectorRibbonY(from, lo), 3, Math.max(hair, sectorRibbonY(from, hi + 1) - sectorRibbonY(from, lo)));
    }
    for (const m of LIFT_MARKS) {
      if (m.floor < from || m.floor > to) continue;
      const y = sectorRibbonY(from, m.floor);
      if (y < top || y > bottom) continue;
      const cx = x0 + 10;
      g.fillStyle(COLOR_EXPLORED, 1);
      g.fillPoints(
        (m.dir === 'up'
          ? [
              { x: cx - 4, y: y + 3 },
              { x: cx + 4, y: y + 3 },
              { x: cx, y: y - 3 },
            ]
          : [
              { x: cx - 4, y: y - 3 },
              { x: cx + 4, y: y - 3 },
              { x: cx, y: y + 3 },
            ]) as Phaser.Math.Vector2[],
        true,
        true,
      );
    }

    // 守段者层：右导轨红点
    for (const f of BOSS_FLOOR_NUMBERS) {
      if (f < from || f > to) continue;
      const y = sectorRibbonY(from, f);
      if (y < top || y > bottom) continue;
      g.fillStyle(COLOR_BOSS, 1);
      g.fillRect(x0 + w - 6, y - 2, 4, 4);
    }

    // 前沿虚线
    const frontier = Math.max(1, Math.min(TOTAL_FLOORS, this.access.highestUnlocked));
    if (frontier >= from && frontier <= to) {
      const fy = sectorRibbonY(from, frontier);
      if (fy >= top && fy <= bottom) {
        g.fillStyle(PALETTE.dust, 0.85);
        for (let x = x0; x < x0 + w; x += 10) g.fillRect(x, fy, 6, hair);
      }
    }

    // 当前层亮带
    if (this.state.currentFloor >= from && this.state.currentFloor <= to) {
      const cy = sectorRibbonY(from, this.state.currentFloor);
      const bandH = Math.max(2.5, 2.5 / z);
      g.fillStyle(PALETTE.ink, 0.8);
      g.fillRect(x0, cy - bandH / 2 - hair, w, hair);
      g.fillRect(x0, cy + bandH / 2, w, hair);
      g.fillStyle(COLOR_CURRENT, 1);
      g.fillRect(x0, cy - bandH / 2, w, bandH);
    }

    // 悬停层细线
    if (this.hoverFloor !== null) {
      const hy = sectorRibbonY(from, this.hoverFloor);
      g.fillStyle(COLOR_CURSOR, 0.9);
      g.fillRect(x0 + 2, hy - hair / 2, w - 4, Math.max(hair, 1));
    }

    // 键盘游标：游标楼层的一道括号
    if (this.nav.cursor >= from && this.nav.cursor <= to) {
      const ky = sectorRibbonY(from, this.nav.cursor);
      if (ky >= top && ky <= bottom) {
        g.lineStyle(Math.max(1 / z, 1), COLOR_CURSOR, 0.9);
        g.strokeRect(x0 - 9, ky - 6, w + 18, 12);
      }
    }
  }

  // ── world-space labels, positioned in screen space ──────────────────────

  private updateWorldLabels(): void {
    if (this.nav.level === 'overview') {
      // 楼体语言：阶层铭牌 + 基座房名 + 起点/终点（各自在 updateBuildingLabels
      // 里按内容带裁切）；区段的十层号整组隐藏。
      this.updateBuildingLabels();
      for (const l of this.decadeLabels) l.setVisible(false);
    } else {
      // 放大镜语言：十层号 + 当前层钉；楼体铭牌与起点/终点让位。
      this.updateRibbonLabels();
      for (const p of this.tierPlates) p.setVisible(false);
      for (const l of this.baseFloorLabels) l.setVisible(false);
      this.endpointLabels[0].setVisible(false);
      this.endpointLabels[1].setVisible(false);
    }
    this.updateCurrentChip();
  }

  private updateBuildingLabels(): void {
    const z = this.nav.zoom;
    // 铭牌一律挂在楼体左侧的画纸边上（右对齐、夹在画布内）：全塔视角下贴在
    // 楼旁，放大后贴在画布左缘——两种摆法都让开屏幕中央的当前层钉，也不会和
    // 左上角的标题/状态签相撞（y 被夹在 topBand 之下）。
    const leftScreen = this.screenXOf(buildingX0());

    const plates: Array<{ text: string; blockLow: number; blockHigh: number }> = [
      { text: '地下基座 B1–B5 · 基础发育区', blockLow: baseLowY(), blockHigh: baseHighY() },
      ...TIERS.map((t) => ({
        text: `T${t.id} ${t.name} · ${t.minFloor}–${t.maxFloor}`,
        blockLow: tierBlockLowY(t.id),
        blockHigh: tierBlockHighY(t.id),
      })),
    ];
    // 自下而上（楼体顺序 = 屏上从下到上）逐块放铭牌：每块牌子浮在它自己上沿的
    // 上方一点，y 夹在内容带内；一旦某块牌子被夹到贴顶却撞上了已经放好的下一块
    // 牌子，就隐藏它——屏顶同时只允许一块吸顶铭牌（撞上的是被夹的那块，因为它
    // 的本意位置本来就在视口外）。这样基座铭牌永远碰不到 B5 房名，T1/T2 也不会
    // 在基座视角里叠在一起。
    let placedBottom = Number.POSITIVE_INFINITY; // 已放好的下一块牌子的上沿
    this.tierPlates.forEach((label, i) => {
      const { text, blockLow, blockHigh } = plates[i];
      label.setText(text);
      const sTop = this.screenY(blockLow);
      const sBottom = this.screenY(blockHigh);
      if (sTop > TOWER_MAP.bottomBand || sBottom < TOWER_MAP.topBand) {
        label.setVisible(false);
        return;
      }
      const h = label.height;
      const y = Math.min(Math.max(sTop - h - 4, TOWER_MAP.topBand + 2), TOWER_MAP.bottomBand - h - 2);
      if (y + h > placedBottom - 4) {
        label.setVisible(false);
        return;
      }
      placedBottom = y;
      const x = Math.max(leftScreen - 8, label.width + 12);
      label.setOrigin(1, 0).setPosition(x, y).setVisible(true);
    });

    // 基座五间的房名：楼距可读（≥30px）才显示，位置即房间
    const basePitchScreen = (TOWER_MAP.baseH / TOWER_MAP.baseFloors) * z;
    this.baseFloorLabels.forEach((label, i) => {
      const floor = i + 1;
      label.setText(`B${floor} ${BASE_FLOOR_LABELS[i]}`);
      const yScreen = this.screenY(buildingFloorY(floor));
      if (basePitchScreen < 30 || yScreen < TOWER_MAP.topBand + 14 || yScreen > TOWER_MAP.bottomBand - 14) {
        label.setVisible(false);
        return;
      }
      const x = Math.min(Math.max(leftScreen + 8, 12), DESIGN_WIDTH - label.width - 12);
      label.setOrigin(0, 0.5).setPosition(x, yScreen).setVisible(true);
    });

    // 起点/终点：右缘固定 lane（TOWER_TAG_X，uiLayout.test.ts 钉住的位），
    // 楼层滚出内容带时隐藏——全塔视角两个都在，聚焦视角自动让位。
    const tags: Array<{ label: Phaser.GameObjects.Text; text: string; color: number; worldY: number }> = [
      { label: this.endpointLabels[0], text: '起点 第1层', color: COLOR_START, worldY: buildingFloorY(1) },
      { label: this.endpointLabels[1], text: `终点 第${TOTAL_FLOORS}层`, color: COLOR_SUMMIT, worldY: buildingFloorY(TOTAL_FLOORS) },
    ];
    // 全塔视角下 1 层/100000 层正落在内容带上下沿：标签位置夹在带内（差几 px
    // 无所谓，引线仍钉在楼层的精确屏位上），楼层滚出内容带一个身高以上才隐藏。
    // 这样「一眼看全塔」时起点/终点同屏，聚焦视角下塔顶让位、起点常驻。
    const footerTop = DESIGN_HEIGHT - TOWER_FOOT_TOP;
    for (const tag of tags) {
      tag.label.setText(tag.text).setColor(hex(tag.color));
      const h = tag.label.height;
      const yScreen = this.screenY(tag.worldY);
      const visible = yScreen + h >= TOWER_MAP.topBand && yScreen - h <= footerTop;
      tag.label.setVisible(visible);
      if (visible) {
        const y = Math.max(TOWER_MAP.topBand + h / 2, Math.min(yScreen, footerTop - h / 2));
        tag.label.setPosition(TOWER_TAG_X, y);
      }
    }
  }

  private updateRibbonLabels(): void {
    const { from, to } = sectorRange(this.nav.sector);
    const z = this.nav.zoom;
    const top = this.cameras.main.scrollY;
    const bottom = top + this.viewHeight();
    const pitchScreen = TOWER_MAP.sectorPitch * z;
    // 十层一号：屏距放不下就整组隐藏（放大镜里不需要数数）
    const railRight = this.screenXOf(buildingX1());
    const showDecades = pitchScreen * 10 >= 14 && railRight + 60 <= DESIGN_WIDTH;
    const first = Math.max(from, Math.min(to, to - Math.floor(bottom / TOWER_MAP.sectorPitch)));
    const last = Math.min(to, Math.max(from, to - Math.floor(top / TOWER_MAP.sectorPitch)));
    this.decadeLabels.forEach((label, i) => {
      const floor = from + i * 10;
      if (!showDecades || floor < first || floor > last) {
        label.setVisible(false);
        return;
      }
      const yScreen = this.screenY(sectorRibbonY(from, floor));
      if (yScreen < TOWER_MAP.topBand + 10 || yScreen > TOWER_MAP.bottomBand - 10) {
        label.setVisible(false);
        return;
      }
      label.setText(String(floor)).setPosition(railRight + 8, yScreen).setVisible(true);
    });
  }

  private updateCurrentChip(): void {
    if (this.nav.level === 'floor') {
      // 详情卡自己写着第几层，chip 让位。
      this.currentChip.setVisible(false);
      return;
    }
    const { from } = sectorRange(this.nav.sector);
    const worldY =
      this.nav.level === 'overview'
        ? buildingFloorY(this.state.currentFloor)
        : sectorRibbonY(from, this.state.currentFloor);
    const yScreen = this.screenY(worldY);
    if (yScreen < TOWER_MAP.topBand || yScreen > TOWER_MAP.bottomBand) {
      this.currentChip.setVisible(false);
      return;
    }
    this.currentChip.setText(`第 ${this.state.currentFloor} 层`);
    const h = this.currentChip.height;
    const y = Math.min(Math.max(yScreen, TOWER_MAP.topBand + h / 2 + 2), TOWER_MAP.bottomBand - h / 2 - 2);
    this.currentChip.setPosition(DESIGN_WIDTH / 2, y).setVisible(true);
  }

  // ── HUD refresh ─────────────────────────────────────────────────────────

  private refreshHud(): void {
    const level = this.nav.level;
    // The title stays SHORT at every level: the floor readout owns the wide lane
    // between it and the 看全塔 chip, and 900px is what a boss floor's full line
    // (number · tier · room · cold · humidity · warmth · containers · spots ·
    // alerts) needs. A long title (the old 「塔楼总览 · 楼层详情」 measured 486px
    // wide) printed straight through that line on the floor level — measured as a
    // >15% text collision in the AG-62 probe.
    this.hudText.setText(level === 'overview' ? '塔楼总览' : level === 'sector' ? `区段 ${this.nav.sector}` : '楼层详情');

    const zoomLabel = String(parseFloat(this.nav.zoom.toFixed(2)));
    this.stateText.setText(`当前 ${this.state.currentFloor} 层 · 已打通至 ${this.access.highestUnlocked} 层 · 缩放 ${zoomLabel}x`);

    // The floor readout: the hovered floor's card-in-one-line, or the segment
    // in view. This is the map's answer to 「这一层有什么」 without a click.
    this.readoutText.setVisible(true);
    if (this.hoverFloor !== null) {
      this.readoutText.setText(this.floorInfoLine(this.hoverFloor));
    } else if (level === 'floor' && this.nav.floor !== null) {
      this.readoutText.setText(this.floorInfoLine(this.nav.floor));
    } else if (level === 'sector') {
      const summary = describeSector(this.nav.sector);
      this.readoutText.setText(
        `区段 ${this.nav.sector} · ${summary.from}–${summary.to} 层 · ${summary.tiers.map((t) => `${t.name}×${t.count}`).join(' · ')}`,
      );
    } else {
      const floor = this.state.currentFloor;
      const inBase = floor >= 1 && floor <= TOWER_MAP.baseFloors;
      const name = inBase ? '地下基座' : tierOf(floor).name;
      const range = inBase
        ? '第 1–5 层'
        : (() => {
            const t = tierOf(floor);
            return `${t.minFloor}–${t.maxFloor} 层`;
          })();
      this.readoutText.setText(`楼体剖面 · 当前段 · ${name} · ${range}`);
    }

    this.hintText.setText(
      level === 'overview'
        ? '↑↓ 选择 · Enter 进入 · 滚轮缩放 · 拖动 · F 全塔 · ESC 返回'
        : level === 'sector'
          ? '方向键选择 · Enter 查看 · 滚轮缩放 · 拖动 · ESC 返回'
          : 'Enter 进入该楼层 · ESC 返回区段',
    );
    this.refreshLegend();
    this.refreshFitChip();
  }

  /** One line per floor: number, segment, environment, contents. Read-only. */
  private floorInfoLine(floor: number): string {
    const record = describeFloor(floor);
    const env = environmentFor(floor);
    const summary = summarizeFloor(this.state.runSeed, floor);
    const spots = encounterSpots(this.state.runSeed, floor);
    const npcs = npcsOnFloor(floor).length;
    const core: string[] = [`第 ${floor} 层`, record.tierName];
    // 已创作楼层的环境标签是房名（宿舍/食堂……），比段名更具体，跟在段名后；
    // 未探索楼层的环境标签就是段名本身，不重复。
    if (env.label !== record.tierName) core.push(env.label);
    core.push(
      `寒 ${env.cold.toFixed(1)}`,
      `潮 ${env.humidity.toFixed(1)}`,
      `暖 ${warmthOf(floor).toFixed(2)}`,
      `容器 ${summary.containerCount}`,
      `？ ${spots.length}`,
    );
    if (npcs > 0) core.push(`NPC ${npcs}`);
    const alerts: string[] = [];
    if (spots.some((s) => s.isBoss)) alerts.push('守段者');
    if (env.hostile) alerts.push('夜袭');
    return fitInfoLine(core, alerts, 900, TYPE_CAPTION);
  }

  private refreshLegend(): void {
    const level = this.nav.level;
    this.legendGfx.setVisible(true);
    this.legendText.setVisible(true);

    this.legendGfx.clear();
    const swatch = 7;
    const gap = 4;
    const y = DESIGN_HEIGHT - TOWER_FOOT_TOP;

    // The legend spells out every non-tier colour on screen. The building adds
    // the boss flag and the freight lift; the ribbon keeps the four floor
    // states plus the boss rim when the sector in view holds a guardian.
    const entries: Array<{ color: number; label: string }> =
      level === 'overview'
        ? [
            { color: COLOR_CURRENT, label: '当前' },
            { color: COLOR_EXPLORED, label: '已探索' },
            { color: COLOR_LOCKED, label: '未打通' },
            { color: COLOR_BOSS, label: '守段者' },
            { color: COLOR_EXPLORED, label: '货梯' },
          ]
        : [
            { color: COLOR_CURRENT, label: '当前' },
            { color: COLOR_EXPLORED, label: '已探索' },
            { color: COLOR_UNLOCKED, label: '已打通' },
            { color: COLOR_LOCKED, label: '未打通' },
          ];
    if (level !== 'overview') {
      const { from, to } = sectorRange(this.nav.sector);
      if (BOSS_FLOOR_NUMBERS.some((floor) => floor >= from && floor <= to)) {
        entries.push({ color: COLOR_BOSS, label: '守段者' });
      }
    }

    // The swatches have to land on their own labels inside the joined string,
    // so the layout mirrors that string: label widths and the '  ' separator
    // measured with the project's estimator (one em per Han glyph — exact for
    // these labels).
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

  private refreshFitChip(): void {
    const fitZoom = towerFitZoom();
    const atFit = Math.abs(this.nav.zoom - fitZoom) < 0.03;
    const onOverview = this.nav.level === 'overview';
    this.fitText.setVisible(onOverview);
    this.fitHit.setVisible(onOverview);
    if (!onOverview) return;
    this.fitText.setText(atFit ? '聚焦当前段' : '看全塔');
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
    // resolved at all until worldgen rolls it.
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
    //    the only honest answer for a floor whose contents already exist.
    //  - unexplored floors (99946 of the tower) read worldgen.summarizeFloor:
    //    "this is what the floor would look like if you explored it", the same
    //    numbers generateFloorContent rolls on arrival. The two sources are
    //    distinguishable on the card by their prefix (内容： vs 未探索·预估：)
    //    and by the estimate row's warn colour, so a prediction never reads as
    //    a resolved fact.
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

    // ── adaptive card ──────────────────────────────────────────────────────
    // The content row wraps to as many lines as the floor needs, and the card
    // grows around it: the action line follows the content's bottom, the skin
    // wraps both, and the whole card keeps its centre on screen. Re-place only —
    // the objects were built once in buildDetailPanel at the base geometry.
    //
    // The height is the Text's OWN measured height, not wrapText's line count.
    // The estimator is a few percent under the rasteriser, and on the worldgen
    // estimate (a 7-item tier-1 pool wraps to five real lines where wrapText
    // predicts four) that one line printed the action row 6px through the
    // content's last line. Text.height is updated synchronously by setText, so
    // the wrap it actually performed is the number used here.
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
    // The action hit rectangle follows the card as it grows: screen-locked, so
    // the card's own screen position is the rect's.
    this.detailActionHit.setPosition(cx - 110, top + actionTop + lineH / 2 - 13);
  }

  // ── floor state ─────────────────────────────────────────────────────────

  private floorState(floor: number): 'current' | 'explored' | 'unlocked' | 'locked' {
    if (floor === this.state.currentFloor) return 'current';
    if (floor <= this.access.highestUnlocked) {
      return this.state.visitedFloors[floor] !== undefined ? 'explored' : 'unlocked';
    }
    return 'locked';
  }

  // The colour each floor of the sector in view is drawn in. Exposed for tests so
  // the map's colour language is asserted rather than eyeballed.
  private cellStates(): Array<{ floor: number; state: 'current' | 'explored' | 'unlocked' | 'locked' }> {
    const { from, to } = sectorRange(this.nav.sector);
    const out: Array<{ floor: number; state: 'current' | 'explored' | 'unlocked' | 'locked' }> = [];
    for (let floor = from; floor <= to; floor++) {
      out.push({ floor, state: this.floorState(floor) });
    }
    return out;
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
        fit: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F),
        close: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.M),
      };
      this.keys.up.on('down', () => this.onArrow('up', 0, -1), this);
      this.keys.down.on('down', () => this.onArrow('down', 0, 1), this);
      this.keys.left.on('down', () => this.onArrow('left', -1, 0), this);
      this.keys.right.on('down', () => this.onArrow('right', 1, 0), this);
      this.keys.enter.on('down', this.onConfirm, this);
      this.keys.esc.on('down', this.onBack, this);
      this.keys.fit.on('down', this.toggleFit, this);
      this.keys.close.on('down', this.onClose, this);
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
      this.keys.fit?.removeAllListeners();
      this.keys.close?.removeAllListeners();
    }
    this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.off(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this);
  }

  private onArrow(slot: MapKey, dx: number, dy: number): void {
    if (!this.accept(slot)) return;
    if (this.nav.level === 'overview') {
      const next = nudgeSector(this.nav, dy);
      // 光标没动（顶/底段）就不摇镜头：按一下 ↑ 不该把基座视角甩到 T1 去。
      const moved = next.cursor !== this.nav.cursor;
      this.nav = moved ? { ...next, scroll: this.ensureSegmentVisible(next) } : { ...next, scroll: this.nav.scroll };
    } else if (this.nav.level === 'sector') {
      const next = nudgeFloor(this.nav, dx, dy);
      const moved = next.cursor !== this.nav.cursor;
      this.nav = moved ? { ...next, scroll: this.ensureFloorVisible(next) } : { ...next, scroll: this.nav.scroll };
    }
    this.redraw();
  }

  /** Recentre only when the cursor's segment block is not already fully in view,
   *  so arrowing inside one tier never yanks the camera. */
  private ensureSegmentVisible(nav: TowerNavState): number {
    const tier = tierOf(sectorRange(nav.cursor).from).id;
    const center = (tierBlockLowY(tier) + tierBlockHighY(tier)) / 2;
    const half = TOWER_MAP.tierH / 2 + 30;
    const sTop = this.screenYFor(nav, center - half);
    const sBottom = this.screenYFor(nav, center + half);
    if (sTop >= TOWER_MAP.topBand && sBottom <= TOWER_MAP.bottomBand) return nav.scroll;
    return this.centerScrollFor(nav, center);
  }

  private ensureFloorVisible(nav: TowerNavState): number {
    const { from } = sectorRange(nav.sector);
    const worldY = sectorRibbonY(from, nav.cursor);
    const y = this.screenYFor(nav, worldY);
    if (y >= TOWER_MAP.topBand + 40 && y <= TOWER_MAP.bottomBand - 40) return nav.scroll;
    return this.centerScrollFor(nav, worldY);
  }

  private onConfirm(): void {
    if (!this.accept('enter')) return;
    playSfx('click');
    if (this.nav.level === 'overview') {
      this.nav = this.enterSectorView(enterSector(this.nav.cursor));
    } else if (this.nav.level === 'sector') {
      this.nav = this.enterFloorView(enterFloor(this.nav, this.nav.cursor));
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
    if (this.nav.level === 'floor') {
      this.nav = this.enterSectorView(navBack(this.nav), this.nav.floor ?? this.nav.cursor);
    } else {
      this.nav = this.focusOverview(navBack(this.nav));
    }
    this.redraw();
  }

  /** M closes the map from any level — the key that opened it. */
  private onClose(): void {
    if (!this.accept('close')) return;
    this.scene.start('Game');
  }

  /** F / 看全塔: fit the whole building, or focus back on the current segment. */
  private toggleFit(): void {
    if (!this.accept('fit')) return;
    if (this.nav.level !== 'overview') return;
    const fitZoom = towerFitZoom();
    const atFit = Math.abs(this.nav.zoom - fitZoom) < 0.03;
    if (atFit) {
      this.nav = this.focusOverview(this.nav);
    } else {
      const base = { ...this.nav, zoom: fitZoom };
      this.nav = { ...base, scroll: this.centerScrollFor(base, buildingHeight() / 2) };
    }
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
      this.nav = { ...this.nav, scroll: this.clampScrollFor(this.nav, this.nav.scroll - dy / this.nav.zoom) };
      this.redraw();
      return;
    }
    if (this.nav.level === 'floor') return;
    // 内容带之外（固定 HUD 与页脚）不拾取楼层：指针停在标题上时不该选中塔顶
    // 那一层。移出内容带即清除悬停。
    const overBand = pointer.y >= TOWER_MAP.topBand && pointer.y <= TOWER_MAP.bottomBand;
    const floor = overBand ? this.pickFloorAtPointer() : null;
    if (floor === this.hoverFloor) return;
    this.hoverFloor = floor;
    this.refreshHud();
    // The hover line is a mark, so it needs the mark pass too — cleared first,
    // because the mark graphics accumulate.
    this.markGfx.clear();
    if (this.nav.level === 'overview') this.drawBuildingMarks();
    else this.drawRibbonMarks();
  }

  /** Floor under the pointer in the current level's own space, or null. */
  private pickFloorAtPointer(): number | null {
    const worldY = this.worldYAt(this.input.activePointer.y);
    if (this.nav.level === 'overview') return floorAtBuildingY(worldY);
    const { from, to } = sectorRange(this.nav.sector);
    return floorAtRibbonY(from, to, worldY);
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const wasDragging = this.dragMoved;
    this.dragging = false;
    this.dragMoved = false;
    if (wasDragging) return;
    if (pointer.x < 0 || pointer.y < 0 || pointer.x > DESIGN_WIDTH || pointer.y > DESIGN_HEIGHT) return;

    const worldY = this.worldYAt(pointer.y);
    if (this.nav.level === 'overview') {
      // A click on the building drills into the sector the floor belongs to,
      // centred on the floor that was clicked — one gesture, two levels of the
      // old map's walking.
      const floor = floorAtBuildingY(worldY);
      if (floor === null) return;
      const sector = sectorOf(floor);
      this.nav = this.enterSectorView({ ...enterSector(sector), cursor: floor }, floor);
    } else if (this.nav.level === 'sector') {
      const { from, to } = sectorRange(this.nav.sector);
      const floor = floorAtRibbonY(from, to, worldY);
      if (floor === null) return;
      this.nav = this.enterFloorView(enterFloor(this.nav, floor));
    }
    this.redraw();
  }

  private onWheel(
    _pointer: Phaser.Input.Pointer,
    _over: Phaser.GameObjects.GameObject[],
    _dx: number,
    dy: number,
  ): void {
    const range = this.zoomRange();
    const factor = dy < 0 ? 1.15 : 1 / 1.15;
    const zoom = Math.max(range.min, Math.min(range.max, this.nav.zoom * factor));
    if (zoom === this.nav.zoom) return;
    // Anchor the zoom on the pointer's world y (inside the content band), so
    // the floor under the cursor stays under the cursor.
    const pointer = this.input.activePointer;
    const anchorScreenY =
      pointer.y >= TOWER_MAP.topBand && pointer.y <= TOWER_MAP.bottomBand ? pointer.y : DESIGN_HEIGHT / 2;
    const worldAnchor = this.worldYAt(anchorScreenY);
    // Keep the anchor's world y at its screen y: C' = worldAnchor - (screenY - half)/zoom.
    const center = worldAnchor - (anchorScreenY - DESIGN_HEIGHT / 2) / zoom;
    const base = { ...this.nav, zoom };
    this.nav = { ...base, scroll: this.clampCenterFor(base, center) - DESIGN_HEIGHT / 2 };
    this.redraw();
  }
}
