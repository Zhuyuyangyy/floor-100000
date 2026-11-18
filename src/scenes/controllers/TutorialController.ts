// AG-73：新手教程（TWOM 式六步：移动/搜刮/圆环/制作/爬梯/床）——RC-03 拆分
// 第 3 步。从 GameScene 迁出（原 GameScene.ts 840-845 的收尾延迟常量 +
// 1012-1025 字段组 + 5052-5233 教程段，接线点剩 create/update/onEsc/
// refreshNavBar 四处），行为零变更：同一构造路径、同一推进判定（含 RC-02
// XP-3 的床步三选一）、同一显隐契约（QA 第 1 轮 R2 的 tutorialSkipShown）、
// 同一呼吸几何与收尾时序（夜里 1700ms 延迟）。
//
// 形态（设计文档 §2，沿用前两步的主机结构面模式）：plain TS 类，**不 import
// Phaser 场景类型**——
//   * 构造拿 host（TutorialHost：add 工厂/time/framedButton 与若干场景查询
//     面——GameScene 天然满足）与 storage（TutorialSystem 的 TutorialStorage：
//     场景传 localStorage，单测传 Map 假件——与 tutorial.test.ts 同款）。
//   * import 链（render/panels、render/uiKit、render/palette、render/pointer
//     [type-only]、core/design、systems/TutorialSystem、systems/
//     SurvivalSystem、data/tutorial、core/session）均无 Phaser 值导入——
//     Node 下可用记录型假件单测（src/tests/tutorialController.test.ts）。
//   * 显示器持有并管理自己的 GameObjects：呼吸框/圆环框/跳过按钮四件的
//     生命周期全在本类（init() 先毁再建——场景重启不清显示列表，Phaser 4 的
//     shutdown 只空纹理），GameScene 只留 init/tick 两处委托加 Esc/开局
//     flash/导航条三个读数面。
//
// 两条不变量（迁移中逐字保留）：
//   · lastX 每帧都更新（推进判定之前）——教程终态后传送也照记，续上局接着算；
//   · 跳过按钮 flag 的契约是「零件此刻处于可见态」（R2 修复，见 init 末段）。

import type Phaser from 'phaser';
import type { ButtonColors } from '../../render/pointer';
import { HUD_FEEDBACK_DEPTH } from '../../render/panels';
import { UI } from '../../render/uiKit';
import { PALETTE, TEXT, hex } from '../../render/palette';
import { DESIGN_WIDTH } from '../../core/design';
import { getGame } from '../../core/session';
import { isNight } from '../../systems/SurvivalSystem';
import {
  freshTutorial,
  hasOpenedAnyContainer,
  loadTutorial,
  saveTutorial,
  skipTutorial,
  tickTutorial,
  tutorialActive,
  tutorialHighlight,
  tutorialHintVisible,
  tutorialYieldsToWorld,
  type TutorialState,
  type TutorialStorage,
  type TutorialWorld,
} from '../../systems/TutorialSystem';
import { TUTORIAL_DONE_LINE, TUTORIAL_SKIP_LABEL, TUTORIAL_SKIP_LINE, TUTORIAL_STEPS } from '../../data/tutorial';

/**
 * AG-73 教程收尾 flash 的入夜推迟量：flash() 的驻留 1600ms + 100ms 气口。
 * 入夜推进的收尾与夜事件 flash 同帧相撞（后者盖掉前者），夜里收尾时让收尾语
 * 排到事件消息之后——缘由见 tick() 的 completed 分支。
 */
const TUTORIAL_DONE_FLASH_DELAY_MS = 1700;

/**
 * 控制器需要场景提供的最小面（GameScene 天然满足；单测用假件实现）。
 * 刻意不 import Phaser.Scene：本类的可测性靠这层结构面，而不是靠能造真场景。
 */
