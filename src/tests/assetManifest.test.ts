import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CHARACTER_FILES, DECO_FILES, ENV_FILES, FURNITURE_FILES, ITEM_ICON_FILES, PORTRAIT_FILES } from '../render/artpack';
import { FX } from '../render/fx';

// The asset manifest is the project's answer to "what is actually in
// public/assets, and who uses it" — a question that used to need one grep per
// subsystem. tools/assets-manifest.mjs scans the tree and measures every file;
// this test runs the real CLI (not a reimplementation) and checks the things a
// scan alone cannot know:
//
//   1. the scan is clean — no unclassified file, no gate failure, no reference
//      pointing at a missing file;
//   2. the reference table it parsed out of artpack.ts / fx.ts / BootScene.ts
//      agrees with the modules themselves, so the parse cannot drift;
//   3. the committed snapshot in docs/assets/manifest.json matches a fresh
//      scan, so any asset change shows up as a test failure with a diff.

interface ManifestFile {
  path: string;
  refs: { module: string; detail: string }[];
  width?: number;
  height?: number;
  channels?: number;
  opaqueColours?: number;
  strayColours?: number;
  inPalette?: boolean;
  transparentPx?: number;
  semiAlphaPx?: number;
  bytes?: number;
  class: 'locked' | 'staged' | 'open' | 'aux' | 'unclassified';
  note: string;
}
interface Manifest {
  palette: number;
  summary: {
    files: number;
    png: number;
    locked: number;
    open: number;
    staged: number;
    aux: number;
    unclassified: number;
    gateFailures: number;
    missingRefs: number;
  };
  files: ManifestFile[];
}

