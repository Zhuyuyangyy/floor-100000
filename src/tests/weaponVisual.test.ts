import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nextWeaponVisual, weaponSwingAngle, WEAPON_VISUALS, type WeaponVisualId } from '../render/weapon';

describe('weapon appearance selection', () => {
  it('keeps the requested five-weapon lineup in order', () => {
    expect(WEAPON_VISUALS.map(({ id, label }) => [id, label])).toEqual([
      ['crowbar', '撬棍'],
      ['fire-axe', '消防斧'],
      ['cleaver', '砍刀'],
      ['short-sword', '短剑'],
      ['dagger', '匕首'],
    ]);
  });

  it('gives every weapon a distinct three-frame swing trajectory', () => {
    for (let frame = 0; frame < 3; frame++) {
      const angles = WEAPON_VISUALS.map((weapon) => weaponSwingAngle(weapon.id, frame));
      expect(new Set(angles).size, `frame ${frame}`).toBe(WEAPON_VISUALS.length);
    }
    expect(new Set(WEAPON_VISUALS.map((weapon) => weapon.swingAnglesDeg.join(','))).size).toBe(WEAPON_VISUALS.length);
  });

  it('cycles in the listed order and wraps back to the crowbar', () => {
    const sequence: WeaponVisualId[] = ['crowbar'];
    for (let i = 0; i < WEAPON_VISUALS.length; i++) sequence.push(nextWeaponVisual(sequence[sequence.length - 1]));
    expect(sequence).toEqual(['crowbar', 'fire-axe', 'cleaver', 'short-sword', 'dagger', 'crowbar']);
  });

  it('maps the supplied art and effects without adding gameplay data', () => {
    expect(WEAPON_VISUALS.map(({ id, effect }) => [id, effect])).toEqual([
      ['crowbar', 'sword-slash'],
      ['fire-axe', 'heavy-cleave'],
      ['cleaver', 'heavy-cleave'],
      ['short-sword', 'sword-slash'],
      ['dagger', 'sword-slash'],
    ]);
    for (const weapon of WEAPON_VISUALS) {
      if (!weapon.imagePath) continue;
      expect(existsSync(resolve(process.cwd(), 'public', weapon.imagePath)), weapon.imagePath).toBe(true);
    }
    const atlasPath = resolve(process.cwd(), 'public/assets/fx/melee/heavy-cleave/heavy-cleave.json');
    const atlas = JSON.parse(readFileSync(atlasPath, 'utf8')) as { meta?: { frameCount?: number; cellSize?: { w?: number; h?: number } } };
    expect(atlas.meta?.frameCount).toBeGreaterThan(0);
    expect(atlas.meta?.cellSize).toEqual({ w: 136, h: 104 });
    expect(existsSync(resolve(process.cwd(), 'public/assets/fx/melee/heavy-cleave/heavy-cleave.png'))).toBe(true);
  });
});
