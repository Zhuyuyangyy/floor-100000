import { competitionTraceSha256, serializeCompetitionWorldState } from '../ai/competitionTrace';
import type { CompetitionWorldStateSnapshot } from '../ai/competition-contract';
import type { GameState } from '../core/gameTypes';
import { createNewGame } from '../core/gameState';
import { createNpcState } from '../data/npcPersonalities';
import { getNpc, NPC_FLOOR } from '../data/npcs';
import { saveNpcState } from '../systems/NpcMemory';
import { flagCount } from '../systems/WorldFlags';
import {
  runAlinGiftScenario,
  type AlinGiftScenarioResult,
  type AlinGiftScenarioStatus,
} from '../scenarios/alinGiftDemo';
import {
  ALIN_REPAIR_GATE_FLAG,
  runAlinRepairScenario,
  type AlinRepairScenarioResult,
  type AlinRepairScenarioStatus,
} from '../scenarios/alinRepairDemo';
import { serializeAlinGiftRun, serializeAlinRepairRun } from '../ai/competitionRunExport';

/** 默认小样本 seed；调用者可传入其他合法 uint32 seed。 */
export const DEFAULT_COMPETITION_REPLAY_SEEDS = [17, 73, 2048] as const;

export type CompetitionReplayScenario =
  | 'alin-gift-success'
  | 'alin-gift-missing-item'
  | 'alin-repair-missing-materials';

export type CompetitionReplayScenarioStatus = AlinGiftScenarioStatus | AlinRepairScenarioStatus;

/** 每个样本只计一次场景结果；重放对比为两份独立初始状态的序列化输出。 */
export interface CompetitionReplaySample {
  readonly seed: number;
  readonly scenario: CompetitionReplayScenario;
  readonly resultStatus: CompetitionReplayScenarioStatus;
  readonly validationCode: string | null;
  readonly replayIdentical: boolean;
  /** 独立重算结果与导出记录中的前后状态哈希一致。 */
  readonly snapshotHashesVerified: true;
  /** 仅维修样本填写；同时要求场景快照与 GameState flag 都保持关闭。 */
  readonly gateStayedClosed: boolean | null;
  /** 仅成功赠礼样本填写；维修配方材料未被赠礼消耗。 */
  readonly repairMaterialsUnchanged: boolean | null;
  /** 首次安全序列化输出的 SHA-256。 */
  readonly outputSha256: string;
}

export type CompetitionReplayResultCounts = Partial<Record<CompetitionReplayScenarioStatus, number>>;

export interface CompetitionReplayBenchmarkResult {
  readonly executionMode: 'offline-fallback';
  readonly scope: 'offline-fallback 场景行为可复现性与结果；不衡量模型质量、延迟或任务成功率。';
  readonly seeds: readonly number[];
  readonly sampleCount: number;
  readonly replayMatchCount: number;
  readonly replayMatchRate: number;
  readonly scenarioResultCounts: Readonly<Record<CompetitionReplayScenario, CompetitionReplayResultCounts>>;
  readonly samples: readonly CompetitionReplaySample[];
  /** 基于有序样本摘要计算的 SHA-256；相同 seed 输入与输出应得到相同值。 */
  readonly contentSha256: string;
}

interface ScenarioRun {
  readonly status: CompetitionReplayScenarioStatus;
  readonly validationCode: string | null;
  readonly gateStayedClosed: boolean | null;
  readonly repairMaterialsUnchanged: boolean | null;
  readonly snapshotHashesVerified: true;
  readonly serialized: string;
}

interface ExportedAlinRun {
  readonly world?: {
    readonly stateBefore?: CompetitionWorldStateSnapshot;
    readonly stateAfter?: CompetitionWorldStateSnapshot;
  };
  readonly hashes?: {
    readonly stateBefore?: unknown;
    readonly stateAfter?: unknown;
  };
}

