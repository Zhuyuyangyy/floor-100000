import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CHARACTER_FILES, ENV_FILES, FLOOR_BACKDROP_FILES, floorBackdropKey, FURNITURE_FILES, TILE_DOOR_KEY, TILE_WINDOW_KEY } from '../render/artpack';

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
// Only the painted characters have a PNG; the residents added later are baked
// from palettes (see CHARACTER_FILES), so they are not part of this measurement.
const characters = Object.entries(CHARACTER_FILES)
  .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  .map(([key, file]) => ({ key, ...pngSize(ART, file) }));

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
    expect(characters.length, 'no painted characters left to measure').toBeGreaterThan(0);
    for (const c of characters) expect(existsSync(join(ART, CHARACTER_FILES[c.key as keyof typeof CHARACTER_FILES]!))).toBe(true);
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

// The five floors shared one wall.png and one floor.png for a long time, told
// apart only by a colour wash - which is why every floor looked the same. Five
// finished 2880x200 backdrops were sitting in the art library the whole time.
// These are the checks that keep them wired: a floor without its own image, or
// an image at the wrong geometry, is the failure this replaced.
describe('every playable floor has its own backdrop', () => {
  const BACKDROP_DIR = ENV_DIR;
  const floors = Object.keys(FLOOR_BACKDROP_FILES).map(Number);

  it('covers all five playable floors', () => {
    expect(floors.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('gives each floor a distinct file - no two floors reuse one image', () => {
    const files = Object.values(FLOOR_BACKDROP_FILES);
    expect(new Set(files).size).toBe(files.length);
  });

  it('ships a file for every floor', () => {
    for (const [floor, file] of Object.entries(FLOOR_BACKDROP_FILES)) {
      expect(existsSync(join(BACKDROP_DIR, file)), `floor ${floor} is missing ${file}`).toBe(true);
    }
  });

  it('is exactly one world-width by one floor-height, so it needs no scaling', () => {
    // A stretched backdrop squashes every door in the painting. 2880 -> 1280
    // would be a 2.25x horizontal crush; the build script crops instead.
    for (const [floor, file] of Object.entries(FLOOR_BACKDROP_FILES)) {
      const size = pngSize(BACKDROP_DIR, file);
      expect(size.width, `floor ${floor}`).toBe(1280); // FLOOR_WIDTH
      expect(size.height, `floor ${floor}`).toBe(200); // FLOOR_HEIGHT
    }
  });

  it('does not collide with the shared wall/floor keys', () => {
    for (const floor of floors) {
      const key = floorBackdropKey(floor);
      expect(Object.values(ENV_FILES)).not.toContain(`${key}.png`);
      expect(key).not.toBe('env-wall');
      expect(key).not.toBe('env-floor');
    }
  });
});
