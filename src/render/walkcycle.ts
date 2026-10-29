// Type-only: the pose/drawing half of this module is pure geometry over a
// PixelCanvas and must stay runnable in Node (tools/bake-walk.ts, unit tests),
// so importing the Phaser runtime here would break both.
import type Phaser from 'phaser';

import type { CharacterKey } from './artpack';
// A side-view walk cycle for the corridor's characters.
//
// Every character in this game was drawn facing the camera. In a side-scroller
// that is the wrong axis: a figure seen face-on while it moves laterally reads as
// a card sliding across the backdrop, which is exactly what the corridor looked
// like. There is no turn to play and no amount of speed tuning fixes it.
//
// So this draws the same cast from the side, with legs that actually articulate.
// The poses are IK-driven rather than hand-tuned angles: each frame names where
// the feet are, and solveKnee() works backwards to a knee position that honours
// both bone lengths. That makes "the foot is on the ground" a property of the
// construction instead of a number someone has to keep re-tuning.
//
// Everything here is pure and runs in Node, so the geometry is unit-testable;
// pixelArt.ts bakes the result into sprite sheets at boot.

// ── frame geometry ────────────────────────────────────────────────────────
export const FRAME_W = 64;
export const FRAME_H = 96;
export const WALK_FRAMES = 6;
export const IDLE_FRAMES = 2;

// The ankle row when a foot is planted. The boot fills the last row of the
// frame, so a foot here means the character is standing on the floor line.
export const FOOT_GROUND = 94;

// Bone lengths. Thigh + shin = 37 and the standing hip sits 37 above the ground,
// so a straight leg reaches the floor exactly — which is what makes the contact
// pose land on it without any fudge factor.
//
// The proportions are deliberately slightly chibi: head 22, torso 30, legs 37.
// Anatomical proportions at this canvas size read as a stick figure with clothes
// on, because a 64px-wide sprite cannot carry the detail that sells realism. A
// bigger head and a longer torso carry a face and a jacket instead.
const THIGH = 19;
const SHIN = 18;
const LEG = THIGH + SHIN;
// Exported so a test can re-derive the ankle from the same bone lengths rather
// than keeping its own copy — a second pair of constants that drifts is how the
// feet end up off the ground with every geometry test still green.
export { THIGH, SHIN };
const TORSO = 30;
const HEAD_R = 11;

// The hip's height when the stance leg is vertical. Everything else in the walk
// is derived from this: at contact the leg is spread, so the hip has to drop.
const HIP_Y_PASS = FOOT_GROUND - LEG;

// How far ahead of the hip the leading foot lands at contact. A human stride is
// roughly 0.4x leg length; 14px against a 37px leg is that.
const STRIDE = 16;

export interface Point {
  x: number;
  y: number;
}

export interface LegPose {
  /** degrees from straight down; positive swings the thigh forward (+x) */
  thigh: number;
  /** degrees the shin turns back relative to the thigh; a knee only bends one way */
  knee: number;
}

export interface Pose {
  hip: Point;
  shoulder: Point;
  head: Point;
  /** the two legs, as bone angles. The ankle is derived, never stored. */
  a: LegPose;
  b: LegPose;
  /** which leg is drawn in front — the one further along in the stride */
  near: 'a' | 'b';
  /** near-arm angle in degrees; the far arm swings the opposite way */
  armSwing: number;
  /** exposed so a test can read the bob without re-deriving it */
  hipY: number;
}

// ── geometry ──────────────────────────────────────────────────────────────

// A point `length` away from `origin`, `angleDeg` measured from straight down
// (0 = hanging, 90 = straight forward).
export function joint(origin: Point, length: number, angleDeg: number): Point {
  const a = (angleDeg * Math.PI) / 180;
  return { x: origin.x + length * Math.sin(a), y: origin.y + length * Math.cos(a) };
}

