import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MAX_UTTERANCE } from '../ai/rulesExecutor';
import { TYPE } from '../render/uiKit';
import { portraitViewportFor } from '../core/design';
import { computeDialogueLayout } from './dialogueLayout';

// 对话框面板布局。为什么这些断言必须存在：
//
// 面板高度是「按内容推导」的，正确性挂在三个外部量上——正文字号、台词字数
// 上限、可用宽度。任一项被人调整，公式都必须跟着自适应；一旦有人把其中一项
// 抄死，长台词就会重新压到选项行上，而这类 bug 在 happy path 里看不见
// （短句永远放得下），只在演示时模型说了一句长话才炸。
//
// 关键的一条是「选项区永远在消息井下方」。这条不等式成立 = 结构上不可能重叠，
// 比事后量像素更可靠：它不依赖字体度量、不依赖浏览器、不 flake。

// 面板宽度不是随手挑的数字，是游戏真正会算出来的那个值：
// 竖屏先由 portraitViewportFor 裁出可见画布宽，再由 panelWidthFor 减 24。
// 这两步都在 src/core/design.ts 和 GameScene 里，是纯函数，可以直接引。
const DESKTOP_VIEWPORT = [1280, 800] as const;
const PORTRAIT_VIEWPORT = [390, 844] as const;
/** 360x900 这类窄安卓机：可见画布只剩 288，才是真正踩到 7 行的地方 */
const NARROW_VIEWPORT = [360, 900] as const;

/** 复刻 GameScene.panelWidthFor：桌面直接用 460，竖屏收窄到画布宽 − 24。 */
function panelWidthFor(viewport: readonly [number, number], desktopWidth = 460): number {
  const [w, h] = viewport;
  if (w >= h) return desktopWidth;
  return Math.min(desktopWidth, portraitViewportFor(w, h).width - 24);
}

const DESKTOP_PANEL_W = panelWidthFor(DESKTOP_VIEWPORT);
const PORTRAIT_PANEL_W = panelWidthFor(PORTRAIT_VIEWPORT);
const NARROW_PANEL_W = panelWidthFor(NARROW_VIEWPORT);

function layoutFor(panelWidth: number, rawMax = MAX_UTTERANCE) {
  return computeDialogueLayout({ panelWidth, bodyFontSize: TYPE.body, rawMax });
}

