import { describe, expect, it } from 'vitest';
import { PLAYABLE_FLOORS_V01 } from '../core/constants';
import { createNewGame } from '../core/gameState';
import { liftDirection, liftRequirement, segmentOf } from '../core/segments';
import { hasFloorContent } from '../data/floorTemplates';
import {
  DOWN_EXIT_X,
  ENTRY_X,
  FLOOR_WIDTH,
  STAIR_RISE,
  STAIR_START_Y,
  PLAYER_ACCELERATION,
  PLAYER_DECELERATION,
  PLAYER_SPEED,
  UP_EXIT_X,
} from '../core/constants';
import {
  currentInteractionZone,
  completeStairTraversal,
  hasDownExit,
  hasUpExit,
  movePlayerX,
  stairPosition,
  stairStyleFor,
  stairTraversalFor,
  stepHorizontalSpeed,
  tryChangeFloor,
} from '../systems/FloorSystem';

// Floors are numbered upward: the player starts at floor 1 in the slum and
// climbs toward 100000. "+1" is up, "-1" is down.
describe('tryChangeFloor', () => {
  it('ascends from 1 to 2 and resets to the entry position', () => {
    const s = createNewGame(1);
    s.player.x = 900;
    const r = tryChangeFloor(s, 1);
    expect(r).toEqual({ ok: true, from: 1, to: 2 });
    expect(s.currentFloor).toBe(2);
    expect(s.player.x).toBe(ENTRY_X);
  });

  it('descends from 5 toward 1', () => {
    const s = createNewGame(1);
    s.currentFloor = 5;
    expect(tryChangeFloor(s, -1)).toEqual({ ok: true, from: 5, to: 4 });
    expect(s.currentFloor).toBe(4);
  });

  it('can traverse the whole range up to 5 and back to 1', () => {
    const s = createNewGame(1);
    for (let f = 1; f < 5; f++) expect(tryChangeFloor(s, 1).ok).toBe(true);
    expect(s.currentFloor).toBe(5);
    for (let f = 5; f > 1; f--) expect(tryChangeFloor(s, -1).ok).toBe(true);
    expect(s.currentFloor).toBe(1);
  });

  it('blocks climbing above the top of the playable range (failure/boundary)', () => {
    const s = createNewGame(1);
    const top = Math.max(...PLAYABLE_FLOORS_V01);
    s.currentFloor = top;
    expect(tryChangeFloor(s, 1)).toEqual({ ok: false, reason: 'top' });
    expect(s.currentFloor).toBe(top);
  });

  it('blocks descending below the bottom of the playable range (failure/boundary)', () => {
    const s = createNewGame(1);
    expect(tryChangeFloor(s, -1)).toEqual({ ok: false, reason: 'bottom' });
    expect(s.currentFloor).toBe(1);
  });
});

