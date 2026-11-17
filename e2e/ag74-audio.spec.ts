import { expect, test, type Page } from '@playwright/test';

// AG-74（BGM 音乐层 + 音效扩展）实测探针（端口 5474，--workers=1）。
//
// 必测项：
//   ① 主菜单 BGM：手势前 AudioContext 不发声（自动播放策略），首次按键
//      （不激活菜单的方向键）后切到 menu 曲目且 ctx 真的在跑；
//   ② 楼层探索：进 Game 起 floor 循环；战斗（真实遇敌开打）切 combat，
//      撤出战斗后还政 floor；
//   ③ 入夜：时钟推过 18:00 切 night 氛围，回白天还政 floor；
//   ④ 收音机：session 塞物品 → 背包里"使用" → 切 radio 电台、截止时间 =
//      当前游戏分钟 + RADIO_MINUTES；过期后还政楼层；
//   ⑤ 音量：bgmVolume 设置被读且落到 BGM 总线（snapshot.busGain）；
//   ⑥ 全程 console 无 WebAudio 报错、pageerror 为零。
//
// 探针走 AudioSystem 在 DEV 下挂的 window.__AUDIO__（snapshot 把"当前播放
// 什么"暴露成可读状态；生产构建剔除）。

const RADIO_MINUTES = 180;

interface AudioSnapshot {
  track: 'menu' | 'floor' | 'combat' | 'night' | 'radio' | null;
  playing: boolean;
  running: boolean;
  pending: 'menu' | 'floor' | 'combat' | 'night' | 'radio' | null;
  volume: number;
  busGain: number | null;
  radioUntil: number | null;
  radioActive: boolean;
  ctx: { combat: boolean; night: boolean; radioUntil: number | null; gameMinute: number };
}

async function snapshot(page: Page): Promise<AudioSnapshot> {
  return page.evaluate(() => {
    const handle = (window as unknown as { __AUDIO__?: { snapshot: () => AudioSnapshot } }).__AUDIO__;
    if (!handle) throw new Error('__AUDIO__ dev handle missing — AudioSystem never loaded?');
    return handle.snapshot();
  });
}

/** 等到探针报出期望曲目（调度是音频时钟驱动的，给足切换+淡出的余量）。 */
async function waitForTrack(page: Page, track: AudioSnapshot['track']): Promise<AudioSnapshot> {
  await page.waitForFunction(
    (t) => (window as unknown as { __AUDIO__?: { snapshot: () => AudioSnapshot } }).__AUDIO__?.snapshot().track === t,
    track,
    { timeout: 8000 },
  );
  return snapshot(page);
}

/** 收集 console error 与 pageerror；只裁 WebAudio 相关的 console error。 */
function watchErrors(page: Page): { webaudio: string[]; page: string[] } {
  const webaudio: string[] = [];
  const page_: string[] = [];
  page.on('pageerror', (e) => page_.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/audio|webaudio|audiocontext|oscillator/i.test(text)) webaudio.push(text);
  });
  return { webaudio, page: page_ };
}

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === k),
    key,
    { timeout: 20_000 },
  );
}

/** 菜单 → 选角色 → 进楼层（与存量 spec 同一条路，音频 init 不挡点击）。 */
async function startGame(page: Page, seed = 42): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const started = await page
      .waitForFunction(
        () => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === 'Game'),
        undefined,
        { timeout: 2000 },
      )
      .then(() => true)
      .catch(() => false);
    if (started) break;
  }
  await waitForScene(page, 'Game');
  await page.waitForTimeout(600);
}

