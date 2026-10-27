import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { getFloorView, lootContainer, lootGround } from '../systems/LootSystem';
import { craft, purifyWater } from '../systems/CraftingSystem';
import { countItem, useConsumable } from '../systems/InventorySystem';
import { advanceTime, sleep } from '../systems/SurvivalSystem';
import { PLAYABLE_FLOORS_V01 } from '../core/constants';
import type { GameState } from '../core/gameTypes';

// Headless integration sim (docs/03_TASKS.md#p0-09): drives the real survival
// systems over 7 days to prove a viable path exists for the fixed QA seeds.
//
// The v0.1 prototype ended the run on day 8. The frozen design ends it at the
// summit (B8), so the sim now asserts the run is still alive and viable on
// day 8 rather than auto-won.

function advanceGameMinutes(state: GameState, minutes: number): void {
  const stepMs = 250; // advanceTime clamps each call to 250ms = 0.75 game-min
  const steps = Math.ceil(minutes / 0.75);
  for (let i = 0; i < steps; i++) advanceTime(state, stepMs);
}

// Loot water/food + purifier materials first so the 12-slot bag keeps them.
const LOOT_ORDER = [5, 4, 1, 3, 2];

function simulate(seed: number, gather: boolean) {
  const state = createNewGame(seed);
  if (gather) {
    for (const floor of LOOT_ORDER) {
      const view = getFloorView(state, floor);
      for (const c of view.containers) lootContainer(state, floor, c.id);
      for (const g of view.groundItems) lootGround(state, floor, g.key);
    }
    if (craft(state, 'purifier').ok) {
      let guard = 0;
      while (countItem(state.player.inventory, 'dirty_water') > 0 && guard++ < 100) purifyWater(state);
    }
  }
  for (let day = 1; day <= 7 && state.status === 'playing'; day++) {
    for (let h = 0; h < 14 && state.status === 'playing'; h++) {
      advanceGameMinutes(state, 60);
      if (state.player.thirst < 8) useConsumable(state, 'clean_water');
      if (state.player.hunger < 8) {
        if (countItem(state.player.inventory, 'ration_pack') > 0) useConsumable(state, 'ration_pack');
        else useConsumable(state, 'bread');
      }
    }
    if (state.status !== 'playing') break;
    sleep(state);
  }
  return { status: state.status, day: state.day, hp: state.player.hp };
}

describe('7-day survival feasibility (QA seeds)', () => {
  for (const seed of [1, 42, 2026]) {
    it(`seed ${seed} is still alive and viable on day 8`, () => {
      const result = simulate(seed, true);
      // No auto-win: the run simply continues, which is the point — the frozen
      // design ends at the summit, not on a calendar day.
      expect(result.status).toBe('playing');
      expect(result.day).toBe(8);
      expect(result.hp).toBeGreaterThan(0);
    });
  }

  it('a player who gathers nothing dies (loss path + scarcity holds)', () => {
    const result = simulate(42, false);
    expect(result.status).toBe('lost');
    expect(result.hp).toBe(0);
  });
});

describe('all v0.1 floors are defined', () => {
  it('covers every playable floor', () => {
    for (const floor of PLAYABLE_FLOORS_V01) {
      expect(getFloorView(createNewGame(1), floor).floorNumber).toBe(floor);
    }
  });
});
