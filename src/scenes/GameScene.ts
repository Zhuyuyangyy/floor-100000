import Phaser from 'phaser';

import { PALETTE, TEXT, hex } from '../render/palette.ts';
import { playFx, startFxLoop } from '../render/fx';
import { DESIGN_HEIGHT, DESIGN_WIDTH, isPortraitViewport, portraitViewportFor } from '../core/design';
import { getGame, startNewGame } from '../core/session';
import {
  BED_X,
  CHAPTER1_CLEAR_FLOOR,
  CRAFT_X,
  DOWN_EXIT_X,
  FLOOR_VIEW_ZOOM,
  ENTRY_X,
  FLOOR_BAND,
  FLOOR_HEIGHT,
  FLOOR_WIDTH,
  INTERACT_DISTANCE,
  PLAYABLE_FLOORS_V01,
  PLAYER_FEET_Y,
  PLAYER_SPEED,
  ROOM_COUNT,
  ROOM_WIDTH,
  STARTING_FLOOR,
  STAIR_RISE,
  STAIR_START_Y,
  UP_EXIT_X,
  STACK_ABOVE,
  STACK_BELOW,
  WANDERER_DAMAGE,
  WANDERER_HIT_COOLDOWN_MS,
  WANDERER_MIN_SPAWN_FLOOR,
  WANDERER_SPEED,
} from '../core/constants';
import {
  completeStairTraversal,
  currentInteractionZone,
  hasDownExit,
  hasUpExit,
  movePlayerX,
  stairBendFor,
  stairPosition,
  stairStyleFor,
  stairTraversalFor,
  stepHorizontalSpeed,
  tryChangeFloor,
} from '../systems/FloorSystem';
import { getFloorView, lootContainer, lootGround, recordFloorVisit } from '../systems/LootSystem';
import { clearChapter1 } from '../systems/chapters';
import { countItem, isBagFull, STAT_LABEL, useConsumable } from '../systems/InventorySystem';
import { canCraft, craft, hasUpgrade, nightOverlayAlpha, purifyWater } from '../systems/CraftingSystem';
import { absoluteMinute, advanceTime, ACTION_COSTS, AUTOSAVE_EVERY_GAME_MINUTES, isNight, spendTime } from '../systems/SurvivalSystem';
import { ensureNightEvent, eventStatus, setEventStatus } from '../systems/EventSystem';
import { armNextRoll, dwellRollDue, ensureDwell, isDwellExempt, rollDwellEvent, tickDwell } from '../systems/dwellPressure';
import { freshWandererAI, stepWandererAI, type WandererAI } from '../systems/wandererAI';
import { ensureDailyGoal, grantDailyGoalReward, isDailyGoalDone } from '../systems/dailyGoals';
import {
  BODY_TEMP_MAX,
  COLD_THRESHOLD,
  bodyTempOf,
  environmentLabel,
  warmthAt,
} from '../systems/EnvironmentSystem';
import { ailmentLabel, inflict } from '../systems/SicknessSystem';
import { recentDiary } from '../systems/DiarySystem';
import { availableShelterActions, finishNight, resolveShelterAction } from '../systems/ShelterSystem';
import { recordDepth, runScore } from '../systems/progress';
import { CHARACTER_NAMES, applyDepth, loadMeta, saveMeta, unlockFromDepth } from '../systems/metaProgress';
import type { CharacterKey } from '../render/artpack';
import { lowHpPulse, mostUrgentStat, moveSpeedFactor } from '../render/feedback';
import { combatFeedbackSignals } from '../render/combatFeedback';
import { GAME_CONFIG } from '../core/config';
import {
  markResolved,
  resolveEncounter,
  rollEncounter as rollFloorEncounter,
  shouldSkip,
  isCombatKind,
  combatIntroMessage,
  type Encounter,
  type EncounterChoice,
} from '../systems/encounters';
import { encounterSpots, nudgeSpotX, placeClearX } from '../systems/encounterSpots';
import { applyCombatDamage, resolveRound, playerCombatant, GUARD_ENERGY_RESTORE, type CombatAction, type CombatRound, type Combatant } from '../systems/combat';
import { MONSTERS, applyBehavior, behaviorModifiers, rollMonster, shouldCowardBreakOff } from '../systems/monsters';
import { relicDamageMultForCombat, lootBonus, moveSpeedMult } from '../systems/relics';
import { modeGuardianDamageMult } from '../systems/modes';
import { buy, sell, shopStock, type ShopEntry } from '../systems/shop';
import { charge, recordShortcut, shortcutOffer } from '../systems/shortcut';
import { deriveSeed, makeRng } from '../core/rng';
import { addItem } from '../systems/InventorySystem';
import { clearSave, saveFailureEpisodeCount, saveToStorage } from '../systems/SaveSystem';
import { playSfx } from '../render/audio';
import { applyPanelDepth, buildPanel, createMarker, lockToScreen, HUD_FEEDBACK_DEPTH, PANEL_DEPTH, placeMarker, placeMarkerLeftOf, type PanelObject } from '../render/panels';
import {
  FONT_FAMILY,
  HUD_FOOT_H,
  STAT_COLORS,
  TYPE,
  UI,
  buildListRow,
  buildPanelHeader,
  buildPanelWell,
  drawStatBar,
} from '../render/uiKit';
import { ENV_FLOOR_KEY, ENV_WALL_KEY, NIGHT_OVERLAY_KEY } from '../render/artpack';
import {
  ATTACK_FRAME_START,
  ATTACK_FRAMES,
  FRAME_H,
  FRAME_W,
  WALK_CHARACTERS,
  attackAnimKey,
  attackPose,
  dieAnimKey,
  hurtAnimKey,
  idleAnimKey,
  joint,
  pickupAnimKey,
  searchAnimKey,
  walkAnimKey,
  walkSheetKey,
} from '../render/walkcycle';
import { WEAPON_H, WEAPON_W, nextWeaponVisual, weaponSwingAngle, weaponVisual, type WeaponVisualId } from '../render/weapon.ts';
import { itemIconKey } from '../render/itemIcons';
import { containerTextureKey } from '../render/furniture';
import { corridorTint, drawCorridorRoom } from '../render/corridors';
import {
  ACTOR_DEPTH,
  DUST_DEPTH,
  LIGHT_DEPTH,
  NIGHT_DEPTH,
  STACK_DEPTH,
  addGlow,
  ambienceFor,
  buildLightLayer,
  type LightLayer,
} from '../render/lighting';
import {
  addContactShadow,
  buildCeilingLights,
  buildFloorClutter,
  buildLeakEffect,
  buildForeground,
  buildRoomDepth,
  buildSurfaceDetail,
  buildAerialHaze,
  buildWallDressing,
} from '../render/roomDepth';
import { getItem } from '../data/items';
import { HUD_LAYOUT, hudClockLabel } from '../render/hudLayout';
import { RECIPES, getRecipe, type UpgradeId } from '../data/recipes';
import { getNpc, npcsOnFloor, type NpcDef, type NpcId } from '../data/npcs';
import { ALIN_REPAIR_MATERIALS, closedFloorGateForTransition, isAlinRepairGateOpen } from '../data/floorGates';
import { trade } from '../systems/TradeSystem';
import { aiNpcConfig, npcFactFromDef } from '../ai/config';
import { OllamaBrain } from '../ai/brains/ollamaBrain';
import { LocalPersonaBrain } from '../ai/brains/localPersonaBrain';
import { OptionTreeBrain } from '../ai/brains/optionTreeBrain';
import { createNpcState, createNpcStateFor, NPC_PROFILES } from '../data/npcPersonalities';
import { loadNpcState, recordMemory, saveNpcState } from '../systems/NpcMemory';
import { decideNpcAction, isDialogueFresh, type DialogueSession, type NpcRuntimeConfig } from '../systems/NpcRuntime';
import { runAlinRepairScenario, type AlinRepairModelPort, type AlinRepairScenarioResult } from '../scenarios/alinRepairDemo';
import { parseRepairIntent, type RepairIntentDecision } from '../ai/repairIntent';
import { COMPETITION_TRUST_THRESHOLDS } from '../ai/competitionRules';
import { runAlinGiftScenario, type AlinGiftScenarioResult } from '../scenarios/alinGiftDemo';
import { runSocialGiftScenario, type SocialScenarioResult } from '../scenarios/socialNpcDemo';
import {
  blackoutAlinOptionLabel,
  blackoutRepairNarration,
  dispatchBlackoutAlin,
  dispatchBlackoutTrade,
  ensureBlackoutHelpRequested,
  observeBlackout,
  runAzhenExchange,
  runBlackoutRepair,
  runXiaozhouTrade,
  syncBlackoutCrisis,
  type BlackoutModelPort,
  type BlackoutRepairResult,
  type BlackoutTradeModelPort,
  type BlackoutTradeRunResult,
} from '../scenarios/blackoutCrisis';
import { blackoutStageOf } from '../data/blackoutCrisis';
import {
  detectNpcAutonomyTrigger,
  initNpcAutonomyCursor,
  NPC_AUTONOMY_ACTOR,
  NPC_AUTONOMY_MIN_INTERVAL_MINUTES,
  npcAutonomyThrottled,
  runNpcAutonomyTick,
  type NpcAutonomyCursor,
  type NpcAutonomyModelPort,
  type NpcAutonomyProposal,
  type NpcAutonomyResult,
} from '../systems/NpcWorldTick';
import { proposeWithBrain } from '../ai/competitionModelBridge';
import { MAX_UTTERANCE } from '../ai/rulesExecutor';
import { computeDialogueLayout } from './dialogueLayout';
import { serializeAlinGiftRun, serializeAlinRepairRun, serializeSocialGiftRun } from '../ai/competitionRunExport';
import {
  createWandererDecisionConfig,
  decideWandererIntent,
  WandererAutonomyController,
  type WandererIntent,
  type WandererSituation,
} from '../systems/NpcAutonomy';
import type { NpcPersistedState } from '../ai/types';
import type { ActiveEvent, GameState, GeneratedContainer, GeneratedFloor, ItemId, ShelterAction } from '../core/gameTypes';

const INVENTORY_SLOTS = 12;
// Row pitch for the inventory list: 20px fits a full-size 16x16 icon with a 2px
// gap either side, and keeps every offset an integer (no scaling, no blur).
// Craft rows use separate name/status and material lines, with enough vertical
// pitch to keep long costs clear of the status column.
const CRAFT_ROW_PITCH = 48;
// HUD type scale (docs/05_ART_GUIDE.md §2: no size too small to read). Title 16 /
// body 13 / auxiliary 11 — all integer pixels, since any fractional size would be
// resampled and blur the pixel look.
const TYPE_BODY = 26;
const TYPE_AUX = 22;
// Keep a little breathing room between the moving actor and the fixed HUD bands.
const STAIR_CAMERA_HUD_GAP = 12;

const WANDERER_FLEE_SAFE_DISTANCE = 280;
const WANDERER_FLEE_EXIT_MARGIN = 24;

// Row pitch for the four HUD stat bars. 15px gives an 11px label plus a 7px bar
// with breathing room; 13px was too cramped to read at a glance.

const STAT_BARS: Array<{ key: 'hp' | 'hunger' | 'thirst' | 'energy'; label: string; color: number }> = [
  { key: 'hp', label: '生命', color: 0xe56d63 },
  { key: 'hunger', label: '饥饿', color: 0xf4b66a },
  { key: 'thirst', label: '口渴', color: 0x6aa8e5 },
  { key: 'energy', label: '精力', color: 0x77c6a4 },
];

// Body heat gets its own readout rather than a fifth bar: it is the one stat a
// floor owns, so it reads as "where you are" as much as "how you are". The bar
// would have said the latter and hidden the former.
const TEMP_LABEL = '体温值';

// Ailment labels, so the HUD and the item flash name the same thing the same way.
const AILMENT_LABEL: Record<string, string> = {
  cold: '冻伤',
  fever: '发烧',
  wound: '受伤',
  food_poisoning: '食物中毒',
};

// ── HUD layout (OVERHAUL UI) ────────────────────────────────────────────────
// Columns on the shared 4px grid: floor badge, clock, four stat bars (label +
// bar each), then the right-aligned score and gold. These are computed once
// here rather than sprinkled through buildHud, so moving a column is one edit.
// All doubled with the design canvas (640x360 -> 1280x720).
const PAUSE_OPTIONS = ['继续游戏', '塔楼地图', '重新开始', '返回标题'];

// OVERHAUL: the daily objective's one-line label, per goal kind.
const GOAL_LABELS: Record<'water' | 'containers' | 'upgrade' | 'floor', (target: number) => string> = {
  water: (n) => `带回 ${n} 瓶净水`,
  containers: (n) => `搜刮 ${n} 个容器`,
  upgrade: (n) => `建成 ${n} 项宿舍升级`,
  floor: (n) => `到达第 ${n} 层`,
};

// OVERHAUL: the encounter panel's vocabulary. Titles are the kind's name as the
// player should read it; labels name the choices in the player's terms.
const ENCOUNTER_TITLES: Record<Encounter['kind'], string> = {
  loot: '一处遗落物资',
  ambush: '黑暗中的伏击',
  trader: '行商',
  note: '一张纸条',
  cache: '藏匿点',
  boss: '守门人',
};
const CHOICE_LABELS: Record<EncounterChoice, string> = {
  take: '拿走',
  fight: '动手',
  flee: '撤退',
  trade: '交易（脏水×2 → 净水×1）',
  leave: '离开',
  read: '读纸条',
};
const SHELTER_ROWS: Array<{ action: ShelterAction; label: string; value: string }> = [
  { action: 'rest', label: '休息', value: '恢复精力 · 压力 -6' },
  { action: 'treat', label: '治疗', value: '医疗包 · 处理伤势' },
  { action: 'repair', label: '修理', value: '木材×2 + 胶带×1' },
  { action: 'care', label: '照顾邻居', value: '口粮×1 · 压力 -12' },
];
type GameKey = 'e' | 'esc' | 'i' | 'enter' | 'c' | 'm' | 's' | 'f' | 'q' | 'up' | 'down';
type DirKeys = {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
};

// Playable floor view (P0-02 + P0-03): scrolling corridor, movable character,
// up/down exits, lootable containers & ground items, a 12-slot inventory, and
// consumable use. GameState (session) is the source of truth; this scene only
// renders and feeds input back through pure logic functions.
export class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  /** The manually selected visual weapon in the survivor's hand. */
  private weapon?: Phaser.GameObjects.Image;
  private selectedVisualWeapon: WeaponVisualId = 'crowbar';
  private syncedVisualWeapon?: WeaponVisualId;
  private cursors!: DirKeys;
  private wasd!: { left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key };
  private keyE!: Phaser.Input.Keyboard.Key;
  private keyEsc!: Phaser.Input.Keyboard.Key;
  private keyI!: Phaser.Input.Keyboard.Key;
  private keyEnter!: Phaser.Input.Keyboard.Key;
  private portraitMode = false;
  private portraitWidth = DESIGN_WIDTH;
  private hudContextBottom: number = HUD_LAYOUT.contextBottom;
  private statBarLayout: Array<{ x: number; y: number; width: number }> = [];
  private touchDirectionPointers = new Map<number, 'left' | 'right'>();
  private clearTouchDirections = (): void => { this.touchDirectionPointers.clear(); };
  private touchControls: Array<Phaser.GameObjects.GameObject & { setVisible(visible: boolean): unknown }> = [];

  private floorView!: GeneratedFloor;
  private containerObjs = new Map<string, { box: Phaser.GameObjects.Graphics | Phaser.GameObjects.Image; label: Phaser.GameObjects.Text }>();
  private groundObjs = new Map<string, Phaser.GameObjects.Rectangle>();
  private floorObjects: Phaser.GameObjects.GameObject[] = [];
  private wanderer?: Phaser.GameObjects.Sprite;
  /** the dim red pool that makes the wanderer findable in the dark */
  private wandererGlow?: Phaser.GameObjects.Image;
  /** the hunger/thirst debuff on the player's body, present only while critical */
  private debuffFx?: Phaser.GameObjects.Sprite;
  /** every flame on this floor, so a blackout can put them out */
  private lightFixtures: Phaser.GameObjects.Sprite[] = [];
  private wasBlackout = false;
  private blackoutAt = 0;
  private wandererHitAt = Number.NEGATIVE_INFINITY;
  // OVERHAUL: the wanderer's stalk/lunge state machine. Lives beside the sprite
  // because the scene owns the movement it drives.
  private wandererAI?: WandererAI;
  private wandererIntent: WandererIntent = 'attack';
  private wandererAutonomy = new WandererAutonomyController();
  private wandererEventKey = '';
  private wandererLastEncounter = '';
  // Not field-initialised-only: a scene restart re-runs create() but not the
  // class fields, so clearFloor() zeroes this too. Left over, a restarted floor
  // would resume the run already at top speed.
  private speedX = 0;
  /** transient visual traversal; GameState changes only after landing */
  private stairClimb?: NonNullable<ReturnType<typeof stairTraversalFor>> & { elapsedMs: number };
  // OVERHAUL: a one-shot action clip (search / attack / hurt) and the time it
  // holds the sprite. Without the hold, the walk/idle selection below would
  // switch back on the very next frame and the clip would never be seen.
  private actionAnimKey = '';
  private actionAnimUntil = 0;
  private playerHitFxToken = 0;

  private clockText!: Phaser.GameObjects.Text;
  private barsGfx!: Phaser.GameObjects.Graphics;
  private statLabels: Phaser.GameObjects.Text[] = [];
  private statValues: Phaser.GameObjects.Text[] = [];
  private invCountText?: Phaser.GameObjects.Text;
  private invCells: Phaser.GameObjects.Rectangle[] = [];
  private invDetailName?: Phaser.GameObjects.Text;
  private invDetailMeta?: Phaser.GameObjects.Text;
  private invDetailBody?: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private feedbackText!: Phaser.GameObjects.Text;
  // B3-02 §4.2: a full bag used to be a 1.6s flash, so a player who filled the
  // bag on floor 3 arrived on floor 4 with no reminder and lost the next
  // container's loot to what looked like a bug. This one stays until a slot
  // frees up, so the state is readable whenever the player looks.
  private bagFullText!: Phaser.GameObjects.Text;
  private bagFullShown = false;
  // OVERHAUL: the day's objective and the run's score, top-right; the low-HP
  // vignette is a full-screen rect whose alpha the feedback module drives.
  // Optional because buildHud destroys and clears them on a scene restart
  // before recreating them — a destroyed Text throws on setText.
  private floorBadge?: Phaser.GameObjects.Text;
  private goldText?: Phaser.GameObjects.Text;
  private goalText?: Phaser.GameObjects.Text;
  /** the floor's environment line, right of the daily objective */
  private environmentText?: Phaser.GameObjects.Text;
  private scoreText?: Phaser.GameObjects.Text;
  /** the low-HP edge warning: bands with their own base weights */
  private vignetteParts: Array<{ rect: Phaser.GameObjects.Rectangle; weight: number }> = [];
  private lastGoalKey = '';
  // OVERHAUL: the floor's "?" spots and the encounter panel they open.
  private spotMarkers = new Map<string, { x: number; isBoss: boolean; dot: Phaser.GameObjects.Arc; label: Phaser.GameObjects.Text }>();
  private encounterOpen = false;
  private encounter?: { spotId: string; encounter: Encounter; choices: EncounterChoice[]; selected: number; resolved: boolean };
  private encounterObjects: Phaser.GameObjects.GameObject[] = [];
  // OVERHAUL Wave A: the live turn-based combat (state lives in
  // state.combat; this is only the panel's cursor).
  private combatSelected = 0;
  // True while the outcome screen is up (the fight is decided, one Enter left).
  private combatDone = false;
  // OVERHAUL Wave C1: the shop panel's cursor.
  private shopSelected = 0;
  private shopEntries: ShopEntry[] = [];
  // First-floor shelter decision panel: the cursor is visual state, while the
  // selected action itself is committed through ShelterSystem.
  private shelterOpen = false;
  private shelterSelected = 0;
  private shelterObjects: PanelObject[] = [];
  private shelterInputObjects: Phaser.GameObjects.Zone[] = [];
  private shelterMarker!: Phaser.GameObjects.Image;
  private feedbackTimer?: Phaser.Time.TimerEvent;
  private introFeedbackTimeout?: number;
  private lastClock = '';
  private lastStats = '';

  private invObjects: PanelObject[] = [];
  private invSlotTexts: Phaser.GameObjects.Text[] = [];
  private invSlotIcons: Phaser.GameObjects.Image[] = [];
  private invMarker!: Phaser.GameObjects.Image;
  private invSelected = 0;
  private inventoryOpen = false;

  private craftingOpen = false;
  private craftObjects: PanelObject[] = [];
  private craftRows: Array<{ band: Phaser.GameObjects.Rectangle; name: Phaser.GameObjects.Text; cost: Phaser.GameObjects.Text; status: Phaser.GameObjects.Text }> = [];
  private craftMarker!: Phaser.GameObjects.Image;
  private craftSelected = 0;
  private nightOverlay!: Phaser.GameObjects.Rectangle;
  // 夜幕的冷色纹理层（可选）。原矩形负责压暗，这一层只补色温；
  // 纹理缺失时不创建，游戏退回原来的纯压暗，行为完全不变。
  private nightTint?: Phaser.GameObjects.TileSprite;
  /** the warm pool the player carries; only visible once night falls */
  private playerLight?: Phaser.GameObjects.Image;
  // OVERHAUL Art Pass: the floor's lighting layer (warm pools, cool ambient,
  // stepped vignette). Rebuilt per floor; destroyed with the floor.
  private lightLayer?: LightLayer;
  /** the player's contact shadow, moved with them every frame */
  private playerShadow: Phaser.GameObjects.GameObject[] = [];
  /** puddles and drips while a leak event is running on this floor */
  private leakObjects: Phaser.GameObjects.GameObject[] = [];
  /** where the puddles are, so the drips land in them */
  private leakPuddleXs: number[] = [];
  private upgradeBoard!: Phaser.GameObjects.Text;
  private keyC!: Phaser.Input.Keyboard.Key;
  private keyM!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyF!: Phaser.Input.Keyboard.Key;
  private keyQ!: Phaser.Input.Keyboard.Key;

  private dialogueOpen = false;
  // sessionId/revision：AI 异步返回的保鲜键。玩家每次开对话 sessionId+1，
  // 每次操作 revision+1；过期 AI 结果不得覆盖新对话（P1-2）。
  private dialogueSessionSeq = 0;
  private dialogue: { npc: NpcId; level: 'main' | 'trade' | 'gift'; selected: number; message: string; messageSource: 'script' | 'offline-ai' | 'ollama' | 'fallback' | 'competition-offline'; lineToggle: number; sessionId: number; revision: number } | null = null;
  private dialogueGiftPage = 0;
  private dialogueGiftPending = false;
  /** Last deterministic competition result, available to Phaser integration tests. */
  private lastAlinRepairResult?: AlinRepairScenarioResult;
  /** 最近一次模型对维修表达的意图（含拒绝），供对话文案如实显示。 */
  private lastRepairIntentNote?: RepairIntentDecision;
  /**
   * 维修流程重入锁。
   *
   * 一次维修要等模型回话，中间有几百毫秒到几秒的空窗；这段时间里玩家连按
   * 交互键会把 `runAlinRepairPlan` 再跑一遍。实测并发两次的后果不算灾难
   * （第二次观测到门已开、材料已扣，自己 exhausted），但那是**靠下游状态
   * 恰好变了**兜住的，不是这条路径本身防住了——一旦哪天两次调用读到同一份
   * 观测，材料就会被扣两遍。
   *
   * 锁挂在场景实例上、不进存档：它防的是「同一瞬间的两次点击」，属于 UI
   * 层的事实，不该污染 `GameState`。也不要改成持久幂等（用 flags 记 opId）
   * ——那会让「同一分钟故意送两份同样的礼」这种合法操作被当成重复吞掉，
   * 服务端分不清「重复提交」和「重复意图」。
   */
  private repairInFlight = false;
  /**
   * 停电危机的「上次已同步到的状态」。
   *
   * 危机推进每帧都会被问到，但 `syncBlackoutCrisis` 内部要读 flag、铺库存、
   * 写过期判定——每帧都跑纯属浪费，而且每次都会返回同一句台词反复 flash。
   * 这里只记住 `${stage}:${day}`，变了才真正调用。用字段而不是 flag，是因为
   * 它只是「这一帧要不要问」的缓存，不是剧情事实，不该进存档（存档里已经
   * 有单调 stage 兜底，重开会重新走一遍初始判定）。
   */
  private blackoutSyncedKey = '';
  /**
   * 最近一次停电危机维修结果。
   *
   * 与 `lastAlinRepairResult` / `lastAlinGiftResult` 一样是 public：E2E 通过
   * `window.__PHASER_GAME__.scene.getScene('Game')` 读它来断言「危机期确实走
   * 的是危机场景」。这是既有的集成测试约定，不要改成 private。
   */
  lastBlackoutRepairResult?: BlackoutRepairResult;
  /** 最近一次小周/阿珍的危机交易结果，同样供 E2E 断言走的是哪条路径。 */
  lastBlackoutTradeResult?: BlackoutTradeRunResult;
  /**
   * 停电危机流程的重入锁。
   *
   * 与 `repairInFlight` 同因：模型回话期间玩家连按会让整个 propose→validate→
   * execute 循环并发两遍。维修那条已经证明「靠下游状态恰好变了兜住」不可靠，
   * 这里从一开始就把锁加上。
   */
  private blackoutInFlight = false;
  /**
   * 自主 tick 的世界游标：上一次看到的世界长什么样。
   *
   * 只用来判断「这一帧有没有发生世界事件」（阶段变化 / 跨整点）。它是**缓存**
   * 不是剧情事实，所以不进存档：重开局后重新初始化即可，真正决定「这件事是不是
   * 已经做过」的是 flag（见 `NPC_AUTONOMY_FLAG.handled`）。
   */
  private npcAutonomyCursor?: NpcAutonomyCursor;
  /** 自主 tick 的重入锁：模型回话期间不再发起第二轮。 */
  private npcAutonomyInFlight = false;
  /**
   * 最近一次自主 tick 的结果。Judge Mode 面板靠它展示「这次是谁动的」。
   *
   * 与其它 `last*Result` 一样是 public：E2E 与评审要能读到「世界触发过自主
   * 行为」的证据，而不是只能相信界面上的字。
   */
  lastNpcAutonomyResult?: NpcAutonomyResult;
  /** Last gift result, exposed like the repair result for browser integration diagnostics. */
  lastAlinGiftResult?: AlinGiftScenarioResult;
  /** 最近一次赠礼结果；阿林走单 NPC 场景，小周走多 NPC 场景。 */
  lastGiftResult?: AlinGiftScenarioResult | SocialScenarioResult;
  private judgePanel?: HTMLElement;
  /** Judge Mode 的折叠标题：来源与焦点 NPC 必须说真话，见 updateJudgeToggle。 */
  private judgeToggle?: HTMLButtonElement;
  private judgePanelContent?: HTMLPreElement;
  private judgeExportButton?: HTMLButtonElement;
  private judgeExpanded = false;
  private judgeLatestResult?: AlinGiftScenarioResult | AlinRepairScenarioResult | SocialScenarioResult;
  // Offline persona brain is the default. A configured local Ollama opts into
  // model-generated lines; the original greeting remains the fallback.
  private aiRuntimes = new Map<string, NpcRuntimeConfig>();
  private dialogueObjects: PanelObject[] = [];
  /** Modal click shield and option/footer hit areas; kept separate from panel art. */
  private dialogueInputObjects: Phaser.GameObjects.Zone[] = [];
  /** one selection band per dialogue row, toggled in refreshDialogue */
  private dialogueBands: Array<{ band: Phaser.GameObjects.Rectangle; rule: Phaser.GameObjects.Rectangle }> = [];
  private dialogueTitle!: Phaser.GameObjects.Text;
  private dialogueSource!: Phaser.GameObjects.Text;
  private dialogueMessage!: Phaser.GameObjects.Text;
  private dialogueOptions: Phaser.GameObjects.Text[] = [];
  private dialogueOptionIcons: Phaser.GameObjects.Image[] = [];
  private dialogueMarker!: Phaser.GameObjects.Image;

  private pauseOpen = false;
  private pauseObjects: PanelObject[] = [];
  private pauseOptionTexts: Phaser.GameObjects.Text[] = [];
  private pauseMarker!: Phaser.GameObjects.Image;
  private pauseSelected = 0;
  private lastSavedAbsoluteMinute = Number.NEGATIVE_INFINITY;
  // B3-01 D9: last uninterrupted save-failure episode we already warned about.
  // Survives a scene restart on purpose — storage is still broken after 重新开始,
  // so there is no reason to re-flash on every failed autosave attempt.
  private lastSaveFailureEpisodes = 0;
  private lastActiveEvent: ActiveEvent | null = null;
  // Per-frame input guard (GHI-03 m9). Phaser can deliver one DOM keydown
  // several times inside a single frame when several keys land in the same queue
  // drain, so every menu action has to be accepted at most once per frame —
  // otherwise one ArrowDown moves the pause selection two entries and the
  // player lands on 重新开始 when they asked for 塔楼地图.
  private lastInputFrame: Record<GameKey, number> = { e: -1, esc: -1, i: -1, enter: -1, c: -1, m: -1, s: -1, f: -1, q: -1, up: -1, down: -1 };

  constructor() {
    super({ key: 'Game' });
  }

  create(): void {
    // Phaser does not re-run field initialisers on scene restart, so reset the
    // autosave cursor here — otherwise 重新开始 inherits the previous run's
    // value and the fresh run's clock looks like it has not moved yet.
    this.lastSavedAbsoluteMinute = Number.NEGATIVE_INFINITY;
    this.lastActiveEvent = null;
    // The frame counter is monotonic across the session, so a stale slot would
    // never match anyway — reset to keep the per-create state honest.
    this.lastInputFrame = { e: -1, esc: -1, i: -1, enter: -1, c: -1, m: -1, s: -1, f: -1, q: -1, up: -1, down: -1 };
    this.selectedVisualWeapon = 'crowbar';
    this.syncedVisualWeapon = undefined;
    // Field initialisers do not re-run, so the HUD's cached visibility has to be
    // re-derived against the fresh bag of a restarted run.
    this.bagFullShown = false;

    // Every builder below only pushes into these, and field initialisers do not
    // re-run on scene restart. Without the reset, 重新开始 left them holding the
    // previous run's destroyed objects, so refreshInventory() / togglePause()
    // wrote to dead objects and both panels came up empty.
    this.floorObjects = [];
    this.containerObjs.clear();
    this.groundObjs.clear();
    this.invObjects = [];
    this.invSlotTexts = [];
    this.invSlotIcons = [];
    this.invMarker = createMarker(this);
    this.craftObjects = [];
    this.craftMarker = createMarker(this);
    this.pauseObjects = [];
    this.pauseOptionTexts = [];
    this.pauseMarker = createMarker(this);
    this.dialogueObjects = [];
    this.dialogueInputObjects = [];
    this.dialogueOptions = [];
    this.dialogueOptionIcons = [];
    this.dialogueMarker = createMarker(this);
    this.shelterObjects = [];
    this.shelterInputObjects = [];
    this.shelterMarker = createMarker(this);
    // 重新开始 runs while the pause menu is still open, and these flags survive a
    // restart. Left set, update() early-returns forever and every panel handler
    // refuses to run, so the restarted game looks frozen.
    this.inventoryOpen = false;
    this.invSelected = 0;
    this.craftingOpen = false;
    this.craftSelected = 0;
    this.dialogueOpen = false;
    this.dialogue = null;
    // 重入锁也必须在这里归位。字段初始化器不随场景重启重跑（上面几段注释说的
    // 就是这件事），所以在「维修进行中退出到标题/重开一局」之后，新场景实例会
    // 继承上一局遗留的 true：`runAlinRepairPlan` 与 `runBlackoutRepairPlan` 都
    // 以 `if (this.xInFlight) return;` 开头，于是维修永久静默失效，玩家点下去
    // 没有任何反应、也没有报错。这不是理论风险，是「重开一局必现」。
    this.repairInFlight = false;
    this.blackoutInFlight = false;
    this.npcAutonomyInFlight = false;
    this.npcAutonomyCursor = undefined;
    this.lastNpcAutonomyResult = undefined;
    this.lastAlinRepairResult = undefined;
    this.lastBlackoutRepairResult = undefined;
    this.lastAlinGiftResult = undefined;
    this.judgeLatestResult = undefined;
    this.shelterOpen = false;
    this.shelterSelected = 0;
    this.pauseOpen = false;
    this.pauseSelected = 0;
    this.wanderer = undefined;
    this.wandererHitAt = Number.NEGATIVE_INFINITY;
    this.wandererAutonomy.cancel();
    this.wandererIntent = 'attack';
    this.wandererEventKey = '';
    this.wandererLastEncounter = '';
    this.stairClimb = undefined;
    this.lastClock = '';
    this.lastStats = '';

    this.portraitMode = isPortraitViewport(window.innerWidth, window.innerHeight);
    const portraitView = portraitViewportFor(window.innerWidth, window.innerHeight);
    this.portraitWidth = this.portraitMode ? portraitView.width : DESIGN_WIDTH;
    this.hudContextBottom = this.portraitMode ? 166 : HUD_LAYOUT.contextBottom;
    this.cameras.main.setViewport(
      this.portraitMode ? portraitView.x : 0,
      0,
      this.portraitWidth,
      DESIGN_HEIGHT,
    );
    this.cameras.main.setBackgroundColor(0x22303a);
    this.cameras.main.setBounds(0, 0, FLOOR_WIDTH, FLOOR_HEIGHT);
    this.nightOverlay = this.add
      .rectangle(FLOOR_WIDTH / 2, FLOOR_HEIGHT / 2, FLOOR_WIDTH, FLOOR_HEIGHT)
      // THE FILL ALPHA IS THE WHOLE BUG.
      //
      // A Phaser Shape carries TWO alphas: the GameObject's `alpha` and the
      // shape's own `fillAlpha`. This rectangle was created with a positional
      // fillAlpha of 0, and applyNightLighting() only ever called setAlpha() -
      // so `alpha` dutifully animated to 0.6 while `fillAlpha` stayed 0 and the
      // overlay drew nothing at all. Night has never been visible in this game:
      // measured mean luminance was 43.8 by day and 44.2 at 23:00.
      //
      // Created opaque and controlled purely through alpha, with the depth from
      // the lighting depth contract so it sits above the world and below the
      // lamps.
      .setFillStyle(0x05070a, 1)
      .setAlpha(0)
      .setDepth(NIGHT_DEPTH)
      .setName('night-overlay');

    // Cold tint on top of the darkening: the audit recorded "night is only a
    // dark wash, no colour temperature". The texture bakes alpha 5-31/255, so
    // its strength is fixed by the art; we only fade the whole layer with the
    // same night factor. It is optional — no texture means no tint, no bug.
    if (this.textures.exists(NIGHT_OVERLAY_KEY)) {
      this.nightTint = this.add
        .tileSprite(FLOOR_WIDTH / 2, FLOOR_HEIGHT / 2, FLOOR_WIDTH, FLOOR_HEIGHT, NIGHT_OVERLAY_KEY)
        .setAlpha(0)
        .setDepth(NIGHT_DEPTH)
        .setName('night-tint');
    }

    // A light the player carries, bright enough to read the floor by.
    //
    // Once night actually rendered, the character's contrast against the wall
    // fell from 24.7 to 9.8 - visible, but not comfortably. Raising the sprite
    // above the darkening would make the player glow like a lamp; leaving it
    // dark makes the game hard to play. A warm pool that travels with them does
    // neither: it is the flashlight a person would actually carry, and it keeps
    // the room dark around them.
    this.playerLight = addGlow(this, FLOOR_WIDTH / 2, PLAYER_FEET_Y - 40, 54, 0, LIGHT_DEPTH);

    this.drawFloor();

    this.buildHud();
    this.buildInventoryPanel();
    this.buildCraftPanel();
    this.buildDialoguePanel();
    this.buildPausePanel();
    this.bindInput();
    if (new URLSearchParams(window.location.search).get('demo') === 'ai-npc') this.buildJudgeModePanel();

    if (getGame().day === 1) {
      this.flashOnWallClock('第 1 层：靠近储物柜，按 E 搜刮净水。');
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // cameras.main can be null during teardown (Phaser 4 shutdown gotcha).
      this.cameras.main?.stopFollow();
      this.feedbackTimer?.remove(false);
      this.feedbackTimer = undefined;
      if (this.introFeedbackTimeout !== undefined) window.clearTimeout(this.introFeedbackTimeout);
      this.introFeedbackTimeout = undefined;
      this.judgePanel?.remove();
      this.judgePanel = undefined;
      this.judgePanelContent = undefined;
      this.judgeExportButton = undefined;
      this.unbindInput();
    });
  }

  // Floor content is rebuilt in place on floor changes. We avoid scene.restart():
  // its teardown leaves the hidden UI panel text objects with null texture frames
  // in Phaser 4, so setText on them throws once the scene is recreated.
  /**
   * The canvas size in CANVAS units, which is what every setScrollFactor(0)
   * panel is positioned in.
   *
   * `cameras.main.width` is world units — canvas divided by the camera zoom. At
   * zoom 1 the two agree and nothing notices; the cross-section's zoom 0.5 makes
   * them differ by exactly 2x, which put every panel a canvas-width off-centre
   * and mostly outside the viewport. The crafting e2e caught it because its
   * navTo() pairs the arrow marker with the row label by y, and the label had
   * left the screen.
   */
  private viewSize(): { width: number; height: number } {
    const cam = this.cameras.main;
    return { width: cam.width * cam.zoom, height: cam.height * cam.zoom };
  }

  private panelWidthFor(desktopWidth: number): number {
    return this.portraitMode ? Math.min(desktopWidth, this.viewSize().width - 24) : desktopWidth;
  }

  /** Keep the complete stair path visible without changing the resting floor bounds. */
  private setFloorCameraBounds(
    floor: number,
    traversal?: NonNullable<ReturnType<typeof stairTraversalFor>>,
  ): { topBound: number; bottomBound: number } {
    const lowest = PLAYABLE_FLOORS_V01[0];
    const highest = PLAYABLE_FLOORS_V01[PLAYABLE_FLOORS_V01.length - 1];
    let topBound = floor <= lowest ? -FLOOR_BAND : -FLOOR_HEIGHT * (STACK_ABOVE + 1);
    let bottomBound = floor >= highest ? FLOOR_HEIGHT + FLOOR_BAND : FLOOR_HEIGHT * (STACK_BELOW + 2);

    if (traversal) {
      const pathTop = Math.min(traversal.startY, traversal.endY);
      const pathBottom = Math.max(traversal.startY, traversal.endY);
      // The camera viewport begins behind the context HUD and ends above the
      // bottom hint strip. Extend only as far as the actor needs during travel.
      topBound = Math.min(topBound, pathTop - this.player.displayHeight - this.hudContextBottom - STAIR_CAMERA_HUD_GAP);
      bottomBound = Math.max(bottomBound, pathBottom + HUD_FOOT_H + STAIR_CAMERA_HUD_GAP);
    }

    this.cameras.main.setBounds(0, topBound, FLOOR_WIDTH, bottomBound - topBound);
    return { topBound, bottomBound };
  }

  private drawFloor(): void {
    const state = getGame();
    const floor = state.currentFloor;
    // The flames belong to the floor being drawn, so the list is rebuilt with it.
    // Carrying the previous floor's fixtures forward would leave a blackout
    // dimming lights that are no longer on screen, and the array would grow every
    // time the player took the stairs.
    this.lightFixtures = [];
    // Standing on a floor is what makes it explored (B3-02 §4.3). drawFloor is
    // the single place the player arrives — new game, continue, dev entry and
    // every stairwell — so recording here covers all of them at once.
    recordFloorVisit(state, floor);
    this.floorView = getFloorView(state, floor);

    if (floor === STARTING_FLOOR) {
      this.drawDormRoom();
    } else {
      this.drawCorridor(floor);
    }
    // AND THE NEIGHBOURS. The cross-section only works if the floors beside the
    // player's are actually there — the camera is zoomed out to 3.6 floors of
    // height, so anything not drawn is empty black above and below. They go in
    // before the exits so the stairs have a landing to arrive at.
    const lowest = PLAYABLE_FLOORS_V01[0];
    const highest = PLAYABLE_FLOORS_V01[PLAYABLE_FLOORS_V01.length - 1];
    for (let d = 1; d <= STACK_ABOVE; d++) {
      if (floor - d >= lowest) this.drawNeighbourFloor(floor - d, -FLOOR_HEIGHT * d, true, d);
    }
    for (let d = 1; d <= STACK_BELOW; d++) {
      if (floor + d <= highest) this.drawNeighbourFloor(floor + d, FLOOR_HEIGHT * d, false, d);
    }
    this.drawExits(floor);    this.buildContainers();
    this.buildGround();
    if (floor === STARTING_FLOOR) {
      this.drawBed();
      this.drawWorkbench();
    }
    // Any floor with residents gets them drawn; drawNpcs() filters by floor.
    if (npcsOnFloor(floor).length > 0) this.drawNpcs();
    // OVERHAUL: the floor's question marks go up last, above the room.
    this.buildEncounterSpots();

    // The side-view walk sheet, not the front-facing portrait: the camera is a
    // side-scroller, and a figure seen face-on while it moves laterally reads as
    // a card sliding across the backdrop. The front-view art is the dialogue
    // portrait, where facing the player is the correct axis.
    // The side-view walk sheet, not the front-view portrait: the camera is a
    // side-scroller, and a figure seen face-on while it moves laterally reads as
    // a card sliding across the backdrop. The front-view art is the dialogue
    // portrait, where facing the player is the correct axis.
    //
    // OVERHAUL Wave B: the survivor is the one picked on the meta-select
    // screen, not always the player — the unlocked neighbours are the replay
    // engine's payload.
    const who = this.metaSelectedCharacter();
    // The contact shadow belongs to the player, so it is tracked and moved with
    // them every frame (see updatePlayerShadow). Without it the figure reads as
    // hovering: nothing in a side view is anchored to the floor without one.
    this.playerShadow = addContactShadow(this, state.player.x, PLAYER_FEET_Y + 2, 26, 2, 0.55);
    this.player = this.add
      .sprite(state.player.x, PLAYER_FEET_Y, walkSheetKey(who))
      .setOrigin(0.5, 1)
      // ACTOR_DEPTH, not the default 0. The wall dressing sits at 1-2, the aerial
      // haze at 2 and the foreground silhouette at 26, so a sprite left at 0 is
      // painted over by all of them - the player was invisible in the middle of
      // an empty floor with nothing wrong in the console.
      .setDepth(ACTOR_DEPTH);
    // The selected visual weapon exists from the frame the floor appears, not
    // from the first step. syncWeapon handles its depth and attack-frame pose.
    const visual = weaponVisual(this.selectedVisualWeapon);
    this.weapon?.destroy();
    this.weapon = this.add
      .image(state.player.x, PLAYER_FEET_Y - 54, visual.textureKey)
      .setOrigin(visual.gripX / WEAPON_W, visual.gripY / WEAPON_H)
      .setScale(visual.displayScale)
      .setName('visual-weapon')
      .setDepth(ACTOR_DEPTH - 1);
    this.syncedVisualWeapon = visual.id;
    this.floorObjects.push(this.weapon);
    this.playerLight?.setName('player-light');
    this.syncPlayerWorldObjects(state.player.x, STAIR_START_Y);
    this.player.play(idleAnimKey(who));
    this.floorObjects.push(this.player);
    // The tower is a cross-section now, so the camera follows on BOTH axes and
    // sits at the zoom that fits one floor's width. At 0.5 the view is 1280x720
    // world px, which is 3.6 floors tall — the floor above, the player's own,
    // and the floor below with the top of a fourth showing. It used to be zoom
    // 1 following x only, which could never show more than the floor you were
    // standing on.
    const cam = this.cameras.main;
    cam.setZoom(FLOOR_VIEW_ZOOM);
    // Per-floor bounds avoid showing void at the tower's ends. Horizontal bounds
    // remain locked to one floor; only vertical space expands while on the stairs.
    const { topBound, bottomBound } = this.setFloorCameraBounds(floor);
    cam.startFollow(this.player, true, 0.15, 0.15);
    // Centred on the player the moment the floor is drawn: a follow with
    // lerp 0.15 takes a third of a second to catch up, and during that time the
    // camera is still wherever the previous floor left it.
    cam.centerOn(state.player.x, Math.max(topBound + 180, Math.min(bottomBound - 180, PLAYER_FEET_Y - FLOOR_HEIGHT * 0.5)));
  }

  // OVERHAUL: plays a one-shot action clip and holds it for `ms`. The frame
  // loop's walk/idle pick stands down while the clip runs.
  private playActionAnim(key: string, ms: number): void {
    this.actionAnimKey = key;
    this.actionAnimUntil = this.time.now + ms;
    this.player.play(key, true);
  }

  private clearFloor(): void {
    this.cameras.main.stopFollow();
    for (const o of this.floorObjects) o.destroy();
    this.floorObjects = [];
    // The visual weapon went with the floor; drop the reference so drawFloor
    // builds a new image instead of trying to reuse a destroyed one.
    this.weapon = undefined;
    this.syncedVisualWeapon = undefined;
    for (const shadow of this.playerShadow) shadow.destroy();
    this.playerShadow = [];
    this.speedX = 0;
    this.containerObjs.clear();
    this.groundObjs.clear();
    this.wanderer?.destroy();
    this.wanderer = undefined;
    this.wandererAI = undefined;
    this.wandererAutonomy.cancel();
    this.wandererIntent = 'attack';
    this.wandererEventKey = '';
    this.clearEncounterSpots();
  }

  /** Keep the player, carried light and contact shadow on one world position. */
  private syncPlayerWorldObjects(x: number, y: number): void {
    this.player.setPosition(x, y);
    for (const shadow of this.playerShadow) {
      (shadow as Phaser.GameObjects.Rectangle).setPosition(x, y + 2);
    }
    if (this.playerLight) this.playerLight.setPosition(x, y - 40);
    this.syncWeapon();
  }

  /**
   * Puts the crowbar where the survivor's hand is.
   *
   * Slung, it sits across the back and behind the figure: the silhouette then
   * says "armed" while walking, which is the half of the weapon that was missing
   * entirely - the game drew a bare-handed survivor and then played a slash out
   * of nothing.
   *
   * Swung, it is anchored to the fist of the attack frame that is on screen.
   * Reading the frame back off the texture rather than off a timer keeps the grip
   * on the hand even if the clip is retimed, and it means the crowbar and the arm
   * cannot drift apart.
   */
  private syncWeapon(): void {
    const w = this.weapon;
    if (!w || !w.active) return;
    const visual = weaponVisual(this.selectedVisualWeapon);
    if (this.syncedVisualWeapon !== visual.id) {
      w.setTexture(visual.textureKey)
        .setOrigin(visual.gripX / WEAPON_W, visual.gripY / WEAPON_H)
        .setScale(visual.displayScale);
      this.syncedVisualWeapon = visual.id;
    }
    const flip = this.player.flipX;
    // A dying survivor lets go of it. The fall clip drops the body through the
    // height the grip is anchored at, so a held crowbar would hover over the
    // corpse at waist height. Fading it out and back in on the next non-death
    // frame is cheaper than a drop animation nobody will be watching the end
    // card over.
    if (this.time.now < this.actionAnimUntil && this.actionAnimKey === dieAnimKey('player')) {
      w.setAlpha(0);
      return;
    }
    const swinging =
      this.time.now < this.actionAnimUntil && this.actionAnimKey === attackAnimKey('player');

    if (swinging) {
      const frameNo = Number(this.player.frame?.name ?? ATTACK_FRAME_START);
      const f = Math.max(0, Math.min(ATTACK_FRAMES - 1, frameNo - ATTACK_FRAME_START));
      const pose = attackPose(f);
      const swing = pose.armSwing;
      // Same construction drawArm() uses for the near arm, so the grip lands on
      // the pixels that draw the fist rather than near them.
      const shoulder = { x: pose.shoulder.x + 2, y: pose.shoulder.y + 4 };
      const elbow = joint(shoulder, 12, swing);
      const hand = joint(elbow, 11, swing * 0.6);
      // Frame-local to world: the sheet's anchor is its centre line, and the
      // whole sprite is mirrored when the survivor faces left.
      const dx = (hand.x - FRAME_W / 2) * (flip ? -1 : 1);
      const dy = FRAME_H - hand.y;
      w.setPosition(this.player.x + dx, this.player.y - dy);
      // Each appearance has its own frame-by-frame weapon arc. Facing left uses
      // the mirrored angle; combat animation frames and combat rules are shared.
      const rot = weaponSwingAngle(this.selectedVisualWeapon, f);
      w.setRotation(flip ? Math.PI - rot : rot);
      w.setDepth(ACTOR_DEPTH + 1);
      w.setAlpha(1);
      return;
    }

    // Carried at the hip, angled down and forward.
    //
    // Everything above world y≈94 is under the HUD's fade band - three
    // depth-100 rectangles at alpha 0.88-0.98 that darken the top of the screen
    // so the status bar reads. A slung crowbar put its visible end exactly in
    // that band, which is why it measured (31,43,55) on screen while its texture
    // was drawn in 0xc6d2da: ninety-four percent of it was the mask, not the
    // weapon. Below the band, at hip height, the grip is inside the silhouette
    // and 34 of the 42 shaft pixels are clear of it.
    w.setPosition(this.player.x + (flip ? -20 : 20), this.player.y - 56);
    // Facing right the bar leans 17° down and forward. Facing left it has to be
    // a half turn plus that lean, not the negative angle: the texture occupies
    // its 46 pixels on the +x side of the grip no matter how it is flipped, so a
    // negated angle points the weapon up and back over the shoulder instead of
    // down and ahead. The claw's own curl ends up inverted on that side, which
    // at one pixel of curl is not a thing anyone can see.
    w.setRotation(flip ? Math.PI - 0.3 : 0.3);
    w.setDepth(ACTOR_DEPTH - 1);
    w.setAlpha(1);
  }

  // The survivor picked on the meta-select screen, as a walk-sheet key. Falls
  // back to the player when the meta is missing or holds a stale selection.
  private metaSelectedCharacter(): CharacterKey {
  try {
    const meta = loadMeta();
    return (WALK_CHARACTERS.includes(meta.selectedCharacter as CharacterKey)
      ? meta.selectedCharacter
      : 'player') as CharacterKey;
  } catch {
    return 'player';
  }
}

