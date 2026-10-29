// W2 (docs/OVERHAUL_M1.md)：巡游体威胁 AI。治 B3-06 实测的「只杀不动的人」——
// 原版巡游体只是匀速追人，站着不动和疯狂走位的应对成本一样，玩家学会绕圈
// 它就只是个背景板。这里把它改成纯状态机：
//
//   stalking ──玩家在 lungeRange 内且静止够久──▶ lunge ──2s 到点 / 玩家大跳──▶ cooldown ──3s──▶ stalking
//
// 设计目标（OVERHAUL_M1 目标体验 4）：「那东西盯上我的时候我知道」——
// 站着必死（2.2 倍速扑击），走路看操作（一动就重新计时），扑空后有 3 秒
// 明确喘息窗口，形成「压迫—释放」循环而不是无限追杀。
//
// 纯逻辑：不 import Phaser、不读全局、不碰 GameState。场景每帧调用
// stepWandererAI 拿速度倍率，自己负责移动精灵、回写 selfX 与受击判定
// （lunge 中命中掉血加倍属于场景侧，见 docs/OVERHAUL_M1.md W2）。

import { GAME_CONFIG } from '../core/config';

export interface WandererAI {
  state: 'stalking' | 'lunge' | 'cooldown';
  /** 玩家上一帧的 x：每帧用 |playerX - lastX| 算玩家这一帧的位移 */
  lastX: number;
  /**
   * 巡游体自身的 x：AI 不移动自己，距离判定（lungeRange）需要它，
   * 由场景每帧移动精灵后回写。任务给的接口建议里没有这个字段，但
   * 「ai 与玩家距离」必须有个 ai 侧坐标才能算，故就近补上（可选方案
   * 是改成 stepWandererAI 多传一个 wandererX 参数，字段方式对场景
   * 接线更直白：场景本来就要持有巡游体位置）。
   */
  selfX: number;
  /** stalking 态累计的「玩家静止时长」；玩家一动就清零 */
  stillMs: number;
  /** lunge 剩余毫秒数，归零即自然结束 */
  lungeMsLeft: number;
  /** cooldown 剩余毫秒数，归零回 stalking */
  cooldownMsLeft: number;
}

// 扑击持续 2s、扑完冷却 3s（工单规定值）。冷却期只有 0.6 倍速：巡游体也
// 要「喘气」，玩家拿到的是明确的逃脱窗口，不是无限被追。
const LUNGE_MS = 2000;
const COOLDOWN_MS = 3000;
const COOLDOWN_SPEED_MULTIPLIER = 0.6;
const STALKING_SPEED_MULTIPLIER = 1;

// OVERHAUL_M1.md W2：「玩家在 lungeRange 内且 1.5s 位移 < 40px → lunge」。
// 40px 是「整个静止窗口内允许的最大位移」，折算成速度阈值 40px/1.5s≈26.7px/s，
// 再按帧时长折算成「每帧位移限额」——这样 30fps 和 144fps 下同一个走位
// 动作判定一致，不会帧率一高原地站人就被扑、帧率一低走路反而触发。
const STILL_BAND_PX = 40;
const STILL_SPEED_PX_PER_S = STILL_BAND_PX / (GAME_CONFIG.overhaul.lungeStillnessMs / 1000);

// lunge 中「玩家大幅移动」阈值：单帧位移 > 60px 视为甩脱（工单规定值）。
// 注意正常走位每帧位移只有个位数 px，这个阈值抓的是瞬移、切后台前的极端
// 掉帧（dt 数百 ms）这类「不讲理」的位移；常规逃脱靠的是 2s 扑击窗口
// 自然结束，不是指望这个打断。
const LUNGE_BREAK_MOVE_PX = 60;

