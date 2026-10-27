import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import {
  OVERVIEW_ROW_H,
  SECTOR_CELL,
  SECTOR_COLS,
  ZOOM_MAX,
  ZOOM_MIN,
  accessOf,
  enterFloor,
  enterSector,
  navBack,
  nudgeFloor,
  nudgeSector,
  openTower,
  overviewHeight,
  pickFloorAt,
  pickSectorAt,
  scrollBy,
  scrollForCentre,
  sectorCentreY,
  sectorHeight,
  sectorViewWidth,
  tryEnterSelected,
  viewTop,
  VIEW_H,
  zoomBy,
} from '../systems/TowerNav';
import { TOTAL_FLOORS } from '../core/tower';
import type { GameState } from '../core/gameTypes';

function stateAt(floor: number, visited: number[] = []): GameState {
  const s = createNewGame(1);
  s.currentFloor = floor;
  for (const f of visited) s.visitedFloors[f] = { openedContainers: [], lootedItems: [], unlockedDoors: [], localEvents: [] };
  return s;
}

describe('accessOf', () => {
  it('starts unlocked exactly where the player stands', () => {
    expect(accessOf(stateAt(3))).toEqual({ highestUnlocked: 3, currentFloor: 3 });
  });

  it('unlocks up to the highest floor ever visited, not the current one', () => {
    // Climbing to 5 then coming back down to 1 must not relock 2..5.
    expect(accessOf(stateAt(1, [1, 2, 3, 4, 5]))).toEqual({ highestUnlocked: 5, currentFloor: 1 });
  });
});

describe('openTower', () => {
  it('opens on the overview, scrolled to the sector the player is standing in', () => {
    const nav = openTower(accessOf(stateAt(1)));
    expect(nav.level).toBe('overview');
    expect(nav.sector).toBe(0);
    expect(nav.floor).toBeNull();
  });

  it('opens on the sector containing a high floor', () => {
    // floor 100000 -> sector 99, the last one.
    const nav = openTower(accessOf(stateAt(TOTAL_FLOORS)));
    expect(nav.sector).toBe(99);
  });
});

describe('level transitions', () => {
  it('entering a sector moves to the sector level and clears the floor', () => {
    const nav = enterSector(42);
    expect(nav.level).toBe('sector');
    expect(nav.sector).toBe(42);
    expect(nav.floor).toBeNull();
  });

  it('entering a floor records it and moves to the floor level', () => {
    let nav = enterSector(0);
    nav = enterFloor(nav, 3);
    expect(nav.level).toBe('floor');
    expect(nav.sector).toBe(0);
    expect(nav.floor).toBe(3);
  });

  it('back from the floor level returns to the sector level, keeping the sector', () => {
    let nav = enterFloor(enterSector(7), 7012);
    nav = navBack(nav);
    expect(nav.level).toBe('sector');
    expect(nav.sector).toBe(7);
    expect(nav.floor).toBeNull();
  });

  it('back from the sector level returns to the overview', () => {
    let nav = enterSector(7);
    nav = navBack(nav);
    expect(nav.level).toBe('overview');
  });

  it('back at the overview is a no-op (there is nothing above it)', () => {
    const nav = openTower(accessOf(stateAt(1)));
    expect(navBack(nav)).toBe(nav);
  });

  it('re-bases the cursor into the level it returns to', () => {
    // The cursor is a sector index on the overview and a floor number in the
    // sector view, so it must be translated on the way up — otherwise the
    // overview would highlight "sector 2" for a floor the player never looked at.
    let nav = enterFloor(enterSector(7), 7012);
    nav = navBack(nav);
    expect(nav.level).toBe('sector');
    expect(nav.cursor).toBe(7012);
    nav = navBack(nav);
    expect(nav.level).toBe('overview');
    expect(nav.cursor).toBe(7);
  });

  it('rejects a floor outside the sector being viewed', () => {
    const nav = enterSector(0); // floors 1..1000
    expect(() => enterFloor(nav, 1001)).toThrow();
  });
});

describe('picking from screen coordinates', () => {
  it('maps overview y to the sector under the cursor', () => {
    const nav = openTower(accessOf(stateAt(1)));
    expect(pickSectorAt(nav, 0)).toBe(0);
    expect(pickSectorAt(nav, OVERVIEW_ROW_H * 3 + 1)).toBe(3);
    expect(pickSectorAt(nav, -10)).toBeNull();
    expect(pickSectorAt(nav, overviewHeight() + 5)).toBeNull();
  });

  it('maps sector-view x/y to the floor under the cursor', () => {
    const nav = enterSector(0); // floors 1..1000
    // Column 0, row 0 -> the first floor of the sector.
    expect(pickFloorAt(nav, 1, 1)).toBe(1);
    // Column 1, row 0 -> the next floor along.
    expect(pickFloorAt(nav, SECTOR_CELL + 1, 1)).toBe(2);
    // Row 1 -> one full column further down.
    expect(pickFloorAt(nav, 1, SECTOR_CELL + 1)).toBe(1 + SECTOR_COLS);
    expect(pickFloorAt(nav, -5, 5)).toBeNull();
    expect(pickFloorAt(nav, sectorViewWidth() + 5, 5)).toBeNull();
  });

  it('picks the last floor of a sector exactly at its far corner', () => {
    const nav = enterSector(99); // floors 99001..100000
    const last = sectorViewWidth() - 1;
    expect(pickFloorAt(nav, last, sectorHeight() - 1)).toBe(TOTAL_FLOORS);
  });
});

