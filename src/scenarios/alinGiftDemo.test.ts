import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNewGame } from '../core/gameState';
import type { GameState } from '../core/gameTypes';
import { createNpcState } from '../data/npcPersonalities';
import { getNpc, NPC_FLOOR } from '../data/npcs';
import type { NpcObservation } from '../ai/types';
import { LocalPersonaBrain } from '../ai/brains/localPersonaBrain';
import { loadNpcInventory } from '../systems/NpcInventory';
import { loadCompetitionNpcMemory } from '../systems/CompetitionNpcMemoryStore';
import { loadNpcState, recordMemory, saveNpcState } from '../systems/NpcMemory';
import { deserialize, serialize } from '../systems/SaveSystem';
import * as competitionMemoryStore from '../systems/CompetitionNpcMemoryStore';
import { actualGiftDeltaOf, runAlinGiftScenario } from './alinGiftDemo';

afterEach(() => vi.restoreAllMocks());

function atAlin(seed = 73): GameState {
  const game = createNewGame(seed);
  game.currentFloor = NPC_FLOOR;
  game.player.x = getNpc('alin').x;
  return game;
}

function addTrust(game: GameState, value: number): void {
  const npc = createNpcState('ally');
  npc.relationship.player = value;
  saveNpcState(game, 'alin', npc);
}

function count(game: GameState, itemId: string): number {
  return game.player.inventory.slots
    .filter((stack) => stack.itemId === itemId)
    .reduce((total, stack) => total + stack.quantity, 0);
}

type LegacyGame = Omit<GameState, 'npcStates'> & { npcStates?: Record<string, string> };

