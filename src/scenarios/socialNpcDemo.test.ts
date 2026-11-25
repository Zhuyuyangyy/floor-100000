import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { runSocialGiftScenario, socialWorldSnapshot, SOCIAL_NPC_IDS } from './socialNpcDemo';
import { loadNpcInventory } from '../systems/NpcInventory';
import { loadNpcState } from '../systems/NpcMemory';
import { loadCompetitionNpcMemory } from '../systems/CompetitionNpcMemoryStore';
import { serializeSocialGiftRun } from '../ai/competitionRunExport';
import { NPC_FLOOR } from '../data/npcs';
import { COMPETITION_TRUST_BASE } from '../ai/competitionRules';

function gameWith(items: Array<{ itemId: 'wood' | 'tape' | 'bread' | 'ration_pack'; quantity: number }>) {
  const game = createNewGame(42);
  game.currentFloor = NPC_FLOOR;
  // 阿林 x=480，小周 x=800；站中间，两人都在 INTERACT_DISTANCE(44) 外。
  // 赠礼场景不校验距离以外的移动，因此这里靠近阿林即可覆盖主路径。
  game.player.x = 470;
  game.player.inventory.slots = items.map((stack) => ({ ...stack }));
  return game;
}

describe('多 NPC 场景：快照完整性', () => {
  it('快照同时包含阿林与小周，各自独立', () => {
    const world = socialWorldSnapshot(gameWith([{ itemId: 'wood', quantity: 2 }]));
    expect(world.npcs.map((n) => n.npcId)).toEqual([...SOCIAL_NPC_IDS]);
    for (const npc of world.npcs) {
      expect(npc.trust).toBe(COMPETITION_TRUST_BASE);
      expect(npc.inventory).toEqual([]);
      expect(npc.memory).toEqual([]);
    }
  });

  it('两 NPC 的 x 坐标不同（来自 NPC 定义，不是硬编码）', () => {
    const world = socialWorldSnapshot(gameWith([]));
    const alin = world.npcs.find((n) => n.npcId === 'alin')!;
    const zhou = world.npcs.find((n) => n.npcId === 'xiaozhou')!;
    expect(alin.position.x).not.toBe(zhou.position.x);
  });
});

