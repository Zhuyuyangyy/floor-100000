import { expect, test, type Page } from '@playwright/test';

// AG-72 设置系统 e2e（playwright.ag72.config.ts，端口 5472，--workers=1）。
//
// 派工单的四条实测：
//   ① 主菜单开设置、面板七行齐整（截图）；
//   ② 音量改动即时生效——页面内拦 AudioParam 的 linearRampToValueAtTime，
//     证明 playSfx 的增益真的随 floor100000.settings 的 sfxVolume 缩放；
//     同时 localStorage 即时写入（即时持久化）；
//   ③ 重启（reload）后设置保持；
//   ④ Esc 返回。
// 另加暂停菜单「设置」入口全链路：GameScene 停场交接 -> SettingsScene ->
// 返回 Game 后模块级 GameState 不丢（currentFloor/player.x 不变）。

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === k);
    },
    key,
    { timeout: 20_000 },
  );
}

async function hasVisibleText(page: Page, substr: string): Promise<boolean> {
  return page.evaluate((sub) => {
    const scenes = (window as unknown as { __PHASER_GAME__?: { scene: { scenes: Array<{ children: { list: Array<{ type: string; text?: string; visible: boolean }> } }> } } }).__PHASER_GAME__?.scene.scenes ?? [];
    return scenes.some((sc) => (sc.children.list ?? []).some((o) => o.type === 'Text' && (o.text ?? '').includes(sub) && o.visible));
  }, substr);
}

// Exact full-string match, so a bare value like '40' is not confused with any
// longer label that happens to contain those digits.
async function hasExactVisibleText(page: Page, exact: string): Promise<boolean> {
  return page.evaluate((want) => {
    const scenes = (window as unknown as { __PHASER_GAME__?: { scene: { scenes: Array<{ children: { list: Array<{ type: string; text?: string; visible: boolean }> } }> } } }).__PHASER_GAME__?.scene.scenes ?? [];
    return scenes.some((sc) => (sc.children.list ?? []).some((o) => o.type === 'Text' && o.text === want && o.visible));
  }, exact);
}

interface StoredSettings {
  sfxVolume: number;
  bgmVolume: number;
  screenShake: boolean;
  textSpeed: string;
  language: string;
}

async function readStoredSettings(page: Page): Promise<StoredSettings | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('floor100000.settings');
    return raw === null ? null : (JSON.parse(raw) as StoredSettings);
  });
}

// 主菜单 -> 「设置」。无存档时入口是三行：开始新游戏 / 操作说明 / 设置，
// 两次下移即选中（与存量 ui.spec 的导航语义一致：设置挂在最后）。
async function openSettingsFromTitle(page: Page): Promise<void> {
  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  await page.waitForTimeout(300);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(120);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
}

async function startGame(page: Page, seed = 42): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter'); // 开始新游戏
  await waitForScene(page, 'MetaSelect');
  await page.waitForTimeout(350);
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Game');
}

