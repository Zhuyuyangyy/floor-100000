import { expect, test, type Page } from '@playwright/test';

// AG-65（楼层几何）实测探针。端口 5465 专用 config，--workers=1。
//
// 用户 2026-11-17 原话逐条兑现的实测：
//   ① 连爬：tier1（1-5 层）保持现值 4 房 1280；tier2+ 每层长度不同
//   ② 梯子位置在不同层不同 x（下行口 tier2+ 中段随机；上行口恒 40 是存量
//      测试钉死的，见 src/tests/floorGeometry.test.ts 的说明）
//   ③ 同层重进，梯子还在原地（爬上去再爬回来，口位不变）
//   ④ 洞/中梯出现了（截图落 output/ag65/）
//   ⑤ NPC 在动（前后两帧 x 不同）
//
// 截图落 output/ag65/（gitignore 的本地证据目录）。

interface FloorGeo {
  floor: number;
  width: number;
  rooms: number;
  upX: number;
  downX: number;
  holeX: number | null;
  midLadderX: number | null;
}

async function startRun(page: Page, seed = 42): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await page.waitForFunction(() => {
    const g = window.__PHASER_GAME__;
    return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Menu');
  }, undefined, { timeout: 30_000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const g = window.__PHASER_GAME__;
    return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'MetaSelect' || s.scene.key === 'Game');
  }, undefined, { timeout: 30_000 });
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const started = await page.waitForFunction(() => {
      const g = window.__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
    }, undefined, { timeout: 2000 }).then(() => true).catch(() => false);
    if (started) break;
  }
  await page.waitForFunction(() => {
    const g = window.__PHASER_GAME__;
    return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
  }, undefined, { timeout: 10_000 });
}

async function readState(page: Page): Promise<{ currentFloor: number; x: number }> {
  return page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) throw new Error('no session state');
    return { currentFloor: s.currentFloor, x: s.player.x };
  });
}

/** GameScene 的楼层几何（floorGeo 字段，drawFloor 每层重设）。 */
async function readGeo(page: Page): Promise<FloorGeo> {
  return page.evaluate(() => {
    const g = (window.__PHASER_GAME__ as unknown as {
      scene: { getScene: (k: string) => { floorGeo?: FloorGeo; downExit?: number } | null };
    }).scene.getScene('Game');
    const geo = g?.floorGeo;
    if (!geo) throw new Error('no floorGeo on the Game scene');
    return { ...geo };
  });
}

async function hudText(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const scene = window.__PHASER_GAME__?.scene.getScene('Game');
    const obj = scene?.children.list.find((o) => (o as unknown as { name?: string }).name === n);
    return (obj as unknown as { text?: string } | undefined)?.text ?? '';
  }, name);
}

/** 按住方向键直到玩家 x 越过 target，再松键。 */
async function walkUntil(page: Page, key: 'ArrowLeft' | 'ArrowRight', targetX: number, past: boolean): Promise<void> {
  await page.keyboard.down(key);
  try {
    await page.waitForFunction(
      ({ t, p }) => {
        const s = window.__PHASER_SESSION__?.getState();
        if (!s) return false;
        return p ? s.player.x > t : s.player.x < t;
      },
      { t: targetX, p: past },
      { timeout: 30_000 },
    );
  } finally {
    await page.keyboard.up(key);
  }
}

async function walkToUpExit(page: Page): Promise<void> {
  await walkUntil(page, 'ArrowLeft', 44, false);
}

/** 走到本层真实下行口（场景的 downExit 字段，tier2+ 是随机口位）内 20px。 */
async function walkToDownExit(page: Page): Promise<void> {
  const downX = await page.evaluate(() => {
    const g = (window.__PHASER_GAME__ as unknown as { scene: { getScene: (k: string) => { downExit?: number } | null } }).scene.getScene('Game');
    return g?.downExit ?? 1240;
  });
  await walkUntil(page, 'ArrowRight', downX - 20, true);
}

/** 在上行口按 E 并等这一层爬完，重试一次丢键。 */
async function climbOne(page: Page, from: number): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const hint = await hudText(page, 'hud-hint');
    expect(hint, `climbing from ${from}: the hint must offer the stairs`).toContain('上楼');
    await page.keyboard.press('E');
    const landed = await page
      .waitForFunction((f) => (window.__PHASER_SESSION__?.getState()?.currentFloor ?? -1) === f + 1, from, { timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (landed) return;
  }
  throw new Error(`climb from floor ${from} never committed`);
}

