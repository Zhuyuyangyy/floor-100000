import Phaser from 'phaser';

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
 */
export function playFx(
  scene: Phaser.Scene,
  id: string,
  x: number,
  y: number,
  depth = 24,
): Phaser.GameObjects.Sprite | null {
  const meta = FX_META[id];
  if (!meta || !scene.textures.exists(id)) return null;
  const frameCount = scene.textures.get(id).frameTotal;
  if (frameCount <= 0) return null;

  const sprite = scene.add.sprite(x, y, id).setDepth(depth);
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

  if (!meta.loop) {
    const duration = (frameCount / meta.fps) * 1000;
    sprite.once('animationcomplete', () => sprite.destroy());
    // a belt-and-braces timer: if the complete event is missed the sprite still
    // goes away instead of lingering as a frozen frame
    scene.time.delayedCall(duration + 80, () => {
      if (sprite.active) sprite.destroy();
    });
  }
  return sprite;
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
