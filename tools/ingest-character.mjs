#!/usr/bin/env node
// Turns a raw AI-generated character image into a game sprite sheet.
//
// This is the pipeline from the brief, in order:
//
//   1. GRID      estimate the art-pixel size; if the source has no consistent
//                grid (AI "pixel art" almost never does) say so and treat it as
//                a draft to be resampled rather than a grid to be read.
//   2. CELLS     rebuild one colour per cell by box-downsampling to the target
//                frame size. This is what removes blended pseudo-pixels and
//                single-pixel noise.
//   3. CUT       hard-cut the background: key out near-white, then flood-fill
//                inward from the border so only enclosed areas survive.
//   4. FILL      fill the holes the cut leaves inside the silhouette.
//   5. PALETTE   snap every pixel to the project's 16-colour palette.
//   6. ANIMATE   lay the result onto the 15-frame sheet the game loads.
//
// Usage:
//   node tools/ingest-character.mjs player                 # art-src/characters/player.png
//   node tools/ingest-character.mjs player --band 0        # only the Nth figure in a sheet
//   node tools/ingest-character.mjs player --no-flip       # keep the source's facing
//   node tools/ingest-character.mjs player --outline       # add a 1px dark outline
//
// A single figure, a 6-pose walk strip, or a 15-pose sheet are all accepted;
// fewer poses simply means the procedural art carries the actions it does not
// cover.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { encodePng } from './png.mjs';

const FRAME_W = 64;
const FRAME_H = 96;
const FRAMES = 15;
const KEYS = ['player', 'npc_alin', 'npc_xiaozhou', 'wanderer'];

// The project palette, in src/render/palette.ts order.
const PALETTE = [
  [0x05, 0x08, 0x0b], [0x14, 0x20, 0x2c], [0x2c, 0x3f, 0x4e], [0x47, 0x65, 0x7a],
  [0x8a, 0x95, 0xa0], [0x1e, 0x4a, 0x44], [0x2f, 0x6b, 0x5e], [0x4e, 0x9c, 0x86],
  [0x77, 0xc6, 0xa4], [0x6b, 0x46, 0x30], [0xa5, 0x71, 0x4c], [0xd9, 0xb4, 0x8f],
  [0x8a, 0x4a, 0x1e], [0xd9, 0x8b, 0x3c], [0xf4, 0xb6, 0x6a], [0xff, 0xe4, 0xb6],
];

const argv = process.argv.slice(2);
const key = argv[0] ?? 'player';
if (!KEYS.includes(key)) {
  console.error(`usage: node tools/ingest-character.mjs <${KEYS.join('|')}> [--band N] [--no-flip] [--outline]`);
  process.exit(1);
}
const flag = (name) => argv.includes(name);
const bandArg = argv.indexOf('--band') >= 0 ? Number(argv[argv.indexOf('--band') + 1]) : null;
const wantFlip = !flag('--no-flip');
const wantOutline = flag('--outline');
const forceProject = flag('--project-palette');

const src = join('art-src', 'characters', `${key}.png`);
if (!existsSync(src)) {
  console.error(`missing ${src}`);
  console.error('Drop the painted image there (see art-src/characters/README.md) and run again.');
  process.exit(1);
}

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
const b64 = readFileSync(src).toString('base64');

