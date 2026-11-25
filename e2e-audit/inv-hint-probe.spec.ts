import { expect, test, type Page } from '@playwright/test';

// 只读探针：竖屏打开背包后，底部那条深底提示（hud-hint）到底在哪、压不压按钮。
// 09c 截图里它明显压在按钮上沿，这里把它变成坐标。

test('probe: 竖屏背包里的 hud-hint 与按钮行', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?seed=42&debug=1');
  await page.waitForFunction(() =>
    window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Menu'),
  );
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect'),
  );
  await page.waitForTimeout(400);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const ok = await page.evaluate(() =>
      Boolean(window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game')),
    );
    if (ok) break;
  }
  await page.waitForFunction(() =>
    window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'),
  );
  // 等 Game 场景真的建完，不要只等它 active。
  //
  // 为什么（实测过，不是防御性编程）：全量跑 40 条用例时这条偶发红在
  //   `page.evaluate: no active game; call startNewGame(seed) first`
  // 栈在 `onToggleInventory → toggleInventory → refreshInventory → getGame`。
  // 说明 Game 场景已经 active，但 `create()` 还没走到 `startNewGame()`，
  // 于是 `__PHASER_SESSION__.getState()` 返回 null，而下面 `onToggleInventory`
  // 直接要求有会话。同一原因也让「背包未开」那次读到 `hint 对象未找到`
  // ——`buildHud()` 还没执行。
  //
  // 固定 1200ms 在机器空闲时够，被别的 agent 抢占时不够。改成轮询两个真实条件：
  // 会话已建立 + hud-hint 已挂到场景树上。
  await page.waitForFunction(
    () => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => unknown } })
        .__PHASER_SESSION__?.getState();
      if (!s) return false;
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<Record<string, unknown>> } } | null } } }).__PHASER_GAME__;
      const list = (g?.scene.getScene('Game')?.children.list ?? []) as Array<Record<string, unknown>>;
      return list.some((o) => o.name === 'hud-hint');
    },
    undefined,
    { timeout: 20_000, polling: 100 },
  );
  await page.waitForTimeout(400);

  const read = async () =>
    page.evaluate(() => {
      const g = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as {
        hintText?: { getBounds: () => { x: number; y: number; width: number; height: number }; text: string; visible: boolean };
        touchControls?: Array<{ getBounds: () => { x: number; y: number; width: number; height: number } }>;
        inventoryOpen: boolean;
        children: { list: Array<Record<string, unknown>> };
      };
      const byName = g.children.list.find((o) => o.name === 'hud-hint') as
        | { getBounds: () => { x: number; y: number; width: number; height: number }; text: string; visible: boolean }
        | undefined;
      const hintObj = g.hintText ?? byName;
      const btns = (g.touchControls ?? (g.children.list.filter((o) => o.type === 'Rectangle' && (o as { depth?: number }).depth === 305) as unknown as Array<{ getBounds: () => { x: number; y: number; width: number; height: number } }>)) ?? [];
      const h = hintObj?.getBounds();
      return {
        inventoryOpen: g.inventoryOpen,
        hint: h
          ? { x: Math.round(h.x), y: Math.round(h.y), w: Math.round(h.width), h: Math.round(h.height), text: hintObj!.text, visible: hintObj!.visible }
          : null,
        buttons: btns.map((b) => {
          const bb = b.getBounds();
          return { x: Math.round(bb.x), y: Math.round(bb.y), w: Math.round(bb.width), h: Math.round(bb.height) };
        }),
      };
    });

  const before = await read();
  console.log('===== 背包未开 =====');
  if (before.hint) {
    console.log(`hint visible=${before.hint.visible} "${before.hint.text}" bbox x[${before.hint.x}..${before.hint.x + before.hint.w}] y[${before.hint.y}..${before.hint.y + before.hint.h}]`);
  } else {
    console.log('hint 对象未找到');
  }

  await page.evaluate(() => {
    const s = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as { onToggleInventory: () => void };
    s.onToggleInventory();
  });
  await page.waitForTimeout(900);

  const after = await read();
  console.log('\n===== 背包已开 =====');
  console.log(`inventoryOpen=${after.inventoryOpen}`);
  if (after.hint) {
    console.log(`hint visible=${after.hint.visible} "${after.hint.text}" bbox x[${after.hint.x}..${after.hint.x + after.hint.w}] y[${after.hint.y}..${after.hint.y + after.hint.h}]`);
  } else {
    console.log('hint 对象未找到');
  }
  const btn = after.buttons.filter((b) => b.w < 100 && b.h >= 40 && b.y > 650).sort((a, b) => a.x - b.x);
  for (const b of btn) console.log(`  按钮 x[${b.x}..${b.x + b.w}] y[${b.y}..${b.y + b.h}]`);
  if (btn.length && after.hint?.visible) {
    const top = Math.min(...btn.map((b) => b.y));
    const left = Math.min(...btn.map((b) => b.x));
    const right = Math.max(...btn.map((b) => b.x + b.w));
    const hx0 = after.hint!.x;
    const hx1 = after.hint!.x + after.hint!.w;
    const hy1 = after.hint!.y + after.hint!.h;
    const ox = Math.max(0, Math.min(hx1, right) - Math.max(hx0, left));
    const oy = Math.max(0, hy1 - top);
    console.log(`→ 提示 × 按钮：水平交叠 ${ox}px，垂直交叠 ${oy}px ${ox > 0 && oy > 0 ? '★ 重叠' : '不重叠'}`);
    console.log(`→ 提示底沿 ${hy1}，按钮顶沿 ${top}`);
  }
  expect(after.inventoryOpen).toBe(true);
});