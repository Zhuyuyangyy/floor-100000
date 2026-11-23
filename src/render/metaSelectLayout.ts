import { PANEL_HEADER_H, TYPE, fontLineBox } from './uiKit';

// The character-pick panel's geometry, in one place.
//
// 2026-11-23 界面巡检：这一屏的每一条泳道都是就地写死的魔数，且都是按旧像素
// 字体（~1.0em 线盒）量的。换成 GameSans（1.25em）之后没人重算，Playwright
// getBounds 在 1280x720 上量到四处真实重叠：
//
//   1. 模式简介 `wordWrap: { width: 150 }` 没开 useAdvancedWrap。中文串没有
//      空格，Phaser 的基础断行器一个字都断不开 —— 实测「标准规则。自动存档，
//      死了就重来。」渲染成 x=743..1031 的一整行，而面板右边界是 875：
//      **冲出面板 156px**，直接印在背景图上。
//   2. 流浪者行（第 5 行）name y=452..482、note y=480..505，而 roster 井底
//      458、面板底 510、底部装饰条 482..510 —— 名字压在井沿外，注释整条印在
//      装饰条上。
//   3. 「出发」按钮 y=471..493 与遗物列末行「◇ 第 5 层」y=462..484 重叠 12px。
//   4. 标题「出发之前」y=168..216 与面板顶 210 重叠 6px，印在 header 条上。
//
// 修法不是把某个数字调大一点，而是让每条泳道的高度由**字体真实线盒**推出来，
// 并把这些算式导出，交给 metaSelectLayout.test.ts 逐条钉住。字号一律取 TYPE
// 的合法档位（caption 20 是可读性下限，不能为了塞进面板往下调），所以面板
// 该长高就长高：470x300 → 560x418。设计画布 1280x720 不动。
//
// 所有数值都是相对面板左上角 (left, top) 的偏移，4px 网格。

// 面板宽 META_PANEL_W 定义在右列之后 —— 它由右列末端反推，而右列又跟着
// roster 的起点走。声明顺序即依赖顺序，const 没有 hoisting。

/**
 * 面板标题（36px，线盒 45）中心相对 top 的偏移。-36 让线盒底停在 top-13.5，
 * 离面板顶 13.5px。旧值 -18 时线盒底越过面板顶 6px，印在 header 条上。
 */
export const META_TITLE_DY = -36;
/** 标题字号。线盒 45px，是这一屏最大的字。 */
export const META_TITLE_FONT = 36;

// ── 左列：半身像 + 简介 ────────────────────────────────────────────────────
/**
 * 半身像中心 x（相对 left）。96px 宽的像落在 14..110 —— 像本身压在左侧装饰条
 * （0..28）上是原设计的取舍：像是画，压边框读作「贴在面板上的照片」，不算破绽。
 * 文字不同，见 META_FLAVOUR_W。
 */
export const META_PORTRAIT_X = 62;
/**
 * 简介换行宽度。**文字不许压在装饰条上**：旧值 108 时简介以半身像中心 62 为轴
 * 居中，左边缘落在 8，而左侧金属边框占 0..28 —— 实测 x=368 印在边框上（面板
 * left=360），「从底层醒来的」几个字被边框纹理吃掉（2026-11-23 巡检截图）。
 *
 * 但把框收窄到 84 迁就旧井沿（122）会让断行变碎：实测「从底层醒 / 来的那个 /
 * 人。」6 行——这些串是按标点手工断过的，一个分句最宽 216px（阿林「交易时总能
 * 多聊出点门道。」），84px 一个字都断不对。所以反过来做：**把 roster 井右移**，
 * 给左列让出 148px 的带（32..180）：实测降到 player 4 行、其余 3 行，断点回到
 * 标点附近。井右移的代价由 META_PANEL_W 加宽承担，右列泳道一个数不动。
 */
export const META_FLAVOUR_W = 148;
/**
 * 简介中心 x = 106：148 宽的框落在 32..180，左离装饰条（28）4px、
 * 右离井沿（186）6px。与半身像中心分开是有意为之 —— 像可以压边框
 * （读作贴在面板上的照片），字不行。
 */
export const META_FLAVOUR_X = 106;
export const META_FLAVOUR_FONT = 18;
/**
 * 简介最坏高度，实测（18px + useAdvancedWrap + width 148）：player 4 行 = 88px
 * （「从底层醒来的那个人。」本身 180px，仍要断成两行），阿林/小周/流浪者
 * 3 行 = 66px，锁定「尚未相遇」1 行 22px。按最坏 4 行预留，切换角色时左列
 * 不会上下跳。
 */
export const META_FLAVOUR_MAX_H = 4 * fontLineBox(META_FLAVOUR_FONT);

// ── 中列：幸存者名单 ───────────────────────────────────────────────────────
/**
 * 名单起点。从 128 右移到 192：左列简介要 148px 的带才能按标点断行（见
 * META_FLAVOUR_W），井沿随之从 122 移到 186。代价由面板加宽承担。
 */
