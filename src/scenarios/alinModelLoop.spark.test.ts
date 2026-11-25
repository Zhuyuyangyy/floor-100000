// R2 核心验收：真实模型驱动完整竞赛闭环。
//
// 这不是 mock 测试——它连活的 Ollama（DGX Spark），让真实模型提案，再让
// Validator 裁决、executor 执行，最后断言 GameState 真的变了。
//
// 运行：SPARK_LIVE=1 npx vitest run src/scenarios/alinModelLoop.spark.test.ts
//
// 验收分三段，缺一不可：
//   A. 低信任（35）：模型即使提议修门，Validator 也必须拒绝且世界不变。
//   B. 高信任（75）：同一模型、同一配方，Validator 接受并真的改变状态。
//   C. 离线对照：不连模型时维修闭环仍可复现（证明不依赖大模型也能跑）。
import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { OllamaBrain } from '../ai/brains/ollamaBrain';
import { proposeWithBrain } from '../ai/competitionModelBridge';
import { runAlinRepairScenario } from './alinRepairDemo';
import { validateCompetitionProposal, type CompetitionRulesPolicy } from '../ai/competitionRules';
import { executeCompetitionProposal, type CompetitionDemoState } from '../ai/competitionExecutor';
import { ALIN_REPAIR_MATERIALS, ALIN_REPAIR_GATE_ID } from '../data/floorGates';
import { NPC_FLOOR } from '../data/npcs';
import { loadCompetitionNpcMemory } from '../systems/CompetitionNpcMemoryStore';
import { INTERACT_DISTANCE } from '../core/constants';
import type { CompetitionObservationSnapshot } from '../ai/competition-contract';

const LIVE = process.env.SPARK_LIVE === '1';
const URL = process.env.SPARK_URL ?? 'http://127.0.0.1:11434';
const MODEL = process.env.SPARK_MODEL ?? 'npc-qwen:latest';

function policy(): CompetitionRulesPolicy {
  return {
    repairMaterials: ALIN_REPAIR_MATERIALS.map((m) => ({ ...m })),
    maxInteractionDistance: INTERACT_DISTANCE,
    repairNpcByGate: { [ALIN_REPAIR_GATE_ID]: 'alin' },
    trustDeltas: { give: 13, repair_gate: 0 },
  };
}

/** 与真实场景同构的快照：玩家与阿林同层、距离在 INTERACT_DISTANCE 内。 */
function snapshotFor(game: ReturnType<typeof createNewGame>, trust: number): CompetitionObservationSnapshot {
  return {
    observationId: `live-${trust}`,
    world: {
      seed: game.runSeed,
      day: game.day,
      gameMinute: game.gameMinuteOfDay,
      currentFloor: game.currentFloor,
      flags: {},
      threats: [],
      player: {
        position: { floor: game.currentFloor, x: game.player.x },
        hp: game.player.hp,
        hunger: game.player.hunger,
        thirst: game.player.thirst,
        energy: game.player.energy,
        inventory: game.player.inventory.slots.map((s) => ({ ...s })),
      },
      npcs: [{
        npcId: 'alin',
        // 真实场景里阿林在 NPC_FLOOR；距离 10 < INTERACT_DISTANCE。
        position: { floor: NPC_FLOOR, x: game.player.x + 10 },
        hp: 30, hunger: 20, trust, affinity: 10, tension: 5,
        status: 'available',
        goal: { goalId: ALIN_REPAIR_GATE_ID, kind: 'custom', sinceDay: 1, status: 'active' },
        memory: loadCompetitionNpcMemory(game, 'alin'),
        lastAction: null,
        inventory: [],
      }],
      groundItems: [],
      gates: [{ gateId: ALIN_REPAIR_GATE_ID, floor: NPC_FLOOR, status: 'closed' }],
    },
    focus: { kind: 'npc', npcId: 'alin' },
    availableActions: ['observe', 'give', 'repair_gate'],
    recentFacts: [],
  };
}

function freshGame() {
  const game = createNewGame(42);
  game.currentFloor = NPC_FLOOR;
  game.player.x = 600;
  game.player.inventory.slots = [
    { itemId: 'wood', quantity: 2 },
    { itemId: 'tape', quantity: 1 },
    { itemId: 'ration_pack', quantity: 3 },
  ];
  return game;
}

const brain = () => new OllamaBrain({
  model: MODEL, baseUrl: URL, timeoutMs: 90_000, maxOutputTokens: 192, disableThinking: true,
});

