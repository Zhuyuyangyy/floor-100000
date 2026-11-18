import { expect, test, type Page } from '@playwright/test';

// TWOM 对齐 §7：NPC 三原子（AG-28 落地，契约 docs/plans/TWOM_ALIGNMENT.md
// 第七节；需求来源 docs/reference/TWOM_MECHANICS.md §4——625 个 BT 任务类里
// 的 BTTaskKosovoEntityGoTo / Speak / PlayAnimation 三个原子 + Sensor* /
// Forced* 两类装饰器）。
//
// 测什么（全部对着**真实运行中的游戏**）：
//   1. goTo 原子——x 与场景精灵的实际位置同源（同一个 npcSchedule 纯函数），
//      playAnimation clip 与精灵实际播放的 anim key 逐字一致；
//   2. clip 命名与 render/walkcycle.ts 的 key 生成器同构（映射漂移会红）；
//   3. speak 原子——Sensor 门控：玩家走近才发射，且真场景里 E 真的能开对话；
//      走远则不发射、E 开不开；
//   4. sense() 感知面——贴身 / 超距 / 跨层三态；
//   5. Forced 打断——forcedTarget 非空时自主原子（含 speak）整棵丢弃，越界
//      钳制；为空时自主照常；
//   6. 确定性——同 state 两次调用逐字节一致；
//   7. 流浪者——三原子不是 NPC 专属（第二个实体上的原子序列）。
//
// 方法说明（重要）：派工单提到的 dev 句柄 `__PHASER_NPC_ATOMS__` 在本分支
// **并不存在**（src/main.ts 只挂 __PHASER_GAME__ / __PHASER_SESSION__）。本
// spec 在页面里 import 产品自己的 ai/npcAtoms 模块（Vite dev server 模块图
// 与应用同源），对真实 GameState 求原子序列，再与场景里精灵的真实位置/真实
// 播放的动画交叉比对——原子是纯计划，精灵是纯计划的消费结果，两边对齐才是
// 「升级不是重写、没有第二套位置逻辑」的证据。缺句柄这件事写进报告。
//
// 另一处已知缺口：forcedTarget 目前没有场景生产者（玩家指令 NPC 移动的功能
// 未做，AG-28 实现说明已记档），所以 Forced 打断在函数面验（对真实 state
// 调用），场景面无可验——spec 如实分开标注。

interface AtomLike {
  kind: string;
  x?: number;
  speed?: number;
  text?: string;
  clip?: string;
}

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

const setX = (page: Page, x: number): Promise<void> =>
  page.evaluate((v) => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.player.x = v;
  }, x);

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

/** 阿林精灵的实时 x 与正在播放的 anim key（场景每帧按自主视图重摆）。 */
async function alinSprite(page: Page): Promise<{ x: number; anim: string } | null> {
  return page.evaluate(() => {
    const sc = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as {
      npcObjs?: Map<string, { sprite: { x: number; anims: { currentAnim?: { key: string } } } }>;
    } | null;
    const rec = sc?.npcObjs?.get('alin');
    if (!rec) return null;
    return { x: rec.sprite.x, anim: rec.sprite.anims.currentAnim?.key ?? '' };
  });
}

// AG-66：阻碍物的 E 交互优先于 NPC（onInteract 阻碍物 → NPC）。seed42 的 2 层
// 瓦砾@222 嵌在 alin 的巡逻带 [196.5,224.5] 里，贴她身上按 E 开的是瓦砾提示
// 而不是对话。站位改挑「够得到她、又不在阻碍物交互距离内」的点；她恰好压在
// 瓦砾正上方（无解）时等几步——巡逻会走开。同 e2e/npc.spec.ts 的修法。
async function obstacleAwareStandX(page: Page): Promise<number | null> {
  const both = await page.evaluate(() => {
    const sc = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as {
      npcObjs?: Map<string, { sprite: { x: number } }>;
      activeObstacleList?: Array<{ x: number }>;
    } | null;
    const rec = sc?.npcObjs?.get('alin');
    return {
      npcX: rec ? rec.sprite.x : null,
      obstacleXs: (sc?.activeObstacleList ?? []).map((o) => o.x),
    };
  });
  if (both.npcX === null) return null;
  for (const d of [0, -12, 12, -24, 24, -34, 34, -42, 42, -44, 44]) {
    const s = both.npcX + d;
    if (s < 8) continue;
    if (both.obstacleXs.every((ox) => Math.abs(ox - s) > 44)) return s;
  }
  return null;
}

