import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateAllPixelArt } from '../render/pixelArt';
import { ART_BANNER_LOSE_KEY, ART_BANNER_WIN_KEY, ART_SLOT_KEY, CHARACTER_KEYS, ITEM_ICON_FILES } from '../render/artpack';
import { FURNITURE_KEYS } from '../render/furniture';

// Phaser answers a texture key it does not have with __MISSING — a green
// placeholder box — and says nothing. That is how a renamed furniture key turned
// into green rectangles standing in the corridor for a whole round without a
// single test failing: corridors.ts still asked for 'furn_crate' after the crate
// textures were split into wood and metal.
//
// So: collect every key the game can actually resolve, then scan the source for
// every key it asks for, and fail on the difference.

// ── the keys generateAllPixelArt bakes ─────────────────────────────────────
// bake() only needs add.graphics(), a drawing call and generateTexture(), so a
// recording stub is enough — no Phaser instance required.
function bakedKeys(): string[] {
  const keys: string[] = [];
  const graphics = {
    fillStyle: () => graphics,
    fillRect: () => graphics,
    fillTriangle: () => graphics,
    fillCircle: () => graphics,
    lineStyle: () => graphics,
    lineBetween: () => graphics,
    strokeRect: () => graphics,
    clear: () => graphics,
    generateTexture: (key: string) => {
      keys.push(key);
    },
    destroy: () => graphics,
  };
  const scene = { add: { graphics: () => graphics } };
  // The parameter type is a Phaser.Scene; the stub satisfies every member the
  // function actually touches, which is all bake() needs.
  generateAllPixelArt(scene as unknown as Parameters<typeof generateAllPixelArt>[0]);
  return keys;
}

// ── the keys BootScene loads ───────────────────────────────────────────────
function loadedKeys(): string[] {
  return [
    ...Object.keys(ITEM_ICON_FILES),
    ...FURNITURE_KEYS,
    // The four characters are loaded from PNGs drawn by build-characters.mjs.
    ...CHARACTER_KEYS,
    'ui-marker',
    ART_SLOT_KEY,
    ART_BANNER_WIN_KEY,
    ART_BANNER_LOSE_KEY,
    // The panel frame is built from a template literal, so its keys are not
    // literals in the source: enumerate them the way BootScene does.
    ...['green', 'yellow'].flatMap((accent) =>
      ['tl', 'tr', 'bl', 'br', 'top', 'bottom', 'left', 'right'].map((part) => `ui-frame-${accent}-${part}`),
    ),
  ];
}

// ── every key the source asks for ──────────────────────────────────────────
// Only the call shapes that take a texture key, so ordinary string literals
// (labels, messages, save keys) are not swept up.
const KEY_CALL = /(?:add\.image|add\.sprite|add\.tileSprite|add\.nineslice|setTexture|load\.image|load\.spritesheet|textures\.get|textures\.exists)\s*\([^)]*?['"]([a-z0-9][a-z0-9_-]*)['"]/g;

// A few keys are chosen by an expression rather than written as a literal — the
// NPC sprite picks between two by id, the item icon and the furniture texture go
// through itemIconKey() / containerTextureKey(). Those are enumerated here so the
// "no unused key" direction still covers them.
const DYNAMIC_KEYS = ['npc_alin', 'npc_xiaozhou', ...Object.keys(ITEM_ICON_FILES), ...FURNITURE_KEYS];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

const ROOT = join(process.cwd(), 'src');

describe('every texture key the source asks for exists', () => {
  const known = new Set([...bakedKeys(), ...loadedKeys()]);
  const asked = new Map<string, string[]>();

  for (const file of sourceFiles(ROOT)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(KEY_CALL)) {
      const key = match[1];
      const where = file.slice(ROOT.length + 1);
      asked.set(key, [...(asked.get(key) ?? []), where]);
    }
  }

  it('bakes and loads a non-trivial set of keys', () => {
    // Guards the collection itself: if generateAllPixelArt ever baked nothing,
    // every assertion below would pass for the wrong reason.
    expect(known.size).toBeGreaterThan(20);
  });

  it('finds the keys the game actually references', () => {
    // Same guard for the scan.
    expect(asked.size).toBeGreaterThan(10);
    expect(asked.has('furn_crate_wood')).toBe(true);
    expect(asked.has('clean_water')).toBe(true);
  });

  it('has no unknown key', () => {
    const unknown = [...asked.keys()].filter((k) => !known.has(k));
    expect(unknown.map((k) => `${k} (${asked.get(k)?.join(', ')})`)).toEqual([]);
  });

  it('leaves no baked key unused', () => {
    // Keys chosen by an expression rather than a literal are enumerated above, so
    // this direction covers them too without needing a literal in the source.
    const unused = bakedKeys().filter((k) => !asked.has(k) && !DYNAMIC_KEYS.includes(k));
    expect(unused.sort()).toEqual([]);
  });

  it('knows about every dynamic key it claims to', () => {
    // If a dynamic key were ever removed from the art pack tables, this test would
    // silently stop covering it.
    expect(DYNAMIC_KEYS).toContain('npc_alin');
    expect(DYNAMIC_KEYS).toContain('clean_water');
    expect(DYNAMIC_KEYS).toContain('furn_crate_wood');
    expect(DYNAMIC_KEYS.every((k) => known.has(k))).toBe(true);
  });
});
