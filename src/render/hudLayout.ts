import { formatClock } from '../systems/SurvivalSystem';
import { DESIGN_WIDTH } from '../core/design';
import { TIERS, tierOf, type TierId } from '../core/tower';

// Coordinates are design-canvas pixels. Scale.FIT scales this single layout
// across host window sizes; these lanes never move with the world camera.
// Geometry of the 2026-11-14 HUD skin (see render/hudSkin.ts). Three rows on one
// plate: instruments, the day's objective, the environment readout.
//
// AG-54: the instrument row's four segmented bars became four segmented rings
// (the user's "圆环的那种"). Same row, same pitch, same money lane:
// statX/statPitch/statWidth describe the four ring groups, ringCY/ringR/
// ringStroke the gauge itself, and the value lives in the ring's centre as a
// Text. barY/barH/barSegments are gone with the bars they described.
//
// The plate was 132 tall and the wall band starts at y=8 inside a 200px floor:
// at zoom 0.5 with the camera pinned to -64, 60 of the wall's 128 rows sat above
// the plate and 34 more sat behind it — 46.9% of every wall in the game was
// either clipped by the screen edge or painted over. The three rows are
// tightened to 102 here, and GameScene's bottom-floor camera bound moves to the
// plate's own bottom, so the art's first row lands exactly under the HUD.
export const HUD_LAYOUT = {
  topHeight: 50,
  contextBottom: 102,
  statX: 292,
  statPitch: 192,
  // AG-54: 172 -> 120. The bar groups were a 172px bar under the label; a ring
  // group is the 46px ring plus its icon and label, so 120 holds it with the
  // pitch untouched. hudLayout.test.ts pins the block's end against moneyX.
  statWidth: 120,
  // AG-23: goalY stays 52 — the objective row's box (52..77 at 20px GameSans)
  // already clears the environment row (80), and hudLayout.test.ts pins that
  // 28px lane gap. The clock/goal collision is fixed from the clock's side
  // instead (row1Y below).
  goalY: 52,
  environmentY: 80,
  feedbackY: 556,
  bagY: 624,
  // Row 1 anchors: icons sit 2px above their label's cap height.
  //
  // AG-23: 6 → 2. The clock opens at row1Y+28 and the goal at goalY=52: two
  // 20px GameSans rows are 25px of line box each, so at row1Y=6 the clock's
  // box (34..59) printed 7px through the goal's (52..77) — 28% of the smaller
  // box, measured (AG-24's font:209), the 1.0em-era anchors never did. Moving
  // row 1 up 4px puts the clock's box at 30..55: a 3px box overlap (12%, under
  // the 15% collision threshold) with 5px of ink clearance. The goal row could
  // not move instead — hudLayout.test.ts pins the 28px goal→environment lane
  // gap, and the environment row cannot move down without crossing the plate's
  // bottom edge (contextBottom 102, AG-20's compaction).
  row1Y: 2,
  // The ring gauge (AG-54): centred in row 1, a 12-pip segmented circle. R=23
  // with a 5px stroke leaves a 36px well for the value Text, and the ring's
  // 2..48 band clears both the plate's top hairline and the row separator at
  // topHeight. A running-out stat (<=20%) lights its pips in UI.danger
  // instead, exactly where the old bar went red.
  ringCY: 25,
  ringR: 23,
  ringStroke: 5,
  // The label's row, vertically centred on the ring for a 20px caption (a 25px
  // GameSans line box, so 25 - 12).
  statLabelY: 13,
  // Where the money group starts; the stat block has to end before this.
  //
  // AG-23: 1080 → 1056. The money texts open at moneyX+24 and grow rightwards
  // from there (origin 0,0), and the >240px font-shrink guard never saw the
  // 12-digit test fixture: "金币 123456789012" measured 178px wide at 20px
  // GameSans and put hud-gold's right edge at 1282 — 2px off the 1280 canvas,
  // measured at all three viewports (AG-24's hudLayout:39:3). 1056 keeps the
  // stat block (which ends at statX + 3*pitch + width = 1040) 16px clear and
  // pins the group's right edge at 1258, 22px inside the canvas.
  moneyX: 1056,
  // Environment chips: icon x positions, text 24px to their right.
  envChipX: [20, 300, 620, 900],
  hazardX: 1080,
  // ── AG-67: the bottom-right character status card ───────────────────────
  // A compact riveted card in the right-bottom lane: the picked survivor's
  // avatar, the four survival stats as mini segmented bars with live numbers,
  // and one line of situational summary derived from those numbers. The top
  // plate already carries the four rings (AG-54), so this is deliberately NOT
  // a second four-ring cluster — it is the character card, "who am I and how
  // am I holding up", the money/score lane's counterpart at the other corner.
  //
  // The lane is pinned by its neighbours, not by taste: the card's bottom edge
  // sits on feedbackY (556) so it never prints through the feedback lane or
  // the bag-full warning (bagY 624), and its right edge takes the same 16px
  // margin the HUD button row below it uses. hudLayout.test.ts's lane contract
  // (contextBottom < feedbackY) is untouched — the card hangs under the plate,
  // over the transient lanes, clear of the buttons at y 664.
  statusCardX: DESIGN_WIDTH - 16 - 240,
  statusCardY: 376,
  statusCardW: 240,
  statusCardH: 180,
  /** Stat rows inside the card: label x, bar x/width/height, row pitch. */
  statusRowLabelX: 12,
  statusRowBarX: 52,
  statusRowBarW: 96,
  statusRowBarH: 8,
  /** First row's centre, then pitch; the avatar/name header sits above. */
  statusRowFirstCY: 448,
  statusRowPitch: 23,
  /** The summary line's centre, near the card's bottom. */
  statusSummaryCY: 542,
  // 裁决记录（merge ag-63）：两侧各自新增不冲突字段（AG-67 状态卡几何在右
  // 下 lane 底 556，AG-63 debuff 标记在左脚注线上 668，无重叠），全部保留。
  // AG-63: 饥饿/干渴 debuff 的常驻小标记（身上绿光的名字）。它塞在两条既有
  // lane 之间的一根 25px 线：上是「背包已满」预警（bagY=624，盒高 31，底
  // 655），下是脚注条（DESIGN_HEIGHT - HUD_FOOT_H = 680）。中线 668 让这条
  // caption 线的盒上下都刚好擦着不进——两条 lane 同时出现时盒距 0.5px，
  // 字墨相距 8px；与脚注条自己的提示行（y=700）盒距 7px。x 与 hud-hint
  // 同一条左边缘，读起来像脚注条上面的状态行，而不是又一块新板子。
  debuffMarkX: 8,
  debuffMarkY: 668,
  // 裁决记录（merge ag-80）：AG-80 的 FPS 计数器几何（右上腰 y 108）与
  // AG-63 debuffMark（左脚注线 668）、AG-67 状态卡（右下 376..556）均无
  // 重叠，两侧新增字段全部保留。
  // ── AG-80: the FPS counter (perf HUD) ─────────────────────────────────
  // 右上角逐个：顶板的三条横向车道（row1 钱币/分数、goalY 目标、
  // environmentY 环境 chips）都在 y ≤ 105，计数器右缘钉 12px 内边距、落在
  // 顶板下沿（contextBottom 102）之下 6px——状态卡（statusCardY 376）之上
  // 的整段右腰没有任何 HUD。默认不可见（F3 切换），不参与既有车道取证；
  // 文字自带 0b0f12 底板（hud-feedback 同款读法），世界再亮也读得清。
  // 为什么不是 F 键：F 是 AG-50 的「楼梯口抄近路」快捷键，抢键会让玩家在
  // 梯口按一下计数器就付一笔金子。调试覆盖层的通用键位是 F3。
  fpsX: DESIGN_WIDTH - 12,
  fpsY: 108,
} as const;

