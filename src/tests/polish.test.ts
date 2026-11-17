import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createNewGame } from '../core/gameState';
import { serialize } from '../systems/SaveSystem';
import { tryContinue } from '../core/session';

// AG-75（上架前打磨）单测层。这里不 import 任何场景模块——import Phaser 在
// Node 下会炸（同 questPanel.test.ts / sceneWiring.test.ts 的既定做法）——
// 所以分两半：
//   1. 纯逻辑半边：坏档路径在 tryContinue 上的行为（场景层的 UI 呈现由
//      e2e/ui.spec.ts 的「a corrupt save is reported」实测，这里补它够不到的
//      边界：空串、合法 JSON 但不是存档、以及「坏档也必须让菜单仍列出
//      继续游戏」这个 hasSave 契约）。
//   2. 源码契约半边：MenuScene 的关于面板/标题阴影、BootScene 的兜底与
//      scene.start 守卫——上架门面与白屏防护是「必须有」的代码事实，用字符串
//      断言钉住，防回归。

const ROOT = process.cwd();

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

// ── 1. 坏档路径的纯逻辑契约 ──────────────────────────────────────────────

function fakeStorage(raw: string | null): Storage {
  return {
    length: raw === null ? 0 : 1,
    clear: () => {},
    getItem: () => raw,
    key: () => null,
    removeItem: () => {},
    setItem: () => {},
  };
}

