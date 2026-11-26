import { expect, test } from '@playwright/test';
import {
  attachPublicGame,
  dialogueMessage,
  dialogueSourceLabel,
  interact,
  itemQuantity,
  labelX,
  openDialogue,
  pickOption,
  pickOptionLike,
  readNpc,
  readState,
  visibleTexts,
  waitForFloor,
  walkTo,
  type GameTarget,
} from './goldenRouteHarness';

// QA-01 / QA-02 · 打**真实公开部署**的黄金路线。
//
// 为什么必须有这一份：本地 dev server 的 AI 形态由 VITE_NPC_* 环境变量决定，
// 线上是固定的生产构建（代理模式），两者行为不同。评委看到的是线上那份，
// 所以「可玩性」必须在线上证明。
//
// 红线：入口是普通公开地址（门户页 → 门户挂出的 iframe），全程只按真实按键。
// 不注入控制台、不改存档、不用夹具改状态。
//
// 运行：
//   PUBLIC_BASE=https://www.modelscope.cn/studios/<ns>/<name> \
//     npx playwright test -c playwright.config.ts e2e/onlineGoldenRoute.spec.ts
// 不设 PUBLIC_BASE 时整条跳过：线上空间临时不可用不该让 CI 红，但也不能
// 因此把「没跑过」写成「跑过且通过」。

const PUBLIC_BASE = process.env.PUBLIC_BASE ?? '';
const APP_PATH = '/?seed=42&debug=1';

test.skip(!PUBLIC_BASE, '未设置 PUBLIC_BASE：跳过线上公开部署的黄金路线');

async function climbToFloor2(target: GameTarget): Promise<void> {
  await walkTo(target, 40, 60_000);
  await interact(target);
  await waitForFloor(target, 2, 30_000);
}

async function giftToAlin(target: GameTarget, itemPrefix: string): Promise<void> {
  await pickOption(target, '赠礼');
  await target.page.keyboard.press('Enter');
  await target.page.waitForTimeout(900);
  await pickOptionLike(target, itemPrefix);
  await target.page.keyboard.press('Enter');
  await target.page.waitForTimeout(6000);
}

test('线上 · 黄金路线 0:00–10:00：开局 → 2 楼送礼 → 修门 → 上 3 楼出第 1 章结算卡', async ({ page }) => {
  const target = await attachPublicGame(page, PUBLIC_BASE, APP_PATH);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await target.frame.locator('canvas').first().click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('Enter');
  await waitForSceneSafe(target, 'MetaSelect');
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Enter');
    const started = await target.frame
      .waitForFunction(
        () => {
          const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
          return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
        },
        undefined,
        { timeout: 3000 },
      )
      .then(() => true)
      .catch(() => false);
    if (started) break;
  }
  await waitForSceneSafe(target, 'Game', 60_000);
  await page.waitForTimeout(1500);

  // ── 0:00–0:30 开局：第一屏要能看懂操作与目标 ──
  const hud = (await visibleTexts(target)).join(' | ');
  expect(hud, '第一屏要能看懂操作').toContain('E 交互');
  expect(hud, '第一屏要能看懂目标').toContain('主线');

  // ── 0:30–2:00 上 2 楼、开材料箱 ──
  await climbToFloor2(target);
  const boxX = await labelX(target, '维修材料箱');
  expect(boxX, '第 2 层应该有维修材料箱').not.toBeNull();
  await walkTo(target, boxX as number, 60_000);
  await interact(target);
  await page.waitForTimeout(1500);
  const afterBox = await readState(target);
  expect(itemQuantity(afterBox, 'wood'), '线上也要真的拿到木材×2').toBe(2);
  expect(itemQuantity(afterBox, 'tape'), '线上也要真的拿到胶带×1').toBe(1);

  // ── 0:30–2:00 送礼 ──
  const alinX = await labelX(target, '阿林');
  expect(alinX, '第 2 层应该站着阿林').not.toBeNull();
  await walkTo(target, alinX as number, 60_000);
  await openDialogue(target);

  for (let g = 1; g <= 3; g += 1) {
    if (g > 1) {
      await pickOption(target, '返回');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(700);
    }
    await giftToAlin(target, '赠送 净水');
  }
  const alin = await readNpc(target, 'alin');
  expect(alin?.trust, '三次赠礼后信任必须过 70 的门槛').toBeGreaterThan(70);
  expect(alin?.memoryCount, 'NPC 记忆必须真的增长').toBeGreaterThanOrEqual(3);

  // ── 2:00–4:30 修门 ──
  await pickOption(target, '返回');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  await pickOption(target, '维修门计划');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(20_000);

  const repair = await scenePropSafe(target, 'lastAlinRepairResult');
  expect(repair?.status, '条件齐备时维修必须真的执行').toBe('executed');
  expect(['model', 'offline-fallback'], '来源标签必须区分模型与降级').toContain(repair?.decisionSource);
  const afterRepair = await readState(target);
  expect(afterRepair?.flags?.['story:alin-repair-gate'], '门必须真的打开').toBe(1);
  expect(itemQuantity(afterRepair, 'wood'), '材料必须正好扣一份').toBe(0);
  expect(itemQuantity(afterRepair, 'tape'), '材料必须正好扣一份').toBe(0);

  // ── 8:30–10:00 上 3 楼 → 第 1 章结算卡 ──
  await interact(target);
  await page.waitForTimeout(800);
  await walkTo(target, 40, 60_000);
  await interact(target);
  await page.waitForTimeout(6000);
  const scenes = await target.frame.evaluate(() =>
    (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__?.scene.getScenes(true).map((s) => s.scene.key) ?? [],
  );
  expect(scenes, '上到第 3 层应该弹第 1 章结算卡（End 场景）').toContain('End');
  const endText = (await visibleTexts(target, 'End')).join(' | ');
  expect(endText, '结算卡要写清楚这是第 1 章完成').toContain('第 1 章完成');

  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
});

