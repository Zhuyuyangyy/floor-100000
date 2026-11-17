#!/usr/bin/env node
/**
 * 冻结截图像素 diff——改前/改后（或同 seed 两跑）的逐像素取证。
 * 协议出处：docs/plans/RENDER.md §10.4 / AG-98 的 floor-perf-probe --freeze --shot。
 *
 * 指标与 AG-98 报告同款口径：
 *   diffPixels  任一通道不同的像素数（含 ±1 的舍入）；
 *   overThresh  最大通道差 > --thresh（默认 8）的像素数——真差异，非噪声；
 *   maxDelta    全图最大单通道差；
 *   meanLum     全图平均亮度差（|Δ| 均值，新 vs 新2 基线 ≤0.005 视为同画面）；
 *   bbox        差异像素的包围盒——确认差异落在预期的区域（如圆环带）。
 *
 * 用法：node tools/png-diff.mjs before.png after.png [--thresh 8] [--bbox]
 */
import { readFileSync } from 'node:fs';
import { decodePng } from './png.mjs';

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const [aPath, bPath] = process.argv.slice(2).filter((p) => !p.startsWith('--'));
if (!aPath || !bPath) {
  console.error('usage: node tools/png-diff.mjs before.png after.png [--thresh 8]');
  process.exit(1);
}
const THRESH = Number(arg('thresh', 8));

const a = decodePng(readFileSync(aPath));
const b = decodePng(readFileSync(bPath));
if (a.width !== b.width || a.height !== b.height) {
  console.error(`size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  process.exit(1);
}

const total = a.width * a.height;
let diffPixels = 0;
let overThresh = 0;
let maxDelta = 0;
let lumSum = 0;
let minX = a.width;
let minY = a.height;
let maxX = -1;
let maxY = -1;

for (let p = 0; p < total; p++) {
  const o = p * a.channels;
  let worst = 0;
  for (let c = 0; c < a.channels; c++) {
    const d = Math.abs(a.pixels[o + c] - b.pixels[o + c]);
    if (d > worst) worst = d;
  }
  if (worst > 0) {
    diffPixels += 1;
    if (worst > THRESH) overThresh += 1;
    if (worst > maxDelta) maxDelta = worst;
    const x = p % a.width;
    const y = (p - x) / a.width;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  // Rec.601 luma on the first three channels (RGBA/RGB both lead with them).
  const la = (a.pixels[o] * 299 + a.pixels[o + 1] * 587 + a.pixels[o + 2] * 114) / 1000;
  const lb = (b.pixels[o] * 299 + b.pixels[o + 1] * 587 + b.pixels[o + 2] * 114) / 1000;
  lumSum += lb - la;
}

const pct = ((diffPixels / total) * 100).toFixed(3);
console.log(`${aPath} vs ${bPath}`);
console.log(`  size: ${a.width}x${a.height} (${total} px)`);
console.log(`  diffPixels: ${diffPixels} (${pct}%)`);
console.log(`  overThresh(${THRESH}): ${overThresh}`);
console.log(`  maxDelta: ${maxDelta}`);
console.log(`  meanLum差: ${(lumSum / total).toFixed(4)}`);
if (maxX >= 0) console.log(`  bbox: [${minX},${minY}]..[${maxX},${maxY}] (${maxX - minX + 1}x${maxY - minY + 1})`);
else console.log('  bbox: 无差异像素');
