import { describe, expect, it } from 'vitest';

import { freshWandererAI, stepWandererAI } from '../systems/wandererAI';
import type { WandererAI } from '../systems/wandererAI';
import { GAME_CONFIG } from '../core/config';

// W2: the wanderer threat state machine (docs/OVERHAUL_M1.md). What matters:
// standing still inside lungeRange for lungeStillnessMs must lunge, moving must
// reset the timer, the lunge is a bounded 2s burst at the config multiplier,
// a >60px single-frame player displacement breaks it early, cooldown is 3s at
// 0.6x, and the cycle closes back to stalking. All thresholds come from
// GAME_CONFIG.overhaul so the tests track the balance file, not a copy of it.

const { lungeRange, lungeStillnessMs, lungeSpeedMultiplier } = GAME_CONFIG.overhaul;

// 常见布阵：巡游体在 0，玩家钉在 distance 处（默认 100，在 lungeRange 内）。
// 场景每帧移动精灵后回写 ai.selfX，这里在布阵时直接写好。
function pair(distance = 100): { ai: WandererAI; playerX: number } {
  const ai = freshWandererAI(0);
  ai.selfX = 0;
  return { ai, playerX: distance };
}

describe('freshWandererAI', () => {
  it('starts stalking with empty timers and both x fields seeded', () => {
    const ai = freshWandererAI(320);
    expect(ai.state).toBe('stalking');
    expect(ai.stillMs).toBe(0);
    expect(ai.lastX).toBe(320);
    expect(ai.selfX).toBe(320);
    expect(ai.lungeMsLeft).toBe(0);
    expect(ai.cooldownMsLeft).toBe(0);
  });

  it('re-anchors lastX onto the player on the first step (spawn grace)', () => {
    // 出生点在 0、玩家在 500：首帧 |500-0| 远超静止限额，lastX 改锚，
    // 玩家拿到一小段生成宽限，之后才累计静止时长。
    const ai = freshWandererAI(0);
    stepWandererAI(ai, 500, 16);
    expect(ai.lastX).toBe(500);
    expect(ai.stillMs).toBe(0);
    stepWandererAI(ai, 500, lungeStillnessMs);
    expect(ai.stillMs).toBe(lungeStillnessMs);
  });
});

describe('stalking', () => {
  it('creeps at 1x and never lunges on its own', () => {
    const { ai, playerX } = pair(100);
    const r = stepWandererAI(ai, playerX, 16); // 距离 100 < 220，但玩家没站够
    expect(r.speedMultiplier).toBe(1);
    expect(r.state).toBe('stalking');
    expect(ai.state).toBe('stalking');
  });

  it('lunges once the player has stood still for lungeStillnessMs inside lungeRange', () => {
    const { ai, playerX } = pair(100);
    stepWandererAI(ai, playerX, 16); // 首帧锚定 lastX
    stepWandererAI(ai, playerX, lungeStillnessMs - 1);
    expect(ai.state).toBe('stalking');
    expect(ai.stillMs).toBe(lungeStillnessMs - 1);
    const r = stepWandererAI(ai, playerX, 1); // 再站 1ms 到阈值
    expect(ai.state).toBe('lunge');
    expect(ai.lungeMsLeft).toBe(2000);
    expect(ai.stillMs).toBe(0); // 扑击期间静止计时清零，结束后要重新站
    expect(r.speedMultiplier).toBe(lungeSpeedMultiplier);
    expect(r.state).toBe('lunge');
  });

  it('does not lunge at exactly lungeRange, but does one pixel closer', () => {
    const atEdge = pair(lungeRange);
    stepWandererAI(atEdge.ai, atEdge.playerX, 16); // 锚定
    for (let t = 0; t < 3000; t += 16) stepWandererAI(atEdge.ai, atEdge.playerX, 16);
    expect(atEdge.ai.state).toBe('stalking'); // 距离恰为 220，不满足 < 220

    const justInside = pair(lungeRange - 1);
    stepWandererAI(justInside.ai, justInside.playerX, 16); // 锚定
    stepWandererAI(justInside.ai, justInside.playerX, lungeStillnessMs);
    expect(justInside.ai.state).toBe('lunge');
  });

  it('resets the stillness timer when the player moves', () => {
    const { ai, playerX } = pair(100);
    stepWandererAI(ai, playerX, 16); // 锚定
    stepWandererAI(ai, playerX, 1000);
    expect(ai.stillMs).toBe(1000);
    stepWandererAI(ai, playerX + 60, 16); // 位移 60px，远超每帧静止限额
    expect(ai.stillMs).toBe(0);
    stepWandererAI(ai, playerX + 60, 1400);
    expect(ai.state).toBe('stalking'); // 重新计时要站满 1.5s
    stepWandererAI(ai, playerX + 60, 100); // 1400 + 100 = 1500
    expect(ai.state).toBe('lunge');
  });

  it('never lunges at a walking player, at any frame rate', () => {
    // 每帧 30px（≈1875px/s 的极端快走）：16 / 33 / 100ms 帧下都该清零。
    // selfX 每帧跟着玩家走，确保「不扑」是因为移动清零而不是距离。
    for (const frame of [16, 33, 100]) {
      const ai = freshWandererAI(0);
      let x = 500;
      for (let t = 0; t < 5000; t += frame) {
        ai.selfX = x - 100; // 场景契约：巡游体移动后回写 selfX
        const r = stepWandererAI(ai, x, frame);
        x += 30;
        expect(r.state).toBe('stalking');
      }
    }
  });

  it('treats a slow creep inside the 40px-per-window budget as standing still', () => {
    // OVERHAUL_M1 的「1.5s 位移 < 40px」：20px/s 慢爬 1.5s 只移动 30px < 40px，
    // 视为站着不动，到点照扑。用 100ms 帧：每帧移动 2px，静止限额 2.67px。
    const ai = freshWandererAI(0);
    let x = 500;
    ai.selfX = x - 1; // 一直在射程内
    stepWandererAI(ai, x, 100); // 首帧锚定 lastX（出生点在 0，这一帧算宽限）
    for (let t = 100; t <= lungeStillnessMs + 100; t += 100) {
      x += 20 * 0.1; // 每 100ms 帧移动 2px
      ai.selfX = x - 1;
      stepWandererAI(ai, x, 100);
    }
    expect(ai.state).toBe('lunge');
  });

  it('uses the scene-synced selfX for the range gate', () => {
    // 站满 1.5s 时距离 500 太远不扑；巡游体自己走近后回写 selfX，立刻扑。
    const ai = freshWandererAI(0);
    stepWandererAI(ai, 500, 16); // 锚定
    stepWandererAI(ai, 500, lungeStillnessMs);
    expect(ai.state).toBe('stalking');
    ai.selfX = 400; // 场景把巡游体移到 400（距离 100）
    const r = stepWandererAI(ai, 500, 0); // dt=0：不推进时间，只判定
    expect(r.state).toBe('lunge');
  });
});

