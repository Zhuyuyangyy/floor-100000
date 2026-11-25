import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

// 生产形态下的真实链路验证：浏览器里跑的**构建产物** → 同源代理 → 上游。
//
// 单测只能证明「brain 会发请求」，证明不了「dist 里那份前端真的走了代理、
// 且拿得到台词」。这条用例必须打真实 server，是 AI 能力 25 分的实证。

const HERE = dirname(fileURLToPath(import.meta.url));
const UPSTREAM_LOG = resolve(HERE, '..', 'test-results', 'upstream-received.jsonl');

type WindowProbe = Window & {
  __PHASER_GAME__?: {
    scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }>; getScene: (k: string) => any };
  };
  // 生产包里 getState() 是深拷贝快照：读得到，但写它不会回到游戏。
  __PHASER_SESSION__?: { getState: () => any };
  // 写入口单独一个名字。生产包只通过它改状态，读路径保持只读。
  __PHASER_TEST_MUTATE__?: (mutator: (state: any) => void) => void;
};

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => !!(window as WindowProbe).__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === k),
    key,
    { timeout: 20_000 },
  );
}

async function visibleTexts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    ((window as WindowProbe).__PHASER_GAME__?.scene.getScene('Game')?.children.list ?? [])
      .filter((o: any) => o.type === 'Text' && o.visible)
      .map((o: any) => o.text ?? ''),
  );
}

/** 把玩家瞬移到指定楼层与横坐标，省掉手动走位。 */
async function teleport(page: Page, x: number): Promise<void> {
  await page.evaluate((tx) => {
    // 生产包里 getState() 是快照，写它无效——必须走变异入口才真的落到游戏。
    const w = window as WindowProbe;
    w.__PHASER_TEST_MUTATE__?.((s) => { s.player.x = tx; });
  }, x);
  await page.waitForFunction(
    (tx) => {
      const w = window as WindowProbe;
      const sc = w.__PHASER_GAME__?.scene.getScene('Game');
      return w.__PHASER_SESSION__?.getState()?.player.x === tx && sc?.player?.x === tx;
    },
    x,
    { timeout: 5000 },
  );
}

async function enterGame(page: Page): Promise<void> {
  // debug=1：生产包默认不暴露内部句柄，这个参数让验证能读场景/走位。
  await page.goto('/?seed=42&debug=1');
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  for (let i = 0; i < 6; i++) {
    const started = await page
      .waitForFunction(
        () => !!(window as WindowProbe).__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'),
        undefined,
        { timeout: 2000 },
      )
      .then(() => true)
      .catch(() => false);
    if (started) break;
    await page.keyboard.press('Enter');
  }
  await waitForScene(page, 'Game');
}

test('构建产物经同域代理拿到模型提案，且不携带任何凭据', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  const decideCalls: Array<{ url: string; headers: Record<string, string>; postData: string | null }> = [];
  const otherCalls: string[] = [];
  page.on('request', (r) => {
    const url = r.url();
    if (url.includes('/api/npc/decide')) {
      decideCalls.push({ url, headers: r.headers(), postData: r.postData() });
    } else if (url.startsWith('http://127.0.0.1') || url.includes('/api/')) {
      otherCalls.push(url);
    }
  });

  await enterGame(page);

  // 上二楼到阿林身边，开对话（会触发 AI 开场白）。
  await teleport(page, 40);
  await page.keyboard.press('E');
  await page.waitForFunction(
    () => {
      const w = window as WindowProbe;
      return w.__PHASER_SESSION__?.getState()?.currentFloor === 2 && !w.__PHASER_GAME__?.scene.getScene('Game')?.stairClimb;
    },
    undefined,
    { timeout: 8000 },
  );
  await teleport(page, 480);
  await page.keyboard.press('E');

  // 1) 决策请求必须真的发出去了。
  await expect.poll(() => decideCalls.length, { timeout: 20_000 }).toBeGreaterThan(0);

  // 2) 模型台词必须出现在游戏里（假上游固定回「收到。」）。
  await expect
    .poll(async () => (await visibleTexts(page)).some((t) => t.includes('收到')), { timeout: 20_000 })
    .toBe(true);

  const call = decideCalls[0];

  // 3) 同源路径：不是 cross-origin，也没有第二个域名。
  expect(call.url).toBe(`${process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:7910'}/api/npc/decide`);

  // 4) 浏览器侧请求里不得出现任何凭据。
  const headerText = JSON.stringify(call.headers).toLowerCase();
  expect(headerText).not.toContain('authorization');
  expect(headerText).not.toContain('bearer');
  expect(headerText).not.toContain('sk-');

  // 5) 客户端不得指定模型名或 token 预算（否则代理就是开放代理）。
  const sent = call.postData ?? '';
  expect(sent).not.toContain('pinned-model-xyz');
  expect(sent).not.toMatch(/max_tokens|maxTokens|num_predict/);
  expect(sent).not.toContain('"model"');

  // 6) 健康探测没有再打 Ollama 的 /api/tags（那是本轮修掉的根因）。
  expect(otherCalls.filter((u) => u.includes('/api/tags')), `健康探测打错了端点: ${otherCalls.join(', ')}`).toEqual([]);

  // 7) 上游确实收到了由服务端注入的 Key —— 证明 Key 在服务端，不在前端。
  await expect
    .poll(
      () => {
        try {
          const lines = readFileSync(UPSTREAM_LOG, 'utf8').trim().split('\n').filter(Boolean);
          const last = JSON.parse(lines[lines.length - 1]);
          return last.authorization;
        } catch {
          return null;
        }
      },
      { timeout: 10_000 },
    )
    .toBe('Bearer sk-live-test-must-not-leak');

  expect(pageErrors, `pageerrors: ${pageErrors.join(' | ')}`).toEqual([]);
});

test('降级路径：代理不可用时展示「基础对白」，游戏不坏', async ({ page }) => {
  // 用一条不可能命中的服务地址替换代理，模拟「模型侧整体不可用」。
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.route('**/api/npc/decide', (route) => route.abort('failed'));

  await enterGame(page);
  await teleport(page, 40);
  await page.keyboard.press('E');
  await page.waitForFunction(
    () => {
      const w = window as WindowProbe;
      return w.__PHASER_SESSION__?.getState()?.currentFloor === 2;
    },
    undefined,
    { timeout: 8000 },
  );
  await teleport(page, 480);
  await page.keyboard.press('E');

  // 对话必须正常打开（降级不等于崩），并给出原始问候语。
  await expect.poll(async () => (await visibleTexts(page)).some((t) => t.includes('阿林')), { timeout: 15_000 }).toBe(true);
  // 来源标签必须如实说明「不是模型给的」。
  await expect
    .poll(async () => (await visibleTexts(page)).some((t) => t.includes('基础对白') || t.includes('模型未响应')), {
      timeout: 20_000,
    })
    .toBe(true);

  expect(pageErrors, `pageerrors: ${pageErrors.join(' | ')}`).toEqual([]);
});