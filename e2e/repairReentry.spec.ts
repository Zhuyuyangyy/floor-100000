import { expect, test, type Page } from '@playwright/test';

/**
 * 维修流程重入锁（`GameScene.repairInFlight`，commit 3ef5c88）的证伪测试。
 *
 * 锁的实现把一个 `finally` 放在 `try` 上：`try` 内部有「对话已被关掉 → 提前
 * return」的分支，如果那条分支绕过了 `finally`，第一次维修就会把锁永久留在
 * 手上，玩家之后再点「维修门计划」会被静默丢弃——界面上什么都不发生，看起来
 * 像卡死而不是报错。这种缺陷不抛异常，只能靠「第二次还能不能走完」来证伪。
 *
 * 三个观测点，缺一不可：
 *
 *   1. 第一次点维修后 `repairInFlight === true`。证明锁真的上了。
 *   2. 中途 ESC 关掉对话、等第一次跑完后 `repairInFlight === false`。证明
 *      `finally` 在「对话已关闭」这条 return 路径上确实执行了。
 *   3. 重开对话再点维修，占位文案重新出现并最终落到结论。证明锁没被吞掉，
 *      玩家还能再修一次。
 *
 * 制造「在途」窗口的办法：把 `crypto.subtle.digest` 包一层延时。维修场景在
 * 返回结果前要算两次世界状态哈希，这两次 await 是整条流程里唯一稳定的异步
 * 尾巴——延时落在这里，ESC 就一定打在「场景已跑完、结果还没交回调用方」的
 * 那一瞬间，也就是提前 return 分支唯一会被走到的那一瞬间。不用假模型、不用
 * 等 45s 超时，也不会因为 Ollama 在不在线而变成偶发红。
 */

const PLACEHOLDER = '只读观察 → 结构化提案 → 校验…';
/** 哈希延时：够长到跑完两三次 CDP 往返，够短到不拖慢套件。 */
const HASH_DELAY_MS = 2_500;

interface GameSceneProbe {
  player?: { x: number };
  stairClimb?: unknown;
}

/** 只回传几个标量：整只 Phaser.Scene 过 CDP 序列化会炸。 */
interface RepairProbe {
  message: string;
  messageSource: string;
  repairInFlight: boolean;
  repairStatus: string | null;
  repairAttempts: number;
  /**
   * 停电危机那条路的锁与结果。本用例**不该**碰到它们——见下面 `assertLegacyRoute`
   * 的说明。放在探针里是为了能在运行时证明这一点，而不是靠读代码推断。
   */
  blackoutInFlight: boolean;
  blackoutRepairStatus: string | null;
}

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction((k) => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
    return !!g && g.scene.getScenes(true).some((s) => s.scene.key === k);
  }, key, { timeout: 20_000 });
}

/**
 * 等菜单条目真正可交互。
 *
 * MenuScene 的入场是一段 `alpha: 0 → 1` 的补间（MenuScene.ts:151），而 Phaser 4
 * 的命中判定要求 `willRender()`——alpha 为 0 时它是 false。场景 key 已经变成
 * 'Menu' 不代表菜单能按：这时候按 Enter 会被整个吞掉，游戏停在标题页。
 * 判据用「条目存在且 alpha 已到 1」，不用固定等待时间。
 */
async function waitForMenuReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; alpha: number; visible: boolean }> } } | null } } }).__PHASER_GAME__;
    const list = g?.scene.getScene('Menu')?.children.list ?? [];
    const entries = list.filter((o) => o.type === 'Text' && o.visible
      && (o.text === '开始新游戏' || o.text === '开始 AI NPC 试玩' || o.text === '继续游戏' || o.text === '操作说明'));
    return entries.length > 0 && entries.every((o) => o.alpha >= 1);
  }, undefined, { timeout: 20_000 });
}

