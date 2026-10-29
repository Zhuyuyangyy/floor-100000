import { describe, expect, it } from 'vitest';

import { bakedTextures } from './bakeProbe';
import {
  FRAME_H,
  FRAME_W,
  IDLE_FRAMES,
  SHIN,
  THIGH,
  WALK_FRAMES,
  joint,
  makeCanvas,
  drawPose,
  idlePose,
  solveKnee,
  walkPose,
  PLAYER_COLORS,
  WALK_CHARACTERS,
  walkSheetKey,
  type PixelCanvas,
  type Pose,
} from '../render/walkcycle';

// The corridor's characters are drawn facing the camera, so the only thing that
// moves when the player walks is the x coordinate — a card sliding across a
// backdrop. These are the invariants that make a side-view walk cycle actually
// walk: the feet land on the ground, the cycle is symmetric so it does not limp,
// and the body bob has the two dips a real stride has.

describe('joint', () => {
  it('hangs straight down at angle zero', () => {
    const p = joint({ x: 32, y: 10 }, 20, 0);
    expect(p.x).toBeCloseTo(32, 10);
    expect(p.y).toBeCloseTo(30, 10);
  });

  it('reaches straight forward at ninety degrees', () => {
    const p = joint({ x: 32, y: 10 }, 20, 90);
    expect(p.x).toBeCloseTo(52, 10);
    expect(p.y).toBeCloseTo(10, 10);
  });

  it('reaches backward at a negative angle', () => {
    const p = joint({ x: 32, y: 10 }, 20, -90);
    expect(p.x).toBeCloseTo(12, 10);
    expect(p.y).toBeCloseTo(10, 10);
  });
});

describe('solveKnee', () => {
  // A target within the 37px the bones can span. Picking one by hand is how this
  // test ended up asserting on a clamped, unreachable pose twice.
  const hip = { x: 32, y: 52 };
  const ankle = { x: 24, y: 82 };

  it('places the knee so both bone lengths are honoured exactly', () => {
    // This is the whole reason the walk cycle is IK-driven: the foot lands where
    // it is told to, and the bones never stretch.
    const knee = solveKnee(hip, ankle, THIGH, SHIN, 1);
    expect(Math.hypot(knee.x - hip.x, knee.y - hip.y)).toBeCloseTo(THIGH, 6);
    expect(Math.hypot(knee.x - ankle.x, knee.y - ankle.y)).toBeCloseTo(SHIN, 6);
  });

  it('bends the knee forward or backward depending on the sign', () => {
    // A human knee only bends one way; the two solutions are the two branches of
    // the same triangle, and picking the wrong one gives a bird's leg.
    const forward = solveKnee(hip, ankle, THIGH, SHIN, 1);
    const backward = solveKnee(hip, ankle, THIGH, SHIN, -1);
    expect(forward.x).not.toBeCloseTo(backward.x, 6);
  });

  it('keeps the leg straight when the target is at full reach', () => {
    const hip = { x: 32, y: 52 };
    const ankle = { x: 32, y: 52 + THIGH + SHIN };
    const knee = solveKnee(hip, ankle, THIGH, SHIN, 1);
    expect(knee.x).toBeCloseTo(32, 6);
    expect(knee.y).toBeCloseTo(52 + THIGH, 6);
  });

  it('refuses a target the leg cannot reach instead of stretching to it', () => {
    // Clamped to full reach: a foot placed beyond the bones would silently
    // produce a leg longer than the character is tall.
    const hip = { x: 32, y: 52 };
    const ankle = { x: 32 + 500, y: 94 };
    const knee = solveKnee(hip, ankle, THIGH, SHIN, 1);
    expect(Math.hypot(knee.x - hip.x, knee.y - hip.y)).toBeCloseTo(THIGH, 6);
  });
});

