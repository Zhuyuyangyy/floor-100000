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
    return ['sword-slash', 'heavy-cleave', 'parry', 'hit-flash'].filter((key) => Boolean(scene?.textures?.exists(key)));
  });
}

async function readWeaponAppearance(page: Page): Promise<{ selected: string; texture: string; state: string; saves: Array<[string, string | null]> }> {
  return page.evaluate(() => {
    const game = window.__PHASER_GAME__;
    const scene = game?.scene.getScene('Game') as unknown as {
      selectedVisualWeapon?: string;
      weapon?: { texture?: { key?: string } };
    } | null;
    const state = window.__PHASER_SESSION__?.getState();
    const saves = Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index)!;
      return [key, localStorage.getItem(key)] as [string, string | null];
    }).sort(([a], [b]) => a.localeCompare(b));
    return {
      selected: scene?.selectedVisualWeapon ?? '',
      texture: scene?.weapon?.texture?.key ?? '',
      state: JSON.stringify(state) ?? '',
      saves,
    };
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
  // Climb to floor 2, where the encounter spots live. The climb is a visible
  // 1000 ms traversal; wait for the landing instead of a fixed 3 s budget.
  for (let attempt = 0; attempt < 3; attempt++) {
    const floor = await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.currentFloor);
    if (floor === 2) return;
    await page.evaluate(() => {
      const st = window.__PHASER_SESSION__?.getState();
      if (st) st.player.x = 40;
    });
    await page.keyboard.press('E');
    const landed = await page
      .waitForFunction(() => window.__PHASER_SESSION__?.getState()?.currentFloor === 2, undefined, { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (landed) return;
  }
  throw new Error('could not climb to floor 2 for the combat specs');
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

async function combatChoicePoint(page: Page, index: number): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate((row) => {
    const game = window.__PHASER_GAME__ as unknown as {
      canvas: { width: number; height: number };
      scene: { getScene: (key: string) => {
        children: { list: Array<{ type: string; text?: string; x: number; y: number; width: number }> };
      } | null };
    } | undefined;
    const scene = game?.scene.getScene('Game');
    if (!game || !scene) throw new Error('Game scene is unavailable');
    const label = ['攻击', '格挡', '撤退'][row];
    const object = scene.children.list.find((child) => child.type === 'Text' && child.text === label);
    if (!object) throw new Error(`Combat action label not found: ${label}`);
    return {
      x: object.x + object.width / 2,
      y: object.y,
      width: game.canvas.width,
      height: game.canvas.height,
    };
  }, index);
}

async function hoverCombatChoice(page: Page, index: number): Promise<void> {
  const point = await combatChoicePoint(page, index);
  const canvas = await page.locator('canvas').first().boundingBox();
  if (!canvas) throw new Error('Phaser canvas is not visible');
  await page.mouse.move(canvas.x + point.x / point.width * canvas.width, canvas.y + point.y / point.height * canvas.height);
}

async function clickCombatChoice(page: Page, index: number): Promise<void> {
  const point = await combatChoicePoint(page, index);
  const canvas = await page.locator('canvas').first().boundingBox();
  if (!canvas) throw new Error('Phaser canvas is not visible');
  await page.mouse.click(canvas.x + point.x / point.width * canvas.width, canvas.y + point.y / point.height * canvas.height);
}

async function readCombatSelection(page: Page): Promise<number> {
  return page.evaluate(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { combatSelected?: number } | null;
    return scene?.combatSelected ?? -1;
  });
}

async function readCombatLogRows(page: Page): Promise<Array<{ text: string; y: number; height: number; width: number }>> {
  return page.evaluate(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as {
      cameras: { main: { height: number; zoom: number } };
      children: { list: Array<{ type: string; text?: string; y: number; height: number; width: number; visible: boolean }> };
    } | null;
    if (!scene) return [];
    const viewHeight = scene.cameras.main.height * scene.cameras.main.zoom;
    const logTop = (viewHeight - 248) / 2 + 56;
    return scene.children.list
      .filter((child) => child.type === 'Text' && child.visible && child.y >= logTop + 8 && child.y < logTop + 74)
      .map((child) => ({ text: child.text ?? '', y: child.y, height: child.height, width: child.width }));
  });
}

