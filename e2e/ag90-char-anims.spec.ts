import { expect, test, type Page } from '@playwright/test';

// AG-90（角色动作 GIF 全量接线）实测探针（端口 5201，--workers=1）。
//
// 用户 2026-11-18 原话：「把战斗做好，GIF 全用上」。本 spec 用六个场景的
// 逐帧记录 + 截图钉住四名角色的六个动作 GIF 真的在播，而且播的是对的那
// 个角色、对的那张贴图：
//   ① 世界待机：玩家站立时播 idle-player，贴图 char-anim-player-idle，
//      1000ms/帧的两帧循环逐帧推进（不是静帧）；
//   ② 搜刮：E 开柜先弯腰——search-player 在 char-anim-player-search 上；
//   ③ 战斗出手：Enter 攻击播 attack-player（char-anim-player-attack），
//      600ms/帧三帧推进，播完停在末帧等 walk/idle 挑选接手；
//   ④ 受击：格挡迎击，怪物反击命中播 hurt-player（char-anim-player-hurt）；
//   ⑤ 拾取：走过地面物品播 pickup-player（char-anim-player-pickup）；
//   ⑥ 死亡：hp 归零播 die-player（char-anim-player-die），倒地帧停住，
//      2.8s 后才切结局卡（GIF 3x900ms + 100ms 余量）。
//
// 关键实现（src/render/charAnims.ts）：六个动画 key 与 walkcycle 的程序化
// 注册同名，BootScene 里 createCharAnimAnims 后跑、anims.remove 掉程序化
// 注册再按 GIF 图集重建——所以调用点一字未改，GIF 就从同一批 key 里出来。
// walk/run 不接（B3-14 手摆行走循环不许回退）。
//
// 截图落 output/ag90/（gitignored，AG-44/AG-70 同款约定）；正式证据副本
// 由提交说明指向仓库外 qa 目录。

interface AnimSample {
  t: number;
  key: string;
  textureKey: string;
  /** 0 基 sheet 列号（Phaser 4 的 currentFrame.index 是 1 基的，断言用它）。 */
  frame: number;
}

/** 页内逐帧记录器：rAF 采样玩家精灵的动画 key / 贴图键 / 帧号。 */
async function installAnimTracer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __ag90Trace?: { running: boolean; samples: AnimSample[] };
    };
    const game = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (k: string) => { player: { anims: { currentAnim?: { key: string }; currentFrame: { index: number; textureFrame: string | number } }; texture: { key: string } } } | null } };
    }).__PHASER_GAME__;
    const scene = game?.scene.getScene('Game');
    if (!scene) throw new Error('no Game scene');
    w.__ag90Trace = { running: true, samples: [] };
    const start = performance.now();
    const tick = (): void => {
      const p = scene.player;
      w.__ag90Trace!.samples.push({
        t: Math.round(performance.now() - start),
        key: p.anims.currentAnim?.key ?? '',
        textureKey: p.texture.key,
        frame: Number(p.anims.currentFrame?.textureFrame ?? -1),
      });
      if (w.__ag90Trace!.running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function readTrace(page: Page): Promise<AnimSample[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __ag90Trace?: { running: boolean; samples: AnimSample[] } };
    if (w.__ag90Trace) w.__ag90Trace.running = false;
    return w.__ag90Trace?.samples ?? [];
  });
}

/**
 * CI 慢环境适配（run 44389231159）：①/⑥ 原来用固定 sleep 赌「采样窗口一定
 * 走得完一轮 GIF」——CI 上 2400ms 只采到 idle 的 0,1 两帧（1000ms/帧的两帧
 * 循环没走完一轮）、die 只采到 0,1（第三帧在 1800ms game-time 才出现，慢环境
 * 里 2400ms wall 走不到）。固定窗口在快机器上绰绰有余、在 CI 容器里差几秒，
 * 是窗口问题不是功能问题（三档 GIF 都在播，只是短）。
 * 改法：轮询真实条件——页内 trace 里该 key 的去重帧序列长度达标（一轮循环 =
 * 长度 ≥3：0→1→0；die 三帧 = 0→1→2），tracer 保持运行，收样仍由 readTrace 做。
 * timeout 15s：一轮循环 2s game-time，15s ≈ 7 轮余量，CI 再慢也够。
 */
async function waitForTraceFrameCount(page: Page, key: string, min: number, timeout = 15_000): Promise<void> {
  await page.waitForFunction(
    ({ k, n }) => {
      const w = (window as unknown as { __ag90Trace?: { samples: AnimSample[] } }).__ag90Trace;
      if (!w) return false;
      const seen: number[] = [];
      for (const s of w.samples) {
        if (s.key !== k) continue;
        if (seen.length === 0 || seen[seen.length - 1] !== s.frame) seen.push(s.frame);
      }
      return seen.length >= n;
    },
    { k: key, n: min },
    { timeout },
  );
}

