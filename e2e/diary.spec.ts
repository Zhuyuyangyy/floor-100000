import { expect, test, type Page } from '@playwright/test';

// TWOM 对齐 §5：结构化日记（AG-27 落地，契约 docs/plans/TWOM_ALIGNMENT.md
// 第五阶；需求来源 docs/reference/TWOM_MECHANICS.md §1「日记分类法」——42 种
// KosovoDiaryEntry* 里抄来的 11 种，三条规律：个体/群体双轨、「没有效果」
// 也是一条记录、迟归单独成条）。
//
// 测什么：
//   1. 11 类 kind 全链路（写→读→倒序）+ 个体/群体双轨的 actorId 语义；
//   2. minute 整数防线（AG-06 小数分钟 bug 的写入口 floor + 夹回 0..1439）；
//   3. 两处「没有效果」语义（dwellerSickNoEffect / 饥饿预警档）；
//   4. checkSurvivalDiary 的个体→群体连续天数链（真实 GameState 上跑）；
//   5. 存档往返——真产品路径：写条目 → 自动存档进 localStorage → 刷新页面
//      → 菜单「继续游戏」→ diaryOf 原样读回；
//   6. 新旧两套日记并存——旧 DiaryEvent 仍被宿舍面板真实渲染（「上次：…」），
//      新日记看不见旧的，旧的也看不见新的；
//   7. 日记可按 flag 查询，且旗不被 64 条裁剪影响。
//
// 方法说明（重要）：派工单提到的 dev 句柄 `__PHASER_DIARY__` 在本分支**并不
// 存在**（src/main.ts 只挂了 __PHASER_GAME__ / __PHASER_SESSION__，AG-27 的
// 实现说明也没有它）。本 spec  therefore 在页面里 import 产品自己的
// DiarySystem 模块（Vite dev server 的模块图与应用同源——GameScene 已经
// import 它，拿到的是同一个实例），对真实运行中的 GameState 调用。缺句柄
// 这件事作为已知缺口写进报告，不影响本 spec 测的是产品代码本身。
//
// 另一处已知缺口：DiarySystem 的写入入口（checkSurvivalDiary 等）目前没有
// 场景调用方（AG-27 实现说明留了建议调用点给接线方），所以"什么触发日记"
// 由 spec 在页面上调产品函数完成——测的是函数对真实状态的行为。

// ── 页面内 import 产品模块 ──────────────────────────────────────────────────

interface DiaryEntryLike {
  kind: string;
  day: number;
  minute: number;
  text: string;
  actorId: string | null;
}

const ALL_KINDS = [
  'dwellerHungry', 'groupHungry',
  'dwellerMorale',
  'dwellerWounded',
  'dwellerSick', 'dwellerSickNoEffect',
  'lateFromScavenge',
  'shelterAttacked',
  'visitor', 'requestFulfilled',
] as const;

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

async function hasVisibleText(page: Page, substr: string): Promise<boolean> {
  return page.evaluate((sub) => {
    const scenes = window.__PHASER_GAME__?.scene.scenes ?? [];
    for (const sc of scenes) {
      for (const o of sc.children.list ?? []) {
        if (o.type === 'Text' && (o.text ?? '').includes(sub) && o.visible) return true;
      }
    }
    return false;
  }, substr);
}

const setX = (page: Page, x: number): Promise<void> =>
  page.evaluate((v) => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.player.x = v;
  }, x);

/** 页面上对真实 state 记录一条日记（走产品写入口）。 */
async function recordEntry(
  page: Page,
  entry: { kind: string; day: number; minute: number; text: string; actorId: string | null },
): Promise<DiaryEntryLike> {
  return page.evaluate(async (e) => {
    const mod = '/src/systems/DiarySystem.ts';
    const m = (await import(mod)) as {
      recordDiary: (s: unknown, entry: unknown) => DiaryEntryLike;
    };
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    return m.recordDiary(s, e);
  }, entry);
}

/** 页面上读日记（产品读入口，day 倒序）。 */
async function readDiary(page: Page): Promise<DiaryEntryLike[]> {
  return page.evaluate(async () => {
    const mod = '/src/systems/DiarySystem.ts';
    const m = (await import(mod)) as {
      diaryOf: (s: unknown) => DiaryEntryLike[];
    };
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    return m.diaryOf(s);
  });
}

