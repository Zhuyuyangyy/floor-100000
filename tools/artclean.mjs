// Rebuilds a smooth render onto a fixed pixel grid, per SKILL.md §3: one dominant
// colour per cell, never a blurred average. Also keys out a flat background and
// snaps the result to a limited palette so the sprite is real pixel art rather
// than 80k colours of noise.
//
//   node tools/artclean.mjs inspect <file>
//   node tools/artclean.mjs rebuild <file> --out <png> --grid WxH [--bg #rrggbb]
//       [--tol N] [--palette N] [--dump]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { decodePng, encodePng } from './png.mjs';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const rgb = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];

function load(file) {
  const img = decodePng(readFileSync(file));
  return { img, w: img.width, h: img.height, ch: img.channels, px: img.pixels };
}

function at(s, x, y) {
  const o = (y * s.w + x) * s.ch;
  return [(s.px[o] << 16) | (s.px[o + 1] << 8) | s.px[o + 2], s.ch === 4 ? s.px[o + 3] : 255];
}

// The flat background is the colour that dominates the image border.
function detectBackground(s) {
  const counts = new Map();
  for (let x = 0; x < s.w; x += 3) for (const y of [0, 1, 2, s.h - 3, s.h - 2, s.h - 1]) {
    const [c] = at(s, x, y);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
}

const cmd = process.argv[2];
const file = process.argv[3];

if (cmd === 'inspect') {
  const s = load(file);
  const bg = detectBackground(s);
  const counts = new Map();
  for (let i = 0; i < s.w * s.h; i++) {
    const o = i * s.ch;
    const c = (s.px[o] << 16) | (s.px[o + 1] << 8) | s.px[o + 2];
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`${file.split('/').pop()}`);
  console.log(`  ${s.w}x${s.h} ${s.ch === 4 ? 'RGBA' : 'RGB'}, ${counts.size} colours`);
  console.log(`  border background: ${hex(bg)} ${rgb(bg).join(',')}`);
  console.log(`  top colours: ${top.map(([c, n]) => `${hex(c)} ${(n / (s.w * s.h) * 100).toFixed(1)}%`).join('  ')}`);
}

if (cmd === 'rebuild') {
  const [gw, gh] = arg('grid', '32x48').split('x').map(Number);
  const bgHex = arg('bg', null);
  const tol = Number(arg('tol', 26));
  const paletteSize = Number(arg('palette', 0));
  const out = arg('out', null);
  const dump = process.argv.includes('--dump');
  if (!out) throw new Error('--out is required');

  const s = load(file);
  const bg = bgHex ? Number.parseInt(bgHex.slice(1), 16) : detectBackground(s);
  // Sum of absolute channel differences against the background. The tolerance is a
  // separate argument on purpose: an earlier version took only (c, t) while being
  // called as (c, bg, tol), so the threshold silently became the background's
  // packed value and every pixel keyed out — an empty sprite, written with no error.
  const near = (c, t, tolerance) => {
    const [r1, g1, b1] = rgb(c);
    const [r2, g2, b2] = rgb(t);
    return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2) <= tolerance;
  };

  // Pass 1: dominant colour per cell, ignoring background.
  const cells = [];
  const histogram = new Map();
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const x0 = Math.floor((gx * s.w) / gw);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * s.w) / gw));
      const y0 = Math.floor((gy * s.h) / gh);
      const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * s.h) / gh));
      const local = new Map();
      let fg = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const [c, a] = at(s, x, y);
          if (a < 250 || near(c, bg, tol)) continue;
          local.set(c, (local.get(c) ?? 0) + 1);
          fg++;
        }
      }
      let cell = null;
      if (fg > 0) {
        cell = [...local.entries()].sort((a, b) => b[1] - a[1])[0][0];
        histogram.set(cell, (histogram.get(cell) ?? 0) + 1);
      }
      cells.push(cell);
    }
  }

  // Pass 2: optional palette snap — the image's own most common cell colours, so
  // the sprite keeps the render's intent with a bounded colour count.
  let palette = null;
  if (paletteSize > 0) {
    palette = [...histogram.entries()].sort((a, b) => b[1] - a[1]).slice(0, paletteSize).map(([c]) => c);
    const nearest = (c) => {
      let best = c;
      let bestD = Infinity;
      for (const p of palette) {
        const [r1, g1, b1] = rgb(c);
        const [r2, g2, b2] = rgb(p);
        const d = (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
        if (d < bestD) { bestD = d; best = p; }
      }
      return best;
    };
    for (let i = 0; i < cells.length; i++) if (cells[i] !== null) cells[i] = nearest(cells[i]);
  }

  const outPx = Buffer.alloc(gw * gh * 4);
  const usedColors = new Set();
  cells.forEach((c, i) => {
    const o = i * 4;
    if (c === null) return;
    const [r, g, b] = rgb(c);
    outPx[o] = r; outPx[o + 1] = g; outPx[o + 2] = b; outPx[o + 3] = 255;
    usedColors.add(c);
  });
  const img = { width: gw, height: gh, channels: 4, pixels: outPx };
  // A sprite with no foreground means the background key ate everything, which is
  // the failure mode SKILL.md calls 去背误伤前景. Writing it silently would hand
  // back an invisible character, so refuse instead.
  if (usedColors.size === 0) {
    throw new Error(`every cell keyed out as background ${hex(bg)} — the tolerance is wrong, not the art`);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, encodePng(img));

  if (dump) {
    for (let y = 0; y < gh; y++) {
      let line = '';
      for (let x = 0; x < gw; x++) {
        const o = (y * gw + x) * 4;
        line += outPx[o + 3] === 0 ? '.' : '#';
      }
      console.log(line);
    }
  }
  console.log(`${out}: ${gw}x${gh}, ${usedColors.size} colours, background ${hex(bg)} keyed`);
}