// ── AG-71: the bottom navigation bar ───────────────────────────────────────
// 2026-11-17 参考 UI 的底部常驻导航栏：一个 contextual 槽（最左，接管 hud-hint
// 的世界链/面板链文案）+ 五个固定槽（背包 I / 制作 C / 产业 G / 地图 M /
// 菜单 Esc）。它同时接替了两样东西：左下角那行 hud-hint 脚注（ contextual
// 槽接管它的文案，Text 本身保留为不可见状态对象，e2e 仍按 name 断言）和
// 右下角那排 framedButton（五个固定槽就是按钮行的常驻形态，热区同一套守卫）。
//
// 几何全部按实测钉住（20px GameSans，canvas measureText 逐串量过）：
//   * contextW 560 —— 最长的 contextual 串是制作面板提示
//     「↑/↓ 选择 · Enter 制作 · 拖拽平移 · 滚轮缩放 · C 关闭」实测 500px，
//     加上左内边距 16（无键帽时）/ 键帽 22+8（世界链）后仍小于 560-12。
//   * 五个固定槽等分剩下的 720px：144 一个。最宽的槽内容是「菜单 Esc」
//     实测 76px + 图标 16 + 间隔 6 = 98，居中后两侧各剩 23px。
//   * height 48 —— 20px 文案的线盒是 25px（fontLineBox），上下各留 11/12px；
//     drawHudPlate 的四角铆钉落在板内 8 与 h-9=39 两行。
//   * 板顶 672 = DESIGN_HEIGHT - 48：背包警告文案底约 655（hudLayout.spec.ts
//     钉的 bagY+52<680 车道不变），状态卡底 556 更在其上，世界可读区（角色
//     居中在屏高 360 附近）不相交。
export const NAV_BAR = {
  /** 板高，下缘钉在设计画布底边（DESIGN_HEIGHT）。 */
  height: 48,
  /** contextual 槽宽（最左；左缘 3px 暖色 accent 条之后量起）。 */
  contextW: 560,
  /** 五个固定槽的等宽：(1280-560)/5 = 144。 */
  slotW: (DESIGN_WIDTH - 560) / 5,
  /** 槽内 hudIcon 的边长（hudSkin 的 16px 格）。 */
  iconSize: 16,
  /** 图标与标签文本之间的间隔。 */
  iconGap: 6,
  /** contextual 文本可用宽度（fitHudLine 的上限；最长的实测串 500）。 */
  contextTextW: 532,
  /** contextual 文本左内边距（无键帽时）。 */
  contextPadX: 16,
  /** contextual 键帽（仅世界链「按 E ××」时画）的宽高与字母字号。 */
  keycapW: 22,
  keycapH: 18,
  keycapFont: 14,
  /** 键帽与文本之间的间隔。 */
  keycapGap: 8,
  /** 板顶危险条纹厚（顶带同款签名条，顶带那条在环境行下方）。 */
  stripeH: 3,
} as const;

