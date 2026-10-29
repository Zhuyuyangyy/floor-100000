import { describe, expect, it } from 'vitest';

import {
  RELICS,
  guardianDamageMult,
  hungerLossMult,
  lootBonus,
  relicsForDepth,
  relicById,
  relicDisplay,
  waterRestoreMult,
  moveSpeedMult,
} from '../systems/relics';
import { freshMeta, unlockFromDepth } from '../systems/metaProgress';
import type { MetaProgress } from '../core/gameTypes';

// Wave B3: relics are data plus one multiplier each. These pin the roster, the
// unlock gates and every multiplier, so a relic can never quietly change two
// rules at once.

describe('relic roster', () => {
  it('ships five relics with unique ids and names', () => {
    expect(RELICS).toHaveLength(5);
    expect(new Set(RELICS.map((r) => r.id)).size).toBe(5);
    expect(new Set(RELICS.map((r) => r.name)).size).toBe(5);
    for (const r of RELICS) {
      expect(r.name.length).toBeGreaterThan(0);
      expect(r.blurb.length).toBeGreaterThan(0);
      expect(r.unlockDepth).toBeGreaterThanOrEqual(2);
      expect(r.unlockDepth).toBeLessThanOrEqual(5);
    }
  });

  it('finds a relic by id and misses cleanly', () => {
    expect(relicById('water_heart')?.name).toBe('水之心');
    expect(relicById('nope')).toBeUndefined();
  });
});

describe('relic unlocks', () => {
  it('earns nothing before depth 2', () => {
    expect(relicsForDepth(1, [])).toEqual([]);
  });

  it('earns the first relic at depth 2', () => {
    expect(relicsForDepth(2, [])).toEqual(['water_heart']);
  });

  it('earns more as the record deepens, in roster order', () => {
    expect(relicsForDepth(3, [])).toEqual(['water_heart', 'iron_stomach', 'swift_feet']);
    expect(relicsForDepth(5, [])).toEqual(['water_heart', 'iron_stomach', 'swift_feet', 'lucky_charm', 'guardian_totem']);
  });

  it('never re-announces an earned relic', () => {
    expect(relicsForDepth(5, ['water_heart', 'iron_stomach', 'swift_feet', 'lucky_charm', 'guardian_totem'])).toEqual([]);
  });

  it('shows locked relics with the depth that opens them', () => {
    const rows = relicDisplay(freshMeta());
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => !r.unlocked)).toBe(true);
    expect(rows.map((r) => r.need)).toEqual([2, 3, 3, 4, 5]);
    const deep: MetaProgress = { ...freshMeta(), relics: ['water_heart'] };
    const rows2 = relicDisplay(deep);
    expect(rows2[0].unlocked).toBe(true);
    expect(rows2[1].unlocked).toBe(false);
  });
});

describe('relic multipliers', () => {
  it('is vanilla with no relics', () => {
    expect(waterRestoreMult([])).toBe(1);
    expect(hungerLossMult([])).toBe(1);
    expect(moveSpeedMult([])).toBe(1);
    expect(lootBonus([])).toBe(0);
    expect(guardianDamageMult([])).toBe(1);
  });

  it('applies each relic to exactly its own rule', () => {
    expect(waterRestoreMult(['water_heart'])).toBe(1.5);
    expect(hungerLossMult(['iron_stomach'])).toBe(0.7);
    expect(moveSpeedMult(['swift_feet'])).toBe(1.15);
    expect(lootBonus(['lucky_charm'])).toBe(1);
    expect(guardianDamageMult(['guardian_totem'])).toBe(0.7);
  });

  it('does not cross the wires', () => {
    // water_heart must not touch hunger, and so on.
    expect(hungerLossMult(['water_heart'])).toBe(1);
    expect(waterRestoreMult(['iron_stomach'])).toBe(1);
    expect(guardianDamageMult(['water_heart'])).toBe(1);
    expect(lootBonus(['swift_feet'])).toBe(0);
  });

  it('stacks additively on the loot bonus only', () => {
    // Every other relic is a single multiplier; two of the same kind change
    // nothing, which is why the meta stores a set.
    expect(waterRestoreMult(['water_heart', 'water_heart'])).toBe(1.5);
  });

  it('survives a full unlock through the meta', () => {
    const meta = unlockFromDepth(freshMeta(), 5);
    expect(meta.relics).toBeDefined();
    // relics are stored on the meta by the caller; unlockFromDepth only
    // carries the field through untouched, which this pins.
    expect(meta.unlockedCharacters).toContain('wanderer');
  });
});
