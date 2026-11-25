// 模型提案口（proposeWithModel）的行为契约。
//
// 这个文件存在的理由，是用户指出的一处结构性缺陷：
//
//   旧实现的 `propose` 端口无条件返回 `repair_gate`。也就是说「模型说不能修」
//   这件事在结构上不可能发生——不管模型输出什么，门都会被修。模型从未真正参与
//   决策，可 UI 上看起来像是参与了的。
//
// 所以这里测的不是「功能有没有」，而是四条边界：
//   1. 模型拒绝（返回 null）→ 门必须保持关闭，且不许偷偷用 fallback 补上
//   2. 模型提案 → 仍然要过 validator，模型不能自己决定成败
//   3. 模型不可达（抛异常）→ 玩家仍能玩完（fallback 接管），但来源必须如实标注
//   4. decisionSource === 'model' 只在「模型提案 + 提交成功」同时成立时出现
//
// 第 3 条与第 1 条的区别很重要：模型「明确拒绝」和模型「挂了」是两件事。
// 前者是模型做了决定（不该修），后者是降级（规则兜底）。混为一谈会让
// Judge Mode 把降级显示成模型决策，那是骗评委。

import { describe, expect, it, vi } from 'vitest';
import { createNewGame } from '../core/gameState';
import type { GameState } from '../core/gameTypes';
import { createNpcState } from '../data/npcPersonalities';
import { NPC_FLOOR } from '../data/npcs';
import { flagCount } from '../systems/WorldFlags';
import { saveNpcState } from '../systems/NpcMemory';
import { ALIN_REPAIR_GATE_FLAG, ALIN_REPAIR_GATE_ID, runAlinRepairScenario } from './alinRepairDemo';

/** 站在阿林面前的游戏状态。信任与材料由各用例自己给。 */
function atAlin(seed = 19): GameState {
  const game = createNewGame(seed);
  game.currentFloor = NPC_FLOOR;
  game.player.x = 480;
  return game;
}

function setTrust(game: GameState, value: number): void {
  const npc = createNpcState('ally');
  npc.relationship.player = value;
  saveNpcState(game, 'alin', npc);
}

/** 让维修在客观条件上允许发生：信任够、材料齐。 */
function makeRepairPossible(game: GameState): void {
  setTrust(game, 70);
  game.player.inventory.slots.push({ itemId: 'wood', quantity: 2 });
  game.player.inventory.slots.push({ itemId: 'tape', quantity: 1 });
}

function gateStatus(result: { after: { gates: readonly { gateId: string; status: string }[] } }): string | undefined {
  return result.after.gates.find((gate) => gate.gateId === ALIN_REPAIR_GATE_ID)?.status;
}

