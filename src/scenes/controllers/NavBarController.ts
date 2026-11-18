// AG-71：底部导航条（六槽铆钉板：contextual 动态槽 + 五个固定槽）——RC-03
// 拆分第 6 步。从 GameScene 迁出（原字段组 1229-1257 + buildHud 顶部销毁段
// 4661-4676 + buildNavBar/navContextParts/refreshNavBar/drawNavGlyph 四方法
// 4832-4999），行为零变更：同一构造路径（create → buildHud → navBar.build）、
// 同一刷新语义（update 第一行 navBar.refresh，面板布尔帧间改写只有这里兜）、
// 同一 contextual 优先级链（面板链 → 教程 → 世界链）、同一几何常量与缓存键。
//
// 形态（设计文档 §2，沿用前五步的主机结构面模式）：plain TS 类，**不 import
// Phaser 场景类型**——
//   * 构造拿 host（NavBarHost：add 工厂/面板布尔与槽动作查询面/两链数据源/
//     fitHudLine 截断面——GameScene 天然满足）。
//   * 共享 hitRect（render/pointer，第一参钉死 Phaser.Scene）按第 1 步
//     StatsPanelController 的先例从签名反推 SharedHitScene 做唯一一处收窄，
//     运行期 host 就是 GameScene 实例——hitRect 的 pointerdown +
//     stopPropagation 语义不重造。
//   * import 链（render/pointer、render/hudSkin、render/uiKit、render/
//     palette、render/hudLayout、core/design）均无 Phaser 值导入——Node 下
//     可用记录型假件单测（src/tests/navBarController.test.ts）。
//   * 显示器持有并管理自己的 GameObjects：静态板/状态层/六文本/五张 hitRect
//     的生命周期全在本类（reset 先毁再建——场景重启不清显示列表，Phaser 4 的
//     shutdown 只空纹理），GameScene 只留 reset/build/refresh 三处委托 +
//     NavBarHost 的查询面。
//
// contextual 文案优先级链（AG-91 juice / AG-116 XP-2 / AG-124 R6-2 三次改动
// 后逐字冻结，迁移后同输入同文案）：
//   * 面板链（host.openPanelHint）：战斗中 AG-63 的战斗脚注（当前武器：××
//     （伤害 n）· Enter 出招 · ↑/↓ 选择 · ESC 撤退）压过一切；
//   * 教程链（host.tutorialNavHint）：激活且出现条件过了才出声，世界在教同
//     一个 E 动作时让世界说（tutorialYieldsToWorld）；
//   * 世界链（host.worldHintText）：场景侧 update 的世界模拟段生产——
//     R6-2 的「按 E 与行商交易」（第一分支 shop 分支）优先于末站 XP-2 的
//     idleWindowSuggestion 指路，这一相对优先级随数据源一起留在场景侧。
//
// 不变量（迁移中逐字保留）：
//   · refresh 放 update 第一行——面板布尔在帧间被键盘/鼠标改写，而世界模拟
//     段有面板早退，只有这里保证开着面板时高亮与 contextual 照更；
//   · 全部按值缓存（navStateKey / navContextShown），没变不碰对象——
//     Text.setText 每帧调会重烤纹理；
//   · 「按 E ××」拆成键帽 E + 动作名，其余整串显示不画键帽——hud-hint 状态
//     对象保留全串（e2e 契约），这里只决定导航条怎么画。

import type Phaser from 'phaser';
import { hitRect } from '../../render/pointer';
import { drawHudIcon, drawHudPlate, drawHazardStripe } from '../../render/hudSkin';
import { FONT_FAMILY, TYPE, UI } from '../../render/uiKit';
import { PALETTE, TEXT, hex } from '../../render/palette';
import { NAV_BAR, navSlotX } from '../../render/hudLayout';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../../core/design';

/** 五个固定槽的键（e2e 按 `hud-nav-${key}` 断言标签对象）。 */
export type NavSlotKey = 'bag' | 'craft' | 'venture' | 'map' | 'menu';

