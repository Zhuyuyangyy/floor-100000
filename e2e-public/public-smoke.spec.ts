import { expect, test, type Frame, type Page } from '@playwright/test';

// 「公开部署的新设备冒烟」：完全站在评委视角——
// 匿名浏览器打开公开链接，走真实菜单进游戏，看真实居民、真实同源代理。
//
// 为什么要有这条：参赛清单里「公开部署后的新设备冒烟测试」一直挂着，
// 理由是「实例是 private」。实测公开地址匿名可达，这条就没有理由不做了。
//
// ⚠️ 这条用例必须走**门户页**，不能直接打应用的 .ms.show 地址。
// 实测（2026-11-26）：顶层导航访问 .ms.show 会被网关 302 到门户页，
// 真正被加载的应用跑在门户挂出的 iframe 里（Sec-Fetch-Dest 不同，网关走不同分支）。
// 所以：
//   顶层 .ms.show          → 302 → 门户页（200，但那是门户 SPA，不是游戏）
//   门户页里的 iframe      → .ms.show/?…&__theme=light&backend_url=/ → 游戏本体
// 直接断言顶层有 canvas 一定失败——那不是游戏没起来，是压根没走到游戏。
//
// 与 e2e-live/ 的区别（别混）：
//   e2e-live/  打的是本机起的代理 + 假上游 —— 离线可复现，验的是「链路接得对不对」。
//   e2e-public/ 打的是**线上公开地址** —— 不起任何本地服务、不带任何 token，
//                验的是「评委打开链接真的能看到什么」。
//
// 运行：
//   PUBLIC_BASE=https://www.modelscope.cn/studios/<ns>/<name> \
//     npx playwright test -c playwright.public.config.ts
// 不设 PUBLIC_BASE 时整条跳过：CI 不该因为线上空间临时不可用就红，
// 但也不能因此把「没跑过」写成「跑过且通过」。

const PUBLIC_BASE = process.env.PUBLIC_BASE ?? '';

test.skip(!PUBLIC_BASE, '未设置 PUBLIC_BASE：跳过线上公开地址冒烟');

// 门户页会把 app_path 原样转给 iframe。带 debug=1 才有生产包里的调试钩子。
const APP_PATH = '/?seed=42&debug=1';

interface State {
  currentFloor: number;
  player: { x: number };
}

type WindowProbe = Window & {
  __PHASER_GAME__?: {
    scene: {
      getScenes: (r?: boolean) => Array<{ scene: { key: string } }>;
      getScene: (k: string) => { children: { list: Array<{ type: string; text?: string; visible: boolean; depth?: number }> } } | null;
    };
  };
  __PHASER_SESSION__?: { getState: () => State | null };
  __PHASER_TEST_MUTATE__?: (mutator: (state: unknown) => void) => void;
};

/**
 * 等门户把应用 iframe 挂出来。
 *
 * iframe 是门户 JS 动态创建的：页面 DOM ready 时它还不存在。
 * 轮询找 url 含 .ms.show 的 frame —— 这是「应用真的被加载了」的直接证据，
 * 比等一个固定选择器更稳（门户改版只改 DOM 结构，不改应用域名）。
 */
async function appFrame(page: Page): Promise<Frame> {
  for (let i = 0; i < 90; i += 1) {
    const found = page.frames().find((f) => f.url().includes('.ms.show'));
    if (found) return found;
    await page.waitForTimeout(1000);
  }
  throw new Error('应用 iframe 没有出现：门户页 90s 内没挂出 .ms.show frame');
}

/** 等某个场景真正 active（不是「注册了」，是「跑起来了」）。 */
async function waitForScene(frame: Frame, key: string): Promise<void> {
  await frame.waitForFunction(
    (k) => {
      const g = (window as WindowProbe).__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === k);
    },
    key,
    { timeout: 60_000 },
  );
}

/** 从菜单一路进到 Game 场景。走的是真实按键，跟玩家做的一样。 */
async function startGame(page: Page, frame: Frame, seed: number): Promise<void> {
  await page.goto(`${PUBLIC_BASE}?mode=full&app_path=${encodeURIComponent(`/?seed=${seed}&debug=1`)}`);
  const app = await appFrame(page);
  await waitForScene(app, 'Menu');

  // 键盘事件要送进 iframe：先点一下画布把焦点拿过去。
  await app.locator('canvas').first().click({ position: { x: 10, y: 10 } });

  await page.keyboard.press('Enter');
  await waitForScene(app, 'MetaSelect');
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press('Enter');
    const started = await app
      .waitForFunction(
        () => {
          const g = (window as WindowProbe).__PHASER_GAME__;
          return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
        },
        undefined,
        { timeout: 3000 },
      )
      .then(() => true)
      .catch(() => false);
    if (started) break;
  }
  await waitForScene(app, 'Game');
}

async function readState(frame: Frame): Promise<State> {
  return frame.evaluate(() => {
    const s = (window as WindowProbe).__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    return s;
  });
}

async function setX(frame: Frame, x: number): Promise<void> {
  await frame.evaluate((v) => {
    (window as WindowProbe).__PHASER_TEST_MUTATE__?.((s) => {
      (s as { player: { x: number } }).player.x = v;
    });
  }, x);
}

