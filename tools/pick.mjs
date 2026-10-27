// Builds a labelled contact sheet from a chosen subset of sliced sprites, so a
// mapping decision can be made by looking once instead of opening 20 files.
//
//   node tools/pick.mjs --dir hud --ids 19,20,27 --out pick.png

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, encodePng } from './png.mjs';

const args = process.argv.slice(2);
const getArg = (n, f) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : f;
};

const dir = getArg('dir', 'hud');
const ids = getArg('ids', '').split(',').filter(Boolean).map(Number);
const out = getArg('out', 'pick.png');
const cols = Number(getArg('cols', '8'));
const cell = Number(getArg('cell', '120'));
const base = getArg('base', 'F:/new/sliced');

const FONT = {
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '010', '010', '010', '010'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '001', '001', '001'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
};

const rows = Math.ceil(ids.length / cols);
const sheet = { width: cols * cell, height: rows * cell, channels: 4, pixels: Buffer.alloc(cols * cell * rows * cell * 4) };
for (let i = 0; i < sheet.pixels.length; i += 4) {
  sheet.pixels[i] = 18;
  sheet.pixels[i + 1] = 22;
  sheet.pixels[i + 2] = 28;
  sheet.pixels[i + 3] = 255;
}

ids.forEach((id, i) => {
  const name = `${dir}-${String(id).padStart(2, '0')}`;
  const img = decodePng(readFileSync(join(base, dir, `${name}.png`)));
  const cx = (i % cols) * cell;
  const cy = Math.floor(i / cols) * cell;
  const s = Math.min(1, (cell - 24) / Math.max(img.width, img.height));
  const dw = Math.max(1, Math.round(img.width * s));
  const dh = Math.max(1, Math.round(img.height * s));
  const ox = cx + ((cell - dw) >> 1);
  const oy = cy + 6;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / s));
      const sy = Math.min(img.height - 1, Math.floor(y / s));
      const so = (sy * img.width + sx) * img.channels;
      if (img.channels === 4 && img.pixels[so + 3] === 0) continue;
      const d = ((oy + y) * sheet.width + ox + x) * 4;
      sheet.pixels[d] = img.pixels[so];
      sheet.pixels[d + 1] = img.pixels[so + 1];
      sheet.pixels[d + 2] = img.pixels[so + 2];
      sheet.pixels[d + 3] = 255;
    }
  }
  const digits = String(id);
  for (let d = 0; d < digits.length; d++) {
    const glyph = FONT[digits[d]];
    for (let gy = 0; gy < 5; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        if (!glyph[gy][gx]) continue;
        const p = ((cy + cell - 10 + gy) * sheet.width + cx + 4 + d * 4 + gx) * 4;
        sheet.pixels[p] = 244;
        sheet.pixels[p + 1] = 182;
        sheet.pixels[p + 2] = 106;
        sheet.pixels[p + 3] = 255;
      }
    }
  }
});

writeFileSync(out, encodePng(sheet));
console.log(`wrote ${out} (${ids.length} sprites)`);
