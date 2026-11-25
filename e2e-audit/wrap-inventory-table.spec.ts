import { expect, test, type Page } from '@playwright/test';

// 只读探针：把 14 处 wordWrap 挨个打开、量出「自然宽度」和「渲染最宽」，
// 输出一张能直接抄进报告的处置表。P0-2 要求的是这张表，不是「都加上试试」。
//
// 每一处都要先让那个面板真的出现在屏幕上，否则拿不到实例。跳不过去的
// （战斗结算、夜宿面板、赠礼子列表）在输出里标「未覆盖 + 为什么」，
// 不拿代码里的常量冒充实测。

interface Row {
  where: string;
  text: string;
  fontSize: string;
  wrapWidth: number;
  advanced: boolean;
  natural: number;
  maxLine: number;
  lines: number;
  height: number;
}

const MEASURE = `
  (o) => {
    const style = o.style || {};
    if (style.syncFont) style.syncFont(o.canvas, o.context);
    const ctx = o.context;
    const raw = String(o.text || '').replace(/\\n/g, '');
    const rendered = typeof o.getWrappedText === 'function' ? o.getWrappedText() : String(o._text || '').split('\\n');
    let maxLine = 0;
    for (const line of rendered) maxLine = Math.max(maxLine, ctx.measureText(line).width);
    return { natural: Math.round(ctx.measureText(raw).width), maxLine: Math.round(maxLine), lines: rendered.length };
  }
`;

async function collect(page: Page, sceneKey: string, label: string, only?: (r: Row) => boolean): Promise<Row[]> {
  const rows = await page.evaluate(
    ({ key, measureSrc }: { key: string; measureSrc: string }) => {
      const g = (window as unknown as {
        __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: unknown[] } } | null } };
      }).__PHASER_GAME__;
      const list = (g?.scene.getScene(key)?.children.list ?? []) as Array<Record<string, unknown>>;
      const measure = eval(measureSrc) as (o: Record<string, unknown>) => { natural: number; maxLine: number; lines: number };
      const out: Array<{
        where: string;
        text: string;
        fontSize: string;
        wrapWidth: number;
        advanced: boolean;
        natural: number;
        maxLine: number;
        lines: number;
        height: number;
      }> = [];
      for (const o of list) {
        if (o.type !== 'Text' || !o.visible) continue;
        const wrap = (o.style as { wordWrap?: { width?: number; useAdvancedWrap?: boolean } } | undefined)?.wordWrap;
        // Phaser 4 把这两个值摊在 style 上；style.wordWrap 不一定存在。
        const w = wrap?.width ?? (o.style as { wordWrapWidth?: number }).wordWrapWidth;
        const adv = Boolean(wrap?.useAdvancedWrap ?? (o.style as { wordWrapUseAdvanced?: boolean }).wordWrapUseAdvanced);
        if (!w || w <= 0) continue;
        const text = String(o.text ?? '');
        if (!text.length) continue;
        const m = measure(o);
        out.push({
          where: key,
          text,
          fontSize: String((o.style as { fontSize?: string }).fontSize ?? ''),
          wrapWidth: Math.round(w),
          advanced: adv,
          natural: m.natural,
          maxLine: m.maxLine,
          lines: m.lines,
          height: Math.round(Number(o.height ?? 0)),
        });
      }
      return out;
    },
    { key: sceneKey, measureSrc: MEASURE },
  );
  const filtered = only ? rows.filter(only) : rows;
  console.log(`\n===== ${label} =====`);
  for (const r of filtered) {
    const over = r.maxLine > r.wrapWidth + 0.5;
    const shouldWrap = r.natural > r.wrapWidth + 0.5;
    console.log(
      `  fs=${r.fontSize} wrap=${r.wrapWidth} 自然=${r.natural} 渲染最宽=${r.maxLine} 行=${r.lines} 高=${r.height} adv=${r.advanced} ` +
        `→ ${over ? '★ 溢出' : shouldWrap && r.lines === 1 ? '★ 该折没折' : 'ok'}`,
    );
    console.log(`      "${r.text.replace(/\n/g, '⏎').slice(0, 56)}"`);
  }
  if (!filtered.length) console.log('  （本场景没有可见的 wordWrap 文本）');
  return filtered;
}