async function startGame(page: Page, seed: number): Promise<void> {
  // `ainpc=0` 关掉模型：这条用例验的是锁的生命周期，不是模型输出。模型开着
  // 的话每次决策要走一遍 45s 级别的请求，锁的行为会被网络时序盖住。
  await page.goto(`/?seed=${seed}&ainpc=0`);
  await waitForScene(page, 'Menu');
  await waitForMenuReady(page);
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const started = await page.waitForFunction(() => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
    }, undefined, { timeout: 2000 }).then(() => true).catch(() => false);
    if (started) break;
  }
  await waitForScene(page, 'Game');
}

async function setPlayerX(page: Page, x: number): Promise<void> {
  await page.evaluate((value) => {
    const w = window as unknown as {
      __PHASER_SESSION__?: { getState: () => { player: { x: number } } | null };
      __PHASER_GAME__?: { scene: { getScene: (key: string) => GameSceneProbe | null } };
    };
    const state = w.__PHASER_SESSION__?.getState();
    if (state) state.player.x = value;
    const scene = w.__PHASER_GAME__?.scene.getScene('Game');
    if (scene?.player) scene.player.x = value;
  }, x);
  await page.waitForFunction((value) => {
    const w = window as unknown as {
      __PHASER_SESSION__?: { getState: () => { player: { x: number } } | null };
      __PHASER_GAME__?: { scene: { getScene: (key: string) => GameSceneProbe | null } };
    };
    return w.__PHASER_SESSION__?.getState()?.player.x === value
      && w.__PHASER_GAME__?.scene.getScene('Game')?.player?.x === value;
  }, x, { timeout: 5000 });
}

/** 走到阿林的楼层（第 2 层）：先挪到楼梯口，再按 E。 */
async function goToAlinFloor(page: Page): Promise<void> {
  await setPlayerX(page, 40);
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (key: string) => GameSceneProbe | null } };
      __PHASER_SESSION__?: { getState: () => { currentFloor: number; player: { x: number } } | null };
    };
    return w.__PHASER_SESSION__?.getState()?.currentFloor === 1
      && w.__PHASER_SESSION__?.getState()?.player.x === 40
      && w.__PHASER_GAME__?.scene.getScene('Game')?.player?.x === 40
      && !w.__PHASER_GAME__?.scene.getScene('Game')?.stairClimb;
  }, undefined, { timeout: 5000 });
  await page.keyboard.press('E');
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (key: string) => GameSceneProbe | null } };
      __PHASER_SESSION__?: { getState: () => { currentFloor: number } | null };
    };
    return w.__PHASER_SESSION__?.getState()?.currentFloor === 2
      && !w.__PHASER_GAME__?.scene.getScene('Game')?.stairClimb;
  }, undefined, { timeout: 5000 });
}

async function probeRepair(page: Page): Promise<RepairProbe> {
  return page.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => {
      dialogue?: { message: string; messageSource: string } | null;
      repairInFlight?: boolean;
      lastAlinRepairResult?: { status?: string; attempts?: number };
      blackoutInFlight?: boolean;
      lastBlackoutRepairResult?: { status?: string } | null;
    } | null } } }).__PHASER_GAME__;
    const scene = g?.scene.getScene('Game');
    return {
      message: scene?.dialogue?.message ?? '',
      messageSource: scene?.dialogue?.messageSource ?? '',
      repairInFlight: scene?.repairInFlight === true,
      repairStatus: scene?.lastAlinRepairResult?.status ?? null,
      repairAttempts: scene?.lastAlinRepairResult?.attempts ?? 0,
      blackoutInFlight: scene?.blackoutInFlight === true,
      blackoutRepairStatus: scene?.lastBlackoutRepairResult?.status ?? null,
    };
  });
}