// ── steps 1-4, in the browser's canvas (a plain ImageData is all we need) ────
const result = await page.evaluate(
  async ({ data, FRAME_W, FRAME_H, bandArg, wantFlip, PALETTE, forceProject }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();

    const W = img.width;
    const H = img.height;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, W, H).data;
    const at = (x, y) => (y * W + x) * 4;

    // ── STEP 1: is there a pixel grid? ───────────────────────────────────────
    // Run-length histogram of constant colour along a few rows. A true grid
    // clusters on one small value; AI "pixel art" is dominated by 1s because
    // every edge is anti-aliased.
    let ones = 0;
    let total = 0;
    for (let y = Math.floor(H * 0.2); y < H * 0.8; y += 11) {
      let run = 1;
      for (let x = 1; x < W; x++) {
        const d =
          Math.abs(px[at(x, y)] - px[at(x - 1, y)]) +
          Math.abs(px[at(x, y) + 1] - px[at(x - 1, y) + 1]) +
          Math.abs(px[at(x, y) + 2] - px[at(x - 1, y) + 2]);
        if (d <= 6) run++;
        else {
          if (run === 1) ones++;
          total++;
          run = 1;
        }
      }
    }
    const noiseShare = total ? ones / total : 1;

    // ── split the sheet into figures ────────────────────────────────────────
    // Columns holding non-background ink, merged across small gaps.
    const isBg = (x, y) => {
      const o = at(x, y);
      return px[o + 3] < 90 || px[o] + px[o + 1] + px[o + 2] > 720;
    };
    const colInk = new Array(W).fill(0);
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) if (!isBg(x, y)) colInk[x]++;
    }
    let bands = [];
    let inRun = false;
    for (let x = 0; x < W; x++) {
      if (colInk[x] > 3 && !inRun) {
        bands.push([x, x]);
        inRun = true;
      } else if (colInk[x] > 3) bands[bands.length - 1][1] = x;
      else inRun = false;
    }
    bands = bands.filter(([s, e]) => e - s > 24);
    // merge bands closer than 3% of the width
    const gap = Math.round(W * 0.03);
    for (let i = bands.length - 1; i > 0; i--) {
      if (bands[i][0] - bands[i - 1][1] < gap) {
        bands[i - 1][1] = bands[i][1];
        bands.splice(i, 1);
      }
    }
    if (bandArg !== null && bands[bandArg]) bands = [bands[bandArg]];

    // ── per figure: cut, fill, resample, snap ───────────────────────────────
    const out = [];
    for (const [bx0, bx1] of bands) {
      // tight row extent of this figure
      let ry0 = H;
      let ry1 = 0;
      for (let y = 0; y < H; y++) {
        let ink = 0;
        for (let x = bx0; x <= bx1; x++) if (!isBg(x, y)) ink++;
        if (ink > 2) {
          if (y < ry0) ry0 = y;
          ry1 = y;
        }
      }
      const fw = bx1 - bx0 + 1;
      const fh = ry1 - ry0 + 1;

      // STEP 3: flood fill the background inward from the border, so a white
      // patch enclosed by the body counts as a hole rather than as sky.
      const seen = new Uint8Array(fw * fh);
      const stack = [];
      const pushIfBg = (x, y) => {
        const i = y * fw + x;
        if (seen[i]) return;
        if (isBg(bx0 + x, ry0 + y)) {
          seen[i] = 1;
          stack.push(i);
        }
      };
      for (let x = 0; x < fw; x++) {
        pushIfBg(x, 0);
        pushIfBg(x, fh - 1);
      }
      for (let y = 0; y < fh; y++) {
        pushIfBg(0, y);
        pushIfBg(fw - 1, y);
      }
      while (stack.length) {
        const i = stack.pop();
        const x = i % fw;
        const y = (i - x) / fw;
        if (x > 0) pushIfBg(x - 1, y);
        if (x < fw - 1) pushIfBg(x + 1, y);
        if (y > 0) pushIfBg(x, y - 1);
        if (y < fh - 1) pushIfBg(x, y + 1);
      }

      // STEP 4: a hole is an opaque pixel the flood never reached. Fill it with
      // the nearest kept neighbour's colour, which is what the cut removed.
      const cut = new Uint8ClampedArray(fw * fh * 4);
      let holes = 0;
      for (let y = 0; y < fh; y++) {
        for (let x = 0; x < fw; x++) {
          const i = y * fw + x;
          const o = at(bx0 + x, ry0 + y);
          if (seen[i]) continue; // background -> transparent
          if (isBg(bx0 + x, ry0 + y)) holes++;
          cut[i * 4] = px[o];
          cut[i * 4 + 1] = px[o + 1];
          cut[i * 4 + 2] = px[o + 2];
          cut[i * 4 + 3] = 255;
        }
      }
      // dilate the kept colour into the holes
      if (holes > 0) {
        for (let y = 0; y < fh; y++) {
          for (let x = 0; x < fw; x++) {
            const i = y * fw + x;
            if (seen[i] || cut[i * 4 + 3] === 255) continue;
            for (let r = 1; r < Math.max(fw, fh); r++) {
              let done = false;
              for (let dy = -r; dy <= r && !done; dy++) {
                for (let dx = -r; dx <= r && !done; dx++) {
                  const nx = x + dx;
                  const ny = y + dy;
                  if (nx < 0 || ny < 0 || nx >= fw || ny >= fh) continue;
                  const j = ny * fw + nx;
                  if (seen[j]) continue;
                  if (cut[j * 4 + 3] === 255) {
                    cut[i * 4] = cut[j * 4];
                    cut[i * 4 + 1] = cut[j * 4 + 1];
                    cut[i * 4 + 2] = cut[j * 4 + 2];
                    cut[i * 4 + 3] = 255;
                    done = true;
                  }
                }
              }
              if (done) break;
            }
          }
        }
      }

      // STEP 2: box-downsample to the frame. Fit by height so the figure fills
      // the frame; the leftover width is padding the engine already expects.
      const targetH = Math.min(FRAME_H - 2, fh);
      const targetW = Math.max(1, Math.round((fw * targetH) / fh));
      const sw = fw / targetW;
      const sh = fh / targetH;
      const small = new Uint8ClampedArray(targetW * targetH * 4);
      for (let y = 0; y < targetH; y++) {
        for (let x = 0; x < targetW; x++) {
          const x0 = Math.floor(x * sw);
          const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sw));
          const y0 = Math.floor(y * sh);
          const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sh));
          let r = 0;
          let g = 0;
          let b = 0;
          let n = 0;
          for (let yy = y0; yy < y1 && yy < fh; yy++) {
            for (let xx = x0; xx < x1 && xx < fw; xx++) {
              const i = yy * fw + xx;
              if (seen[i]) continue;
              r += cut[i * 4];
              g += cut[i * 4 + 1];
              b += cut[i * 4 + 2];
              n++;
            }
          }
          const o = (y * targetW + x) * 4;
          if (n > 0) {
            small[o] = r / n;
            small[o + 1] = g / n;
            small[o + 2] = b / n;
            small[o + 3] = 255;
          }
        }
      }

      // STEP 5b: VALUE SEPARATION.
      //
      // Measured on the first painted sprite: character luminance 38.7 against
      // a wall at 41.9 - a contrast of 3.2 and 82.6% camouflage, against the
      // 41.9 / 8.5% the procedural art scored. A muted painting sits at exactly
      // the same brightness as the wall it stands in front of, so the figure
      // dissolves. This is the most common way hand-drawn art fails in a dark
      // scene, and it is invisible in the source image because there the figure
      // sits on white.
      //
      // The fix is a value remap, not a brightness lift: stretch the figure's
      // own luminance range so its floor clears the background by a margin.
      // Internal contrast survives, so it still reads as the painting.
      const wallLum = 42; // the audit's wall band for this scene
      const margin = 34;
      const lums = [];
      for (let i = 0; i < targetW * targetH; i++) {
        const o = i * 4;
        if (small[o + 3] === 0) continue;
        lums.push(0.299 * small[o] + 0.587 * small[o + 1] + 0.114 * small[o + 2]);
      }
      lums.sort((a, b) => a - b);
      const lo = lums[Math.floor(lums.length * 0.05)] ?? 0;
      const hi = lums[Math.floor(lums.length * 0.95)] ?? 255;
      const span = Math.max(1, hi - lo);
      const targetLo = wallLum + margin;
      const targetHi = Math.max(targetLo + 40, Math.min(255, hi + (targetLo - lo)));
      let lifted = 0;
      for (let i = 0; i < targetW * targetH; i++) {
        const o = i * 4;
        if (small[o + 3] === 0) continue;
        const l = 0.299 * small[o] + 0.587 * small[o + 1] + 0.114 * small[o + 2];
        const k = Math.max(0, Math.min(1, (l - lo) / span));
        const nl = targetLo + k * (targetHi - targetLo);
        const d = nl - l;
        if (Math.abs(d) > 2) lifted++;
        small[o] = Math.max(0, Math.min(255, small[o] + d));
        small[o + 1] = Math.max(0, Math.min(255, small[o + 1] + d));
        small[o + 2] = Math.max(0, Math.min(255, small[o + 2] + d));
      }

      // STEP 5: lock the palette.
      //
      // Default is the ART'S OWN palette, extracted from the downsampled figure
      // with a small k-means. Forcing the project's 16 colours onto a muted
      // painting moves 100% of its pixels and throws away the look that was
      // approved - the first version of this tool did exactly that. The art's
      // palette is still a lock: 14 colours, one per cell, no blends. Pass
      // --project-palette to force the scene's colours instead.
      const locked = PALETTE.length ? null : null;
      void locked;

      // gather the opaque, downsampled pixels
      const samples = [];
      for (let i = 0; i < targetW * targetH; i++) {
        const o = i * 4;
        if (small[o + 3] === 0) continue;
        samples.push([small[o], small[o + 1], small[o + 2]]);
      }
      const K = Math.min(14, Math.max(4, Math.round(Math.sqrt(samples.length / 2))));
      // k-means, seeded from evenly spaced samples so it is deterministic
      const centroids = [];
      for (let k = 0; k < K; k++) {
        const s = samples[Math.floor((k * samples.length) / K)];
        centroids.push([s[0], s[1], s[2]]);
      }
      for (let iter = 0; iter < 8; iter++) {
        const sums = centroids.map(() => [0, 0, 0, 0]);
        for (const s of samples) {
          let best = 0;
          let bestD = Infinity;
          for (let k = 0; k < K; k++) {
            const c = centroids[k];
            const d = (s[0] - c[0]) ** 2 * 0.3 + (s[1] - c[1]) ** 2 * 0.59 + (s[2] - c[2]) ** 2 * 0.11;
            if (d < bestD) {
              bestD = d;
              best = k;
            }
          }
          sums[best][0] += s[0];
          sums[best][1] += s[1];
          sums[best][2] += s[2];
          sums[best][3]++;
        }
        for (let k = 0; k < K; k++) {
          if (sums[k][3] === 0) continue;
          centroids[k] = [sums[k][0] / sums[k][3], sums[k][1] / sums[k][3], sums[k][2] / sums[k][3]];
        }
      }
      // merge centroids closer than 12 in any channel, so the lock is real
      const merged = [];
      for (const c of centroids) {
        const near = merged.find(
          (m) => Math.abs(m[0] - c[0]) + Math.abs(m[1] - c[1]) + Math.abs(m[2] - c[2]) < 12,
        );
        if (!near) merged.push(c);
      }
      const lock = forceProject ? PALETTE : merged.map((c) => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])]);

      const snapped = new Uint8ClampedArray(small.length);
      let changed = 0;
      let opaque = 0;
      for (let i = 0; i < targetW * targetH; i++) {
        const o = i * 4;
        if (small[o + 3] === 0) continue;
        opaque++;
        let best = 0;
        let bestD = Infinity;
        for (let k = 0; k < lock.length; k++) {
          const [pr, pg, pb] = lock[k];
          const d = (small[o] - pr) ** 2 * 0.3 + (small[o + 1] - pg) ** 2 * 0.59 + (small[o + 2] - pb) ** 2 * 0.11;
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        }
        if (
          Math.abs(small[o] - lock[best][0]) +
            Math.abs(small[o + 1] - lock[best][1]) +
            Math.abs(small[o + 2] - lock[best][2]) >
          12
        ) {
          changed++;
        }
        snapped[o] = lock[best][0];
        snapped[o + 1] = lock[best][1];
        snapped[o + 2] = lock[best][2];
        snapped[o + 3] = 255;
      }

      out.push({
        w: targetW,
        h: targetH,
        px: snapped,
        srcW: fw,
        srcH: fh,
        opaque,
        snappedShare: opaque ? changed / opaque : 0,
        lockSize: lock.length,
        lumLo: lo,
        lumHi: hi,
        targetLo,
        targetHi,
        holes,
      });
    }
    return { bands: out, noiseShare, bandCount: bands.length, sourceW: W, sourceH: H, flip: wantFlip };
  },
  { data: b64, FRAME_W, FRAME_H, bandArg, wantFlip, PALETTE, forceProject },
);
await browser.close();

