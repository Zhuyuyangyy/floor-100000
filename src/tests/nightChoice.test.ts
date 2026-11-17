import { describe, expect, it } from 'vitest';
import { createNewGame } from '../core/gameState';
import { deriveSeed } from '../core/rng';
import { getFloorView, lootContainer } from '../systems/LootSystem';
import {
  applyNightTheft,
  currentNightDay,
  hasNightEvent,
  NIGHT_WATCH,
  nightChoiceFor,
  nightChoicePending,
  nightElapsedMinutes,
  nightSafeKey,
  hasNightTheft,
  nightTheftSeenKey,
  nightVisitKey,
  nightWatchEvidenceNote,
  nightWatchWakeNote,
  recordNightChoice,
  recordNightDismissal,
  rollNightTheft,
  rollNightVisit,
  settlePendingVisitOnSleep,
  stealableStacks,
  stepNightWatch,
  unreportedNightTheft,
} from '../systems/NightSystem';

// AG-64：夜晚二选一 + NPC 偷取的纯判定层单测。seeded 同 seed 同结果是硬
// 钉子（docs/02_TECH_SPEC.md §3）；survivalBalance 的每层 guaranteed 水食
// 不许被偷是另一颗——偷取只碰 1 层容器里非 guaranteed 的余粮。

/** 一层储物柜有布料（0.6 概率 roll 中）且今夜造访判定会来的第一个 seed。 */
function seedWithClothAndVisit(): number {
  for (let seed = 1; seed <= 200; seed++) {
    const state = createNewGame(seed);
    if (!rollNightVisit(state, 1)) continue;
    if (stealableStacks(state).some((s) => s.itemId === 'cloth')) return seed;
  }
  throw new Error('no seed with cloth and a night-1 visit');
}

/** 今夜造访会来、但一层柜里没有布料可偷的第一个 seed（空手而归支线）。 */
function seedWithVisitButNoCloth(): number {
  for (let seed = 1; seed <= 200; seed++) {
    const state = createNewGame(seed);
    if (!rollNightVisit(state, 1)) continue;
    if (stealableStacks(state).length === 0) return seed;
  }
  throw new Error('no seed with a visit and an empty pool');
}

const THEFT_SEED = seedWithClothAndVisit();
const EMPTY_SEED = seedWithVisitButNoCloth();

/** 把时钟拨到「入夜 elapsed 分钟」（不跨午夜）。 */
function atNightElapsed(state: ReturnType<typeof createNewGame>, elapsed: number): void {
  state.gameMinuteOfDay = 1080 + elapsed; // 18:00 + elapsed
}

describe('night geometry (AG-64)', () => {
  it('counts elapsed minutes from 18:00, wrapping past midnight', () => {
    expect(nightElapsedMinutes(1080)).toBe(0); // 18:00
    expect(nightElapsedMinutes(1110)).toBe(30); // 18:30
    expect(nightElapsedMinutes(1439)).toBe(359); // 23:59
    expect(nightElapsedMinutes(0)).toBe(360); // 00:00
    expect(nightElapsedMinutes(60)).toBe(420); // 01:00
  });

  it('owns the small hours to the previous day, so a night never changes ID at midnight', () => {
    const evening = createNewGame(7);
    evening.gameMinuteOfDay = 1200; // 20:00
    expect(currentNightDay(evening)).toBe(1);

    const smallHours = createNewGame(7);
    smallHours.day = 2;
    smallHours.gameMinuteOfDay = 60; // 次日 01:00
    expect(currentNightDay(smallHours)).toBe(1); // 仍是第 1 夜

    const day = createNewGame(7);
    day.gameMinuteOfDay = 720; // 正午
    expect(currentNightDay(day)).toBeNull();
  });
});

describe('the night choice markers (AG-64)', () => {
  it('records the choice into visitedFloors[1].localEvents (free save persistence)', () => {
    const state = createNewGame(7);
    atNightElapsed(state, 10);
    recordNightChoice(state, 'scavenge');
    expect(nightChoiceFor(state, 1)).toBe('scavenge');
    expect(nightChoicePending(state)).toBe(false);
    expect(state.visitedFloors[1]?.localEvents).toContain('night-choice:1:scavenge');
  });

  it('a dismissal stops the prompt for the rest of the night', () => {
    const state = createNewGame(7);
    atNightElapsed(state, 10);
    expect(nightChoicePending(state)).toBe(true);
    recordNightDismissal(state);
    expect(nightChoiceFor(state, 1)).toBe('dismissed');
    expect(nightChoicePending(state)).toBe(false);
  });

  it('each night is its own decision — day 2 starts unanswered', () => {
    const state = createNewGame(7);
    atNightElapsed(state, 10);
    recordNightChoice(state, 'watch');
    state.day = 2;
    state.gameMinuteOfDay = 1200;
    expect(nightChoicePending(state)).toBe(true);
    expect(nightChoiceFor(state, 2)).toBeNull();
  });
});

