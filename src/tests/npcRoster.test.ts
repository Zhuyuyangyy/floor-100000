import { describe, expect, it } from 'vitest';

import { INTERACT_DISTANCE, PLAYABLE_FLOORS_V01, UP_EXIT_X, DOWN_EXIT_X, ENTRY_X } from '../core/constants';
import { getFloorTemplate } from '../data/floorTemplates';
import { NPCS, npcsOnFloor, NPC_FLOOR } from '../data/npcs';
import { CHARACTER_KEYS } from '../render/artpack';
import { CHARACTER_PALETTES, drawPose, idlePose, makeCanvas, WALK_CHARACTERS, FRAME_H, FRAME_W } from '../render/walkcycle';
import { NPC_PROFILES, ARCHETYPES } from '../data/npcPersonalities';
import { archetypeForNpcId, npcFactFromDef } from '../ai/config';
import { encounterSpots, nudgeSpotX, placeClearX } from '../systems/encounterSpots';

// The tower is "many people, one building". v0.1 shipped two neighbours on one
// floor, which is what a corridor with two shopkeepers in it looks like — not a
// block of flats. These are the rules that keep the roster from quietly shrinking
// back to that, and the two bugs that made six residents dangerous.
//
// Both bugs were live before this file existed:
//   1. `drawNpcs` picked the sprite with `id === 'alin' ? ... : 'npc_xiaozhou'`,
//      so every resident added after 小周 would have been drawn as 小周.
//   2. Coordinates were never checked against each other, so two residents could
//      stand within INTERACT_DISTANCE and E would open whichever came first in
//      the array, forever. The trade specs broke exactly this way before.

describe('the building has residents on more than one floor', () => {
  it('holds more than the two neighbours v0.1 shipped with', () => {
    expect(NPCS.length).toBeGreaterThan(2);
  });

  it('spreads them over the floors the player actually walks', () => {
    const floors = new Set(NPCS.map((npc) => npc.floor));
    expect(floors.size, `all residents are on floor(s) ${[...floors].join(',')}`).toBeGreaterThan(1);
    // Every floor named must be a floor that exists, or the resident never renders.
    for (const floor of floors) expect(PLAYABLE_FLOORS_V01).toContain(floor);
  });

  it('keeps 阿林 on the neighbour-dorm floor, where the repair gate is anchored', () => {
    // data/floorGates.ts hard-wires NPC_FLOOR, and the door plan lives there.
    expect(NPCS.find((n) => n.id === 'alin')?.floor).toBe(NPC_FLOOR);
  });

  it('gives every resident a distinct id and a distinct name', () => {
    expect(new Set(NPCS.map((n) => n.id)).size).toBe(NPCS.length);
    expect(new Set(NPCS.map((n) => n.name)).size).toBe(NPCS.length);
  });

  it('npcsOnFloor only returns that floor’s residents', () => {
    expect(npcsOnFloor(NPC_FLOOR).every((n) => n.floor === NPC_FLOOR)).toBe(true);
    expect(npcsOnFloor(1)).toEqual([]); // the dorm is the player's, nobody lives in it
    const total = PLAYABLE_FLOORS_V01.reduce((n, f) => n + npcsOnFloor(f).length, 0);
    expect(total).toBe(NPCS.length);
  });
});