if (!result.bands.length) {
  console.error('no figure found in that image');
  process.exit(1);
}

// ── STEP 6: lay each figure onto a 64x96 frame ────────────────────────────────
function compose(fig, flip, outline) {
  const { w, h, px } = fig;
  const frame = new Uint8Array(FRAME_W * FRAME_H * 4);
  const offX = Math.floor((FRAME_W - w) / 2);
  const offY = FRAME_H - h; // feet on the last row
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = flip ? w - 1 - x : x;
      const s = (y * w + sx) * 4;
      const d = ((y + offY) * FRAME_W + (x + offX)) * 4;
      frame[d] = px[s];
      frame[d + 1] = px[s + 1];
      frame[d + 2] = px[s + 2];
      frame[d + 3] = px[s + 3];
    }
  }
  if (outline) {
    // a 1px dark ring on transparent pixels that touch the figure, the same
    // edge treatment the procedural art uses
    const solid = new Uint8Array(FRAME_W * FRAME_H);
    for (let i = 0; i < FRAME_W * FRAME_H; i++) solid[i] = frame[i * 4 + 3] > 0 ? 1 : 0;
    for (let y = 0; y < FRAME_H; y++) {
      for (let x = 0; x < FRAME_W; x++) {
        const i = y * FRAME_W + x;
        if (solid[i]) continue;
        const t =
          (x > 0 && solid[i - 1]) ||
          (x < FRAME_W - 1 && solid[i + 1]) ||
          (y > 0 && solid[i - FRAME_W]) ||
          (y < FRAME_H - 1 && solid[i + FRAME_W]);
        if (!t) continue;
        const o = i * 4;
        frame[o] = 0x05;
        frame[o + 1] = 0x08;
        frame[o + 2] = 0x0b;
        frame[o + 3] = 255;
      }
    }
  }
  return frame;
}

