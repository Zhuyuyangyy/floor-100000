// AG-54/AG-60/AG-67：HUD 顶带（四联圆环 + 铆钉板 + 数值行）与背包面板——
// RC-03 拆分第 9 步。从 GameScene 迁出（原 buildHud 的 HUD 段 3349-3544、
// refreshGoalHud/refreshClock/refreshStats/refreshEnvironmentHud 3553-3680、
// buildInventoryPanel/invSlotUnlocked/refreshInventory/toggleInventory
// 3682-3951、refreshBagFullWarning 6903-6925、itemIconFor/ensureShovelIcon
// 6656-6683、字段组 859-1006、模块常量 STAT_BARS/TEMP_LABEL/
// SICKNESS_TIER_LABEL/GOAL_LABELS/BAG_BALANCE/SHOVEL_ICON_KEY 464-654），
// 行为零变更：同一构造路径（create → buildHud → hud.build，背包面板随
// build 一次装配）、同一按值缓存键（lastStats/lastGoalKey/lastClock）、
// 同一 AG-102 圆环 RT 重烤口径、同一 AG-60 几何与详情文案。
//
// 形态（设计文档 §2，沿用前八步的主机结构面模式）：plain TS 类，**不 import
// Phaser 场景类型**——
//   * 构造拿 host（HudHost：add 工厂/textures/viewSize/panelHit/createMarker/
//     setPanelBox/assertPanelContent/fitHudLine/onUse/createStatRings——
//     GameScene 天然满足）。STAT_BARS（四联圆环行规格）定义在本类
//     （2026-11-19 起右下状态卡已拆除，不再外注 MonologueController）。
//   * 共享面板渲染件（buildPanel/buildPanelHeader/buildPanelWell）第一参钉死
//     Phaser.Scene——按 DialogueController 的 SharedPanelScene 先例从签名
//     反推做唯一一处收窄，运行期 host 就是 GameScene 实例。
//   * import 链（render/*、core/*、systems/*、data/items）均无 Phaser 值
//     导入——Node 下可用记录型假件单测（src/tests/hudController.test.ts）。
//   * 显示器持有并管理自己的 GameObjects：板/圆环 RT/数值文本/环境 chips/
//     预警行/暗角/背包全部件，生命周期全在本类（reset 先毁再建——场景重启
//     不清显示列表，Phaser 4 的 shutdown 只空纹理），GameScene 只留
//     buildHud 编排一行与公开委托面（refreshStats/refreshInventory 等）。
//
// 三条不变量（迁移中逐字保留）：
//   · AG-102（性能轮 3）：四联圆环是 RenderTexture 预烘焙（p95 -23.5%，
//     像素零差异）——redraw 只在数值变化时跑（lastStats 键没变整组早退），
//     绝不每帧；重启时先毁后建，旧 RT 留着会在同一位置再画一遍，半透明
//     抗锯齿边缘叠一次会变深。
//   · 全部按值缓存（lastStats/lastGoalKey/lastClock/bagFullShown）——
//     Text.setText 每帧调会重烤纹理；环境行不并入 refreshStats 的早退
//     （环境变而四项不变时也要更，由帧循环单独调 refreshEnvironmentHud）。
//   · 布局常量零迁移动：HUD_LAYOUT/BAG_LAYOUT 留 render/hudLayout.ts，
//     BAG_BALANCE 随本类迁出但 GameScene re-export 保 bagPanel.test.ts
//     的 import 路径不变（同第 7 步 combatWeaponLabel 的先例）。

import type Phaser from 'phaser';

import { drawHazardStripe, drawHudIcon, drawHudPlate, type HudIconName, type StatRingsBaker } from '../../render/hudSkin';
import { buildPanelHeader, buildPanelWell, FONT_FAMILY, STAT_COLORS, TYPE, UI } from '../../render/uiKit';
import { PALETTE, TEXT, hex } from '../../render/palette';
import { BAG_LAYOUT, HUD_LAYOUT, hudClockLabel } from '../../render/hudLayout';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../../core/design';
import { GAME_CONFIG } from '../../core/config';
import { getGame } from '../../core/session';
import { environmentFor } from '../../core/constants';
import { applyPanelDepth, buildPanel, HUD_FEEDBACK_DEPTH, PANEL_DEPTH, placeMarkerLeftOf, type PanelObject } from '../../render/panels';
import { itemIconKey } from '../../render/itemIcons';
import { getItem } from '../../data/items';
import { isBagFull, STAT_LABEL } from '../../systems/InventorySystem';
import { isNight, sicknessOf } from '../../systems/SurvivalSystem';
import { ailmentLabel } from '../../systems/SicknessSystem';
import { BODY_TEMP_MAX, COLD_THRESHOLD, bodyTempOf, warmthAt } from '../../systems/EnvironmentSystem';
import { moraleBandOf, moraleLabel } from '../../systems/MoraleSystem';
import { ensureDailyGoal, isDailyGoalDone } from '../../systems/dailyGoals';
import { runScore } from '../../systems/progress';
import { mostUrgentStat } from '../../render/feedback';
import { playSfx } from '../../render/audio';
import type { HitHandlers } from '../../render/pointer';
import type { PanelBox } from './StatsPanelController';
import type { ItemId } from '../../core/gameTypes';

// ── 随迁的模块常量（原 GameScene.ts，逐字保留） ────────────────────────────

/** 四联圆环一行读数的规格（color 目前只作文档——圆环上色走
 *  STAT_COLORS[key]，见 refreshStats）。 */
export type StatBarSpec = { key: 'hp' | 'hunger' | 'thirst' | 'energy'; label: string; color: number; icon: HudIconName };

// Row pitch for the four HUD stat bars. 15px gives an 11px label plus a 7px bar
// with breathing room; 13px was too cramped to read at a glance.
//
// 四联圆环的行规格（原 GameScene 467-472 行）。第 9 步起定义住在圆环的本家
// （本类）。2026-11-19 起右下状态卡按用户裁决拆除，本数组只服务顶带圆环。
export const STAT_BARS: StatBarSpec[] = [
  { key: 'hp', label: '生命', color: 0xe56d63, icon: 'cross' },
  { key: 'hunger', label: '饥饿', color: 0xf4b66a, icon: 'hunger' },
  { key: 'thirst', label: '口渴', color: 0x6aa8e5, icon: 'thirst' },
  { key: 'energy', label: '精力', color: 0x77c6a4, icon: 'energy' },
];

