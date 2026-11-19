import { expect, test, type Page } from '@playwright/test';

// AG-127 设置系统全链路 e2e（playwright.ag127.config.ts，端口 5242，--workers=1）。
//
// 链路六点（派工单）：
//   ① 键盘打开设置面板，面板显示初值 = 权威 getSettings()（默认 sfx70/bgm50）；
//   ② 键盘调 sfxVolume：面板显示 = getSettings().sfxVolume = localStorage 三点一致；
//   ③ 实际生效：拦截 AudioParam 的 linearRampToValueAtTime，证明 playSfx 的
//      增益峰值真的按新 sfxVolume 缩放（click 食谱增益 0.2 × sfx/100）；
//   ④ bgmVolume 同链路：__AUDIO__.snapshot() 的 volume/busGain 落到新值
//      （busGain = bgm/100 × BGM_MASTER_GAIN(0.5)）；
//   ⑤ 持久化：page.reload() 后 getSettings() 读回调整后的值（非默认）；
//   ⑥ 边界：越界 patch 经 sanitizeVolume 钳位 0-100，坏 JSON 回退默认。
// 全程 pageerror 清零；截图落 output/ag127/；轮询真实条件不押固定 sleep。
//
// 权威状态读取：页面内 import 产品模块 SettingsSystem（与游戏同一 Vite 模块
// 实例），getSettings/updateSettings 就是游戏自己用的那一对函数——不是旁路
// 读 localStorage 猜语义，而是直接问单一事实源。

const SETTINGS_KEY = 'floor100000.settings';
const BGM_MASTER_GAIN = 0.5; // AudioSystem.BGM_MASTER_GAIN（src/systems/AudioSystem.ts）
const CLICK_RECIPE_GAIN = 0.2; // sfxClick 的食谱增益（src/render/audio.ts）

interface Settings {
  sfxVolume: number;
  bgmVolume: number;
  screenShake: boolean;
  textSpeed: string;
  language: string;
}

interface AudioSnapshot {
  track: string | null;
  playing: boolean;
  running: boolean;
  pending: string | null;
  volume: number;
  busGain: number | null;
}

/** 等到某个场景处于活跃态（轮询真实场景列表，不押帧数）。 */
async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === k),
    key,
    { timeout: 20_000 },
  );
}

/**
 * 把游戏同一模块实例的 SettingsSystem 缓存到 window.__AG127_SETTINGS__，
 * 之后所有权威读写都经它——与游戏用的是同一对函数，不是旁路猜语义。
 * 缓存后 waitForFunction 里可同步读，避免异步谓词的轮询竞态。
 */
async function bindSettingsModule(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const w = window as unknown as {
      __AG127_SETTINGS__?: { getSettings: () => Settings; updateSettings: (p: Partial<Settings>) => Settings };
    };
    if (!w.__AG127_SETTINGS__) {
      // 路径走变量：tsc 不静态解析浏览器运行时的绝对模块路径（ag72 同款手法）。
      const settingsPath = '/src/systems/SettingsSystem.ts';
      w.__AG127_SETTINGS__ = (await import(settingsPath)) as typeof w.__AG127_SETTINGS__;
    }
  });
}

/** 权威 getSettings()：游戏同一模块实例现读。 */
async function getAuthoritative(page: Page): Promise<Settings> {
  await bindSettingsModule(page);
  return page.evaluate(() => {
    const w = window as unknown as { __AG127_SETTINGS__: { getSettings: () => Settings } };
    return w.__AG127_SETTINGS__.getSettings();
  });
}

/** 轮询权威设置到达期望值（同步谓词，押真实状态不押 sleep）。 */
async function waitForSettings(page: Page, expected: Partial<Settings>): Promise<void> {
  await bindSettingsModule(page);
  await page.waitForFunction(
    (exp) => {
      const w = window as unknown as { __AG127_SETTINGS__?: { getSettings: () => Record<string, unknown> } };
      const s = w.__AG127_SETTINGS__?.getSettings();
      if (!s) return false;
      return Object.entries(exp).every(([k, v]) => s[k] === v);
    },
    expected,
    { timeout: 8000 },
  );
}

/** localStorage 原始持久化值（第三点）。 */
async function readStored(page: Page): Promise<Settings | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as Settings);
  }, SETTINGS_KEY);
}

