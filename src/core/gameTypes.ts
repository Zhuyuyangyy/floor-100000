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

export interface Item {
  id: ItemId;
  displayName: string;
  category: ItemCategory;
  stackable: boolean;
  maxStack: number;
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
  hp: number;
  hunger: number;
  thirst: number;
  energy: number;
  inventory: Inventory;
  equipped: ItemId | null;
  homeUpgrades: string[];
}

export type GameStatus = 'playing' | 'won' | 'lost';

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
  npcStates: Record<string, string>;
  visitedFloors: Record<number, FloorVisit>;
  worldEvents: { history: string[]; activeEvent: string | null };
  status: GameStatus;
}

// A resolved container produced by deterministic world generation.
export interface GeneratedContainer {
  id: string;
  label: string;
  items: InventoryStack[];
}

export interface GeneratedFloor {
  floorNumber: number;
  name: string;
  containers: GeneratedContainer[];
}
