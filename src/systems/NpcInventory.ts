import type { GameState, InventoryStack, ItemId } from '../core/gameTypes';
import { getItem, isItemId } from '../data/items';

/** Private optional extension inside npcStates[npcId]; no GameState schema field is added. */
const INVENTORY_FIELD = 'competitionInventory';
const LEGACY_RAW_FIELD = 'legacyRaw';
const LEGACY_VALUE_FIELD = 'legacyValue';
const LEGACY_INVENTORY_FIELD = 'legacyCompetitionInventory';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate and normalize an untrusted inventory, returning a fresh value. */
function normalizeInventory(value: unknown): InventoryStack[] | null {
  if (!Array.isArray(value)) return null;

  const inventory: InventoryStack[] = [];
  for (const raw of value as unknown[]) {
    if (!isRecord(raw) || !Object.prototype.hasOwnProperty.call(raw, 'itemId') || !Object.prototype.hasOwnProperty.call(raw, 'quantity')) {
      return null;
    }
    if (typeof raw.itemId !== 'string' || !isItemId(raw.itemId)) return null;
    if (typeof raw.quantity !== 'number' || !Number.isSafeInteger(raw.quantity) || raw.quantity < 1 || raw.quantity > getItem(raw.itemId).maxStack) {
      return null;
    }

    const stack: InventoryStack = { itemId: raw.itemId as ItemId, quantity: raw.quantity };
    if (raw.meta !== undefined) {
      if (!isRecord(raw.meta)) return null;
      const metaKeys = Reflect.ownKeys(raw.meta);
      if (metaKeys.some((key) => typeof key !== 'string' || !Object.prototype.propertyIsEnumerable.call(raw.meta, key))) return null;
      const entries: Array<[string, string]> = [];
      for (const key of metaKeys as string[]) {
        const entry = raw.meta[key];
        if (typeof entry !== 'string') return null;
        entries.push([key, entry]);
      }
      try {
        const serializedMeta = JSON.stringify(Object.fromEntries(entries));
        if (serializedMeta === undefined) return null;
        const clonedMeta: unknown = JSON.parse(serializedMeta);
        if (!isRecord(clonedMeta) || Object.values(clonedMeta).some((entry) => typeof entry !== 'string')) return null;
        stack.meta = clonedMeta as Record<string, string>;
      } catch {
        return null;
      }
    }
    inventory.push(stack);
  }

  return inventory;
}

/**
 * Read one NPC's optional AI playtest inventory. Missing maps/fields, malformed
 * JSON, and invalid stored inventory all read as an empty inventory. Every call
 * returns a deep copy, including nested metadata.
 */
export function loadNpcInventory(state: Pick<GameState, 'npcStates'>, npcId: string): InventoryStack[] {
  const record = getNpcRecord(state, npcId);
  if (!record) return [];
  return normalizeInventory(record[INVENTORY_FIELD]) ?? [];
}

/**
 * Replace an NPC's complete AI playtest inventory. Invalid candidates are
 * rejected without mutating state. Other NPC JSON keys are retained, and
 * unparseable/non-object legacy blobs are wrapped so their original value stays
 * recoverable on the first write.
 */
export function saveNpcInventory(state: GameState, npcId: string, candidate: readonly InventoryStack[]): boolean {
  if (typeof npcId !== 'string' || npcId.length === 0) return false;

  let inventory: InventoryStack[] | null;
  try {
    inventory = normalizeInventory(candidate);
  } catch {
    return false;
  }
  if (!inventory) return false;

  try {
    const mutableState = state as GameState & { npcStates?: Record<string, string> };
    const hasNpcMap = isRecord(mutableState.npcStates);
    const record = getNpcRecord(mutableState, npcId) ?? {};
    const previous = record[INVENTORY_FIELD];
    if (previous !== undefined && normalizeInventory(previous) === null && !(LEGACY_INVENTORY_FIELD in record)) {
      record[LEGACY_INVENTORY_FIELD] = previous;
    }
    record[INVENTORY_FIELD] = inventory;
    const serializedRecord = JSON.stringify(record);
    if (serializedRecord === undefined) return false;

    if (hasNpcMap) {
      // NPC IDs are data, not object property names with special behavior.
      // Define an own data property so e.g. "__proto__" persists normally.
      Object.defineProperty(mutableState.npcStates, npcId, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: serializedRecord,
      });
    } else {
      const npcStates: Record<string, string> = {};
      Object.defineProperty(npcStates, npcId, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: serializedRecord,
      });
      mutableState.npcStates = npcStates;
    }
    return true;
  } catch {
    return false;
  }
}

function getNpcRecord(state: Pick<GameState, 'npcStates'>, npcId: string): JsonRecord | null {
  if (typeof npcId !== 'string' || npcId.length === 0) return null;
  const npcStates = (state as { npcStates?: unknown }).npcStates;
  if (!isRecord(npcStates)) return null;
  if (!Object.prototype.hasOwnProperty.call(npcStates, npcId)) return null;
  const raw = npcStates[npcId];
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed)) return parsed;
    // Preserve valid but non-object legacy JSON when this adapter first writes.
    return { [LEGACY_VALUE_FIELD]: parsed };
  } catch {
    // Preserve malformed historical bytes without changing them until a write.
    return { [LEGACY_RAW_FIELD]: raw };
  }
}
