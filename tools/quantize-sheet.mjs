// Quantizes a painted character sheet onto the project's 16-colour palette.
//
// This is the gate every new character sheet passes before it may ship, the same
// one the four live characters passed when floor100000_character_runtime_v5_2
// was ingested: binary alpha, one colour per material snapped to the shared
// palette, feet planted on the frame's last row. A sheet that keeps the render's
// 10k anti-aliased colours reads as a smooth sticker next to the pixel art and
// quietly costs the palette discipline the whole project is built on.
//
//   node tools/quantize-sheet.mjs <in.png> --out <out.png> [--frame 64x96]
//       [--feet-row 95] [--report]
//
// Modes:
//   sheet   the default: the input is N frames of --frame size laid horizontally.
//           Each frame is aligned independently (--feet-row) and snapped.
//   still   --still N writes only frame N at --frame size. CHARACTER_FILES wants
//           one 64x96 image per character while the sheet stays in its own home,
//           so a new character ships both from one quantisation run.
//   crop    --crop X,Y,W,H takes one rectangle and rescales it to --frame.
//           Used for the 96x96 dialogue busts cut out of full-body renders.
//
// The palette below is src/render/palette.ts's sixteen, copied rather than
// imported: tools/ runs on plain Node and cannot import the TS module. Keep the
// two in sync — assetManifest.test.ts fails when a shipped file carries a colour
// that is in neither list.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { decodePng, encodePng } from './png.mjs';

// src/render/palette.ts, in declaration order.
const PALETTE = [
  [0x05, 0x08, 0x0b], [0x14, 0x20, 0x2c], [0x2c, 0x3f, 0x4e], [0x47, 0x65, 0x7a],
  [0x8a, 0x95, 0xa0], [0x1e, 0x4a, 0x44], [0x2f, 0x6b, 0x5e], [0x4e, 0x9c, 0x86],
  [0x77, 0xc6, 0xa4], [0x6b, 0x46, 0x30], [0xa5, 0x71, 0x4c], [0xd9, 0xb4, 0x8f],
  [0x8a, 0x4a, 0x1e], [0xd9, 0x8b, 0x3c], [0xf4, 0xb6, 0x6a], [0xff, 0xe4, 0xb6],
];

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
}

const inFile = process.argv[2];
if (!inFile) {
  console.error('usage: node tools/quantize-sheet.mjs <in.png> --out <out.png> [--frame 64x96] [--crop X,Y,W,H] [--feet-row 95] [--report]');
  process.exit(1);
}
const outFile = arg('out', null);
if (!outFile) {
  console.error('--out is required');
  process.exit(1);
}
const [FW, FH] = arg('frame', '64x96').split('x').map(Number);
const cropArg = arg('crop', null);
const stillArg = arg('still', null);
// `--feet-row none` disables alignment: a dialogue bust has no feet to plant.
const feetArg = arg('feet-row', String(FH - 1));
const alignFeet = feetArg !== 'none';
const feetRow = alignFeet ? Number(feetArg) : -1;

const src = decodePng(readFileSync(inFile));
const ch = src.channels;
const at = (x, y) => (y * src.width + x) * ch;

/** Nearest palette entry, luma-weighted so the eye's channel priorities decide. */
function nearest(r, g, b) {
  let best = 0;
  let bestD = Infinity;
  for (let k = 0; k < PALETTE.length; k++) {
    const [pr, pg, pb] = PALETTE[k];
    const d = (r - pr) ** 2 * 0.3 + (g - pg) ** 2 * 0.59 + (b - pb) ** 2 * 0.11;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return PALETTE[best];
}

/** One output frame's worth of RGBA bytes, aligned and snapped. */
function snapFrame(getPx) {
  const px = Buffer.alloc(FW * FH * 4);
  // Pass 1: binarise alpha (>=128 solid) and snap colour. The source is a smooth
  // render, so this is where the 10k colours become at most sixteen.
  const solid = new Uint8Array(FW * FH);
  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < FW; x++) {
      const [r, g, b, a] = getPx(x, y);
      if (a < 128) continue;
      const [pr, pg, pb] = nearest(r, g, b);
      const o = (y * FW + x) * 4;
      px[o] = pr;
      px[o + 1] = pg;
      px[o + 2] = pb;
      px[o + 3] = 255;
      solid[y * FW + x] = 1;
    }
  }
  // Pass 2: align the feet. A frame whose lowest solid row sits above the target
  // is shifted down as a whole block; one that already reaches it is left alone.
  // Nothing is ever scaled or cropped here — the geometry is the artist's.
  let last = -1;
  for (let y = FH - 1; y >= 0 && last === -1; y--) {
    for (let x = 0; x < FW; x++) {
      if (solid[y * FW + x]) {
        last = y;
        break;
      }
    }
  }
  let shifted = 0;
  if (alignFeet && last >= 0 && last < feetRow) {
    const shift = feetRow - last;
    if (shift > 0) {
      px.copyWithin(shift * FW * 4, 0, (last + 1) * FW * 4);
      px.fill(0, 0, shift * FW * 4);
      shifted = shift;
    }
  }
  let opaque = 0;
  const colours = new Set();
  for (let i = 0; i < FW * FH; i++) {
    if (px[i * 4 + 3] === 0) continue;
    opaque++;
    colours.add((px[i * 4] << 16) | (px[i * 4 + 1] << 8) | px[i * 4 + 2]);
  }
  return { px, opaque, colours, shifted, feet: last };
}

