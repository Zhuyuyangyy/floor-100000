import { describe, expect, it } from 'vitest';

import {
  TUTORIAL_MOVE_TARGET_PX,
  TUTORIAL_PROGRESS_KEY,
  TUTORIAL_SKIPPED_KEY,
  TUTORIAL_STATS_HOLD_MS,
  TUTORIAL_STEP_COUNT,
  freshTutorial,
  hasOpenedAnyContainer,
  loadTutorial,
  nearestUnopenedContainer,
  saveTutorial,
  skipTutorial,
  tickTutorial,
  tutorialActive,
  tutorialHighlight,
  tutorialHintVisible,
  tutorialYieldsToWorld,
  type TutorialSignals,
  type TutorialState,
  type TutorialStorage,
  type TutorialWorld,
} from '../systems/TutorialSystem';
import {
  TUTORIAL_DONE_LINE,
  TUTORIAL_OPENING_LINE,
  TUTORIAL_SKIP_LABEL,
  TUTORIAL_SKIP_LINE,
  TUTORIAL_STEPS,
  WORLD_DEFAULT_HINT,
} from '../data/tutorial';
import { BED_X, CRAFT_X, STARTING_FLOOR, UP_EXIT_X } from '../core/constants';
import { HUD_LAYOUT } from '../render/hudLayout';

// AG-73：教程的纯逻辑。node 环境——TutorialSystem 不碰 Phaser/DOM，
// localStorage 用 Map 假件代替（场景才传真的）。

function fakeStorage(seed: Record<string, string> = {}): TutorialStorage & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

const DAY_MORNING = 8 * 60; // 08:00，白昼
const NIGHT = 20 * 60; // 20:00，入夜

const sig = (over: Partial<TutorialSignals> = {}): TutorialSignals => ({
  dx: 0,
  hasOpenedContainer: false,
  craftingOpen: false,
  currentFloor: STARTING_FLOOR,
  minuteOfDay: DAY_MORNING,
  slept: false,
  ...over,
});

const world = (over: Partial<TutorialWorld> = {}): TutorialWorld => ({
  playerX: 640,
  currentFloor: STARTING_FLOOR,
  containers: [{ id: 'cabinet', x: 160 }],
  openedIds: [],
  ...over,
});

/** 把教程从第 0 步推到第 step 步（前面的步都喂满足条件）。 */
function atStep(step: number, now = 1000): TutorialState {
  let s = freshTutorial(now);
  const chain: TutorialSignals[] = [
    sig({ dx: TUTORIAL_MOVE_TARGET_PX }),
    sig({ hasOpenedContainer: true }),
    sig(),
    sig({ craftingOpen: true }),
    sig({ currentFloor: STARTING_FLOOR + 1 }),
    sig({ slept: true }),
  ];
  for (let i = 0; i < step; i++) {
    // 第 3 步（index 2）要等满 3 秒，时钟单独拨。
    const result = tickTutorial(s, { signals: chain[i], now: i === 2 ? now + TUTORIAL_STATS_HOLD_MS : now });
    s = result.state;
  }
  return s;
}

describe('AG-73 tutorial copy', () => {
  it('is six steps in the taught order, each with a short hint', () => {
    expect(TUTORIAL_STEPS).toHaveLength(6);
    expect(TUTORIAL_STEPS.map((s) => s.id)).toEqual(['move', 'loot', 'stats', 'craft', 'stairs', 'bed']);
    for (const step of TUTORIAL_STEPS) {
      expect(step.hint.length, `${step.id} hint`).toBeGreaterThan(0);
      // contextual 槽可用宽度 532px（20px GameSans）：一句短话，不写小作文。
      expect(step.hint.length, `${step.id} hint`).toBeLessThanOrEqual(30);
    }
  });

  it('keeps the shared default-footer string in sync with the world chain', () => {
    expect(WORLD_DEFAULT_HINT).toBe('A/D 或 ←/→ 移动 · E 交互');
    expect(TUTORIAL_OPENING_LINE).toContain('100000 层');
    expect(TUTORIAL_DONE_LINE).toContain('你已掌握基本生存');
    expect(TUTORIAL_SKIP_LABEL).toBe('跳过教程');
    expect(TUTORIAL_SKIP_LINE).toContain('跳过');
  });
});

