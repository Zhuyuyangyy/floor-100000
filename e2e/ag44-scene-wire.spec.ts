import { expect, test, type Page } from '@playwright/test';

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../src/core/design';
import { PANEL_DEPTH } from '../src/render/panels';

// AG-44（场景接线）实测探针。端口 5441 专用 config，--workers=1。
//
// 同一份 spec 跑两个阶段：
//   AG44_PHASE=before  npx playwright test --config=e2e/playwright.ag44.config.ts --workers=1
//   AG44_PHASE=after   （接线完成后重跑）
// before 阶段只做测量 + 画布 containment 断言 + 截图（功能断言跳过）；
// after 阶段追加三处接线的功能断言（effect/tierNote/hints、objectives、
// dev 句柄、指针交互）。
//
// 截图落 output/ag44/<phase>/（gitignore 的本地证据目录），测量 JSON 以
// testInfo.attach 附在报告里。

const PHASE = process.env.AG44_PHASE ?? 'run';
const EXPECT_AFTER = PHASE === 'after';

interface Box {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ObjBox {
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
}

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

async function startGame(page: Page, seed: number): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await waitForScene(page, 'Menu');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'MetaSelect');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Enter');
    const started = await page.waitForFunction(
      () => {
        const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
        return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'Game');
      },
      undefined,
      { timeout: 2000 },
    ).then(() => true).catch(() => false);
    if (started) break;
  }
  await waitForScene(page, 'Game');
}

// Every visible Text of a scene, design-canvas coordinates. The depth filter
// mirrors font.spec.ts's panelTexts: in the Game scene the world labels and
// the HUD band sit below PANEL_DEPTH.game, and including them would drown the
// panel measurement. Non-Text objects are skipped before getBounds is touched
// (the Game scene's children include objects without it).
async function sceneObjects(page: Page, key: string): Promise<ObjBox[]> {
  return page.evaluate(
    ({ k, minDepth }) => {
      const g = (window as unknown as {
        __PHASER_GAME__?: {
          scene: {
            getScene: (key: string) => {
              children: { list: Array<{ type: string; name?: string; visible: boolean; text?: string; depth?: number; getBounds?(): { x: number; y: number; width: number; height: number } }> };
            } | null;
          };
        };
      }).__PHASER_GAME__;
      const scene = g?.scene.getScene(k);
      const out: ObjBox[] = [];
      for (const o of scene?.children.list ?? []) {
        if (o.type !== 'Text' || !o.visible) continue;
        if ((o.name ?? '').startsWith('hud-')) continue;
        if ((o.depth ?? 0) < minDepth) continue;
        if (typeof o.getBounds !== 'function') continue;
        const b = o.getBounds();
        out.push({ type: o.type, name: o.name ?? '', x: b.x, y: b.y, width: b.width, height: b.height, text: o.text });
      }
      return out;
    },
    { k: key, minDepth: key === 'Game' ? PANEL_DEPTH.game.inventory : 0 },
  );
}

async function sceneTexts(page: Page, key: string): Promise<Box[]> {
  const objs = await sceneObjects(page, key);
  return objs
    .filter((o) => o.type === 'Text' && (o.text ?? '').length > 0)
    .map((o) => ({ text: o.text ?? '', x: o.x, y: o.y, width: o.width, height: o.height }));
}

function expectWithinCanvas(texts: Box[], label: string): void {
  expect(texts.length, `${label}: no text found`).toBeGreaterThan(0);
  for (const t of texts) {
    expect(t.x, `${label}: "${t.text}" starts off-canvas`).toBeGreaterThanOrEqual(0);
    expect(t.y, `${label}: "${t.text}" starts off-canvas`).toBeGreaterThanOrEqual(0);
    expect(t.x + t.width, `${label}: "${t.text}" runs off the right edge`).toBeLessThanOrEqual(DESIGN_WIDTH);
    expect(t.y + t.height, `${label}: "${t.text}" runs off the bottom edge`).toBeLessThanOrEqual(DESIGN_HEIGHT);
  }
}

function expectNoOverlap(texts: Box[], label: string): void {
  const collisions: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i];
      const b = texts[j];
      const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (w <= 1 || h <= 1) continue;
      const smaller = Math.min(a.width * a.height, b.width * b.height);
      if (smaller > 0 && (w * h) / smaller > 0.15) collisions.push(`"${a.text}" × "${b.text}"`);
    }
  }
  expect(collisions, `${label}: overlapping text`).toEqual([]);
}

