// W4 反馈层（docs/OVERHAUL_M1.md）：把"玩家现在有多危险"翻译成可渲染的数字。
//
// 治两个实测问题：
// 1. 界面无紧迫感——HP 见底时屏幕上没有任何东西在催玩家，死了都不知道怎么死的；
// 2. 精力不构成预算——ALTACIMA 里"饥饿+精力决定能走多远"，本作 energy 掉到 20 以下
//    只是数字变色，走路速度一点没变，精力预算形同虚设。
//
// 硬约束（工单 W4）：零 Phaser 依赖、纯函数、可在 Node 单测里直接跑。
// 渲染层（GameScene 的红晕/高亮/减速）只消费这里的返回值，逻辑全部集中在此，
// 调手感不用改场景代码。所有阈值读 config/game-balance.json 的 overhaul 块
// （单一数据源）：调节奏只改 JSON，不会出现代码与配置各说各话。

import { GAME_CONFIG } from '../core/config';

/** 四条生存槽位的快照。字段与 PlayerState（gameTypes.ts）同名，渲染层每帧从 state.player 构造。 */
export interface SurvivalStats {
  hp: number;
  hunger: number;
  thirst: number;
  energy: number;
}

/** mostUrgentStat 的返回值：最危急的槽位名，与 gameTypes.ts 的 StatKey 对齐。 */
export type UrgentStat = 'hp' | 'hunger' | 'thirst' | 'energy';

// --- 配置读数（改平衡只动 config/game-balance.json） ---------------------------

const LOW_HP_PULSE_THRESHOLD = GAME_CONFIG.overhaul.lowHpPulseThreshold; // 0.3：HP 红晕起脉冲的归一化线
const LOW_ENERGY_THRESHOLD = GAME_CONFIG.overhaul.lowEnergyThreshold; // 20：精力减速线（原始值，非归一化）
const LOW_ENERGY_SPEED_FACTOR = GAME_CONFIG.overhaul.lowEnergySpeedFactor; // 0.75：见底时的移动系数

// --- 内部常量 -----------------------------------------------------------------

const TAU = Math.PI * 2;

// 脉冲周期随严重度从 1200ms（刚跌破阈值，缓慢呼吸）线性缩到 400ms（HP 见底，狂闪）。
const PULSE_PERIOD_MAX_MS = 1200;
const PULSE_PERIOD_MIN_MS = 400;

// 强度 = 0.5 × 严重度（基础项）+ 0.5 × 正弦波（脉动项）。基础项保证"越低越红"，
// 正弦项让红晕"活着"而不是一块死红的贴图；两项权重各半，和的理论范围为 [-0.5, 1]。
const BASE_WEIGHT = 0.5;
const PULSE_WEIGHT = 0.5;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

// --- lowHpPulse：红晕强度 ------------------------------------------------------

/**
 * 返回 0..1 的屏幕红晕强度（alpha），渲染层直接拿来当红色叠层的 alpha。
 *
 * 数学（阈值 threshold = 0.3）：
 *   ratio    = hp / hpMax，夹到 [0,1]；
 *   ratio >= threshold            → 0（安全区不画红晕）；
 *   severity = (threshold - ratio) / threshold ∈ (0,1]（阈值处 0，HP 归零 1）；
 *   period   = 1200ms + (400ms - 1200ms) × severity（越低脉冲越快，1200→400ms 线性）；
 *   pulse    = sin(2π × nowMs / period) ∈ [-1,1]；
 *   intensity = clamp01(0.5 × severity + 0.5 × pulse)。
 *
 * 说明：severity=1（HP 归零）时理论最大 1.0；正弦负半周会把低严重度压到负数，
 * 所以末端必须 clamp01——alpha 越界多数渲染器会静默夹掉，但单测要的是契约。
 */
