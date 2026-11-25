import { test, expect } from '@playwright/test';

// 对话框正文必须真的折行——这是断言，不是探针。
//
// 背景：Phaser 的 basicWordWrap 用 `text.split(' ')` 逐词累加。中文没有空格，
// 整句被当成一个词；而「词比整行宽」的分支（Text.js 的 `if (j > 0)`）在第一句
// 时恰好不触发换行，于是它一个字都不折，直接横向溢出。
//
// 这一处是产品级风险：正文由模型现场生成，长度不可控。实测一句 39 字的中文
// 台词在未开 useAdvancedWrap 时渲染宽度 936px、高度 25px（单行），而面板可用
// 宽度只有 416px——横向冲出 2.25 倍。开了之后是 408px / 75px（三行）。
//
// 用固定文本从 setText 灌进去再量 getBounds，不依赖模型回话，因此不会 flake。
const LONG_CJK = '他把手电递过来，说这层楼的线路还能救，但需要你先去四层把配电箱的保险丝取回来。';

test('对话框正文开了 useAdvancedWrap，中文长句真的折行', async ({ page }) => {
  await page.goto('/?seed=42&debug=1');
  await page.waitForFunction(() =>
    (window as any).__PHASER_GAME__?.scene.getScenes(true).some((s: any) => s.scene.key === 'Menu'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    (window as any).__PHASER_GAME__?.scene.getScenes(true).some((s: any) => s.scene.key === 'MetaSelect'));
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Enter');
    const started = await page
      .waitForFunction(() =>
        (window as any).__PHASER_GAME__?.scene.getScenes(true).some((s: any) => s.scene.key === 'Game'),
        undefined, { timeout: 2000 })
      .then(() => true).catch(() => false);
    if (started) break;
  }
  await page.waitForTimeout(800);

  const measured = await page.evaluate((line: string) => {
    const game = (window as any).__PHASER_GAME__;
    const scene = game.scene.getScenes(true).find((s: any) => s.scene.key === 'Game');
    const msg = scene?.dialogueMessage;
    if (!msg) return { error: 'dialogueMessage 不存在：对话框没构建，这条断言失去意义' };
    msg.setText(line);
    return {
      advancedWrap: Boolean(msg.style.wordWrapUseAdvanced),
      wrapWidth: msg.style.wordWrapWidth as number,
      renderedWidth: msg.width as number,
      renderedHeight: msg.height as number,
      fontSize: msg.style.fontSize as string,
    };
  }, LONG_CJK);

  expect(measured.error).toBeUndefined();
  // 1. 开关本身：撤掉 useAdvancedWrap 时这条立刻红（实测 false）
  expect(measured.advancedWrap).toBe(true);
  // 2. 真实折行：宽度守住 wrap 上限。未开时是 936 对 416，不可能偶然通过
  expect(measured.renderedWidth).toBeLessThanOrEqual(measured.wrapWidth! + 1);
  // 3. 多行：单行高度约 25px，三行 75px。这条防「压扁成一行也过上面两条」
  expect(measured.renderedHeight).toBeGreaterThan(40);
});