// ── encounter spots (OVERHAUL W1) ────────────────────────────────────────
  // One "?" per deterministic spot, amber for a rumour and red for the boss.
  // Resolved spots are not drawn at all — the floor visibly empties as the
  // player works it, which is the "this place is picked over" read.
  private clearEncounterSpots(): void {
    for (const m of this.spotMarkers.values()) {
      m.dot.destroy();
      m.label.destroy();
    }
    this.spotMarkers.clear();
  }

  private buildEncounterSpots(): void {
    this.clearEncounterSpots();
    const state = getGame();
    const y = FLOOR_HEIGHT - 34;
    // Everything E already reaches for on this floor. A marker inside any of
    // their radii would hijack the key (measured: it silently broke the NPC
    // trade and the journey specs), so each spot is nudged clear first.
    const taken: number[] = [UP_EXIT_X, DOWN_EXIT_X, ...this.floorView.containers.map((c) => c.x)];
    // Residents on THIS floor. Using the whole roster would let a 5th-floor
    // resident push a 2nd-floor question mark out of the way for no reason.
    taken.push(...npcsOnFloor(state.currentFloor).map((n) => n.x));
    // OVERHAUL Wave C1: the trader joins the taken list so nothing lands on
    // top of him, and he is drawn after the spots so he reads above them.
    // The player arrives at ENTRY_X on every floor, so a trader placed there
    // spawns inside them - measured: trader 614, arrival 640, the two figures
    // overlapped on screen and neither was clickable-looking. Clear a full
    // interact radius plus a body width from both the arrival point and any NPC.
    const floor = state.currentFloor;
    const shopTaken = [...taken, ENTRY_X];
    const shopX = floor >= 2 ? placeClearX(state.runSeed, floor, 'trader', shopTaken, INTERACT_DISTANCE * 2) : null;
    if (shopX !== null) taken.push(shopX);
    for (const spot of encounterSpots(state.runSeed, floor)) {
      if (shouldSkip(state, spot.id)) continue;
      const x = nudgeSpotX(spot.x, taken, INTERACT_DISTANCE + 8);
      const color = spot.isBoss ? UI.danger : UI.accent;
      // A dark backing plate under the dot, plus a slow breath.
      //
      // The markers are the game's core hook - "walk to the question mark" - and
      // they were a bare orange disc with an ink '?' on it. Against the wall
      // dressing that is now behind them (conduits, vents, signage) a disc with
      // no edge can disappear; the dark plate guarantees a silhouette whatever is
      // behind it, and the breath is what makes the eye find it while walking
      // past. Same rule as the character's rim light: if it matters, it needs a
      // guaranteed edge.
      const plate = this.add.circle(x, y, 11, PALETTE.ink, 0.85).setDepth(6);
      const dot = this.add.circle(x, y, 9, color, 1).setDepth(7);
      const label = this.add
        .text(x, y, '?', { fontFamily: FONT_FAMILY, fontSize: '26px', color: hex(PALETTE.ink) })
        .setOrigin(0.5)
        .setDepth(8);
      // A 1.9s breath on the plate only, so the disc reads as a beacon without
      // the label jittering.
      this.tweens.add({ targets: plate, scale: 1.28, duration: 1900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      this.spotMarkers.set(spot.id, { x, isBoss: spot.isBoss, dot, label });
    }
    if (shopX !== null) {
      // The trader: a pack and a price tag, drawn as the walk sheet's own
      // silhouette so he belongs to the same world.
      this.floorObjects.push(...addContactShadow(this, shopX, PLAYER_FEET_Y + 2, 26, 2, 0.5));
      const trader = this.add.sprite(shopX, PLAYER_FEET_Y, walkSheetKey('npc_alin')).setOrigin(0.5, 1).setDepth(5);
      trader.play(idleAnimKey('npc_alin'));
      const tag = this.add
        .text(shopX, PLAYER_FEET_Y - 108, '行商', { fontFamily: FONT_FAMILY, fontSize: '22px', color: hex(TEXT.highlight), backgroundColor: '#0b0f12cc', padding: { x: 4, y: 2 } })
        .setOrigin(0.5)
        .setDepth(6);
      this.spotMarkers.set('shop', { x: shopX, isBoss: false, dot: trader as unknown as Phaser.GameObjects.Arc, label: tag });
    }
  }

  private nearestEncounterSpot(): string | null {
    const px = getGame().player.x;
    let best: string | null = null;
    let bestDist = INTERACT_DISTANCE;
    for (const [id, m] of this.spotMarkers) {
      const d = Math.abs(m.x - px);
      if (d <= bestDist) {
        bestDist = d;
        best = id;
      }
    }
    return best;
  }

  // The legal choices per kind — the panel shows exactly these, so the UI can
  // never offer an action resolveEncounter would reject.
  private encounterChoices(kind: Encounter['kind']): EncounterChoice[] {
    switch (kind) {
      case 'loot':
      case 'cache':
        return ['take'];
      case 'ambush':
      case 'boss':
        return ['fight', 'flee'];
      case 'trader':
        return ['trade', 'leave'];
      case 'note':
        return ['read'];
    }
  }

  // ── the trader (OVERHAUL Wave C1) ────────────────────────────────────────
  // One panel, two directions: ↑/↓ moves along the stock, Enter buys one, and
  // S sells one of the highlighted item. Gold is the run's second currency and
  // the shortcut's price (Wave C2).

  private openShop(): void {
    const state = getGame();
    this.shopEntries = [...shopStock(state.currentFloor)];
    this.shopSelected = 0;
    this.encounterOpen = true;
    playSfx('click');
    this.buildShopPanel();
  }

  private closeShop(): void {
    this.encounterOpen = false;
    for (const o of this.encounterObjects) o.destroy();
    this.encounterObjects = [];
    this.buildEncounterSpots();
  }

  private buildShopPanel(): void {
    for (const o of this.encounterObjects) o.destroy();
    this.encounterObjects = [];
    const state = getGame();
    const { width, height } = this.viewSize();
    const cx = width / 2;
    const cy = height / 2;
    const panelW = this.panelWidthFor(440);
    const panelH = 248;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    const depth = PANEL_DEPTH.game.dialogue;

    this.encounterObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'green', depth));
    this.encounterObjects.push(...buildPanelHeader(this, left, top, panelW, '行商', UI.good, depth + 5));

    // The purse, right-aligned on the header row: the one number that decides
    // what the rest of this panel means.
    this.encounterObjects.push(
      this.add
        .text(left + panelW - 10, top + 10, `${state.player.gold} 金`, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: hex(PALETTE.lightHigh) })
        .setOrigin(1, 0.5)
        .setDepth(depth + 6),
    );

    // Stock as rows: icon, name, price, how many the player already carries.
    // The icon is the item's own 16x16 art, so the shop speaks the same visual
    // language as the bag.
    this.shopEntries.forEach((e, i) => {
      const y = top + 30 + i * 30;
      const selected = i === this.shopSelected;
      this.encounterObjects.push(
        ...buildListRow(this, left + 8, y, panelW - 16, depth + 5, {
          iconKey: itemIconKey(e.itemId),
          label: getItem(e.itemId).displayName,
          value: `${e.price} 金 · 持 ${countItem(state.player.inventory, e.itemId)}`,
          selected,
        }),
      );
      const hitArea = this.add.zone(left + panelW / 2, y + 13, panelW - 16, 26)
        .setInteractive({ useHandCursor: true }).setDepth(depth + 8);
      hitArea.on('pointerdown', () => {
        if (!this.encounterOpen || getGame().combat || this.encounter) return;
        this.shopSelected = i;
        this.buildShopPanel();
      });
      this.encounterObjects.push(hitArea);
    });

    // The buy status has its own line below the stock, rather than sitting on
    // top of the selected row's price and carried count.
    const selectedEntry = this.shopEntries[this.shopSelected];
    if (selectedEntry) {
      const canBuy = state.player.gold >= selectedEntry.price;
      this.encounterObjects.push(this.add.text(left + 18, top + 135, canBuy ? '选中商品：可买入' : '选中商品：金币不足', {
        fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: canBuy ? hex(PALETTE.clothHigh) : hex(TEXT.warn),
      }).setOrigin(0, 0.5).setName('shop-status').setDepth(depth + 7));
    }
    const buttonPitch = this.portraitMode ? 84 : 132;
    const buttonWidth = this.portraitMode ? 72 : 116;
    const shopButtons: PanelObject[] = [
      ...this.panelMouseButton(cx - buttonPitch, top + 177, '买入', () => {
        if (this.encounterOpen && !getGame().combat && !this.encounter) this.shopBuy();
      }, buttonWidth),
      ...this.panelMouseButton(cx, top + 177, '卖出', () => {
        if (this.encounterOpen && !getGame().combat && !this.encounter) this.shopSell();
      }, buttonWidth),
      ...this.panelMouseButton(cx + buttonPitch, top + 177, '关闭', () => {
        if (this.encounterOpen && !getGame().combat && !this.encounter) this.closeShop();
      }, buttonWidth),
    ];
    shopButtons.forEach((button) => button.setDepth(depth + 8));
    this.encounterObjects.push(...shopButtons);

    // S sells the selected stock item, not an arbitrary item from the bag.
    const footY = top + panelH - 34;
    this.encounterObjects.push(...buildPanelWell(this, left + 8, footY, panelW - 16, 22, depth + 5));
    this.encounterObjects.push(
      this.add
        .text(left + 16, footY + 11, this.portraitMode ? '点商品 · 点买入/卖出 · ESC 关' : '↑/↓ 选 · Enter 买 · S 卖选中 · ESC 关', { fontFamily: FONT_FAMILY, fontSize: `${this.portraitMode ? 13 : TYPE.caption}px`, color: hex(TEXT.secondary) })
        .setOrigin(0, 0.5)
        .setName('shop-help')
        .setDepth(depth + 7),
    );
    // This panel is rebuilt on every open, so it never runs applyPanelDepth -
    // every object it makes has to be locked here or it slides with the camera.
    lockToScreen(this.encounterObjects);
  }

  private shopBuy(): void {
    const state = getGame();
    const entry = this.shopEntries[this.shopSelected];
    if (!entry) return;
    const r = buy(state, entry.itemId, state.currentFloor);
    playSfx(r.ok ? 'chest' : 'pickup');
    this.flash(r.ok ? r.message : r.reason);
    // The trade, seen. Gold changing hands was a number in the HUD and a line of
    // text; the coin spins over the counter while the deal is open.
    if (r.ok) {
      saveToStorage(state);
      const coin = startFxLoop(this, 'coin-spin', state.player.x + 26, PLAYER_FEET_Y - 62, LIGHT_DEPTH);
      if (coin) this.encounterObjects.push(coin);
    }
    this.refreshInventory();
    this.refreshStats();
    this.buildShopPanel();
  }

  private shopSell(): void {
    const state = getGame();
    const entry = this.shopEntries[this.shopSelected];
    if (!entry) return;
    const r = sell(state, entry.itemId, state.currentFloor);
    playSfx(r.ok ? 'chest' : 'pickup');
    this.flash(r.ok ? r.message : r.reason);
    if (r.ok) {
      saveToStorage(state);
      const coin = startFxLoop(this, 'coin-spin', state.player.x + 26, PLAYER_FEET_Y - 62, LIGHT_DEPTH);
      if (coin) this.encounterObjects.push(coin);
    }
    this.refreshInventory();
    this.refreshStats();
    this.buildShopPanel();
  }

  private openEncounter(spotId: string): void {
    const state = getGame();
    if (shouldSkip(state, spotId)) return;
    const marker = this.spotMarkers.get(spotId);
    const enc = rollFloorEncounter(state, state.currentFloor, spotId);
    // OVERHAUL Wave A: anything with teeth opens a real turn-based fight
    // instead of the old single-roll panel.
    if (isCombatKind(enc.kind)) {
      this.startCombat(spotId, enc.kind as 'ambush' | 'boss');
      return;
    }
    this.encounter = { spotId, encounter: enc, choices: this.encounterChoices(enc.kind), selected: 0, resolved: false };
    this.encounterOpen = true;
    this.buildEncounterPanel(marker?.isBoss ?? false);
    // The alert sting is the warning shot.
    playSfx('alert');
  }

  // ── turn-based combat (OVERHAUL Wave A) ─────────────────────────────────
  // The monster is rolled once per spot and frozen into state.combat, so a
  // save/reload mid-fight resumes the same fight. Behaviours from monsters.ts
  // shape the effective stats; the first-strike and guard-pierce rules are
  // applied here because resolveRound stays a generic engine.

  private monsterFor(kind: 'ambush' | 'boss', state: import('../core/gameTypes').GameState, spotId: string): Combatant & { id: number; behavior: string } {
    const floor = state.currentFloor;
    let def;
    if (kind === 'boss') {
      def = MONSTERS.find((m) => m.id === 900);
      if (!def) throw new Error('monster roster lost the 900 guardian');
    } else {
      // Seeded per spot, so the same question mark always hides the same thing
      // within a run — and deriveSeed, never a small integer, because
      // xorshift32's first output for small seeds collapses toward 0.
      const rng = makeRng(deriveSeed(state.runSeed, state.day, floor, spotId, 'combat-monster'));
      def = rollMonster(floor, rng);
    }
    const base: Combatant = {
      hp: def.hp,
      maxHp: def.hp,
      damage: def.damage,
      accuracy: def.accuracy,
      defense: def.defense,
      evasion: def.evasion,
      name: def.name,
    };
    const mods = behaviorModifiers(def.behavior);
    const effective = applyBehavior(mods, base);
    // applyBehavior rebuilds the object from the six combat fields, so the
    // display name does not survive it — re-attach it here.
    return { ...effective, name: def.name, id: def.id, behavior: def.behavior };
  }

  private startCombat(spotId: string, kind: 'ambush' | 'boss'): void {
    const state = getGame();
    const monster = this.monsterFor(kind, state, spotId);
    const log: string[] = [combatIntroMessage(kind, monster.name ?? '敌人')];
    // An ambusher's first strike lands before the player acts: the wind-up is
    // the tell, the hit is the bill.
    if (monster.behavior === 'ambusher') {
      const mods = behaviorModifiers('ambusher');
      const strike = Math.max(1, Math.round(monster.damage * mods.firstStrikeMult));
      state.player.hp = Math.max(0, state.player.hp - strike);
      log.push(`${monster.name} 抢先扑出，造成 ${strike} 点伤害！`);
      this.playActionAnim(hurtAnimKey('player'), 400);
      this.cameras.main.shake(160, 0.008);
    }
    state.combat = {
      kind,
      floor: state.currentFloor,
      spotId,
      monster: { ...monster, name: monster.name ?? '敌人' },
      guarding: false,
      turn: 1,
      log,
    };
    this.encounterOpen = true; // the same panel slot and the same input routing
    this.combatSelected = 0;
    playSfx('alert');
    this.refreshStats();
    if (state.player.hp <= 0) {
      state.status = 'lost';
      saveToStorage(state);
      this.scene.start('End');
      return;
    }
    saveToStorage(state);
    this.buildCombatPanel();
  }

  private closeCombat(): void {
    const state = getGame();
    state.combat = undefined;
    this.combatDone = false;
    this.encounterOpen = false;
    for (const o of this.encounterObjects) o.destroy();
    this.encounterObjects = [];
    // The floor's spots are rebuilt so a resolved one disappears.
    this.buildEncounterSpots();
  }

  /** Keep clicks inside a modal from reaching world objects behind it. */
  private addModalClickShield(objects: Phaser.GameObjects.GameObject[], depth: number): void {
    const { width, height } = this.viewSize();
    const shield = this.add
      .zone(width / 2, height / 2, width, height)
      .setInteractive()
      .setDepth(depth + 4)
      .setScrollFactor(0);
    shield.on('pointerdown', () => undefined);
    objects.push(shield);
  }

  /** An explicit clickable control, rendered above its modal click shield. */
  private addModalClickTarget(
    objects: Phaser.GameObjects.GameObject[],
    x: number,
    y: number,
    width: number,
    height: number,
    depth: number,
    action: () => void,
  ): Phaser.GameObjects.Zone {
    const target = this.add
      .zone(x, y, width, height)
      .setInteractive({ useHandCursor: true })
      .setDepth(depth + 8)
      .setScrollFactor(0);
    target.on('pointerdown', action);
    objects.push(target);
    return target;
  }

  private buildCombatPanel(): void {
    for (const o of this.encounterObjects) o.destroy();
    this.encounterObjects = [];
    const state = getGame();
    const combat = state.combat;
    if (!combat) return;
    const { width, height } = this.viewSize();
    const cx = width / 2;
    const cy = height / 2;
    const panelW = this.panelWidthFor(440);
    const panelH = 248;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    const depth = PANEL_DEPTH.game.dialogue;
    const isBoss = combat.kind === 'boss';

    this.encounterObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'yellow', depth));
    this.addModalClickShield(this.encounterObjects, depth);
    // OVERHAUL UI: the fight uses the same header strip, segmented bar and row
    // bands as every other panel, instead of its own centred title and a flat
    // two-rectangle HP bar. A boss gets the danger accent on the header rule.
    this.encounterObjects.push(
      ...buildPanelHeader(this, left, top, panelW, `${combat.monster.name}${isBoss ? '（守门人）' : ''}`, isBoss ? UI.danger : UI.accent, depth + 5),
    );

    // The monster's HP as the same segmented bar the HUD uses, so "how much is
    // left" reads at a glance instead of as a proportion of a strip.
    const g = this.add.graphics().setDepth(depth + 7);
    drawStatBar(g, left + 12, top + 30, panelW - 24, 7, combat.monster.hp / combat.monster.maxHp, isBoss ? UI.danger : UI.accent, 24);
    this.encounterObjects.push(g);
    this.encounterObjects.push(
      this.add
        .text(left + panelW - 12, top + 44, `${combat.monster.hp}/${combat.monster.maxHp} · 第 ${combat.turn} 回合`, {
          fontFamily: FONT_FAMILY,
          fontSize: `${TYPE.caption}px`,
          color: hex(TEXT.dim),
        })
        .setOrigin(1, 0)
        .setDepth(depth + 7),
    );

    // The log's tail: the last three lines, on a dark well so they read as a
    // record of what happened rather than as more body text.
    const logTop = top + 56;
    const logH = 74;
    this.encounterObjects.push(...buildPanelWell(this, left + 12, logTop, panelW - 24, logH, depth + 5));
    const tail = combat.log.slice(-3);
    // Combat.log keeps its full, authoritative wording; only the narrow visual
    // tail is clipped to one line. Fixed 22px rows are enough for the 20px
    // caption font, but wrapping a long boss/loot result would still let one
    // record grow into and cover the next row.
    const logWidth = panelW - 40;
    const logFont = { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px` };
    const logMeasure = this.add.text(0, 0, '', logFont).setVisible(false);
    const fitLogLine = (line: string): string => {
      const singleLine = line.replace(/[\r\n]+/g, ' ');
      logMeasure.setText(singleLine);
      if (logMeasure.width <= logWidth) return singleLine;
      let prefix = '';
      for (const glyph of Array.from(singleLine)) {
        const candidate = `${prefix}${glyph}…`;
        logMeasure.setText(candidate);
        if (logMeasure.width > logWidth) break;
        prefix += glyph;
      }
      return `${prefix}…`;
    };
    tail.forEach((line, i) => {
      this.encounterObjects.push(
        this.add
          .text(left + 20, logTop + 8 + i * 22, fitLogLine(line), { ...logFont, color: i === tail.length - 1 ? hex(TEXT.primary) : hex(TEXT.dim) })
          .setDepth(depth + 7),
      );
    });
    logMeasure.destroy();

    // The three actions, as rows with a status column - the key, what it does,
    // and what it costs. A list of three verbs in a row was the old shape.
    const choices: ReadonlyArray<readonly [string, string, string]> = [
      ['攻击', '按 Enter', '造成武器伤害'],
      ['格挡', '受伤减半', '回 3 精力'],
      ['撤退', '按 ESC', '逃跑可能失败'],
    ];
    const selectionRows: Array<{
      highlight: Phaser.GameObjects.Rectangle;
      marker: Phaser.GameObjects.Rectangle;
      label: Phaser.GameObjects.Text;
    }> = [];
    choices.forEach(([label, key, note], i) => {
      const y = top + 136 + i * 26;
      const selected = i === this.combatSelected;
      const highlight = this.add.rectangle(left + 12, y, panelW - 24, 24, UI.accent).setOrigin(0, 0).setAlpha(selected ? 0.14 : 0).setDepth(depth + 5);
      const marker = this.add.rectangle(left + 12, y, 2, 24, UI.accent).setOrigin(0, 0).setAlpha(selected ? 1 : 0).setDepth(depth + 6);
      const rowLabel = this.add
        .text(left + 22, y + 12, label, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: selected ? hex(PALETTE.lightHigh) : hex(TEXT.primary) })
        .setOrigin(0, 0.5)
        .setDepth(depth + 7);
      selectionRows.push({ highlight, marker, label: rowLabel });
      this.encounterObjects.push(
        highlight,
        marker,
        rowLabel,
        this.add
          .text(left + panelW - 22, y + 12, `${key} · ${note}`, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.dim) })
          .setOrigin(1, 0.5)
          .setDepth(depth + 7),
      );
      const selectChoice = (): void => {
        if (!this.encounterOpen || !getGame().combat || this.combatDone) return;
        this.combatSelected = i;
        selectionRows.forEach((row, index) => {
          const isSelected = index === i;
          row.highlight.setAlpha(isSelected ? 0.14 : 0);
          row.marker.setAlpha(isSelected ? 1 : 0);
          row.label.setColor(isSelected ? hex(PALETTE.lightHigh) : hex(TEXT.primary));
        });
      };
      const hitArea = this.add.zone(left + panelW / 2, y + 12, panelW - 24, 24).setInteractive().setDepth(depth + 8);
      hitArea.on('pointerover', selectChoice);
      hitArea.on('pointerdown', () => {
        if (!this.encounterOpen || !getGame().combat || this.combatDone) return;
        selectChoice();
        this.activateCombatChoice();
      });
      this.encounterObjects.push(hitArea);
    });

    this.encounterObjects.push(
      this.add
        .text(cx, top + panelH - 12, '↑/↓ 选择 · Enter 出招 · ESC 撤退 · Q 切换武器外观（仅视觉）', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(PALETTE.clothHigh) })
        .setOrigin(0.5)
        .setDepth(depth + 7),
    );
    lockToScreen(this.encounterObjects);
  }

  /**
   * The visible swing: the arc, its mirroring, and the crit flash on a kill.
   *
   * Shared by the turn-based fight and the single-roll encounter, because they
   * are the same gesture - the survivor swings the crowbar - and two copies of
   * the scale and the facing rule would drift apart.
   */
  private playSwingFx(killed = false): void {
    const state = getGame();
    const facing = this.player?.flipX ? -1 : 1;
    const visual = weaponVisual(this.selectedVisualWeapon);
    const slash = playFx(this, visual.effect, state.player.x + 30 * facing, PLAYER_FEET_Y - 18, LIGHT_DEPTH, {
      scale: visual.effectScale,
      timeScale: visual.effectTimeScale,
    });
    // The arc is drawn facing right; a survivor facing left needs it mirrored or
    // the slash trails behind them.
    if (slash) slash.setFlipX(facing < 0);
    if (killed) {
      playFx(this, 'crit-hit', state.player.x + 30 * facing, PLAYER_FEET_Y - 30, LIGHT_DEPTH + 1, { scale: 1.4 });
    }
  }

  /** Brief red body flash for confirmed incoming damage; presentation only. */
  private flashPlayerHurt(): void {
    const player = this.player;
    if (!player?.active) return;
    const token = ++this.playerHitFxToken;
    player.setTint(0xff6b62).setTintMode(Phaser.TintModes.FILL);
    this.time.delayedCall(110, () => {
      if (player.active && token === this.playerHitFxToken) player.clearTint();
    });
  }

  /** Weapon-agnostic contact spark; only called after the combat result says a hit landed. */
  private playGenericHitSpark(): void {
    const state = getGame();
    const facing = this.player?.flipX ? -1 : 1;
    playFx(this, 'hit-spark', state.player.x + 42 * facing, PLAYER_FEET_Y - 34, LIGHT_DEPTH + 2, {
      scale: 0.7,
      timeScale: 1.4,
    });
  }

  // Feedback is deliberately downstream of the pure combat result. It can add
  // sprites, a short shake, and an action pose, but it never rolls, mutates HP,
  // or decides whether the turn continues.
  private playCombatFeedback(round: CombatRound, action: CombatAction): void {
    const state = getGame();
    const visual = combatFeedbackSignals(round, action);
    // The swing happens whether or not it lands.
    //
    // It used to be gated on playerDamage > 0, which meant a miss produced
    // nothing on screen at all - and with the fight's accuracy the miss was the
    // common case. The one visual sign that the survivor carries a weapon was an
    // effect that appeared in roughly half the rounds, for two thirds of a
    // second, above a figure holding nothing. A swing that whiffs still swings.
    if (visual.swing) this.playSwingFx(round.monsterDead);
    if (visual.hitSpark) this.playGenericHitSpark();
    if (visual.parry) {
      playFx(this, 'parry', state.player.x + 10, PLAYER_FEET_Y - 50, LIGHT_DEPTH + 1, { scale: 1.3 });
    }
    if (visual.playerHurt) {
      playFx(this, 'hit-flash', state.player.x, PLAYER_FEET_Y - 48, LIGHT_DEPTH + 2);
      this.flashPlayerHurt();
    }
  }

  // One turn: the engine resolves the round, this method lands the numbers on
  // state and decides whether the fight continues.
  private activateCombatChoice(): void {
    const state = getGame();
    const combat = state.combat;
    if (!combat) return;
    const action = (['attack', 'guard', 'flee'] as const)[this.combatSelected];
    const player = playerCombatant(state);
    const monsterC: Combatant = {
      hp: combat.monster.hp,
      maxHp: combat.monster.maxHp,
      damage: combat.monster.damage,
      accuracy: combat.monster.accuracy,
      defense: combat.monster.defense,
      evasion: combat.monster.evasion,
      name: combat.monster.name,
    };
    const rng = makeRng(deriveSeed(state.runSeed, state.day, combat.floor, combat.spotId, `combat-turn-${combat.turn}`));
    const round = resolveRound(player, monsterC, action, rng);
    combat.log.push(...round.messages);
    combat.guarding = action === 'guard';
    this.playCombatFeedback(round, action);

    // The swing is the action's, not the damage's. Gating the clip on
    // playerDamage > 0 meant a miss had no swing either, so the crowbar stayed
    // slung across the survivor's back while the arc played out of thin air. The
    // arm and the weapon have to agree, and the arc is the arm's.
    if (action === 'attack') this.playActionAnim(attackAnimKey('player'), 320);
    if (round.playerDamage > 0) {
      combat.monster.hp = Math.max(0, combat.monster.hp - round.playerDamage);
    }
    if (action === 'guard') {
      state.player.energy = Math.min(GAME_CONFIG.player.energyMax, state.player.energy + GUARD_ENERGY_RESTORE);
    }
    // Check post-action HP independently of hit rolls: a coward already below
    // its threshold flees even when the player's attack misses this turn.
    if (shouldCowardBreakOff(combat.monster, round)) {
      combat.log.push(`${combat.monster.name} 伤痕累累地逃走了。`);
      this.finishCombat('coward');
      return;
    }
    if (round.monsterDamage > 0 && !round.monsterDead && !round.fled) {
      // The guardian totem and easy mode soften guardian attacks only; ordinary
      // ambushes retain their full damage.
      const relicMult = relicDamageMultForCombat(combat.kind, state.relics ?? []);
      const modeMult = combat.kind === 'boss' ? modeGuardianDamageMult(state.mode ?? 'adventure') : 1;
      const soften = relicMult * modeMult;
      state.player.hp = applyCombatDamage(state.player.hp, round.monsterDamage, soften);
      if (action === 'guard') this.playActionAnim(hurtAnimKey('player'), 400);
      this.cameras.main.shake(160, 0.008);
    }
    combat.turn += 1;
    this.refreshStats();

    if (state.player.hp <= 0) {
      state.player.hp = 0;
      state.status = 'lost';
      saveToStorage(state);
      this.scene.start('End');
      return;
    }
    if (round.monsterDead) {
      this.finishCombat('win');
      return;
    }
    if (round.fled) {
      // A successful retreat costs nothing and leaves the spot un-resolved —
      // the player can come back with a better plan (or a crowbar).
      combat.log.push('你成功撤出。');
      saveToStorage(state);
      this.closeCombat();
      this.flash('你撤出了战斗。');
      return;
    }
    saveToStorage(state);
    this.buildCombatPanel();
  }

  // Combat over: pay out, consume the spot, close.
  private finishCombat(outcome: 'win' | 'coward'): void {
    const state = getGame();
    const combat = state.combat;
    if (!combat) return;
    const isBoss = combat.kind === 'boss';
    if (outcome === 'win') {
      // Ambush win: the loser's pockets. Boss win: the chapter's payoff.
      // OVERHAUL Wave B3: the lucky charm adds one more roll to the pile.
      const rng = makeRng(deriveSeed(state.runSeed, state.day, combat.floor, combat.spotId, 'combat-loot'));
      const lootCount = (isBoss ? 3 : rng.nextInt(1, 2)) + lootBonus(state.relics ?? []);
      const taken: Array<{ itemId: ItemId; quantity: number }> = [];
      const pool: ItemId[] = isBoss
        ? ['medkit', 'clean_water', 'ration_pack', 'battery', 'filter']
        : ['bread', 'clean_water', 'dirty_water', 'scrap_metal', 'cloth', 'battery'];
      for (let i = 0; i < lootCount; i++) {
        const itemId = pool[rng.nextInt(0, pool.length - 1)];
        const qty = itemId === 'clean_water' || itemId === 'bread' ? rng.nextInt(1, 2) : 1;
        const r = addItem(state.player.inventory, itemId, qty);
        if (r.overflow === 0) taken.push({ itemId, quantity: qty });
      }
      const names = taken.map((s) => `${getItem(s.itemId).displayName}×${s.quantity}`).join('、');
      combat.log.push(isBoss ? `守门人倒下了。你搜出：${names || '（背包已满）'}` : `你击败了 ${combat.monster.name}。战利品：${names || '（背包已满）'}`);
      if (isBoss) {
        state.records = { deepestFloor: Math.max(state.records?.deepestFloor ?? 0, state.currentFloor), bestScore: (state.records?.bestScore ?? 0) + 200 };
        combat.log.push('上楼的路通了。分数 +200');
      }
      markResolved(state, combat.spotId, `combat:win`);
      playSfx('goal');
    } else {
      // Coward break-off: half the glory, and the spot stays spent.
      const rng = makeRng(deriveSeed(state.runSeed, state.day, combat.floor, combat.spotId, 'combat-coward'));
      const itemId: ItemId = rng.chance(0.5) ? 'bread' : 'cloth';
      const r = addItem(state.player.inventory, itemId, 1);
      if (r.overflow === 0) combat.log.push(`它逃走时掉下了 ${getItem(itemId).displayName}。`);
      markResolved(state, combat.spotId, `combat:coward`);
    }
    saveToStorage(state);
    this.refreshStats();
    // Show the outcome for one more Enter, same as the non-combat panel.
    for (const o of this.encounterObjects) o.destroy();
    this.encounterObjects = [];
    const { width, height } = this.viewSize();
    const cx = width / 2;
    const cy = height / 2;
    // OVERHAUL UI: the outcome uses the same header strip and log well as the
    // fight itself, so the panel does not change shape when the fight ends.
    const outDepth = PANEL_DEPTH.game.dialogue;
    const outW = this.panelWidthFor(440);
    const outH = 170;
    const outLeft = cx - outW / 2;
    const outTop = cy - outH / 2;
    const headline = outcome === 'win' ? (isBoss ? '守门人倒下了' : '战斗胜利') : '敌人逃走了';
    this.encounterObjects.push(...buildPanel(this, cx, cy, outW, outH, 'yellow', outDepth));
    this.encounterObjects.push(...buildPanelHeader(this, outLeft, outTop, outW, headline, UI.good, outDepth + 5));
    this.encounterObjects.push(...buildPanelWell(this, outLeft + 12, outTop + 26, outW - 24, 62, outDepth + 5));
    const tail = combat.log.slice(-3);
    tail.forEach((line, i) => {
      this.encounterObjects.push(
        this.add
          .text(outLeft + 20, outTop + 38 + i * 17, line, {
            fontFamily: FONT_FAMILY,
            fontSize: `${TYPE.caption}px`,
            color: i === tail.length - 1 ? hex(TEXT.primary) : hex(TEXT.dim),
            wordWrap: { width: outW - 40 },
          })
          .setDepth(outDepth + 7),
      );
    });
    this.encounterObjects.push(
      this.add
        .text(cx, outTop + outH - 12, '点击继续 · Enter / ESC', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.dim) })
        .setOrigin(0.5)
        .setDepth(outDepth + 7),
    );
    this.addModalClickShield(this.encounterObjects, outDepth);
    this.addModalClickTarget(this.encounterObjects, cx, outTop + outH - 12, outW - 24, 24, outDepth, () => {
      if (this.encounterOpen && this.combatDone) this.closeCombat();
    });
    lockToScreen(this.encounterObjects);
    // The fight is over: the outcome screen waits for one Enter, then
    // closeCombat clears state.combat and the floor's spots.
    this.combatDone = true;
    state.combat = { ...combat, log: combat.log };
  }

  private closeEncounter(): void {
    this.encounterOpen = false;
    this.encounter = undefined;
    for (const o of this.encounterObjects) o.destroy();
    this.encounterObjects = [];
    // The floor's spots are rebuilt so a just-resolved one disappears.
    this.buildEncounterSpots();
  }

  private buildEncounterPanel(isBoss: boolean): void {
    for (const o of this.encounterObjects) o.destroy();
    this.encounterObjects = [];
    const enc = this.encounter;
    if (!enc) return;
    const { width, height } = this.viewSize();
    const cx = width / 2;
    const cy = height / 2;
    const panelW = this.panelWidthFor(420);
    const panelH = 190;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;

    const depth = PANEL_DEPTH.game.dialogue;
    this.encounterObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'yellow', depth));
    this.addModalClickShield(this.encounterObjects, depth);
    // OVERHAUL UI: header strip, the message in an inset well, and choices as
    // banded rows instead of '> label' text runs.
    this.encounterObjects.push(
      ...buildPanelHeader(this, left, top, panelW, ENCOUNTER_TITLES[enc.encounter.kind], isBoss ? UI.danger : UI.accent, depth + 5),
    );
    this.encounterObjects.push(...buildPanelWell(this, left + 12, top + 26, panelW - 24, 48, depth + 5));
    this.encounterObjects.push(
      this.add
        .text(left + 20, top + 50, enc.encounter.message, {
          fontFamily: FONT_FAMILY,
          fontSize: `${TYPE.body}px`,
          color: hex(TEXT.primary),
          wordWrap: { width: panelW - 40 },
        })
        .setOrigin(0, 0.5)
        .setDepth(depth + 7),
    );
    if (!enc.resolved) {
      const encounterRows: Array<{ highlight: Phaser.GameObjects.Rectangle; marker: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text }> = [];
      enc.choices.forEach((choice, i) => {
        const y = top + 84 + i * 28;
        const selected = i === enc.selected;
        const highlight = this.add.rectangle(left + 12, y, panelW - 24, 26, UI.accent).setOrigin(0, 0).setAlpha(selected ? 0.14 : 0).setDepth(depth + 5);
        const marker = this.add.rectangle(left + 12, y, 2, 26, UI.accent).setOrigin(0, 0).setAlpha(selected ? 1 : 0).setDepth(depth + 6);
        const label = this.add
          .text(left + 24, y + 13, CHOICE_LABELS[choice], {
            fontFamily: FONT_FAMILY,
            fontSize: `${TYPE.body}px`,
            color: selected ? hex(PALETTE.lightHigh) : hex(TEXT.secondary),
          })
          .setOrigin(0, 0.5)
          .setDepth(depth + 7);
        this.encounterObjects.push(
          highlight,
          marker,
          label,
        );
        encounterRows.push({ highlight, marker, label });
        const selectChoice = (): void => {
          if (!this.encounterOpen || !this.encounter || this.encounter.resolved) return;
          this.encounter.selected = i;
          encounterRows.forEach((row, index) => {
            const isSelected = index === i;
            row.highlight.setAlpha(isSelected ? 0.14 : 0);
            row.marker.setAlpha(isSelected ? 1 : 0);
            row.label.setColor(isSelected ? hex(PALETTE.lightHigh) : hex(TEXT.secondary));
          });
        };
        const hitArea = this.add.zone(cx, y + 13, panelW - 24, 26).setInteractive({ useHandCursor: true }).setDepth(depth + 8);
        hitArea.on('pointerover', selectChoice);
        hitArea.on('pointerdown', () => {
          if (!this.encounterOpen || !this.encounter || this.encounter.resolved) return;
          this.encounter.selected = i;
          this.activateEncounterChoice();
        });
        this.encounterObjects.push(hitArea);
      });
      this.encounterObjects.push(
        this.add
          .text(cx, top + panelH - 12, '点击选项 · ↑/↓ 选择 · Enter 确认 · ESC 离开', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.dim) })
          .setOrigin(0.5)
          .setDepth(depth + 7),
      );
    }
    lockToScreen(this.encounterObjects);
  }

  // Applies a choice: HP is applied here (the system only reports the delta),
  // items are already in the bag from resolveEncounter, and the panel flips to
  // the outcome text — Enter or Esc then closes it.
  private activateEncounterChoice(): void {
    const enc = this.encounter;
    if (!enc || enc.resolved) return;
    const state = getGame();
    const choice = enc.choices[enc.selected];
    const result = resolveEncounter(state, enc.encounter, choice);
    if (result.consumed) markResolved(state, enc.spotId, `${enc.encounter.kind}:${choice}`);
    if (result.hpChange !== 0) {
      state.player.hp = Math.max(0, Math.min(GAME_CONFIG.player.hpMax, state.player.hp + result.hpChange));
    }
    saveToStorage(state);
    enc.resolved = true;
    if (result.items.length > 0) playSfx('chest');
    // A swing reads as a swing: the attack clip plays whenever the player chose
    // to fight, win or lose - and so does the arc, for the same reason.
    if (choice === 'fight') {
      this.playActionAnim(attackAnimKey('player'), 300);
      this.playSwingFx();
    }
    if (result.hpChange < 0) {
      this.cameras.main.shake(160, 0.008);
      this.flashPlayerHurt();
      this.refreshStats();
    }
    // Outcome panel: the message, and the item flow the player actually got.
    for (const o of this.encounterObjects) o.destroy();
    this.encounterObjects = [];
    const { width, height } = this.viewSize();
    const cx = width / 2;
    const cy = height / 2;
    const panelW = this.panelWidthFor(420);
    const panelH = 170;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    const isBoss = enc.encounter.kind === 'boss';
    const depth = PANEL_DEPTH.game.dialogue;
    this.encounterObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'yellow', depth));
    this.encounterObjects.push(...buildPanelHeader(this, left, top, panelW, ENCOUNTER_TITLES[enc.encounter.kind], isBoss ? UI.danger : UI.accent, depth + 5));
    this.encounterObjects.push(...buildPanelWell(this, left + 12, top + 26, panelW - 24, 100, depth + 5));
    this.encounterObjects.push(
      this.add.text(left + 20, top + 38, result.message, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: hex(TEXT.primary), wordWrap: { width: panelW - 40 } }).setOrigin(0, 0).setDepth(depth + 7),
    );
    const loot = result.items.map((s) => `${getItem(s.itemId).displayName}×${s.quantity}`).join('、');
    if (loot) {
      this.encounterObjects.push(
        this.add.text(left + 20, top + 82, `获得：${loot}`, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: hex(TEXT.highlight), wordWrap: { width: panelW - 40 } }).setOrigin(0, 0).setDepth(depth + 7),
      );
    }
    this.encounterObjects.push(
      this.add.text(cx, top + panelH - 12, '点击继续 · Enter / ESC', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.dim) }).setOrigin(0.5).setDepth(depth + 7),
    );
    this.addModalClickShield(this.encounterObjects, depth);
    this.addModalClickTarget(this.encounterObjects, cx, top + panelH - 12, panelW - 24, 24, depth, () => {
      if (this.encounterOpen && this.encounter?.resolved) this.closeEncounter();
    });
    lockToScreen(this.encounterObjects);
    if (state.status === 'lost') {
      this.scene.start('End');
    }
  }


  // The starting floor — the player's dorm, and the visual template the other
  // floors will follow. The wall and floor are single 1280px-wide art images
  // (assets/env), not 16x16 tiles: the art carries the skirting, service pipes,
  // damp patches and the torn notice, so this method only adds what the art cannot
  // — the ceiling shadow, the light sources, and the doors.
  private drawDormRoom(): void {
    const wallH = FLOOR_HEIGHT - FLOOR_BAND;

    const wall = this.add.image(0, 8, ENV_WALL_KEY).setOrigin(0, 0);
    const floor = this.add.image(0, wallH, ENV_FLOOR_KEY).setOrigin(0, 0);

    const g = this.add.graphics();
    // Ceiling shadow only. The skirting, the two service pipes, the damp patches
    // and the pinned notice all used to be drawn here; the wall image has them, and
    // drawing them again printed them straight over the art.
    g.fillStyle(0x0b0f12, 1);
    g.fillRect(0, 0, FLOOR_WIDTH, 8);

    // One lit window per room. The pool is drawn row by row as an ellipse with
    // banded alpha: three stacked rectangles used to sit here, and over textured
    // wall art their edges read as a glowing box rather than as light.
    for (let r = 0; r < ROOM_COUNT; r++) {
      const cx = r * ROOM_WIDTH + ROOM_WIDTH / 2;
      // Cold daylight through the glass, as an ADD glow: the ellipse halo this
      // replaced read as a beige shape painted on the wall rather than as light.
      this.floorObjects.push(addGlow(this, cx - 8, 116, 62, 0.22, LIGHT_DEPTH));
      // The shaft: the window's light falling down the wall and pooling on the
      // floor. A tall, narrow glow is the cheapest honest way to draw a beam in
      // a side view - it gives the frame its brightest pixels, which is what
      // makes the eye read "a light source in the room" rather than "a lit
      // rectangle on a wall".
      const shaft = addGlow(this, cx - 8, 168, 52, 0.34, LIGHT_DEPTH);
      shaft.setScale(0.42, 1.55);
      this.floorObjects.push(shaft);
      this.floorObjects.push(this.add.image(cx - 8, 116, 'tile_window').setOrigin(0.5));
    }

    // Wall lamps between the windows, each with its own small pool of light —
    // the warm counterpoint to the cold daylight through the glass.
    for (let r = 0; r < ROOM_COUNT; r++) {
      const cx = r * ROOM_WIDTH + ROOM_WIDTH / 2;
      const lampX = cx + (r % 2 === 0 ? 96 : -96);
      // The fixture is now a pixelfx candle, and the light is its own.
      //
      // This used to be a glow image stretched into a cone plus a static
      // bracket, and the light never moved - a room lit by painted decals. The
      // candle's flame is a 120-frame loop, so the pool flickers with it, which
      // is the difference between a texture and a light source.
      //
      // The candle's pivot is its dish (28, 70), so placing it at the shade
      // position puts the flame where the old bulb was.
      const candle = startFxLoop(this, 'candle', lampX, 150, LIGHT_DEPTH);
      if (candle) {
        this.floorObjects.push(candle);
        this.lightFixtures.push(candle);
      }
      // a small warm pool that tracks the flame's own brightness
      const lampGlow = addGlow(this, lampX, 162, 26, 0.5, LIGHT_DEPTH);
      lampGlow.setScale(1.05, 1.5);
      this.floorObjects.push(lampGlow);
      // the bracket, now drawn to sit behind the candle rather than under a bulb
      g.fillStyle(0x6a4a2a, 1);
      g.fillRect(lampX - 2, 142, 4, 8);
    }

    // Doors on the room boundaries, standing on the floor line.
    for (let i = 1; i < ROOM_COUNT; i++) {
      this.floorObjects.push(this.add.image(i * ROOM_WIDTH, wallH, 'tile_door').setOrigin(0.5, 1));
    }

    this.floorObjects.push(wall, floor, g);

    // OVERHAUL Art Pass 2: ceiling shadow, baseboard seam, floor gradient and
    // reflections under the lights — the four cues that make a flat side view
    // read as a room with depth.
    const lampXs: number[] = [];
    for (let r = 0; r < ROOM_COUNT; r++) {
      const cx = r * ROOM_WIDTH + ROOM_WIDTH / 2;
      lampXs.push(cx + (r % 2 === 0 ? 96 : -96));
    }
    this.floorObjects.push(
      ...buildRoomDepth(this, {
        width: FLOOR_WIDTH,
        wallBottom: wallH,
        height: FLOOR_HEIGHT,
        lightXs: lampXs,
      }),
      // Water streaks, panel seams, base stains, tile lines and puddles: the
      // detail that stops the two largest surfaces being flat.
      ...buildSurfaceDetail(this, { width: FLOOR_WIDTH, wallBottom: wallH, height: FLOOR_HEIGHT, seed: 11 }),
      ...buildCeilingLights(this, { width: FLOOR_WIDTH, seed: 5, top: 16, fixtures: this.lightFixtures }),
      // The room's density: pipes, vents, junction boxes and signage on the
      // background plane, debris on the floor line. Without this a floor that
      // measures well still looks empty, because an empty frame can pass every
      // colour metric while having nothing in it.
      // Aerial perspective: the wall loses contrast with height, so it recedes.
      ...buildAerialHaze(this, { width: FLOOR_WIDTH, wallBottom: wallH, hazeColor: ambienceFor(STARTING_FLOOR).color, strength: 0.34 }),
      ...buildWallDressing(this, { width: FLOOR_WIDTH, wallBottom: wallH, seed: 3, keepClear: [UP_EXIT_X, DOWN_EXIT_X] }),
      ...buildFloorClutter(this, { width: FLOOR_WIDTH, wallBottom: wallH, seed: 3, keepClear: [UP_EXIT_X, DOWN_EXIT_X] }),
    );

    // The foreground layer last: ceiling beam, floor debris, side margins. This
    // is what puts the camera inside the room instead of in front of a backdrop.
    this.floorObjects.push(
      ...buildForeground(this, { width: FLOOR_WIDTH, height: FLOOR_HEIGHT, wallBottom: wallH, seed: 7 }),
    );

    // OVERHAUL Art Pass: the lighting layer over the dorm too — the bed and the
    // workbench are where the player works, so they get the warm pools.
    this.lightLayer?.destroy();
    this.lightLayer = buildLightLayer(this, {
      width: FLOOR_WIDTH,
      height: FLOOR_HEIGHT,
      isDorm: true,
      hasUpExit: true,
      hasDownExit: false,
      ambience: ambienceFor(STARTING_FLOOR),
    });
  }

  // Floors 2-5 — corridors. They share the dorm's base (art wall, art floor) so
  // the tower reads as one building, then take a per-floor tint and per-floor
  // props: see src/render/corridors.ts.
  private drawCorridor(floor: number): void {
    const wallH = FLOOR_HEIGHT - FLOOR_BAND;
    const tint = corridorTint(floor);

    const wall = this.add.image(0, 8, ENV_WALL_KEY).setOrigin(0, 0);
    const floorBand = this.add.image(0, wallH, ENV_FLOOR_KEY).setOrigin(0, 0);
    this.floorObjects.push(wall, floorBand);

    if (tint) {
      this.floorObjects.push(this.add.rectangle(FLOOR_WIDTH / 2, 8 + (wallH - 8) / 2, FLOOR_WIDTH, wallH - 8, tint.color, tint.alpha));
    }

    const g = this.add.graphics();
    g.fillStyle(0x0b0f12, 1);
    g.fillRect(0, 0, FLOOR_WIDTH, 8);

    // Props, room by room. Each theme decides its own dressing; the loop only
    // supplies the room's position so nothing has to recompute the layout.
    const props: Phaser.GameObjects.GameObject[] = [];
    for (let r = 0; r < ROOM_COUNT; r++) {
      drawCorridorRoom({ scene: this, g, floor, roomX: r * ROOM_WIDTH, floorY: wallH, room: r, objects: props, fixtures: this.lightFixtures });
    }
    this.floorObjects.push(g, ...props);

    this.floorObjects.push(
      ...buildForeground(this, { width: FLOOR_WIDTH, height: FLOOR_HEIGHT, wallBottom: wallH, seed: floor * 31 }),
    );

    // OVERHAUL Art Pass 2: the same depth cues as the dorm, with the
    // stairwells as this floor's light sources.
    this.floorObjects.push(
      ...buildRoomDepth(this, {
        width: FLOOR_WIDTH,
        wallBottom: wallH,
        height: FLOOR_HEIGHT,
        lightXs: [40, 1240],
      }),
      ...buildSurfaceDetail(this, { width: FLOOR_WIDTH, wallBottom: wallH, height: FLOOR_HEIGHT, seed: floor * 17 }),
      ...buildCeilingLights(this, { width: FLOOR_WIDTH, seed: floor * 13, top: 16, fixtures: this.lightFixtures }),
      ...buildAerialHaze(this, { width: FLOOR_WIDTH, wallBottom: wallH, hazeColor: ambienceFor(floor).color, strength: 0.34 }),
      ...buildWallDressing(this, { width: FLOOR_WIDTH, wallBottom: wallH, seed: floor * 19, keepClear: [UP_EXIT_X, DOWN_EXIT_X] }),
      ...buildFloorClutter(this, { width: FLOOR_WIDTH, wallBottom: wallH, seed: floor * 19, keepClear: [UP_EXIT_X, DOWN_EXIT_X] }),
      // A flooding floor looks like one. Held on the scene so the effect can be
      // torn down when the event clears instead of stacking a second set.
      ...this.refreshLeakEffect(floor),
    );

    // OVERHAUL Art Pass: the lighting layer goes on after the props, so the
    // pools and the ambient wash tint everything the room already drew.
    this.lightLayer?.destroy();
    this.lightLayer = buildLightLayer(this, {
      width: FLOOR_WIDTH,
      height: FLOOR_HEIGHT,
      isDorm: false,
      hasUpExit: hasUpExit(floor),
      hasDownExit: hasDownExit(floor),
      // Each floor's own atmosphere: cold housing, green storage, cyan
      // maintenance, warm-and-wrong canteen. Without this the tower is one
      // corridor repeated.
      ambience: ambienceFor(floor),
    });
    this.floorObjects.push(...[]); // the layer owns its own objects
  }

  // The stairwells. In the cross-section a stair is not a 32px decal on the
  // floor any more — it is the thing that joins this floor to the one above or
  // below it, so it is drawn the full height of a floor and the neighbour's
  // floor band is where it lands.
  private drawExits(floor: number): void {
    if (hasUpExit(floor)) {
      this.drawStair(UP_EXIT_X, 'up', floor);
      const upLabel = this.add.text(UP_EXIT_X, FLOOR_HEIGHT - 104, '↑ 上楼', { fontFamily: FONT_FAMILY, fontSize: `${TYPE_AUX}px`, color: hex(PALETTE.clothHigh) }).setOrigin(0.5);
      this.floorObjects.push(upLabel);
    }
    if (hasDownExit(floor)) {
      this.drawStair(DOWN_EXIT_X, 'down', floor);
      const downLabel = this.add.text(DOWN_EXIT_X, FLOOR_HEIGHT - 104, '↓ 下楼', { fontFamily: FONT_FAMILY, fontSize: `${TYPE_AUX}px`, color: hex(PALETTE.lightHigh) }).setOrigin(0.5);
      this.floorObjects.push(downLabel);
    }
  }

  /**
   * One stair, drawn from this floor's band to the neighbour's.
   *
   * `up` climbs toward -Y (the floor above, which sits at -FLOOR_HEIGHT) and
   * `down` descends toward +Y. The flight is drawn as a run of treads that
   * steps monotonically, with a stringer under it and a handrail line, so the
   * connection between the two floors is visible from anywhere on screen — which
   * is the whole point of the cross-section: you can see where the stairs go
   * before you walk to them.
   */
  private drawStair(x: number, dir: 'up' | 'down', floor: number): void {
    // Some connections are vertical shafts; the industrial middle connections
    // use a steep switchback with a small landing. Both shapes share the same
    // deterministic path as stairPosition(), so the character never leaves the
    // drawn steps.
    const y0 = STAIR_START_Y;
    const y1 = y0 + (dir === 'up' ? -STAIR_RISE : STAIR_RISE);
    const style = stairStyleFor(floor, dir === 'up' ? 1 : -1);
    const bendX = stairBendFor(dir === 'up' ? 1 : -1, style);

    const g = this.add.graphics();
    const steps = 18;
    const xAt = (t: number): number => x + bendX * Math.sin(Math.PI * t);
    const yAt = (t: number): number => y0 + (y1 - y0) * t;
    // A dark stringer gives the shaft or switchback a readable silhouette.
    g.lineStyle(9, PALETTE.shadow, 0.95);
    g.beginPath();
    g.moveTo(x, y0);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      g.lineTo(xAt(t), yAt(t));
    }
    g.strokePath();
    // Individual treads make the route legible at the zoomed-out tower view.
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = xAt(t);
      const py = yAt(t);
      g.fillStyle(i % 2 === 0 ? PALETTE.stone : PALETTE.dust, 0.95);
      g.fillRect(Math.round(px - 15), Math.round(py - 2), 30, 4);
    }
    if (style === 'steep') {
      const midX = xAt(0.5);
      const midY = yAt(0.5);
      g.fillStyle(PALETTE.stone, 1);
      g.fillRect(Math.round(midX - 28), Math.round(midY - 3), 56, 6);
    }
    // A handrail follows the same path and ends at both landings.
    g.lineStyle(2, PALETTE.dust, 0.7);
    g.beginPath();
    g.moveTo(x + (dir === 'up' ? 12 : -12), y0 - 8);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      g.lineTo(xAt(t) + (dir === 'up' ? 12 : -12), yAt(t) - 8);
    }
    g.strokePath();
    g.fillStyle(PALETTE.stone, 1);
    g.fillRect(Math.round(x - 24), Math.round(y1 - 3), 48, 4);

    g.setDepth(ACTOR_DEPTH - 1);
    this.floorObjects.push(g);
  }

  /**
   * A neighbouring floor, drawn as context rather than as a playable room.
   *
   * It is the same building, so it is dressed like one: the room props, the wall
   * dressing and the ceiling lights come from the same renderers the player's
   * floor uses. A neighbour used to be a bare wall with three doors on it, which
   * read as an empty shaft — the two floors under the player were visibly there
   * and visibly vacant, and the cross-section promised a tower that the art did
   * not deliver.
   *
   * What a neighbour still does NOT get is everything bound to the floor being
   * played: the interactive light layer, the containers, the NPCs and the
   * encounter spots. Those are floor state, and a neighbour running them would
   * clobber the live floor's.
   *
   * The floor is built inside one container in floor-local 0..FLOOR_HEIGHT
   * coordinates, so the shared renderers work on it unchanged and a single
   * depth keeps the whole thing behind the playable floor. Container children
   * paint in insertion order, so this method's push order stands in for the
   * depth values the live floor uses: base art, then the depth cues, then the
   * props and their light fixtures.
   */
  private drawNeighbourFloor(floor: number, yOffset: number, isAbove: boolean, distance: number): void {
    const wallH = FLOOR_HEIGHT - FLOOR_BAND;
    const tint = corridorTint(floor);
    // A container in floor-local coordinates: the shared renderers build the
    // floor unchanged and one depth keeps all of it behind the playable floor.
    const preexisting = new Set<Phaser.GameObjects.GameObject>(this.children.list);
    const layer = this.add.container(0, yOffset).setDepth(STACK_DEPTH);
    const add = (...objs: Phaser.GameObjects.GameObject[]): void => {
      for (const o of objs) layer.add(o);
    };

    // Base art. Same wall and floor band as every other floor of the tower.
    add(this.add.image(0, 8, ENV_WALL_KEY).setOrigin(0, 0));
    add(this.add.image(0, wallH, ENV_FLOOR_KEY).setOrigin(0, 0));
    if (tint) add(this.add.rectangle(FLOOR_WIDTH / 2, 8 + (wallH - 8) / 2, FLOOR_WIDTH, wallH - 8, tint.color, tint.alpha));
    const ceilingSeam = this.add.graphics();
    ceilingSeam.fillStyle(0x0b0f12, 1);
    ceilingSeam.fillRect(0, 0, FLOOR_WIDTH, 8);
    add(ceilingSeam);

    // The same two-band ambient wash the live floor's light layer lays down,
    // slightly stronger: the wall keeps its own light at the very top, the wall
    // band takes the floor's hue, the floor band takes more of it. Without this
    // a neighbour rendered its props at full colour under nothing but a light
    // haze, so the floors below read BRIGHTER than the one being played and the
    // cross-section inverted — the distant floors became the foreground.
    const amb = ambienceFor(floor);
    const clearY = FLOOR_HEIGHT * 0.16;
    const floorTop = FLOOR_HEIGHT * 0.62;
    add(
      this.add
        .rectangle(FLOOR_WIDTH / 2, (clearY + floorTop) / 2, FLOOR_WIDTH, floorTop - clearY, amb.color)
        .setAlpha(Math.min(0.55, amb.wallAlpha * 1.45)),
    );
    add(
      this.add
        .rectangle(FLOOR_WIDTH / 2, (floorTop + FLOOR_HEIGHT) / 2, FLOOR_WIDTH, FLOOR_HEIGHT - floorTop, amb.color)
        .setAlpha(Math.min(0.62, amb.floorAlpha * 1.45)),
    );

    // Depth cues, identical to the playable floor's so a neighbour reads as a
    // room seen from further away rather than as a flat backdrop. The seeds are
    // the floor number: the two neighbours are different floors, not the same
    // wall printed twice.
    //
    // The wall streaks and the floor litter the live floor gets are left out on
    // purpose: two floors down they are two pixels of noise, and they were 120 of
    // the neighbour's ~250 objects. What survives is what carries meaning at this
    // distance — the room's furniture, its doors, its lights.
    add(...buildRoomDepth(this, { width: FLOOR_WIDTH, wallBottom: wallH, height: FLOOR_HEIGHT, lightXs: [40, 1240] }));
    add(...buildWallDressing(this, { width: FLOOR_WIDTH, wallBottom: wallH, seed: floor * 19, keepClear: [UP_EXIT_X, DOWN_EXIT_X] }));

    // Haze sits behind the props, as it does on the live floor (depth 2), and is
    // the thing that still separates "next floor down" from "the floor after".
    add(...buildAerialHaze(this, { width: FLOOR_WIDTH, wallBottom: wallH, hazeColor: ambienceFor(floor).color, strength: 0.2 }));

    // Room props, by the same theme renderer. Floor 2 is worker housing and floor
    // 3 a store room whether the player is standing on them or looking at them.
    const detail = this.add.graphics();
    const props: Phaser.GameObjects.GameObject[] = [];
    for (let r = 0; r < ROOM_COUNT; r++) {
      drawCorridorRoom({ scene: this, g: detail, floor, roomX: r * ROOM_WIDTH, floorY: wallH, room: r, objects: props });
    }
    // The starting floor is the dorm and has no corridor theme, so as a
    // neighbour it would draw nothing at all. Give it the two pieces of
    // furniture that make it recognisable from the floor above, plus its lit
    // windows — the player should be able to look back down at their own room.
    if (floor === STARTING_FLOOR) {
      for (let r = 0; r < ROOM_COUNT; r++) {
        props.push(this.add.image(r * ROOM_WIDTH + ROOM_WIDTH / 2 - 8, 116, 'tile_window').setOrigin(0.5));
      }
      props.push(this.add.image(BED_X, wallH + 4, 'furn_bed').setOrigin(0.5, 1));
      props.push(this.add.image(CRAFT_X, wallH + 4, 'furn_workbench').setOrigin(0.5, 1));
    }
    detail.setAlpha(0.68);
    // Props are tinted rather than alpha-faded. A prop drawn at full colour is
    // the brightest thing in the frame — a store-room crate in the floor two
    // down was out-shouting the player's own dorm — and neither a haze nor an
    // ambient wash touches an image that is painted in wood and brass. A
    // per-distance tint multiplies those colours down without making the floor
    // see-through, which is what alpha would do.
    const dim = distance === 1 ? 0x9dabbd : 0x76828f;
    const dimObject = (o: Phaser.GameObjects.GameObject): void => {
      const tintable = o as Phaser.GameObjects.GameObject & { setTint?: (c: number) => void };
      if (typeof tintable.setTint === 'function') tintable.setTint(dim);
      // The light-tube rectangles are bright by design and cannot be tinted, so
      // their fill is swapped for a dimmer warm grey: a neighbour's strip light
      // should be a hint of a fixture, not the brightest pixel on screen.
      if (o instanceof Phaser.GameObjects.Rectangle && o.fillColor === PALETTE.lightHot) {
        o.setFillStyle(0x8a8468, o.fillAlpha);
      }
      // A neighbour's flames are hidden outright. Paused on their first frame
      // they read as a small figure standing in the corridor; left looping they
      // are ten 30fps animations burning behind the floor the player is on. The
      // lamp glow underneath survives, so the floor still reads as lit.
      // Matched on the texture, not on the class: these are created by the fx
      // helper and are not reliably Sprite instances, so an instanceof test let
      // every torch through and the neighbour floors kept their full-brightness
      // flames.
      const texKey = (o as Phaser.GameObjects.GameObject & { texture?: { key?: string } }).texture?.key;
      if (texKey === 'torch' || texKey === 'candle' || texKey === 'brazier') {
        (o as Phaser.GameObjects.GameObject & { setVisible(v: boolean): void }).setVisible(false);
      }
    };
    for (const o of props) dimObject(o);
    add(...props);

    // The ceiling strip lights belong on top of the props: they are the room's
    // light source, and they are what tells the eye these floors are habitable
    // at all rather than sealed. Tinted for the same reason as the props.
    const strips = buildCeilingLights(this, { width: FLOOR_WIDTH, seed: floor * 13, top: 16 });
    for (const o of strips) dimObject(o);
    add(...strips);

    // The room linework goes on last, over the props: the door plates, the mats
    // and the lamp spill all belong on top of what they belong to, and the
    // Graphics cannot be tinted, so it is faded instead — its halos were the one
    // element the ambient wash never touched, and they sat on the floor below as
    // pale blobs brighter than the rooms they lit.
    add(detail);

    // The stairwell opening, so the flight arriving from the player's floor has
    // somewhere to land. Drawn after the props because it is a hole in the
    // floor, not something standing on it.
    const stairX = isAbove ? UP_EXIT_X : DOWN_EXIT_X;
    const g = this.add.graphics();
    g.fillStyle(PALETTE.ink, 0.85);
    g.fillRect(stairX - 22, STAIR_START_Y - 10, 44, 10);
    g.fillStyle(PALETTE.stone, 1);
    g.fillRect(stairX - 20, STAIR_START_Y - 8, 40, 6);
    add(g);

    // Anything a room renderer created without handing it back in its object
    // list is swept up here — the canteen's brazier is started with startFxLoop
    // and never returned, so it stayed on the scene at full brightness with its
    // 30fps loop running two floors below the player. Everything new since this
    // method began, that is not already in the layer, belongs to this floor.
    for (const o of [...this.children.list]) {
      if (o === layer || preexisting.has(o)) continue;
      dimObject(o);
      layer.add(o);
    }

    // Aerial perspective by distance, not by the floor's own ambience: a cool
    // haze that strengthens with distance is what recedes. It goes on top of the
    // whole floor, props included, so the second neighbour reads as further
    // away even though it is now fully detailed.
    add(this.add.rectangle(FLOOR_WIDTH / 2, FLOOR_HEIGHT / 2, FLOOR_WIDTH, FLOOR_HEIGHT, 0x1b2836, 0.2 * distance));

    // And the whole floor is set back a step. Detail alone was not enough: once
    // the neighbours were properly furnished, a warm canteen one floor down was
    // rendering more brightly than the cold maintenance floor the player was
    // standing on, and the eye went to the background.
    layer.setAlpha(1 - 0.09 * distance);
    this.floorObjects.push(layer);
  }

  private buildContainers(): void {
    for (const c of this.floorView.containers) {
      const y = FLOOR_HEIGHT - 64;
      const key = containerTextureKey(c.id);
      // Every container has art now, so the Graphics fallback is gone: a missing
      // key would be an invisible container, not a plain one. The interaction box
      // is unchanged either way — hit detection still goes through c.x and
      // INTERACT_DISTANCE.
      this.floorObjects.push(...addContactShadow(this, c.x, y, 44, 2, 0.45));
      const box = this.add.image(c.x, y - 4, key ?? '').setOrigin(0.5, 1);
      // The props are ~80px tall now rather than 16-32, so the label has to sit
      // above the prop instead of at a fixed offset from the floor line — at the
      // old spot it would be printed straight across the middle of the crate.
      const label = this.add
        .text(c.x, y - 4 - box.displayHeight - 8, c.label, { fontFamily: FONT_FAMILY, fontSize: '22px', color: hex(TEXT.primary) })
        .setOrigin(0.5);
      this.containerObjs.set(c.id, { box, label });
      this.floorObjects.push(box, label);
      this.setContainerEmptyVisual(c.id, c.items.length === 0);
    }
  }

  private setContainerEmptyVisual(id: string, empty: boolean): void {
    const obj = this.containerObjs.get(id);
    if (!obj) return;
    const label = this.floorView.containers.find((c) => c.id === id)?.label ?? id;
    obj.box.setAlpha(empty ? 0.35 : 1);
    obj.label.setText(empty ? `${label}（空）` : label);
  }

  private buildGround(): void {
    for (const g of this.floorView.groundItems) {
      const rect = this.add.rectangle(g.x, FLOOR_HEIGHT - 52, 10, 10, 0x77c6a4).setStrokeStyle(1, 0xece8d8);
      this.groundObjs.set(g.key, rect);
      this.floorObjects.push(rect);
    }
  }

  // Ground rectangles are built once per floor visit, so a view change has to
  // rebuild them: otherwise a leak leaves unpickable graphics on the floor, and
  // the supplies stay missing after it clears until the player re-enters.
  private rebuildGround(): void {
    const stale: Phaser.GameObjects.GameObject[] = [...this.groundObjs.values()];
    for (const rect of this.groundObjs.values()) rect.destroy();
    if (stale.length > 0) this.floorObjects = this.floorObjects.filter((o) => !stale.includes(o));
    this.groundObjs.clear();
    this.buildGround();
  }

  private drawBed(): void {
    const y = FLOOR_HEIGHT - 64;
    const bed = this.add.image(BED_X, y + 4, 'furn_bed').setOrigin(0.5, 1);
    const bedLabel = this.add.text(BED_X, y + 4 - bed.displayHeight - 8, '床（睡觉）', { fontFamily: FONT_FAMILY, fontSize: '22px', color: hex(TEXT.primary) }).setOrigin(0.5);
    this.floorObjects.push(bed, bedLabel);
  }

  // ── HUD & inventory UI ─────────────────────────────────────────────────
  private buildHud(): void {
    // A scene restart keeps the display list — Phaser 4's shutdown only nulls
    // the textures — and field initialisers do not re-run, so the previous
    // run's HUD objects would both double up on screen and throw on the first
    // setText/setColor (a stale Text's glTexture is null). Destroy and reset
    // everything this method owns before rebuilding.
    for (const object of this.touchControls) object.destroy();
    this.touchControls = [];
    this.touchDirectionPointers.clear();
    this.input.off(Phaser.Input.Events.POINTER_UP, this.releaseTouchDirection, this);
    this.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.releaseTouchDirection, this);
    this.statLabels = [];
    this.statValues = [];
    this.statBarLayout = [];
    this.lastGoalKey = '';
    this.environmentText?.destroy();
    this.environmentText = undefined;
    this.goalText?.destroy();
    this.goalText = undefined;
    this.scoreText?.destroy();
    this.scoreText = undefined;
    for (const p of this.vignetteParts) p.rect.destroy();
    this.vignetteParts = [];
    this.floorBadge?.destroy();
    this.floorBadge = undefined;
    this.goldText?.destroy();
    this.goldText = undefined;

    // A fixed screen-space instrument strip, then two independent context rows.
    // The world's existing palette stays intact; generous gutters separate
    // survival, location and money so none of them borrow another field's space.
    const hud = HUD_LAYOUT;
    const mobile = this.portraitMode;
    const width = mobile ? this.portraitWidth : DESIGN_WIDTH;
    const topHeight = mobile ? 108 : hud.topHeight;
    const contextBottom = mobile ? 166 : hud.contextBottom;
    this.hudContextBottom = contextBottom;
    this.add.rectangle(0, 0, width, topHeight, UI.surface).setOrigin(0).setAlpha(0.98).setScrollFactor(0).setDepth(100);
    this.add.rectangle(0, topHeight, width, contextBottom - topHeight, UI.surface).setOrigin(0).setAlpha(0.94).setScrollFactor(0).setDepth(100);
    const chrome = this.add.graphics().setName('hud-chrome').setScrollFactor(0).setDepth(101);
    const instrumentPlate = (x: number, y: number, w: number, h: number, signal: number): void => {
      const left = Math.round(x);
      const top = Math.round(y);
      const plateWidth = Math.round(w);
      const plateHeight = Math.round(h);
      chrome.fillStyle(UI.surfaceRaised, mobile ? 0.24 : 0.18);
      chrome.fillRect(left, top, plateWidth, plateHeight);
      chrome.lineStyle(1, UI.line, 0.46);
      chrome.strokeRect(left + 0.5, top + 0.5, plateWidth - 1, plateHeight - 1);
      chrome.fillStyle(signal, 0.9);
      chrome.fillRect(left + 1, top + 1, Math.min(20, plateWidth - 2), 2);
      chrome.fillRect(left + 1, top + 1, 2, Math.max(6, plateHeight - 2));
      chrome.fillStyle(UI.line, 0.65);
      chrome.fillRect(left + plateWidth - 5, top + 4, 2, 2);
      chrome.fillRect(left + 4, top + plateHeight - 6, 2, 2);
    };
    if (mobile) {
      instrumentPlate(8, 2, 140, 34, UI.accent);
      instrumentPlate(width - 116, 2, 108, 34, UI.good);
      const columnWidth = Math.floor((width - 24) / 2);
      STAT_BARS.forEach((stat, i) => {
        const groupX = 12 + (i % 2) * columnWidth;
        const rowY = i < 2 ? 40 : 69;
        instrumentPlate(groupX - 4, rowY - 2, columnWidth - 2, 28, STAT_COLORS[stat.key] ?? UI.good);
      });
    } else {
      instrumentPlate(12, 8, 168, 48, UI.accent);
      STAT_BARS.forEach((stat, i) => {
        instrumentPlate(hud.statX + i * hud.statPitch - 8, 8, hud.statWidth + 20, 48, STAT_COLORS[stat.key] ?? UI.good);
      });
      instrumentPlate(1012, 8, width - 1024, 48, UI.good);
    }
    chrome.lineStyle(1, UI.line, 0.85);
    if (!mobile) for (const x of [196, 1000]) chrome.lineBetween(x, 14, x, hud.topHeight - 14);
    chrome.lineBetween(mobile ? 8 : 16, topHeight - 1, width - (mobile ? 8 : 16), topHeight - 1);
    chrome.lineBetween(mobile ? 8 : 16, contextBottom - 1, width - (mobile ? 8 : 16), contextBottom - 1);
    chrome.fillStyle(UI.accent, 1);
    chrome.fillRect(0, 0, 4, topHeight);
    chrome.fillStyle(UI.accent, 0.9);
    chrome.fillRect(mobile ? 5 : 10, mobile ? 114 : hud.goalY + 3, 2, mobile ? 14 : 18);
    chrome.fillStyle(UI.good, 0.9);
    chrome.fillRect(mobile ? 5 : 10, mobile ? 139 : hud.environmentY + 3, 2, mobile ? 14 : 18);

    this.floorBadge = this.add.text(mobile ? 12 : 20, mobile ? 8 : 6, '', { fontFamily: FONT_FAMILY, fontSize: `${mobile ? 14 : TYPE.body}px`, color: hex(PALETTE.lightHigh) })
      .setName('hud-floor').setScrollFactor(0).setDepth(103);
    this.clockText = this.add.text(mobile ? 72 : 20, mobile ? 9 : 38, '', { fontFamily: FONT_FAMILY, fontSize: `${mobile ? 12 : TYPE.caption}px`, color: hex(TEXT.primary) })
      .setName('hud-clock').setScrollFactor(0).setDepth(103);
    this.refreshClock();

    this.barsGfx = this.add.graphics().setName('hud-stat-bars').setScrollFactor(0).setDepth(103);
    STAT_BARS.forEach((stat, i) => {
      const mobileColumnWidth = Math.floor((width - 24) / 2);
      const groupX = mobile ? 12 + (i % 2) * mobileColumnWidth : hud.statX + i * hud.statPitch;
      const rowY = mobile ? (i < 2 ? 40 : 69) : 10;
      const valueX = mobile ? groupX + mobileColumnWidth - 4 : groupX + hud.statWidth;
      const fontSize = mobile ? '14px' : `${TYPE.caption}px`;
      this.statBarLayout.push({ x: mobile ? groupX + 40 : groupX, y: mobile ? rowY + 18 : 40, width: mobile ? 56 : hud.statWidth });
      this.statLabels.push(this.add.text(groupX, rowY, stat.label, { fontFamily: FONT_FAMILY, fontSize, color: hex(TEXT.primary) })
        .setName(`hud-stat-${stat.key}`).setScrollFactor(0).setDepth(103));
      this.statValues.push(this.add.text(valueX, rowY, '', { fontFamily: FONT_FAMILY, fontSize, color: hex(TEXT.primary) })
        .setOrigin(1, 0).setName(`hud-value-${stat.key}`).setScrollFactor(0).setDepth(103));
    });
    this.refreshStats();

    this.goldText = this.add.text(width - (mobile ? 12 : 20), mobile ? 2 : 6, '', { fontFamily: FONT_FAMILY, fontSize: `${mobile ? 14 : TYPE.caption}px`, color: hex(PALETTE.lightHigh) })
      .setOrigin(1, 0).setName('hud-gold').setScrollFactor(0).setDepth(103);
    this.scoreText = this.add.text(width - (mobile ? 12 : 20), mobile ? 19 : 34, '', { fontFamily: FONT_FAMILY, fontSize: `${mobile ? 14 : TYPE.caption}px`, color: hex(TEXT.highlight) })
      .setOrigin(1, 0).setName('hud-score').setScrollFactor(0).setDepth(103);

    this.goalText = this.add.text(mobile ? 12 : 20, mobile ? 112 : hud.goalY, '', { fontFamily: FONT_FAMILY, fontSize: `${mobile ? 14 : TYPE.caption}px`, color: hex(PALETTE.lightHigh) })
      .setName('hud-goal').setScrollFactor(0).setDepth(HUD_FEEDBACK_DEPTH);
    this.environmentText = this.add.text(mobile ? 12 : 20, mobile ? 137 : hud.environmentY, '', { fontFamily: FONT_FAMILY, fontSize: `${mobile ? 14 : TYPE.caption}px`, color: hex(TEXT.secondary) })
      .setName('hud-environment').setScrollFactor(0).setDepth(HUD_FEEDBACK_DEPTH);

    // Feedback has a dedicated lower lane. It remains above modal panels but
    // can never collide with the daily objective or the permanent environment.
    this.feedbackText = this.add.text(20, hud.feedbackY, '', {
      fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: hex(PALETTE.lightHigh),
      backgroundColor: '#0b0f12ee', padding: { x: 8, y: 5 }, wordWrap: { width: width - (mobile ? 24 : 64) },
    }).setPosition(mobile ? 12 : 20, mobile ? 510 : hud.feedbackY).setName('hud-feedback').setScrollFactor(0).setDepth(HUD_FEEDBACK_DEPTH);
    this.bagFullText = this.add.text(mobile ? 12 : 20, mobile ? 624 : hud.bagY,
      '背包已满 · 使用、制作或交易腾出格子，否则搜刮会留在原处；能叠进已有堆的物品仍可拾取',
      { fontFamily: FONT_FAMILY, fontSize: `${mobile ? 13 : TYPE.caption}px`, color: hex(TEXT.warn), backgroundColor: '#0b0f12ee', padding: { x: 8, y: 3 }, wordWrap: { width: width - (mobile ? 24 : 64) } },
    ).setName('hud-bag-full').setScrollFactor(0).setDepth(HUD_FEEDBACK_DEPTH).setVisible(false);

    // ── the foot bar ────────────────────────────────────────────────────────
    this.add.rectangle(0, DESIGN_HEIGHT - HUD_FOOT_H, width, HUD_FOOT_H, UI.surface).setOrigin(0, 0).setAlpha(0.88).setScrollFactor(0).setDepth(100);
    const footLine = this.add.graphics().setScrollFactor(0).setDepth(101);
    footLine.fillStyle(UI.line, 0.9);
    footLine.fillRect(0, DESIGN_HEIGHT - HUD_FOOT_H, width, 1);
    this.hintText = this.add
      .text(mobile ? width / 2 : 8, mobile ? DESIGN_HEIGHT - HUD_FOOT_H - 14 : DESIGN_HEIGHT - HUD_FOOT_H / 2, mobile ? '' : 'A/D 移动 · E 交互 · I 背包 · C 制作 · M 地图 · Q 切换武器外观（仅视觉） · ESC 菜单', {
        fontFamily: FONT_FAMILY, fontSize: `${mobile ? 12 : TYPE.caption}px`, color: hex(TEXT.highlight),
        ...(mobile ? { backgroundColor: '#0b0f12dd', padding: { x: 6, y: 3 }, wordWrap: { width: width - 24 } } : {}),
      })
      .setOrigin(mobile ? 0.5 : 0, 0.5).setName('hud-hint').setScrollFactor(0).setDepth(HUD_FEEDBACK_DEPTH);
    if (mobile) this.hintText.setVisible(false);

    // The low-HP vignette: pure red wash whose alpha is the pulse function's
    // output. Created invisible; update() drives it every frame.
    // THE SAME fillAlpha TRAP AS THE NIGHT OVERLAY: this was created with a
    // positional fillAlpha of 0 and only ever driven through setAlpha(), so the
    // red low-HP warning never drew a single frame.
    //
    // Fixing it exposed a second problem that had never been visible either: as
    // one full-screen rectangle the pulse peaks near 0.9, which floods the frame
    // with red and hides the game at exactly the moment the player needs to see
    // it. A warning should live at the EDGES. Eight bands (three deep on each
    // side) carry decreasing alphas so the centre stays clear, which is what a
    // vignette is for.
    this.vignetteParts = [];
    const band = (x: number, y: number, w: number, h: number, weight: number): void => {
      const r = this.add
        .rectangle(x, y, w, h)
        .setFillStyle(0xe56d63, 1)
        .setAlpha(0)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(90);
      this.vignetteParts.push({ rect: r, weight });
    };
    const T = 26;
    for (let i = 0; i < 3; i++) {
      const inset = i * T;
      const weight = 0.9 - i * 0.26; // deepest band is the strongest
      band(0, inset, DESIGN_WIDTH, T, weight); // top
      band(0, DESIGN_HEIGHT - inset - T, DESIGN_WIDTH, T, weight); // bottom
      band(inset, 0, T, DESIGN_HEIGHT, weight); // left
      band(width - inset - T, 0, T, DESIGN_HEIGHT, weight); // right
    }
    this.lastStats = '';
    this.refreshGoalHud();
    if (mobile) this.buildTouchControls(width);
  }

  private buildTouchControls(width: number): void {
    const depth = HUD_FEEDBACK_DEPTH + 5;
    const buttonY = DESIGN_HEIGHT - 25;
    const addButton = (
      x: number,
      buttonWidth: number,
      label: string,
      fontSize: number,
      onDown: (pointer: Phaser.Input.Pointer) => void,
    ): void => {
      const background = this.add.rectangle(x, buttonY, buttonWidth, 42, UI.surfaceRaised)
        .setStrokeStyle(2, UI.line)
        .setAlpha(0.96)
        .setScrollFactor(0)
        .setDepth(depth)
        .setInteractive({ useHandCursor: true });
      background.on('pointerdown', onDown);
      const text = this.add.text(x, buttonY, label, {
        fontFamily: FONT_FAMILY,
        fontSize: `${fontSize}px`,
        color: hex(PALETTE.lightHigh),
      }).setOrigin(0.5).setScrollFactor(0).setDepth(depth + 1);
      this.touchControls.push(background, text);
    };

    addButton(28, 44, '◀', 22, (pointer) => {
      if (this.canMoveWithTouchControls()) this.touchDirectionPointers.set(pointer.id, 'left');
    });
    addButton(78, 44, '▶', 22, (pointer) => {
      if (this.canMoveWithTouchControls()) this.touchDirectionPointers.set(pointer.id, 'right');
    });
    addButton(128, 44, 'I', 18, () => {
      if (this.canUseTouchControls()) this.guard('i', this.onToggleInventory);
    });
    addButton(178, 44, 'C', 18, () => {
      if (this.canUseTouchControls()) this.guard('c', this.onToggleCrafting);
    });
    addButton(width - 38, 68, 'E', 18, () => {
      if (this.canUseTouchControls()) this.guard('e', this.onInteract);
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, this.releaseTouchDirection, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.releaseTouchDirection, this);
    this.game.canvas.addEventListener('pointercancel', this.clearTouchDirections);
    window.addEventListener('blur', this.clearTouchDirections);
    document.addEventListener('visibilitychange', this.clearTouchDirections);
  }

  private canUseTouchControls(): boolean {
    return this.portraitMode && !this.stairClimb;
  }

  private canMoveWithTouchControls(): boolean {
    return this.canUseTouchControls() &&
      !this.inventoryOpen && !this.craftingOpen && !this.dialogueOpen && !this.pauseOpen &&
      !this.encounterOpen && !this.shelterOpen;
  }

  private releaseTouchDirection(pointer: Phaser.Input.Pointer): void {
    this.touchDirectionPointers.delete(pointer.id);
  }

  private refreshTouchControlVisibility(): void {
    if (this.touchControls.length === 0) return;
    const visible = this.canUseTouchControls();
    for (const object of this.touchControls) object.setVisible(visible);
    if (!this.canMoveWithTouchControls()) this.touchDirectionPointers.clear();
  }

  // OVERHAUL: the day's objective (rolled lazily on first read of the day) and
  // the run score + depth record. Recomputed on a key so the text objects are
  // only touched when something actually changed.
  //
  // Guarded because refreshStats() — which calls this — runs from buildHud
  // before the goal/score texts exist; the first real call is the one at the
  // end of buildHud, after they are created.
  private refreshGoalHud(): void {
    if (!this.goalText || !this.scoreText) return;
    const state = getGame();
    ensureDailyGoal(state);
    const goal = state.dailyGoal;
    const done = goal ? isDailyGoalDone(state) : false;
    const label = goal ? GOAL_LABELS[goal.kind](goal.target) : '';
    const stress = Math.round(state.player.stress ?? 20);
    const key = `${goal?.day ?? 0}|${goal?.kind ?? ''}|${goal?.target ?? 0}|${String(done)}|${stress}`;
    if (key !== this.lastGoalKey) {
      this.lastGoalKey = key;
      const compactGoal = goal
        ? goal.kind === 'water' ? `净水×${goal.target}`
          : goal.kind === 'containers' ? `搜刮×${goal.target}`
            : goal.kind === 'upgrade' ? `升级×${goal.target}`
              : `到${goal.target}层`
        : '';
      this.goalText.setText(this.portraitMode
        ? `主线100000层 · 今日${compactGoal}${done ? '✓' : ''} · 压${stress}`
        : `主线：抵达第 100000 层 · 今日目标 ${label}${done ? ' ✓' : ''} · 压力 ${stress}`);
      this.goalText.setColor(done ? hex(TEXT.highlight) : hex(PALETTE.lightHigh));
    }
    this.scoreText.setText(`分数 ${runScore(state)}`);
    this.goldText?.setText(`金币 ${state.player.gold}`);
    this.scoreText.setFontSize(this.portraitMode ? 14 : TYPE.caption);
    if (this.scoreText.width > (this.portraitMode ? 120 : 240)) this.scoreText.setFontSize(this.portraitMode ? 12 : 18);
    if (this.goldText) {
      this.goldText.setFontSize(this.portraitMode ? 14 : TYPE.caption);
      if (this.goldText.width > (this.portraitMode ? 120 : 240)) this.goldText.setFontSize(this.portraitMode ? 12 : 18);
    }
    this.goalText.setFontSize(this.portraitMode ? 12 : TYPE.caption);
    this.fitHudLine(this.goalText, this.portraitMode ? this.portraitWidth - 24 : 1240);
  }

  /** Preserve legible type; shorten only exceptional overlong HUD strings. */
  private fitHudLine(text: Phaser.GameObjects.Text, width: number): void {
    if (text.width <= width) return;
    const characters = Array.from(text.text);
    while (characters.length > 1 && text.width > width) {
      characters.pop();
      text.setText(`${characters.join('')}…`);
    }
  }

  /** Keep touch-mode context above the buttons, and omit desktop-only key legends. */
  private setInteractionHint(message: string): void {
    const genericControls = message.startsWith('A/D 或 ←/→');
    if (this.portraitMode && (genericControls || this.bagFullShown)) {
      this.hintText.setText('').setVisible(false);
      return;
    }
    this.hintText.setText(message).setVisible(true);
    if (this.portraitMode) this.fitHudLine(this.hintText, this.portraitWidth - 24);
  }

  private refreshClock(): void {
    const s = getGame();
    const label = hudClockLabel(s.day, s.gameMinuteOfDay);
    if (label !== this.lastClock) {
      this.lastClock = label;
      this.clockText.setText(label);
    }
    this.floorBadge?.setText(`第${s.currentFloor}层`);
    this.fitHudLine(this.clockText, this.portraitMode ? 64 : 164);
  }

  private refreshStats(): void {
    // Transactions can change money while a modal freezes the ordinary tick.
    this.refreshGoalHud();
    const p = getGame().player;
    const values = [p.hp, p.hunger, p.thirst, p.energy];
    const key = `${values.map((v) => Math.round(v)).join(',')}|${Math.round(p.stress ?? 20)}`;
    if (key === this.lastStats) return;
    this.lastStats = key;
    this.barsGfx.clear();
    values.forEach((v, i) => {
      const layout = this.statBarLayout[i] ?? { x: HUD_LAYOUT.statX + i * HUD_LAYOUT.statPitch, y: 40, width: HUD_LAYOUT.statWidth };
      const color = STAT_COLORS[STAT_BARS[i].key] ?? UI.good;
      drawStatBar(this.barsGfx, layout.x, layout.y, layout.width, this.portraitMode ? 6 : 8, v / 100, color);
      this.statValues[i]?.setText(String(Math.round(v)));
    });
    // The most urgent bar's label turns red, so the critical slot is findable
    // without reading four numbers.
    const urgent = mostUrgentStat(getGame().player);
    this.statLabels.forEach((t, i) => t.setColor(STAT_BARS[i].key === urgent ? hex(TEXT.warn) : hex(TEXT.secondary)));
    this.statValues.forEach((t, i) => t.setColor(STAT_BARS[i].key === urgent ? hex(TEXT.warn) : hex(TEXT.primary)));
  }

  /**
   * The environment line refreshes on its own, not from refreshStats.
   *
   * refreshStats early-returns when the four bars have not moved, and the
   * environment changes without any of them moving - walking from floor 4 onto
   * floor 5's brazier changes the heat and nothing else. Calling it from the
   * frame loop instead is what keeps the line honest.
   */
  private refreshEnvironmentHud(): void {
    if (!this.environmentText) return;
    const state = getGame();
    const temp = bodyTempOf(state);
    // The readout says what the heat is doing, not just the number: "回暖中" next
    // to a brazier is the feedback that standing here was the right call.
    const heat = warmthAt(state.currentFloor, state.player.x);
    let mood: string;
    if (heat > 0 && temp < BODY_TEMP_MAX) mood = '回暖中';
    else if (temp <= COLD_THRESHOLD) mood = '寒冷';
    else if (temp >= 85) mood = '暖和';
    else mood = '微凉';
    // An ailment outranks the weather on this line: being ill is more urgent than
    // being chilly, and this line is the only place either is stated.
    const ill = ailmentLabel(state);
    const envPart = ill ? `${ill} · ${environmentLabel(state.currentFloor)}` : environmentLabel(state.currentFloor);
    this.environmentText.setText(this.portraitMode
      ? `体温${Math.round(temp)} ${mood} · ${envPart}`
      : `${TEMP_LABEL} ${Math.round(temp)} ${mood} · ${envPart}`);
    this.environmentText.setColor(temp <= COLD_THRESHOLD || ill !== '' ? hex(TEXT.warn) : hex(TEXT.secondary));
    this.fitHudLine(this.environmentText, this.portraitMode ? this.portraitWidth - 24 : 1240);
  }

  private buildInventoryPanel(): void {
    // OVERHAUL UI: this panel used to be a 380x340 box holding twelve rows of
    // "name ×count" text in 13px monospace — measured, 46% of the whole screen
    // was one flat colour. It is now an icon grid on the left and a detail pane
    // on the right: the icons carry the identity, the pane carries the words,
    // and neither one is a wall of text.
    const { width, height } = this.viewSize();
    const panelW = this.panelWidthFor(440);
    // The panel grew 14px because the detail well below grew 20px: the well
    // carries a three-line body copy and the buttons below it need their air.
    const panelH = this.portraitMode ? 340 : 250;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    const depth = PANEL_DEPTH.game.inventory;

    this.invObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'green', depth));
    this.invObjects.push(...buildPanelHeader(this, left, top, panelW, '背包', UI.good, depth + 5));
    this.invObjects.push(
      this.add
        .text(left + panelW - 10, top + 10, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.highlight) })
        .setOrigin(1, 0.5)
        .setDepth(depth + 6),
    );
    this.invCountText = this.invObjects[this.invObjects.length - 1] as Phaser.GameObjects.Text;

    // ── the grid ────────────────────────────────────────────────────────────
    // 4 columns x 3 rows of 40px cells: twelve slots, no scrolling, and each
    // cell is big enough for a 2x icon (pixel art upscales cleanly at integer
    // factors, unlike the old 16px icons in a 20px row).
    const CELL = this.portraitMode ? 32 : 40;
    const GAP = this.portraitMode ? 4 : 5;
    const GRID_W = 4 * CELL + 3 * GAP;
    const GRID_X = this.portraitMode ? cx - GRID_W / 2 : left + 12;
    const GRID_Y = top + 30;
    this.invCells = [];
    this.invSlotIcons = [];
    this.invSlotTexts = [];
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = GRID_X + col * (CELL + GAP);
      const y = GRID_Y + row * (CELL + GAP);
      const cell = this.add.rectangle(x, y, CELL, CELL, 0x080c0f).setOrigin(0, 0).setAlpha(0.6).setDepth(depth + 5);
      cell.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        if (!this.inventoryOpen || !getGame().player.inventory.slots[i]) return;
        this.invSelected = i;
        this.refreshInventory();
      });
      const border = this.add.graphics().setDepth(depth + 6);
      border.lineStyle(1, UI.line, 0.85);
      border.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
      const icon = this.add
        .image(x + CELL / 2, y + CELL / 2, 'blank')
        .setOrigin(0.5)
        .setScale(this.portraitMode ? 1.5 : 2)
        .setDepth(depth + 6);
      const badge = this.add
        .text(x + CELL - 3, y + CELL - 3, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.primary), stroke: hex(PALETTE.ink), strokeThickness: 3 })
        .setOrigin(1, 1)
        .setDepth(depth + 7);
      this.invCells.push(cell);
      this.invSlotIcons.push(icon);
      this.invSlotTexts.push(badge);
      this.invObjects.push(cell, border, icon, badge);
    }

    // ── the detail pane ─────────────────────────────────────────────────────
    const DETAIL_X = this.portraitMode ? left + 12 : GRID_X + 4 * (CELL + GAP) + 8;
    const DETAIL_Y = this.portraitMode ? GRID_Y + 3 * (CELL + GAP) - GAP + 8 : GRID_Y;
    const DETAIL_W = this.portraitMode ? panelW - 24 : left + panelW - 12 - DETAIL_X;
    // The detail well is taller than the icon grid. It used to be exactly as
    // tall as the grid (3 rows of cells), which left no room for a body copy
    // that wraps: the longest one — "空格子。搜刮、制作或交易都往这里放东西。"
    // (20 Han characters, 480px at 24px) — needs three lines of 25px once the
    // wrap is on, and three lines plus a 30px title and a 20px meta line do
    // not fit in 130px. 150px holds all of it with room to spare.
    //
    // Portrait needs its own number: the copy is 13px there (260px natural
    // width) and the wrap box is 224px, so it wraps to **two** lines of 14px.
    // 66px held exactly one line, so the second line had nowhere to go and the
    // whole sentence rode 28px past the well's right edge (measured at
    // 360×900: body x[32..292] vs well x[24..264]). 80px holds both lines.
    const DETAIL_H = this.portraitMode ? 80 : 150;
    this.invObjects.push(...buildPanelWell(this, DETAIL_X, DETAIL_Y, DETAIL_W, DETAIL_H, depth + 5));
    // Three rows at 8 / 44 / 68. They used to be at 10 / 48 / 76, which only
    // worked because SimSun's glyphs sit inside a much smaller ink box than the
    // em size; a pixel face fills the whole em, so the 30px name ran straight
    // through the 20px meta line and the body through both. The body moved up
    // because it is now three lines tall instead of one.
    this.invDetailName = this.add
      .text(DETAIL_X + 8, DETAIL_Y + (this.portraitMode ? 5 : 8), '', { fontFamily: FONT_FAMILY, fontSize: `${this.portraitMode ? 16 : TYPE.title}px`, color: hex(PALETTE.lightHigh) })
      .setDepth(depth + 7);
    this.invDetailMeta = this.add
      .text(DETAIL_X + 8, DETAIL_Y + (this.portraitMode ? 26 : 44), '', { fontFamily: FONT_FAMILY, fontSize: `${this.portraitMode ? 13 : TYPE.caption}px`, color: hex(TEXT.dim) })
      .setDepth(depth + 7);
    this.invDetailBody = this.add
      .text(DETAIL_X + 8, DETAIL_Y + (this.portraitMode ? 45 : 68), '', {
        fontFamily: FONT_FAMILY,
        fontSize: `${this.portraitMode ? 13 : TYPE.body}px`,
        color: hex(TEXT.primary),
        // useAdvancedWrap breaks a too-long line **by character**. Phaser's
        // default wrap only breaks on spaces, and Chinese has none, so the
        // 20-character empty-slot copy stayed on one 480px line and sailed
        // 238px past the panel's right edge.
        //
        // Portrait needs it too: there the copy is 13px (260px natural width)
        // against a 224px wrap box, so the default wrap left it on one line
        // that rode 28px past the well's right edge (measured at 360×900).
        // The "it already fits" claim was true only for the 4-character effect
        // text that was measured back then, not for the empty-slot copy.
        wordWrap: { width: DETAIL_W - 16, useAdvancedWrap: true },
      })
      .setDepth(depth + 7);
    this.invObjects.push(this.invDetailName, this.invDetailMeta, this.invDetailBody);

    const buttonY = this.portraitMode ? top + panelH - 44 : top + 206;
    this.invObjects.push(...this.panelMouseButton(cx - 68, buttonY, '使用', () => {
      if (this.inventoryOpen) this.onUse();
    }));
    this.invObjects.push(...this.panelMouseButton(cx + 68, buttonY, '关闭', () => {
      if (this.inventoryOpen) this.toggleInventory();
    }));
    const footer = this.add
      .text(cx, top + panelH - 12, this.portraitMode ? '点选物品 · 点 使用 · I 关闭' : '点击选择 · ↑/↓ 选择 · Enter 使用 · I 关闭', { fontFamily: FONT_FAMILY, fontSize: `${this.portraitMode ? 14 : TYPE.caption}px`, color: hex(PALETTE.clothHigh) })
      .setOrigin(0.5, 0.5)
      .setDepth(depth + 6);
    this.invObjects.push(footer, this.invMarker);

    applyPanelDepth(this.invObjects, depth);
    this.assertPanelContent('inventory', this.invObjects);
    for (const o of this.invObjects) o.setVisible(false);
  }

  private refreshInventory(): void {
    const slots = getGame().player.inventory.slots;
    if (this.invSelected >= INVENTORY_SLOTS) this.invSelected = Math.max(0, INVENTORY_SLOTS - 1);
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      const badge = this.invSlotTexts[i];
      const icon = this.invSlotIcons[i];
      const stack = slots[i];
      if (stack) {
        // Keyed by item id, never by display name — see itemIconKey().
        // Loot/pickup refreshes can run while the panel is closed. Keep content
        // visibility owned by the panel lifecycle instead of exposing orphaned
        // icons when those refreshes update the slot data.
        icon.setTexture(itemIconKey(stack.itemId)).setVisible(this.inventoryOpen);
        badge.setText(stack.quantity > 1 ? `${stack.quantity}` : '');
      } else {
        icon.setVisible(false);
        badge.setText('');
      }
    }
    // Highlight the selected cell.
    this.invCells.forEach((c, i) => {
      c.setFillStyle(i === this.invSelected ? UI.accent : 0x080c0f, i === this.invSelected ? 0.2 : 0.6);
    });
    if (this.invCountText) this.invCountText.setText(`${slots.length}/${INVENTORY_SLOTS}`);

    const selected = slots[this.invSelected];
    const cell = this.invCells[this.invSelected];
    this.invMarker.setVisible(this.inventoryOpen && selected !== undefined && cell !== undefined);
    if (selected && cell) placeMarkerLeftOf(this.invMarker, cell);

    if (selected) {
      const item = getItem(selected.itemId);
      const category = item.category === 'consumable' ? '消耗品' : item.category === 'material' ? '材料' : '工具';
      this.invDetailName?.setText(item.displayName);
      this.invDetailMeta?.setText(`${category} · 持有 ${selected.quantity}`);
      const effect = item.effect ? `${STAT_LABEL[item.effect.stat]} +${item.effect.amount}` : '';
      this.invDetailBody?.setText(effect || `${category}，暂时没有直接效果。`);
    } else {
      this.invDetailName?.setText('');
      this.invDetailMeta?.setText('');
      this.invDetailBody?.setText('空格子。搜刮、制作或交易都往这里放东西。');
    }
  }


  private toggleInventory(): void {
    this.inventoryOpen = !this.inventoryOpen;
    for (const o of this.invObjects) o.setVisible(this.inventoryOpen);
    if (this.inventoryOpen) {
      this.invSelected = 0;
      this.refreshInventory();
    }
  }

  private flash(msg: string): void {
    this.feedbackText.setText(msg);
    if (this.introFeedbackTimeout !== undefined) window.clearTimeout(this.introFeedbackTimeout);
    this.introFeedbackTimeout = undefined;
    this.feedbackTimer?.remove(false);
    this.feedbackTimer = this.time.delayedCall(1600, () => this.feedbackText.setText(''));
  }

  private flashOnWallClock(msg: string): void {
    this.feedbackTimer?.remove(false);
    this.feedbackTimer = undefined;
    if (this.introFeedbackTimeout !== undefined) window.clearTimeout(this.introFeedbackTimeout);
    this.feedbackText.setText(msg);
    // The first-floor tutorial is real-time guidance; Phaser's fixed-step timer
    // stretches under a throttled renderer because it advances one frame per update.
    this.introFeedbackTimeout = window.setTimeout(() => {
      this.introFeedbackTimeout = undefined;
      this.feedbackText.setText('');
    }, 1600);
  }

  private applyNightLighting(): void {
    const state = getGame();
    const night = nightOverlayAlpha(state);
    this.nightOverlay.setAlpha(night);
    // The tint carries its own low alpha in the texture; scaling the layer by
    // `night` keeps it in step with the darkening without changing the art.
    if (this.nightTint) this.nightTint.setAlpha(night);
    if (this.playerLight) {
      // Full strength at the darkest setting, off in daylight. Kept below the
      // lamp upgrade's brightness so crafting a lamp still visibly pays.
      this.playerLight.setAlpha(Math.min(0.5, night * 0.62));
    }
    // A BLACKOUT PUTS THE LIGHTS OUT. The event existed only as a darker overlay:
    // the corridor went to 0.82 alpha while every candle, torch and brazier kept
    // burning at full strength, which says "it is dark in here" and "nothing has
    // changed" at the same time. The fixtures now die with it - and they die in
    // sequence rather than all at once, because a real blackout takes the
    // circuits out one by one.
    const blackout = state.worldEvents.activeEvent?.type === 'blackout';
    if (blackout !== this.wasBlackout) {
      this.wasBlackout = blackout;
      this.blackoutAt = this.time.now;
    }
    if (blackout) {
      // each fixture goes dark 260ms after the last, over ~1.3s
      const step = Math.min(this.lightFixtures.length, Math.floor((this.time.now - this.blackoutAt) / 260));
      for (let i = 0; i < this.lightFixtures.length; i++) {
        const want = i < step ? 0 : 1;
        const cur = this.lightFixtures[i].alpha;
        // a stutter before it goes: the last two before each one dies flicker
        const flicker = want === 1 && i >= step - 2 && Math.sin(this.time.now / 40) > 0 ? 0.35 : want;
        this.lightFixtures[i].setAlpha(cur + (flicker - cur) * 0.25);
      }
    } else if (this.lightFixtures.length) {
      for (const f of this.lightFixtures) f.setAlpha(Math.min(1, f.alpha + 0.12));
    }
    // OVERHAUL Art Pass: the pools breathe, so the light is alive rather than
    // a painted-on decal.
    this.lightLayer?.update(this.time.now, this.game.loop.delta);
  }

  /** Puddles and drips while this floor is the leaking one. */
  private refreshLeakEffect(floor: number): Phaser.GameObjects.GameObject[] {
    for (const o of this.leakObjects) o.destroy();
    this.leakObjects = [];
    const event = getGame().worldEvents.activeEvent;
    if (event?.type !== 'leak' || event.floor !== floor) return [];
    // The puddles sit on the floor line, which the wall height tells us.
    const floorY = FLOOR_HEIGHT - FLOOR_BAND;
    this.leakObjects = buildLeakEffect(this, { width: FLOOR_WIDTH, floorY, seed: floor * 31 });
    // remember where the puddles are, so the drips can land in them
    this.leakPuddleXs = [];
    for (let i = 0; i < 7; i++) {
      const hh = (n: number): number => {
        const v = Math.sin(floor * 31 + i * 7.7 + n) * 10000;
        return v - Math.floor(v);
      };
      this.leakPuddleXs.push(60 + hh(1) * (FLOOR_WIDTH - 120));
    }
    // AND IT IS STILL COMING DOWN. The puddles were the whole event: a flooded
    // floor with water that never moved, which reads as a texture rather than as
    // a leak. Each puddle now gets a drip falling into it from the ceiling and a
    // ripple spreading where it lands, so the floor is visibly taking water.
    for (const px of this.leakPuddleXs) {
      const drip = startFxLoop(this, 'drip', px, 120, DUST_DEPTH);
      if (drip) this.leakObjects.push(drip);
      const ring = startFxLoop(this, 'ripples', px, floorY + 2, DUST_DEPTH);
      if (ring) this.leakObjects.push(ring);
    }
    return [];
  }

  private nearCraftStation(state: GameState): boolean {
    return state.currentFloor === STARTING_FLOOR && Math.abs(state.player.x - CRAFT_X) <= INTERACT_DISTANCE;
  }

  private drawWorkbench(): void {
    const y = FLOOR_HEIGHT - 64;
    const bench = this.add.image(CRAFT_X, y + 4, 'furn_workbench').setOrigin(0.5, 1);
    const benchLabel = this.add.text(CRAFT_X, y + 4 - bench.displayHeight - 8, '工作台', { fontFamily: FONT_FAMILY, fontSize: '22px', color: hex(TEXT.primary) }).setOrigin(0.5);
    this.upgradeBoard = this.add.text(CRAFT_X, y + 34, '', { fontFamily: FONT_FAMILY, fontSize: '22px', color: hex(PALETTE.clothHigh) }).setOrigin(0.5);
    this.floorObjects.push(bench, benchLabel, this.upgradeBoard);
    this.refreshUpgradeBoard();
  }

  private refreshUpgradeBoard(): void {
    if (!this.upgradeBoard) return;
    const built = getGame().player.homeUpgrades.map((id) => getRecipe(id as UpgradeId).displayName);
    this.upgradeBoard.setText(built.length > 0 ? `已建：${built.join('、')}` : '');
  }

  /** A separate action button prevents selecting an item from consuming it. */
  private panelMouseButton(x: number, y: number, label: string, action: () => void, width = 116): PanelObject[] {
    const button = this.add.rectangle(x, y, width, 28, UI.surfaceRaised)
      .setStrokeStyle(1, UI.line)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', action);
    const text = this.add.text(x, y, label, {
      fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.primary),
    }).setOrigin(0.5);
    return [button, text];
  }

  private buildCraftPanel(): void {
    const { width, height } = this.viewSize();
    const panelW = this.panelWidthFor(460);
    const panelH = 300;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;

    this.craftObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'yellow', PANEL_DEPTH.game.craft));
    // OVERHAUL UI: header strip instead of a centred title floating on a slab.
    this.craftObjects.push(...buildPanelHeader(this, left, top, panelW, '工作台 · 制作', UI.accent, PANEL_DEPTH.game.craft + 5));
    const title = this.add.text(cx, top + 18, '', { fontFamily: FONT_FAMILY, fontSize: '32px', color: hex(PALETTE.lightHigh) }).setOrigin(0.5);
    this.craftObjects.push(title);

    // OVERHAUL UI: row bands + a status column.
    //
    // The old list was four lines of text inside an opaque slab — no banding, no
    // columns, nothing to anchor the eye. Each row now has its own band (alternate
    // rows tinted), a fixed-cost column and a right-aligned status, so a row reads
    // like a row instead of a sentence.
    this.craftRows = [];
    for (let i = 0; i < 4; i++) {
      const rowY = top + 30 + i * CRAFT_ROW_PITCH;
      const band = this.add.rectangle(left + 8, rowY, panelW - 16, CRAFT_ROW_PITCH - 2, UI.surfaceRaised).setOrigin(0, 0).setAlpha(0.34).setDepth(PANEL_DEPTH.game.craft + 5);
      band.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        if (!this.craftingOpen || !this.craftEntries()[i]) return;
        this.craftSelected = i;
        this.refreshCraft();
      });
      const name = this.add.text(left + 18, rowY + 11, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: hex(TEXT.primary) }).setOrigin(0, 0.5).setDepth(PANEL_DEPTH.game.craft + 6);
      const cost = this.add.text(left + 18, rowY + 35, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.dim) }).setOrigin(0, 0.5).setDepth(PANEL_DEPTH.game.craft + 6);
      const status = this.add.text(left + panelW - 16, rowY + 11, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.highlight) }).setOrigin(1, 0.5).setDepth(PANEL_DEPTH.game.craft + 6);
      this.craftRows.push({ band, name, cost, status });
      this.craftObjects.push(band, name, cost, status);
    }
    this.craftObjects.push(...this.panelMouseButton(cx - 68, top + 250, '制作 / 净化', () => {
      if (this.craftingOpen) this.activateCraftEntry();
    }));
    this.craftObjects.push(...this.panelMouseButton(cx + 68, top + 250, '关闭', () => {
      if (this.craftingOpen) this.toggleCrafting();
    }));
    const footer = this.add.text(cx, top + panelH - 12, '点击选择 · ↑/↓ 选择 · Enter 制作 · C 关闭', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(PALETTE.clothHigh) }).setOrigin(0.5).setDepth(PANEL_DEPTH.game.craft + 6);
    this.craftObjects.push(footer, this.craftMarker);

    applyPanelDepth(this.craftObjects, PANEL_DEPTH.game.craft);
    this.assertPanelContent('craft', this.craftObjects);
    for (const o of this.craftObjects) o.setVisible(false);
  }

  private craftEntries(): Array<{ kind: 'recipe' | 'purify'; id?: UpgradeId }> {
    const entries: Array<{ kind: 'recipe' | 'purify'; id?: UpgradeId }> = RECIPES.map((r) => ({ kind: 'recipe', id: r.id }));
    if (hasUpgrade(getGame(), 'purifier')) entries.push({ kind: 'purify' });
    return entries;
  }

  private refreshCraft(): void {
    const state = getGame();
    const entries = this.craftEntries();
    if (this.craftSelected >= entries.length) this.craftSelected = Math.max(0, entries.length - 1);
    for (let i = 0; i < 4; i++) {
      const row = this.craftRows[i];
      if (!row) continue;
      const entry = entries[i];
      if (!entry) {
        row.name.setText('');
        row.cost.setText('');
        row.status.setText('');
        row.band.setAlpha(0);
        continue;
      }
      const selected = i === this.craftSelected;
      row.band.setAlpha(selected ? 0.18 : 0.3);
      row.band.setFillStyle(selected ? UI.accent : UI.surfaceRaised, 1);
      if (entry.kind === 'recipe') {
        const recipe = getRecipe(entry.id!);
        const cost = Object.entries(recipe.cost)
          .map(([id, n]) => `${getItem(id as ItemId).displayName}×${n}`)
          .join(' ');
        row.name.setText(recipe.displayName);
        row.cost.setText(cost);
        row.name.setColor(selected ? hex(PALETTE.lightHigh) : hex(TEXT.primary));
        const built = hasUpgrade(state, entry.id!);
        const check = canCraft(state, entry.id!);
        row.status.setText(built ? '已建' : check.ok ? '可制作' : check.reason ? '预留通行材料' : '材料不足');
        row.status.setColor(built ? hex(PALETTE.clothHigh) : check.ok ? hex(PALETTE.lightHigh) : hex(TEXT.dim));
      } else {
        const can = countItem(state.player.inventory, 'dirty_water') >= 1;
        row.name.setText('净化');
        row.cost.setText('脏水→净水');
        row.name.setColor(selected ? hex(PALETTE.lightHigh) : hex(TEXT.primary));
        row.status.setText(can ? '可净化' : '缺脏水');
        row.status.setColor(can ? hex(PALETTE.clothHigh) : hex(TEXT.dim));
      }
    }
    const selectedRow = this.craftRows[this.craftSelected];
    this.craftMarker.setVisible(entries[this.craftSelected] !== undefined && selectedRow !== undefined);
    if (entries[this.craftSelected] && selectedRow) placeMarkerLeftOf(this.craftMarker, selectedRow.name);
  }


  private toggleCrafting(): void {
    this.craftingOpen = !this.craftingOpen;
    for (const o of this.craftObjects) o.setVisible(this.craftingOpen);
    if (this.craftingOpen) {
      this.craftSelected = 0;
      this.refreshCraft();
    }
  }

  private buildPausePanel(): void {
    const { width, height } = this.viewSize();
    const panelW = this.panelWidthFor(460);
    const panelH = 264;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;

    this.pauseObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'yellow', PANEL_DEPTH.game.pause));
    this.pauseObjects.push(...buildPanelHeader(this, left, top, panelW, '已暂停', UI.accent, PANEL_DEPTH.game.pause + 5));
    const title = this.add.text(cx, top + 20, '', { fontFamily: FONT_FAMILY, fontSize: '32px', color: hex(PALETTE.lightHigh) }).setOrigin(0.5);
    // 20px and a 460px panel: the old 22px line in a 380px panel ran out past
    // the frame, because a full-width Han glyph in a monospaced pixel face is
    // the whole em wide and the line has twelve of them.
    const controls = this.add.text(cx, top + 50, 'A/D 移动 · E 交互 · I 背包 · C 制作', { fontFamily: FONT_FAMILY, fontSize: '20px', color: hex(PALETTE.clothHigh) }).setOrigin(0.5);
    this.pauseObjects.push(title, controls, this.pauseMarker);

    PAUSE_OPTIONS.forEach((label, i) => {
      // 40px pitch, up from 28: four 24px rows at 28px touched.
      const t = this.add.text(cx, top + 96 + i * 40, label, { fontFamily: FONT_FAMILY, fontSize: `${TYPE_BODY}px`, color: hex(TEXT.primary) }).setOrigin(0.5);
      this.pauseOptionTexts.push(t);
      this.pauseObjects.push(t);
    });

    applyPanelDepth(this.pauseObjects, PANEL_DEPTH.game.pause);
    this.assertPanelContent('pause', this.pauseObjects);
    for (const o of this.pauseObjects) o.setVisible(false);
  }

  private refreshPause(): void {
    this.pauseOptionTexts.forEach((t, i) => t.setText(PAUSE_OPTIONS[i]));
    const selectedText = this.pauseOptionTexts[this.pauseSelected];
    if (selectedText) placeMarker(this.pauseMarker, selectedText);
  }

  private togglePause(): void {
    this.pauseOpen = !this.pauseOpen;
    for (const o of this.pauseObjects) o.setVisible(this.pauseOpen);
    if (this.pauseOpen) {
      this.pauseSelected = 0;
      this.refreshPause();
    }
  }

  private activatePause(): void {
    if (this.pauseSelected === 0) {
      this.togglePause(); // 继续游戏
    } else if (this.pauseSelected === 1) {
      this.openTowerOverview(); // 塔楼地图
    } else if (this.pauseSelected === 2) {
      clearSave();
      startNewGame(Date.now() >>> 0); // 重新开始
      // A restart is a new run, so it goes through the character pick like any
      // other new run — otherwise the pick screen would be skippable and the
      // survivor choice would silently stop mattering.
      this.scene.start('MetaSelect');
    } else {
      this.scene.start('Menu'); // 返回标题
    }
  }

  // Opening the map hands the scene off entirely: GameScene is stopped, so the
  // survival clock stops with it, and coming back re-runs create() against the
  // same module-level GameState. Nothing about the run is reset on the way out.
  private openTowerOverview(): void {
    this.scene.start('TowerOverview');
  }

  private onToggleCrafting(): void {
    if (this.inventoryOpen || this.dialogueOpen || this.pauseOpen || this.shelterOpen) return;
    if (!this.craftingOpen && getGame().currentFloor !== STARTING_FLOOR) {
      this.flash('只能在宿舍工作台制作');
      return;
    }
    this.toggleCrafting();
  }

  private activateCraftEntry(): void {
    const state = getGame();
    const entry = this.craftEntries()[this.craftSelected];
    if (!entry) return;
    if (entry.kind === 'recipe') {
      const result = craft(state, entry.id!);
      if (result.ok) {
        saveToStorage(state);
        this.refreshCraft();
        this.refreshInventory();
        this.refreshUpgradeBoard();
        playSfx('craft');
        // The work happens at the bench, so the effect is at the bench. Crafting
        // was a sound and a line of text with nothing on screen; the burst is
        // anchored to the station the player is standing at, not to the player.
        playFx(this, 'collect-burst', CRAFT_X, PLAYER_FEET_Y - 40, LIGHT_DEPTH);
        this.flash(`建造了 ${getRecipe(entry.id!).displayName}（-${ACTION_COSTS.craft} 分钟）`);
        this.chargeTime(ACTION_COSTS.craft);
      } else {
        this.flash(result.reason);
      }
    } else {
      const result = purifyWater(state);
      if (result.ok) {
        saveToStorage(state);
        this.refreshCraft();
        this.refreshInventory();
        playSfx('craft');
        // Same bench, same beat: purifying water is work done at the station.
        playFx(this, 'collect-burst', CRAFT_X, PLAYER_FEET_Y - 40, LIGHT_DEPTH);
        // B3-05.2: this used to read 「净化了 1 瓶净水」 whatever the real count was,
        // while purifyWater() converts the whole carry and reports it in
        // `converted`. A player who purified six bottles was told they got one and
        // would plan the day's water around the wrong number.
        this.flash(`净化了 ${result.converted} 瓶净水（-${ACTION_COSTS.craft} 分钟）`);
        this.chargeTime(ACTION_COSTS.craft);
      } else {
        this.flash(result.reason);
      }
    }
  }

  // B3-03: charges an action its game-time cost, then applies the same
  // consequences the frame loop would — HUD refresh, autosave, and the end-of-run
  // transition. Keeping this in one place means a cost can never be charged
  // without the clock, the save and the death check following it.
  private chargeTime(gameMinutes: number): void {
    const state = getGame();
    const tick = spendTime(state, gameMinutes);
    this.refreshClock();
    this.refreshStats();
    this.applyNightLighting();
    saveToStorage(state);
    if (tick.died || tick.won || state.status !== 'playing') {
      saveToStorage(state);
      this.scene.start('End');
    }
  }

  // ── NPCs & dialogue ─────────────────────────────────────────────────────
  private drawNpcs(): void {
    // Every resident standing on this floor. The sprite comes from the data row:
    // it used to be a hard-coded `id === 'alin' ? 'npc_alin' : 'npc_xiaozhou'`
    // ternary, which silently drew every resident added after 小周 as 小周.
    for (const npc of npcsOnFloor(getGame().currentFloor)) {
      const who = npc.sprite;
      const sprite = this.add
        .sprite(npc.x, PLAYER_FEET_Y, walkSheetKey(who))
        .setOrigin(0.5, 1)
        // ACTOR_DEPTH, or the wall dressing and the haze paint over them.
        .setDepth(ACTOR_DEPTH);
      // NPCs stand still, so they breathe on the idle clip. Without an explicit
      // play() a sprite sits on frame 0 forever, which reads as a frozen mannequin
      // rather than someone waiting to talk to you.
      sprite.play(idleAnimKey(who));
      // Same contact shadow as the player, so an NPC stands on the floor rather
      // than hovering a few pixels above it.
      const shadow = addContactShadow(this, npc.x, PLAYER_FEET_Y + 2, 26, 2, 0.5);
      // The name plate needs two things the sprite does not: a depth above the
      // wall dressing and the dust haze, and a backing plate.
      //
      // Measured before this: the label was created with the default depth 0, so
      // it sat UNDER the wall art (1-3) and the haze (25) and read as a ghost —
      // technically visible, practically unreadable. Two residents made that easy
      // to miss; four standing shoulder to shoulder made it obvious. Same
      // treatment the trader's label already gets, and for the same reason.
      const nameLabel = this.add
        .text(npc.x, FLOOR_HEIGHT - 68, npc.name, {
          fontFamily: FONT_FAMILY,
          fontSize: '22px',
          color: hex(TEXT.primary),
          backgroundColor: '#0b0f12cc',
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0.5)
        .setDepth(ACTOR_DEPTH + 1);
      this.floorObjects.push(...shadow, sprite, nameLabel);
    }
  }

  private nearestNpc(state: GameState): NpcDef | null {
    // Residents only exist on their own floor now, so the old `floor === NPC_FLOOR`
    // guard became "is there anyone here at all".
    const residents = npcsOnFloor(state.currentFloor);
    for (const npc of residents) {
      if (Math.abs(npc.x - state.player.x) <= INTERACT_DISTANCE) return npc;
    }
    return null;
  }

  private buildDialoguePanel(): void {
    const { width, height } = this.viewSize();
    const panelW = this.panelWidthFor(460);
    // ── the panel is sized by the speech, not by a round number ───────────────
    //
    // Turning useAdvancedWrap on (bac96ae) fixed the horizontal overflow but
    // created a vertical one: `dialogueMessage` sat at `top + 45` with a
    // 0.5/0.5 origin, so a 4-line reply grew in both directions and its bottom
    // edge landed on the first option row. Measured in
    // e2e-audit/dialogue-fit-probe.spec.ts: 21px of text sitting on the first
    // option, and 33px hanging out of the speech well.
    //
    // The height is now derived from the longest line the product can produce.
    // It used to be derived here with a hard `MAX_LINES = 6` ceiling, which was
    // wrong on portrait: 265px panel → 221px wrap → 9 Han/line → 60 Han needs 7
    // lines, and the ceiling quietly cut it to 6, leaving the 7th line on top of
    // the options. The formula moved to ./dialogueLayout so it can be asserted
    // in node without a browser; see dialogueLayout.test.ts.
    //
    // RAW_MAX is imported rather than copied: a `// mirrors MAX_UTTERANCE`
    // comment is not a binding, and the two drifting apart is exactly what
    // would silently re-break this layout.
    const layout = computeDialogueLayout({
      panelWidth: panelW,
      bodyFontSize: TYPE.body,
      rawMax: MAX_UTTERANCE,
    });
    const wrapW = layout.wrapWidth;
    const WELL_TOP = layout.wellTop;
    const WELL_H = layout.wellHeight;
    const OPTIONS_TOP = layout.optionsTop;
    const OPTION_PITCH = layout.optionPitch;
    const panelH = layout.panelHeight;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;

    const depth = PANEL_DEPTH.game.dialogue;
    this.dialogueObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'green', depth));
    const dialogueShield = this.add
      .zone(cx, cy, width, height)
      .setInteractive()
      .setDepth(depth + 1)
      .setScrollFactor(0)
      .setVisible(false);
    dialogueShield.on('pointerdown', () => undefined);
    this.dialogueInputObjects.push(dialogueShield);
    // OVERHAUL UI: the same header strip every other panel uses, with the NPC's
    // name on it, and the message in an inset well so speech reads as speech
    // rather than as more body text.
    // Empty header title on purpose: the NPC's name is the header, and drawing a
    // static '对话' underneath it printed the two on top of each other.
    this.dialogueObjects.push(...buildPanelHeader(this, left, top, panelW, '', UI.good, depth + 5));
    // Create with placeholder content so each text's canvas/frame exists up front
    // (setText on a never-rendered empty text throws in Phaser 4).
    this.dialogueTitle = this.add
      .text(left + 10, top + 10, '对话', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.title}px`, color: hex(TEXT.primary) })
      .setOrigin(0, 0.5)
      .setDepth(depth + 6);
    this.dialogueSource = this.add
      .text(left + panelW - 14, top + 10, '基础对白', { fontFamily: FONT_FAMILY, fontSize: '14px', color: hex(PALETTE.clothHigh), align: 'right' })
      .setOrigin(1, 0.5)
      .setDepth(depth + 6);
    this.dialogueObjects.push(...buildPanelHeader(this, left, top, panelW, '', UI.good, depth + 5));

    // The speech well is as tall as the longest reply can get, and the message
    // is centred in that well (`setOrigin(0.5)` below — unchanged).
    //
    // To be precise about the mechanism, because a previous version of this
    // comment got it wrong: the anchor was NOT changed to top. The fix is
    // entirely in the well height. It used to be a fixed 34px while the speech
    // sat at `top + 45` with a centre anchor, so a 4-line reply (100px) grew
    // both ways and its bottom edge landed at top+95 while the first option row
    // started at top+74. Now the well is `messageLines * 25 + 8`, the text is
    // still centred in it, and 4 lines fit exactly. Measured: well y[234..342]
    // (h=108) with text y[238..338] — that is the centre-anchor position
    // (288 ± 50), not the top-anchor one (234..334).
    this.dialogueObjects.push(...buildPanelWell(this, left + 12, top + WELL_TOP, panelW - 24, WELL_H, depth + 5));
    // dialogueTitle MUST be in the list: closeDialogue() hides everything in it,
    // and a name left out of the list stays on screen after the panel closes.
    this.dialogueObjects.push(this.dialogueTitle, this.dialogueSource);
    this.dialogueMessage = this.add
      // useAdvancedWrap 不是排版偏好，是中文能不能折行的开关。
      //
      // Phaser 的 basicWordWrap 是 `text.split(' ')` 逐词累加：中文没有空格，
      // 整句被当成**一个词**，而「词比整行还宽」的分支（Text.js basicWordWrap
      // 里 `if (j > 0)`）在第一句时恰好不触发换行，于是它一个字都不折，直接
      // 横向溢出。全仓 14 处 wordWrap、0 处 useAdvancedWrap，所以这不是个案。
      //
      // 这一处尤其致命：正文是模型现场生成的句子，长度不可控。演示时 NPC 说
      // 第一句长台词就会冲出面板——前面所有 AI 工作会被这一眼毁掉。
      .text(cx, top + WELL_TOP + WELL_H / 2, '……', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: hex(TEXT.primary), align: 'center', wordWrap: { width: wrapW, useAdvancedWrap: true } })
      .setOrigin(0.5)
      .setDepth(depth + 7);
    this.dialogueObjects.push(this.dialogueMessage);

    this.dialogueBands = [];
    for (let i = 0; i < 4; i++) {
      const rowY = top + OPTIONS_TOP + i * OPTION_PITCH;
      // A selection band per row, the same language as every other list: a wash
      // plus a 2px accent rule. Toggled in refreshDialogue.
      const band = this.add.rectangle(left + 12, rowY, panelW - 24, 26, UI.accent).setOrigin(0, 0).setAlpha(0).setDepth(depth + 5);
      const rule = this.add.rectangle(left + 12, rowY, 2, 26, UI.accent).setOrigin(0, 0).setAlpha(0).setDepth(depth + 6);
      this.dialogueBands.push({ band, rule });
      this.dialogueObjects.push(band, rule);
      const icon = this.add.image(left + 30, rowY + 12, 'blank').setOrigin(0.5).setDepth(depth + 7);
      const t = this.add
        .text(left + 46, rowY + 12, '……', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: hex(TEXT.primary) })
        .setOrigin(0, 0.5)
        .setDepth(depth + 7);
      this.dialogueOptionIcons.push(icon);
      this.dialogueOptions.push(t);
      this.dialogueObjects.push(icon, t);
      const optionHitArea = this.add
        .zone(cx, rowY + 13, panelW - 24, 26)
        .setInteractive({ useHandCursor: true })
        .setDepth(depth + 8)
        .setScrollFactor(0)
        .setVisible(false);
      const selectOption = (): void => {
        if (!this.dialogueOpen || !this.dialogue) return;
        if (!this.dialogueOptionsView()[i]) return;
        this.dialogue.selected = i;
        this.refreshDialogue();
      };
      optionHitArea.on('pointerover', selectOption);
      optionHitArea.on('pointerdown', () => {
        selectOption();
        if (this.dialogueOpen && this.dialogue?.selected === i) this.activateDialogueOption();
      });
      this.dialogueInputObjects.push(optionHitArea);
    }
    const footer = this.add
      .text(cx, top + panelH - 12, '点击选项执行 · ↑/↓选择 · Enter确定 · 点此/ESC返回', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(PALETTE.clothHigh) })
      .setOrigin(0.5)
      .setDepth(depth + 7);
    this.dialogueObjects.push(footer, this.dialogueMarker);
    const footerHitArea = this.add
      .zone(cx, top + panelH - 12, panelW - 24, 24)
      .setInteractive({ useHandCursor: true })
      .setDepth(depth + 8)
      .setScrollFactor(0)
      .setVisible(false);
    footerHitArea.on('pointerdown', () => {
      if (this.dialogueOpen) this.dialogueBack();
    });
    this.dialogueInputObjects.push(footerHitArea);

    applyPanelDepth(this.dialogueObjects, PANEL_DEPTH.game.dialogue);
    this.assertPanelContent('dialogue', this.dialogueObjects);
    for (const o of this.dialogueObjects) o.setVisible(false);
    this.dialogueInputObjects.forEach((o) => o.setVisible(false));
  }

  /** A small DOM companion keeps the trace readable on narrow, scrolling viewports. */
  private buildJudgeModePanel(): void {
    const mobile = window.matchMedia('(max-width: 600px)').matches;
    this.judgeExpanded = false;
    const panel = document.createElement('section');
    panel.dataset.testid = 'judge-mode-panel';
    Object.assign(panel.style, {
      position: 'fixed', right: '10px', top: mobile ? 'auto' : '10px', bottom: mobile ? '58px' : 'auto',
      zIndex: '10000', width: 'min(360px, calc(100vw - 20px))', color: '#f5f1df',
      background: 'rgba(18, 29, 34, 0.97)', border: '2px solid #80c7a1', borderRadius: '8px',
      boxShadow: '0 4px 18px rgba(0,0,0,.45)', font: '14px/1.45 system-ui, sans-serif', pointerEvents: 'auto',
    });
    const header = document.createElement('div');
    Object.assign(header.style, { display: 'flex', gap: '6px', padding: '6px', alignItems: 'stretch' });
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.dataset.testid = 'judge-mode-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    Object.assign(toggle.style, {
      flex: '1', minWidth: '0', textAlign: 'left', border: '0', borderRadius: '5px', padding: '8px',
      color: '#f5f1df', background: '#294a42', font: '600 13px/1.35 system-ui, sans-serif', cursor: 'pointer',
    });
    const download = document.createElement('button');
    download.type = 'button';
    download.dataset.testid = 'judge-export';
    download.textContent = '下载 JSON';
    download.disabled = true;
    Object.assign(download.style, {
      border: '1px solid #8fa99d', borderRadius: '5px', padding: '6px 9px', color: '#f5f1df',
      background: '#263b3b', font: '13px system-ui, sans-serif', cursor: 'pointer', whiteSpace: 'nowrap',
    });
    const content = document.createElement('pre');
    content.dataset.testid = 'judge-trace';
    Object.assign(content.style, {
      display: 'none', margin: '0 6px 6px', padding: '10px', maxHeight: mobile ? '38vh' : '48vh',
      overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: '#10191c',
      borderRadius: '5px', font: '12px/1.5 ui-monospace, SFMono-Regular, monospace',
    });
    const updateToggle = (): void => {
      this.judgeToggle = toggle;
      this.updateJudgeToggle();
      content.style.display = this.judgeExpanded ? 'block' : 'none';
    };
    toggle.addEventListener('click', () => {
      this.judgeExpanded = !this.judgeExpanded;
      updateToggle();
      toggle.blur();
    });
    download.addEventListener('click', () => {
      this.downloadJudgeRun();
      download.blur();
    });
    header.append(toggle, download);
    panel.append(header, content);
    document.body.append(panel);
    this.judgePanel = panel;
    this.judgePanelContent = content;
    this.judgeExportButton = download;
    updateToggle();
    this.refreshJudgeModePanel();
  }

  /**
   * 自主 tick 的可观测证据（AI-06）。
   *
   * 评审要能一眼看到两件事：这次行为是**世界**触发的（actor=world_tick、
   * trigger 是什么世界事件），以及决策到底是谁做的（decisionSource）。
   * 没发生过就明说「尚未发生」，不留空让人误以为有。
   */
  private judgeAutonomyEvidence(): Record<string, unknown> {
    const result = this.lastNpcAutonomyResult;
    if (!result) {
      return {
        actor: NPC_AUTONOMY_ACTOR,
        status: '尚未发生世界触发的自主行为',
        trigger: null,
        decisionSource: null,
        modelCalls: 0,
        outcomes: [],
      };
    }
    return {
      actor: result.actor,
      status: result.status,
      trigger: result.trigger,
      stage: result.stage,
      decisionSource: result.decisionSource,
      modelCalls: result.modelCalls,
      worldRevision: { before: result.revisionBefore, after: result.revisionAfter },
      outcomes: result.outcomes.map((outcome) => ({
        npc: getNpc(outcome.npcId).name,
        npcId: outcome.npcId,
        actor: outcome.actor,
        action: outcome.action,
        status: outcome.status,
        decisionSource: outcome.decisionSource,
        reason: outcome.reason,
        utterance: outcome.utterance,
        worldRevision: outcome.worldRevision,
        actualStateDelta: outcome.stateDelta,
        npcInventoryBefore: outcome.npcInventoryBefore,
        npcInventoryAfter: outcome.npcInventoryAfter,
        playerInventoryBefore: outcome.playerInventoryBefore,
        playerInventoryAfter: outcome.playerInventoryAfter,
      })),
    };
  }

  /**
   * Judge Mode 标题：来源与焦点 NPC 必须取自**真实发生过的结果**。
   *
   * 这里原来写死了 `offline-fallback` 和「阿林」——那是面板一次都没跑过时
   * 就会显示的字。模型真的提案并提交成功之后，标题仍写着 offline-fallback，
   * 就是一个**假的来源标签**；玩家跟小周或阿珍交互之后仍写着「阿林」，
   * 就是**假的 NPC 名字**。评审专门盯这两条：初始应显示「等待中」，
   * 跑过什么就显示什么。
   *
   * 与面板内容（refreshJudgeModePanel）用的是同一套判定，两处不会打架。
   */
  private updateJudgeToggle(): void {
    const toggle = this.judgeToggle;
    if (!toggle) return;
    const latest = this.judgeLatestResult;
    // 没发生过任何 scenario → 不写来源，只写「等待中」。
    const source = latest
      ? ('decisionSource' in latest ? latest.decisionSource : 'offline-fallback')
      : '等待中';
    const focus = latest
      ? ('focusNpcId' in latest ? getNpc(latest.focusNpcId).name : getNpc('alin').name)
      : '';
    const autonomy = this.lastNpcAutonomyResult;
    // 自主 tick 的来源也挂在标题上：评审一眼就能看到「世界自己触发过」。
    const autonomyTag = autonomy && autonomy.status === 'executed'
      ? ` · 自主tick:${autonomy.decisionSource}`
      : '';
    toggle.textContent = `Judge Mode · ${source}${autonomyTag} · seed ${getGame().runSeed}`
      + (focus ? ` · ${focus}` : '')
      + (this.judgeExpanded ? ' ▾' : ' ▸');
    toggle.setAttribute('aria-expanded', String(this.judgeExpanded));
  }

  private refreshJudgeModePanel(): void {
    if (!this.judgePanelContent) return;
    // 标题与内容必须说同一件事：来源、焦点 NPC 都取自真实结果。
    this.updateJudgeToggle();
    const result = this.judgeLatestResult;
    if (!result) {
      this.judgePanelContent.textContent = JSON.stringify({
        // 还没跑过任何 scenario：这里**不能**写一个来源或一个 NPC 名字。
        // 写死 'offline-fallback' / '阿林' 就是一条假证据——模型真的跑过之后
        // 面板里还写着它们，评审一眼看到的就是编的。
        mode: '等待中', seed: getGame().runSeed, npc: null, target: null,
        status: '等待真实 scenario result',
        instructions: '与阿林交互：赠礼会运行赠礼 scenario；维修门计划会运行只读校验。未出现 scenario 结果前，没有状态提交。',
        autonomy: this.judgeAutonomyEvidence(),
      }, null, 2);
      if (this.judgeExportButton) this.judgeExportButton.disabled = true;
      return;
    }
    const feedback = result.feedback.map((event) => ({
      attempt: event.attempt,
      event: event.outcome,
      validation: event.validation ? {
        accepted: event.validation.accepted,
        reason: event.validation.reason,
        detailCode: event.validation.accepted ? undefined : event.validation.detailCode,
      } : null,
      execution: event.execution?.status ?? 'not-executed',
    }));
    const repair = 'decisionSource' in result;
    // 赠礼既可能来自阿林（单 NPC 场景），也可能来自小周（多 NPC 场景）。
    // 面板必须报真实焦点，不能把两个人的记录都标成阿林。
    const focusNpcId = 'focusNpcId' in result ? result.focusNpcId : 'alin';
    const focusName = getNpc(focusNpcId).name;
    const actualStateDelta = result.execution?.status === 'completed' ? result.execution.actualStateDelta : null;
    const replan = result.feedback.some((event) => event.outcome === 'executed' &&
      result.feedback.some((prior) => prior.attempt < event.attempt &&
        (prior.outcome === 'validation_rejected' || prior.outcome === 'execution_failed') &&
        prior.proposal !== undefined && JSON.stringify(prior.proposal) !== JSON.stringify(event.proposal)));
    const focusSnapshot = result.after.npcs.find((npc) => npc.npcId === focusNpcId);
    const evidence = {
      mode: repair ? result.decisionSource : 'offline-fallback',
      seed: result.before.seed,
      npc: focusName,
      target: focusSnapshot?.goal ?? null,
      status: result.status,
      attempts: result.attempts,
      observation: result.observation,
      proposal: result.proposal,
      validator: result.validation ? {
        decision: result.validation.accepted ? 'accepted' : 'rejected',
        reason: result.validation.reason,
        detailCode: result.validation.accepted ? undefined : result.validation.detailCode,
      } : { decision: 'no validation result', reason: null, detailCode: null },
      actualState: actualStateDelta === null
        ? '未提交：没有已完成的 execution / actual state delta'
        : { committed: true, delta: actualStateDelta, after: result.after },
      memoryAndEventFeedback: {
        before: result.before.npcs.find((npc) => npc.npcId === focusNpcId)?.memory ?? [],
        after: focusSnapshot?.memory ?? [],
        events: feedback,
      },
      replan,
      replanEvidence: replan ? '失败反馈后执行了不同的替代动作' : '没有失败反馈后执行不同的替代动作',
      attemptSequence: feedback.map((event) => event.attempt),
      reason: result.reason,
      stateHashes: { before: result.beforeHash, after: result.afterHash },
      autonomy: this.judgeAutonomyEvidence(),
    };
    this.judgePanelContent.textContent = JSON.stringify(evidence, null, 2);
    if (this.judgeExportButton) this.judgeExportButton.disabled = false;
  }

  private downloadJudgeRun(): void {
    const result = this.judgeLatestResult;
    if (!result) return;
    // Export only the scenario's redacted, allow-listed projection, never GameState.
    const isRepair = 'decisionSource' in result;
    const isSocial = 'focusNpcId' in result;
    const serialized = isRepair
      ? serializeAlinRepairRun(result)
      : isSocial ? serializeSocialGiftRun(result) : serializeAlinGiftRun(result);
    const safeRun = JSON.parse(serialized) as {
      world?: { stateBefore?: unknown; stateAfter?: unknown };
      hashes?: unknown;
      actualStateDelta?: unknown;
      [key: string]: unknown;
    };
    const json = JSON.stringify({
      ...safeRun,
      // Derived exclusively from the exporter's redacted/allow-listed output.
      evidence: {
        stateBefore: safeRun.world?.stateBefore ?? null,
        stateAfter: safeRun.world?.stateAfter ?? null,
        hashes: safeRun.hashes ?? null,
        actualStateDelta: safeRun.actualStateDelta ?? null,
      },
    });
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const name = isRepair ? 'alin-repair' : isSocial ? `social-${result.focusNpcId}-gift` : 'alin-gift';
    anchor.download = `${name}-seed-${result.before.seed}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Label + icon key per dialogue option. The icon is the item the player
  // RECEIVES (the trade's output), matching how the crafting list shows outputs;
  // 问候/询问/退出/返回 are not items and get no icon.
  //
  // 阿林有维修门需求，所以修门材料要从赠礼列表里留出来（否则玩家会把自己
  // 刚攒好的材料送出去、门再也修不成）。小周没有配方需求，全部可赠。
  private giftableStacks(npcId: NpcId) {
    const game = getGame();
    const slots = game.player.inventory.slots;
    const giftable = slots.filter((stack) => stack.meta === undefined);
    if (npcId !== 'alin') return giftable;
    if (isAlinRepairGateOpen(game)) return giftable;

    const required = new Map(ALIN_REPAIR_MATERIALS.map((stack) => [stack.itemId, stack.quantity]));
    const owned = new Map<string, number>();
    for (const stack of slots) owned.set(stack.itemId, (owned.get(stack.itemId) ?? 0) + stack.quantity);
    return giftable.filter((stack) => {
      const reserve = required.get(stack.itemId);
      if (reserve === undefined) return true;
      const total = owned.get(stack.itemId) ?? 0;
      return total > Math.min(total, reserve);
    });
  }

  private dialogueOptionsView(): Array<{ label: string; icon?: ItemId }> {
    const d = this.dialogue;
    if (!d) return [];
    if (d.level === 'main') {
      // 位置 1/2/3 被 E2E 依赖（询问=1、交易=2），所以只把位置 0 换掉：
      // 阿林是「赠礼」，小周从「问候」改成「赠礼」，「询问/交易/退出」不动。
      //
      // 首章：危机进行中时，阿林位置 1 的实际行为换成「接回主线」，标签也
      // 必须跟着换——否则玩家看到「维修门计划」却被送进主线剧情，读不懂。
      // 位置不变（仍是索引 1），E2E 对位置的依赖不受影响。
      const alinLabel = blackoutAlinOptionLabel(getGame());
      const labels = d.npc === 'alin'
        ? ['赠礼', alinLabel, '交易', '退出']
        : ['赠礼', '询问', '交易', '退出'];
      return labels.map((label) => ({ label }));
    }
    if (d.level === 'gift') {
      const stacks = this.giftableStacks(d.npc);
      if (stacks.length === 0) return [{ label: '背包没有可赠送物品' }, { label: '返回' }];
      const start = this.dialogueGiftPage * 3;
      const visible = stacks.slice(start, start + 3);
      const options: Array<{ label: string; icon?: ItemId }> = visible.map((stack) => ({
        label: `赠送 ${getItem(stack.itemId).displayName}×1（持有${stack.quantity}）`,
        icon: stack.itemId,
      }));
      options.push({ label: start + 3 < stacks.length ? '下一页' : '返回' });
      return options;
    }
    const npc = getNpc(d.npc);
    return [
      ...npc.offers.map((o) => ({
        label: `用 ${getItem(o.get.itemId).displayName}×${o.get.quantity} 换 ${getItem(o.give.itemId).displayName}×${o.give.quantity}`,
        icon: o.give.itemId,
      })),
      { label: '返回' },
    ];
  }

  // ── NPC AI ──────────────────────────────────────────────────────────────
  // AI only proposes an opening line and records successful trades as memory;
  // dialogue options, trades and all survival rules remain owned by the game.

  private getAiRuntime(npc: NpcDef): NpcRuntimeConfig | null {
    const cfg = aiNpcConfig();
    if (!cfg.enabled) return null;
    let runtime = this.aiRuntimes.get(npc.id);
    if (!runtime) {
      // 三种模式：proxy（公开部署，同域后端持 Key）、ollama（直连本机/Spark）、
      // offline（确定性规则人格）。proxy 与 ollama 只差传输层，裁决层不变。
      const useModel = cfg.mode === 'ollama' || cfg.mode === 'proxy';
      runtime = {
        brain: useModel
          ? new OllamaBrain({
              baseUrl: cfg.baseUrl,
              model: cfg.model,
              timeoutMs: cfg.timeoutMs,
              maxOutputTokens: cfg.maxOutputTokens,
              disableThinking: cfg.disableThinking,
              proxyMode: cfg.proxyMode,
              sessionId: cfg.sessionId,
            })
          : new LocalPersonaBrain(),
        // 降级脑给该 NPC 自己的第一句问候——Spark 不可达时玩家看到的就是
        // 改造前那一句，这是护栏 2 的场景侧落地。
        fallback: new OptionTreeBrain(npc.greetings[0]),
        timeoutMs: cfg.timeoutMs,
        memoryRecallK: cfg.recallK,
        // 第一阶段只接通 dialogue 的执行路径：模型提议交易/赠送等其他行动
        // 一律被运行时拒绝并降级，不会出现「说了但没做」或「没说要了」的错位。
        allowedActions: ['dialogue'],
      };
      this.aiRuntimes.set(npc.id, runtime);
    }
    return runtime;
  }

  private npcStateFor(npc: NpcDef): NpcPersistedState {
    // Individual profile first: two residents sharing an archetype must not share
    // a personality, or every neutral neighbour speaks in the same voice.
    return loadNpcState(getGame(), npc.id) ?? createNpcStateFor(npc.id);
  }

  /** 当前对话的保鲜键；没有打开的对话时为 null。 */
  private currentDialogueSession(): DialogueSession | null {
    if (!this.dialogueOpen || !this.dialogue) return null;
    return { sessionId: this.dialogue.sessionId, revision: this.dialogue.revision };
  }

  /** 异步取一句人格化开场白。取到前画面显示原句，与改造前无差异。 */
  private async enhanceOpeningLine(npc: NpcDef): Promise<void> {
    const runtime = this.getAiRuntime(npc);
    if (!runtime) return;
    // 请求发出前记住这场对话的保鲜键；45s 后返回时用它判断结果是否过期
    const captured = this.currentDialogueSession();
    if (!captured) return;
    try {
      const decision = await decideNpcAction(getGame(), npcFactFromDef(npc), this.npcStateFor(npc), runtime);
      if (!decision.validated.ok) return;
      const { action, utterance } = decision.validated;
      // 第一阶段只落地对话文本；其他行动类型在第一阶段就被 availableActions 挡掉
      const line = utterance ?? (action.type === 'dialogue' ? action.text : '');
      // 保鲜检查：玩家可能已关闭对话、重开、或翻过选项——过期结果一律丢弃，
      // 不能覆盖玩家眼前的这场新对话（P1-2）。
      if (line && isDialogueFresh(this.currentDialogueSession(), captured)) {
        this.dialogue!.message = line;
        this.dialogue!.messageSource = decision.source !== 'brain'
          ? 'fallback'
          : runtime.brain.id === 'local-persona' ? 'offline-ai' : 'ollama';
        this.dialogue!.revision += 1; // AI 换行本身也是一次修订，防止两次返回互相覆盖
        this.refreshDialogue();
      }
    } catch {
      // AI 层任何意外都不能把对话搞坏：保持原句即为正确行为
    }
  }

  /** 交易成功后记一条记忆，积累关系历史。AI 关闭时整个方法不执行。 */
  private recordNpcTrade(npc: NpcDef, summary: string): void {
    if (!aiNpcConfig().enabled) return;
    const game = getGame();
    const next = recordMemory(this.npcStateFor(npc), {
      day: game.day,
      minute: game.gameMinuteOfDay,
      kind: 'trade',
      actor: 'player',
      summary,
    });
    saveNpcState(game, npc.id, next);
    // 记忆写进 npcStates 之后必须再存一次盘：chargeTime 的保存发生在这之前，
    // 否则交易成功即刻刷新页面会丢掉这条记忆（P1-4）。
    saveToStorage(game);
  }

  private openDialogue(npc: NpcDef): void {
    this.dialogueSessionSeq += 1;
    this.dialogueGiftPage = 0;
    this.dialogue = {
      npc: npc.id,
      level: 'main',
      selected: 0,
      message: npc.greetings[0],
      messageSource: 'script',
      lineToggle: 0,
      sessionId: this.dialogueSessionSeq,
      revision: 0,
    };
    this.dialogueOpen = true;
    for (const o of this.dialogueObjects) o.setVisible(true);
    this.dialogueInputObjects.forEach((o) => o.setVisible(true));
    this.refreshDialogue();
    void this.enhanceOpeningLine(npc);
  }

  private closeDialogue(): void {
    this.dialogueOpen = false;
    this.dialogue = null;
    for (const o of this.dialogueObjects) o.setVisible(false);
    this.dialogueInputObjects.forEach((o) => o.setVisible(false));
  }

  private dialogueBack(): void {
    if (!this.dialogue) return;
    this.dialogue.revision += 1; // 玩家操作使在途 AI 结果过期
    if (this.dialogue.level === 'trade' || this.dialogue.level === 'gift') {
      this.dialogue.level = 'main';
      this.dialogueGiftPage = 0;
      this.dialogue.selected = 0;
      this.dialogue.message = '';
      this.dialogue.messageSource = 'script';
      this.refreshDialogue();
    } else {
      this.closeDialogue();
    }
  }

  private refreshDialogue(): void {
    const d = this.dialogue;
    if (!d) return;
    const npc = getNpc(d.npc);
    this.dialogueTitle.setText(`${npc.name}（${npc.title}）`);
    this.dialogueSource.setText({
      script: '基础对白',
      'offline-ai': '本地行为 AI · 规则驱动',
      ollama: 'Ollama 本地模型',
      fallback: '模型未响应 · 基础对白',
      'competition-offline': 'offline-fallback · 场景规则提案',
    }[d.messageSource]);
    this.dialogueMessage.setText(d.message || '……');
    const options = this.dialogueOptionsView();
    if (d.selected >= options.length) d.selected = options.length - 1;
    for (let i = 0; i < this.dialogueOptions.length; i++) {
      const option = options[i];
      const icon = this.dialogueOptionIcons[i];
      if (option === undefined) {
        this.dialogueOptions[i].setText('');
        icon.setVisible(false);
        continue;
      }
      this.dialogueOptions[i].setText(option.label);
      if (option.icon) icon.setTexture(itemIconKey(option.icon)).setVisible(true);
      else icon.setVisible(false);
      const selected = i === d.selected;
      this.dialogueOptions[i].setColor(selected ? hex(PALETTE.lightHigh) : hex(TEXT.primary));
      const b = this.dialogueBands[i];
      if (b) {
        b.band.setAlpha(selected ? 0.14 : 0);
        b.rule.setAlpha(selected ? 1 : 0);
      }
    }
    const selectedIcon = this.dialogueOptionIcons[d.selected];
    this.dialogueMarker.setVisible(options[d.selected] !== undefined);
    if (options[d.selected] && selectedIcon) placeMarkerLeftOf(this.dialogueMarker, selectedIcon);
  }

  private activateDialogueOption(): void {
    const d = this.dialogue;
    if (!d) return;
    // Ignore repeated confirms without invalidating the in-flight gift result.
    if (d.level === 'gift' && this.dialogueGiftPending) return;
    d.revision += 1; // 玩家操作使在途 AI 结果过期
    d.messageSource = 'script';
    const npc = getNpc(d.npc);
    if (d.level === 'gift') {
      const stacks = this.giftableStacks(d.npc);
      if (stacks.length === 0) {
        if (d.selected === 1) {
          d.level = 'main';
          this.dialogueGiftPage = 0;
          d.selected = 0;
          d.message = '';
        }
        this.refreshDialogue();
        return;
      }
      const start = this.dialogueGiftPage * 3;
      const visibleCount = Math.min(3, Math.max(0, stacks.length - start));
      if (d.selected < visibleCount) {
        const stack = stacks[start + d.selected];
        if (stack) {
          void this.runGiftPlan(npc, { sessionId: d.sessionId, revision: d.revision }, stack.itemId);
          return;
        }
      } else if (d.selected === visibleCount) {
        if (start + 3 < stacks.length) {
          this.dialogueGiftPage += 1;
          d.selected = 0;
          d.message = `选择一件赠送给${npc.name}的物品`;
        } else {
          d.level = 'main';
          this.dialogueGiftPage = 0;
          d.selected = 0;
          d.message = '';
        }
      }
      this.refreshDialogue();
      return;
    }
    if (d.level === 'main') {
      switch (d.selected) {
        case 0:
          d.level = 'gift';
          this.dialogueGiftPage = 0;
          d.selected = 0;
          d.message = `选择一件赠送给${npc.name}的物品`;
          break;
        case 1:
          if (npc.id === 'alin') {
            // 首章：危机已经启动（且未了结）时，阿林说的是「接回主线」，
            // 走停电危机场景；否则保持原来的通用维修门计划。
            // 两条路都以 executeCompetitionProposal 为唯一提交入口。
            // 判定与分发都在 blackoutCrisis 里（纯函数，单测直接断言调了哪个）。
            const session = { sessionId: d.sessionId, revision: d.revision };
            dispatchBlackoutAlin(getGame(), {
              blackout: () => { void this.runBlackoutRepairPlan(npc, session); },
              legacy: () => { void this.runAlinRepairPlan(npc, session); },
            });
            return;
          }
          d.message = npc.asks[d.lineToggle % npc.asks.length];
          d.lineToggle++;
          break;
        case 2:
          d.level = 'trade';
          d.selected = 0;
          d.message = '想换点什么？';
          break;
        default:
          this.closeDialogue();
          return;
      }
    } else if (d.selected < npc.offers.length) {
      // 首章：危机期间小周/阿珍的交易走「模型选价 → 规则结算」。
      // 危机之外仍是下面这条通用交易，玩家体验不变。
      //
      // 为什么选中的那一项不再作为参数传下去：危机里这两位的价目表由场景数据
      // 统一持有（小周要按库存报，阿珍要按她的存货封顶回礼），玩家点哪一项
      // 只表示「我要谈」，真正成交哪一笔由模型挑、由规则复核。硬把 UI 那一项
      // 透下去，会在价目表与场景数据不一致时造成「界面说换 A、实际换 B」。
      const session = { sessionId: d.sessionId, revision: d.revision };
      const tradeRoute = dispatchBlackoutTrade(getGame(), npc.id, {
        blackout: () => { void this.runBlackoutTrade(npc, session); },
        legacy: () => { /* 下面走原来的通用交易 */ },
      });
      if (tradeRoute === 'blackout') return;
      const offer = npc.offers[d.selected];
      const result = trade(getGame(), offer);
      d.message = result.ok
        ? `换到了 ${getItem(offer.give.itemId).displayName}×${offer.give.quantity}`
        : result.reason;
      if (result.ok) {
        saveToStorage(getGame());
        this.refreshInventory();
        playSfx('trade');
        d.message = `换到了 ${getItem(offer.give.itemId).displayName}×${offer.give.quantity}（-${ACTION_COSTS.trade} 分钟）`;
        this.chargeTime(ACTION_COSTS.trade);
        this.recordNpcTrade(npc, `换到${getItem(offer.give.itemId).displayName}×${offer.give.quantity}`);
      }
    } else {
      d.level = 'main';
      d.selected = 0;
      d.message = '';
    }
    this.refreshDialogue();
  }

  private async runGiftPlan(npc: NpcDef, captured: DialogueSession, itemId: ItemId): Promise<void> {
    const current = this.dialogue;
    if (!current || current.npc !== npc.id || this.dialogueGiftPending) return;
    this.dialogueGiftPending = true;
    current.messageSource = 'competition-offline';
    current.message = '赠礼提案 → 规则校验 → 状态提交…';
    this.refreshDialogue();
    try {
      // 阿林走既有的单 NPC 场景（保留其修门材料与门禁语义）；小周走多 NPC
      // 场景，两者共用同一条「提案 → 校验 → 执行 → 落盘」链路。
      const result = npc.id === 'alin'
        ? await runAlinGiftScenario(getGame(), itemId, 1)
        : await runSocialGiftScenario(getGame(), npc.id, itemId, 1);
      if (npc.id === 'alin') this.lastAlinGiftResult = result;
      this.lastGiftResult = result;
      this.judgeLatestResult = result;
      this.refreshJudgeModePanel();
      // Persist the committed state even if the player closed the dialogue while
      // the deterministic action was resolving; freshness only guards the UI.
      saveToStorage(getGame());
      this.refreshInventory();
      if (!isDialogueFresh(this.currentDialogueSession(), captured)) return;
      const trust = result.after.npcs.find((entry) => entry.npcId === npc.id)?.trust ?? 35;
      current.message = result.status === 'executed'
        ? `赠送${getItem(itemId).displayName}×1成功｜信任${trust}`
        : result.reason;
      current.revision += 1;
      this.refreshDialogue();
    } catch {
      if (!isDialogueFresh(this.currentDialogueSession(), captured)) return;
      current.message = 'offline-fallback｜赠礼未执行｜游戏状态未改变';
      current.revision += 1;
      this.refreshDialogue();
    } finally {
      this.dialogueGiftPending = false;
    }
  }

  /** Run the A6 observe/plan/validate/executor loop without inventing costs. */
  /**
   * 把模型接进维修决策的那个端口。
   *
   * 返回 undefined 表示「不接管」——配置关闭或模型不可用时，场景走它原本的
   * 离线路径，玩家体验与改造前完全一致。返回一个函数才表示由模型决定修不修。
   *
   * 三条硬边界，缺一条这次改造就只是换了个说法：
   *
   * 1. **模型不能自己决定维修成功**。它产出的只是一个 proposal，材料清单来自
   *    服务端配方（`input.materials`），validator 仍会独立核对身份与数量。
   * 2. **模型说「不修」必须真的不修**。返回 null 就是拒绝，场景侧不许用 fallback
   *    把它补回来——否则模型说完「材料不足我不能修」，门却开了。
   * 3. **模型挂了不能卡住玩家**。请求失败时返回 null 并抛给上层的降级路径处理，
   *    但这条路径的产出会在 decisionSource 里被标成 offline-fallback，不冒充模型。
   */
  private buildRepairProposalPort(npc: NpcDef): AlinRepairModelPort | undefined {
    const runtime = this.getAiRuntime(npc);
    if (!runtime) return undefined;
    const cfg = aiNpcConfig();
    if (cfg.mode !== 'ollama' && cfg.mode !== 'proxy') return undefined;
    // 大脑没实现任务型推理（本地规则脑、回放脑）就不接管，退回离线路径。
    const brain = runtime.brain;
    if (typeof brain.decideTask !== 'function') return undefined;

    return async (input) => {
      const profile = NPC_PROFILES[npc.id];
      const trust = input.observation.world.npcs[0]?.trust ?? 35;
      const rejection = input.previousFeedback?.validation;
      const previousRejectedReason = rejection && !rejection.accepted
        ? (rejection.reason === 'missing_item' ? '材料不足'
          : rejection.reason === 'low_trust' ? '信任不足'
            : (rejection.detailCode ?? rejection.reason))
        : undefined;

      const result = await brain.decideTask!({
        task: 'repair',
        repair: {
          gateId: input.gateId,
          npcName: npc.name,
          traits: { ...(profile?.traits ?? { altruism: 0.5, pragmatism: 0.5, aggression: 0.1, loyalty: 0.5, caution: 0.5 }) },
          trust,
          trustThreshold: COMPETITION_TRUST_THRESHOLDS.repairGate,
          materials: input.materials.map((stack) => ({ itemId: stack.itemId, quantity: stack.quantity })),
          playerHas: input.observation.world.player.inventory.map((stack: { itemId: string; quantity: number }) => ({ itemId: stack.itemId, quantity: stack.quantity })),
          ...(previousRejectedReason ? { previousRejectedReason } : {}),
        },
      });

      // 模型没答上来（超时/不可达/降级）：返回 null，让场景的 fallback 接管。
      // 注意这跟「模型说不动」是两回事——这条路径的产出会被标成 offline-fallback。
      if (!result || result.source !== 'model') return null;

      const decision = parseRepairIntent(result.text);
      if (!decision) return null;

      // 只有明确说「现在修」才提案。refuse / observe / request_help 一律不动世界。
      // request_help 将来要接成「向玩家发起委托」，那是另一件事，不能在维修
      // 场景里偷懒当成维修执行掉。
      if (decision.intent !== 'repair_gate') {
        this.lastRepairIntentNote = decision;
        return null;
      }
      this.lastRepairIntentNote = decision;
      // 模型说的目标要真的用上。
      //
      // 这里原先写死 `gateId: input.gateId`，`decision.target` 被丢掉。当前
      // 场景只有一个可修目标，所以看不出问题；但首章的停电危机修的是塔楼
      // 主线（`tower-main-power`），借的正是 repair_gate 的语义。只要一个
      // 场景里出现第二个可修目标，丢 target 就等于「模型说修 A、系统修 B」，
      // 而且不报错。模型的 target 缺省时才回落到场景给的那个。
      return {
        kind: 'repair_gate',
        gateId: decision.target ?? input.gateId,
        // 材料永远照服务端配方申请，不采信模型报的数。
        materials: input.materials.map((stack) => ({ ...stack })),
      };
    };
  }

  // ── 停电危机（首章）──────────────────────────────────────────────────────

  /**
   * 每帧被问一次「危机要不要推进」。
   *
   * 只在「阶段 / 天数 / 维修门是否已开」三者任一变化时真正调用
   * `syncBlackoutCrisis`——它内部虽然幂等，但每帧跑会反复铺库存判定、
   * 反复 flash 同一句台词。缓存键里带上 `day` 是因为「断电持续到第几天」
   * 会改变判定，跨天必须重新问一次。
   *
   * 键里还必须有门开状态，这一项不是优化而是正确性：
   * 开局第 1 天第一次 tick 时门是关的，键被写成 `initial:1:false`，同时
   * flash 「维修门还关着」；玩家随后真把门修开，`stage` 仍是 `initial`、
   * `day` 仍是 1，如果键里不含门开状态，键不变 → 直接 return，当天再也
   * 不会重新判定，危机要拖到跨天才启动。玩家看到的是「我修好了门，却什么
   * 都没发生」——首章的第一个正反馈直接断掉。
   *
   * 刻意不占用 `state.worldEvents.activeEvent` 那个单事件槽位：危机是贯穿
   * 首章的**独立剧情线**，不是今夜随机事件。抢槽位会让夜晚事件与危机互相
   * 把对方顶掉（`updateDwellPressure` 里有 `if (activeEvent) return`）。
   */
  private syncBlackoutOnTick(state: GameState): void {
    const key = `${blackoutStageOf(state)}:${state.day}:${isAlinRepairGateOpen(state)}`;
    if (key === this.blackoutSyncedKey) return;
    this.blackoutSyncedKey = key;
    const transition = syncBlackoutCrisis(state);
    if (transition.ok && transition.message) this.flash(transition.message);
  }

  /**
   * NPC 自主 tick：世界事件驱动的居民自主行为（AI-06）。
   *
   * 与玩家按 E 的那条路是**两回事**：这里没有任何玩家输入，触发源只有世界
   * 事件——停电危机的阶段变化，或游戏跨过整点。
   *
   * 三道闸，缺一不可：
   * 1. 触发检测（`detectNpcAutonomyTrigger`）：阶段变了或跨整点才算事件；
   * 2. 节流（`npcAutonomyThrottled`）：上一轮刚跑过就跳过。这一道决定模型
   *    调用频率的上限是「每游戏小时一次」，而不是每帧一次；
   * 3. 重入锁：模型还在回话时不再发起第二轮。
   *
   * 「同一 NPC 同一阶段最多一次」不在这里管——它落在存档里的 flag 上
   * （`NPC_AUTONOMY_FLAG.handled`），所以重载、换场景之后依然成立。
   */
  private updateNpcAutonomy(state: GameState): void {
    if (this.npcAutonomyInFlight) return;
    const cursor = this.npcAutonomyCursor ?? initNpcAutonomyCursor(state);
    this.npcAutonomyCursor = cursor;
    if (!detectNpcAutonomyTrigger(state, cursor)) return;
    if (npcAutonomyThrottled(state, NPC_AUTONOMY_MIN_INTERVAL_MINUTES)) return;
    this.npcAutonomyInFlight = true;
    void this.runNpcAutonomyRound(state).finally(() => {
      this.npcAutonomyInFlight = false;
    });
  }

  /**
   * 跑一轮自主 tick。
   *
   * 状态变了就必须落盘——玩家刷新页面不该把居民刚做完的事弄丢。这跟维修那条
   * 「先存再判会话」是同一个道理：提交已经发生，就不该等 UI。
   */
  private async runNpcAutonomyRound(state: GameState): Promise<void> {
    try {
      const run = await runNpcAutonomyTick(state, {
        cursor: this.npcAutonomyCursor,
        proposeWithModel: this.buildNpcAutonomyPort(),
      });
      this.npcAutonomyCursor = run.cursor;
      this.lastNpcAutonomyResult = run.result;
      const acted = run.result.outcomes.filter((outcome) => outcome.status === 'executed');
      if (acted.length > 0) {
        saveToStorage(state);
        this.refreshInventory();
        this.flash(acted.map((outcome) => `${getNpc(outcome.npcId).name}${outcome.reason}`).join(' '));
      }
      this.refreshJudgeModePanel();
    } catch {
      // 自主行为失败不许拖垮游戏循环：玩家照常玩，下一轮再来。
      this.lastNpcAutonomyResult = undefined;
    }
  }

  /**
   * 自主 tick 的模型提案口。
   *
   * 走的是和其它 AI 场景同一条桥（`proposeWithBrain`）：模型只产出「建议」，
   * 翻译层把旧契约的 action.type 翻成竞赛契约动作，规则层再独立裁决能不能做。
   * 模型不可用时这里返回 undefined（不传端口），模块就走规则脑，产出如实标成
   * `offline-fallback`。
   *
   * 自主语义与契约动作的对应：模型的 `gift`（NPC 把东西给玩家）就是
   * 「保护物资」——停电时把容易丢的货交到玩家手上保管。模型的对话/拒绝不是
   * 自主动作，返回 null 交给规则降级。
   */
  private buildNpcAutonomyPort(): NpcAutonomyModelPort | undefined {
    const cfg = aiNpcConfig();
    if (cfg.mode !== 'ollama' && cfg.mode !== 'proxy') return undefined;
    return async (input): Promise<NpcAutonomyProposal | null> => {
      const runtime = this.getAiRuntime(getNpc(input.npcId));
      if (!runtime) return null;
      const translated = await proposeWithBrain(runtime.brain, input.observation, {
        availableActions: ['gift', 'dialogue', 'refuse'],
      });
      if (!translated) return null;
      const proposal = translated.proposal;
      if (proposal.kind !== 'give') return null;
      const transfer = proposal.transfer;
      // 方向必须严格是「这位居民 → 玩家」。方向反了就是白送或者凭空造物。
      if (transfer.to !== 'player') return null;
      if (transfer.from.kind !== 'npc' || transfer.from.npcId !== input.npcId) return null;
      return {
        kind: 'protect_supplies',
        npcId: input.npcId,
        itemId: transfer.itemId,
        quantity: transfer.quantity,
        ...(translated.utterance ? { utterance: translated.utterance } : {}),
      };
    };
  }

  /**
   * 停电危机启动后，玩家和阿林说话时走的那条路。
   *
   * 与 `runAlinRepairPlan` 并存而不是替换它：危机是**首章剧情**，触发条件
   * 是「维修门已开 + 危机已推进」；没触发时玩家遇到的仍是原来那个通用维修
   * 演示场景。两条路都收口到 `executeCompetitionProposal`（前者在场景内部，
   * 后者在 alinRepairDemo 内部），只是外层的叙事不同。
   */
  private async runBlackoutRepairPlan(npc: NpcDef, captured: DialogueSession): Promise<void> {
    if (this.blackoutInFlight) return;
    this.blackoutInFlight = true;
    try {
      const state = getGame();
      // 点「接回主线」就是应承。语义与幂等细节见 ensureBlackoutHelpRequested。
      ensureBlackoutHelpRequested(state);
      const result = await runBlackoutRepair(state, {
        proposeWithModel: this.buildBlackoutRepairPort(npc),
      });
      this.lastBlackoutRepairResult = result;

      // 提交已经发生，必须落盘——哪怕玩家已经关掉对话。这跟 alinRepairPlan
      // 的「先存再判会话」是同一个道理：状态变了就不该等 UI。
      saveToStorage(state);
      this.refreshInventory();
      if (!isDialogueFresh(this.currentDialogueSession(), captured)) return;
      const d = this.dialogue;
      if (!d) return;
      // 被拒时补一句「去哪拿」。文案怎么拼见 blackoutRepairNarration。
      d.message = blackoutRepairNarration(state, result);
      d.messageSource = result.decisionSource === 'model' ? 'ollama' : 'competition-offline';
      if (result.status === 'executed') playSfx('goal');
      d.revision += 1;
      this.refreshDialogue();
    } finally {
      this.blackoutInFlight = false;
    }
  }

  /**
   * 小周/阿珍在危机期间走模型决策的交易。
   *
   * 为什么不复用下面那个通用 `dialogue.level === 'trade'` 分支：那条路直接
   * 调 `trade(getGame(), offer)`，一步改完状态，没有「模型提议 → 规则裁决」
   * 的过程。危机期间这两位的成交要展示 AI 原生能力，所以走 `runCompetitionStep`。
   * 危机之外仍是原来的通用交易，玩家体验不变。
   */
  private async runBlackoutTrade(npc: NpcDef, captured: DialogueSession): Promise<void> {
    if (this.blackoutInFlight) return;
    this.blackoutInFlight = true;
    try {
      const state = getGame();
      const port = this.buildBlackoutTradePort(npc);
      const result = npc.id === 'xiaozhou'
        ? await runXiaozhouTrade(state, { proposeWithModel: port })
        : await runAzhenExchange(state, { proposeWithModel: port });
      this.lastBlackoutTradeResult = result;
      if (result.status === 'executed') saveToStorage(state);
      this.refreshInventory();
      if (!isDialogueFresh(this.currentDialogueSession(), captured)) return;
      const d = this.dialogue;
      if (!d) return;
      d.message = result.action?.message ?? '他没有接这个话头。';
      d.messageSource = result.decisionSource === 'model' ? 'ollama' : 'competition-offline';
      if (result.status === 'executed' && result.action?.ok) {
        playSfx('trade');
        this.chargeTime(ACTION_COSTS.trade);
        this.recordNpcTrade(npc, result.action.message);
      }
      d.revision += 1;
      this.refreshDialogue();
    } finally {
      this.blackoutInFlight = false;
    }
  }

  /**
   * 阿林维修的模型端口。
   *
   * 结构照抄 `buildRepairProposalPort`（那条路径已经跑通并验收过），三条边界
   * 完全一致：模型不能决定成败（只是提案）、模型说不动就真的不动、模型挂了
   * 由场景自己的 fallback 接管。
   */
  private buildBlackoutRepairPort(npc: NpcDef): BlackoutModelPort | undefined {
    const runtime = this.getAiRuntime(npc);
    if (!runtime) return undefined;
    const cfg = aiNpcConfig();
    if (cfg.mode !== 'ollama' && cfg.mode !== 'proxy') return undefined;
    const brain = runtime.brain;
    if (typeof brain.decideTask !== 'function') return undefined;

    return async (input) => {
      const profile = NPC_PROFILES[npc.id];
      const trust = input.observation.world.npcs[0]?.trust ?? 35;
      const rejection = input.previousFeedback?.validation;
      const previousRejectedReason = rejection && !rejection.accepted
        ? (rejection.reason === 'missing_item' ? '材料不足'
          : rejection.reason === 'low_trust' ? '信任不足'
            : (rejection.detailCode ?? rejection.reason))
        : undefined;

      const result = await brain.decideTask!({
        task: 'repair',
        repair: {
          gateId: input.gateId,
          npcName: npc.name,
          traits: { ...(profile?.traits ?? { altruism: 0.5, pragmatism: 0.5, aggression: 0.1, loyalty: 0.5, caution: 0.5 }) },
          trust,
          // 本章门槛按态度分档，不能让模型误以为还是 demo 的 70。
          trustThreshold: observeBlackout(getGame()).alinTrust,
          materials: input.materials.map((stack) => ({ itemId: stack.itemId, quantity: stack.quantity })),
          playerHas: input.observation.world.player.inventory.map((stack: { itemId: string; quantity: number }) => ({ itemId: stack.itemId, quantity: stack.quantity })),
          ...(previousRejectedReason ? { previousRejectedReason } : {}),
        },
      });

      if (!result || result.source !== 'model') return null;
      const decision = parseRepairIntent(result.text);
      if (!decision) return null;
      if (decision.intent !== 'repair_gate') {
        this.lastRepairIntentNote = decision;
        return null;
      }
      this.lastRepairIntentNote = decision;
      // 模型说的目标要真的用上：首章修的是塔楼主线，不是通行门。
      // 丢 target 会在将来出现第二个可修目标时「说修 A、实际修 B」且不报错。
      return {
        kind: 'repair_gate',
        gateId: decision.target ?? input.gateId,
        // 材料永远照服务端配方申请，不采信模型报的数。
        materials: input.materials.map((stack) => ({ ...stack })),
      };
    };
  }

  /**
   * 小周/阿珍的模型端口。
   *
   * 为什么不用 `decideTask`：`NpcBrainTask` 目前只有 `'repair'` 一个值，
   * `NpcBrainTaskRequest` 也只有 `repair?` 一个字段。为了交易去扩这个联合
   * 类型，会连带影响服务端 `sanitizeRepair` 的白名单——那是另一层面的改动，
   * 不在本次范围内。
   *
   * 所以走 `proposeWithBrain`（旧契约路径，产出 `NpcActionProposal` → 翻译成
   * `trade`）。它天然能吐 trade：`ARCHETYPE_ACTIONS` 里 neutral / ally 都含
   * trade，翻译层 `translateModelAction` 的 trade 分支会把双边方向与库存
   * 都核一遍，缺任何一边就返回 null——不会替模型编造一次不存在的交换。
   *
   * 显式传 `availableActions: ['trade']`：这个阶段玩家点的是「交易」，场景
   * 最清楚接通了什么，不该让桥接层按原型猜。
   */
  private buildBlackoutTradePort(npc: NpcDef): BlackoutTradeModelPort | undefined {
    const runtime = this.getAiRuntime(npc);
    if (!runtime) return undefined;
    const cfg = aiNpcConfig();
    if (cfg.mode !== 'ollama' && cfg.mode !== 'proxy') return undefined;
    const brain = runtime.brain;

    return async (input) => {
      const translated = await proposeWithBrain(brain, input.observation, {
        availableActions: ['trade'],
      });
      if (!translated) return null;
      // 双保险：翻译层理论上只会吐 trade 或 observe，但这里只认 trade——
      // 「观察」在本场景等价于「这轮不谈」，交给 fallback 判断，不冒充成交。
      if (translated.proposal.kind !== 'trade') return null;
      // 只接受这位居民的报价：桥接层不知道场景价目表，可能产出一个
      // 场景里根本不存在的组合；runXiaozhouTrade/runAzhenExchange 会以
      // 报价 id 复核并如实拒绝，这里先挡一道，避免无谓的 execute 尝试。
      if (translated.proposal.npcId !== npc.id) return null;
      return translated.proposal;
    };
  }

  private async runAlinRepairPlan(npc: NpcDef, captured: DialogueSession): Promise<void> {
    const current = this.dialogue;
    if (!current || current.npc !== npc.id) return;
    // 上一次还没跑完就不再进第二遍（见 `repairInFlight` 的注释）。
    // 静默返回而不是弹提示：玩家连点两下时，本来就只该看到一次结果。
    if (this.repairInFlight) return;
    this.repairInFlight = true;
    // 占位文案与 refreshDialogue 必须落在 try 里面。它们看起来「不可能抛」——
    // refreshDialogue 只是 getNpc / setText / setTexture，而 'alin' 必然命中——
    // 但那是「靠上游不抛」，不是「结构上不可能漏锁」。一旦这里抛，finally 覆盖
    // 不到，repairInFlight 永久为 true，维修按钮从此失效。放进 try 才闭合。
    try {
      current.messageSource = 'competition-offline';
      current.message = '只读观察 → 结构化提案 → 校验…';
      this.refreshDialogue();
      const previousResult = this.lastAlinRepairResult;
      const game = getGame();
      // 这里以前是 `runAlinRepairScenario(game)`——一个参数都不传，于是这个场景
      // 里的 `propose` 端口永远返回写死的 repair_gate。用户看到的「AI 维修」其实
      // 是确定性代码在跑，「模型」全程没有参与决策。
      //
      // 现在把模型接进来：模型负责「修不修」，validator 仍独立裁决「能不能修」。
      // 模型拿不到 GameState，只能看到一份只读观察和维修配方。
      const result = await runAlinRepairScenario(game, {
        proposeWithModel: this.buildRepairProposalPort(npc),
      });
      this.lastAlinRepairResult = result;
      this.judgeLatestResult = result;
      this.refreshJudgeModePanel();
      // A committed gate or its compatibility initialization must persist even
      // when the player closed the dialogue before the deterministic step ended.
      saveToStorage(game);
      this.refreshInventory();
      if (!isDialogueFresh(this.currentDialogueSession(), captured)) return;
      const trust = result.after.npcs[0]?.trust ?? 35;
      const alreadyCommitted = previousResult?.status === 'executed' && result.status === 'already_open';
      // 模型说了什么就显示什么。
      //
      // 这一段是「模型拒绝」能被玩家看见的地方：以前模型无论说什么，界面上
      // 都只有「门已打开」或「校验拒绝」两种结果，玩家无从知道阿林其实说过
      // 「材料不够，我不动」。现在把它原话摆出来，并且**不覆盖**状态标签
      // ——台词和结果分开显示，避免「他说不修」和「门开了」同时出现时读不懂。
      const note = this.lastRepairIntentNote?.utterance;
      const label = alreadyCommitted || result.status === 'already_open'
        ? '门已打开｜未重复提交'
        : result.status === 'executed'
          ? '门已打开｜已提交'
          : result.validation?.accepted === false && result.validation.detailCode === 'repair_materials_unconfigured'
            ? '待确认｜缺维修配方'
            : result.validation?.accepted === false && result.validation.reason === 'low_trust'
              ? `信任${trust}/70｜拒绝`
              : '校验拒绝｜未改变';
      current.message = note ? `${note}\n${label}` : label;
      current.revision += 1;
      this.refreshDialogue();
    } catch {
      if (!isDialogueFresh(this.currentDialogueSession(), captured)) return;
      current.message = 'offline-fallback｜规划失败｜游戏状态未改变';
      current.revision += 1;
      this.refreshDialogue();
    } finally {
      // 放锁必须走 finally：try 里有 `return`（对话已关闭时会提前退出），
      // 漏了这一步就等于把维修功能永久锁死。
      this.repairInFlight = false;
    }
  }

  // ── input ──────────────────────────────────────────────────────────────
  private bindInput(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    this.cursors = keyboard.addKeys({ up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT' }) as DirKeys;
    this.wasd = keyboard.addKeys({ left: 'A', right: 'D' }) as typeof this.wasd;
    this.keyE = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.keyEsc = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.keyI = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.I);
    this.keyEnter = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    this.keyC = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C);
    this.keyM = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.M);
    this.keyS = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyF = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    this.keyQ = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q);

    this.keyE.on('down', () => this.guard('e', this.onInteract), this);
    this.keyEsc.on('down', () => this.guard('esc', this.onEsc), this);
    this.keyI.on('down', () => this.guard('i', this.onToggleInventory), this);
    this.keyEnter.on('down', () => this.guard('enter', this.onUse), this);
    this.keyC.on('down', () => this.guard('c', this.onToggleCrafting), this);
    this.keyM.on('down', () => this.guard('m', this.onToggleMap), this);
    // OVERHAUL Wave C1: S sells inside the shop; nowhere else does anything.
    this.keyS.on('down', () => {
      if (this.encounterOpen && !getGame().combat && !this.encounter) this.shopSell();
    }, this);
    // OVERHAUL Wave C2: F buys the paid shortcut at the up stairwell.
    this.keyF.on('down', () => this.guard('f', this.tryShortcut), this);
    this.keyQ.on('down', () => this.guard('q', this.cycleWeaponVisual), this);
    this.cursors.up.on('down', () => this.guard('up', this.onNavUp), this);
    this.cursors.down.on('down', () => this.guard('down', this.onNavDown), this);
  }

  // Accept a key at most once per frame (GHI-03 m9). The action has to be
  // invoked with the scene as `this` — passing a bare method reference would
  // lose it. Movement is NOT routed through here: it reads
  // cursors.left/right.isDown in update(), so holding a direction key works.
  /**
   * Hide every panel object that is visible while no panel is open.
   *
   * Returns whether it found anything. This is a recovery path, not normal
   * operation: if it ever fires, something left a panel behind, and the point is
   * that the player always has a way out.
   */
  private clearStrayPanels(): boolean {
    const groups: ReadonlyArray<ReadonlyArray<Phaser.GameObjects.GameObject | PanelObject>> = [
      this.invObjects,
      this.craftObjects,
      this.pauseObjects,
      this.dialogueObjects,
      this.encounterObjects,
      this.shelterObjects,
      this.shelterInputObjects,
    ];
    let found = false;
    for (const group of groups) {
      for (const o of group) {
        const v = o as Phaser.GameObjects.Image;
        if (!v.visible) continue;
        v.setVisible(false);
        found = true;
      }
    }
    return found;
  }

  private guard(slot: GameKey, action: () => void): void {
    const frame = this.game.getFrame();
    if (this.lastInputFrame[slot] === frame) return;
    this.lastInputFrame[slot] = frame;
    action.call(this);
  }

  /** Change only the scene-local appearance; never touches GameState or saves. */
  private cycleWeaponVisual(): void {
    if (!this.weapon?.active || this.stairClimb || this.pauseOpen) return;
    this.selectedVisualWeapon = nextWeaponVisual(this.selectedVisualWeapon);
    this.syncedVisualWeapon = undefined;
    this.syncWeapon();
    this.flash(`${weaponVisual(this.selectedVisualWeapon).label}外观（只改变武器显示、挥击和特效）`);
  }

  private unbindInput(): void {
    // removeAllListeners per key rather than off(): the bound handlers above are
    // closures, and Phaser does not re-run field initialisers on a scene restart
    // — addKey() hands back the same Key object, so a restart would otherwise
    // stack a second set of listeners on it.
    this.keyE?.removeAllListeners();
    this.keyEsc?.removeAllListeners();
    this.keyI?.removeAllListeners();
    this.keyEnter?.removeAllListeners();
    this.keyC?.removeAllListeners();
    this.keyM?.removeAllListeners();
    this.keyS?.removeAllListeners();
    this.keyF?.removeAllListeners();
    this.keyQ?.removeAllListeners();
    this.cursors?.up.removeAllListeners();
    this.cursors?.down.removeAllListeners();
    this.input.off(Phaser.Input.Events.POINTER_UP, this.releaseTouchDirection, this);
    this.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.releaseTouchDirection, this);
    this.game.canvas?.removeEventListener('pointercancel', this.clearTouchDirections);
    window.removeEventListener('blur', this.clearTouchDirections);
    document.removeEventListener('visibilitychange', this.clearTouchDirections);
    this.touchDirectionPointers.clear();
  }

  private onToggleMap(): void {
    if (this.stairClimb || this.inventoryOpen || this.craftingOpen || this.dialogueOpen || this.pauseOpen || this.encounterOpen || this.shelterOpen) return;
    this.openTowerOverview();
  }

  private onToggleInventory(): void {
    if (this.stairClimb || this.craftingOpen || this.dialogueOpen || this.pauseOpen || this.encounterOpen || this.shelterOpen) return;
    this.toggleInventory();
  }

  private onEsc(): void {
    if (this.stairClimb) return;
    // ESCAPE HATCH FIRST.
    //
    // Every branch below is gated on a state flag, so a panel that is DRAWN
    // while its flag says closed matches none of them - ESC falls through to
    // togglePause() and the player is stuck looking at a panel that eats the
    // screen and answers nothing. That is what happened on floor 2: a panel
    // whose frame had slid off-screen still had its fill and rows visible, the
    // footer still read "按 E 对话" because no panel was open by the game's own
    // reckoning, and there was no key that would clear it.
    if (
      !this.encounterOpen &&
      !this.inventoryOpen &&
      !this.craftingOpen &&
      !this.dialogueOpen &&
      !this.pauseOpen &&
      !this.shelterOpen &&
      this.clearStrayPanels()
    ) {
      this.flash('面板已清理');
      return;
    }
    // OVERHAUL Wave A: ESC mid-fight is the retreat — it runs the flee round
    // rather than walking away for free, so the choice has a cost.
    if (this.encounterOpen && getGame().combat && !this.combatDone) {
      this.combatSelected = 2; // flee
      this.activateCombatChoice();
      return;
    }
    // OVERHAUL Wave C1: the shop is open (no combat, no encounter object).
    if (this.encounterOpen && !getGame().combat && !this.encounter) {
      this.closeShop();
      return;
    }
    if (this.encounterOpen) {
      // Leaving an unresolved encounter is the walk-away: no cost, no
      // consumption. A resolved one just closes the outcome panel.
      this.closeEncounter();
      return;
    }
    if (this.shelterOpen) {
      this.closeShelter();
      return;
    }
    if (this.inventoryOpen) this.toggleInventory();
    else if (this.craftingOpen) this.toggleCrafting();
    else if (this.dialogueOpen) this.dialogueBack();
    else this.togglePause();
  }

  private onNavUp(): void {
    if (this.shelterOpen && !getGame().shelterPlan?.resolved) {
      this.shelterSelected = Math.max(0, this.shelterSelected - 1);
      this.buildShelterPanel();
      return;
    }
    // OVERHAUL Wave C1: the shop's cursor.
    if (this.encounterOpen && !getGame().combat && !this.encounter) {
      this.shopSelected = Math.max(0, this.shopSelected - 1);
      this.buildShopPanel();
      return;
    }
    if (this.encounterOpen && getGame().combat && !this.combatDone) {
      this.combatSelected = Math.max(0, this.combatSelected - 1);
      this.buildCombatPanel();
    } else if (this.encounterOpen && this.encounter && !this.encounter.resolved) {
      this.encounter.selected = Math.max(0, this.encounter.selected - 1);
      this.buildEncounterPanel(this.spotMarkers.get(this.encounter.spotId)?.isBoss ?? false);
    } else if (this.inventoryOpen) {
      this.invSelected = Math.max(0, this.invSelected - 1);
      this.refreshInventory();
    } else if (this.craftingOpen) {
      this.craftSelected = Math.max(0, this.craftSelected - 1);
      this.refreshCraft();
    } else if (this.dialogueOpen && this.dialogue) {
      this.dialogue.selected = Math.max(0, this.dialogue.selected - 1);
      this.refreshDialogue();
    } else if (this.pauseOpen) {
      this.pauseSelected = Math.max(0, this.pauseSelected - 1);
      this.refreshPause();
    }
  }

  private onNavDown(): void {
    if (this.shelterOpen && !getGame().shelterPlan?.resolved) {
      this.shelterSelected = Math.min(SHELTER_ROWS.length - 1, this.shelterSelected + 1);
      this.buildShelterPanel();
      return;
    }
    // OVERHAUL Wave C1: the shop's cursor.
    if (this.encounterOpen && !getGame().combat && !this.encounter) {
      this.shopSelected = Math.min(this.shopEntries.length - 1, this.shopSelected + 1);
      this.buildShopPanel();
      return;
    }
    if (this.encounterOpen && getGame().combat && !this.combatDone) {
      this.combatSelected = Math.min(2, this.combatSelected + 1);
      this.buildCombatPanel();
    } else if (this.encounterOpen && this.encounter && !this.encounter.resolved) {
      this.encounter.selected = Math.min(this.encounter.choices.length - 1, this.encounter.selected + 1);
      this.buildEncounterPanel(this.spotMarkers.get(this.encounter.spotId)?.isBoss ?? false);
    } else if (this.inventoryOpen) {
      const count = getGame().player.inventory.slots.length;
      this.invSelected = Math.min(Math.max(0, count - 1), this.invSelected + 1);
      this.refreshInventory();
    } else if (this.craftingOpen) {
      const count = this.craftEntries().length;
      this.craftSelected = Math.min(Math.max(0, count - 1), this.craftSelected + 1);
      this.refreshCraft();
    } else if (this.dialogueOpen && this.dialogue) {
      const count = this.dialogueOptionsView().length;
      this.dialogue.selected = Math.min(Math.max(0, count - 1), this.dialogue.selected + 1);
      this.refreshDialogue();
    } else if (this.pauseOpen) {
      this.pauseSelected = Math.min(PAUSE_OPTIONS.length - 1, this.pauseSelected + 1);
      this.refreshPause();
    }
  }

  private onUse(): void {
    if (this.stairClimb) return;
    if (this.shelterOpen) {
      this.activateShelterChoice();
      return;
    }
    // OVERHAUL Wave A: the fight's turn key. Once the outcome screen is up,
    // Enter closes it; until then it plays the selected action.
    if (this.encounterOpen && getGame().combat) {
      if (this.combatDone) this.closeCombat();
      else this.activateCombatChoice();
      return;
    }
    // OVERHAUL Wave C1: Enter in the shop buys one of the highlighted item.
    if (this.encounterOpen && !this.encounter) {
      this.shopBuy();
      return;
    }
    if (this.encounterOpen) {
      if (this.encounter?.resolved) this.closeEncounter();
      else this.activateEncounterChoice();
      return;
    }
    if (this.inventoryOpen) {
      const stack = getGame().player.inventory.slots[this.invSelected];
      if (!stack) return;
      const result = useConsumable(getGame(), stack.itemId);
      if (result.ok) {
        saveToStorage(getGame());
        this.refreshInventory();
        this.refreshStats();
        // AND IT REGISTERS ON THE BODY. Eating and drinking are the most frequent
        // actions in a survival game and they were a line of text; the burst is
        // on the survivor, at their chest, so the stat that moved is the one you
        // can see move.
        playFx(this, 'collect-burst', getGame().player.x, PLAYER_FEET_Y - 52, LIGHT_DEPTH + 1);
        // The item's stat gain, and what it cleared: a medkit that closes a
        // wound says so, because that is the reason it was reached for.
        const cured = result.cured?.length ? ` · 治好${result.cured.map((c) => AILMENT_LABEL[c]).join('、')}` : '';
        this.flash(`使用 ${getItem(stack.itemId).displayName} · ${STAT_LABEL[result.stat!]} +${Math.round(result.amount!)}${cured}`);
      } else {
        this.flash(result.reason ?? '无法使用');
      }
      return;
    }
    if (this.craftingOpen) {
      this.activateCraftEntry();
      return;
    }
    if (this.dialogueOpen) {
      this.activateDialogueOption();
      return;
    }
    if (this.pauseOpen) this.activatePause();
  }

  private onInteract(): void {
    if (this.stairClimb) return;
    if (this.shelterOpen) {
      this.onUse();
      return;
    }
    if (this.inventoryOpen || this.craftingOpen || this.pauseOpen) return;
    if (this.dialogueOpen) {
      this.closeDialogue();
      return;
    }
    const state = getGame();
    // OVERHAUL: a "?" in reach is the first thing E reaches for — the floor's
    // rumour beats its containers for attention, the way ALTACIMA's question
    // marks pull the player across a room. The trader's spot id is 'shop'.
    const spot = this.nearestEncounterSpot();
    if (spot === 'shop') {
      this.openShop();
      return;
    }
    if (spot) {
      this.openEncounter(spot);
      return;
    }
    const npc = this.nearestNpc(state);
    if (npc) {
      this.openDialogue(npc);
      return;
    }
    if (this.nearBed(state)) {
      this.attemptSleep();
      return;
    }
    const container = this.nearestContainer();
    if (container) {
      this.openContainer(container.id);
      return;
    }
    const zone = currentInteractionZone(state);
    if (zone === 'up') this.changeFloor(1);
    else if (zone === 'down') this.changeFloor(-1);
    else if (
      state.currentFloor === Math.max(...PLAYABLE_FLOORS_V01) &&
      Math.abs(state.player.x - UP_EXIT_X) <= INTERACT_DISTANCE
    ) {
      this.flash(`当前开放范围止于第 ${state.currentFloor} 层；右侧楼梯可下行`);
    }
  }

  // ── the paid shortcut (OVERHAUL Wave C2) ─────────────────────────────────
  // F at the up stairwell buys a 2-4 floor skip. Centum's formula: the price
  // climbs with every use, so skipping is a budget decision, not free
  // fast-travel. The charge happens before the jump, so a broke player never
  // moves.
  private tryShortcut(): void {
    if (this.stairClimb) {
      this.flash('楼梯攀爬中，落地后再用近路');
      return;
    }
    const state = getGame();
    if (state.status !== 'playing') return;
    const zone = currentInteractionZone(state);
    if (zone === 'up' && closedFloorGateForTransition(state, state.currentFloor, state.currentFloor + 1)) {
      this.flash('上层维修通道封锁：先完成阿林的维修门计划');
      return;
    }
    const top = Math.max(...PLAYABLE_FLOORS_V01);
    const offer = shortcutOffer(state, top);
    if (!offer) {
      this.flash('这里没有可抄的近路');
      return;
    }
    if (zone !== 'up') {
      this.flash('要走上楼口才能抄近路');
      return;
    }
    if (!charge(state, offer.price)) {
      this.flash(`抄近路要 ${offer.price} 金，你只有 ${state.player.gold}`);
      return;
    }
    recordShortcut(state);
    // Apply the jump through the same path a stair uses, then walk the rest.
    while (state.currentFloor < offer.targetFloor) {
      const r = tryChangeFloor(state, 1);
      if (!r.ok) break;
    }
    recordDepth(state);
    this.clearFloor();
    this.drawFloor();
    saveToStorage(state);
    this.cameras.main.flash(180, 0, 0, 0);
    // 抄近路也可能正好落在第 3 层 → 同一套阶段达成判定。
    if (this.maybeClearChapter1(state)) {
      playSfx('goal');
      return;
    }
    this.flash(`你抄近路跳到了第 ${state.currentFloor} 层（-${offer.price} 金）`);
    playSfx('goal');
  }

  // A panel with a frame but no readable content is the worst failure mode the
  // UI can produce: it looks like the game broke. This runs in dev only and
  // names the panel in the console the moment it opens empty, so a report of
  // "a big empty box appeared" becomes a one-line diagnosis instead of a hunt.
  private assertPanelContent(panel: string, objects: PanelObject[]): void {
    if (!import.meta.env.DEV) return;
    const readable = objects.some(
      (o) => o instanceof Phaser.GameObjects.Text && o.visible && (o.text ?? '').trim().length > 0,
    );
    if (!readable) console.warn(`[ui] panel "${panel}" opened with no visible text — it will look like an empty box`);
  }

  // What the foot bar should say while a panel is open: the panel's own keys.
  // Returns null when no panel is open, so the world hint can take over.
  private openPanelHint(): string | null {
    const combat = getGame().combat;
    if (this.encounterOpen && combat) return '点击选项出招 · ↑/↓ 选择 · Enter 出招 · ESC 撤退';
    if (this.encounterOpen && this.encounter) return '点击选项执行 · ↑/↓ 选择 · Enter 确认 · ESC 离开';
    if (this.encounterOpen) return '↑/↓ 选择 · Enter 买入 · S 卖出 · ESC 离开';
    if (this.shelterOpen) return getGame().shelterPlan?.resolved ? 'Enter 睡觉 · ESC 返回' : '↑/↓ 选择 · Enter 安排 · ESC 返回';
    if (this.inventoryOpen) return '↑/↓ 选择 · Enter 使用 · I 关闭';
    if (this.craftingOpen) return '↑/↓ 选择 · Enter 制作 · C 关闭';
    if (this.dialogueOpen) return '点击选项执行 · ↑/↓ 选择 · Enter 确定 · ESC 返回';
    if (this.pauseOpen) return '↑/↓ 选择 · Enter 确认 · ESC 继续';
    return null;
  }

  private nearBed(state: GameState): boolean {
    return state.currentFloor === STARTING_FLOOR && Math.abs(state.player.x - BED_X) <= INTERACT_DISTANCE;
  }

  private attemptSleep(): void {
    const state = getGame();
    if (!isNight(state.gameMinuteOfDay)) {
      this.flash('还太早，20:00 后才能安排夜间行动');
      return;
    }
    this.openShelter();
  }

  private openShelter(): void {
    const state = getGame();
    if (!state.shelterPlan?.resolved && availableShelterActions(state).length === 0) {
      this.flash('今晚没有可安排的 shelter 行动');
      return;
    }
    const existing = state.shelterPlan?.action;
    this.shelterSelected = existing ? Math.max(0, SHELTER_ROWS.findIndex((row) => row.action === existing)) : 0;
    this.shelterOpen = true;
    this.buildShelterPanel();
  }

  private closeShelter(): void {
    this.shelterOpen = false;
    for (const object of this.shelterObjects) {
      if (object !== this.shelterMarker) object.destroy();
    }
    this.shelterInputObjects.forEach((object) => object.destroy());
    this.shelterObjects = [];
    this.shelterInputObjects = [];
    this.shelterMarker.setVisible(false);
  }

  private buildShelterPanel(): void {
    for (const object of this.shelterObjects) {
      if (object !== this.shelterMarker) object.destroy();
    }
    this.shelterInputObjects.forEach((object) => object.destroy());
    this.shelterObjects = [];
    this.shelterInputObjects = [];
    const state = getGame();
    const { width, height } = this.viewSize();
    const panelW = this.panelWidthFor(500);
    const panelH = 300;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    const depth = PANEL_DEPTH.game.dialogue;
    const resolved = state.shelterPlan?.resolved === true;

    this.shelterObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'green', depth));
    // The shelter is modal: outside clicks must not reach world interactions.
    const clickShield = this.add
      .zone(cx, cy, width, height)
      .setInteractive()
      .setDepth(depth + 4)
      .setScrollFactor(0);
    clickShield.on('pointerdown', () => undefined);
    this.shelterInputObjects.push(clickShield);
    this.shelterObjects.push(...buildPanelHeader(this, left, top, panelW, '夜间安排 · 宿舍', UI.good, depth + 5));
    // The well is 72px tall, not 44px: the stress line quotes the newest diary
    // entry, which is a whole Chinese sentence, and with the character-level
    // wrap below the longest real entry needs three lines of 20px. The old
    // 44px well held exactly two, so the third line had nowhere to go.
    this.shelterObjects.push(...buildPanelWell(this, left + 12, top + 28, panelW - 24, 72, depth + 5));
    const stress = Math.round(state.player.stress ?? 20);
    const latest = recentDiary(state, 1)[0];
    this.shelterObjects.push(
      this.add.text(left + 24, top + 30, `压力 ${stress}/100${latest ? ` · 上次：${latest.message}` : ' · 今天还没有记录'}`, {
        fontFamily: FONT_FAMILY,
        fontSize: `${TYPE.caption}px`,
        color: hex(stress >= 70 ? TEXT.warn : TEXT.primary),
        // Phaser's default wrap only breaks on spaces, and Chinese has none,
        // so the quoted diary sentence stayed on one line: 460px against a
        // 452px wrap box (8px over), and 520px / 56px past the well's right
        // edge for the longest real entry — it left the panel. The
        // character-level wrap breaks it at the wrap width instead.
        wordWrap: { width: panelW - 48, useAdvancedWrap: true },
        // maxLines used to be 2, which silently deleted the third line — a
        // whole sentence — instead of showing it. The well now holds three
        // lines, so the cap matches what can actually be shown.
        maxLines: 3,
      }).setOrigin(0, 0).setDepth(depth + 6),
    );
    const rowsTop = top + 110;
    for (const [index, row] of SHELTER_ROWS.entries()) {
      const objects = buildListRow(this, left + 16, rowsTop + index * 26, panelW - 32, depth + 6, {
        label: row.label,
        value: row.value,
        selected: index === this.shelterSelected,
        dim: resolved && state.shelterPlan?.action !== row.action,
      });
      this.shelterObjects.push(...objects);
      const label = objects.find((object) => object instanceof Phaser.GameObjects.Text && object.text === row.label) as Phaser.GameObjects.Text | undefined;
      if (index === this.shelterSelected && label) {
        placeMarker(this.shelterMarker, label);
        this.shelterMarker.setDepth(depth + 8).setVisible(true).setScrollFactor(0);
      }
      const hitArea = this.add
        .zone(cx, rowsTop + index * 26 + 13, panelW - 32, 26)
        .setInteractive({ useHandCursor: true })
        .setDepth(depth + 9)
        .setScrollFactor(0);
      hitArea.on('pointerdown', () => {
        if (!this.shelterOpen || getGame().shelterPlan?.resolved) return;
        this.shelterSelected = index;
        this.activateShelterChoice();
      });
      this.shelterInputObjects.push(hitArea);
    }
    if (resolved) {
      const sleepX = left + panelW * 0.28;
      const returnX = left + panelW * 0.72;
      this.shelterObjects.push(
        this.add.text(sleepX, top + panelH - 24, '点击睡觉', {
          fontFamily: FONT_FAMILY,
          fontSize: `${TYPE.caption}px`,
          color: hex(PALETTE.clothHigh),
        }).setOrigin(0.5).setDepth(depth + 6),
        this.add.text(returnX, top + panelH - 24, '点击返回', {
          fontFamily: FONT_FAMILY,
          fontSize: `${TYPE.caption}px`,
          color: hex(PALETTE.clothHigh),
        }).setOrigin(0.5).setDepth(depth + 6),
      );
      for (const [x, action] of [[sleepX, () => this.activateShelterChoice()], [returnX, () => this.closeShelter()]] as const) {
        const hitArea = this.add
          .zone(x, top + panelH - 24, panelW * 0.36, 28)
          .setInteractive({ useHandCursor: true })
          .setDepth(depth + 9)
          .setScrollFactor(0);
        hitArea.on('pointerdown', () => {
          if (this.shelterOpen && getGame().shelterPlan?.resolved) action();
        });
        this.shelterInputObjects.push(hitArea);
      }
    } else {
      this.shelterObjects.push(this.add.text(cx, top + panelH - 22, '点击选项安排 · ↑/↓ 选择 · Enter 安排 · ESC 返回', {
        fontFamily: FONT_FAMILY,
        fontSize: `${TYPE.caption}px`,
        color: hex(PALETTE.clothHigh),
      }).setOrigin(0.5).setDepth(depth + 6));
    }
    this.shelterObjects.push(this.shelterMarker);
    // Frame, text, summary, footer and hit areas stay at screen coordinates.
    lockToScreen(this.shelterObjects);
    lockToScreen(this.shelterInputObjects);
    this.assertPanelContent('shelter', this.shelterObjects);
  }

  private activateShelterChoice(): void {
    const state = getGame();
    if (state.shelterPlan?.resolved) {
      const result = finishNight(state);
      if (!result.ok) {
        this.flash(result.reason ?? '今晚还不能睡');
        return;
      }
      this.closeShelter();
      saveToStorage(state);
      playSfx('sleep');
      const cam = this.cameras.main;
      cam.fadeOut(520, 5, 8, 11);
      this.time.delayedCall(560, () => {
        if (!this.scene.isActive()) return;
        cam.fadeIn(620, 5, 8, 11);
        this.refreshClock();
        this.refreshStats();
        this.applyNightLighting();
        const attackNote = result.attacked ? ` · 夜袭 -${result.attackDamage} HP` : '';
        this.flash(`睡到第 ${result.nextDay} 天 06:00 · 压力 ${Math.round(state.player.stress ?? 20)}${attackNote}`);
      });
      if (state.status === 'lost') this.scene.start('End');
      return;
    }

    const row = SHELTER_ROWS[this.shelterSelected];
    if (!row) return;
    const result = resolveShelterAction(state, row.action);
    if (!result.ok) {
      this.flash(result.reason ?? result.message);
      return;
    }
    saveToStorage(state);
    playSfx('click');
    this.buildShelterPanel();
    this.flash(`${result.message} 按 Enter 睡觉`);
  }

  private nearestContainer(): GeneratedContainer | null {
    const px = getGame().player.x;
    let best: GeneratedContainer | null = null;
    let bestDist = INTERACT_DISTANCE;
    for (const c of this.floorView.containers) {
      if (c.items.length === 0) continue;
      const d = Math.abs(c.x - px);
      if (d <= bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  }

  private openContainer(containerId: string): void {
    const state = getGame();
    const floor = state.currentFloor;
    const label = this.floorView.containers.find((c) => c.id === containerId)?.label ?? containerId;
    const result = lootContainer(state, floor, containerId);
    saveToStorage(state);
    this.floorView = getFloorView(state, floor);
    this.setContainerEmptyVisual(containerId, (this.floorView.containers.find((c) => c.id === containerId)?.items.length ?? 0) === 0);
    this.refreshInventory();

    if (result.took.length === 0 && !result.full) this.flash(`${label} 是空的`);
    else if (result.full) {
      // B3-16: the bag takes mergeable stacks and refuses new ones, and nothing
      // on screen said so — the playtest found players discovering the rule by
      // being refused three times. Name which half happened.
      this.flash(
        result.took.length > 0
          ? '叠放进的已入包；新物品放不下（背包已满），剩余留在容器'
          : '背包已满：新物品放不下，能叠进已有堆的才能进包',
      );
    } else {
      // OVERHAUL: a chest thunk for opening a container, distinct from the
      // ground pickup's lighter blip — the container is the bigger event.
      playSfx('chest');
      // 420ms against the clip's 333ms: a frame overrun (scene switch, save,
      // hitch) must not cut the bend in half.
      this.playActionAnim(searchAnimKey('player'), 420);
      // THE MOMENT OF GETTING IT. A container opened and its contents appeared in
      // the bag with nothing on screen saying so; the burst is that beat.
      playFx(this, 'collect-burst', state.player.x + 10, PLAYER_FEET_Y - 50, LIGHT_DEPTH);
      this.flash(`获得 ${result.took.map((s) => `${getItem(s.itemId).displayName}×${s.quantity}`).join('、')}（-${ACTION_COSTS.searchContainer} 分钟）`);
      this.chargeTime(ACTION_COSTS.searchContainer);
    }
  }

  private autoPickup(): void {
    const state = getGame();
    for (const g of [...this.floorView.groundItems]) {
      if (Math.abs(g.x - state.player.x) > 12) continue;
      const r = lootGround(state, state.currentFloor, g.key);
      if (r.took) {
        this.groundObjs.get(g.key)?.destroy();
        this.groundObjs.delete(g.key);
        this.floorView = getFloorView(state, state.currentFloor);
        this.refreshInventory();
        saveToStorage(state);
        playSfx('pickup');
        // the same beat as a container, smaller: the item went into the bag.
        // Its own pose, not search: picking something off the floor is standing
        // and reaching down, not bending into a locker.
        playFx(this, 'collect-burst', g.x, PLAYER_FEET_Y - 26, LIGHT_DEPTH);
        this.playActionAnim(pickupAnimKey(this.metaSelectedCharacter()), 420);
        this.flash(`拾取 ${getItem(r.took.itemId).displayName}×${r.took.quantity}（-${ACTION_COSTS.pickupGround} 分钟）`);
        this.chargeTime(ACTION_COSTS.pickupGround);
      } else if (r.full) {
        this.flash('背包已满：新物品放不下，能叠进的堆才能拾取');
      }
    }
  }

  private changeFloor(direction: 1 | -1): void {
    if (this.stairClimb) return;
    const state = getGame();
    const traversal = stairTraversalFor(state, direction);
    if (!traversal) {
      const gate = closedFloorGateForTransition(state, state.currentFloor, state.currentFloor + direction);
      this.flash(gate ? `上层维修通道封锁：先协助阿林修复门禁（第 ${gate.toFloor} 层未开放）` : direction === 1 ? '已到顶层' : '已到尽头');
      return;
    }
    this.speedX = 0;
    this.stairClimb = { ...traversal, elapsedMs: 0 };
    this.setFloorCameraBounds(state.currentFloor, this.stairClimb);
    this.player.setFlipX(direction < 0);
    this.player.play(walkAnimKey(this.metaSelectedCharacter()), true);
    this.player.anims.timeScale = 1.25;
    this.flash(direction === 1 ? '沿楼梯上行……' : '沿楼梯下行……');
  }

  /** Advance the visible stair traversal; floor state changes only at 100%. */
  private updateStairClimb(delta: number): void {
    const climb = this.stairClimb;
    if (!climb) return;
    climb.elapsedMs = Math.min(climb.durationMs, climb.elapsedMs + Math.max(0, delta));
    const pose = stairPosition(climb, climb.elapsedMs);
    this.player.setPosition(pose.x, pose.y);
    this.player.setFlipX(climb.direction < 0);
    this.player.anims.timeScale = 1.25;
    for (const shadow of this.playerShadow) {
      (shadow as Phaser.GameObjects.Rectangle).setPosition(pose.x, pose.y + 2);
    }
    if (this.playerLight) this.playerLight.setPosition(pose.x, pose.y - 40);
    // The climb moves the sprite directly, outside the walking path, so the
    // crowbar has to be told again or it hangs in the air at the stair mouth
    // while the survivor slides up it.
    this.syncWeapon();
    if (pose.progress < 1) return;

    const state = getGame();
    const result = completeStairTraversal(state, climb);
    this.stairClimb = undefined;
    if (!result.ok) {
      this.setFloorCameraBounds(state.currentFloor);
      this.player.setPosition(state.player.x, PLAYER_FEET_Y);
      this.flash(result.reason === 'top' ? '已到顶层' : result.reason === 'gate_locked' ? '上层维修通道已封锁：请先修复门禁' : '已到尽头');
      return;
    }

    this.clearFloor();
    this.drawFloor(); // records the visit only after the player lands
    recordDepth(state);
    const meta = loadMeta();
    const gained = applyDepth(meta, state.currentFloor);
    if (gained.length > 0) {
      saveMeta(unlockFromDepth(meta, state.currentFloor));
      playSfx('goal');
      this.flash(`新幸存者解锁：${gained.map((c) => CHARACTER_NAMES[c] ?? c).join('、')}！回标题可更换`);
    }
    // Leaving a dwell event's floor is still the escape; the event must not
    // follow the player across the stairwell.
    if (state.worldEvents.activeEvent?.source === 'dwell') state.worldEvents.activeEvent = null;
    saveToStorage(state);
    // 第 1 章达成（修好线路、抵达第 3 层）→ 阶段达成卡接管这一屏。
    if (this.maybeClearChapter1(state)) return;
    this.flash(`到达第 ${state.currentFloor} 层 · 已从楼梯落地`);
  }

  /**
   * 第 1 章达成：门禁修好后抵达第 3 层 → 弹一次阶段达成卡。
   *
   * 这是**阶段里程碑**，不是胜利：`status` 不会被改成 'won'，正式胜利条件
   * 仍是抵达第 100000 层（docs/GAME_DESIGN_LOCK.md 最高设计权威）。
   * `once` 语义保证只弹一次：再上一次楼不再弹（flag 已经置位）。
   *
   * 判定本身在 `systems/chapters.ts`（纯函数，可单测）；场景层只负责
   * 「弹卡」这一有画面的部分。
   */
  private maybeClearChapter1(state: GameState): boolean {
    if (!clearChapter1(state)) return false;
    saveToStorage(state);
    this.scene.start('End', {
      mode: 'chapter',
      title: '第 1 章完成',
      subtitle: `线路恢复，抵达第 ${CHAPTER1_CLEAR_FLOOR} 层`,
    });
    return true;
  }

  // B3-15: rolls dwell pressure and applies the outcome. Pure logic lives in
  // systems/dwellPressure.ts; this is the side-effect half (flash + the
  // wanderer event). The roll happens before the next one is armed so the
  // first roll on a floor uses the gentlest table row.
  private updateDwellPressure(state: GameState, minutes: number): void {
    if (state.status !== 'playing') return;
    const dwell = ensureDwell(state);
    tickDwell(dwell, state.currentFloor, minutes);
    if (isDwellExempt(state.currentFloor)) return;
    if (state.worldEvents.activeEvent) return; // one event at a time
    if (!dwellRollDue(dwell)) return;
    const outcome = rollDwellEvent(state, dwell, state.currentFloor);
    armNextRoll(dwell);
    if (outcome.kind === 'prowler') {
      state.worldEvents.activeEvent = {
        type: 'wanderer',
        floor: state.currentFloor,
        source: 'dwell',
        status: 'active',
        message: outcome.message,
      };
      state.worldEvents.history.push(`day${state.day}:dwell`);
      playSfx('danger');
      this.flash(outcome.message);
    } else if (outcome.kind === 'atmosphere') {
      this.flash(outcome.message);
    } else if (outcome.kind === 'scout') {
      // No monster — a sighting. The next roll on this floor is more likely to
      // be teeth, so this is the warning shot the player should read as "move".
      this.flash(outcome.message);
    }
  }

  // Keeps the standing bag-full warning in step with the bag. Runs before the
  // panel early-return below on purpose: a full bag matters most while the
  // inventory panel is open, which is exactly when the player is looking for
  // something to spend.
  private refreshBagFullWarning(): void {
    const full = isBagFull(getGame().player.inventory);
    if (full === this.bagFullShown) return;
    this.bagFullShown = full;
    this.bagFullText.setVisible(full);
  }

  // ── frame ──────────────────────────────────────────────────────────────
  override update(_time: number, delta: number): void {
    this.refreshTouchControlVisibility();
    this.refreshBagFullWarning();
    // The crowbar is stepped here, above the panel early-return.
    //
    // A fight holds encounterOpen for its whole duration and this method bails
    // out on that flag, so the weapon was only ever synced while walking - which
    // is precisely when it is slung and static. The swing happens in a panel, so
    // it stayed slung across the back through the entire attack.
    this.syncWeapon();
    if (this.stairClimb) {
      this.updateStairClimb(delta);
      return;
    }
    if (this.inventoryOpen || this.craftingOpen || this.dialogueOpen || this.pauseOpen || this.encounterOpen || this.shelterOpen) {
      const panelHint = this.openPanelHint() ?? '';
      this.hintText.setText(panelHint).setVisible(panelHint.length > 0 && !(this.portraitMode && this.bagFullShown));
      if (this.portraitMode) this.fitHudLine(this.hintText, this.portraitWidth - 24);
      return;
    }
    const state = getGame();

    // B3-01 D9: a rejected write used to be silent. Autosave retries every few
    // frames, so warn once per uninterrupted failure period rather than letting
    // each rejected retry restart the same flash indefinitely.
    const failureEpisodes = saveFailureEpisodeCount();
    if (failureEpisodes > this.lastSaveFailureEpisodes) {
      this.lastSaveFailureEpisodes = failureEpisodes;
      this.flash('存档失败：进度不会被保留（浏览器存储不可用）');
    }

    let dir = 0;
    if (this.cursors?.left.isDown || this.wasd?.left.isDown) dir -= 1;
    if (this.cursors?.right.isDown || this.wasd?.right.isDown) dir += 1;
    for (const direction of this.touchDirectionPointers.values()) dir += direction === 'left' ? -1 : 1;
    dir = Phaser.Math.Clamp(dir, -1, 1);
    // The speed is ramped rather than switched, so a tap of the key moves a
    // shorter distance than it used to and the run feels like it has weight.
    // OVERHAUL: an empty energy tank slows the walk (0.75x), so "how far can I
    // get" is budgeted by food and rest. Wave B3's swift-feet relic then makes
    // the corridors 15% shorter. The factors apply to the ramped speed, not to
    // dx, so the anim's speedFraction follows the real walk.
    this.speedX = stepHorizontalSpeed(this.speedX, dir, delta) * moveSpeedFactor(state.player) * moveSpeedMult(state.relics ?? []);
    const dx = this.speedX * (delta / 1000);
    if (dx !== 0) movePlayerX(state, dx);
    this.syncPlayerWorldObjects(state.player.x, STAIR_START_Y);

    // The walk cycle carries all the vertical motion now — the poses' own hip
    // bob, not a sine wave bolted on top. What is left to do here is pick the
    // clip, face it, and lock the playback rate to the actual speed so the feet
    // do not skate while the player is still on the acceleration ramp.
    if (dir !== 0) this.player.setFlipX(dir < 0);
    // OVERHAUL: a one-shot action clip holds the sprite until its timer runs
    // out; the walk/idle pick below only runs once the clip is over.
    if (this.time.now < this.actionAnimUntil && this.player.anims.currentAnim?.key === this.actionAnimKey) {
      // clip still playing
    } else {
      const speedFraction = Math.abs(this.speedX) / PLAYER_SPEED;
      const want = speedFraction > 0.03 ? walkAnimKey('player') : idleAnimKey('player');
      if (this.player.anims.currentAnim?.key !== want) this.player.play(want, true);
      this.player.anims.timeScale = Math.max(0.2, Math.min(1, speedFraction));
    }

    const tick = advanceTime(state, delta);
    const rolled = ensureNightEvent(state);
    if (rolled.rolled && rolled.event) {
      if (rolled.event.type === 'wanderer') playSfx('danger');
      this.flash(rolled.event.message);
    }
    // 首章：停电危机。放在夜晚事件之后、dwell pressure 之前——它要在时间推进
    // 之后才知道要不要跨天过期，又必须早于 dwell 的「单事件槽位」判定，才能
    // 保证自己是独立剧情线、不去抢 `worldEvents.activeEvent`。
    this.syncBlackoutOnTick(state);
    // AI-06：NPC 自主 tick。放在危机同步之后——阶段变了，这一轮才知道该发生
    // 什么。触发与节流都在模块内部判，这里每帧问一次是廉价的（不满足条件就
    // 直接返回，不会调用模型）。
    this.updateNpcAutonomy(state);
    // B3-15: dwell pressure — the longer the player lingers on one floor, the
    // more likely the next roll is teeth. Runs after the night roll so a night
    // event already occupying the day's slot suppresses the prowler (an
    // atmosphere roll can still fire).
    this.updateDwellPressure(state, tick.gameMinutes);
    // OVERHAUL: settle the day's objective the moment its condition holds —
    // reward fires once, with the fanfare, so finishing it feels like an event
    // rather than a silent counter.
    ensureDailyGoal(state);
    // The fanfare fires on the transition, not on the state: grantDailyGoalReward
    // is itself idempotent (a flag guards it), so this only decides whether to
    // make noise. Reading the return value rather than re-deriving the condition
    // keeps the two from drifting apart.
    if (isDailyGoalDone(state) && grantDailyGoalReward(state)) {
      playSfx('goal');
      this.flash('今日目标完成！分数 +' + GAME_CONFIG.overhaul.dailyGoalRewardScore + '，获得口粮×1');
    }
    // The low-HP vignette rides the pulse function every frame.
    // The pulse is a 0..1 heartbeat; each band takes its own share of it so the
    // deep bands saturate while the centre stays clear.
    const pulse = lowHpPulse(state.player.hp, GAME_CONFIG.player.hpMax, this.time.now);
    for (const p of this.vignetteParts) p.rect.setAlpha(pulse * p.weight);
    // STARVING AND PARCHED, ON THE BODY. Hunger and thirst were two numbers in
    // the HUD; the debuff is now on the survivor. The threshold is the same 25%
    // the HUD already uses to call a stat urgent (URGENT_THRESHOLDS in
    // render/feedback.ts), so the body and the interface never disagree about
    // whether the player is in trouble.
    const starving =
      state.player.hunger <= GAME_CONFIG.player.hungerMax * 0.25 ||
      state.player.thirst <= GAME_CONFIG.player.thirstMax * 0.25;
    if (starving && !this.debuffFx) {
      const fx = startFxLoop(this, 'poisoned', state.player.x, PLAYER_FEET_Y - 46, LIGHT_DEPTH + 1);
      if (fx) this.debuffFx = fx;
    } else if (!starving && this.debuffFx) {
      this.debuffFx.destroy();
      this.debuffFx = undefined;
    } else if (this.debuffFx) {
      this.debuffFx.x = state.player.x;
    }
    // Read after ensureNightEvent so an event rolled this very frame counts.
    const event = state.worldEvents.activeEvent;
    this.refreshClock();
    this.refreshStats();
    this.refreshEnvironmentHud();
    // Body heat crosses its thresholds slowly, so the message fires on the
    // transition rather than every frame while cold. It is the floor telling you
    // to move, which is the whole point of the stat.
    if (tick.environment?.becameFreezing) {
      this.flash('体温过低！靠近火源，否则会失温');
      playSfx('danger');
    } else if (tick.environment?.becameCold) {
      this.flash('越来越冷了——这层没有热源');
    } else if (tick.environment?.warmedUp) {
      this.flash('缓过来了');
    }
    // An ailment announces itself on the crossing, not every frame it lasts: the
    // message is news, and news that repeats is noise.
    if (tick.sickness?.critical.length) {
      this.flash(`${AILMENT_LABEL[tick.sickness.critical[0]]}恶化！需要治疗`);
      playSfx('danger');
    } else if (tick.sickness?.worsened.length) {
      this.flash(`你${AILMENT_LABEL[tick.sickness.worsened[0]]}了——状态会掉得更快`);
    } else if (tick.sickness?.recovered.length) {
      this.flash(`${AILMENT_LABEL[tick.sickness.recovered[0]]}好了`);
    }
    this.applyNightLighting();

    // GHI-03 M3: the clock and the survival decay only ever advance here, and
    // nothing else in this loop persisted them — standing still and closing the
    // tab rolled the run back to the last discrete action, and that could be
    // farmed to erase decay. Persist on a coarse game-minute cadence.
    const absolute = absoluteMinute(state);
    if (absolute - this.lastSavedAbsoluteMinute >= AUTOSAVE_EVERY_GAME_MINUTES) {
      this.lastSavedAbsoluteMinute = absolute;
      saveToStorage(state);
    }

    // GHI-03 M5: the night event can start or clear while the player stands on
    // the floor, but floorView was only rebuilt on entering a floor / opening a
    // container / a successful pickup — so a leak left stale ground rectangles
    // and stale pickability behind until the player left and came back.
    if (event !== this.lastActiveEvent) {
      this.lastActiveEvent = event;
      this.floorView = getFloorView(state, state.currentFloor);
      this.rebuildGround();
      // A leak that starts or clears while the player is standing here has to
      // change the floor they are looking at, not wait for a re-entry.
      this.refreshLeakEffect(state.currentFloor);
    }

    if (tick.died || tick.won) {
      saveToStorage(state);
      // AND THEN YOU FALL. Death used to reuse the hurt pose for a single frame
      // and cut straight to the end card, so the run's last moment was the HUD.
      // The survivor now goes down - three frames, 500ms, ending on the fallen
      // pose - and the end card waits for it. Winning still cuts immediately:
      // reaching the top is not a fall.
      if (tick.died) {
        this.playActionAnim(dieAnimKey(this.metaSelectedCharacter()), 520);
        this.time.delayedCall(620, () => {
          if (this.scene.isActive()) this.scene.start('End');
        });
        return;
      }
      this.scene.start('End');
      return;
    }

    this.updateWanderer(delta);
    if (state.status !== 'playing') {
      saveToStorage(state);
      if (state.status === 'lost') {
        this.playActionAnim(dieAnimKey(this.metaSelectedCharacter()), 520);
        this.time.delayedCall(620, () => {
          if (this.scene.isActive()) this.scene.start('End');
        });
        return;
      }
      this.scene.start('End');
      return;
    }

    this.autoPickup();

    // E handles a nearby encounter before any NPC, bed or container. The hint
    // must follow the same priority, and the trader is not a question mark.
    const spot = this.nearestEncounterSpot();
    if (spot) {
      this.setInteractionHint(spot === 'shop' ? '按 E 与行商交易' : '按 E 查看问号点');
      return;
    }

    if (this.nearBed(state)) {
      this.setInteractionHint(isNight(state.gameMinuteOfDay) ? '按 E 安排夜间行动' : '床位 · 20:00 后可安排夜间行动');
      return;
    }
    if (this.nearCraftStation(state)) {
      this.setInteractionHint('按 C 制作');
      return;
    }
    if (this.nearestNpc(state)) {
      this.setInteractionHint('按 E 对话');
      return;
    }
    if (event?.type === 'leak' && state.currentFloor === event.floor) {
      this.setInteractionHint('此地漏水，地面物资受潮');
      return;
    }
    const container = this.nearestContainer();
    const zone = currentInteractionZone(state);
    if (container) this.setInteractionHint(`按 E 打开 ${container.label}`);
    // OVERHAUL Wave C2: advertise the same capped offer that F will purchase.
    else if (zone === 'up' && closedFloorGateForTransition(state, state.currentFloor, state.currentFloor + 1)) {
      this.setInteractionHint('上层维修通道封锁 · 先协助阿林修复门禁');
    }
    else if (zone === 'up') {
      const offer = shortcutOffer(state, Math.max(...PLAYABLE_FLOORS_V01));
      this.setInteractionHint(offer ? `按 E 上楼 · F 抄近路（${offer.price} 金）` : '按 E 上楼');
    }
    else if (zone === 'down') this.setInteractionHint('按 E 下楼');
    else if (
      state.currentFloor === Math.max(...PLAYABLE_FLOORS_V01) &&
      Math.abs(state.player.x - UP_EXIT_X) <= INTERACT_DISTANCE
    ) this.setInteractionHint(`当前开放范围止于第 ${state.currentFloor} 层；右侧楼梯按 E 下行`);
    else this.setInteractionHint('A/D 或 ←/→ 移动 · E 交互 · I 背包 · C 制作 · M 地图 · Q 切换武器外观（仅视觉） · ESC 菜单');
  }

  // The wanderer only haunts its own floor; it is slower than the player and
  // chips HP on a cooldown, so outrunning it or leaving the floor always works.
  // B3-15: a dwell-rolled wanderer acts day or night — the pressure comes from
  // lingering, not from the clock, so gating it on night would let a player
  // idle safely until dark.
  private wandererEventKeyFor(state: GameState, event: ActiveEvent): string {
    return `${state.day}:${event.source ?? 'night'}:${event.floor ?? -1}:${state.worldEvents.dwell?.rolls ?? 0}`;
  }

  private wandererSituation(state: GameState, event: ActiveEvent): WandererSituation {
    const x = this.wanderer?.x ?? (state.player.x < FLOOR_WIDTH / 2 ? FLOOR_WIDTH - 48 : 48);
    const ai = this.wandererAI;
    return {
      eventType: 'wanderer',
      eventSource: event.source ?? 'night',
      eventStatus: eventStatus(event) ?? 'active',
      playerHp: state.player.hp,
      playerX: state.player.x,
      npcX: x,
      distance: Math.abs(x - state.player.x),
      motionState: this.wandererIntent === 'flee' ? 'fleeing' : ai?.state ?? 'stalking',
      lungeMsLeft: ai?.lungeMsLeft ?? 0,
      cooldownMsLeft: ai?.cooldownMsLeft ?? 0,
      recentEncounter: this.wandererLastEncounter || undefined,
    };
  }

  private recordWandererMemory(kind: 'attack' | 'flee' | 'observed' | 'player_attack', summary: string): void {
    if (!aiNpcConfig().enabled) return;
    const state = getGame();
    const next = recordMemory(this.npcStateForWanderer(), {
      day: state.day,
      minute: state.gameMinuteOfDay,
      kind,
      actor: 'player',
      summary,
    });
    saveNpcState(state, 'wanderer', next);
  }

  private npcStateForWanderer(): NpcPersistedState {
    return loadNpcState(getGame(), 'wanderer') ?? createNpcState('hostile');
  }

  private requestWandererIntent(state: GameState, event: ActiveEvent): void {
    const cfg = aiNpcConfig();
    if (!cfg.enabled || eventStatus(event) === 'resolved' || !this.wanderer) return;
    const token = this.wandererAutonomy.begin();
    if (token === null) return;
    const key = this.wandererEventKey;
    const situation = this.wandererSituation(state, event);
    void decideWandererIntent(state, this.npcStateForWanderer(), situation, createWandererDecisionConfig(cfg)).then((decision) => {
      const current = getGame().worldEvents.activeEvent;
      if (!this.wandererAutonomy.isCurrent(token) || !this.wanderer || !current || current.type !== 'wanderer') return;
      if (this.wandererEventKey !== key || getGame().currentFloor !== current.floor || eventStatus(current) === 'resolved') return;
      if (decision.intent === 'flee' || decision.intent === 'attack') {
        this.wandererIntent = decision.intent;
        setEventStatus(current, decision.intent);
        this.wandererLastEncounter = decision.intent === 'flee' ? '它判断继续接近不划算，转身撤退。' : '它判断这里仍然是可攻击窗口。';
      }
    }).finally(() => this.wandererAutonomy.finish(token));
  }

  private resolveWandererFlee(state: GameState, event: ActiveEvent): void {
    setEventStatus(event, 'resolved');
    this.wandererLastEncounter = '巡游体主动撤退，威胁暂时解除。';
    this.recordWandererMemory('flee', this.wandererLastEncounter);
    this.wandererAutonomy.cancel();
    saveToStorage(state);
    this.flash(this.wandererLastEncounter);
  }

  private updateWanderer(delta: number): void {
    const state = getGame();
    const event = state.worldEvents.activeEvent;
    const active =
      event?.type === 'wanderer' &&
      typeof event.floor === 'number' &&
      event.floor >= WANDERER_MIN_SPAWN_FLOOR &&
      eventStatus(event) !== 'resolved' &&
      state.currentFloor === event.floor &&
      (isNight(state.gameMinuteOfDay) || event.source === 'dwell');
    if (!active) {
      if (this.wanderer || this.wandererEventKey) this.wandererAutonomy.cancel();
      if (this.wanderer) {
        this.wanderer.destroy();
        this.wandererGlow?.destroy();
        this.wandererGlow = undefined;
        this.wanderer = undefined;
        this.wandererAI = undefined;
      }
      this.wandererEventKey = '';
      this.wandererIntent = 'attack';
      return;
    }
    const key = this.wandererEventKeyFor(state, event);
    if (!this.wanderer) {
      const spawnX = state.player.x < FLOOR_WIDTH / 2 ? FLOOR_WIDTH - 48 : 48;
      this.wanderer = this.add.sprite(spawnX, PLAYER_FEET_Y, walkSheetKey('wanderer')).setOrigin(0.5, 1).setDepth(ACTOR_DEPTH);
      this.wanderer.play(walkAnimKey('wanderer'));
      this.wandererAI = freshWandererAI(spawnX);
      this.wandererEventKey = key;
      this.wandererIntent = eventStatus(event) === 'flee' ? 'flee' : 'attack';
      this.wandererLastEncounter = '';
      this.wandererGlow = addGlow(this, spawnX, PLAYER_FEET_Y - 8, 34, 0.42, LIGHT_DEPTH);
      if (eventStatus(event) === 'active') this.requestWandererIntent(state, event);
    }
    const ai = this.wandererAI!;
    const previousState = ai.state;
    ai.selfX = this.wanderer!.x;
    if (this.wandererGlow) this.wandererGlow.x = this.wanderer!.x;
    const step = stepWandererAI(ai, state.player.x, delta, this.wandererIntent);
    const toward = Math.sign(state.player.x - this.wanderer!.x);
    const dir = step.direction === 'away-from-player' ? -toward : toward;
    if (dir !== 0) this.wanderer!.x = Math.max(0, Math.min(FLOOR_WIDTH, this.wanderer!.x + dir * WANDERER_SPEED * step.speedMultiplier * (delta / 1000)));
    if (dir !== 0) this.wanderer!.setFlipX(dir < 0);

    if (this.wandererIntent === 'flee') {
      const safe = Math.abs(this.wanderer!.x - state.player.x) >= WANDERER_FLEE_SAFE_DISTANCE;
      const atExit = this.wanderer!.x <= WANDERER_FLEE_EXIT_MARGIN || this.wanderer!.x >= FLOOR_WIDTH - WANDERER_FLEE_EXIT_MARGIN;
      if (safe || atExit) {
        this.resolveWandererFlee(state, event);
        return;
      }
    }

    // Re-open a decision only after an attack cycle reaches cooldown; never
    // issue parallel requests for one event.
    if (this.wandererIntent === 'attack' && previousState !== ai.state && ai.state === 'cooldown') {
      setEventStatus(event, 'active');
      this.requestWandererIntent(state, event);
    }

    const damage = ai.state === 'lunge' ? WANDERER_DAMAGE * 2 : WANDERER_DAMAGE;
    if (this.wandererIntent === 'attack' && ai.state !== 'fleeing' && Math.abs(this.wanderer!.x - state.player.x) <= 12 && this.time.now - this.wandererHitAt >= WANDERER_HIT_COOLDOWN_MS) {
      this.wandererHitAt = this.time.now;
      state.player.hp = Math.max(0, state.player.hp - damage);
      this.recordWandererMemory('attack', `巡游体在第${state.currentFloor}层攻击了玩家，造成${damage}点伤害。`);
      inflict(state, 'wound', ai.state === 'lunge' ? 55 : 30, absoluteMinute(state));
      this.refreshStats();
      this.playActionAnim(hurtAnimKey('player'), 400);
      playSfx('hurt');
      this.flashPlayerHurt();
      this.cameras.main.shake(160, 0.008);
      this.cameras.main.flash(140, 230, 109, 99);
      playFx(this, 'ground-slam', state.player.x, PLAYER_FEET_Y - 6, LIGHT_DEPTH);
      this.flash(`被巡游体击中！HP -${damage}，快回宿舍或换层！`);
      if (state.player.hp <= 0) state.status = 'lost';
    }
  }
}
