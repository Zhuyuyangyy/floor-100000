import { describe, expect, it } from 'vitest';

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../core/design';
import { NAV_BAR, navSlotX } from '../render/hudLayout';
import { HUD_LAYOUT } from '../render/hudLayout';
import { TYPE, fontLineBox } from '../render/uiKit';
import { estimateTextWidth } from '../render/dialogueLayout';

// AG-71：底部导航条的几何契约。全部数字都在 2026-11-17 用 canvas
// measureText（20px GameSans，与 Phaser Text 同一套度量）逐串实测过，这里用
// 算术把它们钉住——e2e/ag71-hud-nav.spec.ts 在三视口上用 getBounds 复核。

describe('AG-71 bottom navigation bar geometry', () => {
  it('tiles the canvas exactly: one contextual slot + five equal fixed slots', () => {
    expect(NAV_BAR.contextW + 5 * NAV_BAR.slotW).toBe(DESIGN_WIDTH);
    // 等分要除得尽，分隔线才落在整数像素上（hudSkin 的语言是硬边）。
    expect((DESIGN_WIDTH - NAV_BAR.contextW) % 5).toBe(0);
    for (let i = 1; i < 5; i++) {
      expect(navSlotX(i)).toBeGreaterThan(navSlotX(i - 1));
    }
    expect(navSlotX(4) + NAV_BAR.slotW).toBe(DESIGN_WIDTH);
  });

  it('sits on the canvas bottom edge, below the bag-full warning lane', () => {
    const top = DESIGN_HEIGHT - NAV_BAR.height;
    expect(top).toBe(672);
    // 背包警告：bagY 起、20px 文案线盒 + 6px padding，底约 655——板顶在它
    // 下面 17px（hudLayout.spec.ts 钉的 bagY+52<680 旧脚注车道不变）。
    const bagBottom = HUD_LAYOUT.bagY + fontLineBox(TYPE.caption) + 6;
    expect(bagBottom).toBeLessThan(top);
    // 角色居中在屏高 360 附近，世界可读区（一层楼高 200 世界像素 @zoom0.5
    // ≈ 屏上 280..380）与板不相交。
    expect(top).toBeGreaterThan(DESIGN_HEIGHT / 2 + 100);
  });

  it('holds the caption line box with air on both sides', () => {
    const box = fontLineBox(TYPE.caption); // 25
    expect(box).toBeLessThanOrEqual(NAV_BAR.height - 12);
    // 铆钉行（drawHudPlate 的 8 与 h-9）在板内且不压文本线盒。
    expect(8 + 2).toBeLessThan(NAV_BAR.height / 2 - box / 2);
    expect(NAV_BAR.height - 9).toBeGreaterThan(NAV_BAR.height / 2 + box / 2);
  });

  it('fits the longest contextual string measured at 20px GameSans', () => {
    // 制作面板提示实测 500px（tools/measure-hints.mjs，2026-11-17）。
    const longest = 500;
    expect(NAV_BAR.contextTextW).toBeGreaterThanOrEqual(longest);
    expect(NAV_BAR.contextW - NAV_BAR.contextPadX - 12).toBeGreaterThanOrEqual(longest);
    // 世界链拆掉「按 E 」后最长 243（上楼 · F 抄近路），加键帽也放得下。
    const longestWorld = 243 + NAV_BAR.keycapW + NAV_BAR.keycapGap;
    expect(longestWorld).toBeLessThan(NAV_BAR.contextW - NAV_BAR.contextPadX - 12);
  });

  it('fits the widest fixed slot group (icon + label)', () => {
    // 「菜单 Esc」是最宽的槽标签；estimateTextWidth 比实测略保守（空格算
    // 0.6em），正好当上界用。实测 76px。
    const label = estimateTextWidth('菜单 Esc', TYPE.caption);
    const group = label + NAV_BAR.iconSize + NAV_BAR.iconGap;
    expect(group).toBeLessThanOrEqual(NAV_BAR.slotW - 8);
  });
});
