import { expect, test, type Page } from '@playwright/test';

// 只读探针：全仓 14 处 wordWrap 的逐条实测。
//
// 报告 P0-2 要求一张表：文件:行 / 当前 wrap 宽度 / 实测自然宽度 / 是否溢出 / 处置。
// 这张表的每一格数字都从运行中的 Phaser 场景量出来，不是从源码推的。
//
// 量法：
//   naturalWidth = 用该 Text 自己的 canvas context，把整串（去掉换行）当单行量一次。
//                  这就是「不折行时它要多宽」。
//   lines        = 该 Text 当前真实渲染出来的行数（getWrappedText）。
//   maxLineWidth = 渲染后每一行里最宽的那一行。
//   overflow     = maxLineWidth > wrapWidth + 0.5 → 真的越出 wrap 盒。
//   needsWrap    = naturalWidth > wrapWidth + 0.5 → 这串本来必须折行。
//
// 「必须折行却没折」才是缺陷（needsWrap && lines === 1）。needsWrap 为 false 的
// 地方（bagFullText / hud-feedback 之类）不需要动。
//
// 另外量一个汉字在该字号下的字宽，用来算「每个 wrap 宽度能装几个汉字」——
// 这是给那些文案由运行时拼出来、无法预先取到实例的面板（战斗日志 / 遭遇结果 /
// 夜宿压力行）用的容量上限。

interface WrapRow {
  scene: string;
  name: string;
  text: string;
  fontSize: string;
  wrapWidth: number | null;
  advanced: boolean;
  naturalWidth: number;
  maxLineWidth: number;
  lines: number;
  needsWrap: boolean;
  overflow: boolean;
}

const MEASURE = `
  (o) => {
    const style = o.style || {};
    if (style.syncFont) style.syncFont(o.canvas, o.context);
    const ctx = o.context;
    const raw = String(o.text || '');
    const flat = raw.replace(/\\n/g, '');
    const naturalWidth = ctx.measureText(flat).width;
    // 必须走 getWrappedText()：_text 是原串（未折行），updateText 把折行结果
    // 存在局部变量里，不写回 _text。直接 split(_text) 会把 4 行的文本量成 1 行。
    const rendered = typeof o.getWrappedText === 'function'
      ? o.getWrappedText()
      : String(o._text || raw).split('\\n');
    let maxLineWidth = 0;
    for (const line of rendered) maxLineWidth = Math.max(maxLineWidth, ctx.measureText(line).width);
    return { naturalWidth, maxLineWidth, lines: rendered.length };
  }
`;

async function dumpWraps(page: Page, sceneKey: string): Promise<WrapRow[]> {
  return page.evaluate(
    ({ key, measureSrc }: { key: string; measureSrc: string }) => {
      const g = (window as unknown as {
        __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: unknown[] } } | null } };
      }).__PHASER_GAME__;
      const scene = g?.scene.getScene(key);
      const list = (scene?.children.list ?? []) as Array<Record<string, unknown>>;
      const measure = eval(measureSrc) as (o: Record<string, unknown>) => {
        naturalWidth: number;
        maxLineWidth: number;
        lines: number;
      };
      const out: WrapRow[] = [];
      for (const o of list) {
        if (o.type !== 'Text') continue;
        if (!o.visible) continue;
        const style = (o.style ?? {}) as { wordWrapWidth?: number; fontSize?: string; wordWrapUseAdvanced?: boolean };
        const wrap = (o.style as { wordWrap?: { width?: number; useAdvancedWrap?: boolean } } | undefined)?.wordWrap;
        const wrapWidth = wrap?.width ?? style.wordWrapWidth ?? null;
        if (wrapWidth === null || wrapWidth <= 0) continue;
        const text = String(o.text ?? '');
        if (text.length === 0) continue;
        const m = measure(o);
        out.push({
          scene: key,
          name: String(o.name ?? ''),
          text,
          fontSize: style.fontSize ?? '',
          wrapWidth,
          advanced: Boolean(wrap?.useAdvancedWrap ?? style.wordWrapUseAdvanced),
          naturalWidth: Math.round(m.naturalWidth),
          maxLineWidth: Math.round(m.maxLineWidth),
          lines: m.lines,
          needsWrap: m.naturalWidth > wrapWidth + 0.5,
          overflow: m.maxLineWidth > wrapWidth + 0.5,
        });
      }
      return out;
    },
    { key: sceneKey, measureSrc: MEASURE },
  );
}

function report(rows: WrapRow[], label: string): void {
  console.log(`\n===== ${label} =====`);
  if (!rows.length) {
    console.log('  （本场景当前没有可见的 wordWrap 文本）');
    return;
  }
  for (const r of rows) {
    const verdict = r.overflow
      ? '★ 溢出'
      : r.needsWrap && r.lines === 1
        ? '★ 该折没折'
        : r.needsWrap
          ? '已折行 ok'
          : '单行放得下 ok';
    console.log(
      `  [${r.scene}] ${r.name || '(无名)'} fs=${r.fontSize} wrap=${Math.round(r.wrapWidth)} ` +
        `自然宽=${r.naturalWidth} 渲染最宽=${r.maxLineWidth} 行数=${r.lines} adv=${r.advanced} → ${verdict}`,
    );
    console.log(`      "${r.text.replace(/\n/g, '⏎').slice(0, 70)}"`);
  }
}