/** contextual 槽固定槽 i（0..4）的左缘 x。 */
export function navSlotX(i: number): number {
  return NAV_BAR.contextW + i * NAV_BAR.slotW;
}

export function hudClockLabel(day: number, minute: number): string {
  return `D${day} ${formatClock(minute)}`;
}

// ── AG-70: the combat action bar ─────────────────────────────────────────
// 2026-11-17 用户原话：「我不是说那个就是打击别人的时候展示战斗然后我们
// 打击吗，不要做那种文本框，我们点击攻击看不见人的操作了」。440×232 的
// 中央文字面板因此整块拆除，换成底部一条三个大按钮的动作条；战斗信息
// （掉血/未命中/格挡）走角色头顶飘字，日志降级成左下角三行半透明小字。
//
// 硬边界（导航条 AG-71 板顶 672，bagY 警告车道 624，状态卡底 556）：
//   * 板体 y 604..656：底边 656 距导航条顶 672 留 16px 净空，距 bagY
//     警告文本顶 624 有 20px——x 上也错开（见下），两者永不同框；
//   * 三个按钮等宽 200、间距 16，总宽 632，居中（左缘 combatBarX()）；
//   * 回合日志在左下 x 20..316，与动作条左缘 324 之间有 8px 沟，垂直
//     重叠区不碰字；三行 540..613，压在 bagY 警告（624）之上、feedback
//     车道（556，瞬态且战斗中为空）之下，caption 20px 的 25px 线盒用 24
//     行距刚好首尾相接。
export const COMBAT_BAR = {
  /** 单个动作按钮的宽与高。 */
  btnW: 200,
  btnH: 52,
  /** 按钮间距。 */
  gap: 16,
  /** 动作条板顶 y（底 656 ≤ 660 硬线）。 */
  y: 604,
  /** 左下角回合日志：左缘 x、首行 y、行距、可用宽（三行小字半透明）。 */
  logX: 20,
  logY: 540,
  logPitch: 24,
  logW: 296,
  /** 「第 N 回合」标签：动作条上方居中。 */
  turnY: 588,
} as const;

