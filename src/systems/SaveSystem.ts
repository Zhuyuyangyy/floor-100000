import { PLAYABLE_FLOORS_V01, SAVE_KEY, SCHEMA_VERSION } from '../core/constants';
import { getItem, isItemId } from '../data/items';
import { STAT_MAX } from './InventorySystem';
import { BODY_TEMP_MAX } from './EnvironmentSystem';
import { AILMENTS } from './SicknessSystem';
import type { ActiveEvent, DiaryEvent, FloorVisit, GameState, ShelterPlan } from '../core/gameTypes';

// Save protocol (docs/02_TECH_SPEC.md §6). Deserialization never throws: a bad
// save returns a graceful error so the UI can show "存档损坏" and keep the
// new-game entry, instead of white-screening.

export type SaveResult = { ok: true; state: GameState } | { ok: false; error: string };

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

function validateStack(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return '背包栏无效';
  const stack = raw as Record<string, unknown>;
  if (typeof stack.itemId !== 'string' || !isItemId(stack.itemId)) {
    return `未知物品 itemId=${String(stack.itemId)}`;
  }
  if (typeof stack.quantity !== 'number' || !Number.isInteger(stack.quantity) || stack.quantity < 1) {
    return '物品数量无效';
  }
  if (stack.quantity > getItem(stack.itemId).maxStack) {
    return `物品 ${stack.itemId} 数量超过堆叠上限`;
  }
  return null;
}

const VISIT_KEYS: Array<keyof FloorVisit> = ['openedContainers', 'lootedItems', 'unlockedDoors', 'localEvents'];
const EVENT_TYPES: Array<ActiveEvent['type']> = ['blackout', 'wanderer', 'leak'];
const EVENT_STATUSES: Array<NonNullable<ActiveEvent['status']>> = ['active', 'attack', 'flee', 'resolved'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function validateVisit(value: unknown): string | null {
  if (!isRecord(value)) return 'visitedFloors 条目无效';
  for (const key of VISIT_KEYS) {
    if (!isStringArray(value[key])) return `visitedFloors 条目的 ${key} 无效`;
  }
  return null;
}

function validateActiveEvent(value: unknown): string | null {
  if (value === null) return null;
  if (!isRecord(value)) return 'worldEvents.activeEvent 无效';
  if (!EVENT_TYPES.includes(value.type as ActiveEvent['type'])) return 'worldEvents.activeEvent.type 无效';
  if (typeof value.message !== 'string') return 'worldEvents.activeEvent.message 无效';
  if (value.floor !== undefined && (typeof value.floor !== 'number' || !PLAYABLE_FLOORS_V01.includes(value.floor))) {
    return 'worldEvents.activeEvent.floor 无效';
  }
  if (value.source !== undefined && value.source !== 'night' && value.source !== 'dwell') {
    return 'worldEvents.activeEvent.source 无效';
  }
  if (value.status !== undefined && !EVENT_STATUSES.includes(value.status as NonNullable<ActiveEvent['status']>)) {
    return 'worldEvents.activeEvent.status 无效';
  }
  return null;
}

// B3-15: optional so pre-dwell saves stay valid; when present it must be
// well-formed because GameScene ticks it without a guard.
function validateDwell(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isRecord(value)) return 'worldEvents.dwell 无效';
  if (typeof value.floor !== 'number' || !Number.isInteger(value.floor)) return 'worldEvents.dwell.floor 无效';
  if (typeof value.minutes !== 'number' || !Number.isFinite(value.minutes) || value.minutes < 0) {
    return 'worldEvents.dwell.minutes 无效';
  }
  if (typeof value.nextRollAt !== 'number' || !Number.isFinite(value.nextRollAt) || value.nextRollAt < 0) {
    return 'worldEvents.dwell.nextRollAt 无效';
  }
  if (typeof value.rolls !== 'number' || !Number.isInteger(value.rolls) || value.rolls < 0) {
    return 'worldEvents.dwell.rolls 无效';
  }
  return null;
}