/**
 * 断言这次维修走的是 legacy 路径（`runAlinRepairPlan`），不是停电危机路径
 * （`runBlackoutRepairPlan`）。
 *
 * 为什么要写这条：`dispatchBlackoutAlin` 会在**停电危机已启动**时把阿林的维修
 * 分到 `runBlackoutRepairPlan` 去。两条路各有自己的锁和自己的结果字段。如果本
 * 用例在某个不经意的改动后（新种子、危机提前触发、`isBlackoutActive` 行为变化）
 * 悄悄走成了 blackout 路径，那么：
 *
 *   - 主用例仍在断言 `repairInFlight` / `lastAlinRepairResult`——那两个字段这
 *     条路**根本不写**，于是「第二次维修仍能走完」会变成永远绿的真空断言；
 *   - 判据自检装的属性陷阱也只作用于 `repairInFlight`，同样打不中。
 *
 * 两条一起红/绿看起来「通过」，实则什么都没测。所以这里把「走的是哪条路」
 * 变成一条显式断言：路走岔了就红，而不是静默退化。
 *
 * 同时这也回答了 A2 的改动安全性问题：只要本断言在，任何把本用例推到 blackout
 * 路径上的改动都会立刻失败，而不是让 A2 以为自己的改动「通过了 E2E」。
 */
async function assertLegacyRepairRoute(page: Page): Promise<void> {
  const probe = await probeRepair(page);
  expect(
    probe.blackoutInFlight,
    '本用例只测 runAlinRepairPlan；停电危机路径有自己的 blackoutInFlight，不该被触发',
  ).toBe(false);
  expect(
    probe.blackoutRepairStatus,
    '本用例只读 lastAlinRepairResult；blackout 路径的结果另存 lastBlackoutRepairResult',
  ).toBeNull();
}

async function hasVisibleText(page: Page, text: string): Promise<boolean> {
  return page.evaluate((needle) => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean }> } } | null } } }).__PHASER_GAME__;
    return (g?.scene.getScene('Game')?.children.list ?? []).some((o) => o.type === 'Text' && o.visible && (o.text ?? '').includes(needle));
  }, text);
}

async function cursorLabel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean; y: number; texture?: { key?: string }; depth?: number }> } } | null } } }).__PHASER_GAME__;
    const list = g?.scene.getScene('Game')?.children.list ?? [];
    const marker = list.find((o) => o.type === 'Image' && o.texture?.key === 'ui-marker' && o.visible);
    if (!marker) return '';
    return list.find((o) => o.type === 'Text' && o.visible && (o.depth ?? 0) >= 190 && Math.abs(o.y - marker.y) <= 6)?.text ?? '';
  });
}

async function selectOption(page: Page, target: string): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const label = await cursorLabel(page);
    if (label === target) return;
    await page.keyboard.press(label === '交易' || label === '退出' ? 'ArrowUp' : 'ArrowDown');
    await page.waitForTimeout(100);
  }
  throw new Error(`could not select ${target}; current=${await cursorLabel(page)}`);
}

/**
 * 给世界状态哈希加一段延时，制造稳定的「在途」窗口。
 *
 * 只延时、不改语义：算法和输入原样透传，算出来的哈希跟没包一样。
 * 用 defineProperty 而不是直接赋值，因为 `digest` 定义在 SubtleCrypto 的
 * 原型上，赋值只会挂一个同名的自有属性、绕过不了原型方法。
 */
async function delayWorldHashing(page: Page, delayMs: number): Promise<void> {
  await page.evaluate((delay) => {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error('crypto.subtle 不可用，无法制造在途窗口');
    const original = subtle.digest.bind(subtle);
    Object.defineProperty(subtle, 'digest', {
      configurable: true,
      value: async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return original(algorithm, data);
      },
    });
  }, delayMs);
}