// Body heat gets its own readout rather than a fifth bar: it is the one stat a
// floor owns, so it reads as "where you are" as much as "how you are". The bar
// would have said the latter and hidden the former.
const TEMP_LABEL = '体温值';

// TWOM 对齐 §1：疾病三档的 HUD 用语。healthy 不进读数——没病不需要占位。
const SICKNESS_TIER_LABEL: Record<string, string> = {
  sick: '患病',
  critical: '病危',
};

// OVERHAUL: the daily objective's one-line label, per goal kind.
const GOAL_LABELS: Record<'water' | 'containers' | 'upgrade' | 'floor', (target: number) => string> = {
  water: (n) => `带回 ${n} 瓶净水`,
  containers: (n) => `搜刮 ${n} 个容器`,
  upgrade: (n) => `建成 ${n} 项宿舍升级`,
  floor: (n) => `到达第 ${n} 层`,
};

// ── AG-60：背包面板的平衡值 ────────────────────────────────────────────
// 面板/格子几何全部走 config/game-balance.json 的 bag 块（AG-60 放大改版：
// 440x236/40px 格/12 格 → 880x360/76px 格/14 格）。core/config.ts 的校验
// 只查必填键，扩展块与 movement/warmthSources 同款按 Record 读；缺字段回退
// 默认值，旧配置文件照样能跑。布局语言（标题栏/条纹/行锚点/内边距）在
// render/hudLayout.ts 的 BAG_LAYOUT，两边不重复尺寸。
export interface BagBalance {
  panelWidth: number;
  panelHeight: number;
  gridCols: number;
  gridSlots: number;
  cellSize: number;
  cellGap: number;
  iconScale: number;
  detailGap: number;
}

const BAG_DEFAULTS: BagBalance = {
  panelWidth: 880,
  panelHeight: 360,
  gridCols: 5,
  gridSlots: 14,
  cellSize: 76,
  cellGap: 8,
  iconScale: 3,
  detailGap: 12,
};

function readBagBalance(): BagBalance {
  const raw = (GAME_CONFIG as unknown as { bag?: Partial<BagBalance> }).bag ?? {};
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return {
    panelWidth: num(raw.panelWidth, BAG_DEFAULTS.panelWidth),
    panelHeight: num(raw.panelHeight, BAG_DEFAULTS.panelHeight),
    gridCols: num(raw.gridCols, BAG_DEFAULTS.gridCols),
    gridSlots: num(raw.gridSlots, BAG_DEFAULTS.gridSlots),
    cellSize: num(raw.cellSize, BAG_DEFAULTS.cellSize),
    cellGap: num(raw.cellGap, BAG_DEFAULTS.cellGap),
    iconScale: num(raw.iconScale, BAG_DEFAULTS.iconScale),
    detailGap: num(raw.detailGap, BAG_DEFAULTS.detailGap),
  };
}

/** AG-60：背包面板几何的数值入口——控制器内不硬编码任何尺寸。 */
export const BAG_BALANCE: BagBalance = readBagBalance();

/** AG-66：程序化生成的铲子图标贴图 key（见 ensureShovelIcon 的注释）。 */
const SHOVEL_ICON_KEY = 'shovel';

/**
 * 控制器需要场景提供的最小面（GameScene 天然满足；单测用假件实现）。
 * 刻意不 import Phaser.Scene——可测性靠这层结构面，不靠能造真场景。
 */
export interface HudHost {
  /** Phaser 的 GameObject 工厂——板/圆环/文本/格子从它出生。 */
  add: Phaser.GameObjects.GameObjectFactory;
  /** 贴图管理器——AG-66 铲子图标的存在性查询（ensureShovelIcon）。 */
  textures: Phaser.Textures.TextureManager;
  /** 视口尺寸（背包面板居中）。 */
  viewSize(): { width: number; height: number };
  /** 屏幕空间点击热区（panelHit：scrollFactor 0）——背包格。 */
  panelHit(x: number, y: number, w: number, h: number, depth: number, handlers: HitHandlers): Phaser.GameObjects.Rectangle;
  /** 选项箭头标记（render/panels createMarker）——背包选中光标。 */
  createMarker(): Phaser.GameObjects.Image;
  /** 鼠标 ESC 逃生门的判定矩形（onPointerDown 读 panelBox；随当前面板几何走）。 */
  setPanelBox(box: PanelBox): void;
  /** dev 面板空件自查（assertPanelContent；build 后当场跑）。 */
  assertPanelContent(panel: string, objects: ReadonlyArray<Phaser.GameObjects.GameObject>): void;
  /** 超宽文本截断——场景 fitHudLine 的同款实现（目标行/时钟/环境 chips/
   *  导航条 contextual 也用它），截断口径不复制第二份。 */
  fitHudLine(text: Phaser.GameObjects.Text, width: number): void;
  /** 双击背包格 / 面板内 Enter 的「使用选中物品」——走场景 onUse 同一条路。 */
  onUse(): void;
  /** AG-102 圆环 RT 烘焙器——共享件第一参钉死 Phaser.Scene，场景薄封装
   *  （createStatRingsBaker(this, HUD_LAYOUT)）落在这里。 */
  createStatRings(): StatRingsBaker;
  /** 反馈行（hud-feedback）——本体留场景（flash() 是 ~30 处出口的同一反馈
   *  行，第 3 步契约「控制器不碰 feedbackText 本体」），但创建点位在 HUD 带
   *  的序列里（环境 chips 之后、预警行之前——迁移前的逐字次序，冻结探针的
   *  显示列表契约）。控制器只负责「在该点调用」，不持有、不写它。 */
  createFeedbackText(): Phaser.GameObjects.Text;
}

/** 共享面板渲染件第一参的场景类型（buildPanel/buildPanelHeader/
 *  buildPanelWell）——同 DialogueController 的 SharedPanelScene 路数，
 *  签名是边界冻结的，它们改签名时这里跟着报错。 */