/** 在下行口按 E 并等这一层下完。 */
async function descendOne(page: Page, from: number): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const hint = await hudText(page, 'hud-hint');
    expect(hint, `descending from ${from}: the hint must offer the stairs`).toContain('下楼');
    await page.keyboard.press('E');
    const landed = await page
      .waitForFunction((f) => (window.__PHASER_SESSION__?.getState()?.currentFloor ?? -1) === f - 1, from, { timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (landed) return;
  }
  throw new Error(`descent from floor ${from} never committed`);
}

/** 发通行证、乘电梯跨段，到站补满状态防饿死。 */
async function rideLiftUp(page: Page, pass: string, from: number, to: number): Promise<void> {
  await page.evaluate((p) => {
    const s = window.__PHASER_SESSION__?.getState();
    const up = (s?.player as unknown as { homeUpgrades: string[] } | undefined)?.homeUpgrades;
    if (up && !up.includes(p)) up.push(p);
  }, pass);
  // 电梯走位用 setX 而不是按住右键微调：跨段只是本次验证的桥，走位抖动
  // （键抬起延迟把角色带过 1195 窗口）会让脚注读错——npc/firstChapter 两个
  // spec 同样用 setX 定位，仓库既有手法。
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (s) s.player.x = 1165; // LIFT_X
  });
  await page.waitForTimeout(120);
  const hint = await hudText(page, 'hud-hint');
  expect(hint, `lift at ${from}: the hint must offer the freight lift`).toContain('货运电梯');
  await page.keyboard.press('E');
  await page.waitForFunction((t) => (window.__PHASER_SESSION__?.getState()?.currentFloor ?? -1) === t, to, { timeout: 15_000 });
  await page.evaluate(() => {
    const s = window.__PHASER_SESSION__?.getState();
    if (!s) return;
    s.player.hp = 100;
    s.player.hunger = 100;
    s.player.thirst = 100;
    s.player.energy = 100;
  });
}

async function npcSpriteX(page: Page, npcId: string): Promise<number | null> {
  return page.evaluate((id) => {
    const g = (window.__PHASER_GAME__ as unknown as {
      scene: { getScene: (k: string) => { npcObjs?: Map<string, { sprite: { x: number } }> } | null };
    }).scene.getScene('Game');
    const rec = g?.npcObjs?.get(id);
    return rec ? Math.round(rec.sprite.x * 10) / 10 : null;
  }, npcId);
}

