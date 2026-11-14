import { describe, expect, it } from 'vitest';
import { ENCOUNTER_TABLE } from '../systems/encounters';
import { PLAYABLE_FLOORS_V01 } from '../core/constants';

// Regression for the floor expansion: ENCOUNTER_TABLE is built at module
// init, so a missing weight profile does not fail a test — it fails the whole
// game before the menu draws ("Cannot read properties of undefined (reading
// 'loot')", because 'loot' is the first kind the filter probes). That happened
// when the list grew to 10, and again when tier 2 (100-110) was authored.
describe('every playable floor can roll an encounter', () => {
  it('has a non-empty weighted table for all playable floors', () => {
    for (const floor of PLAYABLE_FLOORS_V01) {
      const row = ENCOUNTER_TABLE[floor];
      expect(row, `floor ${floor} has no encounter row`).toBeDefined();
      expect(row.length, `floor ${floor} has an empty encounter row`).toBeGreaterThan(0);
      for (const entry of row) expect(entry.weight).toBeGreaterThan(0);
    }
  });

  // Two authored segment closers carry a guard: floor 5 ends the slum chapter
  // (the gatekeeper), floor 110 ends the dorm tier (the segment keeper). The
  // floors in between, including every segment top that has no authored
  // content above it, must not roll a boss.
  const BOSS_FLOORS = new Set([5, 110]);

  it('keeps the boss on the two authored segment closers only', () => {
    for (const floor of PLAYABLE_FLOORS_V01) {
      const hasBoss = ENCOUNTER_TABLE[floor].some((e) => e.kind === 'boss');
      if (BOSS_FLOORS.has(floor)) expect(hasBoss, `floor ${floor} should have a boss`).toBe(true);
      else expect(hasBoss, `floor ${floor} should not have a boss`).toBe(false);
    }
  });

  it('gives the dorm tier a heavier ambush than any slum floor', () => {
    const ambush = (floor: number): number =>
      ENCOUNTER_TABLE[floor].find((e) => e.kind === 'ambush')?.weight ?? 0;
    const worstSlum = Math.max(...PLAYABLE_FLOORS_V01.filter((f) => f < 100).map(ambush));
    for (const floor of PLAYABLE_FLOORS_V01.filter((f) => f >= 100 && f !== 110)) {
      expect(ambush(floor), `floor ${floor} ambush`).toBeGreaterThan(worstSlum);
    }
  });
});
