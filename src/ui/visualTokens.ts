// 视觉令牌（design tokens）—— 唯一一份「UI 可以照着改」的数值表。
//
// 这个文件的价值不在于它定义了颜色，而在于它把当前散落在各处的数值
// **集中到一处并加上了实测依据**。目的是让下一个人改 UI 时不必再读
// GameScene.ts 里 2400 行。
//
// 与既有模块的关系（不是替代，是索引 + 新增三档）：
//   src/render/palette.ts   —— 十六色调色板与色阶（WORLD + 文字色），视觉的基础
//   src/render/uiKit.ts     —— UI_UNIT / TYPE / UI / FONT_FAMILY，实际被绘制读的
//   src/render/hudLayout.ts —— HUD 的坐标车道
//   src/render/panels.ts    —— 面板填充/描边/切片尺寸
//
// 这里**不重复定义** palette/uiKit 已导出的值，只做两件事：
//   1. 复述「有实测依据的规则」，让规范可被引用；
//   2. 补上目前缺失的三类令牌：间距刻度（space）、字号阶梯的语义别名
//      （text）、以及 z 轴顺序（depth）。这三样现在全是散落的魔法数字。
//
// 任何一项新增都要有理由；不要为了让表格好看而加值。

import { PALETTE, TEXT, ROLE, STAT_COLOR } from '../render/palette.ts';
import { TYPE, UI_UNIT } from '../render/uiKit.ts';

// ── 1. 配色 ────────────────────────────────────────────────────────────────
/**
 * 16 色主调色板。冷色为环境（楼体），只有 LIGHT 一族是暖色。
 * 「屏幕上任何一像素暖色 = 有东西被点亮」，这是整个美术方向的前提。
 * 不要新增第 17 色：需要层次就用 mix()。
 */
export const COLOR = {
  /** 纯黑底 / 描边 / 虚空 */
  ink: PALETTE.ink,
  /** 阴影、面板底色 */
  shadow: PALETTE.shadow,
  /** 墙体基色 */
  stone: PALETTE.stone,
  /** 受光墙面、线 */
  stoneLight: PALETTE.stoneLight,
  /** 灰尘、被禁用的次要文字 */
  dust: PALETTE.dust,

  clothDeep: PALETTE.clothDeep,
  /** 安全青的基色：玩家外套、正向反馈 */
  cloth: PALETTE.cloth,
  clothLight: PALETTE.clothLight,
  /** 安全青高光：选中、可交互、盟友 */
  clothHigh: PALETTE.clothHigh,

  skinDeep: PALETTE.skinDeep,
  skin: PALETTE.skin,
  skinLight: PALETTE.skinLight,

  lightDeep: PALETTE.lightDeep,
  /** 灯光橙：标题、金币、目标 */
  light: PALETTE.light,
  /** 项目既有的灯橙，最高频的暖色 */
  lightHigh: PALETTE.lightHigh,
  /** 唯一接近白的颜色：灯火核心 */
  lightHot: PALETTE.lightHot,
} as const;

/** 语义角色。调用点只该问「我要 danger 还是 accent」，不该写 hex。 */
export const ROLE_COLOR = {
  void: ROLE.void,
  surface: ROLE.surface,
  surfaceRaised: ROLE.surfaceRaised,
  line: ROLE.line,
  text: ROLE.text,
  textDim: ROLE.textDim,
  accent: ROLE.accent,
  good: ROLE.good,
  danger: ROLE.danger,
} as const;

/** 文字色阶，括号内是相对面板底色的实测对比度（见 palette.ts 注释）。 */
export const TEXT_COLOR = {
  /** #ece8d8  15.6–16.3:1  AAA */
  primary: TEXT.primary,
  /** #a8a49a  7.7–8.1:1    AAA */
  secondary: TEXT.secondary,
  /** #8a867c  5.3–5.5:1    AA */
  dim: TEXT.dim,
  /** #82796b  4.6:1        AA —— 锁定项的下限，不许再暗 */
  disabled: TEXT.disabled,
  /** #6e685c  3.4:1        只用于「已经明确被解释过」的次要行 */
  disabledDeep: TEXT.disabledDeep,
  /** #a8e0c8  选中行 */
  highlight: TEXT.highlight,
  /** #e8907c  警告文字 */
  warn: TEXT.warn,
} as const;

/** 四条生存属性的专属色。看颜色就知道哪条在掉。 */
export const STAT = STAT_COLOR;

// ── 2. 字体与字号阶梯 ─────────────────────────────────────────────────────
/**
 * 字号阶梯。**只允许这几档**，不允许出现 13/14/17/18/22/26 这类中间值。
 *
 * 实测约束：设计画布 1280x720，窗口 1280x800 时按 1:1 显示，所以
 * fontSize 的 px 就等于屏幕像素。中文（汉字）在 20px 以下开始丢笔画，
 * 16px 已经只能靠上下文猜；20px 是这个字体（Ark Pixel 10px 像素字）
 * 能稳定读出汉字的最小号。
 *
 * 现状问题：GameScene.ts 内有 63 处 fontSize，实际用到了
 * 12/13/14/18/20/22/24/26/30/32/36/46/52 —— 共 13 档，其中 22 出现 9 次，
 * 是全项目最高频的「非阶梯值」。这是界面不成体系的直接来源。
 */
