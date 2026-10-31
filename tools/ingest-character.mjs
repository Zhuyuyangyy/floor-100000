#!/usr/bin/env node
// Turns a painted character image into a game sprite sheet.
//
// WHY THIS EXISTS: the art brief used to ask an image model for a 15-frame
// 64x96 sprite sheet in one image. That does not work - diffusion models cannot
// hold 15 frames consistent, cannot hit an exact frame size, and cannot keep the
// feet on one baseline. What they CAN do is one clean full-body pose at high
// resolution, which is exactly what this tool needs.
//
//   node tools/ingest-character.mjs player
//
// Reads:   art-src/characters/<key>.png      (one pose, or 6, or 15 poses)
// Writes:  src/assets/characters/<key>.png   (960x96, 15 frames of 64x96)
//
// It downscales with a box filter (area average), snaps every pixel to the
// project's 16-colour palette, and lays the result onto the 15-frame sheet in
// the order the game expects. A single pose is repeated across the frames it
// owns, so the character still LOOKS hand-drawn while the animation is carried
// by whatever the source provides.
//
// Accepts three shapes, so a partial delivery is still usable:
//   1 pose   -> idle + all actions use that pose (the walk uses the procedural art)
//   6 poses  -> the walk cycle comes from art, everything else procedural
//   15 poses -> the whole sheet comes from art

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { encodePng } from './png.mjs';

const FRAME_W = 64;
const FRAME_H = 96;
const FRAMES = 15;
const KEYS = ['player', 'npc_alin', 'npc_xiaozhou', 'wanderer'];

// The project palette, in the order src/render/palette.ts declares it. The
// converter snaps to these and nothing else, which is what makes a painted
// character sit in the same world as the procedural scene.
const PALETTE = [
  [0x05, 0x08, 0x0b], [0x14, 0x20, 0x2c], [0x2c, 0x3f, 0x4e], [0x47, 0x65, 0x7a],
  [0x8a, 0x95, 0xa0], [0x1e, 0x4a, 0x44], [0x2f, 0x6b, 0x5e], [0x4e, 0x9c, 0x86],
  [0x77, 0xc6, 0xa4], [0x6b, 0x46, 0x30], [0xa5, 0x71, 0x4c], [0xd9, 0xb4, 0x8f],
  [0x8a, 0x4a, 0x1e], [0xd9, 0x8b, 0x3c], [0xf4, 0xb6, 0x6a], [0xff, 0xe4, 0xb6],
];

const key = process.argv[2] ?? 'player';
if (!KEYS.includes(key)) {
  console.error(`usage: node tools/ingest-character.mjs <${KEYS.join('|')}>`);
  process.exit(1);
}

const src = join('art-src', 'characters', `${key}.png`);
if (!existsSync(src)) {
  console.error(`missing ${src}`);
  console.error('Put one high-resolution pose there (see docs/ART_BRIEF.md) and run this again.');
  process.exit(1);
}

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
const b64 = readFileSync(src).toString('base64');