describe('stealable pool respects survivalBalance (AG-64)', () => {
  it('never offers the guaranteed cabinet water, only probability-rolled cloth', () => {
    const state = createNewGame(THEFT_SEED);
    const pool = stealableStacks(state);
    expect(pool.map((s) => s.itemId)).toEqual(['cloth']);
    expect(pool[0].key).toBe('c:cabinet:cloth');
    expect(pool[0].containerLabel).toBe('储物柜');
  });

  it('seed 42 fails the cloth roll — the pool is empty and a thief finds nothing', () => {
    // 与 lootSystem.test.ts 钉的「seed 42 一层储物柜没有布料」同一口径：
    // 概率没 roll 中的东西，小偷也无从偷起。
    expect(stealableStacks(createNewGame(42))).toEqual([]);
  });

  it('items the player already took are not stealable twice', () => {
    const state = createNewGame(THEFT_SEED);
    lootContainer(state, 1, 'cabinet'); // 连 guaranteed 净水一起取走
    expect(stealableStacks(state)).toEqual([]);
  });
});

describe('seeded determinism (AG-64, docs/02_TECH_SPEC.md §3)', () => {
  it('the same (runSeed, night) rolls the same visit, always', () => {
    for (const seed of [1, 2, 7, 42, 2026]) {
      const a = createNewGame(seed);
      const b = createNewGame(seed);
      expect(rollNightVisit(a, 1)).toBe(rollNightVisit(b, 1));
      // 同一 state 反复调不改变结果（判定无内部状态）
      expect(rollNightVisit(a, 1)).toBe(rollNightVisit(a, 1));
      // 换一夜换一个 seed 空间：day 2 与 day 1 的派生不同源
      const day2 = makeRngSameNight(seed, 2);
      expect(typeof day2).toBe('boolean');
    }
  });

  it('the visit rate across seeds tracks the configured chance', () => {
    let visits = 0;
    const n = 2000;
    for (let i = 1; i <= n; i++) {
      // runSeed 用 hash 打散：连续小 seed 的 xorshift 首输出彼此相关（实测 1..1000
      // 会偏到 0.645），打散后才落在 0.55 附近——测的是 chance 真的按配置概率放行。
      const state = createNewGame(deriveSeed('rate-probe', i));
      if (rollNightVisit(state, 1)) visits++;
    }
    // 0.55 ± 0.05：钉住「概率真的从 config 读、不是硬编码」。
    expect(visits / n).toBeGreaterThan(NIGHT_WATCH.theftChance - 0.08);
    expect(visits / n).toBeLessThan(NIGHT_WATCH.theftChance + 0.08);
  });

  it('the same (runSeed, night) steals the same stacks', () => {
    const pool = stealableStacks(createNewGame(THEFT_SEED));
    const a = rollNightTheft(createNewGame(THEFT_SEED), 1, pool);
    const b = rollNightTheft(createNewGame(THEFT_SEED), 1, pool);
    expect(a.stolen.map((s) => s.key)).toEqual(b.stolen.map((s) => s.key));
    expect(a.stolen.length).toBeGreaterThanOrEqual(NIGHT_WATCH.lossMin);
    expect(a.stolen.length).toBeLessThanOrEqual(NIGHT_WATCH.lossMax);
  });

  it('an empty pool steals nothing instead of throwing', () => {
    const roll = rollNightTheft(createNewGame(42), 1, []);
    expect(roll.stolen).toEqual([]);
  });
});

