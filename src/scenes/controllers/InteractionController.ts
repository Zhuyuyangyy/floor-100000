// RC-03 拆分第 10 步（设计文档最后一步）：InteractionController——交互逻辑
// 本体。从 GameScene 迁出（原交互段：床铺交互/搜刮挖掘动作/阻碍物/墙饰特写/
// 入夜面板/夜间安排面板/付费捷径/容器邻近判定，共 30 方法 + 12 字段 + 2 模块
// 常量），行为零变更：同一输入路由（E/Enter/Esc/↑↓/L/F/点击的分发骨架留场景，
// 逻辑委托本类）、同一面板装配路径、同一 2s 动作时序（AG-66）、同一冻结面。
//
// 形态（设计文档 §2，沿用前九步的主机结构面模式）：plain TS 类，**不 import
// Phaser 场景类型**——
//   * 构造拿 host（InteractionHost：add/time/cameras 三个 Phaser 单子 +
//     共享件薄封装 + 世界状态读写面——GameScene 天然满足）；
//   * 纯逻辑三件套留原处：搜刮/床铺/阻碍物（systems/LootSystem 的
//     searchBunk/dismantleBunk/obstaclesForFloor/isObstacleCleared/
//     clearObstacle/nearestObstacle/lootContainer/lootGround，
//     obstacles.test.ts/bedAndWorkbench.test.ts 直守）、夜间安排与入夜
//     判定（systems/ShelterSystem/NightSystem，shelter.test.ts/
//     nightChoice.test.ts 直守）、付费捷径计价（systems/shortcut.ts，
//     stairNavigation.spec.ts 直守）——本类只做编排：面板装配、光标窗口、
//     2s 动作起落、交互判定排序；
//   * 共享渲染件第一参钉死 Phaser.Scene 的（buildPanel/buildPanelHeader/
//     buildPanelWell/buildListRow）由 host 结构面 + sharedScene 一次性收窄
//     注入（与 CombatController/DialogueController 同款路数）——运行期 host
//     就是 GameScene 实例，Node 下可用记录型假件单测
//     （src/tests/interactionController.test.ts）；
//   * 显示器持有并管理自己的 GameObjects：夜间安排面板件（shelterObjects）、
//     入夜面板件（nightChoiceObjects）、特写面板件（decoObjects）与两枚
//     光标箭头的生命周期全在本类，GameScene 只留输入分发骨架与委托面。
//
// GameScene 残留面（设计文档原文「输入分发保留在场景」）：
//   * bindInput/unbindInput/guard 的键盘骨架与 onPointerDown 的点击操控留
//     场景（keyL/keyF/Esc/↑↓/E/Enter 各分支委托本类；F 的面板互斥 guard
//     逐字留在场景的 keyF 闭包里——与 E 同一门）；
//   * onEsc/onNavUp/onNavDown/onUse/onInteract 的分发骨架留场景（面板开关
//     读数经本类公开字段：shelterOpen/nightChoiceOpen/decoOpen）；
//   * onUse 的背包分支（useConsumable/useRadioFromSlot，HUD/物品域）与
//     睡觉跨日编排（activateShelterChoice 的 resolved 分支：finishNight +
//     产业账本对比 + 淡入淡出 + 醒来 flash，DialogueController 第 8 步
//     「睡觉跨日留场景」同款先例）留场景，本类经 host.sleepNight() 委托；
//   * 世界对象簿记留场景：bunkObjs（drawBed/drawDormBeds 注册、
//     hasInteractableNear 读取、clearFloor 清空）、floorView/groundObjs
//     （本类经 host 读写）；阻碍物名册与 Graphics 随本类迁（buildObstacles/
//     drawObstacle + 三个字段），但绘制对象统一 push 进场景 floorObjects
//     （host.pushFloorObject）由 clearFloor 批量销毁；
//   * e2e 契约：ag50-control-probe/survivalJourney 直读 scene.pendingAction、
//     ag66/npc/npc-atoms/spark/survivalLoop/split-step8-freeze 直读
//     scene.floorObstacles/activeObstacleList——GameScene 留三个 getter
//     委托本类公开字段，e2e 零改动；ag51 直读的 scene.bunkObjs 是世界对象
//     簿记，本体留场景；
//   * clearStrayPanels 的恢复组合并成 panelObjectsForRecovery()（对话第 8
//     步同款路数；特写面板件不在内——与原清单逐字一致）。
//
// 三条不变量（迁移中逐字保留）：
//   · 2s 动作的身份比对（beginPendingAction 的 delayedCall 落地前比对
//     entry）：换层/取消过的动作不会落地（restartSafe.test.ts 的源码断言
//     随迁——「契约测试跟着搬家」同第 3/7 步先例）；
//   · 床铺优先序（自己的床夜里睡/白天翻、室友床先搜后拆）与阻碍物先于
//     NPC 的交互排序（onInteract 骨架在场景，判定方法在本类，两边同序）；
//   · 面板外点击 = 鼠标 ESC（panelBox 判据随当前面板几何走）与全部面板
//     的统一收尾（applyPanelDepth + lockToScreen + assertPanelContent）。

import type Phaser from 'phaser';

