import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';

import { RING_SEGMENTS, drawStatRing } from '../render/hudSkin';
import { HUD_LAYOUT } from '../render/hudLayout';
import { STAT_COLORS, TYPE, fontLineBox } from '../render/uiKit';

// AG-54：圆环仪表。概念图全库（HUD概念图目录 / F:/new 分件包 / git 全部分支）
// 都搜过，没有圆环 HUD——旧四联分段条是唯一存在过的样式，这里按同一语言重画
// 成 12 段圆环。本文件钉三件事：圆环的绘制契约（pip 数/起点/方向/clamping）、
// HUD_LAYOUT 的圆环几何在第 1 行里放得下、以及"不丢信息"——环组内容宽度、
// 数值井深、与 money 组的间距都按设计画布断言。

// ── 记录型假 Graphics ──────────────────────────────────────────────────────
// drawStatRing 只碰 Graphics 的这几个面：lineStyle/strokeCircle/beginPath/
// arc/strokePath。按序记录，供断言。
interface RingCall {
  kind: 'track' | 'pip';
  color: number;
  stroke: number;
  /** pip 的起止角（弧度）；track 为 null */
  from: number | null;
  to: number | null;
}

class FakeGraphics {
  calls: RingCall[] = [];
  private color = 0;
  private stroke = 1;

  lineStyle(width: number, color: number, _alpha?: number): this {
    this.stroke = width;
    this.color = color;
    return this;
  }
  strokeCircle(_x: number, _y: number, _r: number): this {
    this.calls.push({ kind: 'track', color: this.color, stroke: this.stroke, from: null, to: null });
    return this;
  }
  beginPath(): this {
    return this;
  }
  arc(_x: number, _y: number, _r: number, from: number, to: number): this {
    this.calls.push({ kind: 'pip', color: this.color, stroke: this.stroke, from, to });
    return this;
  }
  strokePath(): this {
    return this;
  }
}

/** Phaser 的类型只用于签名；运行时用的是上面的假对象。 */
const asGraphics = (g: FakeGraphics): Phaser.GameObjects.Graphics => g as unknown as Phaser.GameObjects.Graphics;

const pips = (g: FakeGraphics): RingCall[] => g.calls.filter((c) => c.kind === 'pip');
const tracks = (g: FakeGraphics): RingCall[] => g.calls.filter((c) => c.kind === 'track');

describe('drawStatRing', () => {
  it('draws one dark track and one pip per lit twelfth', () => {
    const g = new FakeGraphics();
    drawStatRing(asGraphics(g), 100, 25, 23, 0.5, 0xd8665f);
    expect(tracks(g)).toHaveLength(1);
    // 0.5 of twelve pips = 6.
    expect(pips(g)).toHaveLength(6);
  });

  it('lights pips from the top, clockwise, in slot order', () => {
    const g = new FakeGraphics();
    drawStatRing(asGraphics(g), 100, 25, 23, 3 / RING_SEGMENTS, 0xd8665f);
    const lit = pips(g);
    expect(lit).toHaveLength(3);
    const slot = (Math.PI * 2) / RING_SEGMENTS;
    // Pip 0 opens just past the top (-PI/2) and sweeps a slot minus the gap.
    expect(lit[0].from).toBeGreaterThan(-Math.PI / 2);
    expect(lit[0].to).toBeLessThan(-Math.PI / 2 + slot);
    // Each pip starts where the previous slot does — order is preserved.
    expect(lit[1].from).toBeGreaterThan(lit[0].from as number);
    expect(lit[2].from).toBeGreaterThan(lit[1].from as number);
    // ...and every pip sweeps forward (clockwise), never backwards.
    for (const pip of lit) expect((pip.to as number) - (pip.from as number)).toBeGreaterThan(0);
  });

  it('clamps the fraction: empty at zero, full at one, silent outside', () => {
    const zero = new FakeGraphics();
    drawStatRing(asGraphics(zero), 0, 0, 23, 0, 0xd8665f);
    expect(pips(zero)).toHaveLength(0);
    expect(tracks(zero)).toHaveLength(1);

    const full = new FakeGraphics();
    drawStatRing(asGraphics(full), 0, 0, 23, 1, 0xd8665f);
    expect(pips(full)).toHaveLength(RING_SEGMENTS);

    const over = new FakeGraphics();
    drawStatRing(asGraphics(over), 0, 0, 23, 1.7, 0xd8665f);
    expect(pips(over)).toHaveLength(RING_SEGMENTS);

    const under = new FakeGraphics();
    drawStatRing(asGraphics(under), 0, 0, 23, -0.4, 0xd8665f);
    expect(pips(under)).toHaveLength(0);
  });

  it('takes the pip colour, stroke and segment count from its arguments', () => {
    const g = new FakeGraphics();
    drawStatRing(asGraphics(g), 0, 0, 23, 1, 0xe56d63, { segments: 10, stroke: 7 });
    expect(pips(g)).toHaveLength(10);
    expect(tracks(g)[0].stroke).toBe(7);
    for (const pip of pips(g)) {
      expect(pip.color).toBe(0xe56d63);
      expect(pip.stroke).toBe(7);
    }
  });

  it('rounds to the nearest pip, the way the old bar rounded its segments', () => {
    // 0.58 of 12 = 6.96 -> 7 pips. A continuous fill would have said 58%.
    const g = new FakeGraphics();
    drawStatRing(asGraphics(g), 0, 0, 23, 0.58, 0xd8665f);
    expect(pips(g)).toHaveLength(7);
  });
});

