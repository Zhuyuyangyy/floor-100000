import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { FLOOR_TEMPLATES } from '../data/floorTemplates';
import { ITEM_IDS } from '../data/items';
import { NPCS } from '../data/npcs';
import { getItem } from '../data/items';
import { RECIPES } from '../data/recipes';
import { GAME_CONFIG } from '../core/config';
import { getFloorView, lootContainer, lootGround } from '../systems/LootSystem';
import { addItem, countItem } from '../systems/InventorySystem';
import { craft, nightOverlayAlpha, purifyWater } from '../systems/CraftingSystem';
import { advanceTime, isNight, NIGHT_START_MINUTE, REST_METABOLISM, sleep, sleepNightMinutes } from '../systems/SurvivalSystem';
import { PLAYABLE_FLOORS_V01 } from '../core/constants';
import type { GameState, ItemId } from '../core/gameTypes';

// B3-01: the design requirements the first survival chapter has to satisfy.
// These are the rules the audit found broken or undefined, written as tests
// before the fixes so each one is proven rather than asserted.

function give(state: GameState, items: Array<[ItemId, number]>): void {
  for (const [id, n] of items) addItem(state.player.inventory, id, n);
}

// Every item the world can hand the player, and whether it is guaranteed.
// Starting items count as a source: the flashlight is handed to you, not found.
function worldSources(): Map<ItemId, { guaranteed: boolean; where: string[] }> {
  const out = new Map<ItemId, { guaranteed: boolean; where: string[] }>();
  const note = (id: ItemId, guaranteed: boolean, where: string): void => {
    const cur = out.get(id) ?? { guaranteed: false, where: [] };
    cur.guaranteed = cur.guaranteed || guaranteed;
    cur.where.push(where);
    out.set(id, cur);
  };
  for (const s of GAME_CONFIG.inventory.startingItems) note(s.itemId as ItemId, true, 'starting');
  for (const floor of PLAYABLE_FLOORS_V01) {
    const t = FLOOR_TEMPLATES[floor];
    for (const c of t.containers) {
      for (const l of c.loot) note(l.itemId as ItemId, l.guaranteed === true, `F${floor}/${c.id}`);
    }
    for (const g of t.ground) note(g.itemId, true, `F${floor}/ground`);
  }
  for (const n of NPCS) {
    for (const o of n.offers) note(o.give.itemId, false, `${n.name}/give`);
  }
  return out;
}

// The floors the three upgrades draw their materials from. A player chasing the
// upgrades does not tour all five floors — and cannot: the 12-slot bag overflows
// long before every container is emptied, so looting is a choice, not a sweep.
const MATERIAL_FLOORS = [3, 4];

function lootMaterialFloors(state: GameState): void {
  for (const floor of MATERIAL_FLOORS) {
    const view = getFloorView(state, floor);
    for (const c of view.containers) lootContainer(state, floor, c.id);
    for (const g of view.groundItems) lootGround(state, floor, g.key);
  }
}

describe('every recipe material has a deterministic path (audit D1)', () => {
  it('no recipe needs a material that only ever appears in a probability roll', () => {
    const sources = worldSources();
    const needed = new Set<ItemId>();
    for (const r of RECIPES) for (const id of Object.keys(r.cost)) needed.add(id as ItemId);
    const undetermined: string[] = [];
    for (const id of needed) {
      const s = sources.get(id);
      if (!s || !s.guaranteed) undetermined.push(`${id} (${s?.where.join(',') ?? 'no source'})`);
    }
    expect(undetermined, 'these materials can be missing for a whole run').toEqual([]);
  });

  it('a guaranteed loot entry always pins its quantity', () => {
    // resolveLoot() rejects a guaranteed range, so this also guards the data.
    for (const floor of PLAYABLE_FLOORS_V01) {
      for (const c of FLOOR_TEMPLATES[floor].containers) {
        for (const l of c.loot) {
          if (l.guaranteed) expect(l.min, `F${floor}/${c.id} ${l.itemId}`).toBe(l.max);
        }
      }
    }
  });
});

