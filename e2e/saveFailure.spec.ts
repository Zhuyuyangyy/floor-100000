import { expect, test, type Page } from '@playwright/test';

// B3-01 D9: a rejected localStorage write must not be silent.
//
// The audit found saveToStorage() returned false on a quota or private-mode
// rejection and every one of its call sites ignored the return, so the player
// lost the run without a word. The scene now polls a failure counter and flashes
// a warning when it grows. This drives the real thing: it fills localStorage
// until setItem throws, then asserts the warning reaches the screen — and that it
// does not repeat every frame.

interface State {
  day: number;
  gameMinuteOfDay: number;
  player: { x: number; hp: number; thirst: number };
}

// Declared once here so the browser callbacks below can read the dev handles
// without an inline cast. A cast inside page.evaluate/waitForFunction is not
// always stripped before the callback is serialized, which shows up as an eval
// parse error rather than as a type error.
declare global {
  interface Window {
    __PHASER_GAME__?: {
      scene: {
        scenes: Array<{ children: { list: Array<{ type: string; text?: string; visible: boolean }> } }>;
        getScenes: (r?: boolean) => Array<{ scene: { key: string } }>;
      };
    };
    __PHASER_SESSION__?: { getState: () => State | null };
  }
}

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === k);
    },
    key,
    { timeout: 20_000 },
  );
}

// NOTE: everything handed to page.evaluate/waitForFunction must be plain
// JavaScript — the callback is serialized and a TypeScript cast inside it is a
// parse error at eval time, which surfaces as "No tests found".
async function hasVisibleText(page: Page, substr: string): Promise<boolean> {
  return page.evaluate((sub) => {
    const g = window.__PHASER_GAME__;
    const scenes = g ? g.scene.scenes : [];
    for (const sc of scenes) {
      for (const o of sc.children.list ?? []) {
        if (o.type === 'Text' && (o.text ?? '').includes(sub) && o.visible) return true;
      }
    }
    return false;
  }, substr);
}

// Push the clock so the autosave cadence fires and actually attempts a write.
async function advanceToNight(page: Page): Promise<void> {
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.gameMinuteOfDay = 700;
  });
}

async function waitForFlag(page: Page, substr: string, want: boolean, timeout = 15_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if ((await hasVisibleText(page, substr)) === want) return;
    await page.waitForTimeout(120);
  }
  throw new Error(`"${substr}" visible=${String(!want)} never became ${String(want)}`);
}

test('a rejected save warns the player instead of losing the run silently', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Fill localStorage until the browser starts rejecting writes, which is what a
  // full disk or a private window does. The init script runs before any game code.
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    let budget = 2000; // bytes left before the quota bites
    Storage.prototype.setItem = function patched(key: string, value: string): void {
      if (budget <= 0) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      budget -= key.length + value.length;
      original.call(this, key, value);
    };
  });

  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Game');
  await advanceToNight(page);

  // The warning must appear on its own — the player did nothing wrong.
  await waitForFlag(page, '存档失败', true);
  expect(await hasVisibleText(page, '存档失败')).toBe(true);

  // And it must not repeat every frame: the flash clears itself, and the counter
  // comparison means one warning per new failure rather than one per frame.
  await waitForFlag(page, '存档失败', false, 10_000);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a run that saves normally never shows the warning', async ({ page }) => {
  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Game');
  await advanceToNight(page);
  await page.waitForTimeout(1500);

  expect(await hasVisibleText(page, '存档失败')).toBe(false);
  // And the save really landed.
  const saved = await page.evaluate(() => localStorage.getItem('floor100000.save.v1'));
  expect(saved).not.toBeNull();
});
