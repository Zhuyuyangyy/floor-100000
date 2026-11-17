// Procedural retro sound effects for 《第100000层：末日宿舍》.
//
// Every effect is synthesised at runtime with the Web Audio API — the build
// ships no audio files (docs/05_ART_GUIDE.md §4: SFX must be self-made or
// clearly licensed). This module has no Phaser dependency on purpose so scenes,
// systems and tests can drive it the same way:
//
//   unlockAudio();            // once, from a real user gesture (autoplay policy)
//   playSfx('pickup');        // fire-and-forget; no-op before unlock / when muted
//   setMuted(true);           // global kill switch, ramped to avoid a click
//
// Nothing here throws: audio is decoration and must never break gameplay.

export type SfxName =
  | 'click'
  | 'pickup'
  | 'craft'
  | 'sleep'
  | 'trade'
  | 'hurt'
  | 'danger'
  // OVERHAUL W4：开箱 / 追击预警 / 每日目标完成。
  | 'chest'
  | 'alert'
  | 'goal'
  // AG-74：补齐缺失的音效钩子——面板开关 / 金币 / 升级 / 入夜警告。
  // 全部程序化短音（零素材）；调用侧按需接，音量由 playSfx 的 volumeScale
  // 统一折算（AG-72 的 sfxVolume 设置接在那个参数上）。
  | 'panel'
  | 'coin'
  | 'upgrade'
  | 'night';

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

// One context for the whole page, created lazily on the first user gesture.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

// Headroom so overlapping tones (alarm pulses, layered buzz) never clip.
const MASTER_GAIN = 0.4;
const SILENCE = 0.0001;

interface ToneSpec {
  type: OscillatorType;
  /** Start frequency in Hz. */
  from: number;
  /** Optional end frequency in Hz; omitted holds a steady pitch. */
  to?: number;
  /** Seconds from "now" until the tone starts. */
  delay?: number;
  /** Total length in seconds, release included. */
  duration: number;
  /** Peak gain before the master bus; keep <= 1. */
  gain: number;
  /** Attack time in seconds. */
  attack?: number;
  /** Optional lowpass cutoff in Hz — cheap way to take the edge off a tone. */
  lowpass?: number;
}

interface NoiseSpec {
  /** Seconds from "now" until the burst starts. */
  delay?: number;
  duration: number;
  gain: number;
  /** Bandpass centre frequency in Hz (metallic/airy textures). */
  bandpass?: number;
  /** Highpass cutoff in Hz (hiss/crack textures). */
  highpass?: number;
}

function resolveAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const scoped = window as Window & { webkitAudioContext?: AudioContextCtor };
  if (typeof AudioContext !== 'undefined') return AudioContext;
  if (typeof scoped.webkitAudioContext !== 'undefined') return scoped.webkitAudioContext;
  return null;
}

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = resolveAudioContextCtor();
  if (!Ctor) return null;
  try {
    const context = new Ctor();
    const bus = context.createGain();
    bus.gain.value = muted ? 0 : MASTER_GAIN;
    bus.connect(context.destination);
    ctx = context;
    master = bus;
    return context;
  } catch {
    ctx = null;
    master = null;
    return null;
  }
}

// Call from a real user gesture (pointerdown / keydown) before the first
// playSfx: browsers start the context suspended until then.
export function unlockAudio(): void {
  const context = ensureContext();
  if (!context) return;
  if (context.state === 'suspended') {
    void context.resume().catch(() => undefined);
  }
}

export function setMuted(next: boolean): void {
  muted = next;
  const context = ctx;
  const bus = master;
  if (!context || !bus) return;
  try {
    const now = context.currentTime;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setValueAtTime(bus.gain.value, now);
    bus.gain.linearRampToValueAtTime(next ? 0 : MASTER_GAIN, now + 0.03);
  } catch {
    // A dead context just means silence; nothing to recover.
  }
}

function playTone(spec: ToneSpec): void {
  const context = ctx;
  const bus = master;
  if (!context || !bus) return;

  const start = context.currentTime + (spec.delay ?? 0);
  const duration = Math.max(0.01, spec.duration);
  const end = start + duration;
  const attack = Math.min(spec.attack ?? 0.005, duration * 0.5);

  try {
    const osc = context.createOscillator();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(Math.max(1, spec.from), start);
    if (spec.to !== undefined && spec.to !== spec.from) {
      // Exponential pitch slides read as more "chiptune" than linear ones.
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.to), end);
    }

    // AG-74：volumeScale（playSfx 的可选音量系数）在这里折算进每个音符。
    const peak = Math.max(SILENCE, spec.gain * volumeScale);
    const env = context.createGain();
    env.gain.setValueAtTime(SILENCE, start);
    env.gain.linearRampToValueAtTime(peak, start + attack);
    env.gain.exponentialRampToValueAtTime(SILENCE, end);

    const chain: AudioNode[] = [osc, env];
    let tail: AudioNode = osc;
    if (spec.lowpass !== undefined) {
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = spec.lowpass;
      osc.connect(filter);
      tail = filter;
      chain.push(filter);
    }
    tail.connect(env);
    env.connect(bus);

    osc.start(start);
    osc.stop(end + 0.02);
    osc.onended = () => {
      for (const node of chain) node.disconnect();
    };
  } catch {
    // Never let a failed sound effect interrupt the frame.
  }
}