/** 面板上某行的值列文本：按行标签 y 坐标定位同行右侧的数值 Text。 */
async function panelRowValue(page: Page, rowLabel: string): Promise<string | null> {
  return page.evaluate((label) => {
    const scenes = window.__PHASER_GAME__?.scene.scenes ?? [];
    for (const sc of scenes) {
      const list = (sc.children.list ?? []) as Array<{
        type: string; text?: string; visible: boolean; x: number; y: number;
      }>;
      const row = list.find((o) => o.type === 'Text' && o.text === label && o.visible);
      if (!row) continue;
      // 值列与标签同一 y（行内 origin 0.5 对齐），x 在标签右侧。
      const value = list.find(
        (o) => o.type === 'Text' && o.visible && Math.abs(o.y - row.y) < 2 && o.x > row.x && /^\d+$/.test(o.text ?? ''),
      );
      return value?.text ?? null;
    }
    return null;
  }, rowLabel);
}

/**
 * 标题菜单 → 设置面板（纯键盘）。不押「下移 N 次」的硬编码序号——读菜单
 * 条目文本动态数「设置」是第几项（有无存档时条目数不同），再逐项下移并
 * 轮询选中态，避开 AG-77 插「成就」造成的历史错位类探针缺陷。
 */
async function openSettingsFromTitle(page: Page): Promise<void> {
  await waitForScene(page, 'Menu');
  // 菜单条目入场 tween 期间 marker 尚未就位；等「设置」文本可见且可数。
  await page.waitForFunction(() => {
    const scenes = window.__PHASER_GAME__?.scene.scenes ?? [];
    return scenes.some((sc) => (sc.children.list ?? []).some((o) => o.type === 'Text' && o.text === '设置' && o.visible));
  }, undefined, { timeout: 10_000 });
  const index = await page.evaluate(() => {
    const scenes = window.__PHASER_GAME__?.scene.scenes ?? [];
    for (const sc of scenes) {
      const list = (sc.children.list ?? []) as Array<{ type: string; text?: string; visible: boolean; y: number }>;
      const entries = list
        .filter((o) => o.type === 'Text' && o.visible && ['开始新游戏', '继续游戏', '成就', '操作说明', '关于', '设置'].includes(o.text ?? ''))
        .sort((a, b) => a.y - b.y);
      const i = entries.findIndex((o) => o.text === '设置');
      if (i >= 0) return i;
    }
    return -1;
  });
  expect(index, '标题菜单必须能找到「设置」条目').toBeGreaterThanOrEqual(0);
  for (let i = 0; i < index; i++) {
    await page.keyboard.press('ArrowDown');
    // 每步等一帧以上，避开同帧去重（MenuScene.accept 每帧每槽只收一次）。
    await page.waitForTimeout(60);
  }
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const scenes = window.__PHASER_GAME__?.scene.scenes ?? [];
    return scenes.some((sc) => (sc.children.list ?? []).some((o) => o.type === 'Text' && (o.text ?? '').includes('SFX 音量') && o.visible));
  }, undefined, { timeout: 10_000 });
}

/** 面板内 ↓ 到指定行（按标签文本确认到位，不押步数语义）。 */
async function movePanelToRow(page: Page, rowLabel: string): Promise<void> {
  // 光标行 = 标签被高亮的行；用「该行值列可读」+ 逐次下移后检查箭头颜色
  // 不可靠，改押行为：↓ 若干次后按 ← 看哪一行的值变化。这里用更直接的
  // 方式——读 SettingsPanelView 的 selected（面板 marker 的 y 对齐标签 y）。
  for (let guard = 0; guard < 10; guard++) {
    const onRow = await page.evaluate((label) => {
      const scenes = window.__PHASER_GAME__?.scene.scenes ?? [];
      for (const sc of scenes) {
        const list = (sc.children.list ?? []) as Array<{ type: string; text?: string; visible: boolean; x: number; y: number }>;
        const row = list.find((o) => o.type === 'Text' && o.text === label && o.visible);
        if (!row) continue;
        // marker（Image）与选中标签同 y：SettingsPanelView.refresh 里
        // placeMarker(marker, label) 把 marker 摆到选中行。
        const marker = list.find((o) => o.type === 'Image' && o.visible && Math.abs(o.y - row.y) < 2);
        return !!marker;
      }
      return false;
    }, rowLabel);
    if (onRow) return;
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(80);
  }
  throw new Error(`面板光标未能到达「${rowLabel}」行`);
}