test.describe('AG-65 楼层几何实测', () => {
  test('连爬：tier1 保持现值，tier2+ 每层长度不同、梯口不同 x', async ({ page }) => {
    test.setTimeout(180_000);
    await startRun(page);

    const seen: FloorGeo[] = [];

    await walkToUpExit(page);
    for (let f = 1; f <= 10; f++) {
      const geo = await readGeo(page);
      seen.push(geo);
      // 当场截图：爬到有洞的层就拍（循环结束后拍只会拍到终点层）。
      if (geo.holeX !== null) await page.screenshot({ path: `output/ag65/hole-floor${geo.floor}.png` });
      if (geo.midLadderX !== null) await page.screenshot({ path: `output/ag65/midLadder-floor${geo.floor}.png` });
      if (f < 10) await climbOne(page, f);
    }
    // 1-10：基础发育区现值——4 房 1280，下行口仍在右端 1240。
    const tier1 = seen.filter((g) => g.floor <= 10);
    expect(tier1.length).toBe(10);
    for (const g of tier1) {
      expect({ floor: g.floor, rooms: g.rooms, width: g.width, downX: g.downX, upX: g.upX })
        .toEqual({ floor: g.floor, rooms: 4, width: 1280, downX: 1240, upX: 40 });
    }
    // 9/10 层有楼板洞（当前推导：464 / 744）——上面循环里当场截了。
    expect(seen.some((g) => g.holeX !== null), 'floors 1-10 里至少一层有楼板洞').toBeTruthy();

    await rideLiftUp(page, 'work_badge', 10, 100);
    await walkToUpExit(page);
    for (let f = 100; f <= 105; f++) {
      const geo = await readGeo(page);
      seen.push(geo);
      if (geo.midLadderX !== null) await page.screenshot({ path: `output/ag65/midLadder-floor${geo.floor}.png` });
      if (geo.holeX !== null) await page.screenshot({ path: `output/ag65/hole-floor${geo.floor}.png` });
      if (f < 105) await climbOne(page, f);
    }
    const tier2 = seen.filter((g) => g.floor >= 100 && g.floor <= 105);
    expect(tier2.length).toBe(6);

    // ① 每层长度不同：段内至少三种层长，且全都不是 tier1 的 1280。
    const widths = new Set(tier2.map((g) => g.width));
    expect(widths.size, `tier2 widths: ${[...widths].join(',')}`).toBeGreaterThanOrEqual(3);
    for (const g of tier2) expect(g.width, `floor ${g.floor} width`).toBeGreaterThan(1280);

    // ② 梯子位置在不同层不同 x：下行口多数互不相同；上行口恒 40（存量测试钉死）。
    const downXs = tier2.map((g) => g.downX);
    expect(new Set(downXs).size, `tier2 down exits: ${downXs.join(',')}`).toBeGreaterThanOrEqual(4);
    for (const g of tier2) expect(g.upX).toBe(40);
    // 口位在层内中段，不在两端。
    for (const g of tier2) {
      expect(g.downX, `floor ${g.floor} downX in band`).toBeGreaterThanOrEqual(g.width * 0.3);
      expect(g.downX, `floor ${g.floor} downX in band`).toBeLessThanOrEqual(g.width * 0.75);
    }

    // ④ 中梯出现（当前推导：100/101 层有）——上面循环里当场截了。
    expect(seen.filter((g) => g.floor >= 100).some((g) => g.midLadderX !== null), '100-105 里至少一层有中梯').toBeTruthy();

    await page.screenshot({ path: 'output/ag65/tier2-wide-floor.png' });
    // 实测记录进报告附件：逐层几何表。
    console.log('AG65-GEO ' + JSON.stringify(seen));
  });

  test('同层重进：爬上去再爬回来，梯子还在原地', async ({ page }) => {
    test.setTimeout(120_000);
    await startRun(page);
    await walkToUpExit(page);
    for (let f = 1; f <= 9; f++) await climbOne(page, f); // 爬到第 10 层乘电梯
    await rideLiftUp(page, 'work_badge', 10, 100);
    await walkToUpExit(page);
    await climbOne(page, 100); // 落到 101

    const before = await readGeo(page);
    expect(before.floor).toBe(101);
    await climbOne(page, 101); // 上到 102
    const on102 = await readGeo(page);
    expect(on102.floor).toBe(102);
    await walkToDownExit(page);
    await descendOne(page, 102); // 回 101
    const after = await readGeo(page);
    expect(after.floor).toBe(101);

    // 同层重进，口位不变（seeded 楼层号派生，不随每次 generateFloor 变）。
    expect(after.downX, 'floor 101 downX after the round trip').toBe(before.downX);
    expect(after.width).toBe(before.width);
    expect(after.upX).toBe(before.upX);
    // 且落点就在本层下行口正下方（竖井起止同 x）。
    expect((await readState(page)).x, 'landing x equals the shaft x').toBe(on102.downX);
    await page.screenshot({ path: 'output/ag65/round-trip-floor101.png' });
  });

  test('像素取证：洞与中梯画在 seeded 位置（绘制矩形 + 画面亮度）', async ({ page }) => {
    test.setTimeout(180_000);
    await startRun(page);
    await walkToUpExit(page);
    for (let f = 1; f <= 8; f++) await climbOne(page, f); // 停在第 9 层（有洞）
    // 等相机落位：落地缓动 220ms + follow 阻尼，瞬态帧里天花板还在 HUD 板后面。
    await page.waitForTimeout(800);
    // 第 9 层有楼板洞（seeded x=464）。
    const geo9 = await readGeo(page);
    expect(geo9.floor).toBe(9);
    expect(geo9.holeX).toBe(464);

    const rects = await page.evaluate(() => {
      const g = (window.__PHASER_GAME__ as unknown as {
        scene: { getScene: (k: string) => { floorFeatureRects?: { hole: [number, number, number, number] | null; ladder: [number, number, number, number] | null } } | null };
      }).scene.getScene('Game');
      return g?.floorFeatureRects ?? null;
    });
    expect(rects, 'floorFeatureRects exposed').not.toBeNull();
    if (!rects?.hole) throw new Error('floor 9 hole rect missing');
    // 画出来的矩形中心 = seeded 洞口（56px 宽，天花板 y 1..8）。
    expect(rects.hole[0] + rects.hole[2] / 2, 'hole rect centre x').toBe(geo9.holeX);
    expect(rects.ladder, 'floor 9 has no mid ladder').toBeNull();

    // 亮度取证：洞是暖光方块，天花板别处是近黑——同一行上采样对比。
    // 采样按当前相机实时折算屏幕坐标（探针内部读 cam.scrollX/scrollY）。
    const probe = await page.evaluate(async (holeX: number) => {
      const game = window.__PHASER_GAME__ as unknown as {
        renderer: { snapshot: (cb: (img: HTMLImageElement) => void) => void };
        scene: { getScene: (k: string) => { cameras: { main: { scrollX: number; scrollY: number; zoom: number; width: number; height: number } } } | null };
        canvas: HTMLCanvasElement;
      };
      const scene = game.scene.getScene('Game');
      if (!scene) throw new Error('no Game scene');
      const cam = scene.cameras.main;
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('snapshot timeout')), 8000);
        game.renderer.snapshot((snap) => {
          clearTimeout(timer);
          resolve(snap);
        });
      });
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('no 2d ctx');
      ctx.drawImage(img, 0, 0);
      const scaleX = img.width / cam.width;
      const scaleY = img.height / cam.height;
      const sample = (wx: number, wy: number): number => {
        const x = Math.round((wx - cam.scrollX) * cam.zoom * scaleX);
        const y = Math.round((wy - cam.scrollY) * cam.zoom * scaleY);
        const d = ctx.getImageData(Math.max(0, Math.min(img.width - 1, x)), Math.max(0, Math.min(img.height - 1, y)), 1, 1).data;
        return d[0] + d[1] + d[2];
      };
      // 天花板带 y≈1..8；控制点取同层无洞处（同一条天花板，右侧 200px）。
      return { hole: sample(holeX, 4), control: sample(holeX + 200, 4) };
    }, geo9.holeX!);
    expect(probe.hole, 'hole patch is bright').toBeGreaterThan(probe.control + 80);

    // 上行爬过洞：爬梯态洞口透出目标层地板（截图取证）。
    await page.keyboard.press('E');
    await page.waitForTimeout(450);
    await page.screenshot({ path: 'output/ag65/hole-reveal-climb-9to10.png' });
    await page.waitForFunction(() => (window.__PHASER_SESSION__?.getState()?.currentFloor ?? -1) === 10, undefined, { timeout: 8000 });

    // 第 100 层有中梯（seeded x=672）。
    await rideLiftUp(page, 'work_badge', 10, 100);
    const geo100 = await readGeo(page);
    expect(geo100.floor).toBe(100);
    expect(geo100.midLadderX).toBe(672);
    const rects100 = await page.evaluate(() => {
      const g = (window.__PHASER_GAME__ as unknown as {
        scene: { getScene: (k: string) => { floorFeatureRects?: { hole: [number, number, number, number] | null; ladder: [number, number, number, number] | null } } | null };
      }).scene.getScene('Game');
      return g?.floorFeatureRects ?? null;
    });
    expect(rects100?.ladder, 'floor 100 ladder rect').not.toBeNull();
    if (rects100?.ladder) {
      // 梯心 = seeded 位置（52px 宽的隔间口，墙根 y = FLOOR_HEIGHT-60 .. +4）。
      expect(rects100.ladder[0] + rects100.ladder[2] / 2, 'ladder rect centre x').toBe(geo100.midLadderX);
    }
    await page.screenshot({ path: 'output/ag65/midLadder-floor100.png' });
  });

  test('NPC 在动：阿林与小周实时散步（前后帧 x 不同）', async ({ page }) => {
    test.setTimeout(120_000);
    await startRun(page);
    // 1 → 2：邻居宿舍层（阿林 + 小周）。
    await walkToUpExit(page);
    await climbOne(page, 1);
    expect((await readState(page)).currentFloor).toBe(2);
    await page.waitForTimeout(500);

    const samples: Record<string, number[]> = { alin: [], xiaozhou: [] };
    for (let i = 0; i < 45; i++) {
      for (const id of ['alin', 'xiaozhou']) {
        const x = await npcSpriteX(page, id);
        if (x !== null) samples[id].push(x);
      }
      await page.waitForTimeout(110);
    }
    for (const id of ['alin', 'xiaozhou']) {
      const xs = samples[id];
      expect(xs.length, `${id} was on screen`).toBeGreaterThan(10);
      const distinct = new Set(xs);
      expect(distinct.size, `${id} moved (distinct x over ~5s): ${xs.join(',')}`).toBeGreaterThanOrEqual(2);
      expect(Math.max(...xs) - Math.min(...xs), `${id} travelled`).toBeGreaterThanOrEqual(2);
    }
    await page.screenshot({ path: 'output/ag65/npc-strolling-floor2.png' });
    console.log('AG65-NPC ' + JSON.stringify(samples));
  });
});
