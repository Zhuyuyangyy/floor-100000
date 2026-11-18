import Phaser from 'phaser';

import { PALETTE, TEXT, hex } from '../render/palette.ts';
import { FloatTextPool, playFx, setFxDegraded, startFxLoop } from '../render/fx';
import { DESIGN_HEIGHT } from '../core/design';
import { getGame, hasGame, startNewGame } from '../core/session';
import {
  BED_X,
  CRAFT_X,
  DOWN_EXIT_X,
  downExitXFor,
  floorWidthFor,
  roomCountFor,
  FLOOR_GEOMETRY_BALANCE,
  FLOOR_GEO_SEED_TAG,
  FLOOR_VIEW_ZOOM,
  ENTRY_X,
  FLOOR_BAND,
  FLOOR_HEIGHT,
  FLOOR_WIDTH,
  INTERACT_DISTANCE,
  PLAYABLE_FLOORS_V01,
  PLAYER_FEET_Y,
  PLAYER_DECELERATION,
  PLAYER_SPEED,
  ROOM_COUNT,
  ROOM_WIDTH,
  STARTING_FLOOR,
  STAIR_START_Y,
  UP_EXIT_X,
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
  stairMouthZone,
  stairTraversalFor,
  stepHorizontalSpeed,
  tryChangeFloor,
} from '../systems/FloorSystem';
import { BUNK_DISMANTLE_COST, BUNK_SEARCH_COST, OBSTACLE_DIG_COST_MINUTES, OBSTACLE_DIG_MS, SEARCH_MS,
  bunkDismantleTool, clampXAgainstObstacles, clearObstacle, dismantleBunk, floorExitXs, getFloorView, homewardExitXs,
  isBunkDismantled, isBunkSearched, isObstacleCleared, lootContainer, lootGround, nearestObstacle, obstacleTool,
  obstaclesForFloor, recordFloorVisit, rescueSealedPlayerX, searchBunk, type FloorObstacle } from '../systems/LootSystem';
import { hasFloorContent } from '../data/floorTemplates';
import { liftDirection, liftOutcome, liftRequirement, nextSegment, prevSegment, skippedFloors } from '../core/segments';
import { crossingSummary, floorGeometryFor } from '../core/worldgen';
import type { FloorGeometry } from '../core/worldgen';
import { countItem, removeItem, STAT_LABEL, useConsumable } from '../systems/InventorySystem';
import { craft, hasUpgrade, nightOverlayAlpha, purifyWater, recipePreview } from '../systems/CraftingSystem';
import { absoluteMinute, advanceTime, ACTION_COSTS, AUTOSAVE_EVERY_GAME_MINUTES, isNight, spendTime } from '../systems/SurvivalSystem';
import { ensureNightEvent, eventStatus, setEventStatus } from '../systems/EventSystem';
import { armNextRoll, dwellRollDue, ensureDwell, isDwellExempt, rollDwellEvent, tickDwell } from '../systems/dwellPressure';
import { freshWandererAI, stepWandererAI, type WandererAI } from '../systems/wandererAI';
// AG-74：BGM 音乐层。接线刻意保持一行一处——create 起楼层音乐、战斗/入夜/
// 场景销毁各一切换、update 里每帧同步（夜晚/电台到期由 syncMusic 按上下文
// 重解，命中同一曲目是 no-op）。
import { RADIO_MINUTES, startFloorMusic, stopBgm, syncMusic, useRadioFromSlot } from '../systems/AudioSystem';
import { ensureDailyGoal, grantDailyGoalReward, idleWindowSuggestion, isDailyGoalDone } from '../systems/dailyGoals';
import { inflict } from '../systems/SicknessSystem';
import {
  backFromScavenge,
  cheerFromItem,
  witnessTrauma,
} from '../systems/MoraleSystem';
import { diaryOf } from '../systems/DiarySystem';
// AG-26 / RC-01：统一触发器。import 本模块即完成启动注册（副作用），求值在
// update() 里每帧跑——见那边的接线注释。
import { evaluateTriggers } from '../systems/triggers';
import { availableShelterActions, finishNight, resolveShelterAction } from '../systems/ShelterSystem';
import {
  nightChoicePending,
  nightWatchEvidenceNote,
  nightWatchWakeNote,
  recordNightChoice,
  recordNightDismissal,
  settlePendingVisitOnSleep,
  stepNightWatch,
  type NightChoice,
} from '../systems/NightSystem';
import { recordDepth } from '../systems/progress';
import { CHARACTER_NAMES, applyDepth, loadMeta, saveMeta, unlockFromDepth } from '../systems/metaProgress';
// AG-77 的求值/计数/持久化（ AchievementSystem ）与 toast 编排
// （controllers/AchievementController）已随 RC-03 拆分第 5 步迁出；场景只留
// 事件类型（emitAchievementEvent 委托签名用）。
import type { AchievementEvent } from '../systems/AchievementSystem';
import type { CharacterKey } from '../render/artpack';
import { lowHpPulse, moveSpeedFactor } from '../render/feedback';
import { GAME_CONFIG } from '../core/config';
import {
  markResolved,
  resolveEncounter,
  rollEncounter as rollFloorEncounter,
  shouldSkip,
  isCombatKind,
  type Encounter,
  type EncounterChoice,
} from '../systems/encounters';
import { encounterSpots, nudgeSpotX, placeClearX } from '../systems/encounterSpots';
// AG-63：combatWeaponLabel/combatBehaviorLabel 两份纯函数随 RC-03 拆分第 7 步
// （CombatController）迁到 systems/combat.ts——与 playerCombatant 同一口径的
// 家；本文件 re-export 保持 combatHud.test.ts 的 import 路径
// （'../scenes/GameScene'）不变，openPanelHint 的战斗脚注也走它们。
import { playerCombatant, combatWeaponLabel } from '../systems/combat';
export { combatWeaponLabel, combatBehaviorLabel } from '../systems/combat';
import { moveSpeedMult } from '../systems/relics';
// AG-81：本局统计。只加钩子不改逻辑——各事件点 bumpStat 一行，读写都在
// StatsSystem（纯函数 + 旧存档补零）。buildStatsTable 是结算画面的共享统计
// 表组件，暂停菜单的统计面板复用同一件。
import { bumpStat, noteFloorReached } from '../systems/StatsSystem';
import { buildStatsTable } from './EndScene';
import { CombatController } from './controllers/CombatController';
import { StatsPanelController, type PanelBox, type StatsPanelHost } from './controllers/StatsPanelController';
import { MonologueController, type MonologueHost } from './controllers/MonologueController';
import { PerfController, type PerfHost } from './controllers/PerfController';
import { TutorialController, type TutorialHost } from './controllers/TutorialController';
import { AchievementController, type AchievementHost } from './controllers/AchievementController';
import { NavBarController, type NavBarHost, type NavSlotKey } from './controllers/NavBarController';
import { DialogueController, type DialogueHost } from './controllers/DialogueController';
// AG-54/AG-60/AG-67：HUD 顶带（四联圆环/铆钉板/数值行）+ 背包面板在
// controllers/HudController（RC-03 拆分第 9 步），场景只持控制器本体 +
// buildHud 编排与公开委托面。BAG_BALANCE 随迁出后经此 re-export——
// bagPanel.test.ts 的 import 路径（'../scenes/GameScene'）不变（同第 7 步
// combatWeaponLabel 的先例）。
import { HudController, STAT_BARS } from './controllers/HudController';
export { BAG_BALANCE, type BagBalance } from './controllers/HudController';
import { charge, recordShortcut, shortcutAvailable, shortcutPlan } from '../systems/shortcut';
import { deriveSeed, makeRng } from '../core/rng';
import { addItem } from '../systems/InventorySystem';
import { clearSave, saveFailureCount, saveToStorage } from '../systems/SaveSystem';
// AG-73：新手教程的本体在 controllers/TutorialController（RC-03 拆分第 3
// 步），场景只留两处：开局 flash 的那一句（激活与否决定放哪句）与导航条
// contextual 分支的接线；onEsc 的跳过早退与 update 的 tick 同走控制器。
import { TUTORIAL_OPENING_LINE, WORLD_DEFAULT_HINT } from '../data/tutorial';
import { playSfx } from '../render/audio';
// AG-91：juice 层（战斗打击感）随 RC-03 拆分第 7 步整体迁入 CombatController
// （纯逻辑仍留 render/juice.ts，Node 单测直跑）；场景只剩 get juice() 取证
// 委托引用 JuiceState 类型。
import type { JuiceState } from '../render/juice';
import { SettingsScene } from './MenuScene';
import { applyPanelDepth, buildPanel, createMarker, lockToScreen, HUD_FEEDBACK_DEPTH, PANEL_DEPTH, placeMarker, placeMarkerLeftOf, type PanelObject } from '../render/panels';
import {
  FONT_FAMILY,
  HUD_FOOT_H,
  TYPE,
  UI,
  buildListRow,
  buildPanelHeader,
  buildPanelWell,
} from '../render/uiKit';
import { characterKeyForNpc } from '../render/artpack';
import { framedButton, hitRect } from '../render/pointer';
import { createStatRingsBaker, type StatRingsBaker } from '../render/hudSkin';
import { estimateTextWidth } from '../render/dialogueLayout';
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
  runAnimKey,
  searchAnimKey,
  walkAnimKey,
  walkSheetKey,
} from '../render/walkcycle';
import { WEAPON_GRIP_X, WEAPON_GRIP_Y, WEAPON_H, WEAPON_KEY, WEAPON_W } from '../render/weapon.ts';
import { attackFrameIndex, charAnimHoldMs, isCharAnimBacked } from '../render/charAnims';
import { itemIconKey } from '../render/itemIcons';
import { containerTextureKey } from '../render/furniture';
import { corridorTint, drawCorridorRoom, drawCrowd, drawStairwell, floorKeyFor, placeDoor, placeWindow, stairClimbPose, wallKeyFor } from '../render/corridors';
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
import { CONTAINER_LABEL_DROP, HUD_LAYOUT } from '../render/hudLayout';
// RC-03 拆分第 7 步：BEHAVIOR_LABELS/MONSTER_BAR_COLORS/monsterFormFor 随
// 战斗台上迁 CombatController；场景只剩两个第一参钉死 Phaser.Scene 的装配
// 薄封装（CombatHost 面）与两个返回类型。
import {
  createHeadTag,
  createMonsterView,
  type HeadTag,
  type HeadTagOptions,
  type MonsterView,
  type MonsterViewOptions,
} from '../render/monsterArt';
import { getRecipe, isPassUpgrade, materialSourceHint, type RecipeId, type UpgradeId } from '../data/recipes';
import {
  CRAFT_NODE_H,
  CRAFT_NODE_W,
  CRAFT_TREE_BALANCE,
  CRAFT_TREE_EDGES,
  CRAFT_TREE_NODES,
  craftColumnX,
  craftNodeStatus,
  craftTreeBounds,
  findCraftNode,
  type CraftTreeNode,
} from '../data/craftTree';
import { WALL_DECO } from '../data/wallDeco';
import { NPCS, NPC_FLOOR, npcsOnFloor, type NpcDef, type NpcId } from '../data/npcs';
import { QUEST_FLAG, QUESTS } from '../data/quests';
import { clearFlag, hasFlag, setFlag } from '../systems/WorldFlags';
import { stockOf, syncNpcInventory } from '../ai/npcInventory';
import { NPC_MARGIN, npcAutonomyFor, scheduleFor, slotAt, type NpcAutonomyView } from '../ai/npcSchedule';
import { aiNpcConfig } from '../ai/config';import { OllamaBrain } from '../ai/brains/ollamaBrain';
import { createNpcState } from '../data/npcPersonalities';
import { loadNpcState, recordMemory, saveNpcState } from '../systems/NpcMemory';
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

// AG-77 成就解锁 toast 的几何与节奏（TOAST_* 八常量 + ToastPart 零件类型）
// 随 controllers/AchievementController 迁出（RC-03 拆分第 5 步）。

// AG-61：树形制作面板的几何。13 条配方的滚动列表整体换成一棵合成树
// （用户原话：「制作可以用那种二叉树那种合成的方案去做」）：材料列在左，
// 设施/武器列居中，凭证链沿右路梯级下行，边=合成路径。树比面板高是必然，
// 视图变换（拖拽平移 + 滚轮缩放）的范围与节点尺寸走
// config/game-balance.json 的 craftTree 块（src/data/craftTree.ts 载时校验），
// 这里只留排版锚点。
/**
 * 树面板宽：**全画布宽**。这一版 Phaser 的 WebGL 不支持任何遮罩
 * （GeometryMask 只有 Canvas 渲染器有，BitmapMask 整个不存在），放大平移后
 * 节点会画出面板框、露到世界层。面板做到全宽后画布边缘即面板边缘，配合
 * clamp 的内边（见 clampCraftPan），内容在任何缩放下都逃不出去。
 */
const CRAFT_TREE_PANEL_W = 1280;
/** 树面板顶：HUD 带（60）之下。 */
const CRAFT_TREE_PANEL_TOP = 56;
/** 树面板高：底边 676，清开 foot 带（680）。 */
const CRAFT_TREE_PANEL_H = 620;
/** 详情块第一行的 y（效果 / 状态+档位 / 材料 / 去哪拿 四行流式排布）。 */
const CRAFT_TREE_DETAIL_Y = 490;
/**
 * 详情文本的换行宽。右侧留出制作按钮（116px + 12px 透气）。
 * 最坏流预算：效果 1 行 + 状态 1 行 + 材料 1 行 + 去哪拿 2 行 =
 * 5 × fontLineBox(caption) + 3 × gap = 143px，落在 520..676 的面板内边
 * （改动文案后跑 e2e/ag44-scene-wire.spec.ts 量真实 bounds）。
 */
const CRAFT_TREE_DETAIL_W = 1030;
/** 详情块四行之间的透气。 */
const CRAFT_TREE_DETAIL_GAP = 6;
/** 制作按钮（Enter 的鼠标版）几何，贴在详情第一行右侧。 */
const CRAFT_TREE_BUTTON_W = 116;
const CRAFT_TREE_BUTTON_H = 34;
// AG-20：终局层（统治核心）。这一层的三个容器是终局演出入口
// （docs/plans/FINALE_UX.md §2 契约，EndgameScene 归 AG-21）。
const FINALE_FLOOR = 100000;
// SICKNESS_TIER_LABEL 随环境行迁入 HudController（RC-03 拆分第 9 步）。
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
/** The plate's own fill alpha (also what a future selected look restores). */
const CONTAINER_LABEL_PLATE_ALPHA = 0.94;
/**
 * AG-52: the player-proximity band, in px before INTERACT_DISTANCE.
 *
 * The semantics FLIPPED with the invisible-label rework (user: 「你不用把字写在
 * 上面。就不用写这个储物柜是啥啥啥的……靠近它的时候，或者是比较隐形的文字……
 * 不是这么明显的，会影响我们的观感」). The nameplate used to be a permanent
 * fixture that faded OUT over the last 24px of approach, because a plate under
 * the player's chin read as clutter. It is now the opposite: nothing at all
 * from afar, and a low-alpha stealth line that fades IN over the same 24px,
 * so walking past never pops. The name is on screen exactly when the container
 * is actionable — the same window the foot bar's 「按 E 打开」 owns.
 * (The drop itself lives in render/hudLayout as CONTAINER_LABEL_DROP.)
 */
const CONTAINER_LABEL_FADE_PX = 24;
/**
 * AG-52: the stealth look's alpha — low enough to read as a shadow on the wall
 * rather than as a nameplate, high enough to read when the player is standing
 * on top of the container. The old plate's ink at 0.94 is exactly the
 * 「这么明显」 the user rejected.
 */
const CONTAINER_LABEL_STEALTH_ALPHA = 0.35;
/**
 * AG-52: the stealth look's font size. A step down from the 22px plate font,
 * the same 18px the dorm's 「室友」 sleeper tags already use — a quiet second
 * voice in the room rather than a sign over it.
 */
const CONTAINER_LABEL_STEALTH_FONT = 18;

/**
 * AG-52: what a container's name looks like right now — the pure contract the
 * scene draws and labelsAndView.test.ts pins. Three looks:
 *
 *   - afar: nothing at all (alpha 0, no plate). The wall is just a wall.
 *   - near (inside INTERACT_DISTANCE, fading in over CONTAINER_LABEL_FADE_PX):
 *     the stealth line — 0.35 alpha, 18px, NO backing plate.
 *   - selected: the full old nameplate — 22px, alpha 1, plate at full ink.
 *     Nothing produces `selected` yet; it is the interface the user's future
 *     「选位置」 interaction (「等到后面我们就是说做一个东西之后的话，会让用户
 *     选这个位置」) plugs into, so the scene never has to relearn this shape.
 *
 * Pure and Phaser-free on purpose: the scene's per-frame fader calls it, and
 * the unit test imports the very same function.
 */
export interface ContainerLabelLook {
  /** The name to draw. Always the container's own label; alpha decides if it shows. */
  text: string;
  /** Text alpha, 0..1. */
  alpha: number;
  /** Backing-plate alpha, 0..1. Stealth has no plate; selected restores it. */
  plateAlpha: number;
  /** Font size in px: the quiet size for stealth, the plate font for selected. */
  fontSize: number;
}

export function containerLabelFor(
  container: { x: number; label: string },
  view: { playerX: number; selected?: boolean },
): ContainerLabelLook {
  if (view.selected) {
    return {
      text: container.label,
      alpha: 1,
      plateAlpha: CONTAINER_LABEL_PLATE_ALPHA,
      fontSize: CONTAINER_LABEL_FONT,
    };
  }
  const dist = Math.abs(view.playerX - container.x);
  // Distance-proportional fade-in rather than a hard cut, so walking past does
  // not pop — the mirror of the old fade-out.
  const t = Math.max(0, Math.min(1, (INTERACT_DISTANCE + CONTAINER_LABEL_FADE_PX - dist) / CONTAINER_LABEL_FADE_PX));
  return {
    text: container.label,
    alpha: CONTAINER_LABEL_STEALTH_ALPHA * t,
    plateAlpha: 0,
    fontSize: CONTAINER_LABEL_STEALTH_FONT,
  };
}
/**
 * AG-11: NPC 名签的 y——居民头顶上方一个 CONTAINER_LABEL_DROP。
 * 容器是 28px 的矮道具，「基座-36」落在道具正面；居民是 96px 的立绘
 * （脚在 PLAYER_FEET_Y，头在 PLAYER_FEET_Y-FRAME_H），同一个 DROP 只能从
 * 头顶算，否则名签压在角色身上（旧位置 y=FLOOR_HEIGHT-68=132，正在躯干上）。
 */
const NPC_LABEL_Y = PLAYER_FEET_Y - FRAME_H - CONTAINER_LABEL_DROP;

// ── AG-63：战斗脚注与 debuff 提示的纯函数契约 ─────────────────────────────
//
// 用户原话：「攻击者从那个地方出来我们对打的时候我需要看到我们的页面然后
// 左下角提示那啥用什么来攻击等等」「这个绿色的我不知道是什么好像是 Bug
// 你修改下」。两件事都落在提示层，且都值得被单测钉住：战斗脚注回答「拿
// 什么打、按什么键」，debuff 文案给那片绿光一个名字。纯函数 + Phaser-free，
// combatHud.test.ts 直 import（场景模块 import Phaser，Node 下跑不了，
// 测试用 vi.mock('phaser') 桩——与 labelsAndView.test.ts 同款）。
//
// RC-03 拆分第 7 步：武器标签（combatWeaponLabel）与行为标签
// （combatBehaviorLabel）随 CombatController 迁到 systems/combat.ts（与
// playerCombatant 同一口径的家），本文件留 re-export——import 路径不变。
// 脚注串（combatFootHint）与 debuff 文案留本文件（提示层归场景）。

/**
 * 左下角战斗提示。先答「用什么攻击」（用户点名要的），再给三个动作的键。
 * 面板里也有这三行，但面板是模态、脚注是常驻——玩家余光扫到底部就知道
 * 这一仗怎么打，不用等面板刷出来。
 */
export function combatFootHint(weaponLabel: string, damage: number): string {
  return `当前武器：${weaponLabel}（伤害 ${damage}）· Enter 出招 · ↑/↓ 选择 · ESC 撤退`;
}

/** debuff 阈值内那句 flash：给绿光起名字，并说该去干什么。 */
export function debuffEnterMessage(hungry: boolean, parched: boolean): string {
  if (hungry && parched) return '又饿又渴，眼前泛起点点绿光——去找点吃的喝的';
  if (hungry) return '饥肠辘辘，眼前泛起点点绿光——去找点吃的';
  return '喉咙干得冒烟，眼前泛起点点绿光——去找点水喝';
}

/** 绿光消退那句 flash。与体温的「缓过来了」同一声调，不同的事。 */
export const DEBUFF_CLEARED_MESSAGE = '绿光退了，身体缓过来了';

/** 左下角常驻小标记的文案：debuff 期间它一直挂在脚注条上方。 */
export function debuffMarkLabel(hungry: boolean, parched: boolean): string {
  if (hungry && parched) return '状态：又饿又渴';
  if (hungry) return '状态：饥饿';
  return '状态：干渴';
}
/**
 * One fade listener per scene, replaced on every floor build. Registering per
 * build without removing the previous one stacks listeners that all drive the
 * NEW floor's labels from stale closures; clearFloor() destroys the objects but
 * nothing would remove the handler. A WeakMap so a scene restart cannot leak.
 */
const CONTAINER_LABEL_FADERS = new WeakMap<Phaser.Scene, () => void>();
/**
 * AG-52: one climb-target syncer per scene, replaced on every floor build — the
 * same shape as CONTAINER_LABEL_FADERS above, for the same reason: stacking
 * listeners across floors would drive the new floor from stale closures.
 */
const CLIMB_TARGET_SYNCERS = new WeakMap<Phaser.Scene, () => void>();

const LIFT_X = 1165;
const LIFT_REACH = 30;
const LIFT_SIGN_Y = 46;
const LIFT_SIGN_FONT = 18;

const WANDERER_FLEE_SAFE_DISTANCE = 280;
const WANDERER_FLEE_EXIT_MARGIN = 24;

// STAT_BARS（四联圆环行规格）随 HUD 带迁入 HudController（RC-03 拆分第 9
// 步）——定义住在圆环的本家，本文件 import 它注入 MonologueController 的
// 状态卡（同一份数组对象，不复制数据）。

// Body heat gets its own readout rather than a fifth bar: it is the one stat a
// floor owns, so it reads as "where you are" as much as "how you are". The bar
// would have said the latter and hidden the former.
// TEMP_LABEL/SICKNESS_TIER_LABEL/GOAL_LABELS 随 HUD 段迁入 HudController
// （RC-03 拆分第 9 步）——环境行/疾病档/目标行的用语只有那一处消费者。

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
// 裁决记录（merge ag-81）：两侧各自演化了暂停菜单末位项——HEAD 为 AG-72 的
// 「设置」（index 4），ag-81 为「本局统计」（其基线无「设置」）。前四项的
// 键位走法被 e2e 钉死（ui.spec/ag71 的「两次 ↓ = 重新开始」、tower.spec 的
// 「一次 ↓ = 塔楼地图」），两项都排在前四项之后：设置 index 4、本局统计
// index 5，互不动存量序号。
// AG-72: 「设置」挂在暂停菜单末位（返回标题之后）。音量/震屏/文本速度/语言
// 是 Steam 玩家的基本期待；放在末尾不动前四项既有的键盘/鼠标序号（存量
// e2e 按 继续/地图/重新开始/返回标题 导航，一个都不用改）。
// 「本局统计」固定在设置之后（index 5）：统计是只读面板，放最后不碍事。
const PAUSE_OPTIONS = ['继续游戏', '塔楼地图', '重新开始', '返回标题', '设置', '本局统计'];

