import { expect, test, type Page } from '@playwright/test';

// BUG-AG127-01 回归守卫：标题屏设置面板调 BGM 音量即时生效。
//
// 缺陷（AG-127 全链路 e2e 发现）：标题菜单调 bgmVolume，getSettings()/localStorage
// 立即更新，但 BGM 总线增益 busGain 卡死——bus.gain 只在 dispatch→syncFromState
// 刷新，MenuScene.update 不驱动任何 dispatch（对比 GameScene 每帧 syncMusic）。
// 修复：AudioSystem.refreshBgmBusGain()（只刷 gain 不碰曲目，避免 resolveTrackId
// 无 'menu' 分支误切 floor）+ SettingsPanelView.adjust 的 BGM 分支调用它。
//
// 本 spec 押修复后的正确行为：标题屏调 BGM → busGain 即时落到 bgm/100×0.5，
// 且曲目保持 'menu'（不被误切）。修复前此 spec 红（busGain 纹丝不动）。
//
// 端口 5246（playwright.ag127bgm.config.ts），--workers=1，--no-proxy-server。

const BGM_MASTER_GAIN = 0.5; // AudioSystem.BGM_MASTER_GAIN

interface AudioSnapshot {
  track: string | null;
  playing: boolean;
  running: boolean;
  volume: number;
  busGain: number | null;
}

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === k),
    key,
    { timeout: 20_000 },
  );
}

/** 标题菜单 → 设置面板（动态数「设置」序号，同 ag127 手法，避开成就插项错位）。 */
async function openSettingsFromTitle(page: Page): Promise<void> {
  await waitForScene(page, 'Menu');
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
    await page.waitForTimeout(60);
  }
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const scenes = window.__PHASER_GAME__?.scene.scenes ?? [];
    return scenes.some((sc) => (sc.children.list ?? []).some((o) => o.type === 'Text' && (o.text ?? '').includes('SFX 音量') && o.visible));
  }, undefined, { timeout: 10_000 });
}

/** 面板内 ↓ 到 BGM 行（marker 与选中标签同 y，同 ag127 手法）。 */
async function movePanelToBgmRow(page: Page): Promise<void> {
  for (let guard = 0; guard < 10; guard++) {
    const onRow = await page.evaluate(() => {
      const scenes = window.__PHASER_GAME__?.scene.scenes ?? [];
      for (const sc of scenes) {
        const list = (sc.children.list ?? []) as Array<{ type: string; text?: string; visible: boolean; y: number }>;
        const row = list.find((o) => o.type === 'Text' && (o.text ?? '').includes('BGM 音量') && o.visible);
        if (!row) continue;
        const marker = list.find((o) => o.type === 'Image' && o.visible && Math.abs(o.y - row.y) < 2);
        return !!marker;
      }
      return false;
    });
    if (onRow) return;
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(80);
  }
  throw new Error('面板光标未能到达 BGM 行');
}

async function audioSnapshot(page: Page): Promise<AudioSnapshot> {
  return page.evaluate(() => {
    const handle = (window as unknown as { __AUDIO__?: { snapshot: () => AudioSnapshot } }).__AUDIO__;
    if (!handle) throw new Error('__AUDIO__ dev handle missing');
    return handle.snapshot();
  });
}

/** 轮询 busGain 落到期望值（押真实 WebAudio，不押 sleep）。 */
async function waitForBusGain(page: Page, expected: number): Promise<AudioSnapshot> {
  // 容差 1e-4：WebAudio GainNode.gain.value 以 float32 存储，读回有约 1e-8
  // 量级舍入误差（实测 0.2 → 0.20000000298023224），1e-6 会误判某些值。
  await page.waitForFunction(
    (exp) => {
      const s = (window as unknown as { __AUDIO__?: { snapshot: () => AudioSnapshot } }).__AUDIO__?.snapshot();
      return s?.busGain !== null && s?.busGain !== undefined && Math.abs(s.busGain - exp) < 1e-4;
    },
    expected,
    { timeout: 8000 },
  );
  return audioSnapshot(page);
}

test.describe('BUG-AG127-01 标题屏 BGM 即时生效', () => {
  test.setTimeout(120_000);

  test('标题屏调 BGM：busGain 即时落到新值且曲目保持 menu', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    // 默认设置起：bgm=50。清掉可能的残留设置，保证初值确定。
    await page.addInitScript(() => localStorage.removeItem('floor100000.settings'));
    await page.goto('/?seed=42');
    await waitForScene(page, 'Menu');
    // 首次按键解锁音频并起菜单曲（startMenuBgm 在 create 已 wantTrack，
    // 手势 resume 后 busGain 落到默认 50×0.5=0.25）。
    await page.keyboard.press('ArrowDown');
    const initial = await waitForBusGain(page, (50 / 100) * BGM_MASTER_GAIN);
    expect(initial.track, '起播必须是菜单曲').toBe('menu');
    await page.screenshot({ path: 'output/ag127bgm/01-title-bgm-50.png' });

    await openSettingsFromTitle(page);
    await movePanelToBgmRow(page);

    // ← 三次：50→45→40→35。每步 busGain 必须即时跟随（修复前卡死 0.25）。
    for (const target of [45, 40, 35]) {
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(200); // 翻篇 MenuScene.accept 帧去重窗口
      const snap = await waitForBusGain(page, (target / 100) * BGM_MASTER_GAIN);
      expect(snap.volume, `权威音量应到 ${target}`).toBe(target);
      expect(snap.track, '调音量不得误切曲目').toBe('menu');
    }
    await page.screenshot({ path: 'output/ag127bgm/02-title-bgm-35.png' });

    // → 一次回 40，再验上行方向也即时。
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    const up = await waitForBusGain(page, (40 / 100) * BGM_MASTER_GAIN);
    expect(up.volume).toBe(40);
    expect(up.track).toBe('menu');

    // 滑到 0：busGain=0 但曲目仍是 menu（静音≠叫停，同游戏内语义）。
    // 每步等权威音量落位再按下一键——MenuScene.accept 每帧每槽只收一次，
    // 无间隔连按会被同帧去重吞掉（GHI-03 m9）。
    for (let v = 35; v >= 0; v -= 5) {
      await page.keyboard.press('ArrowLeft');
      // 实测结论：按键后需 ~200ms 让 MenuScene.accept 的帧去重窗口翻篇
      // （GHI-03 m9），再轮询音量落位。纯 expect.poll/waitForFunction 无
      // 间隔版在本环境竞态红（首次求值赶在按键处理前），200ms 版 3 轮绿。
      await page.waitForTimeout(200);
      await page.waitForFunction(
        (target) => {
          const s = (window as unknown as { __AUDIO__?: { snapshot: () => { volume: number } } }).__AUDIO__?.snapshot();
          return s?.volume === target;
        },
        v,
        { timeout: 8000 },
      );
    }
    const muted = await waitForBusGain(page, 0);
    expect(muted.volume).toBe(0);
    expect(muted.track, '静音不叫停曲目').toBe('menu');
    await page.screenshot({ path: 'output/ag127bgm/03-title-bgm-0.png' });

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });
});