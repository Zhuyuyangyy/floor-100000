import { describe, expect, it } from 'vitest';

import { bakedTextures } from './bakeProbe';
import {
  FRAME_H,
  FRAME_W,
  IDLE_FRAMES,
  SHIN,
  THIGH,
  WALK_FRAMES,
  ATTACK_FRAMES,
  HURT_FRAMES,
  SEARCH_FRAMES,
  TOTAL_FRAMES,
  ATTACK_FRAME_START,
  HURT_FRAME_START,
  SEARCH_FRAME_START,
  DIE_FRAME_START,
  DIE_FRAMES,
  PICKUP_FRAME_START,
  PICKUP_FRAMES,
  ATTACK_FRAME_RATE,
  HURT_FRAME_RATE,
  SEARCH_FRAME_RATE,
  joint,
  makeCanvas,
  drawPose,
  idlePose,
  attackPose,
  hurtPose,
  searchPose,
  solveKnee,
  walkPose,
  attackAnimKey,
  hurtAnimKey,
  searchAnimKey,
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
    //
    // W5: the sheet is now walk(6) + idle(2) + attack(3) + hurt(2) + search(2).
    const baked = new Map(bakedTextures().map((t) => [t.key, t]));
    for (const who of WALK_CHARACTERS) {
      const t = baked.get(walkSheetKey(who));
      expect(t, `no sheet baked for ${who}`).toBeDefined();
      expect(t!.width, `${who} sheet width`).toBe(FRAME_W * TOTAL_FRAMES);
      expect(t!.height, `${who} sheet height`).toBe(FRAME_H);
    }
  });

  it('stacks the one-shot segments after walk and idle, in order', () => {
    // The column numbers are the contract with createCharacterAnimations: attack
    // 8..10, hurt 11..12, search 13..14, die 15..17, pickup 18..19. Walk keeps
    // 0..7 untouched.
    expect(TOTAL_FRAMES).toBe(
      WALK_FRAMES + IDLE_FRAMES + ATTACK_FRAMES + HURT_FRAMES + SEARCH_FRAMES + DIE_FRAMES + PICKUP_FRAMES,
    );
    expect(TOTAL_FRAMES).toBe(20);
    expect(ATTACK_FRAME_START).toBe(WALK_FRAMES + IDLE_FRAMES);
    expect(HURT_FRAME_START).toBe(ATTACK_FRAME_START + ATTACK_FRAMES);
    expect(SEARCH_FRAME_START).toBe(HURT_FRAME_START + HURT_FRAMES);
    expect(DIE_FRAME_START).toBe(SEARCH_FRAME_START + SEARCH_FRAMES);
    expect(PICKUP_FRAME_START).toBe(DIE_FRAME_START + DIE_FRAMES);
    expect(PICKUP_FRAME_START + PICKUP_FRAMES).toBe(TOTAL_FRAMES);
  });

  it('gives each new action its own animation key and a one-shot rate', () => {
    // repeat:0 播完停在末帧 = "播完回 idle"，对应 CENTUM 的 offset 归零清状态位。
    for (const who of WALK_CHARACTERS) {
      expect(attackAnimKey(who)).toBe(`attack-${who}`);
      expect(hurtAnimKey(who)).toBe(`hurt-${who}`);
      expect(searchAnimKey(who)).toBe(`search-${who}`);
    }
    expect(ATTACK_FRAMES).toBe(3);
    expect(HURT_FRAMES).toBe(2);
    expect(SEARCH_FRAMES).toBe(2);
    expect(ATTACK_FRAME_RATE).toBeGreaterThan(SEARCH_FRAME_RATE);
    expect(HURT_FRAME_RATE).toBeGreaterThan(SEARCH_FRAME_RATE);
    expect(ATTACK_FRAME_RATE).toBeGreaterThan(0);
    expect(HURT_FRAME_RATE).toBeGreaterThan(0);
    expect(SEARCH_FRAME_RATE).toBeGreaterThan(0);
  });
});

// ── W5：攻击 / 受击 / 搜刮 ─────────────────────────────────────────────
//
// 这三个姿态是纯加法：行走与待机的列号 0..7 和它们的行为都没被碰过。测的
// 是三件事——画得出（>200 不透明像素）、帧帧不同（一次性姿态的帧间差分要
// 大到 idle 的 5 倍以上，见 RE_ANIMATION.md 结论③）、以及每条工单点名的
// 可读性指标（出手帧前伸量 > 前摇帧；搜刮帧头低于待机帧）。