export const TEXT_SIZE = {
  /** 26 —— 对话正文、按钮大字（= body + 2） */
  lg: 26,
  /** 24 —— 正文、物品详情 */
  body: TYPE.body,
  /** 22 —— 世界层标签（家具名、NPC 名、容器名）。实测：与 24 无区别，建议降级到 20 */
  worldLabel: 22,
  /** 20 —— 说明、HUD 次要行、最小合法中文 */
  caption: TYPE.caption,
  /** 30 —— 面板标题 */
  title: TYPE.title,
} as const;

/**
 * 像素字族栈。latin 与 zh_hans 分成两个 @font-face，靠 fallback 链解析缺字。
 * 改字体只改 index.html 的 @font-face 和这里的常量，不要在各调用点写字体名。
 */
export const FONT = {
  family: "'ArkPixel Latin', 'ArkPixel ZH', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif",
  /** 必须在第一个 Text 创建前加载完，否则 Phaser 量错宽度 */
  faces: ['ArkPixel Latin', 'ArkPixel ZH'] as const,
} as const;

// ── 3. 间距刻度 ───────────────────────────────────────────────────────────
/**
 * 4 的倍数。所有 padding / gap / 行距都必须是这里某一档。
 *
 * 现状：面板的内边距实际用了 8/10/12/14/16 五种；对话框选项行距是 30
 * （不是 4 的倍数）；背包格子 40 + 间隙 5（5 不是 4 的倍数，导致 4 列格宽
 * 无法与面板内容宽度对齐）。
 */
export const SPACE = {
  /** 4 —— 行内微间距 */
  xs: UI_UNIT,
  /** 8 —— 元素内边距 */
  sm: UI_UNIT * 2,
  /** 12 —— 面板内边距（推荐值） */
  md: UI_UNIT * 3,
  /** 16 —— 区块间距 */
  lg: UI_UNIT * 4,
  /** 24 —— 面板标题条高度 */
  xl: UI_UNIT * 6,
  /** 32 —— 面板之间的呼吸 */
  xxl: UI_UNIT * 8,
} as const;

// ── 4. 组件尺寸 ───────────────────────────────────────────────────────────
export const SIZE = {
  /** 设计分辨率。窗口按此做 FIT；竖屏按 ENVELOP 取中间竖条 */
  designWidth: 1280,
  designHeight: 720,

  /** 面板标题条高度（buildPanelHeader 里的 h = 24） */
  panelHeader: 24,
  /** 面板边框切片（panels.ts PANEL_SLICE = 28） */
  panelSlice: 28,
  /** 面板描边宽度：1px，不用圆角（像素风） */
  panelStroke: 1,

  /** HUD 仪器板：宽 148、高 48、水平 pitch 188 */
  hudStatWidth: 148,
  hudStatPitch: 188,
  hudStatHeight: 48,
  /** HUD 顶带高 64，上下文带底 124 */
  hudTop: 64,
  hudContextBottom: 124,
  /** 底栏高 40 */
  hudFoot: 40,

  /** 背包格子：桌面 40，竖屏 32；图标原生 16px，按 2x 整数倍放大 */
  invCellDesktop: 40,
  invCellPortrait: 32,
  invIconNative: 16,
  invIconScale: 2,

  /** 交互提示 / 按钮的最小点击高度（触屏） */
  touchButton: 42,
  /** 触屏按钮之间的水平间隙（现状 50-44=6，偏小；建议 8） */
  touchButtonGap: 8,
} as const;

// ── 5. 层级（z 轴） ───────────────────────────────────────────────────────
/**
 * 深度顺序。**这是当前最容易出错的一块**：面板的 frame 与 fill 被故意放在
 * 内容**下方** 50/60 层（PANEL_FRAME_OFFSET / PANEL_FILL_OFFSET），因为
 * Phaser 4 的 NineSlice 合成顺序问题，面板只能由普通 Image 拼出来。
 *
 * 加任何新 UI 元素前先回答：它属于哪一档？
 */
export const DEPTH = {
  /** 世界层：地面、家具、NPC、玩家 0–30 */
  world: 0,
  worldActor: 30,
  /** 夜幕遮罩 23（必须低于灯，灯是世界层最后画的） */
  night: 23,
  /** 低血渐晕 90 */
  vignette: 90,
  /** HUD 底色/边框 100–101 */
  hudChrome: 100,
  /** HUD 文字与数值 103 */
  hudText: 103,
  /** 面板内容起点（inventory 200 / craft 210 / dialogue 220 / pause 230） */
  panelContent: 200,
  /** 面板的 frame 与 fill 在内容下方 50/60 层 */
  panelFrameOffset: -50,
  panelFillOffset: -60,
  /** 反馈提示、背包已满警告 300 —— 必须高于所有面板 */
  hudFeedback: 300,
} as const;

// ── 6. 已知的「不该存在」的数值（审查留痕） ──────────────────────────────
/**
 * 下面这些值**不推荐使用**，列出来是为了让后来者知道它们为什么存在、
 * 以及替换成什么。删掉它们之前先确认没有测试依赖。
 */
export const DEPRECATED = {
  /** 对话框选项行距 30（非 4 倍数）→ 改为 32 */
  dialogueRowPitch: 30,
  /** 背包格子间隙 5（非 4 倍数）→ 改为 4 或 8 */
  invCellGap: 5,
  /** 世界标签字号 22（与 20/24 难以区分）→ 统一到 20 */
  worldLabelSize: 22,
} as const;