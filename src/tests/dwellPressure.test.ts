import { describe, expect, it } from 'vitest';

import {
  armNextRoll,
  dwellRollDue,
  ensureDwell,
  freshDwell,
  isDwellExempt,
  rollDwellEvent,
  tickDwell,
} from '../systems/dwellPressure';
import type { DwellStateExt } from '../systems/dwellPressure';
import { GAME_CONFIG } from '../core/config';
import { createNewGame } from '../core/gameState';
import type { DwellState, GameState } from '../core/gameTypes';

// B3-15: the dwell-pressure rules. The system exists to make lingering cost
// something (M1_PLAYTEST's 8-hour idle window, B3-06's zero-reward night), so
// the invariants that matter are: the clock accumulates, moving resets it, the
// same seed replays the same rolls, and the prowler share climbs with each
// roll instead of being flat.
//
// W2 (docs/OVERHAUL_M1.md): from roll 4 on the table also rolls 'scout' — no
// creature, but the next roll's prowler chance gets +0.1 (capped 0.85). The
// scout assertions below pin that: scout exists only from row 3, the mark is
// set on a scout hit, consumed by exactly one boosted roll, and cleared by a
// floor change like the rest of the dwell state.

const INTERVAL = GAME_CONFIG.dwellPressure.rollIntervalGameMinutes;

function stateWith(seed = 42): GameState {
  return createNewGame(seed);
}

describe('dwell tracking', () => {
  it('accumulates minutes on the floor it was created for', () => {
    const d = freshDwell(3);
    tickDwell(d, 3, 30);
    expect(d.minutes).toBe(30);
    tickDwell(d, 3, 15);
    expect(d.minutes).toBe(45);
  });

  it('resets when the player changes floor — moving on is the escape', () => {
    const d = freshDwell(3);
    tickDwell(d, 3, 500);
    armNextRoll(d);
    const moved = tickDwell(d, 4, 10);
    expect(moved.minutes).toBe(10);
    expect(moved.rolls).toBe(0);
    expect(moved.floor).toBe(4);
  });

  it('becomes due exactly at the configured interval', () => {
    const d = freshDwell(3);
    tickDwell(d, 3, INTERVAL - 1);
    expect(dwellRollDue(d)).toBe(false);
    tickDwell(d, 3, 1);
    expect(dwellRollDue(d)).toBe(true);
  });

  it('arms the next roll one interval after the roll that just fired', () => {
    const d = freshDwell(3);
    tickDwell(d, 3, INTERVAL);
    armNextRoll(d);
    expect(d.rolls).toBe(1);
    expect(d.nextRollAt).toBe(INTERVAL + INTERVAL);
    // Still due right after arming? No — the interval is measured from the roll.
    tickDwell(d, 3, 1);
    expect(dwellRollDue(d)).toBe(false);
  });

  it('re-creates a missing tracker for saves written before B3-15', () => {
    const s = stateWith();
    delete s.worldEvents.dwell;
    const d = ensureDwell(s);
    expect(d.floor).toBe(s.currentFloor);
    expect(d.minutes).toBe(0);
    expect(s.worldEvents.dwell).toBe(d);
  });

  it('never applies pressure on the dorm floor', () => {
    expect(isDwellExempt(1)).toBe(true);
    expect(isDwellExempt(2)).toBe(false);
  });
});

describe('dwell rolls', () => {
  it('replays identically for the same seed, day, floor and roll index', () => {
    const s = stateWith(7);
    const d: DwellState = { floor: 3, minutes: 60, nextRollAt: 60, rolls: 2 };
    const a = rollDwellEvent(s, d, 3);
    const b = rollDwellEvent(s, d, 3);
    expect(a).toEqual(b);
  });

  it('gives every outcome a non-empty message', () => {
    const s = stateWith(11);
    for (let rolls = 0; rolls < 6; rolls++) {
      const d: DwellState = { floor: 2, minutes: 60, nextRollAt: 60, rolls };
      const o = rollDwellEvent(s, d, 2);
      if (o.kind !== 'nothing') expect(o.message.length).toBeGreaterThan(0);
    }
  });

  it('escalates: the prowler share never falls as rolls accumulate', () => {
    // Statistical over many seeds — one seed proves nothing about a table.
    // W2: scout only takes share from atmosphere (row 3: 0.25 → 0.10), so the
    // prowler column is untouched and still climbs 0 → 0.25 → 0.45 → 0.60.
    const SAMPLES = 300;
    const rates: number[] = [];
    for (let rolls = 0; rolls < 4; rolls++) {
      let prowlers = 0;
      for (let seed = 1; seed <= SAMPLES; seed++) {
        const s = stateWith(seed);
        const d: DwellState = { floor: 2, minutes: 60, nextRollAt: 60, rolls };
        if (rollDwellEvent(s, d, 2).kind === 'prowler') prowlers++;
      }
      rates.push(prowlers / SAMPLES);
    }
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i], `rates: ${rates.map((r) => r.toFixed(2)).join(', ')}`).toBeGreaterThanOrEqual(rates[i - 1] - 0.03);
    }
    // The first roll must be gentle and the last row must bite.
    expect(rates[0]).toBeLessThan(0.1);
    expect(rates[3]).toBeGreaterThan(0.45);
  });

  it('stays within the table rows even after many rolls', () => {
    // Row index clamps at the last row — a player who never leaves does not
    // roll past the designed ceiling, but the ceiling keeps applying. W2 added
    // 'scout' to the row-3 outcome set, so it belongs in the allowed kinds.
    const s = stateWith(3);
    const d: DwellState = { floor: 4, minutes: 9999, nextRollAt: 9999, rolls: 50 };
    const o = rollDwellEvent(s, d, 4);
    expect(['nothing', 'atmosphere', 'scout', 'prowler']).toContain(o.kind);
  });
});