describe('attackPose', () => {
  const FRAMES = [0, 1, 2];

  it('draws a silhouette in every frame', () => {
    for (const f of FRAMES) {
      const cv = makeCanvas(FRAME_W, FRAME_H);
      drawPose(cv, attackPose(f), PLAYER_COLORS);
      const opaque = countOpaque(cv);
      expect(opaque, `attack frame ${f} drew ${opaque} px`).toBeGreaterThan(200);
    }
  });

  it('keeps the silhouette inside the canvas', () => {
    for (const f of FRAMES) {
      const cv = makeCanvas(FRAME_W, FRAME_H);
      drawPose(cv, attackPose(f), PLAYER_COLORS);
      const box = boundingBox(cv);
      expect(box.minX, `attack frame ${f} left`).toBeGreaterThanOrEqual(0);
      expect(box.maxX, `attack frame ${f} right`).toBeLessThan(FRAME_W);
      expect(box.maxY, `attack frame ${f} bottom`).toBeLessThan(FRAME_H);
      // 攻击是站着打完的：靴底必须仍然压在地板线上，不能飘。
      expect(box.maxY, `attack frame ${f} feet`).toBeGreaterThanOrEqual(FRAME_H - 4);
    }
  });

  it('plants both feet on the ground in every frame', () => {
    // 弓步是扎地的。髋位由 √(LEG²−stance²) 反推，脚距 10/11 都让腿恰好完全
    // 伸直，所以落点是构造精确的而不是凑出来的。
    for (const f of FRAMES) {
      for (const a of bothFeet(attackPose(f))) {
        expect(a.y, `attack frame ${f} foot at y=${a.y.toFixed(2)}`).toBeCloseTo(FOOT_GROUND, 6);
      }
    }
  });

  it('reaches further forward on the strike than on the windup', () => {
    // 工单点名的指标：出手帧（1）的右手前伸量必须严格大于前摇帧（0）。
    // 量的是右前方 x>=46 这条带里的不透明像素——躯干最右只到 41、头部最右
    // 只到 44，所以这条带里除了前伸的手臂不可能有别的东西。
    const rightHand = (f: number) => {
      const cv = makeCanvas(FRAME_W, FRAME_H);
      drawPose(cv, attackPose(f), PLAYER_COLORS);
      return forwardPixels(cv);
    };
    const windup = rightHand(0);
    const strike = rightHand(1);
    const recover = rightHand(2);
    expect(strike, `strike ${strike} vs windup ${windup}`).toBeGreaterThan(windup);
    // 回收帧回到半程，前伸量必须明显小于出手帧，否则三帧读作同一帧。
    expect(recover, `recover ${recover} vs strike ${strike}`).toBeLessThan(strike);
  });

  it('leans the torso forward on the strike and back on the windup', () => {
    // 前摇后仰、出手前倾——躯干前倾量本身也是"冲过去"的翻译。
    expect(attackPose(1).lean).toBeGreaterThan(0);
    expect(attackPose(0).lean).toBeLessThan(0);
    expect(attackPose(2).lean).toBeGreaterThan(0);
    expect(attackPose(2).lean).toBeLessThan(attackPose(1).lean!);
  });

  it('differs between every pair of frames', () => {
    const frames = FRAMES.map((f) => {
      const cv = makeCanvas(FRAME_W, FRAME_H);
      drawPose(cv, attackPose(f), PLAYER_COLORS);
      return cv;
    });
    for (let i = 0; i < frames.length; i++) {
      for (let j = i + 1; j < frames.length; j++) {
        expect(differs(frames[i], frames[j]), `frames ${i} vs ${j}`).toBeGreaterThan(100);
      }
    }
  });

  it('wraps the frame index like the other cycles do', () => {
    expect(attackPose(3)).toEqual(attackPose(0));
    expect(attackPose(-1)).toEqual(attackPose(2));
  });
});