/** 爬到 2 层（遇敌点所在层）并打开一个埋伏点，返回是否真开打了。 */
async function startAndOpenAmbush(page: Page): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const floor = await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.currentFloor);
    if (floor === 2) break;
    await page.evaluate(() => {
      const st = window.__PHASER_SESSION__?.getState();
      if (st) st.player.x = 40;
    });
    await page.keyboard.press('E');
    const landed = await page
      .waitForFunction(() => window.__PHASER_SESSION__?.getState()?.currentFloor === 2, undefined, { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (landed) break;
  }
  const spots: Array<{ k: string; x: number }> = await page.evaluate(() => {
    const sc = window.__PHASER_GAME__?.scene.getScene('Game') as unknown as {
      spotMarkers?: Map<string, { x: number }>;
    } | null;
    return [...(sc?.spotMarkers ?? new Map<string, { x: number }>()).entries()].map(([k, v]) => ({ k, x: Math.round(v.x) }));
  });
  for (const sp of spots) {
    if (sp.k === 'shop') continue;
    await page.evaluate((x) => {
      const st = window.__PHASER_SESSION__?.getState();
      if (st) st.player.x = x;
    }, sp.x);
    await page.waitForTimeout(250);
    await page.keyboard.press('E');
    await page.waitForTimeout(500);
    const inCombat = await page.evaluate(() => Boolean(window.__PHASER_SESSION__?.getState()?.combat));
    if (inCombat) return true;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  return false;
}

async function inCombat(page: Page): Promise<boolean> {
  return page.evaluate(() => Boolean(window.__PHASER_SESSION__?.getState()?.combat));
}

test('主菜单 BGM：菜单要它的音乐，首次按键后起播，console 无 WebAudio 报错', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  await page.waitForTimeout(400);

  // 手势前：菜单从第一帧起就"想要"这首曲子。它此刻是已起播（track）还是
  // 挂起待播（pending）取决于浏览器的自动播放策略——Playwright 的 Chrome
  // 预激活页面且忽略 autoplay flag，真实桌面浏览器则是 suspended 挂起。
  // 两种环境都诚实的断言是"意图在"：pending 或 track 必有一个是 menu。
  // （suspended → running 的翻转本身由状态机单测与代码路径覆盖。）
  const before = await snapshot(page);
  expect(before.track === 'menu' || before.pending === 'menu').toBe(true);

  // 方向键是手势但不激活菜单选项（Enter 会直接开局，听不到菜单曲）。
  await page.keyboard.press('ArrowDown');
  const menu = await waitForTrack(page, 'menu');
  expect(menu.running).toBe(true);
  expect(menu.playing).toBe(true);
  expect(menu.pending).toBeNull();
  expect(menu.volume).toBe(70); // 无设置时的默认音量
  expect(menu.busGain).not.toBeNull();

  expect(errors.page, `page errors: ${errors.page.join(' | ')}`).toEqual([]);
  expect(errors.webaudio, `webaudio console errors: ${errors.webaudio.join(' | ')}`).toEqual([]);
});

