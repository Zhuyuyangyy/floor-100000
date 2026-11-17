import { describe, expect, it, vi } from 'vitest';

import balance from '../../config/game-balance.json' with { type: 'json' };
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../core/design';
import { BAG_LAYOUT } from '../render/hudLayout';
import { HUD_BAR_H, HUD_FOOT_H } from '../render/uiKit';
import { STORAGE_RACK_SLOTS } from '../systems/CraftingSystem';

// GameScene 只在运行期碰 Phaser（类声明 extends Phaser.Scene、方法体内的
// this.add.*），导入期一个都不碰——所以一个「可调用可构造」的桩就够把整张
// 模块图求值到导出表（labelsAndView.test.ts 的同款手法）。桩只在本文件内
// 生效，不碰共享 vitest.config。
vi.mock('phaser', () => {
  const anyThing = new Proxy(function () {}, {
    get: () => anyThing,
    apply: () => ({}),
    construct: () => ({}),
  });
  return { default: anyThing };
});

const { BAG_BALANCE } = await import('../scenes/GameScene');

// AG-60（背包面板放大改版）的单元层镜像。浏览器层的实测（getBounds 数字、
// 三视口截图）在 e2e/ag60-bag-panel.spec.ts——两边互为冗余，任一层漂移都会红。
//
// 这里钉的是布局算术与配置接线，不碰 Phaser：
//   1. 数值确实从 config/game-balance.json 的 bag 块读出来（不是 GameScene 里
//      拍死的常量）——改配置必须能改掉面板，这是「不要硬编码」的可执行断言；
//   2. 部件拼得进面板：5 列 x 3 行末行 4 格（14 = 5+5+4）、格子区与详情井都
//      在面板内边距里、详情井宽度为正；
//   3. 格子数盖得住游戏里可能出现的最深容量（基础 12 + 置物架 2 = 14）——否则
//      置物架做成后多出的格子没有 UI，容量计数会说得比格子多；
//   4. 面板在设计画布上居中且让开 HUD 板与底栏——三视口不出板的算术版本。

describe('AG-60 bag panel: the config wiring', () => {
  it('reads every number out of the balance file’s bag block', () => {
    const bag = (balance as unknown as { bag?: Record<string, number> }).bag;
    expect(bag).toBeDefined();
    expect(BAG_BALANCE.panelWidth).toBe(bag!.panelWidth);
    expect(BAG_BALANCE.panelHeight).toBe(bag!.panelHeight);
    expect(BAG_BALANCE.gridCols).toBe(bag!.gridCols);
    expect(BAG_BALANCE.gridSlots).toBe(bag!.gridSlots);
    expect(BAG_BALANCE.cellSize).toBe(bag!.cellSize);
    expect(BAG_BALANCE.cellGap).toBe(bag!.cellGap);
    expect(BAG_BALANCE.iconScale).toBe(bag!.iconScale);
    expect(BAG_BALANCE.detailGap).toBe(bag!.detailGap);
  });

  it('ships the enlarged geometry, not the 440x236 baseline', () => {
    // 改版前：440x236（设计宽 34%）/ 40px 格 / 12 格。用户原话「稍微做大一点」，
    // 落成 69% 宽与近三倍面积——这里把「已放大」钉死，回退到旧尺寸会红。
    expect(BAG_BALANCE.panelWidth).toBe(880);
    expect(BAG_BALANCE.panelHeight).toBe(360);
    expect(BAG_BALANCE.panelWidth * BAG_BALANCE.panelHeight).toBeGreaterThan(440 * 236 * 2.5);
    expect(BAG_BALANCE.cellSize).toBe(76);
    expect(BAG_BALANCE.gridSlots).toBe(14);
    // 图标是 16x16 像素画，倍率必须是整数——非整数缩放会把像素 Art 糊掉。
    expect(Number.isInteger(BAG_BALANCE.iconScale)).toBe(true);
    expect(BAG_BALANCE.iconScale).toBeGreaterThanOrEqual(2);
  });
});

