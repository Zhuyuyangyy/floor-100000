import { expect, test, type Page } from '@playwright/test';

// TWOM 对齐 §2/§3：环境参数扩展与楼层模板微调（AG-25 属主 constants 的
// FloorEnvironment.warmth；AG-30 属主 floorTemplates 的逐层 environment
// 微调数据。契约 docs/plans/TWOM_ALIGNMENT.md 第二、三节；需求来源
// docs/reference/TWOM_MECHANICS.md §3「把 5 层楼的差异从换色调升级到环境
// 参数：温度/湿度/危险/可取暖」）。
//
// **本 spec 整体处于 test.skip() 待启用状态。取消条件：AG-25（environmentFor
// 的 warmth 字段与解析顺序）与 AG-30（floorTemplates 的 environment 微调
// 数据）都合入 `integrate/sprint-01` 后，删除每个 test 里的 `test.skip(...)`
// 行并实跑；若实跑发现机制没按契约实现，定性为产品缺陷写进报告，不许为了绿
// 改这里的期望值。**
//
// 契约定死的形状：
//   §2 FloorEnvironment 新增 `warmth?: number`（0..1，这一层自身热源能补回
//     的体温比例：床/蜡烛/火把/火盆）。
//   §2 environmentFor(floor) 解析顺序：
//      1. FLOOR_ENVIRONMENT[floor]（逐层覆盖）
//      2. SEGMENT_ENVIRONMENT[segmentOf(floor).from]
//      3. 阶梯向下回落
//      并且第 1 步要先与 FLOOR_TEMPLATES[floor]?.environment 合并
//      （template 的字段优先）。
//   §3 floorTemplates.ts 每个模板可带 `environment?: Partial<Floor-
//      Environment>`（只写想覆盖的字段；未写的走 constants 的阶梯），
//      AG-30 填 14 层微调数据。
//
// 注意：本分支的 environmentFor 已经存在（B3 时代，精确层 → 段 → 阶梯），
// 但**没有** warmth 字段、也没有 template 合并那一步——本 spec 测的正是
// 契约新增的这两块，不与存量阶梯语义混。

// ── 公共助手 ────────────────────────────────────────────────────────────────

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

async function startGame(page: Page, seed: number): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
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

/** 契约 §2 的 warmth 字段（当前分支尚不存在，故内联声明）。 */
interface FloorEnvironmentLike {
  temperature: number;
  wet: boolean;
  hostile: boolean;
  warmth?: number;
}

// ── 1. warmth 字段与 0..1 语义 ──────────────────────────────────────────────

