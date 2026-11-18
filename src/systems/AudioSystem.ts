// AG-74：BGM 音乐层（WebAudio 程序化合成，零音频素材）。
//
// 为什么程序化：docs/05_ART_GUIDE.md §4 与 render/audio.ts 的同款约束——发行
// 包不带任何音频文件，一切声音运行时合成。音效层在 render/audio.ts（playSfx），
// 本文件是**音乐通道**：TWOM 把音乐单开一条通道（AvgDepressionChangeForCheerful
// Music），本作的落点就是这里——三套场景音乐 + 收音机电台 + 夜晚氛围。
//
// 两层结构，边界即可测性：
//   纯函数层（TRACKS / noteFreq / resolveTrackId / reduceAudio / readBgmVolume…）
//     ——不碰 WebAudio、不碰 Phaser、不碰 window，Node 下直接单测
//     （src/tests/audio.test.ts）。禁 Math.random：pattern 全是写死的数据，
//     唯一噪声源是固定种子的 LCG（与 render/audio.ts 同 seed）。
//   WebAudio 适配层（ensureAudio / startTrack / scheduler…）
//     ——薄：只负责把纯函数层排出的音符落到 AudioContext 时间线上。
//
// 时钟：lookahead scheduler（"A Tale of Two Clocks"）——setInterval 每 25ms 醒
// 一次，每次把未来 0.25s 的音符按 ctx.currentTime 绝对时间排上 OscillatorNode。
// 音符时序来自音频时钟而非 JS 定时器，setInterval 的抖动只影响"提前多久排"，
// 不影响"什么时候响"。不写死 setTimeout 漂移。
//
// 自动播放策略：AudioContext 必须在用户手势后 resume。适配层把"想要哪首曲子"
// 记下来（pendingTrack），手势到来时补播——MenuScene 的第一次点击/按键即手势
// （main.ts 对音效层有同款全局解锁，这里独立一份，因为 BGM 有独立音量总线）。

// 夜晚边界与战斗判定都复用 SurvivalSystem 的纯函数（同源不复刻）。
import { isNight } from './SurvivalSystem';
// AG-117：bgmVolume 的单一事实源是 SettingsSystem（AG-72）——存储 key、清洗
// 规则、默认值全部收在那里，本模块只委托读取，不再复刻第二份默认常量。
import { getSettings } from './SettingsSystem';

// ── 曲目与纯函数层 ─────────────────────────────────────────────────────────

/** 五条通道：菜单 / 楼层探索 / 战斗 / 夜晚氛围 / 收音机电台。 */
export type TrackId = 'menu' | 'floor' | 'combat' | 'night' | 'radio';

/** 一个旋律事件：第几个 16 分音符起、MIDI 音高、持续几个 16 分。 */
export interface NoteEvent {
  step: number;
  midi: number;
  /** 持续时间，单位 16 分音符步。 */
  dur: number;
}

/** 一层旋律（主音/贝斯/pad）。 */
export interface Layer {
  wave: OscillatorType;
  /** 峰值增益（未乘总线音量与曲目微调）。 */
  gain: number;
  notes: readonly NoteEvent[];
  /** 低通截止Hz——芯片音去掉毛刺的廉价手段。 */
  lowpass?: number;
  /** 起音秒数，pad 用长起音。 */
  attack?: number;
  /** 释音秒数。 */
  release?: number;
}

/** 打击乐层：三个桶各自写中招的步号。 */
export interface Drums {
  kick?: readonly number[];
  snare?: readonly number[];
  hat?: readonly number[];
}

export interface TrackDef {
  id: TrackId;
  bpm: number;
  /** pattern 长度（小节）。 */
  bars: number;
  layers: readonly Layer[];
  drums?: Drums;
  /** 曲目间相对响度微调。 */
  trim: number;
}

