import type { GameState } from '../core/gameTypes';
import type { CompetitionActor, CompetitionNpcMemoryEntry } from '../ai/competition-contract';

/** Private optional extension inside npcStates[npcId]; no GameState schema field is added. */
const MEMORY_FIELD = 'competitionMemory';
const LEGACY_RAW_FIELD = 'legacyRaw';
const LEGACY_VALUE_FIELD = 'legacyValue';
const LEGACY_MEMORY_FIELD = 'legacyCompetitionMemory';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveDay(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function isActor(value: unknown): value is CompetitionActor {
  if (value === 'player') return true;
  return isRecord(value) && value.kind === 'npc' && typeof value.npcId === 'string' && value.npcId.length > 0;
}

/** Validate an untrusted saved entry without rejecting its valid siblings. */
function normalizeEntry(value: unknown): CompetitionNpcMemoryEntry | null {
  if (!isRecord(value) || typeof value.memoryId !== 'string' || value.memoryId.length === 0 || !isPositiveDay(value.day)) {
    return null;
  }
  switch (value.kind) {
    case 'fact':
      if (typeof value.subject !== 'string' || typeof value.value !== 'string') return null;
      return { kind: 'fact', memoryId: value.memoryId, day: value.day, subject: value.subject, value: value.value };
    case 'promise':
      if (typeof value.promise !== 'string' || (value.status !== 'open' && value.status !== 'kept' && value.status !== 'broken')) return null;
      return { kind: 'promise', memoryId: value.memoryId, day: value.day, promise: value.promise, status: value.status };
    case 'favor':
    case 'debt':
      if (!isActor(value.from) || typeof value.description !== 'string' || (value.status !== 'open' && value.status !== 'resolved')) return null;
      return {
        kind: value.kind,
        memoryId: value.memoryId,
        day: value.day,
        from: value.from === 'player' ? 'player' : { kind: 'npc', npcId: value.from.npcId },
        description: value.description,
        status: value.status,
      };
    default:
      return null;
  }
}

function getNpcRecord(state: Pick<GameState, 'npcStates'>, npcId: string): Record<string, unknown> | null {
  const npcStates = (state as { npcStates?: unknown }).npcStates;
  if (!isRecord(npcStates)) return null;
  const raw = npcStates[npcId];
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed)) return parsed;
    // Keep valid but non-object legacy JSON intact when the adapter first writes.
    return { [LEGACY_VALUE_FIELD]: parsed };
  } catch {
    // A malformed historical value cannot be parsed, but do not overwrite its bytes.
    return { [LEGACY_RAW_FIELD]: raw };
  }
}

function readEntries(record: Record<string, unknown> | null): CompetitionNpcMemoryEntry[] {
  if (!record || !Array.isArray(record[MEMORY_FIELD])) return [];
  const entries: CompetitionNpcMemoryEntry[] = [];
  for (const raw of record[MEMORY_FIELD]) {
    const entry = normalizeEntry(raw);
    if (entry) entries.push(entry);
  }
  return entries;
}

/**
 * Read every persisted competition memory for an NPC, in save order. Supplying
 * `day` returns only entries from that exact in-game day; omitting it preserves
 * the cross-day history. Missing maps/fields and malformed JSON safely read empty.
 */
export function loadCompetitionNpcMemory(
  state: Pick<GameState, 'npcStates'>,
  npcId: string,
  day?: number,
): CompetitionNpcMemoryEntry[] {
  const entries = readEntries(getNpcRecord(state, npcId));
  return day === undefined ? entries : isPositiveDay(day) ? entries.filter((entry) => entry.day === day) : [];
}

/**
 * Persist one complete memory entry after the validated executor has accepted
 * the corresponding state change. This adapter validates shape defensively but
 * deliberately does not decide whether a proposed action is authorized.
 * Existing NPC JSON keys and legacy memory fields are retained unchanged.
 */
export function saveCompetitionNpcMemory(
  state: GameState,
  npcId: string,
  candidate: CompetitionNpcMemoryEntry,
): boolean {
  if (typeof npcId !== 'string' || npcId.length === 0) return false;
  const entry = normalizeEntry(candidate);
  if (!entry) return false;

  const mutableState = state as GameState & { npcStates?: Record<string, string> };
  if (!isRecord(mutableState.npcStates)) mutableState.npcStates = {};
  const record = getNpcRecord(mutableState, npcId) ?? {};
  const entries = readEntries(record);
  // A deterministic ID makes retries idempotent; never replace an existing fact.
  if (entries.some((saved) => saved.memoryId === entry.memoryId)) return true;
  const existing = record[MEMORY_FIELD];
  if (existing !== undefined && !Array.isArray(existing) && !(LEGACY_MEMORY_FIELD in record)) {
    record[LEGACY_MEMORY_FIELD] = existing;
  }
  record[MEMORY_FIELD] = [...(Array.isArray(existing) ? existing : []), entry];
  mutableState.npcStates[npcId] = JSON.stringify(record);
  return true;
}

/**
 * Build a reproducible ID from run/game identity and a logical sequence number.
 * The caller supplies the sequence; this function uses no wall clock or RNG.
 */
export function createCompetitionNpcMemoryId(runSeed: number, npcId: string, day: number, sequence: number): string {
  if (!Number.isSafeInteger(runSeed) || runSeed < 0 || !npcId || !isPositiveDay(day) || !Number.isSafeInteger(sequence) || sequence < 0) {
    throw new RangeError('invalid competition NPC memory ID components');
  }
  return `cnm:${runSeed}:${day}:${sequence}:${encodeURIComponent(npcId)}`;
}