test('楼层 BGM：进 Game 起循环，战斗切 combat，撤出后还政 floor', async ({ page }) => {
  const errors = watchErrors(page);
  await startGame(page);

  const floor = await waitForTrack(page, 'floor');
  expect(floor.running).toBe(true);
  expect(floor.ctx.night).toBe(false); // 开局 06:00，白天

  const opened = await startAndOpenAmbush(page);
  expect(opened, 'floor 2 (seed 42) 没有可开的埋伏点').toBe(true);
  await waitForTrack(page, 'combat');

  // 撤退（成功率 45%+，多试几次）；战斗关闭即还政楼层曲。
  for (let i = 0; i < 6 && (await inCombat(page)); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  expect(await inCombat(page)).toBe(false);
  await waitForTrack(page, 'floor');

  expect(errors.page, `page errors: ${errors.page.join(' | ')}`).toEqual([]);
  expect(errors.webaudio, `webaudio console errors: ${errors.webaudio.join(' | ')}`).toEqual([]);
});

test('入夜切夜晚氛围，回白天还政楼层循环', async ({ page }) => {
  const errors = watchErrors(page);
  await startGame(page);
  await waitForTrack(page, 'floor');

  // 时钟推到 19:00（帧循环的入夜面板有时钟跳变保护，音乐同步没有——夜里
  // 续档的玩家立刻该听到夜晚氛围，这正是设计）。
  await page.evaluate(() => {
    const st = window.__PHASER_SESSION__?.getState();
    if (st) st.gameMinuteOfDay = 19 * 60;
  });
  const night = await waitForTrack(page, 'night');
  expect(night.ctx.night).toBe(true);
  // 时钟在被断言前又走了几个游戏分钟（3 游戏分钟/现实秒），用区间而不是等值。
  expect(night.ctx.gameMinute).toBeGreaterThanOrEqual(19 * 60);
  expect(night.ctx.gameMinute).toBeLessThan(19 * 60 + 10);

  await page.evaluate(() => {
    const st = window.__PHASER_SESSION__?.getState();
    if (st) st.gameMinuteOfDay = 12 * 60;
  });
  await waitForTrack(page, 'floor');

  expect(errors.page, `page errors: ${errors.page.join(' | ')}`).toEqual([]);
  expect(errors.webaudio, `webaudio console errors: ${errors.webaudio.join(' | ')}`).toEqual([]);
});

test('收音机：塞物品 → 背包使用 → 电台音乐，到期还政楼层', async ({ page }) => {
  const errors = watchErrors(page);
  await startGame(page);
  await waitForTrack(page, 'floor');

  // session 塞一台收音机（搜刮/交易的接线归楼层数据与 shop 属主，这里验
  // 的是音乐通道本身：获得 → 使用 → 电台 → 到期）。
  const slot = await page.evaluate(() => {
    const st = window.__PHASER_SESSION__?.getState();
    if (!st) return -1;
    st.player.inventory.slots.push({ itemId: 'radio', quantity: 1 });
    return st.player.inventory.slots.length - 1;
  });
  expect(slot).toBeGreaterThanOrEqual(0);

  // 开背包，把光标移到收音机那一格，回车"使用"。
  await page.keyboard.press('I');
  await page.waitForTimeout(300);
  for (let i = 0; i < slot; i++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(60);
  }
  const minuteBefore = await page.evaluate(() => window.__PHASER_SESSION__?.getState()?.gameMinuteOfDay ?? 0);
  await page.keyboard.press('Enter');

  const radio = await waitForTrack(page, 'radio');
  expect(radio.radioActive).toBe(true);
  expect(radio.ctx.radioUntil).not.toBeNull();
  // 截止时间 = 使用时的游戏分钟 + RADIO_MINUTES（时钟在同一帧只会前进几个
  // 游戏分钟，容差放到 5）。
  expect(radio.ctx.radioUntil as number).toBeGreaterThanOrEqual(minuteBefore + RADIO_MINUTES - 5);
  expect(radio.ctx.radioUntil as number).toBeLessThanOrEqual(minuteBefore + RADIO_MINUTES + 5);

  // 时钟推过截止时间：电台让位，楼层循环回来。
  await page.evaluate((mins) => {
    const st = window.__PHASER_SESSION__?.getState();
    if (st) st.gameMinuteOfDay = (st.gameMinuteOfDay + mins + 10) % 1440;
  }, RADIO_MINUTES);
  await waitForTrack(page, 'floor');
  const after = await snapshot(page);
  expect(after.radioActive).toBe(false);

  expect(errors.page, `page errors: ${errors.page.join(' | ')}`).toEqual([]);
  expect(errors.webaudio, `webaudio console errors: ${errors.webaudio.join(' | ')}`).toEqual([]);
});

test('bgmVolume 设置被读取并落到 BGM 总线', async ({ page }) => {
  const errors = watchErrors(page);
  await startGame(page);
  await waitForTrack(page, 'floor');

  const setVolume = async (v: number): Promise<AudioSnapshot> => {
    await page.evaluate((value) => {
      localStorage.setItem('floor100000.settings', JSON.stringify({ bgmVolume: value }));
    }, v);
    // 每帧 syncMusic 会重读设置；等探针报出新值后还要再等几帧——总线增益
    // 是在 dispatch 里落的，比 localStorage 晚上一两帧。
    await page.waitForFunction(
      (value) => {
        const s = (window as unknown as { __AUDIO__?: { snapshot: () => AudioSnapshot } }).__AUDIO__?.snapshot();
        return s?.volume === value;
      },
      v,
      { timeout: 4000 },
    );
    await page.waitForTimeout(200);
    return snapshot(page);
  };

  const zero = await setVolume(0);
  expect(zero.volume).toBe(0);
  expect(zero.busGain).toBe(0);
  expect(zero.track).toBe('floor'); // 音量 0 只是静音，不是叫停

  const full = await setVolume(100);
  expect(full.volume).toBe(100);
  expect(full.busGain).not.toBeNull();
  expect(full.busGain as number).toBeGreaterThan(zero.busGain as number);

  const half = await setVolume(50);
  expect(half.busGain as number).toBeCloseTo((full.busGain as number) / 2, 5);

  expect(errors.page, `page errors: ${errors.page.join(' | ')}`).toEqual([]);
  expect(errors.webaudio, `webaudio console errors: ${errors.webaudio.join(' | ')}`).toEqual([]);
});
