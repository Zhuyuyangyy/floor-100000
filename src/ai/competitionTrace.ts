import type {
  CompetitionTraceRecord,
  CompetitionWorldStateSnapshot,
} from './competition-contract';
import { toSafeCompetitionModelLabel } from './competition-contract';

/** JSON-compatible value after deterministic normalization and safety filtering. */
export type CompetitionTraceSafeValue =
  | null
  | boolean
  | number
  | string
  | readonly CompetitionTraceSafeValue[]
  | { readonly [key: string]: CompetitionTraceSafeValue };

/**
 * Fields defined by the competition contract. Projection is deliberately
 * allow-list based: incidental runtime fields (including provider diagnostics)
 * never become trace data merely because they were attached to an object.
 */
const TRACE_FIELDS = new Set([
  'goal', 'time', 'model', 'executionMode', 'gameMode', 'decisionMode', 'seed',
  'observation', 'proposal', 'validation', 'execution', 'hashes', 'replan', 'fallback',
  'kind', 'memoryId', 'day', 'subject', 'value', 'promise', 'status', 'from', 'to',
  'description', 'goalId', 'sinceDay', 'target', 'attempted', 'attempt', 'reason',
  'sequence', 'gameMinute', 'observationId', 'world', 'focus', 'availableActions',
  'recentFacts', 'currentFloor', 'flags', 'threats', 'player', 'npcs', 'groundItems',
  'gates', 'position', 'floor', 'x', 'hp', 'hunger', 'thirst', 'energy', 'inventory',
  'itemId', 'quantity', 'npcId', 'trust', 'affinity', 'tension', 'memory', 'lastAction',
  'result', 'key', 'severity', 'threatId', 'gateId', 'actor', 'delta', 'quantityDelta',
  'relationships', 'trustDelta', 'affinityDelta', 'tensionDelta', 'memoryAdded', 'entry',
  'flag', 'elapsedMinutes', 'positions', 'gateStatus', 'accepted', 'expectedStateDelta',
  'detailCode', 'actualStateDelta', 'hashes', 'observation', 'proposal', 'stateBefore',
  'stateAfter', 'replan', 'fallback', 'attempted', 'used', 'executionMode', 'decisionMode',
  'runId', 'execution', 'validation', 'world', 'seed', 'status', 'active', 'complete',
  'abandoned', 'available', 'busy', 'hostile', 'absent', 'open', 'kept', 'broken',
  'resolved', 'completed', 'blocked', 'interrupted', 'not-executed', 'executed', 'failed',
  'low', 'moderate', 'high', 'critical', 'contained', 'enemy', 'hazard', 'environment',
  'player', 'npc', 'ground_item', 'gate', 'survive', 'reach_floor', 'collect', 'return',
  'custom', 'observe', 'ask', 'give', 'trade', 'inspect', 'pickup', 'move', 'retreat',
  'sleep', 'repair_gate', 'model', 'rules', 'replay', 'fallback', 'spark-live',
  'offline-fallback', 'quick', 'adventure', 'easy', 'none', 'invalid_proposal', 'rejected',
  'stale_observation', 'model_error', 'model_unavailable', 'timeout', 'missing_item',
  'low_trust', 'too_far', 'too_late', 'too_dangerous', 'invalid_target', 'insufficient_hp',
  'ok', 'playerGives', 'playerReceives', 'transfer', 'destination', 'durationMinutes',
  'materials', 'id', 'question', 'accepted', 'actualStateDelta', 'expectedStateDelta', 'observation',
  'stateBefore', 'stateAfter', 'attempt', 'used', 'reason', 'status',
]);

const OMIT_KEY = /^(?:runid|memoryid|observationid|requestid|traceid|timestamp|wallclock|wallclocktime|createdat|updatedat|date|datetime|error|errormessage|modelerror|exception|stack|url|endpoint|token|secret|apikey|authorization|credential|password)$/i;
const URL_PATTERN = /(?:https?:\/\/|wss?:\/\/|\bwww\.)[^\s"'<>)}\]]+/gi;
const SECRET_ASSIGNMENT_PATTERN = /\b(?:bearer\s+|(?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|secret|password|authorization)\s*[:=]\s*)[^\s,;]+/gi;
const MODEL_ERROR_PATTERN = /(?:\b(?:model|provider|inference)\s+error\b|模型(?:错误|异常)|推理(?:错误|异常)|\b(?:exception|stack trace)\b)/i;

function safeString(value: string): string {
  if (MODEL_ERROR_PATTERN.test(value)) return '[redacted]';
  return value
    .replace(URL_PATTERN, '[redacted-url]')
    .replace(SECRET_ASSIGNMENT_PATTERN, '[redacted-secret]');
}

function normalize(value: unknown, parentKey = ''): CompetitionTraceSafeValue | undefined {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    if (typeof value === 'string') return safeString(value);
    return value;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
  if (typeof value !== 'object') return undefined;

  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalize(item)).map((item) => item ?? null);
    return normalized;
  }

  const result: Record<string, CompetitionTraceSafeValue> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const isSafeFlagName = parentKey === 'flags' && /^[A-Za-z0-9_.:-]{1,100}$/.test(key);
    if (OMIT_KEY.test(normalizedKey) || (!TRACE_FIELDS.has(key) && !isSafeFlagName)) continue;
    const raw = (value as Record<string, unknown>)[key];
    // Model labels are branded at compile time only; revalidate at runtime.
    if (key === 'model') {
      const label = toSafeCompetitionModelLabel(raw);
      if (label !== null) result[key] = label;
      continue;
    }
    const normalized = normalize(raw, key);
    if (normalized !== undefined) result[key] = normalized;
  }
  return result;
}

/**
 * Return the deterministic, safe JSON-compatible projection of a trace record.
 * runId, observationId, memoryId, wall-clock fields and unknown fields are omitted.
 */
export function projectCompetitionTraceSafe(record: CompetitionTraceRecord): CompetitionTraceSafeValue {
  return normalize(record) ?? null;
}

/** Canonical JSON: object keys are lexicographically sorted; array order is meaningful. */
export function serializeCompetitionTrace(value: unknown): string {
  return JSON.stringify(normalize(value) ?? null);
}

/** Stable serialization of a world snapshot, excluding random memory identifiers. */
export function serializeCompetitionWorldState(snapshot: CompetitionWorldStateSnapshot): string {
  return serializeCompetitionTrace(snapshot);
}

/**
 * SHA-256 via the Web Crypto API, shared by modern browsers and Node.js.
 * No Node-only crypto import or insecure digest fallback is used.
 */
export async function competitionTraceSha256(serialized: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto SHA-256 is unavailable in this runtime');
  const bytes = new TextEncoder().encode(serialized);
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Hash a world-state snapshot; equal normalized states produce equal hashes. */
export function hashCompetitionWorldState(snapshot: CompetitionWorldStateSnapshot): Promise<string> {
  return competitionTraceSha256(serializeCompetitionWorldState(snapshot));
}

/** Hash a safe trace projection; incidental run IDs and diagnostics do not affect it. */
export function hashCompetitionTrace(record: CompetitionTraceRecord): Promise<string> {
  return competitionTraceSha256(serializeCompetitionTrace(projectCompetitionTraceSafe(record)));
}