describe('HUD ring geometry', () => {
  it('fits the ring inside row 1, clear of the plate hairlines', () => {
    // The ring's outer edge must not touch the plate's top hairline (y=0) nor
    // the row separator at topHeight — the same clearance the bar had.
    expect(HUD_LAYOUT.ringCY - HUD_LAYOUT.ringR).toBeGreaterThanOrEqual(2);
    expect(HUD_LAYOUT.ringCY + HUD_LAYOUT.ringR).toBeLessThanOrEqual(HUD_LAYOUT.topHeight - 2);
  });

  it('leaves a well deep enough for the three-digit value at caption size', () => {
    // The value Text sits centred in the ring: the well is the hole the stroke
    // leaves. GameSans digits are proportional, not full-width — AG-24's e2e
    // measured "金币 123456789012" at 178px for a 20px caption, i.e. ~11px per
    // digit, so "100" is ~33px and the 36px well holds it.
    const well = (HUD_LAYOUT.ringR - HUD_LAYOUT.ringStroke) * 2;
    expect(well).toBeGreaterThanOrEqual(3 * 11);
  });

  it('keeps each ring group inside its stat slot, label included', () => {
    // Group content: the ring (2R) + 8px gap + a 16px icon + 4px gap + the
    // two-character label at caption size. statWidth must hold all of it.
    const content = HUD_LAYOUT.ringR * 2 + 8 + 16 + 4 + 2 * TYPE.caption;
    expect(content).toBeLessThanOrEqual(HUD_LAYOUT.statWidth);
  });

  it('centres the label row on the ring for a caption line box', () => {
    // A 25px line box is odd, so the centre lands on a half pixel either way;
    // the label's ink sits within 1px of the ring's centre line.
    const labelCentre = HUD_LAYOUT.statLabelY + fontLineBox(TYPE.caption) / 2;
    expect(Math.abs(labelCentre - HUD_LAYOUT.ringCY)).toBeLessThanOrEqual(1);
  });

  it('ends the last ring group before the money divider', () => {
    const lastGroupX = HUD_LAYOUT.statX + 3 * HUD_LAYOUT.statPitch;
    const lastRingRight = lastGroupX + HUD_LAYOUT.ringR * 2;
    expect(lastRingRight).toBeLessThan(HUD_LAYOUT.moneyX - 16);
    // ...and the whole stat block, as hudLayout.test.ts pins it.
    expect(HUD_LAYOUT.statX + 3 * HUD_LAYOUT.statPitch + HUD_LAYOUT.statWidth).toBeLessThan(HUD_LAYOUT.moneyX);
  });

  it('gives every stat its own ring colour', () => {
    for (const key of ['hp', 'hunger', 'thirst', 'energy']) {
      expect(STAT_COLORS[key], key).toBeTypeOf('number');
    }
  });
});
