// AG-67：角色自言自语 + 处境摘要 —— 右下角色卡的文案层。
//
// 两条产品诉求（用户 2026-11-17）：
//   ①「右下角能看到角色的状态」→ 处境摘要 statusSummaryLine（面板用，见
//      GameScene.buildStatusCard）；
//   ②「角色也会对于自己的处境自言自语」→ 本文件的台词表与节流门。
//
// 硬约束：**不依赖 AI NPC 开关**。src/ai 那条链路由 VITE_NPC_MODEL 环境变量
// 控制、默认关闭，自言自语因此必须是「本地词表 + 处境推导」的确定性系统：
// 本模块零 Phaser 依赖、零 ai 依赖，纯数据 + 纯函数，可在 Node 单测里直接跑
// （vitest environment: 'node'）。
//
// 阈值与节流数值全部走 config/game-balance.json 的 statusPanel 段（自己的段，
// 不动别人的键）；JSON 缺段时回落 DEFAULT_STATUS_PANEL，坏档不至于让角色
// 永远闭嘴。

import { GAME_CONFIG } from '../core/config';

// ── 类型 ────────────────────────────────────────────────────────────────────

/** 词表音色。metaSelectedCharacter 选谁，自言自语就用谁的口吻。 */
export type MonologueVoice = 'player' | 'alin' | 'xiaozhou';

/** 处境种类。面板/场景只报「哪一种处境」，挑哪句是词表的事。 */
export type MonologueTrigger =
  | 'hp_low'
  | 'hunger_low'
  | 'thirst_low'
  | 'energy_low'
  | 'night_fall'
  | 'new_floor'
  | 'good_loot'
  | 'combat_win';

export interface MonologueLine {
  /** 全局唯一（`音色.处境.序号`），节流按它记冷却。 */
  id: string;
  text: string;
}

/** 四条生存槽位的快照，字段与 PlayerState 同名（stress 可选，同状态本身）。 */
export interface SurvivalSnapshot {
  hp: number;
  hunger: number;
  thirst: number;
  energy: number;
  stress?: number;
}

/** 节流记忆：上次开口时间、每句的冷却到期时间、上一句是谁。 */
export interface MonologueMemory {
  lastSpokenAt: number;
  lineReadyAt: Record<string, number>;
  lastLineId: string | null;
}

/** 处境摘要的语气，驱动右下角色卡那行字的颜色。 */
export type SummaryTone = 'danger' | 'warn' | 'ok';
export interface StatusSummary {
  text: string;
  tone: SummaryTone;
}

/** config/game-balance.json → statusPanel 段的形状（本 Agent 自己的段）。 */
export interface StatusPanelBalance {
  summary: {
    /** 生命比值低于它 → 「伤痕累累」 */
    hpDangerRatio: number;
    /** 饥饿/口渴/精力比值低于它 → 各自的一行摘要 */
    statLowRatio: number;
    /** stress（0..100）达到它 → 「心力交瘁」（含边界，与 statusSummaryLine 的 >= 一致） */
    stressHigh: number;
  };
  monologue: {
    /** 处境巡检周期（ms）。不许每帧刷，250ms 足够且便宜。 */
    tickMs: number;
    /** 两句话之间的最小间隔（ms）——防刷屏的总闸。 */
    minGapMs: number;
    /** 同一句话的冷却（ms）——不许复读。 */
    lineCooldownMs: number;
    /** 头顶飘字存活（ms），到点淡出消失。 */
    bubbleMs: number;
    triggers: {
      hpRatio: number;
      hungerRatio: number;
      thirstRatio: number;
      energyRatio: number;
      night: boolean;
      newFloor: boolean;
      goodLoot: boolean;
      combatWin: boolean;
    };
  };
}

// ── 配置读数 ────────────────────────────────────────────────────────────────

const DEFAULT_STATUS_PANEL: StatusPanelBalance = {
  summary: { hpDangerRatio: 0.3, statLowRatio: 0.25, stressHigh: 70 },
  monologue: {
    tickMs: 250,
    minGapMs: 9000,
    lineCooldownMs: 45_000,
    bubbleMs: 2600,
    triggers: { hpRatio: 0.3, hungerRatio: 0.25, thirstRatio: 0.25, energyRatio: 0.25, night: true, newFloor: true, goodLoot: true, combatWin: true },
  },
};

