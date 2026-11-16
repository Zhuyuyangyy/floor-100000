// AG-46：给现有对话头像换主色，派生首章四位发布者的 96x96 头像。
//
// 手法与 AG-07 给头像换色相同：结构一像素不动，只把服装族的颜色换成
// 目标族。映射表由调用方显式给出（src=dst 十六进制对），工具负责：
//   * 同时应用整张映射（按原色查表，不存在"改过的色再改一次"）；
//   * 保留 alpha 原样（源文件本就是二值 alpha，不做重采样）；
//   * 出门禁：所有不透明像素必须在 src/render/palette.ts 的 16 色板内、
//     总色数 ≤16、无半透明像素——与 assets-manifest 的 locked 门禁同标准。
//
// 映射目标色必须是板内色，否则门禁直接失败——这是特性：换色换出版外色
// 比不换更难被发现。
//
//   node tools/recolor-portrait.mjs <in.png> --out <out.png> \
//        --map 2c3f4e=d98b3c,47657a=f4b66a [--no-gate]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { decodePng, encodePng } from './png.mjs';

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
}

const inFile = process.argv[2];
const outFile = arg('out', null);
if (!inFile || !outFile) {
  console.error('usage: node tools/recolor-portrait.mjs <in.png> --out <out.png> --map src=dst[,src=dst] [--no-gate]');
  process.exit(1);
}

const map = new Map();
for (const pair of (arg('map', '') || '').split(',')) {
  const m = pair.trim().match(/^([0-9a-fA-F]{6})=([0-9a-fA-F]{6})$/);
  if (!m) throw new Error(`bad --map entry: ${pair}`);
  map.set(parseInt(m[1], 16), parseInt(m[2], 16));
}
if (map.size === 0) throw new Error('--map is required');

// palette.ts 的十六色，从源头解析——和 assets-manifest.mjs / char-sheet-gate.mjs 同一手法。
function loadPalette() {
  const src = readFileSync('src/render/palette.ts', 'utf8');
  const block = src.slice(src.indexOf('export const PALETTE'), src.indexOf('} as const'));
  const hexes = [...block.matchAll(/0x([0-9a-fA-F]{6})/g)].map((m) => m[1].toLowerCase());
  return [...new Set(hexes)].map((h) => [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]);
}
const PALETTE = loadPalette();
const PALETTE_SET = new Set(PALETTE.map(([r, g, b]) => (r << 16) | (g << 8) | b));

const img = decodePng(readFileSync(inFile));
if (img.channels !== 4) throw new Error(`${inFile}: expected RGBA, got ${img.channels} channels`);
const out = Buffer.from(img.pixels);

const swapped = new Map();
const colours = new Set();
let semi = 0;
for (let i = 0; i < img.width * img.height; i++) {
  const o = i * img.channels;
  const a = img.pixels[o + 3];
  if (a === 0) continue;
  if (a < 255) semi++;
  const k = (img.pixels[o] << 16) | (img.pixels[o + 1] << 8) | img.pixels[o + 2];
  const to = map.get(k);
  if (to !== undefined) {
    out[o] = (to >> 16) & 0xff;
    out[o + 1] = (to >> 8) & 0xff;
    out[o + 2] = to & 0xff;
    swapped.set(k, (swapped.get(k) ?? 0) + 1);
    colours.add(to);
  } else {
    colours.add(k);
  }
}

const gate = !process.argv.includes('--no-gate');
const failures = [];
if (gate) {
  for (const c of colours) {
    if (!PALETTE_SET.has(c)) failures.push(`#${c.toString(16).padStart(6, '0')} outside the palette`);
  }
  if (colours.size > PALETTE.length) failures.push(`${colours.size} colours > ${PALETTE.length}`);
  if (semi > 0) failures.push(`${semi} semi-transparent pixels`);
}

for (const [from, to] of map) {
  const n = swapped.get(from) ?? 0;
  console.log(
    `  #${from.toString(16).padStart(6, '0')} -> #${to.toString(16).padStart(6, '0')}  ${n} px${n === 0 ? '  (WARNING: no such colour in source)' : ''}`,
  );
}
console.log(`${outFile}: ${img.width}x${img.height}, ${colours.size} colours, ${semi} semi-alpha px`);
if (failures.length) {
  console.error(`GATE FAILED: ${failures.join('; ')} — nothing written`);
  process.exit(1);
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, encodePng({ width: img.width, height: img.height, channels: 4, pixels: out }));
console.log(`  wrote ${outFile}`);