describe('hurtPose', () => {
  const FRAMES = [0, 1];

  it('draws a silhouette in every frame', () => {
    for (const f of FRAMES) {
      const cv = makeCanvas(FRAME_W, FRAME_H);
      drawPose(cv, hurtPose(f), PLAYER_COLORS);
      const opaque = countOpaque(cv);
      expect(opaque, `hurt frame ${f} drew ${opaque} px`).toBeGreaterThan(200);
    }
  });

  it('stays inside the canvas even though the body leaves the ground', () => {
    // 受击允许轻跳，但跳完必须还在画布里——这是"可以离地"的边界。
    for (const f of FRAMES) {
      const cv = makeCanvas(FRAME_W, FRAME_H);
      drawPose(cv, hurtPose(f), PLAYER_COLORS);
      const box = boundingBox(cv);
      expect(box.minX, `hurt frame ${f} left`).toBeGreaterThanOrEqual(0);
      expect(box.maxX, `hurt frame ${f} right`).toBeLessThan(FRAME_W);
      expect(box.maxY, `hurt frame ${f} bottom`).toBeLessThan(FRAME_H);
    }
  });

  it('lifts the feet only a little, and lands again on the second frame', () => {
    for (const f of FRAMES) {
      for (const a of bothFeet(hurtPose(f))) {
        const lift = FOOT_GROUND - a.y;
        expect(lift, `hurt frame ${f} foot lift ${lift.toFixed(2)}`).toBeGreaterThanOrEqual(0);
        expect(lift, `hurt frame ${f} foot lift ${lift.toFixed(2)}`).toBeLessThanOrEqual(6);
      }
    }
    // 第一帧弹得高，第二帧已经落回地面附近。
    expect(hurtPose(0).hipY).toBeLessThan(hurtPose(1).hipY);
  });

  it('recoils: leans back, head back, arms raised', () => {
    expect(hurtPose(0).lean).toBeLessThan(0);
    expect(hurtPose(1).lean).toBeLessThan(0);
    expect(hurtPose(0).head.x).toBeLessThan(idlePose(0).head.x);
    // 上扬 = 锚点上抬，手臂才够得到"往上"这个骨骼角度到不了的方向。
    expect(hurtPose(0).armRaise).toBeGreaterThan(0);
    expect(hurtPose(1).armRaise).toBeGreaterThan(0);
    expect(hurtPose(0).armRaise!).toBeGreaterThan(hurtPose(1).armRaise!);
  });

  it('differs between the two frames by far more than an idle breath', () => {
    // RE_ANIMATION.md 结论③：一次性姿态的帧间差分要做到 idle 帧间差分的
    // 数倍以上（CENTUM 死亡帧 114–144 px vs idle 8–29 px）。
    //
    // 阈值取 2 倍而不是 CENTUM 的 5 倍：本项目的 idle 是"整条上体移 2px"，
    // 差分已经 322 px（CENTUM 那个 16×16 cell 的 idle 只有 8–29 px），
    // 分母本来就大一个量级。真正要卡住的是"受击两帧不能只差一两像素"。
    const a = makeCanvas(FRAME_W, FRAME_H);
    const b = makeCanvas(FRAME_W, FRAME_H);
    drawPose(a, hurtPose(0), PLAYER_COLORS);
    drawPose(b, hurtPose(1), PLAYER_COLORS);
    const idleA = makeCanvas(FRAME_W, FRAME_H);
    const idleB = makeCanvas(FRAME_W, FRAME_H);
    drawPose(idleA, idlePose(0), PLAYER_COLORS);
    drawPose(idleB, idlePose(1), PLAYER_COLORS);
    const hurt = differs(a, b);
    const breath = differs(idleA, idleB);
    expect(hurt, `hurt ${hurt} vs breath ${breath}`).toBeGreaterThan(breath * 2);
    expect(hurt, `hurt ${hurt}`).toBeGreaterThan(400);
  });

  it('moves the whole body, not just one limb', () => {
    // 逐参数核对：髋、躯干、头、臂四个量都要动，否则只是"挥了下手"。
    const a = hurtPose(0);
    const b = hurtPose(1);
    expect(Math.abs(a.hipY - b.hipY)).toBeGreaterThan(1);
    expect(Math.abs(a.lean! - b.lean!)).toBeGreaterThan(1);
    expect(Math.abs(a.head.x - b.head.x)).toBeGreaterThan(1);
    expect(Math.abs(a.armSwing - b.armSwing)).toBeGreaterThan(10);
    expect(Math.abs(a.armRaise! - b.armRaise!)).toBeGreaterThan(2);
  });

  it('wraps the frame index like the other cycles do', () => {
    expect(hurtPose(2)).toEqual(hurtPose(0));
    expect(hurtPose(-1)).toEqual(hurtPose(1));
  });
});