// design-canvas point → page point (Scale.FIT inside the viewport).
async function toPage(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('no canvas');
  const scale = canvas.width / 1280;
  return { x: canvas.x + x * scale, y: canvas.y + y * scale };
}

test.describe('craft panel (工作台)', () => {
  test('rows + new detail block stay inside the canvas and off each other', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await startGame(page, 42);

    // ── row 0 (照明灯): fresh bag → 材料不足 → hints must show (after)
    await page.keyboard.press('C');
    await expect.poll(async () => (await sceneTexts(page, 'Game')).some((t) => t.text.includes('工作台 · 制作'))).toBe(true);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `output/ag44/${PHASE}/craft-01-lamp.png` });

    const lampTexts = await sceneTexts(page, 'Game');
    expectWithinCanvas(lampTexts, 'craft/lamp');
    expectNoOverlap(lampTexts, 'craft/lamp');

    await testInfo.attach('craft-lamp-texts', { body: JSON.stringify(lampTexts, null, 2), contentType: 'application/json' });

    if (EXPECT_AFTER) {
      expect(lampTexts.some((t) => t.text.startsWith('效果：')), 'effect preview line missing').toBe(true);
      expect(lampTexts.some((t) => t.text.includes('档位 1')), 'tier note missing').toBe(true);
      expect(lampTexts.some((t) => t.text.startsWith('去哪拿：')), 'material source hints missing').toBe(true);
      // the hints must name all three missing materials of the lamp
      const hint = lampTexts.find((t) => t.text.startsWith('去哪拿：'))?.text ?? '';
      expect(hint).toContain('电池');
      expect(hint).toContain('电线');
      expect(hint).toContain('废金属');
    }

    // ── row 4 (工牌, tier 2): tierNote reads the power line; no requires of its own
    // (the pass chain gates each credential behind the PREVIOUS credential, not
    // behind a facility — work_badge has no requires field).
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(200);
    await page.screenshot({ path: `output/ag44/${PHASE}/craft-02-badge.png` });

    const badgeTexts = await sceneTexts(page, 'Game');
    expectWithinCanvas(badgeTexts, 'craft/badge');
    expectNoOverlap(badgeTexts, 'craft/badge');
    await testInfo.attach('craft-badge-texts', { body: JSON.stringify(badgeTexts, null, 2), contentType: 'application/json' });

    if (EXPECT_AFTER) {
      const meta = badgeTexts.find((t) => t.text.includes('档位 2'))?.text ?? '';
      expect(meta, 'tier-2 note missing on 工牌').toContain('档位 2');
      expect(meta).toContain('未达'); // 权力线 1 级 < 档位 2
      expect(badgeTexts.some((t) => t.text.includes('效果：') && t.text.includes('100-110')), 'badge effect missing').toBe(true);

      // ── row 5 (通行贴, tier 3): gated behind 工牌 → the requires half of the
      // tier line reads 前置：工牌 未获得.
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(250);
      const stickerTexts = await sceneTexts(page, 'Game');
      expectWithinCanvas(stickerTexts, 'craft/sticker');
      const stickerTier = stickerTexts.find((t) => t.text.includes('档位 3'))?.text ?? '';
      expect(stickerTier, 'tier-3 note missing on 通行贴').toContain('档位 3');
      expect(stickerTier).toContain('前置：工牌');
      expect(stickerTier).toContain('未获得');
      await testInfo.attach('craft-sticker-texts', { body: JSON.stringify(stickerTexts, null, 2), contentType: 'application/json' });
    }

    await page.keyboard.press('C');
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });
});

