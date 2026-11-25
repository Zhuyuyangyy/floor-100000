import { expect, test, type Page } from '@playwright/test';

// 只读探针：游戏内面板的几何真相。
// 审计报告里 M-2（背包徽标/格子间隙）、M-3（对话标题条）、B-3（竖屏数值/按钮）
// 这三条写着「溢出 N px」「重叠 N px」的地方，数字必须来自这里。

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
  originX: number;
  originY: number;
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
      if (!['Text', 'Rectangle', 'Image', 'Sprite'].includes(type)) continue;
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
        originX: Number((o.originX as number) ?? 0),
        originY: Number((o.originY as number) ?? 0),
      });
    }
    return out;
  }, sceneKey);
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

test('probe: 背包格子与徽标几何', async ({ page }) => {
  await seedStart(page);
  await page.evaluate(() => {
    const s = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as {
      onToggleInventory: () => void;
    };
    s.onToggleInventory();
  });
  await page.waitForTimeout(700);

  const boxes = (await dump(page, 'Game')).filter((b) => b.visible);
  // 标题条、详情文字、格子（Image 或 Rectangle）
  const header = boxes.find((b) => b.text === '背包');
  const count = boxes.find((b) => /^\d+\/12$/.test(b.text));
  const footers = boxes.filter((b) => b.text.includes('点选物品') || b.text.includes('点击选择'));
  const detail = boxes.find((b) => b.text === '净水');

  console.log('===== 背包面板 =====');
  if (header) console.log(`标题「背包」bbox x[${header.left}..${header.right}] y[${header.top}..${header.bottom}] fs=${header.fontSize}`);
  if (count) console.log(`计数「${count.text}」bbox x[${count.left}..${count.right}] y[${count.top}..${count.bottom}] fs=${count.fontSize}`);
  if (detail) console.log(`详情名「净水」bbox x[${detail.left}..${detail.right}] y[${detail.top}..${detail.bottom}] fs=${detail.fontSize}`);
  for (const f of footers) console.log(`底部提示 "${f.text.slice(0, 20)}" bbox x[${f.left}..${f.right}] y[${f.top}..${f.bottom}] fs=${f.fontSize}`);

  // 格子：40x40 的 Rectangle/Image 方块
  const cells = boxes
    .filter((b) => Math.abs(b.w - 40) <= 1 && Math.abs(b.h - 40) <= 1)
    .sort((a, b) => a.top - b.top || a.left - b.left);
  console.log(`\n===== 格子（40x40）共 ${cells.length} 个 =====`);
  for (const c of cells.slice(0, 14)) console.log(`  格子 x[${c.left}..${c.right}] y[${c.top}..${c.bottom}] d=${c.depth}`);
  if (cells.length >= 2) {
    const pitchX = cells[1].left - cells[0].left;
    const row0 = cells.filter((c) => c.top === cells[0].top);
    console.log(`→ 格宽 ${cells[0].w}，步距 ${pitchX}，所以间隙 = ${pitchX - cells[0].w}px`);
    if (row0.length >= 2) {
      const span = row0[row0.length - 1].right - row0[0].left;
      console.log(`→ 一行 ${row0.length} 格总宽 ${span}px（${row0.length}*40 + ${row0.length - 1}*gap），末格右沿 x=${row0[row0.length - 1].right}`);
    }
  }

  // 数量徽标：数字文本、fs=20px、右下角
  const badges = boxes.filter((b) => /^\d+$/.test(b.text) && Math.abs(b.w) < 40 && b.depth >= 200);
  console.log(`\n===== 数量徽标 ${badges.length} 个 =====`);
  for (const b of badges) console.log(`  徽标「${b.text}」bbox x[${b.left}..${b.right}] y[${b.top}..${b.bottom}] ${b.w}x${b.h} fs=${b.fontSize}`);

  // 徽标与所在格的交叠量
  for (const b of badges) {
    const host = cells.find((c) => b.left >= c.left - 20 && b.left <= c.right + 20 && b.top >= c.top - 20 && b.top <= c.bottom + 20);
    if (host) {
      const ox = Math.min(b.right, host.right) - Math.max(b.left, host.left);
      const oy = Math.min(b.bottom, host.bottom) - Math.max(b.top, host.top);
      console.log(`  徽标「${b.text}」与其格子交叠 ${ox}x${oy}px；徽标右沿 ${b.right} vs 格右沿 ${host.right}（超出 ${b.right - host.right}）`);
    }
  }

  // 图标尺寸
  const icons = boxes.filter((b) => Math.abs(b.w - 32) <= 2 && Math.abs(b.h - 32) <= 2);
  console.log(`\n32x32 图标 ${icons.length} 个（16px 原生 x2）`);
  expect(header).toBeTruthy();
});

