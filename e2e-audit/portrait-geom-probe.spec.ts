import { expect, test, type Page } from '@playwright/test';

// 只读探针：竖屏（390x844）HUD 的真实几何。
// 审计报告 B-3 写着「数值压格线」「按钮盖提示」，这两句必须由这里定数。

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
  fontSize: string;
  depth: number;
  visible: boolean;
}

async function dump(page: Page, sceneKey: string): Promise<Box[]> {
  return page.evaluate((key) => {
    const g = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: unknown[] } } | null } };
    }).__PHASER_GAME__;
    const scene = g?.scene.getScene(key);
    const list = (scene?.children.list ?? []) as Array<Record<string, unknown>>;
    const out: Box[] = [];
    for (const o of list) {
      const type = String(o.type ?? '');
      if (!['Text', 'Rectangle'].includes(type)) continue;
      const b = (o.getBounds as undefined | (() => { x: number; y: number; width: number; height: number }))?.();
      if (!b || b.width === 0) continue;
      const style = (o.style ?? {}) as { fontSize?: string };
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
        fontSize: style.fontSize ?? '',
        depth: Number(o.depth ?? 0),
        visible: Boolean(o.visible),
      });
    }
    return out;
  }, sceneKey);
}

test('probe: 竖屏 HUD 数值 / 格线 / 触屏按钮', async ({ page }) => {
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
  await page.waitForTimeout(1200);

  const boxes = (await dump(page, 'Game')).filter((b) => b.visible);

  console.log('===== 竖屏 HUD 文本 =====');
  for (const b of boxes.filter((b) => b.type === 'Text' && b.top < 180).sort((a, c) => a.top - c.top || a.left - c.left)) {
    console.log(
      `  "${b.text.slice(0, 18)}" x[${b.left}..${b.right}] y[${b.top}..${b.bottom}] ${b.w}x${b.h} fs=${b.fontSize} d=${b.depth}`,
    );
  }

  // 四条属性的底板（instrumentPlate 画的 1px 边框 rect 是 Graphics，不在 list 里；
  // 改用「数值文本右沿」与「列边界」的比较 —— 列边界由 HUD 顶部 8/140、width-116 两块板推算，
  // 但最稳的是直接读已渲染的数值与标签 x。
  const stats = boxes.filter((b) => b.type === 'Text' && ['生命', '饥饿', '口渴', '精力'].includes(b.text));
  const values = boxes.filter((b) => b.type === 'Text' && b.name.startsWith('hud-value-'));
  console.log('\n===== 四条属性 =====');
  for (const s of stats) {
    const v = values.find((x) => Math.abs(x.top - s.top) <= 2);
    console.log(`  「${s.text}」标签 x[${s.left}..${s.right}] y[${s.top}..${s.bottom}]  → 数值「${v?.text ?? '?'}」x[${v?.left}..${v?.right}]`);
  }
  // 列宽计算（与 GameScene 同式，用于校验）
  const portraitWidth = await page.evaluate(() => {
    const g = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as { portraitWidth: number };
    return g.portraitWidth;
  });
  const colW = Math.floor((portraitWidth - 24) / 2);
  console.log(`\nportraitWidth=${portraitWidth}，列宽=(w-24)/2=${colW}`);
  for (const i of [0, 1]) {
    const groupX = 12 + i * colW;
    console.log(`  第 ${i} 列 groupX=${groupX}，板左=${groupX - 4}，板右=${groupX - 4 + colW - 2}`);
  }
  // 数值右沿 vs 板右沿
  for (const v of values) {
    const idx = values.indexOf(v) % 2;
    const groupX = 12 + idx * colW;
    const plateRight = groupX - 4 + colW - 2;
    console.log(
      `  数值「${v.text}」右沿 ${v.right} vs 板右沿 ${plateRight} → 余量 ${plateRight - v.right}px`,
    );
  }

  // 触屏按钮 / 底部提示
  console.log('\n===== 底部 =====');
  const buttons = boxes.filter((b) => b.type === 'Rectangle' && b.h >= 40 && b.h <= 44 && b.top > 650);
  for (const b of buttons.sort((a, c) => a.left - c.left)) {
    console.log(`  按钮 x[${b.left}..${b.right}] y[${b.top}..${b.bottom}] ${b.w}x${b.h}`);
  }
  const hint = boxes.find((b) => b.name === 'hud-hint' && b.visible && b.text !== '');
  console.log(hint ? `  提示「${hint.text}」 x[${hint.left}..${hint.right}] y[${hint.top}..${hint.bottom}]` : '  提示：当前未显示（按设计，通用操作行隐藏）');
  if (hint && buttons.length) {
    const top = Math.min(...buttons.map((b) => b.top));
    const ox = Math.max(0, Math.min(hint.right, Math.max(...buttons.map((b) => b.right))) - Math.max(hint.left, Math.min(...buttons.map((b) => b.left))));
    const oy = Math.max(0, hint.bottom - top);
    console.log(`  → 提示与按钮行：垂直交叠 ${oy}px，水平交叠 ${ox}px`);
  }

  // 背包面板打开后的底部（09c 的绿字压按钮）
  await page.evaluate(() => {
    const s = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as { onToggleInventory: () => void };
    s.onToggleInventory();
  });
  await page.waitForTimeout(800);
  const boxes2 = (await dump(page, 'Game')).filter((b) => b.visible);
  const footer = boxes2.find((b) => b.text.includes('点选物品'));
  const btns2 = boxes2.filter((b) => b.type === 'Rectangle' && b.h >= 40 && b.h <= 44 && b.top > 650);
  console.log('\n===== 竖屏背包底部 =====');
  if (footer) console.log(`  面板内提示「${footer.text}」 x[${footer.left}..${footer.right}] y[${footer.top}..${footer.bottom}]`);
  for (const b of btns2.sort((a, c) => a.left - c.left)) {
    console.log(`  按钮 x[${b.left}..${b.right}] y[${b.top}..${b.bottom}]`);
  }
  if (footer && btns2.length) {
    const top = Math.min(...btns2.map((b) => b.top));
    console.log(`  → 面板提示底沿 ${footer.bottom} vs 按钮顶沿 ${top} → ${footer.bottom > top ? `重叠 ${footer.bottom - top}px` : `余量 ${top - footer.bottom}px`}`);
  }
  expect(stats.length).toBe(4);
});