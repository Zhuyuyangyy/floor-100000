import { describe, expect, it } from 'vitest';

import { bossSpotId, encounterSpots, nudgeSpotX } from '../systems/encounterSpots';
import { DOWN_EXIT_X, INTERACT_DISTANCE, PLAYABLE_FLOORS_V01, STARTING_FLOOR, UP_EXIT_X } from '../core/constants';
import { getFloorTemplate } from '../data/floorTemplates';
import { NPCS, NPC_FLOOR } from '../data/npcs';

describe('encounter spots', () => {
  it('lays the same floor out the same way for a seed', () => {
    expect(encounterSpots(42, 3)).toEqual(encounterSpots(42, 3));
  });

  it('gives different seeds different layouts', () => {
    // Two seeds landing identical layouts on every floor would mean the hash
    // is not actually mixing the seed in.
    const a = PLAYABLE_FLOORS_V01.map((f) => encounterSpots(1, f).map((s) => s.x).join(','));
    const b = PLAYABLE_FLOORS_V01.map((f) => encounterSpots(2, f).map((s) => s.x).join(','));
    expect(a).not.toEqual(b);
  });

  it('leaves the dorm alone — home is the safe floor', () => {
    expect(encounterSpots(42, STARTING_FLOOR)).toEqual([]);
  });

  it('parks the boss past the up-exit on the top floor', () => {
    const top = Math.max(...PLAYABLE_FLOORS_V01);
    const spots = encounterSpots(42, top);
    const boss = spots.find((s) => s.isBoss);
    expect(boss).toBeDefined();
    expect(boss!.id).toBe(bossSpotId(top));
    expect(boss!.x).toBeGreaterThan(UP_EXIT_X);
  });

  it('keeps every spot inside the floor and apart from the others', () => {
    for (const floor of PLAYABLE_FLOORS_V01) {
      const spots = encounterSpots(42, floor);
      for (const s of spots) {
        expect(s.x, `floor ${floor} spot ${s.id}`).toBeGreaterThan(0);
        expect(s.x, `floor ${floor} spot ${s.id}`).toBeLessThan(1280);
      }
      for (let i = 0; i < spots.length; i++) {
        for (let j = i + 1; j < spots.length; j++) {
          expect(Math.abs(spots[i].x - spots[j].x), `floor ${floor} ${spots[i].id}/${spots[j].id}`).toBeGreaterThan(120);
        }
      }
    }
  });

  // The regression this test exists for: a "?" that lands inside anything E
  // already reaches for silently hijacks the key — the player cannot open the
  // container, talk to the NPC or take the stairs they walked to. It broke the
  // NPC trade spec and both journey specs before this existed.
  it('leaves no spot inside another interactable\'s radius, once nudged', () => {
    for (const seed of [1, 42, 2026]) {
      for (const floor of PLAYABLE_FLOORS_V01) {
        const tpl = getFloorTemplate(floor);
        const taken: number[] = [UP_EXIT_X, DOWN_EXIT_X, ...(tpl?.containers ?? []).map((c) => c.x)];
        if (floor === NPC_FLOOR) taken.push(...NPCS.map((n) => n.x));
        for (const s of encounterSpots(seed, floor)) {
          const x = nudgeSpotX(s.x, taken, INTERACT_DISTANCE + 8);
          for (const t of taken) {
            expect(Math.abs(x - t), `seed ${seed} floor ${floor} spot ${s.id}@${x} vs interactable@${t}`).toBeGreaterThan(INTERACT_DISTANCE);
          }
        }
      }
    }
  });

  it('nudges a spot clear of what it overlaps, deterministically', () => {
    const nudged = nudgeSpotX(500, [505], 40);
    expect(nudged).toBeGreaterThan(545);
    expect(nudged).toBe(nudgeSpotX(500, [505], 40));
    // Already clear: untouched.
    expect(nudgeSpotX(500, [700], 40)).toBe(500);
  });
});