// GAME_CONFIG 的类型在 src/core/config.ts（共享文件，本 Agent 不碰），所以
// statusPanel 段在那边没有声明；运行时对象就是那份 JSON，本地按形状取用、
// 缺段回落默认值。改平衡只动 config/game-balance.json。
const rawStatusPanel = (GAME_CONFIG as unknown as { statusPanel?: Partial<StatusPanelBalance> }).statusPanel;

export const STATUS_PANEL_BALANCE: StatusPanelBalance = {
  summary: { ...DEFAULT_STATUS_PANEL.summary, ...rawStatusPanel?.summary },
  monologue: {
    ...DEFAULT_STATUS_PANEL.monologue,
    ...rawStatusPanel?.monologue,
    triggers: { ...DEFAULT_STATUS_PANEL.monologue.triggers, ...rawStatusPanel?.monologue?.triggers },
  },
};

/** 四条槽位的归一化上限，与 render/feedback.ts 同源（都读 player 段）。 */
const STAT_MAXES = {
  hp: GAME_CONFIG.player.hpMax,
  hunger: GAME_CONFIG.player.hungerMax,
  thirst: GAME_CONFIG.player.thirstMax,
  energy: GAME_CONFIG.player.energyMax,
} as const;

export type UrgentStat = keyof typeof STAT_MAXES;

// ── 台词表（72 句 = 8 处境 × 3 音色；音色缺句回退玩家套） ───────────────────

