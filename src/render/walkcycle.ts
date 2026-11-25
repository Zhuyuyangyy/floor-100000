// Type-only: the pose/drawing half of this module is pure geometry over a
// PixelCanvas and must stay runnable in Node (tools/bake-walk.ts, unit tests),
// so importing the Phaser runtime here would break both.
import type Phaser from 'phaser';

import type { CharacterKey } from './artpack';
import { PALETTE } from './palette.ts';
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

// ── W5 新增动作帧数 ────────────────────────────────────────────────────
// 三段式攻击（前摇 / 出手 / 回收）、两段式受击（后仰 / 回收过半）、
// 两段式搜刮（弯腰前伸 / 重心变化）。全部接在行走 + 待机之后，烘进同一张
// sheet，所以 GameScene 与 pixelArt 的接线一行都不用改。
export const ATTACK_FRAMES = 3;
export const HURT_FRAMES = 2;
export const SEARCH_FRAMES = 2;

// W6 新增：死亡（倒地三段）和拾取（弯腰拾起两段）。
// 之前死亡复用 hurt 一帧后直接切结算场景，玩家看不到自己怎么倒的；
// 拾取复用 search，可那是个搜刮容器的姿势，地上捡东西是站着伸手。
export const DIE_FRAMES = 3;
export const PICKUP_FRAMES = 2;

/** sheet 中 attack 段的起始列（= 8）。 */
export const ATTACK_FRAME_START = WALK_FRAMES + IDLE_FRAMES;
/** sheet 中 hurt 段的起始列（= 11）。 */
export const HURT_FRAME_START = ATTACK_FRAME_START + ATTACK_FRAMES;
/** sheet 中 search 段的起始列（= 13）。 */
export const SEARCH_FRAME_START = HURT_FRAME_START + HURT_FRAMES;
/** sheet 中 die 段的起始列（= 15）。 */
export const DIE_FRAME_START = SEARCH_FRAME_START + SEARCH_FRAMES;
/** sheet 中 pickup 段的起始列（= 18）。 */
export const PICKUP_FRAME_START = DIE_FRAME_START + DIE_FRAMES;
/** 一张 sheet 的总列数：6+2+3+2+2 行走/待机/攻击/受击/搜刮 + 3+2 死亡/拾取 = 20。 */
export const TOTAL_FRAMES = PICKUP_FRAME_START + PICKUP_FRAMES;

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
  /**
   * 躯干前倾量（px，前进方向为正，负值为后仰）。省略时等于行走/待机一直在用的
   * 1.5——新增字段带默认值，所以 walkPose/idlePose 一个字节都没变。
   */
  lean?: number;
  /**
   * 脖子的前移量（px），默认 1 = 原来写死的那个值。
   *
   * 搜刮时头往前送 6–7px，脖子还留在肩口上，两者就在 x 上错开 5px 以上，
   * 轮廓描边只能填 1px 的暗桥，读作"头飘着"。弯腰越深脖子越要往前伸。
   */
  neckDx?: number;
  /**
   * 远臂（sign=-1，画在躯干后面那条）自己的摆动角，单位度、正为向前。
   * 省略时等于 `-armSwing`，即行走/待机一直在用的"两臂反向"镜像。
   *
   * 为什么需要它：镜像规则下，近臂向前打到 +78° 时远臂必然被甩到 −78°，
   * 手会跑到 x≈5——贴死画布左缘，读作一根扎出去的刺而不是手臂。攻击要的是
   * "一拳打出去、另一手收回来"，搜刮要的是"两只手一起往前伸"，都不是镜像。
   */
  farSwing?: number;
  /**
   * 双臂锚点整体上抬量（px）。受击的"手臂上扬"用：骨骼角度系里 0=下垂、
   * ±90=水平，前臂永远是 0.6×上臂角所以手永远低于肘——"往上"只能靠抬锚点。
   * 省略时为 0，行走/待机行为不变。
   */
  armRaise?: number;
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

