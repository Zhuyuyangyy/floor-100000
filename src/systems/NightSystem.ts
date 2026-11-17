// AG-64：夜晚二选一（出去找物资 / 在家守夜）与「NPC 偷东西」的纯判定层。
//
// 用户 2026-11-17 原话：「晚上的话应该会提示我们是出去找物资还是在家里守夜，
// 防止别的 npc 抢我们的东西」。本文件只放纯函数（seeded RNG + 状态标记的
// 读写），场景（GameScene）负责弹面板、flash、音效与保存——所以每个分支都能
// 在 node 里被单测钉住，不需要起 Phaser。
//
// 三条设计红线：
//   1. 禁 Math.random：所有随机走 deriveSeed/makeRng（docs/02_TECH_SPEC.md §3），
//      同 (runSeed, 夜) 同结果，重进楼层不重 roll、读档不重 roll。
//   2. survivalBalance 不许被偷坏：偷取只碰「家（1 层）容器里、模板非 guaranteed、
//      且玩家还没取走」的堆。每层 guaranteed 的水/食与地面 guaranteed 物资
//      （survivalBalance.test.ts 的 worldSources 把它们全部记作 guaranteed 来源）
//      永远不在小偷清单上。所以本模块偷的是「概率 roll 出来的余粮」，
//      不是生存契约件。
//   3. 后台模拟：小偷不生成精灵满楼跑。玩家不在那一层也能算——结果写进
//      visitedFloors[STARTING_FLOOR].localEvents（存档白拿持久性），被偷的堆
//      以键形式并入 lootedItems（楼层视图随即不再显示它们），玩家回层时
//      由场景给证据（flash + 容器空了）。

import { STARTING_FLOOR } from '../core/constants';
import type { GameState, ItemId } from '../core/gameTypes';
import { deriveSeed, makeRng } from '../core/rng';
import { FLOOR_TEMPLATES, containerItemKey } from '../data/floorTemplates';
import { getItem } from '../data/items';
import { getFloorView, recordFloorVisit } from './LootSystem';
import { isNight, NIGHT_START_MINUTE } from './SurvivalSystem';
import balance from '../../config/game-balance.json' with { type: 'json' };

// ── 配置（config/game-balance.json 的 nightWatch 段）───────────────────────
// 与 AG-51 的 bunks 同一手法：core/config.ts 的接口属主在 core，本工单不碰，
// 直读 JSON 后 as 一下。缺键会在第一次调用时以 undefined 炸出来，比静默走
// 默认值诚实。
export interface NightWatchBalance {
  /** 入夜后多少游戏分钟，NPC 起意造访 */
  theftDelayMinutes: number;
  /** 造访判定概率（seeded） */
  theftChance: number;
  /** 造访到得手之间的窗口：玩家赶回家即阻止 */
  stealWindowMinutes: number;
  /** 得手后偷走的堆数下限 */
  lossMin: number;
  /** 得手后偷走的堆数上限 */
  lossMax: number;
  /** 生存契约件（水/食）永不被偷 */
  protectSurvivalItems: boolean;
}

export const NIGHT_WATCH: NightWatchBalance = (balance as unknown as { nightWatch: NightWatchBalance }).nightWatch;

// 生存契约件：与 floorTemplates 的 SURVIVAL_ITEM_IDS 同表（那边是模块私有）。
// protectSurvivalItems 打开时，这些 itemId 连「非 guaranteed 的概率 roll」形态
// 也不许进小偷清单——1 层储物柜的净水本来就是 guaranteed，这是双保险。
const SURVIVAL_ITEM_IDS: readonly ItemId[] = ['clean_water', 'dirty_water', 'ration_pack', 'bread'];

// ── 一夜的状态标记 ─────────────────────────────────────────────────────────
// 全部住在 visitedFloors[STARTING_FLOOR].localEvents（字符串数组，SaveSystem
// 的 VISIT_KEYS 已含它，存档/读档白拿持久性）。前缀互不撞：
//   night-choice:{day}:scavenge   选了「出去」
//   night-choice:{day}:watch      选了「守夜」
//   night-choice:{day}:dismissed  弹窗被拒（今夜不再问）
//   night-visit:{day}             NPC 造访判定过了且来了
//   night-safe:{day}              无人造访 / 被玩家拦下
//   night-theft:{day}[:label:details]  得手了（details 记少了什么）
//   night-theft-seen:{day}        证据已经 flash 给玩家看过
export type NightChoice = 'scavenge' | 'watch';