/** 这一层屏幕上所有可见的居民名标签。 */
async function visibleResidentLabels(frame: Frame): Promise<string[]> {
  const known = ['阿林', '小周', '老陈', '大刘', '阿珍', '小满'];
  const labels = await frame.evaluate(() => {
    const g = (window as WindowProbe).__PHASER_GAME__;
    const list = g?.scene.getScene('Game')?.children.list ?? [];
    return list
      .filter((o) => o.type === 'Text' && o.visible && (o.depth ?? 0) < 100)
      .map((o) => (o.text ?? '').trim());
  });
  return labels.filter((t) => known.includes(t));
}

/** 爬到上一层。E 只能按一次：楼梯是 1000ms 的可见攀爬，重复按会被落地帧覆盖。 */
async function climbUp(page: Page, frame: Frame): Promise<void> {
  const from = (await readState(frame)).currentFloor;
  await setX(frame, 40);
  await frame.waitForFunction(
    (floor) => {
      const w = window as WindowProbe;
      const s = w.__PHASER_SESSION__?.getState();
      const scene = w.__PHASER_GAME__?.scene.getScene('Game');
      return s?.currentFloor === floor && s.player.x === 40 && scene?.player?.x === 40 && !scene.stairClimb;
    },
    from,
    { timeout: 15_000 },
  );

  await page.keyboard.press('E');
  await frame.waitForFunction(
    (floor) => {
      const w = window as WindowProbe;
      const s = w.__PHASER_SESSION__?.getState();
      const scene = w.__PHASER_GAME__?.scene.getScene('Game');
      return s?.currentFloor === floor && !scene?.stairClimb;
    },
    from + 1,
    { timeout: 20_000 },
  );
}

test('公开链接对匿名访客可见，并把应用挂了出来', async ({ page }) => {
  await page.goto(`${PUBLIC_BASE}?mode=full&app_path=${encodeURIComponent(APP_PATH)}`);

  // 门户页本身对匿名访客可读（这是评委打开链接看到的第一屏）。
  await expect(page).toHaveTitle(/第100000层/, { timeout: 60_000 });

  // 应用 iframe 挂出来了，而且里面真的在跑游戏（有 1280x720 画布）。
  const app = await appFrame(page);
  await waitForScene(app, 'Menu');
  const canvasSize = await app.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement | null;
    return c ? { width: c.width, height: c.height } : null;
  });
  expect(canvasSize, '应用 iframe 里没有画布').not.toBeNull();
  expect(canvasSize?.width).toBe(1280);
  expect(canvasSize?.height).toBe(720);
});

test('新设备进游戏：第 2 层站着四个居民', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${PUBLIC_BASE}?mode=full&app_path=${encodeURIComponent(APP_PATH)}`);
  const app = await appFrame(page);
  await waitForScene(app, 'Menu');

  await app.locator('canvas').first().click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('Enter');
  await waitForScene(app, 'MetaSelect');
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press('Enter');
    const started = await app
      .waitForFunction(
        () => {
          const g = (window as WindowProbe).__PHASER_GAME__;
          return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
        },
        undefined,
        { timeout: 3000 },
      )
      .then(() => true)
      .catch(() => false);
    if (started) break;
  }
  await waitForScene(app, 'Game');

  await climbUp(page, app);

  await expect
    .poll(async () => (await visibleResidentLabels(app)).sort().join(','), { timeout: 20_000 })
    .toBe('大刘,小周,老陈,阿林');

  await page.screenshot({ path: 'test-results/public-f2-residents.png' });

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('同源代理的真链路：浏览器里拿到的台词来自模型', async ({ page }) => {
  await page.goto(`${PUBLIC_BASE}?mode=full&app_path=${encodeURIComponent(APP_PATH)}`);
  const app = await appFrame(page);
  await waitForScene(app, 'Menu');

  // 在应用自己的源里发请求，走的是浏览器看到的同源路径（前端 → /api/npc/decide → 上游模型）。
  const result = await app.evaluate(async () => {
    const res = await fetch('/api/npc/decide', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: `public-smoke-${Date.now()}`,
        observation: {
          npcId: 'alin',
          archetype: 'ally',
          traits: { altruism: 0.8, pragmatism: 0.3, aggression: 0.05, loyalty: 0.7, caution: 0.4 },
          memory: [],
          relationship: { player: 40 },
          goal: '守住这层线路',
          mood: 0,
          world: { day: 1, floor: 2, gameMinute: 600, night: false },
          self: { floor: 2, x: 480, hp: 28 },
          availableActions: ['dialogue'],
        },
      }),
    });
    const text = await res.text();
    return { status: res.status, text: text.slice(0, 600) };
  });

  expect(result.status).toBe(200);

  // 代理的响应是两层 JSON：外层 { ok, text: '<模型提案的 JSON 串>', decisionSource }，
  // 里层才是提案本身 { action: { type, text | utterance }, confidence }。
  // 台词字段名不固定（模型可能给 utterance，也可能只给 action.text），两种都认。
  const outer = JSON.parse(result.text) as { ok?: boolean; text?: string; decisionSource?: string };
  // decisionSource=model 才说明这条台词真是模型说的，不是规则脑兜底。
  expect(outer.decisionSource).toBe('model');
  const proposal = JSON.parse(String(outer.text ?? '{}')) as {
    action?: { type?: string; text?: string; utterance?: string };
  };
  expect(proposal.action?.type).toBe('dialogue');
  // 台词不能是空串：模型返回了合法提案，但正文为空也是失败。
  const utterance = proposal.action?.utterance ?? proposal.action?.text ?? '';
  expect(utterance.length).toBeGreaterThan(0);
});