// ── W5 新增姿态：攻击 / 受击 / 搜刮 ─────────────────────────────────────
//
// 时序结论来自 docs/RE_ANIMATION.md（CENTUM 源码级逆向）：
//   ① 攻击 = 前摇 + 出手两段，且出手的前伸量必须严格大于前摇；
//   ② 一次性动画不需要回调，repeat:0 播完停在末帧即"播完回 idle"；
//   ③ 一次性姿态的帧间差分要做到 idle 帧间差分的 5 倍以上（CENTUM 死亡帧
//      差分 114–144 px vs idle 8–29 px）；
//   ④ 攻击在 CENTUM 里是"半格冲刺"而不是换帧——本项目角色不能真位移（会脱离
//      碰撞盒），所以把"冲过去"翻译成手臂前伸量 + 躯干前倾量的峰值差。
//
// 三个姿态全部从同一套 hip/shoulder/head 骨架参数化派生，脚一律由 legTo() 反推，
// 所以"脚站在地上"是构造性质而不是手调数值。受击允许整体轻跳（最多 3px），
// 但髋与脚同步上移，腿骨长度不变，跳完仍在画布内。

/** 站距 → 髋高。站距半宽 s 时腿恰好完全伸直（√(LEG²−s²)），落点零误差。 */
function stanceHipY(spread: number): number {
  return FOOT_GROUND - Math.sqrt(LEG * LEG - spread * spread);
}

/** 一双扎在地上的脚：a 在后（−x），b 在前（+x）。 */
function plantedLegs(hip: Point, spread: number): { a: LegPose; b: LegPose } {
  const legA = legTo(hip, { x: hip.x - spread, y: FOOT_GROUND });
  const legB = legTo(hip, { x: hip.x + spread, y: FOOT_GROUND });
  if (!legA || !legB) throw new Error('stance is unreachable by the skeleton');
  return { a: legA, b: legB };
}

/** 攻击弓步的半距。10 与 11 都让腿恰好完全伸直，髋位随脚距精确反推。 */
const ATTACK_STANCE = 10;

export function attackPose(frame: number): Pose {
  const f = ((frame % ATTACK_FRAMES) + ATTACK_FRAMES) % ATTACK_FRAMES;
  // 三段：0 前摇（出拳手后引、躯干后仰，前伸量收到底）
  //       1 出手（手臂到顶点 + 躯干前倾，前伸量最大）
  //       2 回收过半（手臂回到半程，躯干仍略前倾）
  // 站距在出手帧放宽 1px，髋随之降 0.3px——重心压上去的那一下。
  //
  // farSwing 是远臂自己的角：出手帧 −30°（收拳回腰），不是镜像的 −78°——
  // 镜像会把手甩到 x≈5 贴死画布左缘（见 audit：attack f1 minX 曾为 5）。
  const TABLE: ReadonlyArray<{
    stance: number;
    swing: number;
    farSwing: number;
    lean: number;
    headDx: number;
  }> = [
    { stance: ATTACK_STANCE, swing: -50, farSwing: 25, lean: -1.5, headDx: -3 },
    { stance: ATTACK_STANCE + 1, swing: 78, farSwing: -30, lean: 5, headDx: 4 },
    { stance: ATTACK_STANCE, swing: 25, farSwing: -12, lean: 2.5, headDx: 1 },
  ];
  const t = TABLE[f];
  const hip: Point = { x: HIP_X, y: stanceHipY(t.stance) };
  const { a, b } = plantedLegs(hip, t.stance);
  const shoulder: Point = { x: HIP_X, y: hip.y - TORSO };
  return {
    hip,
    shoulder,
    head: { x: HIP_X + t.headDx, y: shoulder.y - HEAD_R - 1 },
    a,
    b,
    near: 'b', // 前腿（+x）压在夹克前面，出拳的同侧臂才在最前面
    armSwing: t.swing,
    farSwing: t.farSwing,
    hipY: hip.y,
    lean: t.lean,
  };
}

/** 受击轻跳的幅度（px）。髋与脚同步上移，腿骨长度不变，落点零误差。 */
const HURT_LIFT = [3, 1];

