// AG-70/AG-90/AG-91：回合制战斗 + 战斗舞台 + juice 层——RC-03 拆分第 7 步。
// 从 GameScene 迁出（原战斗段：monsterFor/startCombat/closeCombat/
// buildCombatStage/destroyCombatStage/syncCombatStage/combatSlidePlayerTo/
// combatPlayerHpFrac/combatFloatText/playAmbusherStrike/stageMonsterHit/
// stageMonsterDodge/stagePlayerGuard/stageMonsterCounter/playFleeShow/
// buildCombatPanel/drawCombatActionIcon/playCombatFeedback/
// activateCombatChoice/finishCombat 十七法 + AG-91 juice 段五方法 +
// COMBAT_SPOT_* 两常量 + 战斗状态字段组），行为零变更：同一构造路径
// （create() 里 perf.init() 之后 initJuice）、同一 tick 位置（update() 里
// 全部早退分支之前）、同一开战入口（openEncounter → start）、同一输入
// 路由（onUse/onNavUp/onNavDown/onEsc 四分支委托）、同一冻结面。
//
// 形态（设计文档 §2，沿用前六步的主机结构面模式）：plain TS 类，**不 import
// Phaser 场景类型**——
//   * 构造拿 host（CombatHost：add/tweens/time/cameras/anims/events 六个
//     Phaser 单子 + 场景查询面与动作面——GameScene 天然满足）；
//   * 纯逻辑三件套留原处：战斗引擎（systems/combat.ts 的 resolveRound/
//     playerCombatant，combat.test.ts 27 例直测）、敌人生成（systems/
//     monsters.ts）、juice 状态机（render/juice.ts，juice.test.ts 直测）——
//     本类只做编排：回合推进、舞台装配、演出排程、juice 消费；
//   * 共享件第一参钉死 Phaser.Scene 的（createMonsterView/createHeadTag/
//     playFx/panelHit/hitRect）由 host 薄封装注入（与 PerfController 的
//     createFloatTextPool 同款路数）——运行期 host 就是 GameScene 实例，
//     Node 下可用记录型假件单测（src/tests/combatController.test.ts）；
//   * 显示器持有并管理自己的 GameObjects：战斗面板/outcome 面板/敌人剪影/
//     双方名签/世界热区的生命周期全在本类（panelObjects 列表 + destroyStage
//     先摘 tween 再毁），GameScene 残留面见文件末「场景残留面」。
//
// GameScene 残留面（设计文档原文「回合入口/结果回写委托」）：
//   * openEncounter（遭遇点检测/开战入口）留场景——detect 到 combat kind
//     后调 combat.start(spotId, kind)；
//   * onUse/onNavUp/onNavDown/onEsc 的战斗分支留场景做路由委托（enter/
//     move/close 三入口 + isDone 读数）；
//   * closeCombat 的世界回写半边（encounterOpen=false + 拆面板对象 +
//     rebuildEncounterSpots + syncMusic）随 close() 进控制器，经 host 四个
//     场景面兑现（setEncounterOpen/rebuildEncounterSpots/…）；
//   * AG-90 播放（playActionAnim/playWandererAttack）与挥击弧
//     （playSwingFx）与世界链共用，留场景，控制器经 host 调用；
//   * AG-63 脚注纯函数（combatFootHint/combatWeaponLabel/combatBehavior
//     Label）——后两份随本拆分迁到 systems/combat.ts（与 playerCombatant
//     同一口径的家），GameScene 留 re-export（combatHud.test.ts 的 import
//     路径不变），openPanelHint 的战斗分支留场景。
//
// 冻结协议（2026-11-18 战斗大改成果，QA-5 实证）：空手 4 回合/匕首 3 回合
// （seed21 4 层弹弓顽童）、juice 三档（small 命中/medium 受击/large 击杀）、
// ambusher 开场偷袭、coward 战退、撤退不消耗点位——全部由
// e2e/split-step7-freeze.spec.ts 逐节点冻结（截图像素 diff + juice 机读）。

import type Phaser from 'phaser';
import { JuiceState, JUICE_BALANCE } from '../../render/juice';
import { getSettings } from '../../systems/SettingsSystem';
import { syncMusic } from '../../systems/AudioSystem';
import { playSfx } from '../../render/audio';
import { resolveRound, playerCombatant, GUARD_ENERGY_RESTORE, combatWeaponLabel, combatBehaviorLabel, type CombatAction, type CombatRound, type Combatant } from '../../systems/combat';
import { combatIntroMessage, markResolved } from '../../systems/encounters';
import { MONSTERS, applyBehavior, behaviorModifiers, rollMonster } from '../../systems/monsters';
import { guardianDamageMult, lootBonus } from '../../systems/relics';
import { modeGuardianDamageMult } from '../../systems/modes';
import { bumpStat } from '../../systems/StatsSystem';
import { saveToStorage } from '../../systems/SaveSystem';
import { deriveSeed, makeRng } from '../../core/rng';
import { addItem } from '../../systems/InventorySystem';
import { getItem } from '../../data/items';
import { getGame } from '../../core/session';
import { GAME_CONFIG } from '../../core/config';
import { PLAYER_FEET_Y } from '../../core/constants';
import {
  BEHAVIOR_LABELS,
  MONSTER_BAR_COLORS,
  monsterFormFor,
  type HeadTag,
  type HeadTagOptions,
  type MonsterView,
  type MonsterViewOptions,
} from '../../render/monsterArt';
import { charAnimHoldMs } from '../../render/charAnims';
import {
  FRAME_H,
  attackAnimKey,
  dieAnimKey,
  hurtAnimKey,
  idleAnimKey,
  runAnimKey,
  walkAnimKey,
} from '../../render/walkcycle';
import { DUST_DEPTH, LIGHT_DEPTH } from '../../render/lighting';
import { COMBAT_BAR, combatBarX } from '../../render/hudLayout';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../../core/design';
import { FONT_FAMILY, TYPE, UI, buildPanelHeader, buildPanelWell } from '../../render/uiKit';
import { PALETTE, TEXT, hex } from '../../render/palette';
import { PANEL_DEPTH, buildPanel, lockToScreen } from '../../render/panels';
import { hitRect } from '../../render/pointer';
import type { PanelBox } from './StatsPanelController';
import type { CharacterKey } from '../../render/artpack';
import type { GameState, ItemId } from '../../core/gameTypes';

/**
 * AG-70：战斗站位。用户 2026-11-17 原话：「我不是说那个就是打击别人的时候
 * 展示战斗然后我们打击吗，不要做那种文本框，我们点击攻击看不见人的操作了」。
 * 双方因此以「人」的形式上场：玩家滑步到层左 25% 面右，敌人在层右 75% 面左。
 * 按当前层宽取值（floorWidthFor，tier1 一档 1280）——不硬编码 1280：tier2+
 * 的层宽不同，25%/75% 的间距随之伸缩，zoom 1 视口在遭遇层（2..5，全 tier1）
 * 恰好把双方同时框住。
 */
