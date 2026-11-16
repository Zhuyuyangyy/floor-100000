import Phaser from 'phaser';

import { PALETTE, TEXT, hex } from '../render/palette.ts';
import { playFx, startFxLoop } from '../render/fx';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../core/design';
import { getGame, hasGame, startNewGame } from '../core/session';
import {
  BED_X,
  CRAFT_X,
  DOWN_EXIT_X,
  downExitXFor,
  floorWidthFor,
  roomCountFor,
  environmentFor,
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
  WANDERER_SPEED,
} from '../core/constants';
import {
  completeStairTraversal,
  currentInteractionZone,
  hasDownExit,
  hasUpExit,
  movePlayerX,
  stairBendFor,
  stairMouthZone,
  stairPosition,
  stairStyleFor,
  stairTraversalFor,
  stepHorizontalSpeed,
  tryChangeFloor,
} from '../systems/FloorSystem';
import { getFloorView, lootContainer, lootGround, recordFloorVisit } from '../systems/LootSystem';
import { hasFloorContent } from '../data/floorTemplates';
import { liftDirection, liftOutcome, liftRequirement, nextSegment, prevSegment, skippedFloors } from '../core/segments';
import { crossingSummary } from '../core/worldgen';
import { countItem, isBagFull, removeItem, STAT_LABEL, useConsumable } from '../systems/InventorySystem';
import { canCraft, craft, hasUpgrade, nightOverlayAlpha, purifyWater, recipePreview } from '../systems/CraftingSystem';
import { absoluteMinute, advanceTime, ACTION_COSTS, AUTOSAVE_EVERY_GAME_MINUTES, isNight, spendTime } from '../systems/SurvivalSystem';
import { ensureNightEvent, eventStatus, setEventStatus } from '../systems/EventSystem';
import { armNextRoll, dwellRollDue, ensureDwell, isDwellExempt, rollDwellEvent, tickDwell } from '../systems/dwellPressure';
import { freshWandererAI, stepWandererAI, type WandererAI } from '../systems/wandererAI';
import { ensureDailyGoal, grantDailyGoalReward, isDailyGoalDone } from '../systems/dailyGoals';
import {
  BODY_TEMP_MAX,
  COLD_THRESHOLD,
  bodyTempOf,
  warmthAt,
} from '../systems/EnvironmentSystem';
import { sicknessOf } from '../systems/SurvivalSystem';
import { ailmentLabel, inflict } from '../systems/SicknessSystem';
import {
  backFromScavenge,
  cheerFromItem,
  moraleBandOf,
  moraleLabel,
  witnessTrauma,
} from '../systems/MoraleSystem';
import { recentDiary } from '../systems/DiarySystem';
import { availableShelterActions, finishNight, resolveShelterAction } from '../systems/ShelterSystem';
import { recordDepth, runScore } from '../systems/progress';
import { CHARACTER_NAMES, applyDepth, loadMeta, saveMeta, unlockFromDepth } from '../systems/metaProgress';
import type { CharacterKey } from '../render/artpack';
import { lowHpPulse, mostUrgentStat, moveSpeedFactor } from '../render/feedback';
import { GAME_CONFIG } from '../core/config';
import { ensureGrowth } from '../core/growth';
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
import { resolveRound, playerCombatant, GUARD_ENERGY_RESTORE, type CombatAction, type CombatRound, type Combatant } from '../systems/combat';
import { MONSTERS, applyBehavior, behaviorModifiers, rollMonster } from '../systems/monsters';
import { guardianDamageMult, lootBonus, moveSpeedMult } from '../systems/relics';
import { modeGuardianDamageMult } from '../systems/modes';
import { buy, materialShelf, sell, sellPrice, shopStock } from '../systems/shop';
import { VENTURES, invest, settleInvestments } from '../systems/shop';
import { charge, recordShortcut, shortcutAvailable, shortcutPlan } from '../systems/shortcut';
import { deriveSeed, makeRng } from '../core/rng';
import { addItem } from '../systems/InventorySystem';
import { clearSave, saveFailureCount, saveToStorage } from '../systems/SaveSystem';
import { playSfx } from '../render/audio';
import { applyPanelDepth, buildPanel, createMarker, lockToScreen, HUD_FEEDBACK_DEPTH, PANEL_DEPTH, PANEL_FILL_BANDS, PANEL_FRAME_PIECES, PANEL_SLICE, placeMarker, placeMarkerLeftOf, type PanelObject } from '../render/panels';
import {
  FONT_FAMILY,
  HUD_FOOT_H,
  PANEL_HEADER_H,
  STAT_COLORS,
  TYPE,
  UI,
  buildListRow,
  buildPanelHeader,
  buildPanelWell,
  drawLine,
  drawStatBar,
  fontLineBox,
} from '../render/uiKit';
import { characterKeyForNpc, portraitKey } from '../render/artpack';
import { framedButton, hitRect } from '../render/pointer';
import { drawHazardStripe, drawHudIcon, drawHudPlate, type HudIconName } from '../render/hudSkin';
import {
  estimateTextWidth,
  DIALOG_PADDING,
  DIALOG_PANEL_H,
  DIALOG_PANEL_W,
  DIALOG_PORTRAIT_SIZE,
  DIALOG_PORTRAIT_TOP,
  DIALOG_ROW_COUNT,
  DIALOG_ROW_H,
  DIALOG_ROW_PITCH,
  DIALOG_ROWS_TOP,
  DIALOG_TEXT_LEFT,
  DIALOG_TEXT_W,
  DIALOG_WELL_H,
  DIALOG_WELL_LEFT,
  DIALOG_WELL_TOP,
  DIALOG_WELL_W,
  dialogueGeometry,
} from '../render/dialogueLayout';
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
import { WEAPON_GRIP_X, WEAPON_GRIP_Y, WEAPON_H, WEAPON_KEY, WEAPON_W } from '../render/weapon.ts';
import { itemIconKey } from '../render/itemIcons';
import { containerTextureKey } from '../render/furniture';
import { corridorTint, drawCorridorRoom, drawCrowd, floorKeyFor, placeDoor, placeWindow, wallKeyFor } from '../render/corridors';
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
import { CONTAINER_LABEL_DROP, HUD_LAYOUT, hudClockLabel } from '../render/hudLayout';
import { RECIPES, getRecipe, isPassUpgrade, type RecipeId, type UpgradeId } from '../data/recipes';
import { WALL_DECO } from '../data/wallDeco';
import { NPCS, NPC_FLOOR, getNpc, npcsOnFloor, type BarterOffer, type NpcDef, type NpcId } from '../data/npcs';
import { QUEST_FLAG, QUESTS } from '../data/quests';
import { bumpFlag, clearFlag, flagCount, hasFlag, setFlag } from '../systems/WorldFlags';
import { availableOffers, claimGift, executeBarter, giftOffer, receiveGift, reputationOf } from '../ai/npcEconomy';
import { stockOf, syncNpcInventory } from '../ai/npcInventory';
import { npcAutonomyFor, type NpcAutonomyView } from '../ai/npcSchedule';
import { aiNpcConfig, archetypeForNpcId, npcFactFor } from '../ai/config';import { OllamaBrain } from '../ai/brains/ollamaBrain';
import { OptionTreeBrain } from '../ai/brains/optionTreeBrain';
import { createNpcState } from '../data/npcPersonalities';
import { loadNpcState, recordMemory, saveNpcState } from '../systems/NpcMemory';
import { decideNpcAction, isDialogueFresh, type DialogueSession, type NpcRuntimeConfig } from '../systems/NpcRuntime';
import {
  decideWandererIntent,
  planNightWanderer,
  planWandererVendetta,
  WandererAutonomyController,
  WandererFallbackBrain,
  type WandererIntent,
  type WandererSituation,
} from '../systems/NpcAutonomy';
import type { NpcPersistedState } from '../ai/types';
import type { ActiveEvent, GameState, GeneratedContainer, GeneratedFloor, ItemId, ShelterAction } from '../core/gameTypes';

const INVENTORY_SLOTS = 12;
// Row pitch for the inventory list: 20px fits a full-size 16x16 icon with a 2px
// gap either side, and keeps every offset an integer (no scaling, no blur).
// Crafting rows: the pitch is the font's line box, not a hand-tuned number.
// It used to be 24, which was tuned for the 1.1em-era face; GameSans draws a
// 24px label as a 30px line box, so at 24 the adjacent rows printed 6px through
// each other (AG-24 measured 10 colliding pairs in font.spec.ts:165 — the
// overlap was 20% of the smaller box, well past the 15% threshold). Deriving it
// from fontLineBox() means the next font swap cannot rot it again.
const CRAFT_ROW_PITCH = fontLineBox(TYPE.body);
// One row per recipe. This used to be a hard-coded 4, which was fine while the
// workbench had three recipes and a purify entry — the pass chain adds five more,
// and a fixed four rows would have let the selection walk off the bottom of the
// list (Enter would have crafted an entry nobody could see).
// AG-武器分支：配方从 9 条涨到 13 条（+四件武器），全部铺开需要
// 30 + 13×30 + 12 + 200 + 40 = 672px，超出「720 画布 - HUD 60 - foot 40」的
// 620 可用区。列表因此是滚动窗口：只画 CRAFT_VISIBLE_ROWS 行，选择走出窗口
// 时 refreshCraft 的 first 滑动（那套逻辑 AG-44 接入时就有，见 refreshCraft
// 的 first = Math.max(0, Math.min(...))）。10 行 = 582px 面板，居中后
// top=69 清开 HUD 带、bottom=651 清开 foot 带。
const CRAFT_VISIBLE_ROWS = 10;
// AG-44：详情块（效果/档位/去哪拿）的垂直预算。最坏流：效果 2 行（加固门的
// effect 在 494px 栏宽里换行）+ 档位/前置 1 行 + 缺料 hints 4 行（三样料、
// 每条三列出处）= 7 行 × fontLineBox(caption) = 175，加两块间距 12，余量给
// Phaser 真实换行比 wrapText 估计多咬一行的情形。这是行数预算不是魔法数字：
// 改动文案后先跑 e2e/ag44-scene-wire.spec.ts 量真实 bounds。
const CRAFT_DETAIL_H = 200;
/** 详情块三行之间的透气。 */
const CRAFT_DETAIL_GAP = 6;
// AG-20：终局层（统治核心）。这一层的三个容器是终局演出入口
// （docs/plans/FINALE_UX.md §2 契约，EndgameScene 归 AG-21）。
const FINALE_FLOOR = 100000;
// TWOM 对齐 §1：疾病三档的 HUD 用语。healthy 不进读数——没病不需要占位。
const SICKNESS_TIER_LABEL: Record<string, string> = {
  sick: '患病',
  critical: '病危',
};
// AG-20: 产业累计收益的账本标记。存在 state.flags（WorldFlags 的平地）而不是
// 场景字段里：存档因此携带整个账本，读档后面板的「累计」读数不断档。结算本身
// 由系统层的水位标记 economy:settled-day 把关，场景只把观察到的收益累加到这里。
const VENTURE_INCOME_FLAG = 'economy:venture-income-total';
// 产业结算 flash 的延后时长：跨日那一帧的 flash 位被夜间事件播报占着
// （ensureNightEvent 在同一帧 flash 今夜的遭遇），1700ms 接在它 1600ms
// 的寿命之后，两条因此都看得见。
const VENTURE_FLASH_DELAY_MS = 1700;
// HUD type scale (docs/05_ART_GUIDE.md §2: no size too small to read). Title 16 /
// body 13 / auxiliary 11 — all integer pixels, since any fractional size would be
// resampled and blur the pixel look.
const TYPE_BODY = 26;
const TYPE_AUX = 22;

// ── 货运电梯 ────────────────────────────────────────────────────────────────
// The lift stands beside the down stairwell (x=1240) on the top floor of a
// segment. 1165 is measured, not chosen: the door is 52 wide (1139..1191), the
// last container's label ends near 1113 and the stair treads begin at 1225, so
// 1165 is the only centre that clears both. The reach is 30 rather than the
// shared 44 so its band (1135..1195) does not overlap either the container's
// (1036..1124) or the stairwell's (1196..1284): E never has two meanings here.
/** Floors that are sleeping quarters rather than workplaces: they get the bed row. */
const SLEEPING_FLOORS = new Set([101, 104, 109]);

/** Container name size, shared by the text and its backing plate. */
const CONTAINER_LABEL_FONT = 22;
/**
 * The player-proximity fade, in px before INTERACT_DISTANCE.
 *
 * The label band crosses the player's head and shoulders (figure spans
 * y 64..160), and the player stands AT the container's x, so no position keeps
 * the plate off the figure — measured overlap at the old spot: 19px vertically
 * across the plate's full width. The name yields instead of moving: it fades
 * out over the last 24px of approach and back in on the way out, which is also
 * when the foot bar starts reading "按 E 打开 储物柜" — the name is on screen
 * exactly when it is actionable, and never under the player's chin.
 * Distance-proportional rather than a hard cut so walking past does not pop.
 * (The drop itself lives in render/hudLayout as CONTAINER_LABEL_DROP.)
 */
const CONTAINER_LABEL_FADE_PX = 24;
/**
 * AG-11: NPC 名签的 y——居民头顶上方一个 CONTAINER_LABEL_DROP。
 * 容器是 28px 的矮道具，「基座-36」落在道具正面；居民是 96px 的立绘
 * （脚在 PLAYER_FEET_Y，头在 PLAYER_FEET_Y-FRAME_H），同一个 DROP 只能从
 * 头顶算，否则名签压在角色身上（旧位置 y=FLOOR_HEIGHT-68=132，正在躯干上）。
 */
const NPC_LABEL_Y = PLAYER_FEET_Y - FRAME_H - CONTAINER_LABEL_DROP;
/**
 * One fade listener per scene, replaced on every floor build. Registering per
 * build without removing the previous one stacks listeners that all drive the
 * NEW floor's labels from stale closures; clearFloor() destroys the objects but
 * nothing would remove the handler. A WeakMap so a scene restart cannot leak.
 */
const CONTAINER_LABEL_FADERS = new WeakMap<Phaser.Scene, () => void>();

const LIFT_X = 1165;
const LIFT_REACH = 30;
const LIFT_SIGN_Y = 46;
const LIFT_SIGN_FONT = 18;

const WANDERER_FLEE_SAFE_DISTANCE = 280;
const WANDERER_FLEE_EXIT_MARGIN = 24;

// Row pitch for the four HUD stat bars. 15px gives an 11px label plus a 7px bar
// with breathing room; 13px was too cramped to read at a glance.

