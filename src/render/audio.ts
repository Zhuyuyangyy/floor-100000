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

export type SfxName = 'click' | 'pickup' | 'craft' | 'sleep' | 'trade' | 'hurt' | 'danger';

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

    const env = context.createGain();
    env.gain.setValueAtTime(SILENCE, start);
    env.gain.linearRampToValueAtTime(spec.gain, start + attack);
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
    env.gain.linearRampToValueAtTime(spec.gain, start + 0.004);
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

const SFX: Record<SfxName, () => void> = {
  click: sfxClick,
  pickup: sfxPickup,
  craft: sfxCraft,
  sleep: sfxSleep,
  trade: sfxTrade,
  hurt: sfxHurt,
  danger: sfxDanger,
};

// Fire-and-forget: safe before unlockAudio (no context yet), while muted, and
// if the browser refuses to hand us an AudioContext at all.
export function playSfx(name: SfxName): void {
  if (muted) return;
  const context = ctx;
  if (!context || context.state === 'closed') return;
  const synth = SFX[name];
  if (!synth) return;
  try {
    synth();
  } catch {
    // Silence is an acceptable outcome; a crash is not.
  }
}