describe('AG-73 tutorial advancement', () => {
  it('starts at step 0 and is active', () => {
    const s = freshTutorial(1000);
    expect(s.step).toBe(0);
    expect(tutorialActive(s)).toBe(true);
  });

  it('step 0 (move) needs 200px of position change', () => {
    const s = freshTutorial(1000);
    const early = tickTutorial(s, { signals: sig({ dx: TUTORIAL_MOVE_TARGET_PX - 1 }), now: 1000 });
    expect(early.state.step).toBe(0);
    expect(early.advanced).toBe(false);
    const late = tickTutorial(early.state, { signals: sig({ dx: 1 }), now: 1000 });
    expect(late.state.step).toBe(1);
    expect(late.advanced).toBe(true);
    expect(late.completed).toBe(false);
  });

  it('only ever advances the CURRENT step', () => {
    // 停在移动步时，后面的条件全满足也不跳步。
    const s = freshTutorial(1000);
    const r = tickTutorial(s, {
      signals: sig({ hasOpenedContainer: true, craftingOpen: true, currentFloor: 9, slept: true, minuteOfDay: NIGHT }),
      now: 1000,
    });
    expect(r.state.step).toBe(0);
  });

  it('step 1 (loot) completes on the first opened container', () => {
    const s = atStep(1);
    const r = tickTutorial(s, { signals: sig({ hasOpenedContainer: true }), now: 2000 });
    expect(r.state.step).toBe(2);
  });

  it('any floor\'s opened container counts, an empty visit does not', () => {
    const emptyVisit = { openedContainers: [], lootedItems: [], unlockedDoors: [], localEvents: [] };
    expect(hasOpenedAnyContainer({ 1: emptyVisit, 2: emptyVisit })).toBe(false);
    expect(hasOpenedAnyContainer({ 1: emptyVisit, 2: { ...emptyVisit, openedContainers: ['shelf'] } })).toBe(true);
  });

  it('step 2 (stats) holds three seconds, then lets go', () => {
    const s = atStep(2);
    const early = tickTutorial(s, { signals: sig(), now: s.stepSince + TUTORIAL_STATS_HOLD_MS - 1 });
    expect(early.state.step).toBe(2);
    const late = tickTutorial(s, { signals: sig(), now: s.stepSince + TUTORIAL_STATS_HOLD_MS });
    expect(late.state.step).toBe(3);
  });

  it('step 3 (craft) completes when the panel has been open', () => {
    const s = atStep(3);
    expect(tickTutorial(s, { signals: sig(), now: 3000 }).state.step).toBe(3);
    expect(tickTutorial(s, { signals: sig({ craftingOpen: true }), now: 3000 }).state.step).toBe(4);
  });

  it('step 4 (stairs) completes on reaching floor 2 or beyond', () => {
    const s = atStep(4);
    expect(tickTutorial(s, { signals: sig(), now: 4000 }).state.step).toBe(4);
    expect(tickTutorial(s, { signals: sig({ currentFloor: STARTING_FLOOR + 1 }), now: 4000 }).state.step).toBe(5);
  });

  it('step 5 (bed) completes on sleep or on nightfall', () => {
    const s = atStep(5);
    expect(tickTutorial(s, { signals: sig(), now: 5000 }).state.step).toBe(5);
    const slept = tickTutorial(s, { signals: sig({ slept: true }), now: 5000 });
    expect(slept.state.step).toBe(TUTORIAL_STEP_COUNT);
    expect(slept.completed).toBe(true);
    const night = tickTutorial(s, { signals: sig({ minuteOfDay: NIGHT }), now: 5000 });
    expect(night.state.step).toBe(TUTORIAL_STEP_COUNT);
    expect(night.completed).toBe(true);
  });

  it('finishing all six deactivates the tutorial and reports completion once', () => {
    const s = atStep(5);
    const done = tickTutorial(s, { signals: sig({ minuteOfDay: NIGHT }), now: 6000 });
    expect(done.state.step).toBe(6);
    expect(tutorialActive(done.state)).toBe(false);
    const after = tickTutorial(done.state, { signals: sig({ minuteOfDay: NIGHT }), now: 7000 });
    expect(after.advanced).toBe(false);
    expect(after.completed).toBe(false);
  });

  it('never mutates the state it was given', () => {
    const s = atStep(0);
    const snapshot = { ...s };
    tickTutorial(s, { signals: sig({ dx: 400 }), now: 1000 });
    expect(s).toEqual(snapshot);
  });
});