const STAT_BARS: Array<{ key: 'hp' | 'hunger' | 'thirst' | 'energy'; label: string; color: number; icon: HudIconName }> = [
  { key: 'hp', label: '生命', color: 0xe56d63, icon: 'cross' },
  { key: 'hunger', label: '饥饿', color: 0xf4b66a, icon: 'hunger' },
  { key: 'thirst', label: '口渴', color: 0x6aa8e5, icon: 'thirst' },
  { key: 'energy', label: '精力', color: 0x77c6a4, icon: 'energy' },
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
type GameKey = 'e' | 'esc' | 'i' | 'enter' | 'c' | 'm' | 's' | 'f' | 'q' | 'l' | 'g' | 'up' | 'down';
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
// The two bed rows of a dorm floor, as floor-space x positions.
//
// Floor 1's front row is pitched at 96 and clear of the three things already
// standing on that floor: the cabinet (160), the workbench (480) and the
// player's own bed (1120). The back row sits half a pitch offset from the front
// one, which is what stops the two rows reading as one long row.
const DORM_FRONT_BEDS: readonly number[] = [236, 332, 428, 588, 684, 780, 876, 972];
const DORM_BACK_BEDS: readonly number[] = [268, 372, 640, 744, 848];

// Floor 2 is the neighbours' dorm and gets the same treatment: the back row is
// identical, and the front row is one bed wider at the left end. The cabinet
// that keeps floor 1's first bed at 236 does not exist here, so the only thing
// to clear on the left is the up stair (40) — hence 140. The right end stops
// where floor 1's does, because the shelf (1120) and the down stair (1240) sit
// there instead of the player's bed.
const NEIGHBOUR_FRONT_BEDS: readonly number[] = [140, ...DORM_FRONT_BEDS];

export class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  /** The crowbar in the survivor's hand. Follows the attack pose's fist. */
  private weapon?: Phaser.GameObjects.Image;
  private cursors!: DirKeys;
  private wasd!: { left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key };
  private keyE!: Phaser.Input.Keyboard.Key;
  private keyEsc!: Phaser.Input.Keyboard.Key;
  private keyI!: Phaser.Input.Keyboard.Key;
  private keyEnter!: Phaser.Input.Keyboard.Key;

  private floorView!: GeneratedFloor;
  private containerObjs = new Map<string, { box: Phaser.GameObjects.Graphics | Phaser.GameObjects.Image; label: Phaser.GameObjects.Text; plate: Phaser.GameObjects.Rectangle }>();
  // AG-11: the neighbours on the NPC floor: sprite, shadow, name plate and name,
  // kept so syncNpcs can walk them along their schedule every frame.
  private npcObjs = new Map<string, { who: CharacterKey; sprite: Phaser.GameObjects.Sprite; shadow: Phaser.GameObjects.GameObject[]; label: Phaser.GameObjects.Text; plate: Phaser.GameObjects.Rectangle }>();
  private groundObjs = new Map<string, Phaser.GameObjects.Rectangle>();
  private floorObjects: Phaser.GameObjects.GameObject[] = [];
  private wanderer?: Phaser.GameObjects.Sprite;
  /** the dim red pool that makes the wanderer findable in the dark */
  private wandererGlow?: Phaser.GameObjects.Image;
  /** the hunger/thirst debuff on the player's body, present only while critical */
  private debuffFx?: Phaser.GameObjects.Sprite;
  /** every flame on this floor, so a blackout can put them out */
  private lightFixtures: Phaser.GameObjects.Sprite[] = [];

  // Length of the floor currently drawn. Tiers have different lengths (see
  // floorWidthFor), so nothing may assume FLOOR_WIDTH: the camera bounds, the
  // wall tiling, the room loop and the stair mouths all read these two.
  private floorW = FLOOR_WIDTH;
  private downExit = DOWN_EXIT_X;
  /** Set when a stair climb lands, so the camera can ease instead of snapping. */
  private landingEase = false;
  private wasBlackout = false;
  private blackoutAt = 0;
  private wandererHitAt = Number.NEGATIVE_INFINITY;
  // TWOM 对齐 §2：这一趟出门拿到多少件。回宿舍时按它结算士气（满载而归 vs
  // 空手而归）。只在开箱与战斗掉落处累加，落地 1F 时清零。
  private lootThisTrip = 0;
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
  // M1-1: the standing camera bounds of the drawn floor, remembered so a climb
  // can widen them and the landing can put them back. drawFloor owns the
  // standing values; these are only a mirror of the last setBounds call.
  private standingCamBounds?: { top: number; bottom: number };
  // OVERHAUL: a one-shot action clip (search / attack / hurt) and the time it
  // holds the sprite. Without the hold, the walk/idle selection below would
  // switch back on the very next frame and the clip would never be seen.
  private actionAnimKey = '';
  private actionAnimUntil = 0;

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
  // The environment row is four chips, one per reading, each with its own icon:
  // 体温值 / 区域 / 潮湿 / 夜间危险. They used to be one string, which meant one
  // icon's worth of meaning for four unrelated facts.
  private environmentText?: Phaser.GameObjects.Text;
  private envRegionText?: Phaser.GameObjects.Text;
  private envHumidText?: Phaser.GameObjects.Text;
  private envNightText?: Phaser.GameObjects.Text;
  private hudIcons?: Phaser.GameObjects.Graphics;
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
  // OVERHAUL Wave C1: the shop panel's cursor. AG-20: one cursor over BOTH
  // shelves — the trader's stock and the material shelf — so Enter buys and S
  // sells whatever row is highlighted, whichever shelf it came from.
  private shopRows: Array<{ kind: 'stock' | 'material'; itemId: ItemId; price: number }> = [];
  private shopSelected = 0;

  // AG-20: the venture ledger (产业投资面板). Reads VENTURES / invest /
  // settleInvestments from systems/shop.ts; the day's settlement itself is
  // fired by the clock (SurvivalSystem's day-rollover paths), and the scene
  // only OBSERVES the ledger around every time-advancing call so the panel
  // can show 已投入 / 昨日收益 / 累计 — see diffVentureLedger. The scene
  // never settles around the watermark; it only reads what the clock paid.
  private ventureOpen = false;
  private ventureSelected = 0;
  private ventureObjects: PanelObject[] = [];
  private ventureMarker!: Phaser.GameObjects.Image;
  /** 最近一次产业结算的读数（由 diffVentureLedger 在时钟推进后对比账本得出）。 */
  private lastVentureDay = 0;
  private lastVentureIncome = 0;
  private lastVentureCollapsed: string[] = [];
  // First-floor shelter decision panel: the cursor is visual state, while the
  // selected action itself is committed through ShelterSystem.
  private shelterOpen = false;
  private shelterSelected = 0;
  private shelterObjects: PanelObject[] = [];
  private shelterMarker!: Phaser.GameObjects.Image;
  private feedbackTimer?: Phaser.Time.TimerEvent;
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
  private craftRows: Array<{ band: Phaser.GameObjects.Rectangle; name: Phaser.GameObjects.Text; status: Phaser.GameObjects.Text }> = [];
  private craftMarker!: Phaser.GameObjects.Image;
  /**
   * AG-44：选中行的详情块（原 craftReqText 单行「前置：X」的位置）。三行各司其职：
   * effect 是「做出来会怎样」（recipePreview.effect），tier 是档位读数 + 前置
   * （recipePreview.tierNote + requires），hints 是缺料时的「去哪拿」
   * （canCraft().hints）。数据全部来自 AG-42 的 CraftingSystem，场景只排版。
   */
  private craftDetailTexts!: {
    effect: Phaser.GameObjects.Text;
    tier: Phaser.GameObjects.Text;
    hints: Phaser.GameObjects.Text;
  };
  /** 详情块第一行的 y（buildCraftPanel 时算定，refreshCraft 流式排布用）。 */
  private craftDetailY = 0;
  private craftSelected = 0;
  // 当前滚动窗口的首个配方下标。鼠标悬停/点击拿到的是槽位 i，真实条目是
  // craftFirst + i——AG-44 接入时槽位即条目（列表短于窗口），配方涨到 13 条
  // 后这个换算是必须的，否则滚动态下悬停第 3 行选中的是第 3 条而不是第 3+first 条。
  private craftFirst = 0;
  // 行商巡逻的 loop timer。buildEncounterSpots 每次楼层重建都会新建一个，
  // clearEncounterSpots 必须 remove 掉——爬梯走 clearFloor（同场景重建，不是
  // scene.restart），旧 timer 活着而旧 trader 已 destroy，回调打上去就是
  // `Cannot read properties of undefined (reading 'play')`，异常还会把爬梯
  // 落地流程打断（e2e firstChapter：卡在 4 层上不去 5）。
  private traderPatrolTimer?: Phaser.Time.TimerEvent;
  private nightOverlay!: Phaser.GameObjects.Rectangle;
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
  /** AG-11: Q opens the quest panel (QuestPanelScene, owned by AG-12). */
  private keyQ!: Phaser.Input.Keyboard.Key;
  private keyL!: Phaser.Input.Keyboard.Key;
  /** AG-20: G opens the venture ledger (产业投资面板). */
  private keyG!: Phaser.Input.Keyboard.Key;
  /** The quests:changed subscription survives a Game restart; the panel scene does not restart. */
  private questsEventBound = false;

  private dialogueOpen = false;
  // sessionId/revision：AI 异步返回的保鲜键。玩家每次开对话 sessionId+1，
  // 每次操作 revision+1；过期 AI 结果不得覆盖新对话（P1-2）。
  private dialogueSessionSeq = 0;
  private dialogue: { npc: NpcId; level: 'main' | 'trade' | 'gift'; selected: number; message: string; lineToggle: number; sessionId: number; revision: number } | null = null;
  /**
   * AG-20: 赠礼层的选项窗口平移。对话只有四行，而背包可能有十几格——赠礼
   * 列表因此与制作面板同宗：窗口跟着光标滑（dialogueViewOffset 是视图第 0
   * 行对应的扁平下标）。主菜单/交易层不滑动，恒为 0。
   */
  private dialogueViewOffset = 0;
  // feat/ai-npc-spark-integration：每个 NPC 一个运行时（降级脑的台词是该
  // NPC 自己的问候语）。未配置模型时整个 Map 为空，行为与改造前一致。
  private aiRuntimes = new Map<string, NpcRuntimeConfig>();
  private dialogueObjects: PanelObject[] = [];
  /** one selection band per dialogue row, toggled in refreshDialogue */
  private dialogueBands: Array<{ band: Phaser.GameObjects.Rectangle; rule: Phaser.GameObjects.Rectangle }> = [];
  /**
   * One mouse hit target per row. Kept as a field because the rows MOVE: an AI
   * opening line can be five lines, dialogueGeometry pushes rowsTop down, and a
   * hit rect left at the base y then highlights row i while accepting a click
   * meant for row i-1 (measured: 3px hover miss, clicks one row low at 5 lines).
   * refreshDialogue re-places these alongside the bands.
   */
  private dialogueRowHits: Phaser.GameObjects.Rectangle[] = [];
  /** the wall-fixture close-up (key L): built per open, like the shelter panel */
  private decoOpen = false;
  private decoIndex = 0;
  private decoObjects: PanelObject[] = [];
  private dialogueTitle!: Phaser.GameObjects.Text;
  private dialoguePortrait!: Phaser.GameObjects.Image;
  private dialoguePortraitFrame!: Phaser.GameObjects.Rectangle;
  private dialogueMessage!: Phaser.GameObjects.Text;
  private dialogueOptions: Phaser.GameObjects.Text[] = [];
  private dialogueOptionIcons: Phaser.GameObjects.Image[] = [];
  private dialogueMarker!: Phaser.GameObjects.Image;
  // Re-layout handles for the adaptive panel. The well, the four rows, the
  // footer and the panel's own skin are all built once at the BASE geometry and
  // then re-placed per message by refreshDialogue (dialogueGeometry) — never
  // rebuilt, because destroying and re-adding them per keystroke is what made
  // the dialogue flicker before the geometry was extracted.
  /** buildPanel's return: [fill x PANEL_FILL_BANDS, frame x PANEL_FRAME_PIECES]. */
  private dialoguePanelParts: PanelObject[] = [];
  /** buildPanelHeader's return: [strip, accent rule, title text, hairline graphics]. */
  private dialogueHeaderParts: PanelObject[] = [];
  private dialogueWellFill!: Phaser.GameObjects.Rectangle;
  private dialogueWellEdge!: Phaser.GameObjects.Graphics;
  private dialogueFooter!: Phaser.GameObjects.Text;

  private pauseOpen = false;
  // Mouse state. `walkTarget` is the click-to-walk order the update loop steps
  // toward; `panelBox` is the rectangle of the most recently built panel, so a
  // click outside it can close the panel the way ESC does.
  private walkTarget: { x: number; interact: boolean } | null = null;
  // The dorm's sleeping roommates: the floating Z is animated from update(), so it
  // lives here rather than in a tween that would outlive the floor it belongs to.
  private dormSleepers: Array<{ z: Phaser.GameObjects.Text; baseY: number; phase: number }> = [];
  private panelBox: { x: number; y: number; w: number; h: number } | null = null;
  private hudButtons: Phaser.GameObjects.GameObject[] = [];
  private readonly pointerHandler = (pointer: Phaser.Input.Pointer, currentlyOver?: unknown[]): void =>
    this.onPointerDown(pointer, currentlyOver ?? []);
  private pauseObjects: PanelObject[] = [];
  private pauseOptionTexts: Phaser.GameObjects.Text[] = [];
  private pauseMarker!: Phaser.GameObjects.Image;
  private pauseSelected = 0;
  private lastSavedAbsoluteMinute = Number.NEGATIVE_INFINITY;
  // B3-01 D9: last save-failure count we already warned about. Survives a scene
  // restart on purpose — the page's storage is still broken after 重新开始, so
  // warning again would be right, and the counter has not moved.
  private lastSaveFailures = 0;
  private lastActiveEvent: ActiveEvent | null = null;
  // Per-frame input guard (GHI-03 m9). Phaser can deliver one DOM keydown
  // several times inside a single frame when several keys land in the same queue
  // drain, so every menu action has to be accepted at most once per frame —
  // otherwise one ArrowDown moves the pause selection two entries and the
  // player lands on 重新开始 when they asked for 塔楼地图.
  private lastInputFrame: Record<GameKey, number> = { e: -1, esc: -1, i: -1, enter: -1, c: -1, m: -1, s: -1, f: -1, q: -1, l: -1, g: -1, up: -1, down: -1 };

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
    this.lastInputFrame = { e: -1, esc: -1, i: -1, enter: -1, c: -1, m: -1, s: -1, f: -1, q: -1, l: -1, g: -1, up: -1, down: -1 };
    // Field initialisers do not re-run, so the HUD's cached visibility has to be
    // re-derived against the fresh bag of a restarted run.
    this.bagFullShown = false;

    // Every builder below only pushes into these, and field initialisers do not
    // re-run on scene restart. Without the reset, 重新开始 left them holding the
    // previous run's destroyed objects, so refreshInventory() / togglePause()
    // wrote to dead objects and both panels came up empty.
    this.floorObjects = [];
    this.containerObjs.clear();
    this.npcObjs.clear();
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
    this.dialogueOptions = [];
    this.dialogueOptionIcons = [];
    this.dialogueMarker = createMarker(this);
    this.shelterObjects = [];
    this.shelterMarker = createMarker(this);
    this.ventureObjects = [];
    this.ventureMarker = createMarker(this);
    // 重新开始 runs while the pause menu is still open, and these flags survive a
    // restart. Left set, update() early-returns forever and every panel handler
    // refuses to run, so the restarted game looks frozen.
    this.inventoryOpen = false;
    this.invSelected = 0;
    this.craftingOpen = false;
    this.craftSelected = 0;
    this.dialogueOpen = false;
    this.dialogue = null;
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

    // AG-11: QuestPanel 的回报通道（UI.md「quests:changed」契约，AG-12）：
    // 面板 emit 到 **Game 场景自己的 emitter**（载荷 { questId, branchId }）——
    // scene events 挂在 Scene 对象上与运行状态无关，overlay/launch 与 handoff/start
    // 两种打开方式都收得到。面板自己不写 GameState（quests.ts 顶部分工），后果
    // 由这里落地：flag、物品、凭证、分数，外加 accepted/branch/done 三个生命周期旗。
    // 同步落地后面板直接重读 evaluateAllQuests，无需重开就反映后果。
    // 幂等：旗已在 → 不重复落地。绑定每局一次（面板场景比 Game 重启活得久，
    // 重复绑定会叠加保存）。
    if (!this.questsEventBound) {
      this.questsEventBound = true;
      this.events.on('quests:changed', (payload: { questId?: unknown; branchId?: unknown }) => {
        if (!hasGame()) return;
        const state = getGame();
        // 用 find 而不是 getQuest：后者对未知 id 抛错，而事件来自另一个场景，
        // 载荷永远不可全信——坏 id 当没发生处理，不把面板搞崩。
        const quest = typeof payload?.questId === 'string' ? QUESTS.find((q) => q.id === payload.questId) : undefined;
        const branch = quest?.branches.find((b) => b.id === payload?.branchId);
        if (!quest || !branch) return;
        if (hasFlag(state, QUEST_FLAG.branch(quest.id, branch.id))) return; // 确认过一次
        setFlag(state, QUEST_FLAG.accepted(quest.id));
        setFlag(state, QUEST_FLAG.branch(quest.id, branch.id));
        for (const c of branch.consequences) {
          switch (c.kind) {
            case 'setFlag':
              setFlag(state, c.flag);
              break;
            case 'clearFlag':
              clearFlag(state, c.flag);
              break;
            case 'giveItem':
              addItem(state.player.inventory, c.itemId, c.count);
              break;
            case 'takeItem':
              removeItem(state.player.inventory, c.itemId, c.count);
              break;
            case 'grantPass':
              // 与 craft() 同一落点：凭证就是 homeUpgrades 的一条，不额外写 upg: flag。
              if (!state.player.homeUpgrades.includes(c.pass)) state.player.homeUpgrades.push(c.pass);
              break;
            case 'score':
              if (!state.records) state.records = { deepestFloor: state.currentFloor, bestScore: 0 };
              state.records.bestScore += c.delta;
              break;
          }
        }
        // 目标齐了 → done（doneFlag 由玩法过程写入，这里只做收口）。
        if (quest.objectives.every((o) => hasFlag(state, o.doneFlag))) {
          setFlag(state, QUEST_FLAG.done(quest.id));
        }
        saveToStorage(state);
        this.refreshInventory();
      });
    }

    if (getGame().day === 1) {
      this.flash('目标：从第 1 层一路爬到第 100000 层。A/D 移动 · E 交互 · I 背包 · C 制作 · M 地图');
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // cameras.main can be null during teardown (Phaser 4 shutdown gotcha).
      this.cameras.main?.stopFollow();
      this.feedbackTimer?.remove(false);
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
    this.floorW = floorWidthFor(floor);
    this.downExit = downExitXFor(floor);
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
    // Only floors that were actually authored. The cross-section used to draw
    // every numeric neighbour, so standing on 100 painted floors 99 and 98 as lit
    // rooms with their own lamps — rooms that do not exist, in a stretch the
    // design says is empty. The gap now reads as empty, which is the whole point
    // of saying the other 89 floors are skipped.
    for (let d = 1; d <= STACK_ABOVE; d++) {
      const f = floor - d;
      if (f >= lowest && hasFloorContent(f)) this.drawNeighbourFloor(f, -FLOOR_HEIGHT * d, true, d);
    }
    for (let d = 1; d <= STACK_BELOW; d++) {
      const f = floor + d;
      if (f <= highest && hasFloorContent(f)) this.drawNeighbourFloor(f, FLOOR_HEIGHT * d, false, d);
    }
    this.drawExits(floor);
    // After the exits: the door is drawn over the wall dressing, and it stands
    // beside the stairwell rather than in front of it.
    this.drawLift(floor);
    this.drawDormBunks(floor);
    this.buildContainers();
    this.buildGround();
    if (floor === STARTING_FLOOR) {
      this.drawBed();
      this.drawWorkbench();
    }
    // AG-46：楼层过滤从 NPC_FLOOR 常量改成 npcsOnFloor(floor)——首章五位
    // 发布者（10/110/1010/10010 层）因此真的会出现在自己层上。2 层 additionally
    // 摆两排邻居宿舍的床（唯一"有人没家具"的楼层），这段与 NPC 无关，保持原样。
    if (npcsOnFloor(floor).length > 0) {
      this.drawNpcs(floor);
      if (floor === NPC_FLOOR) {
        // The neighbours' dorm gets the same two rows as the player's own floor.
        // It was the only floor with people in it and no furniture for them:
        // two NPCs standing in an empty corridor. The beds go in after the NPCs
        // so the walk sheets (ACTOR_DEPTH) keep drawing over the mattress.
        this.drawDormBeds(NEIGHBOUR_FRONT_BEDS, DORM_BACK_BEDS);
      }
    }
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
    // The crowbar goes in before the first sync so the survivor is armed from
    // the frame the floor appears, not from the first step. Its depth is set by
    // syncWeapon (behind the figure when slung, in front when swung).
    this.weapon?.destroy();
    this.weapon = this.add
      .image(state.player.x, PLAYER_FEET_Y - 54, WEAPON_KEY)
      .setOrigin(WEAPON_GRIP_X / WEAPON_W, WEAPON_GRIP_Y / WEAPON_H)
      .setDepth(ACTOR_DEPTH - 1);
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
    cam.setZoom(FLOOR_VIEW_ZOOM);    // The bounds are per-floor, not global. On the bottom floor there is nothing
    // above it, so the camera must not be allowed to scroll up into the void —
    // a global bound let it, and the bottom floor showed 200px of empty black
    // over the dorm. Same at the top of the tower looking down.
    //
    // The bottom floor's ceiling is the HUD, not the floor band: the wall art is
    // 128 tall (y 8..136) and the plate is 102, so stopping at -FLOOR_BAND(-64)
    // still clipped the wall's top 34px. Stopping at -contextBottom puts the
    // wall's first row exactly under the plate. Floors with neighbours above keep
    // the old bound — they are scrolled for the cross-section, not for the HUD.
    const topBound = floor <= PLAYABLE_FLOORS_V01[0] ? -Math.max(FLOOR_BAND, HUD_LAYOUT.contextBottom) : -FLOOR_HEIGHT * (STACK_ABOVE + 1);
    const bottomBound =
      floor >= PLAYABLE_FLOORS_V01[PLAYABLE_FLOORS_V01.length - 1]
        ? FLOOR_HEIGHT + FLOOR_BAND
        : FLOOR_HEIGHT * (STACK_BELOW + 2);
    // The world width equals the design viewport width. Locking the horizontal
    // bounds to one floor keeps the full corridor visible when the player lands
    // at x=40 or x=1240; only the tower's vertical cross-section may scroll.
    cam.setBounds(0, topBound, this.floorW, bottomBound - topBound);
    this.standingCamBounds = { top: topBound, bottom: bottomBound };
    const centreY = Math.max(topBound + 180, Math.min(bottomBound - 180, PLAYER_FEET_Y - FLOOR_HEIGHT * 0.5));
    if (this.landingEase) {
      // Landing used to snap: setBounds clamps the scroll the instant the climb
      // bounds come off, so a descent jumped 104px in one frame. Ease into the
      // standing position over 220ms instead, then hand the follow back.
      this.landingEase = false;
      const fromY = cam.scrollY;
      cam.stopFollow();
      cam.centerOn(state.player.x, centreY);
      const toY = cam.scrollY;
      cam.setScroll(cam.scrollX, fromY);
      this.tweens.add({
        targets: cam,
        scrollY: toY,
        duration: 220,
        ease: 'Sine.easeOut',
        onComplete: () => cam.startFollow(this.player, true, 0.15, 0.15),
      });
      return;
    }
    cam.startFollow(this.player, true, 0.15, 0.15);
    // Centred on the player the moment the floor is drawn: a follow with
    // lerp 0.15 takes a third of a second to catch up, and during that time the
    // camera is still wherever the previous floor left it.
    cam.centerOn(state.player.x, centreY);
  }

  // ── M1-1: the climb's camera room ────────────────────────────────────────
  // A stair rises a full FLOOR_HEIGHT, and Phaser clamps the follow to the
  // camera bounds (Camera.preRender -> clampY). The standing bounds are tuned
  // for STANDING: on floor 1 they leave one FLOOR_BAND of headroom above the
  // dorm, on the top floor one below the penthouse. A climber needs a whole
  // floor more than that. Measured before the fix: the 1->2 climb pinned
  // scrollY at -64 for all 55 sampled frames and the survivor's head crossed
  // the top of the viewport by 69.6px; the 50010->50009 descent pinned at
  // -456 and the feet crossed the bottom by 96px. The bounds are widened in
  // the climb direction by exactly the room the follow needs to keep the
  // climber centred at the far end of the rise — no more, so the void above
  // the dorm still stays hidden while standing. drawFloor resets them on the
  // landing; the refused-landing path resets them by hand.
  private openClimbCameraRoom(direction: 1 | -1): void {
    const cam = this.cameras.main;
    const standing = this.standingCamBounds;
    if (!standing) return;
    // Hold the frame. The climb used to keep following the climber, which meant
    // the floor they were leaving slid out of the viewport and the stairs read as
    // a black slide upward: you never saw where you came from or where you were
    // going.
    //
    // Now the camera stops where it is — the cross-section already shows the
    // floor above and the floor below — and only the climber moves inside that
    // frame. The landing puts the follow back (drawFloor) and the refused
    // landing puts it back by hand (resetCameraBounds).
    cam.stopFollow();
    cam.setBounds(0, standing.top, this.floorW, standing.bottom - standing.top);
    void direction;
  }

  /** Put the standing bounds back (a refused landing leaves the player put). */
  private resetCameraBounds(): void {
    const cam = this.cameras.main;
    const standing = this.standingCamBounds;
    if (!standing) return;
    cam.setBounds(0, standing.top, this.floorW, standing.bottom - standing.top);
    // The climb stopped the follow; a refused landing must hand it back or the
    // camera stays parked where the climb began.
    cam.startFollow(this.player, true, 0.15, 0.15);
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
    // The Zzz texts were floor objects; a stale reference here would animate a
    // destroyed Text after the next floor change.
    this.dormSleepers = [];
    // The crowbar went with the floor; drop the reference so drawFloor builds a
    // new one instead of trying to reuse a destroyed image.
    this.weapon = undefined;
    for (const shadow of this.playerShadow) shadow.destroy();
    this.playerShadow = [];
    this.speedX = 0;
    this.containerObjs.clear();
    this.npcObjs.clear();
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
      // 0 rad points right and grows clockwise; the pose's angle is measured from
      // straight down, so facing right is a quarter turn. Facing left the bar has
      // to point the other way, which is a half turn more - NOT a negated angle.
      // setFlipX does not help here: it mirrors the texture inside a frame that
      // still occupies the same 46 pixels to the right of the origin, so a
      // mirrored weapon on a left-facing survivor stayed across the body.
      const rot = Math.PI / 2 - (swing * Math.PI) / 180;
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
    //
    // The offsets are tuned to the POSE, not to the character. They were set for
    // the old procedural walk, which leaned forward with the near arm out at
    // chest height; the painted v5.2 walk stands upright with both arms hanging,
    // so the same -56 put the grip in empty air above the hand. -40 drops it to
    // where that hand actually is. If the walk pose changes again, this number
    // changes with it - a fixed offset cannot survive a new skeleton.
    w.setPosition(this.player.x + (flip ? -18 : 18), this.player.y - 40);
    // Facing right the bar leans 17° down and forward. Facing left it has to be
    // a half turn plus that lean, not the negative angle: the texture occupies
    // its 46 pixels on the +x side of the grip no matter how it is flipped, so a
    // negated angle points the weapon up and back over the shoulder instead of
    // down and ahead. The claw's own curl ends up inverted on that side, which
    // at one pixel of curl is not a thing anyone can see.
    w.setRotation(flip ? Math.PI - 0.34 : 0.34);
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
    // 先收巡逻 timer：它闭包里握着本层的 trader，而下面就要把它 destroy。
    this.traderPatrolTimer?.remove();
    this.traderPatrolTimer = undefined;
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
    const taken: number[] = [UP_EXIT_X, this.downExit, ...this.floorView.containers.map((c) => c.x)];
    if (state.currentFloor === NPC_FLOOR) taken.push(...NPCS.map((n) => n.x));
    // OVERHAUL Wave C1: the trader joins the taken list so nothing lands on
    // top of him, and he is drawn after the spots so he reads above them.
    // The player arrives at ENTRY_X on every floor, so a trader placed there
    // spawns inside them - measured: trader 614, arrival 640, the two figures
    // overlapped on screen and neither was clickable-looking. Clear a full
    // interact radius plus a body width from both the arrival point and any NPC.
    const floor = state.currentFloor;
    const shopTaken = [...taken, ENTRY_X];
    // A merchant you run into, not a shop on every floor. Two floors in three
    // have one; the rest do not, and that is what makes the sight of him worth
    // noticing. Seeded on the run so a reload does not reshuffle the tower.
    const traderHere = floor >= 2 && (state.runSeed * 31 + floor * 17) % 3 !== 0;
    const shopX = traderHere ? placeClearX(state.runSeed, floor, 'trader', shopTaken, INTERACT_DISTANCE * 2) : null;
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
      const traderShadow = addContactShadow(this, shopX, PLAYER_FEET_Y + 2, 26, 2, 0.5);
      this.floorObjects.push(...traderShadow);
      const trader = this.add.sprite(shopX, PLAYER_FEET_Y, walkSheetKey('npc_alin')).setOrigin(0.5, 1).setDepth(5);
      trader.play(idleAnimKey('npc_alin'));
      const tag = this.add
        .text(shopX, PLAYER_FEET_Y - 108, '行商', { fontFamily: FONT_FAMILY, fontSize: '22px', color: hex(TEXT.highlight), backgroundColor: '#0b0f12cc', padding: { x: 4, y: 2 } })
        .setOrigin(0.5)
        .setDepth(6);
      this.spotMarkers.set('shop', { x: shopX, isBoss: false, dot: trader as unknown as Phaser.GameObjects.Arc, label: tag });

      // He walks the floor. A merchant standing still under a floating label is a
      // vending machine; one that paces from the stairwell to the far wall and
      // back is somebody you ran into.
      //
      // Waypoints rather than a there-and-back tween: a single yoyo leg reads as
      // a pendulum. He visits three spots along the corridor, pauses at each, and
      // the walk sheet flips to face the way he is going.
      const stick = traderShadow[0];
      const walk = walkAnimKey('npc_alin');
      const waypoints = [shopX, shopX + 260, shopX + 90, shopX - 120];
      let leg = 0;
      const step = (): void => {
        leg = (leg + 1) % waypoints.length;
        const to = waypoints[leg];
        trader.setFlipX(to < trader.x);
        const ms = Math.max(900, Math.abs(to - trader.x) * 14);
        this.tweens.add({
          targets: [trader, tag, stick],
          x: to,
          duration: ms,
          ease: 'Sine.InOut',
          // active/anims 双保险：timer 已收但 tween 恰好在队的这一帧，
          // 旧 trader 已 destroy，anims 组件随之移除——不打这个防护就会抛。
          onStart: () => {
            if (trader.active && trader.anims) trader.play(walk, true);
          },
          onUpdate: () => {
            const m = this.spotMarkers.get('shop');
            if (m) m.x = trader.x;
          },
          onComplete: () => trader.play(idleAnimKey('npc_alin')),
        });
      };
      this.traderPatrolTimer = this.time.addEvent({ delay: 2600, loop: true, callback: step });
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
    // AG-20: 商品架 + 材料货架合成一份行列表。材料牌价是当日价
    // （materialShelf 按 (runSeed, day) 抖），所以每次开面板都重新读——
    // 昨天看过的价今天不作数，这正是「今天囤料还是明天囤料」的决策面。
    this.shopRows = [
      ...shopStock(state.currentFloor).map((e) => ({ kind: 'stock' as const, itemId: e.itemId, price: e.price })),
      ...materialShelf(state.runSeed, state.day).map((e) => ({ kind: 'material' as const, itemId: e.itemId, price: e.price })),
    ];
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
    const panelW = 440;
    // AG-20: 248 → 424。材料货架是八行当日牌价，每行同时写着「买」和「卖」
    // 两个方向的价格——要价恒高于收购价（shop.ts 的结构性下限），面板上
    // 一眼看得见，套利无从下嘴。
    const panelH = 424;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    // Remembered for the mouse: a click outside this rectangle closes the panel.
    this.panelBox = { x: left, y: top, w: panelW, h: panelH };
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
    // language as the bag. AG-20: the two shelves share one cursor
    // (this.shopSelected indexes shopRows), so this section scans the combined
    // list and keeps its own rows' y positions contiguous.
    let stockY = top + 30;
    for (const [i, row] of this.shopRows.entries()) {
      if (row.kind !== 'stock') continue;
      const y = stockY;
      stockY += 30;
      const selected = i === this.shopSelected;
      this.encounterObjects.push(
        ...buildListRow(this, left + 8, y, panelW - 16, depth + 5, {
          iconKey: itemIconKey(row.itemId),
          label: getItem(row.itemId).displayName,
          value: `${row.price} 金 · 持 ${countItem(state.player.inventory, row.itemId)}`,
          selected,
        }),
      );
      // Click a row to buy it. Deferred by one tick: this panel is rebuilt from
      // scratch on every selection change, and destroying the object that is
      // currently handling the pointer event is how you get a crash inside
      // Phaser's input list.
      this.encounterObjects.push(
        this.panelHit( left + 8, y, panelW - 16, 28, depth + 8, {
          onClick: () =>
            this.time.delayedCall(0, () => {
              this.shopSelected = i;
              this.buildShopPanel();
              this.onUse();
            }),
        }),
      );
      if (!selected) continue;
      // The selected row also shows what the trade would do, since the only
      // feedback otherwise arrives after the gold is already spent.
      const canBuy = state.player.gold >= row.price;
      this.encounterObjects.push(
        this.add
          .text(left + panelW - 20, y + 20, canBuy ? 'Enter 买入' : '金币不足', {
            fontFamily: FONT_FAMILY,
            fontSize: `${TYPE.caption}px`,
            color: canBuy ? hex(PALETTE.clothHigh) : hex(TEXT.warn),
          })
          .setOrigin(1, 0.5)
          .setDepth(depth + 7),
      );
    }

    // ── AG-20: 材料货架（当日牌价）────────────────────────────────────────
    // 与商品架同一块面板、同一个光标：八件硬通货，每行「买 X · 卖 Y · 持 N」。
    // 买价是 materialShelf 的当日牌价（每次开面板重读），卖价是商人收购价
    // （sellPrice，全世界固定）——两个方向印在同一行上，结构性无套利因此
    // 是看得见的，不是注释里的承诺。
    const shelfY = stockY + 6;
    this.encounterObjects.push(
      this.add
        .text(left + 16, shelfY + 8, `材料货架 · 第 ${state.day} 天牌价`, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.secondary) })
        .setOrigin(0, 0.5)
        .setDepth(depth + 7),
    );
    let rowY = shelfY + 22;
    for (const [i, row] of this.shopRows.entries()) {
      if (row.kind !== 'material') continue;
      const y = rowY;
      rowY += 26;
      const selected = i === this.shopSelected;
      const bid = sellPrice(row.itemId, state.currentFloor);
      this.encounterObjects.push(
        ...buildListRow(this, left + 8, y, panelW - 16, depth + 5, {
          iconKey: itemIconKey(row.itemId),
          label: getItem(row.itemId).displayName,
          value: `买 ${row.price} · 卖 ${bid} · 持 ${countItem(state.player.inventory, row.itemId)}`,
          selected,
        }),
      );
      this.encounterObjects.push(
        this.panelHit( left + 8, y, panelW - 16, 26, depth + 8, {
          onClick: () =>
            this.time.delayedCall(0, () => {
              this.shopSelected = i;
              this.buildShopPanel();
              this.onUse();
            }),
        }),
      );
      if (!selected) continue;
      const canBuy = state.player.gold >= row.price;
      this.encounterObjects.push(
        this.add
          .text(left + panelW - 20, y + 20, canBuy ? 'Enter 买入' : '金币不足', {
            fontFamily: FONT_FAMILY,
            fontSize: `${TYPE.caption}px`,
            color: canBuy ? hex(PALETTE.clothHigh) : hex(TEXT.warn),
          })
          .setOrigin(1, 0.5)
          .setDepth(depth + 7),
      );
    }

    // The sell hint lives in its own strip at the bottom: the stock list is
    // what the player is browsing, and the sell mechanics apply to the whole bag
    // rather than to the highlighted row.
    const footY = top + panelH - 34;
    this.encounterObjects.push(...buildPanelWell(this, left + 8, footY, panelW - 16, 22, depth + 5));
    this.encounterObjects.push(
      this.add
        .text(left + 16, footY + 11, 'Enter 买入 · S 卖出选中的一件 · ESC 离开', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.secondary) })
        .setOrigin(0, 0.5)
        .setDepth(depth + 7),
    );
    // This panel is rebuilt on every open, so it never runs applyPanelDepth -
    // every object it makes has to be locked here or it slides with the camera.
    lockToScreen(this.encounterObjects);
  }

  private shopBuy(): void {
    const state = getGame();
    const entry = this.shopRows[this.shopSelected];
    if (!entry) return;
    // buy() 自己认材料：商品架没有的物品回落到 materialPrice（当日牌价 +
    // 熟人折扣，夹在收购价+1 的下限上），所以材料行与商品行走同一入口。
    const r = buy(state, entry.itemId, state.currentFloor);
    playSfx(r.ok ? 'chest' : 'pickup');
    this.flash(r.ok ? r.message : r.reason);
    // The trade, seen. Gold changing hands was a number in the HUD and a line of
    // text; the coin spins over the counter while the deal is open.
    if (r.ok) {
      const coin = startFxLoop(this, 'coin-spin', state.player.x + 26, PLAYER_FEET_Y - 62, LIGHT_DEPTH);
      if (coin) this.encounterObjects.push(coin);
    }
    this.refreshInventory();
    this.refreshStats();
    this.buildShopPanel();
  }

  private shopSell(): void {
    const state = getGame();
    const entry = this.shopRows[this.shopSelected];
    if (!entry) return;
    // 卖方向：材料行走收购价（MATERIAL_SELL_PRICES，全世界固定），商品架走
    // band 半价——选中的是哪行就卖哪行，S 因此同时是两个货架的出口。
    const r = sell(state, entry.itemId, state.currentFloor);
    playSfx(r.ok ? 'chest' : 'pickup');
    this.flash(r.ok ? r.message : r.reason);
    if (r.ok) {
      const coin = startFxLoop(this, 'coin-spin', state.player.x + 26, PLAYER_FEET_Y - 62, LIGHT_DEPTH);
      if (coin) this.encounterObjects.push(coin);
    }
    this.refreshInventory();
    this.refreshStats();
    this.buildShopPanel();
  }

  // ── AG-20: 产业投资面板（VENTURES / invest / settleInvestments）──────────
  //
  // 三门产业是长期行为：金币沉下去（investedGold），按游戏日结算收益与风险
  // （亏损/倒塌），收益喂 wealth 成长线。面板因此必须回答「我投的怎么了」：
  // 已投入（沉没资本 + 在册名单）、昨日收益、累计——否则玩家投完只能盯着
  // 金币总数猜。
  //
  // 结算发生在时钟内部（SurvivalSystem 的跨日路径），报告不往上传；场景在
  // 每次推进时间的前后对比账本快照得出当日读数（diffVentureLedger）——只
  // 观察，绝不绕过 economy:settled-day 水位标记自己结算。打开面板时再补一
  // 次 settleInvestments：幂等，时钟已结过就是空转，悬挂的结算日在此入账。
  private onToggleVentures(): void {
    if (this.stairClimb || this.inventoryOpen || this.craftingOpen || this.dialogueOpen || this.pauseOpen || this.encounterOpen || this.shelterOpen) return;
    this.ventureOpen = !this.ventureOpen;
    for (const o of this.ventureObjects) o.setVisible(this.ventureOpen);
    if (this.ventureOpen) {
      this.ventureSelected = 0;
      this.buildVenturePanel();
    }
  }

  private closeVentures(): void {
    this.ventureOpen = false;
    for (const o of this.ventureObjects) o.setVisible(false);
  }

  /** 投资账本快照：推进时间前后各取一次，差就是当日产业结算的读数。 */
  private ventureLedgerSnapshot(): { gold: number; ventures: string[] } {
    const state = getGame();
    return { gold: state.player.gold, ventures: [...(state.growth?.ventures ?? [])] };
  }

  /**
   * 观察一次时间推进后的产业结算。时钟已经在推进内部结过了（水位标记把关），
   * 这里只对比账本：多出来的金币就是当日收益（该窗口内没有第二个动金币的
   * 系统），从在册名单里消失的产业就是倒塌。读数进面板，收益累进 flags 里
   * 的累计账本，并以 flash 告诉玩家——「投了不知道发生什么」到此为止。
   */
  private diffVentureLedger(before: { gold: number; ventures: string[] }): void {
    const state = getGame();
    if (before.ventures.length === 0) return; // 没有在册产业，结算必然是 no-op
    const after = state.growth?.ventures ?? [];
    const income = state.player.gold - before.gold;
    const collapsed = before.ventures.filter((id) => !after.includes(id));
    if (income <= 0 && collapsed.length === 0) return;
    this.recordVentureSettlement(state.day - 1, income, collapsed);
  }

  /**
   * 记一笔结算读数（面板读数 + 累计账本 + 玩家可见的反馈）。
   *
   * flash 延后到夜间事件播报之后：跨日那一帧 ensureNightEvent 也在 flash
   * （今夜的遭遇），两条同时亮只会互相覆盖——玩家先看到今夜有什么，再看到
   * 产业进账。1600ms 是 flash 自身的寿命，1700ms 正好接在后面。
   */
  private recordVentureSettlement(day: number, income: number, collapsed: string[]): void {
    const state = getGame();
    this.lastVentureDay = day;
    this.lastVentureIncome = Math.max(0, income);
    this.lastVentureCollapsed = collapsed;
    if (income > 0) bumpFlag(state, VENTURE_INCOME_FLAG, income);
    const lines: string[] = [];
    if (income > 0) lines.push(`产业结算：第 ${day} 天进账 +${income} 金`);
    for (const id of collapsed) {
      const def = VENTURES.find((v) => v.id === id);
      lines.push(`${def?.displayName ?? id}倒闭了，投入的本金全损`);
    }
    if (lines.length === 0) return;
    this.time.delayedCall(VENTURE_FLASH_DELAY_MS, () => {
      for (const line of lines) this.flash(line);
    });
  }

  private buildVenturePanel(): void {
    for (const o of this.ventureObjects) {
      if (o !== this.ventureMarker) o.destroy();
    }
    this.ventureObjects = [];
    const state = getGame();
    // 打开即补一次结算：幂等（时钟已结过就是空转），悬挂的结算日在此入账，
    // 面板读到的因此永远是结完账的数字。
    const pending = settleInvestments(state);
    if (pending.totalIncome > 0 || pending.collapsed.length > 0) {
      this.recordVentureSettlement(pending.day, pending.totalIncome, pending.collapsed);
    }
    const { width, height } = this.viewSize();
    const panelW = 520;
    const panelH = 268;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    this.panelBox = { x: left, y: top, w: panelW, h: panelH };
    const depth = PANEL_DEPTH.game.dialogue;

    this.ventureObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'green', depth));
    this.ventureObjects.push(...buildPanelHeader(this, left, top, panelW, '产业投资', UI.good, depth + 5));
    this.ventureObjects.push(
      this.add
        .text(left + panelW - 10, top + 10, `${state.player.gold} 金`, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: hex(PALETTE.lightHigh) })
        .setOrigin(1, 0.5)
        .setDepth(depth + 6),
    );

    // 账本读数：已投入 / 昨日收益 / 累计。投资是长期行为，这三行就是玩家
    // 「投了之后发生什么」的唯一答案，因此放在面板最上面。
    const growth = ensureGrowth(state);
    const owned = growth.ventures
      .map((id) => VENTURES.find((v) => v.id === id))
      .filter((v): v is (typeof VENTURES)[number] => v !== undefined);
    const totalIncome = flagCount(state, VENTURE_INCOME_FLAG);
    this.ventureObjects.push(...buildPanelWell(this, left + 12, top + 28, panelW - 24, 52, depth + 5));
    this.ventureObjects.push(
      this.add
        .text(
          left + 24,
          top + 40,
          `已投入 ${growth.investedGold} 金 · 在册 ${owned.length} 门${owned.length ? `：${owned.map((v) => v.displayName).join('、')}` : ''}`,
          { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.primary), wordWrap: { width: panelW - 48 } },
        )
        .setOrigin(0, 0.5)
        .setDepth(depth + 6),
    );
    const lastIncome = this.lastVentureIncome;
    this.ventureObjects.push(
      this.add
        .text(
          left + 24,
          top + 64,
          this.lastVentureDay > 0
            ? `昨日收益（第 ${this.lastVentureDay} 天）+${lastIncome} 金 · 累计 +${totalIncome} 金${this.lastVentureCollapsed.length ? ` · 倒闭 ${this.lastVentureCollapsed.length} 门` : ''}`
            : `昨日收益 — · 累计 +${totalIncome} 金`,
          { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(lastIncome > 0 ? PALETTE.lightHigh : TEXT.secondary) },
        )
        .setOrigin(0, 0.5)
        .setDepth(depth + 6),
    );

    // 三门产业：成本 / 日收益率 / 亏损率 / 倒闭率全印在行上——风险行为不能
    // 做成稳赚，概率 therefore 是面板的一等内容。
    const rowsTop = top + 90;
    VENTURES.forEach((def, i) => {
      const y = rowsTop + i * 28;
      const selected = i === this.ventureSelected;
      const inLedger = owned.some((v) => v.id === def.id);
      this.ventureObjects.push(
        ...buildListRow(this, left + 16, y, panelW - 32, depth + 6, {
          label: `${def.displayName}${inLedger ? ' · 在册' : ''}`,
          value: `成本 ${def.cost} · 日 ${Math.round(def.baseRate * 100)}% · 亏 ${Math.round(def.lossChance * 100)}% · 倒 ${Math.round(def.collapseChance * 100)}%`,
          selected,
          dim: inLedger,
        }),
      );
      this.ventureObjects.push(
        this.panelHit( left + 16, y, panelW - 32, 26, depth + 8, {
          onOver: () => {
            if (this.ventureSelected === i) return;
            this.ventureSelected = i;
            this.buildVenturePanel();
          },
          onClick: () => {
            if (this.ventureSelected !== i) {
              this.ventureSelected = i;
              this.buildVenturePanel();
              playSfx('click');
              return;
            }
            this.activateVentureChoice();
          },
        }),
      );
    });

    // 选中行的说明与动作：.description 是这门生意的来龙去脉，Enter 的动作
    // 与代价写在同一行——金币不够时说的是差多少，不是沉默。
    const selected = VENTURES[this.ventureSelected];
    if (selected) {
      const inLedger = owned.some((v) => v.id === selected.id);
      const afford = state.player.gold >= selected.cost;
      const action = inLedger ? '已在册 · 按游戏日结算' : afford ? `Enter 入股 ${selected.cost} 金` : `金币不够（需要 ${selected.cost}）`;
      this.ventureObjects.push(
        this.add
          .text(left + 18, rowsTop + 3 * 28 + 16, action, {
            fontFamily: FONT_FAMILY,
            fontSize: `${TYPE.caption}px`,
            color: hex(inLedger ? TEXT.dim : afford ? PALETTE.clothHigh : TEXT.warn),
          })
          .setOrigin(0, 0.5)
          .setDepth(depth + 6),
      );
      this.ventureObjects.push(
        this.add
          .text(left + 18, rowsTop + 3 * 28 + 38, selected.description, {
            fontFamily: FONT_FAMILY,
            fontSize: `${TYPE.caption}px`,
            color: hex(TEXT.secondary),
            wordWrap: { width: panelW - 36 },
          })
          .setOrigin(0, 0.5)
          .setDepth(depth + 6),
      );
    }

    this.ventureObjects.push(
      this.add.text(cx, top + panelH - 14, '↑/↓ 选择 · Enter 入股 · G 离开', {
        fontFamily: FONT_FAMILY,
        fontSize: `${TYPE.caption}px`,
        color: hex(PALETTE.clothHigh),
      }).setOrigin(0.5).setDepth(depth + 6),
    );
    this.ventureObjects.push(this.ventureMarker);
    applyPanelDepth(this.ventureObjects, PANEL_DEPTH.game.dialogue);
    lockToScreen(this.ventureObjects);
    this.assertPanelContent('venture', this.ventureObjects);
  }

  private activateVentureChoice(): void {
    const state = getGame();
    const def = VENTURES[this.ventureSelected];
    if (!def) return;
    // invest() 原子：被拒时金币、账本、经验一律不动，reason 原样给玩家看。
    const r = invest(state, def.id);
    playSfx(r.ok ? 'chest' : 'pickup');
    this.flash(r.ok ? r.message : r.reason);
    if (r.ok) this.refreshStats();
    this.buildVenturePanel();
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

  private buildCombatPanel(): void {
    for (const o of this.encounterObjects) o.destroy();
    this.encounterObjects = [];
    const state = getGame();
    const combat = state.combat;
    if (!combat) return;
    const { width, height } = this.viewSize();
    const cx = width / 2;
    const cy = height / 2;
    const panelW = 440;
    const panelH = 232;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    // Remembered for the mouse: a click outside this rectangle closes the panel.
    this.panelBox = { x: left, y: top, w: panelW, h: panelH };
    const depth = PANEL_DEPTH.game.dialogue;
    const isBoss = combat.kind === 'boss';

    this.encounterObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'yellow', depth));
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
    const logH = 62;
    this.encounterObjects.push(...buildPanelWell(this, left + 12, logTop, panelW - 24, logH, depth + 5));
    const tail = combat.log.slice(-3);
    tail.forEach((line, i) => {
      this.encounterObjects.push(
        this.add
          .text(left + 20, logTop + 8 + i * 17, line, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: i === tail.length - 1 ? hex(TEXT.primary) : hex(TEXT.dim), wordWrap: { width: panelW - 40 } })
          .setDepth(depth + 7),
      );
    });

    // The three actions, as rows with a status column - the key, what it does,
    // and what it costs. A list of three verbs in a row was the old shape.
    const choices: ReadonlyArray<readonly [string, string, string]> = [
      ['攻击', '按 Enter', '造成武器伤害'],
      ['格挡', '受伤减半', '回 3 精力'],
      ['撤退', '按 ESC', '逃跑可能失败'],
    ];
    choices.forEach(([label, key, note], i) => {
      const y = top + 126 + i * 26;
      const selected = i === this.combatSelected;
      if (selected) {
        this.encounterObjects.push(this.add.rectangle(left + 12, y, panelW - 24, 24, UI.accent).setOrigin(0, 0).setAlpha(0.14).setDepth(depth + 5));
        this.encounterObjects.push(this.add.rectangle(left + 12, y, 2, 24, UI.accent).setOrigin(0, 0).setDepth(depth + 6));
      }
      this.encounterObjects.push(
        this.panelHit( left + 12, y, panelW - 24, 24, depth + 8, {
          onClick: () =>
            this.time.delayedCall(0, () => {
              this.combatSelected = i;
              this.buildCombatPanel();
              this.onUse();
            }),
        }),
      );
      this.encounterObjects.push(
        this.add
          .text(left + 22, y + 12, label, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: selected ? hex(PALETTE.lightHigh) : hex(TEXT.primary) })
          .setOrigin(0, 0.5)
          .setDepth(depth + 7),
        this.add
          .text(left + panelW - 22, y + 12, `${key} · ${note}`, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.dim) })
          .setOrigin(1, 0.5)
          .setDepth(depth + 7),
      );
    });

    this.encounterObjects.push(
      this.add
        .text(cx, top + panelH - 12, '↑/↓ 选择 · Enter 出招 · ESC 撤退', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(PALETTE.clothHigh) })
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
    const slash = playFx(this, 'sword-slash', state.player.x + 30 * facing, PLAYER_FEET_Y - 18, LIGHT_DEPTH, {
      // The atlas's usable arc is about 90x60 inside a 136x104 frame, and its
      // pivot sits near the bottom of that frame - so the arc rises about 57px
      // above whatever point it is anchored to. Anchoring at chest height put
      // the whole arc above the survivor's head; anchoring near the feet puts it
      // across the body, which is where a swing happens. 1.35 is roughly the
      // crowbar's reach; 0.7 stretches the 800ms cut to 1.14s, long enough to
      // survive a glance away at the log.
      scale: 1.35,
      timeScale: 0.7,
    });
    // The arc is drawn facing right; a survivor facing left needs it mirrored or
    // the slash trails behind them.
    if (slash) slash.setFlipX(facing < 0);
    if (killed) {
      playFx(this, 'crit-hit', state.player.x + 30 * facing, PLAYER_FEET_Y - 30, LIGHT_DEPTH + 1, { scale: 1.4 });
    }
  }

  // Feedback is deliberately downstream of the pure combat result. It can add
  // sprites, a short shake, and an action pose, but it never rolls, mutates HP,
  // or decides whether the turn continues.
  private playCombatFeedback(round: CombatRound, action: CombatAction): void {
    const state = getGame();
    // The swing happens whether or not it lands.
    //
    // It used to be gated on playerDamage > 0, which meant a miss produced
    // nothing on screen at all - and with the fight's accuracy the miss was the
    // common case. The one visual sign that the survivor carries a weapon was an
    // effect that appeared in roughly half the rounds, for two thirds of a
    // second, above a figure holding nothing. A swing that whiffs still swings.
    if (action === 'attack') this.playSwingFx(round.monsterDead);
    if (action === 'guard' && round.monsterDamage > 0 && !round.fled) {
      playFx(this, 'parry', state.player.x + 10, PLAYER_FEET_Y - 50, LIGHT_DEPTH + 1, { scale: 1.3 });
    }
    if (round.monsterDamage > 0 && !round.fled) {
      playFx(this, 'hit-flash', state.player.x, PLAYER_FEET_Y - 48, LIGHT_DEPTH + 2);
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
    if (round.monsterDamage > 0 && !round.monsterDead && !round.fled) {
      // A coward that dropped below its threshold breaks off the fight and
      // runs — the player keeps what they already did to it.
      const cowardFrac = behaviorModifiers('coward').fleeAtHpFrac;
      if (combat.monster.behavior === 'coward' && cowardFrac > 0 && combat.monster.hp / combat.monster.maxHp < cowardFrac) {
        combat.log.push(`${combat.monster.name} 伤痕累累地逃走了。`);
        this.finishCombat('coward');
        return;
      }
      // OVERHAUL Wave B2/B3: the guardian totem and easy mode both soften the
      // hit the player takes; the relic applies to any monster, the mode only
      // to the guardian.
      const soften = (combat.kind === 'boss' ? guardianDamageMult(state.relics ?? []) * modeGuardianDamageMult(state.mode ?? 'adventure') : guardianDamageMult(state.relics ?? []));
      const dmg = Math.max(1, Math.round(round.monsterDamage * soften));
      state.player.hp = Math.max(0, state.player.hp - dmg);
      if (action === 'guard') this.playActionAnim(hurtAnimKey('player'), 400);
      this.cameras.main.shake(160, 0.008);
    }
    combat.turn += 1;
    this.refreshStats();

    if (round.playerDead || state.player.hp <= 0) {
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
        if (r.overflow === 0) { taken.push({ itemId, quantity: qty }); this.lootThisTrip += qty; }
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
    const outW = 440;
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
        .text(cx, outTop + outH - 12, 'Enter / ESC 继续', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.dim) })
        .setOrigin(0.5)
        .setDepth(outDepth + 7),
    );
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
    const panelW = 420;
    const panelH = 190;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    // Remembered for the mouse: a click outside this rectangle closes the panel.
    this.panelBox = { x: left, y: top, w: panelW, h: panelH };

    const depth = PANEL_DEPTH.game.dialogue;
    this.encounterObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'yellow', depth));
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
      enc.choices.forEach((choice, i) => {
        const y = top + 84 + i * 28;
        const selected = i === enc.selected;
        if (selected) {
          this.encounterObjects.push(
            this.add.rectangle(left + 12, y, panelW - 24, 26, UI.accent).setOrigin(0, 0).setAlpha(0.14).setDepth(depth + 5),
            this.add.rectangle(left + 12, y, 2, 26, UI.accent).setOrigin(0, 0).setDepth(depth + 6),
          );
        }
        this.encounterObjects.push(
          this.panelHit( left + 12, y, panelW - 24, 26, depth + 8, {
            onClick: () =>
              this.time.delayedCall(0, () => {
                if (!this.encounter) return;
                this.encounter.selected = i;
                this.buildEncounterPanel(this.spotMarkers.get(this.encounter.spotId)?.isBoss ?? false);
                this.onUse();
              }),
          }),
        );
        this.encounterObjects.push(
          this.add
            .text(left + 24, y + 13, CHOICE_LABELS[choice], {
              fontFamily: FONT_FAMILY,
              fontSize: `${TYPE.body}px`,
              color: selected ? hex(PALETTE.lightHigh) : hex(TEXT.secondary),
            })
            .setOrigin(0, 0.5)
            .setDepth(depth + 7),
        );
      });
      this.encounterObjects.push(
        this.add
          .text(cx, top + panelH - 12, '↑/↓ 选择 · Enter 确认 · ESC 离开', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.dim) })
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
      this.refreshStats();
    }
    // Outcome panel: the message, and the item flow the player actually got.
    for (const o of this.encounterObjects) o.destroy();
    this.encounterObjects = [];
    const { width, height } = this.viewSize();
    const cx = width / 2;
    const cy = height / 2;
    const panelW = 420;
    const panelH = 170;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    const isBoss = enc.encounter.kind === 'boss';
    // Every other panel in this scene ends in lockToScreen() or
    // applyPanelDepth(); this one was rebuilt from scratch on every resolve and
    // neither was ever called, so its four texts sat at scrollFactor 1 and
    // depth 0 — world space, behind everything. Measured on floor 2 (camera
    // scrollY -200): the panel drew empty in the middle of the screen while
    // 「一张纸条」 and the note itself floated 220px below it, over the floor.
    const depth = PANEL_DEPTH.game.dialogue;
    this.encounterObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'yellow', depth));
    this.encounterObjects.push(
      this.add
        .text(cx, top + 18, ENCOUNTER_TITLES[enc.encounter.kind], { fontFamily: FONT_FAMILY, fontSize: '32px', color: isBoss ? hex(TEXT.warn) : hex(PALETTE.lightHigh) })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(depth + 7),
    );
    this.encounterObjects.push(
      this.add
        .text(left + 20, top + 44, result.message, { fontFamily: FONT_FAMILY, fontSize: '22px', color: hex(TEXT.primary), wordWrap: { width: panelW - 40 } })
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(depth + 7),
    );
    const loot = result.items.map((s) => `${getItem(s.itemId).displayName}×${s.quantity}`).join('、');
    if (loot) {
      this.encounterObjects.push(
        this.add
          .text(left + 20, top + 104, `获得：${loot}`, { fontFamily: FONT_FAMILY, fontSize: '22px', color: hex(TEXT.highlight), wordWrap: { width: panelW - 40 } })
          .setOrigin(0, 0)
          .setScrollFactor(0)
          .setDepth(depth + 7),
      );
    }
    this.encounterObjects.push(
      this.add
        .text(cx, top + panelH - 14, 'Enter / ESC 继续', { fontFamily: FONT_FAMILY, fontSize: '22px', color: hex(TEXT.dim) })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(depth + 7),
    );
    // Belt as well as braces: the panel is rebuilt on every resolve, so nothing
    // else will ever run a lock pass over this list.
    lockToScreen(this.encounterObjects);
    this.assertPanelContent('encounter-outcome', this.encounterObjects);
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

    const wall = this.add.image(0, 8, wallKeyFor(STARTING_FLOOR)).setOrigin(0, 0);
    const floor = this.add.image(0, wallH, floorKeyFor(STARTING_FLOOR)).setOrigin(0, 0);

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
      this.floorObjects.push(placeWindow(this, cx - 8, 116, STARTING_FLOOR));
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
      this.floorObjects.push(placeDoor(this, i * ROOM_WIDTH, wallH, STARTING_FLOOR));
    }

    this.floorObjects.push(wall, floor, g);

    // The other beds, with their sleeping roommates. Before this the room was
    // furniture the player uses and nothing that makes it a shared space.
    this.drawDormBeds(DORM_FRONT_BEDS, DORM_BACK_BEDS);

    // Floor 1 is the player's own room, and it is in the same tower as the other
    // 100000 floors: it sleeps as many as the rest of the tier. Drawn after the
    // beds so the people in front read as lying among them.
    const crowd: Phaser.GameObjects.GameObject[] = [];
    for (let r = 0; r < ROOM_COUNT; r++) {
      drawCrowd(this, crowd, { roomX: r * ROOM_WIDTH, floorY: FLOOR_HEIGHT - 60, floor: STARTING_FLOOR, room: r });
    }
    this.floorObjects.push(...crowd);

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

    // The wall belongs to the tier, not to the floor: see wallKeyFor. It is
    // tiled rather than placed: a floor is 4 to 9 bays long, and a floor longer
    // than one 1280-wide tile would end in mid-air.
    const wall = this.add.tileSprite(0, 8, this.floorW, 128, wallKeyFor(floor)).setOrigin(0, 0);
    const floorBand = this.add.tileSprite(0, wallH, this.floorW, 64, floorKeyFor(floor)).setOrigin(0, 0);
    this.floorObjects.push(wall, floorBand);

    if (tint) {
      this.floorObjects.push(this.add.rectangle(this.floorW / 2, 8 + (wallH - 8) / 2, this.floorW, wallH - 8, tint.color, tint.alpha));
    }

    const g = this.add.graphics();
    g.fillStyle(0x0b0f12, 1);
    g.fillRect(0, 0, this.floorW, 8);

    // The people who never left. Drawn on their own layer between the wall and
    // the props, so a body under a blanket is behind the shelves instead of on
    // top of them.
    const crowd: Phaser.GameObjects.GameObject[] = [];
    for (let r = 0; r < roomCountFor(floor); r++) {
      drawCrowd(this, crowd, { roomX: r * ROOM_WIDTH, floorY: wallH, floor, room: r });
    }
    this.floorObjects.push(...crowd);

    // Props, room by room. Each theme decides its own dressing; the loop only
    // supplies the room's position so nothing has to recompute the layout.
    const props: Phaser.GameObjects.GameObject[] = [];
    for (let r = 0; r < roomCountFor(floor); r++) {
      drawCorridorRoom({ scene: this, g, floor, roomX: r * ROOM_WIDTH, floorY: wallH, room: r, objects: props, fixtures: this.lightFixtures });
    }
    this.floorObjects.push(g, ...props);

    this.floorObjects.push(
      ...buildForeground(this, { width: this.floorW, height: FLOOR_HEIGHT, wallBottom: wallH, seed: floor * 31 }),
    );

    // OVERHAUL Art Pass 2: the same depth cues as the dorm, with the
    // stairwells as this floor's light sources.
    this.floorObjects.push(
      ...buildRoomDepth(this, {
        width: this.floorW,
        wallBottom: wallH,
        height: FLOOR_HEIGHT,
        lightXs: [40, this.floorW - 40],
      }),
      ...buildSurfaceDetail(this, { width: this.floorW, wallBottom: wallH, height: FLOOR_HEIGHT, seed: floor * 17 }),
      ...buildCeilingLights(this, { width: this.floorW, seed: floor * 13, top: 16, fixtures: this.lightFixtures }),
      ...buildAerialHaze(this, { width: this.floorW, wallBottom: wallH, hazeColor: ambienceFor(floor).color, strength: 0.34 }),
      ...buildWallDressing(this, { width: this.floorW, wallBottom: wallH, seed: floor * 19, keepClear: [UP_EXIT_X, this.downExit] }),
      ...buildFloorClutter(this, { width: this.floorW, wallBottom: wallH, seed: floor * 19, keepClear: [UP_EXIT_X, this.downExit] }),
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
      this.drawStair(this.downExit, 'down', floor);
      const downLabel = this.add.text(this.downExit, FLOOR_HEIGHT - 104, '↓ 下楼', { fontFamily: FONT_FAMILY, fontSize: `${TYPE_AUX}px`, color: hex(PALETTE.lightHigh) }).setOrigin(0.5);
      this.floorObjects.push(downLabel);
    }
  }

  /**
   * The freight lift, on the top floor of a playable segment and nowhere else
   * (docs/18_TIER_PROGRESSION.md §2: a segment is climbed by stairs, a tier
   * boundary is crossed by the lift).
   *
   * There is no lift art in the pack and this task does not add any, so the door
   * is Graphics in the wall's own ramps: a roller shutter set into a recess, a
   * lit sign over it, and a call plate on the frame. It is deliberately drawn as
   * a freight shutter rather than a passenger car — this is the door that skips
   * eighty-nine floors.
   */
  private drawLift(floor: number): void {
    // A lift exists on a segment's top floor (up) and its bottom floor (down).
    // Mid-segment there is none, and the dorm has nothing below it.
    const direction = liftDirection(floor);
    if (direction === null) return;
    const wallBottom = FLOOR_HEIGHT - FLOOR_BAND;
    const w = 52;
    const h = 74;
    const top = wallBottom - h;
    const depth = ACTOR_DEPTH - 1;

    const g = this.add.graphics().setDepth(depth);
    // The recess, so the shutter reads as set into the wall instead of painted
    // on it. Without this the door is a rectangle of a different grey.
    g.fillStyle(PALETTE.ink, 1);
    g.fillRect(LIFT_X - w / 2 - 4, top - 4, w + 8, h + 4);
    // Four slats, each catching a little light along its top edge.
    const slat = h / 4;
    for (let i = 0; i < 4; i++) {
      const y = top + i * slat;
      g.fillStyle(PALETTE.stone, 1);
      g.fillRect(LIFT_X - w / 2, y, w, slat - 2);
      g.fillStyle(PALETTE.shadow, 1);
      g.fillRect(LIFT_X - w / 2, y + slat - 3, w, 2);
    }
    // Frame, sill, and a hazard plate: cargo, not passengers.
    g.lineStyle(2, PALETTE.stoneLight, 1);
    g.strokeRect(LIFT_X - w / 2 - 2, top - 2, w + 4, h + 2);
    g.fillStyle(PALETTE.dust, 1);
    g.fillRect(LIFT_X - w / 2 - 6, wallBottom - 2, w + 12, 3);
    g.fillStyle(PALETTE.lightHigh, 1);
    g.fillRect(LIFT_X + w / 2 + 8, top + 34, 6, 10);

    // The sign is the interaction's whole affordance, so it is a plaque rather
    // than bare text on the wall: at 18px it is the smallest size that stays
    // legible and still fits between the container's label and the stairwell.
    const sign = this.add
      .rectangle(LIFT_X, LIFT_SIGN_Y, 94, 22, PALETTE.ink, 1)
      .setStrokeStyle(1, PALETTE.stoneLight)
      .setDepth(depth);
    const label = this.add
      .text(LIFT_X, LIFT_SIGN_Y, direction === 'down' ? '↓ 货运电梯' : '↑ 货运电梯', { fontFamily: FONT_FAMILY, fontSize: `${LIFT_SIGN_FONT}px`, color: hex(PALETTE.clothHigh) })
      .setOrigin(0.5)
      .setDepth(depth);
    this.floorObjects.push(g, sign, label);
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
    // A neighbour is drawn at ITS length, not the player's: tiers differ, and a
    // 1600-wide floor seen from a 1280 one would otherwise end in black.
    const nbW = floorWidthFor(floor);
    // A container in floor-local coordinates: the shared renderers build the
    // floor unchanged and one depth keeps all of it behind the playable floor.
    const preexisting = new Set<Phaser.GameObjects.GameObject>(this.children.list);
    const layer = this.add.container(0, yOffset).setDepth(STACK_DEPTH);
    const add = (...objs: Phaser.GameObjects.GameObject[]): void => {
      for (const o of objs) layer.add(o);
    };

    // Base art. Same wall and floor band as every other floor of the tower.
    add(this.add.tileSprite(0, 8, nbW, 128, wallKeyFor(floor)).setOrigin(0, 0));
    add(this.add.tileSprite(0, wallH, nbW, 64, floorKeyFor(floor)).setOrigin(0, 0));
    if (tint) add(this.add.rectangle(nbW / 2, 8 + (wallH - 8) / 2, nbW, wallH - 8, tint.color, tint.alpha));
    const ceilingSeam = this.add.graphics();
    ceilingSeam.fillStyle(0x0b0f12, 1);
    ceilingSeam.fillRect(0, 0, nbW, 8);
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
        .rectangle(nbW / 2, (clearY + floorTop) / 2, nbW, floorTop - clearY, amb.color)
        .setAlpha(Math.min(0.55, amb.wallAlpha * 1.45)),
    );
    add(
      this.add
        .rectangle(nbW / 2, (floorTop + FLOOR_HEIGHT) / 2, nbW, FLOOR_HEIGHT - floorTop, amb.color)
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
    add(...buildRoomDepth(this, { width: nbW, wallBottom: wallH, height: FLOOR_HEIGHT, lightXs: [40, nbW - 40] }));
    add(...buildWallDressing(this, { width: nbW, wallBottom: wallH, seed: floor * 19, keepClear: [UP_EXIT_X, downExitXFor(floor)] }));

    // Haze sits behind the props, as it does on the live floor (depth 2), and is
    // the thing that still separates "next floor down" from "the floor after".
    add(...buildAerialHaze(this, { width: nbW, wallBottom: wallH, hazeColor: ambienceFor(floor).color, strength: 0.2 }));

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
        props.push(placeWindow(this, r * ROOM_WIDTH + ROOM_WIDTH / 2 - 8, 116, floor));
      }
      props.push(this.add.image(BED_X, wallH + 4, 'furn_bed').setOrigin(0.5, 1));
      props.push(this.add.image(CRAFT_X, wallH + 4, 'furn_workbench').setOrigin(0.5, 1));
    }
    // The floor below is not an empty diorama: it sleeps as many as it would if
    // the player were standing on it. Its own crowd density applies, so the
    // bottom of the tower looks full from above as well as from inside.
    const nbCrowd: Phaser.GameObjects.GameObject[] = [];
    for (let r = 0; r < roomCountFor(floor); r++) {
      drawCrowd(this, nbCrowd, { roomX: r * ROOM_WIDTH, floorY: wallH, floor, room: r });
    }
    for (const o of nbCrowd) layer.add(o);

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
    const stairX = isAbove ? UP_EXIT_X : downExitXFor(floor);
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

  /**
   * A row of bunks in the background of a sleeping floor.
   *
   * One bed on a floor of a hundred-thousand-storey tower reads as a private room,
   * which is the one thing this building does not have. The row is drawn before the
   * containers (so it sits behind them), tinted down and slightly transparent so it
   * reads as the far wall of a mass dormitory rather than as more things to search,
   * and it skips any slot within reach of a real container so the two never
   * compete for the same pixels.
   */
  private drawDormBunks(floor: number): void {
    if (!SLEEPING_FLOORS.has(floor)) return;
    const state = getGame();
    if (state.currentFloor !== floor) return;
    const { width } = this.viewSize();
    const y = FLOOR_HEIGHT - 64;
    const taken = this.floorView.containers.map((c) => c.x);
    for (let x = 76; x <= width - 76; x += 128) {
      if (taken.some((cx) => Math.abs(cx - x) < 80)) continue;
      const bunk = this.add
        .image(x, y - 4, 'furn_bunk_bed')
        .setOrigin(0.5, 1)
        .setTint(0x9aa4b0)
        .setAlpha(0.86);
      this.floorObjects.push(bunk);
    }
  }

  private buildContainers(): void {
    for (const c of this.floorView.containers) {
      const y = FLOOR_HEIGHT - 64;
      // Crates use the 2026-11-15 set for all three states, so a full crate and
      // its forced/broken counterparts are the same drawing at the same scale.
      // The old crate art is 56px tall against this set's 40 — mixing them made
      // a crate appear to shrink the moment it was looted.
      const key = c.id === 'crate_wood' || c.id === 'crate_metal' ? 'env-crate-intact' : containerTextureKey(c.id);
      // Every container has art now, so the Graphics fallback is gone: a missing
      // key would be an invisible container, not a plain one. The interaction box
      // is unchanged either way — hit detection still goes through c.x and
      // INTERACT_DISTANCE.
      this.floorObjects.push(...addContactShadow(this, c.x, y, 44, 2, 0.45));
      // A searchable bunk has junk under it: the pile is drawn first, so the bed
      // stands in front of it and the player reads "something shoved underneath".
      if (c.id.startsWith('bunk')) {
        const junk = this.textures.exists('env-underbed-a') && Math.abs(c.x) % 2 === 0 ? 'env-underbed-a' : 'env-underbed-b';
        if (this.textures.exists(junk)) {
          this.floorObjects.push(this.add.image(c.x + 10, y - 2, junk).setOrigin(0.5, 1).setAlpha(0.95));
        }
      }
      const box = this.add.image(c.x, y - 4, key ?? '').setOrigin(0.5, 1);
      // A backing plate behind the name. The wall art is a busy grid of pinned
      // notices and service pipes, and 22px text straight on top of it reads as
      // one more rectangle on the wall rather than as a name — worst on the floors
      // that have four containers. Same affordance as the lift's plaque.
      //
      // The plate is created BEFORE the label on purpose: display order in this
      // scene is insertion order, and moveBelow() did not survive (the plate drew
      // over its own text). The width is a rough guess — one em per glyph — and is
      // corrected to the measured text width immediately after.
      // Position: a fixed drop from the prop's base (CONTAINER_LABEL_DROP), not a
      // fixed offset from the floor line and not an offset from the prop's top.
      // The floor-line anchor printed the name across the middle of the crate;
      // the prop-top anchor floated it at y 53..83, hugging the structural band
      // above the props (see the constant's note). The base anchor puts every
      // name on its prop's face and on the stair labels' band.
      const labelY = y - 4 - CONTAINER_LABEL_DROP;
      // Sized from the text, not from label.width: the pixel font is still loading
      // when the floor is built, so Text.width comes back as a placeholder and the
      // plate ends up narrower than its own label (the text then spills past the
      // backing and reads as clipped). estimateTextWidth is font-independent.
      const plateW = Math.ceil(estimateTextWidth(c.label, CONTAINER_LABEL_FONT)) + 14;
      const plate = this.add
        .rectangle(c.x, labelY, plateW, CONTAINER_LABEL_FONT + 8, PALETTE.ink, 0.94)
        .setOrigin(0.5)
        .setStrokeStyle(1, PALETTE.shadow);
      const label = this.add
        .text(c.x, labelY, c.label, { fontFamily: FONT_FAMILY, fontSize: `${CONTAINER_LABEL_FONT}px`, color: hex(TEXT.primary) })
        .setOrigin(0.5);
      // The labels are created early enough that later passes (neighbour floors,
      // the night overlay, the encounter markers) end up drawn over them — measured
      // at display index 31 while the props were at 423. A name you cannot read is
      // the same as no name, so the plate and its text are lifted above the floor
      // dressing once, here.
      // Depth, not order: these labels are created at depth 0, and everything the
      // floor adds later (props, neighbours, markers, glows) sorts above them
      // regardless of insertion index. bringToTop() did nothing for exactly that
      // reason. 9 sits above the actors (ACTOR_DEPTH 5) and the spot markers (8)
      // and below the lighting layer (LIGHT_DEPTH 24), so a name is always on top
      // of the room but still under the light.
      //
      // 105/106, not 9/10: the HUD's context band (y 64..124) is an alpha-0.94
      // surface at depth 100, and a label at 9/10 is painted UNDER it — measured
      // on floor 1: the plate's own pixels came back as flat HUD colour, the name
      // was simply not there. Above the band (100) and its hairline chrome (101),
      // below the HUD's own feedback lane (300), so the name reads on the band it
      // now sits on without covering the objective text.
      plate.setDepth(105);
      label.setDepth(106);
      this.containerObjs.set(c.id, { box, label, plate });
      this.floorObjects.push(box, plate, label);
      this.setContainerEmptyVisual(c.id, c.items.length === 0);
    }
    // The proximity fade, registered once per floor build and replaced each
    // time (see CONTAINER_LABEL_FADERS). Runs on the scene's UPDATE event so it
    // reads the player's position after this frame's movement, and the WeakMap
    // guarantees exactly one live listener however many floors the run visits.
    const fadeLabels = (): void => {
      const px = getGame().player.x;
      for (const c of this.floorView.containers) {
        const obj = this.containerObjs.get(c.id);
        if (!obj) continue;
        const a = Phaser.Math.Clamp((Math.abs(px - c.x) - INTERACT_DISTANCE) / CONTAINER_LABEL_FADE_PX, 0, 1);
        obj.label.setAlpha(a);
        obj.plate.setAlpha(a * 0.94);
      }
    };
    const previousFader = CONTAINER_LABEL_FADERS.get(this);
    if (previousFader) this.events.off(Phaser.Scenes.Events.UPDATE, previousFader);
    CONTAINER_LABEL_FADERS.set(this, fadeLabels);
    this.events.on(Phaser.Scenes.Events.UPDATE, fadeLabels);
  }

  private setContainerEmptyVisual(id: string, empty: boolean): void {
    const obj = this.containerObjs.get(id);
    if (!obj) return;
    const c = this.floorView.containers.find((x) => x.id === id);
    const label = c?.label ?? id;
    // Crates get real art for their opened state. Fading to 0.35 was the only
    // signal a crate had been looted, and at 0.35 a crate reads as a rendering
    // bug rather than as a crate someone got to first.
    if (id.startsWith('bunk') && obj.box instanceof Phaser.GameObjects.Image) {
      // A searched bunk keeps its frame and loses its kit.
      obj.box.setTexture(empty ? 'env-bunk-empty' : 'env-bunk-loaded');
      obj.box.setAlpha(1);
    }
    const isCrate = id === 'crate_wood' || id === 'crate_metal';
    if (isCrate && obj.box instanceof Phaser.GameObjects.Image) {
      const opened = getGame().currentFloor % 3 === 0 ? 'env-crate-broken' : 'env-crate-forced';
      const key = empty ? opened : 'env-crate-intact';
      if (key && this.textures.exists(key)) {
        obj.box.setTexture(key);
        obj.box.setAlpha(1);
      }
    } else {
      obj.box.setAlpha(empty ? 0.35 : 1);
    }
    obj.label.setText(empty ? `${label}（空）` : label);
    // The plate is fitted to the text, so "（空）" has to re-fit it or the extra
    // two glyphs hang off the edge of the backing.
    obj.plate.setDisplaySize(Math.ceil(estimateTextWidth(obj.label.text, CONTAINER_LABEL_FONT)) + 14, CONTAINER_LABEL_FONT + 8);
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

  // The dorm's other beds, each with a roommate asleep in it.
  //
  // Floor 1 is the player's dormitory, and it used to read as a store-room: one
  // cabinet, one workbench, the player's own bed, and seeded debris everywhere
  // else. A dorm is people asleep, so the room now has five more beds along the
  // wall, each with a figure under a blanket.
  //
  // The figures are drawn rather than sprited on purpose: there is no lying pose
  // in any character sheet (the walk sheets are 64x96 standing side views), and
  // rotating one would resample it. A blanket, a head and a hairline read as
  // "someone sleeping" at this size, which is the whole job.
  // One bed, drawn in a shallow 3/4 view: a parallelogram for the mattress top,
  // a front face below it, a headboard at the head end and a foot board at the
  // foot. The top face is the whole point - a flat side view read as a drawing
  // of a bed, and the sliver of visible sheet is what makes it read as an object
  // standing in a room.
  //
  // `scale` < 1 is used for the back row: smaller and higher on the wall, which
  // is the depth cue, and the caller tints it to push it further back.
  private drawBed3D(
    g: Phaser.GameObjects.Graphics,
    x: number,
    floorY: number,
    o: { blanket: number; fold: number; scale: number; sleeper: boolean },
  ): void {
    const s = o.scale;
    const W = Math.round(80 * s); // bed length along the floor
    const H = Math.round(18 * s); // frame height off the floor
    const D = Math.round(18 * s); // how far back the mattress top sits
    const HUMP = Math.round(11 * s); // how high the blanket rides over the body
    const y0 = floorY - H; // the mattress' front edge
    const y1 = y0 - D; // ...and its back edge
    const quad = (pts: Array<[number, number]>, color: number): void => {
      g.fillStyle(color, 1);
      g.fillPoints(pts.map(([px, py]) => new Phaser.Math.Vector2(Math.round(px), Math.round(py))), true, true);
    };

    // Floor contact shadow, so the bed is standing on something.
    g.fillStyle(PALETTE.ink, 0.4 * s);
    g.fillRect(x - 4 * s, floorY - 2, W + 10 * s, 3);

    // Mattress top: the sheet, as a parallelogram leaning back. The sheet shows
    // at the head end and along the front edge - that band is what sells the
    // third dimension.
    quad(
      [
        [x, y0],
        [x + W, y0],
        [x + W + 5 * s, y1],
        [x + 5 * s, y1],
      ],
      0x3a352e,
    );
    // Frame front face below the mattress, with a lit top edge where the sheet
    // overhangs it.
    quad(
      [
        [x, y0],
        [x + W, y0],
        [x + W, floorY],
        [x, floorY],
      ],
      0x3a2c1c,
    );
    quad(
      [
        [x, y0],
        [x + W, y0],
        [x + W, y0 + 2 * s],
        [x, y0 + 2 * s],
      ],
      0x4a3a28,
    );
    // Frame legs at both ends.
    g.fillStyle(0x2a2018, 1);
    g.fillRect(x + 3 * s, floorY - 2, 5 * s, 2);
    g.fillRect(x + W - 8 * s, floorY - 2, 5 * s, 2);

    if (o.sleeper) {
      // Pillow at the head end.
      quad(
        [
          [x + 5 * s, y1 + 1 * s],
          [x + 22 * s, y1 + 1 * s],
          [x + 24 * s, y0 - 1 * s],
          [x + 7 * s, y0 - 1 * s],
        ],
        0x64646e,
      );
      // The blanket: one quad whose back edge rides HUMP above the mattress'
      // back edge. That rise is the body under it - a blanket laid flat on the
      // mattress read as a green placemat.
      quad(
        [
          [x + 20 * s, y1 - HUMP],
          [x + W + 5 * s, y1 - HUMP],
          [x + W + 5 * s, y0 - 1 * s],
          [x + 22 * s, y0 - 1 * s],
        ],
        o.blanket,
      );
      // Fold across the chest, and the lit top edge of the blanket.
      quad(
        [
          [x + 20 * s, y1 - HUMP],
          [x + W + 5 * s, y1 - HUMP],
          [x + W + 5 * s, y1 - HUMP + 2 * s],
          [x + 20 * s, y1 - HUMP + 2 * s],
        ],
        o.fold,
      );
      quad(
        [
          [x + 20 * s, y1 - HUMP],
          [x + W + 5 * s, y1 - HUMP],
          [x + W + 5 * s, y1 - HUMP + 1 * s],
          [x + 20 * s, y1 - HUMP + 1 * s],
        ],
        PALETTE.clothHigh,
      );
      // A drape over the mattress' front edge, so the blanket has thickness.
      quad(
        [
          [x + 22 * s, y0 - 1 * s],
          [x + W + 5 * s, y0 - 1 * s],
          [x + W + 5 * s, y0 + 3 * s],
          [x + 22 * s, y0 + 3 * s],
        ],
        o.fold,
      );
      // Head: skin, hair across the top, the far side in shadow.
      const hx = x + 13 * s;
      const hy = y1 - HUMP - 5 * s;
      g.fillStyle(PALETTE.skinLight, 1);
      g.fillCircle(hx, hy, Math.max(3, Math.round(6 * s)));
      g.fillStyle(PALETTE.ink, 1);
      g.fillRect(hx - Math.round(6 * s), hy - Math.round(7 * s), Math.round(13 * s), Math.max(2, Math.round(4 * s)));
      g.fillStyle(PALETTE.skinDeep, 1);
      g.fillRect(hx + Math.round(1 * s), hy + Math.round(1 * s), Math.round(5 * s), Math.max(2, Math.round(3 * s)));
    } else {
      // An unused bed: the blanket folded back at the foot, mattress bare.
      quad(
        [
          [x + 5 * s, y1 + 1 * s],
          [x + W + 5 * s, y1 + 1 * s],
          [x + W + 5 * s, y0 - 1 * s],
          [x + 5 * s, y0 - 1 * s],
        ],
        o.blanket,
      );
    }

    // Headboard standing off the mattress at the head end, and a foot board at
    // the foot end. Both are boards rather than frames: the camera sees their
    // edge, which is another depth cue.
    quad(
      [
        [x - 5 * s, y1],
        [x - 1 * s, y1 - 4 * s],
        [x - 1 * s, floorY],
        [x - 5 * s, floorY],
      ],
      0x6a4a2a,
    );
    quad(
      [
        [x - 3 * s, y1],
        [x - 1 * s, y1 - 4 * s],
        [x - 1 * s, floorY],
        [x - 3 * s, floorY],
      ],
      0x8a6a3a,
    );
    quad(
      [
        [x + W + 5 * s, y1],
        [x + W + 9 * s, y1 - 4 * s],
        [x + W + 9 * s, floorY],
        [x + W + 5 * s, floorY],
      ],
      0x6a4a2a,
    );
  }

  // The dorm's other beds, and the roommates asleep in them.
  //
  // Floor 1 used to read as a store-room: one cabinet, one workbench, the
  // player's own bed, and seeded debris everywhere else. A dorm is people asleep
  // in a crowded room, so there are now two rows - a back row set higher and
  // smaller for depth, and a front row on the floor line - with a figure under
  // every blanket.
  //
  // The figures are drawn rather than sprited on purpose: no character sheet has
  // a lying pose (the walk sheets are 64x96 standing side views) and rotating one
  // would resample it. A torso over lower legs, a fold, a lit edge and a head
  // read as "someone sleeping" at this size, which is the whole job.
  private drawDormBeds(front: readonly number[], back: readonly number[]): void {
    const floorY = FLOOR_HEIGHT - 60; // the front row's floor line
    const backY = floorY - 26; // the back row stands further from the camera
    const g = this.add.graphics().setDepth(4);
    this.floorObjects.push(g);
    const backG = this.add.graphics().setDepth(2);
    this.floorObjects.push(backG);

    // Back row first, so the front row overlaps it.
    // The beds are the art pack's now, not the procedural ones: the same bunk
    // that stands in every corridor of the tower. The back row keeps its 0.72
    // scale and its lower depth so the front row still overlaps it.
    back.forEach((x) => {
      const bed = this.add.image(x, backY, 'env-bunk-sleeper').setOrigin(0.5, 1).setScale(0.72).setDepth(2);
      this.floorObjects.push(bed);
    });

    // Pitch 96, so the row is crowded - beds nearly touching.
    front.forEach((x, i) => {
      const bed = this.add.image(x, floorY, 'env-bunk-sleeper').setOrigin(0.5, 1).setDepth(4);
      this.floorObjects.push(bed);
      this.floorObjects.push(...addContactShadow(this, x + 40, floorY + 2, 70, 2, 0.35));

      // Label and Z sit above the headboard line and beside the head. Both are
      // placed against the bed's own top (floorY-58 for a sleeper), not against a
      // fixed offset from the floor: a taller bed pushed the label into the
      // sleeper's hair.
      // Depth 3: above the corridor's wall dressing (1-2), below the front row's
      // own beds (4). On floor 1 nothing sits at 3, so this changes nothing
      // there; on floor 2 the conduits and signage would otherwise print
      // straight through these labels.
      const label = this.add
        .text(x + 41, floorY - 64, '室友', { fontFamily: FONT_FAMILY, fontSize: '18px', color: hex(TEXT.dim) })
        .setOrigin(0.5)
        .setDepth(3);
      const z = this.add
        .text(x + 72, floorY - 52, 'Z z', { fontFamily: FONT_FAMILY, fontSize: '16px', color: hex(TEXT.dim) })
        .setOrigin(0.5)
        .setDepth(3);
      this.floorObjects.push(label, z);
      this.dormSleepers.push({ z, baseY: z.y, phase: i * 1.7 });
    });

    // The back row gets its labels too, dimmer, so the two rows do not compete.
    back.forEach((x, i) => {
      const z = this.add
        .text(x + 36, backY - 38, 'Z z', { fontFamily: FONT_FAMILY, fontSize: '14px', color: hex(TEXT.disabledDeep) })
        .setOrigin(0.5)
        .setDepth(3);
      this.floorObjects.push(z);
      this.dormSleepers.push({ z, baseY: z.y, phase: 3.4 + i * 1.3 });
    });
  }

  // The player's own bed, in the same 3/4 view as the roommates' so the row
  // reads as one set of furniture rather than a sprite next to drawings.
  private drawBed(): void {
    const floorY = FLOOR_HEIGHT - 60;
    const g = this.add.graphics().setDepth(4);
    this.floorObjects.push(g);
    this.drawBed3D(g, BED_X - 41, floorY, {
      blanket: PALETTE.clothDeep,
      fold: PALETTE.cloth,
      scale: 1,
      sleeper: false,
    });
    this.floorObjects.push(...addContactShadow(this, BED_X, floorY + 2, 70, 2, 0.35));
    // AG-11：depth 105 压在 HUD 上下文带（100）与其 chrome（101）之上。旧位置
    // 不设 depth 时整块落在带里，像素实测 max lum=33，22px 标签一个像素都不显。
    const bedLabel = this.add
      .text(BED_X, floorY - 62, '床（睡觉）', { fontFamily: FONT_FAMILY, fontSize: '22px', color: hex(TEXT.primary) })
      .setOrigin(0.5)
      .setDepth(105);
    this.floorObjects.push(bedLabel);
  }

  // ── HUD & inventory UI ─────────────────────────────────────────────────
  private buildHud(): void {
    // A scene restart keeps the display list — Phaser 4's shutdown only nulls
    // the textures — and field initialisers do not re-run, so the previous
    // run's HUD objects would both double up on screen and throw on the first
    // setText/setColor (a stale Text's glTexture is null). Destroy and reset
    // everything this method owns before rebuilding.
    this.statLabels = [];
    this.statValues = [];
    this.lastGoalKey = '';
    this.environmentText?.destroy();
    this.environmentText = undefined;
    this.envRegionText?.destroy();
    this.envRegionText = undefined;
    this.envHumidText?.destroy();
    this.envHumidText = undefined;
    this.envNightText?.destroy();
    this.envNightText = undefined;
    this.hudIcons?.destroy();
    this.hudIcons = undefined;
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

    // The 2026-11-14 HUD skin: one riveted plate holding three rows —
    // instruments, the day's objective, the environment readout. See
    // render/hudSkin.ts for why this is drawn rather than dropped in as the
    // concept PNGs.
    const hud = HUD_LAYOUT;
    this.add.rectangle(0, 0, DESIGN_WIDTH, hud.contextBottom, UI.surface).setOrigin(0).setAlpha(0.98).setScrollFactor(0).setDepth(100);
    const plate = this.add.graphics().setScrollFactor(0).setDepth(101);
    drawHudPlate(plate, DESIGN_WIDTH, hud.contextBottom, 0x0b0f12, UI.line, PALETTE.stoneLight, PALETTE.light);
    // Group dividers: floor block | stats | money.
    plate.fillStyle(UI.line, 0.85);
    plate.fillRect(268, 12, 1, hud.topHeight - 24);
    plate.fillRect(hud.moneyX - 16, 12, 1, hud.topHeight - 24);
    // Row separators.
    plate.fillRect(16, hud.topHeight, DESIGN_WIDTH - 32, 1);
    plate.fillRect(16, hud.environmentY - 10, DESIGN_WIDTH - 32, 1);
    // The concept's hazard stripe under the right end of the environment row.
    drawHazardStripe(plate, hud.hazardX, hud.environmentY - 6, 176, 12, PALETTE.lightDeep);

    // Static glyphs. Only the numbers and the two context rows move, so the
    // icons are drawn once here and never touched again.
    this.hudIcons = this.add.graphics().setScrollFactor(0).setDepth(103);
    const icon = (name: HudIconName, x: number, y: number, color: number): void => {
      drawHudIcon(this.hudIcons as Phaser.GameObjects.Graphics, name, x, y, 16, color);
    };
    icon('tower', 20, hud.row1Y, PALETTE.lightHigh);
    icon('calendar', 20, hud.row1Y + 28, TEXT.secondary);
    icon('coins', hud.moneyX, hud.row1Y, PALETTE.light);
    icon('star', hud.moneyX, hud.row1Y + 28, TEXT.highlight);
    icon('clipboard', 20, hud.goalY - 4, PALETTE.lightHigh);
    hud.envChipX.forEach((cx, i) => {
      const names: HudIconName[] = ['thermo', 'wind', 'drop', 'moon'];
      icon(names[i], cx, hud.environmentY - 4, i === 0 ? PALETTE.light : TEXT.secondary);
    });
    STAT_BARS.forEach((stat, i) => icon(stat.icon, hud.statX + i * hud.statPitch, hud.row1Y, STAT_COLORS[stat.key]));

    this.floorBadge = this.add.text(46, hud.row1Y - 2, '', { fontFamily: FONT_FAMILY, fontSize: '20px', color: hex(PALETTE.lightHigh) })
      .setName('hud-floor').setScrollFactor(0).setDepth(103);
    this.clockText = this.add.text(42, hud.row1Y + 28, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.primary) })
      .setName('hud-clock').setScrollFactor(0).setDepth(103);
    this.refreshClock();

    this.barsGfx = this.add.graphics().setName('hud-stat-bars').setScrollFactor(0).setDepth(103);
    STAT_BARS.forEach((stat, i) => {
      const x = hud.statX + i * hud.statPitch;
      this.statLabels.push(this.add.text(x + 24, hud.row1Y, stat.label, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.secondary) })
        .setName(`hud-stat-${stat.key}`).setScrollFactor(0).setDepth(103));
      this.statValues.push(this.add.text(x + hud.statWidth, hud.row1Y, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.primary) })
        .setOrigin(1, 0).setName(`hud-value-${stat.key}`).setScrollFactor(0).setDepth(103));
    });
    this.refreshStats();

    this.goldText = this.add.text(hud.moneyX + 24, hud.row1Y, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(PALETTE.lightHigh) })
      .setOrigin(0, 0).setName('hud-gold').setScrollFactor(0).setDepth(103);
    this.scoreText = this.add.text(hud.moneyX + 24, hud.row1Y + 28, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.highlight) })
      .setOrigin(0, 0).setName('hud-score').setScrollFactor(0).setDepth(103);

    this.goalText = this.add.text(44, hud.goalY, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(PALETTE.lightHigh) })
      .setName('hud-goal').setScrollFactor(0).setDepth(HUD_FEEDBACK_DEPTH);
    // Four environment chips. Each owns one reading, so a player scanning for
    // "is it night" does not have to parse a sentence.
    const chip = (x: number, name: string, color: string): Phaser.GameObjects.Text =>
      this.add.text(x + 24, hud.environmentY, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color })
        .setName(name).setScrollFactor(0).setDepth(HUD_FEEDBACK_DEPTH);
    this.environmentText = chip(hud.envChipX[0], 'hud-environment', hex(TEXT.secondary));
    this.envRegionText = chip(hud.envChipX[1], 'hud-region', hex(TEXT.secondary));
    this.envHumidText = chip(hud.envChipX[2], 'hud-humid', hex(TEXT.secondary));
    this.envNightText = chip(hud.envChipX[3], 'hud-night', hex(TEXT.secondary));

    // Feedback has a dedicated lower lane. It remains above modal panels but
    // can never collide with the daily objective or the permanent environment.
    this.feedbackText = this.add.text(20, hud.feedbackY, '', {
      fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: hex(PALETTE.lightHigh),
      backgroundColor: '#0b0f12ee', padding: { x: 8, y: 5 }, wordWrap: { width: 1216 },
    }).setName('hud-feedback').setScrollFactor(0).setDepth(HUD_FEEDBACK_DEPTH);
    this.bagFullText = this.add.text(20, hud.bagY,
      '背包已满 · 使用、制作或交易腾出格子，否则搜刮会留在原处；能叠进已有堆的物品仍可拾取',
      { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.warn), backgroundColor: '#0b0f12ee', padding: { x: 8, y: 3 }, wordWrap: { width: 1216 } },
    ).setName('hud-bag-full').setScrollFactor(0).setDepth(HUD_FEEDBACK_DEPTH).setVisible(false);

    // ── the foot bar ────────────────────────────────────────────────────────
    this.add.rectangle(0, DESIGN_HEIGHT - HUD_FOOT_H, DESIGN_WIDTH, HUD_FOOT_H, UI.surface).setOrigin(0, 0).setAlpha(0.88).setScrollFactor(0).setDepth(100);
    const footLine = this.add.graphics().setScrollFactor(0).setDepth(101);
    footLine.fillStyle(UI.line, 0.9);
    footLine.fillRect(0, DESIGN_HEIGHT - HUD_FOOT_H, DESIGN_WIDTH, 1);
    this.hintText = this.add
      .text(8, DESIGN_HEIGHT - HUD_FOOT_H / 2, 'A/D 移动 · E 交互 · I 背包 · C 制作 · M 地图 · ESC 菜单', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.highlight) })
      .setOrigin(0, 0.5).setName('hud-hint').setScrollFactor(0).setDepth(HUD_FEEDBACK_DEPTH);

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
      band(DESIGN_WIDTH - inset - T, 0, T, DESIGN_HEIGHT, weight); // right
    }
    this.lastStats = '';
    this.refreshGoalHud();
    this.buildHudButtons();
  }

  // Four clickable buttons for the four panels the keyboard opens. Placed on the
  // bottom-right, above the key legend: the top bar is already full (four stat
  // bars, floor badge, clock, gold, score) and the panel row would have sat on
  // top of the world's floor labels.
  //
  // Every one of them goes through the same guard the keyboard path uses, and
  // refuses to open a second panel on top of an open one — except its own, which
  // toggles closed.
  private buildHudButtons(): void {
    for (const o of this.hudButtons) o.destroy();
    this.hudButtons = [];
    const items: Array<{ label: string; run: () => void; owned: () => boolean }> = [
      { label: '背包 I', run: () => this.onToggleInventory(), owned: () => this.inventoryOpen },
      { label: '制作 C', run: () => this.onToggleCrafting(), owned: () => this.craftingOpen },
      { label: '产业 G', run: () => this.onToggleVentures(), owned: () => this.ventureOpen },
      { label: '地图 M', run: () => this.onToggleMap(), owned: () => false },
      { label: '菜单', run: () => this.onEsc(), owned: () => this.pauseOpen },
    ];
    const W = 88;
    const H = 26;
    const GAP = 6;
    const total = items.length * W + (items.length - 1) * GAP;
    let x = DESIGN_WIDTH - 16 - total;
    const y = DESIGN_HEIGHT - 56;
    for (const item of items) {
      const parts = framedButton(
        this,
        x,
        y,
        W,
        H,
        item.label,
        104,
        () => {
          if (this.stairClimb) return;
          if (this.anyPanelOpen() && !item.owned()) return;
          item.run();
        },
        { fill: UI.surfaceRaised, line: UI.line, text: hex(TEXT.primary), hover: PALETTE.stoneLight },
      );
      for (const part of parts) {
        const withScroll = part as unknown as { setScrollFactor?: (v: number) => unknown };
        withScroll.setScrollFactor?.(0);
        this.hudButtons.push(part);
      }
      x += W + GAP;
    }
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
      this.goalText.setText(`目标 ${label}${done ? ' ✓' : ''} · 压力 ${stress}`);
      this.goalText.setColor(done ? hex(TEXT.highlight) : hex(PALETTE.lightHigh));
    }
    this.scoreText.setText(`分数 ${runScore(state)}`);
    this.goldText?.setText(`金币 ${state.player.gold}`);
    this.scoreText.setFontSize(TYPE.caption);
    if (this.scoreText.width > 240) this.scoreText.setFontSize(18);
    if (this.goldText) {
      this.goldText.setFontSize(TYPE.caption);
      if (this.goldText.width > 240) this.goldText.setFontSize(18);
    }
    this.fitHudLine(this.goalText, 1200);
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

  private refreshClock(): void {
    const s = getGame();
    const label = hudClockLabel(s.day, s.gameMinuteOfDay);
    if (label !== this.lastClock) {
      this.lastClock = label;
      this.clockText.setText(label);
    }
    this.floorBadge?.setText(`第${s.currentFloor}层`);
    this.fitHudLine(this.clockText, 164);
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
      const x = HUD_LAYOUT.statX + i * HUD_LAYOUT.statPitch;
      const color = STAT_COLORS[STAT_BARS[i].key] ?? UI.good;
      // 10 segments at 10px: the concept sheet's bar, which reads as discrete
      // pips rather than one continuous fill.
      drawStatBar(this.barsGfx, x, HUD_LAYOUT.barY, HUD_LAYOUT.statWidth, HUD_LAYOUT.barH, v / 100, color, HUD_LAYOUT.barSegments);
      this.statValues[i]?.setText(String(Math.round(v)));
    });
    // The most urgent bar's label turns red, so the critical slot is findable
    // without reading four numbers.
    const urgent = mostUrgentStat(getGame().player);
    this.statLabels.forEach((t, i) => t.setColor(STAT_BARS[i].key === urgent ? hex(TEXT.warn) : hex(TEXT.secondary)));
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
    if (!this.environmentText || !this.envRegionText || !this.envHumidText || !this.envNightText) return;
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
    // An ailment outranks the weather: being ill is more urgent than being
    // chilly, and this row is the only place either is stated.
    const ill = ailmentLabel(state);
    const env = environmentFor(state.currentFloor);
    const night = isNight(state.gameMinuteOfDay);

    this.environmentText.setText(`${TEMP_LABEL} ${Math.round(temp)} ${mood}`);
    this.environmentText.setColor(temp <= COLD_THRESHOLD || ill !== '' ? hex(TEXT.warn) : hex(TEXT.secondary));

    // Region, with the player's own state folded in when there is any — an
    // ailment, a sickness tier and a sagging morale are properties of the
    // survivor, not of the floor, so they ride on the region chip rather than
    // getting a fifth slot. TWOM 对齐 §1/§2：疾病三档与心情点数终于有读数。
    // 只在该报警时报——士气高涨不必占这一行，低落必须占。
    const tier = sicknessOf(state);
    const sagging = moraleBandOf(state) === 'low';
    const flags: string[] = [];
    if (ill !== '') flags.push(ill);
    if (tier !== 'healthy') flags.push(SICKNESS_TIER_LABEL[tier]);
    if (sagging) flags.push(moraleLabel(state));
    this.envRegionText.setText(`区域 ${flags.length ? `${flags.join(' · ')} · ` : ''}${env.label}`);
    this.envRegionText.setColor(ill !== '' || tier !== 'healthy' || sagging ? hex(TEXT.warn) : hex(TEXT.secondary));

    this.envHumidText.setText(env.humidity >= 0.5 ? '潮湿' : '干燥');
    this.envNightText.setText(env.hostile && night ? '夜间危险' : night ? '夜间' : '安全');

    this.fitHudLine(this.envRegionText, HUD_LAYOUT.envChipX[2] - HUD_LAYOUT.envChipX[1] - 28);
    this.fitHudLine(this.envHumidText, HUD_LAYOUT.envChipX[3] - HUD_LAYOUT.envChipX[2] - 28);
    this.fitHudLine(this.envNightText, HUD_LAYOUT.hazardX - HUD_LAYOUT.envChipX[3] - 28);
  }

  private buildInventoryPanel(): void {
    // OVERHAUL UI: this panel used to be a 380x340 box holding twelve rows of
    // "name ×count" text in 13px monospace — measured, 46% of the whole screen
    // was one flat colour. It is now an icon grid on the left and a detail pane
    // on the right: the icons carry the identity, the pane carries the words,
    // and neither one is a wall of text.
    const { width, height } = this.viewSize();
    const panelW = 440;
    const panelH = 236;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    // Remembered for the mouse: a click outside this rectangle closes the panel.
    this.panelBox = { x: left, y: top, w: panelW, h: panelH };
    const depth = PANEL_DEPTH.game.inventory;

    this.invObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'item', depth));
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
    const GRID_X = left + 12;
    const GRID_Y = top + 30;
    const CELL = 40;
    const GAP = 5;
    this.invCells = [];
    this.invSlotIcons = [];
    this.invSlotTexts = [];
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = GRID_X + col * (CELL + GAP);
      const y = GRID_Y + row * (CELL + GAP);
      const cell = this.add.rectangle(x, y, CELL, CELL, 0x080c0f).setOrigin(0, 0).setAlpha(0.6).setDepth(depth + 5);
      const border = this.add.graphics().setDepth(depth + 6);
      border.lineStyle(1, UI.line, 0.85);
      border.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
      const icon = this.add
        .image(x + CELL / 2, y + CELL / 2, 'blank')
        .setOrigin(0.5)
        .setScale(2)
        .setDepth(depth + 6);
      const badge = this.add
        .text(x + CELL - 3, y + CELL - 3, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.primary), stroke: hex(PALETTE.ink), strokeThickness: 3 })
        .setOrigin(1, 1)
        .setDepth(depth + 7);
      this.invCells.push(cell);
      this.invSlotIcons.push(icon);
      this.invSlotTexts.push(badge);
      this.invObjects.push(cell, border, icon, badge);
      // Mouse: click selects; clicking the already-selected slot uses the item,
      // which is what Enter does. Pushed into invObjects so it hides with the
      // panel — an orphan hit rect would keep eating clicks over the world.
      this.invObjects.push(
        this.panelHit( x, y, CELL, CELL, depth + 8, {
          onOver: () => {
            if (this.invSelected === i) return;
            this.invSelected = i;
            this.refreshInventory();
          },
          onClick: () => {
            if (this.invSelected !== i) {
              this.invSelected = i;
              this.refreshInventory();
              playSfx('click');
              return;
            }
            this.onUse();
          },
        }),
      );
    }

    // ── the detail pane ─────────────────────────────────────────────────────
    const DETAIL_X = GRID_X + 4 * (CELL + GAP) + 8;
    const DETAIL_W = left + panelW - 12 - DETAIL_X;
    this.invObjects.push(...buildPanelWell(this, DETAIL_X, GRID_Y, DETAIL_W, 3 * (CELL + GAP) - GAP, depth + 5));
    // Three rows at 10 / 48 / 76. They used to be at 10 / 28 / 46, which only
    // worked because SimSun's glyphs sit inside a much smaller ink box than the
    // em size; a pixel face fills the whole em, so the 30px name ran straight
    // through the 20px meta line and the body through both.
    this.invDetailName = this.add
      .text(DETAIL_X + 8, GRID_Y + 10, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.title}px`, color: hex(PALETTE.lightHigh) })
      .setDepth(depth + 7);
    this.invDetailMeta = this.add
      .text(DETAIL_X + 8, GRID_Y + 48, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.dim) })
      .setDepth(depth + 7);
    this.invDetailBody = this.add
      // useAdvancedWrap is load-bearing, fourth time in this codebase: the basic
      // wrapper breaks on spaces only, and Chinese has none, so a width here is
      // silently ignored. Measured: the empty-slot sentence rendered 688px wide
      // inside a 520px panel, i.e. it ran 248px past the frame.
      .text(DETAIL_X + 8, GRID_Y + 76, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: hex(TEXT.primary), wordWrap: { width: DETAIL_W - 16, useAdvancedWrap: true } })
      .setDepth(depth + 7);
    this.invObjects.push(this.invDetailName, this.invDetailMeta, this.invDetailBody);

    const footer = this.add
      .text(cx, top + panelH - 12, '↑/↓ 选择 · Enter 使用 · I 关闭', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(PALETTE.clothHigh) })
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
        //
        // No setVisible(true): refreshInventory() also runs while the panel is
        // CLOSED — looting a container, a shop trade and a neighbour trade all
        // call it. Showing the icon here used to float the bag's first row over
        // the world with no panel behind it: four icons straddling the top
        // frame of whatever panel happened to be open. Visibility is
        // toggleInventory's job — it sets the whole list, and the empty slots
        // below hide themselves again.
        icon.setTexture(itemIconKey(stack.itemId));
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
    // Same rule as the icons: the marker belongs to the open panel.
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
    // Safety net for the next caller that forgets: with the panel closed there
    // is nothing of the bag on screen, whatever the data did on the way here.
    if (!this.inventoryOpen) for (const o of this.invObjects) o.setVisible(false);
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
    this.feedbackTimer?.remove(false);
    this.feedbackTimer = this.time.delayedCall(1600, () => this.feedbackText.setText(''));
  }

  private applyNightLighting(): void {
    const state = getGame();
    const night = nightOverlayAlpha(state);
    this.nightOverlay.setAlpha(night);
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
    this.leakObjects = buildLeakEffect(this, { width: this.floorW, floorY, seed: floor * 31 });
    // remember where the puddles are, so the drips can land in them
    this.leakPuddleXs = [];
    for (let i = 0; i < 7; i++) {
      const hh = (n: number): number => {
        const v = Math.sin(floor * 31 + i * 7.7 + n) * 10000;
        return v - Math.floor(v);
      };
      this.leakPuddleXs.push(60 + hh(1) * (this.floorW - 120));
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
    // AG-11: depth 0 → 105，与床标签、容器名签同线（同一个 HUD 上下文带吞字
    // 问题，UI.md 12b：工作台招牌旧实测 max lum=33，完全不可见）。
    const benchLabel = this.add.text(CRAFT_X, y + 4 - bench.displayHeight - 8, '工作台', { fontFamily: FONT_FAMILY, fontSize: '22px', color: hex(TEXT.primary) }).setOrigin(0.5).setDepth(105);
    this.upgradeBoard = this.add.text(CRAFT_X, y + 34, '', { fontFamily: FONT_FAMILY, fontSize: '22px', color: hex(PALETTE.clothHigh) }).setOrigin(0.5);
    this.floorObjects.push(bench, benchLabel, this.upgradeBoard);
    this.refreshUpgradeBoard();
  }

  private refreshUpgradeBoard(): void {
    if (!this.upgradeBoard) return;
    const owned = getGame().player.homeUpgrades;
    const built = owned.filter((id) => !isPassUpgrade(id)).map((id) => getRecipe(id as UpgradeId).displayName);
    const passes = owned.filter((id) => isPassUpgrade(id)).map((id) => getRecipe(id as UpgradeId).displayName);
    // Two lines, because an eight-recipe list on one line ran past the workbench
    // and into the wall. Passes get their own line so the player can see what the
    // crafting panel keeps asking them for.
    const facilities = built.length > 0 ? `已建：${built.join('、')}` : '';
    const credentials = passes.length > 0 ? `凭证：${passes.join('、')}` : '';
    this.upgradeBoard.setText([facilities, credentials].filter(Boolean).join('\n'));
  }

  private buildCraftPanel(): void {
    const { width, height } = this.viewSize();
    // 530, not 460: eight recipes means the longest row is a four-character name
    // plus three materials, and at 460 it ran under the right-aligned status
    // column (screenshot: 核心权限's cost sat on top of 缺前置).
    const panelW = 530;
    // 30 header + CRAFT_ROWS rows at the font's line box + the AG-44 detail
    // block (effect / tier / hints) + footer clearance.
    // This was 300, sized when the pitch was 24; at the measured 30 the last
    // row and the footer ran past the bottom edge. AG-44 added the detail
    // block below the rows, so the panel grew by CRAFT_DETAIL_H (its comment
    // carries the line budget) — the whole card still clears the HUD bands
    // (60 top / 40 foot) inside the 720 canvas.
    const panelH = 30 + CRAFT_VISIBLE_ROWS * CRAFT_ROW_PITCH + 12 + CRAFT_DETAIL_H + 40;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    // Remembered for the mouse: a click outside this rectangle closes the panel.
    this.panelBox = { x: left, y: top, w: panelW, h: panelH };

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
    for (let i = 0; i < CRAFT_VISIBLE_ROWS; i++) {      const rowY = top + 30 + i * CRAFT_ROW_PITCH;
      const band = this.add.rectangle(left + 8, rowY, panelW - 16, CRAFT_ROW_PITCH - 2, UI.surfaceRaised).setOrigin(0, 0).setAlpha(0.34).setDepth(PANEL_DEPTH.game.craft + 5);
      // Centre on the row, not on a hand-tuned offset: the row IS the font's
      // line box now, so the middle of the pitch is the middle of the text.
      const name = this.add.text(left + 18, rowY + CRAFT_ROW_PITCH / 2, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: hex(TEXT.primary) }).setOrigin(0, 0.5).setDepth(PANEL_DEPTH.game.craft + 6);
      const status = this.add.text(left + panelW - 24, rowY + CRAFT_ROW_PITCH / 2, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.highlight) }).setOrigin(1, 0.5).setDepth(PANEL_DEPTH.game.craft + 6);
      this.craftRows.push({ band, name, status });
      this.craftObjects.push(band, name, status);
      this.craftObjects.push(
        this.panelHit( left + 8, rowY, panelW - 16, CRAFT_ROW_PITCH - 2, PANEL_DEPTH.game.craft + 7, {
          onOver: () => {
            const index = this.craftFirst + i;
            if (this.craftSelected === index) return;
            this.craftSelected = index;
            this.refreshCraft();
          },
          onClick: () => {
            const index = this.craftFirst + i;
            if (this.craftSelected !== index) {
              this.craftSelected = index;
              this.refreshCraft();
              playSfx('click');
              return;
            }
            this.onUse();
          },
        }),
      );
    }
    // AG-44：详情块——效果预览、档位/前置读数、缺料出处。修前面板只有
    // 名称+材料，玩家在按 Enter 前看不到「做出来会怎样」（effect）、
    // 「这条属于更高档位」（tierNote）、「差的料去哪拿」（hints）。
    // 三份数据都由 AG-42 的 recipePreview / canCraft 打包好（docs/plans/
    // CRAFT.md §5 的交接），这里只负责排版：行内起点在最后一行 band 之下
    // 12px（与旧 craftReqText 同一锚点），宽度吃面板内边距 18px。
    const detailX = left + 18;
    const detailW = panelW - 36;
    const detailY = top + 30 + CRAFT_VISIBLE_ROWS * CRAFT_ROW_PITCH + 12;
    this.craftDetailY = detailY;
    const detailText = (color: string): Phaser.GameObjects.Text =>
      this.add
        .text(detailX, detailY, '', {
          fontFamily: FONT_FAMILY,
          fontSize: `${TYPE.caption}px`,
          color,
          wordWrap: { width: detailW, useAdvancedWrap: true },
        })
        .setOrigin(0, 0)
        .setDepth(PANEL_DEPTH.game.craft + 6);
    this.craftDetailTexts = {
      effect: detailText(hex(TEXT.primary)),
      tier: detailText(hex(TEXT.dim)),
      hints: detailText(hex(TEXT.warn)),
    };
    this.craftObjects.push(this.craftDetailTexts.effect, this.craftDetailTexts.tier, this.craftDetailTexts.hints);
    const footer = this.add.text(cx, top + panelH - 12, '↑/↓ 选择 · Enter 制作 · C 关闭', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(PALETTE.clothHigh) }).setOrigin(0.5).setDepth(PANEL_DEPTH.game.craft + 6);
    this.craftObjects.push(footer, this.craftMarker);

    applyPanelDepth(this.craftObjects, PANEL_DEPTH.game.craft);
    this.assertPanelContent('craft', this.craftObjects);
    for (const o of this.craftObjects) o.setVisible(false);
  }

  private craftEntries(): Array<{ kind: 'recipe' | 'purify'; id?: RecipeId }> {
    const entries: Array<{ kind: 'recipe' | 'purify'; id?: RecipeId }> = RECIPES.map((r) => ({ kind: 'recipe', id: r.id }));
    if (hasUpgrade(getGame(), 'purifier')) entries.push({ kind: 'purify' });
    return entries;
  }

  private refreshCraft(): void {
    const state = getGame();
    const entries = this.craftEntries();
    if (this.craftSelected >= entries.length) this.craftSelected = Math.max(0, entries.length - 1);
    // The list can be one entry longer than the rows — the purify entry appears
    // once the purifier is built — so the window slides instead of letting the
    // selection sit on a row that is not drawn.
    const rows = this.craftRows.length;
    const first = Math.max(0, Math.min(this.craftSelected - rows + 1, entries.length - rows));
    this.craftFirst = first;
    for (let i = 0; i < rows; i++) {      const row = this.craftRows[i];
      if (!row) continue;
      const index = first + i;
      const entry = entries[index];
      if (!entry) {
        row.name.setText('');
        row.status.setText('');
        row.band.setAlpha(0);
        continue;
      }
      const selected = index === this.craftSelected;
      row.band.setAlpha(selected ? 0.72 : 0.3);
      row.band.setFillStyle(selected ? UI.accent : UI.surfaceRaised, 1);
      if (entry.kind === 'recipe') {
        const recipe = getRecipe(entry.id!);
        // No "×" between material and count: the pass chain's rows carry a
        // four-character name plus three three-character materials, and with the
        // multiplier they ran under the right-aligned status column at 460px.
        const cost = Object.entries(recipe.cost)
          .map(([id, n]) => `${getItem(id as ItemId).displayName}${n}`)
          .join(' ');
        row.name.setText(`${recipe.displayName}  ${cost}`);
        // The selected band is the warm accent, so light text on it read as a
        // smear. Dark ink is the only colour in the palette with contrast on it.
        row.name.setColor(selected ? hex(PALETTE.ink) : hex(TEXT.primary));
        // 武器不是设施，没有"已建造"——只有 upgrade 才查 homeUpgrades。
        // entry.kind 是面板自己的分类（recipe/purify），配方的 kind 要另取。
        const built = entry.id !== undefined && getRecipe(entry.id).kind === 'upgrade' && hasUpgrade(state, entry.id as UpgradeId);
        const check = canCraft(state, entry.id!);
        // A missing credential is not a materials problem: say 缺前置 instead of
        // 材料不足, or the player gathers what they already have enough of.
        const gated = !check.ok && check.reason !== undefined;
        row.status.setText(built ? '已建' : gated ? '缺前置' : check.ok ? '可制作' : '材料不足');
        row.status.setColor(selected ? hex(PALETTE.ink) : built ? hex(PALETTE.clothHigh) : gated ? hex(TEXT.warn) : check.ok ? hex(PALETTE.lightHigh) : hex(TEXT.dim));      } else {
        // AG-11: waterPurifierRuns 的显示语义。purifyWater 一次炼光整袋脏水，
        // 没有"次数"状态可读——诚实的"剩余"是下一次开机能炼多少瓶。批次化
        // 是这个升级的价值所在（小周 1:1 免费换，净水器赢在回来时满载），
        // 瓶数让那份价值在按 Enter 之前就看得见。
        const dirty = countItem(state.player.inventory, 'dirty_water');
        const can = dirty >= 1;
        row.name.setText('净化  脏水→净水');
        row.name.setColor(selected ? hex(PALETTE.ink) : hex(TEXT.primary));
        row.status.setText(can ? `可净化 ×${dirty}` : '缺脏水');
        row.status.setColor(selected ? hex(PALETTE.ink) : can ? hex(PALETTE.clothHigh) : hex(TEXT.dim));
      }
    }
    // AG-44：详情块——「做出来会怎样」（effect）、「这条属于第几档 / 前置拿没拿」
    // （tierNote + requires）、「差的料去哪拿」（hints）。数据全部来自 AG-42 的
    // recipePreview / canCraft（CRAFT.md §5 的交接契约），本场景只排版：
    // 三行从最后一行 band 之下 12px 起流式排布，行高取 Text 自己的测量值
    // （GameSans 的真实行盒），空行不占位。
    const selectedEntry = entries[this.craftSelected];
    const detail = this.craftDetailTexts;
    let effectLine = '';
    let tierLine = '';
    let hintsLine = '';
    let tierColor = hex(TEXT.dim);
    if (selectedEntry?.kind === 'recipe') {
      const preview = recipePreview(state, selectedEntry.id!);
      effectLine = `效果：${preview.effect}`;
      // tierNote 与前置合并成一行：两者都是「这条配方现在够不够格」的读数，
      // 分两行会在 4 行 hints 之外再吃掉 25px 的详情预算。
      tierLine = preview.tierNote ?? '';
      if (preview.requires) {
        const req = `前置：${preview.requires.displayName} ${preview.requires.met ? '已获得' : '未获得'}`;
        tierLine = tierLine ? `${tierLine} · ${req}` : req;
      }
      // 未达档位 / 未获前置都走警告色：进度感与卡点都要在按 Enter 前可见。
      tierColor = preview.tierLocked || (preview.requires && !preview.requires.met) ? hex(TEXT.warn) : hex(TEXT.dim);
      if (preview.hints && preview.hints.length > 0) {
        // hints 的每条是「材料：出处」。分隔符用「；」而不是默认的逗号，免得
        // 出处里的「6/7/9/10层概率」被读成同一处的并列。
        hintsLine = `去哪拿：${preview.hints.join('；')}`;
      }
    } else if (selectedEntry?.kind === 'purify') {
      // 净化行的效果文案取净水器配方自己的 effect（数据唯一来源，不另写一套）；
      // purify 条目只在净水器已建造时存在，所以这里永远读得到。
      effectLine = `效果：${getRecipe('purifier').effect}`;
    }
    detail.effect.setText(effectLine);
    detail.tier.setText(tierLine);
    detail.tier.setColor(tierColor);
    detail.hints.setText(hintsLine);
    // 流式布局：每行按自己的真实高度占位，空行收起。
    let dy = this.craftDetailY;
    for (const t of [detail.effect, detail.tier, detail.hints]) {
      if (t.text) {
        t.setPosition(t.x, dy);
        t.setVisible(true);
        dy += t.height + CRAFT_DETAIL_GAP;
      } else {
        t.setVisible(false);
      }
    }
    const selectedRow = this.craftRows[this.craftSelected - first];
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
    const panelW = 460;
    const panelH = 264;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    // Remembered for the mouse: a click outside this rectangle closes the panel.
    this.panelBox = { x: left, y: top, w: panelW, h: panelH };

    this.pauseObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'yellow', PANEL_DEPTH.game.pause));
    this.pauseObjects.push(...buildPanelHeader(this, left, top, panelW, '已暂停', UI.accent, PANEL_DEPTH.game.pause + 5));
    const title = this.add.text(cx, top + 20, '', { fontFamily: FONT_FAMILY, fontSize: '32px', color: hex(PALETTE.lightHigh) }).setOrigin(0.5);
    // 20px and a 460px panel: the old 22px line in a 380px panel ran out past
    // the frame, because a full-width Han glyph in a monospaced pixel face is
    // the whole em wide and the line has twelve of them.
    const controls = this.add.text(cx, top + 50, 'A/D 移动 · E 交互 · I 背包 · C 制作 · G 产业', { fontFamily: FONT_FAMILY, fontSize: '20px', color: hex(PALETTE.clothHigh) }).setOrigin(0.5);
    this.pauseObjects.push(title, controls, this.pauseMarker);

    PAUSE_OPTIONS.forEach((label, i) => {
      // 40px pitch, up from 28: four 24px rows at 28px touched.
      const t = this.add.text(cx, top + 96 + i * 40, label, { fontFamily: FONT_FAMILY, fontSize: `${TYPE_BODY}px`, color: hex(TEXT.primary) }).setOrigin(0.5);
      this.pauseOptionTexts.push(t);
      this.pauseObjects.push(t);
      this.pauseObjects.push(
        this.panelHit( left + 40, top + 96 + i * 40 - 19, panelW - 80, 38, PANEL_DEPTH.game.pause + 7, {
          onOver: () => {
            if (this.pauseSelected === i) return;
            this.pauseSelected = i;
            this.refreshPause();
          },
          onClick: () => {
            if (this.pauseSelected !== i) {
              this.pauseSelected = i;
              this.refreshPause();
              playSfx('click');
              return;
            }
            this.onUse();
          },
        }),
      );
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
        const recipe = getRecipe(entry.id!);
        this.flash(`${recipe.kind === 'upgrade' ? '建造了' : '制作了'} ${recipe.displayName}（-${ACTION_COSTS.craft} 分钟）`);
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
    // AG-20: 动作跨日时产业结算在 spendTime 内部发生——前后对比账本，读数
    // 才跟着动作走（只观察，不重复结算）。
    const ledger = state.growth?.ventures?.length ? this.ventureLedgerSnapshot() : null;
    const tick = spendTime(state, gameMinutes);
    if (ledger) this.diffVentureLedger(ledger);
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
  // AG-11: 居民按自己的日程移动（npcAutonomyFor：位置是
  // (npcId, day, minuteOfDay, runSeed) 的纯函数），名签跟着精灵走。
  // 名签做法与容器名签同族：固定在角色头顶上方（容器是矮道具，落在道具正面；
  // 96px 的居民不行——y=132 旧位置压在角色身上），depth 105/106（HUD 上下文
  // 带是 depth 100 的 0.94 alpha 面，低于它会被吞），距离比例渐隐
  // （贴近角色时不挡脸，信息交给底栏的「按 E 对话」）。
  private drawNpcs(floor: number): void {
    for (const npc of npcsOnFloor(floor)) {
      // AG-46：id -> 贴图 key 的翻译收在 artpack.characterKeyForNpc（加 NPC
      // 只改那一处）。返回 null = 没有贴图的实体（core_terminal，active:false），
      // 跳过不渲染——宁可少画一个，不要摆个 __MISSING 绿框在 100000 层。
      const who = characterKeyForNpc(npc.id);
      if (!who) continue;
      const sprite = this.add
        .sprite(npc.x, PLAYER_FEET_Y, walkSheetKey(who))
        .setOrigin(0.5, 1)
        // ACTOR_DEPTH, or the wall dressing and the haze paint over them.
        .setDepth(ACTOR_DEPTH);
      // NPCs stand still, so they breathe on the idle clip. Without an explicit
      // play() a sprite sits on frame 0 forever, which reads as a frozen mannequin
      // rather than someone waiting to talk to you. syncNpcs swaps in the walk
      // clip whenever the schedule has them moving.
      sprite.play(idleAnimKey(who));
      // Same contact shadow as the player, so an NPC stands on the floor rather
      // than hovering a few pixels above it.
      const shadow = addContactShadow(this, npc.x, PLAYER_FEET_Y + 2, 26, 2, 0.5);
      // The name plate: the same ink plate + 22px text the containers wear, sized
      // from the measured text (the pixel font is still loading at floor build,
      // so Text.width is a placeholder — estimateTextWidth is font-independent).
      const plateW = Math.ceil(estimateTextWidth(npc.name, CONTAINER_LABEL_FONT)) + 14;
      const plate = this.add
        .rectangle(npc.x, NPC_LABEL_Y, plateW, CONTAINER_LABEL_FONT + 8, PALETTE.ink, 0.94)
        .setOrigin(0.5)
        .setStrokeStyle(1, PALETTE.shadow)
        .setDepth(105);
      const label = this.add
        .text(npc.x, NPC_LABEL_Y, npc.name, { fontFamily: FONT_FAMILY, fontSize: `${CONTAINER_LABEL_FONT}px`, color: hex(TEXT.primary) })
        .setOrigin(0.5)
        .setDepth(106);
      this.npcObjs.set(npc.id, { who, sprite, shadow, label, plate });
      this.floorObjects.push(...shadow, sprite, plate, label);
    }
  }

  /** 某 NPC 当前时刻的自主状态（位置/是否在走/目标）。场景每帧据此摆精灵。 */
  private npcView(state: GameState, npc: NpcDef): NpcAutonomyView {
    const { inventory } = syncNpcInventory(state, npc);
    return npcAutonomyFor(npc, {
      day: state.day,
      minuteOfDay: state.gameMinuteOfDay,
      runSeed: state.runSeed,
      stock: (itemId) => stockOf(inventory, itemId),
    });
  }

  /**
   * 把居民摆到日程算出位置上，名签与影子跟随，走起来就换步行clip。
   * 只在 NPC 层调用；游戏时钟冻结时（面板打开）位置本来就不变。
   */
  private syncNpcs(state: GameState): void {
    // AG-46：从"只在 2 层同步"改成按当前楼层——发布者层的居民也要按日程走。
    const npcs = npcsOnFloor(state.currentFloor);
    if (npcs.length === 0) return;
    for (const npc of npcs) {
      const rec = this.npcObjs.get(npc.id);
      if (!rec) continue;
      const view = this.npcView(state, npc);
      rec.sprite.setPosition(view.x, PLAYER_FEET_Y);
      for (const s of rec.shadow) (s as Phaser.GameObjects.Rectangle).setPosition(view.x, PLAYER_FEET_Y + 2);
      const want = view.moving ? walkAnimKey(rec.who) : idleAnimKey(rec.who);
      if (rec.sprite.anims.currentAnim?.key !== want) rec.sprite.play(want, true);
      rec.label.setPosition(view.x, NPC_LABEL_Y);
      rec.plate.setPosition(view.x, NPC_LABEL_Y);
      // 距离比例渐隐，与容器名签同一公式：贴近角色时名字让位给角色。
      const a = Phaser.Math.Clamp((Math.abs(state.player.x - view.x) - INTERACT_DISTANCE) / CONTAINER_LABEL_FADE_PX, 0, 1);
      rec.label.setAlpha(a);
      rec.plate.setAlpha(a * 0.94);
    }
  }

  private nearestNpc(state: GameState): NpcDef | null {
    // AG-46：按当前楼层取可对话实体——10/110/1010/10010 层的发布者按 E 有话。
    for (const npc of npcsOnFloor(state.currentFloor)) {
      // AG-11: 用自主视图的 x，不是 npc.x 静态坐标——居民会走，能对话的
      // 必须是眼里看见的那个位置。
      if (Math.abs(this.npcView(state, npc).x - state.player.x) <= INTERACT_DISTANCE) return npc;
    }
    return null;
  }

  private buildDialoguePanel(): void {
    const { width, height } = this.viewSize();
    // A scene restart keeps the display list, so the previous run's row hit
    // rects would otherwise be pushed into again and re-placed by index.
    this.dialogueRowHits = [];
    // Geometry lives in render/dialogueLayout: the portrait column, the gap the
    // text must keep from it, and the wrap width all have to agree, and they did
    // not (the text started 84px inside the 96px face). dialogueLayout.test.ts
    // holds the numbers against the real dialogue strings.
    const panelW = DIALOG_PANEL_W;
    const panelH = DIALOG_PANEL_H;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    // Remembered for the mouse: a click outside this rectangle closes the panel.
    this.panelBox = { x: left, y: top, w: panelW, h: panelH };

    const depth = PANEL_DEPTH.game.dialogue;
    // The skin is captured, not just pushed: refreshDialogue re-places these
    // parts when a long AI opening line grows the panel (dialogueGeometry).
    this.dialoguePanelParts = buildPanel(this, cx, cy, panelW, panelH, 'dialogue', depth);
    this.dialogueObjects.push(...this.dialoguePanelParts);
    // OVERHAUL UI: the same header strip every other panel uses, with the NPC's
    // name on it, and the message in an inset well so speech reads as speech
    // rather than as more body text.
    // Empty header title on purpose: the NPC's name is the header, and drawing a
    // static '对话' underneath it printed the two on top of each other.
    // The strip is captured like the skin: the panel grows around it, so the
    // strip has to move with the panel's top edge or it detaches from the frame.
    this.dialogueHeaderParts = buildPanelHeader(this, left, top, panelW, '', UI.good, depth + 5);
    this.dialogueObjects.push(...this.dialogueHeaderParts);
    // Create with placeholder content so each text's canvas/frame exists up front
    // (setText on a never-rendered empty text throws in Phaser 4).
    this.dialogueTitle = this.add
      .text(left + 10, top + 10, '对话', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.title}px`, color: hex(TEXT.primary) })
      .setOrigin(0, 0.5)
      .setDepth(depth + 6);
    // Left: the speaker's face, on a dark inset so it does not float on the
    // panel's own texture. Drawn at its native 96x96 — scaling a bust down is
    // what makes pixel art look like a photo.
    const portraitLeft = left + DIALOG_PADDING;
    this.dialoguePortraitFrame = this.add
      .rectangle(portraitLeft, top + DIALOG_PORTRAIT_TOP, DIALOG_PORTRAIT_SIZE, DIALOG_PORTRAIT_SIZE, PALETTE.ink)
      .setOrigin(0, 0)
      .setAlpha(0.85)
      .setDepth(depth + 5);
    this.dialoguePortrait = this.add
      .image(portraitLeft + DIALOG_PORTRAIT_SIZE / 2, top + DIALOG_PORTRAIT_TOP + DIALOG_PORTRAIT_SIZE / 2, portraitKey('npc_alin'))
      .setDepth(depth + 6);
    this.dialogueObjects.push(this.dialoguePortraitFrame, this.dialoguePortrait);
    // The speech well starts a full DIALOG_TEXT_GAP right of the face and ends
    // DIALOG_TEXT_RIGHT_PAD left of the panel edge. Built at the base two-line
    // height; refreshDialogue resizes it per message from dialogueGeometry().
    const wellParts = buildPanelWell(this, left + DIALOG_WELL_LEFT, top + DIALOG_WELL_TOP, DIALOG_WELL_W, DIALOG_WELL_H, depth + 5);
    this.dialogueWellFill = wellParts[0] as Phaser.GameObjects.Rectangle;
    this.dialogueWellEdge = wellParts[1] as Phaser.GameObjects.Graphics;
    this.dialogueObjects.push(...wellParts);
    // dialogueTitle MUST be in the list: closeDialogue() hides everything in it,
    // and a name left out of the list stays on screen after the panel closes.
    this.dialogueObjects.push(this.dialogueTitle);
    // Left-aligned and vertically centred in the well. Centred text looked tidy
    // on a one-line greeting but threw a wrapped line out to both sides, which
    // is how it ended up on the portrait and past the frame.
    this.dialogueMessage = this.add
      .text(left + DIALOG_TEXT_LEFT, top + DIALOG_WELL_TOP + DIALOG_WELL_H / 2, '……', {
        fontFamily: FONT_FAMILY,
        fontSize: `${TYPE.body}px`,
        color: hex(TEXT.primary),
        align: 'left',
        // useAdvancedWrap is load-bearing: the basic wrapper only breaks on
        // spaces, and Chinese has none, so the width was ignored entirely and
        // the line ran straight through the portrait.
        wordWrap: { width: DIALOG_TEXT_W, useAdvancedWrap: true },
      })
      .setOrigin(0, 0.5)
      .setDepth(depth + 7);
    this.dialogueObjects.push(this.dialogueMessage);

    this.dialogueBands = [];
    for (let i = 0; i < DIALOG_ROW_COUNT; i++) {
      const rowY = top + DIALOG_ROWS_TOP + i * DIALOG_ROW_PITCH;
      // A selection band per row, the same language as every other list: a wash
      // plus a 2px accent rule. Toggled in refreshDialogue.
      const band = this.add.rectangle(left + DIALOG_PADDING, rowY, panelW - DIALOG_PADDING * 2, DIALOG_ROW_H, UI.accent).setOrigin(0, 0).setAlpha(0).setDepth(depth + 5);
      const rule = this.add.rectangle(left + DIALOG_PADDING, rowY, 2, DIALOG_ROW_H, UI.accent).setOrigin(0, 0).setAlpha(0).setDepth(depth + 6);
      this.dialogueBands.push({ band, rule });
      this.dialogueObjects.push(band, rule);
      // Mouse: hover moves the cursor, click confirms — guarded on the option
      // count because the row list is shorter than the four bands in trade mode.
      // Kept in dialogueRowHits so refreshDialogue can move it with the band.
      const rowHit = this.panelHit(left + DIALOG_PADDING, rowY, panelW - DIALOG_PADDING * 2, DIALOG_ROW_H, depth + 8, {
        onOver: () => {
          if (!this.dialogue) return;
          // 先取视图（它顺带算出窗口平移），再把视图行号换算回扁平下标。
          if (i >= this.dialogueOptionsView().length) return;
          const flat = this.dialogueViewOffset + i;
          if (this.dialogue.selected === flat) return;
          this.dialogue.selected = flat;
          this.refreshDialogue();
        },
        onClick: () => {
          if (!this.dialogue || i >= this.dialogueOptionsView().length) return;
          this.dialogue.selected = this.dialogueViewOffset + i;
          this.refreshDialogue();
          this.onUse();
        },
      });
      this.dialogueRowHits.push(rowHit);
      this.dialogueObjects.push(rowHit);
      const icon = this.add.image(left + 30, rowY + DIALOG_ROW_H / 2, 'blank').setOrigin(0.5).setDepth(depth + 7);
      const t = this.add
        .text(left + 46, rowY + DIALOG_ROW_H / 2, '……', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: hex(TEXT.primary) })
        .setOrigin(0, 0.5)
        .setDepth(depth + 7);
      this.dialogueOptionIcons.push(icon);
      this.dialogueOptions.push(t);
      this.dialogueObjects.push(icon, t);
    }
    const footer = this.add
      .text(cx, top + panelH - 12, '↑/↓ 选择 · Enter 确定 · ESC 返回', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(PALETTE.clothHigh) })
      .setOrigin(0.5)
      .setDepth(depth + 7);
    this.dialogueFooter = footer;
    this.dialogueObjects.push(footer, this.dialogueMarker);

    applyPanelDepth(this.dialogueObjects, PANEL_DEPTH.game.dialogue);
    this.assertPanelContent('dialogue', this.dialogueObjects);
    for (const o of this.dialogueObjects) o.setVisible(false);
  }

  // Label + icon key per dialogue option. The icon is the item the player
  // RECEIVES (the trade's output), matching how the crafting list shows outputs;
  // 问候/询问/退出/返回 are not items and get no icon.
  //
  // AG-11: the trade list reads availableOffers, not the static npc.offers —
  // 信誉修正（trusted 双倍货 / disliked 双倍价）与真实库存过滤（没货下架、
  // hostile 整体清空）都发生在系统侧，场景展示的就是此刻真正成交得了的报价。
  // 静态表会让玩家看见一件 NPC 库存里没有的货，按了 Enter 才被拒绝。
  private dialogueOffers(npc: NpcDef): BarterOffer[] {
    const state = getGame();
    const { npcState, inventory } = syncNpcInventory(state, npc);
    return availableOffers(inventory, npc, reputationOf(npcState));
  }

  /**
   * AG-20: 交易层「赠礼」行的下标；摆不下（报价超过两行的 NPC）时为 -1。
   * 对话只有四行：报价 ×N + 赠礼 + 返回必须放得下，赠礼行因此是可选的。
   */
  private dialogueGiftRowIndex(npc: NpcDef): number {
    return this.dialogueOffers(npc).length <= 2 ? this.dialogueOffers(npc).length : -1;
  }

  /**
   * AG-20: 赠礼层的扁平选项表——「领取回赠」（npcEconomy.giftOffer 判得有
   * 可送时才摆，与交易层「只展示成交得了的报价」同一条纪律）+ 背包里每一格
   * 一件（整叠送出，一次 receiveGift 一笔记忆，不给「一件一件刷关系」留缝）。
   */
  private dialogueGiftEntries(): Array<{ kind: 'claim'; itemId: ItemId } | { kind: 'item'; itemId: ItemId; quantity: number }> {
    const state = getGame();
    const d = this.dialogue;
    if (!d) return [];
    const npc = getNpc(d.npc);
    const { npcState, inventory } = syncNpcInventory(state, npc);
    const gift = giftOffer(npc, inventory, reputationOf(npcState));
    const items = state.player.inventory.slots.map((s) => ({ kind: 'item' as const, itemId: s.itemId, quantity: s.quantity }));
    return [...(gift ? [{ kind: 'claim' as const, itemId: gift.itemId }] : []), ...items];
  }

  private dialogueOptionsView(): Array<{ label: string; icon?: ItemId }> {
    const d = this.dialogue;
    if (!d) return [];
    if (d.level === 'main') {
      this.dialogueViewOffset = 0;
      return ['问候', '询问', '交易', '退出'].map((label) => ({ label }));
    }
    const npc = getNpc(d.npc);
    if (d.level === 'gift') {
      // 窗口化：视图第 0 行对应扁平下标 dialogueViewOffset，随光标滑动。
      const flat = this.dialogueGiftEntries();
      this.dialogueViewOffset = Math.max(0, Math.min(d.selected - 1, flat.length - DIALOG_ROW_COUNT));
      return flat.slice(this.dialogueViewOffset, this.dialogueViewOffset + DIALOG_ROW_COUNT).map((e) =>
        e.kind === 'claim'
          ? { label: `领取回赠：${getItem(e.itemId).displayName}`, icon: e.itemId }
          : { label: `送出 ${getItem(e.itemId).displayName}×${e.quantity}`, icon: e.itemId },
      );
    }
    const rows: Array<{ label: string; icon?: ItemId }> = this.dialogueOffers(npc).map((o) => ({
      label: `用 ${getItem(o.get.itemId).displayName}×${o.get.quantity} 换 ${getItem(o.give.itemId).displayName}×${o.give.quantity}`,
      icon: o.give.itemId,
    }));
    const giftRow = this.dialogueGiftRowIndex(npc);
    if (giftRow >= 0) rows.push({ label: '赠礼' });
    rows.push({ label: '返回' });
    this.dialogueViewOffset = 0;
    return rows;
  }

  /** 选项的扁平总数（导航钳制用）：赠礼层是整张表，不是可见的那四行。 */
  private dialogueOptionsCount(): number {
    const d = this.dialogue;
    if (!d) return 0;
    if (d.level === 'gift') return this.dialogueGiftEntries().length;
    return this.dialogueOptionsView().length;
  }

  // ── AI NPC（feat/ai-npc-spark-integration，默认关闭）─────────────────────
  // 接线原则：AI 只影响「开场白」这一句话与事后的记忆积累；菜单结构、
  // 交易执行、数值规则全部走原有路径。未配置模型时以下方法全部空转。

  private getAiRuntime(npc: NpcDef): NpcRuntimeConfig | null {
    const cfg = aiNpcConfig();
    if (!cfg.enabled) return null;
    let runtime = this.aiRuntimes.get(npc.id);
    if (!runtime) {
      runtime = {
        brain: new OllamaBrain({ baseUrl: cfg.baseUrl, model: cfg.model, timeoutMs: cfg.timeoutMs }),
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
    return loadNpcState(getGame(), npc.id) ?? createNpcState(archetypeForNpcId(npc.id));
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
      // AG-11: npcFactFor 把 npcStates 里已按天结算的真实库存喂给规则执行器
      // （阶段 C）——模型看到的才是「NPC 现在真的有什么」。静态报价表推导
      // （npcFactFromDef）会让执行器放行一笔 NPC 库存里根本没有的交易。
      const decision = await decideNpcAction(getGame(), npcFactFor(getGame(), npc), this.npcStateFor(npc), runtime);
      if (!decision.validated.ok) return;
      const { action, utterance } = decision.validated;
      // 第一阶段只落地对话文本；其他行动类型在第一阶段就被 availableActions 挡掉
      const line = utterance ?? (action.type === 'dialogue' ? action.text : '');
      // 保鲜检查：玩家可能已关闭对话、重开、或翻过选项——过期结果一律丢弃，
      // 不能覆盖玩家眼前的这场新对话（P1-2）。
      if (line && isDialogueFresh(this.currentDialogueSession(), captured)) {
        this.dialogue!.message = line;
        this.dialogue!.revision += 1; // AI 换行本身也是一次修订，防止两次返回互相覆盖
        this.refreshDialogue();
      }
    } catch {
      // AI 层任何意外都不能把对话搞坏：保持原句即为正确行为
    }
  }

  private openDialogue(npc: NpcDef): void {
    this.dialogueSessionSeq += 1;
    this.dialogue = {
      npc: npc.id,
      level: 'main',
      selected: 0,
      message: npc.greetings[0],
      lineToggle: 0,
      sessionId: this.dialogueSessionSeq,
      revision: 0,
    };
    this.dialogueOpen = true;
    for (const o of this.dialogueObjects) o.setVisible(true);
    this.refreshDialogue();
    void this.enhanceOpeningLine(npc);
  }

  private closeDialogue(): void {
    this.dialogueOpen = false;
    this.dialogue = null;
    for (const o of this.dialogueObjects) o.setVisible(false);
  }

  private dialogueBack(): void {
    if (!this.dialogue) return;
    this.dialogue.revision += 1; // 玩家操作使在途 AI 结果过期
    if (this.dialogue.level === 'gift') {
      this.dialogue.level = 'trade';
      this.dialogue.selected = 0;
      this.dialogue.message = '想换点什么？';
      this.refreshDialogue();
    } else if (this.dialogue.level === 'trade') {
      this.dialogue.level = 'main';
      this.dialogue.selected = 0;
      this.dialogue.message = '';
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
    // NpcId is 'alin'|'xiaozhou'; portrait files are keyed by CharacterKey, so
    // the prefix is the only translation needed.
    this.dialoguePortrait.setTexture(portraitKey(`npc_${d.npc}` as CharacterKey));
    this.dialogueMessage.setText(d.message || '……');

    // ── adaptive layout ────────────────────────────────────────────────────
    // The well's height, the rows under it and the panel around both are
    // computed from the message's wrapped line count (dialogueGeometry), so an
    // AI opening line of up to 60 characters — five lines at this width — grows
    // the panel instead of printing over the option rows. Re-place only: the
    // objects were built once in buildDialoguePanel at the base geometry, and
    // destroying them per keystroke is what made the dialogue flicker.
    const geo = dialogueGeometry(d.message || '……', TYPE.body);
    const { width, height } = this.viewSize();
    const cx = width / 2;
    const left = cx - DIALOG_PANEL_W / 2;
    const top = height / 2 - geo.panelH / 2;
    // The header strip rides the panel's top edge: strip, accent rule, (empty)
    // title and hairline, in buildPanelHeader's return order. The hairline is a
    // Graphics, so it is cleared and re-drawn rather than moved.
    const [hStrip, hAccent, hTitle, hLine] = this.dialogueHeaderParts as [
      Phaser.GameObjects.Rectangle,
      Phaser.GameObjects.Rectangle,
      Phaser.GameObjects.Text,
      Phaser.GameObjects.Graphics,
    ];
    hStrip.setPosition(left, top).setSize(DIALOG_PANEL_W, PANEL_HEADER_H);
    hAccent.setPosition(left, top);
    hTitle.setPosition(left + 10, top + PANEL_HEADER_H / 2);
    hLine.clear();
    drawLine(hLine, left + 2, top + PANEL_HEADER_H - 1, DIALOG_PANEL_W - 2, UI.good, 0.7);
    // The skin: five stepped fill bands then eight frame pieces (corners first,
    // then top/bottom/left/right edges), in buildPanel's return order.
    const bandH = geo.panelH / PANEL_FILL_BANDS;
    this.dialoguePanelParts.slice(0, PANEL_FILL_BANDS).forEach((part, i) => {
      const band = part as Phaser.GameObjects.Rectangle;
      band.setPosition(cx, top + bandH * (i + 0.5));
      band.setSize(DIALOG_PANEL_W, bandH + 1);
    });
    const frame = this.dialoguePanelParts.slice(PANEL_FILL_BANDS, PANEL_FILL_BANDS + PANEL_FRAME_PIECES) as Phaser.GameObjects.Image[];
    const [fTL, fTR, fBL, fBR, fTop, fBottom, fLeft, fRight] = frame;
    const right = left + DIALOG_PANEL_W;
    const bottom = top + geo.panelH;
    fTL.setPosition(left, top);
    fTR.setPosition(right - PANEL_SLICE, top);
    fBL.setPosition(left, bottom - PANEL_SLICE);
    fBR.setPosition(right - PANEL_SLICE, bottom - PANEL_SLICE);
    fTop.setPosition(left + PANEL_SLICE, top).setDisplaySize(DIALOG_PANEL_W - PANEL_SLICE * 2, PANEL_SLICE);
    fBottom.setPosition(left + PANEL_SLICE, bottom - PANEL_SLICE).setDisplaySize(DIALOG_PANEL_W - PANEL_SLICE * 2, PANEL_SLICE);
    fLeft.setPosition(left, top + PANEL_SLICE).setDisplaySize(PANEL_SLICE, geo.panelH - PANEL_SLICE * 2);
    fRight.setPosition(right - PANEL_SLICE, top + PANEL_SLICE).setDisplaySize(PANEL_SLICE, geo.panelH - PANEL_SLICE * 2);
    // The header title and the bust ride the panel's top edge.
    this.dialogueTitle.setPosition(left + 10, top + 10);
    this.dialoguePortraitFrame.setPosition(left + DIALOG_PADDING, top + DIALOG_PORTRAIT_TOP);
    this.dialoguePortrait.setPosition(left + DIALOG_PADDING + DIALOG_PORTRAIT_SIZE / 2, top + DIALOG_PORTRAIT_TOP + DIALOG_PORTRAIT_SIZE / 2);
    // The well grows; its stroke is redrawn around the new box.
    const wellLeft = left + DIALOG_WELL_LEFT;
    const wellTop = top + DIALOG_WELL_TOP;
    this.dialogueWellFill.setPosition(wellLeft, wellTop).setSize(DIALOG_WELL_W, geo.wellH);
    this.dialogueWellEdge.clear();
    this.dialogueWellEdge.lineStyle(1, UI.line, 0.5);
    this.dialogueWellEdge.strokeRect(Math.round(wellLeft) + 0.5, Math.round(wellTop) + 0.5, DIALOG_WELL_W - 1, geo.wellH - 1);
    // The message stays centred in the (possibly taller) well.
    this.dialogueMessage.setPosition(left + DIALOG_TEXT_LEFT, wellTop + geo.wellH / 2);
    // The four rows and the footer shift with the geometry.
    for (let i = 0; i < this.dialogueBands.length; i++) {
      const rowY = top + geo.rowsTop + i * DIALOG_ROW_PITCH;
      const b = this.dialogueBands[i];
      b.band.setPosition(left + DIALOG_PADDING, rowY);
      b.rule.setPosition(left + DIALOG_PADDING, rowY);
      // The mouse targets move with their row. Left at the base y they accept
      // the click meant for the row above as soon as a five-line AI message
      // pushes rowsTop down (measured: hover landed 3px off, click one row low).
      this.dialogueRowHits[i]?.setPosition(left + DIALOG_PADDING, rowY);
      this.dialogueOptionIcons[i].setPosition(left + 30, rowY + DIALOG_ROW_H / 2);
      this.dialogueOptions[i].setPosition(left + 46, rowY + DIALOG_ROW_H / 2);
    }
    this.dialogueFooter.setPosition(cx, bottom - 12);
    // The click-outside box follows the panel's grown height; otherwise the
    // header and footer of a tall panel count as "outside" and close it.
    this.panelBox = { x: left, y: top, w: DIALOG_PANEL_W, h: geo.panelH };

    const options = this.dialogueOptionsView();
    // 钳制对扁平总数，不是对可见行——赠礼层的表比四行长，光标可以停在
    // 窗口外（由 dialogueViewOffset 滑进来）。
    const count = this.dialogueOptionsCount();
    if (d.selected >= count) d.selected = Math.max(0, count - 1);
    // 光标所在的行 = 扁平下标 − 窗口平移（主菜单/交易层平移为 0，语义不变）。
    const cursorRow = d.selected - this.dialogueViewOffset;
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
      const selected = i === cursorRow;
      this.dialogueOptions[i].setColor(selected ? hex(PALETTE.lightHigh) : hex(TEXT.primary));
      const b = this.dialogueBands[i];
      if (b) {
        b.band.setAlpha(selected ? 0.14 : 0);
        b.rule.setAlpha(selected ? 1 : 0);
      }
    }
    const selectedIcon = this.dialogueOptionIcons[cursorRow];
    this.dialogueMarker.setVisible(options[cursorRow] !== undefined);
    if (options[cursorRow] && selectedIcon) placeMarkerLeftOf(this.dialogueMarker, selectedIcon);
  }

  private activateDialogueOption(): void {
    const d = this.dialogue;
    if (!d) return;
    d.revision += 1; // 玩家操作使在途 AI 结果过期
    const npc = getNpc(d.npc);
    if (d.level === 'main') {
      switch (d.selected) {
        case 0:
          d.message = npc.greetings[d.lineToggle % npc.greetings.length];
          d.lineToggle++;
          break;
        case 1:
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
    } else if (d.level === 'gift') {
      // AG-20: 赠礼层。两条通路都接 npcEconomy 的闭环函数：领取回赠走
      // claimGift（装不下整体失败，回执「背包空间不足」），送出走
      // receiveGift（整叠送出，先校验后扣除）。失败 reason 一律显示，
      // 不静默——玩家按了 Enter 就得知道发生了什么。
      const entries = this.dialogueGiftEntries();
      const entry = entries[d.selected];
      const state = getGame();
      if (!entry) {
        d.level = 'trade';
        d.selected = 0;
        d.message = '背包是空的，没什么可送。';
      } else if (entry.kind === 'claim') {
        const r = claimGift(state, npc);
        if (r.ok) {
          saveToStorage(state);
          this.refreshInventory();
          playSfx('chest');
          d.message = `收下 ${getItem(r.itemId).displayName}×${r.quantity}（-${ACTION_COSTS.trade} 分钟）`;
          this.chargeTime(ACTION_COSTS.trade);
        } else {
          playSfx('pickup');
          d.message = r.reason;
        }
      } else {
        const r = receiveGift(state, npc, entry.itemId, entry.quantity);
        if (r.ok) {
          saveToStorage(state);
          this.refreshInventory();
          playSfx('trade');
          d.message = `送出 ${getItem(entry.itemId).displayName}×${entry.quantity}（-${ACTION_COSTS.trade} 分钟）`;
          this.chargeTime(ACTION_COSTS.trade);
        } else {
          playSfx('pickup');
          d.message = r.reason ?? '赠礼没成';
        }
      }
    } else {
      const offers = this.dialogueOffers(npc);
      const giftRow = this.dialogueGiftRowIndex(npc);
      if (d.selected < offers.length) {
        // AG-11: 交易执行走 npcEconomy.executeBarter——它一次做完校验（信誉+
        // 库存过滤后的报价）、原子交易、扣 NPC 库存、记一条 trade 记忆并写回
        // npcStates。场景原来自己调 trade() + recordNpcTrade：记忆会记两条、
        // NPC 库存永不消耗（同样的货能无限次换），信誉分级也从未生效。
        const offer = offers[d.selected];
        const result = executeBarter(getGame(), npc, offer.id);
        d.message = result.ok
          ? `换到了 ${getItem(offer.give.itemId).displayName}×${offer.give.quantity}`
          : (result.reason ?? '交易没成');
        if (result.ok) {
          saveToStorage(getGame());
          this.refreshInventory();
          playSfx('trade');
          d.message = `换到了 ${getItem(offer.give.itemId).displayName}×${offer.give.quantity}（-${ACTION_COSTS.trade} 分钟）`;
          this.chargeTime(ACTION_COSTS.trade);
        }
      } else if (d.selected === giftRow) {
        // AG-20: 进赠礼层——「伸手不打笑脸人」，礼尚往来也是交道的一部分。
        d.level = 'gift';
        d.selected = 0;
        d.message = '想送点什么？';
      } else {
        d.level = 'main';
        d.selected = 0;
        d.message = '';
      }
    }
    this.refreshDialogue();
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
    this.keyL = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.L);
    // AG-20: G opens the venture ledger — the tower's three industries and the
    // run's investment books (已投入 / 昨日收益 / 累计).
    this.keyG = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.G);

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
    // AG-11: Q opens the quest panel. The panel scene belongs to AG-12; until it
    // is registered this degrades to a flash instead of a console warning.
    this.keyQ.on('down', () => this.guard('q', this.onToggleQuests), this);
    this.keyL.on('down', () => this.guard('l', this.toggleDeco), this);
    this.keyG.on('down', () => this.guard('g', this.onToggleVentures), this);
    // ← → are polled (isDown) for walking, so they have no keydown handler of
    // their own; the archive wants a discrete press, and movement is already
    // frozen while any panel is up. Guarding on decoOpen keeps them invisible to
    // every other screen.
    this.cursors.left.on('down', () => {
      if (this.decoOpen) this.pageDeco(-1);
    });
    this.cursors.right.on('down', () => {
      if (this.decoOpen) this.pageDeco(1);
    });
    this.cursors.up.on('down', () => this.guard('up', this.onNavUp), this);
    this.cursors.down.on('down', () => this.guard('down', this.onNavDown), this);

    // Mouse. Scene-level on purpose: it fires for presses that did NOT land on an
    // interactive object, which is exactly the set that should be read as "walk
    // here". Rows and buttons get first refusal through `currentlyOver`.
    // Off-then-on because create() runs again after a scene restart and the input
    // plugin is not reset with it.
    this.input.off('pointerdown', this.pointerHandler);
    this.input.on('pointerdown', this.pointerHandler);
  }

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
      this.ventureObjects,
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

  /**
   * AG-11: the quest panel is launched OVER this scene, so Game keeps running
   * behind it — every menu key is held in guard() while it is up, and update()
   * early-returns so the survival clock freezes with it. Polled rather than
   * tracked: the panel owns its own close key, and a flag here could only
   * learn about it by asking.
   */
  private get questsOpen(): boolean {
    return this.scene.isActive('QuestPanel');
  }

  /**
   * Q — open the quest panel. The panel scene (QuestPanelScene) is AG-12's;
   * this is only the launch call and the key, per the interface contract:
   * `this.scene.launch('QuestPanel', { from: 'Game' })`.
   *
   * Graceful degradation is not optional: before AG-12's scene is registered,
   * Phaser's launch would only console.warn "Scene key not found" and the
   * player would press Q into silence. Say so instead.
   */
  private onToggleQuests(): void {
    if (this.stairClimb || this.inventoryOpen || this.craftingOpen || this.dialogueOpen || this.pauseOpen || this.encounterOpen || this.shelterOpen || this.ventureOpen || this.questsOpen) return;
    if (!this.scene.get('QuestPanel')) {
      this.flash('任务面板未就绪');
      return;
    }
    this.scene.launch('QuestPanel', { from: 'Game' });
  }

  // Accept a key at most once per frame (GHI-03 m9). The action has to be
  // invoked with the scene as `this` — passing a bare method reference would
  // lose it. Movement is NOT routed through here: it reads
  // cursors.left/right.isDown in update(), so holding a direction key works.
  private guard(slot: GameKey, action: () => void): void {
    if (this.questsOpen) return; // the panel owns the keyboard while it is up
    const frame = this.game.getFrame();
    if (this.lastInputFrame[slot] === frame) return;
    this.lastInputFrame[slot] = frame;
    action.call(this);
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
    this.keyL?.removeAllListeners();
    this.keyG?.removeAllListeners();
    this.cursors?.left?.removeAllListeners();
    this.cursors?.right?.removeAllListeners();
    this.cursors?.up.removeAllListeners();
    this.cursors?.down.removeAllListeners();
  }

  private onToggleMap(): void {
    if (this.stairClimb || this.inventoryOpen || this.craftingOpen || this.dialogueOpen || this.pauseOpen || this.encounterOpen || this.shelterOpen || this.ventureOpen) return;
    this.openTowerOverview();
  }

  private onToggleInventory(): void {
    if (this.stairClimb || this.craftingOpen || this.dialogueOpen || this.pauseOpen || this.encounterOpen || this.shelterOpen || this.ventureOpen) return;
    this.toggleInventory();
  }

  // ── mouse ───────────────────────────────────────────────────────────────
  /** Panel hit targets live in screen space: every panel in this scene is built
   *  at fixed screen coordinates and pushed through lockToScreen/applyPanelDepth,
   *  which sets scrollFactor 0. A hit rect left at scrollFactor 1 sits one camera
   *  scroll above the row it is supposed to cover — measured: 52px off on floor 2,
   *  which made every click land on the row above. */
  private panelHit(
    x: number,
    y: number,
    w: number,
    h: number,
    depth: number,
    handlers: Parameters<typeof hitRect>[6],
  ): Phaser.GameObjects.Rectangle {
    return hitRect(this, x, y, w, h, depth, handlers).setScrollFactor(0);
  }

  private anyPanelOpen(): boolean {
    return (
      this.encounterOpen || this.shelterOpen || this.inventoryOpen || this.craftingOpen || this.dialogueOpen || this.pauseOpen || this.decoOpen || this.ventureOpen
    );
  }

  /** True when something E could act on sits within reach of `x`. */
  private hasInteractableNear(x: number): boolean {
    const state = getGame();
    const near = (v: number): boolean => Math.abs(v - x) <= 36;
    // The residents MOVE (AG-11 autonomy): npc.x is the schedule's spawn anchor,
    // not where they are. Measured: 阿林 stood at 241 while her data said 480,
    // so clicking her sprite walked the player over and then did nothing at all
    // — the click never armed interact, and only E worked. Containers and beds
    // are static, which is why they were fine.
    // AG-46：楼层常量换成当前楼层——发布者身边的"按 E 对话"提示不再缺席。
    if (npcsOnFloor(state.currentFloor).some((n) => near(this.npcView(state, n).x))) return true;
    if (this.floorView.containers.some((c) => c.items.length > 0 && near(c.x))) return true;
    for (const marker of this.spotMarkers.values()) if (near(marker.x)) return true;
    if (near(UP_EXIT_X) || near(this.downExit)) return true;
    if (state.currentFloor === STARTING_FLOOR && near(BED_X)) return true;
    return false;
  }

  private onPointerDown(pointer: Phaser.Input.Pointer, currentlyOver: unknown[]): void {
    if (this.stairClimb) return;
    // AG-44：任务面板是 launch 覆盖在本场景上的（Game 不停），它的指针交互
    // （行点击/分支点击/面板外点击关闭）自己管；这里直接让位。修前没有这一条：
    // 点任务面板里的行会穿过面板在本场景设一个 walkTarget（anyPanelOpen 不含
    // questsOpen），玩家选完任务莫名走两步。也不能把 questsOpen 并进
    // anyPanelOpen 的那个分支——那会走到 onEsc()，在只有任务面板开着时把暂停
    // 菜单顶起来。
    if (this.questsOpen) return;
    // A row or a button already took this press.
    if (currentlyOver.length > 0) return;

    if (this.anyPanelOpen()) {
      // The panel's own background swallows the click; anywhere else is the
      // mouse's ESC. Without this a click on the world behind an open panel did
      // nothing at all and the only way out was the keyboard.
      const box = this.panelBox;
      const inside =
        !!box && pointer.x >= box.x && pointer.x <= box.x + box.w && pointer.y >= box.y && pointer.y <= box.y + box.h;
      if (!inside) this.onEsc();
      return;
    }
    if (getGame().status !== 'playing') return;
    // The HUD is not the world: clicking a stat bar or the top strip should not
    // send the player walking to a spot behind it.
    if (pointer.y < HUD_LAYOUT.contextBottom) return;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const x = Phaser.Math.Clamp(world.x, 8, this.floorW - 8);
    this.walkTarget = { x, interact: this.hasInteractableNear(x) };
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
      !this.ventureOpen &&
      !this.decoOpen &&
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
    if (this.decoOpen) {
      this.closeDeco();
      return;
    }
    if (this.inventoryOpen) this.toggleInventory();
    else if (this.craftingOpen) this.toggleCrafting();
    else if (this.dialogueOpen) this.dialogueBack();
    else if (this.ventureOpen) this.closeVentures();
    else this.togglePause();
  }

  private onNavUp(): void {
    if (this.decoOpen) {
      this.pageDeco(-1);
      return;
    }
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
    } else if (this.ventureOpen) {
      this.ventureSelected = Math.max(0, this.ventureSelected - 1);
      this.buildVenturePanel();
    } else if (this.dialogueOpen && this.dialogue) {
      this.dialogue.selected = Math.max(0, this.dialogue.selected - 1);
      this.refreshDialogue();
    } else if (this.pauseOpen) {
      this.pauseSelected = Math.max(0, this.pauseSelected - 1);
      this.refreshPause();
    }
  }

  private onNavDown(): void {
    if (this.decoOpen) {
      this.pageDeco(1);
      return;
    }
    if (this.shelterOpen && !getGame().shelterPlan?.resolved) {
      this.shelterSelected = Math.min(SHELTER_ROWS.length - 1, this.shelterSelected + 1);
      this.buildShelterPanel();
      return;
    }
    // OVERHAUL Wave C1: the shop's cursor.
    if (this.encounterOpen && !getGame().combat && !this.encounter) {
      this.shopSelected = Math.min(this.shopRows.length - 1, this.shopSelected + 1);
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
    } else if (this.ventureOpen) {
      this.ventureSelected = Math.min(VENTURES.length - 1, this.ventureSelected + 1);
      this.buildVenturePanel();
    } else if (this.dialogueOpen && this.dialogue) {
      const count = this.dialogueOptionsCount();
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
        // TWOM 对齐 §4：提振心情的物品在这里真正推动点数池。cheerFromItem 是
        // morale 池的唯一写入口（MoraleSystem 属主）——AG-29 的 moraleEffectOf
        // 是并行实现且摇序派生式不同，不接线，避免双掷双写。
        const cheer = cheerFromItem(getGame(), getItem(stack.itemId), stack.itemId);
        const cheerText = cheer.applied ? ` · 心情 +${cheer.delta}` : '';
        this.flash(`使用 ${getItem(stack.itemId).displayName} · ${STAT_LABEL[result.stat!]} +${Math.round(result.amount!)}${cured}${cheerText}`);
      } else {
        this.flash(result.reason ?? '无法使用');
      }
      return;
    }
    if (this.craftingOpen) {
      this.activateCraftEntry();
      return;
    }
    if (this.ventureOpen) {
      this.activateVentureChoice();
      return;
    }
    if (this.dialogueOpen) {
      this.activateDialogueOption();
      return;
    }
    if (this.pauseOpen) this.activatePause();
  }

  /**
   * AG-20：终局层容器 → 演出入口（docs/plans/FINALE_UX.md §2 契约）。
   * 三重门：终局层 + 容器已开过（openedContainers，二段式的第二段）+ id 有
   * 映射。任何一关不过返回 null——调用方回落到既有搜刮。交互（onInteract）
   * 与提示（hint）共用这一个判官，两边不会漂移。
   */
  private finaleEntryFor(containerId: string): 'terminal' | 'archive' | 'fuse' | null {
    const state = getGame();
    if (state.currentFloor !== FINALE_FLOOR) return null;
    if (!(state.visitedFloors[state.currentFloor]?.openedContainers.includes(containerId) ?? false)) return null;
    return containerId === 'counter' ? 'terminal'
      : containerId === 'security_safe' ? 'archive'
      : containerId === 'fuse_box' ? 'fuse'
      : null;
  }

  /**
   * AG-20：终局层视线内最近的容器——**不滤空**。
   *
   * 为什么不能直接用 nearestContainer：它跳过 items 为空的容器（既有语义，
   * 空箱不给提示），而二段式的第二段交互的恰恰是空容器——终端台的
   * guaranteed 水食第一次 E 就舔光了，剩下 45% 的电池 Roll 失败时它就是空的；
   * 档案柜/配电箱本身就有约三成概率两件 Roll 全空。不滤空，空箱子才「开过」
   * 得了、才进得了演出。三容器相距 240px，半径 44 内至多一个，不存在歧义。
   */
  private nearestFinaleContainer(): GeneratedContainer | null {
    const state = getGame();
    if (state.currentFloor !== FINALE_FLOOR) return null;
    const px = state.player.x;
    let best: GeneratedContainer | null = null;
    let bestDist = INTERACT_DISTANCE;
    for (const c of this.floorView.containers) {
      const d = Math.abs(c.x - px);
      if (d <= bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  }

  private onInteract(): void {
    if (this.stairClimb) return;
    if (this.shelterOpen) {
      this.onUse();
      return;
    }
    if (this.inventoryOpen || this.craftingOpen || this.pauseOpen || this.ventureOpen) return;
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
    // AG-20：100000 层（统治核心）的三个容器是终局演出入口
    // （docs/plans/FINALE_UX.md §2）。二段式：第一次 E 保持既有搜刮——
    // 终端台里的 guaranteed 水食是生存必需品；开过之后（openedContainers
    // 判据，LootSystem 自己维护）再交互才进演出。演出/落地/返回全部归
    // EndgameScene（handoff 语义，它自己 scene.start('Game') 回来）。
    // 终局层走不滤空的最近容器判定（见 nearestFinaleContainer）：第二段
    // 交互的就是被舔光的空箱子。
    const finaleContainer = this.nearestFinaleContainer();
    const container = finaleContainer ?? this.nearestContainer();
    if (container) {
      const from = this.finaleEntryFor(container.id);
      if (from) {
        this.scene.start('Endgame', { from });
        return;
      }
      this.openContainer(container.id);
      return;
    }
    // Before the stairwell zone, not after: the lift only exists where the up
    // stairs do not, so the two never compete for the same press.
    if (this.nearLift(state)) {
      this.takeLift();
      return;
    }
    // M1-4: a stairwell MOUTH is a question even where no stair stands behind
    // it. A segment's end floor keeps the mouth and loses the stair — the
    // climber who just landed there is standing at the mouth by construction,
    // and pressing E to keep climbing used to get silence. Ask the mouth
    // itself and let changeFloor answer; its refusal names the freight lift.
    const zone = currentInteractionZone(state) ?? stairMouthZone(state);
    if (zone === 'up') this.changeFloor(1);
    else if (zone === 'down') this.changeFloor(-1);
  }

  // ── the paid shortcut (OVERHAUL Wave C2) ─────────────────────────────────
  // F at the up stairwell buys a 2-4 floor skip. Centum's formula: the price
  // climbs with every use, so skipping is a budget decision, not free
  // fast-travel. The charge happens before the jump, so a broke player never
  // moves.
  //
  // M1-2: the same state machine every other action answers to. F used to
  // fire from inside a stair climb and from behind an open panel: a press
  // during the 2->3 climb charged 114 gold AND left the in-flight traversal
  // to commit on top of the jump, so one keypress moved the player three
  // floors. A climb or a panel means the world is mid-something; the key
  // waits, exactly as E does.
  private tryShortcut(): void {
    const state = getGame();
    if (state.status !== 'playing') return;
    if (this.stairClimb || this.inventoryOpen || this.craftingOpen || this.dialogueOpen || this.pauseOpen || this.encounterOpen || this.shelterOpen || this.ventureOpen) return;
    const top = Math.max(...PLAYABLE_FLOORS_V01);
    if (!shortcutAvailable(state.currentFloor, top)) {
      this.flash('这里没有可抄的近路');
      return;
    }
    const zone = currentInteractionZone(state);
    if (zone !== 'up') {
      this.flash('要走上楼口才能抄近路');
      return;
    }
    const salt = (state.runSeed ^ (state.day * 7919) ^ (state.currentFloor * 104729)) >>> 0;
    // M1-3: one plan, one price — the prompt, the charge and the jump all read
    // shortcutPlan, so the number advertised can never drift from the number
    // taken (the skip is segment-clamped inside the plan, once).
    const plan = shortcutPlan(state, state.currentFloor, salt);
    if (!charge(state, plan.price)) {
      this.flash(`抄近路要 ${plan.price} 金，你只有 ${state.player.gold}`);
      return;
    }
    recordShortcut(state);
    // Apply the jump through the same path a stair uses, then walk the rest.
    while (state.currentFloor < plan.target) {
      const r = tryChangeFloor(state, 1);
      if (!r.ok) break;
    }
    recordDepth(state);
    this.clearFloor();
    this.drawFloor();
    saveToStorage(state);
    this.cameras.main.flash(180, 0, 0, 0);
    this.flash(`你抄近路跳到了第 ${state.currentFloor} 层（-${plan.price} 金）`);
    playSfx('goal');
  }

  // A panel with a frame but no readable content is the worst failure mode the
  // UI can produce: it looks like the game broke. This runs in dev only and
  // names the panel in the console the moment it opens empty, so a report of
  // "a big empty box appeared" becomes a one-line diagnosis instead of a hunt.
  private assertPanelContent(panel: string, objects: ReadonlyArray<Phaser.GameObjects.GameObject>): void {
    if (!import.meta.env.DEV) return;
    const texts = objects.filter((o): o is Phaser.GameObjects.Text => o instanceof Phaser.GameObjects.Text);
    const readable = texts.some((o) => o.visible && (o.text ?? '').trim().length > 0);
    if (!readable) console.warn(`[ui] panel "${panel}" opened with no visible text — it will look like an empty box`);
    // The other half of "it will look like an empty box": a text that is
    // visible but not screen-locked is drawn in world space, so it appears
    // somewhere the camera put it rather than inside the panel. This is the
    // second panel to ship that way (the first was the frame and fill, fixed in
    // buildPanel's own comment), and both times the symptom was a correctly
    // framed panel with its words floating elsewhere on screen.
    for (const o of texts) {
      if (!o.visible) continue;
      if (o.scrollFactorX !== 0 || o.scrollFactorY !== 0) {
        console.warn(`[ui] panel "${panel}" has a text at scrollFactor (${o.scrollFactorX}, ${o.scrollFactorY}) — it will not sit inside the panel`);
      }
    }
  }

  // What the foot bar should say while a panel is open: the panel's own keys.
  // Returns null when no panel is open, so the world hint can take over.
  private openPanelHint(): string | null {
    const combat = getGame().combat;
    if (this.encounterOpen && combat) return '↑/↓ 选择 · Enter 出招 · ESC 撤退';
    if (this.encounterOpen && this.encounter) return '↑/↓ 选择 · Enter 确认 · ESC 离开';
    if (this.encounterOpen) return '↑/↓ 选择 · Enter 买入 · S 卖出 · ESC 离开';
    if (this.shelterOpen) return getGame().shelterPlan?.resolved ? 'Enter 睡觉 · ESC 返回' : '↑/↓ 选择 · Enter 安排 · ESC 返回';
    if (this.inventoryOpen) return '↑/↓ 选择 · Enter 使用 · I 关闭';
    if (this.craftingOpen) return '↑/↓ 选择 · Enter 制作 · C 关闭';
    if (this.ventureOpen) return '↑/↓ 选择 · Enter 入股 · G 关闭';
    if (this.dialogueOpen) return '↑/↓ 选择 · Enter 确定 · ESC 返回';
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
    this.shelterObjects = [];
    this.shelterMarker.setVisible(false);
  }

  private buildShelterPanel(): void {
    for (const object of this.shelterObjects) {
      if (object !== this.shelterMarker) object.destroy();
    }
    this.shelterObjects = [];
    const state = getGame();
    const { width, height } = this.viewSize();
    const panelW = 500;
    const panelH = 300;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    // Remembered for the mouse: a click outside this rectangle closes the panel.
    this.panelBox = { x: left, y: top, w: panelW, h: panelH };
    const depth = PANEL_DEPTH.game.dialogue;
    const resolved = state.shelterPlan?.resolved === true;

    this.shelterObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'green', depth));
    this.shelterObjects.push(...buildPanelHeader(this, left, top, panelW, '夜间安排 · 宿舍', UI.good, depth + 5));
    this.shelterObjects.push(...buildPanelWell(this, left + 12, top + 28, panelW - 24, 44, depth + 5));
    const stress = Math.round(state.player.stress ?? 20);
    const latest = recentDiary(state, 1)[0];
    this.shelterObjects.push(
      this.add.text(left + 24, top + 40, `压力 ${stress}/100${latest ? ` · 上次：${latest.message}` : ' · 今天还没有记录'}`, {
        fontFamily: FONT_FAMILY,
        fontSize: `${TYPE.caption}px`,
        color: hex(stress >= 70 ? TEXT.warn : TEXT.primary),
        wordWrap: { width: panelW - 48 },
      }).setOrigin(0, 0.5).setDepth(depth + 6),
    );
    const rowsTop = top + 80;
    for (const [index, row] of SHELTER_ROWS.entries()) {
      const objects = buildListRow(this, left + 16, rowsTop + index * 26, panelW - 32, depth + 6, {
        label: row.label,
        value: row.value,
        selected: index === this.shelterSelected,
        dim: resolved && state.shelterPlan?.action !== row.action,
      });
      this.shelterObjects.push(...objects);
      this.shelterObjects.push(
        this.panelHit( left + 16, rowsTop + index * 26, panelW - 32, 26, depth + 8, {
          // No buildShelterPanel() here: it re-derives shelterSelected from the
          // (still unresolved) plan and snaps the cursor back to row 0, so every
          // click used to schedule 休息 no matter which row was pressed.
          // activateShelterChoice() rebuilds after it resolves.
          onClick: () =>
            this.time.delayedCall(0, () => {
              this.shelterSelected = index;
              this.onUse();
            }),
        }),
      );
      const label = objects.find((object) => object instanceof Phaser.GameObjects.Text && object.text === row.label) as Phaser.GameObjects.Text | undefined;
      if (index === this.shelterSelected && label) {
        placeMarker(this.shelterMarker, label);
        this.shelterMarker.setDepth(depth + 8).setVisible(true).setScrollFactor(0);
      }
    }
    this.shelterObjects.push(
      this.add.text(cx, top + panelH - 14, resolved ? 'Enter 睡觉 · ESC 返回' : '↑/↓ 选择 · Enter 安排 · ESC 返回', {
        fontFamily: FONT_FAMILY,
        fontSize: `${TYPE.caption}px`,
        color: hex(PALETTE.clothHigh),
      }).setOrigin(0.5).setDepth(depth + 6),
    );
    this.shelterObjects.push(this.shelterMarker);
    // The one panel that never pinned its contents. It is rebuilt on every open,
    // so nothing else set their scrollFactor: on floor 2 (scrollY=-200) the skin
    // stayed locked to the screen while every label kept scrolling with the
    // world — the frame sat at y=210 and its words 200px above it, on the floor
    // overhead. Same failure as the encounter panel, fixed the same way.
    applyPanelDepth(this.shelterObjects, PANEL_DEPTH.game.dialogue);
    lockToScreen(this.shelterObjects);
    this.assertPanelContent('shelter', this.shelterObjects);
  }

  // ── wall-fixture close-up (key L) ───────────────────────────────────────
  // The eight fixtures from the 2026-11-14 wall sheet. They cannot be wall
  // dressing — 255-335px against a 16-26px band — and at that ratio a riveted
  // notice board becomes four grey pixels. Native size is the only size at which
  // the rivets, the pitting and the chalk strokes survive, so they are shown 1:1
  // in a panel the player pages through.
  //
  // Rebuilt per open rather than toggled, the same way the shelter panel works:
  // the fixture changes size with every page, so there is nothing worth keeping.
  private buildDecoPanel(): void {
    for (const o of this.decoObjects) o.destroy();
    this.decoObjects = [];
    const { width, height } = this.viewSize();
    const panelW = 760;
    const panelH = 470;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    this.panelBox = { x: left, y: top, w: panelW, h: panelH };
    const depth = PANEL_DEPTH.game.dialogue;
    const deco = WALL_DECO[this.decoIndex];

    this.decoObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'green', depth));
    this.decoObjects.push(...buildPanelHeader(this, left, top, panelW, '墙面档案', UI.good, depth + 5));

    // The fixture sits in its own inset well, centred, never upscaled.
    const wellX = left + 24;
    const wellY = top + 58;
    const wellW = 320;
    const wellH = 352;
    this.decoObjects.push(...buildPanelWell(this, wellX, wellY, wellW, wellH, depth + 5));
    const img = this.add.image(wellX + wellW / 2, wellY + wellH / 2, deco.key).setDepth(depth + 6);
    const src = this.textures.get(deco.key).getSourceImage() as { width: number; height: number };
    const fit = Math.min((wellW - 28) / src.width, (wellH - 28) / src.height, 1);
    img.setDisplaySize(Math.round(src.width * fit), Math.round(src.height * fit));
    this.decoObjects.push(img);

    const textX = wellX + wellW + 26;
    const textW = left + panelW - 24 - textX;
    const name = this.add
      .text(textX, top + 64, deco.name, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.title}px`, color: hex(TEXT.primary) })
      .setDepth(depth + 6);
    const where = this.add
      .text(textX, top + 100, deco.floors, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.dim) })
      .setDepth(depth + 6);
    // useAdvancedWrap is load-bearing for the fifth time in this codebase: the
    // copy is Chinese with no spaces, and the basic wrapper would ignore textW.
    const body = this.add
      .text(textX, top + 132, deco.text, {
        fontFamily: FONT_FAMILY,
        fontSize: `${TYPE.body}px`,
        color: hex(TEXT.secondary),
        lineSpacing: 8,
        wordWrap: { width: textW, useAdvancedWrap: true },
      })
      .setDepth(depth + 6);
    const page = this.add
      .text(left + panelW - 24, top + panelH - 44, `${this.decoIndex + 1} / ${WALL_DECO.length}`, {
        fontFamily: FONT_FAMILY,
        fontSize: `${TYPE.caption}px`,
        color: hex(TEXT.dim),
      })
      .setOrigin(1, 0)
      .setDepth(depth + 6);
    const hint = this.add
      .text(left + 24, top + panelH - 44, '← → 翻页 · L / ESC 关闭', {
        fontFamily: FONT_FAMILY,
        fontSize: `${TYPE.caption}px`,
        color: hex(PALETTE.clothHigh),
      })
      .setDepth(depth + 6);
    // Two click targets for the pager, under the copy column so they never cover
    // the fixture itself.
    const navY = top + panelH - 52;
    this.decoObjects.push(
      this.panelHit(textX, navY, 96, 28, depth + 8, { onClick: () => this.pageDeco(-1) }),
      this.panelHit(textX + 104, navY, 96, 28, depth + 8, { onClick: () => this.pageDeco(1) }),
    );
    const prev = this.add
      .text(textX + 48, navY + 14, '◀ 上一件', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.primary) })
      .setOrigin(0.5)
      .setDepth(depth + 9);
    const next = this.add
      .text(textX + 152, navY + 14, '下一件 ▶', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.primary) })
      .setOrigin(0.5)
      .setDepth(depth + 9);
    this.decoObjects.push(name, where, body, page, hint, prev, next);

    // Same two calls every other panel makes. Missing them is what put the
    // shelter panel's words on the floor above.
    applyPanelDepth(this.decoObjects, depth);
    lockToScreen(this.decoObjects);
    this.assertPanelContent('deco', this.decoObjects);
  }

  private toggleDeco(): void {
    if (this.decoOpen) {
      this.closeDeco();
      return;
    }
    if (this.anyPanelOpen()) return;
    this.decoOpen = true;
    this.decoIndex = 0;
    this.buildDecoPanel();
  }

  private closeDeco(): void {
    this.decoOpen = false;
    for (const o of this.decoObjects) o.setVisible(false);
  }

  private pageDeco(delta: number): void {
    this.decoIndex = (this.decoIndex + delta + WALL_DECO.length) % WALL_DECO.length;
    this.buildDecoPanel();
  }

  private activateShelterChoice(): void {
    const state = getGame();
    if (state.shelterPlan?.resolved) {
      // AG-20: 睡醒即跨日，产业结算在 finishNight→sleep 内部发生。前后对比
      // 账本，「昨夜的收益」才能在醒来时就被看见（只观察，不重复结算）。
      const ledger = state.growth?.ventures?.length ? this.ventureLedgerSnapshot() : null;
      const result = finishNight(state);
      if (ledger) this.diffVentureLedger(ledger);
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
    const target = this.floorView.containers.find((c) => c.id === containerId);
    const label = target?.label ?? containerId;
    // Tools unlock container TYPES rather than recipes: a locked safe is the
    // reason to carry the crowbar you found on floor 3.
    if (target?.needs && countItem(state.player.inventory, target.needs) === 0) {
      const tool = getItem(target.needs).displayName;
      this.flash(`${label}锁着，需要${tool}`);
      return;
    }
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
      // AG-11: and how much is left behind. lootContainer reports took/full
      // only, but the post-loot view is re-read above anyway, so the count is
      // free — "剩余留在容器" without a number made players re-open the crate
      // to find out whether it was one bottle or five.
      const remaining = this.floorView.containers.find((c) => c.id === containerId)?.items.length ?? 0;
      this.flash(
        result.took.length > 0
          ? `叠放进的已入包；新物品放不下（背包已满），剩余 ${remaining} 件留在容器`
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
      this.lootThisTrip += result.took.reduce((n, t) => n + t.quantity, 0);
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

  private nearLift(state: GameState): boolean {
    return liftDirection(state.currentFloor) !== null && Math.abs(state.player.x - LIFT_X) <= LIFT_REACH;
  }

  /**
   * Pressing E at the lift. Four outcomes, and exactly one of them moves anyone:
   * no lift here, no credential, the next segment has no floors yet, or — in the
   * future, once those segments are authored — ride it.
   *
   * The third case is the one that matters today. Every segment above 10 is
   * declared but not built, and generateFloor throws for a floor with no
   * template, so "the badge is in your hand" must not be read as "the way is
   * open". Saying which floors are missing is also the honest version of the
   * tower: the design requires the skip to be admitted, never faked.
   */
  private takeLift(): void {
    const state = getGame();
    const floor = state.currentFloor;

    // Down first: a segment's bottom floor only has the down lift, and it needs no
    // credential — you already paid to get up here. This is the way back to the
    // bed and the workbench on floor 1.
    if (liftDirection(floor) === 'down') {
      const prev = prevSegment(floor);
      if (!prev) {
        this.flash('这一层没有向下的货运电梯');
        return;
      }
      if (!hasFloorContent(prev.to)) {
        this.flash(`货运电梯停运：${floor} → ${prev.to}，中间 ${floor - prev.to - 1} 层尚未接通`);
        return;
      }
      this.rideLiftTo(prev.to, floor - prev.to - 1);
      return;
    }

    const outcome = liftOutcome(state, floor, hasFloorContent);
    const target = nextSegment(floor);
    const skipped = skippedFloors(floor);

    if (outcome === 'no-lift') {
      this.flash('这一层没有向上的货运电梯');
      return;
    }
    if (outcome === 'need-pass') {
      const need = liftRequirement(floor);
      this.flash(need ? `需要${getRecipe(need).displayName}` : '需要通行凭证');
      return;
    }
    if (outcome === 'not-connected' || !target) {
      this.flash(`货运电梯停运：${floor + 1} → ${target?.from ?? floor}，中间 ${skipped} 层尚未接通`);
      return;
    }
    this.rideLiftTo(target.from, skipped);
  }

  /**
   * Commit a lift ride. The same arrival path a stair landing takes, minus the
   * climb — and one step rather than `tryChangeFloor` in a loop, because the
   * floors in between do not exist: a loop would strand the player on the first
   * missing floor. drawFloor records the visit, so the side effects stay equal.
   */
  private rideLiftTo(target: number, skipped: number): void {
    const state = getGame();
    const from = state.currentFloor;
    state.currentFloor = target;
    state.player.x = ENTRY_X;
    this.clearFloor();
    this.drawFloor();
    recordDepth(state);
    // A dwell event belongs to the floor it was rolled on; riding out of it is
    // the same escape that walking down the stairs is.
    if (state.worldEvents.activeEvent?.source === 'dwell') state.worldEvents.activeEvent = null;
    saveToStorage(state);
    playSfx('goal');
    // AG-11: worldgen 的一句话概括接管电梯文案。穿过的不只是"N 层未探索区"——
    // crossingSummary 说得清那 N 层是哪个阶层的什么段（11-99 是底层贫民区的
    // 废弃段，不是抵达的工人宿舍区）。上行时出发层就是段顶；下行时抵达层才是
    // 段顶——两条路跨的是同一道间隙，所以取较低的那层问它。非段顶（没有向上的
    // 电梯）时它返回 null，文案退回原来的计数句式。
    const summary = crossingSummary(Math.min(from, target));
    this.flash(summary ? `${summary.text} · 到达第 ${target} 层` : `正在穿过 ${skipped} 层未探索区 · 到达第 ${target} 层`);
  }

  // M1-4: what the player is told when the stairs refuse. At a segment end
  // the tower does NOT end — 10 is not "the top", it goes to 100000 — what
  // ends is the STAIRS, and the freight lift standing at the same stairwell
  // is the way on. Saying "已到顶层" there is a lie that reads as a bug; the
  // lift's own sign already says 货运电梯, so the refusal names it too.
  // Only at the genuine tower extremes (1 below, 100000 above) is the
  // top/end copy honest.
  private stairRefusalCopy(direction: 1 | -1): string {
    const lift = liftDirection(getGame().currentFloor);
    if (direction === 1) {
      return lift === 'up' ? '这一层没有向上的楼梯，往上要乘货运电梯' : '已到顶层';
    }
    return lift === 'down' ? '这一层没有向下的楼梯，往下要乘货运电梯' : '已到尽头';
  }

  private changeFloor(direction: 1 | -1): void {
    if (this.stairClimb) return;
    const traversal = stairTraversalFor(getGame(), direction);
    if (!traversal) {
      this.flash(this.stairRefusalCopy(direction));
      return;
    }
    this.speedX = 0;
    this.stairClimb = { ...traversal, elapsedMs: 0 };
    this.openClimbCameraRoom(direction);
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
    if (result.ok) this.landingEase = true;
    if (!result.ok) {
      // The widened climb bounds go back to the standing ones: drawFloor only
      // re-sets them on the success path, and a refused landing leaves the
      // player standing on this floor for good.
      this.resetCameraBounds();
      this.player.setPosition(state.player.x, PLAYER_FEET_Y);
      this.flash(this.stairRefusalCopy(climb.direction));
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
    // TWOM 对齐 §2：满载而归 vs 空手而归——回宿舍时按这一趟的收获结算士气。
    // 1F 是家，往下走是出门、往上是回家，所以只看方向不看具体层号。
    if (climb.direction < 0 && state.currentFloor === STARTING_FLOOR) {
      backFromScavenge(state, this.lootThisTrip);
      this.lootThisTrip = 0;
    }
    saveToStorage(state);
    this.flash(`到达第 ${state.currentFloor} 层 · 已从楼梯落地`);
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
  //
  // AG-11: the warning carries the count (used/capacity). A bare "背包已满"
  // never said how full — 11/12 and 12/12 read the same and plan differently.
  private refreshBagFullWarning(): void {
    const inv = getGame().player.inventory;
    if (isBagFull(inv)) {
      // AG-11: 预警带计数（已用/容量）。光一句「背包已满」分不出 11/12 和
      // 12/12——两者的下一步打算完全不同。计数会变（置物架抬 slotCount、
      // 叠放释放格子），所以比对整句而非仅开关状态。
      const label = `背包已满（${inv.slots.length}/${inv.slotCount}）· 使用、制作或交易腾出格子，否则搜刮会留在原处；能叠进已有堆的物品仍可拾取`;
      if (this.bagFullShown && this.bagFullText.text === label) return;
      this.bagFullShown = true;
      this.bagFullText.setVisible(true);
      this.bagFullText.setText(label);
    } else {
      if (!this.bagFullShown) return;
      this.bagFullShown = false;
      this.bagFullText.setVisible(false);
    }
  }

  // ── frame ──────────────────────────────────────────────────────────────
  override update(_time: number, delta: number): void {
    this.refreshBagFullWarning();
    // The dorm's sleeping roommates breathe. Each Z carries its own phase, so
    // five beds do not pulse in unison — a shared phase reads as one blinking
    // overlay rather than as five people asleep. Driven from here rather than by
    // tweens because a tween outlives the floor objects it targets.
    if (this.dormSleepers.length > 0) {
      const now = this.time.now;
      for (const sleeper of this.dormSleepers) {
        const wave = Math.sin(now / 900 + sleeper.phase);
        sleeper.z.setAlpha(0.4 + 0.4 * wave);
        sleeper.z.y = sleeper.baseY - 2 * wave;
      }
    }
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
    if (this.inventoryOpen || this.craftingOpen || this.dialogueOpen || this.pauseOpen || this.encounterOpen || this.shelterOpen || this.ventureOpen || this.questsOpen) return;
    const state = getGame();

    // AG-11: the neighbours walk their own schedule. Pure function of game
    // time, so it only has to run where the clock runs — which is exactly after
    // the panel early-return above.
    this.syncNpcs(state);

    // B3-01 D9: a rejected write used to be silent, so a full disk or a private
    // window lost the run without a word. The count only grows, so comparing it
    // against what we last saw turns any failed save — autosave, craft, trade,
    // sleep, floor change — into exactly one warning.
    const failures = saveFailureCount();
    if (failures > this.lastSaveFailures) {
      this.lastSaveFailures = failures;
      this.flash('存档失败：进度不会被保留（浏览器存储不可用）');
    }

    let dir = 0;
    if (this.cursors?.left.isDown || this.wasd?.left.isDown) dir -= 1;
    if (this.cursors?.right.isDown || this.wasd?.right.isDown) dir += 1;
    // Click-to-walk. A held key cancels the order rather than fighting it, so the
    // player never feels the mouse and the keyboard pulling opposite ways.
    if (this.walkTarget) {
      if (dir !== 0) {
        this.walkTarget = null;
      } else {
        const remaining = this.walkTarget.x - state.player.x;
        if (Math.abs(remaining) <= 6) {
          const order = this.walkTarget;
          this.walkTarget = null;
          // Arrived: if the click landed on something E can use, use it.
          if (order.interact) this.onInteract();
        } else {
          dir = remaining > 0 ? 1 : -1;
        }
      }
    }
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

    // AG-20: 帧循环跨日时产业结算在 advanceTime 内部发生。前后对比账本，
    // 当日收益/倒塌变成面板读数与一条 flash（只观察，不重复结算——水位
    // 标记 economy:settled-day 仍是结算的唯一把关）。
    const ledger = state.growth?.ventures?.length ? this.ventureLedgerSnapshot() : null;
    const tick = advanceTime(state, delta);
    if (ledger) this.diffVentureLedger(ledger);
    const rolled = ensureNightEvent(state);
    if (rolled.rolled && rolled.event) {
      if (rolled.event.type === 'wanderer') playSfx('danger');
      this.flash(rolled.event.message);
    }
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

    // OVERHAUL interaction: the hint used to describe the WORLD even while a
    // panel covered it, so the bar read "按 E 查看问号点" underneath an open
    // inventory - it promised an interaction the player could not perform and
    // said nothing about the one they were in. A panel owns the bar now.
    const panelHint = this.openPanelHint();
    if (panelHint !== null) {
      this.hintText.setText(panelHint);
      return;
    }

    if (this.nearBed(state)) {
      this.hintText.setText(isNight(state.gameMinuteOfDay) ? '按 E 安排夜间行动' : '床位 · 20:00 后可安排夜间行动');
      return;
    }
    if (this.nearCraftStation(state)) {
      this.hintText.setText('按 C 制作');
      return;
    }
    if (this.nearestNpc(state)) {
      this.hintText.setText('按 E 对话');
      return;
    }
    if (event?.type === 'leak' && state.currentFloor === event.floor) {
      this.hintText.setText('此地漏水，地面物资受潮');
      return;
    }
    const finaleContainer = this.nearestFinaleContainer();
    const container = this.nearestContainer();
    const zone = currentInteractionZone(state);
    if (this.nearestEncounterSpot()) this.hintText.setText('按 E 查看问号点');
    else if (finaleContainer) {
      // AG-20：终局层的容器开过之后，E 进的是演出不是搜刮——提示要说得准。
      // 用不滤空的判定：被舔光的空箱子也要告诉玩家还能再看它一眼。
      this.hintText.setText(this.finaleEntryFor(finaleContainer.id) ? `按 E 查看${finaleContainer.label}` : `按 E 打开 ${finaleContainer.label}`);
    }
    else if (container) this.hintText.setText(`按 E 打开 ${container.label}`);
    else if (this.nearLift(state)) this.hintText.setText('按 E 乘货运电梯');
    // OVERHAUL Wave C2: the up stairwell advertises the paid shortcut, priced
    // live so the player can decide before spending. The price comes from the
    // same plan the charge spends (M1-3), so the prompt cannot overpromise a
    // cheaper jump than the purse will actually be billed for.
    else if (zone === 'up' && shortcutAvailable(state.currentFloor, Math.max(...PLAYABLE_FLOORS_V01))) {
      const salt = (state.runSeed ^ (state.day * 7919) ^ (state.currentFloor * 104729)) >>> 0;
      const { price } = shortcutPlan(state, state.currentFloor, salt);
      this.hintText.setText(`按 E 上楼 · F 抄近路（${price} 金）`);
    }
    else if (zone === 'up') this.hintText.setText('按 E 上楼');
    else if (zone === 'down') this.hintText.setText('按 E 下楼');
    else this.hintText.setText('A/D 或 ←/→ 移动 · E 交互 · I 背包 · C 制作 · M 地图 · ESC 菜单');
  }

  // The wanderer only haunts its own floor; it is slower than the player and
  // chips HP on a cooldown, so outrunning it or leaving the floor always works.
  // B3-15: a dwell-rolled wanderer acts day or night — the pressure comes from
  // lingering, not from the clock, so gating it on night would let a player
  // idle safely until dark.
  private wandererEventKeyFor(state: GameState, event: ActiveEvent | null): string {
    // AG-20: 寻仇在场时没有事件（或事件不是巡游体）——键里带 'vendetta' 与
    // 当天楼层，同一天同一层只生成一次；夜间事件的键语义不变。
    if (!event) return `vendetta:${state.day}:${state.currentFloor}:${state.worldEvents.dwell?.rolls ?? 0}`;
    return `${state.day}:${event.source ?? 'night'}:${event.floor ?? -1}:${state.worldEvents.dwell?.rolls ?? 0}`;
  }

  private wandererSituation(state: GameState, event: ActiveEvent): WandererSituation {
    const x = this.wanderer?.x ?? (state.player.x < this.floorW / 2 ? this.floorW - 48 : 48);
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
    if (!aiNpcConfig().enabled || eventStatus(event) === 'resolved' || !this.wanderer) return;
    const token = this.wandererAutonomy.begin();
    if (token === null) return;
    const cfg = aiNpcConfig();
    const key = this.wandererEventKey;
    const situation = this.wandererSituation(state, event);
    void decideWandererIntent(state, this.npcStateForWanderer(), situation, {
      brain: new OllamaBrain({ baseUrl: cfg.baseUrl, model: cfg.model, timeoutMs: cfg.timeoutMs }),
      fallback: new WandererFallbackBrain(),
      timeoutMs: cfg.timeoutMs,
      memoryRecallK: cfg.recallK,
    }).then((decision) => {
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
    // AG-11: 呈现判定归导演器（NpcAutonomy.planNightWanderer）。该不该在场、
    // 在不在本层、天亮不亮、从哪出来——它读 EventSystem 的既有产物一次算清，
    // 场景原来在这里复述同一套条件（事件类型/resolved/楼层/夜间或停留），两边
    // 迟早会对不上；现在只有一处语义。present=false 时 plan.reason 是缺席原因。
    //
    // AG-20: 跨层寻仇（planWandererVendetta）与夜间事件独立求值，present 时
    // 寻仇优先（NPC.md §11：寻仇无视抽层结果，没有事件也照来——结仇的流浪
    // 者会摸到玩家当前楼层）。寻仇只供给「该不该在场/从哪出来」，意图状态机
    // （攻击/撤退/AI 决策）仍归 wanderer 事件：寻仇没有事件可写，恒为攻击。
    const vendetta = planWandererVendetta(state);
    const plan = vendetta.present ? vendetta : planNightWanderer(state);
    const event = state.worldEvents.activeEvent;
    // 意图/撤退那套只认本层的巡游体事件；寻仇在场时事件可能不是巡游体
    // （或根本没有），此时没有可写的事件。
    const wandererEvent = !vendetta.present && event && event.type === 'wanderer' ? event : null;
    if (!plan.present || (!vendetta.present && !event)) {
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
    const key = this.wandererEventKeyFor(state, wandererEvent);
    if (!this.wanderer) {
      // AG-11: 出生点也归导演器——plan.spawnX 是 (runSeed, day, source, floor)
      // 的确定性答案，同一天同一层它永远从同一个地方出来（测试可钉、读档可复现）；
      // 旧的「玩家左半边就从右端出」是启发式，同一次 run 里能给出两个位置。
      const spawnX = plan.spawnX;
      this.wanderer = this.add.sprite(spawnX, PLAYER_FEET_Y, walkSheetKey('wanderer')).setOrigin(0.5, 1).setDepth(ACTOR_DEPTH);
      this.wanderer.play(walkAnimKey('wanderer'));
      this.wandererAI = freshWandererAI(spawnX);
      this.wandererEventKey = key;
      this.wandererIntent = wandererEvent && eventStatus(wandererEvent) === 'flee' ? 'flee' : 'attack';
      this.wandererLastEncounter = '';
      this.wandererGlow = addGlow(this, spawnX, PLAYER_FEET_Y - 8, 34, 0.42, LIGHT_DEPTH);
      // 生成宽限：种子出生点可能离玩家很近（旧启发式保证出生在对面，种子不保证），
      // 把命中冷却锚在生成帧——首击遵守与其他击打相同的间隔，不是免打死，只是不瞬发。
      this.wandererHitAt = this.time.now;
      // AG-20: 寻仇登场没有事件播报，玩家该知道这一层为什么危险。
      if (vendetta.present) this.flash('它记着那件事——循着仇气找上门来了。');
      if (wandererEvent && eventStatus(wandererEvent) === 'active') this.requestWandererIntent(state, wandererEvent);
    }
    const ai = this.wandererAI!;
    const previousState = ai.state;
    ai.selfX = this.wanderer!.x;
    if (this.wandererGlow) this.wandererGlow.x = this.wanderer!.x;
    const step = stepWandererAI(ai, state.player.x, delta, this.wandererIntent);
    const toward = Math.sign(state.player.x - this.wanderer!.x);
    const dir = step.direction === 'away-from-player' ? -toward : toward;
    if (dir !== 0) this.wanderer!.x = Math.max(0, Math.min(this.floorW, this.wanderer!.x + dir * WANDERER_SPEED * step.speedMultiplier * (delta / 1000)));
    if (dir !== 0) this.wanderer!.setFlipX(dir < 0);

    if (this.wandererIntent === 'flee') {
      if (!wandererEvent) {
        // 没有可撤退的事件了（寻仇/无事件不逃跑）：按攻击处理。
        this.wandererIntent = 'attack';
      } else {
        const safe = Math.abs(this.wanderer!.x - state.player.x) >= WANDERER_FLEE_SAFE_DISTANCE;
        const atExit = this.wanderer!.x <= WANDERER_FLEE_EXIT_MARGIN || this.wanderer!.x >= FLOOR_WIDTH - WANDERER_FLEE_EXIT_MARGIN;
        if (safe || atExit) {
          this.resolveWandererFlee(state, wandererEvent);
          return;
        }
      }
    }

    // Re-open a decision only after an attack cycle reaches cooldown; never
    // issue parallel requests for one event.
    if (this.wandererIntent === 'attack' && previousState !== ai.state && ai.state === 'cooldown' && wandererEvent) {
      setEventStatus(wandererEvent, 'active');
      this.requestWandererIntent(state, wandererEvent);
    }

    const damage = ai.state === 'lunge' ? WANDERER_DAMAGE * 2 : WANDERER_DAMAGE;
    if (this.wandererIntent === 'attack' && ai.state !== 'fleeing' && Math.abs(this.wanderer!.x - state.player.x) <= 12 && this.time.now - this.wandererHitAt >= WANDERER_HIT_COOLDOWN_MS) {
      this.wandererHitAt = this.time.now;
      state.player.hp = Math.max(0, state.player.hp - damage);
      this.recordWandererMemory('attack', `巡游体在第${state.currentFloor}层攻击了玩家，造成${damage}点伤害。`);
      inflict(state, 'wound', ai.state === 'lunge' ? 55 : 30, absoluteMinute(state));
      // TWOM 对齐 §2：目睹/遭受袭击掷创伤概率——这是 morale 五机制里的
      // KosovoMoraleTraumaProbability。纯函数内部掷，同 seed 同状态同结果。
      witnessTrauma(state);
      this.refreshStats();
      this.playActionAnim(hurtAnimKey('player'), 400);
      playSfx('hurt');
      this.cameras.main.shake(160, 0.008);
      this.cameras.main.flash(140, 230, 109, 99);
      playFx(this, 'ground-slam', state.player.x, PLAYER_FEET_Y - 6, LIGHT_DEPTH);
      this.flash(`被巡游体击中！HP -${damage}，快回宿舍或换层！`);
      if (state.player.hp <= 0) state.status = 'lost';
    }
  }
}