export function hurtPose(frame: number): Pose {
  const f = ((frame % HURT_FRAMES) + HURT_FRAMES) % HURT_FRAMES;
  const lift = HURT_LIFT[f];
  // 双脚仍按待机站距，只是整条身躯被"打上去"了 lift 像素：脚离地最多 3px，
  // 第二帧 lift=1 已经落回地板线附近，读作弹一下然后站稳。
  const hip: Point = { x: HIP_X, y: IDLE_HIP_Y - lift };
  const legA = legTo(hip, { x: HIP_X - IDLE_STANCE, y: FOOT_GROUND - lift });
  const legB = legTo(hip, { x: HIP_X + IDLE_STANCE, y: FOOT_GROUND - lift });
  if (!legA || !legB) throw new Error('hurt pose is unreachable by the skeleton');
  // 后仰 + 手臂上扬（armRaise 抬锚点）：两臂向外甩开、近臂向后远臂向前。
  // raise 只抬 9px 而不是更多——抬到 12px 时上臂起点会顶到下颌高度，
  // 两条胳膊从脖子旁边穿出来，读作"从头上长出手臂"。
  // 两帧的差必须是"整条身躯被掀翻"的量级，不是待机那种 2px 呼吸。
  const TABLE: ReadonlyArray<{ lean: number; headDx: number; swing: number; farSwing: number; raise: number }> = [
    { lean: -5, headDx: -6, swing: -54, farSwing: 54, raise: 9 },
    { lean: -2.5, headDx: -3, swing: -38, farSwing: 38, raise: 5 },
  ];
  const t = TABLE[f];
  const shoulder: Point = { x: HIP_X, y: hip.y - 26 };
  return {
    hip,
    shoulder,
    head: { x: HIP_X + t.headDx, y: shoulder.y - HEAD_R - 1 },
    a: legA,
    b: legB,
    near: 'a',
    armSwing: t.swing,
    farSwing: t.farSwing,
    hipY: hip.y,
    lean: t.lean,
    armRaise: t.raise,
  };
}

// 搜刮是"弯腰"不是"下蹲"：髋留在待机高度（腿因此完全伸直、脚精确踩线、
// 靴头朝前），弯的是腰——躯干压短、头往前送、手臂前伸。用蹲姿会让
// boot() 按小腿朝向把鞋头判成朝后，而这里要的是"站着俯身翻东西"。
//
// 两条手臂都往前伸（farSwing 取正 = 远臂也向前），一长一短错开，读作两只
// 手在容器里翻；镜像规则会把远臂甩到身后，那就成"挨了一拳"而不是"搜刮"。
const SEARCH_TABLE: ReadonlyArray<{ torso: number; headDx: number; neckDx: number; swing: number; farSwing: number }> = [
  { torso: 16, headDx: 6, neckDx: 7, swing: 64, farSwing: 42 },
  { torso: 15, headDx: 7, neckDx: 8, swing: 70, farSwing: 48 },
];

export function searchPose(frame: number): Pose {
  const f = ((frame % SEARCH_FRAMES) + SEARCH_FRAMES) % SEARCH_FRAMES;
  const t = SEARCH_TABLE[f];
  const hip: Point = { x: HIP_X, y: IDLE_HIP_Y };
  // 腿与待机同一副：站距 5、髋高由 √(LEG²−5²) 反推，腿恰好完全伸直，
  // 所以落点是构造精确的（legTo 在完全伸直时 knee=0，无近似误差）。
  const { a, b } = plantedLegs(hip, IDLE_STANCE);
  // 弯腰 = 躯干压短（shoulder 贴近 hip）+ 头往前送。head.y 必须低于待机，
  // 这是"真的在弯腰"而不是"站着抬手"的可测指标。
  const shoulder: Point = { x: HIP_X, y: hip.y - t.torso };
  return {
    hip,
    shoulder,
    head: { x: HIP_X + t.headDx, y: shoulder.y - HEAD_R - 1 },
    a,
    b,
    near: 'a',
    armSwing: t.swing,
    farSwing: t.farSwing,
    neckDx: t.neckDx,
    hipY: hip.y,
    lean: 4,
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
  /**
   * Body bulk: 1 is the base build. It scales the torso and arm widths only -
   * the skeleton, the leg length and the ground contact stay identical for every
   * character, because a figure whose feet sit at a different height breaks the
   * shared walk cycle and every interaction radius with it.
   *
   * Four survivors on one skeleton with only a palette swap read as recolours.
   * A broader neighbour and a slighter kid do not.
   */
  bulk?: number;
}
type RGB = [number, number, number];

const rgb = (c: number): [number, number, number] => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];