// The playable floors are authored segments with unexplored voids between them
// (core/segments.ts: 1-10, 100-110, 1000-1010). Stairs connect adjacent floors
// inside a segment; only the freight lift crosses the void, so the stairwell at
// a segment top must refuse even though the next playable floor exists as a
// number.
describe('stairs stay inside a segment', () => {
  it('refuses to climb from 10 into the unexplored 11..99 gap', () => {
    const s = createNewGame(1);
    s.currentFloor = 10;
    expect(tryChangeFloor(s, 1)).toEqual({ ok: false, reason: 'top' });
    expect(s.currentFloor).toBe(10);
    // There is somewhere playable above (100), which is exactly the trap: the
    // rule must not be "the target is in the playable list".
    expect(PLAYABLE_FLOORS_V01).toContain(100);
  });

  it('refuses to descend from 100 into the unexplored 11..99 gap', () => {
    const s = createNewGame(1);
    s.currentFloor = 100;
    expect(tryChangeFloor(s, -1)).toEqual({ ok: false, reason: 'bottom' });
    expect(s.currentFloor).toBe(100);
  });

  it('allows the first step inside the dorm tier (100 -> 101)', () => {
    const s = createNewGame(1);
    s.currentFloor = 100;
    expect(tryChangeFloor(s, 1)).toEqual({ ok: true, from: 100, to: 101 });
    expect(s.currentFloor).toBe(101);
  });

  it('walks the whole dorm tier up to 110 and back to 100', () => {
    const s = createNewGame(1);
    s.currentFloor = 100;
    for (let f = 100; f < 110; f++) expect(tryChangeFloor(s, 1).ok).toBe(true);
    expect(s.currentFloor).toBe(110);
    for (let f = 110; f > 100; f--) expect(tryChangeFloor(s, -1).ok).toBe(true);
    expect(s.currentFloor).toBe(100);
  });

  it('gives 110 a down exit but no up exit, so the lift is the only way on', () => {
    expect(hasDownExit(110)).toBe(true);
    expect(hasUpExit(110)).toBe(false);
    const s = createNewGame(1);
    s.currentFloor = 110;
    expect(tryChangeFloor(s, 1)).toEqual({ ok: false, reason: 'top' });
  });

  it('lays no stair traversal across a segment boundary', () => {
    const s = createNewGame(1);
    s.currentFloor = 10;
    expect(stairTraversalFor(s, 1)).toBeNull();
    s.currentFloor = 100;
    expect(stairTraversalFor(s, -1)).toBeNull();
  });
});

// Segment 3 (1000-1010, 工业与交易区) is the third authored stretch: military
// security, freight lift, pipes, black market. The same segment rule applies —
// stairs connect adjacent floors inside it, the lift at its ends is the only
// way across the gap — and it carries no guardian: the way on from 1010 is a
// pass-gated freight lift, not a boss.
describe('stairs stay inside the industrial tier (1000-1010)', () => {
  it('allows the first step inside the segment (1000 -> 1001)', () => {
    const s = createNewGame(1);
    s.currentFloor = 1000;
    expect(tryChangeFloor(s, 1)).toEqual({ ok: true, from: 1000, to: 1001 });
    expect(s.currentFloor).toBe(1001);
  });

  it('refuses to climb from 1010 into the unexplored 1011..9999 gap', () => {
    const s = createNewGame(1);
    s.currentFloor = 1010;
    expect(tryChangeFloor(s, 1)).toEqual({ ok: false, reason: 'top' });
    expect(s.currentFloor).toBe(1010);
    // The gap above is real: 1011 belongs to no segment, and the next segment's
    // first floor (10000) has no authored content — so the freight lift, never
    // the stairs, is the only thing that could cross it.
    expect(segmentOf(1011)).toBeUndefined();
    expect(hasFloorContent(10000)).toBe(false);
  });

  it('refuses to descend from 1000 into the unexplored 111..999 gap', () => {
    const s = createNewGame(1);
    s.currentFloor = 1000;
    expect(tryChangeFloor(s, -1)).toEqual({ ok: false, reason: 'bottom' });
    expect(s.currentFloor).toBe(1000);
  });

  it('walks the whole industrial tier up to 1010 and back to 1000', () => {
    const s = createNewGame(1);
    s.currentFloor = 1000;
    for (let f = 1000; f < 1010; f++) expect(tryChangeFloor(s, 1).ok).toBe(true);
    expect(s.currentFloor).toBe(1010);
    for (let f = 1010; f > 1000; f--) expect(tryChangeFloor(s, -1).ok).toBe(true);
    expect(s.currentFloor).toBe(1000);
  });

  it('gives 1000 an up exit but no down exit, and 1010 the reverse', () => {
    expect(hasUpExit(1000)).toBe(true);
    expect(hasDownExit(1000)).toBe(false);
    expect(hasUpExit(1010)).toBe(false);
    expect(hasDownExit(1010)).toBe(true);
  });

  it('puts the freight lift at the segment ends: down at 1000, up at 1010', () => {
    expect(liftDirection(1000)).toBe('down');
    expect(liftDirection(1010)).toBe('up');
  });

  it('gates the lift out of 1010 on the pass the segment above requires', () => {
    // The lift out of a segment top carries the NEXT segment's pass: out of
    // 1010 that is segment 4's permit, not the sticker that entered segment 3.
    expect(liftRequirement(1010)).toBe('permit');
    expect(liftRequirement(110)).toBe('pass_sticker');
  });

  it('lays no stair traversal across the segment boundaries', () => {
    const s = createNewGame(1);
    s.currentFloor = 1010;
    expect(stairTraversalFor(s, 1)).toBeNull();
    s.currentFloor = 1000;
    expect(stairTraversalFor(s, -1)).toBeNull();
  });
});

