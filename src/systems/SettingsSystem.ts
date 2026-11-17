// AG-72: 玩家设置——上架 Steam 的硬缺口。
//
// 游戏此前没有任何设置入口：音量写死、震屏常开、没有文本速度/语言的概念。
// 参考同类游戏（TWOM/塔楼类）的标配五件套收在这里：SFX 音量 / BGM 音量 /
// 震屏 / 文本速度 / 语言。纯函数 + localStorage，不 import Phaser（场景、
// render/audio 与 Node 单测走同一个入口读）。
//
// 持久化 key：`floor100000.settings`。读失败 / 坏 JSON / 坏字段一律回退默认
// （TWOM 式防御：设置是装饰层的配置，永远不该让游戏起不来）。
//
// 接口契约：
//   getSettings()                现读当前设置（单一事实源是 localStorage）
//   updateSettings(patch)        合并写入 + 立即持久化，返回合并后的完整设置
//   resetSettings()              恢复默认 + 立即持久化
//   shakeIfEnabled(scene, …)     震屏开关接线（GameScene 的 shake 调用点）
//
// AG-74（音频系统）约定：BGM 音量 = getSettings().bgmVolume（0-100），
// 由音频系统在起播/换曲时读取；本模块只存值，不拥有音频图。

import type Phaser from 'phaser';

/** 对话文本速度三档。当前对话无打字机效果，先落框架与持久化。 */
export type TextSpeed = 'instant' | 'fast' | 'normal';
/**
 * 语言框架：'zh' 是当前唯一实装语言；'en' 预留结构（类型与校验已就位），
 * 界面文字仍全中文，不做真翻译。
 */
export type Language = 'zh';

export interface Settings {
  /** 音效音量 0-100（playSfx 读取，见 render/audio.ts）。 */
  sfxVolume: number;
  /** 背景音乐音量 0-100（AG-74 音频系统读取）。 */
  bgmVolume: number;
  /** 受击/预警时的镜头震动。 */
  screenShake: boolean;
  /** 对话文本速度三档。 */
  textSpeed: TextSpeed;
  language: Language;
}

export const SETTINGS_KEY = 'floor100000.settings';

export const DEFAULT_SETTINGS: Settings = {
  sfxVolume: 70,
  bgmVolume: 50,
  screenShake: true,
  textSpeed: 'normal',
  language: 'zh',
};

export const VOLUME_MIN = 0;
export const VOLUME_MAX = 100;
/** 面板里 ←/→ 与箭头的单步步进。 */
export const VOLUME_STEP = 5;

/** 文本速度的档位顺序（UI 循环与 ←/→ 调整都按这个序）。 */
export const TEXT_SPEEDS: readonly TextSpeed[] = ['instant', 'fast', 'normal'];
export const TEXT_SPEED_LABELS: Record<TextSpeed, string> = {
  instant: '瞬间',
  fast: '快',
  normal: '正常',
};

export const LANGUAGES: readonly Language[] = ['zh'];
export const LANGUAGE_LABELS: Record<Language, string> = { zh: '中文' };

// ── storage ───────────────────────────────────────────────────────────────
// 与 SaveSystem 同款思路：storage 可注入（Node 单测传假 Storage），默认取
// localStorage；拿不到时（隐私模式拒绝访问 / Node 环境）退到进程内内存，
// 设置照常生效，只是不跨会话。

let memoryFallback: Storage | null = null;

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}

function defaultStorage(): Storage {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // 隐私模式下访问 localStorage 本身会抛；设置回退到内存即可。
  }
  memoryFallback ??= memoryStorage();
  return memoryFallback;
}

// ── validation ────────────────────────────────────────────────────────────

function sanitizeVolume(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, Math.round(value)));
}

function isTextSpeed(value: unknown): value is TextSpeed {
  return typeof value === 'string' && (TEXT_SPEEDS as readonly string[]).includes(value);
}

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 坏字段逐项回退默认，而不是整份设置作废——一个写坏的 textSpeed 不该把
 * 玩家调好的音量一起重置（TWOM 式防御的粒度）。
 */
function sanitizeSettings(raw: unknown): Settings {
  const r = isRecord(raw) ? raw : {};
  return {
    sfxVolume: sanitizeVolume(r.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
    bgmVolume: sanitizeVolume(r.bgmVolume, DEFAULT_SETTINGS.bgmVolume),
    screenShake: typeof r.screenShake === 'boolean' ? r.screenShake : DEFAULT_SETTINGS.screenShake,
    textSpeed: isTextSpeed(r.textSpeed) ? r.textSpeed : DEFAULT_SETTINGS.textSpeed,
    language: isLanguage(r.language) ? r.language : DEFAULT_SETTINGS.language,
  };
}

// ── the public surface ────────────────────────────────────────────────────

/**
 * 现读 + 逐字段清洗。从不抛：坏 JSON、缺失 key、Storage 不可用全部落在
 * 默认值上。不缓存——每次调整都即时持久化，localStorage 就是单一事实源，
 * 缓存只会带来「改了没生效」的竞态。
 */
export function getSettings(storage: Storage = defaultStorage()): Settings {
  let raw: unknown = null;
  try {
    const text = storage.getItem(SETTINGS_KEY);
    if (text !== null) {
      try {
        raw = JSON.parse(text);
      } catch {
        raw = null; // 坏 JSON：整份回退默认
      }
    }
  } catch {
    raw = null; // 读失败（隐私模式拒绝）：默认值
  }
  return sanitizeSettings(raw);
}

/**
 * 合并写入 + 立即持久化，返回合并后的完整设置。patch 里显式 undefined 的
 * 键视为「不改」；写坏的值回退到当前值而不是默认值（局部修正）。
 * 写入失败（quota/隐私模式）静默：设置是装饰层，不能因此打断游戏
 * （SaveSystem 同款 best-effort 契约）。
 */
export function updateSettings(patch: Partial<Settings>, storage: Storage = defaultStorage()): Settings {
  const current = getSettings(storage);
  const next: Settings = { ...current };
  if (patch.sfxVolume !== undefined) next.sfxVolume = sanitizeVolume(patch.sfxVolume, current.sfxVolume);
  if (patch.bgmVolume !== undefined) next.bgmVolume = sanitizeVolume(patch.bgmVolume, current.bgmVolume);
  if (patch.screenShake !== undefined) next.screenShake = patch.screenShake;
  if (patch.textSpeed !== undefined) next.textSpeed = isTextSpeed(patch.textSpeed) ? patch.textSpeed : current.textSpeed;
  if (patch.language !== undefined) next.language = isLanguage(patch.language) ? patch.language : current.language;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // Best-effort: a rejected write must not break the caller.
  }
  return next;
}

/** 恢复默认 + 立即持久化。 */
export function resetSettings(storage: Storage = defaultStorage()): Settings {
  const next: Settings = { ...DEFAULT_SETTINGS };
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // Best-effort, as above.
  }
  return next;
}

/**
 * 震屏接线：GameScene 的 `cameras.main.shake(...)` 调用点包一层，读一次
 * 设置。屏幕震动关掉时完全 no-op——强度/时长参数照原样传，不改变任何
 * 既有调用点的数值语义。
 */
export function shakeIfEnabled(scene: Phaser.Scene, duration: number, strength: number): void {
  if (!getSettings().screenShake) return;
  scene.cameras.main.shake(duration, strength);
}
