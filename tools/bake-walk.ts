// Bakes the walk cycle frames to PNG for visual review.
// Run: node tools/bake-walk.ts [characterKey] [outDir]
// Writes 1x frames plus a 4x nearest-neighbour contact sheet.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from './png.mjs';
import {
  WALK_FRAMES,
  IDLE_FRAMES,
  FRAME_W,
  FRAME_H,
  walkPose,
  idlePose,
  drawPose,
  makeCanvas,
  PLAYER_COLORS,
  ALIN_COLORS,
  XIAOZHOU_COLORS,
  WANDERER_COLORS,
  type CharacterColors,
} from '../src/render/walkcycle.ts';

const key = process.argv[2] ?? 'player';
const outDir = process.argv[3] ?? 're/frames';
mkdirSync(outDir, { recursive: true });

const COLORS: Record<string, CharacterColors> = {
  player: PLAYER_COLORS,
  npc_alin: ALIN_COLORS,
  npc_xiaozhou: XIAOZHOU_COLORS,
  wanderer: WANDERER_COLORS,
};
const col = COLORS[key];
if (!col) throw new Error(`unknown character ${key}`);

const total = WALK_FRAMES + IDLE_FRAMES;
const frames: Uint8Array[] = [];
for (let f = 0; f < WALK_FRAMES; f++) {
  const cv = makeCanvas(FRAME_W, FRAME_H);
  drawPose(cv, walkPose(f), col, 0);
  frames.push(cv.px);
}
for (let f = 0; f < IDLE_FRAMES; f++) {
  const cv = makeCanvas(FRAME_W, FRAME_H);
  drawPose(cv, idlePose(f), col, 0);
  frames.push(cv.px);
}

// individual 1x frames
for (let f = 0; f < total; f++) {
  const buf = rgbaToPng(frames[f], FRAME_W, FRAME_H);
  writeFileSync(join(outDir, `${key}-f${f}.png`), buf);
}

// 4x contact sheet, nearest neighbour, checkerboard background for alpha
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
    if (a === 0) {
      const dark = (Math.floor(x / SCALE) + Math.floor(y / SCALE)) % 2 === 0;
      sheet[o] = dark ? 40 : 60;
      sheet[o + 1] = dark ? 44 : 66;
      sheet[o + 2] = dark ? 52 : 74;
      sheet[o + 3] = 255;
    } else {
      sheet[o] = frames[cell][s];
      sheet[o + 1] = frames[cell][s + 1];
      sheet[o + 2] = frames[cell][s + 2];
      sheet[o + 3] = 255;
    }
  }
}
writeFileSync(join(outDir, `${key}-sheet.png`), rgbaToPng(sheet, W, H));
console.log(`wrote ${total} frames + sheet to ${outDir}`);

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
const want = process.argv.includes('--dump');
if (want) {
  for (let f = 0; f < total; f++) {
    console.log(`\n=== ${key} frame ${f} ===`);
    for (let y = 0; y < FRAME_H; y++) {
      let line = '';
      for (let x = 0; x < FRAME_W; x++) line += roleOf(frames[f], (y * FRAME_W + x) * 4);
      console.log(line.replace(/\.+$/, ''));
    }
  }
}

function rgbaToPng(px: Uint8Array, w: number, h: number): Buffer {
  return encodePng({ width: w, height: h, channels: 4, pixels: Buffer.from(px) });
}
