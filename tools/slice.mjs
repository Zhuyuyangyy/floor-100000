// Slices a flat art sheet into individual sprites, so nothing depends on a
// hand-measured grid.
//
// Segmentation has to be separate from cropping. These sheets carry soft glows
// and drop shadows — on 07_HUD they are ~7% of the pixels at mid alpha and they
// bridge neighbouring sprites into one blob. So the mask uses a strict
// threshold (alpha 240, or a tight colour key) to find each sprite's solid
// core, and --pad then grows the box so the soft edge is still exported.
//
// Background models:
//   --mode alpha  content is alpha > --alpha
//   --mode key    content is further than --keytol from the key colour, which
//                 is --key or, with --keyauto, the median of the border ring.
//                 Used by sheets that sit on a flat dark render.
//   --mode flood  content is whatever a region-growing fill from the border
//                 cannot reach, comparing each pixel to the one it came from.
//   --mode checker
//                 The sheet has a transparency checkerboard BAKED INTO THE
//                 PIXELS (06 does: white 250 / grey 210 alternating, a 40-unit
//                 jump that no single key colour and no smooth-fill tolerance
//                 can cross). Both checker colours are detected from the border
//                 ring, and a pixel is background only if it matches one of
//                 them. Sprite interiors survive because they are dark metal
//                 surrounded by more dark metal, so a light highlight inside a
//                 sprite is never reachable from the border as "checker".
//
// Run with --overlay to also emit a numbered rectangle overlay for eyeballing.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { decodePng, encodePng, crop } from './png.mjs';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

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
  '?': ['111', '001', '011', '000', '010'],
};

const input = getArg('in', '');
const outDir = getArg('out', '');
const mode = getArg('mode', 'alpha'); // alpha | key
const alphaThreshold = Number(getArg('alpha', '240'));
const gap = Number(getArg('gap', '6'));
const pad = Number(getArg('pad', '0'));
const minArea = Number(getArg('min', '120'));
const fillRatio = Number(getArg('fill', '0.12'));
const keyTol = Number(getArg('keytol', '40'));
const prefix = getArg('prefix', 'sprite');
const wantOverlay = args.includes('--overlay');
const wantKeyAuto = args.includes('--keyauto');
const keyArg = getArg('key', '');

if (!input || !outDir) {
  console.error('usage: node tools/slice.mjs --in sheet.png --out dir [--mode alpha|key] [--alpha 240] [--key 250,251,251] [--keyauto] [--keytol 40] [--gap 6] [--pad 4] [--min 120] [--overlay]');
  process.exit(1);
}

const img = decodePng(readFileSync(input));
const { width, height, channels, pixels } = img;