const COMBAT_SPOT_PLAYER_FRAC = 0.25;
const COMBAT_SPOT_MONSTER_FRAC = 0.75;

/** 动作条图元的三种（攻击斜斩/格挡盾/撤退箭）。 */
type CombatActionIcon = 'attack' | 'guard' | 'flee';

/** 动作条三钮的静态定义（icon 由 drawActionIcon 现画，note 按状态实报）。 */
const COMBAT_ACTIONS: ReadonlyArray<{ label: string; icon: CombatActionIcon }> = [
  { label: '攻击', icon: 'attack' },
  { label: '格挡', icon: 'guard' },
  { label: '撤退', icon: 'flee' },
];

/**
 * 控制器需要场景提供的最小面（GameScene 天然满足；单测用假件实现）。
 * 刻意不 import Phaser.Scene：本类的可测性靠这层结构面，而不是靠能造真场景。
 */
export interface CombatHost {
  // ── Phaser 单子（结构面）──
  /** GameObject 工厂——面板件/名签/热区从它出生。 */
  add: Phaser.GameObjects.GameObjectFactory;
  /** tween 管理器——滑步/击退/格挡压缩/淡出/缩放脉冲全走它（顿帧闸 timeScale）。 */
  tweens: Phaser.Tweens.TweenManager;
  /** 场景时钟——演出排程（delayedCall）与 juice 无关的等待。 */
  time: Phaser.Time.Clock;
  /** 相机管理器——juice 写 shakeEffect 私有偏移 + flash 闪白。 */
  cameras: Phaser.Cameras.Scene2D.CameraManager;
  /** 动画管理器——撤退演出问 anims.exists(runKey)。 */
  anims: Phaser.Animations.AnimationManager;

  // ── 场景事件订阅（juice 强度总闸；Phaser 场景事件常量留在场景侧，
  //    控制器不 import Phaser 值——与共享件反推同款纪律）──
  /** 订阅场景 RESUME（从设置场景返回时重读震屏总闸）。 */
  onSceneResume(handler: () => void): void;
  /** 退订场景 RESUME（SHUTDOWN 清理时）。 */
  offSceneResume(handler: () => void): void;
  /** 订阅场景 SHUTDOWN（一次性的 juice 订阅清理）。 */
  onceSceneShutdown(handler: () => void): void;

  // ── 共享件的场景薄封装（第一参钉死 Phaser.Scene，运行期即本场景）──
  /** 装配敌人剪影（render/monsterArt，tween 自管）。 */
  createMonsterView(opts: MonsterViewOptions): MonsterView;
  /** 双方头顶名签（render/monsterArt）。 */
  createHeadTag(opts: HeadTagOptions): HeadTag;
  /** 粒子特效（render/fx.ts playFx 的场景薄封装；降级时返回 null）。 */
  playFx(id: string, x: number, y: number, depth: number, opts?: { scale?: number; timeScale?: number }): Phaser.GameObjects.Sprite | null;
  /** 屏幕空间点击热区（panelHit：scrollFactor 0）——动作条三钮。 */
  panelHit(x: number, y: number, w: number, h: number, depth: number, handlers: Parameters<typeof hitRect>[6]): Phaser.GameObjects.Rectangle;
  /** 世界空间点击热区（hitRect 原样）——敌人剪影上的「点击攻击」。 */
  worldHitRect(x: number, y: number, w: number, h: number, depth: number, handlers: Parameters<typeof hitRect>[6]): Phaser.GameObjects.Rectangle;
  /** AG-90：一次性动作 clip（GIF/程序姿态，世界链共用同一份实现）。 */
  playActionAnim(key: string, ms: number): void;
  /** 挥击弧（单 roll 遭遇共用；killed 时加 crit-hit）。 */
  playSwingFx(killed?: boolean): void;
  /** AG-80：战斗飘字走 PerfController 的池（第 4 步留的面）。 */
  spawnFloatText(x: number, y: number, text: string, color: string): void;

  // ── 战斗编排要用的场景能力 ──
  /** 玩家 sprite——滑步/面朝/格挡压缩/头顶名签钉点/震屏锚点都读它。 */
  playerSprite(): Phaser.GameObjects.Sprite;
  /** 当前层宽（floorWidthFor 的结果，每层重建时更新）。 */
  floorWidth(): number;
  /** meta 选的当前角色（GIF key 按角色取）。 */
  metaSelectedCharacter(): CharacterKey;
  /** 滑步/撤退 tween 的驱动点：sprite + 影子 + 灯光 + 武器同一世界坐标。 */
  syncPlayerWorldObjects(x: number, y: number): void;
  /** 视口尺寸（outcome 面板居中）。 */
  viewSize(): { width: number; height: number };
  /** 行商问号点的 x（敌人站位避让用；没有则 undefined）。 */
  shopSpotX(): number | undefined;

  // ── 场景状态与回写 ──
  /** 面板槽布尔（战斗/商店/遭遇共用同一个 encounterOpen）。 */
  setEncounterOpen(open: boolean): void;
  /** 鼠标 ESC 逃生门的判定矩形（onPointerDown 读 panelBox；战斗中=整张画布）。 */
  setPanelBox(box: PanelBox): void;
  /** 世界回写：问号点按战斗结果重建（胜/怯战消失，撤退保留）。 */
  rebuildEncounterSpots(): void;
  /** HUD 刷新（回合推进/掉血后）。 */
  refreshStats(): void;
  /** 左下角 toast。 */
  flash(message: string): void;
  /** 场景此刻活着没有（延迟切场前的守卫）。 */
  sceneActive(): boolean;
  /** 切结局卡（玩家阵亡，die clip 播完）。 */
  startEndScene(): void;
  /** AG-77：本场受伤计数归零（开战）。 */
  resetCombatDamage(): void;
  /** AG-77：本场受伤计数累加（偷袭/反击命中）。 */
  noteCombatDamage(damage: number): void;
  /** AG-77：本场累计受伤（boss_won 成就判据）。 */
  combatDamageTaken(): number;
  /** AG-77：零伤害击败守门人的成就发射。 */
  emitBossWon(damageTaken: number): void;
  /** 战利品计数进「本次出行」账（EndScene 结算读）。 */
  addLootThisTrip(quantity: number): void;
  /** 面板对象列表（clearStrayPanels 恢复路径要看得见战斗面板件）。 */
  combatPanelObjects(): ReadonlyArray<Phaser.GameObjects.GameObject>;
}

/** 三个共享面板渲染件第一参的场景类型（buildPanel/buildPanelHeader/
 *  buildPanelWell）——同 SharedHitScene 的路数，签名是边界冻结的
 *  （EndScene/EndgameScene 同参），它们改签名时这里跟着报错。 */