const DIARY_KINDS: DiaryEvent['kind'][] = [
  'returned_from_scavenge',
  'late_return',
  'combat_wounded',
  'shelter_rested',
  'shelter_treated',
  'shelter_repaired',
  'neighbor_cared',
  'shelter_attacked',
];
const SHELTER_ACTIONS: ShelterPlan['action'][] = ['rest', 'treat', 'repair', 'care'];

function validateDiary(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return 'diary 无效';
  if (value.length > 64) return 'diary 超过 64 条上限';
  for (const [index, raw] of value.entries()) {
    if (!isRecord(raw)) return `diary.${index} 无效`;
    if (typeof raw.id !== 'string' || raw.id.length === 0) return `diary.${index}.id 无效`;
    if (typeof raw.day !== 'number' || !Number.isInteger(raw.day) || raw.day < 1) return `diary.${index}.day 无效`;
    if (typeof raw.minute !== 'number' || !Number.isInteger(raw.minute) || raw.minute < 0 || raw.minute >= 1440) {
      return `diary.${index}.minute 无效`;
    }
    if (typeof raw.floor !== 'number' || !Number.isInteger(raw.floor)) return `diary.${index}.floor 无效`;
    if (!DIARY_KINDS.includes(raw.kind as DiaryEvent['kind'])) return `diary.${index}.kind 无效`;
    if (!isStringArray(raw.actorIds)) return `diary.${index}.actorIds 无效`;
    if (!Array.isArray(raw.itemChanges)) return `diary.${index}.itemChanges 无效`;
    for (const change of raw.itemChanges) {
      if (!isRecord(change) || typeof change.itemId !== 'string' || !isItemId(change.itemId)) {
        return `diary.${index}.itemChanges.itemId 无效`;
      }
      if (typeof change.quantity !== 'number' || !Number.isInteger(change.quantity) || change.quantity === 0) {
        return `diary.${index}.itemChanges.quantity 无效`;
      }
    }
    if (typeof raw.stressDelta !== 'number' || !Number.isFinite(raw.stressDelta)) {
      return `diary.${index}.stressDelta 无效`;
    }
    if (typeof raw.message !== 'string') return `diary.${index}.message 无效`;
  }
  return null;
}

function validateShelterPlan(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isRecord(value)) return 'shelterPlan 无效';
  if (typeof value.day !== 'number' || !Number.isInteger(value.day) || value.day < 1) return 'shelterPlan.day 无效';
  if (!SHELTER_ACTIONS.includes(value.action as ShelterPlan['action'])) return 'shelterPlan.action 无效';
  if (typeof value.resolved !== 'boolean') return 'shelterPlan.resolved 无效';
  return null;
}

// OVERHAUL: the three additive state blocks. Optional so pre-overhaul saves
// load; when present each must be well-formed because systems read them
// without guards.
function validateOverhaulBlocks(s: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const goal = s.dailyGoal;
  if (goal !== undefined) {
    if (!isRecord(goal)) errors.push('dailyGoal 无效');
    else {
      if (typeof goal.day !== 'number' || !Number.isInteger(goal.day)) errors.push('dailyGoal.day 无效');
      if (!['water', 'containers', 'upgrade', 'floor'].includes(goal.kind as string)) errors.push('dailyGoal.kind 无效');
      if (typeof goal.target !== 'number' || !Number.isInteger(goal.target) || (goal.target as number) < 1) {
        errors.push('dailyGoal.target 无效');
      }
      if (typeof goal.done !== 'boolean') errors.push('dailyGoal.done 无效');
    }
  }
  const records = s.records;
  if (records !== undefined) {
    if (!isRecord(records)) errors.push('records 无效');
    else {
      if (typeof records.deepestFloor !== 'number' || !Number.isInteger(records.deepestFloor)) {
        errors.push('records.deepestFloor 无效');
      }
      if (typeof records.bestScore !== 'number' || !Number.isFinite(records.bestScore) || (records.bestScore as number) < 0) {
        errors.push('records.bestScore 无效');
      }
    }
  }
  const encounters = s.encounters;
  if (encounters !== undefined) {
    if (!isRecord(encounters)) errors.push('encounters 无效');
    else for (const [k, v] of Object.entries(encounters)) {
      if (typeof v !== 'string') errors.push(`encounters.${k} 无效`);
    }
  }
  // World flags. Absent is fine - a save written before the system loads without
  // one and the store is created on the next write. Present must be numbers.
  const flags = s.flags;
  if (flags !== undefined) {
    if (!isRecord(flags)) errors.push('flags 无效');
    else for (const [k, v] of Object.entries(flags)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`flags.${k} 无效`);
    }
  }
  const diaryError = validateDiary(s.diary);
  if (diaryError) errors.push(diaryError);
  const shelterError = validateShelterPlan(s.shelterPlan);
  if (shelterError) errors.push(shelterError);
  return errors;
}

