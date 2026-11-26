// AI-06：NPC 自主 tick 的行为测试。
//
// 这里测的是**机制**，不是表演：
// - 触发源必须是世界事件（停电阶段变化 / 跨整点），不是玩家按 E；
// - 同一 NPC 同一阶段最多一次，重复触发不再执行、不再扣库存；
// - 存档重载后「已经做过」这件事不丢；
// - 来源标记如实：模型提的被规则拒了，就不能标成 model；
// - 模型请求有上限，绝不每帧调用。

import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import type { GameState } from '../core/gameTypes';
import { getNpc, NPC_FLOOR } from '../data/npcs';
import { ALIN_REPAIR_GATE_FLAG } from '../data/floorGates';
import { blackoutStageOf } from '../data/blackoutCrisis';
import { syncBlackoutCrisis } from '../scenarios/blackoutCrisis';
import { countItem } from './InventorySystem';
import { loadNpcInventory, saveNpcInventory } from './NpcInventory';
import { loadNpcState } from './NpcMemory';
import { loadCompetitionNpcMemory } from './CompetitionNpcMemoryStore';
import { setFlag } from './WorldFlags';
import {
  detectNpcAutonomyTrigger,
  hasAutonomyActed,
  initNpcAutonomyCursor,
  NPC_AUTONOMY_ACTOR,
  NPC_AUTONOMY_FLAG,
  npcAutonomyThrottled,
  protectedQuantityOf,
  runNpcAutonomyTick,
  type NpcAutonomyCursor,
  type NpcAutonomyModelPort,
} from './NpcWorldTick';

// ── 夹具 ────────────────────────────────────────────────────────────────────

/** 门已开、停电危机已经启动（阶段 investigating）的一天。 */
function crisisGame(seed = 2026): GameState {
  const game = createNewGame(seed);
  game.currentFloor = NPC_FLOOR;
  game.player.x = getNpc('alin').x;
  setFlag(game, ALIN_REPAIR_GATE_FLAG, 1);
  const sync = syncBlackoutCrisis(game);
  expect(sync.stage).toBe('investigating');
  return game;
}

/** 危机启动**之前**的游标：用来制造一次「阶段变化」这个世界事件。 */
const BEFORE_CRISIS: NpcAutonomyCursor = { stage: 'initial', hour: 0 };

function autonomyMemories(game: GameState, npcId: 'alin' | 'azhen' | 'xiaozhou'): string[] {
  return (loadNpcState(game, npcId)?.memory ?? [])
    .filter((entry) => entry.actor === NPC_AUTONOMY_ACTOR)
    .map((entry) => entry.summary);
}

function itemCount(stacks: readonly { itemId: string; quantity: number }[], itemId: string): number {
  return stacks.filter((stack) => stack.itemId === itemId).reduce((total, stack) => total + stack.quantity, 0);
}

// ── ① 世界事件触发一次，状态真的变了 ────────────────────────────────────────

