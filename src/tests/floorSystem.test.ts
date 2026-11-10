import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
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
    s.currentFloor = 5;
    expect(tryChangeFloor(s, 1)).toEqual({ ok: false, reason: 'top' });
    expect(s.currentFloor).toBe(5);
  });

  it('blocks descending below the bottom of the playable range (failure/boundary)', () => {
    const s = createNewGame(1);
    expect(tryChangeFloor(s, -1)).toEqual({ ok: false, reason: 'bottom' });
    expect(s.currentFloor).toBe(1);
  });
});

describe('exit availability', () => {
  it('the bottom floor has no down exit; the top has no up exit', () => {
    expect(hasDownExit(1)).toBe(false);
    expect(hasUpExit(1)).toBe(true);
    expect(hasUpExit(5)).toBe(false);
    expect(hasDownExit(5)).toBe(true);
  });
});

describe('natural stair traversal', () => {
  it('does not mutate the floor until the traversal is committed', () => {
    const state = createNewGame(1);
    const traversal = stairTraversalFor(state, 1);
    expect(traversal).toMatchObject({ from: 1, to: 2, startX: UP_EXIT_X, endX: DOWN_EXIT_X, startY: STAIR_START_Y });
    expect(state.currentFloor).toBe(1);
    expect(stairPosition(traversal!, 0)).toMatchObject({ x: UP_EXIT_X, progress: 0 });
    expect(stairPosition(traversal!, traversal!.durationMs / 2).x).toBeCloseTo(640, 5);

    const end = stairPosition(traversal!, traversal!.durationMs);
    expect(end).toMatchObject({ x: DOWN_EXIT_X, y: STAIR_START_Y - STAIR_RISE });
    const result = completeStairTraversal(state, traversal!);
    expect(result).toEqual({ ok: true, from: 1, to: 2 });
    expect(state.currentFloor).toBe(2);
    expect(state.player.x).toBe(DOWN_EXIT_X);
  });

  it('reverses the landing sides when descending', () => {
    const state = createNewGame(1);
    state.currentFloor = 2;
    const traversal = stairTraversalFor(state, -1);
    expect(traversal).toMatchObject({ startX: DOWN_EXIT_X, endX: UP_EXIT_X, from: 2, to: 1 });
    completeStairTraversal(state, traversal!);
    expect(state.currentFloor).toBe(1);
    expect(state.player.x).toBe(UP_EXIT_X);
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
