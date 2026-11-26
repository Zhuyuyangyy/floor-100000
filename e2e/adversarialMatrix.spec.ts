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
  visibleTexts,
  waitForFloor,
  walkTo,
  type GameTarget,
} from './goldenRouteHarness';

// QA-02 · 对抗与异常矩阵（本地 dev server 一侧）。
//
// 每一项都写「玩家能观察到的结果」，不写「应该没问题」。断言分三类：
//   1) 拒绝不得改状态（规则守恒）
//   2) 拒绝不得凭空成功（不许凭空开门/凭空给物）
//   3) 拒绝不得吞掉玩家已有的东西（材料不能被吃掉）
//
// 关于 AI 后端：dev server 的 AI 模式取决于 VITE_NPC_* 环境变量，因此这里
// 一律断言「与模型可达性无关的不变量」，把「依赖模型在线」的对照放在
// e2e/onlineGoldenRoute.spec.ts 里（那里是真实部署，形态固定）。

const SEED = 42;

async function climbToFloor2(target: GameTarget): Promise<void> {
  await walkTo(target, 40, 40_000);
  await interact(target);
  await waitForFloor(target, 2);
}

async function openRepairCache(target: GameTarget): Promise<void> {
  const boxX = await labelX(target, '维修材料箱');
  await walkTo(target, boxX as number, 40_000);
  await interact(target);
  await target.page.waitForTimeout(1200);
}

async function talkToAlin(target: GameTarget): Promise<void> {
  const alinX = await labelX(target, '阿林');
  await walkTo(target, alinX as number, 40_000);
  await openDialogue(target);
}

async function giftToAlin(target: GameTarget, itemPrefix: string): Promise<void> {
  await pickOption(target, '赠礼');
  await target.page.keyboard.press('Enter');
  await target.page.waitForTimeout(700);
  await pickOptionLike(target, itemPrefix);
  await target.page.keyboard.press('Enter');
  await target.page.waitForTimeout(2500);
}

async function tryRepairPlan(target: GameTarget): Promise<void> {
  const options = await dialogueOptions(target);
  if (!options.includes('维修门计划')) return;
  await pickOption(target, '维修门计划');
  await target.page.keyboard.press('Enter');
  await target.page.waitForTimeout(4000);
}

test('QA-02 · 无物资 + 信任不足：维修门必须被拒绝，材料与信任都不能被吃掉', async ({ page }) => {
  const target: GameTarget = { page, frame: page };
  await startGame(target, SEED);
  await climbToFloor2(target);
  // 有材料（开箱），但只送一次礼 → 信任 49.4 < 门槛 70。
  await openRepairCache(target);
  await talkToAlin(target);
  await giftToAlin(target, '赠送 净水');

  const before = await readState(target);
  const beforeNpc = await readNpc(target, 'alin');
  expect(beforeNpc?.trust).toBeLessThan(70);

  await tryRepairPlan(target);

  const after = await readState(target);
  const afterNpc = await readNpc(target, 'alin');
  // 1) 门不能凭空打开
  expect(after?.flags?.['story:alin-repair-gate'], '被拒绝时维修门不能打开').toBeUndefined();
  // 2) 材料不能被吃掉（失败的维修不消耗玩家的木材与胶带）
  expect(itemQuantity(after, 'wood'), '被拒绝的维修不能扣掉木材').toBe(itemQuantity(before, 'wood'));
  expect(itemQuantity(after, 'tape'), '被拒绝的维修不能扣掉胶带').toBe(itemQuantity(before, 'tape'));
  // 3) 信任不能凭空跳
  expect(afterNpc?.trust, '被拒绝的维修不能抬高信任').toBeCloseTo(beforeNpc?.trust ?? 49.4, 1);
  // 4) 玩家必须拿到一句人话，而不是静默失败
  const message = await dialogueMessage(target);
  expect(message.trim().length, '拒绝之后必须有一句给玩家看的话').toBeGreaterThan(0);
});

test('QA-02 · 重复交互：连续按两次维修门计划，材料只能被扣一次、门只能开一次', async ({ page }) => {
  const target: GameTarget = { page, frame: page };
  await startGame(target, SEED);
  await climbToFloor2(target);
  await openRepairCache(target);
  await talkToAlin(target);
  for (let i = 0; i < 3; i += 1) {
    await giftToAlin(target, '赠送 净水').catch(() => undefined);
    if ((await dialogueOptions(target)).includes('返回')) {
      await pickOption(target, '返回').catch(() => undefined);
      await target.page.keyboard.press('Enter');
      await target.page.waitForTimeout(500);
    }
  }

  const before = await readState(target);
  expect(itemQuantity(before, 'wood'), '前提：手上正好一份木料的配方量').toBe(2);
  // 三次赠礼之后信任必须过门槛，否则这条用例测的不是「重复交互」而是「信任不足」。
  expect((await readNpc(target, 'alin'))?.trust, '前提：三次赠礼后信任已过 70').toBeGreaterThan(70);
  await pickOption(target, '维修门计划');
  // 玩家手快：连按两次 Enter。
  await target.page.keyboard.press('Enter');
  await target.page.waitForTimeout(150);
  await target.page.keyboard.press('Enter');
  await target.page.waitForTimeout(5000);

  const after = await readState(target);
  const woodLeft = itemQuantity(after, 'wood');
  const tapeLeft = itemQuantity(after, 'tape');
  // 材料要么一份没扣（被拒绝），要么正好扣一份配方（成功），不能扣两份。
  expect([0, 2], '剩余木材必须是 0（扣掉一份配方）或 2（一份没扣），不能更少').toContain(woodLeft);
  expect([0, 1], '剩余胶带必须是 0（扣掉一份配方）或 1（一份没扣），不能更少').toContain(tapeLeft);
  // 门最多开一次（flag 只能是 1，不能是 2）
  expect([undefined, 1], '维修门 flag 只能是未设置或 1').toContain(after?.flags?.['story:alin-repair-gate']);
});

