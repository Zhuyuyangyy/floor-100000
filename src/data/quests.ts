// 首章任务链（docs/plans/STORY.md 的唯一数据源）。
//
// 塔里没有灾难，只有管理。每上一层，你离「谁在管」更近一步。这条任务链把
// docs/18_TIER_PROGRESSION.md 的六个故事节点写成可验收的结构：每个可玩段一条
// 主线任务，触发它、完成它的目标、在分支里选一条路，然后带着后果去上一层。
//
// 边界（与团队约定的分工）：
//  - 本文件只放**纯数据 + 纯函数**：不 import Phaser，不读写 GameState，不摇
//    随机数。求值函数是 state 的纯函数，同 seed 同 state 必然同结果。
//  - flag 一律走 systems/WorldFlags.ts 现有的写法（flagKey.story / flagKey.once），
//    不发明第二套命名空间；凭证（pass）沿用 data/recipes.ts 的 UpgradeId，存
//    player.homeUpgrades——与 CraftingSystem.craft() 的落点一致。
//  - 「后果怎么落地」是集成层的事（setFlag / addItem / removeItem /
//    homeUpgrades.push / records.bestScore），见 STORY.md §7 的接口契约。
//
// 结构：每条主线任务守着它要进的那一段（任务 `segment: 2` = 「进 100 层」），
// 在前一段的顶层被触发；它的三条纸条证据来自目标阶层的 NOTE_TEXTS_BY_TIER
// （docs/18 §4：每阶层 3 条，18 条全被本链引用，见 quests.test.ts 的咬合断言）。

import type { GameState, ItemId } from '../core/gameTypes';
import type { TierId } from '../core/tower';
import type { PlayableSegment } from '../core/segments';
import { PLAYABLE_SEGMENTS } from '../core/segments';
import type { UpgradeId } from '../data/recipes';
import { PASS_UPGRADE_IDS } from '../data/recipes';
import { getItem, isItemId } from '../data/items';
import { FLAG_PREFIX, flagKey, hasFlag } from '../systems/WorldFlags';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type QuestKind = 'main' | 'side' | 'finale';

/**
 * 任务发布者。alin / xiaozhou 是 src/data/npcs.ts 里已存在的两位邻居；其余是
 * 首章新 NPC，台词与选项树见 docs/plans/STORY.md §5（本轮只做设计，不动 npcs.ts）。
 */
export type QuestGiver =
  | 'alin'
  | 'xiaozhou'
  | 'recruiter'
  | 'lift_guard'
  | 'blackmarket'
  | 'lab_clerk'
  | 'banquet_staff'
  | 'core_terminal';

/** 触发/分支条件。全部字段是可选的「与」关系；flagsAny 是唯一的「或」。 */
export interface QuestCondition {
  /** 这些 flag 必须都已设置（WorldFlags.hasFlag） */
  readonly flagsAll?: readonly string[];
  /** 这些 flag 必须都未设置 */
  readonly flagsNone?: readonly string[];
  /** 其中至少一个已设置（用于「两条路殊途同归」式的分支解锁） */
  readonly flagsAny?: readonly string[];
  /** 玩家当前楼层至少要到这么高（state.currentFloor） */
  readonly minFloor?: number;
  /** 背包持有量下限 */
  readonly items?: ReadonlyArray<{ readonly itemId: ItemId; readonly count: number }>;
  /** 必须已持有的凭证（player.homeUpgrades） */
  readonly passes?: readonly UpgradeId[];
}

/**
 * 分支后果。集成层按 kind 落地：
 *  setFlag→setFlag / clearFlag→clearFlag / giveItem→addItem / takeItem→removeItem /
 *  grantPass→homeUpgrades.push（与 craft() 同一落点，不额外写 upg: flag）/
 *  score→records.bestScore += delta。
 */
export type QuestConsequence =
  | { readonly kind: 'setFlag'; readonly flag: string }
  | { readonly kind: 'clearFlag'; readonly flag: string }
  | { readonly kind: 'giveItem'; readonly itemId: ItemId; readonly count: number }
  | { readonly kind: 'takeItem'; readonly itemId: ItemId; readonly count: number }
  | { readonly kind: 'grantPass'; readonly pass: UpgradeId }
  | { readonly kind: 'score'; readonly delta: number };

/** 任务目标。doneFlag 是目标完成时由集成层写入的标记，分支可以门控在它上面。 */
export interface QuestObjective {
  readonly id: string;
  readonly text: string;
  readonly doneFlag: string;
  /** 本目标引用的纸条：NOTE_TEXTS_BY_TIER[tier][index]（docs/18 §4 的 18 条） */
  readonly note?: { readonly tier: TierId; readonly index: number };
}

/** 分支：一句话选项 + 解锁条件 + 后果。 */
export interface QuestBranch {
  readonly id: string;
  readonly text: string;
  readonly detail?: string;
  readonly requires?: QuestCondition;
  readonly consequences: readonly QuestConsequence[];
}

