// Builds a labelled contact sheet so every source image can be identified by eye
// before it is processed. Writes a PNG, no external deps.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, encodePng } from './png.mjs';

const dir = process.argv[2];
const out = process.argv[3];
const cellH = Number(process.argv[4] ?? 220);
const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();

// 3x5 pixel font, enough for a filename label.
const GLYPHS = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
  '_': ['000', '000', '000', '000', '111'], '-': ['000', '000', '111', '000', '000'],
  '.': ['000', '000', '000', '000', '010'], ' ': ['000', '000', '000', '000', '000'],
  a: ['000', '111', '101', '111', '101'], b: ['100', '111', '101', '101', '111'],
  c: ['000', '111', '100', '100', '111'], d: ['001', '111', '101', '101', '111'],
  e: ['000', '111', '111', '100', '011'], f: ['011', '100', '111', '100', '100'],
  g: ['000', '111', '101', '111', '011'], h: ['100', '100', '111', '101', '101'],
  i: ['010', '000', '010', '010', '010'], j: ['001', '000', '001', '101', '111'],
  k: ['100', '101', '110', '101', '101'], l: ['110', '010', '010', '010', '011'],
  m: ['000', '111', '111', '101', '101'], n: ['000', '110', '101', '101', '101'],
  o: ['000', '111', '101', '101', '111'], p: ['000', '111', '101', '111', '100'],
  q: ['000', '111', '101', '111', '001'], r: ['000', '011', '100', '100', '100'],
  s: ['000', '011', '110', '011', '110'], t: ['010', '111', '010', '010', '011'],
  u: ['000', '101', '101', '101', '111'], v: ['000', '101', '101', '101', '010'],
  w: ['000', '101', '101', '111', '111'], x: ['000', '101', '010', '101', '000'],
  y: ['000', '101', '101', '011', '110'], z: ['000', '111', '011', '110', '111'],
};

function label(text) {
  const rows = [0, 0, 0, 0, 0].map(() => []);
  for (const ch of text.toLowerCase()) {
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    for (let r = 0; r < 5; r++) for (const b of g[r]) rows[r].push(b === '1' ? 1 : 0);
    for (let r = 0; r < 5; r++) rows[r].push(0);
  }
  return rows;
}

const cols = 4;
const rows = Math.ceil(files.length / cols);
const gap = 10;
const labelH = 26;
const cellW = 260;
const W = cols * cellW;
const H = rows * (cellH + labelH + gap);
const px = Buffer.alloc(W * H * 4);
for (let i = 0; i < px.length; i += 4) { px[i] = 0x14; px[i + 1] = 0x1a; px[i + 2] = 0x22; px[i + 3] = 255; }

files.forEach((f, n) => {
  const img = decodePng(readFileSync(join(dir, f)));
  const scale = Math.min((cellW - 8) / img.width, (cellH - 8) / img.height);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const ox = (n % cols) * cellW + ((cellW - w) >> 1);
  const oy = Math.floor(n / cols) * (cellH + labelH + gap) + 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / scale));
      const sy = Math.min(img.height - 1, Math.floor(y / scale));
      const s = (sy * img.width + sx) * img.channels;
      const d = ((oy + y) * W + ox + x) * 4;
      px[d] = img.pixels[s]; px[d + 1] = img.pixels[s + 1]; px[d + 2] = img.pixels[s + 2]; px[d + 3] = 255;
    }
  }
  const lrows = label(f.replace('ChatGPT 图像 ', '').replace('.png', ''));
  const lx = (n % cols) * cellW + 6;
  const ly = oy + h + 4;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < lrows[r].length; c++) {
      if (!lrows[r][c]) continue;
      const d = ((ly + r) * W + lx + c) * 4;
      px[d] = 0xec; px[d + 1] = 0xe8; px[d + 2] = 0xd8;
    }
  }
});
writeFileSync(out, encodePng({ width: W, height: H, channels: 4, pixels: px }));
console.log(`contact sheet -> ${out} (${files.length} images)`);