const P = 'night';
export const nightChoiceKey = (day: number, choice: NightChoice): string => `${P}-choice:${day}:${choice}`;
export const nightDismissedKey = (day: number): string => `${P}-choice:${day}:dismissed`;
export const nightVisitKey = (day: number): string => `${P}-visit:${day}`;
export const nightSafeKey = (day: number): string => `${P}-safe:${day}`;
export const nightTheftKey = (day: number): string => `${P}-theft:${day}`;
export const nightTheftSeenKey = (day: number): string => `${P}-theft-seen:${day}`;

/** 本地事件标记在不在（不创建访问记录，纯读）。 */
export function hasNightEvent(state: GameState, key: string): boolean {
  return state.visitedFloors[STARTING_FLOOR]?.localEvents.includes(key) ?? false;
}

/**
 * 得手标记在不在。带细节的长形态（night-theft:{day}:{label}:{details}）也算——
 * applyNightTheft 写的是长形态，只有「空手而归」才写裸键。settled 判定与
 * 睡觉收口都走这个谓词，否则一次得手会被状态机反复重判。
 */
export function hasNightTheft(state: GameState, day: number): boolean {
  const events = state.visitedFloors[STARTING_FLOOR]?.localEvents ?? [];
  const bare = nightTheftKey(day);
  return events.some((e) => e === bare || e.startsWith(bare + ':'));
}

function addNightEvent(state: GameState, key: string): void {
  const events = recordFloorVisit(state, STARTING_FLOOR).localEvents;
  if (!events.includes(key)) events.push(key);
}

// ── 夜的时间几何 ───────────────────────────────────────────────────────────
// 夜是 18:00 → 次日 06:00（isNight），跨午夜。「今夜」的归属：
// 18:00 之后属于当天，00:00-06:00 属于前一天——标记因此按「夜开始的那天」
// 计日，读档/跨午夜都不会换一夜。

/** 当前所处的「第几夜」；白天返回 null。 */
export function currentNightDay(state: GameState): number | null {
  if (!isNight(state.gameMinuteOfDay)) return null;
  return state.gameMinuteOfDay >= NIGHT_START_MINUTE ? state.day : state.day - 1;
}

/** 入夜至今的游戏分钟（18:00 = 0，01:00 = 420）。 */
export function nightElapsedMinutes(minuteOfDay: number): number {
  return minuteOfDay >= NIGHT_START_MINUTE
    ? minuteOfDay - NIGHT_START_MINUTE
    : minuteOfDay + (1440 - NIGHT_START_MINUTE);
}

/** 今晚的选择；没选过返回 null，拒过返回 'dismissed'。 */
export function nightChoiceFor(state: GameState, day: number): NightChoice | 'dismissed' | null {
  if (hasNightEvent(state, nightChoiceKey(day, 'scavenge'))) return 'scavenge';
  if (hasNightEvent(state, nightChoiceKey(day, 'watch'))) return 'watch';
  if (hasNightEvent(state, nightDismissedKey(day))) return 'dismissed';
  return null;
}

/** 今晚还能不能问二选一（没选过也没拒过）。 */
export function nightChoicePending(state: GameState): boolean {
  const day = currentNightDay(state);
  if (day === null) return false;
  return nightChoiceFor(state, day) === null;
}

export function recordNightChoice(state: GameState, choice: NightChoice): void {
  addNightEvent(state, nightChoiceKey(currentNightDay(state) ?? state.day, choice));
}

export function recordNightDismissal(state: GameState): void {
  addNightEvent(state, nightDismissedKey(currentNightDay(state) ?? state.day));
}

// ── 偷取目标池 ─────────────────────────────────────────────────────────────

export interface StealableStack {
  /** lootedItems 键（containerItemKey） */
  key: string;
  itemId: ItemId;
  quantity: number;
  containerId: string;
  containerLabel: string;
}

/**
 * 家（默认 1 层）里小偷动得的东西：容器中还没被玩家取走、且模板里没有
 * guaranteed 条目的堆。
 *
 * 为什么按模板而不是按生成结果：generateFloor 把概率 roll 解析成了
 * InventoryStack，guaranteed 标记只存在于模板的 LootSpec 上。逐容器把视图
 * 里的堆对回模板 spec——同 itemId 只要有一条 guaranteed 就整类保护（保守）。
 * 地面物资全部记作 guaranteed（survivalBalance 的 worldSources 就这么记），
 * 因此天然不在池里；生成式容器（2-3 层的床铺）不在模板里，家里也没有，跳过。
 */
