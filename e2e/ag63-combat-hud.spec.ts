import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../src/core/gameTypes';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../src/core/design';

// AG-63（战斗 HUD + debuff 绿光提示）实测探针。用户 2026-11-17 原话：
//   「攻击者从那个地方出来我们对打的时候我需要看到我们的页面然后左下角
//     提示那啥用什么来攻击等等」
//   「这个绿色的我不知道是什么好像是 Bug 你修改下」
// 两个探针各钉一条：
//   1. 打一场仗——左下角脚注先答「当前武器：X（伤害 N）」再给三个动作的键；
//      HUD 四联环/敌方面板在战斗中全部可读（截图 + getBounds 算术）；
//   2. 把饥饿/口渴打到 ≤25%——绿光出现的同一帧 flash 一条点名它的消息
//      （只一次，不每帧刷），左下角常驻「状态：饥饿/干渴」标记；恢复后
//      闪「缓过来」且标记隐去。

interface TextBound {
  name: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  visible: boolean;
}

/** 场上全部 Text 的 bounds（含 depth，用来区分脚注条、HUD 板与模态面板）。 */
async function allTexts(page: Page): Promise<TextBound[]> {
  return page.evaluate(() => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as {
      children: { list: Array<{ type: string; name: string; text: string; visible: boolean; depth: number; getBounds(): { x: number; y: number; width: number; height: number } }> };
    } | null;
    return (scene?.children.list ?? [])
      .filter((o) => o.type === 'Text')
      .map((o) => {
        const b = o.getBounds();
        return { name: o.name, text: o.text ?? '', x: b.x, y: b.y, width: b.width, height: b.height, depth: o.depth, visible: o.visible };
      });
  });
}

async function hudText(page: Page, name: string): Promise<string> {
  // AG-71 起 hud-hint 退居不可见的状态对象（导航条 contextual 槽是它的显示层），
  // 但文案全串保留不变、仍是 contextual 槽的唯一数据源（GameScene 4996 行注释：
  // "e2e 按 name 断言"）。RC-01 分诊：ag63-1 曾因可见性过滤永远读到空串。
  const found = (await allTexts(page)).find((o) => o.name === name && (o.visible || name === 'hud-hint'));
  return found?.text ?? '';
}

async function startGame(page: Page): Promise<void> {
  await page.goto('/?seed=42');
  const sceneIs = (key: string): Promise<void> =>
    page.waitForFunction((k) => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === k), key).then(() => undefined);
  await sceneIs('Menu');
  await page.keyboard.press('Enter');
  await sceneIs('MetaSelect');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const ready = await page
      .waitForFunction(() => window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'), undefined, { timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    if (ready) break;
  }
  await sceneIs('Game');
}

/** 上 2 层——问号点（伏击）只在 2 层及以上刷。上楼口在左端 x=40。 */
async function climbToFloor2(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const floor = await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.currentFloor);
    if (floor === 2) return;
    await page.evaluate(() => {
      const st = window.__PHASER_SESSION__?.getState();
      if (st) st.player.x = 40;
    });
    await page.keyboard.press('E');
    const landed = await page
      .waitForFunction(() => window.__PHASER_SESSION__?.getState()?.currentFloor === 2, undefined, { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (landed) return;
  }
  throw new Error('could not climb to floor 2');
}

/** 打开这一层刷出来的伏击点；返回是否打上了。 */
async function openAmbush(page: Page): Promise<boolean> {
  const spots: Array<{ k: string; x: number }> = await page.evaluate(() => {
    const game = window.__PHASER_GAME__;
    if (!game) return [];
    const sc = game.scene.getScene('Game') as unknown as { spotMarkers?: Map<string, { x: number }> };
    return [...(sc.spotMarkers ?? new Map()).entries()].map(([k, v]) => ({ k, x: Math.round(v.x) }));
  });
  for (const sp of spots) {
    if (sp.k === 'shop') continue;
    await page.evaluate((x) => {
      const st = window.__PHASER_SESSION__?.getState();
      if (st) st.player.x = x;
    }, sp.x);
    await page.waitForTimeout(250);
    await page.keyboard.press('E');
    await page.waitForTimeout(500);
    const combat = await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.combat !== undefined);
    if (combat) return true;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  return false;
}