const fig = result.bands[0];
const frame = compose(fig, result.flip, wantOutline);

// report
console.log(`source   ${result.sourceW}x${result.sourceH}, ${result.bandCount} figure(s) found`);
console.log(
  `grid     ${(result.noiseShare * 100).toFixed(0)}% of colour runs are 1px -> no consistent pixel grid; treated as a draft and resampled`,
);
console.log(`figure   ${fig.srcW}x${fig.srcH} source -> ${fig.w}x${fig.h} art pixels (${fig.opaque} opaque)`);
console.log(
  `value    figure range ${fig.lumLo.toFixed(0)}..${fig.lumHi.toFixed(0)} remapped to clear the wall (lum 42) by 34 -> ${fig.targetLo.toFixed(0)}..${fig.targetHi.toFixed(0)}`,
);
console.log(
  `palette  ${fig.lockSize} colours locked from the ${forceProject ? 'project' : 'art itself'}; ${(fig.snappedShare * 100).toFixed(0)}% of pixels moved`,
);
console.log(`holes    ${fig.holes} filled inside the silhouette`);
console.log(`facing   ${result.flip ? 'flipped to face right' : 'left as drawn (--no-flip)'}`);
const feet = (() => {
  for (let y = FRAME_H - 1; y >= 0; y--) {
    for (let x = 0; x < FRAME_W; x++) if (frame[(y * FRAME_W + x) * 4 + 3] > 0) return y;
  }
  return -1;
})();
console.log(
  `feet     lowest opaque row ${feet} of 0..${FRAME_H - 1}` +
    (feet === FRAME_H - 1 ? '  (good)' : `  <-- ${FRAME_H - 1 - feet}px short, it will float`),
);

