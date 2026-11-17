import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type Phaser from 'phaser';

import {
  createStatRingsBaker,
  drawStatRingGroup,
  statRingsBox,
  type StatRingGeometry,
} from '../render/hudSkin';
import { HUD_LAYOUT } from '../render/hudLayout';

// AG-102（性能轮 3）：四联圆环的预烘焙契约。钉四件事：
//   1. 贴图包围盒由 HUD_LAYOUT 的环几何推导，整数尺寸，顶缘与画布顶对齐
//      （环描边外缘在 y=-0.5，基线上由屏幕裁掉，贴图顶缘必须裁掉同一行）；
//   2. 组绘制 = 四个 drawStatRing，texture-local 坐标，≤20% 危险红不变；
//   3. 烘焙机制：离屏 Graphics 复用 + RenderTexture（'all' 模式让命令缓冲
//      在 RT 渲染时执行一次），clear+draw 的顺序与次数；
//   4. GameScene 接线： rings Graphics 已换成 RT，先毁后建，重烤在 key 守卫后。

// ── 记录型假 Graphics（hudRings.test.ts 同款面 + clear） ────────────────────
interface RingCall {
  kind: 'track' | 'pip';
  color: number;
  stroke: number;
  x: number;
  y: number;
  r: number;
  from: number | null;
  to: number | null;
}

class FakeGraphics {
  calls: RingCall[] = [];
  clears = 0;
  destroyed = false;
  private color = 0;
  private stroke = 1;

  lineStyle(width: number, color: number, _alpha?: number): this {
    this.stroke = width;
    this.color = color;
    return this;
  }
  strokeCircle(x: number, y: number, r: number): this {
    this.calls.push({ kind: 'track', color: this.color, stroke: this.stroke, x, y, r, from: null, to: null });
    return this;
  }
  beginPath(): this {
    return this;
  }
  arc(x: number, y: number, r: number, from: number, to: number): this {
    this.calls.push({ kind: 'pip', color: this.color, stroke: this.stroke, x, y, r, from, to });
    return this;
  }
  strokePath(): this {
    return this;
  }
  clear(): this {
    this.clears += 1;
    this.calls.length = 0;
    return this;
  }
  destroy(): this {
    this.destroyed = true;
    return this;
  }
}

const asGraphics = (g: FakeGraphics): Phaser.GameObjects.Graphics => g as unknown as Phaser.GameObjects.Graphics;

const pips = (g: FakeGraphics): RingCall[] => g.calls.filter((c) => c.kind === 'pip');
const tracks = (g: FakeGraphics): RingCall[] => g.calls.filter((c) => c.kind === 'track');

/** HUD_LAYOUT 的环几何键——正是 drawStatRingGroup 声明的结构面。 */
const GEOMETRY: StatRingGeometry = {
  statX: HUD_LAYOUT.statX,
  statPitch: HUD_LAYOUT.statPitch,
  ringCY: HUD_LAYOUT.ringCY,
  ringR: HUD_LAYOUT.ringR,
  ringStroke: HUD_LAYOUT.ringStroke,
};

describe('statRingsBox', () => {
  const box = statRingsBox(GEOMETRY);

  it('covers all four rings including the stroke, at integer size', () => {
    const outer = HUD_LAYOUT.ringR + HUD_LAYOUT.ringStroke / 2;
    const firstCX = HUD_LAYOUT.statX + HUD_LAYOUT.ringR;
    const lastCX = HUD_LAYOUT.statX + 3 * HUD_LAYOUT.statPitch + HUD_LAYOUT.ringR;
    // 每个环的着色外缘都在盒内（左缘/右缘不裁）。
    expect(firstCX - outer).toBeGreaterThanOrEqual(box.x);
    expect(lastCX + outer).toBeLessThanOrEqual(box.x + box.width);
    // 整数宽高：贴图尺寸不能是小数。
    expect(Number.isInteger(box.width)).toBe(true);
    expect(Number.isInteger(box.height)).toBe(true);
  });

  it('starts at the canvas top so the texture clips the same row the screen did', () => {
    // 环描边外缘在 ringCY - outer = -0.5：屏幕在 y=0 裁掉它，贴图顶缘必须同罪。
    expect(box.y).toBe(0);
    expect(HUD_LAYOUT.ringCY - (HUD_LAYOUT.ringR + HUD_LAYOUT.ringStroke / 2)).toBeLessThan(0);
  });

  it('matches the measured geometry of the 2026-11-14 skin', () => {
    // 289..917 × 0..51：第一环左缘 289.5、末环右缘 916.5、底缘 50.5。
    expect(box).toEqual({ x: 289, y: 0, width: 628, height: 51 });
  });

  it('tracks a layout move instead of freezing the old box', () => {
    const moved = statRingsBox({ ...GEOMETRY, statX: GEOMETRY.statX + 100 });
    expect(moved.x).toBe(box.x + 100);
    expect(moved.width).toBe(box.width);
  });
});