test('线上 · BLOCKER-01：模型不可用时修门不能变成一条没有下一步的死路', async ({ page }) => {
  const target = await attachPublicGame(page, PUBLIC_BASE, APP_PATH);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  // 把同源模型代理掐掉：线上是生产构建（代理模式），模型不可用时必须降级，
  // 而不是把玩家卡死在一句「校验拒绝」上。
  await page.route('**/api/npc/decide', async (route) => {
    await route.abort('failed');
  });

  await target.frame.locator('canvas').first().click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('Enter');
  await waitForSceneSafe(target, 'MetaSelect');
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Enter');
    const started = await target.frame
      .waitForFunction(
        () => {
          const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
          return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
        },
        undefined,
        { timeout: 3000 },
      )
      .then(() => true)
      .catch(() => false);
    if (started) break;
  }
  await waitForSceneSafe(target, 'Game', 60_000);
  await page.waitForTimeout(1200);

  await climbToFloor2(target);
  const boxX = await labelX(target, '维修材料箱');
  await walkTo(target, boxX as number, 60_000);
  await interact(target);
  await page.waitForTimeout(1500);

  const alinX = await labelX(target, '阿林');
  await walkTo(target, alinX as number, 60_000);
  await openDialogue(target);
  for (let g = 1; g <= 3; g += 1) {
    if (g > 1) {
      await pickOption(target, '返回');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(700);
    }
    await giftToAlin(target, '赠送 净水');
  }

  await pickOption(target, '返回');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  await pickOption(target, '维修门计划');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(20_000);

  const repair = await scenePropSafe(target, 'lastAlinRepairResult');
  const message = await dialogueMessage(target);
  const after = await readState(target);
  const gateOpen = after?.flags?.['story:alin-repair-gate'] === 1;

  // 降级路径不许冒充模型。
  expect(repair?.decisionSource, '模型不可用时不得标成 model').not.toBe('model');
  const sourceLabel = await dialogueSourceLabel(target);
  expect(sourceLabel, '模型不可用时对话框的来源标签不得显示成模型').not.toMatch(/^model$/);
  expect(sourceLabel, '模型不可用时对话框的来源标签必须显示降级来源').toMatch(/offline-fallback|基础对白|规则驱动|模型未响应/);

  if (gateOpen) {
    // 走了降级兜底：门开了，路线能继续。
    expect(repair?.status).toBe('executed');
  } else {
    // 门没开：那就必须给出一条「下一步」，而不是把玩家晾在原地。
    // 这一句就是当前版本违反的地方（线上实测停在「校验拒绝｜未改变」）。
    expect(
      message,
      `修门被拒时必须告诉玩家下一步怎么做（当前原文：${JSON.stringify(message)}）`,
    ).toMatch(/材料|木材|胶带|保险丝|电线|第\s*\d\s*层|信任/);
  }
  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
});

async function waitForSceneSafe(target: GameTarget, key: string, timeout = 30_000): Promise<void> {
  await target.frame.waitForFunction(
    (k) => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === k);
    },
    key,
    { timeout },
  );
}

async function scenePropSafe(target: GameTarget, name: string): Promise<{
  status?: string;
  decisionSource?: string;
  attempts?: number;
  validation?: { accepted: boolean; reason?: string; detailCode?: string } | null;
  feedback?: Array<{ attempt: number; outcome: string }>;
} | null> {
  return target.frame.evaluate((n) => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => Record<string, unknown> | null } } }).__PHASER_GAME__;
    const value = g?.scene.getScene('Game')?.[n];
    return value === undefined ? null : (value as never);
  }, name) as Promise<never>;
}