/** 三个按钮横排的居中左缘 x。 */
export function combatBarX(): number {
  return (DESIGN_WIDTH - (3 * COMBAT_BAR.btnW + 2 * COMBAT_BAR.gap)) / 2;
}

// ── AG-72: the settings panel (MenuScene 覆盖层 / SettingsScene) ──────────
// 上架 Steam 的硬缺口：设置面板五件套（SFX 音量 / BGM 音量 / 震屏 /
// 文本速度 / 语言）+ 恢复默认 + 返回，共 7 行。几何钉在这里，与 HUD/塔楼
// 同款契约：设计画布固定 1280x720，Scale.FIT 消化窗口尺寸，这些设计像素
// 一个都不动。两个宿主（标题屏覆盖层、暂停菜单的 SettingsScene）共用同一
// 组数字，settings.test.ts 按算术断言行区不出板。
export const SETTINGS_PANEL = {
  /** 面板宽。右内边距留给 ▶ 箭头（arrowRX 20px 字，中心 544）。 */
  w: 580,
  /** 面板高。页脚提示行（footY 348，25px 线盒）之下留 15px 沉深。 */
  h: 376,
  /** 行区第一行的顶（相对面板顶）：标题栏 30 + 22 气。 */
  rowsTop: 52,
  /** 行高：24px GameSans 的 30px 线盒 + 6px 气。 */
  rowH: 36,
  /** 行距：36 + 4px 气。 */
  rowPitch: 40,
  /** 行标签左内边距（相对面板左缘）。选区箭头落在 labelX-12。 */
  labelX: 24,
  /** 音量滑条左缘（相对面板左缘）。 */
  barX: 190,
  /** 音量滑条宽。barX+barW=390，值列从 402 起。 */
  barW: 200,
  /** 音量滑条厚。 */
  barH: 12,
  /** 值列左缘（相对面板左缘）。'100' 24px 实测约 40px 宽。 */
  valueX: 402,
  /** ◀ ▶ 两枚箭头的中心 x（相对面板左缘）。 */
  arrowLX: 480,
  arrowRX: 524,
  /** 页脚提示行的中心 y（相对面板顶）。 */
  footY: 348,
} as const;

// ── tower overview (TowerOverviewScene) ─────────────────────────────────────
// The map's fixed lanes, exported so uiLayout.test.ts can assert the fit
// arithmetically (estimateTextWidth) instead of by screenshot. Everything the
// scene draws at scrollFactor(0) is positioned from these.
//
// The strip used to run STRIP_X .. DESIGN_WIDTH - STRIP_X, leaving a symmetric
// 110px margin — and the 终点 tag is 169px wide at 22px, so it hung 69px off
// the canvas (measured: right edge 1349 on 1280). The strip gives up the width
// so the endpoint tags and their ticks fit inside the right margin.
export const TOWER_STRIP_X = 110;
/** Right margin reserved for the endpoint tags, the boss tags and their ticks. */
export const TOWER_ENDPOINT_MARGIN = 200;
export const TOWER_STRIP_W = DESIGN_WIDTH - TOWER_STRIP_X - TOWER_ENDPOINT_MARGIN;
/** Where an endpoint/boss tag's left edge sits, right of the strip. */
export const TOWER_TAG_X = TOWER_STRIP_X + TOWER_STRIP_W + 10;
/**
 * The bottom band's top edge, measured UP from the canvas bottom: every footer
 * text (control hint, legend, transient message) opens at
 * DESIGN_HEIGHT - TOWER_FOOT_TOP. This was 22, which put the 26px hint's
 * measured bounds at y 698..731 — 33px tall with 6px of padding, the last 11
 * pixels fell off the 720px canvas on all three levels (Playwright getBounds()).
 * 36 cleared the full 33px row with 3px to spare.
 *
 * 41 now: the Noto Sans SC swap (GameSans) re-measured the same row. A 26px
 * GameSans line box is 32px, not the old face's 27px, so the hint with its 6px
 * of padding is 38px tall and 36 put its bottom at 722 — 2px off the canvas
 * (Playwright getBounds at 900x600 / 1280x800 / 1920x1080, all three viewports,
 * the canvas letterboxes but the design lanes do not move). 41 restores the
 * 3px spare: the band opens at 679, the 38px row ends at 717. The detail
 * level's back arrow opens one row above the band and keeps its 10px
 * clearance (637..669 against 679).
 */