export function validateGameState(data: unknown): string[] {
  if (typeof data !== 'object' || data === null) return ['存档不是有效对象'];
  const s = data as Record<string, unknown>;
  const errors: string[] = [];

  if (s.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`不支持的存档版本 schemaVersion=${String(s.schemaVersion)}（需要 ${SCHEMA_VERSION}）`);
  }
  if (typeof s.runSeed !== 'number' || !Number.isInteger(s.runSeed) || s.runSeed < 0) errors.push('runSeed 无效');
  if (typeof s.day !== 'number' || !Number.isInteger(s.day) || s.day < 1) errors.push('day 无效');
  if (typeof s.gameMinuteOfDay !== 'number' || s.gameMinuteOfDay < 0 || s.gameMinuteOfDay >= 1440) {
    errors.push('gameMinuteOfDay 超出范围');
  }
  if (typeof s.currentFloor !== 'number' || !Number.isInteger(s.currentFloor)) errors.push('currentFloor 无效');
  else if (!PLAYABLE_FLOORS_V01.includes(s.currentFloor)) {
    errors.push(`currentFloor ${String(s.currentFloor)} 不在可玩楼层范围`);
  }
  if (s.status !== 'playing' && s.status !== 'won' && s.status !== 'lost') errors.push('status 无效');

  const player = s.player as Record<string, unknown> | undefined;
  if (!player || typeof player !== 'object') {
    errors.push('缺少 player');
  } else {
    // Read unconditionally by GameScene/FloorSystem: a missing or non-finite x
    // silently poisons movement into NaN instead of failing loudly (GHI-03 C1).
    if (typeof player.x !== 'number' || !Number.isFinite(player.x)) errors.push('player.x 无效');
    for (const key of ['hp', 'hunger', 'thirst', 'energy'] as const) {
      const v = player[key];
      // Ceilings come from the balance config, not a hardcoded 100 — otherwise
      // tuning hpMax would make the validator reject legitimately-saved runs
      // (GHI-03 m3).
      if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > STAT_MAX[key]) {
        errors.push(`player.${key} 超出范围`);
      }
    }
    if (player.stress !== undefined && (typeof player.stress !== 'number' || Number.isNaN(player.stress) || player.stress < 0 || player.stress > 100)) {
      errors.push('player.stress 超出范围');
    }
    if (player.equipped !== null && (typeof player.equipped !== 'string' || !isItemId(player.equipped))) {
      errors.push('player.equipped 无效');
    }
    // Body heat. Optional, like the flag store: a save written before the
    // environment system loads without it and the value is re-created on the
    // next tick. Present must be in range.
    if (player.bodyTemp !== undefined) {
      const v = player.bodyTemp;
      if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > BODY_TEMP_MAX) {
        errors.push('player.bodyTemp 超出范围');
      }
    }
    // Ailments. Optional for the same reason: a save written before the sickness
    // system loads with none, which is the correct reading of a healthy run.
    if (player.ailments !== undefined) {
      if (!Array.isArray(player.ailments)) errors.push('player.ailments 无效');
      else {
        for (const a of player.ailments) {
          const id = (a as { id?: unknown }).id;
          const sev = (a as { severity?: unknown }).severity;
          if (typeof id !== 'string' || !(id in AILMENTS)) errors.push(`player.ailments.${String(id)} 未知病症`);
          else if (typeof sev !== 'number' || Number.isNaN(sev) || sev < 0 || sev > 100) {
            errors.push(`player.ailments.${id}.severity 超出范围`);
          }
        }
      }
    }
    if (!isStringArray(player.homeUpgrades)) errors.push('player.homeUpgrades 无效');
    const inv = player.inventory as Record<string, unknown> | undefined;
    if (!inv || typeof inv !== 'object' || !Array.isArray(inv.slots)) {
      errors.push('player.inventory 无效');
    } else {
      if (typeof inv.slotCount !== 'number' || inv.slotCount < 0) errors.push('inventory.slotCount 无效');
      if (typeof inv.slotCount === 'number' && inv.slots.length > inv.slotCount) errors.push('背包格数超出上限');
      for (const raw of inv.slots as unknown[]) {
        const e = validateStack(raw);
        if (e) errors.push(e);
      }
    }
  }

  // Everything below is dereferenced without a guard by getFloorView() and the
  // scene layer, so an unchecked save here became a white screen (GHI-03 C1).
  if (!isRecord(s.npcStates)) errors.push('npcStates 无效');
  if (!isRecord(s.visitedFloors)) {
    errors.push('visitedFloors 无效');
  } else {
    for (const [floor, visit] of Object.entries(s.visitedFloors)) {
      const e = validateVisit(visit);
      if (e) errors.push(`${e}（floor ${floor}）`);
    }
  }
  if (!isRecord(s.worldEvents)) {
    errors.push('worldEvents 无效');
  } else {
    const we = s.worldEvents;
    if (!isStringArray(we.history)) errors.push('worldEvents.history 无效');
    const e = validateActiveEvent(we.activeEvent);
    if (e) errors.push(e);
    const d = validateDwell(we.dwell);
    if (d) errors.push(d);
  }
  errors.push(...validateOverhaulBlocks(s));
  return errors;
}

