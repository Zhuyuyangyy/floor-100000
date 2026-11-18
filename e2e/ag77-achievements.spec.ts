import { expect, test, type Page } from '@playwright/test';

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../src/core/design';

// AG-77（成就系统）实测探针（端口 5477，--workers=1）。必测项：
//   ① 真实玩法解锁：1 层搜储物柜（seed 7 固定出 净水×1+布×2 = 3 件）→
//      「大开箱」toast 弹出，位置避开圆环 HUD 板（102）与底部导航条（672）；
//   ② 刷新后不丢：成就写在独立 localStorage 键，重进页面/游戏仍在，
//      MenuScene 成就面板读得到；
//   ③ 多成就排队：一次深跳 100000 连亮六条深度成就，toast 依次弹出、
//      同屏堆叠不互相重叠；
//   ④ 爬到 2 层：楼梯真实换层，toast 车道不挡角色可读区。
// 截图落 output/ag77/（gitignore 的本地证据目录），全程 pageerror 清零。

const ACH_KEY = 'floor100000.achievements.v1';
/** HUD 板下缘（圆环行之下）与导航条上缘——toast 必须待在这条走廊里。 */
const HUD_PLATE_BOTTOM = 102;
const NAV_BAR_TOP = DESIGN_HEIGHT - 48; // 672
const TOAST_W = 384;
const TOAST_H = 64;
const TOAST_PITCH = TOAST_H + 8;

async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(
    (k) => !!window.__PHASER_GAME__?.scene.getScenes(true).some((s) => s.scene.key === k),
    key,
    { timeout: 20_000 },
  );
}

async function startGame(page: Page, seed = 42): Promise<void> {
  // AG-73：教程进行中第一下 ESC = 跳过教程（有意设计，ag73-tutorial.spec.ts
  // 钉死）——本 spec 与教程无关，开局即按约定跳过， contextual 让回世界链。
  await page.addInitScript(() => localStorage.setItem('floor100000.tutorial.skipped', '1'));
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
}

async function setX(page: Page, x: number): Promise<void> {
  await page.evaluate((v) => {
    const s = window.__PHASER_SESSION__?.getState() as { player: { x: number } } | null;
    if (s) s.player.x = v;
  }, x);
  await page.waitForTimeout(150); // 等一帧让场景的世界对象跟上
}

interface ToastBox {
  name: string;
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 场景里全部 toast 名牌（name = achievement-toast-name）及其边界。 */
async function toastNames(page: Page): Promise<Array<{ text: string } & ToastBox>> {
  return page.evaluate(() => {
    const g = window.__PHASER_GAME__;
    const scene = g?.scene.getScene('Game') as unknown as {
      children: { list: Array<{ name?: string; text?: string; visible: boolean; getBounds(): { x: number; y: number; width: number; height: number } }> };
    } | null;
    return (scene?.children.list ?? [])
      .filter((c) => c.name === 'achievement-toast-name')
      .map((c) => ({
        name: 'achievement-toast-name',
        text: c.text ?? '',
        visible: c.visible,
        x: c.getBounds().x,
        y: c.getBounds().y,
        width: c.getBounds().width,
        height: c.getBounds().height,
      }));
  });
}

/** 场景里全部 toast 底板（name = achievement-toast）的边界。 */
async function toastPlates(page: Page): Promise<ToastBox[]> {
  return page.evaluate(() => {
    const g = window.__PHASER_GAME__;
    const scene = g?.scene.getScene('Game') as unknown as {
      children: { list: Array<{ name?: string; visible: boolean; getBounds(): { x: number; y: number; width: number; height: number } }> };
    } | null;
    return (scene?.children.list ?? [])
      .filter((c) => c.name === 'achievement-toast')
      .map((c) => ({
        name: 'achievement-toast',
        visible: c.visible,
        x: c.getBounds().x,
        y: c.getBounds().y,
        width: c.getBounds().width,
        height: c.getBounds().height,
      }));
  });
}

/** dev 句柄：走 GameScene 的真实事件通路派一个成就事件。 */
async function emitAchievement(page: Page, event: Record<string, unknown>): Promise<string[]> {
  return page.evaluate((e) => window.__PHASER_ACHIEVEMENTS__?.emit(e) ?? [], event);
}

async function readUnlockedFromStorage(page: Page): Promise<string[]> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    try {
      const data = JSON.parse(raw) as { unlocked?: unknown };
      return Array.isArray(data.unlocked) ? data.unlocked.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }, ACH_KEY);
}

