import { expect, test } from '@playwright/test';

// 证据探针：把两处**实测溢出**拍成图，存进 docs/img/audit-2026-11-26/。
//
// 为什么单独一个文件：`wrap-inventory-table.spec.ts` 出的是数字表，评审看数字
// 要自己换算；这两张图是「看一眼就懂」的那一半证据，和 09b / _cmp 同一级别。
//
// 断言策略：**不锁「坏了」**。这里钉的是「溢出确实存在」（这是当前事实，
// 修好之后这条会红，届时把 toBeLessThanOrEqual 翻过来就是回归防线），
// 并在注释里写清翻法，避免下一个人把它当 flake 删掉。
//
// 两处都不是「代码里有长字符串」——它们都在真实交互路径上被抓到：
//   #8b 背包详情空槽 → 用掉最后一格，键盘光标停在 index === slots.length 上
//   #10 夜宿压力行    → 压力 100/100 且已有一条日记（任意一条夜宿记录都够）

const INV_SHOT = 'docs/img/audit-2026-11-26/14-inventory-empty-slot-overflow.png';
const SHELTER_SHOT = 'docs/img/audit-2026-11-26/15-shelter-stress-overflow.png';

test('背包详情：空槽文案横向跑出面板 238px', async ({ page }) => {
  await page.goto('/?seed=42&debug=1');
  await page.waitForFunction(() => Boolean(window.__PHASER_GAME__));
  await page.waitForFunction(() => window.__PHASER_GAME__!.scene.getScenes(true).some((s) => s.scene.key === 'Menu'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect'));
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(120);
  }
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'), undefined, { timeout: 20_000 });
  await page.waitForTimeout(900);

  // 真实玩法里这一格是搜刮来的面包；这里直接放进背包，等价于「刚搜到一格」。
  await page.evaluate(() => {
    const st = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { inventory: { slots: unknown[] } } } } }).__PHASER_SESSION__!.getState();
    st.player.inventory.slots.push({ itemId: 'bread', quantity: 1 });
  });
  await page.evaluate(() => {
    (window.__PHASER_GAME__!.scene.getScene('Game') as unknown as { onToggleInventory: () => void }).onToggleInventory();
  });
  await page.waitForTimeout(500);

  // 走键盘：↓ 到最后一格，Enter 吃掉它 → 光标落在 index === slots.length 的空洞上
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(60);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  const r = await page.evaluate(() => {
    const scene = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as {
      children: { list: Array<Record<string, unknown>> };
    };
    const body = scene.children.list.find((o) => o.type === 'Text' && String(o.text ?? '').startsWith('空格子')) as unknown as {
      text: string;
      getBounds: () => DOMRect;
      getWrappedText?: () => string[];
      style: { wordWrapWidth?: number; wordWrap?: { width?: number } };
    } | undefined;
    if (!body) return null;
    const b = body.getBounds();
    // 背包面板是 8 片 Image 拼的边框，取覆盖 440 宽那一片求并集
    const frames = scene.children.list
      .filter((o) => o.type === 'Image' || o.type === 'Rectangle')
      .map((o) => (o as unknown as { getBounds?: () => DOMRect }).getBounds?.())
      .filter((x): x is DOMRect => Boolean(x) && x.width > 380 && x.width < 520);
    const panelLeft = Math.min(...frames.map((f) => f.left));
    const panelRight = Math.max(...frames.map((f) => f.right));
    return {
      text: body.text,
      wrap: body.style.wordWrap?.width ?? body.style.wordWrapWidth ?? 0,
      lines: body.getWrappedText?.().length ?? 1,
      textLeft: Math.round(b.left),
      textRight: Math.round(b.right),
      textWidth: Math.round(b.width),
      panelLeft: Math.round(panelLeft),
      panelRight: Math.round(panelRight),
    };
  });

  expect(r, '空槽正文应已渲染（用掉最后一格之后光标停在空洞上）').not.toBeNull();
  const v = r!;
  await page.screenshot({ path: INV_SHOT });

  console.log(
    `\n[背包空槽] wrap=${v.wrap} 行=${v.lines} 正文 x[${v.textLeft}..${v.textRight}] 宽 ${v.textWidth}` +
      ` | 面板 x[${v.panelLeft}..${v.panelRight}] → 跑出右沿 ${v.textRight - v.panelRight}px`,
  );
  console.log(`    "${v.text}"`);

  // 已知缺陷。修好（开 useAdvancedWrap）后这两条会红：
  //   lines 会变成 2~3，right 会落回 panelRight 之内。
  // 届时改成：expect(v.lines).toBeGreaterThan(1) 与
  //          expect(v.textRight).toBeLessThanOrEqual(v.panelRight)
  // 就变成回归防线。
  expect(v.lines, '当前未开 advancedWrap，中文零折行（缺陷本身）').toBe(1);
  expect(v.textRight, '当前正文右沿越过面板右沿（缺陷本身）').toBeGreaterThan(v.panelRight);
});