async function inGame(page: Page): Promise<void> {
  await page.goto('/?seed=42&debug=1');
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Menu'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect'));
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(220);
    const ok = await page.evaluate(() =>
      Boolean(window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game')),
    );
    if (ok) break;
  }
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'));
  await page.waitForTimeout(900);
}

test('处置表：14 处 wordWrap 逐条实测', async ({ page }) => {
  // ── #11 MenuScene 帮助面板 ──────────────────────────────────────────────
  await page.goto('/?seed=42&debug=1');
  await page.waitForFunction(() => Boolean(window.__PHASER_GAME__));
  await page.waitForFunction(() => window.__PHASER_GAME__!.scene.getScenes(true).some((s) => s.scene.key === 'Menu'));
  await page.waitForTimeout(900);
  // 走玩家真实入口：↓↓ 到「操作说明」，Enter。比直接调私有方法稳。
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  await collect(page, 'Menu', '#11 MenuScene.ts:328 帮助面板四行');

  // ── #12/#13/#14 MetaSelectScene ────────────────────────────────────────
  await page.goto('/?seed=42&debug=1');
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Menu'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect'));
  await page.waitForTimeout(700);
  const metaRows = await collect(page, 'MetaSelect', '#12/#13/#14 MetaSelectScene 三条');
  expect(metaRows.length).toBeGreaterThanOrEqual(2);

  // ── #5/#6/#7/#8/#9/#10 游戏内，HUD 与背包 ──────────────────────────────
  await inGame(page);
  await collect(page, 'Game', '#5 hud-feedback / #6 hud-bag-full / #7 hud-hint（桌面隐藏）');

  await page.evaluate(() => {
    (window.__PHASER_GAME__!.scene.getScene('Game') as unknown as { onToggleInventory: () => void }).onToggleInventory();
  });
  await page.waitForTimeout(800);
  await collect(page, 'Game', '#8 invDetailBody 背包详情（背包已打开）');

  // ── #9 对话框：P0-1 已修，这里量修完的值 ───────────────────────────────
  const dialogue = await page.evaluate(() => {
    const s = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as {
      dialogueMessage?: Record<string, unknown>;
    };
    const o = s.dialogueMessage;
    if (!o) return null;
    // 量最坏情况：灌一句 60 字中文（= MAX_UTTERANCE 硬上限），而不是量占位符
    // 「……」——占位符 2 个字永远放得下，量它等于没量。灌文本不改任何游戏状态，
    // 面板尺寸在 buildDialoguePanel 里已经按台词上限算好了。
    const worst =
      '宿舍的水管又漏了，走廊尽头那扇门后面有水声，' +
      '我数过台阶，第四层的水箱应该是空的，趁现在还能走就去看一眼';
    const target = o as { setText?: (v: string) => void };
    target.setText?.(worst);

    const style = o.style as {
      wordWrap?: { width?: number; useAdvancedWrap?: boolean };
      fontSize?: string;
      syncFont?: (c: unknown, x: unknown) => void;
    };
    // Phaser 4 把折行参数摊在 style 上（wordWrapWidth / wordWrapUseAdvanced），
    // 不一定有 style.wordWrap 这个对象。只读 style.wordWrap?.width 会读到 0，
    // 于是「wrap=0 → 任何文本都算溢出」的假红。两处都读。
    const wrapWidth = style.wordWrap?.width ?? (o.style as { wordWrapWidth?: number }).wordWrapWidth ?? 0;
    const advanced = Boolean(style.wordWrap?.useAdvancedWrap ?? (o.style as { wordWrapUseAdvanced?: boolean }).wordWrapUseAdvanced);

    style.syncFont?.((o as { canvas: unknown }).canvas, (o as { context: unknown }).context);
    const ctx = (o as { context: CanvasRenderingContext2D }).context;
    const raw = String(o.text ?? '');
    const rendered = (o as { getWrappedText?: () => string[] }).getWrappedText?.() ?? [raw];
    let maxLine = 0;
    for (const l of rendered) maxLine = Math.max(maxLine, ctx.measureText(l).width);
    return {
      wrapWidth: Math.round(wrapWidth),
      advanced,
      fontSize: style.fontSize ?? '',
      text: raw,
      natural: Math.round(ctx.measureText(raw).width),
      maxLine: Math.round(maxLine),
      lines: rendered.length,
    };
  });
  console.log('\n===== #9 GameScene.ts dialogueMessage（P0-1 已修，灌 60 字最坏情况）=====');
  if (dialogue) {
    console.log(
      `  fs=${dialogue.fontSize} wrap=${dialogue.wrapWidth} 自然=${dialogue.natural} 渲染最宽=${dialogue.maxLine} ` +
        `行=${dialogue.lines} adv=${dialogue.advanced} → ${dialogue.maxLine > dialogue.wrapWidth + 0.5 ? '★ 溢出' : 'ok'}`,
    );
    console.log(`      ${dialogue.text.length} 字："${dialogue.text.slice(0, 30)}…"`);
    expect(dialogue.wrapWidth, '#9 应读到真实的 wrap 宽度（不是 0）').toBeGreaterThan(0);
    expect(dialogue.advanced, '#9 对话框应已开 useAdvancedWrap').toBe(true);
    expect(dialogue.maxLine, '#9 最宽一行必须守住 wrap').toBeLessThanOrEqual(dialogue.wrapWidth + 0.5);
  } else {
    console.log('  dialogueMessage 未构建');
  }

  // ── 上一轮标「未覆盖」的四条：这一轮补测出来了 ──────────────────────────
  //
  // 之前写「需打赢一场战斗 / 需把时间推到 20:00」，其实不必：渲染函数接受的是
  // 一个已经算好的状态对象，把真实文案塞进去调一次就够了。测的是 render 路径，
  // 不是源码常量。只有 #1/#3/#4/#14 仍然测不了，理由见末尾。
  const worstCases = await page.evaluate(() => {
    const scene = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as Record<string, unknown> & {
      children: { list: Array<Record<string, unknown>> };
    };
    const st = (window as unknown as { __PHASER_SESSION__?: { getState: () => Record<string, unknown> } }).__PHASER_SESSION__!.getState() as {
      player: { stress?: number; inventory: { slots: Array<{ itemId: string; quantity: number }> } };
      diary?: unknown[];
    };
    type TextLike = {
      style: { wordWrapWidth?: number; wordWrap?: { width?: number; useAdvancedWrap?: boolean }; fontSize?: string; maxLines?: number; syncFont?: (c: unknown, x: unknown) => void };
      text?: string;
      getWrappedText?: () => string[];
      getBounds: () => DOMRect;
      canvas: unknown;
      context: unknown;
    };
    const measure = (o: Record<string, unknown>) => {
      const t = o as unknown as TextLike;
      const wrap = t.style.wordWrap?.width ?? t.style.wordWrapWidth ?? 0;
      t.style.syncFont?.(t.canvas, t.context);
      const ctx = t.context as CanvasRenderingContext2D;
      const raw = String(t.text ?? '');
      const rendered = t.getWrappedText?.() ?? [raw];
      let maxLine = 0;
      for (const line of rendered) maxLine = Math.max(maxLine, ctx.measureText(line).width);
      const b = t.getBounds();
      return {
        wrap,
        adv: Boolean(t.style.wordWrap?.useAdvancedWrap ?? (t.style as { wordWrapUseAdvanced?: boolean }).wordWrapUseAdvanced),
        maxLines: t.style.maxLines ?? null,
        natural: Math.round(ctx.measureText(raw).width),
        maxLine: Math.round(maxLine),
        lines: rendered.length,
        text: raw,
        left: Math.round(b.left),
        right: Math.round(b.right),
      };
    };
    const fresh = (build: () => void) => {
      const before = new Set(scene.children.list);
      build();
      return scene.children.list.filter((o) => !before.has(o) && o.type === 'Text');
    };
    // 按文本挑目标，不按「第一个」。上一版取了 fresh()[0]，抓到的是面板标题
    // （「黑暗中的伏击」/「夜间安排 · 宿舍」），wrap=0，于是成了假溢出。
    const pick = (rows: Array<Record<string, unknown>>, prefix: string) =>
      rows.find((o) => String(o.text ?? '').startsWith(prefix));
    const out: Record<string, ReturnType<typeof measure> | null> = {};

    // #8b 背包详情空槽文案。真实可达：用掉最后一格 / 空格子点不到但键盘能停在
    // 「最后一个真实槽之后」的空洞上（refreshInventory 只按 INVENTORY_SLOTS 夹）。
    const inv = scene as unknown as {
      invDetailBody?: Record<string, unknown>;
      invSelected: number;
      refreshInventory: () => void;
      inventoryOpen: boolean;
    };
    if (inv.invDetailBody) {
      inv.invSelected = st.player.inventory.slots.length;
      inv.refreshInventory();
      const b = (inv.invDetailBody as unknown as { getBounds: () => DOMRect }).getBounds();
      out['#8b 背包详情·空槽'] = { ...measure(inv.invDetailBody), escape: Math.round(b.right - 870) } as never;
    }

    // #2 遭遇面板正文：真实最长的一条（ENCOUNTER_MESSAGES.ambush）
    scene.encounter = {
      spotId: 'probe',
      encounter: { kind: 'ambush', floor: 1, message: '楼板吱呀一响，有东西在靠近' },
      choices: ['fight', 'flee'],
      selected: 0,
      resolved: false,
    };
    const encounterTexts = fresh(() => (scene as unknown as { buildEncounterPanel: (b: boolean) => void }).buildEncounterPanel(false));
    const encBody = pick(encounterTexts, '楼板吱呀一响');
    out['#2 遭遇面板正文'] = encBody ? measure(encBody) : null;

    // #10 夜宿压力行：最长形态 = 压力 100/100 + 一条真实日记
    st.player.stress = 100;
    st.diary = [{ id: 'probe', day: 1, minute: 1300, kind: 'shelter', message: '你把宿舍门重新加固，夜里少了一处漏风口。', stressDelta: 0 }];
    const shelterTexts = fresh(() => (scene as unknown as { buildShelterPanel: () => void }).buildShelterPanel());
    const shelterLine = pick(shelterTexts, '压力');
    out['#10 夜宿压力行·有日记'] = shelterLine ? measure(shelterLine) : null;

    // #14 竖屏「已获遗物」行不在这里构建（它只在 portraitMode 分支里存在），
    // 单独用同字号同 wrap 宽探针量，见下方 relicRow。

    return out;
  });

  // #14 单独量：用真实模板 + 真实遗物名，在 13px 下算自然宽，与竖屏 wrap 比。
  const relicRow = await page.evaluate(() => {
    const names = ['水之心', '铁胃', '疾行', '幸运符', '守护图腾'];
    const text = `已获遗物：${names.join('、')}`;
    const scene = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as { add: { text: (x: number, y: number, t: string, s: Record<string, unknown>) => unknown } };
    const probe = scene.add.text(0, 0, text, {
      fontFamily: "'ArkPixel Latin', 'ArkPixel ZH', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif",
      fontSize: '13px',
      wordWrap: { width: 309 - 24 },
    }) as unknown as { getBounds: () => DOMRect; getWrappedText?: () => string[]; destroy: () => void };
    const b = probe.getBounds();
    const lines = probe.getWrappedText?.().length ?? 1;
    probe.destroy();
    return { text, chars: text.length, natural: Math.round(b.width), lines, wrap: 309 - 24 };
  });
  console.log(`  #14 已获遗物（竖屏 309 宽，5 条全解锁）: ${relicRow.chars} 字 自然=${relicRow.natural} wrap=${relicRow.wrap} 行=${relicRow.lines} ` +
    `→ ${relicRow.natural > relicRow.wrap + 0.5 ? '★ 该折没折（basicWordWrap 不折中文）' : 'ok'}`);
  console.log(`      "${relicRow.text}"`);

  console.log('\n===== 上一轮标「未覆盖」的，这一轮真渲染出来量 =====');
  for (const [label, r] of Object.entries(worstCases)) {
    if (!r) {
      console.log(`  ${label}：没渲染出来`);
      continue;
    }
    const over = r.maxLine > r.wrap + 0.5;
    console.log(
      `  ${label}: wrap=${Math.round(r.wrap)} adv=${r.adv} 自然=${r.natural} 渲染最宽=${r.maxLine} ` +
        `行=${r.lines}${r.maxLines ? ` maxLines=${r.maxLines}` : ''} x[${r.left}..${r.right}] → ${over ? `★ 溢出 ${Math.round(r.maxLine - r.wrap)}px` : 'ok'}`,
    );
    console.log(`      "${r.text.slice(0, 40)}"`);
  }

  // 断言只钉「已经确认是缺陷的两条」，不钉「未来可能变坏」的。前者是回归防线，
  // 后者会在别人修好之后变成假红。修好之后把 toBeLessThanOrEqual 翻过来即可。
  const invEmpty = worstCases['#8b 背包详情·空槽'];
  if (invEmpty) {
    expect(invEmpty.wrap, '#8b 应读到真实 wrap').toBeGreaterThan(0);
    // 已知缺陷：自然宽 480 > wrap 212，且没有 advancedWrap，所以零折行，
    // 实测跑出背包面板右沿 238px。修好后这条会红，届时改成
    // expect(invEmpty.maxLine).toBeLessThanOrEqual(invEmpty.wrap + 0.5)。
    expect(invEmpty.lines, '#8b 当前未开 advancedWrap，单行（这是缺陷本身）').toBe(1);
  }
  const shelter = worstCases['#10 夜宿压力行·有日记'];
  if (shelter) {
    expect(shelter.wrap, '#10 应读到真实 wrap').toBeGreaterThan(0);
    // 已知缺陷：15 字日记 + 压力 100/100 时最宽行 460 > wrap 452，超 8px；
    // 有 maxLines: 2 兜底所以不会继续长高，但最后一行的标点会压住右侧内衬。
    expect(shelter.lines, '#10 maxLines:2 生效，已长到两行（这是临界状态）').toBe(2);
  }

  // ── 仍然测不了的：#1 / #3 / #4，理由不是「麻烦」是「要真打一架」 ─────────
  console.log('\n===== 仍然未覆盖（要推进真实战斗/选择，本轮不做）=====');
  console.log('  #1  GameScene.ts:1678  战斗结算日志 —— 日志由 combat.log 在 resolveCombatRound 里');
  console.log('      逐回合 push，长度取决于回合数与怪物名，没有「最长字符串」可固定。');
  console.log('      可用上界：怪物名 6 字 +「 击中你，造成 12 点伤害（格挡减半）」22 字');
  console.log('      = 28 字 × 20px = 560px，wrap 是 outW-40 = 400 → 需折成 2 行，');
  console.log('      而行距写死 17px、井高 62px，3 行就是 51px，理论上顶到井底。');
  console.log('      这条是真隐患，建议下一轮用一场真实 boss 战验证。');
  console.log('  #3  GameScene.ts:1835  遭遇结果正文 —— 必须在 #2 里真选一次，文案由');
  console.log('      resolveEncounter 按 kind+choice 查表返回，最长是 note 的纸条 27 字。');
  console.log('  #4  GameScene.ts:1840  遭遇掉落文案 —— 同上，且要求 result.items 非空。');
});