// The four palettes, on the project palette (see render/palette.ts).
//
// Each character used to carry twelve hand-picked colours unrelated to anything
// else on screen, so a figure could land a value lighter or darker than the wall
// behind it by accident. The 2D-art rules this project follows say a character
// must be separated from its background in VALUE, and each material gets three
// values at most - so every colour below comes from the shared ramps, and the
// survivor's jacket is the teal family, the one ramp that is neither stone nor
// skin. That is what makes the player findable against a stone wall.
export const PLAYER_COLORS: CharacterColors = {
  outline: rgb(PALETTE.ink),
  cloth: rgb(PALETTE.clothHigh),
  clothDark: rgb(PALETTE.cloth),
  clothLight: rgb(0xa8dcC4),
  trouser: rgb(PALETTE.stoneLight),
  trouserDark: rgb(PALETTE.stone),
  boot: rgb(PALETTE.shadow),
  skin: rgb(PALETTE.skinLight),
  skinDark: rgb(PALETTE.skin),
  hair: rgb(PALETTE.shadow),
  pack: rgb(PALETTE.lightDeep),
  packDark: rgb(PALETTE.shadow),
};

// The other three share the skeleton and differ only in palette, the way
// build-characters.mjs already did — so the four figures stay distinguishable
// without any of them being a repaint of another.
export const ALIN_COLORS: CharacterColors = {
  ...PLAYER_COLORS,
  // The neighbour is older and heavier than the survivor.
  bulk: 1.3,
  cloth: rgb(PALETTE.stoneLight),
  clothDark: rgb(PALETTE.stone),
  clothLight: rgb(PALETTE.dust),
  hair: rgb(PALETTE.ink),
};

export const XIAOZHOU_COLORS: CharacterColors = {
  ...PLAYER_COLORS,
  // The kid is slighter.
  bulk: 0.82,
  cloth: rgb(PALETTE.lightHigh),
  clothDark: rgb(PALETTE.light),
  clothLight: rgb(PALETTE.lightHot),
  hair: rgb(PALETTE.shadow),
};

