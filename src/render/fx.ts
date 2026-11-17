import Phaser from 'phaser';

import { FONT_FAMILY } from './uiKit';

// pixelfx effects, loaded as sprite sheets and played as Phaser animations.
//
// These are not decorations. Before this the fight had no feedback at all: a
// monster lost HP and its bar shrank, but nothing on screen showed the blow
// landing, and the player taking damage was a number changing in the HUD. The
// pickups were the same - a container opened and its contents appeared in the
// bag with no moment of "I got it".
//
// The effects come from pixelfx (patch-gg/pixelfx), exported with
// `node tools/render.mjs <id> --sheet`, which writes an Aseprite-format atlas
// plus JSON carrying fps, loop, frame size and pivot in `meta.pixelfx`. The
// numbers below are read from that JSON rather than retyped, so the registry
// cannot drift from the assets.

export interface FxDef {
  /** the atlas key Phaser loads it under */
  key: string;
  /** frames per second, from meta.pixelfx.fps */
  fps: number;
  /** does it loop */
  loop: boolean;
  /** the effect's origin inside the frame, from meta.pixelfx.pivot */
  pivot: { x: number; y: number };
  /** total animation length in ms, so a one-shot can be timed out */
  duration: number;
}

const BASE = 'assets/fx';

/** Every effect the game uses. The path is relative to public/. */
export const FX: ReadonlyArray<{ id: string; path: string }> = [
  { id: 'hit-spark', path: 'impacts/hit-spark' },
  { id: 'crit-hit', path: 'impacts/crit-hit' },
  { id: 'hit-flash', path: 'impacts/hit-flash' },
  { id: 'sword-slash', path: 'melee/sword-slash' },
  { id: 'heavy-cleave', path: 'melee/heavy-cleave' },
  { id: 'parry', path: 'impacts/parry' },
  { id: 'ground-slam', path: 'impacts/ground-slam' },
  { id: 'collect-burst', path: 'pickups/collect-burst' },
  { id: 'coin-spin', path: 'pickups/coin-spin' },
  { id: 'candle', path: 'fire/candle' },
  { id: 'torch', path: 'fire/torch' },
  { id: 'brazier', path: 'fire/brazier' },
  { id: 'drip', path: 'water/drip' },
  { id: 'ripples', path: 'water/ripples' },
  { id: 'poisoned', path: 'status/poisoned' },
];

/** Load every atlas. Call from preload(). */
export function loadFx(scene: Phaser.Scene): void {
  for (const fx of FX) {
    scene.load.atlas(fx.id, `${BASE}/${fx.path}/${fx.id}.png`, `${BASE}/${fx.path}/${fx.id}.json`);
  }
}

/**
 * Build the animations from each atlas's own metadata.
 *
 * The JSON is Aseprite's array format, which Phaser parses into frames in file
 * order - the same order pixelfx wrote them - so the frame list needs no
 * reordering and the timing comes from meta.pixelfx rather than from a constant
 * that could go stale.
 */
/**
 * Every frame name in an atlas, in file order.
 *
 * Phaser names atlas frames "<key> <index>" when the JSON carries no explicit
 * filename, so generateFrameNumbers({start, end}) - which asks for "0", "1", ...
 * - matches nothing and silently builds an animation with ZERO frames. That is
 * what happened first: the animation existed, reported frameRate 30, and played
 * nothing at all. Reading the names off the texture cannot drift from whatever
 * the loader actually produced.
 */
function frameNames(scene: Phaser.Scene, id: string): string[] {
  const tex = scene.textures.get(id);
  if (!tex || typeof tex.getFrameNames !== 'function') return [];
  // Phaser adds a __BASE frame to every texture, so the raw list is one longer
  // than the animation and the last entry is not a real frame. Playing a
  // startFrame derived from the unfiltered count indexes past the end, and
  // Phaser's getFirstTick then reads .duration off undefined.
  return tex.getFrameNames().filter((n) => n !== '__BASE');
}

/** Build one effect's animation if it is not built yet. */
export function ensureFxAnim(scene: Phaser.Scene, id: string): boolean {
  const meta = FX_META[id];
  if (!meta || !scene.textures.exists(id)) return false;
  if (scene.anims.exists(id)) return true;
  const names = frameNames(scene, id);
  if (names.length === 0) return false;
  scene.anims.create({
    key: id,
    frames: names.map((frame) => ({ key: id, frame })),
    frameRate: meta.fps,
    repeat: meta.loop ? -1 : 0,
  });
  return true;
}