/** 记录器里某个动画 key 出现过的帧号序列（按出现顺序去重相邻项）。 */
function framesOf(samples: AnimSample[], key: string): number[] {
  const out: number[] = [];
  for (const s of samples) {
    if (s.key !== key) continue;
    if (out.length === 0 || out[out.length - 1] !== s.frame) out.push(s.frame);
  }
  return out;
}

function texturesOf(samples: AnimSample[], key: string): string[] {
  return [...new Set(samples.filter((s) => s.key === key).map((s) => s.textureKey))];
}

/** 玩家精灵当前状态：动画 key、贴图键、帧号。 */
async function probePlayer(page: Page): Promise<{ key: string; textureKey: string; frame: number }> {
  return page.evaluate(() => {
    const game = (window as unknown as {
      __PHASER_GAME__?: { scene: { getScene: (k: string) => { player: { anims: { currentAnim?: { key: string }; currentFrame: { index: number } }; texture: { key: string } } } | null } };
    }).__PHASER_GAME__;
    const p = game!.scene.getScene('Game')!.player;
    return { key: p.anims.currentAnim?.key ?? '', textureKey: p.texture.key, frame: p.anims.currentFrame?.index ?? -1 };
  });
}

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === k);
    },
    key,
    { timeout: 30_000 },
  );
}

async function startGame(page: Page, seed = 42): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const started = await page
      .waitForFunction(
        () => {
          const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
          return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
        },
        undefined,
        { timeout: 2000 },
      )
      .then(() => true)
      .catch(() => false);
    if (started) break;
  }
  await waitForScene(page, 'Game');
  // 等本层画完：floorView 就位、玩家精灵播上 idle。
  await page.waitForFunction(
    () => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { floorView?: unknown; player: { anims: { currentAnim?: { key: string } } } } | null } } }).__PHASER_GAME__;
      const s = g?.scene.getScene('Game');
      return !!s?.floorView && (s.player.anims.currentAnim?.key ?? '').startsWith('idle-');
    },
    undefined,
    { timeout: 15_000 },
  );
}

/** 传送到某 x 并等一帧落地（autoPickup/交互区都按 state.player.x 算）。 */
async function setPlayerX(page: Page, x: number): Promise<void> {
  await page.evaluate((v) => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { x: number } } | null } }).__PHASER_SESSION__?.getState();
    if (s) s.player.x = v;
  }, x);
  await page.waitForTimeout(120);
}

/** 爬到目标层：传送到上梯口按 E，等 currentFloor 变更。 */
async function climbToFloor(page: Page, floor: number): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const now = await page.evaluate(() => (window as unknown as { __PHASER_SESSION__?: { getState: () => { currentFloor: number } | null } }).__PHASER_SESSION__?.getState()?.currentFloor);
    if (now === floor) return;
    await setPlayerX(page, 40); // 上梯口（ENTRY_X 附近）
    await page.keyboard.press('E');
    await page.waitForFunction(
      (f) => (window as unknown as { __PHASER_SESSION__?: { getState: () => { currentFloor: number } | null } }).__PHASER_SESSION__?.getState()?.currentFloor === f,
      floor,
      { timeout: 10_000 },
    ).catch(() => false);
    await page.waitForTimeout(300);
  }
  const now = await page.evaluate(() => (window as unknown as { __PHASER_SESSION__?: { getState: () => { currentFloor: number } | null } }).__PHASER_SESSION__?.getState()?.currentFloor);
  expect(now, `climb to floor ${floor}`).toBe(floor);
}

/** 逐个问号点试到开出伏击（AG-70 同款机位）。 */
async function openAmbush(page: Page): Promise<void> {
  const spots: Array<{ k: string; x: number }> = await page.evaluate(() => {
    const game = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { spotMarkers?: Map<string, { x: number }> } | null } } }).__PHASER_GAME__;
    const sc = game?.scene.getScene('Game') as unknown as { spotMarkers?: Map<string, { x: number }> } | null;
    return [...(sc?.spotMarkers ?? new Map()).entries()].map(([k, v]) => ({ k, x: Math.round(v.x) }));
  });
  for (const sp of spots) {
    if (sp.k === 'shop') continue;
    await setPlayerX(page, sp.x);
    await page.keyboard.press('E');
    await page.waitForTimeout(500);
    const inCombat = await page.evaluate(() => !!(window as unknown as { __PHASER_SESSION__?: { getState: () => { combat?: unknown } | null } }).__PHASER_SESSION__?.getState()?.combat);
    if (inCombat) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  throw new Error('no ambush spot for seed 42');
}

