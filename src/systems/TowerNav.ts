import { SECTOR_COUNT, SECTOR_SIZE, TOTAL_FLOORS, canEnter, sectorOf, sectorRange, type Access } from '../core/tower';
import type { GameState } from '../core/gameTypes';

// Three-level tower navigation (docs/B2_TOWER_ARCHITECTURE.md): the whole tower
// (100 sectors) -> one sector (1000 floors) -> one floor. Pure so the rules can
// be unit-tested; TowerOverviewScene only renders this state and feeds input
// back into it.
//
// Coordinates below are WORLD units: zoom is applied by the camera, never baked
// into the layout, so picking stays correct at every zoom level.

export type NavLevel = 'overview' | 'sector' | 'floor';

// Overview: one row per sector.
export const OVERVIEW_ROW_H = 4;
// Sector view: 1000 floors in a grid, 20 across x 50 down.
export const SECTOR_COLS = 20;
export const SECTOR_ROWS = SECTOR_SIZE / SECTOR_COLS;
export const SECTOR_CELL = 12;

export const VIEW_H = 360;
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

export function overviewHeight(): number {
  return SECTOR_COUNT * OVERVIEW_ROW_H;
}

export function sectorViewWidth(): number {
  return SECTOR_COLS * SECTOR_CELL;
}

export function sectorHeight(): number {
  return SECTOR_ROWS * SECTOR_CELL;
}

// What the player may legitimately enter: everything up to the highest floor
// they have actually reached, plus the floor they are standing on.
export function accessOf(state: GameState): Access {
  let highest = state.currentFloor;
  for (const key of Object.keys(state.visitedFloors)) {
    const f = Number(key);
    if (Number.isInteger(f) && f > highest) highest = f;
  }
  return { highestUnlocked: highest, currentFloor: state.currentFloor };
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

// Scroll that puts `worldY` in the middle of the viewport.
export function scrollForCentre(worldY: number, zoom: number): number {
  return worldY - VIEW_H / 2 + VIEW_H / zoom / 2;
}

// Scroll bounds. The lower bound is negative above 1x (half the zoomed view
// hangs above the anchor), which is what lets the very top of the tower stay
// reachable when zoomed in.
function scrollBounds(contentHeightValue: number, zoom: number): { min: number; max: number } {
  return {
    min: VIEW_H / zoom / 2 - VIEW_H / 2,
    max: contentHeightValue - VIEW_H / 2 - VIEW_H / zoom / 2,
  };
}

// Scroll is clamped to the content so a drag can never pull the tower off
// screen and leave the player with nothing to click.
export function clampScroll(state: TowerNavState, scroll: number): number {
  const { min, max } = scrollBounds(contentHeight(state), state.zoom);
  return clamp(scroll, min, max);
}

// Scroll that centres a world y, clamped to the content.
function centredOn(state: TowerNavState, worldY: number): number {
  return clampScroll(state, scrollForCentre(worldY, state.zoom));
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
  return { ...base, scroll: centredOn(base, sector * OVERVIEW_ROW_H + OVERVIEW_ROW_H / 2) };
}

export function zoomBy(state: TowerNavState, direction: 1 | -1): TowerNavState {
  const zoom = clamp(state.zoom + direction * ZOOM_STEP, ZOOM_MIN, ZOOM_MAX);
  const next = { ...state, zoom };
  return { ...next, scroll: clampScroll(next, state.scroll) };
}

export function scrollBy(state: TowerNavState, delta: number): number {
  return clampScroll(state, state.scroll + delta);
}

// Sector under a world-space y, or null outside the tower.
export function pickSectorAt(state: TowerNavState, worldY: number): number | null {
  if (state.level !== 'overview') return null;
  if (worldY < 0 || worldY >= overviewHeight()) return null;
  const sector = Math.floor(worldY / OVERVIEW_ROW_H);
  return sector >= 0 && sector < SECTOR_COUNT ? sector : null;
}

// Floor under a world-space (x, y) in the sector view, or null outside the grid.
export function pickFloorAt(state: TowerNavState, worldX: number, worldY: number): number | null {
  if (state.level !== 'sector') return null;
  if (worldX < 0 || worldY < 0 || worldX >= sectorViewWidth() || worldY >= sectorHeight()) return null;
  const col = Math.floor(worldX / SECTOR_CELL);
  const row = Math.floor(worldY / SECTOR_CELL);
  const { from } = sectorRange(state.sector);
  const floor = from + row * SECTOR_COLS + col;
  return floor >= from && floor <= TOTAL_FLOORS ? floor : null;
}

// World y of a sector row's centre / a floor cell's centre.
export function sectorCentreY(sector: number): number {
  return sector * OVERVIEW_ROW_H + OVERVIEW_ROW_H / 2;
}

export function floorCentreY(floor: number): number {
  const { from } = sectorRange(sectorOf(floor));
  const row = Math.floor((floor - from) / SECTOR_COLS);
  return row * SECTOR_CELL + SECTOR_CELL / 2;
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
