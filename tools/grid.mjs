// Estimates the pixel grid of an image that is an N-times upscale of real pixel
// art (docs: pixel-art-production-skill SKILL.md §2). Colour changes in an
// upscaled sprite cluster on multiples of N, so the smallest frequent run length
// between changes along many scanlines is the grid pitch.
import { readFileSync } from 'node:fs';
import { decodePng } from './png.mjs';

const file = process.argv[2];
const img = decodePng(readFileSync(file));
const { width, height, channels, pixels } = img;
const at = (x, y) => {
  const o = (y * width + x) * channels;
  return (pixels[o] << 16) | (pixels[o + 1] << 8) | pixels[o + 2];
};

// Run lengths between colour changes, sampled on a grid of scanlines.
const runs = new Map();
const note = (n) => runs.set(n, (runs.get(n) ?? 0) + 1);
for (let y = 2; y < height - 2; y += Math.max(1, Math.floor(height / 400))) {
  let prev = at(1, y);
  let run = 1;
  for (let x = 2; x < width - 1; x++) {
    const c = at(x, y);
    if (c === prev) { run++; continue; }
    note(run);
    prev = c;
    run = 1;
  }
}
for (let x = 2; x < width - 2; x += Math.max(1, Math.floor(width / 400))) {
  let prev = at(x, 1);
  let run = 1;
  for (let y = 2; y < height - 1; y++) {
    const c = at(x, y);
    if (c === prev) { run++; continue; }
    note(run);
    prev = c;
    run = 1;
  }
}

// The pitch is the smallest run length that occurs often AND divides most runs.
const total = [...runs.values()].reduce((a, b) => a + b, 0);
const ranked = [...runs.entries()]
  .filter(([n, c]) => c / total > 0.002)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12)
  .map(([n, c]) => `${n}px x${c}`);

// A pitch P is right when most runs are a multiple of it.
const candidates = [2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64].map((p) => {
  let mult = 0;
  for (const [n, c] of runs) if (n % p === 0) mult += c;
  return { p, coverage: mult / total };
}).sort((a, b) => b.coverage - a.coverage);

console.log(`${file.split('/').pop()}`);
console.log(`  ${width}x${height}, ${channels === 4 ? 'RGBA' : 'RGB'}`);
console.log(`  top run lengths: ${ranked.join('  ')}`);
console.log(`  best grid pitch: ${candidates[0].p}px (covers ${(candidates[0].coverage * 100).toFixed(1)}% of runs)`);
console.log(`  next: ${candidates.slice(1, 4).map((c) => `${c.p}px ${(c.coverage * 100).toFixed(0)}%`).join('  ')}`);