// Two-bone IK: where the knee goes so the ankle lands on `target`.
//
// `bendSign` picks which of the two mirror solutions to use — +1 bends the knee
// forward (a human knee), -1 backward (a bird's). A target further away than the
// bones can reach is clamped to full extension rather than stretched to, so a
// badly placed foot produces a straight leg instead of a longer character.
export function solveKnee(hip: Point, target: Point, thigh: number, shin: number, bendSign: 1 | -1): Point {
  const dx = target.x - hip.x;
  const dy = target.y - hip.y;
  const raw = Math.hypot(dx, dy);
  const d = Math.min(raw, thigh + shin);
  // Guard the degenerate case: hip and target coincident leaves no direction.
  const ux = raw === 0 ? 0 : dx / raw;
  const uy = raw === 0 ? 1 : dy / raw;
  const base = (Math.atan2(ux, uy) * 180) / Math.PI;
  const cosA = Math.min(1, Math.max(-1, (thigh * thigh + d * d - shin * shin) / (2 * thigh * d)));
  const a = (Math.acos(cosA) * 180) / Math.PI;
  return joint(hip, thigh, base + bendSign * a);
}

// The bone angles that put a foot on `target`. Returns null when the target is
// unreachable even at full extension, which callers treat as a hard error rather
// than silently stretching the leg.
function legTo(hip: Point, target: Point): LegPose | null {
  const dx = target.x - hip.x;
  const dy = target.y - hip.y;
  const raw = Math.hypot(dx, dy);
  if (raw > LEG + 0.001) return null;
  const d = Math.min(raw, LEG);
  const base = (Math.atan2(dx, dy) * 180) / Math.PI;
  const cosA = Math.min(1, Math.max(-1, (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d)));
  const a = (Math.acos(cosA) * 180) / Math.PI;
  return { thigh: base + a, knee: 2 * a };
}

// ── the cycle ─────────────────────────────────────────────────────────────
// Six frames: contact, mid, pass, contact, mid, pass. The second half is the
// first half with the legs swapped, which is the invariant that stops the cycle
// limping — one leg doing all the work is the classic broken walk.
//
// Each entry is [hipY, footA, footB] where the feet are offsets from the hip's
// x. The hip's y is what the geometry forces, not a chosen bob: at contact the
// leg is spread so the hip drops, and as the stance leg comes upright the hip
// rises. That is why the bob is ~3px here rather than the 2px the old artificial
// bob used — it is the real one.

const HIP_X = FRAME_W / 2;

const CYCLE: ReadonlyArray<{ hipY: number; a: Point; b: Point }> = [
  // contact: A forward and planted, B behind and lifting off
  { hipY: FOOT_GROUND - Math.sqrt(LEG * LEG - STRIDE * STRIDE), a: { x: STRIDE, y: FOOT_GROUND }, b: { x: -10, y: 90 } },
  // mid: A planted and coming upright, B swinging under the body
  { hipY: FOOT_GROUND - Math.sqrt(LEG * LEG - 64), a: { x: 8, y: FOOT_GROUND }, b: { x: -2, y: 88 } },
  // pass: A vertical and planted (hip at its highest), B swung forward and lifted
  { hipY: HIP_Y_PASS, a: { x: 0, y: FOOT_GROUND }, b: { x: 11, y: 84 } },
];

function poseFrom(step: { hipY: number; a: Point; b: Point }, swap: boolean): Pose {
  const hip: Point = { x: HIP_X, y: step.hipY };
  const footA: Point = { x: HIP_X + step.a.x, y: step.a.y };
  const footB: Point = { x: HIP_X + step.b.x, y: step.b.y };
  const legA = legTo(hip, footA);
  const legB = legTo(hip, footB);
  if (!legA || !legB) throw new Error('walk cycle frame is unreachable by the skeleton');

  const shoulder: Point = { x: HIP_X, y: hip.y - TORSO };
  // The head leads the shoulders slightly — a body travelling right leans into it.
  const head: Point = { x: HIP_X + 2, y: shoulder.y - HEAD_R - 1 };

  const forward = footA.x >= footB.x ? 'a' : 'b';
  const swing = ((footA.x - HIP_X) / STRIDE) * 22;

  const pose: Pose = {
    hip,
    shoulder,
    head,
    a: legA,
    b: legB,
    near: forward,
    armSwing: -swing,
    hipY: hip.y,
  };
  return swap ? swapLegs(pose) : pose;
}

function swapLegs(p: Pose): Pose {
  return { ...p, a: p.b, b: p.a, near: p.near === 'a' ? 'b' : 'a', armSwing: -p.armSwing };
}

export function walkPose(frame: number): Pose {
  const f = ((frame % WALK_FRAMES) + WALK_FRAMES) % WALK_FRAMES;
  return poseFrom(CYCLE[f % 3], f >= 3);
}