export const TOWER_FOOT_TOP = 41;

/** The footer hint's font size, so a layout test can predict its width. */
export const TOWER_HINT_FONT = 26;
/** Endpoint tag font size (起点/终点 and the BOSS tags share it). */
export const TOWER_TAG_FONT = 22;

// ── tower floor-detail card (TowerOverviewScene, floor level) ───────────────
// The card measured from its own top. Exported for the same reason as the lanes
// above: uiLayout.test.ts asserts the fit arithmetically.
//
// The rows used to sit on a 20px pitch under 26px type (27px measured), so
// every row printed 7px through the next, and the action line at panelH-20
// landed on the fifth row (Playwright getBounds: 36x16px overlap). The content
// row also ran unwrapped — a floor's container list reaches 1113px (measured
// across seeds 42/7/2026, worst floor 50008) against 434px of inner width. The
// card sizes itself around the content's wrapped line count, the same way the
// dialogue panel does.
export const DETAIL_PANEL_W = 460;
/** The base card (one content line); refreshDetail grows it for longer lists. */
export const DETAIL_PANEL_H = 178;
export const DETAIL_ROW_X = 26;
export const DETAIL_ROWS_TOP = 62;
// AG-23: 30 → 32 = fontLineBox(TOWER_BODY). The rows are 26px GameSans type,
// which is a 32px line box; at a 30px pitch every row's box printed 2px
// through the next (6% of the box — under the e2e's 15% collision threshold,
// and the ink never touched, which is why it shipped). 32 makes the boxes
// exactly touch, the same contract the dialogue rows have
// (DIALOG_ROW_PITCH = fontLineBox(TYPE.body)), and keeps the card's derived
// height formula honest: the rows are positioned with origin (0,0) from
// DETAIL_ROWS_TOP, so the pitch IS the row height.
export const DETAIL_ROW_PITCH = 32;
export const DETAIL_ROW_COUNT = 5;
/** The content row's wrap width: panel width minus the row inset and a right inset. */
export const DETAIL_CONTENT_W = DETAIL_PANEL_W - DETAIL_ROW_X - 16;
/** Content row bottom → action line. */
export const DETAIL_CONTENT_ACTION_GAP = 12;
/** Action line bottom → panel bottom edge. */
export const DETAIL_FOOT_PAD = 16;

// ── tower map: the building cross-section (AG-62) ───────────────────────────
// The 2026-11-17 map redo. The tower overview used to be one 3px-per-sector
// strip: 100 rows in 300px, so opening the map showed all 100000 floors at once
// as a bar chart — the user's 「不要一下子看到 1 万层很奇怪」. It is now a
// building cross-section: the basement (floors 1-5, the 基础发育区) as a thick
// base, one block per tier with structural seams between them, and a default
// camera that focuses on the segment the player stands in instead of the whole
// spire. Zooming out still fits the whole tower.
//
// TWO COORDINATE MODELS, and the split is the whole trick:
//
//   * the internal one is a building's own: y grows UP, the foundation sits at
//     y=0 and the summit at y=buildingHeight(). That is how a tower is
//     reasoned about — tier 1 at the bottom, tier 6 at the top — and every
//     pure function below is written in it.
//   * the public one is Phaser's screen model: y grows DOWN, so the foundation
//     ends up at the BOTTOM of the map and the summit at the top. Every
//     exported function is one flip of the internal answer. The scene then
//     draws with plain Phaser coordinates and never thinks about the flip.
//
// World units, not design-canvas pixels: the camera is the design canvas
// (1280x720) at a fractional zoom, so a world unit is 1/zoom screen pixels.
// Pure arithmetic only — this module keeps no Phaser import, so
// towerMap.test.ts can assert the geometry under Node.

