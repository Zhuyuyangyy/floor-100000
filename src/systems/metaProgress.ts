import type { MetaProgress } from '../core/gameTypes';

// OVERHAUL Wave B: cross-run meta-progression — the replay engine both
// reverse-engineered benchmarks run on (ALTACima unlocks characters, CENTUM
// pays out per-character clears). Four survivors exist in the art already;
// three of them were decoration. Depth unlocks them, and the choice persists
// outside the run so a wiped save keeps its unlocks.
//
// Pure logic plus a best-effort localStorage wrapper: nothing here throws,
// because a full disk or a private window must not cost the player their
// unlocks.

const META_KEY = 'floor100000.meta.v1';

// The four playable survivors and the depth each demands. The player starts
// alone; the others are the game's answer to "one more run" — the neighbour
// you have been trading with, the kid, and the thing in the dark.
export const CHARACTER_UNLOCKS: Record<string, number> = {
  player: 0,
  npc_alin: 2,
  npc_xiaozhou: 3,
  wanderer: 5,
};

// Display names, so the select screen and the HUD agree.
export const CHARACTER_NAMES: Record<string, string> = {
  player: '幸存者',
  npc_alin: '阿林',
  npc_xiaozhou: '小周',
  wanderer: '流浪者',
};

export const MODES = ['quick', 'adventure', 'easy'] as const;

export function freshMeta(): MetaProgress {
  return { unlockedCharacters: ['player'], selectedCharacter: 'player', bestDepth: 0, mode: 'adventure', relics: [] };
}

// Reads the meta, repairing anything missing or malformed rather than
// rejecting it: a meta file is the player's trophy cabinet, and a corrupt
// field is no reason to take the cabinet away.
export function loadMeta(storage: Storage = localStorage): MetaProgress {
  let raw: string | null = null;
  try {
    raw = storage.getItem(META_KEY);
  } catch {
    return freshMeta();
  }
  if (raw === null) return freshMeta();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return freshMeta();
  }
  if (typeof data !== 'object' || data === null) return freshMeta();
  const m = data as Record<string, unknown>;
  const meta = freshMeta();
  if (Array.isArray(m.unlockedCharacters)) {
    const chars = m.unlockedCharacters.filter((c): c is string => typeof c === 'string' && c in CHARACTER_UNLOCKS);
    if (!chars.includes('player')) chars.push('player');
    meta.unlockedCharacters = chars;
  }
  if (typeof m.selectedCharacter === 'string' && meta.unlockedCharacters.includes(m.selectedCharacter)) {
    meta.selectedCharacter = m.selectedCharacter;
  }
  if (typeof m.bestDepth === 'number' && Number.isFinite(m.bestDepth) && m.bestDepth >= 0) {
    meta.bestDepth = Math.floor(m.bestDepth);
  }
  if (typeof m.mode === 'string' && (MODES as readonly string[]).includes(m.mode)) {
    meta.mode = m.mode as MetaProgress['mode'];
  }
  if (Array.isArray(m.relics)) {
    meta.relics = m.relics.filter((r): r is string => typeof r === 'string');
  }
  return meta;
}

// Best-effort by design: a rejected write (quota, private mode) leaves the
// run playable with in-memory unlocks instead of killing the frame.
export function saveMeta(meta: MetaProgress, storage: Storage = localStorage): void {
  try {
    storage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    // Silence is the documented outcome; a crash is not.
  }
}

// Which characters a run that reached `depth` has earned. Pure — the caller
// decides what to do with the news.
export function applyDepth(meta: MetaProgress, depth: number): string[] {
  const fresh: string[] = [];
  for (const [name, need] of Object.entries(CHARACTER_UNLOCKS)) {
    if (depth >= need && !meta.unlockedCharacters.includes(name)) fresh.push(name);
  }
  return fresh;
}

// The meta after a run that reached `depth`: unlocks applied, bestDepth
// raised. Returns a new object; the input is untouched.
export function unlockFromDepth(meta: MetaProgress, depth: number): MetaProgress {
  const gained = applyDepth(meta, depth);
  if (gained.length === 0 && depth <= meta.bestDepth) return meta;
  return {
    ...meta,
    unlockedCharacters: [...meta.unlockedCharacters, ...gained],
    bestDepth: Math.max(meta.bestDepth, Math.floor(depth)),
  };
}

export function canSelect(meta: MetaProgress, character: string): boolean {
  return meta.unlockedCharacters.includes(character);
}