describe('the world supplies enough to build every upgrade (audit D2)', () => {
  // The audit found scrap_metal capped at 2 while lamp + purifier need 3, which
  // made them mutually exclusive — a false choice, because losing the purifier
  // means dying of thirst while losing the lamp only changes night lighting.
  const SEEDS = [1, 42, 2026, 7, 99, 1234, 55555, 987654];

  it('all three upgrades are buildable from the material floors, on every seed', () => {
    for (const seed of SEEDS) {
      const s = createNewGame(seed);
      lootMaterialFloors(s);
      const built: string[] = [];
      for (const r of RECIPES) {
        if (craft(s, r.id).ok) built.push(r.id);
      }
      expect(built, `seed ${seed} could only build ${built.join('/')}`).toEqual(['lamp', 'reinforced_door', 'purifier']);
    }
  });

  it('the bag cannot hold everything, so looting stays a choice', () => {
    // Pins the bag-pressure fact the seed sweep exposed: a blind sweep of all
    // five floors overflows the 12 slots and silently drops later containers.
    const s = createNewGame(1);
    for (const floor of PLAYABLE_FLOORS_V01) {
      const view = getFloorView(s, floor);
      for (const c of view.containers) lootContainer(s, floor, c.id);
      for (const g of view.groundItems) lootGround(s, floor, g.key);
    }
    expect(s.player.inventory.slots.length).toBe(s.player.inventory.slotCount);
    expect(countItem(s.player.inventory, 'dirty_water')).toBe(0); // dropped: bag was full
  });

  it('there is no slack: wasting scrap on a trade really does cost an upgrade', () => {
    // Scarcity has to survive the fix. Guaranteed scrap is exactly lamp(1) +
    // purifier(2), so spending any of it on 阿林's wire offer must break one.
    const s = createNewGame(1);
    lootMaterialFloors(s);
    const scrap = countItem(s.player.inventory, 'scrap_metal');
    expect(scrap).toBe(3);
    // Pay one scrap away, as the trade does.
    s.player.inventory.slots = s.player.inventory.slots.filter((x) => x.itemId !== 'scrap_metal');
    addItem(s.player.inventory, 'scrap_metal', scrap - 1);
    const built: string[] = [];
    for (const r of RECIPES) if (craft(s, r.id).ok) built.push(r.id);
    expect(built).not.toContain('purifier');
    expect(built).toContain('lamp');
  });
});

describe('no defined item is unobtainable (audit D4)', () => {
  it('every ItemId has at least one source in the world', () => {
    const sources = worldSources();
    const orphans = ITEM_IDS.filter((id) => !sources.has(id));
    expect(orphans, 'these items are defined but can never be obtained').toEqual([]);
  });
});

describe('barter converts resources, it does not create them (audit D6)', () => {
  it('no offer can be taken from an empty inventory', () => {
    // Every offer demands a real payment, so none of them is a fountain. The bag
    // is emptied first: a fresh run starts with rations, which 小周 legitimately
    // accepts.
    for (const n of NPCS) {
      for (const o of n.offers) {
        const s = createNewGame(1);
        s.player.inventory.slots = [];
        const r = tradeOn(s, o);
        expect(r.ok, `${n.name}/${o.id} paid nothing`).toBe(false);
      }
    }
  });

  it('every offer is paid for with something the world can supply', () => {
    const sources = worldSources();
    for (const n of NPCS) {
      for (const o of n.offers) {
        expect(sources.has(o.get.itemId), `${n.name}/${o.id} is paid with unobtainable ${o.get.itemId}`).toBe(true);
      }
    }
  });

  it('no offer feeds itself: following give->get never loops back', () => {
    // A loop would let the player farm one offer forever for unbounded value.
    const byGive = new Map<ItemId, ItemId>();
    for (const n of NPCS) for (const o of n.offers) byGive.set(o.give.itemId, o.get.itemId);
    for (const start of byGive.keys()) {
      const seen = new Set<ItemId>([start]);
      let cur = byGive.get(start);
      while (cur !== undefined) {
        expect(seen.has(cur), `${start} loops back through ${cur}`).toBe(false);
        seen.add(cur);
        cur = byGive.get(cur);
      }
    }
  });
});

