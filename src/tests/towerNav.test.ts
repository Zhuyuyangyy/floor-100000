import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import {
  OVERVIEW_ROW_H,
  CONTENT_TOP,
  HUD_BOTTOM,
  SECTOR_CELL,
  ZOOM_MAX,
  ZOOM_MIN,
  accessOf,
  enterFloor,
  floorCentreY,
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
import { SECTOR_COUNT, TOTAL_FLOORS, sectorRange } from '../core/tower';
import { DESIGN_HEIGHT } from '../core/design';
import type { GameState } from '../core/gameTypes';
import { ALIN_REPAIR_GATE_FLAG } from '../data/floorGates';

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

  it('caps inconsistent visited floors below Alin’s unopened upward gate', () => {
    // An unrelated/corrupt higher visit must not stand in for reaching floor 3.
    expect(accessOf(stateAt(1, [1, 2, 4, 10]))).toEqual({ highestUnlocked: 2, currentFloor: 1 });
  });

  it('uses the visited frontier after the repair-gate story flag is set', () => {
    const state = stateAt(1, [1, 2, 4]);
    state.flags = { [ALIN_REPAIR_GATE_FLAG]: 1 };
    expect(accessOf(state)).toEqual({ highestUnlocked: 4, currentFloor: 1 });
  });

  it('keeps legacy progression when floor 3 was already visited', () => {
    expect(accessOf(stateAt(2, [1, 2, 3, 4]))).toEqual({ highestUnlocked: 4, currentFloor: 2 });
  });

  it('keeps legacy progression when the player is already on floor 3', () => {
    expect(accessOf(stateAt(3, [1, 2]))).toEqual({ highestUnlocked: 3, currentFloor: 3 });
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

  it('opens with the player\'s own sector in view', () => {
    // The strip runs upward — sector 0 is at the base, sector 99 at the summit —
    // so the row the player stands on is not simply `sector * row height`.
    // Whichever sector the run is on, that sector has to be on screen the
    // moment the map opens.
    for (const floor of [1, 50001, TOTAL_FLOORS]) {
      const nav = openTower(accessOf(stateAt(floor)));
      const top = viewTop(nav.scroll, nav.zoom);
      expect(top).toBeLessThanOrEqual(sectorCentreY(nav.sector));
      expect(top + VIEW_H / nav.zoom).toBeGreaterThanOrEqual(sectorCentreY(nav.sector));
    }
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

// The overview's whole job is "see the entire tower at a glance, then zoom in".
// That only holds if all 100 sectors fit inside the viewport at the default
// zoom, with room left for the fixed HUD bands top and bottom — and if the
// tower actually fills that viewport. A tower drawn in the top half of the
// screen reads as a bar chart, not a tower (docs/UI_AUDIT_R3.md D-10).
describe('the overview fits the whole tower', () => {
  it('measures the camera by the canvas height, not the 640x360 of the old one', () => {
    // The root cause of the empty lower half: VIEW_H used to be 360 while the
    // camera is 720 tall, so every world-space conversion in this file was
    // computed against half a screen.
    expect(VIEW_H).toBe(DESIGN_HEIGHT);
    expect(VIEW_H).toBe(720);
  });

  it('lays 100 sector rows out inside the viewport at 1x', () => {
    expect(overviewHeight()).toBeLessThanOrEqual(VIEW_H);
    // Every row is reachable: the strip starts below the top HUD band and ends
    // above the bottom one.
    expect(CONTENT_TOP).toBeGreaterThan(0);
    expect(overviewHeight()).toBeLessThan(VIEW_H);
  });

  it('fills the screen instead of huddling in the top half', () => {
    // The tower strip itself (100 rows), not counting the HUD inset above it.
    const rows = SECTOR_COUNT * OVERVIEW_ROW_H;
    expect(rows / VIEW_H).toBeGreaterThanOrEqual(0.8);
    // And the whole content, inset included.
    expect(overviewHeight() / VIEW_H).toBeGreaterThanOrEqual(0.8);
  });

  it('starts below the fixed HUD band, so the summit row is not under the title', () => {
    // The title (32px type at y=8) and the status line (22px type at y=26)
    // reach down to roughly y=60, so the strip has to start below that.
    expect(CONTENT_TOP).toBeGreaterThanOrEqual(60);
  });

  it('shows the bottom of the tower from the top of the viewport at 1x', () => {
    const nav = openTower(accessOf(stateAt(1)));
    const top = viewTop(nav.scroll, nav.zoom);
    expect(nav.zoom).toBe(ZOOM_MIN);
    expect(top).toBeLessThanOrEqual(0);
    expect(top + VIEW_H / nav.zoom).toBeGreaterThanOrEqual(overviewHeight());
  });

  it('needs no scrolling at 1x to see the whole tower', () => {
    const nav = openTower(accessOf(stateAt(1)));
    expect(scrollBy(nav, 99999)).toBe(0);
    expect(scrollBy(nav, -99999)).toBe(0);
  });

  it('keeps integer row geometry so pixelArt stays crisp', () => {
    expect(Number.isInteger(OVERVIEW_ROW_H)).toBe(true);
    expect(Number.isInteger(CONTENT_TOP)).toBe(true);
  });
});

// The world-space ranges the camera is clamped against. These are the numbers
// that decide whether the tower can be dragged out from under the fixed HUD.
describe('the world-space ranges', () => {
  it('the visible world range at 1x is the whole canvas', () => {
    const nav = openTower(accessOf(stateAt(1)));
    expect(viewTop(nav.scroll, nav.zoom)).toBe(0);
    expect(viewTop(nav.scroll, nav.zoom) + VIEW_H / nav.zoom).toBe(VIEW_H);
  });

  it('the overview scroll range is closed at 1x and opens once zoomed in', () => {
    const nav = openTower(accessOf(stateAt(1)));
    expect(scrollBy(nav, -99999)).toBe(0);
    expect(scrollBy(nav, 99999)).toBe(0);
    const zoomed = zoomBy(nav, 1); // 1.5x
    expect(scrollBy(zoomed, -99999)).toBeLessThan(0);
    expect(scrollBy(zoomed, 99999)).toBeGreaterThan(0);
  });

  it('picks every one of the 100 sectors, row by row', () => {
    const nav = openTower(accessOf(stateAt(1)));
    for (let sector = 0; sector < SECTOR_COUNT; sector++) {
      // The strip runs upward, so sector 99 is the top row and sector 0 the
      // bottom one.
      const rowTop = CONTENT_TOP + (SECTOR_COUNT - 1 - sector) * OVERVIEW_ROW_H;
      expect(pickSectorAt(nav, rowTop)).toBe(sector);
      expect(pickSectorAt(nav, rowTop + OVERVIEW_ROW_H - 1)).toBe(sector);
      // The first pixel of the next row down belongs to the sector below it.
      if (sector > 0) expect(pickSectorAt(nav, rowTop + OVERVIEW_ROW_H)).toBe(sector - 1);
    }
  });

  it('the sector grid fits in one look at 1x too', () => {
    const nav = enterSector(0); // floors 1..1000
    expect(sectorHeight()).toBeLessThanOrEqual(VIEW_H);
    expect(scrollBy(nav, -99999)).toBe(0);
    expect(scrollBy(nav, 99999)).toBe(0);
  });
});

describe('the tower reads the right way up', () => {
  // A tower's base is at the bottom. Floor 1 is the slum the player starts in and
  // floor 100000 is the summit, so the overview must draw sector 0 low and sector
  // 99 high — otherwise the map shows the base at the top and the goal at the
  // bottom, which is the tower upside down.
  it('puts the lowest sector at the bottom of the strip', () => {
    const low = sectorCentreY(0);
    const high = sectorCentreY(SECTOR_COUNT - 1);
    expect(low).toBeGreaterThan(high);
  });

  it('maps a low screen position to a low sector and a high one to a high sector', () => {
    const nav = openTower(accessOf(stateAt(1)));
    const bottom = pickSectorAt(nav, overviewHeight() - 1);
    const top = pickSectorAt(nav, CONTENT_TOP);
    expect(bottom).toBe(0); // floor 1 sits at the base
    expect(top).toBe(SECTOR_COUNT - 1); // floor 100000 sits at the summit
  });

  it('is symmetric: every sector round-trips through pick and centre', () => {
    const nav = openTower(accessOf(stateAt(1)));
    for (let s = 0; s < SECTOR_COUNT; s++) {
      expect(pickSectorAt(nav, sectorCentreY(s))).toBe(s);
    }
  });

  it('the sector grid also runs upward: the first floor of a sector is at the bottom', () => {
    const nav = enterSector(0); // floors 1..1000
    const { from, to } = sectorRange(0);
    expect(floorCentreY(from)).toBeGreaterThan(floorCentreY(to));
    expect(pickFloorAt(nav, 1, sectorHeight() - CONTENT_TOP - 1)).toBe(from);
    expect(pickFloorAt(nav, sectorViewWidth() - 1, 1)).toBe(to);
  });
});

describe('picking from screen coordinates', () => {
  it('maps overview y to the sector under the cursor', () => {
    const nav = openTower(accessOf(stateAt(1)));
    // The strip runs bottom-to-top: the top row is the summit, the bottom row is
    // the slum the player starts in.
    expect(pickSectorAt(nav, CONTENT_TOP)).toBe(SECTOR_COUNT - 1);
    expect(pickSectorAt(nav, CONTENT_TOP + OVERVIEW_ROW_H * 3 + 1)).toBe(SECTOR_COUNT - 4);
    expect(pickSectorAt(nav, CONTENT_TOP + OVERVIEW_ROW_H * 99 + 1)).toBe(0);
    // Outside the strip (top HUD band / bottom HUD band) there is nothing to pick.
    expect(pickSectorAt(nav, CONTENT_TOP - 1)).toBeNull();
    expect(pickSectorAt(nav, overviewHeight())).toBeNull();
    expect(pickSectorAt(nav, -10)).toBeNull();
  });

  it('maps sector-view x/y to the floor under the cursor', () => {
    const nav = enterSector(0); // floors 1..1000
    // Coordinates are relative to the grid's own top edge, so the fixed HUD band
    // above the grid is never clickable.
    // Rows stack from the bottom and read left to right, so the top-left cell is
    // the 981st floor of the sector and the bottom-left is its first.
    expect(pickFloorAt(nav, 1, 1)).toBe(981);
    // Column 1, row 0 -> the next floor along.
    expect(pickFloorAt(nav, SECTOR_CELL + 1, 1)).toBe(982);
    // The top-right cell is the sector's highest floor.
    expect(pickFloorAt(nav, sectorViewWidth() - 1, 1)).toBe(1000);
    // One row down -> a full column of 20 lower.
    expect(pickFloorAt(nav, 1, SECTOR_CELL + 1)).toBe(961);
    expect(pickFloorAt(nav, -5, 5)).toBeNull();
    expect(pickFloorAt(nav, sectorViewWidth() + 5, 5)).toBeNull();
    expect(pickFloorAt(nav, 5, -5)).toBeNull();
  });

  it('picks the first floor of a sector exactly at its near corner', () => {
    const nav = enterSector(99); // floors 99001..100000
    expect(pickFloorAt(nav, 1, sectorHeight() - CONTENT_TOP - 1)).toBe(99001);
    // One past the bottom row is outside the grid, not the first floor.
    expect(pickFloorAt(nav, 1, sectorHeight() - CONTENT_TOP)).toBeNull();
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

  it('cannot scroll the overview at 1x, because it all fits', () => {
    const nav = openTower(accessOf(stateAt(1)));
    expect(scrollBy(nav, -9999)).toBe(0);
    expect(scrollBy(nav, 99999)).toBe(0);
  });

  it('opens scroll range once zoomed past the fit', () => {
    const zoomed = zoomBy(openTower(accessOf(stateAt(1))), 1); // 1.5x
    expect(scrollBy(zoomed, -9999)).toBeLessThan(0);
    expect(scrollBy(zoomed, 99999)).toBeGreaterThan(0);
  });

  it('never parks the tower under the fixed HUD, at any zoom', () => {
    // The real invariant. The old bounds were computed against the whole 360px
    // viewport, so at 1.5x the strip's top row landed at screen 0 — underneath the
    // title — and its bottom row underneath the control hint.
    for (const steps of [1, 3, 6, 10]) {
      let nav = openTower(accessOf(stateAt(1)));
      for (let i = 0; i < steps; i++) nav = zoomBy(nav, 1);
      const z = nav.zoom;

      const atMin = scrollBy(nav, -99999);
      const atMax = scrollBy(nav, 99999);
      // Screen position of the content's top and bottom edges.
      const topScreen = (CONTENT_TOP - viewTop(atMin, z)) * z;
      const bottomScreen = (overviewHeight() - viewTop(atMax, z)) * z;
      // The strip starts at or below the top HUD band...
      expect(topScreen, `zoom ${z}`).toBeGreaterThanOrEqual(CONTENT_TOP - 0.001);
      // ...and ends at or above the bottom one.
      expect(bottomScreen, `zoom ${z}`).toBeLessThanOrEqual(VIEW_H - HUD_BOTTOM + 0.001);
    }
  });

  it('the sector grid keeps its lowest rows clear of the hint too', () => {
    // The bug this bounds change fixes: floor 1's cell landed at screen 348, under
    // the control hint at 336, because the clamp allowed a scroll that put it there.
    const nav = enterSector(0); // floors 1..1000, cursor on floor 1
    const atMax = scrollBy(nav, 99999);
    const floorOneScreen = (floorCentreY(1) - viewTop(atMax, nav.zoom)) * nav.zoom;
    expect(floorOneScreen).toBeLessThanOrEqual(VIEW_H - HUD_BOTTOM);
  });

  it('centres the view on a world y', () => {
    // The target lands mid-viewport, not flush against the top edge, so a
    // scrolled-to cursor keeps context on both sides.
    const top = viewTop(scrollForCentre(200), 1);
    expect(top + VIEW_H / 2).toBe(200);
    const zoomed = viewTop(scrollForCentre(200), 2);
    expect(zoomed + VIEW_H / 2 / 2).toBe(200);
  });
});

describe('keyboard cursor', () => {
  it('starts on the sector the player is standing in', () => {
    expect(openTower(accessOf(stateAt(1))).cursor).toBe(0);
    expect(openTower(accessOf(stateAt(TOTAL_FLOORS))).cursor).toBe(99);
  });

  it('moves the overview cursor within the tower', () => {
    let nav = nudgeSector(openTower(accessOf(stateAt(1))), 3);
    expect(nav.cursor).toBe(3);
    expect(nav.sector).toBe(3);
    // At 1x the whole tower is on screen, so there is nothing to scroll.
    expect(nav.scroll).toBe(0);
    // Clamped at both ends.
    for (let i = 0; i < 20; i++) nav = nudgeSector(nav, -1);
    expect(nav.cursor).toBe(0);
    for (let i = 0; i < 200; i++) nav = nudgeSector(nav, 1);
    expect(nav.cursor).toBe(99);
  });

  it('re-centres on the cursor once zoomed in', () => {
    // 1.5x: the strip is taller than the viewport, so the cursor has to be
    // scrolled to or it would be off screen. Sector 50 is far enough from either
    // end that the clamp does not interfere.
    let nav = zoomBy(openTower(accessOf(stateAt(1))), 1);
    for (let i = 0; i < 50; i++) nav = nudgeSector(nav, 1);
    expect(nav.cursor).toBe(50);
    // Mid-viewport, with context above and below.
    const top = viewTop(nav.scroll, nav.zoom);
    expect(top + VIEW_H / nav.zoom / 2).toBeCloseTo(sectorCentreY(50), 5);
    expect(top).toBeLessThan(sectorCentreY(50));
    expect(top + VIEW_H / nav.zoom).toBeGreaterThan(sectorCentreY(50));
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

  it('does not let inconsistent higher visits bypass Alin’s unopened gate', () => {
    const access = accessOf(stateAt(1, [1, 2, 4, 10]));
    const nav = enterFloor(enterSector(0), 3);
    expect(tryEnterSelected(nav, access).ok).toBe(false);
  });

  it('allows entering floor 3 after the repair-gate flag is open', () => {
    const state = stateAt(2, [1, 2]);
    state.flags = { [ALIN_REPAIR_GATE_FLAG]: 1 };
    const nav = enterFloor(enterSector(0), 3);
    expect(tryEnterSelected(nav, accessOf(state))).toEqual({ ok: true, floor: 3 });
  });

  it('preserves forward and return access for legacy saves across the gate', () => {
    const afterGate = accessOf(stateAt(2, [1, 2, 3, 4]));
    expect(tryEnterSelected(enterFloor(enterSector(0), 4), afterGate)).toEqual({ ok: true, floor: 4 });
    expect(tryEnterSelected(enterFloor(enterSector(0), 2), afterGate)).toEqual({ ok: true, floor: 2 });

    const onFloorThree = accessOf(stateAt(3, [1, 2]));
    expect(tryEnterSelected(enterFloor(enterSector(0), 3), onFloorThree)).toEqual({ ok: true, floor: 3 });
    expect(tryEnterSelected(enterFloor(enterSector(0), 2), onFloorThree)).toEqual({ ok: true, floor: 2 });
  });

  it('refuses when no floor is selected (failure/boundary)', () => {
    const access = accessOf(stateAt(1, [1]));
    expect(tryEnterSelected(openTower(access), access).ok).toBe(false);
    expect(tryEnterSelected(enterSector(0), access).ok).toBe(false);
  });
});