// 全部音高用 MIDI 号写（69 = A4 = 440Hz），可读且不手算频率。
// 16bit 气质三件套：方波主音、三角波贝斯/pad、噪声打击乐——不用正弦波
// （一片柔软），也不用锯齿波（糊）。
export const TRACKS: Record<TrackId, TrackDef> = {
  // 主菜单：慢氛围。54 BPM，4 小节 Am–F–C–G 的 pad 长音 + 稀疏方波动机
  // （A4 … C5 E5 … E5 C5 … A4 收尾），像坏掉的广播里漏出来的一首歌。
  menu: {
    id: 'menu',
    bpm: 54,
    bars: 4,
    trim: 1,
    layers: [
      {
        wave: 'triangle',
        gain: 0.16,
        lowpass: 850,
        attack: 0.35,
        release: 0.9,
        notes: [
          { step: 0, midi: 45, dur: 16 }, // A2（Am）
          { step: 16, midi: 41, dur: 16 }, // F2（F）
          { step: 32, midi: 48, dur: 16 }, // C3（C）
          { step: 48, midi: 43, dur: 16 }, // G2（G）
        ],
      },
      {
        wave: 'square',
        gain: 0.055,
        lowpass: 2600,
        attack: 0.01,
        release: 0.25,
        notes: [
          { step: 8, midi: 69, dur: 6 }, // A4
          { step: 16, midi: 72, dur: 6 }, // C5
          { step: 26, midi: 76, dur: 6 }, // E5
          { step: 32, midi: 76, dur: 6 }, // E5
          { step: 42, midi: 72, dur: 6 }, // C5
          { step: 48, midi: 69, dur: 12 }, // A4 收尾
        ],
      },
    ],
  },

  // 楼层探索：中性循环。88 BPM，2 小节 D 小调——三角波贝斯级进 + 隔一拍的
  // 底鼓/军鼓 + 每两小节才两个的方波碎音。设计目标是"不抢注意力"：玩家盯
  // 背包和血条时它不该被听见，安静下来时才意识到一直在响。
  floor: {
    id: 'floor',
    bpm: 88,
    bars: 2,
    trim: 0.9,
    layers: [
      {
        wave: 'triangle',
        gain: 0.2,
        lowpass: 700,
        attack: 0.005,
        release: 0.06,
        notes: [
          { step: 0, midi: 38, dur: 3 }, // D2
          { step: 4, midi: 45, dur: 2 }, // A2
          { step: 6, midi: 38, dur: 2 }, // D2
          { step: 8, midi: 45, dur: 3 }, // A2
          { step: 12, midi: 43, dur: 2 }, // G2
          { step: 14, midi: 41, dur: 2 }, // F2
          { step: 16, midi: 38, dur: 3 }, // D2
          { step: 20, midi: 45, dur: 2 }, // A2
          { step: 22, midi: 38, dur: 2 }, // D2
          { step: 24, midi: 45, dur: 3 }, // A2
          { step: 28, midi: 43, dur: 2 }, // G2
          { step: 30, midi: 38, dur: 2 }, // D2
        ],
      },
      {
        wave: 'square',
        gain: 0.05,
        lowpass: 3000,
        attack: 0.004,
        release: 0.08,
        notes: [
          { step: 14, midi: 69, dur: 2 }, // A4
          { step: 22, midi: 67, dur: 2 }, // G4
          { step: 30, midi: 65, dur: 2 }, // F4
        ],
      },
    ],
    drums: {
      kick: [0, 8, 16, 24],
      snare: [6, 14, 22, 30],
      hat: [0, 4, 8, 12, 16, 20, 24, 28],
    },
  },

  // 战斗：紧张循环。148 BPM，2 小节。方波贝斯在 D2/Eb2 之间的小二度踏板
  // 上碾（最朴素的不和谐），主音是同音簇碎弓，16 分军鼓+每拍底鼓。没有
  // 旋律可言——它是压力，不是音乐。
  combat: {
    id: 'combat',
    bpm: 148,
    bars: 2,
    trim: 1,
    layers: [
      {
        wave: 'square',
        gain: 0.15,
        lowpass: 480,
        attack: 0.003,
        release: 0.04,
        notes: [
          { step: 0, midi: 38, dur: 1 }, // D2
          { step: 2, midi: 39, dur: 1 }, // Eb2（小二度摩擦）
          { step: 4, midi: 38, dur: 1 },
          { step: 6, midi: 39, dur: 1 },
          { step: 8, midi: 38, dur: 1 },
          { step: 10, midi: 39, dur: 1 },
          { step: 12, midi: 38, dur: 1 },
          { step: 14, midi: 39, dur: 1 },
          { step: 16, midi: 38, dur: 1 },
          { step: 18, midi: 39, dur: 1 },
          { step: 20, midi: 38, dur: 1 },
          { step: 22, midi: 39, dur: 1 },
          { step: 24, midi: 38, dur: 1 },
          { step: 26, midi: 39, dur: 1 },
          { step: 28, midi: 38, dur: 1 },
          { step: 30, midi: 39, dur: 1 },
        ],
      },
      {
        wave: 'square',
        gain: 0.1,
        lowpass: 3200,
        attack: 0.002,
        release: 0.05,
        notes: [
          { step: 0, midi: 74, dur: 2 }, // D5
          { step: 3, midi: 75, dur: 1 }, // Eb5
          { step: 4, midi: 74, dur: 2 }, // D5
          { step: 7, midi: 72, dur: 1 }, // C5
          { step: 8, midi: 74, dur: 2 },
          { step: 11, midi: 75, dur: 1 },
          { step: 12, midi: 72, dur: 2 }, // C5
          { step: 14, midi: 70, dur: 2 }, // Bb4
          { step: 16, midi: 74, dur: 2 },
          { step: 19, midi: 75, dur: 1 },
          { step: 20, midi: 74, dur: 2 },
          { step: 23, midi: 72, dur: 1 },
          { step: 24, midi: 74, dur: 2 },
          { step: 27, midi: 75, dur: 1 },
          { step: 28, midi: 72, dur: 2 },
          { step: 30, midi: 70, dur: 2 },
        ],
      },
    ],
    drums: {
      kick: [0, 4, 8, 12, 16, 20, 24, 28],
      snare: [6, 14, 22, 30],
      hat: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30],
    },
  },

  // 夜晚氛围：50 BPM，2 小节。D2 → Eb2 的两拍 drone（又是那个小二度，但
  // 放慢一倍就成了"远处有什么"而不是"眼前有东西"），三粒三角波铃音飘在
  // 上面。入夜自动切入，白天恢复楼层循环。
  night: {
    id: 'night',
    bpm: 50,
    bars: 2,
    trim: 0.8,
    layers: [
      {
        wave: 'triangle',
        gain: 0.12,
        lowpass: 650,
        attack: 0.5,
        release: 1.2,
        notes: [
          { step: 0, midi: 38, dur: 16 }, // D2
          { step: 16, midi: 39, dur: 16 }, // Eb2
        ],
      },
      {
        wave: 'triangle',
        gain: 0.05,
        lowpass: 4000,
        attack: 0.01,
        release: 0.8,
        notes: [
          { step: 8, midi: 69, dur: 4 }, // A4
          { step: 20, midi: 70, dur: 4 }, // Bb4
          { step: 24, midi: 69, dur: 6 }, // A4
        ],
      },
    ],
  },

  // 收音机电台：106 BPM，4 小节 C 大调五声。全曲最"旋律化"的一条——方波
  // 主奏 + 三角波行走贝斯 + 轻 groove。TWOM 的音乐通道在本作的化身：没有
  // 收音机，楼层只有环境氛围；有了它，废土里有电台。
  radio: {
    id: 'radio',
    bpm: 106,
    bars: 4,
    trim: 1,
    layers: [
      {
        wave: 'triangle',
        gain: 0.18,
        lowpass: 800,
        attack: 0.005,
        release: 0.07,
        notes: [
          { step: 0, midi: 36, dur: 8 }, // C2
          { step: 8, midi: 43, dur: 8 }, // G2
          { step: 16, midi: 45, dur: 8 }, // A2
          { step: 24, midi: 41, dur: 8 }, // F2
          { step: 32, midi: 41, dur: 8 }, // F2
          { step: 40, midi: 43, dur: 8 }, // G2
          { step: 48, midi: 36, dur: 8 }, // C2
          { step: 56, midi: 43, dur: 8 }, // G2
        ],
      },
      {
        wave: 'square',
        gain: 0.085,
        lowpass: 3400,
        attack: 0.004,
        release: 0.1,
        notes: [
          // bar 0
          { step: 0, midi: 72, dur: 2 }, // C5
          { step: 2, midi: 76, dur: 2 }, // E5
          { step: 4, midi: 79, dur: 4 }, // G5
          { step: 8, midi: 76, dur: 2 }, // E5
          { step: 10, midi: 74, dur: 2 }, // D5
          { step: 12, midi: 72, dur: 4 }, // C5
          // bar 1
          { step: 16, midi: 74, dur: 2 }, // D5
          { step: 18, midi: 76, dur: 2 }, // E5
          { step: 20, midi: 79, dur: 4 }, // G5
          { step: 24, midi: 81, dur: 2 }, // A5
          { step: 26, midi: 79, dur: 2 }, // G5
          { step: 28, midi: 76, dur: 4 }, // E5
          // bar 2（低八度回应，电台"唱完一段换气"）
          { step: 32, midi: 72, dur: 2 }, // C5
          { step: 34, midi: 76, dur: 2 }, // E5
          { step: 36, midi: 69, dur: 4 }, // A4
          { step: 40, midi: 67, dur: 2 }, // G4
          { step: 42, midi: 69, dur: 2 }, // A4
          { step: 44, midi: 72, dur: 4 }, // C5
          // bar 3（收句回主音）
          { step: 48, midi: 74, dur: 2 }, // D5
          { step: 50, midi: 76, dur: 2 }, // E5
          { step: 52, midi: 79, dur: 4 }, // G5
          { step: 56, midi: 76, dur: 2 }, // E5
          { step: 58, midi: 74, dur: 2 }, // D5
          { step: 60, midi: 72, dur: 4 }, // C5
        ],
      },
    ],
    drums: {
      kick: [0, 8, 16, 24, 32, 40, 48, 56],
      snare: [4, 12, 20, 28, 36, 44, 52, 60],
      hat: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60, 62],
    },
  },
};