/** 在页面里对真实 state 求原子序列（产品函数，非 mock）。 */
async function atomsFor(page: Page, npcId: string, opts: { forcedTarget?: number | null } = {}): Promise<AtomLike[]> {
  return page.evaluate(
    async ({ id, o }) => {
      const mod = '/src/ai/npcAtoms.ts';
      const m = (await import(mod)) as {
        npcAtomsFor: (npc: unknown, s: unknown, opts?: unknown) => AtomLike[];
      };
      const npcsMod = '/src/data/npcs.ts';
      const npcs = (await import(npcsMod)) as { getNpc: (id: string) => unknown };
      const s = window.__PHASER_SESSION__?.getState();
      if (!s) throw new Error('no session');
      return m.npcAtomsFor(npcs.getNpc(id), s, o);
    },
    { id: npcId, o: opts },
  );
}

async function senseOf(page: Page, npcId: string): Promise<{
  npcId: string;
  floor: number;
  x: number;
  player: { floor: number; x: number; sameFloor: boolean; distance: number; withinInteract: boolean };
  self: { slotLabel: string; moving: boolean };
}> {
  return page.evaluate(
    async (id) => {
      const mod = '/src/ai/npcAtoms.ts';
      const m = (await import(mod)) as { sense: (npc: unknown, s: unknown) => never };
      const npcsMod = '/src/data/npcs.ts';
      const npcs = (await import(npcsMod)) as { getNpc: (id: string) => unknown };
      const s = window.__PHASER_SESSION__?.getState();
      if (!s) throw new Error('no session');
      return m.sense(npcs.getNpc(id), s);
    },
    npcId,
  );
}

// ── 1+2. goTo / playAnimation：原子与场景精灵同源 ───────────────────────────

