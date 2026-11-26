import { expect, test, type Page } from '@playwright/test';

// 文本装配回归防线：背包详情正文 与 夜宿压力行。
//
// 这两处都是「排版算错了」，不是「字符串写错了」，所以断言必须量渲染
// 结果，不能只查源码里的常量：
//
//   · 背包详情正文（invDetailBody）：中文没有空格，Phaser 的默认折行只在
//     空格处断行，于是 20 字的空槽文案（480px @24px）整行冲出面板 238px。
//   · 夜宿压力行：压力行引用最新一条日记（整句中文），同样冲出折行盒；
//     而 maxLines: 2 会把第三行整句悄悄删掉——井高 44 只够两行。
//
// 量三样东西：文字的渲染矩形、它所在「井」的矩形，以及这块文字自己的
// canvas 上有几条墨带。墨带数 = 真画出来的行数：Phaser 的 maxLines 是
// 在 GetTextSize 里截断绘制行数的，折行结果里有第 3 行而画布上只有 2 条
// 墨带，就说明第三行被丢了。

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface TextProbe {
  text: string;
  wrappedLines: string[];
  /** 每一折行是否真的画到了画布上（Phaser 的 maxLines 会静默丢掉后面的行）。 */
  paintedLines: boolean[];
  /** Phaser 自己算出来的绘制行数：GetTextSize 把 height 按 maxLines 截断。 */
  drawnLines: number;
  naturalWidth: number;
  maxLineWidth: number;
  wrapWidth: number;
  maxLines: number;
  bounds: Rect;
}

interface Layout {
  text: TextProbe;
  well: Rect;
  panelRight: number;
}

/** 页面里跑的测量器：给一个 Phaser Text，返回它的排版事实。 */
const MEASURE = `
(o) => {
  const style = o.style || {};
  if (style.syncFont) style.syncFont(o.canvas, o.context);
  const ctx = o.context;
  const raw = String(o.text || '');
  const naturalWidth = ctx.measureText(raw.replace(/\\n/g, '')).width;

  const rendered = typeof o.getWrappedText === 'function' ? o.getWrappedText() : [raw];
  let maxLineWidth = 0;
  for (const line of rendered) maxLineWidth = Math.max(maxLineWidth, ctx.measureText(line).width);

  // 逐行判断「这一折行到底画出来没有」。
  //
  // 不能只数墨带：相邻两行的墨迹会连成一条带（24px 的字配 25px 行高，
  // 墨迹几乎贴在一起），三行只数得出两条带。这里改成按行高算出每一行
  // 应占的像素带，逐带找墨。行带取上半段，免得下一行的字伸进来。
  const metrics = style.metrics || {};
  const lineHeight = (metrics.fontSize || 0) + (style.strokeThickness || 0);
  const canvas = o.canvas;
  const scale = canvas && o.height ? canvas.height / o.height : 1;
  const paintedLines = [];
  if (canvas && canvas.width > 0 && canvas.height > 0 && lineHeight > 0) {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < rendered.length; i++) {
      const top = Math.floor(i * lineHeight * scale);
      const bottom = Math.min(canvas.height, Math.ceil((i + 0.75) * lineHeight * scale));
      let ink = false;
      for (let y = top; y < bottom && !ink; y++) {
        for (let x = 0; x < canvas.width; x++) {
          if (data[(y * canvas.width + x) * 4 + 3] > 8) { ink = true; break; }
        }
      }
      paintedLines.push(ink);
    }
  }

  const b = o.getBounds();
  const padding = o.padding || { top: 0, bottom: 0, left: 0, right: 0 };
  return {
    text: raw,
    wrappedLines: rendered,
    paintedLines,
    drawnLines: lineHeight > 0 ? Math.round((Number(o.height) - padding.top - padding.bottom) / lineHeight) : 0,
    naturalWidth: Math.round(naturalWidth),
    maxLineWidth: Math.round(maxLineWidth),
    wrapWidth: Math.round(style.wordWrapWidth ?? 0),
    maxLines: style.maxLines ?? 0,
    bounds: { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), width: Math.round(b.width), height: Math.round(b.height) },
  };
}
`;

async function startGame(page: Page, seed: number): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Menu'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect'));
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Enter');
    const started = await page
      .waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'), undefined, { timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (started) break;
  }
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'));
  await page.waitForTimeout(900);
}