// The night threat is not a person, so it gets no skin: the husk palette is dark
// enough that the silhouette reads as a shape moving in the dark rather than a
// second survivor with different clothes.
export const WANDERER_COLORS: CharacterColors = {
  ...PLAYER_COLORS,
  // The thing in the dark is thin: it should not read as a person's build.
  bulk: 0.6,
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
// Blend two RGB triples. Used to derive a material's lit and shadow steps from
// its base colour, so a palette that only defines a base still gets three values
// and every material shades the same way.
function mixRgb(from: RGB, to: RGB, t: number): RGB {
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
  ];
}

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
      // RIM LIGHT on the leading edge.
      //
      // An outline that is uniformly near-black separates the figure from a bright
      // background and disappears against a dark one - and this game's background
      // is dark. The pixels on the RIGHT of the figure (the direction it faces,
      // and therefore the side a room light would catch) take a lighter outline
      // instead, which is the standard rim-light trick for exactly this problem:
      // it gives the silhouette a lit edge that survives any backdrop.
      const behind = x > 0 && solid[i - 1];
      const onLeadingEdge = behind && !(x < w - 1 && solid[i + 1]);
      const rim = onLeadingEdge;
      px[o] = rim ? Math.min(255, outline[0] + 96) : outline[0];
      px[o + 1] = rim ? Math.min(255, outline[1] + 104) : outline[1];
      px[o + 2] = rim ? Math.min(255, outline[2] + 88) : outline[2];
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
  // THREE VALUES PER MATERIAL, which is the rule the art research sets: base,
  // one step lighter on the lit edge, one step darker on the shadow edge. The
  // legs were a single flat colour while the jacket already had two, and that
  // inconsistency is a large part of why the figure read as assembled rather
  // than drawn.
  taperedLimb(cv, pose.hip, knee, 9, 7, trouser);
  taperedLimb(cv, knee, ankle, 7, 5.5, trouser);
  // The lit edge: a single column one pixel in from the leading side of the
  // thigh and shin. On the near leg only — the far leg is behind the body and
  // takes the shadow value instead, which is what gives the stride depth.
  if (!far) {
    const lit = mixRgb(trouser, col.clothLight, 0.28);
    const shade = mixRgb(trouser, col.outline, 0.45);
    for (let y = Math.round(pose.hip.y) + 1; y < Math.round(ankle.y) - 1; y++) {
      // Follow the bone: interpolate x along the hip->knee->ankle path.
      const kneeY = Math.round(knee.y);
      const cx = y <= kneeY
        ? pose.hip.x + ((y - pose.hip.y) / Math.max(1, knee.y - pose.hip.y)) * (knee.x - pose.hip.x)
        : knee.x + ((y - knee.y) / Math.max(1, ankle.y - knee.y)) * (ankle.x - knee.x);
      const halfW = (y <= kneeY ? 9 - ((y - pose.hip.y) / Math.max(1, knee.y - pose.hip.y)) * 2 : 7 - ((y - knee.y) / Math.max(1, ankle.y - knee.y)) * 1.5) / 2;
      cv.set(Math.round(cx + halfW - 1), y, lit);
      cv.set(Math.round(cx - halfW + 1), y, shade);
    }
  }
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
  const bulk = col.bulk ?? 1;
  for (let y = top; y <= bottom; y++) {
    const t = (y - top) / span;
    let half = 8 * bulk;
    for (let i = 1; i < PROFILE.length; i++) {
      if (t <= PROFILE[i][0]) {
        const [t0, w0] = PROFILE[i - 1];
        const [t1, w1] = PROFILE[i];
        const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
        half = (w0 + k * (w1 - w0)) * bulk;
        break;
      }
    }
    // 前倾量由姿态提供，默认 1.5 = 原来写死的那个值。
    const cx = pose.shoulder.x + t * (pose.lean ?? 1.5); // lean into the walk
    run(cv, cx, half, y, col.cloth);
    // Art pass: the torso used to be one flat colour with a single highlight
    // column, which read as a painted rectangle. Now the lit side carries a
    // proper two-step shade and the shadow side a darker band, so the jacket has
    // volume. The outline pass still owns the silhouette edge.
    if (t > 0.06 && t < 0.94) {
      cv.set(Math.round(cx + half - 1), y, col.clothLight);
      if (half > 6.5) cv.set(Math.round(cx + half - 2), y, col.clothLight);
      cv.set(Math.round(cx - half + 1), y, col.clothDark);
    }
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
  // 近臂用 armSwing，远臂用 farSwing（缺省 = 镜像的 -armSwing，即原行为）。
  const swing = sign === 1 ? pose.armSwing : (pose.farSwing ?? -pose.armSwing);
  // armRaise 只抬锚点不改骨骼角度，省略时为 0（行走/待机的原值）。
  const raise = pose.armRaise ?? 0;
  const shoulder = { x: pose.shoulder.x + (sign === 1 ? 2 : -6), y: pose.shoulder.y + 4 - raise };
  const elbow = joint(shoulder, 12, swing);
  const hand = joint(elbow, 11, swing * 0.6);
  // Art pass: the arms used to be 4.5/3.5 half-width against a 16px-wide torso,
  // so from the side the near arm was swallowed by the jacket and the swing was
  // invisible — the audit dump showed no arm at all in the walk frames. Wider
  // limbs, and the near arm's anchor sits clear of the torso's edge so it reads
  // as an arm passing in front of the body rather than a stripe on it.
  const sleeve = sign === 1 ? col.cloth : col.clothDark;
  const armBulk = col.bulk ?? 1;
  taperedLimb(cv, shoulder, elbow, 6 * armBulk, 4.5 * armBulk, sleeve);
  const skin = sign === 1 ? col.skin : col.skinDark;
  taperedLimb(cv, elbow, hand, 4.5, 3.5, skin);
  // THREE VALUES ON THE SLEEVE, like the legs and the jacket. A cylindrical limb
  // needs a lit edge and a shadow edge or it reads as a flat sticker; the near
  // arm gets both, the far arm only the shadow (it is behind the body).
  const lit = mixRgb(sleeve, col.clothLight, sign === 1 ? 0.34 : 0.12);
  const shade = mixRgb(sleeve, col.outline, 0.42);
  for (let y = Math.round(shoulder.y) + 1; y <= Math.round(elbow.y) - 1; y++) {
    const k = (y - shoulder.y) / Math.max(1, elbow.y - shoulder.y);
    const cx = shoulder.x + k * (elbow.x - shoulder.x);
    const halfW = ((6 - k * 1.5) * armBulk) / 2;
    cv.set(Math.round(cx + halfW - 1), y, lit);
    cv.set(Math.round(cx - halfW + 1), y, shade);
  }
  // Forearm: the skin gets the same treatment, one step only - a hand is small
  // enough that two extra columns would turn it to noise.
  for (let y = Math.round(elbow.y) + 1; y <= Math.round(hand.y) - 1; y++) {
    const k = (y - elbow.y) / Math.max(1, hand.y - elbow.y);
    const cx = elbow.x + k * (hand.x - elbow.x);
    const halfW = (4.5 - k) / 2;
    cv.set(Math.round(cx + halfW - 1), y, mixRgb(skin, col.clothLight, 0.2));
  }
  // A fist, because a tapering point reads as a wire.
  run(cv, hand.x, 2.5, Math.round(hand.y), skin);
  run(cv, hand.x, 2.5, Math.round(hand.y) + 1, skin);
  // A knuckle line so the fist has two values.
  cv.set(Math.round(hand.x + 1), Math.round(hand.y) + 1, mixRgb(skin, col.outline, 0.35));
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
  //
  // Art pass: the old skull held half-width 6 from row -6 all the way to -1 and
  // only started narrowing at the chin — 22 rows of near-constant width read as
  // a cylinder, and the head swamped the body. Now the cranium is the wide part
  // (rows -6..-3) and the face tapers through the jaw to the chin, which is what
  // a head in profile actually does.
  const SKULL: ReadonlyArray<readonly [number, number, number]> = [
    [-11, 3, 0],
    [-10, 4, 0],
    [-9, 4.5, 0],
    [-8, 5, 0],
    [-7, 5.5, 0.5],
    [-6, 6, 1],
    [-5, 5.5, 1.5],
    [-4, 5, 2],
    [-3, 4.5, 2.5],
    [-2, 4, 3],
    [-1, 3.5, 3],
    [0, 3, 3],
    [1, 2.5, 2.5],
    [2, 2, 2],
    [3, 1.5, 1.5],
    [4, 1.5, 1],
  ];
  for (const [dy, half, dx] of SKULL) run(cv, cx + 1 + dx, half, cy + dy, col.skin);
  // Hair: a contiguous cap over the top and back of the skull.
  const HAIR: ReadonlyArray<readonly [number, number]> = [
    [-12, 3.5],
    [-11, 4],
    [-10, 4.5],
    [-9, 5],
    [-8, 5.5],
    [-7, 5.5],
    [-6, 5],
  ];
  // Hair with three values: a base cap, a lit top-left where the key light
  // falls, and a darker band at the hairline. Hair drawn as one flat cap is the
  // single most common reason a pixel head reads as a helmet.
  const hairLit = mixRgb(col.hair, col.clothLight, 0.22);
  const hairDeep = mixRgb(col.hair, col.outline, 0.55);
  for (const [dy, half] of HAIR) run(cv, dy <= -7 ? cx : cx + 0.5, half, cy + dy, col.hair);
  // The lit side: the upper-left arc of the cap, where a room light would land.
  for (const [dy, half] of HAIR) {
    if (dy > -7) continue;
    const cxx = dy <= -7 ? cx : cx + 0.5;
    cv.set(Math.round(cxx - half + 1), cy + dy, hairLit);
    cv.set(Math.round(cxx - half + 2), cy + dy, hairLit);
  }
  // The shadow line where the fringe meets the forehead.
  for (let x = Math.round(cx - 4); x <= Math.round(cx + 4); x++) cv.set(x, cy - 6, hairDeep);
  run(cv, cx + 5, 2, cy - 8, col.hair); // fringe at the front
  // The face's own light: a lit column down the cheek so the skin is not one
  // value, then the features sit on top of it.
  for (let dy = -5; dy <= 3; dy++) {
    cv.set(Math.round(cx + 3), cy + dy, mixRgb(col.skin, col.clothLight, 0.16));
  }
  // Face on the leading edge, sitting on the tapered jaw.
  run(cv, cx + 6, 1.5, cy - 6, col.skinDark); // brow
  cv.set(cx + 7, cy - 4, col.outline); // eye
  cv.set(cx + 7, cy - 3, col.outline);
  run(cv, cx + 7, 1, cy - 2, col.skinDark); // nose
  cv.set(cx + 7, cy - 1, col.skinDark);
  run(cv, cx + 5, 1, cy + 1, col.skinDark); // mouth
}

