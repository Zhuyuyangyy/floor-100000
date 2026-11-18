// QA-01（P1）回归契约：暂停菜单「本局统计」面板必须每次打开都按当前
// state.stats 重建，而不是 create()/build() 时刻的一次性快照。
//
// 为什么不放 e2e：运行期行为（真实游玩后开面板数值非零）已由无头探针实测，
// 证据在 tmp/qa-evidence/fix-qa01/ 与 tmp/qa-evidence/split-step1/（仓库外）。
// 本文件守的是**回归契约**——哪次重构把「打开时刷新」删回「只切可见性」，
// 这里先红。
// 立场与 restartSafe.test.ts 一致：GameScene / StatsPanelController 都 import
// Phaser（值导入经 EndScene 链），Node 下跑不了场景，接线用源码级断言。
//
// 修法记录（2026-11-18，fix/2026-11-18-qa01-stats-snapshot）：openStatsPanel
// 打开时调 refreshStatsTable——销毁旧表格行件、按 runStatRows(getGame())
// 重建（EndgameScene.buildMode 切模式同款销毁重建）。选重建而非 setText：
// 行数由 STAT_KEYS + 3 决定，按索引刷新的两处记忆一旦上游改行数就静默错位。
//
// RC-03 拆分第 1 步（2026-11-18，split-step1）：面板本体迁入
// src/scenes/controllers/StatsPanelController.ts，GameScene 只留
// openStatsPanel/closeStatsPanel 两行委托。契约断言随之改盯新形态——
// **这正是源码契约测试的设计用途**：被守护的不再是「哪个文件里有哪些私有
// 方法」而是「打开路径必经按 state 重建」这条不变量；委托层断开（比如谁把
// openStatsPanel 改回自己内联一张 create() 快照）照样在这里红。
// 迁移零行为变更的证据（tsc/vitest/冻结截图像素 diff/无头冒烟）见提交正文。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sceneSrc = readFileSync('src/scenes/GameScene.ts', 'utf8');
const ctrlSrc = readFileSync('src/scenes/controllers/StatsPanelController.ts', 'utf8');

/** 取一个方法的方法体（到下一个同级右花括号为止）。 */
function methodBody(src: string, name: string): string {
  const m = src.match(new RegExp(`(?:private |public )?${name}\\(\\): void \\{([\\s\\S]*?)\\n  \\}`));
  if (!m) throw new Error(`找不到 ${name}()`);
  return m[1];
}

describe('QA-01：本局统计面板打开时刷新（不是首建快照）', () => {
  it('GameScene.openStatsPanel 是一行委托（刷新与显形全在控制器）', () => {
    const body = methodBody(sceneSrc, 'openStatsPanel');
    expect(body).toContain('this.statsPanel.open();');
  });

  it('控制器 open() 打开时先刷新表格再显形', () => {
    const body = methodBody(ctrlSrc, 'open');
    expect(body).toContain('this.refresh();');
    // 刷新必须发生在 setVisible 之前——反过来等于先闪一帧旧快照。
    expect(body.indexOf('this.refresh();')).toBeLessThan(body.indexOf('setVisible(true)'));
  });

  it('控制器 refresh() 按当前 state 重建，且先毁后建', () => {
    const body = methodBody(ctrlSrc, 'refresh');
    // 数据源是当次 state 的纯函数快照——与 EndScene/EndgameScene 同一口径
    // （buildStatsTable 由构造注入，签名零改动，三场景共用同一件）。
    expect(body).toContain('this.buildTable(');
    expect(body).toContain('runStatRows(getGame())');
    // 先销毁旧行件再重建：不开第二次就双份表格。
    expect(body).toContain('.destroy();');
    // 新行件可见性跟随 opened：面板关着时的刷新不得把内容浮上屏
    // （refreshInventory 的同款约定）。
    expect(body).toContain('o.setVisible(this.opened)');
  });

  it('控制器 build() 只建面板框，表格委托 refresh()', () => {
    const body = methodBody(ctrlSrc, 'build');
    expect(body).toContain('this.refresh();');
    // 内联 buildTable 就是旧快照 bug 的形态——build() 时建一次，
    // 游玩中累积统计永远停在开局零值。
    expect(body).not.toContain('this.buildTable(');
  });

  it('场景重启重置表格对象池（restart-safe，create 调 statsPanel.reset）', () => {
    expect(sceneSrc).toContain('this.statsPanel.reset();');
  });
});