describe('AG-60 bag panel: the layout arithmetic', () => {
  const { panelWidth, panelHeight, gridCols, gridSlots, cellSize, cellGap, detailGap } = BAG_BALANCE;
  const rows = Math.ceil(gridSlots / gridCols);
  const lastRowCells = gridSlots - (rows - 1) * gridCols;

  it('lays 14 slots out as 5+5+4 with the last row ragged', () => {
    expect(rows).toBe(3);
    expect(lastRowCells).toBe(4);
    // 末行不满，但格子区宽度按整行算——详情井的左边是一条干净的竖线。
    const gridW = gridCols * cellSize + (gridCols - 1) * cellGap;
    expect(gridW).toBe(5 * 76 + 4 * 8);
    const gridH = rows * cellSize + (rows - 1) * cellGap;
    expect(gridH).toBe(3 * 76 + 2 * 8);
  });

  it('keeps the grid and the detail pane inside the panel’s padding', () => {
    const gridX = BAG_LAYOUT.padX;
    const gridY = BAG_LAYOUT.contentTop;
    const gridRight = gridX + gridCols * cellSize + (gridCols - 1) * cellGap - cellGap;
    const detailX = gridRight + detailGap;
    const detailW = panelWidth - BAG_LAYOUT.padRight - detailX;
    // 格子区不压左边框，详情井不压右边框，两者都还有正宽度。
    expect(gridX).toBeGreaterThanOrEqual(8);
    expect(detailW).toBeGreaterThan(200);
    expect(detailX + detailW).toBe(panelWidth - BAG_LAYOUT.padRight);
    // 内容区顶 = 标题栏 + 条纹 + 8px 气；底 = 内容顶 + 网格高，要给页脚留位。
    expect(BAG_LAYOUT.contentTop).toBe(BAG_LAYOUT.headerH + BAG_LAYOUT.stripeH + 8);
    const contentBottom = gridY + rows * cellSize + (rows - 1) * cellGap;
    expect(contentBottom).toBeLessThan(panelHeight - BAG_LAYOUT.footerDrop);
  });

  it('stacks the three detail rows without their line boxes colliding', () => {
    // 30px 名的行盒 37，20px 元信息的行盒 25，24px 正文每行 30——锚点间距必须
    // 大于上一行的行盒，否则 GameSans 的高行盒会互相打印穿（AG-24 的教训）。
    const nameBox = Math.floor(30 * 1.25);
    const metaBox = Math.floor(20 * 1.25);
    expect(BAG_LAYOUT.detailMetaY - BAG_LAYOUT.detailNameY).toBeGreaterThan(nameBox);
    expect(BAG_LAYOUT.detailBodyY - BAG_LAYOUT.detailMetaY).toBeGreaterThan(metaBox);
  });

  it('fits the design canvas centred, clear of the HUD plate and the foot bar', () => {
    const left = (DESIGN_WIDTH - panelWidth) / 2;
    const top = (DESIGN_HEIGHT - panelHeight) / 2;
    expect(left).toBeGreaterThanOrEqual(100);
    expect(top).toBeGreaterThanOrEqual(HUD_BAR_H); // 不压 HUD 三行板
    expect(top + panelHeight).toBeLessThanOrEqual(DESIGN_HEIGHT - HUD_FOOT_H); // 不压底栏
    // 三视口契约的算术版：设计画布固定 1280x720，900x600 / 1920x1080 只是
    // letterbox 缩放，画布坐标一个都不动——面板因此永远居中不出板。
    expect(panelWidth).toBeLessThanOrEqual(DESIGN_WIDTH);
    expect(panelHeight).toBeLessThanOrEqual(DESIGN_HEIGHT);
  });
});

describe('AG-60 bag panel: the capacity contract', () => {
  it('has a cell for every slot the game can ever hold', () => {
    // 容量 = inventory.slotCount：基础 12（game-balance 的 inventory.slotCount）
    // + 置物架 STORAGE_RACK_SLOTS。格子数少于最深容量的话，置物架做成后多出的
    // 格子没有 UI，标题栏的 x/14 会说得比格子多——那是 AG-60 要修的不一致。
    const base = (balance as unknown as { inventory: { slotCount: number } }).inventory.slotCount;
    expect(BAG_BALANCE.gridSlots).toBeGreaterThanOrEqual(base + STORAGE_RACK_SLOTS);
    expect(BAG_BALANCE.gridSlots).toBe(base + STORAGE_RACK_SLOTS);
  });
});
