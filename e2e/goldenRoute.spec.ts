import { expect, test } from '@playwright/test';
import {
  closeDialogue,
  dialogueMessage,
  dialogueOptions,
  dialogueSourceLabel,
  interact,
  itemQuantity,
  labelX,
  openDialogue,
  pickOption,
  pickOptionLike,
  readNpc,
  readState,
  startGame,
  startRun,
  visibleTexts,
  waitForFloor,
  waitForScene,
  walkTo,
  type GameTarget,
} from './goldenRouteHarness';

// QA-01 · 评委黄金路线的真实浏览器 E2E（本地 dev server 一侧）。
//
// 红线：整条用例只按真实按键，不注入控制台、不改存档、不用夹具改状态。
// 状态只用只读快照 API（__PHASER_SESSION__.getState()）读回来做断言。
//
// 覆盖的黄金路线段（总控计划 §3）：
//   0:00–0:30  开局：菜单 → 游戏 → 看懂操作与目标
//   0:30–2:00  上 2 楼、开维修材料箱、给阿林赠礼（库存/关系/记忆真实变化）
//   8:30–10:00 存档与刷新恢复
//
// 为什么这里的断言都是「与 AI 后端可达性无关」的不变量：
// dev server 的 AI 模式由 VITE_NPC_* 环境变量决定（有 .env.local 时是
// 'ollama'，没有时是 'offline'）。为了让这条用例在任何机器上都给出同一个
// 结论，这里只断言玩家能观察到的契约：状态真的变了、来源标签不冒充 model、
// 拒绝时不吞掉玩家已经拥有的东西。依赖模型在线的断言放在
// e2e/onlineGoldenRoute.spec.ts（打真实部署）里做。

const SEED = 42;

async function climbToFloor2(target: GameTarget): Promise<void> {
  await walkTo(target, 40, 40_000);
  await interact(target);
  await waitForFloor(target, 2);
}

async function openRepairCache(target: GameTarget): Promise<void> {
  const boxX = await labelX(target, '维修材料箱');
  expect(boxX, '第 2 层应该有一个「维修材料箱」').not.toBeNull();
  await walkTo(target, boxX as number, 40_000);
  await interact(target);
  await target.page.waitForTimeout(1200);
}

async function talkToAlin(target: GameTarget): Promise<void> {
  const alinX = await labelX(target, '阿林');
  expect(alinX, '第 2 层应该站着阿林').not.toBeNull();
  await walkTo(target, alinX as number, 40_000);
  await openDialogue(target);
}

/** Gift one item through the visible dialogue, no shortcuts. */
async function giftToAlin(target: GameTarget, itemPrefix: string): Promise<void> {
  await pickOption(target, '赠礼');
  await target.page.keyboard.press('Enter');
  await target.page.waitForTimeout(700);
  const options = await dialogueOptions(target);
  expect(options, '赠礼面板应该列出可赠送物品').toContainEqual(
    expect.stringContaining(itemPrefix),
  );
  await pickOptionLike(target, itemPrefix);
  await target.page.keyboard.press('Enter');
  await target.page.waitForTimeout(2500);
}

test('QA-01 · 新开无存档会话：第一屏有操作说明与目标，且没有「继续游戏」的假存档', async ({ page }) => {
  const target: GameTarget = { page, frame: page };
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto(`/?seed=${SEED}`);
  await waitForScene(target, 'Menu');

  const menu = (await visibleTexts(target, 'Menu')).join(' | ');
  expect(menu, '新会话的标题菜单应该只有「开始新游戏」').toContain('开始新游戏');
  expect(menu, '没有存档时不该出现「继续游戏」').not.toContain('继续游戏');

  await startRun(target);
  const hud = (await visibleTexts(target)).join(' | ');
  expect(hud, '第一屏要告诉玩家怎么操作').toContain('E 交互');
  expect(hud, '第一屏要告诉玩家当前目标').toContain('主线');
  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
});