export function deserialize(json: string): SaveResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: '存档损坏：无法解析 JSON' };
  }
  const errors = validateGameState(data);
  if (errors.length > 0) {
    return { ok: false, error: `存档损坏：${errors.join('；')}` };
  }
  const state = data as GameState;
  // OVERHAUL Wave C: gold arrived after the first saves existed. A save that
  // predates it is not corrupt — it just starts the run broke. Repair rather
  // than reject, so nobody loses a run to a field they never had.
  if (typeof state.player.gold !== 'number' || !Number.isFinite(state.player.gold)) {
    state.player.gold = 0;
  }
  if (state.player.stress === undefined) state.player.stress = 20;
  if (state.diary === undefined) state.diary = [];
  return { ok: true, state };
}

// LocalStorage persistence. A missing key is a normal "no save yet", not a
// corrupt save; a present-but-invalid payload returns the graceful error.
// Best-effort on write: a rejected setItem (quota, private mode) must not break
// the caller — the M3 autosave runs from update(), where a throw would kill the
// frame loop (GHI-03 m5).
//
// The boolean alone was not enough: every call site ignored it, so a rejected
// write was completely silent and the player lost the run without ever being
// told (B3-01 D9). The count below is what makes the failure visible — the scene
// polls it and warns when it grows, which covers every call site at once.
let saveFailures = 0;

export function saveToStorage(state: GameState, storage: Storage = localStorage): boolean {
  try {
    storage.setItem(SAVE_KEY, serialize(state));
    return true;
  } catch {
    saveFailures += 1;
    return false;
  }
}

// Rejected writes since the page loaded. Non-zero means progress is not being
// persisted. It only ever grows, so a caller detects a *new* failure by comparing
// against the value it saw last — which is what keeps the warning to one flash
// instead of one per frame.
export function saveFailureCount(): number {
  return saveFailures;
}

export function loadFromStorage(storage: Storage = localStorage): SaveResult {
  const raw = storage.getItem(SAVE_KEY);
  if (raw === null) return { ok: false, error: '没有存档' };
  return deserialize(raw);
}

export function clearSave(storage: Storage = localStorage): void {
  storage.removeItem(SAVE_KEY);
}

export function hasSave(storage: Storage = localStorage): boolean {
  return storage.getItem(SAVE_KEY) !== null;
}