// ── 1. 11 类全链路 + 个体/群体双轨 ──────────────────────────────────────────

test('all 11 diary kinds round-trip, newest day first, with the individual/group actorId contract', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  const stored = await page.evaluate(async () => {
    const mod = '/src/systems/DiarySystem.ts';
    const m = (await import(mod)) as {
      recordDiary: (s: unknown, e: unknown) => DiaryEntryLike;
      diaryOf: (s: unknown) => DiaryEntryLike[];
      DIARY_KIND_LABELS: Record<string, string>;
    };
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    const kinds = [
      'dwellerHungry', 'groupHungry',
      'dwellerMorale',
      'dwellerWounded',
      'dwellerSick', 'dwellerSickNoEffect',
      'lateFromScavenge',
      'shelterAttacked',
      'visitor', 'requestFulfilled',
    ];
    const out: DiaryEntryLike[] = [];
    for (const kind of kinds) {
      out.push(m.recordDiary(s, { kind, day: 2, minute: 725, text: `条目-${kind}`, actorId: 'player' }));
    }
    return {
      count: m.diaryOf(s).length,
      order: m.diaryOf(s).map((e) => e.kind),
      labels: Object.keys(m.DIARY_KIND_LABELS).sort(),
    };
  });

  expect(stored.count).toBe(ALL_KINDS.length);
  // 倒序返回：最后写的在最前（「先饿昏、后被袭」里后一件更值得先看到）
  expect(stored.order).toEqual([...ALL_KINDS].reverse());
  // UI 映射覆盖全部 11 种，漏一种日记页就渲染不出标签
  expect(stored.labels).toEqual([...ALL_KINDS].sort());

  // 个体/群体双轨：个体条目带 actorId，群体条目为 null。
  const individual = await recordEntry(page, { kind: 'dwellerHungry', day: 3, minute: 60, text: '你饿倒了', actorId: 'player' });
  expect(individual.actorId).toBe('player');
  const group = await recordEntry(page, { kind: 'groupHungry', day: 3, minute: 61, text: '连续第 2 天', actorId: null });
  expect(group.actorId).toBeNull();
  const visitor = await recordEntry(page, { kind: 'visitor', day: 3, minute: 62, text: '小周来坐了坐', actorId: 'xiaozhou' });
  expect(visitor.actorId).toBe('xiaozhou');
  const fulfilled = await recordEntry(page, { kind: 'requestFulfilled', day: 3, minute: 63, text: '委托办结', actorId: null });
  expect(fulfilled.actorId).toBeNull();

  // 同一天里后写的先读回来
  const day3 = (await readDiary(page)).filter((e) => e.day === 3);
  expect(day3.map((e) => e.kind)).toEqual(['requestFulfilled', 'visitor', 'groupHungry', 'dwellerHungry']);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── 2. minute 整数防线 ──────────────────────────────────────────────────────

test('minute is floored at the write gate — a fractional clock never reaches the diary or the save', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  const result = await page.evaluate(async () => {
    const mod = '/src/systems/DiarySystem.ts';
    const m = (await import(mod)) as {
      recordDiary: (s: unknown, e: unknown) => DiaryEntryLike;
      recordWoundedDiary: (s: unknown, source?: string) => DiaryEntryLike;
      diaryOf: (s: unknown) => DiaryEntryLike[];
    };
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');

    // AG-06 的小数分钟 bug：gameMinuteOfDay 是帧推进的小数。helper 入口直接
    // 读它，写入口负责 floor。
    s.gameMinuteOfDay = 480.34;
    const viaHelper = m.recordWoundedDiary(s, '巡游体');

    // 调用方直接传小数/越界值，写入口同样兜底。
    const tooBig = m.recordDiary(s, { kind: 'dwellerHungry', day: 2, minute: 1500.9, text: 'x', actorId: 'player' });
    const negative = m.recordDiary(s, { kind: 'dwellerHungry', day: 2, minute: -3.2, text: 'x', actorId: 'player' });

    return {
      viaHelper,
      tooBig,
      negative,
      allInteger: m.diaryOf(s).every((e) => Number.isInteger(e.minute)),
      raw: (s as { gameMinuteOfDay: number }).gameMinuteOfDay,
    };
  });

  expect(result.viaHelper.minute).toBe(480);
  expect(result.tooBig.minute).toBe(1439); // 夹回一天内
  expect(result.negative.minute).toBe(0);
  expect(result.allInteger, 'no fractional minute may ever be stored').toBe(true);
  // 真实时钟没被 normalize 动过（写入口只规范条目，不改游戏状态）
  expect(result.raw).toBe(480.34);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── 3. 两处「没有效果」语义 ─────────────────────────────────────────────────

test('"no effect" is still a record: a sick day with no change, and a hunger warning that is not hunger', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  const sick = await page.evaluate(async () => {
    const mod = '/src/systems/DiarySystem.ts';
    const m = (await import(mod)) as {
      recordSicknessDiary: (s: unknown, t: unknown) => DiaryEntryLike[];
      diaryOf: (s: unknown) => DiaryEntryLike[];
      diaryKindCount: (s: unknown, k: string) => number;
    };
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    const quiet = { worsened: [], recovered: [], critical: [] };
    (s.player as { ailments?: unknown }).ailments = [{ id: 'wound', severity: 30, sinceMinute: 0 }];

    const first = m.recordSicknessDiary(s, quiet);
    const sameDayAgain = m.recordSicknessDiary(s, quiet); // 同一天不刷屏
    (s as { day: number }).day += 1;
    const nextDay = m.recordSicknessDiary(s, quiet); // 每天一条

    // 有转化（恶化）时写 dwellerSick，不写「无恙」
    const worsened = m.recordSicknessDiary(s, { ...quiet, worsened: ['wound'] });

    // 病好了就不再写
    (s.player as { ailments?: unknown }).ailments = [];
    const healthy = m.recordSicknessDiary(s, quiet);

    return { first, sameDayAgain, nextDay, worsened, healthy, noEffectCount: m.diaryKindCount(s, 'dwellerSickNoEffect') };
  });

  expect(sick.first.map((e) => e.kind)).toEqual(['dwellerSickNoEffect']);
  expect(sick.first[0].text).toContain('这次没事'); // 「系统看在眼里，只是这次没事」
  expect(sick.first[0].actorId).toBe('player');
  expect(sick.sameDayAgain).toEqual([]);
  expect(sick.nextDay).toHaveLength(1);
  expect(sick.worsened.map((e) => e.kind)).toEqual(['dwellerSick']);
  expect(sick.healthy).toEqual([]);
  expect(sick.noEffectCount).toBe(2);

  // 语义二：饿了但没归零——预警档的 dwellerHungry 文案变体（TWOM 没有对称的
  // NoEffect kind，「这次没事」由文案承载，契约定死 dwellerHungry 最诚实）。
  const hunger = await page.evaluate(async () => {
    const mod = '/src/systems/DiarySystem.ts';
    const m = (await import(mod)) as {
      checkSurvivalDiary: (s: unknown) => DiaryEntryLike[];
    };
    const invPath = '/src/systems/InventorySystem.ts';
    const inv = (await import(invPath)) as { STAT_MAX: Record<string, number> };
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    s.day = 5;
    s.player.hunger = inv.STAT_MAX.hunger * 0.2; // ≤25% 但没归零
    return m.checkSurvivalDiary(s);
  });

  expect(hunger).toHaveLength(1);
  expect(hunger[0].kind).toBe('dwellerHungry');
  expect(hunger[0].text).toContain('这次没事');
  expect(hunger[0].actorId).toBe('player');

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── 4. 个体→群体连续链 ──────────────────────────────────────────────────────

test('hunger zero writes an individual entry, then a group entry on the consecutive day', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  const chain = await page.evaluate(async () => {
    const mod = '/src/systems/DiarySystem.ts';
    const m = (await import(mod)) as {
      checkSurvivalDiary: (s: unknown) => DiaryEntryLike[];
      diaryOf: (s: unknown) => DiaryEntryLike[];
    };
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    s.day = 2;
    s.player.hunger = 0;
    const first = m.checkSurvivalDiary(s);
    const sameDay = m.checkSurvivalDiary(s); // 不刷屏
    s.day = 3;
    s.player.hunger = 0;
    const second = m.checkSurvivalDiary(s);
    s.day = 4;
    s.player.hunger = 0;
    const third = m.checkSurvivalDiary(s);
    // 中途恢复过：链条断开，回到个体态
    s.day = 5;
    s.player.hunger = 50;
    m.checkSurvivalDiary(s);
    s.day = 6;
    s.player.hunger = 0;
    const afterBreak = m.checkSurvivalDiary(s);
    return { first, sameDay, second, third, afterBreak };
  });

  expect(chain.first.map((e) => e.kind)).toEqual(['dwellerHungry']);
  expect(chain.first[0].actorId).toBe('player'); // 一个人饿是私事
  expect(chain.sameDay).toEqual([]);
  expect(chain.second.map((e) => e.kind)).toEqual(['groupHungry']);
  expect(chain.second[0].actorId).toBeNull(); // 一群人饿是事件
  expect(chain.second[0].text).toContain('连续第 2 天');
  expect(chain.third[0].text).toContain('连续第 3 天');
  expect(chain.afterBreak.map((e) => e.kind)).toEqual(['dwellerHungry']);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── 5. 存档往返（真产品路径）────────────────────────────────────────────────

test('diary entries survive the real save path: autosave → reload → 继续游戏 → read back', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  // 写三条：群体态、个体态、事务态各一，覆盖 actorId 双轨。
  await recordEntry(page, { kind: 'shelterAttacked', day: 1, minute: 60, text: '夜里宿舍被攻破，你挂了彩（HP -12）。', actorId: null });
  await recordEntry(page, { kind: 'visitor', day: 1, minute: 61, text: '小周来坐了坐，说了些近况。', actorId: 'xiaozhou' });
  await recordEntry(page, { kind: 'groupHungry', day: 1, minute: 62, text: '连续第 2 天没进食——宿舍里的人都垮了，这不再是某个人的私事。', actorId: null });

  const before = await readDiary(page);
  expect(before).toHaveLength(3);

  // 真自动存档：时钟每 5 游戏分钟落一次 localStorage（全量 JSON.stringify，
  // diaryEntries 是运行期字段，随之进存档；validateGameState 不拒绝未知字段，
  // 不升 schemaVersion——AG-27 实现说明记的那处妥协）。
  await page.waitForFunction(
    () => {
      const raw = localStorage.getItem('floor100000.save.v1');
      if (!raw) return false;
      try {
        const parsed = JSON.parse(raw) as { diaryEntries?: unknown[] };
        return Array.isArray(parsed.diaryEntries) && parsed.diaryEntries.length >= 3;
      } catch {
        return false;
      }
    },
    undefined,
    { timeout: 20_000 },
  );

  // 存档里的 minute 也必须是整数（小数分钟进了存档，任何整数假设的读者失配）
  const savedMinutes = await page.evaluate(() => {
    const raw = localStorage.getItem('floor100000.save.v1');
    const parsed = JSON.parse(raw ?? '{}') as { diaryEntries?: Array<{ minute: number }> };
    return (parsed.diaryEntries ?? []).map((e) => e.minute);
  });
  expect(savedMinutes).toEqual([60, 61, 62]);
  for (const m of savedMinutes) expect(Number.isInteger(m)).toBe(true);

  // 刷新页面，走菜单「继续游戏」——tryContinue → deserialize → GameScene。
  await page.reload();
  await waitForScene(page, 'Menu');
  await expect.poll(async () => hasVisibleText(page, '继续游戏'), { timeout: 10_000 }).toBe(true);
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('ArrowDown');
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

  const after = await readDiary(page);
  expect(after).toEqual(before);
  // 读回来的 run 是活的：同一天、同一状态，不是重开。
  const live = await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    return { day: s?.day, status: s?.status, minute: s?.gameMinuteOfDay };
  });
  expect(live.day).toBe(1);
  expect(live.status).toBe('playing');

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── 6. 新旧两套并存 ─────────────────────────────────────────────────────────

test('the new diary does not replace the old one: the shelter panel still renders the legacy entry', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  // 旧格式一条（flash 时代的那种），新产品路径渲染它。
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    const mod = '/src/systems/DiarySystem.ts';
    void import(mod).then((diaryModule) => {
      const m = diaryModule as {
        appendDiaryEvent: (s: unknown, e: unknown) => void;
        makeDiaryEvent: (s: unknown, input: unknown) => unknown;
      };
      m.appendDiaryEvent(s, m.makeDiaryEvent(s, {
        floor: 1,
        kind: 'shelter_rested',
        actorIds: ['player'],
        itemChanges: [],
        stressDelta: -6,
        message: '旧格式的一条。',
      }));
    });
  });
  await page.waitForFunction(
    () => {
      const s = window.__PHASER_SESSION__?.getState();
      return Array.isArray(s?.diary) && s.diary.length === 1;
    },
    undefined,
    { timeout: 10_000 },
  );

  // 新日记一条——两套互不干扰。
  await recordEntry(page, { kind: 'dwellerHungry', day: 1, minute: 700, text: '你开始饿了，但还撑得住——这次没事。', actorId: 'player' });

  const stores = await page.evaluate(async () => {
    const mod = '/src/systems/DiarySystem.ts';
    const m = (await import(mod)) as {
      diaryOf: (s: unknown) => DiaryEntryLike[];
      recentDiary: (s: unknown, n?: number) => Array<{ message: string }>;
    };
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    return {
      newDiary: m.diaryOf(s).map((e) => e.text),
      oldDiary: m.recentDiary(s, 5).map((e) => e.message),
      oldCount: (s.diary as unknown[]).length,
    };
  });
  expect(stores.newDiary).toEqual(['你开始饿了，但还撑得住——这次没事。']);
  expect(stores.oldDiary).toEqual(['旧格式的一条。']);
  expect(stores.oldCount).toBe(1);

  // 真实 UI：夜间安排面板仍从旧日记读「上次：…」（ GameScene 的直读路径）。
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.gameMinuteOfDay = 1200; // 20:00，允许睡觉
  });
  await setX(page, 1120); // BED_X，宿舍的床
  await page.keyboard.press('E');
  await expect.poll(async () => hasVisibleText(page, '夜间安排 · 宿舍'), { timeout: 10_000 }).toBe(true);
  expect(await hasVisibleText(page, '上次：旧格式的一条。')).toBe(true);
  // 面板上看不到新日记的条目（两套存储，UI 各读各的）
  expect(await hasVisibleText(page, '你开始饿了')).toBe(false);
  await page.keyboard.press('Escape');

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── 7. flag 查询不被裁剪影响 ────────────────────────────────────────────────