describe('every resident is drawable', () => {
  it('names a sprite that the art pipeline can resolve', () => {
    // A key outside CHARACTER_KEYS is a green __MISSING box at runtime and a
    // silent one at build time, so it is asserted here instead.
    for (const npc of NPCS) {
      expect(CHARACTER_KEYS, `${npc.name} sprite`).toContain(npc.sprite);
      expect(WALK_CHARACTERS, `${npc.name} has no walk sheet baked`).toContain(npc.sprite);
    }
  });

  it('never points two residents at the same sprite', () => {
    // Two people who look identical standing on one floor read as a duplicate,
    // not as two neighbours.
    const sprites = NPCS.map((npc) => npc.sprite);
    expect(new Set(sprites).size).toBe(sprites.length);
  });

  it('draws each resident as a silhouette you can tell apart on the same floor', () => {
    // Every resident shares one skeleton, so the ONLY things separating two of
    // them are the palette and CharacterColors.bulk. 老陈 was first given bulk
    // 1.42 alongside 大刘's 1.35 — measured silhouette IoU 0.991, which is two
    // twins standing next to each other. Bulk is a one-per-build budget, so the
    // gate is on silhouette overlap, not on "did we remember to set a colour".
    //
    // Only same-floor pairs matter: two residents on different floors are never
    // on screen together.
    const masks = new Map<string, Uint8Array>();
    const silhouette = (sprite: string): Uint8Array => {
      const cached = masks.get(sprite);
      if (cached) return cached;
      const colors = CHARACTER_PALETTES[sprite as keyof typeof CHARACTER_PALETTES];
      expect(colors, `no palette baked for ${sprite}`).toBeDefined();
      const cv = makeCanvas(FRAME_W, FRAME_H);
      drawPose(cv, idlePose(0), colors, 0);
      const m = new Uint8Array(FRAME_W * FRAME_H);
      for (let i = 0; i < m.length; i++) m[i] = cv.px[i * 4 + 3] > 0 ? 1 : 0;
      masks.set(sprite, m);
      return m;
    };

    for (const floor of PLAYABLE_FLOORS_V01) {
      const residents = npcsOnFloor(floor);
      for (let i = 0; i < residents.length; i++) {
        for (let j = i + 1; j < residents.length; j++) {
          const a = silhouette(residents[i].sprite);
          const b = silhouette(residents[j].sprite);
          let inter = 0;
          let union = 0;
          for (let k = 0; k < a.length; k++) {
            if (a[k] || b[k]) union++;
            if (a[k] && b[k]) inter++;
          }
          const iou = inter / union;
          expect(
            iou,
            `${residents[i].name} and ${residents[j].name} share a floor and their silhouettes overlap ${(iou * 100).toFixed(1)}% — give one of them a different bulk`,
          ).toBeLessThan(0.96);
        }
      }
    }
  });
});

