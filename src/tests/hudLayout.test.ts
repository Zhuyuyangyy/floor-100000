import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HUD_LAYOUT, hudClockLabel } from '../render/hudLayout';

// 反馈行的底板契约只能读源：GameScene 的模块图里有 Phaser，Node 下不实例化
// 场景（与 combatHud.test.ts 的源码断言同款）。
const SCENE_SRC = readFileSync(join(process.cwd(), 'src/scenes/GameScene.ts'), 'utf8');

describe('HUD presentation boundaries', () => {
  it('keeps minute display on the existing floor rule at minute boundaries', () => {
    expect(hudClockLabel(1, 360.99)).toBe('D1 06:00');
    expect(hudClockLabel(1, 361)).toBe('D1 06:01');
    expect(hudClockLabel(12, 1439.99)).toBe('D12 23:59');
  });

  it('reserves separate lanes for persistent context and transient messages', () => {
    expect(HUD_LAYOUT.environmentY - HUD_LAYOUT.goalY).toBeGreaterThanOrEqual(28);
    expect(HUD_LAYOUT.contextBottom).toBeLessThan(HUD_LAYOUT.feedbackY);
    expect(HUD_LAYOUT.feedbackY + 64).toBeLessThanOrEqual(HUD_LAYOUT.bagY);
    expect(HUD_LAYOUT.bagY + 52).toBeLessThan(680);
    // The stat block ends before the money group begins, not before an
    // arbitrary 1000px: the 2026-11-14 skin widened the stats to 172px.
    expect(HUD_LAYOUT.statX + 3 * HUD_LAYOUT.statPitch + HUD_LAYOUT.statWidth).toBeLessThan(HUD_LAYOUT.moneyX);
  });

  it('常驻操作提示条落在顶带板下沿与反馈行之间的天花板带', () => {
    const c = HUD_LAYOUT.controlHintY;
    // 紧接顶带板（contextBottom=102）下方，不压顶带自己。
    expect(c).toBeGreaterThan(HUD_LAYOUT.contextBottom);
    expect(c - HUD_LAYOUT.contextBottom).toBeLessThanOrEqual(12);
    // 与 FPS 同行（fpsY=108，右端、默认隐藏）但提示靠左——垂直同带无妨，
    // 关键是与反馈行（556）隔开整段世界画面，不挡角色（脚线屏幕 y≈360）。
    expect(c).toBeLessThan(HUD_LAYOUT.feedbackY - 200);
  });

  // 2026-11-23 界面巡检：hud-feedback 的 backgroundColor 无条件挂着，
  // flash 1.6s 后 setText('') 只清字不清底 —— 左下 (20,556) 常驻一块
  // 16×40 的纯黑方块（Phaser 只要 backgroundColor 非空就画底，空字也画）。
  // 契约：底板与文字同生共死，三个写入点（出生/有字/清空）都要撤底。
  it('反馈行底板与文字同生共死：空字不留黑底', () => {
    // 出生即空 → 立刻撤底
    expect(SCENE_SRC).toContain("this.feedbackText.setBackgroundColor('');");
    // flash 有字才上底，无字撤底
    expect(SCENE_SRC).toContain('this.feedbackText.setBackgroundColor(msg ? FEEDBACK_BG : \'\');');
    // 定时清空那条也要撤底（不能只 setText('')）
    const clearBlock = SCENE_SRC.slice(SCENE_SRC.indexOf('this.feedbackTimer = this.time.delayedCall(1600'));
    expect(clearBlock).toContain("this.feedbackText.setText('');");
    expect(clearBlock.slice(0, 220)).toContain("this.feedbackText.setBackgroundColor('');");
    // 底色只有一处定义，不再是散落的字面量
    expect(SCENE_SRC).toContain("const FEEDBACK_BG = '#0b0f12ee';");
    expect(SCENE_SRC).toContain('backgroundColor: FEEDBACK_BG');
  });
});