test('the goTo atom targets the sprite\'s live position and the clip is the anim actually playing', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  // 爬到 2 层（NPC 层），阿林在那里。
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.player.x = 40; // UP_EXIT_X
  });
  await page.keyboard.press('E');
  await page.waitForFunction(
    () => window.__PHASER_SESSION__?.getState()?.currentFloor === 2,
    undefined,
    { timeout: 8000 },
  );
  await page.waitForTimeout(400); // 落稳，syncNpcs 开始每帧重摆

  // 原子序列、精灵实况、状态快照在同一个 JS 任务里读——时钟不可能在期间前进。
  const probe = await page.evaluate(async () => {
    const mod = '/src/ai/npcAtoms.ts';
    const m = (await import(mod)) as {
      npcAtomsFor: (npc: unknown, s: unknown) => AtomLike[];
    };
    const npcsMod = '/src/data/npcs.ts';
    const npcs = (await import(npcsMod)) as { getNpc: (id: string) => unknown };
    const schedMod = '/src/ai/npcSchedule.ts';
    const sched = (await import(schedMod)) as {
      npcAutonomyAt: (id: string, o: unknown) => { x: number };
      NPC_WALK_SPEED: number;
      NPC_MARGIN: number;
    };
    const constMod = '/src/core/constants.ts';
    const constants = (await import(constMod)) as { FLOOR_WIDTH: number };
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    const sc = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as {
      npcObjs?: Map<string, { sprite: { x: number; anims: { currentAnim?: { key: string } } } }>;
    };
    const rec = sc?.npcObjs?.get('alin');
    if (!rec) throw new Error('alin sprite not on this floor');
    const atoms = m.npcAtomsFor(npcs.getNpc('alin'), s);
    const view = sched.npcAutonomyAt('alin', {
      day: s.day,
      minuteOfDay: s.gameMinuteOfDay,
      runSeed: s.runSeed,
      scarcity: null,
    });
    return {
      atoms,
      spriteX: rec.sprite.x,
      spriteAnim: rec.sprite.anims.currentAnim?.key ?? '',
      viewX: view.x,
      walkSpeed: sched.NPC_WALK_SPEED,
      margin: sched.NPC_MARGIN,
      floorWidth: constants.FLOOR_WIDTH,
      minute: s.gameMinuteOfDay,
    };
  });

  // 原子顺序固定：goTo → playAnimation（±speak）。
  expect(probe.atoms[0].kind).toBe('goTo');
  expect(probe.atoms[1].kind).toBe('playAnimation');

  // goTo 的 x 与 npcSchedule 的运行时坐标**同一个函数同一个值**（无第二套位置逻辑）。
  expect(probe.atoms[0].x).toBe(probe.viewX);
  expect(probe.atoms[0].speed).toBe(probe.walkSpeed);
  expect(probe.atoms[0].x!).toBeGreaterThanOrEqual(probe.margin);
  expect(probe.atoms[0].x!).toBeLessThanOrEqual(probe.floorWidth - probe.margin);

  // 与精灵的实际位置一致。容差一个游戏分钟的步行量：syncNpcs 在 update 里
  // 跑在本帧时钟推进**之前**，所以读到的是上一帧分钟的位置，而快照的
  // gameMinuteOfDay 已经多了这一帧（3 游戏分钟/真实秒 ≈ 0.05 分/帧）。
  // 超过一个游戏分钟就是真的不同源。
  expect(Math.abs(probe.atoms[0].x! - probe.spriteX), `atom goTo x=${probe.atoms[0].x} vs sprite x=${probe.spriteX}`)
    .toBeLessThanOrEqual(probe.walkSpeed);

  // playAnimation 的 clip 与精灵**正在播放的** anim key 逐字一致。
  expect(probe.atoms[1].clip).toBe(probe.spriteAnim);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('clip names stay isomorphic with walkcycle\'s key generators', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  const iso = await page.evaluate(async () => {
    const mod = '/src/ai/npcAtoms.ts';
    const m = (await import(mod)) as {
      npcClipKey: (who: string, moving: boolean) => string;
      npcCharacterKey: (npc: unknown) => string;
    };
    const wcMod = '/src/render/walkcycle.ts';
    const wc = (await import(wcMod)) as { walkAnimKey: (who: string) => string; idleAnimKey: (who: string) => string };
    const npcsMod = '/src/data/npcs.ts';
    const npcs = (await import(npcsMod)) as { getNpc: (id: string) => unknown };
    const out: Array<{ who: string; walk: boolean; idle: boolean; character: boolean }> = [];
    for (const who of ['npc_alin', 'npc_xiaozhou', 'wanderer']) {
      out.push({
        who,
        walk: m.npcClipKey(who, true) === wc.walkAnimKey(who),
        idle: m.npcClipKey(who, false) === wc.idleAnimKey(who),
        character: true,
      });
    }
    // 角色 key：alin → npc_alin（与 GameScene.drawNpcs 的 who 同规则）
    out.push({
      who: 'alin',
      walk: true,
      idle: true,
      character: m.npcCharacterKey(npcs.getNpc('alin')) === 'npc_alin',
    });
    return out;
  });

  for (const row of iso) {
    expect(row.walk, `${row.who}: walk clip must equal walkAnimKey`).toBe(true);
    expect(row.idle, `${row.who}: idle clip must equal idleAnimKey`).toBe(true);
    if (row.who === 'alin') expect(row.character, 'npcCharacterKey(alin) must be npc_alin').toBe(true);
  }

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── 3. speak：Sensor 门控 + 真场景交互 ──────────────────────────────────────

test('the speak atom is sensor-gated: close enough and the real E key opens the dialogue', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.player.x = 40;
  });
  await page.keyboard.press('E');
  await page.waitForFunction(
    () => window.__PHASER_SESSION__?.getState()?.currentFloor === 2,
    undefined,
    { timeout: 8000 },
  );
  await page.waitForTimeout(400);

  // 反例：玩家在一个"安静点"（远离阿林、远离每个遭遇点、不在楼梯口）——
  // 不发射 speak，E 也开不了对话。注意：楼梯口是左端 x=40（上楼）与右端
  // x=1240（下楼），交互半径 44；遭遇点（spotMarkers，dwell 压力会滚动补
  // 点）同样在 44 内抢先于 NPC——实测 seed 42 的 2 层 x=640 附近就有一个，
  // 在那儿按 E 开的是遭遇面板，第一个 Escape 还得先关它。
  const quietX = await page.evaluate(() => {
    const sc = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as {
      spotMarkers?: Map<string, { x: number }>;
      npcObjs?: Map<string, { sprite: { x: number } }>;
    } | null;
    const avoid: number[] = [40, 1240]; // 两个楼梯口
    const alin = sc?.npcObjs?.get('alin');
    if (alin) avoid.push(alin.sprite.x);
    for (const m of sc?.spotMarkers?.values() ?? []) avoid.push(m.x);
    for (let x = 200; x <= 1100; x += 10) {
      if (avoid.every((a) => Math.abs(a - x) >= 60)) return x;
    }
    return null;
  });
  expect(quietX, 'floor 2 should have a spot clear of encounters, alin and stairwells').not.toBeNull();
  await setX(page, quietX!);
  let atoms = await atomsFor(page, 'alin');
  expect(atoms.some((a) => a.kind === 'speak')).toBe(false);
  await page.keyboard.press('E');
  await page.waitForTimeout(400);
  expect(await hasVisibleText(page, '阿林（维修工）')).toBe(false);

  // 正例：站到阿林实时位置旁——sense 报 withinInteract，原子带 speak，
  // 且真场景里 E 真的打开对话（Sensor 的结论与场景交互判定同源）。
  // 站位要同时避开阻碍物的交互距离（AG-66：阻碍物抢先于 NPC）。
  // alin 沿巡逻带走动：瞬移落点按她那刻的位置算，她再走开一步 44 的交互
  // 阈值就超（实测 46.69/55.51——对话开着她的 sprite 仍在动，「时钟/自主
  // 冻结」不冻巡逻 tween）。所以 sense 读数必须在按 E 前的收敛窗口取快照，
  // 循环外对快照断言；atoms 读状态对象，不受 sprite 移动影响，留到最后。
  let settled: { sameFloor: boolean; distance: number; withinInteract: boolean } | null = null;
  for (let i = 0; i < 6; i++) {
    if (await hasVisibleText(page, '阿林（维修工）')) break;
    let spot: number | null = null;
    for (let w = 0; w < 8 && spot === null; w++) {
      spot = await obstacleAwareStandX(page);
      if (spot === null) await page.waitForTimeout(250);
    }
    if (spot === null) continue;
    await setX(page, spot);
    // 收敛到交互阈值 44 本身（不是更紧的 40）：巡逻带宽 28px，避开瓦砾的
    // 候选点最远落在 npcX±44，等 40 以内可能永远等不到（d=±42 时距离 42）。
    // 窗口给到 ~4s：alin 的巡逻 AI 有停顿，负载高时一停一顿，短窗口会整个
    // 错过她走进可达范围的时刻（单跑绿/批量挂的根因）。
    for (let c = 0; c < 32; c++) {
      const s = await senseOf(page, 'alin');
      if (s.player.distance <= 44) { settled = s.player; break; }
      await page.waitForTimeout(120);
    }
    await page.keyboard.press('E');
    await page.waitForTimeout(250);
  }
  expect(await hasVisibleText(page, '阿林（维修工）'), 'E beside alin must open her dialogue').toBe(true);

  expect(settled, 'standing beside alin must settle inside interact range before E').not.toBeNull();
  expect(settled!.sameFloor).toBe(true);
  expect(settled!.distance).toBeLessThanOrEqual(44);
  expect(settled!.withinInteract).toBe(true);
  atoms = await atomsFor(page, 'alin');
  const speak = atoms.find((a) => a.kind === 'speak');
  expect(speak, 'within interact distance the speak atom must fire').toBeDefined();
  expect(typeof speak!.text).toBe('string');
  expect(speak!.text!.length).toBeGreaterThan(0);

  // 台词与信誉分层同源（neutral 档兜底句，AG-13/npcAtoms 单测钉过同一条）。
  const line = await page.evaluate(async () => {
    const mod = '/src/ai/npcEconomy.ts';
    const m = (await import(mod)) as { attitudeLine: (npc: unknown, tier: string) => string };
    const npcsMod = '/src/data/npcs.ts';
    const npcs = (await import(npcsMod)) as { getNpc: (id: string) => unknown };
    return m.attitudeLine(npcs.getNpc('alin'), 'neutral');
  });
  expect(speak!.text).toBe(line);

  // 关回去。至多 4 次 Escape：dwell 压力在楼上待久了会滚出遭遇面板，与对话
  // 叠在一起时 Escape 先关遭遇（实测产品行为：onEsc 的分支序是遭遇 → 对话），
  // 所以这里循环按到对话文本消失为止，断言本身不放宽。
  for (let i = 0; i < 4 && (await hasVisibleText(page, '阿林（维修工）')); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  expect(await hasVisibleText(page, '阿林（维修工）'), 'Escape must eventually close the dialogue').toBe(false);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── 4. sense() 感知面三态 ───────────────────────────────────────────────────

test('sense() reports the three proximity states: touching, out of range, and another floor', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  // 跨层：开局玩家在 1 层宿舍，阿林在 2 层——看不见就不谈距离。
  const crossFloor = await senseOf(page, 'alin');
  expect(crossFloor.floor).toBe(2);
  expect(crossFloor.player.floor).toBe(1);
  expect(crossFloor.player.sameFloor).toBe(false);
  expect(crossFloor.player.distance).toBe(Infinity);
  expect(crossFloor.player.withinInteract).toBe(false);

  // 上楼到 NPC 层。
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.player.x = 40;
  });
  await page.keyboard.press('E');
  await page.waitForFunction(
    () => window.__PHASER_SESSION__?.getState()?.currentFloor === 2,
    undefined,
    { timeout: 8000 },
  );
  await page.waitForTimeout(400);

  // 贴身：sameFloor，距离≈0（容差 8px：setX 之后阿林仍按日程走路，3 游戏
  // 分钟/真实秒 × 40px/游戏分钟 ≈ 120px/真实秒，两次 evaluate 往返就漂几
  // px——npc.spec.ts 注释记录的同一现象），withinInteract。
  const sprite = await alinSprite(page);
  expect(sprite).not.toBeNull();
  await setX(page, sprite!.x);
  const touching = await senseOf(page, 'alin');
  expect(touching.player.sameFloor).toBe(true);
  expect(touching.player.distance).toBeLessThanOrEqual(8);
  expect(touching.player.withinInteract).toBe(true);

  // 超距：挪到楼层正中——同层但超出交互距离（且不在楼梯口）。
  await setX(page, 640);
  const far = await senseOf(page, 'alin');
  expect(far.player.sameFloor).toBe(true);
  expect(far.player.distance).toBeGreaterThan(44);
  expect(far.player.withinInteract).toBe(false);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── 5. Forced 打断 ──────────────────────────────────────────────────────────