describe('AI-06：世界事件触发一次且状态真的变了', () => {
  it('停电阶段变化 → 居民自主行动，记忆里留下 actor=world_tick', async () => {
    const game = crisisGame();
    expect(blackoutStageOf(game)).toBe('investigating');

    const run = await runNpcAutonomyTick(game, { cursor: BEFORE_CRISIS });

    expect(run.result.actor).toBe('world_tick');
    expect(run.result.trigger).toBe('blackout_stage');
    expect(run.result.status).toBe('executed');
    expect(run.result.outcomes.length).toBeGreaterThan(0);

    // 阿林是维修工：危机开始后他该先清点材料，而不是等玩家来问。
    const alin = run.result.outcomes.find((outcome) => outcome.npcId === 'alin');
    expect(alin?.action).toBe('repair_prep');
    expect(alin?.status).toBe('executed');

    // 状态真的变了：他的持久记忆里多了一条 actor=world_tick 的自主记忆。
    expect(autonomyMemories(game, 'alin').length).toBe(1);
    // 结构化记忆里也留下了这次自主行为的机器可读记录。
    const facts = loadCompetitionNpcMemory(game, 'alin');
    expect(facts.some((entry) => entry.kind === 'fact' && entry.subject === 'autonomy_repair_prep')).toBe(true);
    // 目标也变了：他现在的目标是准备维修。
    expect(loadNpcState(game, 'alin')?.goal).toContain('维修');
    // 幂等标记落库了。
    expect(hasAutonomyActed(game, 'alin', 'investigating')).toBe(true);
    expect(game.flags?.[NPC_AUTONOMY_FLAG.handled('alin', 'investigating')]).toBe(1);
  });

  it('没有世界事件就不动：同阶段同一时刻重复调用不会触发', async () => {
    const game = crisisGame();
    const cursor = initNpcAutonomyCursor(game);

    expect(detectNpcAutonomyTrigger(game, cursor)).toBeNull();
    const run = await runNpcAutonomyTick(game, { cursor });
    expect(run.result.status).toBe('no_trigger');
    expect(run.result.outcomes).toHaveLength(0);
    expect(autonomyMemories(game, 'alin')).toHaveLength(0);
  });

  it('游戏小时边界也是世界事件：跨整点会触发一次', async () => {
    const game = crisisGame();
    const cursor = initNpcAutonomyCursor(game);
    game.gameMinuteOfDay = (cursor.hour + 1) * 60 + 5;

    expect(detectNpcAutonomyTrigger(game, cursor)).toBe('hour_boundary');
  });
});

// ── ② 重复触发不再执行 ──────────────────────────────────────────────────────

describe('AI-06：幂等与节流', () => {
  it('同一 NPC 同一阶段最多一次：重复触发不再执行、不再改状态', async () => {
    const game = crisisGame();
    const first = await runNpcAutonomyTick(game, { cursor: BEFORE_CRISIS });
    expect(first.result.status).toBe('executed');

    const memoryBefore = loadCompetitionNpcMemory(game, 'alin').length;
    const goalBefore = loadNpcState(game, 'alin')?.goal;

    // 一小时后再来一次世界事件（跨整点）。节流窗口已过，但「本阶段已处理」的
    // 标记还在，所以谁都不该再动。
    game.gameMinuteOfDay = (initNpcAutonomyCursor(game).hour + 1) * 60;
    const second = await runNpcAutonomyTick(game, { cursor: { ...first.cursor } });

    expect(second.result.trigger).toBe('hour_boundary');
    expect(second.result.outcomes).toHaveLength(0);
    expect(loadCompetitionNpcMemory(game, 'alin').length).toBe(memoryBefore);
    expect(loadNpcState(game, 'alin')?.goal).toBe(goalBefore);
  });

  it('存档重载后已处理标记还在：不会重复执行', async () => {
    const game = crisisGame();
    await runNpcAutonomyTick(game, { cursor: BEFORE_CRISIS });
    expect(hasAutonomyActed(game, 'alin', 'investigating')).toBe(true);

    // 模拟重载：只留存档里的字段。
    const reloaded = JSON.parse(JSON.stringify(game)) as GameState;
    expect(hasAutonomyActed(reloaded, 'alin', 'investigating')).toBe(true);
    // 重载后第一轮留下的自主记忆仍在（存档带走了），但不会**再多**一条。
    const memoriesAfterReload = autonomyMemories(reloaded, 'alin').length;
    expect(memoriesAfterReload).toBe(1);

    reloaded.gameMinuteOfDay = (initNpcAutonomyCursor(reloaded).hour + 1) * 60;
    const run = await runNpcAutonomyTick(reloaded, { cursor: { stage: 'investigating', hour: 20 } });
    expect(run.result.outcomes).toHaveLength(0);
    expect(autonomyMemories(reloaded, 'alin')).toHaveLength(memoriesAfterReload);
  });

  it('节流：上一轮刚跑过就再触发，不会调用模型也不会改状态', async () => {
    const game = crisisGame();
    let modelCalls = 0;
    const port: NpcAutonomyModelPort = async (input) => {
      modelCalls += 1;
      return { kind: 'request_help', npcId: input.npcId };
    };

    const first = await runNpcAutonomyTick(game, { cursor: BEFORE_CRISIS, proposeWithModel: port });
    expect(first.result.status).toBe('executed');
    expect(modelCalls).toBeGreaterThan(0);

    // 同一时刻立刻再来一次：被节流挡下。
    expect(npcAutonomyThrottled(game)).toBe(true);
    const callsBefore = modelCalls;
    const second = await runNpcAutonomyTick(game, { cursor: { stage: 'investigating', hour: 20 }, proposeWithModel: port });
    expect(second.result.status).toBe('throttled');
    expect(second.result.modelCalls).toBe(0);
    expect(modelCalls).toBe(callsBefore);
  });

  it('绝不每帧调用模型：一轮里每个居民最多问一次', async () => {
    const game = crisisGame();
    const asked: string[] = [];
    const port: NpcAutonomyModelPort = async (input) => {
      asked.push(input.npcId);
      return { kind: 'request_help', npcId: input.npcId };
    };

    const run = await runNpcAutonomyTick(game, { cursor: BEFORE_CRISIS, proposeWithModel: port });
    expect(run.result.modelCalls).toBeLessThanOrEqual(3);
    expect(new Set(asked).size).toBe(asked.length);
  });
});