describe('模型提案口：拒绝语义必须先于一切', () => {
  it('模型拒绝维修（返回 null）→ 门保持关闭，且不被 fallback 偷偷补上', async () => {
    const game = atAlin(21);
    makeRepairPossible(game);

    // 这就是「模型说：现在材料不足，我不能修门」在结构化层面的表达。
    const proposeWithModel = vi.fn(async () => null);
    const result = await runAlinRepairScenario(game, { proposeWithModel });

    expect(proposeWithModel).toHaveBeenCalled();
    expect(gateStatus(result)).toBe('closed');
    expect(flagCount(game, ALIN_REPAIR_GATE_FLAG)).toBe(0);
    expect(result.status).not.toBe('executed');
    // 关键：即使客观条件完全允许维修，模型说不修就是不修。
    // 如果这里失败，说明代码里还有「条件满足就自动修」的兜底路径。
    expect(result.beforeHash).toBe(result.afterHash);
  });

  it('模型拒绝时也不能把决策来源标成 model', async () => {
    const game = atAlin(21);
    makeRepairPossible(game);

    const result = await runAlinRepairScenario(game, { proposeWithModel: async () => null });
    expect(result.decisionSource).toBe('offline-fallback');
  });

  it('模型提出维修 → 仍然要过 validator，信任不够时照样被拒', async () => {
    const game = atAlin(22);
    // 材料齐但信任只有 35 —— 低于门槛 70。
    game.player.inventory.slots.push({ itemId: 'wood', quantity: 2 });
    game.player.inventory.slots.push({ itemId: 'tape', quantity: 1 });

    const proposeWithModel = vi.fn(async (input) => ({
      kind: 'repair_gate' as const,
      gateId: input.gateId,
      materials: input.materials.map((stack: { itemId: string; quantity: number }) => ({ ...stack })),
    }));
    const result = await runAlinRepairScenario(game, { proposeWithModel });

    expect(proposeWithModel).toHaveBeenCalled();
    expect(result.status).toBe('blocked');
    expect(result.validation).toMatchObject({ accepted: false, reason: 'low_trust' });
    expect(gateStatus(result)).toBe('closed');
    // 模型提了案但没成事，来源不能算模型决策。
    expect(result.decisionSource).toBe('offline-fallback');
  });

  it('模型提案 + 条件齐全 → 门真的开了，来源标成 model', async () => {
    const game = atAlin(21);
    makeRepairPossible(game);

    const proposeWithModel = vi.fn(async (input) => ({
      kind: 'repair_gate' as const,
      gateId: input.gateId,
      materials: input.materials.map((stack: { itemId: string; quantity: number }) => ({ ...stack })),
    }));
    const result = await runAlinRepairScenario(game, { proposeWithModel });

    expect(result.status).toBe('executed');
    expect(gateStatus(result)).toBe('open');
    expect(flagCount(game, ALIN_REPAIR_GATE_FLAG)).toBe(1);
    // 这是整轮改造的验收点：线上游戏里第一次由真实模型决定的合法状态改变。
    expect(result.decisionSource).toBe('model');
    expect(result.beforeHash).not.toBe(result.afterHash);
  });
});

describe('模型不可达时的降级边界', () => {
  it('模型抛异常 → fallback 接管，玩家仍能修完，但来源如实标为 offline-fallback', async () => {
    const game = atAlin(21);
    makeRepairPossible(game);

    const result = await runAlinRepairScenario(game, {
      proposeWithModel: async () => {
        throw new Error('upstream timeout');
      },
    });

    // 玩家不该因为模型挂了就卡住——这是护栏，不是作弊。
    expect(result.status).toBe('executed');
    expect(gateStatus(result)).toBe('open');
    // 但绝不能把降级冒充成模型决策：Judge Mode 显示的就是这个字段。
    expect(result.decisionSource).toBe('offline-fallback');
  });
});

describe('注入口本身的安全性', () => {
  it('模型拿不到 GameState 句柄，只能拿到只读观察与配方', async () => {
    const game = atAlin(21);
    makeRepairPossible(game);

    let captured: unknown = null;
    await runAlinRepairScenario(game, {
      proposeWithModel: async (input) => {
        captured = input;
        return null;
      },
    });

    const input = captured as Record<string, unknown>;
    expect(input).toBeTruthy();
    // 形状上只该有这四个键。多一个 game / state 之类的句柄就等于把世界交给模型。
    expect(Object.keys(input).sort()).toEqual(['gateId', 'materials', 'observation', 'previousFeedback']);
    for (const value of Object.values(input)) {
      expect(value).not.toBe(game);
    }
  });

  it('模型改不动维修配方：它只能照单申请，validator 独立核对数量', async () => {
    const game = atAlin(21);
    makeRepairPossible(game);

    const result = await runAlinRepairScenario(game, {
      // 恶意模型：声称只需要一块木头。
      proposeWithModel: async (input) => ({
        kind: 'repair_gate' as const,
        gateId: input.gateId,
        materials: [{ itemId: 'wood', quantity: 1 }],
      }),
    });

    // 配方是服务端的共享事实，不由模型给。少报材料应当被 validator 识破。
    expect(result.status).not.toBe('executed');
    expect(gateStatus(result)).toBe('closed');
  });

  it('未提供提案口时行为与改造前完全一致（离线路径不受影响）', async () => {
    const game = atAlin(21);
    makeRepairPossible(game);

    const result = await runAlinRepairScenario(game);
    expect(result.status).toBe('executed');
    expect(result.decisionSource).toBe('offline-fallback');
  });
});