import { describe, expect, it } from 'vitest';

import {
  BEHAVIOR_LABELS,
  MONSTER_FRAME,
  drawMonsterShadow,
  drawMonsterSilhouette,
  monsterBlocks,
  monsterFormFor,
  monsterFormHeight,
  monsterFormWidth,
  type MonsterBlock,
  type MonsterForm,
} from '../render/monsterArt';
import { PALETTE, PALETTE_LIST } from '../render/palette';
import { COMBAT_BAR, HUD_LAYOUT, NAV_BAR, combatBarX } from '../render/hudLayout';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../core/design';
import { MONSTERS, type MonsterBehavior } from '../systems/monsters';

// AG-70 —— 战斗舞台（去文本框化）的可测部分。
//
// 用户 2026-11-17 原话：「我不是说那个就是打击别人的时候展示战斗然后我们
// 打击吗，不要做那种文本框，我们点击攻击看不见人的操作了」。敌人从面板里的
// 一行字变成层右 75% 上一只程序化剪影：有形态、有头顶血条、挨打会闪。这里
// 钉的是纯数据/纯几何那一半——色块表不越框、色不出 16 色板、七种行为全部分
// 到形态、动作条的 y/x 边界不碰导航条与既有 HUD 车道。Phaser 装配那一半
// （tween/Container）由 e2e/ag70-combat-stage.spec.ts 截图取证。

const BEHAVIORS: readonly MonsterBehavior[] = ['normal', 'fast', 'slow', 'ranged', 'ambusher', 'coward', 'brute'];

const FORMS: readonly MonsterForm[] = [
  'normal',
  'ambusher',
  'brute',
  'fast',
  'ranged',
  'slow',
  'coward',
  'guardian',
];

describe('monsterFormFor：行为 → 形态', () => {
  it('七种行为各自映射，boss 显式走 guardian', () => {
    // 守门人行为是 normal 但 id 900——「最终闸」不能和拾荒者一个剪影。
    expect(monsterFormFor('normal')).toBe('normal');
    expect(monsterFormFor('normal', { isBoss: true })).toBe('guardian');
    expect(monsterFormFor('ambusher')).toBe('ambusher');
    expect(monsterFormFor('brute')).toBe('brute');
    expect(monsterFormFor('fast')).toBe('fast');
    expect(monsterFormFor('ranged')).toBe('ranged');
    expect(monsterFormFor('slow')).toBe('slow');
    expect(monsterFormFor('coward')).toBe('coward');
  });

  it('名册里每种行为都至少有一只怪，且都有标签', () => {
    for (const b of BEHAVIORS) {
      expect(MONSTERS.some((m) => m.behavior === b), `roster lost ${b}`).toBe(true);
      expect(BEHAVIOR_LABELS[b]).toBeTruthy();
    }
  });

  it('八种形态两两不同——「看见怪就知道怎么打」', () => {
    for (let i = 0; i < FORMS.length; i++) {
      for (let j = i + 1; j < FORMS.length; j++) {
        const a = monsterBlocks(FORMS[i]);
        const b = monsterBlocks(FORMS[j]);
        const same = a.length === b.length && a.every((blk, k) => blk.x === b[k].x && blk.y === b[k].y && blk.w === b[k].w && blk.h === b[k].h);
        expect(same, `${FORMS[i]} and ${FORMS[j]} share one silhouette`).toBe(false);
      }
    }
  });
});

describe('剪影色块表', () => {
  it('每块都在 64×96 画布内，且非空', () => {
    for (const form of FORMS) {
      for (const blk of monsterBlocks(form)) {
        expect(blk.w, `${form} block width`).toBeGreaterThan(0);
        expect(blk.h, `${form} block height`).toBeGreaterThan(0);
        expect(blk.x, `${form} block left`).toBeGreaterThanOrEqual(0);
        expect(blk.y, `${form} block top`).toBeGreaterThanOrEqual(0);
        expect(blk.x + blk.w, `${form} block right`).toBeLessThanOrEqual(MONSTER_FRAME.w);
        expect(blk.y + blk.h, `${form} block bottom`).toBeLessThanOrEqual(MONSTER_FRAME.h);
      }
    }
  });

  it('每块颜色都在 16 色板内', () => {
    for (const form of FORMS) {
      for (const blk of monsterBlocks(form)) {
        expect(PALETTE_LIST, `${form} colour ${blk.c.toString(16)} off-palette`).toContain(blk.c);
      }
    }
  });

  it('ambusher 低伏（头顶压到 40 以下）、brute 宽厚（肩宽 40+）、guardian 高大带盾', () => {
    // 剪影的读法就是打法的读法，这三条是用户「看得见怎么打」的底线。
    const topOf = (form: MonsterForm): number => Math.min(...monsterBlocks(form).map((b) => b.y));
    const widthOf = (form: MonsterForm): number => monsterFormWidth(form);
    expect(topOf('ambusher'), 'ambusher crouches low').toBeGreaterThanOrEqual(30);
    // 头顶比白板人形更低（y 更大）——「蹲人的」一眼可读。
    expect(topOf('ambusher')).toBeGreaterThan(topOf('normal'));
    expect(widthOf('brute'), 'brute is the widest brawler').toBeGreaterThanOrEqual(48);
    expect(widthOf('brute')).toBeGreaterThan(widthOf('normal'));
    const guardian = monsterBlocks('guardian');
    // 盾在左缘（敌人面朝左，盾挡在玩家方向）。
    expect(guardian.some((b) => b.x <= 3 && b.h >= 24), 'guardian carries a left shield').toBe(true);
    // 「高大带盾」的读法来自占宽（盾缘 + 宽肩重甲）而不是更高——剪影都踩满
    // 96 画布，区分度在横向体积。
    expect(monsterFormWidth('guardian')).toBeGreaterThan(monsterFormWidth('normal'));
    expect(monsterFormHeight('guardian')).toBe(monsterFormHeight('normal'));
  });

  it('高度/宽度查询取块表极值', () => {
    for (const form of FORMS) {
      const blocks = monsterBlocks(form);
      expect(monsterFormHeight(form)).toBe(Math.max(...blocks.map((b) => b.y + b.h)));
      expect(monsterFormWidth(form)).toBe(Math.max(...blocks.map((b) => b.x + b.w)));
      expect(monsterFormHeight(form)).toBeLessThanOrEqual(MONSTER_FRAME.h);
    }
  });
});