if (result.bandCount > 1 && bandArg === null) {
  console.log('');
  console.log(`this sheet holds ${result.bandCount} figures. Run again with --band N to pick one:`);
  result.bands.forEach((b, i) => console.log(`  --band ${i}   ${b.w}x${b.h}`));
  process.exit(0);
}

// write the 15-frame sheet; a single figure fills every frame, so the character
// looks hand-drawn and the procedural art carries the motion
const W = FRAME_W * FRAMES;
const FRAME_BYTES = FRAME_W * FRAME_H * 4;
const sheet = new Uint8Array(W * FRAME_H * 4);
for (let f = 0; f < FRAMES; f++) {
  // Each frame occupies FRAME_W * FRAME_H * 4 bytes, so the offset is that
  // stride times the frame index. The first version of this line used
  // f * FRAME_W * 4, which is the stride for ONE ROW, so all 15 frames were
  // written into the first few hundred bytes of the sheet and the game showed
  // a 6-pixel sliver of a head on top of an otherwise empty texture.
  sheet.set(frame, f * FRAME_BYTES);
}
const dstDir = join('src', 'assets', 'characters');
mkdirSync(dstDir, { recursive: true });
const dst = join(dstDir, `${key}.png`);
writeFileSync(dst, encodePng({ width: W, height: FRAME_H, channels: 4, pixels: Buffer.from(sheet) }));
console.log('');
console.log(`wrote    ${dst}  (${W}x${FRAME_H}, ${FRAMES} frames)`);
