// AG-80：性能层（飘字池 / 帧预算守卫 / FPS 计数器 / 降级）——RC-03 拆分
// 第 4 步。从 GameScene 迁出（原 GameScene.ts 性能层段：字段组 +
// initPerfLayer/buildPerfHud/togglePerfHud/updatePerfGuard/refreshPerfHud/
// applyPerfDegrade 六方法 + F3 稳定处理器），行为零变更：同一构造路径
// （create() 里 drawFloor 之前）、同一 tick 位置（update() 里全部早退分支
// 之前——AG-80 注释的「爬梯/面板/战斗全程覆盖」）、同一 500ms 节流与按值
// 缓存、同一降级边沿两开关、同一几何与色板（hudLayout.fpsX/fpsY）。
//
// 形态（设计文档 §2，沿用前三步的主机结构面模式）：plain TS 类，**不 import
// Phaser 场景类型**——
//   * 构造拿 host（PerfHost：add 工厂/time/game/input 四个 Phaser 单子 +
//     三个场景查询面——GameScene 天然满足）；
//   * 纯逻辑三件套（FrameBudgetGuard/FloatTextPool/setFxDegraded）留在
//     render/fx.ts（AG-80 原地，perf.test.ts 23 例直测）——本类只做编排：
//     每帧喂守卫、降级边沿翻两个开关、F3 计数器刷新；
//   * FloatTextPool 构造与 setFxDegraded 的第一参钉死 Phaser.Scene，由
//     host 两个同名薄封装注入（createFloatTextPool/setFxDegraded，与
//     TutorialHost 的 framedButton 同款路数）——运行期 host 就是 GameScene
//     实例，Node 下可用记录型假件单测（src/tests/perfController.test.ts）；
//   * 显示器持有并管理自己的 GameObject：FPS 计数器 Text 的生命周期全在
//     本类（init() 先毁再建——场景重启不清显示列表，Phaser 4 的 shutdown
//     只空纹理），GameScene 残留面：字段一行 + create 的 init() 一行 +
//     update 的 tick 一行 + combatFloatText 一行委托。

import type Phaser from 'phaser';
import { FrameBudgetGuard, type FloatTextPool } from '../../render/fx';
import { FONT_FAMILY, TYPE } from '../../render/uiKit';
import { TEXT, hex } from '../../render/palette';
import { HUD_FEEDBACK_DEPTH } from '../../render/panels';
import { HUD_LAYOUT } from '../../render/hudLayout';
import { DUST_DEPTH } from '../../render/lighting';

/**
 * 控制器需要场景提供的最小面（GameScene 天然满足；单测用假件实现）。
 * 刻意不 import Phaser.Scene：本类的可测性靠这层结构面，而不是靠能造真场景。
 */
export interface PerfHost {
  /** Phaser 的 GameObject 工厂——FPS 计数器 Text 从它出生。 */
  add: Phaser.GameObjects.GameObjectFactory;
  /** 场景时钟——计数器 500ms 节流读 now。 */
  time: Phaser.Time.Clock;
  /** 游戏本体——F3 一帧只认一次读 getFrame()（系统自动重复不会一帧翻两次）。 */
  game: Phaser.Game;
  /** 输入插件——keydown-F3 的 off/on 绑定（keyboard 可能为 null）。 */
  input: Phaser.Input.InputPlugin;
  /**
   * 新建飘字池：共享件 FloatTextPool 的第一参钉死 Phaser.Scene，由场景薄
   * 封装注入（运行期即 new FloatTextPool(scene, { depth })）。depth 传
   * DUST_DEPTH + 4——飘字压过前景剪影，与池化前未池化的 Text 同一深度。
   */
  createFloatTextPool(depth: number): FloatTextPool;
  /** 降级边沿的粒子总闸（fx.ts setFxDegraded 的场景薄封装）。 */
  setFxDegraded(on: boolean): void;
  /**
   * 降级边沿的敌人待机呼吸停帧（MonsterView.setBreathing）。战斗舞台
   * （combatStage）归场景管（第 7 步 CombatController 的目的地），控制器经
   * 这层查询面摄入——无战斗时 no-op。
   */
  setMonsterBreathing(on: boolean): void;
}

export class PerfController {
  /** AG-80：飘字池。场景重启时 init() 先拆旧的再建新的。 */
  private floatText?: FloatTextPool;
  /** AG-80：帧预算守卫（纯逻辑在 fx.ts，Node 直测）。 */
  private guard?: FrameBudgetGuard;
  /** AG-80：当前是否处于降级态（守卫边沿写它，计数器读它）。 */
  private degraded = false;
  /** AG-80：FPS 计数器文本（scrollFactor 0，默认不可见）。 */
  private hudText?: Phaser.GameObjects.Text;
  private hudVisible = false;
  /** 上次刷新计数器的场景时间（500ms 节流 + 按值缓存，不重烤纹理）。 */
  private hudLast = Number.NEGATIVE_INFINITY;
  private hudShown = '';
  /** F3 一帧只认一次（系统自动重复不会一帧翻两次）。 */
  private keyFrame = -1;
  /** F3 的稳定处理器引用：重启时 off 再 on，不叠第二份监听。 */
  private readonly keyHandler = (): void => {
    const frame = this.host.game.getFrame();
    if (frame === this.keyFrame) return;
    this.keyFrame = frame;
    this.toggleHud();
  };

  constructor(private readonly host: PerfHost) {}