describe('drawStatRingGroup', () => {
  const box = statRingsBox(GEOMETRY);
  const colors = [0xe56d63, 0xf4b66a, 0x6aa8e5, 0x77c6a4];
  const danger = 0xd8665f;

  it('draws one track and one pip per lit twelfth for each of the four rings', () => {
    const g = new FakeGraphics();
    // 100/100/100/100 → 12+12+12+12；50% → 6 pips（0.5×12）；25% → 3。
    drawStatRingGroup(asGraphics(g), GEOMETRY, box, [100, 50, 0, 25], colors, danger);
    expect(tracks(g)).toHaveLength(4);
    expect(pips(g)).toHaveLength(12 + 6 + 0 + 3);
  });

  it('draws in texture-local coordinates, on the ring centres of the layout', () => {
    const g = new FakeGraphics();
    drawStatRingGroup(asGraphics(g), GEOMETRY, box, [100, 100, 100, 100], colors, danger);
    const centres = tracks(g).map((t) => `${t.x},${t.y}`);
    expect(centres).toEqual([
      `${HUD_LAYOUT.statX + HUD_LAYOUT.ringR - box.x},${HUD_LAYOUT.ringCY - box.y}`,
      `${HUD_LAYOUT.statX + HUD_LAYOUT.statPitch + HUD_LAYOUT.ringR - box.x},${HUD_LAYOUT.ringCY - box.y}`,
      `${HUD_LAYOUT.statX + 2 * HUD_LAYOUT.statPitch + HUD_LAYOUT.ringR - box.x},${HUD_LAYOUT.ringCY - box.y}`,
      `${HUD_LAYOUT.statX + 3 * HUD_LAYOUT.statPitch + HUD_LAYOUT.ringR - box.x},${HUD_LAYOUT.ringCY - box.y}`,
    ]);
    // 描边宽度沿用 ringStroke——track 与 pip 同规格。
    for (const t of tracks(g)) expect(t.stroke).toBe(HUD_LAYOUT.ringStroke);
    for (const p of pips(g)) expect(p.stroke).toBe(HUD_LAYOUT.ringStroke);
  });

  it('lights danger red at <=20%, its own colour above it', () => {
    const g = new FakeGraphics();
    // lit pips：15%→2，20%→2（等号归红），21%→3，100%→12。
    drawStatRingGroup(asGraphics(g), GEOMETRY, box, [15, 20, 21, 100], colors, danger);
    const lit = pips(g);
    expect(lit).toHaveLength(2 + 2 + 3 + 12);
    // 前 4 个 pip（15% 与 20% 两环）全是危险红，其余回归各自本色。
    expect(new Set(lit.slice(0, 4).map((p) => p.color))).toEqual(new Set([danger]));
    expect(new Set(lit.slice(4).map((p) => p.color))).toEqual(new Set([colors[2], colors[3]]));
  });

  it('keeps the drawn coordinates inside the box: nothing escapes the texture', () => {
    const g = new FakeGraphics();
    drawStatRingGroup(asGraphics(g), GEOMETRY, box, [100, 100, 100, 100], colors, danger);
    for (const c of g.calls) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThanOrEqual(box.width);
      expect(c.y).toBeLessThanOrEqual(box.height);
    }
  });
});

// ── 烘焙机制（fake scene：记录 make.graphics / add.renderTexture / clear+draw） ─
class FakeRenderTexture {
  name = '';
  depth = 0;
  scrollFactorSet = false;
  origin: [number, number] | null = null;
  renderMode = '';
  x = 0;
  y = 0;
  width = 0;
  height = 0;
  clears = 0;
  drawn: unknown[] = [];
  destroyed = false;

  setOrigin(x: number, y: number): this {
    this.origin = [x, y];
    return this;
  }
  setName(n: string): this {
    this.name = n;
    return this;
  }
  setScrollFactor(_v: number): this {
    this.scrollFactorSet = true;
    return this;
  }
  setDepth(d: number): this {
    this.depth = d;
    return this;
  }
  setRenderMode(mode: string): this {
    this.renderMode = mode;
    return this;
  }
  clear(): this {
    this.clears += 1;
    return this;
  }
  draw(entry: unknown): this {
    this.drawn.push(entry);
    return this;
  }
  destroy(): this {
    this.destroyed = true;
    return this;
  }
}