/**
 * Build every effect's animation from its own metadata.
 *
 * The JSON is Aseprite's array format, which Phaser parses into frames in file
 * order - the same order pixelfx wrote them - so the frame list needs no
 * reordering, and the timing comes from meta.pixelfx rather than from a constant
 * that could go stale.
 */
export function createFxAnims(scene: Phaser.Scene): void {
  for (const fx of FX) ensureFxAnim(scene, fx.id);
}

/**
 * Play an effect at a world position and clean it up when it finishes.
 *
 * One-shots destroy themselves; loops return their sprite so the caller can stop
 * them (a torch goes out when the event ends).
 *
 * Everything is read from FX_META and the live texture rather than from a
 * module-level registry. A module-level Map is duplicated when the module is
 * imported twice - which is exactly what happens when a page imports it directly
 * as well as through the bundle - and the second copy's registry is empty, so
 * playFx threw on `def.duration` while the sprite it had already created sat
 * frozen on frame 0.
 *
 * AG-80: one-shots are pooled (see FxShotPool below). Loops are NOT: a loop is
 * a standing light the caller owns and stops by hand, and its sprite's identity
 * outlives the call - pooling would hand the same torch to two rooms.
 */
export function playFx(
  scene: Phaser.Scene,
  id: string,
  x: number,
  y: number,
  depth = 24,
  /** Playback overrides. Scale is for effects that have to carry a moment on
   *  their own rather than decorate one; timeScale stretches the same frames
   *  over more time without touching the atlas metadata, which stays a truthful
   *  description of what pixelfx exported. */
  opts?: { scale?: number; timeScale?: number },
): Phaser.GameObjects.Sprite | null {
  const meta = FX_META[id];
  if (!meta || !scene.textures.exists(id)) return null;
  // AG-80: the degradation lever. A struggling machine drops every particle
  // rather than drop frames; the one-shots are the whole cost, so they go first.
  if (fxDegradedScenes.has(scene)) return null;
  const frameCount = scene.textures.get(id).frameTotal;
  if (frameCount <= 0) return null;

  if (meta.loop) {
    const sprite = scene.add.sprite(x, y, id).setDepth(depth);
    if (opts?.scale) sprite.setScale(opts.scale);
    // the pivot is the effect's own origin (a hit spark's is the point of impact, a
    // brazier's is its base), so it is applied rather than assumed to be centre
    sprite.setOrigin(meta.pivot.x / meta.frameSize[0], meta.pivot.y / meta.frameSize[1]);

    // built on demand: createFxAnims runs in BootScene, but an effect can be
    // requested from a scene that started before it, or after a texture reload
    if (!ensureFxAnim(scene, id)) {
      sprite.destroy();
      return null;
    }
    sprite.play(id);
    if (opts?.timeScale && opts.timeScale !== 1) sprite.anims.timeScale = opts.timeScale;
    return sprite;
  }

  // ── one-shot: pooled ────────────────────────────────────────────────────
  const rec = acquireShot(scene, id);
  if (!rec) return null;
  const sprite = rec.sprite;
  // Everything a fresh sprite would have started with is restored here: a
  // pooled sprite carries the previous play's position, depth, scale, origin,
  // flip, angle and timeScale, and any one of them surviving would show.
  sprite.setPosition(x, y).setDepth(depth).setVisible(true).setAlpha(1).setFlipX(false).setAngle(0);
  sprite.setScale(opts?.scale ?? 1);
  sprite.setOrigin(meta.pivot.x / meta.frameSize[0], meta.pivot.y / meta.frameSize[1]);

  if (!ensureFxAnim(scene, id)) {
    releaseShot(rec);
    return null;
  }
  // Drop the previous play's completion listeners before the new ones: a sprite
  // force-reused while still playing has a stale listener that would fire
  // against the new animation's completion and release the record early.
  sprite.removeAllListeners('animationcomplete');
  sprite.play(id);
  sprite.anims.timeScale = opts?.timeScale && opts.timeScale !== 1 ? opts.timeScale : 1;

  // the timeout is derived from the stretched rate, or a slowed effect is
  // destroyed mid-swing by a timer that still thinks it runs at 30fps. In the
  // pool it releases instead of destroying - the sprite is the asset.
  const duration = ((frameCount / meta.fps) * 1000) / (opts?.timeScale ?? 1);
  const gen = rec.gen;
  sprite.once('animationcomplete', () => {
    if (rec.gen === gen) releaseShot(rec);
  });
  // a belt-and-braces timer: if the complete event is missed the sprite still
  // goes back to the pool instead of lingering as a frozen frame
  rec.timer?.remove(false);
  rec.timer = scene.time.delayedCall(duration + 80, () => {
    if (rec.gen === gen && rec.busy) releaseShot(rec);
  });
  return sprite;
}

