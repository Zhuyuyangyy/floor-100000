// ASSET MANIFEST — what is actually in public/assets, measured, and who uses it.
//
// The art pack grew file by file: icons sliced from a sheet, furniture from a
// second sheet, walls from an SVG pack, portraits from a delivery, effects from
// pixelfx. Nothing tied those together, so the questions "is this file used",
// "did it pass the palette gate" and "what changed since last week" each needed
// a different grep. This tool answers all three in one pass:
//
//   node tools/assets-manifest.mjs                # human table on stdout
//   node tools/assets-manifest.mjs --json out.json  # machine-readable manifest
//
// It exits 1 when a file on disk is not classified, so CI can call it directly
// and a new asset cannot land silently. src/tests/assetManifest.test.ts runs
// the same scan and compares it against docs/assets/manifest.json.
//
// The palette is parsed out of src/render/palette.ts and the reference tables
// out of src/render/artpack.ts and src/render/fx.ts, the same way
// char-sheet-gate.mjs loads the palette: one source of truth, no copied hexes
// that can drift. The test re-derives the same tables from the real TS modules
// and fails if the parse and the code disagree.

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { decodePng } from './png.mjs';

const ROOT = process.cwd();
const ASSETS = join(ROOT, 'public/assets');

// ── palette, parsed from the source of truth ────────────────────────────────
function loadPalette() {
  const src = readFileSync(join(ROOT, 'src/render/palette.ts'), 'utf8');
  const block = src.slice(src.indexOf('export const PALETTE'), src.indexOf('} as const'));
  const hexes = [...block.matchAll(/0x([0-9a-fA-F]{6})/g)].map((m) => m[1].toLowerCase());
  return [...new Set(hexes)].map((h) => [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]);
}
const PALETTE = loadPalette();
const PALETTE_SET = new Set(PALETTE.map(([r, g, b]) => (r << 16) | (g << 8) | b));
const key = (r, g, b) => (r << 16) | (g << 8) | b;

