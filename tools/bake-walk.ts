// Bakes the walk cycle frames to PNG for visual review.
// Run: node tools/bake-walk.ts [characterKey] [outDir] [--dump]
// Writes 1x frames plus a 4x nearest-neighbour contact sheet.
// `--sheet` writes the game-ready 20x64x96 spritesheet instead of review frames.
//
// The sheet is walk(6) + idle(2) + attack(3) + hurt(2) + search(2) + die(3)
// + pickup(2) = 20 columns, in that order, matching TOTAL_FRAMES.
//
// 2026-11-27 修：这里原来只烘前 15 帧（walk/idle/attack/hurt/search），
// 而 TOTAL_FRAMES 在加入 die(3)+pickup(2) 之后已经是 20。下面的断言因此
// 每次运行都抛错——工具自 die/pickup 落地起就是坏的，只是没人跑过。
// 现在补齐两段，并且配色改为直接读 CHARACTER_PALETTES，不再自己维护一份
// 副本（那份副本漏了后来新增的四个住户，正是它挡住了给老陈/大刘/小满出图）。

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from './png.mjs';
import {
  WALK_FRAMES,
  IDLE_FRAMES,
  ATTACK_FRAMES,
  HURT_FRAMES,
  SEARCH_FRAMES,
  DIE_FRAMES,
  PICKUP_FRAMES,
  ATTACK_FRAME_START,
  HURT_FRAME_START,
  SEARCH_FRAME_START,
  DIE_FRAME_START,
  PICKUP_FRAME_START,
  TOTAL_FRAMES,
  FRAME_W,
  FRAME_H,
  walkPose,
  idlePose,
  attackPose,
  hurtPose,
  searchPose,
  diePose,
  pickupPose,
  drawPose,
  makeCanvas,
  CHARACTER_PALETTES,
  type CharacterKey,
  type Pose,
} from '../src/render/walkcycle.ts';

const key = process.argv[2] ?? 'player';
const outDir = process.argv[3] ?? 're/frames';
const wantSheet = process.argv.includes('--sheet');
mkdirSync(outDir, { recursive: true });

const col = CHARACTER_PALETTES[key as CharacterKey];
if (!col) {
  throw new Error(
    `unknown character ${key}; known: ${Object.keys(CHARACTER_PALETTES).join(', ')}`,
  );
}

// 帧清单与 sheet 列号一一对应，bakeWalkSheets() 用的是同一套起始列常量。
const SEGMENTS: ReadonlyArray<{ label: string; count: number; pose: (f: number) => Pose }> = [
  { label: 'walk', count: WALK_FRAMES, pose: walkPose },
  { label: 'idle', count: IDLE_FRAMES, pose: idlePose },
  { label: 'attack', count: ATTACK_FRAMES, pose: attackPose },
  { label: 'hurt', count: HURT_FRAMES, pose: hurtPose },
  { label: 'search', count: SEARCH_FRAMES, pose: searchPose },
  { label: 'die', count: DIE_FRAMES, pose: diePose },
  { label: 'pickup', count: PICKUP_FRAMES, pose: pickupPose },
];

const frames: Uint8Array[] = [];
const labels: string[] = [];
for (const seg of SEGMENTS) {
  for (let f = 0; f < seg.count; f++) {
    const cv = makeCanvas(FRAME_W, FRAME_H);
    drawPose(cv, seg.pose(f), col, 0);
    frames.push(cv.px);
    labels.push(`${seg.label} ${f}`);
  }
}
// 与 walkcycle.TOTAL_FRAMES 对齐：少一帧说明上面两处不同步。
if (frames.length !== TOTAL_FRAMES) {
  throw new Error(`baked ${frames.length} frames but TOTAL_FRAMES is ${TOTAL_FRAMES}`);
}

const total = frames.length;

// individual 1x frames
for (let f = 0; f < total; f++) {
  const buf = rgbaToPng(frames[f], FRAME_W, FRAME_H);
  writeFileSync(join(outDir, `${key}-f${f}.png`), buf);
}