describe('searchPose', () => {
  const FRAMES = [0, 1];

  it('draws a silhouette in every frame', () => {
    for (const f of FRAMES) {
      const cv = makeCanvas(FRAME_W, FRAME_H);
      drawPose(cv, searchPose(f), PLAYER_COLORS);
      const opaque = countOpaque(cv);
      expect(opaque, `search frame ${f} drew ${opaque} px`).toBeGreaterThan(200);
    }
  });

  it('keeps the silhouette inside the canvas', () => {
    for (const f of FRAMES) {
      const cv = makeCanvas(FRAME_W, FRAME_H);
      drawPose(cv, searchPose(f), PLAYER_COLORS);
      const box = boundingBox(cv);
      expect(box.minX, `search frame ${f} left`).toBeGreaterThanOrEqual(0);
      expect(box.maxX, `search frame ${f} right`).toBeLessThan(FRAME_W);
      expect(box.maxY, `search frame ${f} bottom`).toBeLessThan(FRAME_H);
      // 搜刮是踩在地上翻东西，靴底仍压地板线。
      expect(box.maxY, `search frame ${f} feet`).toBeGreaterThanOrEqual(FRAME_H - 4);
    }
  });

  it('keeps both feet planted: the bend is at the waist, not a squat', () => {
    // 髋留在待机高度，腿与待机同一副——所以腿恰好完全伸直、脚精确踩线、
    // 靴头朝前。弯腰发生在腰上（shoulder 贴近 hip），不是蹲下去。
    for (const f of FRAMES) {
      for (const a of bothFeet(searchPose(f))) {
        expect(a.y, `search frame ${f} foot at y=${a.y.toFixed(2)}`).toBeCloseTo(FOOT_GROUND, 6);
      }
    }
    expect(searchPose(0).hipY).toBeCloseTo(idlePose(0).hipY, 6);
    // 腰弯下去的证据：肩线比待机低一截，躯干被压短。
    expect(searchPose(0).shoulder.y).toBeGreaterThan(idlePose(0).shoulder.y + 5);
  });

  it('bends over: the head sits lower than the idle head', () => {
    // 工单点名的指标。idle 的 head.y≈19.3/17.3，搜刮必须明显更低，
    // 否则读作"站着抬手"而不是"弯腰"。
    for (const f of FRAMES) {
      expect(searchPose(f).head.y, `search frame ${f} head.y`).toBeGreaterThan(idlePose(f).head.y + 5);
    }
    // 而且头要往前送——面朝动作方向（比待机超前 4px）。
    expect(searchPose(0).head.x).toBeGreaterThan(idlePose(0).head.x + 3);
  });

  it('reaches forward with the arms', () => {
    // 手臂前伸：右前方像素带里必须有东西，且比垂手的待机多。
    const cv = makeCanvas(FRAME_W, FRAME_H);
    drawPose(cv, searchPose(0), PLAYER_COLORS);
    const idleCv = makeCanvas(FRAME_W, FRAME_H);
    drawPose(idleCv, idlePose(0), PLAYER_COLORS);
    expect(forwardPixels(cv)).toBeGreaterThan(forwardPixels(idleCv));
  });

  it('differs between the two frames', () => {
    const a = makeCanvas(FRAME_W, FRAME_H);
    const b = makeCanvas(FRAME_W, FRAME_H);
    drawPose(a, searchPose(0), PLAYER_COLORS);
    drawPose(b, searchPose(1), PLAYER_COLORS);
    expect(differs(a, b)).toBeGreaterThan(20);
  });

  it('wraps the frame index like the other cycles do', () => {
    expect(searchPose(2)).toEqual(searchPose(0));
    expect(searchPose(-1)).toEqual(searchPose(1));
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

/**
 * 右前方"手臂带"里的不透明像素数：x >= 46 的整列。
 *
 * 这条带是本项目里唯一能量化"手臂前伸量"的地方——站立时躯干最右只到
 * x≈41、头部最右只到 x≈44、背包在左侧 x≈12..35，所以带里出现像素就只能是
 * 前伸的手臂（含它的描边）。出拳帧约 35+，垂手/后引帧为 0。
 */
function forwardPixels(cv: PixelCanvas): number {
  let n = 0;
  for (let y = 0; y < cv.h; y++) {
    for (let x = 46; x < cv.w; x++) {
      if (cv.px[(y * cv.w + x) * 4 + 3] > 0) n++;
    }
  }
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