/**
 * 菜单 → 选角色 → 进楼层（ag74 同款路）。开局即按约定跳过教程
 * （floor100000.tutorial.skipped），ESC 留给暂停菜单。
 */
async function startGame(page: Page, seed = 42): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('floor100000.tutorial.skipped', '1'));
  await page.goto(`/?seed=${seed}`);
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter'); // 开始新游戏
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
}

/**
 * GameScene 暂停菜单 → 设置（SettingsScene）。暂停菜单六项：继续游戏 /
 * 塔楼地图 / 重新开始 / 返回标题 / 设置 / 本局统计——「设置」index 4，
 * 四次下移。SettingsScene 是独立场景（GameScene 停场交接），面板同款。
 */
async function openSettingsFromPause(page: Page): Promise<void> {
  await page.keyboard.press('Escape'); // 开暂停菜单
  await page.waitForFunction(() => {
    const scenes = window.__PHASER_GAME__?.scene.scenes ?? [];
    return scenes.some((sc) => (sc.children.list ?? []).some((o) => o.type === 'Text' && o.text === '已暂停' && o.visible));
  }, undefined, { timeout: 8000 });
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(80);
  }
  await page.keyboard.press('Enter'); // -> SettingsScene
  await waitForScene(page, 'Settings');
  await page.waitForFunction(() => {
    const scenes = window.__PHASER_GAME__?.scene.scenes ?? [];
    return scenes.some((sc) => (sc.children.list ?? []).some((o) => o.type === 'Text' && (o.text ?? '').includes('SFX 音量') && o.visible));
  }, undefined, { timeout: 8000 });
}

/**
 * 页面加载前装 AudioParam 峰值记录器（addInitScript）：拦 createGain，记 env
 * 的 ramp 峰值。必须在任何音频创建之前装——SFX 总线 master 在首次 keydown
 * （main.ts 全局 unlock）就建好，装晚了会错过它的「身份嗅探」窗口。
 *
 * 只收 SFX 上下文（render/audio.ts）的节点，排除 BGM 上下文（AudioSystem）——
 * 两条音频链各有独立 AudioContext，BGM 调度器在后台持续排音符，若不分上下文，
 * 菜单 BGM 的 ramp 会混进 SFX 峰值（尤其 sfx=0 的「零节点」断言会被 BGM 撞红）。
 * 识别法：SFX 总线 master 增益恒为 0.4（MASTER_GAIN），是 SFX ctx 里第一个
 * 直连 destination 的 gain；BGM 总线增益 = bgm/100×0.5，默认 0.25 ≠ 0.4。
 * 用 WeakSet 按 ctx 打标：某 ctx 出现「gain.value≈0.4 且 connect(destination)」
 * 的节点即判为 SFX ctx，其后该 ctx 的 env 节点才记峰值。
 */
async function installGainRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __ag127Peaks__?: number[] };
    w.__ag127Peaks__ = [];
    const sfxContexts = new WeakSet<AudioContext>();
    const proto = AudioContext.prototype;
    const originalCreateGain = proto.createGain;
    proto.createGain = function patched(this: AudioContext) {
      const node = originalCreateGain.call(this);
      const ctx = this;
      // 嗅探 SFX 总线：gain≈0.4 且直连 destination。包一层 connect 来判定。
      const originalConnect = node.connect.bind(node) as (dest: AudioNode | AudioParam) => AudioNode;
      (node as unknown as { connect: (dest: AudioNode | AudioParam) => AudioNode }).connect = (
        dest: AudioNode | AudioParam,
      ) => {
        if (
          Math.abs(node.gain.value - 0.4) < 1e-6 &&
          dest instanceof AudioNode &&
          dest === dest.context.destination
        ) {
          sfxContexts.add(ctx);
        }
        return originalConnect(dest);
      };
      const param = node.gain;
      const originalRamp = param.linearRampToValueAtTime.bind(param);
      param.linearRampToValueAtTime = (value: number, endTime: number) => {
        if (sfxContexts.has(ctx)) w.__ag127Peaks__!.push(value);
        return originalRamp(value, endTime);
      };
      return node;
    };
  });
}

