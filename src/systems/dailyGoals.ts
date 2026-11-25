import { makeRng, deriveSeed } from '../core/rng';
import type { Rng } from '../core/rng';
import { GAME_CONFIG } from '../core/config';
import { PLAYABLE_FLOORS_V01 } from '../core/constants';
import { addItem, countItem } from './InventorySystem';
import { hasFlag, once, setFlag, flagKey } from './WorldFlags';
import type { GameState } from '../core/gameTypes';

// OVERHAUL W3（docs/OVERHAUL_M1.md）：每日目标。
//
// 治的问题：M1 试玩「无事干就睡」——一天没有任何「今天我要做成什么」的理由。
// 每天 06:00（由调用方在跨天时触发 ensureDailyGoal）懒生成 1 个目标，
// 完成给 overhaul.dailyGoalRewardScore 分 + 1 个压缩口粮，只发一次。
//
// 硬规则：禁 Math.random。目标由 deriveSeed(runSeed, day, 'daily-goal') 决定，
// 同 seed 同一天必然 roll 出同一个目标（可复现，见 dailyGoals.test.ts）。

// 直接复用 Lead 在 gameTypes.ts 预置的字段结构，避免两处定义漂移。
export type DailyGoalKind = NonNullable<GameState['dailyGoal']>['kind'];
export type DailyGoal = NonNullable<GameState['dailyGoal']>;

// v0.1 可玩楼层上限（constants.ts：1..5）。楼层目标永不越过它，否则目标
// 在当前版本里永远完不成——那等于没有目标。
const MAX_PLAYABLE_FLOOR = Math.max(...PLAYABLE_FLOORS_V01);

// 四类目标等权（各 25%）。没有为某类加权是因为四类分别对应四种玩法
// （补水/搜刮/建设/爬楼），加权等于官方偏爱某一种；等权让每天都有变化，
// 又不会连续两天都是同一类（概率上仍可能出现，但 seed 固定，玩家能感知到
// 「今天冲楼层、明天补水」的节奏差异）。
const KIND_WEIGHTS: ReadonlyArray<{ kind: DailyGoalKind; upTo: number }> = [
  { kind: 'water', upTo: 0.25 },
  { kind: 'containers', upTo: 0.5 },
  { kind: 'upgrade', upTo: 0.75 },
  { kind: 'floor', upTo: 1.0 },
];

// 每个目标的达标量。区间按「一天内合理可达成」定：净水 2-3 瓶（起始就带 3
// 瓶，商人 2 脏水换 1 净水，一天凑得到）；容器 3-4 个（每层若干容器，顺路
// 搜三层即达）；升级固定 1（一次建造就是一件正事）；楼层 2-4 且钳到可玩上限。
function rollTarget(rng: Rng, kind: DailyGoalKind): number {
  switch (kind) {
    case 'water':
      return rng.nextInt(2, 3);
    case 'containers':
      return rng.nextInt(3, 4);
    case 'upgrade':
      return 1;
    case 'floor': {
      // 理论保险：即便将来可玩上限被调到 3，目标也不会生成 4 层这种死目标。
      const cap = Math.max(2, Math.min(4, MAX_PLAYABLE_FLOOR));
      return rng.nextInt(2, cap);
    }
  }
}

// 由 (runSeed, day) 决定当天的目标。抽取顺序固定：先 kind 后 target——
// 换顺序会改变同一 seed 的结果，测试与存档复现都依赖这个顺序。
function rollDailyGoal(state: GameState): DailyGoal {
  const rng = makeRng(deriveSeed(state.runSeed, state.day, 'daily-goal'));
  const roll = rng.nextFloat();
  const row = KIND_WEIGHTS.find((w) => roll < w.upTo) ?? KIND_WEIGHTS[KIND_WEIGHTS.length - 1];
  return { day: state.day, kind: row.kind, target: rollTarget(rng, row.kind), done: false };
}