test('背包详情：空槽文案折行后既不冲出面板，也不顶出详情井', async ({ page }) => {
  await startGame(page, 42);

  // 真实玩法里这一格是搜刮来的面包：放进背包，等价于「刚搜到一格」。
  await page.evaluate(() => {
    const state = window.__PHASER_SESSION__?.getState();
    if (!state) throw new Error('no session state');
    state.player.inventory.slots.push({ itemId: 'bread', quantity: 1 });
  });

  // 走真键盘：I 开背包 → ↓ 到最后一格 → Enter 用掉它 → 光标落在空洞上。
  await page.keyboard.press('i');
  await page.waitForFunction(() =>
    Boolean((window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { inventoryOpen?: boolean } | null)?.inventoryOpen),
  );
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(60);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  const layout = await page.evaluate(
    ({ measureSrc }: { measureSrc: string }) => {
      const scene = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as {
        children: { list: Array<Record<string, unknown>> };
      };
      const list = scene.children.list as unknown as Array<{
        type: string;
        text?: string;
        visible: boolean;
        x: number;
        fillColor?: number;
        width: number;
        getBounds: () => DOMRect;
      }>;
      const body = list.find((o) => o.type === 'Text' && String(o.text ?? '').startsWith('空格子'));
      if (!body) return null;
      // 详情井：0x080c0f 且宽 > 100 的那块（背包格子只有 40 宽）。
      const well = list.find((o) => o.type === 'Rectangle' && o.fillColor === 0x080c0f && o.width > 100 && o.visible);
      if (!well) return null;
      // 面板右沿：边框片与填充带里宽 > 380 的那些的并集。
      const frames = list
        .filter((o) => o.type === 'Image' || o.type === 'Rectangle')
        .map((o) => o.getBounds())
        .filter((b) => b.width > 380 && b.width < 520);
      const measure = eval(measureSrc) as (o: unknown) => Omit<TextProbe, 'bounds'> & { bounds: Rect };
      const wb = well.getBounds();
      return {
        text: measure(body),
        well: { left: Math.round(wb.left), right: Math.round(wb.right), top: Math.round(wb.top), bottom: Math.round(wb.bottom), width: Math.round(wb.width), height: Math.round(wb.height) },
        panelRight: Math.round(Math.max(...frames.map((f) => f.right))),
      };
    },
    { measureSrc: MEASURE },
  );

  expect(layout, '空槽正文应已渲染（用掉最后一格之后光标停在空洞上）').not.toBeNull();
  const v = layout as Layout;
  const m = v.text;

  console.log(
    `[背包空槽] wrap=${m.wrapWidth} 自然宽=${m.naturalWidth} 渲染最宽行=${m.maxLineWidth} ` +
      `折行=${m.wrappedLines.length} 行 绘制=${m.drawnLines} 行 已画=${m.paintedLines.join(',')} | 正文 x[${m.bounds.left}..${m.bounds.right}] ` +
      `y[${m.bounds.top}..${m.bounds.bottom}] | 井 x[${v.well.left}..${v.well.right}] y[${v.well.top}..${v.well.bottom}] ` +
      `| 面板右沿 ${v.panelRight}`,
  );

  // 缺陷本体：中文没有空格，默认折行不生效，480px 整行冲出面板 238px。
  expect(m.wrappedLines.length, '空槽文案必须真的折行').toBeGreaterThan(1);
  expect(m.maxLineWidth, '每一行都必须在折行盒内').toBeLessThanOrEqual(m.wrapWidth);
  expect(m.bounds.right, '正文右沿不得越过面板右沿').toBeLessThanOrEqual(v.panelRight);
  // 折行后正文会变高，所以井必须跟着长高，否则正文顶出井底。
  expect(m.bounds.bottom, '正文底不得越过详情井底').toBeLessThanOrEqual(v.well.bottom);
  // 每一折行都得真的画出来。
  expect(m.paintedLines.every(Boolean), '每一折行都必须画出来').toBe(true);
  expect(m.drawnLines, '绘制行数不得少于折行数').toBeGreaterThanOrEqual(m.wrappedLines.length);
});