async function drainPeaks(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __ag127Peaks__?: number[] };
    const peaks = [...(w.__ag127Peaks__ ?? [])];
    if (w.__ag127Peaks__) w.__ag127Peaks__!.length = 0;
    return peaks;
  });
}

async function audioSnapshot(page: Page): Promise<AudioSnapshot> {
  return page.evaluate(() => {
    const handle = (window as unknown as { __AUDIO__?: { snapshot: () => AudioSnapshot } }).__AUDIO__;
    if (!handle) throw new Error('__AUDIO__ dev handle missing');
    return handle.snapshot();
  });
}

/** 等 BGM 总线增益落到期望值（轮询真实 WebAudio 状态）。 */
async function waitForBusGain(page: Page, expected: number): Promise<AudioSnapshot> {
  await page.waitForFunction(
    (exp) => {
      const s = (window as unknown as { __AUDIO__?: { snapshot: () => AudioSnapshot } }).__AUDIO__?.snapshot();
      return s?.busGain !== null && s?.busGain !== undefined && Math.abs(s.busGain - exp) < 1e-6;
    },
    expected,
    { timeout: 8000 },
  );
  return audioSnapshot(page);
}

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

// ── ① + ② + ③：SFX 全链路（面板 → 权威 → 存储 → 真实增益） ─────────────────

