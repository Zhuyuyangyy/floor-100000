import type { Page } from '@playwright/test';
import { ALIN_REPAIR_GATE_FLAG } from '../src/data/floorGates';

/**
 * Generic floor/gameplay E2E cases predate the story gate and test unrelated
 * systems. Mark those runs as a legacy save that already passed the gate;
 * dedicated AI-NPC cases exercise the real locked-and-repaired progression.
 */
export async function markAlinGateOpenForUnrelatedTraversal(page: Page): Promise<void> {
  await page.evaluate((gateFlag) => {
    type StateProbe = { flags?: Record<string, number> };
    const state = (window as unknown as {
      __PHASER_SESSION__?: { getState: () => StateProbe | null };
    }).__PHASER_SESSION__?.getState();
    if (!state) throw new Error('missing game state for gate fixture');
    state.flags = { ...state.flags, [gateFlag]: 1 };
  }, ALIN_REPAIR_GATE_FLAG);
}
