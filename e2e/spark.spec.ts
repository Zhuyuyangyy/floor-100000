import { expect, test, type Page } from '@playwright/test';
import { NPCS } from '../src/data/npcs';

// AG-41: AI NPC 开场白的 Spark 链路 e2e（mock 版）。
//
// 为什么必须 mock：真连 Spark 时 npc-qwen 一次推理 17–36s（实测数据见
// docs/qa/SPARK_E2E.md），CI 里直连会被超时拖死。本 spec 在页面加载前用
// addInitScript 装一个 fetch 桩，把 Ollama 的两个端点——health（/api/tags）
// 与推理（/v1/chat/completions）——全部在页内接管，断言的是游戏侧行为：
// 静态问候先显示、模型句到达后才替换、过期结果被丢弃，而不是 Spark 本身。
// 真机的冷/热延迟数字在报告里，不进 CI。
//
// 为什么用页内 fetch 桩而不是 page.route：本机实测（AG-41），在这个
// Phaser 游戏页面上，page.route + 主配置的 trace: 'retain-on-failure'
// 会让每个测试的 teardown（tracing.stop/context.close）挂死 120s 直到超时
// ——测试体其实 8 秒就全过了。page.route 走 Playwright 网络层，与 trace 的
// 网络录制相互等待；页内桩完全不碰网络层，trace 开或关都确定性通过。
// 换环境后若该问题修复，可改回 route，但桩版没有外部依赖，更稳。
//
// 环境差异：CI 的 checkout 没有 .env.local，VITE_NPC_MODEL 为空 → AI 整体
// 关闭（护栏 4 的安全默认），两个 AI 测试自动跳过；降级路径测试在任何
// 环境都跑——AI 关闭时的表现就是降级路径。

const ALIN = NPCS.find((n) => n.id === 'alin');
if (!ALIN) throw new Error('npcs.ts 里找不到 alin');
/** 降级脑原句：Spark 不可达时玩家看到的就是改造前这一句。 */
const ALIN_GREETING = ALIN.greetings[0];
/** mock 模型的一句台词：人格化、且与静态问候明显不同，替换后一眼可辨。 */
const MOCK_UTTERANCE = '线路又跳闸了。你带了保险丝？先给我看看货。';

// ── 页面助手（与 e2e/npc.spec.ts 同一套成熟套路：读实时精灵、按 E 交互）──

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => {
      const g = window.__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === k);
    },
    key,
    { timeout: 20_000 },
  );
}

async function startGame(page: Page, seed = 42): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  // The pick screen reports active before create() binds its keys, so an
  // Enter can land in that window and be lost. Retry until the run starts.
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const started = await page.waitForFunction(
      () => {
        const g = window.__PHASER_GAME__;
        return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
      },
      undefined,
      { timeout: 2000 },
    ).then(() => true).catch(() => false);
    if (started) break;
  }
  await waitForScene(page, 'Game');
}

async function setX(page: Page, x: number): Promise<void> {
  await page.evaluate((v) => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.player.x = v;
  }, x);
}

interface DialogueSnapshot {
  message: string;
  sessionId: number;
}

async function dialogueSnapshot(page: Page): Promise<DialogueSnapshot | null> {
  return page.evaluate(() => {
    const g = window.__PHASER_GAME__ as unknown as {
      scene: { getScene: (k: string) => { dialogue?: { message: string; sessionId: number } } | null };
    };
    const d = g?.scene.getScene('Game')?.dialogue;
    return d ? { message: d.message, sessionId: d.sessionId } : null;
  });
}

// AG-66：过道阻碍物的 E 交互优先于 NPC（onInteract 的顺序：阻碍物 → NPC，
// GameScene.ts:8192-8201，有意设计）。seed42 的 2 层瓦砾@222 正嵌在 alin 的
// 巡逻带 [196.5,224.5] 里：贴她身上按 E，开的是瓦砾提示而不是对话。挑一个
// 既够得到 NPC、又不在任何阻碍物交互距离内的站位；她恰好压在瓦砾正上方
// （无解）时等几步——她按日程会走开。同 e2e/npc.spec.ts 的修法。
const INTERACT_DIST = 44;

/** NPC 精灵实时 x + 本层还没挖掉的阻碍物 x（同一帧快照里读，免得坐标漂移）。 */
async function npcAndObstacleXs(page: Page, npcId: string): Promise<{ npcX: number | null; obstacleXs: number[] }> {
  return page.evaluate((id) => {
    const g = window.__PHASER_GAME__ as unknown as {
      scene: {
        getScene: (k: string) => {
          npcObjs?: Map<string, { sprite: { x: number } }>;
          activeObstacleList?: Array<{ x: number }>;
        } | null;
      };
    };
    const sc = g?.scene.getScene('Game');
    const rec = sc?.npcObjs?.get(id);
    return {
      npcX: rec ? rec.sprite.x : null,
      obstacleXs: (sc?.activeObstacleList ?? []).map((o) => o.x),
    };
  }, npcId);
}