test.describe('quest panel (任务)', () => {
  test('objectives completion renders and the pointer drives the rows', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await startGame(page, 42);
    // Floor 2: the first main quest is available. One objective done, two pending.
    // The flag goes through the real WorldFlags API (state.flags is optional and
    // lazily created — poking the raw field threw on a fresh run).
    await page.evaluate(async () => {
      const s = (window as unknown as { __PHASER_SESSION__?: { getState: () => { currentFloor: number } | null } }).__PHASER_SESSION__?.getState();
      if (!s) throw new Error('no session');
      s.currentFloor = 2;
      // 变量路径而非字面量：字面量会被 tsc 解析而 /src 前缀在 Node 下不存在。
      const flagsPath = '/src/systems/WorldFlags.ts';
      const questsPath = '/src/data/quests.ts';
      const mod = (await import(/* @vite-ignore */ flagsPath)) as typeof import('../src/systems/WorldFlags');
      const quests = (await import(/* @vite-ignore */ questsPath)) as typeof import('../src/data/quests');
      mod.setFlag(s as unknown as Parameters<typeof mod.setFlag>[0], quests.QUEST_FLAG.objective('blackout-schedule', 'schedule'));
    });

    await page.keyboard.press('Q');
    await expect.poll(async () => (await sceneTexts(page, 'QuestPanel')).some((t) => t.text === '任务')).toBe(true);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `output/ag44/${PHASE}/quest-01-objectives.png` });

    const questTexts = await sceneTexts(page, 'QuestPanel');
    expectWithinCanvas(questTexts, 'quest/objectives');
    expectNoOverlap(questTexts, 'quest/objectives');
    await testInfo.attach('quest-objectives-texts', { body: JSON.stringify(questTexts, null, 2), contentType: 'application/json' });

    if (EXPECT_AFTER) {
      // completion: one ✓ (done), two ○ (pending), and the count on the meta line
      const done = questTexts.filter((t) => t.text.startsWith('✓'));
      const pending = questTexts.filter((t) => t.text.startsWith('○'));
      expect(done.length, 'done objective marker missing').toBe(1);
      expect(pending.length, 'pending objective markers missing').toBe(2);
      expect(done[0].text).toContain('抄下停电表');
      expect(questTexts.some((t) => t.text.includes('目标 1/3')), 'objective count missing on the meta line').toBe(true);
    }

    if (!EXPECT_AFTER) {
      await page.keyboard.press('Escape');
      return;
    }


    // ── pointer: click the second row (净水口) → it becomes the selection
    const rowLabel = questTexts.find((t) => t.text === '净水口');
    expect(rowLabel, 'row label 净水口 not found').toBeTruthy();
    const rowPoint = await toPage(page, rowLabel!.x + rowLabel!.width / 2, rowLabel!.y + rowLabel!.height / 2);
    await page.mouse.click(rowPoint.x, rowPoint.y);
    await page.waitForTimeout(250);
    const selAfterRowClick = await page.evaluate(() => {
      const q = (window as unknown as { __PHASER_QUESTS__?: { getSelection: () => { quest: number } } }).__PHASER_QUESTS__;
      return q?.getSelection().quest ?? -1;
    });
    expect(selAfterRowClick, 'pointer row click did not move the selection').toBe(1);
    await page.screenshot({ path: `output/ag44/${PHASE}/quest-02-row-click.png` });

    // ── pointer: click a branch block twice → first selects, second commits
    const branch = (await sceneTexts(page, 'QuestPanel')).find((t) => t.text.includes('告诉小周和邻居们'));
    expect(branch, 'branch label not found').toBeTruthy();
    const bPoint = await toPage(page, branch!.x + branch!.width / 2, branch!.y + branch!.height / 2);
    await page.mouse.click(bPoint.x, bPoint.y);
    await page.waitForTimeout(150);
    await page.mouse.click(bPoint.x, bPoint.y);
    await page.waitForTimeout(300);
    const msg = await page.evaluate(() => {
      const q = (window as unknown as { __PHASER_QUESTS__?: { getMessage: () => string } }).__PHASER_QUESTS__;
      return q?.getMessage() ?? '';
    });
    expect(msg, 'branch commit message missing').toContain('已记录');
    await page.screenshot({ path: `output/ag44/${PHASE}/quest-03-branch-commit.png` });

    // ── pointer: click outside the panel → it closes (the mouse's Esc)
    const outside = await toPage(page, 40, 700);
    await page.mouse.click(outside.x, outside.y);
    await page.waitForTimeout(300);
    const stillOpen = await page.evaluate(() => {
      const g = (window as unknown as { __PHASER_GAME__?: { scene: { getScenes: (r?: boolean) => Array<{ scene: { key: string } }> } } }).__PHASER_GAME__;
      return !!g && g.scene.getScenes(true).some((s) => s.scene.key === 'QuestPanel');
    });
    expect(stillOpen, 'outside click did not close the panel').toBe(false);

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });
});

