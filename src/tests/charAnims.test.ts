import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CHAR_ANIM_ACTIONS,
  CHAR_ANIM_CHARACTERS,
  CHAR_ANIM_FRAMES,
  attackFrameIndex,
  charAnimHoldMs,
  charAnimSheetKey,
} from '../render/charAnims';

// The TS table is what the game loads at boot; public/assets/chars/
// manifest.json is what tools/bake-char-anims.py wrote from the GIFs. They
// describe the same 24 atlases, so a re-delivered GIF that changes one and
// not the other fails HERE - as a diff - instead of shipping a frame-count
// or timing mismatch into the animation manager, where it would read as a
// clip that stutters or stops a frame early.

interface ManifestEntry {
  file: string;
  frames: number;
  durations: number[];
  totalMs: number;
}

const manifest = JSON.parse(readFileSync(join(process.cwd(), 'public/assets/chars/manifest.json'), 'utf8')) as {
  characters: Record<string, Record<string, ManifestEntry>>;
};

describe('charAnims agrees with the baked manifest', () => {
  it('covers exactly the characters the bake wrote', () => {
    expect([...CHAR_ANIM_CHARACTERS].sort()).toEqual(Object.keys(manifest.characters).sort());
  });

  it('covers exactly the six actions per character', () => {
    for (const who of CHAR_ANIM_CHARACTERS) {
      expect(Object.keys(CHAR_ANIM_FRAMES[who]).sort(), `${who} actions`).toEqual(
        Object.keys(manifest.characters[who]).sort(),
      );
      expect([...CHAR_ANIM_ACTIONS].sort()).toEqual(Object.keys(manifest.characters[who]).sort());
    }
  });

  it('carries the same frame count and per-frame duration for every clip', () => {
    for (const who of CHAR_ANIM_CHARACTERS) {
      for (const action of CHAR_ANIM_ACTIONS) {
        const entry = manifest.characters[who][action];
        expect(CHAR_ANIM_FRAMES[who][action], `${who}/${action} durations`).toEqual(entry.durations);
        expect(entry.frames, `${who}/${action} frame count`).toBe(entry.durations.length);
        expect(entry.totalMs, `${who}/${action} total`).toBe(entry.durations.reduce((a, b) => a + b, 0));
        expect(entry.file, `${who}/${action} file`).toBe(`${who}-${action}.png`);
      }
    }
  });
});

describe('charAnimHoldMs', () => {
  it('holds a GIF clip for the GIF total, never shorter than the caller asked', () => {
    // The whole point: attack is 3x600ms and the combat loop asks for 320ms.
    expect(charAnimHoldMs('attack-player', 320)).toBe(1800);
    expect(charAnimHoldMs('hurt-npc_alin', 400)).toBe(1300);
    expect(charAnimHoldMs('die-wanderer', 520)).toBe(2700);
    expect(charAnimHoldMs('search-player', 2000)).toBe(2000); // 1500ms GIF under a 2s search
  });

  it('leaves clips with no GIF on the caller number', () => {
    expect(charAnimHoldMs('walk-player', 500)).toBe(500);
    expect(charAnimHoldMs('run-player', 500)).toBe(500);
    expect(charAnimHoldMs('idle-player', 500)).toBe(500); // idle is a loop, never held
    expect(charAnimHoldMs('attack-player-crowbar', 320)).toBe(320); // per-weapon key, not a GIF key
    expect(charAnimHoldMs('attack-npc_zhouhe', 320)).toBe(320); // character with no GIF
  });
});

describe('attackFrameIndex', () => {
  it('maps both sheet sources to the same pose index', () => {
    // The procedural walk sheet parks attack at columns 8..10.
    expect(attackFrameIndex(8, 8, 3)).toBe(0);
    expect(attackFrameIndex(9, 8, 3)).toBe(1);
    expect(attackFrameIndex(10, 8, 3)).toBe(2);
    // The GIF atlas numbers its three frames 0..2.
    expect(attackFrameIndex(0, 8, 3)).toBe(0);
    expect(attackFrameIndex(2, 8, 3)).toBe(2);
    expect(attackFrameIndex('1', 8, 3)).toBe(1);
  });

  it('rejects anything that is not an attack frame', () => {
    expect(attackFrameIndex(3, 8, 3)).toBe(-1); // a walk frame
    expect(attackFrameIndex(undefined, 8, 3)).toBe(-1);
    expect(attackFrameIndex(11, 8, 3)).toBe(-1); // past the attack segment
  });
});

describe('charAnimSheetKey', () => {
  it('names one atlas per character and action', () => {
    expect(charAnimSheetKey('player', 'attack')).toBe('char-anim-player-attack');
    expect(charAnimSheetKey('npc_alin', 'idle')).toBe('char-anim-npc_alin-idle');
  });

  it('has a file on disk for every key it builds', () => {
    for (const who of CHAR_ANIM_CHARACTERS) {
      for (const action of CHAR_ANIM_ACTIONS) {
        const file = manifest.characters[who][action].file;
        expect(() => readFileSync(join(process.cwd(), 'public/assets/chars', file))).not.toThrow();
      }
    }
  });
});