// x = 巡游体出生点（场景 spawn 时传入）。lastX 先锚在出生点：首帧 step 时
// 若玩家在别处，|playerX - lastX| 会超过静止限额，lastX 自动改锚到玩家
// 真实位置——一帧内自愈，场景无需额外初始化，顺带给了玩家一小段生成宽限。
export function freshWandererAI(x: number): WandererAI {
  return {
    state: 'stalking',
    lastX: x,
    selfX: x,
    stillMs: 0,
    lungeMsLeft: 0,
    cooldownMsLeft: 0,
  };
}

// 每帧调用一次。原地推进状态机并返回本帧速度倍率；ai 为引用修改（与
// tickDwell 同一约定，场景持有同一个对象）。dtMs 允许任意正值（测试里
// 直接传 1500 也行）；负值/0 按 0 处理，防止暂停回退把计时器推爆。
export function stepWandererAI(
  ai: WandererAI,
  playerX: number,
  dtMs: number,
): { speedMultiplier: number; state: WandererAI['state'] } {
  const dt = Math.max(0, dtMs);
  switch (ai.state) {
    case 'stalking': {
      // 每帧位移 vs 按帧长折算的静止限额：超了就是「在走」，静止计时清零。
      const moved = Math.abs(playerX - ai.lastX);
      ai.lastX = playerX;
      ai.stillMs = moved > STILL_SPEED_PX_PER_S * (dt / 1000) ? 0 : ai.stillMs + dt;
      const distance = Math.abs(playerX - ai.selfX);
      if (
        distance < GAME_CONFIG.overhaul.lungeRange &&
        ai.stillMs >= GAME_CONFIG.overhaul.lungeStillnessMs
      ) {
        // 进入扑击：stillMs 清零——扑击结束后要重新站够 1.5s 才会再扑，
        // 否则 cooldown 一结束就会立刻二连扑。
        ai.state = 'lunge';
        ai.lungeMsLeft = LUNGE_MS;
        ai.stillMs = 0;
        return { speedMultiplier: GAME_CONFIG.overhaul.lungeSpeedMultiplier, state: ai.state };
      }
      return { speedMultiplier: STALKING_SPEED_MULTIPLIER, state: ai.state };
    }
    case 'lunge': {
      const moved = Math.abs(playerX - ai.lastX);
      ai.lastX = playerX;
      // 玩家一帧内瞬移/大跳 > 60px：甩脱，提前结束扑击进冷却。
      if (moved > LUNGE_BREAK_MOVE_PX) {
        ai.state = 'cooldown';
        ai.lungeMsLeft = 0;
        ai.cooldownMsLeft = COOLDOWN_MS;
        ai.stillMs = 0;
        return { speedMultiplier: COOLDOWN_SPEED_MULTIPLIER, state: ai.state };
      }
      ai.lungeMsLeft = Math.max(0, ai.lungeMsLeft - dt);
      if (ai.lungeMsLeft <= 0) {
        // 2s 扑击窗口自然结束（扑空或没追上）：同样进冷却——状态机是
        // stalking→lunge→cooldown→stalking 的闭环，不存在 lunge 直回
        // stalking 的边，否则 2.2 倍速可以靠「马上再站满 1.5s」无限续。
        ai.state = 'cooldown';
        ai.cooldownMsLeft = COOLDOWN_MS;
        ai.stillMs = 0;
        return { speedMultiplier: COOLDOWN_SPEED_MULTIPLIER, state: ai.state };
      }
      return { speedMultiplier: GAME_CONFIG.overhaul.lungeSpeedMultiplier, state: ai.state };
    }
    case 'cooldown': {
      ai.lastX = playerX; // 持续同步锚点，冷却结束切回 stalking 首帧不会误判位移
      ai.cooldownMsLeft = Math.max(0, ai.cooldownMsLeft - dt);
      if (ai.cooldownMsLeft <= 0) {
        ai.state = 'stalking';
        ai.stillMs = 0; // 重新站够 1.5s 才能触发下一次扑击
        return { speedMultiplier: STALKING_SPEED_MULTIPLIER, state: ai.state };
      }
      return { speedMultiplier: COOLDOWN_SPEED_MULTIPLIER, state: ai.state };
    }
  }
}