export interface Quest {
  readonly id: string;
  readonly kind: QuestKind;
  /** 本任务守着哪一段。与 TierId 同编号（docs/18 §2：段与阶层一一对应）。 */
  readonly segment: PlayableSegment['id'];
  readonly title: string;
  readonly giver: QuestGiver;
  /** 任务锚点楼层（对话/交互发生的地方） */
  readonly anchorFloor: number;
  readonly summary: string;
  /** 什么条件下这条任务进入 available */
  readonly trigger: QuestCondition;
  /** 必须先完成的任务 id（前置任务）；缺省为无 */
  readonly requires?: readonly string[];
  readonly objectives: readonly QuestObjective[];
  readonly branches: readonly QuestBranch[];
}

// ---------------------------------------------------------------------------
// Flag 命名（全部经 flagKey，与既有系统同一套命名空间）
// ---------------------------------------------------------------------------

/** 任务自身生命周期的 flag。 */
export const QUEST_FLAG = {
  accepted: (questId: string): string => flagKey.story(`quest:${questId}:accepted`),
  done: (questId: string): string => flagKey.story(`quest:${questId}:done`),
  branch: (questId: string, branchId: string): string => flagKey.story(`quest:${questId}:branch:${branchId}`),
  objective: (questId: string, objectiveId: string): string => flagKey.story(`quest:${questId}:obj:${objectiveId}`),
  /** 任务奖励结算过没有（一次性发放的守卫，语义同 dailyGoals 的 goal-paid） */
  rewardPaid: (questId: string): string => flagKey.once(`quest-reward:${questId}`),
} as const;

/**
 * 世界状态 flag：任务链写、其它任务/终局读的那部分。命名用「子系统.事实」，
 * 全部落在 story: 命名空间里。终局路线（GAME_DESIGN_LOCK §6）应读这套 flag，
 * 见 STORY.md §6。
 */
export const STORY_FLAGS = {
  // Q1 周三与周五
  slumKnowsSchedule: flagKey.story('slum.knows-schedule'),
  slumHoldsEvidence: flagKey.story('slum.holds-evidence'),
  // SQ1 净水口
  tapWarned: flagKey.story('tap.warned-neighbors'),
  tapExploited: flagKey.story('tap.exploited-outlet'),
  // Q2 工牌与脸
  badgeForged: flagKey.story('badge.forged'),
  badgeTraded: flagKey.story('badge.traded-with-foreman'),
  badgePried: flagKey.story('badge.pried-off-wall'),
  // Q3 通行贴
  stickerShortCircuited: flagKey.story('sticker.short-circuited'),
  stickerBribed: flagKey.story('sticker.bribed-guard'),
  stickerSlippedShift: flagKey.story('sticker.slipped-shift'),
  // Q4 许可证
  permitBought: flagKey.story('permit.bought-identity'),
  permitVolunteered: flagKey.story('permit.volunteered'),
  permitBlackmailed: flagKey.story('permit.blackmailed-gate'),
  // Q5 贵宾卡
  vipBoughtIn: flagKey.story('vip.bought-in'),
  vipHandlerInvite: flagKey.story('vip.handler-invite'),
  vipBackDoor: flagKey.story('vip.back-door'),
  // SQ2 盛宴之夜
  feastHasEvidence: flagKey.story('feast.has-evidence'),
  feastNoEvidence: flagKey.story('feast.no-evidence'),
  // Q6 终局
  endingShutdown: flagKey.story('ending.shutdown'),
  endingThrone: flagKey.story('ending.throne'),
  endingHandOver: flagKey.story('ending.hand-over'),
  endingWalkAway: flagKey.story('ending.walk-away'),
} as const;

// ---------------------------------------------------------------------------
// 任务数据
// ---------------------------------------------------------------------------

const obj = (questId: string, id: string, text: string, note?: QuestObjective['note']): QuestObjective => ({
  id,
  text,
  doneFlag: QUEST_FLAG.objective(questId, id),
  ...(note ? { note } : {}),
});