describe('zoom and scroll', () => {
  it('clamps zoom to the supported range', () => {
    let nav = openTower(accessOf(stateAt(1)));
    for (let i = 0; i < 50; i++) nav = zoomBy(nav, 1);
    expect(nav.zoom).toBe(ZOOM_MAX);
    for (let i = 0; i < 100; i++) nav = zoomBy(nav, -1);
    expect(nav.zoom).toBe(ZOOM_MIN);
  });

  it('clamps overview scroll to the content, so it cannot be dragged off screen', () => {
    const nav = openTower(accessOf(stateAt(1)));
    expect(scrollBy(nav, -9999)).toBe(0);
    // At 1x the whole 400px tower minus the 360px viewport.
    expect(scrollBy(nav, 99999)).toBe(40);
  });

  it('keeps the very top of the tower reachable when zoomed in', () => {
    const zoomed = zoomBy(openTower(accessOf(stateAt(1))), 1); // 1.5x
    // The lower bound goes negative so viewTop() still lands on world y 0.
    expect(viewTop(scrollBy(zoomed, -9999), zoomed.zoom)).toBe(0);
    // And the bottom of the view lands exactly on the bottom of the tower.
    const bottom = viewTop(scrollBy(zoomed, 99999), zoomed.zoom) + VIEW_H / zoomed.zoom;
    expect(bottom).toBeCloseTo(overviewHeight(), 5);
  });

  it('centres the view on a world y', () => {
    expect(viewTop(scrollForCentre(200, 1), 1)).toBe(200);
    expect(viewTop(scrollForCentre(200, 2), 2)).toBe(200);
  });
});

describe('keyboard cursor', () => {
  it('starts on the sector the player is standing in', () => {
    expect(openTower(accessOf(stateAt(1))).cursor).toBe(0);
    expect(openTower(accessOf(stateAt(TOTAL_FLOORS))).cursor).toBe(99);
  });

  it('moves the overview cursor within the tower and re-centres on it', () => {
    let nav = nudgeSector(openTower(accessOf(stateAt(1))), 3);
    expect(nav.cursor).toBe(3);
    expect(nav.sector).toBe(3);
    expect(viewTop(nav.scroll, nav.zoom)).toBeCloseTo(sectorCentreY(3), 5);
    // Clamped at both ends.
    for (let i = 0; i < 20; i++) nav = nudgeSector(nav, -1);
    expect(nav.cursor).toBe(0);
    for (let i = 0; i < 200; i++) nav = nudgeSector(nav, 1);
    expect(nav.cursor).toBe(99);
  });

  it('moves the sector cursor across and down the floor grid', () => {
    let nav = enterSector(0); // floors 1..1000
    nav = nudgeFloor(nav, 1, 0);
    expect(nav.cursor).toBe(2);
    nav = nudgeFloor(nav, 0, 1);
    expect(nav.cursor).toBe(22); // one full row of 20 further down
    nav = nudgeFloor(nav, -1, 0);
    expect(nav.cursor).toBe(21);
  });

  it('clamps the sector cursor to the sector it is viewing', () => {
    let nav = enterSector(99); // floors 99001..100000
    for (let i = 0; i < 500; i++) nav = nudgeFloor(nav, 1, 1);
    expect(nav.cursor).toBe(TOTAL_FLOORS);
    for (let i = 0; i < 5000; i++) nav = nudgeFloor(nav, -1, -1);
    expect(nav.cursor).toBe(99001);
  });

  it('ignores cursor movement at the wrong level', () => {
    const nav = openTower(accessOf(stateAt(1)));
    expect(nudgeFloor(nav, 1, 1)).toBe(nav);
    const inSector = enterSector(0);
    expect(nudgeSector(inSector, 1)).toEqual(inSector);
  });

  it('entering a sector parks the cursor on its first floor', () => {
    const nav = enterSector(5);
    expect(nav.cursor).toBe(5001);
  });
});

describe('entering a selected floor', () => {
  it('allows entering an unlocked floor below the frontier', () => {
    const nav = enterFloor(enterSector(0), 2);
    expect(tryEnterSelected(nav, accessOf(stateAt(3, [1, 2, 3])))).toEqual({ ok: true, floor: 2 });
  });

  it('allows re-entering the floor the player is already on', () => {
    const access = accessOf(stateAt(3, [1, 2, 3]));
    const nav = enterFloor(enterSector(0), 3);
    expect(tryEnterSelected(nav, access)).toEqual({ ok: true, floor: 3 });
  });

  it('refuses a floor above the unlocked frontier instead of teleporting', () => {
    const access = accessOf(stateAt(1, [1]));
    const nav = enterFloor(enterSector(0), 40);
    const r = tryEnterSelected(nav, access);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('未打通');
  });

  it('refuses the summit while the player is still in the slum', () => {
    const access = accessOf(stateAt(1, [1]));
    let nav = enterSector(99);
    nav = enterFloor(nav, TOTAL_FLOORS);
    expect(tryEnterSelected(nav, access).ok).toBe(false);
  });

  it('refuses when no floor is selected (failure/boundary)', () => {
    const access = accessOf(stateAt(1, [1]));
    expect(tryEnterSelected(openTower(access), access).ok).toBe(false);
    expect(tryEnterSelected(enterSector(0), access).ok).toBe(false);
  });
});
