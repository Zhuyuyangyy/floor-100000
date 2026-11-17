// QA-01（P1）回归契约：暂停菜单「本局统计」面板必须每次打开都按当前
// state.stats 重建，而不是 create() 时刻的一次性快照。
//
// 为什么不放 e2e：运行期行为（真实游玩后开面板数值非零）已由无头探针实测，
// 证据在 tmp/qa-evidence/fix-qa01/（仓库外）。本文件守的是**回归契约**——
// 哪次重构把「打开时刷新」删回「只切可见性」，这里先红。
// 立场与 restartSafe.test.ts 一致：GameScene import Phaser，Node 下跑不了
// 场景，接线用源码级断言。
//
// 修法记录（2026-11-18，fix/2026-11-18-qa01-stats-snapshot）：openStatsPanel
// 打开时调 refreshStatsTable——销毁旧表格行件、按 runStatRows(getGame())
// 重建（EndgameScene.buildMode 切模式同款销毁重建）。选重建而非 setText：
// 行数由 STAT_KEYS + 3 决定，按索引刷新的两处记忆一旦上游改行数就静默错位。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sceneSrc = readFileSync('src/scenes/GameScene.ts', 'utf8');

/** 取一个私有方法的方法体（到下一个同级右花括号为止）。 */
function methodBody(name: string): string {
  const m = sceneSrc.match(new RegExp(`private ${name}\\(\\): void \\{([\\s\\S]*?)\\n  \\}`));
  if (!m) throw new Error(`GameScene 找不到 private ${name}()`);
  return m[1];
}

describe('QA-01：本局统计面板打开时刷新（不是 create() 快照）', () => {
  it('openStatsPanel 打开时先刷新表格再显形', () => {
    const body = methodBody('openStatsPanel');
    expect(body).toContain('this.refreshStatsTable();');
    // 刷新必须发生在 setVisible 之前——反过来等于先闪一帧旧快照。
    expect(body.indexOf('this.refreshStatsTable();')).toBeLessThan(body.indexOf('setVisible(true)'));
  });

  it('refreshStatsTable 按当前 state 重建，且先毁后建', () => {
    const body = methodBody('refreshStatsTable');
    // 数据源是当次 state 的纯函数快照——与 EndScene/EndgameScene 同一口径。
    expect(body).toContain('buildStatsTable(');
    expect(body).toContain('runStatRows(getGame())');
    // 先销毁旧行件再重建：不开第二次就双份表格。
    expect(body).toContain('.destroy();');
    // 新行件可见性跟随 statsOpen：面板关着时的刷新不得把内容浮上屏
    // （refreshInventory 的同款约定）。
    expect(body).toContain('o.setVisible(this.statsOpen)');
  });

  it('buildStatsPanel 只建面板框，表格委托 refreshStatsTable', () => {
    const body = methodBody('buildStatsPanel');
    expect(body).toContain('this.refreshStatsTable();');
    // 内联 buildStatsTable 就是旧快照 bug 的形态——create() 时建一次，
    // 游玩中累积统计永远停在开局零值。
    expect(body).not.toContain('buildStatsTable(');
  });

  it('场景重启重置表格对象池（restart-safe，同 statsObjects 惯例）', () => {
    expect(sceneSrc).toContain('this.statsTableObjects = [];');
  });
});
