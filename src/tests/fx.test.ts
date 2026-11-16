import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FX, FX_META } from '../render/fx';

const root = join(process.cwd(), 'public', 'assets', 'fx');

describe('melee pixelfx registry', () => {
  it('registers the slash, heavy cleave, and parry atlases', () => {
    expect(FX).toEqual(expect.arrayContaining([
      { id: 'sword-slash', path: 'melee/sword-slash' },
      { id: 'heavy-cleave', path: 'melee/heavy-cleave' },
      { id: 'parry', path: 'impacts/parry' },
    ]));
    expect(FX_META['sword-slash']).toEqual({ fps: 30, loop: false, pivot: { x: 44, y: 92 }, frameSize: [136, 104] });
    expect(FX_META['heavy-cleave']).toEqual({ fps: 30, loop: false, pivot: { x: 44, y: 92 }, frameSize: [136, 104] });
    expect(FX_META.parry).toEqual({ fps: 30, loop: false, pivot: { x: 100, y: 96 }, frameSize: [200, 112] });
  });

  it('ships valid PNG/JSON pairs with matching pixelfx metadata', () => {
    for (const { id, path } of FX.filter(({ id: fxId }) => ['sword-slash', 'heavy-cleave', 'parry'].includes(fxId))) {
      const dir = join(root, path);
      const png = join(dir, `${id}.png`);
      const json = join(dir, `${id}.json`);
      expect(existsSync(png), `${png} exists`).toBe(true);
      expect(existsSync(json), `${json} exists`).toBe(true);
      const sourceMeta = JSON.parse(readFileSync(json, 'utf8')).meta;
      const meta = sourceMeta.pixelfx ?? sourceMeta;
      const frameSize = meta.frameSize ?? [meta.cellSize.w, meta.cellSize.h];
      const pivot = Array.isArray(meta.pivot) ? meta.pivot : [meta.pivot.x, meta.pivot.y];
      expect(meta.fps).toBe(FX_META[id].fps);
      expect(frameSize).toEqual(FX_META[id].frameSize);
      expect(pivot).toEqual([FX_META[id].pivot.x, FX_META[id].pivot.y]);
      if (meta.loop !== undefined) expect(meta.loop).toBe(FX_META[id].loop);
      expect(meta.frames ?? meta.frameCount).toBeGreaterThan(0);
    }
  });
});
