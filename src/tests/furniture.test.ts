import { describe, expect, it } from 'vitest';
import { FLOOR_TEMPLATES } from '../data/floorTemplates';
import { containerTextureKey, FURNITURE_KEYS } from '../render/furniture';

// Every container in the world must either map to a real furniture texture or
// be an explicitly acknowledged gap — never silently fall back to something
// that looks wrong.
describe('container furniture mapping', () => {
  const allContainers = Object.values(FLOOR_TEMPLATES).flatMap((t) => t.containers.map((c) => c.id));

  it('knows about every container in the game', () => {
    expect(allContainers.length).toBeGreaterThan(0);
    for (const id of allContainers) {
      const key = containerTextureKey(id);
      if (key === null) continue; // gap, asserted below
      expect(FURNITURE_KEYS, `unknown texture for ${id}`).toContain(key);
    }
  });

  it('maps the containers that have matching art', () => {
    expect(containerTextureKey('cabinet')).toBe('furn_cabinet');
    expect(containerTextureKey('shelf')).toBe('furn_shelf');
    expect(containerTextureKey('crate_wood')).toBe('furn_crate');
    expect(containerTextureKey('crate_metal')).toBe('furn_crate');
    expect(containerTextureKey('fuse_box')).toBe('furn_fusebox');
    expect(containerTextureKey('water_tank')).toBe('furn_watertank');
    expect(containerTextureKey('pantry')).toBe('furn_shelf'); // 补给架 is a shelf
  });

  it('leaves the one container with no matching art unmapped', () => {
    // 餐台 has no counterpart among the seven baked furniture textures, so it
    // keeps its Graphics box rather than being given a lookalike.
    expect(containerTextureKey('counter')).toBeNull();
  });

  it('returns null for an unknown container rather than guessing', () => {
    expect(containerTextureKey('not_a_container')).toBeNull();
  });

  it('never maps two different containers to the same texture by accident', () => {
    // Crates legitimately share one texture; assert the whole mapping is stable
    // and intentional. Compared order-independently — Object.values iterates
    // integer-like keys in ascending numeric order, not insertion order.
    const mapped = allContainers.map((id) => [id, containerTextureKey(id)] as const).sort();
    expect(mapped).toEqual(
      [
        ['cabinet', 'furn_cabinet'],
        ['counter', null],
        ['crate_metal', 'furn_crate'],
        ['crate_wood', 'furn_crate'],
        ['fuse_box', 'furn_fusebox'],
        ['pantry', 'furn_shelf'],
        ['shelf', 'furn_shelf'],
        ['water_tank', 'furn_watertank'],
      ].sort(),
    );
  });
});
