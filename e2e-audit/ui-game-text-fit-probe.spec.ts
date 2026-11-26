import { expect, test, type Page } from '@playwright/test';

// 文本装配探针：背包详情正文 与 夜宿压力行。
//
// 目的：把两处「排版缺陷」从「看起来不对」变成可复现的数字。
//
// 量法（全部来自运行中的 Phaser 场景，不是从源码推的）：
//   naturalWidth  用该 Text 自己的 canvas context 把整串当单行量一次
//   wrappedLines  getWrappedText() —— 折行算法真正切出来的所有行
//   inkBands      读该 Text 自己的 canvas 的像素，按行聚类出的「有墨的行带」
//                 这是「屏幕上真的画出来了」的硬证据：
//                 maxLines 截断时，wrappedLines 有 3 行但 canvas 上只有 2 条墨带
//   drawnLines    GetTextSize 用来算高度的 drawnLines（受 maxLines 限制）
//   lineHeight    style.metrics.fontSize + strokeThickness（GetTextSize 的算法）
//
// 报告里同时给出「井」和「面板」的矩形，用来算两个方向的溢出量。

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface TextMeasure {
  text: string;
  fontSize: string;
  lineHeight: number;
  naturalWidth: number;
  maxLineWidth: number;
  wrappedLines: string[];
  drawnLines: number;
  inkBands: number;
  objectHeight: number;
  bounds: Rect;
}

interface Probe {
  ok: boolean;
  measure?: TextMeasure;
  well?: Rect;
  panel?: Rect;
  stack?: Array<{ text: string; bounds: Rect }>;
  note?: string;
}

/** 页面里跑的通用测量器：给一个 Text 对象，返回它的排版事实。 */
const MEASURE_TEXT = `
(o) => {
  const style = o.style || {};
  if (style.syncFont) style.syncFont(o.canvas, o.context);
  const ctx = o.context;
  const raw = String(o.text || '');
  const flat = raw.replace(/\\n/g, '');
  const naturalWidth = ctx.measureText(flat).width;

  const rendered = typeof o.getWrappedText === 'function'
    ? o.getWrappedText()
    : String(o._text || raw).split('\\n');
  let maxLineWidth = 0;
  for (const line of rendered) maxLineWidth = Math.max(maxLineWidth, ctx.measureText(line).width);

  // 该 Text 自己的 canvas 上，逐行找「有墨」的行，再把连续行聚成墨带。
  // 墨带数 = 屏幕上真正画出来的行数。
  let inkBands = 0;
  const canvas = o.canvas;
  if (canvas && canvas.width > 0 && canvas.height > 0) {
    try {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let inBand = false;
      for (let y = 0; y < canvas.height; y++) {
        let ink = false;
        for (let x = 0; x < canvas.width; x++) {
          if (data[(y * canvas.width + x) * 4 + 3] > 8) { ink = true; break; }
        }
        if (ink && !inBand) { inkBands++; inBand = true; }
        else if (!ink) { inBand = false; }
      }
    } catch (e) { /* 跨域画布读不到像素时退回到 drawnLines */ }
  }

  const metrics = style.metrics || {};
  const lineHeight = (metrics.fontSize || 0) + (style.strokeThickness || 0);
  const b = o.getBounds();
  const padding = o.padding || { left: 0, right: 0, top: 0, bottom: 0 };
  return {
    text: raw,
    fontSize: String(style.fontSize || ''),
    lineHeight: Math.round(lineHeight * 100) / 100,
    naturalWidth: Math.round(naturalWidth),
    maxLineWidth: Math.round(maxLineWidth),
    wrappedLines: rendered,
    drawnLines: lineHeight > 0 ? Math.round((Number(o.height) - padding.top - padding.bottom) / lineHeight) : 0,
    inkBands,
    objectHeight: Math.round(Number(o.height)),
    bounds: { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), width: Math.round(b.width), height: Math.round(b.height) },
  };
}
`;

/** 把 Phaser 的 DOMRect 转成普通对象，好过 JSON。 */
const RECT = `
(b) => ({ left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), width: Math.round(b.width), height: Math.round(b.height) })
`;

async function boot(page: Page): Promise<void> {
  await page.goto('/?seed=42&debug=1');
  await page.waitForFunction(() =>
    window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Menu'),
  );
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect'),
  );
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(220);
    const inGame = await page.evaluate(() =>
      Boolean(window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game')),
    );
    if (inGame) break;
  }
  await page.waitForFunction(() =>
    window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'),
  );
  await page.waitForTimeout(900);
}

/** 背包：找 0x080c0f 且宽 > 100 的那块 —— 也就是详情井（格子只有 40 宽）。 */
const FIND_INV_WELL = `
(scene) => {
  const list = scene.children.list;
  const well = list.find((o) => o.type === 'Rectangle' && o.fillColor === 0x080c0f && Number(o.width) > 100 && o.visible);
  return well ? well.getBounds() : null;
}
`;

