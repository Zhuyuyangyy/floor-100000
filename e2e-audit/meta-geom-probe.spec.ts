import { expect, test, type Page } from '@playwright/test';

// 只读探针：把 MetaSelect 上每一块文字/按钮的真实包围盒打出来。
// 目的：审计报告里凡是写「溢出 N px」「被按钮遮住」的数字，都必须来自这里，
// 不是从截图目测的。截图用来证明「看上去确实坏了」，探针用来给「坏多少」定数。

interface Box {
  name: string;
  text: string;
  type: string;
  x: number;
  y: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
  originX: number;
  fontSize: string;
  wrapWidth: number | null;
  advancedWrap: boolean;
  visible: boolean;
  depth: number;
}

async function dumpBoxes(page: Page, sceneKey: string): Promise<Box[]> {
  return page.evaluate((key) => {
    const g = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: unknown[] } } | null } };
    }).__PHASER_GAME__;
    const scene = g?.scene.getScene(key);
    const list = (scene?.children.list ?? []) as Array<Record<string, unknown>>;
    const out: Box[] = [];
    for (const o of list) {
      const type = String(o.type ?? '');
      if (type !== 'Text' && type !== 'Rectangle') continue;
      const b = (o.getBounds as undefined | (() => { x: number; y: number; width: number; height: number }))?.();
      if (!b) continue;
      const style = (o.style ?? {}) as {
        wordWrapWidth?: number;
        wordWrap?: { width?: number; useAdvancedWrap?: boolean };
        fontSize?: string;
      };
      const wrap = style.wordWrap;
      out.push({
        name: String(o.name ?? ''),
        text: String(o.text ?? ''),
        type,
        x: Number(o.x ?? 0),
        y: Number(o.y ?? 0),
        left: Math.round(b.x),
        right: Math.round(b.x + b.width),
        top: Math.round(b.y),
        bottom: Math.round(b.y + b.height),
        w: Math.round(b.width),
        h: Math.round(b.height),
        originX: Number((o.originX as number) ?? 0),
        fontSize: style.fontSize ?? '',
        wrapWidth: wrap?.width ?? style.wordWrapWidth ?? null,
        advancedWrap: Boolean(wrap?.useAdvancedWrap),
        visible: Boolean(o.visible),
        depth: Number(o.depth ?? 0),
      });
    }
    return out;
  }, sceneKey);
}

test('probe: MetaSelect 文字包围盒 vs 面板/按钮', async ({ page }) => {
  await page.goto('/?seed=42&debug=1');
  await page.waitForFunction(() =>
    window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Menu'),
  );
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect'),
  );
  await page.waitForTimeout(700);

  const boxes = await dumpBoxes(page, 'MetaSelect');
  const visible = boxes.filter((b) => b.visible);

  console.log('===== MetaSelect 全部可见 Text / Rectangle =====');
  for (const b of visible.sort((a, c) => a.depth - c.depth || a.left - c.left)) {
    const wrapNote = b.wrapWidth ? ` wrap=${b.wrapWidth} adv=${b.advancedWrap}` : '';
    console.log(
      `[${b.type}] d=${b.depth} "${b.text.slice(0, 26)}" ` +
        `bbox=(${b.left},${b.top})..(${b.right},${b.bottom}) ${b.w}x${b.h} ` +
        `fs=${b.fontSize}${wrapNote}`,
    );
  }

  // 逐条判定，全部用真实数值
  const flavour = visible.find((b) => b.text.startsWith('从底层醒来'));
  const blurb = visible.find((b) => b.text.startsWith('标准规则'));
  const button = visible.find((b) => b.type === 'Rectangle' && b.w > 120 && b.w < 200 && b.h < 50 && b.depth >= 5);
  const panelFill = visible.find((b) => b.type === 'Rectangle' && b.w > 400 && b.w < 520 && b.h > 250);

  console.log('===== 关键判定 =====');
  if (flavour && button) {
    const overlapX = Math.min(flavour.right, button.right) - Math.max(flavour.left, button.left);
    const overlapY = Math.min(flavour.bottom, button.bottom) - Math.max(flavour.top, button.top);
    console.log(
      `flavour bbox x[${flavour.left}..${flavour.right}] y[${flavour.top}..${flavour.bottom}]; ` +
        `button bbox x[${button.left}..${button.right}] y[${button.top}..${button.bottom}]`,
    );
    console.log(
      `→ 文字与按钮交叠 ${overlapX > 0 && overlapY > 0 ? `有，${overlapX}x${overlapY}px` : '无'}`,
    );
  } else {
    console.log('!! 没找到 flavour 或 button，列出的文本：', visible.map((b) => b.text).join(' | '));
  }
  if (panelFill) {
    console.log(`面板填充 bbox x[${panelFill.left}..${panelFill.right}] y[${panelFill.top}..${panelFill.bottom}]`);
    if (flavour) {
      console.log(
        `→ flavour 左溢出 ${panelFill.left - flavour.left}px，右溢出 ${flavour.right - panelFill.right}px`,
      );
    }
    if (blurb) {
      console.log(
        `→ blurb  左溢出 ${panelFill.left - blurb.left}px，右溢出 ${blurb.right - panelFill.right}px`,
      );
    }
  }
  if (blurb) {
    console.log(
      `blurb 实测宽 ${blurb.w}px，wrapWidth=${blurb.wrapWidth}，advancedWrap=${blurb.advancedWrap}，` +
        `=> ${blurb.w > (blurb.wrapWidth ?? 1e9) ? '超出 wrap 框（中文没折行）' : '在 wrap 框内'}`,
    );
  }

  expect(flavour).toBeTruthy();
});