type SharedPanelScene = Parameters<typeof buildPanel>[0];

export class HudController {
  // ── HUD 顶带字段组（原 GameScene 字段，随迁） ───────────────────────────
  private hudIcons?: Phaser.GameObjects.Graphics;
  /** AG-102（性能轮 3）：四联圆环是一张 RenderTexture——Phaser 4 每帧重三角化
   *  Graphics 的 ARC 命令，42 条弧实测 0.68ms/帧；数值变化时重烤，每帧只剩
   *  一个贴图 quad。 */
  private statRings?: StatRingsBaker;
  private statLabels: Phaser.GameObjects.Text[] = [];
  private statValues: Phaser.GameObjects.Text[] = [];
  private clockText?: Phaser.GameObjects.Text;
  private floorBadge?: Phaser.GameObjects.Text;
  private goldText?: Phaser.GameObjects.Text;
  private goalText?: Phaser.GameObjects.Text;
  private scoreText?: Phaser.GameObjects.Text;
  // The environment row is four chips, one per reading, each with its own icon:
  // 体温值 / 区域 / 潮湿 / 夜间危险. They used to be one string, which meant one
  // icon's worth of meaning for four unrelated facts.
  private environmentText?: Phaser.GameObjects.Text;
  private envRegionText?: Phaser.GameObjects.Text;
  private envHumidText?: Phaser.GameObjects.Text;
  private envNightText?: Phaser.GameObjects.Text;
  /** the low-HP edge warning: bands with their own base weights */
  private vignetteParts: Array<{ rect: Phaser.GameObjects.Rectangle; weight: number }> = [];
  /** AG-63：饥饿/干渴常驻标记（「状态：饥饿」）——平时不可见，坐标在
   *  hudLayout 的 debuffMark 键；世界链判定、本类只画。 */
  private debuffMark?: Phaser.GameObjects.Text;
  private lastGoalKey = '';
  private lastStats = '';
  private lastClock = '';
  // ── 背包面板字段组 ──────────────────────────────────────────────────────
  private invObjects: PanelObject[] = [];
  private invCountText?: Phaser.GameObjects.Text;
  private invCells: Phaser.GameObjects.Rectangle[] = [];
  /** AG-60：全部格子边框共用这一个 Graphics，refreshInventory 整幅重画 */
  private invCellBorders?: Phaser.GameObjects.Graphics;
  private invDetailName?: Phaser.GameObjects.Text;
  private invDetailMeta?: Phaser.GameObjects.Text;
  private invDetailBody?: Phaser.GameObjects.Text;
  private invSlotTexts: Phaser.GameObjects.Text[] = [];
  private invSlotIcons: Phaser.GameObjects.Image[] = [];
  private invMarker?: Phaser.GameObjects.Image;
  private invSelected = 0;
  private inventoryOpen = false;
  // B3-02 §4.2: a full bag used to be a 1.6s flash, so a player who filled the
  // bag on floor 3 arrived on floor 4 with no reminder and lost the next
  // container's loot to what looked like a bug. This one stays until a slot
  // frees up, so the state is readable whenever the player looks.
  private bagFullText?: Phaser.GameObjects.Text;
  private bagFullShown = false;
  /** 程序化生成的铲子图标贴图就绪没有（build 里画一次，背包格用）。 */
  private shovelIconReady = false;
  /** 探针读数：圆环 RT 重烤次数（冻结探针对比两跑同输入同次数）。 */
  private ringRedraws = 0;

  constructor(private readonly host: HudHost) {}

  /** 仅供共享面板渲染件调用的一次性场景收窄——本类方法面不出现场景类型。 */
  private get sharedScene(): SharedPanelScene {
    return this.host as unknown as SharedPanelScene;
  }

  // ── 生命周期 ─────────────────────────────────────────────────────────────

  /**
   * buildHud 顶部的「先毁后建」：场景重启保 display list 且字段初始化器不
   * 重跑，上一局的 HUD 对象会双份上屏、stale Text 一 setText 就抛（Phaser 4
   * 的 shutdown 只空纹理）。圆环 RT 同属先毁后建之列——旧图留着的话，新图
   * 会在同一位置再画一遍，半透明抗锯齿边缘叠一次会变深。
   */
  reset(): void {
    this.hudIcons?.destroy();
    this.hudIcons = undefined;
    this.statRings?.destroy();
    this.statRings = undefined;
    for (const t of this.statLabels) t.destroy();
    this.statLabels = [];
    for (const t of this.statValues) t.destroy();
    this.statValues = [];
    this.clockText?.destroy();
    this.clockText = undefined;
    this.floorBadge?.destroy();
    this.floorBadge = undefined;
    this.goldText?.destroy();
    this.goldText = undefined;
    this.goalText?.destroy();
    this.goalText = undefined;
    this.scoreText?.destroy();
    this.scoreText = undefined;
    this.environmentText?.destroy();
    this.environmentText = undefined;
    this.envRegionText?.destroy();
    this.envRegionText = undefined;
    this.envHumidText?.destroy();
    this.envHumidText = undefined;
    this.envNightText?.destroy();
    this.envNightText = undefined;
    for (const p of this.vignetteParts) p.rect.destroy();
    this.vignetteParts = [];
    this.debuffMark?.destroy();
    this.debuffMark = undefined;
    this.lastGoalKey = '';
    this.lastStats = '';
    this.lastClock = '';
    // 背包面板：整组件 + 光标 + 状态。
    for (const o of this.invObjects) o.destroy();
    this.invObjects = [];
    this.invCountText = undefined;
    this.invCells = [];
    this.invCellBorders = undefined;
    this.invDetailName = undefined;
    this.invDetailMeta = undefined;
    this.invDetailBody = undefined;
    this.invSlotTexts = [];
    this.invSlotIcons = [];
    this.invMarker?.destroy();
    this.invMarker = undefined;
    this.invSelected = 0;
    this.inventoryOpen = false;
    this.bagFullText?.destroy();
    this.bagFullText = undefined;
    this.bagFullShown = false;
    this.ringRedraws = 0;
  }