// ── AG-80: the one-shot pool ───────────────────────────────────────────────
// Every hit in a fight used to be `scene.add.sprite` + `sprite.destroy()`:
// a new display-list entry, a new anim restart and a new texture binding per
// hit spark, per flash, per slash. A one-shot's sprite is the same atlas frame
// sequence every time - only where it plays and how big it is differ - so the
// sprites are kept and reset instead. Cap per effect id: four concurrent
// hit-sparks already read as an explosion; a fifth recycles the oldest.
//
// Keyed by scene, not module-global, for the same reason FX_META is read live:
// a module imported twice has two of everything, and a pool would have to live
// where the scene that fills it lives. A WeakMap lets dead scenes go.

interface ShotRecord {
  sprite: Phaser.GameObjects.Sprite;
  /** in play right now (spawned, not yet released) */
  busy: boolean;
  /** bumped on every (re)spawn so a stale completion listener no-ops */
  gen: number;
  /** the safety timer's handle, removed before the next reuse */
  timer?: Phaser.Time.TimerEvent;
}

const FX_SHOT_CAP = 4;

const shotPools = new WeakMap<Phaser.Scene, Map<string, ShotRecord[]>>();

function acquireShot(scene: Phaser.Scene, id: string): ShotRecord | null {
  let byId = shotPools.get(scene);
  if (!byId) {
    byId = new Map();
    shotPools.set(scene, byId);
  }
  let pool = byId.get(id);
  if (!pool) {
    pool = [];
    byId.set(id, pool);
  }
  const free = pool.find((r) => !r.busy);
  if (free) {
    free.busy = true;
    free.gen += 1;
    return free;
  }
  if (pool.length < FX_SHOT_CAP) {
    // created hidden: a pooled sprite waits in the display list between plays,
    // and a visible one at (0,0) would flash in the corner for a frame.
    const rec: ShotRecord = { sprite: scene.add.sprite(0, 0, id).setVisible(false), busy: true, gen: 1 };
    pool.push(rec);
    return rec;
  }
  // Over cap: recycle the oldest in-play sprite. A spark cut 200ms short is
  // invisible; a fifth spark refused is not.
  const oldest = pool[0];
  oldest.busy = true;
  oldest.gen += 1;
  oldest.timer?.remove(false);
  return oldest;
}

function releaseShot(rec: ShotRecord): void {
  if (!rec.busy) return;
  rec.busy = false;
  rec.sprite.setVisible(false);
}

/** AG-80: every pooled one-shot sprite a scene owns (probe/tests count these). */
export function fxShotCount(scene: Phaser.Scene, id?: string): number {
  const byId = shotPools.get(scene);
  if (!byId) return 0;
  if (id) return byId.get(id)?.length ?? 0;
  let n = 0;
  for (const pool of byId.values()) n += pool.length;
  return n;
}

/** Scenes currently in degraded mode: playFx is a no-op for them. */
const fxDegradedScenes = new WeakSet<Phaser.Scene>();

/**
 * AG-80: the degradation switch. On a machine that cannot hold the frame
 * budget the particles are the first thing to go - they are pure decoration
 * and they are pure cost. Recoverable: the guard flips this back when the
 * frame time comes home, and the next playFx spawns normally.
 */
export function setFxDegraded(scene: Phaser.Scene, on: boolean): void {
  if (on) fxDegradedScenes.add(scene);
  else fxDegradedScenes.delete(scene);
}

