import { SECTOR_COUNT, SECTOR_SIZE, TOTAL_FLOORS, canEnter, sectorOf, sectorRange, type Access } from '../core/tower';
import { DESIGN_HEIGHT } from '../core/design';
import type { GameState } from '../core/gameTypes';
import { ALIN_REPAIR_GATE, isAlinRepairGateOpen } from '../data/floorGates';

// Three-level tower navigation (docs/B2_TOWER_ARCHITECTURE.md): the whole tower
// (100 sectors) -> one sector (1000 floors) -> one floor. Pure so the rules can
// be unit-tested; TowerOverviewScene only renders this state and feeds input
// back into it.
//
// Coordinates below are WORLD units: zoom is applied by the camera, never baked
// into the layout, so picking stays correct at every zoom level.

export type NavLevel = 'overview' | 'sector' | 'floor';

// Overview: one row per sector. The row pitch is 6px and the strip is inset
// from the top of the viewport, so all 100 rows sit inside the 720px canvas at
// the default 1x zoom with the fixed HUD bands clear of them — the tower is
// meant to be taken in at a glance before zooming in.
//
// The pitch used to be 3px, which was right for the 640x360 canvas this game
// was drawn on before the resolution doubled, and wrong for this one: 100 rows
// then covered only 300 of the canvas' 720 pixels, so the lower half of the
// screen was empty sky (docs/UI_AUDIT_R3.md D-10). At 6px the rows are 600
// units tall — 83% of the canvas — and the tower finally reads as a tower.
//
// Integer geometry matters: pixelArt rendering of fractional fillRects produces
// uneven edges, so both the pitch and the inset stay whole numbers.
export const OVERVIEW_ROW_H = 6;
// The fixed HUD's top band: the title (32px type at y=8) and the status line
// (22px type at y=26) both live in it, so the content starts below them and
// the summit row is not drawn under the text.
export const CONTENT_TOP = 66;
// Sector view: 1000 floors in a grid, 20 across x 50 down.
export const SECTOR_COLS = 20;
export const SECTOR_ROWS = SECTOR_SIZE / SECTOR_COLS;
export const SECTOR_CELL = 12;

// The camera's visible height in world units at 1x. Phaser shows
// `camera.height / zoom` world units, and the canvas is 1280x720
// (src/core/design.ts), so this has to be 720.
//
// It used to be 360 — the height of the 640x360 canvas this game was drawn on
// before the resolution doubled (docs/UI_AUDIT_R3.md D-10). With the camera
// 720 tall, a VIEW_H of 360 made the whole map believe it had half a screen:
// it laid 100 sector rows into the top half of the canvas, centred the cursor
// 180 units above the middle, and clamped scrolling against a band that was
// not the one on screen. It is read from DESIGN_HEIGHT so the two cannot drift
// apart again.
export const VIEW_H = DESIGN_HEIGHT;
// The fixed HUD occupies CONTENT_TOP at the top of the viewport and HUD_BOTTOM at
// the bottom. Scroll bounds are computed against the usable band between them.
// Without this the sector grid could be scrolled only to where its lowest rows sat
// under the control hint — and the lowest rows are exactly where the player's
// current floor lives.
export const HUD_BOTTOM = 24;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 6;
const ZOOM_STEP = 0.5;

export interface TowerNavState {
  level: NavLevel;
  // Sector in view at the sector level. Always valid (0..SECTOR_COUNT-1).
  sector: number;
  // Floor selected at the floor level; null at the other two.
  floor: number | null;
  // Keyboard cursor: a sector index on the overview, a floor number in the
  // sector view. Kept separate from `floor` so arrowing around the grid never
  // looks like a committed selection.
  cursor: number;
  zoom: number;
  // Camera scrollY. Phaser centres the view on scrollY + VIEW_H/2 and shows
  // VIEW_H/zoom world units, so the visible top is viewTop() below.
  scroll: number;
}

// Bottom edge of the overview content in world coordinates. Used as the content
// height for scroll clamping: the strip starts at CONTENT_TOP, not at 0, so the
// reachable world range is CONTENT_TOP .. CONTENT_TOP + 100 rows.
export function overviewHeight(): number {
  return CONTENT_TOP + SECTOR_COUNT * OVERVIEW_ROW_H;
}

export function sectorViewWidth(): number {
  return SECTOR_COLS * SECTOR_CELL;
}

// Same inset for the sector grid, so the fixed HUD never sits on cells either.
export function sectorHeight(): number {
  return CONTENT_TOP + SECTOR_ROWS * SECTOR_CELL;
}