export interface TutorialHost {
  /** Phaser 的 GameObject 工厂——世界呼吸框与 HUD 圆环框从它出生。 */
  add: Phaser.GameObjects.GameObjectFactory;
  /** 场景时钟——呼吸相位读 now、夜里收尾的延迟 flash 走 delayedCall。 */
  time: Phaser.Time.Clock;
  /**
   * 共享 framedButton（render/pointer）——跳过按钮四件（底/边/签/热区）从它
   * 出生。它的第一参钉死 Phaser.Scene，由场景侧薄封装注入（运行期就是
   * GameScene 调共享件传自己），按钮的 hitRect/显隐语义因此不重造。
   */
  framedButton(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    depth: number,
    onClick: () => void,
    colors: ButtonColors,
  ): Phaser.GameObjects.GameObject[];
  /** 场景此刻活着没有——夜收尾的延迟 flash 落地前的那一问。 */
  sceneActive(): boolean;
  /** 任何面板开着没有——按钮显隐与 Esc 跳过同款门（面板里免误触）。 */
  anyPanelOpen(): boolean;
  /** 爬梯动画进行中——按钮隐藏、呼吸框收起。 */
  stairClimbing(): boolean;
  /** 制作面板开着没有——第 4 步（制作）的完成条件。 */
  craftingPanelOpen(): boolean;
  /** 本层视图容器的坐标（出现判定与高亮几何共用的世界快照）。 */
  containers(): Array<{ id: string; x: number }>;
  /**
   * 站到自己床边没有（起始层 + 交互距离）——RC-02 XP-3 床步的第三条完成
   * 路径。判定纯读 state + 常量，且场景另有非教程调用方（床铺交互），
   * 故实现留场景、控制器经这层查询面摄入（信号组装集中在 tick 一处）。
   */
  isNearBed(): boolean;
  /** contextual 槽的世界链当前文本——让位判据（世界在教同一个 E 动作）。 */
  worldHintText(): string;
  /** HUD 反馈行一行——跳过语与六步全过的收尾语。 */
  flash(message: string): void;
}

export class TutorialController {
  /** 进度状态（TutorialSystem 的纯数据；推进判定与落盘都在本类）。 */
  private progress: TutorialState = freshTutorial(0);
  /** 上一帧的玩家 x：累计位移只认「位置变了」，传送也算（检测钩子不问怎么变的）。 */
  private lastX = 0;
  private worldGfx?: Phaser.GameObjects.Graphics;
  private hudGfx?: Phaser.GameObjects.Graphics;
  /** 跳过按钮四件（底/边/签/热区），framedButton 的返回序。 */
  private skipParts: Phaser.GameObjects.GameObject[] = [];
  /** 按钮当前可见性，免得每帧 setVisible。 */
  private skipShown = false;

  constructor(
    private readonly host: TutorialHost,
    private readonly storage: TutorialStorage,
  ) {}

  // ── 读数面（场景接线与 ag73 e2e 探针） ───────────────────────────────────

  /** 教程进行中（场景 Esc 早退与开局 flash 读这一位）。 */
  get isActive(): boolean {
    return tutorialActive(this.progress);
  }

  /** 已完成步数（ag73 e2e 读数面；6 = 六步全过）。 */
  get step(): number {
    return this.progress.step;
  }

  /** 本机跳过过没有（ag73 e2e 读数面）。 */
  get skipped(): boolean {
    return this.progress.skipped;
  }

  /** 世界呼吸框当前可见性（ag73 e2e 读数面）。 */
  get worldGfxVisible(): boolean {
    return this.worldGfx?.visible === true;
  }

  /** HUD 圆环框当前可见性（ag73 e2e 读数面）。 */
  get hudGfxVisible(): boolean {
    return this.hudGfx?.visible === true;
  }

  /** 场景侧的楼层上下文快照（出现判定与高亮几何共用一份）。 */
  private world(): TutorialWorld {
    const state = getGame();
    return {
      playerX: state.player.x,
      currentFloor: state.currentFloor,
      containers: this.host.containers(),
      openedIds: state.visitedFloors[state.currentFloor]?.openedContainers ?? [],
    };
  }

  // ── 生命周期 ─────────────────────────────────────────────────────────────