describe('lunge', () => {
  // 造一个已进入 lunge 的 ai（巡游体在 400，玩家钉在 500）。
  function lungingAI(): WandererAI {
    const ai = freshWandererAI(0);
    ai.selfX = 400;
    stepWandererAI(ai, 500, 16); // 锚定 lastX=500
    stepWandererAI(ai, 500, lungeStillnessMs);
    expect(ai.state).toBe('lunge');
    return ai;
  }

  it('runs 2000ms at the lunge multiplier, then drops into a 3000ms cooldown', () => {
    const ai = lungingAI();
    const r1 = stepWandererAI(ai, 500, 1999);
    expect(ai.state).toBe('lunge');
    expect(ai.lungeMsLeft).toBe(1);
    expect(r1.speedMultiplier).toBe(lungeSpeedMultiplier);
    const r2 = stepWandererAI(ai, 500, 1);
    expect(ai.state).toBe('cooldown');
    expect(ai.cooldownMsLeft).toBe(3000);
    expect(ai.lungeMsLeft).toBe(0);
    expect(r2.speedMultiplier).toBe(0.6);
  });

  it('breaks early when the player displaces more than 60px in one frame', () => {
    const ai = lungingAI();
    const r = stepWandererAI(ai, 561, 16); // 单帧位移 61 > 60
    expect(ai.state).toBe('cooldown');
    expect(ai.cooldownMsLeft).toBe(3000);
    expect(ai.lungeMsLeft).toBe(0);
    expect(r.speedMultiplier).toBe(0.6);
  });

  it('a 60px single-frame move is not enough to break it', () => {
    const ai = lungingAI();
    stepWandererAI(ai, 560, 16); // 恰好 60，不满足 > 60
    expect(ai.state).toBe('lunge');
    expect(ai.lungeMsLeft).toBe(1984); // 2000 - 16
  });
});

describe('cooldown', () => {
  it('crawls at 0.6x and returns to stalking after 3000ms', () => {
    const ai = freshWandererAI(0);
    ai.selfX = 400;
    stepWandererAI(ai, 500, 16);
    stepWandererAI(ai, 500, lungeStillnessMs);
    stepWandererAI(ai, 500, 2000); // lunge 自然结束 → cooldown
    expect(ai.state).toBe('cooldown');
    const r1 = stepWandererAI(ai, 500, 2999);
    expect(ai.state).toBe('cooldown');
    expect(r1.speedMultiplier).toBe(0.6);
    const r2 = stepWandererAI(ai, 500, 1);
    expect(ai.state).toBe('stalking');
    expect(ai.stillMs).toBe(0); // 回 stalking 后静止计时从零开始
    expect(r2.speedMultiplier).toBe(1);
  });

  it('completes the full cycle: stand → lunge → cooldown → stand → lunge again', () => {
    const ai = freshWandererAI(0);
    ai.selfX = 400;
    stepWandererAI(ai, 500, 16);
    stepWandererAI(ai, 500, lungeStillnessMs);
    expect(ai.state).toBe('lunge');
    stepWandererAI(ai, 500, 2000);
    expect(ai.state).toBe('cooldown');
    stepWandererAI(ai, 500, 3000);
    expect(ai.state).toBe('stalking');
    stepWandererAI(ai, 500, lungeStillnessMs);
    expect(ai.state).toBe('lunge');
    expect(ai.lungeMsLeft).toBe(2000); // 新一轮扑击满状态
  });
});

describe('dt guard', () => {
  it('treats negative and zero dt as no time passing', () => {
    const { ai, playerX } = pair(100);
    stepWandererAI(ai, playerX, 16); // 锚定
    stepWandererAI(ai, playerX, 1000);
    expect(ai.stillMs).toBe(1000);
    stepWandererAI(ai, playerX, -500); // 暂停/回退：不许把计时器推爆
    expect(ai.stillMs).toBe(1000);
    stepWandererAI(ai, playerX, 0);
    expect(ai.stillMs).toBe(1000);
    expect(ai.state).toBe('stalking');
  });
});