test.describe('dev handles (main.ts)', () => {
  test('the three read-only handles answer on the live game', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await startGame(page, 42);

    if (!EXPECT_AFTER) {
      test.skip(true, 'baseline phase: handles not mounted yet');
      return;
    }

    const handles = await page.evaluate(() => {
      const w = window as unknown as {
        __PHASER_DIARY__?: { getEntries: (limit?: number) => unknown[]; getKindCount: (kind: string) => number };
        __PHASER_NPC_ATOMS__?: { getAtoms: (npcId: string) => unknown[]; getSense: (npcId: string) => unknown };
        __PHASER_QUESTS__?: { getEvaluations: () => unknown[]; getSelection: () => unknown; getMessage: () => string };
      };
      return {
        diary: !!w.__PHASER_DIARY__,
        npcAtoms: !!w.__PHASER_NPC_ATOMS__,
        quests: !!w.__PHASER_QUESTS__,
      };
    });
    expect(handles, 'dev handles missing').toEqual({ diary: true, npcAtoms: true, quests: true });

    // Diary: write one entry through the product function, read it back.
    const diary = await page.evaluate(async () => {
      const w = window as unknown as { __PHASER_DIARY__?: { getEntries: (limit?: number) => unknown[]; getKindCount: (kind: string) => number } };
      const modPath = '/src/systems/DiarySystem.ts';
      const mod = (await import(/* @vite-ignore */ modPath)) as typeof import('../src/systems/DiarySystem');
      const session = (window as unknown as { __PHASER_SESSION__?: { getState: () => unknown } }).__PHASER_SESSION__;
      const state = session?.getState() as Parameters<typeof mod.recordDiary>[0];
      mod.recordDiary(state, { kind: 'visitor', day: 1, minute: 600, text: '探针条目', actorId: null });
      return {
        entries: w.__PHASER_DIARY__?.getEntries(5),
        kindCount: w.__PHASER_DIARY__?.getKindCount('visitor'),
      };
    });
    expect(Array.isArray(diary.entries), 'getEntries did not answer an array').toBe(true);
    expect((diary.entries as Array<{ text: string }>).some((e) => e.text === '探针条目'), 'written entry not readable').toBe(true);
    expect(diary.kindCount, 'getKindCount did not count').toBeGreaterThanOrEqual(1);

    // NPC atoms: 阿林 on her floor answers a three-atom plan and a sense snapshot.
    const atoms = await page.evaluate(() => {
      const w = window as unknown as {
        __PHASER_NPC_ATOMS__?: { getAtoms: (npcId: string) => Array<{ kind: string }>; getSense: (npcId: string) => { npcId: string; player: { sameFloor: boolean } } | null };
      };
      // 未知 id 的诚实答案是 null（不抛）——用 try 显式区分「返回 null」与
      // 「抛异常」，?? 'threw' 会把正确的 null 也吃成 'threw'。
      let unknownNpc: unknown = 'threw';
      try {
        unknownNpc = w.__PHASER_NPC_ATOMS__?.getSense('nobody');
      } catch {
        unknownNpc = 'threw';
      }
      return {
        atoms: w.__PHASER_NPC_ATOMS__?.getAtoms('alin') ?? null,
        sense: w.__PHASER_NPC_ATOMS__?.getSense('alin') ?? null,
        unknownNpc,
      };
    });
    expect(atoms.atoms, 'getAtoms did not answer').toBeTruthy();
    expect((atoms.atoms as Array<{ kind: string }>).map((a) => a.kind)).toEqual(['goTo', 'playAnimation']);
    expect((atoms.sense as { npcId: string } | null)?.npcId).toBe('alin');
    expect(atoms.unknownNpc, 'unknown npcId must not throw').toBe(null);

    // Quests: evaluations over the live state, before the panel ever opens.
    const quests = await page.evaluate(() => {
      const w = window as unknown as {
        __PHASER_QUESTS__?: { getEvaluations: () => Array<{ quest: { id: string }; status: string }>; getSelection: () => unknown; getMessage: () => string };
      };
      return {
        count: w.__PHASER_QUESTS__?.getEvaluations().length ?? 0,
        first: w.__PHASER_QUESTS__?.getEvaluations()[0]?.quest.id ?? '',
        selection: w.__PHASER_QUESTS__?.getSelection(),
        message: w.__PHASER_QUESTS__?.getMessage(),
      };
    });
    expect(quests.count, 'getEvaluations returned no quests').toBe(8);
    expect(quests.first).toBe('blackout-schedule');
    expect(quests.selection).toEqual({ mode: 'list', quest: 0, branch: 0 });
    expect(quests.message).toBe('');
    await testInfo.attach('dev-handles', { body: JSON.stringify({ handles, diary, atoms, quests }, null, 2), contentType: 'application/json' });

    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });
});