type SharedPanelScene = Parameters<typeof buildPanel>[0];

/** clamp 小工具（避免为 Phaser.Math.Clamp 一个值 import 整个 Phaser）。 */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** 敌人剪影上的世界热区深度（压过前景剪影，与迁移前逐字一致）。 */
const MONSTER_HIT_DEPTH = DUST_DEPTH + 5;

export class CombatController {
  // ── 战斗状态字段组（原 GameScene 字段，随迁） ──────────────────────────
  /** 动作条光标（0 攻击/1 格挡/2 撤退）。 */
  private selected = 0;
  /** True while the outcome screen is up (the fight is decided, one Enter left). */
  private done = false;
  /** AG-70：演出锁——撤退成功时角色跑向边缘淡出（560ms），这期间任何战斗
   *  输入（Enter/ESC/点击）都不再驱动回合，否则半空中再结算一回合。 */
  private busy = false;
  /** AG-70：战斗舞台——敌人剪影视图 + 双方头顶名签。世界坐标（scrollFactor 1），
   *  击退/前冲/待机呼吸都由 MonsterView 自己的确定性 tween 驱动；本类只在
   *  syncStage 里把名签钉在角色身上。不走 panelObjects：那个列表由面板重建/
   *  销毁管，舞台要活过整个战斗（含 outcome 面板那一段）。 */
  private stage?: { monster: MonsterView; playerTag: HeadTag };
  /** AG-70：敌人剪影上的点击热区（世界坐标）——「点击攻击」直接点怪也出手。 */
  private monsterHit?: Phaser.GameObjects.Rectangle;
  /** 战斗面板与 outcome 面板的对象列表（原 encounterObjects 的战斗侧使用）。 */
  private panelObjects: Phaser.GameObjects.GameObject[] = [];

  // ── AG-91 juice 字段组（原 GameScene juice 段，随迁） ──────────────────
  /** juice 状态机。场景重启时 initJuice 建新的（字段初始化器不重跑）。 */
  private juice!: JuiceState;
  /**
   * 震屏强度（0..1）。= AG-72 的 screenShake 总闸开着时的平衡旋钮值
   * （JUICE_BALANCE.shakeStrength），总闸关闭时 0。只在 create 与 resume 时
   * 读设置（设置在 MenuScene 改，那时本场景已暂停），不进每帧热路径。
   */
  private juiceStrength = JUICE_BALANCE.shakeStrength;

  constructor(private readonly host: CombatHost) {}

  /** 见 SharedPanelScene：仅供共享面板渲染件调用的一次性场景收窄。 */
  private get sharedScene(): SharedPanelScene {
    return this.host as unknown as SharedPanelScene;
  }

  // ── 开机/读帧面（场景 create/update 的委托点） ─────────────────────────

  /** AG-91：建/重建 juice 状态机。create() 里 perf.init() 之后调。 */
  initJuice(): void {
    // 种子只认 runSeed + 固定标签：同一局的重放震屏噪声一致；不同局不同表。
    const seed = deriveSeed(getGame().runSeed, JUICE_BALANCE.seedTag);
    this.juiceStrength = getSettings().screenShake ? JUICE_BALANCE.shakeStrength : 0;
    this.juice = new JuiceState({ seed, strength: this.juiceStrength });
    // 相机 shakeEffect 可能留着上一局的 offset（重启不重建相机）——先清零，
    // 否则新场景第一帧会闪一下旧局的震屏。
    this.writeCameraShakeOffset(0, 0);
    // 从设置场景返回时重读总闸（GameScene 在 MenuScene 期间处于暂停态）。
    this.host.onSceneResume(this.refreshJuiceStrength);
    this.host.onceSceneShutdown(() => this.host.offSceneResume(this.refreshJuiceStrength));
  }

  /**
   * AG-91：每帧推进（真实时间）。位置在所有早退分支之前——爬梯/面板/战斗
   * 全程覆盖，顿帧期间震屏与闪白/缩放计时也不冻（spec：只冻模拟）。
   * 返回是否处于顿帧（调用方据此闸掉世界模拟）。
   */
  tick(deltaMs: number): boolean {
    this.juice.update(deltaMs);
    const frozen = this.juice.isFrozen();
    // 顿帧只冻「模拟」：世界链由调用方闸掉，战斗舞台的 tween（击退/前冲/
    // 呼吸/飘字）在这里统一冻结——经典 hitstop 冻结受击反应用的就是它。
    // 每帧都写（不只在边沿）：万一有代码在别处改了 timeScale，下一帧纠回。
    this.host.tweens.timeScale = frozen ? 0 : 1;
    // squash & stretch：按真实时间采样（演出层，不随顿帧冻），保体积
    // （sx=1/sy）。只挂在战斗舞台的敌人剪影上——large（击杀）的受害者。
    const stage = this.stage;
    if (stage && this.juice.scaleRemainingMs > 0) {
      const p = this.juice.scalePulse();
      stage.monster.root.setScale(p.sx, p.sy);
    }
    // 相机 offset：trauma² × 强度 × seeded noise（juice.ts 纯逻辑产出）。
    const off = this.juice.cameraOffset();
    this.writeCameraShakeOffset(off.x, off.y);
    return frozen;
  }

  /**
   * AG-91：分级打击入口。战斗钩子（命中/受击/击杀/伏击/巡游体）统一走这里，
   * 返回的视觉清单当场演：闪白（受击白闪 50-80ms）与缩放（squash & stretch
   * 保体积回弹，large 专属）。顿帧由 tick 的闸门兑现。
   */
  impact(tier: 'small' | 'medium' | 'large', x: number, y: number): void {
    const fb = this.juice.impact(tier, x, y);
    if (fb.flash) {
      // 受击闪白：Phaser Flash 效果（一次性、自褪色，零新增对象）。总闸只管
      // 震屏位移，闪白与顿帧不设开关——无位移刺激，且 70ms 一闪即灭。
      this.host.cameras.main.flash(JUICE_BALANCE.flashMs, 255, 255, 255);
    }
  }

  /** AG-91 取证面：juice 状态机本体（e2e/ag91-juice.spec.ts 的逐帧记录器
   *  读 scene.juice——GameScene 留只读委托给它，契约不变、探针无感）。 */
  get juiceState(): JuiceState {
    return this.juice;
  }

  /** AG-91：从设置场景返回时重读震屏总闸（箭头域：订阅/退订同一引用）。 */
  private readonly refreshJuiceStrength = (): void => {
    this.juiceStrength = getSettings().screenShake ? JUICE_BALANCE.shakeStrength : 0;
    this.juice.shakeStrength = this.juiceStrength;
  };