test('warmth: heat-source floors declare a 0..1 recovery share, others stay undefined', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  test.skip(true, 'AG-25/AG-30 未合入：契约 §2 的 warmth 字段与逐层数据尚不存在。取消条件 = 两者合入 integrate/sprint-01 后删除本行并实跑。');

  await startGame(page, 42);

  const env = await page.evaluate(async () => {
    const path = '/src/core/constants.ts';
    const m = (await import(path)) as {
      environmentFor: (floor: number) => FloorEnvironmentLike;
      PLAYABLE_FLOORS_V01: number[];
    };
    const rows: Array<{ floor: number; warmth: number | undefined }> = [];
    for (const floor of m.PLAYABLE_FLOORS_V01) rows.push({ floor, warmth: m.environmentFor(floor).warmth });
    return rows;
  });

  for (const row of env) {
    if (row.warmth === undefined) continue; // 无热源层不写这个字段（Partial 语义）
    expect(row.warmth, `floor ${row.floor}: warmth must be 0..1`).toBeGreaterThanOrEqual(0);
    expect(row.warmth, `floor ${row.floor}: warmth must be 0..1`).toBeLessThanOrEqual(1);
  }
  // 契约 §3 的需求表：1F 床 / 2F 蜡烛 / 5F 火盆是可取暖层——至少这几层
  // 的解析结果带 warmth。（AG-30 的 14 层微调数据合入后以此为准。）
  const warmFloors = env.filter((r) => r.warmth !== undefined).map((r) => r.floor);
  expect(warmFloors.length, 'at least the dorm must declare a warmth source').toBeGreaterThan(0);
  expect(warmFloors, 'the dorm (bed) must be warmable').toContain(1);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── 2. 解析顺序：template 优先，未写走阶梯 ──────────────────────────────────

test('environmentFor merges the floor template first (template fields win), then falls back to the ladder', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  test.skip(true, 'AG-25/AG-30 未合入：契约 §2 的 template 合并步与 §3 的微调数据尚不存在。取消条件 = 两者合入 integrate/sprint-01 后删除本行并实跑。');

  await startGame(page, 42);

  const resolution = await page.evaluate(async () => {
    const constPath = '/src/core/constants.ts';
    const m = (await import(constPath)) as {
      environmentFor: (floor: number) => FloorEnvironmentLike;
      FLOOR_ENVIRONMENT: Record<string, FloorEnvironmentLike>;
    };
    const tplPath = '/src/data/floorTemplates.ts';
    const tpl = (await import(tplPath)) as {
      FLOOR_TEMPLATES: Record<string, { environment?: Partial<FloorEnvironmentLike> }>;
    };
    const out: Array<{
      floor: number;
      hasTemplate: boolean;
      templateWarmth: number | undefined;
      resolved: FloorEnvironmentLike;
      ladder: FloorEnvironmentLike | undefined;
    }> = [];
    const floors = Object.keys(m.FLOOR_ENVIRONMENT).map(Number).sort((a, b) => a - b);
    for (const floor of floors) {
      const template = tpl.FLOOR_TEMPLATES[String(floor)];
      // 阶梯回落：不大于本层的最大已登记层（contract 的第三步）。
      const ladderKey = floors.filter((k) => k <= floor).pop();
      out.push({
        floor,
        hasTemplate: !!template?.environment,
        templateWarmth: template?.environment?.warmth,
        resolved: m.environmentFor(floor),
        ladder: ladderKey !== undefined ? m.FLOOR_ENVIRONMENT[ladderKey] : undefined,
      });
    }
    return out;
  });

  for (const row of resolution) {
    if (row.hasTemplate && row.templateWarmth !== undefined) {
      // 契约：template 的字段优先于 constants 的同层覆盖。
      expect(row.resolved.warmth, `floor ${row.floor}: template warmth must win`).toBe(row.templateWarmth);
    } else if (row.ladder) {
      // 未写 warmth 的层走阶梯/存量值——不凭空造数。
      expect(row.resolved.temperature).toBe(row.ladder.temperature);
      if (row.resolved.warmth !== undefined) {
        expect(row.resolved.warmth).toBe(row.ladder.warmth);
      }
    }
  }

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── 3. 楼层环境真的进了游戏表现（HUD/场景可读）──────────────────────────────

test('the per-floor environment reaches the running game, not just the data table', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  test.skip(true, 'AG-25/AG-30 未合入。取消条件 = 两者合入 integrate/sprint-01 后删除本行并实跑（HUD 环境标签的实际文案以合入后的实现为准校正）。');

  await startGame(page, 42);

  // 爬一层读一层：环境标签（environmentLabel，存量导出）应随楼层变化，
  // 且与 environmentFor(currentFloor) 的解析结果同源。
  const labels: Array<{ floor: number; label: string }> = [];
  for (const target of [1, 2, 3]) {
    if ((await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.currentFloor)) !== target) {
      await page.evaluate(() => {
        const s = window.__PHASER_SESSION__?.getState();
        if (s) s.player.x = 40; // UP_EXIT_X
      });
      await page.keyboard.press('E');
      await page.waitForFunction(
        (floor) => window.__PHASER_SESSION__?.getState()?.currentFloor === floor,
        target,
        { timeout: 8000 },
      );
      await page.waitForTimeout(300);
    }
    const label = await page.evaluate(async (floor) => {
      const path = '/src/core/constants.ts';
      const m = (await import(path)) as { environmentFor: (f: number) => FloorEnvironmentLike };
      const s = window.__PHASER_SESSION__?.getState();
      if (!s) throw new Error('no session');
      return JSON.stringify(m.environmentFor(floor ?? s.currentFloor));
    }, target);
    labels.push({ floor: target, label });
  }

  // 三层的数据必须至少有一处不同（环境参数让楼层有差异，不是五个色调）。
  const unique = new Set(labels.map((l) => l.label));
  expect(unique.size, 'floors 1..3 must differ in their environment').toBeGreaterThan(1);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