test('① 世界待机：idle GIF 两帧循环真的在走', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page);
  await installAnimTracer(page);
  // CI 慢环境适配（run 44389231159：固定 2400ms 在 CI 上只采到 0,1 两帧）：
  // 轮询「去重帧数 ≥3」这个真实条件（= 至少走完一轮 0→1→0），见
  // waitForTraceFrameCount 注释。功能断言不变：贴图 key、两帧集合、在播。
  await waitForTraceFrameCount(page, 'idle-player', 3);

  const samples = await readTrace(page);
  const idleFrames = framesOf(samples, 'idle-player');
  expect(texturesOf(samples, 'idle-player'), 'idle 播在 GIF 待机图集上').toEqual(['char-anim-player-idle']);
  // 1000ms/帧的两帧循环：至少走完一轮（0 -> 1 -> 0）才算「在走」——
  // 走完一轮由 waitForTraceFrameCount 轮询保证（CI 慢环境适配），这里钉结果。
  expect(idleFrames.length, `idle frames over time: ${idleFrames.join(',')}`).toBeGreaterThanOrEqual(3);
  expect(new Set(idleFrames)).toEqual(new Set([0, 1]));

  await page.screenshot({ path: 'output/ag90/01-world-idle.png' });
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('② 搜刮：E 开柜先弯腰（search GIF）', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page);
  // 1 层储物柜在 x=160（floorTemplates 的 floor 1 cabinet）。
  await setPlayerX(page, 160);
  await installAnimTracer(page);
  await page.keyboard.press('E');
  // search clip 拉满 SEARCH_MS（2s），GIF 自身 2x750ms。
  await page.waitForFunction(
    () => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { player: { anims: { currentAnim?: { key: string } } } } | null } } }).__PHASER_GAME__;
      return (g?.scene.getScene('Game')?.player.anims.currentAnim?.key ?? '') === 'search-player';
    },
    undefined,
    { timeout: 5000 },
  );
  await page.waitForTimeout(400);
  const mid = await probePlayer(page);
  await page.screenshot({ path: 'output/ag90/02-world-search.png' });

  const samples = await readTrace(page);
  expect(texturesOf(samples, 'search-player')).toEqual(['char-anim-player-search']);
  expect(mid.key).toBe('search-player');
  expect(mid.textureKey).toBe('char-anim-player-search');
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('③ 战斗出手：attack GIF 三帧推进', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page);
  await climbToFloor(page, 2);
  await openAmbush(page);
  await page.waitForTimeout(1200); // 滑步 + 偷袭演出落地

  await installAnimTracer(page);
  await page.keyboard.press('Enter'); // 攻击
  await page.waitForFunction(
    () => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { player: { anims: { currentAnim?: { key: string } } } } | null } } }).__PHASER_GAME__;
      return (g?.scene.getScene('Game')?.player.anims.currentAnim?.key ?? '') === 'attack-player';
    },
    undefined,
    { timeout: 5000 },
  );
  await page.waitForTimeout(700); // 第二帧（600ms/帧）进行中
  await page.screenshot({ path: 'output/ag90/03-combat-attack.png' });
  await page.waitForTimeout(1400); // 播完（3x600ms）停在末帧

  const samples = await readTrace(page);
  const attackFrames = framesOf(samples, 'attack-player');
  expect(texturesOf(samples, 'attack-player'), 'attack 播在 GIF 攻击图集上').toEqual(['char-anim-player-attack']);
  // 三帧 0 -> 1 -> 2 依次出现过；末帧停住等 walk/idle 挑选接手。
  expect(attackFrames, `attack frames: ${attackFrames.join(',')}`).toEqual([0, 1, 2]);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('④ 受击：怪物反击命中播 hurt GIF', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page);
  await climbToFloor(page, 2);
  await installAnimTracer(page);
  await openAmbush(page);
  await page.waitForTimeout(1200); // 滑步落地
  // 格挡迎击：每回合怪物正常反击，命中就播 hurt GIF（未命中日志「扑空」、
  // 无受伤动画，那就再打一回合——准确率是引擎掷的，重试到命中为止，
  // 与 AG-70 ③ 的两种合法分支同一判法）。
  let hurtSeen = false;
  for (let round = 0; round < 8 && !hurtSeen; round++) {
    await page.keyboard.press('ArrowDown'); // 格挡：本回合不出手，挨一下
    await page.waitForTimeout(120);
    await page.keyboard.press('Enter');
    const hurt = await page
      .waitForFunction(
        () => {
          const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { player: { anims: { currentAnim?: { key: string } } } } | null } } }).__PHASER_GAME__;
          return (g?.scene.getScene('Game')?.player.anims.currentAnim?.key ?? '') === 'hurt-player';
        },
        undefined,
        { timeout: 1500 },
      )
      .then(() => true)
      .catch(() => false);
    if (hurt) {
      hurtSeen = true;
      await page.waitForTimeout(350); // 第二帧（650ms/帧）进行中
      await page.screenshot({ path: 'output/ag90/04-combat-hurt.png' });
    }
    await page.waitForTimeout(900); // 等反击链（前冲+飘字）走完再进下一回合
  }
  expect(hurtSeen, 'monster counter landed a hurt clip within 8 guarded rounds').toBe(true);

  const samples = await readTrace(page);
  expect(texturesOf(samples, 'hurt-player')).toEqual(['char-anim-player-hurt']);
  expect(framesOf(samples, 'hurt-player')).toEqual([0, 1]);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('⑤ 拾取：走过地面物品播 pickup GIF', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page);
  await climbToFloor(page, 3); // 3 层模板有地面物品（battery x=160 / cloth x=1120）
  const ground = await page.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { floorView?: { groundItems: Array<{ key: string; x: number }> } } | null } } }).__PHASER_GAME__;
    const view = g?.scene.getScene('Game')?.floorView;
    return (view?.groundItems ?? []).map((g2) => ({ key: g2.key, x: g2.x }));
  });
  expect(ground.length, 'floor 3 has ground items to pick up').toBeGreaterThan(0);

  await installAnimTracer(page);
  await setPlayerX(page, ground[0].x); // autoPickup 在下一帧触发
  await page.waitForFunction(
    () => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { player: { anims: { currentAnim?: { key: string } } } } | null } } }).__PHASER_GAME__;
      return (g?.scene.getScene('Game')?.player.anims.currentAnim?.key ?? '') === 'pickup-player';
    },
    undefined,
    { timeout: 5000 },
  );
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'output/ag90/05-world-pickup.png' });
  await page.waitForTimeout(1100);

  const samples = await readTrace(page);
  expect(texturesOf(samples, 'pickup-player')).toEqual(['char-anim-player-pickup']);
  expect(framesOf(samples, 'pickup-player')).toEqual([0, 1]);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('⑥ 死亡：die GIF 倒地播完才切结局卡', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page);
  await installAnimTracer(page);
  // 走世界循环的真实死亡路径：hp 归零，下一帧 advanceTime 报 died。
  await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { player: { hp: number } } | null } }).__PHASER_SESSION__?.getState();
    if (s) s.player.hp = 0;
  });
  await page.waitForFunction(
    () => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScene: (k: string) => { player: { anims: { currentAnim?: { key: string } } } } | null } } }).__PHASER_GAME__;
      return (g?.scene.getScene('Game')?.player.anims.currentAnim?.key ?? '') === 'die-player';
    },
    undefined,
    { timeout: 8000 },
  );
  // GIF 3x900ms：第三帧（倒地）在 1.8s 后——2.4s 处截图落在倒地姿势上，
  // 且此时结局卡还没切（切场在 2700+100ms）。
  // CI 慢环境适配：game-time 在慢机器上落后于 wall-time，2400ms wall 处离
  // 切场（2800ms game-time）只更远不会更近，中段探针反而更稳；die-player
  // 这个 key 在整个 clip 内不变，探的是「倒地帧停住、没被 walk/idle 抢回」。
  await page.waitForTimeout(2400);
  const mid = await probePlayer(page);
  await page.screenshot({ path: 'output/ag90/06-world-die.png' });
  expect(mid.key, '倒地帧停住，未被 walk/idle 挑选抢回').toBe('die-player');
  expect(mid.textureKey).toBe('char-anim-player-die');

  // CI 慢环境适配（run 44389231159：固定窗口收样只拿到 [0,1]，第三帧在
  // 1800ms game-time 才演到，慢环境里 2400ms wall 走不到）：轮询 trace 出现
  // 第三帧再收样——GIF 三帧确实播完了，只是 CI 上演得慢（功能没问题，
  // 是窗口问题）。见 waitForTraceFrameCount 注释。
  await waitForTraceFrameCount(page, 'die-player', 3);

  const samples = await readTrace(page);
  expect(texturesOf(samples, 'die-player')).toEqual(['char-anim-player-die']);
  expect(framesOf(samples, 'die-player')).toEqual([0, 1, 2]);
  // 结局卡确实在倒地之后才来。
  await waitForScene(page, 'End');
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
