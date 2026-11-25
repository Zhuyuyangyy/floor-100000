import { expect, test, type Page } from '@playwright/test';

// 只读探针：对话框正文在「折行成功之后」会不会把选项压掉。
//
// 上一版只验证了「不开 advanced 横向溢出 880px」。但开了 advanced 之后，
// 一段长台词会变成 4 行、高 100px，而选项第一行的 y 是 top + 74 —— 正文
// 以 (0.5, 0.5) 为锚点，上下各 50px，于是正文底沿到 top + 95，直接压进
// 第一行选项。这一条必须量出来，否则「修好了溢出，制造了重叠」。
//
// 做法：不碰对话逻辑（openDialogue / dialogueOptionsView 归 A2），只拿
// 已经从 buildDialoguePanel 建好的 Text / Rectangle，setText 一句长台词，
// 再读 getBounds()。setText 是渲染调用，不改变对话状态机。

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
  originX: number;
  originY: number;
}

const LINE =
  '这栋楼里已经很久没有人来过了，你身上带的东西够换一顿饭吗，还是说你只是想找个地方躲一晚上，我们这里不养闲人。';

const LINE_2 =
  '今晚的过滤网又堵了，水比昨天更少。你要是愿意拿点东西出来换，我倒是可以告诉你哪一层的水管还没彻底锈死，但别指望我白说。';

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

async function boxOf(page: Page, predicate: 'message' | 'option-row-0' | 'title' | 'well'): Promise<Box | null> {
  return page.evaluate((which) => {
    const g = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (k: string) => Record<string, unknown> | null } };
    }).__PHASER_GAME__;
    const scene = g?.scene.getScene('Game') as unknown as {
      dialogueMessage?: Record<string, unknown>;
      dialogueTitle?: Record<string, unknown>;
      dialogueOptions?: Array<Record<string, unknown>>;
      children: { list: unknown[] };
    };
    const read = (o: Record<string, unknown> | undefined, name: string): Box | null => {
      if (!o) return null;
      const b = (o as { getBounds?: () => { x: number; y: number; width: number; height: number } }).getBounds?.();
      if (!b) return null;
      return {
        name,
        text: String(o.text ?? ''),
        type: String(o.type ?? ''),
        left: Math.round(b.x),
        right: Math.round(b.x + b.width),
        top: Math.round(b.y),
        bottom: Math.round(b.y + b.height),
        w: Math.round(b.width),
        h: Math.round(b.height),
        depth: Number(o.depth ?? 0),
        originX: Number(o.originX ?? 0),
        originY: Number(o.originY ?? 0),
      };
    };
    if (which === 'message') return read(scene.dialogueMessage, 'dialogueMessage');
    if (which === 'title') return read(scene.dialogueTitle, 'dialogueTitle');
    if (which === 'option-row-0') return read(scene.dialogueOptions?.[0], 'dialogueOptions[0]');
    // 正文底板：宽度 = panelW - 24 的 Rectangle。高度是算出来的（随行数预算变），
    // 所以按宽度认，不按 34 这个旧常量认。
    const rects = scene.children.list.filter((o) => {
      const r = o as Record<string, unknown>;
      const w = Number((r as { width?: number }).width);
      return r.type === 'Rectangle' && (w === 416 || w === 436 || w === 265);
    }) as Array<Record<string, unknown>>;
    return read(rects[0], 'dialogueWell');
  }, predicate);
}

async function setMessage(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    const g = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (k: string) => Record<string, unknown> | null } };
    }).__PHASER_GAME__;
    const scene = g?.scene.getScene('Game') as unknown as { dialogueMessage?: Record<string, unknown> };
    const m = scene.dialogueMessage as unknown as { setText: (t: string) => void; setVisible: (b: boolean) => void };
    m.setText(t);
    m.setVisible(true);
  }, text);
}