describe('scout outcome (W2)', () => {
  const SAMPLES = 300;

  it('never rolls scout before the 4th roll, and does from the 4th on', () => {
    // 行 0–2 的 scout 权重为 0：确定性为 0，不需要统计。
    for (const rolls of [0, 1, 2]) {
      for (let seed = 1; seed <= SAMPLES; seed++) {
        const s = stateWith(seed);
        const d: DwellState = { floor: 2, minutes: 60, nextRollAt: 60, rolls };
        expect(rollDwellEvent(s, d, 2).kind, `rolls=${rolls} seed=${seed}`).not.toBe('scout');
      }
    }
    // 第 4 行起 scout = 0.15：300 个固定 seed 下必须能观测到，且落带合理
    // （seed 固定，结果是确定值；落带只是防表被写错）。
    let scouts = 0;
    for (let seed = 1; seed <= SAMPLES; seed++) {
      const s = stateWith(seed);
      const d: DwellState = { floor: 2, minutes: 60, nextRollAt: 60, rolls: 3 };
      if (rollDwellEvent(s, d, 2).kind === 'scout') scouts++;
    }
    expect(scouts).toBeGreaterThan(0);
    expect(scouts / SAMPLES).toBeGreaterThan(0.05);
    expect(scouts / SAMPLES).toBeLessThan(0.3);
  });

  it('arms the next roll: prowler chance +0.1 after a scout, capped at 0.85', () => {
    // 工单规定的验证方式：直接构造 dwell.rolls 与 scoutedLast 标记。
    // 第 4 行 prowler 0.60 + 0.10 = 0.70，封顶 0.85。
    let prowlers = 0;
    let staleMarks = 0; // 非 scout 结果却仍带标记的次数——必须为 0（一次性消费）
    let rearmed = 0; // 加成 roll 又抽中 scout 的次数——标记应重新置上
    for (let seed = 1; seed <= SAMPLES; seed++) {
      const s = stateWith(seed);
      const d: DwellStateExt = { floor: 2, minutes: 60, nextRollAt: 60, rolls: 3, scoutedLast: true };
      const o = rollDwellEvent(s, d, 2);
      if (o.kind === 'prowler') prowlers++;
      if (o.kind === 'scout') {
        rearmed++;
        expect(d.scoutedLast).toBe(true);
      } else if (d.scoutedLast === true) {
        staleMarks++;
      }
    }
    expect(prowlers / SAMPLES).toBeGreaterThan(0.6); // 加成生效（表值 0.70）
    expect(prowlers / SAMPLES).toBeLessThanOrEqual(0.85); // 封顶 0.85
    expect(staleMarks).toBe(0); // 一次 scout 只买一个加成 roll
    expect(rearmed).toBeGreaterThan(0); // scout 可以连锁（新的一眼重新武装）
  });

  it('sets the mark on a scout hit and clears it when the boosted prowler fires', () => {
    // 找一个让第 4 次 roll 出 scout 的 seed：确定性搜索，不是概率碰运气。
    let scoutDwell: DwellStateExt | null = null;
    for (let seed = 1; seed <= 5000 && !scoutDwell; seed++) {
      const s = stateWith(seed);
      const d: DwellStateExt = { floor: 2, minutes: 60, nextRollAt: 60, rolls: 3 };
      if (rollDwellEvent(s, d, 2).kind === 'scout') scoutDwell = d;
    }
    expect(scoutDwell).not.toBeNull();
    expect(scoutDwell!.scoutedLast).toBe(true);

    // 带着标记再 roll：prowler 命中时标记必须被消费掉。
    let boostedDwell: DwellStateExt | null = null;
    for (let seed = 1; seed <= 5000 && !boostedDwell; seed++) {
      const s = stateWith(seed);
      const d: DwellStateExt = { floor: 2, minutes: 60, nextRollAt: 60, rolls: 3, scoutedLast: true };
      if (rollDwellEvent(s, d, 2).kind === 'prowler') boostedDwell = d;
    }
    expect(boostedDwell).not.toBeNull();
    expect(boostedDwell!.scoutedLast).not.toBe(true);
  });

  it('a floor change clears the scout mark with the rest of the dwell state', () => {
    const d: DwellStateExt = { floor: 2, minutes: 60, nextRollAt: 60, rolls: 3, scoutedLast: true };
    tickDwell(d, 3, 10);
    expect(d.scoutedLast).not.toBe(true);
    expect(d.rolls).toBe(0);
  });

  it('gives scout outcomes a non-empty message', () => {
    let sawScout = false;
    for (let seed = 1; seed <= 5000 && !sawScout; seed++) {
      const s = stateWith(seed);
      const d: DwellState = { floor: 2, minutes: 60, nextRollAt: 60, rolls: 3 };
      const o = rollDwellEvent(s, d, 2);
      if (o.kind === 'scout') {
        sawScout = true;
        expect(o.message.length).toBeGreaterThan(0);
      }
    }
    expect(sawScout).toBe(true);
  });
});