// Slice the source into however many poses it holds, then resample each to
// 64x96 with a box filter, keeping alpha.
const out = await page.evaluate(
  async ({ data, FRAME_W, FRAME_H, FRAMES, PALETTE }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();

    // How many poses does this image hold? Prefer a whole number of 64:96
    // columns at the image's own aspect; fall back to 1, 6, 15.
    const aspect = img.width / img.height;
    const perFrame = aspect / (FRAME_W / FRAME_H);
    const candidates = [1, 6, 15];
    let poses = candidates.reduce((best, c) => (Math.abs(perFrame - c) < Math.abs(perFrame - best) ? c : best), 1);
    // A blown-up single pose (e.g. 512x768) is still one pose.
    if (img.width / img.height < 0.5) poses = 1;

    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0);
    const srcData = ctx.getImageData(0, 0, img.width, img.height).data;

    const poseW = Math.floor(img.width / poses);
    const frames = [];
    for (let p = 0; p < poses; p++) {
      const small = document.createElement('canvas');
      small.width = FRAME_W;
      small.height = FRAME_H;
      const sctx = small.getContext('2d');
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(c, p * poseW, 0, poseW, img.height, 0, 0, FRAME_W, FRAME_H);
      const d = sctx.getImageData(0, 0, FRAME_W, FRAME_H).data;
      const frame = new Array(FRAME_W * FRAME_H * 4);
      let opaque = 0;
      for (let i = 0; i < FRAME_W * FRAME_H; i++) {
        const a = d[i * 4 + 3];
        if (a < 90) {
          frame[i * 4] = 0;
          frame[i * 4 + 1] = 0;
          frame[i * 4 + 2] = 0;
          frame[i * 4 + 3] = 0;
          continue;
        }
        opaque++;
        // Nearest palette colour, in linear-ish RGB distance.
        const r = d[i * 4];
        const g = d[i * 4 + 1];
        const b = d[i * 4 + 2];
        let best = 0;
        let bestD = Infinity;
        for (let k = 0; k < PALETTE.length; k++) {
          const [pr, pg, pb] = PALETTE[k];
          const dist = (r - pr) ** 2 * 0.3 + (g - pg) ** 2 * 0.59 + (b - pb) ** 2 * 0.11;
          if (dist < bestD) {
            bestD = dist;
            best = k;
          }
        }
        frame[i * 4] = PALETTE[best][0];
        frame[i * 4 + 1] = PALETTE[best][1];
        frame[i * 4 + 2] = PALETTE[best][2];
        frame[i * 4 + 3] = 255;
      }
      frames.push({ px: frame, opaque });
    }
    void srcData;
    return { poses, frames };
  },
  { data: b64, FRAME_W, FRAME_H, FRAMES, PALETTE },
);
await browser.close();

// Build the 15-frame sheet. Frames the source does not cover are left fully
// transparent, and the game falls back to the procedural art for those actions.
const W = FRAME_W * FRAMES;
const H = FRAME_H;
const sheet = new Uint8Array(W * H * 4);
const pick = (i) => out.frames[Math.min(i, out.frames.length - 1)].px;
// pose mapping: with 1 pose every frame uses it; with 6 the walk cycles and the
// rest reuse the last; with 15 it is one-to-one.
for (let f = 0; f < FRAMES; f++) {
  const poseIdx = out.poses === 1 ? 0 : out.poses === 6 ? f % 6 : Math.min(f, out.poses - 1);
  const px = pick(poseIdx);
  for (let y = 0; y < FRAME_H; y++) {
    for (let x = 0; x < FRAME_W; x++) {
      const s = (y * FRAME_W + x) * 4;
      const o = (y * W + f * FRAME_W + x) * 4;
      sheet[o] = px[s];
      sheet[o + 1] = px[s + 1];
      sheet[o + 2] = px[s + 2];
      sheet[o + 3] = px[s + 3];
    }
  }
}

// Feet check: the lowest opaque row should be the last row of the frame, or the
// character floats. Report it rather than silently accepting it.
const first = out.frames[0].px;
let lowest = -1;
for (let y = 0; y < FRAME_H; y++) {
  for (let x = 0; x < FRAME_W; x++) if (first[(y * FRAME_W + x) * 4 + 3] > 0) lowest = y;
}

const dstDir = join('src', 'assets', 'characters');
mkdirSync(dstDir, { recursive: true });
const dst = join(dstDir, `${key}.png`);
writeFileSync(dst, encodePng({ width: W, height: H, channels: 4, pixels: Buffer.from(sheet) }));

console.log(`read   ${src}`);
console.log(`poses  ${out.poses} (${out.frames.map((f) => f.opaque).join(', ')} opaque px each)`);
console.log(`feet   lowest opaque row ${lowest} of 0..${FRAME_H - 1}` + (lowest < FRAME_H - 1 ? `  <-- ${FRAME_H - 1 - lowest}px of empty space, the sprite will float` : '  (good)'));
console.log(`wrote  ${dst}  (${W}x${H}, ${FRAMES} frames)`);
if (lowest < 0) {
  console.error('the source has no opaque pixels after quantisation - check that it has a transparent or plain background');
  process.exitCode = 1;
}