// GOAL_LABELS 随目标行迁入 HudController（RC-03 拆分第 9 步）。

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
// AG-64：入夜二选一的两张选项卡（各有图标/标题/一句后果说明，选中高亮、
// Enter 确认）。图标走 itemIconKey：手电 = 推门走进夜色；医疗包 = 守夜睡觉回血。
const NIGHT_CHOICE_ROWS: Array<{ choice: NightChoice; label: string; consequence: string; iconKey: string }> = [
  { choice: 'scavenge', label: '出去找物资', consequence: '夜里搜刮各层 · 宿舍可能遭 NPC 光顾', iconKey: itemIconKey('flashlight') },
  { choice: 'watch', label: '在家守夜', consequence: '回宿舍睡觉回血 · 今夜没人偷得走你的东西', iconKey: itemIconKey('medkit') },
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

// ── AG-50：点击操控的平衡值 ────────────────────────────────────────────
// 双击判定窗/容差、跑速倍率、跑动画帧率倍率全部走 config/game-balance.json
// 的 movement 块。core/config.ts 的校验只查必填键，扩展块与 warmthSources
// 等同款按 Record 读；缺字段回退默认值，旧配置文件照样能跑。
interface MovementBalance {
  doubleClickWindowMs: number;
  doubleClickMaxDistancePx: number;
  runSpeedMultiplier: number;
  runAnimTimeScale: number;
}

const MOVEMENT_DEFAULTS: MovementBalance = {
  doubleClickWindowMs: 300,
  doubleClickMaxDistancePx: 40,
  runSpeedMultiplier: 2,
  runAnimTimeScale: 1.6,
};

function readMovementBalance(): MovementBalance {
  const raw = (GAME_CONFIG as unknown as { movement?: Partial<MovementBalance> }).movement ?? {};
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return {
    doubleClickWindowMs: num(raw.doubleClickWindowMs, MOVEMENT_DEFAULTS.doubleClickWindowMs),
    doubleClickMaxDistancePx: num(raw.doubleClickMaxDistancePx, MOVEMENT_DEFAULTS.doubleClickMaxDistancePx),
    runSpeedMultiplier: num(raw.runSpeedMultiplier, MOVEMENT_DEFAULTS.runSpeedMultiplier),
    runAnimTimeScale: num(raw.runAnimTimeScale, MOVEMENT_DEFAULTS.runAnimTimeScale),
  };
}

/** 点击操控线的数值入口（AG-50）：GameScene 内不硬编码任何跑动参数。 */
const MOVEMENT_BALANCE: MovementBalance = readMovementBalance();

/** 点击落点标记的深度：在地面物件（≤26）之上、HUD（100+）之下。 */
const CLICK_MARKER_DEPTH = 40;

// AG-60 背包面板平衡值（BagBalance/readBagBalance/BAG_BALANCE）与 AG-66
// 铲子图标 key 随背包 UI 迁入 HudController（RC-03 拆分第 9 步）——
// BAG_BALANCE 经上方 re-export 保留外部 import 路径。
// ── AG-65：NPC 实时散步（用户原话「那些 npc 应该都是可以动的」）────────────
// 日程（ai/npcSchedule 的 npcAutonomyFor）按游戏时间赶路，玩家站着不动时整层
// 人是僵的。这里叠一层实时散步：到达日程锚点后在 ±band 内走-停-走，waypoint
// 时间线由 (floor, npcId) seeded 派生（core/rng.ts，不用任何全局随机源），对
// 真实经过的秒数求值——纯函数，场景只喂时间、不持有坐标，刷新/重进楼层相位从
// 落层那刻起算（GameScene.npcStrollState 记 parkedSince）。
//
// 单格日程的站桩 NPC（核心终端）band 为 0：不走，只按 turnPeriod 偶尔转身。
interface StrollLeg {
  walk: boolean;
  dur: number;
  from: number;
  to: number;
}
interface StrollPlan {
  legs: StrollLeg[];
  total: number;
  stationary: boolean;
  turnPeriod: number;
}
const strollPlans = new Map<string, StrollPlan>();

function npcStrollPlan(npcId: string, floor: number, stationary: boolean, band: number): StrollPlan {
  const key = `${floor}:${npcId}`;
  const cached = strollPlans.get(key);
  if (cached) return cached;
  const rng = makeRng(deriveSeed(FLOOR_GEO_SEED_TAG, 'npcStroll', floor, npcId));
  const legs: StrollLeg[] = [];
  let prev = 0;
  let total = 0;
  for (let i = 0; i < 4; i++) {
    const to = stationary ? 0 : rng.nextFloat() * 2 * band - band;
    const walkDur = stationary ? 0 : Math.max(0.5, Math.min(3, Math.abs(to - prev) / FLOOR_GEOMETRY_BALANCE.npcStrollSpeedPxPerSec));
    const pauseDur = 1 + rng.nextFloat() * 1.6;
    legs.push({ walk: true, dur: walkDur, from: prev, to });
    legs.push({ walk: false, dur: pauseDur, from: to, to });
    total += walkDur + pauseDur;
    prev = to;
  }
  const plan: StrollPlan = { legs, total, stationary, turnPeriod: 5 + rng.nextFloat() * 5 };
  strollPlans.set(key, plan);
  return plan;
}

/** 散步时间线在 elapsed 秒处的读数：偏移量、是否在走、面朝（0 = 保持）。 */
function npcStrollPose(npcId: string, floor: number, stationary: boolean, elapsed: number, band: number): { x: number; walking: boolean; face: 1 | -1 | 0 } {
  const plan = npcStrollPlan(npcId, floor, stationary, band);
  if (plan.stationary) {
    const cycle = Math.floor(elapsed / plan.turnPeriod);
    return { x: 0, walking: false, face: cycle % 2 === 0 ? 1 : -1 };
  }
  let t = elapsed % plan.total;
  for (let i = 0; i < plan.legs.length; i++) {
    const leg = plan.legs[i];
    const last = i === plan.legs.length - 1;
    if (last || t < leg.dur) {
      const p = leg.dur <= 0 ? 1 : Math.min(1, t / leg.dur);
      return {
        x: leg.from + (leg.to - leg.from) * p,
        walking: leg.walk && p > 0.02 && p < 0.98,
        face: leg.walk && leg.to !== leg.from ? (leg.to > leg.from ? 1 : -1) : 0,
      };
    }
    t -= leg.dur;
  }
  return { x: 0, walking: false, face: 0 };
}

/**
 * AG-73 教程收尾 flash 的入夜推迟量随教程段迁入 controllers/
 * TutorialController（RC-03 拆分第 3 步，TUTORIAL_DONE_FLASH_DELAY_MS）。
 */

export class GameScene extends Phaser.Scene implements StatsPanelHost, MonologueHost, TutorialHost, PerfHost, AchievementHost, NavBarHost, DialogueHost {
  private player!: Phaser.GameObjects.Sprite;
  /** The crowbar in the survivor's hand. Follows the attack pose's fist. */
  private weapon?: Phaser.GameObjects.Image;
  private cursors!: DirKeys;
  private wasd!: { left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key };
  /** AG-50：Shift = 跑（与鼠标双击跑同一倍率）。轮询 isDown，无 keydown 回调。 */
  private keyShift?: Phaser.Input.Keyboard.Key;
  private keyE!: Phaser.Input.Keyboard.Key;
  private keyEsc!: Phaser.Input.Keyboard.Key;
  private keyI!: Phaser.Input.Keyboard.Key;
  private keyEnter!: Phaser.Input.Keyboard.Key;

  private floorView!: GeneratedFloor;
  private containerObjs = new Map<string, { box: Phaser.GameObjects.Graphics | Phaser.GameObjects.Image; label: Phaser.GameObjects.Text; plate: Phaser.GameObjects.Rectangle }>();
  // AG-51：可交互床铺（1 层宿舍：自己的床 + 两排室友床）。drawBed/drawDormBeds
  // 注册、interactWithBunk 消费、clearFloor 清空。id 是位置派生的稳定串
  // （dorm_bed_<x> / own_bed），与 visitedFloors 的 bunksearch:/bunkgone: 键
  // 一一对应——存档里记住的「翻过/拆过」重进楼层照得上。
  private bunkObjs = new Map<string, { x: number; own: boolean; objects: Phaser.GameObjects.GameObject[] }>();
  // AG-51：家具名签（1 层工作台「工作台」+ 自己的床「床（睡觉）」）——AG-52
  // 隐形化契约的同一条延申：与容器名签共用 containerLabelFor 的三段式（远看
  // 不见/贴近 0.35 隐形字/选中全牌），由 buildContainers 的同一个逐帧 fader
  // 驱动（见 fadeLabels 里的家具段），不另挂监听、不新增 WeakMap。
  private furnitureLabels: Array<{ x: number; label: Phaser.GameObjects.Text }> = [];
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
  /**
   * AG-63: 绿光的进/出边沿。debuff fx 出现的那一帧 flash 一条消息、消失的
   * 那一帧再 flash 一条——边沿记在这里而不是 fx 的存在性上：startFxLoop
   * 拿不到动画时返回 null，那时没有光也得有话；场景重启后 Phaser 已销毁旧
   * sprite，字段还指着它，更新段会把它当不存在并给这条边沿重新上膛。
   */
  private debuffAnnounced = false;
  /** every flame on this floor, so a blackout can put them out */
  private lightFixtures: Phaser.GameObjects.Sprite[] = [];

  // Length of the floor currently drawn. Tiers have different lengths (see
  // floorWidthFor), so nothing may assume FLOOR_WIDTH: the camera bounds, the
  // wall tiling, the room loop and the stair mouths all read these two.
  private floorW = FLOOR_WIDTH;
  private downExit = DOWN_EXIT_X;
  // AG-65：本层的全部几何（层宽/房间数/上下梯口/洞/中梯）。worldgen 的纯函数
  // 按楼层号 seeded 派生，同层每次进同一个答案——drawFloor 每帧重设，e2e 直接
  // 读这个字段核对「梯子还在原地」。
  private floorGeo?: FloorGeometry;
  // AG-65：爬梯态天花板洞口透出的目标层地板（与目标层同生共死：成功落地由
  // clearFloor 收，拒绝落地由 destroyClimbTargetLayer 收）。
  private climbHoleReveal: Phaser.GameObjects.GameObject[] = [];
  // AG-65：洞与中梯的实际绘制矩形（e2e 像素取证用——画在哪由 seeded 位置定，
  // 这里把画出来的矩形交出来，实测才能核对「画的位置 = floorGeometryFor 的位置」）。
  private floorFeatureRects: { hole: [number, number, number, number] | null; ladder: [number, number, number, number] | null } = { hole: null, ladder: null };
  // AG-65：NPC 实时散步状态（seeded waypoint 时间线的相位，见 syncNpcs）。
  private npcStrollState = new Map<string, { parkedSince: number; lastX: number; face: 1 | -1 }>();
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
  // AG-52: the climb's target floor, drawn beside the live one while the player
  // is on the stairs (see syncClimbTargetFloor). The layer reference is only
  // needed to take it down on a REFUSED landing — a successful landing's
  // clearFloor() destroys it with the rest of the old floor, and the includes()
  // guard below keeps that from becoming a double destroy.
  private climbTargetLayer?: Phaser.GameObjects.GameObject;
  private climbTargetFloor?: number;
  /**
   * AG-52: the direction of the most recent climb. drawFloor's landing ease
   * reads it to put the camera back in the pre-swap frame, so the arriving
   * floor does not teleport a full FLOOR_HEIGHT in one frame. Recorded by the
   * climb-target syncer while stairClimb is live; stale values are harmless
   * because only the landingEase path reads it.
   */
  private lastClimbDirection?: 1 | -1;
  // OVERHAUL: a one-shot action clip (search / attack / hurt) and the time it
  // holds the sprite. Without the hold, the walk/idle selection below would
  // switch back on the very next frame and the clip would never be seen.
  private actionAnimKey = '';
  private actionAnimUntil = 0;
  // AG-66：过道阻碍物。floorObstacles 是本层全集（seeded，含挖过的残骸），
  // obstacleObjs 按 x 存场景图形，activeObstacleList 是还没挖的那些——每帧
  // 钳位与 E 交互读它，挖掉一个就地重算（drawFloor/清障时刷新）。
  private floorObstacles: FloorObstacle[] = [];
  private activeObstacleList: FloorObstacle[] = [];
  private obstacleObjs = new Map<string, Phaser.GameObjects.Graphics>();
  // AG-66：进行中的搜刮/挖掘动作（2s）。点容器/床铺/阻碍物后先播 search 动画，
  // 到点才出货/清障；这期间任何移动输入都会取消它——不出货、不扣时间、不标记
  // 已搜/已挖（防站着刷，见 update 的 pendingAction 段与 cancelPendingAction）。
  private pendingAction?: {
    kind: 'container' | 'bunk' | 'dig';
    floor: number;
    containerId?: string;
    bunkId?: string;
    obstacleX?: number;
    /** 特效落点（床铺/阻碍物的世界 x）。 */
    atX: number;
    /** 动作期间底栏显示的话。 */
    busyHint: string;
    /** 取消时的话。 */
    cancelHint: string;
    until: number;
    timer: Phaser.Time.TimerEvent;
  };
  // AG-66 铲子图标就绪标记随背包格迁入 HudController（RC-03 拆分第 9 步）。

  // AG-77 成就字段组（achievementSave/achievementQueue/activeToasts/
  // nextToastAt/thirstHitZero/lastAchievementDay/combatDamageTaken）随
  // controllers/AchievementController 迁出（RC-03 拆分第 5 步，见上方
  // achievements 字段处的接线说明）。

  // ── AG-54/AG-60/AG-67：HUD 顶带 + 背包面板（RC-03 拆分第 9 步） ─────────
  // 四联圆环 RT/数值文本/环境 chips/目标行/预警行/暗角/debuff 标记与背包
  // 全部件（格/图标/徽章/边框/详情/count/光标/面板态）全在 controllers/
  // HudController.ts，场景只持控制器本体：buildHud 里 reset() 先毁后建 +
  // build() 一次装配；公开委托面（refreshStats/refreshClock/refresh-
  // Inventory/toggle/moveSelection/isOpen/selectedIndex）见下方各方法处。
  // 留场景的只有两件：feedbackText（flash 的同一出口，第 3 步契约「控制器
  // 不碰 feedbackText 本体」）与 hintText（导航条 contextual 数据源，世界
  // 链逐帧写、NavBarController 经 worldHintText 读）。
  private readonly hud = new HudController(this);

  private hintText!: Phaser.GameObjects.Text;
  // ── AG-73: 新手教程（RC-03 拆分第 3 步） ─────────────────────────────────
  // 进度状态/世界坐标呼吸框/HUD 圆环高亮框/右上角跳过按钮四样全在
  // TutorialController，场景只持控制器本体：init() 先毁再建（场景重启不清
  // 显示列表，Phaser 4 shutdown 只空纹理——字段初始化器不重跑，旧的
  // 呼吸框/按钮不清会双份挂在坏纹理上），tick/navHint/skip/isActive 是
  // update、导航条 contextual 分支、Esc 早退与开局 flash 的接线。
  private readonly tutorial = new TutorialController(this, localStorage);
  /**
   * AG-63: 饥饿/干渴 debuff 的常驻小标记（「状态：饥饿」）随 HUD 带迁入
   * HudController（RC-03 拆分第 9 步）——世界链判饿渴、控制器只画
   * （hud.setDebuffMark）。绿光在身上跑的时候，脚注条上方始终有一行字说
   * 它是什么——用户把这片光报成 bug，缺的就是这个名字。平时不可见；坐标
   * 在 hudLayout 的 debuffMark 键。
   */
  private feedbackText!: Phaser.GameObjects.Text;
  // OVERHAUL: the day's objective and the run's score, top-right; the low-HP
  // vignette; the environment row's four chips; the standing bag-full warning
  // —— 全部随 HUD 带迁入 HudController（RC-03 拆分第 9 步）。
  // ── AG-67: the bottom-right character card + the monologue ticker ──────
  // RC-03 拆分第 2 步：卡片件/气泡/ticker 状态全在 controllers/Monologue-
  // Controller.ts（plain TS 类，Node 可单测）。字段初始化器不随场景重启重跑
  // ——buildHud 里 monologue.reset() 先毁后建（旧代码 statusCard*/monologue*
  // 字段组的重置惯例）。STAT_BARS 注入：行规格与 HUD 圆环同源，第 9 步起
  // 定义住在 HudController（圆环的本家），这里 import 同一份数组注入，
  // 不复制数据。
  private readonly monologue = new MonologueController(this, STAT_BARS);
  // ── AG-80: 性能层（RC-03 拆分第 4 步） ───────────────────────────────────
  // 飘字池/帧预算守卫/FPS 计数器/降级边沿四样全在 PerfController（plain TS
  // 类，Node 可单测），场景只持控制器本体：init() 先毁再建（场景重启不清
  // 显示列表，旧池的 Text 不拆会留幽灵字）、tick(delta) 是 update 里所有
  // 早退分支之前的那一行（爬梯/面板/战斗全程被守卫覆盖）、spawnFloatText
  // 是战斗飘字的下游。PerfHost 的三个场景查询面（createFloatTextPool/
  // setFxDegraded/setMonsterBreathing）落在原性能层段的位置。
  private readonly perf = new PerfController(this);
  // ── AG-77: 成就系统（RC-03 拆分第 5 步） ──────────────────────────────────
  // 奖杯柜/toast 队列/跨天记账/本场受伤计数全在 AchievementController
  // （plain TS 类，Node 可单测），场景只持控制器本体：init(day) 是 create
  // 的读档+清场、emit 是十处事发钩子、update 是帧循环第一段（面板早退之前
  // ——解锁可能发生在任何面板里）、clear 是重启/SHUTDOWN 清场。存储键独立
  // （floor100000.achievements.v1，重置游戏不清空——控制器持 localStorage）。
  private readonly achievements = new AchievementController(this, localStorage);
  // OVERHAUL: the floor's "?" spots and the encounter panel they open.
  private spotMarkers = new Map<string, { x: number; isBoss: boolean; dot: Phaser.GameObjects.Arc; label: Phaser.GameObjects.Text }>();
  private encounterOpen = false;
  private encounter?: { spotId: string; encounter: Encounter; choices: EncounterChoice[]; selected: number; resolved: boolean };
  private encounterObjects: Phaser.GameObjects.GameObject[] = [];
  // ── RC-03 拆分第 7 步：回合制战斗（CombatController） ────────────────────
  // 战斗状态机 + AG-70 舞台 + 回合编排 + juice 层 + 战斗 UI 五件全在
  // controllers/CombatController.ts（plain TS 类，Node 可单测），场景只留：
  //   * openEncounter 的开战入口（detect 到 combat kind → combat.start）；
  //   * onUse/onNavUp/onNavDown/onEsc 的战斗分支委托（enter/move/close/flee
  //     四入口 + isDone 读数）；
  //   * update 的两行（combat.tick 顿帧闸门 + combat.syncStage 名签钉点）；
  //   * create 的一行（combat.initJuice）；
  //   * AG-63 脚注纯函数（combatFootHint 留本文件；combatWeaponLabel/
  //     combatBehaviorLabel 随拆分迁 systems/combat.ts，下面 re-export——
  //     combatHud.test.ts 的 import 路径不变）；
  //   * CombatHost 查询面/动作面（playActionAnim/playSwingFx/spawnFloatText/
  //     playerSprite/floorWidth/syncPlayerWorldObjects/shopSpotX/
  //     setEncounterOpen/setPanelBox/rebuildEncounterSpots/refreshStats/
  //     startEndScene/成就三件/addLootThisTrip/combatPanelObjects/场景事件
  //     三订阅/共享件四薄封装——见下方「CombatHost 面」段）。
  private readonly combat = new CombatController(this);
  // ── RC-03 拆分第 8 步：NPC 对话 + 行商交易 + 产业投资 + AI NPC ────────────
  // 对话树/交易层/赠礼层、行商双货架面板（shop rows + CENTUM 跳层 UI 的
  // 「Enter 买入」面）、产业投资面板、AI 开场白编排（降级选项树）全在
  // controllers/DialogueController.ts（plain TS 类，Node 可单测），场景只留：
  //   * onInteract 的入口检查链（shop spot → dialogue.openShop()；nearestNpc
  //     → dialogue.open(npc)）与 NPC 世界摆位（drawNpcs/npcView/syncNpcs/
  //     nearestNpc 留本段）；
  //   * onEsc/onNavUp/onNavDown/onUse/keyS/keyG 的对话域路由委托；
  //   * 产业账本观察三点（chargeTime / 帧循环 advanceTime / 睡觉 finishNight
  //     前后的 ventureLedgerSnapshot+diffVentureLedger）；
  //   * create 的 build 一行 + 重启的 reset 委托；
  //   * anyPanelOpen/openPanelHint/各 guard 的 isOpen/ventureIsOpen 读面；
  //   * e2e 契约 getter（spark.spec.ts 直读的 scene.dialogue → 文件末）；
  //   * clearStrayPanels 的 dialogue.panelObjectsForRecovery()；
  //   * DialogueHost 面（panelHit/playFx/createMarker/viewSize/setPanelBox/
  //     setEncounterOpen/rebuildEncounterSpots/refreshStats/refreshInventory/
  //     flash/chargeTime/emitNpcTalked/onUse/assertPanelContent——见下方
  //     「DialogueHost 面」段）。
  private readonly dialogueCtl = new DialogueController(this);
  // First-floor shelter decision panel: the cursor is visual state, while the
  // selected action itself is committed through ShelterSystem.
  private shelterOpen = false;
  private shelterSelected = 0;
  private shelterObjects: PanelObject[] = [];
  private shelterMarker!: Phaser.GameObjects.Image;
  // AG-64：入夜二选一面板（出去找物资 / 在家守夜）。
  private nightChoiceOpen = false;
  private nightChoiceSelected = 0;
  private nightChoiceObjects: PanelObject[] = [];
  private nightChoiceMarker!: Phaser.GameObjects.Image;
  /** 上一帧的 gameMinuteOfDay：只有帧循环把时钟推过 18:00 的那一帧算「入夜」 */
  private prevMinuteOfDay: number | null = null;
  private feedbackTimer?: Phaser.Time.TimerEvent;
  // lastClock/lastStats（HUD 按值缓存键）与 invObjects/invSlotTexts/
  // invSlotIcons/invMarker/invSelected/inventoryOpen（背包面板件与面板态）
  // 随 HudController 迁出（RC-03 拆分第 9 步）。

  private craftingOpen = false;
  private craftObjects: PanelObject[] = [];
  private craftMarker!: Phaser.GameObjects.Image;
  /**
   * AG-61：树形面板的节点视图。每个节点四件套：底板（状态色 + 描边）、
   * 图标或菱形纹章（设施/凭证没有物品图标）、名称、命中区。平移/缩放时
   * 由 layoutCraftTree 统一改位置与缩放（screen = base * z + pan）。
   */
  private craftTreeNodes: Array<{
    node: CraftTreeNode;
    band: Phaser.GameObjects.Rectangle;
    icon: Phaser.GameObjects.Image | null;
    sigil: Phaser.GameObjects.Rectangle | null;
    label: Phaser.GameObjects.Text;
    hit: Phaser.GameObjects.Rectangle;
  }> = [];
  /** 合成路径边（一张 Graphics，layoutCraftTree 每次变换重画）。 */
  private craftTreeEdges!: Phaser.GameObjects.Graphics;
  /**
   * AG-61：详情块四行。effect 是「做出来会怎样」（recipePreview.effect），
   * status 是状态词 + 档位/前置读数（craftNodeStatus + tierNote + requires），
   * materials 是逐项 持有/需求（旧列表只显示需求，树形态补上库存高亮），
   * hints 是缺料时的「去哪拿」（canCraft().hints）。数据全部来自 AG-42 的
   * CraftingSystem，场景只排版。
   */
  private craftDetailTexts!: {
    effect: Phaser.GameObjects.Text;
    status: Phaser.GameObjects.Text;
    materials: Phaser.GameObjects.Text;
    hints: Phaser.GameObjects.Text;
  };
  /** 制作按钮四件套（framedButton 的返回），材料节点时隐藏。 */
  private craftButton: PanelObject[] = [];
  /**
   * 树面板矩形。panelBox 是「鼠标 ESC：面板外点击关闭」的判据，而 create()
   * 里 inventory→craft→dialogue→pause 依次 build，最后一次 build 会把
   * panelBox 覆写成暂停菜单的小盒子——树面板比那个盒子大得多，照旧判据
   * 点面板内空白处都会当成面板外而关面板。所以打开时用它重置 panelBox。
   */
  private craftPanelBox: { x: number; y: number; w: number; h: number } | null = null;
  private craftSelected = 0;
  /** 视图变换：缩放与平移。基准坐标 → 屏幕 = base * zoom + pan。 */
  private craftZoom = 1;
  private craftPanX = 0;
  private craftPanY = 0;
  /**
   * 拖拽状态：pointerdown 时记起点与当时 pan，pointermove 累积出平移量。
   * 点击不在这里执行——拖拽超过阈值的按下不算点击，真正的动作延迟到
   * pointerup 裁决（craftPointerUpHandler），否则「节点上起手拖动」会
   * 既平移又误触制作。
   */
  private craftDragStart: { x: number; y: number; panX: number; panY: number } | null = null;
  private craftDragMoved = false;
  private craftPending: { kind: 'node'; id: string } | { kind: 'activate' } | null = null;
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

  /** the wall-fixture close-up (key L): built per open, like the shelter panel */
  private decoOpen = false;
  private decoIndex = 0;
  private decoObjects: PanelObject[] = [];
  private pauseOpen = false;
  // Mouse state. `walkTarget` is the click-to-walk order the update loop steps
  // toward; `panelBox` is the rectangle of the most recently built panel, so a
  // click outside it can close the panel the way ESC does.
  private walkTarget: { x: number; interact: boolean; run: boolean } | null = null;
  // AG-50：上一次点击的世界 x 与场景时间，双击跑判定用。create() 里重置——
  // 重新开始走的是 scene.start('MetaSelect')（停场景而非重建实例），字段
  // 初始化器不会重跑，旧判定状态会漏进新跑局。
  private lastClick?: { x: number; at: number };
  // The dorm's sleeping roommates: the floating Z is animated from update(), so it
  // lives here rather than in a tween that would outlive the floor it belongs to.
  private dormSleepers: Array<{ z: Phaser.GameObjects.Text; baseY: number; phase: number }> = [];
  private panelBox: PanelBox | null = null;
  // ── AG-71: 底部导航条（RC-03 拆分第 6 步） ──────────────────────────────
  // 六个槽的常驻栏（见 render/hudLayout.ts 的 NAV_BAR）。它接替了旧的
  // hudButtons 按钮行：五个固定槽各带一个 hitRect（同一套 stairClimb /
  // anyPanelOpen 守卫），contextual 槽是提示不是控件。静态板/状态层/六文本/
  // 五张 hitRect 与 contextual 优先级链全在 NavBarController（plain TS 类，
  // Node 可单测），场景只持控制器本体：buildHud 顶部 navBar.reset() 先毁再建
  // （场景重启不清显示列表，Phaser 4 shutdown 只空纹理——字段初始化器不重跑，
  // 旧导航件不清会双份挂在坏纹理上），build 是 buildHud 尾部一次构建，
  // refresh 是 update 第一行（面板布尔帧间改写 + 世界模拟段面板早退，只有这
  // 里保证开着面板时高亮与 contextual 照更）。contextual 的三链数据源
  // （openPanelHint / tutorial.navHint / hud-hint）留在场景侧——世界链 hint
  // 段是 update 世界模拟段的一部分（R6-2 行商文案在那里生产），控制器经
  // NavBarHost 读数面消费，数据生产留场景、显示层迁控制器。
  private readonly navBar = new NavBarController(this);
  private readonly pointerHandler = (pointer: Phaser.Input.Pointer, currentlyOver?: unknown[]): void =>
    this.onPointerDown(pointer, currentlyOver ?? []);
  private pauseObjects: PanelObject[] = [];
  private pauseOptionTexts: Phaser.GameObjects.Text[] = [];
  private pauseMarker!: Phaser.GameObjects.Image;
  private pauseSelected = 0;
  // AG-81：本局统计面板——暂停菜单的「本局统计」项打开的只读子面板
  // （RC-03 拆分第 1 步：面板件/表格行池/开关标志全在 StatsPanelController，
  // 这里只留实例；isOpen 期间 pauseOpen 保持 true，ESC 先回暂停菜单）。
  // 字段初始化器在场景重启时不重跑——create() 里 statsPanel.reset() 清池，
  // 与旧代码 statsObjects/statsTableObjects = [] 同惯例。构造只存 host 引用
  // 与共享表构建件，不碰任何 Phaser API，字段初始化期调用安全。
  private readonly statsPanel = new StatsPanelController(this, buildStatsTable);
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
    // Field initialisers do not re-run, so the HUD's cached bag-full visibility
    // has to be re-derived against the fresh bag of a restarted run — the flag
    // itself lives in HudController (RC-03 拆分第 9 步，hud.reset() 清零）。

    // Every builder below only pushes into these, and field initialisers do not
    // re-run on scene restart. Without the reset, 重新开始 left them holding the
    // previous run's destroyed objects, so refreshInventory() / togglePause()
    // wrote to dead objects and both panels came up empty.
    this.floorObjects = [];
    this.containerObjs.clear();
    this.npcObjs.clear();
    this.groundObjs.clear();
    // RC-03 拆分第 9 步：背包面板件/光标/面板态与 bagFullShown 的重置本体在
    // HudController.reset（buildHud 顶部先毁后建——比这里的数组清零更狠：
    // 旧件直接 destroy，不再留不可见的幽灵件占显示列表）。
    this.craftObjects = [];
    this.craftMarker = createMarker(this);
    this.pauseObjects = [];
    this.pauseOptionTexts = [];
    this.pauseMarker = createMarker(this);
    this.statsPanel.reset();
    // RC-03 拆分第 8 步：对话面板件/标记 + 产业面板件/标记 + 对话开关与进行中
    // 对话的重置本体在 DialogueController.reset（原逐字段清单见那边注释）。
    this.dialogueCtl.reset();
    this.shelterObjects = [];
    this.shelterMarker = createMarker(this);
    this.nightChoiceObjects = [];
    this.nightChoiceMarker = createMarker(this);
    this.nightChoiceOpen = false;
    this.nightChoiceSelected = 0;
    // 入夜提示是「时钟跨过 18:00」的边沿触发：续档/重开从当前时刻起算，
    // 不补弹今夜之前错过的提示。
    this.prevMinuteOfDay = getGame().gameMinuteOfDay;
    // 重新开始 runs while the pause menu is still open, and these flags survive a
    // restart. Left set, update() early-returns forever and every panel handler
    // refuses to run, so the restarted game looks frozen.（背包的 inventory-
    // Open/invSelected 同理——本体在 HudController.reset。）
    this.craftingOpen = false;
    this.craftSelected = 0;
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
    // AG-50：点击操控的订单与双击判定状态随新跑局清空。重新开始是
    // scene.start('MetaSelect')——同一个 GameScene 实例被停掉再回来，
    // 字段初始化器不重跑，旧 walkTarget 会让新角色自己先走两步。
    this.walkTarget = null;
    this.lastClick = undefined;
    // lastClock/lastStats 的清零随 HUD 按值缓存键迁入 HudController.reset
    // （RC-03 拆分第 9 步）。
    // AG-66：阻碍物名册与进行中动作不随字段初始化器重生（场景重启复用实例），
    // 在这里显式清空——否则上一局的 timer 会在新局到点出货。
    this.floorObstacles = [];
    this.activeObstacleList = [];
    this.obstacleObjs.clear();
    this.pendingAction = undefined;
    // AG-77：成就档从独立键读入（重置游戏不清空），toast 队列与跨天记账随
    // 新跑局清空——字段初始化器不重跑，上一局的排队 toast 会插进新局。
    this.achievements.init(getGame().day);

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
    // AG-66：背包里会出现铲子（craft_shovel），artpack 没有它的贴图，程序化
    // 画一把 16×16 顶着。本体随背包格迁入 HudController（RC-03 拆分第 9
    // 步：hud.build() 开头调 ensureShovelIcon——贴图只被背包格消费，在面板
    // 首次刷新之前就位，与原创建期时序等价）。

    // AG-74：楼层 BGM。按当前上下文起（入夜/带电台都由 resolveTrackId 决定），
    // AudioContext 未获手势前只记待播、不发声（自动播放策略）。
    startFloorMusic(getGame());

    // AG-80：性能层（飘字池/帧预算守卫/FPS 计数器）建在 drawFloor 之前——
    // 楼层过程与之后的搜刮、战斗飘字全都走池。控制器本体（RC-03 第 4 步）。
    this.perf.init();

    // AG-91：juice 层（震屏/顿帧/闪白/缩放的状态机）同样建在 drawFloor 之前——
    // 伏击开场偷袭（playAmbusherStrike）在战斗第一帧就可能打人。
    // RC-03 拆分第 7 步：initJuice 本体在 CombatController。
    this.combat.initJuice();

    this.drawFloor();

    // RC-03 拆分第 9 步：HUD 顶带 + 背包面板的一次性装配都在 HudController
    // .build()（buildHud 编排内）——原 create 的 buildHud()+buildInventory-
    // Panel() 两行并成 buildHud() 一行，面板相对次序不变（先 HUD 带后背包）。
    this.buildHud();
    this.buildCraftPanel();
    // RC-03 拆分第 8 步：对话面板的一次性装配本体在 DialogueController.build
    // （与背包/制作/暂停同一批 create 期 build，重启由 reset+build 重建）。
    this.dialogueCtl.build();
    this.buildPausePanel();
    this.statsPanel.build();
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

    // AG-73：新手教程初始化（读 localStorage 进度、建呼吸框/高亮框/跳过按钮）。
    // 必须在下面那段开局 flash 之前——flash 要读教程是否激活来决定放哪句话。
    this.tutorial.init();

    if (getGame().day === 1) {
      this.flash(this.tutorial.isActive ? TUTORIAL_OPENING_LINE : '目标：从第 1 层一路爬到第 100000 层。A/D 移动 · E 交互 · I 背包 · C 制作 · M 地图');
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // cameras.main can be null during teardown (Phaser 4 shutdown gotcha).
      this.cameras.main?.stopFollow();
      this.feedbackTimer?.remove(false);
      // AG-77：退场动画里的 toast tween 会在场景销毁后打已死对象。
      this.achievements.clear();
      this.unbindInput();
      stopBgm(); // AG-74：离开楼层就静默（收音机的截止时间保留，回来按上下文重解）
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
   *
   * public：同时是 StatsPanelHost 的视口面——统计面板控制器（StatsPanel-
   * Controller）构造注入后按打开时刻的画布定位，与场景各面板同一口径。
   */
  viewSize(): { width: number; height: number } {
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
    // AG-65/AG-103：夜色是楼层几何——nightOverlay 是场景级单例，create() 里
    // 按 FLOOR_WIDTH 建（与相机初始 bounds 同口径，合法），进层后必须铺满本层
    // 实际宽度：写死 1280 时宽楼相机右移后 x>1280 的右半楼不被夜色压暗，
    // 昼夜观感在楼宽中段断裂。drawFloor 是所有进入路径（新档/继续/dev 入口/
    // 每次爬梯落地）的唯一汇合点，在这里按 this.floorW 重建尺寸——setSize/
    // setPosition 复用同一对象，不重建、不泄漏、不重复挂载；窄楼（tier1 恒
    // 1280）数值不变。相机 bounds 的 this.floorW 覆盖见下文同一口径。
    this.nightOverlay.setPosition(this.floorW / 2, FLOOR_HEIGHT / 2).setSize(this.floorW, FLOOR_HEIGHT);
    // AG-65：楼层几何（层宽/梯口/洞/中梯）随层派生。downExit 与 floorGeo.downX
    // 同源（都是 downExitXFor），这里分别喂给「按 E 判定/hasInteractableNear」
    // 与「洞/中梯绘制 + e2e 实测」两条既有消费者。
    this.floorGeo = floorGeometryFor(floor);
    this.floorView = getFloorView(state, floor);
    // AG-64：回宿舍时的小偷证据。放在方法前部——落地路径会走 landingEase 分支
    // 并提前 return，钩子挂在尾部就永远等不到爬梯落地那一帧。delayedCall(0)：
    // create() 里第一次 drawFloor 时 feedbackText 还没建（HUD 在后头），直接
    // flash 会炸；scene 已被换掉则跳过。
    if (floor === STARTING_FLOOR) {
      this.time.delayedCall(0, () => {
        if (!this.scene.isActive()) return;
        this.reportNightWatchEvidence();
      });
    }

    if (floor === STARTING_FLOOR) {
      this.drawDormRoom();
    } else {
      this.drawCorridor(floor);
    }
    // AG-52: 只画本层。用户原话：「我在最下面只能看到一层……你只能看到你自己
    // 这一层，因为角色他只能看到这一层，所以我在想要不要就是说做只看见一层，
    // 根据角色的这个视角来决定能看见的范围」——剖面图的上下邻居层全部撤掉，
    // 站立态场景里只有当前层，相机 bounds 也收到本层（下文）。省掉的邻居层
    // 重放是纯赚：1F 实测显示对象 711 → 494（-217，-30.5%，RENDER.md §1 的
    // 递归计数口径）；3/5 层上下各两个邻居都在，省得更多（约四成）。
    //
    // 唯一例外是爬梯：角色夹在两段楼层之间时必须看见目标层，否则是往虚空里
    // 走。那层由 syncClimbTargetFloor（下面的 UPDATE 监听）在爬梯态补画、
    // 落地或拒绝落地时撤走——楼梯 therefore shows where it goes exactly
    // while you are on it, and the rest of the time the tower is one floor.
    const syncClimbTarget = (): void => this.syncClimbTargetFloor();
    const previousSyncer = CLIMB_TARGET_SYNCERS.get(this);
    if (previousSyncer) this.events.off(Phaser.Scenes.Events.UPDATE, previousSyncer);
    CLIMB_TARGET_SYNCERS.set(this, syncClimbTarget);
    this.events.on(Phaser.Scenes.Events.UPDATE, syncClimbTarget);
    this.drawExits(floor);
    // After the exits: the door is drawn over the wall dressing, and it stands
    // beside the stairwell rather than in front of it.
    this.drawLift(floor);
    this.drawDormBunks(floor);
    this.buildContainers();
    this.buildGround();
    // AG-66：过道阻碍物（本层 seeded 全集 + 挖过的残骸）。
    this.buildObstacles();
    // R4 护栏（旧档兼容软锁，QA 第 2 轮 probeA-R3）：AG-96 起正常楼层按 roll
    // 率生成阻碍物，生成侧的防软锁保证的是「每个落点至少一个出口可达」——新
    // 档落点因此永远安全。但修复前创建的旧档重进这些层时，玩家位置是旧布局
    // 留下的，可能落在新布局的无口区间里（实测 seed 4 第 2 层 x=365 夹在
    // rubble@272 与 gate@458 之间，[298,432] 两个口全够不着，没铲子即软锁）。
    // drawFloor 是新档/继续/dev 入口/每次爬梯落地的同一条进入路径，在这里挂
    // 一次性迁移：只把玩家挪到最近的走得通的 x，不跨层、不动其它状态；位置
    // 本就安全时纯 no-op（新档零行为变化）。
    const rescuedX = rescueSealedPlayerX(
      this.activeObstacleList,
      state.player.x,
      floorExitXs(floor),
      homewardExitXs(floor),
    );
    if (rescuedX !== null) state.player.x = rescuedX;
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
        this.drawDormBeds(NPC_FLOOR, NEIGHBOUR_FRONT_BEDS, DORM_BACK_BEDS);
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
    cam.setZoom(FLOOR_VIEW_ZOOM);
    // AG-52: 只看见一层 —— 相机 bounds 收到本层。角色站在一层上 y 不动
    // （PLAYER_FEET_Y），follow 本来就把相机钉在角色身上；bounds 从「3.6 层
    // 高的剖面」收紧到「角色身边一层」之后，虚空永远滚不到——这是"根据角色
    // 的视角决定能看见的范围"在相机侧的落实。bounds 比视口矮时 Phaser 的
    // clampY 把 scrollY 钉在 bounds 顶（BaseCamera.clampY），所以站立位就是
    // 角色居中：scrollY = PLAYER_FEET_Y - 视口高/2。旧代码在塔底/塔沿还各有
    // 特判（-contextBottom / +FLOOR_BAND），现在一层之内没有邻居要避让，
    // 所有楼层同一个数。
    const viewH = this.viewSize().height;
    const standScrollY = PLAYER_FEET_Y - viewH / 2;
    const topBound = standScrollY;
    const bottomBound = topBound + FLOOR_HEIGHT;
    // 落地缓动要的「旧帧」必须在站立 bounds 落位之前抓：Phaser 的 setBounds
    // 会当场把 scrollY 钳进新 bounds（BaseCamera.setBounds 的 else 分支），
    // 一层高的站立 bounds 会把攀爬末帧的 scrollY 钳成 standScrollY——之后再算
    // fromY 旧帧就丢了，落地瞬间内容先跳近两百 px、再被 220ms 缓动晃回来
    // （实测 fromY=0：爬梯末帧 -381 被钳成 -200，+200 得 0）。AG-52 的注释
    // 说要「内容在落地瞬间原地不动」，差的正是这一抓。
    const climbEndScrollY = cam.scrollY;
    // The world width equals the design viewport width. Locking the horizontal
    // bounds to one floor keeps the full corridor visible when the player lands
    // at x=40 or x=1240; only the tower's vertical cross-section may scroll.
    cam.setBounds(0, topBound, this.floorW, bottomBound - topBound);
    this.standingCamBounds = { top: topBound, bottom: bottomBound };
    // AG-50 原本在这里补一个 centreY（落地静止位取玩家居中而不是楼层带中心，
    // 修「爬梯末尾先冲过去再荡回来」的那一下卡）。AG-52 的 standScrollY 重写
    // 已经把落地位定义成 PLAYER_FEET_Y - viewH/2——正是玩家居中的那一点，
    // 同一个修复由两路独立落地，centreY 因此是死代码，删。
    if (this.landingEase) {
      // 落地不跳帧。换层会把本层内容从「目标层的世界坐标」挪回「本层坐标」
      // ——整整一个 FLOOR_HEIGHT。相机若已经站在新层的站立位，内容和角色会
      // 一起瞬移 200px（旧代码靠 3.6 层高的大 bounds 让 setBounds 的钳制晚一
      // 步发生、再 220ms 滑回，意图相同；现在 bounds 收到一层之内，旧帧显式
      // 算）：按爬梯方向先把相机放回爬梯时的旧帧——内容在落地瞬间原地不动
      // ——再 220ms 滑到站立位。滑动期间 bounds 临时放宽到「旧帧→站立位」这
      // 两帧之间，回位后立刻收回一层之内（onComplete）。
      this.landingEase = false;
      const dir = this.lastClimbDirection ?? 1;
      const fromY = climbEndScrollY + FLOOR_HEIGHT * dir;
      console.log('[ag50-dbg] landing ease: cam.scrollY=', cam.scrollY, 'dir=', dir, 'fromY=', fromY, 'toY=', standScrollY);
      console.log('[ag50-dbg] landing ease: cam.scrollY=', cam.scrollY, 'dir=', dir, 'fromY=', fromY, 'toY=', standScrollY);
      const toY = standScrollY;
      cam.stopFollow();
      cam.setBounds(0, Math.min(fromY, toY), this.floorW, viewH + FLOOR_HEIGHT);
      cam.setScroll(cam.scrollX, fromY);
      this.tweens.add({
        targets: cam,
        scrollY: toY,
        duration: 220,
        ease: 'Sine.easeOut',
        onComplete: () => {
          // 收回一层：站立态虚空永远滚不到。
          cam.setBounds(0, standScrollY, this.floorW, FLOOR_HEIGHT);
          cam.startFollow(this.player, true, 0.15, 0.15);
        },
      });
      return;
    }
    cam.startFollow(this.player, true, 0.15, 0.15);
    // Centred on the player the moment the floor is drawn: a follow with
    // lerp 0.15 takes a third of a second to catch up, and during that time the
    // camera is still wherever the previous floor left it.
    cam.centerOn(state.player.x, PLAYER_FEET_Y);
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
    const climb = this.stairClimb;
    if (!standing || !climb) return;
    // 攀爬期间相机跟着攀爬者走。修前这里 stopFollow 把相机钉死在旧层的站立位：
    // 塔沿楼层的站立 bounds 比视口矮，Phaser 的 clampY 会把 scrollY 压在同
    // 一个点上（1→2 上行实测全程钉在 -102），角色头顶在落地前越过视口顶边
    // 34px——e2e stairNavigation「上行攀爬全程角色完整可见」基线即红。
    //
    // bounds 按 follow 的行程放宽：攀爬起止两点各自居中所对应的 scrollY 是
    // [lo, hi]，顶沿放到 lo（不低于站立顶沿）、底沿放到 hi + 视口高（站立
    // 底沿已经够高就不动）。follow 因此全程有路可走、攀爬者始终居中；反方向
    // 一格不收紧，塔沿之外的虚空在站立时仍然藏着。落地由 drawFloor 的
    // landingEase 接棒（单向缓动到站立位），拒绝落地由 resetCameraBounds 接棒。
    const camH = cam.height;
    const nearScroll = climb.startY - camH / 2;
    const farScroll = climb.endY - camH / 2;
    const lo = Math.min(nearScroll, farScroll);
    const hi = Math.max(nearScroll, farScroll);
    const top = Math.min(standing.top, lo);
    const bottom = Math.max(standing.bottom, hi + camH);
    cam.setBounds(0, top, this.floorW, bottom - top);
    cam.startFollow(this.player, true, 0.15, 0.15);
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

  // ── AG-52: the climb's target floor ───────────────────────────────────────
  // Standing on a floor draws ONLY that floor (user: 「你只能看到你自己这一层」),
  // but a climber is between two floors for a full second: without the floor
  // they are climbing TO on screen, they walk into the void. So the target is
  // drawn for the duration of the climb and taken down the moment it ends —
  // the cross-section survives exactly as long as the stairs are in use.
  //
  // Driven from the scene's UPDATE event rather than from changeFloor /
  // updateStairClimb: the stair section belongs to AG-50/AG-53, and one
  // listener that reads this.stairClimb every frame covers both ends of the
  // climb (start and finish) without touching it. On a successful landing
  // clearFloor() has already destroyed the layer with the old floor by the
  // time this runs, and the includes() guard turns that into a no-op.
  private syncClimbTargetFloor(): void {
    const climb = this.stairClimb;
    if (climb) {
      this.lastClimbDirection = climb.direction;
      if (this.climbTargetFloor === climb.to) return;
      this.destroyClimbTargetLayer();
      // Only authored floors get drawn as a target — the same rule the old
      // cross-section used, and stairNeighbour() already guarantees it.
      if (!hasFloorContent(climb.to)) return;
      const above = climb.direction === 1;
      // AG-65：把出发层梯口传给目标层绘制——梯口随机化后，落点不再是目标层
      // 自己的下行口，而是这趟梯子出发的那个 x（起止同 x 的竖井）。
      this.drawNeighbourFloor(climb.to, above ? -FLOOR_HEIGHT : FLOOR_HEIGHT, above, 1, climb.startX);
      // drawNeighbourFloor pushes the layer as the LAST element of
      // floorObjects; grab it there so a refused landing can take it down
      // alone. (Its lifetime is ours from here: on success clearFloor's batch
      // destroy reaches it through floorObjects as usual.)
      this.climbTargetLayer = this.floorObjects[this.floorObjects.length - 1];
      this.climbTargetFloor = climb.to;
      return;
    }
    this.destroyClimbTargetLayer();
  }

  private destroyClimbTargetLayer(): void {
    const layer = this.climbTargetLayer;
    this.climbTargetLayer = undefined;
    this.climbTargetFloor = undefined;
    // AG-65：拒绝落地时梯停了，洞口透出的目标层地板跟着撤（成功落地走
    // clearFloor 的批量销毁，这里靠 floorObjects.includes 防双销毁）。
    for (const o of this.climbHoleReveal) {
      if (this.floorObjects.includes(o)) {
        this.floorObjects = this.floorObjects.filter((x) => x !== o);
        o.destroy();
      }
    }
    this.climbHoleReveal = [];
    // A successful landing's clearFloor() already destroyed it and emptied
    // floorObjects; a scene restart leaves a stale reference to a dead object.
    // Either way it is no longer in the array, so there is nothing to destroy.
    if (!layer || !this.floorObjects.includes(layer)) return;
    this.floorObjects = this.floorObjects.filter((o) => o !== layer);
    layer.destroy();
  }

  // OVERHAUL: plays a one-shot action clip and holds it for `ms`. The frame
  // loop's walk/idle pick stands down while the clip runs.
  //
  // AG-90：hold 时长对 GIF 图集取两者大者（render/charAnims.ts）——attack
  // GIF 是 3x600ms=1800ms，程序姿态只要 320ms；按 320ms hold 会在 GIF 第一
  // 帧就把它切回 idle。没有 GIF 的角色/动作（walk、五名未烘焙角色）原样
  // 用调用方的 ms。
  //
  // timeScale 复位到 1：站立待机会把 0.2 的防滑步底线留在精灵上（见 update
  // 的 walk/idle 挑选段），一次性动作从站立态出手时若不复位，GIF 会以 1/5
  // 速播放（攻击 9 秒），程序姿态更是从来只播得出第一帧。播完 update 的
  // 挑选会重新按速度压时间，这里只负责出手这一下。
  //
  // public：CombatHost 面之一（RC-03 拆分第 7 步）——战斗出手/受击/倒地与
  // 世界链（搜割/拾取/死亡/巡游体攻击）共用同一份实现；e2e 的 clip 记录
  // （ag51/ag66 猴补丁）也走这个场景方法。
  playActionAnim(key: string, ms: number): void {
    this.actionAnimKey = key;
    this.actionAnimUntil = this.time.now + charAnimHoldMs(key, ms);
    this.player.anims.timeScale = 1;
    this.player.play(key, true);
  }

  /**
   * AG-90：巡游体自己的 attack GIF。它和玩家一样是有贴图的角色（walk sheet
   * + 六个动作图集），不是程序化怪物——所以它打人时演的是自己的挥击，
   * 伤害反馈（震屏/闪白/飘字）仍走现有 fx 层。repeat:0 停在末帧，到点切回
   * walk；没有图集（加载失败回退）时静默跳过。
   */
  private playWandererAttack(): void {
    const w = this.wanderer;
    if (!w?.active) return;
    const key = attackAnimKey('wanderer');
    if (!this.anims.exists(key)) return;
    w.play(key, true);
    this.time.delayedCall(charAnimHoldMs(key, 0), () => {
      if (w.active && w.anims.currentAnim?.key === key) w.play(walkAnimKey('wanderer'), true);
    });
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
    // AG-66：阻碍物的 Graphics 都在 floorObjects 里（上面已批量销毁），这里只
    // 清名册与动作态——delayedCall 的 timer 必须摘掉，否则换层后旧动作到点出货。
    this.obstacleObjs.clear();
    this.floorObstacles = [];
    this.activeObstacleList = [];
    if (this.pendingAction) {
      this.pendingAction.timer.remove(false);
      this.pendingAction = undefined;
    }
    this.bunkObjs.clear();
    this.furnitureLabels = [];
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

  /** Keep the player, carried light and contact shadow on one world position.
   *  public：CombatHost 面之一（RC-03 拆分第 7 步）——战斗滑步/撤退演出的
   *  tween onUpdate 驱动点，与世界链（攀爬落地）同一份实现。 */
  syncPlayerWorldObjects(x: number, y: number): void {
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
    // AG-90 接线 R1 修复：一次性动作 key 的生成侧（playActionAnim 的调用处）
    // 用的是 attackAnimKey(this.metaSelectedCharacter()) 等按角色取的 key，
    // 同步侧的比较对象也必须跟着 who 走——硬编码 'player' 会让选了
    // alin/xiaozhou/wanderer 的玩家整个 attack GIF 期间撬棍静止在髋部持握位、
    // 死亡时不淡出（QA 第 1 轮 R1）。who 每帧读一次 meta：loadMeta 是
    // localStorage.getItem + 小对象 JSON.parse，微秒级；update() 后半的
    // walk/idle 挑选段本就同频调用 metaSelectedCharacter()，不引入新量级。
    const who = this.metaSelectedCharacter();
    // A dying survivor lets go of it. The fall clip drops the body through the
    // height the grip is anchored at, so a held crowbar would hover over the
    // corpse at waist height. Fading it out and back in on the next non-death
    // frame is cheaper than a drop animation nobody will be watching the end
    // card over.
    if (this.time.now < this.actionAnimUntil && this.actionAnimKey === dieAnimKey(who)) {
      w.setAlpha(0);
      return;
    }
    const swinging =
      this.time.now < this.actionAnimUntil && this.actionAnimKey === attackAnimKey(who);

    if (swinging) {
      // AG-90：帧号映射同时认两个来源——程序化 walk sheet 把 attack 段放在
      // 8..10（ATTACK_FRAME_START），GIF 图集（char-anim-*-attack.png）的
      // 三帧就叫 0..2。都以 attackPose(f) 的同一个 f 收尾，撬棍的挥砍同步
      // 逻辑（weapon.ts 持握 + 这里的每帧定位）原样保留。
      const frameNo = Number(this.player.frame?.name ?? ATTACK_FRAME_START);
      const f = Math.max(0, attackFrameIndex(frameNo, ATTACK_FRAME_START, ATTACK_FRAMES));
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
  // public：MonologueHost 面之一——角色卡/选句的「谁在说话」走这一份实现
  // （陈旧选择回退 player 的语义不复制到控制器）。
  metaSelectedCharacter(): CharacterKey {
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
      // AG-104：nudge 的搜索边界传本层实际宽度（this.floorW = floorWidthFor(floor)）——
      // 不传就按 1280 找位，宽楼右半的 ? 会被钳回左半。
      const x = nudgeSpotX(spot.x, taken, INTERACT_DISTANCE + 8, this.floorW);
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
          onComplete: () => {
            // AG-52 发现、AG-50 应用：换层（爬梯/电梯）时 clearFloor 销毁行商，
            // 在飞的巡逻 tween 完成后对已销毁精灵调 .play()，异常穿过
            // TweenManager 打断游戏循环，玩家冻住（stairNavigation 50010→50009
            // 基线红：冻在电梯里）。onStart 早有同款防护，onComplete 补上。
            if (trader.active && trader.anims) trader.play(idleAnimKey('npc_alin'));
          },
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

  private openEncounter(spotId: string): void {
    const state = getGame();
    if (shouldSkip(state, spotId)) return;
    const marker = this.spotMarkers.get(spotId);
    const enc = rollFloorEncounter(state, state.currentFloor, spotId);
    // OVERHAUL Wave A: anything with teeth opens a real turn-based fight
    // instead of the old single-roll panel.
    // RC-03 拆分第 7 步：开战入口留场景（遭遇点检测的世界链归场景），
    // startCombat 本体在 CombatController——detect 到 combat kind 即委托。
    if (isCombatKind(enc.kind)) {
      this.combat.start(spotId, enc.kind as 'ambush' | 'boss');
      return;
    }
    this.encounter = { spotId, encounter: enc, choices: this.encounterChoices(enc.kind), selected: 0, resolved: false };
    this.encounterOpen = true;
    this.buildEncounterPanel(marker?.isBoss ?? false);
    // The alert sting is the warning shot.
    playSfx('alert');
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
    // （AG-90：同上，按当前角色取 attack key。）
    if (choice === 'fight') {
      this.playActionAnim(attackAnimKey(this.metaSelectedCharacter()), 300);
      this.playSwingFx();
    }
    if (result.hpChange < 0) {
      // AG-91：非战斗舞台的受伤（遭遇战掉血）= medium 档，与战斗反击同一比例。
      // RC-03 拆分第 7 步：impact 入口在 CombatController（juice 层随迁）。
      this.combat.impact('medium', this.player.x, PLAYER_FEET_Y - 48);
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
    this.drawDormBeds(STARTING_FLOOR, DORM_FRONT_BEDS, DORM_BACK_BEDS, true);

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
      // AG-65：氛围层是楼层几何，不是设计画布——ambient 双色带与四边 vignette
      // 必须铺满本层实际宽度（4-9 间 × 320px，宽楼至 2880px）。写死 FLOOR_WIDTH
      // 时，相机右移后 x>1280 的右半楼没有任何氛围层，左右半楼观感断裂。与上面
      // 墙体/地板带/haze 同一口径：this.floorW = floorWidthFor(floor)，
      // drawFloor 入口（本文件 1610 行）赋值，窄楼（tier1 恒 1280）数值不变。
      width: this.floorW,
      height: FLOOR_HEIGHT,
      isDorm: false,
      hasUpExit: hasUpExit(floor),
      hasDownExit: hasDownExit(floor),
      // AG-103：梯口灯池对齐实际梯口——tier2+ 宽楼下行口是中段 seeded 随机
      // （this.downExit = downExitXFor(floor)，drawFloor 入口同源赋值），
      // lighting.ts 默认的 1240 只对 tier1 成立，宽楼会悬空。上梯口恒
      // UP_EXIT_X=40，一并显式传入。窄楼数值与默认值相同，像素不变。
      upExitX: UP_EXIT_X,
      downExitX: this.downExit,
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
    // AG-65：楼板洞与中梯画在交通梯之后——同一条「楼梯绘制调用段」，两者都是
    // 楼层几何的视觉面（位置见 worldgen.floorGeometryFor）。
    this.drawFloorFeatures(floor);
  }

  // ── AG-65：楼板洞与中梯（层内装饰，非交通）────────────────────────────────
  // 用户 2026-11-17 原话：「可以在中间加个梯子啥的，或者楼上面有个洞可以看到
  // 上面一层的情况，不过这个是比较少的」。位置按楼层号 seeded（各 15%，数值在
  // config/game-balance.json 的 floorGeometry），同层每次进同一个地方。
  //
  // 洞的取景（AG-52 契约）：站立态只在天花板画一块透光方框加光晕——「只看得见
  // 自己这一层」，不把楼下层画出来；爬梯态由 drawNeighbourFloor 在洞口补一块
  // 目标层地板，那一刻才「看到上面一层」。
  private drawFloorFeatures(floor: number): void {
    const geo = this.floorGeo;
    this.floorFeatureRects = { hole: null, ladder: null };
    if (!geo || geo.floor !== floor) return;
    const wallH = FLOOR_HEIGHT - FLOOR_BAND;
    if (geo.holeX !== null) {
      const hw = FLOOR_GEOMETRY_BALANCE.holeWidthPx;
      // depth 27：buildForeground 在天花板画了一条 14px 的前景横梁
      // （FG_DEPTH 26，alpha 0.92，「crops the top of the wall」）——洞画在
      // depth 9 会被它盖成只剩 8% 亮度（e2e 像素取证实测：洞 (22,20,21) vs
      // 应有的 (240,198,140)）。洞是透下来的光，压过前景梁：读作梁上的一个
      // 透光口，光晕洒在梁沿与墙上。
      const g = this.add.graphics().setDepth(27);
      // 光晕先画（洒在洞口下面的墙上），再画洞口本体压住天花板黑条。
      g.fillStyle(PALETTE.lightHigh, 0.1);
      g.fillRect(geo.holeX - hw, 8, hw * 2, 52);
      g.fillStyle(PALETTE.lightHigh, 0.14);
      g.fillRect(geo.holeX - hw * 0.6, 8, hw * 1.2, 34);
      // 洞本体：天花板黑条上的一块暖光，描一道墨边说是「洞」不是「灯」。
      g.fillStyle(PALETTE.ink, 0.9);
      g.fillRect(geo.holeX - hw / 2 - 2, 0, hw + 4, 10);
      g.fillStyle(PALETTE.lightHigh, 0.92);
      g.fillRect(geo.holeX - hw / 2, 1, hw, 7);
      g.fillStyle(PALETTE.lightHot, 0.5);
      g.fillRect(geo.holeX - hw / 2 + 6, 2, hw - 12, 3);
      this.floorObjects.push(g);
      this.floorFeatureRects.hole = [geo.holeX - hw / 2, 1, hw, 7];
    }
    if (geo.midLadderX !== null) {
      // 中梯：墙根一部短梯加一个黑洞洞的小隔间。纯装饰——没有 E 交互、不通往
      // 任何楼层（交通梯只有 drawExits 画的那两部），是「这一层有人用过」的布景。
      const x = geo.midLadderX;
      const g = this.add.graphics().setDepth(ACTOR_DEPTH - 1);
      // 隔间口：墨黑凹腔加一道石沿。
      g.fillStyle(PALETTE.ink, 0.92);
      g.fillRect(x - 24, wallH - 58, 48, 58);
      g.fillStyle(PALETTE.shadow, 0.5);
      g.fillRect(x - 20, wallH - 54, 40, 54);
      g.fillStyle(PALETTE.stone, 1);
      g.fillRect(x - 26, wallH - 60, 52, 4);
      // 短梯：两根栏加五根横档，从腔里搭到楼面带。
      g.fillStyle(PALETTE.stoneLight, 1);
      g.fillRect(x - 9, wallH - 54, 3, 84);
      g.fillRect(x + 6, wallH - 54, 3, 84);
      g.fillStyle(PALETTE.dust, 0.9);
      for (let i = 0; i < 5; i++) {
        g.fillRect(x - 9, wallH - 48 + i * 18, 18, 2);
      }
      this.floorObjects.push(g);
      this.floorFeatureRects.ladder = [x - 26, wallH - 60, 52, 64];
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
    // AG-53 的楼梯美术（docs/plans/STAIRS.md）：阶梯是十级踏面折返、直梯是
    // 一条垂线，样式按连接层段分派（tier 1/3 直梯，其余阶梯），绘制与
    // stairClimbPose 同源——角色踩在画出来的每一级上。楼层建造时画一次，
    // 爬梯期间随出发层留在屏上，正好跨到目标层梯口。
    const g = this.add.graphics();
    drawStairwell(g, { x, dir, floor });
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
  private drawNeighbourFloor(floor: number, yOffset: number, isAbove: boolean, distance: number, landingX: number): void {
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
    // AG-65/AG-103：顶灯带是楼层几何，铺满本邻居层自己的长度（nbW =
    // floorWidthFor(floor)）——写死 FLOOR_WIDTH 时宽邻居层右半没有顶灯，
    // 爬梯态从梯上往下看，灯带在楼宽中段凭空断掉。与墙体/地板带/ambient
    // 双色带/haze 同一口径；窄楼（tier1 恒 1280）数值不变。
    const strips = buildCeilingLights(this, { width: nbW, seed: floor * 13, top: 16 });
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
    // AG-65：落点取「到达本层的这趟梯子的出发口」（调用方传 climb.startX），
    // 不再取目标层自己的下行口——tier2 起每层的下行口各不相同（seeded 随机），
    // 竖井跨两层同一条 x，落点必须画在出发口正下方，角色才落在梯口上
    // （stairsArt.test.ts 钉 end.x = downExitXFor(出发层) 同源）。
    const stairX = landingX;
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
    // AG-65/AG-103：距离雾（aerial perspective）同样铺满邻居层自己的宽度
    // ——FLOOR_WIDTH 时宽楼右半没有距离雾，下半截楼比左半「近」，剖面
    // 的纵深读不出来。窄楼数值不变。
    add(this.add.rectangle(nbW / 2, FLOOR_HEIGHT / 2, nbW, FLOOR_HEIGHT, 0x1b2836, 0.2 * distance));

    // And the whole floor is set back a step. Detail alone was not enough: once
    // the neighbours were properly furnished, a warm canteen one floor down was
    // rendering more brightly than the cold maintenance floor the player was
    // standing on, and the eye went to the background.
    layer.setAlpha(1 - 0.09 * distance);
    this.floorObjects.push(layer);

    // AG-65：本层天花板上的楼板洞，爬梯态透出目标层的地板——「楼上面有个洞可以
    // 看到上面一层」只在爬梯时成立（目标层画在上面的时候）。下行行程楼上没有
    // 可画的层，洞保持站立态的一块透光。画在层容器之外（depth 3 压得住本层
    // 天花板黑条），且必须在上面那个「新对象扫进层」的循环之后创建，否则会被
    // 扫进 depth -10 的层里、被本层天花板盖住。
    const hole = this.floorGeo?.holeX;
    if (isAbove && hole !== null && hole !== undefined) {
      const hw = FLOOR_GEOMETRY_BALANCE.holeWidthPx;
      const reveal = this.add
        .tileSprite(hole - hw / 2, yOffset + FLOOR_HEIGHT - FLOOR_BAND, hw, FLOOR_BAND + 8, floorKeyFor(floor))
        .setDepth(27);
      const rim = this.add.graphics().setDepth(27);
      rim.lineStyle(2, PALETTE.ink, 0.9);
      rim.strokeRect(hole - hw / 2 - 1, yOffset + FLOOR_HEIGHT - FLOOR_BAND - 1, hw + 2, FLOOR_BAND + 10);
      this.floorObjects.push(reveal, rim);
      this.climbHoleReveal = [reveal, rim];
    }
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
      // AG-52: the label is born in its stealth look — 18px, no plate. The
      // per-frame fader below (containerLabelFor) owns its alpha from here on;
      // the plate stays in the map at alpha 0 until a future selected look
      // brings it back. The old always-on 22px nameplate is what the user
      // rejected (「就不用写这个储物柜是啥啥啥的」).
      const label = this.add
        .text(c.x, labelY, c.label, { fontFamily: FONT_FAMILY, fontSize: `${CONTAINER_LABEL_STEALTH_FONT}px`, color: hex(TEXT.primary) })
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
      // The first frame already wears the right look for where the player is
      // standing — a label at the default alpha 1 would flash for the one
      // frame before the fader's first run.
      const born = containerLabelFor(c, { playerX: getGame().player.x });
      label.setAlpha(born.alpha);
      plate.setAlpha(born.plateAlpha);
    }
    // The proximity fade, registered once per floor build and replaced each
    // time (see CONTAINER_LABEL_FADERS). Runs on the scene's UPDATE event so it
    // reads the player's position after this frame's movement, and the WeakMap
    // guarantees exactly one live listener however many floors the run visits.
    // AG-52: the fade INVERTED with the invisible-label rework — it used to
    // hold a permanent 22px plate and fade it OUT under the player's chin;
    // containerLabelFor now owns the whole three-look contract (nothing afar /
    // 0.35 stealth near / full plate when selected) and this loop just paints
    // it. The font size is only touched when the look changes it (the selected
    // look's 22px, once that interaction exists), never per frame.
    const appliedFont = new Map<string, number>();
    const fadeLabels = (): void => {
      const px = getGame().player.x;
      for (const c of this.floorView.containers) {
        const obj = this.containerObjs.get(c.id);
        if (!obj) continue;
        const look = containerLabelFor(c, { playerX: px });
        obj.label.setAlpha(look.alpha);
        obj.plate.setAlpha(look.plateAlpha);
        if (appliedFont.get(c.id) !== look.fontSize) {
          obj.label.setFontSize(look.fontSize);
          appliedFont.set(c.id, look.fontSize);
        }
      }
      // AG-51：家具名签（工作台/自己的床）走同一条契约。containerLabelFor
      // 不认容器不认家具，只认 (x, label)——所以两枚家具名签直接复用，远的
      // 时候彻底看不见，贴近了才浮出 0.35 的隐形字。用户说过「你不用把字写
      // 在上面」，储物柜改了名，家具不能还挂两块大牌。
      for (const f of this.furnitureLabels) {
        const look = containerLabelFor({ x: f.x, label: f.label.text }, { playerX: px });
        f.label.setAlpha(look.alpha);
        const fontKey = `furn:${f.x}`;
        if (appliedFont.get(fontKey) !== look.fontSize) {
          f.label.setFontSize(look.fontSize);
          appliedFont.set(fontKey, look.fontSize);
        }
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
  private drawDormBeds(floor: number, front: readonly number[], back: readonly number[], interactive = false): void {
    const floorY = FLOOR_HEIGHT - 60; // the front row's floor line
    const backY = floorY - 26; // the back row stands further from the camera
    const g = this.add.graphics().setDepth(4);
    this.floorObjects.push(g);
    const backG = this.add.graphics().setDepth(2);
    this.floorObjects.push(backG);

    // AG-51：1 层的床可搜刮/可拆解（interactive）。拆过的床不再画——重进楼层
    // 时 visitedFloors 的 bunkgone: 键说了算，所以「拆掉」是跨存档的。
    const drawBedAt = (x: number, back_: boolean, index: number): void => {
      // 键带绝对层号：dorm_bed_<层>_<x>。与 LootSystem 的 bunkgone:/bunksearch:
      // 键里的 ${floor} 对齐，多楼层同时注册也撞不到一起。
      if (interactive && isBunkDismantled(getGame(), floor, `dorm_bed_${floor}_${x}`)) return;
      if (back_) {
        const bed = this.add.image(x, backY, 'env-bunk-sleeper').setOrigin(0.5, 1).setScale(0.72).setDepth(2);
        this.floorObjects.push(bed);
        const z = this.add
          .text(x + 36, backY - 38, 'Z z', { fontFamily: FONT_FAMILY, fontSize: '14px', color: hex(TEXT.disabledDeep) })
          .setOrigin(0.5)
          .setDepth(3);
        this.floorObjects.push(z);
        this.dormSleepers.push({ z, baseY: z.y, phase: 3.4 + index * 1.3 });
        if (interactive) this.bunkObjs.set(`dorm_bed_${floor}_${x}`, { x, own: false, objects: [bed, z] });
        return;
      }
      const bed = this.add.image(x, floorY, 'env-bunk-sleeper').setOrigin(0.5, 1).setDepth(4);
      this.floorObjects.push(bed);
      const shadow = addContactShadow(this, x + 40, floorY + 2, 70, 2, 0.35);
      this.floorObjects.push(...shadow);
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
      this.dormSleepers.push({ z, baseY: z.y, phase: index * 1.7 });
      if (interactive) this.bunkObjs.set(`dorm_bed_${floor}_${x}`, { x, own: false, objects: [bed, ...shadow, label, z] });
    };

    // Back row first, so the front row overlaps it.
    back.forEach((x, i) => drawBedAt(x, true, i));
    // Pitch 96, so the row is crowded - beds nearly touching.
    front.forEach((x, i) => drawBedAt(x, false, i));
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
    // AG-51：字号改成隐形档（18px）并按距离出生——与容器名签同一条契约，
    // 远了什么都没有，贴近了才浮出 0.35 的「床（睡觉）」。
    const bedLabel = this.add
      .text(BED_X, floorY - 62, '床（睡觉）', { fontFamily: FONT_FAMILY, fontSize: `${CONTAINER_LABEL_STEALTH_FONT}px`, color: hex(TEXT.primary) })
      .setOrigin(0.5)
      .setDepth(105);
    this.floorObjects.push(bedLabel);
    this.registerFurnitureLabel(BED_X, bedLabel);
    // AG-51：自己的床也进可交互床铺表——白天 E 翻床垫底下，夜里 E 照旧走
    // 睡觉（interactWithBunk 里 night 分支优先，睡眠是生存主干）。刻意不给
    // 拆：这是全塔唯一能睡觉的床，拆了夜间安排就没了着落。
    // 键带绝对层号（own_bed_1）：与 LootSystem 键的 ${floor} 对齐，将来若有
    // 别的楼层也注册床铺，两张床不会撞同一个键。
    this.bunkObjs.set(`own_bed_${STARTING_FLOOR}`, { x: BED_X, own: true, objects: [g, bedLabel] });
  }

  // ── HUD & inventory UI（RC-03 拆分第 9 步：编排留场景，本体在 HudController）─
  /**
   * create() 尾部调用一次：HUD 顶带 + 背包面板。第 9 步后这里是纯编排——
   * 先毁后建的顺序与原 buildHud 一致（HUD 本体 → 底部导航条 → 角色卡），
   * 场景重启保 display list 且字段初始化器不重跑，上一局的件不清会双份上
   * 屏、stale Text 一 setText 就抛（Phaser 4 的 shutdown 只空纹理）。
   *
   * 留场景的两件（其余全在 HudController）：
   *   * feedbackText——flash() 是 ~30 处出口的同一反馈行（第 3 步契约：
   *     控制器不碰 feedbackText 本体），深度 HUD_FEEDBACK_DEPTH；
   *   * hintText——AG-71 起退居不可见的状态对象，世界链逐帧写它、
   *     NavBarController 经 worldHintText() 读，e2e 按 name 断言全串文本。
   */
  private buildHud(): void {
    // 先毁后建：HUD 本体（板/圆环 RT/数值行/环境 chips/预警行/暗角/debuff
    // 标记/背包全部件）+ 两个共用底栏的控制器。reset 内逐件 destroy。
    this.hud.reset();
    // AG-67（RC-03 第 2 步）：角色卡 + 自言自语 ticker 先毁后建。
    this.monologue.reset();
    // AG-71（RC-03 第 6 步）：底部导航条先毁后建。
    this.navBar.reset();

    // AG-54/AG-60/AG-67：HUD 顶带（四联圆环 + 铆钉板 + 数值/目标/环境行 +
    // 预警行 + 低血红环暗角 + debuff 标记）与背包面板（格/详情/放大面板）
    // 都在 HudController.build()——含 AG-66 铲子图标与 AG-102 圆环 RT 的
    // 首次烘焙。原 create 的 buildInventoryPanel() 一行并在这里面（面板相对
    // 次序不变：先 HUD 带后背包）。
    this.hud.build();

    // ── AG-71: the bottom navigation bar ──────────────────────────────────────
    // 参考 UI 的常驻底栏：一个 contextual 槽 + 五个固定槽，六个槽一条铆钉板。
    // hud-hint 退居状态对象（不可见）：它的文案是 contextual 槽的唯一数据源
    // （世界链逐帧刷新、面板链在开面板那一帧落定），e2e 仍按 name 断言它的
    // 全串文本；显示层是导航条自己的 hud-nav-context，见 NavBarController。
    this.hintText = this.add
      .text(8, DESIGN_HEIGHT - HUD_FOOT_H / 2, WORLD_DEFAULT_HINT, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.highlight) })
      .setOrigin(0, 0.5).setName('hud-hint').setScrollFactor(0).setDepth(HUD_FEEDBACK_DEPTH).setVisible(false);
    // AG-71（RC-03 第 6 步）：六槽铆钉板的构建在 NavBarController；hud-hint
    // 这个状态对象留场景——世界链逐帧写它，控制器经 worldHintText() 读。
    this.navBar.build();

    // ── AG-67: the bottom-right character card + the monologue ticker ────
    // Built last, so the card's lane is measured against the FINISHED hud:
    // money lane, nav bar (see render/hudLayout.ts statusCard*). 拆分第 2 步
    // 后卡片与循环 ticker（含定时器本身）都建在 MonologueController 里——
    // tick 周期与门控同源，不拆半个 ticker 在场景里。
    this.monologue.build();
  }

  /** Preserve legible type; shorten only exceptional overlong HUD strings.
   *  AG-71（RC-03 第 6 步）：public——NavBarHost 的截断面，contextual 槽的
   *  超宽战斗脚注在这里截断（HudController 的目标行/时钟/环境 chips 同口径），
   *  截断算法只有这一份。 */
  fitHudLine(text: Phaser.GameObjects.Text, width: number): void {
    if (text.width <= width) return;
    const characters = Array.from(text.text);
    while (characters.length > 1 && text.width > width) {
      characters.pop();
      text.setText(`${characters.join('')}…`);
    }
  }

  // public：CombatHost/DialogueHost/世界链/冻结探针（split-step7/8 的
  // s.refreshStats()）共用这一份实现——第 9 步后委托 HudController（圆环
  // 按值缓存 + 时钟/目标行/金币/分数），场景不复制第二份刷新逻辑。
  refreshStats(): void {
    this.hud.refreshStats();
  }

  // public：帧循环与跨动作刷新（睡觉/交易/搜刮后的时钟行 + 楼层徽章）。
  refreshClock(): void {
    this.hud.refreshClock();
  }

  // public：DialogueHost 面之一（RC-03 拆分第 8 步）——行商买卖/对话赠礼后
  // 的背包面板刷新走这一份实现（第 9 步后委托 HudController；搜刮/制作/
  // 任务奖励/无线电同路）。面板开着才可见——控制器内部有同一道安全网。
  refreshInventory(): void {
    this.hud.refreshInventory();
  }

  // ── HudHost 的场景查询面（RC-03 拆分第 9 步） ───────────────────────────
  // 运行期 host 就是本场景（字段初始化器 new HudController(this, STAT_BARS)），
  // Node 单测由假件实现同一结构面。

  /** AG-102 圆环 RT 烘焙器——共享件 createStatRingsBaker 第一参钉死
   *  Phaser.Scene，这里做唯一一处薄封装（与 PerfHost.createFloatTextPool
   *  同款路数）。 */
  createStatRings(): StatRingsBaker {
    return createStatRingsBaker(this, HUD_LAYOUT);
  }

  /**
   * HudHost 面之一（RC-03 拆分第 9 步）：反馈行的创建点位。flash() 是 ~30
   * 处出口的同一反馈行（第 3 步契约「控制器不碰 feedbackText 本体」）——文本
   * 本体与全部写入都留场景，只把「在 HUD 带序列的哪一刻出生」交给控制器编排
   * （环境 chips 之后、预警行之前，迁移前的逐字次序；冻结探针的显示列表契约）。
   * The 2026-11-14 HUD skin：Feedback has a dedicated lower lane. It remains
   * above modal panels but can never collide with the daily objective or the
   * permanent environment.
   */
  createFeedbackText(): Phaser.GameObjects.Text {
    this.feedbackText = this.add.text(20, HUD_LAYOUT.feedbackY, '', {
      fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: hex(PALETTE.lightHigh),
      backgroundColor: '#0b0f12ee', padding: { x: 8, y: 5 }, wordWrap: { width: 1216 },
    }).setName('hud-feedback').setScrollFactor(0).setDepth(HUD_FEEDBACK_DEPTH);
    return this.feedbackText;
  }

  /** 背包面板开着没有——e2e 六处（ag51/ag71/firstChapter/font/hudLayout/
   *  triggers）按 scene.inventoryOpen 直读，第 9 步后留 getter 委托
   *  HudController.isOpen，契约不变、e2e 零改动。 */
  get inventoryOpen(): boolean {
    return this.hud.isOpen;
  }

  // public：TutorialHost 面之一——教程的跳过语/收尾语走场景这一条反馈行
  // （与其余 ~30 处 this.flash 同一出口；控制器不碰 feedbackText 本体）。
  flash(msg: string): void {
    this.feedbackText.setText(msg);
    this.feedbackTimer?.remove(false);
    this.feedbackTimer = this.time.delayedCall(1600, () => this.feedbackText.setText(''));
  }

  // ── AG-77: 成就解锁 toast ───────────────────────────────────────────────
  /**
   * dev 句柄入口（main.ts 的 __PHASER_ACHIEVEMENTS__.emit 走这）：派一个事件
   * 进控制器的真实通路（evaluateAchievements → toast 队列 → 独立键落盘），
   * 与玩法钩子同一入口。场景不活跃时 main.ts 侧拿不到场景、诚实返回空数组
   * ——没有活着的 GameScene 就没有通路，静默丢弃好过打一个空场景。
   * 编排本体在 controllers/AchievementController（RC-03 拆分第 5 步）。
   */
  emitAchievementEvent(event: AchievementEvent): string[] {
    return this.achievements.emit(event);
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
    // AG-51：与容器名签同一条隐形化契约——远处无字，贴近才浮出 0.35 隐形字。
    const benchLabel = this.add.text(CRAFT_X, y + 4 - bench.displayHeight - 8, '工作台', { fontFamily: FONT_FAMILY, fontSize: `${CONTAINER_LABEL_STEALTH_FONT}px`, color: hex(TEXT.primary) }).setOrigin(0.5).setDepth(105);
    this.registerFurnitureLabel(CRAFT_X, benchLabel);
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
    const { width } = this.viewSize();
    const cx = width / 2;
    const left = cx - CRAFT_TREE_PANEL_W / 2;
    const top = CRAFT_TREE_PANEL_TOP;
    // Remembered for the mouse: a click outside this rectangle closes the panel.
    this.craftPanelBox = { x: left, y: top, w: CRAFT_TREE_PANEL_W, h: CRAFT_TREE_PANEL_H };
    this.panelBox = this.craftPanelBox;

    this.craftObjects.push(...buildPanel(this, cx, top + CRAFT_TREE_PANEL_H / 2, CRAFT_TREE_PANEL_W, CRAFT_TREE_PANEL_H, 'yellow', PANEL_DEPTH.game.craft));
    this.craftObjects.push(...buildPanelHeader(this, left, top, CRAFT_TREE_PANEL_W, '工作台 · 制作', UI.accent, PANEL_DEPTH.game.craft + 5, left + 28));
    // 面板内的操作提示（foot 带那份由 openPanelHint 出，内容一致）。
    const viewHint = this.add
      .text(left + CRAFT_TREE_PANEL_W - 28, top + 15, '拖拽平移 · 滚轮缩放', {
        fontFamily: FONT_FAMILY,
        fontSize: `${TYPE.caption}px`,
        color: hex(PALETTE.clothHigh),
      })
      .setOrigin(1, 0.5)
      .setDepth(PANEL_DEPTH.game.craft + 6);
    this.craftObjects.push(viewHint);

    // 合成路径的边先画，落在所有节点底板之下（同深度按创建序）。
    this.craftTreeEdges = this.add.graphics().setDepth(PANEL_DEPTH.game.craft + 1);
    this.craftObjects.push(this.craftTreeEdges);

    // 节点：底板 + 图标/纹章 + 名称 + 命中区。顺序即堆叠顺序——applyPanelDepth
    // 会把它们统一拉到同一深度，同深度内后创建的画在上层。
    this.craftTreeNodes = [];
    for (const node of CRAFT_TREE_NODES) {
      const x = craftColumnX(node.col);
      const band = this.add
        .rectangle(x + CRAFT_NODE_W / 2, node.y, CRAFT_NODE_W, CRAFT_NODE_H, UI.surfaceRaised)
        .setOrigin(0.5)
        .setDepth(PANEL_DEPTH.game.craft + 2);
      band.setStrokeStyle(1, UI.line, 0.5);
      // 物品（材料/武器/脏水）有 16px 图标；设施与凭证没有物品图标，用一枚
      // 菱形纹章占位——节点因此仍是「图标 + 名称」的同一形状。
      const icon = node.iconKey
        ? this.add.image(x + 16, node.y, node.iconKey).setOrigin(0.5).setScale(1.25).setDepth(PANEL_DEPTH.game.craft + 3)
        : null;
      const sigil = node.iconKey
        ? null
        : this.add.rectangle(x + 16, node.y, 12, 12, PALETTE.clothHigh).setOrigin(0.5).setDepth(PANEL_DEPTH.game.craft + 3);
      sigil?.setRotation(Math.PI / 4);
      const label = this.add
        .text(x + 30, node.y, node.displayName, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.primary) })
        .setOrigin(0, 0.5)
        .setDepth(PANEL_DEPTH.game.craft + 3);
      const hit = this.panelHit(x, node.y - CRAFT_NODE_H / 2, CRAFT_NODE_W, CRAFT_NODE_H, PANEL_DEPTH.game.craft + 4, {
        // 悬停即选中：旧列表 onOver→选中的同款语义，详情块随之刷新。
        onOver: () => this.selectCraftNode(node.id),
        // 真正的动作延迟到 pointerup（拖拽阈值裁决），见 craftPointerUpHandler。
        onClick: () => {
          this.craftPending = { kind: 'node', id: node.id };
        },
      });
      this.craftTreeNodes.push({ node, band, icon, sigil, label, hit });
      this.craftObjects.push(band, label, hit);
      if (icon) this.craftObjects.push(icon);
      if (sigil) this.craftObjects.push(sigil);
    }

    // 详情块四行：效果 / 状态+档位 / 材料 / 去哪拿（旧列表详情块的超集）。
    const detailX = left + 28;
    const detailText = (color: string): Phaser.GameObjects.Text =>
      this.add
        .text(detailX, CRAFT_TREE_DETAIL_Y, '', {
          fontFamily: FONT_FAMILY,
          fontSize: `${TYPE.caption}px`,
          color,
          wordWrap: { width: CRAFT_TREE_DETAIL_W, useAdvancedWrap: true },
        })
        .setOrigin(0, 0)
        .setDepth(PANEL_DEPTH.game.craft + 6);
    this.craftDetailTexts = {
      effect: detailText(hex(TEXT.primary)),
      status: detailText(hex(TEXT.dim)),
      materials: detailText(hex(TEXT.primary)),
      hints: detailText(hex(TEXT.warn)),
    };
    this.craftObjects.push(this.craftDetailTexts.effect, this.craftDetailTexts.status, this.craftDetailTexts.materials, this.craftDetailTexts.hints);

    // 制作按钮：Enter 的鼠标版。点击同样走 pointerup 裁决（拖拽不算点击）。
    this.craftButton = framedButton(
      this,
      left + 28 + CRAFT_TREE_DETAIL_W + 12,
      CRAFT_TREE_DETAIL_Y,
      CRAFT_TREE_BUTTON_W,
      CRAFT_TREE_BUTTON_H,
      '制作',
      PANEL_DEPTH.game.craft + 7,
      () => {
        this.craftPending = { kind: 'activate' };
      },
      { fill: UI.accent, line: PALETTE.lightHigh, text: hex(PALETTE.ink), hover: PALETTE.lightHigh },
    ) as PanelObject[];
    this.craftObjects.push(...this.craftButton);

    this.craftObjects.push(this.craftMarker);
    applyPanelDepth(this.craftObjects, PANEL_DEPTH.game.craft);
    // marker 与节点同深度，而它建得最早（create() 里）——不抬深度会被节点
    // 底板盖住。e2e 的 navTo 也靠它定位选中行。
    this.craftMarker.setDepth(PANEL_DEPTH.game.craft + 20);
    this.assertPanelContent('craft', this.craftObjects);
    for (const o of this.craftObjects) o.setVisible(false);
  }

  /** 悬停/键盘选中一个节点（craftSelected 是它在导航序里的下标）。 */
  private selectCraftNode(id: string): void {
    const index = this.craftEntries().findIndex((e) => e.id === id);
    if (index < 0 || this.craftSelected === index) return;
    this.craftSelected = index;
    this.refreshCraft();
  }

  /**
   * 导航序：树节点的数组顺序（材料 → 设施/武器 → 凭证链 → 净化插在净水器
   * 之后）。净化条目与旧列表同一条门——只在净水器已建造时存在。
   * ↑/↓ 在这条线性序上移动，Enter 执行选中项。
   */
  private craftEntries(): Array<{ kind: 'material' | 'recipe' | 'purify'; id: string }> {
    const state = getGame();
    return CRAFT_TREE_NODES.filter((n) => n.kind !== 'action' || hasUpgrade(state, 'purifier')).map((n) => ({
      kind: n.kind === 'material' ? 'material' : n.kind === 'action' ? 'purify' : 'recipe',
      id: n.id,
    }));
  }

  private refreshCraft(): void {
    const state = getGame();
    const entries = this.craftEntries();
    if (this.craftSelected >= entries.length) this.craftSelected = Math.max(0, entries.length - 1);
    const selectedId = entries[this.craftSelected]?.id;
    // ── 节点三态：可做=亮边、不足=灰、缺前置=暗+警告边、已建=青、材料根=素面 ──
    for (const view of this.craftTreeNodes) {
      const shown = entries.some((e) => e.id === view.node.id);
      view.band.setVisible(shown);
      view.label.setVisible(shown);
      view.hit.setVisible(shown);
      if (view.icon) view.icon.setVisible(shown);
      if (view.sigil) view.sigil.setVisible(shown);
      if (!shown) continue;
      const status = craftNodeStatus(state, view.node);
      const selected = view.node.id === selectedId;
      const fill =
        status.tone === 'accent' ? UI.accent
        : status.tone === 'good' ? UI.good
        : status.tone === 'warn' ? TEXT.warn
        : UI.surfaceRaised;
      const fillAlpha = status.tone === 'neutral' ? 0.3 : status.tone === 'dim' ? 0.28 : 0.34;
      view.band.setFillStyle(fill, fillAlpha);
      view.band.setStrokeStyle(
        selected ? 2 : 1,
        selected ? PALETTE.lightHigh
          : status.tone === 'accent' ? UI.accent
          : status.tone === 'good' ? UI.good
          : status.tone === 'warn' ? TEXT.warn
          : UI.line,
        selected ? 1 : status.tone === 'dim' || status.tone === 'neutral' ? 0.45 : 0.9,
      );
      view.label.setColor(
        hex(
          status.tone === 'accent' ? PALETTE.lightHigh
          : status.tone === 'warn' ? TEXT.warn
          : status.tone === 'neutral' ? TEXT.dim
          : TEXT.primary,
        ),
      );
      if (view.sigil) {
        view.sigil.setFillStyle(
          status.tone === 'accent' ? UI.accent
          : status.tone === 'good' ? UI.good
          : status.tone === 'warn' ? TEXT.warn
          : PALETTE.clothHigh,
          status.tone === 'dim' || status.tone === 'neutral' ? 0.5 : 0.95,
        );
      }
    }
    this.layoutCraftTree(selectedId);
    this.refreshCraftDetail(state, selectedId);
  }

  /**
   * 视图变换后的统一重排：screen = base * zoom + pan。节点、边、marker 一起
   * 走——拖拽与滚轮缩放都只改 craftPan/craftZoom 后调这里。
   */
  private layoutCraftTree(selectedId: string | undefined): void {
    const z = this.craftZoom;
    const sx = (base: number): number => base * z + this.craftPanX;
    const sy = (base: number): number => base * z + this.craftPanY;
    for (const view of this.craftTreeNodes) {
      const x = craftColumnX(view.node.col);
      view.band.setPosition(sx(x + CRAFT_NODE_W / 2), sy(view.node.y)).setScale(z);
      view.label.setPosition(sx(x + 30), sy(view.node.y)).setScale(z);
      if (view.icon) view.icon.setPosition(sx(x + 16), sy(view.node.y)).setScale(z * 1.25);
      if (view.sigil) view.sigil.setPosition(sx(x + 16), sy(view.node.y)).setScale(z);
      view.hit.setPosition(sx(x), sy(view.node.y - CRAFT_NODE_H / 2)).setScale(z);
    }
    // 边：选中节点的入边高亮（它要什么），材料节点高亮出边（它做什么用）。
    this.craftTreeEdges.clear();
    for (const edge of CRAFT_TREE_EDGES) {
      const from = findCraftNode(edge.from);
      const to = findCraftNode(edge.to);
      if (!from || !to) continue;
      const hot = edge.to === selectedId || edge.from === selectedId;
      this.craftTreeEdges.lineStyle(1, hot ? UI.accent : UI.line, hot ? 0.9 : 0.35);
      this.craftTreeEdges.beginPath();
      this.craftTreeEdges.moveTo(sx(craftColumnX(from.col) + CRAFT_NODE_W), sy(from.y));
      this.craftTreeEdges.lineTo(sx(craftColumnX(to.col)), sy(to.y));
      this.craftTreeEdges.strokePath();
    }
    // marker：选中节点名称的左侧。e2e/crafting.spec.ts 的 navTo 用
    // 「marker.y ±4 之内找标签」定位选中行，位置必须与标签同行。
    const selectedView = this.craftTreeNodes.find((v) => v.node.id === selectedId);
    this.craftMarker.setVisible(selectedView !== undefined);
    if (selectedView) placeMarkerLeftOf(this.craftMarker, selectedView.label);
  }

  /** 详情块：效果 / 状态+档位 / 材料 / 去哪拿 + 制作按钮的显隐与标签。 */
  private refreshCraftDetail(state: GameState, selectedId: string | undefined): void {
    const detail = this.craftDetailTexts;
    const node = selectedId ? findCraftNode(selectedId) : undefined;
    let effectLine = '';
    let statusLine = '';
    let materialsLine = '';
    let hintsLine = '';
    let statusColor = hex(TEXT.dim);
    let showButton = false;
    if (node?.kind === 'recipe') {
      const preview = recipePreview(state, node.id as RecipeId);
      const status = craftNodeStatus(state, node);
      effectLine = `效果：${preview.effect}`;
      // 状态词与档位/前置合并成一行：两者都是「这条配方现在够不够格」的读数。
      statusLine = `状态：${status.label}`;
      if (preview.tierNote) statusLine += ` · ${preview.tierNote}`;
      if (preview.requires) {
        statusLine += ` · 前置：${preview.requires.displayName} ${preview.requires.met ? '已获得' : '未获得'}`;
      }
      statusColor = hex(
        status.tone === 'accent' ? PALETTE.lightHigh
        : status.tone === 'good' ? PALETTE.clothHigh
        : status.tone === 'warn' ? TEXT.warn
        : TEXT.dim,
      );
      // 材料行：持有/需求逐项——旧列表只印需求，树形态补上库存读数。
      materialsLine = `材料：${preview.cost.map((c) => `${c.displayName} ${c.have}/${c.need}`).join(' · ')}`;
      if (preview.hints && preview.hints.length > 0) hintsLine = `去哪拿：${preview.hints.join('；')}`;
      showButton = true;
    } else if (node?.kind === 'action') {
      // 净化行的效果文案取净水器配方自己的 effect（数据唯一来源）。
      effectLine = `效果：${getRecipe('purifier').effect}`;
      const status = craftNodeStatus(state, node);
      statusLine = `状态：${status.label}`;
      statusColor = hex(status.tone === 'accent' ? PALETTE.lightHigh : TEXT.dim);
      showButton = true;
    } else if (node?.kind === 'material') {
      // 材料节点：出处（去哪拿）+ 用处（树里以它为 input 的配方，边的反查）。
      const hint = materialSourceHint(node.id as ItemId);
      effectLine = `出处：${hint ?? '世界各处'}`;
      const consumers = CRAFT_TREE_NODES.filter((n) => n.inputs.includes(node.id)).map((n) => n.displayName);
      statusLine = consumers.length > 0 ? `状态：基础材料 · 用来合成：${consumers.join('、')}` : '状态：基础材料';
    }
    detail.effect.setText(effectLine);
    detail.status.setText(statusLine);
    detail.status.setColor(statusColor);
    detail.materials.setText(materialsLine);
    detail.hints.setText(hintsLine);
    // 流式布局：每行按自己的真实高度占位，空行收起。
    let dy = CRAFT_TREE_DETAIL_Y;
    for (const t of [detail.effect, detail.status, detail.materials, detail.hints]) {
      if (t.text) {
        t.setPosition(t.x, dy);
        t.setVisible(true);
        dy += t.height + CRAFT_TREE_DETAIL_GAP;
      } else {
        t.setVisible(false);
      }
    }
    const buttonVisible = showButton && this.craftingOpen;
    for (const o of this.craftButton) o.setVisible(buttonVisible);
    if (buttonVisible && this.craftButton[2] instanceof Phaser.GameObjects.Text) {
      this.craftButton[2].setText(node?.kind === 'action' ? '净化' : '制作');
    }
  }

  /**
   * 平移 clamp：树内容不许被拖出活动带。活动带横向是面板内边，纵向止于
   * 详情块之上——平移不许把节点拖进详情文字里。缩放 1 时排版即到位
   * （pan=0 恒在带内），放大后树比带宽，才给到头部的平移自由。
   *
   * 曾经的写法在这里栽过一次：「树比可视区大时给到底的自由，小时居中」的
   * 分支把 min/max 写反了——树放大后每次回调都被重置回中心值，平移纹丝
   * 不动（实测位移恒 0）。现在只有一道 Clamp，min/max 随缩放方向互换。
   */
  private clampCraftPan(): void {
    const z = this.craftZoom;
    const b = craftTreeBounds();
    const box = this.panelBox;
    const interiorLeft = (box?.x ?? 0) + 32;
    const interiorRight = (box ? box.x + box.w : 1280) - 32;
    const interiorTop = (box?.y ?? 56) + 38;
    const interiorBottom = CRAFT_TREE_DETAIL_Y - 8;
    const loX = interiorRight - b.maxX * z;
    const hiX = interiorLeft - b.minX * z;
    this.craftPanX = Phaser.Math.Clamp(this.craftPanX, Math.min(loX, hiX), Math.max(loX, hiX));
    const loY = interiorBottom - b.maxY * z;
    const hiY = interiorTop - b.minY * z;
    this.craftPanY = Phaser.Math.Clamp(this.craftPanY, Math.min(loY, hiY), Math.max(loY, hiY));
  }

  /** pointerdown：记拖拽起点。任何按下都记——节点上起手的拖动也要能平移。 */
  private beginCraftDrag(pointer: Phaser.Input.Pointer, onInteractive: boolean): void {
    this.craftDragStart = { x: pointer.x, y: pointer.y, panX: this.craftPanX, panY: this.craftPanY };
    this.craftDragMoved = false;
    // 落在节点/按钮上的按下，其 onClick 已经在本事件之前跑完（Phaser 先发
    // 游戏对象事件再发场景事件），pending 是本次按下的；落在空白处的按下
    // 没有 onClick，清掉上一拍可能残留的 pending（在画布外松手就不会有
    // pointerup 来清它）。
    if (!onInteractive) this.craftPending = null;
  }

  /**
   * pointermove 事件驱动：按住并移动 → 平移（树单位 = 屏幕增量 / 缩放）。
   * 必须是事件而不是 update() 轮询 isDown——一次快速拖拽的
   * down→move×N→up 会在同一帧的输入批次里全部消费完，轮询看到 isDown
   * 已经是 false，平移一步都不会发生（实测：位移恒 0）。
   */
  private readonly craftPointerMoveHandler = (pointer: Phaser.Input.Pointer): void => {
    if (!this.craftingOpen) return;
    const start = this.craftDragStart;
    if (!start || !pointer.isDown) return;
    const dx = pointer.x - start.x;
    const dy = pointer.y - start.y;
    if (!this.craftDragMoved && Math.abs(dx) + Math.abs(dy) > CRAFT_TREE_BALANCE.dragThresholdPx) this.craftDragMoved = true;
    if (!this.craftDragMoved) return;
    this.craftPanX = start.panX + dx / this.craftZoom;
    this.craftPanY = start.panY + dy / this.craftZoom;
    this.clampCraftPan();
    this.layoutCraftTree(this.craftEntries()[this.craftSelected]?.id);
  };

  /** pointerup：没拖过才算点击。点击先补选中，再执行（与 Enter 同一条路）。 */
  private readonly craftPointerUpHandler = (): void => {
    if (!this.craftingOpen) return;
    const pending = this.craftPending;
    const moved = this.craftDragMoved;
    this.craftPending = null;
    this.craftDragStart = null;
    this.craftDragMoved = false;
    if (!pending || moved) return;
    if (pending.kind === 'node') this.selectCraftNode(pending.id);
    this.activateCraftEntry();
  };

  /** 滚轮缩放：以指针为锚点，指针下的树点在缩放前后保持不动。 */
  private readonly craftWheelHandler = (pointer: Phaser.Input.Pointer, _over: unknown[], _dx: number, dy: number): void => {
    if (!this.craftingOpen) return;
    const z0 = this.craftZoom;
    const factor = dy < 0 ? 1 + CRAFT_TREE_BALANCE.zoomStep : 1 - CRAFT_TREE_BALANCE.zoomStep;
    const z1 = Phaser.Math.Clamp(z0 * factor, CRAFT_TREE_BALANCE.zoomMin, CRAFT_TREE_BALANCE.zoomMax);
    if (z1 === z0) return;
    const tx = (pointer.x - this.craftPanX) / z0;
    const ty = (pointer.y - this.craftPanY) / z0;
    this.craftZoom = z1;
    this.craftPanX = pointer.x - tx * z1;
    this.craftPanY = pointer.y - ty * z1;
    this.clampCraftPan();
    this.layoutCraftTree(this.craftEntries()[this.craftSelected]?.id);
  };

  private toggleCrafting(): void {
    this.craftingOpen = !this.craftingOpen;
    for (const o of this.craftObjects) o.setVisible(this.craftingOpen);
    if (this.craftingOpen) {
      // 每次打开都回到全树视图：缩放/平移是临时查看手段，不跨开关保留。
      this.panelBox = this.craftPanelBox;
      this.craftSelected = 0;
      this.craftZoom = 1;
      this.craftPanX = 0;
      this.craftPanY = 0;
      this.craftDragStart = null;
      this.craftDragMoved = false;
      this.craftPending = null;
      this.refreshCraft();
    }
  }

  private buildPausePanel(): void {
    const { width, height } = this.viewSize();
    const panelW = 460;
    // 裁决记录（merge ag-81）：两侧同为 304 高度的解释性注释（HEAD 记 AG-72
    // 第五行「设置」的推导，ag-81 记第五行「本局统计」的推导）——合并后是
    // 六行版，两段推导都保留备查。
    // AG-72: 264 -> 304. A fifth row (设置) at the same 40px pitch keeps the
    // old bottom margin: 96 + 5*40 = 256, leaving 48px under the last row,
    // exactly what four rows had under the old 264 height.
    // ag-81: 第六行「本局统计」在 top+96+5*40 = top+296，与设置行同一 40px
    // 节距，304 的面板高度对六行同样成立（96 + 6*40 = 336 > 304，末行中心
    // 296 落在板内，板底余量与五行版一致）。
    const panelH = 304;
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
    // 统计面板是暂停菜单的子层：关暂停必须连它一起收，否则暂停菜单没了、
    // 统计表面板还挂在屏幕上（ESC 逃生舱判据全踩空）。hide() 只收可见性——
    // 暂停菜单的显隐紧接着由下面的 pauseObjects 一趟做完；不走 close() 的
    // 「还菜单 + panelBox 复位 + 音效」，那是 ESC/鼠标单收统计面板的路。
    if (this.pauseOpen && this.statsPanel.isOpen) {
      this.statsPanel.hide();
    }
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
    } else if (this.pauseSelected === 3) {
      this.scene.start('Menu'); // 返回标题
    } else if (this.pauseSelected === 4) {
      this.openSettings(); // 设置（AG-72）
    } else {
      this.openStatsPanel(); // 本局统计（AG-81）
    }
  }

  // 裁决记录（merge ag-81）：HEAD 的 openSettings（AG-72 设置面板的场景交接）
  // 与 ag-81 的本局统计只读子面板（RC-03 拆分后本体在 StatsPanelController，
  // 本场景留 openStatsPanel/closeStatsPanel 两行委托）是两个不同功能的面板
  // 入口，全部保留。
  // AG-72: the pause menu's 设置 entry. The panel lives in SettingsScene (the
  // class sits next to the title screen's copy of the same panel in
  // MenuScene.ts, both sharing SettingsPanelView). Scene handoff, the same
  // contract as openTowerOverview: GameScene stops, the survival clock stops
  // with it, and coming back re-runs create() against the same module-level
  // GameState — nothing about the run is reset, and create() re-closes the
  // pause menu on the way in.
  //
  // Registered lazily rather than in core/gameConfig's scene list: that config
  // is the shared boot contract, and only this one menu branch needs the scene
  // (the same reasoning main.ts uses for QuestPanel/Endgame). The get() guard
  // keeps the add idempotent across runs.
  private openSettings(): void {
    if (!this.scene.get('Settings')) this.scene.add('Settings', SettingsScene);
    this.scene.start('Settings');
  }

  // ── AG-81：本局统计面板（暂停菜单 → 只读子面板）────────────────────────
  // RC-03 拆分第 1 步：面板本体（面板框/页眉/表格行池/开关标志/刷新语义）
  // 在 controllers/StatsPanelController.ts——plain TS 类，不 import Phaser
  // 场景类型，Node 下可用记录型假件单测。本场景只留：
  //   * openStatsPanel / closeStatsPanel 两行委托（暂停菜单 index 5 入口、
  //     onEsc 的 isOpen 分支原样调它们）；
  //   * StatsPanelHost 两处协调面（pauseObjects 显隐、panelBox 判据）；
  //   * create() 的 build/reset（见上）。
  // QA-01「每次打开按当前 state 重建」的契约由控制器 open()→refresh() 落地，
  // 回归断言在 tests/statsPanelRefresh.test.ts（源码级，盯这层委托形态）。
  /** 打开统计面板：暂停菜单让位（pauseOpen 不变——游戏仍然暂停着）。 */
  private openStatsPanel(): void {
    this.statsPanel.open();
  }

  /** 关闭统计面板，回到暂停菜单。 */
  private closeStatsPanel(): void {
    this.statsPanel.close();
  }

  // ── StatsPanelHost：统计面板控制器的场景协调面 ──────────────────────────
  /** 打开统计面板时藏起暂停菜单、关闭时恢复（pauseObjects 归本场景管）。 */
  setPauseMenuVisible(visible: boolean): void {
    for (const o of this.pauseObjects) o.setVisible(visible);
  }

  /** panelBox 是「鼠标 ESC：面板外点击关闭」的判据，随当前打开的面板几何走。 */
  setPanelBox(box: PanelBox): void {
    this.panelBox = box;
  }

  // Opening the map hands the scene off entirely: GameScene is stopped, so the
  // survival clock stops with it, and coming back re-runs create() against the
  // same module-level GameState. Nothing about the run is reset on the way out.
  private openTowerOverview(): void {
    this.scene.start('TowerOverview');
  }

  private onToggleCrafting(): void {
    if (this.hud.isOpen || this.dialogueCtl.isOpen || this.pauseOpen || this.shelterOpen || this.nightChoiceOpen) return;
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
    if (entry.kind === 'material') {
      // 材料不是配方：Enter 给出去处提示（与详情块同源），不做任何扣减。
      const itemId = entry.id as ItemId;
      const hint = materialSourceHint(itemId);
      this.flash(hint ? `${getItem(itemId).displayName}：${hint}` : `${getItem(itemId).displayName}是基础材料，用来合成右侧配方`);
      return;
    }
    if (entry.kind === 'recipe') {
      const result = craft(state, entry.id as RecipeId);
      if (result.ok) {
        bumpStat(state, 'itemsCrafted'); // AG-81：制作成功计数（配方，不含净化）
        saveToStorage(state);
        this.refreshCraft();
        this.refreshInventory();
        this.refreshUpgradeBoard();
        playSfx('craft');
        // The work happens at the bench, so the effect is at the bench. Crafting
        // was a sound and a line of text with nothing on screen; the burst is
        // anchored to the station the player is standing at, not to the player.
        playFx(this, 'collect-burst', CRAFT_X, PLAYER_FEET_Y - 40, LIGHT_DEPTH);
        const recipe = getRecipe(entry.id as RecipeId);
        this.flash(`${recipe.kind === 'upgrade' ? '建造了' : '制作了'} ${recipe.displayName}（-${ACTION_COSTS.craft} 分钟）`);
        // AG-77：首次制作 / 四件武器全做。净化水不算「制作」（另一个分支）。
        this.achievements.emit({ type: 'item_crafted', recipeId: entry.id as string });
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
  // public：DialogueHost 面之一（RC-03 拆分第 8 步）——交易/赠礼的 -N 分钟
  // 经宿主扣（时钟属主在场景，含产业账本观察，见方法体内 diffVentureLedger）。
  chargeTime(gameMinutes: number): void {
    const state = getGame();
    // AG-20: 动作跨日时产业结算在 spendTime 内部发生——前后对比账本，读数
    // 才跟着动作走（只观察，不重复结算）。
    const ledger = state.growth?.ventures?.length ? this.dialogueCtl.ventureLedgerSnapshot() : null;
    const tick = spendTime(state, gameMinutes);
    if (ledger) this.dialogueCtl.diffVentureLedger(ledger);
    this.refreshClock();
    this.refreshStats();
    this.applyNightLighting();
    saveToStorage(state);
    if (tick.died || tick.won || state.status !== 'playing') {
      if (tick.died) bumpStat(state, 'deaths'); // AG-81：动作跨点把角色饿死/渴死也记一次
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
    // AG-65：散步相位随楼层重开——落层那刻起算（见 npcStrollPose 的 elapsed）。
    this.npcStrollState.clear();
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

  /**
   * 某 NPC 当前时刻的自主状态 + 实时散步（位置/是否在走/面朝/目标）。场景每帧
   * 据此摆精灵，对话距离与点击走位也读它——眼里看见的就是能对话的。
   *
   * AG-65：日程赶路时位置全归日程；到达锚点后位置 = 锚点 + 散步偏移（seeded
   * waypoint 时间线，见文件顶部的 npcStrollPose）。日程语义一个字节没动
   * （npcAtoms/npcBehavior 钉的是 npcAutonomyFor 本身），这里只是场景侧的
   * 实时摆位。
   */
  private npcView(state: GameState, npc: NpcDef): NpcAutonomyView & { strolling: boolean; face: 1 | -1 } {
    const { inventory } = syncNpcInventory(state, npc);
    // AG-104：楼层宽先算，一路喂给 npcAutonomyFor（goTo/日程钳制上限）与下面的
    // 散步钳制——原来钳制写死 1280，宽楼上 NPC 的 x 到不了右半。
    const width = floorWidthFor(state.currentFloor);
    const view = npcAutonomyFor(npc, {
      day: state.day,
      minuteOfDay: state.gameMinuteOfDay,
      runSeed: state.runSeed,
      stock: (itemId) => stockOf(inventory, itemId),
      floorWidth: width,
    });
    const lo = NPC_MARGIN;
    const hi = Math.max(lo, width - NPC_MARGIN);
    let stroll = this.npcStrollState.get(npc.id);
    if (!stroll) {
      stroll = { parkedSince: view.moving ? -1 : this.time.now, lastX: view.x, face: 1 };
      this.npcStrollState.set(npc.id, stroll);
    }
    let x = view.x;
    let strolling = false;
    let face = stroll.face;
    if (view.moving) {
      // 日程赶路中：散步相位挂起，落定重新起算（避免从半个偏移里接续，跳一下）。
      stroll.parkedSince = -1;
    } else {
      if (stroll.parkedSince < 0) stroll.parkedSince = this.time.now;
      const slots = scheduleFor(npc.id);
      const { index } = slotAt(slots, state.gameMinuteOfDay);
      const pose = npcStrollPose(npc.id, state.currentFloor, slots.length <= 1, (this.time.now - stroll.parkedSince) / 1000, FLOOR_GEOMETRY_BALANCE.npcStrollBandPx);
      x = Phaser.Math.Clamp(slots[index].x + pose.x, lo, hi);
      strolling = pose.walking;
      if (pose.face !== 0) face = pose.face;
    }
    // 面朝跟真实位移走：日程赶路、散步、站桩偶尔转身都覆盖。
    if (Math.abs(x - stroll.lastX) > 0.5) face = x < stroll.lastX ? -1 : 1;
    stroll.lastX = x;
    stroll.face = face;
    return { ...view, x, strolling, face };
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
      // AG-65：实时散步也在走——walk clip 与转身跟真实位移走（用户原话「那些
      // npc 应该都是可以动的」）。
      const want = view.moving || view.strolling ? walkAnimKey(rec.who) : idleAnimKey(rec.who);
      if (rec.sprite.anims.currentAnim?.key !== want) rec.sprite.play(want, true);
      rec.sprite.setFlipX(view.face < 0);
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

  // ── input ──────────────────────────────────────────────────────────────
  private bindInput(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    this.cursors = keyboard.addKeys({ up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT' }) as DirKeys;
    this.wasd = keyboard.addKeys({ left: 'A', right: 'D' }) as typeof this.wasd;
    // AG-50：Shift = 跑。轮询 isDown（移动段每帧读），不需要 keydown 回调。
    this.keyShift = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
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
      if (this.encounterOpen && !getGame().combat && !this.encounter) this.dialogueCtl.shopSell();
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
    // AG-61：树形制作面板的视图变换。滚轮缩放只在制作面板开着时生效；
    // pointerup 在场景与画布外各绑一份——在画布外松手也要清算点击/拖拽，
    // 否则残留的 pending 会在下一拍空白按下时被误执行。
    this.input.off('wheel', this.craftWheelHandler);
    this.input.on('wheel', this.craftWheelHandler);
    this.input.off('pointermove', this.craftPointerMoveHandler);
    this.input.on('pointermove', this.craftPointerMoveHandler);
    this.input.off('pointerup', this.craftPointerUpHandler);
    this.input.on('pointerup', this.craftPointerUpHandler);
    this.input.off('pointerupoutside', this.craftPointerUpHandler);
    this.input.on('pointerupoutside', this.craftPointerUpHandler);
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
      this.hud.panelObjectsForRecovery(),
      this.craftObjects,
      this.pauseObjects,
      this.dialogueCtl.panelObjectsForRecovery(),
      this.encounterObjects,
      this.combat.panelObjectsForRecovery(),
      this.shelterObjects,
      this.nightChoiceObjects,
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
    if (this.stairClimb || this.hud.isOpen || this.craftingOpen || this.dialogueCtl.isOpen || this.pauseOpen || this.encounterOpen || this.shelterOpen || this.nightChoiceOpen || this.dialogueCtl.ventureIsOpen || this.questsOpen) return;
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
    if (this.stairClimb || this.hud.isOpen || this.craftingOpen || this.dialogueCtl.isOpen || this.pauseOpen || this.encounterOpen || this.shelterOpen || this.nightChoiceOpen || this.dialogueCtl.ventureIsOpen) return;
    this.openTowerOverview();
  }

  /**
   * AG-20：G 键/导航条「产业」槽的开关入口。面板互斥 guard 逐字留在场景侧
   * （RC-03 拆分第 8 步：控制器只做翻转与重建，stairClimb/其他面板的判据是
   * 场景交互状态）——键盘 guard('g', ...) 与 navSlotRun('venture') 两条路
   * 都走这一个入口，与 I/C/M 同款。
   */
  private onToggleVentures(): void {
    if (this.stairClimb || this.hud.isOpen || this.craftingOpen || this.dialogueCtl.isOpen || this.pauseOpen || this.encounterOpen || this.shelterOpen || this.nightChoiceOpen) return;
    this.dialogueCtl.toggleVentures();
  }

  private onToggleInventory(): void {
    if (this.stairClimb || this.craftingOpen || this.dialogueCtl.isOpen || this.pauseOpen || this.encounterOpen || this.shelterOpen || this.nightChoiceOpen || this.dialogueCtl.ventureIsOpen) return;
    this.hud.toggle();
  }

  // ── mouse ───────────────────────────────────────────────────────────────
  /** Panel hit targets live in screen space: every panel in this scene is built
   *  at fixed screen coordinates and pushed through lockToScreen/applyPanelDepth,
   *  which sets scrollFactor 0. A hit rect left at scrollFactor 1 sits one camera
   *  scroll above the row it is supposed to cover — measured: 52px off on floor 2,
   *  which made every click land on the row above. */
  // public：CombatHost 面之一（RC-03 拆分第 7 步）——战斗动作条三钮的屏幕
  // 空间热区；其余面板（行商/遭遇/背包行）同一份实现。
  panelHit(
    x: number,
    y: number,
    w: number,
    h: number,
    depth: number,
    handlers: Parameters<typeof hitRect>[6],
  ): Phaser.GameObjects.Rectangle {
    return hitRect(this, x, y, w, h, depth, handlers).setScrollFactor(0);
  }

  // public：MonologueHost 面之一——自言自语的气泡不在模态背后说话，
  // 「有没有面板开着」的场景判据只有这一份。
  anyPanelOpen(): boolean {
    return (
      this.encounterOpen || this.shelterOpen || this.hud.isOpen || this.craftingOpen || this.dialogueCtl.isOpen || this.pauseOpen || this.decoOpen || this.dialogueCtl.ventureIsOpen || this.nightChoiceOpen
    );
  }

  // ── TutorialHost 面（RC-03 拆分第 3 步） ─────────────────────────────────
  // AG-73 教程的本体在 controllers/TutorialController（plain TS 类，不
  // import Phaser 场景类型），运行期拿场景当 host。下面这些是教程要用而场景
  // 已有的实现——与 MonologueHost/StatsPanelHost 同款纪律：控制器不 import
  // 场景类型，可测性靠这层结构面（单测用假件实现）。
  /** 场景此刻活着没有——夜收尾的延迟 flash 落地前的那一问。 */
  sceneActive(): boolean {
    return this.scene.isActive();
  }
  /** 爬梯动画进行中——教程按钮隐藏、呼吸框收起。 */
  stairClimbing(): boolean {
    return this.stairClimb !== undefined;
  }
  /** 制作面板开着没有——教程第 4 步（制作）的完成条件（字段同名，方法换个名）。 */
  craftingPanelOpen(): boolean {
    return this.craftingOpen;
  }
  /** 本层视图容器的坐标——教程世界快照（出现判定/高亮几何共用）。 */
  containers(): Array<{ id: string; x: number }> {
    return this.floorView.containers.map((c) => ({ id: c.id, x: c.x }));
  }
  /**
   * 站到自己床边没有（起始层 + 交互距离）——教程床步的第三条完成路径
   * （RC-02 XP-3）。判定纯读 state + 常量且另有非教程调用方（床铺交互），
   * 实现因此留场景、控制器经这层查询面摄入。
   */
  isNearBed(): boolean {
    return this.nearBed(getGame());
  }
  /** contextual 槽的世界链当前文本——教程让位判据（世界在教同一个 E 动作）。 */
  worldHintText(): string {
    return this.hintText.text;
  }
  // ── NavBarHost（AG-71 导航条，RC-03 拆分第 6 步）────────────────────────
  // contextual 第二链：教程提示。navHint 的出现条件与世界链让位判据都在
  // TutorialController，这里只做转发。
  tutorialNavHint(): string | null {
    return this.tutorial.navHint();
  }
  /** 固定槽 owned 判据——高亮链与点击守卫同一个口径（地图面板是另一个场景
   *  TowerOverview，本场景没有它的布尔，恒 false——参考图里它不开高亮）。 */
  navSlotOwned(key: NavSlotKey): boolean {
    switch (key) {
      case 'bag': return this.hud.isOpen;
      case 'craft': return this.craftingOpen;
      case 'venture': return this.dialogueCtl.ventureIsOpen;
      case 'menu': return this.pauseOpen;
      case 'map': return false;
    }
  }
  /** 固定槽动作——点击与键盘（I/C/G/M/Esc）走同一条路径（原 navSlots 表
   *  run 列的闭包体，逐字搬成 switch 分支）。 */
  navSlotRun(key: NavSlotKey): void {
    switch (key) {
      case 'bag': this.onToggleInventory(); break;
      case 'craft': this.onToggleCrafting(); break;
      case 'venture': this.onToggleVentures(); break;
      case 'map': this.onToggleMap(); break;
      case 'menu': this.onEsc(); break;
    }
  }
  // 点击守卫第一判「爬梯中不接」与 TutorialHost.stairClimbing 同一实现——
  // 一个方法满足两个接口，不写第二份。
  /** 共享 framedButton 的场景侧薄封装：第一参钉死 Phaser.Scene（运行期就是本场景）。 */
  framedButton(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    depth: number,
    onClick: () => void,
    colors: Parameters<typeof framedButton>[8],
  ): Phaser.GameObjects.GameObject[] {
    return framedButton(this, x, y, w, h, label, depth, onClick, colors);
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
    // AG-51：工作台与室友床铺也要在这里报名。点击走位带的是
    // interact=hasInteractableNear(x)——不报名，玩家点了工作台/床，人走到
    // 了，onInteract 却永远不会被叫（用户原话：「我点击这个工作台它也
    // 没有反应」）。半径与 E 判定同源（INTERACT_DISTANCE），点击与按键
    // 因此是同一件事。
    if (state.currentFloor === STARTING_FLOOR && near(CRAFT_X)) return true;
    for (const bunk of this.bunkObjs.values()) if (near(bunk.x)) return true;
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
    // AG-61：树形制作面板的拖拽平移。在任何早退之前记起点——节点上的按下
    // 也要能变成平移（点击则延迟到 pointerup 裁决，见 craftPointerUpHandler）。
    if (this.craftingOpen) this.beginCraftDrag(pointer, currentlyOver.length > 0);
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
    // AG-50：双击跑。同一落点附近（±doubleClickMaxDistancePx）在
    // doubleClickWindowMs 内的第二次点击 = 跑单；Shift 按住时单击也是跑单。
    // 第一下永远只是走单——「点一下走、快速点两下跑」，不存在猜错的第一下，
    // 第二下落在旁边（>40px）或超时（>300ms）也退回走单。
    const now = this.time.now;
    const last = this.lastClick;
    const run =
      this.keyShift?.isDown === true ||
      (!!last &&
        now - last.at <= MOVEMENT_BALANCE.doubleClickWindowMs &&
        Math.abs(x - last.x) <= MOVEMENT_BALANCE.doubleClickMaxDistancePx);
    this.lastClick = { x, at: now };
    this.walkTarget = { x, interact: this.hasInteractableNear(x), run };
    // 落点标记让玩家在角色动起来之前就看清自己下的是跑单还是走单。
    this.spawnClickMarker(world.x, world.y, run);
  }

  // AG-50：点击落点标记。走 = 灰点；跑 = 暖点 + 两粒往角色方向拖的残影。
  // 全部 tween 自动销毁，不建字段、不进 floorObjects——标记的寿命（≤320ms）
  // 比任何一次换层都短，残影越过换层边界也只是一粒正在淡出的点。
  private spawnClickMarker(x: number, y: number, run: boolean): void {
    const dot = this.add.graphics().setDepth(CLICK_MARKER_DEPTH);
    if (run) {
      dot.fillStyle(PALETTE.lightHot, 0.85);
      dot.fillCircle(x, y, 4);
      dot.lineStyle(2, PALETTE.lightHot, 0.7);
      dot.strokeCircle(x, y, 7);
      // 残影：从落点沿「角色→落点」的反方向拖两粒渐小渐淡的点，读作冲过去。
      const back = x >= getGame().player.x ? -1 : 1;
      for (let i = 1; i <= 2; i++) {
        const ghost = this.add
          .circle(x + back * i * 12, y, 3 - i, PALETTE.lightHot, 0.45 - i * 0.15)
          .setDepth(CLICK_MARKER_DEPTH);
        this.tweens.add({ targets: ghost, alpha: 0, delay: i * 50, duration: 240, onComplete: () => ghost.destroy() });
      }
      this.tweens.add({ targets: dot, alpha: 0, scale: 1.5, duration: 320, onComplete: () => dot.destroy() });
    } else {
      dot.fillStyle(PALETTE.stone, 0.5);
      dot.fillCircle(x, y, 3);
      this.tweens.add({ targets: dot, alpha: 0, duration: 240, onComplete: () => dot.destroy() });
    }
  }

  private onEsc(): void {
    if (this.stairClimb) return;
    // AG-81：统计面板是暂停菜单的子层——ESC 先合它回暂停菜单，暂停菜单再接
    // 住下一记 ESC 继续游戏。没有这一分支，统计面板开着时 ESC 会直接
    // togglePause 把暂停菜单也关掉，统计表面板却还挂在屏幕上。
    if (this.statsPanel.isOpen) {
      this.closeStatsPanel();
      return;
    }
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
      !this.hud.isOpen &&
      !this.craftingOpen &&
      !this.dialogueCtl.isOpen &&
      !this.pauseOpen &&
      !this.shelterOpen &&
      !this.nightChoiceOpen &&
      !this.dialogueCtl.ventureIsOpen &&
      !this.decoOpen &&
      this.clearStrayPanels()
    ) {
      this.flash('面板已清理');
      return;
    }
    // AG-73：教程进行中、且没有面板占着 Esc 时，第一下 Esc = 跳过教程
    // （不弹暂停——玩家连按 Esc 的意图是先摆脱眼前这条指引）。面板开着时
    // Esc 照旧归面板：关面板比跳教程急。与右上角「跳过教程」按钮同效。
    if (this.tutorial.isActive && !this.anyPanelOpen()) {
      this.tutorial.skip();
      return;
    }
    // OVERHAUL Wave A: ESC mid-fight is the retreat — it runs the flee round
    // rather than walking away for free, so the choice has a cost.
    // RC-03 拆分第 7 步：委托 combat.flee（选撤退位 + 打一轮）。
    if (this.encounterOpen && getGame().combat && !this.combat.isDone()) {
      this.combat.flee();
      return;
    }
    // OVERHAUL Wave C1: the shop is open (no combat, no encounter object).
    if (this.encounterOpen && !getGame().combat && !this.encounter) {
      this.dialogueCtl.closeShop();
      return;
    }
    if (this.encounterOpen) {
      // Leaving an unresolved encounter is the walk-away: no cost, no
      // consumption. A resolved one just closes the outcome panel.
      this.closeEncounter();
      return;
    }
    if (this.nightChoiceOpen) {
      this.dismissNightPrompt();
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
    if (this.hud.isOpen) this.hud.toggle();
    else if (this.craftingOpen) this.toggleCrafting();
    else if (this.dialogueCtl.isOpen) this.dialogueCtl.back();
    else if (this.dialogueCtl.ventureIsOpen) this.dialogueCtl.closeVentures();
    else this.togglePause();
  }

  private onNavUp(): void {
    if (this.decoOpen) {
      this.pageDeco(-1);
      return;
    }
    if (this.nightChoiceOpen) {
      this.nightChoiceSelected = Math.max(0, this.nightChoiceSelected - 1);
      this.buildNightChoicePanel();
      return;
    }
    if (this.shelterOpen && !getGame().shelterPlan?.resolved) {
      this.shelterSelected = Math.max(0, this.shelterSelected - 1);
      this.buildShelterPanel();
      return;
    }
    // OVERHAUL Wave C1: the shop's cursor.
    if (this.encounterOpen && !getGame().combat && !this.encounter) {
      this.dialogueCtl.shopMove(-1);
      return;
    }
    // RC-03 拆分第 7 步：战斗光标委托 combat.move（钳位 + 重画在控制器里）。
    if (this.encounterOpen && getGame().combat && !this.combat.isDone()) {
      this.combat.move(-1);
    } else if (this.encounterOpen && this.encounter && !this.encounter.resolved) {
      this.encounter.selected = Math.max(0, this.encounter.selected - 1);
      this.buildEncounterPanel(this.spotMarkers.get(this.encounter.spotId)?.isBoss ?? false);
    } else if (this.hud.isOpen) {
      this.hud.moveSelection(-1);
    } else if (this.craftingOpen) {
      this.craftSelected = Math.max(0, this.craftSelected - 1);
      this.refreshCraft();
    } else if (this.dialogueCtl.ventureIsOpen) {
      this.dialogueCtl.ventureMove(-1);
    } else if (this.dialogueCtl.isOpen) {
      this.dialogueCtl.move(-1);
    } else if (this.pauseOpen && !this.statsPanel.isOpen) {
      // AG-81：统计面板开着时暂停菜单隐藏着，↑ 不挪它的光标（同 onNavDown）。
      this.pauseSelected = Math.max(0, this.pauseSelected - 1);
      this.refreshPause();
    }
  }

  private onNavDown(): void {
    if (this.decoOpen) {
      this.pageDeco(1);
      return;
    }
    if (this.nightChoiceOpen) {
      this.nightChoiceSelected = Math.min(NIGHT_CHOICE_ROWS.length - 1, this.nightChoiceSelected + 1);
      this.buildNightChoicePanel();
      return;
    }
    if (this.shelterOpen && !getGame().shelterPlan?.resolved) {
      this.shelterSelected = Math.min(SHELTER_ROWS.length - 1, this.shelterSelected + 1);
      this.buildShelterPanel();
      return;
    }
    // OVERHAUL Wave C1: the shop's cursor.
    if (this.encounterOpen && !getGame().combat && !this.encounter) {
      this.dialogueCtl.shopMove(1);
      return;
    }
    // RC-03 拆分第 7 步：战斗光标委托 combat.move（钳位 + 重画在控制器里）。
    if (this.encounterOpen && getGame().combat && !this.combat.isDone()) {
      this.combat.move(1);
    } else if (this.encounterOpen && this.encounter && !this.encounter.resolved) {
      this.encounter.selected = Math.min(this.encounter.choices.length - 1, this.encounter.selected + 1);
      this.buildEncounterPanel(this.spotMarkers.get(this.encounter.spotId)?.isBoss ?? false);
    } else if (this.hud.isOpen) {
      this.hud.moveSelection(1);
    } else if (this.craftingOpen) {
      const count = this.craftEntries().length;
      this.craftSelected = Math.min(Math.max(0, count - 1), this.craftSelected + 1);
      this.refreshCraft();
    } else if (this.dialogueCtl.ventureIsOpen) {
      this.dialogueCtl.ventureMove(1);
    } else if (this.dialogueCtl.isOpen) {
      this.dialogueCtl.move(1);
    } else if (this.pauseOpen && !this.statsPanel.isOpen) {
      // AG-81：统计面板开着时暂停菜单是隐藏的，别让 ↓ 偷偷挪它的光标——
      // 否则 ESC 合下面板，标记停在一个玩家没看见过的选项上。
      this.pauseSelected = Math.min(PAUSE_OPTIONS.length - 1, this.pauseSelected + 1);
      this.refreshPause();
    }
  }

  // public：DialogueHost 面之一（RC-03 拆分第 8 步）——行商行/对话行点击的
  // 「选中后确认」走同一条 Enter 路径（键盘 Enter 的 guard('enter', onUse)
  // 同款；guard 的 action.call(this) 不依赖可见性）。
  onUse(): void {
    if (this.stairClimb) return;
    if (this.nightChoiceOpen) {
      this.activateNightChoice();
      return;
    }
    if (this.shelterOpen) {
      this.activateShelterChoice();
      return;
    }
    // OVERHAUL Wave A: the fight's turn key. Once the outcome screen is up,
    // Enter closes it; until then it plays the selected action.
    // RC-03 拆分第 7 步：委托 combat.enter（outcome → close，否则打一轮）。
    if (this.encounterOpen && getGame().combat) {
      this.combat.enter();
      return;
    }
    // OVERHAUL Wave C1: Enter in the shop buys one of the highlighted item.
    if (this.encounterOpen && !this.encounter) {
      this.dialogueCtl.shopBuy();
      return;
    }
    if (this.encounterOpen) {
      if (this.encounter?.resolved) this.closeEncounter();
      else this.activateEncounterChoice();
      return;
    }
    if (this.hud.isOpen) {
      const slot = this.hud.selectedIndex;
      const stack = getGame().player.inventory.slots[slot];
      if (!stack) return;
      // AG-74：收音机是"打开"不是"吃掉"——从背包用它即开电台 N 游戏分钟
      // （TWOM 的音乐通道；用了不消失，tool 类不进 useConsumable）。
      if (useRadioFromSlot(getGame(), slot)) {
        this.flash(`打开收音机 · 电台音乐 ${RADIO_MINUTES} 分钟`);
        return;
      }
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
    if (this.dialogueCtl.ventureIsOpen) {
      this.dialogueCtl.activateVenture();
      return;
    }
    if (this.dialogueCtl.isOpen) {
      this.dialogueCtl.activate();
      return;
    }
    // AG-81：统计面板是只读子面板，Enter 不当确认键——它在暂停菜单里就是
    // 被按下的那一键，再按一次只是重开一遍同一个面板。
    if (this.pauseOpen && !this.statsPanel.isOpen) this.activatePause();
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
    // AG-64：夜间二选一面板开着时，面板自己吃 E（同 shelterOpen 模式）。
    if (this.nightChoiceOpen) {
      this.onUse();
      return;
    }
    // AG-66：搜刮/挖掘进行中再按 E = 收手（与移动取消同一个出口）。
    if (this.pendingAction) {
      this.cancelPendingAction();
      return;
    }
    if (this.shelterOpen) {
      this.onUse();
      return;
    }
    if (this.hud.isOpen || this.craftingOpen || this.pauseOpen || this.dialogueCtl.ventureIsOpen) return;
    if (this.dialogueCtl.isOpen) {
      this.dialogueCtl.close();
      return;
    }
    const state = getGame();
    // OVERHAUL: a "?" in reach is the first thing E reaches for — the floor's
    // rumour beats its containers for attention, the way ALTACIMA's question
    // marks pull the player across a room. The trader's spot id is 'shop'.
    const spot = this.nearestEncounterSpot();
    if (spot === 'shop') {
      this.dialogueCtl.openShop();
      return;
    }
    if (spot) {
      this.openEncounter(spot);
      return;
    }
    // AG-66：过道阻碍物——E 挖开它（要铲子/撬棍），没工具就说缺什么。排在 NPC
    // 之前：阻碍物是 physical blocker，玩家被钳在它身上时该先挖开路，而不是跟
    // 站在瓦砾旁的邻居聊天（小周的巡查路线正好会压到 222 那类阻碍位）。与容器/
    // 床/梯口不可能同距触发（放置时 keepClear 避让过），不存在歧义。
    const obstacle = this.nearestObstacle();
    if (obstacle) {
      this.tryClearObstacle(obstacle);
      return;
    }
    const npc = this.nearestNpc(state);
    if (npc) {
      this.dialogueCtl.open(npc);
      return;
    }
    // AG-51：床铺（自己的床白天翻、夜里睡；室友床搜刮/拆解）与工作台
    // （点它 = 开制作面板）。放在 NPC 之后、容器之前：床和台是家具，不该
    // 被手边半空的柜子抢班。
    const bunk = this.nearestInteractiveBunk();
    if (bunk) {
      this.interactWithBunk(state, bunk);
      return;
    }
    if (this.nearCraftStation(state)) {
      // 方案 A：点工作台 = 开制作面板。1 层的工作台本来就是纯家具（楼层
      // 模板里没有它，楼层视图里没有它的一行，从来就搜不出东西），C 键
      // 的入口只服务记得快捷键的人——E 与点击现在给所有人。其它层的
      // workbench 是模板容器（值班台等），照旧搜刮，不受此分支影响
      // （nearCraftStation 只在起始层为真）。
      this.toggleCrafting();
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
    // Before containers, not after: 中产区多个层的容器正好压在电梯窗上
    // （10004/10005/10006 的安保柜 x=1140、收银台 x=1160，电梯窗 1135..1195，
    // 容器判定半径 44），修前站在电梯口按 E 开的是手边的箱子而不是电梯——
    // 与 hint 链同一个修复（nearLift 提前），E 与脚注必须说同一件事。
    // 100000 终局层没有电梯（nearLift 恒 false），finaleContainer 不受影响。
    if (this.nearLift(state)) {
      this.takeLift();
      return;
    }
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
    if (this.stairClimb || this.hud.isOpen || this.craftingOpen || this.dialogueCtl.isOpen || this.pauseOpen || this.encounterOpen || this.shelterOpen || this.nightChoiceOpen || this.dialogueCtl.ventureIsOpen) return;
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
  // public：StatsPanelHost 面之一——统计面板控制器 build() 后当场自查
  // （面板件在控制器里生命周期自治，守卫仍走场景这一份实现，不复制）。
  assertPanelContent(panel: string, objects: ReadonlyArray<Phaser.GameObjects.GameObject>): void {
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
  // AG-71（RC-03 第 6 步）：public——NavBarHost 的 contextual 第一链数据源，
  // 面板链的判定读十个面板布尔，属于场景侧交互状态，不随导航条迁出。
  openPanelHint(): string | null {
    const combat = getGame().combat;
    // AG-63: 战斗中脚注先答「用什么攻击」。用户原话：「我们对打的时候我
    // 需要看到我们的页面然后左下角提示那啥用什么来攻击等等」。武器名与伤害
    // 数都从真来源读（包里的槽位 / playerCombatant），不另维护一套口径。
    if (this.encounterOpen && combat) {
      const state = getGame();
      return combatFootHint(combatWeaponLabel(state.player.inventory.slots), playerCombatant(state).damage);
    }
    if (this.encounterOpen && this.encounter) return '↑/↓ 选择 · Enter 确认 · ESC 离开';
    if (this.encounterOpen) return '↑/↓ 选择 · Enter 买入 · S 卖出 · ESC 离开';
    if (this.nightChoiceOpen) return '↑/↓ 选择 · Enter 确认 · ESC 今晚再想想';
    if (this.shelterOpen) return getGame().shelterPlan?.resolved ? 'Enter 睡觉 · ESC 返回' : '↑/↓ 选择 · Enter 安排 · ESC 返回';
    if (this.hud.isOpen) return '↑/↓ 选择 · Enter 使用 · I 关闭';
    if (this.craftingOpen) return '↑/↓ 选择 · Enter 制作 · 拖拽平移 · 滚轮缩放 · C 关闭';
    if (this.dialogueCtl.ventureIsOpen) return '↑/↓ 选择 · Enter 入股 · G 关闭';
    if (this.dialogueCtl.isOpen) return '↑/↓ 选择 · Enter 确定 · ESC 返回';
    // AG-81：统计面板只有一条出路——回暂停菜单。Enter 不当确认（只读面板）。
    if (this.statsPanel.isOpen) return 'ESC 返回暂停菜单';
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

  // ── AG-51：床铺交互（搜刮 / 拆解） ─────────────────────────────────────
  // 1 层宿舍的床不是容器（楼层视图里没有它们的一行），所以入口与搜柜分开：
  // 点击或 E 走到床边触发。概率与产出全在 LootSystem 的纯函数里
  // （seeded RNG：同 seed 同结果，禁 Math.random），场景只出动画、flash
  // 与拆床后的清场。

  /** 手边最近的一张可交互床（自己的床 + 室友床；拆过的不再算）。 */
  private nearestInteractiveBunk(): { id: string; x: number; own: boolean } | null {
    const state = getGame();
    let best: { id: string; x: number; own: boolean } | null = null;
    let bestDist = INTERACT_DISTANCE;
    for (const [id, bunk] of this.bunkObjs) {
      if (isBunkDismantled(state, state.currentFloor, id)) continue;
      const d = Math.abs(bunk.x - state.player.x);
      if (d <= bestDist) {
        bestDist = d;
        best = { id, x: bunk.x, own: bunk.own };
      }
    }
    return best;
  }

  private interactWithBunk(state: GameState, bunk: { id: string; x: number; own: boolean }): void {
    if (bunk.own) {
      // 自己的床：夜里睡觉优先——睡眠是生存主干（survivalBalance 钉着夜间
      // 代谢与回血），搜刮不抢班；白天才翻床垫底下。
      if (isNight(state.gameMinuteOfDay)) {
        this.attemptSleep();
        return;
      }
      this.runBunkSearch(bunk);
      return;
    }
    if (isBunkSearched(state, state.currentFloor, bunk.id)) {
      // 今天翻过了：包里得有一件能拆床的工具（撬棍/消防斧）才递得上拆解，
      // 否则老实说明天再来——拆解是「翻过之后」的进阶动作，不是误触陷阱。
      if (bunkDismantleTool(state.player.inventory)) {
        this.runBunkDismantle(state, bunk);
        return;
      }
      this.flash('这张床今天已经翻过了，明天再来');
      return;
    }
    this.runBunkSearch(bunk);
  }

  private runBunkSearch(bunk: { id: string; x: number }): void {
    // AG-66：与容器同一条 2s 动作——先播 search 动画（翻箱倒柜的那个姿势），
    // 到点才翻床垫（finishBunkSearch）。「今天翻过了」的闸门仍在
    // interactWithBunk 入口原样 instant 拦着，不会为一张翻过的床弯腰。
    this.beginPendingAction({
      kind: 'bunk',
      bunkId: bunk.id,
      atX: bunk.x,
      busyHint: '翻找床垫中……',
      cancelHint: '你直起身来，没翻完',
    });
  }

  /** AG-66：2s 到点——床铺搜刮的结果落地（原 runBunkSearch 的出货段原样搬来）。 */
  private finishBunkSearch(bunkId: string, bunkX: number): void {
    const state = getGame();
    const result = searchBunk(state, state.currentFloor, bunkId);
    if (result.already) {
      this.flash('今天已经翻过这张床了');
      return;
    }
    bumpStat(state, 'bedsSearched'); // AG-81：搜床计数（翻过的不重复计）
    saveToStorage(state);
    this.refreshInventory();
    if (result.took.length > 0) {
      playFx(this, 'collect-burst', bunkX, PLAYER_FEET_Y - 50, LIGHT_DEPTH);
      this.lootThisTrip += result.took.reduce((n, t) => n + t.quantity, 0);
      // AG-77：单次搜刮 3 件+（翻床垫与开箱同一口径）。
      this.achievements.emit({ type: 'loot_taken', count: result.took.reduce((n, t) => n + t.quantity, 0) });
      this.flash(`翻到 ${result.took.map((s) => `${getItem(s.itemId).displayName}×${s.quantity}`).join('、')}（-${BUNK_SEARCH_COST} 分钟）`);
    } else if (result.full) {
      this.flash('背包已满：翻出来的东西放不下，先腾包');
    } else {
      this.flash('床垫下面只有灰和一根断头发');
    }
    this.chargeTime(BUNK_SEARCH_COST);
  }

  private runBunkDismantle(state: GameState, bunk: { id: string; x: number }): void {
    const result = dismantleBunk(state, state.currentFloor, bunk.id);
    if (!result.ok) {
      this.flash(result.reason ?? '拆不了这张床');
      return;
    }
    bumpStat(state, 'bedsDismantled'); // AG-81：拆床计数
    saveToStorage(state);
    this.refreshInventory();
    this.removeBunk(bunk.id);
    // 拆比翻重：search clip 拉长到 520ms，板件应声落地。床就此消失，
    // 重进楼层也不会回来（bunkgone: 键住在存档里）。
    this.playActionAnim(searchAnimKey('player'), 520);
    playFx(this, 'collect-burst', bunk.x, PLAYER_FEET_Y - 40, LIGHT_DEPTH);
    this.lootThisTrip += result.took.reduce((n, t) => n + t.quantity, 0);
    this.flash(`拆了床，得到 ${result.took.map((s) => `${getItem(s.itemId).displayName}×${s.quantity}`).join('、')}（-${BUNK_DISMANTLE_COST} 分钟）`);
    // AG-77：累计拆床 10 张。
    this.achievements.emit({ type: 'bunk_dismantled' });
    this.chargeTime(BUNK_DISMANTLE_COST);
  }

  /** 床没了：销毁对象、把 Z 从呼吸队列里摘掉、注销交互热区。 */
  private removeBunk(id: string): void {
    const bunk = this.bunkObjs.get(id);
    if (!bunk) return;
    for (const o of bunk.objects) o.destroy();
    this.dormSleepers = this.dormSleepers.filter((s) => !bunk.objects.includes(s.z));
    this.bunkObjs.delete(id);
  }

  /**
   * AG-51：把一枚家具名签接入 AG-52 的贴近渐隐。出生即穿当前距离该有的
   * look（18px 隐形字 + 该有的 alpha）——否则第一帧会闪一下 22px 大牌，
   * 与容器名签的 born look 同一用意（见 buildContainers 里的 born）。
   */
  private registerFurnitureLabel(x: number, label: Phaser.GameObjects.Text): void {
    const look = containerLabelFor({ x, label: label.text }, { playerX: getGame().player.x });
    label.setAlpha(look.alpha);
    label.setFontSize(look.fontSize);
    this.furnitureLabels.push({ x, label });
  }

  /** 底栏世界提示：床边说什么（null = 不在床边，交给后面的判官）。 */
  private bunkHint(state: GameState): string | null {
    const bunk = this.nearestInteractiveBunk();
    if (!bunk) return null;
    if (bunk.own) {
      if (isNight(state.gameMinuteOfDay)) return '按 E 安排夜间行动';
      return isBunkSearched(state, state.currentFloor, bunk.id) ? '自己的床今天翻过了' : '按 E 翻翻自己的床';
    }
    if (!isBunkSearched(state, state.currentFloor, bunk.id)) return '按 E 搜刮床铺';
    return bunkDismantleTool(state.player.inventory) ? '按 E 拆解床铺' : '这张床今天翻过了';
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
    // RC-01：宿舍面板的「上次：…」读结构化日记（唯一的一套日记）。生产
    // 写入方是 ShelterSystem 的四个行动与夜袭，文案即当年旧格式的 message。
    const latest = diaryOf(state, 1)[0];
    this.shelterObjects.push(
      this.add.text(left + 24, top + 40, `压力 ${stress}/100${latest ? ` · 上次：${latest.text}` : ' · 今天还没有记录'}`, {
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
      const ledger = state.growth?.ventures?.length ? this.dialogueCtl.ventureLedgerSnapshot() : null;
      // AG-64：躺进被窝前把悬挂的造访判定结清——人都睡在屋里了，小偷无从
      // 下手；睡醒台词里带上昨夜的一句（settlePendingVisitOnSleep 幂等）。
      const nightPreventedBySleep = settlePendingVisitOnSleep(state);
      const result = finishNight(state);
      if (ledger) this.dialogueCtl.diffVentureLedger(ledger);
      if (!result.ok) {
        this.flash(result.reason ?? '今晚还不能睡');
        return;
      }
      this.closeShelter();
      saveToStorage(state);
      bumpStat(state, 'nightsSurvived'); // AG-81：活过今晚（睡觉跨到新的一天）
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
        const nightNote = nightWatchWakeNote(state) ?? (nightPreventedBySleep ? ' · 楼道里有脚步声，但你在屋里，没敢进来' : '');
        this.flash(`睡到第 ${result.nextDay} 天 06:00 · 压力 ${Math.round(state.player.stress ?? 20)}${attackNote}${nightNote}`);
      });
      if (state.status === 'lost') {
        bumpStat(state, 'deaths'); // AG-81：夜袭/睡梦中死亡（finishNight 内部置的 lost）
        this.scene.start('End');
      }
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

  // ── AG-64：入夜二选一（出去找物资 / 在家守夜）──────────────────────────
  // 用户 2026-11-17 原话：「晚上的话应该会提示我们是出去找物资还是在家里守夜，
  // 防止别的 npc 抢我们的东西」。面板语言延用既有面板：buildPanel 铆钉板 +
  // buildPanelHeader + 选项卡高亮（accent wash + 左竖线，同 buildListRow）+
  // placeMarker 箭头 + panelHit 鼠标行。判定全在 NightSystem 的纯函数里，
  // 这里只出面板与反馈。
  //
  // 弹窗时机在 update() 的入夜边沿里（只在外层、只一次/夜）；交互走
  // onUse/onNavUp/onNavDown/onEsc/onInteract 的 nightChoiceOpen 分支。

  private openNightPrompt(): void {
    this.nightChoiceSelected = 0;
    this.nightChoiceOpen = true;
    this.buildNightChoicePanel();
  }

  private closeNightChoice(): void {
    this.nightChoiceOpen = false;
    for (const object of this.nightChoiceObjects) {
      if (object !== this.nightChoiceMarker) object.destroy();
    }
    this.nightChoiceObjects = [];
    this.nightChoiceMarker.setVisible(false);
  }

  private buildNightChoicePanel(): void {
    for (const object of this.nightChoiceObjects) {
      if (object !== this.nightChoiceMarker) object.destroy();
    }
    this.nightChoiceObjects = [];
    const { width, height } = this.viewSize();
    const panelW = 460;
    const panelH = 252;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    // Remembered for the mouse: a click outside this rectangle closes the panel.
    this.panelBox = { x: left, y: top, w: panelW, h: panelH };
    const depth = PANEL_DEPTH.game.dialogue;

    this.nightChoiceObjects.push(...buildPanel(this, cx, cy, panelW, panelH, 'green', depth));
    this.nightChoiceObjects.push(...buildPanelHeader(this, left, top, panelW, '入夜 · 宿舍外', UI.good, depth + 5));
    this.nightChoiceObjects.push(...buildPanelWell(this, left + 12, top + 36, panelW - 24, 30, depth + 5));
    this.nightChoiceObjects.push(
      this.add
        .text(left + 24, top + 51, '天黑了，楼里不会只有你一个人。', {
          fontFamily: FONT_FAMILY,
          fontSize: `${TYPE.caption}px`,
          color: hex(PALETTE.clothHigh),
        })
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(depth + 6),
    );
    NIGHT_CHOICE_ROWS.forEach((row, index) => {
      const y = top + 78 + index * 78;
      const selected = index === this.nightChoiceSelected;
      if (selected) {
        // 选中高亮与 buildListRow 同一语言：accent 淡 wash + 左侧 2px 竖线。
        this.nightChoiceObjects.push(this.add.rectangle(left + 16, y, panelW - 32, 66, UI.accent).setOrigin(0, 0).setScrollFactor(0).setAlpha(0.13).setDepth(depth + 6));
        this.nightChoiceObjects.push(this.add.rectangle(left + 16, y, 2, 66, UI.accent).setOrigin(0, 0).setScrollFactor(0).setDepth(depth + 7));
      }
      this.nightChoiceObjects.push(this.add.image(left + 46, y + 33, row.iconKey).setOrigin(0.5).setScrollFactor(0).setDepth(depth + 7));
      const title = this.add
        .text(left + 72, y + 24, row.label, {
          fontFamily: FONT_FAMILY,
          fontSize: `${TYPE.body}px`,
          color: selected ? hex(PALETTE.lightHigh) : hex(TEXT.primary),
        })
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(depth + 7);
      const consequence = this.add
        .text(left + 72, y + 48, row.consequence, {
          fontFamily: FONT_FAMILY,
          fontSize: `${TYPE.caption}px`,
          color: '#6b6862',
          wordWrap: { width: panelW - 110 },
        })
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(depth + 7);
      this.nightChoiceObjects.push(title, consequence);
      if (selected) {
        placeMarker(this.nightChoiceMarker, title);
        this.nightChoiceMarker.setDepth(depth + 8).setVisible(true).setScrollFactor(0);
      }
      this.nightChoiceObjects.push(
        this.panelHit(left + 16, y, panelW - 32, 66, depth + 8, {
          onOver: () => {
            if (this.nightChoiceSelected === index) return;
            this.nightChoiceSelected = index;
            this.buildNightChoicePanel();
          },
          onClick: () =>
            this.time.delayedCall(0, () => {
              if (this.nightChoiceSelected !== index) {
                this.nightChoiceSelected = index;
                this.buildNightChoicePanel();
                playSfx('click');
                return;
              }
              this.activateNightChoice();
            }),
        }),
      );
    });
    this.nightChoiceObjects.push(
      this.add
        .text(cx, top + panelH - 14, '↑/↓ 选择 · Enter 确认 · ESC 今晚再想想', {
          fontFamily: FONT_FAMILY,
          fontSize: `${TYPE.caption}px`,
          color: hex(PALETTE.clothHigh),
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(depth + 6),
    );
    this.nightChoiceObjects.push(this.nightChoiceMarker);
    // 与 shelter 面板同一收尾：统一 depth + 锁屏。所有对象创建时即
    // scrollFactor(0)（buildListRow 的同款做法），placeMarker 因此量到的是
    // 屏幕坐标——本面板会在 2 层以上（相机有滚动）弹出，这点不能省。
    applyPanelDepth(this.nightChoiceObjects, PANEL_DEPTH.game.dialogue);
    lockToScreen(this.nightChoiceObjects);
    this.assertPanelContent('night-choice', this.nightChoiceObjects);
  }

  /** Enter：确认二选一。出去 = 武装一夜的偷取模拟；守夜 = 回家睡，小偷整晚不来。 */
  private activateNightChoice(): void {
    const state = getGame();
    const row = NIGHT_CHOICE_ROWS[this.nightChoiceSelected];
    if (!row) return;
    recordNightChoice(state, row.choice);
    saveToStorage(state);
    this.closeNightChoice();
    if (row.choice === 'scavenge') {
      playSfx('click');
      this.flash('你推门走进夜色——楼里不会只有你一个人');
    } else {
      playSfx('sleep');
      this.flash('你决定回宿舍守夜——今夜楼里再乱也乱不到你头上');
    }
  }

  /** ESC：今夜再想想。拒过之后今夜不再问，也不武装偷取。 */
  private dismissNightPrompt(): void {
    const state = getGame();
    recordNightDismissal(state);
    saveToStorage(state);
    this.closeNightChoice();
    this.flash('今夜的事，明天再说');
  }

  /**
   * AG-64：一夜的偷取后台模拟（判定全在 NightSystem）。玩家不在那一层也算——
   * 结果写 localEvents/lootedItems，回层或睡醒时给证据。只有所有面板都关着
   * 才会跑到这里（update 的面板早退在前），不存在「开着背包被偷」。
   */
  private tickNightWatch(): void {
    const state = getGame();
    const step = stepNightWatch(state, state.currentFloor === STARTING_FLOOR);
    if (step.kind === 'none') return;
    saveToStorage(state);
    if (step.kind === 'visited') {
      if (state.currentFloor !== STARTING_FLOOR) {
        this.flash('楼道里似乎有脚步声——有人往宿舍那边去了……');
        playSfx('alert');
      }
      return;
    }
    if (step.kind === 'prevented') {
      this.flash('你守在屋里——楼道里的脚步声最终远了');
      // AG-77：守夜成功计数（小偷被守在屋里逼退）。
      this.achievements.emit({ type: 'night_watch_prevented' });
      return;
    }
    // stolen：玩家不在家，什么被偷走了等回层/睡醒时由
    // nightWatchEvidenceNote / nightWatchWakeNote 出示，这里不剧透。
  }

  /** 回到宿舍时的小偷证据：flash 一次，之后 night-theft-seen 标记让它闭嘴。 */
  private reportNightWatchEvidence(): void {
    const state = getGame();
    const note = nightWatchEvidenceNote(state);
    if (!note) return;
    saveToStorage(state);
    this.flash(note);
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
    const target = this.floorView.containers.find((c) => c.id === containerId);
    const label = target?.label ?? containerId;
    // Tools unlock container TYPES rather than recipes: a locked safe is the
    // reason to carry the crowbar you found on floor 3.
    if (target?.needs && countItem(state.player.inventory, target.needs) === 0) {
      const tool = getItem(target.needs).displayName;
      this.flash(`${label}锁着，需要${tool}`);
      return;
    }
    // AG-66：搜刮是一个动作——点下去先弯腰（search 动画拉满 SEARCH_MS），2s 后
    // 才翻出东西。这期间移动输入即取消（不出货、不扣时间、不标记已搜，见
    // update 的 pendingAction 段）。既有边界（锁/满/空/二次搜刮）原样落在
    // finishContainerSearch 里，一个都没动。
    this.beginPendingAction({
      kind: 'container',
      containerId,
      atX: state.player.x,
      busyHint: `翻找${label}中……`,
      cancelHint: '你直起身来，没翻完',
    });
  }

  /** AG-66：2s 到点——容器搜刮的结果落地（原 openContainer 的出货段原样搬来）。 */
  private finishContainerSearch(containerId: string): void {
    const state = getGame();
    const floor = state.currentFloor;
    const target = this.floorView.containers.find((c) => c.id === containerId);
    const label = target?.label ?? containerId;
    const result = lootContainer(state, floor, containerId);
    if (result.took.length > 0 || result.full) bumpStat(state, 'containersLooted'); // AG-81：开出东西（或包满没拿完）的箱才算开过
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
      // THE MOMENT OF GETTING IT. A container opened and its contents appeared in
      // the bag with nothing on screen saying so; the burst is that beat.
      // （AG-66：search 动画在 beginPendingAction 就已经播满 2s，这里只放粒子与结果。）
      playFx(this, 'collect-burst', state.player.x + 10, PLAYER_FEET_Y - 50, LIGHT_DEPTH);
      this.lootThisTrip += result.took.reduce((n, t) => n + t.quantity, 0);
      // AG-77：单次搜刮 3 件+（一次开箱拿到几件，取历史最大值）。
      this.achievements.emit({ type: 'loot_taken', count: result.took.reduce((n, t) => n + t.quantity, 0) });
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


  // ── AG-66：2s 搜刮/挖掘动作 ─────────────────────────────────────────
  /**
   * 起一个搜刮/挖掘动作：search clip 拉满时长（容器/床 SEARCH_MS，阻碍物
   * OBSTACLE_DIG_MS），到点由 finishPendingAction 落地。这期间 update 里的
   * 任何移动输入都会取消它——不出货、不扣时间、不标记已搜/已挖。
   */
  private beginPendingAction(action: {
    kind: 'container' | 'bunk' | 'dig';
    containerId?: string;
    bunkId?: string;
    obstacleX?: number;
    atX: number;
    busyHint: string;
    cancelHint: string;
    ms?: number;
  }): void {
    if (this.pendingAction) this.cancelPendingAction(true);
    const ms = action.ms ?? (action.kind === 'dig' ? OBSTACLE_DIG_MS : SEARCH_MS);
    // 走位订单作废：动作期间不接受点击挪步（新的移动输入照样会在下一帧取消它）。
    this.walkTarget = null;
    this.playActionAnim(searchAnimKey('player'), ms);
    const entry = {
      kind: action.kind,
      floor: getGame().currentFloor,
      containerId: action.containerId,
      bunkId: action.bunkId,
      obstacleX: action.obstacleX,
      atX: action.atX,
      busyHint: action.busyHint,
      cancelHint: action.cancelHint,
      until: this.time.now + ms,
      timer: undefined as unknown as Phaser.Time.TimerEvent,
    };
    this.pendingAction = entry;
    entry.timer = this.time.delayedCall(ms, () => {
      // 身份比对：被取消过的动作（或换层后重建的名册）不会落地。
      if (this.pendingAction === entry) this.finishPendingAction();
    });
  }

  /** 收手：摘 timer、清动作态、给一句反馈（silent = 换层/重启时的静默清理）。 */
  private cancelPendingAction(silent = false): void {
    const action = this.pendingAction;
    if (!action) return;
    action.timer.remove(false);
    this.pendingAction = undefined;
    this.walkTarget = null;
    if (!silent) this.flash(action.cancelHint);
  }

  /** 到点落地：先对楼层（换层/换场景就地作废），再按 kind 分派。 */
  private finishPendingAction(): void {
    const action = this.pendingAction;
    if (!action) return;
    this.pendingAction = undefined;
    if (action.floor !== getGame().currentFloor) return;
    if (action.kind === 'container' && action.containerId) this.finishContainerSearch(action.containerId);
    else if (action.kind === 'bunk' && action.bunkId) this.finishBunkSearch(action.bunkId, action.atX);
    else if (action.kind === 'dig' && action.obstacleX !== undefined) this.finishObstacleDig(action.obstacleX);
  }

  // ── AG-66：过道阻碍物 ───────────────────────────────────────────────
  /** 本层阻碍物全集 + 未挖列表（seeded；drawFloor 与清障后各刷一次）。 */
  private refreshFloorObstacles(): void {
    const state = getGame();
    const floor = state.currentFloor;
    this.floorObstacles = obstaclesForFloor(state, floor);
    this.activeObstacleList = this.floorObstacles.filter((o) => !isObstacleCleared(state, floor, o.x));
  }

  /** 交互距离内最近的未挖阻碍物（与 nearestContainer 同型）。 */
  private nearestObstacle(): FloorObstacle | null {
    return nearestObstacle(this.activeObstacleList, getGame().player.x, INTERACT_DISTANCE);
  }

  /** 阻碍物提示：有工具说「按 E 挖」，没工具说缺什么——与 E 的实际行为同源。 */
  private obstacleHint(o: FloorObstacle): string {
    const armed = obstacleTool(getGame().player.inventory) !== null;
    if (o.kind === 'rubble') return armed ? '按 E 挖开这堆瓦砾' : '需要铲子才能挖开这堆瓦砾（撬棍也行）';
    return armed ? '按 E 撬开这道闸门' : '需要铲子或撬棍才能撬开这道闸门';
  }

  /** 画本层阻碍物（含挖过的残骸）。程序化 Graphics，16 色板内，不新增贴图。 */
  private buildObstacles(): void {
    this.refreshFloorObstacles();
    const state = getGame();
    for (const o of this.floorObstacles) {
      // ACTOR_DEPTH（5），不是默认的 0。阻碍物是玩家要贴着按 E 的实体，必须
      // 画在家具层之上：2 层前排室友床铺在 depth 4，默认 0 的瓦砾整堆被床
      // 压住——玩家看见的是床，不知道墙边有一堆该挖的东西（QA-3 收官判定的
      // 视觉洞，AG-96 上线即有）。选演员层而不是随手一个 >4 的数：与角色、
      // 怪物同一平面，玩家（同层且后插入）照旧画在瓦砾边上；头顶的灯光
      // （LIGHT_DEPTH 24）、前景剪影（26）、飘字（29）与 HUD（100+）都在
      // 其上，相对关系一概不动。挖掉后的残骸用同一个对象重画，depth 不变。
      const g = this.add.graphics().setDepth(ACTOR_DEPTH);
      this.drawObstacle(g, o, isObstacleCleared(state, state.currentFloor, o.x));
      this.obstacleObjs.set(`${o.x}`, g);
      this.floorObjects.push(g);
    }
  }

  /**
   * 一个阻碍物的画法。瓦砾堆 = 乱石坡（顶面受光、坡脚积尘）；锈闸门 = 石立柱 +
   * 锈红顶轨 + 斜拉铁丝网。挖过之后同一位址重画成残骸：瓦砾压成矮茬、闸门剩
   * 一根歪柱几根断丝——还看得出动过土，但不再拦路（cleared 时 activeObstacleList
   * 已不含它，钳位自然放行）。
   */
  private drawObstacle(g: Phaser.GameObjects.Graphics, o: FloorObstacle, cleared: boolean): void {
    g.clear();
    const floorY = FLOOR_HEIGHT - FLOOR_BAND;
    if (o.kind === 'rubble') {
      if (cleared) {
        // 残骸：一层矮茬，尘色半透明。
        g.fillStyle(PALETTE.shadow, 0.5);
        g.fillRect(o.x - 26, floorY - 6, 52, 6);
        g.fillStyle(PALETTE.dust, 0.55);
        g.fillRect(o.x - 18, floorY - 11, 30, 5);
        g.fillRect(o.x + 6, floorY - 8, 16, 3);
        g.fillStyle(PALETTE.stone, 0.5);
        g.fillRect(o.x - 8, floorY - 15, 12, 4);
        return;
      }
      // 三五大石挤在过道中间：主石两块、配石一块，顶面一道受光。
      g.fillStyle(PALETTE.shadow, 0.9);
      g.fillRect(o.x - 24, floorY - 4, 48, 4);
      g.fillStyle(PALETTE.stone, 1);
      g.fillTriangle(o.x - 22, floorY, o.x - 12, floorY - 24, o.x - 2, floorY);
      g.fillStyle(PALETTE.stoneLight, 1);
      g.fillTriangle(o.x - 19, floorY, o.x - 12, floorY - 24, o.x - 8, floorY);
      g.fillStyle(PALETTE.stone, 1);
      g.fillTriangle(o.x - 4, floorY, o.x + 6, floorY - 30, o.x + 16, floorY);
      g.fillStyle(PALETTE.stoneLight, 1);
      g.fillTriangle(o.x - 1, floorY, o.x + 6, floorY - 30, o.x + 9, floorY);
      g.fillStyle(PALETTE.stone, 1);
      g.fillTriangle(o.x + 12, floorY, o.x + 20, floorY - 16, o.x + 26, floorY);
      g.fillStyle(PALETTE.dust, 0.85);
      g.fillRect(o.x - 26, floorY - 2, 54, 2);
      g.fillRect(o.x - 10, floorY - 34, 3, 3);
      g.fillRect(o.x + 14, floorY - 20, 2, 2);
      return;
    }
    if (cleared) {
      // 残骸：一根歪柱 + 几根耷拉的断丝。
      g.fillStyle(PALETTE.stone, 0.8);
      g.fillRect(o.x - 20, floorY - 30, 5, 30);
      g.fillStyle(PALETTE.lightDeep, 0.7);
      g.fillRect(o.x - 20, floorY - 30, 5, 4);
      g.lineStyle(1, PALETTE.stoneLight, 0.5);
      g.lineBetween(o.x - 15, floorY - 18, o.x + 4, floorY - 6);
      g.lineBetween(o.x - 15, floorY - 26, o.x + 2, floorY - 14);
      g.lineStyle(1, PALETTE.dust, 0.4);
      g.lineBetween(o.x + 2, floorY - 6, o.x + 10, floorY);
      return;
    }
    // 完好的锈闸门：凹槽里立两根石柱，顶轨锈红，中间斜拉铁丝网。
    g.fillStyle(PALETTE.ink, 0.85);
    g.fillRect(o.x - 26, floorY - 56, 52, 56);
    g.fillStyle(PALETTE.stone, 1);
    g.fillRect(o.x - 22, floorY - 52, 6, 52);
    g.fillRect(o.x + 16, floorY - 52, 6, 52);
    g.fillStyle(PALETTE.stoneLight, 1);
    g.fillRect(o.x - 22, floorY - 52, 2, 52);
    g.fillRect(o.x + 16, floorY - 52, 2, 52);
    g.fillStyle(PALETTE.lightDeep, 1);
    g.fillRect(o.x - 24, floorY - 58, 48, 6);
    g.fillStyle(PALETTE.light, 0.9);
    g.fillRect(o.x - 24, floorY - 58, 48, 2);
    g.lineStyle(1, PALETTE.stoneLight, 0.65);
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      g.lineBetween(o.x - 16 + t * 32, floorY - 52, o.x - 16 + t * 32 + 10, floorY - 4);
    }
    g.lineBetween(o.x - 16, floorY - 28, o.x + 16, floorY - 28);
    g.fillStyle(PALETTE.lightDeep, 0.8);
    g.fillRect(o.x - 8, floorY - 46, 4, 3);
    g.fillRect(o.x + 4, floorY - 18, 3, 4);
  }

  /** E 对准阻碍物：没工具说缺什么；有工具就起 2s 挖掘动作。 */
  private tryClearObstacle(o: FloorObstacle): void {
    const state = getGame();
    if (isObstacleCleared(state, state.currentFloor, o.x)) return;
    if (!obstacleTool(state.player.inventory)) {
      this.flash(this.obstacleHint(o));
      return;
    }
    this.beginPendingAction({
      kind: 'dig',
      obstacleX: o.x,
      atX: o.x,
      busyHint: o.kind === 'rubble' ? '挖开瓦砾中……' : '撬开闸门中……',
      cancelHint: '你停了下来，还没挖完',
      ms: OBSTACLE_DIG_MS,
    });
  }

  /** 2s 到点：阻碍物消失（变残骸）、过道通、记存档键（回层不复活）。 */
  private finishObstacleDig(x: number): void {
    const state = getGame();
    if (isObstacleCleared(state, state.currentFloor, x)) return;
    clearObstacle(state, state.currentFloor, x);
    bumpStat(state, 'obstaclesCleared'); // AG-81：清障计数
    saveToStorage(state);
    this.refreshFloorObstacles();
    const o = this.floorObstacles.find((ob) => ob.x === x);
    const obj = this.obstacleObjs.get(`${x}`);
    if (o && obj) this.drawObstacle(obj, o, true);
    playFx(this, 'collect-burst', x, PLAYER_FEET_Y - 30, LIGHT_DEPTH);
    playSfx('chest');
    this.flash(o?.kind === 'gate' ? '撬开了锈闸门，过道通了' : '挖开了瓦砾堆，过道通了');
    this.chargeTime(OBSTACLE_DIG_COST_MINUTES);
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
    // AG-77：爬塔深度成就（乘电梯跨段时一次点亮途中全部里程碑）。
    this.achievements.emit({ type: 'floor_reached', floor: state.currentFloor });
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
    // 首帧节奏与 updateStairClimb 同源：直梯 1.0 / 阶梯 1.25（AG-53 pose）。
    this.player.anims.timeScale = stairClimbPose(getGame().currentFloor, traversal, 0).animTimeScale;
    this.flash(direction === 1 ? '沿楼梯上行……' : '沿楼梯下行……');
  }

  /** Advance the visible stair traversal; floor state changes only at 100%. */
  private updateStairClimb(delta: number): void {
    const climb = this.stairClimb;
    if (!climb) return;
    climb.elapsedMs = Math.min(climb.durationMs, climb.elapsedMs + Math.max(0, delta));
    // AG-53 的爬梯曲线（stairClimbPose）：阶梯是一级一级踩上去的（y 逐级
    // ease、x 线性过踏面，折返处 faceX 转身），直梯是一条垂线。节奏也由
    // pose 给——阶梯 1.25、直梯 1.0，200px/s 的垂直速度配 1.25 会像 frantic
    // scrabbling。floor 传出发层（落地前 currentFloor 不变），与 drawStairwell
    // 的样式分派同一口径。
    const pose = stairClimbPose(getGame().currentFloor, climb, climb.elapsedMs);
    this.player.setPosition(pose.x, pose.y);
    this.player.setFlipX(pose.faceX < 0);
    this.player.anims.timeScale = pose.animTimeScale;
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
    // 裁决记录（merge ag-81）：AG-77 的成就事件与 AG-81 的统计记账是两套
    // 不同消费者的记录（成就判定 vs 本局统计/跨局纪录），并存。
    // AG-77：爬塔深度成就（楼梯落地与乘电梯同一口径）。
    this.achievements.emit({ type: 'floor_reached', floor: state.currentFloor });
    bumpStat(state, 'floorsClimbed'); // AG-81：爬梯次数（成功落地才算）
    noteFloorReached(state); // AG-81：最高层取历址最大（下楼不走低）
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

  // ── AG-80: 性能层的 PerfHost 场景查询面（RC-03 拆分第 4 步） ────────────
  // 上架承诺「低端机不炸」的落点——飘字池/帧预算守卫/FPS 计数器/降级边沿
  // 四件已迁入 controllers/PerfController.ts（本类只持控制器本体）。这里
  // 留三个第一参钉死 Phaser.Scene 的薄封装（与 framedButton 同款路数）：
  // 运行期 host 就是本场景，Node 单测由假件实现同一结构面。

  /** 新建飘字池：FloatTextPool 的第一参钉死 Phaser.Scene（运行期就是本场景）。 */
  createFloatTextPool(depth: number): FloatTextPool {
    return new FloatTextPool(this, { depth });
  }

  /** 降级边沿的粒子总闸：fx.ts setFxDegraded 的场景薄封装（场景自身入册）。 */
  setFxDegraded(on: boolean): void {
    setFxDegraded(this, on);
  }

  /** 降级边沿的敌人待机呼吸停帧（RC-03 第 7 步：战斗舞台归 CombatController，
   *  本薄封装转委托；无战斗时 no-op）。 */
  setMonsterBreathing(on: boolean): void {
    this.combat.setBreathing(on);
  }

  // ── CombatHost 面（RC-03 拆分第 7 步：回合制战斗） ─────────────────────
  // 战斗状态机/舞台/回合编排/juice/战斗 UI 五件全在 CombatController（plain
  // TS 类，Node 可单测），运行期拿场景当 host。下面这些是控制器要用而场景
  // 已有的实现——与 MonologueHost/StatsPanelHost/PerfHost 同款纪律：控制器
  // 不 import 场景类型，可测性靠这层结构面（单测用假件实现）。原战斗段
  // （GameScene.ts 2642-3347 + juice 段）整体迁入 controllers/
  // CombatController.ts，行为零变更。

  // ── Phaser 单子（结构面，控制器不 import 场景类型）──

  /** 挥击弧（战斗反馈与单 roll 遭遇共用；原战斗段随 CombatController 迁出，
   *  与世界链共用的这份留在场景）。public：CombatHost 面之一。 */
  playSwingFx(killed = false): void {
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

  /** AG-80：战斗飘字入口（combatFloatText 的下游）：掉血/未命中/反击/行为
   *  标签都走这。public：CombatHost 面之一——PerfController 的池由场景这层
   *  薄封装注入（第 4 步留的面）。 */
  spawnFloatText(x: number, y: number, text: string, color: string): void {
    this.perf.spawnFloatText(x, y, text, color);
  }

  /** 敌人剪影装配：render/monsterArt createMonsterView 的场景薄封装。 */
  createMonsterView(opts: MonsterViewOptions): MonsterView {
    return createMonsterView(this, opts);
  }

  /** 头顶名签装配：render/monsterArt createHeadTag 的场景薄封装。 */
  createHeadTag(opts: HeadTagOptions): HeadTag {
    return createHeadTag(this, opts);
  }

  /** 粒子特效：render/fx.ts playFx 的场景薄封装（降级时返回 null）。 */
  playFx(id: string, x: number, y: number, depth: number, opts?: { scale?: number; timeScale?: number }): Phaser.GameObjects.Sprite | null {
    return playFx(this, id, x, y, depth, opts);
  }

  /** 世界空间点击热区（hitRect 原样，不锁屏）——敌人剪影上的「点击攻击」。 */
  worldHitRect(
    x: number,
    y: number,
    w: number,
    h: number,
    depth: number,
    handlers: Parameters<typeof hitRect>[6],
  ): Phaser.GameObjects.Rectangle {
    return hitRect(this, x, y, w, h, depth, handlers);
  }

  // ── 战斗编排要用的场景能力（playerSprite/floorWidth/shopSpotX 是本段新面；
  //    syncPlayerWorldObjects/panelHit/refreshStats/playActionAnim 四件是世界
  //    链共用的既有实现，在原位置转 public——实现不搬家，只加 host 注释）──

  /** 玩家 sprite——滑步/面朝/格挡压缩/头顶名签钉点/震屏锚点都读它。 */
  playerSprite(): Phaser.GameObjects.Sprite {
    return this.player;
  }

  /** 当前层宽（floorWidthFor 的结果，每层重建时更新）。 */
  floorWidth(): number {
    return this.floorW;
  }

  /** 行商问号点的 x（敌人站位避让用；没有则 undefined）。 */
  shopSpotX(): number | undefined {
    return this.spotMarkers.get('shop')?.x;
  }

  // ── 场景状态与回写 ──

  /** 面板槽布尔（战斗/商店/遭遇共用同一个 encounterOpen）。 */
  setEncounterOpen(open: boolean): void {
    this.encounterOpen = open;
  }

  /** 世界回写：问号点按战斗结果重建（胜/怯战消失，撤退保留）。 */
  rebuildEncounterSpots(): void {
    this.buildEncounterSpots();
  }

  /** 切结局卡（玩家阵亡，die clip 播完）。 */
  startEndScene(): void {
    this.scene.start('End');
  }

  // ── AG-77 成就三件 + 战利品账（本场受伤计数在 AchievementController，
  //    场景留 CombatHost 薄封装）──

  /** 本场受伤计数归零（开战）。 */
  resetCombatDamage(): void {
    this.achievements.resetCombatDamage();
  }

  /** 本场受伤计数累加（偷袭/反击命中）。 */
  noteCombatDamage(damage: number): void {
    this.achievements.noteCombatDamage(damage);
  }

  /** 本场累计受伤（boss_won 成就判据）。 */
  combatDamageTaken(): number {
    return this.achievements.combatDamage;
  }

  /** 零伤害击败守门人的成就发射。 */
  emitBossWon(damageTaken: number): void {
    this.achievements.emit({ type: 'boss_won', damageTaken });
  }

  /** 战利品计数进「本次出行」账（EndScene 结算读）。 */
  addLootThisTrip(quantity: number): void {
    this.lootThisTrip += quantity;
  }

  /** 面板对象列表（clearStrayPanels 恢复路径要看得见战斗面板件）。 */
  combatPanelObjects(): ReadonlyArray<Phaser.GameObjects.GameObject> {
    return this.combat.panelObjectsForRecovery();
  }

  // ── juice 强度总闸的场景事件订阅（Phaser 场景事件常量留在场景侧，
  //    控制器不 import Phaser 值）──

  /** 订阅场景 RESUME（从设置场景返回时重读震屏总闸）。 */
  onSceneResume(handler: () => void): void {
    this.events.on(Phaser.Scenes.Events.RESUME, handler);
  }

  /** 退订场景 RESUME（SHUTDOWN 清理时）。 */
  offSceneResume(handler: () => void): void {
    this.events.off(Phaser.Scenes.Events.RESUME, handler);
  }

  /** 订阅场景 SHUTDOWN（一次性的 juice 订阅清理）。 */
  onceSceneShutdown(handler: () => void): void {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, handler);
  }

  // ── AG-91 取证面：juice 状态机本体（e2e/ag91-juice.spec.ts 的逐帧记录器
  //    读 scene.juice——迁移前它是场景字段，现在留只读委托，契约不变、
  //    探针无感）。 ──
  get juice(): JuiceState {
    return this.combat.juiceState;
  }

  // ── DialogueHost 面（RC-03 拆分第 8 步：NPC 对话/行商/产业/AI NPC） ──────
  // 其余面（add/tweens/time 三单子 + panelHit/playFx/viewSize/setPanelBox/
  // setEncounterOpen/rebuildEncounterSpots/refreshStats/refreshInventory/
  // flash/chargeTime/onUse/assertPanelContent）由场景已有实现满足——与方法
  // 上方逐条的 public 注释同款纪律：一个方法满足两个接口，不写第二份。

  /** AG-77：全 NPC 对话成就发射（每位只认第一次开口）。 */
  emitNpcTalked(npcId: NpcId): void {
    this.achievements.emit({ type: 'npc_talked', npcId });
  }

  /** 选项箭头标记（render/panels createMarker）——对话光标与产业光标各一支，
   *  场景重启时由 dialogueCtl.reset() 经这支工厂重建。 */
  createMarker(): Phaser.GameObjects.Image {
    return createMarker(this);
  }

  // ── e2e 契约面：对话运行时快照 ─────────────────────────────────────────
  // spark.spec.ts 直读 scene.getScene('Game')?.dialogue（{message, sessionId}
  // 或 null）——迁移前它是场景字段，现在留只读委托 DialogueController 的
  // dialogueSnapshot()，契约不变、e2e 零改动（AG-41 的保鲜/降级三条断言
  // 全部走这个读数）。与 juice getter 同款路数。
  get dialogue(): { message: string; sessionId: number } | null {
    return this.dialogueCtl.dialogueSnapshot();
  }

  // ── frame ──────────────────────────────────────────────────────────────
  override update(_time: number, delta: number): void {
    // AG-71（RC-03 第 6 步）：导航条先刷，放在每个早退之前——面板的布尔在
    // 帧间被键盘/鼠标改写，而世界模拟段会因它们整段跳过，所以这里是唯一能
    // 让高亮与 contextual 槽在面板（或攀爬）占用屏幕时保持更新的地方。
    this.navBar.refresh();
    // AG-73：教程 tick 紧跟导航条——它推进步骤、按步骤重画高亮，而导航条的
    // contextual 分支要读教程状态，放这里是唯一两边都看得见的位置（面板/爬梯
    // 的早退都在更后面，教程因此在那些状态下也照常推进）。
    this.tutorial.tick();
    this.hud.refreshBagFullWarning();
    // AG-74：音乐上下文同步与导航条同款理由放在所有早退之前——入夜氛围、
    // 电台到期都不该因为背包开着而停更（战斗/撤退的显式切换在各自事件处）。
    syncMusic(getGame());
    // AG-77：toast 的出票与退场必须在面板早退之前——解锁可能发生在任何面板
    // 开着的时候（制作面板里做出第一件武器），那时世界模拟整段被跳过。
    this.achievements.update();
    // AG-26 / RC-01：统一触发器求值接线（AG-26 实现说明留给总控的那一处）。
    // triggers 模块的 import 副作用已完成启动注册；这里每帧求值，把「本 run
    // 曾经如此」的一次性事实（ev:*/st:*/goal:met/combat:active/stat:*/
    // tier:*:arrived/npc:*:regular）写进 flags。evaluateTriggers 只置不清、
    // 只写 flags 不碰任何存量字段（e2e/triggers.spec.ts 钉死字节级不变），
    // 所以这行不改变任何既有行为——它让旗成为活的查询与存档事实，供任务/
    // 对话/日记条件与「第一次发生时的一次性反应」查。
    // 放在所有面板早退之前：战斗开打、背包塞满、目标达标都可能发生在面板里。
    // 与自言自语（tickMonologue）的分界：那边是边沿事件（可重复、带冷却、
    // 出气泡），旗装不下「又掉一次」——latch 与 edge 是两类问题，见
    // src/systems/triggers.ts 文件头与 src/tests/triggers.test.ts 的钉法。
    if (hasGame()) evaluateTriggers(getGame());
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
    // AG-80：帧预算守卫在每个早退分支之前喂样——爬梯、面板、战斗全程覆盖。
    // RC-03 第 4 步：控制器 tick 一行（编排：喂守卫 + 计数器节流刷新）。
    this.perf.tick(delta);
    // AG-91：juice 层 tick（真实时间衰减 + 写相机 offset）同样在所有早退之前；
    // 顿帧闸门只冻模拟——上面的导航条/教程/toast/呼吸/武器同步都是 UI 与
    // 演出，照常走真实时间（spec：冻结期只冻模拟）。
    // RC-03 拆分第 7 步：updateJuice 本体在 CombatController（tick 同名）。
    if (this.combat.tick(delta)) return;
    if (this.stairClimb) {
      this.updateStairClimb(delta);
      return;
    }
    // AG-70：战斗舞台的世界坐标元素（双方头顶名签）每帧钉在角色身上——
    // 面板早退之后世界模拟整段不跑，滑步途中的名签跟随在这里补。敌人剪影
    // 的呼吸/击退/前冲都是 MonsterView 自己的 tween，无需每帧驱动。
    // RC-03 拆分第 7 步：syncCombatStage 本体在 CombatController（syncStage）。
    if (this.encounterOpen) this.combat.syncStage();
    // 裁决记录（merge ag-63）：采纳 ag-63 的根因修复——面板提示刷新挪到
    // 面板早退之前。HEAD 侧没有这段（面板提示块在 update 后半的世界链开
    // 头，永远执行不到），AG-70 的 syncCombatStage 行保留；早退行取 HEAD 版
    // （比 ag-63 侧多 nightChoiceOpen，AG-72 夜间选择面板的新成员）。
    // AG-63: THE FOOT BAR USED TO FREEZE FOR THE WHOLE FIGHT. update()
    // early-returns on encounterOpen — a panel owns the keyboard — and the
    // hint chain, the only caller of openPanelHint(), sat BELOW that return.
    // So the "a panel owns the bar" contract had never once executed: the
    // player opened an ambush standing on a question mark and the foot bar
    // read 「按 E 查看问号点」 for the entire fight. That is exactly what the
    // user asked to be fixed — 「我们对打的时候我需要看到我们的页面然后左下
    // 角提示那啥用什么来攻击等等」. The panel hint is refreshed above the
    // freeze now; the world chain below still owns the bar whenever no panel
    // is up (openPanelHint returns null then, so the two cannot fight).
    const panelHint = this.openPanelHint();
    if (panelHint !== null) this.hintText.setText(panelHint);
    if (this.hud.isOpen || this.craftingOpen || this.dialogueCtl.isOpen || this.pauseOpen || this.encounterOpen || this.shelterOpen || this.nightChoiceOpen || this.dialogueCtl.ventureIsOpen || this.questsOpen) return;
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
    // AG-50：Shift 按住 = 跑。键盘路径选 Shift+方向键而不是双击方向键：双击
    // 会和「按住方向键取消 walkTarget」的既定规则打架（第二下要么取消订单
    // 要么触发跑，语义重叠），Shift 则是「更快变体」的通用修饰键，与鼠标
    // 双击跑、Shift+单击跑共用同一个 runSpeedMultiplier。
    const shiftRun = this.keyShift?.isDown === true;
    // AG-66：搜刮/挖掘进行中——任何移动输入（方向键或点击走位订单）都取消
    // 动作：不出货、不扣时间、不标记已搜/已挖。这是「防站着刷」的闸口：想拿
    // 东西就得老老实实站完 2s。没有输入则到点落地。
    if (this.pendingAction) {
      if (dir !== 0 || this.walkTarget) {
        this.cancelPendingAction();
      } else if (this.time.now >= this.pendingAction.until) {
        this.finishPendingAction();
        return;
      }
    }
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
    // 跑单生效：走单自带 run 标记（双击/Shift+单击下的单）或 Shift+方向键。
    // 倍率作用在斜坡的目标速度上——先把当前速度折算回步速空间再 ramp：起步
    // 是从当前真实速度连续加速（跑有「起步重量」），而不是 130→260 瞬跳。
    const runScale = (shiftRun || this.walkTarget?.run === true) && dir !== 0 ? MOVEMENT_BALANCE.runSpeedMultiplier : 1;
    // The speed is ramped rather than switched, so a tap of the key moves a
    // shorter distance than it used to and the run feels like it has weight.
    // OVERHAUL: an empty energy tank slows the walk (0.75x), so "how far can I
    // get" is budgeted by food and rest. Wave B3's swift-feet relic then makes
    // the corridors 15% shorter. The factors apply to the ramped speed, not to
    // dx, so the anim's speedFraction follows the real walk.
    let rampSpeed = this.speedX / runScale;
    // 松跑回落：stepHorizontalSpeed 只在与目标同向时把速度钳到目标——松跑
    // 那一帧会把 260 瞬按回 130。这里整段接管：超出步速的部分按刹车率衰减，
    // 衰减期间不碰斜坡，落回步速后才交还。松跑也是「刹住」，与起步的加速
    // 对偶；反向仍然走 stepHorizontalSpeed 自己的刹车率。
    let stepped: number;
    if (runScale === 1 && dir !== 0 && Math.abs(rampSpeed) > PLAYER_SPEED) {
      const decay = PLAYER_DECELERATION * (delta / 1000);
      stepped = Math.sign(rampSpeed) * Math.max(PLAYER_SPEED, Math.abs(rampSpeed) - decay);
    } else {
      stepped = stepHorizontalSpeed(rampSpeed, dir, delta);
    }
    this.speedX = stepped * runScale * moveSpeedFactor(state.player) * moveSpeedMult(state.relics ?? []);
    const dx = this.speedX * (delta / 1000);
    if (dx !== 0) {
      const prevX = state.player.x;
      movePlayerX(state, dx);
      // AG-66：过道阻碍物把玩家钳在占位区之外——贴着进来那一侧的边停，
      // 想过去只能把它挖掉。上一帧就在区间里（落地/传送）则取近的一侧出。
      state.player.x = clampXAgainstObstacles(this.activeObstacleList, prevX, state.player.x);
    }
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
      const moving = speedFraction > 0.03;
      const runActive = moving && runScale > 1;
      // AG-50：跑动画。素材库没有对齐规格的跑 GIF（用户记忆里的那份在
      // F:/new/floor100000_final_character_gifs_v1.zip，但 217-230 色 vs 项目
      // 16 色板、帧数不一致，README 自述不能直接替换），所以 AG-55 让跑派生
      // 自 walk：run-{who} 与 walk-{who} 同帧、帧率 ×1.6。这里按当前角色取
      // key（与 changeFloor/NPC 同步同一口径），注册表里没有就回退 walk。
      const who = this.metaSelectedCharacter();
      const runKey = runAnimKey(who);
      const want = moving ? (runActive && this.anims.exists(runKey) ? runKey : walkAnimKey(who)) : idleAnimKey(who);
      if (this.player.anims.currentAnim?.key !== want) this.player.play(want, true);
      // AG-90：GIF 待机按自带节奏播（1000ms/帧）——0.2 的底线是行走防滑步
      // 的减速，待机不涉速；未接 GIF 的五名角色维持原速。行走段不变。
      this.player.anims.timeScale =
        runActive
          ? MOVEMENT_BALANCE.runAnimTimeScale
          : moving || !isCharAnimBacked(this, want)
            ? Math.max(0.2, Math.min(1, speedFraction))
            : 1;
    }

    // AG-20: 帧循环跨日时产业结算在 advanceTime 内部发生。前后对比账本，
    // 当日收益/倒塌变成面板读数与一条 flash（只观察，不重复结算——水位
    // 标记 economy:settled-day 仍是结算的唯一把关）。
    const ledger = state.growth?.ventures?.length ? this.dialogueCtl.ventureLedgerSnapshot() : null;
    const tick = advanceTime(state, delta);
    if (ledger) this.dialogueCtl.diffVentureLedger(ledger);
    const rolled = ensureNightEvent(state);
    if (rolled.rolled && rolled.event) {
      if (rolled.event.type === 'wanderer') playSfx('danger');
      this.flash(rolled.event.message);
    }
    // AG-64：入夜二选一 + 一夜的偷取后台模拟。
    //
    // 时机（用户 2026-11-17 原话：「晚上的话应该会提示我们是出去找物资还是
    // 在家里守夜」）：帧循环把时钟推过 18:00 的那一帧、且人身在外层时弹一次。
    // 两个刻意的收窄：
    //   1. 只有「推过」算入夜——e2e 直接设 gameMinuteOfDay 的时钟跳变
    //      （tick.gameMinutes 远小于时钟位移）不算，否则设过夜时钟的既有
    //      测试会被弹面板；
    //   2. 只在外层算数——在家入夜的玩家走既有的床 → 夜间安排流程
    //      （AG-51/shelter 钉住的行为原样），面对二选一的是身在外层的人。
    const minuteBeforeNight = this.prevMinuteOfDay;
    this.prevMinuteOfDay = state.gameMinuteOfDay;
    if (
      minuteBeforeNight !== null &&
      !isNight(minuteBeforeNight) &&
      isNight(state.gameMinuteOfDay) &&
      state.gameMinuteOfDay - minuteBeforeNight <= tick.gameMinutes + 0.01 &&
      state.currentFloor !== STARTING_FLOOR &&
      nightChoicePending(state)
    ) {
      this.openNightPrompt();
    }
    this.tickNightWatch();
    // AG-77：跨天结算「连续不缺水」。不走 tick.dayChanged 而对比 state.day——
    // 睡觉（ShelterSystem.finishNight）也跨天，那条路不经过这里的帧循环
    // tick。flag 记的是刚过去这一天有没有见底，随后清零（对账在控制器内）。
    this.achievements.noteDay(state.day);
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
    this.hud.setVignettePulse(pulse);
    // STARVING AND PARCHED, ON THE BODY. Hunger and thirst were two numbers in
    // the HUD; the debuff is now on the survivor. The threshold is the same 25%
    // the HUD already uses to call a stat urgent (URGENT_THRESHOLDS in
    // render/feedback.ts), so the body and the interface never disagree about
    // whether the player is in trouble.
    // 裁决记录（merge ag-77）：保留 HEAD 的 hungry/parched 拆分与 debuffFx
    // 陈旧引用修复（ag-63 边沿 flash 依赖 hungry/parched 两个布尔），ag-77 的
    // thirstHitZero 记账行并入。
    const hungry = state.player.hunger <= GAME_CONFIG.player.hungerMax * 0.25;
    const parched = state.player.thirst <= GAME_CONFIG.player.thirstMax * 0.25;
    // AG-77：口渴见顶即记账（thirstStreak 的「当天缺水」判据，账在控制器）。
    // 零也要算——归零那一帧就是见底，等它反弹就晚了。
    if (state.player.thirst <= 0) this.achievements.noteThirstZero();
    const starving = hungry || parched;
    // A sprite left over from a previous scene is not a live fx: Phaser clears
    // .scene on destroy(). Treat it as absent — the old code quietly dropped
    // the glow for the rest of a reloaded run — and re-arm the announcement,
    // because re-entering a run while still starving is a new session's news.
    if (this.debuffFx && !this.debuffFx.scene) {
      this.debuffFx = undefined;
      this.debuffAnnounced = false;
    }
    if (starving && !this.debuffFx) {
      const fx = startFxLoop(this, 'poisoned', state.player.x, PLAYER_FEET_Y - 46, LIGHT_DEPTH + 1);
      if (fx) this.debuffFx = fx;
    } else if (!starving && this.debuffFx) {
      this.debuffFx.destroy();
      this.debuffFx = undefined;
    } else if (this.debuffFx) {
      this.debuffFx.x = state.player.x;
    }
    // THE GREEN GLOW HAD NO NAME. The user filed it as a bug: "这个绿色的我
    // 不知道是什么好像是 Bug". It is the designed debuff visualisation, kept
    // as-is; what was missing is the interface telling the player what it
    // means. So the crossing announces itself — once in, once out, on the edge
    // and never per frame — and a standing marker sits above the foot bar for
    // as long as it lasts.
    if (starving !== this.debuffAnnounced) {
      this.debuffAnnounced = starving;
      this.flash(starving ? debuffEnterMessage(hungry, parched) : DEBUFF_CLEARED_MESSAGE);
    }
    // AG-63：常驻标记的绘制在 HudController（第 9 步）——世界链判饿渴，
    // hud.setDebuffMark 只画（null = 隐藏），按值缓存没变不碰对象。
    this.hud.setDebuffMark(starving ? debuffMarkLabel(hungry, parched) : null);
    // Read after ensureNightEvent so an event rolled this very frame counts.
    const event = state.worldEvents.activeEvent;
    this.hud.refreshClock();
    this.hud.refreshStats();
    this.hud.refreshEnvironmentHud();
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
      // （AG-90：倒地动画换成 GIF 后是 3x900ms=2700ms，切场的 delayedCall
      // 跟着拉到 GIF 总时长+100ms，否则结局卡会在倒地第一帧就顶掉它。）
      if (tick.died) {
        bumpStat(state, 'deaths'); // AG-81：帧循环里的死亡（饥渴/体温/伤势）
        const dieKey = dieAnimKey(this.metaSelectedCharacter());
        this.playActionAnim(dieKey, 520);
        this.time.delayedCall(charAnimHoldMs(dieKey, 520) + 100, () => {
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
        const dieKey = dieAnimKey(this.metaSelectedCharacter());
        this.playActionAnim(dieKey, 520);
        this.time.delayedCall(charAnimHoldMs(dieKey, 520) + 100, () => {
          if (this.scene.isActive()) this.scene.start('End');
        });
        return;
      }
      this.scene.start('End');
      return;
    }

    this.autoPickup();

    // 裁决记录（merge ag-63）：HEAD 侧此处的 panelHint 块（OVERHAUL 交互
    // 契约）删除——它位于面板早退之后，按构造执行不到，功能已由早退前的
    // 刷新段覆盖（见上文 update 早退区）；AG-66 的 pendingAction/obstacle
    // 两段保留，ag-63 的注释沿用。
    // AG-63: a panel's keys were already printed above the freeze (see the
    // panel early-return), and no panel is up here by construction — so this
    // chain is the world's again, and it cannot overwrite a panel's hint.
    // AG-66：搜刮/挖掘动作中——底栏只说在干什么，不说周围有什么（面板优先
    // 的契约在上面的 panelHint 段，开着面板时仍旧是面板的话）。
    if (this.pendingAction) {
      this.hintText.setText(this.pendingAction.busyHint);
      return;
    }
    const nearObstacle = this.nearestObstacle();
    // AG-66：阻碍物提示——有工具说「按 E 挖」，没工具说缺什么。与 onInteract
    // 同序（问号点之后、NPC 之前）：被钳在瓦砾上时脚注先说挖开。
    if (nearObstacle) {
      this.hintText.setText(this.obstacleHint(nearObstacle));
      return;
    }
    // AG-51：床铺提示（含自己的床：夜里睡觉/白天翻床垫底下）先于工作台。
    // 两件家具在 1 层东西两端，正常永远不会同时够到，顺序只是保险。
    const bunkLine = this.bunkHint(state);
    if (bunkLine !== null) {
      this.hintText.setText(bunkLine);
      return;
    }
    if (this.nearCraftStation(state)) {
      this.hintText.setText('按 E 制作');
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
    // R6-2：第一分支先分辨最近的遭遇点是不是行商——'shop' 是会走动的行商
    // 标记，按 E 走的是 onInteract 的 openShop（交易面板），与问号遭遇不是
    // 一回事。修前不区分类型，行商走进 44px 交互距离时脚注错显「按 E 查看
    // 问号点」，提示与按 E 实际开的面板不符；现在 shop 说交易，其余遭遇点
    // 维持原文案（e2e/ag63 等对同源文案的注释不受影响——无断言此串）。
    const nearSpot = this.nearestEncounterSpot();
    if (nearSpot === 'shop') this.hintText.setText('按 E 与行商交易');
    else if (nearSpot) this.hintText.setText('按 E 查看问号点');
    // The lift outranks containers on the hint chain. 中产区多个层的容器正好
    // 压在电梯窗上（10004/10005/10006 的安保柜 x=1140、收银台 x=1160，
    // 电梯窗 1135..1195），修前站在电梯口脚注读的是「按 E 打开 安保柜」——
    // 垂直交通是这一层的主通道，脚注必须先说电梯（stairNavigation 下行
    // 50010→50009 基线即红：rideLiftUp 在 10010 读不到电梯脚注）。
    else if (this.nearLift(state)) this.hintText.setText('按 E 乘货运电梯');
    else if (finaleContainer) {
      // AG-20：终局层的容器开过之后，E 进的是演出不是搜刮——提示要说得准。
      // 用不滤空的判定：被舔光的空箱子也要告诉玩家还能再看它一眼。
      this.hintText.setText(this.finaleEntryFor(finaleContainer.id) ? `按 E 查看${finaleContainer.label}` : `按 E 打开 ${finaleContainer.label}`);
    }
    else if (container) this.hintText.setText(`按 E 打开 ${container.label}`);
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
    // AG-71: 默认脚注只剩移动与交互两个键——I/C/G/M/Esc 已经常驻在底部
    // 导航条里，脚注再整串复读只是重复（与 MenuScene 帮助面板同一句）。
    // AG-73：这一串同时是教程的「世界无话可说」判据（WORLD_DEFAULT_HINT），
    // 两边引同一份常量，改台词不会只改一头。
    // RC-02 XP-2：目标干完、离 20:00 入睡门禁还有时间时，空脚注让位给一句
    // 指路（判定与文案在 dailyGoals.idleWindowSuggestion——不动门禁本身）。
    else this.hintText.setText(idleWindowSuggestion(state) ?? WORLD_DEFAULT_HINT);
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
        // AG-104：出口判定按本层实际宽度（this.floorW = floorWidthFor(floor)）——
        // 写死 FLOOR_WIDTH(1280) 时，宽楼右半的撤退者在 x≥1232 就被判「已出场」，
        // 事件提前解除，流浪者瞬移消失。
        const atExit = this.wanderer!.x <= WANDERER_FLEE_EXIT_MARGIN || this.wanderer!.x >= this.floorW - WANDERER_FLEE_EXIT_MARGIN;
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
      bumpStat(state, 'damageTaken', damage); // AG-81：巡游体每口都计数
      this.recordWandererMemory('attack', `巡游体在第${state.currentFloor}层攻击了玩家，造成${damage}点伤害。`);
      inflict(state, 'wound', ai.state === 'lunge' ? 55 : 30, absoluteMinute(state));
      // TWOM 对齐 §2：目睹/遭受袭击掷创伤概率——这是 morale 五机制里的
      // KosovoMoraleTraumaProbability。纯函数内部掷，同 seed 同状态同结果。
      witnessTrauma(state);
      this.refreshStats();
      this.playActionAnim(hurtAnimKey(this.metaSelectedCharacter()), 400);
      // AG-90：动手的也要看得见——巡游体是四个有 GIF 的角色之一，它的
      // attack 图集就播在它自己的 sprite 上（程序化怪物没有 GIF，打击反馈
      // 仍走现有 fx 层）。repeat:0 播完停在末帧，所以到点显式切回 walk，
      // 否则它会保持挥击姿势走完全程。
      this.playWandererAttack();
      playSfx('hurt');
      // AG-91：巡游体击中 = medium 档（震屏 + 50ms 顿帧 + 受击闪白）。原
      // AG-72 的 shakeIfEnabled 与绿色全屏闪（flash(140,230,109,99)）被
      // 分级表取代——全游戏受击反馈同一个入口同一个比例；绿色那抹毒味由
      // ground-slam 特效与 wound debuff 保留，不再靠全屏闪表达。
      // RC-03 拆分第 7 步：impact 入口在 CombatController（juice 层随迁）。
      this.combat.impact('medium', this.player.x, PLAYER_FEET_Y - 48);
      playFx(this, 'ground-slam', state.player.x, PLAYER_FEET_Y - 6, LIGHT_DEPTH);
      this.flash(`被巡游体击中！HP -${damage}，快回宿舍或换层！`);
      if (state.player.hp <= 0) {
        state.status = 'lost';
        bumpStat(state, 'deaths'); // AG-81：巡游体打死
      }
    }
  }
}