// ── reference tables, parsed from the modules that own them ─────────────────
// artpack.ts: every `export const X_FILES ... = { key: 'file.png', ... }` block.
// Keys are plain identifiers, except ENV_FILES which uses computed
// `[ENV_WALL_KEY]: 'wall.png'` entries — both shapes are read.
function parseArtpackTables() {
  const src = readFileSync(join(ROOT, 'src/render/artpack.ts'), 'utf8');
  const tables = {};
  const blockRe = /export const (\w+): Record<[^>]+> = \{([\s\S]*?)\n\};/g;
  for (const [, name, body] of src.matchAll(blockRe)) {
    const entries = {};
    // Three key shapes now: `[COMPUTED_KEY]`, `plain_name`, and a quoted
    // `'env-wall-slum-a'` (the six-tier sets use hyphens, which \w+ never
    // matches). Missing the third shape silently drops 24 files from the ref
    // table, and the manifest test then compares 102 entries against 126.
    for (const m of body.matchAll(/(?:\[(\w+)\]|'([^']+)'|(\w+)):\s*'([^']+)'/g)) {
      entries[m[1] ?? m[2] ?? m[3]] = m[4];
    }
    if (Object.keys(entries).length) tables[name] = entries;
  }
  return tables;
}
// fx.ts: the FX array's { id, path } pairs. Each effect loads <path>/<id>.png
// plus its Aseprite JSON, which is why the JSON files are referenced too.
function parseFxTable() {
  const src = readFileSync(join(ROOT, 'src/render/fx.ts'), 'utf8');
  const start = src.indexOf('export const FX');
  const end = src.indexOf('];', start);
  const out = {};
  for (const [, id, path] of src.slice(start, end).matchAll(/\{\s*id:\s*'([^']+)',\s*path:\s*'([^']+)'\s*\}/g)) {
    out[id] = path;
  }
  return out;
}

const ARTPACK = parseArtpackTables();
const FX = parseFxTable();

// Where each artpack table's files live, and which dir the keys are loaded from.
const ARTPACK_DIRS = {
  ITEM_ICON_FILES: 'artpack',
  FURNITURE_FILES: 'artpack',
  CHARACTER_FILES: 'artpack',
  PORTRAIT_FILES: 'ui/portraits',
  ENV_FILES: 'env',
  // The eight wall fixtures live in their own folder (1:1 close-up art).
  DECO_FILES: 'deco',
};

/** path-relative-to-public/ -> [{ module, detail }] */
function buildRefs() {
  const refs = {};
  const add = (path, module, detail) => {
    const list = (refs[path] ??= []);
    list.push({ module, detail });
  };
  for (const [table, entries] of Object.entries(ARTPACK)) {
    const dir = ARTPACK_DIRS[table] ?? 'artpack';
    for (const [k, file] of Object.entries(entries)) add(`${dir}/${file}`, 'src/render/artpack.ts', `${table}[${k}]`);
  }
  for (const [id, path] of Object.entries(FX)) {
    add(`fx/${path}/${id}.png`, 'src/render/fx.ts', `FX[${id}]`);
    add(`fx/${path}/${id}.json`, 'src/render/fx.ts', `FX[${id}]`);
  }
  // BootScene loads these by literal path rather than through a table.
  add('ui/marker.png', 'src/scenes/BootScene.ts', "load.image('ui-marker')");
  add('ui/slot.png', 'src/scenes/BootScene.ts', 'ART_SLOT_KEY');
  for (const accent of ['green', 'yellow']) {
    for (const part of ['tl', 'tr', 'bl', 'br', 'top', 'bottom', 'left', 'right']) {
      add(`ui/frame-${accent}-${part}.png`, 'src/scenes/BootScene.ts', `ui-frame-${accent}-${part}`);
    }
  }
  // The three 2026-11-15 frames load from their own subdirectory (each ships as
  // one 96x96 image, sliced at build time — see BootScene).
  for (const theme of ['dialogue', 'item', 'tower']) {
    for (const part of ['tl', 'tr', 'bl', 'br', 'top', 'bottom', 'left', 'right']) {
      add(`ui/frame-${theme}/frame-${theme}-${part}.png`, 'src/scenes/BootScene.ts', `ui-frame-${theme}-${part}`);
    }
  }
  add('artpack/banner-win.png', 'src/scenes/BootScene.ts', 'ART_BANNER_WIN_KEY');
  add('artpack/banner-lose.png', 'src/scenes/BootScene.ts', 'ART_BANNER_LOSE_KEY');
  add('title/dorm-corridor-2x.png', 'src/scenes/BootScene.ts', 'TITLE_BG_KEY');
  return refs;
}
const REFS = buildRefs();

// ── classification ─────────────────────────────────────────────────────────
// Every file on disk must appear here. Four classes:
//   locked  the strict gate applies: <=16 colours, every one of them in the
//           project palette. Walls, the worker-dorm furniture and the
//           portraits are drawn to this contract.
//   staged  finished, gate-clean art waiting on a wiring change in a file
//           another agent owns. The gate still applies — staged art that has
//           not passed it is not finished — but nothing loads it yet.
//   open    referenced art that predates the palette lock — area-averaged
//           renders and pixelfx atlases carrying hundreds to tens of thousands
//           of colours. Recorded, not gated: re-quantising approved art is the
//           art owner's call, and the numbers here are what that decision gets
//           made on (see docs/assets/GAPS.md).
//   aux     not a game texture: fonts, the font licence, review contact sheets.
const LOCKED = [
  'env/wall.png',
  'env/wall-dorm.png',
  'env/wall-industry.png',
  'artpack/furn-badge_rack.png',
  'artpack/furn-boot_rack.png',
  'artpack/furn-bunk_bed.png',
  'artpack/furn-key_board.png',
  'artpack/furn-meal_counter.png',
  'artpack/furn-ration_dispenser.png',
  'artpack/furn-security_safe.png',
  'artpack/furn-shift_board.png',
  'artpack/furn-shift_locker.png',
  'artpack/furn-thermos_rack.png',
  'artpack/furn-tool_cage.png',
  'artpack/furn-uniform_rack.png',
  'artpack/furn-wash_sink.png',
  'artpack/furn-worker_locker.png',
  'ui/portraits/portrait-player.png',
  'ui/portraits/portrait-alin.png',
  'ui/portraits/portrait-xiaozhou.png',
  'ui/portraits/portrait-wanderer.png',
  // AG-19：CHARACTER_FILES 静帧。原为 build-characters.mjs 的 22 色程序化产物，
  // 已换成同批 v3 行动表的待机帧（--still 6）量化版，与行动表同一美术家族。
  'artpack/char-player.png',
  'artpack/char-alin.png',
  'artpack/char-xiaozhou.png',
  'artpack/char-wanderer.png',
  // AG-46：首章四位发布者（data/npcs.ts）的静帧与头像。静帧是 walkcycle
  // 同款 drawPose(idlePose(0)) 烘出后过 quantize-sheet.mjs（8-10 色、全在
  // 板内、脚底 95 行）；头像是现有头像换主色派生（recolor-portrait.mjs，
  // 8-12 色、二值 alpha）。推导链见 docs/assets/AG-46_PUBLISHER_ART.md。
  'artpack/char-recruiter.png',
  'artpack/char-blackmarket.png',
  'artpack/char-lab_clerk.png',
  'artpack/char-banquet_staff.png',
  'ui/portraits/portrait-recruiter.png',
  'ui/portraits/portrait-blackmarket.png',
  'ui/portraits/portrait-lab_clerk.png',
  'ui/portraits/portrait-banquet_staff.png',
];
const STAGED = {
  'artpack/char-zhouhe.png': 'CHARACTER_FILES 单帧，待 artpack.ts 接线（walkcycle.ts COLORS 属 AG-09）',
  'artpack/char-zhouhe-sheet.png': '二十帧行动表；运行时应落位 src/assets/characters/npc_zhouhe.png',
  'ui/portraits/portrait-zhouhe.png': 'PORTRAIT_FILES 头像，待 artpack.ts 接线',
  // AG-19：四角色二十帧行动表，源自 F:/new 四角色动作GIF预览包_v3_重新提取清晰版
  // （player/alin/xiaozhou/wanderer_sprite_sheet_1280x96.png），量化后 4-15 色全在
  // 板内、二值 alpha、脚底 95 行 spread 0，char-sheet-gate 全项 PASS。运行时应落位
  // src/assets/characters/<who>.png 覆盖现有程序化表（BootScene glob 自动拾取）。
  'artpack/char-player-sheet.png': '二十帧行动表（v3 重提取版量化）；运行时应落位 src/assets/characters/player.png',
  'artpack/char-alin-sheet.png': '二十帧行动表（v3 重提取版量化）；运行时应落位 src/assets/characters/npc_alin.png',
  'artpack/char-xiaozhou-sheet.png': '二十帧行动表（v3 重提取版量化）；运行时应落位 src/assets/characters/npc_xiaozhou.png',
  'artpack/char-wanderer-sheet.png': '二十帧行动表（v3 重提取版量化）；运行时应落位 src/assets/characters/wanderer.png',
};
const AUX = [
  'fonts/noto-sans-sc-subset.otf',
  'fonts/OFL.txt',
  'fx/fire/brazier/contact.png',
  'fx/fire/candle/contact.png',
  'fx/fire/torch/contact.png',
  'fx/impacts/crit-hit/contact.png',
  'fx/impacts/ground-slam/contact.png',
  'fx/impacts/hit-flash/contact.png',
  'fx/impacts/hit-spark/contact.png',
  'fx/impacts/parry/contact.png',
  'fx/melee/sword-slash/contact.png',
  'fx/pickups/coin-spin/contact.png',
  'fx/pickups/collect-burst/contact.png',
  'fx/status/poisoned/contact.png',
  'fx/water/drip/contact.png',
  'fx/water/ripples/contact.png',
];

// The eight wall fixtures, shown 1:1 in the close-up archive (key L). Native size
// is the whole point: the panel exists so the rivets, pitting and chalk strokes
// survive, and 16-colour snapping would flatten exactly those. Not gated.
const DECO = [
  'deco/deco-1.png',
  'deco/deco-2.png',
  'deco/deco-3.png',
  'deco/deco-4.png',
  'deco/deco-5.png',
  'deco/deco-6.png',
  'deco/deco-7.png',
  'deco/deco-8.png',
];

function classify(path) {
  if (path in STAGED) return { class: 'staged', note: STAGED[path] };
  if (LOCKED.includes(path)) return { class: 'locked', note: '16 色门禁适用' };
  if (DECO.includes(path)) return { class: 'open', note: '墙面特写，255–335px 1:1 显示，不量化' };
  // 2026-11-15 包：六阶层 x 三变体墙 18 张 + 六阶层地板 6 张。
  // 交付时已按项目 16 色吸附（墙 7-12 色、地板 3-5 色），严格门禁适用。
  if (path.startsWith('ui/frame-dialogue/') || path.startsWith('ui/frame-item/') || path.startsWith('ui/frame-tower/')) {
    return { class: 'locked', note: '2026-11-15 三套面板框（八片），16 色门禁适用' };
  }
  if (path.startsWith('env/stains/')) {
    return { class: 'locked', note: '墙面痕迹叠加层（64x64 带 alpha），16 色门禁适用' };
  }
  if (path.startsWith('env/fixtures/')) {
    return { class: 'locked', note: '墙装贴图，26px 宽，16 色门禁适用' };
  }
  if (path.startsWith('env/walls/') || path.startsWith('env/floors/')) {
    return { class: 'locked', note: '阶层墙/地板，16 色门禁适用' };
  }
  if (AUX.includes(path)) return { class: 'aux', note: path.endsWith('.otf') || path.endsWith('.woff2') ? '字体（Noto Sans SC 子集，SIL OFL）' : path.endsWith('OFL.txt') ? '字体许可' : '特效接触表（审阅用）' };
  if (REFS[path]) {
    return {
      class: 'open',
      note: path.startsWith('fx/') ? 'pixelfx 特效图集，未过 16 色门禁' : '既有未量化资产（面积平均降尺/绘制产物）',
    };
  }
  return null;
}

// ── the scan ────────────────────────────────────────────────────────────────
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out.sort();
}