test('QA-01 · 黄金路线 0:30–2:00：上 2 楼、开维修材料箱、给阿林赠礼，三处状态都真的变了', async ({ page }) => {
  const target: GameTarget = { page, frame: page };
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await startGame(target, SEED);

  // ── 上楼：普通玩家按 E 站在楼梯上就会换层 ──
  await climbToFloor2(target);
  const floor2Text = (await visibleTexts(target)).join(' | ');
  expect(floor2Text, '上 2 层要给出下一步指引，而不是让玩家自己找').toContain('阿林');

  // ── 维修材料箱：真实开箱拿材料 ──
  await openRepairCache(target);
  const afterBox = await readState(target);
  expect(itemQuantity(afterBox, 'wood'), '维修材料箱里应该真的拿到木材×2').toBe(2);
  expect(itemQuantity(afterBox, 'tape'), '维修材料箱里应该真的拿到胶带×1').toBe(1);

  // ── 赠礼：库存 / 关系 / 记忆三处都要变 ──
  await talkToAlin(target);
  const before = await readState(target);
  const beforeNpc = await readNpc(target, 'alin');
  expect(itemQuantity(before, 'clean_water')).toBe(3);

  await giftToAlin(target, '赠送 净水');

  const after = await readState(target);
  const afterNpc = await readNpc(target, 'alin');
  expect(itemQuantity(after, 'clean_water'), '送出净水后玩家库存必须真扣').toBe(2);
  expect(afterNpc?.inventory, '阿林口袋里必须真的多一瓶水').toContain('clean_waterx1');
  expect(afterNpc?.trust, '关系必须真的涨').toBeGreaterThan(beforeNpc?.trust ?? 35);
  expect(afterNpc?.memoryCount, '结构化记忆必须真的多一条').toBeGreaterThan(beforeNpc?.memoryCount ?? 0);

  // ── 来源标签：赠礼走的是场景规则提案，不能冒充模型 ──
  const source = await dialogueSourceLabel(target);
  expect(source, '赠礼的来源标签必须落在 fallback 一侧').toContain('offline-fallback');
  expect(source, '赠礼没有问过模型，不能标成 model').not.toMatch(/^model$/);

  const message = await dialogueMessage(target);
  expect(message, '赠礼后必须有一句人话告诉玩家结果').toContain('赠送');

  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
});

test('QA-01 · 存档与刷新恢复：刷新后「继续游戏」能回到第 2 层并保住库存与关系', async ({ page }) => {
  const target: GameTarget = { page, frame: page };
  await startGame(target, SEED);
  await climbToFloor2(target);
  await openRepairCache(target);
  await talkToAlin(target);
  await giftToAlin(target, '赠送 净水');
  await closeDialogue(target);

  const before = await readState(target);
  const beforeNpc = await readNpc(target, 'alin');
  expect(before?.currentFloor).toBe(2);

  // 刷新：这是评委中途关标签页再打开的那一下。
  await page.reload();
  await waitForScene(target, 'Menu');
  const menu = (await visibleTexts(target, 'Menu')).join(' | ');
  expect(menu, '有存档后标题菜单必须出现「继续游戏」').toContain('继续游戏');

  // 选「继续游戏」：↓ 一次 + Enter。
  await page.locator('canvas').first().click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await waitForScene(target, 'Game', 30_000);
  await page.waitForTimeout(1200);

  const after = await readState(target);
  const afterNpc = await readNpc(target, 'alin');
  expect(after?.currentFloor, '刷新后必须回到存档所在楼层').toBe(2);
  expect(itemQuantity(after, 'wood'), '刷新后材料必须还在').toBe(2);
  expect(itemQuantity(after, 'tape'), '刷新后材料必须还在').toBe(1);
  expect(itemQuantity(after, 'clean_water'), '刷新后赠出去的水不能回来').toBe(2);
  expect(afterNpc?.trust, '刷新后关系必须还在').toBeCloseTo(beforeNpc?.trust ?? 49.4, 1);
  expect(afterNpc?.memoryCount, '刷新后记忆必须还在').toBe(beforeNpc?.memoryCount);
});

test('QA-01 · fallback 路线：模型不可用时来源标签必须是 offline-fallback，且游戏仍然可玩', async ({ page }) => {
  const target: GameTarget = { page, frame: page };
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  // 把模型请求掐掉：这是「模型不可用」的最小复现。
  await page.route('**/api/npc/decide', async (route) => {
    await route.abort('failed');
  });

  await startGame(target, SEED);
  await climbToFloor2(target);
  await talkToAlin(target);

  const source = await dialogueSourceLabel(target);
  expect(source, '模型不可用时不能标成 model').not.toMatch(/^model$/);
  expect(source, '模型不可用时必须显示降级来源').toMatch(/offline-fallback|基础对白|规则驱动|模型未响应/);

  // 降级路径必须仍然能推进玩法：赠礼照常生效。
  await giftToAlin(target, '赠送 净水');
  const after = await readState(target);
  expect(itemQuantity(after, 'clean_water'), '降级路径下赠礼仍然要真的生效').toBe(2);

  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
});
