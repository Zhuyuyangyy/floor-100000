import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { DOWN_EXIT_X, ENTRY_X, FLOOR_WIDTH, UP_EXIT_X } from '../core/constants';
import {
  currentInteractionZone,
  hasDownExit,
  hasUpExit,
  movePlayerX,
  tryChangeFloor,
} from '../systems/FloorSystem';

// Floors are numbered upward: the player starts at floor 1 in the slum and
// climbs toward 100000. "+1" is up, "-1" is down.
describe('tryChangeFloor', () => {
  it('ascends from 1 to 2 and resets to the entry position', () => {
    const s = createNewGame(1);
    s.player.x = 900;
    const r = tryChangeFloor(s, 1);
    expect(r).toEqual({ ok: true, from: 1, to: 2 });
    expect(s.currentFloor).toBe(2);
    expect(s.player.x).toBe(ENTRY_X);
  });

  it('descends from 5 toward 1', () => {
    const s = createNewGame(1);
    s.currentFloor = 5;
    expect(tryChangeFloor(s, -1)).toEqual({ ok: true, from: 5, to: 4 });
    expect(s.currentFloor).toBe(4);
  });

  it('can traverse the whole range up to 5 and back to 1', () => {
    const s = createNewGame(1);
    for (let f = 1; f < 5; f++) expect(tryChangeFloor(s, 1).ok).toBe(true);
    expect(s.currentFloor).toBe(5);
    for (let f = 5; f > 1; f--) expect(tryChangeFloor(s, -1).ok).toBe(true);
    expect(s.currentFloor).toBe(1);
  });

  it('blocks climbing above the top of the playable range (failure/boundary)', () => {
    const s = createNewGame(1);
    s.currentFloor = 5;
    expect(tryChangeFloor(s, 1)).toEqual({ ok: false, reason: 'top' });
    expect(s.currentFloor).toBe(5);
  });

  it('blocks descending below the bottom of the playable range (failure/boundary)', () => {
    const s = createNewGame(1);
    expect(tryChangeFloor(s, -1)).toEqual({ ok: false, reason: 'bottom' });
    expect(s.currentFloor).toBe(1);
  });
});

describe('exit availability', () => {
  it('the bottom floor has no down exit; the top has no up exit', () => {
    expect(hasDownExit(1)).toBe(false);
    expect(hasUpExit(1)).toBe(true);
    expect(hasUpExit(5)).toBe(false);
    expect(hasDownExit(5)).toBe(true);
  });
});

describe('movePlayerX', () => {
  it('moves within bounds and clamps at the corridor edges', () => {
    const s = createNewGame(1);
    s.player.x = 500;
    movePlayerX(s, 50);
    expect(s.player.x).toBe(550);
    movePlayerX(s, -100000);
    expect(s.player.x).toBe(8);
    movePlayerX(s, 100000);
    expect(s.player.x).toBe(FLOOR_WIDTH - 8);
  });
});

describe('currentInteractionZone', () => {
  it('detects standing next to an exit', () => {
    const s = createNewGame(1);
    s.currentFloor = 3; // has both up and down exits
    s.player.x = UP_EXIT_X;
    expect(currentInteractionZone(s)).toBe('up');
    s.player.x = DOWN_EXIT_X;
    expect(currentInteractionZone(s)).toBe('down');
    s.player.x = ENTRY_X;
    expect(currentInteractionZone(s)).toBeNull();
  });

  it('reports no down zone at the bottom floor even at the right end', () => {
    const s = createNewGame(1);
    s.player.x = DOWN_EXIT_X;
    expect(currentInteractionZone(s)).toBeNull();
  });
});