test('probe: 对话面板标题条 vs 标题字号', async ({ page }) => {
  await seedStart(page);
  // 走真实路径开对话：改 flags 开闸 → 上楼到 2 层 → 站到阿林旁边按 E。
  // （直接调 openDialogue 会因为 npc.greetings 未初始化抛错，见 3686）
  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { flags?: Record<string, number> } | null } })
      .__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no state');
    s.flags = { ...s.flags, 'gate.alin.repaired': 1 };
  });
  for (let attempt = 0; attempt < 8; attempt++) {
    const floor = await page.evaluate(() => {
      const w = window as unknown as { __PHASER_SESSION__?: { getState: () => { currentFloor: number } | null } };
      return w.__PHASER_SESSION__?.getState()?.currentFloor ?? 0;
    });
    if (floor === 2) break;
    await page.evaluate(() => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { x: number } } | null } })
        .__PHASER_SESSION__?.getState();
      if (s) s.player.x = 40;
    });
    await page.waitForTimeout(300);
    await page.keyboard.press('E');
    await page.waitForTimeout(900);
  }
  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { x: number } } | null } })
      .__PHASER_SESSION__?.getState();
    if (s) s.player.x = 480;
  });
  await page.waitForTimeout(300);
  await page.keyboard.press('E');
  await page.waitForTimeout(900);

  const boxes = (await dump(page, 'Game')).filter((b) => b.visible);
  const title = boxes.find((b) => b.text.startsWith('阿林（'));
  const source = boxes.find((b) => b.text.includes('对白') || b.text.includes('Ollama') || b.text.includes('模型'));
  const opts = boxes.filter((b) => ['赠礼', '维修门计划', '交易', '退出'].some((k) => b.text === k));
  const msg = boxes.find((b) => b.text.includes('线路') || b.text.includes('想换'));

  console.log('===== 对话面板 =====');
  if (title) console.log(`标题「${title.text}」bbox x[${title.left}..${title.right}] y[${title.top}..${title.bottom}] h=${title.h} fs=${title.fontSize}`);
  if (source) console.log(`来源「${source.text}」bbox x[${source.left}..${source.right}] y[${source.top}..${source.bottom}] h=${source.h} fs=${source.fontSize}`);
  if (msg) console.log(`正文 bbox x[${msg.left}..${msg.right}] y[${msg.top}..${msg.bottom}] fs=${msg.fontSize}`);
  console.log(`选项 ${opts.length} 条：`);
  for (const o of opts.sort((a, b) => a.top - b.top)) {
    console.log(`  「${o.text}」 x[${o.left}..${o.right}] y[${o.top}..${o.bottom}] fs=${o.fontSize}`);
  }
  if (opts.length >= 2) {
    const sorted = opts.sort((a, b) => a.top - b.top);
    console.log(`→ 选项行距 = ${sorted[1].top - sorted[0].top}px，行高 ${sorted[0].h}px，净空 ${sorted[1].top - sorted[0].bottom}px`);
  }
  // 标题条：对话面板宽 460，header 高 24，条顶应与标题包围盒同区域
  const strip = boxes.find(
    (b) => b.type === 'Rectangle' && Math.abs(b.w - 460) <= 6 && b.h <= 30 && b.h >= 18 && Math.abs(b.top - (title ? title.top - 15 : 0)) <= 20,
  );
  if (strip) {
    console.log(`标题条 bbox x[${strip.left}..${strip.right}] y[${strip.top}..${strip.bottom}] h=${strip.h}`);
    if (title) {
      console.log(
        `→ 标题 ${title.h}px 高，条 ${strip.h}px 高，标题上沿超出条 ${strip.top - title.top}px、下沿超出条 ${title.bottom - strip.bottom}px`,
      );
    }
  } else {
    console.log('!! 没定位到 460 宽标题条，候选：');
    for (const b of boxes.filter((x) => x.type === 'Rectangle' && b.w > 380)) {
      console.log(`   rect x[${b.left}..${b.right}] y[${b.top}..${b.bottom}] ${b.w}x${b.h} d=${b.depth}`);
    }
  }
  expect(title).toBeTruthy();
});
test('probe: 竖屏背包详情区的空白量', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedStart(page);
  await page.evaluate(() => {
    const s = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as { onToggleInventory: () => void };
    s.onToggleInventory();
  });
  await page.waitForTimeout(800);

  const boxes = (await dump(page, 'Game')).filter((b) => b.visible);
  const title = boxes.find((b) => b.text === '背包');
  const cells = boxes.filter((b) => Math.abs(b.w - 32) <= 1 && Math.abs(b.h - 32) <= 1).sort((a, b) => a.top - b.top || a.left - b.left);
  const body = boxes.find((b) => b.text.includes('水分') || b.text.includes('饱食'));
  const footer = boxes.find((b) => b.text.includes('点选物品'));
  const useBtn = boxes.find((b) => b.text === '使用');

  console.log('===== 竖屏背包 =====');
  if (title) console.log(`标题「背包」bbox x[${title.left}..${title.right}] y[${title.top}..${title.bottom}] fs=${title.fontSize}`);
  if (cells.length) {
    const row0 = cells.filter((c) => c.top === cells[0].top);
    console.log(`格子 ${cells.length} 个，${row0.length} 列；格 ${cells[0].w}px；步距 ${cells[1].left - cells[0].left}px；间隙 ${cells[1].left - cells[0].left - cells[0].w}px`);
    console.log(`网格 bbox x[${Math.min(...cells.map((c) => c.left))}..${Math.max(...cells.map((c) => c.right))}] y[${Math.min(...cells.map((c) => c.top))}..${Math.max(...cells.map((c) => c.bottom))}]`);
  }
  if (body) console.log(`详情第三行 bbox x[${body.left}..${body.right}] y[${body.top}..${body.bottom}] fs=${body.fontSize}`);
  if (footer) console.log(`面板底部提示 bbox x[${footer.left}..${footer.right}] y[${footer.top}..${footer.bottom}]`);
  if (useBtn) console.log(`「使用」按钮 bbox x[${useBtn.left}..${useBtn.right}] y[${useBtn.top}..${useBtn.bottom}]`);
  if (body && footer) {
    console.log(`→ 详情最后一行底沿 ${body.bottom} 到面板提示 ${footer.top}：空白 ${footer.top - body.bottom}px`);
  }
  if (body) {
    const detailW = await page.evaluate(() => {
      const g = window.__PHASER_GAME__!.scene.getScene('Game') as unknown as { portraitWidth: number };
      return g.portraitWidth;
    });
    console.log(`→ 详情区可用宽约 ${detailW - 24}px，当前文字实际用到 ${body.right - body.left}px`);
  }
  expect(cells.length).toBe(12);
});