// Two frames of breathing. The feet are planted a stance apart rather than
// under one point: two legs drawn at the same x are one wide leg, and a stance
// is also what a standing person actually does. The hip sits exactly as high
// as the geometry allows for that stance, so the legs stay honest.
const IDLE_STANCE = 5;
const IDLE_HIP_Y = FOOT_GROUND - Math.sqrt(LEG * LEG - IDLE_STANCE * IDLE_STANCE);

export function idlePose(frame: number): Pose {
  const f = ((frame % IDLE_FRAMES) + IDLE_FRAMES) % IDLE_FRAMES;
  // The breath is a shoulder and head motion — the feet are planted, so the
  // hips stay put. Two frames that differ, or the idle is a still image.
  const lift = f === 0 ? 0 : 2;
  const hip: Point = { x: HIP_X, y: IDLE_HIP_Y };
  const legA = legTo(hip, { x: HIP_X - IDLE_STANCE, y: FOOT_GROUND });
  const legB = legTo(hip, { x: HIP_X + IDLE_STANCE, y: FOOT_GROUND });
  if (!legA || !legB) throw new Error('idle pose is unreachable by the skeleton');
  const shoulder: Point = { x: HIP_X, y: hip.y - 26 - lift };
  return {
    hip,
    shoulder,
    head: { x: HIP_X + 2, y: shoulder.y - HEAD_R - 1 },
    a: legA,
    b: legB,
    near: 'a',
    armSwing: 0,
    hipY: hip.y,
  };
}

// ── palette ───────────────────────────────────────────────────────────────
// The project palette from 05_ART_GUIDE.md §2, as the build-characters.mjs set
// already laid it out. One triplet of clothing colours per character so the four
// figures stay distinguishable without any of them being a repaint of another.
export interface CharacterColors {
  outline: RGB;
  cloth: RGB;
  clothDark: RGB;
  clothLight: RGB;
  trouser: RGB;
  trouserDark: RGB;
  boot: RGB;
  skin: RGB;
  skinDark: RGB;
  hair: RGB;
  pack: RGB;
  packDark: RGB;
}
type RGB = [number, number, number];

export const PLAYER_COLORS: CharacterColors = {
  outline: [0x0e, 0x14, 0x18],
  cloth: [0x77, 0xc6, 0xa4],
  clothDark: [0x4e, 0x8f, 0x78],
  clothLight: [0xa8, 0xdc, 0xc4],
  trouser: [0x6a, 0x60, 0x4c],
  trouserDark: [0x46, 0x3f, 0x33],
  boot: [0x18, 0x24, 0x2c],
  skin: [0xd9, 0xb4, 0x8f],
  skinDark: [0xb5, 0x8a, 0x67],
  hair: [0x24, 0x2a, 0x30],
  pack: [0x5a, 0x4a, 0x38],
  packDark: [0x3a, 0x30, 0x24],
};

// The other three share the skeleton and differ only in palette, the way
// build-characters.mjs already did — so the four figures stay distinguishable
// without any of them being a repaint of another.
export const ALIN_COLORS: CharacterColors = {
  ...PLAYER_COLORS,
  cloth: [0x5a, 0x8a, 0xb5],
  clothDark: [0x3e, 0x64, 0x89],
  clothLight: [0x8a, 0xb0, 0xd4],
  hair: [0x1a, 0x1e, 0x26],
};

export const XIAOZHOU_COLORS: CharacterColors = {
  ...PLAYER_COLORS,
  cloth: [0xb5, 0x85, 0x5a],
  clothDark: [0x8a, 0x62, 0x42],
  clothLight: [0xd4, 0xa8, 0x7e],
  hair: [0x2e, 0x22, 0x18],
};

// The night threat is not a person, so it gets no skin: the husk palette is dark
// enough that the silhouette reads as a shape moving in the dark rather than a
// second survivor with different clothes.
export const WANDERER_COLORS: CharacterColors = {
  ...PLAYER_COLORS,
  cloth: [0x3a, 0x1e, 0x24],
  clothDark: [0x24, 0x12, 0x1a],
  clothLight: [0x5a, 0x30, 0x38],
  trouser: [0x2a, 0x16, 0x1c],
  trouserDark: [0x1a, 0x0e, 0x12],
  skin: [0x4a, 0x28, 0x2e],
  skinDark: [0x30, 0x1a, 0x20],
  hair: [0x18, 0x0c, 0x10],
  pack: [0x24, 0x12, 0x1a],
  packDark: [0x14, 0x0a, 0x0e],
};

