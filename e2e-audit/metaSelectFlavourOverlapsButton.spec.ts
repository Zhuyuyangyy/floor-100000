import { expect, test, type Page } from '@playwright/test';

// 回归防线：角色选择面板里，说明文字不得跑出面板、不得压住「开始生存」按钮；
// 模式说明不得压住遗物列。
//
// 这三条对应 docs/UI_AUDIT_R3.md 的 B-1。B-1 的根因是两层叠加：
//   1) MetaSelectScene 的 wordWrap 没开 useAdvancedWrap，中文整句不折行，
//      实测自然宽 360px 而 wrap=132px，一行都不折 → 横向跑出面板 118px；
//   2) 立绘脚与按钮都在面板底部 70/38 的同一带里，只修换行会立刻变成竖向
//      重叠（dialogue-fit-probe 已在对话框上实测过这个陷阱：横向溢出 880px
//      修掉后，换成了 21px 的竖向压字）。
// 所以本断言同时锁「横向」「竖向」两个方向 —— 只修一侧会红。
//
// 只读：不点开始、不切换角色（那会走存档与解锁），只读 create() 已摆好的对象，
// 说明文字的四种长度靠 setText 轮流灌进同一个实例来量。

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
}

const FLAVOUR = [
  '从底层醒来的那个人。没有特长，只有背包。',
  '宿舍区的老邻居。交易时总能多聊出点门道。',
  '跑得快的孩子。撤退总是更容易一些。',
  '在黑暗里游荡的东西。现在它为你引路。',
];

const BLURBS = [
  '饥渴衰减 ×1.5，得分 ×1.5——用更紧的预算换更高的分。',
  '标准规则。自动存档，死了就重来。',
  '饥渴衰减 ×0.7，守门人伤害 ×0.7——先看清这座楼。',
];

async function boxes(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    const g = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: unknown[] } } | null } };
    }).__PHASER_GAME__;
    const scene = g?.scene.getScene('MetaSelect');
    const list = (scene?.children.list ?? []) as Array<Record<string, unknown>>;
    const out: Array<{
      name: string;
      text: string;
      type: string;
      left: number;
      right: number;
      top: number;
      bottom: number;
      w: number;
      h: number;
    }> = [];
    for (const o of list) {
      const type = String(o.type ?? '');
      if (type !== 'Text' && type !== 'Rectangle' && type !== 'Image') continue;
      if (!o.visible) continue;
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
      });
    }
    return out;
  });
}

/**
 * buildPanel 的填充是 5 段横条带（每段约 h/5），加一层边框，没有任何一个
 * Rectangle 单独等于整块面板。把宽度 400..700 的矩形取并集才是面板边界。
 * 不硬编码 470/520：以后调宽高，这条路仍然量得准。
 */
function panelBounds(all: Box[]): Box | null {
  const bands = all.filter((b) => b.type === 'Rectangle' && b.w > 400 && b.w < 700);
  if (!bands.length) return null;
  const left = Math.min(...bands.map((b) => b.left));
  const right = Math.max(...bands.map((b) => b.right));
  const top = Math.min(...bands.map((b) => b.top));
  const bottom = Math.max(...bands.map((b) => b.bottom));
  return { name: 'panel', text: '', type: 'union', left, right, top, bottom, w: right - left, h: bottom - top };
}

async function openMetaSelect(page: Page): Promise<void> {
  await page.goto('/?seed=42&debug=1');
  await page.waitForFunction(() =>
    window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Menu'),
  );
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect'),
  );
  await page.waitForTimeout(700);
}

test('回归：桌面角色说明不溢出面板、不压按钮', async ({ page }) => {
  await openMetaSelect(page);
  const all = await boxes(page);
  const panel = panelBounds(all);
  expect(panel, '找不到角色面板').toBeTruthy();

  const flavour = all.find((b) => FLAVOUR.includes(b.text));
  expect(flavour, '找不到角色说明文字').toBeTruthy();

  const startBtn = all.find((b) => b.text === '开始生存');
  expect(startBtn, '找不到「开始生存」按钮文字').toBeTruthy();

  const outLeft = panel!.left - flavour!.left;
  const outRight = flavour!.right - panel!.right;
  const outBottom = flavour!.bottom - panel!.bottom;
  const overlapY = Math.min(flavour!.bottom, startBtn!.bottom) - Math.max(flavour!.top, startBtn!.top);
  const overlapX = Math.min(flavour!.right, startBtn!.right) - Math.max(flavour!.left, startBtn!.left);

  console.log('\n===== B-1 桌面回归 =====');
  console.log(`  面板        x[${panel!.left}..${panel!.right}] y[${panel!.top}..${panel!.bottom}] (${panel!.w}x${panel!.h})`);
  console.log(`  说明文字    x[${flavour!.left}..${flavour!.right}] y[${flavour!.top}..${flavour!.bottom}] (${flavour!.w}x${flavour!.h})`);
  console.log(`  开始按钮    x[${startBtn!.left}..${startBtn!.right}] y[${startBtn!.top}..${startBtn!.bottom}]`);
  console.log(
    `  → 左溢出 ${outLeft > 0 ? `${outLeft}px ★` : '无'} | 右溢出 ${outRight > 0 ? `${outRight}px ★` : '无'}` +
      ` | 下溢出 ${outBottom > 0 ? `${outBottom}px ★` : '无'}`,
  );
  console.log(
    `  → 与按钮交叠 ${overlapX > 0 && overlapY > 0 ? `${overlapX}x${overlapY}px ★` : '无'}` +
      `（水平 ${Math.max(0, overlapX)} / 垂直 ${Math.max(0, overlapY)}）`,
  );

  expect(outLeft, '说明文字左沿跑出了面板').toBeLessThanOrEqual(0);
  expect(outRight, '说明文字右沿跑出了面板').toBeLessThanOrEqual(0);
  expect(outBottom, '说明文字下沿跑出了面板').toBeLessThanOrEqual(0);
  expect(overlapX > 0 && overlapY > 0, '说明文字与「开始生存」按钮交叠').toBe(false);
});

