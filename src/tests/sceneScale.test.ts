import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CHARACTER_FILES, ENV_FILES, FURNITURE_FILES, TILE_DOOR_KEY, TILE_WINDOW_KEY } from '../render/artpack';

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
// The room art lives in its own directory — wall, floor, door, window.
const ENV_DIR = join(process.cwd(), 'public/assets/env');

// PNG dimensions live at fixed offsets in the IHDR (furniture.test.ts reads them
// the same way), so no decoder is needed.
function pngSize(dir: string, file: string): { width: number; height: number } {
  const buf = readFileSync(join(dir, file));
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const furniture = Object.entries(FURNITURE_FILES).map(([key, file]) => ({ key, ...pngSize(ART, file) }));
const characters = Object.entries(CHARACTER_FILES).map(([key, file]) => ({ key, ...pngSize(ART, file) }));

// The player's height is the unit everything else is measured against. All four
// share one canvas, so they must agree — that is the foot-baseline rule.
describe('character canvas', () => {
  it('gives every character the same canvas, so frames never bob', () => {
    // Assert the set, not a number: the canvas was 32x48, then the owner's renders
    // arrived and it became 64x96. The invariant is that they agree, not what they
    // agree on — that is a size decision, and sceneScale should not own it.
    const heights = new Set(characters.map((c) => c.height));
    const widths = new Set(characters.map((c) => c.width));
    expect([...heights], `heights: ${characters.map((c) => `${c.key}=${c.height}`).join(', ')}`).toHaveLength(1);
    expect([...widths], `widths: ${characters.map((c) => `${c.key}=${c.width}`).join(', ')}`).toHaveLength(1);
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
    // 80px props against a 48px player put a crate 66% taller than a person. Props
    // are 56px now, so nothing reaches the player's height.
    const tallest = Math.max(...furniture.map((f) => f.height));
    expect(tallest / person, `tallest prop ${tallest}px vs player ${person}px`).toBeLessThanOrEqual(0.9);
  });

  it('keeps a prop big enough to still be a prop', () => {
    // The other failure: shrink everything to fit and the room fills with crumbs.
    // A crate is roughly a third of a person's height, so that is the floor.
    const shortest = Math.min(...furniture.map((f) => f.height));
    expect(shortest / person, `shortest prop ${shortest}px vs player ${person}px`).toBeGreaterThanOrEqual(0.3);
  });
});

// The door and window are loaded images now, not baked tiles, so their sizes come
// off disk like the characters' and the props'.
describe('doors and windows are architectural, not fixtures', () => {
  const person = Math.max(...characters.map((c) => c.height));
  const door = pngSize(ENV_DIR, ENV_FILES[TILE_DOOR_KEY]);
  const window = pngSize(ENV_DIR, ENV_FILES[TILE_WINDOW_KEY]);

  it('has art for both', () => {
    expect(existsSync(join(ENV_DIR, ENV_FILES[TILE_DOOR_KEY]))).toBe(true);
    expect(existsSync(join(ENV_DIR, ENV_FILES[TILE_WINDOW_KEY]))).toBe(true);
  });

  it('makes a door at least as tall as the person walking through it', () => {
    // A 16px door beside a 48px player read as a wall fitting; 56px beside a 96px
    // player is a door a child could use. The art is rebuilt at 44x104.
    expect(door.height, `door is ${door.height}px, player is ${person}px`).toBeGreaterThanOrEqual(person);
  });

  it('makes a window tall enough to be a window', () => {
    expect(window.height / person, `window is ${window.height}px, player is ${person}px`).toBeGreaterThanOrEqual(0.7);
  });

  it('keeps a door narrower than it is tall', () => {
    expect(door.width).toBeLessThan(door.height);
  });
});