/** 槽图标名：后三个在 hudSkin 的 HudIconName 里，前两个（背包/制作）hudSkin
 *  没有字形，按 drawHudIcon 的 8×8 网格语言在本地补（见 drawGlyph）。 */
type NavSlotIcon = 'bag' | 'craft' | 'coins' | 'tower' | 'clipboard';

/** 固定槽的静态定义（原 GameScene navSlots 表的 key/label/icon 三列；
 *  run/owned 两列是场景行为，经 NavBarHost 查询面摄入——信号组装集中在
 *  本类，判定留在场景，与 TutorialController 的 isNearBed 同款纪律）。 */
const NAV_SLOTS: Array<{ key: NavSlotKey; label: string; icon: NavSlotIcon }> = [
  { key: 'bag', label: '背包 I', icon: 'bag' },
  { key: 'craft', label: '制作 C', icon: 'craft' },
  { key: 'venture', label: '产业 G', icon: 'coins' },
  { key: 'map', label: '地图 M', icon: 'tower' },
  { key: 'menu', label: '菜单 Esc', icon: 'clipboard' },
];

/** 固定槽 hitRect 的深度（压在板/文本之上，世界点击穿不透）。 */
const NAV_HIT_DEPTH = 105;

/**
 * 控制器需要场景提供的最小面（GameScene 天然满足；单测用假件实现）。
 * 刻意不 import Phaser.Scene：本类的可测性靠这层结构面，而不是靠能造真场景。
 */
export interface NavBarHost {
  /** Phaser 的 GameObject 工厂——板/状态层/六文本/五张 hitRect 从它出生。 */
  add: Phaser.GameObjects.GameObjectFactory;
  /** contextual 数据源第一链：面板自己的按键提示（null = 没有面板开着）。 */
  openPanelHint(): string | null;
  /** contextual 数据源第二链：教程提示（null = 教程不吱声）。 */
  tutorialNavHint(): string | null;
  /** contextual 数据源第三链（末站）：世界链当前脚注全串（hud-hint 状态对象）。 */
  worldHintText(): string;
  /** 固定槽的 owned 判据——高亮链与点击守卫同一个口径（地图恒 false）。 */
  navSlotOwned(key: NavSlotKey): boolean;
  /** 固定槽的动作——点击与键盘（I/C/G/M/Esc）走同一条路径。 */
  navSlotRun(key: NavSlotKey): void;
  /** 点击守卫：爬梯动画进行中不接。 */
  stairClimbing(): boolean;
  /** 点击守卫：别的面板开着时只接自己那个槽。 */
  anyPanelOpen(): boolean;
  /** contextual 文本超宽截断——场景 fitHudLine 的同款实现（goalText/
   *  clockText/环境 chips 也用它），截断口径不复制第二份。 */
  fitHudLine(text: Phaser.GameObjects.Text, width: number): void;
}

/**
 * hitRect 第一参的场景类型——从共享件签名反推，本文件因此不 import Phaser
 * 场景类型。运行期 host 就是 GameScene 实例（字段初始化器
 * `new NavBarController(this)`），本类自身的方法面不出现场景类型。
 */
type SharedHitScene = Parameters<typeof hitRect>[0];

export class NavBarController {
  /** 静态板（板/分隔线/条纹），build 时画一次。 */
  private navGfx?: Phaser.GameObjects.Graphics;
  /** 随状态变的部分（槽高亮、槽图标、contextual 键帽），refresh 按缓存键重画。 */
  private navStateGfx?: Phaser.GameObjects.Graphics;
  private navSlotTexts: Phaser.GameObjects.Text[] = [];
  /** 每槽图标左缘 x（整组 icon+label 在槽内居中时算出的）。 */
  private navIconX: number[] = [];
  private navContextText?: Phaser.GameObjects.Text;
  private navKeyText?: Phaser.GameObjects.Text;
  private navHitRects: Phaser.GameObjects.Rectangle[] = [];
  /** 上次画过的 contextual 键帽键与激活槽的组合键（没变就不碰对象）。 */
  private navStateKey = '';
  /** 上次写进 contextual 文本的 label（含位置随键帽有无的横移）。 */
  private navContextShown = '';

