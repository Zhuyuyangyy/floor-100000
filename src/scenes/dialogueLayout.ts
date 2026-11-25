// 对话框面板的尺寸推导。
//
// 为什么把它从 GameScene 里拆出来：这套公式的正确性依赖三个外部量（字号、
// 台词字数上限、可用宽度），其中任一项被调整，面板高度就必须跟着变。留在
// 场景类里就只能靠 E2E 量像素，而 E2E 跑不起「台词上限放宽一倍」这种输入。
// 抽成纯函数后，「放宽上限后面板仍然装得下」可以在 node 里直接断言。
//
// 刻意不 import `src/render/uiKit` 的 TYPE：那个模块 import 了 Phaser，引进来
// 整个函数就没法在 node 测试里跑，等于白拆。字号从参数传。
//
// 这里的每个数字都对应原实现里的一行，抽出来时逐项对过：desktop 460 宽 →
// 416 折行 → 17 字/行 → 4 行 → 面板 308；portrait 265 宽 → 11 字/行 → 6 行 →
// 面板 333。改动只是把「最多 6 行」这个写死的上限去掉，让行数完全由台词上限
// 推导——上限没变时两者结果相同，上限放宽时面板才会跟着长高。

export interface DialogueLayoutInput {
  /** 面板总宽（已含 portrait 收窄） */
  readonly panelWidth: number;
  /** 正文字号，用于算每行能放几个汉字 */
  readonly bodyFontSize: number;
  /** 台词硬上限字数。调用方传 MAX_UTTERANCE，不在这里抄一份 */
  readonly rawMax: number;
  /** 正文两侧内边距之和，默认 44（与现有视觉一致） */
  readonly contentInset?: number;
  /** 渲染行高，默认 25（24px 汉字的实测行高） */
  readonly lineHeight?: number;
}

export interface DialogueLayout {
  /** 正文可用折行宽度 */
  readonly wrapWidth: number;
  /** 每行可放几个汉字 */
  readonly hanPerLine: number;
  /** 按台词上限推导出的行数 */
  readonly messageLines: number;
  /** 消息井顶部（相对面板顶部） */
  readonly wellTop: number;
  /** 消息井高度 */
  readonly wellHeight: number;
  /** 消息井底边 = wellTop + wellHeight */
  readonly wellBottom: number;
  /** 第一个选项行的 y（相对面板顶部） */
  readonly optionsTop: number;
  readonly optionPitch: number;
  readonly footerHeight: number;
  readonly panelHeight: number;
}

const DEFAULT_CONTENT_INSET = 44;
const DEFAULT_LINE_HEIGHT = 25;
const WELL_TOP = 28;
/** 消息井内上下各留 4px，与 buildPanelWell 的视觉一致 */
const WELL_PAD = 8;
/** 消息井与第一个选项之间的呼吸间距 */
const OPTIONS_GAP = 12;
const OPTION_PITCH = 30;
const OPTION_COUNT = 4;
const FOOTER_HEIGHT = 40;

/**
 * 按「最长可能出现的台词」推导面板高度，而不是挑一个好看的数字。
 *
 * 旧实现写死 `panelH = 260`，配合正文 0.5/0.5 居中锚点：一行的短句和四行的
 * 长句会向上下两侧同时生长，四行就有 33px 探到选项行上。改成按内容推导 +
 * 顶部锚定之后，长句只往下长，而选项行在它下方。
 */
export function computeDialogueLayout(input: DialogueLayoutInput): DialogueLayout {
  const contentInset = input.contentInset ?? DEFAULT_CONTENT_INSET;
  const lineHeight = input.lineHeight ?? DEFAULT_LINE_HEIGHT;

  const wrapWidth = Math.max(1, input.panelWidth - contentInset);
  // 下限 1：字号被调到比可用宽度还大时不能除出 0，那会让行数变成 Infinity。
  const hanPerLine = Math.max(1, Math.floor(wrapWidth / input.bodyFontSize));
  const messageLines = Math.max(1, Math.ceil(input.rawMax / hanPerLine));

  const wellHeight = messageLines * lineHeight + WELL_PAD;
  const wellBottom = WELL_TOP + wellHeight;
  const optionsTop = wellBottom + OPTIONS_GAP;

  return {
    wrapWidth,
    hanPerLine,
    messageLines,
    wellTop: WELL_TOP,
    wellHeight,
    wellBottom,
    optionsTop,
    optionPitch: OPTION_PITCH,
    footerHeight: FOOTER_HEIGHT,
    panelHeight: optionsTop + OPTION_COUNT * OPTION_PITCH + FOOTER_HEIGHT,
  };
}