function measurePng(file) {
  const img = decodePng(readFileSync(file));
  const colours = new Map();
  let transparent = 0;
  let semi = 0;
  for (let i = 0; i < img.width * img.height; i++) {
    const o = i * img.channels;
    const a = img.channels === 4 ? img.pixels[o + 3] : 255;
    if (a === 0) {
      transparent++;
      continue;
    }
    if (a < 255) semi++;
    const k = key(img.pixels[o], img.pixels[o + 1], img.pixels[o + 2]);
    colours.set(k, (colours.get(k) ?? 0) + 1);
  }
  const stray = [...colours.keys()].filter((c) => !PALETTE_SET.has(c));
  return {
    width: img.width,
    height: img.height,
    channels: img.channels,
    opaqueColours: colours.size,
    strayColours: stray.length,
    inPalette: stray.length === 0,
    transparentPx: transparent,
    semiAlphaPx: semi,
  };
}

const files = walk(ASSETS).map((full) => {
  const path = relative(ASSETS, full).split(sep).join('/');
  const entry = { path, refs: REFS[path] ?? [] };
  const kind = classify(path);
  if (path.endsWith('.png')) Object.assign(entry, measurePng(full), { bytes: statSync(full).size });
  entry.class = kind?.class ?? 'unclassified';
  entry.note = kind?.note ?? '';
  if (entry.class === 'unclassified') entry.note = '未分类：请在 tools/assets-manifest.mjs 的 LOCKED/STAGED/AUX 中登记';
  return entry;
});

