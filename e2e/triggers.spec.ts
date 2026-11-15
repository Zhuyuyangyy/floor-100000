import { expect, test, type Page } from '@playwright/test';

// TWOM 对齐 §6：Flag/Trigger（AG-26 落地，契约 docs/plans/TWOM_ALIGNMENT.md
// 第六节；需求来源 docs/reference/TWOM_MECHANICS.md §4「TRIGGER 和 FLAG 立刻
// 可抄」）。
//
// 测什么：
//   1. 注册表完整——22 个触发器、id 唯一、覆盖三类收敛目标与两个数据表家族；
//   2. 触发器置旗 + 只报本次新置的旗（22 个里挑 5 个正反例：ev:blackout /
//      st:night-exposed / st:bag-overflowing / combat:active / goal:met）；
//   3. 存量 deprecated 行为不变——场景仍直读 worldEvents.activeEvent（停电
//      真的把灯一盏盏灭掉）、HUD 仍实时算每日目标 ✓；evaluateTriggers 只写
//      flags，不碰任何存量字段。
//
// 方法说明（重要，读 spec 前先读这段）：
// 游戏循环目前**没有**调用 evaluateTriggers（AG-26 的实现说明明确留了接线
// 清单给总控：GameScene.update 每帧求值一处尚未落）。所以本 spec 的求值是
// 在页面里 import 产品自己的 triggers 模块、对**真实运行中的 GameState** 调用
// evaluateTriggers——Vite dev server 的模块图与应用同源，import 到的是同一个
// 模块实例（WorldFlags 注册表共享）。这测的是产品代码对真实状态的行为，不是
//  mock；缺的那块（每帧接线）作为已知缺口写进报告，不改 spec 期望值。
//
// 配套：生存维度/心情物品/楼层环境三个 spec 在对应 Agent 合入前是 skip 态，
// 取消条件写在各文件头。

// ── 页面内 import 产品模块（Vite dev server 同源模块图）────────────────────
// 动态 import 的说明符用运行时字符串：tsc 会静态解析字面量 import()，
// 绝对 URL 路径不在模块解析范围内，拼串让它保持 any，编译期不报错。

interface TriggerLike {
  id: string;
  sets: string;
  when: (s: unknown) => boolean;
}

async function startGame(page: Page, seed: number): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await page.waitForFunction(
    () => {
      const g = window.__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Menu');
    },
    undefined,
    { timeout: 20_000 },
  );
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => {
      const g = window.__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect');
    },
    undefined,
    { timeout: 20_000 },
  );
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
  await page.waitForFunction(
    () => {
      const g = window.__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
    },
    undefined,
    { timeout: 20_000 },
  );
}

/** 页面上有没有可见文本（跨所有场景的 Text 对象）。 */
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

// ── 夹具：直接摆状态（存量 spec 同法，survival.spec.ts 的 setEvent 先例）────

async function setActiveEvent(page: Page, type: 'blackout' | 'wanderer' | 'leak' | null): Promise<void> {
  await page.evaluate((t) => {
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    const floor = s.currentFloor;
    s.worldEvents.activeEvent = t === null ? null : { type: t, floor, message: '测试事件' };
  }, type);
}

async function setNightOnFloor(page: Page, minuteOfDay: number, floor: number): Promise<void> {
  await page.evaluate(({ minute, fl }) => {
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    s.gameMinuteOfDay = minute;
    s.currentFloor = fl;
  }, { minute: minuteOfDay, fl: floor });
}

async function fillBag(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const path = '/src/systems/InventorySystem.ts';
    const m = (await import(path)) as { addItem: (inv: unknown, id: string, n: number) => void };
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    const more = ['dirty_water', 'bread', 'battery', 'scrap_metal', 'wood', 'cloth', 'tape', 'filter', 'wire'];
    for (const id of more) m.addItem(s.player.inventory, id, 1);
  });
}

async function setCombat(page: Page): Promise<void> {
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    s.combat = {
      kind: 'ambush',
      floor: 2,
      spotId: 'spot-1',
      monster: { id: 1, name: '测试怪', hp: 10, maxHp: 10, damage: 5, accuracy: 0.8, defense: 0, evasion: 0, behavior: 'aggressive' },
      guarding: false,
      turn: 1,
      log: [],
    };
  });
}

