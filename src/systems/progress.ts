import { GAME_CONFIG } from '../core/config';
import type { GameState, ItemId } from '../core/gameTypes';
import { modeScoreMult } from './modes';

// OVERHAUL W3（docs/OVERHAUL_M1.md）：深度纪录与 run 计分。
//
// 治的问题：无可炫耀进展——昨天爬到哪、这一跑值多少分，游戏嘴里说不出话。
// 公式抄 CENTUM（docs/RE_COMPETITIVE.md 源码级对标）：
//   runScore = 2×当前深度 + 宝藏分 + 目标分
// 深度系数 2 是主导项：多爬一层永远多得多捡一件普通物品，「向上攀升」
// 这一核心体验必须压在捡垃圾上面。

// 本 run 到达过的最深楼层。records 缺失（暴改前存档 / 未初始化）时退回当前
// 楼层——没有纪录就等于「现在就是纪录」。
export function depthRecord(state: GameState): number {
  return state.records?.deepestFloor ?? state.currentFloor;
}

// 把当前楼层写进纪录，只深不浅（取大）：纪录是跨 run 炫耀用的，跑得浅的一局
// 不能把之前的成绩抹掉。records 缺失时懒初始化。
export function recordDepth(state: GameState): void {
  if (!state.records) {
    state.records = { deepestFloor: state.currentFloor, bestScore: 0 };
  }
  if (state.currentFloor > state.records.deepestFloor) {
    state.records.deepestFloor = state.currentFloor;
  }
}

// 宝藏分的保守估价表。
//
// items.ts 没有 price 字段，而 W3 的文件所有权只有 progress.ts（不能改
// data/items.ts），所以在这里维护一张本地表。数值故意压低：宝藏分只是
// 「你确实刮了东西」的补贴，不是主食——消耗品和常见材料 1 分/件，医疗包 2、
// 撬棍 3 是仅有的例外。关键是任何单件普通物品都 < 2 分，保证 depth+1 永远
// 多过一件战利品（progress.test.ts 用具体数字钉死这一点）。
//
// 用 Record<ItemId, number> 全量枚举而不是 Partial + 默认值：将来有人往
// gameTypes.ts 加新道具时，这里会编译失败逼着补估价，而不是运行时算出
// undefined/NaN 的脏分。
const TREASURE_VALUE: Record<ItemId, number> = {
  clean_water: 1,
  dirty_water: 1,
  ration_pack: 1,
  bread: 1,
  medkit: 2,
  battery: 1,
  scrap_metal: 1,
  wood: 1,
  cloth: 1,
  tape: 1,
  filter: 1,
  wire: 1,
  fuse: 1,
  crowbar: 3,
  flashlight: 1,
};

// 包内物品按估价 × 数量累加。数量加权意味着囤 20 个废金属也只有 20 分，
// 仍然翻不过 10 层深度（2×10=20 打平），保持「深度主导」。
function treasureScore(state: GameState): number {
  let total = 0;
  for (const slot of state.player.inventory.slots) {
    total += TREASURE_VALUE[slot.itemId] * slot.quantity;
  }
  return total;
}

// run 计分（CENTUM 公式）：
//   2×当前深度 + 宝藏分 + 目标分
// - 当前深度取 state.currentFloor（本作「向上攀升」，楼层号即深度；这是本 run
//   实时到达的深度，不是 records.deepestFloor——纪录是跨 run 的，run 分只算
//   这一跑实际走到的位置）。
// - 目标分：records.bestScore 跨 run 累积、且无法拆分「哪些分来自目标」，
//   因此简化为二值——本 run 的日常目标已结算（dailyGoal.done，由
//   dailyGoals.grantDailyGoalReward 置位）时 +overhaul.dailyGoalRewardScore，
//   否则 0。
// - OVERHAUL Wave B2：快速跑按模式倍率放大整局得分——更紧的预算换更高的分。
export function runScore(state: GameState): number {
  const depth = state.currentFloor;
  const treasure = treasureScore(state);
  const goal = state.dailyGoal?.done === true ? GAME_CONFIG.overhaul.dailyGoalRewardScore : 0;
  return Math.round((2 * depth + treasure + goal) * modeScoreMult(state.mode ?? 'adventure'));
}
