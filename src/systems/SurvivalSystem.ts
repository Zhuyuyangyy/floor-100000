import { GAME_CONFIG } from '../core/config';
import { DAY_START_MINUTE, MINUTES_PER_DAY, SURVIVAL_BALANCE, environmentFor, warmthOf } from '../core/constants';
import { devEntry } from '../core/devMode';
import type { AilmentId, GameState, SicknessTier } from '../core/gameTypes';
import { grantGrowthXp } from '../core/growth';
import { modeDecayMult } from './modes';
import { hungerLossMult } from './relics';
import { settleInvestments } from './shop';
import { BODY_TEMP_MAX, bodyTempOf, tickEnvironment, type EnvironmentTick } from './EnvironmentSystem';
import { SEVERITY_CRITICAL, hasAilment, inflict, tickSickness, type SicknessTick } from './SicknessSystem';
import { beginDayMorale, tickMorale, type MoraleTick } from './MoraleSystem';

// Time & survival rules (docs/01_GDD.md §5-6, config/game-balance.json).
// Pure & deterministic: Phaser only feeds the real-time delta; these functions
// mutate GameState and report discrete events for the scene to react to.

// HP lost per game-hour while dehydrated or starving. Not in game-balance.json,
// so defined here as a tunable starting value.
export const HP_STARVE_LOSS_PER_HOUR = 4;

// Clamp a single frame's delta so a backgrounded tab cannot fast-forward survival
// (docs/02_TECH_SPEC.md §3: no frame-rate-dependent survival).
export const MAX_FRAME_MS = 250;

// Autosave cadence in game minutes. The clock advances gameMinutesPerRealSecond
// game-minutes per real second, so saving on every whole minute would mean
// several writes per second; this bounds how much time and decay a closed tab
// can roll back while staying cheap (GHI-03 M3).
export const AUTOSAVE_EVERY_GAME_MINUTES = 5;