export function stealableStacks(state: GameState, floor: number = STARTING_FLOOR): StealableStack[] {
  const template = FLOOR_TEMPLATES[floor];
  if (!template) return [];
  const view = getFloorView(state, floor);
  const out: StealableStack[] = [];
  for (const c of view.containers) {
    const spec = template.containers.find((t) => t.id === c.id);
    if (!spec) continue;
    for (const item of c.items) {
      const specs = spec.loot.filter((l) => l.itemId === item.itemId);
      if (specs.some((l) => l.guaranteed === true)) continue;
      if (NIGHT_WATCH.protectSurvivalItems && SURVIVAL_ITEM_IDS.includes(item.itemId)) continue;
      out.push({
        key: containerItemKey(c.id, item.itemId),
        itemId: item.itemId,
        quantity: item.quantity,
        containerId: c.id,
        containerLabel: c.label,
      });
    }
  }
  return out;
}

// ── seeded 判定 ────────────────────────────────────────────────────────────

/** NPC 今晚是否起意造访（一次性判定，同 seed 同夜同结果）。 */
export function rollNightVisit(state: GameState, day: number): boolean {
  return makeRng(deriveSeed('night-theft-visit', state.runSeed, day)).chance(NIGHT_WATCH.theftChance);
}

export interface NightTheftRoll {
  /** 得手后偷走的堆（空 = 来过但什么也没拿走） */
  stolen: StealableStack[];
}

/**
 * 从池里挑 lossMin..lossMax 堆（部分 Fisher-Yates，seeded）。
 * 池比上限小就全拿走；池为空则空手而归。
 */
export function rollNightTheft(state: GameState, day: number, pool: StealableStack[]): NightTheftRoll {
  const rng = makeRng(deriveSeed('night-theft-loss', state.runSeed, day));
  const take = Math.max(0, Math.min(pool.length, rng.nextInt(NIGHT_WATCH.lossMin, NIGHT_WATCH.lossMax)));
  const items = [...pool];
  const stolen: StealableStack[] = [];
  for (let i = 0; i < take; i++) {
    const j = i + rng.nextInt(0, items.length - 1 - i);
    const swap = items[i];
    items[i] = items[j];
    items[j] = swap;
    stolen.push(items[i]);
  }
  return { stolen };
}

/**
 * 落账：被偷的键并入 lootedItems（楼层视图随即不再显示它们），并写下带
 * 细节的得手标记。返回给玩家看的那句「少了什么」（空串 = 空手而归）。
 */
export function applyNightTheft(state: GameState, day: number, roll: NightTheftRoll): string {
  const visit = recordFloorVisit(state, STARTING_FLOOR);
  for (const s of roll.stolen) {
    if (!visit.lootedItems.includes(s.key)) visit.lootedItems.push(s.key);
  }
  const details = roll.stolen.map((s) => `${getItem(s.itemId).displayName}×${s.quantity}`).join('、');
  const label = roll.stolen[0]?.containerLabel ?? '';
  addNightEvent(state, details ? `${nightTheftKey(day)}:${label}:${details}` : nightTheftKey(day));
  return details;
}

// ── 一夜的后台模拟（场景每帧调一次） ───────────────────────────────────────

export type NightWatchStepKind = 'none' | 'visited' | 'prevented' | 'stolen';

export interface NightWatchStep {
  kind: NightWatchStepKind;
  /** kind === 'stolen' 时：少了什么（空串 = 空手而归） */
  details?: string;
}

/**
 * 推进一夜的偷取模拟，返回这一步发生了什么事（场景只负责 flash/音效/保存）。
 *
 * 状态机（全部以标记为准，因此读档/跨午夜/睡一觉都连续）：
 *   未选「出去」            → none（守夜/拒弹/没问过都不武装偷取）
 *   入夜 < delay            → none
 *   到 delay，未判过        → rollNightVisit：没来 → safe 标记，none；来了 → visit 标记，visited
 *   来了，未结清，< delay+window → none（玩家还有机会赶回）
 *   到 delay+window         → 玩家在家 → safe 标记，prevented；不在家 → 偷，stolen
 */