// ── ③ 来源标记 ──────────────────────────────────────────────────────────────

describe('AI-06：来源标记如实', () => {
  it('没有模型端口时标 offline-fallback，不冒充模型', async () => {
    const game = crisisGame();
    const run = await runNpcAutonomyTick(game, { cursor: BEFORE_CRISIS });

    expect(run.result.decisionSource).toBe('offline-fallback');
    for (const outcome of run.result.outcomes) {
      expect(outcome.decisionSource).toBe('offline-fallback');
      expect(outcome.actor).toBe('world_tick');
    }
  });

  it('模型提案被规则拒绝后由规则接手，来源必须改口成 offline-fallback', async () => {
    const game = crisisGame();
    // 模型想交出自己没有的东西。
    const port: NpcAutonomyModelPort = async (input) => ({
      kind: 'protect_supplies',
      npcId: input.npcId,
      itemId: 'medkit',
      quantity: 1,
    });

    const run = await runNpcAutonomyTick(game, { cursor: BEFORE_CRISIS, proposeWithModel: port, residents: ['alin'] });
    const outcome = run.result.outcomes[0];
    expect(outcome?.status).toBe('executed');
    expect(outcome?.decisionSource).toBe('offline-fallback');
    expect(run.result.decisionSource).toBe('offline-fallback');
  });

  it('模型明确说不动：规则不许代劳，世界保持不变', async () => {
    const game = crisisGame();
    const port: NpcAutonomyModelPort = async () => null;

    const run = await runNpcAutonomyTick(game, { cursor: BEFORE_CRISIS, proposeWithModel: port });
    expect(run.result.outcomes.every((outcome) => outcome.status === 'declined')).toBe(true);
    expect(autonomyMemories(game, 'alin')).toHaveLength(0);
    expect(hasAutonomyActed(game, 'alin', 'investigating')).toBe(false);
  });

  it('模型提案被接受并提交：标 model', async () => {
    const game = crisisGame();
    const port: NpcAutonomyModelPort = async (input) => (
      input.npcId === 'alin'
        ? { kind: 'repair_prep', npcId: input.npcId, utterance: '我先把配电箱拆开看看。' }
        : { kind: 'request_help', npcId: input.npcId }
    );

    const run = await runNpcAutonomyTick(game, { cursor: BEFORE_CRISIS, proposeWithModel: port });
    expect(run.result.decisionSource).toBe('model');
    const alin = run.result.outcomes.find((outcome) => outcome.npcId === 'alin');
    expect(alin?.decisionSource).toBe('model');
    expect(alin?.action).toBe('repair_prep');
  });
});

// ── ④ 状态差量与守恒 ─────────────────────────────────────────────────────────