// What the player may legitimately enter: everything up to the highest floor
// they have actually reached, plus the floor they are standing on, subject to
// progression gates that have not yet been opened.
export function accessOf(state: GameState): Access {
  let highest = state.currentFloor;
  for (const key of Object.keys(state.visitedFloors)) {
    const f = Number(key);
    if (Number.isInteger(f) && f > highest) highest = f;
  }
  const highestUnlocked = isAlinRepairGateOpen(state)
    ? Math.max(highest, ALIN_REPAIR_GATE.toFloor)
    : Math.min(highest, ALIN_REPAIR_GATE.toFloor - 1);
  return { highestUnlocked, currentFloor: state.currentFloor };
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

function contentHeight(state: TowerNavState): number {
  return state.level === 'overview' ? overviewHeight() : sectorHeight();
}

// World y at the top of the camera viewport for a given scroll + zoom. Phaser
// centres the view on scrollY + VIEW_H/2 and shows VIEW_H/zoom world units, so
// the top sits half a zoomed view above the anchor.
export function viewTop(scroll: number, zoom: number): number {
  return scroll + VIEW_H / 2 - VIEW_H / zoom / 2;
}

// Scroll that puts `worldY` in the middle of the viewport, so a scrolled-to
// cursor keeps context on both sides instead of sitting flush against the top
// edge. The zoom cancels out of the derivation, which is why this takes no zoom.
export function scrollForCentre(worldY: number): number {
  return worldY - VIEW_H / 2;
}

// Scroll bounds, derived from where the usable band actually is.
//
// Phaser centres the view on scrollY + VIEW_H/2 and shows VIEW_H/zoom world
// units, so screen position S maps to world `viewTop + S/zoom`. Requiring the
// content's top edge to sit at or below the top HUD band, and its bottom edge at
// or above the bottom one, gives:
//
//   min = CONTENT_TOP - VIEW_H/2 + (VIEW_H/2 - CONTENT_TOP)/zoom
//   max = content    - VIEW_H/2 - (VIEW_H/2 - HUD_BOTTOM)/zoom
//
// At 1x on the overview both collapse to 0, which is why the whole tower fits
// with nothing to scroll: the content is shorter than the visible height, so
// the bottom bound comes out negative and is pulled up to the top bound.
function scrollBounds(contentHeightValue: number, zoom: number): { min: number; max: number } {
  const half = VIEW_H / 2;
  const min = CONTENT_TOP - half + (half - CONTENT_TOP) / zoom;
  const max = contentHeightValue - half - (half - HUD_BOTTOM) / zoom;
  // The content can be shorter than the usable band, in which case the bottom
  // bound is negative: there is nothing to scroll to, and the range collapses
  // onto the top bound rather than inverting.
  return { min, max: Math.max(min, max) };
}

// Scroll is clamped to the content so a drag can never pull the tower off
// screen and leave the player with nothing to click.
export function clampScroll(state: TowerNavState, scroll: number): number {
  const { min, max } = scrollBounds(contentHeight(state), state.zoom);
  return clamp(scroll, min, max);
}

// Scroll that centres a world y, clamped to the content.
function centredOn(state: TowerNavState, worldY: number): number {
  return clampScroll(state, scrollForCentre(worldY));
}

// Opens centred on the sector the player is standing in, so the current floor
// is always visible the moment the map comes up.
export function openTower(access: Access): TowerNavState {
  const sector = sectorOf(access.currentFloor);
  const base: TowerNavState = {
    level: 'overview',
    sector,
    floor: null,
    cursor: sector,
    zoom: ZOOM_MIN,
    scroll: 0,
  };
  // sectorCentreY() is the one place that knows where a sector sits: the strip
  // is inset by CONTENT_TOP and runs upward (sector 0 at the base). The old
  // inline `sector * OVERVIEW_ROW_H` measured from world y=0 and assumed
  // sector 0 was at the top, so it pointed at the wrong row — harmless at 1x,
  // where the scroll is clamped to 0 anyway, but wrong the moment the map
  // opens zoomed in.
  return { ...base, scroll: centredOn(base, sectorCentreY(sector)) };
}

export function zoomBy(state: TowerNavState, direction: 1 | -1): TowerNavState {
  const zoom = clamp(state.zoom + direction * ZOOM_STEP, ZOOM_MIN, ZOOM_MAX);
  const next = { ...state, zoom };
  return { ...next, scroll: clampScroll(next, state.scroll) };
}

export function scrollBy(state: TowerNavState, delta: number): number {
  return clampScroll(state, state.scroll + delta);
}

// Sector under a world-space y, or null outside the strip. The strip is inset by
// CONTENT_TOP, so the top HUD band and the bottom HUD band both fall outside it
// and correctly pick nothing.
//
// The tower is drawn the way a tower stands: sector 0 (floor 1, the slum) at the
// BOTTOM of the strip and sector 99 (floor 100000, the summit) at the TOP. So a
// low screen y maps to a high sector, and the row index is flipped.
export function pickSectorAt(state: TowerNavState, worldY: number): number | null {
  if (state.level !== 'overview') return null;
  if (worldY < CONTENT_TOP || worldY >= overviewHeight()) return null;
  const row = Math.floor((worldY - CONTENT_TOP) / OVERVIEW_ROW_H);
  const sector = SECTOR_COUNT - 1 - row;
  return sector >= 0 && sector < SECTOR_COUNT ? sector : null;
}

// Floor under a world-space (x, y) in the sector view, or null outside the grid.
// `worldY` is relative to the grid's own top edge (CONTENT_TOP), matching how the
// scene draws it. Like the overview, the grid runs upward: rows stack from the
// bottom, and within a row floors still read left to right, so the sector's
// lowest floor is the bottom-left cell and its highest is the top-right one.
export function pickFloorAt(state: TowerNavState, worldX: number, worldY: number): number | null {
  if (state.level !== 'sector') return null;
  if (worldX < 0 || worldY < 0 || worldX >= sectorViewWidth() || worldY >= sectorHeight() - CONTENT_TOP) return null;
  const col = Math.floor(worldX / SECTOR_CELL);
  const rowFromTop = Math.floor(worldY / SECTOR_CELL);
  const rowFromBottom = SECTOR_ROWS - 1 - rowFromTop;
  const { from } = sectorRange(state.sector);
  const floor = from + rowFromBottom * SECTOR_COLS + col;
  return floor >= from && floor <= TOTAL_FLOORS ? floor : null;
}

// World y of a sector row's centre, measured from the bottom of the tower.
export function sectorCentreY(sector: number): number {
  return CONTENT_TOP + (SECTOR_COUNT - 1 - sector) * OVERVIEW_ROW_H + OVERVIEW_ROW_H / 2;
}

// World y of a floor cell's centre, measured from the bottom of its sector.
export function floorCentreY(floor: number): number {
  const { from } = sectorRange(sectorOf(floor));
  const rowFromBottom = Math.floor((floor - from) / SECTOR_COLS);
  const rowFromTop = SECTOR_ROWS - 1 - rowFromBottom;
  return CONTENT_TOP + rowFromTop * SECTOR_CELL + SECTOR_CELL / 2;
}

export function enterSector(sector: number): TowerNavState {
  if (!Number.isInteger(sector) || sector < 0 || sector >= SECTOR_COUNT) {
    throw new Error(`sector ${sector} is outside the tower (0..${SECTOR_COUNT - 1})`);
  }
  const { from } = sectorRange(sector);
  const next: TowerNavState = {
    level: 'sector',
    sector,
    floor: null,
    cursor: from,
    zoom: ZOOM_MIN,
    scroll: 0,
  };
  return { ...next, scroll: centredOn(next, floorCentreY(from)) };
}

export function enterFloor(state: TowerNavState, floor: number): TowerNavState {
  const { from, to } = sectorRange(state.sector);
  if (!Number.isInteger(floor) || floor < from || floor > to) {
    throw new Error(`floor ${floor} is not in sector ${state.sector} (${from}..${to})`);
  }
  const next: TowerNavState = { ...state, level: 'floor', floor, cursor: floor };
  return { ...next, scroll: centredOn(next, floorCentreY(floor)) };
}

// ESC / right-click: up one level. A no-op at the overview, which is the top.
// The cursor is re-based into the level being returned to, because it means a
// sector index on the overview and a floor number in the sector view — leaving
// it in the old space would highlight the wrong entry.
export function navBack(state: TowerNavState): TowerNavState {
  if (state.level === 'floor') {
    return { ...state, level: 'sector', floor: null, cursor: state.floor ?? state.cursor };
  }
  if (state.level === 'sector') {
    return { ...state, level: 'overview', floor: null, cursor: state.sector };
  }
  return state;
}

// Keyboard cursor movement. Returns a new state with the cursor moved and the
// view re-centred on it, so the highlighted entry is never off screen.
export function nudgeSector(state: TowerNavState, delta: number): TowerNavState {
  if (state.level !== 'overview') return state;
  const cursor = clamp(state.cursor + delta, 0, SECTOR_COUNT - 1);
  const next = { ...state, cursor, sector: cursor };
  return { ...next, scroll: centredOn(next, sectorCentreY(cursor)) };
}

export function nudgeFloor(state: TowerNavState, dx: number, dy: number): TowerNavState {
  if (state.level !== 'sector') return state;
  const { from, to } = sectorRange(state.sector);
  const offset = clamp(state.cursor + dx + dy * SECTOR_COLS, from, to) - from;
  const cursor = from + offset;
  const next = { ...state, cursor };
  return { ...next, scroll: centredOn(next, floorCentreY(cursor)) };
}

export type EnterResult = { ok: true; floor: number } | { ok: false; reason: string };

// Selecting a floor in the map is NOT entering it. Only a floor the player has
// actually reached may be entered — this is the single gate that keeps the
// overview a planning tool rather than a teleporter (design freeze §5).
export function tryEnterSelected(state: TowerNavState, access: Access): EnterResult {
  if (state.floor === null) return { ok: false, reason: '未选择楼层' };
  if (!canEnter(state.floor, access)) {
    return { ok: false, reason: '该楼层尚未打通，需先通过实际通路抵达' };
  }
  return { ok: true, floor: state.floor };
}