/** MIDI 号 → 频率（Hz）。69 = A4 = 440。 */
export function noteFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** 一个 16 分音符步的秒数。 */
export function stepSeconds(track: TrackDef): number {
  return 60 / track.bpm / 4;
}

/** pattern 总步数。 */
export function trackSteps(track: TrackDef): number {
  return track.bars * 16;
}

/** 某一步上所有层要触发的旋律事件（一步可多层叠加）。 */
export function notesAtStep(track: TrackDef, step: number): readonly NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const layer of track.layers) {
    for (const note of layer.notes) {
      if (note.step === step) out.push(note);
    }
  }
  return out;
}

export type DrumKind = 'kick' | 'snare' | 'hat';

/** 某一步上要打的鼓。 */
export function drumHitsAt(track: TrackDef, step: number): readonly DrumKind[] {
  if (!track.drums) return [];
  const out: DrumKind[] = [];
  if (track.drums.kick?.includes(step)) out.push('kick');
  if (track.drums.snare?.includes(step)) out.push('snare');
  if (track.drums.hat?.includes(step)) out.push('hat');
  return out;
}

// ── 音乐上下文与优先级 ─────────────────────────────────────────────────────

/** 决定"此刻该放什么"的全部输入。gameMinute = gameMinuteOfDay（0..1439）。 */
export interface MusicContext {
  /** 战斗中（战斗面板开着）。 */
  combat: boolean;
  /** 已入夜（isNight(gameMinuteOfDay)）。 */
  night: boolean;
  /** 收音机电台的截止游戏分钟；null = 没有收音机/没开过。 */
  radioUntil: number | null;
  /** 当前游戏分钟。 */
  gameMinute: number;
}