  constructor(private readonly host: NavBarHost) {}

  /** 仅供共享 hitRect 调用的一次性场景收窄——本类方法面不出现场景类型。 */
  private get hitScene(): SharedHitScene {
    return this.host as unknown as SharedHitScene;
  }

  // ── 生命周期 ─────────────────────────────────────────────────────────────

  /**
   * buildHud 顶部调用一次（先毁后建）：场景重启保 display list 且字段初始化器
   * 不重跑，上一局的导航条件会双份上屏、stale Text 一 setText 就抛。
   */
  reset(): void {
    this.navGfx?.destroy();
    this.navGfx = undefined;
    this.navStateGfx?.destroy();
    this.navStateGfx = undefined;
    for (const t of this.navSlotTexts) t.destroy();
    this.navSlotTexts = [];
    this.navIconX = [];
    this.navContextText?.destroy();
    this.navContextText = undefined;
    this.navKeyText?.destroy();
    this.navKeyText = undefined;
    for (const r of this.navHitRects) r.destroy();
    this.navHitRects = [];
    this.navStateKey = '';
    this.navContextShown = '';
  }

  /**
   * create() → buildHud 尾部调用一次：一条常驻铆钉板，contextual 槽（最左）+
   * 五个等宽固定槽。铆钉/渐变/暖条用 drawHudPlate 与顶带同一套语言，顶缘再
   * 压一道同款危险条纹；两条视觉语言因此读作同一块界面。固定槽同时是旧
   * buildHudButtons 按钮行的接替者——每个槽一张 hitRect，守卫与键盘路径相同
   * （攀爬中不接、别的面板开着不接，自己的面板 toggle 关闭）。
   */
  build(): void {
    const nav = NAV_BAR;
    const y = DESIGN_HEIGHT - nav.height;
    const cy = y + nav.height / 2;
    // 板：矩形打底（半透明，世界读得进来）+ drawHudPlate 的六段渐变/铆钉。
    this.host.add.rectangle(0, y, DESIGN_WIDTH, nav.height, UI.surface).setOrigin(0, 0).setAlpha(0.9).setScrollFactor(0).setDepth(100);
    this.navGfx = this.host.add.graphics().setScrollFactor(0).setDepth(101);
    drawHudPlate(this.navGfx, DESIGN_WIDTH, nav.height, 0x0b0f12, UI.line, PALETTE.stoneLight, PALETTE.light);
    // 槽分隔线：contextual 右缘一条 + 固定槽之间四条，上下各缩 12px。
    this.navGfx.fillStyle(UI.line, 0.85);
    for (let i = 0; i < 5; i++) {
      this.navGfx.fillRect(Math.round(navSlotX(i)), y + 12, 1, nav.height - 24);
    }
    // 顶带同款签名条（顶带那条在环境行下方，这条在导航条顶缘）。
    drawHazardStripe(this.navGfx, 4, y + 3, DESIGN_WIDTH - 8, nav.stripeH, PALETTE.lightDeep);

    this.navStateGfx = this.host.add.graphics().setScrollFactor(0).setDepth(103);
    // contextual 文本：hud-hint 的显示层，位置随键帽有无左右移。
    this.navContextText = this.host.add.text(nav.contextPadX, cy, '', {
      fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.highlight),
    }).setOrigin(0, 0.5).setName('hud-nav-context').setScrollFactor(0).setDepth(103);
    // contextual 键帽字母（仅世界链「按 E ××」时亮）。
    this.navKeyText = this.host.add.text(nav.contextPadX + nav.keycapW / 2, cy, '', {
      fontFamily: FONT_FAMILY, fontSize: `${nav.keycapFont}px`, color: hex(PALETTE.lightHigh),
    }).setOrigin(0.5, 0.5).setName('hud-nav-key').setScrollFactor(0).setDepth(104).setVisible(false);