type HashedScenarioResult = Pick<AlinGiftScenarioResult, 'before' | 'after' | 'beforeHash' | 'afterHash'>
  | Pick<AlinRepairScenarioResult, 'before' | 'after' | 'beforeHash' | 'afterHash'>;

/** 验证导出快照、scenario hash 及独立 SHA-256 三者一致。 */
async function serializeVerifiedRun<T extends HashedScenarioResult>(
  result: T,
  serialize: (value: T) => string,
): Promise<string> {
  const serialized = serialize(result);
  const exported = JSON.parse(serialized) as ExportedAlinRun;
  const beforeSnapshot = exported.world?.stateBefore;
  const afterSnapshot = exported.world?.stateAfter;
  if (!beforeSnapshot || !afterSnapshot || !exported.hashes) {
    throw new Error('benchmark 导出缺少前后状态快照或哈希');
  }

  const expectedBefore = serializeCompetitionWorldState(result.before);
  const expectedAfter = serializeCompetitionWorldState(result.after);
  const projectedBefore = serializeCompetitionWorldState(beforeSnapshot);
  const projectedAfter = serializeCompetitionWorldState(afterSnapshot);
  if (projectedBefore !== expectedBefore || projectedAfter !== expectedAfter) {
    throw new Error('benchmark 导出的状态快照与场景结果不一致');
  }

  const [beforeDigest, afterDigest] = await Promise.all([
    competitionTraceSha256(projectedBefore),
    competitionTraceSha256(projectedAfter),
  ]);
  if (beforeDigest !== result.beforeHash || afterDigest !== result.afterHash ||
      exported.hashes.stateBefore !== beforeDigest || exported.hashes.stateAfter !== afterDigest) {
    throw new Error('benchmark 场景哈希、导出哈希与独立 SHA-256 不一致');
  }
  return serialized;
}

/** 用现有场景测试采用的阿林位置配置新游戏，不从旧状态复制夹具。 */
function createAtAlin(seed: number): GameState {
  const game = createNewGame(seed);
  game.currentFloor = NPC_FLOOR;
  game.player.x = getNpc('alin').x;
  return game;
}

function countItem(game: GameState, itemId: string): number {
  return game.player.inventory.slots
    .filter((stack) => stack.itemId === itemId)
    .reduce((total, stack) => total + stack.quantity, 0);
}

/** 以固定次序编码成 UTF-8 后逐字节比较，而非比较对象引用或字段子集。 */
function equalUtf8Bytes(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  return leftBytes.every((byte, index) => byte === rightBytes[index]);
}

async function runScenario(seed: number, scenario: CompetitionReplayScenario): Promise<ScenarioRun> {
  const game = createAtAlin(seed);
  switch (scenario) {
    case 'alin-gift-success': {
      game.player.inventory.slots.push({ itemId: 'wood', quantity: 2 });
      game.player.inventory.slots.push({ itemId: 'tape', quantity: 1 });
      game.player.inventory.slots.push({ itemId: 'clean_water', quantity: 1 });
      const woodBefore = countItem(game, 'wood');
      const tapeBefore = countItem(game, 'tape');
      const result = await runAlinGiftScenario(game, 'clean_water');
      const serialized = await serializeVerifiedRun(result, serializeAlinGiftRun);
      const repairMaterialsUnchanged = countItem(game, 'wood') === woodBefore && countItem(game, 'tape') === tapeBefore;
      if (!repairMaterialsUnchanged) throw new Error('成功赠礼意外消耗了维修配方材料');
      return {
        status: result.status,
        validationCode: result.validation?.accepted === false
          ? result.validation.detailCode ?? result.validation.reason
          : result.validation?.reason ?? null,
        gateStayedClosed: null,
        repairMaterialsUnchanged,
        snapshotHashesVerified: true,
        serialized,
      };
    }
    case 'alin-gift-missing-item': {
      const result = await runAlinGiftScenario(game, 'wood');
      const serialized = await serializeVerifiedRun(result, serializeAlinGiftRun);
      return {
        status: result.status,
        validationCode: result.validation?.accepted === false
          ? result.validation.detailCode ?? result.validation.reason
          : result.validation?.reason ?? null,
        gateStayedClosed: null,
        repairMaterialsUnchanged: null,
        snapshotHashesVerified: true,
        serialized,
      };
    }
    case 'alin-repair-missing-materials': {
      // 达到信任门槛，但起始库存不含木材或胶带；使用正常默认配方验证缺料拒绝。
      // 不调用楼层切换或其他开门逻辑。
      const npc = createNpcState('ally');
      npc.relationship.player = 70;
      saveNpcState(game, 'alin', npc);
      const result = await runAlinRepairScenario(game);
      const serialized = await serializeVerifiedRun(result, serializeAlinRepairRun);
      return {
        status: result.status,
        validationCode: result.validation?.accepted === false
          ? result.validation.detailCode ?? result.validation.reason
          : result.validation?.reason ?? null,
        gateStayedClosed: result.after.gates[0]?.status === 'closed' && flagCount(game, ALIN_REPAIR_GATE_FLAG) === 0,
        repairMaterialsUnchanged: null,
        snapshotHashesVerified: true,
        serialized,
      };
    }
  }
}