test('①②③ SFX：键盘开面板读初值，←调整三点一致，增益真按新值缩放', async ({ page }) => {
  const errors = watchPageErrors(page);
  // 记录器必须在 goto 前装（addInitScript）：SFX master 在首次按键即创建。
  await installGainRecorder(page);
  await page.goto('/?seed=42');
  await openSettingsFromTitle(page);

  // ① 初值三点一致：面板显示 = 权威 getSettings() = 默认 70/50。
  const auth0 = await getAuthoritative(page);
  expect(auth0.sfxVolume).toBe(70);
  expect(auth0.bgmVolume).toBe(50);
  expect(await panelRowValue(page, 'SFX 音量')).toBe('70');
  expect(await panelRowValue(page, 'BGM 音量')).toBe('50');
  await page.screenshot({ path: 'output/ag127/01-panel-defaults.png' });

  // 光标默认在 SFX 行（第 0 行）。← 三次：70→65→60→55。
  // 面板 adjust() 每次以新音量播一声 click——峰值就是「实际生效」的证据。
  const expectedSteps = [65, 60, 55];
  for (const expected of expectedSteps) {
    await drainPeaks(page); // 清掉上一轮的峰值，本轮只收这一声 click
    await page.keyboard.press('ArrowLeft');
    // ② 三点一致：轮询权威值到位（即时持久化，无需等关闭面板）。
    await waitForSettings(page, { sfxVolume: expected });
    expect(await panelRowValue(page, 'SFX 音量')).toBe(String(expected));
    const stored = await readStored(page);
    expect(stored?.sfxVolume).toBe(expected);
    expect(stored?.bgmVolume).toBe(50); // 未动的行保持
    // ③ 实际生效：这一声 click 的 env 峰值 = 0.2 × expected/100。
    const peaks = await drainPeaks(page);
    expect(peaks.length, '调整音量应触发一声 click 试听').toBeGreaterThan(0);
    const peak = Math.max(...peaks);
    expect(peak).toBeCloseTo(CLICK_RECIPE_GAIN * (expected / 100), 5);
  }
  await page.screenshot({ path: 'output/ag127/02-sfx-55.png' });

  // 滑到 0：playSfx 静音不排节点（零增益路径）。55 → 0 需 11 次 ←。
  await movePanelToRow(page, 'SFX 音量');
  for (let i = 0; i < 11; i++) {
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(60);
  }
  await waitForSettings(page, { sfxVolume: 0 });
  expect(await panelRowValue(page, 'SFX 音量')).toBe('0');
  await drainPeaks(page);
  await page.keyboard.press('ArrowLeft'); // 已在 0：adjust 直接 return，不播不写
  await page.waitForTimeout(150);
  expect((await drainPeaks(page)).length).toBe(0); // 0 是静默：一个节点都不排
  expect((await getAuthoritative(page)).sfxVolume).toBe(0);
  await page.screenshot({ path: 'output/ag127/03-sfx-0-silent.png' });

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── ④：BGM 全链路（面板 → 权威 → 存储 → 总线增益） ──────────────────────────

// 走游戏内路径（暂停菜单 → SettingsScene）而非标题屏：
//   * GameScene 每帧 syncMusic，BGM 总线随设置刷新——这是音量「实际生效」
//     的真实宿主。进 SettingsScene 时 GameScene 停场 stopBgm（音乐本就停了），
//     调完 ESC 回 Game，startFloorMusic 按新音量起播，busGain 落到新值。
//   * 标题屏 MenuScene 不每帧 syncMusic，调 BGM 只写设置不落总线（产品 bug，
//     见 REPORT，只记录不修）——所以即时生效断言押游戏内路径，不押标题屏。
test('④ BGM：游戏内面板调整三点一致，回 Game 总线增益真按新值缩放', async ({ page }) => {
  const errors = watchPageErrors(page);
  await startGame(page);
  // 楼层曲起播，默认 50 → busGain 0.25。
  const floor0 = await waitForBusGain(page, (50 / 100) * BGM_MASTER_GAIN);
  expect(floor0.track).toBe('floor');

  // 暂停 → SettingsScene，BGM 50→40（← 两次）。三点一致在面板内即成立。
  await openSettingsFromPause(page);
  await movePanelToRow(page, 'BGM 音量');
  for (const expected of [45, 40]) {
    await page.keyboard.press('ArrowLeft');
    await waitForSettings(page, { bgmVolume: expected });
    expect(await panelRowValue(page, 'BGM 音量')).toBe(String(expected));
    expect((await readStored(page))?.bgmVolume).toBe(expected);
    expect((await getAuthoritative(page)).sfxVolume).toBe(70); // SFX 未动
  }
  await page.screenshot({ path: 'output/ag127/04-bgm-40-panel.png' });

  // ESC 回 Game：startFloorMusic 读新音量起播，busGain = 40/100 × 0.5 = 0.2。
  await page.keyboard.press('Escape');
  await waitForScene(page, 'Game');
  const back40 = await waitForBusGain(page, (40 / 100) * BGM_MASTER_GAIN);
  expect(back40.volume).toBe(40);
  expect(back40.track).toBe('floor');
  await page.screenshot({ path: 'output/ag127/04-bgm-40-bus.png' });

  // 每帧 syncMusic 的活证据：游戏内直接写存储，总线随帧刷新（ag74 同款手法）。
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ bgmVolume: 60 })), SETTINGS_KEY);
  const live60 = await waitForBusGain(page, (60 / 100) * BGM_MASTER_GAIN);
  expect(live60.volume).toBe(60);

  // 边界 0：静音但曲目不停（volume 0 ≠ stop）。再回 100：满增益 0.5。
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ bgmVolume: 0 })), SETTINGS_KEY);
  const zero = await waitForBusGain(page, 0);
  expect(zero.volume).toBe(0);
  expect(zero.track).toBe('floor'); // 0 只是静音，不是叫停
  await page.screenshot({ path: 'output/ag127/05-bgm-0-muted.png' });

  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ bgmVolume: 100 })), SETTINGS_KEY);
  const full = await waitForBusGain(page, BGM_MASTER_GAIN);
  expect(full.volume).toBe(100);
  expect(full.busGain).toBeCloseTo(BGM_MASTER_GAIN, 5);

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── ⑤：持久化——reload 后读回非默认值 ───────────────────────────────────────

test('⑤ 持久化：调整后 reload，getSettings 读回非默认值且面板显示一致', async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto('/?seed=42');
  await openSettingsFromTitle(page);

  // SFX 70→55（← 三次），BGM 50→35（↓ 一行后 ← 三次）。
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(60);
  }
  await movePanelToRow(page, 'BGM 音量');
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(60);
  }
  await waitForSettings(page, { sfxVolume: 55, bgmVolume: 35 });
  await page.screenshot({ path: 'output/ag127/06-before-reload.png' });

  // 真 reload：整个页面重建，模块状态清零，只剩 localStorage。
  await page.reload();
  await waitForScene(page, 'Menu');
  const after = await getAuthoritative(page);
  expect(after.sfxVolume).toBe(55); // 非默认 70
  expect(after.bgmVolume).toBe(35); // 非默认 50
  expect(after.sfxVolume).not.toBe(70);
  expect(after.bgmVolume).not.toBe(50);

  // 面板重开显示的也是读回值（UI 与权威同源）。
  await openSettingsFromTitle(page);
  expect(await panelRowValue(page, 'SFX 音量')).toBe('55');
  expect(await panelRowValue(page, 'BGM 音量')).toBe('35');
  // BGM 总线在 reload 后也按读回值起播。
  await waitForBusGain(page, (35 / 100) * BGM_MASTER_GAIN);
  await page.screenshot({ path: 'output/ag127/07-after-reload.png' });

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

