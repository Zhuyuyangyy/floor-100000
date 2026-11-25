import { describe, expect, it } from 'vitest';
import { parseDevEntry } from '../core/devMode';

// The retired v0.1 dorm scene (floor 100000) and the retired day-8 auto-win are
// dev-only fixtures. They must be reachable for testing and unreachable in a
// normal run, which means the gate has to reject anything malformed rather than
// falling back to the fixture.

describe('parseDevEntry', () => {
  it('ignores an empty or absent query', () => {
    expect(parseDevEntry('')).toEqual({ floor: null, legacyWin: false });
    expect(parseDevEntry('?seed=42')).toEqual({ floor: null, legacyWin: false });
  });

  it('accepts the retired dev test floor', () => {
    expect(parseDevEntry('?devfloor=100000')).toEqual({ floor: 100000, legacyWin: false });
  });

  it('rejects a floor that is not a dev test floor', () => {
    // Floor 1 is the real starting floor; there is nothing dev about it.
    expect(parseDevEntry('?devfloor=1').floor).toBeNull();
    expect(parseDevEntry('?devfloor=99999').floor).toBeNull();
  });

  it('rejects a malformed floor instead of guessing', () => {
    expect(parseDevEntry('?devfloor=').floor).toBeNull();
    expect(parseDevEntry('?devfloor=abc').floor).toBeNull();
    expect(parseDevEntry('?devfloor=10.5').floor).toBeNull();
    expect(parseDevEntry('?devfloor=1000000').floor).toBeNull();
    expect(parseDevEntry('?devfloor=-1').floor).toBeNull();
  });

  it('reads the legacy day-8 victory fixture only when explicitly enabled', () => {
    expect(parseDevEntry('?devwin=1').legacyWin).toBe(true);
    expect(parseDevEntry('?devwin=0').legacyWin).toBe(false);
    expect(parseDevEntry('?devwin=true').legacyWin).toBe(false);
    expect(parseDevEntry('?devwin=').legacyWin).toBe(false);
  });

  it('reads both flags together', () => {
    expect(parseDevEntry('?seed=42&devfloor=100000&devwin=1')).toEqual({ floor: 100000, legacyWin: true });
  });
});