const unclassified = files.filter((f) => f.class === 'unclassified');
// Staged art must already pass the gate — that is what makes it finished.
const gated = files.filter((f) => f.class === 'locked' || f.class === 'staged');
const gateFailures = gated.filter((f) => f.path.endsWith('.png') && (!f.inPalette || f.opaqueColours > PALETTE.length));
const missingRefs = [];
for (const [path] of Object.entries(REFS)) {
  if (!files.some((f) => f.path === path)) missingRefs.push(path);
}

// ── output ─────────────────────────────────────────────────────────────────
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;

if (jsonOut) {
  const manifest = {
    palette: PALETTE.length,
    summary: {
      files: files.length,
      png: files.filter((f) => f.path.endsWith('.png')).length,
      locked: files.filter((f) => f.class === 'locked').length,
      open: files.filter((f) => f.class === 'open').length,
      staged: files.filter((f) => f.class === 'staged').length,
      aux: files.filter((f) => f.class === 'aux').length,
      unclassified: unclassified.length,
      gateFailures: gateFailures.length,
      missingRefs: missingRefs.length,
    },
    files,
  };
  mkdirSync(join(jsonOut, '..'), { recursive: true });
  writeFileSync(jsonOut, `${JSON.stringify(manifest, null, 2)}\n`);
}

// The table: one line per file, worst number last so problems sort to the eye.
const pad = (s, n) => String(s).padEnd(n);
console.log(`ASSET MANIFEST — public/assets (${files.length} files, palette ${PALETTE.length})`);
console.log(`  ${pad('path', 46)} ${pad('size', 11)} ${pad('colours', 9)} ${pad('palette', 10)} ${pad('class', 14)} refs`);
for (const f of files) {
  if (!f.path.endsWith('.png')) {
    console.log(`  ${pad(f.path, 46)} ${pad('-', 11)} ${pad('-', 9)} ${pad('-', 10)} ${pad(f.class, 14)} ${f.refs.map((r) => r.module).join(', ')}`);
    continue;
  }
  const size = `${f.width}x${f.height}`;
  const colourBit = f.inPalette ? 'in' : `${f.strayColours} stray`;
  console.log(
    `  ${pad(f.path, 46)} ${pad(size, 11)} ${pad(f.opaqueColours, 9)} ${pad(colourBit, 10)} ${pad(f.class, 14)} ${f.refs.map((r) => r.module).join(', ')}`,
  );
}
for (const f of unclassified) console.log(`UNCLASSIFIED  ${f.path}`);
for (const f of gateFailures) console.log(`GATE FAIL     ${f.path} — ${f.opaqueColours} colours, ${f.strayColours} outside the palette`);
for (const p of missingRefs) console.log(`MISSING FILE  ${p} — referenced by the game but not on disk`);
if (!unclassified.length && !gateFailures.length && !missingRefs.length) console.log('RESULT: clean');

if (jsonOut) console.log(`json: ${jsonOut}`);
process.exit(unclassified.length + gateFailures.length + missingRefs.length === 0 ? 0 : 1);