describe('AG-73 tutorial persistence', () => {
  it('round-trips progress through storage', () => {
    const storage = fakeStorage();
    saveTutorial(atStep(3), storage);
    expect(storage.map.get(TUTORIAL_PROGRESS_KEY)).toBe('3');
    expect(loadTutorial(storage, 1000).step).toBe(3);
  });

  it('the skipped key wins over progress and ends the tutorial', () => {
    const storage = fakeStorage({ [TUTORIAL_PROGRESS_KEY]: '2', [TUTORIAL_SKIPPED_KEY]: '1' });
    const s = loadTutorial(storage, 1000);
    expect(s.skipped).toBe(true);
    expect(tutorialActive(s)).toBe(false);
  });

  it('repairs junk values instead of trusting them', () => {
    expect(loadTutorial(fakeStorage({ [TUTORIAL_PROGRESS_KEY]: 'abc' }), 1000).step).toBe(0);
    expect(loadTutorial(fakeStorage({ [TUTORIAL_PROGRESS_KEY]: '-5' }), 1000).step).toBe(0);
    expect(loadTutorial(fakeStorage({ [TUTORIAL_PROGRESS_KEY]: '99' }), 1000).step).toBe(TUTORIAL_STEP_COUNT);
  });

  it('a dead storage reads as a fresh tutorial and never throws', () => {
    const dead: TutorialStorage = {
      getItem() {
        throw new Error('private mode');
      },
      setItem() {
        throw new Error('private mode');
      },
      removeItem() {
        throw new Error('private mode');
      },
    };
    const s = loadTutorial(dead, 1000);
    expect(s.step).toBe(0);
    expect(s.skipped).toBe(false);
    expect(() => saveTutorial(s, dead)).not.toThrow();
  });

  it('skipping writes the flag, drops progress and sticks', () => {
    const storage = fakeStorage({ [TUTORIAL_PROGRESS_KEY]: '4' });
    const skipped = skipTutorial(atStep(4), storage);
    expect(skipped.skipped).toBe(true);
    expect(tutorialActive(skipped)).toBe(false);
    expect(storage.map.has(TUTORIAL_PROGRESS_KEY)).toBe(false);
    expect(storage.map.get(TUTORIAL_SKIPPED_KEY)).toBe('1');
    // 刷新/重开/继续：读出来还是跳过态。
    expect(loadTutorial(storage, 2000).skipped).toBe(true);
  });
});

describe('AG-73 tutorial contextual hint', () => {
  it('stays quiet for a finished or skipped tutorial', () => {
    expect(tutorialHintVisible(atStep(6), world())).toBe(false);
    const skipped = skipTutorial(atStep(2), fakeStorage());
    expect(tutorialHintVisible(skipped, world())).toBe(false);
  });

  it('speaks for the steps without a world target', () => {
    expect(tutorialHintVisible(atStep(0), world())).toBe(true); // move
    expect(tutorialHintVisible(atStep(2), world())).toBe(true); // stats
    expect(tutorialHintVisible(atStep(3), world())).toBe(true); // craft
    expect(tutorialHintVisible(atStep(5), world())).toBe(true); // bed
  });

  it('loot only speaks near an unopened container', () => {
    const s = atStep(1);
    expect(tutorialHintVisible(s, world({ playerX: 160 }))).toBe(true);
    expect(tutorialHintVisible(s, world({ playerX: 360 }))).toBe(true); // 200px 半径内
    expect(tutorialHintVisible(s, world({ playerX: 361 }))).toBe(false);
    expect(tutorialHintVisible(s, world({ playerX: 160, openedIds: ['cabinet'] }))).toBe(false);
    expect(tutorialHintVisible(s, world({ containers: [] }))).toBe(false);
  });

  it('stairs only speaks on the floor the stairs are on', () => {
    const s = atStep(4);
    expect(tutorialHintVisible(s, world({ currentFloor: STARTING_FLOOR }))).toBe(true);
    expect(tutorialHintVisible(s, world({ currentFloor: STARTING_FLOOR + 1 }))).toBe(false);
  });

  it('picks the nearest unopened container within range', () => {
    const w = world({ playerX: 300, containers: [{ id: 'a', x: 200 }, { id: 'b', x: 460 }, { id: 'c', x: 320 }], openedIds: ['a'] });
    expect(nearestUnopenedContainer(w, 200)?.x).toBe(320);
    expect(nearestUnopenedContainer(w, 10)).toBeNull(); // 最近的没开的柜也差 20px
  });
});

