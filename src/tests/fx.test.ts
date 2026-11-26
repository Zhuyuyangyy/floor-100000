import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FX, FX_META } from '../render/fx';

const root = join(process.cwd(), 'public', 'assets', 'fx');

describe('melee pixelfx registry', () => {
  it('registers the slash and parry atlases', () => {
    expect(FX).toEqual(expect.arrayContaining([
      { id: 'sword-slash', path: 'melee/sword-slash' },
      { id: 'parry', path: 'impacts/parry' },
    ]));
    expect(FX_META['sword-slash']).toEqual({ fps: 30, loop: false, pivot: { x: 44, y: 92 }, frameSize: [136, 104] });
    expect(FX_META.parry).toEqual({ fps: 30, loop: false, pivot: { x: 100, y: 96 }, frameSize: [200, 112] });
  });

  it('ships valid PNG/JSON pairs with matching pixelfx metadata', () => {
    for (const { id, path } of FX.filter(({ id: fxId }) => fxId === 'sword-slash' || fxId === 'parry')) {
      const dir = join(root, path);
      const png = join(dir, `${id}.png`);
      const json = join(dir, `${id}.json`);
      expect(existsSync(png), `${png} exists`).toBe(true);
      expect(existsSync(json), `${json} exists`).toBe(true);
      const meta = JSON.parse(readFileSync(json, 'utf8')).meta.pixelfx;
      expect(meta.fps).toBe(FX_META[id].fps);
      expect(meta.frameSize).toEqual(FX_META[id].frameSize);
      expect(meta.pivot).toEqual([FX_META[id].pivot.x, FX_META[id].pivot.y]);
      expect(meta.loop).toBe(FX_META[id].loop);
      expect(meta.frames).toBeGreaterThan(0);
    }
  });
});

describe('末日氛围层特效的元数据一致性', () => {
  const ids = ['spirit-flame', 'wisp', 'bat', 'portal', 'blizzard-vortex', 'bullet-impact'];

  it('每个新效果都有 PNG/JSON 对，且 FX_META 与 atlas 逐字一致', () => {
    for (const id of ids) {
      const def = FX.find((f) => f.id === id);
      expect(def, `${id} 已注册`).toBeDefined();
      const dir = join(root, def!.path);
      expect(existsSync(join(dir, `${id}.png`)), `${id}.png exists`).toBe(true);
      const meta = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')).meta.pixelfx;
      expect(FX_META[id], `${id} 有 meta`).toBeDefined();
      expect(meta.fps).toBe(FX_META[id].fps);
      expect(meta.loop).toBe(FX_META[id].loop);
      expect(meta.frameSize).toEqual(FX_META[id].frameSize);
      expect(meta.pivot).toEqual([FX_META[id].pivot.x, FX_META[id].pivot.y]);
      expect(meta.frames).toBeGreaterThan(0);
    }
  });
});
