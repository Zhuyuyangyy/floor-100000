import { expect, test, type Page } from '@playwright/test';

// B3-05 §6: the HUD feedback line did not render while a panel was open.
//
// feedbackText sat at depth 120 while every panel in PANEL_DEPTH.game is deeper
// (inventory 200, craft 210, dialogue 220, pause 230), so a panel's opaque fill
// covered it. The flash is the game's only channel for "what just happened" — it
// carries the B3-03 action costs and the B3-05.2 purify count — and it was
// invisible exactly when the player was acting.
//
// This asserts the flash is ON THE CANVAS, not that a Text object exists with the
// right string. bagFullWarning.spec.ts:155 makes the weaker claim (it reads
// GameObject.visible) and passes while the warning sits behind the panel, which
// is the "tests passing != gameplay works" trap CLAUDE.md names. So the proof
// here is a pixel differential: the same clip of the canvas with the flash up and
// with it expired. If the panel covers the flash the two frames are identical.

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === k);
    },
    key,
    { timeout: 30_000 },
  );
}

async function startGame(page: Page, seed: number): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  // A new run lands on the character pick first.
  await waitForScene(page, 'MetaSelect');
  // The pick screen reports active before create() binds its keys, so an
  // Enter can land in that window and be lost. Retry until the run starts.
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const started = await page.waitForFunction(
      () => {
        const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
        return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
      },
      undefined,
      { timeout: 2000 },
    ).then(() => true).catch(() => false);
    if (started) break;
  }
  await waitForScene(page, 'Game');
}

test('the flash renders on top of an open panel', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  // Let the camera finish following the player before shooting anything.
  await page.waitForTimeout(700);

  // Open the inventory and drink a bottle: that flashes 「使用 净水 · 水分 +20」.
  await page.keyboard.press('I');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150); // the flash lives 1.6s

  const canvas = page.locator('canvas');
  const box = (await canvas.boundingBox()) as Box | null;
  expect(box, 'the canvas has no box').not.toBeNull();
  // The canvas is the design resolution scaled by Scale.FIT, so game
  // coordinates map onto it by that factor. The divisor is the design width, not
  // a literal 640 — the design resolution went to 1280x720 for the
  // cross-section, and a hardcoded 640 made `scale` twice the truth and put the
  // clip somewhere the flash never is. page.screenshot() takes page coordinates,
  // so the canvas offset is added back.
  //
  // The clip covers the flash's own row (HUD_BAR_H 60 + 26 = 86) and nothing that
  // moves on its own: the clock is high in the bar, the stat bars are to the
  // right, and the panel's own title is static.
  const scale = box!.width / 1280;
  const clip = {
    x: box!.x + 180 * scale,
    y: box!.y + 72 * scale,
    width: 420 * scale,
    height: 34 * scale,
  };
  const withFlash = await page.screenshot({ clip });
  // Shot while the flash is still up, so the evidence shows it rather than the
  // empty HUD the second clip captures.
  await page.screenshot({ path: 'e2e/screenshots/b3-05-6-flash-over-panel.png' });

  // The flash reports `stat - before`, a raw float, so a player who drinks reads
  // 「水分 +20.114303979999917」. No message in this channel legitimately carries a
  // decimal point — loot quantities and minute costs are integers — so its
  // presence is the bug. Read it before the 1.6s expires.
  // OVERHAUL UI: the HUD moved to a bar, so the flash is no longer at y=60.
  // Located by content instead of by row — the flash is the only text in the
  // top band that reports a stat change.
  const shown = await page.evaluate(() => {
    const g = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean; y: number }> } } | null } };
    }).__PHASER_GAME__;
    for (const o of g?.scene.getScene('Game')?.children.list ?? []) {
      if (o.type === 'Text' && o.visible && (o.text ?? '').includes('水分') && o.y < 140) return o.text ?? '';
    }
    return '';
  });
  expect(shown, 'the flash must be readable').toContain('水分');
  expect(shown, `the amount is not a whole number: ${shown}`).not.toContain('.');

  await page.waitForTimeout(1900); // past the 1.6s flash
  const withoutFlash = await page.screenshot({ clip });

  expect(
    withFlash.equals(withoutFlash),
    'the flash is not on the canvas while the panel is open — the panel covers it',
  ).toBe(false);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// The pixel proof above covers the flash, because that is the one whose absence
// was measured. The bag-full warning and the hint line are fixed by the same
// constant and hidden by the same mechanism, so this keeps all three honest
// without three fragile clip differentials.
test('all three HUD feedback objects clear the deepest panel', async ({ page }) => {
  await startGame(page, 42);
  await page.waitForTimeout(500);

  const depths = await page.evaluate(() => {
    const g = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; y: number; depth: number }> } } | null } };
    }).__PHASER_GAME__;
    const list = g?.scene.getScene('Game')?.children.list ?? [];
    // Matched by content, not by y alone: the fourth stat label sits close to the
    // bag-full warning, and a y-probe silently returns the wrong object.
    //
    // The rows are derived from the same constants buildHud uses rather than
    // written as literals. They used to be literals — flash at 56 and the hint at
    // 350 — and both were silently wrong the moment the design canvas went from
    // 640x360 to 1280x720, because the hint is anchored to the foot bar and the
    // foot bar moved with the canvas.
    const HUD_BAR_H = 60;
    const HUD_FOOT_H = 40;
    const DESIGN_HEIGHT = 720;
    const flash = list.find((o) => o.type === 'Text' && Math.abs(o.y - (HUD_BAR_H + 26)) < 2);
    const bagFull = list.find((o) => o.type === 'Text' && (o.text ?? '').includes('否则搜刮会留在原处'));
    const hint = list.find(
      (o) => o.type === 'Text' && Math.abs(o.y - (DESIGN_HEIGHT - HUD_FOOT_H / 2)) < 2 && (o.text ?? '').includes('ESC 菜单'),
    );
    return { flash: flash?.depth, bagFull: bagFull?.depth, hint: hint?.depth };
  });

  const values = [depths.flash, depths.bagFull, depths.hint];
  expect(values.every((d) => d !== undefined && d === values[0]), `depths: ${JSON.stringify(depths)}`).toBe(true);
  // PANEL_DEPTH.game.pause is 230, the deepest panel any of them can hide behind.
  expect(values[0], 'must clear the deepest game panel').toBeGreaterThan(230);
});