describe('walkPose', () => {
  it('plants the leading foot exactly on the ground at contact', () => {
    // The invariant the whole IK approach exists for. If this drifts the
    // character skates or sinks, and no amount of frame tuning fixes it.
    for (const f of [0, 3]) {
      const pose = walkPose(f);
      const ankle = footPosition(pose);
      expect(ankle.y, `frame ${f} leading foot`).toBeCloseTo(FOOT_GROUND, 6);
    }
  });

  it('never lets a foot sink below the ground in any frame', () => {
    for (let f = 0; f < WALK_FRAMES; f++) {
      for (const a of bothFeet(walkPose(f))) {
        expect(a.y, `frame ${f} foot at y=${a.y.toFixed(2)}`).toBeLessThanOrEqual(FOOT_GROUND + 0.001);
      }
    }
  });

  it('lifts a foot clear of the ground while passing', () => {
    // A walk cycle where both feet stay planted is a shuffle, not a walk.
    const lifted = bothFeet(walkPose(2)).map((a) => FOOT_GROUND - a.y);
    expect(Math.max(...lifted)).toBeGreaterThan(2);
  });

  it('is symmetric: frame f and f+3 swap the legs', () => {
    // A cycle that fails this visibly limps — one leg doing all the work.
    for (let f = 0; f < 3; f++) {
      const a = walkPose(f);
      const b = walkPose(f + 3);
      expect(b.a.thigh).toBeCloseTo(a.b.thigh, 6);
      expect(b.a.knee).toBeCloseTo(a.b.knee, 6);
      expect(b.b.thigh).toBeCloseTo(a.a.thigh, 6);
      expect(b.b.knee).toBeCloseTo(a.a.knee, 6);
    }
  });

  it('dips the body exactly twice per cycle', () => {
    // Lowest at contact, highest as the legs pass under the body. Two contacts
    // per cycle is what a stride is.
    const heights = Array.from({ length: WALK_FRAMES }, (_, f) => walkPose(f).hipY);
    let minima = 0;
    for (let i = 0; i < heights.length; i++) {
      const prev = heights[(i - 1 + heights.length) % heights.length];
      const next = heights[(i + 1) % heights.length];
      if (heights[i] > prev && heights[i] >= next) minima++;
    }
    expect(minima, `heights ${heights.map((h) => h.toFixed(1)).join(',')}`).toBe(2);
  });

  it('keeps every joint inside the frame canvas', () => {
    for (let f = 0; f < WALK_FRAMES; f++) {
      const pose = walkPose(f);
      for (const p of [pose.hip, pose.shoulder, pose.head, ...bothFeet(pose)]) {
        expect(p.x, `frame ${f} x=${p.x.toFixed(1)}`).toBeGreaterThanOrEqual(0);
        expect(p.x, `frame ${f} x=${p.x.toFixed(1)}`).toBeLessThanOrEqual(FRAME_W);
        expect(p.y, `frame ${f} y=${p.y.toFixed(1)}`).toBeGreaterThanOrEqual(0);
        expect(p.y, `frame ${f} y=${p.y.toFixed(1)}`).toBeLessThanOrEqual(FRAME_H);
      }
    }
  });
});

describe('idlePose', () => {
  it('stands with both feet on the ground', () => {
    for (let f = 0; f < IDLE_FRAMES; f++) {
      for (const a of bothFeet(idlePose(f))) {
        expect(a.y, `idle frame ${f}`).toBeCloseTo(FOOT_GROUND, 6);
      }
    }
  });

  it('breathes rather than freezing', () => {
    // Two frames that differ, or the idle is a still image.
    const a = idlePose(0);
    const b = idlePose(1);
    expect(Math.abs(a.hipY - b.hipY) + Math.abs(a.shoulder.y - b.shoulder.y)).toBeGreaterThan(0);
  });
});

describe('drawPose', () => {
  it('draws a silhouette in every walk frame', () => {
    // The failure this catches is a frame that renders nothing at all — which
    // looks like a flicker in the animation and is invisible in a contact sheet
    // unless you count the pixels.
    for (let f = 0; f < WALK_FRAMES; f++) {
      const cv = makeCanvas(FRAME_W, FRAME_H);
      drawPose(cv, walkPose(f), PLAYER_COLORS);
      const opaque = countOpaque(cv);
      expect(opaque, `frame ${f} drew ${opaque} px`).toBeGreaterThan(200);
    }
  });

  it('keeps the silhouette inside the canvas', () => {
    for (let f = 0; f < WALK_FRAMES; f++) {
      const cv = makeCanvas(FRAME_W, FRAME_H);
      drawPose(cv, walkPose(f), PLAYER_COLORS);
      const box = boundingBox(cv);
      expect(box.minX, `frame ${f} left`).toBeGreaterThanOrEqual(0);
      expect(box.maxX, `frame ${f} right`).toBeLessThan(FRAME_W);
      expect(box.maxY, `frame ${f} bottom`).toBeLessThan(FRAME_H);
      // The feet have to reach the bottom rows or the character floats.
      expect(box.maxY, `frame ${f} feet`).toBeGreaterThanOrEqual(FRAME_H - 4);
    }
  });

  it('uses a small palette, because pixel art is not 80k colours of noise', () => {
    const cv = makeCanvas(FRAME_W, FRAME_H);
    drawPose(cv, walkPose(0), PLAYER_COLORS);
    expect(distinctColours(cv).size).toBeLessThanOrEqual(24);
  });

  it('moves pixels between frames', () => {
    // Two identical frames side by side are a wasted frame in the sheet.
    const a = makeCanvas(FRAME_W, FRAME_H);
    const b = makeCanvas(FRAME_W, FRAME_H);
    drawPose(a, walkPose(0), PLAYER_COLORS);
    drawPose(b, walkPose(3), PLAYER_COLORS);
    expect(differs(a, b)).toBeGreaterThan(100);
  });
});