test('a forced target discards every autonomous atom (speak included) and clamps to the floor', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.player.x = 40;
  });
  await page.keyboard.press('E');
  await page.waitForFunction(
    () => window.__PHASER_SESSION__?.getState()?.currentFloor === 2,
    undefined,
    { timeout: 8000 },
  );
  await page.waitForTimeout(400);

  // 玩家贴在阿林身上——没有 forced 时会有 speak（下面的对照组验证这一点）。
  const sprite = await alinSprite(page);
  await setX(page, sprite!.x);
  const autonomous = await atomsFor(page, 'alin');
  expect(autonomous.some((a) => a.kind === 'speak'), 'control: touching alin must produce a speak atom').toBe(true);

  const forced = await page.evaluate(async () => {
    const mod = '/src/ai/npcAtoms.ts';
    const m = (await import(mod)) as { npcAtomsFor: (npc: unknown, s: unknown, o?: unknown) => AtomLike[] };
    const npcsMod = '/src/data/npcs.ts';
    const npcs = (await import(npcsMod)) as { getNpc: (id: string) => unknown };
    const schedMod = '/src/ai/npcSchedule.ts';
    const sched = (await import(schedMod)) as { NPC_WALK_SPEED: number; NPC_MARGIN: number };
    const constMod = '/src/core/constants.ts';
    const constants = (await import(constMod)) as { FLOOR_WIDTH: number };
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    const npc = npcs.getNpc('alin');
    return {
      // 玩家指令 > AI 自主：只剩强制执行原子。
      at900: m.npcAtomsFor(npc, s, { forcedTarget: 900 }),
      // 越界钳制：地板安全范围 [NPC_MARGIN, FLOOR_WIDTH - NPC_MARGIN]。
      below: m.npcAtomsFor(npc, s, { forcedTarget: -500 })[0],
      above: m.npcAtomsFor(npc, s, { forcedTarget: 99999 })[0],
      // 空指令 → 自主照常。
      none: m.npcAtomsFor(npc, s, { forcedTarget: null }),
      walkSpeed: sched.NPC_WALK_SPEED,
      margin: sched.NPC_MARGIN,
      floorWidth: constants.FLOOR_WIDTH,
    };
  });

  expect(forced.at900).toEqual([
    { kind: 'goTo', x: 900, speed: forced.walkSpeed },
    { kind: 'playAnimation', clip: 'walk-npc_alin' },
  ]);
  expect(forced.below).toEqual({ kind: 'goTo', x: forced.margin, speed: forced.walkSpeed });
  expect(forced.above).toEqual({ kind: 'goTo', x: forced.floorWidth - forced.margin, speed: forced.walkSpeed });
  // 空指令回到自主序列（贴身 → 仍带 speak）。
  expect(forced.none.some((a) => a.kind === 'speak')).toBe(true);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── 6. 确定性 ───────────────────────────────────────────────────────────────