// ── pixel canvas ──────────────────────────────────────────────────────────
export interface PixelCanvas {
  w: number;
  h: number;
  px: Uint8Array;
  set(x: number, y: number, c: RGB): void;
}

export function makeCanvas(w: number, h: number): PixelCanvas {
  const px = new Uint8Array(w * h * 4);
  return {
    w,
    h,
    px,
    set(x, y, c) {
      const ix = Math.round(x);
      const iy = Math.round(y);
      if (ix < 0 || ix >= w || iy < 0 || iy >= h) return;
      const o = (iy * w + ix) * 4;
      px[o] = c[0];
      px[o + 1] = c[1];
      px[o + 2] = c[2];
      px[o + 3] = 255;
    },
  };
}

// ── hand-placed rasterisation ───────────────────────────────────────────────
//
// The first version of this file drew limbs as capsules: for every pixel near
// a bone segment, fill if inside halfWidth, outline if near the edge. The
// result was a smooth tube person — round at every joint, uniform at every
// width. At 64×96 that reads as a blob with clothes, because a capsule has no
// decisions in it: no pixel was chosen, they were all just "inside the
// distance field".
//
// Pixel art at this size is placed, not sampled: every row of a limb is a
// solid horizontal run with hard ends, widths change in whole pixels where
// they should, and one dark silhouette outline ties the figure together. So
// the rasteriser below works row by row:
//
//   - taperedLimb() walks a bone's scanlines and lays one run per row, width
//     interpolating between two whole-pixel values (thigh 7→5, shin 5→4). A
//     diagonal bone stair-steps, which is what a hand-drawn diagonal looks
//     like.
//   - boot() is an explicit foot shape: a block at the ankle plus a toe run
//     pointing where the shin points, so a planted foot sits flat on the
//     floor line and a swinging one reads as a toe.
//   - drawTorso()/drawHead() use authored width tables (shoulder shelf,
//     waist, hem flare; skull, fringe, chin) instead of per-pixel shape tests.
//   - outlinePass() runs last: any transparent pixel touching the figure
//     takes the outline colour, so the whole silhouette carries one dark edge
//     and occluded parts need no edge of their own.
//
// Frame structure (6-frame run + 2-frame idle, contact/mid/pass, asymmetric
// idle timing) follows the conventions of shipped side-view cycles. The poses
// still come from the IK above; only the rasterisation is hand-placed here.

/** One horizontal run of pixels with hard ends. */
function run(cv: PixelCanvas, xc: number, halfW: number, y: number, fill: RGB): void {
  const x0 = Math.round(xc - halfW);
  const x1 = Math.round(xc + halfW);
  for (let x = x0; x <= x1; x++) cv.set(x, y, fill);
}

/** One run per scanline of the bone, width interpolating w0→w1. */
function taperedLimb(cv: PixelCanvas, a: Point, b: Point, w0: number, w1: number, fill: RGB): void {
  const y0 = Math.round(Math.min(a.y, b.y));
  const y1 = Math.round(Math.max(a.y, b.y));
  const dy = b.y - a.y;
  for (let y = y0; y <= y1; y++) {
    const t = dy === 0 ? 0.5 : (y - a.y) / dy;
    if (t < -0.02 || t > 1.02) continue;
    const cx = a.x + t * (b.x - a.x);
    run(cv, cx, (w0 + t * (w1 - w0)) / 2, y, fill);
  }
}

// The foot: a block at the ankle and a toe pointing where the shin points. A
// foot coming off the ground behind the body points back (pushing off); a foot
// under the body points forward — the facing direction.
function boot(cv: PixelCanvas, ankle: Point, knee: Point, col: CharacterColors): void {
  const toeDir = Math.abs(ankle.x - knee.x) < 2 ? 1 : Math.sign(ankle.x - knee.x);
  const bottom = Math.min(Math.round(ankle.y) + 1, FRAME_H - 1);
  for (let y = bottom - 4; y <= bottom; y++) {
    const last = y === bottom;
    run(cv, last ? ankle.x + toeDir * 1.5 : ankle.x, last ? 3 : 2.5, y, col.boot);
  }
  // A sole line so the foot does not read as a plain box.
  run(cv, ankle.x + toeDir * 1.5, 3, bottom, col.outline);
}

