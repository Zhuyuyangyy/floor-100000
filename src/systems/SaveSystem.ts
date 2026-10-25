import { SAVE_KEY, SCHEMA_VERSION } from '../core/constants';
import { getItem, isItemId } from '../data/items';
import type { GameState } from '../core/gameTypes';

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
  if (s.status !== 'playing' && s.status !== 'won' && s.status !== 'lost') errors.push('status 无效');

  const player = s.player as Record<string, unknown> | undefined;
  if (!player || typeof player !== 'object') {
    errors.push('缺少 player');
  } else {
    for (const key of ['hp', 'hunger', 'thirst', 'energy'] as const) {
      const v = player[key];
      if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > 100) errors.push(`player.${key} 超出范围`);
    }
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
  return { ok: true, state: data as GameState };
}

// LocalStorage persistence. A missing key is a normal "no save yet", not a
// corrupt save; a present-but-invalid payload returns the graceful error.
export function saveToStorage(state: GameState, storage: Storage = localStorage): void {
  storage.setItem(SAVE_KEY, serialize(state));
}

export function loadFromStorage(storage: Storage = localStorage): SaveResult {
  const raw = storage.getItem(SAVE_KEY);
  if (raw === null) return { ok: false, error: '没有存档' };
  return deserialize(raw);
}

export function clearSave(storage: Storage = localStorage): void {
  storage.removeItem(SAVE_KEY);
}
