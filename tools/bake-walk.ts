// Bakes the walk cycle frames to PNG for visual review.
// Run: node tools/bake-walk.ts [characterKey] [outDir] [--dump]
// Writes 1x frames plus a 4x nearest-neighbour contact sheet.
//
// W5: the sheet is walk(6) + idle(2) + attack(3) + hurt(2) + search(2) = 15
// columns. The one-shot segments are appended, so the ASCII dump below is
// printed in four labelled sections instead of one flat run of frames.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from './png.mjs';
import {
  WALK_FRAMES,
  IDLE_FRAMES,
  ATTACK_FRAMES,
  HURT_FRAMES,
  SEARCH_FRAMES,
  ATTACK_FRAME_START,
  HURT_FRAME_START,
  SEARCH_FRAME_START,
  TOTAL_FRAMES,
  FRAME_W,
  FRAME_H,
  walkPose,
  idlePose,
  attackPose,
  hurtPose,
  searchPose,
  drawPose,
  makeCanvas,
  PLAYER_COLORS,
  ALIN_COLORS,
  XIAOZHOU_COLORS,
  WANDERER_COLORS,
  type CharacterColors,
  type Pose,
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

// 帧清单与 sheet 列号一一对应，bakeWalkSheets() 用的是同一套起始列常量。
const SEGMENTS: ReadonlyArray<{ label: string; count: number; pose: (f: number) => Pose }> = [
  { label: 'walk', count: WALK_FRAMES, pose: walkPose },
  { label: 'idle', count: IDLE_FRAMES, pose: idlePose },
  { label: 'attack', count: ATTACK_FRAMES, pose: attackPose },
  { label: 'hurt', count: HURT_FRAMES, pose: hurtPose },
  { label: 'search', count: SEARCH_FRAMES, pose: searchPose },
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
console.log(
  `wrote ${total} frames + sheet to ${outDir} ` +
    `(walk 0-${WALK_FRAMES - 1}, idle ${WALK_FRAMES}-${WALK_FRAMES + IDLE_FRAMES - 1}, ` +
    `attack ${ATTACK_FRAME_START}-${ATTACK_FRAME_START + ATTACK_FRAMES - 1}, ` +
    `hurt ${HURT_FRAME_START}-${HURT_FRAME_START + HURT_FRAMES - 1}, ` +
    `search ${SEARCH_FRAME_START}-${SEARCH_FRAME_START + SEARCH_FRAMES - 1})`,
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

function rgbaToPng(px: Uint8Array, w: number, h: number): Buffer {
  return encodePng({ width: w, height: h, channels: 4, pixels: Buffer.from(px) });
}