test('probe: 背包详情正文的排版事实', async ({ page }) => {
  await boot(page);

  // 真实玩法里这一格是搜刮来的面包；直接放进背包，等价于「刚搜到一格」。
  await page.evaluate(() => {
    const st = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { inventory: { slots: unknown[] } } } } }).__PHASER_SESSION__!.getState();
    st.player.inventory.slots.push({ itemId: 'bread', quantity: 1 });
  });
  await page.evaluate(() => {
    (window.__PHASER_GAME__!.scene.getScene('Game') as unknown as { onToggleInventory: () => void }).onToggleInventory();
  });
  await page.waitForTimeout(500);
  // 走键盘：↓ 到最后一格，Enter 吃掉它 → 光标落在空洞上，正文变成「空格子…」
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(60);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  const r = await page.evaluate(
    ({ measureSrc, rectSrc, wellSrc }: { measureSrc: string; rectSrc: string; wellSrc: string }) => {
      const scene = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as {
        children: { list: Array<Record<string, unknown>> };
      };
      const list = scene.children.list;
      const body = list.find((o) => o.type === 'Text' && String(o.text ?? '').startsWith('空格子')) as
        | (Record<string, unknown> & { getBounds: () => DOMRect })
        | undefined;
      if (!body) return { ok: false, note: '没找到空槽正文' };
      const measure = eval(measureSrc) as (o: unknown) => Record<string, unknown>;
      const rect = eval(rectSrc) as (b: DOMRect) => Record<string, number>;
      const findWell = eval(wellSrc) as (scene: unknown) => DOMRect | null;

      // 面板右沿：8 片边框 + 5 条填充带里，宽 > 380 的那些的并集。
      const frames = list
        .filter((o) => o.type === 'Image' || o.type === 'Rectangle')
        .map((o) => (o as unknown as { getBounds?: () => DOMRect }).getBounds?.())
        .filter((x): x is DOMRect => Boolean(x) && x.width > 380 && x.width < 520);
      const panelLeft = Math.min(...frames.map((f) => f.left));
      const panelRight = Math.max(...frames.map((f) => f.right));
      const wellRect = findWell(scene);

      // 详情井里的三行文本（标题 / 副标题 / 正文）：正文不能压到前两行上面，
      // 也不能掉出井底。
      const wellBounds = wellRect ? wellRect : null;
      const stack = wellBounds
        ? list
            .filter((o) => o.type === 'Text' && o.visible && Number((o as unknown as { x: number }).x) >= wellBounds.left && Number((o as unknown as { x: number }).x) <= wellBounds.right)
            .map((o) => ({ text: String(o.text ?? ''), bounds: rect((o as unknown as { getBounds: () => DOMRect }).getBounds()) }))
        : [];

      return {
        ok: true,
        measure: measure(body),
        well: wellRect ? rect(wellRect) : undefined,
        panel: { left: Math.round(panelLeft), right: Math.round(panelRight) },
        stack,
      };
    },
    { measureSrc: MEASURE_TEXT, rectSrc: RECT, wellSrc: FIND_INV_WELL },
  );

  await page.screenshot({ path: 'e2e-audit/shots/inv-detail-fit.png' });

  const p = r as Probe;
  expect(p.ok, p.note).toBe(true);
  const m = p.measure!;
  const well = p.well!;
  const panel = p.panel!;

  console.log('\n===== 背包详情正文（空槽文案）=====');
  console.log(`  文案: "${m.text}" (${m.text.length} 字)`);
  console.log(`  字号=${m.fontSize} 行高=${m.lineHeight}px`);
  console.log(`  自然宽=${m.naturalWidth} 渲染最宽行=${m.maxLineWidth}`);
  console.log(`  折行行数=${m.wrappedLines.length} 实际绘制行数=${m.drawnLines} canvas 墨带=${m.inkBands}`);
  for (const [i, line] of m.wrappedLines.entries()) console.log(`    L${i + 1}: "${line}"`);
  console.log(`  正文 x[${m.bounds.left}..${m.bounds.right}] y[${m.bounds.top}..${m.bounds.bottom}]`);
  console.log(`  详情井 x[${well.left}..${well.right}] y[${well.top}..${well.bottom}] 高=${well.height}`);
  console.log(`  面板 x[${panel.left}..${panel.right}]`);
  console.log(`  → 横向溢出 ${m.bounds.right - panel.right}px | 纵向溢出井底 ${m.bounds.bottom - well.bottom}px`);
  for (const row of (p as unknown as { stack: Array<{ text: string; bounds: Rect }> }).stack ?? []) {
    console.log(`    井内 "${row.text}" y[${row.bounds.top}..${row.bounds.bottom}] x[${row.bounds.left}..${row.bounds.right}]`);
  }

  expect(m.wrappedLines.length).toBeGreaterThan(0);
  expect(well.height).toBeGreaterThan(0);
});