async function seedStart(page: Page): Promise<void> {
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

// ── 1. 标题页的帮助面板（MenuScene:328）────────────────────────────────────
test('probe: 帮助面板的中文折行', async ({ page }) => {
  await page.goto('/?seed=42&debug=1');
  await page.waitForFunction(() =>
    window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Menu'),
  );
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const s = window.__PHASER_GAME__!.scene.getScene('Menu') as unknown as { toggleHelp: () => void };
    s.toggleHelp();
  });
  await page.waitForTimeout(400);
  const rows = await dumpWraps(page, 'Menu');
  report(rows, 'MenuScene 帮助面板（MenuScene.ts:328）');
  expect(rows.length).toBeGreaterThan(0);
});

// ── 2. 角色选择（MetaSelectScene:108 / 175 / 182）────────────────────────────
test('probe: 角色选择的说明与模式文案', async ({ page }) => {
  await page.goto('/?seed=42&debug=1');
  await page.waitForFunction(() =>
    window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Menu'),
  );
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect'),
  );
  await page.waitForTimeout(700);
  const rows = await dumpWraps(page, 'MetaSelect');
  report(rows, 'MetaSelectScene 横屏（MetaSelectScene.ts:108/175）');

  // 三个角色各看一次，说明文字长度不同
  for (const idx of [1, 2, 3]) {
    await page.evaluate((i) => {
      const s = window.__PHASER_GAME__!.scene.getScene('MetaSelect') as unknown as { selectCharacter: (i: number) => void };
      s.selectCharacter(i);
    }, idx);
    await page.waitForTimeout(220);
    const one = (await dumpWraps(page, 'MetaSelect')).filter((r) => Math.abs(r.wrapWidth - 132) < 1);
    for (const r of one) {
      console.log(`  角色#${idx} 说明："${r.text}" 自然宽=${r.naturalWidth} 渲染宽=${r.maxLineWidth} wrap=132 行数=${r.lines}`);
    }
  }
  expect(rows.length).toBeGreaterThan(0);
});

// ── 3. 游戏内 HUD + 背包（GameScene:2466 / 2470 / 2481 / 2800）───────────────
test('probe: HUD 与背包的 wrap 文本', async ({ page }) => {
  await seedStart(page);
  const hudRows = (await dumpWraps(page, 'Game')).filter(
    (r) => r.name === 'hud-feedback' || r.name === 'hud-bag-full' || r.name === 'hud-hint',
  );
  report(hudRows, 'GameScene HUD（2466/2470/2481）');

  await page.evaluate(() => {
    const s = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as { onToggleInventory: () => void };
    s.onToggleInventory();
  });
  await page.waitForTimeout(800);
  const invRows = (await dumpWraps(page, 'Game')).filter((r) => r.wrapWidth > 100 && r.scene === 'Game');
  report(invRows, 'GameScene 背包打开后');
  expect(hudRows.length).toBeGreaterThan(0);
});