/** AG-80: whether a scene currently has its particles switched off. */
export function isFxDegraded(scene: Phaser.Scene): boolean {
  return fxDegradedScenes.has(scene);
}

// ── AG-80: the floating-text pool ──────────────────────────────────────────
// The combat float text (AG-70) used to be `this.add.text` per hit and a
// `destroy()` 900ms later: in a fight that is a fresh Text object, a fresh
// canvas texture bake and a fresh GPU upload for every damage number. The
// style never changes across a pool's life (20px bold GameSans) - only the
// string, the colour and the position do, and all three are settable in place.
// So the Texts are pre-created and recycled: spawn takes an idle one, plays
// the rise+fade, and the fade's completion hides it and returns it to the
// pool. Nothing is ever destroyed until the pool itself is.
//
// Over the cap the OLDEST live floater is recycled rather than the new one
// refused: a damage number that appears 300ms late no longer reads as the hit
// it belongs to, while two numbers overlapping by 100ms of drift is
// something the fight already does.

export interface FloatTextPoolOptions {
  /** How many Texts to pre-create. 12 covers both sides of a fight at ~6
   *  simultaneous floaters (damage, miss, guard, behaviour tag) with headroom. */
  size?: number;
  /** Display depth. GameScene passes DUST_DEPTH + 4 so floaters sit over the
   *  foreground silhouettes, exactly where the unpooled text sat. */
  depth?: number;
  /** Pixels the text rises over its life. */
  rise?: number;
  /** Total lifetime in ms (rise + fade together end here). */
  duration?: number;
  /** When the fade starts, relative to the lifetime. */
  fadeDelay?: number;
  /** Fade length in ms. */
  fadeDuration?: number;
  /** CSS font size string. */
  fontSize?: string;
}

interface FloatRecord {
  text: Phaser.GameObjects.Text;
  /** last value/colour baked into the texture, so unchanged spawns don't rebake */
  lastValue: string;
  lastColor: string;
}

export class FloatTextPool {
  private readonly scene: Phaser.Scene;
  private readonly size: number;
  private readonly depth: number;
  private readonly rise: number;
  private readonly duration: number;
  private readonly fadeDelay: number;
  private readonly fadeDuration: number;
  private readonly fontSize: string;
  /** every Text this pool created, in creation order */
  private readonly all: FloatRecord[] = [];
  /** idle (hidden) records, ready to spawn */
  private readonly idle: FloatRecord[] = [];
  /** live records, oldest first - [0] is what an over-cap spawn recycles */
  private readonly live: FloatRecord[] = [];
  private dead = false;

  constructor(scene: Phaser.Scene, opts: FloatTextPoolOptions = {}) {
    this.scene = scene;
    this.size = Math.max(1, opts.size ?? 12);
    this.depth = opts.depth ?? 25;
    this.rise = opts.rise ?? 46;
    this.duration = opts.duration ?? 900;
    this.fadeDelay = opts.fadeDelay ?? 420;
    this.fadeDuration = opts.fadeDuration ?? 480;
    this.fontSize = opts.fontSize ?? '20px';
    // Pre-create and IDLE them: a record that only exists in `all` is not
    // spawnable - idle is the free list spawn() actually draws from.
    for (let i = 0; i < this.size; i++) {
      const rec = this.create();
      this.all.push(rec);
      this.idle.push(rec);
    }
  }

