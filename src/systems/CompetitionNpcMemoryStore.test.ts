import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import type { CompetitionNpcMemoryEntry } from '../ai/competition-contract';
import {
  createCompetitionNpcMemoryId,
  loadCompetitionNpcMemory,
  saveCompetitionNpcMemory,
} from './CompetitionNpcMemoryStore';

const entries: CompetitionNpcMemoryEntry[] = [
  { kind: 'fact', memoryId: 'fact-1', day: 1, subject: 'gate', value: 'north gate is blocked' },
  { kind: 'promise', memoryId: 'promise-1', day: 2, promise: 'bring a battery', status: 'open' },
  { kind: 'favor', memoryId: 'favor-1', day: 2, from: 'player', description: 'shared water', status: 'open' },
  { kind: 'debt', memoryId: 'debt-1', day: 3, from: { kind: 'npc', npcId: 'alin' }, description: 'owes medicine', status: 'resolved' },
];

describe('CompetitionNpcMemoryStore', () => {
  it('round-trips facts, promises, favors and debts across game days', () => {
    const state = createNewGame(47);
    for (const entry of entries) expect(saveCompetitionNpcMemory(state, 'alin', entry)).toBe(true);
    expect(loadCompetitionNpcMemory(state, 'alin')).toEqual(entries);
    expect(loadCompetitionNpcMemory(state, 'alin', 2)).toEqual(entries.slice(1, 3));
    expect(loadCompetitionNpcMemory(state, 'alin', 1)).toEqual([entries[0]]);
  });

  it('retains legacy NPC JSON fields and the existing legacy memory array on write', () => {
    const state = createNewGame(9);
    const legacyMemory = [{ id: 'old-memory', day: 1, summary: 'kept from old save' }];
    state.npcStates.alin = JSON.stringify({ archetype: 'ally', memory: legacyMemory, relationship: { player: 4 }, customFlag: 'preserve-me' });

    expect(saveCompetitionNpcMemory(state, 'alin', entries[0]!)).toBe(true);
    const persisted = JSON.parse(state.npcStates.alin!) as Record<string, unknown>;
    expect(persisted.archetype).toBe('ally');
    expect(persisted.memory).toEqual(legacyMemory);
    expect(persisted.relationship).toEqual({ player: 4 });
    expect(persisted.customFlag).toBe('preserve-me');
    expect(loadCompetitionNpcMemory(state, 'alin')).toEqual([entries[0]]);
  });

  it('safely handles absent npcStates and absent competition memory on old saves', () => {
    const state = createNewGame(3);
    const oldState = state as unknown as { npcStates?: Record<string, string> };
    delete oldState.npcStates;
    expect(loadCompetitionNpcMemory(state, 'missing')).toEqual([]);

    expect(saveCompetitionNpcMemory(state, 'new-npc', entries[0]!)).toBe(true);
    expect(loadCompetitionNpcMemory(state, 'new-npc')).toEqual([entries[0]]);
  });

  it('retains malformed legacy bytes instead of overwriting them on first write', () => {
    const state = createNewGame(11);
    const invalidLegacyJson = '{old memory bytes';
    state.npcStates.alin = invalidLegacyJson;
    expect(loadCompetitionNpcMemory(state, 'alin')).toEqual([]);
    expect(saveCompetitionNpcMemory(state, 'alin', entries[0]!)).toBe(true);
    const persisted = JSON.parse(state.npcStates.alin!) as Record<string, unknown>;
    expect(persisted.legacyRaw).toBe(invalidLegacyJson);
    expect(loadCompetitionNpcMemory(state, 'alin')).toEqual([entries[0]]);
  });

  it('normalizes bad stored entries individually without losing valid siblings', () => {
    const state = createNewGame(13);
    state.npcStates.alin = JSON.stringify({ competitionMemory: [entries[0], { kind: 'promise', memoryId: '', day: -1 }] });
    expect(loadCompetitionNpcMemory(state, 'alin')).toEqual([entries[0]]);
  });

  it('retains a malformed legacy competition memory field when appending', () => {
    const state = createNewGame(14);
    state.npcStates.alin = JSON.stringify({ competitionMemory: 'legacy payload' });
    expect(saveCompetitionNpcMemory(state, 'alin', entries[0]!)).toBe(true);
    const persisted = JSON.parse(state.npcStates.alin!) as Record<string, unknown>;
    expect(persisted.legacyCompetitionMemory).toBe('legacy payload');
    expect(loadCompetitionNpcMemory(state, 'alin')).toEqual([entries[0]]);
  });

  it('keeps NPCs and in-game dates isolated', () => {
    const state = createNewGame(17);
    expect(saveCompetitionNpcMemory(state, 'alin', entries[0]!)).toBe(true);
    expect(saveCompetitionNpcMemory(state, 'xiaozhou', entries[1]!)).toBe(true);
    expect(loadCompetitionNpcMemory(state, 'alin', 2)).toEqual([]);
    expect(loadCompetitionNpcMemory(state, 'xiaozhou', 2)).toEqual([entries[1]]);
    expect(loadCompetitionNpcMemory(state, 'xiaozhou', 1)).toEqual([]);
  });

  it('uses a stable logical ID and treats retries as idempotent', () => {
    const id = createCompetitionNpcMemoryId(47, 'npc:北', 2, 8);
    expect(createCompetitionNpcMemoryId(47, 'npc:北', 2, 8)).toBe(id);
    expect(id).not.toMatch(/undefined|NaN/);
    const state = createNewGame(47);
    const entry = { ...entries[0]!, memoryId: id };
    expect(saveCompetitionNpcMemory(state, 'alin', entry)).toBe(true);
    expect(saveCompetitionNpcMemory(state, 'alin', entry)).toBe(true);
    expect(loadCompetitionNpcMemory(state, 'alin')).toEqual([entry]);
  });

  it('does not write entries outside the structured memory contract', () => {
    const state = createNewGame(19);
    expect(saveCompetitionNpcMemory(state, 'alin', { ...entries[0]!, day: 0 } as CompetitionNpcMemoryEntry)).toBe(false);
    expect(loadCompetitionNpcMemory(state, 'alin')).toEqual([]);
  });
});
