import type { GameState } from '../core/gameTypes';
import { STARTING_FLOOR } from '../core/constants';
import { STAT_MAX } from './InventorySystem';
import { NIGHT_START_MINUTE } from './SurvivalSystem';
import { AILMENTS, type SicknessTick } from './SicknessSystem';
import { bumpFlag, flagCount, hasFlag, setFlag } from './WorldFlags';

const DEFAULT_STRESS = 20;

function clampStress(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * 应用一次压力变化并返回新值（夹在 0..100）。
 *
 * RC-01 之前，压力变化寄生在旧日记的 appendDiaryEvent 里（每条旧条目带
 * stressDelta，写日记顺带改压力）。旧日记随双轨制统一退出生产后，压力
 * 应用改为显式调用——ShelterSystem 的休息降压（-6/-10/-4/-12）与夜袭
 * 增压（+10）直接调它，数值与旧路径逐字节一致。缺 stress 字段的旧存档
 * 按 20 起算（与 SaveSystem 的旧档修补同源）。
 */
export function stressAfterEvent(state: GameState, delta: number): number {
  const current = typeof state.player.stress === 'number' && Number.isFinite(state.player.stress)
    ? state.player.stress
    : DEFAULT_STRESS;
  return clampStress(current + delta);
}

// ────────────────────────────────────────────────────────────────────────────
// 契约 §5：结构化日记（docs/plans/TWOM_ALIGNMENT.md 第五节，类型定死）
//
// 这是 11 bit 在 TWOM 里用 42 种 KosovoDiaryEntry* 类回答的问题——「什么
// 值得玩家记住」。形状刻意收窄到五个字段：kind 决定语义，actorId 决定
// 个体/群体双轨，其余交给时间戳。
//
// 三条从 TWOM 抄来的规律，实现里逐条对应：
//   1. 个体与群体双轨——dwellerHungry（actorId='player'，一个人饿是私事）
//      与 groupHungry（actorId=null，一群人饿是事件）同时存在；
//   2. 「没有效果」也是一条记录——dwellerSickNoEffect：病了但没恶化，仍然
//      告知。系统看在眼里，只是这次没事；
//   3. 迟归单独成条——lateFromScavenge：外出的人没按时回来，本身就是事件，
//      不用等出事。
//
// RC-01 之前这里还有第二套日记：旧 DiaryEvent[]（state.diary，8 种宽记录
// kind，生产者只有 ShelterSystem，读者是宿舍面板与 NPC 对话）。双轨制已
// 统一到本套：ShelterSystem 改写 recordDiary，读者改读 diaryOf，旧档里的
// 旧日记由 migrateLegacyDiary 迁进来（见文件末尾）。旧 API
// （makeDiaryEvent/appendDiaryEvent/recentDiary）与 DiaryEvent 类型已移除。
//
// 不替代 flash()：flash 是即时反馈（一秒后消失），diary 是「什么值得记住」
// 的结构化记录（进存档、可回放、可按 flag 查询）。两者并存。

/** 契约 §5 定死的 11 种日记条目。 */
export type DiaryKind =
  | 'dwellerHungry' | 'groupHungry'
  | 'dwellerMorale'
  | 'dwellerWounded'
  | 'dwellerSick' | 'dwellerSickNoEffect'
  | 'lateFromScavenge'
  | 'shelterAttacked'
  | 'visitor' | 'requestFulfilled';

/** 契约 §5 定死的条目形状。个体条目带 actorId；群体条目为 null。 */
export interface DiaryEntry {
  kind: DiaryKind;
  day: number;
  minute: number; // 必须 Math.floor——见 recordDiary 里的说明
  text: string;
  /** 个体条目带 npcId；群体条目为 null（个体/群体双轨）。 */
  actorId: string | null;
}

/** UI 用的中文种类名（日记页的标签列），避免渲染层自己维护一份映射。 */
export const DIARY_KIND_LABELS: Record<DiaryKind, string> = {
  dwellerHungry: '饥饿',
  groupHungry: '群体饥饿',
  dwellerMorale: '心情',
  dwellerWounded: '受伤',
  dwellerSick: '生病',
  dwellerSickNoEffect: '生病·无恙',
  lateFromScavenge: '迟归',
  shelterAttacked: '宿舍袭击',
  visitor: '访客',
  requestFulfilled: '委托完成',
};

/** 日记的容量上限：超出裁掉最旧的（旗不被裁剪影响，见 recordDiary）。 */
export const DIARY_ENTRY_LIMIT = 64;

// ── 存储位置 ────────────────────────────────────────────────────────────────
//
// 契约 §5 把 DiaryEntry 的类型放在本文件，GameState 在 src/core（AG-25
// 属主）；GameState.diaryEntries 已是声明位（缺省按 [] 懒创建），serialize
// 是 JSON.stringify(state)，条目随之进存档；validateGameState 只校验已知
// 字段，不拒绝它；读取走 diaryOf()——老存档没有它就是空数组，由
// migrateLegacyDiary 在加载时把旧 diary 迁进来，不需要为此升 schemaVersion。

function entriesOf(state: GameState): DiaryEntry[] {
  return state.diaryEntries ?? (state.diaryEntries = []);
}

/** 日记计数的旗名。旗是「这事发生过吗」的唯一查询入口（WorldFlags）。 */
export function diaryFlagKey(kind: DiaryKind): string {
  return `diary:${kind}`;
}

/**
 * 写入一条日记。
 *
 * minute 必须 Math.floor：gameMinuteOfDay 是帧推进的小数（480.34…），
 * AG-06 的小数分钟 bug 就是这么来的——不 floor 就会把小数写进存档，
 * 之后任何按整数假设的读者（isValidMemory、旧档校验）都会失配。
 * 写入口统一 floor 并夹回 0..1439，调用方传小数也安全。
 *
 * 同时给对应 kind 的计数旗 +1：条目有 64 条上限、会被裁剪，旗不会——
 * 「这局被袭击过吗」不该因为条目被裁掉而改变答案。这就是「日记要能按
 * flag 查询」的落地：hasFlag(state, diaryFlagKey('shelterAttacked'))。
 *
 * 返回落库的条目（normalize 后的），方便调用方与测试断言。
 */
export function recordDiary(state: GameState, entry: DiaryEntry): DiaryEntry {
  const stored: DiaryEntry = {
    kind: entry.kind,
    day: entry.day,
    minute: Math.min(1439, Math.max(0, Math.floor(entry.minute))),
    text: entry.text,
    actorId: entry.actorId ?? null,
  };
  const diary = entriesOf(state);
  diary.push(stored);
  if (diary.length > DIARY_ENTRY_LIMIT) diary.splice(0, diary.length - DIARY_ENTRY_LIMIT);
  bumpFlag(state, diaryFlagKey(stored.kind));
  return stored;
}

/**
 * 读日记，按 day 倒序（新的在前），可限条数。
 *
 * 倒序的理由：日记的读取场景几乎总是「最近发生了什么」——暂停面板的日记页、
 * 事后回顾，都是先看今天。倒序返回让 UI 按数组顺序直接渲染，不需要每个
 * 调用方自己 reverse；同一天内也是后发生的先，因为「先饿昏、后被袭」里
 * 后一件更值得先看到。
 */
export function diaryOf(state: GameState, limit?: number): DiaryEntry[] {
  const ordered = [...entriesOf(state)].reverse();
  if (limit === undefined) return ordered;
  if (limit <= 0) return [];
  return ordered.slice(0, limit);
}

/** 这局记录过某种日记吗（走旗，不被 64 条裁剪影响）。 */
export function hasDiaryKind(state: GameState, kind: DiaryKind): boolean {
  return hasFlag(state, diaryFlagKey(kind));
}

/** 某种日记此生记录过多少次（走旗）。 */
export function diaryKindCount(state: GameState, kind: DiaryKind): number {
  return flagCount(state, diaryFlagKey(kind));
}

// ── 升级一：饥饿/口渴（个体 + 群体 + 预警三档）─────────────────────────────
//
// 原来玩家只知道：HUD 上三条数字。归零时没有任何告知——HP 开始静默流血，
// 玩家往往到血量见底、或死亡原因文案（deathCause）才知道自己饿/渴了；
// 「连续多日归零」更是完全不可见：数字一直贴着 0，没有任何东西说「这已经
// 持续三天了」。
// 现在多知道：归零瞬间一条 dwellerHungry（个体态，「你饿倒了」）；连续
// 第二天起一条 groupHungry（群体态，「连续第 N 天……不再是私事」）；
// 以及预警档——bar 掉到 25% 以下但没归零时一条「这次没事」（见文件末尾
// 的「没有效果」说明）。

/** 预警档：与 SicknessSystem 的 SEVERITY_BITING 同档——25% 是「开始咬人」的线。 */
const SURVIVAL_WARN_FRACTION = 0.25;

type SurvivalBar = 'hunger' | 'thirst';

const BAR_COPY: Record<SurvivalBar, { zero: string; warn: string; group: (streak: number) => string }> = {
  hunger: {
    zero: '你饿倒了——身体开始撑不住，得赶紧吃东西。',
    warn: '你开始饿了，但还撑得住——这次没事。',
    group: (streak) => `连续第 ${streak} 天没进食——宿舍里的人都垮了，这不再是某个人的私事。`,
  },
  thirst: {
    zero: '你渴倒了——喉咙里像着了火，得赶紧找水。',
    warn: '你开始渴了，但还撑得住——这次没事。',
    group: (streak) => `连续第 ${streak} 天没水喝——宿舍里的人都垮了，这不再是某个人的私事。`,
  },
};

/**
 * 检查饥饿/口渴并写日记。调用点：SurvivalSystem.advanceGameMinutes 在
 * applyDecay / applyRestDecay 之后（AG-25 属主接线；睡觉跨日也走那条路径，
 * 「又一天饿着醒来」因此真的会发生）。
 *
 * 每天每栏至多一条； streak（连续天数）与「今天写过了吗」走 WorldFlags，
 * 不依赖模块级变量——读档后续算不会丢。
 */
export function checkSurvivalDiary(state: GameState): DiaryEntry[] {
  const written: DiaryEntry[] = [];
  for (const bar of ['hunger', 'thirst'] as const) checkBar(bar);
  return written;

  function checkBar(bar: SurvivalBar): void {
    const value = state.player[bar];
    const zeroDayKey = `diary:${bar}ZeroDay`;
    const streakKey = `diary:${bar}ZeroStreak`;
    const warnDayKey = `diary:${bar}WarnDay`;
    const zeroDay = flagCount(state, zeroDayKey);

    if (value <= 0) {
      if (zeroDay === state.day) return; // 今天这一档已经记过
      // 昨天也记过 = 连续；中间断过（恢复过）zeroDay 就停在更早的天，
      // 链条自然断开，重新按个体记。
      const consecutive = zeroDay === state.day - 1;
      const streak = consecutive ? flagCount(state, streakKey) + 1 : 1;
      setFlag(state, zeroDayKey, state.day);
      setFlag(state, streakKey, streak);
      written.push(recordDiary(state, {
        kind: consecutive ? 'groupHungry' : 'dwellerHungry',
        day: state.day,
        minute: state.gameMinuteOfDay,
        text: consecutive ? BAR_COPY[bar].group(streak) : BAR_COPY[bar].zero,
        actorId: consecutive ? null : 'player',
      }));
      return;
    }

    if (value <= STAT_MAX[bar] * SURVIVAL_WARN_FRACTION) {
      if (flagCount(state, warnDayKey) === state.day) return; // 今天预警已记
      // 刚归零过（今天或昨天）不写预警：那个故事已由归零条目讲了，恢复
      // 途中的预警只是噪音。
      if (zeroDay === state.day || zeroDay === state.day - 1) return;
      setFlag(state, warnDayKey, state.day);
      written.push(recordDiary(state, {
        kind: 'dwellerHungry',
        day: state.day,
        minute: state.gameMinuteOfDay,
        text: BAR_COPY[bar].warn,
        actorId: 'player',
      }));
    }
  }
}

// ── 升级二：夜间袭击 ────────────────────────────────────────────────────────
//
// 原来玩家只知道：finishNight 返回的 attacked/hpLost 和一行动效 flash
// （「睡到第 X 天…」）。旧 diary 里那条 shelter_attacked 是 DiaryEvent 老
// 格式，没有 UI 呈现，一闪就散；读档后「昨晚被袭击过吗」没有地方可查。
// 现在多知道：一条结构化 shelterAttacked（day/minute/text），可被 diaryOf
// 回放、可被旗 diary:shelterAttacked 查询、进存档。袭击是宿舍级事件，
// 不是某个人的状态——群体态，actorId 为 null。
//
// 调用点：ShelterSystem.finishNight 里 attacked 为真的分支（RC-01 已接线，
// 取代原来的旧格式 appendDiaryEvent；压力 +10 由 ShelterSystem 显式应用）。
export function recordShelterAttackedDiary(state: GameState, damage: number): DiaryEntry {
  return recordDiary(state, {
    kind: 'shelterAttacked',
    day: state.day,
    minute: state.gameMinuteOfDay,
    text: `夜里宿舍被攻破，你挂了彩（HP -${Math.max(0, Math.round(damage))}）。`,
    actorId: null,
  });
}

// ── 升级三：流浪者/邻居 ─────────────────────────────────────────────────────
//
// 原来玩家只知道：NPC 对话是纯场景演出，说完即散；委托（dailyGoal）办成时
// 只有一行 flash。「这周谁来过」「委托办成了几件」没有任何地方回答。
// 现在多知道：visitor 一条可回放的来访记录（个体态，actorId=npcId——
// 「小周来过」是关于小周这个人的事实）；requestFulfilled 一条委托办结
// 记录（事务态，actorId=null）。

/**
 * NPC 来访。调用点：GameScene 打开居民对话时（npcId 用 npcStates 的键，
 * 如 'xiaozhou'/'alin'）。
 */
export function recordVisitorDiary(state: GameState, npcId: string, npcName?: string): DiaryEntry {
  return recordDiary(state, {
    kind: 'visitor',
    day: state.day,
    minute: state.gameMinuteOfDay,
    text: `${npcName ?? npcId}来坐了坐，说了些近况。`,
    actorId: npcId,
  });
}

/**
 * 委托完成。调用点：dailyGoals.grantDailyGoalReward 真正发放奖励时
 * （AG-26 属主接线），summary 可传委托内容，如「净水×3」。
 */
export function recordRequestFulfilledDiary(state: GameState, summary?: string): DiaryEntry {
  const what = summary ? `：${summary}` : '';
  return recordDiary(state, {
    kind: 'requestFulfilled',
    day: state.day,
    minute: state.gameMinuteOfDay,
    text: `你办成了那件委托${what}。`,
    actorId: null,
  });
}

// ── 其余 kind 的写入入口 ────────────────────────────────────────────────────

/** 受伤。调用点：GameScene 被巡游体击中 / 战斗受伤处（与既有 flash 并存）。 */
export function recordWoundedDiary(state: GameState, source?: string): DiaryEntry {
  const from = source ? `（${source}）` : '';
  return recordDiary(state, {
    kind: 'dwellerWounded',
    day: state.day,
    minute: state.gameMinuteOfDay,
    text: `你受了伤${from}——伤口得处理。`,
    actorId: 'player',
  });
}

/** 心情变化。调用点：morale 点数被物品/事件显著改变时（AG-25/AG-29 接线）。 */
export function recordMoraleDiary(state: GameState, input: { delta: number; reason: string }): DiaryEntry {
  const sign = input.delta >= 0 ? '+' : '';
  return recordDiary(state, {
    kind: 'dwellerMorale',
    day: state.day,
    minute: state.gameMinuteOfDay,
    text: `${input.reason}（心情 ${sign}${Math.round(input.delta)}）。`,
    actorId: 'player',
  });
}

/** 「生病·无恙」每天只写一条的那面旗。 */
const NO_EFFECT_DAY_FLAG = 'diary:sickNoEffectDay';
/** 迟归每晚一条的那面旗。 */
const LATE_RETURN_DAY_FLAG = 'diary:lateReturnDay';

/**
 * 疾病：每 tick 调一次（调用点：SurvivalSystem 拿到 tickSickness 的返回值
 * 之后，或 GameScene 消费 SicknessTick 的地方——二选一，不要两处都写）。
 *
 * 有转化（恶化/危急）→ dwellerSick，一条对一个病症，与 flash 的
 * AILMENT_LABEL[0] 提示同源但更全（flash 只显示第一个）。
 *
 * 「没有效果」语义一（TWOM 的 DwellerSicknessNoEffect）：带着病过了一 tick
 * 而什么都没发生——仍然告知。它在告诉玩家「系统看在眼里，只是这次没事」。
 * 每天一条（旗记「今天写过了」），不会每帧刷屏；病好了就不再写。
 */
export function recordSicknessDiary(state: GameState, tick: SicknessTick): DiaryEntry[] {
  const written: DiaryEntry[] = [];
  for (const id of tick.worsened) {
    written.push(recordDiary(state, {
      kind: 'dwellerSick',
      day: state.day,
      minute: state.gameMinuteOfDay,
      text: `你${AILMENTS[id].label}了——状态会掉得更快。`,
      actorId: 'player',
    }));
  }
  for (const id of tick.critical) {
    written.push(recordDiary(state, {
      kind: 'dwellerSick',
      day: state.day,
      minute: state.gameMinuteOfDay,
      text: `你${AILMENTS[id].label}恶化了，需要处理。`,
      actorId: 'player',
    }));
  }
  const ailments = state.player.ailments ?? [];
  const quiet = tick.worsened.length === 0 && tick.critical.length === 0 && tick.recovered.length === 0;
  if (quiet && ailments.length > 0 && flagCount(state, NO_EFFECT_DAY_FLAG) !== state.day) {
    setFlag(state, NO_EFFECT_DAY_FLAG, state.day);
    const worst = [...ailments].sort((a, b) => b.severity - a.severity)[0];
    written.push(recordDiary(state, {
      kind: 'dwellerSickNoEffect',
      day: state.day,
      minute: state.gameMinuteOfDay,
      text: `你带着${AILMENTS[worst.id].label}，还没恶化——这次没事。`,
      actorId: 'player',
    }));
  }
  return written;
}

/**
 * 迟归：入夜后（18:00 起）人还在宿舍外的楼层。调用点：GameScene 的帧更新
 * 或 dwellPressure 的 tick（与夜事件提示并存）。
 *
 * TWOM 的 LateFromScavenge 是「外出的人没按时回来，本身就是事件」。我们
 * 没有搜刮行程，这是语义上最近的映射：天黑了该回宿舍的人没回——风险已经
 * 被系统看见，记一笔，不用等出事。每晚至多一条。
 */
export function checkLateReturnDiary(state: GameState): DiaryEntry | null {
  if (state.gameMinuteOfDay < NIGHT_START_MINUTE) return null;
  if (state.currentFloor === STARTING_FLOOR) return null;
  if (flagCount(state, LATE_RETURN_DAY_FLAG) === state.day) return null;
  setFlag(state, LATE_RETURN_DAY_FLAG, state.day);
  return recordDiary(state, {
    kind: 'lateFromScavenge',
    day: state.day,
    minute: state.gameMinuteOfDay,
    text: `入夜了，你还在第 ${state.currentFloor} 层——该回宿舍了。`,
    actorId: 'player',
  });
}

// 「没有效果」语义二——饿了但没归零：checkSurvivalDiary 的预警档。bar 掉到
// 25% 以下但还没归零时，写一条 dwellerHungry 文案变体「你开始饿了，但还
// 撑得住——这次没事」。契约的 11 种 kind 里没有 dwellerHungryNoEffect，
// 饥饿态下最诚实的 kind 就是 dwellerHungry，「这次没事」由文案承载；
// 若总控想要对称的 NoEffect kind，这是第一候选。与 SEVERITY_BITING 同档
// 的 25% 阈值让「预警」和「开始咬人」是同一条线，玩家只需要记一个数。

// ── 旧档迁移（RC-01 日记统一）───────────────────────────────────────────────
//
// 旧日记 DiaryEvent[]（state.diary，8 种宽记录 kind，带 id/floor/
// itemChanges/stressDelta）随本轮统一退出生产：唯一的生产者 ShelterSystem
// 改为写结构化条目，两个读者（宿舍面板「上次：…」、NPC 对话的
// recentEvents）改读 diaryEntries。旧档里的旧日记在此迁成结构化条目——
// 「昨晚被袭击过吗」对一个老存档仍然答得出来。
//
// 迁移只搬事实，不重放效果：stressDelta 在旧档运行时就已经 applied 过
// （旧 appendDiaryEvent 写日记顺带改压力），再 apply 一次就是双扣。
// 形状校验留在 SaveSystem（坏档仍然整体拒绝，不白屏也不静默丢数据），
// 这里只回答「一条旧条目对应哪种新 kind、谁是当事人」。

/** 旧 DiaryEvent 的 8 种 kind → 新 DiaryKind。无专属种类的归到最相近的：
 *  搜刮归来/休息/加固都是「身心与居所的恢复」→ dwellerMorale；
 *  战斗受伤/处理伤势 → dwellerWounded；迟归 → lateFromScavenge；
 *  照顾邻居是关于小周这个人的事实 → visitor（个体态，他因此亲历）；
 *  夜袭是宿舍级事件 → shelterAttacked（群体态）。 */
const LEGACY_KIND_MAP: Record<string, DiaryKind> = {
  returned_from_scavenge: 'dwellerMorale',
  late_return: 'lateFromScavenge',
  combat_wounded: 'dwellerWounded',
  shelter_rested: 'dwellerMorale',
  shelter_treated: 'dwellerWounded',
  shelter_repaired: 'dwellerMorale',
  neighbor_cared: 'visitor',
  shelter_attacked: 'shelterAttacked',
};

/** 旧档 diary 字段里的条目形状（未校验的 JSON，逐个字段看过再用）。 */
interface LegacyDiaryEntry {
  kind?: unknown;
  day?: unknown;
  minute?: unknown;
  actorIds?: unknown;
  message?: unknown;
}

/** 旧 kind 是否认识（SaveSystem 的旧档校验与这里的迁移共用一张表）。 */
export function isLegacyDiaryKind(kind: unknown): kind is keyof typeof LEGACY_KIND_MAP {
  return typeof kind === 'string' && kind in LEGACY_KIND_MAP;
}

/**
 * 把旧档的 DiaryEvent[] 迁进结构化日记，然后删掉旧字段。
 *
 * 调用点：SaveSystem.deserialize（校验通过之后）。幂等——第二次调用时
 * diary 已删，直接返回。迁移条目走 recordDiary：64 条裁剪、minute floor、
 * diary:<kind> 计数旗全部随新写入口一致，老存档因此和新档同构。
 */
export function migrateLegacyDiary(state: GameState): void {
  const legacy = (state as GameState & { diary?: unknown }).diary;
  if (!Array.isArray(legacy)) return;
  for (const raw of legacy) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as LegacyDiaryEntry;
    if (!isLegacyDiaryKind(entry.kind)) continue;
    if (typeof entry.day !== 'number' || typeof entry.minute !== 'number' || typeof entry.message !== 'string') continue;
    const actorIds = Array.isArray(entry.actorIds)
      ? entry.actorIds.filter((actor): actor is string => typeof actor === 'string')
      : [];
    // 个体态取第一个非玩家 actor（照顾邻居 → 小周，他因此亲历这条）；
    // 宿舍袭击是群体态（与新写入口一致），其余取玩家自己。
    const actorId = entry.kind === 'shelter_attacked'
      ? null
      : actorIds.find((actor) => actor !== 'player') ?? (actorIds.includes('player') ? 'player' : null);
    recordDiary(state, {
      kind: LEGACY_KIND_MAP[entry.kind],
      day: entry.day,
      minute: entry.minute,
      text: entry.message,
      actorId,
    });
  }
  delete (state as GameState & { diary?: unknown }).diary;
}
