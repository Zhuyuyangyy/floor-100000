import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bakedTextures } from './bakeProbe';
import { CHARACTER_FILES, FURNITURE_FILES } from '../render/artpack';

// The scene carried three unrelated scales for a long time without anything
// noticing: 16px for the tiled wall, floor, doors and windows; 16x24 for the
// characters; 80px for every prop. It was invisible while the player was the same
// height as a door. Once the characters became 32x48 the conflict was obvious — a
// crate 66% taller than the player, a door a third of the player's height — and
// no test caught it, because nothing related the sizes to each other.
//
// These are those relations. They are about how the room reads, so the numbers
// are ratios rather than absolutes: a prop may be rescaled wholesale without
// rewriting this file.

const ART = join(process.cwd(), 'public/assets/artpack');

// PNG dimensions live at fixed offsets in the IHDR (furniture.test.ts reads them
// the same way), so no decoder is needed.
function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(join(ART, file));
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const baked = new Map(bakedTextures().map((t) => [t.key, t]));
const furniture = Object.entries(FURNITURE_FILES).map(([key, file]) => ({ key, ...pngSize(file) }));
const characters = Object.entries(CHARACTER_FILES).map(([key, file]) => ({ key, ...pngSize(file) }));

// The player's height is the unit everything else is measured against. All four
// share one canvas, so they must agree — that is the foot-baseline rule.
describe('character canvas', () => {
  it('gives every character the same canvas, so frames never bob', () => {
    const heights = new Set(characters.map((c) => c.height));
    expect([...heights], `heights: ${characters.map((c) => `${c.key}=${c.height}`).join(', ')}`).toEqual([48]);
  });

  it('has a file for each of them', () => {
    for (const c of characters) expect(existsSync(join(ART, CHARACTER_FILES[c.key as keyof typeof CHARACTER_FILES]))).toBe(true);
  });
});

describe('props relate to the people standing next to them', () => {
  const person = Math.max(...characters.map((c) => c.height));

  it('gives every prop one shared standing height', () => {
    // The original reason the art pack is scaled at all: a scene where one prop is
    // twice the height of the next reads as pasted stickers.
    const heights = new Set(furniture.map((f) => f.height));
    expect([...heights], `heights: ${furniture.map((f) => `${f.key}=${f.height}`).join(', ')}`).toHaveLength(1);
  });

  it('keeps a prop from towering over the player', () => {
    // 80px props against a 48px player put a crate 66% taller than a person. 56px
    // puts it at 1.17x, which reads as a large crate rather than a wall.
    const tallest = Math.max(...furniture.map((f) => f.height));
    expect(tallest / person, `tallest prop ${tallest}px vs player ${person}px`).toBeLessThanOrEqual(1.25);
  });

  it('keeps a prop big enough to still be a prop', () => {
    // The other failure: shrink everything to fit and the room fills with crumbs.
    const shortest = Math.min(...furniture.map((f) => f.height));
    expect(shortest / person).toBeGreaterThanOrEqual(0.9);
  });
});

describe('doors and windows are architectural, not fixtures', () => {
  const person = Math.max(...characters.map((c) => c.height));
  const door = baked.get('tile_door');
  const window = baked.get('tile_window');

  it('bakes both', () => {
    expect(door, 'tile_door is not baked').toBeDefined();
    expect(window, 'tile_window is not baked').toBeDefined();
  });

  it('makes a door at least as tall as the person walking through it', () => {
    // A 16px door beside a 48px player reads as a wall fitting.
    expect(door!.height, `door is ${door!.height}px, player is ${person}px`).toBeGreaterThanOrEqual(person);
  });

  it('makes a window tall enough to be a window', () => {
    expect(window!.height / person, `window is ${window!.height}px, player is ${person}px`).toBeGreaterThanOrEqual(0.75);
  });

  it('keeps a door narrower than it is tall', () => {
    expect(door!.width).toBeLessThan(door!.height);
  });
});