/** 电台是否还在有效期内。 */
export function radioActiveAt(ctx: MusicContext): boolean {
  return ctx.radioUntil !== null && ctx.gameMinute < ctx.radioUntil;
}

/** 电台剩余游戏分钟（无效期返回 0）。 */
export function radioRemainingAt(ctx: MusicContext): number {
  if (!radioActiveAt(ctx)) return 0;
  return Math.max(0, (ctx.radioUntil as number) - ctx.gameMinute);
}

/**
 * 优先级：战斗 > 收音机 > 夜晚 > 楼层。
 * 战斗压电台：被围殴时没人在乎歌单。电台压夜晚：你都打开电台了，说明想听歌。
 */
export function resolveTrackId(ctx: MusicContext): TrackId {
  if (ctx.combat) return 'combat';
  if (radioActiveAt(ctx)) return 'radio';
  if (ctx.night) return 'night';
  return 'floor';
}

// ── 音量 ───────────────────────────────────────────────────────────────────

/** BGM 总线增益：音效层已有 0.4 的总线，音乐再留一半余量给叠音。 */
export const BGM_MASTER_GAIN = 0.5;

/**
 * 读 0-100 的 bgmVolume 设置，直接委托 SettingsSystem.getSettings()。
 *
 * AG-117 修复的漂移：本函数原先自带一份兜底默认 70（无设置 blob / 坏 JSON /
 * 无 localStorage 时返回），而 SettingsSystem 的 DEFAULT_SETTINGS.bgmVolume 是
 * 50——首启无存储时 BGM 实际比设置面板显示的响。根因是两个默认值各写一处、
 * 没有单一事实源。现在默认值、存储 key、清洗规则统一以 SettingsSystem 为准
 * （坏 JSON / 缺字段 / Storage 不可用的回退语义由 getSettings 逐字段兜底，
 * 与本函数旧语义一致，只多覆盖隐私模式抛错一条路径）。
 */
export function readBgmVolume(): number {
  return getSettings().bgmVolume;
}

/** 0-100 → 总线增益（0-1）。 */
export function volumeGain(volume0100: number): number {
  return (Math.min(100, Math.max(0, volume0100)) / 100) * BGM_MASTER_GAIN;
}

// ── 状态机（纯） ───────────────────────────────────────────────────────────

export interface AudioState {
  /** 当前曲目；null = 没在放。 */
  track: TrackId | null;
  /** 播放意图（false = 用户/场景叫停）。running 与否看适配层的 ctx.state。 */
  playing: boolean;
  ctx: MusicContext;
}

export type AudioAction =
  | { type: 'context'; ctx: MusicContext }
  | { type: 'radio'; gameMinute: number; minutes?: number }
  | { type: 'track'; id: TrackId; ctx?: MusicContext }
  | { type: 'stop' };

export function createAudioState(): AudioState {
  return {
    track: null,
    playing: false,
    ctx: { combat: false, night: false, radioUntil: null, gameMinute: 0 },
  };
}

/**
 * 音乐状态机的唯一转移函数。适配层每次调完它再 diff track/playing 决定
 * WebAudio 侧的动作——所以"什么时候该换曲"的全部逻辑都在这里，可单测。
 */
export function reduceAudio(state: AudioState, action: AudioAction): AudioState {
  switch (action.type) {
    case 'context':
      return { ...state, ctx: action.ctx, track: state.playing ? resolveTrackId(action.ctx) : state.track };
    case 'radio':
      return {
        ...state,
        ctx: { ...state.ctx, radioUntil: action.gameMinute + (action.minutes ?? RADIO_MINUTES) },
        track: state.playing ? 'radio' : state.track,
      };
    case 'track':
      return action.ctx
        ? { ...state, track: action.id, playing: true, ctx: action.ctx }
        : { ...state, track: action.id, playing: true };
    case 'stop':
      return { ...state, track: null, playing: false };
  }
}

// ── 收音机 ─────────────────────────────────────────────────────────────────