import { PALETTE, TEXT, hex } from '../../render/palette';
import {
  FONT_FAMILY,
  TYPE,
  UI,
  buildListRow,
  buildPanelHeader,
  buildPanelWell,
} from '../../render/uiKit';
import {
  PANEL_DEPTH,
  applyPanelDepth,
  buildPanel,
  lockToScreen,
  placeMarker,
  type PanelObject,
} from '../../render/panels';
import type { HitHandlers } from '../../render/pointer';
import { playSfx } from '../../render/audio';
import { itemIconKey } from '../../render/itemIcons';
import { pickupAnimKey, searchAnimKey } from '../../render/walkcycle';
import { ACTOR_DEPTH, LIGHT_DEPTH } from '../../render/lighting';
import {
  BED_X,
  FLOOR_BAND,
  FLOOR_HEIGHT,
  INTERACT_DISTANCE,
  PLAYABLE_FLOORS_V01,
  PLAYER_FEET_Y,
  STARTING_FLOOR,
} from '../../core/constants';
import { getGame } from '../../core/session';
import { ACTION_COSTS, isNight } from '../../systems/SurvivalSystem';
import { saveToStorage } from '../../systems/SaveSystem';
import { bumpStat } from '../../systems/StatsSystem';
import { getItem } from '../../data/items';
import { countItem } from '../../systems/InventorySystem';
import { diaryOf } from '../../systems/DiarySystem';
import { WALL_DECO } from '../../data/wallDeco';
import {
  BUNK_DISMANTLE_COST,
  BUNK_SEARCH_COST,
  OBSTACLE_DIG_COST_MINUTES,
  OBSTACLE_DIG_MS,
  SEARCH_MS,
  bunkDismantleTool,
  clearObstacle,
  dismantleBunk,
  isBunkDismantled,
  isBunkSearched,
  isObstacleCleared,
  lootContainer,
  lootGround,
  nearestObstacle as nearestObstacleIn,
  obstacleTool,
  obstaclesForFloor,
  searchBunk,
  type FloorObstacle,
} from '../../systems/LootSystem';
import { availableShelterActions, resolveShelterAction } from '../../systems/ShelterSystem';
import {
  nightWatchEvidenceNote,
  recordNightChoice,
  recordNightDismissal,
  stepNightWatch,
  type NightChoice,
} from '../../systems/NightSystem';
import { charge, recordShortcut, shortcutAvailable, shortcutPlan } from '../../systems/shortcut';
import { currentInteractionZone, tryChangeFloor } from '../../systems/FloorSystem';
import { recordDepth } from '../../systems/progress';
import type { AchievementEvent } from '../../systems/AchievementSystem';
import type { CharacterKey } from '../../render/artpack';
import type { GeneratedContainer, GameState, GroundItem, ShelterAction } from '../../core/gameTypes';
import type { PanelBox } from './StatsPanelController';

// ── 随迁的两条模块常量（原 GameScene.ts 510/518 行，逐字保留） ──────────────

/** AG-51：夜间安排面板的四行（行动/标签/一句效果）。 */
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

// AG-20：终局层（统治核心）。这一层的三个容器是终局演出入口
// （docs/plans/FINALE_UX.md §2 契约，EndgameScene 归 AG-21）。
const FINALE_FLOOR = 100000;

/** AG-66：进行中的搜刮/挖掘动作（2s）。到点才出货/清障；这期间任何移动输入
 *  都会取消它——不出货、不扣时间、不标记已搜/已挖（防站着刷）。 */
