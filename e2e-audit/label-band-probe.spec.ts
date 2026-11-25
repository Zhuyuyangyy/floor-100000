import { expect, test, type Page } from '@playwright/test';

// 只读探针（第三批）：三个必须在报告里定数的判定
//   1) 竖屏下世界层标签（储物柜/工作台/床/上楼）是否落在 HUD 不透明带内 → 是否被完全遮住
//   2) 竖屏打开背包时 hud-hint（底部提示）与触屏按钮行的真实交叠
//   3) 横屏下 HUD 上下文带底边与世界标签的关系（回归验证既有 M-1）

interface Box {
  name: string;
  text: string;
  type: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
  depth: number;
  visible: boolean;
}

async function dump(page: Page, key: string): Promise<Box[]> {
  return page.evaluate((k) => {
    const g = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (a: string) => { children: { list: unknown[] } } | null } };
    }).__PHASER_GAME__;
    const list = (g?.scene.getScene(k as string)?.children.list ?? []) as Array<Record<string, unknown>>;
    const out: Box[] = [];
    for (const o of list) {
      const type = String(o.type ?? '');
      if (type !== 'Text' && type !== 'Rectangle') continue;
      const b = (o.getBounds as undefined | (() => { x: number; y: number; width: number; height: number }))?.();
      if (!b || b.width === 0) continue;
      out.push({
        name: String(o.name ?? ''),
        text: String(o.text ?? ''),
        type,
        left: Math.round(b.x),
        right: Math.round(b.x + b.width),
        top: Math.round(b.y),
        bottom: Math.round(b.y + b.height),
        w: Math.round(b.width),
        h: Math.round(b.height),
        depth: Number(o.depth ?? 0),
        visible: Boolean(o.visible),
      });
    }
    return out;
  }, key);
}

async function enter(page: Page, w: number, h: number): Promise<void> {
  await page.setViewportSize({ width: w, height: h });
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
  await page.waitForTimeout(1200);
}

test('probe: 竖屏世界标签 vs HUD 带', async ({ page }) => {
  await enter(page, 390, 844);
  const hud = await page.evaluate(() => {
    const g = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as {
      hudContextBottom: number;
      portraitWidth: number;
      portraitMode: boolean;
    };
    return { contextBottom: g.hudContextBottom, portraitWidth: g.portraitWidth, portraitMode: g.portraitMode };
  });
  console.log(`===== 竖屏 HUD 几何 =====`);
  console.log(`portraitMode=${hud.portraitMode} portraitWidth=${hud.portraitWidth} hudContextBottom=${hud.contextBottom} (HUD 不透明带 0..${hud.contextBottom})`);

  const boxes = (await dump(page, 'Game')).filter((b) => b.visible);
  const world = boxes.filter(
    (b) => b.type === 'Text' && ['储物柜', '工作台', '床（睡觉）', '↑ 上楼', '↓ 下楼'].some((k) => b.text === k),
  );
  console.log('\n===== 世界层标签（depth 0，scrollFactor 1） =====');
  for (const b of world) {
    const inside = b.bottom <= hud.contextBottom;
    const partial = b.top < hud.contextBottom && b.bottom > hud.contextBottom;
    console.log(
      `  "${b.text}" x[${b.left}..${b.right}] y[${b.top}..${b.bottom}] d=${b.depth} → ` +
        (inside ? '★ 完全落在 HUD 不透明带内（玩家看不见）' : partial ? `部分被遮 ${hud.contextBottom - b.top}px` : '在 HUD 带外（可见）'),
    );
  }
  // HUD 前两层的覆盖矩形
  const hudRects = boxes.filter((b) => b.type === 'Rectangle' && b.depth >= 100 && b.depth <= 102 && b.w > 300);
  console.log('\n===== HUD 覆盖矩形 =====');
  for (const r of hudRects) console.log(`  x[${r.left}..${r.right}] y[${r.top}..${r.bottom}] ${r.w}x${r.h} d=${r.depth}`);

  // 打开背包，看 hud-hint
  await page.evaluate(() => {
    const s = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as { onToggleInventory: () => void };
    s.onToggleInventory();
  });
  await page.waitForTimeout(900);
  const after = (await dump(page, 'Game')).filter((b) => b.visible);
  const hint = after.find((b) => b.name === 'hud-hint');
  const buttons = after.filter((b) => b.type === 'Rectangle' && b.h === 42 && b.top > 650);
  console.log('\n===== 竖屏 · 背包打开时的底部 =====');
  if (hint) {
    console.log(`  hud-hint "${hint.text}" x[${hint.left}..${hint.right}] y[${hint.top}..${hint.bottom}] d=${hint.depth} visible=${hint.visible}`);
  } else {
    console.log('  hud-hint 未在列表中');
  }
  for (const b of buttons.sort((a, c) => a.left - c.left)) {
    console.log(`  按钮 x[${b.left}..${b.right}] y[${b.top}..${b.bottom}]`);
  }
  if (hint && buttons.length) {
    const btnTop = Math.min(...buttons.map((b) => b.top));
    const btnLeft = Math.min(...buttons.map((b) => b.left));
    const btnRight = Math.max(...buttons.map((b) => b.right));
    const ox = Math.max(0, Math.min(hint.right, btnRight) - Math.max(hint.left, btnLeft));
    const oy = Math.max(0, hint.bottom - btnTop);
    console.log(`  → 提示 × 按钮行：水平交叠 ${ox}px，垂直交叠 ${oy}px ${oy > 0 && ox > 0 ? '★ 真的重叠' : '不重叠'}`);
  }
  expect(world.length).toBeGreaterThan(0);
});

test('probe: 横屏世界标签 vs HUD 带（回归 M-1）', async ({ page }) => {
  await enter(page, 1280, 800);
  const hud = await page.evaluate(() => {
    const g = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as { hudContextBottom: number };
    return g.hudContextBottom;
  });
  console.log(`===== 横屏 =====\nhudContextBottom=${hud}`);
  // 扫多个玩家位置，看标签是否滑进 HUD 带
  const hits: string[] = [];
  for (const x of [200, 400, 640, 900, 1100]) {
    await page.evaluate((v) => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { x: number } } | null } })
        .__PHASER_SESSION__?.getState();
      if (s) s.player.x = v;
    }, x);
    await page.waitForTimeout(320);
    const boxes = (await dump(page, 'Game')).filter((b) => b.visible);
    const world = boxes.filter(
      (b) => b.type === 'Text' && ['储物柜', '工作台', '床（睡觉）'].includes(b.text),
    );
    for (const b of world) {
      if (b.top < hud) {
        hits.push(`x=${x} "${b.text}" y[${b.top}..${b.bottom}] 上沿被 HUD 带切 ${hud - b.top}px`);
      }
    }
  }
  console.log(hits.length ? hits.join('\n') : '本轮扫描未命中（标签都在 HUD 带下方）');
  expect(true).toBe(true);
});