test('the atom sequence is deterministic: the same live state answers twice, byte for byte', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  const twice = await page.evaluate(async () => {
    const mod = '/src/ai/npcAtoms.ts';
    const m = (await import(mod)) as { npcAtomsFor: (npc: unknown, s: unknown) => AtomLike[] };
    const npcsMod = '/src/data/npcs.ts';
    const npcs = (await import(npcsMod)) as { getNpc: (id: string) => unknown };
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    const a = m.npcAtomsFor(npcs.getNpc('alin'), s);
    const b = m.npcAtomsFor(npcs.getNpc('alin'), s);
    return { a: JSON.stringify(a), b: JSON.stringify(b), kinds: a.map((x) => x.kind) };
  });

  expect(twice.a).toBe(twice.b);
  expect(twice.kinds[0]).toBe('goTo');
  expect(twice.kinds[1]).toBe('playAnimation');

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── 7. 流浪者：三原子不是 NPC 专属 ──────────────────────────────────────────

test('the wanderer gets atoms too: a night wanderer event on this floor plans its entrance', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);

  // 反例：没有事件——空序列。
  const empty = await page.evaluate(async () => {
    const mod = '/src/ai/npcAtoms.ts';
    const m = (await import(mod)) as { wandererAtomsFor: (s: unknown) => AtomLike[] };
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    return m.wandererAtomsFor(s);
  });
  expect(empty).toEqual([]);

  // 正例：夜间 + 巡游体事件就在本层的登场计划 → goTo 到确定性出生点 + walk clip。
  const present = await page.evaluate(async () => {
    const mod = '/src/ai/npcAtoms.ts';
    const m = (await import(mod)) as { wandererAtomsFor: (s: unknown) => AtomLike[] };
    const autoMod = '/src/systems/NpcAutonomy.ts';
    const autonomy = (await import(autoMod)) as { planNightWanderer: (s: unknown) => { present: boolean; spawnX: number } };
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session');
    s.gameMinuteOfDay = 1320; // 22:00，夜间
    s.currentFloor = 3;
    s.worldEvents.activeEvent = { type: 'wanderer', floor: 3, message: '巡游体在这一层游荡', source: 'night' };
    const plan = autonomy.planNightWanderer(s);
    return { atoms: m.wandererAtomsFor(s), present: plan.present, spawnX: plan.spawnX };
  });

  expect(present.present, 'premise: the night wanderer plan must be present on floor 3').toBe(true);
  expect(present.atoms).toEqual([
    { kind: 'goTo', x: present.spawnX },
    { kind: 'playAnimation', clip: 'walk-wanderer' },
  ]);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