async function setDailyGoal(page: Page, target: number): Promise<void> {
  await page.evaluate((t) => {
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    s.dailyGoal = { day: s.day, kind: 'water', target: t, done: false };
  }, target);
}

/** 在页面里 import triggers 并对真实 state 求值，返回本次新置的旗。 */
async function evaluateInPage(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const path = '/src/systems/triggers.ts';
    const m = (await import(path)) as { evaluateTriggers: (s: unknown) => string[] };
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    return m.evaluateTriggers(s);
  });
}

async function flagValue(page: Page, name: string): Promise<number> {
  return page.evaluate((n) => {
    const s = window.__PHASER_SESSION__?.getState() as { flags?: Record<string, number> } | null;
    return s?.flags?.[n] ?? 0;
  }, name);
}

// ── 1. 注册表完整 ───────────────────────────────────────────────────────────

test('the trigger registry holds the contract list: 22 triggers, unique ids, all families', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  const registry = await page.evaluate(async () => {
    // triggers 模块的导入副作用就是注册；清单自省走 WorldFlags 的接口。
    const path = '/src/systems/triggers.ts';
    await import(path);
    const wfPath = '/src/systems/WorldFlags.ts';
    const wf = (await import(wfPath)) as {
      registeredTriggers: () => TriggerLike[];
    };
    return wf.registeredTriggers().map((t) => ({ id: t.id, sets: t.sets }));
  });

  const ids = registry.map((t) => t.id);
  expect(new Set(ids).size, 'trigger ids must be unique').toBe(ids.length);
  expect(registry.length).toBe(22); // 契约 §9：4 事件 + 2 状态 + 目标 + 战斗 + 2 饥渴 + 5 阶层 + 7 NPC

  const sets = registry.map((t) => t.sets);
  // 三类收敛目标（worldEvents.activeEvent / dailyGoal / combat）
  for (const key of ['ev:active', 'ev:blackout', 'ev:wanderer', 'ev:leak', 'goal:met', 'combat:active']) {
    expect(sets, `registry must cover ${key}`).toContain(key);
  }
  for (const key of ['st:night-exposed', 'st:bag-overflowing', 'stat:thirst-critical', 'stat:hunger-critical']) {
    expect(sets, `registry must cover ${key}`).toContain(key);
  }
  // 两个按数据表展开的家族：阶层 2..6（第 1 段出生即在，没有"第一次抵达"）
  for (const tier of [2, 3, 4, 5, 6]) expect(sets).toContain(`tier:${tier}:arrived`);
  // NPC 熟客：按 data/npcs.ts 展开
  for (const npc of ['alin', 'xiaozhou']) expect(sets).toContain(`npc:${npc}:regular`);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── 2. 五个正反例 ───────────────────────────────────────────────────────────

test('ev:blackout: an active blackout sets the flag, and the scene still dims the lamps (deprecated path unchanged)', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  // 前提自校验：这一层有灯（wall lamp 的蜡烛进了 lightFixtures），否则下面
  // 的"灯灭了"断言空转。
  const fixtureCount = await page.evaluate(() => {
    const sc = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { lightFixtures?: unknown[] } | null;
    return sc?.lightFixtures?.length ?? 0;
  });
  expect(fixtureCount, 'dorm floor should have lit lamp fixtures').toBeGreaterThan(0);

  // 反例先来：没有事件时，灯全亮，一个事件旗都不置。
  const lampsLit = await page.evaluate(() => {
    const sc = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { lightFixtures?: Array<{ alpha: number }> } | null;
    return (sc?.lightFixtures ?? []).every((f) => f.alpha > 0.9);
  });
  expect(lampsLit, 'lamps must be lit before any event').toBe(true);
  expect(await evaluateInPage(page)).not.toContain('ev:blackout');
  expect(await flagValue(page, 'ev:blackout')).toBe(0);

  // 正例：置上停电。场景的直读路径（deprecated 但未迁）真的把灯一盏盏灭掉。
  await setActiveEvent(page, 'blackout');
  await page.waitForFunction(
    () => {
      const sc = (window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { lightFixtures?: Array<{ alpha: number }>; wasBlackout?: boolean } | null);
      return !!sc && sc.wasBlackout === true && (sc.lightFixtures ?? []).every((f) => f.alpha < 0.05);
    },
    undefined,
    { timeout: 8000 },
  );

  // 新路径：触发器对同一状态置旗，且 ev:active 存在性旗一起置。
  const fired = await evaluateInPage(page);
  expect(fired).toContain('ev:blackout');
  expect(fired).toContain('ev:active');
  expect(await flagValue(page, 'ev:blackout')).toBe(1);

  // 只报新旗：同状态再求值一次，什么都没有。
  expect(await evaluateInPage(page)).toEqual([]);
  expect(await flagValue(page, 'ev:blackout')).toBe(1); // 旗不清

  // 存量字段没被触发器碰过：事件还在场景里照着灭灯。
  const stillBlackout = await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    const event = s?.worldEvents.activeEvent as { type?: string } | null | undefined;
    return event?.type === 'blackout';
  });
  expect(stillBlackout).toBe(true);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('st:night-exposed: night on a hostile floor sets it; night in the dorm does not', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  // 前提自校验：夜间判定与楼层敌意都按产品自己的函数确认（与 triggers.ts
  // 的 when 同一底稿），避免"测试以为的夜间/敌意"和产品以为的不是一个。
  const premises = await page.evaluate(async () => {
    const path = '/src/systems/triggers.ts';
    void (await import(path)); // 注册副作用
    const survivalPath = '/src/systems/SurvivalSystem.ts';
    const survival = (await import(survivalPath)) as { isNight: (m: number) => boolean };
    const constantsPath = '/src/core/constants.ts';
    const constants = (await import(constantsPath)) as { environmentFor: (f: number) => { hostile: boolean } };
    return {
      night: survival.isNight(1320),
      floor3Hostile: constants.environmentFor(3).hostile,
      dormHostile: constants.environmentFor(1).hostile,
    };
  });
  expect(premises.night, '22:00 must be night').toBe(true);
  expect(premises.floor3Hostile, 'floor 3 must be hostile').toBe(true);
  expect(premises.dormHostile, 'the dorm must not be hostile').toBe(false);

  // 反例：夜间但在宿舍——不置。
  await setNightOnFloor(page, 1320, 1);
  expect(await evaluateInPage(page)).not.toContain('st:night-exposed');
  expect(await flagValue(page, 'st:night-exposed')).toBe(0);

  // 反例：白天在敌意楼层——不置。
  await setNightOnFloor(page, 720, 3);
  expect(await evaluateInPage(page)).not.toContain('st:night-exposed');

  // 正例：夜间 + 敌意楼层——置，且只报一次。
  await setNightOnFloor(page, 1320, 3);
  expect(await evaluateInPage(page)).toContain('st:night-exposed');
  expect(await flagValue(page, 'st:night-exposed')).toBe(1);
  expect(await evaluateInPage(page)).not.toContain('st:night-exposed');

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('st:bag-overflowing: a full bag sets it; a bag with room does not', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  // 反例：起始背包（3 格 / 12 容量）不满。
  const before = await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    return { slots: s?.player.inventory.slots.length ?? -1, slotCount: s?.player.inventory.slotCount ?? -1 };
  });
  expect(before.slotCount).toBeGreaterThan(before.slots);
  expect(await evaluateInPage(page)).not.toContain('st:bag-overflowing');

  // 正例：填满 12 格（补 9 件不同物品）——置。
  await fillBag(page);
  const full = await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    return { slots: s?.player.inventory.slots.length ?? -1, slotCount: s?.player.inventory.slotCount ?? -1 };
  });
  expect(full.slots).toBe(full.slotCount);
  expect(await evaluateInPage(page)).toContain('st:bag-overflowing');
  expect(await flagValue(page, 'st:bag-overflowing')).toBe(1);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('combat:active: state.combat existing sets it; no combat does not', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  expect(await evaluateInPage(page)).not.toContain('combat:active');
  expect(await flagValue(page, 'combat:active')).toBe(0);

  await setCombat(page);
  expect(await evaluateInPage(page)).toContain('combat:active');
  expect(await flagValue(page, 'combat:active')).toBe(1);
  expect(await evaluateInPage(page)).toEqual([]);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('goal:met: a satisfied daily goal sets the flag AND the HUD still shows its own live check', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  // 反例：目标定到够不着——HUD 无 ✓，旗不置。
  await setDailyGoal(page, 100);
  await expect.poll(async () => hasVisibleText(page, '带回'), { timeout: 8000 }).toBe(true);
  const goalTextFar = await page.evaluate(() => {
    const sc = window.__PHASER_GAME__?.scene.getScene('Game');
    const t = (sc?.children.list ?? []).find((o) => o.type === 'Text' && (o as unknown as { name?: string }).name === 'hud-goal');
    return t?.text ?? '';
  });
  expect(goalTextFar).not.toContain('✓');
  expect(await evaluateInPage(page)).not.toContain('goal:met');

  // 正例：目标定到起始存量就够（3 瓶净水 ≥ 2）——HUD 实时出 ✓，旗也置。
  await setDailyGoal(page, 2);
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const sc = window.__PHASER_GAME__?.scene.getScene('Game');
          const t = (sc?.children.list ?? []).find((o) => o.type === 'Text' && (o as unknown as { name?: string }).name === 'hud-goal');
          return t?.text ?? '';
        }),
      { timeout: 8000 },
    )
    .toContain('✓');

  expect(await evaluateInPage(page)).toContain('goal:met');
  expect(await flagValue(page, 'goal:met')).toBe(1);

  // 两条路径互不替代：HUD 的 ✓ 是实时判定（目标改成够不着会消失），旗是
  // 「曾经达标」的一次性事实（不清）。把目标改回去之前先见证前者。
  await setDailyGoal(page, 100);
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const sc = window.__PHASER_GAME__?.scene.getScene('Game');
          const t = (sc?.children.list ?? []).find((o) => o.type === 'Text' && (o as unknown as { name?: string }).name === 'hud-goal');
          return t?.text ?? '';
        }),
      { timeout: 8000 },
    )
    .not.toContain('✓');
  expect(await flagValue(page, 'goal:met'), 'the flag is a latched fact, not a live query').toBe(1);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── 3. 存量字段零触碰 ───────────────────────────────────────────────────────