export const TOWER_MAP = {
  /** 1-5 层：地下基座。起始发育区（玩家宿舍在 1 层），用户点名要能看见。 */
  baseFloors: 5,
  /** 地基（基座之下的承台），画成比楼体宽一截的托脚。 */
  foundationH: 20,
  /** 基座段世界高度：5 层摊 30 单位/层，是 T1 每层楼距的 10 倍——「厚」就是
   *  它在视觉上独立于上面六个阶层段的方式。 */
  baseH: 150,
  /** 每个阶层段等高。故意不按楼层数比例：阶层的大小本来就不均匀（99 层 vs
   *  40000 层），按比例画 T1 会变成一根线；等高的段 + 段内楼层密度差才是
   *  「一栋楼的一段」该有的读法。 */
  tierH: 300,
  /** 段间结构层：平台/机房。没有楼层的缝，16 单位在默认缩放下约 18px。 */
  seamH: 16,
  /** 楼体世界宽度，水平居中于 DESIGN_WIDTH/2。默认缩放下约 989px——楼体几乎
   *  占满画布宽度，这是「板体要满」那条要求的落点。 */
  buildingW: 860,
  /** 固定 HUD 的下缘：楼体内容（含世界空间标签）不越过它，否则标题/状态签会
   *  和阶层铭牌互压（firstChapter.spec.ts 的 15% 重叠阈值）。 */
  topBand: 88,
  /** 页脚带的上缘（TOWER_FOOT_TOP 之下再留 7px 余量）。 */
  bottomBand: 672,
  /** 默认聚焦缩放：当前段全段 + 上下各一段的大部分（可见世界高约 626 单位）。 */
  zoomDefault: 1.15,
  /** 细节缩放：T1 的每层楼距在屏上约 18px，可数。 */
  zoomMax: 6,
  /** 区段视图：1000 层在放大镜里每层 8 单位（默认缩放 8px/层）。 */
  sectorPitch: 8,
  sectorZoomMin: 0.3,
  sectorZoomDefault: 1,
  sectorZoomMax: 6,
} as const;

// ── internal model: y up, foundation at 0 ──────────────────────────────────

function upBaseTop(): number {
  return TOWER_MAP.foundationH + TOWER_MAP.baseH;
}

/** 第 tier 个阶层段（1..6）的底边世界 y（楼体自己的坐标，向上增长）。 */
function upTierBlockBottom(tier: TierId): number {
  return upBaseTop() + TOWER_MAP.seamH + (tier - 1) * (TOWER_MAP.tierH + TOWER_MAP.seamH);
}

function upTierBlockTop(tier: TierId): number {
  return upTierBlockBottom(tier) + TOWER_MAP.tierH;
}

/** 楼层在楼体里的世界 y（楼体自己的坐标）。1-5 层在基座里，其余按所属阶层段均布。 */
function upBuildingFloorY(floor: number): number {
  if (floor >= 1 && floor <= TOWER_MAP.baseFloors) {
    const pitch = TOWER_MAP.baseH / TOWER_MAP.baseFloors;
    return TOWER_MAP.foundationH + (floor - 0.5) * pitch;
  }
  const tier = tierOf(floor); // 越界楼层在这里抛
  const count = tier.maxFloor - tier.minFloor + 1;
  const pitch = TOWER_MAP.tierH / count;
  return upTierBlockBottom(tier.id) + (floor - tier.minFloor + 0.5) * pitch;
}

/**
 * 世界 y 落在哪一层（楼体自己的坐标）。基座与阶层段内返回楼层；地基与段间结构层
 * 没有楼层，返回 null——悬停/点击落在缝上时什么都不选中，比吸附到最近楼层
 * 更诚实（缝里确实没有楼层）。
 */
function upFloorAtBuildingY(y: number): number | null {
  if (y < 0 || y > buildingHeight()) return null;
  if (y < upBaseTop()) {
    if (y < TOWER_MAP.foundationH) return null;
    const pitch = TOWER_MAP.baseH / TOWER_MAP.baseFloors;
    const i = Math.floor((y - TOWER_MAP.foundationH) / pitch);
    return Math.min(TOWER_MAP.baseFloors, i + 1);
  }
  for (const tier of TIERS) {
    const bottom = upTierBlockBottom(tier.id);
    const top = bottom + TOWER_MAP.tierH;
    if (y >= bottom && y < top) {
      const count = tier.maxFloor - tier.minFloor + 1;
      const pitch = TOWER_MAP.tierH / count;
      const i = Math.floor((y - bottom) / pitch);
      return tier.minFloor + Math.min(count - 1, i);
    }
  }
  return null; // 段间结构层
}

// ── public model: y down, Phaser-native, the building stands on screen ──────

/** 楼体左边缘的世界 x（buildingW 居中）。 */
export function buildingX0(): number {
  return (1280 - TOWER_MAP.buildingW) / 2;
}

