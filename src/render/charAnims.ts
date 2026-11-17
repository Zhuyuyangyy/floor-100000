// The four characters' action GIFs, baked into atlases and played in combat
// and the world.
//
// WHY A NEW FILE rather than more of walkcycle.ts. walkcycle.ts owns the
// procedural pipeline: it PARSES poses, BAKES canvas textures and REGISTERS
// animations for all nine CHARACTER_KEYS, and the B3-14 hand-posed walk cycle
// lives there and must not be touched. This file owns the opposite side - the
// owner's delivered GIFs (docs/art-previews, baked by tools/bake-char-anims.py
// into public/assets/chars/) - and its whole job is to REPLACE six of
// walkcycle's registrations for four of the nine characters. Keeping that in
// walkcycle.ts would mean the file that draws the procedural art also deciding
// when the procedural art loses; keeping it here means the swap is one
// function with one call site (BootScene.create).
//
// HOW THE SWAP WORKS - the animation keys are deliberately IDENTICAL to
// walkcycle's: attack-{who}, hurt-{who}, die-{who}, idle-{who}, pickup-{who},
// search-{who}. createCharAnimAnims() runs after createCharacterAnimations(),
// removes those six keys and re-registers them with frames from the GIF
// atlases. Every existing call site (GameScene's playActionAnim, the NPC idle
// loop, the trader, the per-frame walk/idle pick) therefore plays the GIF with
// no call-site change at all - the same trick the per-weapon attack sheets
// already use, one level up. walk-{who} and run-{who} are NOT touched: the
// walk cycle is hand-posed pixel work (B3-14) and the GIF is a regression on
// it, so walk.gif was never baked.
//
// RUNTIME CONTRACT, all asserted by the bake script per frame: 64x96 frames,
// horizontal atlases with no padding, at most 16 colours every one of them
// from src/render/palette.ts, binary alpha, feet on row 95 (the same contract
// tools/char-sheet-gate.mjs gates the shipped sheets on, so a GIF clip and a
// procedural walk clip share one floor line).
import Phaser from 'phaser';

export const CHAR_ANIM_FRAME_W = 64;
export const CHAR_ANIM_FRAME_H = 96;

// The four characters with delivered GIFs. The other five CHARACTER_KEYS
// (npc_zhouhe and the four AG-46 publishers) have no GIFs; every helper here
// falls back to the procedural clip for them, which is why adding a character
// to WALK_CHARACTERS needs no change in this file.
export const CHAR_ANIM_CHARACTERS = ['player', 'npc_alin', 'npc_xiaozhou', 'wanderer'] as const;

export type CharAnimCharacter = (typeof CHAR_ANIM_CHARACTERS)[number];

// The six baked actions. walk is absent on purpose - see the file note.
export const CHAR_ANIM_ACTIONS = ['attack', 'hurt', 'die', 'idle', 'pickup', 'search'] as const;

export type CharAnimAction = (typeof CHAR_ANIM_ACTIONS)[number];

// The one-shot actions playActionAnim can hold. idle is a loop the frame
// loop picks, never a held clip, so it is not in this set.
const HOLDABLE: readonly CharAnimAction[] = ['attack', 'hurt', 'die', 'pickup', 'search'];

// Per-frame durations in ms, transcribed from the GIFs by
// tools/bake-char-anims.py. public/assets/chars/manifest.json is the same
// table; src/tests/charAnims.test.ts fails when the two disagree, so a
// re-delivered GIF cannot change the timing in one place only.
export const CHAR_ANIM_FRAMES: Record<CharAnimCharacter, Record<CharAnimAction, readonly number[]>> = {
  player: {
    attack: [600, 600, 600],
    hurt: [650, 650],
    die: [900, 900, 900],
    idle: [1000, 1000],
    pickup: [650, 650],
    search: [750, 750],
  },
  npc_alin: {
    attack: [600, 600, 600],
    hurt: [650, 650],
    die: [900, 900, 900],
    idle: [1000, 1000],
    pickup: [650, 650],
    search: [750, 750],
  },
  npc_xiaozhou: {
    attack: [600, 600, 600],
    hurt: [650, 650],
    die: [900, 900, 900],
    idle: [1000, 1000],
    pickup: [650, 650],
    search: [750, 750],
  },
  wanderer: {
    attack: [600, 600, 600],
    hurt: [650, 650],
    die: [900, 900, 900],
    idle: [1000, 1000],
    pickup: [650, 650],
    search: [750, 750],
  },
};