// Monotonic minute index across days, so a midnight rollover cannot look like
// "no time passed" and skip an autosave.
export function absoluteMinute(state: GameState): number {
  return state.day * MINUTES_PER_DAY + Math.floor(state.gameMinuteOfDay);
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

// ── bodyHeat：契约字段与工作字段之间的桥（TWOM 对齐契约第一节）────────────
// EnvironmentSystem（2026-11-07 的体温系统）以 player.bodyTemp 为工作字段，
// GameScene / SaveSystem / 既有测试都读它；契约把同一个 stat 定名为 bodyHeat。
// EnvironmentSystem 与 GameScene 不属 AG-25（不能改），所以不合并名字，而是在
// 每个 tick 后镜像：新代码（睡眠回温/失温/疾病三档）只读 bodyHeat。
export function bodyHeatOf(state: GameState): number {
  const p = state.player;
  if (typeof p.bodyHeat !== 'number' || !Number.isFinite(p.bodyHeat)) {
    // 体温系统之后、契约之前写下的存档有 bodyTemp 没有 bodyHeat：继承读数，
    // 而不是把半冻着的玩家重置成满体温。
    p.bodyHeat = typeof p.bodyTemp === 'number' && Number.isFinite(p.bodyTemp) ? p.bodyTemp : BODY_TEMP_MAX;
  }
  return clamp(p.bodyHeat, 0, BODY_TEMP_MAX);
}

/** 写体温：契约字段与工作字段一起写，两个名字永远同一个数。 */
export function setBodyHeat(state: GameState, value: number): number {
  const v = clamp(value, 0, BODY_TEMP_MAX);
  state.player.bodyHeat = v;
  state.player.bodyTemp = v;
  return v;
}

// ── ProcessSickness：疾病中间态三档（TWOM 对齐契约第一节）─────────────────
// 档位由 ailments 的 worst severity 派生，不是第二套病程：sick = severity 到
// SEVERITY_BITING（25，属性消耗开始加速），critical = 到 SEVERITY_CRITICAL
// （100，开始自己掉血）。两套各自演化必然漂移，派生不会。
// SEVERITY_BITING 在 SicknessSystem 里未导出（25），此处同源复刻并钉注释。
const SICK_THRESHOLD = 25;

export interface SicknessTierTick {
  tier: SicknessTier;
  /** healthy -> sick/critical this tick */
  becameSick: boolean;
  /** anything below critical -> critical this tick */
  becameCritical: boolean;
  /** back to healthy this tick */
  recovered: boolean;
  /**
   * 病了但本 tick 什么都没变——TWOM 日记的 DwellerSicknessNoEffect（机制拆解
   * §1 规律 2：「没有效果」也是一条记录）。每天最多置一次，它是给日记/提示
   * 的记录位，不是每帧警报。
   */
  sickNoEffect: boolean;
  /** 本次病程开始的那一天（sicknessDay） */
  day: number;
}

function worstAilmentSeverity(state: GameState): number {
  let worst = 0;
  for (const a of state.player.ailments ?? []) worst = Math.max(worst, a.severity);
  return worst;
}

function tierForSeverity(severity: number): SicknessTier {
  if (severity >= SEVERITY_CRITICAL) return 'critical';
  if (severity >= SICK_THRESHOLD) return 'sick';
  return 'healthy';
}

/** 当前疾病档位（读；不写）。 */
export function sicknessOf(state: GameState): SicknessTier {
  return tierForSeverity(worstAilmentSeverity(state));
}

// 「病了但没恶化」的每日告知门牌。模块级，与 SicknessSystem 的 freezeSince
// 同一理由：它是「今天告知过没有」的会话期计量，不是存档事实——重载中途不该
// 继承半个门牌。resetSicknessTimers() 一并清掉它（测试用）。
let sickNoEffectNotifiedDay = -1;

/**
 * 重算疾病三档并写回 player.sickness / player.sicknessDay，返回本 tick 的
 * 迁移。每个推进时间的 tick 末尾调一次（sleep 的夜间结算也调）。
 */
export function tickSicknessTier(state: GameState): SicknessTierTick {
  const before: SicknessTier = state.player.sickness ?? 'healthy';
  const tier = sicknessOf(state);
  let day = state.player.sicknessDay ?? 0;
  if (tier !== 'healthy' && before === 'healthy') day = state.day; // 新病程从今天算
  state.player.sickness = tier;
  state.player.sicknessDay = day;
  const sickNoEffect = tier !== 'healthy' && before === tier && state.day !== sickNoEffectNotifiedDay;
  if (sickNoEffect) sickNoEffectNotifiedDay = state.day;
  return {
    tier,
    becameSick: before === 'healthy' && tier !== 'healthy',
    becameCritical: before !== 'critical' && tier === 'critical',
    recovered: before !== 'healthy' && tier === 'healthy',
    sickNoEffect,
    day,
  };
}

// ── 染病条件（ProcessSickness 的入口侧）──────────────────────────────────
// TWOM §3 的 ProcessSickness 既要「病程推进」也要「染上」。推进在
// SicknessSystem.tickSickness（既有），染上分三条：
//   1. 体温过低持续 —— SicknessSystem 已有（FREEZE_TO_COLD_MINUTES=90 分钟
//      失温染冻伤），不重复造；
//   2. 饥饿/口渴归零 N 小时 —— 本条新增。身体开始消耗自己，染发烧；
//   3. 潮湿 + 危险高的楼层入夜持续 M 分钟 —— 本条新增。渗水的危险楼道里
//      深夜不动就是着凉，染发烧。
// 两条都染 fever 而不是新病种：fever 的 cause（damp || starving）正好在这两个
// 条件下成立，条件撤掉后它自己开始好转——因果闭环，不需要额外状态机。
// 两个计时器与 freezeSince 同型：计量「当前这一轮」，reload 不继承。
let starveSince: number | undefined;
let exposureSince: number | undefined;

/** 清空会话期计时器（测试用；运行时不需要——条件消失即自清）。 */
export function resetSicknessTimers(): void {
  starveSince = undefined;
  exposureSince = undefined;
  sickNoEffectNotifiedDay = -1;
}

/** 评估染病条件，返回本 tick 新染上的病（没有则空数组）。 */
export function contractSickness(state: GameState, gameMinutes: number): AilmentId[] {
  if (state.status !== 'playing' || gameMinutes <= 0) return [];
  const cfg = SURVIVAL_BALANCE.sickness;
  const now = absoluteMinute(state);
  const contracted: AilmentId[] = [];

  // 条件二：饥饿/口渴归零 N 小时。
  const starving = state.player.hunger <= 0 || state.player.thirst <= 0;
  if (starving) {
    if (starveSince === undefined) starveSince = now;
    else if (now - starveSince >= cfg.starveGameHours * 60 && !hasAilment(state, 'fever')) {
      inflict(state, 'fever', cfg.exposureSeverity, now);
      contracted.push('fever');
      starveSince = undefined; // 染上即交回给 tickSickness 的病程
    }
  } else {
    starveSince = undefined;
  }

  // 条件三：潮湿 + 危险高的楼层，入夜后持续 M 分钟。
  const env = environmentFor(state.currentFloor);
  const exposed =
    env.humidity >= cfg.exposureHumidity && env.danger >= cfg.exposureDanger && isNight(state.gameMinuteOfDay);
  if (exposed) {
    if (exposureSince === undefined) exposureSince = now;
    else if (now - exposureSince >= cfg.exposureGameMinutes && !hasAilment(state, 'fever')) {
      inflict(state, 'fever', cfg.exposureSeverity, now);
      contracted.push('fever');
      exposureSince = undefined;
    }
  } else {
    exposureSince = undefined;
  }

  return contracted;
}

export interface TimeTick {
  gameMinutes: number;
  dayChanged: boolean;
  died: boolean;
  won: boolean;
  /** body heat's transition this tick, if any */
  environment?: EnvironmentTick;
  /** what the ailments did this tick, if anything */
  sickness?: SicknessTick;
  /** what the morale pool did this tick, if anything */
  morale?: MoraleTick;
  /** the disease tier (healthy/sick/critical) after this tick */
  sicknessTier?: SicknessTierTick;
  /** ailments contracted this tick (饥饿归零 N 小时 / 潮湿危险夜） */
  contracted?: AilmentId[];
}

const NONE: TimeTick = { gameMinutes: 0, dayChanged: false, died: false, won: false };
export function formatClock(minuteOfDay: number): string {
  const m = ((Math.floor(minuteOfDay) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(Math.floor(m % 60)).padStart(2, '0');
  return `${hh}:${mm}`;
}

function applyDecay(state: GameState, gameMinutes: number): void {
  const hours = gameMinutes / 60;
  const p = state.player;
  const cfg = GAME_CONFIG.player;
  // OVERHAUL Wave B2/B3: the mode scales the drain (quick tighter, easy
  // softer) and the iron-stomach relic cuts hunger specifically. Both are
  // multipliers on the shipped rate, so the baseline config stays the truth.
  const modeMult = modeDecayMult(state.mode ?? 'adventure');
  const relicHunger = hungerLossMult(state.relics ?? []);
  p.hunger = clamp(p.hunger - cfg.hungerLossPerGameHour * hours * modeMult * relicHunger, 0, cfg.hungerMax);
  p.thirst = clamp(p.thirst - cfg.thirstLossPerGameHour * hours * modeMult, 0, cfg.thirstMax);
  p.energy = clamp(p.energy - cfg.energyLossPerGameHour * hours, 0, cfg.energyMax);
  if (p.hunger <= 0 || p.thirst <= 0) {
    p.hp = clamp(p.hp - HP_STARVE_LOSS_PER_HOUR * hours, 0, cfg.hpMax);
  }
}

// The retired v0.1 win threshold: reach day 8 at/after 06:00 still alive. The
// frozen design replaces it with reaching the summit (B8), so production never
// auto-wins on the calendar — only the ?devwin=1 fixture still honours this.
export function isLegacyVictory(state: GameState): boolean {
  const t = GAME_CONFIG.time;
  return state.day >= t.victoryDay && state.gameMinuteOfDay >= t.victoryMinute;
}

// The shared clock engine. Both the frame loop and discrete action costs go
// through here so a 20-minute search rolls the day over and charges decay under
// exactly the same rules as 20 minutes of walking (B3-03).
function advanceGameMinutes(state: GameState, gameMinutes: number): TimeTick {
  if (state.status !== 'playing') return NONE;
  if (gameMinutes <= 0) return NONE;

  let minute = state.gameMinuteOfDay + gameMinutes;
  let dayChanged = false;
  while (minute >= MINUTES_PER_DAY) {
    minute -= MINUTES_PER_DAY;
    state.day += 1;
    // AG-14: 产业按日结算——跨过午夜就结刚结束那天（无投资时是 no-op，
    // 只写一个水位标记）。挂在时钟引擎里而不是场景里：推进时间的每条
    // 路径（帧循环 advanceTime / 动作 spendTime / 睡觉 sleep）都汇到
    // 这里或下面，日结因此真的随时间发生，AG-05 遗留的
    // "productionDecay/priceJitter 没有调用方"到此闭环。
    settleInvestments(state);
    // TWOM DepressionChangeOnDayBegin：心情基线每天漂一点（战争把默认情绪
    // 往下拉）。日滚循环和 sleep() 都跨天，两条路径都过这里，基线才不会
    // 只在一条路径上动。
    beginDayMorale(state);
    dayChanged = true;
  }
  state.gameMinuteOfDay = minute;
  if (dayChanged) state.worldEvents.activeEvent = null; // fresh roll each day

  applyDecay(state, gameMinutes);
  // Body heat rides the same clock as the other three bars, so standing on floor
  // 4 for twenty minutes costs the same whether those minutes were walked or
  // spent searching a container (B3-03).
  const env = tickEnvironment(state, gameMinutes);
  // 契约字段镜像：EnvironmentSystem 以 bodyTemp 为工作字段，bodyHeat（契约名）
  // 每个 tick 跟上，新代码只读 bodyHeat。
  state.player.bodyHeat = bodyTempOf(state);
  // Ailments ride it too, and they read the body heat the same tick just set.
  const sick = tickSickness(state, gameMinutes);
  // 染病条件在病程之后评估：本 tick 刚被推到底的饥渴/体温立刻参与判定。
  const contracted = contractSickness(state, gameMinutes);
  // 心情点数池向基线回落（TWOM DepressionLoss）。
  const morale = tickMorale(state, gameMinutes);
  // 疾病三档重算：染上、恶化、好转的迁移都从这里出。
  const sickTier = tickSicknessTier(state);
  // 契约的「0 = 失温失败」：体温归零后按配置速率掉 HP。EnvironmentSystem 已在
  // FREEZING_THRESHOLD(10) 以下开始扣，这是到底的那一档——与饥渴归零同一种
  // 升级方式，不是瞬杀。
  if (bodyHeatOf(state) <= 0) {
    state.player.hp = clamp(
      state.player.hp - SURVIVAL_BALANCE.sickness.hypothermiaHpPerGameHour * (gameMinutes / 60),
      0,
      GAME_CONFIG.player.hpMax,
    );
  }

  if (state.player.hp <= 0) {
    state.player.hp = 0;
    state.status = 'lost';
    return { gameMinutes, dayChanged, died: true, won: false, environment: env, sickness: sick, morale, sicknessTier: sickTier, contracted };
  }
  if (devEntry().legacyWin && isLegacyVictory(state)) {
    state.status = 'won';
    return { gameMinutes, dayChanged, died: false, won: true, environment: env, sickness: sick, morale, sicknessTier: sickTier, contracted };
  }
  return { gameMinutes, dayChanged, died: false, won: false, environment: env, sickness: sick, morale, sicknessTier: sickTier, contracted };
}

// Advances the clock by a real-time delta, applies survival decay, and resolves
// loss (HP 0). No-op once ended.
export function advanceTime(state: GameState, deltaMs: number): TimeTick {
  const clampedMs = clamp(deltaMs, 0, MAX_FRAME_MS);
  return advanceGameMinutes(state, (clampedMs / 1000) * GAME_CONFIG.time.gameMinutesPerRealSecond);
}

// B3-03: charges a discrete action its game-time cost. A day is a budget, not a
// countdown — without this, one full sweep of five floors costs 4.5 game hours
// and the player idles through the other 9.75.
export function spendTime(state: GameState, gameMinutes: number): TimeTick {
  return advanceGameMinutes(state, gameMinutes);
}

// Game-minutes each action costs, from config/game-balance.json so pacing can be
// tuned without touching code.
export const ACTION_COSTS = GAME_CONFIG.actionCosts;

// The minutes a given sleep actually skips: from now (or from the 20:00 gate,
// whichever is later) to 06:00 the next day. Sleeping at 02:00 skips a shorter
// night than sleeping at 20:00 — the extra awake hours were already charged at
// the waking rate by advanceTime, so staying out still costs more in total.
export function sleepNightMinutes(minuteOfDay: number): number {
  const from = Math.max(minuteOfDay, GAME_CONFIG.time.nightRiskStartMinute);
  return MINUTES_PER_DAY - from + GAME_CONFIG.time.dayStartMinute;
}

// Resting metabolises at half the waking rate. Sleeping is therefore not a free
// time skip — the audit found the rule was implicit and untested, with sleep
// applying no hunger or thirst at all. Charging the night at a named rate makes
// "go home before dark" a real decision: resting is cheaper than staying awake
// and it keeps the wanderer off you, but it is not zero.
export const REST_METABOLISM = 0.5;

// The night's bill. Energy is deliberately NOT charged: recovering it is the
// whole point of going to bed, and billing it here would undo the restore on the
// line above.
function applyRestDecay(state: GameState, hours: number): void {
  const p = state.player;
  const cfg = GAME_CONFIG.player;
  const rest = REST_METABOLISM;
  p.hunger = clamp(p.hunger - cfg.hungerLossPerGameHour * rest * hours, 0, cfg.hungerMax);
  p.thirst = clamp(p.thirst - cfg.thirstLossPerGameHour * rest * hours, 0, cfg.thirstMax);
  if (p.hunger <= 0 || p.thirst <= 0) {
    p.hp = clamp(p.hp - HP_STARVE_LOSS_PER_HOUR * rest * hours, 0, cfg.hpMax);
  }
}

export interface SleepTicks {
  /** what the morale pool did overnight */
  morale?: MoraleTick;
  /** the disease tier after the night */
  sicknessTier?: SicknessTierTick;
  /** ailments contracted during the night (starving through the night) */
  contracted?: AilmentId[];
}

export type SleepResult = ({ ok: true; won: boolean; newDay: number } & SleepTicks) | { ok: false; reason: string };
// Sleep in the dorm to pass the night: only from 20:00, advances to next 06:00,
// restores energy, and charges the skipped night's hunger and thirst at the
// resting rate. The retired day-8 auto-win only applies under ?devwin=1.
export function sleep(state: GameState): SleepResult {
  if (state.status !== 'playing') return { ok: false, reason: '游戏已结束' };
  if (state.gameMinuteOfDay < GAME_CONFIG.time.nightRiskStartMinute) {
    return { ok: false, reason: '还太早，无法入睡（20:00 后）' };
  }
  const nightHours = sleepNightMinutes(state.gameMinuteOfDay) / 60;
  const nightMinutes = sleepNightMinutes(state.gameMinuteOfDay);
  state.day += 1;
  // TWOM DepressionChangeOnDayBegin：与 advanceGameMinutes 的日滚循环同一个
  // 入口——睡醒也跨天，基线不能只在一条路径上漂。
  beginDayMorale(state);
  state.gameMinuteOfDay = GAME_CONFIG.time.dayStartMinute;
  state.player.energy = GAME_CONFIG.player.energyMax;
  // AG-14: 睡醒即跨日，产业结算跟着醒来一起发生（无投资时 no-op）。
  // 与 advanceGameMinutes 的日滚循环走同一个入口，水位标记保证同一天
  // 不会被两条路径重复结算。
  settleInvestments(state);
  // Charged after the clock moves, so a player who wakes up starving sees it
  // immediately rather than a minute later.
  applyRestDecay(state, nightHours);
  state.worldEvents.activeEvent = null; // fresh roll each day
  // AG-25 夜间结算。TWOM 的 ProcessSleep 与 ProcessSickness / TickTemperature
  // 并列（机制拆解 §3）：睡过的夜本身要结账，睡眠也因此是一条恢复路径——
  // 夜里没有白天那些 cause，病情自己好转；宿舍的床按楼层 warmth 回温。
  // 夜间死亡由调用方收口（ShelterSystem.finishNight 在 sleep 后查 hp）。
  //
  // 1) 床是宿舍的热源：回温速率乘楼层 warmth（warmthOf：template 微调 →
  //    JSON 默认梯 → 0）。warmth=0 的楼层（3F）睡了也冷——「在哪睡」是个
  //    真实决定。
  const warmth = warmthOf(state.currentFloor);
  setBodyHeat(state, bodyHeatOf(state) + SURVIVAL_BALANCE.sickness.sleepBodyHeatPerHour * warmth * nightHours);
  // 2) 病情不在夜间推进——这是既有行为，也是有意为之：睡觉治病已经由
  //    ShelterSystem.finishNight 的 rest 行动实现并记账（按 curedBy 过滤、
  //    回报 healedAilments，且有测试钉住「rest clears sleep-cured ailments」）。
  //    夜里再跑一遍 tickSickness 会把同一个冻伤治两遍，还把功劳从 rest 行动
  //    上抢走。要 TWOM 式「夜里病情自己好转」，得先让 ShelterSystem 把 rest
  //    的 cure 改成「夜间结算之后按 curedBy 收尾」并更新那个测试——本轮不做，
  //    记在 TWOM_ALIGNMENT.md 的 AG-25 实现说明里。
  // 3) 染病判定过夜：饿着入睡的人会在夜里染病——饥饿计量跨睡前睡后不断。
  const contracted = contractSickness(state, nightMinutes);
  // 4) 心情点数池向（刚漂过的）基线回落，跟其它小时一样。
  const morale = tickMorale(state, nightMinutes);
  // 5) 疾病三档重算：睡前染的病，今早的读数要反映出来。
  const sickTier = tickSicknessTier(state);
  // B5: a full night in the dorm is the survival line's "安睡一晚 +10"
  // (docs/plans/GROWTH_INTERFACES.md §5). The night was already a real
  // decision — the resting metabolism bill proves it — but it taught the
  // survival line nothing, so the line could only ever be fed by eating and
  // drinking. Granted after the clock and the bill are applied, so the reward
  // describes a night that actually happened.
  grantGrowthXp(state, 'survival', 10);
  const won = devEntry().legacyWin && isLegacyVictory(state);
  if (won) state.status = 'won';
  return { ok: true, won, newDay: state.day, morale, sicknessTier: sickTier, contracted };
}

export function deathCause(state: GameState): string {
  if (state.player.thirst <= 0) return '严重脱水';
  if (state.player.hunger <= 0) return '饥饿';
  // 契约「0 = 失温失败」：体温归零是一种死法，值得被单独命名。
  if (bodyHeatOf(state) <= 0) return '失温';
  return '伤势过重';
}

// Night is 18:00 -> 06:00 (day runs 06:00-18:00).
export const NIGHT_START_MINUTE = 1080;
export function isNight(minuteOfDay: number): boolean {
  return minuteOfDay >= NIGHT_START_MINUTE || minuteOfDay < DAY_START_MINUTE;
}
