// NPC 记忆与关系（RFC §5「Memory / Relationship」）。
//
// 纯函数、无 Phaser、无网络：所有变更返回新状态或显式 mutate 后由
// 调用方写回 GameState.npcStates。记忆有界——超出上限时淘汰
// 「权重最低 → 最旧」的条目，防止存档与 prompt 无限膨胀。

import type { DiaryEvent, GameState } from '../core/gameTypes';
import { ARCHETYPES } from '../data/npcPersonalities';
import type { MemoryEntry, NpcPersistedState } from '../ai/types';

/** 记忆种类 → 基础情感权重（-1 仇 .. 1 恩），再按人格 loyalty 缩放。 */
const KIND_WEIGHT: Record<string, number> = {
  gift: 0.6,
  help: 0.5,
  trade: 0.15,
  observed: 0,
  refusal: -0.2,
  insult: -0.5,
  attack: -0.9,
};

/**
 * 记忆 ID：UUID。进程内计数器在页面刷新后会归零，与旧存档里的 ID 相撞
 * （trimMemory 的淘汰 Tie-break 依赖 ID 唯一性），所以必须用跨重启唯一的
 * 生成器。crypto.randomUUID 在浏览器（localhost 安全上下文）与 Node 19+
 * 均可用；极端环境退化为时间戳+随机后缀。
 */
