import type { Frame, Page } from '@playwright/test';

// Shared harness for the A9 golden-route / adversarial specs.
//
// Two shapes of "the game" exist and both must be drivable with the same code:
//   - local dev server: the game is the page itself (frame === page)
//   - public deployment: the game lives in an iframe the portal mounts
//     (frame !== page; keyboard events still go to the page because the
//      portal forwards focus into the iframe once the canvas is clicked)
//
// So every helper takes a target that carries both, and never mixes them up.
//
// RED LINE: nothing here writes game state. The only mutations are real key
// presses. State is read through the read-only snapshot API
// (`__PHASER_SESSION__.getState()`) and through scene getters.

export interface GameTarget {
  /** Where keyboard events are delivered. */
  readonly page: Page;
  /** Where the Phaser scene and the game state live. */
  readonly frame: Page | Frame;
}

export interface GameStateSnapshot {
  currentFloor: number;
  day: number;
  gameMinuteOfDay: number;
  player: { x: number; inventory: { slots: Array<{ itemId: string; quantity: number; meta?: Record<string, string> }> } };
  npcStates: Record<string, string>;
  flags?: Record<string, number>;
  visitedFloors?: Record<string, { openedContainers: string[] }>;
}

export interface NpcSnapshot {
  trust: number | null;
  memoryCount: number;
  inventory: string[];
}

export interface AlinRepairResult {
  status: string;
  decisionSource: string;
  attempts: number;
  validation: { accepted: boolean; reason?: string; detailCode?: string } | null;
  proposal: unknown;
  execution: { status: string } | null;
  feedback: Array<{ attempt: number; outcome: string }>;
  beforeHash: string;
  afterHash: string;
  reason: string;
}

/** Wait until the given Phaser scene is actually running. */
export async function waitForScene(target: GameTarget, key: string, timeout = 30_000): Promise<void> {
  await target.frame.waitForFunction(
    (k) => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === k);
    },
    key,
    { timeout },
  );
}

/**
 * Walk the real menu into a run: title -> character pick -> game.
 *
 * Every step is a key press, exactly what a judge does. The pick screen can
 * swallow the first Enter (it reports active before create() binds its keys),
 * so Enter is repeated until the game scene is up.
 */
export async function startGame(target: GameTarget, seed: number, query = ''): Promise<void> {
  await target.page.goto(`/?seed=${seed}${query}`);
  await startRun(target);
}

/** Same as startGame but assumes the title menu is already on screen. */
export async function startRun(target: GameTarget): Promise<void> {
  await waitForScene(target, 'Menu');
  await target.frame.locator('canvas').first().click({ position: { x: 10, y: 10 } });
  await target.page.keyboard.press('Enter');
  await waitForScene(target, 'MetaSelect');
  for (let i = 0; i < 6; i += 1) {
    await target.page.keyboard.press('Enter');
    const started = await target.frame
      .waitForFunction(
        () => {
          const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
          return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
        },
        undefined,
        { timeout: 2500 },
      )
      .then(() => true)
      .catch(() => false);
    if (started) break;
  }
  await waitForScene(target, 'Game');
  await target.page.waitForTimeout(800);
}

/** Every visible text in the given scene, in draw order. */
export async function visibleTexts(target: GameTarget, sceneKey = 'Game'): Promise<string[]> {
  return target.frame.evaluate((key) => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean }> } } | null } } }).__PHASER_GAME__;
    const list = g?.scene.getScene(key)?.children.list ?? [];
    return list
      .filter((o) => o.type === 'Text' && o.visible)
      .map((o) => (o.text ?? '').trim())
      .filter((t) => t.length > 0);
  }, sceneKey);
}

/** The dialogue's option list, in the order the player sees them. */
export async function dialogueOptions(target: GameTarget): Promise<string[]> {
  return target.frame.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { dialogueOptions?: Array<{ text?: string }> } | null } } }).__PHASER_GAME__;
    return (g?.scene.getScene('Game')?.dialogueOptions ?? []).map((o) => (o.text ?? '').trim());
  });
}