test.describe('AG-77 成就系统', () => {
  test('① 真实搜刮解锁 + toast 位置 + 爬到 2 层', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    // seed 7：1 层储物柜固定出 净水×1 + 布×2 = 3 件（worldgen 确定性），
    // 一次搜刮即达「单次搜刮 3 件+」。
    await startGame(page, 7);
    // 进游戏前清掉奖杯柜（此刻 GameScene 还没 create，读到的会是空档）。
    await page.evaluate((key) => window.localStorage.removeItem(key), ACH_KEY);
    expect(await readUnlockedFromStorage(page)).toEqual([]);

    // 搜储物柜（x=160）：E 起手 2s 搜刮动作，到点出货。
    await setX(page, 160);
    await page.keyboard.press('E');
    await page.waitForFunction(
      () => (window.__PHASER_SESSION__?.getState() as { visitedFloors?: Record<string, { openedContainers?: string[] }> } | null)
        ?.visitedFloors?.['1']?.openedContainers?.includes('cabinet') ?? false,
      undefined,
      { timeout: 10_000 },
    );

    // toast 弹出：名牌文本是「大开箱」。
    await page.waitForFunction(
      () => {
        const g = window.__PHASER_GAME__;
        const scene = g?.scene.getScene('Game') as unknown as {
          children: { list: Array<{ name?: string; text?: string; visible: boolean }> };
        } | null;
        return (scene?.children.list ?? []).some(
          (c) => c.name === 'achievement-toast-name' && c.text === '大开箱' && c.visible,
        );
      },
      undefined,
      { timeout: 10_000 },
    );
    await page.waitForTimeout(400); // 入场动画走完再量边界
    const plates = await toastPlates(page);
    expect(plates.length).toBeGreaterThanOrEqual(1);
    const plate = plates[0];
    // 板子几何：右上角一列，宽 384。
    expect(plate.width).toBe(TOAST_W);
    // 避开圆环 HUD 板（下缘 102）与底部导航条（上缘 672）。
    expect(plate.y).toBeGreaterThanOrEqual(HUD_PLATE_BOTTOM);
    expect(plate.y + plate.height).toBeLessThanOrEqual(NAV_BAR_TOP);
    // 不出画布右缘。
    expect(plate.x + plate.width).toBeLessThanOrEqual(DESIGN_WIDTH);
    await page.screenshot({ path: 'output/ag77/toast-floor1.png' });

    // 落盘：独立键里记着 loot_single_3。
    const unlocked = await readUnlockedFromStorage(page);
    expect(unlocked).toContain('loot_single_3');

    // 爬到 2 层（真实楼梯）：从 1 层上梯口走起。
    // 谓词的括号不能省：?? 优先级低于 <，x ?? 999 < 80 会解析成
    // x ?? (999 < 80)——x=160 时即 truthy，「等走到梯口」变成立刻通过。
    await page.keyboard.down('ArrowLeft');
    await page.waitForFunction(
      () => ((window.__PHASER_SESSION__?.getState() as { player: { x: number } } | null)?.player.x ?? 999) < 80,
      undefined,
      { timeout: 15_000 },
    );
    await page.keyboard.up('ArrowLeft');
    // 脚注必须点名上楼（E 落在梯口上，不是柜子/床）。松键后世界链还有
    // 一两帧才改口（走进 zone 与读 hint 之间差一两帧），轮询到它改口。
    await expect.poll(async () => page.evaluate(() => {
      const g = window.__PHASER_GAME__;
      const scene = g?.scene.getScene('Game') as unknown as {
        children: { list: Array<{ name?: string; text?: string }> };
      } | null;
      return (scene?.children.list ?? []).find((o) => o.name === 'hud-hint')?.text ?? '';
    }), { timeout: 5000 }).toContain('上楼');
    await page.keyboard.press('E');
    await page.waitForFunction(
      () => (window.__PHASER_SESSION__?.getState() as { currentFloor: number } | null)?.currentFloor === 2,
      undefined,
      { timeout: 10_000 },
    );
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'output/ag77/floor2.png' });
    // 2 层没有深度成就（首个里程碑在 10 层），不该弹新 toast。
    const onFloor2 = await toastNames(page);
    expect(onFloor2.filter((t) => t.visible && t.text !== '大开箱')).toEqual([]);

    expect(pageErrors).toEqual([]);
  });

  test('② 多成就排队：一次深跳连亮六条', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await startGame(page, 42);
    await page.evaluate((key) => window.localStorage.removeItem(key), ACH_KEY);

    // 一次「到达 100000 层」：六条深度里程碑（10/110/1010/10010/50010/100000）
    // 全部该亮——Steam 路过即得的语义。
    const gained = await emitAchievement(page, { type: 'floor_reached', floor: 100000 });
    expect(gained).toEqual(['depth_10', 'depth_110', 'depth_1010', 'depth_10010', 'depth_50010', 'depth_100000']);

    // 排队节流 550ms：等到第二枚也该出来了。
    await page.waitForTimeout(900);
    const plates = await toastPlates(page);
    expect(plates.length).toBeGreaterThanOrEqual(2);
    // 同屏堆叠：按 y 排序后相邻两枚恰好一个节距，互不重叠。
    const sorted = [...plates].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].y - sorted[i - 1].y).toBe(TOAST_PITCH);
      expect(sorted[i].y).toBeGreaterThanOrEqual(sorted[i - 1].y + sorted[i - 1].height);
    }
    // 全部待在 HUD 板与导航条之间的走廊里。
    for (const p of sorted) {
      expect(p.y).toBeGreaterThanOrEqual(HUD_PLATE_BOTTOM);
      expect(p.y + p.height).toBeLessThanOrEqual(NAV_BAR_TOP);
      expect(p.x + p.width).toBeLessThanOrEqual(DESIGN_WIDTH);
    }
    await page.screenshot({ path: 'output/ag77/toast-queue.png' });

    // 队列会依次放完：六枚过后存储键里一条不少。
    await page.waitForFunction(
      (key) => {
        const raw = window.localStorage.getItem(key);
        if (!raw) return false;
        try {
          const data = JSON.parse(raw) as { unlocked?: unknown };
          return Array.isArray(data.unlocked) && data.unlocked.length === 6;
        } catch {
          return false;
        }
      },
      ACH_KEY,
      { timeout: 10_000 },
    );

    expect(pageErrors).toEqual([]);
  });

  test('③ 刷新后不丢 + MenuScene 成就面板', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await startGame(page, 42);
    await page.evaluate((key) => window.localStorage.removeItem(key), ACH_KEY);
    await emitAchievement(page, { type: 'floor_reached', floor: 110 });
    await page.waitForFunction(
      (key) => (window.localStorage.getItem(key) ?? '').includes('depth_110'),
      ACH_KEY,
      { timeout: 10_000 },
    );

    // 刷新：奖杯柜必须还在（独立键，不随页面重载清空）。
    await page.reload();
    await waitForScene(page, 'Menu');
    const afterReload = await readUnlockedFromStorage(page);
    expect(afterReload).toEqual(expect.arrayContaining(['depth_10', 'depth_110']));
    const viaHandle = await page.evaluate(() => window.__PHASER_ACHIEVEMENTS__?.getUnlocked() ?? []);
    expect(viaHandle).toEqual(expect.arrayContaining(['depth_10', 'depth_110']));

    // 标题屏 → 成就面板：入口在「继续游戏」之后（有存档时 entries = 4 条）。
    // 键盘路径：↓ 两次落到「成就」，Enter 开面板。
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150); // 两次 ↓ 别落进同一帧（per-frame 输入守卫）
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    const count = await page.evaluate(() => {
      const g = window.__PHASER_GAME__;
      const scene = g?.scene.getScene('Menu') as unknown as {
        children: { list: Array<{ name?: string; text?: string; visible: boolean }> };
      } | null;
      return (scene?.children.list ?? []).find((o) => o.name === 'achievement-count' && o.visible)?.text ?? '';
    });
    expect(count).toBe('已解锁 2/14');

    // 行状态：「初露锋芒/登堂入室」已解锁，其余显示进度。
    const rows = await page.evaluate(() => {
      const g = window.__PHASER_GAME__;
      const scene = g?.scene.getScene('Menu') as unknown as {
        children: { list: Array<{ name?: string; text?: string; visible: boolean }> };
      } | null;
      const list = (scene?.children.list ?? []).filter((o) => o.visible);
      const names = list.filter((o) => o.name === 'achievement-row-name').map((o) => o.text ?? '');
      const statuses = list.filter((o) => o.name === 'achievement-row-status').map((o) => o.text ?? '');
      return { names, statuses };
    });
    expect(rows.names).toHaveLength(14);
    expect(rows.statuses[0]).toBe('已解锁'); // 初露锋芒
    expect(rows.statuses[1]).toBe('已解锁'); // 登堂入室
    expect(rows.statuses[2]).toBe('最深第 110 层'); // 深区探索者（未解锁，显示进度）
    expect(rows.statuses[6]).toBe('已制作 0 次'); // 第一件手作
    await page.screenshot({ path: 'output/ag77/menu-achievements.png' });

    // Esc 关面板，回到标题菜单。
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const stillOpen = await page.evaluate(() => {
      const g = window.__PHASER_GAME__;
      const scene = g?.scene.getScene('Menu') as unknown as {
        children: { list: Array<{ name?: string; visible: boolean }> };
      } | null;
      return (scene?.children.list ?? []).some((o) => o.name === 'achievement-row-name' && o.visible);
    });
    expect(stillOpen).toBe(false);

    expect(pageErrors).toEqual([]);
  });
});