  /**
   * create() 尾部调用一次（开局 flash 之前——flash 要读教程激活与否）。
   * 先销毁再建：场景重启不清显示列表（Phaser 4 的 shutdown 只空纹理），
   * 上一轮的呼吸框/按钮会双份挂在坏纹理上。
   */
  init(): void {
    this.worldGfx?.destroy();
    this.hudGfx?.destroy();
    for (const o of this.skipParts) o.destroy();
    this.skipParts = [];
    this.progress = loadTutorial(this.storage, this.host.time.now);
    this.lastX = getGame().player.x;
    // 世界坐标呼吸框：depth 30——压得住前景剪影（26）与全部楼层道具，又在
    // HUD 上下文带（100）之下，永远不会爬进屏幕带。
    this.worldGfx = this.host.add.graphics().setDepth(30);
    // HUD 圆环高亮（第 3 步）：屏幕坐标，压在 HUD 反馈层（300）之上。
    this.hudGfx = this.host.add.graphics().setScrollFactor(0).setDepth(HUD_FEEDBACK_DEPTH + 2);
    // 跳过按钮：右上、环境行（80..105）下方，不压目标行/chips/状态卡/导航条。
    // framedButton 的 hitRect 自带 stopPropagation，点它不会顺便被读成走位。
    // scrollFactor 0：相机跟随角色时 scrollY 会到 -200（楼层带居中在屏中），
    // 默认 (1,1) 会把整块按钮渲染到画布顶上——点击落进世界，变成走位订单。
    const w = 108;
    const h = 30;
    this.skipParts = this.host.framedButton(
      DESIGN_WIDTH - 16 - w,
      112,
      w,
      h,
      TUTORIAL_SKIP_LABEL,
      HUD_FEEDBACK_DEPTH,
      () => this.skip(),
      { fill: UI.surfaceRaised, line: PALETTE.stoneLight, text: hex(TEXT.secondary), hover: PALETTE.lightHigh },
    );
    for (const o of this.skipParts) {
      (o as Phaser.GameObjects.GameObject & { setScrollFactor(x: number, y?: number): void }).setScrollFactor(0);
    }
    // 具名 hud-*：存量 e2e 的面板文本采集按名字跳过它（它是 HUD，不是面板）。
    this.skipParts[2]?.setName('hud-tutorial-skip');
    // QA 第 1 轮 R2 修复：flag 的契约是「零件此刻处于可见态」，而上面
    // framedButton 新建的四个零件（底/边/字/hitRect）默认可见——所以这里必须
    // 记 true。记 false 时，refreshTutorialChrome 的相等守卫
    // （showButton !== flag）在终态教程（上局跳过/完成 → showButton=false）
    // 下判定「无需转换」，新建零件就带着默认可见态挂完整局：右上角「跳过
    // 教程」按钮对开局即终态的玩家残留。记 true 后：终态 → false!==true 走
    // 转换收起；新教程 → showButton=true 与 flag 相等，零件本就可见，无需
    // 转换。局内跳过/完成（状态翻转 true→false）本就走转换分支，不受影响。
    this.skipShown = true;
    this.refreshChrome();
  }

  /** update() 里紧跟 refreshNavBar 的那一行。 */
  tick(): void {
    const state = getGame();
    const dx = Math.abs(state.player.x - this.lastX);
    this.lastX = state.player.x;
    if (tutorialActive(this.progress)) {
      const result = tickTutorial(this.progress, {
        now: this.host.time.now,
        signals: {
          dx,
          hasOpenedContainer: hasOpenedAnyContainer(state.visitedFloors),
          craftingOpen: this.host.craftingPanelOpen(),
          currentFloor: state.currentFloor,
          minuteOfDay: state.gameMinuteOfDay,
          slept: state.shelterPlan?.resolved === true,
          // RC-02 XP-3：床步的第三条完成路径——站到自己床边即「知道床在
          // 哪」，教程不必从早上悬到入夜（isNearBed 判起始层 + 交互距离）。
          nearBed: this.host.isNearBed(),
        },
      });
      this.progress = result.state;
      if (result.advanced) saveTutorial(this.progress, this.storage);
      if (result.completed) {
        // RC-02：入夜推进的收尾与夜事件 roll 同在 update() 同帧——夜事件的
        // flash 在世界模拟段（本帧稍后，ensureNightEvent 处）会整条盖掉收尾
        // 语，于是「入夜收尾」的玩家从来没见过「你已掌握基本生存」（探针
        // fix-xp23/probe-xp23c 实证：flash 只剩事件消息）。夜里收尾（且不是
        // 睡过的——那条路有自己的醒来 flash）时让收尾语排到事件消息后面：
        // 消息亮满 flash 驻留（1600ms）后收尾语接手，两句都看得见。
        const nightRollover = isNight(state.gameMinuteOfDay) && state.shelterPlan?.resolved !== true;
        if (nightRollover) {
          this.host.time.delayedCall(TUTORIAL_DONE_FLASH_DELAY_MS, () => {
            if (this.host.sceneActive()) this.host.flash(TUTORIAL_DONE_LINE);
          });
        } else {
          this.host.flash(TUTORIAL_DONE_LINE);
        }
      }
    }
    this.refreshChrome();
  }