/** 楼体右边缘的世界 x。 */
export function buildingX1(): number {
  return buildingX0() + TOWER_MAP.buildingW;
}

/** 整栋楼的世界高度 = 塔顶到地基底。 */
export function buildingHeight(): number {
  return upTierBlockTop(6);
}

/** 基座段在世界里的 y 区间上沿（屏幕上沿，较小 y）。 */
export function baseLowY(): number {
  return buildingHeight() - upBaseTop();
}

/** 基座段在世界里的 y 区间下沿（屏幕下沿，较大 y）= 地基顶。 */
export function baseHighY(): number {
  return buildingHeight() - TOWER_MAP.foundationH;
}

/** 第 tier 个阶层段在世界里的 y 区间上沿（屏幕上沿）。 */
export function tierBlockLowY(tier: TierId): number {
  return buildingHeight() - upTierBlockTop(tier);
}

/** 第 tier 个阶层段在世界里的 y 区间下沿（屏幕下沿）。 */
export function tierBlockHighY(tier: TierId): number {
  return buildingHeight() - upTierBlockBottom(tier);
}

/** 楼层在楼体里的世界 y（屏幕坐标：1 层在最下，100000 层在最上）。 */
export function buildingFloorY(floor: number): number {
  return buildingHeight() - upBuildingFloorY(floor);
}

/** 世界 y 落在哪一层（楼体坐标，y 向下）。地基与结构层返回 null。 */
export function floorAtBuildingY(y: number): number | null {
  return upFloorAtBuildingY(buildingHeight() - y);
}

/** 区段 ribbon 的世界高度（1000 层）。 */
export function sectorRibbonHeight(): number {
  return 1000 * TOWER_MAP.sectorPitch;
}

/** 区段视图里楼层 f 的世界 y：段顶（to）在 y=0，段底（from）在 Ribbon 底部。 */
export function sectorRibbonY(from: number, floor: number): number {
  return (from + 999 - floor) * TOWER_MAP.sectorPitch;
}

/** 世界 y 落在区段 ribbon 的哪一层；带外返回 null。 */
export function floorAtRibbonY(from: number, to: number, y: number): number | null {
  if (y < 0 || y >= sectorRibbonHeight()) return null;
  const floor = to - Math.floor(y / TOWER_MAP.sectorPitch);
  return floor >= from && floor <= to ? floor : null;
}

/** 内容带高度（缩放与滚动夹制的可用区间）。 */
export function contentBandHeight(): number {
  return TOWER_MAP.bottomBand - TOWER_MAP.topBand;
}

/**
 * 全塔缩放：整栋楼正好落进内容带。这也是总览的缩放下限——「看全塔」就是缩到
 * 底，再小只会让楼体周围露出天空，没有信息可看。滚轮/键盘都夹在它上面。
 */
export function towerFitZoom(): number {
  return contentBandHeight() / buildingHeight();
}

/**
 * 镜头中心的夹制范围：内容必须始终盖住内容带——既不许把楼拖出屏幕留下死区，
 * 也不许把固定 HUD 让给楼体。返回 [min, max] 世界 y。
 *
 * 推导（y 向下）：屏 y = (世界 y - viewTop) * zoom，viewTop = 中心 - 可见高/2。
 *   * 带上沿（topBand）必须仍看到内容顶（世界 0）：viewTop ≥ -topBand/zoom。
 *   * 带下沿（bottomBand）必须仍看到内容底（世界 contentHeight）：
 *     viewTop ≤ contentHeight - bottomBand/zoom。
 * 内容装得进内容带时（全塔视角）只有一个合法中心：内容居中于带，此时段界与
 * 通用分支在边界缩放上严格相接（towerMap.test.ts 钉住这一点）。
 */
export function viewCenterBounds(contentHeight: number, zoom: number): { min: number; max: number } {
  const viewH = 720 / zoom;
  const half = viewH / 2;
  // +0.001 的容差：fitZoom = 带高/楼高 在 IEEE754 下乘回去可能大出一个 ulp，
  // 容差保证「恰好装下」时稳定走居中分支（min === max），测试才钉得住。
  if (contentHeight * zoom <= contentBandHeight() + 0.001) {
    const center = contentHeight / 2 + half - (TOWER_MAP.topBand + TOWER_MAP.bottomBand) / 2 / zoom;
    return { min: center, max: center };
  }
  return {
    min: half - TOWER_MAP.topBand / zoom,
    max: contentHeight + half - TOWER_MAP.bottomBand / zoom,
  };
}