describe('every resident has their own personality', () => {
  it('has a profile for each of them', () => {
    for (const npc of NPCS) {
      expect(NPC_PROFILES[npc.id], `${npc.name} falls back to neutral`).toBeDefined();
    }
  });

  it('resolves each resident to their own archetype, not the neutral fallback', () => {
    // The old lookup walked ARCHETYPES and returned neutral for anything it did
    // not find, so four new residents would all have become 'neutral' silently.
    expect(archetypeForNpcId('laochen')).toBe('neutral');
    expect(archetypeForNpcId('azhen')).toBe('ally');
    expect(archetypeForNpcId('daliu')).toBe('neutral');
    expect(archetypeForNpcId('xiaoman')).toBe('neutral');
    // The pairs that share an archetype still differ in traits.
    const chen = NPC_PROFILES.laochen.traits;
    const man = NPC_PROFILES.xiaoman.traits;
    expect(chen).not.toEqual(man);
  });

  it('keeps every trait inside 0..1, the range the schema validator enforces', () => {
    for (const npc of NPCS) {
      for (const [key, value] of Object.entries(NPC_PROFILES[npc.id].traits)) {
        expect(value, `${npc.name}.${key}`).toBeGreaterThanOrEqual(0);
        expect(value, `${npc.name}.${key}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps the archetype table and the profile table agreeing', () => {
    // A profile whose archetype has no entry in ARCHETYPES would pass the string
    // check in isValidNpcState and then crash ARCHETYPE_ACTIONS.
    for (const npc of NPCS) expect(ARCHETYPES[NPC_PROFILES[npc.id].archetype]).toBeDefined();
  });

  it('puts each resident’s own floor into the fact the executor reads', () => {
    // npcFactFromDef used to hard-code floor 2. With residents upstairs, every
    // distance check for them would have come back too_far.
    for (const npc of NPCS) expect(npcFactFromDef(npc).floor).toBe(npc.floor);
  });
});

describe('residents do not fight over the E key', () => {
  it('keeps every pair of residents apart, and clear of containers', () => {
    for (const floor of PLAYABLE_FLOORS_V01) {
      const residents = npcsOnFloor(floor);
      if (residents.length === 0) continue;
      const tpl = getFloorTemplate(floor);
      const others = [
        ...(tpl?.containers ?? []).map((c) => c.x),
        ...(tpl?.ground ?? []).map((g) => g.x),
        UP_EXIT_X,
        DOWN_EXIT_X,
      ];
      for (const npc of residents) {
        for (const x of others) {
          expect(Math.abs(npc.x - x), `${npc.name}@${npc.x} vs interactable@${x} on floor ${floor}`).toBeGreaterThan(
            INTERACT_DISTANCE,
          );
        }
        expect(npc.x).toBeGreaterThan(40);
        expect(npc.x).toBeLessThan(1240);
      }
      for (let i = 0; i < residents.length; i++) {
        for (let j = i + 1; j < residents.length; j++) {
          expect(
            Math.abs(residents[i].x - residents[j].x),
            `${residents[i].name} and ${residents[j].name} overlap on floor ${floor}`,
          ).toBeGreaterThan(INTERACT_DISTANCE);
        }
      }
    }
  });

  it('still leaves room for the question marks and the trader', () => {
    // The regression this guards: a floor crowded with residents could push a
    // "?" (or the trader) to a position that overlaps something else, which
    // silently disables whichever key the player pressed.
    for (const seed of [1, 42, 2026]) {
      for (const floor of PLAYABLE_FLOORS_V01) {
        const tpl = getFloorTemplate(floor);
        const taken = [
          UP_EXIT_X,
          DOWN_EXIT_X,
          ...(tpl?.containers ?? []).map((c) => c.x),
          ...(tpl?.ground ?? []).map((g) => g.x),
          ...npcsOnFloor(floor).map((n) => n.x),
        ];
        const shopX = floor >= 2 ? placeClearX(seed, floor, 'trader', [...taken, ENTRY_X], INTERACT_DISTANCE * 2) : null;
        const all = shopX !== null ? [...taken, shopX] : taken;
        for (const spot of encounterSpots(seed, floor)) {
          const x = nudgeSpotX(spot.x, all, INTERACT_DISTANCE + 8);
          for (const t of all) {
            expect(
              Math.abs(x - t),
              `seed ${seed} floor ${floor} spot ${spot.id}@${x} vs ${t}`,
            ).toBeGreaterThan(INTERACT_DISTANCE);
          }
        }
      }
    }
  });
});

describe('barter offers stay sinks, not fountains', () => {
  it('never lets a chain of offers hand back its own input', () => {
    // The concrete bug this caught: 大刘 gave wood for a battery and 老陈 gave a
    // battery for wood, so a player could bounce one battery forever. Every offer
    // must consume something the world supplies and that no offer returns.
    const byGive = new Map<string, string>();
    for (const npc of NPCS) for (const o of npc.offers) byGive.set(o.give.itemId, o.get.itemId);
    for (const start of byGive.keys()) {
      const seen = new Set<string>([start]);
      let cur = byGive.get(start);
      while (cur !== undefined) {
        expect(seen.has(cur), `${start} loops back through ${cur}`).toBe(false);
        seen.add(cur);
        cur = byGive.get(cur);
      }
    }
  });

  it('gives every resident something to trade', () => {
    for (const npc of NPCS) expect(npc.offers.length, `${npc.name} has nothing to offer`).toBeGreaterThan(0);
  });

  it('has two distinct lines for both the greeting and the ask', () => {
    for (const npc of NPCS) {
      expect(npc.greetings).toHaveLength(2);
      expect(npc.asks).toHaveLength(2);
      expect(new Set(npc.greetings).size, `${npc.name} greets twice the same way`).toBe(2);
      expect(new Set(npc.asks).size, `${npc.name} asks twice the same way`).toBe(2);
    }
  });
});