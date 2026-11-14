// One-off measurement probe used while auditing candidate art. Kept in tools/
// because the numbers it prints are quoted in docs/assets/AUDIT.md and the
// manifest tool re-derives the same quantities.
//
//   node tools/measure.mjs <file.png> [...more files]
import { readFileSync } from 'node:fs';
import { decodePng } from './png.mjs';

for (const file of process.argv.slice(2)) {
  const img = decodePng(readFileSync(file));
  const counts = new Map();
  let transparent = 0;
  for (let i = 0; i < img.width * img.height; i++) {
    const o = i * img.channels;
    const a = img.channels === 4 ? img.pixels[o + 3] : 255;
    if (a < 16) {
      transparent++;
      continue;
    }
    const c = (img.pixels[o] << 16) | (img.pixels[o + 1] << 8) | img.pixels[o + 2];
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
  console.log(`${file}`);
  console.log(
    `  ${img.width}x${img.height} ${img.channels === 4 ? 'RGBA' : 'RGB'}, ${counts.size} opaque colours, ${transparent} transparent px`,
  );
  console.log(`  top: ${top.map(([c, n]) => `${hex(c)} ${((n / (img.width * img.height)) * 100).toFixed(1)}%`).join('  ')}`);
}