describe('阿林赠礼场景适配', () => {
  it('原子转移玩家库存到 NPC，并按现有 gift 记忆规则更新信任和双层记忆', async () => {
    const game = atAlin();
    game.gameMinuteOfDay = 361.3493000000001;
    game.player.inventory.slots.push({ itemId: 'clean_water', quantity: 2 });
    const before = count(game, 'clean_water');

    const expectedNpc = createNpcState('ally');
    expectedNpc.relationship.player = 35;
    const expectedTrust = recordMemory(expectedNpc, {
      day: game.day,
      minute: Math.floor(game.gameMinuteOfDay),
      kind: 'gift',
      actor: 'player',
      summary: '玩家赠送净水×1',
    }).relationship.player;

    const result = await runAlinGiftScenario(game, 'clean_water');
    const persisted = loadNpcState(game, 'alin');
    const delta = actualGiftDeltaOf(result);

    expect(result.status).toBe('executed');
    expect(result.validation).toMatchObject({ accepted: true, reason: 'ok' });
    expect(result.execution?.status).toBe('completed');
    expect(count(game, 'clean_water')).toBe(before - 1);
    expect(loadNpcInventory(game, 'alin')).toEqual([{ itemId: 'clean_water', quantity: 1 }]);
    expect(JSON.parse(game.npcStates.alin!).competitionInventory).toEqual([{ itemId: 'clean_water', quantity: 1 }]);
    expect(result.after.npcs[0]?.inventory).toEqual([{ itemId: 'clean_water', quantity: 1 }]);
    expect(persisted?.relationship.player).toBe(expectedTrust);
    expect(persisted?.memory.at(-1)).toMatchObject({ kind: 'gift', actor: 'player', summary: '玩家赠送净水×1' });
    expect(persisted?.memory.at(-1)?.minute).toBe(361);
    expect(loadCompetitionNpcMemory(game, 'alin')).toHaveLength(1);
    expect(delta?.memoryAdded).toHaveLength(1);
    expect(delta?.inventory).toEqual([
      { owner: 'player', itemId: 'clean_water', quantityDelta: -1 },
      { owner: { kind: 'npc', npcId: 'alin' }, itemId: 'clean_water', quantityDelta: 1 },
    ]);
    expect(result.beforeHash).not.toBe(result.afterHash);
  });

  it('拒绝玩家没有的物品时不改变库存、NPC关系或记忆', async () => {
    const game = atAlin(74);
    addTrust(game, 35);
    const playerBefore = structuredClone(game.player.inventory.slots);
    const npcBefore = loadNpcInventory(game, 'alin');
    const savedNpcBefore = game.npcStates.alin;

    const result = await runAlinGiftScenario(game, 'wood');

    expect(result.status).toBe('blocked');
    expect(result.validation).toMatchObject({ accepted: false, reason: 'missing_item' });
    expect(game.player.inventory.slots).toEqual(playerBefore);
    expect(loadNpcInventory(game, 'alin')).toEqual(npcBefore);
    expect(game.npcStates.alin).toBe(savedNpcBefore);
    expect(loadNpcState(game, 'alin')?.relationship.player).toBe(35);
    expect(loadNpcState(game, 'alin')?.memory).toEqual([]);
    expect(loadCompetitionNpcMemory(game, 'alin')).toEqual([]);
    expect(result.beforeHash).toBe(result.afterHash);
  });

  it('存档重载并跨日后保留赠礼库存、关系和记忆，后续赠礼继续更新', async () => {
    const game = atAlin(75);
    game.player.inventory.slots.push({ itemId: 'clean_water', quantity: 2 });
    const first = await runAlinGiftScenario(game, 'clean_water');
    expect(first.status).toBe('executed');

    const loaded = deserialize(serialize(game));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error('valid save should load');
    const reloaded = loaded.state;
    reloaded.day += 1;
    expect(loadNpcInventory(reloaded, 'alin')).toEqual([{ itemId: 'clean_water', quantity: 1 }]);
    expect(JSON.parse(reloaded.npcStates.alin!).competitionInventory).toEqual([{ itemId: 'clean_water', quantity: 1 }]);
    expect(loadCompetitionNpcMemory(reloaded, 'alin')).toHaveLength(1);

    const persistedNpc = loadNpcState(reloaded, 'alin');
    expect(persistedNpc).not.toBeNull();
    if (!persistedNpc) throw new Error('persisted NPC state should load');
    const dayTwoObservation: NpcObservation = {
      npcId: 'alin',
      archetype: persistedNpc.archetype,
      traits: persistedNpc.traits,
      memory: persistedNpc.memory,
      relationship: persistedNpc.relationship,
      goal: persistedNpc.goal,
      mood: persistedNpc.mood,
      world: { day: reloaded.day, floor: NPC_FLOOR, gameMinute: 360, night: false },
      self: { floor: NPC_FLOOR, x: getNpc('alin').x, hp: 100 },
      availableActions: ['dialogue'],
      recentEvents: [],
    };
    const brain = new LocalPersonaBrain();
    const remembersGift = await brain.decide(dayTwoObservation);
    const withoutMemory = await brain.decide({ ...dayTwoObservation, memory: [] });
    expect(remembersGift).toMatchObject({
      action: { type: 'dialogue', text: expect.stringContaining('你之前帮了我') },
    });
    expect(withoutMemory).toMatchObject({
      action: { type: 'dialogue', text: expect.stringContaining('有你帮衬') },
    });

    const second = await runAlinGiftScenario(reloaded, 'clean_water');
    expect(second.status).toBe('executed');
    expect(loadNpcInventory(reloaded, 'alin')).toEqual([{ itemId: 'clean_water', quantity: 2 }]);
    expect(loadCompetitionNpcMemory(reloaded, 'alin').map((entry) => entry.day)).toEqual([1, 2]);
    expect(loadNpcState(reloaded, 'alin')?.memory.map((entry) => entry.day)).toEqual([1, 2]);
  });

  it('competition 记忆暂存写入失败时回滚双方库存、信任与两层记忆', async () => {
    const game = atAlin(77);
    addTrust(game, 35);
    game.player.inventory.slots.push({ itemId: 'clean_water', quantity: 2 });
    const rawNpcBefore = game.npcStates.alin;
    const playerBefore = structuredClone(game.player.inventory.slots);
    const saveSpy = vi.spyOn(competitionMemoryStore, 'saveCompetitionNpcMemory').mockImplementation(() => false);

    const result = await runAlinGiftScenario(game, 'clean_water');

    expect(saveSpy).toHaveBeenCalledOnce();
    expect(result.status).not.toBe('executed');
    expect(result.execution?.status).not.toBe('completed');
    expect(game.npcStates.alin).toBe(rawNpcBefore);
    expect(game.player.inventory.slots).toEqual(playerBefore);
    expect(loadNpcInventory(game, 'alin')).toEqual([]);
    expect(loadNpcState(game, 'alin')?.relationship.player).toBe(35);
    expect(loadNpcState(game, 'alin')?.memory).toEqual([]);
    expect(loadCompetitionNpcMemory(game, 'alin')).toEqual([]);
  });

  it('拒绝赠礼时不创建默认 NPC 持久状态', async () => {
    const game = atAlin(78) as LegacyGame;
    delete game.npcStates;

    const result = await runAlinGiftScenario(game as GameState, 'wood');

    expect(result.status).toBe('blocked');
    expect(result.validation).toMatchObject({ accepted: false, reason: 'missing_item' });
    expect(game.npcStates).toBeUndefined();
  });

  it('旧存档缺少 npcStates 时，成功赠礼仅在实际提交后创建兼容映射', async () => {
    const game = atAlin(81) as LegacyGame;
    delete game.npcStates;
    game.player.inventory.slots.push({ itemId: 'clean_water', quantity: 1 });
    const waterBefore = count(game as unknown as GameState, 'clean_water');

    const result = await runAlinGiftScenario(game as GameState, 'clean_water');

    expect(result.status).toBe('executed');
    const persistedGame = game as unknown as GameState;
    expect(persistedGame.npcStates.alin).toBeDefined();
    expect(count(persistedGame, 'clean_water')).toBe(waterBefore - 1);
    expect(loadNpcInventory(persistedGame, 'alin')).toEqual([{ itemId: 'clean_water', quantity: 1 }]);
  });

  it('保留损坏的历史 NPC 字节并安全拒绝，不伪装成已赠礼', async () => {
    const game = atAlin(76);
    const legacy = '{broken npc state';
    game.npcStates.alin = legacy;
    game.player.inventory.slots.push({ itemId: 'wood', quantity: 1 });
    const playerBefore = structuredClone(game.player.inventory.slots);

    const result = await runAlinGiftScenario(game, 'wood');

    expect(result.status).toBe('blocked');
    expect(result.validation).toMatchObject({ accepted: false, detailCode: 'invalid_npc_state' });
    expect(game.npcStates.alin).toBe(legacy);
    expect(game.player.inventory.slots).toEqual(playerBefore);
  });

  it('门关闭时保护维修库存但允许赠送其他物品', async () => {
    const game = atAlin(79);
    game.player.inventory.slots.push({ itemId: 'wood', quantity: 2 }, { itemId: 'tape', quantity: 1 });
    const inventoryBefore = structuredClone(game.player.inventory.slots);

    const blocked = await runAlinGiftScenario(game, 'wood');

    expect(blocked.status).toBe('blocked');
    expect(blocked.validation).toMatchObject({ accepted: false, detailCode: 'reserved_player_materials' });
    expect(blocked.reason).toContain('已为维修门预留');
    expect(blocked.beforeHash).toBe(blocked.afterHash);
    expect(game.player.inventory.slots).toEqual(inventoryBefore);

    const gift = await runAlinGiftScenario(game, 'clean_water');
    expect(gift.status).toBe('executed');
    expect(count(game, 'wood')).toBe(2);
    expect(count(game, 'tape')).toBe(1);
  });

  it('已访问上层的旧存档在赠礼投影中视为门已开', async () => {
    const game = atAlin(80);
    game.visitedFloors[NPC_FLOOR + 1] = { openedContainers: [], lootedItems: [], unlockedDoors: [], localEvents: [] };
    game.player.inventory.slots.push({ itemId: 'wood', quantity: 2 }, { itemId: 'tape', quantity: 1 });

    const result = await runAlinGiftScenario(game, 'wood');

    expect(result.status).toBe('executed');
    expect(result.before.gates[0]?.status).toBe('open');
    expect(result.after.gates[0]?.status).toBe('open');
  });
});