const LINES: Record<MonologueVoice, Record<MonologueTrigger, MonologueLine[]>> = {
  player: {
    hp_low: [
      { id: 'player.hp_low.0', text: '得赶紧处理下伤口……' },
      { id: 'player.hp_low.1', text: '血一直在渗，撑不了多久' },
      { id: 'player.hp_low.2', text: '这伤再拖要坏事' },
    ],
    hunger_low: [
      { id: 'player.hunger_low.0', text: '肚子叫得厉害……' },
      { id: 'player.hunger_low.1', text: '前胸贴后背，得找点吃的' },
      { id: 'player.hunger_low.2', text: '饿得手都在抖' },
    ],
    thirst_low: [
      { id: 'player.thirst_low.0', text: '嘴唇干得发裂……' },
      { id: 'player.thirst_low.1', text: '嗓子眼冒烟，得找水' },
      { id: 'player.thirst_low.2', text: '现在只想喝水' },
    ],
    energy_low: [
      { id: 'player.energy_low.0', text: '眼皮沉得抬不起来……' },
      { id: 'player.energy_low.1', text: '腿像灌了铅，得歇歇' },
      { id: 'player.energy_low.2', text: '困意一阵阵往上涌' },
    ],
    night_fall: [
      { id: 'player.night_fall.0', text: '天一黑，这地方更瘆人了……' },
      { id: 'player.night_fall.1', text: '又入夜了，把光省着点用' },
      { id: 'player.night_fall.2', text: '夜长梦多，动作快点' },
    ],
    new_floor: [
      { id: 'player.new_floor.0', text: '又一层。上面到底有什么？' },
      { id: 'player.new_floor.1', text: '新的一层，先看清再走' },
      { id: 'player.new_floor.2', text: '这层没人翻过，仔细搜' },
    ],
    good_loot: [
      { id: 'player.good_loot.0', text: '运气不错。' },
      { id: 'player.good_loot.1', text: '这玩意儿能派上用场' },
      { id: 'player.good_loot.2', text: '翻箱倒柜总算有回报' },
    ],
    combat_win: [
      { id: 'player.combat_win.0', text: '解决了……手还在抖' },
      { id: 'player.combat_win.1', text: '赢了，但赢得难看' },
      { id: 'player.combat_win.2', text: '那东西倒下的声音，不想再听第二次' },
    ],
  },
  alin: {
    hp_low: [
      { id: 'alin.hp_low.0', text: '伤口得先包扎，硬撑没用' },
      { id: 'alin.hp_low.1', text: '得找绷带，工具箱里应该有' },
      { id: 'alin.hp_low.2', text: '血再流要坏事' },
    ],
    hunger_low: [
      { id: 'alin.hunger_low.0', text: '半天没进食，血糖顶不住' },
      { id: 'alin.hunger_low.1', text: '挨饿找不了物资，先翻吃的' },
      { id: 'alin.hunger_low.2', text: '空肚子干不动活' },
    ],
    thirst_low: [
      { id: 'alin.thirst_low.0', text: '脱水比挨饿更急' },
      { id: 'alin.thirst_low.1', text: '这层潮是潮，能喝的水没有' },
      { id: 'alin.thirst_low.2', text: '得找净水，脏水别碰' },
    ],
    energy_low: [
      { id: 'alin.energy_low.0', text: '精力见底了，硬撑要出事' },
      { id: 'alin.energy_low.1', text: '熬不住了，得找个地方眯一会' },
      { id: 'alin.energy_low.2', text: '疲劳操作要出事故' },
    ],
    night_fall: [
      { id: 'alin.night_fall.0', text: '又入夜了，把火看紧点' },
      { id: 'alin.night_fall.1', text: '天一黑，老鼠全出来了' },
      { id: 'alin.night_fall.2', text: '夜里别乱跑，省点力气' },
    ],
    new_floor: [
      { id: 'alin.new_floor.0', text: '又深了一层，记号得做' },
      { id: 'alin.new_floor.1', text: '新楼层，先看结构再动手' },
      { id: 'alin.new_floor.2', text: '楼梯井在这儿，记一下' },
    ],
    good_loot: [
      { id: 'alin.good_loot.0', text: '这件有用，收着' },
      { id: 'alin.good_loot.1', text: '好东西，别浪费了' },
      { id: 'alin.good_loot.2', text: '留着，以后用得上' },
    ],
    combat_win: [
      { id: 'alin.combat_win.0', text: '以伤换命，不划算' },
      { id: 'alin.combat_win.1', text: '解决了，检查下装备' },
      { id: 'alin.combat_win.2', text: '动手是最后选项，生效了' },
    ],
  },
  xiaozhou: {
    hp_low: [
      { id: 'xiaozhou.hp_low.0', text: '好疼……谁、谁能帮我包扎一下' },
      { id: 'xiaozhou.hp_low.1', text: '血……这么多血' },
      { id: 'xiaozhou.hp_low.2', text: '疼……想回家' },
    ],
    hunger_low: [
      { id: 'xiaozhou.hunger_low.0', text: '肚子好饿……还有吃的吗' },
      { id: 'xiaozhou.hunger_low.1', text: '饿到走不动了' },
      { id: 'xiaozhou.hunger_low.2', text: '想吃面包，热的' },
    ],
    thirst_low: [
      { id: 'xiaozhou.thirst_low.0', text: '好渴……嘴巴里全是沙子' },
      { id: 'xiaozhou.thirst_low.1', text: '我想喝水，干净的' },
      { id: 'xiaozhou.thirst_low.2', text: '渴得头晕' },
    ],
    energy_low: [
      { id: 'xiaozhou.energy_low.0', text: '好困……我想睡觉' },
      { id: 'xiaozhou.energy_low.1', text: '走不动了，好想睡一会儿' },
      { id: 'xiaozhou.energy_low.2', text: '眼皮在打架' },
    ],
    night_fall: [
      { id: 'xiaozhou.night_fall.0', text: '天黑了……别来找我别来找我' },
      { id: 'xiaozhou.night_fall.1', text: '夜里总有脚步声，嚇人' },
      { id: 'xiaozhou.night_fall.2', text: '把灯留在身边好不好' },
    ],
    new_floor: [
      { id: 'xiaozhou.new_floor.0', text: '又、又换了一层……' },
      { id: 'xiaozhou.new_floor.1', text: '这一层闻起来就不对劲' },
      { id: 'xiaozhou.new_floor.2', text: '上面还有什么啊……' },
    ],
    good_loot: [
      { id: 'xiaozhou.good_loot.0', text: '哇，这个能换面包吧？' },
      { id: 'xiaozhou.good_loot.1', text: '捡到宝了！' },
      { id: 'xiaozhou.good_loot.2', text: '这个给我吧！我最需要这个' },
    ],
    combat_win: [
      { id: 'xiaozhou.combat_win.0', text: '打、打赢了？我还活着……' },
      { id: 'xiaozhou.combat_win.1', text: '腿软了……真的赢了' },
      { id: 'xiaozhou.combat_win.2', text: '以后别打架了，吓死了' },
    ],
  },
};

/** 触发时的冲洗优先级：能秒人的排最前，氛围类的排最后。 */
export const MONOLOGUE_TRIGGER_PRIORITY: readonly MonologueTrigger[] = [
  'hp_low',
  'thirst_low',
  'hunger_low',
  'energy_low',
  'combat_win',
  'good_loot',
  'new_floor',
  'night_fall',
];

/** 「搜刮到好东西」的判定集：真正难搞、值得哼一声的几样。 */
const GOOD_LOOT_IDS: ReadonlySet<string> = new Set(['medkit', 'filter', 'crowbar', 'battery', 'clean_water']);

