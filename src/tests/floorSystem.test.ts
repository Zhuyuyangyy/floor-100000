import { describe, expect, it } from 'vitest';
import { PLAYABLE_FLOORS_V01 } from '../core/constants';
import { createNewGame } from '../core/gameState';
import { liftDirection, liftRequirement, segmentOf } from '../core/segments';
import { hasFloorContent } from '../data/floorTemplates';
import {
  DOWN_EXIT_X,
  ENTRY_X,
  FLOOR_WIDTH,
  downExitXFor,
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
  stairMouthZone,
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
    // first floor (10000) is authored now — so the refusal is NOT "the target
    // was never built". The stairs only ever join two floors of one segment,
    // which is why the freight lift, never the stairs, crosses the void.
    expect(segmentOf(1011)).toBeUndefined();
    expect(hasFloorContent(10000)).toBe(true);
    expect(PLAYABLE_FLOORS_V01).toContain(10000);
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

// Segment 4 (10000-10010, 中产与商业区) is the fourth authored stretch: carpet,
// signage, private armed security and the lab's anterooms. The same segment
// rule applies — stairs join adjacent floors inside it, the lift at its ends is
// the only way across the gap — and like the industrial tier it carries no
// guardian: the way on from 10010 is the vip_card-gated freight lift.
describe('stairs stay inside the commercial tier (10000-10010)', () => {
  it('allows the first step inside the segment (10000 -> 10001)', () => {
    const s = createNewGame(1);
    s.currentFloor = 10000;
    expect(tryChangeFloor(s, 1)).toEqual({ ok: true, from: 10000, to: 10001 });
    expect(s.currentFloor).toBe(10001);
  });

  it('refuses to climb from 10010 into the unexplored 10011..49999 gap', () => {
    const s = createNewGame(1);
    s.currentFloor = 10010;
    expect(tryChangeFloor(s, 1)).toEqual({ ok: false, reason: 'top' });
    expect(s.currentFloor).toBe(10010);
    // The gap above is real even though the next segment exists on paper:
    // 10011 belongs to no segment, and 50000 IS authored now — so the refusal
    // is NOT "the target was never built". The stairs only ever join two floors
    // of one segment, which is why the freight lift, never the stairs, crosses
    // the void.
    expect(segmentOf(10011)).toBeUndefined();
    expect(hasFloorContent(50000)).toBe(true);
    expect(PLAYABLE_FLOORS_V01).toContain(50000);
  });

  it('refuses to descend from 10000 into the unexplored 1011..9999 gap', () => {
    const s = createNewGame(1);
    s.currentFloor = 10000;
    expect(tryChangeFloor(s, -1)).toEqual({ ok: false, reason: 'bottom' });
    expect(s.currentFloor).toBe(10000);
    // 1010 below is authored and playable — the trap is the same one the dorm
    // and industrial tiers set: the rule is never "the target is in the list".
    expect(PLAYABLE_FLOORS_V01).toContain(1010);
    expect(hasFloorContent(1010)).toBe(true);
  });

  it('walks the whole commercial tier up to 10010 and back to 10000', () => {
    const s = createNewGame(1);
    s.currentFloor = 10000;
    for (let f = 10000; f < 10010; f++) expect(tryChangeFloor(s, 1).ok).toBe(true);
    expect(s.currentFloor).toBe(10010);
    for (let f = 10010; f > 10000; f--) expect(tryChangeFloor(s, -1).ok).toBe(true);
    expect(s.currentFloor).toBe(10000);
  });

  it('gives 10000 an up exit but no down exit, and 10010 the reverse', () => {
    expect(hasUpExit(10000)).toBe(true);
    expect(hasDownExit(10000)).toBe(false);
    expect(hasUpExit(10010)).toBe(false);
    expect(hasDownExit(10010)).toBe(true);
  });

  it('puts the freight lift at the segment ends: down at 10000, up at 10010', () => {
    expect(liftDirection(10000)).toBe('down');
    expect(liftDirection(10010)).toBe('up');
  });

  it('gates the lift out of 10010 on the pass the segment above requires', () => {
    // The lift out of a segment top carries the NEXT segment's pass: out of
    // 10010 that is segment 5's vip_card, not the permit that entered segment 4.
    expect(liftRequirement(10010)).toBe('vip_card');
    expect(liftRequirement(1010)).toBe('permit');
  });

  it('lays no stair traversal across the segment boundaries', () => {
    const s = createNewGame(1);
    s.currentFloor = 10010;
    expect(stairTraversalFor(s, 1)).toBeNull();
    s.currentFloor = 10000;
    expect(stairTraversalFor(s, -1)).toBeNull();
  });
});

// Segment 5 (50000-50010, 富人特权区) is the fifth authored stretch and the
// second-to-last: carpet, signage, private security, and the thing they keep
// upstairs. The same segment rule applies — stairs join adjacent floors inside
// it, the lift at its ends is the only way across the gap — and unlike the two
// segments below it this one HAS a guardian: 50010 carries the segment keeper
// (encounters.ts FLOOR_WEIGHT_PROFILE, encounterTableCoverage's BOSS_FLOORS),
// because this tier's gatekeeper is not staff, it is livestock.
describe('stairs stay inside the VIP tier (50000-50010)', () => {
  it('allows the first step inside the segment (50000 -> 50001)', () => {
    const s = createNewGame(1);
    s.currentFloor = 50000;
    expect(tryChangeFloor(s, 1)).toEqual({ ok: true, from: 50000, to: 50001 });
    expect(s.currentFloor).toBe(50001);
  });

  it('refuses to climb from 50010 into the unexplored 50011..99999 gap', () => {
    const s = createNewGame(1);
    s.currentFloor = 50010;
    expect(tryChangeFloor(s, 1)).toEqual({ ok: false, reason: 'top' });
    expect(s.currentFloor).toBe(50010);
    // The gap above is still real, and the stairs still refuse: the only way
    // across is the freight lift. The summit used to be unauthored (a dev alias
    // onto floor 1), so the lift refused as well; with the finale authored
    // (AG-16) the ride completes — see the liftOutcome tests in
    // segments.test.ts.
    expect(segmentOf(50011)).toBeUndefined();
    expect(hasFloorContent(100000)).toBe(true);
  });

  it('refuses to descend from 50000 into the unexplored 10011..49999 gap', () => {
    const s = createNewGame(1);
    s.currentFloor = 50000;
    expect(tryChangeFloor(s, -1)).toEqual({ ok: false, reason: 'bottom' });
    expect(s.currentFloor).toBe(50000);
    // 10010 below is authored and playable — the trap is the same one the
    // lower tiers set: the rule is never "the target is in the list".
    expect(PLAYABLE_FLOORS_V01).toContain(10010);
    expect(hasFloorContent(10010)).toBe(true);
  });

  it('walks the whole VIP tier up to 50010 and back to 50000', () => {
    const s = createNewGame(1);
    s.currentFloor = 50000;
    for (let f = 50000; f < 50010; f++) expect(tryChangeFloor(s, 1).ok).toBe(true);
    expect(s.currentFloor).toBe(50010);
    for (let f = 50010; f > 50000; f--) expect(tryChangeFloor(s, -1).ok).toBe(true);
    expect(s.currentFloor).toBe(50000);
  });

  it('gives 50000 an up exit but no down exit, and 50010 the reverse', () => {
    expect(hasUpExit(50000)).toBe(true);
    expect(hasDownExit(50000)).toBe(false);
    expect(hasUpExit(50010)).toBe(false);
    expect(hasDownExit(50010)).toBe(true);
  });

  it('puts the freight lift at the segment ends: down at 50000, up at 50010', () => {
    expect(liftDirection(50000)).toBe('down');
    expect(liftDirection(50010)).toBe('up');
  });

  it('gates the lift out of 50010 on the pass the segment above requires', () => {
    // The lift out of a segment top carries the NEXT segment's pass: out of
    // 50010 that is the 统治核心's core_key, not the vip_card that entered
    // segment 5.
    expect(liftRequirement(50010)).toBe('core_key');
    expect(liftRequirement(10010)).toBe('vip_card');
  });

  it('lays no stair traversal across the segment boundaries', () => {
    const s = createNewGame(1);
    s.currentFloor = 50010;
    expect(stairTraversalFor(s, 1)).toBeNull();
    s.currentFloor = 50000;
    expect(stairTraversalFor(s, -1)).toBeNull();
  });
});

describe('exit availability', () => {
  it('the bottom floor has no down exit; the top has no up exit', () => {
    const top = Math.max(...PLAYABLE_FLOORS_V01);
    expect(hasDownExit(1)).toBe(false);
    expect(hasUpExit(1)).toBe(true);
    expect(hasUpExit(top)).toBe(false);
    // 塔顶 100000 是单层段（段 6 只有一层）：向下的楼梯同样没有——从统治
    // 核心回富人区走货梯，不是楼梯（liftDirection 见下面的电梯断言）。
    expect(hasDownExit(top)).toBe(false);
    expect(liftDirection(top)).toBe('down');
  });
});

// M1-4: the refusal copy at a segment end. The scene tells the player the
// stairs stop here and the freight lift is the way on — but only where a lift
// actually stands. This is the contract the scene's copy keys off: a refused
// boundary MUST carry a lift in the refused direction, and the genuine tower
// extremes must NOT (there the honest copy is 已到顶层 / 已到尽头).
describe('segment boundaries refuse with a lift to name', () => {
  it('refuses 10->100, 1000->999, 10000->9999 and 50000->49999', () => {
    const s = createNewGame(1);
    for (const [floor, dir] of [
      [10, 1],
      [110, 1],
      [1010, 1],
      [10010, 1],
      [50010, 1],
      [100, -1],
      [1000, -1],
      [10000, -1],
      [50000, -1],
    ] as const) {
      s.currentFloor = floor;
      expect(tryChangeFloor(s, dir).ok, `floor ${floor} dir ${dir}`).toBe(false);
      expect(s.currentFloor).toBe(floor);
    }
  });

  it('every refused segment boundary has a lift in the refused direction', () => {
    // The scene's refusal names the 货运电梯 only when one is standing there;
    // this loop is what keeps that copy honest across all five segments.
    for (const floor of [10, 110, 1010, 10010, 50010]) {
      expect(hasUpExit(floor), `no up stair at ${floor}`).toBe(false);
      expect(liftDirection(floor), `up lift at ${floor}`).toBe('up');
    }
    for (const floor of [100, 1000, 10000, 50000]) {
      expect(hasDownExit(floor), `no down stair at ${floor}`).toBe(false);
      expect(liftDirection(floor), `down lift at ${floor}`).toBe('down');
    }
  });

  it('the tower extremes have no lift to name, so 已到顶层/已到尽头 is honest there', () => {
    // Below the dorm there is nothing at all.
    expect(hasDownExit(1)).toBe(false);
    expect(liftDirection(1)).toBeNull();
    // The summit 100000 is where the last lift ends: segment 6 is a single
    // floor, so its only lift points DOWN — an up-refusal there cannot name a
    // lift and 已到顶层 is true.
    expect(hasUpExit(100000)).toBe(false);
    expect(liftDirection(100000)).toBe('down');
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
    const downX = downExitXFor(2); // tier1 也 seeded 随机，不再钉 1240 常量
    expect(traversal).toMatchObject({ startX: downX, endX: downX, from: 2, to: 1 });
    completeStairTraversal(state, traversal!);
    expect(state.currentFloor).toBe(1);
    expect(state.player.x).toBe(downX);
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
    s.player.x = downExitXFor(3); // 3 层下行口已随机到 792，不再是 1240
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

// M1-4: the mouth is positional, the stair is not. A segment's end floor keeps
// the mouth and loses the stair, and the player standing there pressing E must
// reach changeFloor's refusal — which names the freight lift — instead of
// getting silence. The climber who lands on a segment top stands AT the mouth
// by construction, so this is the very next key they press.
describe('stairMouthZone', () => {
  it('reports the mouth where no stair stands (segment ends)', () => {
    const s = createNewGame(1);
    for (const floor of [10, 110, 1010, 10010, 50010]) {
      s.currentFloor = floor;
      s.player.x = UP_EXIT_X;
      expect(hasUpExit(floor), `no up stair at ${floor}`).toBe(false);
      expect(currentInteractionZone(s), `no stair zone at ${floor}`).toBeNull();
      expect(stairMouthZone(s), `but the mouth is there at ${floor}`).toBe('up');
    }
    for (const floor of [100, 1000, 10000, 50000]) {
      s.currentFloor = floor;
      s.player.x = downExitXFor(floor);
      expect(hasDownExit(floor), `no down stair at ${floor}`).toBe(false);
      expect(currentInteractionZone(s), `no stair zone at ${floor}`).toBeNull();
      expect(stairMouthZone(s), `but the mouth is there at ${floor}`).toBe('down');
    }
  });

  it('agrees with currentInteractionZone wherever a stair does stand', () => {
    const s = createNewGame(1);
    const floors = [1, 2, 5, 9, 100, 105, 109, 1000, 1005, 1009, 10000, 10005, 10009, 50000, 50005, 50009];
    for (const floor of floors) {
      s.currentFloor = floor;
      if (hasUpExit(floor)) {
        s.player.x = UP_EXIT_X;
        expect(stairMouthZone(s), `up mouth at ${floor}`).toBe(currentInteractionZone(s));
        expect(stairMouthZone(s)).toBe('up');
      }
      if (hasDownExit(floor)) {
        s.player.x = downExitXFor(floor);
        expect(stairMouthZone(s), `down mouth at ${floor}`).toBe(currentInteractionZone(s));
        expect(stairMouthZone(s)).toBe('down');
      }
    }
  });

  it('reports nothing in the middle of the corridor', () => {
    const s = createNewGame(1);
    s.currentFloor = 10;
    s.player.x = ENTRY_X;
    expect(stairMouthZone(s)).toBeNull();
  });
});