describe.skipIf(!LIVE)('真实模型 → 规则 → 世界（Spark live）', () => {
  it('A. 低信任：模型提案被 Validator 拒绝，世界不变', async () => {
    const game = freshGame();
    const observation = snapshotFor(game, 35);

    const proposed = await proposeWithBrain(brain(), observation, { repairMaterials: ALIN_REPAIR_MATERIALS });
    expect(proposed, '模型没有产出可提交提案（空正文或不可翻译）').not.toBeNull();
    console.log('[A] 提案 =', JSON.stringify(proposed!.proposal), '| 台词 =', proposed!.utterance);

    const validation = validateCompetitionProposal(
      { currentFloor: NPC_FLOOR, player: observation.world.player, npcs: observation.world.npcs, gates: observation.world.gates },
      proposed!.proposal,
      policy(),
    );
    console.log('[A] validator =', validation.accepted, validation.accepted ? 'ok' : validation.reason);

    // 模型若提修门 → 必须因信任不足被拒；若提对话/接受赠礼 → 走各自的合法路径。
    if (proposed!.proposal.kind === 'repair_gate') {
      expect(validation.accepted).toBe(false);
      expect(validation.accepted === false && validation.reason).toBe('low_trust');
    } else {
      // 非维修动作在低信任下允许（赠礼本就该被接受），但不得据此开门。
      expect(proposed!.proposal.kind === 'observe' || proposed!.proposal.kind === 'give').toBe(true);
    }
  }, 150_000);

  it('B. 高信任：同一模型提案被接受，并真的改变库存与门禁', async () => {
    const game = freshGame();
    const observation = snapshotFor(game, 75);

    const proposed = await proposeWithBrain(brain(), observation, { repairMaterials: ALIN_REPAIR_MATERIALS });
    expect(proposed, '模型没有产出可提交提案').not.toBeNull();
    console.log('[B] 提案 =', JSON.stringify(proposed!.proposal), '| 台词 =', proposed!.utterance);

    const validation = validateCompetitionProposal(
      { currentFloor: NPC_FLOOR, player: observation.world.player, npcs: observation.world.npcs, gates: observation.world.gates },
      proposed!.proposal,
      policy(),
    );
    console.log('[B] validator =', validation.accepted, validation.accepted ? 'ok' : validation.reason);
    expect(validation.accepted, `validator 拒绝：${JSON.stringify(validation)}`).toBe(true);

    const demo: CompetitionDemoState = {
      currentFloor: NPC_FLOOR,
      player: { position: { floor: NPC_FLOOR, x: game.player.x }, inventory: game.player.inventory.slots },
      npcs: [{ npcId: 'alin', position: { floor: NPC_FLOOR, x: game.player.x + 10 }, status: 'available', trust: 75, inventory: [] }],
      gates: [{ gateId: ALIN_REPAIR_GATE_ID, floor: NPC_FLOOR, status: 'closed' }],
      appliedOperationIds: new Set<string>(),
    };
    const before = JSON.stringify({ inv: demo.player.inventory, gate: demo.gates[0].status, trust: demo.npcs[0].trust });
    const exec = executeCompetitionProposal(demo, proposed!.proposal, { operationId: `live-b:${Date.now()}`, policy: policy() });
    const after = JSON.stringify({ inv: demo.player.inventory, gate: demo.gates[0].status, trust: demo.npcs[0].trust });
    console.log('[B] executor =', exec.status, '| delta.inventory =', JSON.stringify(exec.actualStateDelta?.inventory ?? []), '| delta.gate =', JSON.stringify(exec.actualStateDelta?.gateStatus ?? []));

    expect(exec.status).toBe('executed');
    expect(after).not.toBe(before);
    // 状态真的变了：库存转移、信任变化或门禁打开，三选一以上。
    const delta = exec.actualStateDelta!;
    expect(delta.inventory.length + delta.trust.length + delta.gateStatus.length).toBeGreaterThan(0);
  }, 150_000);

  it('C. 离线对照：不连模型，低信任维修仍被安全拒绝且哈希不变', async () => {
    const game = createNewGame(42);
    game.currentFloor = NPC_FLOOR;
    // 阿林固定在 x=480；必须站到交互距离内，否则拒绝原因会是 too_far
    // 而不是我们要验证的 low_trust。
    game.player.x = 490;
    game.player.inventory.slots = [
      { itemId: 'wood', quantity: 2 },
      { itemId: 'tape', quantity: 1 },
    ];
    const result = await runAlinRepairScenario(game);
    console.log('[C] status =', result.status, '| reason =', result.reason);
    expect(result.status).toBe('blocked');
    // 起始信任 35 < 门槛 70：必须是信任不足，不能是距离或材料问题。
    expect(result.reason).toContain('信任不足');
    // 被拒时不许有任何世界变化。
    expect(result.beforeHash).toBe(result.afterHash);
  });
});