export function lowHpPulse(hp: number, hpMax: number, nowMs: number): number {
  // 上限非正数时比例没有意义（坏档/未初始化），按"不脉冲"处理而不是 NaN 扩散。
  if (!(hpMax > 0)) return 0;
  const ratio = clamp01(hp / hpMax); // 同时兜住 hp<0 与 hp>hpMax 的脏数据
  if (ratio >= LOW_HP_PULSE_THRESHOLD) return 0;
  const severity = (LOW_HP_PULSE_THRESHOLD - ratio) / LOW_HP_PULSE_THRESHOLD;
  const periodMs = PULSE_PERIOD_MAX_MS + (PULSE_PERIOD_MIN_MS - PULSE_PERIOD_MAX_MS) * severity;
  const pulse = Math.sin((TAU * nowMs) / periodMs);
  return clamp01(BASE_WEIGHT * severity + PULSE_WEIGHT * pulse);
}

// --- mostUrgentStat：最危急槽位 -------------------------------------------------

// 各槽位危险线：HP 用 overhaul.lowHpPulseThreshold（0.3）——玩家看到红晕和 HUD
// 高亮永远是同一件事，两条线分裂会让人觉得界面在说谎；饥饿/口渴/精力用 0.25，
// 这三条不秒人，线放低一点避免从早到晚都在报警，线本身失去意义。
const URGENT_THRESHOLDS: Record<UrgentStat, number> = {
  hp: GAME_CONFIG.overhaul.lowHpPulseThreshold,
  hunger: 0.25,
  thirst: 0.25,
  energy: 0.25,
};

// 归一化上限也走配置：四条槽 max 目前都是 100，但一旦 JSON 调过，比值比较依然正确。
const STAT_MAXES: Record<UrgentStat, number> = {
  hp: GAME_CONFIG.player.hpMax,
  hunger: GAME_CONFIG.player.hungerMax,
  thirst: GAME_CONFIG.player.thirstMax,
  energy: GAME_CONFIG.player.energyMax,
};

// 平票时的固定优先序。归一化比值精确相等是可能的（同初始值同步衰减），
// 没有固定顺序会让 HUD 高亮在两行之间每帧乱跳；HP 能秒人排最前。
const URGENT_PRIORITY: readonly UrgentStat[] = ['hp', 'hunger', 'thirst', 'energy'];

/**
 * 返回归一化后最低、且已低于各自危险线的槽位；全部安全返回 null。
 * 平票（比值精确相等）按 URGENT_PRIORITY 取靠前者：hp > hunger > thirst > energy。
 */
export function mostUrgentStat(p: SurvivalStats): UrgentStat | null {
  let worst: UrgentStat | null = null;
  let worstRatio = Number.POSITIVE_INFINITY;
  for (const stat of URGENT_PRIORITY) {
    const max = STAT_MAXES[stat];
    if (!(max > 0)) continue; // 配置里上限非正数：该槽不参与比较
    const ratio = p[stat] / max;
    if (ratio >= URGENT_THRESHOLDS[stat]) continue; // 阈值及以上 = 安全（严格小于才报警）
    if (ratio < worstRatio) {
      // 严格小于才替换，平局保留优先序里更靠前的槽位。
      worstRatio = ratio;
      worst = stat;
    }
  }
  return worst;
}

// --- moveSpeedFactor：精力预算的手感层 ------------------------------------------

/**
 * 精力预算（ALTACIMA"饥饿+精力决定能走多远"的手感层）：energy < 20 → ×0.75，否则 ×1。
 * 用严格小于：刚好 20 点时还能全速走，这是精力预算的明确边界——掉到线下的瞬间
 * 走得动但明显拖慢，玩家才会主动规划吃饭/睡觉，而不是无视这条槽。
 *
 * 入参带全部四条槽位是为了调用方便（渲染层手里本来就是整份 player 快照），
 * 本函数只读 energy，其余字段不影响结果。
 */
export function moveSpeedFactor(p: SurvivalStats): number {
  return p.energy < LOW_ENERGY_THRESHOLD ? LOW_ENERGY_SPEED_FACTOR : 1;
}