  /**
   * create() → buildHud 尾部调用一次：一条常驻铆钉板（仪表行 + 目标行 +
   * 环境行）+ 四联圆环 + 背包面板。顺序与原 buildHud 一致——圆环在文本之下，
   * 背包面板在 HUD 带之后（两者深度各自显式钉死，创建次序只服务可读性）。
   */
  build(): void {
    // AG-66：背包里会出现铲子（craft_shovel），artpack 没有它的贴图，程序化
    // 画一把 16×16 顶着（render/artpack.ts 不归本工单，见 ensureShovelIcon）。
    // 原创建期在 drawFloor 之前调用，这里提到 build 开头——贴图只被背包格
    // 消费，buildInventoryPanel 的首次刷新之前就位，语义不变。
    this.ensureShovelIcon();
    // 选中光标随面板先毁后建（原 GameScene create 的 reset 块同款时机）。
    this.invMarker = this.host.createMarker();
    this.buildHudBand();
    this.buildInventoryPanel();
  }

  // ── HUD 顶带 ─────────────────────────────────────────────────────────────

  /**
   * The 2026-11-14 HUD skin: one riveted plate holding three rows —
   * instruments, the day's objective, the environment readout. See
   * render/hudSkin.ts for why this is drawn rather than dropped in as the
   * concept PNGs.
   */
  private buildHudBand(): void {
    const hud = HUD_LAYOUT;
    this.host.add.rectangle(0, 0, DESIGN_WIDTH, hud.contextBottom, UI.surface).setOrigin(0).setAlpha(0.98).setScrollFactor(0).setDepth(100);
    const plate = this.host.add.graphics().setScrollFactor(0).setDepth(101);
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
    this.hudIcons = this.host.add.graphics().setScrollFactor(0).setDepth(103);
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
    // AG-54: the four stat bars became four stat rings. Each group is the
    // ring, its pixel icon and its label; the value sits in the ring's well.
    STAT_BARS.forEach((stat, i) => {
      const gx = hud.statX + i * hud.statPitch;
      icon(stat.icon, gx + hud.ringR * 2 + 8, hud.ringCY - 8, STAT_COLORS[stat.key]);
    });

    this.floorBadge = this.host.add.text(46, hud.row1Y - 2, '', { fontFamily: FONT_FAMILY, fontSize: '20px', color: hex(PALETTE.lightHigh) })
      .setName('hud-floor').setScrollFactor(0).setDepth(103);
    this.clockText = this.host.add.text(42, hud.row1Y + 28, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.primary) })
      .setName('hud-clock').setScrollFactor(0).setDepth(103);
    this.refreshClock();

    // AG-102（性能轮 3）：四联圆环从每帧重三角化的 Graphics 换成一张
    // RenderTexture——同一条 WebGL 三角化路径画进 FBO，只在数值变化时重画，
    // 每帧只剩一个 quad。（不用 Graphics.generateTexture：它的 Canvas 2D
    // 光栅化与线上三角化的边缘像素对不上，冻结 diff 0.128% 不过像素级关口；
    // 见 render/hudSkin.ts 的路线记录。）重建顺序与原 Graphics 一致：环在
    // 文本之下，重启时先毁后建。
    this.statRings = this.host.createStatRings();
    STAT_BARS.forEach((stat, i) => {
      const gx = hud.statX + i * hud.statPitch;
      this.statLabels.push(this.host.add.text(gx + hud.ringR * 2 + 30, hud.statLabelY, stat.label, { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.secondary) })
        .setName(`hud-stat-${stat.key}`).setScrollFactor(0).setDepth(103));
      // The value rides in the ring's centre, origin half/half, so the dial
      // reads as one instrument: gauge around, number inside.
      this.statValues.push(this.host.add.text(gx + hud.ringR, hud.ringCY, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.primary) })
        .setOrigin(0.5, 0.5).setName(`hud-value-${stat.key}`).setScrollFactor(0).setDepth(103));
    });
    this.refreshStats();

    this.goldText = this.host.add.text(hud.moneyX + 24, hud.row1Y, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(PALETTE.lightHigh) })
      .setOrigin(0, 0).setName('hud-gold').setScrollFactor(0).setDepth(103);
    this.scoreText = this.host.add.text(hud.moneyX + 24, hud.row1Y + 28, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.highlight) })
      .setOrigin(0, 0).setName('hud-score').setScrollFactor(0).setDepth(103);

    this.goalText = this.host.add.text(44, hud.goalY, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(PALETTE.lightHigh) })
      .setName('hud-goal').setScrollFactor(0).setDepth(HUD_FEEDBACK_DEPTH);
    // Four environment chips. Each owns one reading, so a player scanning for
    // "is it night" does not have to parse a sentence.
    const chip = (x: number, name: string, color: string): Phaser.GameObjects.Text =>
      this.host.add.text(x + 24, hud.environmentY, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color })
        .setName(name).setScrollFactor(0).setDepth(HUD_FEEDBACK_DEPTH);
    this.environmentText = chip(hud.envChipX[0], 'hud-environment', hex(TEXT.secondary));
    this.envRegionText = chip(hud.envChipX[1], 'hud-region', hex(TEXT.secondary));
    this.envHumidText = chip(hud.envChipX[2], 'hud-humid', hex(TEXT.secondary));
    this.envNightText = chip(hud.envChipX[3], 'hud-night', hex(TEXT.secondary));

    // Feedback has a dedicated lower lane. It remains above modal panels but
    // can never collide with the daily objective or the permanent environment.
    // 本体在场景（flash 的同一出口），创建点位在这里——环境 chips 之后、预警
    // 行之前，与迁移前逐字一致（两者同深度但泳道不重叠，次序只服务冻结探针）。
    this.host.createFeedbackText();

    this.bagFullText = this.host.add.text(20, hud.bagY,
      '背包已满 · 使用、制作或交易腾出格子，否则搜刮会留在原处；能叠进已有堆的物品仍可拾取',
      { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.warn), backgroundColor: '#0b0f12ee', padding: { x: 8, y: 3 }, wordWrap: { width: 1216 } },
    ).setName('hud-bag-full').setScrollFactor(0).setDepth(HUD_FEEDBACK_DEPTH).setVisible(false);

    // AG-63: the debuff's standing marker, one line above the hint. Invisible
    // until hunger or thirst crosses 25%; the fx block in update() drives it.
    // hudLayout pins the y between the bag-full lane and the foot bar.
    this.debuffMark = this.host.add
      .text(HUD_LAYOUT.debuffMarkX, HUD_LAYOUT.debuffMarkY, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.warn) })
      .setOrigin(0, 0.5).setName('hud-debuff-mark').setScrollFactor(0).setDepth(HUD_FEEDBACK_DEPTH).setVisible(false);

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
      const r = this.host.add
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
    this.refreshGoalHud();
  }

  // OVERHAUL: the day's objective (rolled lazily on first read of the day) and
  // the run score + depth record. Recomputed on a key so the text objects are
  // only touched when something actually changed.
  //
  // Guarded because refreshStats() — which calls this — runs from build
  // before the goal/score texts exist; the first real call is the one at the
  // end of the band build, after they are created.
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
    this.host.fitHudLine(this.goalText, 1200);
  }

  /** 时钟行 + 楼层徽章刷新（public：场景 update/chargeTime/睡觉回调与冻结
   *  探针 split-step7/8 的 s.refreshClock() 都经场景同名委托走这里）。按值
   *  缓存，label 没变不碰对象。 */
  refreshClock(): void {
    const s = getGame();
    const label = hudClockLabel(s.day, s.gameMinuteOfDay);
    if (label !== this.lastClock) {
      this.lastClock = label;
      this.clockText?.setText(label);
    }
    this.floorBadge?.setText(`第${s.currentFloor}层`);
    if (this.clockText) this.host.fitHudLine(this.clockText, 164);
  }

  /**
   * 数值文本 + 四联圆环刷新（CombatHost/DialogueHost/世界链/冻结探针都走
   * 这一份实现——场景保留同名公开委托，控制器不复制第二份）。
   * public 由场景委托面调用；按值缓存，没变不碰对象。
   */
  refreshStats(): void {
    // Transactions can change money while a modal freezes the ordinary tick.
    this.refreshGoalHud();
    const p = getGame().player;
    const values = [p.hp, p.hunger, p.thirst, p.energy];
    const key = `${values.map((v) => Math.round(v)).join(',')}|${Math.round(p.stress ?? 20)}`;
    if (key === this.lastStats) return;
    this.lastStats = key;
    // AG-102（性能轮 3）：圆环整组重烤进 RenderTexture。这就是旧 clear+重画
    // 所在的位置——只在数值变化时跑，绝不每帧——RT 把 42 条弧在这里三角化
    // 一次，取代 WebGL 渲染器每帧的重三角化（实测 0.68ms/帧，见
    // docs/2026-11-18-PERF-ROUND2-CHUNK-CULL.md §4）。
    this.statRings?.redraw(values, STAT_BARS.map((s) => STAT_COLORS[s.key] ?? UI.good), UI.danger);
    this.ringRedraws += 1;
    values.forEach((v, i) => {
      const frac = v / 100;
      // 12 pips at 30 degrees: the concept sheet's bar, turned into a ring.
      // A stat running out lights danger red whatever its own colour is, the
      // same <=20% rule the bar had; its number goes warn with it.
      this.statValues[i]?.setText(String(Math.round(v)));
      this.statValues[i]?.setColor(frac <= 0.2 ? hex(TEXT.warn) : hex(TEXT.primary));
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
   *
   * public：帧循环每帧一行（世界链段）；四项文本各自 setText，Phaser 对同文
   * 本不重烤，与迁移前同口径。
   */
  refreshEnvironmentHud(): void {
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

    this.host.fitHudLine(this.envRegionText, HUD_LAYOUT.envChipX[2] - HUD_LAYOUT.envChipX[1] - 28);
    this.host.fitHudLine(this.envHumidText, HUD_LAYOUT.envChipX[3] - HUD_LAYOUT.envChipX[2] - 28);
    this.host.fitHudLine(this.envNightText, HUD_LAYOUT.hazardX - HUD_LAYOUT.envChipX[3] - 28);
  }

  /** 低血红环暗角：帧循环算 pulse（0..1 心跳），本类按各带权重落 alpha。
   *  判定在世界链（lowHpPulse 纯函数），绘制只有这一份。 */
  setVignettePulse(pulse: number): void {
    for (const p of this.vignetteParts) p.rect.setAlpha(pulse * p.weight);
  }

  /** AG-63 常驻标记：世界链判「饿不饿/渴不渴」，本类只画（null = 隐藏）。 */
  setDebuffMark(label: string | null): void {
    if (!this.debuffMark) return;
    if (label !== null) {
      if (this.debuffMark.text !== label) this.debuffMark.setText(label);
      this.debuffMark.setVisible(true);
    } else if (this.debuffMark.visible) {
      this.debuffMark.setVisible(false);
    }
  }

  // Keeps the standing bag-full warning in step with the bag. Runs before the
  // panel early-return below on purpose: a full bag matters most while the
  // inventory panel is open, which is exactly when the player is looking for
  // something to spend.
  //
  // AG-11: the warning carries the count (used/capacity). A bare "背包已满"
  // never said how full — 11/12 and 12/12 read the same and plan differently.
  refreshBagFullWarning(): void {
    if (!this.bagFullText) return;
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

  // ── 背包面板 ─────────────────────────────────────────────────────────────

  /**
   * AG-60 放大改版（用户 2026-11-17：「感觉 i 还是比较简陋吧，首先这个背包
   * 界面可以稍微做大一点」）：440x236 / 40px 格 / 12 格 → 880x360 / 76px 格 /
   * 14 格。几何数值全在 config/game-balance.json 的 bag 块（BAG_BALANCE），
   * 布局语言在 render/hudLayout.ts 的 BAG_LAYOUT——本方法内不硬编码尺寸。
   *
   * 视觉沿用 hudSkin 的铆钉板+危险条纹语言，不自创风格：buildPanel 的五段
   * 渐变底板与八件框筋原样保留，标题栏下加一条通栏危险条纹
   * （drawHazardStripe，HUD 同款），四角补 2x2 铆钉（drawHudPlate 的同款
   * 摆法）。底板半透明，世界照旧透得出来。
   *
   * 14 格 = 5 列 x 3 行（末行 4 格，ragged，与末行两格「未解锁」合成一组
   * 读数）。容量由 inventory.slotCount 决定（基础 12 + 置物架 2），超出当前
   * 容量的格子画成未解锁：压暗 + 斜纹 + 不响应鼠标；置物架做成后
   * refreshInventory 自然点亮，标题栏计数同步切到 x/14。
   */
  private buildInventoryPanel(): void {
    const { width, height } = this.host.viewSize();
    const panelW = BAG_BALANCE.panelWidth;
    const panelH = BAG_BALANCE.panelHeight;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    // Remembered for the mouse: a click outside this rectangle closes the panel.
    this.host.setPanelBox({ x: left, y: top, w: panelW, h: panelH });
    const depth = PANEL_DEPTH.game.inventory;

    this.invObjects.push(...buildPanel(this.sharedScene, cx, cy, panelW, panelH, 'item', depth));
    this.invObjects.push(...buildPanelHeader(this.sharedScene, left, top, panelW, '背包', UI.good, depth + 5));
    // The capacity readout on the header's right: used / capacity. It reads
    // inventory.slotCount (12, or 14 once the storage rack is crafted), NOT the
    // grid size — the old /12 said 12 even with the rack's two extra slots in
    // the save, and the two dimmed cells at the end of the grid now show exactly
    // what that count is talking about.
    this.invObjects.push(
      this.host.add
        .text(left + panelW - 10, top + BAG_LAYOUT.headerH / 2, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.highlight) })
        .setOrigin(1, 0.5)
        .setDepth(depth + 6),
    );
    this.invCountText = this.invObjects[this.invObjects.length - 1] as Phaser.GameObjects.Text;

    // ── 危险条纹 + 四角铆钉（hudSkin 语言，HUD 同款）─────────────────────
    const skin = this.host.add.graphics().setScrollFactor(0).setDepth(depth + 4);
    drawHazardStripe(
      skin,
      left + BAG_LAYOUT.stripeInset,
      top + BAG_LAYOUT.headerH,
      panelW - BAG_LAYOUT.stripeInset * 2,
      BAG_LAYOUT.stripeH,
      PALETTE.lightDeep,
    );
    skin.fillStyle(PALETTE.stoneLight, 0.85);
    const ri = BAG_LAYOUT.rivetInset;
    const rivetY = top + BAG_LAYOUT.headerH + BAG_LAYOUT.stripeH + 4;
    const rivets: Array<[number, number]> = [
      [left + ri, rivetY],
      [left + panelW - ri - 2, rivetY],
      [left + ri, top + panelH - ri - 2],
      [left + panelW - ri - 2, top + panelH - ri - 2],
    ];
    for (const [rx, ry] of rivets) skin.fillRect(rx, ry, 2, 2);
    this.invObjects.push(skin);

    // ── the grid ────────────────────────────────────────────────────────────
    // 5 columns x 3 rows of 76px cells: fourteen slots — the base 12 plus the
    // storage rack's 2, drawn locked until the rack is crafted — no scrolling,
    // and each cell is big enough for a 3x icon (pixel art upscales cleanly at
    // integer factors, unlike the old 16px icons in a 20px row).
    const GRID_X = left + BAG_LAYOUT.padX;
    const GRID_Y = top + BAG_LAYOUT.contentTop;
    const CELL = BAG_BALANCE.cellSize;
    const GAP = BAG_BALANCE.cellGap;
    const COLS = BAG_BALANCE.gridCols;
    const ROWS = Math.ceil(BAG_BALANCE.gridSlots / COLS);
    this.invCells = [];
    this.invSlotIcons = [];
    this.invSlotTexts = [];
    for (let i = 0; i < BAG_BALANCE.gridSlots; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = GRID_X + col * (CELL + GAP);
      const y = GRID_Y + row * (CELL + GAP);
      const cell = this.host.add.rectangle(x, y, CELL, CELL, 0x080c0f).setOrigin(0, 0).setAlpha(0.6).setDepth(depth + 5);
      const icon = this.host.add
        .image(x + CELL / 2, y + CELL / 2, 'blank')
        .setOrigin(0.5)
        .setScale(BAG_BALANCE.iconScale)
        .setDepth(depth + 6);
      const badge = this.host.add
        .text(x + CELL - 4, y + CELL - 4, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.primary), stroke: hex(PALETTE.ink), strokeThickness: 3 })
        .setOrigin(1, 1)
        .setDepth(depth + 7);
      this.invCells.push(cell);
      this.invSlotIcons.push(icon);
      this.invSlotTexts.push(badge);
      this.invObjects.push(cell, icon, badge);
      // Mouse: click selects; clicking the already-selected slot uses the item,
      // which is what Enter does. A LOCKED cell (beyond the current slotCount)
      // ignores the mouse entirely — it is capacity not earned yet. Pushed into
      // invObjects so it hides with the panel — an orphan hit rect would keep
      // eating clicks over the world.
      this.invObjects.push(
        this.host.panelHit(x, y, CELL, CELL, depth + 8, {
          onOver: () => {
            if (!this.invSlotUnlocked(i)) return;
            if (this.invSelected === i) return;
            this.invSelected = i;
            this.refreshInventory();
          },
          onClick: () => {
            if (!this.invSlotUnlocked(i)) return;
            if (this.invSelected !== i) {
              this.invSelected = i;
              this.refreshInventory();
              playSfx('click');
              return;
            }
            this.host.onUse();
          },
        }),
      );
    }
    // ONE Graphics for every cell border, created AFTER the cells so it draws
    // above their fills, and redrawn wholesale by refreshInventory: selection
    // and the rack's unlock both change border colour, and fourteen per-cell
    // Graphics objects would mean fourteen clear() calls to keep in step.
    this.invCellBorders = this.host.add.graphics().setScrollFactor(0).setDepth(depth + 6);
    this.invObjects.push(this.invCellBorders);

    // ── the detail pane ─────────────────────────────────────────────────────
    // The pane starts past the grid's FULL-row right edge (the last row is one
    // cell short: 14 = 5+5+4), so its left edge stays a clean vertical.
    const DETAIL_X = GRID_X + COLS * (CELL + GAP) - GAP + BAG_BALANCE.detailGap;
    const DETAIL_W = left + panelW - BAG_LAYOUT.padRight - DETAIL_X;
    const DETAIL_H = ROWS * (CELL + GAP) - GAP;
    this.invObjects.push(...buildPanelWell(this.sharedScene, DETAIL_X, GRID_Y, DETAIL_W, DETAIL_H, depth + 5));
    // Three rows at 12 / 62 / 104 inside the well. They used to sit at 10 / 48 /
    // 76 in a 130px well; the 244px well gives the type room to breathe, and the
    // anchors keep the 30px name's 37px line box clear of the 20px meta's.
    this.invDetailName = this.host.add
      .text(DETAIL_X + BAG_LAYOUT.detailPadX, GRID_Y + BAG_LAYOUT.detailNameY, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.title}px`, color: hex(PALETTE.lightHigh) })
      .setDepth(depth + 7);
    this.invDetailMeta = this.host.add
      .text(DETAIL_X + BAG_LAYOUT.detailPadX, GRID_Y + BAG_LAYOUT.detailMetaY, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(TEXT.dim) })
      .setDepth(depth + 7);
    this.invDetailBody = this.host.add
      // useAdvancedWrap is load-bearing, fourth time in this codebase: the basic
      // wrapper breaks on spaces only, and Chinese has none, so a width here is
      // silently ignored. Measured: the empty-slot sentence rendered 688px wide
      // inside a 520px panel, i.e. it ran 248px past the frame.
      .text(DETAIL_X + BAG_LAYOUT.detailPadX, GRID_Y + BAG_LAYOUT.detailBodyY, '', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.body}px`, color: hex(TEXT.primary), wordWrap: { width: DETAIL_W - BAG_LAYOUT.detailPadX * 2, useAdvancedWrap: true } })
      .setDepth(depth + 7);
    this.invObjects.push(this.invDetailName, this.invDetailMeta, this.invDetailBody);

    const footer = this.host.add
      .text(cx, top + panelH - BAG_LAYOUT.footerDrop, '↑/↓ 选择 · Enter 使用 · I 关闭', { fontFamily: FONT_FAMILY, fontSize: `${TYPE.caption}px`, color: hex(PALETTE.clothHigh) })
      .setOrigin(0.5, 0.5)
      .setDepth(depth + 6);
    this.invObjects.push(footer);
    // 选中光标随面板显隐（build 开头经 host.createMarker() 新建；与原
    // GameScene create 的 reset 块同款时机——先毁后建，不留旧光标）。
    if (this.invMarker) this.invObjects.push(this.invMarker);

    applyPanelDepth(this.invObjects, depth);
    this.host.assertPanelContent('inventory', this.invObjects);
    for (const o of this.invObjects) o.setVisible(false);
  }

  /** AG-60：格子 i 是否已解锁。容量 = inventory.slotCount（基础 12 + 置物架 2）。
   *  未解锁格不响应鼠标、画成压暗斜纹；置物架做成后本判官自然放行，不需要
   *  重建格子——刷新即点亮。 */
  private invSlotUnlocked(i: number): boolean {
    return i < getGame().player.inventory.slotCount;
  }

  /**
   * 背包面板刷新（DialogueHost/世界链/战斗掉落/交易都走这一份实现——场景
   * 保留同名公开委托，控制器不复制 HUD 刷新）。
   */
  refreshInventory(): void {
    const borders = this.invCellBorders;
    if (!borders) return;
    const slots = getGame().player.inventory.slots;
    const capacity = getGame().player.inventory.slotCount;
    if (this.invSelected >= BAG_BALANCE.gridSlots) this.invSelected = Math.max(0, BAG_BALANCE.gridSlots - 1);
    for (let i = 0; i < BAG_BALANCE.gridSlots; i++) {
      const badge = this.invSlotTexts[i];
      const icon = this.invSlotIcons[i];
      const stack = slots[i];
      // Keyed by item id, never by display name — see itemIconKey().
      //
      // No setVisible(true): refreshInventory() also runs while the panel is
      // CLOSED — looting a container, a shop trade and a neighbour trade all
      // call it. Showing the icon here used to float the bag's first row over
      // the world with no panel behind it: four icons straddling the top
      // frame of whatever panel happened to be open. Visibility is
      // toggleInventory's job — it sets the whole list, and the empty slots
      // below hide themselves again. A locked cell never has a stack
      // (slots.length <= slotCount), so it falls in here and stays empty.
      // AG-66：铲子走 ensureShovelIcon 程序化生成的 'shovel' 贴图（没生成
      // 成功就退 artpack 里最接近的撬棍），其余照旧按 id。
      if (stack && this.invSlotUnlocked(i)) {
        icon.setTexture(this.itemIconFor(stack.itemId));
        badge.setText(stack.quantity > 1 ? `${stack.quantity}` : '');
      } else {
        icon.setVisible(false);
        badge.setText('');
      }
    }
    // Cells + borders in one pass. The selection wash moves with the cursor;
    // a locked cell drops to a near-black fill with a diagonal hatch — the
    // hazard-stripe language, where a diagonal means "not yours yet". The
    // single borders Graphics is redrawn wholesale (built after the cells so
    // it draws above their fills).
    borders.clear();
    this.invCells.forEach((c, i) => {
      const unlocked = this.invSlotUnlocked(i);
      const selected = i === this.invSelected;
      c.setFillStyle(!unlocked ? 0x05070a : selected ? UI.accent : 0x080c0f, !unlocked ? 0.85 : selected ? 0.2 : 0.6);
      const x = c.x;
      const y = c.y;
      const size = c.width;
      if (unlocked) {
        borders.lineStyle(1, selected ? UI.accent : UI.line, selected ? 0.95 : 0.85);
        borders.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
      } else {
        borders.lineStyle(1, UI.line, 0.3);
        borders.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
        borders.lineStyle(1, PALETTE.stoneLight, 0.22);
        for (let d = 10; d < size; d += 18) {
          borders.lineBetween(x + d, y + 1, x + 1, y + d);
        }
      }
    });
    // AG-60: the count now reads the REAL capacity (slotCount: 12, or 14 with
    // the rack) instead of the grid size — the two dimmed cells at the end of
    // the grid are what the number is talking about.
    if (this.invCountText) this.invCountText.setText(`${slots.length}/${capacity}`);

    const selected = slots[this.invSelected];
    const cell = this.invCells[this.invSelected];
    // Same rule as the icons: the marker belongs to the open panel.
    this.invMarker?.setVisible(this.inventoryOpen && selected !== undefined && cell !== undefined);
    if (selected && cell && this.invMarker) placeMarkerLeftOf(this.invMarker, cell);

    if (selected) {
      const item = getItem(selected.itemId);
      const category = item.category === 'consumable' ? '消耗品' : item.category === 'material' ? '材料' : '工具';
      this.invDetailName?.setText(item.displayName);
      this.invDetailMeta?.setText(`${category} · 持有 ${selected.quantity}`);
      const effect = item.effect ? `${STAT_LABEL[item.effect.stat]} +${item.effect.amount}` : '';
      this.invDetailBody?.setText(effect || `${category}，暂时没有直接效果。`);
    } else if (!this.invSlotUnlocked(this.invSelected)) {
      // Defensive: the mouse and the arrow keys both refuse to land on a
      // locked cell, but a stale invSelected from an older build should say
      // so rather than claim the slot is merely empty.
      this.invDetailName?.setText('');
      this.invDetailMeta?.setText('');
      this.invDetailBody?.setText('锁着的格子。做出置物架就能多带 2 格。');
    } else {
      this.invDetailName?.setText('');
      this.invDetailMeta?.setText('');
      this.invDetailBody?.setText('空格子。搜刮、制作或交易都往这里放东西。');
    }
    // Safety net for the next caller that forgets: with the panel closed there
    // is nothing of the bag on screen, whatever the data did on the way here.
    if (!this.inventoryOpen) for (const o of this.invObjects) o.setVisible(false);
  }

  /** 开/关背包面板（I 键与菜单「返回」走同一条路径）。 */
  toggle(): void {
    this.inventoryOpen = !this.inventoryOpen;
    for (const o of this.invObjects) o.setVisible(this.inventoryOpen);
    if (this.inventoryOpen) {
      this.invSelected = 0;
      this.refreshInventory();
    }
  }

  /** ↑/↓ 移动选中格（钳位 + 重画都在这里；两方向的钳位口径与迁移前逐字
   *  一致——上路只钳下界 0，下路钳到 slots.length-1）。 */
  moveSelection(delta: number): void {
    if (delta < 0) {
      this.invSelected = Math.max(0, this.invSelected - 1);
    } else {
      const count = getGame().player.inventory.slots.length;
      this.invSelected = Math.min(Math.max(0, count - 1), this.invSelected + 1);
    }
    this.refreshInventory();
  }

  /** clearStrayPanels 的恢复面（与 dialogueCtl/combat 同款）：面板件列表
   *  只读交出，生命周期仍归本类。 */
  panelObjectsForRecovery(): ReadonlyArray<PanelObject> {
    return this.invObjects;
  }

  // ── AG-66：背包格图标 ────────────────────────────────────────────────────

  /** AG-66：背包格图标——铲子用程序化贴图，没生成成功退 artpack 的撬棍。 */
  private itemIconFor(itemId: ItemId): string {
    if ((itemId as string) === SHOVEL_ICON_KEY && this.shovelIconReady) return SHOVEL_ICON_KEY;
    return itemIconKey(itemId);
  }

  /**
   * AG-66：程序化画一把 16×16 铲子图标。artpack 的 ITEM_ICON_FILES 与 ITEMS
   * 一件不差被 itemIcons.test.ts 钉死（且 render/ 不归本工单），新工具因此不走
   * 贴图清单，在 build 里现画一个：木柄 + 铲头 + 一粒高光，全 16 色板。
   */
  private ensureShovelIcon(): void {
    this.shovelIconReady = this.host.textures.exists(SHOVEL_ICON_KEY);
    if (this.shovelIconReady) return;
    const g = this.host.add.graphics();
    g.fillStyle(PALETTE.skinDeep, 1);
    g.fillRect(4, 1, 3, 9);
    g.fillStyle(PALETTE.stone, 1);
    g.fillRect(3, 9, 5, 3);
    g.fillStyle(PALETTE.stoneLight, 1);
    g.fillRect(4, 10, 4, 3);
    g.fillStyle(PALETTE.dust, 1);
    g.fillRect(5, 10, 1, 2);
    g.generateTexture(SHOVEL_ICON_KEY, 16, 16);
    g.destroy();
    this.shovelIconReady = this.host.textures.exists(SHOVEL_ICON_KEY);
  }

  // ── 读数面（探针/调试；运行期字段，TS private 不挡 page.evaluate）───────

  /** 背包面板开着没有（e2e 六处按 scene.inventoryOpen 读——场景留 getter
   *  委托到这里，契约不变）。 */
  get isOpen(): boolean {
    return this.inventoryOpen;
  }

  /** 当前选中格（onUse 的收音机/消耗品分支读它走 useRadioFromSlot）。 */
  get selectedIndex(): number {
    return this.invSelected;
  }

  /** 上次刷新的数值组合键——冻结探针对比两跑同输入同键。 */
  get lastStatsKey(): string {
    return this.lastStats;
  }

  /** 上次刷新的目标行键——冻结探针对比两跑同输入同键。 */
  get lastGoalKeyShown(): string {
    return this.lastGoalKey;
  }

  /** 上次写进时钟行的标签——冻结探针对比两跑同输入同文。 */
  get lastClockLabel(): string {
    return this.lastClock;
  }

  /** 圆环 RT 重烤次数——AG-102「只在数值变化时重烤」的可执行断言。 */
  get ringRedrawCount(): number {
    return this.ringRedraws;
  }

  /** 背包满预警当前显示着没有（bagFullWarning e2e 的机读面）。 */
  get bagWarningShown(): boolean {
    return this.bagFullShown;
  }
}