test('the title menu has a 设置 entry that opens the seven-row settings panel', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  await page.waitForTimeout(300);
  expect(await hasVisibleText(page, '设置')).toBe(true);

  await page.keyboard.press('ArrowDown'); // -> 操作说明
  await page.waitForTimeout(120);
  await page.keyboard.press('ArrowDown'); // -> 设置
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  // 面板七行：五个设置项 + 恢复默认 + 返回。
  for (const label of ['SFX 音量', 'BGM 音量', '震屏', '文本速度', '语言', '恢复默认', '返回']) {
    expect(await hasVisibleText(page, label), `settings panel must list ${label}`).toBe(true);
  }
  // 默认值即时可读（还没写过 localStorage：面板读的是默认）。
  expect(await hasExactVisibleText(page, '70')).toBe(true);
  expect(await hasExactVisibleText(page, '50')).toBe(true);
  expect(await hasExactVisibleText(page, '开')).toBe(true);
  expect(await hasExactVisibleText(page, '正常')).toBe(true);
  expect(await hasExactVisibleText(page, '中文')).toBe(true);
  await page.screenshot({ path: 'e2e/screenshots/ag72-settings-title.png' });

  // Esc 返回（派工单 ④）。
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  expect(await hasVisibleText(page, 'SFX 音量')).toBe(false);
  expect(await hasVisibleText(page, '开始新游戏')).toBe(true);
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('a volume change takes effect immediately and persists across a reload', async ({ page }) => {
  await openSettingsFromTitle(page);
  // 光标默认在 SFX 音量行；下一行是 BGM。两次左移：50 -> 45 -> 40。
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(120);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(120);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(200);

  // 即时持久化：localStorage 立刻是新值（不等关闭面板/ reload）。
  const stored = await readStoredSettings(page);
  expect(stored?.bgmVolume).toBe(40);
  expect(stored?.sfxVolume).toBe(70); // 未动过的行保持默认
  expect(await hasExactVisibleText(page, '40')).toBe(true);
  await page.screenshot({ path: 'e2e/screenshots/ag72-settings-bgm40.png' });

  // 重启后保持（派工单 ③）：reload 再开面板，BGM 仍是 40。
  await openSettingsFromTitle(page);
  const afterReload = await readStoredSettings(page);
  expect(afterReload?.bgmVolume).toBe(40);
  expect(await hasExactVisibleText(page, '40')).toBe(true);

  // 恢复默认写回默认值并即时持久化。
  await page.keyboard.press('ArrowDown'); // BGM 行
  await page.waitForTimeout(60);
  await page.keyboard.press('ArrowDown'); // 震屏行
  await page.waitForTimeout(60);
  await page.keyboard.press('ArrowDown'); // 文本速度行
  await page.waitForTimeout(60);
  await page.keyboard.press('ArrowDown'); // 语言行
  await page.waitForTimeout(60);
  await page.keyboard.press('ArrowDown'); // 恢复默认
  await page.waitForTimeout(60);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  const reset = await readStoredSettings(page);
  expect(reset?.bgmVolume).toBe(50);
  expect(await hasExactVisibleText(page, '50')).toBe(true);
});

// 派工单 ② 的硬断言：playSfx 的音量不是「看起来接了」，而是真的按设置缩放。
// 做法：页面内 import 产品模块（与游戏同一实例），拦 AudioContext 的
// createGain，记录 env 增益的 linearRampToValueAtTime 峰值——click 的食谱
// 增益是 0.2，乘上 sfxVolume/100 就是应该出现的峰值。
test('playSfx scales its gain by the sfxVolume setting', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?seed=42');
  await waitForScene(page, 'Menu');
  await page.waitForTimeout(300);

  const result = await page.evaluate(async () => {
    const audioPath = '/src/render/audio.ts';
    const settingsPath = '/src/systems/SettingsSystem.ts';
    const audio = (await import(audioPath)) as {
      unlockAudio: () => void;
      playSfx: (name: string, volumeScale?: number) => void;
    };
    const settings = (await import(settingsPath)) as {
      updateSettings: (patch: { sfxVolume: number }) => unknown;
    };

    // Record every peak the envelope ramps to. Restored in the finally block.
    const peaks: number[] = [];
    const proto = AudioContext.prototype;
    const originalCreateGain = proto.createGain;
    proto.createGain = function patchedCreateGain(this: AudioContext) {
      const node = originalCreateGain.call(this);
      const param = node.gain;
      const originalRamp = param.linearRampToValueAtTime.bind(param);
      param.linearRampToValueAtTime = (value: number, endTime: number) => {
        peaks.push(value);
        return originalRamp(value, endTime);
      };
      return node;
    };
    try {
      audio.unlockAudio();
      const run = (volume: number): number => {
        peaks.length = 0;
        settings.updateSettings({ sfxVolume: volume });
        audio.playSfx('click');
        return peaks.length > 0 ? Math.max(...peaks) : -1;
      };
      const full = run(100);
      const half = run(50);
      const zeroNodeCount = ((): number => {
        peaks.length = 0;
        settings.updateSettings({ sfxVolume: 0 });
        audio.playSfx('click');
        return peaks.length;
      })();
      return { full, half, zeroNodeCount };
    } finally {
      proto.createGain = originalCreateGain;
    }
  });

  expect(result.full).toBeCloseTo(0.2, 5); // 0.2 recipe gain at 100%
  expect(result.half).toBeCloseTo(0.1, 5); // half at 50%
  expect(result.zeroNodeCount).toBe(0); // 0 is silence: no nodes at all
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the pause menu opens SettingsScene and returns to the same run', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startGame(page, 42);
  const before = await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { currentFloor: number; player: { x: number } } } }).__PHASER_SESSION__?.getState();
    return s ? { floor: s.currentFloor, x: s.player.x } : null;
  });
  expect(before).not.toBeNull();

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  expect(await hasVisibleText(page, '已暂停')).toBe(true);
  expect(await hasVisibleText(page, '设置')).toBe(true); // 暂停菜单第五项

  await page.keyboard.press('ArrowDown'); // -> 塔楼地图
  await page.waitForTimeout(100);
  await page.keyboard.press('ArrowDown'); // -> 重新开始
  await page.waitForTimeout(100);
  await page.keyboard.press('ArrowDown'); // -> 返回标题
  await page.waitForTimeout(100);
  await page.keyboard.press('ArrowDown'); // -> 设置
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  // SettingsScene：面板在，且读到的就是标题屏同款的设置存储。
  expect(await hasVisibleText(page, 'SFX 音量')).toBe(true);
  expect(await hasVisibleText(page, '恢复默认')).toBe(true);
  await page.screenshot({ path: 'e2e/screenshots/ag72-settings-pause.png' });

  // 在设置场景里改一个值，Esc 返回后应保持（同一份模块级存储）。
  await page.keyboard.press('ArrowLeft'); // SFX 音量 70 -> 65
  await page.waitForTimeout(150);
  const stored = await readStoredSettings(page);
  expect(stored?.sfxVolume).toBe(65);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 回到 Game：同一个 run，楼层与站位不变（塔楼地图同款的停场交接契约）。
  await waitForScene(page, 'Game');
  expect(await hasVisibleText(page, '已暂停')).toBe(false);
  const after = await page.evaluate(() => {
    const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { currentFloor: number; player: { x: number } } } }).__PHASER_SESSION__?.getState();
    return s ? { floor: s.currentFloor, x: s.player.x } : null;
  });
  expect(after?.floor).toBe(before?.floor);
  expect(after?.x).toBe(before?.x);
  expect(await readStoredSettings(page)).toMatchObject({ sfxVolume: 65 });
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