let noiseBuffer: AudioBuffer | null = null;

// One short noise buffer, generated from a deterministic LCG (no Math.random —
// docs/02_TECH_SPEC.md §3) so every session hears the same texture.
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

function playNoise(spec: NoiseSpec): void {
  const context = ctx;
  const bus = master;
  if (!context || !bus) return;
  const buffer = getNoiseBuffer(context);
  if (!buffer) return;

  const start = context.currentTime + (spec.delay ?? 0);
  const end = start + Math.max(0.01, spec.duration);

  try {
    const src = context.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const env = context.createGain();
    env.gain.setValueAtTime(SILENCE, start);
    env.gain.linearRampToValueAtTime(Math.max(SILENCE, spec.gain * volumeScale), start + 0.004);
    env.gain.exponentialRampToValueAtTime(SILENCE, end);

    const chain: AudioNode[] = [src, env];
    let tail: AudioNode = src;
    if (spec.bandpass !== undefined || spec.highpass !== undefined) {
      const filter = context.createBiquadFilter();
      filter.type = spec.bandpass !== undefined ? 'bandpass' : 'highpass';
      filter.frequency.value = spec.bandpass ?? spec.highpass ?? 1000;
      if (spec.bandpass !== undefined) filter.Q.value = 1.2;
      src.connect(filter);
      tail = filter;
      chain.push(filter);
    }
    tail.connect(env);
    env.connect(bus);

    src.start(start);
    src.stop(end + 0.02);
    src.onended = () => {
      for (const node of chain) node.disconnect();
    };
  } catch {
    // Ignored for the same reason as playTone.
  }
}

// --- Effect recipes ---------------------------------------------------------

// Tiny UI tick.
function sfxClick(): void {
  playTone({ type: 'square', from: 1400, to: 900, duration: 0.045, gain: 0.2, attack: 0.001, lowpass: 4200 });
}

// Rising two-step blip for looting an item.
function sfxPickup(): void {
  playTone({ type: 'square', from: 620, to: 940, duration: 0.07, gain: 0.18, attack: 0.002 });
  playTone({ type: 'square', from: 940, to: 1480, duration: 0.11, gain: 0.18, attack: 0.002, delay: 0.06 });
}

// Mechanical clack: filtered noise plus a low thunk.
function sfxCraft(): void {
  playNoise({ duration: 0.05, gain: 0.28, bandpass: 1800 });
  playTone({ type: 'square', from: 240, to: 150, duration: 0.09, gain: 0.16, attack: 0.001, lowpass: 900 });
}

// Soft descending tone for resting / sleeping through the night.
function sfxSleep(): void {
  playTone({ type: 'sine', from: 520, to: 200, duration: 0.3, gain: 0.2, attack: 0.03 });
  playTone({ type: 'triangle', from: 260, to: 100, duration: 0.32, gain: 0.1, attack: 0.04, delay: 0.02 });
}

// Coin-ish double blip for a completed trade.
function sfxTrade(): void {
  playTone({ type: 'square', from: 980, duration: 0.05, gain: 0.16, attack: 0.001 });
  playTone({ type: 'square', from: 1460, duration: 0.08, gain: 0.16, attack: 0.001, delay: 0.06 });
}

// Harsh low buzz: saw through a lowpass, plus a noise crack.
function sfxHurt(): void {
  playTone({ type: 'sawtooth', from: 190, to: 70, duration: 0.24, gain: 0.28, attack: 0.002, lowpass: 700 });
  playNoise({ duration: 0.09, gain: 0.22, highpass: 500 });
}

// Two-tone alarm, three pulses.
function sfxDanger(): void {
  const pulse = 0.09;
  const gap = 0.02;
  [780, 560, 780].forEach((freq, i) => {
    playTone({
      type: 'square',
      from: freq,
      duration: pulse,
      gain: 0.18,
      attack: 0.006,
      delay: i * (pulse + gap),
      lowpass: 2600,
    });
  });
}