describe('sheet geometry', () => {
  it('declares one canvas size shared by every frame', () => {
    expect(FRAME_W).toBeGreaterThan(0);
    expect(FRAME_H).toBeGreaterThan(FRAME_W);
  });

  it('gives the walk cycle an even number of contacts', () => {
    // Six frames: contact, down, pass, contact, down, pass. An odd count would
    // leave one leg doing all the work when the animation loops.
    expect(WALK_FRAMES % 2).toBe(0);
    expect(WALK_FRAMES).toBeGreaterThanOrEqual(4);
  });

  it('has more than one idle frame', () => {
    expect(IDLE_FRAMES).toBeGreaterThanOrEqual(2);
  });

  it('bakes one sheet per character, a column wide per frame', () => {
    // generateFrameNumbers() slices the sheet on exactly this layout, so a sheet
    // that is one frame short silently drops the last pose and a sheet that is
    // too wide plays blank frames at the end.
    const baked = new Map(bakedTextures().map((t) => [t.key, t]));
    for (const who of WALK_CHARACTERS) {
      const t = baked.get(walkSheetKey(who));
      expect(t, `no sheet baked for ${who}`).toBeDefined();
      expect(t!.width, `${who} sheet width`).toBe(FRAME_W * (WALK_FRAMES + IDLE_FRAMES));
      expect(t!.height, `${who} sheet height`).toBe(FRAME_H);
    }
  });
});

// ── helpers ───────────────────────────────────────────────────────────────

const FOOT_GROUND = 94; // the ankle row at contact; the boot fills the last row

function ankleOf(pose: Pose, leg: 'a' | 'b'): { x: number; y: number } {
  const l = pose[leg];
  const knee = joint(pose.hip, THIGH, l.thigh);
  return joint(knee, SHIN, l.thigh - l.knee);
}

function footPosition(pose: Pose): { x: number; y: number } {
  // The leading foot is the one further in the direction of travel.
  const a = ankleOf(pose, 'a');
  const b = ankleOf(pose, 'b');
  return a.x >= b.x ? a : b;
}

function bothFeet(pose: Pose): Array<{ x: number; y: number }> {
  return [ankleOf(pose, 'a'), ankleOf(pose, 'b')];
}

function countOpaque(cv: PixelCanvas): number {
  let n = 0;
  for (let i = 3; i < cv.px.length; i += 4) if (cv.px[i] > 0) n++;
  return n;
}

function boundingBox(cv: PixelCanvas) {
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < cv.h; y++) {
    for (let x = 0; x < cv.w; x++) {
      if (cv.px[(y * cv.w + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, maxX, maxY };
}

function distinctColours(cv: PixelCanvas): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < cv.px.length; i += 4) {
    if (cv.px[i + 3] === 0) continue;
    out.add((cv.px[i] << 16) | (cv.px[i + 1] << 8) | cv.px[i + 2]);
  }
  return out;
}

function differs(a: PixelCanvas, b: PixelCanvas): number {
  let n = 0;
  for (let i = 0; i < a.px.length; i += 4) {
    if (a.px[i + 3] !== b.px[i + 3]) n++;
    else if (a.px[i + 3] > 0 && (a.px[i] !== b.px[i] || a.px[i + 1] !== b.px[i + 1] || a.px[i + 2] !== b.px[i + 2])) n++;
  }
  return n;
}