describe('exit availability', () => {
  it('the bottom floor has no down exit; the top has no up exit', () => {
    const top = Math.max(...PLAYABLE_FLOORS_V01);
    expect(hasDownExit(1)).toBe(false);
    expect(hasUpExit(1)).toBe(true);
    expect(hasUpExit(top)).toBe(false);
    expect(hasDownExit(top)).toBe(true);
  });
});

describe('natural stair traversal', () => {
  it('uses vertical shafts at the chapter endpoints and steep stairs in the middle', () => {
    expect(stairStyleFor(1, 1)).toBe('vertical');
    expect(stairStyleFor(2, 1)).toBe('steep');
    expect(stairStyleFor(3, -1)).toBe('steep');
    expect(stairStyleFor(4, 1)).toBe('vertical');
  });

  it('does not mutate the floor until the traversal is committed', () => {
    const state = createNewGame(1);
    const traversal = stairTraversalFor(state, 1);
    expect(traversal).toMatchObject({ from: 1, to: 2, startX: UP_EXIT_X, endX: UP_EXIT_X, startY: STAIR_START_Y });
    expect(state.currentFloor).toBe(1);
    expect(stairPosition(traversal!, 0)).toMatchObject({ x: UP_EXIT_X, progress: 0 });
    expect(stairPosition(traversal!, traversal!.durationMs / 2).x).toBeCloseTo(UP_EXIT_X, 5);

    const end = stairPosition(traversal!, traversal!.durationMs);
    expect(end).toMatchObject({ x: UP_EXIT_X, y: STAIR_START_Y - STAIR_RISE });
    const result = completeStairTraversal(state, traversal!);
    expect(result).toEqual({ ok: true, from: 1, to: 2 });
    expect(state.currentFloor).toBe(2);
    expect(state.player.x).toBe(UP_EXIT_X);
  });

  it('reverses the landing sides when descending', () => {
    const state = createNewGame(1);
    state.currentFloor = 2;
    const traversal = stairTraversalFor(state, -1);
    expect(traversal).toMatchObject({ startX: DOWN_EXIT_X, endX: DOWN_EXIT_X, from: 2, to: 1 });
    completeStairTraversal(state, traversal!);
    expect(state.currentFloor).toBe(1);
    expect(state.player.x).toBe(DOWN_EXIT_X);
  });
});

describe('movePlayerX', () => {
  it('moves within bounds and clamps at the corridor edges', () => {
    const s = createNewGame(1);
    s.player.x = 500;
    movePlayerX(s, 50);
    expect(s.player.x).toBe(550);
    movePlayerX(s, -100000);
    expect(s.player.x).toBe(8);
    movePlayerX(s, 100000);
    expect(s.player.x).toBe(FLOOR_WIDTH - 8);
  });
});

// The speed ramp. `dir` is the held direction this frame: -1, 0 or +1.
const FRAME = 1000 / 60;