/**
 * 打开一次收音机换来的电台时长（游戏分钟）。流速 3 游戏分钟/现实秒
 * （config/game-balance.json time.gameMinutesPerRealSecond），180 游戏分钟
 * = 60 现实秒——够听完两遍电台 loop，又不至于永久篡改楼层氛围。
 * 与楼层无关：带着电台上楼，音乐跟着人走，到点自动让位给当前场景。
 */
export const RADIO_MINUTES = 180;

/** 供 UI 显示的文案参数。 */
export function radioMinutes(): number {
  return RADIO_MINUTES;
}

/** 背包里某个格子是不是收音机（且收音机在表里）。 */
export function isRadioItemId(itemId: string | undefined): boolean {
  return itemId === RADIO_ITEM_ID;
}

/** items.ts 里收音机的 id（避免 systems → data 的循环 import，这里只认字面量）。 */
export const RADIO_ITEM_ID = 'radio';

// ── WebAudio 适配层 ────────────────────────────────────────────────────────

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

let ctx: AudioContext | null = null;
/** BGM 总线（音量作用点）。 */
let bus: GainNode | null = null;
/** 当前曲目自己的增益节点——换曲时旧节点淡出后断开，正在响的音符随之退场。 */
let trackGain: GainNode | null = null;
/** 尚未响完的音源，硬停时逐个 stop()。 */
const activeSources = new Set<AudioScheduledSourceNode>();

let audio = createAudioState();
/** 上下文还没 resume 时记下的待播曲目（自动播放策略）。 */
let pendingTrack: TrackId | null = null;
/** WebAudio 层实际在排的曲目（与 audio.track 的"意图"分开：意图可无声音）。 */
let currentTrack: TrackId | null = null;
let gestureBound = false;
let schedulerTimer: number | null = null;

let nextStepTime = 0;
let stepIndex = 0;

const LOOKAHEAD_WAKE_MS = 25;
const SCHEDULE_AHEAD_S = 0.25;
const FADE_S = 0.09;

function resolveAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const scoped = window as Window & { webkitAudioContext?: AudioContextCtor };
  if (typeof AudioContext !== 'undefined') return AudioContext;
  if (typeof scoped.webkitAudioContext !== 'undefined') return scoped.webkitAudioContext;
  return null;
}

/** 惰性建 context（允许以 suspended 态诞生——resume 等手势）。 */
export function ensureAudio(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = resolveAudioContextCtor();
  if (!Ctor) return null;
  try {
    const context = new Ctor();
    const gain = context.createGain();
    gain.gain.value = volumeGain(readBgmVolume());
    gain.connect(context.destination);
    ctx = context;
    bus = gain;
    return context;
  } catch {
    ctx = null;
    bus = null;
    return null;
  }
}