// One dark pixel around the whole figure: any transparent pixel touching an
// opaque one takes the outline colour. Doing this once at the end, instead of
// per part, is what makes the silhouette read as one object.
function outlinePass(cv: PixelCanvas, outline: RGB): void {
  const { w, h, px } = cv;
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = px[i * 4 + 3] > 0 ? 1 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (solid[i]) continue;
      const touches =
        (x > 0 && solid[i - 1]) ||
        (x < w - 1 && solid[i + 1]) ||
        (y > 0 && solid[i - w]) ||
        (y < h - 1 && solid[i + w]);
      if (!touches) continue;
      const o = i * 4;
      px[o] = outline[0];
      px[o + 1] = outline[1];
      px[o + 2] = outline[2];
      px[o + 3] = 255;
    }
  }
}

// Draws one pose into `cv`. `originX` is the frame's left edge, so a whole sheet
// can be filled by calling this once per column.
export function drawPose(cv: PixelCanvas, pose: Pose, col: CharacterColors, originX = 0): void {
  const at = (p: Point): Point => ({ x: p.x + originX, y: p.y });
  const local: Pose = { ...pose, hip: at(pose.hip), shoulder: at(pose.shoulder), head: at(pose.head) };

  drawPack(cv, local, col);
  // Far leg, then the far arm, then the torso, then the near leg and the near
  // arm — so the near leg overlaps the jacket and the near arm swings in front
  // of it, the way the real ones do.
  drawLeg(cv, local, local.near === 'a' ? 'b' : 'a', col, true);
  drawNeck(cv, local, col);
  drawArm(cv, local, col, -1);
  drawTorso(cv, local, col);
  drawLeg(cv, local, local.near, col, false);
  drawArm(cv, local, col, 1);
  drawHead(cv, local, col);
  outlinePass(cv, col.outline);
}

function drawLeg(cv: PixelCanvas, pose: Pose, which: 'a' | 'b', col: CharacterColors, far: boolean): void {
  const leg = pose[which];
  const knee = joint(pose.hip, THIGH, leg.thigh);
  const ankle = joint(knee, SHIN, leg.thigh - leg.knee);
  const trouser = far ? col.trouserDark : col.trouser;
  taperedLimb(cv, pose.hip, knee, 7, 5, trouser);
  taperedLimb(cv, knee, ankle, 5, 4, trouser);
  boot(cv, ankle, knee, col);
}

// The jacket, as an authored width table rather than a per-pixel shape test:
// a shoulder shelf, a waist, and a hem that flares back out. The profile leans
// a pixel into the direction of travel.
function drawTorso(cv: PixelCanvas, pose: Pose, col: CharacterColors): void {
  const top = Math.round(pose.shoulder.y);
  const bottom = Math.round(pose.hip.y);
  const span = Math.max(1, bottom - top);
  // [position down the torso, half-width]
  const PROFILE: ReadonlyArray<readonly [number, number]> = [
    [0, 8],
    [0.18, 9],
    [0.45, 7.5],
    [0.75, 7],
    [0.92, 8],
    [1, 7.5],
  ];
  for (let y = top; y <= bottom; y++) {
    const t = (y - top) / span;
    let half = 8;
    for (let i = 1; i < PROFILE.length; i++) {
      if (t <= PROFILE[i][0]) {
        const [t0, w0] = PROFILE[i - 1];
        const [t1, w1] = PROFILE[i];
        const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
        half = w0 + k * (w1 - w0);
        break;
      }
    }
    const cx = pose.shoulder.x + t * 1.5; // lean into the walk
    run(cv, cx, half, y, col.cloth);
    // One highlight column down the lit side, chest rows only — the outline
    // pass already edges the silhouette, so this is shaping, not bordering.
    if (t > 0.1 && t < 0.6) cv.set(Math.round(cx + half - 1), y, col.clothLight);
  }
  // Collar: two lighter rows across the shoulders.
  run(cv, pose.shoulder.x + 0.75, 5, top, col.clothLight);
  run(cv, pose.shoulder.x + 1.5, 5, top + 1, col.clothLight);
  // Hem: a darker band at the bottom of the jacket, and the zip line.
  run(cv, pose.shoulder.x + 1.5, 7.5, bottom, col.clothDark);
  run(cv, pose.shoulder.x + 1.5, 1, bottom - 3, col.clothDark);
}