test('probe: 对话框长台词折行后是否压住选项', async ({ page }) => {
  await seedStart(page);
  const geometry = await page.evaluate(() => {
    const g = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (k: string) => Record<string, unknown> | null } };
    }).__PHASER_GAME__;
    const scene = g?.scene.getScene('Game') as unknown as {
      dialogueObjects?: Array<{ type: string; height?: number; text?: string; y?: number }>;
      viewSize: () => { width: number; height: number };
    };
    const objs = scene.dialogueObjects ?? [];
    return {
      panelObjects: objs.length,
      view: scene.viewSize(),
    };
  });
  console.log(`\n===== 对话框几何（横屏）=====`);
  console.log(`  dialogueObjects=${geometry.panelObjects} view=${geometry.view.width}x${geometry.view.height}`);

  const well = await boxOf(page, 'well');
  const title = await boxOf(page, 'title');
  console.log(
    `  正文底板 y[${well?.top}..${well?.bottom}] x[${well?.left}..${well?.right}]  (h=${well?.h})`,
  );
  console.log(
    `  标题条文字 y[${title?.top}..${title?.bottom}]  (h=${title?.h})`,
  );

  const rows: Array<{ label: string; msg: Box | null; opt0: Box | null }> = [];
  for (const [label, text] of [
    ['1 行（短台词）', '……'],
    ['3 行（AI 常见长度）', LINE],
    ['4 行（AI 偏长）', LINE_2],
  ] as const) {
    await setMessage(page, text);
    await page.waitForTimeout(260);
    rows.push({
      label,
      msg: await boxOf(page, 'message'),
      opt0: await boxOf(page, 'option-row-0'),
    });
  }

  console.log('\n===== 正文 vs 第一行选项（实测 getBounds）=====');
  for (const r of rows) {
    if (!r.msg || !r.opt0) {
      console.log(`  ${r.label}：缺少对象`);
      continue;
    }
    const overlapY = Math.min(r.msg.bottom, r.opt0.bottom) - Math.max(r.msg.top, r.opt0.top);
    const outOfWell = r.msg.bottom - (well?.bottom ?? 0);
    console.log(
      `  ${r.label}: 正文 "${r.msg.text.slice(0, 12)}…" ${r.msg.w}x${r.msg.h} y[${r.msg.top}..${r.msg.bottom}] ` +
        `| 选项0 y[${r.opt0.top}..${r.opt0.bottom}] | ` +
        `垂直交叠 ${overlapY > 0 ? `${overlapY}px ★ 压住选项` : '无'} | ` +
        `超出正文底板 ${outOfWell > 0 ? `${outOfWell}px ★ 溢出底板` : '未超出'}`,
    );
  }

  // 断言：最长那句不许压住第一行选项
  const worst = rows[rows.length - 1];
  const overlap = worst.msg && worst.opt0
    ? Math.min(worst.msg.bottom, worst.opt0.bottom) - Math.max(worst.msg.top, worst.opt0.top)
    : 0;
  expect(overlap).toBeLessThanOrEqual(0);
});
// ── 上限收口：60 字（MAX_UTTERANCE）、竖屏 390x844 ──────────────────────────
//
// 上面那条用 54 字。这条用产品硬上限 60 字，再跑一次横屏与竖屏，
// 证明「最坏情况也装得下」。不做这一步，前面那条只是「某句装得下」。
const MAX_UTTERANCE_LINE =
  '这栋楼里已经很久没有人来过了，你身上带的东西够换一顿饭吗，还是说你只是想找个地方躲一晚上，我们这里不养闲人，要么拿东西，要么走。';