describe('AG-73 tutorial yields to the world only for the same action', () => {
  it('move and stats never yield: their lesson is not an E interaction', () => {
    // 出生点 640 压着一张室友床，世界脚注是「按 E 搜刮床铺」——教程该盖住它。
    expect(tutorialYieldsToWorld(atStep(0), world({ playerX: 640 }))).toBe(false);
    expect(tutorialYieldsToWorld(atStep(2), world({ playerX: 640 }))).toBe(false);
  });

  it('loot yields while an unopened container is in reach', () => {
    const s = atStep(1);
    expect(tutorialYieldsToWorld(s, world({ playerX: 160 }))).toBe(true);
    expect(tutorialYieldsToWorld(s, world({ playerX: 900 }))).toBe(false);
    expect(tutorialYieldsToWorld(s, world({ playerX: 160, openedIds: ['cabinet'] }))).toBe(false);
  });

  it('craft / stairs / bed yield only beside their own furniture on floor 1', () => {
    expect(tutorialYieldsToWorld(atStep(3), world({ playerX: CRAFT_X }))).toBe(true);
    expect(tutorialYieldsToWorld(atStep(3), world({ playerX: 900 }))).toBe(false);
    expect(tutorialYieldsToWorld(atStep(3), world({ playerX: CRAFT_X, currentFloor: STARTING_FLOOR + 1 }))).toBe(false);

    expect(tutorialYieldsToWorld(atStep(4), world({ playerX: UP_EXIT_X }))).toBe(true);
    expect(tutorialYieldsToWorld(atStep(4), world({ playerX: 300 }))).toBe(false);
    expect(tutorialYieldsToWorld(atStep(4), world({ playerX: UP_EXIT_X, currentFloor: STARTING_FLOOR + 1 }))).toBe(false);

    expect(tutorialYieldsToWorld(atStep(5), world({ playerX: BED_X }))).toBe(true);
    expect(tutorialYieldsToWorld(atStep(5), world({ playerX: 900 }))).toBe(false);
    expect(tutorialYieldsToWorld(atStep(5), world({ playerX: BED_X, currentFloor: STARTING_FLOOR + 1 }))).toBe(false);
  });

  it('a finished or skipped tutorial never yields (it never speaks)', () => {
    expect(tutorialYieldsToWorld(atStep(6), world({ playerX: 160 }))).toBe(false);
    expect(tutorialYieldsToWorld(skipTutorial(atStep(1), fakeStorage()), world({ playerX: 160 }))).toBe(false);
  });
});

describe('AG-73 tutorial highlight', () => {
  it('move has no target object', () => {
    expect(tutorialHighlight(atStep(0), world())).toBeNull();
  });

  it('loot boxes the nearest unopened container on this floor', () => {
    const box = tutorialHighlight(atStep(1), world({ playerX: 900 }));
    expect(box).not.toBeNull();
    expect(box!.space).toBe('world');
    if (box!.space !== 'world') return;
    expect(box!.x + box!.w / 2).toBe(160); // 柜子在哪框哪
    expect(box!.y).toBe(64);
    expect(box!.h).toBe(84);
  });

  it('stats boxes the four HUD rings in screen space', () => {
    const box = tutorialHighlight(atStep(2), world());
    expect(box!.space).toBe('hud');
    if (box!.space !== 'hud') return;
    const pad = HUD_LAYOUT.ringR + 6;
    expect(box!.x).toBe(HUD_LAYOUT.statX - pad);
    expect(box!.x + box!.w).toBe(HUD_LAYOUT.statX + 3 * HUD_LAYOUT.statPitch + pad);
    expect(box!.y).toBeGreaterThanOrEqual(2); // 不出画布顶
  });

  it('craft / stairs / bed box their furniture, and only on floor 1', () => {
    const craft = tutorialHighlight(atStep(3), world({ currentFloor: STARTING_FLOOR }));
    expect(craft!.space).toBe('world');
    if (craft!.space === 'world') expect(craft!.x + craft!.w / 2).toBe(CRAFT_X);
    expect(tutorialHighlight(atStep(3), world({ currentFloor: STARTING_FLOOR + 1 }))).toBeNull();

    const stairs = tutorialHighlight(atStep(4), world({ currentFloor: STARTING_FLOOR }));
    if (stairs!.space === 'world') expect(stairs!.x + stairs!.w / 2).toBe(UP_EXIT_X);
    expect(tutorialHighlight(atStep(4), world({ currentFloor: STARTING_FLOOR + 1 }))).toBeNull();

    const bed = tutorialHighlight(atStep(5), world({ currentFloor: STARTING_FLOOR }));
    if (bed!.space === 'world') expect(bed!.x + bed!.w / 2).toBe(BED_X);
    expect(tutorialHighlight(atStep(5), world({ currentFloor: STARTING_FLOOR + 1 }))).toBeNull();
  });

  it('a finished tutorial highlights nothing', () => {
    expect(tutorialHighlight(atStep(6), world())).toBeNull();
  });
});