  /**
   * AG-91：把 juice 算出的相机 offset 写进 Phaser 的 shakeEffect——矩阵平移
   * 点（见 GameScene 残留注释）。全 0 时显式 isRunning=false，不留残留位移。
   */
  private writeCameraShakeOffset(x: number, y: number): void {
    const fx = this.host.cameras.main.shakeEffect as unknown as {
      isRunning: boolean;
      duration: number;
      _offsetX: number;
      _offsetY: number;
    };
    if (x === 0 && y === 0) {
      fx.isRunning = false;
      fx._offsetX = 0;
      fx._offsetY = 0;
      return;
    }
    // duration 设成无穷大：不让 Phaser 自己的 update 走到「effectComplete」
    // 分支把 offset 清掉（我们每帧都会重写，但它跑在我们前面）。
    fx.duration = Number.MAX_SAFE_INTEGER;
    fx.isRunning = true;
    fx._offsetX = x;
    fx._offsetY = y;
  }

  // ── 输入路由面（场景 onUse/onNavUp/onNavDown/onEsc 的委托点） ───────────

  /** outcome 面板升起了否（Enter 从此变成「关闭」）。 */
  isDone(): boolean {
    return this.done;
  }

  /** ↑/↓：动作条光标移动（0..2 循环边界由场景的 max/min 钉死）。 */
  move(delta: number): void {
    this.selected = Math.max(0, Math.min(2, this.selected + delta));
    this.buildPanel();
  }

  /** Enter：outcome 升起时关闭，否则打一张选中的动作。 */
  enter(): void {
    if (this.done) {
      this.close();
      return;
    }
    this.activateChoice();
  }

  /** ESC  mid-fight is the retreat — it runs the flee round rather than
   *  walking away for free, so the choice has a cost. */
  flee(): void {
    this.selected = 2; // flee
    this.activateChoice();
  }

  /** 每帧（update 的面板早退之前）：玩家名签钉在世界坐标，滑步途中跟着走。 */
  syncStage(): void {
    const stage = this.stage;
    if (!stage) return;
    stage.playerTag.root.setPosition(this.host.playerSprite().x, PLAYER_FEET_Y - FRAME_H - 8);
  }

  /** AG-80：降级边沿的敌人待机呼吸停帧（无战斗时 no-op）。 */
  setBreathing(on: boolean): void {
    this.stage?.monster.setBreathing(on);
  }

  /** 面板对象列表（clearStrayPanels 恢复路径读）。 */
  panelObjectsForRecovery(): ReadonlyArray<Phaser.GameObjects.GameObject> {
    return this.panelObjects;
  }

  // ── turn-based combat (OVERHAUL Wave A) ─────────────────────────────────
  // The monster is rolled once per spot and frozen into state.combat, so a
  // save/reload mid-fight resumes the same fight. Behaviours from monsters.ts
  // shape the effective stats; the first-strike and guard-pierce rules are
  // applied here because resolveRound stays a generic engine.

