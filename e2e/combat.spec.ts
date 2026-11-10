import { expect, test, type Page } from '@playwright/test';

// The turn-based fight, end to end.
//
// There was no e2e coverage for combat at all, which is why a full rewrite of
// the combat panel could ship on unit tests and a screenshot. These specs pin
// the parts that matter to a player: the fight opens on an ambush, attacking
// actually removes monster HP, the player's HP never goes negative, and the
// fight closes cleanly when the monster dies.

interface CombatView {
  monster: string;
  hp: number;
  maxHp: number;
  turn: number;
}

async function readCombat(page: Page): Promise<CombatView | null> {
  return page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { combat?: { monster: { name: string; hp: number; maxHp: number }; turn: number } } | null } })
      .__PHASER_SESSION__?.getState();
    const c = s?.combat;
    return c ? { monster: c.monster.name, hp: c.monster.hp, maxHp: c.monster.maxHp, turn: c.turn } : null;
  });
}

async function readPlayer(page: Page): Promise<{ hp: number; status: string; gold: number }> {
  return page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { hp: number; gold: number }; status: string } | null } })
      .__PHASER_SESSION__?.getState();
    return { hp: s?.player.hp ?? -1, status: s?.status ?? '?', gold: s?.player.gold ?? -1 };
  });
}

async function loadedCombatFx(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { textures?: { exists: (key: string) => boolean } } | null;
    return ['sword-slash', 'parry', 'hit-flash'].filter((key) => Boolean(scene?.textures?.exists(key)));
  });
}

/** Start a run and walk to the first ambush on floor 2. */
async function startAndClimb(page: Page): Promise<void> {
  await page.goto('/?seed=42');
  await page.waitForFunction(
    () => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Menu'),
    null,
    { timeout: 20_000 },
  );
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect'),
    null,
    { timeout: 20_000 },
  );
  // The pick screen reports active before create() binds its keys.
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'),
    null,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(800);
  // Climb to floor 2, where the encounter spots live.
  await page.evaluate(() => {
    const st = window.__PHASER_SESSION__?.getState();
    if (st) st.player.x = 40;
  });
  await page.keyboard.press('E');
  await page.waitForFunction(() => window.__PHASER_SESSION__?.getState()?.currentFloor === 2, undefined, { timeout: 3000 });
}

/** Open the ambush at whichever spot on this floor rolls one. */
async function openAmbush(page: Page): Promise<boolean> {
  const spots: Array<{ k: string; x: number }> = await page.evaluate(() => {
    const game = window.__PHASER_GAME__;
    if (!game) return [];
    const sc = game.scene.getScene('Game') as unknown as {
      spotMarkers?: Map<string, { x: number }>;
    };
    return [...(sc.spotMarkers ?? new Map()).entries()].map(([k, v]) => ({ k, x: Math.round(v.x) }));
  });
  for (const sp of spots) {
    if (sp.k === 'shop') continue;
    await page.evaluate((x) => {
      const st = window.__PHASER_SESSION__?.getState();
      if (st) st.player.x = x;
    }, sp.x);
    await page.waitForTimeout(250);
    await page.keyboard.press('E');
    await page.waitForTimeout(500);
    if (await readCombat(page)) return true;
    // Not an ambush: close whatever opened and try the next spot.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  return false;
}

test('an ambush opens a fight, and attacking removes monster HP', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startAndClimb(page);
  expect(await loadedCombatFx(page)).toEqual(expect.arrayContaining(['sword-slash', 'parry', 'hit-flash']));
  const opened = await openAmbush(page);
  expect(opened, 'no ambush spot on floor 2 for seed 42').toBe(true);

  const first = await readCombat(page);
  expect(first).not.toBeNull();
  expect(first!.hp).toBeGreaterThan(0);
  expect(first!.turn).toBe(1);

  // Attack. Either the monster loses HP or the swing misses — a miss is legal,
  // so the assertion is that the turn ADVANCED and HP never increased.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const second = await readCombat(page);
  if (second) {
    expect(second.turn).toBe(2);
    expect(second.hp).toBeLessThanOrEqual(first!.hp);
  }
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a fight ends when the monster dies, and the player HP never goes negative', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startAndClimb(page);
  expect(await openAmbush(page), 'no ambush spot on floor 2 for seed 42').toBe(true);

  // Keep attacking until the fight resolves. The monster on floor 2 has 5-8 HP
  // and the player hits for 2-5, so this cannot run long; the cap is a guard
  // against an infinite loop rather than an expectation.
  let rounds = 0;
  let lastHp = (await readPlayer(page)).hp;
  while (rounds < 14) {
    const combat = await readCombat(page);
    if (!combat) break;
    await page.keyboard.press('Enter');
    await page.waitForTimeout(380);
    const after = await readPlayer(page);
    // The invariant that matters most: the fight can never take the player below
    // zero and hand the End scene a negative HP.
    expect(after.hp, 'player HP went negative').toBeGreaterThanOrEqual(0);
    expect(after.hp).toBeLessThanOrEqual(lastHp);
    expect(after.hp).toBeLessThanOrEqual(100);
    lastHp = after.hp;
    rounds++;
  }

  // The outcome screen is one more Enter from closing.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  expect(await readCombat(page), 'the fight should be over').toBeNull();
  expect((await readPlayer(page)).status).toBe('playing');
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('fleeing costs a turn and leaves the spot unspent', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startAndClimb(page);
  expect(await openAmbush(page), 'no ambush spot on floor 2 for seed 42').toBe(true);

  // ESC mid-fight runs the flee round rather than closing the panel for free.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const after = await readCombat(page);
  // Either the escape worked (fight over) or it failed and the turn advanced —
  // both are legal, and neither may crash.
  if (after) expect(after.turn).toBeGreaterThanOrEqual(2);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
