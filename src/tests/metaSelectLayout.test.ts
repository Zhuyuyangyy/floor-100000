import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../core/design';
import { PANEL_SLICE } from '../render/panels';
import { PANEL_HEADER_H, TYPE, fontLineBox } from '../render/uiKit';
import {
  META_BLURB_FONT,
  META_BLURB_MAX_H,
  META_BLURB_TOP,
  META_BLURB_W,
  META_BTN_H,
  META_BTN_TOP,
  META_BTN_W,
  META_COL_X,
  META_FLAVOUR_FONT,
  META_FLAVOUR_MAX_H,
  META_FLAVOUR_TOP,
  META_FLAVOUR_W,
  META_FLAVOUR_X,
  META_MSG_FONT,
  META_MSG_TOP,
  META_NAME_FONT,
  META_NOTE_DY,
  META_NOTE_FONT,
  META_PANEL_H,
  META_PANEL_W,
  META_PORTRAIT_CY,
  META_PORTRAIT_X,
  META_RELIC_FONT,
  META_RELIC_PITCH,
  META_RELIC_ROWS,
  META_ROSTER_ROWS,
  META_ROSTER_TOP,
  META_ROSTER_W,
  META_ROSTER_X,
  META_ROW_H,
  META_ROW_PITCH,
  META_TITLE_DY,
  META_TITLE_FONT,
  META_WELL_H,
  META_WELL_TOP,
  META_WELL_X,
  metaRelicY,
  metaRowY,
} from '../render/metaSelectLayout';
import { MODE_BLURBS } from '../systems/modes';
import { CHARACTER_NAMES, CHARACTER_UNLOCKS } from '../systems/metaProgress';
import { RELICS } from '../systems/relics';

// 2026-11-23 界面巡检：选人屏量到四处真实重叠（详见 metaSelectLayout.ts 头注）。
// 这一屏原本全是就地魔数，且都按旧像素字体的 ~1.0em 线盒量；GameSans 是 1.25em，
// 没人重算。这里把每条泳道对着 fontLineBox() 钉住，跟 uiLayout2.test.ts 同一套
// 办法：不引 Phaser、不截图，纯算式 + 源码断言。

const SCENE_SRC = readFileSync(join(process.cwd(), 'src/scenes/MetaSelectScene.ts'), 'utf8');

/** 面板在设计画布里的左上角。 */
const LEFT = (DESIGN_WIDTH - META_PANEL_W) / 2;
const TOP = (DESIGN_HEIGHT - META_PANEL_H) / 2;