// 首次用户手势：resume 并补播挂起的曲目。与 main.ts 对音效层的解锁各自
// 独立——这里只管音乐通道。resume 是异步的，必须等它 resolve 后再排曲，
// 否则 applyTrack 看到 suspended 会把曲子原样挂回去，永远等下一个事件。
// 补播经 dispatch 走 reducer：直排会绕过 playing 意图，被下一帧 syncMusic
// 的 "没在放就停" 立刻收拾掉。
function bindGestureUnlock(): void {
  if (gestureBound || typeof window === 'undefined') return;
  gestureBound = true;
  const unlock = (): void => {
    const context = ctx;
    if (!context) return;
    if (context.state === 'running') {
      playPending();
      return;
    }
    void context.resume().then(() => playPending()).catch(() => undefined);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

function playPending(): void {
  const want = pendingTrack;
  pendingTrack = null;
  if (!want) return;
  dispatch({ type: 'track', id: want, ctx: audio.ctx });
}

/** 立刻把某个曲目送上总线（context 必须在 running 态）。 */
function applyTrack(id: TrackId): void {
  const context = ctx;
  const master = bus;
  if (!context || !master) return;
  if (context.state !== 'running') {
    // 被浏览器压回 suspended（罕见）：记下待播，等手势。
    pendingTrack = id;
    return;
  }
  currentTrack = id;
  // 旧曲目淡出后断开；已在队列里的未来音符随节点断开一起取消。
  const previous = trackGain;
  if (previous) {
    try {
      const now = context.currentTime;
      previous.gain.cancelScheduledValues(now);
      previous.gain.setValueAtTime(previous.gain.value, now);
      previous.gain.linearRampToValueAtTime(0, now + FADE_S);
      window.setTimeout(() => previous.disconnect(), (FADE_S + 0.05) * 1000);
    } catch {
      // 淡出失败也不过是旧音符多响一拍，不断链。
    }
  }
  const gain = context.createGain();
  gain.gain.value = 1;
  gain.connect(master);
  trackGain = gain;
  stepIndex = 0;
  nextStepTime = context.currentTime + 0.06;
  if (schedulerTimer === null) {
    schedulerTimer = window.setInterval(schedulerTick, LOOKAHEAD_WAKE_MS);
  }
}

/** 把 reducer 的输出同步进 WebAudio：只在 track/playing 变化时动手。 */
function syncFromState(previous: AudioState, next: AudioState): void {
  audio = next;
  if (bus) bus.gain.value = volumeGain(readBgmVolume());
  if (!next.playing || next.track === null) {
    stopScheduler();
    return;
  }
  if (!ctx || ctx.state !== 'running') {
    // 自动播放策略还没放行：记下待播，等手势（或粘性激活的 resume）。
    pendingTrack = next.track;
    return;
  }
  if (next.track !== previous.track || !trackGain) {
    applyTrack(next.track);
  } else if (schedulerTimer === null) {
    // 同曲目、停过又起：补一个调度器，pattern 从头进。
    nextStepTime = ctx.currentTime + 0.06;
    schedulerTimer = window.setInterval(schedulerTick, LOOKAHEAD_WAKE_MS);
  }
}

function stopScheduler(): void {
  currentTrack = null;
  if (schedulerTimer !== null) {
    window.clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  for (const src of activeSources) {
    try {
      src.stop();
    } catch {
      // 已停过的节点再 stop 会抛，吞掉。
    }
  }
  activeSources.clear();
  if (trackGain) {
    const fading = trackGain;
    const context = ctx;
    trackGain = null;
    if (context) {
      try {
        const now = context.currentTime;
        fading.gain.cancelScheduledValues(now);
        fading.gain.setValueAtTime(fading.gain.value, now);
        fading.gain.linearRampToValueAtTime(0, now + FADE_S);
      } catch {
        // ignore
      }
      window.setTimeout(() => fading.disconnect(), (FADE_S + 0.05) * 1000);
    } else {
      fading.disconnect();
    }
  }
}

/** lookahead 调度器：只按音频时钟排未来 0.25s 的音，JS 定时器抖动不进时序。 */
function schedulerTick(): void {
  const context = ctx;
  const gainNode = trackGain;
  const track = currentTrack ? TRACKS[currentTrack] : null;
  if (!context || !gainNode || !track || context.state !== 'running') return;
  if (nextStepTime < context.currentTime - 0.25) {
    // 标签页睡过或音频时钟跳了：积压的旧音符一窝蜂补响只会是噪音墙，
    // 丢掉积压、从当前时刻干净重启（loop 曲，回到小节头不丢结构）。
    nextStepTime = context.currentTime + 0.06;
    stepIndex = 0;
  }
  const stepDur = stepSeconds(track);
  const horizon = context.currentTime + SCHEDULE_AHEAD_S;
  let guard = 0;
  while (nextStepTime < horizon && guard < 64) {
    guard += 1;
    const step = ((stepIndex % trackSteps(track)) + trackSteps(track)) % trackSteps(track);
    scheduleStep(context, gainNode, track, step, nextStepTime, stepDur);
    nextStepTime += stepDur;
    stepIndex += 1;
  }
}

/** 排一个 16 分步上的全部事件（纯数据 → 节点）。 */
function scheduleStep(
  context: AudioContext,
  out: GainNode,
  track: TrackDef,
  step: number,
  at: number,
  stepDur: number,
): void {
  const trim = track.trim;
  for (const note of notesAtStep(track, step)) {
    const layer = track.layers.find((l) => l.notes.includes(note));
    if (!layer) continue;
    const dur = Math.max(0.03, note.dur * stepDur);
    playTone(context, out, {
      wave: layer.wave,
      freq: noteFreq(note.midi),
      at,
      duration: dur,
      gain: layer.gain * trim,
      lowpass: layer.lowpass,
      attack: layer.attack,
      release: layer.release,
    });
  }
  for (const kind of drumHitsAt(track, step)) {
    playDrum(context, out, kind, at, trim);
  }
}

interface TonePlan {
  wave: OscillatorType;
  freq: number;
  at: number;
  duration: number;
  gain: number;
  lowpass?: number;
  attack?: number;
  release?: number;
}

const SILENCE = 0.0001;

function playTone(context: AudioContext, out: GainNode, plan: TonePlan): void {
  try {
    const attack = Math.min(plan.attack ?? 0.006, plan.duration * 0.5);
    const release = Math.min(plan.release ?? 0.06, Math.max(0.02, plan.duration * 0.5));
    const end = plan.at + Math.max(plan.duration, attack + release + 0.02);

    const osc = context.createOscillator();
    osc.type = plan.wave;
    osc.frequency.setValueAtTime(Math.max(1, plan.freq), plan.at);

    const env = context.createGain();
    env.gain.setValueAtTime(SILENCE, plan.at);
    env.gain.linearRampToValueAtTime(Math.max(SILENCE, plan.gain), plan.at + attack);
    env.gain.setValueAtTime(Math.max(SILENCE, plan.gain), Math.max(plan.at + attack, end - release));
    env.gain.exponentialRampToValueAtTime(SILENCE, end);

    let tail: AudioNode = osc;
    if (plan.lowpass !== undefined) {
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = plan.lowpass;
      osc.connect(filter);
      tail = filter;
    }
    tail.connect(env);
    env.connect(out);

    osc.start(plan.at);
    osc.stop(end + 0.02);
    activeSources.add(osc);
    osc.onended = () => {
      activeSources.delete(osc);
      osc.disconnect();
      env.disconnect();
    };
  } catch {
    // 音频是装饰：单个音符失败不该中断调度循环。
  }
}

let noiseBuffer: AudioBuffer | null = null;

// 与 render/audio.ts 同款的固定种子 LCG——每个会话听到的噪声纹理一致，
// 且不用 Math.random（docs/02_TECH_SPEC.md §3）。
function getNoiseBuffer(context: AudioContext): AudioBuffer | null {
  if (noiseBuffer) return noiseBuffer;
  try {
    const length = Math.max(1, Math.floor(context.sampleRate * 0.4));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 0x2545_f491;
    for (let i = 0; i < length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = (seed / 0xffff_ffff) * 2 - 1;
    }
    noiseBuffer = buffer;
    return buffer;
  } catch {
    return null;
  }
}

interface NoisePlan {
  at: number;
  duration: number;
  gain: number;
  bandpass?: number;
  highpass?: number;
  lowpass?: number;
}

function playNoise(context: AudioContext, out: GainNode, plan: NoisePlan): void {
  const buffer = getNoiseBuffer(context);
  if (!buffer) return;
  try {
    const src = context.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const env = context.createGain();
    env.gain.setValueAtTime(SILENCE, plan.at);
    env.gain.linearRampToValueAtTime(Math.max(SILENCE, plan.gain), plan.at + 0.004);
    env.gain.exponentialRampToValueAtTime(SILENCE, plan.at + plan.duration);

    let tail: AudioNode = src;
    if (plan.bandpass !== undefined || plan.highpass !== undefined || plan.lowpass !== undefined) {
      const filter = context.createBiquadFilter();
      filter.type = plan.bandpass !== undefined ? 'bandpass' : plan.highpass !== undefined ? 'highpass' : 'lowpass';
      filter.frequency.value = plan.bandpass ?? plan.highpass ?? plan.lowpass ?? 1000;
      if (plan.bandpass !== undefined) filter.Q.value = 1;
      src.connect(filter);
      tail = filter;
    }
    tail.connect(env);
    env.connect(out);

    src.start(plan.at);
    src.stop(plan.at + plan.duration + 0.02);
    activeSources.add(src);
    src.onended = () => {
      activeSources.delete(src);
      src.disconnect();
      env.disconnect();
    };
  } catch {
    // 同上：装饰性失败，静音处理。
  }
}

/** 芯片风三件套鼓：底鼓（三角下滑+噪声砰）、军鼓（带通噪声）、踩镲（高通噪声）。 */
function playDrum(context: AudioContext, out: GainNode, kind: DrumKind, at: number, trim: number): void {
  if (kind === 'kick') {
    // 130→42Hz 的三角下滑是底鼓的全部身体，外加一粒低频噪声做"踩到地板"的砰。
    try {
      const osc = context.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(130, at);
      osc.frequency.exponentialRampToValueAtTime(42, at + 0.1);
      const env = context.createGain();
      env.gain.setValueAtTime(0.5 * trim, at);
      env.gain.exponentialRampToValueAtTime(SILENCE, at + 0.11);
      osc.connect(env);
      env.connect(out);
      osc.start(at);
      osc.stop(at + 0.13);
      activeSources.add(osc);
      osc.onended = () => {
        activeSources.delete(osc);
        osc.disconnect();
        env.disconnect();
      };
    } catch {
      // ignore
    }
    playNoise(context, out, { at, duration: 0.03, gain: 0.16 * trim, lowpass: 500 });
    return;
  }
  if (kind === 'snare') {
    playNoise(context, out, { at, duration: 0.09, gain: 0.3 * trim, bandpass: 1900 });
    playTone(context, out, { wave: 'triangle', freq: 190, at, duration: 0.04, gain: 0.1 * trim, attack: 0.001, release: 0.01 });
    return;
  }
  playNoise(context, out, { at, duration: 0.025, gain: 0.14 * trim, highpass: 7500 });
}

// ── 场景侧 API ─────────────────────────────────────────────────────────────

function dispatch(action: AudioAction): void {
  syncFromState(audio, reduceAudio(audio, action));
}

/**
 * "想要这首曲子"的统一入口：context 已在跑 → 立即排；没跑 → 记 pendingTrack
 * 并（仅当页面已有粘性用户激活时）试 resume；从未交互过的页面不试——浏览器
 * 会拒绝并在控制台留一条警告，而首次手势的监听器马上就会补播。
 */
function wantTrack(id: TrackId, musicCtx: MusicContext): void {
  const context = ctx;
  if (context && context.state === 'running') {
    dispatch({ type: 'track', id, ctx: musicCtx });
    return;
  }
  pendingTrack = id;
  if (!context) return;
  const stickyActivation =
    typeof navigator !== 'undefined' && navigator.userActivation?.isActive === true;
  if (!stickyActivation) return;
  void context.resume().then(() => {
    if (pendingTrack === id && ctx && ctx.state === 'running') {
      pendingTrack = null;
      dispatch({ type: 'track', id, ctx: musicCtx });
    }
  }).catch(() => undefined);
}

/** MenuScene：init + 主菜单 BGM。幂等——重进菜单再调一次只是续播。 */
export function startMenuBgm(): void {
  ensureAudio();
  bindGestureUnlock();
  wantTrack('menu', { combat: false, night: false, radioUntil: audio.ctx.radioUntil, gameMinute: 0 });
}

/**
 * GameScene.create：按当前上下文起楼层音乐（入夜/带电台都会被 resolveTrackId
 * 照顾到）。context 未 resume 时挂起等手势——能从菜单进到楼层，手势必然
 * 已经发生，这条路径基本只是理论兜底。
 */
export function startFloorMusic(host: MusicHost): void {
  ensureAudio();
  bindGestureUnlock();
  const musicCtx = contextOf(host);
  dispatch({ type: 'context', ctx: musicCtx });
  if (!audio.playing) wantTrack(resolveTrackId(musicCtx), musicCtx);
}

/** 战斗开始/结束/入夜/电台到期：每帧或事件处调一次，内部按需换曲。 */
export function syncMusic(host: MusicHost): void {
  ensureAudio();
  bindGestureUnlock();
  dispatch({ type: 'context', ctx: contextOf(host) });
}

/** 停掉音乐（场景销毁）。保留收音机截止时间——回来时按上下文重解。 */
export function stopBgm(): void {
  dispatch({ type: 'stop' });
}

/**
 * 从背包"使用"收音机：选中格是收音机 → 打开电台 N 游戏分钟并立即切曲。
 * 返回是否真的触发了（调用方据此决定是否接管 Enter）。
 */
export function useRadioFromSlot(host: MusicHost, slot: number): boolean {
  const stack = host.player?.inventory?.slots?.[slot];
  if (!isRadioItemId(stack?.itemId)) return false;
  dispatch({ type: 'radio', gameMinute: host.gameMinuteOfDay });
  return true;
}

/** 直接打开电台（dev 探针 / 任务奖励用）。 */
export function useRadio(gameMinute: number, minutes: number = RADIO_MINUTES): void {
  dispatch({ type: 'radio', gameMinute, minutes });
}

/** 当前设置下电台还剩多少游戏分钟（UI/探针用）。 */
export function radioRemaining(): number {
  return radioRemainingAt(audio.ctx);
}

// ── 宿主结构（结构式子类型，不 import GameState——systems 不反向依赖 core） ──

interface SlotLike {
  itemId?: string;
}
interface MusicHost {
  /** 真值 = 战斗中。 */
  combat?: unknown;
  gameMinuteOfDay: number;
  player?: { inventory?: { slots?: ReadonlyArray<SlotLike | undefined> } };
}

function contextOf(host: MusicHost): MusicContext {
  return {
    combat: Boolean(host.combat),
    // 夜晚边界与 SurvivalSystem.isNight 同源（18:00–06:00），直接复用而非复刻。
    night: isNight(host.gameMinuteOfDay),
    radioUntil: audio.ctx.radioUntil,
    gameMinute: host.gameMinuteOfDay,
  };
}

// ── dev 探针（Playwright 断言用，生产构建剔除） ─────────────────────────────

export interface AudioSnapshot {
  track: TrackId | null;
  /** 播放意图（false = 已叫停）。 */
  playing: boolean;
  /** WebAudio 实际在跑吗（自动播放策略下的诚实回答）。 */
  running: boolean;
  /** 挂起待播的曲目（自动播放策略还没放行时，"想要哪首"记在这里）。 */
  pending: TrackId | null;
  /** 0-100 的设置音量。 */
  volume: number;
  /** BGM 总线当前增益（音量设置真正落到 WebAudio 的证据；无上下文时为 null）。 */
  busGain: number | null;
  /** 电台截止游戏分钟。 */
  radioUntil: number | null;
  /** 电台此刻是否有效。 */
  radioActive: boolean;
  /** 当前上下文（供探针解释"为什么是这首"）。 */
  ctx: MusicContext;
}

export function audioSnapshot(): AudioSnapshot {
  return {
    track: audio.track,
    playing: audio.playing,
    running: ctx?.state === 'running',
    pending: pendingTrack,
    volume: readBgmVolume(),
    busGain: bus?.gain.value ?? null,
    radioUntil: audio.ctx.radioUntil,
    radioActive: radioActiveAt(audio.ctx),
    ctx: audio.ctx,
  };
}

if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as unknown as { __AUDIO__?: unknown }).__AUDIO__ = {
    snapshot: audioSnapshot,
    startMenuBgm,
    startFloorMusic,
    syncMusic,
    stopBgm,
    useRadio,
    useRadioFromSlot,
  };
}
