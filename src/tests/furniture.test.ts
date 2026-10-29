import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLOOR_TEMPLATES } from '../data/floorTemplates';
import { containerTextureKey, FURNITURE_KEYS } from '../render/furniture';
import { ENV_FILES, FURNITURE_FILES } from '../render/artpack';

// Every container in the world must map to a real furniture texture. There used
// to be one acknowledged gap (餐台) and a Graphics box drawn for it; the art pack
// covers it now, so a container with no key would be invisible rather than
// plain-looking, which is a much worse failure.
describe('container furniture mapping', () => {
  const allContainers = Object.values(FLOOR_TEMPLATES).flatMap((t) => t.containers.map((c) => c.id));

  it('knows about every container in the game', () => {
    expect(allContainers.length).toBeGreaterThan(0);
    for (const id of allContainers) {
      const key = containerTextureKey(id);
      expect(key, `no texture for ${id}`).not.toBeNull();
      expect(FURNITURE_KEYS, `unknown texture for ${id}`).toContain(key);
    }
  });

  it('maps the containers that have matching art', () => {
    expect(containerTextureKey('cabinet')).toBe('furn_cabinet');
    expect(containerTextureKey('shelf')).toBe('furn_shelf');
    expect(containerTextureKey('pantry')).toBe('furn_shelf'); // 补给架 is a shelf
    expect(containerTextureKey('crate_wood')).toBe('furn_crate_wood');
    expect(containerTextureKey('crate_metal')).toBe('furn_crate_metal');
    expect(containerTextureKey('fuse_box')).toBe('furn_fusebox');
    expect(containerTextureKey('water_tank')).toBe('furn_watertank');
    expect(containerTextureKey('counter')).toBe('furn_counter');
  });

  it('returns null for an unknown container rather than guessing', () => {
    expect(containerTextureKey('not_a_container')).toBeNull();
  });

  it('never maps two different containers to the same texture by accident', () => {
    // Crates no longer share one texture — a wooden crate and a military crate
    // look nothing alike. Shelves still do: 邻居货架 and 补给架 are both shelves.
    // Compared order-independently — Object.values iterates integer-like keys in
    // ascending numeric order, not insertion order.
    const mapped = allContainers.map((id) => [id, containerTextureKey(id)] as const).sort();
    expect(mapped).toEqual(
      [
        ['cabinet', 'furn_cabinet'],
        ['counter', 'furn_counter'],
        ['crate_metal', 'furn_crate_metal'],
        ['crate_wood', 'furn_crate_wood'],
        ['fuse_box', 'furn_fusebox'],
        ['pantry', 'furn_shelf'],
        ['shelf', 'furn_shelf'],
        ['water_tank', 'furn_watertank'],
      ].sort(),
    );
  });
});

// The furniture files are an external input like the icons, so assert them
// against the disk rather than trusting the table above.
describe('furniture art files', () => {
  const dir = join(process.cwd(), 'public/assets/artpack');

  it('maps every furniture key to a file', () => {
    for (const key of FURNITURE_KEYS) {
      expect(FURNITURE_FILES[key], `file for ${key}`).toBeTypeOf('string');
    }
  });

  it('has no entry for anything that is not a furniture key', () => {
    expect(Object.keys(FURNITURE_FILES).sort()).toEqual([...FURNITURE_KEYS].sort());
  });

  it('every mapped file exists and is a PNG', () => {
    for (const [key, file] of Object.entries(FURNITURE_FILES)) {
      const path = join(dir, file);
      expect(existsSync(path), `${key} -> ${file}`).toBe(true);
      const buf = readFileSync(path);
      expect(buf.subarray(1, 4).toString('ascii'), `${file} signature`).toBe('PNG');
      expect(buf.readUInt32BE(16), `${file} width`).toBeGreaterThan(0);
      expect(buf.readUInt32BE(20), `${file} height`).toBeGreaterThan(0);
    }
  });

  it('has no orphan furniture file in the pack', () => {
    const mapped = new Set(Object.values(FURNITURE_FILES));
    const onDisk = readdirSync(dir).filter((f) => f.startsWith('furn-'));
    expect(onDisk.filter((f) => !mapped.has(f))).toEqual([]);
  });
});

// The room art (wall, floor, door, window) is loaded by path from ENV_FILES, and a
// wrong path is a silent-ish failure: Phaser logs "Failed to process file" at
// runtime and the object simply never draws. textureKeys.test.ts only checks that
// a key is *known*, not that the file behind it exists — which is how the door and
// window ended up in assets/artpack while BootScene looked in assets/env.
describe('room art files', () => {
  const envDir = join(process.cwd(), 'public/assets/env');

  it('has a file on disk for every room texture the game loads', () => {
    for (const [key, file] of Object.entries(ENV_FILES)) {
      expect(existsSync(join(envDir, file)), `${key} -> assets/env/${file}`).toBe(true);
    }
  });

  it('points at PNGs', () => {
    for (const [, file] of Object.entries(ENV_FILES)) {
      const buf = readFileSync(join(envDir, file));
      expect(buf.subarray(1, 4).toString('ascii'), `${file} signature`).toBe('PNG');
      expect(buf.readUInt32BE(16), `${file} width`).toBeGreaterThan(0);
      expect(buf.readUInt32BE(20), `${file} height`).toBeGreaterThan(0);
    }
  });
});