// One arm. `sign` -1 is the far arm, +1 the near one: the far arm hangs behind
// the torso plane and is drawn before it, so it only shows when the swing
// carries it clear of the jacket; the near arm swings in front of it. That
// occlusion is what makes the swing read as depth rather than two stripes.
function drawArm(cv: PixelCanvas, pose: Pose, col: CharacterColors, sign: -1 | 1): void {
  const swing = pose.armSwing * sign;
  const shoulder = { x: pose.shoulder.x + (sign === 1 ? 1 : -5), y: pose.shoulder.y + 4 };
  const elbow = joint(shoulder, 12, swing);
  const hand = joint(elbow, 11, swing * 0.6);
  taperedLimb(cv, shoulder, elbow, 4.5, 3.5, sign === 1 ? col.cloth : col.clothDark);
  taperedLimb(cv, elbow, hand, 3.5, 3, sign === 1 ? col.skin : col.skinDark);
  // A fist, because a tapering point reads as a wire.
  const skin = sign === 1 ? col.skin : col.skinDark;
  run(cv, hand.x, 1.5, Math.round(hand.y), skin);
  run(cv, hand.x, 1.5, Math.round(hand.y) + 1, skin);
}

// The head in profile: an egg of a skull, hair over the back and top, and the
// face on the leading edge — brow, eye, nose, mouth, chin. The old
// circle-with-an-eye read as a ball; a profile reads as a person heading
// somewhere.
//
// Every row of the skull is listed with no vertical gaps: a hand-placed head
// is a solid shape, and the outline pass outlines the silhouette, not the
// holes between rows. The third column shifts a row forward — the face plane
// and the chin sit ahead of the skull's centre line.
function drawHead(cv: PixelCanvas, pose: Pose, col: CharacterColors): void {
  const cx = Math.round(pose.head.x);
  const cy = Math.round(pose.head.y);
  // [row offset, half-width, forward shift]
  const SKULL: ReadonlyArray<readonly [number, number, number]> = [
    [-10, 3.5, 0],
    [-9, 4.5, 0],
    [-8, 5, 0],
    [-7, 5.5, 0],
    [-6, 6, 0],
    [-5, 6, 0],
    [-4, 6, 0],
    [-3, 6, 0],
    [-2, 6, 0],
    [-1, 5.5, 0],
    [0, 5.5, 0.5],
    [1, 5, 0.5],
    [2, 4.5, 1],
    [3, 4, 1],
    [4, 3, 1],
    [5, 2.5, 1],
    [6, 2, 1],
    [7, 1.5, 0.5],
    [8, 1, 0],
  ];
  for (const [dy, half, dx] of SKULL) run(cv, cx + 1 + dx, half, cy + dy, col.skin);
  // Hair: a contiguous cap over the top and back of the skull.
  const HAIR: ReadonlyArray<readonly [number, number]> = [
    [-11, 4],
    [-10, 4.5],
    [-9, 5],
    [-8, 5.5],
    [-7, 6],
    [-6, 5.5],
  ];
  for (const [dy, half] of HAIR) run(cv, cx + dy <= -7 ? cx : cx + 0.5, half, cy + dy, col.hair);
  run(cv, cx + 4, 2, cy - 7, col.hair); // fringe at the front
  // Face on the leading edge.
  run(cv, cx + 4, 2, cy - 5, col.skinDark); // brow
  cv.set(cx + 5, cy - 3, col.outline); // eye
  cv.set(cx + 5, cy - 2, col.outline);
  run(cv, cx + 6, 1, cy - 1, col.skinDark); // nose
  cv.set(cx + 7, cy, col.skinDark);
  run(cv, cx + 4, 1.5, cy + 3, col.skinDark); // mouth
}

// A neck, drawn before the torso so the collar covers its bottom and the skull
// covers its top. Without it the head floats a pixel above the shoulders.
function drawNeck(cv: PixelCanvas, pose: Pose, col: CharacterColors): void {
  const y0 = Math.round(pose.shoulder.y) - 2;
  for (let y = y0; y <= y0 + 2; y++) run(cv, pose.shoulder.x + 1, 2.5, y, col.skinDark);
}