test('AG-63-1: 战斗中左下角答「用什么攻击」，HUD 与敌方面板全部可读', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() === 404 && !r.url().endsWith('/favicon.ico')) errors.push(`404 ${r.url()}`);
  });

  await startGame(page);
  await climbToFloor2(page);
  expect(await openAmbush(page), 'floor 2 seed 42 应有伏击点').toBe(true);

  // ── 1. 左下角脚注：先武器，后按键 ──
  // 修前这里整场战斗冻在打开面板前的世界提示（「按 E 查看问号点」）——
  // openPanelHint 唯一的调用点在 update() 的面板提前 return 之后，从来
  // 没跑过。AG-63 把它挪到冻结之前，这条脚注才是活的。
  await expect.poll(async () => hudText(page, 'hud-hint'), { timeout: 5000 }).toMatch(/^当前武器：(撬棍|匕首|短剑|砍刀|消防斧|空手)（伤害 \d+）/);
  const hint = await hudText(page, 'hud-hint');
  expect(hint).toContain('Enter 出招');
  expect(hint).toContain('↑/↓ 选择');
  expect(hint).toContain('ESC 撤退');
  // 脚注不许出画布（hud-hint 没有 shrink 守卫，超宽会静默溢出）。
  const hintBound = (await allTexts(page)).find((o) => o.name === 'hud-hint');
  expect(hintBound, 'hud-hint 应在场上').toBeTruthy();
  if (hintBound) {
    expect(hintBound.x).toBeGreaterThanOrEqual(0);
    expect(hintBound.x + hintBound.width).toBeLessThanOrEqual(DESIGN_WIDTH);
  }

  // ── 2. HUD 常驻可读：四联环的值都在，且战斗中不被面板挡住 ──
  for (const key of ['hp', 'hunger', 'thirst', 'energy']) {
    expect((await allTexts(page)).find((o) => o.name === `hud-value-${key}` && o.visible), `hud-value-${key} 战斗中应可见`).toBeTruthy();
  }
  const plateTexts = ['hud-floor', 'hud-clock', 'hud-gold', 'hud-score', 'hud-goal', 'hud-environment'];
  for (const name of plateTexts) {
    expect((await allTexts(page)).find((o) => o.name === name && o.visible), `${name} 战斗中应可见`).toBeTruthy();
  }

  // ── 3. 敌方面板：血条读数、行为标签、带武器的攻击行 ──
  // 面板文本在模态深度（PANEL_DEPTH.game.dialogue=220，内容 +5..+8）；
  // HUD 板在 103、脚注/反馈在 300，都被这个区间排除。
  const panelTexts = (await allTexts(page)).filter((o) => o.visible && o.depth >= 220 && o.depth < 300 && o.text.trim().length > 0);
  const joined = panelTexts.map((o) => o.text).join('\n');
  expect(joined).toMatch(/第 \d+ 回合/); // 血条读数行
  expect(joined).toMatch(/普通|迅捷|笨重|远程|伏击|怯战|蛮力/); // 行为标签
  expect(joined).toMatch(/(撬棍|匕首|短剑|砍刀|消防斧|空手) · 伤害 \d+/); // 攻击行带武器
  // AG-70 起战斗面板改为底部动作条（图标+效果说明），三个动作的键位提示不在
  // 面板文本里，移驻左下角脚注 combatFootHint（GameScene.ts:513「Enter 出招 ·
  // ↑/↓ 选择 · ESC 撤退」，全文无「按」字）。RC-01 分诊：探针缺陷——旧断言钉的
  // 是 AG-70 之前中央面板的「按 Enter / 按 ESC」两行，当前文案已无这两行。
  // 改按当前文案的位置断言（脚注按 name 取，与第 1 节同源）。
  const keyHint = await hudText(page, 'hud-hint');
  expect(keyHint).toContain('Enter 出招');
  expect(keyHint).toContain('ESC 撤退');

  // ── 4. 模态文本不压 HUD：两块互不相交的允许区 ──
  // RC-01 分诊：探针缺陷——旧带（244..476）钉的是 AG-70 之前的中央文字面板。
  // AG-70 起「面板」是底部动作条 + 左下角三行回合日志（hudLayout.ts
  // COMBAT_BAR：日志 logY=540 三行到 613、动作条 y=604..656、回合标签
  // turnY=588，全部收在 660 硬线内、导航条之上），双方头顶名签留在世界带
  // （scrollFactor 1，相机 zoom 1，screenY≈245..360）。两块区都不碰顶部
  // HUD 板（<230）与底部导航条（>660）。
  for (const t of panelTexts) {
    const inWorldBand = t.y >= 230 && t.y + t.height <= 500;
    const inCombatCluster = t.y >= 530 && t.y + t.height <= 660;
    expect(
      inWorldBand || inCombatCluster,
      `面板文本 ${t.text.slice(0, 12)}（y ${t.y.toFixed(0)}..${(t.y + t.height).toFixed(0)}）应落在世界带或战斗集群内`,
    ).toBe(true);
  }

  // ── 5. 打一个回合，证明面板刷新后上述都在 ──
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => {
    const c = window.__PHASER_SESSION__?.getState()?.combat as { turn: number; monster: { hp: number } } | undefined;
    return c ? { turn: c.turn, hp: c.monster.hp } : null;
  });
  if (after) {
    expect(after.turn).toBeGreaterThanOrEqual(2);
    await expect.poll(async () => hudText(page, 'hud-hint'), { timeout: 5000 }).toMatch(/^当前武器：/);
  }

  mkdirSync('output/ag63', { recursive: true });
  await page.screenshot({ path: 'output/ag63/01-combat-hud.png' });
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('AG-63-2: 绿光有名字了——≤25% 闪一次、左下角常驻、恢复也有人说', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() === 404 && !r.url().endsWith('/favicon.ico')) errors.push(`404 ${r.url()}`);
  });

  await startGame(page);
  // 起始饱食/口渴 65，离阈值远；直接改 state 跨过 25% 这条线。
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState() as unknown as GameState | null;
    if (!s) throw new Error('missing session');
    s.player.hunger = 20; // ≤25%：饿
    s.player.thirst = 80; // 不渴：文案应点「饿」的名
  });

  // ── 1. 同一帧：flash 点名绿光 + 常驻标记出现 ──
  await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 5000 }).toContain('绿光');
  const enter = await hudText(page, 'hud-feedback');
  expect(enter).toContain('吃的'); // 只饿不渴：说的是吃
  expect(enter).not.toContain('又饿又渴');

  const mark = (await allTexts(page)).find((o) => o.name === 'hud-debuff-mark');
  expect(mark, 'hud-debuff-mark 应存在').toBeTruthy();
  expect(mark!.visible, 'debuff 期间标记应可见').toBe(true);
  expect(mark!.text).toBe('状态：饥饿');
  // 标记夹在「背包已满」lane 与脚注条之间，不出画布、不压脚注。
  expect(mark!.x).toBeGreaterThanOrEqual(0);
  expect(mark!.x + mark!.width).toBeLessThanOrEqual(DESIGN_WIDTH);
  expect(mark!.y).toBeGreaterThan(0);
  expect(mark!.y + mark!.height).toBeLessThanOrEqual(DESIGN_HEIGHT);
  const hintBound = (await allTexts(page)).find((o) => o.name === 'hud-hint');
  expect(mark!.y + mark!.height, '标记不压脚注条').toBeLessThanOrEqual(hintBound!.y);

  // ── 2. 只提示一次：flash 1600ms 后清空，且阈值内不再刷 ──
  // CI 慢环境适配（run 44389231159：等 2200ms 后 flash 仍是「饥肠辘辘……」）：
  // flash 驻留按帧 delta 计时，CI 慢帧下 1600ms 游戏时间被拉长到更长真实
  // 时间——固定 2200ms 不够。改轮询真实条件（清空为止，6s 上限罩慢环境），
  // 「只提示一次」的语义不变：清空后不再刷。
  await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 6000 }).toBe('');
  await page.waitForTimeout(1500);
  expect(await hudText(page, 'hud-feedback'), '阈值内不重复刷').toBe('');
  expect((await allTexts(page)).find((o) => o.name === 'hud-debuff-mark')!.visible, '阈值内标记常驻').toBe(true);

  // ── 3. 口渴也跨线：没有新 flash（边沿只认 debuff 的进/出），标记换字 ──
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState() as unknown as GameState | null;
    if (s) s.player.thirst = 10;
  });
  await expect
    .poll(async () => (await allTexts(page)).find((o) => o.name === 'hud-debuff-mark')?.text, { timeout: 5000 })
    .toBe('状态：又饿又渴');
  await page.waitForTimeout(2200);
  expect(await hudText(page, 'hud-feedback'), '已饿再渴不刷第二遍').toBe('');

  mkdirSync('output/ag63', { recursive: true });
  await page.screenshot({ path: 'output/ag63/02-debuff-mark.png' });

  // ── 4. 恢复：闪「缓过来」，标记隐去 ──
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState() as unknown as GameState | null;
    if (s) {
      s.player.hunger = 80;
      s.player.thirst = 80;
    }
  });
  await expect.poll(async () => hudText(page, 'hud-feedback'), { timeout: 5000 }).toContain('缓过来');
  await expect
    .poll(async () => (await allTexts(page)).find((o) => o.name === 'hud-debuff-mark')?.visible, { timeout: 5000 })
    .toBe(false);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