test('维修进行中按 ESC 关掉对话后锁会释放，第二次维修仍能走到结论', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await page.setViewportSize({ width: 390, height: 844 });
  page.on('pageerror', (error) => errors.push(error.message));

  await startGame(page, 64211);
  await goToAlinFloor(page);
  // 低信任（35/70）+ 材料齐备：跑完必然被 validator 拒，世界状态不变。
  // 世界不变，第二次维修面对的就是和第一次完全一样的条件，结果可比。
  await page.evaluate(() => {
    const state = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { inventory: { slots: Array<{ itemId: string; quantity: number }> } } } | null } }).__PHASER_SESSION__?.getState();
    state?.player.inventory.slots.push({ itemId: 'wood', quantity: 2 }, { itemId: 'tape', quantity: 1 });
  });
  await setPlayerX(page, 480);
  await delayWorldHashing(page, HASH_DELAY_MS);

  await page.keyboard.press('E');
  await expect.poll(() => hasVisibleText(page, '阿林（维修工）')).toBe(true);

  // ── 第一次维修：确认上了锁，再中途关对话 ────────────────────────────
  await selectOption(page, '维修门计划');
  await page.keyboard.press('Enter');

  // 占位文案是 `runAlinRepairPlan` 上锁之后、第一次 await 之前写的，
  // 看到它就等于看到「锁已被持有」。
  await expect.poll(async () => (await probeRepair(page)).message, { timeout: 10_000 }).toBe(PLACEHOLDER);
  expect((await probeRepair(page)).repairInFlight, '第一次维修开始后锁应该是持有的').toBe(true);

  // 趁哈希还在算（结果还没交回调用方）关掉对话：这就是「对话被关掉 → 提前
  // return」那条路径，也是 finally 最容易被绕过的地方。
  await page.keyboard.press('Escape');
  await expect.poll(() => hasVisibleText(page, '阿林（维修工）'), { timeout: 5000 }).toBe(false);

  // ── 锁必须在第一次跑完后释放 ────────────────────────────────────────
  await expect.poll(async () => (await probeRepair(page)).repairStatus, { timeout: 30_000 }).not.toBeNull();
  await expect.poll(async () => (await probeRepair(page)).repairInFlight, { timeout: 15_000 }).toBe(false);

  const first = await probeRepair(page);
  // 先确认这条路真的是 legacy：否则后面所有断言都在测一个不由本函数驱动的字段。
  await assertLegacyRepairRoute(page);
  expect(first.repairAttempts, `第一次维修应该真的跑过（attempts=${first.repairAttempts}）`).toBeGreaterThan(0);
  // 用例的前提，也是「第二次和第一次条件相同」的保证：
  // 初始信任 35 低于维修门槛 70，validator 必然拒绝 → 门不开 → 世界状态不变。
  // 一旦哪天平衡改动让第一次维修成功，门在同一天内就会打开（88fb4c9 起不再等
  // 跨天），停电危机立刻启动，第二次维修就改走 `runBlackoutRepairPlan`——那时
  // 本用例断言的 `repairInFlight` / `lastAlinRepairResult` 都不会再被写入，
  // 判据会退化成恒真的真空断言。
  //
  // 所以把前提写成显式断言：前提破了就红在这里，而不是变成一条看起来还绿、
  // 实际什么都没测的用例。
  expect(
    ['blocked', 'exhausted', 'planning_failed'],
    `前提：第一次维修必须被拒（门不能开），实际 status=${String(first.repairStatus)}。`
      + '若变成 executed/already_open，本用例的第二次维修会走停电危机路径，判据失效。',
  ).toContain(first.repairStatus);

  // ── 第二次维修：锁没卡住，就该重新跑一遍并落到结论 ──────────────────
  //
  // 先把上一次的结果对象清空。这样「又出现了一个结果」就是不可争辩的新证据，
  // 而不是读到上一轮残留的同一个对象——否则一条永远读到旧值的断言会假装通过。
  // 这个字段只服务于诊断面板，清空它不影响维修本身的决策与提交。
  await page.evaluate(() => {
    const scene = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => Record<string, unknown> | null } } })
      .__PHASER_GAME__?.scene.getScene('Game');
    if (scene) scene.lastAlinRepairResult = undefined;
  });
  expect((await probeRepair(page)).repairStatus, '清空后应当读不到旧结果').toBeNull();

  await page.keyboard.press('E');
  await expect.poll(() => hasVisibleText(page, '阿林（维修工）'), { timeout: 5000 }).toBe(true);

  await selectOption(page, '维修门计划');
  await page.keyboard.press('Enter');

  // 这一条是整条用例的判据：锁若泄漏，重入守卫会立刻 return，占位文案
  // 永远不会出现——玩家点了没反应，而且没有任何报错。
  await expect.poll(async () => (await probeRepair(page)).message, { timeout: 10_000 }).toBe(PLACEHOLDER);
  expect((await probeRepair(page)).repairInFlight, '第二次维修也应该重新持锁').toBe(true);

  // 「走完」的判据是**锁自己回到空闲 + 产出了新的结果对象**，不是某句文案。
  //
  // 为什么不用文案：维修跑完的同一瞬间，别的系统可能把对话面板关掉（事件、
  // 楼层切换、停电危机都会）。这时 `dialogue` 变成 null，文案读回来是空串，
  // 于是「文案里有结论」这条断言会在一片正常里报红——它测的是面板还在不在，
  // 不是维修跑没跑完。
  //
  // 反过来，这两条一起成立就足以证明锁没泄漏：占位文案出现过（说明真的进了
  // 临界区）、锁回到 false（说明它自己放掉了）、结果对象非空（说明跑到了末尾）。
  await expect.poll(async () => (await probeRepair(page)).repairInFlight, { timeout: 30_000 }).toBe(false);
  await expect.poll(async () => (await probeRepair(page)).repairStatus, { timeout: 15_000 }).not.toBeNull();

  const second = await probeRepair(page);
  // 第一次若改动了世界，第二次会是 already_open；没改动就是同样的拒绝。
  // 两种都算「走完」，关键是不能是「没结果」。
  expect(['blocked', 'executed', 'already_open', 'exhausted', 'planning_failed']).toContain(second.repairStatus);
  expect(second.repairAttempts).toBeGreaterThan(0);
  // 占位文案不许永久停留：要么已被结论替换，要么面板已经关掉。
  expect(second.message).not.toBe(PLACEHOLDER);
  expect(errors, `页面异常：${errors.join(' | ')}`).toEqual([]);
});