describe('stepHorizontalSpeed', () => {
  it('accelerates from rest instead of snapping to top speed', () => {
    const v = stepHorizontalSpeed(0, 1, FRAME);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(PLAYER_SPEED);
  });

  it('reaches top speed and then holds it', () => {
    let v = 0;
    for (let i = 0; i < 600; i++) v = stepHorizontalSpeed(v, 1, FRAME); // 10s
    expect(v).toBe(PLAYER_SPEED);
  });

  it('reaches the same top speed going left', () => {
    let v = 0;
    for (let i = 0; i < 600; i++) v = stepHorizontalSpeed(v, -1, FRAME);
    expect(v).toBe(-PLAYER_SPEED);
  });

  it('never exceeds top speed however long the frame is', () => {
    // A tab that was backgrounded comes back with a multi-second delta. Without
    // the clamp the player would be flung down the corridor in one frame.
    expect(stepHorizontalSpeed(0, 1, 60_000)).toBe(PLAYER_SPEED);
    expect(stepHorizontalSpeed(0, -1, 60_000)).toBe(-PLAYER_SPEED);
    expect(stepHorizontalSpeed(PLAYER_SPEED, 1, 60_000)).toBe(PLAYER_SPEED);
  });

  it('brakes to a dead stop and stays there', () => {
    let v = PLAYER_SPEED;
    for (let i = 0; i < 600; i++) v = stepHorizontalSpeed(v, 0, FRAME);
    expect(v).toBe(0);
  });

  it('brakes quicker than it accelerates', () => {
    let up = 0;
    let framesUp = 0;
    while (up < PLAYER_SPEED) {
      up = stepHorizontalSpeed(up, 1, FRAME);
      framesUp++;
    }
    let down = PLAYER_SPEED;
    let framesDown = 0;
    while (down > 0) {
      down = stepHorizontalSpeed(down, 0, FRAME);
      framesDown++;
    }
    expect(framesDown).toBeLessThan(framesUp);
  });

  it('uses the brake rate when reversing, so a turn-around is not a slide', () => {
    // Reversing from full speed must lose more ground in one frame than gaining
    // speed from rest does, otherwise flipping direction feels like ice.
    const reversed = stepHorizontalSpeed(PLAYER_SPEED, -1, FRAME);
    const started = stepHorizontalSpeed(0, 1, FRAME);
    expect(PLAYER_SPEED - reversed).toBeGreaterThan(started);
  });

  it('does not overshoot past top speed when reversing on a long frame', () => {
    const v = stepHorizontalSpeed(PLAYER_SPEED, -1, 1000);
    expect(v).toBeGreaterThanOrEqual(-PLAYER_SPEED);
    expect(v).toBeLessThan(PLAYER_SPEED);
  });

  it('is a no-op on a zero-length frame', () => {
    expect(stepHorizontalSpeed(PLAYER_SPEED, 0, 0)).toBe(PLAYER_SPEED);
    expect(stepHorizontalSpeed(0, 1, 0)).toBe(0);
    expect(Number.isNaN(stepHorizontalSpeed(0, 1, 0))).toBe(false);
  });

  it('leaves a positive number positive and a negative number negative', () => {
    // The deceleration branch must not cross zero: clamping there is what stops
    // a long frame from flinging the player the opposite way.
    let v = 10;
    for (let i = 0; i < 200; i++) v = stepHorizontalSpeed(v, 0, FRAME);
    expect(v).toBe(0);
    v = -10;
    for (let i = 0; i < 200; i++) v = stepHorizontalSpeed(v, 0, FRAME);
    expect(v).toBe(0);
  });
});


// The two rates are load-bearing for the tests above, so pin them: if someone
// tunes acceleration above deceleration the "brakes quicker" case silently
// becomes false and the ramp stops being a ramp.
describe('movement tuning', () => {
  it('keeps braking quicker than accelerating', () => {
    expect(PLAYER_DECELERATION).toBeGreaterThan(PLAYER_ACCELERATION);
  });
});

describe('currentInteractionZone', () => {
  it('detects standing next to an exit', () => {
    const s = createNewGame(1);
    s.currentFloor = 3; // has both up and down exits
    s.player.x = UP_EXIT_X;
    expect(currentInteractionZone(s)).toBe('up');
    s.player.x = DOWN_EXIT_X;
    expect(currentInteractionZone(s)).toBe('down');
    s.player.x = ENTRY_X;
    expect(currentInteractionZone(s)).toBeNull();
  });

  it('reports no down zone at the bottom floor even at the right end', () => {
    const s = createNewGame(1);
    s.player.x = DOWN_EXIT_X;
    expect(currentInteractionZone(s)).toBeNull();
  });
});