describe('the night-watch state machine (AG-64)', () => {
  it('watch (or no choice, or a dismissal) never arms the theft', () => {
    for (const prep of ['watch', 'none', 'dismissed'] as const) {
      const state = createNewGame(THEFT_SEED);
      state.currentFloor = 2; // 身在外层
      atNightElapsed(state, 10);
      if (prep === 'watch') recordNightChoice(state, 'watch');
      if (prep === 'dismissed') recordNightDismissal(state);
      atNightElapsed(state, NIGHT_WATCH.theftDelayMinutes + NIGHT_WATCH.stealWindowMinutes + 30);
      expect(stepNightWatch(state, false).kind, prep).toBe('none');
      expect((state.visitedFloors[1]?.localEvents ?? []).filter((e) => !e.startsWith('night-choice'))).toEqual([]);
    }
  });

  it('scavenge: nothing before the delay, a visit roll at it, theft after the window', () => {
    const state = createNewGame(THEFT_SEED);
    state.currentFloor = 2;
    atNightElapsed(state, 5);
    recordNightChoice(state, 'scavenge');

    atNightElapsed(state, NIGHT_WATCH.theftDelayMinutes - 1);
    expect(stepNightWatch(state, false).kind).toBe('none');
    expect(hasNightEvent(state, nightVisitKey(1))).toBe(false);

    atNightElapsed(state, NIGHT_WATCH.theftDelayMinutes);
    expect(stepNightWatch(state, false).kind).toBe('visited');
    expect(hasNightEvent(state, nightVisitKey(1))).toBe(true);
    // 一次性：再调不会重 roll
    expect(stepNightWatch(state, false).kind).toBe('none');

    atNightElapsed(state, NIGHT_WATCH.theftDelayMinutes + NIGHT_WATCH.stealWindowMinutes - 1);
    expect(stepNightWatch(state, false).kind).toBe('none'); // 窗口内还来得及

    atNightElapsed(state, NIGHT_WATCH.theftDelayMinutes + NIGHT_WATCH.stealWindowMinutes);
    const step = stepNightWatch(state, false);
    expect(step.kind).toBe('stolen');
    expect(step.details).toBe(`布料×${stealableStacks(createNewGame(THEFT_SEED))[0].quantity}`);
    expect(hasNightTheft(state, 1)).toBe(true);
  });

  it('scavenge: rushing home before the thief lands prevents the theft', () => {
    const state = createNewGame(THEFT_SEED);
    state.currentFloor = 2;
    atNightElapsed(state, 10);
    recordNightChoice(state, 'scavenge');
    atNightElapsed(state, NIGHT_WATCH.theftDelayMinutes);
    expect(stepNightWatch(state, false).kind).toBe('visited');
    atNightElapsed(state, NIGHT_WATCH.theftDelayMinutes + NIGHT_WATCH.stealWindowMinutes);
    expect(stepNightWatch(state, true).kind).toBe('prevented'); // 赶回家了
    expect(hasNightEvent(state, nightSafeKey(1))).toBe(true);
    expect(hasNightTheft(state, 1)).toBe(false);
    expect(unreportedNightTheft(state)).toBeNull();
  });

  it('a theft removes only non-guaranteed stacks from the floor view', () => {
    const state = createNewGame(THEFT_SEED);
    state.currentFloor = 2;
    atNightElapsed(state, 10);
    recordNightChoice(state, 'scavenge');
    atNightElapsed(state, NIGHT_WATCH.theftDelayMinutes);
    stepNightWatch(state, false);
    atNightElapsed(state, NIGHT_WATCH.theftDelayMinutes + NIGHT_WATCH.stealWindowMinutes);
    stepNightWatch(state, false);

    const view = getFloorView(state, 1);
    const cabinet = view.containers.find((c) => c.id === 'cabinet');
    expect(cabinet?.items.map((i) => i.itemId)).toEqual(['clean_water']); // 布料没了，水还在

    // 生存契约没被碰：柜子照旧开出那瓶 guaranteed 净水。
    const took = lootContainer(state, 1, 'cabinet');
    expect(took.took).toEqual([{ itemId: 'clean_water', quantity: 1 }]);
  });

  it('the guaranteed water is never marked stolen, across many seeds', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const state = createNewGame(seed);
      state.currentFloor = 2;
      atNightElapsed(state, 10);
      recordNightChoice(state, 'scavenge');
      atNightElapsed(state, NIGHT_WATCH.theftDelayMinutes);
      stepNightWatch(state, false);
      atNightElapsed(state, NIGHT_WATCH.theftDelayMinutes + NIGHT_WATCH.stealWindowMinutes);
      stepNightWatch(state, false);
      const looted = state.visitedFloors[1]?.lootedItems ?? [];
      expect(looted, `seed ${seed}`).not.toContain('c:cabinet:clean_water');
      for (const key of looted) expect(key.startsWith('g:'), `ground is guaranteed: seed ${seed}`).toBe(false);
    }
  });

  it('a no-visit roll settles the night once and never resolves again', () => {
    // seed 42：造访判定没中（0.55 里没 roll 上）。
    const state = createNewGame(42);
    state.currentFloor = 2;
    atNightElapsed(state, 10);
    recordNightChoice(state, 'scavenge');
    atNightElapsed(state, NIGHT_WATCH.theftDelayMinutes);
    expect(stepNightWatch(state, false).kind).toBe('none'); // 到点判定：没来
    expect(hasNightEvent(state, nightSafeKey(1))).toBe(true);
    atNightElapsed(state, 500);
    expect(stepNightWatch(state, false).kind).toBe('none');
    expect(unreportedNightTheft(state)).toBeNull();
  });
});

