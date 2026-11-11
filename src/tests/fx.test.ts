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