// ── content mask ───────────────────────────────────────────────────────────
const mask = new Uint8Array(width * height);
let key = null;
if (mode === 'checker') {
  if (channels < 3) throw new Error('--mode checker needs an RGB or RGBA sheet');
  const tol = Number(getArg('tol', '35'));
  // The two dominant colours on the border ring are the two checker squares.
  const ring = [];
  for (let x = 0; x < width; x++) {
    ring.push(x, (height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    ring.push(y * width, y * width + width - 1);
  }
  const buckets = new Map();
  for (const i of ring) {
    const o = i * channels;
    const k = `${pixels[o] >> 3},${pixels[o + 1] >> 3},${pixels[o + 2] >> 3}`;
    const e = buckets.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += pixels[o];
    e.g += pixels[o + 1];
    e.b += pixels[o + 2];
    buckets.set(k, e);
  }
  const top = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, 2);
  const keys = top.map((e) => [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)]);
  console.log(`checker colours: ${keys.map((k) => `rgb(${k.join(',')})`).join(' / ')}`);
  for (let i = 0, p = 0; i < mask.length; i++, p += channels) {
    const hit = keys.some((k) => Math.abs(pixels[p] - k[0]) + Math.abs(pixels[p + 1] - k[1]) + Math.abs(pixels[p + 2] - k[2]) <= tol);
    mask[i] = hit ? 0 : 1;
  }
} else if (mode === 'flood') {
  if (channels < 3) throw new Error('--mode flood needs an RGB or RGBA sheet');
  const tol = Number(getArg('tol', '26'));
  const seen = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (seen[i] || mask[i]) return;
    seen[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % width;
    const y = (i - x) / width;
    const o = i * channels;
    const r0 = pixels[o];
    const g0 = pixels[o + 1];
    const b0 = pixels[o + 2];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (seen[ni] || mask[ni]) continue;
      const p = ni * channels;
      if (Math.abs(pixels[p] - r0) + Math.abs(pixels[p + 1] - g0) + Math.abs(pixels[p + 2] - b0) <= tol) {
        seen[ni] = 1;
        stack.push(ni);
      }
    }
  }
  for (let i = 0; i < mask.length; i++) mask[i] = seen[i] ? 0 : 1;
  console.log(`flood fill: ${((100 * mask.reduce((a, b) => a + b, 0)) / mask.length).toFixed(1)}% content, tol=${tol}`);
} else if (mode === 'key') {
  if (wantKeyAuto || !keyArg) {
    // Median of the border ring: robust to a stray sprite touching an edge.
    const ring = [];
    for (let x = 0; x < width; x++) {
      ring.push(((x) * channels), ((width - 1 - x) * channels));
      ring.push(((height - 1) * width + x) * channels);
    }
    for (let y = 0; y < height; y++) {
      ring.push((y * width) * channels);
      ring.push((y * width + width - 1) * channels);
    }
    const ch = [];
    for (let c = 0; c < 3; c++) {
      const vals = ring.map((o) => pixels[o + c]).sort((a, b) => a - b);
      ch.push(vals[vals.length >> 1]);
    }
    key = ch;
    console.log(`auto key colour: rgb(${key.join(',')})`);
  } else {
    key = keyArg.split(',').map(Number);
  }
  for (let i = 0, p = 0; i < mask.length; i++, p += channels) {
    const d = Math.abs(pixels[p] - key[0]) + Math.abs(pixels[p + 1] - key[1]) + Math.abs(pixels[p + 2] - key[2]);
    mask[i] = d > keyTol ? 1 : 0;
  }
} else {
  if (channels < 4) throw new Error('--mode alpha needs an RGBA sheet; use --mode key for RGB sheets');
  for (let i = 0, p = 3; i < mask.length; i++, p += 4) mask[i] = pixels[p] > alphaThreshold ? 1 : 0;
}

// ── erode thin bridges before labelling ────────────────────────────────────
// These are AI renders, so the mask is full of 1-2px noise hairs and the
// checkerboard's own grid lines survive colour keying. On 06 that left 2219
// components, several of them hairlines wiring every sprite into one blob.
// Eroding by N removes anything thinner than 2N+1 pixels; the boxes are grown
// back by N afterwards, so no sprite loses its edge.
const erodeN = Number(getArg('erode', '0'));
if (erodeN > 0) {
  let cur = mask;
  for (let k = 0; k < erodeN; k++) {
    const next = new Uint8Array(width * height);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        if (!cur[i]) continue;
        let ok = true;
        for (let dy = -1; dy <= 1 && ok; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!cur[(y + dy) * width + x + dx]) {
              ok = false;
              break;
            }
          }
        }
        next[i] = ok ? 1 : 0;
      }
    }
    cur = next;
  }
  mask.set(cur);
}

// ── connected components (8-connected, iterative) ──────────────────────────
const label = new Int32Array(width * height).fill(-1);
const boxes = [];
for (let seed = 0; seed < mask.length; seed++) {
  if (!mask[seed] || label[seed] >= 0) continue;
  const id = boxes.length;
  const stack = [seed];
  label[seed] = id;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  let area = 0;
  while (stack.length) {
    const i = stack.pop();
    const x = i % width;
    const y = (i - x) / width;
    area++;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (!mask[ni] || label[ni] >= 0) continue;
        label[ni] = id;
        stack.push(ni);
      }
    }
  }
  if (area >= minArea) {
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    // Reject line-like components. These sheets are AI renders of a checkerboard,
    // and the checker's own grid lines survive colour keying as 1-2px strokes
    // that run the full height of the sheet — one of them wired every sprite on
    // 06 into a single component. A solid sprite fills most of its bounding box;
    // a hairline does not.
    const fill = area / (bw * bh);
    if (fill >= fillRatio) boxes.push({ x0, y0, x1, y1, area });
    else if (args.includes('--verbose')) console.log(`  dropped line-like component ${bw}x${bh} area=${area} fill=${fill.toFixed(3)}`);
  }
}