/** 由近及远挑站位：|站位-NPC| ≤ 44 且每个阻碍物都 > 44；无解返回 null。 */
function standSpotNear(npcX: number, obstacleXs: readonly number[]): number | null {
  for (const d of [0, -12, 12, -24, 24, -34, 34, -42, 42]) {
    const s = npcX + d;
    if (s < 8) continue;
    if (obstacleXs.every((ox) => Math.abs(ox - s) > INTERACT_DIST)) return s;
  }
  return null;
}

/** 站在走动居民当前的 x 上按 E，直到对话打开（居民按日程巡逻，坐标会漂移）。 */
async function pressEAtNpc(page: Page, npcId: string, tries = 6): Promise<void> {
  await page.waitForTimeout(700);
  for (let i = 0; i < tries; i++) {
    if ((await dialogueSnapshot(page)) !== null) return;
    // AG-66：先挑不被阻碍物抢占的站位（她压着瓦砾时等几步，巡逻会走开）。
    let spot: number | null = null;
    for (let w = 0; w < 8 && spot === null; w++) {
      const { npcX, obstacleXs } = await npcAndObstacleXs(page, npcId);
      if (npcX === null) throw new Error(`resident "${npcId}" is not on this floor`);
      spot = standSpotNear(npcX, obstacleXs);
      if (spot === null) await page.waitForTimeout(250);
    }
    if (spot === null) continue;
    await setX(page, spot);
    await page.waitForTimeout(60);
    await page.keyboard.press('E');
    const deadline = Date.now() + 1200;
    while (Date.now() < deadline) {
      await page.waitForTimeout(80);
      if ((await dialogueSnapshot(page)) !== null) return;
    }
  }
  throw new Error(`interact at resident "${npcId}" did not take effect`);
}

async function currentFloor(page: Page): Promise<number> {
  return page.evaluate(() => window.__PHASER_SESSION__?.getState()?.currentFloor ?? 0);
}

async function goToNeighborFloor(page: Page): Promise<void> {
  await setX(page, 40); // UP_EXIT_X: 1 层 -> 2 层
  for (let i = 0; i < 4; i++) {
    if ((await currentFloor(page)) === 2) return;
    await page.keyboard.press('E');
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      await page.waitForTimeout(80);
      if ((await currentFloor(page)) === 2) return;
    }
  }
  throw new Error('failed to reach floor 2');
}

/** 页内动态 import 配置模块，读 AI 是否启用、用的什么模型（仅 dev server 有）。 */
async function aiConfig(page: Page): Promise<{ enabled: boolean; model: string } | null> {
  return page.evaluate(async () => {
    try {
      // 运行时是浏览器 URL（dev server 的模块路径）；用变量 specifier 让 tsc 不做静态解析。
      const spec = '/src/ai/config.ts';
      const mod = (await import(spec)) as {
        aiNpcConfig: () => { enabled: boolean; model: string };
      };
      const cfg = mod.aiNpcConfig();
      return { enabled: cfg.enabled, model: cfg.model };
    } catch {
      return null;
    }
  });
}

interface SparkMockCall {
  kind: 'health' | 'completions';
  model?: string;
}

/** 读页内 fetch 桩记录到的调用（证明请求真的发了、带的是什么模型）。 */
async function sparkMockCalls(page: Page): Promise<SparkMockCall[]> {
  return page.evaluate(
    () => (window as unknown as { __sparkMockCalls?: SparkMockCall[] }).__sparkMockCalls ?? [],
  );
}

interface SparkMockOptions {
  /** health 直接抛错（与断网同型）→ 按设计根本不进推理，立即降级。 */
  failHealth?: boolean;
  /** 推理延迟 ms：制造「结果比交互慢」的迟到场景。 */
  delayMs?: number;
  /** 模型回复的台词（过 parseProposal + rulesExecutor 的 dialogue 提案）。 */
  utterance?: string;
}

/**
 * 在页面脚本之前装一个 fetch 桩，接管 Ollama 的两个端点。必须在 startGame
 * （page.goto）之前调用——addInitScript 只对之后的导航生效。
 */