export function isGoodLoot(itemId: string): boolean {
  return GOOD_LOOT_IDS.has(itemId);
}

/** meta 里的 CharacterKey → 词表音色；没有专属词表的角色用玩家套。 */
export function monologueVoiceFor(who: string): MonologueVoice {
  if (who === 'npc_alin') return 'alin';
  if (who === 'npc_xiaozhou') return 'xiaozhou';
  return 'player';
}

export function freshMonologueMemory(): MonologueMemory {
  return { lastSpokenAt: Number.NEGATIVE_INFINITY, lineReadyAt: {}, lastLineId: null };
}

/**
 * 阈值跨线检测：上一拍还在线上（或没有上一拍），这一拍跌到线下。
 * 纯函数，测试直接喂数；恢复（从线下回到线上）不算跨线，不触发。
 */
export function crossedBelow(prev: number | null, now: number, threshold: number): boolean {
  if (prev === null) return false;
  return prev >= threshold && now < threshold;
}

/**
 * 节流门 + 挑句。返回 null 表示「这句处境现在不许说」（总闸未到时间，或该
 * 处境所有句子都在冷却）；否则返回新记忆与选中的句子。挑选规则：
 *   ① 优先没到冷却、且不等于上一句的；
 *   ② 全被上一句占光时（单句池），允许复读冷却已到的那句；
 *   ③ 池子空（配置坏了）返回 null，绝不死循环刷屏。
 */
export function chooseMonologue(
  memory: MonologueMemory,
  now: number,
  trigger: MonologueTrigger,
  voice: MonologueVoice,
  cfg: StatusPanelBalance,
  rng: () => number,
): { line: MonologueLine; memory: MonologueMemory } | null {
  if (now - memory.lastSpokenAt < cfg.monologue.minGapMs) return null;
  const pool = LINES[voice]?.[trigger] ?? LINES.player[trigger] ?? [];
  const ready = pool.filter((l) => (memory.lineReadyAt[l.id] ?? Number.NEGATIVE_INFINITY) <= now);
  if (ready.length === 0) return null;
  const fresh = ready.filter((l) => l.id !== memory.lastLineId);
  const usable = fresh.length > 0 ? fresh : ready;
  const roll = Math.min(0.999999, Math.max(0, rng()));
  const line = usable[Math.floor(roll * usable.length)];
  return {
    line,
    memory: {
      lastSpokenAt: now,
      lastLineId: line.id,
      lineReadyAt: { ...memory.lineReadyAt, [line.id]: now + cfg.monologue.lineCooldownMs },
    },
  };
}

// ── 处境摘要（右下角色卡那一行字） ─────────────────────────────────────────

/** 四条槽位各自归一化后的「低」判定，饥饿/口渴/精力共用一个比值线。 */
function statRatio(p: SurvivalSnapshot, stat: UrgentStat): number {
  const max = STAT_MAXES[stat];
  if (!(max > 0)) return 1; // 上限非正的坏配置：按「不低」处理，不刷警告
  return p[stat] / max;
}

/**
 * 一句话处境摘要，由数值推导。规则有序、先重后轻：能秒人的（生命）压过
 * 一切的，「又饿又渴」压过单一槽位。阈值走配置的 summary 段。
 */
export function statusSummaryLine(p: SurvivalSnapshot, cfg: StatusPanelBalance): StatusSummary {
  const low = cfg.summary.statLowRatio;
  const hunger = statRatio(p, 'hunger');
  const thirst = statRatio(p, 'thirst');
  const energy = statRatio(p, 'energy');
  if (statRatio(p, 'hp') < cfg.summary.hpDangerRatio) return { text: '伤痕累累，得处理下了', tone: 'danger' };
  if (hunger < low && thirst < low) return { text: '又饿又渴，撑不了多久', tone: 'danger' };
  if (hunger < low) return { text: '饥肠辘辘', tone: 'warn' };
  if (thirst < low) return { text: '口干舌燥', tone: 'warn' };
  if (energy < low) return { text: '疲惫不堪', tone: 'warn' };
  if ((p.stress ?? 20) >= cfg.summary.stressHigh) return { text: '心力交瘁', tone: 'warn' };
  return { text: '状态尚可', tone: 'ok' };
}

/** 台词表规模，供测试与报告对数（不靠手数）。 */
export const MONOLOGUE_LINE_COUNT: number = Object.values(LINES).reduce(
  (n, byTrigger) => n + Object.values(byTrigger).reduce((m, lines) => m + lines.length, 0),
  0,
);