/**
 * 对每个 seed 与固定场景，从全新 GameState 独立构造两次并执行离线回放。
 * 结果仅描述 offline-fallback 场景行为的可复现性，不是模型评测指标。
 */
export async function runCompetitionReplayBenchmark(
  seeds: readonly number[] = DEFAULT_COMPETITION_REPLAY_SEEDS,
): Promise<CompetitionReplayBenchmarkResult> {
  if (seeds.length === 0) throw new Error('benchmark 至少需要一个 seed');
  if (seeds.some((seed) => !Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff)) {
    throw new Error('benchmark seed 必须是 uint32 整数');
  }
  if (new Set(seeds).size !== seeds.length) throw new Error('benchmark seed 不得重复');

  const scenarios: readonly CompetitionReplayScenario[] = [
    'alin-gift-success',
    'alin-gift-missing-item',
    'alin-repair-missing-materials',
  ];
  const samples: CompetitionReplaySample[] = [];
  const scenarioResultCounts: Record<CompetitionReplayScenario, CompetitionReplayResultCounts> = {
    'alin-gift-success': {},
    'alin-gift-missing-item': {},
    'alin-repair-missing-materials': {},
  };

  for (const seed of seeds) {
    for (const scenario of scenarios) {
      const [first, replay] = await Promise.all([
        runScenario(seed, scenario),
        runScenario(seed, scenario),
      ]);
      const resultCounts = scenarioResultCounts[scenario];
      resultCounts[first.status] = (resultCounts[first.status] ?? 0) + 1;
      samples.push({
        seed,
        scenario,
        resultStatus: first.status,
        validationCode: first.validationCode,
        replayIdentical: equalUtf8Bytes(first.serialized, replay.serialized),
        snapshotHashesVerified: first.snapshotHashesVerified && replay.snapshotHashesVerified,
        gateStayedClosed: scenario === 'alin-repair-missing-materials'
          ? first.gateStayedClosed === true && replay.gateStayedClosed === true
          : null,
        repairMaterialsUnchanged: first.repairMaterialsUnchanged,
        outputSha256: await competitionTraceSha256(first.serialized),
      });
    }
  }

  const replayMatchCount = samples.filter((sample) => sample.replayIdentical).length;
  // 汇总 hash 包含输入 seed 次序及每个样本的结果、逐样本输出 hash 与比较结果。
  const contentSha256 = await competitionTraceSha256(JSON.stringify({ seeds: [...seeds], samples }));
  return {
    executionMode: 'offline-fallback',
    scope: 'offline-fallback 场景行为可复现性与结果；不衡量模型质量、延迟或任务成功率。',
    seeds: [...seeds],
    sampleCount: samples.length,
    replayMatchCount,
    replayMatchRate: replayMatchCount / samples.length,
    scenarioResultCounts,
    samples,
    contentSha256,
  };
}
