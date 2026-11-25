// 对话框面板的尺寸推导。
//
// 为什么把它从 GameScene 里拆出来：这套公式的正确性依赖四个外部量（字号、
// 台词字数上限、可用宽度、是否开了 advancedWrap），其中任一项被调整，面板
// 高度就必须跟着变。留在场景类里就只能靠 E2E 量像素，而 E2E 跑不起「台词
// 上限放宽一倍」这种输入。抽成纯函数后，「放宽上限后面板仍然装得下」可以在
// node 里直接断言。
//
// 刻意不 import `src/render/uiKit` 的 TYPE：那个模块 import 了 Phaser，引进来
// 整个函数就没法在 node 测试里跑，等于白拆。字号从参数传。
//
// ── 隐含依赖：hanPerLine 的除法只有在开了 useAdvancedWrap 时才成立 ──────────
//
// 下面 `floor(wrapWidth / bodyFontSize)` 算的是「一行能放下几个汉字……如果
// 会折行的话」。而 Phaser 默认的 basicWordWrap 是 `text.split(' ')` 逐词累加，
// 中文没有空格，整句被当成一个词；「词比整行宽」那条分支（Text.js 里
// `if (j > 0)`）在首词时恰好不触发，于是**一个字都不折**。
//
// 也就是说：`useAdvancedWrap: true` 一撤，这个公式就变成「假设会折 17 字、
// 实际一行都不折」，面板按 4 行算高、正文却单行横向冲出面板。调用点
// `GameScene.buildDialoguePanel:3391` 之所以敢这么算，就是因为那一行的
// wordWrap 配置里写着 `useAdvancedWrap: true`。**两处必须一起改**：
// 撤掉那个开关，这个文件的所有行数结论同时失效。
//
// 这里的每个数字都对应原实现里的一行，抽出来时逐项对过（括号里是视口）：
//   desktop  460 面板 → 416 折行 → 17 字/行 → 4 行 → 面板 308   （1280x800）
//   portrait 309 面板 → 265 折行 → 11 字/行 → 6 行 → 面板 358   （390x844）
//   narrow   264 面板 → 220 折行 →  9 字/行 → 7 行 → 面板 383   （360x900）
//
// 最后一行才是本文件存在的第二个理由：旧实现有 `MAX_LINES = 6` 硬上限，只有
// 窄到 9 字/行时 `ceil(60/9) = 7` 才会被它截断，剩下那 25px 压在第一个选项上。
// 桌面 4 行、390x844 的 6 行都碰不到上限——所以这个 bug 既不在桌面，也不在
// 最常见的 iPhone 尺寸上，只在 360x900 这类窄安卓机上。当初我把「折行宽 265」
// 当成了「面板宽 265」，于是以为 390x844 就是踩坑视口，这个错觉一直留到真机
// probe 才被打破（见 dialogueLayout.test.ts 里那条 7 行用例）。
//
// 去掉上限之后行数完全由 rawMax 与折行宽度推导：上限没变时结果不变，
// 变窄或放宽上限时面板才会跟着长高。

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
 * 旧实现写死 `panelH = 260`，正文用 `setOrigin(0.5)` 居中锚在井中心：一行短句
 * 和四行长句都向上下两侧同时生长，四行时下沿探到选项行上（实测 21px 压选项、
 * 33px 出井）。
 *
 * 这个函数**没有**改锚点——正文到今天仍然是 `setOrigin(0.5)`（见
 * `GameScene.buildDialoguePanel`）。起作用的是另一件事：井的高度现在按行数
 * 算准了（`messageLines × 25 + 8`），正文居中在井里就正好装得下，不再溢出。
 * 换句话说，「按内容推导」替代了「改锚点」，不是两者都做。以前我在这里写过
 * 「改成顶部锚定」，那是错的，已按代码实际状态改正。
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