  private create(): FloatRecord {
    const text = this.scene.add
      .text(0, 0, '', {
        fontFamily: FONT_FAMILY,
        fontSize: this.fontSize,
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(this.depth)
      .setVisible(false);
    return { text, lastValue: '', lastColor: '' };
  }

  /** Texts created so far - the assertion "spawn 20 times, create 12" reads this. */
  get createdCount(): number {
    return this.all.length;
  }

  /** Floaters currently on screen. */
  get activeCount(): number {
    return this.live.length;
  }

  /**
   * Show `text` at (x, y) in `color` ('#rrggbb'), rising and fading.
   * Returns the Text, or null once the pool is destroyed.
   */
  spawn(x: number, y: number, text: string, color: string): Phaser.GameObjects.Text | null {
    if (this.dead) return null;
    let rec = this.idle.pop();
    if (!rec) {
      // Over the cap (all `size` records in play): restart the oldest live
      // floater in place. Never create - createdCount stays equal to size for
      // the pool's whole life, which is what "spawn 20 times, create 12" means.
      rec = this.live.shift();
      if (!rec) return null;
      this.scene.tweens.killTweensOf(rec.text);
    }
    const t = rec.text;
    // setText/setColor rebake the texture; skip when the value is unchanged so
    // a repeated "-3" in the same colour costs nothing.
    if (rec.lastValue !== text) {
      t.setText(text);
      rec.lastValue = text;
    }
    if (rec.lastColor !== color) {
      t.setColor(color);
      rec.lastColor = color;
    }
    t.setPosition(x, y).setAlpha(1).setVisible(true);
    this.live.push(rec);
    // Two tweens, exactly the timing the unpooled floater had: rise over the
    // full life, fade over the back half. The fade's completion recycles.
    this.scene.tweens.add({ targets: t, y: y - this.rise, duration: this.duration, ease: 'Quad.easeOut' });
    this.scene.tweens.add({
      targets: t,
      alpha: 0,
      duration: this.fadeDuration,
      delay: this.fadeDelay,
      onComplete: () => this.recycle(rec!),
    });
    return t;
  }

  private recycle(rec: FloatRecord): void {
    const i = this.live.indexOf(rec);
    if (i >= 0) this.live.splice(i, 1);
    if (this.dead) return;
    rec.text.setVisible(false);
    this.idle.push(rec);
  }

  /** Destroy every Text. Called when the scene restarts (create() re-runs). */
  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    for (const rec of this.all) {
      this.scene.tweens.killTweensOf(rec.text);
      rec.text.destroy();
    }
    this.all.length = 0;
    this.idle.length = 0;
    this.live.length = 0;
  }
}

// ── AG-80: the frame-budget guard ──────────────────────────────────────────
// The shipping-quality promise for weak hardware: the game watches its own
// frame time and sheds load before the player has to. Pure logic - a sliding
// window of frame deltas with a hysteretic pair of thresholds - so the policy
// is testable in Node without a browser. GameScene feeds it `delta` every
// frame and flips its degradation levers on the edge.
//
// Thresholds (the design canvas targets 60fps = 16.7ms):
//   * degrade: window mean > 25ms AND at least 75% of the window's frames are
//     themselves over 25ms. Both, so one GC pause or one stair-climb spike
//     cannot trip it - it takes a sustained inability to hold 40fps.
//   * recover: window mean < 18ms. The 7ms gap below the degrade line is the
//     hysteresis: without it a machine hovering at the line would flap
//     particles on and off every second.

export interface FrameBudgetOptions {
  /** Mean frame time (ms) above which the window is considered failing. */
  degradeMs?: number;
  /** Mean frame time (ms) below which a degraded session recovers. */
  recoverMs?: number;
  /** Window length in frames (~1s at 60fps). */
  window?: number;
  /** How many of the window's frames must individually exceed degradeMs. */
  slowFrames?: number;
  /** Fired on each edge only (false -> true, true -> false). */
  onDegrade?: (degraded: boolean) => void;
}

export class FrameBudgetGuard {
  private readonly degradeMs: number;
  private readonly recoverMs: number;
  private readonly window: number;
  private readonly slowFrames: number;
  private readonly onDegrade?: (degraded: boolean) => void;
  private readonly samples: number[] = [];
  private isDegraded = false;

  constructor(opts: FrameBudgetOptions = {}) {
    this.degradeMs = opts.degradeMs ?? 25;
    this.recoverMs = opts.recoverMs ?? 18;
    this.window = Math.max(1, opts.window ?? 60);
    this.slowFrames = opts.slowFrames ?? Math.ceil(this.window * 0.75);
    this.onDegrade = opts.onDegrade;
  }

  /** Feed one frame's delta (ms). Returns the current degraded state. */
  sample(delta: number): boolean {
    const ms = Math.max(0, delta);
    this.samples.push(ms);
    if (this.samples.length > this.window) this.samples.shift();
    if (this.samples.length < this.window) return this.isDegraded;
    let sum = 0;
    let slow = 0;
    for (const s of this.samples) {
      sum += s;
      if (s > this.degradeMs) slow += 1;
    }
    const mean = sum / this.samples.length;
    if (!this.isDegraded && mean > this.degradeMs && slow >= this.slowFrames) {
      this.isDegraded = true;
      this.onDegrade?.(true);
    } else if (this.isDegraded && mean < this.recoverMs) {
      this.isDegraded = false;
      this.onDegrade?.(false);
    }
    return this.isDegraded;
  }