// 懒生成：state.dailyGoal 缺失（旧存档）或 day 不匹配（跨天了）时 roll 一个新
// 目标。当天已存在则原样保留——重复调用必须幂等，否则每次 tick 都换目标，
// 玩家永远追不上一个移动靶。
export function ensureDailyGoal(state: GameState): void {
  const goal = state.dailyGoal;
  if (goal && goal.day === state.day) return;
  state.dailyGoal = rollDailyGoal(state);
}

// 当天已搜刮容器总数。visitedFloors 是「本 run 到访过的楼层」，没有逐日时间
// 戳；而一个 run 的生命周期以天计（time.victoryDay=8），跨天时目标整体重 roll，
// 因此按当前 run 累计值计即等效于「当天」。
function openedContainersTotal(state: GameState): number {
  let total = 0;
  for (const visit of Object.values(state.visitedFloors)) {
    total += visit.openedContainers.length;
  }
  return total;
}

// 纯判定：不读 dailyGoal.done、不写任何状态。done 的语义是「完成且已结算」
// （见 grantDailyGoalReward），与「现在是否达标」是两个问题——玩家可能在结算
// 后喝掉达标用的净水，判定函数不应因此改口。
export function isDailyGoalDone(state: GameState): boolean {
  const goal = state.dailyGoal;
  if (!goal) return false;
  switch (goal.kind) {
    case 'water':
      return countItem(state.player.inventory, 'clean_water') >= goal.target;
    case 'containers':
      return openedContainersTotal(state) >= goal.target;
    case 'upgrade':
      return state.player.homeUpgrades.length >= goal.target;
    case 'floor':
      return state.currentFloor >= goal.target;
  }
}

// 结算奖励：达标且未结算过 → 发 1 次（records.bestScore +dailyGoalRewardScore，
// 背包 +1 压缩口粮），返回 true；否则 false。
//
// 「只发一次」现在走 flag（once:goal-paid:<day>），不再复用 dailyGoal.done。
// 过去 done 一个字段扛两个语义——「目标已完成」和「奖励已结算」——因为
// records 的契约字段只有 deepestFloor / bestScore，加不进 rewarded。现在 flag
// 有地方放了，两个语义分开：done 只回答「结算过了吗」，是否达标由
// isDailyGoalDone 实时判定（玩家可能在结算后喝掉达标用的净水，那时 done 仍为
// true 但已达标为 false，两者本就不该绑死）。
export function grantDailyGoalReward(state: GameState): boolean {
  const goal = state.dailyGoal;
  if (!goal) return false;
  if (!isDailyGoalDone(state)) return false;
  // 同一天只结算一次。flag 带上 day，跨天自动失效，不需要清理昨天的标记。
  const paidKey = flagKey.once(`goal-paid:${goal.day}`);
  // 旧存档迁移：flag 之前，「已结算」只由 done=true 表达。那份存档若没有对应
  // flag，说明它是在换标记之前结过账的——不迁移就会因为换了记号再发一次。
  if (goal.done && !hasFlag(state, paidKey)) setFlag(state, paidKey);
  if (!once(state, paidKey)) return false;

  goal.done = true;

  // records 懒初始化：createNewGame 现已预置 { deepestFloor, bestScore: 0 }，
  // 但暴改前的旧存档没有该字段，首次结算时补上。deepestFloor 用当前楼层兜底，
  // 之后由 progress.recordDepth 维护。
  if (!state.records) {
    state.records = { deepestFloor: state.currentFloor, bestScore: 0 };
  }
  state.records.bestScore += GAME_CONFIG.overhaul.dailyGoalRewardScore;

  // 背包满时口粮加不进来（addItem 报 overflow）。此时不撤回分数也不退标记：
  // flag 已置位，重复调用返回 false，玩家不会因为「捡不起来」被卡在可重复
  // 领取的状态里；满包提示交给 HUD（W4/W5）。
  addItem(state.player.inventory, 'ration_pack', 1);
  return true;
}