/** The line under the NPC name — the player's feedback surface. */
export async function dialogueMessage(target: GameTarget): Promise<string> {
  return target.frame.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { dialogueMessage?: { text?: string } } | null } } }).__PHASER_GAME__;
    return g?.scene.getScene('Game')?.dialogueMessage?.text ?? '';
  });
}

/** The provenance label under the NPC name. Must never claim 'model' wrongly. */
export async function dialogueSourceLabel(target: GameTarget): Promise<string> {
  return target.frame.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { dialogueSource?: { text?: string } } | null } } }).__PHASER_GAME__;
    return g?.scene.getScene('Game')?.dialogueSource?.text ?? '';
  });
}

/** Read a private scene field (diagnostics only, never a mutation). */
export async function sceneProp<T = unknown>(target: GameTarget, name: string): Promise<T | null> {
  return target.frame.evaluate((n) => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => Record<string, unknown> | null } } }).__PHASER_GAME__;
    const value = g?.scene.getScene('Game')?.[n];
    return value === undefined ? null : (value as T);
  }, name) as Promise<T | null>;
}

/** The x of a world label (NPC names, container labels, stair signs). */
export async function labelX(target: GameTarget, label: string): Promise<number | null> {
  return target.frame.evaluate((needle) => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean; x: number }> } } | null } } }).__PHASER_GAME__;
    const list = g?.scene.getScene('Game')?.children.list ?? [];
    const hit = list.find((o) => o.type === 'Text' && o.visible && (o.text ?? '').trim().startsWith(needle));
    return hit ? Math.round(hit.x) : null;
  }, label);
}

export async function readState(target: GameTarget): Promise<GameStateSnapshot | null> {
  return target.frame.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => GameStateSnapshot | null } }).__PHASER_SESSION__?.getState();
    return s ?? null;
  });
}

/** Parse one NPC's persisted blob out of the state snapshot. */
export async function readNpc(target: GameTarget, npcId: string): Promise<NpcSnapshot | null> {
  return target.frame.evaluate((id) => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { npcStates?: Record<string, string> } | null } }).__PHASER_SESSION__?.getState();
    const raw = s?.npcStates?.[id];
    if (!raw) return null;
    try {
      const npc = JSON.parse(raw) as {
        relationship?: { player?: number };
        memory?: unknown[];
        competitionInventory?: Array<{ itemId: string; quantity: number }>;
      };
      return {
        trust: npc.relationship?.player ?? null,
        memoryCount: npc.memory?.length ?? 0,
        inventory: (npc.competitionInventory ?? []).map((x) => `${x.itemId}x${x.quantity}`),
      };
    } catch {
      return null;
    }
  }, npcId);
}

export function itemQuantity(state: GameStateSnapshot | null, itemId: string): number {
  return state?.player.inventory.slots.find((stack) => stack.itemId === itemId)?.quantity ?? 0;
}

/** Player x, used to steer the walker. */
export async function playerX(target: GameTarget): Promise<number> {
  return target.frame.evaluate(() => Math.round((window as unknown as { __PHASER_SESSION__?: { getState: () => { player?: { x?: number } } | null } }).__PHASER_SESSION__?.getState()?.player?.x ?? 0));
}

/** Hold the arrow key until the player is close to `targetX`. Real movement only. */
export async function walkTo(target: GameTarget, targetX: number, timeout = 30_000): Promise<number> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const current = await playerX(target);
    if (Math.abs(current - targetX) <= 10) break;
    const key = current < targetX ? 'ArrowRight' : 'ArrowLeft';
    await target.page.keyboard.down(key);
    await target.page.waitForTimeout(100);
    await target.page.keyboard.up(key);
    await target.page.waitForTimeout(60);
  }
  await target.page.keyboard.up('ArrowRight').catch(() => undefined);
  await target.page.keyboard.up('ArrowLeft').catch(() => undefined);
  await target.page.waitForTimeout(150);
  return playerX(target);
}

