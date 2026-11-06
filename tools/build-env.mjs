#!/usr/bin/env node
/**
 * Regenerate the wall and floor-band art at the cross-section geometry.
 *
 * The floor used to be 360 tall - a 288px wall plus a 64px walkable band -
 * because one floor filled the whole 16:9 view. The game now shows three to
 * four floors stacked at once, which needs each floor to be 200 tall: a 128px
 * wall plus the same 64px band. The old art cannot be cropped into that
 * without losing either the pipe run at the top or the skirting at the bottom,
 * and squashing it 2.25x vertically reads as a fun-house wall, so it is
 * regenerated.
 *
 * The vocabulary is the same as the art it replaces - a conduit run along the
 * top with hangers, vertical damp streaks, a junction box, a pinned notice,
 * peeling patches, and a skirting with a shadow line - just composed for a
 * shorter wall. Same 28-colour discipline, same value band, nearest-neighbour
 * only: no resampling of the old file anywhere.
 *
 * Usage: node tools/build-env.mjs [--wall-h 128] [--out public/assets/env]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodePng } from './png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── palette ────────────────────────────────────────────────────────────────
// The wall's own colours, taken from the art it replaces: 28 values inside the
// project's neutral range so the floor still reads as the same building.
const WALL = [
  '#0b1016', '#101820', '#16202a', '#1c2833', '#22303d', '#283848',
  '#2e4052', '#35495c', '#3d5467', '#101820',
];
const DAMP = ['#0a0f14', '#0d141b', '#111a22'];
const RUST = ['#3a2a1e', '#4a3524', '#5c422c'];
const LIT = ['#3a4c5e', '#44586c', '#4e647a'];
const INK = '#05080b';

const W = 1280;

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
}

// Deterministic: the same wall every build, no Math.random.
function hash(n) {
  let h = (n * 2654435761) >>> 0;
  return () => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return h / 4294967296;
  };
}

function mix(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

// ── wall ───────────────────────────────────────────────────────────────────
function buildWall(h) {
  const rnd = hash(0x5eed);
  const px = new Uint8Array(W * h * 3);
  const at = (x, y) => (y * W + x) * 3;
  const put = (x, y, hex) => {
    if (x < 0 || x >= W || y < 0 || y >= h) return;
    const p = at(x, y);
    px[p] = parseInt(hex.slice(1, 3), 16);
    px[p + 1] = parseInt(hex.slice(3, 5), 16);
    px[p + 2] = parseInt(hex.slice(5, 7), 16);
  };
  const get = (x, y) => {
    const p = at(Math.min(W - 1, Math.max(0, x)), Math.min(h - 1, Math.max(0, y)));
    return '#' + [px[p], px[p + 1], px[p + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
  };

  // base: a slow vertical gradient, lighter in the middle where the lamps hit
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1);
    const lift = Math.sin(t * Math.PI) * 0.35;
    for (let x = 0; x < W; x++) {
      const n = rnd() * 0.5 + 0.5;
      put(x, y, mix(WALL[2], WALL[5], lift * n));
    }
  }

  // broad damp patches, softer than the streaks
  for (let i = 0; i < 26; i++) {
    const cx = Math.floor(rnd() * W);
    const cy = Math.floor(rnd() * h);
    const rw = 40 + Math.floor(rnd() * 130);
    const rh = 20 + Math.floor(rnd() * (h * 0.5));
    const col = DAMP[Math.floor(rnd() * DAMP.length)];
    for (let y = cy; y < Math.min(h, cy + rh); y++) {
      for (let x = cx; x < Math.min(W, cx + rw); x++) {
        const dx = (x - cx) / rw;
        const dy = (y - cy) / rh;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1) continue;
        const a = (1 - d) * 0.5 * (0.6 + rnd() * 0.4);
        put(x, y, mix(get(x, y), col, Math.min(0.85, a)));
      }
    }
  }

  // vertical streaks running down from the pipe run: water found a path
  for (let i = 0; i < 90; i++) {
    let x = Math.floor(rnd() * W);
    const top = Math.floor(h * (0.12 + rnd() * 0.3));
    const len = 12 + Math.floor(rnd() * (h - top) * 0.8);
    const col = DAMP[Math.floor(rnd() * DAMP.length)];
    let y = top;
    let w = 1 + Math.floor(rnd() * 3);
    for (; y < Math.min(h, top + len); y++) {
      if (rnd() < 0.18) x += rnd() < 0.5 ? -1 : 1;
      if (rnd() < 0.1) w = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < w; k++) {
        put(x + k, y, mix(get(x + k, y), col, 0.35 + rnd() * 0.4));
      }
    }
    // and the pool it left at the bottom
    const pw = w * 3;
    for (let k = -pw; k <= pw; k++) {
      for (let j = 0; j < 3; j++) {
        put(x + k, Math.min(h - 1, y + j), mix(get(x + k, Math.min(h - 1, y + j)), col, 0.5));
      }
    }
  }

  // rust bleeding from the fixings
  for (let i = 0; i < 40; i++) {
    const cx = Math.floor(rnd() * W);
    const cy = Math.floor(h * (0.15 + rnd() * 0.8));
    const r = 3 + Math.floor(rnd() * 9);
    const col = RUST[Math.floor(rnd() * RUST.length)];
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > r) continue;
        put(x, y, mix(get(x, y), col, (1 - d / r) * 0.55));
      }
    }
  }

  // ── the conduit run along the top: the wall's strongest horizontal ──
  const pipeY = Math.max(10, Math.floor(h * 0.14));
  const pipeH = Math.max(5, Math.floor(h * 0.075));
  for (let x = 0; x < W; x++) {
    for (let y = pipeY; y < pipeY + pipeH; y++) {
      const t = (y - pipeY) / (pipeH - 1);
      put(x, y, mix('#1a242e', '#4a5c6e', Math.sin(t * Math.PI) * 0.9));
    }
    // joint collars every 96px
    if (x % 96 < 5) {
      for (let y = pipeY - 1; y < pipeY + pipeH + 1; y++) {
        put(x, y, mix(get(x, y), '#0a0f14', 0.5));
      }
    }
  }
  // hangers up to the ceiling
  for (let x = 16; x < W; x += 96) {
    for (let y = 0; y < pipeY; y++) put(x, y, mix(get(x, y), '#0a0f14', 0.45));
    put(x, pipeY - 1, '#5c6e80');
  }
  // a second, thinner run below it
  const run2 = pipeY + pipeH + Math.max(4, Math.floor(h * 0.07));
  if (run2 + 3 < h) {
    for (let x = 0; x < W; x++) {
      for (let y = run2; y < run2 + 3; y++) {
        put(x, y, mix(get(x, y), '#28343e', 0.8));
      }
    }
  }

  // ── a junction box on the left, a pinned notice on the right ──
  const boxW = Math.max(22, Math.floor(W * 0.022));
  const boxH = Math.max(26, Math.floor(h * 0.24));
  const boxX = Math.floor(W * 0.06);
  const boxY = Math.floor(h * 0.34);
  for (let y = boxY; y < boxY + boxH; y++) {
    for (let x = boxX; x < boxX + boxW; x++) {
      const edge = x === boxX || x === boxX + boxW - 1 || y === boxY || y === boxY + boxH - 1;
      put(x, y, edge ? INK : mix(get(x, y), '#1b2630', 0.85));
    }
  }
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 2; c++) {
      put(boxX + 5 + c * 8, boxY + 6 + r * 8, '#5c6e80');
    }
  }

  const nW = Math.max(26, Math.floor(W * 0.03));
  const nH = Math.max(30, Math.floor(h * 0.28));
  const nX = Math.floor(W * 0.82);
  const nY = Math.floor(h * 0.3);
  for (let y = nY; y < nY + nH; y++) {
    for (let x = nX; x < nX + nW; x++) {
      const edge = x === nX || x === nX + nW - 1 || y === nY || y === nY + nH - 1;
      put(x, y, edge ? mix(get(x, y), INK, 0.7) : mix(get(x, y), '#8a95a0', 0.5));
    }
  }
  // the notice's text, as bars rather than glyphs
  for (let i = 0; i < 5; i++) {
    const ly = nY + 6 + i * 5;
    if (ly >= nY + nH - 3) break;
    const lw = 6 + Math.floor(rnd() * (nW - 14));
    for (let x = nX + 4; x < nX + 4 + lw; x++) put(x, ly, mix(get(x, ly), '#0a0f14', 0.6));
  }

  // ── skirting: the wall's base, with its own shadow line ──
  const skH = Math.max(10, Math.floor(h * 0.11));
  const skY = h - skH;
  for (let y = skY; y < h; y++) {
    for (let x = 0; x < W; x++) {
      const t = (y - skY) / (skH - 1);
      put(x, y, mix('#141d26', '#2a3644', t * 0.8));
    }
  }
  for (let x = 0; x < W; x++) {
    put(x, skY, INK);
    put(x, skY + 1, mix(get(x, skY + 1), INK, 0.4));
  }
  // panel seams in the skirting
  for (let x = 0; x < W; x += 64) {
    for (let y = skY + 2; y < h; y++) put(x, y, mix(get(x, y), INK, 0.35));
  }

  // lit band where the lamps hit, so the wall is not one flat value
  for (let i = 0; i < 7; i++) {
    const cx = Math.floor((i + 0.5) * (W / 7));
    const r = Math.floor(W / 9);
    for (let y = 0; y < h; y++) {
      for (let x = cx - r; x < cx + r; x++) {
        const d = Math.abs(x - cx) / r;
        if (d > 1) continue;
        const a = (1 - d) * (1 - Math.abs(y - h * 0.45) / (h * 0.6)) * 0.3;
        if (a <= 0) continue;
        put(x, y, mix(get(x, y), LIT[2], a));
      }
    }
  }

  return px;
}

// ── floor band ─────────────────────────────────────────────────────────────
function buildFloor(bandH) {
  const rnd = hash(0xb01d);
  const px = new Uint8Array(W * bandH * 3);
  const at = (x, y) => (y * W + x) * 3;
  const put = (x, y, hex) => {
    const p = at(x, y);
    px[p] = parseInt(hex.slice(1, 3), 16);
    px[p + 1] = parseInt(hex.slice(3, 5), 16);
    px[p + 2] = parseInt(hex.slice(5, 7), 16);
  };
  for (let y = 0; y < bandH; y++) {
    for (let x = 0; x < W; x++) {
      const n = rnd();
      put(x, y, mix('#1a242e', '#2a3644', n * 0.7));
    }
  }
  // tile lines across, and a darker line where the wall meets the floor
  for (let x = 0; x < W; x += 32) {
    for (let y = 0; y < bandH; y++) put(x, y, mix('#141d26', '#1a242e', 0.5));
  }
  for (let x = 0; x < W; x++) {
    put(x, 0, INK);
    put(x, 1, mix('#141d26', INK, 0.35));
  }
  // scuffs
  for (let i = 0; i < 160; i++) {
    const x = Math.floor(rnd() * W);
    const y = Math.floor(rnd() * bandH);
    const l = 2 + Math.floor(rnd() * 9);
    for (let k = 0; k < l; k++) {
      if (x + k >= W) break;
      put(x + k, y, mix('#141d26', '#35495c', rnd() * 0.6));
    }
  }
  return px;
}

// ── main ───────────────────────────────────────────────────────────────────
const wallH = arg('wall-h', 128);
const bandH = arg('band-h', 64);
const outDir = arg('out', join(ROOT, 'public', 'assets', 'env'));
mkdirSync(outDir, { recursive: true });

const wall = buildWall(wallH);
const floor = buildFloor(bandH);
writeFileSync(
  join(outDir, 'wall.png'),
  encodePng({ width: W, height: wallH, channels: 3, pixels: Buffer.from(wall) }),
);
writeFileSync(
  join(outDir, 'floor.png'),
  encodePng({ width: W, height: bandH, channels: 3, pixels: Buffer.from(floor) }),
);
console.log(`wall.png  ${W}x${wallH}`);
console.log(`floor.png ${W}x${bandH}`);
console.log(`floor total ${wallH + bandH}px tall`);