/**
 * True when this animation key's frames come from a GIF atlas.
 *
 * The frame loop slows the sprite to 0.2x while it stands still (an anti-skate
 * floor for the walk clip), and that slowdown stays on the sprite. A one-shot
 * GIF clip played from a standing idle would then run at a fifth of its
 * authored speed - a 1800ms swing becoming nine seconds - so the scene resets
 * the scale for GIF-backed clips and lets the GIF's own rhythm rule. Clips
 * with no GIF keep the existing behaviour untouched.
 */
export function isCharAnimBacked(scene: Phaser.Scene, key: string): boolean {
  const anim = scene.anims.get(key);
  const tex = anim?.frames?.[0]?.textureKey;
  return typeof tex === 'string' && tex.startsWith('char-anim-');
}

/** The atlas texture key for one character's action GIF. */
export function charAnimSheetKey(who: string, action: string): string {
  return `char-anim-${who}-${action}`;
}

/**
 * How long playActionAnim should hold a clip, in ms.
 *
 * The GIFs are slower than the procedural poses they replace - attack is
 * 3x600ms where the procedural clip was 320ms - and the frame loop's
 * walk/idle pick stands down only until `actionAnimUntil`. Holding the
 * procedural 320ms over a 1800ms GIF would cut the swing off on its first
 * frame, so the hold becomes the GIF's own total. Clips with no GIF (walk,
 * the five unbaked characters) keep the caller's number.
 */
export function charAnimHoldMs(proceduralKey: string, fallbackMs: number): number {
  const m = /^(attack|hurt|die|pickup|search)-(.+)$/.exec(proceduralKey);
  if (!m) return fallbackMs;
  const [, action, who] = m;
  if (!(HOLDABLE as readonly string[]).includes(action)) return fallbackMs;
  const frames = CHAR_ANIM_FRAMES[who as CharAnimCharacter]?.[action as CharAnimAction];
  if (!frames) return fallbackMs;
  return Math.max(fallbackMs, frames.reduce((a, b) => a + b, 0));
}

/**
 * The attack frame a sprite is showing, for BOTH sheet sources.
 *
 * syncWeapon anchors the crowbar to the fist of the attack pose by reading
 * the sprite's current frame and subtracting walkcycle's ATTACK_FRAME_START
 * (the walk sheet parks attack at columns 8..10). The GIF atlas numbers its
 * three frames 0..2, so the same read has to map them to 0..2 as well or the
 * grip would sit on frame 0's angle for the whole clip. Returns -1 when the
 * frame name is not an attack frame at all.
 */
export function attackFrameIndex(frameName: string | number | undefined, attackFrameStart: number, attackFrames: number): number {
  const n = Number(frameName);
  if (!Number.isFinite(n)) return -1;
  const f = n >= attackFrameStart ? n - attackFrameStart : n;
  if (f < 0 || f >= attackFrames) return -1;
  return f;
}

/**
 * Load every baked atlas. Called from BootScene.preload alongside the rest of
 * the pack; the URLs are runtime paths into public/, the same route the
 * artpack tables take.
 */
export function preloadCharAnims(scene: Phaser.Scene): void {
  for (const who of CHAR_ANIM_CHARACTERS) {
    for (const action of CHAR_ANIM_ACTIONS) {
      scene.load.spritesheet(charAnimSheetKey(who, action), `assets/chars/${who}-${action}.png`, {
        frameWidth: CHAR_ANIM_FRAME_W,
        frameHeight: CHAR_ANIM_FRAME_H,
      });
    }
  }
}

/**
 * Re-register the six shared animation keys on the GIF atlases.
 *
 * Runs after createCharacterAnimations() - anims.create refuses to replace an
 * existing key (it warns and returns the old animation), so the procedural
 * registration is removed first. Guarded on the texture: a failed atlas load
 * leaves the procedural clip registered rather than an animation pointing at
 * a missing texture, which is the AG-75 fallback path.
 */
export function createCharAnimAnims(scene: Phaser.Scene): void {
  for (const who of CHAR_ANIM_CHARACTERS) {
    for (const action of CHAR_ANIM_ACTIONS) {
      const sheet = charAnimSheetKey(who, action);
      if (!scene.textures.exists(sheet)) continue;
      const key = `${action}-${who}`;
      if (scene.anims.exists(key)) scene.anims.remove(key);
      const durations = CHAR_ANIM_FRAMES[who][action];
      scene.anims.create({
        key,
        // One entry per frame with the GIF's own duration, rather than a
        // single frameRate: the delivery is authored in ms-per-frame
        // (attack 600, search 750, idle 1000) and a uniform rate would have
        // to pick one and lie about the other five.
        frames: durations.map((duration, frame) => ({ key: sheet, frame, duration })),
        // idle breathes forever; every one-shot stops on its last frame and
        // is held there by playActionAnim until the caller moves on - the
        // same repeat:0 contract the procedural clips use.
        repeat: action === 'idle' ? -1 : 0,
      });
    }
  }
}