describe('纯几何绘制（Node 可测的假画布）', () => {
  interface Call {
    x: number;
    y: number;
    w: number;
    h: number;
  }

  function fakeCanvas(): { calls: Call[]; fillStyle: (c: number, a?: number) => void; fillRect: (x: number, y: number, w: number, h: number) => void } {
    const calls: Call[] = [];
    return {
      calls,
      fillStyle: () => undefined,
      fillRect: (x, y, w, h) => calls.push({ x, y, w, h }),
    };
  }

  it('剪影：一块一 fillRect，坐标原样', () => {
    const blocks = monsterBlocks('brute');
    const canvas = fakeCanvas();
    drawMonsterSilhouette(canvas, blocks, 0xffffff);
    expect(canvas.calls).toHaveLength(blocks.length);
    expect(canvas.calls[0]).toEqual({ x: blocks[0].x, y: blocks[0].y, w: blocks[0].w, h: blocks[0].h });
  });

  it('暗底下沉层：同块数、同形、整体沉 2px', () => {
    const blocks = monsterBlocks('normal');
    const canvas = fakeCanvas();
    drawMonsterShadow(canvas, blocks);
    expect(canvas.calls).toHaveLength(blocks.length);
    for (let i = 0; i < blocks.length; i++) {
      expect(canvas.calls[i]).toEqual({ x: blocks[i].x, y: blocks[i].y + 2, w: blocks[i].w, h: blocks[i].h });
    }
  });

  it('剪影与暗底下沉不越框（沉 2px 后仍 ≤96）', () => {
    for (const form of FORMS) {
      const canvas = fakeCanvas();
      drawMonsterShadow(canvas, monsterBlocks(form));
      for (const c of canvas.calls) {
        expect(c.y + c.h).toBeLessThanOrEqual(MONSTER_FRAME.h + 2);
      }
    }
  });
});

// ── 动作条布局：y≤660 硬线、不碰导航条/既有 HUD 车道 ─────────────────────

describe('COMBAT_BAR 布局', () => {
  const barW = 3 * COMBAT_BAR.btnW + 2 * COMBAT_BAR.gap;
  const logBottom = COMBAT_BAR.logY + 2 * COMBAT_BAR.logPitch;

  it('动作条板底 ≤660（总控硬线），与导航条板顶留净空', () => {
    expect(COMBAT_BAR.y + COMBAT_BAR.btnH).toBeLessThanOrEqual(660);
    const navTop = DESIGN_HEIGHT - NAV_BAR.height;
    expect(COMBAT_BAR.y + COMBAT_BAR.btnH).toBeLessThan(navTop);
    expect(navTop - (COMBAT_BAR.y + COMBAT_BAR.btnH)).toBeGreaterThanOrEqual(12);
  });

  it('三个按钮等宽居中，左缘 combatBarX()', () => {
    const x = combatBarX();
    expect(x).toBe((DESIGN_WIDTH - barW) / 2);
    expect(x).toBeGreaterThan(0);
    expect(x + barW).toBeLessThan(DESIGN_WIDTH);
  });

  it('日志在左下，与动作条 x 错开；三行不压 bagY 警告', () => {
    expect(COMBAT_BAR.logX + COMBAT_BAR.logW).toBeLessThanOrEqual(combatBarX());
    expect(logBottom).toBeLessThan(HUD_LAYOUT.bagY);
  });

  it('日志行距容纳 caption 的线盒（20px → 25px 线盒，24 行距首尾相接）', () => {
    expect(COMBAT_BAR.logPitch).toBeGreaterThanOrEqual(24);
    expect(COMBAT_BAR.logPitch).toBeLessThanOrEqual(26);
  });

  it('回合标签在动作条上方、不与日志行同 x 区间', () => {
    expect(COMBAT_BAR.turnY).toBeLessThan(COMBAT_BAR.y);
    expect(COMBAT_BAR.turnY).toBeGreaterThanOrEqual(logBottom - COMBAT_BAR.logPitch);
  });
});

describe('palette 纪律', () => {
  it('十六色，且 ink/shadow/stone 三阶都在', () => {
    expect(PALETTE_LIST).toHaveLength(16);
    expect(PALETTE.ink).toBeLessThan(PALETTE.shadow);
    expect(PALETTE.shadow).toBeLessThan(PALETTE.stone);
  });

  it('MonsterBlock 的色号是 number 且非负', () => {
    for (const form of FORMS) {
      for (const blk of monsterBlocks(form) as readonly MonsterBlock[]) {
        expect(Number.isInteger(blk.c)).toBe(true);
        expect(blk.c).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