describe('AI-06：自主行动真的改了状态，而且守恒', () => {
  it('protect_supplies：物资从居民手里交到玩家手里，总量守恒', async () => {
    const game = crisisGame();
    saveNpcInventory(game, 'xiaozhou', [{ itemId: 'battery', quantity: 4 }]);

    const run = await runNpcAutonomyTick(game, { cursor: BEFORE_CRISIS, residents: ['xiaozhou'] });
    const outcome = run.result.outcomes[0];

    expect(outcome?.action).toBe('protect_supplies');
    expect(outcome?.status).toBe('executed');
    // 差量：居民 −2、玩家 +2。
    expect(itemCount(outcome?.npcInventoryBefore ?? [], 'battery')).toBe(4);
    expect(itemCount(outcome?.npcInventoryAfter ?? [], 'battery')).toBe(2);
    expect(countItem(game.player.inventory, 'battery')).toBe(2);
    expect(itemCount(outcome?.npcInventoryAfter ?? [], 'battery') + countItem(game.player.inventory, 'battery')).toBe(4);
    // 账目也在 flag 里，可对账。
    expect(protectedQuantityOf(game, 'xiaozhou', 'battery')).toBe(2);
  });

  it('重复触发不会重复扣库存：第二次触发一件货都不动', async () => {
    const game = crisisGame();
    saveNpcInventory(game, 'xiaozhou', [{ itemId: 'battery', quantity: 4 }]);

    const first = await runNpcAutonomyTick(game, { cursor: BEFORE_CRISIS, residents: ['xiaozhou'] });
    expect(first.result.status).toBe('executed');
    expect(countItem(game.player.inventory, 'battery')).toBe(2);

    game.gameMinuteOfDay = (initNpcAutonomyCursor(game).hour + 1) * 60;
    const second = await runNpcAutonomyTick(game, { cursor: { stage: 'investigating', hour: 20 }, residents: ['xiaozhou'] });

    expect(second.result.outcomes).toHaveLength(0);
    expect(countItem(game.player.inventory, 'battery')).toBe(2);
    expect(itemCount(loadNpcInventory(game, 'xiaozhou'), 'battery')).toBe(2);
    expect(protectedQuantityOf(game, 'xiaozhou', 'battery')).toBe(2);
  });

  it('危机里正在流通的货不许被自主送出去（不能替玩家把资源分配题解了）', async () => {
    const game = crisisGame();
    // 小周的保险丝是主线的第二条来源，阿珍的面包是净水换口粮的代价。
    expect(itemCount(loadNpcInventory(game, 'xiaozhou'), 'fuse')).toBe(1);
    expect(itemCount(loadNpcInventory(game, 'azhen'), 'bread')).toBe(4);

    const run = await runNpcAutonomyTick(game, { cursor: BEFORE_CRISIS });
    for (const outcome of run.result.outcomes) {
      expect(outcome.action).not.toBe('protect_supplies');
    }
    expect(countItem(game.player.inventory, 'fuse')).toBe(0);
    expect(countItem(game.player.inventory, 'bread')).toBe(0);
  });
});

// ── ⑤ 世界版本校验 ──────────────────────────────────────────────────────────

describe('AI-06：世界版本校验', () => {
  it('模型请求期间世界变了 → 提案作废，状态不被旧提案改动', async () => {
    const game = crisisGame();
    const port: NpcAutonomyModelPort = async (input) => {
      // 模拟「模型还在算的时候玩家动了背包」。
      game.player.inventory.slots.push({ itemId: 'battery', quantity: 1 });
      return { kind: 'request_help', npcId: input.npcId };
    };

    const run = await runNpcAutonomyTick(game, { cursor: BEFORE_CRISIS, proposeWithModel: port, residents: ['alin'] });
    const outcome = run.result.outcomes[0];

    expect(outcome?.status).not.toBe('executed');
    expect(outcome?.reason).toContain('stale_world_revision');
    expect(autonomyMemories(game, 'alin')).toHaveLength(0);
  });
});