function fakeScene() {
  const gfx = new FakeGraphics();
  const rt = new FakeRenderTexture();
  let addToScene = true;
  const scene = {
    make: {
      graphics: (_config: unknown, add: boolean) => {
        addToScene = add;
        return gfx;
      },
    },
    add: {
      renderTexture: (x: number, y: number, width: number, height: number) => {
        rt.x = x;
        rt.y = y;
        rt.width = width;
        rt.height = height;
        return rt;
      },
    },
  };
  return { scene, gfx, rt, wasAddedToScene: () => addToScene };
}

describe('createStatRingsBaker', () => {
  it('places the RT where the old Graphics sat, named and tiered the same', () => {
    const { scene, rt } = fakeScene();
    const box = statRingsBox(GEOMETRY);
    createStatRingsBaker(scene as unknown as Phaser.Scene, GEOMETRY);
    expect([rt.x, rt.y]).toEqual([box.x, box.y]);
    expect([rt.width, rt.height]).toEqual([box.width, box.height]);
    expect(rt.origin).toEqual([0, 0]);
    expect(rt.name).toBe('hud-stat-rings');
    expect(rt.scrollFactorSet).toBe(true);
    expect(rt.depth).toBe(103);
  });

  it('runs the command buffer in "all" mode — default "render" would leave the rings invisible', () => {
    const { scene, rt } = fakeScene();
    createStatRingsBaker(scene as unknown as Phaser.Scene, GEOMETRY);
    expect(rt.renderMode).toBe('all');
  });

  it('draws through an off-screen Graphics, never on the display list', () => {
    const { scene, wasAddedToScene } = fakeScene();
    createStatRingsBaker(scene as unknown as Phaser.Scene, GEOMETRY);
    expect(wasAddedToScene()).toBe(false);
  });

  it('redraw queues clear-then-draw and re-triangulates only on change', () => {
    const { scene, gfx, rt } = fakeScene();
    const baker = createStatRingsBaker(scene as unknown as Phaser.Scene, GEOMETRY);
    const colors = [0xe56d63, 0xf4b66a, 0x6aa8e5, 0x77c6a4];
    baker.redraw([100, 50, 0, 25], colors, 0xd8665f);
    // 离屏源先清后画，RT 先清再把源整幅画进去。
    expect(gfx.clears).toBe(1);
    expect(pips(gfx)).toHaveLength(12 + 6 + 0 + 3);
    expect(rt.clears).toBe(1);
    expect(rt.drawn).toEqual([gfx]);
    // 第二次 redraw（下一次数值变化）复用同一对对象，不新建。
    baker.redraw([10, 50, 0, 25], colors, 0xd8665f);
    expect(gfx.clears).toBe(2);
    expect(rt.clears).toBe(2);
    expect(rt.drawn).toHaveLength(2);
  });

  it('destroy tears down both the RT and the off-screen source', () => {
    const { scene, gfx, rt } = fakeScene();
    const baker = createStatRingsBaker(scene as unknown as Phaser.Scene, GEOMETRY);
    baker.destroy();
    expect(rt.destroyed).toBe(true);
    expect(gfx.destroyed).toBe(true);
  });
});

// ── GameScene 接线（源码断言：场景 import Phaser，Node 下跑不了真场景） ──────
const sceneSrc = readFileSync('src/scenes/GameScene.ts', 'utf-8');
const skinSrc = readFileSync('src/render/hudSkin.ts', 'utf-8');

describe('GameScene ring bake wiring (AG-102)', () => {
  it('replaced the live rings Graphics with a RenderTexture', () => {
    expect(sceneSrc).not.toContain('barsGfx');
    expect(sceneSrc).toContain('createStatRingsBaker(this, hud)');
    // RT 挂在旧 Graphics 的同 tier：scrollFactor 0、深度 103、'all' 渲染模式
    // （默认 'render' 不执行命令缓冲，圆环会全空）。
    expect(skinSrc).toMatch(/\.setScrollFactor\(0\)\s*\n\s*\.setDepth\(103\)/);
    expect(skinSrc).toContain(".setName('hud-stat-rings')");
    expect(skinSrc).toContain(".setRenderMode('all')");
  });

  it('redraws on change inside refreshStats, never per frame', () => {
    // 重烤调用在 key 守卫之后（同一 if (key === this.lastStats) return; 之下），
    // 即只在取整数值变化时重画。
    const body = sceneSrc.slice(sceneSrc.indexOf('private refreshStats()'));
    const guard = body.indexOf('if (key === this.lastStats) return;');
    const redraw = body.indexOf('this.statRings?.redraw(');
    expect(guard).toBeGreaterThan(0);
    expect(redraw).toBeGreaterThan(guard);
  });

  it('destroys the previous run\'s baker before rebuilding (restart-safe)', () => {
    expect(sceneSrc).toContain('this.statRings?.destroy();');
  });
});