test('夜宿压力行：引用日记时整句都在，第三行被画出来且不冲出压力井', async ({ page }) => {
  await startGame(page, 42);

  // 夜宿门槛与床的位置只做状态设置（与 e2e/shelter.spec.ts 同一手法）；
  // 开面板、关面板、重开面板都走真按键。
  await page.evaluate(() => {
    const state = window.__PHASER_SESSION__?.getState();
    if (!state) throw new Error('no session state');
    state.gameMinuteOfDay = 1200;
    state.player.x = 1120;
  });
  await page.keyboard.press('e');
  await page.waitForFunction(() =>
    Boolean((window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { shelterOpen?: boolean } | null)?.shelterOpen),
  );

  // 最长的一条真实日记文案（ShelterSystem.ts 的「修理」那条，20 字）。
  // 写入状态是为了复现**最坏情况**，面板本身仍是真代码真按键建出来的。
  await page.keyboard.press('Escape');
  await page.waitForFunction(() =>
    !Boolean((window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { shelterOpen?: boolean } | null)?.shelterOpen),
  );
  await page.evaluate(() => {
    const state = window.__PHASER_SESSION__?.getState();
    if (!state) throw new Error('no session state');
    state.diary = [
      { kind: 'shelter_repaired', message: '你把宿舍门重新加固，夜里少了一处漏风口。' },
    ];
  });
  await page.keyboard.press('e');
  await page.waitForFunction(() =>
    Boolean((window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { shelterOpen?: boolean } | null)?.shelterOpen),
  );
  await page.waitForTimeout(300);

  const layout = await page.evaluate(
    ({ measureSrc }: { measureSrc: string }) => {
      const scene = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as {
        children: { list: Array<Record<string, unknown>> };
      };
      const list = scene.children.list as unknown as Array<{
        type: string;
        text?: string;
        visible: boolean;
        x: number;
        fillColor?: number;
        width: number;
        getBounds: () => DOMRect;
      }>;
      const line = list.find((o) => o.type === 'Text' && o.visible && String(o.text ?? '').startsWith('压力'));
      if (!line) return null;
      // 压力井：0x080c0f 且宽 > 200 的那块。
      const well = list.find((o) => o.type === 'Rectangle' && o.fillColor === 0x080c0f && o.width > 200 && o.visible);
      if (!well) return null;
      const measure = eval(measureSrc) as (o: unknown) => Omit<TextProbe, 'bounds'> & { bounds: Rect };
      const wb = well.getBounds();
      return {
        text: measure(line),
        well: { left: Math.round(wb.left), right: Math.round(wb.right), top: Math.round(wb.top), bottom: Math.round(wb.bottom), width: Math.round(wb.width), height: Math.round(wb.height) },
        panelRight: 0,
      };
    },
    { measureSrc: MEASURE },
  );

  expect(layout, '夜宿压力行应已渲染').not.toBeNull();
  const v = layout as Layout;
  const m = v.text;

  console.log(
    `[夜宿压力行] wrap=${m.wrapWidth} maxLines=${m.maxLines} 自然宽=${m.naturalWidth} 渲染最宽行=${m.maxLineWidth} ` +
      `折行=${m.wrappedLines.length} 行 绘制=${m.drawnLines} 行 已画=${m.paintedLines.join(',')} | 行 x[${m.bounds.left}..${m.bounds.right}] ` +
      `y[${m.bounds.top}..${m.bounds.bottom}] | 井 x[${v.well.left}..${v.well.right}] y[${v.well.top}..${v.well.bottom}]`,
  );
  for (const [i, text] of m.wrappedLines.entries()) console.log(`    L${i + 1}${m.paintedLines[i] ? ' 已画' : ' ★没画'}: "${text}"`);

  // 整句都在：折出来的每一行都要被画到画布上（maxLines 曾把第 3 行删掉）。
  expect(m.paintedLines.every(Boolean), '折出来的每一行都必须真的画出来').toBe(true);
  expect(m.drawnLines, '绘制行数不得少于折行数（maxLines 不得截断）').toBeGreaterThanOrEqual(m.wrappedLines.length);
  // 拼起来的折行结果必须等于原文：少一个字就是被截断了。
  expect(m.wrappedLines.join('').replace(/\s/g, ''), '折行后不能丢字').toBe(m.text.replace(/\s/g, ''));
  // 井必须放得下：井高 44 只够两行，三行会顶出井底。
  expect(m.bounds.bottom, '压力行底不得越过压力井底').toBeLessThanOrEqual(v.well.bottom);
  // 也不能横向冲出井（中文不断行时整句会冲出 56px）。
  expect(m.bounds.right, '压力行右沿不得越过压力井右沿').toBeLessThanOrEqual(v.well.right);
  // 最长那句要折成三行，第三行必须真的画出来。
  expect(m.wrappedLines.length, '最长的日记需要折成三行').toBe(3);
});
