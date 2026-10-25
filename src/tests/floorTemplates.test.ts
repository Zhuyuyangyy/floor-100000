import { describe, expect, it } from 'vitest';
import { FLOOR_TEMPLATES, generateFloor, getFloorTemplate } from '../data/floorTemplates';
import { PLAYABLE_FLOORS_V01 } from '../core/constants';

describe('floor templates', () => {
  it('defines all 5 v0.1 floors', () => {
    for (const f of PLAYABLE_FLOORS_V01) {
      expect(getFloorTemplate(f)).toBeDefined();
    }
    expect(Object.keys(FLOOR_TEMPLATES)).toHaveLength(5);
  });

  it('the same seed generates the same world', () => {
    expect(generateFloor(42, 99998)).toEqual(generateFloor(42, 99998));
  });

  it('different seeds can differ on non-critical loot', () => {
    const base = JSON.stringify(generateFloor(1, 99998));
    let differs = false;
    for (let seed = 2; seed <= 60; seed++) {
      if (JSON.stringify(generateFloor(seed, 99998)) !== base) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });

  it('guaranteed (critical) loot is present for every QA seed', () => {
    for (const seed of [1, 42, 2026]) {
      const floor = generateFloor(seed, 99997);
      const fuseBox = floor.containers.find((c) => c.id === 'fuse_box');
      expect(fuseBox?.items.some((i) => i.itemId === 'fuse' && i.quantity >= 1)).toBe(true);
    }
  });

  it('an unknown floor throws', () => {
    expect(() => generateFloor(1, 12345)).toThrow();
  });
});