export type PendingAction = {
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

/**
 * 控制器需要场景提供的最小面（GameScene 天然满足；单测用假件实现）。
 * 刻意不 import Phaser.Scene：本类的可测性靠这层结构面，而不是靠能造真场景。
 */
export interface InteractionHost {
  // ── Phaser 单子（结构面）──
  /** GameObject 工厂——阻碍物 Graphics 与三面板的全部件从它出生。 */
  add: Phaser.GameObjects.GameObjectFactory;
  /** 场景时钟——面板行点击的 delayedCall(0) 与 2s 动作的 delayedCall(ms)。 */
  time: Phaser.Time.Clock;
  /** 相机管理器——捷径跳层的闪白（cameras.main.flash）。 */
  cameras: Phaser.Cameras.Scene2D.CameraManager;

  // ── 共享件的场景薄封装（第一参钉死 Phaser.Scene，运行期即本场景）──
  /** 屏幕空间点击热区（panelHit：scrollFactor 0）——三面板的行/翻页热区。 */
  panelHit(
    x: number,
    y: number,
    w: number,
    h: number,
    depth: number,
    handlers: HitHandlers,
  ): Phaser.GameObjects.Rectangle;
  /** 面板光标箭头（夜间安排/入夜两枚，reset 时重建）。 */
  createMarker(): Phaser.GameObjects.Image;
  /** AG-90：一次性动作 clip（search 拉满 2s / 拾取 pickup / 拆床 520ms）。 */
  playActionAnim(key: string, ms: number): void;
  /** 粒子特效（render/fx.ts playFx 的场景薄封装；降级时返回 null）。 */
  playFx(id: string, x: number, y: number, depth: number): Phaser.GameObjects.Sprite | null;
  /** 视口尺寸（三面板居中）。 */
  viewSize(): { width: number; height: number };
  /** 鼠标 ESC 逃生门的判定矩形（onPointerDown 读 panelBox）。 */
  setPanelBox(box: PanelBox): void;
  /** dev 面板空件自查（StatsPanelHost 同款实现，不复制）。 */
  assertPanelContent(panel: string, objects: ReadonlyArray<Phaser.GameObjects.GameObject>): void;
  /** 特写面板读墙饰源图尺寸（不放大，只缩）。 */
  textureSize(key: string): { width: number; height: number };
  /** meta 选的当前角色（拾取动画 key 按角色取）。 */
  metaSelectedCharacter(): CharacterKey;

  // ── 场景查询 ──
  /** 任何面板开着没有（特写开关的互斥门）。 */
  anyPanelOpen(): boolean;
  /** 键盘 Enter 的分发本体（夜间安排行点击走同一条路——理由见
   *  buildShelterPanel 行点击注释：onUse 会重算 shelterSelected）。 */
  onUse(): void;

  // ── 世界状态读写（场景属主的楼层视图与对象簿记）──
  /** 本层容器活引用（floorView.containers——含 items/label/needs 全字段；
   *  与 TutorialHost 的 containers() 同名不同面，故加 floor 前缀）。 */
  floorContainers(): GeneratedContainer[];
  /** 本层地面物品活引用（floorView.groundItems——自动拾取）。 */
  groundItems(): GroundItem[];
  /** 重读楼层视图（开箱/拾取后 floorView = getFloorView(...)）。 */
  refreshFloorView(): void;
  /** 容器舔空后的视觉（场景持 containerObjs）。 */
  setContainerEmptyVisual(id: string, empty: boolean): void;
  /** 地面物品对象（拾取后销毁）。 */
  groundObject(key: string): Phaser.GameObjects.Rectangle | undefined;
  /** 摘掉地面物品对象引用（销毁后）。 */
  forgetGroundObject(key: string): void;
  /** 可交互床铺快照（场景持 bunkObjs；id/x/own 三字段够判定用）。 */
  bunks(): Array<{ id: string; x: number; own: boolean }>;
  /** 拆床后的清场（场景销毁对象 + 摘呼吸队列 + 删 bunkObjs）。 */
  removeBunk(id: string): void;
  /** 把阻碍物 Graphics 交进场景 floorObjects（clearFloor 批量销毁）。 */
  pushFloorObject(o: Phaser.GameObjects.GameObject): void;
  /** 作废点击走位订单（2s 动作起落时 walkTarget = null）。 */
  cancelWalkOrder(): void;
  /** 楼层世界重建（捷径跳层：clearFloor + drawFloor）。 */
  rebuildFloor(): void;

  // ── HUD/时钟/账目/成就 ──
  /** 左下角 toast。 */
  flash(message: string): void;
  /** 扣游戏分钟（时钟属主在场景，含 autosave 与跨点死亡判定）。 */
  chargeTime(gameMinutes: number): void;
  /** 背包刷新（搜刮/拆解/开箱/拾取后）。 */
  refreshInventory(): void;
  /** 战利品计数进「本次出行」账（EndScene 结算读）。 */
  addLootThisTrip(quantity: number): void;
  /** AG-77 成就事件发射（AchievementController 属主在场景——复用场景既有的
   *  emitAchievementEvent 公开方法，返回本次解锁的成就 id 表）。 */
  emitAchievementEvent(event: AchievementEvent): string[];
  /** 睡觉跨日编排（activateShelterChoice 的 resolved 分支——finishNight +
   *  产业账本对比 + 淡入淡出 + 醒来 flash，场景属主；本类只递话）。 */
  sleepNight(): void;
}

/** 三个共享面板渲染件第一参的场景类型（buildPanel/buildPanelHeader/
 *  buildPanelWell）——同 CombatController/DialogueController 的
 *  SharedPanelScene 路数，签名是边界冻结的（EndScene 同参），它们改签名时
 *  这里跟着报错。buildListRow 同族。 */
type SharedPanelScene = Parameters<typeof buildPanel>[0];

export class InteractionController {
  // ── 夜间安排面板状态组（原 GameScene 字段，随迁；公开字段 = 场景分发骨架
  //    的读数面——shelterOpen/nightChoiceOpen/decoOpen 十个 guard 同读） ──
  /** 夜间安排面板开着没有（onEsc/onUse/onNavUp/各输入 guard/openPanelHint/
   *  anyPanelOpen/update 早退都读这一位）。 */
  shelterOpen = false;
  shelterSelected = 0;
  private shelterObjects: PanelObject[] = [];
  private shelterMarker!: Phaser.GameObjects.Image;
  // ── 入夜二选一面板状态组 ───────────────────────────────────────────────
  /** 入夜二选一面板开着没有（同上十个读数点）。 */
  nightChoiceOpen = false;
  nightChoiceSelected = 0;
  private nightChoiceObjects: PanelObject[] = [];
  private nightChoiceMarker!: Phaser.GameObjects.Image;
  // ── 墙饰特写面板状态组 ─────────────────────────────────────────────────
  /** 墙饰特写面板开着没有（L 键开关 / ←→ 翻页 / onEsc / anyPanelOpen）。 */
  decoOpen = false;
  decoIndex = 0;
  private decoObjects: PanelObject[] = [];
  // ── AG-66 阻碍物名册（本层 seeded 全集 + 未挖列表 + 场景图形） ─────────
  /** 本层阻碍物全集（含挖过的残骸；e2e ag66 经 GameScene getter 直读）。 */
  floorObstacles: FloorObstacle[] = [];
  /** 还没挖的那些（每帧钳位与 NPC 避让读；e2e npc/spark/survivalLoop 经
   *  GameScene getter 直读）。 */
  activeObstacleList: FloorObstacle[] = [];
  private obstacleObjs = new Map<string, Phaser.GameObjects.Graphics>();
  // ── AG-66 进行中的搜刮/挖掘动作（update 的取消/落地段与底栏 busy 提示读；
  //    e2e ag50-control-probe/survivalJourney 经 GameScene getter 直读） ──
  pendingAction?: PendingAction;

  constructor(private readonly host: InteractionHost) {}

  /** 见 SharedPanelScene：仅供共享面板渲染件调用的一次性场景收窄。 */
  private get sharedScene(): SharedPanelScene {
    return this.host as unknown as SharedPanelScene;
  }

  // ── 生命周期（场景 create/clearFloor 的委托点） ─────────────────────────

  /**
   * create() 里调用一次（原 create 的 shelter/night/obstacle 重置段）。
   * 字段初始化器不重跑（场景重启复用实例），面板态/名册/动作态必须在这里
   * 显式清空——否则上一局的 pendingAction timer 会在新局到点出货。
   * 注意：deco 三字段不在重置清单里（与原 create 逐字一致——重启只可能
   * 从暂停菜单发起，那时 anyPanelOpen 为假，decoOpen 恒已收起）。
   */
  reset(): void {
    this.shelterObjects = [];
    this.shelterMarker = this.host.createMarker();
    this.nightChoiceObjects = [];
    this.nightChoiceMarker = this.host.createMarker();
    this.nightChoiceOpen = false;
    this.nightChoiceSelected = 0;
    this.shelterOpen = false;
    this.shelterSelected = 0;
    this.floorObstacles = [];
    this.activeObstacleList = [];
    this.obstacleObjs.clear();
    this.pendingAction = undefined;
  }

  /**
   * clearFloor() 里调用（换层）：阻碍物 Graphics 都在场景 floorObjects 里
   * （已批量销毁），这里只清名册与动作态——delayedCall 的 timer 必须摘掉，
   * 否则换层后旧动作到点出货（身份比对之外的双保险，与原实现逐字一致）。
   */
  clearFloorState(): void {
    this.obstacleObjs.clear();
    this.floorObstacles = [];
    this.activeObstacleList = [];
    if (this.pendingAction) {
      this.pendingAction.timer.remove(false);
      this.pendingAction = undefined;
    }
  }

  /** 面板对象列表（clearStrayPanels 恢复路径——夜间安排 + 入夜两组；
   *  特写面板件不在内，与原清单逐字一致）。 */
  panelObjectsForRecovery(): PanelObject[] {
    return [...this.shelterObjects, ...this.nightChoiceObjects];
  }

  // ── 付费捷径（OVERHAUL Wave C2） ───────────────────────────────────────
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
  //
  // 面板互斥 guard 逐字留在场景侧（bindInput 的 keyF 闭包——stairClimb/各
  // 面板开合判据是场景交互状态，与 E 的 guard 同门）；本方法是玩法本体
  // （原 tryShortcut 的 guard 段之后的部分整体迁来）。

  tryShortcut(): void {
    const state = getGame();
    if (state.status !== 'playing') return;
    const top = Math.max(...PLAYABLE_FLOORS_V01);
    if (!shortcutAvailable(state.currentFloor, top)) {
      this.host.flash('这里没有可抄的近路');
      return;
    }
    const zone = currentInteractionZone(state);
    if (zone !== 'up') {
      this.host.flash('要走上楼口才能抄近路');
      return;
    }
    const salt = (state.runSeed ^ (state.day * 7919) ^ (state.currentFloor * 104729)) >>> 0;
    // M1-3: one plan, one price — the prompt, the charge and the jump all read
    // shortcutPlan, so the number advertised can never drift from the number
    // taken (the skip is segment-clamped inside the plan, once).
    const plan = shortcutPlan(state, state.currentFloor, salt);
    if (!charge(state, plan.price)) {
      this.host.flash(`抄近路要 ${plan.price} 金，你只有 ${state.player.gold}`);
      return;
    }
    recordShortcut(state);
    // Apply the jump through the same path a stair uses, then walk the rest.
    while (state.currentFloor < plan.target) {
      const r = tryChangeFloor(state, 1);
      if (!r.ok) break;
    }
    recordDepth(state);
    this.host.rebuildFloor();
    saveToStorage(state);
    this.host.cameras.main.flash(180, 0, 0, 0);
    this.host.flash(`你抄近路跳到了第 ${state.currentFloor} 层（-${plan.price} 金）`);
    playSfx('goal');
  }

  // ── AG-51：床铺交互（搜刮 / 拆解） ─────────────────────────────────────
  // 1 层宿舍的床不是容器（楼层视图里没有它们的一行），所以入口与搜柜分开：
  // 点击或 E 走到床边触发。概率与产出全在 LootSystem 的纯函数里
  // （seeded RNG：同 seed 同结果，禁 Math.random），场景只出动画、flash
  // 与拆床后的清场。

  /** 站到自己床边没有（起始层 + 交互距离）——TutorialHost 面与床铺交互
   *  共用这一个判定（RC-03 第 3 步起的既有接线：实现随交互迁控制器、场景经
   *  isNearBed() 委托）。 */
  isNearBed(): boolean {
    const state = getGame();
    return state.currentFloor === STARTING_FLOOR && Math.abs(state.player.x - BED_X) <= INTERACT_DISTANCE;
  }

  /** 自己的床：夜里走睡觉（20:00 门禁），白天翻床垫——onInteract 的
   *  nearBed 分支经 host 委托进来。 */
  attemptSleep(): void {
    const state = getGame();
    if (!isNight(state.gameMinuteOfDay)) {
      this.host.flash('还太早，20:00 后才能安排夜间行动');
      return;
    }
    this.openShelter();
  }

  /** 手边最近的一张可交互床（自己的床 + 室友床；拆过的不再算）。 */
  nearestInteractiveBunk(): { id: string; x: number; own: boolean } | null {
    const state = getGame();
    let best: { id: string; x: number; own: boolean } | null = null;
    let bestDist = INTERACT_DISTANCE;
    for (const bunk of this.host.bunks()) {
      if (isBunkDismantled(state, state.currentFloor, bunk.id)) continue;
      const d = Math.abs(bunk.x - state.player.x);
      if (d <= bestDist) {
        bestDist = d;
        best = { id: bunk.id, x: bunk.x, own: bunk.own };
      }
    }
    return best;
  }

  interactWithBunk(state: GameState, bunk: { id: string; x: number; own: boolean }): void {
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
      this.host.flash('这张床今天已经翻过了，明天再来');
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
      this.host.flash('今天已经翻过这张床了');
      return;
    }
    bumpStat(state, 'bedsSearched'); // AG-81：搜床计数（翻过的不重复计）
    saveToStorage(state);
    this.host.refreshInventory();
    if (result.took.length > 0) {
      this.host.playFx('collect-burst', bunkX, PLAYER_FEET_Y - 50, LIGHT_DEPTH);
      this.host.addLootThisTrip(result.took.reduce((n, t) => n + t.quantity, 0));
      // AG-77：单次搜刮 3 件+（翻床垫与开箱同一口径）。
      this.host.emitAchievementEvent({ type: 'loot_taken', count: result.took.reduce((n, t) => n + t.quantity, 0) });
      this.host.flash(`翻到 ${result.took.map((s) => `${getItem(s.itemId).displayName}×${s.quantity}`).join('、')}（-${BUNK_SEARCH_COST} 分钟）`);
    } else if (result.full) {
      this.host.flash('背包已满：翻出来的东西放不下，先腾包');
    } else {
      this.host.flash('床垫下面只有灰和一根断头发');
    }
    this.host.chargeTime(BUNK_SEARCH_COST);
  }

  private runBunkDismantle(state: GameState, bunk: { id: string; x: number }): void {
    const result = dismantleBunk(state, state.currentFloor, bunk.id);
    if (!result.ok) {
      this.host.flash(result.reason ?? '拆不了这张床');
      return;
    }
    bumpStat(state, 'bedsDismantled'); // AG-81：拆床计数
    saveToStorage(state);
    this.host.refreshInventory();
    this.host.removeBunk(bunk.id);
    // 拆比翻重：search clip 拉长到 520ms，板件应声落地。床就此消失，
    // 重进楼层也不会回来（bunkgone: 键住在存档里）。
    this.host.playActionAnim(searchAnimKey('player'), 520);
    this.host.playFx('collect-burst', bunk.x, PLAYER_FEET_Y - 40, LIGHT_DEPTH);
    this.host.addLootThisTrip(result.took.reduce((n, t) => n + t.quantity, 0));
    this.host.flash(`拆了床，得到 ${result.took.map((s) => `${getItem(s.itemId).displayName}×${s.quantity}`).join('、')}（-${BUNK_DISMANTLE_COST} 分钟）`);
    // AG-77：累计拆床 10 张。
    this.host.emitAchievementEvent({ type: 'bunk_dismantled' });
    this.host.chargeTime(BUNK_DISMANTLE_COST);
  }

  /** 底栏世界提示：床边说什么（null = 不在床边，交给后面的判官）。 */
  bunkHint(state: GameState): string | null {
    const bunk = this.nearestInteractiveBunk();
    if (!bunk) return null;
    if (bunk.own) {
      if (isNight(state.gameMinuteOfDay)) return '按 E 安排夜间行动';
      return isBunkSearched(state, state.currentFloor, bunk.id) ? '自己的床今天翻过了' : '按 E 翻翻自己的床';
    }
    if (!isBunkSearched(state, state.currentFloor, bunk.id)) return '按 E 搜刮床铺';
    return bunkDismantleTool(state.player.inventory) ? '按 E 拆解床铺' : '这张床今天翻过了';
  }

  // ── 夜间安排面板（AG-51：自己的床 · 夜里） ─────────────────────────────

  private openShelter(): void {
    const state = getGame();
    if (!state.shelterPlan?.resolved && availableShelterActions(state).length === 0) {
      this.host.flash('今晚没有可安排的 shelter 行动');
      return;
    }
    const existing = state.shelterPlan?.action;
    this.shelterSelected = existing ? Math.max(0, SHELTER_ROWS.findIndex((row) => row.action === existing)) : 0;
    this.shelterOpen = true;
    this.buildShelterPanel();
  }

  closeShelter(): void {
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
    const { width, height } = this.host.viewSize();
    const panelW = 500;
    const panelH = 300;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    // Remembered for the mouse: a click outside this rectangle closes the panel.
    this.host.setPanelBox({ x: left, y: top, w: panelW, h: panelH });
    const depth = PANEL_DEPTH.game.dialogue;
    const resolved = state.shelterPlan?.resolved === true;

    this.shelterObjects.push(...buildPanel(this.sharedScene, cx, cy, panelW, panelH, 'green', depth));
    this.shelterObjects.push(...buildPanelHeader(this.sharedScene, left, top, panelW, '夜间安排 · 宿舍', UI.good, depth + 5));
    this.shelterObjects.push(...buildPanelWell(this.sharedScene, left + 12, top + 28, panelW - 24, 44, depth + 5));
    const stress = Math.round(state.player.stress ?? 20);
    // RC-01：宿舍面板的「上次：…」读结构化日记（唯一的一套日记）。生产
    // 写入方是 ShelterSystem 的四个行动与夜袭，文案即当年旧格式的 message。
    const latest = diaryOf(state, 1)[0];
    this.shelterObjects.push(
      this.host.add.text(left + 24, top + 40, `压力 ${stress}/100${latest ? ` · 上次：${latest.text}` : ' · 今天还没有记录'}`, {
        fontFamily: FONT_FAMILY,
        fontSize: `${TYPE.caption}px`,
        color: hex(stress >= 70 ? TEXT.warn : TEXT.primary),
        wordWrap: { width: panelW - 48 },
      }).setOrigin(0, 0.5).setDepth(depth + 6),
    );
    const rowsTop = top + 80;
    for (const [index, row] of SHELTER_ROWS.entries()) {
      const objects = buildListRow(this.sharedScene, left + 16, rowsTop + index * 26, panelW - 32, depth + 6, {
        label: row.label,
        value: row.value,
        selected: index === this.shelterSelected,
        dim: resolved && state.shelterPlan?.action !== row.action,
      });
      this.shelterObjects.push(...objects);
      this.shelterObjects.push(
        this.host.panelHit( left + 16, rowsTop + index * 26, panelW - 32, 26, depth + 8, {
          // No buildShelterPanel() here: it re-derives shelterSelected from the
          // (still unresolved) plan and snaps the cursor back to row 0, so every
          // click used to schedule 休息 no matter which row was pressed.
          // activateShelterChoice() rebuilds after it resolves.
          onClick: () =>
            this.host.time.delayedCall(0, () => {
              this.shelterSelected = index;
              this.host.onUse();
            }),
        }),
      );
      // 同行文本的定位：buildListRow 的返回里只有一件 Text 且 text 恰为
      // row.label（instanceof 在 type-only import 下不可用，按 Phaser 的
      // type 字段认领——与 e2e 采集面板文本同一口径）。
      const label = objects.find(
        (object) => (object as { type?: string; text?: string }).type === 'Text'
          && (object as { text?: string }).text === row.label,
      ) as Phaser.GameObjects.Text | undefined;
      if (index === this.shelterSelected && label) {
        placeMarker(this.shelterMarker, label);
        this.shelterMarker.setDepth(depth + 8).setVisible(true).setScrollFactor(0);
      }
    }
    this.shelterObjects.push(
      this.host.add.text(cx, top + panelH - 14, resolved ? 'Enter 睡觉 · ESC 返回' : '↑/↓ 选择 · Enter 安排 · ESC 返回', {
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
    this.host.assertPanelContent('shelter', this.shelterObjects);
  }

  /** Enter：确认安排。resolved 的计划 = 睡觉（跨日编排在场景，host.sleepNight）；
   *  否则落本行行动（纯函数 resolveShelterAction 的成败各一句话）。 */
  activateShelterChoice(): void {
    const state = getGame();
    if (state.shelterPlan?.resolved) {
      // AG-20: 睡醒即跨日，产业结算在 finishNight→sleep 内部发生。前后对比
      // 账本，「昨日的收益」才能在醒来时就被看见（只观察，不重复结算）。
      // ——整段编排（账本对比/夜袭判定/淡入淡出/醒来 flash/死亡切场）留场景，
      // 本类只递话（DialogueController 第 8 步「睡觉跨日留场景」同款边界）。
      this.host.sleepNight();
      return;
    }

    const row = SHELTER_ROWS[this.shelterSelected];
    if (!row) return;
    const result = resolveShelterAction(state, row.action);
    if (!result.ok) {
      this.host.flash(result.reason ?? result.message);
      return;
    }
    saveToStorage(state);
    playSfx('click');
    this.buildShelterPanel();
    this.host.flash(`${result.message} 按 Enter 睡觉`);
  }

  /** ↑/↓：夜间安排光标（钳位 + 重画；resolved 的计划不让挪——场景侧同款门）。 */
  moveShelterSelection(delta: number): void {
    this.shelterSelected = Math.max(0, Math.min(SHELTER_ROWS.length - 1, this.shelterSelected + delta));
    this.buildShelterPanel();
  }

  // ── 墙饰特写（key L） ───────────────────────────────────────────────────
  // The eight fixtures from the 2026-11-14 wall sheet. They cannot be wall
  // dressing — 255-335px against a 16-26px band — and at that ratio a riveted
  // notice board becomes four grey pixels. Native size is the only size at which
  // the rivets, the pitting and the chalk strokes survive, so they are shown 1:1
  // in a panel the player pages through.
  //
  // Rebuilt per open rather than toggled, the same way the shelter panel works:
  // the fixture changes size with every page, so there is nothing worth keeping.

  toggleDeco(): void {
    if (this.decoOpen) {
      this.closeDeco();
      return;
    }
    if (this.host.anyPanelOpen()) return;
    this.decoOpen = true;
    this.decoIndex = 0;
    this.buildDecoPanel();
  }

  closeDeco(): void {
    this.decoOpen = false;
    for (const o of this.decoObjects) o.setVisible(false);
  }

  pageDeco(delta: number): void {
    this.decoIndex = (this.decoIndex + delta + WALL_DECO.length) % WALL_DECO.length;
    this.buildDecoPanel();
  }

  private buildDecoPanel(): void {
    for (const o of this.decoObjects) o.destroy();
    this.decoObjects = [];
    const { width, height } = this.host.viewSize();
    const panelW = 760;
    const panelH = 470;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    this.host.setPanelBox({ x: left, y: top, w: panelW, h: panelH });
    const depth = PANEL_DEPTH.game.dialogue;
    const deco = WALL_DECO[this.decoIndex];

    this.decoObjects.push(...buildPanel(this.sharedScene, cx, cy, panelW, panelH, 'green', depth));
    this.decoObjects.push(...buildPanelHeader(this.sharedScene, left, top, panelW, '墙面档案', UI.good, depth + 5));

    // The fixture sits in its own inset well, centred, never upscaled.
    const wellX = left + 24;
    const wellY = top + 58;
    const wellW = 320;
    const wellH = 352;
    this.decoObjects.push(...buildPanelWell(this.sharedScene, wellX, wellY, wellW, wellH, depth + 5));
    const img = this.host.add.image(wellX + wellW / 2, wellY + wellH / 2, deco.key).setDepth(depth + 6);
    const src = this.host.textureSize(deco.key);
    const fit = Math.min((wellW - 28) / src.width, (wellH - 28) / src.height, 1);
    img.setDisplaySize(Math.round(src.width * fit), Math.round(src.height * fit));
    this.decoObjects.push(img);

    const textX = wellX + wellW + 26;
    const textW = left + panelW - 24 - textX;
    const name = this.host.add
      .text(textX, top + 64, deco.name, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.title}px`, color: hex(TEXT.primary) })
      .setDepth(depth + 6);
    const where = this.host.add
      .text(textX, top + 100, deco.floors, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.dim) })
      .setDepth(depth + 6);
    // useAdvancedWrap is load-bearing for the fifth time in this codebase: the
    // copy is Chinese with no spaces, and the basic wrapper would ignore textW.
    const body = this.host.add
      .text(textX, top + 132, deco.text, {
        fontFamily: FONT_FAMILY,
        fontSize: `${TYPE.body}px`,
        color: hex(TEXT.secondary),
        lineSpacing: 8,
        wordWrap: { width: textW, useAdvancedWrap: true },
      })
      .setDepth(depth + 6);
    const page = this.host.add
      .text(left + panelW - 24, top + panelH - 44, `${this.decoIndex + 1} / ${WALL_DECO.length}`, {
        fontFamily: FONT_FAMILY,
        fontSize: `${TYPE.caption}px`,
        color: hex(TEXT.dim),
      })
      .setOrigin(1, 0)
      .setDepth(depth + 6);
    const hint = this.host.add
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
      this.host.panelHit(textX, navY, 96, 28, depth + 8, { onClick: () => this.pageDeco(-1) }),
      this.host.panelHit(textX + 104, navY, 96, 28, depth + 8, { onClick: () => this.pageDeco(1) }),
    );
    const prev = this.host.add
      .text(textX + 48, navY + 14, '◀ 上一件', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.primary) })
      .setOrigin(0.5)
      .setDepth(depth + 9);
    const next = this.host.add
      .text(textX + 152, navY + 14, '下一件 ▶', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.primary) })
      .setOrigin(0.5)
      .setDepth(depth + 9);
    this.decoObjects.push(name, where, body, page, hint, prev, next);

    // Same two calls every other panel makes. Missing them is what put the
    // shelter panel's words on the floor above.
    applyPanelDepth(this.decoObjects, depth);
    lockToScreen(this.decoObjects);
    this.host.assertPanelContent('deco', this.decoObjects);
  }

  // ── AG-64：入夜二选一（出去找物资 / 在家守夜） ─────────────────────────
  // 用户 2026-11-17 原话：「晚上的话应该会提示我们是出去找物资还是在家里守夜，
  // 防止别的 npc 抢我们的东西」。面板语言延用既有面板：buildPanel 铆钉板 +
  // buildPanelHeader + 选项卡高亮（accent wash + 左竖线，同 buildListRow）+
  // placeMarker 箭头 + panelHit 鼠标行。判定全在 NightSystem 的纯函数里，
  // 这里只出面板与反馈。
  //
  // 弹窗时机在 update() 的入夜边沿里（只在外层、只一次/夜）——边沿判定留
  // 场景（时钟属主在场景），本类经 openNightPrompt 被调用；交互走
  // onUse/onNavUp/onNavDown/onEsc/onInteract 的 nightChoiceOpen 分支
  // （分发骨架在场景，委托本类）。

  openNightPrompt(): void {
    this.nightChoiceSelected = 0;
    this.nightChoiceOpen = true;
    this.buildNightChoicePanel();
  }

  closeNightChoice(): void {
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
    const { width, height } = this.host.viewSize();
    const panelW = 460;
    const panelH = 252;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    // Remembered for the mouse: a click outside this rectangle closes the panel.
    this.host.setPanelBox({ x: left, y: top, w: panelW, h: panelH });
    const depth = PANEL_DEPTH.game.dialogue;

    this.nightChoiceObjects.push(...buildPanel(this.sharedScene, cx, cy, panelW, panelH, 'green', depth));
    this.nightChoiceObjects.push(...buildPanelHeader(this.sharedScene, left, top, panelW, '入夜 · 宿舍外', UI.good, depth + 5));
    this.nightChoiceObjects.push(...buildPanelWell(this.sharedScene, left + 12, top + 36, panelW - 24, 30, depth + 5));
    this.nightChoiceObjects.push(
      this.host.add
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
        this.nightChoiceObjects.push(this.host.add.rectangle(left + 16, y, panelW - 32, 66, UI.accent).setOrigin(0, 0).setScrollFactor(0).setAlpha(0.13).setDepth(depth + 6));
        this.nightChoiceObjects.push(this.host.add.rectangle(left + 16, y, 2, 66, UI.accent).setOrigin(0, 0).setScrollFactor(0).setDepth(depth + 7));
      }
      this.nightChoiceObjects.push(this.host.add.image(left + 46, y + 33, row.iconKey).setOrigin(0.5).setScrollFactor(0).setDepth(depth + 7));
      const title = this.host.add
        .text(left + 72, y + 24, row.label, {
          fontFamily: FONT_FAMILY,
          fontSize: `${TYPE.body}px`,
          color: selected ? hex(PALETTE.lightHigh) : hex(TEXT.primary),
        })
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(depth + 7);
      const consequence = this.host.add
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
        this.host.panelHit(left + 16, y, panelW - 32, 66, depth + 8, {
          onOver: () => {
            if (this.nightChoiceSelected === index) return;
            this.nightChoiceSelected = index;
            this.buildNightChoicePanel();
          },
          onClick: () =>
            this.host.time.delayedCall(0, () => {
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
      this.host.add
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
    this.host.assertPanelContent('night-choice', this.nightChoiceObjects);
  }

  /** Enter：确认二选一。出去 = 武装一夜的偷取模拟；守夜 = 回家睡，小偷整晚不来。 */
  activateNightChoice(): void {
    const state = getGame();
    const row = NIGHT_CHOICE_ROWS[this.nightChoiceSelected];
    if (!row) return;
    recordNightChoice(state, row.choice);
    saveToStorage(state);
    this.closeNightChoice();
    if (row.choice === 'scavenge') {
      playSfx('click');
      this.host.flash('你推门走进夜色——楼里不会只有你一个人');
    } else {
      playSfx('sleep');
      this.host.flash('你决定回宿舍守夜——今夜楼里再乱也乱不到你头上');
    }
  }

  /** ESC：今夜再想想。拒过之后今夜不再问，也不武装偷取。 */
  dismissNightPrompt(): void {
    const state = getGame();
    recordNightDismissal(state);
    saveToStorage(state);
    this.closeNightChoice();
    this.host.flash('今夜的事，明天再说');
  }

  /** ↑/↓：入夜二选一光标（钳位 + 重画）。 */
  moveNightChoice(delta: number): void {
    this.nightChoiceSelected = Math.max(0, Math.min(NIGHT_CHOICE_ROWS.length - 1, this.nightChoiceSelected + delta));
    this.buildNightChoicePanel();
  }

  /**
   * AG-64：一夜的偷取后台模拟（判定全在 NightSystem）。玩家不在那一层也算——
   * 结果写 localEvents/lootedItems，回层或睡醒时给证据。只有所有面板都关着
   * 才会跑到这里（场景 update 的面板早退在前），不存在「开着背包被偷」。
   */
  tickNightWatch(): void {
    const state = getGame();
    const step = stepNightWatch(state, state.currentFloor === STARTING_FLOOR);
    if (step.kind === 'none') return;
    saveToStorage(state);
    if (step.kind === 'visited') {
      if (state.currentFloor !== STARTING_FLOOR) {
        this.host.flash('楼道里似乎有脚步声——有人往宿舍那边去了……');
        playSfx('alert');
      }
      return;
    }
    if (step.kind === 'prevented') {
      this.host.flash('你守在屋里——楼道里的脚步声最终远了');
      // AG-77：守夜成功计数（小偷被守在屋里逼退）。
      this.host.emitAchievementEvent({ type: 'night_watch_prevented' });
      return;
    }
    // stolen：玩家不在家，什么被偷走了等回层/睡醒时由
    // nightWatchEvidenceNote / nightWatchWakeNote 出示，这里不剧透。
  }

  /** 回到宿舍时的小偷证据：flash 一次，之后 night-theft-seen 标记让它闭嘴。 */
  reportNightWatchEvidence(): void {
    const state = getGame();
    const note = nightWatchEvidenceNote(state);
    if (!note) return;
    saveToStorage(state);
    this.host.flash(note);
  }

  // ── 容器搜刮（开箱 + AG-66 的 2s 动作版） ──────────────────────────────

  /** 交互距离内最近的**非空**容器（空箱不给提示——既有语义）。 */
  nearestContainer(): GeneratedContainer | null {
    const px = getGame().player.x;
    let best: GeneratedContainer | null = null;
    let bestDist = INTERACT_DISTANCE;
    for (const c of this.host.floorContainers()) {
      if (c.items.length === 0) continue;
      const d = Math.abs(c.x - px);
      if (d <= bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  }

  /**
   * AG-20：终局层容器 → 演出入口（docs/plans/FINALE_UX.md §2 契约）。
   * 三重门：终局层 + 容器已开过（openedContainers，二段式的第二段）+ id 有
   * 映射。任何一关不过返回 null——调用方回落到既有搜刮。交互（onInteract）
   * 与提示（hint）共用这一个判官，两边不会漂移。
   */
  finaleEntryFor(containerId: string): 'terminal' | 'archive' | 'fuse' | null {
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
  nearestFinaleContainer(): GeneratedContainer | null {
    const state = getGame();
    if (state.currentFloor !== FINALE_FLOOR) return null;
    const px = state.player.x;
    let best: GeneratedContainer | null = null;
    let bestDist = INTERACT_DISTANCE;
    for (const c of this.host.floorContainers()) {
      const d = Math.abs(c.x - px);
      if (d <= bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  }

  openContainer(containerId: string): void {
    const state = getGame();
    const target = this.host.floorContainers().find((c) => c.id === containerId);
    const label = target?.label ?? containerId;
    // Tools unlock container TYPES rather than recipes: a locked safe is the
    // reason to carry the crowbar you found on floor 3.
    if (target?.needs && countItem(state.player.inventory, target.needs) === 0) {
      const tool = getItem(target.needs).displayName;
      this.host.flash(`${label}锁着，需要${tool}`);
      return;
    }
    // AG-66：搜刮是一个动作——点下去先弯腰（search 动画拉满 SEARCH_MS），2s 后
    // 才翻出东西。这期间移动输入即取消（不出货、不扣时间、不标记已搜，见
    // 场景 update 的 pendingAction 段）。既有边界（锁/满/空/二次搜刮）原样落在
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
    const target = this.host.floorContainers().find((c) => c.id === containerId);
    const label = target?.label ?? containerId;
    const result = lootContainer(state, floor, containerId);
    if (result.took.length > 0 || result.full) bumpStat(state, 'containersLooted'); // AG-81：开出东西（或包满没拿完）的箱才算开过
    saveToStorage(state);
    this.host.refreshFloorView();
    this.host.setContainerEmptyVisual(containerId, (this.host.floorContainers().find((c) => c.id === containerId)?.items.length ?? 0) === 0);
    this.host.refreshInventory();

    if (result.took.length === 0 && !result.full) this.host.flash(`${label} 是空的`);
    else if (result.full) {
      // B3-16: the bag takes mergeable stacks and refuses new ones, and nothing
      // on screen said so — the playtest found players discovering the rule by
      // being refused three times. Name which half happened.
      // AG-11: and how much is left behind. lootContainer reports took/full
      // only, but the post-loot view is re-read above anyway, so the count is
      // free — "剩余留在容器" without a number made players re-open the crate
      // to find out whether it was one bottle or five.
      const remaining = this.host.floorContainers().find((c) => c.id === containerId)?.items.length ?? 0;
      this.host.flash(
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
      this.host.playFx('collect-burst', state.player.x + 10, PLAYER_FEET_Y - 50, LIGHT_DEPTH);
      this.host.addLootThisTrip(result.took.reduce((n, t) => n + t.quantity, 0));
      // AG-77：单次搜刮 3 件+（一次开箱拿到几件，取历史最大值）。
      this.host.emitAchievementEvent({ type: 'loot_taken', count: result.took.reduce((n, t) => n + t.quantity, 0) });
      this.host.flash(`获得 ${result.took.map((s) => `${getItem(s.itemId).displayName}×${s.quantity}`).join('、')}（-${ACTION_COSTS.searchContainer} 分钟）`);
      this.host.chargeTime(ACTION_COSTS.searchContainer);
    }
  }

  /** 走动中贴身的地面物资自动拾取（场景 update 的世界模拟段委托）。 */
  autoPickup(): void {
    const state = getGame();
    for (const g of [...this.host.groundItems()]) {
      if (Math.abs(g.x - state.player.x) > 12) continue;
      const r = lootGround(state, state.currentFloor, g.key);
      if (r.took) {
        this.host.groundObject(g.key)?.destroy();
        this.host.forgetGroundObject(g.key);
        this.host.refreshFloorView();
        this.host.refreshInventory();
        saveToStorage(state);
        playSfx('pickup');
        // the same beat as a container, smaller: the item went into the bag.
        // Its own pose, not search: picking something off the floor is standing
        // and reaching down, not bending into a locker.
        this.host.playFx('collect-burst', g.x, PLAYER_FEET_Y - 26, LIGHT_DEPTH);
        this.host.playActionAnim(pickupAnimKey(this.host.metaSelectedCharacter()), 420);
        this.host.flash(`拾取 ${getItem(r.took.itemId).displayName}×${r.took.quantity}（-${ACTION_COSTS.pickupGround} 分钟）`);
        this.host.chargeTime(ACTION_COSTS.pickupGround);
      } else if (r.full) {
        this.host.flash('背包已满：新物品放不下，能叠进的堆才能拾取');
      }
    }
  }

  // ── AG-66：2s 搜刮/挖掘动作 ─────────────────────────────────────────
  /**
   * 起一个搜刮/挖掘动作：search clip 拉满时长（容器/床 SEARCH_MS，阻碍物
   * OBSTACLE_DIG_MS），到点由 finishPendingAction 落地。这期间场景 update 里
   * 的任何移动输入都会取消它——不出货、不扣时间、不标记已搜/已挖。
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
    this.host.cancelWalkOrder();
    this.host.playActionAnim(searchAnimKey('player'), ms);
    const entry: PendingAction = {
      kind: action.kind,
      floor: getGame().currentFloor,
      containerId: action.containerId,
      bunkId: action.bunkId,
      obstacleX: action.obstacleX,
      atX: action.atX,
      busyHint: action.busyHint,
      cancelHint: action.cancelHint,
      until: this.host.time.now + ms,
      timer: undefined as unknown as Phaser.Time.TimerEvent,
    };
    this.pendingAction = entry;
    entry.timer = this.host.time.delayedCall(ms, () => {
      // 身份比对：被取消过的动作（或换层后重建的名册）不会落地。
      if (this.pendingAction === entry) this.finishPendingAction();
    });
  }

  /** 收手：摘 timer、清动作态、给一句反馈（silent = 换层/重启时的静默清理）。 */
  cancelPendingAction(silent = false): void {
    const action = this.pendingAction;
    if (!action) return;
    action.timer.remove(false);
    this.pendingAction = undefined;
    this.host.cancelWalkOrder();
    if (!silent) this.host.flash(action.cancelHint);
  }

  /** 到点落地：先对楼层（换层/换场景就地作废），再按 kind 分派。 */
  finishPendingAction(): void {
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
  nearestObstacle(): FloorObstacle | null {
    return nearestObstacleIn(this.activeObstacleList, getGame().player.x, INTERACT_DISTANCE);
  }

  /** 阻碍物提示：有工具说「按 E 挖」，没工具说缺什么——与 E 的实际行为同源。 */
  obstacleHint(o: FloorObstacle): string {
    const armed = obstacleTool(getGame().player.inventory) !== null;
    if (o.kind === 'rubble') return armed ? '按 E 挖开这堆瓦砾' : '需要铲子才能挖开这堆瓦砾（撬棍也行）';
    return armed ? '按 E 撬开这道闸门' : '需要铲子或撬棍才能撬开这道闸门';
  }

  /** 画本层阻碍物（含挖过的残骸）。程序化 Graphics，16 色板内，不新增贴图。
   *  场景 drawFloor 调一次；对象 push 进场景 floorObjects（clearFloor 批量销毁）。 */
  buildObstacles(): void {
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
      const g = this.host.add.graphics().setDepth(ACTOR_DEPTH);
      this.drawObstacle(g, o, isObstacleCleared(state, state.currentFloor, o.x));
      this.obstacleObjs.set(`${o.x}`, g);
      this.host.pushFloorObject(g);
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
  tryClearObstacle(o: FloorObstacle): void {
    const state = getGame();
    if (isObstacleCleared(state, state.currentFloor, o.x)) return;
    if (!obstacleTool(state.player.inventory)) {
      this.host.flash(this.obstacleHint(o));
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
    this.host.playFx('collect-burst', x, PLAYER_FEET_Y - 30, LIGHT_DEPTH);
    playSfx('chest');
    this.host.flash(o?.kind === 'gate' ? '撬开了锈闸门，过道通了' : '挖开了瓦砾堆，过道通了');
    this.host.chargeTime(OBSTACLE_DIG_COST_MINUTES);
  }
}