  /**
   * contextual 槽的教程分支（refreshNavBar 显示链的第三环）。教程激活、
   * 本步的出现条件过了，才接管；一种情况让世界说——世界正在教本步目标物
   * 的同一个 E 动作（贴近柜子时的「[E] 打开 储物柜」），它的键帽版比教程
   * 文案更短更准。理由见 refreshNavBar 的注释。
   */
  navHint(): string | null {
    if (!tutorialActive(this.progress)) return null;
    const world = this.world();
    if (!tutorialHintVisible(this.progress, world)) return null;
    if (this.host.worldHintText().startsWith('按 E ') && tutorialYieldsToWorld(this.progress, world)) return null;
    return TUTORIAL_STEPS[this.progress.step]?.hint ?? null;
  }

  /** 跳过：localStorage 记终态（本机永不再弹），按钮/高亮当场收起。 */
  skip(): void {
    this.progress = skipTutorial(this.progress, this.storage);
    this.refreshChrome();
    this.host.flash(TUTORIAL_SKIP_LINE);
  }

  /**
   * 呼吸框与跳过按钮。每帧跑：世界目标按当前楼层重算（柜子在哪框哪，爬梯
   * 态不收），HUD 圆环框只服务第 3 步。alpha 走正弦——呼吸，不是闪烁。
   */
  private refreshChrome(): void {
    const worldGfx = this.worldGfx;
    const hudGfx = this.hudGfx;
    if (!worldGfx || !hudGfx) return;
    // 跳过按钮：教程在进行、且没有面板/爬梯占屏时才在。面板里藏起来是为
    // 了免误触——制作树支持拖拽平移，从按钮位置起手会把「挪视图」变成
    // 「跳教程」；Esc 跳过的早退同样只在无面板时生效，两边一致。
    const showButton = tutorialActive(this.progress) && !this.host.anyPanelOpen() && !this.host.stairClimbing();
    if (showButton !== this.skipShown) {
      this.skipShown = showButton;
      for (const o of this.skipParts) {
        (o as Phaser.GameObjects.GameObject & { setVisible(v: boolean): void }).setVisible(showButton);
      }
    }
    if (!tutorialActive(this.progress) || this.host.stairClimbing()) {
      // 收框只做一次：之后每帧只是两个 visible 检查。
      if (worldGfx.visible) {
        worldGfx.clear();
        worldGfx.setVisible(false);
      }
      if (hudGfx.visible) {
        hudGfx.clear();
        hudGfx.setVisible(false);
      }
      return;
    }
    const box = tutorialHighlight(this.progress, this.world());
    const pulse = 0.3 + 0.25 * Math.sin(this.host.time.now / 260);
    worldGfx.clear();
    hudGfx.clear();
    if (box?.space === 'world') {
      worldGfx.setVisible(true);
      worldGfx.fillStyle(PALETTE.light, 0.08);
      worldGfx.fillRect(box.x, box.y, box.w, box.h);
      worldGfx.lineStyle(2, PALETTE.lightHigh, pulse);
      worldGfx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
    } else {
      worldGfx.setVisible(false);
    }
    if (box?.space === 'hud') {
      hudGfx.setVisible(true);
      hudGfx.lineStyle(2, PALETTE.lightHigh, pulse);
      hudGfx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
    } else {
      hudGfx.setVisible(false);
    }
  }
}