// ── game floor: container name labels (GameScene.buildContainers) ───────────
// How far the container name drops from the prop's base (FLOOR_HEIGHT - 68).
//
// The old anchor was `propTop - 8`, which measured as a plate at y 53..83: it
// hugged the full-width structural band at 52..78 (so the name read as part of
// the wall, not part of the crate) and its bottom edge dipped ~4px onto the
// prop's own art. 36 puts the plate at y 81..111 — on the prop's face, clear of
// the band — and lands it on exactly the band the stair labels already use
// (FLOOR_HEIGHT - 104 = 96), so every nameplate on the floor shares one line.
export const CONTAINER_LABEL_DROP = 36;

// ── AG-60: the bag panel (GameScene.buildInventoryPanel) ────────────────────
// 背包面板的布局语言。尺寸数值（面板宽高/列数/格子/图标倍率）不走这里——它们在
// config/game-balance.json 的 bag 块，由 GameScene 的 BAG_BALANCE 读取；这里
// 只放「部件怎么拼」：标题栏多高、危险条纹多厚、内容区距顶多少、详情三行锚点、
// 页脚沉深、铆钉内缩。与上面 HUD 三视口同款的响应式契约：设计画布固定
// 1280x720，窗口 900x600 / 1920x1080 由 Scale.FIT letterbox 消化，这些设计
// 像素一个都不动，面板永远居中、不出板（e2e/ag60-bag-panel.spec.ts 三视口
// getBounds 实测）。改版前 440x236（34% 宽）/40px 格 /12 格；改版后 880x360
// （69% 宽）/76px 格 /14 格（基础容量 12 + 置物架 2，未解锁格压暗画斜纹）。
export const BAG_LAYOUT = {
  /** 标题栏高：与 uiKit 的 PANEL_HEADER_H 同值，背包不另起一套标题语言。 */
  headerH: 30,
  /** 标题栏下方的危险条纹带厚——HUD 概念图的签名条，hudSkin.drawHazardStripe 画。 */
  stripeH: 10,
  /** 条纹相对面板左右内缘的缩进。 */
  stripeInset: 4,
  /** 内容区（格子区与详情井共用一根顶线）距面板顶：标题栏 + 条纹 + 8px 气。 */
  contentTop: 30 + 10 + 8,
  /** 格子区左内边距。选区箭头落在 left+8，不压框筋。 */
  padX: 20,
  /** 详情井右内边距。 */
  padRight: 16,
  /** 详情三行锚点（相对详情井顶）：名称 / 元信息 / 正文。 */
  detailNameY: 12,
  detailMetaY: 62,
  detailBodyY: 104,
  /** 详情文字左内边距。 */
  detailPadX: 8,
  /** 页脚提示行的中心距面板底。 */
  footerDrop: 18,
  /** 四角铆钉距面板内缘的缩进（铆钉本体 2x2，hudSkin 的语言）。 */
  rivetInset: 8,
} as const;

// ── AG-81：统计面板与结算画面（StatsSystem 的渲染侧几何）──────────────────
// 两个消费者共用一套行几何：GameScene 暂停菜单里的「本局统计」面板，以及
// End / EndgameScene 的结算统计表（scenes/EndScene.ts 的 buildStatsTable）。
// 数值按 20px GameSans 的 25px 线盒定：行距 30 留 5px 呼吸，两列网格的列宽
// 由面板宽扣掉列间距均分——这里只放与面板宽无关的行几何与列间距，面板宽由
// 各场景按自己的画布定（结算画面 640 两列，统计面板 460 单列）。
export const STATS_PANEL = {
  /** 统计行距（label/value 同一基线，20px caption 的 25px 线盒 + 5px）。 */
  rowPitch: 30,
  /** 两列网格的列间距。 */
  colGap: 24,
  /** 破纪录行的「新纪录」章宽（标签列右侧的占位，防止与数值列重叠）。 */
  recordTagW: 72,
  /** 纪录对比区与统计区之间的分隔带上半厚。 */
  sectionGap: 18,
} as const;