export function stepNightWatch(state: GameState, playerOnHomeFloor: boolean): NightWatchStep {
  if (state.status !== 'playing') return { kind: 'none' };
  const night = currentNightDay(state);
  if (night === null) return { kind: 'none' };
  if (nightChoiceFor(state, night) !== 'scavenge') return { kind: 'none' };
  const elapsed = nightElapsedMinutes(state.gameMinuteOfDay);
  if (elapsed < NIGHT_WATCH.theftDelayMinutes) return { kind: 'none' };

  const visitRolled = hasNightEvent(state, nightVisitKey(night));
  const settled = hasNightEvent(state, nightSafeKey(night)) || hasNightTheft(state, night);
  if (!visitRolled && !settled) {
    if (!rollNightVisit(state, night)) {
      addNightEvent(state, nightSafeKey(night)); // 今夜无人造访
      return { kind: 'none' };
    }
    addNightEvent(state, nightVisitKey(night));
    return { kind: 'visited' };
  }
  if (!visitRolled || settled) return { kind: 'none' };
  if (elapsed < NIGHT_WATCH.theftDelayMinutes + NIGHT_WATCH.stealWindowMinutes) return { kind: 'none' };

  if (playerOnHomeFloor) {
    addNightEvent(state, nightSafeKey(night));
    return { kind: 'prevented' };
  }
  const details = applyNightTheft(state, night, rollNightTheft(state, night, stealableStacks(state)));
  return { kind: 'stolen', details };
}

// ── 证据与睡觉收口 ─────────────────────────────────────────────────────────

export interface NightTheftEvidence {
  day: number;
  /** 被翻的容器名（空手而归时为空） */
  containerLabel: string;
  /** 少了什么（空 = 空手而归） */
  details: string;
}

const THEFT_MARKER = /^night-theft:(\d+)(?::([^:]*):(.*))?$/;

/** 还没给玩家看过的小偷证据（回层/睡醒时由场景 flash）。 */
export function unreportedNightTheft(state: GameState): NightTheftEvidence | null {
  const events = state.visitedFloors[STARTING_FLOOR]?.localEvents ?? [];
  for (const marker of events) {
    const m = THEFT_MARKER.exec(marker);
    if (!m) continue;
    const day = Number(m[1]);
    if (hasNightEvent(state, nightTheftSeenKey(day))) continue;
    return { day, containerLabel: m[2] ?? '', details: m[3] ?? '' };
  }
  return null;
}

export function markNightTheftSeen(state: GameState, day: number): void {
  addNightEvent(state, nightTheftSeenKey(day));
}

/**
 * 睡觉前把悬挂的造访判定结清：人都躺进自己被窝了，小偷无从下手。
 * 返回「是否真拦下了一次造访」（场景可在睡醒台词里提一句）。
 */
export function settlePendingVisitOnSleep(state: GameState): boolean {
  const night = currentNightDay(state);
  if (night === null) return false;
  if (!hasNightEvent(state, nightVisitKey(night))) return false;
  if (hasNightEvent(state, nightSafeKey(night)) || hasNightTheft(state, night)) return false;
  addNightEvent(state, nightSafeKey(night));
  return true;
}

/** 睡醒台词里关于昨夜的一句（null = 无事发生）。已经看过就返回 null。 */
export function nightWatchWakeNote(state: GameState): string | null {
  const theft = unreportedNightTheft(state);
  if (theft) {
    markNightTheftSeen(state, theft.day);
    return theft.details
      ? ` · 夜里好像有人来过……${theft.containerLabel}被翻过，少了${theft.details}`
      : ' · 夜里好像有人来过……翻过的地方早就空了';
  }
  return null;
}

/** 回层时的证据台词（null = 无事发生）。看过一次后返回 null。 */
export function nightWatchEvidenceNote(state: GameState): string | null {
  const theft = unreportedNightTheft(state);
  if (!theft) return null;
  markNightTheftSeen(state, theft.day);
  return theft.details
    ? `夜里好像有人来过……${theft.containerLabel}被翻过，少了${theft.details}`
    : '夜里好像有人来过……翻过的地方早就空了';
}

// 偷取的目标恒为家；导出供测试与场景引用同一口径。
export const NIGHT_HOME_FLOOR = STARTING_FLOOR;