describe('多 NPC 场景：赠礼落盘', () => {
  it('给阿林赠礼：玩家木材减少、阿林库存增加、信任上升', async () => {
    const game = gameWith([{ itemId: 'wood', quantity: 3 }, { itemId: 'tape', quantity: 1 }]);
    const result = await runSocialGiftScenario(game, 'alin', 'wood', 1);

    expect(result.status).toBe('executed');
    expect(game.player.inventory.slots.find((s) => s.itemId === 'wood')?.quantity).toBe(2);
    expect(loadNpcInventory(game, 'alin')).toEqual([{ itemId: 'wood', quantity: 1 }]);
    expect(loadNpcState(game, 'alin')?.relationship.player).toBe(COMPETITION_TRUST_BASE + 13);
    expect(result.beforeHash).not.toBe(result.afterHash);
  });

  it('关键隔离：给阿林赠礼绝不改变小周的信任、库存与记忆', async () => {
    const game = gameWith([{ itemId: 'wood', quantity: 3 }]);
    await runSocialGiftScenario(game, 'alin', 'wood', 1);

    // 小周必须完全没被触碰——连存档记录都不该被创建。
    expect(loadNpcState(game, 'xiaozhou')).toBeNull();
    expect(loadNpcInventory(game, 'xiaozhou')).toEqual([]);
    expect(loadCompetitionNpcMemory(game, 'xiaozhou')).toEqual([]);
  });

  it('给小周赠礼同样独立：阿林不受影响', async () => {
    const game = gameWith([{ itemId: 'bread', quantity: 2 }]);
    // 小周在 x=800；先靠近他。
    game.player.x = 790;
    const result = await runSocialGiftScenario(game, 'xiaozhou', 'bread', 1);

    expect(result.status).toBe('executed');
    expect(loadNpcInventory(game, 'xiaozhou')).toEqual([{ itemId: 'bread', quantity: 1 }]);
    expect(loadNpcState(game, 'xiaozhou')?.relationship.player).toBe(COMPETITION_TRUST_BASE + 13);
    // 阿林零变化。
    expect(loadNpcState(game, 'alin')).toBeNull();
    expect(loadNpcInventory(game, 'alin')).toEqual([]);
  });

  it('两人各自累积，互不覆盖', async () => {
    const game = gameWith([{ itemId: 'wood', quantity: 2 }, { itemId: 'bread', quantity: 2 }]);
    await runSocialGiftScenario(game, 'alin', 'wood', 1);
    game.player.x = 790;
    await runSocialGiftScenario(game, 'xiaozhou', 'bread', 1);

    expect(loadNpcInventory(game, 'alin')).toEqual([{ itemId: 'wood', quantity: 1 }]);
    expect(loadNpcInventory(game, 'xiaozhou')).toEqual([{ itemId: 'bread', quantity: 1 }]);
    expect(loadNpcState(game, 'alin')?.relationship.player).toBe(48);
    expect(loadNpcState(game, 'xiaozhou')?.relationship.player).toBe(48);
  });

  it('背包没有该物品时拒绝，且两个 NPC 都不变', async () => {
    const game = gameWith([{ itemId: 'tape', quantity: 1 }]);
    const result = await runSocialGiftScenario(game, 'alin', 'wood', 1);
    expect(result.status).toBe('blocked');
    expect(result.beforeHash).toBe(result.afterHash);
    expect(loadNpcState(game, 'alin')).toBeNull();
  });

  it('不在第 2 层时直接拒绝，不产生副作用', async () => {
    const game = gameWith([{ itemId: 'wood', quantity: 2 }]);
    game.currentFloor = 1;
    const result = await runSocialGiftScenario(game, 'alin', 'wood', 1);
    expect(result.status).toBe('blocked');
    expect(result.reason).toContain('不在当前楼层');
    expect(game.player.inventory.slots.find((s) => s.itemId === 'wood')?.quantity).toBe(2);
  });

  it('同一 NPC 连续两次赠礼，记忆累积而非覆盖', async () => {
    const game = gameWith([{ itemId: 'wood', quantity: 4 }]);
    await runSocialGiftScenario(game, 'alin', 'wood', 1);
    await runSocialGiftScenario(game, 'alin', 'wood', 1);
    const memories = loadCompetitionNpcMemory(game, 'alin');
    expect(memories.length).toBe(2);
    expect(new Set(memories.map((m) => m.memoryId)).size).toBe(2);
    expect(loadNpcInventory(game, 'alin')).toEqual([{ itemId: 'wood', quantity: 2 }]);
  });

  // 回归：npcStates[npcId] 是单个 JSON blob，saveNpcState 会整体覆盖它，
  // 把 competitionInventory / competitionMemory 一起抹掉。这三类字段必须
  // 在任意次写入后同时存活，顺序错了就会「库存归零但信任涨了」。
  it('三次赠礼后通用状态、库存、记忆三者同时存活', async () => {
    const game = gameWith([{ itemId: 'wood', quantity: 5 }]);
    for (let i = 0; i < 3; i += 1) {
      await runSocialGiftScenario(game, 'alin', 'wood', 1);
    }

    const npc = loadNpcState(game, 'alin');
    expect(npc).not.toBeNull();
    expect(npc?.relationship.player).toBe(COMPETITION_TRUST_BASE + 13 * 3);
    // 通用记忆（recordMemory 写入的 gift 条目）与竞赛记忆是两套，都要在。
    expect(npc?.memory.length).toBe(3);
    expect(loadNpcInventory(game, 'alin')).toEqual([{ itemId: 'wood', quantity: 3 }]);
    expect(loadCompetitionNpcMemory(game, 'alin').length).toBe(3);
    expect(game.player.inventory.slots.find((s) => s.itemId === 'wood')?.quantity).toBe(2);
  });

  // 回归：写盘失败必须整体回滚，不能出现「物品扣了、NPC 没收到」。
  it('落盘失败时玩家背包与 NPC 记录都完全回滚', async () => {
    const game = gameWith([{ itemId: 'wood', quantity: 2 }]);
    // 冻结的 npcStates 在严格模式下写入即抛错，模拟写盘失败。
    const frozen = Object.freeze({}) as Record<string, string>;
    Object.defineProperty(game, 'npcStates', {
      configurable: true,
      enumerable: true,
      get: () => frozen,
      set: () => { throw new Error('disk_full'); },
    });

    const result = await runSocialGiftScenario(game, 'alin', 'wood', 1);

    expect(result.status).not.toBe('executed');
    expect(game.player.inventory.slots.find((s) => s.itemId === 'wood')?.quantity).toBe(2);
    expect(result.beforeHash).toBe(result.afterHash);
  });

  // 导出器是评审核对「到底谁被改变了」的证据文件，场景名必须诚实：
  // 把小周的结果标成 alin-gift 等于伪造归档。用真实运行结果直接验。
  it('导出的小周结果标记为 social-gift，且只包含小周的记忆', async () => {
    const game = gameWith([{ itemId: 'bread', quantity: 2 }]);
    game.player.x = 790;
    const result = await runSocialGiftScenario(game, 'xiaozhou', 'bread', 1);

    const output = JSON.parse(serializeSocialGiftRun(result));
    expect(output).toMatchObject({ format: 'floor-100000-competition-run', scenario: 'social-gift' });
    expect(output.status).toBe('executed');
    expect(output.world.stateAfter.player.inventory).toEqual([{ itemId: 'bread', quantity: 1 }]);
    // 小周收到面包；阿林零变化——快照里两人都在，但只有小周的库存变了。
    const npcAfter = output.world.stateAfter.npcs as Array<{ npcId: string; inventory: unknown[] }>;
    expect(npcAfter.find((n) => n.npcId === 'xiaozhou')?.inventory).toEqual([{ itemId: 'bread', quantity: 1 }]);
    expect(npcAfter.find((n) => n.npcId === 'alin')?.inventory).toEqual([]);
    // 同一份结果重复导出必须逐字节一致。
    expect(serializeSocialGiftRun(result)).toBe(serializeSocialGiftRun(result));
  });
});