describe('the purifier is worth building (audit D6)', () => {
  it('converts the whole carry of dirty water in one use', () => {
    const s = createNewGame(1);
    give(s, [['scrap_metal', 2], ['filter', 1], ['wire', 1]]);
    expect(craft(s, 'purifier').ok).toBe(true);
    const cleanBefore = countItem(s.player.inventory, 'clean_water');
    give(s, [['dirty_water', 4]]);
    const r = purifyWater(s);
    expect(r.ok).toBe(true);
    // A fresh run starts with three bottles, hence the offset.
    expect(countItem(s.player.inventory, 'clean_water')).toBe(cleanBefore + 4);
    expect(countItem(s.player.inventory, 'dirty_water')).toBe(0);
  });

  it('is refused without the upgrade', () => {
    const s = createNewGame(1);
    give(s, [['dirty_water', 2]]);
    expect(purifyWater(s).ok).toBe(false);
    expect(countItem(s.player.inventory, 'dirty_water')).toBe(2);
  });
});

describe('every upgrade changes the game (audit D3)', () => {
  it('reinforced_door lowers the dorm night darkness', () => {
    const plain = createNewGame(1);
    plain.gameMinuteOfDay = NIGHT_START_MINUTE + 1;
    const before = nightOverlayAlpha(plain);
    expect(before).toBeGreaterThan(0);
    give(plain, [['wood', 2], ['tape', 1]]);
    expect(craft(plain, 'reinforced_door').ok).toBe(true);
    const after = nightOverlayAlpha(plain);
    expect(after).toBeLessThan(before);
  });

  it('lamp still lowers it further, so the two are not interchangeable', () => {
    const s = createNewGame(1);
    s.gameMinuteOfDay = NIGHT_START_MINUTE + 1;
    give(s, [['wood', 2], ['tape', 1], ['battery', 1], ['wire', 1], ['scrap_metal', 1]]);
    expect(craft(s, 'reinforced_door').ok).toBe(true);
    const doorOnly = nightOverlayAlpha(s);
    expect(craft(s, 'lamp').ok).toBe(true);
    expect(nightOverlayAlpha(s)).toBeLessThan(doorOnly);
  });
});

describe('sleep follows an explicit rule (new: time/hunger/thirst)', () => {
  const NIGHT_HOURS = 10; // 20:00 -> 06:00

  it('advances to 06:00, restores energy, and charges the night', () => {
    const s = createNewGame(1);
    s.day = 2;
    s.gameMinuteOfDay = 1200; // 20:00
    s.player.energy = 30;
    s.player.hunger = 80;
    s.player.thirst = 80;

    const r = sleep(s);
    expect(r.ok).toBe(true);
    expect(s.day).toBe(3);
    expect(s.gameMinuteOfDay).toBe(360); // 06:00
    expect(s.player.energy).toBe(100); // the point of sleeping

    // The night is not free: resting still metabolises.
    expect(s.player.thirst).toBeLessThan(80);
    expect(s.player.hunger).toBeLessThan(80);
  });

  it('charges the night at the resting rate, not the awake rate', () => {
    const resting = createNewGame(1);
    resting.day = 2;
    resting.gameMinuteOfDay = 1200;
    resting.player.hunger = 100;
    resting.player.thirst = 100;
    sleep(resting);

    // Awake rate over the same 10 hours would cost 2x10 hunger / 3x10 thirst.
    const cfg = createNewGame(1);
    expect(resting.player.thirst).toBeGreaterThan(100 - 3 * NIGHT_HOURS);
    expect(resting.player.hunger).toBeGreaterThan(100 - 2 * NIGHT_HOURS);
    void cfg;
  });

  it('cannot be chained: a second sleep the same night is refused', () => {
    const s = createNewGame(1);
    s.gameMinuteOfDay = 1200;
    expect(sleep(s).ok).toBe(true);
    // It is now 06:00 the next day, far too early to sleep again.
    const second = sleep(s);
    expect(second.ok).toBe(false);
  });

  it('is refused before 20:00 and does not touch the clock', () => {
    const s = createNewGame(1);
    s.gameMinuteOfDay = 1199;
    s.day = 2;
    expect(sleep(s).ok).toBe(false);
    expect(s.day).toBe(2);
    expect(s.gameMinuteOfDay).toBe(1199);
  });

  it('staying awake past 20:00 costs more than sleeping, so going home pays', () => {
    // The reason to return before dark has to be measurable, not asserted. Both
    // players start at 20:00; one goes to bed, one stays out four more hours and
    // then beds down at midnight.
    const home = createNewGame(1);
    home.gameMinuteOfDay = 1200;
    home.player.thirst = 100;
    home.player.hunger = 100;
    sleep(home);

    const out = createNewGame(1);
    out.gameMinuteOfDay = 1200;
    out.player.thirst = 100;
    out.player.hunger = 100;
    // Four real awake hours on a corridor floor, charged at the waking rate.
    for (let i = 0; i < 4; i++) advanceTime(out, 20 * 60 * 1000 / 3);
    expect(out.gameMinuteOfDay).toBeGreaterThanOrEqual(1200);
    sleep(out);

    expect(out.player.thirst).toBeLessThan(home.player.thirst);
    expect(out.player.hunger).toBeLessThan(home.player.hunger);
    // And the wanderer was a risk the whole time, which the numbers do not show.
    expect(out.player.hp).toBeLessThanOrEqual(home.player.hp);
  });
});