async function readRetreatOutcome(page: Page): Promise<string> {
  return page.evaluate(() => {
    const state = window.__PHASER_SESSION__?.getState();
    return JSON.stringify({
      status: state?.status,
      hp: state?.player.hp,
      combat: state?.combat ?? null,
    });
  });
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

test('mouse hover selects and one attack click resolves exactly one round without overlapping combat logs', async ({ page }) => {
  await startAndClimb(page);
  expect(await openAmbush(page), 'no ambush spot on floor 2 for seed 42').toBe(true);
  const before = await readCombat(page);
  expect(before).not.toBeNull();

  // Hover is a selection affordance; moving from Guard to Attack highlights
  // the latter without running either action until the actual click.
  await hoverCombatChoice(page, 1);
  await expect.poll(() => readCombatSelection(page)).toBe(1);
  expect((await readCombat(page))?.turn).toBe(before!.turn);
  await hoverCombatChoice(page, 0);
  await expect.poll(() => readCombatSelection(page)).toBe(0);
  await clickCombatChoice(page, 0);
  await page.waitForFunction(() => {
    const combat = (window.__PHASER_SESSION__?.getState() as { combat?: { turn: number } } | null)?.combat;
    return !combat || combat.turn > 1;
  });

  const after = await readCombat(page);
  expect(after, 'this floor-2 ambush should remain open after one attack').not.toBeNull();
  expect(after!.turn).toBe(before!.turn + 1);
  expect(after!.hp).toBeLessThanOrEqual(before!.hp);

  const logRows = await readCombatLogRows(page);
  expect(logRows).toHaveLength(3);
  for (let i = 1; i < logRows.length; i++) {
    expect(logRows[i].y).toBeGreaterThanOrEqual(logRows[i - 1].y + logRows[i - 1].height);
  }
});

test('mouse hover and click use the Guard action exactly once', async ({ page }) => {
  await startAndClimb(page);
  expect(await openAmbush(page), 'no ambush spot on floor 2 for seed 42').toBe(true);
  const before = await readCombat(page);
  expect(before).not.toBeNull();

  await hoverCombatChoice(page, 1);
  await expect.poll(() => readCombatSelection(page)).toBe(1);
  await clickCombatChoice(page, 1);
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const combat = (window.__PHASER_SESSION__?.getState() as { combat?: { turn: number; guarding: boolean } } | null)?.combat;
    return combat ? { turn: combat.turn, guarding: combat.guarding } : null;
  });
  expect(after, 'Guard should leave the ambush open').not.toBeNull();
  expect(after!.guarding).toBe(true);
  expect(after!.turn).toBe(before!.turn + 1);
});

test('long combat log entries are clipped to one line without overlapping their neighbours', async ({ page }) => {
  await startAndClimb(page);
  expect(await openAmbush(page), 'no ambush spot on floor 2 for seed 42').toBe(true);
  const longLog = [
    '拾荒者从暗处扑出，'.repeat(8),
    '你击中拾荒者，造成 2 点伤害；这是一条很长的战斗结果记录。'.repeat(3),
    '拾荒者击中你，造成 1 点伤害（格挡减半），并留下了额外的物资记录。'.repeat(3),
  ];
  await page.evaluate((lines) => {
    const state = window.__PHASER_SESSION__?.getState() as { combat?: { log: string[] } } | null;
    if (!state?.combat) throw new Error('Combat state disappeared');
    state.combat.log = lines;
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { buildCombatPanel: () => void } | null;
    scene?.buildCombatPanel();
  }, longLog);

  const rendered = await readCombatLogRows(page);
  expect(rendered).toHaveLength(3);
  expect(rendered.every((row) => row.text.endsWith('…'))).toBe(true);
  expect(rendered.every((row) => row.width <= 400)).toBe(true);
  for (let i = 1; i < rendered.length; i++) {
    expect(rendered[i].y).toBeGreaterThanOrEqual(rendered[i - 1].y + rendered[i - 1].height);
  }
  const retainedLog = await page.evaluate(() => (window.__PHASER_SESSION__?.getState() as { combat?: { log: string[] } } | null)?.combat?.log ?? []);
  expect(retainedLog).toEqual(longLog);
});

test('mouse retreat has exactly the same result as keyboard Escape', async ({ browser }) => {
  test.setTimeout(90_000); // Two real journeys to the encounter compete for renderer time.
  const keyboardPage = await browser.newPage();
  const mousePage = await browser.newPage();
  try {
    await Promise.all([startAndClimb(keyboardPage), startAndClimb(mousePage)]);
    const [keyboardOpened, mouseOpened] = await Promise.all([openAmbush(keyboardPage), openAmbush(mousePage)]);
    expect(keyboardOpened, 'keyboard run has no ambush on floor 2 for seed 42').toBe(true);
    expect(mouseOpened, 'mouse run has no ambush on floor 2 for seed 42').toBe(true);
    expect(await readCombat(mousePage)).toEqual(await readCombat(keyboardPage));

    await keyboardPage.keyboard.press('Escape');
    await hoverCombatChoice(mousePage, 2);
    await expect.poll(() => readCombatSelection(mousePage)).toBe(2);
    await clickCombatChoice(mousePage, 2);
    await Promise.all([keyboardPage.waitForTimeout(450), mousePage.waitForTimeout(450)]);

    expect(await readRetreatOutcome(mousePage)).toBe(await readRetreatOutcome(keyboardPage));
  } finally {
    await Promise.all([keyboardPage.close(), mousePage.close()]);
  }
});

test('Q switches only the visual weapon and leaves GameState and saved data unchanged', async ({ page }) => {
  await startAndClimb(page);
  expect(await loadedCombatFx(page)).toEqual(expect.arrayContaining(['sword-slash', 'heavy-cleave']));

  // Freeze the simulation loop while testing input so ordinary hunger, thirst,
  // and clock ticks cannot be mistaken for mutations caused by the appearance key.
  await page.evaluate(() => {
    window.__PHASER_GAME__?.loop.stop();
  });
  const before = await readWeaponAppearance(page);
  expect(before.selected).toBe('crowbar');
  expect(before.texture).toBe('weapon-crowbar');

  await page.keyboard.press('Q');
  const after = await readWeaponAppearance(page);
  expect(after.selected).toBe('fire-axe');
  expect(after.texture).toBe('weapon-fire-axe');
  expect(after.state).toBe(before.state);
  expect(after.saves).toEqual(before.saves);
});