function drawPack(cv: PixelCanvas, pose: Pose, col: CharacterColors): void {
  // Behind everything: the pack is what makes the silhouette a survivor.
  const x = Math.round(pose.shoulder.x) - 13;
  const y = Math.round(pose.shoulder.y) - 1;
  for (let j = 0; j < 19; j++) {
    const w = j < 2 ? 15 : 13; // a lid, then the body
    run(cv, x + w / 2, w / 2, y + j, j < 2 ? col.pack : col.packDark);
  }
  run(cv, x + 1.5, 1.5, y + 2, col.pack); // strap highlight down the back
  run(cv, pose.shoulder.x - 3, 2, y - 1, col.packDark); // strap over the shoulder
}

// ── baking and animation ──────────────────────────────────────────────────

// The texture key and animation keys for one character's side-view sheet.
export function walkSheetKey(who: CharacterKey): string {
  return `char-${who}-walk`;
}

export function walkAnimKey(who: CharacterKey): string {
  return `walk-${who}`;
}

export function idleAnimKey(who: CharacterKey): string {
  return `idle-${who}`;
}

export const WALK_CHARACTERS: readonly CharacterKey[] = ['player', 'npc_alin', 'npc_xiaozhou', 'wanderer'];

// Frames per second for the walk playback. The scene scales timeScale by the
// player's actual speed, so this is the rate at top speed — 4Hz matches the
// stride the poses were built around, and it is what keeps the feet from
// skating when the player is only halfway up the ramp.
export const WALK_FRAME_RATE = 8;

// Bakes every character's frames into one horizontal sheet per character.
//
// A CanvasTexture rather than a Graphics: the poses are already pixel data, and
// putImageData moves them in one call where generateTexture would need tens of
// thousands of fillRects to say the same thing.
export function bakeWalkSheets(scene: Phaser.Scene): void {
  const total = WALK_FRAMES + IDLE_FRAMES;
  for (const who of WALK_CHARACTERS) {
    const key = walkSheetKey(who);
    if (scene.textures.exists(key)) continue;
    const col = COLORS[who];
    const sheet = makeCanvas(FRAME_W * total, FRAME_H);
    for (let f = 0; f < WALK_FRAMES; f++) drawPose(sheet, walkPose(f), col, f * FRAME_W);
    for (let f = 0; f < IDLE_FRAMES; f++) drawPose(sheet, idlePose(f), col, (WALK_FRAMES + f) * FRAME_W);

    const tex = scene.textures.createCanvas(key, sheet.w, sheet.h);
    if (!tex) continue;
    const ctx = tex.context;
    const img = ctx.createImageData(sheet.w, sheet.h);
    img.data.set(sheet.px);
    ctx.putImageData(img, 0, 0);
    tex.refresh();
    for (let f = 0; f < total; f++) tex.add(f, 0, f * FRAME_W, 0, FRAME_W, FRAME_H);
  }
}

const COLORS: Record<CharacterKey, CharacterColors> = {
  player: PLAYER_COLORS,
  npc_alin: ALIN_COLORS,
  npc_xiaozhou: XIAOZHOU_COLORS,
  wanderer: WANDERER_COLORS,
};

// Registers the walk and idle animations once. Guarded because a scene restart
// re-runs create() while the global animation manager keeps what it already has.
export function createCharacterAnimations(scene: Phaser.Scene): void {
  for (const who of WALK_CHARACTERS) {
    const sheet = walkSheetKey(who);
    if (!scene.textures.exists(sheet)) continue;
    const walk = walkAnimKey(who);
    if (!scene.anims.exists(walk)) {
      scene.anims.create({
        key: walk,
        frames: scene.anims.generateFrameNumbers(sheet, { start: 0, end: WALK_FRAMES - 1 }),
        frameRate: WALK_FRAME_RATE,
        repeat: -1,
      });
    }
    const idle = idleAnimKey(who);
    if (!scene.anims.exists(idle)) {
      scene.anims.create({
        key: idle,
        frames: scene.anims.generateFrameNumbers(sheet, { start: WALK_FRAMES, end: WALK_FRAMES + IDLE_FRAMES - 1 }),
        frameRate: 2,
        repeat: -1,
      });
    }
  }
}