test('probe: 夜宿压力行的排版事实', async ({ page }) => {
  await boot(page);

  // 真实世界里会出现的那几条日记文案（来自 ShelterSystem / encounters）。
  const MESSAGES = [
    '你把宿舍门重新加固，夜里少了一处漏风口。',
    '你空着手冲上去，被它撕碎了希望，侥幸爬了回来。',
    '夜里有人撞门；你庆幸自己还来得及醒来。',
  ];

  for (const message of MESSAGES) {
    const r = await page.evaluate(
      ({ msg, measureSrc, rectSrc }: { msg: string; measureSrc: string; rectSrc: string }) => {
        const st = (window as unknown as { __PHASER_SESSION__?: { getState: () => Record<string, unknown> } }).__PHASER_SESSION__!.getState() as {
          player: { stress?: number };
          diary?: unknown[];
        };
        st.player.stress = 100;
        st.diary = [{ id: 'probe', day: 1, minute: 1300, kind: 'shelter', message: msg, stressDelta: 0 }];

        const scene = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as {
          children: { list: Array<Record<string, unknown>> };
          buildShelterPanel: () => void;
        };
        const before = new Set(scene.children.list);
        scene.buildShelterPanel();
        const fresh = scene.children.list.filter((o) => !before.has(o));
        const line = fresh.find((o) => o.type === 'Text' && String(o.text ?? '').startsWith('压力')) as
          | (Record<string, unknown> & { getBounds: () => DOMRect })
          | undefined;
        if (!line) return { ok: false, note: '没找到压力行' };

        // 压力井：0x080c0f 的矩形，宽 476（panelW-24）。
        const well = fresh.find(
          (o) => o.type === 'Rectangle' && o.fillColor === 0x080c0f && Number(o.width) > 200,
        ) as (Record<string, unknown> & { getBounds: () => DOMRect }) | undefined;

        const measure = eval(measureSrc) as (o: unknown) => Record<string, unknown>;
        const rect = eval(rectSrc) as (b: DOMRect) => Record<string, number>;
        const style = (line as unknown as { style: Record<string, unknown> }).style;

        // 面板右沿：8 片边框 + 5 条填充带里，宽 > 380 的那些的并集。
        const frames = scene.children.list
          .filter((o) => o.type === 'Image' || o.type === 'Rectangle')
          .map((o) => (o as unknown as { getBounds?: () => DOMRect }).getBounds?.())
          .filter((x): x is DOMRect => Boolean(x) && x.width > 380 && x.width < 560);
        const panelLeft = Math.min(...frames.map((f) => f.left));
        const panelRight = Math.max(...frames.map((f) => f.right));

        return {
          ok: true,
          measure: measure(line),
          well: well ? rect(well.getBounds()) : undefined,
          panel: { left: Math.round(panelLeft), right: Math.round(panelRight) },
          maxLines: (style.maxLines as number | undefined) ?? 0,
          // Phaser 4 keeps the wrap width in style.wordWrapWidth; the
          // wordWrap object itself is not carried on the style.
          wrapWidth: (style.wordWrapWidth as number | undefined) ?? ((style.wordWrap as { width?: number } | undefined)?.width ?? 0),
        };
      },
      { msg: message, measureSrc: MEASURE_TEXT, rectSrc: RECT },
    );

    const p = r as Probe & { maxLines: number; wrapWidth: number };
    expect(p.ok, p.note).toBe(true);
    const m = p.measure!;
    const well = p.well!;

    console.log(`\n===== 夜宿压力行 · 日记「${message}」（${message.length} 字）=====`);
    console.log(`  文案: "${m.text}"`);
    console.log(`  字号=${m.fontSize} 行高=${m.lineHeight}px wrap=${Math.round(p.wrapWidth)} maxLines=${p.maxLines}`);
    console.log(`  自然宽=${m.naturalWidth} 渲染最宽行=${m.maxLineWidth}`);
    console.log(`  折行行数=${m.wrappedLines.length} 实际绘制行数=${m.drawnLines} canvas 墨带=${m.inkBands}`);
    for (const [i, line] of m.wrappedLines.entries()) {
      const painted = i < m.inkBands ? '已画' : '★ 没画';
      console.log(`    L${i + 1} ${painted}: "${line}"`);
    }
    console.log(`  压力行 x[${m.bounds.left}..${m.bounds.right}] y[${m.bounds.top}..${m.bounds.bottom}]`);
    console.log(`  压力井 x[${well.left}..${well.right}] y[${well.top}..${well.bottom}] 高=${well.height}`);
    console.log(`  面板 x[${p.panel?.left}..${p.panel?.right}]`);
    console.log(`  → 横向溢出井右沿 ${m.bounds.right - well.right}px | 横向溢出面板右沿 ${m.bounds.right - (p.panel?.right ?? 0)}px`);
    console.log(`  → 纵向溢出井底 ${m.bounds.bottom - well.bottom}px`);
    console.log(`  → 折行了 ${m.wrappedLines.length} 行但只画了 ${m.inkBands} 行`);

    expect(m.wrappedLines.length).toBeGreaterThan(0);
  }

  await page.screenshot({ path: 'e2e-audit/shots/shelter-stress-fit.png' });
});