const frames = [];

if (cropArg) {
  // Single image mode: crop, then box-downscale into one --frame-sized image.
  const [cx, cy, cw, chh] = cropArg.split(',').map(Number);
  if (cx + cw > src.width || cy + chh > src.height) throw new Error('crop exceeds the source bounds');
  const getPx = (x, y) => {
    const sx = Math.min(src.width - 1, cx + Math.floor((x * cw) / FW));
    const sy = Math.min(src.height - 1, cy + Math.floor((y * chh) / FH));
    const o = at(sx, sy);
    return [src.pixels[o], src.pixels[o + 1], src.pixels[o + 2], ch === 4 ? src.pixels[o + 3] : 255];
  };
  frames.push(snapFrame(getPx));
} else {
  if (src.width % FW !== 0) {
    throw new Error(`width ${src.width} is not a multiple of the frame width ${FW}`);
  }
  const count = src.width / FW;
  if (src.height !== FH) throw new Error(`height ${src.height} != frame height ${FH}`);
  for (let f = 0; f < count; f++) {
    const getPx = (x, y) => {
      const o = at(f * FW + x, y);
      return [src.pixels[o], src.pixels[o + 1], src.pixels[o + 2], ch === 4 ? src.pixels[o + 3] : 255];
    };
    frames.push(snapFrame(getPx));
  }
  if (stillArg !== null) {
    // Keep only the requested frame; the sheet run and the still run share one
    // quantisation so the two files can never disagree about the palette.
    const n = Number(stillArg);
    if (!Number.isInteger(n) || n < 0 || n >= frames.length) {
      throw new Error(`--still ${stillArg} is outside 0..${frames.length - 1}`);
    }
    frames.splice(0, frames.length, frames[n]);
  }
}

// ── the gate ────────────────────────────────────────────────────────────────
// Every colour must be one of the sixteen, and the whole file must stay within
// them. Snapping guarantees this by construction; the check exists so a future
// edit to PALETTE (or a caller passing a different frame size that resamples)
// fails loudly instead of shipping a seventeenth colour.
const allColours = new Set();
for (const fr of frames) for (const c of fr.colours) allColours.add(c);
const inPalette = [...allColours].every((c) =>
  PALETTE.some(([r, g, b]) => (r << 16) | (g << 8) | b === c),
);
const failures = [];
if (allColours.size > PALETTE.length) failures.push(`${allColours.size} colours > ${PALETTE.length}`);
if (!inPalette) failures.push('a colour is outside the project palette');
if (alignFeet && frames.some((fr) => fr.feet >= 0 && fr.feet > feetRow)) failures.push('a frame overruns the feet row');

if (cropArg) {
  const fr = frames[0];
  console.log(`${outFile}: ${FW}x${FH} crop of ${cropArg}, ${fr.colours.size} colours, ${fr.opaque} opaque px, feet row ${fr.feet}`);
} else {
  console.log(`${outFile}: ${frames.length} frames of ${FW}x${FH}`);
  frames.forEach((fr, i) => {
    // `feet` is the row measured before the shift; a shifted frame lands exactly
    // on feetRow, so the report shows where the art actually ends up.
    const feetOut = fr.shifted ? feetRow : fr.feet;
    console.log(
      `  frame ${String(i).padStart(2)}  ${fr.colours.size} colours  ${String(fr.opaque).padStart(4)} opaque px  feet row ${feetOut}${fr.shifted ? `  (shifted ${fr.shifted})` : ''}`,
    );
  });
}
console.log(`  total ${allColours.size} distinct colours, all in palette: ${inPalette ? 'yes' : 'NO'}`);
if (failures.length) {
  console.error(`GATE FAILED: ${failures.join('; ')} — nothing written`);
  process.exit(1);
}

mkdirSync(dirname(outFile), { recursive: true });
// Interleave the frames into one horizontal sheet, row by row. Concatenating the
// frame buffers instead would lay them end to end as a 64-wide, 1920-tall column
// of pixels that a 1280x96 header then reinterprets as scrambled noise — the same
// class of mistake ingest-character.mjs documents in its frame-stride comment.
const sheet = Buffer.alloc(FW * frames.length * FH * 4);
for (const [f, frame] of frames.entries()) {
  for (let y = 0; y < FH; y++) {
    frame.px.copy(sheet, (y * FW * frames.length + f * FW) * 4, y * FW * 4, (y + 1) * FW * 4);
  }
}
writeFileSync(outFile, encodePng({ width: FW * frames.length, height: FH, channels: 4, pixels: sheet }));
console.log(`  wrote ${outFile}`);