    this.navSlotTexts = [];
    this.navIconX = [];
    this.navHitRects = [];
    NAV_SLOTS.forEach((slot, i) => {
      const sx = navSlotX(i);
      const text = this.host.add.text(0, cy, slot.label, {
        fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.secondary),
      }).setOrigin(0, 0.5).setName(`hud-nav-${slot.key}`).setScrollFactor(0).setDepth(103);
      // 图标+标签作为一组在槽内居中：先建文本量宽度，再回推整组左缘。
      const groupW = nav.iconSize + nav.iconGap + text.width;
      const gx = sx + (nav.slotW - groupW) / 2;
      text.setX(gx + nav.iconSize + nav.iconGap);
      this.navIconX.push(gx);
      this.navSlotTexts.push(text);
      const hit = hitRect(this.hitScene, sx, y, nav.slotW, nav.height, NAV_HIT_DEPTH, {
        onClick: () => {
          if (this.host.stairClimbing()) return;
          if (this.host.anyPanelOpen() && !this.host.navSlotOwned(slot.key)) return;
          this.host.navSlotRun(slot.key);
        },
      });
      hit.setScrollFactor(0);
      this.navHitRects.push(hit);
    });
    this.navStateKey = '';
    this.navContextShown = '';
    this.refresh();
  }

  // ── 每帧刷新 ─────────────────────────────────────────────────────────────

  /**
   * contextual 槽的显示拆分：世界链的「按 E ××」拆成键帽 E + 动作名（参考图
   * `[E] 搜刮床铺` 的读法，槽里不再重复一个「按 E」）；面板链、忙碌中、环境
   * 提示没有单一按键，整串显示、不画键帽——它们的键位本就写在文案里
   * （↑/↓、Enter、ESC）。hud-hint 的 Text 保留全串不变（e2e 按 name 断言），
   * 这里只决定导航条怎么画。
   */
  private contextParts(hint: string): { key: string; label: string } {
    if (hint.startsWith('按 E ')) return { key: 'E', label: hint.slice(4) };
    return { key: '', label: hint };
  }

  /**
   * 导航条每帧刷新，放在 update() 第一行：面板布尔在帧间被键盘/鼠标改写，
   * 而世界模拟段有面板早退，只有这里保证开着面板时高亮与 contextual 照更。
   * contextual 取「面板链优先，否则教程（激活且出现条件过了），否则世界链
   * 当前脚注」——与 openPanelHint 的既有分支一致（含战斗提示）；高亮读四个
   * 面板布尔（地图面板是另一个场景 TowerOverview，本场景没有它的布尔——
   * 参考图里它也就位一个普通槽，不开高亮）。全部按值缓存，没变不碰对象
   * （Text.setText 每帧调会重烤纹理）。
   *
   * AG-73：教程分支的位置与让位规则都是有意的——
   *   * 面板链之后：教程第 4 步的完成条件就是制作面板打开，面板自己的提示
   *     就是那一刻最该说的话；
   *   * 世界链之前，但 tutorialYieldsToWorld 判「世界正在教本步目标物的同
   *     一个 E 动作」时让世界说（贴近柜子的「[E] 打开 储物柜」比教程文案
   *     更短更准）。出生点（640）压着一张室友床，世界脚注是「按 E 搜刮
   *     床铺」——和「先学会移动」不是同一件事，这一步教程盖住它说。
   */
  refresh(): void {
    if (!this.navStateGfx || !this.navContextText || !this.navKeyText) return;
    const nav = NAV_BAR;
    const cy = DESIGN_HEIGHT - nav.height / 2;
    const hint = this.host.openPanelHint() ?? this.host.tutorialNavHint() ?? this.host.worldHintText();
    const { key, label } = this.contextParts(hint);
    if (label !== this.navContextShown) {
      this.navContextShown = label;
      this.navContextText.setText(label);
      this.host.fitHudLine(this.navContextText, nav.contextTextW);
      this.navContextText.setX(nav.contextPadX + (key ? nav.keycapW + nav.keycapGap : 0));
    }
    const activeKey = this.host.navSlotOwned('bag') ? 'bag'
      : this.host.navSlotOwned('craft') ? 'craft'
        : this.host.navSlotOwned('venture') ? 'venture'
          : this.host.navSlotOwned('menu') ? 'menu'
            : '';
    const stateKey = `${activeKey}|${key}`;
    if (stateKey === this.navStateKey) return;
    this.navStateKey = stateKey;
    const g = this.navStateGfx;
    g.clear();
    NAV_SLOTS.forEach((slot, i) => {
      const sx = navSlotX(i);
      const active = slot.key === activeKey;
      if (active) {
        // 激活槽：暖色薄纱 + 槽底一道亮线 + 标签转 highlight，一眼认出开着谁。
        g.fillStyle(PALETTE.light, 0.1);
        g.fillRect(sx, DESIGN_HEIGHT - nav.height, nav.slotW, nav.height);
        g.fillStyle(PALETTE.lightHigh, 0.9);
        g.fillRect(sx + 12, DESIGN_HEIGHT - 3, nav.slotW - 24, 2);
      }
      this.drawGlyph(g, slot.icon, this.navIconX[i] ?? 0, cy - nav.iconSize / 2, nav.iconSize, active ? PALETTE.lightHigh : TEXT.secondary);
      this.navSlotTexts[i]?.setColor(active ? hex(TEXT.highlight) : hex(TEXT.secondary));
    });
    if (key) {
      g.fillStyle(UI.surfaceRaised, 0.95);
      g.fillRect(nav.contextPadX, cy - nav.keycapH / 2, nav.keycapW, nav.keycapH);
      g.lineStyle(1, PALETTE.lightHigh, 0.9);
      g.strokeRect(nav.contextPadX + 0.5, cy - nav.keycapH / 2 + 0.5, nav.keycapW - 1, nav.keycapH - 1);
      this.navKeyText.setVisible(true).setText(key);
    } else {
      this.navKeyText.setVisible(false).setText('');
    }
  }

  /**
   * 导航槽图标。hudSkin 是只读模块且没有背包/制作的字形，这两个按
   * drawHudIcon 的 8×8 网格语言（2px 一格、同款负空间）在本地补；其余三个
   * 直接复用 drawHudIcon 的既有字形。缺字形这件事记在 AG-71 报告里。
   */
  private drawGlyph(
    g: Phaser.GameObjects.Graphics,
    name: NavSlotIcon,
    x: number,
    y: number,
    s: number,
    color: number,
  ): void {
    if (name !== 'bag' && name !== 'craft') {
      drawHudIcon(g, name, x, y, s, color);
      return;
    }
    const u = s / 8;
    const cell = (cx: number, cy: number, cw: number, ch: number): void => {
      g.fillStyle(color, 1);
      g.fillRect(Math.round(x + cx * u), Math.round(y + cy * u), Math.max(1, Math.round(cw * u)), Math.max(1, Math.round(ch * u)));
    };
    if (name === 'bag') {
      cell(1, 3, 6, 5); // 包身
      cell(3, 1, 2, 2); // 提手
      g.fillStyle(0x0b0f12, 0.9); // 包口（负空间，同 drawHudIcon 的 bg 用法）
      g.fillRect(Math.round(x + 1 * u), Math.round(y + 3 * u), Math.max(1, Math.round(6 * u)), Math.max(1, Math.round(1 * u)));
    } else {
      cell(2, 1, 4, 2); // 锤头
      cell(3, 3, 2, 5); // 锤柄
    }
  }

  // ── 读数面（探针/调试；运行期字段，TS private 不挡 page.evaluate）───────

  /** 上次画过的状态组合键（`激活槽|键帽键`）——冻结探针对比两跑同输入。 */
  get lastStateKey(): string {
    return this.navStateKey;
  }

  /** 上次写进 contextual 槽的 label——冻结探针对比两跑同输入。 */
  get lastContextShown(): string {
    return this.navContextShown;
  }
}