test('evaluateTriggers only ever writes flags — every legacy field is byte-identical after evaluation', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  // 摆一个多触发器同时满足的状态（夜间敌意楼层 + 背包满 + 事件在场）。
  await setNightOnFloor(page, 1320, 3);
  await fillBag(page);
  await setActiveEvent(page, 'leak');

  // 先开背包冻结时钟：update() 在面板处早退，dwell 计时、时钟推进全部
  // 暂停——否则两次快照之间 worldEvents.dwell.minutes 会变，字节比对会
  // 被与触发器无关的东西搅黄。
  await page.keyboard.press('I');
  await page.waitForFunction(
    () => (window.__PHASER_GAME__?.scene.getScene('Game') as unknown as { inventoryOpen?: boolean } | null)?.inventoryOpen === true,
    undefined,
    { timeout: 8000 },
  );

  const before = await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    return JSON.stringify({
      worldEvents: s.worldEvents,
      dailyGoal: s.dailyGoal,
      combat: s.combat,
      player: { thirst: s.player.thirst, hunger: s.player.hunger, inventory: s.player.inventory },
      currentFloor: s.currentFloor,
      gameMinuteOfDay: s.gameMinuteOfDay,
      day: s.day,
    });
  });

  const fired = await evaluateInPage(page);
  expect(fired.length, 'several triggers should fire at once').toBeGreaterThan(2);

  const after = await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    return JSON.stringify({
      worldEvents: s.worldEvents,
      dailyGoal: s.dailyGoal,
      combat: s.combat,
      player: { thirst: s.player.thirst, hunger: s.player.hunger, inventory: s.player.inventory },
      currentFloor: s.currentFloor,
      gameMinuteOfDay: s.gameMinuteOfDay,
      day: s.day,
    });
  });

  expect(after).toBe(before);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
