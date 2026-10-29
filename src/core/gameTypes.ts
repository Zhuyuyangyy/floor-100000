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
  // OVERHAUL Wave C: the run's spendable money (shops, shortcuts).
  gold: number;
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

// OVERHAUL Wave A: the live turn-based combat state. Present only while a
// combat encounter (ambush / boss) is being fought; absent the rest of the
// time. Optional so pre-combat saves stay loadable.
export interface CombatMonster {
  id: number;
  name: string;
  hp: number;
  maxHp: number;
  damage: number;
  accuracy: number;
  defense: number;
  evasion: number;
  behavior: string;
}

export interface CombatState {
  kind: 'ambush' | 'boss';
  floor: number;
  spotId: string;
  monster: CombatMonster;
  /** the player is guarding until the monster's next hit lands */
  guarding: boolean;
  /** 1-based; the ambusher's first-strike bonus applies on turn 1 */
  turn: number;
  /** rolling combat log, newest last; the panel renders the tail */
  log: string[];
}

// OVERHAUL Wave B: cross-run meta-progression, persisted outside the save
// (localStorage 'floor100000.meta.v1') so a wiped run keeps its unlocks.
export interface MetaProgress {
  unlockedCharacters: string[];
  selectedCharacter: string;
  bestDepth: number;
  mode: 'quick' | 'adventure' | 'easy';
  relics: string[];
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
  // OVERHAUL (docs/OVERHAUL_M1.md): the day's rolled objective. Optional so
  // saves written before the system existed stay loadable.
  dailyGoal?: { day: number; kind: 'water' | 'containers' | 'upgrade' | 'floor'; target: number; done: boolean };
  // OVERHAUL: cross-run bragging records. Persisted so a new run can see them.
  records?: { deepestFloor: number; bestScore: number };
  // OVERHAUL: encounter spotId -> resolved outcome key, so a spot never pays twice.
  encounters?: Record<string, string>;
  // OVERHAUL Wave A: the live combat, if one is being fought.
  combat?: CombatState;
  // OVERHAUL Wave B2/B3: the run's mode and its earned relics, copied from the
  // meta at run start. Optional so pre-B saves stay loadable.
  mode?: 'quick' | 'adventure' | 'easy';
  relics?: string[];
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