// 4x contact sheet, nearest neighbour, real alpha preserved
const SCALE = 4;
const cols = total;
const rows = 1;
const W = FRAME_W * cols * SCALE;
const H = FRAME_H * rows * SCALE;
const sheet = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const cell = Math.floor(x / (FRAME_W * SCALE));
    const fx = Math.floor((x % (FRAME_W * SCALE)) / SCALE);
    const fy = Math.floor(y / SCALE);
    const s = (fy * FRAME_W + fx) * 4;
    const a = frames[cell][s + 3];
    // TRANSPARENT, not a checkerboard.
    //
    // This used to paint an opaque checkerboard behind the alpha so the sheet
    // looked right in an image viewer - which made every exported sheet fully
    // opaque, and that quietly broke two things: the silhouette audit could not
    // find the figure (every row measured 64px wide) and the sheet could not be
    // dropped into the game or into an art tool as a real sprite sheet. A viewer
    // shows transparency as a checkerboard on its own; baking one in only
    // destroys the information.
    sheet[o] = frames[cell][s];
    sheet[o + 1] = frames[cell][s + 1];
    sheet[o + 2] = frames[cell][s + 2];
    sheet[o + 3] = a;
  }
}
writeFileSync(join(outDir, `${key}-sheet.png`), rgbaToPng(sheet, W, H));
console.log(
  `wrote ${total} frames + sheet to ${outDir} ` +
    `(walk 0-${WALK_FRAMES - 1}, idle ${WALK_FRAMES}-${WALK_FRAMES + IDLE_FRAMES - 1}, ` +
    `attack ${ATTACK_FRAME_START}-${ATTACK_FRAME_START + ATTACK_FRAMES - 1}, ` +
    `hurt ${HURT_FRAME_START}-${HURT_FRAME_START + HURT_FRAMES - 1}, ` +
    `search ${SEARCH_FRAME_START}-${SEARCH_FRAME_START + SEARCH_FRAMES - 1}, ` +
    `die ${DIE_FRAME_START}-${DIE_FRAME_START + DIE_FRAMES - 1}, ` +
    `pickup ${PICKUP_FRAME_START}-${PICKUP_FRAME_START + PICKUP_FRAMES - 1})`,
);

// ASCII dump: one char per palette role, so the pixel placement can be reviewed
// in a terminal (or a model that cannot view images).
const ROLE: Array<[number, number, number, string]> = [
  [col.outline[0], col.outline[1], col.outline[2], '#'],
  [col.cloth[0], col.cloth[1], col.cloth[2], 'o'],
  [col.clothDark[0], col.clothDark[1], col.clothDark[2], 'd'],
  [col.clothLight[0], col.clothLight[1], col.clothLight[2], 'O'],
  [col.trouser[0], col.trouser[1], col.trouser[2], 't'],
  [col.trouserDark[0], col.trouserDark[1], col.trouserDark[2], 'T'],
  [col.boot[0], col.boot[1], col.boot[2], 'b'],
  [col.skin[0], col.skin[1], col.skin[2], 's'],
  [col.skinDark[0], col.skinDark[1], col.skinDark[2], 'S'],
  [col.hair[0], col.hair[1], col.hair[2], 'h'],
  [col.pack[0], col.pack[1], col.pack[2], 'p'],
  [col.packDark[0], col.packDark[1], col.packDark[2], 'P'],
];
function roleOf(px: Uint8Array, o: number): string {
  if (px[o + 3] === 0) return '.';
  for (const [r, g, b, ch] of ROLE) if (px[o] === r && px[o + 1] === g && px[o + 2] === b) return ch;
  return '?';
}
if (process.argv.includes('--dump')) {
  for (let f = 0; f < total; f++) {
    console.log(`\n=== ${key} frame ${f} (${labels[f]}) ===`);
    for (let y = 0; y < FRAME_H; y++) {
      let line = '';
      for (let x = 0; x < FRAME_W; x++) line += roleOf(frames[f], (y * FRAME_W + x) * 4);
      console.log(line.replace(/\.+$/, ''));
    }
  }
}

// ── game-ready sheet ─────────────────────────────────────────────────────
// The review sheet above is 4x, which is right for looking at and wrong for
// shipping. `--sheet` writes the 1:1 20x64x96 strip that BootScene's
// import.meta.glob('assets/characters/*.png') picks up as a spritesheet —
// dropping the file in is the whole install, no registry edit.
if (wantSheet) {
  const sheetW = FRAME_W * total;
  const flat = new Uint8Array(sheetW * FRAME_H * 4);
  for (let f = 0; f < total; f++) {
    for (let y = 0; y < FRAME_H; y++) {
      for (let x = 0; x < FRAME_W; x++) {
        const s = (y * FRAME_W + x) * 4;
        const d = (y * sheetW + f * FRAME_W + x) * 4;
        flat[d] = frames[f][s];
        flat[d + 1] = frames[f][s + 1];
        flat[d + 2] = frames[f][s + 2];
        flat[d + 3] = frames[f][s + 3];
      }
    }
  }
  const out = join(outDir, `${key}.png`);
  writeFileSync(out, rgbaToPng(flat, sheetW, FRAME_H));
  console.log(`wrote ${sheetW}x${FRAME_H} game sheet (${total} frames) -> ${out}`);
}

function rgbaToPng(px: Uint8Array, w: number, h: number): Buffer {
  return encodePng({ width: w, height: h, channels: 4, pixels: Buffer.from(px) });
}
