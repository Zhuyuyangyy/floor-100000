// Core data model for《第100000层：末日宿舍》(docs/02_TECH_SPEC.md §4).
// Single source of truth is GameState; all mutations go through explicit
// logic functions. Phaser only renders/syncs from this.

export type ItemId =
  | 'clean_water'
  | 'dirty_water'
  | 'ration_pack'
  | 'bread'
  | 'battery'
  | 'scrap_metal'
  | 'wood'
  | 'cloth'
  | 'tape'
  | 'filter'
  | 'wire'
  | 'medkit'
  | 'crowbar'
  | 'fuse'
  | 'flashlight';

export type ItemCategory = 'consumable' | 'material' | 'tool';

export type StatKey = 'hp' | 'hunger' | 'thirst' | 'energy';

export interface ItemEffect {
  stat: StatKey;
  amount: number;
}

export interface Item {
  id: ItemId;
  displayName: string;
  category: ItemCategory;
  stackable: boolean;
  maxStack: number;
  effect?: ItemEffect;
}

// Per-instance state that does not belong to the item definition (e.g. a
// flashlight's remaining charge).
export interface InventoryStack {
  itemId: ItemId;
  quantity: number;
  meta?: Record<string, string>;
}

export interface Inventory {
  slotCount: number;
  slots: InventoryStack[];
}

export interface PlayerState {
  x: number;
  hp: number;
  hunger: number;
  thirst: number;
  energy: number;
  inventory: Inventory;
  // Reserved by docs/02_TECH_SPEC.md §4 for v0.2 equipment; no v0.1 system reads
  // or writes it beyond the initial null (GHI-03 n3).
  equipped: ItemId | null;
  homeUpgrades: string[];
}

export type GameStatus = 'playing' | 'won' | 'lost';

// A seed-determined night event (docs/01_GDD.md §10). At most one per day.
export interface ActiveEvent {
  type: 'blackout' | 'wanderer' | 'leak';
  floor?: number;
  message: string;
  // B3-15: which machinery rolled it. 'night' events only act at night; 'dwell'
  // ones (the player lingered too long on one floor) act whenever the player is
  // on that floor, day or night.
  source?: 'night' | 'dwell';
}

// B3-15: how long the player has been lingering on one floor, and how many
// dwell-pressure rolls that has earned. Optional so saves written before the
// system existed stay loadable — a missing one is re-created on the next tick.
export interface DwellState {
  floor: number;
  minutes: number;
  nextRollAt: number;
  rolls: number;
}

// Player-caused changes layered over the deterministic base layout of a floor.
export interface FloorVisit {
  openedContainers: string[];
  lootedItems: string[];
  unlockedDoors: string[];
  localEvents: string[];
}

export interface GameState {
  schemaVersion: number;
  runSeed: number;
  day: number;
  gameMinuteOfDay: number;
  currentFloor: number;
  player: PlayerState;
  // Reserved by docs/02_TECH_SPEC.md §4 for v0.2 NPC state; no v0.1 system reads
  // or writes it beyond the initial empty map (GHI-03 n3).
  npcStates: Record<string, string>;
  visitedFloors: Record<number, FloorVisit>;
  worldEvents: { history: string[]; activeEvent: ActiveEvent | null; dwell?: DwellState };
  status: GameStatus;
}

// A resolved container produced by deterministic world generation.
export interface GeneratedContainer {
  id: string;
  label: string;
  x: number;
  items: InventoryStack[];
}

// A loose item lying on the floor, picked up on contact.
export interface GroundItem {
  key: string;
  itemId: ItemId;
  quantity: number;
  x: number;
  meta?: Record<string, string>;
}

export interface GeneratedFloor {
  floorNumber: number;
  name: string;
  containers: GeneratedContainer[];
  groundItems: GroundItem[];
}