  /**
   * AG-80：建/重建性能层。create() 里 drawFloor 之前调——drawFloor 过程中的
   * 搜刮飘字与之后的战斗飘字都要用池。重启时字段初始化器不重跑，旧池要先拆：
   * 它的 Text 还在 display list 里，不拆就会留下一份播完的幽灵字。
   */
  init(): void {
    this.floatText?.destroy();
    this.floatText = this.host.createFloatTextPool(DUST_DEPTH + 4);
    this.guard = new FrameBudgetGuard({ onDegrade: (on) => this.applyDegrade(on) });
    this.buildHud();
    const kb = this.host.input.keyboard;
    if (kb) {
      kb.off('keydown-F3', this.keyHandler);
      kb.on('keydown-F3', this.keyHandler);
    }
  }

  /**
   * AG-80：每帧喂帧时间；计数器可见时按 500ms 节流刷新。放在 stairClimb
   * 分支与全部面板早退之前——爬梯和开面板正是最重的几帧，那才是最该被
   * 守卫覆盖的状态。调用位（update() 里 syncWeapon 之后、updateJuice 与
   * 全部早退分支之前）随迁不变。
   */
  tick(delta: number): void {
    this.guard?.sample(delta);
    if (!this.hudVisible) return;
    if (this.host.time.now - this.hudLast < 500) return;
    this.refreshHud(false);
  }

  /** 战斗飘字入口（combatFloatText 的下游）：掉血/未命中/反击/行为标签都走这。 */
  spawnFloatText(x: number, y: number, text: string, color: string): void {
    this.floatText?.spawn(x, y, text, color);
  }

  // ── 读数面（perf-probe.mjs 取证） ─────────────────────────────────────────

  /** 当前降级态（守卫边沿与强制切换都写它）。 */
  get isDegraded(): boolean {
    return this.degraded;
  }

  /** F3 计数器当前文案（取证：refreshHud 的产物，降级时缀「· 降级」）。 */
  get counterText(): string {
    return this.hudText?.text ?? '';
  }

  /** F3 计数器当前颜色（取证：平时 TEXT.secondary，降级时转 TEXT.warn）。 */
  get counterColor(): string {
    // Phaser 的 style.color 是 string|CanvasGradient|CanvasPattern 联合；
    // 本计数器只走 setColor('#rrggbb')，渐变/图案分支永不出现。
    const c = this.hudText?.style.color;
    return typeof c === 'string' ? c : '';
  }

  /** 飘字池规模（取证：created 恒等于池容量、active ≤ 容量——「池化」的读数）。 */
  get floatTextCounts(): { created: number; active: number } {
    return { created: this.floatText?.createdCount ?? 0, active: this.floatText?.activeCount ?? 0 };
  }

  /**
   * AG-80：降级边沿（FrameBudgetGuard 的 onDegrade）。进：粒子整体关停
   * （host.setFxDegraded → playFx no-op，含一次性的火花/闪白/挥击与地面的火）
   * + 敌人待机呼吸停帧；出：两样都恢复，下次 playFx 照常。计数器立刻反映
   * 状态——玩家该知道画面为什么变素了，以及这是暂时的。
   * public：守卫边沿的落点，兼 perf-probe.mjs 的强制降级取证面（真实触发
   * 要帧时间持续 >25ms，探针机器上是 2-3ms/帧等不到——只验开关与显示，
   * 不验触发本身；触发阈值由 src/tests/perf.test.ts 的守卫单测钉住）。
   */
  applyDegrade(on: boolean): void {
    this.degraded = on;
    this.host.setFxDegraded(on);
    this.host.setMonsterBreathing(!on);
    this.refreshHud(true);
  }

  /**
   * AG-80：FPS 计数器。右上角逐个（hudLayout.fpsX/fpsY），caption 20px、
   * 16 色板内的 TEXT.secondary，降级时转 TEXT.warn 并缀「· 降级」。自带
   * 0b0f12 底板（hud-feedback 同款读法）——计数器在世界腰带上，世界再亮
   * 也读得清。默认不可见，e2e 的 HUD 取证因此不受影响。
   */
  private buildHud(): void {
    this.hudText = this.host.add
      .text(HUD_LAYOUT.fpsX, HUD_LAYOUT.fpsY, '', {
        fontFamily: FONT_FAMILY,
        fontSize: `${TYPE.caption}px`,
        color: hex(TEXT.secondary),
        backgroundColor: '#0b0f12ee',
        padding: { x: 6, y: 2 },
      })
      .setOrigin(1, 0)
      .setName('hud-fps')
      .setScrollFactor(0)
      .setDepth(HUD_FEEDBACK_DEPTH)
      .setVisible(false);
    this.hudVisible = false;
    this.hudShown = '';
    this.hudLast = Number.NEGATIVE_INFINITY;
  }

  /** F3：计数器显隐。打开时立刻刷一次，不等 500ms 节流点。 */
  private toggleHud(): void {
    this.hudVisible = !this.hudVisible;
    this.hudText?.setVisible(this.hudVisible);
    if (this.hudVisible) this.refreshHud(true);
    else {
      this.hudText?.setText('');
      this.hudShown = '';
    }
  }

  /** 计数器文案：窗口均值折成 fps + 降级标记。按值缓存，没变不碰对象。 */
  private refreshHud(force: boolean): void {
    const mean = this.guard?.meanMs ?? 0;
    const fps = mean > 0 ? Math.round(1000 / mean) : 0;
    const shown = `${fps} FPS${this.degraded ? ' · 降级' : ''}`;
    if (!force && shown === this.hudShown) return;
    this.hudShown = shown;
    this.hudLast = this.host.time.now;
    this.hudText?.setText(shown).setColor(hex(this.degraded ? TEXT.warn : TEXT.secondary));
  }
}
