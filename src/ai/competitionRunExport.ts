import type { AlinGiftScenarioResult } from '../scenarios/alinGiftDemo';
import type { AlinRepairScenarioResult } from '../scenarios/alinRepairDemo';
import { serializeCompetitionTrace, serializeCompetitionWorldState } from './competitionTrace';

const EXPORT_FORMAT = 'floor-100000-competition-run';
const EXPORT_VERSION = 1;

type AlinScenarioResult = AlinGiftScenarioResult | AlinRepairScenarioResult;
type AlinScenarioName = 'alin-gift' | 'alin-repair';

/**
 * Export only the deterministic, explicitly allow-listed competition projection.
 * Both current Alin adapters are local/offline paths; this deliberately never
 * claims Spark live, and the scenario result types carry no live-provider proof.
 */
function serializeAlinRun(result: AlinScenarioResult, scenario: AlinScenarioName): string {
  const feedback = result.feedback.map((event) => ({
    attempt: event.attempt,
    // `status` is a trace allow-listed key; `outcome` is not.
    status: event.outcome,
    observation: event.observation,
    ...(event.goal ? { goal: event.goal } : {}),
    ...(event.proposal ? { proposal: event.proposal } : {}),
    ...(event.validation ? { validation: event.validation } : {}),
    ...(event.execution ? { execution: event.execution } : {}),
  }));

  // Use the trace allow-list/redaction/canonical key ordering for all runtime
  // data. Its OMIT_KEY rules remove memory/observation IDs, time stamps and
  // unknown diagnostics; safeString removes URL and credential-like text.
  const projected = JSON.parse(serializeCompetitionTrace({
    seed: result.before.seed,
    executionMode: 'offline-fallback',
    decisionMode: 'rules',
    status: result.status,
    attempt: result.attempts,
    world: { stateBefore: result.before, stateAfter: result.after },
    hashes: { stateBefore: result.beforeHash, stateAfter: result.afterHash },
    observation: result.observation,
    proposal: result.proposal,
    validation: result.validation,
    execution: result.execution,
    actualStateDelta: result.execution?.status === 'completed'
      ? result.execution.actualStateDelta
      : null,
    // `replan` is the contract's allow-listed container for retry/event data.
    replan: feedback,
  })) as Record<string, unknown>;

  // `format`, `version`, and `scenario` are fixed envelope metadata, not
  // runtime-controlled values. World snapshots are independently passed
  // through the dedicated snapshot serializer before being returned.
  const world = projected.world as { stateBefore: unknown; stateAfter: unknown } | undefined;
  const safeWorld = {
    stateBefore: world?.stateBefore ?? JSON.parse(serializeCompetitionWorldState(result.before)),
    stateAfter: world?.stateAfter ?? JSON.parse(serializeCompetitionWorldState(result.after)),
  };
  const safeNpcMemory = {
    stateBefore: (safeWorld.stateBefore as { npcs?: readonly { npcId: unknown; memory: unknown }[] }).npcs
      ?.map(({ npcId, memory }) => ({ npcId, memory })) ?? [],
    stateAfter: (safeWorld.stateAfter as { npcs?: readonly { npcId: unknown; memory: unknown }[] }).npcs
      ?.map(({ npcId, memory }) => ({ npcId, memory })) ?? [],
  };

  return JSON.stringify({
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    scenario,
    seed: projected.seed,
    mode: projected.executionMode,
    decisionMode: projected.decisionMode,
    status: projected.status,
    attempts: projected.attempt,
    world: safeWorld,
    hashes: projected.hashes,
    observation: projected.observation,
    proposal: projected.proposal,
    validation: projected.validation,
    execution: projected.execution,
    actualStateDelta: projected.actualStateDelta,
    feedback: projected.replan,
    replanFeedback: projected.replan,
    npcMemory: safeNpcMemory,
  });
}

/** Serialize the Alin gift scenario as stable, redacted competition-run JSON. */
export function serializeAlinGiftRun(result: AlinGiftScenarioResult): string {
  return serializeAlinRun(result, 'alin-gift');
}

/** Serialize the Alin repair scenario as stable, redacted competition-run JSON. */
export function serializeAlinRepairRun(result: AlinRepairScenarioResult): string {
  return serializeAlinRun(result, 'alin-repair');
}
