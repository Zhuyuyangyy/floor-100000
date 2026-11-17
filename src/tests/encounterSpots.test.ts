import { describe, expect, it } from 'vitest';

import { bossSpotId, encounterSpots, nudgeSpotX } from '../systems/encounterSpots';
import { ENCOUNTER_TABLE } from '../systems/encounters';
import { DOWN_EXIT_X, floorWidthFor, INTERACT_DISTANCE, PLAYABLE_FLOORS_V01, STARTING_FLOOR, UP_EXIT_X } from '../core/constants';
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

  // The marker belongs to the floors that can roll a boss, read off the
  // encounter table — NOT to whatever floor the playable list ends on. It used
  // to be the list's top, which drifted 5 -> 10 -> 110 as segments were
  // authored; with tier 3 it would have landed on 1010, a floor with no boss in
  // its table, while 110 silently lost its guardian.
  it('parks the boss past the up-exit on every floor that can roll one', () => {
    const bossFloors = PLAYABLE_FLOORS_V01.filter((f) =>
      ENCOUNTER_TABLE[f].some((e) => e.kind === 'boss'),
    );
    expect(bossFloors).toEqual([5, 110, 50010]);
    for (const floor of bossFloors) {
      const spots = encounterSpots(42, floor);
      const boss = spots.find((s) => s.isBoss);
      expect(boss, `floor ${floor} must carry the guardian`).toBeDefined();
      expect(boss!.id).toBe(bossSpotId(floor));
      expect(boss!.x).toBeGreaterThan(UP_EXIT_X);
    }
  });

  it('follows the table to the tower top, and skips the tops without one', () => {
    // The tower top used to be a floor whose table had no boss (10, then 1010,
    // then 10010) and the marker had to stay off it. 50010 closes the VIP tier
    // and DOES carry the keeper; the summit 100000 — authored in the finale —
    // does not: 终局等的是终端不是怪物（encounters.ts 的 100000 行没有 boss）。
    // So the marker follows the table up to the LAST boss floor, not to the
    // list's end, still derived rather than hard-coded, so the old drift cannot
    // come back.
    const top = Math.max(...PLAYABLE_FLOORS_V01);
    expect(top).toBe(100000);
    expect(ENCOUNTER_TABLE[top].some((e) => e.kind === 'boss')).toBe(false);
    expect(encounterSpots(42, top).some((s) => s.isBoss)).toBe(false);
    const lastBoss = 50010;
    expect(ENCOUNTER_TABLE[lastBoss].some((e) => e.kind === 'boss')).toBe(true);
    expect(encounterSpots(42, lastBoss).some((s) => s.isBoss)).toBe(true);
    // The segment tops whose tables have no boss still carry none, even though
    // the list's end once sat on each of them.
    for (const floor of [1010, 10010]) {
      expect(ENCOUNTER_TABLE[floor].some((e) => e.kind === 'boss')).toBe(false);
      expect(encounterSpots(42, floor).some((s) => s.isBoss)).toBe(false);
    }
  });

  it('keeps every spot inside the floor and apart from the others', () => {
    for (const floor of PLAYABLE_FLOORS_V01) {
      const spots = encounterSpots(42, floor);
      for (const s of spots) {
        expect(s.x, `floor ${floor} spot ${s.id}`).toBeGreaterThan(0);
        // AG-104：边界按本层实际宽度（floorWidthFor）——tier2+ 宽楼 1600-2880px+，
        // 遭遇点随楼宽铺满全层；tier1 各层 width=1280，与修复前逐点一致。
        expect(s.x, `floor ${floor} spot ${s.id}`).toBeLessThan(floorWidthFor(floor));
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
