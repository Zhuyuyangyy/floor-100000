#!/usr/bin/env node
/**
 * Cut per-floor backdrops out of the art library's 2880x200 strips.
 *
 * ── STATUS: on hold, images withdrawn ─────────────────────────────────────
 *
 * This script produced five backdrops that were wired and shipped, then pulled,
 * because they painted the wrong subject. The library strips show four
 * self-contained rooms with doors off an empty corridor - an apartment block.
 * This tower is a dormitory for tens of thousands of people: a floor should be
 * ranks of bunk beds packed tightly together, with laundry strung overhead and
 * personal belongings wedged wherever they fit. The paintings showed nobody,
 * nothing extra, and a corridor wide enough to walk four abreast, which is the
 * opposite of the setting.
 *
 * The script is kept because the geometry is right and a repaint will need it:
 * the library renders are already exactly FLOOR_HEIGHT (200) tall and their
 * 320px blocks divide FLOOR_WIDTH by four, so cutting a 1280px window keeps the
 * native pixel scale instead of squashing every door 2.25x.
 *
 * To use it on a repaint: same input geometry (2880x200 or any multiple of 320
 * wide by 200 tall), then set FLOOR_BACKDROP_FILES in src/render/artpack.ts.
 *
 * Usage:
 *   node tools/build-floor-backdrops.mjs            # write the five files
 *   node tools/build-floor-backdrops.mjs --dry-run  # report only
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = join(ROOT, '素材库', '收集素材库', '首章待用美术设定集', '02-场景');
const OUT = join(ROOT, 'public', 'assets', 'env');

/** FLOOR_WIDTH in src/core/constants.ts. The camera never scrolls past this. */
const WORLD_W = 1280;
/** FLOOR_HEIGHT in src/core/constants.ts - the backdrop is already this tall. */
const WORLD_H = 200;
/** The library's 320x200 block size; WORLD_W / 320 = 4 blocks per screen. */
const BLOCK_W = 320;

/**
 * Which four consecutive blocks each floor shows.
 *
 * Block index is 1-based over the nine in that floor's own source strip. Each
 * floor has its OWN 2880px strip, so a block index means something different
 * per floor - this table is a per-floor choice, not a shared crop.
 *
 * NOTE: these indices were chosen against the withdrawn paintings. A repaint
 * will have its own layout and this table has to be re-picked after looking at
 * the new strips. Do not trust these numbers blindly on new art.
 */
const FLOOR_WINDOW = {
  1: { from: 1, note: '（旧图）楼梯 + 房门 + 储物架' },
  2: { from: 2, note: '（旧图）床 + 邻居住房门 + 储物架' },
  3: { from: 3, note: '（旧图）货架 + 储物柜 + 木箱' },
  4: { from: 5, note: '（旧图）管道 + 储罐 + 电箱 + 工作台' },
  5: { from: 6, note: '（旧图）洗手台 + 毛巾 + 铁网门' },
};

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] ?? true : dflt;
}

const dryRun = arg('dry-run', false) === true;

/** Read one floor's source PNG, at its library path. */
function sourcePath(floor) {
  const dirs = {
    1: '01-第一层-玩家宿舍',
    2: '02-第二层-邻居宿舍与空床',
    3: '03-第三层-废弃储物层',
    4: '04-第四层-维修层',
    5: '05-第五层-食堂与验收台',
  };
  const dir = dirs[floor];
  if (!dir) throw new Error(`no library directory for floor ${floor}`);
  const p = join(LIB, dir, '01-固定背景');
  if (!existsSync(p)) throw new Error(`missing: ${p}`);
  const png = readdirSync(p).find((n) => n.endsWith('.png'));
  if (!png) throw new Error(`no png in ${p}`);
  return join(p, png);
}

function cut(src, fromBlock) {
  const img = PNG.sync.read(readFileSync(src));
  if (img.width % BLOCK_W !== 0) {
    throw new Error(`${src}: width ${img.width} is not a multiple of ${BLOCK_W}`);
  }
  const blocks = img.width / BLOCK_W;
  const x0 = (fromBlock - 1) * BLOCK_W;
  if (x0 + WORLD_W > img.width) {
    throw new Error(`${src}: block ${fromBlock} leaves only ${img.width - x0}px, need ${WORLD_W}`);
  }
  const out = new PNG({ width: WORLD_W, height: Math.min(WORLD_H, img.height) });
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const si = (y * img.width + (x0 + x)) * 4;
      const di = (y * out.width + x) * 4;
      out.data[di] = img.data[si];
      out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2];
      out.data[di + 3] = img.data[si + 3];
    }
  }
  return { png: out, blocks };
}

const rows = [];
for (const [floorStr, cfg] of Object.entries(FLOOR_WINDOW)) {
  const floor = Number(floorStr);
  const src = sourcePath(floor);
  const { png, blocks } = cut(src, cfg.from);
  const name = `backdrop-floor${floor}.png`;
  if (!dryRun) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, name), PNG.sync.write(png));
  }
  rows.push({
    floor,
    blocks,
    from: cfg.from,
    to: cfg.from + WORLD_W / BLOCK_W - 1,
    out: name,
    note: cfg.note,
  });
}

console.log('layer  source blocks  window   output');
for (const r of rows) {
  console.log(
    `${r.floor}      ${r.blocks}             ${r.from}-${r.to}    ${r.out}  ${dryRun ? '' : '(written)'}`,
  );
}
console.log('');
for (const r of rows) console.log(`  floor ${r.floor}: ${r.note}`);