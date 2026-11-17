#!/usr/bin/env node
/** 把两张冻结截图的差异画成一张红标图 + 粗粒度密度图，供目检差异落点。 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { decodePng, encodePng } from './png.mjs';

const [aPath, bPath, outPath] = process.argv.slice(2);
const a = decodePng(readFileSync(aPath));
const b = decodePng(readFileSync(bPath));
const w = a.width;
const h = a.height;
const out = Buffer.alloc(w * h * 4);
for (let p = 0; p < w * h; p++) {
  const o = p * a.channels;
  let worst = 0;
  for (let c = 0; c < a.channels; c++) worst = Math.max(worst, Math.abs(a.pixels[o + c] - b.pixels[o + c]));
  const d = p * 4;
  if (worst === 0) {
    // 原图压暗到 1/3 亮度，差异区才跳出来。
    out[d] = a.pixels[o] / 3;
    out[d + 1] = a.pixels[o + 1] / 3;
    out[d + 2] = a.pixels[o + 2] / 3;
    out[d + 3] = 255;
  } else {
    out[d] = 255;
    out[d + 1] = worst > 8 ? 0 : 255;
    out[d + 2] = 0;
    out[d + 3] = 255;
  }
}
mkdirSync(outPath.replace(/[/\\][^/\\]*$/, ''), { recursive: true });
writeFileSync(outPath, encodePng({ width: w, height: h, channels: 4, pixels: out }));

// 40x20 网格的差异计数（>8 阈），粗看落点。
const cell = [];
for (let gy = 0; gy < 20; gy++) {
  const row = [];
  for (let gx = 0; gx < 40; gx++) {
    let n = 0;
    for (let y = Math.floor((gy * h) / 20); y < Math.floor(((gy + 1) * h) / 20); y++) {
      for (let x = Math.floor((gx * w) / 40); x < Math.floor(((gx + 1) * w) / 40); x++) {
        const o = (y * w + x) * a.channels;
        let worst = 0;
        for (let c = 0; c < a.channels; c++) worst = Math.max(worst, Math.abs(a.pixels[o + c] - b.pixels[o + c]));
        if (worst > 8) n += 1;
      }
    }
    row.push(n);
  }
  cell.push(row);
}
console.log('差异密度（每格 32x40 px，>8 阈计数，. = 0）：');
for (const row of cell) console.log(row.map((n) => (n === 0 ? '.' : n < 10 ? n : '+')).join(''));
console.log(`标红图 → ${outPath}`);
