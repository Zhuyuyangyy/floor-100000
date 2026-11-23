import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FLOOR_WIDTH, VIEW_ZOOM_MAX, VIEW_ZOOM_MIN, FLOOR_VIEW_ZOOM } from '../core/constants';
import { DESIGN_WIDTH } from '../core/design';
import { fitBoundsAxis, floorBoundsX } from '../render/cameraBounds';
import { floorWidthFor } from '../core/constants';

// 2026-11-23 界面巡检：缩到 50% 时世界只占屏幕左 62.5%，右边一大片纯色。
//
// 机制（Phaser BaseCamera.clampX + Camera.preRender）：bounds 比视口世界宽窄时，
// scrollX 被钉在 bounds.x + (dw - 画布宽)/2，于是 worldView.x == bounds.x ——
// bounds 左沿对齐视口左沿，多出来的视口宽全落在右侧。楼层从 x=0 起画、bounds
// 也从 0 起，所以楼层贴左。修法是让 bounds 不窄于视口并把楼层摆正中。
//
// 这里钉两件事：① 缩小时左右留白必须相等；② zoom ≥ 1 时返回值与旧写法
// `0, floorW` 逐位相同（存量 e2e 基线一个像素都不许动）。

const SCENE_SRC = readFileSync(join(process.cwd(), 'src/scenes/GameScene.ts'), 'utf8');

/** 该 zoom 下的视口世界宽。 */
const viewW = (zoom: number): number => DESIGN_WIDTH / (FLOOR_VIEW_ZOOM * zoom);

describe('相机横向 bounds：缩小时楼层居中', () => {
  it('bounds 比视口窄时扩到视口宽，楼层左右留白相等', () => {
    // 实测那组：F2 宽 1600、zoom 0.5 → 视口 2560。
    const b = floorBoundsX(1600, 2560);
    expect(b.size).toBe(2560);
    expect(b.start).toBe(-480);
    // worldView.x == bounds.start（Phaser 的退化 clamp），楼层 [0,1600]。
    const leftGapWorld = 0 - b.start;
    const rightGapWorld = b.start + b.size - 1600;
    expect(leftGapWorld).toBe(rightGapWorld);
  });

  it('每种真实楼层宽 × 每个合法 zoom 都不偏心', () => {
    const widths = new Set<number>();
    for (let f = 1; f <= 200; f++) widths.add(floorWidthFor(f));
    expect(widths.size).toBeGreaterThan(1); // tier1 层长确实有差异
    for (const w of widths) {
      for (let z = VIEW_ZOOM_MIN; z <= VIEW_ZOOM_MAX + 1e-9; z *= 1.25) {
        const b = floorBoundsX(w, viewW(z));
        const left = 0 - b.start;
        const right = b.start + b.size - w;
        // 要么铺满（两边都 ≤ 0），要么严格对称。
        if (b.size > w) {
          expect(Math.abs(left - right), `w=${w} z=${z.toFixed(3)}`).toBeLessThanOrEqual(1e-9);
          expect(left).toBeGreaterThan(0);
        } else {
          expect(b.start).toBe(0);
          expect(b.size).toBe(w);
        }
      }
    }
  });

  it('bounds 永远不窄于视口 —— 退化 clamp 不再产生偏心', () => {
    for (const w of [FLOOR_WIDTH, 1600, 1920]) {
      for (const z of [VIEW_ZOOM_MIN, 0.64, 0.8, 1, 1.25, VIEW_ZOOM_MAX]) {
        const b = floorBoundsX(w, viewW(z));
        expect(b.size).toBeGreaterThanOrEqual(Math.min(w, viewW(z)));
        if (viewW(z) > w) expect(b.size).toBe(viewW(z));
      }
    }
  });
});

describe('相机横向 bounds：zoom ≥ 1 不许有任何变化', () => {
  it('zoom 1 及放大侧返回值与旧写法 0, floorW 逐位相同', () => {
    for (const w of [FLOOR_WIDTH, 1600, 1920, 2240]) {
      for (const z of [1, 1.25, 1.5625, VIEW_ZOOM_MAX]) {
        const b = floorBoundsX(w, viewW(z));
        expect(b.start, `w=${w} z=${z}`).toBe(0);
        expect(b.size, `w=${w} z=${z}`).toBe(w);
      }
    }
  });

  it('内容不小于视口时原样返回（通用轴同样契约）', () => {
    expect(fitBoundsAxis(100, 500, 400)).toEqual({ start: 100, size: 500 });
    expect(fitBoundsAxis(-20, 300, 300)).toEqual({ start: -20, size: 300 });
    // 内容窄于视口才扩，且居中。
    expect(fitBoundsAxis(100, 200, 400)).toEqual({ start: 0, size: 400 });
  });
});

describe('场景接线', () => {
  it('所有世界 bounds 都走 setWorldBounds，不再就地写 0, floorW', () => {
    expect(SCENE_SRC).toContain('private setWorldBounds(top: number, height: number): void');
    expect(SCENE_SRC).toContain('const x = floorBoundsX(this.floorW, viewW);');
    expect(SCENE_SRC).toContain('cam.setBounds(x.start, top, x.size, height);');
    // 旧写法一处都不许留（create() 里那次初始 bounds 用的是 FLOOR_WIDTH，
    // 在 setupViewCameras/drawFloor 之前，随后即被覆盖，不在此列）。
    expect(SCENE_SRC).not.toContain('cam.setBounds(0, topBound, this.floorW');
    expect(SCENE_SRC).not.toContain('cam.setBounds(0, standScrollY, this.floorW');
    expect(SCENE_SRC).not.toContain('cam.setBounds(0, top, this.floorW');
    expect(SCENE_SRC).not.toContain('cam.setBounds(0, standing.top, this.floorW');
    expect(SCENE_SRC).not.toContain('cam.setBounds(0, Math.min(fromY, toY), this.floorW');
  });

  it('六处相机 bounds 调用点全部改道', () => {
    const calls = SCENE_SRC.match(/this\.setWorldBounds\(/g) ?? [];
    expect(calls.length).toBe(6);
  });
});