async function mockSparkInPage(page: Page, opts: SparkMockOptions): Promise<void> {
  await page.addInitScript((o: SparkMockOptions) => {
    const realFetch = window.fetch.bind(window);
    const calls: SparkMockCall[] = [];
    (window as unknown as { __sparkMockCalls?: SparkMockCall[] }).__sparkMockCalls = calls;
    const json = (body: unknown): Response =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/tags')) {
        calls.push({ kind: 'health' });
        // 与浏览器断网同型：抛 TypeError，OllamaBrain.health() 的 catch 吞掉 → false
        if (o.failHealth) throw new TypeError('Failed to fetch');
        return json({ models: [] });
      }
      if (url.includes('/v1/chat/completions')) {
        let model: string | undefined;
        try {
          model = (JSON.parse(String(init?.body ?? '{}')) as { model?: string }).model;
        } catch {
          // 坏载荷不该炸掉桩——照常回复，让游戏侧自己降级
        }
        calls.push({ kind: 'completions', model });
        if (o.delayMs && o.delayMs > 0) await new Promise((r) => setTimeout(r, o.delayMs));
        const utterance = o.utterance ?? '';
        // OpenAI 兼容信封；content 是模型输出的契约 JSON
        return json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  utterance,
                  action: { type: 'dialogue', text: utterance },
                  confidence: 0.9,
                }),
              },
            },
          ],
        });
      }
      return realFetch(input, init);
    };
  }, opts);
}

/** 等对话消息变成指定文本（模型句替换降级句的接线断言）。 */
async function waitForDialogueMessage(page: Page, message: string): Promise<void> {
  await page.waitForFunction(
    (expected) => {
      const g = window.__PHASER_GAME__ as unknown as {
        scene: { getScene: (k: string) => { dialogue?: { message: string } } | null };
      };
      return g?.scene.getScene('Game')?.dialogue?.message === expected;
    },
    message,
    { timeout: 15_000 },
  );
}

// ── 降级路径：任何环境都跑（AI 关闭时的表现即降级路径）──────────────────

test('降级路径：模型不可达时显示静态问候，交互不卡', async ({ page }) => {
  // 冷启的 Vite 依赖优化 + 游戏启动 + 爬楼就要 30-40s，与 diary/npc-atoms 等同级
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockSparkInPage(page, { failHealth: true });

  await startGame(page);
  await goToNeighborFloor(page);
  await pressEAtNpc(page, 'alin');

  expect((await dialogueSnapshot(page))?.message).toBe(ALIN_GREETING);
  await page.waitForTimeout(3000); // 降级句不会姗姗来迟地被"替换"
  expect((await dialogueSnapshot(page))?.message).toBe(ALIN_GREETING);

  await page.keyboard.press('E');
  await page.waitForTimeout(300);
  expect(await dialogueSnapshot(page)).toBeNull(); // 交互没被卡死
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── AI 路径：只在配了模型的开发机跑（CI 无 .env.local，自动跳过）────────

test('AI 路径：模型回复到达后替换静态问候', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockSparkInPage(page, { utterance: MOCK_UTTERANCE });

  await startGame(page);
  const cfg = await aiConfig(page);
  test.skip(!cfg?.enabled, 'AI NPC 未配置（VITE_NPC_MODEL 为空，如 CI checkout）');

  await goToNeighborFloor(page);
  await pressEAtNpc(page, 'alin');
  // 「静态句先显示」由降级路径测试与真机报告覆盖；这里断言的是替换接线本身：
  // 模型句到达后，对话消息被换成模型说的话。
  await waitForDialogueMessage(page, MOCK_UTTERANCE);
  const calls = await sparkMockCalls(page);
  expect(calls.map((c) => c.kind)).toContain('completions'); // 请求真的发了
  expect(calls.find((c) => c.kind === 'completions')?.model).toBe(cfg?.model ?? ''); // 带的是配置里的模型名
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('会话保鲜：过期的 AI 结果不污染下一场对话', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // 回复比交互慢：先开一场、立刻关掉，让第一份结果"迟到"
  await mockSparkInPage(page, { delayMs: 1500, utterance: MOCK_UTTERANCE });

  await startGame(page);
  const cfg = await aiConfig(page);
  test.skip(!cfg?.enabled, 'AI NPC 未配置（VITE_NPC_MODEL 为空，如 CI checkout）');

  await goToNeighborFloor(page);
  await pressEAtNpc(page, 'alin');
  expect((await dialogueSnapshot(page))?.message).toBe(ALIN_GREETING);
  await page.keyboard.press('E'); // 1500ms 的回复还没到就关掉
  await page.waitForTimeout(1900); // 第一份结果此刻才到达——必须被丢弃
  expect(await dialogueSnapshot(page)).toBeNull();

  // 重开一场：先看到静态句，再被新的模型句替换（freshness 键对上新会话）
  await pressEAtNpc(page, 'alin');
  expect((await dialogueSnapshot(page))?.message).toBe(ALIN_GREETING);
  await waitForDialogueMessage(page, MOCK_UTTERANCE);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