describe('evidence and the sleep settle (AG-64)', () => {
  it('the theft evidence is reported once, then stays quiet', () => {
    const state = createNewGame(THEFT_SEED);
    state.currentFloor = 2;
    atNightElapsed(state, 10);
    recordNightChoice(state, 'scavenge');
    atNightElapsed(state, NIGHT_WATCH.theftDelayMinutes);
    stepNightWatch(state, false);
    atNightElapsed(state, NIGHT_WATCH.theftDelayMinutes + NIGHT_WATCH.stealWindowMinutes);
    stepNightWatch(state, false);

    const first = unreportedNightTheft(state);
    expect(first?.details).toBe(`布料×${stealableStacks(createNewGame(THEFT_SEED))[0].quantity}`);
    expect(first?.containerLabel).toBe('储物柜');
    const note = nightWatchEvidenceNote(state);
    expect(note).toBe(`夜里好像有人来过……储物柜被翻过，少了布料×${stealableStacks(createNewGame(THEFT_SEED))[0].quantity}`);
    expect(nightWatchEvidenceNote(state)).toBeNull(); // 看过一次就不再念
    expect(hasNightEvent(state, nightTheftSeenKey(1))).toBe(true);
  });

  it('an empty-handed visit still leaves a trace, with nothing missing', () => {
    const state = createNewGame(EMPTY_SEED); // 造访会来，但一层柜里没布料可偷
    state.currentFloor = 2;
    atNightElapsed(state, 10);
    recordNightChoice(state, 'scavenge');
    atNightElapsed(state, NIGHT_WATCH.theftDelayMinutes);
    stepNightWatch(state, false);
    atNightElapsed(state, NIGHT_WATCH.theftDelayMinutes + NIGHT_WATCH.stealWindowMinutes);
    const step = stepNightWatch(state, false);
    expect(step.kind).toBe('stolen');
    expect(step.details).toBe('');
    expect(nightWatchWakeNote(state)).toBe(' · 夜里好像有人来过……翻过的地方早就空了');
  });

  it('a visit pending when the player sleeps is settled as prevented', () => {
    const state = createNewGame(THEFT_SEED);
    state.currentFloor = 1;
    atNightElapsed(state, 10);
    recordNightChoice(state, 'scavenge');
    atNightElapsed(state, NIGHT_WATCH.theftDelayMinutes);
    expect(stepNightWatch(state, false).kind).toBe('visited');

    expect(settlePendingVisitOnSleep(state)).toBe(true); // 躺进被窝，拦下
    expect(hasNightEvent(state, nightSafeKey(1))).toBe(true);
    expect(settlePendingVisitOnSleep(state)).toBe(false); // 幂等
    // 睡醒台词没有偷窃证据（没被偷），只有平安
    expect(nightWatchWakeNote(state)).toBeNull();
  });

  it('applyNightTheft writes both the keys and the marker exactly once', () => {
    const state = createNewGame(THEFT_SEED);
    const pool = stealableStacks(state);
    const roll = rollNightTheft(state, 1, pool);
    const details = applyNightTheft(state, 1, roll);
    const again = applyNightTheft(state, 1, roll);
    expect(details).toBe(again);
    expect(state.visitedFloors[1].lootedItems.filter((k) => k === 'c:cabinet:cloth')).toHaveLength(1);
  });
});

/** 换一夜仍是一个合法布尔（day 2 与 day 1 派生不同源）。 */
function makeRngSameNight(seed: number, day: number): boolean {
  return rollNightVisit(createNewGame(seed), day);
}