test('diary flags answer "did this happen" even after the 64-entry cap trims the log', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  const trimmed = await page.evaluate(async () => {
    const mod = '/src/systems/DiarySystem.ts';
    const m = (await import(mod)) as {
      recordDiary: (s: unknown, e: unknown) => DiaryEntryLike;
      diaryOf: (s: unknown) => DiaryEntryLike[];
      hasDiaryKind: (s: unknown, k: string) => boolean;
      diaryKindCount: (s: unknown, k: string) => number;
      DIARY_ENTRY_LIMIT: number;
    };
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    for (let i = 0; i < 70; i++) {
      m.recordDiary(s, { kind: 'shelterAttacked', day: 1 + Math.floor(i / 10), minute: 30 + i, text: `第 ${i} 次被袭`, actorId: null });
    }
    return {
      kept: m.diaryOf(s).length,
      limit: m.DIARY_ENTRY_LIMIT,
      oldest: m.diaryOf(s)[m.diaryOf(s).length - 1].text,
      newest: m.diaryOf(s)[0].text,
      has: m.hasDiaryKind(s, 'shelterAttacked'),
      count: m.diaryKindCount(s, 'shelterAttacked'),
      flagValue: (s.flags as Record<string, number>)['diary:shelterAttacked'],
    };
  });

  expect(trimmed.kept).toBe(trimmed.limit); // 64 条上限，裁掉最旧的
  expect(trimmed.kept).toBe(64);
  expect(trimmed.oldest).toBe('第 6 次被袭');
  expect(trimmed.newest).toBe('第 69 次被袭');
  // 旗不被裁剪影响：「这局被袭击过吗」不因条目裁掉而改口
  expect(trimmed.has).toBe(true);
  expect(trimmed.count).toBe(70);
  expect(trimmed.flagValue).toBe(70);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