/**
 * 判据自检：证明上一条用例的判据**会红**。
 *
 * 一条永远绿的测试等于没测。上一条的核心判据是「关掉再打开、再点维修之后，
 * 占位文案会重新出现、且锁最终回到空闲」。必须证明这条判据真的能区分「锁正常
 * 释放」与「锁泄漏」——否则它可能只是在测「对话框还在」，那它毫无价值。
 *
 * 做法是**忠实复现那个缺陷**：`finally` 没执行 = `repairInFlight` 再也写不进
 * false。这里给场景实例装一个属性陷阱，`= true` 照常生效、`= false` 被吞掉，
 * 于是第一次维修结束时锁就永久留在手上——和漏写 `finally` 的终态完全一致。
 *
 * 然后跑**与上一条完全相同**的操作序列。如果上一条的判据是有效的，它在这里
 * 就必须红。所以本用例断言的是「第二次维修不会发生」：占位文案不出现、没有新
 * 结果、锁仍是 true。
 *
 * 这条同时是「锁泄漏的玩家体验」存证：**没有报错、没有反馈、点了跟没点一样**。
 * 这类缺陷不抛异常，最容易被「测试全绿」掩盖。
 */
test('判据自检：把 finally 的放锁吞掉后，第二次维修不再发生（证明上一条的判据确实在测锁）', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });

  await startGame(page, 64211);
  await goToAlinFloor(page);
  await page.evaluate(() => {
    const state = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { inventory: { slots: Array<{ itemId: string; quantity: number }> } } } | null } }).__PHASER_SESSION__?.getState();
    state?.player.inventory.slots.push({ itemId: 'wood', quantity: 2 }, { itemId: 'tape', quantity: 1 });
  });
  await setPlayerX(page, 480);
  await delayWorldHashing(page, HASH_DELAY_MS);

  // 装陷阱：`= true` 生效，`= false` 被丢弃 —— 等价于 finally 从未执行。
  await page.evaluate(() => {
    const scene = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => Record<string, unknown> | null } } })
      .__PHASER_GAME__?.scene.getScene('Game') as Record<string, unknown> | null;
    if (!scene) throw new Error('Game 场景不存在');
    let held = scene.repairInFlight === true;
    Object.defineProperty(scene, 'repairInFlight', {
      configurable: true,
      get: () => held,
      set: (value: unknown) => { if (value === true) held = true; },
    });
  });

  // ── 第一次维修，中途 ESC —— 与上一条完全相同的序列 ──────────────────
  await page.keyboard.press('E');
  await expect.poll(() => hasVisibleText(page, '阿林（维修工）')).toBe(true);
  await selectOption(page, '维修门计划');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await probeRepair(page)).message, { timeout: 10_000 }).toBe(PLACEHOLDER);
  await page.keyboard.press('Escape');
  await expect.poll(() => hasVisibleText(page, '阿林（维修工）'), { timeout: 5000 }).toBe(false);

  // 第一次确实跑完了（结果对象已产出），但锁没被放掉。
  await expect.poll(async () => (await probeRepair(page)).repairStatus, { timeout: 30_000 }).not.toBeNull();
  const leaked = await probeRepair(page);
  expect(leaked.repairInFlight, '陷阱生效：跑完后锁应当仍然被持有（这就是泄漏态）').toBe(true);
  // 自检本身也有前提：陷阱只装在 repairInFlight 上，若走了 blackout 路径，
  // 「锁没放掉」就不再是陷阱造成的，这条自检也就失去了证明力。
  await assertLegacyRepairRoute(page);

  // ── 第二次维修：判据必须红 ──────────────────────────────────────────
  await page.evaluate(() => {
    const scene = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => Record<string, unknown> | null } } })
      .__PHASER_GAME__?.scene.getScene('Game') as Record<string, unknown> | null;
    if (scene) scene.lastAlinRepairResult = undefined;
  });

  await page.keyboard.press('E');
  await expect.poll(() => hasVisibleText(page, '阿林（维修工）'), { timeout: 5000 }).toBe(true);
  await selectOption(page, '维修门计划');
  await page.keyboard.press('Enter');

  // 等足时间：若这一击真的进去了，2.5s 的哈希延时足够让占位文案被看见。
  await page.waitForTimeout(HASH_DELAY_MS * 2);

  const stuck = await probeRepair(page);
  // 这三条是上一条判据的反面，一起成立才说明那条判据真的在测锁。
  expect(stuck.message, '泄漏态下不应该出现占位文案——否则上一条的判据测不到锁').not.toBe(PLACEHOLDER);
  expect(stuck.repairStatus, '泄漏态下不应该产生新的维修结果').toBeNull();
  expect(stuck.repairInFlight).toBe(true);

  // 拆掉陷阱（重装一次不吞 false 的 setter）、放锁，同一套操作立刻恢复。
  // 证明刚才的「没反应」纯粹是锁造成的，不是对话坏了、也不是按键没送到。
  await page.evaluate(() => {
    const scene = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => Record<string, unknown> | null } } })
      .__PHASER_GAME__?.scene.getScene('Game') as Record<string, unknown> | null;
    if (!scene) return;
    delete (scene as { repairInFlight?: unknown }).repairInFlight;
    scene.repairInFlight = false;
    scene.lastAlinRepairResult = undefined;
  });
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await probeRepair(page)).repairStatus, { timeout: 20_000 }).not.toBeNull();
});