test('夜宿压力行：最宽行超出 wrap 8px，且已用满 maxLines 2', async ({ page }) => {
  await page.goto('/?seed=42&debug=1');
  await page.waitForFunction(() => Boolean(window.__PHASER_GAME__));
  await page.waitForFunction(() => window.__PHASER_GAME__!.scene.getScenes(true).some((s) => s.scene.key === 'Menu'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect'));
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(120);
  }
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'), undefined, { timeout: 20_000 });
  await page.waitForTimeout(900);

  const r = await page.evaluate(() => {
    const st = (window as unknown as { __PHASER_SESSION__?: { getState: () => Record<string, unknown> } }).__PHASER_SESSION__!.getState() as {
      player: { stress?: number };
      diary?: unknown[];
    };
    // 最长形态：压力打满 + 一条真实夜宿日记（文案取自 ShelterSystem.ts:117）
    st.player.stress = 100;
    st.diary = [{ id: 'probe', day: 1, minute: 1300, kind: 'shelter', message: '你把宿舍门重新加固，夜里少了一处漏风口。', stressDelta: 0 }];

    const scene = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as {
      children: { list: Array<Record<string, unknown>> };
      buildShelterPanel: () => void;
    };
    const before = new Set(scene.children.list);
    scene.buildShelterPanel();
    const line = scene.children.list.find((o) => !before.has(o) && o.type === 'Text' && String(o.text ?? '').startsWith('压力')) as unknown as {
      text: string;
      getBounds: () => DOMRect;
      getWrappedText?: () => string[];
      style: { wordWrapWidth?: number; wordWrap?: { width?: number }; maxLines?: number };
    } | undefined;
    if (!line) return null;
    const b = line.getBounds();
    const style = line.style;
    const ctx = (line as unknown as { context: CanvasRenderingContext2D }).context;
    const rendered = line.getWrappedText?.() ?? [line.text];
    let maxLine = 0;
    for (const l of rendered) maxLine = Math.max(maxLine, ctx.measureText(l).width);
    return {
      text: line.text,
      wrap: style.wordWrap?.width ?? style.wordWrapWidth ?? 0,
      maxLines: style.maxLines ?? null,
      lines: rendered.length,
      maxLine: Math.round(maxLine),
      left: Math.round(b.left),
      right: Math.round(b.right),
      h: Math.round(b.height),
    };
  });

  expect(r, '夜宿压力行应已渲染').not.toBeNull();
  const v = r!;
  // 面板开着才拍得到；buildShelterPanel 直接调用时对象是可见的。
  await page.screenshot({ path: SHELTER_SHOT });

  console.log(
    `\n[夜宿压力行] wrap=${Math.round(v.wrap)} maxLines=${v.maxLines} 行=${v.lines} 最宽行=${v.maxLine}` +
      ` → 超 wrap ${v.maxLine - Math.round(v.wrap)}px | 高 ${v.h} x[${v.left}..${v.right}]`,
  );
  console.log(`    "${v.text}"`);

  // 已知缺陷：最后一行比 wrap 宽 8px，有 maxLines:2 兜住高度所以不会再长高，
  // 但末字压住右侧内衬。修法是 wrap 收到 panelW-56 或加 useAdvancedWrap。
  expect(v.maxLine, '最宽行超出 wrap（缺陷本身）').toBeGreaterThan(Math.round(v.wrap));
  expect(v.lines, '已被 maxLines:2 截断，不会再长高（缺陷的边界）').toBeLessThanOrEqual(2);
});