export const META_ROSTER_X = 192;
export const META_ROSTER_W = 200;
/** 井比名单左移 6px，让名字有 8px 内边距。 */
export const META_WELL_X = META_ROSTER_X - 6;
/** 井顶紧贴 header 条下沿（30），不能像旧值 28 那样探进条里 2px。 */
export const META_WELL_TOP = PANEL_HEADER_H;
export const META_ROSTER_ROWS = 5;
export const META_NAME_FONT = TYPE.body; // 24 → 30px 线盒
export const META_NOTE_FONT = TYPE.caption; // 20 → 25px 线盒
/** 注释相对行首的偏移 = 名字的整个线盒，两行首尾相接不交叠。 */
export const META_NOTE_DY = fontLineBox(META_NAME_FONT);
/** 一行的真实高度：名字线盒 + 注释线盒。 */
export const META_ROW_H = META_NOTE_DY + fontLineBox(META_NOTE_FONT);
/** 行距 = 行高 + 3px 呼吸。旧值 52 < 行高 55，行与行本身就压着。 */
export const META_ROW_PITCH = META_ROW_H + 3;
/** 名单第一行的行首，落在 header 条（30）下方 4px。 */
export const META_ROSTER_TOP = PANEL_HEADER_H + 4;

/** 井高按行数算，末行下方留 6px 内边距 —— 不是写死的 220。 */
export const META_WELL_H =
  META_ROSTER_TOP + (META_ROSTER_ROWS - 1) * META_ROW_PITCH + META_ROW_H + 6 - META_WELL_TOP;

// ── 右列：模式 + 遗物 + 出发 ───────────────────────────────────────────────
/** 右列起点 = 名单起点 + 名单宽 + 20 空气（跟着 roster 右移，相对间距不变）。 */
export const META_COL_X = META_ROSTER_X + META_ROSTER_W + 20;

/**
 * 简介换行宽度。**必须配 useAdvancedWrap**：这些串没有空格，基础断行器
 * 断不开中文，会把整句渲染成一行冲出面板（实测 1031 vs 面板右界 875）。
 */
export const META_BLURB_W = 180;

/**
 * 面板宽由右列反推：右列起点 + 简介换行框 + 右侧装饰条 28 + 8 内边距。
 * 右列随 roster 右移（左列简介要 148px 才能按标点断行），所以面板一并加宽。
 * 旧值 470 时右列文字直接印出面板；560 是 roster 还在 128 时的数。
 */
export const META_PANEL_W = META_COL_X + META_BLURB_W + 28 + 8;
export const META_BLURB_FONT = 18;
export const META_BLURB_TOP = 70;
/**
 * 简介最坏高度，实测而非估计（Playwright getBounds，18px GameSans +
 * useAdvancedWrap + width 180）：quick 3 行 66px、adventure 2 行 44px、
 * **easy 5 行 110px**。按最坏的 easy 预留，←/→ 切模式时遗物列才不会上下跳。
 * 5 行 × fontLineBox(18)=22 = 110。
 */
export const META_BLURB_MAX_H = 5 * fontLineBox(META_BLURB_FONT);
export const META_RELIC_FONT = 18;
export const META_RELIC_PITCH = 28;
export const META_RELIC_ROWS = 5;
/** 遗物列首行：简介最坏底 + 10px 空气。 */
export const META_RELIC_TOP = META_BLURB_TOP + META_BLURB_MAX_H + 10;

export const META_BTN_W = META_BLURB_W;
export const META_BTN_H = 32;
/** 出发按钮：遗物末行底 + 12px 空气。旧值 +258 正压在末行上。 */
export const META_BTN_TOP =
  META_RELIC_TOP + (META_RELIC_ROWS - 1) * META_RELIC_PITCH + fontLineBox(META_RELIC_FONT) + 12;

// ── 底部：提示行 ───────────────────────────────────────────────────────────
export const META_MSG_FONT = TYPE.caption;
/** 提示行（「还未相遇」）独占一条泳道，在出发按钮下方 6px。 */
export const META_MSG_TOP = META_BTN_TOP + META_BTN_H + 6;

/** 面板底部装饰条高度（panels.ts PANEL_SLICE），内容不许印上去。 */
const FRAME_BAND = 28;

/**
 * 面板高由内容反推：提示行底 + 装饰条 + 8px 余量。
 * 旧值 300 是按旧字体的估数，装不下 5 行两行式名单 + 4 行简介 + 5 行遗物。
 */
export const META_PANEL_H = META_MSG_TOP + fontLineBox(META_MSG_FONT) + FRAME_BAND + 8;

/** 内容区（header 条之下、底部装饰条之上）的可用高度。 */
const BODY_H = META_PANEL_H - FRAME_BAND - META_ROSTER_TOP;
/** 左列内容总高：半身像 96 + 12 间隙 + 简介最坏 88。 */
const LEFT_CONTENT_H = 96 + 12 + META_FLAVOUR_MAX_H;
/** 左列在内容区里垂直居中，避免面板长高后底部空一大块。 */
export const META_PORTRAIT_CY = META_ROSTER_TOP + Math.round((BODY_H - LEFT_CONTENT_H) / 2) + 48;
export const META_FLAVOUR_TOP = META_PORTRAIT_CY + 48 + 12;

/** 第 i 行（0-based）的行首 y，相对面板 top。 */
export function metaRowY(i: number): number {
  return META_ROSTER_TOP + i * META_ROW_PITCH;
}

/** 第 i 行遗物的 y，相对面板 top。 */
export function metaRelicY(i: number): number {
  return META_RELIC_TOP + i * META_RELIC_PITCH;
}