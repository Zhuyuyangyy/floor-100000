import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { deserialize, serialize, validateGameState } from '../systems/SaveSystem';

describe('save round-trip', () => {
  it('serialize -> deserialize preserves state exactly', () => {
    const state = createNewGame(2026);
    const result = deserialize(serialize(state));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state).toEqual(state);
  });
});

describe('bad saves fail gracefully (never throw)', () => {
  it('rejects invalid JSON', () => {
    const r = deserialize('{ not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('损坏');
  });

  it('rejects a wrong schemaVersion', () => {
    const state = { ...createNewGame(1), schemaVersion: 999 };
    expect(deserialize(serialize(state)).ok).toBe(false);
  });

  it('rejects out-of-range hp', () => {
    const state = createNewGame(1);
    state.player.hp = 150;
    expect(validateGameState(state).length).toBeGreaterThan(0);
    expect(deserialize(serialize(state)).ok).toBe(false);
  });

  it('rejects an unknown item in the inventory', () => {
    const state = createNewGame(1);
    (state.player.inventory.slots as unknown[]).push({ itemId: 'unobtainium', quantity: 1 });
    expect(deserialize(serialize(state)).ok).toBe(false);
  });

  it('rejects a missing player object', () => {
    const state = createNewGame(1) as unknown as Record<string, unknown>;
    delete state.player;
    expect(validateGameState(state).some((e) => e.includes('player'))).toBe(true);
  });
});
