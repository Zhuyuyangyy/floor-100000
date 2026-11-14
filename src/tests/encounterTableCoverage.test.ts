import { describe, expect, it } from 'vitest';
import { ENCOUNTER_TABLE } from '../systems/encounters';
import { PLAYABLE_FLOORS_V01 } from '../core/constants';

// Regression for the floor-1..10 expansion: ENCOUNTER_TABLE is built at module
// init, so a missing weight profile does not fail a test — it fails the whole
// game before the menu draws ("Cannot read properties of undefined (reading
// 'loot')", because 'loot' is the first kind the filter probes).
describe('every playable floor can roll an encounter', () => {
  it('has a non-empty weighted table for all playable floors', () => {
    for (const floor of PLAYABLE_FLOORS_V01) {
      const row = ENCOUNTER_TABLE[floor];
      expect(row, `floor ${floor} has no encounter row`).toBeDefined();
      expect(row.length, `floor ${floor} has an empty encounter row`).toBeGreaterThan(0);
      for (const entry of row) expect(entry.weight).toBeGreaterThan(0);
    }
  });

  it('keeps the boss off every floor except the gatekeeper floor', () => {
    for (const floor of PLAYABLE_FLOORS_V01) {
      const hasBoss = ENCOUNTER_TABLE[floor].some((e) => e.kind === 'boss');
      if (floor === 5) expect(hasBoss, 'floor 5 should keep the gatekeeper').toBe(true);
      else expect(hasBoss, `floor ${floor} should not have a boss`).toBe(false);
    }
  });
});