export const QUESTS: readonly Quest[] = [
  // -------------------------------------------------------------------------
  // 阶层 1：底层贫民区（1–10）。故事节点 1：停电不是事故，是按表执行的配给。
  // -------------------------------------------------------------------------
  {
    id: 'blackout-schedule',
    kind: 'main',
    segment: 1,
    title: '周三与周五',
    giver: 'alin',
    anchorFloor: 2,
    summary:
      '阿林发现走廊停电固定发生在周三、周五，像值班表一样准。他让你去 4 层配电房抄下那张表——顺便看看 5 层食堂墙上被划掉的名字。',
    trigger: { minFloor: 2 },
    objectives: [
      obj('blackout-schedule', 'schedule', '到 4 层配电房抄下停电表：周三、周五。有人签字。', { tier: 1, index: 0 }),
      obj('blackout-schedule', 'boil-water', '记住墙上那句话：水要烧开。别信楼下的净水口。', { tier: 1, index: 1 }),
      obj('blackout-schedule', 'names', '看看 5 层食堂墙上被划掉的名字——第七批人走了一半。', { tier: 1, index: 2 }),
    ],
    branches: [
      {
        id: 'expose',
        text: '把停电表抄在食堂墙上。所有人都该知道这是什么。',
        detail: '底层从此知道停电是按表执行的。有人会骂你，也有人会记住你。',
        consequences: [
          { kind: 'setFlag', flag: STORY_FLAGS.slumKnowsSchedule },
          { kind: 'score', delta: 25 },
        ],
      },
      {
        id: 'keep',
        text: '把签字页留着。这是能换东西的筹码。',
        detail: '签字页进了口袋。楼上的人收消息，也许出得起价。',
        consequences: [
          { kind: 'setFlag', flag: STORY_FLAGS.slumHoldsEvidence },
          { kind: 'score', delta: 25 },
        ],
      },
    ],
  },
  {
    id: 'tap-water',
    kind: 'side',
    segment: 1,
    title: '净水口',
    giver: 'alin',
    anchorFloor: 3,
    summary: '阿林怀疑 3 层的「净水口」接的是配给主线。他让你接一瓶试试，然后决定：说，还是不说。',
    trigger: { minFloor: 3 },
    objectives: [
      obj('tap-water', 'sample', '从 3 层净水口接一瓶水，看看颜色。墙上写着：水要烧开。别信楼下的净水口。', { tier: 1, index: 1 }),
    ],
    branches: [
      {
        id: 'warn',
        text: '告诉小周和邻居们，跟阿林一起把净水口改接到维修层的水箱。',
        detail: '净水口修好了。底层的人记下这件事。',
        consequences: [
          { kind: 'setFlag', flag: STORY_FLAGS.tapWarned },
          { kind: 'giveItem', itemId: 'clean_water', count: 2 },
          { kind: 'score', delta: 15 },
        ],
      },
      {
        id: 'exploit',
        text: '不声张。接满脏水，掺着卖。',
        detail: '没人知道水的事。至少现在没有。',
        consequences: [
          { kind: 'setFlag', flag: STORY_FLAGS.tapExploited },
          { kind: 'giveItem', itemId: 'dirty_water', count: 2 },
          { kind: 'score', delta: 15 },
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  // 阶层 2：工人宿舍区（100–110）。故事节点 2：保安队不是防你，是防你上去。
  // -------------------------------------------------------------------------
  {
    id: 'work-badge',
    kind: 'main',
    segment: 2,
    title: '工牌与脸',
    giver: 'recruiter',
    anchorFloor: 10,
    summary:
      '10 层货梯口的招工员认脸不认人。墙上挂着上一块工牌，工头收饭票也收消息——进 100 层有三条路，每条都记在账上。',
    trigger: { minFloor: 10 },
    requires: ['blackout-schedule'],
    objectives: [
      obj('work-badge', 'return', '看看墙上那块工牌：工牌要交回。别问为什么。——上一块还挂在墙上', { tier: 2, index: 0 }),
      obj('work-badge', 'face', '摸清岗哨规律：三号楼梯口的保安认得脸。换个班次走。', { tier: 2, index: 1 }),
      obj('work-badge', 'foreman', '工头收饭票，也收消息。看看他想要什么。', { tier: 2, index: 2 }),
    ],
    branches: [
      {
        id: 'forge',
        text: '按阿林的图纸仿一块（废金属 1 + 布料 1 + 胶带 1）。',
        detail: '仿的终究是仿的。读头认不出，人可不一定。',
        requires: { items: [{ itemId: 'scrap_metal', count: 1 }, { itemId: 'cloth', count: 1 }, { itemId: 'tape', count: 1 }] },
        consequences: [
          { kind: 'takeItem', itemId: 'scrap_metal', count: 1 },
          { kind: 'takeItem', itemId: 'cloth', count: 1 },
          { kind: 'takeItem', itemId: 'tape', count: 1 },
          { kind: 'grantPass', pass: 'work_badge' },
          { kind: 'setFlag', flag: STORY_FLAGS.badgeForged },
          { kind: 'score', delta: 25 },
        ],
      },
      {
        id: 'trade-evidence',
        text: '把 Q1 留下的签字页交给工头，换一块真工牌。',
        detail: '签字页上的名字，和名单上的名字是同一支笔。工头看完之后，记住你了。',
        requires: { flagsAll: [STORY_FLAGS.slumHoldsEvidence] },
        consequences: [
          { kind: 'clearFlag', flag: STORY_FLAGS.slumHoldsEvidence },
          { kind: 'grantPass', pass: 'work_badge' },
          { kind: 'setFlag', flag: STORY_FLAGS.badgeTraded },
          { kind: 'score', delta: 25 },
        ],
      },
      {
        id: 'pry-wall',
        text: '入夜后用撬棍把墙上那块撬下来。',
        detail: '上一块工牌的主人没再来取。明天起，保安会挨个核对脸。',
        requires: { items: [{ itemId: 'crowbar', count: 1 }] },
        consequences: [
          { kind: 'grantPass', pass: 'work_badge' },
          { kind: 'setFlag', flag: STORY_FLAGS.badgePried },
          { kind: 'score', delta: 25 },
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  // 阶层 3：工业与交易区（1000–1010）。故事节点 3：军队防的不是人。
  // -------------------------------------------------------------------------
  {
    id: 'pass-sticker',
    kind: 'main',
    segment: 3,
    title: '通行贴',
    giver: 'blackmarket',
    anchorFloor: 110,
    summary:
      '110 层顶的货梯由军队的把守。黑市贩子卖你一张短接门禁的图纸，值班保安收电池，而你知道整栋楼的例行时刻表。',
    trigger: { minFloor: 110 },
    requires: ['work-badge'],
    objectives: [
      obj('pass-sticker', 'cargo-lift', '记住贩子的话：三号货梯别开。里面有东西在撞门。', { tier: 3, index: 0 }),
      obj('pass-sticker', 'army-gate', '军队不是来救人的。他们守的是往上的门。', { tier: 3, index: 1 }),
      obj('pass-sticker', 'pipes', '半夜贴着管道听：管道里有声音。不像是水。', { tier: 3, index: 2 }),
    ],
    branches: [
      {
        id: 'short-circuit',
        text: '按图纸短接门禁读头（电线 2 + 胶带 1 + 电池 1）。',
        detail: '读头哔了一声，绿灯。没人看见你。',
        requires: { items: [{ itemId: 'wire', count: 2 }, { itemId: 'tape', count: 1 }, { itemId: 'battery', count: 1 }] },
        consequences: [
          { kind: 'takeItem', itemId: 'wire', count: 2 },
          { kind: 'takeItem', itemId: 'tape', count: 1 },
          { kind: 'takeItem', itemId: 'battery', count: 1 },
          { kind: 'grantPass', pass: 'pass_sticker' },
          { kind: 'setFlag', flag: STORY_FLAGS.stickerShortCircuited },
          { kind: 'score', delta: 25 },
        ],
      },
      {
        id: 'bribe-guard',
        text: '用两块电池打点货梯口的值班保安。',
        detail: '保安收了电池，帮你把通行贴按在读头上。他说这不认识你。',
        requires: { items: [{ itemId: 'battery', count: 2 }] },
        consequences: [
          { kind: 'takeItem', itemId: 'battery', count: 2 },
          { kind: 'grantPass', pass: 'pass_sticker' },
          { kind: 'setFlag', flag: STORY_FLAGS.stickerBribed },
          { kind: 'score', delta: 25 },
        ],
      },
      {
        id: 'slipped-shift',
        text: '照着停电表的规律算出换班空档，贴着管道的声摸上去。',
        detail: '周三、周五。你把 Q1 抄给所有人的那张表，用在了这里。',
        requires: { flagsAll: [STORY_FLAGS.slumKnowsSchedule] },
        consequences: [
          { kind: 'grantPass', pass: 'pass_sticker' },
          { kind: 'setFlag', flag: STORY_FLAGS.stickerSlippedShift },
          { kind: 'score', delta: 25 },
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  // 阶层 4：中产与商业区（10000–10010）。故事节点 4：实验室在造生物兵器，
  // 第一批是「志愿者」。
  // -------------------------------------------------------------------------
  {
    id: 'permit',
    kind: 'main',
    segment: 4,
    title: '许可证',
    giver: 'lab_clerk',
    anchorFloor: 1010,
    summary:
      '1010 层顶的门禁室认得三种人：买身份的、报名的、攥着名单的。文员说「这是为了所有人」——说这话时她没敢看你。',
    trigger: { minFloor: 1010 },
    requires: ['pass-sticker'],
    objectives: [
      obj('permit', 'volunteer-list', '找到志愿者名单：上面有邻居家的弟弟。他签的时候以为是招工。', { tier: 4, index: 0 }),
      obj('permit', 'unmarked-boxes', '跟一跟实验室送出来的箱子——从来不写里面是什么。', { tier: 4, index: 1 }),
      obj('permit', 'for-everyone', '听完文员的说法：他们说这是为了所有人。我不信，但我不敢说。', { tier: 4, index: 2 }),
    ],
    branches: [
      {
        id: 'buy-identity',
        text: '走黑市买一套身份（电池 2 + 滤芯 1 + 布料 1）。',
        detail: '身份是买的，记录是干净的。文员收钱的时候手在抖。',
        requires: { items: [{ itemId: 'battery', count: 2 }, { itemId: 'filter', count: 1 }, { itemId: 'cloth', count: 1 }] },
        consequences: [
          { kind: 'takeItem', itemId: 'battery', count: 2 },
          { kind: 'takeItem', itemId: 'filter', count: 1 },
          { kind: 'takeItem', itemId: 'cloth', count: 1 },
          { kind: 'grantPass', pass: 'permit' },
          { kind: 'setFlag', flag: STORY_FLAGS.permitBought },
          { kind: 'score', delta: 25 },
        ],
      },
      {
        id: 'sign-up',
        text: '在志愿者名单上签字。他签的时候以为是招工，你知道自己签的是什么。',
        detail: '从今天起，实验室认识你。你的编号在名单上，排得很前。',
        requires: { flagsAll: [QUEST_FLAG.objective('permit', 'volunteer-list'), QUEST_FLAG.objective('permit', 'for-everyone')] },
        consequences: [
          { kind: 'grantPass', pass: 'permit' },
          { kind: 'setFlag', flag: STORY_FLAGS.permitVolunteered },
          { kind: 'score', delta: 25 },
        ],
      },
      {
        id: 'blackmail-gate',
        text: '攥着名单和不写内容的箱子记录，要挟门禁室放行。',
        detail: '文员给你按了许可。她记住你的脸了——这辈子忘不掉了。',
        requires: { flagsAll: [QUEST_FLAG.objective('permit', 'volunteer-list'), QUEST_FLAG.objective('permit', 'unmarked-boxes')] },
        consequences: [
          { kind: 'grantPass', pass: 'permit' },
          { kind: 'setFlag', flag: STORY_FLAGS.permitBlackmailed },
          { kind: 'score', delta: 25 },
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  // 阶层 5：富人特权区（50000–50010）。故事节点 5：富人不只知道，他们买单。
  // -------------------------------------------------------------------------
  {
    id: 'vip-card',
    kind: 'main',
    segment: 5,
    title: '贵宾卡',
    giver: 'banquet_staff',
    anchorFloor: 10010,
    summary:
      '10010 层顶只认体面。穿得像样、带一份礼物能进去；志愿者的监护人会给你一张请柬；被要挟过的门禁室愿意开后门。',
    trigger: { minFloor: 10010 },
    requires: ['permit'],
    objectives: [
      obj('vip-card', 'pet', '听楼上来的人说：他们在楼上养着它，像养一条看门狗。', { tier: 5, index: 0 }),
      obj('vip-card', 'money', '花钱能买到通行。买不到下楼的理由。', { tier: 5, index: 1 }),
      obj('vip-card', 'banquet', '记住日子：盛宴那天，整个塔都安静得不对。', { tier: 5, index: 2 }),
    ],
    branches: [
      {
        id: 'bought-in',
        text: '做一身像样的衣服，带一份礼物（废金属 1 + 布料 2 + 电池 1）。',
        detail: '富人区只认体面。你付得起的时候，它就不问你从哪来。',
        requires: { items: [{ itemId: 'scrap_metal', count: 1 }, { itemId: 'cloth', count: 2 }, { itemId: 'battery', count: 1 }] },
        consequences: [
          { kind: 'takeItem', itemId: 'scrap_metal', count: 1 },
          { kind: 'takeItem', itemId: 'cloth', count: 2 },
          { kind: 'takeItem', itemId: 'battery', count: 1 },
          { kind: 'grantPass', pass: 'vip_card' },
          { kind: 'setFlag', flag: STORY_FLAGS.vipBoughtIn },
          { kind: 'score', delta: 25 },
        ],
      },
      {
        id: 'handler-invite',
        text: '去找实验室给你派的监护人。他会给你一张请柬。',
        detail: '「你是我们的志愿者。」他说这话像在念编号。请柬是烫金的。',
        requires: { flagsAll: [STORY_FLAGS.permitVolunteered] },
        consequences: [
          { kind: 'grantPass', pass: 'vip_card' },
          { kind: 'setFlag', flag: STORY_FLAGS.vipHandlerInvite },
          { kind: 'score', delta: 25 },
        ],
      },
      {
        id: 'back-door',
        text: '走被要挟出来的那条后门。侍从认得你，不敢拦。',
        detail: '后门没有请柬这一说。你进来时，宴会已经安静得不对了。',
        requires: { flagsAll: [STORY_FLAGS.permitBlackmailed] },
        consequences: [
          { kind: 'grantPass', pass: 'vip_card' },
          { kind: 'setFlag', flag: STORY_FLAGS.vipBackDoor },
          { kind: 'score', delta: 25 },
        ],
      },
    ],
  },
  {
    id: 'feast-ledger',
    kind: 'side',
    segment: 5,
    title: '盛宴之夜',
    giver: 'banquet_staff',
    anchorFloor: 50000,
    summary:
      '盛宴那天，整个塔都安静得不对。侍者问你：只是吃，还是把账本也带走？带走它，需要一块还够电的电池。',
    trigger: { minFloor: 50000, flagsAll: [QUEST_FLAG.done('vip-card')] },
    objectives: [
      obj('feast-ledger', 'enter', '混进盛宴。穿体面，或者本就在名单上。'),
      obj('feast-ledger', 'ledger', '找到宴会的账本：谁买了什么，谁签的字。'),
    ],
    branches: [
      {
        id: 'record',
        text: '用电池给录音笔续上电，把账本一页页录下来。',
        detail: '电池换了半本账。上楼之后，你会需要它。',
        requires: { items: [{ itemId: 'battery', count: 1 }] },
        consequences: [
          { kind: 'takeItem', itemId: 'battery', count: 1 },
          { kind: 'setFlag', flag: STORY_FLAGS.feastHasEvidence },
          { kind: 'score', delta: 50 },
        ],
      },
      {
        id: 'decline',
        text: '不录。你只想活着上去。',
        detail: '你吃了东西，喝了酒，像个普通客人一样离开。账本留在楼上。',
        consequences: [
          { kind: 'setFlag', flag: STORY_FLAGS.feastNoEvidence },
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  // 阶层 6：统治核心（100000）。故事节点 6：你就是下一批志愿者。
  // -------------------------------------------------------------------------
  {
    id: 'same-pen',
    kind: 'finale',
    segment: 6,
    title: '同一支笔',
    giver: 'core_terminal',
    anchorFloor: 100000,
    summary:
      '停电表、配给表、处决名单，是同一支笔写的。终端把权限放在你手里，问你要关上它，还是坐上它。钥匙在你手里——现在你也是这套系统的一部分。',
    trigger: { minFloor: 100000 },
    requires: ['vip-card'],
    objectives: [
      obj('same-pen', 'key', '钥匙在你手里。现在你也是这套系统的一部分。', { tier: 6, index: 0 }),
      obj('same-pen', 'pen', '把三张表并排看：停电表、配给表、处决名单，是同一支笔写的。', { tier: 6, index: 1 }),
      obj('same-pen', 'door', '你要么关上它，要么坐上它。', { tier: 6, index: 2 }),
    ],
    branches: [
      {
        id: 'shutdown',
        text: '关上它。让整座塔黑下来，从一楼开始。',
        detail: '配电房的灯一颗颗灭掉。周三、周五从此只是一个日子。',
        consequences: [
          { kind: 'setFlag', flag: STORY_FLAGS.endingShutdown },
          { kind: 'score', delta: 100 },
        ],
      },
      {
        id: 'hand-over',
        text: '把整套证据交给底层。让他们自己决定塔的命运。',
        detail: '账本、签字页、名单。你把自己爬过的一切，交给一开始就在底层的人。',
        requires: { flagsAll: [STORY_FLAGS.feastHasEvidence], flagsNone: [STORY_FLAGS.tapExploited] },
        consequences: [
          { kind: 'setFlag', flag: STORY_FLAGS.endingHandOver },
          { kind: 'score', delta: 100 },
        ],
      },
      {
        id: 'throne',
        text: '坐上它。你本来就是这套系统的一部分。',
        detail: '椅子是空的，也是为你留的。编号也好，请柬也好，后门也好——路早就选过了。',
        requires: { flagsAny: [STORY_FLAGS.permitVolunteered, STORY_FLAGS.vipHandlerInvite] },
        consequences: [
          { kind: 'setFlag', flag: STORY_FLAGS.endingThrone },
          { kind: 'score', delta: 100 },
        ],
      },
      {
        id: 'walk-away',
        text: '转身下楼。从此不提这件事。',
        detail: '你把权限卡在终端上，一级一级走下楼。塔还是塔，你不再是你了。',
        consequences: [
          { kind: 'setFlag', flag: STORY_FLAGS.endingWalkAway },
          { kind: 'score', delta: 50 },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// 纯函数查询与求值（不碰 Math.random，不碰 Phaser，同 state 必然同结果）
// ---------------------------------------------------------------------------

export function getQuest(id: string): Quest {
  const quest = QUESTS.find((q) => q.id === id);
  if (!quest) throw new Error(`unknown quest: ${id}`);
  return quest;
}

export function questsOfSegment(segment: PlayableSegment['id']): readonly Quest[] {
  return QUESTS.filter((q) => q.segment === segment);
}

/** 背包持有量。本地实现，避免数据层反向依赖 InventorySystem。 */
function countHeld(state: GameState, itemId: ItemId): number {
  let total = 0;
  for (const stack of state.player.inventory.slots) {
    if (stack.itemId === itemId) total += stack.quantity;
  }
  return total;
}

export function conditionsMet(state: GameState, cond: QuestCondition | undefined): boolean {
  if (!cond) return true;
  if (cond.flagsAll?.some((f) => !hasFlag(state, f))) return false;
  if (cond.flagsNone?.some((f) => hasFlag(state, f))) return false;
  if (cond.flagsAny && cond.flagsAny.length > 0 && !cond.flagsAny.some((f) => hasFlag(state, f))) return false;
  if (cond.minFloor !== undefined && state.currentFloor < cond.minFloor) return false;
  if (cond.items?.some((need) => countHeld(state, need.itemId) < need.count)) return false;
  if (cond.passes?.some((pass) => !state.player.homeUpgrades.includes(pass))) return false;
  return true;
}

export type QuestStatus = 'locked' | 'available' | 'active' | 'done';

/**
 * 任务状态机。done 优先于一切（任务做完后触发条件可能已不成立，比如材料花掉了）；
 * 其次是前置任务与触发条件（locked）；然后按 accepted flag 分 available/active。
 */
export function questStatus(state: GameState, quest: Quest): QuestStatus {
  if (hasFlag(state, QUEST_FLAG.done(quest.id))) return 'done';
  if ((quest.requires ?? []).some((id) => !hasFlag(state, QUEST_FLAG.done(id)))) return 'locked';
  if (!conditionsMet(state, quest.trigger)) return 'locked';
  return hasFlag(state, QUEST_FLAG.accepted(quest.id)) ? 'active' : 'available';
}

export interface BranchEvaluation {
  readonly branch: QuestBranch;
  readonly available: boolean;
  /** 人类可读的阻塞原因（供 UI 置灰提示）；空数组表示可选 */
  readonly blockers: string[];
}

function describeCondition(state: GameState, cond: QuestCondition): string[] {
  const missing: string[] = [];
  for (const flag of cond.flagsAll ?? []) {
    if (!hasFlag(state, flag)) missing.push(`尚不知道「${flag}」`);
  }
  for (const flag of cond.flagsNone ?? []) {
    if (hasFlag(state, flag)) missing.push(`已经来不及了（「${flag}」）`);
  }
  if (cond.flagsAny && cond.flagsAny.length > 0 && !cond.flagsAny.some((f) => hasFlag(state, f))) {
    missing.push(`需要其中一条路：${cond.flagsAny.join(' / ')}`);
  }
  if (cond.minFloor !== undefined && state.currentFloor < cond.minFloor) {
    missing.push(`需要到达 ${cond.minFloor} 层`);
  }
  for (const need of cond.items ?? []) {
    const have = countHeld(state, need.itemId);
    if (have < need.count) missing.push(`${getItem(need.itemId).displayName} ${have}/${need.count}`);
  }
  for (const pass of cond.passes ?? []) {
    if (!state.player.homeUpgrades.includes(pass)) missing.push(`缺少凭证 ${pass}`);
  }
  return missing;
}

export function evaluateBranch(state: GameState, branch: QuestBranch): BranchEvaluation {
  const blockers = describeCondition(state, branch.requires ?? {});
  return { branch, available: blockers.length === 0, blockers };
}

export interface QuestEvaluation {
  readonly quest: Quest;
  readonly status: QuestStatus;
  readonly branches: readonly BranchEvaluation[];
}

/** 对单条任务求值：状态 + 每个分支此刻是否可选。纯函数。 */
export function evaluateQuest(state: GameState, quest: Quest): QuestEvaluation {
  return {
    quest,
    status: questStatus(state, quest),
    branches: quest.branches.map((branch) => evaluateBranch(state, branch)),
  };
}

/** 全量求值。同 seed 同 state 必然逐字节相同（无随机、无时钟、无遍历顺序依赖）。 */
export function evaluateAllQuests(state: GameState): readonly QuestEvaluation[] {
  return QUESTS.map((quest) => evaluateQuest(state, quest));
}

// ---------------------------------------------------------------------------
// 静态校验（测试直接断言 errors 为空；数据写错时这里先炸，而不是等集成层踩雷）
// ---------------------------------------------------------------------------

const KNOWN_FLAG_PREFIXES: readonly string[] = Object.values(FLAG_PREFIX);

function isWellFormedFlag(flag: string): boolean {
  const sep = flag.indexOf(':');
  return sep > 0 && KNOWN_FLAG_PREFIXES.includes(flag.slice(0, sep)) && flag.length > sep + 1;
}

function collectConditionFlags(cond: QuestCondition | undefined): string[] {
  if (!cond) return [];
  return [...(cond.flagsAll ?? []), ...(cond.flagsNone ?? []), ...(cond.flagsAny ?? [])];
}

function collectConsequenceFlags(consequences: readonly QuestConsequence[]): string[] {
  return consequences.flatMap((c) => (c.kind === 'setFlag' || c.kind === 'clearFlag' ? [c.flag] : []));
}

function segmentById(id: number): PlayableSegment {
  const segment = PLAYABLE_SEGMENTS.find((s) => s.id === id);
  if (!segment) throw new Error(`unknown segment: ${id}`);
  return segment;
}

export interface QuestValidation {
  readonly errors: readonly string[];
}

export function validateQuests(): QuestValidation {
  const errors: string[] = [];
  const byId = new Map<string, Quest>();
  for (const quest of QUESTS) {
    if (byId.has(quest.id)) errors.push(`duplicate quest id: ${quest.id}`);
    byId.set(quest.id, quest);
  }

  for (const quest of QUESTS) {
    const where = `quest ${quest.id}`;

    // 段位与阶层一一对应（docs/18 §2）。锚点要么落在自己守着的段里（段内任务/
    // 终局），要么落在前一段的顶层——段际主线任务就是在货梯口被触发的。
    const segment = segmentById(quest.segment);
    const prev = PLAYABLE_SEGMENTS.filter((s) => s.id < quest.segment).pop();
    const boundaryAnchor = prev?.to;
    const inSegment = quest.anchorFloor >= segment.from && quest.anchorFloor <= segment.to;
    const atBoundary = boundaryAnchor !== undefined && quest.anchorFloor === boundaryAnchor;
    if (!inSegment && !atBoundary) {
      errors.push(
        `${where}: anchorFloor ${quest.anchorFloor} is neither inside segment ${quest.segment} (${segment.from}-${segment.to}) nor the lift below it (${boundaryAnchor ?? 'none'})`,
      );
    }

    // 前置任务必须存在，且不能引到自己（环的第一种形态）。
    for (const req of quest.requires ?? []) {
      if (req === quest.id) errors.push(`${where}: requires itself`);
      if (!byId.has(req)) errors.push(`${where}: unknown prerequisite ${req}`);
    }

    // 目标与分支的基本面。
    if (quest.objectives.length === 0) errors.push(`${where}: has no objectives`);
    if (quest.branches.length === 0) errors.push(`${where}: has no branches`);
    for (const objective of quest.objectives) {
      if (!isWellFormedFlag(objective.doneFlag)) errors.push(`${where}: objective ${objective.id} has malformed doneFlag`);
      if (objective.note) {
        if (objective.note.index < 0 || objective.note.index > 2) {
          errors.push(`${where}: objective ${objective.id} note index ${objective.note.index} out of 0..2`);
        }
      }
    }

    // 进入段 2..5 的主线任务：每条分支都必须发放该段准入凭证——
    // 这是「无软锁」的数据保证：任何一条分支走完，玩家都摸得到下一段的门。
    // （段 1 无需凭证；终局段 6 的凭证在上一段的工作台打造，见 recipes.core_key。）
    const passOfSegment = quest.kind === 'main' && quest.segment >= 2 && quest.segment <= 5 ? segment.requiresPass : null;
    for (const branch of quest.branches) {
      if (branch.consequences.length === 0) errors.push(`${where}/${branch.id}: branch has no consequences`);
      for (const flag of [...collectConditionFlags(branch.requires), ...collectConsequenceFlags(branch.consequences)]) {
        if (!isWellFormedFlag(flag)) errors.push(`${where}/${branch.id}: malformed flag "${flag}"`);
      }
      for (const c of branch.consequences) {
        if (c.kind === 'grantPass' && !PASS_UPGRADE_IDS.includes(c.pass)) {
          errors.push(`${where}/${branch.id}: grantPass ${c.pass} is not a pass id`);
        }
        if ((c.kind === 'giveItem' || c.kind === 'takeItem') && !isItemId(c.itemId)) {
          errors.push(`${where}/${branch.id}: unknown itemId ${c.itemId}`);
        }
      }
      if (passOfSegment && !branch.consequences.some((c) => c.kind === 'grantPass' && c.pass === passOfSegment)) {
        errors.push(`${where}/${branch.id}: does not grant ${passOfSegment} (soft-lock risk)`);
      }
      if (!passOfSegment && branch.consequences.some((c) => c.kind === 'grantPass')) {
        errors.push(`${where}/${branch.id}: grants a pass but is not a segment-entry main quest`);
      }
    }

    for (const flag of collectConditionFlags(quest.trigger)) {
      if (!isWellFormedFlag(flag)) errors.push(`${where}: malformed trigger flag "${flag}"`);
    }
  }

  // 无环：沿 requires 做三色 DFS。
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const visit = (id: string, trail: readonly string[]): void => {
    const c = color.get(id) ?? WHITE;
    if (c === GRAY) {
      errors.push(`quest cycle: ${[...trail, id].join(' -> ')}`);
      return;
    }
    if (c === BLACK) return;
    color.set(id, GRAY);
    const quest = byId.get(id);
    for (const req of quest?.requires ?? []) visit(req, [...trail, id]);
    color.set(id, BLACK);
  };
  for (const quest of QUESTS) visit(quest.id, []);

  // 覆盖：每个可玩段至少一条任务（docs/18 §2 的六段，含五个可玩段与终局段）。
  for (const segment of PLAYABLE_SEGMENTS) {
    if (!QUESTS.some((q) => q.segment === segment.id)) {
      errors.push(`segment ${segment.id} (${segment.name}) has no quest`);
    }
  }

  return { errors };
}
