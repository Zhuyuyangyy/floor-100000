#!/usr/bin/env node
/**
 * Ingest the owner's five floor backdrops into the game's env asset slots.
 *
 * The 素材库 backdrops are 2880x200 RGBA "one whole floor" renders: ceiling,
 * conduit run, wall, and the walkable ground band, in one image, already at the
 * game's own FLOOR_HEIGHT of 200. They were built against this geometry (the
 * 320x200 block split matches FLOOR_WIDTH/4 exactly), so 2880 = 9 blocks is not
 * a scroll width - it is nine alternative room facades for a floor that only
 * needs four.
 *
 * That is the whole problem this script solves: the game has ONE wall.png and
 * ONE floor.png shared by all five floors, distinguished only by a colour tint
 * in FLOOR_AMBIENCE. So floor 3 looks like floor 1 with a green wash. We have
 * five finished backdrops and have never shown any of them.
 *
 * The fix is a per-floor texture, cut to the world width the camera actually
 * uses (FLOOR_WIDTH = 1280). We do NOT stretch 2880 -> 1280: that would squash
 * every door 2.25x. We pick a contiguous 1280px window (four 320px blocks) out
 * of the nine, per floor, so the wall keeps its native pixel scale and the
 * distinct content (stairs, lockers, sink, mesh gate) survives.
 *
 * Which four blocks each floor gets is a deliberate choice, recorded in
 * FLOOR_WINDOW below: a floor should open on something that says what it is.
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
 * Which four consecutive blocks each floor shows, and why.
 *
 * Block index is 1-based over the nine in that floor's own source strip. Each
 * floor has its OWN 2880px strip drawn to its own design (stairs on floor 1,
 * beds on floor 2, shelving on 3, plant room on 4, sink and mesh gate on 5),
 * so a block index means something different per floor - this table is a
 * per-floor choice, not a shared crop.
 *
 * The strip is nine room facades for a floor that only uses four, so the job is
 * picking the four that say what the floor is at a glance. Verified from the
 * rendered result: floor 1 shows the stair out, floor 2 the beds, floor 3 the
 * crates, floor 4 the pipes, floor 5 the sinks and gate.
 */
const FLOOR_WINDOW = {
  // Floor 1, the player's own room. The stairs out are the point of the floor:
  // the first thing to learn is "you can go up".
  1: { from: 1, note: '楼梯 + 房门 + 储物架：先看懂"能上楼"' },
  // Floor 2, neighbours. Opens on the beds - "other people live here" - and
  // keeps a door and the shelf bay in frame.
  2: { from: 2, note: '两张床 + 邻居住房门 + 储物架' },
  // Floor 3, abandoned storage. Shelving, lockers, crates and no bed: nothing
  // personal. This is where the chapter's materials live.
  3: { from: 3, note: '货架 + 储物柜 + 木箱：没有床，全是存货' },
  // Floor 4, maintenance. Pipes, tanks, the breaker panel and the work bench:
  // this is the floor where things get fixed.
  4: { from: 5, note: '管道 + 储罐 + 电箱 + 工作台' },
  // Floor 5, canteen / inspection desk. The sink bay with towels on one side,
  // the mesh gate on the other - water and a barrier, which is what the canteen
  // and the reinspection counter are.
  5: { from: 6, note: '洗手台 + 毛巾 + 铁网门：食堂与复验台' },
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