/**
 * Move the dialogue cursor onto `label` with real arrow keys.
 *
 * The dialogue clamps the cursor at both ends (no wraparound), so the number
 * of presses is computed from the scene's own selected index.
 */
export async function pickOption(target: GameTarget, label: string): Promise<void> {
  const all = await dialogueOptions(target);
  const index = all.indexOf(label);
  if (index < 0) throw new Error(`dialogue option not present: ${label} in ${JSON.stringify(all)}`);
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const current = await target.frame.evaluate(
      () => (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { dialogue?: { selected?: number } } | null } } }).__PHASER_GAME__?.scene.getScene('Game')?.dialogue?.selected ?? -1,
    );
    if (current === index) return;
    await target.page.keyboard.press(current < index ? 'ArrowDown' : 'ArrowUp');
    await target.page.waitForTimeout(120);
  }
  throw new Error(`could not move the dialogue cursor to ${label}`);
}

/**
 * Move the dialogue cursor onto the first option that starts with `prefix`.
 *
 * The gift list prints the quantity the player currently holds
 * ("赠送 净水×1（持有3）"), so a hardcoded label only works for the first gift.
 */
export async function pickOptionLike(target: GameTarget, prefix: string): Promise<string> {
  const all = await dialogueOptions(target);
  const label = all.find((option) => option.startsWith(prefix));
  if (label === undefined) throw new Error(`no dialogue option starting with ${prefix} in ${JSON.stringify(all)}`);
  await pickOption(target, label);
  return label;
}

/** Press E on the nearest interactable (NPC, container, stair). */
export async function interact(target: GameTarget): Promise<void> {
  await target.page.keyboard.press('E');
}

/** Wait until the scene reports the given floor. */
export async function waitForFloor(target: GameTarget, floor: number, timeout = 20_000): Promise<void> {
  await target.frame.waitForFunction(
    (f) => {
      const w = window as unknown as {
        __PHASER_SESSION__?: { getState: () => { currentFloor?: number } | null };
        __PHASER_GAME__?: { scene: { getScene: (k: string) => { stairClimb?: unknown } | null } };
      };
      return w.__PHASER_SESSION__?.getState()?.currentFloor === f &&
        !w.__PHASER_GAME__?.scene.getScene('Game')?.stairClimb;
    },
    floor,
    { timeout },
  );
}

/** Open the door-less dialogue on an NPC and wait for it. */
export async function openDialogue(target: GameTarget): Promise<void> {
  await interact(target);
  await target.frame.waitForFunction(
    () => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { dialogueOpen?: boolean } | null } } }).__PHASER_GAME__;
      return g?.scene.getScene('Game')?.dialogueOpen === true;
    },
    undefined,
    { timeout: 15_000 },
  );
}

/** Close the dialogue (E toggles it). */
export async function closeDialogue(target: GameTarget): Promise<void> {
  await interact(target);
  await target.frame.waitForFunction(
    () => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { dialogueOpen?: boolean } | null } } }).__PHASER_GAME__;
      return g?.scene.getScene('Game')?.dialogueOpen !== true;
    },
    undefined,
    { timeout: 15_000 },
  );
}

/** The public deployment: the portal mounts the game in an iframe. */
export async function attachPublicGame(page: Page, portalBase: string, appPath: string): Promise<GameTarget> {
  await page.goto(`${portalBase}?mode=full&app_path=${encodeURIComponent(appPath)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  let frame: Frame | null = null;
  for (let i = 0; i < 90; i += 1) {
    frame = page.frames().find((f) => f.url().includes('.ms.show')) ?? null;
    if (frame) break;
    await page.waitForTimeout(1000);
  }
  if (!frame) throw new Error('the portal never mounted the .ms.show application iframe');
  await waitForScene({ page, frame }, 'Menu', 60_000);
  return { page, frame };
}