// ── merge boxes that belong to one sprite ──────────────────────────────────
// The test is the distance BETWEEN the boxes, not whether their ranges overlap:
// two sprites standing side by side in a row share a y-range, so an overlap
// test would chain the whole row into one box. dx and dy are the separations
// along each axis (0 when they overlap), and Chebyshev distance is what "within
// gap pixels of each other" means.
const boxGap = (a, b) => {
  const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1);
  const dy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1);
  return Math.max(dx, dy);
};

if (args.includes('--nomerge')) {
  console.log(`raw components before merging: ${boxes.length}`);
  for (const [i, b] of boxes.entries()) {
    console.log(`  raw-${String(i).padStart(2, '0')}  ${String(b.x1 - b.x0 + 1).padStart(4)}x${String(b.y1 - b.y0 + 1).padStart(4)}  @(${b.x0},${b.y0})  area=${b.area}`);
  }
} else {
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (boxGap(a, b) <= gap) {
          a.x0 = Math.min(a.x0, b.x0);
          a.y0 = Math.min(a.y0, b.y0);
          a.x1 = Math.max(a.x1, b.x1);
          a.y1 = Math.max(a.y1, b.y1);
          a.area += b.area;
          boxes.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
}

// Reading order: group into rows by vertical overlap, then left to right.
boxes.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
const rows = [];
for (const b of boxes) {
  const cy = (b.y0 + b.y1) / 2;
  const row = rows.find((r) => cy >= r.top - gap && cy <= r.bottom + gap);
  if (row) {
    row.items.push(b);
    row.top = Math.min(row.top, b.y0);
    row.bottom = Math.max(row.bottom, b.y1);
  } else {
    rows.push({ top: b.y0, bottom: b.y1, items: [b] });
  }
}
const ordered = rows.flatMap((r) => r.items.sort((a, b) => a.x0 - b.x0));

mkdirSync(outDir, { recursive: true });

// Keyed and flood-filled sheets come out as RGBA with the background punched
// to alpha 0, so a presentation render becomes sprites the dark HUD can sit on.
const keying = mode !== 'alpha';
const outChannels = keying ? 4 : channels;
const emit = (x, y, w, h) => {
  if (!keying) return crop(img, x, y, w, h);
  const out = Buffer.alloc(w * h * 4);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const s = ((y + row) * width + (x + col)) * channels;
      const d = ((row * w) + col) * 4;
      out[d] = pixels[s];
      out[d + 1] = pixels[s + 1];
      out[d + 2] = pixels[s + 2];
      out[d + 3] = mask[(y + row) * width + (x + col)] ? 255 : 0;
    }
  }
  return { width: w, height: h, channels: 4, pixels: out };
};

const manifest = [];
ordered.forEach((b, i) => {
  const name = `${prefix}-${String(i).padStart(2, '0')}`;
  // Grow back what erosion took, so the exported sprite keeps its full edge.
  const grow = erodeN + pad;
  const x = Math.max(0, b.x0 - grow);
  const y = Math.max(0, b.y0 - grow);
  const w = Math.min(width - x, b.x1 - b.x0 + 1 + grow * 2);
  const h = Math.min(height - y, b.y1 - b.y0 + 1 + grow * 2);
  writeFileSync(join(outDir, `${name}.png`), encodePng(emit(x, y, w, h)));
  manifest.push({ name, x, y, w, h, area: b.area });
});

writeFileSync(
  join(outDir, 'manifest.json'),
  JSON.stringify({ source: input, mode, alpha: alphaThreshold, gap, pad, minArea, key, count: ordered.length, sprites: manifest }, null, 2),
);

console.log(`${input}: ${ordered.length} sprites (${width}x${height}, mode=${mode}, alpha=${alphaThreshold}, gap=${gap}, pad=${pad})`);
for (const m of manifest) console.log(`  ${m.name}  ${String(m.w).padStart(4)}x${String(m.h).padStart(4)}  @(${m.x},${m.y})`);