describe('选人面板：名单泳道', () => {
  it('注释偏移 = 名字的整个线盒，两行不交叠', () => {
    expect(META_NAME_FONT).toBe(TYPE.body);
    expect(META_NOTE_FONT).toBe(TYPE.caption);
    expect(META_NOTE_DY).toBe(fontLineBox(TYPE.body)); // 30
    expect(fontLineBox(TYPE.caption)).toBe(25);
    // 名字占 [0,30)，注释占 [30,55) —— 旧值 +28 让注释压进名字 2px。
    expect(META_NOTE_DY).toBeGreaterThanOrEqual(fontLineBox(META_NAME_FONT));
    expect(META_ROW_H).toBe(fontLineBox(META_NAME_FONT) + fontLineBox(META_NOTE_FONT));
  });

  it('行距 ≥ 行高，行与行之间不交叠', () => {
    // 旧 pitch 52 < 行高 55：相邻两行本身就压着。
    expect(META_ROW_PITCH).toBeGreaterThanOrEqual(META_ROW_H);
    for (let i = 1; i < META_ROSTER_ROWS; i++) {
      expect(metaRowY(i)).toBeGreaterThanOrEqual(metaRowY(i - 1) + META_ROW_H);
    }
  });

  it('五行名单连注释全部落在井内', () => {
    const wellTop = META_WELL_TOP;
    const wellBottom = META_WELL_TOP + META_WELL_H;
    expect(metaRowY(0)).toBeGreaterThanOrEqual(wellTop);
    const lastBottom = metaRowY(META_ROSTER_ROWS - 1) + META_ROW_H;
    expect(lastBottom).toBeLessThanOrEqual(wellBottom);
    // 井里还留了内边距，不是刚好卡边。
    expect(wellBottom - lastBottom).toBeGreaterThanOrEqual(4);
  });

  it('井与名单都在 header 条之下、底部装饰条之上', () => {
    expect(META_WELL_TOP).toBeGreaterThanOrEqual(PANEL_HEADER_H);
    expect(META_WELL_TOP + META_WELL_H).toBeLessThanOrEqual(META_PANEL_H - PANEL_SLICE);
  });

  it('名单文字不越出井的右沿', () => {
    // 最长的注释「最深第 N 层解锁」实测 141px（20px GameSans）。
    const NOTE_W = 141;
    expect(META_ROSTER_X + 8 + NOTE_W).toBeLessThanOrEqual(META_WELL_X + META_ROSTER_W);
    // 名字最长 72px（三字）。
    expect(META_ROSTER_X + 8 + 72).toBeLessThanOrEqual(META_WELL_X + META_ROSTER_W);
  });

  it('简介既不压左侧装饰条、也不压 roster 井沿', () => {
    // 简介有自己的中心 META_FLAVOUR_X（不再跟半身像共用 62）：像是画，压边框
    // 读作贴在面板上的照片；字压边框就是被纹理吃掉（2026-11-23 巡检实证 x=368
    // 落在 left=360 起 28px 宽的金属边框上）。
    const flavourLeft = META_FLAVOUR_X - META_FLAVOUR_W / 2;
    const flavourRight = META_FLAVOUR_X + META_FLAVOUR_W / 2;
    expect(flavourLeft).toBeGreaterThanOrEqual(PANEL_SLICE);
    expect(flavourRight).toBeLessThan(META_WELL_X);
    expect(SCENE_SRC).toContain('.text(left + META_FLAVOUR_X, top + META_FLAVOUR_TOP');
  });

  it('简介最坏高度按实测预留 —— 148 宽下 player 是 4 行', () => {
    // Playwright 实测（18px GameSans + useAdvancedWrap + width 148）：
    // player 4 行 88px、阿林/小周/流浪者 3 行 66px、尚未相遇 1 行 22px。
    // 84 宽的旧方案是 6 行 132px 且断点碎（「从底层醒/来的那个/人。」），
    // 所以左列拓宽而不是把字挤窄。
    expect(META_FLAVOUR_MAX_H).toBeGreaterThanOrEqual(4 * fontLineBox(META_FLAVOUR_FONT));
    // 带子必须装得下一个典型分句，否则又回到硬切。
    expect(META_FLAVOUR_W).toBeGreaterThanOrEqual(144); // 「宿舍区的老邻居。」144px
  });

  it('ROSTER 与解锁表就是版面假设的 5 行', () => {
    expect(Object.keys(CHARACTER_UNLOCKS)).toHaveLength(META_ROSTER_ROWS);
    expect(Object.keys(CHARACTER_NAMES)).toHaveLength(META_ROSTER_ROWS);
  });
});

describe('选人面板：右列泳道', () => {
  it('简介必须开 useAdvancedWrap —— 中文无空格，基础断行器断不开', () => {
    // 这是四处缺陷里最严重的一处：整句渲染成一行，实测右界 1031 vs 面板 875。
    expect(SCENE_SRC).toContain('wordWrap: { width: META_BLURB_W, useAdvancedWrap: true }');
    // 旧写法不许回来。
    expect(SCENE_SRC).not.toContain('wordWrap: { width: 150 }');
    // 左列简介同样依赖它。
    expect(SCENE_SRC).toContain('wordWrap: { width: META_FLAVOUR_W, useAdvancedWrap: true }');
  });

  it('三种模式的简介换行后都不超过预留高度', () => {
    // 实测（Playwright，18px GameSans + useAdvancedWrap + width 180）：
    // quick 3 行 66px、adventure 2 行 44px、easy 4 行 88px。
    const MEASURED_LINES = { quick: 3, adventure: 2, easy: 5 } as const;
    // easy 的实测是 5 行（110px）—— 预留高度必须按最坏值给，否则切到 easy
    // 时简介会压住遗物首行。
    const worst = Math.max(...Object.values(MEASURED_LINES));
    expect(META_BLURB_MAX_H).toBeGreaterThanOrEqual(worst * fontLineBox(META_BLURB_FONT));
    for (const key of Object.keys(MEASURED_LINES) as Array<keyof typeof MEASURED_LINES>) {
      expect(MODE_BLURBS[key]).toBeTruthy();
    }
  });

  it('简介起点在模式标题之下，整块不压标题', () => {
    expect(META_BLURB_TOP).toBeGreaterThanOrEqual(META_ROSTER_TOP + fontLineBox(TYPE.body));
  });

  it('遗物首行让开简介的最坏高度', () => {
    expect(metaRelicY(0)).toBeGreaterThanOrEqual(META_BLURB_TOP + META_BLURB_MAX_H);
  });

  it('遗物行距 ≥ 线盒，五行不互相压', () => {
    expect(META_RELIC_PITCH).toBeGreaterThanOrEqual(fontLineBox(META_RELIC_FONT));
    expect(RELICS).toHaveLength(META_RELIC_ROWS);
  });

  it('出发按钮在遗物末行之下 —— 不再压「◇ 第 5 层」', () => {
    const lastRelicBottom = metaRelicY(META_RELIC_ROWS - 1) + fontLineBox(META_RELIC_FONT);
    expect(META_BTN_TOP).toBeGreaterThanOrEqual(lastRelicBottom);
    // 按钮自己也要装得下 18px 的字（线盒 22）。
    expect(META_BTN_H).toBeGreaterThanOrEqual(fontLineBox(18));
  });

  it('右列所有元素都在面板内，不越过右侧装饰条', () => {
    const rightLimit = META_PANEL_W - PANEL_SLICE;
    expect(META_COL_X + META_BLURB_W).toBeLessThanOrEqual(rightLimit);
    expect(META_COL_X + META_BTN_W).toBeLessThanOrEqual(rightLimit);
    // 遗物文字最长「◆ 守护图腾」≈ 5 汉字 + 符号，18px 下约 108px。
    expect(META_COL_X + 108).toBeLessThanOrEqual(rightLimit);
  });

  it('右列不与名单井横向重叠', () => {
    expect(META_COL_X).toBeGreaterThanOrEqual(META_WELL_X + META_ROSTER_W);
  });
});