  private monsterFor(kind: 'ambush' | 'boss', state: GameState, spotId: string): Combatant & { id: number; behavior: string } {
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

  /** 开战入口（场景 openEncounter 检测到 combat kind 后调这里）。 */
  start(spotId: string, kind: 'ambush' | 'boss'): void {
    const state = getGame();
    // AG-77：本场受伤计数从零起算——「零伤害击败守门人」只认这一场的账。
    this.host.resetCombatDamage();
    const monster = this.monsterFor(kind, state, spotId);
    const log: string[] = [combatIntroMessage(kind, monster.name ?? '敌人')];
    // An ambusher's first strike lands before the player acts: the wind-up is
    // the tell, the hit is the bill.
    let ambushStrike = 0;
    if (monster.behavior === 'ambusher') {
      const mods = behaviorModifiers('ambusher');
      const strike = Math.max(1, Math.round(monster.damage * mods.firstStrikeMult));
      state.player.hp = Math.max(0, state.player.hp - strike);
      // 裁决记录（merge ag-81）：偷袭这一口同时进两本账——AG-77 成就判据
      // （控制器里的本场受伤计数）与 AG-81 统计（bumpStat）两套记账服务不同
      // 消费者，并存。
      bumpStat(state, 'damageTaken', strike); // AG-81：偷袭这一口也要进「受到伤害」
      this.host.noteCombatDamage(strike); // 抢先扑出也算本场受的伤
      log.push(`${monster.name} 抢先扑出，造成 ${strike} 点伤害！`);
      // 受伤动画/震屏挪到 playAmbusherStrike——否则紧接着的滑步 walk clip
      // 会把 hurt clip 当场盖掉，偷袭只剩日志没有画面。
      ambushStrike = strike;
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
    this.host.setEncounterOpen(true); // the same panel slot and the same input routing
    this.selected = 0;
    playSfx('alert');
    syncMusic(getGame()); // AG-74：战斗 BGM（优先级高于夜晚/电台/楼层）
    this.host.refreshStats();
    if (state.player.hp <= 0) {
      state.status = 'lost';
      bumpStat(state, 'deaths'); // AG-81：偷袭反杀也记一次死亡
      saveToStorage(state);
      this.host.startEndScene();
      return;
    }
    saveToStorage(state);
    // AG-70：双方上场（滑步 + 敌人生成 + 头顶名签），再补 ambusher 的偷袭
    // 演出——前冲、受伤、掉血飘字与头顶血条收缩，全部看得见。
    this.buildStage(monster, kind === 'boss');
    if (ambushStrike > 0) this.playAmbusherStrike(ambushStrike);
    this.buildPanel();
  }

  /**
   * 战斗收尾：清战斗态、拆面板与舞台、问号点按结果重建、战斗音乐让位。
   * 即原 closeCombat——「结果回写委托」的世界半边（rebuildEncounterSpots/
   * syncMusic）经 host 兑现，战斗态字段在本类归零。
   */
  close(): void {
    const state = getGame();
    state.combat = undefined;
    this.done = false;
    this.busy = false;
    this.host.setEncounterOpen(false);
    for (const o of this.panelObjects) o.destroy();
    this.panelObjects = [];
    // AG-70：拆舞台——敌人剪影、双方名签、敌人点击热区都随战斗结束消失。
    this.destroyStage();
    // The floor's spots are rebuilt so a resolved one disappears.
    this.host.rebuildEncounterSpots();
    syncMusic(getGame()); // AG-74：战斗音乐让位，按夜晚/电台/楼层重解
  }

  // ── AG-70: the combat stage ─────────────────────────────────────────────
  // 战斗从「读面板」变成「看人打」：双方以剪影/立绘上场站位，头顶名签血条
  // 随人移动，命中/未命中/反击/格挡/撤退各有动作链演出。逻辑与数值仍全部
  // 在 combat.ts/monsters.ts（只读），这里只播片——resolveRound 同步返回，
  // 演出是它下游的 tween/delayedCall，永不阻塞回合结算。

  /** 双方上场：敌人在层右 75% 面左落地，玩家滑步到层左 25% 面右。 */
  private buildStage(monster: Combatant & { id: number; behavior: string }, isBoss: boolean): void {
    this.destroyStage();
    const behavior = monster.behavior as Parameters<typeof monsterFormFor>[0];
    const floorW = this.host.floorWidth();
    let monsterX = floorW * COMBAT_SPOT_MONSTER_FRAC;
    // 与行商保持一个身位：75% 若落在商店点 100px 内，顺移到商店外侧 100px，
    // 再夹回 75%±(60..64) 的带内——既不和另一个站着的活人穿模，也不跑出
    // 「层右大半边」的站位语义。行商的名签与敌人头顶名签同高且带深色底板，
    // 贴太近两块字牌会叠，敌人的血条会被行商标签板盖住（seed 42 的 2 层
    // 实测：shop 1000 vs 960）。
    const shopX = this.host.shopSpotX();
    if (shopX !== undefined && Math.abs(monsterX - shopX) < 100) {
      const away = shopX + (monsterX <= shopX ? -100 : 100);
      const spot = floorW * COMBAT_SPOT_MONSTER_FRAC;
      monsterX = clamp(away, spot - 60, spot + 64);
    }
    const view = this.host.createMonsterView({
      x: monsterX,
      y: PLAYER_FEET_Y,
      form: monsterFormFor(behavior, { isBoss }),
      name: monster.name ?? '敌人',
      hpFrac: Math.max(0, monster.hp) / monster.maxHp,
      barColor: isBoss ? MONSTER_BAR_COLORS.boss : MONSTER_BAR_COLORS.normal,
    });
    // 玩家名签：青色（安全色）与敌人的血红/boss 金分开，一眼分清谁是谁。
    const playerTag = this.host.createHeadTag({ name: '你', barColor: PALETTE.clothHigh });
    playerTag.setHp(this.playerHpFrac());
    this.stage = { monster: view, playerTag };
    // 具名：e2e 按名字探针（世界坐标/可见性），不用数 children。
    view.root.setName('combat-monster-view');
    playerTag.root.setName('combat-player-tag');
    this.syncStage();
    // 滑步上场：距离近就原地转身面右，不硬播一段走路。
    this.slidePlayerTo(floorW * COMBAT_SPOT_PLAYER_FRAC);
    // 行为标签开场飘一次：「这只怎么打」在看见剪影之后立刻有文字确认。
    // 伏击/蛮力/冷枪是「特别疼」的三类，用 warn 色；其余中性。
    const warn = behavior === 'ambusher' || behavior === 'brute' || behavior === 'ranged';
    this.floatText(monsterX, view.chestY - 34, BEHAVIOR_LABELS[behavior], warn ? hex(TEXT.warn) : hex(TEXT.secondary));
    // 点敌人本身也能出手——「点击攻击」的字面兑现：世界坐标热区盖在剪影上，
    // 与底部动作条按钮同一终点（enter，自带 busy 锁）。
    const hit = this.host.worldHitRect(monsterX - 40, PLAYER_FEET_Y - view.formH - 8, 80, view.formH + 8, MONSTER_HIT_DEPTH, {
      onClick: () => {
        if (this.busy || this.done) return;
        if (getGame().combat) this.enter();
      },
    });
    hit.setName('combat-monster-hit');
    this.monsterHit = hit;
  }

  /** 拆舞台：先摘 tween 再销毁（ Graphics 被 tween 追着画会炸）。 */
  private destroyStage(): void {
    this.monsterHit?.destroy();
    this.monsterHit = undefined;
    const stage = this.stage;
    if (!stage) return;
    this.stage = undefined;
    stage.monster.destroy();
    stage.playerTag.stop();
    stage.playerTag.root.destroy();
  }

  /** 滑步：tween 代理同时驱动 sprite 与 state.player.x（存档位置一致）。 */
  private slidePlayerTo(x: number): void {
    const player = this.host.playerSprite();
    const from = player.x;
    const dist = x - from;
    if (Math.abs(dist) < 4) {
      player.setFlipX(false); // 面右：敌人从右打来
      return;
    }
    const who = this.host.metaSelectedCharacter();
    player.setFlipX(dist < 0);
    player.play(walkAnimKey(who), true);
    const proxy = { v: from };
    this.host.tweens.add({
      targets: proxy,
      v: x,
      duration: Math.min(700, 260 + Math.abs(dist) * 0.6),
      ease: 'Quad.easeInOut',
      onUpdate: () => this.host.syncPlayerWorldObjects(proxy.v, PLAYER_FEET_Y),
      onComplete: () => {
        if (!player.active) return;
        player.setFlipX(false);
        player.play(idleAnimKey(who), true);
      },
    });
  }

  /** 玩家血量比：头顶血条与飘字共用同一个数。 */
  private playerHpFrac(): number {
    const state = getGame();
    return Math.max(0, state.player.hp) / GAME_CONFIG.player.hpMax;
  }

  /**
   * 飘字：世界坐标，上浮 46px 淡出。depth 压过前景剪影（26）。
   *
   * AG-80：走 FloatTextPool——每次命中 this.add.text 一个新 Text、900ms 后
   * destroy，一场战斗就是几十次「新建 Text + 重烤纹理 + 上传 GPU」。池预建
   * 12 个复用，超发时回收最旧的一个（见 fx.ts 的 FloatTextPool）。调用点
   * 一个都没改：掉血/未命中/反击/行为标签仍然调这一个方法。
   */
  private floatText(x: number, y: number, text: string, color: string): void {
    this.host.spawnFloatText(x, y, text, color);
  }

  /** ambusher 开场偷袭：敌人前冲 + 玩家受伤动画/震屏 + 掉血飘字 + 头顶血条收缩。 */
  private playAmbusherStrike(damage: number): void {
    const stage = this.stage;
    if (!stage) return;
    playSfx('danger');
    this.host.playActionAnim(hurtAnimKey(this.host.metaSelectedCharacter()), 400);
    // AG-91：玩家受击 = medium 档（震屏 0.4 trauma + 50ms 顿帧 + 受击闪白）。
    // 原 AG-72 的 shakeIfEnabled(160, 0.008) 被这套分级表取代——同一事件
    // 全游戏一个入口、一个比例（config/game-balance.json 的 juice 块）。
    // （集成裁决：受击动画取 anim 的 metaSelectedCharacter 按角色播，
    // 反馈取 juice 的分级入口。）
    this.impact('medium', this.host.playerSprite().x, PLAYER_FEET_Y - 48);
    stage.monster.lunge();
    this.host.time.delayedCall(130, () => {
      if (!this.stage) return;
      playSfx('hurt');
      this.floatText(this.host.playerSprite().x, PLAYER_FEET_Y - FRAME_H - 4, `-${damage}`, hex(TEXT.warn));
      this.stage.playerTag.tweenHpTo(this.playerHpFrac(), 200);
    });
  }

  /** 命中：闪白 + 击退（MonsterView.hit）+ 火花 + 掉血飘字 + 敌人血条收缩。 */
  private stageMonsterHit(damage: number): void {
    const state = getGame();
    const stage = this.stage;
    if (!stage || !state.combat) return;
    // AG-91：普通命中 = small 档（trauma 0.15 的轻震、无顿帧无闪白）——
    // 与受击/击杀共用一套比例，打击感的「底噪」。位置取敌人胸口。
    this.impact('small', stage.monster.root.x, stage.monster.chestY);
    playSfx('hurt');
    stage.monster.hit(26);
    stage.monster.tweenHpTo(Math.max(0, state.combat.monster.hp) / state.combat.monster.maxHp, 240);
    // 90ms 后出字与火花——与挥击 clip（320ms）同帧，读作「这一下打中了」。
    this.host.time.delayedCall(90, () => {
      const live = this.stage;
      if (!live) return;
      const mx = live.monster.root.x;
      const cy = live.monster.chestY;
      this.floatText(mx, cy, `-${damage}`, hex(TEXT.warn));
      this.host.playFx('hit-flash', mx, cy, LIGHT_DEPTH + 2);
    });
  }

  /** 未命中：敌人朝玩家侧移闪避（与击退反向）+ 灰色「未命中」。 */
  private stageMonsterDodge(): void {
    const stage = this.stage;
    if (!stage) return;
    stage.monster.dodge();
    this.host.time.delayedCall(110, () => {
      const live = this.stage;
      if (!live) return;
      this.floatText(live.monster.root.x, live.monster.chestY, '未命中', hex(TEXT.dim));
    });
  }

  /** 格挡：沉腰架盾（压缩回弹）+ 招架火花。 */
  private stagePlayerGuard(): void {
    this.host.playFx('parry', this.host.playerSprite().x, PLAYER_FEET_Y - 46, LIGHT_DEPTH + 1, { scale: 1.3 });
    this.host.tweens.add({ targets: this.host.playerSprite(), scaleY: 0.94, duration: 90, yoyo: true, ease: 'Quad.easeOut' });
  }

  /** 敌人反击：前冲 38px + 玩家掉血飘字 + 玩家头顶血条收缩。 */
  private stageMonsterCounter(damage: number): void {
    const stage = this.stage;
    if (!stage) return;
    stage.monster.lunge();
    // 140ms 后落地：与前冲 tween（130ms）同步，飘字贴在挨上的那一刻。
    this.host.time.delayedCall(140, () => {
      const live = this.stage;
      if (!live) return;
      this.floatText(this.host.playerSprite().x, PLAYER_FEET_Y - FRAME_H - 4, `-${damage}`, hex(TEXT.warn));
      live.playerTag.tweenHpTo(this.playerHpFrac(), 200);
    });
  }

  /** 撤退成功：角色跑向层左缘淡出（敌人留在原地），收尾后交还控制。 */
  private playFleeShow(): void {
    this.busy = true;
    const player = this.host.playerSprite();
    const who = this.host.metaSelectedCharacter();
    player.setFlipX(true);
    const runKey = runAnimKey(who);
    player.play(this.host.anims.exists(runKey) ? runKey : walkAnimKey(who), true);
    const targetX = Math.max(48, this.host.floorWidth() * COMBAT_SPOT_PLAYER_FRAC * 0.4);
    const proxy = { v: player.x };
    this.host.tweens.add({
      targets: proxy,
      v: targetX,
      duration: 520,
      ease: 'Quad.easeIn',
      onUpdate: () => this.host.syncPlayerWorldObjects(proxy.v, PLAYER_FEET_Y),
    });
    this.host.tweens.add({ targets: player, alpha: 0, duration: 400, delay: 160 });
    const stage = this.stage;
    if (stage) this.host.tweens.add({ targets: stage.playerTag.root, alpha: 0, duration: 400, delay: 160 });
    this.host.time.delayedCall(560, () => {
      if (!this.host.sceneActive()) return;
      player.setAlpha(1);
      this.close();
      this.host.flash('你撤出了战斗。');
    });
  }

  /**
   * AG-70：战斗界面去文本框化。440×232 的中央文字面板整块拆除——
   *   1. 底部动作条（y 604..656，导航条 672 之下）：攻击/格挡/撤退三个大
   *      按钮，图标 + 效果说明，可点击（panelHit），Enter/↑↓/Esc 语义原样
   *      （onUse/onNavUp/onNavDown/onEsc 的战斗分支一个都没动）；
   *   2. 双方头顶血条在世界坐标随人移动（buildStage，不走本列表）；
   *   3. 回合日志降级成左下角三行半透明小字，主要信息走头顶飘字。
   * 战斗中圆环 HUD 与底部导航条常驻可读——动作条 x 与日志错开，y 全在
   * 660 硬线之内。
   */
  private buildPanel(): void {
    for (const o of this.panelObjects) o.destroy();
    this.panelObjects = [];
    const state = getGame();
    const combat = state.combat;
    if (!combat) return;
    const bar = COMBAT_BAR;
    const bx = combatBarX();
    const depth = PANEL_DEPTH.game.dialogue;
    // 面板点击外区域 = 鼠标 ESC 的逃生门（onPointerDown 读 panelBox）。整个
    // 画布都算「板内」：战斗中移动锁定，点世界不再触发撤退回合；想撤退点
    // 按钮或按 ESC。点敌人剪影出手走 buildStage 的世界热区。
    this.host.setPanelBox({ x: 0, y: 0, w: DESIGN_WIDTH, h: DESIGN_HEIGHT });

    // 裁决记录（merge ag-63）：HEAD 侧为 AG-70 底部动作条（更新的演化），
    // ag-63 侧的中央文字面板为其旧基线，整段让位；ag-63 的语义增量移植到
    // 动作条上——攻击备注不再说「武器伤害」这种废话，实报手里那件与它的
    // 伤害数（口径同战斗脚注：combatWeaponLabel + playerCombatant）。
    const notes: ReadonlyArray<string> = [
      `${combatWeaponLabel(state.player.inventory.slots)} · 伤害 ${playerCombatant(state).damage}`,
      '受伤减半',
      '可能失败',
    ];
    COMBAT_ACTIONS.forEach((act, i) => {
      const x = bx + i * (bar.btnW + bar.gap);
      const y = bar.y;
      const selected = i === this.selected;
      this.panelObjects.push(this.host.add.rectangle(x, y, bar.btnW, bar.btnH, UI.surface).setOrigin(0, 0).setAlpha(0.92).setDepth(depth));
      if (selected) {
        this.panelObjects.push(
          this.host.add.rectangle(x, y, bar.btnW, bar.btnH, UI.accent).setOrigin(0, 0).setAlpha(0.16).setDepth(depth + 1),
          this.host.add.rectangle(x, y, 2, bar.btnH, UI.accent).setOrigin(0, 0).setDepth(depth + 2),
        );
      }
      const iconG = this.host.add.graphics().setDepth(depth + 3);
      this.drawActionIcon(iconG, act.icon, x + 14, y + 18, selected ? PALETTE.lightHigh : TEXT.secondary);
      this.panelObjects.push(iconG);
      this.panelObjects.push(
        this.host.add
          .text(x + 40, y + 16, act.label, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: selected ? hex(PALETTE.lightHigh) : hex(TEXT.primary) })
          .setOrigin(0, 0.5)
          .setDepth(depth + 3),
        this.host.add
          .text(x + 40, y + 38, notes[i], { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.dim) })
          .setOrigin(0, 0.5)
          .setDepth(depth + 3),
        this.host.panelHit(x, y, bar.btnW, bar.btnH, depth + 6, {
          onClick: () =>
            this.host.time.delayedCall(0, () => {
              this.selected = i;
              this.buildPanel();
              this.enter();
            }),
        }),
      );
    });

    // 回合日志：左下角三行小字半透明。最新一行亮、旧的压暗——「刚刚发生了
    // 什么」仍然可读，但不再占据屏幕中央。
    const tail = combat.log.slice(-3);
    tail.forEach((line, i) => {
      this.panelObjects.push(
        this.host.add
          .text(bar.logX, bar.logY + i * bar.logPitch, line, {
            fontFamily: FONT_FAMILY,
            fontSize: `${TYPE.caption}px`,
            color: i === tail.length - 1 ? hex(TEXT.primary) : hex(TEXT.dim),
            wordWrap: { width: bar.logW },
          })
          .setOrigin(0, 0)
          .setAlpha(i === tail.length - 1 ? 0.85 : 0.55)
          .setDepth(depth),
      );
    });

    // 「第 N 回合」：动作条上方居中，半透明——节奏感不抢戏。
    // 裁决记录（merge ag-63）：ag-63 把行为标签放在中央面板的血条读数行，
    // AG-70 已无该面板；标签移植到此行——「伏击」「怯战」是 monsters.ts 名册
    // 的设计意图，玩家看见一只怪就知道这回合该怎么打。
    this.panelObjects.push(
      this.host.add
        .text(DESIGN_WIDTH / 2, bar.turnY, `第 ${combat.turn} 回合 · ${combatBehaviorLabel(combat.monster.behavior)}`, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.secondary) })
        .setOrigin(0.5, 0.5)
        .setAlpha(0.8)
        .setDepth(depth),
    );

    lockToScreen(this.panelObjects);
  }

  /**
   * 动作条图元：16px 盒内三枚程序化小图——攻击（斜斩刃）、格挡（盾）、
   * 撤退（左向奔跑箭）。与敌人剪影同一纪律：不新画贴图，Graphics 现画。
   */
  private drawActionIcon(g: Phaser.GameObjects.Graphics, kind: CombatActionIcon, x: number, y: number, color: number): void {
    g.fillStyle(color, 1);
    if (kind === 'attack') {
      // 斜斩：一道宽刃楔形 + 护手。
      g.fillTriangle(x + 2, y + 14, x + 14, y + 2, x + 14, y + 5);
      g.fillRect(x + 1, y + 12, 4, 3);
    } else if (kind === 'guard') {
      // 盾：方首 + 尖底 + 甲心高光。
      g.fillRect(x + 3, y + 2, 10, 8);
      g.fillTriangle(x + 3, y + 10, x + 13, y + 10, x + 8, y + 14);
      g.fillStyle(PALETTE.stone, 0.9);
      g.fillRect(x + 7, y + 4, 2, 6);
    } else {
      // 撤退：左箭头 + 杆 + 两道速度线。
      g.fillTriangle(x + 2, y + 8, x + 7, y + 3, x + 7, y + 13);
      g.fillRect(x + 7, y + 7, 8, 2);
      g.fillRect(x + 11, y + 3, 3, 1);
      g.fillRect(x + 13, y + 12, 2, 1);
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
    if (action === 'attack') this.host.playSwingFx(round.monsterDead);
    if (action === 'guard' && round.monsterDamage > 0 && !round.fled) {
      this.host.playFx('parry', state.player.x + 10, PLAYER_FEET_Y - 50, LIGHT_DEPTH + 1, { scale: 1.3 });
    }
    if (round.monsterDamage > 0 && !round.fled) {
      this.host.playFx('hit-flash', state.player.x, PLAYER_FEET_Y - 48, LIGHT_DEPTH + 2);
    }
  }

  // One turn: the engine resolves the round, this method lands the numbers on
  // state and decides whether the fight continues.
  private activateChoice(): void {
    const state = getGame();
    const combat = state.combat;
    if (!combat) return;
    // AG-70：撤退演出期间（角色跑向边缘淡出）任何输入都不再结算回合。
    if (this.busy) return;
    const action = (['attack', 'guard', 'flee'] as const)[this.selected];
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
    // （AG-90：key 按 meta 选的当前角色取——原来硬编码 'player'，玩 Alin 时
    // 出手会闪一下玩家的贴图；GIF 换血后每个角色有自己的 attack 动画。）
    if (action === 'attack') this.host.playActionAnim(attackAnimKey(this.host.metaSelectedCharacter()), 320);
    if (round.playerDamage > 0) {
      combat.monster.hp = Math.max(0, combat.monster.hp - round.playerDamage);
      bumpStat(state, 'damageDealt', round.playerDamage); // AG-81：命中的每一口都计数
      // AG-70：命中要看见——敌人闪白、击退、掉血飘字、头顶血条收缩。
      this.stageMonsterHit(round.playerDamage);
    } else if (action === 'attack') {
      // 未命中：敌人侧移闪避，与击退反向，读法不同。
      this.stageMonsterDodge();
    }
    if (action === 'guard') {
      state.player.energy = Math.min(GAME_CONFIG.player.energyMax, state.player.energy + GUARD_ENERGY_RESTORE);
      // AG-70：格挡招架——沉腰架盾 + 火花。
      this.stagePlayerGuard();
    }
    if (round.monsterDamage > 0 && !round.monsterDead && !round.fled) {
      // A coward that dropped below its threshold breaks off the fight and
      // runs — the player keeps what they already did to it.
      const cowardFrac = behaviorModifiers('coward').fleeAtHpFrac;
      if (combat.monster.behavior === 'coward' && cowardFrac > 0 && combat.monster.hp / combat.monster.maxHp < cowardFrac) {
        combat.log.push(`${combat.monster.name} 伤痕累累地逃走了。`);
        // AG-70：战退演出——敌人滑出战场淡出，再接 outcome 面板。
        this.stage?.monster.fleeAway();
        this.finish('coward');
        return;
      }
      // OVERHAUL Wave B2/B3: the guardian totem and easy mode both soften the
      // hit the player takes; the relic applies to any monster, the mode only
      // to the guardian.
      const soften = (combat.kind === 'boss' ? guardianDamageMult(state.relics ?? []) * modeGuardianDamageMult(state.mode ?? 'adventure') : guardianDamageMult(state.relics ?? []));
      const dmg = Math.max(1, Math.round(round.monsterDamage * soften));
      state.player.hp = Math.max(0, state.player.hp - dmg);
      // 裁决记录（merge ag-81）：同上——AG-77 成就判据（控制器里的本场受伤
      // 计数）与 AG-81 统计（bumpStat）两套记账并存。
      bumpStat(state, 'damageTaken', dmg); // AG-81：敌人反击命中计数（软化后的实扣）
      this.host.noteCombatDamage(dmg); // AG-77：零伤守门人的判据在这里记账
      if (action === 'guard') this.host.playActionAnim(hurtAnimKey(this.host.metaSelectedCharacter()), 400);
      // AG-91：敌人反击命中 = medium 档（震屏 0.4 trauma + 50ms 顿帧 + 受击
      // 闪白）。原 AG-72 的 shakeIfEnabled(160, 0.008) 被分级表取代。
      // （集成裁决：受击动画取 anim 的 metaSelectedCharacter 按角色播，
      // 反馈取 juice 的分级入口。）
      this.impact('medium', this.host.playerSprite().x, PLAYER_FEET_Y - 48);
      // AG-70：敌人反击要看见——前冲 38px + 玩家掉血飘字 + 头顶血条收缩。
      this.stageMonsterCounter(dmg);
    }
    combat.turn += 1;
    this.host.refreshStats();

    if (round.playerDead || state.player.hp <= 0) {
      state.player.hp = 0;
      state.status = 'lost';
      bumpStat(state, 'deaths'); // AG-81：战死计数
      // AG-91：玩家阵亡 = large 档（满 trauma + 120ms 顿帧 + 闪白 + 缩放）——
      // 倒下的最后一击要有全场最重的那一下，再进 End 场景。
      this.impact('large', this.host.playerSprite().x, PLAYER_FEET_Y - 48);
      saveToStorage(state);
      // AG-90：战死也倒地——原来这里直接 scene.start('End')，玩家的最后一
      // 帧是战斗面板。与世界循环的死亡同一演法：die clip 播完（GIF 3x900ms）
      // 再切结局卡。busy 锁死输入，延迟切场不会塞进新回合（也不会
      // 重复结算一次战死计数）。
      this.busy = true;
      const dieKey = dieAnimKey(this.host.metaSelectedCharacter());
      this.host.playActionAnim(dieKey, 520);
      this.host.time.delayedCall(charAnimHoldMs(dieKey, 520) + 100, () => {
        if (this.host.sceneActive()) this.host.startEndScene();
      });
      return;
    }
    if (round.monsterDead) {
      // AG-91：击杀 = large 档。位置取敌人胸口（die 之前抓——倒地后 root 会
      // 被 tween 挪走）。与上面 stageMonsterHit 的 small 档同帧叠加：trauma
      // 0.15+1.0 钳到 1.0，顿帧取 max(0,120)=120ms，读作「这下打实了」。
      const stage = this.stage;
      if (stage) this.impact('large', stage.monster.root.x, stage.monster.chestY);
      // AG-70：阵亡演出——闪白、倒地、淡出（outcome 面板同时升起，不抢戏）。
      this.stage?.monster.die();
      this.finish('win');
      return;
    }
    if (round.fled) {
      // A successful retreat costs nothing and leaves the spot un-resolved —
      // the player can come back with a better plan (or a crowbar).
      combat.log.push('你成功撤出。');
      saveToStorage(state);
      // AG-70：撤退成功看得见——角色跑向层左缘淡出，敌人留在原地；560ms
      // 后 close 收尾（期间 busy 锁死输入，不会半空再结算）。
      this.playFleeShow();
      return;
    }
    saveToStorage(state);
    this.buildPanel();
  }

  // Combat over: pay out, consume the spot, close.
  private finish(outcome: 'win' | 'coward'): void {
    const state = getGame();
    const combat = state.combat;
    if (!combat) return;
    const isBoss = combat.kind === 'boss';
    if (outcome === 'win') {
      bumpStat(state, 'monstersKilled'); // AG-81：只有真杀掉才计数（逃走的 coward 不算）
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
        if (r.overflow === 0) { taken.push({ itemId, quantity: qty }); this.host.addLootThisTrip(qty); }
      }
      const names = taken.map((s) => `${getItem(s.itemId).displayName}×${s.quantity}`).join('、');
      combat.log.push(isBoss ? `守门人倒下了。你搜出：${names || '（背包已满）'}` : `你击败了 ${combat.monster.name}。战利品：${names || '（背包已满）'}`);
      if (isBoss) {
        state.records = { deepestFloor: Math.max(state.records?.deepestFloor ?? 0, state.currentFloor), bestScore: (state.records?.bestScore ?? 0) + 200 };
        combat.log.push('上楼的路通了。分数 +200');
        // AG-77：零伤害击败守门人（本场累计受伤为 0 才算）。
        this.host.emitBossWon(this.host.combatDamageTaken());
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
    this.host.refreshStats();
    // Show the outcome for one more Enter, same as the non-combat panel.
    for (const o of this.panelObjects) o.destroy();
    this.panelObjects = [];
    const { width, height } = this.host.viewSize();
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
    this.panelObjects.push(...buildPanel(this.sharedScene, cx, cy, outW, outH, 'yellow', outDepth));
    this.panelObjects.push(...buildPanelHeader(this.sharedScene, outLeft, outTop, outW, headline, UI.good, outDepth + 5));
    this.panelObjects.push(...buildPanelWell(this.sharedScene, outLeft + 12, outTop + 26, outW - 24, 62, outDepth + 5));
    const tail = combat.log.slice(-3);
    tail.forEach((line, i) => {
      this.panelObjects.push(
        this.host.add
          .text(outLeft + 20, outTop + 38 + i * 17, line, {
            fontFamily: FONT_FAMILY,
            fontSize: `${TYPE.caption}px`,
            color: i === tail.length - 1 ? hex(TEXT.primary) : hex(TEXT.dim),
            wordWrap: { width: outW - 40 },
          })
          .setDepth(outDepth + 7),
      );
    });
    this.panelObjects.push(
      this.host.add
        .text(cx, outTop + outH - 12, 'Enter / ESC 继续', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.dim) })
        .setOrigin(0.5)
        .setDepth(outDepth + 7),
    );
    lockToScreen(this.panelObjects);
    // The fight is over: the outcome screen waits for one Enter, then
    // close() clears state.combat and the floor's spots.
    this.done = true;
    state.combat = { ...combat, log: combat.log };
  }
}