test('回归：四条角色说明都能装下、都不压按钮', async ({ page }) => {
  await openMetaSelect(page);
  console.log('\n===== 四条角色说明（逐条 setText，复用同一实例）=====');
  for (const [i, text] of FLAVOUR.entries()) {
    await page.evaluate((t) => {
      const s = window.__PHASER_GAME__!.scene.getScene('MetaSelect') as unknown as {
        flavourText: { setText: (v: string) => void };
      };
      s.flavourText.setText(t);
    }, text);
    await page.waitForTimeout(200);

    const all = await boxes(page);
    const panel = panelBounds(all);
    const flavour = all.find((b) => b.text === text);
    const startBtn = all.find((b) => b.text === '开始生存');
    expect(panel !== null && flavour !== undefined && startBtn !== undefined, `第 ${i} 条：对象缺失`).toBe(true);

    const oy = Math.min(flavour!.bottom, startBtn!.bottom) - Math.max(flavour!.top, startBtn!.top);
    const ox = Math.min(flavour!.right, startBtn!.right) - Math.max(flavour!.left, startBtn!.left);
    console.log(
      `  #${i} ${flavour!.w}x${flavour!.h} x[${flavour!.left}..${flavour!.right}] y[${flavour!.top}..${flavour!.bottom}]` +
        ` | 面板 x[${panel!.left}..${panel!.right}] y[${panel!.top}..${panel!.bottom}]` +
        ` | 按钮 y[${startBtn!.top}..${startBtn!.bottom}]` +
        ` | 交叠 ${ox > 0 && oy > 0 ? `${ox}x${oy}px ★` : '无'}` +
        ` | 左溢出 ${panel!.left - flavour!.left > 0 ? `${panel!.left - flavour!.left}px ★` : '无'}`,
    );
    expect(panel!.left - flavour!.left, `第 ${i} 条左沿出面板`).toBeLessThanOrEqual(0);
    expect(flavour!.right - panel!.right, `第 ${i} 条右沿出面板`).toBeLessThanOrEqual(0);
    expect(flavour!.bottom - panel!.bottom, `第 ${i} 条下沿出面板`).toBeLessThanOrEqual(0);
    expect(ox > 0 && oy > 0, `第 ${i} 条压住按钮`).toBe(false);
  }
});

test('回归：三种模式的说明都不压遗物列', async ({ page }) => {
  await openMetaSelect(page);
  console.log('\n===== 三种模式说明 vs 遗物列 =====');
  for (const [i, want] of BLURBS.entries()) {
    if (i > 0) {
      // ←/→ 是玩家真实的模式切换入口
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(300);
    }
    const all = await boxes(page);
    const blurb = all.find((b) => BLURBS.includes(b.text));
    expect(blurb, `第 ${i} 次切换后找不到模式说明`).toBeTruthy();
    const relics = all.filter((b) => b.type === 'Text' && (b.text.startsWith('◆ ') || b.text.startsWith('◇ ')));
    const relicTop = relics.length ? Math.min(...relics.map((r) => r.top)) : Number.POSITIVE_INFINITY;
    const gap = relicTop - blurb!.bottom;
    console.log(
      `  ${want.slice(0, 14)}… ${blurb!.w}x${blurb!.h} y[${blurb!.top}..${blurb!.bottom}]` +
        ` | 遗物列从 y=${Number.isFinite(relicTop) ? relicTop : '—'} 起` +
        ` | 间距 ${Number.isFinite(gap) ? `${gap}px` : '无遗物'}${Number.isFinite(gap) && gap < 0 ? ' ★ 压住' : ''}`,
    );
    if (Number.isFinite(gap)) expect(gap, '模式说明压住了遗物列').toBeGreaterThanOrEqual(0);
  }
});