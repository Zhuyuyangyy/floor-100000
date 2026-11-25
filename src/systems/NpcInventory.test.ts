import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import type { GameState, InventoryStack } from '../core/gameTypes';
import { loadNpcInventory, saveNpcInventory } from './NpcInventory';
import { deserialize, serialize } from './SaveSystem';

const sample: InventoryStack[] = [
  { itemId: 'battery', quantity: 3 },
  { itemId: 'flashlight', quantity: 1, meta: { charge: 'low', source: 'trade' } },
];

describe('NpcInventory', () => {
  it('round-trips item stacks and metadata as a separate extension key', () => {
    const state = createNewGame(47);

    expect(saveNpcInventory(state, 'alin', sample)).toBe(true);
    expect(loadNpcInventory(state, 'alin')).toEqual(sample);
    const persisted = JSON.parse(state.npcStates.alin!) as Record<string, unknown>;
    expect(persisted.competitionInventory).toEqual(sample);
    expect(state.schemaVersion).toBe(createNewGame(47).schemaVersion);
  });

  it('survives the existing save/load format without a schema extension', () => {
    const state = createNewGame(48);
    expect(saveNpcInventory(state, 'alin', sample)).toBe(true);

    const restored = deserialize(serialize(state));
    expect(restored.ok).toBe(true);
    if (restored.ok) {
      expect(loadNpcInventory(restored.state, 'alin')).toEqual(sample);
      expect(restored.state.schemaVersion).toBe(state.schemaVersion);
    }
  });

  it('retains relationship, generic memory, and unknown NPC JSON fields', () => {
    const state = createNewGame(9);
    const legacyMemory = [{ id: 'old-memory', summary: 'keep this' }];
    state.npcStates.alin = JSON.stringify({
      archetype: 'ally',
      memory: legacyMemory,
      relationship: { player: 4 },
      customFlag: { opaque: true },
    });

    expect(saveNpcInventory(state, 'alin', sample)).toBe(true);
    const persisted = JSON.parse(state.npcStates.alin!) as Record<string, unknown>;
    expect(persisted.archetype).toBe('ally');
    expect(persisted.memory).toEqual(legacyMemory);
    expect(persisted.relationship).toEqual({ player: 4 });
    expect(persisted.customFlag).toEqual({ opaque: true });
    expect(persisted.competitionInventory).toEqual(sample);
  });

  it('handles missing npcStates maps and old NPC records with no inventory', () => {
    const state = createNewGame(3);
    const oldState = state as unknown as { npcStates?: Record<string, string> };
    delete oldState.npcStates;
    expect(loadNpcInventory(state, 'missing')).toEqual([]);

    expect(saveNpcInventory(state, 'new-npc', sample)).toBe(true);
    expect(loadNpcInventory(state, 'new-npc')).toEqual(sample);

    state.npcStates.alin = JSON.stringify({ relationship: { player: 2 } });
    expect(loadNpcInventory(state, 'alin')).toEqual([]);
  });

  it('wraps malformed JSON and valid non-object legacy values on first write', () => {
    const state = createNewGame(11);
    const invalidLegacyJson = '{old npc bytes';
    state.npcStates.alin = invalidLegacyJson;
    expect(loadNpcInventory(state, 'alin')).toEqual([]);
    expect(saveNpcInventory(state, 'alin', sample)).toBe(true);
    let persisted = JSON.parse(state.npcStates.alin!) as Record<string, unknown>;
    expect(persisted.legacyRaw).toBe(invalidLegacyJson);
    expect(loadNpcInventory(state, 'alin')).toEqual(sample);

    state.npcStates.xiaozhou = JSON.stringify(['legacy', 'array']);
    expect(saveNpcInventory(state, 'xiaozhou', sample)).toBe(true);
    persisted = JSON.parse(state.npcStates.xiaozhou!) as Record<string, unknown>;
    expect(persisted.legacyValue).toEqual(['legacy', 'array']);
    expect(loadNpcInventory(state, 'xiaozhou')).toEqual(sample);
  });

  it('preserves a malformed previous competitionInventory payload when replacing it', () => {
    const state = createNewGame(12);
    const previous = { unexpected: 'old payload' };
    state.npcStates.alin = JSON.stringify({ competitionInventory: previous, relationship: { player: 1 } });

    expect(loadNpcInventory(state, 'alin')).toEqual([]);
    expect(saveNpcInventory(state, 'alin', sample)).toBe(true);
    const persisted = JSON.parse(state.npcStates.alin!) as Record<string, unknown>;
    expect(persisted.legacyCompetitionInventory).toEqual(previous);
    expect(persisted.relationship).toEqual({ player: 1 });
    expect(persisted.competitionInventory).toEqual(sample);
  });

  it('rejects invalid inputs without writing or initializing missing maps', () => {
    const state = createNewGame(13);
    const invalidInputs: unknown[] = [
      null,
      {},
      [{ itemId: 'unobtainium', quantity: 1 }],
      [{ itemId: 'battery', quantity: 0 }],
      [{ itemId: 'battery', quantity: -1 }],
      [{ itemId: 'battery', quantity: 1.5 }],
      [{ itemId: 'battery', quantity: Number.MAX_SAFE_INTEGER + 1 }],
      [{ itemId: 'battery', quantity: 100 }],
      [{ itemId: 'flashlight', quantity: 2 }],
      [{ itemId: 'battery', quantity: 1, meta: 'not-an-object' }],
      [{ itemId: 'battery', quantity: 1, meta: { durability: 2 } }],
      [{ itemId: 'battery', quantity: 1, meta: { bad: undefined } }],
    ];
    const stateBefore = JSON.stringify(state);
    for (const candidate of invalidInputs) {
      expect(saveNpcInventory(state, 'alin', candidate as readonly InventoryStack[])).toBe(false);
      expect(JSON.stringify(state)).toBe(stateBefore);
    }
    expect(saveNpcInventory(state, '', sample)).toBe(false);
    expect(JSON.stringify(state)).toBe(stateBefore);

    const oldState = createNewGame(14) as unknown as { npcStates?: Record<string, string> };
    delete oldState.npcStates;
    expect(saveNpcInventory(oldState as unknown as GameState, 'alin', [{ itemId: 'bogus', quantity: 1 } as unknown as InventoryStack])).toBe(false);
    expect(oldState.npcStates).toBeUndefined();
  });

  it('returns a deep copy so caller mutations cannot alter saved or later-loaded state', () => {
    const state = createNewGame(15);
    expect(saveNpcInventory(state, 'alin', sample)).toBe(true);

    const firstRead = loadNpcInventory(state, 'alin');
    firstRead[0]!.quantity = 77;
    firstRead[1]!.meta!.charge = 'empty';
    firstRead.push({ itemId: 'wood', quantity: 1 });

    expect(loadNpcInventory(state, 'alin')).toEqual(sample);
  });

  it('treats NPC IDs as own data keys, including prototype-special names', () => {
    const state = createNewGame(17);
    expect(saveNpcInventory(state, '__proto__', sample)).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(state.npcStates, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(state.npcStates)).toBe(Object.prototype);
    expect(loadNpcInventory(state, '__proto__')).toEqual(sample);

    Object.setPrototypeOf(state.npcStates, {
      inheritedNpc: JSON.stringify({ competitionInventory: sample }),
    });
    expect(loadNpcInventory(state, 'inheritedNpc')).toEqual([]);
    expect(saveNpcInventory(state, 'inheritedNpc', sample)).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(state.npcStates, 'inheritedNpc')).toBe(true);
    expect(loadNpcInventory(state, 'inheritedNpc')).toEqual(sample);
  });

  it('keeps repeated writes byte-stable', () => {
    const state = createNewGame(16);
    expect(saveNpcInventory(state, 'alin', sample)).toBe(true);
    const firstWrite = state.npcStates.alin;
    expect(saveNpcInventory(state, 'alin', sample)).toBe(true);
    expect(state.npcStates.alin).toBe(firstWrite);
  });
});