export function nextMemoryId(prefix = 'mem'): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return `${prefix}_${c.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ── 事件可见性（NPC 独立知识体系）──────────────────────────────────────────
//
// 全局日记不是「所有人都知道的事实」。阿林不会平白知道玩家夜袭了流浪者，
// 除非他在场。只有通过可见性过滤的事件才能进 NPC 的 prompt。

export type EventVisibility = 'witnessed' | 'public' | 'unknown';

/** 公共事件：整个楼层都察觉得到的（广播级）。 */
const PUBLIC_EVENT_KINDS: ReadonlySet<string> = new Set(['shelter_attacked']);

export function eventVisibility(npcId: string, event: Pick<DiaryEvent, 'kind' | 'actorIds'>): EventVisibility {
  if (event.actorIds.includes(npcId)) return 'witnessed'; // 亲历
  if (PUBLIC_EVENT_KINDS.has(event.kind)) return 'public'; // 公共
  return 'unknown'; // 不在场即不知道（'told' 告知留待玩家传话机制）
}

/** 过滤出该 NPC 有权知道的事件，保持时间顺序。 */
export function visibleEvents(npcId: string, events: DiaryEvent[]): DiaryEvent[] {
  return events.filter((e) => eventVisibility(npcId, e) !== 'unknown');
}

export interface MemoryInput {
  day: number;
  minute: number;
  kind: string;
  actor: string;
  summary: string;
}

/**
 * 追加一条记忆并更新关系与情绪。关系增量 = 基础权重 × (0.5 + loyalty)，
 * 再按 archetype 的攻击性修正敌对行为——敌意人格记仇更狠。
 */
export function recordMemory(state: NpcPersistedState, input: MemoryInput): NpcPersistedState {
  const base = KIND_WEIGHT[input.kind] ?? 0;
  const weight = clamp(base, -1, 1);
  const entry: MemoryEntry = {
    id: nextMemoryId(),
    day: input.day,
    minute: input.minute,
    kind: input.kind,
    actor: input.actor,
    summary: input.summary,
    weight,
  };
  const memory = [...state.memory, entry];
  const relationship = adjustRelationship(state.relationship, input.actor, relationshipDelta(state, weight));
  return {
    ...state,
    memory: trimMemory(memory, memoryLimitFor(state)),
    relationship,
    mood: nextMood(state, weight),
  };
}

/** 关系变化量：loyalty 放大正负两向；敌对 archetype 的负向记忆双倍记仇。 */
export function relationshipDelta(state: NpcPersistedState, weight: number): number {
  const scaled = weight * 20 * (0.5 + state.traits.loyalty);
  if (weight < 0 && state.archetype === 'hostile') return scaled * 2;
  return scaled;
}

function adjustRelationship(current: Record<string, number>, actor: string, delta: number): Record<string, number> {
  const next = clamp((current[actor] ?? 0) + delta, -100, 100);
  return { ...current, [actor]: Math.round(next * 100) / 100 };
}

/** 情绪向最新记忆权重回归，但不归零——旧仇会残留。 */
function nextMood(state: NpcPersistedState, latestWeight: number): number {
  const decay = 0.7;
  return clamp(state.mood * decay + latestWeight * (1 - decay), -1, 1);
}

function memoryLimitFor(state: NpcPersistedState): number {
  // 与 data/npcPersonalities.ts 的 memoryLimit 保持一致的兜底值
  return state.archetype === 'hostile' ? 32 : state.archetype === 'ally' ? 24 : 16;
}

/** 淘汰权重最低的条目；权重相同淘汰最旧的。保留插入顺序稳定。 */
export function trimMemory(memory: MemoryEntry[], limit: number): MemoryEntry[] {
  if (memory.length <= limit) return memory;
  const sorted = [...memory].sort((a, b) => {
    const wa = Math.abs(a.weight);
    const wb = Math.abs(b.weight);
    if (wa !== wb) return wa - wb; // 权重低的排前面，先淘汰
    return a.id < b.id ? -1 : 1; // 同权重淘汰更旧的（id 单调递增）
  });
  const drop = new Set(sorted.slice(0, memory.length - limit).map((e) => e.id));
  return memory.filter((e) => !drop.has(e.id));
}

/**
 * 检索相关记忆：按 |weight| 降序取前 k 条，再按时间正序返回，
 * 让 prompt 里的记忆读起来像编年史。k 有上限，控制 token 预算。
 */
export function recall(memory: MemoryEntry[], k: number): MemoryEntry[] {
  const ranked = [...memory].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  return ranked.slice(0, Math.max(0, k)).sort((a, b) => a.day - b.day || a.minute - b.minute);
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

// ── 存档桥接 ────────────────────────────────────────────────────────────────
// GameState.npcStates 的类型是 Record<string, string>（gameTypes.ts 预留），
// 值存 JSON。坏 JSON 不抛错——返回 null，调用方按「首次遇到」重建，
// 与 SaveSystem 的坏档哲学一致。

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 一条记忆的形状校验。字段缺失/类型错误 → 整条状态判坏。 */
function isValidMemory(v: unknown): v is MemoryEntry {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    m.id.length > 0 &&
    Number.isInteger(m.day) &&
    (m.day as number) >= 1 &&
    Number.isInteger(m.minute) &&
    (m.minute as number) >= 0 &&
    (m.minute as number) < 1440 &&
    typeof m.kind === 'string' &&
    typeof m.actor === 'string' &&
    typeof m.summary === 'string' &&
    isFiniteNumber(m.weight) &&
    m.weight >= -1 &&
    m.weight <= 1
  );
}

/**
 * NPC 持久状态的完整 Schema 校验。任何字段坏了都返回 null——
 * 让调用方按「首次遇到」重建，而不是把畸形状态喂给推理层。
 */
export function isValidNpcState(v: unknown): v is NpcPersistedState {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  if (typeof s.archetype !== 'string' || !(s.archetype in ARCHETYPES)) return false;
  const traits = s.traits as Record<string, unknown> | undefined;
  if (!traits) return false;
  for (const key of ['altruism', 'pragmatism', 'aggression', 'loyalty', 'caution']) {
    const t = traits[key];
    if (!isFiniteNumber(t) || t < 0 || t > 1) return false;
  }
  if (typeof s.goal !== 'string') return false;
  if (typeof s.mood !== 'number' || !Number.isFinite(s.mood) || s.mood < -1 || s.mood > 1) return false;
  const rel = s.relationship as Record<string, unknown> | undefined;
  if (!rel || typeof rel !== 'object') return false;
  for (const value of Object.values(rel)) {
    if (!isFiniteNumber(value) || value < -100 || value > 100) return false;
  }
  if (!Array.isArray(s.memory) || !s.memory.every(isValidMemory)) return false;
  return true;
}

export function saveNpcState(state: GameState, npcId: string, npc: NpcPersistedState): void {
  state.npcStates[npcId] = JSON.stringify(npc);
}

export function loadNpcState(state: GameState, npcId: string): NpcPersistedState | null {
  const raw = state.npcStates[npcId];
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidNpcState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