  /** Current state (what sample() last returned). */
  get degraded(): boolean {
    return this.isDegraded;
  }

  /** Window mean in ms (0 before the window fills). */
  get meanMs(): number {
    if (this.samples.length === 0) return 0;
    let sum = 0;
    for (const s of this.samples) sum += s;
    return sum / this.samples.length;
  }

  /** Forget the window (a scene restart starts clean). */
  reset(): void {
    this.samples.length = 0;
  }
}

/** A loop that stays until the caller stops it - the animated light sources. */
export function startFxLoop(
  scene: Phaser.Scene,
  id: string,
  x: number,
  y: number,
  depth = 24,
): Phaser.GameObjects.Sprite | null {
  const sprite = playFx(scene, id, x, y, depth);
  if (!sprite) return null;
  // Start each instance on its own frame.
  //
  // Every light on a floor is created in the same frame, so they all begin on
  // frame 0 and flicker in perfect unison - measured on the dorm's four wall
  // lamps, all four sat on frame 47 together and stepped to 62 together. A row of
  // flames breathing as one reads as a single animated texture repeated, not as
  // four fires. The offset is derived from the position, so a floor's lights are
  // spread but still the same every time it is entered.
  const total = scene.textures.get(id).frameTotal;
  if (total > 1) {
    const hash = (Math.round(sprite.x) * 73 + Math.round(sprite.y) * 151) % 1000;
    // clamped to the animation's own length, not the texture's frame count
    const frames = sprite.anims.currentAnim ? sprite.anims.currentAnim.frames.length : total;
    if (frames > 1) {
      const start = Math.min(frames - 1, Math.floor((hash / 1000) * frames));
      sprite.anims.play({ key: id, startFrame: start });
    }
  }
  return sprite;
}

/**
 * The metadata pixelfx writes into each atlas's JSON, transcribed here because
 * Phaser discards the JSON once it has parsed the frames. Each entry is exactly
 * `meta.pixelfx` from the corresponding file in public/assets/fx/.
 */
export const FX_META: Record<string, { fps: number; loop: boolean; pivot: { x: number; y: number }; frameSize: [number, number] }> = {
  'hit-spark': { fps: 30, loop: false, pivot: { x: 44, y: 64 }, frameSize: [136, 80] },
  'crit-hit': { fps: 30, loop: false, pivot: { x: 84, y: 106 }, frameSize: [216, 136] },
  'hit-flash': { fps: 30, loop: false, pivot: { x: 40, y: 54 }, frameSize: [80, 64] },
  'sword-slash': { fps: 30, loop: false, pivot: { x: 44, y: 92 }, frameSize: [136, 104] },
  'heavy-cleave': { fps: 30, loop: false, pivot: { x: 44, y: 92 }, frameSize: [136, 104] },
  parry: { fps: 30, loop: false, pivot: { x: 100, y: 96 }, frameSize: [200, 112] },
  'collect-burst': { fps: 30, loop: false, pivot: { x: 56, y: 94 }, frameSize: [112, 108] },
  'coin-spin': { fps: 30, loop: true, pivot: { x: 28, y: 48 }, frameSize: [56, 56] },
  candle: { fps: 30, loop: true, pivot: { x: 28, y: 64 }, frameSize: [56, 76] },
  torch: { fps: 30, loop: true, pivot: { x: 36, y: 94 }, frameSize: [72, 120] },
  brazier: { fps: 30, loop: true, pivot: { x: 56, y: 136 }, frameSize: [112, 148] },
  drip: { fps: 30, loop: true, pivot: { x: 36, y: 78 }, frameSize: [72, 88] },
  ripples: { fps: 30, loop: true, pivot: { x: 68, y: 30 }, frameSize: [136, 52] },
  'ground-slam': { fps: 30, loop: false, pivot: { x: 144, y: 164 }, frameSize: [288, 208] },
  poisoned: { fps: 30, loop: true, pivot: { x: 36, y: 54 }, frameSize: [72, 64] },
};