function runManifest(): Manifest {
  const dir = mkdtempSync(join(tmpdir(), 'asset-manifest-'));
  const out = join(dir, 'manifest.json');
  try {
    execFileSync(process.execPath, [join(process.cwd(), 'tools/assets-manifest.mjs'), '--json', out], {
      timeout: 60_000,
    });
    return JSON.parse(readFileSync(out, 'utf8')) as Manifest;
  } catch (err) {
    // The CLI exits 1 when its own scan is unclean (unclassified file, palette
    // gate, missing ref). Without this, the whole suite dies as "Command failed"
    // and the actual reason — printed on the tool's stdout — is lost.
    const { stdout, stderr } = err as { stdout?: string | Buffer; stderr?: string | Buffer };
    const tail = `${stdout ?? ''}${stderr ?? ''}`.trim().split('\n').slice(-12).join('\n');
    throw new Error(`tools/assets-manifest.mjs exited non-zero. Tail of its output:\n${tail}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const manifest = runManifest();
const byPath = new Map(manifest.files.map((f) => [f.path, f]));

// The reference table the test expects, built from the real TS modules — the
// same tables the tool parses out of the source text. If the tool's regex ever
// stops matching the file, these two disagree and the test fails.
function expectedRefs(): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  // AG-武器分支：weapons.ts 里每个 spriteFile: 'xxx.png' 都是一张运行时加载的
  // 武器精灵（撬棍没有 spriteFile，程序绘制）。
  const weaponsSrc = readFileSync(join(process.cwd(), 'src/data/weapons.ts'), 'utf8');
  const WEAPON_SPRITE_FILES = [...weaponsSrc.matchAll(/spriteFile:\s*'([^']+)'/g)].map((m) => m[1]);
  const add = (path: string, module: string) => {
    const list = refs.get(path) ?? [];
    if (!list.includes(module)) list.push(module);
    refs.set(path, list.sort());
  };
  const tables: Array<[Record<string, string>, string]> = [
    [ITEM_ICON_FILES, 'artpack'],
    [FURNITURE_FILES, 'artpack'],
    [CHARACTER_FILES, 'artpack'],
    [PORTRAIT_FILES, 'ui/portraits'],
    [ENV_FILES, 'env'],
    [DECO_FILES, 'deco'],
  ];
  for (const [entries, dir] of tables) {
    for (const file of Object.values(entries)) add(`${dir}/${file}`, 'src/render/artpack.ts');
  }
  for (const fx of FX) {
    add(`fx/${fx.path}/${fx.id}.png`, 'src/render/fx.ts');
    add(`fx/${fx.path}/${fx.id}.json`, 'src/render/fx.ts');
  }
  // AG-武器分支：武器精灵由 BootScene 按 `assets/weapons/${weapon.spriteFile}`
  // 模板拼接加载（不是字面路径），所以上面那条 'assets/...' 字面扫描收不到——
  // 与 tools/assets-manifest.mjs 的 parseWeaponSprites 同手法镜像一遍。
  for (const file of WEAPON_SPRITE_FILES) add(`weapons/${file}`, 'src/scenes/BootScene.ts');
  // BootScene's own loads. The table-driven ones are covered by the artpack
  // parse above; what is left is (a) every 'assets/...' path written as a plain
  // literal — marker, slot, the banners, the title backdrop — and (b) the panel
  // frame loop, whose paths only exist as a template over two literal arrays.
  // Both are read out of BootScene.ts so a change there fails here.
  const boot = readFileSync(join(process.cwd(), 'src/scenes/BootScene.ts'), 'utf8');
  for (const [, path] of boot.matchAll(/'assets\/([^']+)'/g)) add(path, 'src/scenes/BootScene.ts');
  const accents = [...boot.matchAll(/for \(const accent of \[([^\]]+)\]/g)].flatMap((m) =>
    [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]),
  );
  const parts = [...boot.matchAll(/for \(const part of \[([^\]]+)\]/g)].flatMap((m) =>
    [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]),
  );
  expect(accents).toEqual(['green', 'yellow']);
  // Two frame loops now (the originals, then the 2026-11-15 set in its own
  // subdirectory), so `parts` is 16 entries — the same 8 names twice. Slice the
  // first loop's names and pair them with both key lists.
  expect(parts.length % 8).toBe(0);
  const partsOnce = parts.slice(0, 8);
  for (const accent of accents) {
    for (const part of partsOnce) add(`ui/frame-${accent}-${part}.png`, 'src/scenes/BootScene.ts');
  }
  const themes = [...boot.matchAll(/for \(const theme of \[([^\]]+)\]/g)].flatMap((m) =>
    [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]),
  );
  expect(themes).toEqual(['dialogue', 'item', 'tower']);
  for (const theme of themes) {
    for (const part of partsOnce) add(`ui/frame-${theme}/frame-${theme}-${part}.png`, 'src/scenes/BootScene.ts');
  }
  return refs;
}

describe('asset manifest scan', () => {
  it('scans the whole pack', () => {
    // Guards the collection itself: a scan that found nothing would make every
    // assertion below pass for the wrong reason.
    expect(manifest.summary.files).toBeGreaterThan(100);
    expect(manifest.summary.png).toBeGreaterThan(90);
    expect(manifest.palette).toBe(16);
  }, 30_000);

  it('leaves no file unclassified', () => {
    expect(manifest.summary.unclassified).toBe(0);
    for (const f of manifest.files) {
      expect(f.class, `${f.path} is unclassified — register it in tools/assets-manifest.mjs`).not.toBe('unclassified');
    }
  });

  it('passes the palette gate on every locked and staged file', () => {
    expect(manifest.summary.gateFailures).toBe(0);
    for (const f of manifest.files) {
      if (f.class !== 'locked' && f.class !== 'staged') continue;
      expect(f.inPalette, `${f.path}: ${f.strayColours} colours outside the palette`).toBe(true);
      expect(f.opaqueColours, `${f.path}: ${f.opaqueColours} colours`).toBeLessThanOrEqual(manifest.palette);
    }
  });

  it('points no reference at a missing file', () => {
    expect(manifest.summary.missingRefs).toBe(0);
    for (const f of manifest.files) expect(byPath.has(f.path)).toBe(true);
  });
});

describe('manifest references agree with the modules', () => {
  it('derives the same table the tool parsed', () => {
    const expected = expectedRefs();
    const actual = new Map<string, string[]>();
    for (const f of manifest.files) {
      if (f.refs.length) actual.set(f.path, [...new Set(f.refs.map((r) => r.module))].sort());
    }
    expect([...actual.entries()].sort()).toEqual([...expected.entries()].sort());
  });

  it('has a file on disk for every mapped texture', () => {
    for (const path of expectedRefs().keys()) {
      expect(byPath.has(path), `${path} is referenced but not in public/assets`).toBe(true);
    }
  });

  it('keeps the walk sheets out of the scan but in the roster', () => {
    // The four live walk sheets live in src/assets/characters (BootScene's glob),
    // which is outside this manifest's public/assets scope — but the character
    // keys they hang off are covered by CHARACTER_FILES above.
    for (const file of Object.values(CHARACTER_FILES)) {
      expect(byPath.has(`artpack/${file}`)).toBe(true);
    }
  });
});

describe('manifest snapshot', () => {
  it('matches docs/assets/manifest.json', () => {
    // A changed asset must change the snapshot deliberately: regenerate with
    // `node tools/assets-manifest.mjs --json docs/assets/manifest.json`.
    const committed = JSON.parse(readFileSync(join(process.cwd(), 'docs/assets/manifest.json'), 'utf8')) as Manifest;
    expect(manifest).toEqual(committed);
  });
});

describe('the staged 周禾 set', () => {
  // Staged because the wiring change lives in walkcycle.ts (AG-09) and
  // metaProgress.ts; the assets themselves are finished and gate-clean.
  const staged = [
    'artpack/char-zhouhe.png',
    'artpack/char-zhouhe-sheet.png',
    'ui/portraits/portrait-zhouhe.png',
  ];

  it('is present, staged, and gate-clean', () => {
    for (const path of staged) {
      const f = byPath.get(path);
      expect(f, `${path} missing`).toBeDefined();
      expect(f?.class).toBe('staged');
      expect(f?.inPalette).toBe(true);
      expect(f?.opaqueColours).toBeLessThanOrEqual(16);
      expect(f?.semiAlphaPx).toBe(0);
    }
  });

  it('ships the sheet at the geometry the loader expects', () => {
    const sheet = byPath.get('artpack/char-zhouhe-sheet.png');
    expect(sheet?.width).toBe(1280);
    expect(sheet?.height).toBe(96);
    // 20 frames of 64x96: walk 6 + idle 2 + attack 3 + hurt 2 + search 2 + die 3 + pickup 2.
    expect(sheet?.width! / 64).toBe(20);
    const still = byPath.get('artpack/char-zhouhe.png');
    expect(still?.width).toBe(64);
    expect(still?.height).toBe(96);
    const portrait = byPath.get('ui/portraits/portrait-zhouhe.png');
    expect(portrait?.width).toBe(96);
    expect(portrait?.height).toBe(96);
  });
});

describe('the AG-19 four-character sheet set', () => {
  // AG-19 (2026-11-15): the four live characters' 20-frame action sheets,
  // quantized from the v3 re-extraction pack in F:/new. They replace the
  // procedural sheets that bakeWalkSheets() currently writes, so the drop-in
  // is a file copy into src/assets/characters/ — a render-line change, which
  // is why the sheets are staged rather than wired. The stills are already
  // referenced by CHARACTER_FILES, so they are locked, not staged.
  const sheets: Array<[string, string]> = [
    ['player', 'char-player-sheet.png'],
    ['npc_alin', 'char-alin-sheet.png'],
    ['npc_xiaozhou', 'char-xiaozhou-sheet.png'],
    ['wanderer', 'char-wanderer-sheet.png'],
  ];
  const stills = ['char-player.png', 'char-alin.png', 'char-xiaozhou.png', 'char-wanderer.png'];

  it('ships all four sheets, staged and gate-clean', () => {
    for (const [, file] of sheets) {
      const f = byPath.get(`artpack/${file}`);
      expect(f, `${file} missing`).toBeDefined();
      expect(f?.class, `${file} class`).toBe('staged');
      expect(f?.inPalette, `${file} palette`).toBe(true);
      expect(f?.opaqueColours, `${file} colours`).toBeLessThanOrEqual(16);
      expect(f?.semiAlphaPx, `${file} semi-alpha`).toBe(0);
    }
  });

  it('ships the sheets at the geometry the loader expects', () => {
    // The drop-in contract from src/assets/characters/README.md: one
    // horizontal strip, 20 frames of 64x96, walk 0-5 / idle 6-7 / attack 8-10
    // / hurt 11-12 / search 13-14 / die 15-17 / pickup 18-19.
    for (const [, file] of sheets) {
      const f = byPath.get(`artpack/${file}`);
      expect(f?.width, `${file} width`).toBe(1280);
      expect(f?.height, `${file} height`).toBe(96);
      expect(f?.width! / 64, `${file} frame count`).toBe(20);
    }
  });

  it('keeps the four stills locked, gate-clean and on the shared canvas', () => {
    // The stills were the 22-colour build-characters.mjs outputs; AG-19
    // replaced them with the idle frame of the same sheets, so the character
    // set is one art family again. sceneScale.test.ts owns the canvas rule;
    // this owns the gate.
    for (const file of stills) {
      const f = byPath.get(`artpack/${file}`);
      expect(f, `${file} missing`).toBeDefined();
      expect(f?.class, `${file} class`).toBe('locked');
      expect(f?.inPalette, `${file} palette`).toBe(true);
      expect(f?.opaqueColours, `${file} colours`).toBeLessThanOrEqual(16);
      expect(f?.semiAlphaPx, `${file} semi-alpha`).toBe(0);
      expect(f?.width, `${file} width`).toBe(64);
      expect(f?.height, `${file} height`).toBe(96);
    }
  });
});