test('QA-02 · 跨楼层：维修门没开时上 3 楼必须被拒绝，并且给出为什么', async ({ page }) => {
  const target: GameTarget = { page, frame: page };
  await startGame(target, SEED);
  await climbToFloor2(target);
  // 不修门，直接走到楼梯按 E。
  await walkTo(target, 40, 40_000);
  await interact(target);
  await target.page.waitForTimeout(2500);

  const state = await readState(target);
  expect(state?.currentFloor, '门没修好就不该上到第 3 层').toBe(2);
  const texts = (await visibleTexts(target)).join(' | ');
  expect(texts, '被拒绝上楼时必须告诉玩家为什么、以及先做什么').toContain('阿林');
});

test('QA-02 · 非法动作：修门材料不允许当礼物送掉（赠礼清单必须排除保留材料）', async ({ page }) => {
  const target: GameTarget = { page, frame: page };
  await startGame(target, SEED);
  await climbToFloor2(target);
  await openRepairCache(target);
  await talkToAlin(target);
  await pickOption(target, '赠礼');
  await target.page.keyboard.press('Enter');
  await target.page.waitForTimeout(700);
  const options = await dialogueOptions(target);
  expect(options, '修门材料不能出现在赠礼清单里').not.toContain('赠送 木材×1（持有2）');
  expect(options, '修门材料不能出现在赠礼清单里').not.toContain('赠送 胶带×1（持有1）');
});

test('QA-02 · 买不起的交易：脏水换净水必须被拒绝，库存不能出现负数或半笔成交', async ({ page }) => {
  const target: GameTarget = { page, frame: page };
  await startGame(target, SEED);
  await climbToFloor2(target);
  const zhouX = await labelX(target, '小周');
  expect(zhouX, '第 2 层应该站着小周').not.toBeNull();
  await walkTo(target, zhouX as number, 40_000);
  await openDialogue(target);

  const before = await readState(target);
  expect(itemQuantity(before, 'dirty_water'), '开局没有脏水，正好构造买不起的交易').toBe(0);

  await pickOption(target, '交易');
  await target.page.keyboard.press('Enter');
  await target.page.waitForTimeout(700);
  const tradeOptions = await dialogueOptions(target);
  const dirtyTrade = tradeOptions.find((o) => o.includes('脏水'));
  expect(dirtyTrade, '小周应该有「脏水换净水」这一项').toBeTruthy();

  await pickOption(target, dirtyTrade as string);
  await target.page.keyboard.press('Enter');
  await target.page.waitForTimeout(1500);

  const after = await readState(target);
  // 买不起的交易不许产生任何库存变化，也不许出现负数。
  for (const stack of after?.player.inventory.slots ?? []) {
    expect(stack.quantity, '库存数量永远不能是负数').toBeGreaterThanOrEqual(0);
  }
  expect(itemQuantity(after, 'dirty_water'), '买不起就不该扣脏水').toBe(0);
  expect(itemQuantity(after, 'clean_water'), '买不起就不该白拿净水').toBe(itemQuantity(before, 'clean_water'));
  const message = await dialogueMessage(target);
  expect(message.trim().length, '失败的交易必须给玩家一句说明').toBeGreaterThan(0);
  await closeDialogue(target);
});

test('QA-02 · 请求超时：模型请求卡住时，游戏仍然能操作且不冒充 model', async ({ page }) => {
  const target: GameTarget = { page, frame: page };
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  // 模型请求挂住（不 abort，但也不回）。
  await page.route('**/api/npc/decide', async () => {
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  });

  await startGame(target, SEED);
  await climbToFloor2(target);
  await talkToAlin(target);

  const source = await dialogueSourceLabel(target);
  expect(source, '模型没回话时不能标成 model').not.toMatch(/^model$/);

  // 界面不能被卡死：请求挂着的时候玩家依然能关掉对话框、继续走。
  await closeDialogue(target);
  const before = await readState(target);
  await walkTo(target, 300, 20_000);
  const after = await readState(target);
  expect(after?.player.x, '模型请求挂着的时候玩家依然能移动').toBeLessThan(before?.player.x ?? 0);
  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
});

test('QA-02 · 网络断开：断网时对话仍要能开，来源标签不能冒充 model', async ({ page, context }) => {
  const target: GameTarget = { page, frame: page };
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await startGame(target, SEED);
  await climbToFloor2(target);

  await context.setOffline(true);
  await talkToAlin(target);
  const source = await dialogueSourceLabel(target);
  expect(source, '断网时不能标成 model').not.toMatch(/^model$/);
  expect(source, '断网时必须显示降级来源').toMatch(/offline-fallback|基础对白|规则驱动|模型未响应/);

  // 断网下规则玩法仍然可用。
  await giftToAlin(target, '赠送 净水');
  const after = await readState(target);
  expect(itemQuantity(after, 'clean_water'), '断网时规则赠礼仍然要生效').toBe(2);

  await context.setOffline(false);
  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
});