describe('选人面板：整体与标题', () => {
  it('提示行独占泳道，在按钮之下、装饰条之上', () => {
    expect(META_MSG_TOP).toBeGreaterThanOrEqual(META_BTN_TOP + META_BTN_H);
    expect(META_MSG_TOP + fontLineBox(META_MSG_FONT)).toBeLessThanOrEqual(META_PANEL_H - PANEL_SLICE);
    // 最长提示「「流浪者」还未相遇 —— 最深第 5 层解锁」实测 363px（20px）。
    expect(363).toBeLessThanOrEqual(META_PANEL_W - PANEL_SLICE * 2);
    expect(SCENE_SRC).toContain('.text(cx, top + META_MSG_TOP');
  });

  it('标题整个线盒悬在面板上方，不印在 header 条上', () => {
    const half = fontLineBox(META_TITLE_FONT) / 2;
    expect(META_TITLE_DY + half).toBeLessThan(0);
  });

  it('面板装得进设计画布，且标题不出画布顶', () => {
    expect(META_PANEL_H).toBeLessThan(DESIGN_HEIGHT);
    expect(META_PANEL_W).toBeLessThan(DESIGN_WIDTH);
    expect(TOP).toBeGreaterThan(0);
    expect(TOP + META_PANEL_H).toBeLessThan(DESIGN_HEIGHT);
    expect(TOP + META_TITLE_DY - fontLineBox(META_TITLE_FONT) / 2).toBeGreaterThan(0);
  });

  it('左列半身像 + 简介整体在内容区内', () => {
    const bustTop = META_PORTRAIT_CY - 48;
    expect(bustTop).toBeGreaterThanOrEqual(PANEL_HEADER_H);
    expect(META_FLAVOUR_TOP).toBeGreaterThanOrEqual(META_PORTRAIT_CY + 48);
    expect(META_FLAVOUR_TOP + META_FLAVOUR_MAX_H).toBeLessThanOrEqual(META_PANEL_H - PANEL_SLICE);
    expect(META_FLAVOUR_FONT).toBe(18);
  });

  it('半身像不越出面板左侧装饰条', () => {
    expect(META_PORTRAIT_X - 48).toBeGreaterThanOrEqual(PANEL_SLICE / 2);
    expect(LEFT).toBeGreaterThan(0);
  });

  it('场景不再就地写死这些泳道', () => {
    // 旧魔数一个都不许回来。
    for (const dead of ['top + 34 + i * 52', 'y + 28', 'top + 258', 'top + 140 + i * 28', 'top - 18', 'listW, 220']) {
      expect(SCENE_SRC).not.toContain(dead);
    }
    expect(SCENE_SRC).toContain('const y = top + metaRowY(i);');
    expect(SCENE_SRC).toContain('top + metaRelicY(i)');
    expect(SCENE_SRC).toContain('top + META_BTN_TOP');
  });

  it('行数与版面常量不符时会响，而不是静默溢出', () => {
    expect(SCENE_SRC).toContain('ROSTER.length !== META_ROSTER_ROWS');
    expect(SCENE_SRC).toContain('relics.length !== META_RELIC_ROWS');
  });
});