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

export type DiaryEventKind =
  | 'returned_from_scavenge'
  | 'late_return'
  | 'combat_wounded'
  | 'shelter_rested'
  | 'shelter_treated'
  | 'shelter_repaired'
  | 'neighbor_cared'
  | 'shelter_attacked';

export interface DiaryEvent {
  id: string;
  day: number;
  minute: number;
  floor: number;
  kind: DiaryEventKind;
  actorIds: string[];
  itemChanges: Array<{ itemId: ItemId; quantity: number }>;
  stressDelta: number;
  message: string;
}

export type ShelterAction = 'rest' | 'treat' | 'repair' | 'care';

export interface ShelterPlan {
  day: number;
  action: ShelterAction;
  resolved: boolean;
}

// Ailments: the middle ground between "fine" and "dead".
//
// Before this the run had no state between healthy and lost — hunger, thirst,
// cold and wounds all drained a bar and then took HP, so the only feedback was a
// number falling. This War of Mine distinguishes DwellerSickness from
// DwellerSicknessNoEffect in its diary (docs/reference/TWOM_MECHANICS.md §1), and
// its scene loop runs ProcessSickness alongside ProcessSleep: an ailment is a
// condition the survivor carries, not a faster way to lose.
export type AilmentId = 'cold' | 'fever' | 'wound' | 'food_poisoning';

/** One active ailment and how far it has progressed, 0..100. */
export interface Ailment {
  id: AilmentId;
  /** 0..100; at 100 the ailment starts costing HP directly */
  severity: number;
  /** game-minute it began, for the HUD's "病了 X 小时" */
  sinceMinute: number;
}

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
  /** Cross-day emotional pressure, 0..100. Optional for pre-shelter saves. */
  stress?: number;
  // Body heat, 0..100, 100 being warm. It drains toward the floor's cold and is
  // restored by standing in a warmth source's radius. Optional so saves written
  // before the environment system stay loadable — a missing one is re-created on
  // the next tick. See systems/EnvironmentSystem.ts.
  bodyTemp?: number;
  // Active ailments. Optional for the same reason: a save written before the
  // sickness system loads with none, which is the correct reading.
  ailments?: Ailment[];
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
  /** Lifecycle for autonomous events. Missing means active for legacy saves. */
  status?: 'active' | 'attack' | 'flee' | 'resolved';
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

// ── 四条成长线（docs/GAME_DESIGN_LOCK.md §4）────────────────────────────
// 设计锁定要求四条线「必须能在架构上互相影响」，首版不必做深、但底层数据
// 结构必须允许。这里是那份结构：四条线共用同一份存档块 GrowthProfile，
// 跨线影响全部走 growth.ts 的纯函数。规则只有一条——任何系统想改成长，
// 只能调 grantGrowthXp；想读跨线影响，只能调 growth.ts 里对应的函数。
// 不允许在场景或系统里手写 profile.connections.level * 0.03 这类公式，
// 否则四条线的平衡会散落在十个文件里，改一个系数要全局搜。

export type GrowthLineId = 'survival' | 'wealth' | 'connections' | 'power';

export interface GrowthLine {
  /** 当前等级，1..GROWTH_MAX_LEVEL（见 growth.ts）。 */
  level: number;
  /** 当前等级内的经验，0..xpToNext(level)。满级时恒为 0。 */
  xp: number;
  /**
   * 终生累计经验，只增不减。满级后经验也只进这里——满级的 xp 没有
   * 「下一级」可指向，继续累加只会让 UI 显示一条永远走不完的进度条。
   * 同时它是存档迁移的安全网：老字段缺失时按 0 重建，不影响等级。
   */
  totalXp: number;
}

// 为什么四条线都用 level/xp 而不是各自一个 0..100 进度条：
// 1. 四条线分属四个 Owner（生存/经济/NPC/权力），一套曲线、一个写入入口、
//    一种存档形状，漂移面最小；0..100 的自由进度会让每个系统各自发明一套
//    阈值语义（「70 算高还是 80 算高」）。
// 2. 设计锁定的跨线影响是离散判断（「权力解锁高层配方」「人脉降低交易
//    价格」），读等级比读连续值干净；等级内的细腻度由 xp/xpToNext 保留，
//    等效于一条 0..100 的进度，只是显示层的事。
// 3. 与既有词汇一致：通行凭证链是离散档位，每日目标 target 是整数，
//    等级制是玩家已经读得懂的语言。
export interface GrowthProfile {
  /** 生存能力：体温/饥渴/伤势/抗寒耐饿。见 growth.ts 的 XP 来源表。 */
  survival: GrowthLine;
  /** 财富与产业：金币、材料、可投资资产。金币本身在 player.gold。 */
  wealth: GrowthLine;
  /** 人脉与声望：NPC 关系、阵营声望。逐 NPC 细节在 npcStates（AG-06）。 */
  connections: GrowthLine;
  /** 权力与影响力：凭证链进度、区域控制、情报。 */
  power: GrowthLine;
  /**
   * 情报 0..100（权力线细节，GAME_DESIGN_LOCK §4「情报」）。
   * 暂无生产者——预留字段，见 docs/plans/GROWTH_INTERFACES.md。
   */
  intel: number;
  /**
   * 玩家已控制的可玩段 id（权力线细节「区域控制」）。暂无生产者。
   * 取值来自 PLAYABLE_SEGMENTS 的 id（1..6）。
   */
  controlledSegments: number[];
  /**
   * 已投入产业的金币（财富线细节「可投资资产」）。由 AG-05 经济系统写入。
   * 注意与 player.gold 的分工：gold 是手上的现钱，这里是沉下去的资本。
   */
  investedGold: number;
  /** 已投资的产业/商路 id（财富线细节）。由 AG-05 经济系统写入。 */
  ventures: string[];
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
  /** Recent facts the player has lived through. Optional for legacy saves. */
  diary?: DiaryEvent[];
  /** The one shelter decision currently being resolved, if any. */
  shelterPlan?: ShelterPlan;
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
  // OVERHAUL Wave C2: how many paid shortcuts this run has taken — the price
  // inflation counter.
  shortcuts?: number;
  // World flags: one flat place to answer "has this happened yet". Optional so
  // saves written before the system existed stay loadable — a missing one is
  // created on the next write. See systems/WorldFlags.ts for why this exists.
  flags?: Record<string, number>;
  // 四条成长线（docs/GAME_DESIGN_LOCK.md §4）。可选是为了旧存档：growth 到来
  // 之前写下的存档没有这个字段，而 SaveSystem 不因缺字段拒档（也不该为了一个
  // 新增块去升 schemaVersion——那会让所有旧存档变成「版本不支持」）。旧存档
  // 加载后 growth 为 undefined，首个读者必须先过 ensureGrowth() 补默认值，
  // 见 core/growth.ts。没有任何系统在 ensureGrowth 之前读它，所以老存档不会崩。
  growth?: GrowthProfile;
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