describe('night is night', () => {
  it('18:00 onwards and before 06:00 count as night', () => {
    expect(isNight(NIGHT_START_MINUTE)).toBe(true);
    expect(isNight(1200)).toBe(true);
    expect(isNight(1439)).toBe(true);
    expect(isNight(0)).toBe(true);
    expect(isNight(359)).toBe(true);
    expect(isNight(360)).toBe(false);
    expect(isNight(1079)).toBe(false);
  });
});

describe('the seven-day budget closes (new: viability margin)', () => {
  // Sleeping is a free time skip in clock terms but not in metabolic terms, so a
  // day costs 14 awake hours plus a 10-hour night at the resting rate. These
  // numbers are the whole argument that the chapter is survivable, so they are
  // asserted rather than left in a comment. They are playtest-tunable.
  const AWAKE_HOURS = 14; // 06:00 -> 20:00
  const DAYS = 7;

  // Supply is read from the data rather than simulated through a bag: the 12-slot
  // limit is a real constraint the player manages (see the bag test above), and
  // modelling it here would measure the bag, not the world. A guaranteed entry
  // contributes its pinned quantity; a probability roll contributes its
  // expectation, so this is a mean rather than a best case.
  function supply(): { thirst: number; hunger: number } {
    let thirst = GAME_CONFIG.player.thirstStart;
    let hunger = GAME_CONFIG.player.hungerStart;
    const add = (id: ItemId, n: number): void => {
      const e = getItem(id).effect;
      if (e?.stat === 'thirst') thirst += e.amount * n;
      if (e?.stat === 'hunger') hunger += e.amount * n;
    };
    for (const s of GAME_CONFIG.inventory.startingItems) add(s.itemId as ItemId, s.quantity);
    for (const floor of PLAYABLE_FLOORS_V01) {
      const t = FLOOR_TEMPLATES[floor];
      for (const c of t.containers) {
        for (const l of c.loot) {
          // Dirty water is worth nothing until the purifier converts it, and the
          // purifier is on the path, so it counts as clean water here.
          const n = l.guaranteed ? l.min : ((l.min + l.max) / 2) * l.probability;
          add(l.itemId === 'dirty_water' ? 'clean_water' : (l.itemId as ItemId), n);
        }
      }
      for (const g of t.ground) add(g.itemId, g.quantity);
    }
    return { thirst, hunger };
  }

  it('water closes with a thin but positive margin', () => {
    const nightHours = sleepNightMinutes(1200) / 60;
    const need = DAYS * (AWAKE_HOURS * 3 + nightHours * 3 * REST_METABOLISM);
    const have = supply().thirst;
    expect(have).toBeGreaterThan(need);
    // Thin on purpose: the frozen design makes clean water precious in the slum.
    // If this margin ever grows past about a day the chapter stops being a
    // struggle, and the reason to climb stops being urgent.
    expect(have - need).toBeLessThan(3 * 24);
  });

  it('food closes with room to spare', () => {
    const nightHours = sleepNightMinutes(1200) / 60;
    const need = DAYS * (AWAKE_HOURS * 2 + nightHours * 2 * REST_METABOLISM);
    expect(supply().hunger).toBeGreaterThan(need);
  });
});

// Local import kept at the bottom so the trade helper reads next to its uses.
import { trade } from '../systems/TradeSystem';
function tradeOn(state: GameState, offer: Parameters<typeof trade>[1]) {
  return trade(state, offer);
}