// A neck, drawn before the torso so the collar covers its bottom and the skull
// covers its top. Without it the head floats a pixel above the shoulders.
function drawNeck(cv: PixelCanvas, pose: Pose, col: CharacterColors): void {
  const y0 = Math.round(pose.shoulder.y) - 2;
  const dx = pose.neckDx ?? 1;
  for (let y = y0; y <= y0 + 2; y++) run(cv, pose.shoulder.x + dx, 2.5, y, col.skinDark);
}

function drawPack(cv: PixelCanvas, pose: Pose, col: CharacterColors): void {
  // Behind everything: the pack is what makes the silhouette a survivor.
  //
  // It was two flat rectangles - a lid and a body - carrying 15 of the
  // silhouette's 25px of width, which made the widest part of the figure the
  // least detailed. It now reads as a canvas pack: a lid that overhangs, a body
  // with a lit back edge and a shadowed front, a compression strap across the
  // middle, a buckled flap, and a bedroll lashed to the top.
  // The pack follows the build: a broad survivor carries a broad pack, and the
  // slighter ones carry less. Otherwise every character is the same silhouette
  // from the waist up no matter what the torso does.
  const bulk = col.bulk ?? 1;
  const packHalf = 6.5 * bulk;
  const x = Math.round(pose.shoulder.x) - Math.round(packHalf * 2);
  const y = Math.round(pose.shoulder.y) - 1;
  const lit = mixRgb(col.pack, col.clothLight, 0.18);
  const shade = mixRgb(col.packDark, col.outline, 0.5);

  // Body: base, then a lit column on the outward edge and a shadow on the inner.
  const packW = Math.round(packHalf * 2);
  for (let j = 3; j < 19; j++) {
    run(cv, x + packHalf, packHalf, y + j, col.packDark);
    cv.set(x, y + j, lit);
    cv.set(x + packW, y + j, shade);
  }
  // The lid overhangs the body by a pixel on each side, which is what makes a
  // pack look packed rather than painted on.
  for (let j = 0; j < 3; j++) run(cv, x + packHalf + 0.5, packHalf + 0.5, y + j, col.pack);
  run(cv, x + packHalf + 0.5, packHalf + 0.5, y + 3, col.packDark);

  // A compression strap across the middle, and its buckle on the lit edge.
  run(cv, x + packHalf, packHalf, y + 10, col.outline);
  run(cv, x + packHalf, packHalf, y + 11, col.outline);
  cv.set(x + 1, y + 10, col.clothLight);
  cv.set(x + 1, y + 11, col.clothLight);

  // A bedroll lashed on top: two rounded rolls, one lit, one shaded.
  run(cv, x + packHalf - 0.5, packHalf - 0.5, y - 2, col.cloth);
  run(cv, x + packHalf - 1.5, packHalf - 1.5, y - 1, col.clothDark);
  cv.set(x + 11, y - 2, col.clothLight);
  // The shoulder strap running from the pack top toward the neck.
  run(cv, pose.shoulder.x - 3, 2, y - 1, col.packDark);
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

// W5 新增的三个一次性动作 key。命名与 walk-/idle- 同构，GameScene 直接 import。
export function attackAnimKey(who: CharacterKey): string {
  return `attack-${who}`;
}

export function hurtAnimKey(who: CharacterKey): string {
  return `hurt-${who}`;
}

export function searchAnimKey(who: CharacterKey): string {
  return `search-${who}`;
}

// W6 新增的两个一次性动作 key。
export function dieAnimKey(who: CharacterKey): string {
  return `die-${who}`;
}

export function pickupAnimKey(who: CharacterKey): string {
  return `pickup-${who}`;
}

export const WALK_CHARACTERS: readonly CharacterKey[] = ['player', 'npc_alin', 'npc_xiaozhou', 'wanderer'];

// Frames per second for the walk playback. The scene scales timeScale by the
// player's actual speed, so this is the rate at top speed — 4Hz matches the
// stride the poses were built around, and it is what keeps the feet from
// skating when the player is only halfway up the ramp.
export const WALK_FRAME_RATE = 8;

// W5 一次性动作帧率。全部 repeat:0（播完停在末帧即"播完回 idle"，见
// docs/RE_ANIMATION.md 结论②）。取值参考 CENTUM 的实测节奏：
// 攻击 12fps ⇒ 3 帧 250ms，是最快的一次性动作（出手要干脆）；
// 受击 8fps ⇒ 2 帧 250ms，与攻击同长但帧更少（大差分，少帧数）；
// 搜刮 6fps ⇒ 2 帧 333ms，最慢，因为是"翻东西"不是"打"。
export const ATTACK_FRAME_RATE = 12;
export const HURT_FRAME_RATE = 8;
export const SEARCH_FRAME_RATE = 6;
// W6：死亡 6fps ⇒ 3 帧 500ms，是全身倒地，必须慢到看得清；
// 拾取 8fps ⇒ 2 帧 250ms，和攻击同长，因为是"伸手-拿到"的一个动作。
export const DIE_FRAME_RATE = 6;
export const PICKUP_FRAME_RATE = 8;

// Bakes every character's frames into one horizontal sheet per character.
//
// A CanvasTexture rather than a Graphics: the poses are already pixel data, and
// putImageData moves them in one call where generateTexture would need tens of
// thousands of fillRects to say the same thing.
//
// W5：sheet 现在排 walk(6) + idle(2) + attack(3) + hurt(2) + search(2) = 15 列。
// 新增段全部追加在尾部，行走与待机的列号 0..7 一字未动，所以既有动画与
// GameScene 的接线不受影响。
export function bakeWalkSheets(scene: Phaser.Scene): void {
  const total = TOTAL_FRAMES;
  for (const who of WALK_CHARACTERS) {
    const key = walkSheetKey(who);
    if (scene.textures.exists(key)) continue;
    const col = COLORS[who];
    const sheet = makeCanvas(FRAME_W * total, FRAME_H);
    for (let f = 0; f < WALK_FRAMES; f++) drawPose(sheet, walkPose(f), col, f * FRAME_W);
    for (let f = 0; f < IDLE_FRAMES; f++) drawPose(sheet, idlePose(f), col, (WALK_FRAMES + f) * FRAME_W);
    for (let f = 0; f < ATTACK_FRAMES; f++) {
      drawPose(sheet, attackPose(f), col, (ATTACK_FRAME_START + f) * FRAME_W);
    }
    for (let f = 0; f < HURT_FRAMES; f++) {
      drawPose(sheet, hurtPose(f), col, (HURT_FRAME_START + f) * FRAME_W);
    }
    for (let f = 0; f < SEARCH_FRAMES; f++) {
      drawPose(sheet, searchPose(f), col, (SEARCH_FRAME_START + f) * FRAME_W);
    }

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

// Registers the walk, idle and the W5 one-shot animations once. Guarded because
// a scene restart re-runs create() while the global animation manager keeps
// what it already has.
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
    // 以下三个是一次性动作：repeat:0，播完停在最后一帧，由调用方决定何时
    // 切回 idle——对应 CENTUM 的 "offset 衰减到 0 → isAttackAnimation=false"。
    const attack = attackAnimKey(who);
    if (!scene.anims.exists(attack)) {
      scene.anims.create({
        key: attack,
        frames: scene.anims.generateFrameNumbers(sheet, {
          start: ATTACK_FRAME_START,
          end: ATTACK_FRAME_START + ATTACK_FRAMES - 1,
        }),
        frameRate: ATTACK_FRAME_RATE,
        repeat: 0,
      });
    }
    const hurt = hurtAnimKey(who);
    if (!scene.anims.exists(hurt)) {
      scene.anims.create({
        key: hurt,
        frames: scene.anims.generateFrameNumbers(sheet, {
          start: HURT_FRAME_START,
          end: HURT_FRAME_START + HURT_FRAMES - 1,
        }),
        frameRate: HURT_FRAME_RATE,
        repeat: 0,
      });
    }
    const search = searchAnimKey(who);
    if (!scene.anims.exists(search)) {
      scene.anims.create({
        key: search,
        frames: scene.anims.generateFrameNumbers(sheet, {
          start: SEARCH_FRAME_START,
          end: SEARCH_FRAME_START + SEARCH_FRAMES - 1,
        }),
        frameRate: SEARCH_FRAME_RATE,
        repeat: 0,
      });
    }
    // W6: death and pickup. Both repeat:0 - death ends on the fallen pose and
    // holds it while the end card comes up, pickup returns to idle on its own.
    {
      const die = dieAnimKey(who);
      if (!scene.anims.exists(die)) {
        scene.anims.create({
          key: die,
          frames: scene.anims.generateFrameNumbers(sheet, {
            start: DIE_FRAME_START,
            end: DIE_FRAME_START + DIE_FRAMES - 1,
          }),
          frameRate: DIE_FRAME_RATE,
          repeat: 0,
        });
      }
      const pickup = pickupAnimKey(who);
      if (!scene.anims.exists(pickup)) {
        scene.anims.create({
          key: pickup,
          frames: scene.anims.generateFrameNumbers(sheet, {
            start: PICKUP_FRAME_START,
            end: PICKUP_FRAME_START + PICKUP_FRAMES - 1,
          }),
          frameRate: PICKUP_FRAME_RATE,
          repeat: 0,
        });
      }
    }
  }
}