describe('对话框布局：面板按台词推导，选项区永远在消息井下方', () => {
  it('RAW_MAX 绑定的是 MAX_UTTERANCE 本身，不是抄来的 60', () => {
    // GameScene 必须 import 那个常量。`// mirrors MAX_UTTERANCE` 这种注释
    // 不是绑定：两份数字会在某次调参后悄悄分叉，面板不够高，长句压选项。
    const src = readFileSync(new URL('./GameScene.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/import\s*\{[^}]*MAX_UTTERANCE[^}]*\}\s*from\s*'\.\.\/ai\/rulesExecutor'/);
    expect(src).toMatch(/rawMax:\s*MAX_UTTERANCE/);
    // 反面：不允许再把数字赋给一个自命名的常量。盯的是代码形态而不是注释
    // 措辞——注释里写「不许 mirrors」本身会让这条断言误伤自己。
    expect(src).not.toMatch(/(?:const|let)\s+\w*(?:RAW_MAX|MAX_LEN|UTTERANCE_MAX)\w*\s*=\s*\d+/);
  });

  it('前提条件：对话框正文必须开着 useAdvancedWrap，否则上面的字/行除法全部失效', () => {
    // 这个函数算的是「若会折行，一行放几个汉字」。Phaser 默认的 basicWordWrap
    // 是 `text.split(' ')` 逐词累加，中文整句算一个词，而「词比整行宽」那条
    // 分支（Text.js 里 `if (j > 0)`）在首词时不触发 → 一个字都不折。
    //
    // 撤掉这个开关，`floor(416/24)=17` 就变成「假设折 17 字、实际不折」：
    // 面板按 4 行算高，正文却单行 900+px 横向冲出面板。这条断言把它钉成
    // 前提条件，而不是可配参数——「不折行」不是一种合法运行状态，是 bug。
    const src = readFileSync(new URL('./GameScene.ts', import.meta.url), 'utf8');
    const start = src.indexOf('private buildDialoguePanel(');
    expect(start, '找不到 buildDialoguePanel，方法被改名或删除').toBeGreaterThan(-1);
    // 截到下一个方法定义为止：区域要够大能覆盖整段 wordWrap 配置，又不能
    // 大到把别处的 useAdvancedWrap 也算进来（那样撤掉正文的那个也测不出来）。
    const nextMethod = src.indexOf('\n  private ', start + 10);
    const body = nextMethod > start ? src.slice(start, nextMethod) : src.slice(start);
    // 精确到「正文这一处」：同一段里 dialogueMessage 的 text() 调用带上了它。
    const msgBlock = body.match(/this\.dialogueMessage\s*=\s*this\.add[\s\S]*?setDepth\(/);
    expect(msgBlock, '找不到 dialogueMessage 的创建块').not.toBeNull();
    expect(msgBlock![0]).toMatch(/useAdvancedWrap:\s*true/);
    expect(msgBlock![0]).toMatch(/wordWrap:\s*\{[^}]*width:\s*wrapW/);
  });

  it('结构不重叠：选项区顶部严格大于消息井底部（桌面 / 竖屏 / 窄屏都成立）', () => {
    for (const panelWidth of [DESKTOP_PANEL_W, PORTRAIT_PANEL_W, NARROW_PANEL_W]) {
      const layout = layoutFor(panelWidth);
      // 这是整套布局的地基。等于号也不行：贴边同样是压住。
      expect(layout.optionsTop).toBeGreaterThan(layout.wellBottom);
      // 消息井底边必须能在面板内：超出意味着正文冲出面板下沿。
      expect(layout.wellBottom).toBeLessThan(layout.panelHeight);
    }
  });

  it('台词上限翻倍到 120 字，不重叠这条依然成立（证明是自适应不是碰巧）', () => {
    // 这条是核心反证：如果有人把 MAX_UTTERANCE 放宽到 120 却没让面板跟着长，
    // 面板高度会停在 60 字的水位，选项行就会被 120 字的正文压住。
    for (const panelWidth of [DESKTOP_PANEL_W, PORTRAIT_PANEL_W, NARROW_PANEL_W]) {
      const atSixty = layoutFor(panelWidth, MAX_UTTERANCE);
      const atOneTwenty = layoutFor(panelWidth, 120);

      expect(atOneTwenty.optionsTop).toBeGreaterThan(atOneTwenty.wellBottom);
      // 而且必须真的更高：行数没变多说明公式根本没把 rawMax 用起来。
      expect(atOneTwenty.panelHeight).toBeGreaterThan(atSixty.panelHeight);
      expect(atOneTwenty.messageLines).toBeGreaterThan(atSixty.messageLines);
    }
  });

  it('7 行那条路径真的存在，而且不被硬上限截断（在 360x900 这类窄屏上）', () => {
    // 这一条修的是一个真实的错：我最初把「竖屏面板宽」写成 265，但 265 是
    // **390x844 的折行宽**（265 = 309 − 44），不是面板宽。按正确的 309 面板
    // 算出来是 11 字/行 → 6 行，根本碰不到旧实现那个 `MAX_LINES = 6`。
    //
    // 7 行真的出现在 360x900 这类窄屏上：可见画布只剩 288，面板 264，
    // 折行 220 → 9 字/行 → ceil(60/9) = 7 行。旧实现把它截成 6 行，
    // 第 7 行的 25px 就压在第一个选项上。
    const narrow = layoutFor(NARROW_PANEL_W);
    expect(NARROW_PANEL_W).toBe(264);
    expect(narrow.hanPerLine).toBe(9);
    expect(narrow.messageLines).toBe(7);
    // 旧公式会给出 6 行 183px 的井；现在 7 行是 183px 井、选项起点 223。
    expect(narrow.wellHeight).toBe(7 * 25 + 8);

    // 390x844 是 6 行——它从来就没踩到这个 bug，把它当成复现视口是错的。
    const portrait = layoutFor(PORTRAIT_PANEL_W);
    expect(PORTRAIT_PANEL_W).toBe(309);
    expect(portrait.hanPerLine).toBe(11);
    expect(portrait.messageLines).toBe(6);

    // 桌面是 17 字/行 → 4 行。这个数字没变，说明修竖屏没有把桌面改坏。
    const desktop = layoutFor(DESKTOP_PANEL_W);
    expect(desktop.hanPerLine).toBe(17);
    expect(desktop.messageLines).toBe(4);
  });

  it('正文字号变大时行数上升、面板跟着长高（字号是这个公式的输入，不是常量）', () => {
    const normal = layoutFor(DESKTOP_PANEL_W);
    const bigger = computeDialogueLayout({
      panelWidth: DESKTOP_PANEL_W,
      bodyFontSize: TYPE.body + 4,
      rawMax: MAX_UTTERANCE,
    });

    expect(bigger.hanPerLine).toBeLessThan(normal.hanPerLine);
    expect(bigger.messageLines).toBeGreaterThan(normal.messageLines);
    expect(bigger.panelHeight).toBeGreaterThan(normal.panelHeight);
    // 字号变大之后仍然不重叠——否则「放大字号」这个无障碍改动会有视觉代价。
    expect(bigger.optionsTop).toBeGreaterThan(bigger.wellBottom);
  });

  it('极端窄面板不会除出 Infinity：每行至少 1 字', () => {
    // 字号比可用宽度还大时，Math.floor 会得到 0，ceil(x/0) = Infinity 会让
    // 面板高度变成 Infinity，整个对话框消失。这条守的是那个退化输入。
    const tiny = computeDialogueLayout({ panelWidth: 20, bodyFontSize: TYPE.body, rawMax: MAX_UTTERANCE });
    expect(tiny.hanPerLine).toBe(1);
    expect(Number.isFinite(tiny.messageLines)).toBe(true);
    expect(Number.isFinite(tiny.panelHeight)).toBe(true);
  });
});