// ── 4. 对话框：同一串长文本，开/不开 advanced 的对照 ────────────────────────
//
// 这一条不依赖对话面板是否打开：它直接把「同一份样式、同一句台本」建成两个
// Text，一个带 useAdvancedWrap，一个不带，量出两个结果。这就是 P0-1 的修法证据。
test('probe: 对话框长台词 开/不开 advanced 对照', async ({ page }) => {
  await seedStart(page);
  const result = await page.evaluate(() => {
    const s = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as {
      viewSize: () => { width: number };
      portraitMode: boolean;
      add: { text: (x: number, y: number, t: string, style: Record<string, unknown>) => Record<string, unknown> };
      children: { list: unknown[] };
    };
    const vw = s.viewSize().width;
    const panelW = s.portraitMode ? Math.min(460, vw - 24) : 460;
    const wrapW = panelW - 44;

    // 一段真实会出现的 AI 台词长度：40 字，不加标点空格。
    const line =
      '这栋楼里已经很久没有人来过了，你身上带的东西够换一顿饭吗，还是说你只是想找个地方躲一晚上，我们这里不养闲人。';
    const style = { fontFamily: "'ArkPixel Latin', 'ArkPixel ZH', sans-serif", fontSize: '24px', color: '#ece8d8', align: 'center' };

    const make = (advanced: boolean) =>
      s.add.text(0, 0, line, { ...style, wordWrap: { width: wrapW, useAdvancedWrap: advanced } });

    const plain = make(false);
    const adv = make(true);
    const measure = (o: Record<string, unknown>) => {
      const st = o.style as { syncFont?: (c: unknown, x: unknown) => void };
      st.syncFont?.((o as { canvas: unknown }).canvas, (o as { context: unknown }).context);
      const ctx = (o as { context: CanvasRenderingContext2D }).context;
      const raw = String(o.text ?? '').replace(/\n/g, '');
      const rendered =
        typeof o.getWrappedText === 'function'
          ? (o.getWrappedText() as string[])
          : String((o as { _text?: string })._text ?? o.text ?? '').split('\n');
      let maxLine = 0;
      for (const l of rendered) maxLine = Math.max(maxLine, ctx.measureText(l).width);
      return {
        natural: Math.round(ctx.measureText(raw).width),
        maxLine: Math.round(maxLine),
        lines: rendered.length,
        height: Math.round(Number(o.height ?? 0)),
        width: Math.round(Number(o.width ?? 0)),
      };
    };
    const a = measure(plain);
    const b = measure(adv);
    (plain as { destroy: () => void }).destroy();
    (adv as { destroy: () => void }).destroy();
    return { panelW, wrapW, textLen: line.length, plain: a, adv: b };
  });

  console.log('\n===== 对话框长台词（40 字）=====');
  console.log(`panelW=${result.panelW} wrapWidth=${result.wrapW} 字数=${result.textLen}`);
  console.log(
    `  不开 advanced：自然宽=${result.plain.natural} 渲染最宽=${result.plain.maxLine} 行数=${result.plain.lines} 高=${result.plain.height} → ` +
      (result.plain.maxLine > result.wrapW + 0.5 ? `★ 横向溢出 ${result.plain.maxLine - result.wrapW}px` : 'ok'),
  );
  console.log(
    `  开 advanced  ：自然宽=${result.adv.natural} 渲染最宽=${result.adv.maxLine} 行数=${result.adv.lines} 高=${result.adv.height} → ` +
      (result.adv.maxLine > result.wrapW + 0.5 ? `★ 仍溢出 ${result.adv.maxLine - result.wrapW}px` : 'ok'),
  );
  expect(result.adv.maxLine).toBeLessThanOrEqual(result.wrapW + 0.5);
});

// ── 5. 运行时拼接文案的容量上限（战斗日志 / 遭遇结果 / 夜宿压力行）───────────
//
// 这三处文本由运行时字符串拼出来（战斗日志、掉率、日记），没法预先拿到实例。
// 能给出的最硬的数字是：该字号下一个汉字占多宽，于是这个 wrap 宽度最多装几个字。
// 和源码里的实际拼串长度一比，就知道会不会撞墙。
test('probe: 汉字字宽与各 wrap 宽度的容量', async ({ page }) => {
  await seedStart(page);
  const cap = await page.evaluate(() => {
    const s = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as {
      viewSize: () => { width: number };
      portraitMode: boolean;
      add: { text: (x: number, y: number, t: string, style: Record<string, unknown>) => Record<string, unknown> };
    };
    const vw = s.viewSize().width;
    const panel460 = s.portraitMode ? Math.min(460, vw - 24) : 460;
    const rows: Array<{ size: number; han: number }> = [];
    for (const size of [20, 24, 30]) {
      const probe = s.add.text(0, 0, '汉字宽测', {
        fontFamily: "'ArkPixel Latin', 'ArkPixel ZH', sans-serif",
        fontSize: `${size}px`,
        color: '#ffffff',
      });
      const st = probe.style as { syncFont?: (c: unknown, x: unknown) => void };
      st.syncFont?.((probe as { canvas: unknown }).canvas, (probe as { context: unknown }).context);
      const ctx = (probe as { context: CanvasRenderingContext2D }).context;
      rows.push({ size, han: Math.round((ctx.measureText('汉字宽测').width / 4) * 10) / 10 });
      (probe as { destroy: () => void }).destroy();
    }
    return {
      vw,
      portrait: s.portraitMode,
      han: rows,
      widths: {
        'dialogue panelW-44': panel460 - 44,
        'encounter panelW-40 (460)': panel460 - 40,
        'combat outcome outW-40 (440)': 440 - 40,
        'shelter panelW-48 (500)': 500 - 48,
        'hud-feedback desktop width-64': vw - 64,
      },
    };
  });
  console.log('\n===== 汉字字宽（ArkPixel，实测）=====');
  for (const h of cap.han) console.log(`  ${h.size}px → 汉字 ${h.han}px/字`);
  console.log('\n===== 各 wrap 宽度能装几个 @@px 汉字 =====');
  const hanAt = (size: number) => cap.han.find((h) => h.size === size)?.han ?? size;
  for (const [k, w] of Object.entries(cap.widths as Record<string, number>)) {
    const size = k.startsWith('hud') ? 24 : k.startsWith('shelter') || k.startsWith('combat') ? 20 : 24;
    console.log(`  ${k}: ${Math.round(w)}px → ${size}px 汉字 ${Math.floor(w / hanAt(size))} 字/行`);
  }
  expect(cap.han.length).toBe(3);
});