// Chest opening: a short noise snap (latch/planks) then a downward square slide
// (the lid dropping). Kept distinct from craft's low thunk by a higher start
// pitch and a longer glide, so "open" never reads as "build".
function sfxChest(): void {
  playNoise({ duration: 0.06, gain: 0.26, bandpass: 1400 });
  playTone({ type: 'square', from: 520, to: 170, duration: 0.18, gain: 0.2, attack: 0.001, lowpass: 1400, delay: 0.03 });
}

// Warning: a quick two-step rise. danger is the sustained three-pulse low alarm
// for "something is chasing you"; alert is the one-shot "it has noticed you"
// cue at a wanderer's lunge start (W2), so it climbs instead of repeating.
function sfxAlert(): void {
  playTone({ type: 'square', from: 660, duration: 0.07, gain: 0.18, attack: 0.004, lowpass: 3000 });
  playTone({ type: 'square', from: 990, duration: 0.1, gain: 0.18, attack: 0.004, delay: 0.07, lowpass: 3000 });
}

// Daily goal complete: a three-note rising arpeggio (C5-E5-G5 major triad) on a
// triangle wave — reads as a small whistle/horn fanfare for the W3 reward beat.
function sfxGoal(): void {
  [523.25, 659.25, 783.99].forEach((freq, i) => {
    playTone({ type: 'triangle', from: freq, duration: 0.1, gain: 0.2, attack: 0.003, delay: i * 0.085 });
  });
}

// AG-74：面板开关。一记带通噪声的"噗"（布料/木板感）+ 向下的三角短滑——
// 开和关用同一个声音的两半，听得出"界面在呼吸"但分不出方向也不恼人。
function sfxPanel(): void {
  playNoise({ duration: 0.09, gain: 0.22, bandpass: 1100 });
  playTone({ type: 'triangle', from: 320, to: 240, duration: 0.09, gain: 0.14, attack: 0.002, lowpass: 1600 });
}

// AG-74：金币。掌机味最正的两级方波跳（B5 → E6），接在交易结算/拾金上。
function sfxCoin(): void {
  playTone({ type: 'square', from: 987.77, duration: 0.05, gain: 0.16, attack: 0.001 });
  playTone({ type: 'square', from: 1318.51, duration: 0.16, gain: 0.16, attack: 0.001, delay: 0.05 });
}

// AG-74：升级。比 goal 更满一档的四音琶音（C5-E5-G5-C6），底下垫一个方波
// 八度根音，让"家里又添了一样东西"听起来像件事。
function sfxUpgrade(): void {
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
    playTone({ type: 'triangle', from: freq, duration: 0.12, gain: 0.2, attack: 0.003, delay: i * 0.08 });
  });
  playTone({ type: 'square', from: 261.63, to: 523.25, duration: 0.4, gain: 0.1, attack: 0.01, lowpass: 2200, delay: 0.24 });
}

// AG-74：入夜警告。两拍低沉方波（G4 → 滑向 Eb4 的不舒服收尾）+ 一阵风噪，
// 与 alert（追击预警，上扬两级）刻意相反：夜晚是往下走的。
function sfxNight(): void {
  [392, 311.13].forEach((freq, i) => {
    playTone({ type: 'square', from: freq, duration: 0.22, gain: 0.16, attack: 0.008, delay: i * 0.3, lowpass: 1300 });
  });
  playNoise({ duration: 0.7, gain: 0.07, highpass: 900, delay: 0.1 });
}

const SFX: Record<SfxName, () => void> = {
  click: sfxClick,
  pickup: sfxPickup,
  craft: sfxCraft,
  sleep: sfxSleep,
  trade: sfxTrade,
  hurt: sfxHurt,
  danger: sfxDanger,
  chest: sfxChest,
  alert: sfxAlert,
  goal: sfxGoal,
  panel: sfxPanel,
  coin: sfxCoin,
  upgrade: sfxUpgrade,
  night: sfxNight,
};

// AG-74：playSfx 的可选音量系数。调用侧（AG-72 的 sfxVolume 设置等）按
// 0..1 传；默认 1 = 旧行为逐字节兼容。实现是模块级作用域变量而非给每条
// 配方加参数——SFX 表里的闭包同步执行完即复位，重入/竞态无窗口。
let volumeScale = 1;

// Fire-and-forget: safe before unlockAudio (no context yet), while muted, and
// if the browser refuses to hand us an AudioContext at all.
export function playSfx(name: SfxName, volume = 1): void {
  if (muted) return;
  const context = ctx;
  if (!context || context.state === 'closed') return;
  const synth = SFX[name];
  if (!synth) return;
  volumeScale = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
  try {
    synth();
  } catch {
    // Silence is an acceptable outcome; a crash is not.
  } finally {
    volumeScale = 1;
  }
}