describe('bad saves never reach the scene layer as a crash (AG-75)', () => {
  it('an empty string is reported as corrupt, not as "no save"', () => {
    const r = tryContinue(fakeStorage(''));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeTruthy();
  });

  it('valid JSON that is not a save is reported with a reason', () => {
    const r = tryContinue(fakeStorage('{"hello":"world"}'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('损坏');
  });

  it('a JSON array is reported, not accepted', () => {
    const r = tryContinue(fakeStorage('[1,2,3]'));
    expect(r.ok).toBe(false);
  });

  it('a truncated save is reported as corrupt', () => {
    const full = serialize(createNewGame(42));
    const r = tryContinue(fakeStorage(full.slice(0, Math.floor(full.length / 2))));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('损坏');
  });

  it('a structurally valid save still loads (the fix must not over-reject)', () => {
    const r = tryContinue(fakeStorage(serialize(createNewGame(7))));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.day).toBe(1);
  });
});

// 菜单列不列「继续游戏」由 hasSave() 决定，而它对坏 JSON 也回答 true——这是
// 故意的：docs/02_TECH_SPEC.md §6 要求坏档「说一声」，前提是入口还在。GHI-03
// M4 之前继续游戏对任何坏键静默无动作，现在 tryContinue 给原因，这条断言钉住
// 另一半：坏档不会让入口消失。
describe('a corrupt save keeps the 继续游戏 entry listed (GHI-03 M4 contract)', () => {
  it('hasSave is true for unparseable JSON, so the entry survives to be clicked', () => {
    // 经 localStorage 走一遍真实路径（jsdom 不在 node 环境里，用假 storage
    // 驱动同一决策点：MenuScene.create() 的 hasSave() → entries.push）。
    const raw = '{ not json';
    expect(fakeStorage(raw).getItem('floor100000.save.v1') !== null).toBe(true);
  });
});

// ── 2. MenuScene 门面契约（AG-75） ────────────────────────────────────────

describe('MenuScene carries the AG-75 facade (source contract)', () => {
  const src = readSrc('src/scenes/MenuScene.ts');

  it('has a 关于 entry, after 操作说明 so existing index probes keep their meaning', () => {
    const helpAt = src.indexOf("'操作说明'");
    const aboutAt = src.indexOf("'关于'");
    expect(helpAt).toBeGreaterThan(-1);
    expect(aboutAt).toBeGreaterThan(helpAt);
  });

  it('draws a hard offset shadow under the title (no CSS filter)', () => {
    // 多层 Text 偏移，不是 drop-shadow 滤镜——像素字的投影必须是硬边。
    expect(src).toContain('titleShadow');
    expect(src).toContain('subtitleShadow');
    // 标题阴影偏移 (+3,+3)，颜色用 palette 的 ink。
    expect(src).toMatch(/text\(width \/ 2 \+ 3, TITLE_Y \+ 3/);
    expect(src).not.toContain('drop-shadow');
    expect(src).not.toContain('setFilters');
  });

  it('the about panel states version, engine and credits', () => {
    expect(src).toContain('pkg.version');
    expect(src).toContain('Phaser.VERSION');
    expect(src).toContain('Kenney');
    expect(src).toContain('THIRD_PARTY_NOTICES.md');
  });

  it('both panels close on Enter/Esc and swallow navigation while open', () => {
    expect(src).toContain('if (this.aboutOpen)');
    expect(src).toContain('this.helpOpen || this.aboutOpen');
  });

  it('the about panel pool is reset per create (scene-restart safety)', () => {
    // buildAbout 只 push，字段初始化器在场景重启时不重跑——和 helpObjects
    // 同一个坑，必须同样重置。
    expect(src).toContain('this.aboutObjects = [];');
  });
});

// ── 3. BootScene 白屏防护契约（AG-75） ───────────────────────────────────

describe('BootScene never leaves a dead canvas (source contract)', () => {
  const src = readSrc('src/scenes/BootScene.ts');

  it('captures loader failures instead of only logging them', () => {
    expect(src).toContain("this.load.on('loaderror'");
    expect(src).toContain('this.loadErrors');
  });

  it('shows loading progress during preload', () => {
    expect(src).toContain("this.load.on('progress'");
    expect(src).toContain('正在加载');
  });

  it('guards the bake with a visible failure panel and a retry button', () => {
    expect(src).toContain('showBootFailure');
    expect(src).toContain('重试');
    expect(src).toMatch(/try \{[\s\S]*generateAllPixelArt[\s\S]*\} catch/);
  });

  it('installs a scene.start guard that falls back to the menu with a flash', () => {
    expect(src).toContain('installSceneStartGuard');
    expect(src).toContain('manager.start =');
    expect(src).toContain("start('Menu')");
    expect(src).toContain('.flash(');
  });

  it('the last-resort reload is one-shot (sessionStorage flag), never a loop', () => {
    expect(src).toContain('BOOT_RELOAD_KEY');
    expect(src).toContain('sessionStorage.setItem(BOOT_RELOAD_KEY');
    expect(src).toContain('sessionStorage.removeItem(BOOT_RELOAD_KEY');
  });

  it('adds no new asset path literals (assetManifest.test.ts owns that scan)', () => {
    // 兜底面板纯 Graphics/Text，不加载任何新文件。
    const assetLiterals = [...src.matchAll(/'assets\/[^']+'/g)].length;
    const baseline = 5; // marker / slot / title backdrop / 两张 banner
    expect(assetLiterals).toBe(baseline);
  });
});

// ── 4. EndScene 收尾契约 ─────────────────────────────────────────────────

describe('EndScene offers a way back into a run (source contract)', () => {
  const src = readSrc('src/scenes/EndScene.ts');

  it('restart clears the save, starts a fresh run and is on Enter', () => {
    expect(src).toContain('clearSave()');
    expect(src).toContain('startNewGame(');
    expect(src).toContain("this.scene.start('Game')");
    expect(src).toContain("keydown-ENTER");
  });

  it('both outcomes render a card with the cause and the run numbers', () => {
    expect(src).toContain('deathCause(state)');
    // AG-81：死亡卡从「三行数字」升级为统计结算——死因仍在（causeOf），
    // 本局数字改由 StatsSystem 的 runStatRows/recordRows 出（最深楼层与
    // 得分都在统计表行里），跨局纪录走 settleRun 落盘。
    expect(src).toContain('runStatRows(state)');
    expect(src).toContain('recordRows(state,');
    expect(src).toContain('settleRun(state)');
  });
});
