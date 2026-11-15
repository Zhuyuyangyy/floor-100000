import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../core/config';
import { PLAYABLE_FLOORS_V01, STARTING_FLOOR } from '../core/constants';

// Regression guard for the JSON import contract (AG-15, 2026-11-15).
//
// src/core/config.ts used to import config/game-balance.json without an import
// attribute. Vite and Vitest transform imports through their own pipeline, so
// unit tests and the dev server never noticed — but Node's ESM loader throws
// ERR_IMPORT_ATTRIBUTE_MISSING for a bare JSON import (Node >= 20.10), which
// broke every Playwright spec that transitively imported this module (any spec
// touching core/constants could not even load). The fix is the standard
// `with { type: 'json' }` attribute in config.ts.
//
// Note: Vitest cannot catch a regression here on its own, because its pipeline
// accepts both forms. The environments that actually enforce the attribute are
// Node ESM and Playwright — covered by running an e2e spec that imports the
// chain (docs/qa/ENV_NOTES.md). These assertions pin the values that must
// survive any refactor of the import.
describe('config import chain (constants derived from game-balance.json)', () => {
  it('loads the balance JSON through the import attribute', () => {
    expect(GAME_CONFIG.schemaVersion).toBe(1);
    expect(GAME_CONFIG.time.gameMinutesPerRealSecond).toBe(3);
    expect(GAME_CONFIG.player.hpStart).toBe(100);
  });

  it('derives STARTING_FLOOR from the JSON, not a hand copy', () => {
    expect(STARTING_FLOOR).toBe(GAME_CONFIG.player.startingFloor);
  });

  it('derives PLAYABLE_FLOORS_V01 from the JSON, not a hand copy', () => {
    expect(PLAYABLE_FLOORS_V01).toEqual(GAME_CONFIG.world.playableFloorsV01);
    expect(PLAYABLE_FLOORS_V01.length).toBeGreaterThan(0);
  });
});