// ── ⑥：边界——越界 patch 钳位、坏 JSON 回退 ─────────────────────────────────

test('⑥ 边界：越界 patch 被 sanitize 钳位 0-100，坏 JSON 回退默认', async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');

  // 权威 updateSettings 注入越界值：>100 钳到 100，<0 钳到 0，小数四舍五入。
  const clampResult = await page.evaluate(async () => {
    const settingsPath = '/src/systems/SettingsSystem.ts';
    const mod = (await import(settingsPath)) as {
      updateSettings: (patch: Partial<Settings>) => Settings;
      getSettings: () => Settings;
    };
    const over = mod.updateSettings({ sfxVolume: 250, bgmVolume: 9000 });
    const under = mod.updateSettings({ sfxVolume: -40, bgmVolume: -1 });
    const frac = mod.updateSettings({ sfxVolume: 62.7, bgmVolume: 33.2 });
    const nan = mod.updateSettings({ sfxVolume: Number.NaN, bgmVolume: Number.POSITIVE_INFINITY });
    return { over, under, frac, nan, readBack: mod.getSettings() };
  });
  expect(clampResult.over.sfxVolume).toBe(100);
  expect(clampResult.over.bgmVolume).toBe(100);
  expect(clampResult.under.sfxVolume).toBe(0);
  expect(clampResult.under.bgmVolume).toBe(0);
  expect(clampResult.frac.sfxVolume).toBe(63); // round(62.7)
  expect(clampResult.frac.bgmVolume).toBe(33); // round(33.2)
  // NaN/Infinity 不是有限数：回退当前值（63/33），不是默认也不是 0。
  expect(clampResult.nan.sfxVolume).toBe(63);
  expect(clampResult.nan.bgmVolume).toBe(33);
  expect(clampResult.readBack.sfxVolume).toBe(63);
  expect(clampResult.readBack.bgmVolume).toBe(33);
  // 钳位后的值确实持久化了（存储里也是钳位值，不是越界原值）。
  const stored = await readStored(page);
  expect(stored?.sfxVolume).toBe(63);
  expect(stored?.bgmVolume).toBe(33);

  // 面板 UI 的 ←/→ 也钳位：SFX 拉到 100 再 → 不动，拉到 0 再 ← 不动。
  await openSettingsFromTitle(page);
  await movePanelToRow(page, 'SFX 音量');
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('ArrowRight'); // 63→…→100（8 步到顶，多余 2 步空转）
    await page.waitForTimeout(60);
  }
  await waitForSettings(page, { sfxVolume: 100 });
  await page.keyboard.press('ArrowRight'); // 已到 100：不动
  await page.waitForTimeout(120);
  expect((await getAuthoritative(page)).sfxVolume).toBe(100);
  expect(await panelRowValue(page, 'SFX 音量')).toBe('100');
  await page.screenshot({ path: 'output/ag127/08-clamp-100.png' });

  // 坏 JSON：整份回退默认（getSettings 从不抛）。
  await page.evaluate((key) => localStorage.setItem(key, '{broken json!!'), SETTINGS_KEY);
  const broken = await getAuthoritative(page);
  expect(broken.sfxVolume).toBe(70);
  expect(broken.bgmVolume).toBe(50);
  expect(broken.screenShake).toBe(true);

  // 坏字段逐项回退：一个写坏的 textSpeed 不该重置玩家调好的音量。
  await page.evaluate((key) => {
    localStorage.setItem(key, JSON.stringify({ sfxVolume: 88, bgmVolume: 22, textSpeed: 'warp', language: 'xx' }));
  }, SETTINGS_KEY);
  const partial = await getAuthoritative(page);
  expect(partial.sfxVolume).toBe(88); // 好字段保留
  expect(partial.bgmVolume).toBe(22);
  expect(partial.textSpeed).toBe('normal'); // 坏字段回退默认
  expect(partial.language).toBe('zh');

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
