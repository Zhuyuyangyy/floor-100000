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

describe('tryChangeFloor', () => {
  it('descends from 100000 to 99999 and resets to the entry position', () => {
    const s = createNewGame(1);
    s.player.x = 900;
    const r = tryChangeFloor(s, -1);
    expect(r).toEqual({ ok: true, from: 100000, to: 99999 });
    expect(s.currentFloor).toBe(99999);
    expect(s.player.x).toBe(ENTRY_X);
  });

  it('ascends from 99996 toward 100000', () => {
    const s = createNewGame(1);
    s.currentFloor = 99996;
    expect(tryChangeFloor(s, 1)).toEqual({ ok: true, from: 99996, to: 99997 });
    expect(s.currentFloor).toBe(99997);
  });

  it('can traverse the whole range down to 99996 and back to 100000', () => {
    const s = createNewGame(1);
    for (let f = 100000; f > 99996; f--) expect(tryChangeFloor(s, -1).ok).toBe(true);
    expect(s.currentFloor).toBe(99996);
    for (let f = 99996; f < 100000; f++) expect(tryChangeFloor(s, 1).ok).toBe(true);
    expect(s.currentFloor).toBe(100000);
  });

  it('blocks going above the top floor (failure/boundary)', () => {
    const s = createNewGame(1);
    expect(tryChangeFloor(s, 1)).toEqual({ ok: false, reason: 'top' });
    expect(s.currentFloor).toBe(100000);
  });

  it('blocks going below the bottom floor (failure/boundary)', () => {
    const s = createNewGame(1);
    s.currentFloor = 99996;
    expect(tryChangeFloor(s, -1)).toEqual({ ok: false, reason: 'bottom' });
    expect(s.currentFloor).toBe(99996);
  });
});

describe('exit availability', () => {
  it('top floor has no up exit; bottom floor has no down exit', () => {
    expect(hasUpExit(100000)).toBe(false);
    expect(hasDownExit(100000)).toBe(true);
    expect(hasDownExit(99996)).toBe(false);
    expect(hasUpExit(99996)).toBe(true);
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
    s.currentFloor = 99999; // has both up and down exits
    s.player.x = UP_EXIT_X;
    expect(currentInteractionZone(s)).toBe('up');
    s.player.x = DOWN_EXIT_X;
    expect(currentInteractionZone(s)).toBe('down');
    s.player.x = ENTRY_X;
    expect(currentInteractionZone(s)).toBeNull();
  });

  it('reports no up zone at the top floor even at the left end', () => {
    const s = createNewGame(1);
    s.player.x = UP_EXIT_X;
    expect(currentInteractionZone(s)).toBeNull();
  });
});
