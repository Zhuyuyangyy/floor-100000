import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import type { GameState } from '../core/gameTypes';
import { createNpcState } from '../data/npcPersonalities';
import { NPC_FLOOR } from '../data/npcs';
import { loadCompetitionNpcMemory } from '../systems/CompetitionNpcMemoryStore';
import { loadNpcState, saveNpcState } from '../systems/NpcMemory';
import { flagCount } from '../systems/WorldFlags';
import {
  ALIN_REPAIR_GATE_FLAG,
  ALIN_REPAIR_GATE_ID,
  runAlinRepairScenario,
} from './alinRepairDemo';

function atAlin(seed = 19): GameState {
  const game = createNewGame(seed);
  game.currentFloor = NPC_FLOOR;
  game.player.x = 480;
  return game;
}

function trust(game: GameState, value: number): void {
  const npc = createNpcState('ally');
  npc.relationship.player = value;
  saveNpcState(game, 'alin', npc);
}

function count(game: GameState, itemId: string): number {
  return game.player.inventory.slots
    .filter((stack) => stack.itemId === itemId)
    .reduce((total, stack) => total + stack.quantity, 0);
}

describe('阿林维修门场景适配', () => {
  it('new NPC interaction begins at trust 35; under 70 the validator rejects without state changes and labels offline-fallback', async () => {
    const game = atAlin();
    const inventoryBefore = structuredClone(game.player.inventory.slots);
    const result = await runAlinRepairScenario(game);

    expect(result.decisionSource).toBe('offline-fallback');
    expect(result.observation.world.npcs[0]?.trust).toBe(35);
    expect(loadNpcState(game, 'alin')?.relationship.player).toBe(35);
    expect(result.status).toBe('blocked');
    expect(result.validation).toMatchObject({ accepted: false, reason: 'low_trust' });
    expect(result.feedback[0]?.outcome).toBe('validation_rejected');
    expect(result.attempts).toBe(2); // fresh observe/plan after rejection, then safely abstains
    expect(game.player.inventory.slots).toEqual(inventoryBefore);
    expect(result.after.gates[0]).toMatchObject({ gateId: ALIN_REPAIR_GATE_ID, status: 'closed' });
    expect(flagCount(game, ALIN_REPAIR_GATE_FLAG)).toBe(0);
    expect(result.before.npcs[0]?.inventory).toEqual([]);
    expect(result.after.npcs[0]?.inventory).toEqual([]);
    expect(result.before.npcs[0]?.memory).toEqual([]);
    expect(result.after.npcs[0]?.memory).toEqual([]);
    expect(result.beforeHash).toBe(result.afterHash);
  });

  it('trust 70 still cannot repair when no exact recipe is configured; inventory, memory, trust, gate and flags stay unchanged', async () => {
    const game = atAlin();
    trust(game, 70);
    game.player.inventory.slots.push({ itemId: 'wood', quantity: 2 });
    const inventoryBefore = structuredClone(game.player.inventory.slots);
    const result = await runAlinRepairScenario(game);

    expect(result.observation.world.npcs[0]?.trust).toBe(70);
    expect(result.status).toBe('blocked');
    expect(result.validation).toMatchObject({ accepted: false, detailCode: 'repair_materials_unconfigured' });
    expect(result.reason).toContain('配方未配置');
    expect(game.player.inventory.slots).toEqual(inventoryBefore);
    expect(loadNpcState(game, 'alin')?.relationship.player).toBe(70);
    expect(loadCompetitionNpcMemory(game, 'alin')).toEqual([]);
    expect(result.after.gates[0]?.status).toBe('closed');
    expect(flagCount(game, ALIN_REPAIR_GATE_FLAG)).toBe(0);
    expect(result.beforeHash).toBe(result.afterHash);
  });

  it('with an explicit test-supplied exact recipe and trust 70, executor consumes only configured materials, opens the scenario gate flag and preserves memory/trust', async () => {
    const game = atAlin(21);
    trust(game, 70);
    game.player.inventory.slots.push({ itemId: 'wood', quantity: 2 });
    const woodBefore = count(game, 'wood');
    const result = await runAlinRepairScenario(game, {
      // Test fixture only; the game scene deliberately supplies no recipe.
      policy: { repairMaterials: [{ itemId: 'wood', quantity: 2 }] },
    });

    expect(result.status).toBe('executed');
    expect(result.validation).toMatchObject({ accepted: true, reason: 'ok' });
    expect(result.execution?.status).toBe('completed');
    if (result.execution?.status === 'completed') {
      expect(result.execution.actualStateDelta.gateStatus).toEqual([
        { gateId: ALIN_REPAIR_GATE_ID, from: 'closed', to: 'open' },
      ]);
    }
    expect(count(game, 'wood')).toBe(woodBefore - 2);
    expect(result.after.gates[0]?.status).toBe('open');
    expect(flagCount(game, ALIN_REPAIR_GATE_FLAG)).toBe(1);
    expect(loadNpcState(game, 'alin')?.relationship.player).toBe(70);
    expect(result.after.npcs[0]?.inventory).toEqual([]);
    expect(loadCompetitionNpcMemory(game, 'alin')).toEqual([]);
    expect(result.beforeHash).not.toBe(result.afterHash);
    // This demonstration flag records the door status; it deliberately does not unlock TowerNav.
    expect(game.currentFloor).toBe(NPC_FLOOR);
  });

  it('reads old saves with no flags or NPC record without adding mandatory schema fields', async () => {
    type LegacyGame = Omit<GameState, 'flags' | 'npcStates'> & { flags?: Record<string, number>; npcStates?: Record<string, string> };
    const game = atAlin() as LegacyGame;
    delete game.flags;
    delete game.npcStates;

    const result = await runAlinRepairScenario(game as GameState);
    expect(result.observation.world.flags).toEqual({});
    expect(result.observation.world.npcs[0]?.trust).toBe(35);
    expect(result.status).toBe('blocked');
    expect(game.flags).toBeUndefined();
    const initializedNpcStates = (game as unknown as { npcStates?: Record<string, string> }).npcStates;
    expect(initializedNpcStates?.alin).toBeDefined();
    expect(game.schemaVersion).toBe(2);
  });
});