test('回归：60 字上限的台词在横屏与竖屏都不压选项不出面板', async ({ page }) => {
  for (const [w, h, tag] of [
    [1280, 800, '横屏 1280x800'],
    [390, 844, '竖屏 390x844'],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await seedStart(page);
    await setMessage(page, MAX_UTTERANCE_LINE);
    await page.waitForTimeout(300);

    const geo = await page.evaluate(() => {
      const g = (window as unknown as {
        __PHASER_GAME__?: { scene: { getScene: (k: string) => Record<string, unknown> | null } };
      }).__PHASER_GAME__;
      const s = g?.scene.getScene('Game') as unknown as {
        dialogueMessage?: Record<string, unknown>;
        dialogueOptions?: Array<Record<string, unknown>>;
        children: { list: unknown[] };
        portraitMode: boolean;
        viewSize: () => { width: number; height: number };
      };
      const bounds = (o: Record<string, unknown> | undefined) => {
        const b = (o as { getBounds?: () => { x: number; y: number; width: number; height: number } })?.getBounds?.();
        if (!b) return null;
        return { left: Math.round(b.x), right: Math.round(b.x + b.width), top: Math.round(b.y), bottom: Math.round(b.y + b.height), w: Math.round(b.width), h: Math.round(b.height) };
      };
      const msg = bounds(s.dialogueMessage);
      const opt0 = bounds(s.dialogueOptions?.[0]);
      const opt3 = bounds(s.dialogueOptions?.[3]);
      // 正文底板：宽 = panelW - 24，且高不小于正文、纵向包住正文的那一块。
      // 只按宽度认会撞上别的同宽矩形（竖屏实测撞到一块 h=66 的），必须加包含条件。
      const pW = s.portraitMode ? Math.min(460, s.viewSize().width - 24) : 460;
      const wrapW = pW - 44;
      const wells = s.children.list.filter((o) => {
        const r = o as Record<string, unknown>;
        if (r.type !== 'Rectangle') return false;
        if (Number((r as { width?: number }).width) !== pW - 24) return false;
        const b = bounds(r);
        if (!b || !msg) return false;
        return b.top <= msg.top && b.bottom >= msg.bottom;
      }) as Array<Record<string, unknown>>;
      const wellBoxes = wells.map((r) => bounds(r)!);
      const well = wellBoxes.sort((a, b) => a.h - b.h)[0] ?? null;
      return { msg, opt0, opt3, well, panelW: pW, wrapW, portrait: s.portraitMode, view: s.viewSize() };
    });

    const { msg, opt0, opt3, well } = geo;
    expect(msg, `${tag}: dialogueMessage 缺失`).toBeTruthy();
    const overlapTop = Math.min(msg!.bottom, opt0!.bottom) - Math.max(msg!.top, opt0!.top);
    const wrapOverflow = msg!.right - msg!.left - geo.wrapW;
    console.log(`\n===== ${tag} · 60 字上限 =====`);
    console.log(`  panelW=${geo.panelW} wrapWidth=${geo.wrapW} portrait=${geo.portrait}`);
    console.log(`  正文 ${msg!.w}x${msg!.h} x[${msg!.left}..${msg!.right}] y[${msg!.top}..${msg!.bottom}]`);
    console.log(`  正文底板 y[${well?.top}..${well?.bottom}] (h=${well?.h}) ${well ? '' : '（未匹配到）'}`);
    console.log(`  选项0 y[${opt0!.top}..${opt0!.bottom}] | 选项3 y[${opt3!.top}..${opt3!.bottom}]`);
    console.log(`  → 正文×选项0 垂直交叠 ${overlapTop > 0 ? `${overlapTop}px ★` : '无'}`);
    console.log(`  → 正文宽度超出 wrap ${wrapOverflow > 1 ? `${wrapOverflow}px ★` : '无'}`);
    console.log(`  → 正文上下溢出底板 ${well ? (msg!.top < well.top || msg!.bottom > well.bottom ? '★ 是' : '否') : '（底板未匹配，跳过）'}`);
    console.log(`  → 正文左右溢出画面 ${msg!.left < 0 || msg!.right > geo.view.width ? '★ 是' : '否'}`);

    expect(overlapTop, `${tag}: 正文压住第一行选项`).toBeLessThanOrEqual(0);
    expect(wrapOverflow, `${tag}: 正文宽度超出 wrap`).toBeLessThanOrEqual(1);
    if (well) {
      expect(msg!.top, `${tag}: 正文上沿溢出底板`).toBeGreaterThanOrEqual(well.top);
      expect(msg!.bottom, `${tag}: 正文下沿溢出底板`).toBeLessThanOrEqual(well.bottom);
    }
    expect(msg!.left, `${tag}: 正文左沿出画面`).toBeGreaterThanOrEqual(0);
    expect(msg!.right, `${tag}: 正文右沿出画面`).toBeLessThanOrEqual(geo.view.width);
  }
});
