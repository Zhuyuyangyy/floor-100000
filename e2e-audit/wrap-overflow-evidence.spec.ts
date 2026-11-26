import { expect, test } from '@playwright/test';

// 证据探针：把两处**实测溢出**拍成图，存进 docs/img/audit-2026-11-26/。
//
// 为什么单独一个文件：`wrap-inventory-table.spec.ts` 出的是数字表，评审看数字
// 要自己换算；这两张图是「看一眼就懂」的那一半证据，和 09b / _cmp 同一级别。
//
// 断言策略：**不锁「坏了」**。
// —— 2026-11-26 起，这两处已经修好（`1c37270`：开 `useAdvancedWrap` + 同步加高
// 详情井与压力井），所以本文件已从「取证」翻成「回归防线」：
//   钉的是「折行发生了、每一行都落在折行盒内、正文没有跑出面板、折行后不丢字」。
// 原来的取证断言（lines===1 / textRight>panelRight / maxLine>wrap）已按本文件
// 原注释里写好的翻法改掉，不再会红。改法见下面两处的注释。
//
// 两处都不是「代码里有长字符串」——它们都在真实交互路径上被抓到：
//   #8b 背包详情空槽 → 用掉最后一格，键盘光标停在 index === slots.length 上
//   #10 夜宿压力行    → 压力 100/100 且已有一条日记（任意一条夜宿记录都够）

const INV_SHOT = 'docs/img/audit-2026-11-26/14-inventory-empty-slot-overflow.png';
const SHELTER_SHOT = 'docs/img/audit-2026-11-26/15-shelter-stress-overflow.png';

test('背包详情：空槽文案按字符折行，不跑出面板', async ({ page }) => {
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

  // 回归防线（原为「缺陷本身」的取证断言，2026-11-26 按本文件原注释写好的翻法改）：
  //   `invDetailBody` 已开 `useAdvancedWrap` —— 中文没有空格，默认折行只在空格处断，
  //   整句被当成一个不可断的词，所以那 20 字文案曾经一行 480px 冲出面板 238px。
  // 现在它折成 3 行（最宽行 192 ≤ 折行盒 212），正文右沿 820 落在面板右沿 870 之内。
  expect(v.lines, '空槽文案必须真的折行（中文按字符折）').toBeGreaterThan(1);
  expect(v.textRight, '正文右沿不得越过面板右沿').toBeLessThanOrEqual(v.panelRight);
});

test('夜宿压力行：每一折行落在折行盒内，折行后不丢字', async ({ page }) => {
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
      // 折行后拼回来的字 vs 原文：用来判「有没有被 maxLines 静默截断」。
      joined: rendered.join(''),
      sourceText: line.text,
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

  // 回归防线（原为「缺陷本身」的取证断言，2026-11-26 改）：
  //   压力行已开 `useAdvancedWrap`，`maxLines` 由 2 提到 3，压力井由 44 加到 72。
  //   ⚠️ 旧注释里「第三行被静默删掉」**经实测并不成立**：修前那行只折成 2 行、
  //   两行都画出来了，没有第三行可丢。真正的缺陷是**横向**——最宽行 460 vs
  //   折行盒 452（超 8px），最长那条渲染 x[414..934]，冲出压力井右沿 878 达 56px。
  //   另有一个潜在坑：井高 44 只容 2 行、`maxLines:2`，一旦按字符折行就会
  //   静默删掉第三行——这才是改 `maxLines` 与井高的原因。
  expect(v.maxLine, '每一折行都必须落在折行盒内').toBeLessThanOrEqual(Math.round(v.wrap));
  expect(v.lines, '折行后不能丢字（maxLines 不得静默截断整句）').toBeGreaterThanOrEqual(2);
  expect(
    v.joined.replace(/\s/g, ''),
    '折行后拼回来的字必须与原文逐字相同（不得静默截断）',
  ).toBe(v.sourceText.replace(/\s/g, ''));
});