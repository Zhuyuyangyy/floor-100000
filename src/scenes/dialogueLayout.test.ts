import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MAX_UTTERANCE } from '../ai/rulesExecutor';
import { TYPE } from '../render/uiKit';
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

/** 桌面与竖屏两种视口下的面板宽度（portrait 由 panelWidthFor 收窄得到） */
const DESKTOP_PANEL_W = 460;
const PORTRAIT_PANEL_W = 265;

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

  it('结构不重叠：选项区顶部严格大于消息井底部（桌面 / 竖屏都成立）', () => {
    for (const panelWidth of [DESKTOP_PANEL_W, PORTRAIT_PANEL_W]) {
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
    for (const panelWidth of [DESKTOP_PANEL_W, PORTRAIT_PANEL_W]) {
      const atSixty = layoutFor(panelWidth, MAX_UTTERANCE);
      const atOneTwenty = layoutFor(panelWidth, 120);

      expect(atOneTwenty.optionsTop).toBeGreaterThan(atOneTwenty.wellBottom);
      // 而且必须真的更高：行数没变多说明公式根本没把 rawMax 用起来。
      expect(atOneTwenty.panelHeight).toBeGreaterThan(atSixty.panelHeight);
      expect(atOneTwenty.messageLines).toBeGreaterThan(atSixty.messageLines);
    }
  });

  it('竖屏按 7 行算，不是被硬上限截到 6 行', () => {
    // 这是一个真实算错的点，不是我编的边界：265 宽面板 → 221 折行宽 →
    // 9 字/行 → ceil(60/9) = 7 行。旧实现有 `MAX_LINES = 6`，把第 7 行截掉，
    // 于是 60 字台词在竖屏下多出 25px 探到选项行上。
    const portrait = layoutFor(PORTRAIT_PANEL_W);
    expect(portrait.hanPerLine).toBe(9);
    expect(portrait.messageLines).toBe(7);

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