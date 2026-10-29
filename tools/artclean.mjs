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

// Luma-weighted Euclidean distance. Not Oklab, but it weights the channels the
// way human vision does, which is what the contrast and error scores need.
function dist(a, b) {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(0.30 * dr * dr + 0.59 * dg * dg + 0.11 * db * db);
}

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
  // Shift the sprite so its lowest opaque row is the last row. Characters must share
  // one foot baseline or they bob when swapped, and the source renders do not end
  // on the same row.
  const baseline = process.argv.includes('--baseline');
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

  // Pass 1: pick one colour per cell. Three strategies, because the choice is the
  // whole problem and the answer is not obvious:
  //
  //   mode   — the most frequent colour. Cheap, and it is what loses a face: the
  //            eyes occupy less area than the skin around them, so the majority
  //            vote swallows them.
  //   edge   — a high-contrast minority colour may beat the majority. Scored as
  //            area x contrast^2, so contrast has to buy its area. This is the
  //            internal-edge idea from BetterPixelArtDownscale: important colour
  //            transitions survive even when they cover less area than a flat
  //            region.
  //   error  — the source colour that minimises total perceptual distance to every
  //            pixel in the cell. Palette-preserving (never invents a colour) and
  //            much better than mode across gradients.
  const mode = arg('mode', 'mode');
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
        const ranked = [...local.entries()].sort((a, b) => b[1] - a[1]);
        if (mode === 'mode') {
          cell = ranked[0][0];
        } else if (mode === 'edge') {
          // Contrast is measured against the majority colour; a rival needs
          // contrast^2 to overcome the majority's area.
          const [top, topArea] = ranked[0];
          cell = top;
          let best = topArea;
          for (const [c, area] of ranked.slice(1, 24)) {
            const score = area * (dist(c, top) / 64) ** 2;
            if (score > best) { best = score; cell = c; }
          }
        } else if (mode === 'error') {
          // Only colours with real presence are candidates, so one stray pixel
          // cannot win by being far from everything.
          const cands = ranked.filter(([, n]) => n >= fg * 0.04).slice(0, 24);
          let bestErr = Infinity;
          for (const [c] of cands) {
            let err = 0;
            for (const [o, n] of local) err += n * dist(o, c) ** 2;
            if (err < bestErr) { bestErr = err; cell = c; }
          }
          if (cell === null) cell = ranked[0][0];
        } else {
          throw new Error(`unknown --mode ${mode} (mode|edge|error)`);
        }
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
  if (baseline) {
    let last = -1;
    for (let y = gh - 1; y >= 0 && last === -1; y--) {
      for (let x = 0; x < gw; x++) if (outPx[(y * gw + x) * 4 + 3] !== 0) { last = y; break; }
    }
    if (last === -1) throw new Error('nothing to align');
    const shift = gh - 1 - last;
    if (shift > 0) {
      outPx.copyWithin(shift * gw * 4, 0, (last + 1) * gw * 4);
      outPx.fill(0, 0, shift * gw * 4);
    }
  }
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