// ── overlay for eyeballing the boxes ───────────────────────────────────────
if (wantOverlay) {
  const out = Buffer.from(pixels);
  const px = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const o = (y * width + x) * channels;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  };
  ordered.forEach((b, i) => {
    const c = i % 2 ? [255, 90, 90] : [90, 200, 255];
    for (let x = b.x0; x <= b.x1; x++) {
      px(x, b.y0, ...c);
      px(x, b.y1, ...c);
    }
    for (let y = b.y0; y <= b.y1; y++) {
      px(b.x0, y, ...c);
      px(b.x1, y, ...c);
    }
    const digits = String(i);
    for (let d = 0; d < digits.length; d++) {
      const glyph = FONT[digits[d]] ?? FONT['?'];
      for (let gy = 0; gy < 5; gy++) {
        for (let gx = 0; gx < 3; gx++) {
          if (glyph[gy][gx]) px(b.x0 + 2 + d * 4 + gx, b.y0 + 2 + gy, 255, 255, 0);
        }
      }
    }
  });
  const overlayPath = join(dirname(outDir), `${prefix}-overlay.png`);
  writeFileSync(overlayPath, encodePng({ width, height, channels, pixels: out }));
  console.log(`overlay -> ${overlayPath}`);
}

// ── contact sheet: every sliced sprite on a dark field, indexed ────────────
// The only practical way to check a slice is to look at it, and 77 separate
// files is 77 image reads. One sheet with the index under each sprite is one.
if (args.includes('--contact')) {
  const cols = Number(getArg('cols', '12'));
  const cell = Number(getArg('cell', '96'));
  const rowsN = Math.ceil(manifest.length / cols);
  const cw = cols * cell;
  const chh = rowsN * cell;
  const sheet = { width: cw, height: chh, channels: 4, pixels: Buffer.alloc(cw * chh * 4) };
  for (let i = 0; i < sheet.pixels.length; i += 4) {
    sheet.pixels[i] = 18;
    sheet.pixels[i + 1] = 22;
    sheet.pixels[i + 2] = 28;
    sheet.pixels[i + 3] = 255;
  }
  const put = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= cw || y >= chh) return;
    const o = (y * cw + x) * 4;
    sheet.pixels[o] = r;
    sheet.pixels[o + 1] = g;
    sheet.pixels[o + 2] = b;
    sheet.pixels[o + 3] = a;
  };
  manifest.forEach((m, i) => {
    const cx = (i % cols) * cell;
    const cy = Math.floor(i / cols) * cell;
    const sprite = decodePng(readFileSync(join(outDir, `${m.name}.png`)));
    const scale = Math.min(1, (cell - 18) / Math.max(sprite.width, sprite.height));
    const dw = Math.max(1, Math.round(sprite.width * scale));
    const dh = Math.max(1, Math.round(sprite.height * scale));
    const ox = cx + ((cell - dw) >> 1);
    const oy = cy + 4;
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        const sx = Math.min(sprite.width - 1, Math.floor(x / scale));
        const sy = Math.min(sprite.height - 1, Math.floor(y / scale));
        const s = (sy * sprite.width + sx) * sprite.channels;
        const a = sprite.channels === 4 ? sprite.pixels[s + 3] : 255;
        if (a === 0) continue;
        put(ox + x, oy + y, sprite.pixels[s], sprite.pixels[s + 1], sprite.pixels[s + 2], 255);
      }
    }
    const digits = String(i);
    for (let d = 0; d < digits.length; d++) {
      const glyph = FONT[digits[d]] ?? FONT['?'];
      for (let gy = 0; gy < 5; gy++) {
        for (let gx = 0; gx < 3; gx++) {
          if (glyph[gy][gx]) put(cx + 3 + d * 4 + gx, cy + cell - 8 + gy, 244, 182, 106);
        }
      }
    }
  });
  const contactPath = join(dirname(outDir), `${prefix}-contact.png`);
  writeFileSync(contactPath, encodePng(sheet));
  console.log(`contact -> ${contactPath}`);
}
