import type { Page } from '@playwright/test';
import { ALIN_REPAIR_GATE_FLAG } from '../src/data/floorGates';
import { FLAG_CHAPTER1_CLEARED } from '../src/systems/WorldFlags';

/**
 * Generic floor/gameplay E2E cases predate the story gate and test unrelated
 * systems. Mark those runs like saves that already passed the gate and saw the
 * one-time chapter card. A route that covers the card can opt in to seeing it.
 */
export async function markAlinGateOpenForUnrelatedTraversal(
  page: Page,
  { showChapterCard = false } = {},
): Promise<void> {
  await page.evaluate(({ gateFlag, chapterFlag, showChapterCard }) => {
    type StateProbe = { flags?: Record<string, number> };
    const w = window as unknown as {
      __PHASER_SESSION__?: { getState: () => StateProbe | null };
      // 生产构建（?debug=1）下 getState() 返回深拷贝快照，写它不会回到游戏。
      // 这个夹具同时被 dev 套件（e2e/）和「生产形态」套件（e2e-live/）使用，
      // 所以优先走显式变异入口，dev 没有该入口时退回直接写活对象。
      __PHASER_TEST_MUTATE__?: (mutator: (state: StateProbe) => void) => void;
    };
    const apply = (state: StateProbe | null | undefined): void => {
      if (!state) throw new Error('missing game state for gate fixture');
      state.flags = { ...state.flags, [gateFlag]: 1 };
      if (!showChapterCard) state.flags[chapterFlag] = 1;
    };
    if (w.__PHASER_TEST_MUTATE__) {
      w.__PHASER_TEST_MUTATE__(apply);
      return;
    }
    apply(w.__PHASER_SESSION__?.getState());
  }, { gateFlag: ALIN_REPAIR_GATE_FLAG, chapterFlag: FLAG_CHAPTER1_CLEARED, showChapterCard });
}
